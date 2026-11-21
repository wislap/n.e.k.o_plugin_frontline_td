// Game canvas (M2 C2 + M3 D): an R3F <Canvas> filling the viewport
// behind the HUD, plus the input bridge that registers the
// canvas-dependent half of the app intent router (render/input-dispatch.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useBoxStore } from '../client/box-store';
import { useInteractionStore } from '../client/interaction-store';
import { useIntentRouter, type IntentRouter } from '../client/intent';
import type { SnapshotPair } from '../client/sim-client';
import type { SimClient } from '../client/sim-client';
import { useSelectionStore } from '../client/selection-store';
import type { ContentDb, ResolvedMap } from '../content/index';
import { BeamsLayer } from '../features/combat/render/index';
import { CaptureLayer } from '../features/capture/render/index';
import {
  ExclusionLayer,
  GhostPreview,
  RoadWorksLayer,
  roadWorksHpItems,
  StructuresLayer,
  structureKindHeight,
} from '../features/construction/render/index';
import { StructuresChannel, type ConstructionStructures } from '../features/construction/protocol';
import { LogisticsOverlay, RoadLayer, RoadToolLayer } from '../features/logistics/render/index';
import { TERRAIN_HEIGHT_LAYER_ID } from '../features/terrain/protocol';
import { TerrainMesh } from '../features/terrain/render/index';
import { DenseUnitsChannel, type DenseUnits } from '../features/units/protocol';
import { UnitsLayer } from '../features/units/render/index';
import { ThreatsLayer } from '../features/squads/render/index';
import { FogLayer, MemoryLayer } from '../features/vision/render/index';
import type { PanTracker } from '../input/pan';
import { installPointer } from '../input/pointer';
import { CameraRig } from './camera/CameraRig';
import { HpBars, type HpBarCollector, type HpBarSink } from './hp-bars';
import { makeDispatch } from './input-dispatch';
import { SelectionHighlightLayer } from './SelectionHighlightLayer';
import { terrainY } from './world';

const BACKGROUND = '#0b1020';
const MARKER_COLOR = '#ffe08a';
const SKY_COLOR = '#bcd4ff';
const GROUND_LIGHT_COLOR = '#3a2f22';
const UNIT_BAR_TOP = 0.8;

export interface GameCanvasProps {
  client: SimClient;
  db: ContentDb;
  map: ResolvedMap;
  panTracker: PanTracker;
  // Hostility from the match relations (observer, faction) → bool.
  isHostile: (observer: number, faction: number) => boolean;
}

// Damaged-unit bars from the dense units channel.
function unitHpItems(pair: SnapshotPair, _alpha: number, sink: HpBarSink): void {
  const units = pair.latest?.channels[DenseUnitsChannel.id] as DenseUnits | undefined;
  if (units === undefined) {
    return;
  }
  for (let i = 0; i < units.handles.length; i++) {
    const bp = units.hpBp[i] ?? 10000;
    if (bp >= 10000) {
      continue;
    }
    sink.push(units.x[i] ?? 0, units.y[i] ?? 0, UNIT_BAR_TOP, 0.9, bp);
  }
}

