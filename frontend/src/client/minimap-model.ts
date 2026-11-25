// Pure, DOM-free minimap projection and viewport bounds math.
// Feature-owned compositing and entity collection moved to
// features/*/ui (ADR 0062 step 4a).
import {
  SPECTATE_FOV_DEG,
  SPECTATE_MIN_PITCH_DEG,
  clampSpectateDist,
  clampTacticalHeight,
  effectiveSpectatePitchDeg,
  orthoHeightForPerspectiveDist,
  rotatePanVector,
  visibleGroundHeight,
} from './camera-math';

export function canvasToMap(
  px: number,
  py: number,
  canvasW: number,
  canvasH: number,
  mapW: number,
  mapH: number,
): { x: number; y: number } {
  const safeMapW = Number.isFinite(mapW) && mapW > 0 ? mapW : 0;
  const safeMapH = Number.isFinite(mapH) && mapH > 0 ? mapH : 0;
  const maxMapX = Math.max(0, safeMapW - 1e-4);
  const maxMapY = Math.max(0, safeMapH - 1e-4);
  const rawX =
    safeMapW > 0 && Number.isFinite(canvasW) && canvasW > 0 && Number.isFinite(px)
      ? (px / canvasW) * safeMapW
      : 0;
  const rawY =
    safeMapH > 0 && Number.isFinite(canvasH) && canvasH > 0 && Number.isFinite(py)
      ? (py / canvasH) * safeMapH
      : 0;
  return {
    x: Math.min(maxMapX, Math.max(0, rawX)),
    y: Math.min(maxMapY, Math.max(0, rawY)),
  };
}

export function mapToCanvas(
  mx: number,
  my: number,
  canvasW: number,
  canvasH: number,
  mapW: number,
  mapH: number,
): { x: number; y: number } {
  const x =
    Number.isFinite(mapW) &&
    mapW > 0 &&
    Number.isFinite(canvasW) &&
    canvasW > 0 &&
    Number.isFinite(mx)
      ? (mx / mapW) * canvasW
      : 0;
  const y =
    Number.isFinite(mapH) &&
    mapH > 0 &&
    Number.isFinite(canvasH) &&
    canvasH > 0 &&
    Number.isFinite(my)
      ? (my / mapH) * canvasH
      : 0;
  return { x, y };
}

export function computeMinimapViewport(
  cameraMode: 'spectate' | 'tactical',
  center: { x: number; y: number },
  zoom: number,
  viewportAspect: number,
): { x: number; y: number; w: number; h: number } {
  const safeAspect =
    Number.isFinite(viewportAspect) && viewportAspect > 0 ? viewportAspect : 16 / 9;
  const h = visibleGroundHeight(cameraMode, zoom);
  const w =
    (cameraMode === 'tactical' ? h : orthoHeightForPerspectiveDist(clampSpectateDist(zoom))) *
    safeAspect;
  return {
    x: center.x - w / 2,
    y: center.y - h / 2,
    w,
    h,
  };
}

interface MinimapPoint {
  x: number;
  y: number;
}

const MIN_FRUSTUM_PITCH_DEG = 48;

function rotateQuadToCenter(
  localCorners: readonly [MinimapPoint, MinimapPoint, MinimapPoint, MinimapPoint],
  center: { x: number; y: number },
  yaw: number,
): readonly [MinimapPoint, MinimapPoint, MinimapPoint, MinimapPoint] {
  const [p0, p1, p2, p3] = localCorners.map((pt) => {
    const r = rotatePanVector(pt, yaw);
    return { x: center.x + r.x, y: center.y + r.y };
  }) as [MinimapPoint, MinimapPoint, MinimapPoint, MinimapPoint];
  return [p0, p1, p2, p3];
}

