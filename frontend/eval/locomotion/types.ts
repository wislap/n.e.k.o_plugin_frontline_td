import type { TerrainGrid } from '../../src/features/terrain/content';
import type { PathingApi } from '../../src/features/pathing/sim/index';
import type { TerrainApi } from '../../src/features/terrain/sim/index';

export interface RecordedUnit {
  readonly handle: number;
  readonly group: number;
  readonly faction: number;
  readonly radius: number;
  readonly maxSpeed: number;
  readonly range: number;
  firstTick: number;
  lastTick: number;
  readonly xs: Float32Array;
  readonly ys: Float32Array;
  readonly actives: Uint8Array;
  readonly shotTicks: number[];
  wallScrapeTicks: number;
}

export interface DynamicBlockerEvent {
  readonly tick: number;
  readonly cells: readonly { x: number; y: number }[];
}

export interface ProbeRecording {
  readonly ticks: number;
  readonly units: readonly RecordedUnit[];
  readonly perTickCoreOverlap: Float64Array;
  readonly dynamicBlockers: readonly DynamicBlockerEvent[];
}

export interface ChokepointGate {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly nx: number;
  readonly ny: number;
  readonly bidirectional?: boolean;
}

interface ViewportBox {
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
}

export interface StaticObstacleRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly label?: string;
}

export interface ScenarioRunOutput {
  readonly grid: TerrainGrid;
  readonly terrain: TerrainApi;
  readonly pathing: PathingApi;
  readonly recording: ProbeRecording;
  readonly unitGoals: ReadonlyMap<number, { x: number; y: number }>;
  readonly structures: readonly StaticObstacleRect[];
  readonly hash: string;
  readonly simMs: number;
}

export interface ScenarioSpec {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly ticks: number;
  readonly orderStartTick: number;
  readonly goal: { x: number; y: number };
  readonly chokepointGate?: ChokepointGate;
  readonly viewport?: ViewportBox;
  readonly expectCombat?: boolean;
  run(): ScenarioRunOutput;
}

export interface ScenarioMetrics {
  readonly unitCount: number;
  readonly arrivedRatio: number;
  readonly firstArrivalTick: number | null;
  readonly settlingTicks: number | null;
  readonly settled: boolean;
  readonly stretchMean: number;
  readonly stretchP95: number;
  readonly jitterMeanDeg: number;
  readonly jitterP95Deg: number;
  readonly sharpFlipRate: number;
  readonly splitDetected: boolean;
  readonly maxBranchGapCells: number;
  readonly p95LateralSpreadCells: number;
  readonly stallRatio: number;
  readonly chokepointFluxPer100Ticks: number | null;
  readonly coreOverlapPerUnitTick: number;
  readonly wallScrapeCount: number;
  readonly firstShotTick: number | null;
  readonly ticksTo80PctFiring: number | null;
  readonly everFiredRatio: number | null;
}

export interface ScenarioReport {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly ticks: number;
  readonly hash: string;
  readonly simMs: number;
  readonly metrics: ScenarioMetrics;
}

export interface SuiteSummary {
  readonly tag: string;
  readonly createdAt: string;
  readonly reports: readonly ScenarioReport[];
}
