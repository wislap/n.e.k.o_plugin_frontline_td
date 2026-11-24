// Pure, DOM-free minimap projection, terrain compositing, entity
// collection, and viewport bounds math. Strictly preserves fog of war:
// unexplored cells never touch base terrain or road layers.
import { readChannel, readLayer } from '../core/index';
import type { Snapshot } from '../core/index';
import type { ContentDb, ResolvedMap } from '../content/index';
import { CapturePointsChannel } from '../features/capture/protocol';
import { STATE_BLUEPRINT, STATE_RUIN, StructuresChannel } from '../features/construction/protocol';
import { SquadsChannel } from '../features/squads/protocol';
import { TERRAIN_HEIGHT_LAYER_ID, TERRAIN_SURFACE_LAYER_ID } from '../features/terrain/protocol';
import { DenseUnitsChannel } from '../features/units/protocol';
import { VisionMemoryChannel } from '../features/vision/protocol';
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

const FOG_R = 6;
const FOG_G = 10;
const FOG_B = 18;

const ROAD_R = 150;
const ROAD_G = 166;
const ROAD_B = 188;

const DEFAULT_SURFACE_RGB: readonly [number, number, number] = [64, 72, 84];

interface MinimapMemoryEntity {
  x: number;
  y: number;
  w: number;
  h: number;
  disposition: 'own' | 'hostile' | 'ally' | 'neutral';
}

interface MinimapStructureEntity {
  x: number;
  y: number;
  w: number;
  h: number;
  disposition: 'own' | 'hostile' | 'ally' | 'ruin';
  isCore: boolean;
  isBlueprint: boolean;
  contested: boolean;
  captureLeaderDisposition: 'none' | 'own' | 'hostile';
}

interface MinimapUnitEntity {
  x: number;
  y: number;
  disposition: 'own' | 'hostile' | 'ally';
  selected: boolean;
}

interface MinimapThreatSquad {
  kind: 'gather' | 'advance';
  gatherX: number;
  gatherY: number;
  route: readonly number[];
}

export interface MinimapSceneEntities {
  memories: MinimapMemoryEntity[];
  structures: MinimapStructureEntity[];
  units: MinimapUnitEntity[];
  threats: MinimapThreatSquad[];
}

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

