// Inspector panel factory (ADR 0062 step 3): app supplies the assembled
// subject registry; this component keeps the shell-side behaviour —
// inspect debounce, snapshot slice, tone/badge, demolish-confirm match,
// header actions — and delegates resolution and body rendering to the
// registered InspectorSubjectDef.
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  activeInspectorSubject,
  type HoverSubject,
  useInspectorStore,
} from '../../client/inspector-store';
import { useInteractionStore } from '../../client/interaction-store';
import { useIntentRouter } from '../../client/intent';
import { useSelectionStore } from '../../client/selection-store';
import type { SnapshotPair } from '../../client/sim-client';
import { useSnapshotValue } from '../../client/use-snapshot';
import type { EntityHandle, Inspection, Snapshot } from '../../core/index';
import type { HudPanelProps } from '../hud-panels';
import { ActionButton, TacticalPanel } from '../kit/index';
import type { InspectorActionContext } from './kit';
import {
  type InspectInput,
  matchInspection,
  type InspectorSubjectDef,
  type InspectorViewContext,
  type SubjectKind,
} from './registry';
import styles from './InspectorPanel.module.css';

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

export function createInspectorPanel(
  subjects: ReadonlyMap<SubjectKind, InspectorSubjectDef>,
): React.ComponentType<HudPanelProps> {
  return function InspectorPanel({ ctx }: HudPanelProps) {
    const { t } = useTranslation();
    const router = useIntentRouter();
    const hovered = useInspectorStore((s) => s.hovered);
    const pinned = useInspectorStore((s) => s.pinned);
    const selected = useSelectionStore((s) => s.selected);
    const mode = useInteractionStore((s) => s.mode);
    const demolishConfirm = useInteractionStore((s) => s.demolishConfirm);
    const subject = activeInspectorSubject({ hovered, pinned });
    const def = subject === null ? undefined : subjects.get(subject.kind);
    const inspectHandle =
      subject !== null && def !== undefined && def.inspects && 'handle' in subject
        ? subject.handle
        : null;

    const client = ctx.client;
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

    const inspection = subject === null ? null : matchInspection(subject, snap.inspection);
    const view = useMemo(() => {
      if (subject === null || def === undefined) {
        return null;
      }
      const input: InspectInput<HoverSubject> = {
        db: ctx.db,
        map: ctx.map,
        snapshot: snap.snapshot,
        isHostile: ctx.isHostile,
        subject,
        selected,
        inspection,
      };
      return def.resolve(input);
    }, [def, ctx.db, ctx.map, ctx.isHostile, snap.snapshot, subject, selected, inspection]);

    if (view === null || def === undefined) return null;

    const isPinned = pinned !== null;
    const hasConfirm =
      isPinned &&
      demolishConfirm !== null &&
      (def.matchesDemolishConfirm?.(view, demolishConfirm.targets, selected) ?? false);
    const tone = hasConfirm ? 'danger' : def.hostile ? 'warn' : isPinned ? 'mode' : 'preview';
    const badge = def.hostile ? t('inspector.hostile_tag') : undefined;
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
    const viewCtx: InspectorViewContext = { db: ctx.db, actions };
    const SubjectView = def.View;

    return (
      <TacticalPanel
        tone={tone}
        title={def.title(view, t)}
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
        <SubjectView view={view} ctx={viewCtx} />
      </TacticalPanel>
    );
  };
}
