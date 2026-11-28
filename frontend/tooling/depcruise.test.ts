import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { IConfiguration, ICruiseResult, IViolation } from 'dependency-cruiser';

const FRONTEND_ROOT = path.resolve(import.meta.dirname, '..');
const FIXTURE_ROOT = path.join(FRONTEND_ROOT, 'tooling', 'fixtures', 'depcruise');

let violations: IViolation[] = [];

beforeAll(async () => {
  const { cruise } = await import('dependency-cruiser');
  const configUrl = pathToFileURL(path.join(FRONTEND_ROOT, 'dependency-cruiser.config.ts')).href;
  const { default: config } = (await import(configUrl)) as { default: IConfiguration };
  const result = await cruise(['src'], {
    ruleSet: config,
    validate: true,
    baseDir: FIXTURE_ROOT,
  });
  violations = (result.output as ICruiseResult).summary.violations;
}, 60_000);

function ruleNamesFor(fromPattern: RegExp): string[] {
  return violations.filter((v) => fromPattern.test(v.from)).map((v) => v.rule.name);
}

describe('dependency rules on the fixture tree', () => {
  it.each([
    ['no-circular', /misc\/a\.ts/],
    ['core-is-leaf', /core\/leak\.ts/],
    ['kernel-deps', /kernel\/leak\.ts/],
    ['sim-deps', /features\/f1\/sim\/leak\.ts/],
    ['rules-deps', /features\/f1\/rules\/leak\.ts/],
    ['client-not-to-sim', /features\/f1\/render\/leak_sim\.ts/],
    ['client-not-to-sim', /modes\/m1\/ui\/leak_sim\.ts/],
    ['client-not-to-sim', /dev\/leak_sim\.ts/],
    ['shell-not-to-features', /dev\/leak_feature\.ts/],
    ['cross-feature-public-only', /features\/f1\/render\/leak_private\.ts/],
    ['not-to-app', /client\/bad_app\.ts/],
    ['no-npm-in-sim-layer', /core\/npm\.ts/],
    ['kernel-npm-only-bitecs', /kernel\/npmbad\.ts/],
    ['no-node-builtins-in-src', /client\/bad_node\.ts/],
    ['src-not-to-tooling', /client\/bad_tooling\.ts/],
    ['not-to-unresolvable', /client\/bad_unresolvable\.ts/],
    ['not-to-modes', /client\/bad_mode\.ts/],
    ['three-only-in-render', /client\/bad_three\.ts/],
    ['no-three-reachable-outside-render', /client\/bad_transitive_three\.ts/],
    ['no-three-reachable-outside-render', /features\/f1\/ui\/leak_render\.ts/],
    ['ui-not-to-render', /ui\/bad_render\.ts/],
    ['ui-not-to-render', /features\/f1\/ui\/leak_render\.ts/],
    ['no-cross-feature-render', /features\/f1\/render\/leak_cross_render\.ts/],
    ['modes-public-only', /modes\/m1\/leak\.ts/],
  ])('flags %s', (ruleName, fromPattern) => {
    expect(ruleNamesFor(fromPattern)).toContain(ruleName);
  });

  it.each([
    'src/core/util.ts',
    'src/kernel/x.ts',
    'src/kernel/bitecs.ts',
    'src/features/f1/sim/ok.ts',
    'src/features/f1/rules/r.ts',
    'src/features/f1/render/ok.ts',
    'src/render/r.ts',
    'src/app/x.ts',
    'src/app/use_mode.ts',
    'src/modes/m1/ok.ts',
    'src/client/c.ts',
  ])('does not flag allowed imports from %s', (from) => {
    expect(
      violations.filter((v) => v.from === from),
      `expected no violations from ${from}`,
    ).toEqual([]);
  });
});
