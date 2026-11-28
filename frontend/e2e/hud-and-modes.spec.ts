import { expect, test, type Page } from '@playwright/test';

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

async function parseSectorBadge(page: Page): Promise<{ x: number; y: number }> {
  const text =
    (await page.locator('[data-testid="minimap-frame"]').getAttribute('data-sector')) ?? '';
  const match = /^(\d+),(\d+)$/.exec(text.trim());
  if (match === null) {
    throw new Error(`Unexpected sector attribute: ${text}`);
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
  await expect(topRight.locator('[data-cargo]').first()).toBeVisible();
  await expect(topLeft).not.toContainText('运行遥测');

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

  // Backquote toggles DebugPanel in topLeft (below the minimap)
  const topLeft = page.locator('[data-hud-slot="topLeft"]');
  await page.keyboard.press('Backquote');
  await expect(topLeft).toContainText('运行遥测');
  await page.keyboard.press('Backquote');
  await expect(topLeft).not.toContainText('运行遥测');

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
  const topLeftSector = await parseSectorBadge(page);

  await minimapCanvas.click({
    position: { x: Math.floor(box.width - 14), y: Math.floor(box.height - 14) },
  });
  const bottomRightSector = await parseSectorBadge(page);

  expect(bottomRightSector.x).toBeGreaterThan(topLeftSector.x);
  expect(bottomRightSector.y).toBeGreaterThan(topLeftSector.y);

  // Collapse & expand via the right-rail radar toggle
  const radarToggle = page.getByRole('button', { name: '雷达' });
  await radarToggle.click();
  await expect(minimapCanvas).toBeHidden();
  await radarToggle.click();
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
    const topLeft = page.locator('[data-hud-slot="topLeft"]');
    await expect(topRight.locator('[data-cargo]').first()).toBeVisible();

    // State 1: F1 default
    await page.keyboard.press('F1');
    await expect(page.locator('[data-mode="command"]')).toBeVisible();
    await expect(topLeft).not.toContainText('运行遥测');
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
    await expect(topLeft).toContainText('运行遥测');
    await assertHudBoundsAndNonOverlap(page, `${label} F3+debug`);

    expect(failures).toEqual([]);
  });
}

