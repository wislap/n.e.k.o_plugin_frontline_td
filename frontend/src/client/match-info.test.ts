import { describe, expect, it } from 'vitest';
import { formatClock, matchOutcome, nextSpeedIndex } from './match-info';

describe('nextSpeedIndex', () => {
  it('steps within the speed range and clamps at both ends', () => {
    expect(nextSpeedIndex(1, 1, 4)).toBe(2);
    expect(nextSpeedIndex(3, 1, 4)).toBe(3);
    expect(nextSpeedIndex(1, -1, 4)).toBe(0);
    expect(nextSpeedIndex(0, -1, 4)).toBe(0);
  });
});

describe('formatClock', () => {
  it('formats ticks (50 ms) as mm:ss', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(20)).toBe('00:01');
    expect(formatClock(60 * 20)).toBe('01:00');
    expect(formatClock(93 * 20 + 7)).toBe('01:33');
    expect(formatClock(-5)).toBe('00:00');
  });
});

describe('matchOutcome', () => {
  it('maps the ended state relative to the observer', () => {
    expect(matchOutcome(null, 1)).toBeNull();
    expect(matchOutcome({ ended: 0, winner: 0 }, 1)).toBeNull();
    expect(matchOutcome({ ended: 1, winner: 1 }, 1)).toBe('victory');
    expect(matchOutcome({ ended: 1, winner: 2 }, 1)).toBe('defeat');
    expect(matchOutcome({ ended: 1, winner: -1 }, 1)).toBe('draw');
  });
});
