// Canvas pointer listeners -> intents (ADR 0048). Secondary tools
// (place, demolish, road) suppress box drag and emit tool clicks on left
// release and tool.exit on right release. In tool='none', left click/drag
// selects, while right click issues move orders only in command mode.
import type { PrimaryMode, SecondaryTool } from '../client/interaction-store';
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
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

interface PointerEventLike extends PointLike {
  button: number;
  pointerId?: number;
  preventDefault(): void;
}

interface WheelEventLike extends PointLike {
  deltaY: number;
  preventDefault(): void;
}

interface PointerTarget {
  addEventListener(type: string, listener: EventListener, options?: unknown): void;
  removeEventListener(type: string, listener: EventListener): void;
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
}

export interface PointerContext {
  mode: PrimaryMode;
  tool: SecondaryTool['kind'];
}

export interface PointerOptions {
  // Mode + secondary tool context for routing clicks and drag-box gating.
  getContext?: () => PointerContext;
  // Receives the 'blur' listener that cancels an in-flight drag when the
  // window loses focus; defaults to `window` when available.
  blurTarget?: PointerTarget | null;
}

// The dispatch callback receives fully-formed intents; the live box rect
// goes to onBox so the HUD can draw the overlay rectangle.
export function installPointer(
  target: PointerTarget,
  dispatch: (intent: Intent) => void,
  onBox: (box: { x0: number; y0: number; x1: number; y1: number } | null) => void,
  getPos: (event: PointLike) => { x: number; y: number },
  options: PointerOptions = {},
): () => void {
  let downButton = -1;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  let boxing = false;
  let panning = false;
  let orbiting = false;
  let leftWhileDown = false;

  const currentContext = (): PointerContext =>
    options.getContext?.() ?? { mode: 'command', tool: 'none' };

  const resetDrag = (): void => {
    downButton = -1;
    boxing = false;
    panning = false;
    orbiting = false;
    onBox(null);
    if (leftWhileDown) {
      leftWhileDown = false;
      dispatch({ kind: 'cursor.leave' });
    }
  };

  const down = (event: PointerEventLike): void => {
    if (downButton !== -1) {
      return;
    }
    leftWhileDown = false;
    const pos = getPos(event);
    downButton = event.button;
    downX = pos.x;
    downY = pos.y;
    lastX = pos.x;
    lastY = pos.y;
    boxing = false;
    const isAltLeft = event.button === 0 && event.altKey === true;
    const isCameraButton = event.button === 1 || isAltLeft;
    panning = isCameraButton && event.shiftKey;
    orbiting = isCameraButton && !event.shiftKey;
    if (event.pointerId !== undefined) {
      // Capture keeps move/up events flowing to this element even when
      // the pointer leaves the canvas mid-drag.
      target.setPointerCapture?.(event.pointerId);
    }
    if (event.button === 1 || event.button === 2 || isAltLeft) {
      event.preventDefault();
    }
    if (panning) {
      dispatch({ kind: 'camera.pan_start', x: pos.x, y: pos.y });
    }
  };

  const enter = (): void => {
    leftWhileDown = false;
  };

  const move = (event: PointerEventLike): void => {
    leftWhileDown = false;
    const pos = getPos(event);
    if (downButton === -1) {
      dispatch({ kind: 'cursor.move', x: pos.x, y: pos.y });
      return;
    }
    if (orbiting) {
      dispatch({ kind: 'camera.orbit_px', dx: pos.x - lastX, dy: pos.y - lastY });
      lastX = pos.x;
      lastY = pos.y;
      return;
    }
    if (panning) {
      dispatch({
        kind: 'camera.pan_px',
        prevX: lastX,
        prevY: lastY,
        x: pos.x,
        y: pos.y,
      });
      lastX = pos.x;
      lastY = pos.y;
      return;
    }
    if (
      downButton === 0 &&
      currentContext().tool === 'none' &&
      (boxing || dragExceeded(pos.x - downX, pos.y - downY))
    ) {
      boxing = true;
      onBox(normalizeBox(downX, downY, pos.x, pos.y));
    }
  };

  const up = (event: PointerEventLike): void => {
    if (event.button !== downButton) {
      return;
    }
    if (orbiting || panning) {
      resetDrag();
      return;
    }
    const pos = getPos(event);
    const additive = event.shiftKey;
    const { mode, tool } = currentContext();
    if (tool === 'place') {
      if (downButton === 0) {
        dispatch({ kind: 'build.place', x: pos.x, y: pos.y, blueprint: additive });
      } else if (downButton === 2) {
        dispatch({ kind: 'tool.exit' });
      }
    } else if (tool === 'demolish') {
      if (downButton === 0) {
        dispatch({ kind: 'demolish.click', x: pos.x, y: pos.y });
      } else if (downButton === 2) {
        dispatch({ kind: 'tool.exit' });
      }
    } else if (tool === 'road') {
      if (downButton === 0) {
        dispatch({ kind: 'road.click', x: pos.x, y: pos.y, additive });
      } else if (downButton === 2) {
        dispatch({ kind: 'tool.exit' });
      }
    } else if (downButton === 0) {
      if (boxing) {
        dispatch({ kind: 'select.box', x0: downX, y0: downY, x1: pos.x, y1: pos.y, additive });
      } else {
        dispatch({ kind: 'select.click', x: pos.x, y: pos.y, additive });
      }
    } else if (downButton === 2 && mode === 'command') {
      dispatch({
        kind: 'command.move_to',
        x: pos.x,
        y: pos.y,
        guard: event.ctrlKey === true || event.metaKey === true,
      });
    }
    resetDrag();
  };

  // Aborts an in-flight drag without emitting select.box — pointer
  // cancel/lost capture (touch pre-empted, capture released early) and
  // window blur all land here.
  const cancel = (): void => {
    resetDrag();
  };

  const wheel = (event: WheelEventLike): void => {
    event.preventDefault();
    const pos = getPos(event);
    dispatch({ kind: 'camera.zoom', delta: event.deltaY > 0 ? 0.2 : -0.2, x: pos.x, y: pos.y });
  };

  const context = (event: Event): void => {
    event.preventDefault();
  };

  const leave = (): void => {
    if (downButton === -1) {
      dispatch({ kind: 'cursor.leave' });
    } else {
      leftWhileDown = true;
    }
  };

  const downListener = down as unknown as EventListener;
  const enterListener = enter as EventListener;
  const moveListener = move as unknown as EventListener;
  const upListener = up as unknown as EventListener;
  const wheelListener = wheel as unknown as EventListener;
  const contextListener = context;
  const cancelListener = cancel as EventListener;
  const leaveListener = leave as EventListener;

  const blurTarget =
    options.blurTarget !== undefined
      ? options.blurTarget
      : typeof window === 'undefined'
        ? null
        : (window as unknown as PointerTarget);

  target.addEventListener('pointerdown', downListener);
  target.addEventListener('pointerenter', enterListener);
  target.addEventListener('pointermove', moveListener);
  target.addEventListener('pointerup', upListener);
  target.addEventListener('pointercancel', cancelListener);
  target.addEventListener('lostpointercapture', cancelListener);
  target.addEventListener('pointerleave', leaveListener);
  target.addEventListener('wheel', wheelListener, { passive: false });
  target.addEventListener('contextmenu', contextListener);
  blurTarget?.addEventListener('blur', cancelListener);
  return () => {
    target.removeEventListener('pointerdown', downListener);
    target.removeEventListener('pointerenter', enterListener);
    target.removeEventListener('pointermove', moveListener);
    target.removeEventListener('pointerup', upListener);
    target.removeEventListener('pointercancel', cancelListener);
    target.removeEventListener('lostpointercapture', cancelListener);
    target.removeEventListener('pointerleave', leaveListener);
    target.removeEventListener('wheel', wheelListener);
    target.removeEventListener('contextmenu', contextListener);
    blurTarget?.removeEventListener('blur', cancelListener);
  };
}
