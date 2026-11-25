// Minimap public entry (ADR 0062 step 4a): app supplies the sorted
// raster and mark contribution lists; the panel wires them into the
// shared Minimap component.
import type { ComponentType } from 'react';
import type { HudContext, HudPanelProps } from '../hud-panels';
import type { MinimapMarkDef, MinimapRasterDef } from './contributions';
import { Minimap } from './Minimap';

export function createMinimapPanel({
  rasters,
  marks,
  onMoveOrder,
}: {
  rasters: readonly MinimapRasterDef[];
  marks: readonly MinimapMarkDef[];
  // Supplied from features/squads via app assembly (ADR 0062); receives
  // the panel's HudContext so the closure can reach the SimClient.
  onMoveOrder?: (ctx: HudContext, x: number, y: number, guard: boolean) => void;
}): ComponentType<HudPanelProps> {
  return function MinimapPanel({ ctx }: HudPanelProps) {
    if (ctx.map === null) {
      return null;
    }
    return (
      <Minimap
        client={ctx.client}
        db={ctx.db}
        map={ctx.map}
        isHostile={ctx.isHostile}
        rasters={rasters}
        marks={marks}
        onMoveOrder={
          onMoveOrder === undefined
            ? undefined
            : (x, y, guard) => {
                onMoveOrder(ctx, x, y, guard);
              }
        }
      />
    );
  };
}

export {
  resolveDisposition,
  type MinimapMark,
  type MinimapMarkDef,
  type MinimapRasterDef,
} from './contributions';
