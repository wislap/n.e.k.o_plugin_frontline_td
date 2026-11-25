// Capture minimap contribution (ADR 0062 step 4a): ruin overlays —
// contested outline and own-leader ring, emitted after all structure
// marks. Moved verbatim from collectMinimapEntities and
// paint-minimap.ts.
import { readChannel } from '../../../core/index';
import type { MinimapMark, MinimapMarkDef } from '../../../ui/minimap/index';
import { STATE_RUIN, StructuresChannel } from '../../construction/protocol';
import { CapturePointsChannel } from '../protocol';

const ruinMarks: MinimapMarkDef = {
  id: 'capture.ruins',
  order: 40,
  collect({ db, snapshot }) {
    const structChan = readChannel(snapshot, StructuresChannel) ?? undefined;
    if (structChan === undefined) {
      return [];
    }
    const cpChan = readChannel(snapshot, CapturePointsChannel) ?? undefined;
    const cpIndexByHandle = new Map<number, number>();
    if (cpChan !== undefined) {
      for (let i = 0; i < cpChan.handles.length; i++) {
        const h = cpChan.handles[i];
        if (h !== undefined) {
          cpIndexByHandle.set(h, i);
        }
      }
    }
    const observer = snapshot?.observer ?? 0;
    const marks: MinimapMark[] = [];
    for (let i = 0; i < structChan.handles.length; i++) {
      const handle = structChan.handles[i] ?? 0;
      const faction = structChan.faction[i] ?? 0;
      const state = structChan.state[i] ?? 0;
      const isRuin = state === STATE_RUIN || faction === 0;
      if (!isRuin) {
        continue;
      }
      const ci = cpIndexByHandle.get(handle);
      const contested = ci !== undefined && (cpChan?.contested[ci] ?? 0) !== 0;
      const leader = ci !== undefined ? (cpChan?.leader[ci] ?? 0) : 0;
      const st = db.structures.byIndex(structChan.kind[i] ?? 0);
      const x = structChan.x[i] ?? 0;
      const y = structChan.y[i] ?? 0;
      const w = st?.footprint.w ?? 1;
      const h = st?.footprint.h ?? 1;
      if (contested) {
        marks.push({
          kind: 'rect',
          x,
          y,
          w,
          h,
          stroke: '#ffc14d',
          lineWidth: 1.25,
          grow: 1,
        });
      } else if (leader === observer) {
        marks.push({ kind: 'ring', x, y, w, h, color: '#5cc8ff', lineWidth: 1, padPx: 2 });
      }
    }
    return marks;
  },
};

export const captureMinimapMarks: readonly MinimapMarkDef[] = [ruinMarks];
