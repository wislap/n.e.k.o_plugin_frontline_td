// Mode-layered keyboard translation (ADR 0048): resolves KeyEventLike
// against MODE_KEYMAPS[mode] first, falling back to GLOBAL_KEYMAP, and
// prevents default browser actions (e.g. Tab focus, F1-F3 shortcuts).
import type { PrimaryMode } from '../client/interaction-store';
import type { Intent } from './intents';
import { GLOBAL_KEYMAP, MODE_KEYMAPS } from './keymap';

export interface KeyEventLike {
  code: string;
  key?: string;
  repeat: boolean;
  target: EventTarget | null;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

// Duck-typed so the module stays testable without a DOM and usable in any
// document context.
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

export function intentForKey(event: KeyEventLike, mode: PrimaryMode): Intent | null {
  if (event.repeat || isTextEntryTarget(event.target)) {
    return null;
  }
  const hasCtrlOrMeta = event.ctrlKey === true || event.metaKey === true;
  const hasAlt = event.altKey === true;
  if (
    !hasCtrlOrMeta &&
    !hasAlt &&
    (event.key === '?' || (event.code === 'Slash' && event.shiftKey === true))
  ) {
    return { kind: 'ui.toggle_keymap_help' };
  }
  const intent = MODE_KEYMAPS[mode][event.code] ?? GLOBAL_KEYMAP[event.code];
  if (intent === undefined) {
    return null;
  }
  const modified = hasCtrlOrMeta || hasAlt;
  // Modifier-sensitive intents get the event's Ctrl/Cmd state filled in.
  if (intent.kind === 'squad.digit') {
    return { ...intent, ctrl: hasCtrlOrMeta };
  }
  // With Ctrl/Cmd/Alt held the key belongs to the browser/OS (Ctrl+C is
  // "copy", Alt+key is a menu) — returning null leaves the event
  // unprevented, unlike dispatching the bare-key binding.
  if (modified) {
    return null;
  }
  return intent;
}

export function installKeyboard(
  target: Pick<HTMLElement, 'addEventListener' | 'removeEventListener'>,
  getMode: () => PrimaryMode,
  dispatch: (intent: Intent) => void,
): () => void {
  const handler = (event: Event): void => {
    const intent = intentForKey(event as KeyboardEvent, getMode());
    if (intent !== null) {
      event.preventDefault();
      dispatch(intent);
    }
  };
  target.addEventListener('keydown', handler);
  return () => {
    target.removeEventListener('keydown', handler);
  };
}
