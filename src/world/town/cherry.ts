/**
 * Town r14 — hero cherry trees (critic r9 / r13: "the cherry tree is a pink cotton-candy blob with no
 * branch breakup"). Each town cherry is grown on its own: a short leaning trunk forking into four or
 * five arching boughs that fork again, a cloud-puff blossom cluster on every fork tip (flat, shaded
 * undersides, gaps between them so the dark wood shows through), a few crown puffs, twigs poking out.
 * The blossom shader paints individual five-petal florets (a 3D cellular pattern: pale petals, a
 * magenta eye, deep rose in the gaps), cooler mauve under the clusters and a sun-side glow. In spring
 * petals lie in a drift under each tree and a few flutter down out of the crown; summer turns the
 * clusters green, fall amber, winter leaves the bare boughs.
 *
 * Rendering: every tree is its own geometry in one BatchPool (bark + blossom = 2 draws, +2 shadow),
 * one instanced draw for the fallen petals and one for the falling ones (~45k triangles for 8 trees).
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import type { Season } from '../../core/time';
import { MeshBuilder, lumpySphere, smoothNormals, sphericalNormals, uvScale } from '../geom';
import { textures } from '../../render/textures';
import { applyWind, windDepthMaterial } from '../../render/wind';
import { applyWorldFx } from '../../render/worldfx';
import { patchMaterial, after, before } from '../../render/patch';
import { globalUniforms } from '../../render/uniforms';
import { InstancedSet, BatchPool } from '../props/instanced';

const WIND_TRUNK = { mode: 'attribute' as const, amplitude: 0.12, flutter: 0 };
const WIND_LEAF = { mode: 'attribute' as const, amplitude: 0.13, flutter: 0.45 };

/** Canopy colour per season (the blossom shader paints spring itself; null = bare). */
const CANOPY: Record<Season, number | null> = { spring: 0xffffff, summer: 0x5f9f3e, fall: 0xe0923a, winter: null };

const uBloom = { value: 1 };

let barkMat: THREE.MeshStandardMaterial | null = null;
function cherryBark(): THREE.MeshStandardMaterial {
  if (barkMat) return barkMat;
  const t = textures.bark();
  // Cherry bark: a darker, redder grey-brown than the oaks (lenticel bands come from the bark map).
  barkMat = new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 2.2, roughness: 0.9, vertexColors: true, color: 0x9c7c74 });
  barkMat.name = 'cherryBark';
  applyWorldFx(barkMat, { snowUp: 0.62 });
  applyWind(barkMat, WIND_TRUNK);
  return barkMat;
}

