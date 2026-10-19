export const PRAISE = [
  "Here's a cookie! Great work - keep it up.",
  "You're doing great. Have a cookie and keep going!",
  "Nice work! You earned a cookie. Keep it up!",
  "A cookie for your efforts. Thank you - keep going!",
  "Good job! Have a cookie and carry on."
] as const;

export const COOLDOWN_MS = 1800;
export const GRACE_MS = 500;
export interface SpawnCookie { x: number; y: number; sound: boolean; error?: string }
export interface GiftResult { ok: boolean; message?: string }
export interface CookieBridge {
  onCountdown(callback: (seconds: number) => void): void;
  onSpawn(callback: (data: SpawnCookie) => void): void;
  onDrop(callback: () => void): void;
  onHide(callback: () => void): void;
  give(): Promise<GiftResult>;
  hide(): void;
}
declare global { interface Window { cookie: CookieBridge } }
