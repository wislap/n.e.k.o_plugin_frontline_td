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
  returnNullQueries = false;
  deletedIds: number[] = [];
  createdCount = 0;
  private nextId = 0;
  private open: FakeQuery | null = null;
  private results = new Map<number, { ns: number; readyIn: number }>();

  createQuery(): object | null {
    if (this.returnNullQueries) {
      return null;
    }
    this.createdCount += 1;
    return { id: this.nextId++ };
  }
  deleteQuery(query: object): void {
    this.deletedIds.push((query as FakeQuery).id);
  }
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

  it('tracks calls per label and expires stale labels after HISTORY_LEN frames', () => {
    const gl = new FakeGl();
    const p = new GpuProfiler(gl, EXT);
    gl.durations = [10_000, 20_000, 10_000, 30_000, 10_000];
    frame(p, ['obj/a', 'obj/a']);
    for (let i = 0; i < 62; i += 1) {
      gl.durations = [10_000];
      frame(p);
    }
    let snap = p.snapshot();
    // After 62 idle frames (> HISTORY_LEN = 60), 'obj/a' has expired.
    expect(snap.labels.find((l) => l.label === 'obj/a')).toBeUndefined();

    // Run fresh frames with 2 calls of 'obj/b' per frame.
    for (let i = 0; i < 3; i += 1) {
      gl.durations = [10_000, 5_000, 10_000, 5_000, 10_000];
      frame(p, ['obj/b', 'obj/b']);
    }
    snap = p.snapshot();
    const row = snap.labels.find((l) => l.label === 'obj/b');
    expect(row?.calls).toBeCloseTo(2, 4);
    expect(row?.ms).toBeCloseTo(0.01, 4);
  });

  it('drains and compacts high-volume pending queues across latency boundaries', () => {
    const gl = new FakeGl();
    gl.latency = 1;
    const p = new GpuProfiler(gl, EXT);
    const labels = Array.from({ length: 40 }, (_, i) => `layer/m${i % 4}`);
    // 2 frames × 81 segments = 162 pending (> COMPACT_THRESHOLD 64)
    for (let f = 0; f < 3; f += 1) {
      for (let s = 0; s < 81; s += 1) {
        gl.durations.push(1_000);
      }
      frame(p, labels);
      gl.tick();
    }
    const snap = p.snapshot();
    expect(snap.labels.find((l) => l.label === 'layer/m0')?.calls).toBeCloseTo(10, 4);
    expect(snap.totalMs).toBeCloseTo(0.081, 4);
  });

  it('handles GPU_DISJOINT after partial queue drain without re-recycling drained queries', () => {
    const gl = new FakeGl();
    gl.latency = 1;
    const p = new GpuProfiler(gl, EXT);

    // Frame 0: 3 segments, will become ready after 1 tick.
    gl.durations = [10_000, 20_000, 10_000];
    frame(p, ['scene']);
    gl.tick();

    // Frame 1: 3 segments, still pending when frame 1 ends; frame 0 drains here.
    gl.durations = [10_000, 20_000, 10_000];
    frame(p, ['scene']);
    // Now frame 0 is committed; frame 1 is pending with pendingHead > 0.
    expect(p.snapshot().labels.find((l) => l.label === 'scene')?.ms).toBeCloseTo(0.02, 4);

    // Frame 2 hits GPU_DISJOINT before frame 1 resolves.
    gl.disjoint = true;
    gl.durations = [50_000, 99_000, 50_000];
    frame(p, ['scene']);
    gl.disjoint = false;

    // Frame 3 resolves normally — frame 1 & 2's 99us must never appear.
    gl.tick();
    gl.tick();
    gl.durations = [10_000, 40_000, 10_000];
    frame(p, ['scene']);
    gl.tick();
    gl.durations = [10_000];
    frame(p);

    const snap = p.snapshot();
    // Average of frame 0 (20us) and frame 3 (40us) = 30us = 0.03ms.
    expect(snap.labels.find((l) => l.label === 'scene')?.ms).toBeCloseTo(0.03, 4);
  });

  it('evicts oldest pending segments past MAX_PENDING and ignores orphan frame results', () => {
    const gl = new FakeGl();
    gl.latency = 100_000;
    const p = new GpuProfiler(gl, EXT);
    const manyLabels = Array.from({ length: 100 }, (_, i) => `item/${i}`);

    // Issue > 4096 pending segments while nothing resolves.
    for (let f = 0; f < 25; f += 1) {
      frame(p, manyLabels);
    }
    expect(gl.deletedIds.length).toBeGreaterThan(0);

    // Now make remaining results available and verify evicted frames do not commit.
    gl.latency = 0;
    for (let i = 0; i < 100_001; i += 1) {
      gl.tick();
    }
    gl.durations = [10_000];
    frame(p);
    const snap = p.snapshot();
    // Only non-evicted complete frames + latest frame contribute; no crashes or leaks.
    expect(snap.labels.find((l) => l.label === 'frame')).toBeDefined();
  });

  it('guards null createQuery in begin/end and deletes all queries on dispose()', () => {
    const gl = new FakeGl();
    const p = new GpuProfiler(gl, EXT);
    gl.latency = 1;
    gl.durations = [10_000, 20_000, 10_000];
    frame(p, ['scene']);
    gl.tick();
    frame(p, ['scene']); // drains frame 0 into pool, keeps frame 1 in pending

    // Verify null query allocation keeps begin/end balanced without throwing.
    gl.returnNullQueries = true;
    p.beginFrame();
    p.begin('shadow');
    p.end();
    p.endFrame();
    gl.returnNullQueries = false;

    const deletedBefore = gl.deletedIds.length;
    p.dispose();
    expect(gl.deletedIds.length).toBeGreaterThan(deletedBefore);
    expect(p.snapshot().labels).toEqual([]);
    expect(p.snapshot().totalMs).toBe(0);
  });

  it('resetHistory() clears accumulated labels without disposing pending queries', () => {
    const gl = new FakeGl();
    const p = new GpuProfiler(gl, EXT);
    gl.durations = [10_000, 50_000, 10_000];
    frame(p, ['units/mat']);
    frame(p);
    expect(p.snapshot().labels.some((l) => l.label === 'units/mat')).toBe(true);

    p.resetHistory();
    expect(p.snapshot().labels).toEqual([]);
    expect(p.snapshot().totalMs).toBe(0);
    p.dispose();
    expect(gl.deletedIds.length).toBe(gl.createdCount);
  });

  it('resetHistory() invalidates pre-reset async in-flight queries and recycles them cleanly', () => {
    const gl = new FakeGl();
    gl.latency = 2;
    const p = new GpuProfiler(gl, EXT);

    // 3 frames with 'units/mat' while queries resolve with latency = 2.
    for (let i = 0; i < 3; i += 1) {
      gl.durations.push(100_000, 50_000, 100_000);
      frame(p, ['units/mat']);
      gl.tick();
    }
    expect(p.snapshot().labels.some((l) => l.label === 'units/mat')).toBe(true);

    p.resetHistory();
    expect(p.snapshot().labels).toEqual([]);
    expect(p.snapshot().totalMs).toBe(0);

    // 3 frames with ONLY 'scene': pre-reset 'units/mat' (and pre-reset 'frame'
    // timings) must recycle without committing into history.
    for (let i = 0; i < 3; i += 1) {
      gl.durations.push(200_000, 40_000, 200_000);
      frame(p, ['scene']);
      gl.tick();
    }

    const snap = p.snapshot();
    expect(snap.labels.some((l) => l.label === 'units/mat')).toBe(false);
    expect(snap.labels.map((l) => l.label).sort()).toEqual(['frame', 'scene']);
    const sceneRow = snap.labels.find((l) => l.label === 'scene');
    const frameRow = snap.labels.find((l) => l.label === 'frame');
    expect(sceneRow?.ms).toBeCloseTo(0.04, 4);
    expect(frameRow?.ms).toBeCloseTo(0.4, 4);
    expect(snap.totalMs).toBeCloseTo((sceneRow?.ms ?? 0) + (frameRow?.ms ?? 0), 4);

    p.dispose();
    expect(gl.deletedIds.length).toBe(gl.createdCount);
    expect(new Set(gl.deletedIds).size).toBe(gl.createdCount);
  });

  it('resetHistory() mid-frame discards the interrupted active frame and recycles all queries', () => {
    const gl = new FakeGl();
    gl.latency = 2;
    const p = new GpuProfiler(gl, EXT);

    gl.durations.push(100_000, 50_000, 100_000);
    frame(p, ['units/mat']);
    gl.tick();

    // Active frame interrupted by resetHistory() after recording 'units/mat'.
    gl.durations.push(100_000, 50_000, 999_000, 100_000);
    p.beginFrame();
    p.begin('units/mat');
    p.end();
    p.resetHistory();
    p.begin('scene');
    p.end();
    p.endFrame();
    gl.tick();

    // Subsequent clean frames with ONLY 'scene'.
    for (let i = 0; i < 3; i += 1) {
      gl.durations.push(200_000, 40_000, 200_000);
      frame(p, ['scene']);
      gl.tick();
    }

    const snap = p.snapshot();
    expect(snap.labels.some((l) => l.label === 'units/mat')).toBe(false);
    expect(snap.labels.map((l) => l.label).sort()).toEqual(['frame', 'scene']);
    // Interrupted frame's 999_000ns 'scene' must not pollute clean frames' 40_000ns.
    const sceneRow = snap.labels.find((l) => l.label === 'scene');
    const frameRow = snap.labels.find((l) => l.label === 'frame');
    expect(sceneRow?.ms).toBeCloseTo(0.04, 4);
    expect(frameRow?.ms).toBeCloseTo(0.4, 4);
    expect(snap.totalMs).toBeCloseTo((sceneRow?.ms ?? 0) + (frameRow?.ms ?? 0), 4);

    p.dispose();
    expect(gl.deletedIds.length).toBe(gl.createdCount);
    expect(new Set(gl.deletedIds).size).toBe(gl.createdCount);
  });
});
