import { FlickDetector } from './gesture.js';
import type { SpawnCookie } from '../shared.js';

const canvas = document.querySelector<HTMLCanvasElement>('#cookie')!;
const ctx = canvas.getContext('2d')!;
const message = document.querySelector<HTMLDivElement>('#message')!;
const gesture = new FlickDetector();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let width = innerWidth, height = innerHeight;
let active = false, dropping = false, pending = false, sound = true;
let mouse = { x: width / 2, y: height / 2 };
let cookie = { x: mouse.x, y: mouse.y, vx: 0, vy: 0, angle: 0 };
let lastFrame = 0, frame = 0, generation = 0;
let dropTime = 0, messageUntil = 0;
let audio: AudioContext | undefined;
type Particle = { x: number; y: number; vx: number; vy: number; life: number; size: number; kind: 'cookie' | 'heart' | 'crumb'; angle: number };
let particles: Particle[] = [];

function resize(): void {
  width = innerWidth; height = innerHeight;
  canvas.width = Math.round(width * devicePixelRatio);
  canvas.height = Math.round(height * devicePixelRatio);
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
resize();
addEventListener('resize', resize);

function drawCookie(x: number, y: number, radius: number, angle: number, opacity = 1): void {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle); ctx.scale(radius / 44, radius / 44); ctx.globalAlpha = opacity;
  ctx.shadowColor = '#39230b38'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 5;
  ctx.beginPath();
  for (let i = 0; i <= 80; i++) {
    const a = i / 80 * Math.PI * 2, r = 43 + Math.sin(a * 9) * 1.5;
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  const dough = ctx.createRadialGradient(-14, -18, 4, 0, 0, 47);
  dough.addColorStop(0, '#ffe1a0'); dough.addColorStop(0.7, '#efba69'); dough.addColorStop(1, '#ce8b43');
  ctx.fillStyle = dough; ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#fff6df'; ctx.lineWidth = 3; ctx.stroke();
  for (const [cx, cy, r] of [[-23,-20,5],[3,-29,5],[24,-12,6],[-29,5,4],[28,15,4],[-17,28,6],[10,29,5],[-6,-9,3]]) {
    ctx.beginPath(); ctx.ellipse(cx!, cy!, r!, r! * 0.8, cx! / 10, 0, Math.PI * 2);
    ctx.fillStyle = '#70412a'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx! - 1, cy! - 1, r! / 3, 0, Math.PI * 2); ctx.fillStyle = '#976142'; ctx.fill();
  }
  ctx.fillStyle = '#492c20';
  for (const x of [-12, 12]) { ctx.beginPath(); ctx.ellipse(x, 3, 2.6, 3.4, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = '#492c20'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, 8, 7, 0.15, Math.PI - 0.15); ctx.stroke();
  ctx.fillStyle = '#db876a66';
  for (const x of [-20, 20]) { ctx.beginPath(); ctx.ellipse(x, 11, 5, 3, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function chime(): void {
  if (!sound) return;
  try {
    audio ??= new AudioContext();
    void audio.resume().catch(() => {});
    [659.25, 830.61, 987.77].forEach((frequency, index) => {
      const oscillator = audio!.createOscillator(), gain = audio!.createGain();
      const start = audio!.currentTime + index * 0.07;
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.08, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
      oscillator.connect(gain); gain.connect(audio!.destination);
      oscillator.start(start); oscillator.stop(start + 0.25);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  } catch { /* Missing audio output should not stop the cookie. */ }
}

function say(text: string, error = false): void {
  message.textContent = text;
  message.classList.toggle('error', error);
  messageUntil = error ? Infinity : performance.now() + 2800;
}
async function give(dx: number, dy: number): Promise<void> {
  if (!active || dropping || pending) return;
  pending = true;
  const current = generation;
  const length = Math.hypot(dx, dy) || 1;
  particles.push({ x: cookie.x, y: cookie.y, vx: dx / length * 10, vy: dy / length * 8 - 3, life: 1, size: 32, kind: 'cookie', angle: 0 });
  try {
    const result = await window.cookie.give();
    if (current !== generation || !active || dropping) return;
    if (result.message) say(result.message, !result.ok);
    if (!result.ok) return;
    chime();
    for (let i = 0; i < (reducedMotion ? 3 : 16); i++) {
      const angle = Math.random() * Math.PI * 2;
      particles.push({ x: cookie.x, y: cookie.y, vx: Math.cos(angle) * 4, vy: Math.sin(angle) * 4 - 2,
        life: 1, size: 3 + Math.random() * 5, kind: i % 3 ? 'crumb' : 'heart', angle });
    }
  } catch { if (current === generation && active) say('Could not send praise. Pick up a new cookie to try again.', true); }
  finally { if (current === generation) pending = false; }
}

function stop(): void {
  active = false; dropping = false; pending = false; generation++;
  cancelAnimationFrame(frame);
  particles = []; message.textContent = ''; ctx.clearRect(0, 0, width, height);
  document.body.classList.remove('active');
  document.body.classList.remove('countdown');
}
function countdown(seconds: number): void {
  stop();
  document.body.classList.add('countdown');
  say(`Click your agent's input. Cookie ready in ${seconds}… · Esc to cancel`);
}
function spawn(data: SpawnCookie): void {
  stop(); active = true; sound = data.sound;
  mouse = { x: data.x, y: data.y };
  cookie = { ...mouse, vx: 0, vy: 0, angle: 0 };
  gesture.reset(mouse.x, mouse.y, performance.now());
  document.body.classList.add('active');
  if (data.error) say(data.error, true);
  lastFrame = performance.now(); frame = requestAnimationFrame(draw);
}
function drop(): void {
  if (!active || dropping) return;
  dropping = true; dropTime = performance.now(); cookie.vy = -3;
  message.textContent = ''; document.body.classList.remove('active');
}

function draw(now: number): void {
  if (!active) return;
  const dt = Math.min(2, (now - lastFrame) / 16.67); lastFrame = now;
  ctx.clearRect(0, 0, width, height);
  // A near-transparent fill keeps pointer events working on transparent windows.
  ctx.fillStyle = 'rgba(0,0,0,0.004)'; ctx.fillRect(0, 0, width, height);
  if (dropping) {
    cookie.vy += 0.65 * dt; cookie.y += cookie.vy * dt; cookie.angle += 0.08 * dt;
    if (now - dropTime > (reducedMotion ? 160 : 700)) { stop(); window.cookie.hide(); return; }
  } else {
    cookie.vx = (cookie.vx + (mouse.x - cookie.x) * 0.16 * dt) * Math.pow(0.67, dt);
    cookie.vy = (cookie.vy + (mouse.y - cookie.y) * 0.16 * dt) * Math.pow(0.67, dt);
    cookie.x += cookie.vx * dt; cookie.y += cookie.vy * dt;
    cookie.angle += (Math.max(-0.4, Math.min(0.4, cookie.vx * 0.03)) - cookie.angle) * 0.16;
    if (reducedMotion) { cookie.x = mouse.x; cookie.y = mouse.y; cookie.angle = 0; }
  }
  for (const particle of particles) {
    particle.x += particle.vx * dt; particle.y += particle.vy * dt;
    particle.vy += 0.1 * dt; particle.life -= 0.025 * dt; particle.angle += 0.07 * dt;
    const opacity = Math.max(0, particle.life);
    if (particle.kind === 'cookie') drawCookie(particle.x, particle.y, particle.size, particle.angle, opacity);
    else {
      ctx.save(); ctx.globalAlpha = opacity;
      ctx.fillStyle = particle.kind === 'heart' ? '#e59682' : '#d5a15f';
      if (particle.kind === 'heart') {
        ctx.font = `${particle.size * 3}px system-ui`; ctx.fillText('♥', particle.x, particle.y);
      } else { ctx.beginPath(); ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  }
  particles = particles.filter(particle => particle.life > 0);
  const opacity = dropping ? Math.max(0, 1 - (now - dropTime) / 700) : 1;
  drawCookie(cookie.x, cookie.y, 44, cookie.angle, opacity);
  if (now > messageUntil) message.textContent = '';
  frame = requestAnimationFrame(draw);
}

document.addEventListener('pointermove', event => {
  const dx = event.clientX - mouse.x, dy = event.clientY - mouse.y;
  mouse = { x: event.clientX, y: event.clientY };
  if (active && !dropping && gesture.move(mouse.x, mouse.y, performance.now())) void give(dx, dy);
});
document.addEventListener('pointerdown', drop);
document.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('keydown', event => { if (event.key === 'Escape') { stop(); window.cookie.hide(); } });
window.cookie.onCountdown(countdown);
window.cookie.onSpawn(spawn);
window.cookie.onDrop(drop);
window.cookie.onHide(stop);
