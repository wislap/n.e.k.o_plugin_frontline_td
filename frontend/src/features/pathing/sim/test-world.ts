// Shared test helpers for pathing sim tests (string-map grids and the
// module api). Not part of the sim surface — test code only.
import { contentId } from '../../../core/index';
import type { ResolvedSurface } from '../../../content/load';
import { createTerrainApi } from '../../terrain/sim/index';
import { createPathingModule } from './index';
import { makeGrid } from '../../../testing/index';

export const CLS = 0;
const SURFACES: ResolvedSurface[] = [
  { id: contentId('a:g'), index: 0, costs: [10], speedBp: 10000, color: '#000000' },
  { id: contentId('a:x'), index: 1, costs: [-1], speedBp: 10000, color: '#000000' },
];

// Build a grid from a string map: '.' ground, '#' impassable, 'r' ramp,
// digits '1'-'9' = ground at that height.

export function makePathing(rows: string[]) {
  const grid = makeGrid(rows);
  const terrain = createTerrainApi(grid, SURFACES);
  const { api } = createPathingModule(terrain, 1);
  return { api, grid, terrain };
}
