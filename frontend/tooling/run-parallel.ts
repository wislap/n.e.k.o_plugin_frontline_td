/**
 * run-parallel: run npm scripts concurrently.
 *
 * Each argument is an npm script name (from package.json). All scripts
 * are spawned at once; each script's output is buffered and printed as
 * a group when it finishes, then a summary table closes the run.
 * Exits non-zero if any script failed.
 *
 * Usage: node tooling/run-parallel.ts typecheck lint test ...
 */
import { spawn } from 'node:child_process';

interface Result {
  name: string;
  ms: number;
  code: number;
  output: string;
}

function runScript(name: string): Promise<Result> {
  return new Promise((resolve) => {
    const started = Date.now();
    // A single command string via shell resolves npm(.cmd) on every
    // platform; args-array + shell is deprecated (DEP0190).
    const proc = spawn(`npm run ${name} --silent`, { shell: true, env: process.env });
    const chunks: Buffer[] = [];
    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.stderr.on('data', (d: Buffer) => chunks.push(d));
    proc.on('close', (code) => {
      resolve({
        name,
        ms: Date.now() - started,
        code: code ?? 1,
        output: Buffer.concat(chunks).toString('utf8'),
      });
    });
    proc.on('error', (err) => {
      resolve({ name, ms: Date.now() - started, code: 1, output: String(err) });
    });
  });
}

const names = process.argv.slice(2);
if (names.length === 0) {
  console.error('usage: run-parallel.ts <npm-script> [<npm-script>...]');
  process.exit(2);
}
for (const name of names) {
  if (!/^[\w:-]+$/.test(name)) {
    console.error(`invalid script name '${name}'`);
    process.exit(2);
  }
}

const total = Date.now();
const results = await Promise.all(names.map(runScript));

for (const r of results) {
  const status = r.code === 0 ? 'ok' : `FAILED (${r.code})`;
  console.log(`\n=== ${r.name} — ${r.ms}ms ${status} ===`);
  if (r.output.trim() !== '') {
    console.log(r.output.trimEnd());
  }
}

console.log('\n=== summary ===');
const byMs = [...results].sort((a, b) => b.ms - a.ms);
for (const r of byMs) {
  console.log(
    `${r.name.padEnd(20)} ${String(r.ms).padStart(7)}ms ${r.code === 0 ? 'ok' : 'FAILED'}`,
  );
}
console.log(`${'total'.padEnd(20)} ${String(Date.now() - total).padStart(7)}ms`);

if (results.some((r) => r.code !== 0)) {
  process.exit(1);
}
