// Beam collection (M3 D): each shot event delivered to the consumer
// becomes one beam; non-shot events are ignored. Delivery dedupe is the
// client event log's job (eventsSince cursor).
import { describe, expect, it } from 'vitest';
import { CombatShot } from '../protocol';
import { collectBeams } from './beams';

const shot = {
  type: CombatShot.type,
  payload: { from: 1, to: 2, x0: 1, y0: 2, x1: 3, y1: 4 },
};

describe('collectBeams', () => {
  it('turns each delivered shot event into a beam', () => {
    const beams = collectBeams([shot, shot], 1000);
    expect(beams).toHaveLength(2);
    expect(beams[0]).toMatchObject({ x0: 1, y0: 2, x1: 3, y1: 4, born: 1000 });
  });

  it('ignores non-shot events', () => {
    const other = { type: 'frontline_td:combat.died', payload: { handle: 1, faction: 1 } };
    expect(collectBeams([other], 0)).toHaveLength(0);
  });
});
