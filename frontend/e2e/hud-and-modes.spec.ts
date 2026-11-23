import { expect, test, type Locator, type Page } from '@playwright/test';

const SDK_404 = '/plugin-ui-sdk/display.js';

test.use({ locale: 'zh-CN' });

function collectFailures(page: Page): string[] {
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
  return failures;
}

async function bootAndWaitForTick(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible();
  const tickEl = page.locator('[data-sim-tick]');
  await expect(tickEl).toBeAttached();
  await expect
    .poll(async () => Number((await tickEl.getAttribute('data-sim-tick')) ?? '-1'), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
}

async function parseSectorBadge(minimapPanel: Locator): Promise<{ x: number; y: number }> {
  const badge = minimapPanel.getByText(/^\d+,\d+$/);
  await expect(badge).toBeVisible();
  const text = (await badge.innerText()).trim();
  const match = /^(\d+),(\d+)$/.exec(text);
  if (match === null) {
    throw new Error(`Unexpected sector badge text: ${text}`);
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}

async function waitForLayoutSettle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

async function assertHudBoundsAndNonOverlap(page: Page, contextLabel: string): Promise<void> {
  await waitForLayoutSettle(page);
  const report = await page.evaluate(() => {
    const innerWidth = window.innerWidth;
    const innerHeight = window.innerHeight;
    const scrollWidth = document.documentElement.scrollWidth;
    const scrollHeight = document.documentElement.scrollHeight;

    interface BoxEntry {
      slot: string;
      index: number;
      left: number;
      top: number;
      right: number;
      bottom: number;
      width: number;
      height: number;
    }

    const boxes: BoxEntry[] = [];
    const slots = document.querySelectorAll<HTMLElement>('[data-hud-slot]');
    for (const slotEl of slots) {
      const slotName = slotEl.getAttribute('data-hud-slot') ?? 'unknown';
      const children = Array.from(slotEl.children);
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child === undefined) {
          continue;
        }
        const rect = child.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          boxes.push({
            slot: slotName,
            index: i,
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          });
        }
      }
    }

    const outOfBounds: string[] = [];
    for (const box of boxes) {
      if (
        box.left < -1 ||
        box.top < -1 ||
        box.right > innerWidth + 1 ||
        box.bottom > innerHeight + 1
      ) {
        outOfBounds.push(
          `${box.slot}[${box.index}] (${box.left.toFixed(1)},${box.top.toFixed(1)}..${box.right.toFixed(1)},${box.bottom.toFixed(1)}) outside ${innerWidth}x${innerHeight}`,
        );
      }
    }

    const overlaps: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      if (a === undefined) {
        continue;
      }
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j];
        if (b === undefined) {
          continue;
        }
        const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        const area = ix * iy;
        if (area > 1) {
          overlaps.push(
            `${a.slot}[${a.index}] vs ${b.slot}[${b.index}] overlap area=${area.toFixed(1)}`,
          );
        }
      }
    }

    return {
      innerWidth,
      innerHeight,
      scrollWidth,
      scrollHeight,
      boxCount: boxes.length,
      outOfBounds,
      overlaps,
    };
  });

  expect(report.boxCount, `${contextLabel}: expected visible HUD children`).toBeGreaterThan(0);
  expect(
    report.scrollWidth,
    `${contextLabel}: scrollWidth ${report.scrollWidth} > innerWidth ${report.innerWidth}`,
  ).toBeLessThanOrEqual(report.innerWidth);
  expect(
    report.scrollHeight,
    `${contextLabel}: scrollHeight ${report.scrollHeight} > innerHeight ${report.innerHeight}`,
  ).toBeLessThanOrEqual(report.innerHeight);
  expect(report.outOfBounds, `${contextLabel}: outOfBounds`).toEqual([]);
  expect(report.overlaps, `${contextLabel}: overlaps`).toEqual([]);
}

