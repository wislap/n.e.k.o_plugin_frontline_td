// Build ghost (ADR 0025, ADR 0050): translucent footprint box that follows
// the cursor, snapped to cells with the footprint centred on the cursor cell.
// Green when placement rules pass, red otherwise; the failing reason is
// mirrored into the interaction store for the HUD. Node kinds draw both
// the connect-radius ring (with dashed predicted links to own completed
// nodes) and the service-radius ring + translucent disc; armed kinds draw
// the weapon-range ring.
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { cursorState } from '../../../client/cursor';
import { useInteractionStore } from '../../../client/interaction-store';
import type { SimClient } from '../../../client/sim-client';
import type { ContentDb, ResolvedMap } from '../../../content/index';
import { commitLineBuffer, createLineBuffer, type LineBuffer } from '../../../render/line-buffer';
import { terrainY } from '../../../render/world';
import type { StructureSilhouette } from '../content';
import { STATE_OPERATIONAL, StructuresChannel, type ConstructionStructures } from '../protocol';
import {
  centeredFootprint,
  checkFootprint,
  checkRange,
  makePlacementView,
  type PlacementRule,
} from '../rules/index';
import { createSilhouetteGeometries, disposeSilhouetteGeometries } from './structure-geometries';
import { structureKindHeight } from './StructuresLayer';

const GHOST_OK = '#4dff7a';
const GHOST_BAD = '#ff5a4f';
const CONNECT_COLOR = '#7fd4ff';
const SERVICE_COLOR = '#3ddc97';
const WEAPON_OK_COLOR = '#5cc8ff';
const WEAPON_BAD_COLOR = '#ff5c5c';
const RING_SEGMENTS = 48;
const CIRCLE_SEGMENTS = 64;

function ensureLinkBuffer(
  linkBufRef: { current: LineBuffer | null },
  links: THREE.LineSegments,
): LineBuffer {
  linkBufRef.current ??= createLineBuffer(64 * 2, false);
  const buf = linkBufRef.current;
  if (links.geometry !== buf.geometry) {
    links.geometry.dispose();
    links.geometry = buf.geometry;
  }
  return buf;
}

function setWeaponRingColor(material: THREE.MeshBasicMaterial, ok: boolean): void {
  material.color.set(ok ? WEAPON_OK_COLOR : WEAPON_BAD_COLOR);
}

