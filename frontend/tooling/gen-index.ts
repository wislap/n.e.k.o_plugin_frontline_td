/**
 * gen-index: regenerate machine-generated index files.
 *
 * Generators are an explicit array; later milestones add entries.
 * M0 has one generator: the ADR index at docs/generated/adr-index.md.
 *
 * Usage:
 *   node tooling/gen-index.ts           write outputs that are stale
 *   node tooling/gen-index.ts --check   fail (non-zero) if any output is stale
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const FRONTEND_ROOT = path.resolve(import.meta.dirname, '..');
export const PLUGIN_ROOT = path.resolve(FRONTEND_ROOT, '..');

const GENERATED_HEADER = '<!-- 自动生成，勿手改：npm run gen:index -->';
const ADR_NAME_RE = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const ADR_H1_RE = /^# (\d{4})\. (.+)$/;
const ADR_STATUS_RE = /^- 状态：(已采纳|待定|已废弃|已取代（见 \d{4}）)$/;
const ADR_DATE_RE = /^- 日期：(\d{4}-\d{2}-\d{2})$/;
const GITHUB_ID = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})';
const ADR_DECIDERS_RE = new RegExp(`^- 决策者：(${GITHUB_ID}(?:, ${GITHUB_ID})*)$`);
const ADR_BATCH_RE = /^- 批次：(.+)$/;
const ADR_DOMAIN_LINE_RE = /^- 领域：(.+)$/;
const REQUIRED_SECTIONS = ['## 背景', '## 决策', '## 后果'];

export const ADR_DOMAINS = [
  '工程',
  '架构',
  '模拟',
  '地形',
  '战斗',
  '建造',
  '物流',
  '内容',
  'UI',
] as const;

export interface AdrEntry {
  number: string;
  title: string;
  status: string;
  date: string;
  deciders: string;
  batch: string;
  domain: string;
  fileName: string;
}

export interface AdrScanResult {
  entries: AdrEntry[];
  errors: string[];
}

/** Parse and validate all ADR files under adrDir. */
export function scanAdrs(adrDir: string): AdrScanResult {
  const errors: string[] = [];
  const fileNames = readdirSync(adrDir)
    .filter((name) => name.endsWith('.md'))
    .sort();

  const entries: AdrEntry[] = [];
  const numbers = new Set<string>();
  for (const fileName of fileNames) {
    const match = ADR_NAME_RE.exec(fileName);
    if (match === null) {
      errors.push(`${fileName}: file name must match NNNN-kebab-slug.md`);
      continue;
    }
    const number = match[1] ?? '';
    if (numbers.has(number)) {
      errors.push(`${fileName}: duplicate ADR number ${number}`);
      continue;
    }
    numbers.add(number);

    const text = readFileSync(path.join(adrDir, fileName), 'utf8');
    const lines = text.split(/\r?\n/);

    const h1 = ADR_H1_RE.exec(lines[0] ?? '');
    if (h1 === null) {
      errors.push(`${fileName}: first line must be '# ${number}. <title>'`);
      continue;
    }
    const h1Number = h1[1] ?? '';
    const title = h1[2] ?? '';
    if (h1Number !== number) {
      errors.push(`${fileName}: H1 number ${h1Number} does not match file name number ${number}`);
      continue;
    }

    const statusLine = lines.map((line) => ADR_STATUS_RE.exec(line)).find((m) => m !== null);
    if (statusLine === undefined) {
      errors.push(`${fileName}: missing '- 状态：' line with a valid status`);
      continue;
    }

    let headerOk = true;
    const readField = (field: string, strict: RegExp, hint: string): string => {
      const match = lines.map((line) => strict.exec(line)).find((m) => m !== null);
      if (match !== undefined) {
        return match[1] ?? '';
      }
      headerOk = false;
      const present = lines.some((line) => line.startsWith(`- ${field}：`));
      errors.push(
        present
          ? `${fileName}: invalid '${field}' value (expected ${hint})`
          : `${fileName}: missing '- ${field}：' line`,
      );
      return '';
    };

    const date = readField('日期', ADR_DATE_RE, 'YYYY-MM-DD');
    const deciders = readField('决策者', ADR_DECIDERS_RE, "GitHub IDs separated by ', '");
    const batch = readField('批次', ADR_BATCH_RE, 'a non-empty batch name');
    const domainRaw = readField('领域', ADR_DOMAIN_LINE_RE, `one of ${ADR_DOMAINS.join('/')}`);
    let domain = domainRaw;
    if (domainRaw !== '' && !(ADR_DOMAINS as readonly string[]).includes(domainRaw)) {
      headerOk = false;
      errors.push(
        `${fileName}: invalid '领域' value '${domainRaw}' (expected one of ${ADR_DOMAINS.join('/')})`,
      );
      domain = '';
    }
    if (!headerOk) {
      continue;
    }

    for (const section of REQUIRED_SECTIONS) {
      if (!lines.some((line) => line.trim() === section)) {
        errors.push(`${fileName}: missing required section '${section}'`);
      }
    }

    entries.push({
      number,
      title,
      status: statusLine[1] ?? '',
      date,
      deciders,
      batch,
      domain,
      fileName,
    });
  }

  const sorted = [...numbers].sort();
  sorted.forEach((num, index) => {
    const expected = String(index + 1).padStart(4, '0');
    if (num !== expected) {
      errors.push(`ADR numbers must be contiguous from 0001: found ${num}, expected ${expected}`);
    }
  });

  return { entries, errors };
}

