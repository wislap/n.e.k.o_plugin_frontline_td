// Squad panel (ADR 0048): visible only in command primary mode (F1)
// when at least one own squad exists. Driven by useSnapshotValue.
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useInteractionStore } from '../../../client/interaction-store';
import type { SimClient, SnapshotPair } from '../../../client/sim-client';
import { digitForTag } from '../../../client/squad-controls';
import { useSnapshotValue } from '../../../client/use-snapshot';
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

interface SquadSlice {
  tick: number;
  observer: number;
  squads: SquadView[];
}

function sameSquadSlice(a: SquadSlice, b: SquadSlice): boolean {
  return a.tick === b.tick && a.observer === b.observer && a.squads.length === b.squads.length;
}

export function SquadPanel({ client }: { client: SimClient }) {
  const { t } = useTranslation();
  const mode = useInteractionStore((s) => s.mode);

  const selectSquads = useCallback((pair: SnapshotPair): SquadSlice => {
    const latest = pair.latest;
    const observer = latest?.observer ?? -1;
    const all = (latest?.channels[SquadsChannel.id] as SquadsSnapshot | undefined)?.squads ?? [];
    return {
      tick: latest?.tick ?? -1,
      observer,
      squads: all.filter((s) => s.faction === observer),
    };
  }, []);

  const { squads } = useSnapshotValue(client, selectSquads, sameSquadSlice, 200);

  if (mode !== 'command' || squads.length === 0) {
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
