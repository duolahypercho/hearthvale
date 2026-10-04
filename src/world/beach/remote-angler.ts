/**
 * RemoteAngler — another co-op farmer's fishing, rendered from their FishNetSnap stream:
 * the rod (cocked while charging, whipping through the cast, bent under load), the catenary line,
 * the float (flight arc, bob, bite dunk, the fish dragging it about), splashes / ripples on state
 * changes, and the catch held up in both hands with a small sunburst.
 *
 * Snapshots arrive at ~10 Hz stamped with the sender's clock; like the farmers themselves
 * (net/players.ts) they are played back ~100 ms behind the freshest sample (clock offset = the
 * minimum observed one-way delay), positions interpolated, discrete state from the older sample.
 */
import * as THREE from 'three';
import { fishDef } from '../../data/fish';
import { FishingGear } from './tackle';

/** Wire order of FishingState (index = code). */
export const STATE_CODES = ['idle', 'charging', 'casting', 'waiting', 'bite', 'reeling', 'caught', 'escaped', 'reelin'] as const;
export type NetState = (typeof STATE_CODES)[number];

/**
 * [state, power, feet x, y, z, yaw, float x, y, z, fishId, catch arc 0..1, tension 0..1, length cm, map id]
 * (numbers rounded to 2 dp; ~70 bytes as JSON).
 */
export type FishNetSnap = [number, number, number, number, number, number, number, number, number, string, number, number, number, string];

export const INTERP_MS = 100;

interface Sample {
  t: number;
  s: FishNetSnap;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _side = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _bob = new THREE.Vector3();
const _feet = new THREE.Vector3();
const _hold = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

export class RemoteAngler {
  readonly gear = new FishingGear();
  private buf: Sample[] = [];
  private baseDelay = Infinity;
  private delays: { at: number; d: number }[] = [];
  /** Currently rendered state + seconds in it (local clock). */
  st: NetState = 'idle';
  private stT = 0;
  private held = '';
  /** The farmer's gripping fist (world), written by the pose hook; `fistOk` while it is fresh. */
  readonly fist = new THREE.Vector3();
  fistOk = false;
  /** Catch arc (0 → 1 as the fish flies to the hands) from the latest snapshot. */
  arc = 0;
  /** Screen anchor for the bite "!" (null when not biting / not visible). */
  readonly bang = { on: false, x: 0, y: 0 };
  /** Set once when a catch is shown (for a "X caught a Y" note). */
  caughtNote: string | null = null;
  /** World point the catch note pops from: above this farmer's head (not the float / the arc). */
  readonly noteAt = new THREE.Vector3();
  /** Last rendered feet position (co-op: a local cast steps along the rail to keep clear of it). */
  readonly feetPos = new THREE.Vector3();
  private lastBob = new THREE.Vector3();
  private wakeT = 0;
  map = '';
  stopped = false;
  private fade = 1;

  constructor(readonly id: number) {
    this.gear.group.name = `remote-angler-${id}`;
  }

  push(t: number, snap: FishNetSnap | null): void {
    const now = performance.now();
    if (!snap) {
      this.stopped = true;
      return;
    }
    this.stopped = false;
    this.fade = 1;
    const d = now - t;
    this.delays.push({ at: now, d });
    while (this.delays.length && now - this.delays[0]!.at > 3000) this.delays.shift();
    let m = Infinity;
    for (const w of this.delays) m = Math.min(m, w.d);
    this.baseDelay = m;
    const last = this.buf[this.buf.length - 1];
    if (last && t <= last.t) return;
    this.buf.push({ t, s: snap });
    if (this.buf.length > 30) this.buf.splice(0, this.buf.length - 30);
    this.map = snap[13];
  }

  get active(): boolean {
    return !this.stopped && this.st !== 'idle';
  }

