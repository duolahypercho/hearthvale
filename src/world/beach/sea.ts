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

function weedRaft(rng: Rng): THREE.BufferGeometry {
  // A flat, ragged clump of kelp fronds (a few crossed ribbons) + a stick.
  const P: number[] = [];
  const C: number[] = [];
  const a = new THREE.Color(0x8a8a3a);
  const b = new THREE.Color(0xc0a050);
  for (let i = 0; i < 4; i++) {
    const ang = rng.next() * Math.PI;
    const len = 0.35 + rng.next() * 0.35;
    const w = 0.06 + rng.next() * 0.04;
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    const sx = -dz * w;
    const sz = dx * w;
    const ox = (rng.next() - 0.5) * 0.3;
    const oz = (rng.next() - 0.5) * 0.3;
    const c = a.clone().lerp(b, rng.next());
    const y = 0.01 + i * 0.002;
    const v = [
      [ox - dx * len * 0.5 + sx, y, oz - dz * len * 0.5 + sz],
      [ox - dx * len * 0.5 - sx, y, oz - dz * len * 0.5 - sz],
      [ox + dx * len * 0.5 + sx * 0.3, y, oz + dz * len * 0.5 + sz * 0.3],
      [ox + dx * len * 0.5 - sx * 0.3, y, oz + dz * len * 0.5 - sz * 0.3],
    ];
    // Both windings (lit from above either way: no black flipped back faces).
    for (const k of [0, 1, 2, 1, 3, 2, 0, 2, 1, 1, 2, 3]) {
      P.push(v[k]![0]!, v[k]![1]!, v[k]![2]!);
      C.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  // Stick.
  const st = new THREE.CylinderGeometry(0.045, 0.06, 1.1, 6).rotateZ(Math.PI / 2).rotateY(0.6).translate(0.05, 0.04, 0.05);
  const sc = new Float32Array(st.attributes.position!.count * 3);
  for (let i = 0; i < sc.length; i += 3) {
    sc[i] = 0.62;
    sc[i + 1] = 0.55;
    sc[i + 2] = 0.46;
  }
  st.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  const sn = st.toNonIndexed();
  const out = new THREE.BufferGeometry();
  const pa = new Float32Array(g.attributes.position!.count * 3 + sn.attributes.position!.count * 3);
  pa.set(g.attributes.position!.array as Float32Array, 0);
  pa.set(sn.attributes.position!.array as Float32Array, g.attributes.position!.count * 3);
  const na = new Float32Array(pa.length);
  na.set(g.attributes.normal!.array as Float32Array, 0);
  na.set(sn.attributes.normal!.array as Float32Array, g.attributes.normal!.count * 3);
  const ca = new Float32Array(pa.length);
  ca.set(g.attributes.color!.array as Float32Array, 0);
  ca.set(sn.attributes.color!.array as Float32Array, g.attributes.color!.count * 3);
  out.setAttribute('position', new THREE.BufferAttribute(pa, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(na, 3));
  out.setAttribute('color', new THREE.BufferAttribute(ca, 3));
  return out;
}

/** Soft fish silhouette (body ellipse + forked tail), drawn as a dark translucent shadow. */
function fishShadowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uOpacity: { value: 0.34 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      varying vec2 vUv; uniform float uOpacity;
      void main(){
        vec2 p = vUv * 2.0 - 1.0;
        // Body along +x (head), tail at -x.
        float body = length(vec2((p.x - 0.15) / 0.62, p.y / 0.26));
        float b = smoothstep(1.0, 0.55, body);
        vec2 tp = vec2(p.x + 0.72, p.y);
        float tail = smoothstep(0.02, -0.08, abs(tp.y) - (0.05 + max(0.0, -tp.x) * 0.9)) * step(-0.28, -abs(tp.x + 0.02)) * step(tp.x, 0.18);
        float a = max(b, tail * 0.85);
        gl_FragColor = vec4(0.02, 0.1, 0.14, a * uOpacity);
      }`,
  });
}

interface Drifter {
  cx: number;
  cz: number;
  r: number;
  a: number;
  sp: number;
  rot: number;
}

export class SeaProps {
  readonly group = new THREE.Group();
  private boat: THREE.Group;
  private boatAt: THREE.Vector3;
  private boatYaw: number;
  private floats: THREE.InstancedMesh;
  private floatPts: THREE.Vector3[] = [];
  private flotsam: THREE.InstancedMesh;
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
    this.boatAt = new THREE.Vector3(boat.x, level - 0.1, boat.z);
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
    // Flotsam rafts.
    // Transparent (opacity 1) so it draws after the sea surface: floating, not seen through the water.
    const wm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, transparent: true });
    wm.name = 'flotsam';
    this.flotsam = new THREE.InstancedMesh(weedRaft(rng.fork('raft')), wm, flotsamAt.length);
    this.flotsam.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flotsam.frustumCulled = false;
    this.flotsam.renderOrder = 3;
    this.group.add(this.flotsam);
    for (const [x, z] of flotsamAt) this.drifters.push({ cx: x, cz: z, r: 0.6 + rng.next() * 1.4, a: rng.next() * 6.28, sp: (0.03 + rng.next() * 0.04) * (rng.next() < 0.5 ? 1 : -1), rot: rng.next() * 6.28 });
    // Fish school shadows.
    const sg = new THREE.PlaneGeometry(1.1, 0.55);
    sg.rotateX(-Math.PI / 2);
    this.school = new THREE.InstancedMesh(sg, fishShadowMaterial(), 5);
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
    this.drifters.forEach((d, i) => {
      d.a += d.sp * dt;
      d.rot += d.sp * dt * 1.7;
      _p.set(d.cx + Math.cos(d.a) * d.r, L + 0.03 + Math.sin(t * 1.4 + i) * 0.02, d.cz + Math.sin(d.a) * d.r);
      _e.set(Math.sin(t * 1.2 + i) * 0.05, d.rot, 0);
      _q.setFromEuler(_e);
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      this.flotsam.setMatrixAt(i, _m);
    });
    this.flotsam.instanceMatrix.needsUpdate = true;
    // Fish school: a loose lissajous loop around a slowly wandering centre.
    this.schoolT += dt;
    const S = this.schoolAt;
    const cx = S.x + Math.sin(this.schoolT * 0.05) * S.r * 0.5;
    const cz = S.z + Math.cos(this.schoolT * 0.037) * S.r * 0.35;
    for (let i = 0; i < 5; i++) {
      const u = this.schoolT * 0.22 - i * 0.16;
      const x = cx + Math.sin(u) * S.r * 0.6 + Math.sin(i * 2.3) * 0.5;
      const z = cz + Math.sin(u * 2) * S.r * 0.3 + Math.cos(i * 1.7) * 0.4;
      const dx = Math.cos(u) * S.r * 0.6;
      const dz = Math.cos(u * 2) * 2 * S.r * 0.3;
      const yaw = Math.atan2(-dz, dx) + Math.sin(t * 7 + i) * 0.12;
      _p.set(x, L + 0.015, z);
      _e.set(0, yaw, 0);
      _q.setFromEuler(_e);
      const sc = 0.75 + (i % 3) * 0.15;
      _s.set(sc, 1, sc);
      _m.compose(_p, _q, _s);
      this.school.setMatrixAt(i, _m);
    }
    this.school.instanceMatrix.needsUpdate = true;
  }

  /** Night: the school goes deep (fades), everything else keeps bobbing. */
  setNight(night: number): void {
    (this.school.material as THREE.ShaderMaterial).uniforms.uOpacity!.value = 0.34 * (1 - night * 0.8);
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
