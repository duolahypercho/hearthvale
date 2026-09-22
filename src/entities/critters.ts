/**
 * Small ambient critters with tiny procedural rigs (one shared vertex-coloured material):
 *  - Butterfly: flutters between flower spots, wing flap + bobbing path.
 *  - Songbird: hops, pecks, looks around; flies off when the player gets close.
 *  - Cat: sits on the porch — breathing, tail sway, ear twitch, slow blinks; curls up at night.
 *  - Chicken: wanders a yard, pecks with a head-bob, occasional flap.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { MeshBuilder, lumpySphere, mat, roundedBox } from '../world/geom';
import { applyWorldFx } from '../render/worldfx';

let critterMat: THREE.MeshStandardMaterial | null = null;
function cmat(): THREE.MeshStandardMaterial {
  if (!critterMat) {
    critterMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
    critterMat.name = 'critter';
    applyWorldFx(critterMat, { snow: false });
  }
  return critterMat;
}

function part(fn: (b: MeshBuilder, m: THREE.Material) => void, shadow = true): THREE.Mesh {
  const b = new MeshBuilder();
  const m = cmat();
  fn(b, m);
  const g = b.geometries().get(m)!;
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  return mesh;
}

export type HeightFn = (x: number, z: number) => number;

export class Butterfly {
  readonly root = new THREE.Group();
  private wings: THREE.Mesh;
  private pos = new THREE.Vector3();
  private target = new THREE.Vector3();
  private phase: number;
  private rest = 0;

  constructor(private spots: THREE.Vector3[], private heightAt: HeightFn, seed: number, color: number) {
    const rng = new Rng(`bfly${seed}`);
    this.phase = rng.next() * 10;
    const c = new THREE.Color(color);
    // One mesh (body + both wings); the flap is a squash of the wing span (cheap, 1 draw call).
    this.wings = part((b, m) => {
      for (const sx of [-1, 1]) {
        for (const [w, h, z] of [[0.13, 0.11, -0.02], [0.1, 0.08, 0.07]] as const) {
          const g = new THREE.CircleGeometry(0.5, 10);
          g.scale(w, h, 1);
          g.rotateX(-Math.PI / 2);
          b.add(m, g, mat(sx * w * 0.5, 0, z), { tint: c.clone().multiplyScalar(z > 0 ? 0.85 : 1) });
          const dot = new THREE.CircleGeometry(0.5, 8);
          dot.scale(w * 0.35, h * 0.35, 1);
          dot.rotateX(-Math.PI / 2);
          b.add(m, dot, mat(sx * w * 0.62, 0.002, z - 0.01), { tint: 0x2a1a20 });
        }
      }
      b.add(m, new THREE.CapsuleGeometry(0.012, 0.08, 3, 6), mat(0, 0, 0, Math.PI / 2, 0, 0), { tint: 0x2a2020 });
    }, false);
    this.root.add(this.wings);
    this.pos.copy(spots[Math.floor(rng.next() * spots.length)]!);
    this.pickTarget();
  }

  private pickTarget(): void {
    const s = this.spots[Math.floor(Math.random() * this.spots.length)]!;
    this.target.set(s.x + (Math.random() - 0.5) * 2, 0, s.z + (Math.random() - 0.5) * 2);
  }

  update(dt: number, t: number): void {
    const d = this.target.clone().sub(this.pos).setY(0);
    const dist = d.length();
    if (this.rest > 0) {
      this.rest -= dt;
      this.wings.scale.x = 0.55 + Math.sin(t * 3 + this.phase) * 0.3;
      if (this.rest <= 0) this.pickTarget();
    } else {
      if (dist < 0.3) {
        this.rest = 1 + Math.random() * 3;
      } else {
        d.normalize();
        const wob = new THREE.Vector3(Math.sin(t * 2.3 + this.phase), 0, Math.cos(t * 1.9 + this.phase)).multiplyScalar(0.6);
        this.pos.addScaledVector(d.add(wob).normalize(), dt * 1.1);
        this.root.rotation.y = Math.atan2(d.x, d.z);
      }
      this.wings.scale.x = 0.25 + Math.abs(Math.sin(t * 13 + this.phase)) * 0.85;
    }
    const g = this.heightAt(this.pos.x, this.pos.z);
    const hover = this.rest > 0 ? 0.32 : 0.55 + Math.sin(t * 3.1 + this.phase) * 0.18 + Math.sin(t * 7 + this.phase) * 0.05;
    this.pos.y += (g + hover - this.pos.y) * Math.min(1, dt * 4);
    this.root.position.copy(this.pos);
  }
}

export class Songbird {
  readonly root = new THREE.Group();
  private head: THREE.Mesh;
  private body: THREE.Mesh;
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private hopT = 0;
  private actT = 0;
  private flying = 0;
  private yaw = 0;

  constructor(private home: THREE.Vector3, private radius: number, private heightAt: HeightFn, seed: number) {
    const rng = new Rng(`bird${seed}`);
    const tone = rng.next() < 0.5 ? 0x8a5a3a : 0x5a6a8a;
    this.body = part((b, m) => {
      const bod = lumpySphere(0.075, 1, 0.08, rng);
      bod.scale(1, 0.9, 1.35);
      b.add(m, bod, mat(0, 0.1, 0), { tint: tone });
      b.add(m, new THREE.SphereGeometry(0.06, 8, 6), mat(0, 0.085, 0.03, 0, 0, 0, 1, 0.8, 1.1), { tint: 0xe8d8c0 });
      const tail = roundedBox(0.06, 0.012, 0.1, 0.005);
      b.add(m, tail, mat(0, 0.12, -0.12, -0.35, 0, 0), { tint: 0x4a3a30 });
      for (const s of [-1, 1]) {
        const wing = lumpySphere(0.05, 1, 0.1, rng);
        wing.scale(0.4, 0.6, 1.3);
        b.add(m, wing, mat(s * 0.065, 0.11, -0.01), { tint: new THREE.Color(tone).multiplyScalar(0.75) });
        b.add(m, new THREE.CylinderGeometry(0.005, 0.005, 0.06, 3), mat(s * 0.025, 0.03, 0.0), { tint: 0xc08050 });
      }
    });
    this.head = part((b, m) => {
      b.add(m, new THREE.SphereGeometry(0.05, 10, 8), mat(0, 0, 0), { tint: tone });
      b.add(m, new THREE.ConeGeometry(0.014, 0.04, 5), mat(0, -0.005, 0.06, Math.PI / 2, 0, 0), { tint: 0xe0a030 });
      for (const s of [-1, 1]) b.add(m, new THREE.SphereGeometry(0.01, 6, 4), mat(s * 0.035, 0.012, 0.03), { tint: 0x101010 });
    });
    this.head.position.set(0, 0.17, 0.07);
    this.root.add(this.body, this.head);
    this.pos.set(home.x + (rng.next() - 0.5) * radius, 0, home.z + (rng.next() - 0.5) * radius);
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.yaw = rng.next() * 6;
  }

  update(dt: number, t: number, player: THREE.Vector3): void {
    const g = this.heightAt(this.pos.x, this.pos.z);
    if (this.flying > 0) {
      this.flying -= dt;
      this.vel.y += dt * 2;
      this.pos.addScaledVector(this.vel, dt);
      this.body.rotation.x = -0.3;
      if (this.flying <= 0) {
        // land somewhere else in the home area
        this.pos.set(this.home.x + (Math.random() - 0.5) * this.radius, 0, this.home.z + (Math.random() - 0.5) * this.radius);
        this.pos.y = this.heightAt(this.pos.x, this.pos.z);
        this.vel.set(0, 0, 0);
        this.root.visible = true;
      }
      if (this.pos.y > g + 6) this.root.visible = false;
    } else {
      this.root.visible = true;
      if (player.distanceTo(this.pos) < 2.2) {
        this.flying = 4;
        const away = this.pos.clone().sub(player).setY(0).normalize();
        this.vel.set(away.x * 4, 2.5, away.z * 4);
        this.yaw = Math.atan2(away.x, away.z);
      }
      this.actT -= dt;
      this.hopT = Math.max(0, this.hopT - dt);
      if (this.actT <= 0) {
        const r = Math.random();
        if (r < 0.45) {
          this.hopT = 0.22;
          this.yaw += (Math.random() - 0.5) * 1.6;
          const dx = this.pos.x - this.home.x;
          const dz = this.pos.z - this.home.z;
          if (Math.hypot(dx, dz) > this.radius) this.yaw = Math.atan2(-dx, -dz);
        }
        this.actT = 0.3 + Math.random() * 1.2;
      }
      if (this.hopT > 0) {
        this.pos.x += Math.sin(this.yaw) * dt * 1.4;
        this.pos.z += Math.cos(this.yaw) * dt * 1.4;
      }
      const hop = this.hopT > 0 ? Math.sin((this.hopT / 0.22) * Math.PI) * 0.08 : 0;
      this.pos.y = g + hop;
      const peck = Math.max(0, Math.sin(t * 5 + this.home.x)) > 0.92 ? 0.5 : 0;
      this.head.rotation.x = peck;
      this.head.rotation.y = Math.sin(t * 1.3 + this.home.z) * 0.6;
      this.body.rotation.x = peck * 0.3;
    }
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }
}

export class Cat {
  readonly root = new THREE.Group();
  private body: THREE.Mesh;
  private head: THREE.Mesh;
  private tail: THREE.Group;
  private tailSegs: THREE.Mesh[] = [];
  private blinkT = 2;
  private eyes: THREE.Mesh;

  constructor(seed: number) {
    const rng = new Rng(`cat${seed}`);
    const fur = 0xe0873a;
    const cream = 0xf6e2c4;
    this.body = part((b, m) => {
      const bod = lumpySphere(0.2, 2, 0.04, rng);
      bod.scale(0.95, 0.85, 1.35);
      b.add(m, bod, mat(0, 0.18, 0), { tint: fur });
      b.add(m, new THREE.SphereGeometry(0.13, 10, 8), mat(0, 0.16, 0.14, 0, 0, 0, 1, 1.1, 0.8), { tint: cream });
      for (const s of [-1, 1]) {
        b.add(m, new THREE.CapsuleGeometry(0.045, 0.1, 3, 8), mat(s * 0.08, 0.07, 0.2, 0.25, 0, 0), { tint: cream });
        b.add(m, lumpySphere(0.09, 1, 0.1, rng), mat(s * 0.12, 0.1, -0.12, 0, 0, 0, 0.8, 0.9, 1.3), { tint: fur });
      }
      // tabby stripes
      for (let i = 0; i < 4; i++) b.add(m, new THREE.TorusGeometry(0.19, 0.012, 4, 12, Math.PI), mat(0, 0.19, -0.14 + i * 0.07, 0, Math.PI / 2, 0, 1, 0.9, 1), { tint: 0xb85a20 });
    });
    this.head = part((b, m) => {
      const h = lumpySphere(0.13, 2, 0.03, rng);
      h.scale(1.1, 0.95, 1);
      b.add(m, h, mat(0, 0, 0), { tint: fur });
      b.add(m, new THREE.SphereGeometry(0.06, 8, 6), mat(0, -0.04, 0.09, 0, 0, 0, 1.2, 0.8, 0.7), { tint: cream });
      b.add(m, new THREE.SphereGeometry(0.014, 6, 4), mat(0, -0.02, 0.135), { tint: 0xd86a7a });
      for (const s of [-1, 1]) {
        const ear = new THREE.ConeGeometry(0.05, 0.1, 4);
        b.add(m, ear, mat(s * 0.075, 0.12, -0.01, -0.1, 0, s * -0.25), { tint: fur });
        b.add(m, new THREE.ConeGeometry(0.028, 0.06, 4), mat(s * 0.073, 0.115, 0.012, -0.1, 0, s * -0.25), { tint: 0xf0a8a0 });
        b.add(m, roundedBox(0.035, 0.008, 0.01, 0.003), mat(s * 0.07, 0.07, 0.09, 0, 0, s * 0.3), { tint: 0xb85a20 });
      }
    });
    this.eyes = part((b, m) => {
      for (const s of [-1, 1]) {
        b.add(m, new THREE.SphereGeometry(0.022, 8, 6), mat(s * 0.05, 0.005, 0.105, 0, 0, 0, 1, 1.2, 0.6), { tint: 0x7ab848 });
        b.add(m, new THREE.SphereGeometry(0.012, 6, 4), mat(s * 0.05, 0.005, 0.117, 0, 0, 0, 0.5, 1.3, 0.5), { tint: 0x101010 });
      }
    }, false);
    this.head.add(this.eyes);
    this.head.position.set(0, 0.36, 0.2);
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.1, -0.26);
    let parent: THREE.Object3D = this.tail;
    for (let i = 0; i < 5; i++) {
      const seg = part((b, m) => b.add(m, new THREE.CapsuleGeometry(0.03 - i * 0.003, 0.06, 3, 6), mat(0, 0.045, 0), { tint: i === 4 ? 0xb85a20 : fur }), i === 0);
      seg.position.y = i ? 0.075 : 0;
      parent.add(seg);
      this.tailSegs.push(seg);
      parent = seg;
    }
    this.tail.rotation.x = -1.2;
    this.root.add(this.body, this.head, this.tail);
  }

  update(dt: number, t: number, night: number): void {
    const br = Math.sin(t * 1.8) * 0.02;
    this.body.scale.set(1 + br, 1 + br * 1.4, 1 + br);
    this.head.rotation.y = Math.sin(t * 0.35) * 0.5 + Math.sin(t * 1.3) * 0.05;
    this.head.rotation.z = Math.sin(t * 0.5) * 0.08;
    this.head.position.y = 0.36 - night * 0.14;
    this.tailSegs.forEach((s, i) => {
      s.rotation.x = 0.25 + Math.sin(t * 1.6 - i * 0.6) * 0.12;
      s.rotation.z = Math.sin(t * 1.1 - i * 0.5) * 0.25;
    });
    this.blinkT -= dt;
    const closed = night > 0.6 || this.blinkT < 0.15;
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 4;
    this.eyes.scale.y = closed ? 0.12 : 1;
  }
}

export class Chicken {
  readonly root = new THREE.Group();
  private head: THREE.Mesh;
  private body: THREE.Mesh;
  private pos = new THREE.Vector3();
  private yaw: number;
  private walkT = 0;
  private peckT = 0;
  private actT = 0;

  constructor(private home: THREE.Vector3, private radius: number, private heightAt: HeightFn, seed: number) {
    const rng = new Rng(`chick${seed}`);
    const tone = [0xf8f2e6, 0xc8844a, 0xf8f2e6][seed % 3]!;
    this.body = part((b, m) => {
      const bod = lumpySphere(0.17, 2, 0.05, rng);
      bod.scale(0.9, 0.85, 1.15);
      b.add(m, bod, mat(0, 0.28, 0), { tint: tone });
      for (const s of [-1, 1]) {
        const wing = lumpySphere(0.1, 1, 0.08, rng);
        wing.scale(0.35, 0.7, 1.2);
        b.add(m, wing, mat(s * 0.14, 0.3, -0.02), { tint: new THREE.Color(tone).multiplyScalar(0.88) });
        b.add(m, new THREE.CylinderGeometry(0.012, 0.012, 0.16, 4), mat(s * 0.06, 0.08, 0), { tint: 0xe8a040 });
        b.add(m, roundedBox(0.06, 0.012, 0.08, 0.005), mat(s * 0.06, 0.006, 0.03), { tint: 0xe8a040 });
      }
      const tail = lumpySphere(0.08, 1, 0.15, rng);
      tail.scale(0.6, 1.2, 0.7);
      b.add(m, tail, mat(0, 0.4, -0.17, -0.5, 0, 0), { tint: tone === 0xc8844a ? 0x3a2a20 : tone });
    });
    this.head = part((b, m) => {
      b.add(m, new THREE.SphereGeometry(0.08, 10, 8), mat(0, 0, 0), { tint: tone });
      b.add(m, new THREE.ConeGeometry(0.025, 0.06, 5), mat(0, -0.01, 0.09, Math.PI / 2, 0, 0), { tint: 0xf0b030 });
      for (let i = 0; i < 3; i++) b.add(m, new THREE.SphereGeometry(0.025, 6, 4), mat(0, 0.08 - i * 0.004, -0.02 + i * 0.03), { tint: 0xd83a2a });
      b.add(m, new THREE.SphereGeometry(0.02, 6, 4), mat(0, -0.06, 0.06, 0, 0, 0, 1, 1.4, 1), { tint: 0xd83a2a });
      for (const s of [-1, 1]) b.add(m, new THREE.SphereGeometry(0.012, 6, 4), mat(s * 0.055, 0.015, 0.045), { tint: 0x101010 });
    });
    this.head.position.set(0, 0.5, 0.14);
    this.root.add(this.body, this.head);
    this.pos.set(home.x + (rng.next() - 0.5) * radius, 0, home.z + (rng.next() - 0.5) * radius);
    this.yaw = rng.next() * 6;
  }

  update(dt: number, t: number): void {
    this.actT -= dt;
    if (this.actT <= 0) {
      const r = Math.random();
      if (r < 0.4) {
        this.walkT = 0.8 + Math.random() * 1.5;
        this.yaw += (Math.random() - 0.5) * 2.2;
        const dx = this.pos.x - this.home.x;
        const dz = this.pos.z - this.home.z;
        if (Math.hypot(dx, dz) > this.radius) this.yaw = Math.atan2(-dx, -dz);
      } else if (r < 0.85) this.peckT = 0.9 + Math.random();
      this.actT = 1 + Math.random() * 2;
    }
    let bob = 0;
    if (this.walkT > 0) {
      this.walkT -= dt;
      this.pos.x += Math.sin(this.yaw) * dt * 0.7;
      this.pos.z += Math.cos(this.yaw) * dt * 0.7;
      bob = Math.abs(Math.sin(t * 11)) * 0.02;
      this.head.position.z = 0.14 + Math.sin(t * 11) * 0.03;
      this.head.rotation.x = 0;
    } else if (this.peckT > 0) {
      this.peckT -= dt;
      const p = Math.max(0, Math.sin(t * 9));
      this.head.rotation.x = 0.9 * p;
      this.head.position.set(0, 0.5 - p * 0.22, 0.14 + p * 0.12);
    } else {
      this.head.position.set(0, 0.5, 0.14);
      this.head.rotation.x = 0;
      this.head.rotation.y = Math.sin(t * 0.8 + this.home.x) * 0.5;
    }
    this.pos.y = this.heightAt(this.pos.x, this.pos.z) + bob;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }
}
