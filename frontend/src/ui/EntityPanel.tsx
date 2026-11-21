// Entity & terrain inspector panel (ADR 0048, bottom-left): strongly-typed
// snapshot-first inspection driven by activeInspectorSubject (pinned ?? hovered),
// with 80 ms debounced SimClient.inspect ONLY for single own entities, localized
// terrain/fog cell previews, ruin capture progress, and clickable action buttons.
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveInspectedSubject, type ResolvedSubjectView } from '../client/inspect-subject';
import { activeInspectorSubject, useInspectorStore } from '../client/inspector-store';
import { useInteractionStore } from '../client/interaction-store';
import { useIntentRouter } from '../client/intent';
import { useSelectionStore } from '../client/selection-store';
import type { SimClient, SnapshotPair } from '../client/sim-client';
import { useSnapshotValue } from '../client/use-snapshot';
import { localName, type ContentDb, type ResolvedMap } from '../content/index';
import type { EntityHandle, Inspection, Snapshot } from '../core/index';
import type { CombatInspection } from '../features/combat/protocol';
import type { LogisticsInspection } from '../features/logistics/protocol';
import { TERRAIN_HEIGHT_LAYER_ID } from '../features/terrain/protocol';

const POLL_MS = 100;
const INSPECT_DEBOUNCE_MS = 80;

const panel = {
  position: 'fixed',
  bottom: 40,
  left: 8,
  padding: '8px 10px',
  background: 'rgba(0,0,0,0.68)',
  color: '#fff',
  fontFamily: 'monospace',
  fontSize: 12,
  zIndex: 900,
  borderRadius: 4,
  maxWidth: 340,
  minWidth: 220,
  pointerEvents: 'auto',
} as const;

const actionBtn = {
  cursor: 'pointer',
  padding: '2px 6px',
  fontFamily: 'monospace',
  fontSize: 11,
  background: 'rgba(30,30,30,0.9)',
  color: '#fff',
  border: '1px solid #555',
  borderRadius: 3,
} as const;

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

interface SnapshotSlice {
  tick: number;
  snapshot: Snapshot | null;
  inspection: Inspection | null;
}

function sameSnapshotSlice(a: SnapshotSlice, b: SnapshotSlice): boolean {
  return a.tick === b.tick && a.snapshot === b.snapshot && a.inspection === b.inspection;
}

function inferMap(db: ContentDb, snapshot: Snapshot | null): ResolvedMap | null {
  const heightLen = snapshot?.layers[TERRAIN_HEIGHT_LAYER_ID]?.length;
  if (heightLen !== undefined) {
    const matched = db.maps.list.find((m) => m.width * m.height === heightLen);
    if (matched !== undefined) {
      return matched;
    }
  }
  return db.maps.list[0] ?? null;
}

function defaultIsHostile(observer: number, faction: number): boolean {
  return faction !== 0 && faction !== observer;
}

function confirmMatchesView(
  confirm: { targets: readonly number[] } | null,
  view: ResolvedSubjectView,
  selected: ReadonlySet<number>,
  isPinned: boolean,
): boolean {
  if (confirm === null || !isPinned) {
    return false;
  }
  if (view.kind === 'own_structure' || view.kind === 'road_segment') {
    return confirm.targets.includes(view.handle);
  }
  if (view.kind === 'multi_own') {
    return confirm.targets.length > 0 && confirm.targets.every((h) => selected.has(h));
  }
  return false;
}

function CombatSection({ combat }: { combat: CombatInspection | null }) {
  const { t } = useTranslation();
  if (combat === null) {
    return null;
  }
  return (
    <div>
      {combat.max > 0 && (
        <>
          {t('panel.hp', {
            hp: Math.ceil(combat.hp / 1000),
            max: Math.ceil(combat.max / 1000),
          })}
          <Bar bp={(combat.hp / Math.max(1, combat.max)) * 10000} />
        </>
      )}
      {combat.readyIn !== undefined && (
        <div>
          {combat.readyIn === 0
            ? t('panel.weapon_ready')
            : t('panel.weapon_reloading', { ticks: combat.readyIn })}
          {combat.costCargo !== undefined &&
            combat.costCargo >= 0 &&
            ` — ${t('panel.ammo', { count: Math.floor((combat.costStock ?? 0) / 1000) })}`}
        </div>
      )}
    </div>
  );
}

