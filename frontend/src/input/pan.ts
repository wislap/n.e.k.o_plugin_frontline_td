// Held-key camera navigation (M2 C5, ADR 0060): WASD + arrow keys pan
// continuously and Q / E rotate horizontal yaw while held. The tracker keeps
// a pressed-key set and exposes panVector() / yawDelta(); the camera rig
// reads both every frame.
const PAN_KEYS: Readonly<Record<string, { x: number; y: number }>> = {
  KeyW: { x: 0, y: -1 },
  ArrowUp: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

const ROTATE_KEYS: Readonly<Record<string, number>> = {
  KeyQ: -1,
  KeyE: 1,
};

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') {
    return false;
  }
  const el = target as { isContentEditable?: boolean; tagName?: string };
  if (el.isContentEditable === true) {
    return true;
  }
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

export interface PanTracker {
  handleKeyDown(code: string): void;
  handleKeyUp(code: string): void;
  // Normalized pan direction in screen axes (+x right, +y down/backward).
  panVector(): { x: number; y: number };
  // Continuous yaw direction (-1 for Q / CCW, +1 for E / CW, 0 if balanced).
  yawDelta(): number;
  reset(): void;
}

export function createPanTracker(): PanTracker {
  const held = new Set<string>();
  return {
    handleKeyDown(code) {
      if (code in PAN_KEYS || code in ROTATE_KEYS) {
        held.add(code);
      }
    },
    handleKeyUp(code) {
      held.delete(code);
    },
    panVector() {
      let x = 0;
      let y = 0;
      for (const code of held) {
        const dir = PAN_KEYS[code];
        if (dir !== undefined) {
          x += dir.x;
          y += dir.y;
        }
      }
      const len = Math.hypot(x, y);
      return len === 0 ? { x: 0, y: 0 } : { x: x / len, y: y / len };
    },
    yawDelta() {
      let dir = 0;
      for (const code of held) {
        dir += ROTATE_KEYS[code] ?? 0;
      }
      return dir;
    },
    reset() {
      held.clear();
    },
  };
}

export function installPanTracking(
  target: Pick<HTMLElement, 'addEventListener' | 'removeEventListener'>,
  tracker: PanTracker,
): () => void {
  const down = (event: Event): void => {
    const ev = event as KeyboardEvent;
    if (isTextEntryTarget(ev.target) || ev.ctrlKey || ev.metaKey || ev.altKey) {
      return;
    }
    tracker.handleKeyDown(ev.code);
  };
  const up = (event: Event): void => {
    tracker.handleKeyUp((event as KeyboardEvent).code);
  };
  const blur = (): void => {
    tracker.reset();
  };
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  target.addEventListener('blur', blur);
  return () => {
    target.removeEventListener('keydown', down);
    target.removeEventListener('keyup', up);
    target.removeEventListener('blur', blur);
  };
}
