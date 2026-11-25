// Selection, hover, pin, demolish, and range-circle LineSegments overlay
// (F4): collects pure highlight primitives from snapshot channels and
// client stores each frame and writes them into a single dynamic LineBuffer.
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  useInspectorStore,
  type HoverSubject,
  type PinnableSubject,
} from '../../../client/inspector-store';
import { useInteractionStore } from '../../../client/interaction-store';
import { useSelectionStore } from '../../../client/selection-store';
import type { SnapshotPair } from '../../../client/sim-client';
import { interpAlpha } from '../../../render/interpolate';
import type { SceneLayerProps } from '../../../render/scene';
import {
  commitLineBuffer,
  createLineBuffer,
  ensureLineCapacity,
  type LineBuffer,
} from '../../../render/line-buffer';
import { writeRingVertices } from '../../../render/rings';
import { VISUAL } from '../../../render/theme/index';
import {
  collectSelectionHighlights,
  type HighlightBracket,
  type HighlightCircle,
} from './selection-highlights';
import { UnitInterpolator, type InterpUnit } from '../../units/render/index';
import { terrainY } from '../../../render/world';
import { renderNowMs } from '../../../client/capture-mode';

const INITIAL_CAPACITY_VERTICES = 1024;
const RING_SEGMENTS = 48;
const VERTS_PER_BRACKET = 16;
const VERTS_PER_CIRCLE = RING_SEGMENTS * 2;
const LIFT = 0.07;
const EMPTY_TARGETS: readonly number[] = [];

const BRACKET_COLORS: Readonly<Record<HighlightBracket['tone'], string>> = {
  selected: '#ffffff',
  pinned_own: '#5cb8ff',
  pinned_hostile: '#ff5a4f',
  hover: '#d8e8ff',
  danger: '#ff4d4d',
  cell_hover: '#94b8d8',
};

const CIRCLE_COLORS: Readonly<Record<HighlightCircle['kind'], string>> = {
  weapon_own: '#ffd166',
  weapon_hostile: '#ff5a4f',
  service: '#7fd4ff',
  connect: '#7be8b8',
};

function isUnitSubject(
  subject: HoverSubject | PinnableSubject | null,
): subject is { kind: 'own_unit' | 'hostile_unit'; handle: number } {
  return subject !== null && (subject.kind === 'own_unit' || subject.kind === 'hostile_unit');
}

function populateUnitFocusMap(
  interp: UnitInterpolator,
  pair: SnapshotPair,
  now: number,
  hovered: HoverSubject | null,
  pinned: PinnableSubject | null,
  unitMap: Map<number, InterpUnit>,
  unitPool: InterpUnit[],
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
  const alpha = interpAlpha(now, pair.receivedAt, pair.intervalMs);
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

function writeHighlights(
  segs: THREE.LineSegments,
  buf: LineBuffer,
  brackets: readonly HighlightBracket[],
  circles: readonly HighlightCircle[],
  heights: ArrayLike<number>,
  mapWidth: number,
  mapHeight: number,
  tempColor: THREE.Color,
  accent: string | null,
): void {
  const neededVerts = brackets.length * VERTS_PER_BRACKET + circles.length * VERTS_PER_CIRCLE;
  if (neededVerts === 0) {
    commitLineBuffer(buf, 0);
    segs.geometry = buf.geometry;
    segs.visible = false;
    return;
  }
  ensureLineCapacity(buf, neededVerts);
  segs.geometry = buf.geometry;

  const positions = buf.positions;
  const colors = buf.colors;
  if (colors === null) {
    segs.visible = false;
    return;
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

  for (const c of circles) {
    tempColor.set(accent !== null && c.kind === 'weapon_own' ? accent : CIRCLE_COLORS[c.kind]);
    const y = terrainY(heights, mapWidth, mapHeight, c.cx, c.cy) + LIFT;
    cursor = writeRingVertices(
      positions,
      colors,
      cursor,
      c.cx,
      c.cy,
      y,
      c.radius,
      RING_SEGMENTS,
      tempColor.r,
      tempColor.g,
      tempColor.b,
      c.kind === 'connect',
    );
  }

  const vertexCount = cursor / 3;
  commitLineBuffer(buf, vertexCount);
  segs.visible = vertexCount > 0;
}

export function SelectionHighlightLayer({ ctx }: SceneLayerProps) {
  const { client, db, heights, isHostile } = ctx;
  const { width: mapWidth, height: mapHeight } = ctx.map.grid;
  const theme = VISUAL;
  const segsRef = useRef<THREE.LineSegments>(null);
  const bufRef = useRef<LineBuffer | null>(null);
  const tempColorRef = useRef(new THREE.Color());
  const unitInterpRef = useRef(new UnitInterpolator());
  const unitMapRef = useRef(new Map<number, InterpUnit>());
  const unitPoolRef = useRef<InterpUnit[]>([]);

  useEffect(() => {
    return () => {
      bufRef.current?.geometry.dispose();
      bufRef.current = null;
    };
  }, []);

  useFrame(() => {
    const segs = segsRef.current;
    if (segs === null) {
      return;
    }
    bufRef.current ??= createLineBuffer(INITIAL_CAPACITY_VERTICES, true);
    const buf = bufRef.current;

    const pair = client.snapshots();
    if (pair.latest === null) {
      segs.geometry = buf.geometry;
      segs.visible = false;
      return;
    }

    const selected = useSelectionStore.getState().selected;
    const { hovered, pinned } = useInspectorStore.getState();
    const interaction = useInteractionStore.getState();

    populateUnitFocusMap(
      unitInterpRef.current,
      pair,
      renderNowMs(),
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
      toolKind: interaction.tool.kind,
      demolishHoverHandle: interaction.demolishHover?.handle ?? null,
      demolishConfirmTargets: interaction.demolishConfirm?.targets ?? EMPTY_TARGETS,
      isHostile,
      unitGroupBracket: true,
    });

    writeHighlights(
      segs,
      buf,
      brackets,
      circles,
      heights,
      mapWidth,
      mapHeight,
      tempColorRef.current,
      theme.markers.accent,
    );
  });

  return (
    <lineSegments ref={segsRef} visible={false} renderOrder={4} frustumCulled={false}>
      <lineBasicMaterial vertexColors transparent opacity={0.65} depthWrite={false} />
    </lineSegments>
  );
}
