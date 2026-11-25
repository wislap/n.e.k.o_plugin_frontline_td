// Game canvas (M2 C2 + M3 D): an R3F <Canvas> filling the viewport
// behind the HUD, plus the input bridge that registers the
// canvas-dependent half of the app intent router (render/input-dispatch.ts).
// Feature scene layers come in via the `layers` prop (ADR 0062) — the
// shell owns only lighting, background, camera, selection, input and post.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useBoxStore } from '../client/box-store';
import { isCaptureMode, renderNowMs } from '../client/capture-mode';
import { useInteractionStore } from '../client/interaction-store';
import { useIntentRouter, type IntentRouter } from '../client/intent';
import type { SimClient } from '../client/sim-client';
import { useSelectionStore } from '../client/selection-store';
import { useUiStore } from '../client/ui-store';
import type { ContentDb, ResolvedMap } from '../content/index';
import { TERRAIN_HEIGHT_LAYER_ID } from '../features/terrain/protocol';
import type { PanTracker } from '../input/pan';
import { installPointer } from '../input/pointer';
import { CameraRig } from './camera/CameraRig';
import type { SceneContext, SceneLayerDef } from './scene';
import { createFogUniforms } from './shaders';
import { makeDispatch } from './input-dispatch';
import { SelectionHighlightLayer } from './SelectionHighlightLayer';
import { PostEffects, SceneLighting, ThemeBackground } from './theme/index';
import { terrainY } from './world';
import { readLayer } from '../core/index';

const BACKGROUND = '#0b1020';
const MARKER_COLOR = '#ffe08a';

export interface GameCanvasProps {
  client: SimClient;
  db: ContentDb;
  map: ResolvedMap;
  layers: readonly SceneLayerDef[];
  panTracker: PanTracker;
  // Hostility from the match relations (observer, faction) → bool.
  isHostile: (observer: number, faction: number) => boolean;
}

// Capture mode (?capture=): counts rendered frames so tooling/shots.ts
// waits on a fixed frame count — SwiftShader renders only a few fps, so
// a wall-clock wait catches partially-settled GPU state instead of the
// converged scene.
function CaptureProbe() {
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    (globalThis as { __ftdFrames?: number }).__ftdFrames = frames.current;
  });
  return null;
}

// Render-cost readout for the dev DebugPanel: rolling frame time plus
// the previous rendered frame's gl.info counters, published to the UI
// store ~2x a second.
const PERF_WINDOW_MS = 500;

function publishPerfStats(gl: THREE.WebGLRenderer, frames: number, ms: number): void {
  useUiStore.getState().setRenderStats({
    frameMs: ms / frames,
    drawCalls: gl.info.render.calls,
    triangles: gl.info.render.triangles,
  });
}

function PerfProbe() {
  const acc = useRef({ frames: 0, ms: 0 });
  useEffect(() => {
    return () => {
      useUiStore.getState().setRenderStats(null);
    };
  }, []);
  useFrame((state, delta) => {
    const a = acc.current;
    a.frames += 1;
    a.ms += delta * 1000;
    if (a.ms >= PERF_WINDOW_MS) {
      publishPerfStats(state.gl, a.frames, a.ms);
      a.frames = 0;
      a.ms = 0;
    }
  });
  return null;
}

