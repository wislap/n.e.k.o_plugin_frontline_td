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

export const cursorState = {
  ground(): Readonly<GroundCursor> {
    return groundPoint;
  },
  screen(): Readonly<ScreenCursor> {
    return screenPoint;
  },
  setGround(point: { x: number; y: number } | null): void {
    if (point === null) {
      groundPoint.valid = false;
      return;
    }
    groundPoint.x = point.x;
    groundPoint.y = point.y;
    groundPoint.valid = true;
  },
  setScreen(x: number, y: number): void {
    screenPoint.x = x;
    screenPoint.y = y;
  },
  reset(): void {
    groundPoint.x = 0;
    groundPoint.y = 0;
    groundPoint.valid = false;
    screenPoint.x = 0;
    screenPoint.y = 0;
  },
};
