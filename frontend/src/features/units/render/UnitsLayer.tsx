// Instanced unit rendering (M2 C3): reads snapshot pairs directly in
// useFrame (never React state), interpolates previous→latest positions by
// handle, and draws a flat ring under selected units. Instance capacity
// doubles when needed and never shrinks per frame.
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimClient } from '../../../client/sim-client';
import { pruneSelected, useSelectionStore } from '../../../client/selection-store';
import {
  SalvageChannel,
  StructuresChannel,
  type ConstructionSalvage,
  type ConstructionStructures,
} from '../../construction/protocol';
import { interpAlpha } from '../../../render/interpolate';
import { UnitInterpolator } from '../../../render/unit-pos';
import { terrainY } from '../../../render/world';
import { factionColorHex } from './colors';

const SELECTED_BRIGHTEN = 1.7;
const UNIT_HEIGHT = 0.6;
const RING_SCALE = 1.5;
// Render-only unit shapes (content `visual`, M4); index order matches
// the instanced-mesh order in the JSX below.
type UnitShape = 'cylinder' | 'box' | 'cone' | 'sphere';
const SHAPE_INDEX: Readonly<Record<UnitShape, number>> = {
  cylinder: 0,
  box: 1,
  cone: 2,
  sphere: 3,
};

interface UnitVisual {
  shape: UnitShape;
  scale: number;
}

export interface UnitsLayerProps {
  client: SimClient;
  heights: ArrayLike<number>;
  mapWidth: number;
  mapHeight: number;
  // Unit radius by content index (kind), from the content db.
  radii: readonly number[];
  // Render visual by content index (kind), from the content db.
  visuals: readonly UnitVisual[];
}

export function UnitsLayer({
  client,
  heights,
  mapWidth,
  mapHeight,
  radii,
  visuals,
}: UnitsLayerProps) {
  const [capacity, setCapacity] = useState(256);
  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const interp = useRef(new UnitInterpolator());
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const ringColor = useMemo(() => new THREE.Color('#ffffff'), []);

  useFrame(() => {
    const meshes = meshRefs.current;
    const ring = ringRef.current;
    if (meshes.some((m) => m === null)) {
      return;
    }
    const pair = client.snapshots();
    const latest = interp.current.update(pair);
    if (latest === null) {
      for (const mesh of meshes) {
        if (mesh !== null) {
          mesh.count = 0;
        }
      }
      if (ring !== null) {
        ring.count = 0;
      }
      return;
    }

    if (interp.current.prevSnapshotChanged) {
      // Drop handles that left the snapshot (units, structures, salvage —
      // selection holds every entity kind).
      const valid = new Set<number>();
      for (let i = 0; i < latest.handles.length; i++) {
        valid.add(latest.handles[i] ?? 0);
      }
      const structures = pair.latest?.channels[StructuresChannel.id] as
        ConstructionStructures | undefined;
      if (structures !== undefined) {
        for (let i = 0; i < structures.handles.length; i++) {
          valid.add(structures.handles[i] ?? 0);
        }
      }
      const salvage = pair.latest?.channels[SalvageChannel.id] as ConstructionSalvage | undefined;
      if (salvage !== undefined) {
        for (let i = 0; i < salvage.handles.length; i++) {
          valid.add(salvage.handles[i] ?? 0);
        }
      }
      const store = useSelectionStore.getState();
      const pruned = pruneSelected(store.selected, valid);
      if (pruned.size !== store.selected.size) {
        useSelectionStore.setState({ selected: pruned });
      }
    }

    const alpha = interpAlpha(performance.now(), pair.receivedAt, pair.intervalMs);
    const n = latest.handles.length;
    if (n > capacity) {
      setCapacity(capacity * 2);
      return;
    }

    // Same source as selection: the live latest snapshot's observer (null
    // before the first snapshot, when no local faction is distinguished).
    const localFaction = pair.latest?.observer ?? null;
    const selected = useSelectionStore.getState().selected;
    const counts = [0, 0, 0, 0];
    let rings = 0;
    for (let i = 0; i < n; i++) {
      const handle = latest.handles[i] ?? 0;
      const { x, y } = interp.current.interpolated(latest, i, alpha);
      const groundY = terrainY(heights, mapWidth, mapHeight, x, y);
      const kind = latest.kind[i] ?? 0;
      const radius = radii[kind] ?? 0.35;
      const visual = visuals[kind] ?? { shape: 'cylinder' as const, scale: 1 };
      const mesh = meshes[SHAPE_INDEX[visual.shape]];
      if (mesh === null || mesh === undefined) {
        continue;
      }
      const slot = counts[SHAPE_INDEX[visual.shape]] ?? 0;
      if (slot >= capacity) {
        continue;
      }

      dummy.position.set(x, groundY + (UNIT_HEIGHT * visual.scale) / 2, y);
      dummy.scale.set(radius * 2 * visual.scale, visual.scale, radius * 2 * visual.scale);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(slot, dummy.matrix);
      counts[SHAPE_INDEX[visual.shape]] = slot + 1;

      const faction = latest.faction[i] ?? 0;
      color.set(factionColorHex(faction, localFaction));
      if (selected.has(handle)) {
        color.multiplyScalar(SELECTED_BRIGHTEN);
        if (ring !== null && rings < capacity) {
          dummy.position.set(x, groundY + 0.02, y);
          dummy.scale.set(radius * RING_SCALE * 2, 1, radius * RING_SCALE * 2);
          // The ring geometry lies in the XY plane; rotate it flat.
          dummy.rotation.set(-Math.PI / 2, 0, 0);
          dummy.updateMatrix();
          ring.setMatrixAt(rings, dummy.matrix);
          rings += 1;
        }
      }
      mesh.setColorAt(slot, color);
    }
    for (let s = 0; s < meshes.length; s++) {
      const mesh = meshes[s];
      if (mesh === null || mesh === undefined) {
        continue;
      }
      mesh.count = counts[s] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
    if (ring !== null) {
      ring.count = rings;
      ring.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      <instancedMesh
        key={`cyl-${capacity}`}
        ref={(m) => {
          meshRefs.current[0] = m;
        }}
        args={[undefined, undefined, capacity]}
      >
        <cylinderGeometry args={[0.5, 0.5, UNIT_HEIGHT, 8]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh
        key={`box-${capacity}`}
        ref={(m) => {
          meshRefs.current[1] = m;
        }}
        args={[undefined, undefined, capacity]}
      >
        <boxGeometry args={[1, UNIT_HEIGHT, 1]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh
        key={`cone-${capacity}`}
        ref={(m) => {
          meshRefs.current[2] = m;
        }}
        args={[undefined, undefined, capacity]}
      >
        <coneGeometry args={[0.5, UNIT_HEIGHT, 8]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh
        key={`sph-${capacity}`}
        ref={(m) => {
          meshRefs.current[3] = m;
        }}
        args={[undefined, undefined, capacity]}
      >
        <sphereGeometry args={[0.5, 12, 10]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh key={`ring-${capacity}`} ref={ringRef} args={[undefined, undefined, capacity]}>
        <ringGeometry args={[0.7, 1, 16]} />
        <meshBasicMaterial color={ringColor} side={THREE.DoubleSide} transparent opacity={0.9} />
      </instancedMesh>
    </group>
  );
}
