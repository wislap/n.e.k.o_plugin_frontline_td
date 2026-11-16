// Game canvas (M2 C2): an R3F <Canvas> filling the viewport behind the
// HUD, plus the input bridge that turns pointer intents into picks,
// selections, and commands.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useBoxStore } from '../client/box-store';
import { useCameraStore } from '../client/camera-store';
import type { SimClient } from '../client/sim-client';
import { useSelectionStore } from '../client/selection-store';
import type { ContentDb, ResolvedMap } from '../content/index';
import { TERRAIN_HEIGHT_LAYER_ID } from '../features/terrain/protocol';
import { TerrainMesh } from '../features/terrain/render/index';
import { MoveCommand } from '../features/movement/protocol';
import { UnitsLayer } from '../features/units/render/index';
import type { Intent } from '../input/intents';
import type { PanTracker } from '../input/pan';
import { installPointer } from '../input/pointer';
import { CameraRig } from './camera/CameraRig';
import { visibleGroundHeight } from './camera/math';
import { pickGround } from './picking';
import { interpolatedUnits } from './unit-pos';
import { terrainY } from './world';

const BACKGROUND = '#0b1020';
const CLICK_RADIUS_CELLS = 0.6;
const MARKER_COLOR = '#ffe08a';
const SKY_COLOR = '#bcd4ff';
const GROUND_LIGHT_COLOR = '#3a2f22';

export interface GameCanvasProps {
  client: SimClient;
  db: ContentDb;
  map: ResolvedMap;
  panTracker: PanTracker;
}

