/**
 * Procedural 3D fish, painted from a FishDef `look`: a lofted body (superellipse cross-sections
 * along a species profile), a canvas skin (back → side → belly gradient, pattern, scale shimmer,
 * lateral line), fins (tail by type, dorsal, anal, pectorals) and glossy eyes. Unit length along
 * +X (head at -X), side facing +Z. Used for the "held up" catch pose and fish leaping at sea.
 */
import * as THREE from 'three';
import type { FishDef } from '../../data/fish';

const skinCache = new Map<string, THREE.CanvasTexture>();

function css(c: number, k = 1): string {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const b = Math.min(255, Math.round((c & 255) * k));
  return `rgb(${r},${g},${b})`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Skin texture: u = nose → peduncle, v = around the body (0 / 1 = dorsal line, 0.5 = belly). */
function skin(def: FishDef): THREE.CanvasTexture {
  let t = skinCache.get(def.id);
  if (t) return t;
  const W = 256;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const k = def.look;
  // Vertical colour: mirror around v = 0.5 (belly).
  const grad = g.createLinearGradient(0, 0, 0, H);
  const stops: [number, number][] = [
    [0, k.back],
    [0.14, k.back],
    [0.3, k.side],
    [0.42, k.belly],
    [0.5, k.belly],
    [0.58, k.belly],
    [0.7, k.side],
    [0.86, k.back],
    [1, k.back],
  ];
  for (const [o, col] of stops) grad.addColorStop(o, css(col, o === 0 || o === 1 ? 0.85 : 1));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  let seed = hash(def.id);
  const rnd = (): number => {
    seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return seed / 4294967296;
  };
  const pc = css(k.patternColor);
  g.fillStyle = pc;
  g.strokeStyle = pc;
  // Pattern drawn on one flank (v 0..0.5) and mirrored to the other.
  const flank = (fn: () => void): void => {
    fn();
    g.save();
    g.translate(0, H);
    g.scale(1, -1);
    fn();
    g.restore();
  };
  switch (k.pattern) {
    case 'stripes':
      flank(() => {
        g.globalAlpha = 0.75;
        g.lineWidth = 5;
        for (const v of [0.08, 0.17, 0.26, 0.35]) {
          g.beginPath();
          g.moveTo(0, v * H);
          g.bezierCurveTo(W * 0.3, v * H - 4, W * 0.6, v * H + 5, W, v * H + (0.25 - v) * H * 0.5);
          g.stroke();
        }
      });
      break;
    case 'bars':
      flank(() => {
        g.globalAlpha = 0.7;
        for (let i = 0; i < 5; i++) {
          const x = W * (0.22 + i * 0.15);
          g.beginPath();
          g.ellipse(x, H * 0.12, 9, H * 0.26, 0.1, 0, Math.PI * 2);
          g.fill();
        }
      });
      break;
    case 'spots':
      flank(() => {
        g.globalAlpha = 0.9;
        for (let i = 0; i < 26; i++) {
          g.beginPath();
          g.arc(W * (0.12 + rnd() * 0.85), H * (0.04 + rnd() * 0.36), 2 + rnd() * 5, 0, Math.PI * 2);
          g.fill();
        }
      });
      break;
    case 'speckle':
      flank(() => {
        g.globalAlpha = 0.6;
        for (let i = 0; i < 140; i++) {
          g.beginPath();
          g.arc(W * rnd(), H * (0.02 + rnd() * 0.38), 0.8 + rnd() * 1.6, 0, Math.PI * 2);
          g.fill();
        }
      });
      break;
    case 'band':
      flank(() => {
        g.globalAlpha = 0.85;
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(W * 0.1, H * 0.25);
        g.quadraticCurveTo(W * 0.5, H * 0.22, W, H * 0.25);
        g.stroke();
      });
      break;
  }
  // Scale shimmer + lateral line.
  g.globalAlpha = 0.16;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 1;
  for (let y = 4; y < H; y += 7) {
    for (let x = 28 + ((y / 7) % 2) * 4; x < W - 4; x += 8) {
      g.beginPath();
      g.arc(x, y, 4, -Math.PI * 0.45, Math.PI * 0.45);
      g.stroke();
    }
  }
  g.globalAlpha = 0.45;
  g.strokeStyle = css(k.back, 0.6);
  g.lineWidth = 1.5;
  flank(() => {
    g.beginPath();
    g.moveTo(W * 0.12, H * 0.2);
    g.quadraticCurveTo(W * 0.5, H * 0.17, W, H * 0.25);
    g.stroke();
  });
  // Head: gill arc + slightly darker snout.
  g.globalAlpha = 0.35;
  g.strokeStyle = css(k.side, 0.5);
  g.lineWidth = 2.5;
  flank(() => {
    g.beginPath();
    g.arc(W * 0.14, H * 0.25, H * 0.2, -Math.PI * 0.5, Math.PI * 0.5);
    g.stroke();
  });
  g.globalAlpha = 1;
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  skinCache.set(def.id, t);
  return t;
}

/** Body half-depth profile along s (0 nose → 1 peduncle). */
function profile(s: number, eel: boolean): number {
  if (eel) return Math.min(1, Math.pow(s / 0.08, 0.6)) * (1 - 0.45 * Math.pow(s, 2));
  const rise = Math.pow(Math.sin(Math.min(1, s / 0.38) * Math.PI * 0.5), 0.75);
  const fall = s < 0.38 ? 1 : 1 - Math.pow((s - 0.38) / 0.62, 1.7) * 0.8;
  return Math.max(0.03, rise * fall);
}

export interface FishMesh {
  group: THREE.Group;
  /** Wiggle the body (0 = still); call per frame. */
  flex(t: number, amount: number): void;
}

const _v = new THREE.Vector3();

export function buildFishMesh(def: FishDef): FishMesh {
  const k = def.look;
  const eel = k.tail === 'eel';
  const L = 1;
  const Lb = eel ? 0.94 : 0.8; // body length (tail fin takes the rest)
  const D = (eel ? 0.13 : k.depth) * L;
  const Wd = (eel ? 0.1 : k.width) * L;
  const x0 = -L / 2;
  const NS = 28;
  const NR = 18;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= NS; i++) {
    const s = i / NS;
    const p = profile(s, eel);
    const hd = (D / 2) * p;
    const hw = (Wd / 2) * Math.pow(p, 0.85) * (k.flat ? 0.6 : 1);
    for (let j = 0; j <= NR; j++) {
      const th = (j / NR) * Math.PI * 2;
      const cy = Math.cos(th);
      const sy = Math.sin(th);
      // Slightly flatter belly, rounder back.
      const y = hd * Math.sign(cy) * Math.pow(Math.abs(cy), cy > 0 ? 0.9 : 1.1);
      const z = hw * Math.sign(sy) * Math.pow(Math.abs(sy), 0.8);
      pos.push(x0 + s * Lb, y - (k.flat ? 0 : D * 0.03 * s), z);
      uv.push(s, j / NR);
    }
  }
  for (let i = 0; i < NS; i++) {
    for (let j = 0; j < NR; j++) {
      const a = i * (NR + 1) + j;
      const b = a + NR + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bodyGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  bodyGeo.setIndex(idx);
  bodyGeo.computeVertexNormals();
  const basePos = Float32Array.from(pos);

  const bodyMat = new THREE.MeshStandardMaterial({ map: skin(def), roughness: 0.3, metalness: 0.12, envMapIntensity: 1.3 });
  bodyMat.name = 'fishSkin';
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;

  // Fins: flat shapes (double sided), a single merged geometry.
  const fins: THREE.BufferGeometry[] = [];
  const xp = x0 + Lb;
  const ph = (D / 2) * profile(1, eel);
  const tl = eel ? 0.08 : Math.max(0.16, D * 0.55);
  const th = eel ? D * 0.5 : Math.max(0.12, D * 0.5);
  const tail = new THREE.Shape();
  tail.moveTo(0, ph);
  switch (k.tail) {
    case 'fork':
      tail.bezierCurveTo(tl * 0.5, th * 0.6, tl * 0.8, th, tl, th * 1.05);
      tail.bezierCurveTo(tl * 0.72, th * 0.35, tl * 0.55, 0, tl * 0.55, 0);
      tail.bezierCurveTo(tl * 0.55, 0, tl * 0.72, -th * 0.35, tl, -th * 1.05);
      tail.bezierCurveTo(tl * 0.8, -th, tl * 0.5, -th * 0.6, 0, -ph);
      break;
    case 'moon':
      tail.bezierCurveTo(tl * 0.4, th * 0.5, tl * 0.9, th * 1.1, tl * 1.05, th * 1.3);
      tail.bezierCurveTo(tl * 0.7, th * 0.4, tl * 0.6, 0, tl * 0.6, 0);
      tail.bezierCurveTo(tl * 0.6, 0, tl * 0.7, -th * 0.4, tl * 1.05, -th * 1.3);
      tail.bezierCurveTo(tl * 0.9, -th * 1.1, tl * 0.4, -th * 0.5, 0, -ph);
      break;
    case 'fan':
      tail.bezierCurveTo(tl * 0.5, th * 0.9, tl * 1.1, th * 1.2, tl * 1.15, th * 0.6);
      tail.bezierCurveTo(tl * 1.3, th * 0.2, tl * 1.3, -th * 0.2, tl * 1.15, -th * 0.6);
      tail.bezierCurveTo(tl * 1.1, -th * 1.2, tl * 0.5, -th * 0.9, 0, -ph);
      break;
    case 'eel':
      tail.bezierCurveTo(tl * 0.6, ph * 1.1, tl, ph * 0.4, tl * 1.3, 0);
      tail.bezierCurveTo(tl, -ph * 0.4, tl * 0.6, -ph * 1.1, 0, -ph);
      break;
    default:
      tail.bezierCurveTo(tl * 0.6, th * 0.9, tl * 1.05, th * 0.75, tl * 1.05, 0);
      tail.bezierCurveTo(tl * 1.05, -th * 0.75, tl * 0.6, -th * 0.9, 0, -ph);
  }
  tail.lineTo(0, ph);
  fins.push(new THREE.ShapeGeometry(tail, 8).translate(xp - 0.01, -D * 0.03, 0));
  const topAt = (s: number): number => (D / 2) * profile(s, eel) - D * 0.03 * s;
  if (k.dorsal > 0.05) {
    const s0 = eel ? 0.15 : 0.3;
    const s1 = eel ? 0.98 : 0.78;
    const dh = k.dorsal * D * 0.42;
    const sh = new THREE.Shape();
    sh.moveTo(x0 + s0 * Lb, topAt(s0) - 0.01);
    if (k.dorsal >= 0.7) {
      const n = 6;
      for (let i = 0; i <= n; i++) {
        const s = s0 + ((s1 - s0) * i) / n;
        const hh = dh * (1 - Math.pow((i / n) * 1.1 - 0.35, 2) * 0.9);
        sh.lineTo(x0 + s * Lb + 0.01, topAt(s) + hh);
        sh.lineTo(x0 + (s + (s1 - s0) / n * 0.7) * Lb, topAt(s) + hh * 0.6);
      }
    } else {
      sh.bezierCurveTo(x0 + (s0 + (s1 - s0) * 0.15) * Lb, topAt(s0) + dh * 1.2, x0 + (s0 + (s1 - s0) * 0.5) * Lb, topAt(s0) + dh * 1.1, x0 + s1 * Lb, topAt(s1) + dh * 0.1);
    }
    sh.lineTo(x0 + s1 * Lb, topAt(s1) - 0.01);
    sh.lineTo(x0 + s0 * Lb, topAt(s0) - 0.01);
    fins.push(new THREE.ShapeGeometry(sh, 6));
  }
  // Anal fin (mirror of a small dorsal on the belly).
  {
    const s0 = eel ? 0.35 : 0.6;
    const s1 = eel ? 0.98 : 0.84;
    const bot = (s: number): number => -(D / 2) * profile(s, eel) - D * 0.03 * s;
    const sh = new THREE.Shape();
    sh.moveTo(x0 + s0 * Lb, bot(s0) + 0.01);
    sh.bezierCurveTo(x0 + (s0 + 0.03) * Lb, bot(s0) - D * 0.28, x0 + (s1 - 0.05) * Lb, bot(s1) - D * 0.2, x0 + s1 * Lb, bot(s1) + 0.005);
    sh.lineTo(x0 + s0 * Lb, bot(s0) + 0.01);
    fins.push(new THREE.ShapeGeometry(sh, 6));
  }
  // Pectorals: small paddles angled back on each flank.
  for (const side of [-1, 1]) {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0);
    sh.bezierCurveTo(0.05, 0.02, 0.12, -0.01, 0.14, -0.06);
    sh.bezierCurveTo(0.08, -0.07, 0.03, -0.04, 0, 0);
    const g = new THREE.ShapeGeometry(sh, 5);
    g.scale(Math.max(0.6, D * 2.4), Math.max(0.6, D * 2.4), 1);
    g.rotateY(side * 0.55);
    g.translate(x0 + Lb * 0.24, -D * 0.1, side * (Wd / 2) * 0.85);
    fins.push(g);
  }
  const finGeo = mergeFlat(fins);
  const finMat = new THREE.MeshStandardMaterial({ color: k.fin, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  finMat.name = 'fishFin';
  const finMesh = new THREE.Mesh(finGeo, finMat);
  finMesh.castShadow = true;

  // Eyes: white sclera, dark pupil, catch-light (vertex colours, one mesh).
  const eyeParts: THREE.BufferGeometry[] = [];
  const er = Math.max(0.028, D * 0.1);
  const ex = x0 + Lb * (eel ? 0.06 : 0.1);
  const ey = k.flat ? D * 0.2 : D * 0.12;
  const eyeSides = k.flat ? [1, 1] : [-1, 1];
  eyeSides.forEach((side, i) => {
    const zOff = side * ((Wd / 2) * profile(0.1, eel) * 0.8);
    const xo = k.flat && i === 1 ? er * 2.6 : 0;
    const scl = new THREE.SphereGeometry(er, 12, 8).translate(ex + xo, ey, zOff);
    const pup = new THREE.SphereGeometry(er * 0.62, 10, 6).translate(ex + xo - er * 0.05, ey, zOff + side * er * 0.55);
    const hl = new THREE.SphereGeometry(er * 0.2, 6, 4).translate(ex + xo - er * 0.3, ey + er * 0.35, zOff + side * er * 0.95);
    paint(scl, 0xf6f4ea);
    paint(pup, 0x12161c);
    paint(hl, 0xffffff);
    eyeParts.push(scl, pup, hl);
  });
  const eyeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0 });
  eyeMat.name = 'fishEye';
  const eyes = new THREE.Mesh(mergeFlat(eyeParts), eyeMat);

  const group = new THREE.Group();
  group.name = `fish:${def.id}`;
  group.add(body, finMesh, eyes);
  group.userData.noAO = true;
  const finBase = Float32Array.from((finGeo.attributes.position as THREE.BufferAttribute).array as Float32Array);
  const eyeBase = Float32Array.from((eyes.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array);

  // Body wiggle: lateral (z) sine travelling towards the tail, growing with s.
  const bend = (x: number, t: number, amt: number): number => {
    const s = (x - x0) / L;
    return Math.sin(s * 6.5 - t * 12) * amt * Math.pow(Math.max(0, s), 1.6) * 0.12;
  };
  const apply = (attr: THREE.BufferAttribute, base: Float32Array, t: number, amt: number): void => {
    const a = attr.array as Float32Array;
    for (let i = 0; i < a.length; i += 3) {
      a[i] = base[i]!;
      a[i + 1] = base[i + 1]!;
      a[i + 2] = base[i + 2]! + bend(base[i]!, t, amt);
    }
    attr.needsUpdate = true;
  };
  let lastAmt = 0;
  return {
    group,
    flex(t, amount) {
      if (amount === 0 && lastAmt === 0) return;
      lastAmt = amount;
      apply(bodyGeo.attributes.position as THREE.BufferAttribute, basePos, t, amount);
      bodyGeo.computeVertexNormals();
      apply(finGeo.attributes.position as THREE.BufferAttribute, finBase, t, amount);
      apply(eyes.geometry.attributes.position as THREE.BufferAttribute, eyeBase, t, amount);
    },
  };
}

function paint(g: THREE.BufferGeometry, c: number): void {
  const col = new THREE.Color(c);
  const n = g.attributes.position!.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = col.r;
    a[i * 3 + 1] = col.g;
    a[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
}

/** Merge geometries after flattening indices and keeping only position / normal / uv / color. */
function mergeFlat(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position!.count;
  const hasColor = parts.every((g) => g.attributes.color);
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const C = hasColor ? new Float32Array(n * 3) : null;
  let o = 0;
  for (const g of parts) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const c = g.attributes.position!.count;
    P.set((g.attributes.position as THREE.BufferAttribute).array as Float32Array, o * 3);
    N.set((g.attributes.normal as THREE.BufferAttribute).array as Float32Array, o * 3);
    if (C) C.set((g.attributes.color as THREE.BufferAttribute).array as Float32Array, o * 3);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  if (C) out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  void _v;
  return out;
}
