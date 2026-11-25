// Selection scene layer contribution (ADR 0062 step 4b): the highlight
// overlay mounts after every feature layer, reproducing its old position
// at the end of the layer list in GameCanvas.
import { SCENE_ORDER, type SceneLayerDef } from '../../../render/scene';
import { SelectionHighlightLayer } from './SelectionHighlightLayer';

export const selectionSceneLayers: readonly SceneLayerDef[] = [
  {
    id: 'selection.highlights',
    order: SCENE_ORDER.fog + 1,
    Component: SelectionHighlightLayer,
  },
];
