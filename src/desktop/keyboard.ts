import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

export type Run = (command: string, args: string[]) => Promise<string>;
export interface WindowsKeys {
  foreground(): number | bigint;
  activate(window: bigint): number;
  key(key: number, scan: number, flags: number, extra: number): void;
  scan(character: number): number;
}
export interface Keyboard {
  // True means a permission dialog may have changed keyboard focus.
  prepare?(): Promise<boolean>;
  capture(): Promise<string>;
  send(target: string, message: string): Promise<void>;
  close?(): void;
}
const runCommand: Run = (command, args) => new Promise((resolve, reject) => {
  execFile(command, args, { encoding: 'utf8', timeout: 4000, windowsHide: true }, (error, output) => {
    if (error) reject(error); else resolve(output.trim());
  });
});
function windowsKeys(): WindowsKeys {
  const user32 = createRequire(import.meta.url)('koffi').load('user32.dll');
  return {
    foreground: user32.func('uintptr_t __stdcall GetForegroundWindow()'),
    activate: user32.func('int32_t __stdcall SetForegroundWindow(uintptr_t window)'),
    key: user32.func('void __stdcall keybd_event(uint8_t key, uint8_t scan, uint32_t flags, uintptr_t extra)'),
    scan: user32.func('int16_t __stdcall VkKeyScanW(uint16_t character)')
  };
}

// OpenWhip's Ctrl+C → phrase → Enter, addressed to the captured window.
export function createKeyboard(
  platform = process.platform,
  run: Run = runCommand,
  wait: (ms: number) => Promise<unknown> = delay,
  windows: () => WindowsKeys = windowsKeys
): Keyboard {
  let native: WindowsKeys | undefined;
  const win = () => native ??= windows();
  const apple = (script: string) => run('osascript', ['-e', `tell application "System Events"\n${script}\nend tell`]);
  const capture = async () => {
    let id: string;
    if (platform === 'win32') id = String(win().foreground());
    else if (platform === 'darwin') id = await apple('get unix id of first application process whose frontmost is true');
    else if (platform === 'linux') id = await run('xdotool', ['getactivewindow']);
    else throw new Error('Keyboard feedback is not supported on this platform.');
    if (!/^[1-9]\d*$/.test(id)) throw new Error('Focus your agent terminal, then pick up a cookie.');
    return id;
  };
  const checkFocus = async (target: string) => {
    if (await capture() !== target) throw new Error('Focus changed. Pick up a new cookie to try again.');
  };
  return {
    capture,
    async send(target, message) {
      if (!/^[1-9]\d*$/.test(target)) throw new Error('No active agent window.');
      if (!/^[\x20-\x7e]{1,160}$/.test(message)) throw new Error('Invalid praise message.');
      if (platform === 'linux') {
        await run('xdotool', ['windowactivate', '--sync', target]);
        await checkFocus(target);
        await run('xdotool', ['key', '--clearmodifiers', 'ctrl+c']);
        await wait(300);
        await checkFocus(target);
        // xdotool type consumes remaining arguments; Enter needs its own call.
        await run('xdotool', ['type', '--clearmodifiers', '--delay', '1', '--', message]);
        await checkFocus(target);
        await run('xdotool', ['key', '--clearmodifiers', 'Return']);
      } else if (platform === 'darwin') {
        await apple(`set frontmost of first application process whose unix id is ${target} to true`);
        await wait(80);
        await checkFocus(target);
        await apple('key code 8 using {control down}');
        await wait(300);
        await checkFocus(target);
        const escaped = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        await apple(`keystroke "${escaped}"\nkey code 36`);
      } else if (platform === 'win32') {
        const keys = win();
        const characters = [...message].map(character => keys.scan(character.charCodeAt(0)));
        if (characters.some(key => key === -1)) throw new Error('The keyboard layout cannot type this phrase.');
        if (!keys.activate(BigInt(target))) throw new Error('Could not focus the agent window.');
        await wait(80);
        await checkFocus(target);
        const tap = (key: number) => { keys.key(key, 0, 0, 0); keys.key(key, 0, 2, 0); };
        keys.key(0x11, 0, 0, 0); tap(0x43); keys.key(0x11, 0, 2, 0);
        await wait(300);
        await checkFocus(target);
        for (const character of characters) {
          const modifiers = [0x10, 0x11, 0x12].filter((_, bit) => (character >> 8) & (1 << bit));
          for (const modifier of modifiers) keys.key(modifier, 0, 0, 0);
          tap(character & 0xff);
          for (const modifier of modifiers.reverse()) keys.key(modifier, 0, 2, 0);
        }
        tap(0x0d);
      } else throw new Error('Keyboard feedback is not supported on this platform.');
    }
  };
}
export function keyboardError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Wayland|[Kk]eyboard|permission|python3/.test(message)) return message;
  if (/ENOENT|xdotool/.test(message)) return 'Keyboard feedback needs xdotool and an X11 agent terminal.';
  if (/osascript|assistive|authorized/i.test(message)) return 'Enable Accessibility for OpenCookie in macOS System Settings.';
  if (/Focus|focus|layout|active/.test(message)) return message;
  return 'Could not send praise. Focus your agent terminal and try again.';
}
