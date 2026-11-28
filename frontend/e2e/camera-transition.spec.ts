import { expect, test, type Locator, type Page } from '@playwright/test';

const SDK_404 = '/plugin-ui-sdk/display.js';
const TRANSITION_SETTLE_MS = 550;
const TRANSITION_SAMPLE_WINDOW_MS = 450;
const TRANSITION_SAMPLE_COUNT = 6;
const MAX_ALLOWED_MEAN_LUMINANCE = 205;
const MAX_LUMINANCE_SPIKE = 60;

test.use({ locale: 'zh-CN' });

interface FrameMetrics {
  meanLuminance: number;
  topBandLuminance: number;
  distinctColors: number;
}

function collectFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    const text = message.text();
    if (
      (message.type() === 'error' && !message.location().url.includes(SDK_404)) ||
      text.includes('ShaderCompileError')
    ) {
      failures.push(`console.${message.type()}: ${text}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (!request.url().includes(SDK_404)) {
      failures.push(`requestfailed: ${request.url()}`);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().includes(SDK_404)) {
      failures.push(`http ${response.status()}: ${response.url()}`);
    }
  });
  return failures;
}

async function bootAndWaitForScene(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');

  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();

  const tickEl = page.locator('[data-sim-tick]');
  await expect(tickEl).toBeAttached();
  await expect
    .poll(async () => Number((await tickEl.getAttribute('data-sim-tick')) ?? '-1'), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  return canvas;
}

async function analyzePngFrames(page: Page, buffers: readonly Buffer[]): Promise<FrameMetrics[]> {
  const b64List = buffers.map((buf) => buf.toString('base64'));
  return page.evaluate(async (encodedFrames) => {
    const off = document.createElement('canvas');
    const ctx = off.getContext('2d');
    if (ctx === null) {
      return encodedFrames.map(() => ({
        meanLuminance: -1,
        topBandLuminance: -1,
        distinctColors: -1,
      }));
    }

    const results: FrameMetrics[] = [];
    for (const b64 of encodedFrames) {
      const image = new Image();
      image.src = `data:image/png;base64,${b64}`;
      await image.decode();

      if (off.width !== image.width || off.height !== image.height) {
        off.width = image.width;
        off.height = image.height;
      }
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, off.width, off.height);

      let lumSum = 0;
      let sampleCount = 0;
      const colors = new Set<number>();

      // Sample every 16th pixel (~57k pixels at 1280x720) for accurate mean luminance.
      for (let i = 0; i + 2 < data.length; i += 4 * 16) {
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        lumSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sampleCount += 1;
        if (sampleCount % 64 === 0) {
          colors.add((r << 16) | (g << 8) | b);
        }
      }

      // Measure top 22% horizon band luminance (every 8th pixel) to catch far-distance white wash.
      let topLumSum = 0;
      let topCount = 0;
      const topBandLimit = Math.floor(off.height * 0.22) * off.width * 4;
      for (let i = 0; i + 2 < topBandLimit && i + 2 < data.length; i += 4 * 8) {
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        topLumSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        topCount += 1;
      }

      results.push({
        meanLuminance: sampleCount > 0 ? lumSum / sampleCount : -1,
        topBandLuminance: topCount > 0 ? topLumSum / topCount : -1,
        distinctColors: colors.size,
      });
    }
    return results;
  }, b64List);
}

async function sampleTransitionFrames(
  page: Page,
  canvas: Locator,
  targetButton: Locator,
): Promise<FrameMetrics[]> {
  const transitionShots: Buffer[] = [];
  const startedAt = Date.now();
  await page.keyboard.press('Tab');
  await expect(targetButton).toBeVisible();

  for (let i = 0; i < TRANSITION_SAMPLE_COUNT; i++) {
    transitionShots.push(await canvas.screenshot({ animations: 'allow' }));
    if (i + 1 < TRANSITION_SAMPLE_COUNT) {
      const targetElapsedMs = ((i + 1) * TRANSITION_SAMPLE_WINDOW_MS) / TRANSITION_SAMPLE_COUNT;
      const remainingMs = targetElapsedMs - (Date.now() - startedAt);
      if (remainingMs > 0) {
        await page.waitForTimeout(remainingMs);
      }
    }
  }

  await page.waitForTimeout(TRANSITION_SETTLE_MS);
  return analyzePngFrames(page, transitionShots);
}

function assertTransitionFramesClean(
  label: string,
  frames: FrameMetrics[],
  maxBaselineMeanLum: number,
  maxBaselineTopBandLum: number,
): void {
  expect(frames).toHaveLength(TRANSITION_SAMPLE_COUNT);
  for (const [idx, frame] of frames.entries()) {
    expect(frame.distinctColors, `${label} frame ${idx} should not be flat`).toBeGreaterThan(4);
    expect(
      frame.meanLuminance,
      `${label} frame ${idx} luminance=${frame.meanLuminance.toFixed(1)} flashed white`,
    ).toBeLessThan(MAX_ALLOWED_MEAN_LUMINANCE);
    expect(
      frame.meanLuminance,
      `${label} frame ${idx} spiked above baselines (${maxBaselineMeanLum.toFixed(1)})`,
    ).toBeLessThanOrEqual(maxBaselineMeanLum + MAX_LUMINANCE_SPIKE);
    expect(
      frame.topBandLuminance,
      `${label} frame ${idx} far horizon washed white (${frame.topBandLuminance.toFixed(1)} > ${(maxBaselineTopBandLum + 12).toFixed(1)})`,
    ).toBeLessThanOrEqual(maxBaselineTopBandLum + 12);
  }
}

test('3D <-> 2D camera transitions never flash white and survive mid-transition reversal', async ({
  page,
}) => {
  const failures = collectFailures(page);
  const canvas = await bootAndWaitForScene(page);
  const middleRight = page.locator('[data-hud-slot="middleRight"]');

  // Initial state: 3D spectate view is active and rendering a non-flat scene.
  await expect(middleRight.getByRole('button', { name: /观战视角/ })).toBeVisible();
  const baseline3dShot = await canvas.screenshot({ animations: 'allow' });
  const [baseline3d] = await analyzePngFrames(page, [baseline3dShot]);
  expect(baseline3d).toBeDefined();
  if (baseline3d === undefined) {
    throw new Error('Missing baseline 3D frame metrics');
  }
  expect(baseline3d.distinctColors).toBeGreaterThan(4);
  expect(baseline3d.meanLuminance).toBeGreaterThanOrEqual(0);
  expect(baseline3d.meanLuminance).toBeLessThan(MAX_ALLOWED_MEAN_LUMINANCE);

  // Switch 3D -> 2D tactical while sampling frames across the transition window.
  const forwardMetrics = await sampleTransitionFrames(
    page,
    canvas,
    middleRight.getByRole('button', { name: /战术视角/ }),
  );

  const baseline2dShot = await canvas.screenshot({ animations: 'allow' });
  const [baseline2d] = await analyzePngFrames(page, [baseline2dShot]);
  expect(baseline2d).toBeDefined();
  if (baseline2d === undefined) {
    throw new Error('Missing baseline 2D frame metrics');
  }
  expect(baseline2d.distinctColors).toBeGreaterThan(4);
  expect(baseline2d.meanLuminance).toBeGreaterThanOrEqual(0);
  expect(baseline2d.meanLuminance).toBeLessThan(MAX_ALLOWED_MEAN_LUMINANCE);

  const maxBaselineMeanLum = Math.max(baseline3d.meanLuminance, baseline2d.meanLuminance);
  const maxBaselineTopBandLum = Math.max(baseline3d.topBandLuminance, baseline2d.topBandLuminance);
  assertTransitionFramesClean('3D->2D', forwardMetrics, maxBaselineMeanLum, maxBaselineTopBandLum);

  // Switch 2D -> 3D and rapidly capture 6 frames across the ~450ms transition window.
  const returnMetrics = await sampleTransitionFrames(
    page,
    canvas,
    middleRight.getByRole('button', { name: /观战视角/ }),
  );
  assertTransitionFramesClean('2D->3D', returnMetrics, maxBaselineMeanLum, maxBaselineTopBandLum);

  // Rapid mid-transition double-Tab reversal: 3D -> 150ms -> 3D -> settle 550ms.
  await page.keyboard.press('Tab');
  await expect(middleRight.getByRole('button', { name: /战术视角/ })).toBeVisible();
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab');
  await expect(middleRight.getByRole('button', { name: /观战视角/ })).toBeVisible();
  await page.waitForTimeout(TRANSITION_SETTLE_MS);

  const reversedShot = await canvas.screenshot({ animations: 'allow' });
  const [reversedMetrics] = await analyzePngFrames(page, [reversedShot]);
  expect(reversedMetrics).toBeDefined();
  if (reversedMetrics === undefined) {
    throw new Error('Missing reversed frame metrics');
  }
  expect(reversedMetrics.distinctColors).toBeGreaterThan(4);
  expect(reversedMetrics.meanLuminance).toBeLessThan(MAX_ALLOWED_MEAN_LUMINANCE);

  for (const failure of failures) {
    expect(failure).not.toContain('ShaderCompileError');
  }
  expect(failures).toEqual([]);
});
