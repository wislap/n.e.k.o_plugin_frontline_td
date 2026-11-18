import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADR_DOMAINS, renderAdrIndex, scanAdrs } from './gen-index.ts';
import type { AdrEntry } from './gen-index.ts';

let dir: string;
let adrDir: string;

const HEADER = `- 状态：已采纳
- 实现：已实现
- 日期：2026-11-14
- 决策者：wislap
- 批次：M0 架构基线
- 领域：工程`;

const VALID_ADR = `# 0001. Some decision
${HEADER}
## 背景
b
## 决策
d
## 后果
c
`;

function adr(number: string, title: string, overrides: Partial<Record<string, string>> = {}) {
  const header = HEADER.replace('0001', number);
  let text = `# ${number}. ${title}\n${header}\n## 背景\nb\n## 决策\nd\n## 后果\nc\n`;
  for (const [key, value] of Object.entries(overrides)) {
    text = text.replace(new RegExp(`- ${key}：.*`), `- ${key}：${value}`);
  }
  return text;
}

function entry(partial: Partial<AdrEntry> & Pick<AdrEntry, 'number' | 'fileName'>): AdrEntry {
  return {
    title: 'T',
    status: '已采纳',
    implementation: { value: '已实现', note: '' },
    date: '2026-11-14',
    deciders: 'wislap',
    batch: 'M0 架构基线',
    domain: '工程',
    partialSupersedes: [],
    ...partial,
  };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'gen-index-'));
  adrDir = path.join(dir, 'adr');
  mkdirSync(adrDir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeAdr(name: string, content: string = VALID_ADR) {
  writeFileSync(path.join(adrDir, name), content);
}

describe('scanAdrs', () => {
  it('accepts a valid contiguous ADR set', () => {
    writeAdr('0001-first-decision.md');
    const result = scanAdrs(adrDir);
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.title).toBe('Some decision');
    expect(result.entries[0]?.status).toBe('已采纳');
    expect(result.entries[0]?.domain).toBe('工程');
    expect(result.entries[0]?.batch).toBe('M0 架构基线');
  });

  it('flags a bad file name', () => {
    writeAdr('decision.md');
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch('NNNN-kebab-slug');
  });

  it('flags non-contiguous numbering', () => {
    writeAdr('0001-first-decision.md');
    writeAdr('0003-third.md', adr('0003', 'Third'));
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch('contiguous');
  });

  it('flags H1 number mismatch', () => {
    writeAdr('0002-x.md', VALID_ADR);
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch('does not match');
  });

  it('flags a missing status line', () => {
    writeAdr('0001-x.md', VALID_ADR.replace('- 状态：已采纳\n', ''));
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch('状态');
  });

  it('flags a missing 实现 line', () => {
    writeAdr('0001-x.md', VALID_ADR.replace('- 实现：已实现\n', ''));
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch(/0001-x\.md.*实现/);
  });

  it('flags an invalid 实现 value', () => {
    writeAdr('0001-x.md', VALID_ADR.replace('- 实现：已实现', '- 实现：基本完成'));
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch(/0001-x\.md.*实现/);
  });

  it('flags 部分/未实现 without a non-empty 缺 note', () => {
    writeAdr('0001-x.md', VALID_ADR.replace('- 实现：已实现', '- 实现：部分'));
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch(/0001-x\.md.*缺/);
    writeAdr('0001-y.md', VALID_ADR.replace('- 实现：已实现', '- 实现：未实现（缺：）'));
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch(/缺/);
  });

  it('accepts 部分（缺：…）and 已实现（注：…）', () => {
    writeAdr('0001-x.md', VALID_ADR.replace('- 实现：已实现', '- 实现：部分（缺：别名表未做）'));
    const result = scanAdrs(adrDir);
    expect(result.errors).toEqual([]);
    expect(result.entries[0]?.implementation).toEqual({ value: '部分', note: '别名表未做' });
  });

  it('flags 已实现 carrying a 缺 note', () => {
    writeAdr('0001-x.md', VALID_ADR.replace('- 实现：已实现', '- 实现：已实现（缺：x）'));
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch(/0001-x\.md.*实现/);
  });

  it('flags a missing required section', () => {
    writeAdr('0001-x.md', VALID_ADR.replace('## 后果\nc\n', ''));
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch('## 后果');
  });

  it('flags a missing date line', () => {
    writeAdr('0001-x.md', VALID_ADR.replace('- 日期：2026-11-14\n', ''));
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch(/0001-x\.md.*日期/);
  });

  it('flags an invalid date format', () => {
    writeAdr('0001-x.md', VALID_ADR.replace('2026-11-14', '14/11/2026'));
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch(/0001-x\.md.*日期/);
  });

  it('flags a missing deciders line', () => {
    writeAdr('0001-x.md', VALID_ADR.replace('- 决策者：wislap\n', ''));
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch(/0001-x\.md.*决策者/);
  });

  it('flags an invalid deciders value', () => {
    writeAdr('0001-x.md', VALID_ADR.replace('wislap', 'wislap,alice-bob'));
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch(/0001-x\.md.*决策者/);
  });

  it('accepts multiple deciders separated by comma-space', () => {
    writeAdr('0001-x.md', VALID_ADR.replace('wislap', 'wislap, alice-bob'));
    expect(scanAdrs(adrDir).errors).toEqual([]);
  });

  it('flags a missing batch line', () => {
    writeAdr('0001-x.md', VALID_ADR.replace('- 批次：M0 架构基线\n', ''));
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch(/0001-x\.md.*批次/);
  });

  it('flags a missing domain line', () => {
    writeAdr('0001-x.md', VALID_ADR.replace('- 领域：工程\n', ''));
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch(/0001-x\.md.*领域/);
  });

  it('flags a domain outside the fixed list', () => {
    writeAdr('0001-x.md', VALID_ADR.replace('领域：工程', '领域：营销'));
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch(/0001-x\.md.*领域/);
  });

  it('accepts a 部分取代 line referencing an older ADR', () => {
    writeAdr('0001-x.md');
    writeAdr(
      '0002-y.md',
      adr('0002', 'Y').replace('- 领域：工程', '- 领域：工程\n- 部分取代：0001（波次目标）'),
    );
    const result = scanAdrs(adrDir);
    expect(result.errors).toEqual([]);
    expect(result.entries[1]?.partialSupersedes).toEqual([{ number: '0001', note: '波次目标' }]);
  });

  it('flags a 部分取代 target that does not exist', () => {
    writeAdr('0001-x.md');
    writeAdr(
      '0002-y.md',
      adr('0002', 'Y').replace('- 领域：工程', '- 领域：工程\n- 部分取代：0003（不存在的目标）'),
    );
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch('does not exist');
  });

  it('flags a 部分取代 target that is not older', () => {
    writeAdr('0001-x.md');
    writeAdr(
      '0002-y.md',
      adr('0002', 'Y').replace('- 领域：工程', '- 领域：工程\n- 部分取代：0002（自己）'),
    );
    expect(scanAdrs(adrDir).errors.join('\n')).toMatch('not an older ADR');
  });
});

