import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'src/core/index.ts',
    'src/kernel/index.ts',
    'src/content/index.ts',
    'src/protocol/index.ts',
    'src/client/index.ts',
    'tooling/*.ts',
    '!tooling/**/*.test.ts',
  ],
  project: ['src/**/*.{ts,tsx}', 'tooling/**/*.ts'],
  ignore: ['tooling/fixtures/**'],
};

export default config;
