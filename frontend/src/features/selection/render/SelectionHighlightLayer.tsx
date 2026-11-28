// Selection, hover, pin, demolish, and range-circle overlay (F4, M2B 1.2c):
// L-brackets stay in a dirty-gated LineBuffer; ground range/service/connect
// circles render via a dirty-gated DashRingMaterial InstancedMesh.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  useInspectorStore,
  type HoverSubject,
  type PinnableSubject,
} from '../../../client/inspector-store';
import { useInteractionStore, type SecondaryTool } from '../../../client/interaction-store';
import { useSelectionStore } from '../../../client/selection-store';
import type { SnapshotPair } from '../../../client/sim-client';
import type { Snapshot } from '../../../core/index';
import { createDashRingMaterial } from '../../../render/dash-ring';
import { InstanceWriter } from '../../../render/instance-writer';
import {
  ChannelPositionInterpolator,
  interpAlpha,
  type InterpEntity,
} from '../../../client/interpolate';
import type { SceneLayerProps } from '../../../render/scene';
import {
  bindLineBuffer,
  commitLineBuffer,
  createLineBuffer,
  ensureLineCapacity,
  type LineBuffer,
} from '../../../render/line-buffer';
import { VISUAL } from '../../../render/theme/index';
import { useGpuResource } from '../../../render/use-gpu-resource';
import {
  collectSelectionHighlights,
  type HighlightBracket,
  type HighlightCircle,
} from './selection-highlights';
import { DenseUnitsChannel, type DenseUnits } from '../../units/protocol';
import { terrainY } from '../../../client/world';
import { renderNowMs } from '../../../client/capture-mode';

const INITIAL_CAPACITY_VERTICES = 1024;
const INITIAL_CIRCLE_CAP = 64;
const RING_SEGMENTS = 64;
const VERTS_PER_BRACKET = 16;
const LIFT = 0.07;
const EMPTY_TARGETS: readonly number[] = [];

const BRACKET_COLORS: Readonly<Record<HighlightBracket['tone'], string>> = {
  selected: VISUAL.markers.accent,
  pinned_own: VISUAL.markers.accent,
  pinned_hostile: VISUAL.markers.danger,
  hover: VISUAL.markers.hover,
  danger: VISUAL.markers.danger,
  cell_hover: VISUAL.markers.cellHover,
};

const CIRCLE_COLORS: Readonly<Record<HighlightCircle['kind'], string>> = {
  weapon_own: VISUAL.markers.accent,
  weapon_hostile: VISUAL.markers.danger,
  service: VISUAL.markers.service,
  connect: VISUAL.markers.connect,
};

interface HighlightCache {
  latest: Snapshot | null;
  prev: Snapshot | null;
  alpha: number;
  selected: ReadonlySet<number> | null;
  hovered: HoverSubject | null;
  pinned: PinnableSubject | null;
  toolKind: SecondaryTool['kind'] | null;
  demolishHoverHandle: number | null;
  demolishConfirmTargets: readonly number[] | null;
  heights: ArrayLike<number> | null;
  circleCap: number;
  bracketVerts: number;
  circleCount: number;
}

function isUnitSubject(
  subject: HoverSubject | PinnableSubject | null,
): subject is { kind: 'own_unit' | 'hostile_unit'; handle: number } {
  return subject !== null && (subject.kind === 'own_unit' || subject.kind === 'hostile_unit');
}

