// Logistics overlay (M3 D), toggled with L and forced on while build
// mode is active: terrain-conforming service-coverage tint on the ground,
// link polylines from pathCells (brightness ∝ the 30 s EMA of outBp + inBp,
// red when either direction saturates), and service-radius rings on nodes.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useInspectorStore } from '../../../client/inspector-store';
import { useInteractionStore } from '../../../client/interaction-store';
import { useSelectionStore } from '../../../client/selection-store';
import type { SimClient } from '../../../client/sim-client';
import { useUiStore } from '../../../client/ui-store';
import type { ContentDb, ResolvedMap } from '../../../content/index';
import { readChannel, readLayer } from '../../../core/index';
import type { Snapshot } from '../../../core/index';
import { createCoverMaterial, type CoverMaterial } from '../../../render/cover-material';
import { createDashRingMaterial, type DashRingMaterial } from '../../../render/dash-ring';
import { commitLineBuffer, createLineBuffer, type LineBuffer } from '../../../render/line-buffer';
import { VISUAL } from '../../../render/theme/index';
import { terrainY } from '../../../render/world';
import {
  StructuresChannel,
  STATE_OPERATIONAL,
  type ConstructionStructures,
} from '../../construction/protocol';
import { buildTerrainGeometry } from '../../terrain/render/index';
import { LogisticsNetworkChannel, SERVICE_LAYER_ID, type LogisticsNetwork } from '../protocol';
import { linkFlow } from './link-flow';
import { renderNowMs } from '../../../client/capture-mode';

const ATTACH_MATERIAL = 'material';

const COVER_COLOR = '#3f7fbf';
const COVER_ALPHA = Math.round(0.22 * 255);
const COVER_LIFT = 0.038;
const LINK_SAT_COLOR = new THREE.Color('#ff5a4f');
const MAX_LINK_VERTS = 8192;
const RING_CAP = 64;
const RING_SEGMENTS = 48;
const LIFT = 0.05;

interface BuiltCover {
  geometry: THREE.BufferGeometry;
  texture: THREE.DataTexture;
}

