// Snapshot-backed PlacementView adapter (M3 D; moved to rules/ in M4 so
// eval bots share it): the build ghost previews
// the shared placement rules against the latest snapshot — terrain
// height/surface/blocked layers, the observer's service-coverage layer,
// and own blueprints from the structures channel. `connects` approximates
// the sim's path-cost check with straight-line edge distance, so the
// preview may pass where the sim later rejects; the rejection toast then
// explains the real reason.
import { readChannel, readLayer } from '../../../core/index';
import type { Snapshot } from '../../../core/index';
import type { ContentDb, ResolvedMap } from '../../../content/index';
import type { PlacementView } from './placement';
import { StructuresChannel, STATE_BLUEPRINT, STATE_OPERATIONAL, STATE_WAITING } from '../protocol';
import { SERVICE_LAYER_ID } from '../../logistics/protocol';
import {
  TERRAIN_BLOCKED_LAYER_ID,
  TERRAIN_HEIGHT_LAYER_ID,
  TERRAIN_SURFACE_LAYER_ID,
} from '../../terrain/protocol';
import { VisionMemoryChannel } from '../../vision/protocol';

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
  // Hostility predicate over channel factions; default treats every
  // non-own, non-neutral faction as hostile (correct for the current
  // two-faction matches — clients with relations inject their own).
  isHostile?: (faction: number) => boolean,
): PlacementView {
  const hostile = isHostile ?? ((f) => f !== 0 && f !== observer);
  const { width, height } = map.grid;
  const heights = readLayer(snapshot, TERRAIN_HEIGHT_LAYER_ID) ?? map.grid.heights;
  const surfaces = readLayer(snapshot, TERRAIN_SURFACE_LAYER_ID) ?? map.grid.surfaces;
  const blocked = readLayer(snapshot, TERRAIN_BLOCKED_LAYER_ID) ?? undefined;
  const service = readLayer(snapshot, `${SERVICE_LAYER_ID}#${observer}`) ?? undefined;
  const groundCls = db.movementClasses.byId('frontline_td:ground')?.index ?? 0;
  const channel = readChannel(snapshot, StructuresChannel) ?? undefined;

  const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  const idx = (x: number, y: number): number => y * width + x;

  // Own footprints from the channel: blueprints reserve, completed nodes
  // are `connects` anchors.
  const reservations: { x: number; y: number; w: number; h: number }[] = [];
  const nodes: { x: number; y: number; w: number; h: number; connect: number }[] = [];
  const excluders: { cx: number; cy: number; r: number }[] = [];
  if (channel !== undefined) {
    for (let i = 0; i < channel.handles.length; i++) {
      const kind = db.structures.byIndex(channel.kind[i] ?? 0);
      if (kind === undefined) {
        continue;
      }
      const x = channel.x[i] ?? 0;
      const y = channel.y[i] ?? 0;
      const state = channel.state[i] ?? 0;
      const faction = channel.faction[i] ?? 0;
      if (faction === observer) {
        if (state === STATE_BLUEPRINT || state === STATE_WAITING) {
          reservations.push({ x, y, w: kind.footprint.w, h: kind.footprint.h });
        } else if (state === STATE_OPERATIONAL && kind.node !== undefined) {
          nodes.push({
            x,
            y,
            w: kind.footprint.w,
            h: kind.footprint.h,
            connect: kind.node.connect,
          });
        }
      } else if (state === STATE_OPERATIONAL && kind.exclusion !== undefined && hostile(faction)) {
        excluders.push({
          cx: x + kind.footprint.w / 2,
          cy: y + kind.footprint.h / 2,
          r: kind.exclusion,
        });
      }
    }
  }
  // Remembered hostile structures (vision memory) keep excluding: the
  // sim still applies the zone while the structure may be alive unseen.
  // Memory rows only ever list non-visible rows, so no live-row dupes.
  const memory = readChannel(snapshot, VisionMemoryChannel) ?? undefined;
  if (memory !== undefined) {
    for (let i = 0; i < memory.handles.length; i++) {
      const kind = db.structures.byIndex(memory.kind[i] ?? 0);
      if (kind === undefined) {
        continue;
      }
      if (
        (memory.state[i] ?? -1) === STATE_OPERATIONAL &&
        kind.exclusion !== undefined &&
        hostile(memory.faction[i] ?? 0)
      ) {
        const x = memory.x[i] ?? 0;
        const y = memory.y[i] ?? 0;
        excluders.push({
          cx: x + kind.footprint.w / 2,
          cy: y + kind.footprint.h / 2,
          r: kind.exclusion,
        });
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
    // Same metric as the sim: footprint-centre cell centre vs the
    // excluder's structure centre, squared radius.
    excluded: (x, y) =>
      excluders.some((e) => {
        const dx = x + 0.5 - e.cx;
        const dy = y + 0.5 - e.cy;
        return dx * dx + dy * dy <= e.r * e.r;
      }),
  };
}
