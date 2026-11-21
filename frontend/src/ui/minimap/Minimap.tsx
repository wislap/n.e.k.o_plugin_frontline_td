import { useEffect, useRef, type MouseEvent, type PointerEvent, type WheelEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { clampCenter } from '../../client/camera-math';
import { useCameraStore } from '../../client/camera-store';
import { useInteractionStore } from '../../client/interaction-store';
import { useIntentRouter } from '../../client/intent';
import { canvasToMap } from '../../client/minimap-model';
import { useSelectionStore } from '../../client/selection-store';
import type { SimClient } from '../../client/sim-client';
import { submitMoveOrder } from '../../client/squad-controls';
import { useUiStore } from '../../client/ui-store';
import { subscribeSnapshotClock } from '../../client/use-snapshot';
import type { ContentDb, ResolvedMap } from '../../content/index';
import { ActionButton, TacticalPanel } from '../kit/index';
import styles from './Minimap.module.css';
import {
  createMinimapRenderCache,
  paintMinimapCanvas,
  type MinimapRenderCache,
} from './paint-minimap';

const MAX_BACKING = 256;
const SNAPSHOT_POLL_MS = 100;
const WHEEL_ZOOM_STEP = 0.12;

function computeBackingSize(mapW: number, mapH: number): { width: number; height: number } {
  if (mapW <= 0 || mapH <= 0) {
    return { width: MAX_BACKING, height: MAX_BACKING };
  }
  if (mapW >= mapH) {
    return {
      width: MAX_BACKING,
      height: Math.max(1, Math.round((MAX_BACKING * mapH) / mapW)),
    };
  }
  return {
    width: Math.max(1, Math.round((MAX_BACKING * mapW) / mapH)),
    height: MAX_BACKING,
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
  const px = ((clientX - rect.left) / rect.width) * canvas.width;
  const py = ((clientY - rect.top) / rect.height) * canvas.height;
  return canvasToMap(px, py, canvas.width, canvas.height, mapW, mapH);
}

export function Minimap({
  client,
  db,
  map,
  isHostile,
}: {
  client: SimClient;
  db: ContentDb;
  map: ResolvedMap;
  isHostile: (observer: number, faction: number) => boolean;
}) {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.minimapOpen);
  const router = useIntentRouter();
  const sectorX = useCameraStore((s) => Math.floor(s.center.x));
  const sectorY = useCameraStore((s) => Math.floor(s.center.y));

  const toggle = (): void => {
    useUiStore.getState().toggleMinimap();
  };

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
        viewportAspect,
        moveMarker: sel.moveMarker,
        nowMs: performance.now(),
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

    return () => {
      disposed = true;
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
      }
      unsubClock();
      unsubCamera();
      unsubSelection();
      window.removeEventListener('resize', scheduleDraw);
    };
  }, [open, client, db, map, isHostile, backing.width, backing.height]);

  if (!open) {
    return (
      <div className={styles['collapsed']} data-testid="minimap-panel">
        <ActionButton size="sm" onClick={toggle}>
          {t('minimap.expand')}
        </ActionButton>
      </div>
    );
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
          submitMoveOrder(
            client,
            client.snapshots().latest,
            [...selected],
            Math.floor(pt.x),
            Math.floor(pt.y),
            e.ctrlKey || e.metaKey,
          );
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
      <TacticalPanel
        tone="mode"
        compact
        className={styles['panel']}
        bodyClassName={styles['body']}
        title={t('minimap.title')}
        badge={t('minimap.sector', { x: sectorX, y: sectorY })}
        headerActions={
          <ActionButton size="sm" variant="ghost" onClick={toggle}>
            {t('minimap.collapse')}
          </ActionButton>
        }
      >
        <div
          className={styles['frame']}
          data-testid="minimap-frame"
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
