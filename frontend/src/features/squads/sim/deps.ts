// Module dependencies injected at install time (wired in app/).
import type { ContentDb } from '../../../content/index';
import type { CombatModule } from '../../combat/sim/index';
import type { LogisticsModule } from '../../logistics/sim/index';
import type { PathingApi } from '../../pathing/sim/index';
import type { TerrainApi } from '../../terrain/sim/index';

export interface SquadsDeps {
  db: ContentDb;
  terrain: TerrainApi;
  pathing: PathingApi;
  logistics: LogisticsModule;
  combat: CombatModule;
  energyCargo: number;
}
