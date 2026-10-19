import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = { gifts: 0, hides: 0, fail: false, countdown: (_seconds: number) => {}, spawn: (_data: unknown) => {}, drop: () => {}, stop: () => {} };
    (window as any).fixture = state;
    (window as any).cookie = {
      onCountdown: (fn: typeof state.countdown) => { state.countdown = fn; },
      onSpawn: (fn: typeof state.spawn) => { state.spawn = fn; },
      onDrop: (fn: typeof state.drop) => { state.drop = fn; },
      onHide: (fn: typeof state.stop) => { state.stop = fn; },
      give: async () => { state.gifts++; return state.fail ? { ok: false, message: 'Keyboard feedback needs xdotool and an X11 agent terminal.' } : { ok: true, message: "Here's a cookie! Great work - keep it up." }; },
      hide: () => { state.hides++; }
    };
  });
  await page.goto('/renderer/index.html');
  await page.evaluate(() => (window as any).fixture.spawn({ x: 500, y: 400, sound: false }));
});

async function flick(page: Page): Promise<void> {
  await page.waitForTimeout(550);
  await page.mouse.move(400,400);
  await page.waitForTimeout(25);
  await page.mouse.move(700,400, { steps: 3 });
}

test('flick tosses a cookie, shows praise, and debounces a second flick', async ({ page }) => {
  await flick(page);
  await expect(page.getByRole('status')).toContainText('Great work');
  await page.mouse.move(300,400, { steps: 3 });
  expect(await page.evaluate(() => (window as any).fixture.gifts)).toBe(1);
  await page.screenshot({ path: 'test-results/opencookie-overlay.png', omitBackground: true });
});
test('click drops the cookie without sending praise and the next spawn works', async ({ page }) => {
  await page.mouse.click(500,400);
  await expect.poll(() => page.evaluate(() => (window as any).fixture.hides)).toBe(1);
  expect(await page.evaluate(() => (window as any).fixture.gifts)).toBe(0);
  await page.evaluate(() => (window as any).fixture.spawn({ x:500,y:400,sound:false }));
  await flick(page);
  await expect(page.getByRole('status')).toContainText('Great work');
});
test('delivery failures show the real problem', async ({ page }) => {
  await page.evaluate(() => { (window as any).fixture.fail = true; });
  await flick(page);
  await expect(page.getByRole('status')).toContainText('needs xdotool');
  await expect(page.getByRole('status')).toHaveClass('error');
});
test('Escape hides the overlay without giving a cookie', async ({ page }) => {
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).fixture.hides)).toBe(1);
  expect(await page.evaluate(() => (window as any).fixture.gifts)).toBe(0);
  await expect(page.locator('body')).not.toHaveClass('active');
});

test('permission errors remain visible until the cookie is dismissed', async ({ page }) => {
  await page.evaluate(() => (window as any).fixture.spawn({ x:500, y:400, sound:false,
    error:'Keyboard permission was cancelled. Pick up a new cookie to retry.' }));
  await page.waitForTimeout(6500);
  await expect(page.getByRole('status')).toContainText('permission was cancelled');
  expect(await page.evaluate(() => (window as any).fixture.gifts)).toBe(0);
});

test('countdown does not send or drop cookies; the first ready cookie can send', async ({ page }) => {
  await page.evaluate(() => (window as any).fixture.countdown(5));
  await expect(page.getByRole('status')).toContainText('Cookie ready in 5');
  await page.mouse.click(500,400);
  await flick(page);
  expect(await page.evaluate(() => (window as any).fixture.gifts)).toBe(0);
  expect(await page.evaluate(() => (window as any).fixture.hides)).toBe(0);
  await page.evaluate(() => (window as any).fixture.spawn({ x:500, y:400, sound:false }));
  await flick(page);
  await expect(page.getByRole('status')).toContainText('Great work');
});

test('Escape cancels the countdown', async ({ page }) => {
  await page.evaluate(() => (window as any).fixture.countdown(5));
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).fixture.hides)).toBe(1);
  await expect(page.locator('body')).not.toHaveClass('countdown');
  await expect(page.locator('#message')).toBeEmpty();
});
