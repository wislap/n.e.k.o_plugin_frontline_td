// Fog-safe, snapshot-first inspector subject resolver (ADR 0048):
// joins HoverSubject / PinnableSubject with snapshot channels, terrain
// layers, ContentDb stats, and debounced own-entity SimClient.inspect
// sections without ever leaking unseen fog data or enemy internals.
import { readChannel, readLayer } from '../core/index';
import type { Inspection, Snapshot } from '../core/index';
import type { ContentDb, ResolvedMap, ResolvedStructure, ResolvedUnit } from '../content/index';
import { CapturePointsChannel } from '../features/capture/protocol';
import { COMBAT_INSPECTOR_ID, type CombatInspection } from '../features/combat/protocol';
import {
  CONSTRUCTION_INSPECTOR_ID,
  RoadWorksChannel,
  SalvageChannel,
  STATE_NAMES,
  StructuresChannel,
  type ConstructionInspection,
  type ConstructionStateName,
} from '../features/construction/protocol';
import {
  LOGISTICS_INSPECTOR_ID,
  ROAD_LAYER_ID,
  SERVICE_LAYER_ID,
  type LogisticsInspection,
} from '../features/logistics/protocol';
import {
  PRODUCTION_INSPECTOR_ID,
  type ProductionInspection,
} from '../features/production/protocol';
import { TERRAIN_HEIGHT_LAYER_ID, TERRAIN_SURFACE_LAYER_ID } from '../features/terrain/protocol';
import { DenseUnitsChannel } from '../features/units/protocol';
import { VISION_STATE_LAYER_ID, VisionMemoryChannel } from '../features/vision/protocol';
import { hostileExcluders } from '../features/vision/rules/index';
import type { HoverSubject } from './inspector-store';

interface MultiOwnBreakdownItem {
  category: 'unit' | 'structure';
  contentId: string;
  count: number;
}

export type ResolvedSubjectView =
  | {
      kind: 'multi_own';
      count: number;
      breakdown: MultiOwnBreakdownItem[];
    }
  | {
      kind: 'cell_unexplored';
      x: number;
      y: number;
    }
  | {
      kind: 'cell';
      x: number;
      y: number;
      visionState: 1 | 2;
      surfaceId: string | null;
      depositId: string | null;
      height: number;
      isRamp: boolean;
      roadLevel: number;
      covered: boolean;
      excluded: boolean;
    }
  | {
      kind: 'own_unit';
      handle: number;
      contentId: string;
      faction: number;
      moving: boolean;
      hpBp: number;
      energyBp: number | null;
      unit: ResolvedUnit | null;
      combat: CombatInspection | null;
      logistics: LogisticsInspection | null;
      modifiers: Inspection['modifiers'];
      hasInspection: boolean;
    }
  | {
      kind: 'hostile_unit';
      handle: number;
      contentId: string;
      faction: number;
      moving: boolean;
      hpBp: number;
      energyBp: number | null;
      unit: ResolvedUnit | null;
    }
  | {
      kind: 'own_structure';
      handle: number;
      contentId: string;
      faction: number;
      x: number;
      y: number;
      stateName: ConstructionStateName;
      progressBp: number;
      hpBp: number;
      structure: ResolvedStructure | null;
      construction: ConstructionInspection | null;
      combat: CombatInspection | null;
      logistics: LogisticsInspection | null;
      production: ProductionInspection | null;
      modifiers: Inspection['modifiers'];
      hasInspection: boolean;
    }
  | {
      kind: 'hostile_structure';
      handle: number;
      contentId: string;
      faction: number;
      x: number;
      y: number;
      stateName: ConstructionStateName;
      progressBp: number;
      hpBp: number;
      structure: ResolvedStructure | null;
    }
  | {
      kind: 'ruin';
      handle: number;
      contentId: string;
      x: number;
      y: number;
      structure: ResolvedStructure | null;
      progressBp: number;
      leader: number;
      owner: number;
      contested: boolean;
    }
  | {
      kind: 'salvage';
      handle: number;
      x: number;
      y: number;
      construction: ConstructionInspection | null;
      logistics: LogisticsInspection | null;
      hasInspection: boolean;
    }
  | {
      kind: 'road_segment';
      handle: number;
      x: number;
      y: number;
      progressBp: number;
      hpBp: number;
      construction: ConstructionInspection | null;
      logistics: LogisticsInspection | null;
      combat: CombatInspection | null;
      hasInspection: boolean;
    }
  | {
      kind: 'memory';
      handle: number;
      contentId: string;
      x: number;
      y: number;
      faction: number;
      stateName: ConstructionStateName;
      structure: ResolvedStructure | null;
    };