test('primary modes, auto-tactical camera, view lock, Tab toggle, and pause camera stability', async ({
  page,
}) => {
  const failures = collectFailures(page);
  await bootAndWaitForTick(page);

  const topLeft = page.locator('[data-hud-slot="topLeft"]');
  const middleRight = page.locator('[data-hud-slot="middleRight"]');
  const topCenter = page.locator('[data-hud-slot="topCenter"]');
  const bottomCenter = page.locator('[data-hud-slot="bottomCenter"]');
  const topRight = page.locator('[data-hud-slot="topRight"]');

  // Initial boot state (visual-languages HUD: mode pill + radar top-left,
  // gauge top-center, round tool rail on the right edge).
  await expect(page.locator('[data-mode="command"]')).toBeVisible();
  await expect(middleRight.getByRole('button', { name: /观战视角/ })).toBeVisible();
  const lockBtn = middleRight.getByRole('button', { name: '视角锁定：关' });
  await expect(lockBtn).toBeVisible();
  await expect(lockBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(middleRight.getByRole('button', { name: '快捷键 ›' })).toBeVisible();
  await expect(topLeft.locator('[data-testid="minimap-panel"]')).toBeVisible();
  await expect(topRight).toContainText('仓库');
  await expect(topRight).not.toContainText('运行遥测');

  // Space pause/resume never auto-switches camera (gauge pill top-center)
  await page.keyboard.press('Space');
  await expect(topCenter.getByRole('button', { name: /继续/ })).toBeVisible();
  await expect(middleRight.getByRole('button', { name: /观战视角/ })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(topCenter.getByRole('button', { name: /暂停/ })).toBeVisible();
  await expect(middleRight.getByRole('button', { name: /观战视角/ })).toBeVisible();

  // F2 -> build mode, auto-tactical camera, BuildMenu tabs
  await page.keyboard.press('F2');
  await expect(page.locator('[data-mode="build"]')).toBeVisible();
  await expect(middleRight.getByRole('button', { name: /战术视角/ })).toBeVisible();
  await expect(bottomCenter.getByRole('tab', { name: '全部' })).toBeVisible();
  await expect(bottomCenter.getByRole('tab', { name: '物流' })).toBeVisible();
  await expect(bottomCenter.getByRole('tab', { name: '生产' })).toBeVisible();
  await expect(bottomCenter.getByRole('tab', { name: '军事' })).toBeVisible();
  await expect(bottomCenter.getByRole('button', { name: /拆除/ })).toBeVisible();

  await bottomCenter.getByRole('tab', { name: '军事' }).click();
  await expect(bottomCenter.getByRole('button', { name: /炮塔/ })).toBeVisible();
  await expect(bottomCenter.getByRole('button', { name: /机器人工厂/ })).toBeVisible();
  await expect(bottomCenter.getByRole('button', { name: /采矿机/ })).toHaveCount(0);

  await bottomCenter.getByRole('tab', { name: '全部' }).click();
  await expect(bottomCenter.getByRole('button', { name: /采矿机/ })).toBeVisible();

  // F1 -> command mode, restores spectate camera, BuildMenu unmounts
  await page.keyboard.press('F1');
  await expect(page.locator('[data-mode="command"]')).toBeVisible();
  await expect(middleRight.getByRole('button', { name: /观战视角/ })).toBeVisible();
  await expect(bottomCenter.getByRole('tab', { name: '全部' })).toHaveCount(0);

  // View lock prevents auto-tactical switch on F3, manual Tab still toggles
  await lockBtn.click();
  const lockedBtn = middleRight.getByRole('button', { name: '视角锁定：开' });
  await expect(lockedBtn).toBeVisible();
  await expect(lockedBtn).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('F3');
  await expect(page.locator('[data-mode="logistics"]')).toBeVisible();
  await expect(bottomCenter.getByRole('button', { name: /道路工具/ })).toBeVisible();
  await expect(middleRight.getByRole('button', { name: /观战视角/ })).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(middleRight.getByRole('button', { name: /战术视角/ })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(middleRight.getByRole('button', { name: /观战视角/ })).toBeVisible();

  expect(failures).toEqual([]);
});

test('secondary tools, Esc and right-click exit hierarchy, K/? key guide rail, and backquote debug panel', async ({
  page,
}) => {
  const failures = collectFailures(page);
  await bootAndWaitForTick(page);

  const middleLeft = page.locator('[data-hud-slot="middleLeft"]');
  const middleRight = page.locator('[data-hud-slot="middleRight"]');
  const topCenter = page.locator('[data-hud-slot="topCenter"]');
  const bottomCenter = page.locator('[data-hud-slot="bottomCenter"]');
  const topRight = page.locator('[data-hud-slot="topRight"]');
  const canvas = page.locator('canvas').first();

  // F2 + click Turret card -> place banner -> Esc exits tool, keeps F2 & KeyGuideRail
  await page.keyboard.press('F2');
  await bottomCenter.getByRole('button', { name: /炮塔/ }).click();
  await expect(topCenter).toContainText('放置 炮塔');

  await page.keyboard.press('Escape');
  await expect(topCenter).not.toContainText('放置 炮塔');
  await expect(page.locator('[data-mode="build"]')).toBeVisible();
  await expect(middleRight.getByRole('button', { name: '快捷键 ›' })).toBeVisible();

  // KeyC -> demolish banner -> right-click near center of canvas exits demolish, stays in F2
  await page.keyboard.press('KeyC');
  await expect(topCenter).toContainText('拆除工具');

  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  if (canvasBox !== null) {
    await canvas.click({
      button: 'right',
      position: { x: Math.floor(canvasBox.width / 2), y: Math.floor(canvasBox.height / 2) },
    });
  }
  await expect(topCenter).not.toContainText('拆除工具');
  await expect(page.locator('[data-mode="build"]')).toBeVisible();

  // F3 + KeyR -> road tool banner -> Esc exits
  await page.keyboard.press('F3');
  await page.keyboard.press('KeyR');
  await expect(topCenter).toContainText('道路工具');
  await page.keyboard.press('Escape');
  await expect(topCenter).not.toContainText('道路工具');

  // KeyK expands the collapsed key guide, ? (Shift+Slash) collapses again
  await page.keyboard.press('KeyK');
  await expect(middleLeft).toContainText('快捷键引导');

  await page.keyboard.press('Shift+Slash');
  await expect(middleLeft).not.toContainText('快捷键引导');
  await expect(middleRight.getByRole('button', { name: '快捷键 ›' })).toBeVisible();

  // Backquote toggles DebugPanel in topRight
  await page.keyboard.press('Backquote');
  await expect(topRight).toContainText('运行遥测');
  await page.keyboard.press('Backquote');
  await expect(topRight).not.toContainText('运行遥测');

  expect(failures).toEqual([]);
});

test('minimap sector jump on canvas click and collapse/expand toggle', async ({ page }) => {
  const failures = collectFailures(page);
  await bootAndWaitForTick(page);

  const minimapPanel = page.locator('[data-testid="minimap-panel"]');
  const minimapCanvas = page.locator('[data-testid="minimap-frame"] canvas');
  await expect(minimapPanel).toBeVisible();
  await expect(minimapCanvas).toBeVisible();

  const box = await minimapCanvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) {
    throw new Error('Minimap canvas boundingBox is null');
  }

  await minimapCanvas.click({ position: { x: 14, y: 14 } });
  const topLeftSector = await parseSectorBadge(minimapPanel);

  await minimapCanvas.click({
    position: { x: Math.floor(box.width - 14), y: Math.floor(box.height - 14) },
  });
  const bottomRightSector = await parseSectorBadge(minimapPanel);

  expect(bottomRightSector.x).toBeGreaterThan(topLeftSector.x);
  expect(bottomRightSector.y).toBeGreaterThan(topLeftSector.y);

  // Collapse & expand
  await minimapPanel.getByRole('button', { name: '收起' }).click();
  await expect(minimapCanvas).toBeHidden();
  const expandBtn = minimapPanel.getByRole('button', { name: '雷达 ▲' });
  await expect(expandBtn).toBeVisible();

  await expandBtn.click();
  await expect(minimapCanvas).toBeVisible();

  expect(failures).toEqual([]);
});

// One test per viewport: under CI's software WebGL the three viewports in a
// single test exceeded the 30 s per-test budget.
const HUD_VIEWPORTS = [
  { width: 800, height: 600 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
] as const;

for (const vp of HUD_VIEWPORTS) {
  const label = `${vp.width}x${vp.height}`;
  test(`HUD panels stay in-bounds and non-overlapping at ${label}`, async ({ page }) => {
    const failures = collectFailures(page);
    await page.setViewportSize(vp);
    await bootAndWaitForTick(page);

    const topRight = page.locator('[data-hud-slot="topRight"]');
    const topCenter = page.locator('[data-hud-slot="topCenter"]');
    const bottomCenter = page.locator('[data-hud-slot="bottomCenter"]');
    await expect(topRight).toContainText('仓库');

    // State 1: F1 default
    await page.keyboard.press('F1');
    await expect(page.locator('[data-mode="command"]')).toBeVisible();
    await expect(topRight).not.toContainText('运行遥测');
    await assertHudBoundsAndNonOverlap(page, `${label} F1`);

    // State 2: F2 with Turret place banner active
    await page.keyboard.press('F2');
    await expect(page.locator('[data-mode="build"]')).toBeVisible();
    await bottomCenter.getByRole('button', { name: /炮塔/ }).click();
    await expect(topCenter).toContainText('放置 炮塔');
    await assertHudBoundsAndNonOverlap(page, `${label} F2+place`);

    // State 3: F3 with DebugPanel open
    await page.keyboard.press('F3');
    await expect(page.locator('[data-mode="logistics"]')).toBeVisible();
    await expect(bottomCenter.getByRole('button', { name: /道路工具/ })).toBeVisible();
    await page.keyboard.press('Backquote');
    await expect(topRight).toContainText('运行遥测');
    await assertHudBoundsAndNonOverlap(page, `${label} F3+debug`);

    expect(failures).toEqual([]);
  });
}

test('3D orbital rotation via Q/E and middle-drag updates compass and resets smoothly to North', async ({
  page,
}) => {
  const failures = collectFailures(page);
  await bootAndWaitForTick(page);

  const compass = page.locator('[data-testid="camera-compass"]');
  await expect(compass).toBeVisible();
  await expect(compass).toHaveAttribute('data-compass-deg', '0');

  // Hold KeyE briefly to orbit clockwise away from North.
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyE');
  await expect
    .poll(async () => Number((await compass.getAttribute('data-compass-deg')) ?? '0'))
    .toBeGreaterThan(5);

  const rotatedDeg = Number((await compass.getAttribute('data-compass-deg')) ?? '0');

  // Middle-mouse drag on the canvas orbits smoothly without triggering click/box errors.
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box !== null) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(cx + 80, cy - 25, { steps: 4 });
    await page.mouse.up({ button: 'middle' });
  }
  await expect
    .poll(async () => Number((await compass.getAttribute('data-compass-deg')) ?? '0'))
    .not.toBe(rotatedDeg);

  // Switching to 2D tactical and back preserves the rotated heading.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /战术视角/ })).toBeVisible();
  await expect(compass).not.toHaveAttribute('data-compass-deg', '0');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /观战视角/ })).toBeVisible();

  // Clicking the HUD compass returns yaw to 0° (North); KeyN works the same.
  await compass.click();
  await expect(compass).toHaveAttribute('data-compass-deg', '0');

  await page.keyboard.down('KeyQ');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyQ');
  await expect
    .poll(async () => Math.abs(Number((await compass.getAttribute('data-compass-deg')) ?? '0')))
    .toBeGreaterThan(5);

  await page.keyboard.press('KeyN');
  await expect(compass).toHaveAttribute('data-compass-deg', '0');

  expect(failures).toEqual([]);
});
