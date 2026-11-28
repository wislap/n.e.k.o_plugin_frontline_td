// Build ghost (ADR 0025, ADR 0050, M2B 1.5a/1.5c): pure renderer reading
// interactionStore.ghost (computed in ghost-sync.ts). Draws the chamfered
// silhouette box plus isolated connect/service/weapon rings and dashed
// predicted node links.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useInteractionStore } from '../../../client/interaction-store';
import type { SimClient } from '../../../client/sim-client';
import type { ContentDb } from '../../../content/index';
import { createDashRingMaterial, type DashRingMaterial } from '../../../render/dash-ring';
import { createHoloMaterial, type HoloMaterial } from '../../../render/holo-material';
import {
  commitLineBuffer,
  commitLineDistances,
  createLineBuffer,
  type LineBuffer,
} from '../../../render/line-buffer';
import type { SceneLayerProps } from '../../../render/scene';
import { VISUAL } from '../../../render/theme/index';
import { bindGeometry, useGpuResource } from '../../../render/use-gpu-resource';
import { terrainY } from '../../../client/world';
import { STATE_OPERATIONAL, StructuresChannel } from '../protocol';
import { createSilhouetteGeometries, type SilhouetteGeometries } from './structure-geometries';
import { structureKindHeight } from './structure-gpu';
import { renderNowMs } from '../../../client/capture-mode';
import { readChannel } from '../../../core/index';

const ATTACH_MATERIAL = 'material';

const CIRCLE_SEGMENTS = 64;
const MAX_LINK_SEGS = 64;

interface GhostFrameTargets {
  box: THREE.Mesh;
  connectRing: THREE.Mesh;
  serviceRing: THREE.Mesh;
  serviceDisc: THREE.Mesh;
  weaponRing: THREE.Mesh;
  links: THREE.LineSegments;
  holoMat: HoloMaterial;
  dashConnectMat: DashRingMaterial;
  dashServiceMat: DashRingMaterial;
  dashWeaponMat: DashRingMaterial;
  geos: SilhouetteGeometries;
  linkBuf: LineBuffer;
  client: SimClient;
  db: ContentDb;
  mapWidth: number;
  mapHeight: number;
  heights: ArrayLike<number>;
  accentColor: string;
  invalidColor: string;
}

function updateGhostFrame(t: GhostFrameTargets): void {
  const timeSec = renderNowMs() / 1000;
  t.holoMat.uniforms.uTime.value = timeSec;
  t.dashConnectMat.uniforms.uTime.value = timeSec;
  t.dashServiceMat.uniforms.uTime.value = timeSec;
  t.dashWeaponMat.uniforms.uTime.value = timeSec;

  const interaction = useInteractionStore.getState();
  const kindId = interaction.tool.kind === 'place' ? interaction.tool.structureKindId : null;
  const kind = kindId === null ? undefined : t.db.structures.byId(kindId);
  const snapshot = t.client.snapshots().latest;
  const ghost = interaction.ghost;
  if (kind === undefined || snapshot === null || ghost === null) {
    t.box.visible = false;
    t.connectRing.visible = false;
    t.serviceRing.visible = false;
    t.serviceDisc.visible = false;
    t.weaponRing.visible = false;
    t.links.visible = false;
    return;
  }

  t.box.visible = true;
  const w = kind.footprint.w;
  const h = kind.footprint.h;
  const tx = ghost.x;
  const ty = ghost.y;
  const ok = ghost.code === 'ok';

  const cx = tx + w / 2;
  const cy = ty + h / 2;
  const groundY = terrainY(t.heights, t.mapWidth, t.mapHeight, cx, cy);
  const height = structureKindHeight(t.db, kind.index);
  bindGeometry(t.box, t.geos[kind.visual.silhouette]);
  t.box.position.set(cx, groundY, cy);
  t.box.scale.set(w * 0.92, height, h * 0.92);
  t.holoMat.uniforms.uBad.value = ok ? 0 : 1;

  const hasNode = kind.node !== undefined;
  t.connectRing.visible = hasNode;
  if (kind.node !== undefined) {
    // Connect radius is stored in cost units (cells × 10).
    const radius = kind.node.connect / 10;
    t.connectRing.position.set(cx, groundY + 0.06, cy);
    t.connectRing.scale.set(radius, radius, 1);

    // Dashed predicted links to own completed nodes inside the radius.
    const positions = t.linkBuf.positions;
    const channel = readChannel(snapshot, StructuresChannel) ?? undefined;
    let segs = 0;
    if (channel !== undefined) {
      for (let i = 0; i < channel.handles.length && segs < MAX_LINK_SEGS; i++) {
        if (
          (channel.faction[i] ?? 0) !== snapshot.observer ||
          (channel.state[i] ?? 0) !== STATE_OPERATIONAL
        ) {
          continue;
        }
        const other = t.db.structures.byIndex(channel.kind[i] ?? 0);
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
        positions[base + 4] = terrainY(t.heights, t.mapWidth, t.mapHeight, ox, oy) + 0.062;
        positions[base + 5] = oy;
        segs += 1;
      }
    }
    const vertCount = segs * 2;
    commitLineBuffer(t.linkBuf, vertCount);
    if (vertCount > 0) {
      commitLineDistances(t.linkBuf, vertCount);
    }
    t.links.visible = segs > 0;
  } else {
    t.links.visible = false;
  }

  const hasService = kind.node !== undefined && kind.node.service > 0;
  t.serviceRing.visible = hasService;
  t.serviceDisc.visible = hasService;
  if (kind.node !== undefined && kind.node.service > 0) {
    const sr = kind.node.service;
    t.serviceRing.position.set(cx, groundY + 0.059, cy);
    t.serviceRing.scale.set(sr, sr, 1);
    t.serviceDisc.position.set(cx, groundY + 0.058, cy);
    t.serviceDisc.scale.set(sr, sr, 1);
  }

  const hasWeapon = kind.weapon !== undefined && kind.weapon.range > 0;
  t.weaponRing.visible = hasWeapon;
  if (kind.weapon !== undefined && kind.weapon.range > 0) {
    const wr = kind.weapon.range;
    t.weaponRing.position.set(cx, groundY + 0.061, cy);
    t.weaponRing.scale.set(wr, wr, 1);
    t.dashWeaponMat.uniforms.uColor.value.set(ok ? t.accentColor : t.invalidColor);
  }
}

