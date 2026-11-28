// Construction minimap contribution (ADR 0062 step 4a): structure
// rects — blueprint outline, faction fill, own-core outline. Moved
// verbatim from collectMinimapEntities and paint-minimap.ts.
import { readChannel } from '../../../core/index';
import {
  resolveDisposition,
  type MinimapMark,
  type MinimapMarkDef,
} from '../../../ui/minimap/index';
import { MINIMAP_PALETTE } from '../../../ui/minimap/palette';
import { STATE_BLUEPRINT, STATE_RUIN, StructuresChannel } from '../protocol';

function structureColor(disposition: 'own' | 'hostile' | 'ally' | 'ruin', isCore: boolean): string {
  switch (disposition) {
    case 'own':
      return isCore ? MINIMAP_PALETTE.ownCore : MINIMAP_PALETTE.own;
    case 'hostile':
      return MINIMAP_PALETTE.hostile;
    case 'ally':
      return MINIMAP_PALETTE.ally;
    case 'ruin':
      return MINIMAP_PALETTE.ruin;
  }
}

const structuresMarks: MinimapMarkDef = {
  id: 'construction.structures',
  order: 30,
  collect({ db, snapshot, isHostile }) {
    const structChan = readChannel(snapshot, StructuresChannel) ?? undefined;
    if (structChan === undefined) {
      return [];
    }
    const observer = snapshot?.observer ?? 0;
    const marks: MinimapMark[] = [];
    for (let i = 0; i < structChan.handles.length; i++) {
      const st = db.structures.byIndex(structChan.kind[i] ?? 0);
      const faction = structChan.faction[i] ?? 0;
      const state = structChan.state[i] ?? 0;
      const disposition =
        state === STATE_RUIN || faction === 0
          ? 'ruin'
          : resolveDisposition(observer, faction, isHostile);
      const x = structChan.x[i] ?? 0;
      const y = structChan.y[i] ?? 0;
      const w = st?.footprint.w ?? 1;
      const h = st?.footprint.h ?? 1;
      const isCore = Boolean(st?.core);
      const color = structureColor(disposition, isCore);

      if (state === STATE_BLUEPRINT) {
        marks.push({ kind: 'rect', x, y, w, h, stroke: color, lineWidth: 1, grow: -0.5 });
      } else {
        marks.push({ kind: 'rect', x, y, w, h, fill: color });
        if (isCore && disposition === 'own') {
          marks.push({
            kind: 'rect',
            x,
            y,
            w,
            h,
            stroke: MINIMAP_PALETTE.ownCoreStroke,
            lineWidth: 1,
            grow: 0.5,
          });
        }
      }
    }
    return marks;
  },
};

export const constructionMinimapMarks: readonly MinimapMarkDef[] = [structuresMarks];
