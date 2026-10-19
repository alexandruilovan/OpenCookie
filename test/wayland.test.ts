import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWayland } from '../src/desktop/wayland.js';
import { keyboardError } from '../src/desktop/keyboard.js';

test('Wayland sessions select the portal even though the overlay uses XWayland', () => {
  assert.equal(isWayland('linux', { XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' }), true);
  assert.equal(isWayland('linux', { WAYLAND_DISPLAY: 'wayland-0' }), true);
  assert.equal(isWayland('linux', { XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: 'stale-value' }), false);
  assert.equal(isWayland('win32', { XDG_SESSION_TYPE: 'wayland' }), false);
});
test('permission and missing-tool instructions reach the overlay unchanged', () => {
  assert.match(keyboardError(new Error('spawn xdotool ENOENT')), /xdotool/);
  assert.match(keyboardError(new Error('Keyboard permission was cancelled.')), /cancelled/);
});
