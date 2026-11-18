// Structure/salvage rendering (M3 D): instanced greybox per kind with
// per-kind heights, faction colours, sites rising with progress,
// translucent (pulsing when waiting) blueprints, darkened demolishing
// structures, and salvage crates. Reads the structures/salvage channels
// in useFrame; no per-tick state in React.
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimClient } from '../../../client/sim-client';
import type { ContentDb } from '../../../content/index';
import { factionColorHex } from '../../units/render/index';
import { terrainY } from '../../../render/world';
import {
  SalvageChannel,
  StructuresChannel,
  STATE_BLUEPRINT,
  STATE_DEMOLISHING,
  STATE_RUIN,
  STATE_SITE,
  STATE_WAITING,
  type ConstructionSalvage,
  type ConstructionStructures,
} from '../protocol';

const SALVAGE_SIZE = 0.3;
const SALVAGE_COLOR = '#8a6a3f';
const SITE_DARKEN = 0.45;
const DEMOLISH_DARKEN = 0.4;
// Outposts read as squat fortified pads; ruins are faction-neutral rubble.
const OUTPOST_TINT = 0.8;
const RUIN_COLOR = '#3a3430';
const RUIN_HEIGHT = 0.3;

// Greybox height from content (`visual.height`, required per kind);
// unknown indices fall back to a unit-height box.
export function structureKindHeight(db: ContentDb, kindIndex: number): number {
  return db.structures.byIndex(kindIndex)?.visual.height ?? 1;
}

export interface StructuresLayerProps {
  client: SimClient;
  db: ContentDb;
  heights: ArrayLike<number>;
  mapWidth: number;
  mapHeight: number;
}

export function StructuresLayer({
  client,
  db,
  heights,
  mapWidth,
  mapHeight,
}: StructuresLayerProps) {
  const [capacity, setCapacity] = useState(64);
  const solidRef = useRef<THREE.InstancedMesh>(null);
  const bpRef = useRef<THREE.InstancedMesh>(null);
  const crateRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const solid = solidRef.current;
    const bpMesh = bpRef.current;
    const crates = crateRef.current;
    if (solid === null || bpMesh === null || crates === null) {
      return;
    }
    const pair = client.snapshots();
    const latest = pair.latest;
    const channel = latest?.channels[StructuresChannel.id] as ConstructionStructures | undefined;
    const salvage = latest?.channels[SalvageChannel.id] as ConstructionSalvage | undefined;
    const localFaction = latest?.observer ?? null;
    const pulse = 0.55 + 0.25 * Math.sin(performance.now() / 180);

    let n = 0;
    let nbp = 0;
    if (channel !== undefined) {
      n = channel.handles.length;
      for (let i = 0; i < n; i++) {
        if ((channel.state[i] ?? 0) <= STATE_WAITING) {
          nbp += 1;
        }
      }
    }
    const cratesN = salvage?.handles.length ?? 0;
    if (n + cratesN > capacity) {
      setCapacity((n + cratesN) * 2);
      return;
    }

    if (channel !== undefined) {
      let si = 0;
      let bi = 0;
      for (let i = 0; i < channel.handles.length; i++) {
        const kindIndex = channel.kind[i] ?? 0;
        const kind = db.structures.byIndex(kindIndex);
        if (kind === undefined) {
          continue;
        }
        const state = channel.state[i] ?? 0;
        const w = kind.footprint.w;
        const h = kind.footprint.h;
        const cx = (channel.x[i] ?? 0) + w / 2;
        const cy = (channel.y[i] ?? 0) + h / 2;
        const groundY = terrainY(heights, mapWidth, mapHeight, cx, cy);
        const full = structureKindHeight(db, kindIndex);
        const progress = (channel.progressBp[i] ?? 0) / 10000;

        if (state === STATE_BLUEPRINT || state === STATE_WAITING) {
          dummy.position.set(cx, groundY + (full * 0.5) / 2, cy);
          dummy.scale.set(w * 0.9, full * 0.5, h * 0.9);
          dummy.updateMatrix();
          bpMesh.setMatrixAt(bi, dummy.matrix);
          color.set(factionColorHex(channel.faction[i] ?? 0, localFaction));
          bpMesh.setColorAt(bi, color);
          bi += 1;
          continue;
        }
        const heightScale =
          state === STATE_RUIN
            ? RUIN_HEIGHT / full
            : state === STATE_SITE
              ? Math.max(0.15, progress)
              : 1;
        dummy.position.set(cx, groundY + (full * heightScale) / 2, cy);
        dummy.scale.set(w * 0.9, full * heightScale, h * 0.9);
        dummy.updateMatrix();
        solid.setMatrixAt(si, dummy.matrix);
        if (state === STATE_RUIN) {
          color.set(RUIN_COLOR);
        } else {
          color.set(factionColorHex(channel.faction[i] ?? 0, localFaction));
          if (kind.capture !== undefined) {
            color.multiplyScalar(OUTPOST_TINT);
          }
          if (state === STATE_SITE) {
            color.multiplyScalar(SITE_DARKEN + progress * (1 - SITE_DARKEN));
          } else if (state === STATE_DEMOLISHING) {
            color.multiplyScalar(DEMOLISH_DARKEN);
          }
        }
        solid.setColorAt(si, color);
        si += 1;
      }
      solid.count = si;
      bpMesh.count = bi;
      // Blueprints pulse while any row is waiting for activation.
      const bpMaterial = bpMesh.material as THREE.MeshBasicMaterial;
      bpMaterial.opacity = nbp > 0 ? pulse : 0.3;
    } else {
      solid.count = 0;
      bpMesh.count = 0;
    }

    if (salvage !== undefined) {
      for (let i = 0; i < salvage.handles.length; i++) {
        const x = salvage.x[i] ?? 0;
        const y = salvage.y[i] ?? 0;
        const groundY = terrainY(heights, mapWidth, mapHeight, x, y);
        dummy.position.set(x, groundY + SALVAGE_SIZE / 2, y);
        dummy.scale.set(SALVAGE_SIZE, SALVAGE_SIZE, SALVAGE_SIZE);
        dummy.updateMatrix();
        crates.setMatrixAt(i, dummy.matrix);
      }
      crates.count = salvage.handles.length;
    } else {
      crates.count = 0;
    }

    solid.instanceMatrix.needsUpdate = true;
    bpMesh.instanceMatrix.needsUpdate = true;
    crates.instanceMatrix.needsUpdate = true;
    if (solid.instanceColor !== null) {
      solid.instanceColor.needsUpdate = true;
    }
    if (bpMesh.instanceColor !== null) {
      bpMesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group>
      <instancedMesh key={`s-${capacity}`} ref={solidRef} args={[undefined, undefined, capacity]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh key={`b-${capacity}`} ref={bpRef} args={[undefined, undefined, capacity]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent opacity={0.3} depthWrite={false} />
      </instancedMesh>
      <instancedMesh key={`c-${capacity}`} ref={crateRef} args={[undefined, undefined, capacity]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color={SALVAGE_COLOR} />
      </instancedMesh>
    </group>
  );
}
