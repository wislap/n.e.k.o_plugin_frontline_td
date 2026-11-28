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
import type { CanvasIntentHandlerDef } from '../client/canvas-input';
import { useInteractionStore } from '../client/interaction-store';
import { useIntentRouter, type IntentRouter } from '../client/intent';
import type { SimClient } from '../client/sim-client';
import { useSelectionStore } from '../client/selection-store';
import { useUiStore } from '../client/ui-store';
import { terrainY } from '../client/world';
import type { ContentDb, ResolvedMap } from '../content/index';
import type { Snapshot } from '../core/index';
import type { Intent } from '../input/intents';
import type { PanTracker } from '../input/pan';
import { installPointer } from '../input/pointer';
import { CameraRig } from './camera/CameraRig';
import { effectComposerRef } from './composer-ref';
import { installGpuInstrumentation, type GpuInstrumentation } from './gpu-instrument';
import { createCoverUniforms } from './cover-uniforms';
import type { SceneContext, SceneLayerDef } from './scene';
import { createFogUniforms } from './shaders';
import { makeDispatch } from './input-dispatch';
import { PostEffects, SceneLighting, ThemeBackground, VISUAL } from './theme/index';

const BACKGROUND = '#0c0f11';
const MARKER_COLOR = VISUAL.markers.move;

export interface GameCanvasProps {
  client: SimClient;
  db: ContentDb;
  map: ResolvedMap;
  layers: readonly SceneLayerDef[];
  canvasIntents: ReadonlyMap<Intent['kind'], CanvasIntentHandlerDef>;
  // Terrain height layer reader — supplied by features/terrain (ADR 0062).
  readHeights: (snapshot: Snapshot | null) => ArrayLike<number> | null;
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
// store ~2x a second. While mounted it also installs the GPU pass
// instrumentation (render/gpu-instrument.ts): info.autoReset is off, so
// the counters below cover exactly one rendered frame.
const PERF_WINDOW_MS = 500;

function publishPerfStats(
  gl: THREE.WebGLRenderer,
  instr: GpuInstrumentation | null,
  frames: number,
  ms: number,
): void {
  const info = gl.info;
  useUiStore.getState().setRenderStats({
    frameMs: ms / frames,
    drawCalls: info.render.calls,
    triangles: info.render.triangles,
    lines: info.render.lines,
    points: info.render.points,
    programs: info.programs?.length ?? 0,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
  });
  if (instr !== null) {
    const ctx = gl.getContext();
    const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
    const rendererName = String(ctx.getParameter(dbg?.UNMASKED_RENDERER_WEBGL ?? ctx.RENDERER));
    const buffer = gl.getDrawingBufferSize(new THREE.Vector2());
    const snap = instr.profiler.snapshot();
    useUiStore.getState().setGpuStats({
      available: snap.available,
      renderer: rendererName,
      bufferWidth: buffer.x,
      bufferHeight: buffer.y,
      dpr: gl.getPixelRatio(),
      totalMs: snap.totalMs,
      labels: snap.labels.map((l) => ({ label: l.label, ms: l.ms, calls: l.calls })),
    });
  }
}

function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const gpuPerObject = useUiStore((s) => s.gpuPerObject);
  const acc = useRef({ frames: 0, ms: 0 });
  const instr = useRef<GpuInstrumentation | null>(null);
  useEffect(() => {
    const installed = installGpuInstrumentation(gl, () => effectComposerRef.current, scene, {
      perObject: useUiStore.getState().gpuPerObject,
    });
    instr.current = installed;
    return () => {
      installed.uninstall();
      instr.current = null;
      useUiStore.getState().setRenderStats(null);
      useUiStore.getState().setGpuStats(null);
    };
  }, [gl, scene]);
  useEffect(() => {
    instr.current?.setPerObject(gpuPerObject);
  }, [gpuPerObject]);
  // Frame begin runs before every other subscriber; frame end runs after
  // the composer's render (priority 1), so 'frame' brackets all GPU work.
  useFrame(() => {
    instr.current?.beginFrame();
  }, -1000);
  useFrame((state, delta) => {
    const a = acc.current;
    a.frames += 1;
    a.ms += delta * 1000;
    if (a.ms >= PERF_WINDOW_MS) {
      publishPerfStats(state.gl, instr.current, a.frames, a.ms);
      a.frames = 0;
      a.ms = 0;
    }
  });
  useFrame(() => {
    instr.current?.endFrame();
  }, 1000);
  return null;
}

