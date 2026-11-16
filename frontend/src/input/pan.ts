// Held-key pan state (M2 C5): WASD + arrow keys pan continuously while
// held. The tracker keeps a pressed-key set and exposes panVector(); the
// camera rig reads it each frame.
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

export interface PanTracker {
  handleKeyDown(code: string): void;
  handleKeyUp(code: string): void;
  // Normalized pan direction in map cells (y grows south, matching map y).
  panVector(): { x: number; y: number };
  reset(): void;
}

export function createPanTracker(): PanTracker {
  const held = new Set<string>();
  return {
    handleKeyDown(code) {
      if (code in PAN_KEYS) {
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
    tracker.handleKeyDown((event as KeyboardEvent).code);
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