  /** Per frame. `hereMap` = the map this machine shows (anglers elsewhere are hidden). */
  update(dt: number, time: number, camera: THREE.Camera, hereMap: string, screenH: number, project: (p: THREE.Vector3) => { x: number; y: number }): void {
    const g = this.gear;
    g.update(dt, time, screenH);
    this.bang.on = false;
    const b = this.buf;
    const show = b.length > 0 && this.map === hereMap;
    g.group.visible = show;
    if (!show) return;
    if (this.stopped) {
      this.fade -= dt * 3;
      if (this.fade <= 0) {
        this.hideAll(camera);
        return;
      }
    }
    // Sample ~100 ms behind.
    const rt = performance.now() - this.baseDelay - INTERP_MS;
    let a = b[0]!;
    let c = b[b.length - 1]!;
    let k = 0;
    if (rt <= a.t) c = a;
    else if (rt >= c.t) a = c;
    else {
      let i = 0;
      while (i < b.length - 2 && b[i + 1]!.t < rt) i++;
      a = b[i]!;
      c = b[i + 1]!;
      k = (rt - a.t) / Math.max(1, c.t - a.t);
    }
    const A = a.s;
    const C = c.s;
    const st = STATE_CODES[A[0]] ?? 'idle';
    if (st !== this.st) this.enter(st, A);
    this.stT += dt;
    const L = (i: number): number => (A[i] as number) + ((C[i] as number) - (A[i] as number)) * k;
    const feet = _feet.set(L(2), L(3), L(4));
    this.feetPos.copy(feet);
    let dy = (C[5] as number) - (A[5] as number);
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const yaw = (A[5] as number) + dy * k;
    const bob = _bob.set(L(6), L(7), L(8));
    const power = L(1);
    const arc = L(10);
    this.arc = arc;
    const tension = L(11);
    if (st === 'idle') {
      this.hideAll(camera);
      return;
    }
    const fwd = _fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    const side = _side.set(fwd.z, 0, -fwd.x);
    const t = time;
    // Right hand (estimated from the body; the remote farmer's arms follow its own 'fish' pose).
    const hand = _hand.copy(feet).addScaledVector(_UP, 1.02).addScaledVector(fwd, 0.34).addScaledVector(side, -0.2);
    let dir: THREE.Vector3;
    let bend = 0;
    if (st === 'charging') {
      dir = _dir.copy(fwd).multiplyScalar(-0.85).addScaledVector(_UP, 0.75 + power * 0.2);
      hand.addScaledVector(_UP, 0.35);
      bend = 0.08 + power * 0.1;
    } else if (st === 'casting' && this.stT < 0.22) {
      const e = 1 - Math.pow(1 - this.stT / 0.22, 3);
      dir = _dir.copy(fwd).multiplyScalar(THREE.MathUtils.lerp(-0.9, 1, e)).addScaledVector(_UP, THREE.MathUtils.lerp(0.8, 0.45, e));
      bend = Math.sin(e * Math.PI) * 0.45;
    } else if (st === 'reeling' || st === 'bite') {
      dir = _dir.copy(fwd).multiplyScalar(0.55).addScaledVector(_UP, 1.05);
      dir.x += Math.sin(t * 9) * 0.04;
      bend = st === 'reeling' ? 0.84 + 0.08 * Math.sin(t * 13) + tension * 0.1 : 0.9;
    } else dir = _dir.copy(fwd).addScaledVector(_UP, 0.62);
    dir.normalize();
    const holding = st === 'caught' && arc >= 1;
    g.setRodVisible(!holding);
    g.poseRod({ hand, dir, bend, bendTo: bob, crank: t * (st === 'reeling' ? 16 : st === 'reelin' ? 20 : 0) });
    // Float + line.
    const inAir = st === 'casting' && this.stT < 0.22;
    g.bobber.visible = st !== 'charging' && !inAir && !holding;
    g.lineVisible = g.bobber.visible;
    g.bobber.position.copy(bob);
    if (st === 'waiting') g.bobber.position.y += Math.sin(t * 2.4) * 0.012;
    if (st === 'reeling') g.bobber.rotation.set(Math.sin(t * 17) * 0.35, 0, Math.sin(t * 5) * 0.3);
    else g.bobber.rotation.set(Math.sin(t * 1.7) * 0.08, 0, Math.cos(t * 2.1) * 0.08);
    g.slack = st === 'reeling' || st === 'bite' ? 0.05 : st === 'casting' ? 0.4 : st === 'reelin' ? 0.3 : 1;
    g.ease = st === 'reeling' || st === 'bite' ? 0.45 : st === 'casting' ? 0.4 : st === 'reelin' ? 0.3 : 0.12;
    if (inAir) g.resetLine(g.tip);
    g.updateLine(Math.min(dt, 1 / 30), _a.copy(g.bobber.position).setY(g.bobber.position.y + 0.34), camera);
    if ((st === 'waiting' || st === 'reeling') && Math.random() < dt * (st === 'reeling' ? 3 : 0.35)) g.ripple(bob, st === 'reeling' ? 1.1 : 0.6, 1.3);
    if (st === 'reeling' && Math.random() < dt * 1.6) g.splash(bob, false);
    // The float runs with the fish (its position comes in the snapshot): trail a wake behind it.
    if (st === 'reeling') {
      const sp = this.lastBob.lengthSq() > 0 ? Math.hypot(bob.x - this.lastBob.x, bob.z - this.lastBob.z) / Math.max(dt, 1e-3) : 0;
      this.wakeT -= dt * Math.min(3, sp * 1.5);
      if (sp > 0.35 && this.wakeT <= 0) {
        this.wakeT = 0.05;
        g.fx.emit(_b.set(bob.x, g.waterY + 0.03, bob.z), { color: 0xf2fbff, count: 2, speed: 0.25, size: 0.055, gravity: 0, life: 0.9, up: 0.02, spread: 0.12 });
      }
      this.lastBob.copy(bob);
    } else this.lastBob.set(0, 0, 0);
    if (st === 'bite') {
      const s = project(_b.copy(feet).setY(feet.y + 2.3));
      this.bang.on = true;
      this.bang.x = s.x;
      this.bang.y = s.y;
      if (Math.random() < dt * 3) g.splash(bob, false);
    }
    // The catch: arcs out of the water into both hands, held up with a small sunburst.
    const fishId = A[9] || C[9];
    if (st === 'caught' && fishId) {
      const def = fishDef(fishId);
      if (def && this.held !== fishId) {
        g.hold(def, A[12]);
        this.held = fishId;
        this.caughtNote = def.name;
        this.noteAt.copy(feet).addScaledVector(_UP, 3.9);
      }
      // Seen from far away the fish is scaled up a little (same rule as the local catch pose).
      const boost = THREE.MathUtils.clamp(camera.position.distanceTo(_a.copy(feet).setY(feet.y + 2.4)) / 15, 1, 1.35);
      // Over the hat (same as the local catch pose: the hat sits ≈ 1.9 m up, the fish floats above it).
      // (Held clear above the farmer's floating name tag, ≈ 2.75 m: the tag never sits on the fish.)
      const hold = _hold.copy(feet).addScaledVector(_UP, 3.3 + (boost - 1) * 0.35).addScaledVector(fwd, 0.08 - (boost - 1) * 0.3);
      // Hanging from the farmer's fist when the pose hook reports it (else over the hat, as before).
      if (this.fistOk) hold.copy(this.fist).y -= 0.4;
      if (arc < 1) {
        g.heldRoot.position.lerpVectors(bob, hold, arc);
        g.heldRoot.position.y += Math.sin(arc * Math.PI) * 1.2;
        g.heldRoot.rotation.set(0, t * 6, Math.sin(t * 20) * 0.4);
        g.setGlory(null, camera, 0, t);
      } else {
        g.heldRoot.scale.setScalar(boost);
        if (this.fistOk) g.hangHeld(this.fist, camera, Math.sin(t * 2.6) * 0.1, hold);
        else {
          g.heldRoot.position.copy(hold);
          g.heldRoot.position.y += Math.sin(t * 3) * 0.02;
          // Flank squarely to this machine's camera (same billboard as the local catch pose).
          g.faceHeld(camera, Math.sin(t * 5) * 0.07 + 0.08);
        }
        g.setGlory(_a.copy(hold).setY(hold.y + 0.05), camera, Math.min(1, this.stT * 2) * 0.4, t, 2.2 * boost);
      }
    } else if (this.held) {
      g.hold(null);
      g.heldRoot.scale.setScalar(1);
      this.held = '';
      g.setGlory(null, camera, 0, t);
    }
  }

