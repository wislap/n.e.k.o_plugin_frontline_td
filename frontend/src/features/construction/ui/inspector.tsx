// Construction inspector subjects (ADR 0062 step 3): own_structure,
// hostile_structure, salvage and road_segment. Resolver cases and views
// moved verbatim from client/inspect-subject.ts and the shell inspector.
import { useTranslation } from 'react-i18next';
import { localName, type ResolvedStructure } from '../../../content/index';
import { readChannel, type Inspection } from '../../../core/index';
import type { CombatInspection } from '../../combat/protocol';
import { COMBAT_INSPECTOR_ID } from '../../combat/protocol';
import { CombatSection } from '../../combat/ui/index';
import type { LogisticsInspection } from '../../logistics/protocol';
import { LOGISTICS_INSPECTOR_ID } from '../../logistics/protocol';
import { LogisticsSection } from '../../logistics/ui/index';
import type { ProductionInspection } from '../../production/protocol';
import { PRODUCTION_INSPECTOR_ID } from '../../production/protocol';
import { ProductionSection } from '../../production/ui/index';
import { cx, MeterBar } from '../../../ui/kit/index';
import {
  defineInspectorSubject,
  indexOfHandle,
  InspectorActions,
  inspectorStyles,
  type InspectorSubjectDef,
  type InspectorViewContext,
  ModifiersSection,
} from '../../../ui/inspector/index';
import {
  CONSTRUCTION_INSPECTOR_ID,
  RoadWorksChannel,
  SalvageChannel,
  StructuresChannel,
  structureStateName,
  type ConstructionInspection,
  type ConstructionStateName,
} from '../protocol';

const styles = inspectorStyles;

export interface OwnStructureView {
  kind: 'own_structure';
  handle: number;
  contentId: string;
  faction: number;
  x: number;
  y: number;
  stateName: ConstructionStateName;
  progressBp: number;
  hpBp: number;
  structure: ResolvedStructure | null;
  construction: ConstructionInspection | null;
  combat: CombatInspection | null;
  logistics: LogisticsInspection | null;
  production: ProductionInspection | null;
  modifiers: Inspection['modifiers'];
  hasInspection: boolean;
}

export interface HostileStructureView {
  kind: 'hostile_structure';
  handle: number;
  contentId: string;
  faction: number;
  x: number;
  y: number;
  stateName: ConstructionStateName;
  progressBp: number;
  hpBp: number;
  structure: ResolvedStructure | null;
}

export interface SalvageView {
  kind: 'salvage';
  handle: number;
  x: number;
  y: number;
  construction: ConstructionInspection | null;
  logistics: LogisticsInspection | null;
  hasInspection: boolean;
}

export interface RoadSegmentView {
  kind: 'road_segment';
  handle: number;
  x: number;
  y: number;
  progressBp: number;
  hpBp: number;
  construction: ConstructionInspection | null;
  logistics: LogisticsInspection | null;
  combat: CombatInspection | null;
  hasInspection: boolean;
}

function OwnStructureSubjectView({
  view,
  ctx,
}: {
  view: OwnStructureView;
  ctx: InspectorViewContext;
}) {
  const { t } = useTranslation();
  const { db, actions } = ctx;
  const c = view.construction;
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
      <ProductionSection production={view.production} db={db} />
      <LogisticsSection logistics={view.logistics} />
      <ModifiersSection modifiers={view.modifiers} />
      <InspectorActions actions={actions} showActivate={showActivate} showDemolish={showDemolish} />
    </>
  );
}

const ownStructure = defineInspectorSubject({
  kind: 'own_structure',
  inspects: true,
  hostile: false,
  resolve({ db, snapshot, subject, inspection }): OwnStructureView | null {
    const structures = readChannel(snapshot, StructuresChannel) ?? undefined;
    if (structures === undefined) {
      return null;
    }
    const i = indexOfHandle(structures.handles, subject.handle);
    if (i === -1) {
      return null;
    }
    const structure = db.structures.byIndex(structures.kind[i] ?? 0) ?? null;
    const contentId = structure?.id ?? 'unknown';
    const faction = structures.faction[i] ?? 0;
    const x = structures.x[i] ?? 0;
    const y = structures.y[i] ?? 0;
    const stateName = structureStateName(structures.state[i] ?? 0);
    const progressBp = structures.progressBp[i] ?? 0;
    const hpBp = structures.hpBp[i] ?? 0;

    const matched = inspection;
    return {
      kind: 'own_structure',
      handle: subject.handle,
      contentId,
      faction,
      x,
      y,
      stateName,
      progressBp,
      hpBp,
      structure,
      construction:
        (matched?.sections[CONSTRUCTION_INSPECTOR_ID] as ConstructionInspection | undefined) ??
        null,
      combat: (matched?.sections[COMBAT_INSPECTOR_ID] as CombatInspection | undefined) ?? null,
      logistics:
        (matched?.sections[LOGISTICS_INSPECTOR_ID] as LogisticsInspection | undefined) ?? null,
      production:
        (matched?.sections[PRODUCTION_INSPECTOR_ID] as ProductionInspection | undefined) ?? null,
      modifiers: matched?.modifiers ?? [],
      hasInspection: matched !== null,
    };
  },
  title(view, t) {
    const name = localName(view.contentId);
    return t(`structure.${name}`, { defaultValue: name });
  },
  matchesDemolishConfirm(view, targets) {
    return targets.includes(view.handle);
  },
  View: OwnStructureSubjectView,
});

