import { _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const directory = mkdtempSync(join(tmpdir(), 'opencookie-overlay-'));
const log = join(directory, 'macros.jsonl');
const env = { ...process.env, OPENCOOKIE_DATA_DIR: directory, OPENCOOKIE_TEST_LOG: log };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  const executablePath = process.env.OPENCOOKIE_PACKAGED_EXECUTABLE;
  const platformArgs = process.platform === 'linux' ? ['--ozone-platform=x11'] : [];
  app = await electron.launch({ ...(executablePath ? { executablePath, args: platformArgs } : { args: [resolve('.'), ...platformArgs] }), env, timeout: 30_000 });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.cookie);
  // A normal launch must show the cookie without requiring a visible tray host.
  await page.waitForFunction(() => document.body.classList.contains('active'));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  // Launching again must not toggle an already-visible cookie off.
  await app.evaluate(({ app }) => app.emit('second-instance', {}, [], process.cwd()));
  await page.waitForTimeout(850);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true, 'Launching again must keep the cookie visible.');
  await page.mouse.move(400,350);
  await page.waitForTimeout(25);
  await page.mouse.move(700,350, { steps: 3 });
  await page.getByRole('status').filter({ hasText: /cookie/i }).waitFor();
  assert.equal(existsSync(log), true);
  assert.equal(readFileSync(log,'utf8').trim().split('\n').length, 1);
  const gift = JSON.parse(readFileSync(log,'utf8').trim());
  assert.match(gift.message, /cookie/i);
  assert.equal((await page.evaluate(() => window.cookie.give())).ok, false, 'Main process must also enforce cooldown.');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const properties = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return { focused: window.isFocused(), alwaysOnTop: window.isAlwaysOnTop(), frame: window.getBounds() };
  });
  assert.equal(properties.focused, false);
  assert.equal(properties.alwaysOnTop, true);
  mkdirSync('validation-results', { recursive: true });
  await page.screenshot({ path: 'validation-results/opencookie-overlay.png', omitBackground: true });
  await page.mouse.click(700,350);
  await page.waitForTimeout(850);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  assert.equal((await page.evaluate(() => window.cookie.give())).ok, false, 'Hidden overlay must not send messages.');
  await app.evaluate(({ app }) => app.emit('second-instance', {}, [], process.cwd()));
  await page.waitForFunction(() => document.body.classList.contains('active'));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true, 'Launching again must restore a dismissed cookie.');
  assert.deepEqual(errors, []);
  await app.close(); app = undefined;
  const args = executablePath ? [...platformArgs, '--tray'] : [resolve('.'), ...platformArgs, '--tray'];
  app = await electron.launch({ ...(executablePath ? { executablePath } : {}), args, env, timeout: 30_000 });
  const trayPage = await app.firstWindow();
  await trayPage.waitForFunction(() => !!window.cookie);
  await trayPage.waitForTimeout(3200);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false, '--tray must preserve background-only startup.');
  console.log(JSON.stringify({ overlay: 'passed', packaged: !!executablePath, visibleAtStartup: true, relaunch: 'passed', trayStartup: 'passed', focusPreserved: true, giftCount: 1, drop: 'passed', nativeTyping: 'replaced by test sink' }));
} finally { if (app) await app.close(); rmSync(directory, { recursive: true, force: true }); }
