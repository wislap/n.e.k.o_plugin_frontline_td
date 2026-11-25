// Damaged-unit HP bars (ADR 0062 step 1): feature-owned wrapper over
// the shared render/hp-bars instanced sink. The collector was moved
// here from GameCanvas.
import type { SnapshotPair } from '../../../client/sim-client';
import { readChannel } from '../../../core/index';
import { HpBars, type HpBarSink } from '../../../render/hp-bars';
import type { SceneLayerProps } from '../../../render/scene';
import { DenseUnitsChannel } from '../protocol';

const UNIT_BAR_TOP = 0.8;

// Damaged-unit bars from the dense units channel.
function unitHpItems(pair: SnapshotPair, _alpha: number, sink: HpBarSink): void {
  const units = readChannel(pair.latest, DenseUnitsChannel) ?? undefined;
  if (units === undefined) {
    return;
  }
  for (let i = 0; i < units.handles.length; i++) {
    const bp = units.hpBp[i] ?? 10000;
    if (bp >= 10000) {
      continue;
    }
    sink.push(units.x[i] ?? 0, units.y[i] ?? 0, UNIT_BAR_TOP, 0.9, bp);
  }
}

export function UnitHpBars({ ctx }: SceneLayerProps) {
  return (
    <HpBars
      client={ctx.client}
      heights={ctx.heights}
      mapWidth={ctx.map.grid.width}
      mapHeight={ctx.map.grid.height}
      collect={unitHpItems}
    />
  );
}
