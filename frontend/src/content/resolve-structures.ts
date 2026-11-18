// Structure and store-profile resolution, extracted from load.ts: store
// profiles are shared between units and structures, and structures add
// the node profile (cells -> cost units) and the construction build
// profile (units -> milli, seconds -> ticks).
import { s } from '../core/index';
import type { ContentId } from '../core/index';
import type { Infer } from '../core/index';
import { MILLI, TICKS_PER_SECOND } from '../core/index';
import { captureProfileSchema } from '../features/capture/content';
import { weaponSchema } from '../features/combat/content';
import { structureBaseFields } from '../features/construction/content';
import { nodeProfileSchema, storeProfileSchema } from '../features/logistics/content';
import { cargoClassCode } from '../features/logistics/protocol';
import { producerSchema } from '../features/production/content';
import {
  DEFAULT_STRUCTURE_VISION_CELLS,
  visionFields,
  visionLandmarkFields,
} from '../features/vision/content';

export interface ResolvedStoreProfile {
  cargo: number;
  capacityMilli: number;
  // cargo-class code.
  cls: number;
  export: boolean;
  // Positive: self-fill (per allocation cycle); negative: drain.
  rateMilliPerCycle: number;
}

interface ResolvedNodeProfile {
  // x10 cost units (ground orthogonal step cost).
  connect: number;
  service: number;
  vehicles: number;
  warehouse: boolean;
}

// build.cost resolved to cargo indices, sorted by index (deterministic
// demand order); times in ticks; amounts in milli units.
interface ResolvedBuild {
  cost: readonly { cargo: number; milli: number }[];
  timeTicks: number;
  demolishTicks: number;
  salvageBp: number;
}

// Damage in milli units, cooldown in ticks, cost amount in milli.
// costCargo is -1 for free weapons.
export interface ResolvedWeapon {
  range: number;
  damageMilli: number;
  cooldownTicks: number;
  costCargo: number;
  costMilli: number;
}

// Inputs/outputs resolved to cargo indices and sorted by index
// (deterministic intent order); time in ticks, amounts in milli.
interface ResolvedProducer {
  inputs: readonly { cargo: number; milli: number }[];
  outputs: readonly { cargo: number; milli: number }[];
  // Unit content ids produced per cycle (alternative to outputs).
  unitOutput?: readonly string[];
  timeTicks: number;
  // Optional ramp: latest entry with atTicks <= match tick wins.
  ramp?: readonly { atTicks: number; timeTicks: number }[];
}

export interface ResolvedStructure {
  id: ContentId;
  index: number;
  footprint: { w: number; h: number };
  core?: boolean;
  hp?: number;
  build?: ResolvedBuild;
  node?: ResolvedNodeProfile;
  stores?: readonly ResolvedStoreProfile[];
  // Required deposit cargo index; -1 when the kind has none.
  requiresDeposit?: number;
  producer?: ResolvedProducer;
  weapon?: ResolvedWeapon;
  // Hostile build-exclusion radius in cells while operational.
  exclusion?: number;
  capture?: ResolvedCapture;
  // Sight radius in cells while operational (M5 fog; default 4).
  vision: number;
  // Render-only greybox height (required in content; sim never reads).
  visual: { height: number };
  // Seeded into every other faction's structure memory on the first
  // vision tick (outpost, hive).
  visionLandmark?: boolean;
}

// Capture profile resolved to ticks and squared radius (cells²) for
// integer distance checks.
interface ResolvedCapture {
  radius: number;
  radiusSq: number;
  ticks: number;
  rebuildTicks: number;
}

// Composite structure schema: construction base fields + logistics
// profiles + production and combat fields.
export const structureSchema = s.object({
  ...structureBaseFields,
  node: s.optional(nodeProfileSchema),
  stores: s.optional(s.array(storeProfileSchema, { maxLength: 4 })),
  producer: s.optional(producerSchema),
  weapon: s.optional(weaponSchema),
  capture: s.optional(captureProfileSchema),
  ...visionFields,
  ...visionLandmarkFields,
  // Faction core structure flag — modes read it via the Core component,
  // never by content id.
  core: s.optional(s.bool()),
});

