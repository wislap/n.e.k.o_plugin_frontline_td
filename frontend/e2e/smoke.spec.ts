// Browser smoke over the production build (static/ via vite preview):
// the app mounts, the sim worker ticks, the WebGL canvas renders more
// than a flat colour, and Space pauses the tick.
//
// The NEKO display SDK script (/plugin-ui-sdk/display.js) is expected
// to 404 outside the plugin host — it is the only tolerated failure.
import { expect, test } from '@playwright/test';

const SDK_404 = '/plugin-ui-sdk/display.js';

test('app boots, sim ticks, canvas renders, pause stops the tick', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.includes(SDK_404)) {
      failures.push(`console.error: ${message.text()}`);
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

  await page.goto('/');

  // App mounted: R3F canvas plus the HUD element carrying the sim tick.
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const tickEl = page.locator('[data-sim-tick]');
  await expect(tickEl).toBeAttached();

  const readTick = async (): Promise<number> =>
    Number((await tickEl.getAttribute('data-sim-tick')) ?? '-1');

  // The worker simulates: the reported tick advances (~20 tps).
  await expect.poll(readTick, { timeout: 15_000 }).toBeGreaterThan(0);
  const before = await readTick();
  await page.waitForTimeout(1500);
  expect(await readTick()).toBeGreaterThan(before);

  // The rendered scene is not a single flat colour: decode the canvas
  // screenshot in the browser and count distinct sampled RGB values.
  const shot = await canvas.screenshot();
  const distinctColors = await page.evaluate(async (b64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${b64}`;
    await image.decode();
    const off = document.createElement('canvas');
    off.width = image.width;
    off.height = image.height;
    const ctx = off.getContext('2d');
    if (ctx === null) {
      return -1;
    }
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    const colors = new Set<number>();
    for (let i = 0; i + 2 < data.length; i += 4 * 997) {
      colors.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
    }
    return colors.size;
  }, shot.toString('base64'));
  expect(distinctColors).toBeGreaterThan(4);

  // Space toggles pause: the tick stops advancing. An in-flight worker
  // update can still bump the tick right after the key press, so wait
  // until the value is stable before sampling `pausedAt`.
  await page.keyboard.press('Space');
  let pausedAt = -1;
  await expect
    .poll(
      async () => {
        const a = await readTick();
        await page.waitForTimeout(300);
        const b = await readTick();
        pausedAt = a === b ? a : -1;
        return pausedAt;
      },
      { timeout: 10_000 },
    )
    .not.toBe(-1);
  await page.waitForTimeout(1500);
  expect(await readTick()).toBe(pausedAt);

  expect(failures).toEqual([]);
});
