// Scene layer contributions (ADR 0062): shot tracers.
// Order values reproduce the pre-registry mount order.
import { SCENE_ORDER, type SceneLayerDef } from '../../../render/scene';
import { BeamsLayer } from './BeamsLayer';

export const combatSceneLayers: readonly SceneLayerDef[] = [
  { id: 'combat.beams', order: SCENE_ORDER.overlay + 10, Component: BeamsLayer },
];
