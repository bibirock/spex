---
name: spex-sandbox-init
description: >-
  建立或更新 Sandbox Profile 並生成可運作的 Docker 沙盒腳手架。此 Skill 必須先讀取
  .claude/reference/sandboxes/README.md，依 Sandbox Profile 協定引導使用者填齊語言/技術棧參數，
  再透過 render-profile.mjs 產生實際沙盒檔案（非文件而已）。前置：無。後續：
  sandbox/dispatch.sh --bootstrap 驗證生成結果；若專案也需要 tracker 整合，接續 /create-adapter。
---

# Sandbox Init — 建立語言無關的 Docker 沙盒

## Overview

架構設計師角色，建立或更新 Sandbox Profile，讓任何語言/技術棧的專案都能取得與本 repo 同等強度的雙平面沙盒（Docker 隔離、egress 防火牆白名單、host/沙盒 PreToolUse guard、確定性驗證束）。與 `create-adapter` 是姊妹 skill：`create-adapter` 處理 tracker 軸（第 3 軸），本 skill 處理語言/技術棧軸（第 1 軸）。

## When to Use

- ✅ 新專案需要建立語言無關的沙盒（不同語言/框架的 repo）
- ✅ 既有 Sandbox Profile 需要調整（新增 sidecar、改驗證束、加防火牆網域）
- ✅ 既有沙盒要複製到另一個技術棧相近但不完全相同的專案
- ❌ 只是想跑既有沙盒（用 `sandbox/dispatch.sh` / `sandbox/claude.sh`）
- ❌ 新增 tracker 整合（改用 `/create-adapter`）

---

## Process

### Phase 0：章戳硬閘平面檢查（強制最先，30 秒）

沙盒平面的驗章由 relay 裁定，但 host 端那支 `spex-stamp-guard.sh` 必須跟著切到沙盒平面，否則它會拿 host session transcript 去驗沙盒內產生的章 → **必然假 FAIL**，整條鏈卡死。

```
grep -n 'spex-stamp-guard.sh' .claude/settings.json
```

| 結果 | 動作 |
| --- | --- |
| 命令列尾為 `--plane sandbox` | ✅ continue |
| 命令列尾為 `--plane agent`、或無 `--plane` 參數（v0.7.0 舊字串） | **停止**，請使用者先執行 `spex init --mode sandbox`（會就地替換同一條目，不重複附加），完成後再回來 |
| 完全找不到（非 Claude Code，或未安裝） | 記為「本環境無章戳硬閘」，於 Phase 7 誠實標註，不得宣稱沙盒有可驗的章 |

### Phase 1：讀取 Sandbox Profile 協定（強制最先）

讀 `.claude/reference/sandboxes/README.md`，理解：

- 三軸分離原則（語言/技術棧軸 vs SDD 工作流軸 vs tracker adapter 軸）——本 skill 只處理第 1 軸
- 核心 Schema 全部欄位（必填/選填）
- 通用固定常數（防火牆通用必要網域、不可傳播清單）
- `verifyBundle` 與 `commandsRuleDocSync` 的雙驅動機制
- 檔案擺放規則
- **「與非沙盒章戳硬閘的共存」章節**——本 skill 生成的 `sandbox-guard.sh` 與既有的 `spex-stamp-guard.sh` 是**兩支並存**的 hook，合併時只增不換

協定與當前需求衝突 → 先調整 README 再起草 profile。

---

### Phase 2：蒐集需求（逐項問答）

#### 2.1 識別資訊

- **Profile ID**：例 `python-fastapi` / `go-gin`
- **顯示名稱 / 技術棧摘要**
- **是否衍生自既有 profile**（`basedOn`）——是的話讀該 profile 當起點，只問差異欄位

#### 2.2 基底映像與套件管理器

- **baseImage**（Dockerfile `FROM`）
- **nonRootUser**（該映像內建的非 root 使用者；沒有的話需額外建立，見 Phase 4 附註）
- **extraOsPackages**（超出通用 apt 基線需要的套件）
- **packageManager**（決定預設 registry 網域與 host 端指令黑名單）

