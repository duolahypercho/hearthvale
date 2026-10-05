/**
 * `?demo=coop-farm` choreography: a 26 s loop of three farmhands working the host's strawberry bed
 * together (pillar 13 on screen, never mannequins):
 *
 *   Juniper  behind the bed, facing the camera, picks her way along the back row; while the basket
 *            is on the ground each berry lobs over the bed into it (it fills up).
 *   Briar    lifts the full basket, hauls it down the path to the shipping bin (thunk + bin sound),
 *            jogs back with it empty, sets it down and waves everyone over for coffee.
 *   Fennel   walks in and waters the front row tile by tile (the real can arc, splash and wet soil),
 *            turns to the camera, "Berries are watered!".
 *
 * Chat lines and emotes are staggered across the loop and expire (bubbles fade + shrink out).
 * Deterministic in the loop clock: `&t=<sec>` seeks (state replayed quietly, the last ~1.2 s of
 * actions replayed for real so a still lands mid-swing). Real time (demos pause the sim).
 */
import * as THREE from 'three';
import type { Game } from '../core/game';
import type { Facing } from '../core/events';
import type { NetSystem } from './system';
import { actionFor } from './system';
import { IMPACT } from '../entities/farmer-actions';
import { farmerMaterial } from '../entities/remote-farmer';
import { MeshBuilder, mat, bevelCylinder, lumpySphere } from '../world/geom';
import { Rng } from '../core/rng';
import { hex } from '../entities/remote-look';
import type { RemotePlayer } from './players';
import type { EmoteId } from '../entities/remote-emotes';

export const LOOP = 26;
/** The ripe strawberry bed (tiles inclusive). */
const BED_Z0 = 25;
export const BED = { x0: 22, z0: BED_Z0, x1: 27, z1: 26 };
/** Where the basket sits on the ground: off the bed's west end, level with its rows (r4: at the
 * bed's front corner it pulled Rowan down to the lens, big and face-down). */
const BASKET_AT = { x: 21.45, z: 25.95 };
/** The shipping bin's front (farm layout: bin at tiles 37-38, 16). */
const BIN_FRONT = { x: 37.5, z: 17.45 };
/** Age (s) inside which a seeked action is replayed for real (anim + FX); older ones apply quietly. */
const LIVE_AGE = 1.2;
/**
 * The grass lane between the kale row (tile 23) and the berry bed (tiles 25-26): Juniper + Fennel stand
 * on its south edge, toes at the bed's back edge (clear of the kale leaves behind them), facing the
 * camera, so every pick / pour reaches the berry row right in front of them (< 1 tile).
 */
export const LANE_Z = BED_Z0 - 0.3;
/** Where the host stands (front-east corner of the bed, turned to it); the camera is re-aimed. */
export const HOST_SPOT = { x: 28.55, z: 26.55 };
/** The host's yaw: three-quarters between the bed (west) and the camera, so the face reads under the hat. */
export const HOST_YAW = -Math.PI / 2 + 0.72;
/** The berry tile right in front of the host (the faced tile from HOST_SPOT). */
const HOST_TILE = { x: 27, z: 26 };

const yawOf = (f: Facing): number => (f === 'down' ? 0 : f === 'up' ? Math.PI : f === 'left' ? -Math.PI / 2 : Math.PI / 2);

interface Key {
  t: number;
  x: number;
  z: number;
  /** Facing while standing at this key (moving segments face their travel direction). */
  f: Facing;
}

/** Keys for a walk along `pts` at `speed` m/s starting at `t0`; returns the arrival time too. */
function route(keys: Key[], t0: number, pts: [number, number][], speed: number, endFacing: Facing): number {
  let t = t0;
  let [px, pz] = [keys[keys.length - 1]!.x, keys[keys.length - 1]!.z];
  keys.push({ t, x: px, z: pz, f: keys[keys.length - 1]!.f });
  for (const [x, z] of pts) {
    t += Math.hypot(x - px, z - pz) / speed;
    keys.push({ t, x, z, f: endFacing });
    px = x;
    pz = z;
  }
  return t;
}

