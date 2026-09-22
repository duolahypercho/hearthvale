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

const SKIN = 0xf2c29b;
const HAIR = 0x6b3f26;
const SHIRT = 0xe8674a;
const OVERALLS = 0x3f6fa8;
const BOOTS = 0x6a4128;
const HAT = 0xe6c275;
const HATBAND = 0xc2463a;

function toonish(color: number, rough = 0.75): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, vertexColors: true });
  applyWorldFx(m, { snow: false, clouds: true, wet: true });
  return m;
}

function part(builder: (b: MeshBuilder) => void, name: string): THREE.Group {
  const b = new MeshBuilder();
  builder(b);
  const g = b.build({ name, castShadow: true, receiveShadow: true });
  return g;
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
  private tool = new THREE.Group();
  private shadowBlob: THREE.Mesh;

  constructor(private game: Game) {
    this.root.name = 'player';
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
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d1612, roughness: 0.3 });
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const blush = new THREE.MeshBasicMaterial({ color: 0xff7f7f, transparent: true, opacity: 0.45, depthWrite: false });
    const metal = toonish(0xb7bcc2, 0.35);
    const handle = toonish(0xa0703f, 0.7);

    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = 0.5;

    // Legs (pivot at hip)
    for (const [leg, sx] of [[this.legL, -1], [this.legR, 1]] as const) {
      leg.position.set(sx * 0.12, 0, 0);
      leg.add(
        part((b) => {
          b.add(denim, new THREE.CapsuleGeometry(0.095, 0.22, 4, 10), mat(0, -0.19, 0));
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
        b.add(denim, roundedBox(0.1, 0.07, 0.03, 0.01), mat(0, 0.16, 0.205), { tint: 0x355f92 });
      }, 'torso'),
    );

    // Arms (pivot at shoulder)
    for (const [arm, sx] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(sx * 0.25, 0.33, 0);
      arm.add(
        part((b) => {
          b.add(shirt, new THREE.CapsuleGeometry(0.075, 0.08, 4, 10), mat(0, -0.06, 0));
          b.add(skin, new THREE.CapsuleGeometry(0.058, 0.12, 4, 10), mat(0, -0.2, 0));
          b.add(skin, new THREE.SphereGeometry(0.075, 12, 10), mat(0, -0.3, 0));
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
    this.torso.add(this.head);
    const headR = 0.32;
    this.head.add(
      part((b) => {
        b.add(skin, new THREE.SphereGeometry(headR, 28, 20), mat(0, headR * 0.92, 0, 0, 0, 0, 1.04, 0.96, 1));
        for (const sx of [-1, 1]) b.add(skin, new THREE.SphereGeometry(0.07, 10, 8), mat(sx * headR * 0.98, headR * 0.88, 0, 0, 0, 0, 0.6, 1, 1));
        b.add(skin, new THREE.SphereGeometry(0.04, 10, 8), mat(0, headR * 0.78, headR * 0.98), { tint: 0xf0b088 });
        // Hair: cap + tufted fringe + back volume
        const cap = new THREE.SphereGeometry(headR * 1.07, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
        b.add(hair, cap, mat(0, headR * 0.98, -0.02, -0.25, 0, 0));
        for (let i = 0; i < 7; i++) {
          const a = -0.9 + (i / 6) * 1.8;
          const tuft = lumpySphere(0.1, 1, 0.25, rng);
          tuft.scale(1, 0.75, 0.8);
          sphericalNormals(tuft, new THREE.Vector3(), 0.4);
          b.add(hair, tuft, mat(Math.sin(a) * headR * 0.9, headR * 1.38 - Math.abs(a) * 0.06, Math.cos(a) * headR * 0.78, 0.4, 0, 0));
        }
        for (let i = 0; i < 6; i++) {
          const a = Math.PI * 0.55 + (i / 5) * Math.PI * 0.9;
          const tuft = lumpySphere(0.13, 1, 0.2, rng);
          b.add(hair, tuft, mat(Math.sin(a) * headR * 0.85, headR * 0.72 + rng.next() * 0.08, Math.cos(a) * headR * 0.82));
        }
      }, 'head'),
    );
    // Eyes (separate so they can blink), blush, mouth
    for (const sx of [-1, 1]) {
      const eye = new THREE.Group();
      const e = new THREE.Mesh(new THREE.CapsuleGeometry(0.033, 0.045, 4, 10), dark);
      eye.add(e);
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), white);
      hl.position.set(0.012, 0.022, 0.028);
      eye.add(hl);
      eye.position.set(sx * 0.115, headR * 0.98, headR * 0.9);
      eye.rotation.x = -0.12;
      this.head.add(eye);
      this.eyes.push(eye);
      const bl = new THREE.Mesh(new THREE.CircleGeometry(0.055, 16), blush);
      bl.position.set(sx * 0.19, headR * 0.76, headR * 0.86);
      bl.rotation.y = sx * 0.55;
      this.head.add(bl);
    }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 12, Math.PI), dark);
    mouth.position.set(0, headR * 0.66, headR * 0.96);
    mouth.rotation.z = Math.PI;
    this.head.add(mouth);

    // Straw hat
    this.hat.position.set(0, headR * 1.52, -0.02);
    this.hat.rotation.x = -0.12;
    this.head.add(this.hat);
    this.hat.add(
      part((b) => {
        const brim = new THREE.CylinderGeometry(0.5, 0.52, 0.035, 32);
        b.add(straw, brim, mat(0, 0, 0));
        b.add(straw, new THREE.TorusGeometry(0.5, 0.025, 6, 32), mat(0, 0.0, 0, Math.PI / 2, 0, 0));
        b.add(straw, new THREE.CylinderGeometry(0.24, 0.3, 0.2, 24), mat(0, 0.11, 0));
        b.add(straw, new THREE.SphereGeometry(0.24, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0, 0.2, 0, 0, 0, 0, 1, 0.35, 1));
        b.add(band, new THREE.CylinderGeometry(0.305, 0.305, 0.065, 24, 1, true), mat(0, 0.05, 0));
      }, 'hat'),
    );

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    blush.depthWrite = false;
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
    const canMove = this.controllable && this.swingT < 0;
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
      this.head.rotation.z = Math.sin(t * 0.7) * 0.03;
      this.head.rotation.x = Math.sin(t * 0.9) * 0.02;
      AL.z = 0.12 + br * 0.03;
      AR.z = -0.12 - br * 0.03;
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
      this.nextBlink = 2 + Math.random() * 3;
    }
    const eyeY = this.blink > 0 ? 0.15 : 1;
    for (const e of this.eyes) e.scale.y = eyeY;

    this.body.position.y = bob;
    const S = 1.22;
    this.body.scale.set(S / Math.sqrt(sy), S * sy, S / Math.sqrt(sy));
    this.hat.position.y = 0.32 * 1.52 + (this.state === 'walk' ? Math.abs(Math.cos(this.phase)) * 0.015 : 0);
    this.shadowBlob.scale.setScalar(1 - bob * 1.5);
    this.shadowBlob.position.y = 0.03;
  }
}
