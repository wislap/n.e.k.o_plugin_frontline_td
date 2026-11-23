import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveInspectedSubject, type ResolvedSubjectView } from '../../client/inspect-subject';
import { activeInspectorSubject, useInspectorStore } from '../../client/inspector-store';
import { useInteractionStore } from '../../client/interaction-store';
import { useIntentRouter } from '../../client/intent';
import { useSelectionStore } from '../../client/selection-store';
import type { SimClient, SnapshotPair } from '../../client/sim-client';
import { useSnapshotValue } from '../../client/use-snapshot';
import { localName, type ContentDb, type ResolvedMap } from '../../content/index';
import type { EntityHandle, Inspection, Snapshot } from '../../core/index';
import { TERRAIN_HEIGHT_LAYER_ID } from '../../features/terrain/protocol';
import { ActionButton, TacticalPanel } from '../kit/index';
import styles from './InspectorPanel.module.css';
import {
  HostileStructureView,
  OwnStructureView,
  type InspectorActionContext,
} from './StructureSections';
import {
  CellSubjectView,
  HostileUnitView,
  MultiOwnView,
  OwnUnitView,
  WorldObjectView,
} from './UnitAndWorldSections';

const POLL_MS = 100;
const INSPECT_DEBOUNCE_MS = 80;

interface SnapshotSlice {
  tick: number;
  snapshot: Snapshot | null;
  inspection: Inspection | null;
}

function sameSnapshotSlice(a: SnapshotSlice, b: SnapshotSlice): boolean {
  return a.tick === b.tick && a.snapshot === b.snapshot && a.inspection === b.inspection;
}

function inferMap(db: ContentDb, snapshot: Snapshot | null): ResolvedMap | null {
  const heightLen = snapshot?.layers[TERRAIN_HEIGHT_LAYER_ID]?.length;
  if (heightLen !== undefined) {
    const matched = db.maps.list.find((m) => m.width * m.height === heightLen);
    if (matched !== undefined) return matched;
  }
  return db.maps.list[0] ?? null;
}

function defaultIsHostile(observer: number, faction: number): boolean {
  return faction !== 0 && faction !== observer;
}

function confirmMatchesView(
  confirm: { targets: readonly number[] } | null,
  view: ResolvedSubjectView,
  selected: ReadonlySet<number>,
  isPinned: boolean,
): boolean {
  if (confirm === null || !isPinned) return false;
  if (view.kind === 'own_structure' || view.kind === 'road_segment') {
    return confirm.targets.includes(view.handle);
  }
  if (view.kind === 'multi_own') {
    return confirm.targets.length > 0 && confirm.targets.every((h) => selected.has(h));
  }
  return false;
}

function subjectTitle(view: ResolvedSubjectView, t: TFunction): string {
  switch (view.kind) {
    case 'multi_own':
      return t('panel.selected', { count: view.count });
    case 'cell_unexplored':
    case 'cell':
      return t('inspector.cell_coords', { x: view.x, y: view.y });
    case 'own_unit':
    case 'hostile_unit': {
      const name = localName(view.contentId);
      return t(`unit.${name}`, { defaultValue: name });
    }
    case 'own_structure':
    case 'hostile_structure':
    case 'memory': {
      const name = localName(view.contentId);
      return t(`structure.${name}`, { defaultValue: name });
    }
    case 'ruin': {
      const name = localName(view.contentId);
      return t(`structure.${name}_ruin`, {
        defaultValue: t(`structure.${name}`, { defaultValue: name }),
      });
    }
    case 'salvage':
      return t('inspector.salvage');
    case 'road_segment':
      return t('inspector.road_segment');
  }
}

