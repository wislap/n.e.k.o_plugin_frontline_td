// Live per-frame camera mode transition state written by CameraRig
// (useFrame priority -500) and read by lighting, post, fog, and scene
// layers (useFrame priority 0) in the same frame — never React state.
import { SPECTATE_PITCH_DEG } from '../client/camera-math';

export interface CameraTransitionState {
  // 0 = pure 3D spectate, 1 = settled 2D tactical, (0, 1) = transitioning.
  blend: number;
  // Extra camera pullback distance beyond the base 3D spectate distance
  // during Dolly-Zoom telephoto narrowing (0 in pure 3D or settled ortho).
  extraDist: number;
  // Current visual pitch in degrees (smoothly eased between 3D pitch and 90°).
  visualPitchDeg: number;
}

export const cameraTransitionState: CameraTransitionState = {
  blend: 0,
  extraDist: 0,
  visualPitchDeg: SPECTATE_PITCH_DEG,
};

export function writeCameraTransitionState(
  blend: number,
  extraDist: number,
  visualPitchDeg: number,
): void {
  cameraTransitionState.blend = blend;
  cameraTransitionState.extraDist = extraDist;
  cameraTransitionState.visualPitchDeg = visualPitchDeg;
}
