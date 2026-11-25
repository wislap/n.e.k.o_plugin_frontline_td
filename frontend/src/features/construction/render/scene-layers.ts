// Scene layer contributions (ADR 0062): structures + their HP bars,
// road works + their HP bars, the build ghost, and hostile exclusion
// circles. Order values reproduce the pre-registry mount order.
import { SCENE_ORDER, type SceneLayerDef } from '../../../render/scene';
import { ExclusionLayer } from './ExclusionLayer';
import { GhostPreview } from './GhostPreview';
import { RoadWorksHpBars, RoadWorksLayer } from './RoadWorksLayer';
import { StructureHpBars } from './StructureHpBars';
import { StructuresLayer } from './StructuresLayer';

export const constructionSceneLayers: readonly SceneLayerDef[] = [
  { id: 'construction.structures', order: SCENE_ORDER.entities, Component: StructuresLayer },
  { id: 'construction.structure-hp', order: SCENE_ORDER.entities + 4, Component: StructureHpBars },
  { id: 'construction.roadworks', order: SCENE_ORDER.overlay + 4, Component: RoadWorksLayer },
  { id: 'construction.roadworks-hp', order: SCENE_ORDER.overlay + 5, Component: RoadWorksHpBars },
  { id: 'construction.ghost', order: SCENE_ORDER.overlay + 6, Component: GhostPreview },
  { id: 'construction.exclusion', order: SCENE_ORDER.overlay + 7, Component: ExclusionLayer },
];
