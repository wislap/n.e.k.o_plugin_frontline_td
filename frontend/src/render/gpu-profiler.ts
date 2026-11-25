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
}

export interface GpuProfilerSnapshot {
  readonly available: boolean;
  // Rolling-average ms for the 'frame' span (0 when no complete frame).
  readonly totalMs: number;
  // Rolling-average ms per non-frame label.
  readonly labels: readonly GpuPassTiming[];
}

interface OpenSegment {
  label: string;
  query: object;
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
  private pending: PendingSegment[] = [];
  private issued = new Map<number, number>();
  private collected = new Map<number, FrameCollect>();
  private history = new Map<string, number[]>();
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

  private record(seg: OpenSegment): void {
    this.pending.push({ frame: this.frame, label: seg.label, query: seg.query });
    this.issued.set(this.frame, (this.issued.get(this.frame) ?? 0) + 1);
  }

  // Opens a span. If another span is open the parent's segment is closed
  // first (queries cannot nest); it resumes when this span ends.
  begin(label: string): void {
    const ext = this.ext;
    if (ext === null) {
      return;
    }
    const top = this.stack[this.stack.length - 1];
    if (top !== undefined) {
      this.gl.endQuery(ext.TIME_ELAPSED_EXT);
      this.record(top);
    }
    const query = this.alloc();
    if (query === null) {
      return;
    }
    this.gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
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
    this.gl.endQuery(ext.TIME_ELAPSED_EXT);
    this.record(top);
    const parent = this.stack[this.stack.length - 1];
    if (parent !== undefined) {
      const query = this.alloc();
      if (query !== null) {
        parent.query = query;
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

  private poll(): void {
    const ext = this.ext;
    if (ext === null) {
      return;
    }
    if (this.gl.getParameter(ext.GPU_DISJOINT_EXT) === true) {
      // The whole pending window is unreliable: recycle the queries and
      // drop every incomplete frame outright — its results can never be
      // trusted or completed now.
      for (const p of this.pending) {
        this.pool.push(p.query);
        this.issued.delete(p.frame);
        this.collected.delete(p.frame);
      }
      this.pending = [];
    }
    while (this.pending.length > 0) {
      const head = this.pending[0];
      if (head === undefined) {
        break;
      }
      if (this.gl.getQueryParameter(head.query, QUERY_RESULT_AVAILABLE) !== true) {
        break;
      }
      this.pending.shift();
      const ns = Number(this.gl.getQueryParameter(head.query, QUERY_RESULT));
      this.pool.push(head.query);
      let c = this.collected.get(head.frame);
      if (c === undefined) {
        c = { count: 0, sums: new Map() };
        this.collected.set(head.frame, c);
      }
      c.count += 1;
      c.sums.set(head.label, (c.sums.get(head.label) ?? 0) + ns / 1e6);
    }
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

  snapshot(): GpuProfilerSnapshot {
    const labels: GpuPassTiming[] = [];
    for (const label of this.history.keys()) {
      if (label !== GPU_FRAME_LABEL) {
        labels.push({ label, ms: this.average(label) });
      }
    }
    return { available: this.available, totalMs: this.average(GPU_FRAME_LABEL), labels };
  }
}
