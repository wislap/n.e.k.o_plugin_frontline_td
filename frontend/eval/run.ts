// Eval runner (ADR 0024): loads a scenario through Vite's SSR module loader
// so eval can reuse the src public barrels (extensionless TS imports) without
// a bundling step. Usage: node eval/run.ts eval/perf/movement.ts [args...]
import { argv } from 'node:process';
import { withViteSsr } from '../tooling/ssr';

const target = argv[2];
if (target === undefined) {
  throw new Error('usage: node eval/run.ts <scenario.ts> [args...]');
}

await withViteSsr(async (load) => {
  const mod = (await load(`/${target}`)) as {
    main?: (args: string[]) => void | Promise<void>;
  };
  if (typeof mod.main !== 'function') {
    throw new Error(`scenario '${target}' does not export main()`);
  }
  await mod.main(argv.slice(3));
});
