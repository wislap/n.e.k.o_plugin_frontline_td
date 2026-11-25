// Squads minimap contribution (ADR 0062 step 4a): hostile squad threat
// routes and pulsing gather diamonds. Moved verbatim from
// collectMinimapEntities and paint-minimap.ts.
import { readChannel } from '../../../core/index';
import type { MinimapMark, MinimapMarkDef } from '../../../ui/minimap/index';
import { SquadsChannel } from '../protocol';

const threatsMarks: MinimapMarkDef = {
  id: 'squads.threats',
  order: 10,
  collect({ snapshot, isHostile, nowMs }) {
    const squadsChan = readChannel(snapshot, SquadsChannel) ?? undefined;
    if (squadsChan === undefined) {
      return [];
    }
    const observer = snapshot?.observer ?? 0;
    const marks: MinimapMark[] = [];
    for (const s of squadsChan.squads) {
      if (
        !isHostile(observer, s.faction) ||
        (s.order.kind !== 'gather' && s.order.kind !== 'advance')
      ) {
        continue;
      }
      const route = s.route ?? [];
      if (route.length >= 4) {
        marks.push({
          kind: 'path',
          points: route,
          color: '#ff5c5c',
          lineWidth: 1.25,
          dash: [4, 3],
        });
      }
      if (s.order.kind === 'gather') {
        const pulse = 0.5 + 0.5 * Math.sin(nowMs * 0.008);
        marks.push({
          kind: 'diamond',
          x: s.order.x,
          y: s.order.y,
          radiusPx: 3 + pulse * 2,
          color: pulse > 0.5 ? '#ff5c5c' : '#ffc14d',
          lineWidth: 1.5,
        });
      }
    }
    return marks;
  },
};

export const squadsMinimapMarks: readonly MinimapMarkDef[] = [threatsMarks];
