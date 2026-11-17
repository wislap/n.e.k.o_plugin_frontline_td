// Turn a validated MatchSetup into a running sim (or a named error). This is
// the only place match-level choices (packs, maps, modes) are resolved.
import { loadContent } from '../content/load';
import { basePackManifest } from '../content/packs';
import type { FactionId } from '../core/index';
import { toFactionId } from '../core/index';
import type { FactionStart, StartUnit } from '../features/units/sim/index';
import type { QueuedController, SimConfig } from '../kernel/index';
import { createQueuedController, createSimulation } from '../kernel/index';
import type { MatchSetup } from '../protocol/index';
import type { Resolved } from '../runtime/worker-handler';
import { createDevRaidController } from './dev-raid-controller';
import { createSimModules, RNG_STREAMS } from './sim-registry';

export interface ResolveOptions {
  timer?: () => number;
}

export function resolveSetup(
  setup: MatchSetup,
  options: ResolveOptions = {},
): Resolved | { error: string } {
  const base = basePackManifest();
  const seen = new Set<string>();
  for (const pack of setup.packs) {
    seen.add(pack.id);
    if (pack.id === base.id) {
      if (pack.contentHash !== base.contentHash) {
        return {
          error: `base pack content hash mismatch: expected ${base.contentHash}, got ${pack.contentHash}`,
        };
      }
      continue;
    }
    return { error: `unknown pack '${pack.id}'` };
  }
  if (!seen.has(base.id)) {
    return { error: `base pack '${base.id}' is missing from the match setup` };
  }
  if (setup.mode !== undefined) {
    return { error: `unknown mode '${setup.mode}'` };
  }
  // Content is loaded once per worker; the db resolves the map and the
  // start-state unit references.
  const db = loadContent();
  if (setup.mapId === undefined) {
    return { error: 'mapId is required' };
  }
  const map = db.maps.byId(setup.mapId);
  if (map === undefined) {
    return { error: `unknown map '${setup.mapId}'` };
  }
  const starts: FactionStart[] = [];
  for (const faction of setup.factions) {
    const units: StartUnit[] = [];
    for (const entry of faction.start?.units ?? []) {
      const unit = db.units.byId(entry.unit);
      if (unit === undefined) {
        return { error: `unknown unit '${entry.unit}'` };
      }
      if (entry.x >= map.width || entry.y >= map.height) {
        return { error: `start point ${entry.x},${entry.y} is outside map '${map.id}'` };
      }
      units.push({ kind: unit.index, x: entry.x, y: entry.y, count: entry.count });
    }
    const stock = new Map<number, number>();
    for (const [cargoId, units_] of Object.entries(faction.start?.stock ?? {})) {
      const cargo = db.cargos.byId(cargoId);
      if (cargo === undefined) {
        return { error: `unknown cargo '${cargoId}' in start stock` };
      }
      stock.set(cargo.index, units_);
    }
    const structures: { kind: number; x: number; y: number }[] = [];
    for (const entry of faction.start?.structures ?? []) {
      const structure = db.structures.byId(entry.structure);
      if (structure === undefined) {
        return { error: `unknown structure '${entry.structure}'` };
      }
      if (
        entry.x + structure.footprint.w > map.width ||
        entry.y + structure.footprint.h > map.height
      ) {
        return {
          error: `start structure ${entry.x},${entry.y} is outside map '${map.id}'`,
        };
      }
      structures.push({ kind: structure.index, x: entry.x, y: entry.y });
    }
    if (units.length > 0 || stock.size > 0 || structures.length > 0) {
      starts.push({ faction: faction.id, units, stock, structures });
    }
  }

  let localQueue: QueuedController | null = null;
  const controllers = [];
  for (const faction of setup.factions) {
    if (faction.controller === 'local') {
      localQueue = createQueuedController(faction.id);
      controllers.push(localQueue);
    } else if (faction.controller === 'dev_raid') {
      // Dev-only raider: sends idle units toward the map's player_start
      // point every 45 s (m3 batch C). Replaced by M4's director.
      const target = map.points['player_start'] ?? { x: 0, y: 0 };
      controllers.push(createDevRaidController(faction.id, target));
    }
  }

  const observer: FactionId =
    localQueue !== null
      ? localQueue.faction
      : toFactionId(Math.min(...setup.factions.map((f) => f.id)));

  const config: SimConfig = {
    seed: setup.seed,
    factions: setup.factions.map((f) => ({ id: f.id })),
    relations: setup.relations.map((r) => ({ a: r.a, b: r.b, relation: r.relation })),
    grid: { width: map.width, height: map.height },
    rngStreams: [...RNG_STREAMS],
    controllers,
    ...(options.timer !== undefined ? { timer: options.timer } : {}),
  };
  const modules = createSimModules(db, map, starts);
  return { sim: createSimulation(config, modules), localQueue, observer };
}
