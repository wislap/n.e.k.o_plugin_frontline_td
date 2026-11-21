// Real-map proto_01 locomotion & squad targeting regression scenario:
// 24 starting units march from player base (10, 52) across height-1 plateau
// ramps and the central diagonal river bridge to all 6 proto_01 landmarks
// without RouteFollow limit cycles or cliff bounces, and SquadsOrder on the
// blocked East Outpost (70, 22) advances directly to East Outpost instead of
// retargeting to South Outpost.
import { describe, expect, it } from 'vitest';
import { toFactionId, toTick } from '../core/index';
import type { Simulation } from '../kernel/index';
import { StructuresChannel, type ConstructionStructures } from '../features/construction/protocol';
import { MoveCommand } from '../features/movement/protocol';
import {
  SquadsChannel,
  SquadsCreate,
  SquadsOrder,
  type SquadsSnapshot,
} from '../features/squads/protocol';
import { DenseUnitsChannel, type DenseUnits } from '../features/units/protocol';
import { defaultSetup } from '../modes/assault/index';
import { resolveSetup } from './resolve-setup';
import { run } from './test-world';

const F1 = toFactionId(1);

function collectOwnHandles(sim: Simulation): number[] {
  const du = sim.snapshot(F1).channels[DenseUnitsChannel.id] as DenseUnits;
  const handles: number[] = [];
  for (let i = 0; i < du.handles.length; i++) {
    if ((du.faction[i] ?? 0) === 1) {
      handles.push(du.handles[i] ?? 0);
    }
  }
  return handles;
}

describe('proto_01 real-map locomotion & squad snap', () => {
  it('24 starting units march from player base to all 6 proto_01 landmarks with 100% arrival', () => {
    const targets = [
      { name: 'outpost_south', x: 28, y: 55 },
      { name: 'outpost_west', x: 24, y: 22 },
      { name: 'enemy_rally', x: 50, y: 14 },
      { name: 'outpost_east', x: 66, y: 22 },
      { name: 'enemy_north', x: 30, y: 10 },
      { name: 'enemy_east', x: 84, y: 32 },
    ];

    for (const tgt of targets) {
      const setup = defaultSetup(1);
      if (setup.factions[1]?.start !== undefined) {
        setup.factions[1].start.units = [];
        setup.factions[1].start.structures = [];
      }
      const res = resolveSetup(setup);
      if ('error' in res) {
        throw new Error(res.error);
      }
      const { sim } = res;
      sim.step();
      const ownHandles = collectOwnHandles(sim);
      expect(ownHandles.length).toBe(24);

      sim.submit({
        tick: toTick(sim.tick + 1),
        issuer: F1,
        type: MoveCommand.type,
        payload: { units: ownHandles, x: tgt.x, y: tgt.y },
      });
      run(sim, 1000);

      const saved = sim.serialize() as {
        entities: { data: Record<string, Record<string, Record<string, number>>> };
      };
      let holding = 0;
      let moving = 0;
      for (const comp of Object.values(saved.entities.data)) {
        if (comp['frontline_td:faction']?.['id'] === 1 && comp['frontline_td:movement.mover']) {
          const active = comp['frontline_td:movement.move_target']?.['active'] ?? 0;
          if (active === 2) {
            holding += 1;
          } else if (active === 1) {
            moving += 1;
          }
        }
      }
      expect({ route: tgt.name, holding, moving }).toEqual({
        route: tgt.name,
        holding: 24,
        moving: 0,
      });
    }
  }, 60_000);

  it('SquadsOrder advance on blocked East Outpost (70, 22) attacks East Outpost instead of hijacking to South Outpost', () => {
    const setup = defaultSetup(1);
    if (setup.factions[1]?.start !== undefined) {
      setup.factions[1].start.units = [];
    }
    const res = resolveSetup(setup);
    if ('error' in res) {
      throw new Error(res.error);
    }
    const { sim } = res;
    sim.step();
    const ownHandles = collectOwnHandles(sim);
    sim.submit({
      tick: toTick(sim.tick + 1),
      issuer: F1,
      type: SquadsCreate.type,
      payload: { units: ownHandles, tag: 'player:1' },
    });
    run(sim, 2);
    const snap0 = sim.snapshot(F1).channels[SquadsChannel.id] as SquadsSnapshot;
    const sq0 = snap0.squads.find((s) => s.tag === 'player:1');
    expect(sq0).toBeDefined();
    if (sq0 === undefined) {
      return;
    }

    sim.submit({
      tick: toTick(sim.tick + 1),
      issuer: F1,
      type: SquadsOrder.type,
      payload: { squad: sq0.id, kind: 'advance', x: 70, y: 22 },
    });
    run(sim, 50); // Immediate advance order starts toward East Outpost without retarget hijack
    const snapEarly = sim.snapshot(F1).channels[SquadsChannel.id] as SquadsSnapshot;
    const sqEarly = snapEarly.squads.find((s) => s.id === sq0.id);
    expect(sqEarly?.phase).toBe('moving');

    run(sim, 450); // After clearing en-route South Outpost, crosses central bridge northeast
    const snapMid = sim.snapshot(F1).channels[SquadsChannel.id] as SquadsSnapshot;
    const sqMid = snapMid.squads.find((s) => s.id === sq0.id);
    expect(sqMid?.centroid.x ?? 0).toBeGreaterThan(35);
    expect(sqMid?.centroid.y ?? 99).toBeLessThan(45);

    run(sim, 700); // Arrives at East Outpost (70, 22), destroys it, and holds guard there
    const snapEnd = sim.snapshot(F1).channels[SquadsChannel.id] as SquadsSnapshot;
    const sqEnd = snapEnd.squads.find((s) => s.id === sq0.id);
    expect(sqEnd?.order.kind).toBe('guard');
    expect(sqEnd?.centroid.x ?? 0).toBeGreaterThan(64);
    expect(sqEnd?.centroid.y ?? 99).toBeLessThan(26);

    const st = sim.snapshot(F1).channels[StructuresChannel.id] as ConstructionStructures;
    let eastIdx = -1;
    for (let i = 0; i < st.handles.length; i++) {
      if ((st.x[i] ?? -1) === 69 && (st.y[i] ?? -1) === 21 && (st.faction[i] ?? 0) === 2) {
        eastIdx = i;
        break;
      }
    }
    const eastDamagedOrDown = eastIdx === -1 || (st.hpBp[eastIdx] ?? 10000) < 10000;
    expect(eastDamagedOrDown).toBe(true);
  }, 60_000);
});
