import { describe, expect, it } from 'vitest';
import { defineCommand, defineEvent, defineIntent, defineSnapshotChannel, s } from '../core/index';
import { defineComponent } from './components';
import { defineGridLayer } from './layers';
import { createSimulation } from './simulation';
import { Faction } from './contracts';
import type { SimModule } from './types';
import { baseConfig } from './testing/helpers';

const Pos = defineComponent('frontline_td:mf.pos', { x: 'f64' });
const Hp = defineComponent('frontline_td:mf.hp', { hp: 'u16' });
const Marker = defineComponent('frontline_td:mf.marker', {});
const Heat = defineGridLayer('frontline_td:mf.heat', 'u8', { perFaction: false });
const Fog = defineGridLayer('frontline_td:mf.fog', 'u8', { perFaction: true });

const Moved = defineEvent<{ id: number }>('frontline_td:mf.moved', 'all');
const Secret = defineEvent<{ id: number }>('frontline_td:mf.secret', 'issuer');
const AttackIntent = defineIntent<{ target: number }>('frontline_td:mf.attack');
const BuildCmd = defineCommand('frontline_td:mf.build', s.object({ x: s.number() }));
const Dense = defineSnapshotChannel('frontline_td:mf.dense');

const modA: SimModule = {
  id: 'frontline_td:mf.a',
  install(builder) {
    builder.claimWriter(Pos);
    builder.claimLayerWriter(Heat);
    builder.system({
      id: 'frontline_td:mf.a.late',
      phase: 'movement',
      run() {},
    });
    builder.system({
      id: 'frontline_td:mf.a.early',
      phase: 'orders',
      everyTicks: 5,
      offset: 2,
      reads: [Moved],
      emits: [Secret, AttackIntent],
      run() {},
    });
    builder.command(BuildCmd, () => {});
    builder.effect('frontline_td:mf.explode', 'resolve', () => {});
    builder.snapshotChannel(Dense, () => ({}));
    builder.state('frontline_td:mf.a.state', {
      save: () => ({}),
      load: () => {},
    });
    builder.probe('frontline_td:mf.a.probe', () => 0);
    builder.inspector('frontline_td:mf.a.inspect', () => null);
  },
};

const modB: SimModule = {
  id: 'frontline_td:mf.b',
  install(builder) {
    builder.claimWriter(Hp);
    // Owns Marker without a writer claim (spawn-time attach).
    builder.ownComponent(Marker);
    builder.claimLayerWriter(Fog);
    builder.system({
      id: 'frontline_td:mf.b.mid',
      phase: 'orders',
      emits: [Moved],
      run() {},
    });
    builder.onStart((ctx) => {
      ctx.spawn([[Marker]]);
    });
  },
};

