// Damaged-structure HP bars (ADR 0062 step 1): feature-owned wrapper
// over the shared render/hp-bars instanced sink. The collector was moved
// here from GameCanvas.
import { useMemo } from 'react';
import { readChannel } from '../../../core/index';
import type { ContentDb } from '../../../content/index';
import { HpBars, type HpBarCollector, type HpBarSink } from '../../../render/hp-bars';
import type { SceneLayerProps } from '../../../render/scene';
import { StructuresChannel } from '../protocol';
import { structureKindHeight } from './structure-gpu';

// Damaged-structure bars from the structures channel.
function makeStructureHpItems(db: ContentDb): HpBarCollector {
  return (pair, _alpha, sink: HpBarSink): void => {
    const channel = readChannel(pair.latest, StructuresChannel) ?? undefined;
    if (channel === undefined) {
      return;
    }
    for (let i = 0; i < channel.handles.length; i++) {
      const bp = channel.hpBp[i] ?? 10000;
      if (bp >= 10000) {
        continue;
      }
      const kind = db.structures.byIndex(channel.kind[i] ?? 0);
      if (kind === undefined) {
        continue;
      }
      sink.push(
        (channel.x[i] ?? 0) + kind.footprint.w / 2,
        (channel.y[i] ?? 0) + kind.footprint.h / 2,
        structureKindHeight(db, channel.kind[i] ?? 0),
        Math.max(kind.footprint.w, kind.footprint.h),
        bp,
      );
    }
  };
}

export function StructureHpBars({ ctx }: SceneLayerProps) {
  const collect = useMemo(() => makeStructureHpItems(ctx.db), [ctx.db]);
  return (
    <HpBars
      client={ctx.client}
      heights={ctx.heights}
      mapWidth={ctx.map.grid.width}
      mapHeight={ctx.map.grid.height}
      collect={collect}
    />
  );
}
