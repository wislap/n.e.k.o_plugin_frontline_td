// Road tool panel (ADR 0048, bottomCenter): shown only in logistics
// mode (F3). Provides the [R] Road Tool toggle, selected-route preview
// metrics + [Enter] Confirm inside a flow TacticalPanel, plus the
// cursor interception tooltip (position: fixed; pointer-events: none).
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cursorState } from '../../../client/cursor';
import { useIntentRouter } from '../../../client/intent';
import { useInteractionStore } from '../../../client/interaction-store';
import { useRoadToolStore } from './road-tool-store';
import type { SnapshotPair } from '../../../client/sim-client';
import type { HudPanelProps } from '../../../ui/hud-panels';
import { useSnapshotValue } from '../../../client/use-snapshot';
import { localName } from '../../../content/index';
import { TICKS_PER_SECOND, readChannel, readLayer } from '../../../core/index';
import type { SerializableTypedArray } from '../../../core/index';
import { ActionButton, TacticalPanel } from '../../../ui/kit/index';
import { lowestBuildableRoadLevel } from '../content';
import { LogisticsNetworkChannel, ROAD_LAYER_ID, type LogisticsNetwork } from '../protocol';
import styles from './RoadPanel.module.css';
import { roadPreview, type RoadPreviewLink } from './road-preview';
import { linkIndices } from './road-select';

const ENTER_KBD = 'Enter';

interface RoadSnapshotSlice {
  tick: number;
  network: LogisticsNetwork | null;
  road: SerializableTypedArray | null;
  sx: number;
  sy: number;
}

function sameRoadSlice(a: RoadSnapshotSlice, b: RoadSnapshotSlice): boolean {
  return (
    a.tick === b.tick &&
    a.network === b.network &&
    a.road === b.road &&
    a.sx === b.sx &&
    a.sy === b.sy
  );
}

