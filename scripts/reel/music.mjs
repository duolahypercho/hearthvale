#!/usr/bin/env node
/**
 * Motion reel — score. Offline synth (no samples): 120 BPM, D major, 30 s, cut to the
 * reel's 2-second section grid. Writes shots/reel/music.wav (48 kHz stereo 16-bit).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './lib.mjs';

const SR = 48000;
const LEN = 30.6;
const N = Math.round(SR * LEN);
const L = new Float32Array(N), R = new Float32Array(N);
const sendL = new Float32Array(N), sendR = new Float32Array(N);
const duck = new Float32Array(N).fill(1);
const BEAT = 0.5;
let seed = 1234567;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function add(t0, buf, gain = 1, pan = 0, send = 0) {
  const s = Math.round(t0 * SR);
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < buf.length; i++) {
    const j = s + i;
    if (j < 0 || j >= N) continue;
    L[j] += buf[i] * gl; R[j] += buf[i] * gr;
    if (send) { sendL[j] += buf[i] * gl * send; sendR[j] += buf[i] * gr * send; }
  }
}

// ---- voices -------------------------------------------------------------------------------
function kick(len = 0.45) {
  const n = Math.round(len * SR), b = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 42 + 110 * Math.exp(-t * 32);
    ph += (2 * Math.PI * f) / SR;
    b[i] = Math.tanh(1.6 * Math.sin(ph) * Math.exp(-t * 7.5)) + (t < 0.004 ? rnd() * 0.3 : 0);
  }
  return b;
}
function clap() {
  const n = Math.round(0.3 * SR), b = new Float32Array(n);
  let lp = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = [0, 0.011, 0.022].reduce((a, o) => a + (t >= o ? Math.exp(-(t - o) * (o === 0.022 ? 18 : 90)) : 0), 0);
    const x = rnd();
    lp += (x - lp) * 0.35;
    const hp = lp - prev; prev = lp;
    b[i] = hp * env * 1.6;
  }
  return b;
}
function hat(open = false) {
  const n = Math.round((open ? 0.25 : 0.06) * SR), b = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const x = rnd();
    const hp = x - prev; prev = x;
    b[i] = hp * Math.exp(-(i / SR) * (open ? 14 : 60)) * 0.5;
  }
  return b;
}
function pluck(freq, len = 0.9, bright = 0.5) {
  const n = Math.round(len * SR), b = new Float32Array(n);
  const p = Math.max(2, Math.round(SR / freq));
  const line = new Float32Array(p);
  let lp = 0;
  for (let i = 0; i < p; i++) { lp += (rnd() - lp) * bright; line[i] = lp; }
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const a = line[idx], c = line[(idx + 1) % p];
    const v = 0.4985 * (a + c);
    line[idx] = v;
    idx = (idx + 1) % p;
    b[i] = a * Math.min(1, i / 40) * Math.exp(-(i / SR) * 2.2);
  }
  return b;
}
function pad(notes, len, att = 0.5, rel = 0.8, cutoff = 1400) {
  const n = Math.round((len + rel) * SR), b = new Float32Array(n);
  const phs = [];
  for (const m of notes) for (const d of [-0.11, 0, 0.12]) phs.push({ f: mtof(m) * Math.pow(2, d / 12), p: Math.random() });
  let lp1 = 0, lp2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (const o of phs) { o.p += o.f / SR; o.p -= Math.floor(o.p); s += 2 * o.p - 1; }
    s /= phs.length;
    const cf = cutoff * (0.6 + 0.4 * Math.sin(t * 1.3));
    const k = 1 - Math.exp((-2 * Math.PI * cf) / SR);
    lp1 += (s - lp1) * k; lp2 += (lp1 - lp2) * k;
    const env = Math.min(1, t / att) * (t > len ? Math.exp(-(t - len) * (5 / rel)) : 1);
    b[i] = lp2 * env * 2.2;
  }
  return b;
}
function sub(len = 2.2, f0 = 70, f1 = 28) {
  const n = Math.round(len * SR), b = new Float32Array(n);
  let ph = 0, lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t * 3))) / SR;
    lp += (rnd() - lp) * 0.08;
    b[i] = Math.tanh(1.4 * Math.sin(ph)) * Math.exp(-t * 1.6) + lp * Math.exp(-t * 9) * 1.2;
  }
  return b;
}
function noiseSweep(len, f0, f1, shape) {
  // band-limited noise with a moving 2-pole lowpass minus a slower one (a soft bandpass)
  const n = Math.round(len * SR), b = new Float32Array(n);
  let a1 = 0, a2 = 0, h = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const f = f0 * Math.pow(f1 / f0, u);
    const k = 1 - Math.exp((-2 * Math.PI * f) / SR);
    const x = rnd();
    a1 += (x - a1) * k; a2 += (a1 - a2) * k;
    h += (a2 - h) * (k * 0.15);
    b[i] = (a2 - h) * shape(u) * 2.5;
  }
  return b;
}
const riser = (len) => noiseSweep(len, 300, 9000, (u) => Math.pow(u, 2.2));
const whoosh = (len = 0.5) => noiseSweep(len, 500, 6000, (u) => Math.sin(Math.PI * Math.pow(u, 0.7)) ** 2);
function bell(freq, len = 2.5) {
  const n = Math.round(len * SR), b = new Float32Array(n);
  const parts = [[1, 1, 1.8], [2.0, 0.45, 2.6], [2.76, 0.3, 3.4], [5.4, 0.12, 5], [8.93, 0.05, 7]];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (const [r, a, d] of parts) s += a * Math.sin(2 * Math.PI * freq * r * t) * Math.exp(-t * d);
    b[i] = s * Math.min(1, i / 60) * 0.5;
  }
  return b;
}

// ---- arrangement ----------------------------------------------------------------------------
// D  A/C#  Bm  G   (bar = 2 s)
const CHORDS = [
  { root: 50, pad: [62, 66, 69, 73], arp: [62, 66, 69, 74, 76, 74, 69, 66] },
  { root: 49, pad: [61, 64, 69, 73], arp: [61, 64, 69, 73, 76, 73, 69, 64] },
  { root: 47, pad: [62, 66, 71, 74], arp: [59, 62, 66, 71, 74, 71, 66, 62] },
  { root: 43, pad: [62, 67, 71, 74], arp: [59, 62, 67, 71, 74, 71, 67, 62] },
];
const bars = 15;
for (let bar = 0; bar < bars; bar++) {
  const t = bar * 2;
  const c = bar >= 14 ? CHORDS[0] : CHORDS[bar % 4];
  const last = bar >= 13;
  // pad (intro swells in from nothing)
  add(t, pad(c.pad, bar >= 14 ? 2.4 : 2.0, bar === 0 ? 1.6 : 0.25, 0.9, bar < 1 ? 700 : last ? 1100 : 1700), bar === 0 ? 0.16 : 0.13, 0, 0.5);
  // bass
  if (bar >= 1) {
    const bassNotes = bar >= 13 ? [0] : [0, 1.5];
    for (const o of bassNotes) add(t + o, pad([c.root - 12], o ? 0.35 : 1.2, 0.01, 0.2, 380), 0.34, 0);
  }
  // pluck arp — 8ths from the hero section, 16ths during the farming punch-cuts
  if (bar >= 1 && bar <= 12) {
    const step = bar >= 7 && bar <= 8 ? 0.125 : 0.25;
    for (let k = 0; k < 2 / step; k++) {
      const m = c.arp[k % 8] + (bar >= 9 && k % 8 === 4 ? 12 : 0);
      add(t + k * step, pluck(mtof(m), 0.8, 0.45), 0.2 * (k % 2 ? 0.7 : 1), k % 2 ? 0.35 : -0.35, 0.35);
    }
  }
}
// drums
function drums(from, to, { kicks = [0, 1, 2, 3], claps = [1, 3], hats = 'off' } = {}) {
  for (let t = from; t < to - 1e-6; t += BEAT) {
    const beat = Math.round(t / BEAT) % 4;
    if (kicks.includes(beat)) {
      add(t, kick(), 0.55);
      const s = Math.round(t * SR);
      for (let i = 0; i < SR * 0.3 && s + i < N; i++) duck[s + i] = Math.min(duck[s + i], 1 - 0.55 * Math.exp(-(i / SR) * 9));
    }
    if (claps.includes(beat)) add(t, clap(), 0.3, 0.05, 0.25);
    if (hats === 'off') add(t + BEAT / 2, hat(), 0.22, 0.3);
    if (hats === '16') for (const o of [0.125, 0.25, 0.375]) add(t + o, hat(o === 0.25), o === 0.25 ? 0.16 : 0.12, o === 0.25 ? 0.3 : -0.3);
  }
}
drums(2, 6, { claps: [], hats: 'none' });
drums(6, 10, {});
drums(10, 14, { kicks: [0], claps: [2], hats: 'none' }); // half-time: dusk falls
drums(14, 18, { hats: '16' });
drums(18, 22, {});
drums(22, 24, { hats: '16' });
// snare roll into the drop
for (let k = 0; k < 16; k++) add(24 + k * 0.125, clap(), 0.08 + 0.2 * (k / 16), 0, 0.2);

// impacts, risers, transitions
add(0.5, riser(1.5), 0.2, 0, 0.3);
for (const t of [2, 6, 10, 14, 18, 22]) add(t, sub(1.6), 0.4, 0, 0.1);
add(26, sub(3.4, 80, 26), 0.55, 0, 0.2);
add(8.0 - 2, riser(0.001), 0);
for (const t of [4.5, 13, 17.2]) add(t, riser(1.0), 0.09, 0, 0.3);
add(22.2, riser(3.8), 0.24, 0, 0.3);
for (const t of [6, 6.5, 7, 7.5]) add(t - 0.3, whoosh(0.5), 0.2, (t - 6.75) * 0.8, 0.2);
for (const t of [19, 20, 21, 22]) add(t - 0.22, whoosh(0.44), 0.3, t % 2 ? 0.4 : -0.4, 0.2);
for (const t of [11, 12, 13]) add(t - 0.05, bell(mtof(81), 1.4), 0.08, 0.3, 0.6);
for (let k = 0; k < 9; k++) add(22.25 + k * 0.1, pluck(mtof([74, 78, 81, 86, 90, 86, 81, 78, 93][k]), 0.6, 0.7), 0.1, (k % 3) - 1, 0.5);
// logo sting: bell arpeggio + shimmer
[74, 78, 81, 86, 90].forEach((m, k) => add(26.05 + k * 0.09, bell(mtof(m), 3.5), 0.14, -0.4 + k * 0.2, 0.7));
add(27.2, bell(mtof(98), 3), 0.06, 0.5, 0.8);
add(0.02, bell(mtof(86), 2.4), 0.1, 0, 0.8); // the spark

// ---- master: sidechain the pad bus, Schroeder reverb, soft clip, fades ------------------
for (let i = 0; i < N; i++) { L[i] *= 0.6 + 0.4 * duck[i]; R[i] *= 0.6 + 0.4 * duck[i]; }
function reverb(inp, combs, aps) {
  const out = new Float32Array(N);
  for (const [d, g] of combs) {
    const buf = new Float32Array(d); let ix = 0, lp = 0;
    for (let i = 0; i < N; i++) {
      const y = buf[ix]; lp += (y - lp) * 0.35;
      buf[ix] = inp[i] + lp * g; ix = (ix + 1) % d; out[i] += y * 0.25;
    }
  }
  for (const [d, g] of aps) {
    const buf = new Float32Array(d); let ix = 0;
    for (let i = 0; i < N; i++) {
      const b = buf[ix], x = out[i];
      const y = -g * x + b; buf[ix] = x + g * y; ix = (ix + 1) % d; out[i] = y;
    }
  }
  return out;
}
const s = SR / 44100;
const rvL = reverb(sendL, [1557, 1617, 1491, 1422].map((d) => [Math.round(d * s * 1.6), 0.86]), [[Math.round(225 * s), 0.7], [Math.round(556 * s), 0.7]]);
const rvR = reverb(sendR, [1580, 1640, 1510, 1450].map((d) => [Math.round(d * s * 1.6), 0.86]), [[Math.round(241 * s), 0.7], [Math.round(579 * s), 0.7]]);
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] += rvL[i] * 0.5; R[i] += rvR[i] * 0.5;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const pcm = Buffer.alloc(44 + N * 4);
const gainIn = 1.25 / Math.max(0.5, peak * 0.8);
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = Math.min(1, t / 0.02) * (t > 29 ? Math.max(0, (LEN - t) / (LEN - 29)) : 1);
  const l = Math.tanh(L[i] * gainIn) * 0.89 * fade, r = Math.tanh(R[i] * gainIn) * 0.89 * fade;
  pcm.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
  pcm.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
}
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + N * 4, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(N * 4, 40);
mkdirSync(resolve(root, 'shots/reel'), { recursive: true });
writeFileSync(resolve(root, 'shots/reel/music.wav'), pcm);
console.log(`[music] wrote shots/reel/music.wav (peak ${peak.toFixed(2)})`);
