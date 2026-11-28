import { describe, expect, it } from 'vitest';
import type { Intent } from './intents';
import {
  DRAG_THRESHOLD_PX,
  dragExceeded,
  installPointer,
  normalizeBox,
  type PointerContext,
} from './pointer';

describe('pointer helpers', () => {
  it('drag threshold is exclusive beyond DRAG_THRESHOLD_PX', () => {
    expect(dragExceeded(0, 0)).toBe(false);
    expect(dragExceeded(DRAG_THRESHOLD_PX, 0)).toBe(false);
    expect(dragExceeded(DRAG_THRESHOLD_PX + 0.1, 0)).toBe(true);
    expect(dragExceeded(3, 3)).toBe(true); // sqrt(9+9) > 4
  });

  it('normalizeBox orders corners regardless of drag direction', () => {
    expect(normalizeBox(10, 20, 5, 8)).toEqual({ x0: 5, y0: 8, x1: 10, y1: 20 });
    expect(normalizeBox(5, 8, 10, 20)).toEqual({ x0: 5, y0: 8, x1: 10, y1: 20 });
  });
});

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

function makePointer(getContext: () => PointerContext) {
  const target = fakeTarget();
  const intents: Intent[] = [];
  const boxes: unknown[] = [];
  installPointer(
    target,
    (i) => intents.push(i),
    (b) => boxes.push(b),
    (e) => ({ x: (e as { clientX: number }).clientX, y: (e as { clientY: number }).clientY }),
    { getContext },
  );
  const press = (
    button: number,
    x: number,
    y: number,
    mods: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
  ) => {
    const shiftKey = mods.shiftKey ?? false;
    target.fire('pointerdown', {
      button,
      clientX: x,
      clientY: y,
      shiftKey,
      ...mods,
      preventDefault() {},
    });
    target.fire('pointerup', {
      button,
      clientX: x,
      clientY: y,
      shiftKey,
      ...mods,
      preventDefault() {},
    });
  };
  return { target, intents, boxes, press };
}

