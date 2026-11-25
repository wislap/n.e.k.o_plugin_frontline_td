// Transient toast queue (UI-only state, ADR 0004): push() caps the
// stack at 4 items and owns each item's 3 s expiry timer. Cleared on
// per-match client reset like the other client stores.
import { create } from 'zustand';
import { registerSessionReset } from '../client/session';
import type { ToastItem } from './kit/index';

const TOAST_MS = 3_000;
const MAX_TOASTS = 4;

interface ToastStore {
  readonly items: readonly ToastItem[];
  push(tone: ToastItem['tone'], text: string): void;
}

let seq = 0;

export const useToastStore = create<ToastStore>()((set) => ({
  items: [],
  push: (tone, text) => {
    seq += 1;
    const id = `toast-${seq}`;
    set((s) => ({ items: [...s.items.slice(-(MAX_TOASTS - 1)), { id, tone, text }] }));
    setTimeout(() => {
      set((s) => ({ items: s.items.filter((item) => item.id !== id) }));
    }, TOAST_MS);
  },
}));

registerSessionReset(() => {
  useToastStore.setState({ items: [] });
});