export type StoreResolver = (
  owner: string,
  profiles: readonly Infer<typeof storeProfileSchema>[] | undefined,
) => ResolvedStoreProfile[] | undefined;

// units/s rates are converted to milli per allocation cycle.
export function createStoreResolver(
  cargoIndex: ReadonlyMap<string, number>,
  cycleTicks: number,
  errors: string[],
): StoreResolver {
  return (owner, profiles) => {
    if (profiles === undefined) {
      return undefined;
    }
    return profiles.map((p) => {
      const cargo = cargoIndex.get(p.cargo);
      if (cargo === undefined) {
        errors.push(`${owner} references unknown cargo '${p.cargo}'`);
      }
      return {
        cargo: cargo ?? -1,
        capacityMilli: p.capacity * MILLI,
        cls: cargoClassCode(p.class),
        export: p.export === true,
        rateMilliPerCycle: Math.round(
          (p.ratePerSecond ?? 0) * MILLI * (cycleTicks / TICKS_PER_SECOND),
        ),
      };
    });
  };
}

function resolveBuildProfile(
  id: string,
  entry: NonNullable<Infer<typeof structureSchema>['build']>,
  cargoIndex: ReadonlyMap<string, number>,
  errors: string[],
): ResolvedBuild {
  // The site phase needs one store slot per cost cargo.
  const cost: { cargo: number; milli: number }[] = [];
  for (const [cargoId, units] of Object.entries(entry.cost)) {
    const cargo = cargoIndex.get(cargoId);
    if (cargo === undefined) {
      errors.push(`structures: '${id}' build cost references unknown cargo '${cargoId}'`);
      continue;
    }
    cost.push({ cargo, milli: units * MILLI });
  }
  cost.sort((a, b) => a.cargo - b.cargo);
  if (cost.length > 4) {
    errors.push(`structures: '${id}' build cost exceeds 4 cargo slots`);
  }
  return {
    cost,
    timeTicks: Math.max(1, Math.round(entry.time * TICKS_PER_SECOND)),
    demolishTicks: Math.max(1, Math.round(entry.demolishTime * TICKS_PER_SECOND)),
    salvageBp: entry.salvageBp,
  };
}

// Shared by unit and structure weapon resolution. `owner` scopes the
// error message (e.g. "units: 'frontline_td:robot'").
export function resolveWeapon(
  owner: string,
  entry: Infer<typeof weaponSchema> | undefined,
  cargoIndex: ReadonlyMap<string, number>,
  errors: string[],
): ResolvedWeapon | undefined {
  if (entry === undefined) {
    return undefined;
  }
  let costCargo = -1;
  let costMilli = 0;
  if (entry.cost !== undefined) {
    const cargo = cargoIndex.get(entry.cost.cargo);
    if (cargo === undefined) {
      errors.push(`${owner} weapon cost references unknown cargo '${entry.cost.cargo}'`);
    } else {
      costCargo = cargo;
      costMilli = Math.round(entry.cost.amount * MILLI);
    }
  }
  return {
    range: entry.range,
    damageMilli: entry.damage * MILLI,
    cooldownTicks: Math.max(1, Math.round(entry.cooldown * TICKS_PER_SECOND)),
    costCargo,
    costMilli,
  };
}