export function InspectorPanel({
  client,
  db,
  map,
  isHostile,
}: {
  client: SimClient;
  db: ContentDb;
  map?: ResolvedMap | null | undefined;
  isHostile?: ((observer: number, faction: number) => boolean) | undefined;
}) {
  const { t } = useTranslation();
  const router = useIntentRouter();
  const hovered = useInspectorStore((s) => s.hovered);
  const pinned = useInspectorStore((s) => s.pinned);
  const selected = useSelectionStore((s) => s.selected);
  const mode = useInteractionStore((s) => s.mode);
  const demolishConfirm = useInteractionStore((s) => s.demolishConfirm);
  const subject = activeInspectorSubject({ hovered, pinned });
  const inspectHandle =
    subject !== null &&
    (subject.kind === 'own_unit' ||
      subject.kind === 'own_structure' ||
      subject.kind === 'road_segment')
      ? subject.handle
      : null;

  useEffect(() => {
    if (inspectHandle === null) {
      client.inspect(null);
      return;
    }
    const id = setTimeout(() => {
      client.inspect(inspectHandle as EntityHandle);
    }, INSPECT_DEBOUNCE_MS);
    return () => {
      clearTimeout(id);
    };
  }, [client, inspectHandle]);

  const selectSnapshot = useCallback(
    (pair: SnapshotPair): SnapshotSlice => ({
      tick: pair.latest?.tick ?? -1,
      snapshot: pair.latest,
      inspection: client.inspection(),
    }),
    [client],
  );
  const snap = useSnapshotValue(client, selectSnapshot, sameSnapshotSlice, POLL_MS);

  const view = useMemo(
    () =>
      resolveInspectedSubject({
        db,
        map: map ?? inferMap(db, snap.snapshot),
        snapshot: snap.snapshot,
        isHostile: isHostile ?? defaultIsHostile,
        subject,
        selected,
        inspection: snap.inspection,
      }),
    [db, map, isHostile, snap.snapshot, snap.inspection, subject, selected],
  );

  if (view === null) return null;

  const isPinned = pinned !== null;
  const hasConfirm = confirmMatchesView(demolishConfirm, view, selected, isPinned);
  const isHostileSubject = view.kind === 'hostile_unit' || view.kind === 'hostile_structure';
  const tone = hasConfirm ? 'danger' : isHostileSubject ? 'warn' : isPinned ? 'mode' : 'preview';
  const badge = isHostileSubject
    ? t('inspector.hostile_tag')
    : t(isPinned ? 'inspector.pinned' : 'inspector.preview');
  const actions: InspectorActionContext = {
    isPinned,
    canActivate: selected.size > 0,
    canDemolish: mode === 'build' && selected.size > 0,
    hasConfirm,
    onActivate: () => {
      router.dispatch({ kind: 'selection.activate' });
    },
    onDemolish: () => {
      router.dispatch({ kind: 'demolish.press' });
    },
    onConfirmDemolish: () => {
      router.dispatch({ kind: 'demolish.confirm' });
    },
  };

  return (
    <TacticalPanel
      tone={tone}
      title={subjectTitle(view, t)}
      badge={badge}
      headerActions={
        isPinned ? (
          <ActionButton
            size="sm"
            variant="ghost"
            title={t('inspector.unpin')}
            onClick={() => {
              router.dispatch({ kind: 'inspector.unpin' });
            }}
          >
            {'×'}
          </ActionButton>
        ) : undefined
      }
      className={styles['panel']}
      bodyClassName={styles['body']}
    >
      {view.kind === 'multi_own' && <MultiOwnView view={view} actions={actions} />}
      {(view.kind === 'cell' || view.kind === 'cell_unexplored') && <CellSubjectView view={view} />}
      {view.kind === 'own_unit' && <OwnUnitView view={view} />}
      {view.kind === 'hostile_unit' && <HostileUnitView view={view} />}
      {view.kind === 'own_structure' && <OwnStructureView view={view} db={db} actions={actions} />}
      {view.kind === 'hostile_structure' && <HostileStructureView view={view} />}
      {(view.kind === 'ruin' ||
        view.kind === 'salvage' ||
        view.kind === 'road_segment' ||
        view.kind === 'memory') && <WorldObjectView view={view} actions={actions} />}
    </TacticalPanel>
  );
}
