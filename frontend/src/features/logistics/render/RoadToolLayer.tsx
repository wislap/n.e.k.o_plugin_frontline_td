// Road tool visuals (M3 E3): hovered/selected link polylines in road
// mode, plus a dashed red overlay on intercepted links whenever the
// logistics overlay is on. Selection/hover indices live in the build
// store; geometry is rebuilt each frame (link counts are small).
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useInteractionStore } from '../../../client/interaction-store';
import type { SimClient } from '../../../client/sim-client';
import { useUiStore } from '../../../client/ui-store';
import type { ResolvedMap } from '../../../content/index';
import { commitLineBuffer, createLineBuffer, type LineBuffer } from '../../../render/line-buffer';
import { terrainY } from '../../../render/world';
import { LogisticsNetworkChannel, type LogisticsNetwork } from '../protocol';
import { linkIndices } from '../ui/road-select';

const HOVER_COLOR = '#ffffff';
const SELECT_COLOR = '#ffd166';
const INTERCEPT_COLOR = '#ff5a4f';
const LIFT = 0.09;
const MAX_VERTS = 8192;

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

export interface RoadToolLayerProps {
  client: SimClient;
  map: ResolvedMap;
  heights: ArrayLike<number>;
}

export function RoadToolLayer({ client, map, heights }: RoadToolLayerProps) {
  const selRef = useRef<THREE.LineSegments>(null);
  const hovRef = useRef<THREE.LineSegments>(null);
  const intRef = useRef<THREE.LineSegments>(null);
  const bufsRef = useRef<{ sel: LineBuffer; hov: LineBuffer; int: LineBuffer } | null>(null);
  const interceptedRef = useRef<number[]>([]);
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
      int: createLineBuffer(MAX_VERTS, false),
    };
    const bufs = bufsRef.current;
    const network = client.snapshots().latest?.channels[LogisticsNetworkChannel.id] as
      LogisticsNetwork | undefined;
    const { width, height } = map.grid;
    const draw = (
      lines: THREE.LineSegments,
      buf: LineBuffer,
      links: readonly number[],
      visible: boolean,
    ): void => {
      if (!visible || network === undefined) {
        lines.visible = false;
        return;
      }
      const n = fillLines(buf.positions, network, links, width, height, heights, LIFT);
      commitLineBuffer(buf, n / 3);
      lines.geometry = buf.geometry;
      (lines.material as THREE.LineDashedMaterial).needsUpdate = true;
      lines.computeLineDistances();
      lines.visible = true;
    };
    // Store reads happen per frame via getState — the visuals are
    // imperative, so subscribing would only add React re-renders.
    const interaction = useInteractionStore.getState();
    const roadMode = interaction.tool.kind === 'road';
    const overlayOn =
      useUiStore.getState().logisticsOverlay ||
      interaction.mode === 'logistics' ||
      interaction.tool.kind === 'place';
    // roadSel stores handle pairs (stable across network rebuilds);
    // resolve to current link indices here, dropping dead links.
    draw(
      sel,
      bufs.sel,
      network === undefined ? [] : linkIndices(network, interaction.roadSel),
      roadMode,
    );
    draw(hov, bufs.hov, interaction.roadHover >= 0 ? [interaction.roadHover] : [], roadMode);
    const intercepted = interceptedRef.current;
    intercepted.length = 0;
    if (network !== undefined) {
      for (let i = 0; i < network.links.a.length; i++) {
        if ((network.links.intercept[i] ?? 0) > 0) {
          intercepted.push(i);
        }
      }
    }
    draw(int, bufs.int, intercepted, overlayOn);
  });

  const dashed = { dashSize: 0.4, gapSize: 0.25 };
  return (
    <>
      <lineSegments ref={selRef} frustumCulled={false}>
        <lineBasicMaterial color={SELECT_COLOR} />
      </lineSegments>
      <lineSegments ref={hovRef} frustumCulled={false}>
        <lineBasicMaterial color={HOVER_COLOR} />
      </lineSegments>
      <lineSegments ref={intRef} frustumCulled={false}>
        <lineDashedMaterial color={INTERCEPT_COLOR} {...dashed} />
      </lineSegments>
    </>
  );
}