#### 2.3 依賴安裝

- **bootstrapCommand**（`--bootstrap` 執行的指令）
- **depsReadyMarkerPath**（判斷依賴已安裝的哨兵檔）
- **depsCacheVolumes**（隔離依賴快取的 named volume）

#### 2.4 Sidecar 服務（零到多個）

每個 sidecar：`name`／`image`／`environment`／`healthcheck`／`volumeName`+`volumeMountPath`（**必須查該映像官方文件取得正確資料目錄路徑，不可用 service name 猜測**——如 postgres 為 `/var/lib/postgresql/data`、mysql 為 `/var/lib/mysql`、mongo 為 `/data/db`）／`containerPort`（供 preflight 用）／`sandboxEnv`（主 sandbox 服務如何連到此 sidecar）。

#### 2.5 驗證束、覆蓋率、E2E

- **verifyBundle**（有序 `{step, command, skippable}` 清單）
- **diffCoverage**：`tool`（**完整可執行指令，含直譯器前綴**，如 `node sandbox/check-diff-coverage.mjs`）、`threshold`、`lcovPath`、`fileExemptionRules`（{pattern, reason} 清單，取代寫死排除規則）
- **e2eCommand**：不支援時給 `e2eUnsupportedAlternative`（一等結果，非錯誤）
- **resetDbCommand**：不支援時給 `resetDbUnavailableReason`

#### 2.6 防火牆

- **firewallStackDomains**（此套件管理器生態系的 registry 網域）
- **firewallOptionalToggles**：逐一列出候選開關（如 github 遠端存取），每個明確問使用者 `defaultOn` 是否開啟——**不可靜默預設**，尤其「嚴格雙平面 vs 務實」是真實取捨，需使用者裁決

#### 2.7 軸 2/3 可行性（比照 create-adapter 12-op 可行性表精神）

| 項目                                                                | 此專案是否採用 | 對應欄位                                                |
| ------------------------------------------------------------------- | -------------- | ------------------------------------------------------- |
| 完整 SDD 工作流（spex 系列 skill、challenge/verifier 章戳鏈） | ?              | `sddSkillGuardEnabled`                                  |
| Tracker adapter 整合                                                | ?              | `trackerCardInjectionGuardEnabled` + `trackerAdapterId` |

若後者為是，**core 確認**：該 `trackerAdapterId` 對應的 relay 執行檔（`sandbox/<id>-relay.py`）是否已存在？不存在 → 提醒使用者**本 skill 完全不生成任何 relay 件**（解析器、驗章接線、tracker 專屬執行檔皆是），relay 通道需另外執行 `/spex-relay-init` 依 `.claude/reference/spex/relay-protocol.md` 引導生成；兩者順序不影響彼此，但 `trackerCardInjectionGuardEnabled` 開啟後、relay 執行檔補齊前，沙盒的強制派工管線暫無可執行的 tracker 寫入路徑（誠實揭露，非阻擋）。

#### 2.8 格式化 / Lint / 型別逃生口

- **postEditFormatter** / **postEditLinter**：`{command, extensions[]}`，沒有就設 `null`（不生成該 hook）
- **typeEscapeHatchCheck**：多數語言無對應項，設 `null` 即可；有的話填該語言的檢查指令與說明，**指令須遵守 linter 語義（命中逃生口時非零 exit）**——生成的 `check-type-escape.sh` 直接執行它，樣板不預設任何語言的判準，也不要求另寫腳本

#### 2.9 檔案落點與同容器多 target

- 與既有 profile 完全相符 → 直接沿用，不建新文件
- 有差異 → 新建 `.claude/reference/sandboxes/<id>.md`，`basedOn` 指向最接近的 profile
- 是否有其他同容器工作目錄需要派工（`additionalDispatchTargets`）——**先聲明限制**：必須與本 profile 共用 `baseImage`/`nonRootUser`，這不是真正的多容器 polyglot 支援

資訊不足 → 列缺失清單等待補充，**不寫文件、不生成檔案**。

---

### Phase 3：參考既有 profile