// Inside <Canvas>: pointer events feed the app-level router; the router
// forwards canvas-dependent intents back into the handler registered
// here (ray casts need the live camera). Register/unregister on mount.
function InputBridge({
  ctx,
  router,
  canvasIntents,
}: {
  ctx: SceneContext;
  // Prop-drilled: React context does not cross the <Canvas> boundary.
  router: IntentRouter;
  canvasIntents: ReadonlyMap<Intent['kind'], CanvasIntentHandlerDef>;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const cameraRef = useRef(camera);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);
  const size = useThree((s) => s.size);
  const { client, db, heights } = ctx;
  useEffect(() => {
    const el = gl.domElement;
    const dispatch = makeDispatch(
      {
        client,
        db,
        map: ctx.map,
        heights,
        camera: () => cameraRef.current,
        size,
        rect: () => el.getBoundingClientRect(),
      },
      canvasIntents,
    );
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
  }, [gl, size, client, db, heights, ctx.map, canvasIntents, router]);

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
    ref.current.visible = age >= 0 && age < life;
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

export function GameCanvas({
  client,
  db,
  map,
  layers,
  canvasIntents,
  readHeights,
  panTracker,
  isHostile,
}: GameCanvasProps) {
  const router = useIntentRouter();
  // Wait for the first snapshot (terrain layers + observer) before
  // mounting the scene content.
  const [ready, setReady] = useState(() => {
    const latest = client.snapshots().latest;
    return latest !== null && readHeights(latest) !== null;
  });
  useEffect(() => {
    if (ready) {
      return;
    }
    let cancelled = false;
    let unsub: (() => void) | null = null;
    const check = (): void => {
      if (cancelled) {
        return;
      }
      const latest = client.snapshots().latest;
      if (latest !== null && readHeights(latest) !== null) {
        unsub?.();
        unsub = null;
        setReady(true);
      }
    };
    unsub = client.subscribe(check);
    queueMicrotask(check);
    return () => {
      cancelled = true;
      unsub?.();
      unsub = null;
    };
  }, [client, ready, readHeights]);

  const grid = map.grid;
  const snapshot = ready ? client.snapshots().latest : null;
  const heights = readHeights(snapshot) ?? grid.heights;
  const fogUniforms = useMemo(() => createFogUniforms(), []);
  const coverUniforms = useMemo(() => createCoverUniforms(), []);
  const dprCap = useUiStore((s) => s.renderCost.dprCap);
  const hiddenLayers = useUiStore((s) => s.hiddenSceneLayers);
  const panelOpen = useUiStore((s) => s.debugPanelOpen);
  const perfProbe = panelOpen;
  const ctx = useMemo<SceneContext>(
    () => ({ client, db, map, heights, isHostile, fog: fogUniforms, cover: coverUniforms }),
    [client, db, map, heights, isHostile, fogUniforms, coverUniforms],
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
              <group
                key={layer.id}
                visible={!hiddenLayers.has(layer.id)}
                userData={{ sceneLayerId: layer.id }}
              >
                <layer.Component ctx={ctx} />
              </group>
            ))}
            <MoveMarker ctx={ctx} />
            <InputBridge ctx={ctx} router={router} canvasIntents={canvasIntents} />
          </>
        )}
        {(!isCaptureMode() || ready) && <CameraRig ctx={ctx} panTracker={panTracker} />}
        <PostEffects />
        {isCaptureMode() && <CaptureProbe />}
      </Canvas>
    </div>
  );
}
