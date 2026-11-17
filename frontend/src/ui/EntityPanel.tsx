// Entity panel (M3 D, bottom-left): single-selection detail driven by
// SimClient.inspect — construction progress and waiting reason, logistics
// slots with unmet reasons, production state, combat hp/weapon, and the
// modifier list. Multi-select keeps the count plus per-kind breakdown and
// the G/X action hints. Protocol codes are localized via reason./class./
// state. keys with defaultValue fallbacks — never printed raw.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EntityHandle, Inspection } from '../core/index';
import type { SimClient } from '../client/sim-client';
import { useSelectionStore } from '../client/selection-store';
import type { ContentDb } from '../content/index';
import { StructuresChannel, type ConstructionStructures } from '../features/construction/protocol';
import { DenseUnitsChannel, type DenseUnits } from '../features/units/protocol';

const POLL_MS = 200;
const panel = {
  position: 'fixed',
  bottom: 40,
  left: 8,
  padding: '8px 10px',
  background: 'rgba(0,0,0,0.6)',
  color: '#fff',
  fontFamily: 'monospace',
  fontSize: 12,
  zIndex: 900,
  borderRadius: 4,
  maxWidth: 320,
} as const;

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function Bar({ bp }: { bp: number }) {
  const frac = Math.max(0, Math.min(10000, bp)) / 10000;
  return (
    <div style={{ background: '#333', height: 6, borderRadius: 2, margin: '2px 0' }}>
      <div
        style={{
          width: `${frac * 100}%`,
          height: '100%',
          borderRadius: 2,
          background: `rgb(${Math.round((1 - frac) * 255)},${Math.round(frac * 220)},60)`,
        }}
      />
    </div>
  );
}

// Per-kind breakdown for multi-select (units + structures by channel).
function useBreakdown(client: SimClient, selected: ReadonlySet<number>): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    const id = setInterval(() => {
      const latest = client.snapshots().latest;
      const next = new Map<string, number>();
      const units = latest?.channels[DenseUnitsChannel.id] as DenseUnits | undefined;
      const structures = latest?.channels[StructuresChannel.id] as
        ConstructionStructures | undefined;
      if (units !== undefined) {
        for (let i = 0; i < units.handles.length; i++) {
          if (selected.has(units.handles[i] ?? 0)) {
            const key = `unit:${units.kind[i] ?? 0}`;
            next.set(key, (next.get(key) ?? 0) + 1);
          }
        }
      }
      if (structures !== undefined) {
        for (let i = 0; i < structures.handles.length; i++) {
          if (selected.has(structures.handles[i] ?? 0)) {
            const key = `structure:${structures.kind[i] ?? 0}`;
            next.set(key, (next.get(key) ?? 0) + 1);
          }
        }
      }
      setCounts(next);
    }, POLL_MS);
    return () => {
      clearInterval(id);
    };
  }, [client, selected]);
  return counts;
}

