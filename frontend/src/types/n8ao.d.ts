// n8ao ships no typings; declare the surface we use (N8AOPostPass
// configuration + quality mode). Mirrors the documented proxy keys.
declare module 'n8ao' {
  import type { Pass } from 'postprocessing';
  import type { Camera, Object3D } from 'three';

  interface N8AOConfiguration {
    aoRadius: number;
    intensity: number;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    denoiseIterations: number;
    transparencyAware: boolean;
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Object3D, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    setQualityMode(mode: string): void;
  }
}
