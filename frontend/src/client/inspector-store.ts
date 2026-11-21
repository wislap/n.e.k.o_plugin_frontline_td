// Inspector focus state (ADR 0048): separates volatile pointer hover
// from click-pinned inspection subjects. Terrain cells are hover-only
// and statically excluded from `pinned`.
import { create } from 'zustand';

export type PinnableSubject =
  | { kind: 'own_unit'; handle: number }
  | { kind: 'hostile_unit'; handle: number }
  | { kind: 'own_structure'; handle: number }
  | { kind: 'hostile_structure'; handle: number }
  | { kind: 'ruin'; handle: number }
  | { kind: 'salvage'; handle: number }
  | { kind: 'road_segment'; handle: number }
  | {
      kind: 'memory';
      handle: number;
      kindIndex: number;
      x: number;
      y: number;
      faction: number;
      state: number;
    }
  | { kind: 'multi_own'; count: number };

type CellHoverSubject = { kind: 'cell'; x: number; y: number };

export type HoverSubject = PinnableSubject | CellHoverSubject;

export function sameHoverSubject(a: HoverSubject | null, b: HoverSubject | null): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null || a.kind !== b.kind) {
    return false;
  }
  switch (a.kind) {
    case 'cell':
      return b.kind === 'cell' && a.x === b.x && a.y === b.y;
    case 'multi_own':
      return b.kind === 'multi_own' && a.count === b.count;
    case 'memory':
      return (
        b.kind === 'memory' &&
        a.handle === b.handle &&
        a.kindIndex === b.kindIndex &&
        a.x === b.x &&
        a.y === b.y &&
        a.faction === b.faction &&
        a.state === b.state
      );
    case 'own_unit':
    case 'hostile_unit':
    case 'own_structure':
    case 'hostile_structure':
    case 'ruin':
    case 'salvage':
    case 'road_segment':
      return b.kind === a.kind && a.handle === b.handle;
  }
}

export interface InspectorState {
  hovered: HoverSubject | null;
  pinned: PinnableSubject | null;
  setHovered(subject: HoverSubject | null): void;
  pin(subject: PinnableSubject | null): void;
  unpin(): void;
  reset(): void;
}

export function activeInspectorSubject(
  state: Pick<InspectorState, 'hovered' | 'pinned'>,
): HoverSubject | null {
  return state.pinned ?? state.hovered;
}

export const useInspectorStore = create<InspectorState>((set) => ({
  hovered: null,
  pinned: null,
  setHovered: (subject) => {
    set((s) => (sameHoverSubject(s.hovered, subject) ? s : { hovered: subject }));
  },
  pin: (subject) => {
    set((s) => (sameHoverSubject(s.pinned, subject) ? s : { pinned: subject }));
  },
  unpin: () => {
    set((s) => (s.pinned === null ? s : { pinned: null }));
  },
  reset: () => {
    set({ hovered: null, pinned: null });
  },
}));
