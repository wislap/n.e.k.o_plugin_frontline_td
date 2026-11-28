import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'src/core/index.ts',
    'src/kernel/index.ts',
    'src/content/index.ts',
    'src/protocol/index.ts',
    'eval/**/*.ts',
    'tooling/*.ts',
    '!tooling/**/*.test.ts',
  ],
  project: ['src/**/*.{ts,tsx}', 'tooling/**/*.ts', 'eval/**/*.ts'],
  ignore: ['tooling/fixtures/**'],
  includeEntryExports: true,
};

export default config;
