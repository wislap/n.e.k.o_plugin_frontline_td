// Units minimap contribution (ADR 0062 step 4a): live unit dots —
// unselected first, selected on top with halo + core. Moved verbatim
// from collectMinimapEntities and paint-minimap.ts.
import { readChannel } from '../../../core/index';
import {
  resolveDisposition,
  type MinimapMark,
  type MinimapMarkDef,
} from '../../../ui/minimap/index';
import { DenseUnitsChannel } from '../protocol';

function unitColor(disposition: 'own' | 'hostile' | 'ally'): string {
  switch (disposition) {
    case 'hostile':
      return '#ff6b6b';
    case 'own':
      return '#6ee7ff';
    case 'ally':
      return '#46e09a';
  }
}

const unitsMarks: MinimapMarkDef = {
  id: 'units.units',
  order: 50,
  collect({ snapshot, isHostile, selected }) {
    const unitChan = readChannel(snapshot, DenseUnitsChannel) ?? undefined;
    if (unitChan === undefined) {
      return [];
    }
    const observer = snapshot?.observer ?? 0;
    interface UnitRow {
      x: number;
      y: number;
      color: string;
      selected: boolean;
    }
    const rows: UnitRow[] = [];
    for (let i = 0; i < unitChan.handles.length; i++) {
      const handle = unitChan.handles[i] ?? 0;
      const faction = unitChan.faction[i] ?? 0;
      const disposition = resolveDisposition(observer, faction, isHostile);
      rows.push({
        x: unitChan.x[i] ?? 0,
        y: unitChan.y[i] ?? 0,
        color: unitColor(disposition),
        selected: faction === observer && selected.has(handle),
      });
    }
    const marks: MinimapMark[] = [];
    for (const u of rows) {
      if (!u.selected) {
        marks.push({ kind: 'dot', x: u.x, y: u.y, sizePx: 2.5, color: u.color });
      }
    }
    for (const u of rows) {
      if (u.selected) {
        marks.push({ kind: 'dot', x: u.x, y: u.y, sizePx: 5, color: '#6ee7ff' });
        marks.push({ kind: 'dot', x: u.x, y: u.y, sizePx: 3, color: '#ffffff' });
      }
    }
    return marks;
  },
};

export const unitsMinimapMarks: readonly MinimapMarkDef[] = [unitsMarks];