function parseHexRgb(hex: string | undefined): readonly [number, number, number] {
  if (hex === undefined || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return DEFAULT_SURFACE_RGB;
  }
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function clampByte(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

export function buildBaseTerrainRgb(
  db: ContentDb,
  map: ResolvedMap,
  snapshot?: Snapshot | null,
): Uint8Array {
  const { width, height } = map;
  const cellCount = width * height;
  const out = new Uint8Array(cellCount * 3);
  const surfaces = readLayer(snapshot, TERRAIN_SURFACE_LAYER_ID) ?? map.grid.surfaces;
  const heights = readLayer(snapshot, TERRAIN_HEIGHT_LAYER_ID) ?? map.grid.heights;
  const ramps = map.grid.ramps;

  const palette = new Map<number, readonly [number, number, number]>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const sIdx = surfaces[idx] ?? 0;
      let rgb = palette.get(sIdx);
      if (rgb === undefined) {
        rgb = parseHexRgb(db.surfaces.byIndex(sIdx)?.color);
        palette.set(sIdx, rgb);
      }

      const h = heights[idx] ?? 0;
      const boost = h * 14;
      let r = clampByte(rgb[0] + boost);
      let g = clampByte(rgb[1] + boost);
      let b = clampByte(rgb[2] + boost);

      const isRamp = (ramps[idx] ?? 0) !== 0;
      if (!isRamp) {
        const hasCliffEdge =
          (x > 0 && (ramps[idx - 1] ?? 0) === 0 && (heights[idx - 1] ?? 0) !== h) ||
          (x + 1 < width && (ramps[idx + 1] ?? 0) === 0 && (heights[idx + 1] ?? 0) !== h) ||
          (y > 0 && (ramps[idx - width] ?? 0) === 0 && (heights[idx - width] ?? 0) !== h) ||
          (y + 1 < height && (ramps[idx + width] ?? 0) === 0 && (heights[idx + width] ?? 0) !== h);
        if (hasCliffEdge) {
          r = clampByte(r * 0.72);
          g = clampByte(g * 0.72);
          b = clampByte(b * 0.72);
        }
      }

      const o = idx * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }

  return out;
}

export function compositeMinimapTerrainRgba(
  baseRgb: Uint8Array,
  cellCount: number,
  visionLayer: ArrayLike<number> | null | undefined,
  roadLayer: ArrayLike<number> | undefined,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const rgba =
    out !== undefined && out.length >= cellCount * 4 ? out : new Uint8ClampedArray(cellCount * 4);

  if (visionLayer === null) {
    for (let i = 0; i < cellCount; i++) {
      const o = i * 4;
      rgba[o] = FOG_R;
      rgba[o + 1] = FOG_G;
      rgba[o + 2] = FOG_B;
      rgba[o + 3] = 255;
    }
    return rgba;
  }

  for (let i = 0; i < cellCount; i++) {
    const visionState = visionLayer === undefined ? 2 : (visionLayer[i] ?? 0);
    const o = i * 4;
    if (visionState === 0) {
      rgba[o] = FOG_R;
      rgba[o + 1] = FOG_G;
      rgba[o + 2] = FOG_B;
      rgba[o + 3] = 255;
      continue;
    }

    const bi = i * 3;
    let r = baseRgb[bi] ?? 0;
    let g = baseRgb[bi + 1] ?? 0;
    let b = baseRgb[bi + 2] ?? 0;

    if ((roadLayer?.[i] ?? 0) >= 1) {
      r = Math.round(r * 0.45 + ROAD_R * 0.55);
      g = Math.round(g * 0.45 + ROAD_G * 0.55);
      b = Math.round(b * 0.45 + ROAD_B * 0.55);
    }

    if (visionState === 1) {
      r = Math.round(r * 0.45 + 8);
      g = Math.round(g * 0.45 + 8);
      b = Math.round(b * 0.45 + 8);
    }

    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = 255;
  }

  return rgba;
}

function resolveDisposition(
  observer: number,
  faction: number,
  isHostile: (observer: number, faction: number) => boolean,
): 'own' | 'hostile' | 'ally' {
  if (faction === observer) {
    return 'own';
  }
  return isHostile(observer, faction) ? 'hostile' : 'ally';
}

export function collectMinimapEntities(
  db: ContentDb,
  snapshot: Snapshot | null,
  isHostile: (observer: number, faction: number) => boolean,
  selected: ReadonlySet<number>,
): MinimapSceneEntities {
  if (snapshot === null) {
    return { memories: [], structures: [], units: [], threats: [] };
  }

  const observer = snapshot.observer;
  const memories: MinimapMemoryEntity[] = [];
  const structures: MinimapStructureEntity[] = [];
  const units: MinimapUnitEntity[] = [];
  const threats: MinimapThreatSquad[] = [];

  const mem = readChannel(snapshot, VisionMemoryChannel) ?? undefined;
  if (mem !== undefined) {
    for (let i = 0; i < mem.handles.length; i++) {
      const st = db.structures.byIndex(mem.kind[i] ?? 0);
      const faction = mem.faction[i] ?? 0;
      const state = mem.state[i] ?? 0;
      const disposition =
        state === STATE_RUIN || faction === 0
          ? 'neutral'
          : resolveDisposition(observer, faction, isHostile);
      memories.push({
        x: mem.x[i] ?? 0,
        y: mem.y[i] ?? 0,
        w: st?.footprint.w ?? 1,
        h: st?.footprint.h ?? 1,
        disposition,
      });
    }
  }

  const structChan = readChannel(snapshot, StructuresChannel) ?? undefined;
  const cpChan = readChannel(snapshot, CapturePointsChannel) ?? undefined;
  const cpIndexByHandle = new Map<number, number>();
  if (cpChan !== undefined) {
    for (let i = 0; i < cpChan.handles.length; i++) {
      const h = cpChan.handles[i];
      if (h !== undefined) {
        cpIndexByHandle.set(h, i);
      }
    }
  }

  if (structChan !== undefined) {
    for (let i = 0; i < structChan.handles.length; i++) {
      const handle = structChan.handles[i] ?? 0;
      const st = db.structures.byIndex(structChan.kind[i] ?? 0);
      const faction = structChan.faction[i] ?? 0;
      const state = structChan.state[i] ?? 0;
      const disposition =
        state === STATE_RUIN || faction === 0
          ? 'ruin'
          : resolveDisposition(observer, faction, isHostile);

      const ci = cpIndexByHandle.get(handle);
      let contested = false;
      let captureLeaderDisposition: 'none' | 'own' | 'hostile' = 'none';
      if (ci !== undefined && cpChan !== undefined) {
        contested = (cpChan.contested[ci] ?? 0) !== 0;
        const leader = cpChan.leader[ci] ?? 0;
        if (leader === observer) {
          captureLeaderDisposition = 'own';
        } else if (leader !== 0 && isHostile(observer, leader)) {
          captureLeaderDisposition = 'hostile';
        }
      }

      structures.push({
        x: structChan.x[i] ?? 0,
        y: structChan.y[i] ?? 0,
        w: st?.footprint.w ?? 1,
        h: st?.footprint.h ?? 1,
        disposition,
        isCore: Boolean(st?.core),
        isBlueprint: state === STATE_BLUEPRINT,
        contested,
        captureLeaderDisposition,
      });
    }
  }

  const unitChan = readChannel(snapshot, DenseUnitsChannel) ?? undefined;
  if (unitChan !== undefined) {
    for (let i = 0; i < unitChan.handles.length; i++) {
      const handle = unitChan.handles[i] ?? 0;
      const faction = unitChan.faction[i] ?? 0;
      const disposition = resolveDisposition(observer, faction, isHostile);
      units.push({
        x: unitChan.x[i] ?? 0,
        y: unitChan.y[i] ?? 0,
        disposition,
        selected: faction === observer && selected.has(handle),
      });
    }
  }

  const squadsChan = readChannel(snapshot, SquadsChannel) ?? undefined;
  if (squadsChan !== undefined) {
    for (const s of squadsChan.squads) {
      if (
        isHostile(observer, s.faction) &&
        (s.order.kind === 'gather' || s.order.kind === 'advance')
      ) {
        threats.push({
          kind: s.order.kind,
          gatherX: s.order.x,
          gatherY: s.order.y,
          route: s.route ?? [],
        });
      }
    }
  }

  return { memories, structures, units, threats };
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
