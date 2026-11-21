// Road tool panel (ADR 0048): renders the [Road R] button bar in
// logistics mode (F3), plus the road-upgrade preview and hovered link
// interception tooltip when the road tool is active. Uses
// useSnapshotValue rather than a private setInterval.
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cursorState } from '../../../client/cursor';
import { useInteractionStore } from '../../../client/interaction-store';
import { useIntentRouter } from '../../../client/intent';
import type { SimClient, SnapshotPair } from '../../../client/sim-client';
import { useSnapshotValue } from '../../../client/use-snapshot';
import { localName, type ContentDb } from '../../../content/index';
import { TICKS_PER_SECOND } from '../../../core/index';
import { lowestBuildableRoadLevel } from '../content';
import { LogisticsNetworkChannel, ROAD_LAYER_ID, type LogisticsNetwork } from '../protocol';
import { roadPreview, type RoadPreviewLink } from './road-preview';
import { linkIndices } from './road-select';

const bar = {
  position: 'fixed',
  bottom: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  gap: 6,
  padding: '6px 8px',
  background: 'rgba(0,0,0,0.55)',
  fontFamily: 'monospace',
  fontSize: 12,
  zIndex: 900,
  borderRadius: 4,
} as const;

const panel = {
  position: 'fixed',
  right: 8,
  top: '30%',
  padding: '8px 10px',
  background: 'rgba(0,0,0,0.6)',
  color: '#fff',
  fontFamily: 'monospace',
  fontSize: 12,
  zIndex: 900,
  pointerEvents: 'none',
  borderRadius: 4,
  whiteSpace: 'pre',
} as const;

interface RoadSnapshotSlice {
  tick: number;
  network: LogisticsNetwork | null;
  road: Uint8Array | null;
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

export function RoadPanel({ client, db }: { client: SimClient; db: ContentDb }) {
  const { t } = useTranslation();
  const router = useIntentRouter();
  const mode = useInteractionStore((s) => s.mode);
  const tool = useInteractionStore((s) => s.tool);
  const selected = useInteractionStore((s) => s.roadSel);
  const hovered = useInteractionStore((s) => s.roadHover);
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
    const network =
      (latest?.channels[LogisticsNetworkChannel.id] as LogisticsNetwork | undefined) ?? null;
    const road = (latest?.layers[ROAD_LAYER_ID] as Uint8Array | undefined) ?? null;
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

  if (mode !== 'logistics' && !roadMode) {
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
      {mode === 'logistics' && (
        <div style={bar}>
          <button
            type="button"
            title={t('road.button_hint')}
            onClick={() => {
              router.dispatch({ kind: 'road.toggle' });
            }}
            style={{
              cursor: 'pointer',
              padding: '4px 8px',
              border: roadMode ? '1px solid #ffd166' : '1px solid #555',
              background: roadMode ? 'rgba(255,209,102,0.25)' : 'rgba(30,30,30,0.9)',
              color: '#fff',
            }}
          >
            {t('road.button')}
            <div style={{ fontSize: 10, color: '#bbb' }}>{'R'}</div>
          </button>
        </div>
      )}
      {preview !== null && (
        <div style={panel}>
          <div>{t('road.preview_title')}</div>
          <div>
            {t('road.cells', { n: preview.cellsToPave })} ·{' '}
            {t('road.cost', {
              n: preview.material,
              cargo: t(`cargo.${preview.cargoName}`, { defaultValue: preview.cargoName }),
            })}{' '}
            · {t('road.time', { s: preview.seconds.toFixed(1) })}
          </div>
          <div>
            {t('road.quota_out', {
              old: Math.floor(preview.quotaOut / 1000),
              next: Math.floor(preview.quotaOutNew / 1000),
            })}
          </div>
          <div>
            {t('road.quota_in', {
              old: Math.floor(preview.quotaIn / 1000),
              next: Math.floor(preview.quotaInNew / 1000),
            })}
          </div>
          <div style={{ color: '#bbb' }}>
            {t('road.carried', {
              out: Math.floor(preview.volOut / 1000),
              inn: Math.floor(preview.volIn / 1000),
            })}
          </div>
          <div style={{ color: '#999' }}>{t('road.hint')}</div>
        </div>
      )}
      {tip !== null && tip.intercept > 0 && (
        <div
          style={{
            ...panel,
            top: tip.y + 16,
            left: tip.x + 12,
            right: 'auto',
            padding: '3px 6px',
          }}
        >
          {t('road.intercept', { pct: (tip.intercept / 100).toFixed(0) })}
        </div>
      )}
    </>
  );
}
