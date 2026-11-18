import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../static',
    emptyOutDir: true,
    assetsDir: 'app',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    // Two tiers: `unit` (fast, everything) and `scenario` (full-match /
    // property tests named *.scenario.test.ts, may run whole matches).
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}', 'tooling/**/*.test.ts', 'eval/**/*.test.ts'],
          exclude: ['**/*.scenario.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'scenario',
          environment: 'node',
          include: [
            'src/**/*.scenario.test.{ts,tsx}',
            'tooling/**/*.scenario.test.ts',
            'eval/**/*.scenario.test.ts',
          ],
        },
      },
    ],
  },
});
