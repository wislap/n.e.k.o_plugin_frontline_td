import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  displayState,
  exitDisplayMode,
  onDisplayStateChange,
  requestDisplayMode,
  type DisplayResult,
} from './display';

const STATE = {
  mode: 'normal' as const,
  supportedModes: ['fullscreen' as const, 'focus' as const],
};

function installSdk(result?: DisplayResult): {
  requestMode: ReturnType<typeof vi.fn>;
  exit: ReturnType<typeof vi.fn>;
} {
  const sdk = {
    requestMode: vi.fn(() => Promise.resolve(result ?? { status: 'applied', state: STATE })),
    exit: vi.fn(() => Promise.resolve(result ?? { status: 'applied', state: STATE })),
    getState: () => STATE,
    onStateChange: () => () => undefined,
  };
  (globalThis as { window?: unknown }).window = { NekoPluginDisplay: sdk };
  return { requestMode: sdk.requestMode, exit: sdk.exit };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('host/display', () => {
  test('degrades to unsupported without the SDK global', async () => {
    expect(displayState().supportedModes).toEqual([]);
    expect((await requestDisplayMode('fullscreen')).status).toBe('unsupported');
    expect((await exitDisplayMode()).status).toBe('unsupported');
    const off = onDisplayStateChange(() => undefined);
    off();
  });

  test('forwards calls to the SDK', async () => {
    const sdk = installSdk();
    expect(displayState().mode).toBe('normal');
    await requestDisplayMode('fullscreen');
    expect(sdk.requestMode).toHaveBeenCalledWith('fullscreen');
    await exitDisplayMode();
    expect(sdk.exit).toHaveBeenCalled();
  });
});
