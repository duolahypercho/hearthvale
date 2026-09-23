/**
 * Beach forageables + tide-pool dressing (instanced, one draw call per kind):
 *   cockle       ribbed fan shell, domed, cream with rosy growth bands
 *   spiralConch  lathed spiral cone with a flared pink lip
 *   starfish     five chubby tapering arms, pebbly orange
 *   sandDollar   flat disc with the five-petal flower etched in
 *   seaGlass     a frosted, rounded green nugget (glossy)
 *   coralSprig   branching pink coral twig
 * The tide line gets a fresh handful every morning (seeded per day); picked with interact.
 * Tide pools get non-pickable anemones, urchins and pebbles.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { applyWorldFx } from '../../render/worldfx';
import { BEACH_FORAGE, type ForageDef } from '../../data/fish';
import { textures } from '../../render/textures';
import { globalUniforms } from '../../render/uniforms';

/** Display scale per forageable: big enough to read as a pick-up at gameplay zoom. */
const SHELL_SCALE: Record<string, number> = { cockle: 2.1, spiralConch: 1.9, starfish: 2.0, sandDollar: 2.1, seaGlass: 2.0, coralSprig: 2.1 };

/** A four-point star glint (canvas), shared. */
let glintTex: THREE.CanvasTexture | null = null;
function glintTexture(): THREE.CanvasTexture {
  if (!glintTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 14);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(1, 'rgba(255,250,220,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);
    for (const [w, h] of [[3, 30], [30, 3]] as const) {
      const lg = g.createRadialGradient(32, 32, 0, 32, 32, 30);
      lg.addColorStop(0, 'rgba(255,255,255,1)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg;
      g.beginPath();
      g.ellipse(32, 32, w, h, 0, 0, Math.PI * 2);
      g.fill();
    }
    glintTex = new THREE.CanvasTexture(c);
  }
  return glintTex;
}

function paint(g: THREE.BufferGeometry, fn: (p: THREE.Vector3) => THREE.Color): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    fn(p).toArray(col, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position!.count;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const C = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    const c = g.attributes.position!.count;
    P.set(g.attributes.position!.array as Float32Array, o * 3);
    N.set(g.attributes.normal!.array as Float32Array, o * 3);
    if (g.attributes.color) C.set(g.attributes.color.array as Float32Array, o * 3);
    else C.fill(1, o * 3, (o + c) * 3);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return out;
}

const col = (h: number) => new THREE.Color(h);

/** Ribbed fan shell, hinge at the origin, opening towards +Z. ~0.26 m across. */
function cockleGeo(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.14, 28, 10, Math.PI * 0.12, Math.PI * 0.76, 0, Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const a = Math.atan2(p.x, p.z);
    const r = Math.hypot(p.x, p.z);
    const rib = Math.pow(Math.abs(Math.cos(a * 11)), 0.6) * 0.012 * (r / 0.14);
    const k = 1 + rib / Math.max(0.02, r);
    pos.setXYZ(i, p.x * k, p.y * 0.55 + rib * 0.6, p.z * k - 0.02);
  }
  g.computeVertexNormals();
  paint(g, (q) => {
    const r = Math.hypot(q.x, q.z);
    const band = 0.5 + 0.5 * Math.sin(r * 120);
    return col(0xf4e2c8).lerp(col(0xd88a6a), band * 0.35 + (r > 0.12 ? 0.25 : 0)).multiplyScalar(0.9 + q.y * 1.2);
  });
  // Little hinge knobs.
  const knob = paint(new THREE.SphereGeometry(0.025, 8, 6).translate(0, 0.02, -0.03), () => col(0xc88a70));
  return merge([g, knob]);
}

