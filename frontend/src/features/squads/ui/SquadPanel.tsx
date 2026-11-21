// Squad panel (ADR 0048, bottomCenter): visible only in command primary
// mode (F1). Renders compact horizontal squad pills with clickable digit
// badges, strength/disband controls, and a [+ Squad] bind button when
// own units are selected. Driven by useSnapshotValue.
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCameraStore } from '../../../client/camera-store';
import { useInspectorStore } from '../../../client/inspector-store';
import { useIntentRouter } from '../../../client/intent';
import { useInteractionStore } from '../../../client/interaction-store';
import { useSelectionStore } from '../../../client/selection-store';
import type { SimClient, SnapshotPair } from '../../../client/sim-client';
import { digitForTag } from '../../../client/squad-controls';
import { useSnapshotValue } from '../../../client/use-snapshot';
import { ActionButton, Kbd, TacticalPanel, cx } from '../../../ui/kit/index';
import { DenseUnitsChannel, type DenseUnits } from '../../units/protocol';
import {
  SquadsChannel,
  SquadsDisband,
  SquadsSetStrength,
  type SquadsSnapshot,
  type SquadView,
} from '../protocol';
import styles from './SquadPanel.module.css';

const EMPTY_SQUADS: readonly SquadView[] = [];

interface SquadSlice {
  tick: number;
  observer: number;
  rawSquads: readonly SquadView[];
  units: DenseUnits | null;
}

function sameSquadSlice(a: SquadSlice, b: SquadSlice): boolean {
  return (
    a.tick === b.tick &&
    a.observer === b.observer &&
    a.rawSquads === b.rawSquads &&
    a.units === b.units
  );
}

function batteryToneClass(bp: number): string {
  if (bp <= 2500) {
    return styles['batteryDanger'] ?? '';
  }
  if (bp <= 5500) {
    return styles['batteryWarn'] ?? '';
  }
  return styles['batteryOk'] ?? '';
}

function selectUntaggedSquad(squad: SquadView): void {
  const members = squad.members ?? [];
  useSelectionStore.getState().setSelection(new Set(members), false);
  const inspector = useInspectorStore.getState();
  if (members.length === 1 && members[0] !== undefined) {
    inspector.pin({ kind: 'own_unit', handle: members[0] });
  } else if (members.length > 1) {
    inspector.pin({ kind: 'multi_own', count: members.length });
  } else {
    inspector.unpin();
  }
}

