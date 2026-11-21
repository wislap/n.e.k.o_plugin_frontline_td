// Warehouse stock panel (ADR 0048, top-right): stock per cargo with
// localized names, rolling net stock rates (/s), unmet demand/export
// counts by reason with a one-line suggestion, and the construction ⇄
// production priority toggle. Driven by useSnapshotValue.
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SimClient, SnapshotPair } from '../../../client/sim-client';
import { createStockRateTracker } from '../../../client/stock-rate';
import { useSnapshotValue } from '../../../client/use-snapshot';
import { localName, type ContentDb } from '../../../content/index';
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
  minWidth: 200,
} as const;

interface StockSlice {
  tick: number;
  network: LogisticsNetwork | null;
  rates: readonly number[];
}

function sameStockSlice(a: StockSlice, b: StockSlice): boolean {
  return a.tick === b.tick && a.network === b.network;
}

function formatRate(milliPerSec: number): string {
  const units = milliPerSec / 1000;
  if (milliPerSec > 0) {
    return `+${units.toFixed(1)}`;
  }
  if (milliPerSec < 0) {
    return units.toFixed(1);
  }
  return '0.0';
}

function rateColor(milliPerSec: number): string {
  if (milliPerSec > 0) {
    return '#7aff9a';
  }
  if (milliPerSec < 0) {
    return '#ff9a7a';
  }
  return '#999';
}

export function StockPanel({ client, db }: { client: SimClient; db: ContentDb }) {
  const { t } = useTranslation();
  const [tracker] = useState(() => createStockRateTracker());

  const selectStock = useCallback(
    (pair: SnapshotPair): StockSlice => {
      const latest = pair.latest;
      const network =
        (latest?.channels[LogisticsNetworkChannel.id] as LogisticsNetwork | undefined) ?? null;
      if (latest === null || network === null) {
        return { tick: -1, network: null, rates: [] };
      }
      const rates = tracker.sample(latest.tick, network.stock);
      return { tick: latest.tick, network, rates };
    },
    [tracker],
  );

  const { network, rates } = useSnapshotValue(client, selectStock, sameStockSlice, POLL_MS);

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
        const rateMilli = rates[cargo] ?? 0;
        return (
          <div key={id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span>
              {t(`cargo.${localName(id)}`, { defaultValue: localName(id) })}:{' '}
              {Math.floor(milli / 1000)}
            </span>
            <span style={{ color: rateColor(rateMilli) }}>
              {t('stock.rate', { value: formatRate(rateMilli) })}
            </span>
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
