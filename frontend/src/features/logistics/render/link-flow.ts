// Shared smoothed per-link flow (M3 E3 review): one 30 s EMA per link,
// advanced once per snapshot tick and read by both the overlay (bp
// utilization for brightness) and the road tool (carried volOut+volIn
// for route extension). Keyed by link-set identity so a topology change
// resets the smoothing instead of blending across a different network.
import type { Snapshot } from '../../../core/index';
import type { LogisticsNetwork } from '../protocol';
import { emaUpdate } from './smoothing';

interface LinkFlow {
  key: string;
  atTick: number;
  // Smoothed (outBp + inBp) utilization, 0..20000.
  bp: number[];
  // Smoothed (volOut + volIn) carried volume, milli.
  vol: number[];
}
const flow: LinkFlow = { key: '', atTick: -1, bp: [], vol: [] };

export function linkFlow(latest: Snapshot, network: LogisticsNetwork): LinkFlow {
  const links = network.links;
  const key = `${links.a.length}:${links.pathCells.length}:${network.nodes.handles.length}`;
  if (key !== flow.key) {
    flow.key = key;
    flow.atTick = latest.tick;
    flow.bp = [];
    flow.vol = [];
  }
  if (latest.tick === flow.atTick) {
    return flow;
  }
  const dtMs = Math.max(0, (latest.tick - flow.atTick) * 50);
  flow.atTick = latest.tick;
  for (let i = 0; i < links.a.length; i++) {
    const bp = (links.outBp[i] ?? 0) + (links.inBp[i] ?? 0);
    const vol = (links.volOut[i] ?? 0) + (links.volIn[i] ?? 0);
    flow.bp[i] = emaUpdate(flow.bp[i] ?? bp, bp, dtMs);
    flow.vol[i] = emaUpdate(flow.vol[i] ?? vol, vol, dtMs);
  }
  return flow;
}