若 `.claude/reference/sandboxes/` 下已有其他 profile 文件，讀一份做結構/格式對照（可複用結構，不可複製專屬字樣到新 profile）；尚無任何 profile 時，直接依本文件上方「核心 Schema」欄位定義起草，不需要既有範例。

---

### Phase 4：起草 Profile 文件

依 `sandboxes/README.md`「核心 Schema」欄位順序，寫成「Profile 摘要」表 + 各細節子節（Sidecar 服務 / Verify Bundle / Diff Coverage / 附加派工目標 / 系統特有注意事項 ≥4 條），寫入 `.claude/reference/sandboxes/<id>.md`。

若 `baseImage` 非 npm/pnpm/yarn 生態系，於文件註明：生成的 Dockerfile 會額外用 multi-stage 從官方 Node 映像複製執行檔以安裝 Claude Code CLI（不透過 curl/wget，維持沙盒零 curl/wget 的安全姿態）。

---

### Phase 4.5：組裝與試跑（render-profile.mjs --dry-run）

1. 把 Phase 2 問答結果整理成 profile JSON（暫存於 `sandbox/tasks/`）。
2. 執行（**此步驟須在沙盒內執行，host 直接跑 `node` 會被 `sandbox-guard.sh` 擋下**——用 `sandbox/dispatch.sh --run <暫存 harness 腳本>` 驅動 `render-profile.mjs --dry-run`，或若本 skill 執行環境本身已在沙盒內則可直接跑）：
   ```
   node .claude/reference/sandboxes/scripts/render-profile.mjs \
     --profile <暫存 profile.json> \
     --templates .claude/reference/sandboxes/templates \
     --out <目標 repo 根目錄> \
     --dry-run
   ```
3. 檢查輸出：
   - 檔案清單是否符合預期（每個必要檔案都在，沒有意外缺漏）
   - 若 `trackerCardInjectionGuardEnabled` 開啟：本 skill 生成的檔案裡**沒有任何 relay 件**（渲染器也不會對此給警告），須主動口頭告知使用者 guard 開了但寫入通道尚未存在，並指向 `/spex-relay-init`
   - 斷言輸出不含「不可傳播清單」項目（`/opt/fakebin`、容器內 `dispatch-watchdog.sh`）——`render-profile.mjs` 本身已有此斷言，此處為人工複核

---

### Phase 5：同步登記表

更新 `.claude/reference/sandboxes/README.md`「Profile 文件清單」表，新增/更新該 profile 的一行。

---

### Phase 6：寫入前展示與確認

整理完成後展示：

- Profile 文件完整內容
- `render-profile.mjs --dry-run` 的完整檔案清單（含既有檔案的差異摘要）
- README「Profile 文件清單」預計變更

```
即將寫入：
- <新 profile 路徑>
- .claude/reference/sandboxes/README.md（若需）
- <render-profile.mjs 將實際生成的 N 個沙盒檔案清單>

請確認內容無誤後輸入「確認」；若需調整請說明修改項，調整後再寫入。
```

收到「確認」/「ok」/「yes」後：先寫 profile 文件與 README，再執行 `render-profile.mjs`（**不加 `--dry-run`**）實際生成沙盒檔案。

---

### Phase 7：回報

