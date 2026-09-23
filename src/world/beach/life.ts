/**
 * Beach wildlife (instanced, a handful of draw calls for everything):
 *   gulls   wheeling over the surf (flap → glide cycles, banking into turns) plus a few perched on
 *           the pier posts / sand that preen, look around and hop off when the farmer comes close
 *   crabs   scuttle sideways over the wet sand in bursts, dash for the water and burrow when
 *           approached, then pop back up somewhere else
 *   leaps   now and then a fish jumps clear of the water out past the breakers, with a splash
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { BurstFX } from '../../render/particles';
import { applyWorldFx } from '../../render/worldfx';
import { FISH } from '../../data/fish';
import { buildFishMesh, type FishMesh } from './fishmesh';

function paint(g: THREE.BufferGeometry, c: number | THREE.Color): THREE.BufferGeometry {
  const col = new THREE.Color(c);
  const n = g.attributes.position!.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.toArray(a, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
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
    if (!g.attributes.normal) g.computeVertexNormals();
    const c = g.attributes.position!.count;
    P.set((g.attributes.position as THREE.BufferAttribute).array as Float32Array, o * 3);
    N.set((g.attributes.normal as THREE.BufferAttribute).array as Float32Array, o * 3);
    C.set((g.attributes.color as THREE.BufferAttribute).array as Float32Array, o * 3);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return out;
}

function gullBody(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.16, 12, 8);
  body.scale(1.9, 0.95, 1.0);
  paint(body, 0xf6f6f2);
  const back = new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.45);
  back.scale(1.7, 0.7, 0.9);
  back.translate(-0.03, 0.035, 0);
  paint(back, 0xa8b2bc);
  const head = new THREE.SphereGeometry(0.1, 10, 8);
  head.translate(0.28, 0.1, 0);
  paint(head, 0xfafaf6);
  const beak = new THREE.ConeGeometry(0.03, 0.14, 6);
  beak.rotateZ(-Math.PI / 2);
  beak.translate(0.42, 0.085, 0);
  paint(beak, 0xf2c83a);
  const dot = new THREE.SphereGeometry(0.014, 5, 4);
  dot.translate(0.43, 0.07, 0);
  paint(dot, 0xd8402e);
  const eyes: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const e = new THREE.SphereGeometry(0.018, 6, 4);
    e.translate(0.33, 0.13, s * 0.07);
    eyes.push(paint(e, 0x14161a));
  }
  const tail = new THREE.ConeGeometry(0.09, 0.22, 4);
  tail.rotateZ(Math.PI / 2);
  tail.scale(1, 0.35, 1);
  tail.translate(-0.36, 0.03, 0);
  paint(tail, 0x2a2c30);
  const legs: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const l = new THREE.CylinderGeometry(0.012, 0.012, 0.18, 4);
    l.translate(0.02, -0.2, s * 0.05);
    legs.push(paint(l, 0xe0a08a));
  }
  return merge([body, back, head, beak, dot, tail, ...eyes, ...legs]);
}

/** Wing: pivot at the shoulder (origin), spans +Z (left). Grey with black primaries. */
function gullWing(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0.1, 0);
  s.bezierCurveTo(0.12, 0.25, 0.02, 0.55, -0.12, 0.72);
  s.lineTo(-0.2, 0.66);
  s.bezierCurveTo(-0.14, 0.45, -0.16, 0.2, -0.14, 0);
  s.lineTo(0.1, 0);
  const g = new THREE.ShapeGeometry(s, 6);
  g.rotateX(Math.PI / 2); // shape XY → XZ
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const grey = new THREE.Color(0xb0bac4);
  const black = new THREE.Color(0x22242a);
  const white = new THREE.Color(0xf4f4f0);
  for (let i = 0; i < pos.count; i++) {
    const z = Math.abs(pos.getZ(i));
    const c = z > 0.56 ? black : z > 0.52 ? white : grey;
    c.toArray(col, i * 3);
    // gentle camber
    pos.setY(i, Math.sin((z / 0.72) * Math.PI) * 0.03);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function crabGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const shell = new THREE.SphereGeometry(0.11, 12, 8);
  shell.scale(1.0, 0.45, 1.25);
  shell.translate(0, 0.07, 0);
  parts.push(paint(shell, 0xe0583a));
  const belly = new THREE.SphereGeometry(0.1, 10, 6);
  belly.scale(0.95, 0.3, 1.15);
  belly.translate(0, 0.045, 0);
  parts.push(paint(belly, 0xf2c8a0));
  for (const s of [-1, 1]) {
    // Claws (front = +X).
    const arm = new THREE.CylinderGeometry(0.018, 0.02, 0.12, 5);
    arm.rotateZ(Math.PI / 2 - 0.4);
    arm.rotateY(s * 0.6);
    arm.translate(0.1, 0.08, s * 0.09);
    parts.push(paint(arm, 0xd8503a));
    const claw = new THREE.SphereGeometry(0.045, 8, 6);
    claw.scale(1.4, 0.8, 0.9);
    claw.translate(0.17, 0.1, s * 0.13);
    parts.push(paint(claw, 0xe8603e));
    const pin = new THREE.ConeGeometry(0.018, 0.07, 5);
    pin.rotateZ(-Math.PI / 2);
    pin.translate(0.24, 0.1, s * 0.12);
    parts.push(paint(pin, 0xf07a52));
    // Eye stalks.
    const st = new THREE.CylinderGeometry(0.008, 0.008, 0.06, 4);
    st.translate(0.08, 0.12, s * 0.035);
    parts.push(paint(st, 0xd8503a));
    const eye = new THREE.SphereGeometry(0.016, 6, 4);
    eye.translate(0.08, 0.155, s * 0.035);
    parts.push(paint(eye, 0x121418));
    // Legs: three per side, bent.
    for (let k = 0; k < 3; k++) {
      const x = -0.05 + k * 0.05;
      const l1 = new THREE.CylinderGeometry(0.01, 0.012, 0.12, 4);
      l1.rotateX(s * 1.0);
      l1.translate(x, 0.08, s * 0.17);
      parts.push(paint(l1, 0xc84a32));
      const l2 = new THREE.CylinderGeometry(0.008, 0.01, 0.1, 4);
      l2.rotateX(-s * 0.35);
      l2.translate(x, 0.03, s * 0.24);
      parts.push(paint(l2, 0xc84a32));
    }
  }
  return merge(parts);
}

