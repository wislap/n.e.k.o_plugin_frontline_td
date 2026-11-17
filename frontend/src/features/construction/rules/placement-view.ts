// Snapshot-backed PlacementView adapter (M3 D; moved to rules/ in M4 so
// eval bots share it): the build ghost previews
// the shared placement rules against the latest snapshot — terrain
// height/surface/blocked layers, the observer's service-coverage layer,
// and own blueprints from the structures channel. `connects` approximates
// the sim's path-cost check with straight-line edge distance, so the
// preview may pass where the sim later rejects; the rejection toast then
// explains the real reason.
import type { Snapshot } from '../../../core/index';
import type { ContentDb, ResolvedMap } from '../../../content/index';
import type { PlacementView } from './placement';
import {
  StructuresChannel,
  STATE_BLUEPRINT,
  STATE_OPERATIONAL,
  STATE_WAITING,
  type ConstructionStructures,
} from '../protocol';
import { SERVICE_LAYER_ID } from '../../logistics/protocol';
import {
  TERRAIN_BLOCKED_LAYER_ID,
  TERRAIN_HEIGHT_LAYER_ID,
  TERRAIN_SURFACE_LAYER_ID,
} from '../../terrain/protocol';

// Conservative edge-to-edge estimate between two footprints: centre
// distance minus each footprint's half extent along the dominant axis.
function edgeDistance(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): number {
  const dx = Math.max(0, Math.abs(bx - ax) - (aw + bw) / 2);
  const dy = Math.max(0, Math.abs(by - ay) - (ah + bh) / 2);
  return Math.sqrt(dx * dx + dy * dy);
}

export function makePlacementView(
  db: ContentDb,
  map: ResolvedMap,
  snapshot: Snapshot,
  observer: number,
): PlacementView {
  const { width, height } = map.grid;
  const heights =
    (snapshot.layers[TERRAIN_HEIGHT_LAYER_ID] as Uint8Array | undefined) ?? map.grid.heights;
  const surfaces =
    (snapshot.layers[TERRAIN_SURFACE_LAYER_ID] as Uint16Array | undefined) ?? map.grid.surfaces;
  const blocked = snapshot.layers[TERRAIN_BLOCKED_LAYER_ID] as Uint8Array | undefined;
  const service = snapshot.layers[`${SERVICE_LAYER_ID}#${observer}`] as Uint8Array | undefined;
  const groundCls = db.movementClasses.byId('frontline_td:ground')?.index ?? 0;
  const channel = snapshot.channels[StructuresChannel.id] as ConstructionStructures | undefined;

  const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  const idx = (x: number, y: number): number => y * width + x;

  // Own footprints from the channel: blueprints reserve, completed nodes
  // are `connects` anchors.
  const reservations: { x: number; y: number; w: number; h: number }[] = [];
  const nodes: { x: number; y: number; w: number; h: number; connect: number }[] = [];
  if (channel !== undefined) {
    for (let i = 0; i < channel.handles.length; i++) {
      if ((channel.faction[i] ?? 0) !== observer) {
        continue;
      }
      const kind = db.structures.byIndex(channel.kind[i] ?? 0);
      if (kind === undefined) {
        continue;
      }
      const x = channel.x[i] ?? 0;
      const y = channel.y[i] ?? 0;
      const state = channel.state[i] ?? 0;
      if (state === STATE_BLUEPRINT || state === STATE_WAITING) {
        reservations.push({ x, y, w: kind.footprint.w, h: kind.footprint.h });
      } else if (state === STATE_OPERATIONAL && kind.node !== undefined) {
        nodes.push({ x, y, w: kind.footprint.w, h: kind.footprint.h, connect: kind.node.connect });
      }
    }
  }

  return {
    width,
    height,
    passable: (x, y) =>
      inBounds(x, y) &&
      (db.surfaces.byIndex(surfaces[idx(x, y)] ?? 0)?.costs[groundCls] ?? -1) >= 0,
    heightAt: (x, y) => (inBounds(x, y) ? (heights[idx(x, y)] ?? 0) : -1),
    isRamp: (x, y) => inBounds(x, y) && (map.grid.ramps[idx(x, y)] ?? 0) !== 0,
    blocked: (x, y) => inBounds(x, y) && (blocked?.[idx(x, y)] ?? 0) !== 0,
    reservedByOwn: (x, y) =>
      reservations.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h),
    covered: (x, y) => inBounds(x, y) && (service?.[idx(x, y)] ?? 0) !== 0,
    depositAt: (x, y) =>
      inBounds(x, y) ? (db.surfaces.byIndex(surfaces[idx(x, y)] ?? 0)?.deposit ?? -1) : -1,
    connects: (rule, x, y) =>
      nodes.some(
        (n) =>
          edgeDistance(
            x + rule.w / 2,
            y + rule.h / 2,
            rule.w,
            rule.h,
            n.x + n.w / 2,
            n.y + n.h / 2,
            n.w,
            n.h,
          ) *
            10 <=
          Math.min(rule.connect, n.connect),
      ),
  };
}
