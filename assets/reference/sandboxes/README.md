# Sandbox Profile 協定規格

本文件定義「泛化沙盒生成器」（`spex-sandbox-init` skill）與具體語言/技術棧之間的抽象介面。
所有生成邏輯只讀本檔定義的 **Sandbox Profile 欄位**，不在生成器本體或樣板檔內硬寫任何特定語言的路徑、指令或套件名稱。

> 三軸分離原則（唯一來源，其他文件引用本節）：沙盒的寫死內容沿三條獨立軸線分布——
>
> 1. **語言/技術棧軸**（Node/Python/Go/…）——本協定唯一負責泛化的軸。
> 2. **SDD 工作流軸**（challenge / verifier / card-injection 等機制）——與語言無關，由 `sddSkillGuardEnabled` 開關控制，預設關閉。
> 3. **Tracker adapter 軸**（ADO / Jira / Notion / …）——與語言無關，由 `trackerCardInjectionGuardEnabled` + `trackerAdapterId` 控制，預設關閉，且需搭配 `.claude/reference/adapters/<id>.md` 存在的 relay 執行檔才有意義。
>
> 新增 Sandbox Profile 只需要處理第 1 軸；第 2、3 軸永遠是「照抄開關邏輯、預設關閉」，不要在 profile 裡重新發明。

---

## Skills 引用 Sandbox Profile 規範

`spex-sandbox-init` 讀本檔時**不可一次載入全份**，比照 `adapters/README.md` 的做法只讀對應章節：

**引用格式**：skill 引用協定章節（本檔 anchor）取得欄位定義，實際值來自使用者在 Phase 2 問答的回覆，最終彙整進 `<id>.md` profile 文件與傳給 `render-profile.mjs` 的 profile JSON。

**例外**：首次接觸本協定可一次讀「核心 Schema」表（&lt;150 行）取得全貌，不算違規。

---

## Profile 選擇規則

Profile 由使用者在 `spex-sandbox-init` Phase 2 顯式選擇（或新建）決定，**不像 Tracker Adapter 有全域單一生效值**——同一個 repo 可能只需要一份 profile（生成一次沙盒），選擇規則單純：

| 情況                                  | 動作                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| 目標專案技術棧與既有 profile 完全相符 | 直接沿用該 profile（`spex-sandbox-init` Phase 2.9 問答判定）             |
| 技術棧不同，或既有 profile 需要調整   | 新建 `.claude/reference/sandboxes/<id>.md`，`basedOn` 指向最接近的既有 profile |

---

## 檔案擺放規則

| 情況                 | 擺放方式                                                        |
| -------------------- | --------------------------------------------------------------- |
| Profile 文件         | `.claude/reference/sandboxes/<id>.md`                           |
| 樣板檔（生成器共用） | `.claude/reference/sandboxes/templates/`（跨 profile 共用一份） |
| 渲染腳本             | `.claude/reference/sandboxes/scripts/render-profile.mjs`        |

**重要**：渲染腳本與樣板檔是所有 profile 共用的基礎設施，不隨 profile 複製——`render-profile.mjs` 讀 profile JSON 決定要在樣板的哪些 `{{TOKEN}}` 填什麼值，樣板本身不因 profile 而有多份。

---

## 核心 Schema（Sandbox Profile 必填/選填欄位）

所有 profile 文件必須在「Profile 摘要」表宣告以下欄位。具體值見各 profile 文件；欄位定義與型別如下：

