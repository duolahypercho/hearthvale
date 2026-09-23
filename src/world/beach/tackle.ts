/**
 * Fishing tackle visuals (driven by systems/fishing.ts, works on any map):
 *   rod     bamboo blank rebuilt every frame as a bent tube (bend follows line tension), cork grip + brass reel
 *   line    verlet rope (24 nodes) from the rod tip to the bobber, floats on the water, rendered as a
 *           camera-facing ribbon so it stays a crisp ~1.5 px thread
 *   bobber  red / white float with a quill, bobbing + nibble dips
 *   ripples expanding rings on the water (pool), splash droplets (BurstFX), a fish shadow that
 *           circles in towards the bobber before a bite
 *   catch   the procedural fish (fishmesh.ts) held up over the farmer's head
 */
import * as THREE from 'three';
import { BurstFX } from '../../render/particles';
import { globalUniforms } from '../../render/uniforms';
import type { FishDef } from '../../data/fish';
import { buildFishMesh, type FishMesh } from './fishmesh';

const ROD_LEN = 2.05;
const ROD_SEG = 12;
const ROD_SIDES = 6;
const LINE_N = 24;

export interface RodPose {
  /** Grip (hand) position, world. */
  hand: THREE.Vector3;
  /** Unit direction of the unbent blank. */
  dir: THREE.Vector3;
  /** 0..1 bend towards `bendTo` (line tension). */
  bend: number;
  bendTo: THREE.Vector3;
  /** Reel handle angle (radians). */
  crank: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class FishingGear {
  readonly group = new THREE.Group();
  readonly fx = new BurstFX(360);
  /** World position of the rod tip (valid after update). */
  readonly tip = new THREE.Vector3();
  private rodGeo: THREE.BufferGeometry;
  private rod: THREE.Mesh;
  private grip: THREE.Group;
  private reelHandle: THREE.Mesh;
  private line: THREE.Mesh;
  private lineGeo: THREE.BufferGeometry;
  private pts: THREE.Vector3[] = [];
  private prev: THREE.Vector3[] = [];
  readonly bobber: THREE.Group;
  private ripples: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; age: number; life: number; size: number }[] = [];
  private shadow: THREE.Mesh;
  private shadowMat: THREE.MeshBasicMaterial;
  private held: { def: FishDef; mesh: FishMesh } | null = null;
  readonly heldRoot = new THREE.Group();
  /** Camera-facing quad (a Mesh, not a Sprite, so the AO G-buffer pass can skip it via `noAO`). */
  readonly glory: THREE.Mesh;
  private gloryMat: THREE.MeshBasicMaterial;
  private meshCache = new Map<string, FishMesh>();
  /** Line state: slack 0 (taut) .. 1 (lazy curve on the water). */
  slack = 1;
  lineVisible = false;
  waterY = 0;