function bindSilhouetteGeometry(
  geosRef: { current: Record<StructureSilhouette, THREE.BufferGeometry> | null },
  placeholderDisposedRef: { current: boolean },
  box: THREE.Mesh,
  silhouette: StructureSilhouette,
): void {
  geosRef.current ??= createSilhouetteGeometries();
  const geo = geosRef.current[silhouette];
  if (!placeholderDisposedRef.current) {
    box.geometry.dispose();
    placeholderDisposedRef.current = true;
  }
  if (box.geometry !== geo) {
    box.geometry = geo;
  }
}

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
  const connectRingRef = useRef<THREE.Mesh>(null);
  const serviceRingRef = useRef<THREE.Mesh>(null);
  const serviceDiscRef = useRef<THREE.Mesh>(null);
  const weaponRingRef = useRef<THREE.Mesh>(null);
  const weaponMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const linksRef = useRef<THREE.LineSegments>(null);
  const linkBufRef = useRef<LineBuffer | null>(null);
  const geosRef = useRef<Record<StructureSilhouette, THREE.BufferGeometry> | null>(null);
  const placeholderDisposedRef = useRef(false);
  const lastGhost = useRef<string>('');

  useEffect(() => {
    return () => {
      linkBufRef.current?.geometry.dispose();
      linkBufRef.current = null;
      if (geosRef.current !== null) {
        disposeSilhouetteGeometries(geosRef.current);
        geosRef.current = null;
      }
    };
  }, []);

  useFrame(() => {
    const box = boxRef.current;
    const material = boxMat.current;
    const connectRing = connectRingRef.current;
    const serviceRing = serviceRingRef.current;
    const serviceDisc = serviceDiscRef.current;
    const weaponRing = weaponRingRef.current;
    const weaponMat = weaponMatRef.current;
    const links = linksRef.current;
    if (
      box === null ||
      material === null ||
      connectRing === null ||
      serviceRing === null ||
      serviceDisc === null ||
      weaponRing === null ||
      weaponMat === null ||
      links === null
    ) {
      return;
    }

    const linkBuf = ensureLinkBuffer(linkBufRef, links);
    const positions = linkBuf.positions;
    const interaction = useInteractionStore.getState();
    const kindId = interaction.tool.kind === 'place' ? interaction.tool.structureKindId : null;
    const kind = kindId === null ? undefined : db.structures.byId(kindId);
    const snapshot = client.snapshots().latest;
    const ground = cursorState.ground();
    if (kind === undefined || snapshot === null || !ground.valid) {
      box.visible = false;
      connectRing.visible = false;
      serviceRing.visible = false;
      serviceDisc.visible = false;
      weaponRing.visible = false;
      links.visible = false;
      if (interaction.ghost !== null) {
        interaction.setGhost(null);
      }
      return;
    }

    box.visible = true;
    const w = kind.footprint.w;
    const h = kind.footprint.h;
    const { x: tx, y: ty } = centeredFootprint(ground.x, ground.y, kind.footprint);
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
    bindSilhouetteGeometry(geosRef, placeholderDisposedRef, box, kind.visual.silhouette);
    box.position.set(cx, groundY, cy);
    box.scale.set(w * 0.92, height, h * 0.92);
    material.color.set(ok ? GHOST_OK : GHOST_BAD);

    // Mirror the ghost state for the HUD reason line (only on change).
    const key = `${tx},${ty},${code}`;
    if (key !== lastGhost.current) {
      lastGhost.current = key;
      interaction.setGhost({ x: tx, y: ty, code });
    }

    const hasNode = kind.node !== undefined;
    connectRing.visible = hasNode;
    if (kind.node !== undefined) {
      // Connect radius is stored in cost units (cells × 10).
      const radius = kind.node.connect / 10;
      connectRing.position.set(cx, groundY + 0.06, cy);
      connectRing.scale.set(radius, radius, 1);

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
          positions[base + 1] = groundY + 0.062;
          positions[base + 2] = cy;
          positions[base + 3] = ox;
          positions[base + 4] = terrainY(heights, map.grid.width, map.grid.height, ox, oy) + 0.062;
          positions[base + 5] = oy;
          segs += 1;
        }
      }
      commitLineBuffer(linkBuf, segs * 2);
      // lineDistance attribute required by the dashed material.
      links.computeLineDistances();
      links.visible = segs > 0;
    } else {
      links.visible = false;
    }

    const hasService = kind.node !== undefined && kind.node.service > 0;
    serviceRing.visible = hasService;
    serviceDisc.visible = hasService;
    if (kind.node !== undefined && kind.node.service > 0) {
      const sr = kind.node.service;
      serviceRing.position.set(cx, groundY + 0.059, cy);
      serviceRing.scale.set(sr, sr, 1);
      serviceDisc.position.set(cx, groundY + 0.058, cy);
      serviceDisc.scale.set(sr, sr, 1);
    }

    const hasWeapon = kind.weapon !== undefined && kind.weapon.range > 0;
    weaponRing.visible = hasWeapon;
    if (kind.weapon !== undefined && kind.weapon.range > 0) {
      const wr = kind.weapon.range;
      weaponRing.position.set(cx, groundY + 0.061, cy);
      weaponRing.scale.set(wr, wr, 1);
      setWeaponRingColor(weaponMat, ok);
    }
  });

  return (
    <group>
      <mesh ref={boxRef} visible={false} frustumCulled={false}>
        <meshBasicMaterial ref={boxMat} transparent opacity={0.4} depthWrite={false} />
      </mesh>
      <mesh
        ref={connectRingRef}
        visible={false}
        rotation={[-Math.PI / 2, 0, 0]}
        frustumCulled={false}
      >
        <ringGeometry args={[0.96, 1, RING_SEGMENTS]} />
        <meshBasicMaterial
          color={CONNECT_COLOR}
          transparent
          opacity={0.8}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh
        ref={serviceRingRef}
        visible={false}
        rotation={[-Math.PI / 2, 0, 0]}
        frustumCulled={false}
      >
        <ringGeometry args={[0.97, 1, CIRCLE_SEGMENTS]} />
        <meshBasicMaterial
          color={SERVICE_COLOR}
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh
        ref={serviceDiscRef}
        visible={false}
        rotation={[-Math.PI / 2, 0, 0]}
        frustumCulled={false}
      >
        <circleGeometry args={[1, CIRCLE_SEGMENTS]} />
        <meshBasicMaterial
          color={SERVICE_COLOR}
          transparent
          opacity={0.09}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh
        ref={weaponRingRef}
        visible={false}
        rotation={[-Math.PI / 2, 0, 0]}
        frustumCulled={false}
      >
        <ringGeometry args={[0.975, 1, CIRCLE_SEGMENTS]} />
        <meshBasicMaterial
          ref={weaponMatRef}
          color={WEAPON_OK_COLOR}
          transparent
          opacity={0.72}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments ref={linksRef} visible={false} frustumCulled={false}>
        <lineDashedMaterial color={CONNECT_COLOR} dashSize={0.5} gapSize={0.35} />
      </lineSegments>
    </group>
  );
}
