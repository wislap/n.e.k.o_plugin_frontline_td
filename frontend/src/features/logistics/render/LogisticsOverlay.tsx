// Logistics overlay (M3 D), toggled with L and forced on while build
// mode is active: updates shared CoverUniforms (RedFormat DataTexture)
// for terrain/road service-coverage tint, link polylines from pathCells
// (brightness ∝ the 30 s EMA of outBp + inBp, red when either direction
// saturates), and service-radius rings on nodes.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useInspectorStore } from '../../../client/inspector-store';
import { useInteractionStore } from '../../../client/interaction-store';
import { useSelectionStore } from '../../../client/selection-store';
import { useUiStore } from '../../../client/ui-store';
import type { ContentDb } from '../../../content/index';
import { readChannel, readLayer } from '../../../core/index';
import type { Snapshot } from '../../../core/index';
import type { CoverUniforms } from '../../../render/cover-uniforms';
import { createDashRingMaterial, type DashRingMaterial } from '../../../render/dash-ring';
import {
  bindLineBuffer,
  commitLineBuffer,
  createLineBuffer,
  type LineBuffer,
} from '../../../render/line-buffer';
import type { SceneLayerProps } from '../../../render/scene';
import { VISUAL } from '../../../render/theme/index';
import { InstanceWriter } from '../../../render/instance-writer';
import { markBuilt, useGpuResource } from '../../../render/use-gpu-resource';
import { terrainY } from '../../../client/world';
import {
  StructuresChannel,
  STATE_OPERATIONAL,
  type ConstructionStructures,
} from '../../construction/protocol';
import { LogisticsNetworkChannel, SERVICE_LAYER_ID, type LogisticsNetwork } from '../protocol';
import { linkFlow } from '../../../client/link-flow';
import { renderNowMs } from '../../../client/capture-mode';

const ATTACH_MATERIAL = 'material';

const LINK_SAT_COLOR = new THREE.Color(VISUAL.markers.danger);
const MAX_LINK_VERTS = 8192;
const RING_CAP = 64;
const RING_SEGMENTS = 48;
const LIFT = 0.05;

function uploadServiceCoverage(
  texture: THREE.DataTexture,
  layer: ArrayLike<number>,
  cells: number,
): void {
  const buf = texture.image.data as Uint8Array;
  for (let i = 0; i < cells; i++) {
    buf[i] = (layer[i] ?? 0) !== 0 ? 255 : 0;
  }
  texture.needsUpdate = true;
}

// Uniform writes live in module-scope helpers so React Compiler's
// immutability rule does not track context/ref-derived objects.
function syncCoverUniforms(
  cover: CoverUniforms,
  texture: THREE.DataTexture,
  width: number,
  height: number,
  color: string,
): void {
  cover.uFtdCoverMap.value = texture;
  cover.uFtdCoverSize.value.set(width, height);
  cover.uFtdCoverColor.value.set(color);
  cover.uFtdCoverOn.value = 1;
}

function disableCoverUniforms(cover: CoverUniforms): void {
  cover.uFtdCoverOn.value = 0;
}

function clearCoverUniforms(cover: CoverUniforms): void {
  cover.uFtdCoverOn.value = 0;
  cover.uFtdCoverMap.value = null;
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
  bindLineBuffer(linkLines, linkBuf);
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
  writer: InstanceWriter,
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
      writer.setFlat(
        rings,
        ringCount,
        cx,
        terrainY(heights, width, height, cx, cy) + LIFT + 0.002,
        cy,
        kind.node.service,
        kind.node.service,
      );
      ringCount += 1;
    }
  }
  rings.count = ringCount;
  rings.visible = ringCount > 0;
  if (ringCount > 0) {
    rings.instanceMatrix.needsUpdate = true;
  }
}

