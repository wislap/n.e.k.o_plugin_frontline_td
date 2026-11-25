// GpuProfiler bookkeeping (nesting/segment splitting, per-frame sums,
// disjoint drops, rolling average) against a fake GL whose query clock
// is a controllable counter. Durations are nanoseconds like the real
// QUERY_RESULT.
import { describe, expect, it } from 'vitest';
import { GpuProfiler, type TimerQueryContext, type TimerQueryExt } from './gpu-profiler';

const EXT: TimerQueryExt = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };
const QUERY_RESULT_AVAILABLE = 0x8867;

interface FakeQuery {
  id: number;
}

// A fake WebGL2 timer context: each begin/endQuery pair gets a duration
// popped from `durations` (ns); results become available `latency` ticks
// after the query ends.
class FakeGl implements TimerQueryContext {
  durations: number[] = [];
  latency = 0;
  disjoint = false;
  private nextId = 0;
  private open: FakeQuery | null = null;
  private results = new Map<number, { ns: number; readyIn: number }>();

  createQuery(): object {
    return { id: this.nextId++ };
  }
  deleteQuery(): void {}
  beginQuery(_target: number, query: object): void {
    if (this.open !== null) {
      throw new Error('nested beginQuery');
    }
    this.open = query as FakeQuery;
  }
  endQuery(): void {
    if (this.open === null) {
      throw new Error('endQuery without begin');
    }
    const q = this.open;
    this.open = null;
    this.results.set(q.id, { ns: this.durations.shift() ?? 0, readyIn: this.latency });
  }
  getQueryParameter(query: object, pname: number): unknown {
    const r = this.results.get((query as FakeQuery).id);
    if (r === undefined) {
      return undefined;
    }
    return pname === QUERY_RESULT_AVAILABLE ? r.readyIn <= 0 : r.ns;
  }
  getParameter(pname: number): unknown {
    return pname === EXT.GPU_DISJOINT_EXT ? this.disjoint : undefined;
  }
  // Advance the fake availability clock by one frame.
  tick(): void {
    for (const r of this.results.values()) {
      r.readyIn -= 1;
    }
  }
}

function frame(p: GpuProfiler, labels: string[] = []): void {
  p.beginFrame();
  for (const label of labels) {
    p.begin(label);
    p.end();
  }
  p.endFrame();
}

describe('GpuProfiler', () => {
  it('is a no-op without the timer extension', () => {
    const p = new GpuProfiler(new FakeGl(), null);
    expect(p.available).toBe(false);
    p.beginFrame();
    p.begin('scene');
    p.end();
    p.endFrame();
    expect(p.snapshot().labels).toEqual([]);
    expect(p.snapshot().totalMs).toBe(0);
  });

  it('sums sequential and nested segments per label per frame', () => {
    const gl = new FakeGl();
    // endQuery order is frame-seg1, scene-seg1, shadow, scene-seg2,
    // frame-seg2 — children split their parent span. scene totals
    // 30us + 10us, shadow 5us, frame 80us + 20us.
    gl.durations = [80_000, 30_000, 5_000, 10_000, 20_000];
    const p = new GpuProfiler(gl, EXT);
    p.beginFrame();
    p.begin('scene');
    p.begin('shadow');
    p.end();
    p.end(); // resumed scene segment ends
    p.endFrame(); // ends 'frame'
    frame(p); // commits the first frame on this poll
    const snap = p.snapshot();
    const byLabel = Object.fromEntries(snap.labels.map((l) => [l.label, l.ms]));
    expect(byLabel['scene']).toBeCloseTo(0.04, 4);
    expect(byLabel['shadow']).toBeCloseTo(0.005, 4);
    expect(byLabel['frame']).toBeCloseTo(0.1, 4); // un-instrumented remainder
    expect(snap.totalMs).toBeCloseTo(0.145, 4);
  });

  it('waits for async results across later frames', () => {
    const gl = new FakeGl();
    gl.latency = 2;
    // Per frame the endQuery order is frame-seg1, scene, frame-seg2.
    gl.durations = [200_000, 50_000, 200_000, 200_000, 50_000, 200_000, 200_000, 50_000, 200_000];
    const p = new GpuProfiler(gl, EXT);
    frame(p, ['scene']);
    frame(p, ['scene']);
    expect(p.snapshot().labels).toEqual([]); // nothing resolved yet
    gl.tick();
    gl.tick();
    frame(p, ['scene']); // this poll resolves frames 0-2's aged queries
    const snap = p.snapshot();
    expect(snap.labels.find((l) => l.label === 'scene')?.ms).toBeCloseTo(0.05, 4);
    // Per-label averages over the committed frames: scene 0.05 + frame 0.4.
    expect(snap.totalMs).toBeCloseTo(0.45, 4);
  });

  it('drops frames hit by GPU_DISJOINT', () => {
    const gl = new FakeGl();
    gl.durations = [50_000, 10_000, 50_000];
    const p = new GpuProfiler(gl, EXT);
    p.beginFrame();
    p.begin('scene');
    p.end();
    gl.disjoint = true;
    p.endFrame();
    gl.disjoint = false;
    gl.durations = [100_000, 20_000, 100_000, 100_000, 30_000, 100_000];
    frame(p, ['scene']);
    frame(p, ['scene']);
    const snap = p.snapshot();
    // The disjoint frame's 'scene' never commits; only frame 1 counts.
    expect(snap.labels.find((l) => l.label === 'scene')?.ms).toBeCloseTo(0.02, 4);
    expect(snap.totalMs).toBeCloseTo(0.22, 4); // scene 0.02 + frame 0.2
  });

  it('keeps a rolling average over complete frames', () => {
    const gl = new FakeGl();
    const p = new GpuProfiler(gl, EXT);
    for (let i = 0; i < 5; i += 1) {
      gl.durations = [50_000, i * 10_000, 50_000];
      frame(p, ['scene']);
    }
    const snap = p.snapshot();
    // Frames 0..3 committed (frame 4's own queries resolve next poll):
    // scene durations 0,10,20,30us → avg 15us = 0.015ms.
    expect(snap.labels.find((l) => l.label === 'scene')?.ms).toBeCloseTo(0.015, 4);
    expect(snap.totalMs).toBeCloseTo(0.115, 4);
  });
});
