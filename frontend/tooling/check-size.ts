// Bundle-size guard for the static output (tooling/check-size.ts):
// - hard fail over 32 MiB total,
// - warning over 24 MiB.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIB = 1024 * 1024;
export const WARN_BYTES = 24 * MIB;
export const FAIL_BYTES = 32 * MIB;

function totalBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += totalBytes(full);
    } else if (entry.isFile()) {
      total += statSync(full).size;
    }
  }
  return total;
}

function format(bytes: number): string {
  return `${(bytes / MIB).toFixed(2)} MiB`;
}

export function main(staticDir: string): number {
  const total = totalBytes(staticDir);
  if (total > FAIL_BYTES) {
    console.error(`check-size: ${staticDir} is ${format(total)}; limit is ${format(FAIL_BYTES)}`);
    return 1;
  }
  if (total > WARN_BYTES) {
    console.warn(`check-size: ${staticDir} is ${format(total)}; warning at ${format(WARN_BYTES)}`);
    return 0;
  }
  console.log(`check-size: ${staticDir} is ${format(total)}`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(fileURLToPath(new URL('../../static', import.meta.url)));
}