| 欄位                               | 型別                                                                                                                                    | 必填                                 | 用途                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                               | string                                                                                                                                  | 必填                                 | Profile 識別碼；檔名主體 `.claude/reference/sandboxes/<id>.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `displayName`                      | string                                                                                                                                  | 必填                                 | 人類可讀標籤，格式為「執行環境 / 框架 / 主要依賴」，由 profile 作者依該專案實際技術棧填寫                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `stackSummary`                     | string                                                                                                                                  | 必填                                 | 一行技術棧描述，供登記表使用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `basedOn`                          | string \| null                                                                                                                          | 選填                                 | 此 profile 衍生自哪個既有 profile 的 id（延伸文件用）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `baseImage`                        | string                                                                                                                                  | 必填                                 | Dockerfile `FROM` 標籤                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `nonRootUser`                      | string                                                                                                                                  | 必填                                 | Dockerfile 建立的非 root 使用者；決定 devcontainer 的 `remoteUser`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `extraOsPackages`                  | string[]                                                                                                                                | 選填（預設 `[]`）                    | 超出通用 apt 基線（`bash ca-certificates dnsutils git iproute2 ipset iptables procps sudo`）之外需要的套件                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `packageManager`                   | enum（`npm｜pnpm｜yarn｜pip｜poetry｜go｜cargo｜maven｜gradle｜bundler｜nuget｜composer`）                                              | 必填                                 | 決定預設 registry 網域、cache 路徑、host 端指令黑名單預設值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `bootstrapCommand`                 | string                                                                                                                                  | 必填                                 | `--bootstrap` 執行的指令：安裝依賴，以及該技術棧在依賴安裝後必要的生成／遷移步驟（可用 `&&` 串接多步）                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `depsReadyMarkerPath`              | string                                                                                                                                  | 必填                                 | `ensure_deps()` 判斷依賴是否已安裝的哨兵檔路徑，如 `node_modules/.bin/eslint`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `depsCacheVolumes`                 | `{volumeName, containerPath}[]`                                                                                                         | 必填，至少 1 筆                      | 隔離依賴快取的具名 volume                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `resetDbCommand`                   | string \| null                                                                                                                          | 選填（預設 `null`）                  | `--reset-db` 指令；`null` 代表不支援                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `resetDbUnavailableReason`         | string                                                                                                                                  | `resetDbCommand` 為 `null` 時必填    | 說明為何不支援（如「此技術棧無遷移工具」）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `sidecarServices`                  | `{name, image, environment, healthcheck:{test,interval,timeout,retries}, containerPort?, volumeName?, volumeMountPath?, sandboxEnv?}[]` | 選填（預設 `[]`）                    | 零到多個 dev-dependency sidecar（如 Postgres）；`sandboxEnv` 為選填 `{KEY: value}` map，宣告主 sandbox 服務如何連到此 sidecar（如 `DATABASE_URL`）——由 profile 作者決定內容，渲染器不對特定資料庫/中介軟體做特殊判斷；`containerPort` 有提供時，`env-check.mjs` 會對該 sidecar 做 TCP 連通性 preflight；`volumeName`+`volumeMountPath` 需同時提供才會生成資料持久化 volume——**`volumeMountPath` 因映像而異必須由作者查該映像官方文件明確填寫**（如 postgres 為 `/var/lib/postgresql/data`、mysql 為 `/var/lib/mysql`、mongo 為 `/data/db`），渲染器不從 service name 猜測 |
| `verifyBundle`                     | `{step, command, skippable}[]`（有序）                                                                                                  | 必填，至少 1 筆                      | `--verify` 執行序列；同時驅動 `commands.md`／`testing.md` 對應段落（見 `commandsRuleDocSync`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `commandsRuleDocSync`              | boolean                                                                                                                                 | 必填（預設 `true`）                  | 是否同時寫入/更新目標專案 `.claude/rules/commands.md`＋`testing.md` 的驗證指令段落                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `diffCoverage`                     | `{tool, threshold(預設90), lcovPath(預設"coverage/lcov.info"), fileExemptionRules:{pattern,reason}[]}`                                  | 必填                                 | `--diff-cov` 設定；`tool` 為完整可執行指令（含直譯器前綴，如 `node sandbox/check-diff-coverage.mjs`），渲染器直接原樣拼接 `$*`，不自動補直譯器；`fileExemptionRules` 取代寫死的排除規則                                                                                                                                                                                                                                                                                                                                                                                   |
| `e2eCommand`                       | string \| null                                                                                                                          | 必填                                 | `--e2e` 指令；`null` 代表不支援                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `e2eUnsupportedAlternative`        | string                                                                                                                                  | `e2eCommand` 為 `null` 時必填        | 「改用 X」的說明文字（一等結果，非錯誤）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `additionalDispatchTargets`        | `{name, hostRelativePath, containerWorkdir, bootstrapCommandOverride?, verifyBundleOverride?, depsCacheVolumes}[]`                      | 選填（預設 `[]`）                    | 泛化 `DISPATCH_REPO=service｜web`；**限制：必須與本 profile 同 `baseImage`/`nonRootUser`**（同容器多 target，非真正多容器 polyglot）                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `firewallStackDomains`             | string[]                                                                                                                                | 必填                                 | 該套件管理器生態系的 registry 網域                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `firewallOptionalToggles`          | `{name, domains[], defaultOn}[]`                                                                                                        | 選填（預設 `[]`）                    | 具名開關，如 `{name:"github-remote-access", domains:[...], defaultOn:false}`——網域是否放行必須是明確選項，不可靜默預設                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `sddSkillGuardEnabled`             | boolean                                                                                                                                 | 選填（預設 `false`）                 | 軸 2 開關：guard 是否包含 6-skill／challenger-verifier 派發封鎖區塊                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `trackerCardInjectionGuardEnabled` | boolean                                                                                                                                 | 選填（預設 `false`）                 | 軸 3 開關：guard 是否包含 card-injection 檢查                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `trackerAdapterId`                 | string \| null                                                                                                                          | 上者為 `true` 時必填                 | 對應 `.claude/reference/adapters/<id>.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `hostBlockedCommands`              | string[]                                                                                                                                | 必填（依 `packageManager` 有預設值） | host 端 Bash 黑名單：該技術棧的**碼類指令**（套件管理器、執行器、測試 runner、編譯／型別檢查、DB 遷移工具等），一律引導進沙盒執行。清單由 profile 作者依 `packageManager` 與實際工具鏈列出；空清單會使該閘門整段不生成（渲染時會警告）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `postEditFormatter`                | `{command, extensions[]}` \| null                                                                                                       | 選填                                 | PostToolUse 格式化 hook；`null` 代表不生成該 hook 內容（no-op）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `postEditLinter`                   | `{command, extensions[]}` \| null                                                                                                       | 選填                                 | PostToolUse linter hook；`null` 代表不生成                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `typeEscapeHatchCheck`             | `{command, description}` \| null                                                                                                        | 選填（預設 `null`）                  | 型別逃生口檢查；多數語言無對應項，設 `null` 即可。`command` 須遵守 **linter 語義：命中逃生口時以非零 exit 結束**（以 grep 實作要反轉退出碼，如 `! grep -rnE '<pattern>' <dirs>`），生成的 `check-type-escape.sh` 直接執行它，樣板不預設任何語言的判準                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

