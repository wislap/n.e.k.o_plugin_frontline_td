// Threat banner (topCenter): danger pill shown while hostile squads
// close on the observer's structures. Reads SquadsChannel on the shared
// 100 ms snapshot clock with an equality-guarded setState.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatClock } from '../../../client/match-info';
import { subscribeSnapshotClock } from '../../../client/use-snapshot';
import { readChannel } from '../../../core/index';
import { TacticalPanel } from '../../../ui/kit/index';
import type { HudPanelProps } from '../../../ui/hud-panels';
import styles from '../../../ui/HudShell.module.css';
import { bannerThreat } from '../render/index';
import { SquadsChannel } from '../protocol';

export function ThreatBanner({ ctx }: HudPanelProps) {
  const { t } = useTranslation();
  const [threat, setThreat] = useState<{ count: number; ticksLeft: number } | null>(null);

  useEffect(() => {
    return subscribeSnapshotClock(ctx.client, 100, () => {
      const latest = ctx.client.snapshots().latest;
      if (latest === null) {
        return;
      }
      const squads = readChannel(latest, SquadsChannel)?.squads ?? [];
      const nextThreat = bannerThreat(squads, latest.observer, latest.tick);
      setThreat((cur) => {
        if (cur === null && nextThreat === null) {
          return cur;
        }
        if (
          cur !== null &&
          nextThreat !== null &&
          cur.count === nextThreat.count &&
          cur.ticksLeft === nextThreat.ticksLeft
        ) {
          return cur;
        }
        return nextThreat;
      });
    });
  }, [ctx.client]);

  if (threat === null) {
    return null;
  }
  return (
    <TacticalPanel tone="danger" compact>
      <span className={styles['bannerTextDanger']}>
        {t('hud.threat', { count: threat.count, time: formatClock(threat.ticksLeft) })}
      </span>
    </TacticalPanel>
  );
}
