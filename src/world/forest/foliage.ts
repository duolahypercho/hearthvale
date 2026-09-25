/**
 * Painterly foliage kit for Cindergrove's giants (and anything else that wants a leafy fringe):
 *
 *  - Leaf-cluster / needle-spray card textures (procedural DataTextures, R = value, G = blossom mask,
 *    A = coverage), so canopies get a leaf-level silhouette instead of a clay-smooth or crinkled shell.
 *  - CardBuilder: camera-facing billboard cards (the classic stylised-tree technique). Each card's
 *    centre sits on a canopy puff; its normal is the puff's spherical normal, so a whole canopy shades
 *    as a few soft, readable volumes while the cards break the outline into leaves.
 *  - applyBillboard / applyCardMap: vertex + fragment patches for those cards (works instanced, batched
 *    and in the depth pass, so shadows are leafy too).
 *  - applyPaintedLight: a soft 3-band ramp on the direct sun term (flat colour bands + a gentle
 *    terminator) — foliage reads hand-painted rather than plastic.
 *  - applySeeThrough: a screen-space round cut-away around the player for canopies that sit between
 *    the lens and the player, plus a near-lens dissolve: a leaf-sized world-space erosion with a wide
 *    feather (never a pixel screen door). Trunks and logs stay solid.
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { patchMaterial, after, before, replace } from '../../render/patch';
import { globalUniforms } from '../../render/uniforms';

// ───────────────────────────────────────────── textures

function dataTexture(data: Uint8Array, size: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

interface Layers {
  value: CanvasRenderingContext2D;
  alpha: CanvasRenderingContext2D;
  bloom: CanvasRenderingContext2D;
}

function layers(S: number): { l: Layers; compose: () => Uint8Array } {
  const mk = (): CanvasRenderingContext2D => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    return c.getContext('2d', { willReadFrequently: true })!;
  };
  const l: Layers = { value: mk(), alpha: mk(), bloom: mk() };
  // Background value = mid grey so filtered edges don't grow dark halos.
  l.value.fillStyle = 'rgb(150,150,150)';
  l.value.fillRect(0, 0, S, S);
  l.alpha.fillStyle = '#000';
  l.alpha.fillRect(0, 0, S, S);
  l.bloom.fillStyle = '#000';
  l.bloom.fillRect(0, 0, S, S);
  const compose = (): Uint8Array => {
    const v = l.value.getImageData(0, 0, S, S).data;
    const a = l.alpha.getImageData(0, 0, S, S).data;
    const b = l.bloom.getImageData(0, 0, S, S).data;
    const out = new Uint8Array(S * S * 4);
    // Canvas rows run top→down; textures sample bottom→up (flip so "up" on the card is up).
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const o = ((S - 1 - y) * S + x) * 4;
        out[o] = v[i]!;
        out[o + 1] = b[i]!;
        out[o + 2] = 0;
        out[o + 3] = a[i]!;
      }
    }
    return out;
  };
  return { l, compose };
}

/** Almond leaf path centred on (0,0), tip along +x. */
function leafPath(ctx: CanvasRenderingContext2D, len: number, w: number): void {
  ctx.beginPath();
  ctx.moveTo(-len * 0.5, 0);
  ctx.quadraticCurveTo(-len * 0.1, -w, len * 0.5, 0);
  ctx.quadraticCurveTo(-len * 0.1, w, -len * 0.5, 0);
  ctx.closePath();
}

let _leafTex: THREE.DataTexture | null = null;
/**
 * A round cluster of ~40 broad leaves: lighter, larger leaves on the rim / top, a darker heart,
 * every leaf with a soft base-to-tip gradient and a midrib. G marks five-petal blossoms (spring).
 */
