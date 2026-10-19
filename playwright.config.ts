import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/ui', timeout: 20_000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4178', viewport: { width: 1160, height: 850 },
    launchOptions: { executablePath: process.env.OPENCOOKIE_CHROME || undefined }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/preview.mjs', url: 'http://127.0.0.1:4178/renderer/index.html', reuseExistingServer: false }
});