describe('pointer modes and secondary tools', () => {
  it('emits cursor.move on hover with no button held', () => {
    const { target, intents } = makePointer(() => ({ mode: 'command', tool: 'none' }));
    target.fire('pointermove', { clientX: 9, clientY: 7 });
    expect(intents).toEqual([{ kind: 'cursor.move', x: 9, y: 7 }]);
  });

  it('emits cursor.leave on pointerleave when idle and defers mid-drag pointerleave until pointerup', () => {
    const { target, intents } = makePointer(() => ({ mode: 'command', tool: 'none' }));
    target.fire('pointerleave', {});
    expect(intents).toEqual([{ kind: 'cursor.leave' }]);

    target.fire('pointerdown', {
      button: 0,
      clientX: 0,
      clientY: 0,
      shiftKey: false,
      preventDefault() {},
    });
    target.fire('pointerleave', {});
    // Suppressed while dragging.
    expect(intents).toEqual([{ kind: 'cursor.leave' }]);

    target.fire('pointerup', { button: 0, clientX: 0, clientY: 0, shiftKey: false });
    expect(intents).toEqual([
      { kind: 'cursor.leave' },
      { kind: 'select.click', x: 0, y: 0, additive: false },
      { kind: 'cursor.leave' },
    ]);

    target.fire('pointerleave', {});
    expect(intents).toEqual([
      { kind: 'cursor.leave' },
      { kind: 'select.click', x: 0, y: 0, additive: false },
      { kind: 'cursor.leave' },
      { kind: 'cursor.leave' },
    ]);
  });

  it('defers cursor.leave across middle-button drag release and suppresses if pointermove/enter returns', () => {
    const { target, intents } = makePointer(() => ({ mode: 'build', tool: 'place' }));

    // pointerdown -> pointerleave -> pointerup emits deferred cursor.leave.
    target.fire('pointerdown', {
      button: 1,
      clientX: 10,
      clientY: 10,
      shiftKey: false,
      preventDefault() {},
    });
    target.fire('pointerleave', {});
    expect(intents).toEqual([]);
    target.fire('pointerup', { button: 1, clientX: -50, clientY: -50, shiftKey: false });
    expect(intents).toEqual([{ kind: 'cursor.leave' }]);

    // pointerdown -> pointerleave -> pointermove -> pointerup does NOT emit cursor.leave.
    intents.length = 0;
    target.fire('pointerdown', {
      button: 1,
      clientX: 10,
      clientY: 10,
      shiftKey: false,
      preventDefault() {},
    });
    target.fire('pointerleave', {});
    target.fire('pointermove', { clientX: 20, clientY: 20, shiftKey: false });
    target.fire('pointerup', { button: 1, clientX: 20, clientY: 20, shiftKey: false });
    expect(intents).toEqual([{ kind: 'camera.orbit_px', dx: 10, dy: 10 }]);

    // pointerdown -> pointerleave -> pointerenter -> pointerup does NOT emit cursor.leave.
    intents.length = 0;
    target.fire('pointerdown', {
      button: 0,
      clientX: 10,
      clientY: 10,
      shiftKey: false,
      preventDefault() {},
    });
    target.fire('pointerleave', {});
    target.fire('pointerenter', {});
    target.fire('pointerup', { button: 0, clientX: 10, clientY: 10, shiftKey: false });
    expect(intents).toEqual([{ kind: 'build.place', x: 10, y: 10, blueprint: false }]);
  });

  it('emits deferred cursor.leave when pointercancel or lostpointercapture aborts after pointerleave', () => {
    const { target, intents } = makePointer(() => ({ mode: 'command', tool: 'none' }));
    target.fire('pointerdown', {
      button: 0,
      clientX: 5,
      clientY: 5,
      shiftKey: false,
      preventDefault() {},
    });
    target.fire('pointerleave', {});
    expect(intents).toEqual([]);
    target.fire('lostpointercapture', {});
    expect(intents).toEqual([{ kind: 'cursor.leave' }]);
    target.fire('pointerup', { button: 0, clientX: 5, clientY: 5, shiftKey: false });
    expect(intents).toEqual([{ kind: 'cursor.leave' }]);
  });

  it('routes left click to build.place and right click to tool.exit in place tool', () => {
    const { intents, press } = makePointer(() => ({ mode: 'build', tool: 'place' }));
    press(0, 30, 40);
    press(0, 50, 60, { shiftKey: true });
    press(2, 70, 80);
    expect(intents).toEqual([
      { kind: 'build.place', x: 30, y: 40, blueprint: false },
      { kind: 'build.place', x: 50, y: 60, blueprint: true },
      { kind: 'tool.exit' },
    ]);
  });

  it('routes left click to demolish.click and right click to tool.exit in demolish tool', () => {
    const { intents, press } = makePointer(() => ({ mode: 'build', tool: 'demolish' }));
    press(0, 12, 34);
    press(2, 56, 78);
    expect(intents).toEqual([{ kind: 'demolish.click', x: 12, y: 34 }, { kind: 'tool.exit' }]);
  });

  it('routes left click to road.click and right click to tool.exit in road tool', () => {
    const { intents, press } = makePointer(() => ({ mode: 'logistics', tool: 'road' }));
    press(0, 10, 20);
    press(0, 15, 25, { shiftKey: true });
    press(2, 30, 40);
    expect(intents).toEqual([
      { kind: 'road.click', x: 10, y: 20, additive: false },
      { kind: 'road.click', x: 15, y: 25, additive: true },
      { kind: 'tool.exit' },
    ]);
  });

  it.each(['place', 'demolish', 'road'] as const)(
    'never boxes or calls onBox with a rect while %s tool is active',
    (tool) => {
      const { target, intents, boxes } = makePointer(() => ({ mode: 'build', tool }));
      target.fire('pointerdown', {
        button: 0,
        clientX: 0,
        clientY: 0,
        shiftKey: false,
        preventDefault() {},
      });
      target.fire('pointermove', { clientX: 50, clientY: 50, shiftKey: false });
      target.fire('pointerup', { button: 0, clientX: 50, clientY: 50, shiftKey: false });
      expect(boxes.filter((b) => b !== null)).toHaveLength(0);
      expect(intents).toHaveLength(1);
    },
  );

  it('right click issues command.move_to in command mode, and is a no-op in build/logistics', () => {
    const cmd = makePointer(() => ({ mode: 'command', tool: 'none' }));
    cmd.press(2, 10, 20);
    cmd.press(2, 30, 40, { ctrlKey: true });
    expect(cmd.intents).toEqual([
      { kind: 'command.move_to', x: 10, y: 20, guard: false },
      { kind: 'command.move_to', x: 30, y: 40, guard: true },
    ]);

    const build = makePointer(() => ({ mode: 'build', tool: 'none' }));
    build.press(2, 10, 20);
    expect(build.intents).toEqual([]);

    const logistics = makePointer(() => ({ mode: 'logistics', tool: 'none' }));
    logistics.press(2, 10, 20);
    expect(logistics.intents).toEqual([]);
  });

  it('left drag >4px emits select.box when tool is none', () => {
    const { target, intents, boxes } = makePointer(() => ({ mode: 'build', tool: 'none' }));
    target.fire('pointerdown', {
      button: 0,
      clientX: 0,
      clientY: 0,
      shiftKey: false,
      preventDefault() {},
    });
    target.fire('pointermove', { clientX: 20, clientY: 30, shiftKey: false });
    target.fire('pointerup', { button: 0, clientX: 20, clientY: 30, shiftKey: true });
    expect(boxes).toEqual([{ x0: 0, y0: 0, x1: 20, y1: 30 }, null]);
    expect(intents).toEqual([{ kind: 'select.box', x0: 0, y0: 0, x1: 20, y1: 30, additive: true }]);
  });
});

