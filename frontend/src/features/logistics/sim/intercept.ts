// Corridor interception (m3 E2): per link, sum the strength of hostile
// in-world interceptors whose position lies within corridorWidth of any
// polyline cell centre, with a bounding-box prefilter. The sum is an
// integer accumulation in entity-id query order — order-independent.
import type { FactionId } from '../../../core/index';
import type { SystemContext } from '../../../kernel/index';
import { Faction, InWorld } from '../../../kernel/index';
import { Position } from '../../movement/sim/index';
import { Interceptor } from './components';
import type { LogisticsEnv } from './env';
import type { FactionTopo } from './topology';

// Returns the interception reduction in bp per link (0..N*10000; the
// caller clamps the resulting quota factor at 0).
export function interceptReductions(
  env: LogisticsEnv,
  ctx: SystemContext,
  topo: FactionTopo,
  faction: FactionId,
): number[] {
  const out = new Array<number>(topo.links.length).fill(0);
  const inter = ctx.read(Interceptor);
  const pos = ctx.read(Position);
  const fac = ctx.read(Faction);
  const units: { x: number; y: number; s: number }[] = [];
  for (const id of ctx.query([Interceptor, Position, InWorld, Faction])) {
    if (!ctx.isHostile(faction, (fac.id[id] ?? 0) as FactionId)) {
      continue;
    }
    units.push({ x: pos.x[id] ?? 0, y: pos.y[id] ?? 0, s: inter.strengthBp[id] ?? 0 });
  }
  if (units.length === 0) {
    return out;
  }
  const w = env.cfg.corridorWidth;
  const w2 = w * w;
  const width = env.terrain.width;
  topo.links.forEach((link, li) => {
    // Bbox of the polyline, widened by the corridor.
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of link.cells) {
      const cx = c % width;
      const cy = (c / width) | 0;
      if (cx < x0) {
        x0 = cx;
      }
      if (cx > x1) {
        x1 = cx;
      }
      if (cy < y0) {
        y0 = cy;
      }
      if (cy > y1) {
        y1 = cy;
      }
    }
    for (const u of units) {
      if (u.x < x0 - w || u.x > x1 + 1 + w || u.y < y0 - w || u.y > y1 + 1 + w) {
        continue;
      }
      for (const c of link.cells) {
        const cx = (c % width) + 0.5;
        const cy = ((c / width) | 0) + 0.5;
        const dx = u.x - cx;
        const dy = u.y - cy;
        if (dx * dx + dy * dy <= w2) {
          out[li] = (out[li] ?? 0) + u.s;
          break;
        }
      }
    }
  });
  return out;
}