export interface ResolveInspectInput {
  db: ContentDb;
  map: ResolvedMap | null;
  snapshot: Snapshot | null;
  isHostile: (observer: number, faction: number) => boolean;
  subject: HoverSubject | null;
  selected: ReadonlySet<number>;
  inspection: Inspection | null;
}

function indexOfHandle(handles: Float64Array, handle: number): number {
  for (let i = 0; i < handles.length; i++) {
    if (handles[i] === handle) {
      return i;
    }
  }
  return -1;
}

function stateNameOf(code: number): ConstructionStateName {
  return STATE_NAMES[code] ?? 'operational';
}

export function resolveInspectedSubject(input: ResolveInspectInput): ResolvedSubjectView | null {
  const { db, map, snapshot, isHostile, subject, selected, inspection } = input;
  if (subject === null) {
    return null;
  }
  const observer = snapshot?.observer ?? 0;

  switch (subject.kind) {
    case 'multi_own': {
      const units = readChannel(snapshot, DenseUnitsChannel) ?? undefined;
      const structures = readChannel(snapshot, StructuresChannel) ?? undefined;
      const unitCounts = new Map<string, number>();
      const structureCounts = new Map<string, number>();
      if (units !== undefined) {
        for (let i = 0; i < units.handles.length; i++) {
          if (selected.has(units.handles[i] ?? 0)) {
            const contentId = db.units.byIndex(units.kind[i] ?? 0)?.id ?? 'unknown';
            unitCounts.set(contentId, (unitCounts.get(contentId) ?? 0) + 1);
          }
        }
      }
      if (structures !== undefined) {
        for (let i = 0; i < structures.handles.length; i++) {
          if (selected.has(structures.handles[i] ?? 0)) {
            const contentId = db.structures.byIndex(structures.kind[i] ?? 0)?.id ?? 'unknown';
            structureCounts.set(contentId, (structureCounts.get(contentId) ?? 0) + 1);
          }
        }
      }
      const breakdown: MultiOwnBreakdownItem[] = [];
      for (const [contentId, count] of unitCounts) {
        breakdown.push({ category: 'unit', contentId, count });
      }
      for (const [contentId, count] of structureCounts) {
        breakdown.push({ category: 'structure', contentId, count });
      }
      breakdown.sort(
        (a, b) =>
          b.count - a.count ||
          a.category.localeCompare(b.category) ||
          a.contentId.localeCompare(b.contentId),
      );
      return {
        kind: 'multi_own',
        count: selected.size > 0 ? selected.size : subject.count,
        breakdown,
      };
    }

    case 'cell': {
      if (map === null) {
        return null;
      }
      const { x, y } = subject;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
        return null;
      }
      const idx = y * map.width + x;
      const fogLayer = readLayer(snapshot, `${VISION_STATE_LAYER_ID}#${observer}`);
      if (fogLayer !== null && (fogLayer[idx] ?? 0) === 0) {
        return { kind: 'cell_unexplored', x, y };
      }
      const visionState: 1 | 2 = fogLayer !== null && (fogLayer[idx] ?? 0) === 1 ? 1 : 2;
      const surfaceLayer = readLayer(snapshot, TERRAIN_SURFACE_LAYER_ID);
      const surfaceIdx =
        surfaceLayer !== null ? (surfaceLayer[idx] ?? 0) : (map.grid.surfaces[idx] ?? 0);
      const surface = db.surfaces.byIndex(surfaceIdx);
      const depositId =
        surface?.deposit !== undefined ? (db.cargos.byIndex(surface.deposit)?.id ?? null) : null;

      const heightLayer = readLayer(snapshot, TERRAIN_HEIGHT_LAYER_ID);
      const height = heightLayer !== null ? (heightLayer[idx] ?? 0) : (map.grid.heights[idx] ?? 0);
      const isRamp = (map.grid.ramps[idx] ?? 0) !== 0;

      const roadLayer = readLayer(snapshot, ROAD_LAYER_ID);
      const roadLevel = roadLayer !== null ? (roadLayer[idx] ?? 0) : 0;

      const serviceLayer = readLayer(snapshot, `${SERVICE_LAYER_ID}#${observer}`);
      const covered = serviceLayer !== null ? (serviceLayer[idx] ?? 0) !== 0 : false;

      const structures = readChannel(snapshot, StructuresChannel) ?? undefined;
      const memory = readChannel(snapshot, VisionMemoryChannel) ?? undefined;
      const excluders = hostileExcluders(db, (faction) => isHostile(observer, faction), [
        structures,
        memory,
      ]);
      const excluded = excluders.some((e) => {
        const dx = x + 0.5 - e.cx;
        const dy = y + 0.5 - e.cy;
        return dx * dx + dy * dy <= e.r * e.r;
      });

      return {
        kind: 'cell',
        x,
        y,
        visionState,
        surfaceId: surface?.id ?? null,
        depositId,
        height,
        isRamp,
        roadLevel,
        covered,
        excluded,
      };
    }

    case 'own_unit':
    case 'hostile_unit': {
      const units = readChannel(snapshot, DenseUnitsChannel) ?? undefined;
      if (units === undefined) {
        return null;
      }
      const i = indexOfHandle(units.handles, subject.handle);
      if (i === -1) {
        return null;
      }
      const unit = db.units.byIndex(units.kind[i] ?? 0) ?? null;
      const contentId = unit?.id ?? 'unknown';
      const faction = units.faction[i] ?? 0;
      const moving = (units.moving[i] ?? 0) !== 0;
      const hpBp = units.hpBp[i] ?? 0;
      const rawEnergy = units.energyBp[i] ?? 0xffff;
      const energyBp = rawEnergy === 0xffff ? null : rawEnergy;

      if (subject.kind === 'hostile_unit') {
        return {
          kind: 'hostile_unit',
          handle: subject.handle,
          contentId,
          faction,
          moving,
          hpBp,
          energyBp,
          unit,
        };
      }

      const matched =
        inspection !== null && inspection.handle === subject.handle ? inspection : null;
      return {
        kind: 'own_unit',
        handle: subject.handle,
        contentId,
        faction,
        moving,
        hpBp,
        energyBp,
        unit,
        combat: (matched?.sections[COMBAT_INSPECTOR_ID] as CombatInspection | undefined) ?? null,
        logistics:
          (matched?.sections[LOGISTICS_INSPECTOR_ID] as LogisticsInspection | undefined) ?? null,
        modifiers: matched?.modifiers ?? [],
        hasInspection: matched !== null,
      };
    }

    case 'own_structure':
    case 'hostile_structure': {
      const structures = readChannel(snapshot, StructuresChannel) ?? undefined;
      if (structures === undefined) {
        return null;
      }
      const i = indexOfHandle(structures.handles, subject.handle);
      if (i === -1) {
        return null;
      }
      const structure = db.structures.byIndex(structures.kind[i] ?? 0) ?? null;
      const contentId = structure?.id ?? 'unknown';
      const faction = structures.faction[i] ?? 0;
      const x = structures.x[i] ?? 0;
      const y = structures.y[i] ?? 0;
      const stateName = stateNameOf(structures.state[i] ?? 0);
      const progressBp = structures.progressBp[i] ?? 0;
      const hpBp = structures.hpBp[i] ?? 0;

      if (subject.kind === 'hostile_structure') {
        return {
          kind: 'hostile_structure',
          handle: subject.handle,
          contentId,
          faction,
          x,
          y,
          stateName,
          progressBp,
          hpBp,
          structure,
        };
      }

      const matched =
        inspection !== null && inspection.handle === subject.handle ? inspection : null;
      return {
        kind: 'own_structure',
        handle: subject.handle,
        contentId,
        faction,
        x,
        y,
        stateName,
        progressBp,
        hpBp,
        structure,
        construction:
          (matched?.sections[CONSTRUCTION_INSPECTOR_ID] as ConstructionInspection | undefined) ??
          null,
        combat: (matched?.sections[COMBAT_INSPECTOR_ID] as CombatInspection | undefined) ?? null,
        logistics:
          (matched?.sections[LOGISTICS_INSPECTOR_ID] as LogisticsInspection | undefined) ?? null,
        production:
          (matched?.sections[PRODUCTION_INSPECTOR_ID] as ProductionInspection | undefined) ?? null,
        modifiers: matched?.modifiers ?? [],
        hasInspection: matched !== null,
      };
    }

    case 'ruin': {
      const structures = readChannel(snapshot, StructuresChannel) ?? undefined;
      if (structures === undefined) {
        return null;
      }
      const i = indexOfHandle(structures.handles, subject.handle);
      if (i === -1) {
        return null;
      }
      const structure = db.structures.byIndex(structures.kind[i] ?? 0) ?? null;
      const contentId = structure?.id ?? 'unknown';
      const cp = readChannel(snapshot, CapturePointsChannel) ?? undefined;
      const ci = cp === undefined ? -1 : indexOfHandle(cp.handles, subject.handle);
      return {
        kind: 'ruin',
        handle: subject.handle,
        contentId,
        x: structures.x[i] ?? 0,
        y: structures.y[i] ?? 0,
        structure,
        progressBp: ci === -1 ? 0 : (cp?.progressBp[ci] ?? 0),
        leader: ci === -1 ? 0 : (cp?.leader[ci] ?? 0),
        owner: ci === -1 ? 0 : (cp?.owner[ci] ?? 0),
        contested: ci !== -1 && (cp?.contested[ci] ?? 0) !== 0,
      };
    }

    case 'salvage': {
      const salvage = readChannel(snapshot, SalvageChannel) ?? undefined;
      if (salvage === undefined) {
        return null;
      }
      const i = indexOfHandle(salvage.handles, subject.handle);
      if (i === -1) {
        return null;
      }
      const matched =
        inspection !== null && inspection.handle === subject.handle ? inspection : null;
      return {
        kind: 'salvage',
        handle: subject.handle,
        x: salvage.x[i] ?? 0,
        y: salvage.y[i] ?? 0,
        construction:
          (matched?.sections[CONSTRUCTION_INSPECTOR_ID] as ConstructionInspection | undefined) ??
          null,
        logistics:
          (matched?.sections[LOGISTICS_INSPECTOR_ID] as LogisticsInspection | undefined) ?? null,
        hasInspection: matched !== null,
      };
    }

    case 'road_segment': {
      const roadWorks = readChannel(snapshot, RoadWorksChannel) ?? undefined;
      if (roadWorks === undefined) {
        return null;
      }
      const segs = roadWorks.segments;
      const i = indexOfHandle(segs.handles, subject.handle);
      if (i === -1) {
        return null;
      }
      const matched =
        inspection !== null && inspection.handle === subject.handle ? inspection : null;
      return {
        kind: 'road_segment',
        handle: subject.handle,
        x: segs.x[i] ?? 0,
        y: segs.y[i] ?? 0,
        progressBp: segs.progressBp[i] ?? 0,
        hpBp: segs.hpBp[i] ?? 0,
        construction:
          (matched?.sections[CONSTRUCTION_INSPECTOR_ID] as ConstructionInspection | undefined) ??
          null,
        logistics:
          (matched?.sections[LOGISTICS_INSPECTOR_ID] as LogisticsInspection | undefined) ?? null,
        combat: (matched?.sections[COMBAT_INSPECTOR_ID] as CombatInspection | undefined) ?? null,
        hasInspection: matched !== null,
      };
    }

    case 'memory': {
      const memory = readChannel(snapshot, VisionMemoryChannel) ?? undefined;
      const i = memory === undefined ? -1 : indexOfHandle(memory.handles, subject.handle);
      const kindIndex = i === -1 ? subject.kindIndex : (memory?.kind[i] ?? subject.kindIndex);
      const x = i === -1 ? subject.x : (memory?.x[i] ?? subject.x);
      const y = i === -1 ? subject.y : (memory?.y[i] ?? subject.y);
      const faction = i === -1 ? subject.faction : (memory?.faction[i] ?? subject.faction);
      const stateCode = i === -1 ? subject.state : (memory?.state[i] ?? subject.state);
      const structure = db.structures.byIndex(kindIndex) ?? null;
      return {
        kind: 'memory',
        handle: subject.handle,
        contentId: structure?.id ?? 'unknown',
        x,
        y,
        faction,
        stateName: stateNameOf(stateCode),
        structure,
      };
    }
  }
}
