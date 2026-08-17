#!/usr/bin/env python3
import hashlib
import json
import os
import re
import sys
import unicodedata

MARKER_RE = re.compile(
    r"\[(CHALLENGE|VERIFIER)-VERDICT(?:\s+stage=([\w-]+))?(?:\s+round=(\d+))?"
    r"(?:\s+card=([\w.\-]+))?"
    r"\s+verdict=(PASS|FAIL)(?:\s+sha256=([0-9a-f]{8,64}))?[^\]]*\]"
)
STAMP_ID = r"(?:agentId\s+)?(toolu_[\w]+|a[0-9a-f]{15,})"
CLAIM_RE = re.compile(
    r"challenge\s*[:：]\s*PASS（[^）]*?第\s*(\d+)\s*輪[^）]*?(?:[｜|]\s*章[：:\s]\s*" + STAMP_ID + r")?[^）]*?）"
)
VERIFIER_CITE_RE = re.compile(r"驗收章[：:\s]\s*" + STAMP_ID)
# verifier 報告本體的界定標記：驗收章的 sha256 綁定這段區間內的內容（見 check_strict
# 的 verify 分支）。Verify 完成留言必須逐字內嵌整段（含前後標記），編排者不得潤飾。
VERIFY_REPORT_RE = re.compile(
    r"<!--\s*verify-report:start\s*-->(.*?)<!--\s*verify-report:end\s*-->", re.S
)
BOILERPLATE_RE = re.compile(r"agentId:\s*\w+.*$|<usage>.*?</usage>", re.S)
HASH_CMD_RE = re.compile(r"sha256|shasum|createHash", re.I)
STAGE_OF_HEAD = [
    (re.compile(r"\[Spex\]\s*Plan"), "plan"),
    (re.compile(r"\[Spex\]\s*Task"), "task"),
    (re.compile(r"\[Spex\]\s*Fixbug"), "fixbug"),
    (re.compile(r"\[Spex\]\s*Implement"), "implement"),
    (re.compile(r"\[Spex\]\s*Verify"), "selfcheck"),
]


def _resolve_max_rounds() -> int:
    v = os.environ.get("CHALLENGE_MAX_ROUNDS", "")
    if v.isdigit():
        return int(v)
    here = os.path.dirname(os.path.abspath(__file__))
    bases = (os.path.join(here, "..", "..", "..", ".."), os.path.join(here, ".."), os.getcwd())
    for base in bases:
        for agent_dir in (".claude", ".spex", ".codex"):
            p = os.path.join(base, agent_dir, "rules", "sdd-workflow.md")
            try:
                m = re.search(r"詰問輪次上限[^\d]{0,40}(\d+)", open(p, encoding="utf-8").read())
                if m:
                    return int(m.group(1))
            except OSError:
                continue
    return 5


MAX_ROUNDS = _resolve_max_rounds()


def normalize_hash(text: str) -> str:
    t = unicodedata.normalize("NFC", text)
    t = re.sub(r"\s+", " ", t).strip()
    return hashlib.sha256(t.encode()).hexdigest()[:16]


def strip_claim_lines(body: str) -> str:
    # 剝掉的是「路由/宣稱 metadata」，不是圍欄本體：
    #   - 引章宣稱行（challenge：PASS(...) / 驗收章：...）
    #   - `## challenge：` 佔位標題（未回填章號前的暫定行）
    #   - `<!-- spex:entry seq=N at=... -->` append-only 留言檔格式標記（見
    #     reference/adapters/local-file.md「留言檔格式」）——由 addComment 寫入步驟
    #     prepend，屬 skill 圍欄本體之外的 adapter 結構性 metadata，各階段 skill
    #     從未把這行送進 challenger/verifier 的圍欄。
    # 注意：`## [Spex] <Phase> 完成` 這類 phase 標題**不**在此剝除清單——
    # spex-task／spex-implement／spex-selfcheck 的完成留言範本首行皆為這個標題，
    # 圍欄本體逐字包含它一起送去蓋章，與 `<!-- spex:entry -->` 這種 adapter 才附加
    # 的 metadata 性質不同。曾短暫在此加過標題剝除，結果反而打壞 Implement／Verify
    # 本來就正確綁定的章——公約要統一在各 skill 的圍欄範本，不是在驗章器代剝。
    kept = []
    for ln in body.split("\n"):
        if CLAIM_RE.search(ln) or VERIFIER_CITE_RE.search(ln):
            continue
        if re.match(r"^#+\s*challenge\s*[:：]", ln.strip()):
            continue
        if re.match(r"^<!--\s*spex:entry\b.*-->$", ln.strip()):
            continue
        kept.append(ln)
    return "\n".join(kept)


