// Construction content base fields: every structure has a footprint and
// optional hit points; `build` marks the structure placeable and carries
// the build/demolish numbers. The composite schema is assembled in
// src/content/load.ts, which adds the logistics profiles (node?, stores?)
// and later batches' fields (producer, weapon, requiresDeposit).
import { s } from '../../core/index';

// Structures that can be built: cost in cargo units, build/demolish
// times in seconds and the demolition refund share (basis points).
// cost is converted to milli and times to ticks by the loader.
const buildProfileSchema = s.object({
  cost: s.record(s.int({ min: 0, max: 2_000_000 }), { maxLength: 4 }),
  time: s.number({ min: 0.05, max: 3600 }),
  demolishTime: s.number({ min: 0.05, max: 3600 }),
  salvageBp: s.int({ min: 0, max: 10000 }),
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
  // Render-only greybox height in world units (ghost, structure box,
  // memory silhouettes). Sim never reads it; required so render code
  // has no per-kind fallback table.
  visual: s.object({
    height: s.number({ min: 0.1, max: 20 }),
  }),
};