const ACTIVE_STATUSES = new Set(['已采纳', '待定']);
const TABLE_HEADER = ['| 编号 | 标题 | 状态 | 决策者 | 批次 | 日期 |', '|---|---|---|---|---|---|'];

function renderRow(entry: AdrEntry): string {
  return (
    `| [${entry.number}](../adr/${entry.fileName}) | ${entry.title} | ${entry.status} | ` +
    `${entry.deciders} | ${entry.batch} | ${entry.date} |`
  );
}

function renderTable(entries: AdrEntry[]): string[] {
  return [...TABLE_HEADER, ...entries.map(renderRow)];
}

export function renderAdrIndex(entries: AdrEntry[]): string {
  const byNumber = (a: AdrEntry, b: AdrEntry) => a.number.localeCompare(b.number);
  const active = entries.filter((entry) => ACTIVE_STATUSES.has(entry.status)).sort(byNumber);
  const retired = entries.filter((entry) => !ACTIVE_STATUSES.has(entry.status)).sort(byNumber);

  const out: string[] = [GENERATED_HEADER, '', '# ADR 索引', '', '## 当前有效（按领域）'];
  for (const domain of ADR_DOMAINS) {
    const group = active.filter((entry) => entry.domain === domain);
    if (group.length === 0) {
      continue;
    }
    out.push('', `### ${domain}`, ...renderTable(group));
  }
  if (active.length === 0) {
    out.push('', '无');
  }

  out.push('', '## 已取代 / 已废弃');
  if (retired.length === 0) {
    out.push('', '无');
  } else {
    out.push('', ...renderTable(retired));
  }

  out.push('', '## 批次时间线');
  const batches = new Map<string, AdrEntry[]>();
  for (const entry of [...entries].sort(byNumber)) {
    const group = batches.get(entry.batch) ?? [];
    group.push(entry);
    batches.set(entry.batch, group);
  }
  const orderedBatches = [...batches.values()].sort((a, b) =>
    (a[0]?.number ?? '').localeCompare(b[0]?.number ?? ''),
  );
  for (const group of orderedBatches) {
    const batch = group[0]?.batch ?? '';
    const date = group.map((entry) => entry.date).sort()[0] ?? '';
    out.push('', `### ${batch}（${date}）`);
    for (const entry of group) {
      out.push(`- [${entry.number} ${entry.title}](../adr/${entry.fileName})`);
    }
  }
  if (batches.size === 0) {
    out.push('', '无');
  }

  return [...out, ''].join('\n');
}

interface Generator {
  name: string;
  outputPath: string;
  generate: () => { content: string; errors: string[] };
}

const GENERATORS: Generator[] = [
  {
    name: 'adr-index',
    outputPath: path.join(PLUGIN_ROOT, 'docs', 'generated', 'adr-index.md'),
    generate: () => {
      const result = scanAdrs(path.join(PLUGIN_ROOT, 'docs', 'adr'));
      return { content: renderAdrIndex(result.entries), errors: result.errors };
    },
  },
];

export function runGenerators(check: boolean): number {
  let failed = false;
  for (const generator of GENERATORS) {
    const { content, errors } = generator.generate();
    if (errors.length > 0) {
      failed = true;
      console.error(`${generator.name}: validation errors:`);
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      continue;
    }
    let current: string | null;
    try {
      current = readFileSync(generator.outputPath, 'utf8');
    } catch {
      current = null;
    }
    if (current === content) {
      console.log(`${generator.name}: up to date`);
      continue;
    }
    if (check) {
      failed = true;
      console.error(`${generator.name}: ${generator.outputPath} is stale; run npm run gen:index`);
      continue;
    }
    mkdirSync(path.dirname(generator.outputPath), { recursive: true });
    writeFileSync(generator.outputPath, content);
    console.log(`${generator.name}: wrote ${generator.outputPath}`);
  }
  return failed ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runGenerators(process.argv.includes('--check')));
}
