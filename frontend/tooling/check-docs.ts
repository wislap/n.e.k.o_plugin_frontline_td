/**
 * check-docs: repository documentation hygiene checks.
 *
 * a) Markdown whitelist over `git ls-files --cached --others --exclude-standard`
 *    run at the plugin root.
 * b) Every relative markdown link target in whitelisted files must exist.
 * c) AGENTS.md must stay under 150 lines.
 * d) Every `frontend/src/features/<name>/` directory must contain a
 *    README.md whose `##` headings are exactly FEATURE_README_HEADINGS
 *    in order.
 *
 * Usage: node tooling/check-docs.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..', '..');

const WHITELIST: RegExp[] = [
  /^(AGENTS|CLAUDE|README|CONTRIBUTING)\.md$/,
  /^docs\/design\//,
  /^docs\/adr\//,
  /^docs\/guides\//,
  /^docs\/generated\//,
  /^frontend\/src\/features\/[^/]+\/README\.md$/,
  /^\.github\/.*\.md$/,
];

const AGENTS_MAX_LINES = 150;
const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
const H2_RE = /^## .+$/gm;

export const FEATURE_README_HEADINGS = [
  '## 职责',
  '## 公开接口',
  '## 拥有的组件',
  '## 不变量',
  '## 对应设计',
];

// Returns an error string when the README's `##` headings differ from
// FEATURE_README_HEADINGS (missing, extra, or out of order).
export function checkFeatureReadme(readmeText: string): string | null {
  const headings = readmeText.match(H2_RE) ?? [];
  const expected = FEATURE_README_HEADINGS.join(' → ');
  if (headings.length !== FEATURE_README_HEADINGS.length) {
    return `expected ${FEATURE_README_HEADINGS.length} sections (${expected}), found ${headings.length}`;
  }
  for (let i = 0; i < FEATURE_README_HEADINGS.length; i++) {
    if (headings[i] !== FEATURE_README_HEADINGS[i]) {
      return `section ${i + 1} is '${headings[i]}', expected '${FEATURE_README_HEADINGS[i]}' (order: ${expected})`;
    }
  }
  return null;
}

function isWhitelisted(repoRelativePath: string): boolean {
  return WHITELIST.some((pattern) => pattern.test(repoRelativePath));
}

function listFiles(root: string): string[] {
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function isExternalTarget(target: string): boolean {
  return /^(https?:|mailto:)/i.test(target) || target.startsWith('#');
}

function findBrokenLinks(root: string, repoRelativePath: string): string[] {
  const filePath = path.join(root, repoRelativePath);
  const text = readFileSync(filePath, 'utf8');
  const broken: string[] = [];
  for (const match of text.matchAll(LINK_RE)) {
    const raw = match[1] ?? '';
    const target = raw.split('#')[0] ?? '';
    if (target === '' || isExternalTarget(raw)) {
      continue;
    }
    const resolved = path.resolve(path.dirname(filePath), decodeURIComponent(target));
    if (!existsSync(resolved)) {
      broken.push(raw);
    }
  }
  return broken;
}

export function checkDocs(root: string = PLUGIN_ROOT): string[] {
  const errors: string[] = [];
  const files = listFiles(root);
  const markdownFiles = files.filter((file) => file.endsWith('.md'));

  for (const file of markdownFiles) {
    if (!isWhitelisted(file)) {
      errors.push(`${file}: markdown file outside the whitelist`);
    }
  }

  for (const file of markdownFiles.filter(isWhitelisted)) {
    for (const broken of findBrokenLinks(root, file)) {
      errors.push(`${file}: broken link '${broken}'`);
    }
  }

  const agentsPath = path.join(root, 'AGENTS.md');
  if (existsSync(agentsPath)) {
    const lineCount = readFileSync(agentsPath, 'utf8').split('\n').length;
    if (lineCount > AGENTS_MAX_LINES) {
      errors.push(`AGENTS.md: ${lineCount} lines exceeds the ${AGENTS_MAX_LINES}-line limit`);
    }
  }

  const featuresDir = path.join(root, 'frontend', 'src', 'features');
  if (existsSync(featuresDir)) {
    for (const entry of readdirSync(featuresDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const readmePath = path.join(featuresDir, entry.name, 'README.md');
      if (!existsSync(readmePath)) {
        errors.push(`frontend/src/features/${entry.name}: missing README.md`);
        continue;
      }
      const problem = checkFeatureReadme(readFileSync(readmePath, 'utf8'));
      if (problem !== null) {
        errors.push(`frontend/src/features/${entry.name}/README.md: ${problem}`);
      }
    }
  }

  return errors;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = checkDocs();
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log('check-docs: ok');
}
