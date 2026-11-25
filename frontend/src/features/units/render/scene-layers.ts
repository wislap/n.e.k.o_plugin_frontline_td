// Scene layer contributions (ADR 0062): instanced units plus their
// damaged-unit HP bars. Order values reproduce the pre-registry mount
// order.
import { SCENE_ORDER, type SceneLayerDef } from '../../../render/scene';
import { UnitHpBars } from './UnitHpBars';
import { UnitsLayer } from './UnitsLayer';

export const unitsSceneLayers: readonly SceneLayerDef[] = [
  { id: 'units.units', order: SCENE_ORDER.entities + 1, Component: UnitsLayer },
  { id: 'units.hp', order: SCENE_ORDER.entities + 3, Component: UnitHpBars },
];