let bloomMat: THREE.MeshStandardMaterial | null = null;
function cherryBloom(): THREE.MeshStandardMaterial {
  if (bloomMat) return bloomMat;
  const t = textures.leaves();
  const m = new THREE.MeshStandardMaterial({ bumpMap: t.bump, bumpScale: 0.8, roughness: 0.82, vertexColors: true, color: 0xffffff });
  m.name = 'cherryBloom';
  applyWorldFx(m, { snowUp: 0.6 });
  applyWind(m, WIND_LEAF);
  patchMaterial(m, 'town-cherry-bloom', (shader) => {
    shader.uniforms.uSunDir = globalUniforms.uSunDir;
    shader.uniforms.uSunColor = globalUniforms.uSunColor;
    shader.uniforms.uBloom = uBloom;
    let fs = shader.fragmentShader;
    if (!fs.includes('uniform vec3 uSunDir;')) fs = before(fs, 'void main() {', 'uniform vec3 uSunDir;\nuniform vec3 uSunColor;');
    fs = before(
      fs,
      'void main() {',
      /* glsl */ `uniform float uBloom;
vec3 hvCh33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}
// Nearest floret: x = distance, yzw = that cell's random.
vec4 hvFloret(vec3 P) {
  vec3 ip = floor(P);
  vec3 fp = fract(P);
  float d1 = 9.0;
  vec3 cid = vec3(0.0);
  for (int k = -1; k <= 1; k++)
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        vec3 o = vec3(float(i), float(j), float(k));
        vec3 h = hvCh33(ip + o);
        vec3 r = o + 0.15 + h * 0.7 - fp;
        float d = dot(r, r);
        if (d < d1) { d1 = d; cid = h; }
      }
  return vec4(sqrt(d1), cid);
}`,
    );
    fs = after(
      fs,
      '#include <color_fragment>',
      /* glsl */ `
      {
        vec3 Nw = normalize(vHvWorldNormal);
        float up = Nw.y;
        float top = smoothstep(0.15, 0.95, up);
        float under = smoothstep(0.05, -0.7, up);
        // Leafy clump breakup (summer / fall canopies).
        vec3 lp = vHvWorldPos * 2.6;
        float clump = hvNoise(lp.xz + lp.y * 0.7) * 0.6 + hvNoise(lp.zy * 1.9 + 3.0) * 0.4;
        vec3 leaf = diffuseColor.rgb * (0.8 + 0.34 * smoothstep(0.2, 0.8, clump));
        leaf = mix(leaf, leaf * vec3(1.1, 1.08, 0.86), top * 0.5);
        // Blossom: florets ~11 cm apart (two scales so the canopy never tiles), each a pale five-petal
        // disc with a magenta eye; deep rose shows in the gaps; cooler mauve under the clusters.
        vec4 f = hvFloret(vHvWorldPos * 15.0);
        vec4 g = hvFloret(vHvWorldPos * 26.0 + 17.0);
        float ang = atan(f.z - 0.5, f.w - 0.5);
        float petalR = 0.4 + 0.1 * cos(5.0 * (ang + f.y * 6.28));
        // a few cells are still buds (small, deep pink), the rest open florets
        float bud = step(0.82, f.y);
        float fl = (1.0 - smoothstep(petalR - 0.12, petalR + 0.02, f.x)) * (1.0 - bud * 0.6);
        // a finer second floret layer between the first (no large discs: at talk range they read as polka dots)
        float big = 1.0 - smoothstep(0.24, 0.4, g.x);
        float clumpT = smoothstep(0.25, 0.75, hvNoise(vHvWorldPos.xz * 3.4 + vHvWorldPos.y * 2.9));
        float eye = 1.0 - smoothstep(0.05, 0.1, f.x);
        float tone = hvNoise(vHvWorldPos.xz * 1.3 + vHvWorldPos.y * 0.9);
        vec3 deep = mix(vec3(0.84, 0.28, 0.42), vec3(0.95, 0.42, 0.52), tone);
        vec3 petal = mix(vec3(1.0, 0.72, 0.79), vec3(1.0, 0.88, 0.9), f.z);
        float cover = max(fl, big * 0.45) * mix(0.55, 1.0, smoothstep(-0.4, 0.7, up)) * mix(0.7, 1.0, clumpT);
        vec3 bl = mix(deep, petal, cover);
        bl = mix(bl, vec3(0.86, 0.28, 0.4), eye * fl * 0.65);
        bl = mix(bl, bl * vec3(1.06, 1.02, 1.0), top * 0.4);
        bl = mix(bl, bl * vec3(0.74, 0.54, 0.62), under * 0.7);
        bl *= diffuseColor.rgb;
        diffuseColor.rgb = mix(leaf, bl, uBloom);
      }`,
    );
    fs = after(
      fs,
      '#include <emissivemap_fragment>',
      /* glsl */ `
      {
        vec3 Vw = normalize(cameraPosition - vHvWorldPos);
        float back = pow(max(dot(-Vw, normalize(uSunDir)), 0.0), 3.0);
        float rim = pow(1.0 - max(dot(normalize(vHvWorldNormal), Vw), 0.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * uSunColor * (back * 0.4 + rim * mix(0.12, 0.2, uBloom));
      }`,
    );
    shader.fragmentShader = fs;
  });
  bloomMat = m;
  return m;
}

const _up = new THREE.Vector3(0, 1, 0);

/** A straight tapered limb piece a → b. */
function limb(r0: number, r1: number, a: THREE.Vector3, b: THREE.Vector3, radial: number): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 1, false);
  uvScale(g, 1, len * 0.8);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

/** A curved tapering bough (quadratic arc a → c → e in `seg` pieces, overlapping at the joints). */
function bough(b: MeshBuilder, m: THREE.Material, r0: number, r1: number, a: THREE.Vector3, c: THREE.Vector3, e: THREE.Vector3, seg: number, radial: number, ao: (p: THREE.Vector3) => number): THREE.QuadraticBezierCurve3 {
  const curve = new THREE.QuadraticBezierCurve3(a, c, e);
  let prev = a.clone();
  for (let i = 1; i <= seg; i++) {
    const t0 = (i - 1) / seg;
    const t1 = i / seg;
    const next = curve.getPoint(t1);
    const from = prev.clone().lerp(next, -0.08);
    b.add(m, limb(THREE.MathUtils.lerp(r0, r1, Math.pow(t0, 0.85)), THREE.MathUtils.lerp(r0, r1, Math.pow(t1, 0.85)), from, next, radial), undefined, { aoWorld: ao });
    prev = next;
  }
  return curve;
}

