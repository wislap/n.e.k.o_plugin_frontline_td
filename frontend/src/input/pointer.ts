// Canvas pointer listeners → intents (M2 C5). Left click selects, left
// drag >4px draws a box selection, right click issues a move command,
// middle drag pans (ground-anchored), wheel zooms, Shift = additive.
// Helpers are pure so the drag threshold and box normalization are
// unit-testable; the installer is duck-typed like installKeyboard.
import type { Intent } from './intents';

export const DRAG_THRESHOLD_PX = 4;

export function dragExceeded(
  dx: number,
  dy: number,
  threshold: number = DRAG_THRESHOLD_PX,
): boolean {
  return dx * dx + dy * dy > threshold * threshold;
}

export function normalizeBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1),
  };
}

interface PointLike {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
}

interface PointerEventLike extends PointLike {
  button: number;
  preventDefault(): void;
}

interface WheelEventLike extends PointLike {
  deltaY: number;
  preventDefault(): void;
}

interface PointerTarget {
  addEventListener(type: string, listener: EventListener, options?: unknown): void;
  removeEventListener(type: string, listener: EventListener): void;
}

// The dispatch callback receives fully-formed intents; the live box rect
// goes to onBox so the HUD can draw the overlay rectangle.
export function installPointer(
  target: PointerTarget,
  dispatch: (intent: Intent) => void,
  onBox: (box: { x0: number; y0: number; x1: number; y1: number } | null) => void,
  getPos: (event: PointLike) => { x: number; y: number },
): () => void {
  let downButton = -1;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  let boxing = false;
  let panning = false;

  const down = (event: PointerEventLike): void => {
    if (downButton !== -1) {
      return;
    }
    const pos = getPos(event);
    downButton = event.button;
    downX = pos.x;
    downY = pos.y;
    lastX = pos.x;
    lastY = pos.y;
    boxing = false;
    panning = event.button === 1;
    if (event.button === 1 || event.button === 2) {
      event.preventDefault();
    }
  };

  const move = (event: PointerEventLike): void => {
    if (downButton === -1) {
      return;
    }
    const pos = getPos(event);
    if (panning) {
      dispatch({ kind: 'camera.pan_px', dx: lastX - pos.x, dy: lastY - pos.y });
      lastX = pos.x;
      lastY = pos.y;
      return;
    }
    if (downButton === 0 && (boxing || dragExceeded(pos.x - downX, pos.y - downY))) {
      boxing = true;
      onBox(normalizeBox(downX, downY, pos.x, pos.y));
    }
  };

  const up = (event: PointerEventLike): void => {
    if (event.button !== downButton) {
      return;
    }
    const pos = getPos(event);
    const additive = event.shiftKey;
    if (downButton === 0) {
      if (boxing) {
        dispatch({ kind: 'select.box', x0: downX, y0: downY, x1: pos.x, y1: pos.y, additive });
      } else {
        dispatch({ kind: 'select.click', x: pos.x, y: pos.y, additive });
      }
    } else if (downButton === 2) {
      dispatch({ kind: 'command.move_to', x: pos.x, y: pos.y });
    }
    downButton = -1;
    boxing = false;
    panning = false;
    onBox(null);
  };

  const wheel = (event: WheelEventLike): void => {
    event.preventDefault();
    const pos = getPos(event);
    dispatch({ kind: 'camera.zoom', delta: event.deltaY > 0 ? 0.2 : -0.2, x: pos.x, y: pos.y });
  };

  const context = (event: Event): void => {
    event.preventDefault();
  };

  const downListener = down as unknown as EventListener;
  const moveListener = move as unknown as EventListener;
  const upListener = up as unknown as EventListener;
  const wheelListener = wheel as unknown as EventListener;
  const contextListener = context;

  target.addEventListener('pointerdown', downListener);
  target.addEventListener('pointermove', moveListener);
  target.addEventListener('pointerup', upListener);
  target.addEventListener('wheel', wheelListener, { passive: false });
  target.addEventListener('contextmenu', contextListener);
  return () => {
    target.removeEventListener('pointerdown', downListener);
    target.removeEventListener('pointermove', moveListener);
    target.removeEventListener('pointerup', upListener);
    target.removeEventListener('wheel', wheelListener);
    target.removeEventListener('contextmenu', contextListener);
  };
}