function buildCover(
  map: ResolvedMap,
  mesh: THREE.Mesh,
  material: THREE.MeshBasicMaterial,
): BuiltCover {
  const grid = map.grid;
  const data = buildTerrainGeometry(
    grid.width,
    grid.height,
    grid.heights,
    grid.surfaces,
    grid.ramps,
    [{ r: 1, g: 1, b: 1 }],
  );
  for (let i = 1; i < data.positions.length; i += 3) {
    data.positions[i] = (data.positions[i] ?? 0) + COVER_LIFT;
  }
  const uvs = new Float32Array((data.positions.length / 3) * 2);
  for (let i = 0; i < data.positions.length; i += 3) {
    uvs[(i / 3) * 2] = (data.positions[i] ?? 0) / grid.width;
    uvs[(i / 3) * 2 + 1] = (data.positions[i + 2] ?? 0) / grid.height;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  const texData = new Uint8Array(grid.width * grid.height * 4);
  const texture = new THREE.DataTexture(texData, grid.width, grid.height, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  mesh.geometry = geometry;
  material.alphaMap = texture;
  material.needsUpdate = true;
  return { geometry, texture };
}

// Red channel = coverage mask for the themed contour shader; green = the
// legacy flat alphaMap value. Both are written on every upload so either
// material can bind the same texture.
function uploadServiceCoverage(
  texture: THREE.DataTexture,
  layer: ArrayLike<number> | undefined,
  cells: number,
): void {
  const buf = texture.image.data as Uint8Array;
  for (let i = 0; i < cells; i++) {
    const covered = (layer?.[i] ?? 0) !== 0;
    buf[i * 4] = covered ? 255 : 0;
    buf[i * 4 + 1] = covered ? COVER_ALPHA : 0;
    buf[i * 4 + 2] = 0;
    buf[i * 4 + 3] = 255;
  }
  texture.needsUpdate = true;
}

function updateLinks(
  linkLines: THREE.LineSegments,
  linkBuf: LineBuffer,
  latest: Snapshot,
  network: LogisticsNetwork | undefined,
  width: number,
  height: number,
  heights: ArrayLike<number>,
  scratchColor: THREE.Color,
  dashTime: number,
  linkColor: THREE.Color,
): void {
  linkLines.geometry = linkBuf.geometry;
  const linkPos = linkBuf.positions;
  const linkCol = linkBuf.colors;
  if (linkCol === null) {
    return;
  }
  let verts = 0;
  if (network !== undefined) {
    const links = network.links;
    const smoothed = linkFlow(latest, network);
    for (let i = 0; i < links.a.length && verts < MAX_LINK_VERTS - 2; i++) {
      const flow = Math.min(1, (smoothed.bp[i] ?? 0) / 20000);
      const sat = (links.outSat[i] ?? 0) !== 0 || (links.inSat[i] ?? 0) !== 0;
      scratchColor
        .copy(sat ? LINK_SAT_COLOR : linkColor)
        .multiplyScalar(0.3 + flow * 0.7)
        .multiplyScalar(1.4);
      const from = links.pathOffsets[i] ?? 0;
      const to = links.pathOffsets[i + 1] ?? 0;
      for (let c = from; c + 1 < to && verts < MAX_LINK_VERTS - 2; c++) {
        // Flowing dashes: cells scroll toward the destination endpoint.
        const phase = (((c - from - dashTime * 2) % 2.2) + 2.2) % 2.2;
        if (phase > 1.1) {
          continue;
        }
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
        linkCol[base] = scratchColor.r;
        linkCol[base + 1] = scratchColor.g;
        linkCol[base + 2] = scratchColor.b;
        linkCol[base + 3] = scratchColor.r;
        linkCol[base + 4] = scratchColor.g;
        linkCol[base + 5] = scratchColor.b;
        verts += 2;
      }
    }
  }
  commitLineBuffer(linkBuf, verts);
  linkLines.visible = verts > 0;
}

function updateRings(
  rings: THREE.InstancedMesh,
  structures: ConstructionStructures | undefined,
  observer: number,
  db: ContentDb,
  width: number,
  height: number,
  heights: ArrayLike<number>,
  scratchDummy: THREE.Object3D,
  focus: ReadonlySet<number> | null,
): void {
  let ringCount = 0;
  if (structures !== undefined) {
    for (let i = 0; i < structures.handles.length; i++) {
      if (
        (structures.faction[i] ?? 0) !== observer ||
        (structures.state[i] ?? 0) !== STATE_OPERATIONAL
      ) {
        continue;
      }
      // Themed: range rings only on hovered/pinned/selected structures.
      if (focus !== null && !focus.has(structures.handles[i] ?? 0)) {
        continue;
      }
      const kind = db.structures.byIndex(structures.kind[i] ?? 0);
      if (kind?.node === undefined) {
        continue;
      }
      const cx = (structures.x[i] ?? 0) + kind.footprint.w / 2;
      const cy = (structures.y[i] ?? 0) + kind.footprint.h / 2;
      scratchDummy.position.set(cx, terrainY(heights, width, height, cx, cy) + LIFT + 0.002, cy);
      scratchDummy.rotation.set(-Math.PI / 2, 0, 0);
      scratchDummy.scale.set(kind.node.service, kind.node.service, 1);
      scratchDummy.updateMatrix();
      rings.setMatrixAt(ringCount, scratchDummy.matrix);
      ringCount += 1;
    }
  }
  rings.count = ringCount;
  rings.instanceMatrix.needsUpdate = true;
}

export interface LogisticsOverlayProps {
  client: SimClient;
  db: ContentDb;
  map: ResolvedMap;
  heights: ArrayLike<number>;
}

export function LogisticsOverlay({ client, db, map, heights }: LogisticsOverlayProps) {
  const theme = VISUAL;
  const toggled = useUiStore((s) => s.logisticsOverlay);
  const modeOn = useInteractionStore((s) => s.mode === 'logistics' || s.tool.kind === 'place');
  const on = toggled || modeOn;
  const coverMeshRef = useRef<THREE.Mesh>(null);
  const coverMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const coverBuiltRef = useRef<BuiltCover | null>(null);
  const coverBuiltForRef = useRef<{
    map: ResolvedMap;
    layer: ArrayLike<number> | undefined | null;
  }>({
    map,
    layer: null,
  });
  const linkRef = useRef<THREE.LineSegments>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const linkBufRef = useRef<LineBuffer | null>(null);
  const dummyRef = useRef<THREE.Object3D | null>(null);
  const colorRef = useRef<THREE.Color | null>(null);
  const linkColorRef = useRef(new THREE.Color('#7fd4ff'));
  const ringDashMatRef = useRef<DashRingMaterial | null>(null);
  const ringDashMat = useMemo(() => createDashRingMaterial(theme.markers.accent), [theme]);
  const focusSetRef = useRef(new Set<number>());

  const coverShaderRef = useRef<CoverMaterial | null>(null);
  const coverShader = useMemo(() => createCoverMaterial(theme.markers.link), [theme]);

  useEffect(() => {
    return () => {
      coverBuiltRef.current?.geometry.dispose();
      coverBuiltRef.current?.texture.dispose();
      coverBuiltRef.current = null;
      linkBufRef.current?.geometry.dispose();
      linkBufRef.current = null;
    };
  }, []);
  useEffect(() => {
    ringDashMatRef.current = ringDashMat;
    return () => {
      ringDashMat.dispose();
    };
  }, [ringDashMat]);
  useEffect(() => {
    coverShaderRef.current = coverShader;
    return () => {
      coverShader.dispose();
    };
  }, [coverShader]);

  useFrame(() => {
    const coverMesh = coverMeshRef.current;
    const coverMat = coverMatRef.current;
    const linkLines = linkRef.current;
    const rings = ringRef.current;
    if (coverMesh === null || coverMat === null || linkLines === null || rings === null) {
      return;
    }
    if (coverBuiltRef.current === null || coverBuiltForRef.current.map !== map) {
      coverBuiltRef.current?.geometry.dispose();
      coverBuiltRef.current?.texture.dispose();
      coverBuiltRef.current = buildCover(map, coverMesh, coverMat);
      coverBuiltForRef.current.map = map;
      coverBuiltForRef.current.layer = null;
    }
    const coverShaderMat = coverShaderRef.current;
    if (coverShaderMat === null) {
      return;
    }
    linkColorRef.current.set(theme.markers.link);
    coverShaderMat.uniforms.uCover.value = coverBuiltRef.current.texture;
    coverShaderMat.uniforms.uColor.value.set(theme.markers.link);
    coverMesh.material = coverShaderMat;

    const ringDash = ringDashMatRef.current;
    if (ringDash !== null) {
      ringDash.uniforms.uTime.value = renderNowMs() / 1000;
      ringDash.uniforms.uColor.value.set(theme.markers.accent);
    }
    linkBufRef.current ??= createLineBuffer(MAX_LINK_VERTS, true);
    dummyRef.current ??= new THREE.Object3D();
    colorRef.current ??= new THREE.Color();

    const latest = client.snapshots().latest;
    if (!on || latest === null) {
      coverMesh.visible = false;
      rings.count = 0;
      linkLines.visible = false;
      return;
    }

    const { width, height } = map.grid;
    const observer = latest.observer;
    const service = readLayer(latest, `${SERVICE_LAYER_ID}#${observer}`) ?? undefined;
    if (service !== coverBuiltForRef.current.layer) {
      coverBuiltForRef.current.layer = service;
      uploadServiceCoverage(coverBuiltRef.current.texture, service, width * height);
    }
    coverMesh.visible = service !== undefined;

    const network = readChannel(latest, LogisticsNetworkChannel) ?? undefined;
    const structures = readChannel(latest, StructuresChannel) ?? undefined;

    updateLinks(
      linkLines,
      linkBufRef.current,
      latest,
      network,
      width,
      height,
      heights,
      colorRef.current,
      renderNowMs() / 1000,
      linkColorRef.current,
    );
    {
      const focusSet = focusSetRef.current;
      focusSet.clear();
      for (const h of useSelectionStore.getState().selected) {
        focusSet.add(h);
      }
      const inspector = useInspectorStore.getState();
      const subjectHandle = (s: { kind: string } | null): number | null =>
        s !== null && 'handle' in s ? (s.handle as number) : null;
      const hHandle = subjectHandle(inspector.hovered);
      const pHandle = subjectHandle(inspector.pinned);
      if (hHandle !== null) {
        focusSet.add(hHandle);
      }
      if (pHandle !== null) {
        focusSet.add(pHandle);
      }
      updateRings(
        rings,
        structures,
        observer,
        db,
        width,
        height,
        heights,
        dummyRef.current,
        focusSet,
      );
    }
  });

  return (
    <group visible={on}>
      <mesh ref={coverMeshRef} renderOrder={1} frustumCulled={false}>
        <meshBasicMaterial
          ref={coverMatRef}
          color={COVER_COLOR}
          transparent
          depthWrite={false}
          opacity={1}
        />
      </mesh>
      <lineSegments ref={linkRef} visible={false} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={0.9} depthWrite={false} />
      </lineSegments>
      <instancedMesh
        key={`rings`}
        ref={ringRef}
        args={[undefined, undefined, RING_CAP]}
        frustumCulled={false}
      >
        <ringGeometry args={[0.95, 1, RING_SEGMENTS]} />
        <primitive object={ringDashMat} attach={ATTACH_MATERIAL} />
      </instancedMesh>
    </group>
  );
}
