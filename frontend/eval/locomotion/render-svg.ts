import { loadContent } from '../../src/content/index';
import type {
  RecordedUnit,
  ScenarioMetrics,
  ScenarioReport,
  ScenarioRunOutput,
  ScenarioSpec,
  SuiteSummary,
} from './types';

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '-';
}

function fmtPct(ratio: number): string {
  return `${(ratio * 100).toFixed(0)}%`;
}

function collectSharpFlips(u: RecordedUnit, startTick: number): { x: number; y: number }[] {
  const flips: { x: number; y: number }[] = [];
  const sTick = Math.max(startTick, u.firstTick);
  const minV = 0.15 * u.maxSpeed;
  for (let t = sTick + 2; t <= u.lastTick; t++) {
    const x0 = u.xs[t - 2] ?? 0;
    const y0 = u.ys[t - 2] ?? 0;
    const x1 = u.xs[t - 1] ?? 0;
    const y1 = u.ys[t - 1] ?? 0;
    const x2 = u.xs[t] ?? 0;
    const y2 = u.ys[t] ?? 0;
    const vx0 = x1 - x0;
    const vy0 = y1 - y0;
    const vx1 = x2 - x1;
    const vy1 = y2 - y1;
    const l0 = Math.hypot(vx0, vy0);
    const l1 = Math.hypot(vx1, vy1);
    if (l0 <= minV || l1 <= minV) {
      continue;
    }
    const cos = Math.max(-1, Math.min(1, (vx0 * vx1 + vy0 * vy1) / (l0 * l1)));
    const deg = Math.acos(cos) * (180 / Math.PI);
    if (deg > 60) {
      flips.push({ x: x1, y: y1 });
    }
  }
  return flips;
}

const G1_PALETTE = ['#38bdf8', '#2dd4bf', '#60a5fa', '#34d399'] as const;
const G2_PALETTE = ['#fb7185', '#f97316', '#f43f5e', '#fb923c'] as const;

function unitStrokeColor(u: RecordedUnit, idx: number): string {
  if (u.radius > 0.45) {
    return '#fbbf24';
  }
  if (u.group === 2) {
    return G2_PALETTE[idx % G2_PALETTE.length] ?? '#fb7185';
  }
  return G1_PALETTE[idx % G1_PALETTE.length] ?? '#38bdf8';
}

