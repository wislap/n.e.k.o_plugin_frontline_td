// Warehouse stock panel (ADR 0048, topRight): stock per cargo with
// localized names, rolling net stock rates (/s), unmet demand/export
// counts by reason with a one-line suggestion, and the construction ⇄
// production priority toggle. Driven by useSnapshotValue.
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SimClient, SnapshotPair } from '../../../client/sim-client';
import { createStockRateTracker } from '../../../client/stock-rate';
import { useSnapshotValue } from '../../../client/use-snapshot';
import { localName, type ContentDb } from '../../../content/index';
import { IconCargo, IconSwap } from '../../../ui/icons';
import { ActionButton, RateBadge, TacticalPanel } from '../../../ui/kit/index';
import {
  ADJUSTABLE_CLASSES,
  LogisticsNetworkChannel,
  SetPrioritiesCommand,
  UNMET_REASONS,
  type CargoClassName,
  type LogisticsNetwork,
} from '../protocol';
import styles from './StockPanel.module.css';

const POLL_MS = 500;

interface StockSlice {
  tick: number;
  network: LogisticsNetwork | null;
  rates: readonly number[];
}

function sameStockSlice(a: StockSlice, b: StockSlice): boolean {
  return a.tick === b.tick && a.network === b.network;
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

  const unmetEntries = UNMET_REASONS.map((reason, i) => ({
    reason,
    count: (network.unmet[i] ?? 0) + (network.unmetExport[i] ?? 0),
  })).filter((entry) => entry.reason !== 'none' && entry.count > 0);

  return (
    <TacticalPanel tone="neutral" compact title={t('stock.title')} className={styles['panel']}>
      <div className={styles['rows']}>
        {network.stock.map((milli, cargo) => {
          const id = db.cargos.byIndex(cargo)?.id ?? String(cargo);
          const cargoKey = localName(id);
          const rateMilli = rates[cargo] ?? 0;
          return (
            <div key={id} className={styles['row']}>
              <IconCargo id={cargoKey} size={13} className={styles['cargoIcon']} />
              <span className={styles['cargoName']}>
                {t(`cargo.${cargoKey}`, { defaultValue: cargoKey })}
              </span>
              <div className={styles['metrics']}>
                <span className={styles['amount']}>{Math.floor(milli / 1000)}</span>
                <RateBadge milliPerSec={rateMilli} suffix={t('stock.per_sec')} />
              </div>
            </div>
          );
        })}
      </div>

      {unmetEntries.length > 0 && (
        <div className={styles['warnings']}>
          {unmetEntries.map(({ reason, count }) => {
            const suggestion = t(`suggest.${reason}`, { defaultValue: '' });
            return (
              <div key={reason} className={styles['warnItem']}>
                <div className={styles['warnHead']}>
                  <span>{t(`reason.${reason}`, { defaultValue: reason })}</span>
                  <span className={styles['warnCount']}>{count}</span>
                </div>
                {suggestion.length > 0 && <div className={styles['warnSuggest']}>{suggestion}</div>}
              </div>
            );
          })}
        </div>
      )}

      {adjustable.length === 2 && (
        <div className={styles['footer']}>
          <ActionButton
            size="sm"
            className={styles['priorityBtn']}
            title={t('stock.priorities', {
              order: adjustable.map((c) => t(`class.${c}`)).join(' ⇄ '),
            })}
            onClick={() => {
              client.submit({
                type: SetPrioritiesCommand.type,
                payload: { order: [...adjustable].reverse() },
              });
            }}
          >
            <IconSwap size={13} />
            {t('stock.priorities', {
              order: adjustable.map((c) => t(`class.${c}`)).join(' ⇄ '),
            })}
          </ActionButton>
        </div>
      )}
    </TacticalPanel>
  );
}
