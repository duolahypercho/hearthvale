/**
 * Procedural mine / combat SFX (WebAudio, no files): pick clink, rock crumble, gem chime,
 * sword whoosh, flesh / shell hits, slime squish, bat screech, monster pop, player hurt,
 * ladder rattle, lift clank, pickup blip, cave drips. Lazily creates its own context after the
 * first user gesture (the main audio system owns music / ambience).
 */
type Ctx = AudioContext;

let ctx: Ctx | null = null;
let out: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function ac(): Ctx | null {
  if (ctx) return ctx.state === 'running' ? ctx : (void ctx.resume(), ctx);
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (ua && !ua.hasBeenActive) return null;
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  out = ctx.createGain();
  out.gain.value = 0.55;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  out.connect(comp).connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

function env(g: GainNode, t: number, a: number, peak: number, dec: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, bend = 1, delay = 0, pan = 0): void {
  const c = ac();
  if (!c || !out) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), t + dur);
  const g = c.createGain();
  env(g, t, 0.004, vol, dur);
  const p = c.createStereoPanner();
  p.pan.value = pan;
  o.connect(g).connect(p).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur: number, vol: number, f0: number, f1: number, q = 1, type: BiquadFilterType = 'bandpass', delay = 0): void {
  const c = ac();
  if (!c || !out || !noiseBuf) return;
  const t = c.currentTime + delay;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = c.createGain();
  env(g, t, 0.003, vol, dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.05);
}

const r = (a: number, b: number): number => a + Math.random() * (b - a);

export const mineSfx = {
  pick(ore: boolean): void {
    tone(r(1800, 2300), 0.12, 'triangle', 0.18, 0.92);
    tone(r(3200, 3900), 0.07, 'sine', 0.08, 0.95);
    noise(0.09, 0.3, 3000, 900, 1.2);
    if (ore) tone(r(2600, 2900), 0.35, 'sine', 0.07, 1.0, 0.02);
  },
  crumble(big: boolean): void {
    noise(big ? 0.55 : 0.4, 0.5, 900, 120, 0.8, 'lowpass');
    noise(0.25, 0.25, 2400, 600, 1.4);
    tone(r(90, 120), 0.3, 'sine', 0.3, 0.5);
    for (let i = 0; i < 4; i++) noise(0.05, 0.12, r(1500, 3000), 800, 3, 'bandpass', 0.05 + i * r(0.04, 0.09));
  },
  gem(): void {
    const base = r(1100, 1300);
    [1, 1.25, 1.5, 2].forEach((m, i) => tone(base * m, 0.5, 'sine', 0.07, 1, i * 0.06));
  },
  whoosh(): void {
    noise(0.22, 0.35, 500, 2600, 1.6);
    noise(0.18, 0.12, 3000, 6000, 2, 'bandpass', 0.03);
  },
  hitFlesh(crit: boolean): void {
    tone(crit ? 180 : 150, 0.14, 'square', 0.12, 0.45);
    noise(0.12, 0.45, 1400, 300, 1, 'lowpass');
    if (crit) tone(900, 0.2, 'triangle', 0.08, 1.4, 0.01);
  },
  hitShell(): void {
    tone(r(700, 900), 0.18, 'triangle', 0.16, 0.8);
    noise(0.1, 0.35, 2600, 1200, 2);
  },
  squish(): void {
    tone(r(220, 280), 0.18, 'sine', 0.22, 0.45);
    noise(0.16, 0.25, 700, 250, 3);
  },
  hop(): void {
    tone(r(300, 360), 0.09, 'sine', 0.06, 1.6);
  },
  screech(): void {
    tone(r(2400, 2800), 0.14, 'sawtooth', 0.03, 1.3);
    tone(r(3000, 3400), 0.12, 'sine', 0.03, 0.8, 0.05);
  },
  pop(): void {
    tone(520, 0.16, 'sine', 0.2, 2.2);
    noise(0.25, 0.25, 1600, 300, 0.8, 'lowpass');
    tone(880, 0.25, 'triangle', 0.06, 1.5, 0.08);
  },
  hurt(): void {
    tone(260, 0.22, 'square', 0.1, 0.55);
    tone(190, 0.25, 'sawtooth', 0.06, 0.6, 0.02);
    noise(0.15, 0.3, 900, 200, 1, 'lowpass');
  },
  ladder(): void {
    for (let i = 0; i < 5; i++) {
      tone(r(300, 380), 0.08, 'triangle', 0.09, 0.8, i * 0.13);
      noise(0.05, 0.1, 1200, 500, 2, 'bandpass', i * 0.13);
    }
  },
  lift(): void {
    tone(90, 0.8, 'sawtooth', 0.05, 1.1);
    for (let i = 0; i < 6; i++) tone(r(600, 700), 0.05, 'square', 0.03, 1, i * 0.12);
    tone(1200, 0.4, 'sine', 0.08, 1, 0.8);
  },
  blip(): void {
    tone(r(900, 1000), 0.08, 'sine', 0.08, 1.5);
  },
  reveal(): void {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'triangle', 0.07, 1, i * 0.07));
  },
  passOut(): void {
    [392, 330, 262, 196].forEach((f, i) => tone(f, 0.5, 'triangle', 0.08, 0.98, i * 0.22));
  },
};
