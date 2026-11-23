// Flow debug telemetry panel (dev only, topRight below StockPanel):
// tick, speed, tick rate, entity count, top systems by avg time,
// last worker error, and pause / speed step controls.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRuntimeStore } from '../client/runtime-store';
import type { SimClient } from '../client/sim-client';
import { useUiStore } from '../client/ui-store';
import { PALETTE_IDS, type PaletteId } from '../render/theme/visual';
import { localName } from '../content/index';
import { SPEED_STEPS } from '../protocol/index';
import { ActionButton, TacticalPanel } from '../ui/kit/index';
import styles from './DebugPanel.module.css';

export function DebugPanel({ client }: { client: SimClient }) {
  const { t } = useTranslation();
  const stats = useRuntimeStore((state) => state.stats);
  const error = useRuntimeStore((state) => state.error);
  const grassDensity = useUiStore((state) => state.grassDensity);
  const setGrassDensity = useUiStore((state) => state.setGrassDensity);
  const info2d = useUiStore((state) => state.info2d);
  const setInfo2d = useUiStore((state) => state.setInfo2d);
  const palette = useUiStore((state) => state.palette);
  const setPalette = useUiStore((state) => state.setPalette);
  const atmosphere = useUiStore((state) => state.atmosphere);
  const setAtmosphere = useUiStore((state) => state.setAtmosphere);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      frames += 1;
      const dt = now - last;
      if (dt >= 500) {
        setFps(Math.round((frames * 1000) / dt));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, []);

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
        <div className={styles['row']}>
          <span className={styles['label']}>{t('dev.fps')}</span>
          <span className={styles['value']}>{fps}</span>
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

      <div className={styles['row']}>
        <span className={styles['label']}>{t('dev.palette')}</span>
        <select
          value={palette}
          onChange={(e) => {
            setPalette(e.target.value as PaletteId);
          }}
        >
          {PALETTE_IDS.map((id) => (
            <option key={id} value={id}>
              {t(`dev.palette_${id}`)}
            </option>
          ))}
        </select>
      </div>

      <div className={styles['row']}>
        <span className={styles['label']}>{t('dev.atmosphere')}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(atmosphere * 100)}
          onChange={(e) => {
            setAtmosphere(Number(e.target.value) / 100);
          }}
        />
      </div>

      <div className={styles['row']}>
        <span className={styles['label']}>{t('dev.grass_density')}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(grassDensity * 100)}
          onChange={(e) => {
            setGrassDensity(Number(e.target.value) / 100);
          }}
        />
      </div>

      <div className={styles['row']}>
        <span className={styles['label']}>{t('dev.info2d')}</span>
        <input
          type="checkbox"
          checked={info2d}
          onChange={(e) => {
            setInfo2d(e.target.checked);
          }}
        />
      </div>

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
