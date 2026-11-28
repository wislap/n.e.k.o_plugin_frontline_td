// GPU pass profiler (dev DebugPanel): TIME_ELAPSED spans around the
// render pipeline via EXT_disjoint_timer_query_webgl2. Timer queries
// cannot nest, so a nested span ends the parent's current segment and
// resumes it as a new segment when the child ends; same-label segments
// are summed per frame. Results arrive asynchronously: they are polled
// on later frames, frames hit by GPU_DISJOINT are dropped, and a rolling
// average over the last ~60 complete frames feeds the panel readout.
// With the extension missing every method is a no-op.
const QUERY_RESULT = 0x8866;
const QUERY_RESULT_AVAILABLE = 0x8867;
const HISTORY_LEN = 60;
const COMPACT_THRESHOLD = 64;
const MAX_PENDING = 4096;
const MAX_POOL = 512;

// Minimal subset of WebGL2RenderingContext used by the profiler; the
// real context satisfies it, and tests drive it with a fake clock.
export interface TimerQueryContext {
  createQuery(): object | null;
  deleteQuery(query: object): void;
  beginQuery(target: number, query: object): void;
  endQuery(target: number): void;
  getQueryParameter(query: object, pname: number): unknown;
  getParameter(pname: number): unknown;
}

export interface TimerQueryExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

interface GpuPassTiming {
  readonly label: string;
  readonly ms: number;
  // Rolling-average number of segments (spans) per frame. For per-object
  // instrumentation each span is one rendered object, i.e. a draw call.
  readonly calls: number;
}

export interface GpuProfilerSnapshot {
  readonly available: boolean;
  // Sum of all rolling-average label times: the whole measured frame.
  // Segments never overlap (nesting splits the parent), so this is the
  // true per-frame GPU total.
  readonly totalMs: number;
  // Rolling-average ms per label. 'frame' is the un-instrumented
  // remainder of the frame outside any wrapped pass.
  readonly labels: readonly GpuPassTiming[];
}

interface OpenSegment {
  label: string;
  query: object | null;
}

interface PendingSegment {
  frame: number;
  label: string;
  query: object;
}

interface FrameCollect {
  count: number;
  sums: Map<string, number>;
}

const GPU_FRAME_LABEL = 'frame';

export class GpuProfiler {
  readonly available: boolean;
  private stack: OpenSegment[] = [];
  private frame = 0;
  private minCommitFrame = 0;
  private pending: PendingSegment[] = [];
  private pendingHead = 0;
  private issued = new Map<number, number>();
  private collected = new Map<number, FrameCollect>();
  private history = new Map<string, number[]>();
  private callHistory = new Map<string, number[]>();
  // Segments opened per label per frame; committed alongside the timing
  // sums so per-label draw-call counts can be read from the snapshot.
  private frameCalls = new Map<number, Map<string, number>>();
  // Frame index each label was last committed on; labels not seen for
  // ~HISTORY_LEN frames drop out of the readout and the total.
  private lastSeen = new Map<string, number>();
  private pool: object[] = [];
  private readonly gl: TimerQueryContext;
  private readonly ext: TimerQueryExt | null;

  constructor(gl: TimerQueryContext, ext: TimerQueryExt | null) {
    this.gl = gl;
    this.ext = ext;
    this.available = ext !== null;
  }

  static fromContext(gl: WebGL2RenderingContext): GpuProfiler {
    return new GpuProfiler(
      gl,
      gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null,
    );
  }

  private alloc(): object | null {
    return this.pool.pop() ?? this.gl.createQuery();
  }

  private recycleQuery(query: object): void {
    if (this.pool.length < MAX_POOL) {
      this.pool.push(query);
    } else {
      this.gl.deleteQuery(query);
    }
  }

  private compactPending(): void {
    const remaining = this.pending.length - this.pendingHead;
    if (remaining <= 0) {
      this.pending.length = 0;
      this.pendingHead = 0;
    } else if (this.pendingHead >= COMPACT_THRESHOLD && this.pendingHead >= remaining) {
      this.pending.copyWithin(0, this.pendingHead);
      this.pending.length = remaining;
      this.pendingHead = 0;
    }
  }

  private record(label: string, query: object): void {
    this.pending.push({ frame: this.frame, label, query });
    if (this.frame >= this.minCommitFrame) {
      this.issued.set(this.frame, (this.issued.get(this.frame) ?? 0) + 1);
      const calls = this.frameCalls.get(this.frame) ?? new Map<string, number>();
      calls.set(label, (calls.get(label) ?? 0) + 1);
      this.frameCalls.set(this.frame, calls);
    }
    while (this.pending.length - this.pendingHead > MAX_PENDING) {
      const dropped = this.pending[this.pendingHead];
      this.pendingHead += 1;
      if (dropped !== undefined) {
        this.gl.deleteQuery(dropped.query);
        this.issued.delete(dropped.frame);
        this.collected.delete(dropped.frame);
        this.frameCalls.delete(dropped.frame);
      }
    }
    if (this.pendingHead >= MAX_PENDING) {
      this.compactPending();
    }
  }

  // Opens a span. If another span is open the parent's segment is closed
  // first (queries cannot nest); it resumes when this span ends.
  begin(label: string): void {
    const ext = this.ext;
    if (ext === null) {
      return;
    }
    const top = this.stack[this.stack.length - 1];
    if (top !== undefined && top.query !== null) {
      this.gl.endQuery(ext.TIME_ELAPSED_EXT);
      this.record(top.label, top.query);
      top.query = null;
    }
    const query = this.alloc();
    if (query !== null) {
      this.gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    }
    this.stack.push({ label, query });
  }