function LogisticsSection({ logistics }: { logistics: LogisticsInspection | null }) {
  const { t } = useTranslation();
  if (logistics === null) {
    return null;
  }
  return (
    <div>
      {logistics.node !== null && (
        <div style={{ color: '#9ecbff' }}>
          {t('inspector.node_summary', {
            connect: Math.round(logistics.node.connect / 10),
            service: logistics.node.service,
            vehicles: logistics.node.vehicles,
          })}
          {logistics.node.warehouse ? ` · ${t('inspector.warehouse_tag')}` : ''}
        </div>
      )}
      {logistics.slots.map((slot, i) => {
        const name = localName(String(slot.cargo));
        return (
          <div key={i}>
            {t(`cargo.${name}`, { defaultValue: name })}: {Math.floor(slot.amount / 1000)}/
            {Math.floor(slot.capacity / 1000)} (
            {t(`class.${slot.class}`, { defaultValue: slot.class })}
            {slot.export ? `, ${t('panel.export')}` : ''})
            {slot.unmet !== 'none' && (
              <span style={{ color: '#ffb37a' }}>
                {' '}
                {t(`reason.${slot.unmet}`, { defaultValue: slot.unmet })}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ModifiersSection({ modifiers }: { modifiers: Inspection['modifiers'] }) {
  const { t } = useTranslation();
  if (modifiers.length === 0) {
    return null;
  }
  return (
    <div>
      {modifiers.map((m, i) => {
        const source = m.source.split('.').pop() ?? m.source;
        return (
          <div key={i} style={{ color: '#9ecbff' }}>
            {t(`mod.${source}`, { defaultValue: source })}: {m.op === 'mul_bp' ? '×' : '+'}
            {m.op === 'mul_bp' ? m.value / 10000 : m.value}
          </div>
        );
      })}
    </div>
  );
}

function SubjectBody({
  view,
  db,
  isPinned,
  canActivate,
  canDemolish,
  hasConfirm,
  onActivate,
  onDemolish,
  onConfirmDemolish,
}: {
  view: ResolvedSubjectView;
  db: ContentDb;
  isPinned: boolean;
  canActivate: boolean;
  canDemolish: boolean;
  hasConfirm: boolean;
  onActivate: () => void;
  onDemolish: () => void;
  onConfirmDemolish: () => void;
}) {
  const { t } = useTranslation();

  const renderActions = (showActivate: boolean, showDemolish: boolean) => {
    if (!isPinned || (!showActivate && !showDemolish && !hasConfirm)) {
      return null;
    }
    return (
      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        {showActivate && (
          <button type="button" style={actionBtn} onClick={onActivate}>
            {t('inspector.activate_btn')}
          </button>
        )}
        {hasConfirm ? (
          <button
            type="button"
            style={{
              ...actionBtn,
              border: '1px solid #ff8a7a',
              background: 'rgba(255,138,122,0.28)',
            }}
            onClick={onConfirmDemolish}
          >
            {t('inspector.confirm_demolish_btn')}
          </button>
        ) : (
          showDemolish && (
            <button type="button" style={actionBtn} onClick={onDemolish}>
              {t('inspector.demolish_btn')}
            </button>
          )
        )}
      </div>
    );
  };

  switch (view.kind) {
    case 'multi_own':
      return (
        <div>
          <div>{t('panel.selected', { count: view.count })}</div>
          {view.breakdown.map((item) => {
            const name = localName(item.contentId);
            return (
              <div key={`${item.category}:${item.contentId}`}>
                {item.count}× {t(`${item.category}.${name}`, { defaultValue: name })}
              </div>
            );
          })}
          {renderActions(canActivate, canDemolish)}
          <div style={{ color: '#9ecbff', marginTop: 4 }}>{t('panel.multi_hint')}</div>
        </div>
      );

    case 'cell_unexplored':
      return (
        <div>
          <div>{t('inspector.cell_coords', { x: view.x, y: view.y })}</div>
          <div style={{ color: '#999' }}>{t('inspector.unexplored')}</div>
        </div>
      );

    case 'cell': {
      const surfaceName = view.surfaceId !== null ? localName(view.surfaceId) : null;
      const surfaceLabel =
        surfaceName !== null
          ? t(`surface.${surfaceName}`, { defaultValue: surfaceName })
          : t('inspector.unknown');
      return (
        <div>
          <div>
            {t('inspector.cell_coords', { x: view.x, y: view.y })}
            {view.visionState === 1 ? ` · ${t('inspector.fog_memory')}` : ''}
          </div>
          <div>{t('inspector.surface_label', { name: surfaceLabel })}</div>
          <div>
            {t('inspector.height', { h: view.height })}
            {view.isRamp ? ` · ${t('inspector.ramp')}` : ''}
          </div>
          {view.depositId !== null && (
            <div style={{ color: '#ffd166' }}>
              {t('inspector.deposit', {
                cargo: t(`cargo.${localName(view.depositId)}`, {
                  defaultValue: localName(view.depositId),
                }),
              })}
            </div>
          )}
          {view.roadLevel > 0 && <div>{t('inspector.road_level', { level: view.roadLevel })}</div>}
          <div style={{ color: view.covered ? '#9ecbff' : '#bbb' }}>
            {t(view.covered ? 'inspector.covered' : 'inspector.uncovered')}
          </div>
          {view.excluded && <div style={{ color: '#ff8a7a' }}>{t('inspector.hostile_zone')}</div>}
        </div>
      );
    }

    case 'own_unit': {
      const name = localName(view.contentId);
      const maxHp = view.unit?.hp ?? 0;
      return (
        <div>
          <div>
            {t(`unit.${name}`, { defaultValue: name })} —{' '}
            {t(view.moving ? 'inspector.unit_moving' : 'inspector.unit_idle')}
          </div>
          {view.combat !== null ? (
            <CombatSection combat={view.combat} />
          ) : (
            <>
              {maxHp > 0 && (
                <div>
                  {t('panel.hp', {
                    hp: Math.ceil((view.hpBp * maxHp) / 10000),
                    max: maxHp,
                  })}
                </div>
              )}
              <Bar bp={view.hpBp} />
            </>
          )}
          {view.energyBp !== null && (
            <div>{t('inspector.energy', { pct: Math.round(view.energyBp / 100) })}</div>
          )}
          <LogisticsSection logistics={view.logistics} />
          <ModifiersSection modifiers={view.modifiers} />
        </div>
      );
    }

    case 'hostile_unit': {
      const name = localName(view.contentId);
      const maxHp = view.unit?.hp ?? 0;
      return (
        <div>
          <div style={{ color: '#ff9a7a' }}>
            {t(`unit.${name}`, { defaultValue: name })} · {t('inspector.hostile_tag')}
          </div>
          <div>{t(view.moving ? 'inspector.unit_moving' : 'inspector.unit_idle')}</div>
          {maxHp > 0 && (
            <div>
              {t('panel.hp', {
                hp: Math.ceil((view.hpBp * maxHp) / 10000),
                max: maxHp,
              })}
            </div>
          )}
          <Bar bp={view.hpBp} />
          {view.energyBp !== null && (
            <div>{t('inspector.energy', { pct: Math.round(view.energyBp / 100) })}</div>
          )}
        </div>
      );
    }

    case 'own_structure': {
      const name = localName(view.contentId);
      const c = view.construction;
      const p = view.production;
      const showActivate = view.stateName === 'blueprint' || view.stateName === 'waiting';
      const showDemolish =
        canDemolish &&
        (view.stateName === 'blueprint' ||
          view.stateName === 'waiting' ||
          view.stateName === 'site' ||
          view.stateName === 'operational');
      return (
        <div>
          <div>
            {t(`structure.${name}`, { defaultValue: name })} —{' '}
            {t(`state.${view.stateName}`, { defaultValue: view.stateName })}
          </div>
          {c !== null ? (
            <>
              {c.total > 0 && <Bar bp={c.progressBp} />}
              {c.waiting !== undefined && c.waiting !== null && c.waiting !== '' && (
                <div style={{ color: '#ffb37a' }}>
                  {t(`reason.${c.waiting}`, { defaultValue: c.waiting })}
                </div>
              )}
              {c.slots?.map((slot, i) => {
                const cargoId = db.cargos.byIndex(slot.cargo)?.id ?? '?';
                const cargoName = localName(cargoId);
                return (
                  <div key={i}>
                    {t(`cargo.${cargoName}`, { defaultValue: cargoName })}:{' '}
                    {Math.floor(slot.delivered / 1000)}/{Math.floor(slot.required / 1000)}
                  </div>
                );
              })}
            </>
          ) : (
            (view.stateName === 'site' || view.stateName === 'demolishing') && (
              <Bar bp={view.progressBp} />
            )
          )}
          {view.combat !== null ? (
            <CombatSection combat={view.combat} />
          ) : (
            view.structure?.hp !== undefined && (
              <>
                <div>
                  {t('panel.hp', {
                    hp: Math.ceil((view.hpBp * view.structure.hp) / 10000),
                    max: view.structure.hp,
                  })}
                </div>
                <Bar bp={view.hpBp} />
              </>
            )
          )}
          {p !== null && (
            <div>
              {t('panel.production')}: {t(`prod.${p.state}`, { defaultValue: p.state })}
              {p.total > 0 && ` (${p.progress}/${p.total})`}
              {p.nextUnit !== undefined &&
                p.nextUnit !== '' &&
                ` — ${t('panel.next_unit', {
                  name: t(`unit.${localName(p.nextUnit)}`, {
                    defaultValue: localName(p.nextUnit),
                  }),
                })}`}
              {p.missing.length > 0 &&
                ` — ${p.missing
                  .map((cargoIdx) => {
                    const id = db.cargos.byIndex(cargoIdx)?.id ?? String(cargoIdx);
                    const cargoName = localName(id);
                    return t(`cargo.${cargoName}`, { defaultValue: cargoName });
                  })
                  .join(', ')}`}
            </div>
          )}
          <LogisticsSection logistics={view.logistics} />
          <ModifiersSection modifiers={view.modifiers} />
          {renderActions(showActivate, showDemolish)}
        </div>
      );
    }

    case 'hostile_structure': {
      const name = localName(view.contentId);
      const maxHp = view.structure?.hp ?? 0;
      return (
        <div>
          <div style={{ color: '#ff9a7a' }}>
            {t(`structure.${name}`, { defaultValue: name })} —{' '}
            {t(`state.${view.stateName}`, { defaultValue: view.stateName })} ·{' '}
            {t('inspector.hostile_tag')}
          </div>
          {view.stateName === 'site' && <Bar bp={view.progressBp} />}
          {maxHp > 0 && (
            <div>
              {t('panel.hp', {
                hp: Math.ceil((view.hpBp * maxHp) / 10000),
                max: maxHp,
              })}
            </div>
          )}
          <Bar bp={view.hpBp} />
        </div>
      );
    }

    case 'ruin': {
      const name = localName(view.contentId);
      return (
        <div>
          <div>
            {t(`structure.${name}_ruin`, {
              defaultValue: t(`structure.${name}`, { defaultValue: name }),
            })}
          </div>
          <div>{t('inspector.capture_progress', { pct: Math.round(view.progressBp / 100) })}</div>
          <Bar bp={view.progressBp} />
          {view.contested && <div style={{ color: '#ffd166' }}>{t('capture.contested')}</div>}
        </div>
      );
    }

    case 'salvage':
      return (
        <div>
          <div>
            {t('inspector.salvage')} ({view.x}, {view.y})
          </div>
          <LogisticsSection logistics={view.logistics} />
        </div>
      );

    case 'road_segment':
      return (
        <div>
          <div>
            {t('inspector.road_segment')} ({Math.round(view.x)}, {Math.round(view.y)})
          </div>
          <Bar bp={view.progressBp} />
          <CombatSection combat={view.combat} />
          <LogisticsSection logistics={view.logistics} />
          {renderActions(false, canDemolish)}
        </div>
      );

    case 'memory': {
      const name = localName(view.contentId);
      return (
        <div>
          <div style={{ color: '#bbb' }}>
            {t(`structure.${name}`, { defaultValue: name })} · {t('inspector.fog_memory')}
          </div>
          <div>
            {t(`state.${view.stateName}`, { defaultValue: view.stateName })} ({view.x}, {view.y})
          </div>
        </div>
      );
    }
  }
}

export function EntityPanel({
  client,
  db,
  map,
  isHostile,
}: {
  client: SimClient;
  db: ContentDb;
  map?: ResolvedMap | null;
  isHostile?: (observer: number, faction: number) => boolean;
}) {
  const { t } = useTranslation();
  const router = useIntentRouter();
  const hovered = useInspectorStore((s) => s.hovered);
  const pinned = useInspectorStore((s) => s.pinned);
  const selected = useSelectionStore((s) => s.selected);
  const mode = useInteractionStore((s) => s.mode);
  const demolishConfirm = useInteractionStore((s) => s.demolishConfirm);
  const subject = activeInspectorSubject({ hovered, pinned });

  const inspectHandle =
    subject !== null &&
    (subject.kind === 'own_unit' ||
      subject.kind === 'own_structure' ||
      subject.kind === 'road_segment')
      ? subject.handle
      : null;

  // 80 ms debounced deep inspection for single own entities only.
  useEffect(() => {
    if (inspectHandle === null) {
      client.inspect(null);
      return;
    }
    const id = setTimeout(() => {
      client.inspect(inspectHandle as EntityHandle);
    }, INSPECT_DEBOUNCE_MS);
    return () => {
      clearTimeout(id);
    };
  }, [client, inspectHandle]);

  const selectSnapshot = useCallback(
    (pair: SnapshotPair): SnapshotSlice => ({
      tick: pair.latest?.tick ?? -1,
      snapshot: pair.latest,
      inspection: client.inspection(),
    }),
    [client],
  );

  const snap = useSnapshotValue(client, selectSnapshot, sameSnapshotSlice, POLL_MS);

  const view = useMemo(() => {
    const resolvedMap = map ?? inferMap(db, snap.snapshot);
    const hostileFn = isHostile ?? defaultIsHostile;
    return resolveInspectedSubject({
      db,
      map: resolvedMap,
      snapshot: snap.snapshot,
      isHostile: hostileFn,
      subject,
      selected,
      inspection: snap.inspection,
    });
  }, [db, map, isHostile, snap.snapshot, snap.inspection, subject, selected]);

  if (view === null) {
    return null;
  }

  const isPinned = pinned !== null;
  const canActivate = selected.size > 0;
  const canDemolish = mode === 'build' && selected.size > 0;
  const hasConfirm = confirmMatchesView(demolishConfirm, view, selected, isPinned);

  return (
    <div style={panel}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
          borderBottom: '1px solid #444',
          paddingBottom: 2,
        }}
      >
        <span style={{ fontSize: 10, color: isPinned ? '#7fd4ff' : '#aaa' }}>
          {t(isPinned ? 'inspector.pinned' : 'inspector.preview')}
        </span>
        {isPinned && (
          <button
            type="button"
            title={t('inspector.unpin')}
            onClick={() => {
              router.dispatch({ kind: 'inspector.unpin' });
            }}
            style={{
              ...actionBtn,
              padding: '0 5px',
              lineHeight: '14px',
            }}
          >
            {'×'}
          </button>
        )}
      </div>
      <SubjectBody
        view={view}
        db={db}
        isPinned={isPinned}
        canActivate={canActivate}
        canDemolish={canDemolish}
        hasConfirm={hasConfirm}
        onActivate={() => {
          router.dispatch({ kind: 'selection.activate' });
        }}
        onDemolish={() => {
          router.dispatch({ kind: 'demolish.press' });
        }}
        onConfirmDemolish={() => {
          router.dispatch({ kind: 'demolish.confirm' });
        }}
      />
    </div>
  );
}
