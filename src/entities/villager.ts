/**
 * Villagers: the same chibi proportions as the farmer, dressed from NpcLook (hair style,
 * apron, glasses, beard, scarf). Walks between schedule waypoints, idles with breathing,
 * weight shift, blinks and look-arounds; turns to face the player and gestures while talking.
 * One shared vertex-coloured material; rig parts are separate meshes only where they move.
 */
import * as THREE from 'three';
import type { Facing } from '../core/events';
import type { NpcDef, NpcLook } from '../data/npcs';
import { MeshBuilder, roundedBox, mat, lumpySphere, sphericalNormals } from '../world/geom';
import { applyWorldFx } from '../render/worldfx';
import { Rng } from '../core/rng';

let shared: THREE.MeshStandardMaterial | null = null;
function sharedMat(): THREE.MeshStandardMaterial {
  if (!shared) {
    shared = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74 });
    shared.name = 'villager';
    applyWorldFx(shared, { snow: false, clouds: true, wet: true });
  }
  return shared;
}

type Add = (g: THREE.BufferGeometry, m: THREE.Matrix4 | undefined, color: number) => void;
function part(name: string, fn: (add: Add) => void, shadow = true): THREE.Group {
  const b = new MeshBuilder();
  fn((g, m, color) => b.add(sharedMat(), g, m, { tint: color }));
  const grp = b.build({ name, castShadow: shadow, receiveShadow: true });
  return grp;
}

const FACING_YAW: Record<Facing, number> = { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };

export class Villager {
  readonly root = new THREE.Group();
  readonly position = new THREE.Vector3();
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private eyes: THREE.Object3D[] = [];
  private yaw = 0;
  private targetYaw = 0;
  private target: THREE.Vector3 | null = null;
  private arriveFacing: Facing = 'down';
  private phase = 0;
  private t = Math.random() * 10;
  private blinkT = 0;
  private nextBlink = 1 + Math.random() * 3;
  private lookT = 2 + Math.random() * 3;
  private look = 0;
  private lookTarget = 0;
  private moving = false;
  /** World point to face while talking (null = not talking). */
  talkTo: THREE.Vector3 | null = null;
  private talkT = 0;
  readonly speed = 1.55;

