// Units inspector subjects (ADR 0062 step 3): own_unit, hostile_unit
// and the multi-selection breakdown. Resolver cases and views moved
// verbatim from client/inspect-subject.ts and the shell inspector.
import { useTranslation } from 'react-i18next';
import { localName, type ResolvedUnit } from '../../../content/index';
import { readChannel, type Inspection } from '../../../core/index';
import type { CombatInspection } from '../../combat/protocol';
import { COMBAT_INSPECTOR_ID } from '../../combat/protocol';
import { CombatSection } from '../../combat/ui/index';
import { StructuresChannel } from '../../construction/protocol';
import type { LogisticsInspection } from '../../logistics/protocol';
import { LOGISTICS_INSPECTOR_ID } from '../../logistics/protocol';
import { LogisticsSection } from '../../logistics/ui/index';
import { cx, MeterBar } from '../../../ui/kit/index';
import {
  defineInspectorSubject,
  hpValueText,
  indexOfHandle,
  InspectorActions,
  inspectorStyles,
  type InspectorSubjectDef,
  ModifiersSection,
} from '../../../ui/inspector/index';
import { DenseUnitsChannel } from '../protocol';

const styles = inspectorStyles;

interface MultiOwnBreakdownItem {
  category: 'unit' | 'structure';
  contentId: string;
  count: number;
}

export interface MultiOwnView {
  kind: 'multi_own';
  count: number;
  breakdown: MultiOwnBreakdownItem[];
}

export interface OwnUnitView {
  kind: 'own_unit';
  handle: number;
  contentId: string;
  faction: number;
  moving: boolean;
  hpBp: number;
  energyBp: number | null;
  unit: ResolvedUnit | null;
  combat: CombatInspection | null;
  logistics: LogisticsInspection | null;
  modifiers: Inspection['modifiers'];
  hasInspection: boolean;
}

export interface HostileUnitView {
  kind: 'hostile_unit';
  handle: number;
  contentId: string;
  faction: number;
  moving: boolean;
  hpBp: number;
  energyBp: number | null;
  unit: ResolvedUnit | null;
}

const multiOwn = defineInspectorSubject({
  kind: 'multi_own',
  inspects: false,
  hostile: false,
  resolve({ db, snapshot, subject, selected }): MultiOwnView | null {
    const units = readChannel(snapshot, DenseUnitsChannel) ?? undefined;
    const structures = readChannel(snapshot, StructuresChannel) ?? undefined;
    const unitCounts = new Map<string, number>();
    const structureCounts = new Map<string, number>();
    if (units !== undefined) {
      for (let i = 0; i < units.handles.length; i++) {
        if (selected.has(units.handles[i] ?? 0)) {
          const contentId = db.units.byIndex(units.kind[i] ?? 0)?.id ?? 'unknown';
          unitCounts.set(contentId, (unitCounts.get(contentId) ?? 0) + 1);
        }
      }
    }
    if (structures !== undefined) {
      for (let i = 0; i < structures.handles.length; i++) {
        if (selected.has(structures.handles[i] ?? 0)) {
          const contentId = db.structures.byIndex(structures.kind[i] ?? 0)?.id ?? 'unknown';
          structureCounts.set(contentId, (structureCounts.get(contentId) ?? 0) + 1);
        }
      }
    }
    const breakdown: MultiOwnBreakdownItem[] = [];
    for (const [contentId, count] of unitCounts) {
      breakdown.push({ category: 'unit', contentId, count });
    }
    for (const [contentId, count] of structureCounts) {
      breakdown.push({ category: 'structure', contentId, count });
    }
    breakdown.sort(
      (a, b) =>
        b.count - a.count ||
        a.category.localeCompare(b.category) ||
        a.contentId.localeCompare(b.contentId),
    );
    return {
      kind: 'multi_own',
      count: selected.size > 0 ? selected.size : subject.count,
      breakdown,
    };
  },
  title(view, t) {
    return t('panel.selected', { count: view.count });
  },
  matchesDemolishConfirm(_view, targets, selected) {
    return targets.length > 0 && targets.every((h) => selected.has(h));
  },
  View({ view, ctx }) {
    const { t } = useTranslation();
    const actions = ctx.actions;
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
  },
});

const ownUnit = defineInspectorSubject({
  kind: 'own_unit',
  inspects: true,
  hostile: false,
  resolve({ db, snapshot, subject, inspection }): OwnUnitView | null {
    const units = readChannel(snapshot, DenseUnitsChannel) ?? undefined;
    if (units === undefined) {
      return null;
    }
    const i = indexOfHandle(units.handles, subject.handle);
    if (i === -1) {
      return null;
    }
    const unit = db.units.byIndex(units.kind[i] ?? 0) ?? null;
    const contentId = unit?.id ?? 'unknown';
    const faction = units.faction[i] ?? 0;
    const moving = (units.moving[i] ?? 0) !== 0;
    const hpBp = units.hpBp[i] ?? 0;
    const rawEnergy = units.energyBp[i] ?? 0xffff;
    const energyBp = rawEnergy === 0xffff ? null : rawEnergy;

    const matched = inspection;
    return {
      kind: 'own_unit',
      handle: subject.handle,
      contentId,
      faction,
      moving,
      hpBp,
      energyBp,
      unit,
      combat: (matched?.sections[COMBAT_INSPECTOR_ID] as CombatInspection | undefined) ?? null,
      logistics:
        (matched?.sections[LOGISTICS_INSPECTOR_ID] as LogisticsInspection | undefined) ?? null,
      modifiers: matched?.modifiers ?? [],
      hasInspection: matched !== null,
    };
  },
  title(view, t) {
    const name = localName(view.contentId);
    return t(`unit.${name}`, { defaultValue: name });
  },
  View({ view }) {
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
  },
});

const hostileUnit = defineInspectorSubject({
  kind: 'hostile_unit',
  inspects: false,
  hostile: true,
  resolve({ db, snapshot, subject }): HostileUnitView | null {
    const units = readChannel(snapshot, DenseUnitsChannel) ?? undefined;
    if (units === undefined) {
      return null;
    }
    const i = indexOfHandle(units.handles, subject.handle);
    if (i === -1) {
      return null;
    }
    const unit = db.units.byIndex(units.kind[i] ?? 0) ?? null;
    const contentId = unit?.id ?? 'unknown';
    const faction = units.faction[i] ?? 0;
    const moving = (units.moving[i] ?? 0) !== 0;
    const hpBp = units.hpBp[i] ?? 0;
    const rawEnergy = units.energyBp[i] ?? 0xffff;
    const energyBp = rawEnergy === 0xffff ? null : rawEnergy;

    return {
      kind: 'hostile_unit',
      handle: subject.handle,
      contentId,
      faction,
      moving,
      hpBp,
      energyBp,
      unit,
    };
  },
  title(view, t) {
    const name = localName(view.contentId);
    return t(`unit.${name}`, { defaultValue: name });
  },
  View({ view }) {
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
  },
});

export const unitsInspectorSubjects: readonly InspectorSubjectDef[] = [
  multiOwn,
  ownUnit,
  hostileUnit,
];
