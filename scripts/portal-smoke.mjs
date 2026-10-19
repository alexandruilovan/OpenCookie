import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createWaylandKeyboard } from '../dist/src/desktop/wayland.js';
import { PRAISE } from '../dist/src/shared.js';

if (!process.argv.includes('--private-bus')) {
  const child = spawn('dbus-run-session', ['--', process.execPath, fileURLToPath(import.meta.url), '--private-bus'], { stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else {
  const service = spawn('/usr/bin/python3', ['-u', 'test/fixtures/portal.py'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = createInterface({ input: service.stdout });
  const control = (method, ...args) => execFileSync('gdbus', ['call', '--session', '--dest', 'org.freedesktop.portal.Desktop',
    '--object-path', '/org/freedesktop/portal/desktop', '--method', `dev.opencookie.Test.${method}`, ...args], { encoding: 'utf8' });
  const report = () => {
    const output = control('Report');
    // The returned JSON only contains method names, numbers and arrays.
    return JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
  };
  let keyboard;
  const create = () => createWaylandKeyboard(process.env.OPENCOOKIE_PORTAL_HELPER);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test portal did not start. Install python3-gi.')), 5000);
      lines.once('line', line => { clearTimeout(timer); line === 'READY' ? resolve() : reject(new Error(line)); });
      service.once('exit', () => { clearTimeout(timer); reject(new Error('Test portal exited.')); });
    });
    keyboard = create();
    await assert.rejects(keyboard.capture(), /permission/);
    await assert.rejects(keyboard.send('wayland-current', PRAISE[0]), /permission/);
    assert.deepEqual(report().requests, [], 'Sending must never initiate permission or replay a delayed gift.');
    assert.equal(await keyboard.prepare(), true, 'The caller must refocus after the initial permission dialog.');
    assert.deepEqual(report().events, [], 'Approving permission must not inject input.');
    const target = await keyboard.capture();
    assert.equal(await keyboard.prepare(), false, 'Existing permission must not repeat setup.');
    await keyboard.send(target, PRAISE[0]);
    assert.deepEqual(report().selected, [1], 'Only keyboard access may be requested.');
    assert.deepEqual(report().events, [
      [0xffe3, 1], [99, 1], [99, 0], [0xffe3, 0],
      ...[...PRAISE[0]].flatMap(character => [[character.charCodeAt(0), 1], [character.charCodeAt(0), 0]]),
      [0xff0d, 1], [0xff0d, 0]
    ]);
    control('Revoke');
    const requestsBeforeCheck = report().requests;
    await assert.rejects(keyboard.capture(), /permission/);
    assert.deepEqual(report().requests, requestsBeforeCheck, 'A focus check must never reopen permission after the countdown.');
    await assert.rejects(keyboard.send(target, PRAISE[0]), /permission/);
    keyboard.close();

    for (const mode of ['cancel', 'no-keyboard']) {
      control('Mode', mode);
      keyboard = create();
      await assert.rejects(keyboard.prepare(), /permission/);
      await assert.rejects(keyboard.capture(), /permission/);
      await assert.rejects(keyboard.send('wayland-current', PRAISE[0]), /permission/);
      assert.deepEqual(report().events, []);
      keyboard.close();
    }
    control('Mode', 'fail');
    keyboard = create();
    assert.equal(await keyboard.prepare(), true);
    await assert.rejects(keyboard.send(await keyboard.capture(), PRAISE[0]), /delivery failed/);
    assert.equal(report().events.some(([symbol]) => symbol === 0xff0d), false, 'Typing failure must not submit Enter.');
    console.log('Wayland portal protocol passed: permission, refocus, exact macro, cancellation, revocation, keyboard-only access, typing failure. No OS input was sent.');
  } finally { keyboard?.close(); lines.close(); service.kill(); }
}
