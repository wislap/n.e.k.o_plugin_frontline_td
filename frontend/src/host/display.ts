// NEKO static-panel display SDK wrapper (M3 E5). The host injects
// `window.NekoPluginDisplay` via <script src="/plugin-ui-sdk/display.js">;
// under plain Vite dev that script 404s and everything here degrades to
// 'unsupported'. Typed locally — no SDK package dependency.

export type DisplayMode = 'fullscreen' | 'focus';
type DisplayStatus = 'applied' | 'declined' | 'unsupported' | 'cancelled' | 'busy' | 'failed';

export interface DisplayState {
  mode: 'normal' | 'fullscreen' | 'focus';
  supportedModes: DisplayMode[];
}

export interface DisplayResult {
  status: DisplayStatus;
  state: DisplayState;
  reason?: string;
}

interface NekoPluginDisplay {
  requestMode(mode: DisplayMode): Promise<DisplayResult>;
  exit(): Promise<DisplayResult>;
  getState(): DisplayState;
  onStateChange(listener: (state: DisplayState) => void): () => void;
}

declare global {
  interface Window {
    NekoPluginDisplay?: NekoPluginDisplay;
  }
}

const UNSUPPORTED: DisplayState = { mode: 'normal', supportedModes: [] };

function sdk(): NekoPluginDisplay | undefined {
  return typeof window === 'undefined' ? undefined : window.NekoPluginDisplay;
}

export function displayState(): DisplayState {
  return sdk()?.getState() ?? UNSUPPORTED;
}

export async function requestDisplayMode(mode: DisplayMode): Promise<DisplayResult> {
  const api = sdk();
  if (api === undefined) {
    return { status: 'unsupported', state: UNSUPPORTED };
  }
  return api.requestMode(mode);
}

export async function exitDisplayMode(): Promise<DisplayResult> {
  const api = sdk();
  if (api === undefined) {
    return { status: 'unsupported', state: UNSUPPORTED };
  }
  return api.exit();
}

export function onDisplayStateChange(listener: (state: DisplayState) => void): () => void {
  const api = sdk();
  if (api === undefined) {
    return () => undefined;
  }
  return api.onStateChange(listener);
}
