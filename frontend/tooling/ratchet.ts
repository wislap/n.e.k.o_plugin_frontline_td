/**
 * ratchet: code-health metrics that may only improve.
 *
 * Metrics are counted over frontend/src and frontend/tooling (fixtures
 * excluded) and compared against ratchet.json:
 *   ratchet            fail if any metric regressed; also fail if a metric
 *                      improved without the baseline being updated
 *   ratchet --update   write current values to ratchet.json; refuses to raise
 *                      a baseline unless --allow-increase is also passed
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const FRONTEND_ROOT = path.resolve(import.meta.dirname, '..');
export const BASELINE_PATH = path.join(FRONTEND_ROOT, 'ratchet.json');
const SCANNED_DIRS = ['src', 'tooling'];
const LONG_FILE_LINES = 400;

export interface Metrics {
  asAny: number;
  tsIgnore: number;
  tsExpectError: number;
  eslintDisable: number;
  longFiles: number;
}

export const METRIC_NAMES = Object.keys({
  asAny: 0,
  tsIgnore: 0,
  tsExpectError: 0,
  eslintDisable: 0,
  longFiles: 0,
} satisfies Metrics) as (keyof Metrics)[];

function* sourceFiles(root: string): Generator<string> {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'fixtures' || entry.name === 'node_modules') {
        continue;
      }
      yield* sourceFiles(full);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      yield full;
    }
  }
}

export function countInText(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

const PATTERNS = {
  asAny: /\bas\s+any\b/g,
  tsIgnore: /@ts-(?:ignore)\b/g,
  tsExpectError: /@ts-(?:expect-error)\b/g,
  eslintDisable: /eslint-(?:disable)(?:-next-line|-line)?\b/g,
} as const;

export function measure(frontendRoot: string = FRONTEND_ROOT): Metrics {
  const metrics: Metrics = {
    asAny: 0,
    tsIgnore: 0,
    tsExpectError: 0,
    eslintDisable: 0,
    longFiles: 0,
  };
  for (const dir of SCANNED_DIRS) {
    for (const file of sourceFiles(path.join(frontendRoot, dir))) {
      const text = readFileSync(file, 'utf8');
      metrics.asAny += countInText(text, PATTERNS.asAny);
      metrics.tsIgnore += countInText(text, PATTERNS.tsIgnore);
      metrics.tsExpectError += countInText(text, PATTERNS.tsExpectError);
      metrics.eslintDisable += countInText(text, PATTERNS.eslintDisable);
      if (text.split('\n').length > LONG_FILE_LINES) {
        metrics.longFiles += 1;
      }
    }
  }
  return metrics;
}

export function readBaseline(baselinePath: string = BASELINE_PATH): Metrics {
  return JSON.parse(readFileSync(baselinePath, 'utf8')) as Metrics;
}

export function compare(current: Metrics, baseline: Metrics): string[] {
  const problems: string[] = [];
  for (const name of METRIC_NAMES) {
    if (current[name] > baseline[name]) {
      problems.push(`${name}: ${current[name]} > baseline ${baseline[name]} (regression)`);
    } else if (current[name] < baseline[name]) {
      problems.push(
        `${name}: ${current[name]} < baseline ${baseline[name]}; ` +
          'run npm run ratchet:update to lock in the improvement',
      );
    }
  }
  return problems;
}

export function run(argv: string[], frontendRoot: string = FRONTEND_ROOT): number {
  const baselinePath = path.join(frontendRoot, 'ratchet.json');
  const current = measure(frontendRoot);

  if (argv.includes('--update')) {
    const baseline = readBaseline(baselinePath);
    const allowIncrease = argv.includes('--allow-increase');
    const increases = METRIC_NAMES.filter((name) => current[name] > baseline[name]);
    if (increases.length > 0 && !allowIncrease) {
      for (const name of increases) {
        console.error(
          `${name}: refusing to raise baseline ${baseline[name]} -> ${current[name]} ` +
            '(pass --allow-increase with a PR justification)',
        );
      }
      return 1;
    }
    writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    console.log('ratchet baseline updated');
    return 0;
  }

  const problems = compare(current, readBaseline(baselinePath));
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`- ${problem}`);
    }
    return 1;
  }
  console.log('ratchet: ok');
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(run(process.argv.slice(2)));
}
