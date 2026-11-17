// Logistics components (ADR 0025). CargoStore is a fixed four-slot store
// (0xFFFF cargo = empty); amounts and rates are milli; rates are milli per
// allocation cycle.
import { defineComponent, defineModifier } from '../../../kernel/index';
import { MoveSpeed } from '../../movement/sim/index';

export const CARGO_SLOTS = 4;
export const EMPTY_CARGO = 0xffff;

export const CargoStore = defineComponent('frontline_td:logistics.cargo_store', {
  cargo0: 'u16',
  cap0: 'i32',
  amt0: 'i32',
  cls0: 'u8',
  flags0: 'u8',
  since0: 'u32',
  rate0: 'i32',
  unmet0: 'u8',
  cargo1: 'u16',
  cap1: 'i32',
  amt1: 'i32',
  cls1: 'u8',
  flags1: 'u8',
  since1: 'u32',
  rate1: 'i32',
  unmet1: 'u8',
  cargo2: 'u16',
  cap2: 'i32',
  amt2: 'i32',
  cls2: 'u8',
  flags2: 'u8',
  since2: 'u32',
  rate2: 'i32',
  unmet2: 'u8',
  cargo3: 'u16',
  cap3: 'i32',
  amt3: 'i32',
  cls3: 'u8',
  flags3: 'u8',
  since3: 'u32',
  rate3: 'i32',
  unmet3: 'u8',
  // Entity handle of the paying node that ran out of budget last cycle
  // (0 = none).
  bottleneck: 'f64',
});

// connect: max link path cost in cost units (cell = 10); service: coverage
// radius in cells; w/h: structure footprint (B1 uses it for link rings).
export const LogisticsNode = defineComponent('frontline_td:logistics.node', {
  connect: 'i32',
  service: 'f64',
  vehicles: 'u16',
  warehouse: 'u8',
  w: 'u8',
  h: 'u8',
});

// Marks an under-construction structure; kind is the structure content
// index. Removed by the site-conversion pass when UnderConstruction goes.
export const SiteStore = defineComponent('frontline_td:logistics.site', {
  kind: 'u16',
});

// Fixed attachment for entities that bind to one specific node (road
// segments): node entity id + generation at spawn time and the last-mile
// cost to the attach point. attachOf prefers this over coverage.
export const FixedAttach = defineComponent('frontline_td:logistics.fixed_attach', {
  node: 'u32',
  gen: 'u32',
  lastMile: 'i32',
});

// Interception strength (bp) this entity applies to hostile link quotas
// inside the corridor around link polylines. Injected via unitParts.
export const Interceptor = defineComponent('frontline_td:logistics.interceptor', {
  strengthBp: 'i32',
});

// Supply-state modifiers; the values come from the pack logistics config
// (lowSpeedBp) and the spec-fixed −10000 for empty.
export const EnergyLowModifier = defineModifier(
  'frontline_td:logistics.energy_low',
  MoveSpeed,
  'mul_bp',
);
export const EnergyEmptyModifier = defineModifier(
  'frontline_td:logistics.energy_empty',
  MoveSpeed,
  'mul_bp',
);
