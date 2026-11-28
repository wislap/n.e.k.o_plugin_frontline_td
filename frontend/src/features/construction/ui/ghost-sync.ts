// Build-ghost placement evaluation (ADR 0025, ADR 0048): computes the
// centered footprint cell and placement validity outside useFrame,
// syncing interactionStore.ghost on snapshot, cursor, and tool changes.
import { cursorState, type GroundCursor } from '../../../client/cursor';
import {
  useInteractionStore,
  type GhostState,
  type SecondaryTool,
} from '../../../client/interaction-store';
import type { SimClient } from '../../../client/sim-client';
import type { ContentDb, ResolvedMap } from '../../../content/index';
import type { Snapshot } from '../../../core/index';
import {
  centeredFootprint,
  checkFootprint,
  checkRange,
  makePlacementView,
  type PlacementRule,
} from '../rules/index';

function sameGhost(a: GhostState | null, b: GhostState | null): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  return a.x === b.x && a.y === b.y && a.code === b.code;
}

export function computeGhostState(
  db: ContentDb,
  map: ResolvedMap,
  isHostile: (observer: number, faction: number) => boolean,
  tool: SecondaryTool,
  snapshot: Snapshot | null,
  ground: Readonly<GroundCursor>,
): GhostState | null {
  if (tool.kind !== 'place' || snapshot === null || !ground.valid) {
    return null;
  }
  const kind = db.structures.byId(tool.structureKindId);
  if (kind === undefined) {
    return null;
  }
  const { x: tx, y: ty } = centeredFootprint(ground.x, ground.y, kind.footprint);
  const view = makePlacementView(db, map, snapshot, snapshot.observer, (f) =>
    isHostile(snapshot.observer, f),
  );
  const rule: PlacementRule = {
    w: kind.footprint.w,
    h: kind.footprint.h,
    node: kind.node !== undefined,
    connect: kind.node?.connect ?? 0,
    requiresDeposit: kind.requiresDeposit ?? -1,
  };
  const fc = checkFootprint(rule, tx, ty, view);
  const code = fc === 'ok' ? checkRange(rule, tx, ty, view) : fc;
  return { x: tx, y: ty, code };
}

export function subscribeGhostSync({
  client,
  db,
  map,
  isHostile,
}: {
  client: SimClient;
  db: ContentDb;
  map: ResolvedMap;
  isHostile: (observer: number, faction: number) => boolean;
}): () => void {
  const sync = (): void => {
    const interaction = useInteractionStore.getState();
    const next = computeGhostState(
      db,
      map,
      isHostile,
      interaction.tool,
      client.snapshots().latest,
      cursorState.ground(),
    );
    if (!sameGhost(interaction.ghost, next)) {
      interaction.setGhost(next);
    }
  };

  sync();
  const unsubClient = client.subscribe(sync);
  const unsubGround = cursorState.subscribeGround(sync);
  const unsubStore = useInteractionStore.subscribe((s, prev) => {
    if (s.tool !== prev.tool) {
      sync();
    }
  });

  let active = true;
  return () => {
    if (!active) {
      return;
    }
    active = false;
    unsubClient();
    unsubGround();
    unsubStore();
  };
}
