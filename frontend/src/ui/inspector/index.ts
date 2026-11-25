// Inspector public kit + factory (ADR 0062 step 3). Features declare
// subject defs against the registry types; app wires createInspectorPanel
// with the assembled map.
export { createInspectorPanel } from './create-panel';
export { hpValueText, InspectorActions, inspectorStyles, ModifiersSection } from './kit';
export {
  defineInspectorSubject,
  indexInspectorSubjects,
  matchInspection,
  type InspectorSubjectDef,
  type InspectorViewContext,
  type SubjectKind,
} from './registry';
export { indexOfHandle } from './resolve-utils';
