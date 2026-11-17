// Director-warning helpers (M4): which hostile squads threaten the
// observer, and how to lay out their stored route. Pure and unit-testable;
// the layer and the HUD banner both read from here.
import type { SquadView } from '../protocol';

// Hostile squads currently gathering (visible marker + countdown).
export function gatheringThreats(squads: readonly SquadView[], observer: number): SquadView[] {
  return squads.filter((s) => s.faction !== observer && s.order.kind === 'gather');
}

// Hostile squads with a stored route — gathering waves plus launched
// waves still en route (order advance until they arrive).
export function routedThreats(squads: readonly SquadView[], observer: number): SquadView[] {
  return squads.filter(
    (s) =>
      s.faction !== observer &&
      s.route !== undefined &&
      (s.order.kind === 'gather' || s.order.kind === 'advance'),
  );
}

// Flat [x,y,x,y,…] route → waypoint pairs.
export function routePoints(route: readonly number[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < route.length; i += 2) {
    out.push({ x: route[i] ?? 0, y: route[i + 1] ?? 0 });
  }
  return out;
}

export interface ArrowSpot {
  x: number;
  y: number;
  // Direction to the next waypoint (not normalized — callers normalize).
  dx: number;
  dy: number;
}

// Arrowhead positions every `every` waypoints, pointing at the next one.
export function arrowSpots(route: readonly number[], every: number = 8): ArrowSpot[] {
  const pts = routePoints(route);
  const out: ArrowSpot[] = [];
  for (let i = 0; i + 1 < pts.length; i += every) {
    const a = pts[i];
    const b = pts[Math.min(i + every, pts.length - 1)];
    if (a === undefined || b === undefined) {
      continue;
    }
    out.push({ x: a.x, y: a.y, dx: b.x - a.x, dy: b.y - a.y });
  }
  return out;
}

// Banner summary while any gather is visible: biggest gathering squad's
// member count and the soonest launch.
export function bannerThreat(
  squads: readonly SquadView[],
  observer: number,
  tick: number,
): { count: number; ticksLeft: number } | null {
  const gathers = gatheringThreats(squads, observer);
  if (gathers.length === 0) {
    return null;
  }
  let count = 0;
  let ticksLeft = Number.POSITIVE_INFINITY;
  for (const s of gathers) {
    count = Math.max(count, s.memberCount);
    if (s.order.launchTick !== undefined) {
      ticksLeft = Math.min(ticksLeft, s.order.launchTick - tick);
    }
  }
  if (!Number.isFinite(ticksLeft)) {
    ticksLeft = 0;
  }
  return { count, ticksLeft };
}
