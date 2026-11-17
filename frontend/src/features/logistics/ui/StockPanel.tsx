// Warehouse stock panel (M3 D, top-right): stock per cargo with
// localized names, unmet demand/export counts by reason with a one-line
// suggestion, and the construction ⇄ production priority toggle.
// Snapshot data is polled, not subscribed (per-tick state stays out of
// React).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SimClient } from '../../../client/sim-client';
import type { ContentDb } from '../../../content/index';
import {
  ADJUSTABLE_CLASSES,
  LogisticsNetworkChannel,
  SetPrioritiesCommand,
  UNMET_REASONS,
  type CargoClassName,
  type LogisticsNetwork,
} from '../protocol';

const POLL_MS = 500;
const panel = {
  position: 'fixed',
  top: 8,
  right: 8,
  padding: '8px 10px',
  background: 'rgba(0,0,0,0.55)',
  color: '#fff',
  fontFamily: 'monospace',
  fontSize: 12,
  zIndex: 900,
  borderRadius: 4,
  minWidth: 180,
} as const;

function cargoName(id: string): string {
  return id.split(':')[1] ?? id;
}

export function StockPanel({ client, db }: { client: SimClient; db: ContentDb }) {
  const { t } = useTranslation();
  const [network, setNetwork] = useState<LogisticsNetwork | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      const ch = client.snapshots().latest?.channels[LogisticsNetworkChannel.id];
      setNetwork((ch as LogisticsNetwork | undefined) ?? null);
    }, POLL_MS);
    return () => {
      clearInterval(id);
    };
  }, [client]);

  if (network === null) {
    return null;
  }
  const adjustable = network.priorities.filter((p): p is CargoClassName =>
    (ADJUSTABLE_CLASSES as readonly string[]).includes(p),
  );

  return (
    <div style={panel}>
      <div>{t('stock.title')}</div>
      {network.stock.map((milli, cargo) => {
        const id = db.cargos.byIndex(cargo)?.id ?? String(cargo);
        return (
          <div key={id}>
            {t(`cargo.${cargoName(id)}`, { defaultValue: cargoName(id) })}:{' '}
            {Math.floor(milli / 1000)}
          </div>
        );
      })}
      {UNMET_REASONS.map((reason, i) => {
        const demand = network.unmet[i] ?? 0;
        const exported = network.unmetExport[i] ?? 0;
        if (reason === 'none' || demand + exported === 0) {
          return null;
        }
        return (
          <div key={reason} style={{ color: '#ffb37a' }}>
            {t(`reason.${reason}`, { defaultValue: reason })}: {demand + exported} —{' '}
            {t(`suggest.${reason}`, { defaultValue: '' })}
          </div>
        );
      })}
      {adjustable.length === 2 && (
        <button
          type="button"
          style={{ marginTop: 4, cursor: 'pointer' }}
          onClick={() => {
            client.submit({
              type: SetPrioritiesCommand.type,
              payload: { order: [...adjustable].reverse() },
            });
          }}
        >
          {t('stock.priorities', { order: adjustable.map((c) => t(`class.${c}`)).join(' > ') })}
        </button>
      )}
    </div>
  );
}
