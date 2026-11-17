// Logistics overlay (M3 D), toggled with L and forced on while build
// mode is active: service-coverage tint on the ground, link polylines
// from pathCells (brightness ∝ the 30 s EMA of outBp + inBp, red when
// either direction saturates), and service-radius rings on nodes.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useBuildStore } from '../../../client/build-store';
import type { SimClient } from '../../../client/sim-client';
import { useUiStore } from '../../../client/ui-store';
import type { ContentDb, ResolvedMap } from '../../../content/index';
import { terrainY } from '../../../render/world';
import {
  StructuresChannel,
  STATE_OPERATIONAL,
  type ConstructionStructures,
} from '../../construction/protocol';
import { LogisticsNetworkChannel, SERVICE_LAYER_ID, type LogisticsNetwork } from '../protocol';
import { linkFlow } from './link-flow';

const COVER_COLOR = '#3f7fbf';
const COVER_OPACITY = 0.18;
const LINK_COLOR = new THREE.Color('#7fd4ff');
const LINK_SAT_COLOR = new THREE.Color('#ff5a4f');
const MAX_LINK_VERTS = 8192;
const COVER_CAP = 8192;
const RING_CAP = 64;
const RING_COLOR = '#7fd4ff';
const RING_SEGMENTS = 48;
const LIFT = 0.04;

export interface LogisticsOverlayProps {
  client: SimClient;
  db: ContentDb;
  map: ResolvedMap;
  heights: ArrayLike<number>;
}

