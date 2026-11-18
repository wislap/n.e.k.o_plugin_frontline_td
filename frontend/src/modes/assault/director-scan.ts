// Pure snapshot scans for the assault director: structures channel
// rows classified into hostile targets, raid nodes, retake candidates
// (capture ruins + hostile-held capture structures), own operational
// outposts and the own core. No state — everything is recomputed from
// the snapshot each decide.
import type { ContentDb } from '../../content/index';
import { StructuresChannel } from '../../features/construction/protocol';
import type { ConstructionStructures } from '../../features/construction/protocol';
import { STATE_OPERATIONAL, STATE_RUIN, STATE_SITE } from '../../features/construction/protocol';

interface StructureRow {
  handle: number;
  x: number;
  y: number;
}

interface OwnOutpost {
  // Footprint top-left — the stable garrison tag suffix.
  x: number;
  y: number;
  cx: number;
  cy: number;
}

export const garrisonTag = (x: number, y: number): string => `garrison:${x},${y}`;

export interface StructureScan {
  hostileAll: StructureRow[];
  nodes: StructureRow[];
  // Retake candidates: capture ruins (any faction) plus hostile-held
  // capture structures (operational or rebuilding).
  retake: StructureRow[];
  ownOutposts: OwnOutpost[];
  ownCore: StructureRow | null;
}

export function scanStructures(
  snapshot: { channels: Record<string, unknown> },
  db: ContentDb,
  faction: number,
  hostile: ReadonlySet<number>,
  nodeKinds: ReadonlySet<number>,
): StructureScan {
  const st = snapshot.channels[StructuresChannel.id] as ConstructionStructures | undefined;
  const hostileAll: StructureRow[] = [];
  const nodes: StructureRow[] = [];
  const retake: StructureRow[] = [];
  const ownOutposts: OwnOutpost[] = [];
  let ownCore: StructureRow | null = null;
  if (st === undefined) {
    return { hostileAll, nodes, retake, ownOutposts, ownCore };
  }
  for (let i = 0; i < st.handles.length; i++) {
    const kind = st.kind[i] ?? -1;
    const def = db.structures.list[kind];
    const f = st.faction[i] ?? 0;
    const state = st.state[i] ?? -1;
    const cx = (st.x[i] ?? 0) + (def?.footprint.w ?? 1) / 2;
    const cy = (st.y[i] ?? 0) + (def?.footprint.h ?? 1) / 2;
    const entry = { handle: st.handles[i] ?? 0, x: cx, y: cy };
    if (def?.capture !== undefined && state === STATE_RUIN) {
      retake.push(entry);
    }
    if (
      def?.capture !== undefined &&
      hostile.has(f) &&
      (state === STATE_OPERATIONAL || state === STATE_SITE)
    ) {
      retake.push(entry);
    }
    if (def?.capture !== undefined && f === faction && state === STATE_OPERATIONAL) {
      ownOutposts.push({ x: st.x[i] ?? 0, y: st.y[i] ?? 0, cx, cy });
    }
    if (def?.core === true && f === faction && ownCore === null) {
      ownCore = entry;
    }
    if (!hostile.has(f)) {
      continue;
    }
    hostileAll.push(entry);
    if (
      nodeKinds.has(kind) &&
      state === STATE_OPERATIONAL &&
      def?.node !== undefined &&
      !def.node.warehouse
    ) {
      nodes.push(entry);
    }
  }
  return { hostileAll, nodes, retake, ownOutposts, ownCore };
}

export function nearest<T extends { x: number; y: number; handle: number }>(
  from: { x: number; y: number },
  list: readonly T[],
): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const e of list) {
    const dx = e.x - from.x;
    const dy = e.y - from.y;
    const d = dx * dx + dy * dy;
    if (d < bestD || (d === bestD && best !== null && e.handle < best.handle)) {
      bestD = d;
      best = e;
    }
  }
  return best;
}
