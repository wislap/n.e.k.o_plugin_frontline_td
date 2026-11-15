import type { Intent } from './intents';

export interface KeyEventLike {
  code: string;
  repeat: boolean;
  target: EventTarget | null;
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
  return keymap[event.code] ?? null;
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