interface CherryGeo {
  bark: THREE.BufferGeometry;
  bloom: THREE.BufferGeometry;
  /** Crown centre + radius (falling petals start here). */
  crown: THREE.Vector3;
  spread: number;
}

/** Grow one cherry (local space, base at the origin). */
function growCherry(rng: Rng): CherryGeo {
  const b = new MeshBuilder();
  const bark = cherryBark();
  const bloom = cherryBloom();
  const forkH = 1.05 + rng.next() * 0.3;
  const lean = new THREE.Vector3((rng.next() - 0.5) * 0.5, 0, (rng.next() - 0.5) * 0.5);
  const fork = new THREE.Vector3(lean.x, forkH, lean.z);
  const trunkAO = (p: THREE.Vector3): number => 0.5 + 0.5 * THREE.MathUtils.smoothstep(p.y, 0, 1.1);
  // Trunk: a gentle S (two arcs) with a flared foot.
  bough(b, bark, 0.25, 0.17, new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(-lean.x * 0.6, forkH * 0.5, -lean.z * 0.6), fork, 3, 10, trunkAO);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.next() * 0.7;
    const len = 0.42 + rng.next() * 0.3;
    b.add(bark, limb(0.15, 0.03, new THREE.Vector3(0, 0.36, 0), new THREE.Vector3(Math.cos(a) * len, -0.07, Math.sin(a) * len), 6), undefined, { aoWorld: trunkAO });
  }
  const puffs: { c: THREE.Vector3; r: number }[] = [];
  const nMain = 4 + rng.int(0, 1);
  const base = rng.next() * Math.PI * 2;
  let spread = 0;
  for (let i = 0; i < nMain; i++) {
    const a = base + (i / nMain) * Math.PI * 2 + (rng.next() - 0.5) * 0.5;
    const out = 1.05 + rng.next() * 0.4;
    const rise = 0.75 + rng.next() * 0.45;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const start = fork.clone().add(dir.clone().multiplyScalar(0.06));
    const end = fork.clone().add(dir.clone().multiplyScalar(out)).add(new THREE.Vector3(0, rise, 0));
    const ctrl = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.05, 0)).add(dir.clone().multiplyScalar(-0.15));
    const main = bough(b, bark, 0.15, 0.07, start, ctrl, end, 3, 7, trunkAO);
    // Two forks off the end of each bough, splayed sideways, each ending in a blossom cluster.
    for (const side of [-1, 1]) {
      const s0 = main.getPoint(0.72 + rng.next() * 0.12);
      const sa = a + side * (0.35 + rng.next() * 0.3);
      const sd = new THREE.Vector3(Math.cos(sa), 0, Math.sin(sa));
      const len = 0.55 + rng.next() * 0.45;
      const tip = s0.clone().add(sd.clone().multiplyScalar(len)).add(new THREE.Vector3(0, 0.2 + rng.next() * 0.35, 0));
      const c = s0.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, 0.08, 0));
      bough(b, bark, 0.065, 0.02, s0, c, tip, 2, 5, trunkAO);
      const r = 0.6 + rng.next() * 0.2;
      puffs.push({ c: tip.clone().add(new THREE.Vector3(0, r * 0.32, 0)), r });
      spread = Math.max(spread, Math.hypot(tip.x - lean.x, tip.z - lean.z) + r);
      // A bare twig poking out past the cluster (the wood reads through the blossom).
      if (rng.next() < 0.6) {
        const tw = tip.clone().add(sd.clone().multiplyScalar(0.45 + rng.next() * 0.2)).add(new THREE.Vector3((rng.next() - 0.5) * 0.3, -0.05 + rng.next() * 0.25, (rng.next() - 0.5) * 0.3));
        b.add(bark, limb(0.022, 0.006, tip, tw, 4), undefined, { aoWorld: trunkAO });
      }
    }
    // A smaller cluster midway along some boughs (layers the canopy, keeps gaps).
    if (rng.next() < 0.55) {
      const m0 = main.getPoint(0.5);
      puffs.push({ c: m0.clone().add(new THREE.Vector3(0, 0.42, 0)).add(dir.clone().multiplyScalar(0.1)), r: 0.48 + rng.next() * 0.12 });
    }
  }
  // Crown: two or three clusters riding over the fork, a leader bough up into them.
  const crownTop = fork.clone().add(new THREE.Vector3((rng.next() - 0.5) * 0.3, 1.55 + rng.next() * 0.25, (rng.next() - 0.5) * 0.3));
  bough(b, bark, 0.11, 0.035, fork, fork.clone().lerp(crownTop, 0.5).add(new THREE.Vector3(0.1, 0, -0.05)), crownTop, 2, 6, trunkAO);
  const nCrown = 2 + rng.int(0, 1);
  for (let i = 0; i < nCrown; i++) {
    const a = rng.next() * Math.PI * 2;
    const rr = i === 0 ? 0 : 0.42 + rng.next() * 0.2;
    puffs.push({ c: crownTop.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0.2 - i * 0.12, Math.sin(a) * rr)), r: 0.72 + rng.next() * 0.14 });
  }
  // Clusters: lumpy puffs with flat, tucked undersides (cloud layering) and baked AO — dark where they
  // face into the crown or down, a little warmer / paler per cluster.
  const crown = new THREE.Vector3(fork.x, fork.y + 1.2, fork.z);
  for (const p of puffs) {
    const pc = p.c.clone();
    const r = p.r;
    const inward = new THREE.Vector3(crown.x - pc.x, 0, crown.z - pc.z);
    if (inward.lengthSq() < 1e-4) inward.set(1, 0, 0);
    inward.normalize();
    const ao = (q: THREE.Vector3, n: THREE.Vector3): number => {
      const dy = (q.y - pc.y) / r;
      const facesIn = Math.max(0, n.x * inward.x + n.z * inward.z);
      const low = THREE.MathUtils.smoothstep(dy, -0.75, 0.5);
      const height = THREE.MathUtils.smoothstep(q.y, forkH, forkH + 2.3);
      return (0.4 + 0.6 * low) * (1 - facesIn * 0.25) * (0.82 + 0.18 * height);
    };
    const v = 0.93 + rng.next() * 0.1;
    const tint = new THREE.Color(v, v * (0.96 + rng.next() * 0.04), v);
    // A cluster = one body + three or four smaller lobes riding its upper / outer surface (a
    // cauliflower outline, not a smooth stone), all with flat tucked undersides.
    const lobes: { c: THREE.Vector3; r: number; d: number }[] = [{ c: pc, r, d: 2 }];
    const nl = 3 + rng.int(0, 1);
    const out = inward.clone().negate();
    for (let i = 0; i < nl; i++) {
      const a = (i / nl) * Math.PI * 2 + rng.next() * 0.9;
      const dir = new THREE.Vector3(Math.cos(a), 0.55 + rng.next() * 0.5, Math.sin(a)).add(out.clone().multiplyScalar(0.5)).normalize();
      const lr = r * (0.42 + rng.next() * 0.14);
      lobes.push({ c: pc.clone().add(dir.multiplyScalar(r * 0.78)), r: lr, d: 1 });
    }
    for (const l of lobes) {
      const g = lumpySphere(l.r, l.d, l.d === 2 ? 0.22 : 0.16, rng, 2.4);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < 0) pos.setY(i, y * 0.6);
      }
      smoothNormals(g);
      uvScale(g, 1.5, 1.1);
      g.translate(l.c.x, l.c.y, l.c.z);
      sphericalNormals(g, pc.clone().lerp(l.c, 0.5), 0.45);
      b.add(bloom, g, undefined, { aoWorld: ao, tint });
    }
  }
  const geos = b.geometries();
  const barkG = geos.get(bark)!;
  const bloomG = geos.get(bloom)!;
  const H = crownTop.y + 0.9;
  const wind = (g: THREE.BufferGeometry, fn: (p: THREE.Vector3) => number): void => {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const w = new Float32Array(pos.count);
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) w[i] = fn(p.fromBufferAttribute(pos, i));
    g.setAttribute('aWind', new THREE.BufferAttribute(w, 1));
  };
  wind(barkG, (p) => Math.pow(THREE.MathUtils.clamp(p.y / H, 0, 1), 2) * 0.75);
  wind(bloomG, (p) => 0.3 + 0.7 * THREE.MathUtils.clamp((p.y - forkH * 0.6) / (H - forkH * 0.6), 0, 1));
  return { bark: barkG, bloom: bloomG, crown, spread };
}