export function RoadPanel({ ctx }: HudPanelProps) {
  const { client, db } = ctx;
  const { t } = useTranslation();
  const router = useIntentRouter();
  const mode = useInteractionStore((s) => s.mode);
  const tool = useInteractionStore((s) => s.tool);
  const selected = useRoadToolStore((s) => s.roadSel);
  const hovered = useRoadToolStore((s) => s.roadHover);
  const roadMode = tool.kind === 'road';

  const levelIndex = lowestBuildableRoadLevel(db.logistics.roadLevels);
  const level = db.logistics.roadLevels[levelIndex];
  const cost = level?.cost?.[0];
  if (cost === undefined || level?.ticksPerCell === undefined) {
    throw new Error('logistics: buildable road level lacks a cost or build time');
  }
  const materialPerCell = cost.milli;
  const ticksPerCell = level.ticksPerCell;
  const cargo = db.cargos.byIndex(cost.cargo);
  if (cargo === undefined) {
    throw new Error('logistics: road level cost references an unknown cargo');
  }
  const levelMult = useMemo(
    () => db.logistics.roadLevels.map((l) => l.multiplierBp),
    [db.logistics.roadLevels],
  );

  const selectRoadSlice = useCallback((pair: SnapshotPair): RoadSnapshotSlice => {
    const latest = pair.latest;
    const network = readChannel(latest, LogisticsNetworkChannel);
    const road = readLayer(latest, ROAD_LAYER_ID);
    const screen = cursorState.screen();
    return {
      tick: latest?.tick ?? -1,
      network,
      road,
      sx: screen.x,
      sy: screen.y,
    };
  }, []);

  const snap = useSnapshotValue(client, selectRoadSlice, sameRoadSlice, 200);

  if (mode !== 'logistics') {
    return null;
  }

  const network = snap.network;
  const road = snap.road;

  const tip =
    roadMode && network !== null && hovered >= 0 && hovered < network.links.a.length
      ? {
          intercept: network.links.intercept[hovered] ?? 0,
          x: snap.sx,
          y: snap.sy,
        }
      : null;

  const preview = (() => {
    if (!roadMode || network === null || road === null || selected.length === 0) {
      return null;
    }
    const links: RoadPreviewLink[] = [];
    for (let i = 0; i < network.links.a.length; i++) {
      const from = network.links.pathOffsets[i] ?? 0;
      const to = network.links.pathOffsets[i + 1] ?? from;
      links.push({
        m: network.links.m[i] ?? 10000,
        quotaOut: network.links.quotaOut[i] ?? 0,
        quotaIn: network.links.quotaIn[i] ?? 0,
        volOut: network.links.volOut[i] ?? 0,
        volIn: network.links.volIn[i] ?? 0,
        cells: Array.from(network.links.pathCells.slice(from, to)),
      });
    }
    const selectedLinks = new Set(linkIndices(network, selected));
    const p = roadPreview(links, selectedLinks, (cell) => road[cell] ?? 0, levelIndex, levelMult);
    return {
      ...p,
      material: Math.ceil((p.cellsToPave * materialPerCell) / 1000),
      seconds: (p.cellsToPave * ticksPerCell) / TICKS_PER_SECOND,
      cargoName: localName(cargo.id),
    };
  })();

  return (
    <>
      <TacticalPanel tone="mode" compact className={styles['panel']}>
        <div className={styles['toolbar']}>
          <div className={styles['toolbarLeft']}>
            <ActionButton
              size="sm"
              kbd="R"
              variant={roadMode ? 'active' : 'default'}
              aria-pressed={roadMode}
              title={t('road.button_hint')}
              onClick={() => {
                router.dispatch({ kind: 'road.toggle' });
              }}
            >
              {t('road.tool_btn')}
            </ActionButton>
            {preview !== null && (
              <span className={styles['titleTag']}>{t('road.preview_title')}</span>
            )}
          </div>
          <ActionButton
            size="sm"
            kbd={ENTER_KBD}
            variant="primary"
            disabled={selected.length === 0}
            onClick={() => {
              router.dispatch({ kind: 'road.confirm' });
            }}
          >
            {t('road.confirm_btn')}
          </ActionButton>
        </div>

        {preview !== null ? (
          <div className={styles['metrics']}>
            <div className={styles['summaryRow']}>
              <span className={styles['chip']}>{t('road.cells', { n: preview.cellsToPave })}</span>
              <span className={styles['chip']}>
                {t('road.cost', {
                  n: preview.material,
                  cargo: t(`cargo.${preview.cargoName}`, { defaultValue: preview.cargoName }),
                })}
              </span>
              <span className={styles['chip']}>
                {t('road.time', { s: preview.seconds.toFixed(1) })}
              </span>
            </div>
            <div className={styles['quotaGrid']}>
              <span>
                {t('road.quota_out', {
                  old: Math.floor(preview.quotaOut / 1000),
                  next: Math.floor(preview.quotaOutNew / 1000),
                })}
              </span>
              <span>
                {t('road.quota_in', {
                  old: Math.floor(preview.quotaIn / 1000),
                  next: Math.floor(preview.quotaInNew / 1000),
                })}
              </span>
            </div>
            <div className={styles['carried']}>
              {t('road.carried', {
                out: Math.floor(preview.volOut / 1000),
                inn: Math.floor(preview.volIn / 1000),
              })}
            </div>
            <div className={styles['hint']}>{t('road.hint')}</div>
          </div>
        ) : (
          roadMode && <div className={styles['hint']}>{t('road.hint')}</div>
        )}
      </TacticalPanel>

      {tip !== null && tip.intercept > 0 && (
        <div
          className={styles['tooltip']}
          style={{
            top: tip.y + 16,
            left: tip.x + 12,
          }}
        >
          {t('road.intercept', { pct: (tip.intercept / 100).toFixed(0) })}
        </div>
      )}
    </>
  );
}