// Inside <Canvas>: pointer intents need the live camera for ray casting.
function InputBridge({
  client,
  mapWidth,
  mapHeight,
  heights,
}: {
  client: SimClient;
  mapWidth: number;
  mapHeight: number;
  heights: ArrayLike<number>;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const groundAt = (sx: number, sy: number): { x: number; y: number } | null => {
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((sx - rect.left) / rect.width) * 2 - 1,
        -((sy - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      return pickGround(
        {
          origin: {
            x: raycaster.ray.origin.x,
            y: raycaster.ray.origin.y,
            z: raycaster.ray.origin.z,
          },
          dir: {
            x: raycaster.ray.direction.x,
            y: raycaster.ray.direction.y,
            z: raycaster.ray.direction.z,
          },
        },
        heights,
        mapWidth,
        mapHeight,
      );
    };

    const dispatch = (intent: Intent): void => {
      const now = performance.now();
      switch (intent.kind) {
        case 'camera.zoom': {
          useCameraStore.getState().zoomToward(intent.delta, groundAt(intent.x, intent.y));
          return;
        }
        case 'camera.pan_px': {
          const cam = useCameraStore.getState();
          // Ground-anchored approximation: convert screen pixels to cells
          // using the current visible ground extent.
          const cpp = visibleGroundHeight(cam.mode, cam.zoom) / size.height;
          cam.panBy(intent.dx * cpp, intent.dy * cpp);
          return;
        }
        case 'select.click': {
          const ground = groundAt(intent.x, intent.y);
          const store = useSelectionStore.getState();
          if (ground === null) {
            if (!intent.additive) {
              store.clear();
            }
            return;
          }
          const observer = client.snapshots().latest?.observer ?? -1;
          const units = interpolatedUnits(client.snapshots(), now);
          let best: number | null = null;
          let bestDist = CLICK_RADIUS_CELLS;
          for (const [handle, u] of units) {
            if (u.faction !== observer) {
              continue;
            }
            const d = Math.hypot(u.x - ground.x, u.y - ground.y);
            if (d <= bestDist) {
              bestDist = d;
              best = handle;
            }
          }
          if (best !== null) {
            store.setSelection(new Set([best]), intent.additive);
          } else if (!intent.additive) {
            store.clear();
          }
          return;
        }
        case 'select.box': {
          const rect = el.getBoundingClientRect();
          const observer = client.snapshots().latest?.observer ?? -1;
          const units = interpolatedUnits(client.snapshots(), now);
          const picked = new Set<number>();
          const v = new THREE.Vector3();
          for (const [handle, u] of units) {
            if (u.faction !== observer) {
              continue;
            }
            const y = terrainY(heights, mapWidth, mapHeight, u.x, u.y);
            v.set(u.x, y, u.y).project(camera);
            const px = ((v.x + 1) / 2) * rect.width + rect.left;
            const py = ((1 - v.y) / 2) * rect.height + rect.top;
            const box = {
              x0: Math.min(intent.x0, intent.x1),
              y0: Math.min(intent.y0, intent.y1),
              x1: Math.max(intent.x0, intent.x1),
              y1: Math.max(intent.y0, intent.y1),
            };
            if (px >= box.x0 && px <= box.x1 && py >= box.y0 && py <= box.y1) {
              picked.add(handle);
            }
          }
          useSelectionStore.getState().setSelection(picked, intent.additive);
          return;
        }
        case 'command.move_to': {
          const ground = groundAt(intent.x, intent.y);
          if (ground === null) {
            return;
          }
          const selected = [...useSelectionStore.getState().selected];
          if (selected.length === 0) {
            return;
          }
          client.submit({
            type: MoveCommand.type,
            payload: {
              units: selected,
              x: Math.floor(ground.x),
              y: Math.floor(ground.y),
            },
          });
          useSelectionStore.getState().markMoveTarget(ground.x, ground.y, now);
          return;
        }
        default:
      }
    };

    return installPointer(
      el,
      dispatch,
      (box) => {
        useBoxStore.getState().setBox(box);
      },
      (event) => ({ x: event.clientX, y: event.clientY }),
    );
  }, [gl, camera, size, client, heights, mapWidth, mapHeight]);

  return null;
}

// Short-lived ring at the last move-command target.
function MoveMarker({
  heights,
  mapWidth,
  mapHeight,
}: {
  heights: ArrayLike<number>;
  mapWidth: number;
  mapHeight: number;
}) {
  const marker = useSelectionStore((s) => s.moveMarker);
  const ref = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    if (ref.current === null || material.current === null || marker === null) {
      return;
    }
    const age = performance.now() - marker.at;
    const life = 900;
    material.current.opacity = Math.max(0, 1 - age / life);
    ref.current.visible = age < life;
  });

  if (marker === null) {
    return null;
  }
  const y = terrainY(heights, mapWidth, mapHeight, marker.x, marker.y);
  return (
    <mesh ref={ref} position={[marker.x, y + 0.03, marker.y]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.4, 0.55, 24]} />
      <meshBasicMaterial ref={material} color={MARKER_COLOR} transparent side={THREE.DoubleSide} />
    </mesh>
  );
}

export function GameCanvas({ client, db, map, panTracker }: GameCanvasProps) {
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
  const heights = (snapshot?.layers[TERRAIN_HEIGHT_LAYER_ID] ?? grid.heights) as ArrayLike<number>;
  const surfaceColors = useMemo(() => db.surfaces.list.map((s) => s.color), [db]);
  const radii = useMemo(() => db.units.list.map((u) => u.radius), [db]);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas frameloop="always" style={{ background: BACKGROUND }}>
        <hemisphereLight args={[SKY_COLOR, GROUND_LIGHT_COLOR, 0.9]} />
        <directionalLight position={[40, 60, 20]} intensity={1.2} />
        {ready && (
          <>
            <TerrainMesh
              snapshot={snapshot}
              width={grid.width}
              height={grid.height}
              ramps={grid.ramps}
              surfaceColors={surfaceColors}
            />
            <UnitsLayer
              client={client}
              heights={heights}
              mapWidth={grid.width}
              mapHeight={grid.height}
              radii={radii}
            />
            <MoveMarker heights={heights} mapWidth={grid.width} mapHeight={grid.height} />
            <InputBridge
              client={client}
              mapWidth={grid.width}
              mapHeight={grid.height}
              heights={heights}
            />
          </>
        )}
        <CameraRig mapWidth={grid.width} mapHeight={grid.height} panTracker={panTracker} />
      </Canvas>
    </div>
  );
}