  // Closes the innermost span and resumes the parent span, if any.
  end(): void {
    const ext = this.ext;
    if (ext === null || this.stack.length === 0) {
      return;
    }
    const top = this.stack.pop();
    if (top === undefined) {
      return;
    }
    if (top.query !== null) {
      this.gl.endQuery(ext.TIME_ELAPSED_EXT);
      this.record(top.label, top.query);
    }
    const parent = this.stack[this.stack.length - 1];
    if (parent !== undefined) {
      const query = this.alloc();
      parent.query = query;
      if (query !== null) {
        this.gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      }
    }
  }

  beginFrame(): void {
    this.begin(GPU_FRAME_LABEL);
  }

  // Closes the frame span, polls finished queries and commits any frame
  // whose queries have all resolved (unless the frame was disjoint).
  endFrame(): void {
    this.end();
    this.poll();
    this.frame += 1;
  }

  resetHistory(): void {
    // Invalidate pre-reset frames (and any currently open frame) so
    // in-flight async queries still drain and recycle via poll()
    // without committing stale labels/timings or orphan frame maps.
    this.minCommitFrame = this.stack.length > 0 ? this.frame + 1 : this.frame;
    this.issued.clear();
    this.collected.clear();
    this.frameCalls.clear();
    this.history.clear();
    this.callHistory.clear();
    this.lastSeen.clear();
  }

  dispose(): void {
    if (this.ext !== null) {
      const top = this.stack[this.stack.length - 1];
      if (top !== undefined && top.query !== null) {
        this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      }
      for (const seg of this.stack) {
        if (seg.query !== null) {
          this.gl.deleteQuery(seg.query);
        }
      }
      for (let i = this.pendingHead; i < this.pending.length; i += 1) {
        const p = this.pending[i];
        if (p !== undefined) {
          this.gl.deleteQuery(p.query);
        }
      }
      for (const q of this.pool) {
        this.gl.deleteQuery(q);
      }
    }
    this.stack.length = 0;
    this.pending.length = 0;
    this.pendingHead = 0;
    this.pool.length = 0;
    this.issued.clear();
    this.collected.clear();
    this.frameCalls.clear();
    this.resetHistory();
  }

  private poll(): void {
    const ext = this.ext;
    if (ext === null) {
      return;
    }
    if (this.gl.getParameter(ext.GPU_DISJOINT_EXT) === true) {
      // The whole pending window is unreliable: recycle the queries and
      // drop every incomplete frame outright — its results can never be
      // trusted or completed now.
      for (let i = this.pendingHead; i < this.pending.length; i += 1) {
        const p = this.pending[i];
        if (p === undefined) {
          continue;
        }
        this.recycleQuery(p.query);
        this.issued.delete(p.frame);
        this.collected.delete(p.frame);
        this.frameCalls.delete(p.frame);
      }
      this.pending.length = 0;
      this.pendingHead = 0;
    }
    while (this.pendingHead < this.pending.length) {
      const head = this.pending[this.pendingHead];
      if (head === undefined) {
        break;
      }
      if (this.gl.getQueryParameter(head.query, QUERY_RESULT_AVAILABLE) !== true) {
        break;
      }
      this.pendingHead += 1;
      if (!this.issued.has(head.frame)) {
        this.recycleQuery(head.query);
        continue;
      }
      const ns = Number(this.gl.getQueryParameter(head.query, QUERY_RESULT));
      this.recycleQuery(head.query);
      let c = this.collected.get(head.frame);
      if (c === undefined) {
        c = { count: 0, sums: new Map() };
        this.collected.set(head.frame, c);
      }
      c.count += 1;
      c.sums.set(head.label, (c.sums.get(head.label) ?? 0) + ns / 1e6);
    }
    this.compactPending();
    for (const [frame, expected] of this.issued) {
      if (frame >= this.frame) {
        continue;
      }
      const c = this.collected.get(frame);
      if (c === undefined || c.count < expected) {
        continue;
      }
      for (const [label, ms] of c.sums) {
        const hist = this.history.get(label) ?? [];
        hist.push(ms);
        if (hist.length > HISTORY_LEN) {
          hist.shift();
        }
        this.history.set(label, hist);
        this.lastSeen.set(label, frame);
      }
      const calls = this.frameCalls.get(frame);
      if (calls !== undefined) {
        for (const [label, n] of calls) {
          const hist = this.callHistory.get(label) ?? [];
          hist.push(n);
          if (hist.length > HISTORY_LEN) {
            hist.shift();
          }
          this.callHistory.set(label, hist);
        }
        this.frameCalls.delete(frame);
      }
      this.issued.delete(frame);
      this.collected.delete(frame);
    }
  }

  private average(label: string): number {
    const hist = this.history.get(label);
    if (hist === undefined || hist.length === 0) {
      return 0;
    }
    return hist.reduce((a, b) => a + b, 0) / hist.length;
  }

  private averageCalls(label: string): number {
    const hist = this.callHistory.get(label);
    if (hist === undefined || hist.length === 0) {
      return 0;
    }
    return hist.reduce((a, b) => a + b, 0) / hist.length;
  }

  snapshot(): GpuProfilerSnapshot {
    const labels: GpuPassTiming[] = [];
    let totalMs = 0;
    for (const label of this.history.keys()) {
      const lastSeen = this.lastSeen.get(label);
      if (lastSeen === undefined || this.frame - lastSeen > HISTORY_LEN) {
        continue; // stale row: the pass has not run recently
      }
      const ms = this.average(label);
      labels.push({ label, ms, calls: this.averageCalls(label) });
      totalMs += ms;
    }
    return { available: this.available, totalMs, labels };
  }
}
