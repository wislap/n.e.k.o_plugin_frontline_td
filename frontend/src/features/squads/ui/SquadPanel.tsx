// Squad panel (M4): one row per own squad — digit binding, members vs
// strength with −/+ controls, localized phase/order, mean battery, and
// disband. Snapshot data is polled into local state (rows change
// seconds-scale, not per frame).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SimClient } from '../../../client/sim-client';
import { digitForTag } from '../../../client/squad-controls';
import {
  SquadsChannel,
  SquadsDisband,
  SquadsSetStrength,
  type SquadsSnapshot,
  type SquadView,
} from '../protocol';

const panel = {
  position: 'fixed',
  bottom: 170,
  left: 8,
  padding: '6px 10px',
  background: 'rgba(0,0,0,0.55)',
  color: '#fff',
  fontFamily: 'monospace',
  fontSize: 12,
  zIndex: 900,
  borderRadius: 4,
} as const;

const btn = {
  cursor: 'pointer',
  padding: '0 5px',
  marginLeft: 4,
  background: 'rgba(30,30,30,0.9)',
  color: '#fff',
  border: '1px solid #555',
} as const;

function useOwnSquads(client: SimClient): { squads: SquadView[]; observer: number } {
  const [state, setState] = useState<{ squads: SquadView[]; observer: number }>({
    squads: [],
    observer: -1,
  });
  useEffect(() => {
    const id = setInterval(() => {
      const latest = client.snapshots().latest;
      const observer = latest?.observer ?? -1;
      const all = (latest?.channels[SquadsChannel.id] as SquadsSnapshot | undefined)?.squads ?? [];
      setState({ squads: all.filter((s) => s.faction === observer), observer });
    }, 200);
    return () => {
      clearInterval(id);
    };
  }, [client]);
  return state;
}

export function SquadPanel({ client }: { client: SimClient }) {
  const { t } = useTranslation();
  const { squads } = useOwnSquads(client);
  if (squads.length === 0) {
    return null;
  }
  const setStrength = (squad: SquadView, delta: number): void => {
    const strength = Math.min(64, Math.max(1, squad.strength + delta));
    if (strength !== squad.strength) {
      client.submit({ type: SquadsSetStrength.type, payload: { squad: squad.id, strength } });
    }
  };
  return (
    <div style={panel}>
      {squads.map((squad) => {
        const digit = digitForTag(squad.tag);
        const energy = squad.meanEnergyBp;
        return (
          <div key={squad.id} style={{ marginBottom: 2 }}>
            <b>{digit ?? '—'}</b> {squad.members?.length ?? 0}/{squad.strength}
            <button
              type="button"
              style={btn}
              onClick={() => {
                setStrength(squad, -1);
              }}
            >
              {'−'}
            </button>
            <button
              type="button"
              style={btn}
              onClick={() => {
                setStrength(squad, 1);
              }}
            >
              {'+'}
            </button>{' '}
            {t(`squad.phase.${squad.phase}`, { defaultValue: squad.phase })} ·{' '}
            {t(`squad.order.${squad.order.kind}`, { defaultValue: squad.order.kind })}
            {energy !== undefined && ` · ${Math.round(energy / 100)}%`}
            <button
              type="button"
              style={btn}
              onClick={() => {
                client.submit({ type: SquadsDisband.type, payload: { squad: squad.id } });
              }}
            >
              {t('squad.disband')}
            </button>
          </div>
        );
      })}
    </div>
  );
}
