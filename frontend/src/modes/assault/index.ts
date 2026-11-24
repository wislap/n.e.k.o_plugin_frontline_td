// Assault mode entry: setup, mode-owned sim modules, the director
// controller and the ended predicate the runtime uses to freeze the
// clock. Only app/ imports this.
import { readChannel } from '../../core/index';
import type { Snapshot } from '../../core/index';
import type { ContentDb, ResolvedMap } from '../../content/index';
import type { FactionId } from '../../core/index';
import type { LogisticsModule } from '../../features/logistics/sim/index';
import type { Controller, SimModule } from '../../kernel/index';
import { AssaultChannel } from './protocol';
import type { AssaultState } from './protocol';
import { ASSAULT_MODE_ID, defaultSetup, requirePoint } from './setup';
import { createDirectorController } from './director';
import type { VictoryOptions } from './victory';
import { createVictoryModule } from './victory';
import { createAssaultProbesModule } from './probes';

export interface AssaultModeContext {
  db: ContentDb;
  map: ResolvedMap;
  factions: readonly FactionId[];
  logistics: LogisticsModule;
}

export function assaultModules(ctx: AssaultModeContext, options: VictoryOptions = {}): SimModule[] {
  return [
    createVictoryModule(options),
    createAssaultProbesModule(ctx.db, ctx.logistics, ctx.factions),
  ];
}

export function assaultDirector(
  faction: FactionId,
  ctx: { db: ContentDb; map: ResolvedMap; hostile: ReadonlySet<number> },
): Controller {
  return createDirectorController({
    faction,
    db: ctx.db,
    rally: requirePoint(ctx.map, 'enemy_rally'),
    hostile: ctx.hostile,
  });
}

export function assaultEnded(snapshot: Snapshot): boolean {
  return (readChannel(snapshot, AssaultChannel)?.ended ?? 0) === 1;
}

export { ASSAULT_MODE_ID, defaultSetup, AssaultChannel };
export type { AssaultState };
