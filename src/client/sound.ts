// Sound effects, synthesised with the Web Audio API: no audio files to load or license.

import { loadValue, saveValue } from './storage';

export type SoundName =
  | 'select'
  | 'move'
  | 'capture'
  | 'draw'
  | 'card-move'
  | 'card-double'
  | 'card-skip'
  | 'card-undo'
  | 'card-wild'
  | 'card-teleport'
  | 'teleport'
  | 'swap'
  | 'check'
  | 'win'
  | 'loss'
  | 'draw-game'
  | 'turn'
  | 'chat'
  | 'tick'
  | 'error';

type Voice = (ctx: BaseAudioContext, out: AudioNode, t: number) => void;

/** MIDI note number to frequency (69 = A4 = 440 Hz). */
const note = (n: number) => 440 * 2 ** ((n - 69) / 12);

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

/** A quick rise to `peak`, then an exponential fade. */
function envelope(ctx: BaseAudioContext, t: number, attack: number, decay: number, peak: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

interface ToneOptions {
  freq: number;
  /** Glide to this frequency over the note. */
  to?: number;
  type?: OscillatorType;
  attack?: number;
  decay?: number;
  gain?: number;
  /** Low-pass the tone to soften buzzy waveforms. */
  cutoff?: number;
}

function tone(ctx: BaseAudioContext, out: AudioNode, t: number, o: ToneOptions): void {
  const { freq, to, type = 'sine', attack = 0.005, decay = 0.2, gain = 0.3, cutoff } = o;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
  const env = envelope(ctx, t, attack, decay, gain);
  if (cutoff) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    osc.connect(filter).connect(env);
  } else {
    osc.connect(env);
  }
  env.connect(out);
  osc.start(t);
  osc.stop(t + attack + decay + 0.05);
}

interface NoiseOptions {
  filter?: BiquadFilterType;
  freq: number;
  to?: number;
  q?: number;
  attack?: number;
  decay?: number;
  gain?: number;
}

/** Filtered noise: clacks, swishes and whooshes. */
function noise(ctx: BaseAudioContext, out: AudioNode, t: number, o: NoiseOptions): void {
  const { filter = 'bandpass', freq, to, q = 1, attack = 0.002, decay = 0.06, gain = 0.4 } = o;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
  const env = envelope(ctx, t, attack, decay, gain);
  src.connect(f).connect(env).connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + attack + decay + 0.05);
}

const arpeggio = (notes: number[], step: number, o: Omit<ToneOptions, 'freq'>): Voice => (ctx, out, t) =>
  notes.forEach((n, i) => tone(ctx, out, t + i * step, { ...o, freq: note(n) }));

