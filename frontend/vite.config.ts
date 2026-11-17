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
    include: ['src/**/*.test.{ts,tsx}', 'tooling/**/*.test.ts', 'eval/**/*.test.ts'],
  },
});