// Inside <Canvas>: pointer events feed the app-level router; the router
// forwards canvas-dependent intents back into the handler registered
// here (ray casts need the live camera). Register/unregister on mount.
function InputBridge({
  client,
  db,
  mapWidth,
  mapHeight,
  heights,
  router,
}: {
  client: SimClient;
  db: ContentDb;
  mapWidth: number;
  mapHeight: number;
  heights: ArrayLike<number>;
  // Prop-drilled: React context does not cross the <Canvas> boundary.
  router: IntentRouter;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
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

// Damaged-structure bars from the structures channel.
function makeStructureHpItems(db: ContentDb): HpBarCollector {
  return (pair: SnapshotPair, _alpha: number, sink: HpBarSink): void => {
    const channel = pair.latest?.channels[StructuresChannel.id] as
      ConstructionStructures | undefined;
    if (channel === undefined) {
      return;
    }
    for (let i = 0; i < channel.handles.length; i++) {
      const bp = channel.hpBp[i] ?? 10000;
      if (bp >= 10000) {
        continue;
      }
      const kind = db.structures.byIndex(channel.kind[i] ?? 0);
      if (kind === undefined) {
        continue;
      }
      sink.push(
        (channel.x[i] ?? 0) + kind.footprint.w / 2,
        (channel.y[i] ?? 0) + kind.footprint.h / 2,
        structureKindHeight(db, channel.kind[i] ?? 0),
        Math.max(kind.footprint.w, kind.footprint.h),
        bp,
      );
    }
  };
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

export function GameCanvas({ client, db, map, panTracker, isHostile }: GameCanvasProps) {
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
  const heights = (snapshot?.layers[TERRAIN_HEIGHT_LAYER_ID] ?? grid.heights) as ArrayLike<number>;
  const surfaceColors = useMemo(() => db.surfaces.list.map((s) => s.color), [db]);
  const radii = useMemo(() => db.units.list.map((u) => u.radius), [db]);
  const unitVisuals = useMemo(() => db.units.list.map((u) => u.visual), [db]);
  const structureHpItems = useMemo(() => makeStructureHpItems(db), [db]);

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
            <StructuresLayer
              client={client}
              db={db}
              heights={heights}
              mapWidth={grid.width}
              mapHeight={grid.height}
              isHostile={isHostile}
            />
            <UnitsLayer
              client={client}
              heights={heights}
              mapWidth={grid.width}
              mapHeight={grid.height}
              radii={radii}
              visuals={unitVisuals}
              lowThresholdBp={db.logistics.lowThresholdBp}
            />
            <ThreatsLayer
              client={client}
              heights={heights}
              mapWidth={grid.width}
              mapHeight={grid.height}
            />
            <HpBars
              client={client}
              heights={heights}
              mapWidth={grid.width}
              mapHeight={grid.height}
              collect={unitHpItems}
            />
            <HpBars
              client={client}
              heights={heights}
              mapWidth={grid.width}
              mapHeight={grid.height}
              collect={structureHpItems}
            />
            <RoadLayer client={client} map={map} heights={heights} />
            <LogisticsOverlay client={client} db={db} map={map} heights={heights} />
            <RoadToolLayer client={client} map={map} heights={heights} />
            <RoadWorksLayer client={client} map={map} heights={heights} />
            <HpBars
              client={client}
              heights={heights}
              mapWidth={grid.width}
              mapHeight={grid.height}
              collect={roadWorksHpItems}
            />
            <GhostPreview
              client={client}
              db={db}
              map={map}
              heights={heights}
              isHostile={isHostile}
            />
            <ExclusionLayer
              client={client}
              db={db}
              heights={heights}
              mapWidth={grid.width}
              mapHeight={grid.height}
              isHostile={isHostile}
            />
            <MemoryLayer
              client={client}
              db={db}
              heights={heights}
              mapWidth={grid.width}
              mapHeight={grid.height}
            />
            <CaptureLayer
              client={client}
              heights={heights}
              mapWidth={grid.width}
              mapHeight={grid.height}
            />
            <BeamsLayer
              client={client}
              heights={heights}
              mapWidth={grid.width}
              mapHeight={grid.height}
            />
            <MoveMarker heights={heights} mapWidth={grid.width} mapHeight={grid.height} />
            <SelectionHighlightLayer
              client={client}
              db={db}
              heights={heights}
              mapWidth={grid.width}
              mapHeight={grid.height}
              isHostile={isHostile}
            />
            <FogLayer client={client} map={map} />
            <InputBridge
              client={client}
              db={db}
              mapWidth={grid.width}
              mapHeight={grid.height}
              heights={heights}
              router={router}
            />
          </>
        )}
        <CameraRig mapWidth={grid.width} mapHeight={grid.height} panTracker={panTracker} />
      </Canvas>
    </div>
  );
}