describe('renderAdrIndex', () => {
  it('renders the generated header first', () => {
    const content = renderAdrIndex([entry({ number: '0001', fileName: '0001-t.md' })]);
    expect(content.startsWith('<!-- 自动生成，勿手改：npm run gen:index -->')).toBe(true);
  });

  it('groups active ADRs by domain in the fixed order', () => {
    const content = renderAdrIndex([
      entry({ number: '0003', fileName: '0003-c.md', domain: '模拟' }),
      entry({ number: '0001', fileName: '0001-a.md', domain: '工程' }),
      entry({ number: '0002', fileName: '0002-b.md', domain: '架构' }),
      entry({ number: '0004', fileName: '0004-d.md', domain: '工程' }),
    ]);
    const eng = content.indexOf('### 工程');
    const arch = content.indexOf('### 架构');
    const sim = content.indexOf('### 模拟');
    expect(eng).toBeGreaterThan(-1);
    expect(eng).toBeLessThan(arch);
    expect(arch).toBeLessThan(sim);
    // rows within a domain sorted by number
    expect(content.indexOf('[0001]')).toBeLessThan(content.indexOf('[0004]'));
    // ADR_DOMAINS order is the ordering source
    expect(ADR_DOMAINS.indexOf('工程')).toBeLessThan(ADR_DOMAINS.indexOf('架构'));
  });

  it('puts superseded and deprecated ADRs only in the retired section', () => {
    const content = renderAdrIndex([
      entry({ number: '0001', fileName: '0001-a.md' }),
      entry({ number: '0002', fileName: '0002-b.md', status: '已取代（见 0003）' }),
      entry({ number: '0003', fileName: '0003-c.md' }),
      entry({ number: '0004', fileName: '0004-d.md', status: '已废弃' }),
    ]);
    const activeSection = content.slice(
      content.indexOf('## 当前有效'),
      content.indexOf('## 已取代 / 已废弃'),
    );
    const retiredSection = content.slice(
      content.indexOf('## 已取代 / 已废弃'),
      content.indexOf('## 批次时间线'),
    );
    expect(activeSection).toContain('[0001]');
    expect(activeSection).toContain('[0003]');
    expect(activeSection).not.toContain('[0002]');
    expect(activeSection).not.toContain('[0004]');
    expect(retiredSection).toContain('[0002]');
    expect(retiredSection).toContain('[0004]');
  });

  it('renders the 实现 column with its note', () => {
    const content = renderAdrIndex([
      entry({ number: '0001', fileName: '0001-a.md' }),
      entry({
        number: '0002',
        fileName: '0002-b.md',
        implementation: { value: '部分', note: '嵌套编组未做' },
      }),
    ]);
    const row0002 = content.split('\n').find((l) => l.includes('[0002]')) ?? '';
    expect(row0002).toContain('部分（嵌套编组未做）');
  });

  it('shows the partial-supersession note on the referenced ADR row', () => {
    const content = renderAdrIndex([
      entry({ number: '0001', fileName: '0001-a.md' }),
      entry({
        number: '0002',
        fileName: '0002-b.md',
        partialSupersedes: [{ number: '0001', note: '波次目标' }],
      }),
    ]);
    const row0001 = content.split('\n').find((l) => l.includes('[0001]')) ?? '';
    const row0002 = content.split('\n').find((l) => l.includes('[0002]')) ?? '';
    expect(row0001).toContain('部分被 0002 取代（波次目标）');
    expect(row0002).not.toContain('部分被');
  });

  it('renders 无 when there are no retired ADRs', () => {
    const content = renderAdrIndex([entry({ number: '0001', fileName: '0001-a.md' })]);
    const retiredSection = content.slice(
      content.indexOf('## 已取代 / 已废弃'),
      content.indexOf('## 批次时间线'),
    );
    expect(retiredSection).toContain('无');
  });

  it('orders batch timeline by smallest ADR number and uses the earliest date', () => {
    const content = renderAdrIndex([
      entry({ number: '0001', fileName: '0001-a.md', batch: 'A 批次', date: '2026-11-20' }),
      entry({ number: '0002', fileName: '0002-b.md', batch: 'B 批次', date: '2026-11-10' }),
      entry({
        number: '0003',
        fileName: '0003-c.md',
        batch: 'A 批次',
        date: '2026-12-01',
        status: '已废弃',
      }),
    ]);
    const timeline = content.slice(content.indexOf('## 批次时间线'));
    const batchA = timeline.indexOf('### A 批次（2026-11-20）');
    const batchB = timeline.indexOf('### B 批次（2026-11-10）');
    expect(batchA).toBeGreaterThan(-1);
    expect(batchB).toBeGreaterThan(-1);
    // B has the earlier date, but A owns the smaller ADR number and comes first
    expect(batchA).toBeLessThan(batchB);
    // batch lists all ADRs regardless of status, sorted by number
    const aSection = timeline.slice(batchA, batchB);
    expect(aSection).toContain('- [0001 T](../adr/0001-a.md)');
    expect(aSection).toContain('- [0003 T](../adr/0003-c.md)');
  });
});
