// Client interaction mode and tool state (ADR 0048): primary mode
// (command | build | logistics) plus mutually exclusive secondary tools
// (place | demolish | road), ghost placement code, and two-step demolish
// confirmation. Road-link selection lives in features/logistics'
// road-tool store (ADR 0062).
import { create } from 'zustand';
import { useSelectionStore } from './selection-store';

export type PrimaryMode = 'command' | 'build' | 'logistics';

export type SecondaryTool =
  | { kind: 'none' }
  | { kind: 'place'; structureKindId: string }
  | { kind: 'demolish' }
  | { kind: 'road' };

interface DemolishConfirmState {
  targetKey: string;
  targets: readonly number[];
  expiresAt: number;
}

interface GhostState {
  x: number;
  y: number;
  code: string;
}

interface DemolishHoverState {
  handle: number;
  refunds: readonly { cargo: number; milli: number }[];
}

export const DEMOLISH_CONFIRM_MS = 2500;

export function targetKeyForHandles(handles: readonly number[]): string {
  return [...new Set(handles)].sort((a, b) => a - b).join(',');
}

export interface InteractionState {
  mode: PrimaryMode;
  tool: SecondaryTool;
  ghost: GhostState | null;
  demolishConfirm: DemolishConfirmState | null;
  demolishHover: DemolishHoverState | null;
  setMode(mode: PrimaryMode): void;
  enterPlace(structureKindId: string): void;
  enterDemolish(): void;
  enterRoad(): void;
  exitTool(): void;
  armDemolishConfirm(targets: readonly number[], now: number): void;
  clearDemolishConfirm(): void;
  setGhost(ghost: GhostState | null): void;
  setDemolishHover(hover: DemolishHoverState | null): void;
  reset(): void;
}

const INITIAL_STATE = {
  mode: 'command' as PrimaryMode,
  tool: { kind: 'none' } as SecondaryTool,
  ghost: null as GhostState | null,
  demolishConfirm: null as DemolishConfirmState | null,
  demolishHover: null as DemolishHoverState | null,
};

// Tool-transient fields cleared whenever the active tool changes.
function toolTransientClear(): {
  ghost: GhostState | null;
  demolishConfirm: DemolishConfirmState | null;
  demolishHover: DemolishHoverState | null;
} {
  return {
    ghost: null,
    demolishConfirm: null,
    demolishHover: null,
  };
}

export const useInteractionStore = create<InteractionState>((set) => {
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  function clearConfirmTimer(): void {
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  }

  return {
    ...INITIAL_STATE,
    setMode: (mode) => {
      clearConfirmTimer();
      set({
        mode,
        tool: { kind: 'none' },
        ...toolTransientClear(),
      });
    },
    enterPlace: (structureKindId) => {
      clearConfirmTimer();
      set((s) => ({
        mode: 'build',
        tool: { kind: 'place', structureKindId },
        ...toolTransientClear(),
        ghost:
          s.tool.kind === 'place' && s.tool.structureKindId === structureKindId ? s.ghost : null,
      }));
    },
    enterDemolish: () => {
      clearConfirmTimer();
      set({
        mode: 'build',
        tool: { kind: 'demolish' },
        ...toolTransientClear(),
      });
    },
    enterRoad: () => {
      clearConfirmTimer();
      set({
        mode: 'logistics',
        tool: { kind: 'road' },
        ...toolTransientClear(),
      });
    },
    exitTool: () => {
      clearConfirmTimer();
      set({
        tool: { kind: 'none' },
        ...toolTransientClear(),
      });
    },
    armDemolishConfirm: (targets, now) => {
      clearConfirmTimer();
      const normalized = [...new Set(targets)].sort((a, b) => a - b);
      const expiresAt = now + DEMOLISH_CONFIRM_MS;
      set({
        demolishConfirm: {
          targetKey: normalized.join(','),
          targets: normalized,
          expiresAt,
        },
      });
      confirmTimer = setTimeout(() => {
        confirmTimer = null;
        set((s) => (s.demolishConfirm?.expiresAt === expiresAt ? { demolishConfirm: null } : s));
      }, DEMOLISH_CONFIRM_MS);
    },
    clearDemolishConfirm: () => {
      clearConfirmTimer();
      set({ demolishConfirm: null });
    },
    setGhost: (ghost) => {
      set({ ghost });
    },
    setDemolishHover: (demolishHover) => {
      set({ demolishHover });
    },
    reset: () => {
      clearConfirmTimer();
      // Fresh tool object so tool-change subscribers (the logistics
      // road-tool store, ADR 0062) see the reset even when the tool was
      // already 'none'.
      set({ ...INITIAL_STATE, tool: { kind: 'none' } });
    },
  };
});

useSelectionStore.subscribe((state, prev) => {
  if (state.selected !== prev.selected && useInteractionStore.getState().demolishConfirm !== null) {
    useInteractionStore.getState().clearDemolishConfirm();
  }
});
