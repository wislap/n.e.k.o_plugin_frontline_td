// The observer's faction always gets the local colour; every other
// faction comes from a palette that never contains it (pre-snapshot:
// everyone uses the palette).
import { describe, expect, it } from 'vitest';
import { factionColorHex, LOCAL_COLOR } from './faction-colors';

describe('factionColorHex', () => {
  it('returns the local colour for the observer faction', () => {
    expect(factionColorHex(1, 1)).toBe(LOCAL_COLOR);
    expect(factionColorHex(3, 3)).toBe(LOCAL_COLOR);
  });

  it('never returns the local colour for other factions', () => {
    for (let faction = 0; faction < 16; faction++) {
      if (faction === 1) {
        continue;
      }
      const c = factionColorHex(faction, 1);
      expect(c).not.toBe(LOCAL_COLOR);
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('uses the palette for everyone before a snapshot exists', () => {
    expect(factionColorHex(1, null)).not.toBe(LOCAL_COLOR);
    expect(factionColorHex(2, null)).toBe(factionColorHex(2, 99));
  });
});
