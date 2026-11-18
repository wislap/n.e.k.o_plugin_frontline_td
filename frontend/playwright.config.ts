import { defineConfig, devices } from '@playwright/test';

// Serves the real production build in static/ (npm run build output)
// via `vite preview` — the e2e suite never uses the dev server.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 30_000,
  },
});
