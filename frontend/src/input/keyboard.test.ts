import { describe, expect, it } from 'vitest';
import type { PrimaryMode } from '../client/interaction-store';
import type { Intent } from './intents';
import { installKeyboard, intentForKey } from './keyboard';
import { KEYBINDING_GROUPS } from './keymap';

function event(
  overrides: Partial<{
    code: string;
    key: string;
    repeat: boolean;
    target: EventTarget | null;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  }>,
) {
  return { code: 'Space', repeat: false, target: null, ...overrides };
}

describe('intentForKey', () => {
  it('maps global keys to intents across modes', () => {
    for (const mode of ['command', 'build', 'logistics'] as const) {
      expect(intentForKey(event({ code: 'Space' }), mode)).toEqual({
        kind: 'runtime.toggle_pause',
      });
      expect(intentForKey(event({ code: 'Minus' }), mode)).toEqual({
        kind: 'runtime.speed_step',
        delta: -1,
      });
      expect(intentForKey(event({ code: 'Equal' }), mode)).toEqual({
        kind: 'runtime.speed_step',
        delta: 1,
      });
      expect(intentForKey(event({ code: 'Tab' }), mode)).toEqual({
        kind: 'camera.toggle_mode',
      });
      expect(intentForKey(event({ code: 'Backquote' }), mode)).toEqual({
        kind: 'dev.toggle_panel',
      });
      expect(intentForKey(event({ code: 'KeyL' }), mode)).toEqual({
        kind: 'overlay.toggle_logistics',
      });
      expect(intentForKey(event({ code: 'KeyK' }), mode)).toEqual({
        kind: 'ui.toggle_keymap_help',
      });
      expect(intentForKey(event({ code: 'Escape' }), mode)).toEqual({
        kind: 'escape',
      });
    }
    expect(intentForKey(event({ code: 'F1' }), 'command')).toEqual({
      kind: 'mode.select',
      mode: 'command',
    });
    expect(intentForKey(event({ code: 'F2' }), 'command')).toEqual({
      kind: 'mode.select',
      mode: 'build',
    });
    expect(intentForKey(event({ code: 'F3' }), 'command')).toEqual({
      kind: 'mode.select',
      mode: 'logistics',
    });
    expect(intentForKey(event({ code: 'KeyV' }), 'command')).toBeNull();
  });

  it('maps digits to squad.digit in command mode and build.category_digit in build mode', () => {
    expect(intentForKey(event({ code: 'Digit3' }), 'command')).toEqual({
      kind: 'squad.digit',
      digit: 3,
      ctrl: false,
    });
    expect(intentForKey(event({ code: 'Digit3', ctrlKey: true }), 'command')).toEqual({
      kind: 'squad.digit',
      digit: 3,
      ctrl: true,
    });
    expect(intentForKey(event({ code: 'Digit3', metaKey: true }), 'command')).toEqual({
      kind: 'squad.digit',
      digit: 3,
      ctrl: true,
    });
    // Build mode reserves 1-9 for build categories and ignores digits in logistics mode.
    expect(intentForKey(event({ code: 'Digit3' }), 'build')).toEqual({
      kind: 'build.category_digit',
      slot: 3,
    });
    expect(intentForKey(event({ code: 'Digit3', ctrlKey: true }), 'build')).toBeNull();
    expect(intentForKey(event({ code: 'Digit3' }), 'logistics')).toBeNull();
  });

  it('routes mode-specific keys only in their own primary mode', () => {
    expect(intentForKey(event({ code: 'KeyG' }), 'build')).toEqual({
      kind: 'selection.activate',
    });
    expect(intentForKey(event({ code: 'KeyC' }), 'build')).toEqual({
      kind: 'demolish.press',
    });
    expect(intentForKey(event({ code: 'Delete' }), 'build')).toEqual({
      kind: 'demolish.press',
    });
    expect(intentForKey(event({ code: 'KeyG' }), 'command')).toBeNull();
    expect(intentForKey(event({ code: 'KeyC' }), 'command')).toBeNull();
    expect(intentForKey(event({ code: 'Delete' }), 'logistics')).toBeNull();

    expect(intentForKey(event({ code: 'KeyR' }), 'logistics')).toEqual({
      kind: 'road.toggle',
    });
    expect(intentForKey(event({ code: 'Enter' }), 'logistics')).toEqual({
      kind: 'road.confirm',
    });
    expect(intentForKey(event({ code: 'KeyR' }), 'command')).toBeNull();
    expect(intentForKey(event({ code: 'Enter' }), 'build')).toBeNull();
  });

  it('triggers keymap help on K and ? or Shift+Slash without Ctrl/Meta/Alt', () => {
    expect(intentForKey(event({ code: 'KeyK' }), 'command')).toEqual({
      kind: 'ui.toggle_keymap_help',
    });
    expect(intentForKey(event({ code: 'KeyK', ctrlKey: true }), 'command')).toBeNull();
    expect(intentForKey(event({ code: 'Slash', key: '?' }), 'command')).toEqual({
      kind: 'ui.toggle_keymap_help',
    });
    expect(intentForKey(event({ code: 'Slash', shiftKey: true }), 'build')).toEqual({
      kind: 'ui.toggle_keymap_help',
    });
    expect(intentForKey(event({ code: 'Slash', key: '?', ctrlKey: true }), 'command')).toBeNull();
    expect(
      intentForKey(event({ code: 'Slash', shiftKey: true, altKey: true }), 'command'),
    ).toBeNull();
    expect(intentForKey(event({ code: 'Slash' }), 'command')).toBeNull();
  });

  it('modified keys only fire modifier-aware intents — Ctrl+C is not demolish', () => {
    expect(intentForKey(event({ code: 'KeyC', ctrlKey: true }), 'build')).toBeNull();
    expect(intentForKey(event({ code: 'KeyC', metaKey: true }), 'build')).toBeNull();
    expect(intentForKey(event({ code: 'KeyC', altKey: true }), 'build')).toBeNull();
    expect(intentForKey(event({ code: 'KeyR', ctrlKey: true }), 'logistics')).toBeNull();
  });

  it('returns null for unbound keys and key repeats', () => {
    expect(intentForKey(event({ code: 'KeyQ' }), 'command')).toBeNull();
    expect(intentForKey(event({ repeat: true }), 'command')).toBeNull();
  });

  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('ignores events from <%s>', (tagName) => {
    const target = { tagName } as unknown as EventTarget;
    expect(intentForKey(event({ target }), 'command')).toBeNull();
  });

  it('ignores events from contentEditable targets', () => {
    const target = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget;
    expect(intentForKey(event({ target }), 'command')).toBeNull();
  });
});