export interface CherryHandle {
  set: InstancedSet;
  id: number;
  petals: number[];
}

/** A cherry petal: an oval with a notch at the outer tip (fan of 9 points), in the XY plane. */
function petalGeometry(len: number, wid: number): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(0, -len * 0.5);
  sh.bezierCurveTo(wid * 0.9, -len * 0.3, wid * 0.75, len * 0.38, wid * 0.22, len * 0.5);
  sh.lineTo(0, len * 0.4);
  sh.lineTo(-wid * 0.22, len * 0.5);
  sh.bezierCurveTo(-wid * 0.75, len * 0.38, -wid * 0.9, -len * 0.3, 0, -len * 0.5);
  return new THREE.ShapeGeometry(sh, 3);
}

/** Falling petal flutter (vertex shader: each petal loops down out of its tree's crown). */
function fallingPetalMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffd6e2, roughness: 0.7, side: THREE.DoubleSide, emissive: 0x4a1a28, emissiveIntensity: 0.25 });
  m.name = 'cherryPetalFall';
  patchMaterial(m, 'town-cherry-fall', (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    let vs = shader.vertexShader;
    vs = before(vs, 'void main() {', 'uniform float uTime;\nattribute vec4 aFall;');
    vs = after(
      vs,
      '#include <begin_vertex>',
      /* glsl */ `
      {
        // aFall: x = phase, y = drop height, z = drift radius, w = spin rate.
        float t = fract(uTime * 0.055 * (0.8 + aFall.w * 0.4) + aFall.x);
        float ang = aFall.x * 37.0 + uTime * (1.6 + aFall.w * 2.2);
        float ca = cos(ang), sa = sin(ang);
        transformed.yz = mat2(ca, -sa, sa, ca) * transformed.yz;
        transformed.xy = mat2(cos(ang * 0.7), -sin(ang * 0.7), sin(ang * 0.7), cos(ang * 0.7)) * transformed.xy;
        transformed *= smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.9, 1.0, t));
        float sw = uTime * (0.9 + aFall.w) + aFall.x * 12.0;
        transformed += vec3(sin(sw) * 0.35 + t * aFall.z, -t * aFall.y, cos(sw * 0.8) * 0.3 + t * aFall.z * 0.4);
      }`,
    );
    // (a petal drifting right past the lens is a big pink card: none nearer than 6 m)
    vs = after(vs, '#include <project_vertex>', 'if (-mvPosition.z < 6.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);');
    shader.vertexShader = vs;
  });
  return m;
}