---

## 通用固定常數（協定層級，不進 profile 欄位）

以下常數對所有 profile 一致，寫死在協定與樣板內，**不是**每個 profile 各自宣告：

**防火牆通用必要網域**（Claude Code 本身運作需要，與目標語言無關）：

```
api.anthropic.com
claude.ai
console.anthropic.com
statsig.anthropic.com
```

**不可傳播清單**（生成器與人工撰寫 profile 時均不可照抄以下項目視為可用參考實作）：

| 項目                            | 狀態                 | 說明                                                                                                                                                                                                                         |
| ------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/opt/fakebin` 雲端 CLI shim    | 空殼                 | `docker-compose.sandbox.yml` 的 `PATH` 曾預留給雲端 CLI（gcloud/gsutil/bq/aws）攔截 shim，但從未有對應建置腳本或 shim 實作——目前放進去等於無效字串，不要當成「已驗證的既有機制」照抄                                         |
| 容器內版 `dispatch-watchdog.sh` | 已知信任缺陷、已棄用 | 已被 `dispatch-watchdog-host.sh`（host 端執行）取代——容器內版本的 result 檔在沙盒可寫的掛載區，沙盒 agent 可偽造 `[DISPATCH-DONE]` 事件，破壞章戳鏈信任模型。**任何 profile 生成的沙盒只應包含 `dispatch-watchdog-host.sh`** |

---

## `verifyBundle` 與 `commandsRuleDocSync`

`verifyBundle` 是有序陣列，每筆 `{step, command, skippable}`：`step` 是人類可讀步驟名（如「型別逃生口檢查」「build」「單元測試+覆蓋率」），`command` 是實際 shell 指令片段，`skippable` 標記此步驟在目標語言沒有對應工具時是否可整段省略。

生成時這組陣列同時驅動兩個輸出：

1. `sandbox/dispatch.sh`（或等效渲染輸出）的 `--verify` case——用 `&&` 依序串接所有 `command`。
2. 若 `commandsRuleDocSync: true`：目標專案 `.claude/rules/commands.md` 與 `.claude/rules/testing.md` 對應段落也同步寫入同一份指令——避免現行已知缺口（`commands.md` 聲稱是「驗證指令唯一來源」，但 `dispatch.sh` 的 `--verify` 分支其實是另外寫死一份、兩邊沒有機制保證同步）。

## `diffCoverage.fileExemptionRules`

變動檔覆蓋率閘門的排除規則一律由 profile 宣告，**不在工具內寫死任何框架的檔案樣式**（測試檔、DI／接線檔、進入點檔在各框架的命名慣例都不同）。每筆 `{pattern, reason}`——`pattern` 是比對變動檔路徑的正則字串，`reason` 是排除理由（會原樣印進 SKIP 訊息，供人工核對排除是否合理，而非模型憑空判斷）。LCOV 解析與變動行比對演算法本身與語言無關，不需要 profile 化。

## `additionalDispatchTargets` 的限制與非目標

此欄位泛化的是同一容器內派工到不同工作目錄的模式（例如一個 repo 的後端 + 另一個 sibling repo 前端，透過 `DISPATCH_REPO=<name>` 切換）。它要求每個 target 與 profile 本身共用 `baseImage`／`nonRootUser`。

**明確不支援**：真正的多容器/多語言 polyglot 派工（例如同一次派工同時操作一個 Node 後端與一個 Go worker，各自不同 base image）。這需要 compose 檔內多個 `sandbox` 服務、各自獨立的防火牆初始化與 OS 套件——是比「config 化既有模式」大得多的變更，目前刻意排除在本協定範圍外。

---

## 擴充新 Profile

1. 透過 `/spex-sandbox-init` 建立 `.claude/reference/sandboxes/<id>.md`
2. 填齊「核心 Schema」全部必填欄位（選填欄位未提供則走預設值；`null` 型欄位需搭配對應的 `*UnavailableReason`/`*Alternative` 文字）
3. 執行 `render-profile.mjs --dry-run` 產生檔案清單並人工覆核（含斷言：輸出中不得出現「不可傳播清單」項目）
4. 更新本文件「Profile 文件清單」
5. `spex-sandbox-init` 本身**無需修改**，因為只使用本協定定義的欄位

---

## Profile 文件清單

| 文件 | 對應技術棧 | 狀態 |
| ---- | ---------- | ---- |
| （尚無範例，執行 `/spex-sandbox-init` 建立第一份） | — | — |
