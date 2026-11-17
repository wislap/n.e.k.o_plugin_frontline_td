// Road projects (m3 E1): the upgrade_links command, serialized project
// state, segment spawn/progress, cancel and the per-observer road-works
// channel. A project paves its link's polyline upstream -> downstream in
// 8-cell segments; each live segment is a buildable, attackable entity
// attached to the project's upstream node (FixedAttach).
import type { ContentDb } from '../../../content/index';
import type { EntityHandle, EntityId, FactionId } from '../../../core/index';
import { floorDiv } from '../../../core/index';
import type { SimBuilder, SystemContext } from '../../../kernel/index';
import { Faction, InWorld, UnderConstruction } from '../../../kernel/index';
import { Position } from '../../movement/sim/index';
import { RoadWorksChannel, UpgradeLinksCommand } from '../protocol';
import type { RoadSegmentDesc, RoadWorks } from '../protocol';
import { Construction, MODE_BUILD, RoadSegment } from './components';
import type { ConstructionEnv, RoadProject } from './env';
import { deliveredAllowed, siteRefund, spawnSalvage } from './spawn';

// Cells of the project's `next` segment.
function segmentSpan(env: ConstructionEnv, p: RoadProject): { start: number; cells: number[] } {
  const start = p.next * env.db.logistics.segmentCells;
  return { start, cells: p.cells.slice(start, start + env.db.logistics.segmentCells) };
}

// Spawn the live segment for a project (one at a time, warehouse side
// first). Parts come from the injected factories (logistics site slots +
// FixedAttach, combat Health + Targetable).
function spawnRoadSegment(
  env: ConstructionEnv,
  ctx: SystemContext,
  p: RoadProject,
  pid: number,
): void {
  const lvl = env.db.logistics.roadLevels[p.level];
  const { start, cells } = segmentSpan(env, p);
  if (lvl === undefined || cells.length === 0) {
    env.projects.delete(pid);
    return;
  }
  const w = env.terrain.width;
  const mid = cells[cells.length >> 1] ?? 0;
  const desc: RoadSegmentDesc = {
    level: p.level,
    cells: cells.length,
    totalTicks: cells.length * (lvl.ticksPerCell ?? 1),
    hp: lvl.segmentHp ?? 1,
    cost: (lvl.cost ?? []).map((c) => ({ cargo: c.cargo, milli: c.milli * cells.length })),
    node: p.upstream,
    // Last mile = cumulative path cost to the segment's far end.
    lastMile: p.cum[start + cells.length - 1] ?? 0,
  };
  const handle = ctx.spawn([
    [Faction, { id: p.faction }],
    [InWorld],
    [Position, { x: (mid % w) + 0.5, y: ((mid / w) | 0) + 0.5 }],
    [UnderConstruction],
    [Construction, { progress: 0, total: desc.totalTicks, mode: MODE_BUILD }],
    [RoadSegment, { project: pid }],
    ...env.segmentParts.flatMap((f) => f(desc, ctx.tick)),
  ]);
  p.segment = Number(handle);
}

// End a project without refund (destroyed segment: materials lost).
export function endProjectOfSegment(env: ConstructionEnv, ctx: SystemContext, id: number): void {
  const seg = ctx.read(RoadSegment);
  env.projects.delete(seg.project[id] ?? -1);
}

// Cancel the live segment: delivered materials -> salvage, project ends.
export function cancelRoadSegment(
  env: ConstructionEnv,
  ctx: SystemContext,
  id: number,
  handle: EntityHandle,
): void {
  const fac = ctx.read(Faction);
  const pos = ctx.read(Position);
  spawnSalvage(
    ctx,
    (fac.id[id] ?? 0) as FactionId,
    pos.x[id] ?? 0,
    pos.y[id] ?? 0,
    siteRefund(ctx, id),
  );
  endProjectOfSegment(env, ctx, id);
  ctx.despawn(handle);
}