export function renderScenarioSvg(
  spec: ScenarioSpec,
  run: ScenarioRunOutput,
  metrics: ScenarioMetrics,
): string {
  const { grid, recording } = run;
  const vp = spec.viewport ?? { x0: 0, y0: 0, w: grid.width, h: grid.height };
  const cellPx = Math.max(8, Math.min(20, Math.floor(860 / vp.w)));
  const pad = 16;
  const headerH = 74;
  const footerH = 30;
  const mapW = vp.w * cellPx;
  const mapH = vp.h * cellPx;
  const svgW = pad * 2 + mapW;
  const svgH = headerH + mapH + footerH;

  const toPxX = (wx: number): string => (pad + (wx - vp.x0) * cellPx).toFixed(1);
  const toPxY = (wy: number): string => (headerH + (wy - vp.y0) * cellPx).toFixed(1);

  const db = loadContent();
  const forestIdx = db.surfaces.byId('frontline_td:forest')?.index ?? -1;
  const shallowIdx = db.surfaces.byId('frontline_td:shallow_water')?.index ?? -1;
  const deepIdx = db.surfaces.byId('frontline_td:deep_water')?.index ?? -1;
  const rockIdx = db.surfaces.byId('frontline_td:rock')?.index ?? -1;
  const oreIdx = db.surfaces.byId('frontline_td:ore_field')?.index ?? -1;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">`,
  );
  parts.push(`<rect width="${svgW}" height="${svgH}" fill="#0d131a"/>`);

  // Header
  parts.push(
    `<text x="${pad}" y="25" fill="#f1f5f9" font-size="15" font-weight="700">${escapeXml(spec.title)}</text>`,
  );
  parts.push(
    `<text x="${svgW - pad}" y="25" text-anchor="end" fill="#64748b" font-size="11">${escapeXml(spec.id)} | ticks=${spec.ticks} | ${run.simMs.toFixed(1)}ms</text>`,
  );

  const settleLabel =
    metrics.settlingTicks === null
      ? 'Settle:-'
      : metrics.settled
        ? `Settle:${metrics.settlingTicks}t`
        : `Unsettled(${metrics.settlingTicks}t+)`;
  const splitLabel = metrics.splitDetected
    ? `SPLIT gap=${fmt(metrics.maxBranchGapCells)}`
    : `Gap=${fmt(metrics.maxBranchGapCells)}`;
  const extraBadge =
    metrics.chokepointFluxPer100Ticks !== null
      ? `Flux=${fmt(metrics.chokepointFluxPer100Ticks, 1)}/100t`
      : metrics.ticksTo80PctFiring !== null
        ? `80%Fire=${metrics.ticksTo80PctFiring}t`
        : `WallClip=${metrics.wallScrapeCount}`;

  const badges: { text: string; color: string }[] = [
    {
      text: `Arrived:${fmtPct(metrics.arrivedRatio)}`,
      color: metrics.arrivedRatio >= 0.99 ? '#34d399' : '#f87171',
    },
    { text: settleLabel, color: metrics.settled ? '#38bdf8' : '#fbbf24' },
    {
      text: `Stretch:${fmt(metrics.stretchMean)} (P95:${fmt(metrics.stretchP95)})`,
      color: metrics.stretchP95 <= 1.25 ? '#94a3b8' : '#fbbf24',
    },
    {
      text: `JitterP95:${fmt(metrics.jitterP95Deg, 1)}°`,
      color:
        metrics.jitterP95Deg <= 25 ? '#34d399' : metrics.jitterP95Deg <= 50 ? '#fbbf24' : '#f87171',
    },
    { text: splitLabel, color: metrics.splitDetected ? '#f87171' : '#34d399' },
    { text: `LatP95:${fmt(metrics.p95LateralSpreadCells)}`, color: '#cbd5e1' },
    {
      text: `Stall:${fmtPct(metrics.stallRatio)}`,
      color: metrics.stallRatio <= 0.15 ? '#94a3b8' : '#fbbf24',
    },
    { text: extraBadge, color: '#a78bfa' },
  ];

  let bx = pad;
  for (const b of badges) {
    const w = b.text.length * 6.4 + 12;
    parts.push(
      `<rect x="${bx.toFixed(1)}" y="37" width="${w.toFixed(1)}" height="22" rx="4" fill="#18222f" stroke="${b.color}" stroke-opacity="0.55"/>`,
    );
    parts.push(
      `<text x="${(bx + 6).toFixed(1)}" y="52" fill="${b.color}" font-size="11">${escapeXml(b.text)}</text>`,
    );
    bx += w + 6;
  }

  // Map backdrop + tiles
  parts.push(`<rect x="${pad}" y="${headerH}" width="${mapW}" height="${mapH}" fill="#16202a"/>`);
  const xEnd = Math.min(grid.width, vp.x0 + vp.w);
  const yEnd = Math.min(grid.height, vp.y0 + vp.h);
  for (let y = Math.max(0, vp.y0); y < yEnd; y++) {
    for (let x = Math.max(0, vp.x0); x < xEnd; x++) {
      const idx = y * grid.width + x;
      const surf = grid.surfaces[idx] ?? 0;
      const h = grid.heights[idx] ?? 0;
      const ramp = grid.ramps[idx] ?? 0;
      let fill: string | null = null;
      if (surf === rockIdx) {
        fill = '#3d4045';
      } else if (surf === deepIdx) {
        fill = '#0b2545';
      } else if (surf === shallowIdx) {
        fill = '#1b4965';
      } else if (surf === forestIdx) {
        fill = '#183424';
      } else if (surf === oreIdx) {
        fill = '#2e2f1d';
      } else if (ramp === 1) {
        fill = '#35506b';
      } else if (h >= 1) {
        fill = '#243242';
      }
      if (fill !== null) {
        parts.push(
          `<rect x="${toPxX(x)}" y="${toPxY(y)}" width="${cellPx}" height="${cellPx}" fill="${fill}"/>`,
        );
      }
    }
  }

  // Dynamic blocker cells (S7)
  for (const ev of recording.dynamicBlockers) {
    for (const c of ev.cells) {
      parts.push(
        `<rect x="${toPxX(c.x)}" y="${toPxY(c.y)}" width="${cellPx}" height="${cellPx}" fill="#9e2a2b" fill-opacity="0.78" stroke="#f87171" stroke-width="0.8"/>`,
      );
    }
    const firstCell = ev.cells[0];
    if (firstCell !== undefined) {
      parts.push(
        `<text x="${toPxX(firstCell.x)}" y="${toPxY(firstCell.y - 0.3)}" fill="#fca5a5" font-size="10">wall@${ev.tick}t</text>`,
      );
    }
  }

  // Structures
  for (const st of run.structures) {
    parts.push(
      `<rect x="${toPxX(st.x)}" y="${toPxY(st.y)}" width="${st.w * cellPx}" height="${st.h * cellPx}" fill="#e07a5f" fill-opacity="0.82" stroke="#ffd166" stroke-width="1.2"/>`,
    );
    if (st.label !== undefined) {
      parts.push(
        `<text x="${toPxX(st.x + st.w * 0.5)}" y="${toPxY(st.y - 0.35)}" text-anchor="middle" fill="#ffd166" font-size="10">${escapeXml(st.label)}</text>`,
      );
    }
  }

  if (spec.expectCombat === true) {
    parts.push(
      `<circle cx="${toPxX(spec.goal.x + 0.5)}" cy="${toPxY(spec.goal.y + 0.5)}" r="${(6.5 * cellPx).toFixed(1)}" fill="none" stroke="#ff9f1c" stroke-width="1" stroke-dasharray="4,4" stroke-opacity="0.65"/>`,
    );
  }

  // Chokepoint gate
  if (spec.chokepointGate !== undefined) {
    const g = spec.chokepointGate;
    parts.push(
      `<line x1="${toPxX(g.x0)}" y1="${toPxY(g.y0)}" x2="${toPxX(g.x1)}" y2="${toPxY(g.y1)}" stroke="#f4d35e" stroke-width="2" stroke-dasharray="5,3"/>`,
    );
  }

  // Goal crosshair(s)
  const goalsToDraw: { x: number; y: number; color: string }[] = [
    { x: spec.goal.x + 0.5, y: spec.goal.y + 0.5, color: '#34d399' },
  ];
  if (spec.id === 'S4_corridor_head_on') {
    goalsToDraw.push({ x: 7.5, y: 9.5, color: '#fb7185' });
  }
  for (const g of goalsToDraw) {
    const gx = toPxX(g.x);
    const gy = toPxY(g.y);
    parts.push(
      `<circle cx="${gx}" cy="${gy}" r="${(cellPx * 0.65).toFixed(1)}" fill="none" stroke="${g.color}" stroke-width="1.5"/>`,
      `<line x1="${toPxX(g.x - 0.8)}" y1="${gy}" x2="${toPxX(g.x + 0.8)}" y2="${gy}" stroke="${g.color}" stroke-width="1.2"/>`,
      `<line x1="${gx}" y1="${toPxY(g.y - 0.8)}" x2="${gx}" y2="${toPxY(g.y + 0.8)}" stroke="${g.color}" stroke-width="1.2"/>`,
    );
  }

  // Trajectories
  const flipDots: { x: number; y: number }[] = [];
  for (let ui = 0; ui < recording.units.length; ui++) {
    const u = recording.units[ui];
    if (u === undefined) {
      continue;
    }
    const color = unitStrokeColor(u, ui);
    const sTick = Math.max(u.firstTick, spec.orderStartTick - 1);
    const pts: string[] = [];
    let lastPx = NaN;
    let lastPy = NaN;
    for (let t = sTick; t <= u.lastTick; t++) {
      const ux = u.xs[t] ?? 0;
      const uy = u.ys[t] ?? 0;
      if (Math.abs(ux - lastPx) < 0.02 && Math.abs(uy - lastPy) < 0.02 && t < u.lastTick) {
        continue;
      }
      lastPx = ux;
      lastPy = uy;
      pts.push(`${toPxX(ux)},${toPxY(uy)}`);
    }
    const sw = u.radius > 0.45 ? '2.4' : '1.3';
    if (pts.length >= 2) {
      parts.push(
        `<polyline fill="none" stroke="${color}" stroke-width="${sw}" stroke-opacity="0.72" points="${pts.join(' ')}"/>`,
      );
    }
    const sx = toPxX(u.xs[sTick] ?? 0);
    const sy = toPxY(u.ys[sTick] ?? 0);
    const ex = toPxX(u.xs[u.lastTick] ?? 0);
    const ey = toPxY(u.ys[u.lastTick] ?? 0);
    const endActive = u.actives[u.lastTick] ?? 0;
    const gTarget = run.unitGoals.get(u.handle) ?? spec.goal;
    const distEnd = Math.hypot(
      (u.xs[u.lastTick] ?? 0) - (gTarget.x + 0.5),
      (u.ys[u.lastTick] ?? 0) - (gTarget.y + 0.5),
    );
    const endOk =
      spec.expectCombat === true
        ? u.shotTicks.length > 0
        : endActive === 2
          ? distEnd <= 5.5
          : distEnd <= 4.5 && endActive !== 1;
    parts.push(
      `<circle cx="${sx}" cy="${sy}" r="${Math.max(2, u.radius * cellPx * 0.4).toFixed(1)}" fill="none" stroke="${color}" stroke-opacity="0.75" stroke-width="1"/>`,
    );
    parts.push(
      `<circle cx="${ex}" cy="${ey}" r="${Math.max(2.6, u.radius * cellPx * 0.65).toFixed(1)}" fill="${color}" stroke="${endOk ? '#f8fafc' : '#ef4444'}" stroke-width="${endOk ? '1' : '1.6'}"/>`,
    );
    for (const f of collectSharpFlips(u, spec.orderStartTick)) {
      flipDots.push(f);
    }
  }

  for (const f of flipDots) {
    parts.push(
      `<circle cx="${toPxX(f.x)}" cy="${toPxY(f.y)}" r="2.1" fill="#ff2a85" fill-opacity="0.88"/>`,
    );
  }

  parts.push(
    `<rect x="${pad}" y="${headerH}" width="${mapW}" height="${mapH}" fill="none" stroke="#334155"/>`,
  );
  parts.push(
    `<text x="${pad}" y="${svgH - 10}" fill="#94a3b8" font-size="10.5">Legend: Cyan=G1 | Gold=Heavy(2x2) | Coral=G2 | PinkDot=Turn&gt;60° | WhiteRing=Arrived | RedRing=Unarrived/Moving | YellowDash=Gate</text>`,
  );
  parts.push('</svg>');
  return parts.join('\n');
}