def result_text(block) -> str:
    c = block.get("content")
    if isinstance(c, list):
        return "\n".join(x.get("text", "") for x in c if isinstance(x, dict))
    return str(c or "")


def extract_marker(text: str):
    ms = MARKER_RE.findall(text)
    if ms:
        kind, stage, rnd, card, verdict, sha = ms[-1]
        return {"kind": kind, "stage": (stage or "").lower() or None, "round": int(rnd) if rnd else None,
                "card": card or None, "verdict": verdict, "sha256": sha or None}
    return None


def legacy_verdict(text: str):
    body = BOILERPLATE_RE.sub("", text)
    concl = re.findall(r"(?:結論|整體判定|整體結果|Overall)\s*[:：]?\s*\**\s*(PASS|FAIL)", body)
    if concl:
        return concl[-1], "heuristic-concl"
    tokens = re.findall(r"\b(PASS|FAIL)\b", body)
    if tokens:
        return tokens[-1], "heuristic-tail"
    return None, "none"


def main() -> None:
    legacy = "--legacy" in sys.argv
    paths = [a for a in sys.argv[1:] if a != "--legacy"]
    if not paths:
        print("用法：python3 sandbox/challenge-audit.py [--legacy] <stream-file> [<resume-stream>...]", file=sys.stderr)
        sys.exit(2)

    dispatches = []
    by_id = {}
    main_texts = []
    skill_loads = []
    sub_segments = {}  # parent_tool_use_id -> [(seq, text), ...]（依派發分桶，見下方說明）
    sub_agent_ids = {}  # parent_tool_use_id -> agent_id
    hash_cmd_events = []
    sub_tool_use_counts = {}
    seq = 0

    def _iter_events(paths):
        for p in paths:
            with open(p, encoding="utf-8", errors="replace") as fh:
                yield from fh

    for line in _iter_events(paths):
        s = line.strip()
        if not s.startswith("{"):
            continue
        try:
            ev = json.loads(s)
        except Exception:
            continue
        if not isinstance(ev, dict) or "type" not in ev:
            continue
        seq += 1
        is_sub = bool(ev.get("parent_tool_use_id") or ev.get("subagent_type"))
        st_sub = ev.get("subagent_type")
        # 子代理文字段落一律按 parent_tool_use_id（＝該次派發的 tool_use_id）分桶，
        # 不按 subagent_type 分桶——同一 session 內同型別（challenger/verifier）派發
        # 一輪以上時，按型別分桶的舊邏輯會把不同輪次的文字段落互相覆寫（round2 的
        # 文字覆蓋掉 round1 尚未被 tool_result 領走的段落），round1 的章面因此消失。
        if ev.get("type") == "assistant" and st_sub in ("challenger", "verifier"):
            pid = ev.get("parent_tool_use_id")
            if pid:
                for b in (ev.get("message") or {}).get("content") or []:
                    if isinstance(b, dict) and b.get("type") == "text" and b.get("text"):
                        sub_segments.setdefault(pid, []).append((seq, b["text"]))
                aid = ev.get("agent_id")
                if aid:
                    sub_agent_ids[pid] = aid
        # 註：agent_id 的單一事實來源已改為 transcript-to-stream.mjs 直接在子事件上
        # 標註（見上 sub_agent_ids 填值處）；本 harness（Claude Code CLI）不產生
        # type=system/subtype=task_notification 事件，故不再依賴該事件型別反推歸屬。
        if ev.get("type") == "assistant":
            for b in (ev.get("message") or {}).get("content") or []:
                if not isinstance(b, dict):
                    continue
                if is_sub and b.get("type") == "tool_use":
                    pid = ev.get("parent_tool_use_id")
                    if pid:
                        sub_tool_use_counts[pid] = sub_tool_use_counts.get(pid, 0) + 1
                if b.get("type") == "tool_use" and b.get("name") == "Skill" and not is_sub:
                    skill_loads.append((seq, (b.get("input") or {}).get("skill", "")))
                if b.get("type") == "tool_use" and b.get("name") == "Bash" and is_sub:
                    cmd = (b.get("input") or {}).get("command", "")
                    if HASH_CMD_RE.search(cmd):
                        hash_cmd_events.append((seq, ev.get("parent_tool_use_id")))
                if b.get("type") == "tool_use" and b.get("name") in ("Agent", "Task") and not is_sub:
                    st = (b.get("input") or {}).get("subagent_type")
                    if st in ("challenger", "verifier"):
                        d = {
                            "seq": seq, "type": st, "tool_use_id": b["id"],
                            "bg": bool((b.get("input") or {}).get("run_in_background")),
                            "done_seq": None, "marker": None, "agent_id": None,
                            "legacy_verdict": None, "legacy_src": "none", "tool_uses": None,
                        }
                        dispatches.append(d)
                        by_id[b["id"]] = d
                elif b.get("type") == "text" and b.get("text") and not is_sub:
                    main_texts.append((seq, b["text"]))
        elif ev.get("type") == "user":
            for b in (ev.get("message") or {}).get("content") or []:
                if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("tool_use_id") in by_id:
                    d = by_id[b["tool_use_id"]]
                    txt = result_text(b)
                    d["done_seq"] = seq
                    d["marker"] = extract_marker(txt)
                    d["legacy_verdict"], d["legacy_src"] = legacy_verdict(txt)
                    m = re.search(r"tool_uses[:>]\s*(\d+)", txt)
                    d["tool_uses"] = int(m.group(1)) if m else None
                    m = re.search(r"agentId:\s*(\w+)", txt)
                    d["agent_id"] = m.group(1) if m else None

    for pid, texts in sub_segments.items():
        d = by_id.get(pid)
        if not d:
            continue
        # 同一次派發可能有多段助理文字（工具呼叫間穿插的說明文字）；末段（seq 最大）
        # 才是最終回報，優先從末段找章面，找不到再退而找全段落合併文字（防章面前面
        # 還有一段收尾閒聊、雖屬 non-issue 但不必因此漏抓）。
        texts_sorted = sorted(texts, key=lambda t: t[0])
        last_seq, last_text = texts_sorted[-1]
        mk = extract_marker(last_text) or extract_marker("\n".join(t for _, t in texts_sorted))
        if mk and d["marker"] is None:
            d["marker"] = mk
        if d["agent_id"] is None and sub_agent_ids.get(pid):
            d["agent_id"] = sub_agent_ids[pid]
        if d["tool_uses"] is None:
            m = re.search(r"tool_uses[:>]\s*(\d+)", last_text)
            if m:
                d["tool_uses"] = int(m.group(1))

    hash_verified_ids = {pid for _, pid in hash_cmd_events if pid}
    for d in dispatches:
        d["hash_verified"] = d["tool_use_id"] in hash_verified_ids
        # 地面真相優先：直接數子代理事件流裡的真實 tool_use 區塊數，
        # 不依賴子代理自己文字回報裡有沒有嵌入「tool_uses: N」這類字面——
        # 那個字串格式因 harness／回報模板而異，不可靠；派發事件本身的結構化子事件才是單一事實來源。
        real_count = sub_tool_use_counts.get(d["tool_use_id"])
        if real_count is not None:
            d["tool_uses"] = real_count

    claims = []
    for pos, text in main_texts:
        for m in re.finditer(r"\[TRACKER-ACTION ([^\]]+)\]\n(.*?)\n?\[/TRACKER-ACTION\]", text, re.S):
            if "op=addComment" not in m.group(1):
                continue
            body = m.group(2)
            head = body.strip().splitlines()[0] if body.strip() else ""
            stage = next((s for rx, s in STAGE_OF_HEAD if rx.search(body)), None)
            cm = CLAIM_RE.search(body)
            if cm:
                claims.append({
                    "seq": pos, "kind": "challenge", "stage": stage,
                    "round": int(cm.group(1)), "stamp": cm.group(2), "head": head, "body": body,
                })
            if stage == "selfcheck":
                vc = VERIFIER_CITE_RE.search(body)
                claims.append({
                    "seq": pos, "kind": "verify", "stage": stage,
                    "round": None, "stamp": vc.group(1) if vc else None, "head": head, "body": body,
                })

    violations = []
    consumed = {}
    ch = [d for d in dispatches if d["type"] == "challenger"]

    def resolve_stamp(cited):
        if not cited:
            return None
        return by_id.get(cited) or next((d for d in dispatches if d["agent_id"] == cited), None)

    for d in dispatches:
        if d["bg"]:
            violations.append(f"I3 非同步派發：{d['type']} seq={d['seq']} run_in_background=true")

    load_seqs = [s for s, name in skill_loads if name == "spex-challenge"]
    for d in ch:
        d["preload"] = not any(s < d["seq"] for s in load_seqs)
    preload_probes = [d for d in ch if d.get("preload")]
    if preload_probes:
        info_s0 = (f"S0 記錄：{len(preload_probes)} 次 pre-load 土製派發"
                   f"（seq={[d['seq'] for d in preload_probes]}）——其章不可引用；載入後派發不受影響")
    else:
        info_s0 = None
    if ch and not load_seqs:
        real_ch = [d for d in ch if d.get("marker") and (d.get("tool_uses") or 0) >= 8]
        if real_ch and len(real_ch) == len(ch):
            warn = (f"S0 降級警告：未載 spex-challenge SKILL，但 {len(ch)} 次派發皆真 "
                    f"challenger 子代理（有章面+實查≥8），challenge 實質有效——程序偏離非造假")
            info_s0 = (info_s0 + "；" + warn) if info_s0 else warn
        else:
            violations.append(
                f"S0 閘門未載 SKILL 且派發非真 challenger（缺章面或實查<8）："
                f"憑記憶土製詰問 = 無 C1–C5 判準、無輪次硬上限、無蓋章素材，challenge 無效"
            )

    if not legacy:
        # 分組鍵含 card：批次（spex-schedule）在單一 session 連跑多張卡時，B 卡 round1 的
        # FAIL 不該讓已收斂的 A 卡跟著被判未收斂。舊事件流的章沒有 card 欄位，一律落在
        # card=None 這組，行為與加欄位前完全相同。
        latest_by_key = {}
        for d in ch:
            if not d.get("done_seq") or not d.get("marker"):
                continue
            key = ((d["marker"] or {}).get("stage"), (d["marker"] or {}).get("card"))
            cur = latest_by_key.get(key)
            if cur is None or d["done_seq"] > cur["done_seq"]:
                latest_by_key[key] = d
        for (st, card), d in latest_by_key.items():
            v = (d.get("marker") or {}).get("verdict")
            if v != "PASS":
                scope = f"stage={st}" + (f" card={card}" if card else "")
                violations.append(
                    f"S2-收斂 {scope} 最新 challenger 章面 verdict={v}（seq={d['seq']}，done@{d['done_seq']}）："
                    f"FAIL/未收斂不可蓋章，須修正後重詰取 PASS 章才可交棒"
                )

    def check_strict(c):
        tag = f"（seq={c['seq']}，{(c['head'] or '')[:40]}）"
        if c["kind"] == "challenge":
            if not c["stamp"]:
                violations.append(f"S1 宣稱未引章號{tag}：宣稱行須為 challenge：PASS（第 n 輪｜章 toolu_…）")
                return
            d = resolve_stamp(c["stamp"])
            if not d or d["type"] != "challenger" or not d["done_seq"] or d["done_seq"] > c["seq"]:
                violations.append(f"S1 章號 {c['stamp']} 不存在 / 非 challenger / 未完成於宣稱前{tag}")
                return
            if d.get("preload"):
                violations.append(f"S0/S1 章號 {c['stamp']} 出自 pre-load 土製派發（seq={d['seq']}），其章不可引用{tag}")
                return
            mk = d["marker"]
            if not mk or mk["kind"] != "CHALLENGE" or mk["verdict"] != "PASS":
                violations.append(f"S2 章 {c['stamp']} 無結構化 PASS 標記（marker={mk}）{tag}")
                return
            if c["round"] > MAX_ROUNDS or (mk["round"] and mk["round"] != c["round"]):
                violations.append(
                    f"S3 輪次不符或超限（宣稱第{c['round']}輪／章面第{mk['round']}輪，上限{MAX_ROUNDS}）{tag}"
                )
            if c["stage"] and mk["stage"] and mk["stage"] != c["stage"]:
                violations.append(f"S3 章面 stage={mk['stage']} 與留言 stage={c['stage']} 不符{tag}")
            # 輪次上限是「每張卡每個 stage」，不是整份事件流。批次（spex-schedule）在單一
            # session 連跑多張卡時，每張卡的 task 章都會落在同一份 transcript 裡；只依 stage
            # 分組會讓第 4 張卡即使首輪就 PASS 也被判超限。分組鍵直接取被引用那枚章的 card，
            # 不必回頭解析留言本體去猜卡片編號。舊事件流的章沒有 card 欄位，一律落在
            # card=None 這組，行為與加欄位前完全相同。
            same_scope = [
                x for x in ch
                if x["marker"]
                and x["marker"]["stage"] == (mk["stage"] or c["stage"])
                and x["marker"].get("card") == mk.get("card")
            ]
            if len(same_scope) > MAX_ROUNDS:
                scope = f"stage={mk['stage'] or c['stage']}" + (f" card={mk['card']}" if mk.get("card") else "")
                violations.append(f"S4 {scope} 的章共 {len(same_scope)} 枚（>上限{MAX_ROUNDS}）：應升級人工")
            s5_ok = False
            if mk["sha256"]:
                if not d.get("hash_verified"):
                    violations.append(
                        f"S8 章 {c['stamp']} 面含 sha256 但子代理執行軌跡內找不到真實雜湊計算工具呼叫"
                        f"（Bash 內容含 sha256/shasum/createHash）：疑似編造章面，不可採信{tag}"
                    )
                    return
                h = normalize_hash(strip_claim_lines(c["body"]))
                if not h.startswith(mk["sha256"][: len(h)]) and not mk["sha256"].startswith(h[: len(mk["sha256"])]):
                    violations.append(f"S5 內容綁定不符：章面 sha256={mk['sha256']}，留言草稿雜湊={h}{tag}")
                else:
                    s5_ok = True
            else:
                violations.append(f"S5 章 {c['stamp']} 缺 sha256 內容綁定{tag}")
            if s5_ok:
                if c["stamp"] in consumed:
                    violations.append(f"S6 章 {c['stamp']} 重複使用（先前已支持 seq={consumed[c['stamp']]}）{tag}")
                consumed[c["stamp"]] = c["seq"]
        else:
            if not c["stamp"]:
                violations.append(f"S7 Verify 留言未引驗收章（驗收章 toolu_…）{tag}")
                return
            d = resolve_stamp(c["stamp"])
            mk = d["marker"] if d else None
            if not d or d["type"] != "verifier" or not d["done_seq"] or d["done_seq"] > c["seq"]:
                violations.append(f"S7 驗收章 {c['stamp']} 不存在 / 非 verifier / 未完成於宣稱前{tag}")
            elif not mk or mk["kind"] != "VERIFIER" or mk["verdict"] != "PASS":
                violations.append(f"S7 驗收章 {c['stamp']} 無結構化 PASS 標記（marker={mk}）{tag}")
            else:
                # S5/S8 內容綁定（與 challenge 路徑對稱）。沒有這一段，驗收章只證明
                # 「有跑過一次 verifier 且它說 PASS」，Verify 留言裡的 AC 對照表與防錯
                # 檢核結果寫什麼都不受章約束——編排者可以把 FAIL 項改寫成 PASS、或整段
                # 重寫成沒驗過的內容，章照樣對得上。
                # 綁定對象不是整份留言：留言的「章戳驗證」節記的是本次稽核自己的結果
                # （雞生蛋問題），「確定性檢查」節則是 verifier 派發前就已知的事實。真正
                # 需要綁定的是 verifier 產出的那段報告，故以 verify-report 標記界定範圍。
                if not mk["sha256"]:
                    violations.append(f"S5 驗收章 {c['stamp']} 缺 sha256 內容綁定{tag}")
                elif not d.get("hash_verified"):
                    violations.append(
                        f"S8 驗收章 {c['stamp']} 面含 sha256 但子代理執行軌跡內找不到真實雜湊計算工具呼叫"
                        f"（Bash 內容含 sha256/shasum/createHash）：疑似編造章面，不可採信{tag}"
                    )
                else:
                    rm = VERIFY_REPORT_RE.search(c["body"])
                    if not rm:
                        violations.append(
                            f"S5 Verify 留言找不到 <!-- verify-report:start --> … <!-- verify-report:end --> 區塊"
                            f"：驗收章綁定的是 verifier 的報告本體，留言須逐字內嵌該區塊{tag}"
                        )
                    else:
                        h = normalize_hash(strip_claim_lines(rm.group(1)))
                        if not h.startswith(mk["sha256"][: len(h)]) and not mk["sha256"].startswith(h[: len(mk["sha256"])]):
                            violations.append(
                                f"S5 內容綁定不符：章面 sha256={mk['sha256']}，留言 verify-report 區塊雜湊={h}{tag}"
                            )
            if c["stamp"] in consumed:
                violations.append(f"S6 驗收章 {c['stamp']} 重複使用{tag}")
            consumed[c["stamp"]] = c["seq"]

    def check_legacy(c, prev_seq):
        tag = f"（seq={c['seq']}，{(c['head'] or '')[:40]}）"
        if c["kind"] == "challenge":
            window = [d for d in ch if prev_seq < d["seq"] < c["seq"] and d["done_seq"] and d["done_seq"] < c["seq"]]
            if c["round"] > MAX_ROUNDS:
                violations.append(f"I7 宣稱第{c['round']}輪 PASS（>上限{MAX_ROUNDS}）：第{MAX_ROUNDS + 1}輪起一律無效{tag}")
            if len(window) < c["round"]:
                violations.append(f"I1 宣稱第{c['round']}輪但區間內已完成 challenger 僅 {len(window)} 次{tag}")
            if window:
                last = max(window, key=lambda d: d["done_seq"])
                v = (last["marker"] or {}).get("verdict") or last["legacy_verdict"]
                if v != "PASS":
                    violations.append(f"I2 最近一次 challenger verdict={v}（src={last['legacy_src']}）{tag}")
            else:
                violations.append(f"I2 區間內無任何已完成 challenger 派發{tag}")
        else:
            done_vf = [d for d in dispatches if d["type"] == "verifier" and d["done_seq"] and d["done_seq"] < c["seq"]]
            if not done_vf:
                violations.append(f"I4 Verify 留言前無已完成 verifier 派發{tag}")

    prev_claim_seq = 0
    ordered = sorted(claims, key=lambda x: x["seq"])
    last_claim_of_stamp = {}
    for c in ordered:
        if c.get("stamp"):
            last_claim_of_stamp[c["stamp"]] = c["seq"]
    for c in ordered:
        if legacy:
            check_legacy(c, prev_claim_seq)
            if c["kind"] == "challenge":
                prev_claim_seq = c["seq"]
        else:
            if c.get("stamp") and last_claim_of_stamp.get(c["stamp"]) != c["seq"]:
                continue
            check_strict(c)

    tool_counts = [d["tool_uses"] for d in dispatches if d["tool_uses"]]
    report = {
        "mode": "legacy" if legacy else "strict",
        "dispatches": [
            {k: d[k] for k in ("seq", "type", "tool_use_id", "bg", "done_seq", "marker", "legacy_verdict", "legacy_src", "tool_uses")}
            for d in dispatches
        ],
        "claims": [{k: c[k] for k in ("seq", "kind", "stage", "round", "stamp", "head")} for c in claims],
        "violations": violations,
        "tool_uses_avg": round(sum(tool_counts) / len(tool_counts), 1) if tool_counts else None,
    }
    stem = re.sub(r"\.(result\.md|stream\.jsonl)$", "", paths[-1])
    json.dump(report, open(f"{stem}.challenge-audit.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    print(f"mode={report['mode']} 派發 {len(dispatches)}（challenger {len(ch)}）宣稱 {len(claims)} 個")
    if info_s0:
        print(f"  ℹ️ {info_s0}")
    for d in dispatches:
        state = f"done@{d['done_seq']}" if d["done_seq"] else "PENDING"
        mk = d["marker"]
        vd = f"{mk['verdict']}[章面 stage={mk['stage']} r={mk['round']}]" if mk else f"{d['legacy_verdict'] or '-'}[{d['legacy_src']}]"
        print(f"  {d['type']:<10} seq={d['seq']:<5} {state:<11} {vd} tool_uses={d['tool_uses'] or '-'} 章號={d['tool_use_id'][:18]}")
    if report["tool_uses_avg"] is not None:
        print(f"  子agent實查量平均 {report['tool_uses_avg']} 次/派發（紅線 <8）")
    if violations:
        print("❌ 違反：")
        for v in violations:
            print(f"  - {v}")
        sys.exit(1)
    print("✅ 全部宣稱有章可驗")


if __name__ == "__main__":
    main()
