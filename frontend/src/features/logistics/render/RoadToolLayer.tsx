// Road tool visuals (M3 E3): hovered/selected link polylines in road
// mode, plus a dashed red overlay on intercepted links whenever the
// logistics overlay is on. Selection/hover indices live in the build
// store; geometry is rebuilt each frame (link counts are small).
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useBuildStore } from '../../../client/build-store';
import type { SimClient } from '../../../client/sim-client';
import { useUiStore } from '../../../client/ui-store';
import type { ResolvedMap } from '../../../content/index';
import { terrainY } from '../../../render/world';
import { LogisticsNetworkChannel, type LogisticsNetwork } from '../protocol';

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
  const roadMode = useBuildStore((s) => s.roadMode);
  const selected = useBuildStore((s) => s.roadSel);
  const hovered = useBuildStore((s) => s.roadHover);
  const toggled = useUiStore((s) => s.logisticsOverlay);
  const placing = useBuildStore((s) => s.kind !== null);
  const overlayOn = toggled || roadMode || placing;

  const selRef = useRef<THREE.LineSegments>(null);
  const hovRef = useRef<THREE.LineSegments>(null);
  const intRef = useRef<THREE.LineSegments>(null);
  const geoms = useMemo(
    () => ({
      sel: new THREE.BufferGeometry(),
      hov: new THREE.BufferGeometry(),
      int: new THREE.BufferGeometry(),
      pos: new Float32Array(MAX_VERTS * 3),
    }),
    [],
  );

  useFrame(() => {
    const sel = selRef.current;
    const hov = hovRef.current;
    const int = intRef.current;
    if (sel === null || hov === null || int === null) {
      return;
    }
    const network = client.snapshots().latest?.channels[LogisticsNetworkChannel.id] as
      LogisticsNetwork | undefined;
    const { width, height } = map.grid;
    const draw = (
      lines: THREE.LineSegments,
      geom: THREE.BufferGeometry,
      links: readonly number[],
      visible: boolean,
    ): void => {
      if (!visible || network === undefined) {
        lines.visible = false;
        return;
      }
      const n = fillLines(geoms.pos, network, links, width, height, heights, LIFT);
      geom.setAttribute('position', new THREE.BufferAttribute(geoms.pos.slice(0, n), 3));
      geom.computeBoundingSphere();
      (lines.material as THREE.LineDashedMaterial).needsUpdate = true;
      lines.computeLineDistances();
      lines.visible = true;
    };
    draw(sel, geoms.sel, selected, roadMode);
    draw(hov, geoms.hov, hovered >= 0 ? [hovered] : [], roadMode);
    const intercepted: number[] = [];
    if (network !== undefined) {
      for (let i = 0; i < network.links.a.length; i++) {
        if ((network.links.intercept[i] ?? 0) > 0) {
          intercepted.push(i);
        }
      }
    }
    draw(int, geoms.int, intercepted, overlayOn);
  });

  const dashed = { dashSize: 0.4, gapSize: 0.25 };
  return (
    <>
      <lineSegments ref={selRef} geometry={geoms.sel} frustumCulled={false}>
        <lineBasicMaterial color={SELECT_COLOR} />
      </lineSegments>
      <lineSegments ref={hovRef} geometry={geoms.hov} frustumCulled={false}>
        <lineBasicMaterial color={HOVER_COLOR} />
      </lineSegments>
      <lineSegments ref={intRef} geometry={geoms.int} frustumCulled={false}>
        <lineDashedMaterial color={INTERCEPT_COLOR} {...dashed} />
      </lineSegments>
    </>
  );
}