/** Spiral conch lying on its side, spire towards +X. ~0.3 m long. */
function conchGeo(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const r = Math.sin(Math.pow(t, 0.7) * Math.PI) * 0.09 * (1 - t * 0.55) + 0.004;
    pts.push(new THREE.Vector2(r + Math.max(0, Math.sin(t * 38)) * 0.006 * (1 - t), t * 0.3 - 0.12));
  }
  const g = new THREE.LatheGeometry(pts, 16);
  // Twist the spire so the whorls read.
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const a = (p.y + 0.12) * 14;
    const x = p.x * Math.cos(a) - p.z * Math.sin(a);
    const z = p.x * Math.sin(a) + p.z * Math.cos(a);
    pos.setXYZ(i, x, p.y, z);
  }
  g.computeVertexNormals();
  paint(g, (q) => {
    const whorl = 0.5 + 0.5 * Math.sin((q.y + 0.12) * 60 + Math.atan2(q.z, q.x));
    return col(0xf2d4b4).lerp(col(0xc0784e), whorl * 0.45);
  });
  g.rotateZ(-Math.PI / 2);
  g.translate(0, 0.07, 0);
  // Flared pink lip.
  const lip = new THREE.SphereGeometry(0.08, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45);
  lip.scale(1, 0.45, 1.3).rotateZ(Math.PI / 2).translate(-0.1, 0.07, 0.02);
  paint(lip, () => col(0xf6a6a0));
  return merge([g, lip]);
}

/** Five-armed sea star, flat on the sand. ~0.34 m across. */
function starGeo(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const N = 5;
  for (let i = 0; i <= N * 2; i++) {
    const a = (i / (N * 2)) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.17 : 0.06;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.022, bevelSegments: 3, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  // Dome the centre, lift the arm tips a touch (they curl).
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const r = Math.hypot(p.x, p.z);
    const top = p.y > 0.015 ? 1 : 0;
    pos.setY(i, p.y * (1 - r * 3.2) * 1.3 + top * 0.02 * (1 - r / 0.2) + Math.max(0, r - 0.13) * 0.4);
  }
  g.computeVertexNormals();
  paint(g, (q) => {
    const r = Math.hypot(q.x, q.z);
    const dot = Math.sin(q.x * 160) * Math.sin(q.z * 160) > 0.6 ? 1 : 0;
    return col(0xf07a3a).lerp(col(0xffc48a), dot * 0.6 + (r < 0.03 ? 0.3 : 0)).multiplyScalar(0.8 + q.y * 5);
  });
  return g;
}

/** Sand dollar: flat pale disc with the petal flower etched in. ~0.24 m across. */
function dollarGeo(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.12, 0.125, 0.025, 28, 1);
  g.translate(0, 0.0125, 0);
  const top = new THREE.CircleGeometry(0.118, 40, 0, Math.PI * 2);
  top.rotateX(-Math.PI / 2).translate(0, 0.0262, 0);
  paint(top, (q) => {
    const a = Math.atan2(q.z, q.x) + Math.PI / 2;
    const r = Math.hypot(q.x, q.z);
    const petal = Math.abs(Math.cos(a * 2.5)) > 0.82 && r > 0.02 && r < 0.075 ? 1 : 0;
    return col(0xf2ead2).lerp(col(0xa89478), petal * 0.6 + (r < 0.01 ? 0.3 : 0));
  });
  paint(g, () => col(0xe0d6bc));
  return merge([g, top]);
}

/** Frosted sea-glass nugget. */
function glassGeo(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.075, 1);
  g.scale(1.2, 0.55, 0.9).translate(0, 0.035, 0);
  g.computeVertexNormals();
  return paint(g, () => col(0x7ad0b8));
}