function populateUnitFocusMap(
  interp: ChannelPositionInterpolator<DenseUnits>,
  pair: SnapshotPair,
  alpha: number,
  hovered: HoverSubject | null,
  pinned: PinnableSubject | null,
  unitMap: Map<number, InterpEntity>,
  unitPool: InterpEntity[],
): void {
  const latest = interp.update(pair);
  unitMap.clear();
  if (latest === null) {
    return;
  }
  const hUnit = isUnitSubject(hovered) ? hovered.handle : null;
  const pUnit = isUnitSubject(pinned) ? pinned.handle : null;
  if (hUnit === null && pUnit === null) {
    return;
  }
  let poolIdx = 0;
  for (let i = 0; i < latest.handles.length; i++) {
    const handle = latest.handles[i] ?? 0;
    if (handle !== hUnit && handle !== pUnit) {
      continue;
    }
    const pos = interp.interpolated(latest, i, alpha);
    let slot = unitPool[poolIdx];
    if (slot === undefined) {
      slot = { x: pos.x, y: pos.y, faction: latest.faction[i] ?? 0 };
      unitPool.push(slot);
    } else {
      slot.x = pos.x;
      slot.y = pos.y;
      slot.faction = latest.faction[i] ?? 0;
    }
    poolIdx += 1;
    unitMap.set(handle, slot);
    if (hUnit === pUnit || unitMap.size === (hUnit !== null && pUnit !== null ? 2 : 1)) {
      break;
    }
  }
}

function writeSegment(
  positions: Float32Array,
  colors: Float32Array,
  cursor: number,
  x0: number,
  y: number,
  z0: number,
  x1: number,
  z1: number,
  r: number,
  g: number,
  b: number,
): number {
  positions[cursor] = x0;
  positions[cursor + 1] = y;
  positions[cursor + 2] = z0;
  positions[cursor + 3] = x1;
  positions[cursor + 4] = y;
  positions[cursor + 5] = z1;
  colors[cursor] = r;
  colors[cursor + 1] = g;
  colors[cursor + 2] = b;
  colors[cursor + 3] = r;
  colors[cursor + 4] = g;
  colors[cursor + 5] = b;
  return cursor + 6;
}

function writeBrackets(
  segs: THREE.LineSegments,
  buf: LineBuffer,
  brackets: readonly HighlightBracket[],
  heights: ArrayLike<number>,
  mapWidth: number,
  mapHeight: number,
  tempColor: THREE.Color,
  accent: string | null,
): number {
  const neededVerts = brackets.length * VERTS_PER_BRACKET;
  if (neededVerts === 0) {
    commitLineBuffer(buf, 0);
    bindLineBuffer(segs, buf);
    segs.visible = false;
    return 0;
  }
  ensureLineCapacity(buf, neededVerts);
  bindLineBuffer(segs, buf);

  const positions = buf.positions;
  const colors = buf.colors;
  if (colors === null) {
    segs.visible = false;
    return 0;
  }

  let cursor = 0;
  for (const b of brackets) {
    // Themed: selection corners glow in the theme accent.
    tempColor.set(
      accent !== null && (b.tone === 'selected' || b.tone === 'pinned_own')
        ? accent
        : BRACKET_COLORS[b.tone],
    );
    const r = tempColor.r;
    const g = tempColor.g;
    const bl = tempColor.b;
    const y = terrainY(heights, mapWidth, mapHeight, b.x + b.w / 2, b.y + b.h / 2) + LIFT;
    const arm = Math.min(0.65, Math.max(0.18, Math.min(b.w, b.h) * 0.24));
    const x0 = b.x;
    const x1 = b.x + b.w;
    const z0 = b.y;
    const z1 = b.y + b.h;
    cursor = writeSegment(positions, colors, cursor, x0, y, z0, x0 + arm, z0, r, g, bl);
    cursor = writeSegment(positions, colors, cursor, x0, y, z0, x0, z0 + arm, r, g, bl);
    cursor = writeSegment(positions, colors, cursor, x1, y, z0, x1 - arm, z0, r, g, bl);
    cursor = writeSegment(positions, colors, cursor, x1, y, z0, x1, z0 + arm, r, g, bl);
    cursor = writeSegment(positions, colors, cursor, x0, y, z1, x0 + arm, z1, r, g, bl);
    cursor = writeSegment(positions, colors, cursor, x0, y, z1, x0, z1 - arm, r, g, bl);
    cursor = writeSegment(positions, colors, cursor, x1, y, z1, x1 - arm, z1, r, g, bl);
    cursor = writeSegment(positions, colors, cursor, x1, y, z1, x1, z1 - arm, r, g, bl);
  }

  const vertexCount = cursor / 3;
  commitLineBuffer(buf, vertexCount);
  segs.visible = vertexCount > 0;
  return vertexCount;
}

