import { describe, expect, it } from 'vitest';
import type { CommandRejectedPayload, FactionId } from '../core/index';
import { COMMAND_REJECTED, defineCommand, s, toTick } from '../core/index';
import { createQueuedController } from './controllers';
import { createSimulation } from './simulation';
import type { Controller, SimModule } from './types';
import { baseConfig, F1, F2, F3 } from './testing/helpers';

const TestCmd = defineCommand('frontline_td:test.cmd', s.object({ n: s.int() }));

function envelope(
  tick: number,
  issuer: FactionId,
  type: string,
  payload: unknown,
): Parameters<ReturnType<typeof createSimulation>['submit']>[0] {
  return { tick: toTick(tick), issuer, type, payload };
}

function moduleWith(install: SimModule['install']): SimModule {
  return { id: 'frontline_td:test.cmds', install };
}

function rejections(
  sim: ReturnType<typeof createSimulation>,
  observer: FactionId,
): CommandRejectedPayload[] {
  return sim
    .snapshot(observer)
    .events.filter((e) => e.type === COMMAND_REJECTED.type)
    .map((e) => e.payload as CommandRejectedPayload);
}

describe('kernel commands', () => {
  it('applies due commands ordered by issuer ascending then submission seq', () => {
    const applied: string[] = [];
    const mod = moduleWith((builder) => {
      builder.command(TestCmd, (ctx, payload, issuer) => {
        applied.push(`${issuer}:${payload.n}`);
      });
    });
    const sim = createSimulation(baseConfig(), [mod]);
    sim.submit(envelope(1, F2, TestCmd.type, { n: 1 }));
    sim.submit(envelope(1, F1, TestCmd.type, { n: 2 }));
    sim.submit(envelope(1, F2, TestCmd.type, { n: 3 }));
    sim.step();
    sim.step();
    // Ordered by issuer ascending, then submission seq.
    expect(applied).toEqual(['1:2', '2:1', '2:3']);
    expect(sim.commandLog()).toHaveLength(3);
  });

  it('rejects unknown type, invalid payload, late tick and unknown issuer', () => {
    const mod = moduleWith((builder) => {
      builder.command(TestCmd, () => undefined);
    });
    const sim = createSimulation(baseConfig(), [mod]);
    sim.submit(envelope(1, F1, 'frontline_td:nope', {}));
    sim.submit(envelope(1, F1, TestCmd.type, { n: 'x' }));
    sim.submit(envelope(0, F1, TestCmd.type, { n: 1 }));
    sim.submit(envelope(1, F3, TestCmd.type, { n: 1 }));
    sim.step();
    const reasons = rejections(sim, F1).map((r) => `${r.type}:${r.reason}`);
    expect(reasons).toContain('frontline_td:nope:unknown_type');
    expect(reasons).toContain('frontline_td:test.cmd:invalid_payload');
    expect(reasons).toContain('frontline_td:test.cmd:late');
    expect(reasons).not.toContain('frontline_td:test.cmd:unknown_issuer');
    // F3's rejection is only visible to F3 (visibility 'issuer').
    expect(rejections(sim, F3).map((r) => r.reason)).toEqual(['unknown_issuer']);
    expect(sim.commandLog()).toHaveLength(0);
  });

  it('handler-provided rejection reason reaches the issuer snapshot', () => {
    const mod = moduleWith((builder) => {
      builder.command(TestCmd, (ctx, payload) => {
        if (payload.n < 0) {
          ctx.reject('negative');
        }
      });
    });
    const sim = createSimulation(baseConfig(), [mod]);
    sim.submit(envelope(1, F1, TestCmd.type, { n: -1 }));
    sim.step();
    sim.step();
    const found = rejections(sim, F1);
    expect(found.map((r) => r.reason)).toEqual(['negative']);
  });

  it('controllers see the previous tick snapshot and commands land at T+1', () => {
    const snapshotsSeen: number[] = [];
    const appliedAt: number[] = [];
    const controller = createQueuedController(F1);
    controller.push({ type: TestCmd.type, payload: { n: 5 } });
    const observer: Controller = {
      faction: F2,
      decide(input) {
        snapshotsSeen.push(input.snapshot.tick);
      },
    };
    const mod = moduleWith((builder) => {
      builder.command(TestCmd, (ctx) => {
        appliedAt.push(ctx.tick);
      });
    });
    const sim = createSimulation(baseConfig({ controllers: [controller, observer] }), [mod]);
    sim.step();
    sim.step();
    sim.step();
    // At tick 0 the controller's queued command is issued for tick 1 and
    // applied during tick 1's command phase.
    expect(appliedAt).toEqual([1]);
    expect(sim.commandLog().map((e) => e.tick)).toEqual([1]);
    // Observer sees the end-of-previous-tick snapshot each tick.
    expect(snapshotsSeen).toEqual([0, 0, 1]);
  });
});
