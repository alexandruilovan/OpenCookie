import { COOLDOWN_MS, GRACE_MS } from '../shared.js';

export class FlickDetector {
  private samples: { x: number; y: number; time: number }[] = [];
  private spawned = 0;
  private lastGift = -Infinity;
  reset(x: number, y: number, time: number): void {
    this.samples = [{ x, y, time }];
    this.spawned = time;
    this.lastGift = -Infinity;
  }
  move(x: number, y: number, time: number): boolean {
    if (this.samples.length && time - this.samples.at(-1)!.time > 180) this.samples = [];
    this.samples.push({ x, y, time });
    while (this.samples.length > 2 && this.samples[1]!.time < time - 90) this.samples.shift();
    const first = this.samples[0]!;
    const elapsed = Math.max(16, time - first.time);
    const distance = Math.hypot(x - first.x, y - first.y);
    if (time - this.spawned < GRACE_MS || time - this.lastGift < COOLDOWN_MS || elapsed > 180 || distance < 90 || distance / elapsed < 1.5) return false;
    this.lastGift = time;
    this.samples = [{ x, y, time }];
    return true;
  }
}
