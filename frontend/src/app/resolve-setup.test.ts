import { describe, expect, it } from 'vitest';
import { contentId, toFactionId } from '../core/index';
import { CONTROLLER_STREAM_ID } from '../kernel/index';
import type { MatchSetup } from '../protocol/index';
import { createDevSetup } from './dev-setup';
import { resolveSetup } from './resolve-setup';
import { loadContent } from '../content/load';
import { createSimModules, RNG_STREAMS } from './sim-registry';

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

describe('createSimModules', () => {
  it('wires terrain, pathing, movement, units in order', () => {
    const db = loadContent();
    const map = db.maps.byId('frontline_td:proto_01');
    expect(map).toBeDefined();
    if (map === undefined) {
      return;
    }
    const modules = createSimModules(db, map, []);
    expect(modules.map((m) => m.id)).toEqual([
      'frontline_td:terrain',
      'frontline_td:pathing',
      'frontline_td:movement',
      'frontline_td:units',
    ]);
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
    expect(resolved.observer).toBe(toFactionId(1));
  });
});

describe('registry determinism', () => {
  it('runs the dev setup 200 ticks twice with identical hashes', () => {
    expect(devRunHash()).toBe(devRunHash());
  });
});