describe('Simulation.describe manifest', () => {
  const manifest = createSimulation(baseConfig(), [modA, modB]).describe();

  it('lists phases in execution order', () => {
    expect(manifest.phases).toEqual([
      'command',
      'director',
      'orders',
      'movement',
      'combat_intent',
      'resolve',
      'cleanup',
      'logistics',
      'construction',
      'capture_fog',
    ]);
  });

  it('groups registrations by module, systems in execution order', () => {
    expect(manifest.modules.map((m) => m.id)).toEqual([
      'frontline_td:mf.a',
      'frontline_td:mf.b',
      'kernel',
    ]);
    const [a, b] = manifest.modules;
    // orders runs before movement regardless of registration order.
    expect(a?.systems.map((sys) => sys.id)).toEqual([
      'frontline_td:mf.a.early',
      'frontline_td:mf.a.late',
    ]);
    expect(a?.systems[0]).toMatchObject({
      phase: 'orders',
      everyTicks: 5,
      offset: 2,
      reads: ['frontline_td:mf.moved'],
      emits: ['frontline_td:mf.attack', 'frontline_td:mf.secret'],
    });
    expect(b?.systems.map((sys) => sys.id)).toEqual(['frontline_td:mf.b.mid']);
    expect(a?.commands).toEqual([{ id: 'frontline_td:mf.build', emits: [] }]);
    expect(a?.effects).toEqual([{ id: 'frontline_td:mf.explode', emits: [] }]);
    expect(a?.channels).toEqual(['frontline_td:mf.dense']);
    expect(a?.states).toEqual(['frontline_td:mf.a.state']);
    expect(a?.inspectors).toEqual(['frontline_td:mf.a.inspect']);
    expect(a?.probes).toEqual(['frontline_td:mf.a.probe']);
    expect(b?.commands).toEqual([]);
    // The synthetic kernel module exposes kernel-owned probes.
    const kernel = manifest.modules.find((m) => m.id === 'kernel');
    expect(kernel?.probes).toEqual(['frontline_td:kernel.entities', 'frontline_td:kernel.tick']);
  });

  it('reports components with fields and writers', () => {
    const byId = new Map(manifest.components.map((c) => [c.id, c]));
    expect(byId.get('frontline_td:mf.pos')).toEqual({
      id: 'frontline_td:mf.pos',
      fields: { x: 'f64' },
      owner: 'frontline_td:mf.a',
      writer: 'frontline_td:mf.a',
    });
    expect(byId.get('frontline_td:mf.hp')?.owner).toBe('frontline_td:mf.b');
    // Spawn-time attach without a writer claim still reports its owner.
    expect(byId.get('frontline_td:mf.marker')).toMatchObject({
      owner: 'frontline_td:mf.b',
      writer: null,
    });
    expect(byId.get(Faction.id)).toMatchObject({ owner: 'kernel', writer: 'kernel' });
  });

  it('reports layers with writer and perFaction', () => {
    const byId = new Map(manifest.layers.map((l) => [l.id, l]));
    expect(byId.get('frontline_td:mf.heat')).toEqual({
      id: 'frontline_td:mf.heat',
      type: 'u8',
      perFaction: false,
      writer: 'frontline_td:mf.a',
    });
    expect(byId.get('frontline_td:mf.fog')?.perFaction).toBe(true);
  });

  it('reports messages with kind and visibility', () => {
    const byType = new Map(manifest.messages.map((m) => [m.type, m]));
    expect(byType.get('frontline_td:mf.moved')).toEqual({
      type: 'frontline_td:mf.moved',
      kind: 'event',
      visibility: 'all',
    });
    expect(byType.get('frontline_td:mf.secret')?.visibility).toBe('issuer');
    expect(byType.get('frontline_td:mf.attack')?.kind).toBe('intent');
    expect(byType.get('frontline_td:mf.build')?.kind).toBe('command');
    // The kernel's own rejection event is always registered.
    expect(byType.get('frontline_td:kernel.command_rejected')?.visibility).toBe('issuer');
  });
});

describe('ownComponent', () => {
  const Owned = defineComponent('frontline_td:mf.owned', {});

  it('throws when two different modules own the same component', () => {
    const a: SimModule = {
      id: 'frontline_td:mf.oa',
      install: (b) => {
        b.ownComponent(Owned);
      },
    };
    const c: SimModule = {
      id: 'frontline_td:mf.ob',
      install: (b) => {
        b.ownComponent(Owned);
      },
    };
    expect(() => createSimulation(baseConfig(), [a, c])).toThrow(/owned by/);
  });

  it('throws when a module owns a kernel contract component', () => {
    const m: SimModule = {
      id: 'frontline_td:mf.oc',
      install: (b) => {
        b.ownComponent(Faction);
      },
    };
    expect(() => createSimulation(baseConfig(), [m])).toThrow(/kernel-owned/);
  });

  it('lets the same module ownComponent and claimWriter one component', () => {
    const m: SimModule = {
      id: 'frontline_td:mf.od',
      install: (b) => {
        b.ownComponent(Owned);
        b.claimWriter(Owned);
      },
    };
    const manifest = createSimulation(baseConfig(), [m]).describe();
    expect(manifest.components.find((c) => c.id === Owned.id)).toMatchObject({
      owner: 'frontline_td:mf.od',
      writer: 'frontline_td:mf.od',
    });
  });

  it('throws when module B claims a writer on a component module A owns', () => {
    const a: SimModule = {
      id: 'frontline_td:mf.oe',
      install: (b) => {
        b.ownComponent(Owned);
      },
    };
    const c: SimModule = {
      id: 'frontline_td:mf.of',
      install: (b) => {
        b.claimWriter(Owned);
      },
    };
    expect(() => createSimulation(baseConfig(), [a, c])).toThrow(/owned by/);
  });
});