interface Gull {
  perch: THREE.Vector3 | null;
  cx: number;
  cz: number;
  r: number;
  h: number;
  speed: number;
  ang: number;
  flapT: number;
  pos: THREE.Vector3;
  yaw: number;
  bank: number;
  look: number;
  lookT: number;
  fly: number; // perched → flying blend when spooked
}

interface Crab {
  pos: THREE.Vector3;
  home: THREE.Vector3;
  yaw: number;
  vx: number;
  vz: number;
  t: number;
  burrow: number;
  hidden: number;
}

export class BeachLife {
  readonly group = new THREE.Group();
  private gullBody: THREE.InstancedMesh;
  private wingL: THREE.InstancedMesh;
  private wingR: THREE.InstancedMesh;
  private crabMesh: THREE.InstancedMesh;
  private gulls: Gull[] = [];
  private crabs: Crab[] = [];
  private fx = new BurstFX(160);
  private leap: { mesh: FishMesh; t: number; from: THREE.Vector3; dir: THREE.Vector3; active: boolean; next: number };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3(1, 1, 1);

  constructor(
    private rng: Rng,
    private heightAt: (x: number, z: number) => number,
    private seaLevel: number,
    perches: THREE.Vector3[],
    crabSpots: THREE.Vector3[],
  ) {
    this.group.name = 'beach-life';
    this.group.userData.perfTag = 'critters';
    this.group.userData.noAO = true;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    mat.name = 'gull';
    applyWorldFx(mat, { snowUp: 0 });
    const wingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    wingMat.name = 'gullWing';
    const nG = 7 + perches.length;
    this.gullBody = new THREE.InstancedMesh(gullBody(), mat, nG);
    this.wingL = new THREE.InstancedMesh(gullWing(), wingMat, nG);
    this.wingR = new THREE.InstancedMesh(gullWing(), wingMat, nG);
    for (const im of [this.gullBody, this.wingL, this.wingR]) {
      im.castShadow = true;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
    }
    for (let i = 0; i < 7; i++) {
      this.gulls.push({
        perch: null,
        cx: 30 + rng.next() * 40,
        cz: 46 + rng.next() * 14,
        r: 6 + rng.next() * 9,
        h: 6 + rng.next() * 6,
        speed: (0.35 + rng.next() * 0.2) * (rng.next() < 0.5 ? 1 : -1),
        ang: rng.next() * Math.PI * 2,
        flapT: rng.next() * 10,
        pos: new THREE.Vector3(),
        yaw: 0,
        bank: 0,
        look: 0,
        lookT: 0,
        fly: 1,
      });
    }
    for (const p of perches) {
      this.gulls.push({ perch: p.clone(), cx: p.x, cz: p.z + 8, r: 7, h: 7, speed: 0.45, ang: rng.next() * 6, flapT: 0, pos: p.clone(), yaw: rng.next() * 6.28, bank: 0, look: 0, lookT: rng.next() * 3, fly: 0 });
    }
    const crabMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
    crabMat.name = 'crab';
    applyWorldFx(crabMat, { snowUp: 0 });
    this.crabMesh = new THREE.InstancedMesh(crabGeo(), crabMat, crabSpots.length);
    this.crabMesh.castShadow = true;
    this.crabMesh.frustumCulled = false;
    this.crabMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.crabMesh);
    for (const p of crabSpots) this.crabs.push({ pos: p.clone(), home: p.clone(), yaw: rng.next() * 6.28, vx: 0, vz: 0, t: rng.next() * 3, burrow: 0, hidden: 0 });
    this.group.add(this.fx.object);
    const beachFish = FISH.filter((f) => f.maps.includes('beach') && f.look.tail !== 'eel' && !f.look.flat);
    const mesh = buildFishMesh(rng.pick(beachFish));
    mesh.group.scale.setScalar(0.6);
    mesh.group.visible = false;
    this.group.add(mesh.group);
    this.leap = { mesh, t: 0, from: new THREE.Vector3(), dir: new THREE.Vector3(), active: false, next: 3 + rng.next() * 5 };
  }

  update(dt: number, t: number, player: THREE.Vector3, viewportH: number): void {
    // Gulls.
    this.gulls.forEach((g, i) => {
      const near = player.distanceTo(g.pos) < 3.2;
      if (g.perch) {
        if (near && g.fly === 0) g.fly = 0.001;
        if (g.fly > 0) {
          g.fly = Math.min(1, g.fly + dt * 0.6);
          if (g.fly >= 1 && player.distanceTo(g.perch) > 9) g.fly = -1; // come back to land
        } else if (g.fly < 0) {
          g.fly = Math.min(0, g.fly + dt * 0.5);
        }
      }
      const flying = !g.perch || g.fly !== 0;
      if (flying) {
        g.ang += (g.speed / g.r) * dt * 6;
        const tx = g.cx + Math.cos(g.ang) * g.r;
        const tz = g.cz + Math.sin(g.ang) * g.r * 0.6;
        const ty = this.seaLevel + g.h + Math.sin(t * 0.4 + i) * 0.8;
        let target = new THREE.Vector3(tx, ty, tz);
        if (g.perch) {
          const k = g.fly > 0 ? g.fly : 1 + g.fly;
          target = g.perch.clone().lerp(target, THREE.MathUtils.smoothstep(k, 0, 1));
        }
        const prev = g.pos.clone();
        g.pos.lerp(target, 1 - Math.exp(-dt * (g.perch ? 3 : 8)));
        const v = g.pos.clone().sub(prev);
        if (v.lengthSq() > 1e-6) g.yaw = Math.atan2(-v.z, v.x);
        g.bank = THREE.MathUtils.lerp(g.bank, -Math.sign(g.speed) * 0.35, dt * 2);
      } else {
        g.pos.copy(g.perch!);
        g.bank = 0;
        g.lookT -= dt;
        if (g.lookT <= 0) {
          g.look = (this.rng.next() - 0.5) * 1.6;
          g.lookT = 1 + this.rng.next() * 3;
        }
      }
      // Flap/glide cycle.
      g.flapT += dt;
      const cyc = g.flapT % 5;
      let wing = 0.1;
      if (flying) wing = cyc < 1.6 ? Math.sin(g.flapT * 11) * 0.75 : 0.12 + Math.sin(t * 2 + i) * 0.05;
      else wing = -1.25; // folded
      this.e.set(g.bank, g.yaw + (flying ? 0 : g.look * 0.3), 0, 'YXZ');
      this.q.setFromEuler(this.e);
      this.s.set(1, 1, 1);
      this.m.compose(g.pos, this.q, this.s);
      this.gullBody.setMatrixAt(i, this.m);
      for (const [im, side] of [[this.wingL, 1], [this.wingR, -1]] as const) {
        const wq = new THREE.Quaternion().setFromEuler(new THREE.Euler(side * -wing, 0, 0));
        const wm = new THREE.Matrix4().compose(new THREE.Vector3(0.02, 0.06, side * 0.08), wq, new THREE.Vector3(1, 1, side));
        const folded = !flying ? new THREE.Matrix4().makeScale(0.75, 1, 0.5) : new THREE.Matrix4();
        im.setMatrixAt(i, this.m.clone().multiply(wm).multiply(folded));
      }
    });
    this.gullBody.instanceMatrix.needsUpdate = true;
    this.wingL.instanceMatrix.needsUpdate = true;
    this.wingR.instanceMatrix.needsUpdate = true;

    // Crabs.
    this.crabs.forEach((c, i) => {
      c.t -= dt;
      const d = Math.hypot(player.x - c.pos.x, player.z - c.pos.z);
      if (c.hidden > 0) {
        c.hidden -= dt;
        if (c.hidden <= 0) {
          c.pos.set(c.home.x + (this.rng.next() - 0.5) * 6, 0, c.home.z + (this.rng.next() - 0.5) * 3);
          c.burrow = 1;
        }
      } else if (d < 2.2 && c.burrow < 0.01) {
        // Dash away sideways, then dig in.
        const ax = (c.pos.x - player.x) / (d || 1);
        const az = (c.pos.z - player.z) / (d || 1);
        c.vx = ax * 2.6;
        c.vz = az * 2.6;
        c.t = 0.6;
        c.burrow = 0.001;
      } else if (c.t <= 0) {
        // Scuttle burst sideways (crabs walk along their side axis).
        const side = this.rng.next() < 0.5 ? 1 : -1;
        const sp = 0.6 + this.rng.next() * 0.8;
        c.vx = Math.sin(c.yaw) * side * sp;
        c.vz = Math.cos(c.yaw) * side * sp;
        c.t = 0.4 + this.rng.next() * 0.7;
        if (this.rng.next() < 0.3) c.yaw += (this.rng.next() - 0.5) * 1.2;
      }
      if (c.burrow > 0 && c.burrow < 1 && c.t <= 0) {
        c.burrow = Math.min(1, c.burrow + dt * 1.8);
        if (c.burrow >= 1) {
          c.hidden = 4 + this.rng.next() * 6;
          this.fx.emit(c.pos, { color: 0xd8c8a0, count: 6, speed: 0.6, size: 0.05, gravity: 5, life: 0.5, up: 0.8 });
        }
      } else if (c.burrow >= 1 && c.hidden <= 0) {
        c.burrow = Math.max(0, c.burrow - dt * 1.2); // emerging
        if (c.burrow <= 0.001) c.burrow = 0;
      }
      if (c.t > 0) {
        c.pos.x += c.vx * dt;
        c.pos.z += c.vz * dt;
        // Stay on the sand.
        c.pos.x = THREE.MathUtils.clamp(c.pos.x, c.home.x - 8, c.home.x + 8);
        c.pos.z = THREE.MathUtils.clamp(c.pos.z, c.home.z - 4, c.home.z + 3);
      }
      const y = this.heightAt(c.pos.x, c.pos.z);
      const moving = c.t > 0 ? 1 : 0;
      const sink = c.hidden > 0 ? 0.4 : (c.burrow > 0 && c.burrow < 1 ? c.burrow : c.burrow >= 1 ? 1 : 0) * 0.2;
      this.e.set(Math.sin(t * 30 + i) * 0.08 * moving, c.yaw, Math.sin(t * 23 + i) * 0.05 * moving, 'YXZ');
      this.q.setFromEuler(this.e);
      this.s.setScalar(c.hidden > 0 ? 0.0001 : 1.15);
      this.m.compose(new THREE.Vector3(c.pos.x, Math.max(y, this.seaLevel - 0.1) - sink + Math.abs(Math.sin(t * 28 + i)) * 0.012 * moving, c.pos.z), this.q, this.s);
      this.crabMesh.setMatrixAt(i, this.m);
    });
    this.crabMesh.instanceMatrix.needsUpdate = true;

    // Leaping fish.
    const L = this.leap;
    L.next -= dt;
    if (!L.active && L.next <= 0) {
      L.active = true;
      L.t = 0;
      L.from.set(24 + this.rng.next() * 40, this.seaLevel, 52 + this.rng.next() * 16);
      const a = this.rng.next() * Math.PI * 2;
      L.dir.set(Math.cos(a), 0, Math.sin(a));
      L.mesh.group.visible = true;
      this.fx.emit(L.from, { color: 0xeaf6fa, count: 14, speed: 1.6, size: 0.09, gravity: 9, life: 0.7, up: 1.6, spread: 0.3 });
    }
    if (L.active) {
      L.t += dt / 0.9;
      const k = Math.min(1, L.t);
      const p = L.from.clone().addScaledVector(L.dir, k * 2.2);
      p.y += Math.sin(k * Math.PI) * 1.1;
      L.mesh.group.position.copy(p);
      L.mesh.group.rotation.set(0, Math.atan2(-L.dir.z, L.dir.x) + Math.PI, (0.5 - k) * 2.2, 'YXZ');
      L.mesh.flex(t, 1.5);
      if (k >= 1) {
        L.active = false;
        L.mesh.group.visible = false;
        L.next = 5 + this.rng.next() * 9;
        this.fx.emit(p, { color: 0xeaf6fa, count: 18, speed: 1.8, size: 0.1, gravity: 9, life: 0.8, up: 1.7, spread: 0.3 });
      }
    }
    this.fx.update(dt, viewportH);
  }
}
