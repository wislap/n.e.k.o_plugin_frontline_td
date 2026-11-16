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
    if (units.length > 0) {
      starts.push({ faction: faction.id, units });
    }
  }

  let localQueue: QueuedController | null = null;
  const controllers = [];
  for (const faction of setup.factions) {
    if (faction.controller === 'local') {
      localQueue = createQueuedController(faction.id);
      controllers.push(localQueue);
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
