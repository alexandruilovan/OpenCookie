// A private fake portal exercises the real Wayland helper and Electron UI.
// Keyboard events go only to the fixture, never to the desktop or an agent.
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron, expect } from '@playwright/test';

if (!process.argv.includes('--private-bus')) {
  const child = spawn('dbus-run-session', ['--', process.execPath, fileURLToPath(import.meta.url), '--private-bus'], { stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else {
  const directory = mkdtempSync(join(tmpdir(), 'opencookie-wayland-ui-'));
  const service = spawn('/usr/bin/python3', ['-u', 'test/fixtures/portal.py'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = createInterface({ input: service.stdout });
  const control = (method, ...args) => execFileSync('gdbus', ['call', '--session', '--dest', 'org.freedesktop.portal.Desktop',
    '--object-path', '/org/freedesktop/portal/desktop', '--method', `dev.opencookie.Test.${method}`, ...args], { encoding: 'utf8' });
  const report = () => {
    const output = control('Report');
    return JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
  };
  let app;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test portal did not start. Install python3-gi.')), 5000);
      lines.once('line', line => { clearTimeout(timer); line === 'READY' ? resolve() : reject(new Error(line)); });
      service.once('exit', () => { clearTimeout(timer); reject(new Error('Test portal exited.')); });
    });
    const env = { ...process.env, XDG_SESSION_TYPE: 'wayland', OPENCOOKIE_DATA_DIR: directory };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.OPENCOOKIE_TEST_LOG;
    const executablePath = process.env.OPENCOOKIE_PACKAGED_EXECUTABLE;
    const args = ['--ozone-platform=x11', '--tray'];
    app = await electron.launch({ ...(executablePath ? { executablePath, args } : { args: [resolve('.'), ...args] }), env, timeout: 30_000 });
    const overlay = await app.firstWindow();
    await overlay.waitForFunction(() => !!window.cookie);
    // The input beneath the countdown proves native clicks pass through.
    await app.evaluate(async ({ BrowserWindow }) => {
      const fixture = new BrowserWindow({ x: 100, y: 100, width: 500, height: 400, frame: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
      await fixture.loadURL('data:text/html,' + encodeURIComponent('<title>Controlled countdown test</title><input id="target" style="position:fixed;inset:0;width:100%;height:100%">'));
      fixture.show();
    });
    const fixture = app.windows().find(page => page !== overlay);
    assert.ok(fixture);
    const pickUp = () => app.evaluate(({ app }) => app.emit('second-instance', {}, [], process.cwd()));
    await pickUp();
    await expect(overlay.getByRole('status')).toContainText('Cookie ready in 5');
    assert.equal((await overlay.evaluate(() => window.cookie.give())).ok, false, 'Countdown must block delivery in the main process.');
    assert.deepEqual(report().events, [], 'Granting permission cannot send a gift.');
    execFileSync('xdotool', ['mousemove', '--sync', '200', '200', 'click', '1'], { timeout: 4000 });
    await fixture.waitForFunction(() => document.activeElement?.id === 'target');
    await overlay.waitForFunction(() => document.body.classList.contains('active'));
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'OpenCookie').isFocused()), false);
    await overlay.waitForTimeout(550);
    await overlay.mouse.move(400,350);
    await overlay.waitForTimeout(25);
    await overlay.mouse.move(700,350, { steps: 3 });
    await expect(overlay.getByRole('status')).toContainText(/cookie/i);
    const first = report();
    assert.equal(first.requests.filter(name => name === 'Start').length, 1, 'The first pickup must work without repeating permission or picking up another cookie.');
    assert.equal(first.events.filter(([symbol, state]) => symbol === 0xff0d && state === 1).length, 1, 'The first cookie must submit exactly once.');

    await overlay.evaluate(() => window.cookie.hide());
    await overlay.waitForFunction(() => !document.body.classList.contains('active'));
    await pickUp();
    await expect(overlay.getByRole('status')).toContainText('Cookie ready in 3');
    // Escape cancels the same timer that will otherwise enable the cookie.
    await overlay.keyboard.press('Escape');
    await overlay.waitForTimeout(3400);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'OpenCookie').isVisible()), false);
    assert.deepEqual(report().events, first.events, 'Cancelling a countdown cannot replay a gift.');

    // Revocation while choosing input must fail, not open a surprise prompt.
    await pickUp();
    await expect(overlay.getByRole('status')).toContainText('Cookie ready in 3');
    control('Revoke');
    await expect(overlay.getByRole('status')).toContainText('permission is no longer active');
    assert.equal((await overlay.evaluate(() => window.cookie.give())).ok, false);
    assert.equal(report().requests.filter(name => name === 'Start').length, 1);
    assert.deepEqual(report().events, first.events);
    console.log('Wayland desktop flow passed: first-cookie delivery, click-through countdown, focus preserved, no input during setup, cancellation, revocation. All keyboard events stayed on the private fake portal.');
  } finally {
    if (app) await app.close();
    lines.close(); service.kill(); rmSync(directory, { recursive: true, force: true });
  }
}
