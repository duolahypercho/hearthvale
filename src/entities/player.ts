/**
 * The farmer: a procedural chibi built from grouped meshes (a light hierarchical rig).
 * Animations: idle (breathing, blinking, hat bob), walk/run (leg/arm swing, bob, squash &
 * stretch on footfalls, lean), tool swing (anticipation → strike → follow-through).
 * Movement is camera-relative with tile-grid collision (circle vs blocked tiles).
 */
import * as THREE from 'three';
import type { Game } from '../core/game';
import type { Facing } from '../core/events';
import { MeshBuilder, roundedBox, mat, lumpySphere, sphericalNormals } from '../world/geom';
import { applyWorldFx } from '../render/worldfx';
import { globalUniforms } from '../render/uniforms';
import { Rng } from '../core/rng';

type AnimState = 'idle' | 'walk' | 'swing';

/** Rig groups exposed to action-pose drivers (tool feel: systems/farming → entities/farmer-actions). */
export interface PlayerRig {
  body: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  /** Hand prop socket on the right arm (swap its children for the held tool). */
  tool: THREE.Group;
  /** The straw hat (tool actions shrink it so it never hides the swing). */
  hat?: THREE.Group;
}

/** Returned by an action-pose driver: overrides for the body squash / bob this frame. */
export interface ActionPose {
  sy?: number;
  bob?: number;
}

// Original palette: oatmeal shirt, sage overalls, terracotta neckerchief, slate hat band.
const SKIN = 0xecb48e;
const HAIR = 0x8a4a2a;
const SHIRT = 0xf0e4c8;
const OVERALLS = 0x5f8a5c;
const BOOTS = 0x6a4128;
const HAT = 0xe6c275;
const HATBAND = 0x3d6f8f;
const SCARF = 0xe07a5f;

function toonish(color: number, rough = 0.75): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, vertexColors: true });
  applyWorldFx(m, { snow: false, clouds: true, wet: true });
  return m;
}

// Every rig part renders with ONE shared vertex-coloured material: the per-part "materials"
// below are just colour carriers, folded into vertex tints (1 draw call per rig part).
let shared: THREE.MeshStandardMaterial | null = null;
function sharedMat(): THREE.MeshStandardMaterial {
  if (!shared) {
    shared = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 });
    shared.name = 'player';
    applyWorldFx(shared, { snow: false, clouds: true, wet: true });
  }
  return shared;
}

function part(builder: (b: MeshBuilder) => void, name: string): THREE.Group {
  const b = new MeshBuilder();
  const proxy = {
    add(m: THREE.Material, g: THREE.BufferGeometry, mtx?: THREE.Matrix4, opts: { tint?: THREE.ColorRepresentation; ao?: (p: THREE.Vector3, n: THREE.Vector3) => number } = {}) {
      const c = ((m as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1)).clone();
      if (opts.tint !== undefined) c.multiply(new THREE.Color(opts.tint));
      b.add(sharedMat(), g, mtx, { ...opts, tint: c });
      return proxy;
    },
  };
  builder(proxy as unknown as MeshBuilder);
  return b.build({ name, castShadow: true, receiveShadow: true });
}

export class Player {
  readonly root = new THREE.Group();
  readonly position = new THREE.Vector3();
  facing: Facing = 'down';
  /** Radians; 0 = facing +Z (towards camera). */
  private yaw = 0;
  private targetYaw = 0;
  private velocity = new THREE.Vector3();
  speed = 4.2;
  runSpeed = 6.4;
  readonly radius = 0.3;
  private state: AnimState = 'idle';
  private phase = 0;
  private stateTime = 0;
  private blink = 0;
  private nextBlink = 2;
  private swingT = -1;
  private lastTile = { x: -999, z: -999 };
  /** When false, input is ignored (cutscenes, menus). */
  controllable = true;
  /** Movement locked by a tool action (anticipation → impact → recovery). */
  busy = false;
  /**
   * Tool-feel hook: while it returns a pose it owns the arms / torso / held tool (the built-in
   * swing is cancelled). Installed by the farming system.
   */
  actionPose: ((rig: PlayerRig, dt: number) => ActionPose | null) | null = null;