  private enter(st: NetState, s: FishNetSnap): void {
    const prev = this.st;
    this.st = st;
    this.stT = 0;
    const g = this.gear;
    _b.set(s[6], s[7], s[8]);
    if (st === 'waiting' && prev === 'casting') {
      g.waterY = s[7];
      g.splash(_b, false);
    } else if (st === 'bite') {
      g.splash(_b, true);
      g.twang = 1;
    }
    else if (st === 'caught') g.splash(_b, true);
    else if (st === 'reeling' && prev !== 'bite') g.splash(_b, false);
    if (st === 'casting' || st === 'charging') g.resetLine(_b);
  }

  private hideAll(camera: THREE.Camera): void {
    const g = this.gear;
    if (!g.rodVisible && !g.bobber.visible && !this.held) return;
    g.setRodVisible(false);
    g.bobber.visible = false;
    g.lineVisible = false;
    g.hold(null);
    this.held = '';
    g.glory.visible = false;
    g.updateLine(0, g.tip, camera);
  }

  dispose(): void {
    this.gear.group.removeFromParent();
    this.gear.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

/** Arm / torso pose for a farmer rig that is fishing in state `st` (remote farmers, the co-op demo). */
export function poseAnglerArms(rig: { armL: THREE.Object3D; armR: THREE.Object3D; torso: THREE.Object3D }, st: NetState, t: number, power = 0, arc = 0, fist?: THREE.Vector3): boolean {
  let ar = -0.95;
  let al = -0.8;
  let arz = 0.3;
  let alz = -0.35;
  let tx = 0.05;
  let ty = 0;
  if (st === 'charging') {
    ar = -2.75 - power * 0.2;
    al = -2.25 - power * 0.2;
    arz = 0.05;
    alz = 0.35;
    tx = -0.1 - power * 0.12;
    ty = 0.12 + power * 0.14;
  } else if (st === 'reeling' || st === 'bite') {
    ar = -1.35 + (st === 'reeling' ? Math.sin(t * 38) * 0.05 : 0);
    al = -1.05 + Math.sin(t * (st === 'reeling' ? 16 : 5)) * 0.25;
    alz = -0.45 + Math.cos(t * (st === 'reeling' ? 16 : 5)) * 0.15;
    tx = -0.12;
  } else if (st === 'caught' && arc > 0.6) {
    // Same as the local catch pose: the right fist punched up beside the head, the fish hanging from
    // it by the tail; the left arm up in a cheer.
    const lift = Math.sin(t * 3) * 0.05;
    ar = -0.32;
    arz = 2.62 + lift;
    al = -0.25 + Math.sin(t * 7) * 0.08;
    alz = -2.35 - lift;
    tx = 0.08;
  }
  rig.armR.rotation.set(ar, 0, arz);
  rig.armL.rotation.set(al, 0, alz);
  rig.armR.scale.y = st === 'caught' && arc > 0.6 ? 1.28 : 1;
  rig.torso.rotation.x = tx;
  rig.torso.rotation.y = ty;
  if (!fist || !(st === 'caught' && arc > 0.6)) return false;
  // The gripping fist in world space (the caller's farmer root must be up to date).
  rig.armR.updateWorldMatrix(true, false);
  rig.armR.localToWorld(fist.set(0, -0.31, 0.03));
  return true;
}