export function leafClusterTexture(): THREE.DataTexture {
  if (_leafTex) return _leafTex;
  const S = 256;
  const { l, compose } = layers(S);
  const r = new Rng('forest-leaf-cluster');
  const C = S / 2;
  const leaves: { x: number; y: number; a: number; len: number; w: number; v: number }[] = [];
  for (let i = 0; i < 78; i++) {
    const f = Math.sqrt(r.next());
    const ang = r.next() * Math.PI * 2;
    const d = f * S * 0.36;
    const x = C + Math.cos(ang) * d;
    const y = C + Math.sin(ang) * d * 0.92;
    const len = 22 + r.next() * 14 + f * 6;
    const w = len * (0.34 + r.next() * 0.1);
    // Leaves point outward, a little droop.
    const a = ang + (r.next() - 0.5) * 0.9;
    // Rim leaves and the upper half catch the light; the heart is shaded.
    const v = 0.52 + f * 0.3 + (C - y) / S * 0.35 + (r.next() - 0.5) * 0.14;
    leaves.push({ x, y, a, len, w, v });
  }
  // Paint back to front: heart first, rim last (rim leaves overlap the heart).
  leaves.sort((p, q) => Math.hypot(p.x - C, p.y - C) - Math.hypot(q.x - C, q.y - C));
  for (const lf of leaves) {
    const tipX = lf.x + Math.cos(lf.a) * lf.len * 0.5;
    const tipY = lf.y + Math.sin(lf.a) * lf.len * 0.5;
    if (Math.hypot(tipX - C, tipY - C) > S * 0.49) continue;
    for (const ctx of [l.value, l.alpha]) {
      ctx.save();
      ctx.translate(lf.x, lf.y);
      ctx.rotate(lf.a);
      leafPath(ctx, lf.len, lf.w);
      if (ctx === l.alpha) {
        ctx.fillStyle = '#fff';
        ctx.fill();
      } else {
        const g = ctx.createLinearGradient(-lf.len * 0.5, 0, lf.len * 0.5, 0);
        const v0 = Math.round(Math.min(1, lf.v * 0.78) * 255);
        const v1 = Math.round(Math.min(1, lf.v * 1.08) * 255);
        g.addColorStop(0, `rgb(${v0},${v0},${v0})`);
        g.addColorStop(1, `rgb(${v1},${v1},${v1})`);
        ctx.fillStyle = g;
        ctx.fill();
        // Soft darker edge on the shadow side + midrib.
        ctx.strokeStyle = `rgba(40,40,40,0.35)`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-lf.len * 0.45, 0);
        ctx.lineTo(lf.len * 0.4, 0);
        ctx.strokeStyle = `rgba(30,30,30,0.28)`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  // Blossoms: small five-petal flowers sitting on top of the rim leaves.
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + r.next() * 0.8;
    const d = (0.35 + r.next() * 0.55) * S * 0.3;
    const x = C + Math.cos(ang) * d;
    const y = C + Math.sin(ang) * d;
    const pr = 11 + r.next() * 5;
    for (const ctx of [l.value, l.alpha, l.bloom]) {
      for (let k = 0; k < 5; k++) {
        const pa = (k / 5) * Math.PI * 2 + ang;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(pa) * pr * 0.8, y + Math.sin(pa) * pr * 0.8, pr * 0.72, pr * 0.5, pa, 0, Math.PI * 2);
        ctx.fillStyle = ctx === l.value ? `rgb(${230 - k * 6},${230 - k * 6},${230 - k * 6})` : '#fff';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, pr * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = ctx === l.value ? 'rgb(200,200,200)' : ctx === l.bloom ? 'rgb(90,90,90)' : '#fff';
      ctx.fill();
    }
  }
  _leafTex = dataTexture(compose(), S);
  return _leafTex;
}

let _needleTex: THREE.DataTexture | null = null;
/** A drooping fir spray: a twig down the card with dense needles fanning out and down both sides. */
export function needleSprayTexture(): THREE.DataTexture {
  if (_needleTex) return _needleTex;
  const S = 256;
  const { l, compose } = layers(S);
  const r = new Rng('forest-needles');
  const sprays = [
    { x: S * 0.5, y: S * 0.06, len: S * 0.86, a: Math.PI / 2, w: 1 },
    { x: S * 0.5, y: S * 0.3, len: S * 0.5, a: Math.PI / 2 - 0.7, w: 0.7 },
    { x: S * 0.5, y: S * 0.34, len: S * 0.5, a: Math.PI / 2 + 0.7, w: 0.7 },
    { x: S * 0.5, y: S * 0.58, len: S * 0.32, a: Math.PI / 2 - 0.9, w: 0.55 },
    { x: S * 0.5, y: S * 0.6, len: S * 0.32, a: Math.PI / 2 + 0.9, w: 0.55 },
  ];
  for (const sp of sprays) {
    const n = Math.round(sp.len / 3.2);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const px = sp.x + Math.cos(sp.a) * sp.len * t;
      const py = sp.y + Math.sin(sp.a) * sp.len * t;
      const nl = (18 + r.next() * 8) * sp.w * (1 - t * 0.55);
      for (const side of [-1, 1]) {
        const na = sp.a + side * (0.95 + r.next() * 0.3) - side * 0.25;
        const ex = px + Math.cos(na) * nl;
        const ey = py + Math.sin(na) * nl + nl * 0.25;
        const v = Math.round((0.55 + 0.35 * (1 - t) + (r.next() - 0.5) * 0.15 + (side < 0 ? 0.06 : -0.04)) * 255);
        for (const ctx of [l.value, l.alpha]) {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo((px + ex) / 2, (py + ey) / 2 - 2, ex, ey);
          ctx.strokeStyle = ctx === l.alpha ? '#fff' : `rgb(${v},${v},${v})`;
          ctx.lineWidth = 3.4 * sp.w + 0.6;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      }
    }
    for (const ctx of [l.value, l.alpha]) {
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(sp.x + Math.cos(sp.a) * sp.len * 0.95, sp.y + Math.sin(sp.a) * sp.len * 0.95);
      ctx.strokeStyle = ctx === l.alpha ? '#fff' : 'rgb(90,80,70)';
      ctx.lineWidth = 3 * sp.w;
      ctx.stroke();
    }
  }
  _needleTex = dataTexture(compose(), S);
  return _needleTex;
}

let _ivyTex: THREE.DataTexture | null = null;
/** Ivy spray: a branching stem with heart-shaped leaves (tower ivy curtains). */
export function ivyTexture(): THREE.DataTexture {
  if (_ivyTex) return _ivyTex;
  const S = 256;
  const { l, compose } = layers(S);
  const r = new Rng('forest-ivy');
  const stems: [number, number, number, number][] = [[S * 0.5, S * 0.02, Math.PI / 2 + 0.05, S * 0.9]];
  for (let i = 0; i < 4; i++) stems.push([S * 0.5, S * (0.15 + i * 0.18), Math.PI / 2 + (i % 2 ? 0.8 : -0.8), S * (0.35 - i * 0.04)]);
  for (const [x0, y0, a, len] of stems) {
    const n = Math.round(len / 14);
    for (const ctx of [l.value, l.alpha]) {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
      ctx.strokeStyle = ctx === l.alpha ? '#fff' : 'rgb(110,90,70)';
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const px = x0 + Math.cos(a) * len * t;
      const py = y0 + Math.sin(a) * len * t;
      const side = i % 2 ? 1 : -1;
      const la = a + side * (1.1 + r.next() * 0.4);
      const sz = (12 + r.next() * 6) * (1 - t * 0.35);
      const cx = px + Math.cos(la) * sz * 0.7;
      const cy = py + Math.sin(la) * sz * 0.7;
      const v = Math.round((0.6 + r.next() * 0.3) * 255);
      for (const ctx of [l.value, l.alpha]) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(la + Math.PI / 2);
        ctx.beginPath();
        // Three-lobed ivy leaf.
        ctx.moveTo(0, sz * 0.55);
        ctx.quadraticCurveTo(-sz * 0.9, sz * 0.1, -sz * 0.45, -sz * 0.3);
        ctx.quadraticCurveTo(-sz * 0.2, -sz * 0.2, 0, -sz * 0.6);
        ctx.quadraticCurveTo(sz * 0.2, -sz * 0.2, sz * 0.45, -sz * 0.3);
        ctx.quadraticCurveTo(sz * 0.9, sz * 0.1, 0, sz * 0.55);
        ctx.fillStyle = ctx === l.alpha ? '#fff' : `rgb(${v},${v},${v})`;
        ctx.fill();
        ctx.restore();
      }
    }
  }
  _ivyTex = dataTexture(compose(), S);
  return _ivyTex;
}

