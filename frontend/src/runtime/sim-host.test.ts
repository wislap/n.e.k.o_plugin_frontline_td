import { describe, expect, it } from 'vitest';
import { COMMAND_REJECTED, defineCommand, s, toFactionId } from '../core/index';
import { createQueuedController, createSimulation, defineComponent } from '../kernel/index';
import type { SimModule } from '../kernel/index';
import { baseConfig, F1 } from '../kernel/testing/helpers';
import { createSimHost } from './sim-host';

const Marker = defineComponent('frontline_td:test.host.marker', { v: 'i32' });
const Mark = defineCommand('frontline_td:test.host.mark', s.object({ v: s.int() }));

function markModule(): SimModule {
  return {
    id: 'frontline_td:test.host',
    install(builder) {
      builder.command(Mark, (ctx, payload) => {
        ctx.spawn([[Marker, { v: payload.v }]]);
      });
    },
  };
}

function makeHost() {
  const localQueue = createQueuedController(F1);
  const sim = createSimulation(
    baseConfig({
      factions: [{ id: F1 }],
      controllers: [localQueue],
    }),
    [markModule()],
  );
  const host = createSimHost({ sim, localQueue, observer: F1 });
  return { host, sim, localQueue };
}

describe('createSimHost', () => {
  it('runs 20 ticks per simulated second at x1', () => {
    const { host } = makeHost();
    host.advance(0);
    let ran = 0;
    for (let k = 1; k <= 20; k++) {
      ran += host.advance(k * 50);
    }
    expect(ran).toBe(20);
  });

  it('runs 60 ticks per simulated second at x3', () => {
    const { host } = makeHost();
    host.setSpeedIndex(3);
    host.advance(0);
    let ran = 0;
    for (let k = 1; k <= 20; k++) {
      ran += host.advance(k * 50);
    }
    expect(ran).toBe(60);
  });

  it('runs no ticks while paused', () => {
    const { host } = makeHost();
    host.setSpeedIndex(0);
    host.advance(0);
    expect(host.advance(10_000)).toBe(0);
  });

  it('togglePause restores the last non-zero speed', () => {
    const { host } = makeHost();
    host.setSpeedIndex(2);
    host.togglePause();
    expect(host.paused).toBe(true);
    host.togglePause();
    expect(host.paused).toBe(false);
    expect(host.speedIndex).toBe(2);
  });

  it('caps catch-up at 5 ticks and drops the remainder', () => {
    const { host } = makeHost();
    host.advance(0);
    expect(host.advance(1000)).toBe(5);
    expect(host.advance(1050)).toBe(1);
  });

  it('rejects out-of-range speed indices', () => {
    const { host } = makeHost();
    expect(() => {
      host.setSpeedIndex(4);
    }).toThrow(RangeError);
    expect(() => {
      host.setSpeedIndex(-1);
    }).toThrow(RangeError);
    expect(() => {
      host.setSpeedIndex(1.5);
    }).toThrow(RangeError);
  });

  it('routes a local command into the sim and command log', () => {
    const { host, sim } = makeHost();
    host.submitLocal({ type: Mark.type, payload: { v: 7 } });
    host.advance(0);
    host.advance(50);
    host.advance(100);
    expect(sim.commandLog()).toHaveLength(1);
    const snapshot = sim.snapshot(F1);
    expect(snapshot.tick).toBe(1);
  });

  it('makes an invalid local command produce COMMAND_REJECTED for the issuer', () => {
    const { host, sim } = makeHost();
    host.submitLocal({ type: 'frontline_td:no.such.command', payload: {} });
    host.advance(0);
    host.advance(50);
    const snapshot = sim.snapshot(F1);
    const rejected = snapshot.events.filter((event) => event.type === COMMAND_REJECTED.type);
    expect(rejected).toHaveLength(1);
  });

  it('rejects local submission when no local faction exists', () => {
    const sim = createSimulation(
      baseConfig({ factions: [{ id: toFactionId(5) }], controllers: [] }),
      [],
    );
    const host = createSimHost({ sim, localQueue: null, observer: toFactionId(5) });
    expect(() => {
      host.submitLocal({ type: 'x', payload: null });
    }).toThrow('no local faction');
  });

  it('reports stats: tick, speed, entity count and system timings', () => {
    const { host } = makeHost();
    host.advance(0);
    host.advance(200);
    const stats = host.stats(210);
    expect(stats.tick).toBe(4);
    expect(stats.speedIndex).toBe(1);
    expect(stats.paused).toBe(false);
    expect(stats.tickRate).toBeGreaterThan(0);
    expect(stats.entityCount).toBe(0);
  });
});
