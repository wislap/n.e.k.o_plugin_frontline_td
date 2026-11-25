// Construction protocol (ADR 0012, ADR 0023): the place/activate/cancel
// commands, the completion event, the per-observer structures/salvage
// snapshot channels, and the shared state/reason codes.
import { defineCommand, defineEvent, defineSnapshotChannel, s } from '../../core/index';

// construction.place: kind is a structure content id; blueprint spawns a
// reservation instead of a site.
export const PlaceCommand = defineCommand(
  'frontline_td:construction.place',
  s.object({
    kind: s.contentId(),
    x: s.int({ min: 0 }),
    y: s.int({ min: 0 }),
    blueprint: s.bool(),
  }),
);

// construction.activate: activate blueprint handles for auto-start.
export const ActivateCommand = defineCommand(
  'frontline_td:construction.activate',
  s.object({
    blueprints: s.array(s.int({ min: 0 }), { maxLength: 256 }),
  }),
);

// construction.cancel: blueprint -> despawn; build site -> salvage of
// delivered materials; finished building -> demolition.
export const CancelCommand = defineCommand(
  'frontline_td:construction.cancel',
  s.object({
    targets: s.array(s.int({ min: 0 }), { maxLength: 256 }),
  }),
);

// construction.upgrade_links: order road projects on links between own
// nodes (a/b are node entity handles); level is a roadLevels index.
export const UpgradeLinksCommand = defineCommand(
  'frontline_td:construction.upgrade_links',
  s.object({
    links: s.array(s.object({ a: s.int({ min: 0 }), b: s.int({ min: 0 }) }), {
      maxLength: 64,
    }),
    level: s.int({ min: 0 }),
  }),
);

// Data handed to the injected road-segment parts factories (logistics
// contributes site slots + FixedAttach, combat Health + Targetable).
export interface RoadSegmentDesc {
  // Road level being built (roadLevels index).
  level: number;
  // Cells in this segment.
  cells: number;
  // Build duration in ticks.
  totalTicks: number;
  // Flat segment hit points (units).
  hp: number;
  // Site material demand (cargo index -> milli), already x cells.
  cost: readonly { cargo: number; milli: number }[];
  // Upstream node entity handle (FixedAttach target).
  node: number;
  // Path cost from the upstream node to the segment's far end.
  lastMile: number;
}

// Per-observer road-works snapshot: live segments plus planned projects.
export interface RoadWorks {
  segments: {
    handles: Float64Array;
    x: Float32Array;
    y: Float32Array;
    progressBp: Uint16Array;
    hpBp: Uint16Array;
  };
  projects: {
    // Project i's cells occupy cells[offsets[i]..offsets[i+1]].
    offsets: Uint32Array;
    cells: Uint32Array;
    // Cells already paved by this project.
    built: Uint16Array;
    level: Uint8Array;
  };
}
export const RoadWorksChannel = defineSnapshotChannel<RoadWorks>(
  'frontline_td:construction.roadworks',
);

export type ConstructionCompletedPayload = {
  handle: number;
  // Structure content index.
  kind: number;
  // Owning faction; required for 'issuer' visibility filtering.
  issuer: number;
};
export const ConstructionCompleted = defineEvent<ConstructionCompletedPayload>(
  'frontline_td:construction.completed',
  'issuer',
);

// Structures channel row states.
export const STATE_BLUEPRINT = 0;
export const STATE_WAITING = 1;
export const STATE_SITE = 2;
export const STATE_OPERATIONAL = 3;
export const STATE_DEMOLISHING = 4;
export const STATE_RUIN = 5;
export const STATE_NAMES = [
  'blueprint',
  'waiting',
  'site',
  'operational',
  'demolishing',
  'ruin',
] as const;

export interface ConstructionStructures {
  handles: Float64Array;
  // Structure content index.
  kind: Uint16Array;
  // Footprint top-left cell.
  x: Uint16Array;
  y: Uint16Array;
  faction: Uint16Array;
  state: Uint8Array;
  progressBp: Uint16Array;
  // 10000 until combat (batch C) adds health.
  hpBp: Uint16Array;
}
export const StructuresChannel = defineSnapshotChannel<ConstructionStructures>(
  'frontline_td:construction.structures',
);

export interface ConstructionSalvage {
  handles: Float64Array;
  x: Float32Array;
  y: Float32Array;
}
export const SalvageChannel = defineSnapshotChannel<ConstructionSalvage>(
  'frontline_td:construction.salvage',
);

// Inspector section id for construction entities.
export const CONSTRUCTION_INSPECTOR_ID = 'frontline_td:construction';

// String state names corresponding to StructuresChannel row states.
export type ConstructionStateName = (typeof STATE_NAMES)[number];

export function structureStateName(code: number): ConstructionStateName {
  return STATE_NAMES[code] ?? 'operational';
}

// Delivered vs required cargo amounts for a single construction site slot.
export type ConstructionSiteSlot = {
  cargo: number;
  required: number;
  delivered: number;
};

// Inspector section payload emitted by frontline_td:construction.
export type ConstructionInspection = {
  state: ConstructionStateName;
  kind: string;
  x: number;
  y: number;
  progress: number;
  total: number;
  progressBp: number;
  waiting?: string | null;
  slots?: ConstructionSiteSlot[];
};
