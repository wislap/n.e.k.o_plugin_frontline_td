// Module dependencies injected at install time (wired in app/).
import type { ContentDb } from '../../../content/index';
import type { VisibilityQuery } from '../../../kernel/index';
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
  // Injected observer visibility (vision wires it in app); hostile
  // squads hide unless their centroid is visible or they broadcast a
  // gather / routed advance (threat intel by design). Default: all seen.
  visible?: VisibilityQuery;
}
