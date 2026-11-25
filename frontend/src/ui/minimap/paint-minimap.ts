// Imperative 2D Canvas renderer for the tactical minimap. Maintains an
// offscreen terrain image recomposited from the contributed raster
// passes (ADR 0062 step 4a) so per-frame camera pans/selections only
// blit the cached bitmap and redraw contributed marks, ping and frustum.
import {
  clipPolygonToRect,
  computeMinimapFrustumQuad,
  mapToCanvas,
} from '../../client/minimap-model';
import type { ContentDb, ResolvedMap } from '../../content/index';
import type { Snapshot } from '../../core/index';
import type { MinimapMark, MinimapMarkDef, MinimapRasterDef } from './contributions';

const MOVE_MARKER_MS = 900;

export interface MinimapRenderCache {
  db: ContentDb;
  map: ResolvedMap;
  rgbaBuffer: Uint8ClampedArray;
  offCanvas: HTMLCanvasElement | null;
  offCtx: CanvasRenderingContext2D | null;
  imageData: ImageData | null;
  rasterKeys: readonly (readonly unknown[])[] | null;
}

export interface PaintMinimapParams {
  snapshot: Snapshot | null;
  db: ContentDb;
  isHostile: (observer: number, faction: number) => boolean;
  selected: ReadonlySet<number>;
  cameraMode: 'spectate' | 'tactical';
  cameraCenter: { x: number; y: number };
  cameraZoom: number;
  cameraYaw?: number;
  cameraPitchOffsetDeg?: number;
  viewportAspect: number;
  pixelRatio?: number;
  moveMarker: { x: number; y: number; at: number } | null;
  nowMs: number;
  rasters: readonly MinimapRasterDef[];
  marks: readonly MinimapMarkDef[];
}

function initOffscreenSurface(cache: MinimapRenderCache): void {
  if (cache.offCanvas !== null || typeof document === 'undefined') {
    return;
  }
  const { width, height } = cache.map;
  if (width <= 0 || height <= 0) {
    return;
  }
  const offCanvas = document.createElement('canvas');
  offCanvas.width = width;
  offCanvas.height = height;
  const offCtx = offCanvas.getContext('2d');
  const imageData = offCtx !== null ? offCtx.createImageData(width, height) : null;
  cache.offCanvas = offCanvas;
  cache.offCtx = offCtx;
  cache.imageData = imageData;
}

export function createMinimapRenderCache(db: ContentDb, map: ResolvedMap): MinimapRenderCache {
  const cellCount = Math.max(0, map.width * map.height);
  const cache: MinimapRenderCache = {
    db,
    map,
    rgbaBuffer: new Uint8ClampedArray(cellCount * 4),
    offCanvas: null,
    offCtx: null,
    imageData: null,
    rasterKeys: null,
  };
  initOffscreenSurface(cache);
  return cache;
}

function sameKeys(a: readonly unknown[] | undefined, b: readonly unknown[]): boolean {
  return a !== undefined && a.length === b.length && a.every((v, i) => v === b[i]);
}

function syncTerrainLayer(
  cache: MinimapRenderCache,
  snapshot: Snapshot | null,
  rasters: readonly MinimapRasterDef[],
): void {
  const keys = rasters.map((r) => r.keys(snapshot));
  const prev = cache.rasterKeys;
  if (prev !== null && keys.every((k, i) => sameKeys(prev[i], k))) {
    return;
  }

  const input = { db: cache.db, map: cache.map, snapshot };
  for (const raster of rasters) {
    raster.apply(cache.rgbaBuffer, input);
  }

  initOffscreenSurface(cache);
  if (cache.imageData !== null && cache.offCtx !== null) {
    cache.imageData.data.set(cache.rgbaBuffer);
    cache.offCtx.putImageData(cache.imageData, 0, 0);
  }

  cache.rasterKeys = keys;
}

