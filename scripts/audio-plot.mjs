/**
 * Plot helpers for scripts/audio-render.mjs: writes a PNG per render with
 *   - a piano roll of the composed score (colour per track, bar lines, section + chord labels),
 *   - a log-frequency spectrogram (40 Hz – 16 kHz, -96..-12 dBFS),
 *   - a momentary loudness strip.
 * No dependencies: raw RGB buffer + zlib PNG encoder + a 5x7 bitmap font.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePng(path, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// 5x7 font (rows as 5-bit masks).
const F = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12], '-': [0, 0, 0, 31, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12],
  '/': [1, 1, 2, 4, 8, 16, 16], ':': [0, 12, 12, 0, 12, 12, 0], ' ': [0, 0, 0, 0, 0, 0, 0], '#': [10, 10, 31, 10, 31, 10, 10],
  b: [16, 16, 22, 25, 17, 17, 30], m: [0, 0, 26, 21, 21, 17, 17], a: [0, 0, 14, 1, 15, 17, 15], j: [2, 0, 6, 2, 2, 18, 12],
  s: [0, 0, 15, 16, 14, 1, 30], u: [0, 0, 17, 17, 17, 19, 13], d: [1, 1, 13, 19, 17, 17, 15], i: [4, 0, 12, 4, 4, 4, 14],
  v: [0, 0, 17, 17, 17, 10, 4], x: [0, 0, 17, 10, 4, 10, 17], z: [0, 0, 31, 2, 4, 8, 31], ø: [0, 1, 14, 19, 21, 25, 46],
};

class Canvas {
  constructor(w, h, bg = [16, 14, 22]) {
    this.w = w;
    this.h = h;
    this.px = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) this.px.set(bg, i * 3);
  }
  set(x, y, c, a = 1) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    for (let k = 0; k < 3; k++) this.px[i + k] = Math.round(this.px[i + k] * (1 - a) + c[k] * a);
  }
  rect(x0, y0, x1, y1, c, a = 1) {
    for (let y = Math.max(0, y0 | 0); y < Math.min(this.h, y1); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(this.w, x1); x++) this.set(x, y, c, a);
  }
  text(x, y, s, c = [230, 225, 210], scale = 1) {
    let cx = x;
    for (const ch of String(s)) {
      const g = F[ch] ?? F[ch.toUpperCase()] ?? F[' '];
      for (let r = 0; r < 7; r++) for (let b = 0; b < 5; b++) if (g[r] & (16 >> b)) this.rect(cx + b * scale, y + r * scale, cx + (b + 1) * scale, y + (r + 1) * scale, c);
      cx += 6 * scale;
    }
  }
  save(path) {
    writePng(path, this.w, this.h, this.px);
  }
}

const TRACK_COLORS = {
  melody: [255, 196, 90], double: [255, 150, 70], counter: [120, 200, 255], accomp: [150, 230, 140],
  accomp2: [110, 190, 170], bass: [230, 110, 140], pad: [170, 140, 240], perc: [200, 200, 200],
};

function magma(t) {
  const stops = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
  const x = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return stops[i].map((v, k) => v + (stops[i + 1][k] - v) * f);
}

function fftMag(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const br = re[b] * cr - im[b] * ci, bi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - br; im[b] = im[a] - bi; re[a] += br; im[a] += bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/**
 * @param {string} path  output PNG
 * @param {Float32Array} inter interleaved stereo
 * @param {number} sr
 * @param {{title:string, sub?:string, piece?:{events:any[], bars:any[]}, markers?:{name:string,t:number}[]}} o
 */