describe('installKeyboard', () => {
  it('calls preventDefault on matched intents and tracks live mode', () => {
    const listeners = new Map<string, EventListener>();
    const target = {
      addEventListener(type: string, listener: EventListener) {
        listeners.set(type, listener);
      },
      removeEventListener(type: string) {
        listeners.delete(type);
      },
    };
    let mode: PrimaryMode = 'command';
    const intents: Intent[] = [];
    const uninstall = installKeyboard(
      target,
      () => mode,
      (i) => intents.push(i),
    );

    let prevented = false;
    listeners.get('keydown')?.({
      code: 'Tab',
      repeat: false,
      target: null,
      preventDefault() {
        prevented = true;
      },
    } as unknown as Event);
    expect(prevented).toBe(true);
    expect(intents).toEqual([{ kind: 'camera.toggle_mode' }]);

    mode = 'build';
    prevented = false;
    listeners.get('keydown')?.({
      code: 'Digit2',
      repeat: false,
      target: null,
      preventDefault() {
        prevented = true;
      },
    } as unknown as Event);
    expect(prevented).toBe(true);
    expect(intents.at(-1)).toEqual({ kind: 'build.category_digit', slot: 2 });

    prevented = false;
    listeners.get('keydown')?.({
      code: 'KeyQ',
      repeat: false,
      target: null,
      preventDefault() {
        prevented = true;
      },
    } as unknown as Event);
    expect(prevented).toBe(false);

    uninstall();
    expect(listeners.size).toBe(0);
  });

  it('exports keybinding groups metadata for global and all primary modes', () => {
    const titleKeys = KEYBINDING_GROUPS.map((g) => g.titleKey);
    expect(titleKeys).toEqual([
      'help.group.global',
      'help.group.command',
      'help.group.build',
      'help.group.logistics',
    ]);
    expect(KEYBINDING_GROUPS.map((g) => g.mode)).toEqual([
      undefined,
      'command',
      'build',
      'logistics',
    ]);
    expect(KEYBINDING_GROUPS[0]?.entries.find((e) => e.descKey === 'help.key.help')?.keys).toBe(
      'K',
    );
    for (const group of KEYBINDING_GROUPS) {
      expect(group.entries.length).toBeGreaterThan(0);
    }
  });
});
