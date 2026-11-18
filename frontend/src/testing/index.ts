// Shared test-only helpers (ADR 0043): may only be imported by
// *.test.ts(x) and **/test-world.ts, and may only import the public
// entry points tests may use — both enforced by dependency-cruiser.
import type { FactionId } from '../core/index';
import type { Simulation } from '../kernel/index';
import type { TerrainGrid } from '../features/terrain/content';
import type { DenseUnits } from '../features/units/sim/index';
import { DenseUnitsChannel } from '../features/units/sim/index';

// Grid builder from ASCII rows: '.' (anything else) = flat ground,
// '#' = rock surface 1, '^' or 'r' = ramp, 'p' = plateau (height 1),
// '1'..'9' = height level.
export function makeGrid(rows: string[]): TerrainGrid {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const heights = new Uint8Array(width * height);
  const surfaces = new Uint16Array(width * height);
  const ramps = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      const idx = y * width + x;
      if (ch === '#') {
        surfaces[idx] = 1;
      } else if (ch === '^' || ch === 'r') {
        ramps[idx] = 1;
      } else if (ch === 'p') {
        heights[idx] = 1;
      } else if (ch !== undefined && ch >= '1' && ch <= '9') {
        heights[idx] = ch.charCodeAt(0) - 48;
      }
    }
  });
  return { width, height, heights, surfaces, ramps };
}

// Require a base-pack entry by name: throws with the entry name when
// the registry lookup misses (a content bug, not a test expectation).
export function must<T>(v: T | undefined, name: string): T {
  if (v === undefined) {
    throw new Error(`base pack entry '${name}' missing`);
  }
  return v;
}

// Read the dense-units snapshot channel for one faction (the common
// `dense(sim)` helper previously copy-pasted per test world).
export function denseUnits(sim: Simulation, faction: FactionId): DenseUnits {
  return sim.snapshot(faction).channels[DenseUnitsChannel.id] as DenseUnits;
}
