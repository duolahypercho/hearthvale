/**
 * Authored crowd vignettes (r8 critic: "fewer, distinct people, each placed for a reason"): small
 * groups of 2–4 doing one thing together — a picnic on a blanket, an elder on a bench with a friend,
 * a couple watching the show, three neighbours gossiping, kids chasing each other round a loop.
 * Each festival places a handful of these instead of rows of identical onlookers.
 *
 * Yaw convention (crowd): 0 faces +z (toward the diorama camera); yaw = atan2(dx, dz) faces (dx, dz).
 */
import * as THREE from 'three';
import type { NpcLook } from '../../data/npcs';
import type { Rng } from '../../core/rng';
import { randomLook, type CrowdSpec, type AnimName, type Crowd } from './crowd';
import { buildBlanket } from './kit';
import { buildBench } from '../props/farmkit';

export type Person = (look: NpcLook, anim: AnimName, x: number, z: number, yaw: number, extra?: Partial<CrowdSpec>) => number;

export interface VignetteCtx {
  person: Person;
  r: Rng;
  palette: number[];
  /** Place a static prop (blanket, bench) on the ground. */
  prop: (g: THREE.Group, x: number, z: number, rot: number, solid?: [number, number]) => void;
  /** Blanket checks for this festival. */
  cloth?: [number, number];
}

const look = (c: VignetteCtx, child = false): NpcLook => randomLook(c.r, { palette: c.palette, child });
/** Every vignette member is authored (see CrowdSpec.authored). */
const A = (c: VignetteCtx): Person => (l, anim, x, z, yaw, extra) => c.person(l, anim, x, z, yaw, { authored: true, ...extra });

/** Two sitting on a picnic blanket (one toasting with a mug) + a child kneeling-up cheering. */
export function picnic(c: VignetteCtx, x: number, z: number, yaw: number): number[] {
  c.prop(buildBlanket(c.r, c.cloth ?? [0xd8573e, 0xf6efe2], 1.9, 1.5), x, z, yaw, [1.8, 1.4]);
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const at = (dx: number, dz: number): [number, number] => [x + cs * dx + sn * dz, z - sn * dx + cs * dz];
  const [ax, az] = at(-0.45, -0.2);
  const [bx, bz] = at(0.45, -0.25);
  const [kx, kz] = at(0.1, 0.45);
  return [
    A(c)(look(c), 'sit', ax, az, yaw + 0.35, { lift: 0.02, props: ['mug'], variant: 0 }),
    A(c)(look(c), 'sit', bx, bz, yaw - 0.4, { lift: 0.02, variant: 3 }),
    A(c)(look(c, true), 'cheer', kx, kz, yaw + Math.PI + 0.3, { props: ['pie'], variant: 1 }),
  ];
}

/** A bench: an elder sitting (a cane / a mug), a friend standing beside chatting. */
export function benchPair(c: VignetteCtx, x: number, z: number, yaw: number): number[] {
  c.prop(buildBench(), x, z, yaw, [1.4, 0.6]);
  const ax = Math.cos(yaw);
  const az = -Math.sin(yaw);
  const elder = randomLook(c.r, { palette: c.palette });
  elder.hair = 0xbcb6ae;
  elder.glasses = true;
  elder.scale = Math.min(elder.scale, 0.92);
  const out: number[] = [];
  out.push(A(c)(elder, 'sit', x - ax * 0.35, z - az * 0.35, yaw, { lift: 0.2, props: ['mug'], stoop: 0.12 }));
  out.push(A(c)(look(c), 'talk', x + ax * 1.0 + Math.sin(yaw) * 0.35, z + az * 1.0 + Math.cos(yaw) * 0.35, yaw - 1.2, { variant: 1 }));
  return out;
}

/** A couple side by side watching something at (tx, tz): one swaying to the music, one arms folded. */
export function couple(c: VignetteCtx, x: number, z: number, tx: number, tz: number): number[] {
  const yaw = Math.atan2(tx - x, tz - z);
  const px = Math.cos(yaw) * 0.36;
  const pz = -Math.sin(yaw) * 0.36;
  return [A(c)(look(c), 'sway', x - px, z - pz, yaw + 0.15, { variant: 0 }), A(c)(look(c), 'idle', x + px, z + pz, yaw - 0.15, { variant: 2 })];
}

/** Three neighbours in a little triangle, chatting (one laughing, one thinking, one gesturing). */
export function gossip(c: VignetteCtx, x: number, z: number, rot = 0): number[] {
  const out: number[] = [];
  const anims: [AnimName, number][] = [
    ['talk', 1],
    ['idle', 4],
    ['talk', 0],
  ];
  anims.forEach(([anim, variant], k) => {
    const a = rot + (k / 3) * Math.PI * 2;
    const px = x + Math.sin(a) * 0.62;
    const pz = z + Math.cos(a) * 0.62;
    out.push(A(c)(look(c), anim, px, pz, Math.atan2(x - px, z - pz) * 0.75 + (k === 1 ? 0.4 : 0), { variant, props: k === 2 && c.r.next() < 0.5 ? ['mug'] : [] }));
  });
  return out;
}

/** Kids chasing each other round a little loop (animated by `Chasers.update`). */
export class Chasers {
  constructor(
    readonly ids: number[],
    private cx: number,
    private cz: number,
    private rx: number,
    private rz: number,
    private speed = 0.55,
  ) {}

  static place(c: VignetteCtx, n: number, cx: number, cz: number, rx = 1.6, rz = 1.0): Chasers {
    const ids: number[] = [];
    for (let k = 0; k < n; k++) ids.push(A(c)(look(c, true), 'walk', cx + rx, cz, 0, { speed: 1.7, props: k === 0 && n > 2 ? ['balloon'] : [], pinned: true }));
    return new Chasers(ids, cx, cz, rx, rz);
  }

  /** Run round the loop (no allocations). */
  update(crowd: Crowd, t: number): void {
    const n = this.ids.length;
    for (let k = 0; k < n; k++) {
      const i = this.ids[k]!;
      // The leader pulls ahead, the chasers lag a little more each lap (a chase, not a conga).
      const a = t * this.speed - k * (0.85 + 0.15 * Math.sin(t * 0.7 + k));
      const x = this.cx + Math.cos(a) * this.rx;
      const z = this.cz + Math.sin(a) * this.rz;
      const m = crowd.members[i]!;
      crowd.place(i, x, z, Math.atan2(-Math.sin(a) * this.rx, Math.cos(a) * this.rz), 0);
      m.y += Math.abs(Math.sin(t * 9 + k * 1.7)) * 0.05;
    }
  }
}