  // Rig
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private hat = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private eyes: THREE.Object3D[] = [];
  private lookT = 4;
  private lookYaw = 0;
  private lookTarget = 0;
  private tool = new THREE.Group();
  private shadowBlob: THREE.Mesh;

  constructor(private game: Game) {
    this.root.name = 'player';
    // Skip the GTAO normal pass (11 small parts); the contact shadow blob grounds the farmer.
    this.root.userData.noAO = true;
    this.buildRig();
    this.body.scale.setScalar(1.22);
    const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
    this.shadowBlob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), blobMat);
    this.shadowBlob.rotation.x = -Math.PI / 2;
    this.shadowBlob.renderOrder = 1;
    this.root.add(this.shadowBlob);
  }

  private buildRig(): void {
    const rng = new Rng('player');
    const skin = toonish(SKIN, 0.6);
    const hair = toonish(HAIR, 0.55);
    const shirt = toonish(SHIRT, 0.85);
    const denim = toonish(OVERALLS, 0.9);
    const boot = toonish(BOOTS, 0.6);
    const straw = toonish(HAT, 0.9);
    const band = toonish(HATBAND, 0.7);
    const dark = toonish(0x1d1612, 0.3);
    const white = toonish(0xffffff, 0.3);
    const blush = toonish(0xf5a38c, 0.6);
    const metal = toonish(0xb7bcc2, 0.35);
    const handle = toonish(0xa0703f, 0.7);
    const scarf = toonish(SCARF, 0.85);

    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = 0.5;

    // Legs (pivot at hip)
    for (const [leg, sx] of [[this.legL, -1], [this.legR, 1]] as const) {
      leg.position.set(sx * 0.12, 0, 0);
      leg.add(
        part((b) => {
          b.add(denim, new THREE.CapsuleGeometry(0.095, 0.22, 4, 10), mat(0, -0.19, 0));
          if (sx > 0) b.add(denim, roundedBox(0.09, 0.08, 0.02, 0.015), mat(0, -0.2, 0.09, 0.1, 0, 0.1), { tint: 0x8fb88a });
          b.add(shirt, new THREE.CylinderGeometry(0.1, 0.1, 0.05, 12), mat(0, -0.34, 0), { tint: 0xd8cfb8 });
          b.add(boot, roundedBox(0.19, 0.14, 0.27, 0.06), mat(0, -0.43, 0.035));
          b.add(boot, roundedBox(0.2, 0.04, 0.29, 0.02), mat(0, -0.49, 0.04), { tint: 0x3a2618 });
        }, 'leg'),
      );
      this.hips.add(leg);
    }

    // Torso: shirt + overalls bib
    this.hips.add(this.torso);
    this.torso.add(
      part((b) => {
        b.add(shirt, new THREE.CapsuleGeometry(0.2, 0.16, 6, 14), mat(0, 0.19, 0, 0, 0, 0, 1.05, 1, 0.9));
        b.add(denim, new THREE.CylinderGeometry(0.215, 0.2, 0.2, 14), mat(0, 0.02, 0, 0, 0, 0, 1.05, 1, 0.92));
        b.add(denim, roundedBox(0.26, 0.2, 0.08, 0.03), mat(0, 0.2, 0.16));
        for (const sx of [-1, 1]) {
          b.add(denim, roundedBox(0.05, 0.26, 0.05, 0.02), mat(sx * 0.1, 0.33, 0.1, 0.35, 0, 0));
          b.add(metal, new THREE.SphereGeometry(0.022, 8, 6), mat(sx * 0.1, 0.28, 0.2), { tint: 0xe0c060 });
        }
        b.add(denim, roundedBox(0.1, 0.07, 0.03, 0.01), mat(0, 0.16, 0.205), { tint: 0x4a7248 });
        // Stitching around the bib pocket + a sewn-on patch.
        for (let i = 0; i < 5; i++) b.add(denim, roundedBox(0.016, 0.006, 0.006, 0.002), mat(-0.04 + i * 0.02, 0.2, 0.222), { tint: 0xf2d890 });
        for (const sx2 of [-1, 1]) for (let i = 0; i < 3; i++) b.add(denim, roundedBox(0.006, 0.016, 0.006, 0.002), mat(sx2 * 0.052, 0.13 + i * 0.022, 0.222), { tint: 0xf2d890 });
        b.add(denim, roundedBox(0.08, 0.07, 0.02, 0.012), mat(-0.12, 0.02, 0.19, 0, 0.4, 0.2), { tint: 0xd89a4a });
        // Neckerchief knot + tail
        b.add(scarf, new THREE.TorusGeometry(0.13, 0.035, 8, 18), mat(0, 0.38, 0.0, Math.PI / 2 - 0.25, 0, 0));
        b.add(scarf, new THREE.ConeGeometry(0.07, 0.12, 4), mat(0, 0.3, 0.14, 0.2, Math.PI / 4, Math.PI));
      }, 'torso'),
    );

    // Arms (pivot at shoulder)
    for (const [arm, sx] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(sx * 0.25, 0.33, 0);
      arm.add(
        part((b) => {
          b.add(shirt, new THREE.CapsuleGeometry(0.075, 0.08, 4, 10), mat(0, -0.06, 0));
          b.add(skin, new THREE.CapsuleGeometry(0.058, 0.12, 4, 10), mat(0, -0.2, 0));
          b.add(skin, new THREE.SphereGeometry(0.07, 14, 10), mat(0, -0.3, 0.01), { tint: 0xf4d0b8 });
        }, 'arm'),
      );
      this.torso.add(arm);
    }

    // Tool in right hand (hoe), shown during swings.
    this.tool.add(
      part((b) => {
        b.add(handle, new THREE.CylinderGeometry(0.025, 0.028, 0.95, 8), mat(0, 0.2, 0));
        b.add(metal, roundedBox(0.2, 0.05, 0.16, 0.02), mat(0, 0.66, 0.07, 0.25, 0, 0));
      }, 'tool'),
    );
    this.tool.position.set(0, -0.3, 0.02);
    this.tool.rotation.x = Math.PI / 2;
    this.tool.visible = false;
    this.armR.add(this.tool);

    // Head (pivot at neck)
    this.head.position.y = 0.46;
    this.head.scale.setScalar(1.15);
    this.torso.add(this.head);
    const headR = 0.32;
    this.head.add(
      part((b) => {
        b.add(skin, new THREE.SphereGeometry(headR, 28, 20), mat(0, headR * 0.92, 0, 0, 0, 0, 1.04, 0.96, 1));
        for (const sx of [-1, 1]) b.add(skin, new THREE.SphereGeometry(0.07, 10, 8), mat(sx * headR * 0.98, headR * 0.88, 0, 0, 0, 0, 0.6, 1, 1));
        b.add(skin, new THREE.SphereGeometry(0.03, 10, 8), mat(0, headR * 0.8, headR * 0.99), { tint: 0xfff0e8 });
        // Hair: cap + tufted fringe + back volume
        const cap = new THREE.SphereGeometry(headR * 1.07, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
        b.add(hair, cap, mat(0, headR * 0.98, -0.02, -0.25, 0, 0));
        // Swept side fringe: three soft overlapping locks, longest over one eye.
        const locks: [number, number, number, number][] = [
          [-0.55, 0.16, 1.25, -0.5],
          [-0.1, 0.14, 1.12, -0.25],
          [0.4, 0.12, 1.02, 0.1],
        ];
        for (const [a, r, len, roll] of locks) {
          const lock = lumpySphere(r, 2, 0.08, rng, 1.2);
          lock.scale(len, 0.55, 0.62);
          sphericalNormals(lock, new THREE.Vector3(), 0.35);
          b.add(hair, lock, mat(Math.sin(a) * headR * 0.72, headR * 1.34, Math.cos(a) * headR * 0.72, 0.55, a, roll));
        }
        for (const sx of [-1, 1]) {
          const side = lumpySphere(0.1, 1, 0.12, rng);
          side.scale(0.55, 1.1, 0.8);
          b.add(hair, side, mat(sx * headR * 0.94, headR * 0.95, headR * 0.28, 0, 0, sx * 0.15));
        }
        for (let i = 0; i < 6; i++) {
          const a = Math.PI * 0.55 + (i / 5) * Math.PI * 0.9;
          const tuft = lumpySphere(0.13, 1, 0.2, rng);
          b.add(hair, tuft, mat(Math.sin(a) * headR * 0.85, headR * 0.72 + rng.next() * 0.08, Math.cos(a) * headR * 0.82));
        }
        // Brows, blush, smile (merged into the head: one draw call).
        for (const sx of [-1, 1]) {
          b.add(hair, new THREE.CapsuleGeometry(0.013, 0.055, 3, 6), mat(sx * 0.12, headR * 1.14, headR * 0.94, 0, 0, Math.PI / 2 + sx * 0.18));
          b.add(blush, new THREE.CircleGeometry(0.05, 14), mat(sx * 0.19, headR * 0.76, headR * 0.875, 0, sx * 0.55, 0));
        }
        b.add(dark, new THREE.TorusGeometry(0.045, 0.011, 6, 14, Math.PI), mat(0, headR * 0.6, headR * 0.955, 0, 0, Math.PI));
      }, 'head'),
    );
    // Eyes (separate so they can blink); brows, mouth and blush are one static face part.
    for (const sx of [-1, 1]) {
      const eye = new THREE.Group();
      eye.add(
        part((b) => {
          // Big glossy eyes with a specular dot: readable at gameplay zoom.
          b.add(dark, new THREE.CapsuleGeometry(0.043, 0.05, 4, 12));
          b.add(white, new THREE.SphereGeometry(0.018, 8, 6), mat(0.016, 0.028, 0.036));
          b.add(white, new THREE.SphereGeometry(0.008, 6, 4), mat(-0.014, -0.022, 0.038));
        }, 'eye'),
      );
      eye.position.set(sx * 0.12, headR * 0.9, headR * 0.9);
      eye.rotation.x = -0.12;
      this.head.add(eye);
      this.eyes.push(eye);
    }

    // Straw hat
    // Worn pushed back so the face reads from the high camera.
    this.hat.position.set(0, headR * 1.55, -0.09);
    this.hat.rotation.x = -0.52;
    this.head.add(this.hat);
    this.hat.add(
      part((b) => {
        const brim = new THREE.CylinderGeometry(0.37, 0.39, 0.035, 32);
        b.add(straw, brim, mat(0, 0, 0));
        b.add(straw, new THREE.TorusGeometry(0.37, 0.025, 6, 32), mat(0, 0.0, 0, Math.PI / 2, 0, 0));
        b.add(straw, new THREE.CylinderGeometry(0.24, 0.3, 0.2, 24), mat(0, 0.11, 0));
        b.add(straw, new THREE.SphereGeometry(0.24, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0, 0.2, 0, 0, 0, 0, 1, 0.35, 1));
        b.add(band, new THREE.CylinderGeometry(0.305, 0.305, 0.065, 24, 1, true), mat(0, 0.05, 0));
      }, 'hat'),
    );

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        m.geometry.computeBoundingSphere();
        // Tiny face details don't need to cast shadows (saves shadow-pass draw calls).
        o.castShadow = (m.geometry.boundingSphere?.radius ?? 1) > 0.09;
        o.receiveShadow = true;
      }
    });
  }

  get rig(): PlayerRig {
    return { body: this.body, hips: this.hips, torso: this.torso, head: this.head, armL: this.armL, armR: this.armR, legL: this.legL, legR: this.legR, tool: this.tool, hat: this.hat };
  }

  /** Place at world coords (snaps height to ground). */
  teleport(x: number, z: number): void {
    this.position.set(x, this.game.world.heightAt(x, z), z);
    this.root.position.copy(this.position);
    this.velocity.set(0, 0, 0);
  }

  setFacing(f: Facing): void {
    this.facing = f;
    this.targetYaw = f === 'down' ? 0 : f === 'up' ? Math.PI : f === 'left' ? -Math.PI / 2 : Math.PI / 2;
    this.yaw = this.targetYaw;
    this.game.events.emit('player:facing', { facing: f });
  }

  /** Tile the player is facing (for tool use / interaction). */
  facingTile(): { x: number; z: number } {
    const tx = Math.floor(this.position.x);
    const tz = Math.floor(this.position.z);
    switch (this.facing) {
      case 'up':
        return { x: tx, z: tz - 1 };
      case 'down':
        return { x: tx, z: tz + 1 };
      case 'left':
        return { x: tx - 1, z: tz };
      case 'right':
        return { x: tx + 1, z: tz };
    }
  }

  swing(): void {
    if (this.swingT >= 0) return;
    this.swingT = 0;
    this.state = 'swing';
    this.tool.visible = true;
  }

  private blocked(x: number, z: number): boolean {
    const map = this.game.world.current;
    if (!map) return false;
    const g = map.grid;
    const r = this.radius;
    for (const [ox, oz] of [[-r, -r], [r, -r], [-r, r], [r, r], [0, 0]] as const) {
      const tx = Math.floor(x + ox);
      const tz = Math.floor(z + oz);
      if (!g.isWalkable(tx, tz)) return true;
    }
    return false;
  }

  fixedUpdate(dt: number): void {
    const input = this.game.input;
    const canMove = this.controllable && this.swingT < 0 && !this.busy;
    let mx = 0;
    let mz = 0;
    if (canMove) {
      const a = input.moveAxis();
      // Camera-relative: screen up = away from camera.
      const yaw = THREE.MathUtils.degToRad(this.game.rc.rig.yaw);
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      mx = a.x * c + a.y * s;
      mz = -a.x * s + a.y * c;
    }
    const running = input.held('run');
    const spd = running ? this.runSpeed : this.speed;
    const target = new THREE.Vector3(mx * spd, 0, mz * spd);
    const accel = target.lengthSq() > 0 ? 18 : 22;
    this.velocity.lerp(target, 1 - Math.exp(-accel * dt));
    const nx = this.position.x + this.velocity.x * dt;
    const nz = this.position.z + this.velocity.z * dt;
    if (!this.blocked(nx, this.position.z)) this.position.x = nx;
    else this.velocity.x = 0;
    if (!this.blocked(this.position.x, nz)) this.position.z = nz;
    else this.velocity.z = 0;
    this.position.y = this.game.world.heightAt(this.position.x, this.position.z);

    if (Math.hypot(mx, mz) > 0.1) {
      this.targetYaw = Math.atan2(mx, mz);
      const f: Facing = Math.abs(mx) > Math.abs(mz) ? (mx > 0 ? 'right' : 'left') : mz > 0 ? 'down' : 'up';
      if (f !== this.facing) {
        this.facing = f;
        this.game.events.emit('player:facing', { facing: f });
      }
    }

    if (canMove && input.pressed('use')) {
      const t = this.facingTile();
      this.swing();
      this.game.events.emit('player:use', { x: t.x, z: t.z, slot: this.game.toolbarSlot, itemId: null });
    }
    if (canMove && input.pressed('interact')) {
      const t = this.facingTile();
      this.game.events.emit('player:interact', { x: t.x, z: t.z });
    }

    const tx = Math.floor(this.position.x);
    const tz = Math.floor(this.position.z);
    if (tx !== this.lastTile.x || tz !== this.lastTile.z) {
      this.lastTile = { x: tx, z: tz };
      this.game.events.emit('player:tile', { map: this.game.world.current?.id ?? '', x: tx, z: tz });
    }
  }

  /** Visual animation, every frame. */
  update(dt: number): void {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.swingT < 0) this.state = speed > 0.4 ? 'walk' : 'idle';
    this.stateTime += dt;

    // Smooth turn
    let d = this.targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-14 * dt));
    this.root.position.copy(this.position);
    this.body.rotation.y = this.yaw;
    globalUniforms.uPlayerPos.value.copy(this.position);

    // Reset pose
    const L = this.legL.rotation;
    const R = this.legR.rotation;
    const AL = this.armL.rotation;
    const AR = this.armR.rotation;
    L.set(0, 0, 0);
    R.set(0, 0, 0);
    AL.set(0, 0, 0.12);
    AR.set(0, 0, -0.12);
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    let bob = 0;
    let sy = 1;

    if (this.state === 'walk') {
      const run = speed > this.speed * 1.15;
      this.phase += dt * speed * (run ? 2.3 : 2.6);
      const s = Math.sin(this.phase);
      const c = Math.cos(this.phase);
      const amp = run ? 0.85 : 0.65;
      L.x = s * amp;
      R.x = -s * amp;
      AL.x = -s * amp * 0.9;
      AR.x = s * amp * 0.9;
      bob = Math.abs(c) * (run ? 0.09 : 0.06);
      // Squash on footfall, stretch mid-stride.
      sy = 1 + (Math.abs(c) - 0.5) * (run ? 0.09 : 0.06);
      this.torso.rotation.x = run ? 0.16 : 0.07;
      this.torso.rotation.y = s * 0.08;
      this.head.rotation.x = -this.torso.rotation.x * 0.6;
      this.head.rotation.z = s * 0.03;
    } else if (this.state === 'idle') {
      const t = this.stateTime;
      const br = Math.sin(t * 2.2);
      sy = 1 + br * 0.018;
      // Slow weight shift from foot to foot + an occasional look around.
      const shift = Math.sin(t * 0.55);
      this.hips.rotation.z = shift * 0.035;
      this.hips.position.x = shift * 0.012;
      this.torso.rotation.z = -shift * 0.05;
      L.z = shift * 0.03;
      R.z = shift * 0.03;
      this.lookT -= dt;
      if (this.lookT <= 0) {
        this.lookTarget = this.lookTarget !== 0 ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.35);
        this.lookT = this.lookTarget !== 0 ? 1.2 + Math.random() : 3 + Math.random() * 3;
      }
      this.lookYaw += (this.lookTarget - this.lookYaw) * (1 - Math.exp(-dt * 5));
      this.head.rotation.y = this.lookYaw;
      this.head.rotation.z = Math.sin(t * 0.7) * 0.03 + this.lookYaw * 0.08;
      this.head.rotation.x = Math.sin(t * 0.9) * 0.02 - Math.abs(this.lookYaw) * 0.05;
      AL.z = 0.12 + br * 0.03;
      AR.z = -0.12 - br * 0.03;
    }
    if (this.state !== 'idle') {
      this.hips.rotation.z = 0;
      this.hips.position.x = 0;
      this.lookYaw = 0;
    }

    const ap = this.actionPose?.(this.rig, dt) ?? null;
    if (ap) {
      this.swingT = -1;
      if (this.state === 'swing') this.state = 'idle';
      if (ap.sy !== undefined) sy = ap.sy;
      if (ap.bob !== undefined) bob = ap.bob;
    }

    if (this.state === 'swing') {
      this.swingT += dt;
      const T = this.swingT / 0.5;
      const ease = (x: number) => 1 - Math.pow(1 - x, 3);
      let armX: number;
      if (T < 0.35) {
        // anticipation: raise tool back, crouch
        const k = ease(T / 0.35);
        armX = -2.6 * k;
        sy = 1 - 0.08 * k;
        this.torso.rotation.x = -0.15 * k;
      } else if (T < 0.55) {
        // strike: fast down, stretch
        const k = (T - 0.35) / 0.2;
        armX = -2.6 + 3.6 * k * k;
        sy = 0.92 + 0.14 * k;
        this.torso.rotation.x = -0.15 + 0.45 * k;
        if (k > 0.85 && this.swingT - dt < 0.5 * 0.55) this.game.rc.rig.addShake(0.25);
      } else {
        // follow-through + recover
        const k = ease((T - 0.55) / 0.45);
        armX = 1.0 * (1 - k);
        sy = 1.06 - 0.06 * k;
        this.torso.rotation.x = 0.3 * (1 - k);
      }
      AR.x = armX;
      AL.x = armX * 0.7;
      AR.z = -0.05;
      AL.z = 0.05;
      if (T >= 1) {
        this.swingT = -1;
        this.tool.visible = false;
        this.state = 'idle';
      }
    }

    // Blink
    this.blink -= dt;
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 0.13;
      this.nextBlink = 3 + Math.random() * 2;
    }
    const eyeY = this.blink > 0 ? 0.15 : 1;
    for (const e of this.eyes) e.scale.y = eyeY;

    this.body.position.y = bob;
    const S = 1.22;
    this.body.scale.set(S / Math.sqrt(sy), S * sy, S / Math.sqrt(sy));
    this.hat.position.y = 0.32 * 1.55 + (this.state === 'walk' ? Math.abs(Math.cos(this.phase)) * 0.015 : 0);
    this.shadowBlob.scale.setScalar(1 - bob * 1.5);
    this.shadowBlob.position.y = 0.03;
  }
}