  constructor(readonly def: NpcDef) {
    this.root.name = `npc:${def.id}`;
    this.build(def.look);
    const S = 1.22 * def.look.scale;
    this.body.scale.setScalar(S);
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.42 * def.look.build, 20), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.2, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    blob.renderOrder = 1;
    blob.userData.noAO = true;
    this.root.add(blob);
  }

  private build(L: NpcLook): void {
    const rng = new Rng(`npc:${this.def.id}`);
    const bw = L.build;
    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = 0.5;
    for (const [leg, sx] of [[this.legL, -1], [this.legR, 1]] as const) {
      leg.position.set(sx * 0.12 * bw, 0, 0);
      leg.add(
        part('npc-leg', (add) => {
          add(new THREE.CapsuleGeometry(0.095, 0.22, 4, 10), mat(0, -0.19, 0), L.bottom);
          add(roundedBox(0.19, 0.14, 0.26, 0.06), mat(0, -0.43, 0.035), 0x5a3a24);
          add(roundedBox(0.2, 0.04, 0.28, 0.02), mat(0, -0.49, 0.04), 0x3a2618);
        }),
      );
      this.hips.add(leg);
    }
    this.hips.add(this.torso);
    this.torso.add(
      part('npc-torso', (add) => {
        add(new THREE.CapsuleGeometry(0.2, 0.18, 6, 14), mat(0, 0.18, 0, 0, 0, 0, 1.05 * bw, 1, 0.92 * bw), L.top);
        add(new THREE.CylinderGeometry(0.215 * bw, 0.205 * bw, 0.18, 14), mat(0, 0.0, 0), L.bottom);
        if (L.apron !== undefined) {
          add(roundedBox(0.34 * bw, 0.42, 0.04, 0.03), mat(0, 0.04, 0.19 * bw), L.apron);
          add(roundedBox(0.2, 0.1, 0.03, 0.02), mat(0, -0.02, 0.215 * bw), new THREE.Color(L.apron).multiplyScalar(0.85).getHex());
          add(new THREE.TorusGeometry(0.21 * bw, 0.015, 5, 16), mat(0, 0.08, 0, Math.PI / 2, 0, 0, 1, 0.9, 1), new THREE.Color(L.apron).multiplyScalar(0.8).getHex());
        }
        if (L.scarf !== undefined) {
          add(new THREE.TorusGeometry(0.13, 0.04, 8, 16), mat(0, 0.38, 0, Math.PI / 2 - 0.2, 0, 0), L.scarf);
          add(roundedBox(0.08, 0.22, 0.04, 0.02), mat(0.06, 0.25, 0.17, 0.15, 0, 0.15), L.scarf);
        }
        for (let i = 0; i < 3; i++) add(new THREE.SphereGeometry(0.018, 6, 4), mat(0, 0.32 - i * 0.08, 0.2 * bw), 0xf0e0c0);
      }),
    );
    for (const [arm, sx] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(sx * 0.25 * bw, 0.32, 0);
      arm.add(
        part(
          'npc-arm',
          (add) => {
            add(new THREE.CapsuleGeometry(0.075, 0.08, 4, 10), mat(0, -0.06, 0), L.top);
            add(new THREE.CapsuleGeometry(0.058, 0.12, 4, 10), mat(0, -0.2, 0), L.top);
            add(new THREE.SphereGeometry(0.07, 12, 10), mat(0, -0.31, 0), L.skin);
          },
          false,
        ),
      );
      this.torso.add(arm);
    }
    // Head
    this.head.position.y = 0.46;
    this.head.scale.setScalar(1.15);
    this.torso.add(this.head);
    const R = 0.32;
    this.head.add(
      part('npc-head', (add) => {
        add(new THREE.SphereGeometry(R, 24, 18), mat(0, R * 0.92, 0, 0, 0, 0, 1.04, 0.96, 1), L.skin);
        for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.07, 10, 8), mat(sx * R * 0.98, R * 0.88, 0, 0, 0, 0, 0.6, 1, 1), L.skin);
        add(new THREE.SphereGeometry(0.03, 10, 8), mat(0, R * 0.78, R * 0.99), new THREE.Color(L.skin).multiplyScalar(1.05).getHex());
        // Brows, blush, smile
        for (const sx of [-1, 1]) {
          add(new THREE.CapsuleGeometry(0.012, 0.05, 3, 6), mat(sx * 0.115, R * 1.2, R * 0.93, 0, 0, Math.PI / 2 + sx * 0.14), new THREE.Color(L.hair).multiplyScalar(0.8).getHex());
          add(new THREE.CircleGeometry(0.052, 14), mat(sx * 0.19, R * 0.74, R * 0.875, 0, sx * 0.55, 0), 0xf29a86);
        }
        add(new THREE.TorusGeometry(0.036, 0.009, 6, 12, Math.PI), mat(0, R * 0.64, R * 0.96, 0, 0, Math.PI), 0x3a1a14);
        if (L.glasses) {
          for (const sx of [-1, 1]) add(new THREE.TorusGeometry(0.068, 0.011, 6, 18), mat(sx * 0.115, R * 0.97, R * 1.0), 0x6a4a2a);
          add(roundedBox(0.07, 0.014, 0.014, 0.005, 1), mat(0, R * 1.0, R * 1.02), 0x6a4a2a);
        }
        if (L.beard) {
          const beard = lumpySphere(0.2, 1, 0.18, rng, 2);
          beard.scale(1.35, 0.9, 0.7);
          add(beard, mat(0, R * 0.5, R * 0.62), L.hair);
          const stache = new THREE.CapsuleGeometry(0.035, 0.12, 3, 8);
          stache.rotateZ(Math.PI / 2);
          add(stache, mat(0, R * 0.73, R * 0.95), new THREE.Color(L.hair).multiplyScalar(0.9).getHex());
        }
        // Hair
        const cap = new THREE.SphereGeometry(R * 1.07, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55);
        add(cap, mat(0, R * 0.98, -0.02, -0.25, 0, 0), L.hair);
        if (L.hairStyle === 'bun') {
          add(lumpySphere(0.17, 1, 0.12, rng, 2), mat(0, R * 1.85, -R * 0.35), L.hair);
          for (const sx of [-1, 1]) add(lumpySphere(0.12, 1, 0.1, rng), mat(sx * R * 0.86, R * 1.0, R * 0.2, 0, 0, 0, 0.6, 1.1, 0.9), L.hair);
          add(lumpySphere(0.2, 1, 0.1, rng, 1.4), mat(0, R * 1.42, R * 0.55, 0.5, 0, 0, 1.6, 0.5, 0.7), L.hair);
        } else if (L.hairStyle === 'bob') {
          for (let i = 0; i < 9; i++) {
            const a = Math.PI * 0.35 + (i / 8) * Math.PI * 1.3;
            const tuft = lumpySphere(0.15, 1, 0.15, rng);
            add(tuft, mat(Math.sin(a) * R * 0.92, R * 0.62 + (i % 2) * 0.04, Math.cos(a) * R * 0.88), L.hair);
          }
          for (const [a, len] of [[-0.45, 1.3], [0.1, 1.15], [0.55, 1.0]] as const) {
            const lock = lumpySphere(0.15, 1, 0.08, rng, 1.2);
            lock.scale(len, 0.5, 0.6);
            sphericalNormals(lock, new THREE.Vector3(), 0.35);
            add(lock, mat(Math.sin(a) * R * 0.72, R * 1.36, Math.cos(a) * R * 0.72, 0.6, a, 0), L.hair);
          }
        } else if (L.hairStyle === 'cap') {
          // Baker's cap: soft puffy top + band
          add(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.12, 20, 1, true), mat(0, R * 1.55, -0.02, -0.12, 0, 0), 0xf6f0e4);
          const puff = lumpySphere(R * 1.05, 1, 0.12, rng, 1.6);
          puff.scale(1.1, 0.55, 1.1);
          add(puff, mat(0, R * 1.78, -0.05, -0.15, 0, 0), 0xfaf6ee);
          for (const sx of [-1, 1]) add(lumpySphere(0.1, 1, 0.12, rng), mat(sx * R * 0.9, R * 0.95, R * 0.1, 0, 0, 0, 0.6, 1, 0.9), L.hair);
        } else {
          for (let i = 0; i < 6; i++) {
            const a = -0.9 + i * 0.36;
            add(lumpySphere(0.13, 1, 0.18, rng), mat(Math.sin(a) * R * 0.8, R * 1.35, Math.cos(a) * R * 0.75), L.hair);
          }
        }
      }),
    );
    for (const sx of [-1, 1]) {
      const eye = new THREE.Group();
      eye.add(
        part(
          'npc-eye',
          (add) => {
            add(new THREE.CapsuleGeometry(0.036, 0.046, 4, 10), undefined, 0x1d1612);
            add(new THREE.SphereGeometry(0.014, 8, 6), mat(0.013, 0.024, 0.03), 0xffffff);
          },
          false,
        ),
      );
      eye.position.set(sx * 0.115, R * 0.95, R * 0.9);
      eye.rotation.x = -0.12;
      this.head.add(eye);
      this.eyes.push(eye);
    }
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.userData.noAO = true;
    });
  }

  setPosition(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.root.position.copy(this.position);
  }

  setFacing(f: Facing): void {
    this.targetYaw = FACING_YAW[f];
    this.yaw = this.targetYaw;
  }

  setYaw(yaw: number): void {
    this.yaw = this.targetYaw = yaw;
  }

  walkTo(x: number, z: number, facing: Facing): void {
    this.target = new THREE.Vector3(x, 0, z);
    this.arriveFacing = facing;
  }

  get isMoving(): boolean {
    return this.moving;
  }

  update(dt: number, heightAt: (x: number, z: number) => number, simulate: boolean): void {
    this.t += dt;
    this.moving = false;
    if (simulate && this.target && !this.talkTo) {
      const dx = this.target.x - this.position.x;
      const dz = this.target.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const step = Math.min(d, this.speed * dt);
        this.position.x += (dx / d) * step;
        this.position.z += (dz / d) * step;
        this.targetYaw = Math.atan2(dx, dz);
        this.moving = true;
      } else {
        this.target = null;
        this.targetYaw = FACING_YAW[this.arriveFacing];
      }
    }
    this.position.y = heightAt(this.position.x, this.position.z);
    if (this.talkTo) {
      this.targetYaw = Math.atan2(this.talkTo.x - this.position.x, this.talkTo.z - this.position.z);
      this.talkT += dt;
    } else this.talkT = 0;
    let dy = this.targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * (1 - Math.exp(-10 * dt));
    this.root.position.copy(this.position);
    this.body.rotation.y = this.yaw;

    const Ls = this.legL.rotation;
    const Rs = this.legR.rotation;
    const AL = this.armL.rotation;
    const AR = this.armR.rotation;
    Ls.set(0, 0, 0);
    Rs.set(0, 0, 0);
    AL.set(0, 0, 0.14);
    AR.set(0, 0, -0.14);
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    let bob = 0;
    let sy = 1;
    if (this.moving) {
      this.phase += dt * this.speed * 2.7;
      const s = Math.sin(this.phase);
      const c = Math.cos(this.phase);
      Ls.x = s * 0.6;
      Rs.x = -s * 0.6;
      AL.x = -s * 0.5;
      AR.x = s * 0.5;
      bob = Math.abs(c) * 0.05;
      sy = 1 + (Math.abs(c) - 0.5) * 0.05;
      this.torso.rotation.y = s * 0.07;
    } else {
      const br = Math.sin(this.t * 2.0);
      sy = 1 + br * 0.018;
      const shift = Math.sin(this.t * 0.5);
      this.hips.rotation.z = shift * 0.03;
      this.torso.rotation.z = -shift * 0.04;
      if (this.talkTo) {
        // Talking: little nods and an expressive hand.
        this.head.rotation.x = Math.sin(this.talkT * 6) * 0.06;
        this.head.rotation.z = Math.sin(this.talkT * 2.3) * 0.05;
        AR.x = -0.9 + Math.sin(this.talkT * 3.1) * 0.25;
        AR.z = -0.35;
      } else {
        this.lookT -= dt;
        if (this.lookT <= 0) {
          this.lookTarget = this.lookTarget !== 0 ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.4);
          this.lookT = this.lookTarget !== 0 ? 1.2 + Math.random() : 3 + Math.random() * 4;
        }
        this.look += (this.lookTarget - this.look) * (1 - Math.exp(-dt * 4));
        this.head.rotation.y = this.look;
        this.head.rotation.x = Math.sin(this.t * 0.8) * 0.02;
      }
      AL.z = 0.14 + br * 0.03;
    }
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blinkT = 0.13;
      this.nextBlink = 2.5 + Math.random() * 3;
    }
    this.blinkT -= dt;
    for (const e of this.eyes) e.scale.y = this.blinkT > 0 ? 0.15 : 1;
    this.body.position.y = bob;
    const S = 1.22 * this.def.look.scale;
    this.body.scale.set(S / Math.sqrt(sy), S * sy, S / Math.sqrt(sy));
  }
}