export class CherryTrees {
  readonly group = new THREE.Group();
  private pool = new BatchPool('cherry');
  private fallen: THREE.InstancedMesh | null = null;
  private falling: THREE.InstancedMesh | null = null;
  private pending: { x: number; y: number; z: number; s: number; crown: THREE.Vector3; spread: number; rot: number }[] = [];
  private count = 0;

  constructor(
    private rng: Rng,
    private heightAt: (x: number, z: number) => number,
  ) {
    this.group.name = 'cherries';
    this.group.userData.perfTag = 'trees';
    // (under a 'trees' node: the talk / heart-event lens finds tree crowns there and hides any that
    // loom between it and the pair, and tests sight lines against them)
    const t = new THREE.Group();
    t.name = 'trees';
    t.add(this.pool.group);
    this.group.add(t);
  }

  add(x: number, y: number, z: number, scale = 1): CherryHandle {
    const r = this.rng.fork(`cherry-${this.count++}`);
    const geo = growCherry(r);
    const depth = windDepthMaterial(WIND_LEAF);
    const set = new InstancedSet(`cherry-${this.count}`, [
      { geometry: geo.bark, material: cherryBark(), depthMaterial: windDepthMaterial(WIND_TRUNK) },
      { geometry: geo.bloom, material: cherryBloom(), tinted: true, depthMaterial: depth },
    ], this.pool);
    const rot = r.next() * Math.PI * 2;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(_up, rot), new THREE.Vector3(scale, scale * (0.95 + r.next() * 0.1), scale));
    const v = 0.95 + r.next() * 0.08;
    const id = set.add(m, new THREE.Color(v, v * (0.97 + r.next() * 0.04), v * (0.98 + r.next() * 0.04)));
    this.pending.push({ x, y, z, s: scale, crown: geo.crown.clone().applyAxisAngle(_up, rot).multiplyScalar(scale).add(new THREE.Vector3(x, y, z)), spread: geo.spread * scale, rot });
    return { set, id, petals: [] };
  }

  remove(h: CherryHandle): void {
    h.set.remove(h.id);
  }

  /** Builds the petal drifts and the falling petals (after every tree is placed). */
  finalize(): void {
    const r = this.rng.fork('cherry-petals');
    const PER = 320;
    const FALL = 26;
    const n = this.pending.length;
    if (!n) return;
    // A petal, not a square of paper: a notched oval (heart-ish tip), lying flat.
    const petal = petalGeometry(0.05, 0.034);
    petal.rotateX(-Math.PI / 2);
    const fallenMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    fallenMat.name = 'cherryPetalFallen';
    applyWorldFx(fallenMat, { snowUp: 0.3 });
    const fallen = new THREE.InstancedMesh(petal, fallenMat, n * PER);
    fallen.name = 'cherry:petals';
    fallen.castShadow = false;
    fallen.receiveShadow = true;
    const M = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const col = new THREE.Color();
    let k = 0;
    for (const t of this.pending) {
      for (let i = 0; i < PER; i++) {
        // Denser under the crown, thinning out downwind (+x) past its edge.
        const a = r.next() * Math.PI * 2;
        const d = Math.sqrt(r.next()) * t.spread * (0.55 + 0.75 * r.next());
        const px = t.crown.x + Math.cos(a) * d + Math.max(0, Math.cos(a)) * d * 0.25;
        const pz = t.crown.z + Math.sin(a) * d;
        e.set((r.next() - 0.5) * 0.4, r.next() * Math.PI * 2, (r.next() - 0.5) * 0.4);
        q.setFromEuler(e);
        const s = 0.7 + r.next() * 0.7;
        M.compose(new THREE.Vector3(px, this.heightAt(px, pz) + 0.02 + r.next() * 0.012, pz), q, new THREE.Vector3(s, s, s));
        fallen.setMatrixAt(k, M);
        const w = r.next();
        fallen.setColorAt(k, col.setRGB(0.98, 0.6 + w * 0.18, 0.7 + w * 0.12));
        k++;
      }
    }
    fallen.instanceMatrix.needsUpdate = true;
    if (fallen.instanceColor) fallen.instanceColor.needsUpdate = true;
    fallen.computeBoundingSphere();
    this.fallen = fallen;
    this.group.add(fallen);

    const fg = petalGeometry(0.045, 0.03);
    const falling = new THREE.InstancedMesh(fg, fallingPetalMaterial(), n * FALL);
    const aFall = new Float32Array(n * FALL * 4);
    k = 0;
    for (const t of this.pending) {
      for (let i = 0; i < FALL; i++) {
        const a = r.next() * Math.PI * 2;
        const d = Math.sqrt(r.next()) * t.spread * 0.85;
        M.makeTranslation(t.crown.x + Math.cos(a) * d, t.crown.y + 0.2 + r.next() * 0.6, t.crown.z + Math.sin(a) * d);
        falling.setMatrixAt(k, M);
        aFall[k * 4] = r.next();
        aFall[k * 4 + 1] = t.crown.y - t.y + 0.6;
        aFall[k * 4 + 2] = 0.6 + r.next() * 1.2;
        aFall[k * 4 + 3] = r.next();
        k++;
      }
    }
    fg.setAttribute('aFall', new THREE.InstancedBufferAttribute(aFall, 4));
    falling.instanceMatrix.needsUpdate = true;
    falling.frustumCulled = false;
    falling.castShadow = false;
    falling.name = 'cherry:falling';
    this.falling = falling;
    this.group.add(falling);
  }

  setSeason(season: Season): void {
    const c = CANOPY[season];
    const bloom = cherryBloom();
    uBloom.value = season === 'spring' ? 1 : 0;
    if (c !== null) bloom.color.setHex(c);
    for (const mesh of this.pool.meshesFor(bloom)) mesh.visible = c !== null;
    if (this.fallen) this.fallen.visible = season === 'spring';
    if (this.falling) this.falling.visible = season === 'spring';
  }
}
