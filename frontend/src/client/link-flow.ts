// Shared smoothed per-link flow (M3 E3 review, M3A): one 30 s EMA per link,
// advanced once per snapshot tick and read by both the overlay (bp
// utilization for brightness) and the road tool (carried volOut+volIn
// for route extension). Keyed by link-set identity and reset on client
// session reset so restarts never blend across matches.
import type { Snapshot } from '../core/index';
import { registerSessionReset } from './session';
import { emaUpdate } from './smoothing';

export interface LinkFlowNetwork {
  readonly nodes: { readonly handles: ArrayLike<number> };
  readonly links: {
    readonly a: ArrayLike<number>;
    readonly pathCells: ArrayLike<number>;
    readonly outBp: ArrayLike<number>;
    readonly inBp: ArrayLike<number>;
    readonly volOut: ArrayLike<number>;
    readonly volIn: ArrayLike<number>;
  };
}

interface LinkFlow {
  key: string;
  atTick: number;
  // Smoothed (outBp + inBp) utilization, 0..20000.
  bp: number[];
  // Smoothed (volOut + volIn) carried volume, milli.
  vol: number[];
}
const flow: LinkFlow = { key: '', atTick: -1, bp: [], vol: [] };

registerSessionReset(() => {
  flow.key = '';
  flow.atTick = -1;
  flow.bp = [];
  flow.vol = [];
});

export function linkFlow(latest: Snapshot, network: LinkFlowNetwork): LinkFlow {
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
