import { defineConfig, devices } from '@playwright/test';
import { chromiumGlArgs } from './tooling/browser-gl.ts';

const isCI = process.env['CI'] !== undefined;

// Serves the real production build in static/ (npm run build output)
// via `vite preview` — the e2e suite never uses the dev server.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // GPU rendering locally makes each test a few seconds, so one worker
  // per test. CI keeps 2: headless SwiftShader WebGL + SimWorker
  // browsers starve timers under multi-worker software rendering.
  workers: isCI ? 2 : 9,
  // Long mode-switch sequences approach 35s under software rendering.
  timeout: 60_000,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    // Real-GPU rendering locally (no-op under CI / non-Windows).
    launchOptions: { args: chromiumGlArgs() },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 30_000,
  },
});