```
## Sandbox Profile 建立結果
- profile-id: <id>
- 技術棧: <displayName>
- 文件: <路徑>
- README: 已更新 / 無需更新
- 生成檔案: <N> 個（列出關鍵幾個：Dockerfile / docker-compose.sandbox.yml / dispatch.sh / sandbox-guard.sh …）

## PreToolUse hook 狀態（兩支並存）
- spex-stamp-guard.sh: --plane sandbox ✅ / --plane agent ❌（需重跑 `spex init --mode sandbox`）/ 未安裝（本環境無章戳硬閘）
- sandbox-guard.sh: 已生成，**尚未生效**——需依 `.claude/settings.sandbox-snippet.json` 手動合併進 `.claude/settings.json`，合併時**只增不換**，勿覆蓋上面那支條目

## 軸 2/3 開關狀態
- SDD 工作流 guard: 開啟 / 關閉
- Tracker card-injection guard: 開啟 / 關閉（trackerAdapterId: <id> / 無）
  - relay 執行檔狀態：已存在 / 尚未建立（需執行 /create-adapter 補上，見 Phase 2.7）

## 已知簡化 / 未涵蓋
- <若有 additionalDispatchTargets，說明僅限同容器；若有其他已知簡化一併列出>

## 下一步
1. `sandbox/dispatch.sh --bootstrap` 安裝依賴
2. `sandbox/dispatch.sh --verify` 驗證生成結果可運作
3. 若需要 tracker 整合：執行 `/create-adapter`
4. `.claude/settings.sandbox-snippet.json`、`.claude/rules/commands.sandbox-section.md`、
   `.claude/rules/testing.sandbox-section.md` 為參考片段，需手動合併進專案既有規則檔
   （不會自動覆蓋既有內容）。settings 片段的合併**只增不換**：`sandbox-guard.sh` 與
   `spex-stamp-guard.sh` 兩支 PreToolUse hook 並存，任一 exit 2 即擋
```

---

## 強制要求

- Sandbox Profile 必須填齊「核心 Schema」全部必填欄位；選填欄位未提供時明確走預設值，`null` 型欄位必須搭配對應的 `*UnavailableReason`/`*Alternative` 文字，不可留空
- **本 skill 產出實際可運作的沙盒檔案，不是文件而已**——Phase 4.5/6 的 `render-profile.mjs` 呼叫是必經步驟，不可只寫 profile 文件就宣稱完成
- 防火牆選填開關（`firewallOptionalToggles`）必須逐一明確詢問使用者，不可靜默預設 `defaultOn`
- `sidecarServices` 的 `volumeMountPath` 必須查證該映像官方文件，不可用 service name 猜測資料目錄路徑
- `diffCoverage.tool` 必須是完整可執行指令（含直譯器前綴），不是裸路徑
- 不可把死代碼清單（`/opt/fakebin`、容器內 `dispatch-watchdog.sh`）當成可用參考實作複製

---

## Red Flags

- ❌ 跳過 Phase 0 平面檢查，或在 `--plane agent` 狀態下生成沙盒（章戳鏈必定假 FAIL）
- ❌ 把 `sandbox-guard.sh` 條目**取代** `spex-stamp-guard.sh` 條目（兩支並存，只增不換）
- ❌ 沒先讀 `.claude/reference/sandboxes/README.md`
- ❌ 核心 Schema 必填欄位缺任一
- ❌ 只寫 profile 文件，沒有實際跑 `render-profile.mjs` 生成沙盒檔案
- ❌ 防火牆選填開關未明確詢問就自行決定開/關
- ❌ sidecar 的 `volumeMountPath` 用 service name 猜測而非查證官方文件
- ❌ 傳播了「不可傳播清單」項目
- ❌ Phase 6 未經確認就寫入
- ❌ 開啟 `trackerCardInjectionGuardEnabled` 卻不檢查/揭露 relay 執行檔的存在狀態

## Verification

- [ ] Phase 0 已確認 `spex-stamp-guard.sh` 在 `--plane sandbox`（或已誠實標註本環境無章戳硬閘）
- [ ] Phase 7 已回報兩支 hook 的狀態與「只增不換」的合併規則
- [ ] 已讀 `.claude/reference/sandboxes/README.md`
- [ ] Phase 2 全部子節資訊已蒐齊
- [ ] Profile 文件含全部核心 Schema 必填欄位
- [ ] `render-profile.mjs --dry-run` 已執行且無殘留 token / YAML 引號問題 / 不可傳播項目
- [ ] README「Profile 文件清單」已更新
- [ ] Phase 6 已展示、收到「確認」後才實際生成沙盒檔案
- [ ] Phase 7 回報含「已知簡化 / 未涵蓋」與明確下一步

## Next Steps

✅ Sandbox 已生成 → `sandbox/dispatch.sh --bootstrap` → `sandbox/dispatch.sh --verify` 驗證可運作 → 需要 tracker 整合則接續 `/create-adapter`。
