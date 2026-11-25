// Scene layer contributions (ADR 0062): remembered structures overlay
// and the fog-of-war state texture owner (renders no mesh). Order values
// reproduce the pre-registry mount order; FogOfWar's position does not
// matter since it draws nothing.
import { SCENE_ORDER, type SceneLayerDef } from '../../../render/scene';
import { FogOfWar } from './fog-of-war';
import { MemoryLayer } from './MemoryLayer';

export const visionSceneLayers: readonly SceneLayerDef[] = [
  { id: 'vision.memory', order: SCENE_ORDER.overlay + 8, Component: MemoryLayer },
  { id: 'vision.fog', order: SCENE_ORDER.fog, Component: FogOfWar },
];
