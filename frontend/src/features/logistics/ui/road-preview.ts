// Road-tool preview math (M3 E3): aggregates the selected links into
// the preview numbers — cells still to pave, material cost, build time
// and a per-direction quota estimate. The quota estimate is approximate:
// the client has no per-cell step costs, so it uses a uniform-weight
// harmonic mean over the link's cells; the sim stays authoritative.

export interface RoadPreviewLink {
  // Effective multiplier in bp (snapshot links.m).
  m: number;
  quotaOut: number;
  quotaIn: number;
  volOut: number;
  volIn: number;
  cells: readonly number[];
}

export interface RoadPreview {
  // Cells below the target road level.
  cellsToPave: number;
  // Sum of selected links' current quotas/carried volume (milli).
  quotaOut: number;
  quotaIn: number;
  quotaOutNew: number;
  quotaInNew: number;
  volOut: number;
  volIn: number;
}

// Estimated multiplier (bp) after paving `cells` to the level with
// multiplier `newMultBp`: uniform-weight harmonic mean over per-cell
// multipliers (level array entries are road levels, mapped through
// `levelMult`). Selected cells not yet at the target count as newMult.
export function estimateMultiplierBp(
  levels: readonly number[],
  levelMult: readonly number[],
): number {
  if (levels.length === 0) {
    return 0;
  }
  let inv = 0;
  for (const level of levels) {
    const m = levelMult[level] ?? levelMult[0] ?? 10000;
    inv += 1 / m;
  }
  return levels.length / inv;
}

// Aggregates preview numbers for the selected link indices. `roadLevel`
// gives per-cell current road levels; `targetMultBp`/`baseMultBp` are the
// multipliers of the target level and level 0.
export function roadPreview(
  links: readonly RoadPreviewLink[],
  selected: ReadonlySet<number>,
  roadLevel: (cell: number) => number,
  targetLevel: number,
  levelMult: readonly number[],
): RoadPreview {
  const out: RoadPreview = {
    cellsToPave: 0,
    quotaOut: 0,
    quotaIn: 0,
    quotaOutNew: 0,
    quotaInNew: 0,
    volOut: 0,
    volIn: 0,
  };
  for (const i of selected) {
    const link = links[i];
    if (link === undefined || link.m <= 0) {
      continue;
    }
    const levels = link.cells.map((cell) => {
      const level = roadLevel(cell);
      if (level < targetLevel) {
        out.cellsToPave += 1;
      }
      // Selected cells below target count as paved for the estimate.
      return Math.max(level, targetLevel);
    });
    const newM = estimateMultiplierBp(levels, levelMult);
    const scale = newM / link.m;
    out.quotaOut += link.quotaOut;
    out.quotaIn += link.quotaIn;
    out.quotaOutNew += Math.round(link.quotaOut * scale);
    out.quotaInNew += Math.round(link.quotaIn * scale);
    out.volOut += link.volOut;
    out.volIn += link.volIn;
  }
  return out;
}
