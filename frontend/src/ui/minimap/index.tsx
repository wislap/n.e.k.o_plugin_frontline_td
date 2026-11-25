// Minimap public entry (ADR 0062 step 4a): app supplies the sorted
// raster and mark contribution lists; the panel wires them into the
// shared Minimap component.
import type { ComponentType } from 'react';
import type { HudPanelProps } from '../hud-panels';
import type { MinimapMarkDef, MinimapRasterDef } from './contributions';
import { Minimap } from './Minimap';

export function createMinimapPanel({
  rasters,
  marks,
}: {
  rasters: readonly MinimapRasterDef[];
  marks: readonly MinimapMarkDef[];
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
