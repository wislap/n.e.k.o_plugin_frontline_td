// Vision module (M5 batch B): per-faction fog layer plus per-observer
// structure memory. Every 5 ticks in capture_fog the layer is recomputed
// (2 -> 1 downgrade, then sight discs stamped for that faction's units
// and operational structures) and each faction's memory is refreshed:
// structures with any visible footprint cell are (re)recorded, stale
// entries whose footprint is visible but whose entity is gone are
// dropped. First run seeds every faction's memory with the other
// factions' landmark structures. Sites, ruins and blueprints carry no
// Vision part, so they give no sight.
import type { ContentDb } from '../../../content/index';
import type { EntityHandle, EntityId, FactionId, Serializable } from '../../../core/index';
import { defineGridLayer } from '../../../kernel/index';
import type { SimModule, SpawnInit, SystemContext, VisibilityQuery } from '../../../kernel/index';
import { Faction, InWorld, UnderConstruction } from '../../../kernel/index';
import type { ResolvedUnit } from '../../../content/index';
import { structureStateOf, Structure } from '../../construction/sim/index';
import type { StructurePartsFn } from '../../construction/sim/index';
import { Position } from '../../movement/sim/index';
import { VISION_STATE_LAYER_ID, VisionMemoryChannel } from '../protocol';
import type { VisionMemory } from '../protocol';
import { Vision } from './components';

export const VisionLayer = defineGridLayer(VISION_STATE_LAYER_ID, 'u8', {
  perFaction: true,
});

// Recompute cadence: 5 ticks = 250 ms of fog latency.
const RECOMPUTE_TICKS = 5;

// A remembered non-own structure, recorded while its footprint was
// visible and kept until the footprint is seen empty/changed.
interface MemoryRow {
  handle: number;
  kind: number;
  x: number;
  y: number;
  faction: number;
  state: number;
}

export interface VisionOptions {
  // Factions declared 'omniscient' in the match setup; they still get a
  // layer (cheap) but the query treats them as all-visible.
  omniscient?: ReadonlySet<number>;
}

export interface VisionApi {
  visible: VisibilityQuery;
  visibleRect(
    ctx: SystemContext,
    observer: FactionId,
    x: number,
    y: number,
    w: number,
    h: number,
  ): boolean;
}

// Injected into units' unitParts (wired in app/).
export function unitVisionParts(unit: ResolvedUnit): SpawnInit {
  return [[Vision, { radius: unit.vision, x: 0, y: 0 }]];
}

// Injected into construction's structureParts (wired in app/). Parts
// are bound at spawn, so sites carry the component too — the recompute
// skips UnderConstruction sources and they only start seeing once
// operational. The footprint centre is baked in because structures
// carry no Position.
export const structureVisionParts: StructurePartsFn = (kind, x, y) => [
  [Vision, { radius: kind.vision, x: x + kind.footprint.w / 2, y: y + kind.footprint.h / 2 }],
];

