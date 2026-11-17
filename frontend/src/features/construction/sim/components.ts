// Construction-owned components (ADR 0012): placed structures, in-flight
// build/demolish progress, reserved blueprints and salvage drops.
import { defineComponent } from '../../../kernel/index';

// A placed structure (site or building); x,y is the footprint top-left.
export const Structure = defineComponent('frontline_td:structure', {
  kind: 'u16',
  x: 'u16',
  y: 'u16',
});

export const MODE_BUILD = 0;
export const MODE_DEMOLISH = 1;

// Build/demolish progress in ticks.
export const Construction = defineComponent('frontline_td:construction_progress', {
  progress: 'u32',
  total: 'u32',
  mode: 'u8',
});

// A reserved blueprint: Faction + Blueprint only (no InWorld/Position),
// invisible to other factions and to every system but construction.
export const Blueprint = defineComponent('frontline_td:blueprint', {
  kind: 'u16',
  x: 'u16',
  y: 'u16',
  activated: 'u8',
  orderTick: 'u32',
});

// Refund pile shipped home through logistics export slots.
export const Salvage = defineComponent('frontline_td:salvage', {});

// A live road-build segment; `project` indexes the construction module's
// serialized road-project list.
export const RoadSegment = defineComponent('frontline_td:road_segment', {
  project: 'u32',
});
