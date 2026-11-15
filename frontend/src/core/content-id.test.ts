import { describe, expect, it } from 'vitest';
import { contentId, isPackId, parseContentId } from './content-id';

describe('content-id', () => {
  it('accepts market pack ids', () => {
    expect(isPackId('frontline_td')).toBe(true);
    expect(isPackId('a')).toBe(true);
  });

  it('accepts local pack ids (github-id.pack)', () => {
    expect(isPackId('wislap.frontline_td')).toBe(true);
  });

  it('rejects malformed pack ids', () => {
    expect(isPackId('Frontline')).toBe(false);
    expect(isPackId('1abc')).toBe(false);
    expect(isPackId('has-dash')).toBe(false);
    expect(isPackId('')).toBe(false);
  });

  it('parses simple and dotted names', () => {
    expect(parseContentId('frontline_td:tank')).toEqual({
      pack: 'frontline_td',
      name: 'tank',
    });
    expect(parseContentId('frontline_td:kernel.command_rejected')).toEqual({
      pack: 'frontline_td',
      name: 'kernel.command_rejected',
    });
  });

  it('rejects malformed content ids', () => {
    expect(parseContentId('nosep')).toBeNull();
    expect(parseContentId('Pack:x')).toBeNull();
    expect(parseContentId('pack:Bad Name')).toBeNull();
    expect(parseContentId('pack:')).toBeNull();
  });

  it('contentId throws on invalid input and brands valid input', () => {
    expect(() => contentId('bad')).toThrow();
    expect(contentId('pack:name')).toBe('pack:name');
  });
});
