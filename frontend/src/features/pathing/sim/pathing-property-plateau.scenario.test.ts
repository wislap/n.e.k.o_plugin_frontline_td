import { describe, expect, it } from 'vitest';
import { CLS, makePathing } from './test-world';

describe('direction soundness (property)', () => {
  it('plateau-edge cells never point off the cliff', () => {
    // 5x5: plateau height 1 everywhere except a ring of height 0; the only
    // exit is the ramp at (1,2) (lower cell). Goal below the plateau.
    const rows = ['.....', '.111.', '.r11.', '.111.', '.....'];
    const { api, terrain } = makePathing(rows);
    const goal = api.acquireGoal(2, 4, CLS);
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        const d = api.directionAt(goal, x, y);
        if (d === null || (d.dx === 0 && d.dy === 0)) {
          continue;
        }
        expect(
          terrain.stepCost(x, y, x + d.dx, y + d.dy, CLS),
          `cliff step from ${x},${y} to ${x + d.dx},${y + d.dy}`,
        ).toBeGreaterThanOrEqual(0);
      }
    }
    // Following the field from the plateau interior exits via the ramp.
    let x = 2;
    let y = 1;
    for (let k = 0; k < 25; k++) {
      const d = api.directionAt(goal, x, y);
      if (d === null || (d.dx === 0 && d.dy === 0)) {
        break;
      }
      x += d.dx;
      y += d.dy;
    }
    expect(x).toBe(2);
    expect(y).toBe(4);
  });
});
