import { describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD_PX, dragExceeded, normalizeBox } from './pointer';

describe('pointer helpers', () => {
  it('drag threshold is exclusive beyond DRAG_THRESHOLD_PX', () => {
    expect(dragExceeded(0, 0)).toBe(false);
    expect(dragExceeded(DRAG_THRESHOLD_PX, 0)).toBe(false);
    expect(dragExceeded(DRAG_THRESHOLD_PX + 0.1, 0)).toBe(true);
    expect(dragExceeded(3, 3)).toBe(true); // √(9+9) > 4
  });

  it('normalizeBox orders corners regardless of drag direction', () => {
    expect(normalizeBox(10, 20, 5, 8)).toEqual({ x0: 5, y0: 8, x1: 10, y1: 20 });
    expect(normalizeBox(5, 8, 10, 20)).toEqual({ x0: 5, y0: 8, x1: 10, y1: 20 });
  });
});