export function createVisionModule(
  db: ContentDb,
  grid: { width: number; height: number },
  options: VisionOptions = {},
): { module: SimModule; api: VisionApi } {
  const omniscient = options.omniscient ?? new Set<number>();
  // Per-observer memory: faction -> entityId -> row. Serialized via
  // builder.state (sorted) — this is the module's only state.
  const memory = new Map<number, Map<number, MemoryRow>>();
  let seeded = false;
  // Integer disc offsets per radius, precomputed lazily (deterministic).
  const discs = new Map<number, readonly { dx: number; dy: number }[]>();
  const disc = (r: number): readonly { dx: number; dy: number }[] => {
    let d = discs.get(r);
    if (d === undefined) {
      const cells: { dx: number; dy: number }[] = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= r * r) {
            cells.push({ dx, dy });
          }
        }
      }
      d = cells;
      discs.set(r, d);
    }
    return d;
  };

  const cellIndex = (x: number, y: number): number => Math.floor(y) * grid.width + Math.floor(x);
  const inBounds = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < grid.width && y < grid.height;

  const memoryOf = (f: number): Map<number, MemoryRow> => {
    let m = memory.get(f);
    if (m === undefined) {
      m = new Map();
      memory.set(f, m);
    }
    return m;
  };

  const footprintVisible = (
    ctx: SystemContext,
    observer: FactionId,
    x: number,
    y: number,
    w: number,
    h: number,
  ): boolean => {
    if (omniscient.has(Number(observer))) {
      return true;
    }
    const layer = ctx.layer(VisionLayer, observer);
    for (let cy = y; cy < y + h; cy++) {
      for (let cx = x; cx < x + w; cx++) {
        if (inBounds(cx, cy) && layer[cy * grid.width + cx] === 2) {
          return true;
        }
      }
    }
    return false;
  };

  const api: VisionApi = {
    visible(ctx, observer, x, y) {
      if (omniscient.has(Number(observer))) {
        return true;
      }
      if (!inBounds(x, y)) {
        return false;
      }
      return ctx.layer(VisionLayer, observer)[cellIndex(x, y)] === 2;
    },
    visibleRect(ctx, observer, x, y, w, h) {
      return footprintVisible(ctx, observer, x, y, w, h);
    },
  };

  return {
    api,
    module: {
      id: 'frontline_td:vision',
      install(builder) {
        const visionW = builder.claimLayerWriter(VisionLayer);
        // Vision fields are baked at spawn (radius/x/y from content).
        builder.ownComponent(Vision);

        builder.state('frontline_td:vision', {
          save(): Serializable {
            const rows: Serializable[] = [];
            const factions = [...memory.keys()].sort((a, b) => a - b);
            for (const f of factions) {
              const m = memory.get(f);
              if (m === undefined) {
                continue;
              }
              const ids = [...m.keys()].sort((a, b) => a - b);
              for (const id of ids) {
                const r = m.get(id);
                if (r !== undefined) {
                  rows.push({ f, id, ...r });
                }
              }
            }
            return { seeded, rows };
          },
          load(data) {
            const d = data as { seeded?: boolean; rows?: MemoryRow[] };
            seeded = d.seeded === true;
            memory.clear();
            for (const row of d.rows ?? []) {
              const r = row as MemoryRow & { f: number; id: number };
              memoryOf(r.f).set(r.id, {
                handle: r.handle,
                kind: r.kind,
                x: r.x,
                y: r.y,
                faction: r.faction,
                state: r.state,
              });
            }
          },
        });

        builder.system({
          id: 'frontline_td:vision.recompute',
          phase: 'capture_fog',
          everyTicks: RECOMPUTE_TICKS,
          run(ctx) {
            const pos = ctx.read(Position);
            const fac = ctx.read(Faction);
            const vis = ctx.read(Vision);
            const st = ctx.read(Structure);
            const factions = ctx.factions();
            const sources: { f: number; cx: number; cy: number; r: number }[] = [];
            for (const id of ctx.query([Vision, Faction, InWorld])) {
              if (ctx.has(UnderConstruction, id as EntityId)) {
                continue;
              }
              sources.push({
                f: fac.id[id] ?? 0,
                cx: ctx.has(Position, id as EntityId) ? (pos.x[id] ?? 0) : (vis.x[id] ?? 0),
                cy: ctx.has(Position, id as EntityId) ? (pos.y[id] ?? 0) : (vis.y[id] ?? 0),
                r: vis.radius[id] ?? 0,
              });
            }
            for (const f of factions) {
              const data = ctx.writeLayer(visionW, f);
              for (let i = 0; i < data.length; i++) {
                if (data[i] === 2) {
                  data[i] = 1;
                }
              }
              for (const src of sources) {
                if (src.f !== Number(f)) {
                  continue;
                }
                const cx = Math.floor(src.cx);
                const cy = Math.floor(src.cy);
                for (const { dx, dy } of disc(src.r)) {
                  const x = cx + dx;
                  const y = cy + dy;
                  if (inBounds(x, y)) {
                    data[y * grid.width + x] = 2;
                  }
                }
              }
            }

            // Memory: (re)record non-own structures with any visible
            // footprint cell; drop entries whose footprint is visible
            // but whose entity is gone. First run seeds landmarks.
            const first = !seeded;
            for (const f of factions) {
              const mem = memoryOf(Number(f));
              for (const id of ctx.query([Structure, InWorld])) {
                // Ruins carry no Faction — record them as faction 0
                // instead of reading a recycled slot (ADR 0040).
                const owner = ctx.has(Faction, id as EntityId) ? (fac.id[id] ?? 0) : 0;
                const kind = db.structures.byIndex(st.kind[id] ?? -1);
                if (owner === Number(f) || kind === undefined) {
                  continue;
                }
                const x = st.x[id] ?? 0;
                const y = st.y[id] ?? 0;
                const visible = footprintVisible(ctx, f, x, y, kind.footprint.w, kind.footprint.h);
                if (visible || (first && kind.visionLandmark === true)) {
                  mem.set(id, {
                    handle: Number(ctx.handleOf(id as EntityId) ?? 0),
                    kind: kind.index,
                    x,
                    y,
                    faction: owner,
                    state: structureStateOf(ctx, id),
                  });
                }
              }
              for (const [id, row] of [...mem.entries()]) {
                // Staleness is decided by handle: entity ids recycle, so
                // a reused id must not keep the dead row alive.
                const live = ctx.resolve(row.handle as EntityHandle);
                if (live !== null && ctx.has(Structure, live) && ctx.has(InWorld, live)) {
                  continue;
                }
                const kind = db.structures.byIndex(row.kind);
                if (
                  kind !== undefined &&
                  footprintVisible(ctx, f, row.x, row.y, kind.footprint.w, kind.footprint.h)
                ) {
                  mem.delete(id);
                }
              }
            }
            seeded = true;
          },
        });

        builder.snapshotChannel(VisionMemoryChannel, (ctx, observer) => {
          const mem = memoryOf(Number(observer));
          const rows = [...mem.entries()]
            .filter(([, row]) => {
              const kind = db.structures.byIndex(row.kind);
              return (
                kind !== undefined &&
                !footprintVisible(ctx, observer, row.x, row.y, kind.footprint.w, kind.footprint.h)
              );
            })
            .sort(([a], [b]) => a - b);
          const out: VisionMemory = {
            handles: new Float64Array(rows.length),
            kind: new Uint16Array(rows.length),
            x: new Uint16Array(rows.length),
            y: new Uint16Array(rows.length),
            faction: new Uint16Array(rows.length),
            state: new Uint8Array(rows.length),
          };
          rows.forEach(([, row], i) => {
            out.handles[i] = row.handle;
            out.kind[i] = row.kind;
            out.x[i] = row.x;
            out.y[i] = row.y;
            out.faction[i] = row.faction;
            out.state[i] = row.state;
          });
          return out;
        });
      },
    },
  };
}