// Inside <Canvas>: pointer events feed the app-level router; the router
// forwards canvas-dependent intents back into the handler registered
// here (ray casts need the live camera). Register/unregister on mount.
function InputBridge({
  ctx,
  router,
}: {
  ctx: SceneContext;
  // Prop-drilled: React context does not cross the <Canvas> boundary.
  router: IntentRouter;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const { client, db, heights } = ctx;
  const { width: mapWidth, height: mapHeight } = ctx.map.grid;
  useEffect(() => {
    const el = gl.domElement;
    const dispatch = makeDispatch({
      client,
      db,
      mapWidth,
      mapHeight,
      heights,
      camera,
      size,
      rect: () => el.getBoundingClientRect(),
    });
    router.setCanvasHandler(dispatch);
    const uninstall = installPointer(
      el,
      router.dispatch,
      (box) => {
        useBoxStore.getState().setBox(box);
      },
      (event) => ({ x: event.clientX, y: event.clientY }),
      {
        getContext: () => {
          const s = useInteractionStore.getState();
          return { mode: s.mode, tool: s.tool.kind };
        },
      },
    );
    return () => {
      uninstall();
      router.setCanvasHandler(null);
    };
  }, [gl, camera, size, client, db, heights, mapWidth, mapHeight, router]);

  return null;
}

// Short-lived ring at the last move-command target.
function MoveMarker({ ctx }: { ctx: SceneContext }) {
  const { heights } = ctx;
  const { width: mapWidth, height: mapHeight } = ctx.map.grid;
  const marker = useSelectionStore((s) => s.moveMarker);
  const ref = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    if (ref.current === null || material.current === null || marker === null) {
      return;
    }
    const age = renderNowMs() - marker.at;
    const life = 900;
    material.current.opacity = Math.max(0, 1 - age / life);
    ref.current.visible = age < life;
  });

  if (marker === null) {
    return null;
  }
  const y = terrainY(heights, mapWidth, mapHeight, marker.x, marker.y);
  return (
    <mesh
      ref={ref}
      position={[marker.x, y + 0.065, marker.y]}
      rotation={[-Math.PI / 2, 0, 0]}
      frustumCulled={false}
    >
      <ringGeometry args={[0.4, 0.55, 24]} />
      <meshBasicMaterial
        ref={material}
        color={MARKER_COLOR}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export function GameCanvas({ client, db, map, layers, panTracker, isHostile }: GameCanvasProps) {
  const router = useIntentRouter();
  // Wait for the first snapshot (terrain layers + observer) before
  // mounting the scene content.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) {
      return;
    }
    const id = setInterval(() => {
      const latest = client.snapshots().latest;
      if (latest !== null && latest.layers[TERRAIN_HEIGHT_LAYER_ID] !== undefined) {
        setReady(true);
        clearInterval(id);
      }
    }, 50);
    return () => {
      clearInterval(id);
    };
  }, [client, ready]);

  const grid = map.grid;
  const snapshot = ready ? client.snapshots().latest : null;
  const heights = readLayer(snapshot, TERRAIN_HEIGHT_LAYER_ID) ?? grid.heights;
  const fogUniforms = useMemo(() => createFogUniforms(), []);
  const dprCap = useUiStore((s) => s.renderCost.dprCap);
  const panelOpen = useUiStore((s) => s.debugPanelOpen);
  const perfProbe = import.meta.env.DEV && panelOpen;
  const ctx = useMemo<SceneContext>(
    () => ({ client, db, map, heights, isHostile, fog: fogUniforms }),
    [client, db, map, heights, isHostile, fogUniforms],
  );

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas
        frameloop="always"
        style={{ background: BACKGROUND }}
        {...(dprCap > 0 ? { dpr: Math.min(window.devicePixelRatio, dprCap) } : {})}
      >
        <SceneLighting ctx={ctx} />
        {perfProbe && <PerfProbe />}
        {ready && <ThemeBackground ctx={ctx} />}
        {ready && (
          <>
            {layers.map((layer) => (
              <layer.Component key={layer.id} ctx={ctx} />
            ))}
            <MoveMarker ctx={ctx} />
            <SelectionHighlightLayer ctx={ctx} />
            <InputBridge ctx={ctx} router={router} />
          </>
        )}
        {(!isCaptureMode() || ready) && <CameraRig ctx={ctx} panTracker={panTracker} />}
        <PostEffects />
        {isCaptureMode() && <CaptureProbe />}
      </Canvas>
    </div>
  );
}
