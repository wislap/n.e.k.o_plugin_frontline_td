// Balance runner (M4 D): N seeds x 4 eval bots vs the assault director on
// proto_01 through the real resolveSetup path. Each match runs to the
// ended state or the 40-min limit; reports per-bot winrate/draws, mean
// duration, waves survived, 60 s stock samples and per-tick ms avg/p95.
// Usage: node eval/run.ts eval/balance/matches.ts [seeds=8] [--bots=rush,...]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../../src/content/index';
import { toFactionId } from '../../src/core/index';
import { AssaultChannel, assaultEnded, defaultSetup } from '../../src/modes/assault/index';
import type { AssaultState } from '../../src/modes/assault/index';
import { resolveSetup } from '../../src/app/resolve-setup';
import { createBalancedBot } from '../bots/balanced';
import { createEconomyBot } from '../bots/economy';
import { createRushBot } from '../bots/rush';
import { createTurtleBot } from '../bots/turtle';
import type { BotOptions } from '../bots/common';

const EVAL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLAYER = toFactionId(1);
const ENEMY = toFactionId(2);
const TICKS_PER_SECOND = 20;
const LIMIT = 40 * 60 * TICKS_PER_SECOND;
const SAMPLE_EVERY = 60 * TICKS_PER_SECOND;

const BOTS: Record<string, (o: BotOptions) => ReturnType<typeof createRushBot>> = {
  rush: createRushBot,
  turtle: createTurtleBot,
  economy: createEconomyBot,
  balanced: createBalancedBot,
};

interface MatchRow {
  seed: number;
  bot: string;
  winner: number;
  tick: number;
  waves: number;
  hash: string;
  tickAvg: number;
  tickP95: number;
  stock: { tick: number; material: number; ore: number; energy: number; ammo: number }[];
}

function stats(samples: number[]): { avg: number; p95: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    avg: samples.reduce((a, b) => a + b, 0) / Math.max(samples.length, 1),
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
  };
}

export function main(args: string[]): void {
  const seedsArg = args.find((a) => a.startsWith('seeds='));
  const seeds = seedsArg !== undefined ? Number(seedsArg.slice(6)) : 8;
  const botsArg = args.find((a) => a.startsWith('--bots='));
  const botNames = botsArg !== undefined ? botsArg.slice(7).split(',') : Object.keys(BOTS);

  const db = loadContent();
  const map = db.maps.byId('frontline_td:proto_01');
  if (map === undefined) {
    throw new Error('proto_01 missing from content db');
  }
  const cargoIndex = (id: string): number => db.cargos.byId(id)?.index ?? -1;
  const stockKeys = [
    'frontline_td:material',
    'frontline_td:ore',
    'frontline_td:energy',
    'frontline_td:ammo',
  ].map((id) => `frontline_td:assault.stock.f${Number(PLAYER)}.${cargoIndex(id)}`);

  const rows: MatchRow[] = [];
  for (const name of botNames) {
    const make = BOTS[name];
    if (make === undefined) {
      throw new Error(`unknown bot '${name}'`);
    }
    for (let seed = 1; seed <= seeds; seed++) {
      const setup = defaultSetup(seed);
      const resolved = resolveSetup(setup, {
        timer: () => performance.now(),
        controllerFor: (faction) =>
          Number(faction) === Number(PLAYER)
            ? make({ faction: PLAYER, db, map, hostile: new Set([Number(ENEMY)]) })
            : undefined,
      });
      if ('error' in resolved) {
        throw new Error(`resolveSetup failed: ${resolved.error}`);
      }
      // Drive the resolved sim directly: runScenario would re-install the
      // already-installed module objects into a second Simulation.
      const sim = resolved.sim;
      let end: AssaultState | null | undefined;
      const tickMs: number[] = [];
      let prevTotal = 0;
      const samples: { tick: number; probes: Record<string, number> }[] = [];
      while (Number(sim.tick) < LIMIT && end === undefined) {
        sim.step();
        const now = Object.values(sim.timings()).reduce((a, r) => a + r.total, 0);
        tickMs.push(now - prevTotal);
        prevTotal = now;
        const tick = Number(sim.tick);
        if (tick % SAMPLE_EVERY === 0) {
          samples.push({ tick, probes: sim.probes() });
        }
        const snapshot = sim.snapshot(PLAYER);
        if (assaultEnded(snapshot)) {
          end = snapshot.channels[AssaultChannel.id] as AssaultState;
        }
      }
      const tick = Number(sim.tick);
      const t = stats(tickMs);
      rows.push({
        seed,
        bot: name,
        winner: end?.winner ?? -1,
        tick,
        waves: sim.probes()[`frontline_td:assault.waves.f${Number(ENEMY)}`] ?? 0,
        hash: sim.hash(),
        tickAvg: t.avg,
        tickP95: t.p95,
        stock: samples.map((s) => ({
          tick: s.tick,
          material: Math.floor((s.probes[stockKeys[0] ?? ''] ?? 0) / 1000),
          ore: Math.floor((s.probes[stockKeys[1] ?? ''] ?? 0) / 1000),
          energy: Math.floor((s.probes[stockKeys[2] ?? ''] ?? 0) / 1000),
          ammo: Math.floor((s.probes[stockKeys[3] ?? ''] ?? 0) / 1000),
        })),
      });
      console.log(
        `${name} seed=${seed} winner=${rows.at(-1)?.winner} t=${(tick / TICKS_PER_SECOND).toFixed(0)}s waves=${rows.at(-1)?.waves} hash=${rows.at(-1)?.hash}`,
      );
    }
  }

  // Summary table per bot.
  console.log('\nbot       wins draws losses  mean_t(s)  waves  tick_avg(ms)  tick_p95(ms)');
  const summary: Record<string, unknown> = {};
  for (const name of botNames) {
    const rs = rows.filter((r) => r.bot === name);
    const wins = rs.filter((r) => r.winner === Number(PLAYER)).length;
    const draws = rs.filter((r) => r.winner === -1).length;
    const meanT = rs.reduce((a, r) => a + r.tick, 0) / Math.max(rs.length, 1) / TICKS_PER_SECOND;
    const meanWaves = rs.reduce((a, r) => a + r.waves, 0) / Math.max(rs.length, 1);
    const meanAvg = rs.reduce((a, r) => a + r.tickAvg, 0) / Math.max(rs.length, 1);
    const p95 = Math.max(...rs.map((r) => r.tickP95));
    console.log(
      `${name.padEnd(9)} ${String(wins).padStart(4)} ${String(draws).padStart(5)} ${String(rs.length - wins - draws).padStart(6)}` +
        `  ${meanT.toFixed(0).padStart(9)}  ${meanWaves.toFixed(1).padStart(5)}  ${meanAvg.toFixed(2).padStart(12)}  ${p95.toFixed(2).padStart(12)}`,
    );
    summary[name] = {
      wins,
      draws,
      losses: rs.length - wins - draws,
      meanSeconds: meanT,
      meanWaves,
      tickAvgMs: meanAvg,
      tickP95Ms: p95,
    };
  }

  const reportsDir = path.join(EVAL_ROOT, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const reportPath = path.join(reportsDir, `balance-${stamp}.json`);
  writeFileSync(
    reportPath,
    JSON.stringify({ seeds, bots: botNames, summary, matches: rows }, null, 2),
  );
  console.log(`report: ${reportPath}`);
}
