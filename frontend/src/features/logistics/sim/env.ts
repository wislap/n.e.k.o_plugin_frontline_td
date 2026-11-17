// Shared dependencies and per-faction state passed to the cycle,
// topology, inspector and snapshot helpers. The env object is built
// inside install() so component writers are claimed before capture.
import type { ContentDb } from '../../../content/index';
import type { EntityId } from '../../../core/index';
import type { ComponentWriter, GridLayerWriter, SystemContext } from '../../../kernel/index';
import type { TerrainApi } from '../../terrain/sim/index';
import type { CargoFields, ModWriter } from './slots';
import type { FactionTopo } from './topology';

export interface FactionState {
  // Warehouse stock in milli, by cargo index.
  stock: number[];
  // Adjustable class codes in priority order.
  priorities: number[];
  // Last-cycle unmet counts by reason code (demand / export).
  unmet: number[];
  unmetExport: number[];
  // Last-cycle per-link utilization bp and saturation flags
  // (parallel to topo.links).
  outBp: number[];
  inBp: number[];
  outSat: number[];
  inSat: number[];
}

// Attachment for a store entity: node index + last-mile path cost.
export interface Attach {
  node: number;
  lastMile: number;
}

export interface LogisticsEnv {
  db: ContentDb;
  cfg: ContentDb['logistics'];
  groundCls: number;
  energyIdx: number;
  dirt: number;
  terrain: TerrainApi;
  healthBp: (ctx: SystemContext, id: EntityId) => number;
  cargoW: ComponentWriter<CargoFields>;
  lowW: ModWriter;
  emptyW: ModWriter;
  layerW: GridLayerWriter;
  // Derived topology per faction (never serialized).
  topos: Map<number, FactionTopo>;
  // Node entity ids behind each faction's topology (change detection).
  topoNodeIds: Map<number, number[]>;
  stateOf(faction: number): FactionState;
  attachOf(
    ctx: SystemContext,
    topo: FactionTopo,
    id: number,
    px: number,
    py: number,
  ): Attach | null;
}
