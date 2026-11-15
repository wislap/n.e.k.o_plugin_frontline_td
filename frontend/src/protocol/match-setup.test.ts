import { describe, expect, it } from 'vitest';
import { basePackManifest } from '../content/packs';
import { toFactionId } from '../core/index';
import type { MatchSetup } from './match-setup';
import { parseMatchSetup } from './match-setup';

function validSetup(): MatchSetup {
  return {
    formatVersion: 1,
    packs: [basePackManifest()],
    seed: 1234,
    factions: [
      { id: toFactionId(0), controller: 'none', carryIn: { unlocks: [] } },
      { id: toFactionId(1), controller: 'local', carryIn: { unlocks: [] } },
      { id: toFactionId(2), controller: 'none', carryIn: { unlocks: [] } },
    ],
    relations: [
      { a: toFactionId(0), b: toFactionId(1), relation: 'hostile' },
      { a: toFactionId(0), b: toFactionId(2), relation: 'allied' },
    ],
  };
}

function errors(value: unknown): string[] {
  const result = parseMatchSetup(value);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

describe('parseMatchSetup', () => {
  it('accepts the development setup', () => {
    const result = parseMatchSetup(validSetup());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.setup.factions).toHaveLength(3);
      expect(result.setup.relations).toHaveLength(2);
    }
  });

  it('rejects a duplicate faction id', () => {
    const setup = validSetup();
    setup.factions.push({ id: toFactionId(1), controller: 'none', carryIn: { unlocks: [] } });
    expect(errors(setup).join()).toContain('duplicate faction id');
  });

  it('rejects a relation with an unknown endpoint', () => {
    const setup = validSetup();
    setup.relations.push({ a: toFactionId(1), b: toFactionId(9), relation: 'hostile' });
    expect(errors(setup).join()).toContain('unknown faction id 9');
  });

  it('rejects a self-relation', () => {
    const setup = validSetup();
    setup.relations.push({ a: toFactionId(1), b: toFactionId(1), relation: 'allied' });
    expect(errors(setup).join()).toContain('cannot relate to itself');
  });

  it('rejects two local controllers', () => {
    const setup = validSetup();
    const second = setup.factions[2];
    if (second !== undefined) {
      second.controller = 'local';
    }
    expect(errors(setup).join()).toContain("at most one 'local' controller");
  });

  it('rejects an invalid pack id', () => {
    const setup = validSetup();
    const pack = setup.packs[0];
    if (pack !== undefined) {
      pack.id = 'Not A Pack Id';
    }
    expect(errors(setup).join()).toContain('invalid pack id');
  });

  it('rejects unknown keys', () => {
    const setup = { ...validSetup(), surprise: true };
    expect(errors(setup).join()).toContain('surprise');
  });

  it('rejects the wrong formatVersion', () => {
    const setup = { ...validSetup(), formatVersion: 2 };
    expect(parseMatchSetup(setup).ok).toBe(false);
  });

  it('rejects duplicate pack ids', () => {
    const setup = validSetup();
    const pack = setup.packs[0];
    if (pack !== undefined) {
      setup.packs.push({ ...pack });
    }
    expect(errors(setup).join()).toContain('duplicate pack id');
  });

  it('rejects a duplicate unordered relation pair', () => {
    const setup = validSetup();
    setup.relations.push({ a: toFactionId(1), b: toFactionId(0), relation: 'neutral' });
    expect(errors(setup).join()).toContain('duplicate relation');
  });
});
