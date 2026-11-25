// Scene layer contributions (ADR 0062): director threat markers.
// Order values reproduce the pre-registry mount order.
import { SCENE_ORDER, type SceneLayerDef } from '../../../render/scene';
import { ThreatsLayer } from './ThreatsLayer';

export const squadsSceneLayers: readonly SceneLayerDef[] = [
  { id: 'squads.threats', order: SCENE_ORDER.entities + 2, Component: ThreatsLayer },
];
