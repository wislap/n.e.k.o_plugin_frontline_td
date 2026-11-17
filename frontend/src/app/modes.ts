// Mode registry: MatchSetup.mode resolves to a mode that contributes
// sim modules, a 'director' controller factory and an ended predicate
// the runtime uses to freeze the clock (ADR 0019 — only app/ imports
// modes; the kernel stays free of mode knowledge).
import type { Snapshot } from '../core/index';
import type { ContentDb, ResolvedMap } from '../content/index';
import type { FactionId } from '../core/index';
import type { LogisticsModule } from '../features/logistics/sim/index';
import type { Controller, SimModule } from '../kernel/index';
import {
  ASSAULT_MODE_ID,
  assaultDirector,
  assaultEnded,
  assaultModules,
} from '../modes/assault/index';

interface ModeModuleContext {
  db: ContentDb;
  map: ResolvedMap;
  factions: readonly FactionId[];
  logistics: LogisticsModule;
}

interface ModeControllerContext {
  db: ContentDb;
  map: ResolvedMap;
  hostile: ReadonlySet<number>;
}

export interface GameMode {
  id: string;
  modules(ctx: ModeModuleContext): SimModule[];
  // Controller for factions whose MatchSetup controller is 'director'.
  director(faction: FactionId, ctx: ModeControllerContext): Controller;
  // True once the latest snapshot reports the match ended.
  ended(snapshot: Snapshot): boolean;
}

const MODES = new Map<string, GameMode>([
  [
    ASSAULT_MODE_ID,
    {
      id: ASSAULT_MODE_ID,
      modules: assaultModules,
      director: assaultDirector,
      ended: assaultEnded,
    },
  ],
]);

export function resolveMode(id: string | undefined): GameMode | undefined {
  if (id === undefined) {
    return undefined;
  }
  return MODES.get(id);
}
