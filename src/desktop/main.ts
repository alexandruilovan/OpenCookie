import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { COOLDOWN_MS, GRACE_MS, PRAISE, type GiftResult } from '../shared.js';
import { createKeyboard, keyboardError } from './keyboard.js';
import { createWaylandKeyboard, isWayland } from './wayland.js';
import { setTimeout as delay } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const page = pathToFileURL(join(here, '../renderer/index.html')).href;
const keyboard = isWayland() ? createWaylandKeyboard() : createKeyboard();
let overlay: BrowserWindow;
let tray: Tray;
let target = '';
let captureError: string | undefined;
let opening = false;
let pickupGeneration = 0;
let busy = false;
let sound = true;
let shownAt = 0;
let lastGift = -Infinity;
// A test-only sink makes native overlay checks incapable of typing into apps.
const testLog = process.env.OPENCOOKIE_TEST_LOG;
let showOnReady = process.argv.includes('--show') || !process.argv.includes('--tray');

function hide(): void {
  if (!overlay || overlay.isDestroyed()) return;
  pickupGeneration++;
  overlay.hide();
  overlay.setIgnoreMouseEvents(false);
  overlay.webContents.send('cookie:stop');
  target = '';
  globalShortcut.unregister('Escape');
}
function drop(): void { overlay.webContents.send('cookie:drop'); }

function placeOverlay(): Electron.Point {
  const pointer = screen.getCursorScreenPoint();
  const { bounds } = screen.getDisplayNearestPoint(pointer);
  overlay.setBounds(bounds);
  return { x: pointer.x - bounds.x, y: pointer.y - bounds.y };
}

async function focusCountdown(seconds: number, generation: number): Promise<void> {
  console.log(`OpenCookie: click your agent's terminal prompt or empty chat message box. Cookie ready in ${seconds} seconds.`);
  placeOverlay();
  // Clicks must reach the application underneath while the user selects input.
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.showInactive();
  globalShortcut.register('Escape', hide);
  for (let remaining = seconds; remaining > 0 && generation === pickupGeneration; remaining--) {
    overlay.webContents.send('cookie:countdown', remaining);
    await delay(1000);
  }
}

async function pickUp(delayMs = 0): Promise<void> {
  if (opening || busy || overlay.isVisible()) return;
  opening = true;
  const generation = ++pickupGeneration;
  target = '';
  captureError = undefined;
  try {
    try {
      const permissionChanged = testLog ? false : await keyboard.prepare?.();
      if (generation !== pickupGeneration) return;
      if (permissionChanged) console.log('OpenCookie: keyboard enabled. Select your agent during the countdown.');
      const seconds = permissionChanged ? 5 : Math.ceil(delayMs / 1000);
      if (seconds) await focusCountdown(seconds, generation);
      if (generation !== pickupGeneration) return;
      const captured = testLog ? '1' : await keyboard.capture();
      if (generation !== pickupGeneration) return;
      target = captured;
    } catch (error) {
      if (generation !== pickupGeneration) return;
      target = ''; captureError = keyboardError(error); console.warn('OpenCookie:', captureError);
    }
    const pointer = placeOverlay();
    overlay.setIgnoreMouseEvents(false);
    shownAt = Date.now();
    overlay.showInactive();
    overlay.webContents.send('cookie:spawn', { ...pointer, sound, error: captureError });
    globalShortcut.register('Escape', hide);
    if (!captureError) console.log('OpenCookie: cookie ready. Flick to type praise into the focused input.');
  } finally { opening = false; }
}

function toggle(): void {
  if (busy) return;
  if (opening) { if (overlay.isVisible()) hide(); return; }
  if (overlay.isVisible()) drop();
  else void pickUp();
}

function showFromLaunch(): void {
  // A second launch can arrive while the renderer is still loading.
  showOnReady = true;
  if (tray) void pickUp(3000);
}

async function give(): Promise<GiftResult> {
  const now = Date.now();
  if (!overlay.isVisible() || opening || busy || now - shownAt < GRACE_MS || now - lastGift < COOLDOWN_MS) return { ok: false };
  if (!target) {
    const message = captureError || 'Focus your agent\'s input and pick up a new cookie.';
    console.warn('OpenCookie: cookie not sent.', message);
    return { ok: false, message };
  }
  busy = true;
  lastGift = now;
  const message = PRAISE[Math.floor(Math.random() * PRAISE.length)]!;
  try {
    if (testLog) appendFileSync(testLog, JSON.stringify({ target, message }) + '\n');
    else await keyboard.send(target, message);
    console.log('OpenCookie: praise keyboard sequence completed. Check the focused input for the message.');
    return { ok: true, message };
  } catch (error) { const message = keyboardError(error); console.warn('OpenCookie:', message); return { ok: false, message }; }
  finally { busy = false; }
}

async function start(): Promise<void> {
  overlay = new BrowserWindow({
    title: 'OpenCookie', show: false, transparent: true, backgroundColor: '#00000000',
    frame: false, alwaysOnTop: true, focusable: false, skipTaskbar: true,
    resizable: false, movable: false, hasShadow: false,
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlay.webContents.on('will-navigate', event => event.preventDefault());
  overlay.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  overlay.webContents.session.setPermissionCheckHandler(() => false);
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    event.sender === overlay.webContents && event.senderFrame === overlay.webContents.mainFrame && event.senderFrame.url === page;
  ipcMain.handle('cookie:give', event => trusted(event) ? give() : { ok: false });
  ipcMain.on('cookie:hide', event => { if (trusted(event)) hide(); });
  await overlay.loadURL(page);
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'assets/icon.png')).resize({ width: 24, height: 24 });
  tray = new Tray(icon);
  tray.setToolTip('OpenCookie — click to pick up a cookie');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Pick up / put away cookie', click: toggle },
    { label: 'Sound', type: 'checkbox', checked: sound, click: item => { sound = item.checked; } },
    { type: 'separator' },
    { label: 'Quit OpenCookie', click: () => app.quit() }
  ]));
  tray.on('click', toggle);
  Menu.setApplicationMenu(null);
  if (process.platform === 'darwin') app.dock?.hide();
  console.log('OpenCookie is running. Flick to give a cookie; click or press Escape to put it away.');
  console.log('Pick up another cookie from the tray, or launch OpenCookie again.');
  if (isWayland() && !testLog) console.log('Wayland: approve keyboard control if your desktop prompts you, then follow the message on the cookie.');
  if (showOnReady) await pickUp(3000);
  else console.log('Started in the tray (--tray). Click the tray cookie to pick it up.');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(start).catch(error => {
    console.error(error);
    dialog.showErrorBox('OpenCookie could not start', String(error));
    app.quit();
  });
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--show') || !argv.includes('--tray')) showFromLaunch();
  });
  app.on('activate', () => { if (tray) showFromLaunch(); });
}
app.on('window-all-closed', () => {});
app.on('will-quit', () => { globalShortcut.unregisterAll(); keyboard.close?.(); tray?.destroy(); });