test('right rail circles stay right-aligned and anchored when the inspector appears', async ({
  page,
}) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await bootAndWaitForTick(page);

  const slot = page.locator('[data-hud-slot="middleRight"]');
  const buttons = slot.getByRole('button');
  await expect(buttons.first()).toBeVisible();

  // Every circle's right edge must sit on the same vertical line.
  const rightEdges = await buttons.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().right),
  );
  expect(rightEdges.length).toBeGreaterThan(1);
  const edge0 = rightEdges[0] ?? 0;
  for (const edge of rightEdges) {
    expect(Math.abs(edge - edge0)).toBeLessThanOrEqual(1);
  }

  const railBefore = await slot.boundingBox();
  expect(railBefore).not.toBeNull();

  // Box-select units -> the inspector card appears in bottomRight; the
  // rail is viewport-anchored and must not move.
  const size = page.viewportSize();
  expect(size).not.toBeNull();
  if (size === null) return;
  await page.mouse.move(size.width * 0.35, size.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(size.width * 0.65, size.height * 0.72, { steps: 8 });
  await page.mouse.up();

  const bottomRight = page.locator('[data-hud-slot="bottomRight"]');
  await expect(bottomRight.locator('> *').first()).toBeVisible();

  const railAfter = await slot.boundingBox();
  expect(railAfter).not.toBeNull();
  if (railAfter === null) return;
  expect(Math.abs(railAfter.y - (railBefore?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs(railAfter.x - (railBefore?.x ?? 0))).toBeLessThanOrEqual(1);

  // Switch to F2 build and box-select main_base to open a tall own_structure
  // InspectorPanel; RightRail shifts cleanly via CSS Grid with zero overlap.
  await page.keyboard.press('F2');
  await expect(page.locator('[data-mode="build"]')).toBeVisible();
  await expect(
    page.locator('[data-hud-slot="bottomCenter"]').getByRole('button', { name: /炮塔/ }),
  ).toBeVisible();
  await page.mouse.move(size.width * 0.35, size.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(size.width * 0.65, size.height * 0.72, { steps: 8 });
  await page.mouse.up();
  await expect(bottomRight).toContainText('主基地');
  await assertHudBoundsAndNonOverlap(page, '1280x720 F2+own_structure');

  expect(failures).toEqual([]);
});

test('800x600 full HUD with InspectorPanel, SquadPanel (bottomCenter), DebugPanel, and KeyGuideRail stays in-bounds and non-overlapping', async ({
  page,
}) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 800, height: 600 });
  await bootAndWaitForTick(page);

  const topLeft = page.locator('[data-hud-slot="topLeft"]');
  const topCenter = page.locator('[data-hud-slot="topCenter"]');
  const middleLeft = page.locator('[data-hud-slot="middleLeft"]');
  const bottomLeft = page.locator('[data-hud-slot="bottomLeft"]');
  const bottomCenter = page.locator('[data-hud-slot="bottomCenter"]');
  const bottomRight = page.locator('[data-hud-slot="bottomRight"]');

  // Phase A: F1 command — multi_own InspectorPanel + SquadPanel (bottomCenter) + DebugPanel + KeyGuideRail
  await page.keyboard.press('F1');
  await expect(page.locator('[data-mode="command"]')).toBeVisible();
  await page.mouse.move(800 * 0.35, 600 * 0.35);
  await page.mouse.down();
  await page.mouse.move(800 * 0.65, 600 * 0.72, { steps: 8 });
  await page.mouse.up();

  await expect(bottomRight.locator('> *').first()).toBeVisible();
  await expect(bottomLeft).toContainText('已选中');
  await expect(bottomCenter.getByRole('button', { name: /\+ 小队/ })).toBeVisible();

  await bottomCenter.getByRole('button', { name: /\+ 小队/ }).click();
  await expect(bottomCenter).toContainText('双击居中视角');

  await page.keyboard.press('Backquote');
  await expect(topLeft).toContainText('运行遥测');
  await page.keyboard.press('KeyK');
  await expect(middleLeft).toContainText('快捷键引导');

  await assertHudBoundsAndNonOverlap(page, '800x600 F1+inspector+squad+debug+keyguide');

  // Phase B: F2 build — tall own_structure (main_base) InspectorPanel + BuildMenu + ToolBanner + DebugPanel + KeyGuideRail
  await page.keyboard.press('F2');
  await expect(page.locator('[data-mode="build"]')).toBeVisible();
  await expect(bottomCenter.getByRole('button', { name: /炮塔/ })).toBeVisible();
  await page.mouse.move(800 * 0.35, 600 * 0.35);
  await page.mouse.down();
  await page.mouse.move(800 * 0.65, 600 * 0.72, { steps: 8 });
  await page.mouse.up();
  await expect(bottomRight).toContainText('主基地');

  await bottomCenter.getByRole('button', { name: /炮塔/ }).click();
  await expect(topCenter).toContainText('放置 炮塔');
  await expect(bottomRight).toContainText('主基地');

  await assertHudBoundsAndNonOverlap(page, '800x600 F2+own_structure+place+debug+keyguide');

  expect(failures).toEqual([]);
});

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

