#!/usr/bin/env node
// 把 Claude Code 的原生 transcript 正規化成 challenge-audit.py 認得的 NDJSON 事件流。
//
// 為什麼需要這一層：challenge-audit 的事件模型來自沙盒 dispatch 的影子流——子代理事件與主流
// 混在同一條 NDJSON 裡，且以 `subagent_type` / `parent_tool_use_id` 標記歸屬。Claude Code 則是
// 主 transcript 只留派發的 tool_use / tool_result，子代理事件另存
// `<transcript 同名目錄>/subagents/agent-<agentId>.jsonl`（歸屬記在 `agent-<id>.meta.json` 的
// `agentType` / `toolUseId`）。兩邊都由 harness 寫、都在 repo 之外，信任性質相同，只是形狀不同。
// 本檔只做形狀轉換，**不做任何判定**——判定一律留給 challenge-audit（單一來源）。
//
// 另一個形狀差異：沙盒平面的 tracker 寫入是主 agent 吐 `[TRACKER-ACTION op=addComment]` 區塊由
// host 代寫，claims 因此能從事件流掃出來；非沙盒平面是 skill 直接呼叫 MCP，事件流裡沒有那種區塊。
// 故本檔把「tracker 寫入類 MCP 呼叫」與「尚未送出的待寫留言（--pending）」一併合成等價的
// TRACKER-ACTION 文字事件，讓 audit 的 claims 解析原封不動就能用。
//
// 用法：
//   node transcript-to-stream.mjs <transcript.jsonl> [--pending <留言草稿檔> --pending-id <卡片 id>]
// 輸出：stdout NDJSON

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const transcripts = args.filter((a) => !a.startsWith('--') && !isFlagValue(a));
const pendingFile = valueOf('--pending');
const pendingId = valueOf('--pending-id') || '<pending>';

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
function isFlagValue(a) {
  const i = args.indexOf(a);
  return i > 0 && args[i - 1].startsWith('--');
}

if (transcripts.length === 0) {
  console.error(
    '用法：node transcript-to-stream.mjs <transcript.jsonl> [--pending <留言草稿檔> --pending-id <卡片 id>]',
  );
  process.exit(2);
}

// tracker 寫入類 MCP 工具：留言與工作項目寫入都算（各 tracker 的 MCP server 命名不同，
// 以動詞比對而非寫死 server 名，避免換 adapter 就失效）。
const TRACKER_WRITE_TOOL = /^mcp__.*__(add|create|update)_(comment|work_item|issue|task)/i;
const CLAIM_HINT = /challenge\s*[:：]\s*PASS|驗收章/;

const out = [];
const emit = (ev) => out.push(JSON.stringify(ev));

for (const tp of transcripts) {
  const subagentsDir = path.join(tp.replace(/\.jsonl$/, ''), 'subagents');
  // toolUseId → { agentId, agentType }：由 harness 寫的 meta 檔提供歸屬，不靠猜測
  const byToolUse = new Map();
  if (existsSync(subagentsDir)) {
    for (const f of readdirSync(subagentsDir)) {
      if (!f.endsWith('.meta.json')) continue;
      try {
        const meta = JSON.parse(readFileSync(path.join(subagentsDir, f), 'utf8'));
        if (meta.toolUseId) {
          byToolUse.set(meta.toolUseId, {
            agentId: f.replace(/^agent-/, '').replace(/\.meta\.json$/, ''),
            agentType: meta.agentType,
          });
        }
      } catch {
        // meta 壞掉不影響其他 agent 的歸屬，略過
      }
    }
  }

  for (const line of readFileSync(tp, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    let ev;
    try {
      ev = JSON.parse(s);
    } catch {
      continue;
    }
    if (!ev || typeof ev !== 'object' || !ev.type) continue;

    emit(ev);

    const blocks = Array.isArray(ev.message?.content) ? ev.message.content : [];
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;

      // 派發事件後就地插入該子代理的事件（加上 audit 需要的歸屬欄位）：
      // sub_segments 取「seq 大於派發」的段落，故必須排在派發之後、tool_result 之前。
      if (b.type === 'tool_use' && (b.name === 'Task' || b.name === 'Agent')) {
        const info = byToolUse.get(b.id);
        if (info) emitSubagentEvents(subagentsDir, info, b.id);
      }

      // tracker 寫入類 MCP 呼叫 → 合成 TRACKER-ACTION 文字事件供 claims 解析
      if (b.type === 'tool_use' && TRACKER_WRITE_TOOL.test(b.name || '')) {
        const input = b.input || {};
        const body = String(input.comment ?? input.body ?? input.text ?? input.content ?? '');
        if (body && CLAIM_HINT.test(body)) {
          emitAction(String(input.id ?? input.workItemId ?? input.issue_number ?? ''), body);
        }
      }
    }
  }
}

// 待寫入的留言（PreToolUse guard 用）：尚未進 transcript，需由呼叫方傳入
if (pendingFile) {
  const body = readFileSync(pendingFile, 'utf8');
  emitAction(pendingId, body);
}

function emitSubagentEvents(subagentsDir, info, toolUseId) {
  const file = path.join(subagentsDir, `agent-${info.agentId}.jsonl`);
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    let ev;
    try {
      ev = JSON.parse(s);
    } catch {
      continue;
    }
    if (!ev || typeof ev !== 'object' || !ev.type) continue;
    // audit 以這幾個欄位辨識「這是子代理事件」「屬於哪次派發」「哪個 agent 實例」；
    // Claude Code 原生沒有，補上。agent_id 直接來自 meta 檔名（單一事實來源），
    // 不依賴 task_notification 事件（本 harness 未必產生該事件型別）反推。
    ev.subagent_type = info.agentType;
    ev.parent_tool_use_id = toolUseId;
    ev.agent_id = info.agentId;
    emit(ev);
  }
}

function emitAction(id, body) {
  emit({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'text',
          text: `[TRACKER-ACTION op=addComment id=${id}]\n${body}\n[/TRACKER-ACTION]`,
        },
      ],
    },
  });
}

process.stdout.write(out.join('\n') + '\n');
