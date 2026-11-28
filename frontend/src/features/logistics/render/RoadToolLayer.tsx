// Road tool visuals (M3 E3, M2B 1.2b): hovered/selected link polylines
// in road mode, plus a dashed red overlay on intercepted links whenever
// the logistics overlay is on. Dirty-gated per mesh with preallocated
// lineDistance on the dashed intercept buffer.
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useInteractionStore } from '../../../client/interaction-store';
import { useRoadToolStore } from '../ui/road-tool-store';
import { useUiStore } from '../../../client/ui-store';
import {
  bindLineBuffer,
  commitLineBuffer,
  commitLineDistances,
  createLineBuffer,
  type LineBuffer,
} from '../../../render/line-buffer';
import type { SceneLayerProps } from '../../../render/scene';
import { VISUAL } from '../../../render/theme/index';
import { terrainY } from '../../../client/world';
import { LogisticsNetworkChannel, type LogisticsNetwork } from '../protocol';
import { linkIndices } from '../ui/road-select';
import { readChannel } from '../../../core/index';

const HOVER_COLOR = '#ffffff';
const SELECT_COLOR = VISUAL.markers.accent;
const INTERCEPT_COLOR = VISUAL.markers.danger;
const LIFT = 0.09;
const MAX_VERTS = 8192;

interface LineMeshCache<K> {
  network: LogisticsNetwork | undefined;
  key: K;
  heights: ArrayLike<number> | null;
  vertCount: number;
}

function fillLines(
  pos: Float32Array,
  network: LogisticsNetwork,
  links: readonly number[],
  width: number,
  height: number,
  heights: ArrayLike<number>,
  lift: number,
): number {
  let v = 0;
  const push = (cell: number): void => {
    if (v + 3 > pos.length) {
      return;
    }
    const x = (cell % width) + 0.5;
    const y = Math.floor(cell / width) + 0.5;
    pos[v] = x;
    pos[v + 1] = terrainY(heights, width, height, x, y) + lift;
    pos[v + 2] = y;
    v += 3;
  };
  for (const i of links) {
    const from = network.links.pathOffsets[i] ?? 0;
    const to = network.links.pathOffsets[i + 1] ?? from;
    if (to - from < 2) {
      continue;
    }
    push(network.links.pathCells[from] ?? 0);
    for (let c = from + 1; c < to; c++) {
      const cell = network.links.pathCells[c] ?? 0;
      push(cell);
      if (c + 1 < to) {
        push(cell);
      }
    }
  }
  return v;
}

function drawGated<K>(
  lines: THREE.LineSegments,
  buf: LineBuffer,
  visible: boolean,
  network: LogisticsNetwork | undefined,
  key: K,
  heights: ArrayLike<number>,
  width: number,
  height: number,
  cache: LineMeshCache<K>,
  resolveLinks: (net: LogisticsNetwork) => readonly number[],
): void {
  if (!visible || network === undefined) {
    lines.visible = false;
    return;
  }
  if (cache.network === network && cache.key === key && cache.heights === heights) {
    lines.visible = cache.vertCount > 0;
    return;
  }
  const n = fillLines(buf.positions, network, resolveLinks(network), width, height, heights, LIFT);
  const vertCount = n / 3;
  commitLineBuffer(buf, vertCount);
  if (vertCount > 0 && buf.lineDistances !== null) {
    commitLineDistances(buf, vertCount);
  }
  lines.visible = vertCount > 0;
  cache.network = network;
  cache.key = key;
  cache.heights = heights;
  cache.vertCount = vertCount;
}

export function RoadToolLayer({ ctx }: SceneLayerProps) {
  const { client, map, heights } = ctx;
  const selRef = useRef<THREE.LineSegments>(null);
  const hovRef = useRef<THREE.LineSegments>(null);
  const intRef = useRef<THREE.LineSegments>(null);
  const bufsRef = useRef<{ sel: LineBuffer; hov: LineBuffer; int: LineBuffer } | null>(null);
  const interceptedRef = useRef<number[]>([]);
  const selCacheRef = useRef<LineMeshCache<unknown>>({
    network: undefined,
    key: null,
    heights: null,
    vertCount: 0,
  });
  const hovCacheRef = useRef<LineMeshCache<number>>({
    network: undefined,
    key: -1,
    heights: null,
    vertCount: 0,
  });
  const intCacheRef = useRef<LineMeshCache<null>>({
    network: undefined,
    key: null,
    heights: null,
    vertCount: 0,
  });

  useEffect(() => {
    return () => {
      bufsRef.current?.sel.geometry.dispose();
      bufsRef.current?.hov.geometry.dispose();
      bufsRef.current?.int.geometry.dispose();
    };
  }, []);

  useFrame(() => {
    const sel = selRef.current;
    const hov = hovRef.current;
    const int = intRef.current;
    if (sel === null || hov === null || int === null) {
      return;
    }
    bufsRef.current ??= {
      sel: createLineBuffer(MAX_VERTS, false),
      hov: createLineBuffer(MAX_VERTS, false),
      int: createLineBuffer(MAX_VERTS, false, true),
    };
    const bufs = bufsRef.current;
    bindLineBuffer(sel, bufs.sel);
    bindLineBuffer(hov, bufs.hov);
    bindLineBuffer(int, bufs.int);

    const network = readChannel(client.snapshots().latest, LogisticsNetworkChannel) ?? undefined;
    const { width, height } = map.grid;
    const interaction = useInteractionStore.getState();
    const roadTool = useRoadToolStore.getState();
    const roadMode = interaction.tool.kind === 'road';
    const overlayOn =
      useUiStore.getState().logisticsOverlay ||
      interaction.mode === 'logistics' ||
      interaction.tool.kind === 'place';

    drawGated(
      sel,
      bufs.sel,
      roadMode,
      network,
      roadTool.roadSel,
      heights,
      width,
      height,
      selCacheRef.current,
      (net) => linkIndices(net, roadTool.roadSel),
    );
    drawGated(
      hov,
      bufs.hov,
      roadMode,
      network,
      roadTool.roadHover,
      heights,
      width,
      height,
      hovCacheRef.current,
      () => (roadTool.roadHover >= 0 ? [roadTool.roadHover] : []),
    );
    drawGated(
      int,
      bufs.int,
      overlayOn,
      network,
      null,
      heights,
      width,
      height,
      intCacheRef.current,
      (net) => {
        const intercepted = interceptedRef.current;
        intercepted.length = 0;
        for (let i = 0; i < net.links.a.length; i++) {
          if ((net.links.intercept[i] ?? 0) > 0) {
            intercepted.push(i);
          }
        }
        return intercepted;
      },
    );
  });

  const dashed = { dashSize: 0.4, gapSize: 0.25 };
  return (
    <>
      <lineSegments ref={selRef} visible={false} frustumCulled={false}>
        <lineBasicMaterial color={SELECT_COLOR} />
      </lineSegments>
      <lineSegments ref={hovRef} visible={false} frustumCulled={false}>
        <lineBasicMaterial color={HOVER_COLOR} />
      </lineSegments>
      <lineSegments ref={intRef} visible={false} frustumCulled={false}>
        <lineDashedMaterial color={INTERCEPT_COLOR} {...dashed} />
      </lineSegments>
    </>
  );
}
