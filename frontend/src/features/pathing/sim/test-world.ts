// Shared test helpers for pathing sim tests (string-map grids and the
// module api). Not part of the sim surface — test code only.
import { contentId } from '../../../core/index';
import type { ResolvedSurface } from '../../../content/load';
import type { TerrainGrid } from '../../terrain/content';
import { createTerrainApi } from '../../terrain/sim/index';
import { createPathingModule } from './index';

export const CLS = 0;
const SURFACES: ResolvedSurface[] = [
  { id: contentId('a:g'), index: 0, costs: [10], speedBp: 10000, color: '#000000' },
  { id: contentId('a:x'), index: 1, costs: [-1], speedBp: 10000, color: '#000000' },
];

// Build a grid from a string map: '.' ground, '#' impassable, 'r' ramp,
// digits '1'-'9' = ground at that height.
function makeGrid(rows: string[]): {
  grid: TerrainGrid;
  width: number;
  height: number;
} {
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
      } else if (ch === 'r') {
        ramps[idx] = 1;
      } else if (ch !== undefined && ch >= '1' && ch <= '9') {
        heights[idx] = ch.charCodeAt(0) - 48;
      }
    }
  });
  return { grid: { width, height, heights, surfaces, ramps }, width, height };
}

export function makePathing(rows: string[]) {
  const { grid } = makeGrid(rows);
  const terrain = createTerrainApi(grid, SURFACES);
  const { api } = createPathingModule(terrain, 1);
  return { api, grid, terrain };
}
