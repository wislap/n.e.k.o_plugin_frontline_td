// Zustand store for worker-reported runtime state (stats + last error).
import { create } from 'zustand';
import type { RuntimeStats } from '../protocol/index';

export interface RuntimeState {
  stats: RuntimeStats | null;
  error: string | null;
  setStats(stats: RuntimeStats): void;
  setError(message: string): void;
  reset(): void;
}

export const useRuntimeStore = create<RuntimeState>((set) => ({
  stats: null,
  error: null,
  setStats: (stats) => {
    set({ stats });
  },
  setError: (message) => {
    set({ error: message });
  },
  reset: () => {
    set({ stats: null, error: null });
  },
}));
