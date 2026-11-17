// Logistics protocol (ADR 0025): the intents other features emit, the
// set_priorities command, the per-observer network snapshot channel, and
// the shared cargo-class / unmet-reason codes.
import { defineCommand, defineIntent, defineSnapshotChannel, s } from '../../core/index';

// Cargo slot class codes (CargoStore.cls{i}).
export const CARGO_CONSTRUCTION = 1;
export const CARGO_PRODUCTION = 2;
export const CARGO_RESERVE = 3;
export const CARGO_CLASSES = ['lifeline', 'construction', 'production', 'reserve'] as const;
export type CargoClassName = (typeof CARGO_CLASSES)[number];
export function cargoClassCode(name: CargoClassName): number {
  return CARGO_CLASSES.indexOf(name);
}
// Classes a faction can reorder; lifeline is always first, reserve last.
export const ADJUSTABLE_CLASSES = ['construction', 'production'] as const;

// Unmet-demand reason codes (CargoStore.unmet{i}).
export const UNMET_NONE = 0;
export const UNMET_NOT_COVERED = 1;
export const UNMET_NO_STOCK = 2;
export const UNMET_DISCONNECTED = 3;
export const UNMET_NO_CAPACITY = 4;
export const UNMET_REASONS = [
  'none',
  'not_covered',
  'no_stock',
  'disconnected',
  'no_capacity',
] as const;

// Per-faction coverage layer id (u8, perFaction).
export const SERVICE_LAYER_ID = 'frontline_td:logistics.service';

// Global road-level layer id (u8): 0 = dirt, >=1 paved level.
export const ROAD_LAYER_ID = 'frontline_td:logistics.road';

// CargoStore slot flag bits.
export const SLOT_EXPORT = 1;
export const SLOT_SITE = 2;

// Other features only emit these; logistics is the sole reader/resolver.
// cargo is the content-registry index, amount is milli.
export type StoreTransferPayload = {
  handle: number;
  cargo: number;
  amount: number;
};
export const ConsumeIntent = defineIntent<StoreTransferPayload>('frontline_td:logistics.consume');
export const DepositIntent = defineIntent<StoreTransferPayload>('frontline_td:logistics.deposit');

export const SetPrioritiesCommand = defineCommand(
  'frontline_td:logistics.set_priorities',
  s.object({
    order: s.array(s.enumOf(ADJUSTABLE_CLASSES), { maxLength: ADJUSTABLE_CLASSES.length }),
  }),
);

export interface LogisticsNetwork {
  // Warehouse stock in milli, by cargo index.
  stock: number[];
  nodes: {
    handles: Float64Array;
    x: Float32Array;
    y: Float32Array;
  };
  links: {
    a: Uint16Array;
    b: Uint16Array;
    outBp: Uint16Array;
    inBp: Uint16Array;
    // 1 when the direction's payer ended the cycle at <= 1% budget and
    // the link carried flow that way this cycle.
    outSat: Uint8Array;
    inSat: Uint8Array;
    // pathCells row ranges: link i occupies pathOffsets[i]..pathOffsets[i+1].
    pathOffsets: Uint32Array;
    // Cell indices (y * width + x) along each link's ground path.
    pathCells: Uint32Array;
    // Effective (road-weighted) multiplier in bp.
    m: Uint32Array;
    // Full-budget quota per direction in milli (interception applied).
    quotaOut: Int32Array;
    quotaIn: Int32Array;
    // Cargo milli actually carried last cycle per direction.
    volOut: Int32Array;
    volIn: Int32Array;
    // Interception reduction in bp (0 = clear corridor).
    intercept: Uint16Array;
  };
  // Demand slots that ended the last cycle unmet, by reason code.
  unmet: number[];
  // Export slots that failed to ship home last cycle, by reason code.
  unmetExport: number[];
  // Full class order names, best-first (lifeline always first).
  priorities: string[];
}

export const LogisticsNetworkChannel = defineSnapshotChannel<LogisticsNetwork>(
  'frontline_td:logistics.network',
);