const hostileStructure = defineInspectorSubject({
  kind: 'hostile_structure',
  inspects: false,
  hostile: true,
  resolve({ db, snapshot, subject }): HostileStructureView | null {
    const structures = readChannel(snapshot, StructuresChannel) ?? undefined;
    if (structures === undefined) {
      return null;
    }
    const i = indexOfHandle(structures.handles, subject.handle);
    if (i === -1) {
      return null;
    }
    const structure = db.structures.byIndex(structures.kind[i] ?? 0) ?? null;
    const contentId = structure?.id ?? 'unknown';
    const faction = structures.faction[i] ?? 0;
    const x = structures.x[i] ?? 0;
    const y = structures.y[i] ?? 0;
    const stateName = structureStateName(structures.state[i] ?? 0);
    const progressBp = structures.progressBp[i] ?? 0;
    const hpBp = structures.hpBp[i] ?? 0;

    return {
      kind: 'hostile_structure',
      handle: subject.handle,
      contentId,
      faction,
      x,
      y,
      stateName,
      progressBp,
      hpBp,
      structure,
    };
  },
  title(view, t) {
    const name = localName(view.contentId);
    return t(`structure.${name}`, { defaultValue: name });
  },
  View({ view }) {
    const { t } = useTranslation();
    const maxHp = view.structure?.hp ?? 0;
    return (
      <>
        <div className={styles['metaRow']}>
          <span className={cx(styles['tag'], styles['tagDanger'])}>
            {t(`state.${view.stateName}`, { defaultValue: view.stateName })}
          </span>
          <span className={styles['kvValue']}>
            {t('inspector.coords', { x: view.x, y: view.y })}
          </span>
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
  },
});

const salvage = defineInspectorSubject({
  kind: 'salvage',
  inspects: true,
  hostile: false,
  resolve({ snapshot, subject, inspection }): SalvageView | null {
    const salvageChannel = readChannel(snapshot, SalvageChannel) ?? undefined;
    if (salvageChannel === undefined) {
      return null;
    }
    const i = indexOfHandle(salvageChannel.handles, subject.handle);
    if (i === -1) {
      return null;
    }
    const matched = inspection;
    return {
      kind: 'salvage',
      handle: subject.handle,
      x: salvageChannel.x[i] ?? 0,
      y: salvageChannel.y[i] ?? 0,
      construction:
        (matched?.sections[CONSTRUCTION_INSPECTOR_ID] as ConstructionInspection | undefined) ??
        null,
      logistics:
        (matched?.sections[LOGISTICS_INSPECTOR_ID] as LogisticsInspection | undefined) ?? null,
      hasInspection: matched !== null,
    };
  },
  title(_view, t) {
    return t('inspector.salvage');
  },
  View({ view }) {
    const { t } = useTranslation();
    return (
      <>
        <div className={styles['kvValue']}>{t('inspector.coords', { x: view.x, y: view.y })}</div>
        <LogisticsSection logistics={view.logistics} />
      </>
    );
  },
});

const roadSegment = defineInspectorSubject({
  kind: 'road_segment',
  inspects: true,
  hostile: false,
  resolve({ snapshot, subject, inspection }): RoadSegmentView | null {
    const roadWorks = readChannel(snapshot, RoadWorksChannel) ?? undefined;
    if (roadWorks === undefined) {
      return null;
    }
    const segs = roadWorks.segments;
    const i = indexOfHandle(segs.handles, subject.handle);
    if (i === -1) {
      return null;
    }
    const matched = inspection;
    return {
      kind: 'road_segment',
      handle: subject.handle,
      x: segs.x[i] ?? 0,
      y: segs.y[i] ?? 0,
      progressBp: segs.progressBp[i] ?? 0,
      hpBp: segs.hpBp[i] ?? 0,
      construction:
        (matched?.sections[CONSTRUCTION_INSPECTOR_ID] as ConstructionInspection | undefined) ??
        null,
      logistics:
        (matched?.sections[LOGISTICS_INSPECTOR_ID] as LogisticsInspection | undefined) ?? null,
      combat: (matched?.sections[COMBAT_INSPECTOR_ID] as CombatInspection | undefined) ?? null,
      hasInspection: matched !== null,
    };
  },
  title(_view, t) {
    return t('inspector.road_segment');
  },
  matchesDemolishConfirm(view, targets) {
    return targets.includes(view.handle);
  },
  View({ view, ctx }) {
    const { t } = useTranslation();
    const actions = ctx.actions;
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
  },
});

export const constructionInspectorSubjects: readonly InspectorSubjectDef[] = [
  ownStructure,
  hostileStructure,
  salvage,
  roadSegment,
];