function deltaStr(
  cur: number | null,
  prev: number | null,
  digits: number,
  lowerIsBetter: boolean,
): string {
  if (cur === null || prev === null) {
    return '';
  }
  const diff = cur - prev;
  if (Math.abs(diff) < 1e-4) {
    return ' <span class="muted">(=)</span>';
  }
  const sign = diff > 0 ? '+' : '';
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  return ` <span class="${good ? 'good' : 'bad'}">(${sign}${diff.toFixed(digits)})</span>`;
}

export function renderDashboardHtml(
  summary: SuiteSummary,
  svgs: ReadonlyMap<string, string>,
  baseline?: SuiteSummary,
): string {
  const baseById = new Map<string, ScenarioReport>();
  if (baseline !== undefined) {
    for (const r of baseline.reports) {
      baseById.set(r.id, r);
    }
  }

  const rows = summary.reports
    .map((r) => {
      const m = r.metrics;
      const b = baseById.get(r.id)?.metrics;
      return `<tr>
        <td><strong>${escapeXml(r.id)}</strong><div class="sub">${escapeXml(r.title)}</div></td>
        <td>${fmtPct(m.arrivedRatio)}${deltaStr(m.arrivedRatio * 100, b !== undefined ? b.arrivedRatio * 100 : null, 0, false)}</td>
        <td>${m.settlingTicks === null ? '-' : `${m.settlingTicks}t${m.settled ? '' : '*'}`}${deltaStr(m.settlingTicks, b?.settlingTicks ?? null, 0, true)}</td>
        <td>${fmt(m.stretchMean)} / ${fmt(m.stretchP95)}${deltaStr(m.stretchP95, b?.stretchP95 ?? null, 2, true)}</td>
        <td>${fmt(m.jitterMeanDeg, 1)}° / ${fmt(m.jitterP95Deg, 1)}°${deltaStr(m.jitterP95Deg, b?.jitterP95Deg ?? null, 1, true)}</td>
        <td>${fmtPct(m.sharpFlipRate)}</td>
        <td class="${m.splitDetected ? 'bad' : 'good'}">${m.splitDetected ? 'SPLIT' : 'OK'} (${fmt(m.maxBranchGapCells)})${deltaStr(m.maxBranchGapCells, b?.maxBranchGapCells ?? null, 2, true)}</td>
        <td>${fmt(m.p95LateralSpreadCells)}</td>
        <td>${fmtPct(m.stallRatio)}${deltaStr(m.stallRatio * 100, b !== undefined ? b.stallRatio * 100 : null, 1, true)}</td>
        <td>${m.chokepointFluxPer100Ticks !== null ? fmt(m.chokepointFluxPer100Ticks, 1) : '-'}</td>
        <td>${fmt(m.coreOverlapPerUnitTick, 4)} / ${m.wallScrapeCount}</td>
        <td>${m.ticksTo80PctFiring !== null ? `${m.ticksTo80PctFiring}t (${fmtPct(m.everFiredRatio ?? 0)})` : '-'}</td>
      </tr>`;
    })
    .join('\n');

  const cards = summary.reports
    .map((r) => {
      const svg = svgs.get(r.id) ?? '';
      return `<section class="card">
        <p class="desc">${escapeXml(r.description)}</p>
        <div class="svg-wrap">${svg}</div>
      </section>`;
    })
    .join('\n');

  const baseNote = baseline !== undefined ? ` (vs baseline: ${escapeXml(baseline.tag)})` : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>Locomotion Eval — ${escapeXml(summary.tag)}</title>
<style>
  body { margin: 0; padding: 24px; background: #090e14; color: #e2e8f0; font-family: ui-sans-serif, system-ui, sans-serif; }
  h1 { margin: 0 0 6px; font-size: 20px; }
  .meta { color: #94a3b8; font-size: 13px; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 24px; background: #0f1722; }
  th, td { border: 1px solid #1e293b; padding: 8px 10px; text-align: left; }
  th { background: #16202f; color: #cbd5e1; font-weight: 600; }
  .sub { color: #94a3b8; font-size: 11px; }
  .good { color: #34d399; font-weight: 600; }
  .bad { color: #f87171; font-weight: 600; }
  .muted { color: #64748b; }
  .card { margin-bottom: 24px; background: #0f1722; border: 1px solid #1e293b; border-radius: 8px; padding: 14px; }
  .desc { margin: 0 0 10px; color: #cbd5e1; font-size: 13px; }
  .svg-wrap { overflow-x: auto; }
</style>
</head>
<body>
  <h1>frontline_td Locomotion Benchmark — ${escapeXml(summary.tag)}${baseNote}</h1>
  <div class="meta">Generated at ${escapeXml(summary.createdAt)} | * = unsettled at end of window</div>
  <table>
    <thead>
      <tr>
        <th>Scenario</th><th>Arrived</th><th>Settle</th><th>Stretch Mean/P95</th>
        <th>Jitter Mean/P95</th><th>Flip&gt;45°</th><th>Anti-Split (MaxGap)</th>
        <th>LatSpread P95</th><th>Stall</th><th>Flux/100t</th><th>Overlap / WallClip</th><th>80% Fire</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  ${cards}
</body>
</html>`;
}
