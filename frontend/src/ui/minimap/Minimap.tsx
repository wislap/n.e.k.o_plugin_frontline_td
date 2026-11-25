import { useEffect, useRef, type MouseEvent, type PointerEvent, type WheelEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { clampCenter } from '../../client/camera-math';
import { useCameraStore } from '../../client/camera-store';
import { useInteractionStore } from '../../client/interaction-store';
import { useIntentRouter } from '../../client/intent';
import { canvasToMap } from '../../client/minimap-model';
import { useSelectionStore } from '../../client/selection-store';
import type { SimClient } from '../../client/sim-client';
import { useUiStore } from '../../client/ui-store';
import { subscribeSnapshotClock } from '../../client/use-snapshot';
import type { ContentDb, ResolvedMap } from '../../content/index';
import { TacticalPanel } from '../kit/index';
import styles from './Minimap.module.css';
import { renderNowMs } from '../../client/capture-mode';
import type { MinimapMarkDef, MinimapRasterDef } from './contributions';
import {
  createMinimapRenderCache,
  paintMinimapCanvas,
  type MinimapRenderCache,
} from './paint-minimap';

const DEFAULT_CSS_WIDTH = 196;
const SNAPSHOT_POLL_MS = 100;
const WHEEL_ZOOM_STEP = 0.12;

function computeBackingSize(mapW: number, mapH: number): { width: number; height: number } {
  if (mapW <= 0 || mapH <= 0) {
    return { width: DEFAULT_CSS_WIDTH, height: DEFAULT_CSS_WIDTH };
  }
  return {
    width: DEFAULT_CSS_WIDTH,
    height: Math.max(1, Math.round((DEFAULT_CSS_WIDTH * mapH) / mapW)),
  };
}

function canvasPointFromEvent(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  mapW: number,
  mapH: number,
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return canvasToMap(clientX - rect.left, clientY - rect.top, rect.width, rect.height, mapW, mapH);
}

export function Minimap({
  client,
  db,
  map,
  isHostile,
  rasters,
  marks,
  onMoveOrder,
}: {
  client: SimClient;
  db: ContentDb;
  map: ResolvedMap;
  isHostile: (observer: number, faction: number) => boolean;
  rasters: readonly MinimapRasterDef[];
  marks: readonly MinimapMarkDef[];
  // Move-order submission lives in features/squads; the shell supplies
  // it (ADR 0062). Guard = Ctrl/Meta held during the right-click.
  onMoveOrder?: ((x: number, y: number, guard: boolean) => void) | undefined;
}) {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.minimapOpen);
  const router = useIntentRouter();
  const sectorX = useCameraStore((s) => Math.floor(s.center.x));
  const sectorY = useCameraStore((s) => Math.floor(s.center.y));

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cacheRef = useRef<MinimapRenderCache | null>(null);
  const draggingRef = useRef(false);

  const backing = computeBackingSize(map.width, map.height);

  useEffect(() => {
    if (!open) {
      draggingRef.current = false;
      return;
    }

    if (cacheRef.current === null || cacheRef.current.db !== db || cacheRef.current.map !== map) {
      cacheRef.current = createMinimapRenderCache(db, map);
    }

    let rafId = 0;
    let disposed = false;

    const draw = (): void => {
      rafId = 0;
      if (disposed) {
        return;
      }
      const canvas = canvasRef.current;
      const cache = cacheRef.current;
      if (canvas === null || cache === null) {
        return;
      }
      const dpr = Math.min(4, Math.max(1, window.devicePixelRatio || 1));
      const rect = canvas.getBoundingClientRect();
      let pixelRatio = 1;
      if (rect.width > 0 && rect.height > 0) {
        const targetW = Math.max(1, Math.round(rect.width * dpr));
        const targetH = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== targetW) {
          canvas.width = targetW;
        }
        if (canvas.height !== targetH) {
          canvas.height = targetH;
        }
        pixelRatio = dpr;
      }
      const cam = useCameraStore.getState();
      const sel = useSelectionStore.getState();
      const viewportAspect =
        window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 16 / 9;
      paintMinimapCanvas(canvas, cache, {
        snapshot: client.snapshots().latest,
        db,
        isHostile,
        selected: sel.selected,
        cameraMode: cam.mode,
        cameraCenter: cam.center,
        cameraZoom: cam.zoom,
        cameraYaw: cam.yaw,
        cameraPitchOffsetDeg: cam.pitchOffsetDeg,
        viewportAspect,
        pixelRatio,
        moveMarker: sel.moveMarker,
        nowMs: renderNowMs(),
        rasters,
        marks,
      });
    };

    const scheduleDraw = (): void => {
      if (disposed || rafId !== 0) {
        return;
      }
      rafId = requestAnimationFrame(draw);
    };

    scheduleDraw();
    const unsubClock = subscribeSnapshotClock(client, SNAPSHOT_POLL_MS, scheduleDraw);
    const unsubCamera = useCameraStore.subscribe(scheduleDraw);
    const unsubSelection = useSelectionStore.subscribe(scheduleDraw);
    window.addEventListener('resize', scheduleDraw);
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleDraw) : null;
    if (resizeObserver !== null && canvasRef.current !== null) {
      resizeObserver.observe(canvasRef.current);
    }

    return () => {
      disposed = true;
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
      }
      unsubClock();
      unsubCamera();
      unsubSelection();
      window.removeEventListener('resize', scheduleDraw);
      resizeObserver?.disconnect();
    };
  }, [open, client, db, map, isHostile, rasters, marks, backing.width, backing.height]);

  if (!open) {
    // Collapse/expand lives on the right rail — nothing renders here.
    return <div className={styles['collapsed']} data-testid="minimap-panel" />;
  }

  const handlePointerDown = (e: PointerEvent<HTMLCanvasElement>): void => {
    e.stopPropagation();
    if (e.button !== 0) {
      return;
    }
    draggingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events without an active pointer.
    }
    const pt = canvasPointFromEvent(e.currentTarget, e.clientX, e.clientY, map.width, map.height);
    if (pt !== null) {
      useCameraStore.getState().setCenter(clampCenter(pt, map.width, map.height));
    }
  };

  const handlePointerMove = (e: PointerEvent<HTMLCanvasElement>): void => {
    e.stopPropagation();
    if (!draggingRef.current) {
      return;
    }
    const pt = canvasPointFromEvent(e.currentTarget, e.clientX, e.clientY, map.width, map.height);
    if (pt !== null) {
      useCameraStore.getState().setCenter(clampCenter(pt, map.width, map.height));
    }
  };

  const handlePointerUp = (e: PointerEvent<HTMLCanvasElement>): void => {
    e.stopPropagation();
    if (e.button === 0) {
      draggingRef.current = false;
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore synthetic events without an active pointer.
      }
      return;
    }
    if (e.button === 2) {
      if (useInteractionStore.getState().tool.kind !== 'none') {
        router.dispatch({ kind: 'tool.exit' });
        return;
      }
      if (useInteractionStore.getState().mode === 'command') {
        const pt = canvasPointFromEvent(
          e.currentTarget,
          e.clientX,
          e.clientY,
          map.width,
          map.height,
        );
        const selected = useSelectionStore.getState().selected;
        if (pt !== null && selected.size > 0) {
          onMoveOrder?.(Math.floor(pt.x), Math.floor(pt.y), e.ctrlKey || e.metaKey);
          useSelectionStore.getState().markMoveTarget(pt.x, pt.y, performance.now());
        }
      }
    }
  };

  const handlePointerCancel = (e: PointerEvent<HTMLCanvasElement>): void => {
    e.stopPropagation();
    draggingRef.current = false;
  };

  const handleWheel = (e: WheelEvent<HTMLCanvasElement>): void => {
    e.stopPropagation();
    if (e.deltaY === 0) {
      return;
    }
    const pt = canvasPointFromEvent(e.currentTarget, e.clientX, e.clientY, map.width, map.height);
    const delta = Math.sign(e.deltaY) * WHEEL_ZOOM_STEP;
    const cam = useCameraStore.getState();
    cam.zoomToward(delta, pt);
    cam.setCenter(clampCenter(useCameraStore.getState().center, map.width, map.height));
  };

  const handleContextMenu = (e: MouseEvent<HTMLCanvasElement>): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className={styles['wrapper']} data-testid="minimap-panel">
      <TacticalPanel tone="mode" className={styles['panel']} bodyClassName={styles['body']}>
        <div
          className={styles['frame']}
          data-testid="minimap-frame"
          data-sector={`${sectorX},${sectorY}`}
          style={{ aspectRatio: `${map.width} / ${map.height}` }}
        >
          <canvas
            ref={canvasRef}
            width={backing.width}
            height={backing.height}
            className={styles['canvas']}
            aria-label={t('minimap.aria_label')}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onWheel={handleWheel}
            onContextMenu={handleContextMenu}
          />
        </div>
      </TacticalPanel>
    </div>
  );
}
