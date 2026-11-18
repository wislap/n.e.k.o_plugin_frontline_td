import { describe, expect, it } from 'vitest';
import { intentForKey } from './keyboard';
import { DEFAULT_KEYMAP } from './keymap';

function event(
  overrides: Partial<{
    code: string;
    repeat: boolean;
    target: EventTarget | null;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
  }>,
) {
  return { code: 'Space', repeat: false, target: null, ...overrides };
}

describe('intentForKey', () => {
  it('maps bound keys to intents', () => {
    expect(intentForKey(event({ code: 'Space' }), DEFAULT_KEYMAP)).toEqual({
      kind: 'runtime.toggle_pause',
    });
    expect(intentForKey(event({ code: 'Minus' }), DEFAULT_KEYMAP)).toEqual({
      kind: 'runtime.speed_step',
      delta: -1,
    });
    expect(intentForKey(event({ code: 'Equal' }), DEFAULT_KEYMAP)).toEqual({
      kind: 'runtime.speed_step',
      delta: 1,
    });
    expect(intentForKey(event({ code: 'Backquote' }), DEFAULT_KEYMAP)).toEqual({
      kind: 'dev.toggle_panel',
    });
  });

  it('digit keys map to squad intents with the modifier filled in', () => {
    expect(intentForKey(event({ code: 'Digit3' }), DEFAULT_KEYMAP)).toEqual({
      kind: 'squad.digit',
      digit: 3,
      ctrl: false,
    });
    expect(intentForKey(event({ code: 'Digit3', ctrlKey: true }), DEFAULT_KEYMAP)).toEqual({
      kind: 'squad.digit',
      digit: 3,
      ctrl: true,
    });
    expect(intentForKey(event({ code: 'Digit3', metaKey: true }), DEFAULT_KEYMAP)).toEqual({
      kind: 'squad.digit',
      digit: 3,
      ctrl: true,
    });
  });

  it('modified keys only fire modifier-aware intents — Ctrl+X is not demolish', () => {
    expect(intentForKey(event({ code: 'KeyX', ctrlKey: true }), DEFAULT_KEYMAP)).toBeNull();
    expect(intentForKey(event({ code: 'KeyX', metaKey: true }), DEFAULT_KEYMAP)).toBeNull();
    expect(intentForKey(event({ code: 'KeyX', altKey: true }), DEFAULT_KEYMAP)).toBeNull();
    expect(intentForKey(event({ code: 'KeyR', ctrlKey: true }), DEFAULT_KEYMAP)).toBeNull();
    // squad.digit is modifier-aware and still fires (Ctrl/Cmd = control
    // group assign); Alt alone produces the bare squad-select intent.
    expect(intentForKey(event({ code: 'Digit3', ctrlKey: true }), DEFAULT_KEYMAP)).toEqual({
      kind: 'squad.digit',
      digit: 3,
      ctrl: true,
    });
  });

  it('returns null for unbound keys', () => {
    expect(intentForKey(event({ code: 'KeyQ' }), DEFAULT_KEYMAP)).toBeNull();
  });

  it('ignores key repeats', () => {
    expect(intentForKey(event({ repeat: true }), DEFAULT_KEYMAP)).toBeNull();
  });

  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('ignores events from <%s>', (tagName) => {
    const target = { tagName } as unknown as EventTarget;
    expect(intentForKey(event({ target }), DEFAULT_KEYMAP)).toBeNull();
  });

  it('ignores events from contentEditable targets', () => {
    const target = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget;
    expect(intentForKey(event({ target }), DEFAULT_KEYMAP)).toBeNull();
  });
});
