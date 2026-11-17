// Corridor interception (m3 E2): hostile Interceptor units near a link's
// polyline reduce its quota proportionally, clamp at zero, recover when
// they leave, and ignore allies/neutrals.
import { describe, expect, it } from 'vitest';
import { toFactionId } from '../../../core/index';
import type { EntityHandle } from '../../../core/index';
import type { SimConfig, SpawnInit } from '../../../kernel/index';
import { Position } from '../../movement/sim/index';
import { Interceptor } from './components';
import { CARGO_CONSTRUCTION } from '../protocol';
import {
  CYCLE,
  ENERGY,
  consumerParts,
  demandSlot,
  makeWorld,
  nodeParts,
  run,
  storeInit,
} from './test-world';

const W = 40;
const H = 8;
const FLAT = Array.from({ length: H }, () => '.'.repeat(W));
const WAREHOUSE = { connect: 600, service: 2, vehicles: 8, warehouse: true };
const RELAY = { connect: 600, service: 2, vehicles: 8 };
const HOSTILE: SimConfig['relations'] = [
  { a: toFactionId(1), b: toFactionId(2), relation: 'hostile' },
];
const ALLIED: SimConfig['relations'] = [
  { a: toFactionId(1), b: toFactionId(2), relation: 'allied' },
];

function raider(x: number, y: number, strength = 5000, faction = 2) {
  const parts: SpawnInit = [
    [Position, { x, y }],
    [Interceptor, { strengthBp: strength }],
  ];
  return { parts, faction };
}

function world(opts: {
  interceptors?: readonly ReturnType<typeof raider>[];
  relations?: SimConfig['relations'];
}) {
  return makeWorld({
    rows: FLAT,
    factions: [1, 2],
    relations: opts.relations ?? HOSTILE,
    entities: [
      { parts: nodeParts(4, 4, WAREHOUSE) },
      { parts: nodeParts(30, 4, RELAY) },
      ...(opts.interceptors ?? []),
    ],
  });
}

// Quota of the single link's out direction after one cycle.
function quota(w: ReturnType<typeof world>): number {
  return w.network(1).links.quotaOut[0] ?? -1;
}

describe('corridor interception', () => {
  it('one interceptor halves the link quota and flags the link', () => {
    const w = world({ interceptors: [raider(15.5, 4.5)] });
    run(w.sim, CYCLE);
    const links = w.network(1).links;
    expect(links.intercept[0]).toBe(5000);
    const clear = world({});
    run(clear.sim, CYCLE);
    const base = quota(clear);
    expect(quota(w)).toBe(Math.floor((base * 5000) / 10000));
  });

  it('strengths sum and clamp the quota at zero', () => {
    const w = world({
      interceptors: [raider(15.5, 4.5), raider(18.5, 4.5), raider(20.5, 4.5)],
    });
    run(w.sim, CYCLE);
    expect(w.network(1).links.intercept[0]).toBe(15000);
    expect(quota(w)).toBe(0);
  });

  it('recovers when the interceptor leaves', () => {
    let despawned = false;
    const w = makeWorld({
      rows: FLAT,
      factions: [1, 2],
      relations: HOSTILE,
      entities: [
        { parts: nodeParts(4, 4, WAREHOUSE) },
        { parts: nodeParts(30, 4, RELAY) },
        raider(15.5, 4.5),
      ],
      onTick(ctx, handles) {
        if (!despawned && ctx.tick >= CYCLE * 2) {
          despawned = true;
          ctx.despawn(handles[2] ?? (0 as EntityHandle));
        }
      },
    });
    run(w.sim, CYCLE);
    expect(w.network(1).links.intercept[0]).toBe(5000);
    run(w.sim, CYCLE * 3);
    expect(w.network(1).links.intercept[0]).toBe(0);
    const clear = world({});
    run(clear.sim, CYCLE);
    expect(quota(w)).toBe(quota(clear));
  });

  it('many small demands share one intercepted cap (not a geometric drain)', () => {
    // Eight consumers behind the relay, each with headroom far above the
    // link quota: total carried is capped at the intercepted quota, not
    // factor x remaining-budget per demand.
    const consumers = Array.from({ length: 8 }, (_, i) => ({
      parts: consumerParts(31 + i, 4, storeInit([demandSlot(ENERGY, 20000, CARGO_CONSTRUCTION)])),
    }));
    const opts = (interceptors: readonly ReturnType<typeof raider>[]) => ({
      rows: FLAT,
      factions: [1, 2],
      relations: HOSTILE,
      starts: [{ faction: toFactionId(1), stock: new Map([[ENERGY, 500]]) }],
      entities: [
        { parts: nodeParts(4, 4, WAREHOUSE) },
        { parts: nodeParts(30, 4, { ...RELAY, service: 600 }) },
        ...consumers,
        ...interceptors,
      ],
    });
    const clear = makeWorld(opts([]));
    const blocked = makeWorld(opts([raider(15.5, 4.5)]));
    run(clear.sim, CYCLE);
    run(blocked.sim, CYCLE);
    const clearVol = clear.network(1).links.volOut[0] ?? -1;
    const vol = blocked.network(1).links.volOut[0] ?? -1;
    const quotaCap = blocked.network(1).links.quotaOut[0] ?? -1;
    expect(vol).toBeGreaterThan(0);
    expect(vol).toBeLessThanOrEqual(quotaCap);
    expect(vol).toBe(Math.floor(clearVol / 2));
  });

  it('out-of-corridor, allied and neutral units do not intercept', () => {
    // 3 cells above the link row: outside the 1.5 corridor.
    const far = world({ interceptors: [raider(15.5, 1.5)] });
    run(far.sim, CYCLE);
    expect(far.network(1).links.intercept[0]).toBe(0);

    const ally = world({ interceptors: [raider(15.5, 4.5)], relations: ALLIED });
    run(ally.sim, CYCLE);
    expect(ally.network(1).links.intercept[0]).toBe(0);

    const neutral = world({ interceptors: [raider(15.5, 4.5)], relations: [] });
    run(neutral.sim, CYCLE);
    expect(neutral.network(1).links.intercept[0]).toBe(0);
  });
});