function resolveProducer(
  id: string,
  entry: Infer<typeof producerSchema>,
  cargoIndex: ReadonlyMap<string, number>,
  unitIndex: ReadonlyMap<string, number>,
  errors: string[],
): ResolvedProducer {
  const amounts = (
    record: Record<string, number>,
    label: string,
  ): { cargo: number; milli: number }[] => {
    const out: { cargo: number; milli: number }[] = [];
    for (const [cargoId, units] of Object.entries(record)) {
      const cargo = cargoIndex.get(cargoId);
      if (cargo === undefined) {
        errors.push(`structures: '${id}' producer ${label} references unknown cargo '${cargoId}'`);
        continue;
      }
      out.push({ cargo, milli: Math.round(units * MILLI) });
    }
    return out.sort((a, b) => a.cargo - b.cargo);
  };
  const outputs = entry.outputs === undefined ? [] : amounts(entry.outputs, 'output');
  const unitOutput = entry.unitOutput ?? [];
  for (const unitId of unitOutput) {
    if (!unitIndex.has(unitId)) {
      errors.push(`structures: '${id}' producer unitOutput references unknown unit '${unitId}'`);
    }
  }
  if (outputs.length === 0 && unitOutput.length === 0) {
    errors.push(`structures: '${id}' producer has neither outputs nor unitOutput`);
  }
  const ramp =
    entry.ramp === undefined
      ? undefined
      : entry.ramp.map((step) => ({
          atTicks: step.atSeconds * TICKS_PER_SECOND,
          timeTicks: Math.max(1, Math.round(step.seconds * TICKS_PER_SECOND)),
        }));
  return {
    inputs: amounts(entry.inputs, 'input'),
    outputs,
    ...(unitOutput.length > 0 ? { unitOutput } : {}),
    timeTicks: Math.max(1, Math.round(entry.time * TICKS_PER_SECOND)),
    ...(ramp !== undefined ? { ramp } : {}),
  };
}

export function resolveStructures(
  entries: readonly Infer<typeof structureSchema>[],
  cargoIndex: ReadonlyMap<string, number>,
  unitIndex: ReadonlyMap<string, number>,
  resolveStores: StoreResolver,
  errors: string[],
): ResolvedStructure[] {
  return entries.map((entry, index) => {
    const node = entry.node;
    const stores = resolveStores(`structures: '${entry.id}'`, entry.stores);
    const build =
      entry.build === undefined
        ? undefined
        : resolveBuildProfile(entry.id, entry.build, cargoIndex, errors);
    let requiresDeposit: number | undefined;
    if (entry.requiresDeposit !== undefined) {
      const cargo = cargoIndex.get(entry.requiresDeposit);
      if (cargo === undefined) {
        errors.push(
          `structures: '${entry.id}' requiresDeposit references unknown cargo '${entry.requiresDeposit}'`,
        );
      } else {
        requiresDeposit = cargo;
      }
    }
    const producer =
      entry.producer === undefined
        ? undefined
        : resolveProducer(entry.id, entry.producer, cargoIndex, unitIndex, errors);
    const weapon = resolveWeapon(`structures: '${entry.id}'`, entry.weapon, cargoIndex, errors);
    return {
      id: entry.id,
      index,
      footprint: entry.footprint,
      visual: { height: entry.visual.height },
      ...(entry.hp !== undefined ? { hp: entry.hp } : {}),
      ...(build !== undefined ? { build } : {}),
      ...(requiresDeposit !== undefined ? { requiresDeposit } : {}),
      ...(producer !== undefined ? { producer } : {}),
      ...(weapon !== undefined ? { weapon } : {}),
      ...(entry.core === true ? { core: true } : {}),
      ...(entry.exclusion !== undefined ? { exclusion: entry.exclusion } : {}),
      vision: entry.vision ?? DEFAULT_STRUCTURE_VISION_CELLS,
      ...(entry.visionLandmark === true ? { visionLandmark: true } : {}),
      ...(entry.capture !== undefined
        ? {
            capture: {
              radius: entry.capture.radius,
              radiusSq: entry.capture.radius * entry.capture.radius,
              ticks: Math.max(1, Math.round(entry.capture.seconds * TICKS_PER_SECOND)),
              rebuildTicks: Math.max(
                1,
                Math.round(entry.capture.rebuildSeconds * TICKS_PER_SECOND),
              ),
            },
          }
        : {}),
      ...(node !== undefined
        ? {
            node: {
              // cells -> cost units (x10, ground orthogonal step cost).
              connect: Math.round(node.connect * 10),
              service: node.service,
              vehicles: node.vehicles,
              warehouse: node.warehouse === true,
            },
          }
        : {}),
      ...(stores !== undefined ? { stores } : {}),
    };
  });
}
