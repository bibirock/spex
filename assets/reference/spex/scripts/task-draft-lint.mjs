#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const commentFile = process.argv[3];
if (!file) {
  console.log(
    '用法：node .claude/reference/spex/scripts/task-draft-lint.mjs <任務清單草稿.md> [Task留言草稿.md]',
  );
  console.log(
    '規則：R1/R2 TDD 段須有測試執行確認｜R3 AC 須帶驗收指令｜R5 包含檔案須帶說明｜R6 禁行數‧工時預估｜R10(warn) 跨檔名稱一致',
  );
  console.log(
    '選擇性觸發（草稿沒用到該語法就不檢查，不預設專案技術棧）：R4 測試名 pattern 須現身於 it() 標題｜R8 多狀態碼 AC 須一子條件一具名案例',
  );
  process.exit(2);
}
const text = readFileSync(file, 'utf8');
const lines = text.split('\n');
const errs = [];

const confirm =
  /(跑|執行|重跑).{0,14}測試|測試.{0,10}(確認|驗證)|確認.{0,8}(PASS|全綠|無回歸)|驗證.{0,6}PASS/;

function checkStep(marker, rule) {
  lines.forEach((l, i) => {
    if (!l.includes(marker)) return;
    let end = Math.min(i + 6, lines.length);
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      if (/[🔴🟢🔵]|^#{1,3} /u.test(lines[j])) {
        end = j;
        break;
      }
    }
    const seg = lines.slice(i, end).join(' ');
    if (!confirm.test(seg))
      errs.push(
        `${rule} line ${i + 1}: ${marker} 段缺測試執行/PASS 確認字樣 → ${l.trim().slice(0, 80)}`,
      );
  });
}
checkStep('🟢', 'R1');
checkStep('🔵', 'R2');

function acWindow(i, span) {
  const seg = [lines[i]];
  for (let j = i + 1; j < Math.min(i + span, lines.length); j++) {
    if (/^\s*-\s*\[ \]/.test(lines[j])) break;
    seg.push(lines[j]);
  }
  return seg.join(' ');
}

lines.forEach((l, i) => {
  if (!/^\s*-\s*\[ \]\s*AC-/.test(l)) return;
  const w = acWindow(i, 3);
  if (!w.includes('驗收指令') || !w.includes('`'))
    errs.push(
      `R3 line ${i + 1}: AC 條目 2 行內無帶指令的「驗收指令：」 → ${l.trim().slice(0, 80)}`,
    );
});

const itTitles = [...text.matchAll(/it\((['"])(.+?)\1/g)].map((m) => m[2]);
for (const m of text.matchAll(/--testNamePattern=\\?["']([^"']+)\\?["']/g)) {
  const pat = m[1];
  if (!itTitles.some((t) => t.includes(pat))) {
    const ln = text.slice(0, m.index).split('\n').length;
    errs.push(
      `R4 line ${ln}: pattern "${pat}" 未出現在任何 it() 標題字串內（Red 區塊須明文列出含該字串的 it() 標題）`,
    );
  }
}

let inFiles = false;
lines.forEach((l, i) => {
  if (/^#{2,4}\s*包含檔案/.test(l)) {
    inFiles = true;
    return;
  }
  if (inFiles && /^#{1,4} /.test(l)) inFiles = false;
  if (inFiles && /^\s*-\s+\S/.test(l) && l.includes('/') && l.includes('.')) {
    if (!l.includes('—') && !l.includes('──'))
      errs.push(
        `R5 line ${i + 1}: 包含檔案條目缺「— 說明」 → ${l.trim().slice(0, 80)}`,
      );
  }
});

lines.forEach((l, i) => {
  if (/約\s*\d+\s*行|預估.{0,8}(小時|天|工時)/.test(l))
    errs.push(`R6 line ${i + 1}: 含行數/工時預估 → ${l.trim().slice(0, 80)}`);
});

lines.forEach((l, i) => {
  if (!/^\s*-\s*\[ \]\s*AC-/.test(l)) return;
  const codes = [
    ...new Set(
      [...l.matchAll(/\b(20[014]|40[0134]|409|429)\b/g)].map((m) => m[1]),
    ),
  ].sort();
  if (codes.length >= 2) {
    for (const code of codes) {
      if (!itTitles.some((t) => t.includes(code)))
        errs.push(
          `R8 line ${i + 1}: AC 條目含多狀態碼子條件，${code} 未見於任何 it() 標題（一子條件一具名案例）→ ${l.trim().slice(0, 70)}`,
        );
    }
  }
});

const warns = [];
if (commentFile) {
  const cm = readFileSync(commentFile, 'utf8');
  for (const m of cm.matchAll(/\|\s*\**(T-\d{3})\**\s*\|\s*([^|\n]*?)\s*\|/g)) {
    const [, tid, raw] = m;
    const name = raw.replace(/[*`]/g, '').trim();
    const looksName =
      /[一-鿿]/.test(name) || /[A-Za-z]{3,}/.test(name.replace(/AC-\d+/g, ''));
    if (!name || !looksName) continue;
    const re = new RegExp(`^#{1,3}\\s*(?:\\[)?${tid}(?:\\])?[^\\n]*`, 'm');
    const hit = text.match(re);
    const keyword = name
      .split(/[\s：:（(]/)
      .find((w) => w.length >= 2 && !/^AC-/.test(w));
    if (hit && keyword && !hit[0].includes(keyword))
      warns.push(
        `R10(warn) ${tid}: 摘要表名稱「${name.slice(0, 40)}」關鍵詞未見於清單標題「${hit[0].slice(0, 50)}」——請人工確認跨檔同步（challenger C4 兜底）`,
      );
  }
}

if (errs.length) {
  console.log(`task-draft-lint: ${errs.length} 項違規`);
  for (const e of errs) console.log('  ' + e);
  for (const w of warns) console.log('  ' + w);
  process.exit(1);
}
if (warns.length) for (const w of warns) console.log('  ' + w);
console.log('task-draft-lint: PASS');