/** Branching coral twig. */
function coralGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const branch = (from: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number): void => {
    const to = from.clone().addScaledVector(dir, len);
    const c = new THREE.CylinderGeometry(r * 0.7, r, len, 6, 1);
    c.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    c.applyQuaternion(q).translate(from.x, from.y, from.z);
    parts.push(paint(c, () => col(0xf07a84)));
    const tip = new THREE.SphereGeometry(r * 0.85, 6, 5).translate(to.x, to.y, to.z);
    parts.push(paint(tip, () => col(0xffb0b0)));
    if (depth <= 0) return;
    for (const s of [-1, 1]) {
      const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), s * 0.55).applyAxisAngle(new THREE.Vector3(0, 1, 0), s * 0.8).normalize();
      branch(to, d, len * 0.72, r * 0.72, depth - 1);
    }
  };
  branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.9, 0.35, 0).normalize(), 0.12, 0.022, 2);
  const g = merge(parts);
  g.translate(-0.08, 0.02, 0);
  return g;
}

const GEOS: Record<string, () => THREE.BufferGeometry> = {
  cockle: cockleGeo,
  spiralConch: conchGeo,
  starfish: starGeo,
  sandDollar: dollarGeo,
  seaGlass: glassGeo,
  coralSprig: coralGeo,
};

export interface ShellItem {
  def: ForageDef;
  tx: number;
  tz: number;
  pos: THREE.Vector3;
  kind: number;
  slot: number;
}

