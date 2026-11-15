import { describe, expect, it } from 'vitest';
import { contentId, toFactionId } from '../core/index';
import { CONTROLLER_STREAM_ID } from '../kernel/index';
import type { MatchSetup } from '../protocol/index';
import { createDevSetup } from './dev-setup';
import { resolveSetup } from './resolve-setup';
import { RNG_STREAMS, SIM_MODULES } from './sim-registry';

function devRunHash(): string {
  const setup = createDevSetup(99);
  const resolved = resolveSetup(setup);
  if ('error' in resolved) {
    throw new Error(resolved.error);
  }
  for (let k = 0; k < 200; k++) {
    resolved.sim.step();
  }
  return resolved.sim.hash();
}

describe('SIM_MODULES registry', () => {
  it('is empty until gameplay features land', () => {
    expect(SIM_MODULES).toEqual([]);
    expect(RNG_STREAMS.map((s) => s.id)).toContain(CONTROLLER_STREAM_ID);
  });
});

describe('resolveSetup', () => {
  it('resolves the dev setup: sim, local queue, observer', () => {
    const resolved = resolveSetup(createDevSetup(7));
    expect('error' in resolved).toBe(false);
    if ('error' in resolved) {
      return;
    }
    expect(resolved.localQueue).not.toBeNull();
    expect(resolved.observer).toBe(resolved.localQueue?.faction);
    expect(resolved.sim.tick).toBe(0);
  });

  it('rejects an unknown map', () => {
    const setup: MatchSetup = {
      ...createDevSetup(1),
      mapId: contentId('frontline_td:no.such.map'),
    };
    const resolved = resolveSetup(setup);
    expect('error' in resolved && resolved.error).toContain('unknown map');
  });

  it('rejects an unknown mode', () => {
    const setup: MatchSetup = {
      ...createDevSetup(1),
      mode: contentId('frontline_td:no.such.mode'),
    };
    const resolved = resolveSetup(setup);
    expect('error' in resolved && resolved.error).toContain('unknown mode');
  });

  it('rejects an unknown pack', () => {
    const setup = createDevSetup(1);
    setup.packs.push({
      id: 'other_pack',
      version: '1.0.0',
      contentHash: '0123456789abcdef',
    });
    const resolved = resolveSetup(setup);
    expect('error' in resolved && resolved.error).toContain("unknown pack 'other_pack'");
  });

  it('rejects a base-pack content hash mismatch', () => {
    const setup = createDevSetup(1);
    const pack = setup.packs[0];
    if (pack !== undefined) {
      pack.contentHash = 'ffffffffffffffff';
    }
    const resolved = resolveSetup(setup);
    expect('error' in resolved && resolved.error).toContain('content hash mismatch');
  });

  it('uses the first faction as observer when nothing is local', () => {
    const setup = createDevSetup(1);
    for (const faction of setup.factions) {
      faction.controller = 'none';
    }
    const resolved = resolveSetup(setup);
    expect('error' in resolved).toBe(false);
    if ('error' in resolved) {
      return;
    }
    expect(resolved.localQueue).toBeNull();
    expect(resolved.observer).toBe(toFactionId(0));
  });
});

describe('registry determinism', () => {
  it('runs the dev setup 200 ticks twice with identical hashes', () => {
    expect(devRunHash()).toBe(devRunHash());
  });
});
