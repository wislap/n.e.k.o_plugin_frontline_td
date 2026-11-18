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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { withViteSsr } from './ssr.ts';
import type { SsrLoad } from './ssr.ts';

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
// Optional header line marking that this ADR partially supersedes an
// older one (one line per superseded ADR; the note is free text inside
// full-width parens). Old ADRs are never edited — the index derives
// the supersession note from this line.
const ADR_PARTIAL_RE = /^- 部分取代：(\d{4})（(.+)）$/;
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

export interface AdrPartialSupersession {
  number: string;
  note: string;
}

export interface AdrEntry {
  number: string;
  title: string;
  status: string;
  date: string;
  deciders: string;
  batch: string;
  domain: string;
  fileName: string;
  partialSupersedes: AdrPartialSupersession[];
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

    const partialSupersedes = lines
      .map((line) => ADR_PARTIAL_RE.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ number: m[1] ?? '', note: m[2] ?? '' }));

    entries.push({
      number,
      title,
      status: statusLine[1] ?? '',
      date,
      deciders,
      batch,
      domain,
      fileName,
      partialSupersedes,
    });
  }

  // Partial supersession targets must exist and be older (ADR numbers
  // are zero-padded, so lexical order is chronological).
  for (const entry of entries) {
    for (const target of entry.partialSupersedes) {
      if (!numbers.has(target.number)) {
        errors.push(`${entry.fileName}: '部分取代' target ${target.number} does not exist`);
      } else if (target.number >= entry.number) {
        errors.push(`${entry.fileName}: '部分取代' target ${target.number} is not an older ADR`);
      }
    }
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

function renderRow(entry: AdrEntry, supersededBy: AdrPartialSupersession[]): string {
  const notes = supersededBy.map((s) => `部分被 ${s.number} 取代（${s.note}）`).join('、');
  const status = notes === '' ? entry.status : `${entry.status}；${notes}`;
  return (
    `| [${entry.number}](../adr/${entry.fileName}) | ${entry.title} | ${status} | ` +
    `${entry.deciders} | ${entry.batch} | ${entry.date} |`
  );
}

function renderTable(
  entries: AdrEntry[],
  supersededBy: Map<string, AdrPartialSupersession[]>,
): string[] {
  return [
    ...TABLE_HEADER,
    ...entries.map((entry) => renderRow(entry, supersededBy.get(entry.number) ?? [])),
  ];
}

// Invert entry.partialSupersedes into per-ADR supersession notes.
function supersededByMap(entries: AdrEntry[]): Map<string, AdrPartialSupersession[]> {
  const map = new Map<string, AdrPartialSupersession[]>();
  for (const entry of entries) {
    for (const target of entry.partialSupersedes) {
      const list = map.get(target.number) ?? [];
      list.push({ number: entry.number, note: target.note });
      map.set(target.number, list);
    }
  }
  return map;
}

export function renderAdrIndex(entries: AdrEntry[]): string {
  const byNumber = (a: AdrEntry, b: AdrEntry) => a.number.localeCompare(b.number);
  const active = entries.filter((entry) => ACTIVE_STATUSES.has(entry.status)).sort(byNumber);
  const retired = entries.filter((entry) => !ACTIVE_STATUSES.has(entry.status)).sort(byNumber);
  const supersededBy = supersededByMap(entries);

  const out: string[] = [GENERATED_HEADER, '', '# ADR 索引', '', '## 当前有效（按领域）'];
  for (const domain of ADR_DOMAINS) {
    const group = active.filter((entry) => entry.domain === domain);
    if (group.length === 0) {
      continue;
    }
    out.push('', `### ${domain}`, ...renderTable(group, supersededBy));
  }
  if (active.length === 0) {
    out.push('', '无');
  }

  out.push('', '## 已取代 / 已废弃');
  if (retired.length === 0) {
    out.push('', '无');
  } else {
    out.push('', ...renderTable(retired, supersededBy));
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

// ---------------------------------------------------------------------------
// contracts.md: SimManifest of the real assault sim, rendered as tables.
// ---------------------------------------------------------------------------

interface ManifestLike {
  phases: readonly string[];
  modules: {
    id: string;
    systems: {
      id: string;
      phase: string;
      everyTicks: number;
      offset: number;
      reads: string[];
      emits: string[];
    }[];
    commands: string[];
    effects: string[];
    channels: string[];
    states: string[];
    inspectors: string[];
    probes: string[];
  }[];
  components: { id: string; fields: Record<string, string>; writer: string | null }[];
  layers: { id: string; type: string; perFaction: boolean; writer: string | null }[];
  messages: { type: string; kind: string; visibility?: string }[];
}

const LIST_SEP = '、';
const EMPTY = '—';

function orEmpty(items: readonly string[]): string {
  return items.length === 0 ? EMPTY : items.map((i) => `\`${i}\``).join(LIST_SEP);
}

export function renderContracts(manifest: ManifestLike): string {
  const out: string[] = [
    GENERATED_HEADER,
    '',
    '# 模拟契约清单',
    '',
    `阶段顺序：${manifest.phases.join(' → ')}`,
    '',
    '## 模块',
  ];
  for (const module of manifest.modules) {
    out.push('', `### \`${module.id}\``, '');
    if (module.systems.length === 0) {
      out.push('无系统。');
    } else {
      out.push('| 系统 | 阶段 | 每 N tick | 偏移 | 读取 | 发出 |', '|---|---|---|---|---|---|');
      for (const system of module.systems) {
        out.push(
          `| \`${system.id}\` | ${system.phase} | ${system.everyTicks} | ${system.offset} | ` +
            `${orEmpty(system.reads)} | ${orEmpty(system.emits)} |`,
        );
      }
    }
    const list = (label: string, items: readonly string[]): void => {
      if (items.length > 0) {
        out.push('', `- ${label}：${orEmpty(items)}`);
      }
    };
    list('命令', module.commands);
    list('延迟效果', module.effects);
    list('快照通道', module.channels);
    list('模块状态', module.states);
    list('检查器', module.inspectors);
    list('探针', module.probes);
  }

  out.push('', '## 组件', '', '| 组件 | 字段 | 写者 |', '|---|---|---|');
  for (const c of manifest.components) {
    const fields = Object.entries(c.fields)
      .map(([name, type]) => `${name}: ${type}`)
      .join(LIST_SEP);
    out.push(`| \`${c.id}\` | ${fields === '' ? EMPTY : fields} | ${c.writer ?? EMPTY} |`);
  }

  out.push('', '## 网格层', '', '| 层 | 类型 | 按阵营 | 写者 |', '|---|---|---|---|');
  for (const l of manifest.layers) {
    out.push(`| \`${l.id}\` | ${l.type} | ${l.perFaction ? '是' : '否'} | ${l.writer ?? EMPTY} |`);
  }

  out.push('', '## 消息', '', '| 类型 | 种类 | 可见性 |', '|---|---|---|');
  for (const m of manifest.messages) {
    out.push(`| \`${m.type}\` | ${m.kind} | ${m.visibility ?? EMPTY} |`);
  }
  return [...out, ''].join('\n');
}

// ---------------------------------------------------------------------------
// exports.md: public surface of every feature/kernel barrel via the TS
// compiler API — names, declaration kinds, first doc-comment line.
// ---------------------------------------------------------------------------

const CALLEE_KINDS: Record<string, string> = {
  defineComponent: 'component def',
  defineEvent: 'event def',
  defineIntent: 'intent def',
  defineCommand: 'command def',
  defineGridLayer: 'layer def',
  defineSnapshotChannel: 'channel def',
  defineStat: 'stat def',
  defineModifier: 'modifier def',
};

function exportKind(decl: ts.Declaration): string {
  if (ts.isFunctionDeclaration(decl) || ts.isFunctionExpression(decl)) {
    return 'function';
  }
  if (ts.isClassDeclaration(decl)) {
    return 'class';
  }
  if (ts.isInterfaceDeclaration(decl)) {
    return 'interface';
  }
  if (ts.isTypeAliasDeclaration(decl)) {
    return 'type';
  }
  if (ts.isEnumDeclaration(decl)) {
    return 'enum';
  }
  if (ts.isVariableDeclaration(decl)) {
    const init = decl.initializer;
    if (init !== undefined && ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
      return CALLEE_KINDS[init.expression.text] ?? 'const';
    }
    return 'const';
  }
  return 'export';
}

// The contiguous '//' block nearest the declaration, joined and cut at
// the first sentence end ('. ', '. ' variants, '：', ';') or 140 chars.
function leadingComment(decl: ts.Declaration): string {
  const text = decl.getFullText();
  const ranges = (ts.getLeadingCommentRanges(text, 0) ?? []).filter(
    (r) => r.kind === ts.SyntaxKind.SingleLineCommentTrivia,
  );
  if (ranges.length === 0) {
    return '';
  }
  // Extend the nearest range backwards across earlier '//' lines separated
  // only by whitespace so multi-line comments report their first line.
  let first = ranges.length - 1;
  while (first > 0 && /^\s*$/.test(text.slice(ranges[first - 1]?.end ?? 0, ranges[first]?.pos))) {
    first -= 1;
  }
  const block = ranges
    .slice(first)
    .map((r) => text.slice(r.pos + 2, r.end).trim())
    .filter((line) => line !== '')
    .join(' ');
  const sentenceEnd = block.search(/[.。;；：]\s|[.。;；：]$/);
  const cut =
    sentenceEnd >= 0
      ? block.slice(0, sentenceEnd + 1)
      : block.length > 140
        ? `${block.slice(0, 140)}…`
        : block;
  return cut.replace(/\|/g, '\\|');
}

function exportSurfaceFiles(): string[] {
  const files = new Set<string>([
    'src/core/index.ts',
    'src/kernel/index.ts',
    'src/content/index.ts',
    'src/protocol/index.ts',
  ]);
  const featuresDir = path.join(FRONTEND_ROOT, 'src', 'features');
  for (const feature of readdirSync(featuresDir).sort()) {
    for (const candidate of [
      `src/features/${feature}/protocol.ts`,
      ...['sim', 'rules', 'render', 'ui'].flatMap((sub) => [
        `src/features/${feature}/${sub}/index.ts`,
        `src/features/${feature}/${sub}/index.tsx`,
      ]),
    ]) {
      if (existsSync(path.join(FRONTEND_ROOT, candidate))) {
        files.add(candidate);
      }
    }
  }
  return [...files].sort();
}

export function renderExports(files: readonly string[]): string {
  const program = ts.createProgram(
    files.map((f) => path.join(FRONTEND_ROOT, f)),
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      noEmit: true,
      jsx: ts.JsxEmit.ReactJSX,
      types: [],
    },
  );
  const checker = program.getTypeChecker();
  const out: string[] = [GENERATED_HEADER, '', '# 公共导出清单'];
  for (const rel of files) {
    const source = program.getSourceFile(path.join(FRONTEND_ROOT, rel));
    const symbol = source !== undefined ? checker.getSymbolAtLocation(source) : undefined;
    if (source === undefined || symbol === undefined) {
      continue;
    }
    out.push('', `## ${rel}`, '', '| 名称 | 种类 | 说明 |', '|---|---|---|');
    const rows = checker
      .getExportsOfModule(symbol)
      .map((exported) => {
        const resolved =
          (exported.flags & ts.SymbolFlags.Alias) !== 0
            ? checker.getAliasedSymbol(exported)
            : exported;
        const decl = resolved.declarations?.[0];
        return {
          name: exported.name,
          kind: decl !== undefined ? exportKind(decl) : 'export',
          comment: decl !== undefined ? leadingComment(decl) : '',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
    for (const row of rows) {
      out.push(`| \`${row.name}\` | ${row.kind} | ${row.comment} |`);
    }
  }
  return [...out, ''].join('\n');
}

interface Generator {
  name: string;
  outputPath: string;
  generate: () =>
    { content: string; errors: string[] } | Promise<{ content: string; errors: string[] }>;
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
  {
    name: 'contracts',
    outputPath: path.join(PLUGIN_ROOT, 'docs', 'generated', 'contracts.md'),
    generate: async () => {
      const content = await withViteSsr(async (load: SsrLoad) => {
        const assault = (await load('/src/modes/assault/index.ts')) as {
          defaultSetup: (seed: number) => unknown;
        };
        const app = (await load('/src/app/resolve-setup.ts')) as {
          resolveSetup: (
            setup: unknown,
          ) => { sim: { describe(): ManifestLike } } | { error: string };
        };
        const resolved = app.resolveSetup(assault.defaultSetup(1));
        if ('error' in resolved) {
          throw new Error(`resolveSetup(defaultSetup(1)) failed: ${resolved.error}`);
        }
        return renderContracts(resolved.sim.describe());
      });
      return { content, errors: [] };
    },
  },
  {
    name: 'exports',
    outputPath: path.join(PLUGIN_ROOT, 'docs', 'generated', 'exports.md'),
    generate: () => ({ content: renderExports(exportSurfaceFiles()), errors: [] }),
  },
];

export async function runGenerators(check: boolean): Promise<number> {
  let failed = false;
  for (const generator of GENERATORS) {
    const { content, errors } = await generator.generate();
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
  process.exit(await runGenerators(process.argv.includes('--check')));
}
