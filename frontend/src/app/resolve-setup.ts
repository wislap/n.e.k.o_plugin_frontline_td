// Turn a validated MatchSetup into a running sim (or a named error). This is
// the only place match-level choices (packs, maps, modes) are resolved.
import { loadContent } from '../content/load';
import { basePackManifest } from '../content/packs';
import type { FactionId } from '../core/index';
import { toFactionId } from '../core/index';
import type { FactionStart, StartUnit } from '../features/units/sim/index';
import type { Controller, QueuedController, SimConfig } from '../kernel/index';
import { createQueuedController, createSimulation } from '../kernel/index';
import type { MatchSetup } from '../protocol/index';
import type { Resolved } from '../runtime/worker-handler';
import { resolveMode } from './modes';
import { createSimModules, RNG_STREAMS } from './sim-registry';

export interface ResolveOptions {
  timer?: () => number;
  // Replaces a faction's configured controller (eval bots inject their
  // own Controller through this hook; returns undefined = keep the enum
  // behaviour). Controllers built here still join `config.controllers`.
  controllerFor?: (faction: FactionId) => Controller | undefined;
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
  const mode = resolveMode(setup.mode);
  if (setup.mode !== undefined && mode === undefined) {
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
    const custom = options.controllerFor?.(faction.id);
    if (custom !== undefined) {
      controllers.push(custom);
    } else if (faction.controller === 'local') {
      localQueue = createQueuedController(faction.id);
      controllers.push(localQueue);
    } else if (faction.controller === 'director') {
      if (mode === undefined) {
        return { error: "controller 'director' requires a mode" };
      }
      const hostile = new Set<number>();
      for (const r of setup.relations) {
        if (r.relation === 'hostile') {
          if (Number(r.a) === Number(faction.id)) {
            hostile.add(Number(r.b));
          }
          if (Number(r.b) === Number(faction.id)) {
            hostile.add(Number(r.a));
          }
        }
      }
      controllers.push(mode.director(faction.id, { db, map, hostile }));
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
  const built = createSimModules(db, map, starts, {
    vision: new Map(setup.factions.map((f) => [Number(f.id), f.vision ?? 'fog'] as const)),
  });
  const modules =
    mode === undefined
      ? built.modules
      : [
          ...built.modules,
          ...mode.modules({
            db,
            map,
            factions: setup.factions.map((f) => f.id),
            logistics: built.logistics,
          }),
        ];
  const sim = createSimulation(config, modules);
  return {
    sim,
    localQueue,
    observer,
    config,
    modules,
    // Generic stop predicate the runtime uses to freeze the clock once
    // the match ends — the kernel stays free of mode knowledge.
    ...(mode !== undefined ? { ended: () => mode.ended(sim.snapshot(observer)) } : {}),
  };
}
