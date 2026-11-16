import { describe, expect, it } from 'vitest';
import * as s from './schema';
import { validate } from './schema';

describe('schema', () => {
  it('validates ints with bounds and rejects non-integers', () => {
    const schema = s.int({ min: 1, max: 10 });
    expect(validate(schema, 5)).toEqual({ ok: true, value: 5 });
    expect(validate(schema, 0).ok).toBe(false);
    expect(validate(schema, 11).ok).toBe(false);
    expect(validate(schema, 1.5).ok).toBe(false);
    expect(validate(schema, NaN).ok).toBe(false);
    expect(validate(schema, Infinity).ok).toBe(false);
  });

  it('validates bool, string, literal, enum', () => {
    expect(validate(s.bool(), true).ok).toBe(true);
    expect(validate(s.bool(), 1).ok).toBe(false);
    expect(validate(s.string({ maxLength: 3 }), 'abcd').ok).toBe(false);
    expect(validate(s.string({ pattern: /^a/ }), 'abc').ok).toBe(true);
    expect(validate(s.literal('x'), 'x').ok).toBe(true);
    expect(validate(s.literal('x'), 'y').ok).toBe(false);
    expect(validate(s.enumOf(['a', 'b'] as const), 'b').ok).toBe(true);
    expect(validate(s.enumOf(['a', 'b'] as const), 'c').ok).toBe(false);
  });

  it('validates contentId, handle, factionId', () => {
    expect(validate(s.contentId(), 'pack:name').ok).toBe(true);
    expect(validate(s.contentId(), 'bad').ok).toBe(false);
    expect(validate(s.handle(), 1).ok).toBe(true);
    expect(validate(s.handle(), 'x').ok).toBe(false);
    expect(validate(s.factionId(), 65535).ok).toBe(true);
    expect(validate(s.factionId(), 65536).ok).toBe(false);
  });

  it('validates arrays with item schema and maxLength', () => {
    const schema = s.array(s.int(), { maxLength: 2 });
    expect(validate(schema, [1, 2]).ok).toBe(true);
    expect(validate(schema, [1, 2, 3]).ok).toBe(false);
    const bad = validate(schema, [1, 'x']);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.path).toBe('$[1]');
    }
  });

  it('validates objects exactly: unknown keys rejected, optional allowed', () => {
    const schema = s.object({
      a: s.int(),
      b: s.optional(s.string()),
    });
    expect(validate(schema, { a: 1 }).ok).toBe(true);
    expect(validate(schema, { a: 1, b: 'x' }).ok).toBe(true);
    expect(validate(schema, { a: 1, b: 2 }).ok).toBe(false);
    const unknown = validate(schema, { a: 1, c: 2 });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.path).toBe('$.c');
    }
    const missing = validate(schema, { b: 'x' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.path).toBe('$.a');
    }
  });

  it('Infers usable static types', () => {
    const schema = s.object({ a: s.int(), b: s.optional(s.bool()) });
    const result = validate(schema, { a: 1, b: true });
    if (result.ok) {
      const value: { a: number; b?: boolean | undefined } = result.value;
      expect(value.a).toBe(1);
    }
  });
});

describe('number / nullable / record', () => {
  it('validates finite numbers with bounds', () => {
    const schema = s.number({ min: 0.5, max: 2 });
    expect(s.validate(schema, 1.25).ok).toBe(true);
    expect(s.validate(schema, Number.NaN).ok).toBe(false);
    expect(s.validate(schema, Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(s.validate(schema, 0.1).ok).toBe(false);
    expect(s.validate(schema, 3).ok).toBe(false);
    expect(s.validate(schema, 'x').ok).toBe(false);
  });

  it('accepts null through nullable', () => {
    const schema = s.object({ v: s.nullable(s.int({ min: 0 })) });
    expect(s.validate(schema, { v: null }).ok).toBe(true);
    expect(s.validate(schema, { v: 3 }).ok).toBe(true);
    expect(s.validate(schema, { v: -1 }).ok).toBe(false);
  });

  it('validates record values', () => {
    const schema = s.record(s.int({ min: 0 }));
    expect(s.validate(schema, { a: 1, b: 2 }).ok).toBe(true);
    expect(s.validate(schema, { a: -1 }).ok).toBe(false);
    expect(s.validate(schema, [1, 2]).ok).toBe(false);
  });
});
