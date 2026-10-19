import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { Keyboard } from './keyboard.js';

type Reply = { id: number; ok: boolean; created?: boolean; error?: string };

export function isWayland(platform = process.platform, env = process.env): boolean {
  return platform === 'linux' && (env.XDG_SESSION_TYPE === 'wayland' || (!env.XDG_SESSION_TYPE && !!env.WAYLAND_DISPLAY));
}

// The portal sends to the currently focused application. Wayland intentionally
// does not expose other applications' window IDs or allow us to refocus them.
export function createWaylandKeyboard(
  helper = fileURLToPath(new URL('./wayland.py', import.meta.url)),
  env = process.env
): Keyboard {
  let child: ChildProcessWithoutNullStreams | undefined;
  let sequence = 0;
  const pending = new Map<number, { resolve: (reply: Reply) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  function stop(message: string): void {
    const previous = child; child = undefined;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(message)); }
    pending.clear(); previous?.kill();
  }
  function start(): ChildProcessWithoutNullStreams {
    if (child) return child;
    const path = helper.replace(/([/\\])app\.asar([/\\])/, '$1app.asar.unpacked$2');
    const worker = spawn('/usr/bin/python3', ['-u', path], { env, stdio: 'pipe' });
    child = worker;
    const lines = createInterface({ input: worker.stdout });
    lines.on('line', line => {
      let reply: Reply;
      try { reply = JSON.parse(line) as Reply; }
      catch { stop('Wayland keyboard helper returned an invalid response.'); return; }
      const request = pending.get(reply.id);
      if (!request) return;
      pending.delete(reply.id); clearTimeout(request.timer);
      if (reply.ok) request.resolve(reply);
      else request.reject(new Error(reply.error || 'Wayland keyboard permission is unavailable.'));
    });
    worker.stderr.on('data', () => {});
    worker.stdin.on('error', () => { if (child === worker) stop('Wayland keyboard connection closed. Pick up a new cookie.'); });
    worker.on('error', () => { if (child === worker) stop('Wayland keyboard helper needs /usr/bin/python3 and python3-gi.'); });
    worker.on('exit', () => {
      lines.close();
      if (child === worker) stop('Wayland keyboard helper stopped. Check that python3-gi is installed, then pick up a new cookie.');
    });
    return worker;
  }
  function call(command: string, message?: string): Promise<Reply> {
    const worker = start(), id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => stop('Wayland keyboard permission timed out. Pick up a new cookie to retry.'), command === 'prepare' ? 125_000 : 10_000);
      pending.set(id, { resolve, reject, timer });
      worker.stdin.write(JSON.stringify({ id, command, message }) + '\n');
    });
  }
  return {
    async prepare() {
      const reply = await call('prepare');
      return !!reply.created;
    },
    async capture() {
      // Never open a permission dialog after the caller's focus countdown.
      await call('check');
      return 'wayland-current';
    },
    async send(target, message) {
      if (target !== 'wayland-current') throw new Error('Pick up a new cookie for the focused agent terminal.');
      if (!/^[\x20-\x7e]{1,160}$/.test(message)) throw new Error('Invalid praise message.');
      await call('give', message);
    },
    close: () => stop('OpenCookie closed the keyboard session.')
  };
}
