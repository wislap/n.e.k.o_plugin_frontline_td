// Camera math (M2 C4): mode constants, clamps, and the perspective ↔
// orthographic matching used so mode transitions have no visible jump.
// All pure and unit-tested.

export const SPECTATE_FOV_DEG = 45;
export const SPECTATE_PITCH_DEG = 55;
export const SPECTATE_MIN_DIST = 8;
export const SPECTATE_MAX_DIST = 80;
export const TACTICAL_MIN_HEIGHT = 10;
export const TACTICAL_MAX_HEIGHT = 120;
export const TRANSITION_MS = 400;

export function clampSpectateDist(dist: number): number {
  return Math.min(SPECTATE_MAX_DIST, Math.max(SPECTATE_MIN_DIST, dist));
}

export function clampTacticalHeight(height: number): number {
  return Math.min(TACTICAL_MAX_HEIGHT, Math.max(TACTICAL_MIN_HEIGHT, height));
}

export function clampCenter(
  center: { x: number; y: number },
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } {
  return {
    x: Math.min(mapWidth, Math.max(0, center.x)),
    y: Math.min(mapHeight, Math.max(0, center.y)),
  };
}

function halfFovTan(fovDeg: number): number {
  return Math.tan((fovDeg * Math.PI) / 360);
}

// A perspective camera looking straight down from distance `dist` sees a
// ground span of `2 * dist * tan(fov/2)` vertically.
export function orthoHeightForPerspectiveDist(
  dist: number,
  fovDeg: number = SPECTATE_FOV_DEG,
): number {
  return 2 * dist * halfFovTan(fovDeg);
}

export function perspectiveDistForOrthoHeight(
  visibleHeight: number,
  fovDeg: number = SPECTATE_FOV_DEG,
): number {
  return visibleHeight / (2 * halfFovTan(fovDeg));
}

// Ground span visible vertically in the current mode — used for pan speed
// and middle-drag ground anchoring.
export function visibleGroundHeight(mode: 'spectate' | 'tactical', zoom: number): number {
  if (mode === 'tactical') {
    return clampTacticalHeight(zoom);
  }
  const dist = clampSpectateDist(zoom);
  const pitch = (SPECTATE_PITCH_DEG * Math.PI) / 180;
  return orthoHeightForPerspectiveDist(dist) / Math.sin(pitch);
}

// Zoom value to store for the OTHER mode so the swap preserves the visible
// ground extent (no visible jump, tested as a pure function).
export function matchZoomForMode(mode: 'spectate' | 'tactical', zoom: number): number {
  if (mode === 'tactical') {
    // spectate → tactical
    return clampTacticalHeight(visibleGroundHeight('spectate', zoom));
  }
  // tactical → spectate: the perspective camera ends the transition at
  // pitch 55° showing the ortho's ground height.
  const height = clampTacticalHeight(zoom);
  const pitch = (SPECTATE_PITCH_DEG * Math.PI) / 180;
  return clampSpectateDist(perspectiveDistForOrthoHeight(height) * Math.sin(pitch));
}

// During a mode transition the perspective camera keeps the same vertical
// ground extent while its pitch changes: dist(pitch) = extent * sin(pitch)
// / (2 tan(fov/2)). At pitch 90° this equals perspectiveDistForOrthoHeight.
export function perspectiveDistAtPitch(
  visibleHeight: number,
  pitchDeg: number,
  fovDeg: number = SPECTATE_FOV_DEG,
): number {
  const pitch = (pitchDeg * Math.PI) / 180;
  return (visibleHeight * Math.sin(pitch)) / (2 * halfFovTan(fovDeg));
}

// Spectate camera position: `pitch` degrees above the ground plane, south
// of the center (looking north, screen-up = scene -Z).
export function spectateCameraPosition(
  center: { x: number; y: number },
  dist: number,
  pitchDeg: number,
): { x: number; y: number; z: number } {
  const pitch = (pitchDeg * Math.PI) / 180;
  return {
    x: center.x,
    y: dist * Math.sin(pitch),
    z: center.y + dist * Math.cos(pitch),
  };
}

// Ease-in-out used by the 400 ms mode transition.
export function easeInOut(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

// Both cameras use map north (-Z) as their `up` reference. For the
// perspective camera that vector is never parallel to the view direction
// at pitch in (0°, 90°], so lookAt stays well defined through the whole
// transition — unlike (0,1,0), which is degenerate exactly at 90°.
export const CAMERA_UP = { x: 0, y: 0, z: -1 } as const;

// The on-screen "up" direction: `up` projected perpendicular to the view
// direction. Pure; tested at 55° / 89.9° / 90° pitch.
export function screenUpDir(
  viewDir: { x: number; y: number; z: number },
  up: { x: number; y: number; z: number } = CAMERA_UP,
): { x: number; y: number; z: number } {
  const fLen = Math.hypot(viewDir.x, viewDir.y, viewDir.z);
  const fx = viewDir.x / fLen;
  const fy = viewDir.y / fLen;
  const fz = viewDir.z / fLen;
  const dot = up.x * fx + up.y * fy + up.z * fz;
  const ux = up.x - dot * fx;
  const uy = up.y - dot * fy;
  const uz = up.z - dot * fz;
  const uLen = Math.hypot(ux, uy, uz);
  return { x: ux / uLen, y: uy / uLen, z: uz / uLen };
}

// Forward view direction of the spectate/transition camera at a pitch.
export function spectateViewDir(pitchDeg: number): { x: number; y: number; z: number } {
  const pitch = (pitchDeg * Math.PI) / 180;
  return { x: 0, y: -Math.sin(pitch), z: -Math.cos(pitch) };
}
