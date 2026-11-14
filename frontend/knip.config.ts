import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['tooling/*.ts', '!tooling/**/*.test.ts'],
  project: ['src/**/*.{ts,tsx}', 'tooling/**/*.ts'],
  ignore: ['tooling/fixtures/**'],
};

export default config;