  constructor() {
    this.group.name = 'fishing-gear';
    this.group.userData.perfTag = 'fishing';
    this.group.userData.noAO = true;

    // Rod blank (dynamic tube).
    this.rodGeo = new THREE.BufferGeometry();
    const nv = (ROD_SEG + 1) * ROD_SIDES;
    this.rodGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.rodGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const col = new Float32Array(nv * 3);
    const bamboo = new THREE.Color(0xd8b060);
    const node = new THREE.Color(0x8a6a2a);
    const tipC = new THREE.Color(0xc83a2a);
    for (let i = 0; i <= ROD_SEG; i++) {
      const c = i === ROD_SEG ? tipC : i % 3 === 0 ? node : bamboo;
      for (let j = 0; j < ROD_SIDES; j++) c.toArray(col, (i * ROD_SIDES + j) * 3);
    }
    this.rodGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const idx: number[] = [];
    for (let i = 0; i < ROD_SEG; i++) {
      for (let j = 0; j < ROD_SIDES; j++) {
        const a = i * ROD_SIDES + j;
        const b = i * ROD_SIDES + ((j + 1) % ROD_SIDES);
        idx.push(a, a + ROD_SIDES, b, b, a + ROD_SIDES, b + ROD_SIDES);
      }
    }
    this.rodGeo.setIndex(idx);
    const rodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05 });
    rodMat.name = 'rod';
    this.rod = new THREE.Mesh(this.rodGeo, rodMat);
    this.rod.frustumCulled = false;
    this.rod.castShadow = true;

    // Grip + reel (local frame: +Y along the blank).
    this.grip = new THREE.Group();
    const cork = new THREE.MeshStandardMaterial({ color: 0xc89060, roughness: 0.9 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xd8a84a, roughness: 0.3, metalness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.6 });
    const g1 = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.03, 0.34, 10), cork);
    g1.position.y = -0.1;
    const butt = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 6), dark);
    butt.position.y = -0.27;
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 16), brass);
    reel.rotation.z = Math.PI / 2;
    reel.position.set(0.0, 0.1, -0.075);
    this.reelHandle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.09, 0.018), dark);
    this.reelHandle.geometry.translate(0, 0.045, 0);
    const handleHub = new THREE.Group();
    handleHub.position.set(0.035, 0.1, -0.075);
    handleHub.add(this.reelHandle);
    this.grip.add(g1, butt, reel, handleHub);
    this.grip.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : null));

    // Line ribbon.
    this.lineGeo = new THREE.BufferGeometry();
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINE_N * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const lidx: number[] = [];
    for (let i = 0; i < LINE_N - 1; i++) lidx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    this.lineGeo.setIndex(lidx);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf6f0e4, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, fog: true });
    lineMat.name = 'fishingLine';
    this.line = new THREE.Mesh(this.lineGeo, lineMat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 5;
    for (let i = 0; i < LINE_N; i++) {
      this.pts.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
    }

    // Bobber: red cap, white belly, quill.
    this.bobber = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: 0xe8402e, roughness: 0.35 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf6f2ea, roughness: 0.35 });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), red);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), white);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 6, 20), dark);
    band.rotation.x = Math.PI / 2;
    const quill = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.013, 0.16, 6), red);
    quill.position.y = 0.13;
    const nub = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), white);
    nub.position.y = 0.21;
    this.bobber.add(cap, belly, band, quill, nub);
    this.bobber.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : null));
    this.bobber.scale.setScalar(1.7);

    // Ripple rings (shader: soft ring at radius r, fading).
    const ringGeo = new THREE.PlaneGeometry(1, 1);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uAge: { value: 0 }, uAlpha: { value: 1 }, uSky: globalUniforms.uSkyColor, uSun: globalUniforms.uSunColor },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          varying vec2 vUv; uniform float uAge; uniform float uAlpha; uniform vec3 uSky; uniform vec3 uSun;
          void main(){
            float r = length(vUv - 0.5) * 2.0;
            float rr = uAge * 0.92;
            float ring = smoothstep(0.07, 0.0, abs(r - rr)) + 0.55 * smoothstep(0.05, 0.0, abs(r - rr * 0.62)) * step(0.2, uAge);
            float a = ring * (1.0 - uAge) * uAlpha * smoothstep(1.0, 0.92, r);
            vec3 c = mix(uSky, vec3(1.0), 0.65) + uSun * 0.25;
            gl_FragColor = vec4(c, a * 0.8);
          }`,
      });
      const m = new THREE.Mesh(ringGeo, mat);
      m.visible = false;
      m.renderOrder = 4;
      this.ripples.push({ mesh: m, mat, age: 1, life: 1, size: 1 });
      this.group.add(m);
    }

    // Fish shadow (a dark soft ellipse below the surface).
    const sc = document.createElement('canvas');
    sc.width = 128;
    sc.height = 64;
    const sg = sc.getContext('2d')!;
    const rg = sg.createRadialGradient(56, 32, 2, 56, 32, 40);
    rg.addColorStop(0, 'rgba(8,24,32,0.9)');
    rg.addColorStop(1, 'rgba(8,24,32,0)');
    sg.fillStyle = rg;
    sg.beginPath();
    sg.ellipse(56, 32, 44, 16, 0, 0, Math.PI * 2);
    sg.fill();
    sg.beginPath();
    sg.moveTo(92, 32);
    sg.lineTo(124, 18);
    sg.lineTo(120, 32);
    sg.lineTo(124, 46);
    sg.closePath();
    sg.fillStyle = 'rgba(8,24,32,0.35)';
    sg.fill();
    const stex = new THREE.CanvasTexture(sc);
    this.shadowMat = new THREE.MeshBasicMaterial({ map: stex, transparent: true, depthWrite: false, opacity: 0 });
    const sgeo = new THREE.PlaneGeometry(0.9, 0.45);
    sgeo.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sgeo, this.shadowMat);
    this.shadow.renderOrder = 1;

    // Catch "glory": a slowly turning sunburst behind the fish held overhead.
    const gc = document.createElement('canvas');
    gc.width = gc.height = 256;
    const gg = gc.getContext('2d')!;
    gg.translate(128, 128);
    for (let i = 0; i < 18; i++) {
      gg.rotate((Math.PI * 2) / 18);
      const w = i % 2 ? 7 : 13;
      const len = i % 2 ? 100 : 126;
      const lg = gg.createLinearGradient(0, 0, 0, -len);
      lg.addColorStop(0, 'rgba(255,244,200,0.75)');
      lg.addColorStop(1, 'rgba(255,214,140,0)');
      gg.fillStyle = lg;
      gg.beginPath();
      gg.moveTo(-2, 0);
      gg.lineTo(-w, -len);
      gg.lineTo(w, -len);
      gg.lineTo(2, 0);
      gg.closePath();
      gg.fill();
    }
    const rg2 = gg.createRadialGradient(0, 0, 0, 0, 0, 120);
    rg2.addColorStop(0, 'rgba(255,250,225,0.9)');
    rg2.addColorStop(0.3, 'rgba(255,226,150,0.35)');
    rg2.addColorStop(1, 'rgba(255,200,110,0)');
    gg.fillStyle = rg2;
    gg.fillRect(-128, -128, 256, 256);
    const gtex = new THREE.CanvasTexture(gc);
    gtex.colorSpace = THREE.SRGBColorSpace;
    this.gloryMat = new THREE.MeshBasicMaterial({ map: gtex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false, toneMapped: false });
    this.glory = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.gloryMat);
    this.glory.castShadow = false;
    this.glory.receiveShadow = false;
    this.glory.frustumCulled = false;
    this.glory.renderOrder = 7;
    this.glory.visible = false;
    this.glory.userData.noAO = true;

    this.fx.object.userData.perfTag = 'fishing';
    this.heldRoot.name = 'held-fish';
    this.group.add(this.rod, this.grip, this.line, this.bobber, this.shadow, this.fx.object, this.heldRoot, this.glory);
    this.setRodVisible(false);
    this.bobber.visible = false;
    this.line.visible = false;
  }

  setRodVisible(v: boolean): void {
    this.rod.visible = v;
    this.grip.visible = v;
  }

  get rodVisible(): boolean {
    return this.rod.visible;
  }

  /** Rebuild the bent blank for this frame; updates `tip`. */
  poseRod(p: RodPose): void {
    const pos = this.rodGeo.attributes.position as THREE.BufferAttribute;
    const nor = this.rodGeo.attributes.normal as THREE.BufferAttribute;
    const dir = _a.copy(p.dir).normalize();
    // Bend: the blank curves (quadratically along its length) towards the line direction.
    const toward = _b.copy(p.bendTo).sub(p.hand).normalize();
    const perp = toward.sub(_c.copy(dir).multiplyScalar(toward.dot(dir)));
    const bendAmt = p.bend * ROD_LEN * 0.55;
    const side = new THREE.Vector3().crossVectors(dir, _up);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize();
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= ROD_SEG; i++) {
      const s = i / ROD_SEG;
      const pt = p.hand.clone().addScaledVector(dir, s * ROD_LEN * (1 - p.bend * 0.18 * s)).addScaledVector(perp, bendAmt * s * s);
      pts.push(pt);
    }
    this.tip.copy(pts[ROD_SEG]!);
    const t = new THREE.Vector3();
    const n1 = new THREE.Vector3();
    const n2 = new THREE.Vector3();
    for (let i = 0; i <= ROD_SEG; i++) {
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(ROD_SEG, i + 1)]!;
      t.subVectors(b, a).normalize();
      n1.crossVectors(t, side).normalize();
      n2.crossVectors(t, n1).normalize();
      const r = THREE.MathUtils.lerp(0.024, 0.006, Math.pow(i / ROD_SEG, 0.8)) * (i % 3 === 0 && i < ROD_SEG ? 1.25 : 1);
      for (let j = 0; j < ROD_SIDES; j++) {
        const ang = (j / ROD_SIDES) * Math.PI * 2;
        const nx = n1.x * Math.cos(ang) + n2.x * Math.sin(ang);
        const ny = n1.y * Math.cos(ang) + n2.y * Math.sin(ang);
        const nz = n1.z * Math.cos(ang) + n2.z * Math.sin(ang);
        const k = i * ROD_SIDES + j;
        pos.setXYZ(k, pts[i]!.x + nx * r, pts[i]!.y + ny * r, pts[i]!.z + nz * r);
        nor.setXYZ(k, nx, ny, nz);
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    this.rodGeo.computeBoundingSphere();
    // Grip aligned with the blank at the hand.
    this.grip.position.copy(p.hand);
    this.grip.quaternion.setFromUnitVectors(_up, p.dir.clone().normalize());
    this.reelHandle.parent!.rotation.x = p.crank;
  }

  /** Reset the rope as a straight line from the tip to `end` (on cast). */
  resetLine(end: THREE.Vector3): void {
    for (let i = 0; i < LINE_N; i++) {
      this.pts[i]!.lerpVectors(this.tip, end, i / (LINE_N - 1));
      this.prev[i]!.copy(this.pts[i]!);
    }
  }

  /** Verlet rope between the rod tip and the bobber; lays on the water surface. */
  updateLine(dt: number, end: THREE.Vector3, camera: THREE.Camera): void {
    const n = LINE_N;
    const pts = this.pts;
    const straight = this.tip.distanceTo(end);
    const rest = (straight / (n - 1)) * (1 + this.slack * 0.1);
    const g = -9.8 * dt * dt;
    for (let i = 1; i < n - 1; i++) {
      const p = pts[i]!;
      const q = this.prev[i]!;
      const vx = (p.x - q.x) * 0.96;
      const vy = (p.y - q.y) * 0.96;
      const vz = (p.z - q.z) * 0.96;
      q.copy(p);
      p.x += vx;
      p.y += vy + g * (0.35 + this.slack * 0.65);
      p.z += vz;
    }
    pts[0]!.copy(this.tip);
    pts[n - 1]!.copy(end);
    for (let it = 0; it < 14; it++) {
      for (let i = 0; i < n - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        _a.subVectors(b, a);
        const d = _a.length() || 1e-6;
        const diff = (d - rest) / d;
        const wa = i === 0 ? 0 : 0.5;
        const wb = i + 1 === n - 1 ? 0 : 0.5;
        const k = wa + wb || 1;
        a.addScaledVector(_a, (diff * wa) / k);
        b.addScaledVector(_a, (-diff * wb) / k);
      }
      // Float on the water.
      for (let i = 1; i < n - 1; i++) if (pts[i]!.y < this.waterY + 0.005) pts[i]!.y = this.waterY + 0.005;
    }
    // Ribbon facing the camera.
    const pos = this.lineGeo.attributes.position as THREE.BufferAttribute;
    const camPos = camera.position;
    const w = 0.011;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(n - 1, i + 1)]!;
      _a.subVectors(b, a).normalize();
      _b.subVectors(camPos, pts[i]!).normalize();
      _c.crossVectors(_a, _b).normalize().multiplyScalar(w * (1 + camPos.distanceTo(pts[i]!) * 0.02));
      pos.setXYZ(i * 2, pts[i]!.x + _c.x, pts[i]!.y + _c.y, pts[i]!.z + _c.z);
      pos.setXYZ(i * 2 + 1, pts[i]!.x - _c.x, pts[i]!.y - _c.y, pts[i]!.z - _c.z);
    }
    pos.needsUpdate = true;
    this.line.visible = this.lineVisible;
  }

  ripple(p: THREE.Vector3, size = 1, life = 1.4): void {
    const r = this.ripples.reduce((best, x) => (x.age / x.life > best.age / best.life ? x : best), this.ripples[0]!);
    r.age = 0;
    r.life = life;
    r.size = size;
    r.mesh.position.set(p.x, this.waterY + 0.012, p.z);
    r.mesh.visible = true;
  }

  splash(p: THREE.Vector3, big = false): void {
    const at = new THREE.Vector3(p.x, this.waterY + 0.02, p.z);
    this.fx.emit(at, { color: 0xeaf6fa, count: big ? 34 : 14, speed: big ? 2.3 : 1.3, size: big ? 0.11 : 0.07, gravity: 9, life: big ? 0.9 : 0.6, up: big ? 1.9 : 1.4, spread: big ? 0.35 : 0.15 });
    this.fx.emit(at, { color: 0x9fd8e8, count: big ? 18 : 6, speed: big ? 1.6 : 0.9, size: big ? 0.08 : 0.05, gravity: 8, life: 0.7, up: 1.2, spread: 0.3 });
    this.ripple(p, big ? 2.4 : 1.2, big ? 1.6 : 1.2);
    if (big) this.ripple(p, 1.3, 1.0);
  }

  /** Fish shadow near the bobber (0 = hidden). */
  setShadow(p: THREE.Vector3 | null, alpha: number, yaw = 0): void {
    this.shadowMat.opacity = p ? alpha * 0.55 : 0;
    this.shadow.visible = !!p && alpha > 0.01;
    if (p) {
      this.shadow.position.set(p.x, this.waterY - 0.18, p.z);
      this.shadow.rotation.y = yaw;
    }
  }

  /** Sunburst behind `pos` (pushed away from the camera); null hides it. */
  setGlory(pos: THREE.Vector3 | null, camera: THREE.Camera, alpha: number, t: number, size = 2.6): void {
    this.glory.visible = !!pos && alpha > 0.01;
    if (!pos || !this.glory.visible) return;
    _a.copy(pos).sub(camera.position).normalize();
    this.glory.position.copy(pos).addScaledVector(_a, 1.6);
    this.glory.scale.setScalar(size * (0.96 + 0.04 * Math.sin(t * 3)));
    this.glory.quaternion.copy(camera.quaternion);
    this.glory.rotateZ(t * 0.35);
    this.gloryMat.opacity = alpha;
  }

  /** Show a fish held above the head (null to hide). */
  hold(def: FishDef | null, lengthCm = 40): void {
    if (this.held) this.heldRoot.remove(this.held.mesh.group);
    this.held = null;
    if (!def) return;
    let mesh = this.meshCache.get(def.id);
    if (!mesh) {
      mesh = buildFishMesh(def);
      this.meshCache.set(def.id, mesh);
    }
    // Visual size: readable at gameplay zoom, loosely following the real length.
    const s = THREE.MathUtils.clamp(0.45 + lengthCm / 110, 0.55, 1.5);
    mesh.group.scale.setScalar(s);
    this.heldRoot.add(mesh.group);
    this.held = { def, mesh };
  }

  update(dt: number, t: number, h: number): void {
    for (const r of this.ripples) {
      if (!r.mesh.visible) continue;
      r.age += dt / r.life;
      if (r.age >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const s = r.size * (0.35 + r.age * 1.1);
      r.mesh.scale.set(s, 1, s);
      r.mat.uniforms.uAge!.value = r.age;
    }
    this.fx.update(dt, h);
    if (this.held) this.held.mesh.flex(t, 0.8 + 0.4 * Math.sin(t * 3));
  }
}