export function GhostPreview({ ctx }: SceneLayerProps) {
  const { client, db, map, heights } = ctx;
  const theme = VISUAL;
  const boxRef = useRef<THREE.Mesh>(null);
  const connectRingRef = useRef<THREE.Mesh>(null);
  const serviceRingRef = useRef<THREE.Mesh>(null);
  const serviceDiscRef = useRef<THREE.Mesh>(null);
  const weaponRingRef = useRef<THREE.Mesh>(null);
  const linksRef = useRef<THREE.LineSegments>(null);

  const holoMat = useMemo(
    () => createHoloMaterial(theme.markers.accent, theme.markers.invalid),
    [theme],
  );
  useGpuResource(holoMat);

  const dashConnectMat = useMemo(() => createDashRingMaterial(theme.markers.accent), [theme]);
  useGpuResource(dashConnectMat);

  const dashServiceMat = useMemo(() => createDashRingMaterial(theme.markers.secondary), [theme]);
  useGpuResource(dashServiceMat);

  const dashWeaponMat = useMemo(() => createDashRingMaterial(theme.markers.accent), [theme]);
  useGpuResource(dashWeaponMat);

  const geos = useMemo(
    () => createSilhouetteGeometries(theme.geometry.bevel),
    [theme.geometry.bevel],
  );
  useGpuResource(geos);

  const linkBuf = useMemo(() => createLineBuffer(MAX_LINK_SEGS * 2, false, true), []);
  useGpuResource(linkBuf.geometry);

  useFrame(() => {
    const box = boxRef.current;
    const connectRing = connectRingRef.current;
    const serviceRing = serviceRingRef.current;
    const serviceDisc = serviceDiscRef.current;
    const weaponRing = weaponRingRef.current;
    const links = linksRef.current;
    if (
      box === null ||
      connectRing === null ||
      serviceRing === null ||
      serviceDisc === null ||
      weaponRing === null ||
      links === null
    ) {
      return;
    }
    updateGhostFrame({
      box,
      connectRing,
      serviceRing,
      serviceDisc,
      weaponRing,
      links,
      holoMat,
      dashConnectMat,
      dashServiceMat,
      dashWeaponMat,
      geos,
      linkBuf,
      client,
      db,
      mapWidth: map.grid.width,
      mapHeight: map.grid.height,
      heights,
      accentColor: theme.markers.accent,
      invalidColor: theme.markers.invalid,
    });
  });

  return (
    <group>
      <mesh ref={boxRef} geometry={geos.block} visible={false} frustumCulled={false}>
        <primitive object={holoMat} attach={ATTACH_MATERIAL} />
      </mesh>
      <mesh
        ref={connectRingRef}
        visible={false}
        rotation={[-Math.PI / 2, 0, 0]}
        frustumCulled={false}
      >
        <ringGeometry args={[0.8, 1, CIRCLE_SEGMENTS]} />
        <primitive object={dashConnectMat} attach={ATTACH_MATERIAL} />
      </mesh>
      <mesh
        ref={serviceRingRef}
        visible={false}
        rotation={[-Math.PI / 2, 0, 0]}
        frustumCulled={false}
      >
        <ringGeometry args={[0.8, 1, CIRCLE_SEGMENTS]} />
        <primitive object={dashServiceMat} attach={ATTACH_MATERIAL} />
      </mesh>
      <mesh
        ref={serviceDiscRef}
        visible={false}
        rotation={[-Math.PI / 2, 0, 0]}
        frustumCulled={false}
      >
        <circleGeometry args={[1, CIRCLE_SEGMENTS]} />
        <meshBasicMaterial
          color={theme.markers.accent}
          transparent
          opacity={0.05}
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
        <ringGeometry args={[0.8, 1, CIRCLE_SEGMENTS]} />
        <primitive object={dashWeaponMat} attach={ATTACH_MATERIAL} />
      </mesh>
      <lineSegments
        ref={linksRef}
        geometry={linkBuf.geometry}
        visible={false}
        frustumCulled={false}
      >
        <lineDashedMaterial color={theme.markers.link} dashSize={0.5} gapSize={0.35} />
      </lineSegments>
    </group>
  );
}
