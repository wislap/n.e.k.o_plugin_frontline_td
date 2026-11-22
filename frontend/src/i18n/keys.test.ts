// i18n coverage for protocol codes, surfaces, build categories, and keybinding
// help metadata (ADR 0048/0049): every code/label the UI can render must have
// a translation in BOTH locales.
import { describe, expect, it } from 'vitest';
import { loadContent, localName } from '../content/index';
import { BUILD_CATEGORIES } from '../features/construction/content';
import { STATE_NAMES } from '../features/construction/protocol';
import { FOOTPRINT_CODES, RANGE_CODES } from '../features/construction/rules/index';
import { CARGO_CLASSES, UNMET_REASONS } from '../features/logistics/protocol';
import { PRODUCTION_STATES } from '../features/production/protocol';
import { KEYBINDING_GROUPS } from '../input/keymap';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

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
const MOD_SOURCES = ['energy_low', 'energy_empty'] as const;
const SHARED_HUD_KEYS = [
  'hud.guide_title',
  'hud.guide_collapse',
  'hud.guide_expand',
  'hud.guide_mode_section',
  'hud.guide_global_section',
  'hud.camera.compass_n',
  'hud.camera.reset_north',
  'hud.camera.reset_north_hint',
  'hud.logistics_layer',
  'hud.clock_tick',
  'build.footprint',
  'build.time_sec',
  'build.demolish_btn',
  'stock.per_sec',
  'road.confirm_btn',
  'road.tool_btn',
  'squad.create_btn',
  'squad.empty_hint',
  'squad.center_hint',
  'dev.title',
  'minimap.title',
  'minimap.sector',
  'minimap.collapse',
  'minimap.expand',
  'minimap.aria_label',
] as const;

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
const surfaceNames = db.surfaces.list.map((s) => localName(s.id));
const helpKeys = KEYBINDING_GROUPS.flatMap((g) => [g.titleKey, ...g.entries.map((e) => e.descKey)]);

describe('i18n protocol-code coverage', () => {
  it('covers every code/name/surface/category/help key in English and Chinese', () => {
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
        PRODUCTION_STATES.map((s) => `prod.${s}`),
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
      assertKeys(
        bundle,
        surfaceNames.map((s) => `surface.${s}`),
        'surface',
      );
      assertKeys(
        bundle,
        ['all', ...BUILD_CATEGORIES].map((c) => `build.category.${c}`),
        'build.category',
      );
      assertKeys(bundle, helpKeys, 'help');
      assertKeys(bundle, SHARED_HUD_KEYS, 'hud');
      // Suggestion text exists for every unmet reason the stock panel shows.
      assertKeys(
        bundle,
        UNMET_REASONS.filter((r) => r !== 'none').map((r) => `suggest.${r}`),
        'suggest',
      );
    }
  });
});
