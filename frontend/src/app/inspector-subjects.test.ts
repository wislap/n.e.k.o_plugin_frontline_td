// Inspector subject assembly test (ADR 0062 step 3): every
// HoverSubject kind must have exactly one registered def. The
// satisfies/Exclude pair fails typecheck if a kind is added to
// HoverSubject without updating ALL_KINDS.
import { describe, expect, it } from 'vitest';
import { packHandle, type Inspection } from '../core/index';
import {
  defineInspectorSubject,
  indexInspectorSubjects,
  matchInspection,
  type SubjectKind,
} from '../ui/inspector/index';
import { INSPECTOR_SUBJECTS } from './inspector-subjects';

const ALL_KINDS = [
  'own_unit',
  'hostile_unit',
  'own_structure',
  'hostile_structure',
  'ruin',
  'salvage',
  'road_segment',
  'memory',
  'multi_own',
  'cell',
] as const satisfies readonly SubjectKind[];

// Compile-time exhaustiveness: adding a HoverSubject kind makes this
// Exclude non-never and breaks tsc.
type MissingKinds = Exclude<SubjectKind, (typeof ALL_KINDS)[number]>;
const _noMissingKinds: MissingKinds extends never ? true : never = true;
export { _noMissingKinds };

describe('INSPECTOR_SUBJECTS', () => {
  it('has exactly one def per HoverSubject kind', () => {
    expect(INSPECTOR_SUBJECTS.size).toBe(ALL_KINDS.length);
    for (const kind of ALL_KINDS) {
      const def = INSPECTOR_SUBJECTS.get(kind);
      expect(def, `missing def for ${kind}`).toBeDefined();
      expect(def?.kind).toBe(kind);
    }
  });

  it('marks inspects/hostile flags on the expected kinds', () => {
    expect(INSPECTOR_SUBJECTS.get('own_unit')?.inspects).toBe(true);
    expect(INSPECTOR_SUBJECTS.get('own_structure')?.inspects).toBe(true);
    expect(INSPECTOR_SUBJECTS.get('road_segment')?.inspects).toBe(true);
    expect(INSPECTOR_SUBJECTS.get('hostile_unit')?.hostile).toBe(true);
    expect(INSPECTOR_SUBJECTS.get('hostile_structure')?.hostile).toBe(true);
  });

  it('indexInspectorSubjects throws on a duplicate kind', () => {
    const def = defineInspectorSubject({
      kind: 'cell',
      inspects: false,
      hostile: false,
      resolve: () => null,
      title: () => '',
      View: () => null,
    });
    expect(() => indexInspectorSubjects([def, def])).toThrow(/duplicate/);
  });
});

describe('matchInspection', () => {
  const insp: Inspection = { handle: packHandle(42, 0), modifiers: [], sections: {} };

  it('returns the inspection only when the subject handle matches', () => {
    expect(matchInspection({ kind: 'own_unit', handle: 42 }, insp)).toBe(insp);
    expect(matchInspection({ kind: 'own_unit', handle: 99 }, insp)).toBeNull();
  });

  it('never matches handle-less subjects', () => {
    expect(matchInspection({ kind: 'multi_own', count: 3 }, insp)).toBeNull();
    expect(matchInspection({ kind: 'cell', x: 1, y: 2 }, insp)).toBeNull();
    expect(matchInspection({ kind: 'own_unit', handle: 42 }, null)).toBeNull();
  });
});
