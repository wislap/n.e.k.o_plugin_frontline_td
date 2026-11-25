// Inspector subject assembly (ADR 0062 step 3): app is the only place
// the feature-owned subject defs are combined into the registry map.
import { captureInspectorSubjects } from '../features/capture/ui/index';
import { constructionInspectorSubjects } from '../features/construction/ui/index';
import { terrainInspectorSubjects } from '../features/terrain/ui/index';
import { unitsInspectorSubjects } from '../features/units/ui/index';
import { visionInspectorSubjects } from '../features/vision/ui/index';
import { indexInspectorSubjects } from '../ui/inspector/index';

export const INSPECTOR_SUBJECTS = indexInspectorSubjects([
  ...unitsInspectorSubjects,
  ...constructionInspectorSubjects,
  ...captureInspectorSubjects,
  ...visionInspectorSubjects,
  ...terrainInspectorSubjects,
]);