export function registerRoads(
  builder: SimBuilder,
  env: ConstructionEnv,
  db: ContentDb,
  healthBp?: (ctx: SystemContext, id: number) => number,
): void {
  // Projects serialize in id order together with the id counter so a
  // restored run allocates the same project ids as an uninterrupted one.
  builder.state('frontline_td:construction.road_projects', {
    save() {
      return {
        next: env.nextProjectId,
        projects: [...env.projects.entries()]
          .sort((x, y) => x[0] - y[0])
          .map(([id, p]) => ({
            id,
            faction: p.faction,
            level: p.level,
            cells: [...p.cells],
            cum: [...p.cum],
            next: p.next,
            segment: p.segment,
            upstream: p.upstream,
            a: p.a,
            b: p.b,
          })),
      };
    },
    load(data) {
      const raw = data as unknown as {
        next: number;
        projects: (RoadProject & { id: number })[];
      };
      env.nextProjectId = raw.next;
      env.projects = new Map(
        raw.projects.map((p) => [p.id, { ...p, cells: [...p.cells], cum: [...p.cum] }]),
      );
    },
  });

  builder.command(UpgradeLinksCommand, (ctx, payload, issuer) => {
    const lvl = db.logistics.roadLevels[payload.level];
    if (payload.level < 1 || lvl?.cost === undefined) {
      ctx.reject('invalid_target');
      return;
    }
    // Validate every link before mutating: resolve the link, skip active
    // duplicates and cells already >= level; a batch that ends up empty
    // rejects without spawning anything.
    const accepted: { cells: number[]; cum: number[]; upstream: number; a: number; b: number }[] =
      [];
    let sawUpgraded = false;
    const pairs = new Set<number>();
    for (const l of payload.links) {
      const path = env.logistics.linkPath(ctx, issuer, l.a, l.b);
      if (path === null) {
        continue;
      }
      const a = Math.min(path.nodeA, path.nodeB);
      const b = Math.max(path.nodeA, path.nodeB);
      const key = a * 4294967296 + b;
      if (pairs.has(key)) {
        continue;
      }
      if ([...env.projects.values()].some((p) => p.a === a && p.b === b)) {
        continue;
      }
      const cells: number[] = [];
      const cum: number[] = [];
      for (let k = 0; k < path.cells.length; k++) {
        if ((path.roads[k] ?? 0) < payload.level) {
          cells.push(path.cells[k] ?? 0);
          cum.push(path.cum[k] ?? 0);
        }
      }
      if (cells.length === 0) {
        sawUpgraded = true;
        continue;
      }
      pairs.add(key);
      accepted.push({ cells, cum, upstream: path.upstream, a, b });
    }
    if (accepted.length === 0) {
      ctx.reject(sawUpgraded ? 'already_upgraded' : 'no_targets');
      return;
    }
    for (const acc of accepted) {
      const p: RoadProject = {
        faction: issuer,
        level: payload.level,
        cells: acc.cells,
        cum: acc.cum,
        next: 0,
        segment: 0,
        upstream: acc.upstream,
        a: acc.a,
        b: acc.b,
      };
      const pid = env.nextProjectId;
      env.nextProjectId += 1;
      env.projects.set(pid, p);
      spawnRoadSegment(env, ctx, p, pid);
    }
  });

  // Per tick: segment build progress capped by delivered materials; on
  // completion pave the segment cells and spawn the next segment (or end
  // the project). A dead upstream node leaves the segment's FixedAttach
  // dangling -> logistics reports `disconnected` and progress waits.
  builder.system({
    id: 'frontline_td:construction.road_progress',
    phase: 'construction',
    run(ctx) {
      const consR = ctx.read(Construction);
      const cons = ctx.write(env.constructionW);
      const w = env.terrain.width;
      for (const id of ctx.query([Construction, RoadSegment])) {
        const pi = ctx.read(RoadSegment).project[id] ?? -1;
        const p = env.projects.get(pi);
        const handle = ctx.handleOf(id as EntityId);
        if (p === undefined || handle === null) {
          continue;
        }
        const total = consR.total[id] ?? 1;
        const allowed = deliveredAllowed(ctx, id, total);
        const next = Math.min((consR.progress[id] ?? 0) + 1, allowed);
        cons.progress[id] = next;
        if (next < total) {
          continue;
        }
        const { cells } = segmentSpan(env, p);
        env.logistics.pave(
          cells.map((c) => ({ x: c % w, y: (c / w) | 0 })),
          p.level,
        );
        ctx.despawn(handle);
        p.next += 1;
        p.segment = 0;
        if (p.next * env.db.logistics.segmentCells < p.cells.length) {
          spawnRoadSegment(env, ctx, p, pi);
        } else {
          env.projects.delete(pi);
        }
      }
    },
  });

  builder.snapshotChannel(RoadWorksChannel, (ctx, observer) => {
    const fac = ctx.read(Faction);
    const pos = ctx.read(Position);
    const cons = ctx.read(Construction);
    const segIds = ctx
      .query([RoadSegment, InWorld, Faction])
      .filter((id) => (fac.id[id] ?? -1) === observer);
    const n = segIds.length;
    const segments = {
      handles: new Float64Array(n),
      x: new Float32Array(n),
      y: new Float32Array(n),
      progressBp: new Uint16Array(n),
      hpBp: new Uint16Array(n),
    };
    segIds.forEach((id, i) => {
      segments.handles[i] = Number(ctx.handleOf(id as EntityId) ?? 0);
      segments.x[i] = pos.x[id] ?? 0;
      segments.y[i] = pos.y[id] ?? 0;
      const total = cons.total[id] ?? 0;
      segments.progressBp[i] =
        total <= 0 ? 10000 : Math.min(10000, floorDiv((cons.progress[id] ?? 0) * 10000, total));
      segments.hpBp[i] = healthBp?.(ctx, id) ?? 10000;
    });
    const open = [...env.projects.values()].filter((p) => p.faction === observer);
    const projects = {
      offsets: new Uint32Array(open.length + 1),
      cells: new Uint32Array(open.reduce((s, p) => s + p.cells.length, 0)),
      built: new Uint16Array(open.length),
      level: new Uint8Array(open.length),
    };
    let off = 0;
    open.forEach((p, i) => {
      projects.offsets[i] = off;
      projects.built[i] = Math.min(p.next * env.db.logistics.segmentCells, p.cells.length);
      projects.level[i] = p.level;
      for (const c of p.cells) {
        projects.cells[off] = c;
        off += 1;
      }
    });
    projects.offsets[open.length] = off;
    const out: RoadWorks = { segments, projects };
    return out;
  });
}
