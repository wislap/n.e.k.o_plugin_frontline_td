import type { IConfiguration } from 'dependency-cruiser';

const CORE = 'src/core/';
const KERNEL = 'src/kernel/';
const CONTENT = 'src/content/';
const PROTOCOL = 'src/protocol/';

// Feature-relative escape hatches used in the sim / rules rules below.
const SIM_PUBLIC =
  'src/features/[^/]+/(sim/index[.]ts|rules/index[.]ts|protocol[.]ts|content[.]ts)';
const RULES_PUBLIC = 'src/features/[^/]+/(rules/index[.]ts|protocol[.]ts|content[.]ts)';
const CROSS_FEATURE_PUBLIC =
  'src/features/[^/]+/(sim/index[.]ts|rules/index[.]ts|render/index[.]tsx?|ui/index[.]tsx?|protocol[.]ts|content[.]ts)';

// Client-side directories that must never reach the simulation layer.
const CLIENT_SIDE =
  'src/(features/[^/]+/(render|ui)|modes/[^/]+/ui|client|input|render|ui|host|i18n)/';

const config: IConfiguration = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'R1: circular dependencies are forbidden (ADR 0007).',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'Imports must resolve to a real module.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'core-is-leaf',
      severity: 'error',
      comment: 'R2: src/core may only import other src/core modules (ADR 0007).',
      from: { path: `^${CORE}` },
      to: { path: '^src/', pathNot: `^${CORE}` },
    },
    {
      name: 'kernel-deps',
      severity: 'error',
      comment: 'R3: src/kernel may only import src/core and src/kernel (ADR 0007).',
      from: { path: `^${KERNEL}` },
      to: {
        path: '^src/',
        pathNot: `^(${CORE}|${KERNEL})`,
      },
    },
    {
      name: 'sim-deps',
      severity: 'error',
      comment:
        'R4: features/<x>/sim may import core, kernel, content, the same feature' +
        " (sim/, rules/, content.ts, protocol.ts) and other features' public" +
        ' sim/index.ts / rules/index.ts / protocol.ts / content.ts (ADR 0007).',
      from: { path: '^src/features/([^/]+)/sim/' },
      to: {
        path: '^src/',
        pathNot:
          `^(${CORE}|${KERNEL}|${CONTENT}|src/testing/|` +
          'src/features/$1/(sim|rules)/|' +
          'src/features/$1/(content|protocol)[.]ts|' +
          `${SIM_PUBLIC})`,
      },
    },
    {
      name: 'rules-deps',
      severity: 'error',
      comment:
        'R5: features/<x>/rules may import core, content, the same feature' +
        " rules/, and any feature's protocol.ts / content.ts / rules/index.ts" +
        ' (ADR 0007).',
      from: { path: '^src/features/([^/]+)/rules/' },
      to: {
        path: '^src/',
        pathNot: `^(${CORE}|${CONTENT}|` + 'src/features/$1/rules/|' + `${RULES_PUBLIC})`,
      },
    },
    {
      name: 'client-not-to-sim',
      severity: 'error',
      comment:
        'R6: client-side code (features render/ui, client, input, render, ui,' +
        ' host, i18n) must not import sim/, kernel/ or runtime/ (ADR 0007).',
      from: { path: `^${CLIENT_SIDE}` },
      to: { path: '^src/(features/[^/]+/sim|kernel|runtime)/' },
    },
    {
      name: 'cross-feature-public-only',
      severity: 'error',
      comment:
        'R7: imports into a different feature may only target its public' +
        ' files (sim/index.ts, rules/index.ts, render/index.ts(x),' +
        ' ui/index.ts(x), protocol.ts, content.ts) (ADR 0007).',
      from: { path: '^src/features/([^/]+)/' },
      to: {
        path: '^src/features/',
        pathNot: `^(src/features/$1/|${CROSS_FEATURE_PUBLIC})`,
      },
    },
    {
      name: 'shell-not-to-features',
      severity: 'error',
      comment:
        'R10: the client shell (render/, ui/, client/, input/) must not import' +
        ' features/* — type-only imports and tests included; feature wiring' +
        ' happens in src/app (ADR 0062).',
      from: { path: '^src/(render|ui|client|input)/' },
      to: { path: '^src/features/' },
    },
    {
      name: 'not-to-app',
      severity: 'error',
      comment: 'R8: only src/app may import src/app; app assembles everything.',
      from: { path: '^src/', pathNot: '^src/app/' },
      to: { path: '^src/app/' },
    },
    {
      name: 'no-npm-in-sim-layer',
      severity: 'error',
      comment:
        'R9: core, content, protocol and features sim/rules may not import' +
        ' npm packages; kernel may only import bitecs (ADR 0007/0009).',
      from: {
        path: `^(${CORE}|${CONTENT}|${PROTOCOL}|src/features/[^/]+/(sim|rules)/)`,
      },
      to: { dependencyTypes: ['npm'] },
    },
    {
      name: 'kernel-npm-only-bitecs',
      severity: 'error',
      comment: 'R9: src/kernel may only import the bitecs npm package (ADR 0009).',
      from: { path: `^${KERNEL}` },
      to: { dependencyTypes: ['npm'], pathNot: 'node_modules/bitecs/' },
    },
    {
      name: 'three-only-in-render',
      severity: 'error',
      comment:
        'three/@react-three may only be imported under src/render/,' +
        ' src/features/*/render/, and src/app/ (M2 C0).',
      from: {
        path: '^src/',
        pathNot: '^(src/render/|src/features/[^/]+/render/|src/app/)',
      },
      to: { path: 'node_modules/(three|@react-three)/' },
    },
    {
      name: 'not-to-modes',
      severity: 'error',
      comment:
        'Modes are gameplay-specific code; only src/app and src/modes itself' +
        ' may import them (ADR 0019).',
      from: { path: '^src/', pathNot: '^src/(app|modes)/' },
      to: { path: '^src/modes/' },
    },
    {
      name: 'modes-public-only',
      severity: 'error',
      comment:
        'Modes may only consume features through the cross-feature public' +
        ' files (sim/index.ts, rules/index.ts, render/ui index, protocol.ts,' +
        ' content.ts) (ADR 0019).',
      from: { path: '^src/modes/' },
      to: { path: '^src/features/', pathNot: `^${CROSS_FEATURE_PUBLIC}` },
    },
    {
      name: 'no-node-builtins-in-src',
      severity: 'error',
      comment: 'R10: src/ must not import Node.js built-in modules.',
      from: { path: '^src/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'src-not-to-tooling',
      severity: 'error',
      comment: 'R11: src/ must not import tooling/.',
      from: { path: '^src/' },
      to: { path: '^tooling/' },
    },
    {
      name: 'src-not-to-eval',
      severity: 'error',
      comment: 'eval/ is a Node-side harness; src/ must never import it (ADR 0024).',
      from: { path: '^src/' },
      to: { path: '^eval/' },
    },
    {
      name: 'testing-imports',
      severity: 'error',
      comment:
        'R12: src/testing/ is test-only: importers must be *.test.ts(x)' +
        ' or **/test-world.ts (ADR 0043).',
      from: {
        path: '^src/',
        pathNot: '(\\.test\\.tsx?$|test-world\\.ts$|^src/testing/)',
      },
      to: { path: '^src/testing/' },
    },
    {
      name: 'testing-deps',
      severity: 'error',
      comment:
        'R12: src/testing/ may only import the public entry points tests' +
        ' use: core/kernel/content/protocol index.ts, features sim/index.ts' +
        ' / rules/index.ts / protocol.ts / content.ts (ADR 0043).',
      from: { path: '^src/testing/' },
      to: {
        path: '^src/',
        pathNot:
          '^src/(core|kernel|content|protocol)/index[.]ts$|' +
          '^src/features/[^/]+/(sim/index|rules/index|protocol|content)[.]ts$',
      },
    },
    {
      name: 'eval-src-public-only',
      severity: 'error',
      comment:
        'eval/ may only import the public barrels: core/kernel/content/' +
        "protocol index.ts, features' sim/index.ts / rules/index.ts /" +
        ' protocol.ts / content.ts, app/resolve-setup.ts (match assembly)' +
        ' and modes/*/index.ts (mode setups) (ADR 0024).',
      from: { path: '^eval/' },
      to: {
        path: '^src/',
        pathNot:
          '^src/(core|kernel|content|protocol)/index[.]ts$|' +
          '^src/features/[^/]+/(sim/index|rules/index|protocol|content)[.]ts$|' +
          '^src/app/resolve-setup[.]ts$|' +
          '^src/modes/[^/]+/index[.]ts$',
      },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
      mainFields: ['module', 'main', 'types'],
    },
  },
};

export default config;
