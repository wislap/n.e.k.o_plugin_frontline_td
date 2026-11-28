// Threat banner (topCenter): danger pill shown while hostile squads
// close on the observer's structures. Reads SquadsChannel via
// useSnapshotValue on the coalesced 100 ms snapshot clock.
import { useTranslation } from 'react-i18next';
import { formatClock } from '../../../client/match-info';
import type { SnapshotPair } from '../../../client/sim-client';
import { useSnapshotValue } from '../../../client/use-snapshot';
import { readChannel } from '../../../core/index';
import type { HudPanelProps } from '../../../ui/hud-panels';
import styles from '../../../ui/HudShell.module.css';
import { TacticalPanel } from '../../../ui/kit/index';
import { SquadsChannel } from '../protocol';
import { bannerThreat } from '../rules/index';

interface ThreatSummary {
  count: number;
  ticksLeft: number;
}

function selectThreat(pair: SnapshotPair): ThreatSummary | null {
  const latest = pair.latest;
  if (latest === null) {
    return null;
  }
  const squads = readChannel(latest, SquadsChannel)?.squads ?? [];
  return bannerThreat(squads, latest.observer, latest.tick);
}

function sameThreat(a: ThreatSummary | null, b: ThreatSummary | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.count === b.count && a.ticksLeft === b.ticksLeft;
}

export function ThreatBanner({ ctx }: HudPanelProps) {
  const { t } = useTranslation();
  const threat = useSnapshotValue(ctx.client, selectThreat, sameThreat, 100);

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
