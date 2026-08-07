import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
import type { ConfigOptions } from '@nuxt/test-utils/playwright'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig<ConfigOptions>({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  use: {
    nuxt: {
      rootDir,
      // Set NUXT_E2E_HOST (e.g. http://127.0.0.1:3000) to reuse an already-running server.
      host: process.env.NUXT_E2E_HOST,
    },
  },
})
