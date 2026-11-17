// Assault match end overlay (M4): once the mode's channel reports
// `ended`, the observer-relative outcome, the match duration, and a few
// probe stats; play-again restarts the sim through the app (no reload).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatClock, matchOutcome } from '../../../client/match-info';
import type { SimClient } from '../../../client/sim-client';
import { useRuntimeStore } from '../../../client/runtime-store';
import { AssaultChannel, type AssaultState } from '../protocol';

const PROBE_PREFIX = 'frontline_td:assault.';

const overlay = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.6)',
  zIndex: 1000,
} as const;

const card = {
  padding: '24px 36px',
  background: 'rgba(10,14,26,0.95)',
  border: '1px solid #444',
  borderRadius: 8,
  color: '#fff',
  fontFamily: 'monospace',
  fontSize: 14,
  textAlign: 'center',
  minWidth: 280,
} as const;

export function EndScreen({ client, onRestart }: { client: SimClient; onRestart: () => void }) {
  const { t } = useTranslation();
  const [end, setEnd] = useState<{ state: AssaultState; observer: number } | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      const latest = client.snapshots().latest;
      const state = latest?.channels[AssaultChannel.id] as AssaultState | undefined;
      if (state !== undefined && state.ended !== 0) {
        setEnd({ state, observer: latest?.observer ?? -1 });
      }
    }, 250);
    return () => {
      clearInterval(id);
    };
  }, [client]);

  const stats = useRuntimeStore((s) => s.stats);
  const outcome = matchOutcome(end?.state ?? null, end?.observer ?? -1);
  if (end === null || outcome === null) {
    return null;
  }

  const probes = stats?.probes ?? {};
  const probe = (name: string): number | undefined => probes[`${PROBE_PREFIX}${name}`];
  const own = `f${end.observer}`;
  const foe = end.state.winner === -1 ? 'f2' : `f${end.state.winner}`;
  const stockKeys = Object.keys(probes)
    .filter((k) => k.startsWith(`${PROBE_PREFIX}stock.${own}.`))
    .sort();

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={{ fontSize: 22, marginBottom: 8 }}>{t(`end.${outcome}`)}</div>
        <div>{t('end.duration', { time: formatClock(end.state.tick) })}</div>
        <div style={{ marginTop: 10, textAlign: 'left', fontSize: 12, color: '#bbb' }}>
          <div>{t('end.units', { count: probe(`units.${own}`) ?? 0 })}</div>
          <div>{t('end.structures', { count: probe(`structures.${own}`) ?? 0 })}</div>
          <div>{t('end.waves', { count: probe(`waves.${foe}`) ?? 0 })}</div>
          {stockKeys.map((k) => (
            <div key={k}>
              {t(`end.stock.${k.split('.').pop() ?? ''}`, {
                count: probes[k] ?? 0,
                defaultValue: `${k.split('.').pop() ?? ''}: ${probes[k] ?? 0}`,
              })}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onRestart}
          style={{
            marginTop: 14,
            padding: '6px 18px',
            cursor: 'pointer',
            background: 'rgba(127,212,255,0.2)',
            color: '#fff',
            border: '1px solid #7fd4ff',
            borderRadius: 4,
            fontFamily: 'monospace',
            fontSize: 14,
          }}
        >
          {t('end.restart')}
        </button>
      </div>
    </div>
  );
}