// Drag cancellation: pointercancel / lostpointercapture / window blur all
// abort an in-flight drag without emitting select.box, and the box
// overlay is cleared.
describe('pointer drag cancellation', () => {
  interface Harness {
    target: FakeTarget & { captured: number[]; setPointerCapture(id: number): void };
    blurTarget: ReturnType<typeof fakeTarget>;
    intents: Intent[];
    boxes: unknown[];
  }

  function makeHarness(): Harness {
    const base = fakeTarget() as Harness['target'];
    base.captured = [];
    base.setPointerCapture = (id: number) => {
      base.captured.push(id);
    };
    const blurTarget = fakeTarget();
    const intents: Intent[] = [];
    const boxes: unknown[] = [];
    installPointer(
      base,
      (i) => intents.push(i),
      (b) => boxes.push(b),
      (e) => ({ x: (e as { clientX: number }).clientX, y: (e as { clientY: number }).clientY }),
      { blurTarget },
    );
    return { target: base, blurTarget, intents, boxes };
  }

  function startDrag(h: Harness): void {
    h.target.fire('pointerdown', {
      button: 0,
      pointerId: 7,
      clientX: 0,
      clientY: 0,
      shiftKey: false,
      preventDefault() {},
    });
    h.target.fire('pointermove', { clientX: 50, clientY: 50, shiftKey: false });
  }

  it('captures the pointer on pointerdown', () => {
    const h = makeHarness();
    startDrag(h);
    expect(h.target.captured).toEqual([7]);
  });

  it.each(['pointercancel', 'lostpointercapture'])('%s aborts the drag', (type) => {
    const h = makeHarness();
    startDrag(h);
    h.target.fire(type, {});
    h.target.fire('pointerup', { button: 0, clientX: 50, clientY: 50, shiftKey: false });
    expect(h.intents.filter((i) => i.kind === 'select.box')).toHaveLength(0);
    expect(h.boxes.at(-1)).toBeNull();
    h.target.fire('pointerdown', {
      button: 0,
      clientX: 1,
      clientY: 1,
      shiftKey: false,
      preventDefault() {},
    });
    h.target.fire('pointerup', { button: 0, clientX: 1, clientY: 1, shiftKey: false });
    expect(h.intents).toContainEqual({ kind: 'select.click', x: 1, y: 1, additive: false });
  });

  it('window blur aborts the drag', () => {
    const h = makeHarness();
    startDrag(h);
    h.blurTarget.fire('blur', {});
    h.target.fire('pointerup', { button: 0, clientX: 50, clientY: 50, shiftKey: false });
    expect(h.intents.filter((i) => i.kind === 'select.box')).toHaveLength(0);
    expect(h.boxes.at(-1)).toBeNull();
  });
});

describe('camera orbit and grab-pan gestures', () => {
  it('middle drag and Alt+left drag emit camera.orbit_px without triggering clicks or boxes', () => {
    const { target, intents, boxes } = makePointer(() => ({ mode: 'build', tool: 'place' }));

    target.fire('pointerdown', {
      button: 1,
      clientX: 100,
      clientY: 100,
      shiftKey: false,
      preventDefault() {},
    });
    target.fire('pointermove', { clientX: 120, clientY: 90, shiftKey: false });
    target.fire('pointerup', { button: 1, clientX: 120, clientY: 90, shiftKey: false });

    target.fire('pointerdown', {
      button: 0,
      clientX: 50,
      clientY: 50,
      shiftKey: false,
      altKey: true,
      preventDefault() {},
    });
    target.fire('pointermove', { clientX: 62, clientY: 58, shiftKey: false, altKey: true });
    target.fire('pointerup', {
      button: 0,
      clientX: 62,
      clientY: 58,
      shiftKey: false,
      altKey: true,
    });

    expect(intents).toEqual([
      { kind: 'camera.orbit_px', dx: 20, dy: -10 },
      { kind: 'camera.orbit_px', dx: 12, dy: 8 },
    ]);
    expect(boxes.filter((b) => b !== null)).toHaveLength(0);
  });

  it('Shift+middle drag and Shift+Alt+left drag emit camera.pan_start and camera.pan_px', () => {
    const { target, intents } = makePointer(() => ({ mode: 'command', tool: 'none' }));

    target.fire('pointerdown', {
      button: 1,
      clientX: 200,
      clientY: 150,
      shiftKey: true,
      preventDefault() {},
    });
    target.fire('pointermove', { clientX: 215, clientY: 165, shiftKey: true });
    target.fire('pointerup', { button: 1, clientX: 215, clientY: 165, shiftKey: true });

    target.fire('pointerdown', {
      button: 0,
      clientX: 10,
      clientY: 20,
      shiftKey: true,
      altKey: true,
      preventDefault() {},
    });
    target.fire('pointermove', { clientX: 18, clientY: 25, shiftKey: true, altKey: true });
    target.fire('pointerup', { button: 0, clientX: 18, clientY: 25, shiftKey: true, altKey: true });

    expect(intents).toEqual([
      { kind: 'camera.pan_start', x: 200, y: 150 },
      { kind: 'camera.pan_px', prevX: 200, prevY: 150, x: 215, y: 165 },
      { kind: 'camera.pan_start', x: 10, y: 20 },
      { kind: 'camera.pan_px', prevX: 10, prevY: 20, x: 18, y: 25 },
    ]);
  });
});
