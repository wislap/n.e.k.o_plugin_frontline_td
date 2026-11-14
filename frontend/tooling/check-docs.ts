/**
 * check-docs: repository documentation hygiene checks.
 *
 * a) Markdown whitelist over `git ls-files --cached --others --exclude-standard`
 *    run at the plugin root.
 * b) Every relative markdown link target in whitelisted files must exist.
 * c) AGENTS.md must stay under 150 lines.
 *
 * Usage: node tooling/check-docs.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..', '..');

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

export function isWhitelisted(repoRelativePath: string): boolean {
  return WHITELIST.some((pattern) => pattern.test(repoRelativePath));
}

export function listFiles(root: string): string[] {
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

export function findBrokenLinks(root: string, repoRelativePath: string): string[] {
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