export function SquadPanel({ client }: { client: SimClient }) {
  const { t } = useTranslation();
  const router = useIntentRouter();
  const mode = useInteractionStore((s) => s.mode);
  const selected = useSelectionStore((s) => s.selected);

  const selectSquads = useCallback((pair: SnapshotPair): SquadSlice => {
    const latest = pair.latest;
    const observer = latest?.observer ?? -1;
    const rawSquads =
      (latest?.channels[SquadsChannel.id] as SquadsSnapshot | undefined)?.squads ?? EMPTY_SQUADS;
    const units = (latest?.channels[DenseUnitsChannel.id] as DenseUnits | undefined) ?? null;
    return {
      tick: latest?.tick ?? -1,
      observer,
      rawSquads,
      units,
    };
  }, []);

  const { observer, rawSquads, units } = useSnapshotValue(
    client,
    selectSquads,
    sameSquadSlice,
    200,
  );

  const squads = useMemo(
    () => rawSquads.filter((s) => s.faction === observer),
    [rawSquads, observer],
  );

  const hasOwnUnitSelected = useMemo(() => {
    if (units === null || selected.size === 0) {
      return false;
    }
    for (let i = 0; i < units.handles.length; i++) {
      const h = units.handles[i];
      if (h !== undefined && units.faction[i] === observer && selected.has(h)) {
        return true;
      }
    }
    return false;
  }, [units, observer, selected]);

  if (mode !== 'command') {
    return null;
  }

  const usedDigits = new Set<number>();
  for (const squad of squads) {
    const d = digitForTag(squad.tag);
    if (d !== null) {
      usedDigits.add(d);
    }
  }
  let freeDigit: number | null = null;
  for (let d = 1; d <= 9; d++) {
    if (!usedDigits.has(d)) {
      freeDigit = d;
      break;
    }
  }

  if (squads.length === 0 && !hasOwnUnitSelected) {
    return null;
  }

  const canCreate = hasOwnUnitSelected && freeDigit !== null;
  const createKbd = freeDigit !== null ? `Ctrl+${freeDigit}` : undefined;

  const createButton = (
    <ActionButton
      size="sm"
      variant={canCreate ? 'primary' : 'default'}
      kbd={createKbd}
      disabled={!canCreate}
      onClick={() => {
        if (freeDigit !== null) {
          router.dispatch({ kind: 'squad.digit', digit: freeDigit, ctrl: true });
        }
      }}
    >
      {t('squad.create_btn')}
    </ActionButton>
  );

  if (squads.length === 0) {
    return (
      <TacticalPanel tone="mode" compact className={styles['panel']}>
        <div className={styles['row']}>
          <span className={styles['hint']}>{t('squad.empty_hint')}</span>
          {createButton}
        </div>
      </TacticalPanel>
    );
  }

  const setStrength = (squad: SquadView, delta: number): void => {
    const strength = Math.min(64, Math.max(1, squad.strength + delta));
    if (strength !== squad.strength) {
      client.submit({ type: SquadsSetStrength.type, payload: { squad: squad.id, strength } });
    }
  };

  return (
    <TacticalPanel tone="mode" compact className={styles['panel']}>
      <div className={styles['row']}>
        {squads.map((squad) => {
          const digit = digitForTag(squad.tag);
          const energy = squad.meanEnergyBp;
          const members = squad.members ?? [];
          const isSelected = members.length > 0 && members.every((handle) => selected.has(handle));
          const orderLabel = t(`squad.order.${squad.order.kind}`, {
            defaultValue: squad.order.kind,
          });
          const phaseLabel = t(`squad.phase.${squad.phase}`, { defaultValue: squad.phase });

          return (
            <div key={squad.id} className={cx(styles['pill'], isSelected && styles['pillActive'])}>
              <button
                type="button"
                className={styles['pillMain']}
                title={t('squad.center_hint')}
                onClick={() => {
                  if (digit !== null) {
                    router.dispatch({ kind: 'squad.digit', digit, ctrl: false });
                  } else {
                    selectUntaggedSquad(squad);
                  }
                }}
                onDoubleClick={() => {
                  if (digit === null) {
                    useCameraStore.getState().setCenter(squad.centroid);
                  }
                }}
              >
                <Kbd active={isSelected}>{digit ?? '—'}</Kbd>
                <span className={styles['count']}>{`${members.length}/${squad.strength}`}</span>
                <span className={styles['status']}>{`${orderLabel} · ${phaseLabel}`}</span>
                {energy !== undefined && (
                  <span className={cx(styles['battery'], batteryToneClass(energy))}>
                    {`${Math.round(energy / 100)}%`}
                  </span>
                )}
              </button>
              <div className={styles['pillControls']}>
                <button
                  type="button"
                  className={styles['miniBtn']}
                  onClick={() => {
                    setStrength(squad, -1);
                  }}
                >
                  {'−'}
                </button>
                <button
                  type="button"
                  className={styles['miniBtn']}
                  onClick={() => {
                    setStrength(squad, 1);
                  }}
                >
                  {'+'}
                </button>
                <button
                  type="button"
                  className={cx(styles['miniBtn'], styles['disbandBtn'])}
                  title={t('squad.disband')}
                  aria-label={t('squad.disband')}
                  onClick={() => {
                    client.submit({ type: SquadsDisband.type, payload: { squad: squad.id } });
                  }}
                >
                  {'×'}
                </button>
              </div>
            </div>
          );
        })}
        {createButton}
      </div>
      <div className={styles['centerHint']}>{t('squad.center_hint')}</div>
    </TacticalPanel>
  );
}