let _ivyLeafTex: THREE.DataTexture | null = null;
/**
 * Ivy leaf cluster: 5-7 big three-lobed leaves fanning out from a short stem at the card's lower
 * middle, each with a light-to-dark gradient, a darker rim and pale veins (reads at diorama zoom).
 */
export function ivyLeafTexture(): THREE.DataTexture {
  if (_ivyLeafTex) return _ivyLeafTex;
  const S = 256;
  const { l, compose } = layers(S);
  const r = new Rng('forest-ivy-leaves');
  const n = 6;
  const base = { x: S * 0.5, y: S * 0.86 };
  const leaves: { x: number; y: number; a: number; sz: number; v: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / (n - 1) - 0.5) * 2.6 + (r.next() - 0.5) * 0.25;
    const d = S * (0.2 + r.next() * 0.16);
    leaves.push({ x: base.x + Math.cos(a) * d, y: base.y + Math.sin(a) * d * 1.05, a, sz: S * (0.2 + r.next() * 0.08), v: 0.62 + r.next() * 0.3 });
  }
  leaves.push({ x: S * 0.5, y: S * 0.36, a: -Math.PI / 2, sz: S * 0.27, v: 0.9 });
  const heart = (ctx: CanvasRenderingContext2D, sz: number): void => {
    ctx.beginPath();
    ctx.moveTo(0, sz * 0.55);
    ctx.bezierCurveTo(-sz * 0.35, sz * 0.4, -sz * 0.95, sz * 0.25, -sz * 0.62, -sz * 0.18);
    ctx.quadraticCurveTo(-sz * 0.35, -sz * 0.2, -sz * 0.25, -sz * 0.32);
    ctx.quadraticCurveTo(-sz * 0.15, -sz * 0.75, 0, -sz * 0.9);
    ctx.quadraticCurveTo(sz * 0.15, -sz * 0.75, sz * 0.25, -sz * 0.32);
    ctx.quadraticCurveTo(sz * 0.35, -sz * 0.2, sz * 0.62, -sz * 0.18);
    ctx.bezierCurveTo(sz * 0.95, sz * 0.25, sz * 0.35, sz * 0.4, 0, sz * 0.55);
    ctx.closePath();
  };
  for (const ctx of [l.value, l.alpha]) {
    // Stems first.
    for (const lf of leaves) {
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.quadraticCurveTo((base.x + lf.x) / 2, (base.y + lf.y) / 2 + 6, lf.x, lf.y + lf.sz * 0.4);
      ctx.strokeStyle = ctx === l.alpha ? '#fff' : 'rgb(95,80,60)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
  for (const lf of leaves) {
    for (const ctx of [l.value, l.alpha]) {
      ctx.save();
      ctx.translate(lf.x, lf.y);
      ctx.rotate(lf.a + Math.PI / 2);
      heart(ctx, lf.sz);
      if (ctx === l.alpha) {
        ctx.fillStyle = '#fff';
        ctx.fill();
      } else {
        const g = ctx.createLinearGradient(0, lf.sz * 0.5, 0, -lf.sz * 0.9);
        const v0 = Math.round(lf.v * 0.72 * 255);
        const v1 = Math.round(Math.min(1, lf.v * 1.05) * 255);
        g.addColorStop(0, `rgb(${v0},${v0},${v0})`);
        g.addColorStop(1, `rgb(${v1},${v1},${v1})`);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(40,40,40,0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Pale veins radiating from the leaf base.
        ctx.strokeStyle = 'rgba(235,235,235,0.35)';
        ctx.lineWidth = 1.4;
        for (const t of [-0.55, 0, 0.55]) {
          ctx.beginPath();
          ctx.moveTo(0, lf.sz * 0.45);
          ctx.lineTo(Math.sin(t) * lf.sz * 0.62, lf.sz * 0.45 - Math.cos(t) * lf.sz * 1.05);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }
  _ivyLeafTex = dataTexture(compose(), S);
  return _ivyLeafTex;
}

// ───────────────────────────────────────────── cards

/**
 * Accumulates camera-facing cards. `position` holds the card centre (so wind / world FX treat it
 * like any vertex), `aCorner` the rotated corner offset the vertex shader expands along the view
 * plane, `normal` the shading normal (puff / crown sphere), `color` tint × AO.
 */
export class CardBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private corner: number[] = [];
  private idx: number[] = [];

  get count(): number {
    return this.pos.length / 12;
  }

  add(center: THREE.Vector3, normal: THREE.Vector3, w: number, h: number, rot: number, color: THREE.Color, opts: { anchorY?: number } = {}): void {
    const base = this.pos.length / 3;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    // anchorY: 0.5 = centred; 1 = the card hangs below its centre (needle sprays hang from the bough).
    const ay = opts.anchorY ?? 0.5;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
      const x = (u - 0.5) * w;
      const y = (v - ay) * h;
      this.pos.push(center.x, center.y, center.z);
      this.nor.push(normal.x, normal.y, normal.z);
      this.uv.push(u, v);
      this.col.push(color.r, color.g, color.b);
      this.corner.push(x * c - y * s, x * s + y * c);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute(this.corner, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    // Billboards reach up to half a card beyond their centres.
    if (g.boundingSphere) g.boundingSphere.radius += 1.5;
    return g;
  }
}

/**
 * Expand `aCorner` along the camera's right / up axes (in the current pass's view, so the shadow
 * pass turns the cards to the sun). Apply AFTER applyWind so the expansion happens first.
 */
export function applyBillboard<M extends THREE.Material>(m: M): M {
  return patchMaterial(m, 'hv-billboard', (shader) => {
    let vs = shader.vertexShader;
    vs = before(vs, 'void main() {', 'attribute vec2 aCorner;');
    vs = after(
      vs,
      '#include <begin_vertex>',
      /* glsl */ `
      {
        mat4 hvBm = modelMatrix;
        #ifdef USE_INSTANCING
          hvBm = modelMatrix * instanceMatrix;
        #endif
        #ifdef USE_BATCHING
          hvBm = modelMatrix * batchingMatrix;
        #endif
        vec3 hvCR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 hvCU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        transformed += inverse(mat3(hvBm)) * (hvCR * aCorner.x + hvCU * aCorner.y);
      }`,
    );
    shader.vertexShader = vs;
  });
}

/**
 * Card texture read: value (R) multiplies the tint, coverage (A) drives alphaTest, and — when
 * `blossom` — spring blossoms (G) bloom pink-white on a share of the cards (per-card hash).
 */
export function applyCardMap<M extends THREE.Material>(m: M, blossom = false): M {
  return patchMaterial(m, `hv-card-map:${blossom ? 1 : 0}`, (shader) => {
    shader.uniforms.uSeasonW = globalUniforms.uSeasonW;
    let fs = shader.fragmentShader;
    if (!fs.includes('uniform vec4 uSeasonW;')) fs = before(fs, 'void main() {', 'uniform vec4 uSeasonW;');
    fs = replace(
      fs,
      '#include <map_fragment>',
      /* glsl */ `
      vec4 hvCard = texture2D(map, vMapUv);
      diffuseColor.rgb *= 0.35 + hvCard.r * 0.95;
      diffuseColor.a *= hvCard.a;
      {
        // Autumn crowns are never one stamped colour: soft patches drift russet / amber / straw
        // (about ±0.04 hue) so neighbouring crowns and clumps read as different leaves.
        float hvJ = hvNoise(vHvWorldPos.xz * 0.55 + vHvWorldPos.y * 0.37 + 17.0);
        vec3 hvJc = mix(vec3(1.14, 0.86, 0.78), vec3(0.94, 1.08, 0.9), smoothstep(0.2, 0.8, hvJ));
        diffuseColor.rgb *= mix(vec3(1.0), hvJc, uSeasonW.z * 0.8);
      }
      ${
        blossom
          ? `{
        float hvBr = hvHash12(floor(vHvWorldPos.xz * 1.3) + floor(vHvWorldPos.y * 1.3) * 7.0);
        float hvBl = hvCard.g * uSeasonW.x * step(0.45, hvBr);
        vec3 hvBc = mix(vec3(1.0, 0.62, 0.78), vec3(1.0, 0.9, 0.94), fract(hvBr * 5.3));
        diffuseColor.rgb = mix(diffuseColor.rgb, hvBc * (0.6 + hvCard.r * 0.5), hvBl);
      }`
          : ''
      }`,
    );
    shader.fragmentShader = fs;
  });
}

/**
 * Painterly sun ramp: replaces Lambert N·L on the direct term with three soft bands (shadow side,
 * mid tone, lit crown) while keeping cast shadows and cloud shadows (the ratio multiplies them).
 */
export function applyPaintedLight<M extends THREE.Material>(m: M, strength = 1): M {
  return patchMaterial(m, `hv-painted:${strength}`, (shader) => {
    shader.uniforms.uSunDir = globalUniforms.uSunDir;
    let fs = shader.fragmentShader;
    if (!fs.includes('uniform vec3 uSunDir;')) fs = before(fs, 'void main() {', 'uniform vec3 uSunDir;');
    fs = after(
      fs,
      '#include <lights_fragment_end>',
      /* glsl */ `
      {
        vec3 hvLv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
        float hvNl = dot(normal, hvLv);
        float hvRamp = 0.16 * smoothstep(-0.05, 0.12, hvNl) + 0.42 * smoothstep(0.12, 0.34, hvNl) + 0.36 * smoothstep(0.5, 0.78, hvNl);
        float hvK = hvNl > 0.02 ? hvRamp / hvNl : 1.0;
        reflectedLight.directDiffuse *= mix(1.0, clamp(hvK, 0.0, 6.0), ${strength.toFixed(3)});
      }`,
    );
    shader.fragmentShader = fs;
  });
}

// ───────────────────────────────────────────── see-through

/** Screen-space cut-away around the player (updated every frame by the forest map). */
export const seeThrough = {
  uOccCenter: { value: new THREE.Vector2(-1e4, -1e4) },
  uOccRadius: { value: 0 },
  uOccDepth: { value: 0 },
  /** Player feet (world): shrubs / low leaves within ~1.2 m of the farmer part around them. */
  uOccPlayer: { value: new THREE.Vector3(1e4, 0, 1e4) },
  /**
   * Main camera view-projection + drawing-buffer size: the window is computed from the fragment's
   * WORLD position, so half-res prepasses (AO normals / depth) cut exactly the same holes as the
   * colour pass (gl_FragCoord differs per pass → holes in the depth that the fog read as sky).
   */
  uOccVP: { value: new THREE.Matrix4() },
  uOccBuf: { value: new THREE.Vector2(1920, 1080) },
};

const _v = new THREE.Vector3();
/**
 * Project the player's chest into drawing-buffer pixels; radius scales with the view height.
 * `wide` (0..1) opens a larger window (the entry corridor: ~4 tiles).
 */
export function updateSeeThrough(camera: THREE.Camera, player: THREE.Vector3, bufW: number, bufH: number, wide = 0): void {
  _v.copy(player).add(new THREE.Vector3(0, 0.8, 0)).project(camera);
  seeThrough.uOccCenter.value.set((_v.x * 0.5 + 0.5) * bufW, (_v.y * 0.5 + 0.5) * bufH);
  seeThrough.uOccRadius.value = bufH * (0.13 + 0.14 * wide);
  seeThrough.uOccDepth.value = camera.position.distanceTo(player);
  seeThrough.uOccPlayer.value.copy(player);
  seeThrough.uOccVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  seeThrough.uOccBuf.value.set(bufW, bufH);
}

const IGN = 'float hvIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }';

/**
 * Canopy fragments that sit in front of the player inside a round screen-space window open up; so
 * do canopies right in front of the lens (closer than `near` m). The cut-away is a world-space,
 * leaf-sized erosion (value noise at ~3 cells / m, a little pixel noise only to soften its rim) with a
 * wide ~44 px feather, so the canopy parts into leafy clumps instead of a pixel screen door.
 * Trunks never use this (they stay solid). `keepExpr` (GLSL) can force fragments solid.
 */
export function applySeeThrough<M extends THREE.Material>(m: M, near = 3, nearRange = 5, keepExpr = '0.0'): M {
  return patchMaterial(m, `hv-see-through2:${near}:${nearRange}:${keepExpr}`, (shader) => {
    Object.assign(shader.uniforms, seeThrough);
    let fs = shader.fragmentShader;
    fs = before(fs, 'void main() {', `uniform vec2 uOccCenter;\nuniform float uOccRadius;\nuniform float uOccDepth;\nuniform vec3 uOccPlayer;\nuniform mat4 uOccVP;\nuniform vec2 uOccBuf;\n${IGN}`);
    fs = after(
      fs,
      'void main() {',
      /* glsl */ `
      {
        float hvCamD = length(vHvWorldPos - cameraPosition);
        float hvKeep = smoothstep(${near.toFixed(2)}, ${(near + nearRange).toFixed(2)}, hvCamD);
        vec4 hvClip = uOccVP * vec4(vHvWorldPos, 1.0);
        vec2 hvScr = (hvClip.xy / hvClip.w * 0.5 + 0.5) * uOccBuf;
        float hvPx = length(hvScr - uOccCenter);
        float hvFront = smoothstep(uOccDepth - 0.4, uOccDepth - 1.6, hvCamD);
        // Round window around the farmer + a keyhole running down-screen from it to the frame's
        // bottom edge (the corridor between lens and farmer), so the ground in front of the farmer
        // is never walled off by a crown in the foreground.
        vec2 hvD = hvScr - uOccCenter;
        float hvKey = (1.0 - smoothstep(uOccRadius * 0.3, uOccRadius * 0.95, abs(hvD.x))) * smoothstep(0.0, -uOccRadius * 0.6, hvD.y);
        float hvHole = max(1.0 - smoothstep(uOccRadius * 0.62, uOccRadius * 1.05, hvPx), hvKey) * hvFront;
        // Leaves at knee-to-head height within ~1.2 m of the farmer (shrubs he walks through).
        float hvNear = (1.0 - smoothstep(0.75, 1.25, length(vHvWorldPos.xz - uOccPlayer.xz))) * (1.0 - smoothstep(1.7, 2.3, vHvWorldPos.y - uOccPlayer.y));
        hvHole = max(hvHole, hvNear * smoothstep(uOccDepth + 0.8, uOccDepth - 0.3, hvCamD));
        hvKeep = min(hvKeep, max(1.0 - hvHole, clamp(${keepExpr}, 0.0, 1.0)));
        if (hvKeep < 0.999) {
          vec3 hvQ = vHvWorldPos * 3.1;
          // Pure world-space erosion (no per-pixel noise: that is what read as a screen-door hatch).
          float hvE = hvNoise(hvQ.xz + hvQ.y * 0.73) * 0.68 + hvNoise(hvQ.zy * 1.7 + 5.1) * 0.32;
          if (hvKeep < hvE * 0.94 + 0.03) discard;
        }
      }`,
    );
    shader.fragmentShader = fs;
  });
}
