// Imperative 2D Canvas renderer for the tactical minimap. Maintains an
// offscreen terrain+fog+road cache so per-frame camera pans/selections only
// blit the cached bitmap and redraw dynamic overlays.
import {
  buildBaseTerrainRgb,
  collectMinimapEntities,
  compositeMinimapTerrainRgba,
  computeMinimapViewport,
  mapToCanvas,
} from '../../client/minimap-model';
import type { ContentDb, ResolvedMap } from '../../content/index';
import type { Snapshot } from '../../core/index';
import { ROAD_LAYER_ID } from '../../features/logistics/protocol';
import { VISION_STATE_LAYER_ID } from '../../features/vision/protocol';

const MOVE_MARKER_MS = 900;

export interface MinimapRenderCache {
  db: ContentDb;
  map: ResolvedMap;
  baseRgb: Uint8Array;
  baseRgbBuiltWithoutSnapshot: boolean;
  rgbaBuffer: Uint8ClampedArray;
  offCanvas: HTMLCanvasElement | null;
  offCtx: CanvasRenderingContext2D | null;
  imageData: ImageData | null;
  lastVisionLayer: ArrayLike<number> | null | undefined;
  lastRoadLayer: ArrayLike<number> | undefined;
  lastHasSnapshot: boolean;
}

export interface PaintMinimapParams {
  snapshot: Snapshot | null;
  db: ContentDb;
  isHostile: (observer: number, faction: number) => boolean;
  selected: ReadonlySet<number>;
  cameraMode: 'spectate' | 'tactical';
  cameraCenter: { x: number; y: number };
  cameraZoom: number;
  viewportAspect: number;
  moveMarker: { x: number; y: number; at: number } | null;
  nowMs: number;
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
    baseRgb: buildBaseTerrainRgb(db, map),
    baseRgbBuiltWithoutSnapshot: true,
    rgbaBuffer: new Uint8ClampedArray(cellCount * 4),
    offCanvas: null,
    offCtx: null,
    imageData: null,
    lastVisionLayer: undefined,
    lastRoadLayer: undefined,
    lastHasSnapshot: false,
  };
  initOffscreenSurface(cache);
  return cache;
}

function memoryColor(disposition: 'own' | 'hostile' | 'ally' | 'neutral'): string {
  switch (disposition) {
    case 'own':
      return '#4d7ea8';
    case 'hostile':
      return '#8a5058';
    case 'ally':
      return '#468a73';
    case 'neutral':
      return '#5b7390';
  }
}

function structureColor(disposition: 'own' | 'hostile' | 'ally' | 'ruin', isCore: boolean): string {
  switch (disposition) {
    case 'own':
      return isCore ? '#9be2ff' : '#5cc8ff';
    case 'hostile':
      return '#ff5c5c';
    case 'ally':
      return '#46e09a';
    case 'ruin':
      return '#c8a24a';
  }
}

function unitColor(disposition: 'own' | 'hostile' | 'ally'): string {
  switch (disposition) {
    case 'hostile':
      return '#ff6b6b';
    case 'own':
      return '#6ee7ff';
    case 'ally':
      return '#46e09a';
  }
}

function syncTerrainLayer(cache: MinimapRenderCache, snapshot: Snapshot | null): void {
  const visionLayer: ArrayLike<number> | null | undefined =
    snapshot === null ? null : snapshot.layers[`${VISION_STATE_LAYER_ID}#${snapshot.observer}`];
  const roadLayer: ArrayLike<number> | undefined = snapshot?.layers[ROAD_LAYER_ID];
  const hasSnapshot = snapshot !== null;

  if (
    hasSnapshot === cache.lastHasSnapshot &&
    visionLayer === cache.lastVisionLayer &&
    roadLayer === cache.lastRoadLayer
  ) {
    return;
  }

  if (cache.baseRgbBuiltWithoutSnapshot && snapshot !== null) {
    cache.baseRgb = buildBaseTerrainRgb(cache.db, cache.map, snapshot);
    cache.baseRgbBuiltWithoutSnapshot = false;
  }

  const cellCount = cache.map.width * cache.map.height;
  compositeMinimapTerrainRgba(cache.baseRgb, cellCount, visionLayer, roadLayer, cache.rgbaBuffer);

  initOffscreenSurface(cache);
  if (cache.imageData !== null && cache.offCtx !== null) {
    cache.imageData.data.set(cache.rgbaBuffer);
    cache.offCtx.putImageData(cache.imageData, 0, 0);
  }

  cache.lastHasSnapshot = hasSnapshot;
  cache.lastVisionLayer = visionLayer;
  cache.lastRoadLayer = roadLayer;
}

