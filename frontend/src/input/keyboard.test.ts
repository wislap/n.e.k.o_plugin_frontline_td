import { describe, expect, it } from 'vitest';
import { intentForKey } from './keyboard';
import { DEFAULT_KEYMAP } from './keymap';

function event(overrides: Partial<{ code: string; repeat: boolean; target: EventTarget | null }>) {
  return { code: 'Space', repeat: false, target: null, ...overrides };
}

describe('intentForKey', () => {
  it('maps bound keys to intents', () => {
    expect(intentForKey(event({ code: 'Space' }), DEFAULT_KEYMAP)).toEqual({
      kind: 'runtime.toggle_pause',
    });
    expect(intentForKey(event({ code: 'Digit2' }), DEFAULT_KEYMAP)).toEqual({
      kind: 'runtime.set_speed',
      index: 2,
    });
    expect(intentForKey(event({ code: 'Backquote' }), DEFAULT_KEYMAP)).toEqual({
      kind: 'dev.toggle_panel',
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
