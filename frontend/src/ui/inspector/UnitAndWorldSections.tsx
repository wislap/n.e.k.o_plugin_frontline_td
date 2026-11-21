import { useTranslation } from 'react-i18next';
import type { ResolvedSubjectView } from '../../client/inspect-subject';
import { localName } from '../../content/index';
import { cx, MeterBar } from '../kit/index';
import styles from './InspectorPanel.module.css';
import {
  CombatSection,
  InspectorActions,
  LogisticsSection,
  ModifiersSection,
  type InspectorActionContext,
} from './StructureSections';

function hpValueText(hpBp: number, maxHp: number): string {
  return maxHp > 0 ? `${Math.ceil((hpBp * maxHp) / 10000)}/${maxHp}` : `${Math.round(hpBp / 100)}%`;
}

export function MultiOwnView({
  view,
  actions,
}: {
  view: Extract<ResolvedSubjectView, { kind: 'multi_own' }>;
  actions: InspectorActionContext;
}) {
  const { t } = useTranslation();
  return (
    <>
      {view.breakdown.map((item) => {
        const name = localName(item.contentId);
        return (
          <div key={`${item.category}:${item.contentId}`} className={styles['kvRow']}>
            <span className={styles['kvLabel']}>
              {t(`${item.category}.${name}`, { defaultValue: name })}
            </span>
            <span className={styles['kvValue']}>{`×${item.count}`}</span>
          </div>
        );
      })}
      <InspectorActions
        actions={actions}
        showActivate={actions.canActivate}
        showDemolish={actions.canDemolish}
      />
      <div className={styles['mutedText']}>{t('panel.multi_hint')}</div>
    </>
  );
}

export function CellSubjectView({
  view,
}: {
  view: Extract<ResolvedSubjectView, { kind: 'cell' | 'cell_unexplored' }>;
}) {
  const { t } = useTranslation();
  if (view.kind === 'cell_unexplored') {
    return <div className={styles['mutedText']}>{t('inspector.unexplored')}</div>;
  }
  const surfaceName = view.surfaceId !== null ? localName(view.surfaceId) : null;
  const surfaceLabel =
    surfaceName !== null
      ? t(`surface.${surfaceName}`, { defaultValue: surfaceName })
      : t('inspector.unknown');
  return (
    <>
      <div className={styles['tagRow']}>
        {view.visionState === 1 && (
          <span className={styles['tag']}>{t('inspector.fog_memory')}</span>
        )}
        <span className={styles['tag']}>{t('inspector.height', { h: view.height })}</span>
        {view.isRamp && <span className={styles['tag']}>{t('inspector.ramp')}</span>}
        {view.roadLevel > 0 && (
          <span className={styles['tag']}>
            {t('inspector.road_level', { level: view.roadLevel })}
          </span>
        )}
      </div>
      <div className={styles['kvRow']}>
        <span className={styles['kvLabel']}>
          {t('inspector.surface_label', { name: surfaceLabel })}
        </span>
      </div>
      {view.depositId !== null && (
        <div className={styles['warnText']}>
          {t('inspector.deposit', {
            cargo: t(`cargo.${localName(view.depositId)}`, {
              defaultValue: localName(view.depositId),
            }),
          })}
        </div>
      )}
      <div className={view.covered ? styles['accentText'] : styles['mutedText']}>
        {t(view.covered ? 'inspector.covered' : 'inspector.uncovered')}
      </div>
      {view.excluded && <div className={styles['dangerText']}>{t('inspector.hostile_zone')}</div>}
    </>
  );
}

export function OwnUnitView({
  view,
}: {
  view: Extract<ResolvedSubjectView, { kind: 'own_unit' }>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className={styles['tagRow']}>
        <span className={cx(styles['tag'], styles['tagAccent'])}>
          {t(view.moving ? 'inspector.unit_moving' : 'inspector.unit_idle')}
        </span>
      </div>
      {view.combat !== null ? (
        <CombatSection combat={view.combat} />
      ) : (
        <MeterBar
          bp={view.hpBp}
          label={t('inspector.hp_label')}
          valueText={hpValueText(view.hpBp, view.unit?.hp ?? 0)}
        />
      )}
      {view.energyBp !== null && (
        <MeterBar
          bp={view.energyBp}
          tone="mode"
          label={t('inspector.energy_label')}
          valueText={`${Math.round(view.energyBp / 100)}%`}
        />
      )}
      <LogisticsSection logistics={view.logistics} />
      <ModifiersSection modifiers={view.modifiers} />
    </>
  );
}

export function HostileUnitView({
  view,
}: {
  view: Extract<ResolvedSubjectView, { kind: 'hostile_unit' }>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className={styles['tagRow']}>
        <span className={cx(styles['tag'], styles['tagDanger'])}>
          {t(view.moving ? 'inspector.unit_moving' : 'inspector.unit_idle')}
        </span>
      </div>
      <MeterBar
        bp={view.hpBp}
        tone="danger"
        label={t('inspector.hp_label')}
        valueText={hpValueText(view.hpBp, view.unit?.hp ?? 0)}
      />
      {view.energyBp !== null && (
        <MeterBar
          bp={view.energyBp}
          tone="warn"
          label={t('inspector.energy_label')}
          valueText={`${Math.round(view.energyBp / 100)}%`}
        />
      )}
    </>
  );
}

export function WorldObjectView({
  view,
  actions,
}: {
  view: Extract<ResolvedSubjectView, { kind: 'ruin' | 'salvage' | 'road_segment' | 'memory' }>;
  actions: InspectorActionContext;
}) {
  const { t } = useTranslation();
  switch (view.kind) {
    case 'ruin':
      return (
        <>
          <div className={styles['kvValue']}>{t('inspector.coords', { x: view.x, y: view.y })}</div>
          <MeterBar
            bp={view.progressBp}
            tone="mode"
            label={t('inspector.capture_label')}
            valueText={`${Math.round(view.progressBp / 100)}%`}
          />
          {view.contested && (
            <div className={styles['tagRow']}>
              <span className={cx(styles['tag'], styles['tagWarn'])}>{t('capture.contested')}</span>
            </div>
          )}
        </>
      );
    case 'salvage':
      return (
        <>
          <div className={styles['kvValue']}>{t('inspector.coords', { x: view.x, y: view.y })}</div>
          <LogisticsSection logistics={view.logistics} />
        </>
      );
    case 'road_segment':
      return (
        <>
          <div className={styles['kvValue']}>
            {t('inspector.coords', { x: Math.round(view.x), y: Math.round(view.y) })}
          </div>
          <MeterBar
            bp={view.progressBp}
            tone="mode"
            label={t('inspector.progress_label')}
            valueText={`${Math.round(view.progressBp / 100)}%`}
          />
          <CombatSection combat={view.combat} />
          <LogisticsSection logistics={view.logistics} />
          <InspectorActions
            actions={actions}
            showActivate={false}
            showDemolish={actions.canDemolish}
          />
        </>
      );
    case 'memory':
      return (
        <div className={styles['metaRow']}>
          <span className={styles['tag']}>{t('inspector.fog_memory')}</span>
          <span className={styles['kvValue']}>
            {`${t(`state.${view.stateName}`, { defaultValue: view.stateName })} (${view.x}, ${view.y})`}
          </span>
        </div>
      );
  }
}
