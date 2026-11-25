// Minimap contribution assembly (ADR 0062 step 4a): app is the only
// place feature raster/mask lists are combined. sortContributions pins
// the historical draw order: threats → memories → structures → ruin
// overlays → units over the base→roads→fog raster stack.
import { sortContributions } from '../client/contributions';
import { captureMinimapMarks } from '../features/capture/ui/index';
import { constructionMinimapMarks } from '../features/construction/ui/index';
import { logisticsMinimapRasters } from '../features/logistics/ui/index';
import { squadsMinimapMarks } from '../features/squads/ui/index';
import { terrainMinimapRasters } from '../features/terrain/ui/index';
import { unitsMinimapMarks } from '../features/units/ui/index';
import { visionMinimapMarks, visionMinimapRasters } from '../features/vision/ui/index';

export const MINIMAP_RASTERS = sortContributions([
  ...terrainMinimapRasters,
  ...logisticsMinimapRasters,
  ...visionMinimapRasters,
]);

export const MINIMAP_MARKS = sortContributions([
  ...squadsMinimapMarks,
  ...visionMinimapMarks,
  ...constructionMinimapMarks,
  ...captureMinimapMarks,
  ...unitsMinimapMarks,
]);