export function paintMinimapCanvas(
  canvas: HTMLCanvasElement,
  cache: MinimapRenderCache,
  params: PaintMinimapParams,
): void {
  const width = canvas.width;
  const height = canvas.height;
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

  syncTerrainLayer(cache, params.snapshot);

  ctx.clearRect(0, 0, width, height);
  if (cache.offCanvas !== null) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cache.offCanvas, 0, 0, width, height);
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

  // 2. Collect tactical entities.
  const entities = collectMinimapEntities(
    params.db,
    params.snapshot,
    params.isHostile,
    params.selected,
  );

  // 3. Threat routes and gather markers.
  if (entities.threats.length > 0) {
    ctx.save();
    ctx.strokeStyle = '#ff5c5c';
    ctx.lineWidth = 1.25;
    for (const threat of entities.threats) {
      if (threat.route.length >= 4) {
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        const start = mapToCanvas(
          threat.route[0] ?? 0,
          threat.route[1] ?? 0,
          width,
          height,
          mapW,
          mapH,
        );
        ctx.moveTo(start.x, start.y);
        for (let i = 2; i + 1 < threat.route.length; i += 2) {
          const pt = mapToCanvas(
            threat.route[i] ?? 0,
            threat.route[i + 1] ?? 0,
            width,
            height,
            mapW,
            mapH,
          );
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
      }
      if (threat.kind === 'gather') {
        const gp = mapToCanvas(threat.gatherX, threat.gatherY, width, height, mapW, mapH);
        const pulse = 0.5 + 0.5 * Math.sin(params.nowMs * 0.008);
        const radius = 3 + pulse * 2;
        ctx.setLineDash([]);
        ctx.strokeStyle = pulse > 0.5 ? '#ff5c5c' : '#ffc14d';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(gp.x, gp.y - radius);
        ctx.lineTo(gp.x + radius, gp.y);
        ctx.lineTo(gp.x, gp.y + radius);
        ctx.lineTo(gp.x - radius, gp.y);
        ctx.closePath();
        ctx.stroke();
        ctx.strokeStyle = '#ff5c5c';
        ctx.lineWidth = 1.25;
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 4. Fog-memory ghosts.
  if (entities.memories.length > 0) {
    ctx.save();
    ctx.globalAlpha = 0.65;
    for (const mem of entities.memories) {
      const p0 = mapToCanvas(mem.x, mem.y, width, height, mapW, mapH);
      const p1 = mapToCanvas(mem.x + mem.w, mem.y + mem.h, width, height, mapW, mapH);
      const rw = Math.max(2, p1.x - p0.x);
      const rh = Math.max(2, p1.y - p0.y);
      ctx.fillStyle = memoryColor(mem.disposition);
      ctx.fillRect(p0.x, p0.y, rw, rh);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // 5. Structures & ruins.
  for (const st of entities.structures) {
    const p0 = mapToCanvas(st.x, st.y, width, height, mapW, mapH);
    const p1 = mapToCanvas(st.x + st.w, st.y + st.h, width, height, mapW, mapH);
    const rw = Math.max(2, p1.x - p0.x);
    const rh = Math.max(2, p1.y - p0.y);
    const color = structureColor(st.disposition, st.isCore);

    if (st.isBlueprint) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(p0.x + 0.5, p0.y + 0.5, Math.max(2, rw - 1), Math.max(2, rh - 1));
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(p0.x, p0.y, rw, rh);
      if (st.isCore && st.disposition === 'own') {
        ctx.strokeStyle = '#eef8ff';
        ctx.lineWidth = 1;
        ctx.strokeRect(p0.x - 0.5, p0.y - 0.5, rw + 1, rh + 1);
      }
    }

    if (st.disposition === 'ruin') {
      if (st.contested) {
        ctx.strokeStyle = '#ffc14d';
        ctx.lineWidth = 1.25;
        ctx.strokeRect(p0.x - 1, p0.y - 1, rw + 2, rh + 2);
      } else if (st.captureLeaderDisposition === 'own') {
        const cx = p0.x + rw / 2;
        const cy = p0.y + rh / 2;
        const r = Math.max(rw, rh) / 2 + 2;
        ctx.strokeStyle = '#5cc8ff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // 6. Live units (unselected first, selected on top with halo).
  for (const unit of entities.units) {
    if (unit.selected) {
      continue;
    }
    const pt = mapToCanvas(unit.x, unit.y, width, height, mapW, mapH);
    ctx.fillStyle = unitColor(unit.disposition);
    ctx.fillRect(pt.x - 1.25, pt.y - 1.25, 2.5, 2.5);
  }
  for (const unit of entities.units) {
    if (!unit.selected) {
      continue;
    }
    const pt = mapToCanvas(unit.x, unit.y, width, height, mapW, mapH);
    ctx.fillStyle = '#6ee7ff';
    ctx.fillRect(pt.x - 2.5, pt.y - 2.5, 5, 5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(pt.x - 1.5, pt.y - 1.5, 3, 3);
  }

  // 7. Move order ping.
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

  // 8. Camera viewport frustum.
  const vp = computeMinimapViewport(
    params.cameraMode,
    params.cameraCenter,
    params.cameraZoom,
    params.viewportAspect,
  );
  const tl = mapToCanvas(vp.x, vp.y, width, height, mapW, mapH);
  const br = mapToCanvas(vp.x + vp.w, vp.y + vp.h, width, height, mapW, mapH);
  const minX = 1;
  const minY = 1;
  const maxX = Math.max(minX, width - 2);
  const maxY = Math.max(minY, height - 2);
  const x0 = Math.max(minX, Math.min(maxX, tl.x));
  const y0 = Math.max(minY, Math.min(maxY, tl.y));
  const x1 = Math.max(minX, Math.min(maxX, br.x));
  const y1 = Math.max(minY, Math.min(maxY, br.y));
  const vw = Math.max(2, x1 - x0);
  const vh = Math.max(2, y1 - y0);
  const rx = Math.min(x0, Math.max(minX, maxX - vw));
  const ry = Math.min(y0, Math.max(minY, maxY - vh));

  ctx.save();
  ctx.strokeStyle = 'rgba(5, 8, 15, 0.75)';
  ctx.lineWidth = 3;
  ctx.strokeRect(rx, ry, vw, vh);
  ctx.strokeStyle = '#e8f4ff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(rx, ry, vw, vh);
  ctx.restore();
}
