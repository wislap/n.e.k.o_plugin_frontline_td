// Scene layer contributions (ADR 0062): terrain ground mesh and the
// deterministic scatter dressing. Order values reproduce the pre-registry
// mount order — scatter sat between the road layer and the logistics
// overlay in the old GameCanvas JSX.
import { SCENE_ORDER, type SceneLayerDef } from '../../../render/scene';
import { ScatterLayer } from './ScatterLayer';
import { TerrainMesh } from './TerrainMesh';

export const terrainSceneLayers: readonly SceneLayerDef[] = [
  { id: 'terrain.mesh', order: SCENE_ORDER.ground, Component: TerrainMesh },
  { id: 'terrain.scatter', order: SCENE_ORDER.overlay + 1, Component: ScatterLayer },
];