export function EntityPanel({ client, db }: { client: SimClient; db: ContentDb }) {
  const { t } = useTranslation();
  const selected = useSelectionStore((s) => s.selected);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const breakdown = useBreakdown(client, selected);

  // Single selection → inspect that handle; anything else → clear.
  useEffect(() => {
    const handle = selected.size === 1 ? ([...selected][0] ?? null) : null;
    client.inspect(handle as EntityHandle | null);
  }, [client, selected]);

  useEffect(() => {
    const id = setInterval(() => {
      setInspection(client.inspection());
    }, POLL_MS);
    return () => {
      clearInterval(id);
    };
  }, [client]);

  if (selected.size === 0) {
    return null;
  }
  if (selected.size > 1) {
    const names = [...breakdown.entries()].map(([key, count]) => {
      const [kind, index] = key.split(':');
      const contentId =
        kind === 'unit'
          ? db.units.byIndex(Number(index))?.id
          : db.structures.byIndex(Number(index))?.id;
      const name = contentId?.split(':')[1] ?? key;
      return `${count}× ${t(`${kind}.${name}`, { defaultValue: name })}`;
    });
    return (
      <div style={panel}>
        <div>{t('panel.selected', { count: selected.size })}</div>
        {names.map((n) => (
          <div key={n}>{n}</div>
        ))}
        <div style={{ color: '#9ecbff' }}>{t('panel.multi_hint')}</div>
      </div>
    );
  }
  if (inspection === null) {
    return (
      <div style={panel}>
        <div>{t('panel.loading')}</div>
      </div>
    );
  }

  const construction = inspection.sections['frontline_td:construction'] as
    Record<string, unknown> | undefined;
  const logistics = inspection.sections['frontline_td:logistics'] as
    Record<string, unknown> | undefined;
  const production = inspection.sections['frontline_td:production'] as
    Record<string, unknown> | undefined;
  const combat = inspection.sections['frontline_td:combat'] as Record<string, unknown> | undefined;
  const kindName = str(construction?.['kind']).split(':')[1];

  return (
    <div style={panel}>
      {construction !== undefined && (
        <div>
          <div>
            {t(`structure.${kindName}`, { defaultValue: kindName || '?' })} —{' '}
            {t(`state.${str(construction['state'])}`, {
              defaultValue: str(construction['state']),
            })}
          </div>
          {num(construction['total']) > 0 && <Bar bp={num(construction['progressBp'])} />}
          {str(construction['waiting']) !== '' && construction['waiting'] !== null && (
            <div style={{ color: '#ffb37a' }}>
              {t(`reason.${str(construction['waiting'])}`, {
                defaultValue: str(construction['waiting']),
              })}
            </div>
          )}
          {Array.isArray(construction['slots']) &&
            (construction['slots'] as Record<string, unknown>[]).map((slot, i) => {
              const cargoId = db.cargos.byIndex(num(slot['cargo']))?.id ?? '?';
              const name = cargoId.split(':')[1] ?? cargoId;
              return (
                <div key={i}>
                  {t(`cargo.${name}`, { defaultValue: name })}:{' '}
                  {Math.floor(num(slot['delivered']) / 1000)}/
                  {Math.floor(num(slot['required']) / 1000)}
                </div>
              );
            })}
        </div>
      )}
      {combat !== undefined && (
        <div>
          {num(combat['max']) > 0 && (
            <>
              {t('panel.hp', {
                hp: Math.ceil(num(combat['hp']) / 1000),
                max: Math.ceil(num(combat['max']) / 1000),
              })}
              <Bar bp={(num(combat['hp']) / Math.max(1, num(combat['max']))) * 10000} />
            </>
          )}
          {combat['readyIn'] !== undefined && (
            <div>
              {num(combat['readyIn']) === 0
                ? t('panel.weapon_ready')
                : t('panel.weapon_reloading', { ticks: num(combat['readyIn']) })}
              {num(combat['costCargo']) >= 0 &&
                ` — ${t('panel.ammo', { count: Math.floor(num(combat['costStock']) / 1000) })}`}
            </div>
          )}
        </div>
      )}
      {production !== undefined && (
        <div>
          {t('panel.production')}:{' '}
          {t(`prod.${str(production['state'])}`, { defaultValue: str(production['state']) })}
          {num(production['total']) > 0 &&
            ` (${num(production['progress'])}/${num(production['total'])})`}
          {str(production['nextUnit']) !== '' &&
            ` — ${t('panel.next_unit', {
              name: t(`unit.${str(production['nextUnit']).split(':')[1] ?? ''}`, {
                defaultValue: str(production['nextUnit']).split(':')[1] ?? '',
              }),
            })}`}
          {Array.isArray(production['missing']) &&
            (production['missing'] as number[]).length > 0 &&
            ` — ${(production['missing'] as number[])
              .map((c) => {
                const id = db.cargos.byIndex(c)?.id ?? String(c);
                const name = id.split(':')[1] ?? id;
                return t(`cargo.${name}`, { defaultValue: name });
              })
              .join(', ')}`}
        </div>
      )}
      {logistics !== undefined && Array.isArray(logistics['slots']) && (
        <div>
          {(logistics['slots'] as Record<string, unknown>[]).map((slot, i) => {
            const cargoId = str(slot['cargo']);
            const name = cargoId.split(':')[1] ?? cargoId;
            const unmet = str(slot['unmet']);
            return (
              <div key={i}>
                {t(`cargo.${name}`, { defaultValue: name })}:{' '}
                {Math.floor(num(slot['amount']) / 1000)}/{Math.floor(num(slot['capacity']) / 1000)}{' '}
                (
                {t(`class.${str(slot['class'])}`, {
                  defaultValue: str(slot['class']),
                })}
                {slot['export'] === true ? `, ${t('panel.export')}` : ''})
                {unmet !== 'none' && unmet !== '' && (
                  <span style={{ color: '#ffb37a' }}>
                    {' '}
                    {t(`reason.${unmet}`, { defaultValue: unmet })}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {inspection.modifiers.length > 0 && (
        <div>
          {inspection.modifiers.map((m, i) => {
            const source = m.source.split('.').pop() ?? m.source;
            return (
              <div key={i} style={{ color: '#9ecbff' }}>
                {t(`mod.${source}`, { defaultValue: source })}: {m.op === 'mul_bp' ? '×' : '+'}
                {m.op === 'mul_bp' ? m.value / 10000 : m.value}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
