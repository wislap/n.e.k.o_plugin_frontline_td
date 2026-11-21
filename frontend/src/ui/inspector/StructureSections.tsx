import { useTranslation } from 'react-i18next';
import type { ResolvedSubjectView } from '../../client/inspect-subject';
import { localName, type ContentDb } from '../../content/index';
import type { Inspection } from '../../core/index';
import type { CombatInspection } from '../../features/combat/protocol';
import type { LogisticsInspection } from '../../features/logistics/protocol';
import { ActionButton, cx, MeterBar } from '../kit/index';
import styles from './InspectorPanel.module.css';

export interface InspectorActionContext {
  isPinned: boolean;
  canActivate: boolean;
  canDemolish: boolean;
  hasConfirm: boolean;
  onActivate: () => void;
  onDemolish: () => void;
  onConfirmDemolish: () => void;
}

export function InspectorActions({
  actions,
  showActivate,
  showDemolish,
}: {
  actions: InspectorActionContext;
  showActivate: boolean;
  showDemolish: boolean;
}) {
  const { t } = useTranslation();
  if (!actions.isPinned || (!showActivate && !showDemolish && !actions.hasConfirm)) {
    return null;
  }
  return (
    <div className={styles['actionsRow']}>
      {showActivate && (
        <ActionButton size="sm" variant="primary" kbd="G" onClick={actions.onActivate}>
          {t('inspector.activate_action')}
        </ActionButton>
      )}
      {actions.hasConfirm ? (
        <ActionButton size="sm" variant="danger" kbd="C" onClick={actions.onConfirmDemolish}>
          {t('inspector.confirm_demolish_btn')}
        </ActionButton>
      ) : (
        showDemolish && (
          <ActionButton size="sm" variant="default" kbd="C" onClick={actions.onDemolish}>
            {t('inspector.demolish_action')}
          </ActionButton>
        )
      )}
    </div>
  );
}

