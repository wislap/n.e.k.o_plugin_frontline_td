import type { Intent } from './intents';

export interface KeyEventLike {
  code: string;
  repeat: boolean;
  target: EventTarget | null;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
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

export function intentForKey(
  event: KeyEventLike,
  keymap: Readonly<Record<string, Intent>>,
): Intent | null {
  if (event.repeat || isTextEntryTarget(event.target)) {
    return null;
  }
  const intent = keymap[event.code];
  if (intent === undefined) {
    return null;
  }
  const modified = event.ctrlKey === true || event.metaKey === true || event.altKey === true;
  // Modifier-sensitive intents get the event's Ctrl/Cmd state filled in.
  if (intent.kind === 'squad.digit') {
    return { ...intent, ctrl: event.ctrlKey === true || event.metaKey === true };
  }
  // With Ctrl/Cmd/Alt held the key belongs to the browser/OS (Ctrl+X is
  // "cut", Alt+key is a menu) — returning null leaves the event
  // unprevented, unlike dispatching the bare-key binding.
  if (modified) {
    return null;
  }
  return intent;
}

export function installKeyboard(
  target: Pick<HTMLElement, 'addEventListener' | 'removeEventListener'>,
  keymap: Readonly<Record<string, Intent>>,
  dispatch: (intent: Intent) => void,
): () => void {
  const handler = (event: Event): void => {
    const intent = intentForKey(event as KeyboardEvent, keymap);
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
