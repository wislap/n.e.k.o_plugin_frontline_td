/**
 * shots: deterministic render captures for visual-change diffs.
 *
 * Capture mode (?capture=<preset>, src/client/capture-mode.ts) freezes the
 * animation clock, pins the first snapshot, fixes the match seed and the
 * camera pose, so two runs on the same build must diff at 0%.
 *
 * Usage:
 *   node tooling/shots.ts capture <label>   → .shots/<label>/<preset>.png
 *   node tooling/shots.ts diff <a> <b>      → per-preset mismatch %,
 *                                             .shots/diff-<a>-vs-<b>/*.png
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from '@playwright/test';
import { chromiumGlArgs } from './browser-gl.ts';

const FRONTEND_ROOT = path.resolve(import.meta.dirname, '..');
const SHOTS_ROOT = path.join(FRONTEND_ROOT, '.shots');
const PREVIEW_PORT = 4299;
const BASE_URL = `http://127.0.0.1:${PREVIEW_PORT}`;
const WIDTH = 1920;
const HEIGHT = 1080;
const READY_TIMEOUT_MS = 120_000;
// Wait for a fixed number of rendered frames after the snapshot pin:
// the frame count both converges temporal effects (N8AO accumulation)
// and makes the captured state identical between runs regardless of
// host speed or renderer (SwiftShader vs GPU).
const SETTLE_FRAMES = 60;

// Keep in sync with src/client/capture-mode.ts PRESETS.
const PRESETS = ['open', 'near', 'far', 'build', 'tactical'] as const;

async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(BASE_URL);
    return res.ok;
  } catch {
    return false;
  }
}

function startPreview(): ChildProcess {
  const proc = spawn(
    'npx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PREVIEW_PORT), '--strictPort'],
    { cwd: FRONTEND_ROOT, stdio: 'ignore', shell: true },
  );
  return proc;
}

// Reuse a preview already listening on the shots port when it is the
// same build; spawn (and own the lifetime of) one only when needed.
async function ensurePreview(): Promise<ChildProcess | null> {
  if (await isServerUp()) {
    return null;
  }
  const proc = startPreview();
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isServerUp()) {
      return proc;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error(`preview server at ${BASE_URL} did not start`);
}

async function waitForCaptureReady(page: Page): Promise<number> {
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });
  await page.waitForFunction(
    () => (globalThis as unknown as { __ftdCaptureTick?: number }).__ftdCaptureTick !== undefined,
    undefined,
    { timeout: READY_TIMEOUT_MS },
  );
  const tick = await page.evaluate(
    () => (globalThis as unknown as { __ftdCaptureTick?: number }).__ftdCaptureTick ?? -1,
  );
  await page.waitForFunction(
    (n) => ((globalThis as unknown as { __ftdFrames?: number }).__ftdFrames ?? 0) >= n,
    SETTLE_FRAMES,
    { timeout: READY_TIMEOUT_MS },
  );
  return tick;
}

async function capturePreset(browser: Browser, preset: string, outDir: string): Promise<number> {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  try {
    await page.goto(`${BASE_URL}/?capture=${preset}`);
    const tick = await waitForCaptureReady(page);
    await page.screenshot({ path: path.join(outDir, `${preset}.png`) });
    console.log(`${preset}: captured (pinned tick ${tick})`);
    return tick;
  } finally {
    await page.close();
  }
}

// Minimal browser-side shapes (tooling tsconfig has no DOM lib).
interface BrowserGl {
  RENDERER: number;
  getExtension(name: string): { UNMASKED_RENDERER_WEBGL: number } | null;
  getParameter(param: number): unknown;
}
interface GlBrowserGlobal {
  document: { createElement(tag: string): { getContext(kind: string): BrowserGl | null } };
}

// Record which renderer produced the shots: GPU baselines cannot be
// diffed against SwiftShader captures (different rasterizer).
async function logRenderer(browser: Browser): Promise<void> {
  const page = await browser.newPage();
  try {
    const renderer = await page.evaluate(() => {
      const w = globalThis as unknown as GlBrowserGlobal;
      const gl = w.document.createElement('canvas').getContext('webgl2');
      if (gl === null) {
        return 'no webgl2';
      }
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER;
      return String(gl.getParameter(param));
    });
    console.log(`renderer: ${renderer}`);
  } finally {
    await page.close();
  }
}

function parsePresetFilter(args: string[]): string[] {
  const idx = args.indexOf('--preset');
  if (idx === -1) {
    return [...PRESETS];
  }
  const value = args[idx + 1];
  if (value === undefined) {
    throw new Error('--preset requires a comma-separated list');
  }
  const chosen = value.split(',').map((s) => s.trim());
  for (const p of chosen) {
    if (!(PRESETS as readonly string[]).includes(p)) {
      throw new Error(`unknown preset '${p}' (known: ${PRESETS.join(', ')})`);
    }
  }
  return chosen;
}

async function capture(label: string, presets: string[]): Promise<void> {
  const outDir = path.join(SHOTS_ROOT, label);
  mkdirSync(outDir, { recursive: true });
  const spawned = await ensurePreview();
  const meta: Record<string, number> = {};
  try {
    const browser = await chromium.launch({ args: chromiumGlArgs() });
    try {
      await logRenderer(browser);
      const ticks = await Promise.all(
        presets.map((preset) =>
          capturePreset(browser, preset, outDir).then((t) => [preset, t] as const),
        ),
      );
      for (const [preset, tick] of ticks) {
        meta[preset] = tick;
      }
    } finally {
      await browser.close();
    }
  } finally {
    spawned?.kill();
  }
  writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`shots: wrote ${presets.length} presets to ${outDir}`);
}

interface DiffResult {
  mismatchPct: number;
  diffPng: string;
}

// Minimal browser-side shapes for the page.evaluate bodies (tooling
// tsconfig has no DOM lib; this code runs inside the page).
interface Pix {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
interface BrowserCtx {
  drawImage(img: BrowserImage, x: number, y: number): void;
  getImageData(x: number, y: number, w: number, h: number): Pix;
  createImageData(w: number, h: number): Pix;
  putImageData(d: Pix, x: number, y: number): void;
}
interface BrowserCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): BrowserCtx | null;
  toDataURL(type: string): string;
}
interface BrowserImage {
  width: number;
  height: number;
  src: string;
  decode(): Promise<void>;
}
interface BrowserGlobal {
  document: { createElement(tag: string): BrowserCanvas };
  Image: new () => BrowserImage;
}

async function diffPair(page: Page, fileA: string, fileB: string): Promise<DiffResult> {
  const a = readFileSync(fileA).toString('base64');
  const b = readFileSync(fileB).toString('base64');
  return page.evaluate(
    async (pair: string[]) => {
      const aB64 = pair[0] ?? '';
      const bB64 = pair[1] ?? '';
      const w = globalThis as unknown as BrowserGlobal;
      const decode = async (b64: string): Promise<Pix> => {
        const img = new w.Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = w.document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        if (ctx === null) {
          throw new Error('no 2d context');
        }
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height);
      };
      const ia = await decode(aB64);
      const ib = await decode(bB64);
      if (ia.width !== ib.width || ia.height !== ib.height) {
        return { mismatchPct: 100, diffPng: '' };
      }
      const out = w.document.createElement('canvas');
      out.width = ia.width;
      out.height = ia.height;
      const octx = out.getContext('2d');
      if (octx === null) {
        throw new Error('no 2d context');
      }
      const od = octx.createImageData(ia.width, ia.height);
      let mismatch = 0;
      const total = ia.width * ia.height;
      for (let i = 0; i < ia.data.length; i += 4) {
        const same =
          ia.data[i] === ib.data[i] &&
          ia.data[i + 1] === ib.data[i + 1] &&
          ia.data[i + 2] === ib.data[i + 2] &&
          ia.data[i + 3] === ib.data[i + 3];
        if (!same) {
          mismatch += 1;
          od.data[i] = 255;
          od.data[i + 3] = 255;
        } else {
          const g = ia.data[i] ?? 0;
          od.data[i] = g;
          od.data[i + 1] = g;
          od.data[i + 2] = g;
          od.data[i + 3] = 40;
        }
      }
      octx.putImageData(od, 0, 0);
      return { mismatchPct: (mismatch / total) * 100, diffPng: out.toDataURL('image/png') };
    },
    [a, b],
  );
}

async function diff(labelA: string, labelB: string): Promise<void> {
  const dirA = path.join(SHOTS_ROOT, labelA);
  const dirB = path.join(SHOTS_ROOT, labelB);
  if (!existsSync(dirA) || !existsSync(dirB)) {
    throw new Error(`missing label dir under ${SHOTS_ROOT}: ${labelA} or ${labelB}`);
  }
  const outDir = path.join(SHOTS_ROOT, `diff-${labelA}-vs-${labelB}`);
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: chromiumGlArgs() });
  let worst = 0;
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    const presets = readdirSync(dirA).filter((f) => f.endsWith('.png'));
    for (const file of presets) {
      const preset = path.basename(file, '.png');
      const fileB = path.join(dirB, file);
      if (!existsSync(fileB)) {
        console.log(`${preset}: missing in '${labelB}'`);
        worst = 100;
        continue;
      }
      const r = await diffPair(page, path.join(dirA, file), fileB);
      worst = Math.max(worst, r.mismatchPct);
      if (r.diffPng !== '') {
        const png = Buffer.from(r.diffPng.split(',')[1] ?? '', 'base64');
        writeFileSync(path.join(outDir, `${preset}.diff.png`), png);
      }
      console.log(`${preset}: ${r.mismatchPct.toFixed(4)}% pixels differ`);
    }
  } finally {
    await browser.close();
  }
  if (worst > 0) {
    console.log(`shots:diff FAILED — worst mismatch ${worst.toFixed(4)}% (diffs in ${outDir})`);
    process.exit(1);
  }
  console.log(`shots:diff OK — ${labelA} vs ${labelB} identical`);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'capture' && args.length >= 1) {
  await capture(args[0] ?? '', parsePresetFilter(args.slice(1)));
} else if (command === 'diff' && args.length === 2) {
  await diff(args[0] ?? '', args[1] ?? '');
} else {
  console.error('usage: shots.ts capture <label> [--preset a,b] | shots.ts diff <a> <b>');
  process.exit(2);
}
