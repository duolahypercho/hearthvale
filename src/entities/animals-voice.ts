/**
 * Tiny procedural animal voices (WebAudio): cluck, quack, moo, bleat, baa, oink, woof, meow.
 * Plays through its own short-lived nodes on a shared context; ~20 lines of synthesis each.
 * Only sounds once the game's audio engine is running (user gesture happened, not muted).
 */
import type { Species } from './animals-models';

let ctx: AudioContext | null = null;
let out: GainNode | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
    out = ctx.createGain();
    out.gain.value = 0.32;
    const comp = ctx.createDynamicsCompressor();
    out.connect(comp).connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

interface Voice {
  wave: OscillatorType;
  f0: number;
  f1: number;
  dur: number;
  /** Band-pass formant. */
  formant: number;
  q: number;
  vibrato?: number;
  noise?: number;
  pulses?: number;
}

const VOICES: Record<Species, Voice> = {
  chicken: { wave: 'square', f0: 820, f1: 520, dur: 0.09, formant: 1400, q: 3, pulses: 3 },
  duck: { wave: 'sawtooth', f0: 380, f1: 300, dur: 0.16, formant: 1100, q: 6, pulses: 2 },
  cow: { wave: 'sawtooth', f0: 130, f1: 105, dur: 1.0, formant: 420, q: 2.5, vibrato: 3 },
  goat: { wave: 'sawtooth', f0: 360, f1: 330, dur: 0.55, formant: 900, q: 4, vibrato: 16 },
  sheep: { wave: 'sawtooth', f0: 280, f1: 250, dur: 0.6, formant: 780, q: 4, vibrato: 11 },
  pig: { wave: 'square', f0: 150, f1: 110, dur: 0.12, formant: 520, q: 3, noise: 0.5, pulses: 2 },
  dog: { wave: 'sawtooth', f0: 420, f1: 260, dur: 0.12, formant: 900, q: 2, noise: 0.35, pulses: 2 },
  cat: { wave: 'triangle', f0: 520, f1: 760, dur: 0.5, formant: 1500, q: 5, vibrato: 5 },
};

export function animalVoice(species: Species, pitch = 1, enabled = true): void {
  if (!enabled) return;
  const c = context();
  if (!c || !out) return;
  if (c.state === 'suspended') void c.resume();
  const v = VOICES[species];
  const now = c.currentTime + 0.01;
  const n = v.pulses ?? 1;
  for (let i = 0; i < n; i++) {
    const t0 = now + i * (v.dur + 0.05);
    const osc = c.createOscillator();
    osc.type = v.wave;
    const f0 = v.f0 * pitch * (1 + (Math.random() - 0.5) * 0.08);
    osc.frequency.setValueAtTime(f0, t0);
    // Moo / baa rise then fall; clucks drop.
    if (v.dur > 0.4) {
      osc.frequency.linearRampToValueAtTime(f0 * 1.12, t0 + v.dur * 0.3);
      osc.frequency.linearRampToValueAtTime(v.f1 * pitch, t0 + v.dur);
    } else osc.frequency.exponentialRampToValueAtTime(Math.max(40, v.f1 * pitch), t0 + v.dur);
    if (v.vibrato) {
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = v.vibrato;
      lg.gain.value = f0 * 0.04;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + v.dur + 0.05);
    }
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = v.formant * (0.95 + Math.random() * 0.1);
    bp.Q.value = v.q;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = v.formant * 2.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(1, t0 + Math.min(0.04, v.dur * 0.2));
    g.gain.setValueAtTime(1, t0 + v.dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + v.dur);
    osc.connect(bp);
    osc.connect(lp);
    const mix = c.createGain();
    mix.gain.value = 0.5;
    bp.connect(g);
    lp.connect(mix).connect(g);
    if (v.noise) {
      const len = Math.ceil(c.sampleRate * v.dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * v.noise;
      const src = c.createBufferSource();
      src.buffer = buf;
      const nf = c.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = v.formant;
      nf.Q.value = 1.5;
      src.connect(nf).connect(g);
      src.start(t0);
    }
    g.connect(out);
    osc.start(t0);
    osc.stop(t0 + v.dur + 0.05);
  }
}
