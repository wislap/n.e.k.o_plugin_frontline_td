// Camera math (M2 C4): mode constants, clamps, and the perspective ↔
// orthographic matching used so mode transitions have no visible jump.
// All pure and unit-tested.

export const SPECTATE_FOV_DEG = 45;
export const SPECTATE_PITCH_DEG = 50;
export const SPECTATE_MIN_PITCH_DEG = 26;
export const SPECTATE_MAX_PITCH_DEG = 86;
export const SPECTATE_DEFAULT_DIST = 26;
export const SPECTATE_MIN_DIST = 8;
export const SPECTATE_MAX_DIST = 80;
export const SPECTATE_TERRAIN_FOLLOW_START_DIST = 22;
export const SPECTATE_TERRAIN_FOLLOW_FULL_DIST = 11;
export const TACTICAL_MIN_HEIGHT = 10;
export const TACTICAL_MAX_HEIGHT = 120;
export const TRANSITION_MS = 400;
export const TRANSITION_MIN_FOV_DEG = 1.2;

export function clampSpectateDist(dist: number): number {
  return Math.min(SPECTATE_MAX_DIST, Math.max(SPECTATE_MIN_DIST, dist));
}

export function clampSpectatePitch(pitchDeg: number): number {
  return Math.min(SPECTATE_MAX_PITCH_DEG, Math.max(SPECTATE_MIN_PITCH_DEG, pitchDeg));
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

// Smart dolly-pitch curve: close inspection leans forward (34° at dist 8),
// default distance sits at 55°, and overview zoom lifts toward 72°.
export function baseSpectatePitchDeg(dist: number): number {
  const d = clampSpectateDist(dist);
  if (d <= SPECTATE_DEFAULT_DIST) {
    const t = (d - SPECTATE_MIN_DIST) / (SPECTATE_DEFAULT_DIST - SPECTATE_MIN_DIST);
    return 34 + (SPECTATE_PITCH_DEG - 34) * easeInOut(t);
  }
  const t = (d - SPECTATE_DEFAULT_DIST) / (SPECTATE_MAX_DIST - SPECTATE_DEFAULT_DIST);
  return SPECTATE_PITCH_DEG + (72 - SPECTATE_PITCH_DEG) * easeInOut(t);
}

export function effectiveSpectatePitchDeg(dist: number, pitchOffsetDeg: number = 0): number {
  return clampSpectatePitch(baseSpectatePitchDeg(dist) + pitchOffsetDeg);
}

export function clampPitchOffsetForDist(dist: number, pitchOffsetDeg: number): number {
  return effectiveSpectatePitchDeg(dist, pitchOffsetDeg) - baseSpectatePitchDeg(dist);
}

// Normalize `yaw` to the nearest equivalent North (`2πk`) so resets rotate
// smoothly through at most 180° without unwinding multiple turns.
export function nearestNorthYaw(yaw: number): number {
  const twoPi = Math.PI * 2;
  const snapped = Math.round(yaw / twoPi) * twoPi;
  return snapped === 0 ? 0 : snapped;
}

// Quantized integer compass heading in `(-180, 180]` degrees (`0` at any `2πk` North).
export function compassHeadingDeg(yaw: number): number {
  let deg = Math.round((yaw * 180) / Math.PI) % 360;
  if (deg > 180) {
    deg -= 360;
  }
  if (deg <= -180) {
    deg += 360;
  }
  return deg === 0 ? 0 : deg;
}

// Rotate a screen-space pan direction (`+x` right, `+y` down/south) into
// map space (`+x` east, `+y` south) for the current horizontal camera `yaw`.
export function rotatePanVector(
  pan: { x: number; y: number },
  yaw: number,
): { x: number; y: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    x: pan.x * c - pan.y * s,
    y: pan.x * s + pan.y * c,
  };
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
// and mode-swap viewport extent parity.
export function visibleGroundHeight(
  mode: 'spectate' | 'tactical',
  zoom: number,
  pitchOffsetDeg: number = 0,
): number {
  if (mode === 'tactical') {
    return clampTacticalHeight(zoom);
  }
  const dist = clampSpectateDist(zoom);
  const pitch = (effectiveSpectatePitchDeg(dist, pitchOffsetDeg) * Math.PI) / 180;
  return orthoHeightForPerspectiveDist(dist) / Math.sin(pitch);
}

// Zoom value to store for the OTHER mode so the swap preserves the visible
// ground extent (no visible jump, tested as a pure function).
export function matchZoomForMode(
  mode: 'spectate' | 'tactical',
  zoom: number,
  pitchOffsetDeg: number = 0,
): number {
  if (mode === 'tactical') {
    // spectate → tactical
    return clampTacticalHeight(visibleGroundHeight('spectate', zoom, pitchOffsetDeg));
  }
  // tactical → spectate: solve visibleGroundHeight('spectate', d, pitchOffsetDeg)
  // = target height via bisection (monotonically increasing over [min, max]).
  const target = clampTacticalHeight(zoom);
  let lo = SPECTATE_MIN_DIST;
  let hi = SPECTATE_MAX_DIST;
  if (target <= visibleGroundHeight('spectate', lo, pitchOffsetDeg)) {
    return lo;
  }
  if (target >= visibleGroundHeight('spectate', hi, pitchOffsetDeg)) {
    return hi;
  }
  for (let i = 0; i < 36; i++) {
    const mid = (lo + hi) * 0.5;
    if (visibleGroundHeight('spectate', mid, pitchOffsetDeg) < target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) * 0.5;
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

// Option B focus elevation: locked to constant map `baseY` at mid/far
// distances (`dist >= 22`) so WASD/drag panning never bobs with terrain,
// and smoothly blended into `localSmoothY` when zoomed close in (`<= 11`).
export function spectateFocusElevation(dist: number, baseY: number, localSmoothY: number): number {
  if (dist >= SPECTATE_TERRAIN_FOLLOW_START_DIST) {
    return baseY;
  }
  if (dist <= SPECTATE_TERRAIN_FOLLOW_FULL_DIST) {
    return localSmoothY;
  }
  const t =
    (SPECTATE_TERRAIN_FOLLOW_START_DIST - dist) /
    (SPECTATE_TERRAIN_FOLLOW_START_DIST - SPECTATE_TERRAIN_FOLLOW_FULL_DIST);
  return baseY + (localSmoothY - baseY) * easeInOut(t);
}

// Interpolates vertical FOV during Dolly-Zoom mode transitions by linearly
// blending tan(fov/2) so apparent perspective convergence transitions smoothly.
export function dollyZoomFovDeg(
  blend: number,
  spectateFovDeg: number = SPECTATE_FOV_DEG,
  minFovDeg: number = TRANSITION_MIN_FOV_DEG,
): number {
  const u = Math.max(0, Math.min(1, blend));
  const tan0 = halfFovTan(spectateFovDeg);
  const tan1 = halfFovTan(minFovDeg);
  const tanHalf = tan0 + (tan1 - tan0) * u;
  return (Math.atan(tanHalf) * 360) / Math.PI;
}

// Both cameras use map north (-Z) as their `up` reference. For the
// perspective camera that vector is never parallel to the view direction
// at pitch in (0°, 90°], so lookAt stays well defined through the whole
// transition — unlike (0,1,0), which is degenerate exactly at 90°.
const CAMERA_UP = { x: 0, y: 0, z: -1 } as const;

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

function perspectiveClipPlanesWithMaxNear(
  dist: number,
  mapWidth: number,
  mapHeight: number,
  maxNear: number,
): { near: number; far: number } {
  const safeDist = Math.max(SPECTATE_MIN_DIST, dist);
  const near = Math.max(0.8, Math.min(maxNear, safeDist * 0.12));
  const diag = Math.hypot(Math.max(1, mapWidth), Math.max(1, mapHeight));
  const far = Math.max(500, safeDist + diag + 120);
  return { near, far };
}

// Dynamic depth clip planes for the perspective camera (ADR 0051): tightens
// near with view distance to preserve 24-bit depth buffer precision while
// expanding far to cover large maps.
export function perspectiveClipPlanes(
  dist: number,
  mapWidth: number,
  mapHeight: number,
): { near: number; far: number } {
  return perspectiveClipPlanesWithMaxNear(dist, mapWidth, mapHeight, 8);
}

// Transition clip planes cap near at 200 (below the DOME_RADIUS = 380 sky
// dome) so telephoto Dolly-Zoom distances keep high depth precision.
export function perspectiveTransitionClipPlanes(
  dist: number,
  mapWidth: number,
  mapHeight: number,
): { near: number; far: number } {
  return perspectiveClipPlanesWithMaxNear(dist, mapWidth, mapHeight, 200);
}

// Dynamic depth clip planes for the top-down orthographic camera (ADR 0051).
export function orthoClipPlanes(cameraY: number): { near: number; far: number } {
  return { near: 1, far: Math.max(300, cameraY + 80) };
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface OrbitalCameraPose {
  position: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  // Euler angles in Three.js 'YXZ' order (x = -pitchRad, y = -yawRad, z = 0).
  eulerYXZ: Vec3;
}

// Singularity-free 3D orbital camera pose for any `yaw` (0 = facing map north
// -Z, +yaw turns clockwise toward east +X) and `pitchDeg` in (0°, 90°].
export function orbitalCameraPose(
  center: { x: number; y: number },
  centerY: number,
  dist: number,
  yaw: number,
  pitchDeg: number,
): OrbitalCameraPose {
  const pitch = (pitchDeg * Math.PI) / 180;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);

  const forward: Vec3 = { x: cp * sy, y: -sp, z: -cp * cy };
  const right: Vec3 = { x: cy, y: 0, z: sy };
  const up: Vec3 = { x: sp * sy, y: cp, z: -sp * cy };
  const position: Vec3 = {
    x: center.x - dist * forward.x,
    y: centerY + dist * sp,
    z: center.y - dist * forward.z,
  };
  return {
    position,
    forward,
    right,
    up,
    eulerYXZ: { x: -pitch, y: -yaw, z: 0 },
  };
}

// Exact intersection of a 3D ray with a horizontal ground plane Y = planeY,
// rejecting near-horizon rays whose normalized downward slope < minDownSlope.
export function intersectHorizontalPlane(
  ray: { origin: Vec3; dir: Vec3 },
  planeY: number,
  minDownSlope: number = 0.08,
): { x: number; y: number } | null {
  const len = Math.hypot(ray.dir.x, ray.dir.y, ray.dir.z);
  if (len <= 0) {
    return null;
  }
  const dy = ray.dir.y / len;
  if (dy > -minDownSlope) {
    return null;
  }
  const t = (planeY - ray.origin.y) / ray.dir.y;
  if (t < 0 || !Number.isFinite(t)) {
    return null;
  }
  return {
    x: ray.origin.x + ray.dir.x * t,
    y: ray.origin.z + ray.dir.z * t,
  };
}

// Ground-plane offset `(hit.x - center.x, hit.z - center.y)` for a spectate
// camera ray at NDC `(ndcX, ndcY)`. Used for exact cursor-anchored zoom and
// rotated trapezoid minimap frustum corners.
export function spectateCursorGroundOffset(
  ndcX: number,
  ndcY: number,
  aspect: number,
  dist: number,
  yaw: number,
  pitchDeg: number,
  centerY: number,
  planeY: number,
  minDownSlope: number = 0.08,
): { x: number; y: number } | null {
  const pose = orbitalCameraPose({ x: 0, y: 0 }, centerY, dist, yaw, pitchDeg);
  const th = halfFovTan(SPECTATE_FOV_DEG);
  const tw = th * aspect;
  const dir: Vec3 = {
    x: pose.forward.x + ndcX * tw * pose.right.x + ndcY * th * pose.up.x,
    y: pose.forward.y + ndcY * th * pose.up.y,
    z: pose.forward.z + ndcX * tw * pose.right.z + ndcY * th * pose.up.z,
  };
  return intersectHorizontalPlane({ origin: pose.position, dir }, planeY, minDownSlope);
}

// Frame-rate-independent exponential damping factor for time constant `tauSec`.
export function frameDampingAlpha(dtSec: number, tauSec: number): number {
  const dt = Math.max(0, Math.min(0.1, dtSec));
  if (tauSec <= 0) {
    return 1;
  }
  return 1 - Math.exp(-dt / tauSec);
}
