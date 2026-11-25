/**
 * check-styles: no raw colour literals in component stylesheets.
 *
 * Every `src/**\/*.module.css` must reference colours through the
 * semantic custom properties in `src/ui/styles/tokens.css` — hex
 * (#abc/#aabbcc/#aabbccdd), rgb()/rgba() and hsl()/hsla() literals are
 * rejected there. `tokens.css` itself is the exempt source of truth.
 *
 * Usage: node tooling/check-styles.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SRC_ROOT = path.resolve(import.meta.dirname, '..', 'src');

const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\s*\(/;

function collectModuleCss(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectModuleCss(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.module.css')) {
      out.push(full);
    }
  }
  return out;
}

const violations: string[] = [];
for (const file of collectModuleCss(SRC_ROOT)) {
  const rel = path.relative(SRC_ROOT, file).split(path.sep).join('/');
  readFileSync(file, 'utf-8')
    .split('\n')
    .forEach((line, i) => {
      if (LITERAL.test(line)) {
        violations.push(`${rel}:${i + 1}: ${line.trim()}`);
      }
    });
}

if (violations.length > 0) {
  console.error(
    `check-styles FAILED — ${violations.length} colour literal(s) in *.module.css` +
      ` (use the tokens in ui/styles/tokens.css):`,
  );
  for (const v of violations) {
    console.error(`  ${v}`);
  }
  process.exit(1);
}
console.log('check-styles OK — no colour literals in *.module.css');
