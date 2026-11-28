// Canvas intent coverage (ADR 0062): every kind the old monolithic
// input-dispatch handled must now be handled — by the shell (camera.*)
// or by a registered feature handler. Adding a canvas intent kind
// without a handler fails this test.
import { describe, expect, it } from 'vitest';
import { CANVAS_INTENTS } from './canvas-intents';

const SHELL_CANVAS_KINDS = ['camera.zoom', 'camera.pan_start', 'camera.pan_px'] as const;

const FEATURE_CANVAS_KINDS = [
  'cursor.move',
  'cursor.leave',
  'select.click',
  'select.box',
  'road.click',
  'build.place',
  'demolish.click',
  'command.move_to',
] as const;

describe('canvas intent registry', () => {
  it('registers a handler for every feature-owned canvas intent', () => {
    for (const kind of FEATURE_CANVAS_KINDS) {
      expect(CANVAS_INTENTS.get(kind), `missing canvas intent handler for ${kind}`).toBeDefined();
    }
  });

  it('registers exactly the expected kinds — camera.* stays shell-owned', () => {
    expect([...CANVAS_INTENTS.keys()].sort()).toEqual([...FEATURE_CANVAS_KINDS].sort());
    for (const kind of SHELL_CANVAS_KINDS) {
      expect(CANVAS_INTENTS.has(kind)).toBe(false);
    }
  });
});