function paintMark(
  ctx: CanvasRenderingContext2D,
  mark: MinimapMark,
  width: number,
  height: number,
  mapW: number,
  mapH: number,
): void {
  switch (mark.kind) {
    case 'rect': {
      const p0 = mapToCanvas(mark.x, mark.y, width, height, mapW, mapH);
      const p1 = mapToCanvas(mark.x + mark.w, mark.y + mark.h, width, height, mapW, mapH);
      const rw = Math.max(2, p1.x - p0.x);
      const rh = Math.max(2, p1.y - p0.y);
      if (mark.alpha !== undefined) {
        ctx.globalAlpha = mark.alpha;
      }
      if (mark.fill !== undefined) {
        ctx.fillStyle = mark.fill;
        ctx.fillRect(p0.x, p0.y, rw, rh);
      }
      if (mark.stroke !== undefined) {
        const grow = mark.grow ?? 0;
        ctx.strokeStyle = mark.stroke;
        ctx.lineWidth = mark.lineWidth ?? 1;
        ctx.strokeRect(
          p0.x - grow,
          p0.y - grow,
          Math.max(2, rw + 2 * grow),
          Math.max(2, rh + 2 * grow),
        );
      }
      break;
    }
    case 'ring': {
      const p0 = mapToCanvas(mark.x, mark.y, width, height, mapW, mapH);
      const p1 = mapToCanvas(mark.x + mark.w, mark.y + mark.h, width, height, mapW, mapH);
      const rw = Math.max(2, p1.x - p0.x);
      const rh = Math.max(2, p1.y - p0.y);
      const r = Math.max(rw, rh) / 2 + mark.padPx;
      ctx.strokeStyle = mark.color;
      ctx.lineWidth = mark.lineWidth;
      ctx.beginPath();
      ctx.arc(p0.x + rw / 2, p0.y + rh / 2, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'path': {
      if (mark.points.length < 4) {
        break;
      }
      ctx.setLineDash(mark.dash !== undefined ? [...mark.dash] : []);
      ctx.strokeStyle = mark.color;
      ctx.lineWidth = mark.lineWidth;
      ctx.beginPath();
      const start = mapToCanvas(
        mark.points[0] ?? 0,
        mark.points[1] ?? 0,
        width,
        height,
        mapW,
        mapH,
      );
      ctx.moveTo(start.x, start.y);
      for (let i = 2; i + 1 < mark.points.length; i += 2) {
        const pt = mapToCanvas(
          mark.points[i] ?? 0,
          mark.points[i + 1] ?? 0,
          width,
          height,
          mapW,
          mapH,
        );
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case 'diamond': {
      const pt = mapToCanvas(mark.x, mark.y, width, height, mapW, mapH);
      const radius = mark.radiusPx;
      ctx.strokeStyle = mark.color;
      ctx.lineWidth = mark.lineWidth;
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y - radius);
      ctx.lineTo(pt.x + radius, pt.y);
      ctx.lineTo(pt.x, pt.y + radius);
      ctx.lineTo(pt.x - radius, pt.y);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'dot': {
      const pt = mapToCanvas(mark.x, mark.y, width, height, mapW, mapH);
      const s = mark.sizePx;
      ctx.fillStyle = mark.color;
      ctx.fillRect(pt.x - s / 2, pt.y - s / 2, s, s);
      break;
    }
  }
}

export function paintMinimapCanvas(
  canvas: HTMLCanvasElement,
  cache: MinimapRenderCache,
  params: PaintMinimapParams,
): void {
  const rawDpr = params.pixelRatio ?? 1;
  const dpr = Number.isFinite(rawDpr) && rawDpr > 0 ? rawDpr : 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  if (width <= 0 || height <= 0) {
    return;
  }
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return;
  }
  const mapW = cache.map.width;
  const mapH = cache.map.height;
  if (mapW <= 0 || mapH <= 0) {
    return;
  }

  syncTerrainLayer(cache, params.snapshot, params.rasters);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (cache.offCanvas !== null) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cache.offCanvas, 0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
  }

  // 1. Subtle radar grid lines at 25% / 50% / 75%.
  ctx.strokeStyle = 'rgba(140, 185, 235, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const frac of [0.25, 0.5, 0.75]) {
    const gx = Math.round(width * frac) + 0.5;
    const gy = Math.round(height * frac) + 0.5;
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, height);
    ctx.moveTo(0, gy);
    ctx.lineTo(width, gy);
  }
  ctx.stroke();

  // 2. Contributed marks, in contributor order.
  const markInput = {
    db: params.db,
    map: cache.map,
    snapshot: params.snapshot,
    isHostile: params.isHostile,
    selected: params.selected,
    nowMs: params.nowMs,
  };
  ctx.save();
  for (const def of params.marks) {
    for (const mark of def.collect(markInput)) {
      paintMark(ctx, mark, width, height, mapW, mapH);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();

  // 3. Move order ping.
  if (params.moveMarker !== null) {
    const age = params.nowMs - params.moveMarker.at;
    if (age >= 0 && age < MOVE_MARKER_MS) {
      const progress = age / MOVE_MARKER_MS;
      const pt = mapToCanvas(params.moveMarker.x, params.moveMarker.y, width, height, mapW, mapH);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - progress);
      ctx.strokeStyle = '#ffe08a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3 + progress * 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 4. Camera viewport frustum (rotated trapezoid in 3D, rotated rect in 2D).
  const quad = computeMinimapFrustumQuad(
    params.cameraMode,
    params.cameraCenter,
    params.cameraZoom,
    params.cameraYaw ?? 0,
    params.cameraPitchOffsetDeg ?? 0,
    params.viewportAspect,
  );
  const canvasQuad = quad.map((pt) => mapToCanvas(pt.x, pt.y, width, height, mapW, mapH));
  const inset = 1.25;
  const clipped = clipPolygonToRect(
    canvasQuad,
    inset,
    inset,
    Math.max(inset, width - inset),
    Math.max(inset, height - inset),
  );
  const first = clipped[0];
  if (first !== undefined && clipped.length >= 3) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < clipped.length; i++) {
      const pt = clipped[i];
      if (pt !== undefined) {
        ctx.lineTo(pt.x, pt.y);
      }
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(232, 244, 255, 0.045)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(5, 8, 15, 0.82)';
    ctx.lineWidth = 2.75;
    ctx.stroke();
    ctx.strokeStyle = '#e8f4ff';
    ctx.lineWidth = 1.35;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}
