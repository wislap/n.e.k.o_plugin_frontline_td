// Build ghost (M3 D): translucent footprint box that follows the cursor,
// snapped to cells with the footprint centred on the cursor cell. Green
// when the shared placement rules pass, red otherwise; the failing reason
// is mirrored into the build store for the HUD. Node kinds also draw the
// connect-radius ring and dashed predicted links to own completed nodes.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useBuildStore } from '../../../client/build-store';
import { cursorGround } from '../../../client/cursor';
import { makePlacementView } from '../rules/index';
import type { SimClient } from '../../../client/sim-client';
import type { ContentDb, ResolvedMap } from '../../../content/index';
import { terrainY } from '../../../render/world';
import { checkFootprint, checkRange, type PlacementRule } from '../rules/index';
import { StructuresChannel, STATE_OPERATIONAL, type ConstructionStructures } from '../protocol';
import { structureKindHeight } from './StructuresLayer';

const GHOST_OK = '#4dff7a';
const GHOST_BAD = '#ff5a4f';
const RING_COLOR = '#7fd4ff';
const RING_SEGMENTS = 48;

export interface GhostPreviewProps {
  client: SimClient;
  db: ContentDb;
  map: ResolvedMap;
  heights: ArrayLike<number>;
  // Hostility from the match relations (observer, faction) → bool.
  isHostile: (observer: number, faction: number) => boolean;
}

export function GhostPreview({ client, db, map, heights, isHostile }: GhostPreviewProps) {
  const boxRef = useRef<THREE.Mesh>(null);
  const boxMat = useRef<THREE.MeshBasicMaterial>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const linksRef = useRef<THREE.LineSegments>(null);
  const linkGeom = useMemo(() => new THREE.BufferGeometry(), []);
  const linkPositions = useRef<Float32Array | null>(null);
  const lastGhost = useRef<string>('');

  useFrame(() => {
    const box = boxRef.current;
    const material = boxMat.current;
    const ring = ringRef.current;
    const links = linksRef.current;
    const positions = (linkPositions.current ??= new Float32Array(64 * 6));
    if (box === null || material === null || ring === null || links === null) {
      return;
    }
    const kindId = useBuildStore.getState().kind;
    const kind = kindId === null ? undefined : db.structures.byId(kindId);
    const snapshot = client.snapshots().latest;
    if (kind === undefined || snapshot === null || !cursorGround.valid) {
      box.visible = false;
      ring.visible = false;
      links.visible = false;
      if (useBuildStore.getState().ghost !== null) {
        useBuildStore.getState().setGhost(null);
      }
      return;
    }
    box.visible = true;
    ring.visible = kind.node !== undefined;
    links.visible = ring.visible;

    const w = kind.footprint.w;
    const h = kind.footprint.h;
    const tx = Math.floor(cursorGround.x - w / 2);
    const ty = Math.floor(cursorGround.y - h / 2);
    const view = makePlacementView(db, map, snapshot, snapshot.observer, (f) =>
      isHostile(snapshot.observer, f),
    );
    const rule: PlacementRule = {
      w,
      h,
      node: kind.node !== undefined,
      connect: kind.node?.connect ?? 0,
      requiresDeposit: kind.requiresDeposit ?? -1,
    };
    const fc = checkFootprint(rule, tx, ty, view);
    const code = fc === 'ok' ? checkRange(rule, tx, ty, view) : fc;
    const ok = code === 'ok';

    const cx = tx + w / 2;
    const cy = ty + h / 2;
    const groundY = terrainY(heights, map.grid.width, map.grid.height, cx, cy);
    const height = structureKindHeight(db, kind.index);
    box.position.set(cx, groundY + height / 2, cy);
    box.scale.set(w, height, h);
    material.color.set(ok ? GHOST_OK : GHOST_BAD);

    // Mirror the ghost state for the HUD reason line (only on change).
    const key = `${tx},${ty},${code}`;
    if (key !== lastGhost.current) {
      lastGhost.current = key;
      useBuildStore.getState().setGhost({ x: tx, y: ty, code });
    }

    if (kind.node !== undefined) {
      // Connect radius is stored in cost units (cells × 10).
      const radius = kind.node.connect / 10;
      ring.position.set(cx, groundY + 0.05, cy);
      ring.scale.set(radius, radius, 1);
      // Dashed predicted links to own completed nodes inside the radius.
      const channel = snapshot.channels[StructuresChannel.id] as ConstructionStructures | undefined;
      let segs = 0;
      if (channel !== undefined) {
        for (let i = 0; i < channel.handles.length && segs < 64; i++) {
          if (
            (channel.faction[i] ?? 0) !== snapshot.observer ||
            (channel.state[i] ?? 0) !== STATE_OPERATIONAL
          ) {
            continue;
          }
          const other = db.structures.byIndex(channel.kind[i] ?? 0);
          if (other?.node === undefined) {
            continue;
          }
          const ox = (channel.x[i] ?? 0) + other.footprint.w / 2;
          const oy = (channel.y[i] ?? 0) + other.footprint.h / 2;
          const d = Math.hypot(ox - cx, oy - cy);
          if (d * 10 > Math.min(kind.node.connect, other.node.connect)) {
            continue;
          }
          const base = segs * 6;
          positions[base] = cx;
          positions[base + 1] = groundY + 0.06;
          positions[base + 2] = cy;
          positions[base + 3] = ox;
          positions[base + 4] = terrainY(heights, map.grid.width, map.grid.height, ox, oy) + 0.06;
          positions[base + 5] = oy;
          segs += 1;
        }
      }
      linkGeom.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, segs * 6), 3));
      linkGeom.computeBoundingSphere();
      // lineDistance attribute required by the dashed material.
      links.computeLineDistances();
      links.visible = segs > 0;
    }
  });

  return (
    <group>
      <mesh ref={boxRef} visible={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial ref={boxMat} transparent opacity={0.4} depthWrite={false} />
      </mesh>
      <mesh ref={ringRef} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.96, 1, RING_SEGMENTS]} />
        <meshBasicMaterial color={RING_COLOR} transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments ref={linksRef} geometry={linkGeom} visible={false}>
        <lineDashedMaterial color={RING_COLOR} dashSize={0.5} gapSize={0.35} />
      </lineSegments>
    </group>
  );
}
