/**
 * Synthesized game sound effects using the Web Audio API.
 * No external audio files needed — all sounds are generated programmatically.
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function playTone(
  freq: number,
  duration: number,
  type: OscillatorType = "sine",
  volume = 0.15,
  rampDown = true,
) {
  const ac = getCtx();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime);
  gain.gain.setValueAtTime(volume, ac.currentTime);
  if (rampDown) gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + duration);
}

function playNoise(duration: number, volume = 0.06) {
  const ac = getCtx();
  const bufferSize = ac.sampleRate * duration;
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const source = ac.createBufferSource();
  source.buffer = buffer;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(volume, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  source.connect(gain).connect(ac.destination);
  source.start();
}

/** Satisfying pop when hitting a normal red target */
export function playHitSound() {
  playTone(880, 0.12, "sine", 0.18);
  playTone(1320, 0.08, "sine", 0.1);
  playNoise(0.06, 0.04);
}

/** Special sparkle chime for bonus gold target hits */
export function playBonusHitSound() {
  playTone(1047, 0.1, "sine", 0.15);
  setTimeout(() => playTone(1319, 0.1, "sine", 0.13), 50);
  setTimeout(() => playTone(1568, 0.15, "sine", 0.12), 100);
  playNoise(0.05, 0.03);
}

/** Subtle whoosh when clicking the arena but missing */
export function playMissSound() {
  playNoise(0.15, 0.05);
  playTone(200, 0.1, "sine", 0.04);
}

/** Countdown beep (3, 2, 1) — higher pitch each second */
export function playCountdownBeep(secondsLeft: number) {
  const freq = secondsLeft === 1 ? 880 : secondsLeft === 2 ? 660 : 440;
  playTone(freq, 0.15, "square", 0.08);
}

/** GO! sound when round starts */
export function playGoSound() {
  playTone(523, 0.08, "square", 0.1);
  setTimeout(() => playTone(784, 0.15, "square", 0.12), 80);
  setTimeout(() => playTone(1047, 0.2, "square", 0.1), 160);
}

/** Combo milestone sound (3x, 5x, 10x streak) */
export function playComboSound(streak: number) {
  const base = streak >= 10 ? 1047 : streak >= 5 ? 880 : 660;
  playTone(base, 0.08, "sine", 0.1);
  setTimeout(() => playTone(base * 1.25, 0.08, "sine", 0.1), 60);
  setTimeout(() => playTone(base * 1.5, 0.12, "sine", 0.12), 120);
}

/** Round end horn */
export function playRoundEndSound() {
  playTone(392, 0.3, "sawtooth", 0.06);
  setTimeout(() => playTone(523, 0.4, "sawtooth", 0.06), 200);
}

/** Buzzer for decoy */
export function playDecoyHitSound() {
  playTone(150, 0.2, "sawtooth", 0.2);
  playTone(100, 0.3, "sawtooth", 0.2);
}

/** Zap for speed target */
export function playSpeedHitSound() {
  playTone(1800, 0.05, "square", 0.1);
  setTimeout(() => playTone(2200, 0.05, "square", 0.1), 30);
  playNoise(0.05, 0.1);
}

/** Magical chime for powerups */
export function playPowerupSound() {
  playTone(880, 0.1, "sine", 0.1);
  setTimeout(() => playTone(1108, 0.1, "sine", 0.1), 80);
  setTimeout(() => playTone(1318, 0.15, "sine", 0.1), 160);
  setTimeout(() => playTone(1760, 0.3, "sine", 0.1), 240);
}

/** Mute state — stored in memory, toggled by user */
let muted = false;

export function isMuted(): boolean {
  return muted;
}

export function toggleMute(): boolean {
  muted = !muted;
  return muted;
}

/** Wrap any sound function to respect mute state */
export function play(fn: () => void) {
  if (!muted) fn();
}
