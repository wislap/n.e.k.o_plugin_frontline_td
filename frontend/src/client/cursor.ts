// Latest ground and screen cursor positions, updated on pointer move and
// read per frame by the build ghost and HTML overlays. Encapsulated behind
// cursorState so callers never mutate module globals directly.
export interface GroundCursor {
  x: number;
  y: number;
  valid: boolean;
}

export interface ScreenCursor {
  x: number;
  y: number;
}

const groundPoint: GroundCursor = { x: 0, y: 0, valid: false };
const screenPoint: ScreenCursor = { x: 0, y: 0 };
const groundListeners = new Set<() => void>();

function notifyGround(): void {
  for (const fn of [...groundListeners]) {
    if (groundListeners.has(fn)) {
      fn();
    }
  }
}

export const cursorState = {
  ground(): Readonly<GroundCursor> {
    return groundPoint;
  },
  screen(): Readonly<ScreenCursor> {
    return screenPoint;
  },
  setGround(point: { x: number; y: number } | null): void {
    if (point === null) {
      if (!groundPoint.valid) {
        return;
      }
      groundPoint.valid = false;
      notifyGround();
      return;
    }
    if (groundPoint.valid && groundPoint.x === point.x && groundPoint.y === point.y) {
      return;
    }
    groundPoint.x = point.x;
    groundPoint.y = point.y;
    groundPoint.valid = true;
    notifyGround();
  },
  subscribeGround(listener: () => void): () => void {
    groundListeners.add(listener);
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      groundListeners.delete(listener);
    };
  },
  setScreen(x: number, y: number): void {
    screenPoint.x = x;
    screenPoint.y = y;
  },
  reset(): void {
    const changed = groundPoint.valid || groundPoint.x !== 0 || groundPoint.y !== 0;
    groundPoint.x = 0;
    groundPoint.y = 0;
    groundPoint.valid = false;
    screenPoint.x = 0;
    screenPoint.y = 0;
    if (changed) {
      notifyGround();
    }
  },
};
