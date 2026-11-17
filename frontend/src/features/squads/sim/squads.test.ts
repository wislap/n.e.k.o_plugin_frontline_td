// Squads (A5): command validation, member removal on a plain
// MoveCommand, empty-squad deletion, and serialization round-trips.
import { describe, expect, it } from 'vitest';
import { COMMAND_REJECTED } from '../../../core/index';
import { restoreSimulation } from '../../../kernel/index';
import { MoveCommand } from '../../movement/protocol';
import { F2, createAll, ROBOT, robotInit, robots, run, snapshot, squad, world } from './test-world';
import type { World } from './test-world';

describe('squads commands', () => {
  it('create/assign/disband/set_strength with validation', () => {
    const w = world({ entities: robots(3, 4, 4), factions: [1, 2] });
    const [h0, h1, h2] = w.handles.map((h) => Number(h));
    // Foreign issuer owns none of the units → reject, no squad created.
    w.issue('frontline_td:squads.create', { units: [h0 ?? 0] }, F2);
    run(w, 2);
    const rejects = w.sim.snapshot(F2).events.filter((e) => e.type === COMMAND_REJECTED.type);
    expect(rejects.length).toBeGreaterThan(0);
    expect(snapshot(w).squads.length).toBe(0);

    w.issue('frontline_td:squads.create', { units: [h0 ?? 0, h1 ?? 0], strength: 4 });
    run(w, 2);
    expect(squad(w)?.members?.length).toBe(2);
    expect(squad(w)?.strength).toBe(4);

    w.issue('frontline_td:squads.assign', { squad: 1, units: [h2 ?? 0] });
    w.issue('frontline_td:squads.set_strength', { squad: 1, strength: 8 });
    run(w, 2);
    expect(squad(w)?.members?.length).toBe(3);
    expect(squad(w)?.strength).toBe(8);

    w.issue('frontline_td:squads.disband', { squad: 1 });
    run(w, 2);
    expect(snapshot(w).squads.length).toBe(0);
  });

  it('a plain MoveCommand removes the member from its squad', () => {
    const w = world({ entities: robots(2, 4, 4) });
    createAll(w);
    run(w, 2);
    w.issue(MoveCommand.type, { units: [Number(w.handles[0])], x: 20, y: 4 });
    // MoveOrdered is read on the squad's next staggered update.
    run(w, 12);
    expect(squad(w)?.members?.length).toBe(1);
  });

  it('state round-trips through serialize/restore mid-fight', () => {
    const ents = [...robots(2, 4, 4), { parts: robotInit(ROBOT, 8, 4), faction: 2 }];
    const setup = (w: World) => {
      w.issue('frontline_td:squads.create', {
        units: w.handles.slice(0, 2).map((h) => Number(h)),
      });
      w.issue('frontline_td:squads.order', { squad: 1, kind: 'guard', x: 6, y: 4, radius: 8 });
    };
    const w = world({ entities: ents, factions: [1, 2] });
    setup(w);
    run(w, 20);
    expect(squad(w)?.phase).toBe('engaging');
    const saved = w.sim.serialize();
    const restored = restoreSimulation(w.config, w.modules, saved);
    for (let t = 0; t < 10; t++) {
      restored.step();
    }
    const w2 = world({ entities: ents, factions: [1, 2] });
    setup(w2);
    run(w2, 30);
    expect(restored.hash()).toBe(w2.sim.hash());
  });

  it('an emptied squad is deleted on its next update', () => {
    const w = world({ entities: robots(1, 4, 4) });
    createAll(w);
    run(w, 2);
    w.issue(MoveCommand.type, { units: [Number(w.handles[0])], x: 20, y: 4 });
    run(w, 12);
    expect(snapshot(w).squads.length).toBe(0);
  });
});
