// Inspector subject registry (ADR 0062 step 3): features declare
// InspectorSubjectDef per HoverSubject kind, app assembles them, the
// shell panel resolves tone/badge/title/actions generically. This
// module must not import features/*.
import type { TFunction } from 'i18next';
import type { ComponentType } from 'react';
import type { HoverSubject } from '../../client/inspector-store';
import type { ContentDb, ResolvedMap } from '../../content/index';
import type { Inspection, Snapshot } from '../../core/index';
import type { InspectorActionContext } from './kit';

export type SubjectKind = HoverSubject['kind'];

export interface InspectInput<S extends HoverSubject> {
  readonly db: ContentDb;
  readonly map: ResolvedMap | null;
  readonly snapshot: Snapshot | null;
  readonly isHostile: (observer: number, faction: number) => boolean;
  readonly subject: S;
  readonly selected: ReadonlySet<number>;
  // Already matched to subject.handle by the shell, else null.
  readonly inspection: Inspection | null;
}

export interface InspectorViewContext {
  readonly db: ContentDb;
  readonly actions: InspectorActionContext;
}

export interface InspectorSubjectDef<K extends SubjectKind = SubjectKind, V = unknown> {
  readonly kind: K;
  // own_unit / own_structure / road_segment → debounced client.inspect.
  readonly inspects: boolean;
  // hostile_unit / hostile_structure → warn tone + hostile badge.
  readonly hostile: boolean;
  resolve(input: InspectInput<Extract<HoverSubject, { kind: K }>>): V | null;
  title(view: V, t: TFunction): string;
  matchesDemolishConfirm?(
    view: V,
    targets: readonly number[],
    selected: ReadonlySet<number>,
  ): boolean;
  readonly View: ComponentType<{ readonly view: V; readonly ctx: InspectorViewContext }>;
}

export function defineInspectorSubject<K extends SubjectKind, V>(
  def: InspectorSubjectDef<K, V>,
): InspectorSubjectDef {
  // The single type-erasing cast: the registry map is homogeneous.
  return def as InspectorSubjectDef;
}

export function indexInspectorSubjects(
  defs: readonly InspectorSubjectDef[],
): ReadonlyMap<SubjectKind, InspectorSubjectDef> {
  const map = new Map<SubjectKind, InspectorSubjectDef>();
  for (const def of defs) {
    if (map.has(def.kind)) {
      throw new Error(`duplicate inspector subject kind: ${def.kind}`);
    }
    map.set(def.kind, def);
  }
  return map;
}

// The shell matches the fetched inspection to the active subject's
// handle once; resolvers receive null for any other handle.
export function matchInspection(
  subject: HoverSubject,
  inspection: Inspection | null,
): Inspection | null {
  if (inspection === null || !('handle' in subject)) {
    return null;
  }
  return inspection.handle === subject.handle ? inspection : null;
}
