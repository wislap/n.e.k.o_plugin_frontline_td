// Content pipeline (ADR 0022): validates every base-pack registry against
// its feature schema, checks ids, assigns numeric indices by sorting full
// ids, runs conversions (ADR 0020) and checks cross-registry references.
// Every problem is collected and reported in ONE error; the db is returned
// to the caller — module-level caching is not allowed.
import type { ContentId } from '../core/index';
import { TICKS_PER_SECOND } from '../core/index';
import { s } from '../core/index';
import type { AnySchema, Infer } from '../core/index';
import { decodeMap } from '../features/terrain/content';
import type { MapContent, TerrainGrid } from '../features/terrain/content';
import { mapSchema, movementClassSchema, surfaceSchema } from '../features/terrain/content';
import { unitSchema } from '../features/units/content';
import { BASE_PACK_CONTENT } from './packs';

export interface Registry<T> {
  byId(id: string): T | undefined;
  byIndex(index: number): T | undefined;
  readonly list: readonly T[];
}

export interface ResolvedMovementClass {
  id: ContentId;
  index: number;
}

export interface ResolvedSurface {
  id: ContentId;
  index: number;
  // Per movement-class index step cost; -1 = impassable.
  costs: readonly number[];
  speedBp: number;
  color: string;
}

export interface ResolvedUnit {
  id: ContentId;
  index: number;
  // cells/tick (speed / TICKS_PER_SECOND)
  cellsPerTick: number;
  radius: number;
  movementClass: number;
}

export interface ResolvedMap {
  id: ContentId;
  index: number;
  width: number;
  height: number;
  points: MapContent['points'];
  grid: TerrainGrid;
}

export interface ContentDb {
  surfaces: Registry<ResolvedSurface>;
  movementClasses: Registry<ResolvedMovementClass>;
  units: Registry<ResolvedUnit>;
  maps: Registry<ResolvedMap>;
}

const BASE_PACK_PREFIX = 'frontline_td:';

function makeRegistry<T extends { index: number; id: string }>(entries: readonly T[]): Registry<T> {
  const byId = new Map<string, T>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
  }
  return {
    byId: (id) => byId.get(id),
    byIndex: (index) => entries[index],
    list: entries,
  };
}

// Validate + index one registry. Returns parsed entries sorted by full id
// with `index` assigned, or appends to `errors`.
function indexRegistry<S extends AnySchema>(
  registry: string,
  schema: S,
  raw: readonly unknown[],
  errors: string[],
): Infer<S>[] {
  const parsed: Infer<S>[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const result = s.validate(schema, entry);
    if (!result.ok) {
      errors.push(`${registry}${result.path.slice(1)}: ${result.message}`);
      continue;
    }
    const value = result.value as Infer<S> & { id?: string };
    const id = typeof value.id === 'string' ? value.id : '';
    if (!id.startsWith(BASE_PACK_PREFIX)) {
      errors.push(`${registry}: id '${id}' is not in the base pack`);
    }
    if (seen.has(id)) {
      errors.push(`${registry}: duplicate id '${id}'`);
    }
    seen.add(id);
    parsed.push(result.value);
  }
  parsed.sort((a, b) => {
    const ai = (a as { id?: string }).id ?? '';
    const bi = (b as { id?: string }).id ?? '';
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });
  return parsed;
}

export interface ContentSource {
  surfaces: readonly unknown[];
  movementClasses: readonly unknown[];
  units: readonly unknown[];
  maps: readonly unknown[];
}

export function loadContent(source: ContentSource = BASE_PACK_CONTENT): ContentDb {
  const errors: string[] = [];

  const classEntries = indexRegistry<typeof movementClassSchema>(
    'movementClasses',
    movementClassSchema,
    source.movementClasses,
    errors,
  );
  const surfaceEntries = indexRegistry<typeof surfaceSchema>(
    'surfaces',
    surfaceSchema,
    source.surfaces,
    errors,
  );
  const unitEntries = indexRegistry<typeof unitSchema>('units', unitSchema, source.units, errors);
  const mapEntries = indexRegistry<typeof mapSchema>('maps', mapSchema, source.maps, errors);

  const resolvedClasses: ResolvedMovementClass[] = classEntries.map((entry, index) => ({
    id: entry.id,
    index,
  }));
  const classIndex = new Map<string, number>(resolvedClasses.map((c) => [c.id, c.index]));

  const resolvedSurfaces: ResolvedSurface[] = surfaceEntries.map((entry, index) => {
    const costs = new Array<number>(resolvedClasses.length).fill(-1);
    for (const [classId, cost] of Object.entries(entry.costs)) {
      const ci = classIndex.get(classId);
      if (ci === undefined) {
        errors.push(`surfaces: '${entry.id}' costs reference unknown movement class '${classId}'`);
        continue;
      }
      costs[ci] = cost;
    }
    return { id: entry.id, index, costs, speedBp: entry.speedBp, color: entry.color };
  });
  const surfaceIdToIndex = new Map<string, number>(resolvedSurfaces.map((s_) => [s_.id, s_.index]));

  const resolvedUnits: ResolvedUnit[] = unitEntries.map((entry, index) => {
    const movementClass = classIndex.get(entry.movementClass);
    if (movementClass === undefined) {
      errors.push(
        `units: '${entry.id}' references unknown movement class '${entry.movementClass}'`,
      );
    }
    return {
      id: entry.id,
      index,
      cellsPerTick: entry.speed / TICKS_PER_SECOND,
      radius: entry.radius,
      movementClass: movementClass ?? -1,
    };
  });

  const resolvedMaps: ResolvedMap[] = mapEntries.map((entry, index) => {
    const decoded = decodeMap(entry, (id) => surfaceIdToIndex.get(id));
    if ('errors' in decoded) {
      errors.push(...decoded.errors);
      return {
        id: entry.id,
        index,
        width: entry.width,
        height: entry.height,
        points: entry.points,
        grid: {
          width: entry.width,
          height: entry.height,
          heights: new Uint8Array(entry.width * entry.height),
          surfaces: new Uint16Array(entry.width * entry.height),
          ramps: new Uint8Array(entry.width * entry.height),
        },
      };
    }
    return {
      id: entry.id,
      index,
      width: entry.width,
      height: entry.height,
      points: entry.points,
      grid: decoded.grid,
    };
  });

  if (errors.length > 0) {
    throw new Error(`content load failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }

  return {
    surfaces: makeRegistry(resolvedSurfaces),
    movementClasses: makeRegistry(resolvedClasses),
    units: makeRegistry(resolvedUnits),
    maps: makeRegistry(resolvedMaps),
  };
}
