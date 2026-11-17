import { describe, expect, test, vi } from 'vitest';
import { installVisibilityPause, type DocumentLike } from './visibility';

function fakeDoc(): DocumentLike & { fire(): void } {
  const listeners = new Map<string, EventListener[]>();
  return {
    hidden: false,
    addEventListener: (type, fn) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener: (type, fn) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((l) => l !== fn),
      );
    },
    fire(this: DocumentLike & { fire(): void }) {
      for (const fn of listeners.get('visibilitychange') ?? []) {
        fn(new Event('visibilitychange'));
      }
    },
  };
}

describe('installVisibilityPause', () => {
  test('fires only when hidden', () => {
    const doc = fakeDoc();
    const onHidden = vi.fn();
    installVisibilityPause(doc, onHidden);
    doc.hidden = false;
    doc.fire();
    expect(onHidden).not.toHaveBeenCalled();
    doc.hidden = true;
    doc.fire();
    expect(onHidden).toHaveBeenCalledTimes(1);
    // Going visible again does nothing (no auto-resume).
    doc.hidden = false;
    doc.fire();
    expect(onHidden).toHaveBeenCalledTimes(1);
  });

  test('uninstaller removes the listener', () => {
    const doc = fakeDoc();
    const onHidden = vi.fn();
    const off = installVisibilityPause(doc, onHidden);
    off();
    doc.hidden = true;
    doc.fire();
    expect(onHidden).not.toHaveBeenCalled();
  });
});
