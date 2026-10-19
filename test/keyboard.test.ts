import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyboard, type Run, type WindowsKeys } from '../src/desktop/keyboard.js';
import { PRAISE } from '../src/shared.js';

test('Linux restores the captured target and sends Ctrl+C, literal text, then Enter separately', async () => {
  const calls: [string, string[]][] = [], pauses: number[] = [];
  const run: Run = async (command, args) => { calls.push([command, args]); return args[0] === 'getactivewindow' ? '42' : ''; };
  const keys = createKeyboard('linux', run, async ms => { pauses.push(ms); });
  const target = await keys.capture();
  await keys.send(target, PRAISE[0]);
  const actions = calls.filter(([, args]) => args[0] !== 'getactivewindow');
  assert.deepEqual(actions, [
    ['xdotool', ['windowactivate', '--sync', '42']],
    ['xdotool', ['key', '--clearmodifiers', 'ctrl+c']],
    ['xdotool', ['type', '--clearmodifiers', '--delay', '1', '--', PRAISE[0]]],
    ['xdotool', ['key', '--clearmodifiers', 'Return']]
  ]);
  assert.deepEqual(pauses, [300]);
});

test('losing focus during the interrupt delay stops delivery before any text or Enter', async () => {
  let focus = '42'; const actions: string[] = [];
  const run: Run = async (_command, args) => { actions.push(args[0]!); return focus; };
  const keys = createKeyboard('linux', run, async () => { focus = '99'; });
  await assert.rejects(keys.send('42', PRAISE[0]), /Focus changed/);
  assert.equal(actions.includes('type'), false);
  assert.equal(actions.filter(action => action === 'key').length, 1);
});

test('a failed typing command does not submit Enter', async () => {
  const calls: string[][] = [];
  const keys = createKeyboard('linux', async (_cmd, args) => {
    calls.push(args); if (args[0] === 'type') throw new Error('typing failed'); return '42';
  }, async () => {});
  await assert.rejects(keys.send('42', PRAISE[0]), /typing failed/);
  assert.equal(calls.some(args => args.includes('Return')), false);
});

test('macOS targets the captured process and escapes AppleScript text', async () => {
  const scripts: string[] = [];
  const keys = createKeyboard('darwin', async (command, args) => {
    assert.equal(command, 'osascript'); scripts.push(args[1]!); return '73';
  }, async () => {});
  await keys.send(await keys.capture(), 'Great "work" \\ keep going!');
  assert.ok(scripts.some(script => script.includes('unix id is 73 to true')));
  assert.ok(scripts.some(script => script.includes('key code 8 using {control down}')));
  assert.ok(scripts.at(-1)!.includes('keystroke "Great \\"work\\" \\\\ keep going!"\nkey code 36'));
});

test('Windows emits an interrupt, mapped characters with modifiers, then Enter', async () => {
  const events: [number, number][] = [], pauses: number[] = [];
  const native: WindowsKeys = {
    foreground: () => 91n,
    activate: handle => { assert.equal(handle, 91n); return 1; },
    key: (key, _scan, flags) => { events.push([key, flags]); },
    scan: character => character === 65 ? 0x0141 : 0x0242
  };
  const keys = createKeyboard('win32', async () => '', async ms => { pauses.push(ms); }, () => native);
  await keys.send(await keys.capture(), 'Ab');
  assert.deepEqual(events, [[17,0],[67,0],[67,2],[17,2],[16,0],[65,0],[65,2],[16,2],[17,0],[66,0],[66,2],[17,2],[13,0],[13,2]]);
  assert.deepEqual(pauses, [80,300]);
});

test('invalid targets and multiline messages cannot reach native commands', async () => {
  const keys = createKeyboard('linux', async () => { throw new Error('must not run'); });
  await assert.rejects(keys.send('42; echo bad', PRAISE[0]), /No active/);
  await assert.rejects(keys.send('42', 'hello\nexecute'), /Invalid praise/);
});
