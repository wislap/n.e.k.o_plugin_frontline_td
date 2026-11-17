// Road projects (m3 E1): upgrade_links validation, upstream-ordered
// segments, delivery-capped progress, cancel -> salvage, destruction ->
// project end with paved cells kept, and save/restore mid-project.
import { describe, expect, it } from 'vitest';
import type { EntityHandle, EntityId } from '../../../core/index';
import { Faction, restoreSimulation } from '../../../kernel/index';
import type { SimModule } from '../../../kernel/index';
import { CombatDied } from '../../combat/protocol';
import { ROAD_LAYER_ID } from '../../logistics/protocol';
import { roadSegmentParts } from '../../logistics/sim/index';
import { CancelCommand, UpgradeLinksCommand } from '../protocol';
import { RoadSegment } from './components';
import {
  BASE,
  CYCLE,
  F1,
  MATERIAL,
  STATION,
  buildWorld,
  makeWorld,
  run,
  structureInit,
} from './test-world';

const W = 40;
const H = 8;
const FLAT = Array.from({ length: H }, () => '.'.repeat(W));
// Base 4x4 at x=2..5, station 2x2 at x=24..25: edge distance 18 <= 20
// (min connect), the link's polyline spans >= 16 cells -> 2+ segments.
const ENTITIES = [{ parts: structureInit(BASE, 2, 2) }, { parts: structureInit(STATION, 24, 2) }];

interface Opts {
  stock?: number;
  extraModules?: readonly SimModule[];
}

function roadWorld(opts: Opts = {}) {
  return makeWorld({
    rows: FLAT,
    entities: ENTITIES,
    starts: [
      {
        faction: F1,
        units: [],
        stock: new Map([[MATERIAL, opts.stock ?? 500]]),
      },
    ],
    segmentParts: [roadSegmentParts],
    ...(opts.extraModules !== undefined ? { extraModules: opts.extraModules } : {}),
  });
}

function upgrade(w: ReturnType<typeof roadWorld>, links = defaultLinks(w), level = 1) {
  w.issue(UpgradeLinksCommand.type, { links, level });
}

function defaultLinks(w: ReturnType<typeof roadWorld>) {
  return [{ a: Number(w.handles[0]), b: Number(w.handles[1]) }];
}

function layer(w: ReturnType<typeof roadWorld>): number[] {
  return [...(w.sim.snapshot(F1).layers[ROAD_LAYER_ID] ?? [])];
}

// Run until a live segment shows up in the roadworks channel.
function runToSegment(w: ReturnType<typeof roadWorld>, ticks = CYCLE * 4): number {
  for (let t = 0; t < ticks; t++) {
    w.sim.step();
    const segs = w.roadworks().segments;
    if (segs.handles.length > 0) {
      return segs.handles[0] ?? -1;
    }
  }
  return -1;
}

