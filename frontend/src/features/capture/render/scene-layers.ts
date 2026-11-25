// Scene layer contributions (ADR 0062): capture-point rings.
// Order values reproduce the pre-registry mount order.
import { SCENE_ORDER, type SceneLayerDef } from '../../../render/scene';
import { CaptureLayer } from './CaptureLayer';

export const captureSceneLayers: readonly SceneLayerDef[] = [
  { id: 'capture.capture', order: SCENE_ORDER.overlay + 9, Component: CaptureLayer },
];
