// Capture module (M5 batch A): tug-of-war over ruins. For each entity
// carrying Capture (construction spawns them as ruins via ruinParts),
// standing movers inside the content's capture radius contribute
// rate = lnMilli(n*1000 + e*1000); the two highest faction rates tug
// the progress (clamp at 0, owner flips at 0, decay 2%/s when empty,
// ties stall). Completion emits CaptureCompleted; construction turns
// the ruin into a rebuild site — Faction is never rewritten here.
import type { ContentDb } from '../../../content/index';
import { floorDiv, lnMilli, MILLI } from '../../../core/index';
import type { EntityId } from '../../../core/index';
import type { SimModule, SpawnInit, VisibilityQuery } from '../../../kernel/index';
import { Faction, InWorld } from '../../../kernel/index';
import type { ResolvedStructure } from '../../../content/index';
import { Mover, Position } from '../../movement/sim/index';
import { CaptureCompleted, CapturePointsChannel } from '../protocol';
import type { CapturePoints } from '../protocol';
import { Capture } from './components';

// e in milli units; ln(1+e) is the single-unit capture rate per tick.
const E_MILLI = 2718;
const SINGLE_RATE = lnMilli(MILLI + E_MILLI);

// Injected into construction as a ruin part factory (wired in app):
// every ruin carries Capture; kind/x/y mirror the Structure fields so
// the module needs no construction import.
export function captureRuinParts(kind: ResolvedStructure, x: number, y: number): SpawnInit {
  return [
    [Capture, { owner: 0, progress: 0, done: 0, kind: kind.index, x, y, leader: 0, contested: 0 }],
  ];
}

export interface CaptureOptions {
  // Injected observer visibility (vision wires it in app); capture
  // points hide unless their centre cell is visible. Default: all seen.
  visible?: VisibilityQuery;
}

export function createCaptureModule(db: ContentDb, options: CaptureOptions = {}): SimModule {
  return {
    id: 'frontline_td:capture',
    install(builder) {
      const capW = builder.claimWriter(Capture);

      builder.system({
        id: 'frontline_td:capture.progress',
        phase: 'capture_fog',
        emits: [CaptureCompleted],
        run(ctx) {
          const pos = ctx.read(Position);
          const fac = ctx.read(Faction);
          const movers: { f: number; x: number; y: number }[] = [];
          for (const id of ctx.query([Mover, Position, Faction, InWorld])) {
            movers.push({ f: fac.id[id] ?? 0, x: pos.x[id] ?? 0, y: pos.y[id] ?? 0 });
          }
          const cap = ctx.write(capW);
          for (const id of ctx.query([Capture])) {
            if ((cap.done[id] ?? 0) !== 0) {
              continue;
            }
            const kind = db.structures.byIndex(cap.kind[id] ?? 0);
            const profile = kind?.capture;
            if (kind === undefined || profile === undefined) {
              continue;
            }
            const cx = (cap.x[id] ?? 0) + kind.footprint.w / 2;
            const cy = (cap.y[id] ?? 0) + kind.footprint.h / 2;
            const counts = new Map<number, number>();
            for (const m of movers) {
              const dx = m.x - cx;
              const dy = m.y - cy;
              if (dx * dx + dy * dy <= profile.radiusSq) {
                counts.set(m.f, (counts.get(m.f) ?? 0) + 1);
              }
            }
            const total = profile.ticks * SINGLE_RATE;
            let progress = cap.progress[id] ?? 0;
            let owner = cap.owner[id] ?? 0;
            let leader = 0;
            let contested = 0;
            if (counts.size === 0) {
              // Empty capture zone: decay 2% of total per second.
              progress = Math.max(0, progress - floorDiv(total, 1000));
              if (progress === 0) {
                owner = 0;
              }
            } else {
              // Highest and second-highest faction rates (ties by id).
              let fa = 0;
              let ra = 0;
              let rb = 0;
              for (const [f, n] of counts) {
                const r = lnMilli(n * MILLI + E_MILLI);
                if (r > ra || (r === ra && (fa === 0 || f < fa))) {
                  rb = ra;
                  ra = r;
                  fa = f;
                } else if (r > rb) {
                  rb = r;
                }
              }
              const net = ra - rb;
              if (net > 0) {
                leader = fa;
                if (owner === 0) {
                  owner = fa;
                }
                if (owner !== fa) {
                  progress = Math.max(0, progress - net);
                  if (progress === 0) {
                    owner = fa;
                  }
                } else {
                  progress += net;
                  if (progress >= total) {
                    progress = total;
                    cap.done[id] = 1;
                    ctx.emit(CaptureCompleted, {
                      ruin: Number(ctx.handleOf(id as EntityId) ?? 0),
                      faction: owner,
                      kind: cap.kind[id] ?? 0,
                      x: cap.x[id] ?? 0,
                      y: cap.y[id] ?? 0,
                    });
                  }
                }
              } else {
                contested = counts.size > 1 ? 1 : 0;
              }
            }
            cap.owner[id] = owner;
            cap.progress[id] = progress;
            cap.leader[id] = leader;
            cap.contested[id] = contested;
          }
        },
      });

      // Observer-aware: vision's injected query hides points whose
      // centre cell is not visible to the observer.
      builder.snapshotChannel(CapturePointsChannel, (ctx, observer) => {
        const cap = ctx.read(Capture);
        const rows: { id: number; cx: number; cy: number; r: number; total: number }[] = [];
        for (const id of ctx.query([Capture])) {
          const kind = db.structures.byIndex(cap.kind[id] ?? 0);
          const profile = kind?.capture;
          if (kind === undefined || profile === undefined || (cap.done[id] ?? 0) !== 0) {
            continue;
          }
          const cx = (cap.x[id] ?? 0) + kind.footprint.w / 2;
          const cy = (cap.y[id] ?? 0) + kind.footprint.h / 2;
          if (options.visible !== undefined && !options.visible(ctx, observer, cx, cy)) {
            continue;
          }
          rows.push({
            id,
            cx,
            cy,
            r: profile.radius,
            total: profile.ticks * SINGLE_RATE,
          });
        }
        const out: CapturePoints = {
          handles: new Float64Array(rows.length),
          x: new Float32Array(rows.length),
          y: new Float32Array(rows.length),
          radius: new Float32Array(rows.length),
          owner: new Uint16Array(rows.length),
          progressBp: new Uint16Array(rows.length),
          leader: new Uint16Array(rows.length),
          contested: new Uint8Array(rows.length),
        };
        rows.forEach((row, i) => {
          out.handles[i] = Number(ctx.handleOf(row.id as EntityId) ?? 0);
          out.x[i] = row.cx;
          out.y[i] = row.cy;
          out.radius[i] = row.r;
          out.owner[i] = cap.owner[row.id] ?? 0;
          out.progressBp[i] =
            row.total <= 0
              ? 0
              : Math.min(10000, floorDiv((cap.progress[row.id] ?? 0) * 10000, row.total));
          out.leader[i] = cap.leader[row.id] ?? 0;
          out.contested[i] = cap.contested[row.id] ?? 0;
        });
        return out;
      });
    },
  };
}
