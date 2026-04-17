import type { BuiltinTone } from '../../../src/shared/models';

let audioContext: AudioContext | null = null;
let unlockHandlersBound = false;
const pendingBuiltinTones: BuiltinTone[] = [];

function getAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function getCtx(): AudioContext {
  if (!audioContext) {
    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
      throw new Error('AudioContext is not available');
    }

    audioContext = new AudioContextCtor();
  }
  return audioContext;
}

function flushPendingBuiltinTones(ctx: AudioContext): void {
  if (ctx.state !== 'running' || pendingBuiltinTones.length === 0) {
    return;
  }

  const queued = pendingBuiltinTones.splice(0, pendingBuiltinTones.length);
  for (const tone of queued) {
    TONE_PLAYERS[tone]?.(ctx);
  }
}

function tryResumeContext(ctx: AudioContext): void {
  if (ctx.state === 'closed') {
    return;
  }

  void ctx.resume()
    .then(() => {
      flushPendingBuiltinTones(ctx);
    })
    .catch(() => {
      // Resume still needs a user gesture.
    });
}

function ensureUnlockHandlersBound(): void {
  if (unlockHandlersBound || typeof window === 'undefined') {
    return;
  }

  const unlock = () => {
    try {
      const ctx = getCtx();
      tryResumeContext(ctx);
    } catch {
      // Audio not available
    }
  };

  for (const eventName of ['pointerdown', 'keydown']) {
    window.addEventListener(eventName, unlock, { passive: true });
  }

  unlockHandlersBound = true;
}

// ── Soft bell: warm descending tone with harmonic ──────────────────────────
function softBell(ctx: AudioContext): void {
  const now = ctx.currentTime;

  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(830, now);
  osc1.frequency.exponentialRampToValueAtTime(580, now + 0.3);
  gain1.gain.setValueAtTime(0.15, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.3);

  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(1245, now);
  osc2.frequency.exponentialRampToValueAtTime(870, now + 0.2);
  gain2.gain.setValueAtTime(0.07, now);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now);
  osc2.stop(now + 0.2);
}

// ── Chime: ascending three-note arpeggio (C5 → E5 → G5) ──────────────────
function chime(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
  const gap = 0.08;

  for (let i = 0; i < notes.length; i++) {
    const start = now + i * gap;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(notes[i], start);
    gain.gain.setValueAtTime(0.12, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.25);
  }
}

// ── Ding: short bright ping ───────────────────────────────────────────────
function ding(ctx: AudioContext): void {
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, now);
  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.15);
}

const TONE_PLAYERS: Record<BuiltinTone, (ctx: AudioContext) => void> = {
  'soft-bell': softBell,
  chime,
  ding
};

export function initializeAudioPlayback(): void {
  ensureUnlockHandlersBound();
}

export function playBuiltinTone(name: BuiltinTone): void {
  try {
    ensureUnlockHandlersBound();
    const ctx = getCtx();
    const play = TONE_PLAYERS[name];
    if (!play) return;
    if (ctx.state === 'running') {
      play(ctx);
      return;
    }

    pendingBuiltinTones.push(name);
    tryResumeContext(ctx);
  } catch {
    // Audio not available
  }
}

/** @deprecated Use playBuiltinTone('soft-bell') instead */
export function playSoftBell(): void {
  playBuiltinTone('soft-bell');
}