export function CombatSection({ combat }: { combat: CombatInspection | null }) {
  const { t } = useTranslation();
  if (combat === null) return null;
  return (
    <div className={styles['section']}>
      {combat.max > 0 && (
        <MeterBar
          bp={(combat.hp / Math.max(1, combat.max)) * 10000}
          label={t('inspector.hp_label')}
          valueText={`${Math.ceil(combat.hp / 1000)}/${Math.ceil(combat.max / 1000)}`}
        />
      )}
      {combat.readyIn !== undefined && (
        <div className={styles['metaRow']}>
          <span className={styles['kvLabel']}>
            {combat.readyIn === 0
              ? t('panel.weapon_ready')
              : t('panel.weapon_reloading', { ticks: combat.readyIn })}
          </span>
          {combat.costCargo !== undefined && combat.costCargo >= 0 && (
            <span className={styles['kvValue']}>
              {t('panel.ammo', { count: Math.floor((combat.costStock ?? 0) / 1000) })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function LogisticsSection({ logistics }: { logistics: LogisticsInspection | null }) {
  const { t } = useTranslation();
  if (logistics === null) return null;
  return (
    <div className={styles['section']}>
      {logistics.node !== null && (
        <div className={styles['metaRow']}>
          <span className={styles['accentText']}>
            {t('inspector.node_summary', {
              connect: Math.round(logistics.node.connect / 10),
              service: logistics.node.service,
              vehicles: logistics.node.vehicles,
            })}
          </span>
          {logistics.node.warehouse && (
            <span className={cx(styles['tag'], styles['tagAccent'])}>
              {t('inspector.warehouse_tag')}
            </span>
          )}
        </div>
      )}
      {logistics.slots.map((slot, i) => {
        const name = localName(String(slot.cargo));
        return (
          <div key={i} className={styles['slotBlock']}>
            <MeterBar
              bp={(slot.amount / Math.max(1, slot.capacity)) * 10000}
              tone="mode"
              label={t(`cargo.${name}`, { defaultValue: name })}
              valueText={`${Math.floor(slot.amount / 1000)}/${Math.floor(slot.capacity / 1000)}`}
            />
            <div className={styles['tagRow']}>
              <span className={styles['tag']}>
                {t(`class.${slot.class}`, { defaultValue: slot.class })}
              </span>
              {slot.export && <span className={styles['tag']}>{t('panel.export')}</span>}
              {slot.unmet !== 'none' && (
                <span className={cx(styles['tag'], styles['tagWarn'])}>
                  {t(`reason.${slot.unmet}`, { defaultValue: slot.unmet })}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ModifiersSection({ modifiers }: { modifiers: Inspection['modifiers'] }) {
  const { t } = useTranslation();
  if (modifiers.length === 0) return null;
  return (
    <div className={styles['section']}>
      <div className={styles['tagRow']}>
        {modifiers.map((m, i) => {
          const source = m.source.split('.').pop() ?? m.source;
          const val = m.op === 'mul_bp' ? `×${m.value / 10000}` : `+${m.value}`;
          return (
            <span key={i} className={cx(styles['tag'], styles['tagWarn'])}>
              {`${t(`mod.${source}`, { defaultValue: source })} ${val}`}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function OwnStructureView({
  view,
  db,
  actions,
}: {
  view: Extract<ResolvedSubjectView, { kind: 'own_structure' }>;
  db: ContentDb;
  actions: InspectorActionContext;
}) {
  const { t } = useTranslation();
  const c = view.construction;
  const p = view.production;
  const showActivate = view.stateName === 'blueprint' || view.stateName === 'waiting';
  const showDemolish =
    actions.canDemolish &&
    (view.stateName === 'blueprint' ||
      view.stateName === 'waiting' ||
      view.stateName === 'site' ||
      view.stateName === 'operational');

  return (
    <>
      <div className={styles['metaRow']}>
        <span className={cx(styles['tag'], styles['tagAccent'])}>
          {t(`state.${view.stateName}`, { defaultValue: view.stateName })}
        </span>
        <span className={styles['kvValue']}>{t('inspector.coords', { x: view.x, y: view.y })}</span>
      </div>
      {c !== null ? (
        <div className={styles['section']}>
          {c.total > 0 && (
            <MeterBar
              bp={c.progressBp}
              tone="mode"
              label={t('inspector.progress_label')}
              valueText={`${Math.round(c.progressBp / 100)}%`}
            />
          )}
          {c.waiting !== undefined && c.waiting !== null && c.waiting !== '' && (
            <div className={styles['warnText']}>
              {t(`reason.${c.waiting}`, { defaultValue: c.waiting })}
            </div>
          )}
          {c.slots?.map((slot, i) => {
            const cargoName = localName(db.cargos.byIndex(slot.cargo)?.id ?? '?');
            return (
              <div key={i} className={styles['kvRow']}>
                <span className={styles['kvLabel']}>
                  {t(`cargo.${cargoName}`, { defaultValue: cargoName })}
                </span>
                <span
                  className={styles['kvValue']}
                >{`${Math.floor(slot.delivered / 1000)}/${Math.floor(slot.required / 1000)}`}</span>
              </div>
            );
          })}
        </div>
      ) : (
        (view.stateName === 'site' || view.stateName === 'demolishing') && (
          <MeterBar
            bp={view.progressBp}
            tone={view.stateName === 'demolishing' ? 'warn' : 'mode'}
            label={t('inspector.progress_label')}
            valueText={`${Math.round(view.progressBp / 100)}%`}
          />
        )
      )}
      {view.combat !== null ? (
        <CombatSection combat={view.combat} />
      ) : (
        view.structure?.hp !== undefined && (
          <MeterBar
            bp={view.hpBp}
            label={t('inspector.hp_label')}
            valueText={`${Math.ceil((view.hpBp * view.structure.hp) / 10000)}/${view.structure.hp}`}
          />
        )
      )}
      {p !== null && (
        <div className={styles['section']}>
          <div className={styles['kvRow']}>
            <span className={styles['kvLabel']}>{t('panel.production')}</span>
            <span
              className={styles['kvValue']}
            >{`${t(`prod.${p.state}`, { defaultValue: p.state })}${p.total > 0 ? ` (${p.progress}/${p.total})` : ''}`}</span>
          </div>
          {p.nextUnit !== undefined && p.nextUnit !== '' && (
            <div className={styles['accentText']}>
              {t('panel.next_unit', {
                name: t(`unit.${localName(p.nextUnit)}`, { defaultValue: localName(p.nextUnit) }),
              })}
            </div>
          )}
          {p.missing.length > 0 && (
            <div className={styles['warnText']}>
              {p.missing
                .map((idx) =>
                  t(`cargo.${localName(db.cargos.byIndex(idx)?.id ?? String(idx))}`, {
                    defaultValue: localName(db.cargos.byIndex(idx)?.id ?? String(idx)),
                  }),
                )
                .join(', ')}
            </div>
          )}
        </div>
      )}
      <LogisticsSection logistics={view.logistics} />
      <ModifiersSection modifiers={view.modifiers} />
      <InspectorActions actions={actions} showActivate={showActivate} showDemolish={showDemolish} />
    </>
  );
}

export function HostileStructureView({
  view,
}: {
  view: Extract<ResolvedSubjectView, { kind: 'hostile_structure' }>;
}) {
  const { t } = useTranslation();
  const maxHp = view.structure?.hp ?? 0;
  return (
    <>
      <div className={styles['metaRow']}>
        <span className={cx(styles['tag'], styles['tagDanger'])}>
          {t(`state.${view.stateName}`, { defaultValue: view.stateName })}
        </span>
        <span className={styles['kvValue']}>{t('inspector.coords', { x: view.x, y: view.y })}</span>
      </div>
      {view.stateName === 'site' && (
        <MeterBar
          bp={view.progressBp}
          tone="warn"
          label={t('inspector.progress_label')}
          valueText={`${Math.round(view.progressBp / 100)}%`}
        />
      )}
      {maxHp > 0 && (
        <MeterBar
          bp={view.hpBp}
          tone="danger"
          label={t('inspector.hp_label')}
          valueText={`${Math.ceil((view.hpBp * maxHp) / 10000)}/${maxHp}`}
        />
      )}
    </>
  );
}
