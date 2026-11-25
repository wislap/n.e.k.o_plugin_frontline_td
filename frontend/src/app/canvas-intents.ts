// Canvas intent handler assembly (ADR 0062): app is the only place
// feature handler lists are combined into the registry the GameCanvas
// dispatch consults for non-camera intents.
import { indexCanvasIntentHandlers } from '../render/canvas-input';
import { constructionCanvasIntents } from '../features/construction/ui/index';
import { logisticsCanvasIntents } from '../features/logistics/ui/index';
import { selectionCanvasIntents } from '../features/selection/ui/index';
import { squadsCanvasIntents } from '../features/squads/ui/index';

export const CANVAS_INTENTS = indexCanvasIntentHandlers([
  ...selectionCanvasIntents,
  ...constructionCanvasIntents,
  ...logisticsCanvasIntents,
  ...squadsCanvasIntents,
]);
