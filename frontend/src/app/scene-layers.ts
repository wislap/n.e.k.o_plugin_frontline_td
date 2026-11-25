// Scene layer assembly (ADR 0062): app is the only place feature
// contribution lists are combined. sortContributions reproduces the
// pre-registry mount order.
import { captureSceneLayers } from '../features/capture/render/index';
import { combatSceneLayers } from '../features/combat/render/index';
import { constructionSceneLayers } from '../features/construction/render/index';
import { logisticsSceneLayers } from '../features/logistics/render/index';
import { selectionSceneLayers } from '../features/selection/render/index';
import { squadsSceneLayers } from '../features/squads/render/index';
import { terrainSceneLayers } from '../features/terrain/render/index';
import { unitsSceneLayers } from '../features/units/render/index';
import { visionSceneLayers } from '../features/vision/render/index';
import { sortContributions } from '../client/contributions';

export const SCENE_LAYERS = sortContributions([
  ...terrainSceneLayers,
  ...constructionSceneLayers,
  ...unitsSceneLayers,
  ...squadsSceneLayers,
  ...logisticsSceneLayers,
  ...visionSceneLayers,
  ...captureSceneLayers,
  ...combatSceneLayers,
  ...selectionSceneLayers,
]);