/** Tide-line forageables: instanced per kind, respawned per day. */
export class ShellField {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private items: ShellItem[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private cap = 10;
  /** Contact blots under every item + a periodic star glint over it (one draw each). */
  private blots: THREE.InstancedMesh;
  private glints: THREE.InstancedMesh;

  constructor() {
    this.group.name = 'beach-shells';
    this.group.userData.perfTag = 'props';
    const base = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
    base.name = 'shell';
    applyWorldFx(base, { snowUp: 0 });
    const glass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.18, metalness: 0, emissive: 0x2a6a5a, emissiveIntensity: 0.25 });
    glass.name = 'seaGlass';
    for (const d of BEACH_FORAGE) {
      const im = new THREE.InstancedMesh(GEOS[d.id]!(), d.id === 'seaGlass' ? glass : base, this.cap);
      im.count = 0;
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.name = `shell-${d.id}`;
      this.meshes.push(im);
      this.group.add(im);
    }
    const n = this.cap * BEACH_FORAGE.length;
    const bg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const bm = new THREE.MeshBasicMaterial({ map: textures.softDot().map, color: 0x2a1a0a, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    bm.name = 'shellBlot';
    this.blots = new THREE.InstancedMesh(bg, bm, n);
    this.blots.count = 0;
    this.blots.frustumCulled = false;
    this.blots.renderOrder = 1;
    this.group.add(this.blots);
    // Glint: a camera-facing star that flares up now and then (phase per instance), feeds the bloom.
    const gm = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uMap: { value: glintTexture() }, uTime: globalUniforms.uTime, uNight: globalUniforms.uNight },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        varying float vA;
        void main() {
          vUv = uv;
          vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float ph = fract(sin(dot(c.xz, vec2(12.9898, 78.233))) * 43758.5453);
          float cyc = fract(uTime * 0.28 + ph);
          float flare = smoothstep(0.0, 0.06, cyc) * (1.0 - smoothstep(0.06, 0.2, cyc));
          vA = flare;
          vec4 mv = viewMatrix * c;
          float sz = 0.55 * flare + 0.001;
          float rot = uTime * 1.5 + ph * 6.28;
          vec2 q = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * position.xy;
          mv.xy += q * sz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uNight;
        varying vec2 vUv;
        varying float vA;
        void main() {
          float a = texture2D(uMap, vUv).a * vA * (1.0 - uNight * 0.6);
          gl_FragColor = vec4(vec3(1.6, 1.5, 1.25) * a, a);
        }`,
    });
    gm.name = 'shellGlint';
    this.glints = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), gm, n);
    this.glints.count = 0;
    this.glints.frustumCulled = false;
    this.glints.renderOrder = 7;
    this.glints.userData.noAO = true;
    this.group.add(this.glints);
  }

  get list(): readonly ShellItem[] {
    return this.items;
  }

  /** Clear and scatter `count` items on the given candidate spots (seeded). */
  spawn(rng: Rng, season: string, spots: { x: number; y: number; z: number }[], count: number, claim: (tx: number, tz: number, it: ShellItem) => boolean): void {
    for (const it of this.items) claim(it.tx, it.tz, null as unknown as ShellItem); // release
    this.items = [];
    const defs = BEACH_FORAGE.filter((d) => d.seasons.includes(season as never));
    const counts = new Array(BEACH_FORAGE.length).fill(0) as number[];
    const pool = spots.slice();
    for (let n = 0; n < count && pool.length; n++) {
      const i = Math.floor(rng.next() * pool.length);
      const s = pool.splice(i, 1)[0]!;
      // Common shells more often than coral / conch.
      const w = defs.map((d) => 100 / d.sell);
      let r = rng.next() * w.reduce((a, b) => a + b, 0);
      let def = defs[0]!;
      for (let k = 0; k < defs.length; k++) {
        r -= w[k]!;
        if (r <= 0) {
          def = defs[k]!;
          break;
        }
      }
      const kind = BEACH_FORAGE.indexOf(def);
      if (counts[kind]! >= this.cap) continue;
      const it: ShellItem = { def, tx: Math.floor(s.x), tz: Math.floor(s.z), pos: new THREE.Vector3(s.x, s.y, s.z), kind, slot: counts[kind]! };
      if (!claim(it.tx, it.tz, it)) continue;
      counts[kind]!++;
      this.items.push(it);
    }
    this.rebuild(rng);
  }

  private rebuild(rng?: Rng): void {
    const counts = new Array(BEACH_FORAGE.length).fill(0) as number[];
    let j = 0;
    for (const it of this.items) {
      const im = this.meshes[it.kind]!;
      const k = counts[it.kind]!++;
      it.slot = k;
      const yaw = ((it.tx * 73 + it.tz * 31) % 628) / 100 + (rng ? 0 : 0);
      this.q.setFromEuler(new THREE.Euler(((it.tx * 13) % 7) * 0.03 - 0.09, yaw, ((it.tz * 17) % 7) * 0.03 - 0.09));
      const s = SHELL_SCALE[it.def.id] ?? 2;
      this.m.compose(it.pos.clone().setY(it.pos.y - 0.012), this.q, new THREE.Vector3(s, s, s));
      im.setMatrixAt(k, this.m);
      this.q.identity();
      this.m.compose(it.pos.clone().setY(it.pos.y + 0.01), this.q, new THREE.Vector3(s * 0.34, 1, s * 0.34));
      this.blots.setMatrixAt(j, this.m);
      this.m.makeTranslation(it.pos.x, it.pos.y + 0.12 * s, it.pos.z);
      this.glints.setMatrixAt(j, this.m);
      j++;
    }
    this.blots.count = j;
    this.glints.count = j;
    this.blots.instanceMatrix.needsUpdate = true;
    this.glints.instanceMatrix.needsUpdate = true;
    this.meshes.forEach((im, i) => {
      im.count = counts[i]!;
      im.instanceMatrix.needsUpdate = true;
    });
  }

  take(tx: number, tz: number): ShellItem | null {
    const i = this.items.findIndex((it) => it.tx === tx && it.tz === tz);
    if (i < 0) return null;
    const it = this.items.splice(i, 1)[0]!;
    this.rebuild();
    return it;
  }
}

/** Anemones, urchins and pebbles in the tide pools (static, one merged mesh). */
export function buildTidePoolLife(rng: Rng, pools: [number, number, number][], floorAt: (x: number, z: number) => number): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  for (const [px, pz, pr] of pools) {
    // An anemone ring hugging the rim, clustered (gaps between colonies).
    const ringN = Math.round(pr * 9);
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2 + rng.next() * 0.3;
      if (Math.sin(a * 3 + px) > 0.55) continue;
      const d = pr * (0.7 + rng.next() * 0.12);
      const x = px + Math.cos(a) * d;
      const z = pz + (Math.sin(a) * d) / 1.15;
      const y = floorAt(x, z);
      const hue = rng.pick([0x3fb58a, 0xf06a8a, 0xf2a03a, 0xe85a6a]);
      const sc = 0.8 + rng.next() * 0.6;
      const stalk = new THREE.CylinderGeometry(0.07 * sc, 0.09 * sc, 0.1, 10).translate(x, y + 0.05, z);
      parts.push(paint(stalk, () => col(hue).multiplyScalar(0.55)));
      for (let k = 0; k < 12; k++) {
        const ta = (k / 12) * Math.PI * 2;
        const t = new THREE.CylinderGeometry(0.008 * sc, 0.016 * sc, 0.12 * sc, 4);
        t.translate(0, 0.06 * sc, 0).rotateZ(0.75).rotateY(ta).translate(x, y + 0.1, z);
        parts.push(paint(t, (q) => col(hue).lerp(col(0xffffff), THREE.MathUtils.clamp((q.y - y - 0.1) * 6, 0, 0.55))));
      }
    }
    const n = Math.round(pr * 8);
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2;
      const d = Math.sqrt(rng.next()) * pr * 0.62;
      const x = px + Math.cos(a) * d;
      const z = pz + Math.sin(a) * d * 0.87;
      const y = floorAt(x, z);
      const roll = i === 0 ? 0.65 : rng.next();
      if (roll < 0.25) {
        // Anemone: squat stalk + a crown of little tentacles.
        const hue = rng.pick([0x3fb58a, 0xf06a8a, 0xf2a03a, 0x9a6ae0]);
        const stalk = new THREE.CylinderGeometry(0.07, 0.09, 0.1, 10).translate(x, y + 0.05, z);
        parts.push(paint(stalk, () => col(hue).multiplyScalar(0.6)));
        for (let k = 0; k < 12; k++) {
          const ta = (k / 12) * Math.PI * 2;
          const t = new THREE.CylinderGeometry(0.008, 0.016, 0.1, 4);
          t.translate(0, 0.05, 0).rotateZ(0.7).rotateY(ta).translate(x, y + 0.1, z);
          parts.push(paint(t, (q) => col(hue).lerp(col(0xffffff), THREE.MathUtils.clamp((q.y - y - 0.1) * 6, 0, 0.5))));
        }
      } else if (roll < 0.45) {
        // Urchin: dark spiky ball.
        const u = new THREE.IcosahedronGeometry(0.07, 1);
        const pos = u.attributes.position as THREE.BufferAttribute;
        for (let k = 0; k < pos.count; k++) if (k % 3 === 0) pos.setXYZ(k, pos.getX(k) * 1.6, pos.getY(k) * 1.6, pos.getZ(k) * 1.6);
        u.computeVertexNormals();
        u.translate(x, y + 0.05, z);
        parts.push(paint(u, () => col(0x3a2a4a)));
      } else if (roll < 0.7) {
        const s = starGeo().scale(1.3, 1.3, 1.3).rotateY(rng.next() * 6).translate(x, y + 0.005, z);
        const c = rng.pick([0xe8583a, 0x9a4ac8, 0xf2a03a]);
        parts.push(paint(s, (q) => col(c).multiplyScalar(0.75 + (q.y - y) * 4)));
      } else {
        const p = new THREE.IcosahedronGeometry(0.05 + rng.next() * 0.06, 1).scale(1, 0.55, 1).translate(x, y + 0.01, z);
        const v = 0.55 + rng.next() * 0.35;
        parts.push(paint(p, () => new THREE.Color(v, v * 0.97, v * 0.92)));
      }
    }
  }
  const g = merge(parts);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
  m.name = 'tidePoolLife';
  applyWorldFx(m, { snowUp: 0 });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'tide-pool-life';
  mesh.receiveShadow = true;
  mesh.userData.perfTag = 'props';
  return mesh;
}
