/**
 * Life on the open water off Driftsand (so the sea around the pier is never an empty blue sheet):
 *   moored boat   a red dory riding the swell off the pier (bob, pitch, roll), with a mooring buoy
 *   buoy line     a rope of red / white floats marking the swim area, each bobbing on its own phase
 *   flotsam       drifting weed rafts and sticks turning slowly on the current
 *   fish school   5 dark, soft fish shadows cruising just under the surface (a slow wandering loop)
 * All instanced / merged: 6 draw calls in the main pass, a few hundred triangles each.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { applyWorldFx } from '../../render/worldfx';
import { globalUniforms } from '../../render/uniforms';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildRowboat } from './props';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
/** Fish in the school off the pier. */
const SCHOOL_N = 9;

function floatGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.16, 14, 10);
  g.scale(1, 0.78, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const red = new THREE.Color(0xe0442e);
  const white = new THREE.Color(0xf4f0e6);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const c = y > 0.02 ? red : white;
    // A white band round the belly.
    const cc = Math.abs(y - 0.02) < 0.035 ? white : c;
    col[i * 3] = cc.r;
    col[i * 3 + 1] = cc.g;
    col[i * 3 + 2] = cc.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Vertex-colour a geometry (flat colour, or per-vertex via fn) and return it non-indexed. */
function painted(g: THREE.BufferGeometry, col: (x: number, y: number, z: number) => THREE.Color): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  const pos = n.attributes.position as THREE.BufferAttribute;
  const c = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = col(pos.getX(i), pos.getY(i), pos.getZ(i));
    c[i * 3] = k.r;
    c[i * 3 + 1] = k.g;
    c[i * 3 + 2] = k.b;
  }
  n.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (!n.attributes.normal) n.computeVertexNormals();
  n.deleteAttribute('uv');
  return n;
}

