// Road tool panel (M3 E3): while road mode has a selection, shows the
// cells to pave, material cost, build time, per-direction quota old ->
// estimated new, and the links' carried volume (the snapshot has no
// queued-volume field, so carried volume is shown and labelled). A
// small cursor tooltip shows the hovered link's interception reduction.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBuildStore } from '../../../client/build-store';
import { cursorScreen } from '../../../client/cursor';
import type { SimClient } from '../../../client/sim-client';
import { localName, type ContentDb } from '../../../content/index';
import { TICKS_PER_SECOND } from '../../../core/index';
import { lowestBuildableRoadLevel } from '../content';
import { LogisticsNetworkChannel, ROAD_LAYER_ID, type LogisticsNetwork } from '../protocol';
import { roadPreview, type RoadPreviewLink } from './road-preview';
import { linkIndices } from './road-select';

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

interface HoverTip {
  intercept: number;
  x: number;
  y: number;
}

interface PreviewRow extends ReturnType<typeof roadPreview> {
  material: number;
  seconds: number;
  cargoName: string;
}

export function RoadPanel({ client, db }: { client: SimClient; db: ContentDb }) {
  const { t } = useTranslation();
  const roadMode = useBuildStore((s) => s.roadMode);
  const selected = useBuildStore((s) => s.roadSel);
  const hovered = useBuildStore((s) => s.roadHover);
  const [preview, setPreview] = useState<PreviewRow | null>(null);
  const [tip, setTip] = useState<HoverTip | null>(null);

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
  const levelMult = db.logistics.roadLevels.map((l) => l.multiplierBp);

  useEffect(() => {
    if (!roadMode) {
      return;
    }
    const id = setInterval(() => {
      const latest = client.snapshots().latest;
      const network = latest?.channels[LogisticsNetworkChannel.id] as LogisticsNetwork | undefined;
      const road = latest?.layers[ROAD_LAYER_ID];
      if (latest === null || network === undefined || road === undefined) {
        setPreview(null);
        setTip(null);
        return;
      }
      if (hovered >= 0 && hovered < network.links.a.length) {
        setTip({
          intercept: network.links.intercept[hovered] ?? 0,
          x: cursorScreen.x,
          y: cursorScreen.y,
        });
      } else {
        setTip(null);
      }
      if (selected.length === 0) {
        setPreview(null);
        return;
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
      // roadSel stores handle pairs; resolve to current link indices.
      const selectedLinks = new Set(linkIndices(network, selected));
      const p = roadPreview(links, selectedLinks, (cell) => road[cell] ?? 0, levelIndex, levelMult);
      const cargoId = cargo.id;
      setPreview({
        ...p,
        material: Math.ceil((p.cellsToPave * materialPerCell) / 1000),
        seconds: (p.cellsToPave * ticksPerCell) / TICKS_PER_SECOND,
        cargoName: localName(cargoId),
      });
    }, 200);
    return () => {
      clearInterval(id);
    };
  }, [
    client,
    db,
    roadMode,
    selected,
    hovered,
    levelIndex,
    levelMult,
    materialPerCell,
    ticksPerCell,
    cargo.id,
  ]);

  if (!roadMode) {
    return null;
  }
  return (
    <>
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
