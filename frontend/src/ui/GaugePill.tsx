// Top-center gauge pill (visual-languages HUD): clock + pause state +
// speed selector, extracted from the old TopLeftPod first row so the
// top-center slot reads as a single instrument strip.
import { useTranslation } from 'react-i18next';
import { useIntentRouter } from '../client/intent';
import { formatClock } from '../client/match-info';
import { useRuntimeStore } from '../client/runtime-store';
import type { SimClient } from '../client/sim-client';
import { SPEED_STEPS } from '../protocol/index';
import { ActionButton, cx, SegmentedTabs, TacticalPanel } from './kit/index';
import styles from './GaugePill.module.css';

const SPEED_OPTIONS = SPEED_STEPS.filter((n) => n > 0);
const KBD_SPACE = 'Space';

export function GaugePill({ client }: { client: SimClient }) {
  const { t } = useTranslation();
  const router = useIntentRouter();
  const stats = useRuntimeStore((s) => s.stats);

  const tick = stats?.tick ?? -1;
  const paused = stats?.paused === true;
  const speedValue = paused ? '0' : String(stats?.speedIndex ?? 1);

  return (
    <div className={styles['root']} data-sim-tick={tick}>
      <TacticalPanel tone="neutral" compact bodyClassName={styles['body']}>
        <div className={styles['row']}>
          <div className={styles['clockPill']}>
            <span className={cx(styles['dot'], paused && styles['dotPaused'])} />
            <span className={styles['clockTime']}>{formatClock(Math.max(0, tick))}</span>
            <span className={styles['clockTick']}>
              {t('hud.clock_tick', { tick: Math.max(0, tick) })}
            </span>
          </div>
          <ActionButton
            size="sm"
            kbd={KBD_SPACE}
            variant={paused ? 'primary' : 'default'}
            onClick={() => {
              router.dispatch({ kind: 'runtime.toggle_pause' });
            }}
          >
            {t(paused ? 'dev.resume' : 'dev.pause')}
          </ActionButton>
          <SegmentedTabs
            size="sm"
            ariaLabel={t('dev.speed')}
            value={speedValue}
            items={SPEED_OPTIONS.map((step) => ({
              value: String(step),
              label: t('dev.speed_value', { n: step }),
            }))}
            onChange={(val) => {
              client.setSpeedIndex(Number(val));
            }}
          />
        </div>
      </TacticalPanel>
    </div>
  );
}