test.describe('en-US HUD layout', () => {
  test.use({ locale: 'en-US' });

  test('800x600 full HUD across F1, F2, and F3 with InspectorPanel, SquadPanel, DebugPanel, KeyGuideRail, and live StockPanel warnings stays in-bounds and non-overlapping', async ({
    page,
  }) => {
    const failures = collectFailures(page);
    await page.setViewportSize({ width: 800, height: 600 });
    await bootAndWaitForTick(page);

    const topLeft = page.locator('[data-hud-slot="topLeft"]');
    const topCenter = page.locator('[data-hud-slot="topCenter"]');
    const topRight = page.locator('[data-hud-slot="topRight"]');
    const middleLeft = page.locator('[data-hud-slot="middleLeft"]');
    const bottomLeft = page.locator('[data-hud-slot="bottomLeft"]');
    const bottomCenter = page.locator('[data-hud-slot="bottomCenter"]');
    const bottomRight = page.locator('[data-hud-slot="bottomRight"]');

    // Phase A: F1 command — multi_own InspectorPanel + SquadPanel (bottomCenter) + DebugPanel + KeyGuideRail
    await page.keyboard.press('F1');
    await expect(page.locator('[data-mode="command"]')).toBeVisible();
    await expect(topLeft.getByRole('tab', { name: /Command/ })).toBeVisible();
    await page.mouse.move(800 * 0.35, 600 * 0.35);
    await page.mouse.down();
    await page.mouse.move(800 * 0.65, 600 * 0.72, { steps: 8 });
    await page.mouse.up();

    await expect(bottomRight.locator('> *').first()).toBeVisible();
    await expect(bottomLeft).toContainText('selected');
    await expect(bottomCenter.getByRole('button', { name: /\+ Squad/ })).toBeVisible();

    await bottomCenter.getByRole('button', { name: /\+ Squad/ }).click();
    await expect(bottomCenter).toContainText('Double-click to center');

    await page.keyboard.press('Backquote');
    await expect(topLeft).toContainText('TELEMETRY');
    await page.keyboard.press('KeyK');
    await expect(middleLeft).toContainText('Key guide');

    const modeTabsBox = await topLeft.locator('> *').first().boundingBox();
    expect(modeTabsBox).not.toBeNull();
    if (modeTabsBox !== null) {
      expect(modeTabsBox.x + modeTabsBox.width).toBeLessThanOrEqual(251);
    }
    await assertHudBoundsAndNonOverlap(page, '800x600 [en-US] F1+inspector+squad+debug+keyguide');

    // Phase B: F2 build — tall Main Base InspectorPanel + BuildMenu + Turret place banner + DebugPanel + KeyGuideRail
    await page.keyboard.press('F2');
    await expect(page.locator('[data-mode="build"]')).toBeVisible();
    await expect(bottomCenter.getByRole('button', { name: /Turret/ })).toBeVisible();
    await page.mouse.move(800 * 0.35, 600 * 0.35);
    await page.mouse.down();
    await page.mouse.move(800 * 0.65, 600 * 0.72, { steps: 8 });
    await page.mouse.up();
    await expect(bottomRight).toContainText('Main Base');

    await bottomCenter.getByRole('button', { name: /Turret/ }).click();
    await expect(topCenter).toContainText('Placing Turret');
    await expect(bottomRight).toContainText('Main Base');

    await assertHudBoundsAndNonOverlap(
      page,
      '800x600 [en-US] F2+own_structure+place+debug+keyguide',
    );

    // Phase C: Trigger live StockPanel .warnings while Main Base InspectorPanel is pinned in colRight
    await topCenter.getByRole('tab', { name: '×3' }).click();
    await page.keyboard.down('Shift');
    for (const fx of [0.35, 0.41, 0.47, 0.53, 0.59, 0.65]) {
      for (const fy of [0.32, 0.38]) {
        await page.mouse.click(800 * fx, 600 * fy);
      }
    }
    await page.keyboard.up('Shift');
    await page.keyboard.press('Escape');

    await page.mouse.move(800 * 0.31, 600 * 0.28);
    await page.mouse.down();
    await page.mouse.move(800 * 0.69, 600 * 0.42, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.press('KeyG');

    await expect
      .poll(async () => await topRight.locator('[class*="warnItem"]').count(), { timeout: 10_000 })
      .toBeGreaterThan(0);

    // Re-pin Main Base InspectorPanel in bottomRight alongside live StockPanel warnings
    await page.mouse.move(800 * 0.35, 600 * 0.44);
    await page.mouse.down();
    await page.mouse.move(800 * 0.65, 600 * 0.72, { steps: 8 });
    await page.mouse.up();
    await expect(bottomRight).toContainText('Main Base');
    await assertHudBoundsAndNonOverlap(
      page,
      '800x600 [en-US] F2+live_warnings+own_structure+debug+keyguide',
    );
    const colRightBottomOk = await page.evaluate(() => {
      const colRight = document
        .querySelector('[data-hud-slot="bottomRight"]')
        ?.parentElement?.getBoundingClientRect();
      const bottomRightRect = document
        .querySelector('[data-hud-slot="bottomRight"] > *')
        ?.getBoundingClientRect();
      if (colRight === undefined || bottomRightRect === undefined) {
        return false;
      }
      return bottomRightRect.bottom <= colRight.bottom + 1;
    });
    expect(colRightBottomOk).toBe(true);

    // Phase D: F3 logistics — RoadPanel + Road tool banner + InspectorPanel + DebugPanel + KeyGuideRail
    await page.keyboard.press('F3');
    await expect(page.locator('[data-mode="logistics"]')).toBeVisible();
    await expect(bottomCenter.getByRole('button', { name: /Road Tool/ })).toBeVisible();
    await page.keyboard.press('KeyR');
    await expect(topCenter).toContainText('Road tool');
    await expect(middleLeft).toContainText('Logistics Mode (F3)');

    await assertHudBoundsAndNonOverlap(page, '800x600 [en-US] F3+road+inspector+debug+keyguide');

    expect(failures).toEqual([]);
  });

  test('720x560 ModeTabs wrap and SquadPanel pill controls fit inside bottomCenter without overhang', async ({
    page,
  }) => {
    const failures = collectFailures(page);
    await page.setViewportSize({ width: 720, height: 560 });
    await bootAndWaitForTick(page);

    const topLeft = page.locator('[data-hud-slot="topLeft"]');
    const bottomCenter = page.locator('[data-hud-slot="bottomCenter"]');

    await page.keyboard.press('F1');
    await expect(page.locator('[data-mode="command"]')).toBeVisible();
    await expect(topLeft.getByRole('tab', { name: /Command/ })).toBeVisible();

    await page.mouse.move(720 * 0.35, 560 * 0.35);
    await page.mouse.down();
    await page.mouse.move(720 * 0.65, 560 * 0.72, { steps: 8 });
    await page.mouse.up();

    await expect(bottomCenter.getByRole('button', { name: /\+ Squad/ })).toBeVisible();
    await bottomCenter.getByRole('button', { name: /\+ Squad/ }).click();
    await expect(bottomCenter.getByRole('button', { name: 'Disband squad' })).toBeVisible();

    await assertHudBoundsAndNonOverlap(page, '720x560 [en-US] F1+squad');

    const fit = await page.evaluate(() => {
      const modeTabs = document
        .querySelector('[data-hud-slot="topLeft"] > *')
        ?.getBoundingClientRect();
      const topLeftRect = document
        .querySelector('[data-hud-slot="topLeft"]')
        ?.getBoundingClientRect();
      const bottomCenterRect = document
        .querySelector('[data-hud-slot="bottomCenter"]')
        ?.getBoundingClientRect();
      const disbandBtn = document
        .querySelector('[data-hud-slot="bottomCenter"] button[aria-label="Disband squad"]')
        ?.getBoundingClientRect();
      if (
        modeTabs === undefined ||
        topLeftRect === undefined ||
        bottomCenterRect === undefined ||
        disbandBtn === undefined
      ) {
        return { ok: false };
      }
      return {
        ok:
          modeTabs.right <= topLeftRect.right + 0.5 &&
          disbandBtn.right <= bottomCenterRect.right + 0.5,
        modeTabsRight: modeTabs.right,
        topLeftRight: topLeftRect.right,
        disbandRight: disbandBtn.right,
        bottomCenterRight: bottomCenterRect.right,
      };
    });
    expect(fit.ok, JSON.stringify(fit)).toBe(true);

    expect(failures).toEqual([]);
  });
});
