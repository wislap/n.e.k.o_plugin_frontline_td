import { describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD_PX, dragExceeded, normalizeBox } from './pointer';

describe('pointer helpers', () => {
  it('drag threshold is exclusive beyond DRAG_THRESHOLD_PX', () => {
    expect(dragExceeded(0, 0)).toBe(false);
    expect(dragExceeded(DRAG_THRESHOLD_PX, 0)).toBe(false);
    expect(dragExceeded(DRAG_THRESHOLD_PX + 0.1, 0)).toBe(true);
    expect(dragExceeded(3, 3)).toBe(true); // √(9+9) > 4
  });

  it('normalizeBox orders corners regardless of drag direction', () => {
    expect(normalizeBox(10, 20, 5, 8)).toEqual({ x0: 5, y0: 8, x1: 10, y1: 20 });
    expect(normalizeBox(5, 8, 10, 20)).toEqual({ x0: 5, y0: 8, x1: 10, y1: 20 });
  });
});

// Build-mode rerouting and hover tracking (M3 D).
import { installPointer } from './pointer';
import type { Intent } from './intents';

interface FakeTarget {
  listeners: Map<string, EventListener>;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(): void;
  fire(type: string, event: unknown): void;
}

function fakeTarget(): FakeTarget {
  const listeners = new Map<string, EventListener>();
  return {
    listeners,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener() {},
    fire(type, event) {
      listeners.get(type)?.(event as Event);
    },
  };
}

function makePointer(mode: () => 'normal' | 'build') {
  const target = fakeTarget();
  const intents: Intent[] = [];
  installPointer(
    target,
    (i) => intents.push(i),
    () => {},
    (e) => ({ x: (e as { clientX: number }).clientX, y: (e as { clientY: number }).clientY }),
    { getMode: mode },
  );
  const press = (button: number, x: number, y: number, shiftKey = false) => {
    target.fire('pointerdown', { button, clientX: x, clientY: y, shiftKey, preventDefault() {} });
    target.fire('pointerup', { button, clientX: x, clientY: y, shiftKey, preventDefault() {} });
  };
  return { target, intents, press };
}

describe('pointer modes', () => {
  it('emits cursor.move on hover with no button held', () => {
    const { target, intents } = makePointer(() => 'normal');
    target.fire('pointermove', { clientX: 9, clientY: 7 });
    expect(intents).toEqual([{ kind: 'cursor.move', x: 9, y: 7 }]);
  });

  it('routes left click to build.place and right click to build.cancel in build mode', () => {
    const { intents, press } = makePointer(() => 'build');
    press(0, 30, 40);
    press(0, 50, 60, true);
    press(2, 70, 80);
    expect(intents).toEqual([
      { kind: 'build.place', x: 30, y: 40, blueprint: false },
      { kind: 'build.place', x: 50, y: 60, blueprint: true },
      { kind: 'build.cancel' },
    ]);
  });

  it('never boxes or move-orders while in build mode', () => {
    const target = fakeTarget();
    const intents: Intent[] = [];
    installPointer(
      target,
      (i) => intents.push(i),
      () => {},
      (e) => ({ x: (e as { clientX: number }).clientX, y: (e as { clientY: number }).clientY }),
      { getMode: () => 'build' },
    );
    target.fire('pointerdown', {
      button: 0,
      clientX: 0,
      clientY: 0,
      shiftKey: false,
      preventDefault() {},
    });
    target.fire('pointermove', { clientX: 50, clientY: 50, shiftKey: false });
    target.fire('pointerup', { button: 0, clientX: 50, clientY: 50, shiftKey: false });
    expect(intents).toEqual([{ kind: 'build.place', x: 50, y: 50, blueprint: false }]);
  });
});
