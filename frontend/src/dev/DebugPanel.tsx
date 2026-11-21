// Flow debug telemetry panel (dev only, topRight below StockPanel):
// tick, speed, tick rate, entity count, top systems by avg time,
// last worker error, and pause / speed step controls.
import { useTranslation } from 'react-i18next';
import { useRuntimeStore } from '../client/runtime-store';
import type { SimClient } from '../client/sim-client';
import { localName } from '../content/index';
import { SPEED_STEPS } from '../protocol/index';
import { ActionButton, TacticalPanel } from '../ui/kit/index';
import styles from './DebugPanel.module.css';

export function DebugPanel({ client }: { client: SimClient }) {
  const { t } = useTranslation();
  const stats = useRuntimeStore((state) => state.stats);
  const error = useRuntimeStore((state) => state.error);

  const systems = (stats?.systems ?? [])
    .slice()
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, 10);

  const isPaused = stats === null || stats.paused;
  const speedText = isPaused
    ? t('dev.paused')
    : t('dev.speed_value', { n: SPEED_STEPS[stats.speedIndex] ?? 0 });

  return (
    <TacticalPanel
      tone="neutral"
      compact
      title={t('dev.title')}
      badge={speedText}
      className={styles['panel']}
      bodyClassName={styles['body']}
    >
      <div className={styles['metrics']}>
        <div className={styles['row']}>
          <span className={styles['label']}>{t('dev.tick')}</span>
          <span className={styles['value']}>{stats?.tick ?? 0}</span>
        </div>
        <div className={styles['row']}>
          <span className={styles['label']}>{t('dev.speed')}</span>
          <span className={styles['value']}>{speedText}</span>
        </div>
        <div className={styles['row']}>
          <span className={styles['label']}>{t('dev.tick_rate')}</span>
          <span className={styles['value']}>{(stats?.tickRate ?? 0).toFixed(1)}</span>
        </div>
        <div className={styles['row']}>
          <span className={styles['label']}>{t('dev.entities')}</span>
          <span className={styles['value']}>{stats?.entityCount ?? 0}</span>
        </div>
      </div>

      <div className={styles['section']}>
        <div className={styles['sectionTitle']}>{t('dev.systems')}</div>
        {systems.length === 0 ? (
          <div className={styles['empty']}>{t('dev.systems_empty')}</div>
        ) : (
          systems.map((system) => (
            <div key={system.id} className={styles['row']}>
              <span className={styles['systemName']}>{localName(system.id)}</span>
              <span className={styles['value']}>{system.avgMs.toFixed(3)}</span>
            </div>
          ))
        )}
      </div>

      {error !== null && (
        <div className={styles['error']}>
          {t('dev.error')}
          {error}
        </div>
      )}

      <div className={styles['controls']}>
        <ActionButton
          size="sm"
          variant={stats?.paused === true ? 'active' : 'default'}
          onClick={() => {
            client.togglePause();
          }}
        >
          {stats?.paused === true ? t('dev.resume') : t('dev.pause')}
        </ActionButton>
        {([1, 2, 3] as const).map((index) => (
          <ActionButton
            key={index}
            size="sm"
            variant={
              stats !== null && !stats.paused && stats.speedIndex === index ? 'active' : 'default'
            }
            onClick={() => {
              client.setSpeedIndex(index);
            }}
          >
            {t('dev.speed_value', { n: index })}
          </ActionButton>
        ))}
      </div>
    </TacticalPanel>
  );
}
