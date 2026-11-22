import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'src/core/index.ts',
    'src/kernel/index.ts',
    'src/content/index.ts',
    'src/protocol/index.ts',
    'src/features/*/sim/index.ts',
    'src/features/*/render/index.ts',
    'eval/**/*.ts',
    'tooling/*.ts',
    '!tooling/**/*.test.ts',
  ],
  project: ['src/**/*.{ts,tsx}', 'tooling/**/*.ts', 'eval/**/*.ts'],
  ignore: ['tooling/fixtures/**'],
  // Runtime peer of @react-three/postprocessing's <N8AO> — imported inside
  // that package, so knip cannot see the usage directly.
  ignoreDependencies: ['n8ao'],
  includeEntryExports: true,
};

export default config;
