// Selection, hover, pin, demolish, and range-circle overlay collection
// (F4): pure snapshot-to-highlight geometry data, kept separate from R3F/DOM
// so Node tests can verify fog-safety and circle radii directly.
import type { HoverSubject, PinnableSubject } from '../client/inspector-store';
import type { SecondaryTool } from '../client/interaction-store';
import type { ContentDb } from '../content/index';
import { readChannel, readLayer } from '../core/index';
import type { Snapshot } from '../core/index';
import {
  RoadWorksChannel,
  SalvageChannel,
  STATE_RUIN,
  StructuresChannel,
  type ConstructionSalvage,
  type ConstructionStructures,
  type RoadWorks,
} from '../features/construction/protocol';
import { DenseUnitsChannel } from '../features/units/protocol';
import {
  VISION_STATE_LAYER_ID,
  VisionMemoryChannel,
  type VisionMemory,
} from '../features/vision/protocol';

const UNIT_BOX_SIZE = 0.9;
const ROAD_BOX_SIZE = 0.9;
const SALVAGE_BOX_SIZE = 0.9;
const MIN_UNIT_RANGE_CIRCLE = 1.5;
const MAX_SELECTED_CIRCLE_STRUCTURES = 8;

export interface HighlightBracket {
  x: number;
  y: number;
  w: number;
  h: number;
  tone: 'selected' | 'pinned_own' | 'pinned_hostile' | 'hover' | 'danger' | 'cell_hover';
}

export interface HighlightCircle {
  cx: number;
  cy: number;
  radius: number;
  kind: 'weapon_own' | 'weapon_hostile' | 'service' | 'connect';
}

export interface SelectionHighlightInput {
  db: ContentDb;
  mapWidth: number;
  mapHeight: number;
  snapshot: Snapshot | null;
  units: ReadonlyMap<number, { x: number; y: number; faction: number }>;
  selected: ReadonlySet<number>;
  hovered: HoverSubject | null;
  pinned: PinnableSubject | null;
  toolKind: SecondaryTool['kind'];
  demolishHoverHandle: number | null;
  demolishConfirmTargets: readonly number[];
  isHostile: (observer: number, faction: number) => boolean;
  // Themed selection: for >=2 selected own units, one bracket rectangle
  // around the union bounds instead of per-unit overlays.
  unitGroupBracket?: boolean;
}

interface Box2D {
  x: number;
  y: number;
  w: number;
  h: number;
}

function indexOfHandle(handles: Float64Array, handle: number): number {
  for (let i = 0; i < handles.length; i++) {
    if (handles[i] === handle) {
      return i;
    }
  }
  return -1;
}

function centeredBox(cx: number, cy: number, size: number): Box2D {
  const half = size / 2;
  return { x: cx - half, y: cy - half, w: size, h: size };
}

function resolveStructureBox(
  db: ContentDb,
  structures: ConstructionStructures | undefined,
  handle: number,
): Box2D | null {
  if (structures === undefined) {
    return null;
  }
  const i = indexOfHandle(structures.handles, handle);
  if (i === -1) {
    return null;
  }
  const kind = db.structures.byIndex(structures.kind[i] ?? 0);
  if (kind === undefined) {
    return null;
  }
  return {
    x: structures.x[i] ?? 0,
    y: structures.y[i] ?? 0,
    w: kind.footprint.w,
    h: kind.footprint.h,
  };
}

function resolveRoadSegmentBox(roadWorks: RoadWorks | undefined, handle: number): Box2D | null {
  if (roadWorks === undefined) {
    return null;
  }
  const i = indexOfHandle(roadWorks.segments.handles, handle);
  if (i === -1) {
    return null;
  }
  return centeredBox(roadWorks.segments.x[i] ?? 0, roadWorks.segments.y[i] ?? 0, ROAD_BOX_SIZE);
}

function resolveSubjectBox(
  db: ContentDb,
  structures: ConstructionStructures | undefined,
  roadWorks: RoadWorks | undefined,
  salvage: ConstructionSalvage | undefined,
  memory: VisionMemory | undefined,
  units: ReadonlyMap<number, { x: number; y: number; faction: number }>,
  subject: Exclude<HoverSubject, { kind: 'cell' } | { kind: 'multi_own' }>,
): Box2D | null {
  switch (subject.kind) {
    case 'own_unit':
    case 'hostile_unit': {
      const u = units.get(subject.handle);
      return u === undefined ? null : centeredBox(u.x, u.y, UNIT_BOX_SIZE);
    }
    case 'own_structure':
    case 'hostile_structure':
    case 'ruin':
      return resolveStructureBox(db, structures, subject.handle);
    case 'road_segment':
      return resolveRoadSegmentBox(roadWorks, subject.handle);
    case 'salvage': {
      if (salvage === undefined) {
        return null;
      }
      const i = indexOfHandle(salvage.handles, subject.handle);
      if (i === -1) {
        return null;
      }
      return centeredBox(salvage.x[i] ?? 0, salvage.y[i] ?? 0, SALVAGE_BOX_SIZE);
    }
    case 'memory': {
      const i = memory === undefined ? -1 : indexOfHandle(memory.handles, subject.handle);
      const kindIndex = i === -1 ? subject.kindIndex : (memory?.kind[i] ?? subject.kindIndex);
      const x = i === -1 ? subject.x : (memory?.x[i] ?? subject.x);
      const y = i === -1 ? subject.y : (memory?.y[i] ?? subject.y);
      const kind = db.structures.byIndex(kindIndex);
      if (kind === undefined) {
        return null;
      }
      return { x, y, w: kind.footprint.w, h: kind.footprint.h };
    }
  }
}

