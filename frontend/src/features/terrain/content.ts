// Terrain feature content schemas (ADR 0015): movement classes, surfaces and
// grid maps. Loader-side resolution lives in content/load.ts; this file only
// declares wire shapes and the decoded TerrainGrid type.
import { s } from '../../core/index';
import type { ContentId, Infer } from '../../core/index';

export const movementClassSchema = s.object({
  id: s.contentId(),
});
export type MovementClassContent = Infer<typeof movementClassSchema>;

// A class missing from `costs` is impassable on the surface.
export const surfaceSchema = s.object({
  id: s.contentId(),
  costs: s.record(s.int({ min: 1, max: 1000 }), { maxLength: 16 }),
  speedBp: s.int({ min: 1, max: 20000 }),
  color: s.string({ pattern: /^#[0-9a-f]{6}$/ }),
});
export type SurfaceContent = Infer<typeof surfaceSchema>;

export const mapSchema = s.object({
  formatVersion: s.literal(1),
  id: s.contentId(),
  width: s.int({ min: 16, max: 1024 }),
  height: s.int({ min: 16, max: 1024 }),
  legend: s.record(
    s.object({
      surface: s.contentId(),
      height: s.int({ min: 0, max: 15 }),
      ramp: s.optional(s.bool()),
    }),
    { maxLength: 64 },
  ),
  rows: s.array(s.string(), { maxLength: 1024 }),
  points: s.record(s.object({ x: s.int(), y: s.int() }), { maxLength: 64 }),
});
export type MapContent = Infer<typeof mapSchema>;

export interface TerrainGrid {
  width: number;
  height: number;
  heights: Uint8Array;
  // Surface registry index per cell (index assigned by the content loader).
  surfaces: Uint16Array;
  ramps: Uint8Array;
}

export function decodeMap(
  map: MapContent,
  surfaceIndex: (id: ContentId) => number | undefined,
): { grid: TerrainGrid } | { errors: string[] } {
  const errors: string[] = [];
  if (map.rows.length !== map.height) {
    errors.push(`map '${map.id}': expected ${map.height} rows, got ${map.rows.length}`);
  }
  const heights = new Uint8Array(map.width * map.height);
  const surfaces = new Uint16Array(map.width * map.height);
  const ramps = new Uint8Array(map.width * map.height);
  for (let y = 0; y < map.rows.length; y++) {
    const row = map.rows[y];
    if (row === undefined) {
      continue;
    }
    if (row.length !== map.width) {
      errors.push(`map '${map.id}': row ${y} has length ${row.length}, expected ${map.width}`);
      continue;
    }
    for (let x = 0; x < map.width; x++) {
      const key = row[x];
      const entry = key === undefined ? undefined : map.legend[key];
      const idx = y * map.width + x;
      if (entry === undefined) {
        errors.push(`map '${map.id}': cell (${x},${y}) uses unknown legend char '${key ?? ''}'`);
        continue;
      }
      const surface = surfaceIndex(entry.surface);
      if (surface === undefined) {
        errors.push(
          `map '${map.id}': legend '${key}' references unknown surface '${entry.surface}'`,
        );
        continue;
      }
      heights[idx] = entry.height;
      surfaces[idx] = surface;
      ramps[idx] = entry.ramp === true ? 1 : 0;
    }
  }
  for (const [name, point] of Object.entries(map.points)) {
    if (point.x < 0 || point.x >= map.width || point.y < 0 || point.y >= map.height) {
      errors.push(`map '${map.id}': point '${name}' (${point.x},${point.y}) is outside the map`);
    }
  }
  if (errors.length > 0) {
    return { errors };
  }
  return { grid: { width: map.width, height: map.height, heights, surfaces, ramps } };
}