export function LogisticsOverlay({ client, db, map, heights }: LogisticsOverlayProps) {
  const toggled = useUiStore((s) => s.logisticsOverlay);
  const placing = useBuildStore((s) => s.kind !== null || s.roadMode);
  const on = toggled || placing;
  const coverRef = useRef<THREE.InstancedMesh>(null);
  const linkRef = useRef<THREE.LineSegments>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const linkGeom = useMemo(() => new THREE.BufferGeometry(), []);
  const linkPosRef = useRef<Float32Array | null>(null);
  const linkColRef = useRef<Float32Array | null>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const cover = coverRef.current;
    const linkLines = linkRef.current;
    const rings = ringRef.current;
    const linkPos = (linkPosRef.current ??= new Float32Array(MAX_LINK_VERTS * 3));
    const linkCol = (linkColRef.current ??= new Float32Array(MAX_LINK_VERTS * 3));
    if (cover === null || linkLines === null || rings === null) {
      return;
    }
    const latest = client.snapshots().latest;
    if (!on || latest === null) {
      cover.count = 0;
      rings.count = 0;
      linkLines.visible = false;
      return;
    }
    const { width, height } = map.grid;
    const observer = latest.observer;
    const service = latest.layers[`${SERVICE_LAYER_ID}#${observer}`] as Uint8Array | undefined;
    const network = latest.channels[LogisticsNetworkChannel.id] as LogisticsNetwork | undefined;
    const structures = latest.channels[StructuresChannel.id] as ConstructionStructures | undefined;

    // Coverage tint: one quad per covered cell.
    let covered = 0;
    if (service !== undefined) {
      for (let y = 0; y < height && covered < COVER_CAP; y++) {
        for (let x = 0; x < width && covered < COVER_CAP; x++) {
          if ((service[y * width + x] ?? 0) === 0) {
            continue;
          }
          dummy.position.set(x + 0.5, terrainY(heights, width, height, x, y) + LIFT, y + 0.5);
          dummy.rotation.set(-Math.PI / 2, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          cover.setMatrixAt(covered, dummy.matrix);
          covered += 1;
        }
      }
    }
    cover.count = covered;
    cover.instanceMatrix.needsUpdate = true;

    // Links: polylines along pathCells, red when saturated, brightness
    // from the smoothed utilization average.
    let verts = 0;
    if (network !== undefined) {
      const links = network.links;
      const smoothed = linkFlow(latest, network);
      for (let i = 0; i < links.a.length && verts < MAX_LINK_VERTS - 2; i++) {
        const flow = Math.min(1, (smoothed.bp[i] ?? 0) / 20000);
        const sat = (links.outSat[i] ?? 0) !== 0 || (links.inSat[i] ?? 0) !== 0;
        color.copy(sat ? LINK_SAT_COLOR : LINK_COLOR).multiplyScalar(0.3 + flow * 0.7);
        const from = links.pathOffsets[i] ?? 0;
        const to = links.pathOffsets[i + 1] ?? 0;
        for (let c = from; c + 1 < to && verts < MAX_LINK_VERTS - 2; c++) {
          const ca = links.pathCells[c] ?? 0;
          const cb = links.pathCells[c + 1] ?? 0;
          const ax = (ca % width) + 0.5;
          const ay = Math.floor(ca / width) + 0.5;
          const bx = (cb % width) + 0.5;
          const by = Math.floor(cb / width) + 0.5;
          const base = verts * 3;
          linkPos[base] = ax;
          linkPos[base + 1] = terrainY(heights, width, height, ax, ay) + LIFT;
          linkPos[base + 2] = ay;
          linkPos[base + 3] = bx;
          linkPos[base + 4] = terrainY(heights, width, height, bx, by) + LIFT;
          linkPos[base + 5] = by;
          linkCol[base] = color.r;
          linkCol[base + 1] = color.g;
          linkCol[base + 2] = color.b;
          linkCol[base + 3] = color.r;
          linkCol[base + 4] = color.g;
          linkCol[base + 5] = color.b;
          verts += 2;
        }
      }
    }
    linkGeom.setAttribute('position', new THREE.BufferAttribute(linkPos.slice(0, verts * 3), 3));
    linkGeom.setAttribute('color', new THREE.BufferAttribute(linkCol.slice(0, verts * 3), 3));
    linkGeom.computeBoundingSphere();
    linkLines.visible = verts > 0;

    // Node rings: service radius around each own completed node (joined
    // to the structures channel for the kind's profile).
    let ringCount = 0;
    if (structures !== undefined) {
      for (let i = 0; i < structures.handles.length; i++) {
        if (
          (structures.faction[i] ?? 0) !== observer ||
          (structures.state[i] ?? 0) !== STATE_OPERATIONAL
        ) {
          continue;
        }
        const kind = db.structures.byIndex(structures.kind[i] ?? 0);
        if (kind?.node === undefined) {
          continue;
        }
        const cx = (structures.x[i] ?? 0) + kind.footprint.w / 2;
        const cy = (structures.y[i] ?? 0) + kind.footprint.h / 2;
        dummy.position.set(cx, terrainY(heights, width, height, cx, cy) + LIFT + 0.01, cy);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(kind.node.service, kind.node.service, 1);
        dummy.updateMatrix();
        rings.setMatrixAt(ringCount, dummy.matrix);
        ringCount += 1;
      }
    }
    rings.count = ringCount;
    rings.instanceMatrix.needsUpdate = true;
  });

  return (
    <group visible={on}>
      <instancedMesh ref={coverRef} args={[undefined, undefined, COVER_CAP]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          color={COVER_COLOR}
          transparent
          opacity={COVER_OPACITY}
          depthWrite={false}
        />
      </instancedMesh>
      <lineSegments ref={linkRef} geometry={linkGeom} visible={false}>
        <lineBasicMaterial vertexColors transparent opacity={0.9} />
      </lineSegments>
      <instancedMesh ref={ringRef} args={[undefined, undefined, RING_CAP]}>
        <ringGeometry args={[0.95, 1, RING_SEGMENTS]} />
        <meshBasicMaterial color={RING_COLOR} transparent opacity={0.5} side={THREE.DoubleSide} />
      </instancedMesh>
    </group>
  );
}