export function collectSelectionHighlights(input: SelectionHighlightInput): {
  brackets: HighlightBracket[];
  circles: HighlightCircle[];
} {
  const {
    db,
    mapWidth,
    mapHeight,
    snapshot,
    units,
    selected,
    hovered,
    pinned,
    toolKind,
    demolishHoverHandle,
    demolishConfirmTargets,
    isHostile,
  } = input;

  const brackets: HighlightBracket[] = [];
  const circles: HighlightCircle[] = [];
  if (snapshot === null) {
    return { brackets, circles };
  }

  const observer = snapshot.observer;
  const structures = readChannel(snapshot, StructuresChannel) ?? undefined;
  const roadWorks = readChannel(snapshot, RoadWorksChannel) ?? undefined;
  const salvage = readChannel(snapshot, SalvageChannel) ?? undefined;
  const memory = readChannel(snapshot, VisionMemoryChannel) ?? undefined;
  const denseUnits = readChannel(snapshot, DenseUnitsChannel) ?? undefined;

  // 1. Fog-safe cell reticle: never reveal/highlight unexplored cells.
  if (hovered?.kind === 'cell' && toolKind === 'none') {
    const { x, y } = hovered;
    if (x >= 0 && y >= 0 && x < mapWidth && y < mapHeight) {
      const fogLayer = readLayer(snapshot, `${VISION_STATE_LAYER_ID}#${observer}`);
      const idx = y * mapWidth + x;
      if (fogLayer === null || (fogLayer[idx] ?? 0) > 0) {
        brackets.push({ x, y, w: 1, h: 1, tone: 'cell_hover' });
      }
    }
  }

  // 2. Danger brackets (demolish hover + armed demolish confirmation targets).
  const dangerHandles = new Set<number>();
  if (toolKind === 'demolish' && demolishHoverHandle !== null) {
    dangerHandles.add(demolishHoverHandle);
  }
  for (const h of demolishConfirmTargets) {
    dangerHandles.add(h);
  }
  for (const h of dangerHandles) {
    const box = resolveStructureBox(db, structures, h) ?? resolveRoadSegmentBox(roadWorks, h);
    if (box !== null) {
      brackets.push({ ...box, tone: 'danger' });
    }
  }

  // 3. Selected own structures & road segments (units draw rings in UnitsLayer).
  if (selected.size > 0) {
    if (structures !== undefined) {
      for (let i = 0; i < structures.handles.length; i++) {
        const handle = structures.handles[i] ?? 0;
        if (!selected.has(handle) || dangerHandles.has(handle)) {
          continue;
        }
        if ((structures.faction[i] ?? 0) !== observer) {
          continue;
        }
        const kind = db.structures.byIndex(structures.kind[i] ?? 0);
        if (kind === undefined) {
          continue;
        }
        brackets.push({
          x: structures.x[i] ?? 0,
          y: structures.y[i] ?? 0,
          w: kind.footprint.w,
          h: kind.footprint.h,
          tone: 'selected',
        });
      }
    }
    if (roadWorks !== undefined) {
      for (let i = 0; i < roadWorks.segments.handles.length; i++) {
        const handle = roadWorks.segments.handles[i] ?? 0;
        if (!selected.has(handle) || dangerHandles.has(handle)) {
          continue;
        }
        const box = centeredBox(
          roadWorks.segments.x[i] ?? 0,
          roadWorks.segments.y[i] ?? 0,
          ROAD_BOX_SIZE,
        );
        brackets.push({ ...box, tone: 'selected' });
      }
    }
    if (input.unitGroupBracket === true && denseUnits !== undefined) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let count = 0;
      for (let i = 0; i < denseUnits.handles.length; i++) {
        const handle = denseUnits.handles[i] ?? 0;
        if (!selected.has(handle) || (denseUnits.faction[i] ?? 0) !== observer) {
          continue;
        }
        const ux = denseUnits.x[i] ?? 0;
        const uy = denseUnits.y[i] ?? 0;
        if (ux < minX) minX = ux;
        if (uy < minY) minY = uy;
        if (ux > maxX) maxX = ux;
        if (uy > maxY) maxY = uy;
        count += 1;
      }
      if (count >= 2) {
        const pad = UNIT_BOX_SIZE * 0.7;
        brackets.push({
          x: minX - pad,
          y: minY - pad,
          w: maxX - minX + pad * 2,
          h: maxY - minY + pad * 2,
          tone: 'selected',
        });
      }
    }
  }

  // 4. Pinned entity bracket.
  let pinnedHandle: number | null = null;
  if (pinned !== null && pinned.kind !== 'multi_own') {
    pinnedHandle = pinned.handle;
    if (!dangerHandles.has(pinnedHandle)) {
      const box = resolveSubjectBox(db, structures, roadWorks, salvage, memory, units, pinned);
      if (box !== null) {
        let hostile = false;
        if (pinned.kind === 'hostile_structure' || pinned.kind === 'hostile_unit') {
          hostile = true;
        } else if (pinned.kind === 'memory') {
          const i = memory === undefined ? -1 : indexOfHandle(memory.handles, pinned.handle);
          const faction = i === -1 ? pinned.faction : (memory?.faction[i] ?? pinned.faction);
          hostile = faction !== 0 && isHostile(observer, faction);
        }
        brackets.push({ ...box, tone: hostile ? 'pinned_hostile' : 'pinned_own' });
      }
    }
  }

  // 5. Hovered entity bracket (skip cell, multi_own, and handles already danger/pinned).
  if (
    hovered !== null &&
    hovered.kind !== 'cell' &&
    hovered.kind !== 'multi_own' &&
    !dangerHandles.has(hovered.handle) &&
    hovered.handle !== pinnedHandle
  ) {
    const box = resolveSubjectBox(db, structures, roadWorks, salvage, memory, units, hovered);
    if (box !== null) {
      brackets.push({ ...box, tone: 'hover' });
    }
  }

  // 6. Range & logistics circles (deduplicated by handle + kind).
  const seenCircles = new Set<string>();
  const pushCircle = (
    handle: number,
    cx: number,
    cy: number,
    radius: number,
    kind: HighlightCircle['kind'],
  ): void => {
    const key = `${handle}:${kind}`;
    if (seenCircles.has(key)) {
      return;
    }
    seenCircles.add(key);
    circles.push({ cx, cy, radius, kind });
  };

  const emitStructureCircles = (handle: number, row: number): boolean => {
    if (structures === undefined) {
      return false;
    }
    const st = db.structures.byIndex(structures.kind[row] ?? 0);
    if (st === undefined) {
      return false;
    }
    const faction = structures.faction[row] ?? 0;
    const cx = (structures.x[row] ?? 0) + st.footprint.w / 2;
    const cy = (structures.y[row] ?? 0) + st.footprint.h / 2;
    let emitted = false;
    if (st.weapon !== undefined && st.weapon.range > 0) {
      const kind: HighlightCircle['kind'] =
        faction === observer || !isHostile(observer, faction) ? 'weapon_own' : 'weapon_hostile';
      pushCircle(handle, cx, cy, st.weapon.range, kind);
      emitted = true;
    }
    if (st.node !== undefined && faction === observer) {
      if (st.node.service > 0) {
        pushCircle(handle, cx, cy, st.node.service, 'service');
        emitted = true;
      }
      if (st.node.connect > 0) {
        // node.connect is stored in cost units (cells × 10).
        pushCircle(handle, cx, cy, st.node.connect / 10, 'connect');
        emitted = true;
      }
    }
    return emitted;
  };

  const focus =
    hovered !== null && hovered.kind !== 'cell' && hovered.kind !== 'multi_own' ? hovered : pinned;
  let focusStructureHandle: number | null = null;

  if (focus !== null && focus.kind !== 'multi_own') {
    if (focus.kind === 'own_structure' || focus.kind === 'hostile_structure') {
      if (structures !== undefined) {
        const row = indexOfHandle(structures.handles, focus.handle);
        if (row !== -1) {
          focusStructureHandle = focus.handle;
          emitStructureCircles(focus.handle, row);
        }
      }
    } else if (focus.kind === 'own_unit' || focus.kind === 'hostile_unit') {
      const uPos = units.get(focus.handle);
      if (uPos !== undefined && denseUnits !== undefined) {
        const row = indexOfHandle(denseUnits.handles, focus.handle);
        if (row !== -1) {
          const uDef = db.units.byIndex(denseUnits.kind[row] ?? 0);
          if (uDef?.weapon !== undefined && uDef.weapon.range >= MIN_UNIT_RANGE_CIRCLE) {
            const faction = denseUnits.faction[row] ?? uPos.faction;
            const kind: HighlightCircle['kind'] =
              faction === observer || !isHostile(observer, faction)
                ? 'weapon_own'
                : 'weapon_hostile';
            pushCircle(focus.handle, uPos.x, uPos.y, uDef.weapon.range, kind);
          }
        }
      }
    }
  }

  if (selected.size > 0 && structures !== undefined) {
    let selectedCircleCount = 0;
    for (let i = 0; i < structures.handles.length; i++) {
      if (selectedCircleCount >= MAX_SELECTED_CIRCLE_STRUCTURES) {
        break;
      }
      const handle = structures.handles[i] ?? 0;
      if (
        handle === focusStructureHandle ||
        !selected.has(handle) ||
        (structures.faction[i] ?? 0) !== observer ||
        (structures.state[i] ?? 0) === STATE_RUIN
      ) {
        continue;
      }
      if (emitStructureCircles(handle, i)) {
        selectedCircleCount += 1;
      }
    }
  }

  return { brackets, circles };
}