function writeCircles(
  rings: THREE.InstancedMesh,
  circles: readonly HighlightCircle[],
  heights: ArrayLike<number>,
  mapWidth: number,
  mapHeight: number,
  writer: InstanceWriter,
  tempColor: THREE.Color,
  accent: string | null,
): number {
  const count = circles.length;
  if (count === 0) {
    rings.count = 0;
    rings.visible = false;
    return 0;
  }
  const aDash = rings.geometry.getAttribute('aDash');
  if (!(aDash instanceof THREE.InstancedBufferAttribute)) {
    rings.count = 0;
    rings.visible = false;
    return 0;
  }
  for (let i = 0; i < count; i++) {
    const c = circles[i];
    if (c === undefined) {
      continue;
    }
    const y = terrainY(heights, mapWidth, mapHeight, c.cx, c.cy) + LIFT;
    writer.setFlat(rings, i, c.cx, y, c.cy, c.radius, c.radius);
    tempColor.set(accent !== null && c.kind === 'weapon_own' ? accent : CIRCLE_COLORS[c.kind]);
    rings.setColorAt(i, tempColor);
    aDash.setX(i, c.kind === 'connect' ? 1 : 0);
  }
  rings.count = count;
  rings.visible = true;
  rings.instanceMatrix.needsUpdate = true;
  if (rings.instanceColor !== null) {
    rings.instanceColor.needsUpdate = true;
  }
  aDash.needsUpdate = true;
  return count;
}