/** Position / facing / ground speed on a key track at loop time `c`. */
function sampleTrack(keys: Key[], c: number): { x: number; z: number; f: Facing; yaw: number; speed: number } {
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1]!.t <= c) i++;
  const a = keys[i]!;
  const b = keys[i + 1];
  if (!b || c <= a.t) return { x: a.x, z: a.z, f: a.f, yaw: yawOf(a.f), speed: 0 };
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const k = (c - a.t) / Math.max(1e-3, b.t - a.t);
  if (len < 1e-3) return { x: a.x, z: a.z, f: a.f, yaw: yawOf(a.f), speed: 0 };
  return { x: a.x + dx * k, z: a.z + dz * k, f: a.f, yaw: Math.atan2(dx, dz), speed: len / (b.t - a.t) };
}

interface Ev {
  t: number;
  run: (age: number) => void;
}

interface Actor {
  p: RemotePlayer;
  keys: Key[];
  events: Ev[];
  /** Yaw override while acting (faces the worked tile). */
  actYaw: number | null;
  actUntil: number;
}

/** A woven harvest basket (one mesh) + its berry mound (one mesh, scaled by how full it is). */
function buildBasket(): { root: THREE.Group; mound: THREE.Mesh } {
  const m = farmerMaterial();
  const b = new MeshBuilder();
  b.add(m, bevelCylinder(0.27, 0.21, 0.26, 0.03, 14), mat(0, 0, 0), { tint: 0xc4904e });
  for (const y of [0.07, 0.15]) b.add(m, new THREE.TorusGeometry(0.245 + y * 0.18, 0.016, 5, 16), mat(0, y, 0, Math.PI / 2, 0, 0), { tint: 0x9a6a36 });
  b.add(m, new THREE.TorusGeometry(0.27, 0.028, 6, 18), mat(0, 0.255, 0, Math.PI / 2, 0, 0), { tint: 0xa8743a });
  b.add(m, new THREE.TorusGeometry(0.2, 0.018, 5, 12, Math.PI), mat(0, 0.25, 0, 0, Math.PI / 2, 0), { tint: 0x8a5a2c });
  const basket = new THREE.Mesh(b.geometries().get(m)!, m);
  basket.castShadow = true;
  const mb = new MeshBuilder();
  const rng = new Rng('berries');
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 * 1.618;
    const rr = i === 0 ? 0 : 0.07 + (i % 4) * 0.035;
    const g = lumpySphere(0.06, 1, 0.1, rng);
    g.scale(1, 1.15, 1);
    mb.add(m, g, mat(Math.cos(a) * rr, 0.04 - rr * 0.35 + (i === 0 ? 0.05 : 0), Math.sin(a) * rr), { tint: i % 3 ? 0xd8323a : 0xe8484a });
  }
  for (const a of [0.4, 2.6]) mb.add(m, new THREE.SphereGeometry(0.05, 6, 4), mat(Math.cos(a) * 0.12, 0.06, Math.sin(a) * 0.12, 0, a, 0, 1.4, 0.3, 0.8), { tint: 0x4f9a3c });
  const mound = new THREE.Mesh(mb.geometries().get(m)!, m);
  mound.position.y = 0.24;
  const root = new THREE.Group();
  root.name = 'coop-basket';
  root.userData.perfTag = 'farmers';
  root.add(basket, mound);
  return { root, mound };
}

