// Build menu (ADR 0048 / ADR 0049, bottomCenter): shown only in build
// primary mode (F2). Filters buildable structures by category and
// provides the [C] Demolish tool toggle inside a flow TacticalPanel.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIntentRouter } from '../../../client/intent';
import { useInteractionStore } from '../../../client/interaction-store';
import { VISUAL } from '../../../render/theme/index';
import { localName } from '../../../content/index';
import { TICKS_PER_SECOND } from '../../../core/index';
import type { HudPanelProps } from '../../../ui/hud-panels';
import { ActionButton, SegmentedTabs, TacticalPanel, cx } from '../../../ui/kit/index';
import { BUILD_CATEGORIES, type BuildCategory } from '../content';
import { renderStructureThumbnails } from '../render/thumbnails';
import styles from './BuildMenu.module.css';

type CategoryFilter = 'all' | BuildCategory;

function formatBuildSeconds(ticks: number): string {
  const sec = ticks / TICKS_PER_SECOND;
  return Number.isInteger(sec) ? String(sec) : sec.toFixed(1);
}

export function BuildMenu({ ctx }: HudPanelProps) {
  const { db } = ctx;
  const { t } = useTranslation();
  const router = useIntentRouter();
  const mode = useInteractionStore((s) => s.mode);
  const tool = useInteractionStore((s) => s.tool);
  const [category, setCategory] = useState<CategoryFilter>('all');
  const bevel = VISUAL.geometry.bevel;

  // Structure thumbnails render offscreen once per theme (silhouette
  // geometry changes with the bevel radius); the helper disposes its
  // renderer and geometries itself.
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string> | null>(null);
  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      const rendered = renderStructureThumbnails(db, bevel);
      if (alive) {
        setThumbs(rendered);
      }
    }, 0);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [db, bevel]);

  const categoryTabs = useMemo(
    (): { value: CategoryFilter; label: string }[] => [
      { value: 'all', label: t('build.category.all') },
      ...BUILD_CATEGORIES.map((c) => ({
        value: c,
        label: t(`build.category.${c}`),
      })),
    ],
    [t],
  );

  if (mode !== 'build') {
    return null;
  }

  const buildables = db.structures.list.filter(
    (s) => s.build !== undefined && (category === 'all' || s.build.category === category),
  );
  const demolishing = tool.kind === 'demolish';

  return (
    <TacticalPanel tone="mode" compact className={styles['panel']}>
      <div className={styles['toolbar']}>
        <SegmentedTabs<CategoryFilter>
          size="sm"
          items={categoryTabs}
          value={category}
          onChange={setCategory}
          ariaLabel={t('hud.mode.build')}
        />
        <ActionButton
          size="sm"
          kbd="C"
          variant={demolishing ? 'danger' : 'default'}
          aria-pressed={demolishing}
          title={t('build.demolish_hint')}
          onClick={() => {
            router.dispatch({ kind: 'demolish.press' });
          }}
        >
          {t('build.demolish_btn')}
        </ActionButton>
      </div>
      <div className={styles['grid']}>
        {buildables.map((kind) => {
          const name = localName(kind.id);
          const build = kind.build;
          if (build === undefined) {
            return null;
          }
          const cost = build.cost
            .map((c) => {
              const cargoId = db.cargos.byIndex(c.cargo)?.id ?? String(c.cargo);
              const cargoKey = localName(cargoId);
              return `${Math.floor(c.milli / 1000)} ${t(`cargo.${cargoKey}`, { defaultValue: cargoKey })}`;
            })
            .join(' · ');
          const selected = tool.kind === 'place' && tool.structureKindId === kind.id;
          return (
            <button
              key={kind.id}
              type="button"
              title={cost}
              aria-pressed={selected}
              onClick={() => {
                router.dispatch(
                  selected ? { kind: 'tool.exit' } : { kind: 'build.select', kindId: kind.id },
                );
              }}
              className={cx(styles['card'], selected && styles['cardActive'])}
            >
              {thumbs?.get(kind.id) !== undefined && (
                <img className={styles['thumb']} src={thumbs.get(kind.id)} alt="" />
              )}
              <div className={styles['cardHeader']}>
                <span className={styles['name']}>
                  {t(`structure.${name}`, { defaultValue: name })}
                </span>
                <span className={styles['footprint']}>
                  {t('build.footprint', { w: kind.footprint.w, h: kind.footprint.h })}
                </span>
              </div>
              <div className={styles['meta']}>
                <span className={styles['cost']}>{cost}</span>
                <span className={styles['time']}>
                  {t('build.time_sec', { s: formatBuildSeconds(build.timeTicks) })}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </TacticalPanel>
  );
}
