// Capture profile (M5): structures with `capture` become ruins on death
// instead of freeing their footprint; standing units inside `radius`
// cells of the ruin centre tug the capture progress (see sim/module).
// `seconds` is the time a single unit needs to capture; `rebuildSeconds`
// is the construction time of the free rebuild site after capture.
import { s } from '../../core/index';

export const captureProfileSchema = s.object({
  radius: s.int({ min: 1, max: 64 }),
  seconds: s.number({ min: 0.05, max: 3600 }),
  rebuildSeconds: s.number({ min: 0.05, max: 3600 }),
});
