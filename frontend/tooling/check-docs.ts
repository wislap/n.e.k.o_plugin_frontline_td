/**
 * check-docs: repository documentation hygiene checks.
 *
 * a) Markdown whitelist over `git ls-files --cached --others --exclude-standard`
 *    run at the plugin root.
 * b) Every relative markdown link target in whitelisted files must exist.
 * c) AGENTS.md must stay under 150 lines.
 * d) Every `frontend/src/features/<name>/` directory must contain a
 *    README.md whose `##` headings are exactly FEATURE_README_HEADINGS
 *    in order, that is at most FEATURE_README_MAX_LINES lines long and
 *    has no line longer than FEATURE_README_MAX_COLS characters, and
 *    whose 对应设计 section only references docs via Markdown links
 *    (ADR 0061).
 *
 * Usage: node tooling/check-docs.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { splitLines } from './ratchet.ts';

const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..', '..');

const WHITELIST: RegExp[] = [
  /^(AGENTS|CLAUDE|README|CONTRIBUTING)\.md$/,
  /^docs\/design\//,
  /^docs\/adr\//,
  /^docs\/generated\//,
  /^frontend\/src\/features\/[^/]+\/README\.md$/,
  /^\.github\/.*\.md$/,
];

const AGENTS_MAX_LINES = 150;
const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
const H2_RE = /^## .+$/gm;
const HEADING_RE = /^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/gm;
// In a feature README's 对应设计 section, ADR/design references must be
// Markdown links so the link checker can guard them (ADR 0046); bare
// mentions are an error.
const DESIGN_SECTION_RE = /## 对应设计\r?\n([\s\S]*)$/;
const PUBLIC_SECTION_RE = /## 公开接口\r?\n([\s\S]*?)(?=\r?\n## |$)/;
const EXPORTS_LINK_RE = /\[[^\]]*\]\([^)]*exports\.md(?:#[^)]*)?\)/;
const BARE_DESIGN_REF_RE =
  /\bADR\s*\d{4}\b|(?:ADR\s*(?:\d{4}|LINKED)|LINKED)(?:\s*[、/,，&和与]\s*(?:\d{4}|LINKED))*\s*[、/,，&和与]\s*(\d{4})\b|\bdocs\/[^\s)]+|architecture\.md|game_design\.md/;

const FEATURE_README_MAX_LINES = 80;
const FEATURE_README_MAX_COLS = 200;

export const FEATURE_README_HEADINGS = [
  '## 职责',
  '## 公开接口',
  '## 拥有的组件',
  '## 不变量',
  '## 对应设计',
];

function stripFencedCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ''));
}

function stripCode(text: string): string {
  return stripFencedCode(text).replace(/`[^`\n]+`/g, '');
}

export function headingSlugs(markdownText: string): Set<string> {
  const slugs = new Set<string>();
  const seen = new Map<string, number>();
  for (const match of stripFencedCode(markdownText).matchAll(HEADING_RE)) {
    const raw = match[1] ?? '';
    const text = raw
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/(^|[^\p{L}\p{N}_])__([^_\n]+)__(?=$|[^\p{L}\p{N}_])/gu, '$1$2')
      .replace(/(^|[^\p{L}\p{N}_])_([^_\n]+)_(?=$|[^\p{L}\p{N}_])/gu, '$1$2')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, '')
      .replace(/ /g, '-');
    const count = seen.get(text) ?? 0;
    seen.set(text, count + 1);
    slugs.add(count === 0 ? text : `${text}-${count}`);
  }
  return slugs;
}

// Returns an error string when the README's 对应设计 section mentions an
// ADR or a docs/ path without a Markdown link around it.
export function checkDesignSection(readmeText: string): string | null {
  const section = DESIGN_SECTION_RE.exec(readmeText)?.[1];
  if (section === undefined) {
    return null;
  }
  const bare = stripCode(section).replace(
    /\[([^\]]*)\]\(([^)]+)\)/g,
    (_full, label: string, url: string) => {
      let masked = label;
      for (const m of url.matchAll(/(?:^|\/)(\d{4})(?:-[^/)]*)?\.md/g)) {
        const num = m[1];
        if (num !== undefined) {
          masked = masked.replace(new RegExp(`\\b${num}\\b`, 'g'), 'LINKED');
        }
      }
      for (const doc of ['architecture.md', 'game_design.md']) {
        if (url.includes(doc)) {
          masked = masked.replaceAll(doc, 'LINKED_DOC');
        }
      }
      return masked;
    },
  );
  const hit = BARE_DESIGN_REF_RE.exec(bare);
  if (hit === null) {
    return null;
  }
  const ref = hit[1] ?? hit[0];
  return `'${ref}' in 对应设计 must be a Markdown link, not bare text`;
}

// Returns an error string when a feature README mentions ADR NNNN outside
// code blocks without linking NNNN- in ## 对应设计, or omits exports.md in
// ## 公开接口.
export function checkFeatureReadmeRefs(readmeText: string): string | null {
  const publicSection = PUBLIC_SECTION_RE.exec(readmeText)?.[1] ?? '';
  if (!EXPORTS_LINK_RE.test(stripCode(publicSection))) {
    return '## 公开接口 must contain a Markdown link to exports.md';
  }
  const designSection = DESIGN_SECTION_RE.exec(readmeText)?.[1] ?? '';
  const linkedAdrs = new Set<string>();
  for (const match of stripCode(designSection).matchAll(LINK_RE)) {
    const url = match[1] ?? '';
    for (const numMatch of url.matchAll(/(?:^|\/)(\d{4})-[^/)]*\.md/g)) {
      if (numMatch[1] !== undefined) {
        linkedAdrs.add(numMatch[1]);
      }
    }
  }
  const missing = new Set<string>();
  for (const match of stripCode(readmeText).matchAll(/\bADR\s*(\d{4})\b/g)) {
    const num = match[1];
    if (num !== undefined && !linkedAdrs.has(num)) {
      missing.add(num);
    }
  }
  if (missing.size > 0) {
    const list = [...missing]
      .sort()
      .map((n) => `ADR ${n}`)
      .join(', ');
    return `mentioned ${list} must have a Markdown link in ## 对应设计`;
  }
  return null;
}

// Returns an error string when the README exceeds the size limits of ADR
// 0061 (line count or single-line width; counts characters, not bytes).
const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });

function charCount(text: string): number {
  return [...segmenter.segment(text)].length;
}

export function checkFeatureReadmeSize(readmeText: string): string | null {
  const lines = splitLines(readmeText);
  if (lines.length > FEATURE_README_MAX_LINES) {
    return `${lines.length} lines exceeds the ${FEATURE_README_MAX_LINES}-line limit`;
  }
  const long = lines.find((line) => charCount(line) > FEATURE_README_MAX_COLS);
  if (long !== undefined) {
    return `line ${lines.indexOf(long) + 1} is ${charCount(long)} chars exceeds the ${FEATURE_README_MAX_COLS}-char limit`;
  }
  return null;
}

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

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isInsideRoot(rootDir: string, resolved: string): boolean {
  const rel = path.relative(path.resolve(rootDir), resolved);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function findBrokenLinks(root: string, repoRelativePath: string): string[] {
  const filePath = path.join(root, repoRelativePath);
  const text = readFileSync(filePath, 'utf8');
  const broken: string[] = [];
  let selfSlugs: Set<string> | null = null;
  for (const match of stripCode(text).matchAll(LINK_RE)) {
    const raw = (match[1] ?? '').trim();
    if (raw === '' || /^(https?:|mailto:)/i.test(raw)) {
      continue;
    }
    const hashIdx = raw.indexOf('#');
    const target = hashIdx === -1 ? raw : raw.slice(0, hashIdx);
    const fragment = hashIdx === -1 ? null : raw.slice(hashIdx + 1);
    if (target === '') {
      const decodedFrag = fragment === null ? null : safeDecode(fragment);
      if (decodedFrag === null) {
        broken.push(raw);
        continue;
      }
      selfSlugs ??= headingSlugs(text);
      if (!selfSlugs.has(decodedFrag.toLowerCase())) {
        broken.push(raw);
      }
      continue;
    }
    const decodedTarget = safeDecode(target);
    if (decodedTarget === null) {
      broken.push(raw);
      continue;
    }
    const resolved = path.resolve(path.dirname(filePath), decodedTarget);
    if (!isInsideRoot(root, resolved) || !existsSync(resolved)) {
      broken.push(raw);
      continue;
    }
    if (fragment !== null) {
      if (statSync(resolved).isDirectory()) {
        broken.push(raw);
        continue;
      }
      if (resolved.endsWith('.md')) {
        const decodedFrag = safeDecode(fragment);
        if (decodedFrag === null) {
          broken.push(raw);
          continue;
        }
        const targetSlugs = headingSlugs(readFileSync(resolved, 'utf8'));
        if (!targetSlugs.has(decodedFrag.toLowerCase())) {
          broken.push(raw);
        }
      }
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
    const lineCount = splitLines(readFileSync(agentsPath, 'utf8')).length;
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
      const readmeText = readFileSync(readmePath, 'utf8');
      const problem = checkFeatureReadme(readmeText);
      if (problem !== null) {
        errors.push(`frontend/src/features/${entry.name}/README.md: ${problem}`);
      }
      const sizeProblem = checkFeatureReadmeSize(readmeText);
      if (sizeProblem !== null) {
        errors.push(`frontend/src/features/${entry.name}/README.md: ${sizeProblem}`);
      }
      const designProblem = checkDesignSection(readmeText);
      if (designProblem !== null) {
        errors.push(`frontend/src/features/${entry.name}/README.md: ${designProblem}`);
      }
      const refsProblem = checkFeatureReadmeRefs(readmeText);
      if (refsProblem !== null) {
        errors.push(`frontend/src/features/${entry.name}/README.md: ${refsProblem}`);
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
