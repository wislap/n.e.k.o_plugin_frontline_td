// Scene layer contributions (ADR 0062): paved road cells, the logistics
// coverage/link overlay, and road-tool visuals. Order values reproduce
// the pre-registry mount order.
import { SCENE_ORDER, type SceneLayerDef } from '../../../render/scene';
import { LogisticsOverlay } from './LogisticsOverlay';
import { RoadLayer } from './RoadLayer';
import { RoadToolLayer } from './RoadToolLayer';

export const logisticsSceneLayers: readonly SceneLayerDef[] = [
  { id: 'logistics.road', order: SCENE_ORDER.overlay, Component: RoadLayer },
  { id: 'logistics.overlay', order: SCENE_ORDER.overlay + 2, Component: LogisticsOverlay },
  { id: 'logistics.road-tool', order: SCENE_ORDER.overlay + 3, Component: RoadToolLayer },
];
