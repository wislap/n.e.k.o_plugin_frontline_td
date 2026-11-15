// Fixed debug overlay (dev only): tick, speed, tick rate, entity count, top
// systems by avg time, and the last worker error.
import { useTranslation } from 'react-i18next';
import { useRuntimeStore } from '../client/runtime-store';
import type { SimClient } from '../client/sim-client';
import { SPEED_STEPS } from '../protocol/index';

const overlayStyle = {
  position: 'fixed',
  top: 8,
  right: 8,
  padding: '8px 12px',
  background: 'rgba(0, 0, 0, 0.7)',
  color: '#fff',
  fontFamily: 'monospace',
  fontSize: 12,
  zIndex: 1000,
  minWidth: 180,
} as const;

const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: 12 } as const;

export function DebugPanel({ client }: { client: SimClient }) {
  const { t } = useTranslation();
  const stats = useRuntimeStore((state) => state.stats);
  const error = useRuntimeStore((state) => state.error);

  const systems = (stats?.systems ?? [])
    .slice()
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, 10);

  return (
    <aside style={overlayStyle}>
      <div style={rowStyle}>
        <span>{t('dev.tick')}</span>
        <span>{stats?.tick ?? 0}</span>
      </div>
      <div style={rowStyle}>
        <span>{t('dev.speed')}</span>
        <span>
          {stats === null || stats.paused
            ? t('dev.paused')
            : t('dev.speed_value', { n: SPEED_STEPS[stats.speedIndex] ?? 0 })}
        </span>
      </div>
      <div style={rowStyle}>
        <span>{t('dev.tick_rate')}</span>
        <span>{(stats?.tickRate ?? 0).toFixed(1)}</span>
      </div>
      <div style={rowStyle}>
        <span>{t('dev.entities')}</span>
        <span>{stats?.entityCount ?? 0}</span>
      </div>
      <div>{t('dev.systems')}</div>
      {systems.length === 0 ? (
        <div>{t('dev.systems_empty')}</div>
      ) : (
        systems.map((system) => (
          <div key={system.id} style={rowStyle}>
            <span>{system.id.split(':')[1] ?? system.id}</span>
            <span>{system.avgMs.toFixed(3)}</span>
          </div>
        ))
      )}
      {error !== null && (
        <div style={{ color: '#ff8080' }}>
          {t('dev.error')}
          {error}
        </div>
      )}
      <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
        <button
          type="button"
          onClick={() => {
            client.togglePause();
          }}
        >
          {stats?.paused === true ? t('dev.resume') : t('dev.pause')}
        </button>
        {([1, 2, 3] as const).map((index) => (
          <button
            key={index}
            type="button"
            onClick={() => {
              client.setSpeedIndex(index);
            }}
          >
            {t('dev.speed_value', { n: index })}
          </button>
        ))}
      </div>
    </aside>
  );
}
