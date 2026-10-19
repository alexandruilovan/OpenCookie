// Linux-only end-to-end check: real xdotool input goes to an isolated test window.
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createKeyboard } from '../dist/src/desktop/keyboard.js';
import { PRAISE } from '../dist/src/shared.js';

assert.equal(process.platform, 'linux', 'This native smoke check requires Linux/X11 and xdotool.');
const directory = mkdtempSync(join(tmpdir(), 'opencookie-keyboard-'));
const env = { ...process.env, OPENCOOKIE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.OPENCOOKIE_TEST_LOG;
let app;
try {
  app = await electron.launch({ args: [resolve('.'), '--ozone-platform=x11', '--tray'], env, timeout: 30_000 });
  app.process().stderr.on('data', chunk => process.stderr.write(chunk));
  const overlay = await app.firstWindow();
  await overlay.waitForFunction(() => !!window.cookie);
  const id = await app.evaluate(async ({ BrowserWindow }) => {
    const target = new BrowserWindow({ title: 'OpenCookie controlled keyboard test', width: 800, height: 500,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    await target.loadURL('data:text/html,' + encodeURIComponent(`<!doctype html><title>OpenCookie controlled keyboard test</title>
      <h1>Controlled keyboard test</h1><textarea id="terminal" autofocus rows="10" cols="70"></textarea>
      <script>window.keys=[];document.addEventListener('keydown',e=>{
        if(e.ctrlKey&&e.key==='c'){window.keys.push('interrupt');e.preventDefault();}
        if(e.key==='Enter'){window.keys.push('submit');e.preventDefault();}
      });</script>`));
    target.show(); target.focus(); target.webContents.focus();
    return target.getNativeWindowHandle().readUInt32LE(0).toString();
  });
  const terminal = app.windows().find(window => window !== overlay);
  assert.ok(terminal);
  // Abort before sending anything unless our exact fixture owns keyboard focus.
  execFileSync('xdotool', ['windowactivate', '--sync', id], { timeout: 4000 });
  assert.equal(await createKeyboard().capture(), id);
  await app.evaluate(({ app }) => app.emit('second-instance', {}, [], process.cwd()));
  await overlay.waitForFunction(() => document.body.classList.contains('active'));
  assert.equal(await createKeyboard().capture(), id);
  assert.equal(execFileSync('xdotool', ['getwindowfocus'], { encoding: 'utf8' }).trim(), id);
  await overlay.waitForTimeout(550);
  await overlay.mouse.move(400,350);
  await overlay.waitForTimeout(25);
  await overlay.mouse.move(700,350, { steps: 3 });
  await terminal.waitForFunction(() => window.keys.includes('submit'), undefined, { timeout: 10_000 });
  const result = await terminal.evaluate(() => ({ keys: window.keys, text: document.querySelector('#terminal').value }));
  assert.deepEqual(result.keys, ['interrupt','submit']);
  assert.ok(PRAISE.includes(result.text), `Expected a complete praise phrase, got ${JSON.stringify(result.text)}`);
  console.log(JSON.stringify({ nativeLinuxKeyboard: 'passed', target: 'controlled test window', sequence: result.keys, message: result.text }));
} catch (error) {
  if (app) for (const window of app.windows()) console.error(await window.evaluate(() => ({ title: document.title, status: document.querySelector('#message')?.textContent, keys: window.keys, text: document.querySelector('textarea')?.value })).catch(() => 'Window closed'));
  throw error;
} finally { if (app) await app.close(); rmSync(directory, { recursive: true, force: true }); }
