// i18n coverage for protocol codes (M3 D): every code the UI can render
// must have a translation in BOTH locales — reason codes, cargo classes,
// entity states, production states, cargo ids and modifier sources.
import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import { FOOTPRINT_CODES, RANGE_CODES } from '../features/construction/rules/index';
import { STATE_NAMES } from '../features/construction/protocol';
import { CARGO_CLASSES, UNMET_REASONS } from '../features/logistics/protocol';
import { loadContent, localName } from '../content/index';

// Command reject reasons emitted by sim command handlers.
const REJECT_CODES = [
  'invalid_target',
  'no_units',
  'no_targets',
  'already_upgraded',
  'not_buildable',
  'units_in_way',
  'invalid_order',
  'invalid_units',
  'no_squad',
] as const;
// Waiting-reason codes reported by the construction inspector.
const WAITING_CODES = [
  'not_covered',
  'hostile_zone',
  'not_connected',
  'occupied',
  'reserved',
  'units_in_way',
  'terrain',
] as const;
const PROD_STATES = ['ready', 'producing', 'waiting_inputs', 'output_full'] as const;
const MOD_SOURCES = ['energy_low', 'energy_empty'] as const;

type Messages = Record<string, unknown>;

function leaf(node: unknown, path: string): unknown {
  let cur = node;
  for (const part of path.split('.')) {
    cur = (cur as Messages | undefined)?.[part];
  }
  return cur;
}

function assertKeys(bundle: Messages, keys: readonly string[], group: string): void {
  for (const key of keys) {
    expect(leaf(bundle, key), `${group}: '${key}'`).toBeTypeOf('string');
  }
}

const reasonCodes = new Set<string>([
  ...FOOTPRINT_CODES.filter((c) => c !== 'ok'),
  ...RANGE_CODES.filter((c) => c !== 'ok'),
  ...UNMET_REASONS,
  ...REJECT_CODES,
  ...WAITING_CODES,
]);

const db = loadContent();
const cargoNames = db.cargos.list.map((c) => localName(c.id));
const structureNames = db.structures.list.map((s) => localName(s.id));
const unitNames = db.units.list.map((u) => localName(u.id));

describe('i18n protocol-code coverage', () => {
  it('covers every code/name key in English and Chinese', () => {
    for (const bundle of [en, zhCN] as Messages[]) {
      assertKeys(
        bundle,
        [...reasonCodes].map((c) => `reason.${c}`),
        'reason',
      );
      assertKeys(
        bundle,
        CARGO_CLASSES.map((c) => `class.${c}`),
        'class',
      );
      assertKeys(
        bundle,
        STATE_NAMES.map((s) => `state.${s}`),
        'state',
      );
      assertKeys(
        bundle,
        PROD_STATES.map((s) => `prod.${s}`),
        'prod',
      );
      assertKeys(
        bundle,
        MOD_SOURCES.map((m) => `mod.${m}`),
        'mod',
      );
      assertKeys(
        bundle,
        cargoNames.map((c) => `cargo.${c}`),
        'cargo',
      );
      assertKeys(
        bundle,
        structureNames.map((s) => `structure.${s}`),
        'structure',
      );
      assertKeys(
        bundle,
        unitNames.map((u) => `unit.${u}`),
        'unit',
      );
      // Suggestion text exists for every unmet reason the stock panel shows.
      assertKeys(
        bundle,
        UNMET_REASONS.filter((r) => r !== 'none').map((r) => `suggest.${r}`),
        'suggest',
      );
    }
  });
});
