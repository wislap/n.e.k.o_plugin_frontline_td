// Assault match end overlay (M4): once the mode's channel reports
// `ended`, shows the observer-relative outcome, match duration, and
// probe stats in a frosted obsidian debrief card; play-again restarts
// the sim through the app (no reload). Uses useSnapshotValue.
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { formatClock, matchOutcome } from '../../../client/match-info';
import { useRuntimeStore } from '../../../client/runtime-store';
import type { SimClient, SnapshotPair } from '../../../client/sim-client';
import { useSnapshotValue } from '../../../client/use-snapshot';
import { ActionButton, TacticalPanel, cx } from '../../../ui/kit/index';
import { AssaultChannel, type AssaultState } from '../protocol';
import styles from './EndScreen.module.css';
import { readChannel } from '../../../core/index';

const PROBE_PREFIX = 'frontline_td:assault.';

interface EndSlice {
  state: AssaultState | null;
  observer: number;
}

function sameEndSlice(a: EndSlice, b: EndSlice): boolean {
  return (
    a.observer === b.observer &&
    a.state?.ended === b.state?.ended &&
    a.state?.winner === b.state?.winner &&
    a.state?.tick === b.state?.tick
  );
}

export function EndScreen({ client, onRestart }: { client: SimClient; onRestart: () => void }) {
  const { t } = useTranslation();

  const selectEnd = useCallback((pair: SnapshotPair): EndSlice => {
    const latest = pair.latest;
    const state = readChannel(latest, AssaultChannel);
    if (state === null || state.ended === 0) {
      return { state: null, observer: -1 };
    }
    return { state, observer: latest?.observer ?? -1 };
  }, []);

  const end = useSnapshotValue(client, selectEnd, sameEndSlice, 250);
  const stats = useRuntimeStore((s) => s.stats);
  const outcome = matchOutcome(end.state, end.observer);

  if (end.state === null || outcome === null) {
    return null;
  }

  const probes = stats?.probes ?? {};
  const probe = (name: string): number | undefined => probes[`${PROBE_PREFIX}${name}`];
  const own = `f${end.observer}`;
  const ownWavesKey = `${PROBE_PREFIX}waves.${own}`;
  const enemyWaves = Object.entries(probes)
    .filter(([k]) => k.startsWith(`${PROBE_PREFIX}waves.`) && k !== ownWavesKey)
    .reduce((sum, [, v]) => sum + v, 0);
  const stockKeys = Object.keys(probes)
    .filter((k) => k.startsWith(`${PROBE_PREFIX}stock.${own}.`))
    .sort();

  const panelTone = outcome === 'defeat' ? 'danger' : outcome === 'draw' ? 'warn' : 'mode';

  return (
    <div className={styles['backdrop']}>
      <TacticalPanel
        tone={panelTone}
        className={cx(styles['card'], styles[`outcome-${outcome}`])}
        bodyClassName={styles['body']}
      >
        <div className={styles['hero']}>
          <div className={styles['outcomeTitle']}>{t(`end.${outcome}`)}</div>
          <div className={styles['duration']}>
            {t('end.duration', { time: formatClock(end.state.tick) })}
          </div>
        </div>

        <div className={styles['statsGrid']}>
          <div className={styles['statCell']}>
            {t('end.units', { count: probe(`units.${own}`) ?? 0 })}
          </div>
          <div className={styles['statCell']}>
            {t('end.structures', { count: probe(`structures.${own}`) ?? 0 })}
          </div>
          <div className={styles['statCell']}>{t('end.waves', { count: enemyWaves })}</div>
          {stockKeys.map((k) => {
            const cargoName = k.split('.').pop() ?? '';
            const count = probes[k] ?? 0;
            return (
              <div key={k} className={styles['statCell']}>
                {t(`end.stock.${cargoName}`, {
                  count,
                  defaultValue: `${cargoName}: ${count}`,
                })}
              </div>
            );
          })}
        </div>

        <div className={styles['actions']}>
          <ActionButton
            variant="primary"
            size="md"
            onClick={onRestart}
            className={styles['restartBtn']}
          >
            {t('end.restart')}
          </ActionButton>
        </div>
      </TacticalPanel>
    </div>
  );
}