export function LogisticsOverlay({ ctx }: SceneLayerProps) {
  const { client, db, map, heights, cover } = ctx;
  const theme = VISUAL;
  const toggled = useUiStore((s) => s.logisticsOverlay);
  const layerVisible = useUiStore((s) => !s.hiddenSceneLayers.has('logistics.overlay'));
  const modeOn = useInteractionStore((s) => s.mode === 'logistics' || s.tool.kind === 'place');
  const on = layerVisible && (toggled || modeOn);

  const coverTex = useMemo(() => {
    const { width, height } = map.grid;
    const tex = new THREE.DataTexture(
      new Uint8Array(width * height),
      width,
      height,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    return tex;
  }, [map]);
  useGpuResource(coverTex);

  const builtForLayer = useRef<ArrayLike<number> | null>(null);
  const builtForTexture = useRef<THREE.DataTexture | null>(null);
  const linkRef = useRef<THREE.LineSegments>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const linkBufRef = useRef<LineBuffer | null>(null);
  const writerRef = useRef<InstanceWriter | null>(null);
  const colorRef = useRef<THREE.Color | null>(null);
  const linkColorRef = useRef(new THREE.Color(theme.markers.link));
  const ringDashMatRef = useRef<DashRingMaterial | null>(null);
  const ringDashMat = useMemo(() => createDashRingMaterial(theme.markers.accent), [theme]);
  const focusSetRef = useRef(new Set<number>());

  useEffect(() => {
    return () => {
      linkBufRef.current?.geometry.dispose();
      linkBufRef.current = null;
    };
  }, []);
  useEffect(() => {
    return () => {
      clearCoverUniforms(cover);
    };
  }, [cover]);
  useEffect(() => {
    ringDashMatRef.current = ringDashMat;
  }, [ringDashMat]);
  useGpuResource(ringDashMat);

  useFrame(() => {
    const linkLines = linkRef.current;
    const rings = ringRef.current;
    if (linkLines === null || rings === null) {
      return;
    }
    linkColorRef.current.set(theme.markers.link);

    const ringDash = ringDashMatRef.current;
    if (ringDash !== null) {
      ringDash.uniforms.uTime.value = renderNowMs() / 1000;
      ringDash.uniforms.uColor.value.set(theme.markers.accent);
    }
    linkBufRef.current ??= createLineBuffer(MAX_LINK_VERTS, true);
    writerRef.current ??= new InstanceWriter();
    colorRef.current ??= new THREE.Color();

    const latest = client.snapshots().latest;
    if (!on || latest === null) {
      disableCoverUniforms(cover);
      rings.count = 0;
      rings.visible = false;
      linkLines.visible = false;
      return;
    }

    const { width, height } = map.grid;
    const observer = latest.observer;
    const service = readLayer(latest, `${SERVICE_LAYER_ID}#${observer}`) ?? undefined;
    if (service === undefined) {
      disableCoverUniforms(cover);
    } else {
      // Evaluate both markBuilt calls without short-circuiting so map
      // changes (new coverTex) always upload even if service is unchanged.
      const freshLayer = markBuilt(builtForLayer, service);
      const freshTexture = markBuilt(builtForTexture, coverTex);
      if (freshLayer || freshTexture) {
        uploadServiceCoverage(coverTex, service, width * height);
      }
      syncCoverUniforms(cover, coverTex, width, height, theme.markers.link);
    }

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
        writerRef.current,
        focusSet,
      );
    }
  });

  return (
    <group visible={on}>
      <lineSegments ref={linkRef} visible={false} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={0.9} depthWrite={false} />
      </lineSegments>
      <instancedMesh
        key={`rings`}
        ref={ringRef}
        args={[undefined, undefined, RING_CAP]}
        visible={false}
        frustumCulled={false}
      >
        <ringGeometry args={[0.95, 1, RING_SEGMENTS]} />
        <primitive object={ringDashMat} attach={ATTACH_MATERIAL} />
      </instancedMesh>
    </group>
  );
}
