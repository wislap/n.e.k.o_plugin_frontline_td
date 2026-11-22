import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeScenarioMetrics } from './metrics';
import { renderDashboardHtml, renderScenarioSvg } from './render-svg';
import { LOCOMOTION_SCENARIOS } from './scenarios';
import type { ScenarioReport, SuiteSummary } from './types';

const EVAL_ROOT = fileURLToPath(new URL('..', import.meta.url));

function parseFlag(args: readonly string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) {
    return undefined;
  }
  const next = args[idx + 1];
  return next !== undefined && !next.startsWith('--') ? next : undefined;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/** @public eval runner entry: eval/run.ts loads it dynamically. */
export function main(args: string[]): void {
  const tag = parseFlag(args, '--tag') ?? 'v0-baseline';
  const scenarioFilter = parseFlag(args, '--scenario')?.toLowerCase();
  const compareArg = parseFlag(args, '--compare');

  let baseline: SuiteSummary | undefined;
  if (compareArg !== undefined) {
    const direct = path.resolve(compareArg);
    const byTag = path.join(EVAL_ROOT, 'reports', 'locomotion', compareArg, 'summary.json');
    const chosen = existsSync(direct) ? direct : existsSync(byTag) ? byTag : undefined;
    if (chosen === undefined) {
      throw new Error(`--compare baseline not found: ${compareArg}`);
    }
    baseline = JSON.parse(readFileSync(chosen, 'utf8')) as SuiteSummary;
  }

  const selected =
    scenarioFilter === undefined
      ? LOCOMOTION_SCENARIOS
      : LOCOMOTION_SCENARIOS.filter((s) => s.id.toLowerCase().includes(scenarioFilter));

  if (selected.length === 0) {
    throw new Error(`no locomotion scenarios matched '${scenarioFilter ?? ''}'`);
  }

  const outDir = path.join(EVAL_ROOT, 'reports', 'locomotion', tag);
  mkdirSync(outDir, { recursive: true });

  const reports: ScenarioReport[] = [];
  const svgs = new Map<string, string>();

  console.log(`Running locomotion eval suite (tag=${tag}, scenarios=${selected.length})...`);
  console.log(
    `${pad('Scenario', 26)} ${pad('Arr', 6)} ${pad('Settle', 9)} ${pad('Stretch', 11)} ${pad('JitP95', 8)} ${pad('Flip', 6)} ${pad('Gap(Split)', 12)} ${pad('Stall', 7)} ${pad('Flux/80%', 10)} ${pad('SimMs', 7)}`,
  );

  for (const spec of selected) {
    const output = spec.run();
    const metrics = computeScenarioMetrics(spec, output);
    const svg = renderScenarioSvg(spec, output, metrics);
    svgs.set(spec.id, svg);
    writeFileSync(path.join(outDir, `${spec.id}.svg`), svg, 'utf8');

    const report: ScenarioReport = {
      id: spec.id,
      title: spec.title,
      description: spec.description,
      ticks: spec.ticks,
      hash: output.hash,
      simMs: output.simMs,
      metrics,
    };
    reports.push(report);

    const arrStr = `${(metrics.arrivedRatio * 100).toFixed(0)}%`;
    const settleStr =
      metrics.settlingTicks === null
        ? '-'
        : `${metrics.settlingTicks}t${metrics.settled ? '' : '*'}`;
    const stretchStr = `${metrics.stretchMean.toFixed(2)}/${metrics.stretchP95.toFixed(2)}`;
    const jitStr = `${metrics.jitterP95Deg.toFixed(1)}°`;
    const flipStr = `${(metrics.sharpFlipRate * 100).toFixed(1)}%`;
    const gapStr = `${metrics.maxBranchGapCells.toFixed(2)}${metrics.splitDetected ? '!' : ''}`;
    const stallStr = `${(metrics.stallRatio * 100).toFixed(1)}%`;
    const extraStr =
      metrics.chokepointFluxPer100Ticks !== null
        ? `${metrics.chokepointFluxPer100Ticks.toFixed(1)}/100t`
        : metrics.ticksTo80PctFiring !== null
          ? `${metrics.ticksTo80PctFiring}t@${((metrics.everFiredRatio ?? 0) * 100).toFixed(0)}%`
          : '-';
    console.log(
      `${pad(spec.id, 26)} ${pad(arrStr, 6)} ${pad(settleStr, 9)} ${pad(stretchStr, 11)} ${pad(jitStr, 8)} ${pad(flipStr, 6)} ${pad(gapStr, 12)} ${pad(stallStr, 7)} ${pad(extraStr, 10)} ${output.simMs.toFixed(1)}`,
    );
  }

  const summary: SuiteSummary = {
    tag,
    createdAt: new Date().toISOString(),
    reports,
  };
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  const html = renderDashboardHtml(summary, svgs, baseline);
  writeFileSync(path.join(outDir, 'dashboard.html'), html, 'utf8');
  console.log(`Reports written to ${outDir}`);
}