export function SelectionHighlightLayer({ ctx }: SceneLayerProps) {
  const { client, db, heights, isHostile } = ctx;
  const { width: mapWidth, height: mapHeight } = ctx.map.grid;
  const theme = VISUAL;
  const [circleCap, setCircleCap] = useState(INITIAL_CIRCLE_CAP);

  const ringGeo = useMemo(() => {
    const geo = new THREE.RingGeometry(0.8, 1, RING_SEGMENTS);
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(circleCap), 1);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aDash', attr);
    return geo;
  }, [circleCap]);
  useGpuResource(ringGeo);

  const ringMat = useMemo(
    () =>
      createDashRingMaterial('#ffffff', {
        width: 0.06,
        opacity: 0.65,
        instancedDash: true,
      }),
    [],
  );
  useGpuResource(ringMat);

  const segsRef = useRef<THREE.LineSegments>(null);
  const ringsRef = useRef<THREE.InstancedMesh>(null);
  const bufRef = useRef<LineBuffer | null>(null);
  const writerRef = useRef<InstanceWriter | null>(null);
  const tempColorRef = useRef(new THREE.Color());
  const unitInterpRef = useRef(new ChannelPositionInterpolator(DenseUnitsChannel));
  const unitMapRef = useRef(new Map<number, InterpEntity>());
  const unitPoolRef = useRef<InterpEntity[]>([]);
  const cacheRef = useRef<HighlightCache>({
    latest: null,
    prev: null,
    alpha: -1,
    selected: null,
    hovered: null,
    pinned: null,
    toolKind: null,
    demolishHoverHandle: null,
    demolishConfirmTargets: null,
    heights: null,
    circleCap: 0,
    bracketVerts: 0,
    circleCount: 0,
  });

  useEffect(() => {
    return () => {
      bufRef.current?.geometry.dispose();
      bufRef.current = null;
    };
  }, []);

  useFrame(() => {
    const segs = segsRef.current;
    const rings = ringsRef.current;
    if (segs === null || rings === null) {
      return;
    }
    bufRef.current ??= createLineBuffer(INITIAL_CAPACITY_VERTICES, true);
    const buf = bufRef.current;
    bindLineBuffer(segs, buf);

    const pair = client.snapshots();
    const cache = cacheRef.current;
    if (pair.latest === null) {
      if (cache.latest !== null) {
        commitLineBuffer(buf, 0);
        cache.latest = null;
        cache.bracketVerts = 0;
        cache.circleCount = 0;
      }
      segs.visible = false;
      rings.count = 0;
      rings.visible = false;
      return;
    }

    const selected = useSelectionStore.getState().selected;
    const { hovered, pinned } = useInspectorStore.getState();
    const interaction = useInteractionStore.getState();
    const toolKind = interaction.tool.kind;
    const demolishHoverHandle = interaction.demolishHover?.handle ?? null;
    const demolishConfirmTargets = interaction.demolishConfirm?.targets ?? EMPTY_TARGETS;

    const hasUnitFocus = isUnitSubject(hovered) || isUnitSubject(pinned);
    const alpha = hasUnitFocus ? interpAlpha(renderNowMs(), pair.receivedAt, pair.intervalMs) : 1;

    const sameStatic =
      cache.latest === pair.latest &&
      cache.selected === selected &&
      cache.hovered === hovered &&
      cache.pinned === pinned &&
      cache.toolKind === toolKind &&
      cache.demolishHoverHandle === demolishHoverHandle &&
      cache.demolishConfirmTargets === demolishConfirmTargets &&
      cache.heights === heights &&
      cache.circleCap === circleCap;

    const sameUnitFocus =
      !hasUnitFocus || (cache.prev === pair.previous && alpha === 1 && cache.alpha === 1);

    if (sameStatic && sameUnitFocus) {
      segs.visible = cache.bracketVerts > 0;
      rings.visible = cache.circleCount > 0;
      return;
    }

    populateUnitFocusMap(
      unitInterpRef.current,
      pair,
      alpha,
      hovered,
      pinned,
      unitMapRef.current,
      unitPoolRef.current,
    );

    const { brackets, circles } = collectSelectionHighlights({
      db,
      mapWidth,
      mapHeight,
      snapshot: pair.latest,
      units: unitMapRef.current,
      selected,
      hovered,
      pinned,
      toolKind,
      demolishHoverHandle,
      demolishConfirmTargets,
      isHostile,
      unitGroupBracket: true,
    });

    if (circles.length > circleCap) {
      setCircleCap(Math.max(circleCap * 2, circles.length));
      segs.visible = false;
      rings.visible = false;
      return;
    }

    writerRef.current ??= new InstanceWriter();
    const bracketVerts = writeBrackets(
      segs,
      buf,
      brackets,
      heights,
      mapWidth,
      mapHeight,
      tempColorRef.current,
      theme.markers.accent,
    );
    const circleCount = writeCircles(
      rings,
      circles,
      heights,
      mapWidth,
      mapHeight,
      writerRef.current,
      tempColorRef.current,
      theme.markers.accent,
    );

    cache.latest = pair.latest;
    cache.prev = pair.previous;
    cache.alpha = alpha;
    cache.selected = selected;
    cache.hovered = hovered;
    cache.pinned = pinned;
    cache.toolKind = toolKind;
    cache.demolishHoverHandle = demolishHoverHandle;
    cache.demolishConfirmTargets = demolishConfirmTargets;
    cache.heights = heights;
    cache.circleCap = circleCap;
    cache.bracketVerts = bracketVerts;
    cache.circleCount = circleCount;
  });

  return (
    <>
      <lineSegments ref={segsRef} visible={false} renderOrder={4} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={0.65} depthWrite={false} />
      </lineSegments>
      <instancedMesh
        key={circleCap}
        ref={ringsRef}
        args={[ringGeo, ringMat, circleCap]}
        visible={false}
        renderOrder={4}
        frustumCulled={false}
      />
    </>
  );
}