export function plotRender(path, inter, sr, o) {
  const W = 1600;
  const hasRoll = !!o.piece;
  const rollH = hasRoll ? 330 : 0;
  const specH = 300;
  const H = 40 + rollH + (hasRoll ? 12 : 0) + specH + 60;
  const c = new Canvas(W, H);
  const n = inter.length / 2;
  const seconds = n / sr;
  const X0 = 50, X1 = W - 12;
  const tx = (t) => X0 + (t / seconds) * (X1 - X0);
  c.text(12, 12, o.title.toUpperCase(), [255, 230, 180], 2);
  if (o.sub) c.text(12 + (o.title.length + 2) * 12, 18, o.sub.toUpperCase(), [170, 165, 160]);
  let y = 40;
  if (hasRoll) {
    const { events, bars } = o.piece;
    const lo = 26, hi = 100;
    const py = (m) => y + rollH - ((m - lo) / (hi - lo)) * rollH;
    c.rect(X0, y, X1, y + rollH, [24, 22, 32]);
    for (let m = lo; m <= hi; m++) if ([1, 3, 6, 8, 10].includes(m % 12)) c.rect(X0, py(m + 1), X1, py(m), [20, 18, 27]);
    for (let m = 36; m <= 96; m += 12) {
      c.rect(X0, py(m) - 1, X1, py(m), [48, 44, 60]);
      c.text(8, py(m) - 8, `C${m / 12 - 1}`, [120, 115, 130]);
    }
    for (const b of bars) {
      const x = tx(b.t);
      c.rect(x, y, x + 1, y + rollH, [70, 64, 86]);
      c.text(x + 3, y + 3, b.chords.replace(/maj/g, 'M'), [200, 190, 170]);
      if (b.section) c.text(x + 3, y + 13, b.section.toUpperCase(), [255, 200, 120]);
    }
    for (const e of events) {
      if (e.track === 'perc') {
        const x = tx(e.t);
        c.rect(x, y + rollH - 8, x + 2, y + rollH - 2, TRACK_COLORS.perc, 0.5 + 0.5 * e.vel);
        continue;
      }
      const col = TRACK_COLORS[e.track] ?? [255, 255, 255];
      const x0 = tx(e.t), x1 = Math.max(x0 + 2, tx(e.t + e.dur));
      c.rect(x0, py(e.midi + 0.5), x1, py(e.midi - 0.5), col, Math.min(1, 0.35 + 0.65 * e.vel));
    }
    const entries = Object.entries(TRACK_COLORS);
    let lx = X1 - entries.reduce((a, [k]) => a + 11 + k.length * 6 + 14, 0);
    for (const [k, col] of entries) {
      c.rect(lx, y + rollH + 3, lx + 8, y + rollH + 10, col);
      c.text(lx + 11, y + rollH + 3, k.toUpperCase(), [180, 175, 170]);
      lx += 11 + k.length * 6 + 14;
    }
    y += rollH + 12;
  }
  // Spectrogram.
  const N = 2048, hop = Math.max(256, Math.floor(n / (X1 - X0)));
  const fLo = 40, fHi = 16000;
  const cols = X1 - X0;
  const re = new Float64Array(N), im = new Float64Array(N);
  const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  for (let col = 0; col < cols; col++) {
    const s = Math.floor((col / cols) * n) - N / 2;
    for (let i = 0; i < N; i++) {
      const k = s + i;
      re[i] = k >= 0 && k < n ? ((inter[k * 2] + inter[k * 2 + 1]) * 0.5) * win[i] : 0;
      im[i] = 0;
    }
    fftMag(re, im);
    for (let row = 0; row < specH; row++) {
      const f = fLo * Math.pow(fHi / fLo, 1 - row / specH);
      const bin = (f * N) / sr;
      const b0 = Math.floor(bin);
      const m = Math.hypot(re[b0], im[b0]) * (1 - (bin - b0)) + Math.hypot(re[b0 + 1], im[b0 + 1]) * (bin - b0);
      const dbv = 20 * Math.log10(m / (N / 4) + 1e-9);
      c.set(X0 + col, y + row, magma((dbv + 96) / 84));
    }
  }
  for (const f of [100, 250, 500, 1000, 2000, 5000, 10000]) {
    const row = specH * (1 - Math.log(f / fLo) / Math.log(fHi / fLo));
    c.rect(X0 - 4, y + row, X0, y + row + 1, [200, 200, 200]);
    c.text(4, y + row - 3, f >= 1000 ? `${f / 1000}K` : `${f}`, [150, 145, 140]);
  }
  y += specH + 6;
  // Loudness strip (momentary RMS in dBFS, -60..0).
  const bh = 40;
  c.rect(X0, y, X1, y + bh, [24, 22, 32]);
  const blk = Math.max(1, Math.floor(n / cols));
  for (let col = 0; col < cols; col++) {
    let e = 0, pk = 0;
    for (let i = col * blk; i < Math.min(n, (col + 1) * blk); i++) {
      const v = (inter[i * 2] + inter[i * 2 + 1]) * 0.5;
      e += v * v;
      pk = Math.max(pk, Math.abs(inter[i * 2]), Math.abs(inter[i * 2 + 1]));
    }
    const r = 10 * Math.log10(e / blk + 1e-12);
    const p = 20 * Math.log10(pk + 1e-12);
    const hR = Math.max(0, Math.min(1, (r + 60) / 60)) * bh;
    const hP = Math.max(0, Math.min(1, (p + 60) / 60)) * bh;
    c.rect(X0 + col, y + bh - hP, X0 + col + 1, y + bh, p > -1 ? [255, 60, 60] : [90, 80, 120]);
    c.rect(X0 + col, y + bh - hR, X0 + col + 1, y + bh, [130, 210, 160]);
  }
  c.text(4, y + 2, '0DB', [150, 145, 140]);
  c.text(4, y + bh - 8, '-60', [150, 145, 140]);
  if (o.markers) for (const m of o.markers) {
    const x = tx(m.t);
    c.rect(x, 40, x + 1, y + bh, [255, 255, 255], 0.25);
  }
  for (let s = 0; s <= seconds; s += 5) c.text(tx(s) - 4, y + bh + 4, `${s}`, [150, 145, 140]);
  c.save(path);
}
