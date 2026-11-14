import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

function leafPaths(value: unknown, prefix: string[] = []): string[] {
  if (typeof value === 'string') {
    return [prefix.join('.')];
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error(`locale value at ${prefix.join('.')} is not a string or object`);
  }
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, [...prefix, key]));
}

function leafValues(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  return Object.values(value as Record<string, unknown>).flatMap(leafValues);
}

describe('locale key parity', () => {
  it('zh-CN and en have identical key sets', () => {
    expect(leafPaths(en).sort()).toEqual(leafPaths(zhCN).sort());
  });

  it('no empty strings in zh-CN', () => {
    expect(leafValues(zhCN).every((v) => v.trim().length > 0)).toBe(true);
  });

  it('no empty strings in en', () => {
    expect(leafValues(en).every((v) => v.trim().length > 0)).toBe(true);
  });
});
