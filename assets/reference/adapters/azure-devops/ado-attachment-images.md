# ADO Work Item 附件圖片讀取指南

本文件記錄在 Claude Code 工作流中讀取 Azure DevOps Work Item 附件圖片的完整方法。
適用於所有需要解析 Work Item 需求圖示的 skills（spex-write-spec、spex-plan 等）。

**核心原則：暫存圖片以原始檔名儲存**，這樣 Claude 讀圖時能從檔名理解語意脈絡，
並與 Work Item 描述文字中的圖片說明對應。

---

## 背景

ADO Work Item 的 `System.Description` 以 HTML 格式儲存，圖片以 `<img src="...">` 內嵌，
URL 中包含原始檔名（URL encode 格式）：

```
https://dev.azure.com/{org}/{project}/_apis/wit/attachments/{UUID}?fileName=%E5%8F%B3%E5%81%B4...
                                                                               ↑ URL encoded 原始檔名
```

直接用 `WebFetch` 無法存取（需要驗證），必須透過 ADO REST API + PAT 下載後以 `Read` 工具讀取。

**PAT 來源**：Claude Code 全域設定 `~/.claude.json` 中的 `projects.<absolute-project-path>.mcpServers.azure-devops.env.AZURE_DEVOPS_PAT`

---

## 完整流程（逐步版）

### 步驟一：從描述 HTML 萃取附件 URL 與原始檔名

```bash
python3 -c "
import re, urllib.parse

description = '''<貼入 System.Description 原始 HTML>'''

pattern = r'(https://dev\.azure\.com/[^\"]+/_apis/wit/attachments/[a-f0-9-]{36})\?fileName=([^\"&\s]+)'
for url, encoded_name in re.findall(pattern, description):
    filename = urllib.parse.unquote(encoded_name)
    print(f'{filename}\t{url}')
"
```

輸出範例：

```text
登入頁面配色.png    https://dev.azure.com/<org>/.../attachments/363f8283-...
側邊選單展開狀態.png     https://dev.azure.com/<org>/.../attachments/ad641d8b-...
```

### 步驟二：取得 PAT（不在終端顯示原始值）

```bash
ADO_PAT=$(python3 -c "
import json, os
from pathlib import Path
with open(Path.home() / '.claude.json') as f:
    d = json.load(f)
print(d['projects'][os.getcwd()]['mcpServers']['azure-devops']['env']['AZURE_DEVOPS_PAT'], end='')
")
```

### 步驟三：以原始檔名下載至 `spex-temp/`

```bash
# 使用步驟一輸出的原始檔名與 URL
FILENAME="登入頁面配色.png"
ATTACH_URL="https://dev.azure.com/<org>/.../_apis/wit/attachments/<UUID>"

# scratch 區用時才建立（spex 不會預先建好這個資料夾）
mkdir -p spex-temp

curl -s -o "spex-temp/${FILENAME}" \
  -u ":${ADO_PAT}" \
  "${ATTACH_URL}?api-version=7.1"

# 確認下載成功（應顯示 PNG image data）
file "spex-temp/${FILENAME}"
```

> API endpoint 組成：取 `<img src>` 中的 URL，去掉 `?fileName=...` 後加 `?api-version=7.1`。

### 步驟四：以 Read 工具讀取（Claude Code 支援多模態）

```
Read("spex-temp/登入頁面配色.png")
```

Claude Code 的 `Read` 工具支援 PNG/JPG，可直接分析圖片內容。
**檔名即語意**：`登入頁面配色.png` 讓 Claude 在看圖前就知道這張圖描述的是登入頁面的配色設計。

### 步驟五：清理暫存（讀取完畢後立即執行）

讀完即刪，**連同 `spex-temp/` 資料夾一起移除**（scratch 區用後不留）：

```bash
rm -rf spex-temp/
```

---

## 批次下載腳本（推薦：一次處理 Work Item 所有圖片）

當 Work Item 描述含多張圖片時，使用此腳本一次取得全部，再逐張呼叫 `Read`：

```bash
python3 << 'PYEOF'
import re, urllib.parse, subprocess, json, os
from pathlib import Path

# ── 設定區 ──────────────────────────────────────────────
DESCRIPTION = """
<貼入 mcp__azure-devops__get_work_item 回傳的 System.Description HTML>
"""
# ─────────────────────────────────────────────────────────

with open(Path.home() / '.claude.json') as f:
    pat = json.load(f)['projects'][os.getcwd()]['mcpServers']['azure-devops']['env']['AZURE_DEVOPS_PAT']

pattern = r'(https://dev\.azure\.com/[^"]+/_apis/wit/attachments/[a-f0-9-]{36})\?fileName=([^"&\s]+)'
attachments = [
    (urllib.parse.unquote(name), f"{url}?api-version=7.1")
    for url, name in re.findall(pattern, DESCRIPTION)
]

os.makedirs('spex-temp', exist_ok=True)

for filename, api_url in attachments:
    out = f'spex-temp/{filename}'
    result = subprocess.run(
        ['curl', '-s', '-o', out, '-u', f':{pat}', api_url],
        capture_output=True
    )
    status = 'OK' if result.returncode == 0 else 'FAIL'
    print(f'[{status}] {filename}')

print('\n下一步：對每張圖呼叫 Read("spex-temp/<檔名>")，全部讀完後執行 rm -rf spex-temp/（連同資料夾移除）')
PYEOF
```

執行後輸出：

```text
[OK] 登入頁面配色.png
[OK] 側邊選單展開狀態.png

下一步：對每張圖呼叫 Read("spex-temp/<檔名>")，全部讀完後執行 rm -rf spex-temp/（連同資料夾移除）
```

接著依序呼叫：

```text
Read("spex-temp/登入頁面配色.png")
Read("spex-temp/側邊選單展開狀態.png")
```

讀完後清理（連同 scratch 資料夾一起刪）：

```bash
rm -rf spex-temp/
```

---

## 注意事項

| 項目 | 說明 |
|------|------|
| 檔名即語意 | 以原始檔名儲存，Claude 讀圖時能從檔名理解圖片用途，與描述文字對應 |
| `spex-temp/` | on-demand scratch 區：用時才 `mkdir`、讀完 `rm -rf` 連資料夾移除。已列入 `.gitignore`，暫存圖片不會進 git |
| PAT 格式 | `-u ":${PAT}"`，使用者名稱留空，密碼為 PAT |
| 空格處理 | 含空格的檔名在 bash 中需加引號或跳脫：`"側邊選單展開狀態.png"` |
| 若 `~/.claude.json` 該 project 無設定 | 請使用者手動提供 PAT，或設定 `AZURE_DEVOPS_PAT` 環境變數 |
| 權限設定 | 若使用權限白名單，需允許 `Bash(mkdir *)`、`Bash(curl *)` 與 `Bash(rm -rf spex-temp*)` |

---

## 相關文件

- [ado.md](./ado.md) — ADO Adapter 完整操作協定（含 `ADO.readAttachment` 詳細說明）
- [README.md](../README.md) — Tracker Adapter 抽象介面
