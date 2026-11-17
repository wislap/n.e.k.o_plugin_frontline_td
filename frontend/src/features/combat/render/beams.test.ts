// Beam dedupe (M3 D): each snapshot tick contributes its shot events
// once; re-reading the same tick yields nothing.
import { describe, expect, it } from 'vitest';
import { CombatShot } from '../protocol';
import { collectBeams } from './beams';

const shot = {
  type: CombatShot.type,
  payload: { from: 1, to: 2, x0: 1, y0: 2, x1: 3, y1: 4 },
};

describe('collectBeams', () => {
  it("returns each tick's beams exactly once", () => {
    const first = collectBeams([shot], 10, -1, 1000);
    expect(first.tick).toBe(10);
    expect(first.beams).toHaveLength(1);
    expect(first.beams[0]).toMatchObject({ x0: 1, y0: 2, x1: 3, y1: 4, born: 1000 });
    // Same tick again: nothing new.
    const dup = collectBeams([shot], 10, first.tick, 1010);
    expect(dup.beams).toHaveLength(0);
    expect(dup.tick).toBe(10);
    // Next tick produces again.
    const next = collectBeams([shot], 11, dup.tick, 1020);
    expect(next.beams).toHaveLength(1);
  });

  it('ignores non-shot events', () => {
    const other = { type: 'frontline_td:combat.died', payload: { handle: 1, faction: 1 } };
    expect(collectBeams([other], 5, -1, 0).beams).toHaveLength(0);
  });
});