export const SOUNDS: Record<SoundName, Voice> = {
  select: (ctx, out, t) => tone(ctx, out, t, { freq: 1400, type: 'triangle', decay: 0.035, gain: 0.07 }),

  // Wooden clack: a bright tap plus a short low knock.
  move: (ctx, out, t) => {
    noise(ctx, out, t, { freq: 2300, q: 2.2, decay: 0.045, gain: 0.55 });
    tone(ctx, out, t, { freq: 190, to: 120, decay: 0.07, gain: 0.35 });
  },
  capture: (ctx, out, t) => {
    noise(ctx, out, t, { freq: 1500, q: 1.6, decay: 0.08, gain: 0.75 });
    tone(ctx, out, t, { freq: 150, to: 65, decay: 0.14, gain: 0.55 });
    noise(ctx, out, t + 0.045, { freq: 3200, q: 3, decay: 0.05, gain: 0.3 });
  },

  // A card sliding off the deck.
  draw: (ctx, out, t) =>
    noise(ctx, out, t, { filter: 'highpass', freq: 700, to: 5000, q: 0.7, attack: 0.03, decay: 0.16, gain: 0.28 }),

  // One sting per card, played as it flips face up.
  'card-move': (ctx, out, t) => {
    tone(ctx, out, t, { freq: note(76), type: 'triangle', decay: 0.16, gain: 0.16 });
    tone(ctx, out, t + 0.07, { freq: note(81), type: 'triangle', decay: 0.22, gain: 0.14 });
  },
  'card-double': arpeggio([72, 76, 79, 84], 0.065, { type: 'triangle', decay: 0.22, gain: 0.17 }),
  'card-skip': (ctx, out, t) => {
    tone(ctx, out, t, { freq: 233, to: 196, type: 'sawtooth', decay: 0.24, gain: 0.16, cutoff: 1200 });
    tone(ctx, out, t + 0.28, { freq: 185, to: 98, type: 'sawtooth', decay: 0.5, gain: 0.16, cutoff: 900 });
  },
  'card-undo': (ctx, out, t) => {
    tone(ctx, out, t, { freq: 1100, to: 260, decay: 0.32, gain: 0.14 });
    tone(ctx, out, t + 0.1, { freq: 800, to: 200, decay: 0.32, gain: 0.1 });
    noise(ctx, out, t, { filter: 'bandpass', freq: 3000, to: 600, q: 1.2, attack: 0.02, decay: 0.3, gain: 0.12 });
  },
  'card-wild': (ctx, out, t) =>
    [88, 91, 95, 98, 100, 103].forEach((n, i) =>
      tone(ctx, out, t + i * 0.045 + Math.random() * 0.02, { freq: note(n), decay: 0.3, gain: 0.09 }),
    ),
  'card-teleport': (ctx, out, t) => {
    tone(ctx, out, t, { freq: 260, to: 1500, type: 'triangle', attack: 0.01, decay: 0.36, gain: 0.2 });
    noise(ctx, out, t, { freq: 600, to: 4000, q: 2, attack: 0.04, decay: 0.3, gain: 0.2 });
  },

  // Board effects.
  teleport: (ctx, out, t) => {
    noise(ctx, out, t, { freq: 3500, to: 500, q: 2.5, attack: 0.01, decay: 0.22, gain: 0.25 });
    tone(ctx, out, t + 0.18, { freq: 400, to: 1700, type: 'sine', decay: 0.22, gain: 0.16 });
  },
  swap: (ctx, out, t) => {
    tone(ctx, out, t, { freq: note(88), decay: 0.55, gain: 0.14 });
    tone(ctx, out, t + 0.08, { freq: note(95), decay: 0.6, gain: 0.12 });
    noise(ctx, out, t, { filter: 'highpass', freq: 6000, q: 0.5, attack: 0.01, decay: 0.25, gain: 0.08 });
  },
  check: (ctx, out, t) => {
    tone(ctx, out, t, { freq: 880, type: 'square', decay: 0.09, gain: 0.12, cutoff: 2800 });
    tone(ctx, out, t + 0.12, { freq: 660, type: 'square', decay: 0.14, gain: 0.12, cutoff: 2800 });
  },

  // End of game.
  win: (ctx, out, t) => {
    arpeggio([72, 76, 79], 0.11, { type: 'triangle', decay: 0.25, gain: 0.18 })(ctx, out, t);
    [72, 76, 79, 84].forEach((n) => tone(ctx, out, t + 0.36, { freq: note(n), type: 'triangle', decay: 1.1, gain: 0.11 }));
  },
  loss: (ctx, out, t) => {
    arpeggio([67, 63, 60], 0.2, { type: 'triangle', decay: 0.45, gain: 0.16 })(ctx, out, t);
    tone(ctx, out, t + 0.6, { freq: note(48), decay: 0.9, gain: 0.14 });
  },
  'draw-game': arpeggio([76, 72], 0.18, { type: 'triangle', decay: 0.4, gain: 0.15 }),

  // Notifications.
  turn: (ctx, out, t) => {
    tone(ctx, out, t, { freq: 880, decay: 0.6, gain: 0.14 });
    tone(ctx, out, t, { freq: 1760, decay: 0.3, gain: 0.04 });
  },
  chat: (ctx, out, t) => tone(ctx, out, t, { freq: 420, to: 950, decay: 0.08, gain: 0.18 }),
  tick: (ctx, out, t) => tone(ctx, out, t, { freq: 1050, type: 'square', decay: 0.025, gain: 0.07, cutoff: 3000 }),
  error: (ctx, out, t) => {
    tone(ctx, out, t, { freq: 150, type: 'square', decay: 0.13, gain: 0.08, cutoff: 900 });
    tone(ctx, out, t, { freq: 142, type: 'square', decay: 0.13, gain: 0.08, cutoff: 900 });
  },
};

class SoundPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled: boolean = loadValue('cc:sound', true);

  /** Browsers only allow audio after the user has interacted with the page. */
  unlock(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Play a sound, optionally `delay` seconds from now. Silent until unlocked or when muted. */
  play(name: SoundName, delay = 0): void {
    if (!this.enabled || !this.ctx || !this.master || this.ctx.state === 'closed') return;
    SOUNDS[name](this.ctx, this.master, this.ctx.currentTime + 0.01 + delay);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    saveValue('cc:sound', on);
  }
}

export const sound = new SoundPlayer();

if (typeof window !== 'undefined') {
  const unlock = () => sound.unlock();
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
}