/** Kelp fronds (flat crossed ribbons lit from above either way). */
function fronds(rng: Rng, count: number, len: number, tint: [number, number]): THREE.BufferGeometry {
  const P: number[] = [];
  const C: number[] = [];
  const a = new THREE.Color(tint[0]);
  const b = new THREE.Color(tint[1]);
  for (let i = 0; i < count; i++) {
    const ang = rng.next() * Math.PI;
    const L = len * (0.6 + rng.next() * 0.6);
    const w = 0.05 + rng.next() * 0.035;
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    const sx = -dz * w;
    const sz = dx * w;
    const ox = (rng.next() - 0.5) * 0.18;
    const oz = (rng.next() - 0.5) * 0.18;
    const c = a.clone().lerp(b, rng.next());
    const y = 0.01 + i * 0.002;
    const v = [
      [ox - dx * L * 0.5 + sx, y, oz - dz * L * 0.5 + sz],
      [ox - dx * L * 0.5 - sx, y, oz - dz * L * 0.5 - sz],
      [ox + dx * L * 0.5 + sx * 0.3, y, oz + dz * L * 0.5 + sz * 0.3],
      [ox + dx * L * 0.5 - sx * 0.3, y, oz + dz * L * 0.5 - sz * 0.3],
    ];
    for (const k of [0, 1, 2, 1, 3, 2, 0, 2, 1, 1, 2, 3]) {
      P.push(v[k]![0]!, v[k]![1]!, v[k]![2]!);
      C.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  const nn = new Float32Array(P.length);
  for (let i = 1; i < nn.length; i += 3) nn[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
  return g;
}

/**
 * Four kinds of flotsam (each its own instanced mesh; per instance a size / yaw / drift of its own):
 *   0 a weathered plank with a darker, waterlogged end
 *   1 a bleached forked branch, a small dark weed wisp caught in the fork
 *   2 a green glass bottle with its cork, floating neck-up at a tilt
 *   3 a loose raft of kelp fronds (no stick)
 */
function flotsamGeometry(kind: number, rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 0) {
    const L = 0.95;
    const plank = new THREE.BoxGeometry(L, 0.05, 0.15, 6, 1, 1);
    parts.push(painted(plank, (x, y) => new THREE.Color(0x9a8a74).lerp(new THREE.Color(0x5e4e3e), THREE.MathUtils.smoothstep(x, 0.1, L / 2)).multiplyScalar(y > 0 ? 1 : 0.7)));
    // A rusty nail stub near one end.
    parts.push(painted(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 4).translate(-0.36, 0.04, 0.02), () => new THREE.Color(0x6a3a22)));
  } else if (kind === 1) {
    const branch = new THREE.CylinderGeometry(0.025, 0.045, 1.0, 6, 3).rotateZ(Math.PI / 2);
    const bleached = (x: number, y: number) => new THREE.Color(0xb8ab98).multiplyScalar((y > 0 ? 1 : 0.72) * (0.9 + 0.1 * Math.sin(x * 9)));
    parts.push(painted(branch, bleached));
    parts.push(painted(new THREE.CylinderGeometry(0.018, 0.028, 0.42, 5).rotateZ(Math.PI / 2).rotateY(0.7).translate(0.2, 0.0, 0.12), bleached));
    const w = fronds(rng, 2, 0.28, [0x3e4a22, 0x5a5a2a]);
    w.translate(0.05, 0.0, 0.06);
    parts.push(w);
  } else if (kind === 2) {
    const body = new THREE.CylinderGeometry(0.055, 0.055, 0.2, 9).translate(0, 0.1, 0);
    const shoulder = new THREE.CylinderGeometry(0.022, 0.055, 0.06, 9).translate(0, 0.23, 0);
    const neck = new THREE.CylinderGeometry(0.02, 0.022, 0.07, 7).translate(0, 0.295, 0);
    const glass = (_x: number, y: number) => new THREE.Color(0x3f8a5e).lerp(new THREE.Color(0x9ad8b0), THREE.MathUtils.smoothstep(y, 0.05, 0.3));
    for (const g of [body, shoulder, neck]) parts.push(painted(g, glass));
    parts.push(painted(new THREE.CylinderGeometry(0.018, 0.016, 0.03, 6).translate(0, 0.34, 0), () => new THREE.Color(0xa87a4a)));
    // Lying tilted on the water, neck out of it.
    for (const g of parts) g.rotateZ(1.25).translate(0.1, 0.02, 0);
  } else {
    parts.push(fronds(rng, 5, 0.5, [0x55602a, 0x8a7a3a]));
  }
  return mergeGeometries(parts.map((g) => {
    if (!g.attributes.normal) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    return g.index ? g.toNonIndexed() : g;
  }))!;
}

/**
 * Fish silhouette (tapered head, body, narrow tail stock, forked tail, pectoral fins), blurred into a
 * soft, cool shadow — reads as a fish at gameplay zoom, never as a dark oval "hole" in the water.
 */
function fishShadowMaterial(): THREE.MeshBasicMaterial {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.filter = 'blur(2.5px)';
  g.fillStyle = '#fff';
  g.beginPath();
  // Head at +x (right), tail at -x.
  g.moveTo(118, 32);
  g.bezierCurveTo(112, 20, 92, 17, 74, 18);
  g.bezierCurveTo(56, 19, 42, 25, 30, 29);
  g.lineTo(30, 35);
  g.bezierCurveTo(42, 39, 56, 45, 74, 46);
  g.bezierCurveTo(92, 47, 112, 44, 118, 32);
  g.fill();
  // Forked tail.
  g.beginPath();
  g.moveTo(33, 32);
  g.lineTo(10, 14);
  g.quadraticCurveTo(18, 32, 10, 50);
  g.closePath();
  g.fill();
  // Pectoral fins.
  g.globalAlpha = 0.6;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(86, 32 + s * 12);
    g.lineTo(72, 32 + s * 24);
    g.lineTo(78, 32 + s * 12);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.MeshBasicMaterial({ map: tex, color: 0x0b3440, transparent: true, opacity: 0.38, depthWrite: false });
  m.name = 'fishSchool';
  return m;
}

/** Waterline collar for the moored dory: a lacy foam ring hugging the hull + a dim wet band inside it. */
function boatRingMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uT: { value: 0 }, uNight: globalUniforms.uNight, uSun: globalUniforms.uSunColor, uSky: globalUniforms.uSkyColor },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      varying vec2 vUv; uniform float uT; uniform float uNight; uniform vec3 uSun; uniform vec3 uSky;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main(){
        // Hull plan: bow at +x (pointed), transom at -x (blunt) - a superellipse in the 4.3 x 2.3 quad.
        vec2 q = (vUv - 0.5) * vec2(4.3, 2.3);
        float bow = smoothstep(-0.4, 1.6, q.x);
        vec2 e = q / vec2(1.72, 0.8 - bow * 0.38);
        float r = pow(pow(abs(e.x), 2.4) + pow(abs(e.y), 2.4), 1.0 / 2.4);
        float a = atan(q.y, q.x);
        float wob = n(vec2(a * 3.0, uT * 0.7)) * 0.12 + n(vec2(a * 9.0, uT * 1.3)) * 0.06;
        float ring = smoothstep(0.1, 0.0, abs(r - 1.02 - wob)) * (0.55 + 0.45 * n(vec2(a * 14.0, uT * 2.0)));
        // Faint lace spreading from the collar.
        float lace = smoothstep(0.62, 0.8, n(q * 5.0 + vec2(uT * 0.3, 0.0))) * smoothstep(1.5, 1.05, r) * step(1.0, r) * 0.45;
        float foam = max(ring, lace) * (1.0 - uNight * 0.6);
        vec3 fc = vec3(0.95, 0.97, 0.96) * (uSun * 0.6 + uSky * 0.5);
        float band = smoothstep(0.86, 0.98, r) * smoothstep(1.05, 0.98, r) * 0.25;
        gl_FragColor = vec4(mix(vec3(0.02, 0.08, 0.1), fc, foam / max(foam + band, 1e-3)), clamp(foam * 0.85 + band, 0.0, 1.0));
      }`,
  });
  m.name = 'doryWaterline';
  return m;
}

interface Drifter {
  cx: number;
  cz: number;
  r: number;
  a: number;
  sp: number;
  rot: number;
  kind: number;
  slot: number;
  scale: number;
  tilt: number;
}

export class SeaProps {
  readonly group = new THREE.Group();
  private boat: THREE.Group;
  private boatAt: THREE.Vector3;
  private boatYaw: number;
  private boatRing: THREE.Mesh;
  private floats: THREE.InstancedMesh;
  private floatPts: THREE.Vector3[] = [];
  private flotsam: THREE.InstancedMesh[] = [];
  private drifters: Drifter[] = [];
  private school: THREE.InstancedMesh;
  private schoolT = 0;
  private schoolC = new THREE.Vector2();

  constructor(
    rng: Rng,
    private level: number,
    buoyLine: [number, number][],
    boat: { x: number; z: number; rot: number },
    private schoolAt: { x: number; z: number; r: number },
    flotsamAt: [number, number][],
  ) {
    this.group.name = 'sea-props';
    this.group.userData.perfTag = 'props';
    this.group.userData.noAO = true;
    // Moored dory.
    this.boat = buildRowboat(rng.fork('dory'), 0xc8583a, 0xf4efe2);
    // (No shadow pass for the dory: it sits on open water, and it saves 3 draw calls.)
    this.boatAt = new THREE.Vector3(boat.x, level - 0.22, boat.z);
    // A soft waterline collar round the hull (foam + a darker contact band): the dory sits IN the
    // water, it doesn't hover over it.
    this.boatRing = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 2.3).rotateX(-Math.PI / 2), boatRingMaterial());
    this.boatRing.name = 'dory-waterline';
    this.boatRing.renderOrder = 3;
    this.boatRing.frustumCulled = false;
    this.group.add(this.boatRing);
    this.boatYaw = boat.rot;
    this.group.add(this.boat);
    // Buoy line floats + the rope they ride on (a thin ribbon at the waterline).
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < buoyLine.length - 1; i++) {
      const [ax, az] = buoyLine[i]!;
      const [bx, bz] = buoyLine[i + 1]!;
      const L = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(L / 1.15));
      for (let k = 0; k < n; k++) pts.push(new THREE.Vector3(ax + ((bx - ax) * k) / n, level, az + ((bz - az) * k) / n));
    }
    const last = buoyLine[buoyLine.length - 1]!;
    pts.push(new THREE.Vector3(last[0], level, last[1]));
    this.floatPts = pts;
    const fm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 });
    fm.name = 'buoyFloat';
    applyWorldFx(fm, { snow: false });
    this.floats = new THREE.InstancedMesh(floatGeometry(), fm, pts.length + 1);
    this.floats.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.floats.frustumCulled = false;
    this.floats.castShadow = true;
    this.group.add(this.floats);
    const rp: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const L = Math.hypot(dx, dz) || 1;
      const sx = (-dz / L) * 0.018;
      const sz = (dx / L) * 0.018;
      const y = level + 0.035;
      rp.push(a.x + sx, y, a.z + sz, a.x - sx, y, a.z - sz, b.x + sx, y, b.z + sz, a.x - sx, y, a.z - sz, b.x - sx, y, b.z - sz, b.x + sx, y, b.z + sz);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    const rope = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xe8dcc0, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    rope.name = 'buoy-rope';
    rope.renderOrder = 3;
    this.group.add(rope);
    // Flotsam: four kinds, each drifter its own size / yaw / slow orbit on the current.
    // Transparent (opacity 1) so it draws after the sea surface: floating, not seen through the water.
    const wm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, transparent: true });
    wm.name = 'flotsam';
    const counts = [0, 0, 0, 0];
    flotsamAt.forEach(([x, z], i) => {
      const kind = i % 4;
      this.drifters.push({ cx: x, cz: z, r: 0.35 + rng.next() * 0.7, a: rng.next() * 6.28, sp: (0.03 + rng.next() * 0.04) * (rng.next() < 0.5 ? 1 : -1), rot: rng.next() * 6.28, kind, slot: counts[kind]!++, scale: 0.7 + rng.next() * 0.6, tilt: (rng.next() - 0.5) * 0.2 });
    });
    const fr = rng.fork('flotsam');
    for (let k = 0; k < 4; k++) {
      if (!counts[k]) continue;
      const im = new THREE.InstancedMesh(flotsamGeometry(k, fr), wm, counts[k]!);
      im.name = `flotsam-${k}`;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.renderOrder = 3;
      this.flotsam[k] = im;
      this.group.add(im);
    }
    // Fish school shadows.
    const sg = new THREE.PlaneGeometry(0.78, 0.39);
    sg.rotateX(-Math.PI / 2);
    this.school = new THREE.InstancedMesh(sg, fishShadowMaterial(), SCHOOL_N);
    this.school.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.school.frustumCulled = false;
    this.school.renderOrder = 3;
    this.group.add(this.school);
    this.schoolC.set(schoolAt.x, schoolAt.z);
  }

  update(dt: number, t: number): void {
    const L = this.level;
    // Boat: rides the swell (the same slow sines as the ocean's open-water swell, roughly).
    const b = this.boat;
    const sw = Math.sin(this.boatAt.z * 0.42 + this.boatAt.x * 0.05 - t * 0.9);
    b.position.set(this.boatAt.x, this.boatAt.y + sw * 0.05 + Math.sin(t * 1.4) * 0.012, this.boatAt.z);
    b.rotation.set(Math.sin(t * 0.9 + 1) * 0.045, this.boatYaw + Math.sin(t * 0.21) * 0.08, Math.cos(t * 0.9) * 0.035, 'YXZ');
    this.boatRing.position.set(b.position.x, L + 0.045, b.position.z);
    this.boatRing.rotation.y = b.rotation.y;
    (this.boatRing.material as THREE.ShaderMaterial).uniforms.uT!.value = t;
    // Floats (+ the mooring buoy off the dory's bow).
    const n = this.floatPts.length;
    for (let i = 0; i < n; i++) {
      const p = this.floatPts[i]!;
      _p.set(p.x, L + 0.02 + Math.sin(t * 1.6 + i * 0.7) * 0.035, p.z);
      _e.set(Math.sin(t * 1.3 + i) * 0.12, 0, Math.cos(t * 1.1 + i * 0.5) * 0.12);
      _q.setFromEuler(_e);
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      this.floats.setMatrixAt(i, _m);
    }
    _p.set(this.boatAt.x + Math.cos(this.boatYaw) * 2.6, L + 0.03 + Math.sin(t * 1.7) * 0.04, this.boatAt.z - Math.sin(this.boatYaw) * 2.6);
    _s.set(1.5, 1.5, 1.5);
    _e.set(Math.sin(t * 1.5) * 0.15, 0, Math.cos(t * 1.2) * 0.15);
    _q.setFromEuler(_e);
    _m.compose(_p, _q, _s);
    this.floats.setMatrixAt(n, _m);
    this.floats.instanceMatrix.needsUpdate = true;
    // Flotsam.
    for (const [i, d] of this.drifters.entries()) {
      d.a += d.sp * dt;
      d.rot += d.sp * dt * 1.7;
      _p.set(d.cx + Math.cos(d.a) * d.r, L + 0.05 + Math.sin(t * 1.4 + i) * 0.02, d.cz + Math.sin(d.a) * d.r);
      _e.set(Math.sin(t * 1.2 + i) * 0.05 + d.tilt, d.rot, Math.cos(t * 0.9 + i) * 0.04);
      _q.setFromEuler(_e);
      _s.setScalar(d.scale);
      _m.compose(_p, _q, _s);
      this.flotsam[d.kind]?.setMatrixAt(d.slot, _m);
    }
    for (const im of this.flotsam) if (im) im.instanceMatrix.needsUpdate = true;
    // Fish school: a loose lissajous loop around a slowly wandering centre.
    this.schoolT += dt;
    const S = this.schoolAt;
    const cx = S.x + Math.sin(this.schoolT * 0.05) * S.r * 0.5;
    const cz = S.z + Math.cos(this.schoolT * 0.037) * S.r * 0.35;
    for (let i = 0; i < SCHOOL_N; i++) {
      // Each fish trails the leader a little on the loop, offset sideways, with its own dart / drift.
      const u = this.schoolT * 0.22 - i * 0.09 + Math.sin(t * 0.7 + i * 1.9) * 0.02;
      const x = cx + Math.sin(u) * S.r * 0.6 + Math.sin(i * 2.3) * 0.55 + Math.sin(t * 0.5 + i) * 0.08;
      const z = cz + Math.sin(u * 2) * S.r * 0.3 + Math.cos(i * 1.7) * 0.45;
      const dx = Math.cos(u) * S.r * 0.6;
      const dz = Math.cos(u * 2) * 2 * S.r * 0.3;
      const yaw = Math.atan2(-dz, dx) + Math.sin(t * 7 + i * 1.3) * 0.1;
      // Above the swell's highest lift (the sea writes depth), so the shadows are never swallowed.
      _p.set(x, L + 0.075, z);
      _e.set(0, yaw, 0);
      _q.setFromEuler(_e);
      const sc = 0.8 + ((i * 7) % 5) * 0.08;
      _s.set(sc, 1, sc);
      _m.compose(_p, _q, _s);
      this.school.setMatrixAt(i, _m);
    }
    this.school.instanceMatrix.needsUpdate = true;
  }

  /** Night: the school goes deep (fades), everything else keeps bobbing. */
  setNight(night: number): void {
    (this.school.material as THREE.MeshBasicMaterial).opacity = 0.38 * (1 - night * 0.8);
  }
}

/**
 * Warm lamp light spilling onto the pier planks / sand at night: additive, soft radial falloff
 * (full → 0 over the outer 40 % of the radius, peak 0.35), never an opaque sticker disc.
 */
export class LampPools {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;

  constructor() {
    this.group.name = 'lamp-pools';
    this.group.userData.noAO = true;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: { uI: { value: 0 }, uT: globalUniforms.uTime },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        varying vec2 vUv; uniform float uI; uniform float uT;
        void main(){
          float r = length(vUv - 0.5) * 2.0;
          // Gaussian-ish core fading to exactly 0 at the rim: no disc edge anywhere.
          float a = exp(-r * r * 3.2) * smoothstep(1.0, 0.55, r);
          float flick = 0.94 + 0.06 * sin(uT * 9.0 + vUv.x * 3.0) * sin(uT * 5.3);
          gl_FragColor = vec4(vec3(1.0, 0.64, 0.32) * a * uI * flick, 1.0);
        }`,
    });
    this.mat.name = 'lampPool';
  }

  private parts: THREE.BufferGeometry[] = [];
  private mesh: THREE.Mesh | null = null;

  /** Queue a pool; call build() once all are added (one merged mesh = one draw call). */
  add(x: number, z: number, y: number, radius: number): void {
    const g = new THREE.PlaneGeometry(radius * 2, radius * 2);
    g.rotateX(-Math.PI / 2);
    g.translate(x, y + 0.03, z);
    this.parts.push(g);
  }

  build(): void {
    if (this.mesh || !this.parts.length) return;
    const g = mergeGeometries(this.parts)!;
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    this.mesh.userData.noAO = true;
    this.group.add(this.mesh);
  }

  update(): void {
    const v = globalUniforms.uLamps.value * (0.18 + 0.17 * globalUniforms.uNight.value);
    this.mat.uniforms.uI!.value = v;
    this.group.visible = v > 0.01;
  }
}