describe('construction.upgrade_links', () => {
  it('rejects unknown/invalid links and mutates nothing', () => {
    const w = roadWorld();
    w.issue(UpgradeLinksCommand.type, { links: [{ a: 0, b: 999 }], level: 1 });
    w.issue(UpgradeLinksCommand.type, { links: defaultLinks(w), level: 7 });
    run(w, 2);
    expect(w.rejections()).toEqual(['no_targets', 'invalid_target']);
    expect(w.roadworks().segments.handles.length).toBe(0);
    expect(w.roadworks().projects.built.length).toBe(0);
    expect(layer(w).every((v) => v === 0)).toBe(true);
  });

  it('spawns one segment at a time, upstream (warehouse) side first', () => {
    const w = roadWorld();
    upgrade(w);
    const seg = runToSegment(w);
    expect(seg).toBeGreaterThan(0);
    const rw = w.roadworks();
    expect(rw.segments.handles.length).toBe(1);
    // First segment sits on the base side of the link.
    expect(rw.segments.x[0] ?? 99).toBeLessThan(15);
    expect(rw.projects.built[0]).toBe(0);
    expect(rw.projects.level[0]).toBe(1);
    // Second upgrade request on the active link is skipped -> no_targets.
    w.issue(UpgradeLinksCommand.type, { links: defaultLinks(w), level: 1 });
    run(w, 2);
    expect(w.rejections()).toEqual(['no_targets']);
    expect(w.roadworks().segments.handles.length).toBe(1);
  });

  it('progress is capped by delivered materials', () => {
    const empty = roadWorld({ stock: 0 });
    upgrade(empty);
    const seg = runToSegment(empty);
    expect(seg).toBeGreaterThan(0);
    run(empty, CYCLE * 3);
    expect(empty.roadworks().segments.progressBp[0]).toBe(0);

    const stocked = roadWorld({ stock: 500 });
    upgrade(stocked);
    runToSegment(stocked);
    run(stocked, CYCLE * 3);
    expect(stocked.roadworks().segments.progressBp[0] ?? 0).toBeGreaterThan(0);
  });

  it('builds upstream first: early cells paved while later cells wait', () => {
    const w = roadWorld();
    upgrade(w);
    runToSegment(w);
    // Run until the first segment finishes (delivery + 40 build ticks).
    for (let t = 0; t < CYCLE * 8 && (w.roadworks().projects.built[0] ?? 0) === 0; t++) {
      w.sim.step();
    }
    const rw = w.roadworks();
    const built = rw.projects.built[0] ?? 0;
    const total = rw.projects.cells.length;
    expect(built).toBeGreaterThan(0);
    expect(built).toBeLessThan(total);
    // Exactly the upstream-first prefix of the polyline is paved.
    const expected = new Set<number>();
    for (let k = 0; k < built; k++) {
      expected.add(rw.projects.cells[k] ?? -1);
    }
    const paved = new Set<number>();
    layer(w).forEach((v, i) => {
      if (v === 1) {
        paved.add(i);
      }
    });
    expect(paved).toEqual(expected);
    // The live segment continues further downstream.
    if (rw.segments.handles.length > 0) {
      const segX = rw.segments.x[0] ?? 0;
      const lastPavedX = Math.max(...[...expected].map((c) => c % W));
      expect(segX).toBeGreaterThan(lastPavedX);
    }
  });

  it('cancel converts delivered materials to salvage and ends the project', () => {
    const w = roadWorld({ stock: 500 });
    upgrade(w);
    const seg = runToSegment(w);
    run(w, CYCLE * 2); // some deliveries land
    w.issue(CancelCommand.type, { targets: [seg] });
    run(w, 3);
    expect(w.roadworks().segments.handles.length).toBe(0);
    expect(w.roadworks().projects.built.length).toBe(0);
    expect(w.salvage().handles.length).toBe(1);
  });

  it('a destroyed segment ends the project; paved cells remain', () => {
    // Emits CombatDied for the first live segment once `armed` is set;
    // cleanup-phase readers run later in the same tick.
    let armed = false;
    const killer: SimModule = {
      id: 'frontline_td:test.kill_seg',
      install(builder) {
        builder.system({
          id: 'frontline_td:test.kill_seg',
          phase: 'resolve',
          emits: [CombatDied],
          run(ctx) {
            if (!armed) {
              return;
            }
            for (const id of ctx.query([RoadSegment])) {
              armed = false;
              const handle = ctx.handleOf(id as EntityId) ?? (0 as EntityHandle);
              ctx.emit(CombatDied, {
                handle: Number(handle),
                faction: ctx.read(Faction).id[id] ?? 0,
              });
              // Combat despawns the dead entity at tick end, like its
              // real cleanup system would.
              ctx.despawn(handle);
            }
          },
        });
      },
    };
    const w = roadWorld({ extraModules: [killer] });
    upgrade(w);
    runToSegment(w);
    // Let the first segment complete and pave its cells.
    for (let t = 0; t < CYCLE * 8 && (w.roadworks().projects.built[0] ?? 0) === 0; t++) {
      w.sim.step();
    }
    const pavedBefore = layer(w).filter((v) => v === 1).length;
    expect(pavedBefore).toBeGreaterThan(0);

    armed = true;
    run(w, 3);
    const rw = w.roadworks();
    expect(rw.segments.handles.length).toBe(0);
    expect(rw.projects.built.length).toBe(0);
    expect(w.salvage().handles.length).toBe(0); // destroyed: no refund
    expect(layer(w).filter((v) => v === 1).length).toBe(pavedBefore);
  });

  it('save/restore mid-project runs identically to uninterrupted', () => {
    const OPTS: Parameters<typeof buildWorld>[0] = {
      rows: FLAT,
      entities: ENTITIES,
      starts: [{ faction: F1, units: [], stock: new Map([[MATERIAL, 500]]) }],
      segmentParts: [roadSegmentParts],
    };
    const a = buildWorld(OPTS);
    a.open();
    upgrade(a);
    runToSegment(a);
    run(a, CYCLE * 2);

    const saved = a.sim.serialize();
    const b = buildWorld(OPTS);
    b.attach(restoreSimulation(b.config, b.modules, saved));

    run(a, CYCLE * 4);
    run(b, CYCLE * 4);
    expect(b.sim.hash()).toBe(a.sim.hash());
    const ra = a.roadworks();
    const rb = b.roadworks();
    expect([...rb.segments.handles]).toEqual([...ra.segments.handles]);
    expect([...rb.projects.cells]).toEqual([...ra.projects.cells]);
    expect([...rb.projects.built]).toEqual([...ra.projects.built]);
  });
});
