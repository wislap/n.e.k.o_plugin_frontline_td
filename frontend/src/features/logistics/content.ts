// Logistics content schemas (ADR 0025): cargo registry, the per-slot store
// profile shared by unit and structure content, the node profile used by
// structures, and the pack-level logistics config. The composite unit and
// structure schemas are assembled in src/content/load.ts so feature
// content files never import each other.
import { s } from '../../core/index';
import type { Infer } from '../../core/index';

// Slot class names; lifeline is fixed first and reserve last — see
// protocol.ts for the numeric codes used inside the sim.
const cargoClassSchema = s.enumOf(['lifeline', 'construction', 'production', 'reserve'] as const);

// One CargoStore slot: capacity in units (converted to milli by the
// loader), an optional per-second rate (negative = upkeep drain) and the
// export flag that marks the slot as a source shipped to the warehouse.
export const storeProfileSchema = s.object({
  cargo: s.contentId(),
  capacity: s.int({ min: 0, max: 2_000_000 }),
  class: cargoClassSchema,
  export: s.optional(s.bool()),
  ratePerSecond: s.optional(s.number({ min: -100_000, max: 100_000 })),
});

// Structure logistics node: connect and service in cells (connect is
// converted to cost units ×10 by the loader), warehouse marks the faction
// stock hub.
export const nodeProfileSchema = s.object({
  connect: s.number({ min: 0.1, max: 1024 }),
  service: s.number({ min: 0, max: 1024 }),
  vehicles: s.int({ min: 0, max: 60000 }),
  warehouse: s.optional(s.bool()),
});

export const cargoSchema = s.object({
  id: s.contentId(),
  color: s.optional(s.string({ maxLength: 16 })),
});
export type CargoContent = Infer<typeof cargoSchema>;

// Pack-level logistics parameters (single object, not a registry).
export const logisticsConfigSchema = s.object({
  // Allocation cycle length in seconds.
  cycleSeconds: s.number({ min: 0.05, max: 600 }),
  // Vehicles carry `load` units per trip at `speed` cells/s.
  vehicle: s.object({
    load: s.number({ min: 0.001, max: 2_000_000 }),
    speed: s.number({ min: 0.001, max: 10_000 }),
  }),
  // Energy slot below capacity × lowThresholdBp triggers the low modifier.
  lowThresholdBp: s.int({ min: 0, max: 10000 }),
  // mul_bp value for the low-energy modifier (empty is fixed −10000).
  lowSpeedBp: s.int({ min: -10000, max: 0 }),
  // Health bands: vehicles scale by factorBp when healthBp < aboveBp,
  // checked top-down.
  hpBandsBp: s.array(
    s.object({
      aboveBp: s.int({ min: 0, max: 10000 }),
      factorBp: s.int({ min: 0, max: 10000 }),
    }),
    { maxLength: 8 },
  ),
  // Road multiplier levels; level 0 is dirt (B1 has dirt only).
  roadLevels: s.array(s.object({ multiplierBp: s.int({ min: 1, max: 100_000 }) }), {
    maxLength: 8,
  }),
});
export type LogisticsConfigContent = Infer<typeof logisticsConfigSchema>;
