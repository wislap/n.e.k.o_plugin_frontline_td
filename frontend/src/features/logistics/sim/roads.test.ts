// Roads (m3 E1): the time-weighted link multiplier, the pave API
// (topology untouched, version-gated recompute, never lowers) and the
// upstream-oriented linkPath upgrade query.
import { describe, expect, it } from 'vitest';
import type { EntityHandle } from '../../../core/index';
import { toFactionId } from '../../../core/index';
import type { SystemContext } from '../../../kernel/index';
import { ROAD_LAYER_ID } from '../protocol';
import type { LinkPath } from './index';
import { linkMultiplier } from './topology';
import { CYCLE, F1, makeWorld, nodeParts, run } from './test-world';

const W = 40;
const H = 8;
const FLAT = Array.from({ length: H }, () => '.'.repeat(W));
const WAREHOUSE = { connect: 600, service: 2, vehicles: 8, warehouse: true };
const RELAY = { connect: 600, service: 2, vehicles: 8 };
const MULT = [10000, 20000];

function linkedWorld() {
  return makeWorld({
    rows: FLAT,
    entities: [{ parts: nodeParts(4, 4, WAREHOUSE) }, { parts: nodeParts(30, 4, RELAY) }],
  });
}

function allCells(): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      out.push({ x, y });
    }
  }
  return out;
}

describe('linkMultiplier', () => {
  const link = { cost: 40, cells: [0, 1, 2, 3, 4], steps: [0, 10, 10, 10, 10] };

  it('all dirt keeps the base multiplier; fully paved doubles it', () => {
    expect(linkMultiplier(link, [0, 0, 0, 0, 0], MULT)).toBe(10000);
    expect(linkMultiplier(link, [0, 1, 1, 1, 1], MULT)).toBe(20000);
  });

  it('partial paving: two paved + two dirt edges -> floor(40*10000/30)', () => {
    expect(linkMultiplier(link, [0, 0, 1, 1, 0], MULT)).toBe(13333);
  });
});

describe('roads pave', () => {
  it('recomputes link multipliers only and leaves topology untouched', () => {
    const w = linkedWorld();
    run(w.sim, CYCLE);
    const before = w.network();
    expect(before.links.a.length).toBe(1);
    expect(before.links.m[0]).toBe(10000);
    const cellsBefore = [...before.links.pathCells];

    w.logistics.pave(allCells(), 1);
    run(w.sim, CYCLE);
    const after = w.network();
    expect([...after.links.pathCells]).toEqual(cellsBefore);
    expect(after.links.m[0]).toBe(20000);
  });

  it('partial pave lands between dirt and fully paved', () => {
    const w = linkedWorld();
    run(w.sim, CYCLE);
    const path = [...w.network().links.pathCells];
    const half = Math.floor(path.length / 2);
    w.logistics.pave(
      path.slice(0, half).map((c) => ({ x: c % W, y: (c / W) | 0 })),
      1,
    );
    run(w.sim, CYCLE);
    const m = w.network().links.m[0] ?? 0;
    expect(m).toBeGreaterThan(10000);
    expect(m).toBeLessThan(20000);
  });

  it('never lowers a level and mirrors the layer to snapshots', () => {
    const w = linkedWorld();
    w.logistics.pave([{ x: 5, y: 5 }], 1);
    w.logistics.pave([{ x: 5, y: 5 }], 0);
    run(w.sim, 1);
    const snap = w.sim.snapshot(F1);
    expect(snap.layers[ROAD_LAYER_ID]?.[5 * W + 5]).toBe(1);
  });
});

describe('linkPath', () => {
  it('orients upstream (warehouse) -> downstream with cumulative costs', () => {
    let seen: LinkPath | null = null;
    const w = makeWorld({
      rows: FLAT,
      entities: [{ parts: nodeParts(4, 4, WAREHOUSE) }, { parts: nodeParts(30, 4, RELAY) }],
      onTick(ctx: SystemContext, handles: readonly EntityHandle[]) {
        if (seen === null) {
          seen = w.logistics.linkPath(ctx, toFactionId(1), Number(handles[1]), Number(handles[0]));
        }
      },
    });
    run(w.sim, CYCLE);
    expect(seen).not.toBeNull();
    const path = seen as unknown as LinkPath;
    // Reversed argument order still returns warehouse-first.
    expect(path.upstream).toBe(Number(w.handles[0]));
    expect(path.cells.length).toBeGreaterThan(1);
    expect(path.cum[0]).toBe(0);
    for (let k = 1; k < path.cum.length; k++) {
      expect(path.cum[k] ?? 0).toBeGreaterThan(path.cum[k - 1] ?? 0);
    }
    expect(path.roads.every((r) => r === 0)).toBe(true);
  });

  it('returns null for unlinked or invalid handles', () => {
    let paths: (LinkPath | null)[] = [];
    const w = makeWorld({
      rows: FLAT,
      entities: [{ parts: nodeParts(4, 4, WAREHOUSE) }, { parts: nodeParts(30, 4, RELAY) }],
      onTick(ctx: SystemContext, handles: readonly EntityHandle[]) {
        if (paths.length === 0) {
          paths = [
            w.logistics.linkPath(ctx, toFactionId(1), Number(handles[0]), 0),
            w.logistics.linkPath(ctx, toFactionId(2), Number(handles[0]), Number(handles[1])),
          ];
        }
      },
    });
    run(w.sim, CYCLE);
    expect(paths).toEqual([null, null]);
  });
});
