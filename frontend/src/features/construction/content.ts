// Construction content base fields: every structure has a footprint and
// optional hit points; `build` marks the structure placeable and carries
// the build/demolish numbers. The composite schema is assembled in
// src/content/load.ts, which adds the logistics profiles (node?, stores?)
// and later batches' fields (producer, weapon, requiresDeposit).
import { s } from '../../core/index';

// Build menu category tabs (ADR 0049): structures with a `build` block
// belong to one of these groups; omitted entries default to 'production'.
export const BUILD_CATEGORIES = ['logistics', 'production', 'military'] as const;
export type BuildCategory = (typeof BUILD_CATEGORIES)[number];

// Procedural 3D silhouette shapes for structures (ADR 0050).
export const STRUCTURE_SILHOUETTES = [
  'block',
  'hq_citadel',
  'rail_hub',
  'twin_depot',
  'octagon_fort',
  'drill_rig',
  'reactor_pair',
  'foundry_press',
  'turret_mount',
  'gantry_bay',
  'bio_spire',
] as const;
export type StructureSilhouette = (typeof STRUCTURE_SILHOUETTES)[number];

// Procedural roof tactical glyph badges for structures (ADR 0050).
export const STRUCTURE_GLYPHS = [
  'none',
  'core_star',
  'relay_arrows',
  'supply_cross',
  'fort_shield',
  'drill_tri',
  'power_bolt',
  'ammo_diamond',
  'reticle',
  'gantry_bot',
  'bio_hazard',
] as const;
export type StructureGlyph = (typeof STRUCTURE_GLYPHS)[number];

// Structures that can be built: cost in cargo units, build/demolish
// times in seconds and the demolition refund share (basis points).
// cost is converted to milli and times to ticks by the loader.
const buildProfileSchema = s.object({
  cost: s.record(s.int({ min: 0, max: 2_000_000 }), { maxLength: 4 }),
  time: s.number({ min: 0.05, max: 3600 }),
  demolishTime: s.number({ min: 0.05, max: 3600 }),
  salvageBp: s.int({ min: 0, max: 10000 }),
  category: s.optional(s.enumOf(BUILD_CATEGORIES)),
});

export const structureBaseFields = {
  id: s.contentId(),
  footprint: s.object({
    w: s.int({ min: 1, max: 8 }),
    h: s.int({ min: 1, max: 8 }),
  }),
  hp: s.optional(s.int({ min: 1, max: 2_000_000 })),
  build: s.optional(buildProfileSchema),
  // Required surface deposit (cargo id) under the footprint; miners only.
  requiresDeposit: s.optional(s.contentId()),
  // Hostile factions cannot build within this many cells of the
  // footprint centre while the structure is operational (outposts,
  // hive). Radius in cells.
  exclusion: s.optional(s.int({ min: 1, max: 64 })),
  // Render-only visual hints in world units (ghost, structure silhouettes,
  // roof glyphs, memory silhouettes). Sim never reads them; `height` is
  // required so render code has no per-kind height fallback table.
  visual: s.object({
    height: s.number({ min: 0.1, max: 20 }),
    silhouette: s.optional(s.enumOf(STRUCTURE_SILHOUETTES)),
    glyph: s.optional(s.enumOf(STRUCTURE_GLYPHS)),
  }),
};