export class FarmChoreo {
  private actors: Actor[] = [];
  private hostEvents: Ev[] = [];
  private clock = 0;
  private basket = buildBasket();
  /** 0..1 how full the basket is. */
  private fill = 0.8;
  private carrying = false;
  private berries: { m: THREE.Mesh; t: number; hold: number; from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  private berryGeo = new THREE.SphereGeometry(0.075, 8, 6);
  private berryMat = new THREE.MeshStandardMaterial({ color: 0xd8323a, roughness: 0.4 });
  private seeking = false;
  private seekTo = 0;
  private pop = 0;

  constructor(
    private game: Game,
    private net: NetSystem,
    /** Juniper, Fennel, Briar (already added + placed). */
    bots: RemotePlayer[],
  ) {
    const [jun, pip, row] = bots as [RemotePlayer, RemotePlayer, RemotePlayer];
    this.actors = [this.juniper(jun), this.pip(pip), this.rowan(row)];
    // The host isn't a mannequin either: picks the corner berry twice a loop (between Juniper's
    // picks and Pip's pours, so the beats never stack).
    for (const t of [4.1, 17.4]) this.hostEvents.push({ t, run: (age) => this.hostPick(age) });
    this.game.world.current?.root.add(this.basket.root);
    this.placeBasket();
  }

  // ─────────────────────────────── scripts

  private juniper(p: RemotePlayer): Actor {
    const z = LANE_Z;
    const keys: Key[] = [{ t: 0, x: BED.x0 + 0.5, z, f: 'down' }];
    const events: Ev[] = [];
    const act: Actor = { p, keys, events, actYaw: null, actUntil: 0 };
    // Works the west end of the back row (cols 22-23), Pip the east end: never shoulder to shoulder.
    for (const c0 of [0, 13]) {
      const picks: [number, number][] = [
        [0.6, 0],
        [2.8, 1],
        [5.0, 0],
        [7.8, 1],
        [10.0, 0],
      ];
      let x = BED.x0 + 0.5;
      for (const [tp, i] of picks) {
        const col = BED.x0 + i;
        const tx = col + 0.5;
        if (Math.abs(tx - x) > 0.01) {
          const d = Math.abs(tx - x);
          keys.push({ t: c0 + tp - 0.3 - d * 0.45, x, z, f: 'down' });
          keys.push({ t: c0 + tp - 0.3, x: tx, z, f: 'down' });
          x = tx;
        }
        events.push({ t: c0 + tp, run: (age) => this.pick(act, col, BED.z0, age) });
      }
      keys.push({ t: c0 + 11.6, x, z, f: 'down' });
      keys.push({ t: c0 + 12.3, x: BED.x0 + 0.5, z, f: 'down' });
    }
    events.push({ t: 1.2, run: (age) => this.say(p, 'Race you to the bin after this row!', age) });
    events.push({ t: 11.2, run: (age) => this.emote(p, 'laugh', age) });
    events.push({ t: 19.8, run: (age) => this.say(p, 'Save me a mug, Briar!', age) });
    events.push({ t: 23.6, run: (age) => this.emote(p, 'heart', age) });
    return act;
  }

  private pip(p: RemotePlayer): Actor {
    // Behind the bed beside Juniper, facing the camera: waters the east half of the back row (cols
    // 27 → 25) twice a loop, walking back to the corner in between.
    const z = LANE_Z;
    const home = BED.x1 + 0.5;
    const keys: Key[] = [{ t: 0, x: home, z, f: 'down' }];
    const events: Ev[] = [];
    const act: Actor = { p, keys, events, actYaw: null, actUntil: 0 };
    for (const c0 of [0, 13]) {
      for (let i = 0; i < 3; i++) {
        const tx = BED.x1 - i;
        const tw = c0 + 1.5 + i * 2;
        if (i > 0) {
          keys.push({ t: tw - 0.8, x: tx + 1.5, z, f: 'down' });
          keys.push({ t: tw - 0.25, x: tx + 0.5, z, f: 'down' });
        }
        events.push({ t: tw, run: (age) => this.water(act, tx, BED.z0, age) });
      }
      keys.push({ t: c0 + 8.6, x: BED.x1 - 1.5, z, f: 'down' });
      keys.push({ t: c0 + 9.9, x: home, z, f: 'down' });
    }
    events.push({ t: 7.1, run: (age) => this.say(p, 'Berries are watered!', age) });
    events.push({ t: 7.7, run: (age) => this.emote(p, 'music', age) });
    events.push({ t: 21.0, run: (age) => this.emote(p, 'happy', age) });
    return act;
  }

  private rowan(p: RemotePlayer): Actor {
    const home = { x: BASKET_AT.x - 0.72, z: BASKET_AT.z - 0.3 };
    const keys: Key[] = [{ t: 0, x: home.x, z: home.z, f: 'right' }];
    const events: Ev[] = [];
    const act: Actor = { p, keys, events, actYaw: null, actUntil: 0 };
    // Along the bed's front edge (one strip from the berries, so he stays the others' size in frame
    // rather than looming at the lens), round the host's back, then up the path to the bin.
    const out: [number, number][] = [
      [21.6, 27.75],
      [29.5, 27.75],
      [30.3, 24.6],
      [32.3, 21.2],
      [BIN_FRONT.x, BIN_FRONT.z],
    ];
    events.push({ t: 0.35, run: (age) => this.lift(act, age) });
    const arrive = route(keys, 1.0, out, 2.5, 'up');
    // Tips the basket into the bin, then turns round to the camera with a grin (his front-facing beat)
    // before the jog back.
    keys.push({ t: arrive + 0.75, x: BIN_FRONT.x, z: BIN_FRONT.z, f: 'up' });
    keys.push({ t: arrive + 0.8, x: BIN_FRONT.x, z: BIN_FRONT.z + 0.05, f: 'down' });
    keys.push({ t: arrive + 1.9, x: BIN_FRONT.x, z: BIN_FRONT.z + 0.05, f: 'down' });
    events.push({ t: arrive + 0.2, run: (age) => this.ship(act, age) });
    events.push({ t: arrive + 0.9, run: (age) => this.emote(p, 'happy', age) });
    events.push({ t: arrive + 1.0, run: (age) => this.say(p, 'Six baskets shipped!', age) });
    const back = route(keys, arrive + 1.9, [...out.slice(0, 4).reverse(), [home.x, home.z]], 4.4, 'down');
    events.push({ t: back + 0.1, run: () => this.setDown() });
    events.push({ t: back + 0.35, run: (age) => this.waveFor(p, age) });
    events.push({ t: back + 0.45, run: (age) => this.say(p, 'Coffee’s on at my cabin, come on over!', age) });
    keys.push({ t: back + 4.5, x: home.x, z: home.z, f: 'down' });
    keys.push({ t: back + 4.6, x: home.x, z: home.z, f: 'right' });
    return act;
  }

  // ─────────────────────────────── beats

  private live(age: number): boolean {
    return !this.seeking || age <= LIVE_AGE;
  }

  private faceTile(a: Actor, f: Facing, dur: number): void {
    a.actYaw = yawOf(f);
    a.actUntil = this.clock + dur;
  }

  private pick(a: Actor, x: number, z: number, age: number): void {
    const farming = this.game.services.farming;
    if (!farming) return;
    const ripe = !!farming.cropAt(x, z)?.ripe;
    const live = this.live(age);
    if (live) {
      const ac = actionFor('@act');
      this.faceTile(a, 'down', IMPACT[ac.kind] + 0.6);
      a.p.farmer.speed = 0;
      a.p.farmer.act(ac.kind, ac.tool);
    }
    const harvest = (): void => {
      if (!farming.cropAt(x, z)?.ripe) return;
      if (live) this.net.sync.applyHarvest(x, z);
      else this.net.sync.remote({ quiet: true }, () => this.net.sync.farming()?.harvest(x, z, 'instant'));
      // Held up in the fist (the pull's "look what I got" beat), then lobbed into the basket.
      if (live) this.lob(a.p.farmer.rig.armR);
      else if (!this.carrying) {
        this.fill = Math.min(1, this.fill + 0.2);
        this.placeBasket();
      }
    };
    const at = Math.max(0, IMPACT.pull - age);
    if (ripe && age < 3.4) {
      if (at > 0) this.net.later(at * 1000, harvest);
      else harvest();
    }
    // It fruits again a few seconds later, so the bed stays red.
    this.net.later(Math.max(0.1, 3.6 - age) * 1000, () => {
      if (this.actors.length && !farming.cropAt(x, z)?.ripe) this.net.sync.remote({ quiet: true }, () => farming.plantBlock('strawberry', x, z, 1, 1, true));
    });
  }

  private water(a: Actor, x: number, z: number, age: number): void {
    if (!this.live(age)) {
      this.net.sync.applyUse('wateringCan', x, z, 'down', undefined, true);
      return;
    }
    const ac = actionFor('wateringCan');
    this.faceTile(a, 'down', IMPACT[ac.kind] + 0.9);
    a.p.farmer.speed = 0;
    a.p.farmer.act(ac.kind, ac.tool);
    this.net.later(Math.max(0, IMPACT[ac.kind] - age) * 1000, () => {
      if (this.actors.length) this.net.sync.applyUse('wateringCan', x, z, 'down');
    });
  }

  private lift(a: Actor, age: number): void {
    if (this.live(age)) {
      const ac = actionFor('@act');
      a.p.farmer.act(ac.kind, ac.tool);
    }
    const take = (): void => {
      this.carrying = true;
      this.placeBasket();
    };
    const at = Math.max(0, 0.45 - age);
    if (at > 0) this.net.later(at * 1000, take);
    else take();
  }

  private ship(a: Actor, age: number): void {
    if (this.live(age)) {
      const ac = actionFor('@act');
      a.p.farmer.act(ac.kind, ac.tool);
      this.net.later(Math.max(0, 0.3 - age) * 1000, () => {
        if (!this.actors.length) return;
        this.fill = 0;
        this.pop = 0.25;
        this.placeBasket();
        this.game.events.emit('shipping:add', { itemId: 'strawberry', qty: 6, value: 0 });
      });
    } else {
      this.fill = 0;
      this.placeBasket();
    }
  }

  private setDown(): void {
    this.carrying = false;
    this.fill = 0;
    this.placeBasket();
  }

  /**
   * A line said aloud: the bubble over the farmer AND the chat log (the same `net:chat` path real
   * chat takes), so the log always matches what the bubbles say. A seek re-logs the lines whose log
   * chip would still be up (8 s), oldest first.
   */
  private say(p: RemotePlayer, text: string, age: number): void {
    const dur = Math.min(8, 4 + text.length * 0.05);
    if (age < dur - 0.3) p.chat(text, dur - age);
    if (age < 7.5) this.game.events.emit('net:chat', { id: p.id, name: p.name, text, color: hex(p.look.scarf) });
  }

  // ─────────────────────────────── the host (the local farmer)

  /** Turn the host three-quarters to the camera (still facing the bed tile for tool targeting). */
  hostPose(): void {
    const pl = this.game.player;
    if (pl.facing !== 'left') pl.setFacing('left');
    (pl as unknown as { targetYaw: number }).targetYaw = HOST_YAW;
  }

  /** The host picks the berry right in front of them (their own pull + the item flying to the bar). */
  private hostPick(age: number): void {
    const farming = this.game.services.farming;
    if (!farming || !this.live(age)) return;
    const { x, z } = HOST_TILE;
    if (farming.cropAt(x, z)?.ripe) this.game.events.emit('player:interact', { x, z });
    // Back to the three-quarter stance once the pull has played, and the berry fruits again.
    this.net.later(1100, () => this.actors.length && this.hostPose());
    this.net.later(3600, () => {
      if (this.actors.length && !farming.cropAt(x, z)?.ripe) this.net.sync.remote({ quiet: true }, () => farming.plantBlock('strawberry', x, z, 1, 1, true));
    });
  }

  private emote(p: RemotePlayer, id: EmoteId, age: number): void {
    if (age < 2.2) p.emote(id, 2.6 - age);
  }

  private waveFor(p: RemotePlayer, age: number): void {
    if (age < 1.6) p.farmer.wave(1.8 - age);
  }

  // ─────────────────────────────── basket + berries

  private placeBasket(): void {
    const { root, mound } = this.basket;
    const row = this.actors[2]?.p.farmer;
    if (this.carrying && row) {
      root.scale.setScalar(0.82);
      row.carry(root);
      root.position.set(0, -0.02, 0.36);
    } else {
      row?.carry(null);
      const map = this.game.world.current;
      if (map && root.parent !== map.root) map.root.add(root);
      root.scale.setScalar(1);
      root.position.set(BASKET_AT.x, map ? map.heightAt(BASKET_AT.x, BASKET_AT.z) : 0, BASKET_AT.z);
      root.rotation.set(0, 0.3, 0);
    }
    mound.visible = this.fill > 0.01;
    mound.scale.set(0.55 + 0.45 * this.fill, 0.4 + 0.6 * this.fill, 0.55 + 0.45 * this.fill);
    mound.position.y = 0.12 + 0.13 * this.fill;
  }

  /** A berry held up in the picker's fist for a beat, then lobbed over the bed into the basket. */
  private lob(hand: THREE.Object3D): void {
    let b = this.berries.find((q) => q.t < 0 && q.hold <= 0);
    if (!b) {
      const m = new THREE.Mesh(this.berryGeo, this.berryMat);
      m.castShadow = true;
      b = { m, t: -1, hold: 0, from: new THREE.Vector3(), to: new THREE.Vector3() };
      this.berries.push(b);
    }
    hand.add(b.m);
    b.m.position.set(0, -0.37, 0.07);
    b.m.scale.setScalar(1.25);
    b.m.visible = true;
    b.hold = 0.6;
    b.t = -1;
  }

  // ─────────────────────────────── frame

  /** Jump the loop to `t` s (state replayed quietly; the last LIVE_AGE s of actions for real). */
  seek(t: number): void {
    t = ((t % LOOP) + LOOP) % LOOP;
    if (t <= 0) return;
    this.seeking = true;
    this.seekTo = t;
    const dt = 1 / 30;
    let c = 0;
    while (c < t - 1e-6) {
      const step = Math.min(dt, t - c);
      this.advance(step, c + step > t - LIVE_AGE);
      c += step;
    }
    this.seeking = false;
  }

  update(dt: number): void {
    this.advance(Math.min(0.1, dt), false);
    // Berry lobs.
    const map = this.game.world.current;
    for (const b of this.berries) {
      if (b.hold > 0) {
        b.hold -= dt;
        if (b.hold > 0) continue;
        // Let go: into the basket if it's on the ground, else into the apron (gone).
        b.m.getWorldPosition(b.from);
        b.m.removeFromParent();
        if (this.carrying || !map) {
          b.m.visible = false;
          continue;
        }
        map.root.add(b.m);
        b.m.scale.setScalar(1);
        b.to.set(BASKET_AT.x, map.heightAt(BASKET_AT.x, BASKET_AT.z) + 0.3, BASKET_AT.z);
        b.t = 0;
      }
      if (b.t < 0) continue;
      b.t += dt / 0.55;
      if (b.t >= 1) {
        b.t = -1;
        b.m.visible = false;
        this.fill = Math.min(1, this.fill + 0.2);
        this.pop = 0.18;
        this.placeBasket();
        continue;
      }
      const k = b.t;
      b.m.position.lerpVectors(b.from, b.to, k);
      b.m.position.y += Math.sin(k * Math.PI) * 1.1;
    }
    // A little squash-pop when something lands in (or leaves) the basket.
    if (this.pop > 0) {
      this.pop = Math.max(0, this.pop - dt);
      const s = 1 + Math.sin((1 - this.pop / 0.25) * Math.PI) * 0.12;
      this.basket.root.scale.set(s * (this.carrying ? 0.82 : 1), (this.carrying ? 0.82 : 1) / s, s * (this.carrying ? 0.82 : 1));
    }
  }

  private advance(dt: number, animate: boolean): void {
    const c0 = this.clock;
    let c1 = c0 + dt;
    const wrap = c1 >= LOOP;
    if (wrap) c1 -= LOOP;
    const map = this.game.world.current;
    for (const a of [...this.actors.map((q) => q.events), this.hostEvents]) {
      for (const e of a) {
        const hit = wrap ? e.t >= c0 || e.t < c1 : e.t >= c0 && e.t < c1;
        if (!hit) continue;
        this.clock = e.t;
        const age = this.seeking ? Math.max(0, this.seekTo - e.t) : 0;
        e.run(age);
      }
    }
    this.clock = c1;
    for (const a of this.actors) {
      const s = sampleTrack(a.keys, c1);
      const f = a.p.farmer;
      const acting = f.acting;
      f.position.set(s.x, map ? map.heightAt(s.x, s.z) : 0, s.z);
      f.speed = acting ? 0 : s.speed;
      f.targetYaw = a.actYaw !== null && (c1 < a.actUntil || acting) ? a.actYaw : s.yaw;
      if (a.actYaw !== null && c1 >= a.actUntil && !acting) a.actYaw = null;
      if (this.seeking && animate) f.update(dt, this.game.time);
    }
  }

  dispose(): void {
    this.actors[2]?.p.farmer.carry(null);
    this.actors = [];
    this.basket.root.removeFromParent();
    for (const b of this.berries) b.m.removeFromParent();
    this.berries = [];
    this.berryGeo.dispose();
    this.berryMat.dispose();
  }
}
