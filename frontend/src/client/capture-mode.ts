// Capture mode (?capture=<preset>): deterministic screenshot support for
// tooling/shots.ts. Active only when the query param names a preset; the
// module is inert otherwise and every consumer branches through these
// exports (never re-parses location.search).
//
// Determinism comes from four pins:
// - fixed match seed (main.tsx reads it instead of Date.now()),
// - renderNowMs() frozen at CAPTURE_TIME_MS, so every animation, pulse
//   and interpolation phase renders the same value,
// - the sim paused at the first snapshot (set_speed 0), and the client
//   keeps that first snapshot pinned — later frames are ignored, so the
//   rendered tick can never drift between runs,
// - a named camera preset applied before the first frame (main.tsx), so
//   the pose is exact with no transition in flight.
type CapturePreset = 'open' | 'near' | 'far' | 'build' | 'tactical';

export interface CaptureSpec {
  readonly preset: CapturePreset;
  readonly seed: number;
  readonly cameraMode: 'spectate' | 'tactical';
  readonly interactionMode: 'command' | 'build' | 'logistics';
  readonly center: 'start' | 'map';
  // Spectate zoom (world distance); null = keep the resolved default.
  readonly zoom: number | null;
}

const CAPTURE_SEED = 0x5eedca7;
const CAPTURE_TIME_MS = 60_000;
const CAPTURE_NEAR_DIST = 12;
const CAPTURE_FAR_DIST = 80;

const PRESETS: Record<CapturePreset, Omit<CaptureSpec, 'preset' | 'seed'>> = {
  open: { cameraMode: 'spectate', interactionMode: 'command', center: 'start', zoom: null },
  near: {
    cameraMode: 'spectate',
    interactionMode: 'command',
    center: 'start',
    zoom: CAPTURE_NEAR_DIST,
  },
  far: {
    cameraMode: 'spectate',
    interactionMode: 'command',
    center: 'map',
    zoom: CAPTURE_FAR_DIST,
  },
  build: { cameraMode: 'tactical', interactionMode: 'build', center: 'start', zoom: null },
  tactical: {
    cameraMode: 'tactical',
    interactionMode: 'command',
    center: 'start',
    zoom: null,
  },
};

function parseCapture(search: string): CaptureSpec | null {
  const raw = new URLSearchParams(search).get('capture');
  if (raw === null || !(raw in PRESETS)) {
    return null;
  }
  const preset = raw as CapturePreset;
  return { preset, seed: CAPTURE_SEED, ...PRESETS[preset] };
}

const spec = parseCapture(typeof location === 'undefined' ? '' : location.search);

export function getCapture(): CaptureSpec | null {
  return spec;
}

export function isCaptureMode(): boolean {
  return spec !== null;
}

// Visual animation clock: every pulse/wind/interp site on the render
// path reads this instead of performance.now so frames always draw the
// same time-driven phase. The real performance.now must stay untouched —
// R3F's frame clock depends on it, and freezing it stalls the loop on a
// partially-built scene.
export function renderNowMs(): number {
  return spec !== null ? CAPTURE_TIME_MS : performance.now();
}
