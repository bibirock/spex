import type { McpServerDefinition } from '../installers/base.js';

/**
 * 可安裝的 MCP server 目錄。
 * 不包含任何 token：
 * - PAT / API key 在 settings 內以 ${VAR} 佔位（Claude Code 慣例）
 * - 實際值由使用者寫到 shell 環境（~/.zshrc / ~/.bashrc / CI Secret Manager）
 * - 禁止寫入專案內任何檔案，避免 token 落檔
 */
export const MCP_SERVERS: McpServerDefinition[] = [
  {
    id: 'azure-devops',
    description: 'Azure DevOps — 讀寫 work item、PR、pipeline 等',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@tiberriver256/mcp-server-azure-devops'],
    env: {
      AZURE_DEVOPS_ORG_URL: 'https://dev.azure.com/<your-org>',
      AZURE_DEVOPS_AUTH_METHOD: 'pat',
      AZURE_DEVOPS_PAT: '${AZURE_DEVOPS_PAT}',
      AZURE_DEVOPS_DEFAULT_PROJECT: '<your-project>',
    },
    envVars: [
      {
        name: 'AZURE_DEVOPS_PAT',
        description: 'Personal Access Token（Work Items R/W、Code R/W）',
        helpUrl: 'https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate',
      },
    ],
    defaultEnabled: true,
  },
  {
    id: 'stackoverflow',
    description: 'Stack Overflow — 搜尋技術問題',
    transport: 'http',
    url: 'https://mcp.stackoverflow.com',
    defaultEnabled: true,
  },
  {
    id: 'github',
    description: 'GitHub — issue、PR、code search（需 PAT）',
    transport: 'http',
    url: 'https://api.githubcopilot.com/mcp',
    headers: {
      Authorization: 'Bearer ${GITHUB_PAT}',
    },
    envVars: [
      {
        name: 'GITHUB_PAT',
        description: 'GitHub Personal Access Token（repo / issue / PR 權限）',
        helpUrl: 'https://github.com/settings/tokens',
      },
    ],
    defaultEnabled: true,
  },
  {
    id: 'figma',
    // 官方遠端 server（Figma 推薦），相較桌面版功能最完整且免裝 Figma desktop app。
    // 認證走 Figma OAuth：由 MCP client 互動式登入並自行管理 token，
    // 故不需 ${VAR} 佔位、headers 或 envVars——天然符合「token 不落檔」政策。
    // 桌面版替代方案：本機 http://127.0.0.1:3845/mcp（需開啟 Figma desktop 的 Dev Mode）。
    description: 'Figma — 讀取設計檔、Dev Mode 規格與產生程式碼（官方遠端 server，OAuth 登入）',
    transport: 'http',
    url: 'https://mcp.figma.com/mcp',
    defaultEnabled: false,
  },
  {
    id: 'playwright',
    description: 'Playwright — 透過瀏覽器自動化執行 UI 驗證（選用；測試工具由 rules/testing.md 決定）',
    transport: 'stdio',
    command: 'npx',
    args: ['@playwright/mcp@latest'],
    env: {},
    defaultEnabled: false,
  },
];

export function getServerById(id: string): McpServerDefinition | undefined {
  return MCP_SERVERS.find((s) => s.id === id);
}