// Compute the 4 ground-plane frustum corners [nearLeft, nearRight, farRight,
// farLeft] in map coordinates for both rotated 2D tactical boxes and tilted 3D
// spectate trapezoids (bounded away from the horizon so low pitch stays legible).
export function computeMinimapFrustumQuad(
  cameraMode: 'spectate' | 'tactical',
  center: { x: number; y: number },
  zoom: number,
  yaw: number,
  pitchOffsetDeg: number,
  viewportAspect: number,
): readonly [MinimapPoint, MinimapPoint, MinimapPoint, MinimapPoint] {
  const safeAspect =
    Number.isFinite(viewportAspect) && viewportAspect > 0 ? viewportAspect : 16 / 9;

  if (cameraMode === 'tactical') {
    const h = clampTacticalHeight(zoom);
    const w = h * safeAspect;
    const hw = w * 0.5;
    const hh = h * 0.5;
    return rotateQuadToCenter(
      [
        { x: -hw, y: hh },
        { x: hw, y: hh },
        { x: hw, y: -hh },
        { x: -hw, y: -hh },
      ],
      center,
      yaw,
    );
  }

  const dist = clampSpectateDist(zoom);
  const rawPitchDeg = effectiveSpectatePitchDeg(dist, pitchOffsetDeg);
  const pitchT = (rawPitchDeg - SPECTATE_MIN_PITCH_DEG) / (90 - SPECTATE_MIN_PITCH_DEG);
  const frustumPitchDeg =
    MIN_FRUSTUM_PITCH_DEG + (90 - MIN_FRUSTUM_PITCH_DEG) * Math.min(1, Math.max(0, pitchT));
  const pitch = (frustumPitchDeg * Math.PI) / 180;
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const th = Math.tan((SPECTATE_FOV_DEG * Math.PI) / 360);
  const tw = th * safeAspect;
  const denomNear = sp + th * cp;
  const denomFar = sp - th * cp;
  const yNear = (dist * th) / denomNear;
  const yFar = -(dist * th) / denomFar;
  const halfWNear = (dist * tw * sp) / denomNear;
  const halfWFar = (dist * tw * sp) / denomFar;
  return rotateQuadToCenter(
    [
      { x: -halfWNear, y: yNear },
      { x: halfWNear, y: yNear },
      { x: halfWFar, y: yFar },
      { x: -halfWFar, y: yFar },
    ],
    center,
    yaw,
  );
}

type ClipEdge = 'left' | 'right' | 'top' | 'bottom';

function clipPolygonAgainstEdge(
  pts: readonly { x: number; y: number }[],
  edge: ClipEdge,
  bound: number,
): { x: number; y: number }[] {
  if (pts.length === 0) {
    return [];
  }
  const inside = (p: { x: number; y: number }): boolean => {
    switch (edge) {
      case 'left':
        return p.x >= bound;
      case 'right':
        return p.x <= bound;
      case 'top':
        return p.y >= bound;
      case 'bottom':
        return p.y <= bound;
    }
  };
  const intersect = (
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): { x: number; y: number } => {
    if (edge === 'left' || edge === 'right') {
      const dx = b.x - a.x;
      const t = dx === 0 ? 0 : (bound - a.x) / dx;
      return { x: bound, y: a.y + (b.y - a.y) * t };
    }
    const dy = b.y - a.y;
    const t = dy === 0 ? 0 : (bound - a.y) / dy;
    return { x: a.x + (b.x - a.x) * t, y: bound };
  };

  const out: { x: number; y: number }[] = [];
  let prev = pts[pts.length - 1];
  if (prev === undefined) {
    return out;
  }
  let prevIn = inside(prev);
  for (const curr of pts) {
    const currIn = inside(curr);
    if (currIn) {
      if (!prevIn) {
        out.push(intersect(prev, curr));
      }
      out.push(curr);
    } else if (prevIn) {
      out.push(intersect(prev, curr));
    }
    prev = curr;
    prevIn = currIn;
  }
  return out;
}

// Clip a convex polygon against an axis-aligned rectangle `[minX, maxX] x [minY, maxY]`
// via Sutherland-Hodgman clipping so minimap frustum borders stay closed at map edges.
export function clipPolygonToRect(
  polygon: readonly { x: number; y: number }[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): { x: number; y: number }[] {
  let pts: { x: number; y: number }[] = polygon.map((p) => ({ x: p.x, y: p.y }));
  pts = clipPolygonAgainstEdge(pts, 'left', minX);
  pts = clipPolygonAgainstEdge(pts, 'right', maxX);
  pts = clipPolygonAgainstEdge(pts, 'top', minY);
  pts = clipPolygonAgainstEdge(pts, 'bottom', maxY);
  return pts;
}
