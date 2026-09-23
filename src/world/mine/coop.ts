/**
 * Co-op in the Hollowdeep (DESIGN pillar 13): the HOST is authoritative for every mine floor that
 * has a farmer on it.
 *
 *  - Floors: layouts are seeded, so every machine builds the same floor from (floor, seed); the host
 *    sends its mine seed to each farmhand. What diverges at runtime lives in a per-floor record on the
 *    host (broken rocks, damaged rocks, the ladder, loot on the ground, monsters) for as long as
 *    anybody stands on that floor — the floor resets when the last farmer leaves (as in solo).
 *  - Simulation: the host's own floor runs in its live MineMap; any other occupied floor runs in a
 *    HEADLESS sim on the host (layout + tile collision + real Monster AI, no rendering). When the
 *    host walks onto / off a floor the state migrates live ⇄ headless (monster ids, hp, loot kept).
 *    Monsters chase the nearest living farmer on their floor; their hits on a farmhand are sent to
 *    that farmhand (health / passing out stay per player).
 *  - Farmhands run their MineMap as a puppet: monsters are mirrors of the host's 10 Hz snapshots,
 *    interpolated ~120 ms behind; rocks / loot / ladders change only on the host's word. A pick hit
 *    or a sword swing is predicted locally (pose, chips, crescent) and sent as an intent; the host
 *    resolves it and broadcasts the verdict (rock state + exact drops, hits with damage / crit /
 *    kill) to everyone on that floor. Loot flies to the nearest farmer; the host decides who got it.
 *
 * Wire (payload kinds start with "m." and ride the net layer's extension channel):
 *   farmhand → host  ['m.p', floor, xcm, zcm, alive]  10 Hz while in the mine (floor 0 = entrance, -1 = away)
 *                    ['m.need', floor] · ['m.rk', floor, tx, tz, power] · ['m.sw', floor, oxcm, ozcm, dx, dz, tier]
 *   host → farmhand  ['m.seed', seed] · ['m.pl', [[id, floor, xcm, zcm, alive], …]] 10 Hz
 *                    ['m.full', floor, {broken, hp, ladder, loot, mons}] on arrival
 *                    ['m.ms', floor, [[id, kind, xcm, ycm, zcm, yaw, hp, max], …]] 10 Hz per occupied floor
 *                    ['m.rs', floor, idx, hp, broke, striker, drops] · ['m.hit', floor, striker, oxcm, ozcm, [[id, dmg, crit, killed, kdx, kdz], …]]
 *                    ['m.dr', floor, drops] · ['m.lt', floor, net, who] · ['m.give', item, qty] · ['m.hurt', dmg, xcm, zcm, kind]
 *                    ['m.ld', floor, x, z] · ['m.fb', floor, x, y, z, dx, dz] · ['m.swg', floor, who, oxcm, ozcm, dx, dz] · ['m.pk', floor, who]
 *
 * Service `mineNet`: sameFloor(id) (the net layer hides farmers on other floors), floorOf(id),
 * stats(). Solo play never touches any of this.
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import { Rng } from '../../core/rng';
import { MineMap, MONSTER_DROPS, rollRockLoot, setPendingMineSeed, type DropInfo, type MineHooks, type StrikeHit } from './index';
import { generateFloor, FLOOR_W, FLOOR_D, type FloorLayout } from './gen';
import { createMonster, type Monster, type ArenaCtx } from '../../entities/monsters';
import type { MonsterKind } from './biomes';
import { DamageNumbers } from './hud';
import { SlashArc, SWORD_TIERS, SWORD_REACH, SWORD_ARC_COS, SWORD_CRIT } from './actions';
import { mineSfx } from './sfx';

export interface MineNetApi {
  /** Is farmer `id` on this machine's mine floor (or not in the mine at all)? */
  sameFloor(id: number): boolean;
  /** Mine floor farmer `id` is on (0 = entrance, -1 = not in the mine). */
  floorOf(id: number): number;
  stats(): { role: string; floors: number[]; headless: number[]; peers: number; mirrors: number; msgsIn: number; msgsOut: number; hurtsOut: number; hurtsIn: number };
}

declare module '../../core/game' {
  interface GameServices {
    mineNet: MineNetApi;
  }
}

type Role = 'solo' | 'host' | 'client';
interface NetLike {
  role(): Role;
  myId(): number;
  remotes?: { get(id: number): { farmer: { act(kind: string, tool: string | null): void; setFacingYaw(y: number): void } } | undefined };
}

const KINDS: MonsterKind[] = ['slime', 'bat', 'crab', 'wisp', 'imp'];
const TICK = 0.1;
const INTERP = 0.12;
const cm = (v: number): number => Math.round(v * 100);

interface Peer {
  id: number;
  floor: number;
  pos: THREE.Vector3;
  alive: boolean;
  seen: number;
  seeded: boolean;
}

interface LootRec {
  net: number;
  id: string;
  qty: number;
  x: number;
  y: number;
  z: number;
  t: number;
}

/** Host-side record of one occupied floor. */
interface FloorState {
  floor: number;
  broken: Set<number>;
  hp: Map<number, number>;
  ladder: { x: number; z: number } | null;
  headless: Headless | null;
}

// ─────────────────────────────────────────────────────────── headless floor (host)

/**
 * A floor the host is not standing on: the seeded layout for collision, rock hp from the ledger,
 * real Monster instances (their AI + rig run, nothing is rendered), loot as plain records.
 */
class Headless {
  readonly L: FloorLayout;
  readonly monsters: Monster[] = [];
  readonly loot: LootRec[] = [];
  private rockHp = new Map<number, number>();
  private rockSpec = new Map<number, FloorLayout['rocks'][number]>();
  private rng: Rng;
  private ctx: ArenaCtx;
  private target = new WeakMap<Monster, number>();
  private nextNet = 1;
  private nextLoot = 1e6;
  private remaining: number;
  onAttack: ((target: number, dmg: number, x: number, z: number, kind: MonsterKind) => void) | null = null;
  onShoot: ((from: THREE.Vector3, dir: THREE.Vector3) => void) | null = null;
  onDrops: ((d: DropInfo[]) => void) | null = null;
  onLadder: ((x: number, z: number) => void) | null = null;

  constructor(
    readonly floor: number,
    seed: number,
    readonly st: FloorState,
  ) {
    this.L = generateFloor(floor, seed);
    this.rng = new Rng((seed ^ (floor * 7919) ^ 0x5eed) >>> 0);
    for (const r of this.L.rocks) {
      const idx = r.z * FLOOR_W + r.x;
      if (st.broken.has(idx)) continue;
      this.rockHp.set(idx, st.hp.get(idx) ?? r.hp);
      this.rockSpec.set(idx, r);
    }
    this.remaining = this.rockHp.size;
    const L = this.L;
    const inb = (x: number, z: number): boolean => x >= 0 && z >= 0 && x < L.w && z < L.d;
    const walk = (x: number, z: number): boolean => inb(x, z) && !L.solid[z * L.w + x] && !L.lava[z * L.w + x] && !this.rockHp.has(z * L.w + x);
    this.ctx = {
      time: 0,
      player: new THREE.Vector3(),
      playerTargetable: false,
      walkable: walk,
      flyable: (x, z) => inb(x, z) && !L.solid[z * L.w + x],
      heightAt: () => 0,
      clear: (x, z, r, fly) => {
        for (let k = 0; k <= 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const rr = k === 8 ? 0 : r * 0.9;
          const tx = Math.floor(x + Math.cos(a) * rr);
          const tz = Math.floor(z + Math.sin(a) * rr);
          if (fly ? !(inb(tx, tz) && !L.solid[tz * L.w + tx]) : !walk(tx, tz)) return false;
        }
        return true;
      },
      onAttack: (m, dmg) => {
        const who = this.target.get(m);
        if (who !== undefined && who >= 0) this.onAttack?.(who, dmg, m.pos.x, m.pos.z, m.kind);
      },
      puff: () => {},
      shoot: (_m, from, dir) => this.onShoot?.(from.clone(), dir.clone()),
      rng: this.rng,
    };
  }

  addMonster(kind: MonsterKind, x: number, z: number, net = 0, hp = -1): Monster {
    const band = Math.floor((this.floor - 1) / 10) % 3;
    const m = createMonster(kind, this.L.biome, x, z, this.L.tier, band, this.rng.int(1, 1e6));
    m.netId = net || this.nextNet++;
    if (net >= this.nextNet) this.nextNet = net + 1;
    if (hp > 0) m.hp = hp;
    this.monsters.push(m);
    return m;
  }

  spawnLayoutMonsters(): void {
    for (const m of this.L.monsters) this.addMonster(m.kind, m.x, m.z);
  }

  update(dt: number, time: number, farmers: { id: number; pos: THREE.Vector3; targetable: boolean }[]): void {
    this.ctx.time = time;
    for (const m of this.monsters) {
      if (m.dead) continue;
      let best = Infinity;
      let who = -1;
      let at: THREE.Vector3 | null = null;
      for (const f of farmers) {
        if (!f.targetable) continue;
        const d = Math.hypot(m.pos.x - f.pos.x, m.pos.z - f.pos.z);
        if (d < best) {
          best = d;
          who = f.id;
          at = f.pos;
        }
      }
      this.target.set(m, who);
      this.ctx.player = at ?? this.ctx.player;
      this.ctx.playerTargetable = !!at;
      m.update(dt, this.ctx);
    }
    // Deaths → loot records (+ the ladder once the floor is cleared).
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i]!;
      if (!m.dead) continue;
      this.monsters.splice(i, 1);
      const drops: DropInfo[] = [];
      for (const [id, chance] of MONSTER_DROPS[m.kind]) if (this.rng.next() < chance) drops.push(this.drop(id, m.pos, 0.8));
      if (drops.length) this.onDrops?.(drops);
      m.dispose();
      if (!this.st.ladder && this.monsters.every((x) => !x.alive)) this.reveal(Math.floor(m.pos.x), Math.floor(m.pos.z));
    }
  }

  private drop(id: string, at: THREE.Vector3, power: number): DropInfo {
    const a = this.rng.next() * Math.PI * 2;
    const sp = (0.9 + this.rng.next() * 0.9) * power;
    const d: DropInfo = { net: this.nextLoot++, id, qty: 1, x: at.x, y: 0, z: at.z, vx: Math.cos(a) * sp, vy: 3.8 + this.rng.next() * 1.2, vz: Math.sin(a) * sp };
    // Where it lands (≈ 0.55 s of flight + a bounce): collection is decided from there.
    this.loot.push({ net: d.net, id, qty: 1, x: at.x + d.vx * 0.62, y: 0, z: at.z + d.vz * 0.62, t: 0 });
    return d;
  }

  private reveal(tx: number, tz: number): void {
    const L = this.L;
    const open = (x: number, z: number): boolean => x >= 0 && z >= 0 && x < L.w && z < L.d && !L.solid[z * L.w + x] && !L.lava[z * L.w + x] && !this.rockHp.has(z * L.w + x);
    for (let r = 0; r <= 6; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          let ok = true;
          for (let a = -2; a <= 2 && ok; a++) for (let b = -2; b <= 2 && ok; b++) if (Math.abs(a) + Math.abs(b) <= 3 && !open(tx + dx + a, tz + dz + b)) ok = false;
          if (!ok) continue;
          this.st.ladder = { x: tx + dx, z: tz + dz };
          this.onLadder?.(tx + dx, tz + dz);
          return;
        }
  }

  /** Pickaxe verdict (null = no rock there). */
  strikeRock(idx: number, power: number): { hp: number; broke: boolean; drops: DropInfo[] } | null {
    const hp0 = this.rockHp.get(idx);
    const spec = this.rockSpec.get(idx);
    if (hp0 === undefined || !spec) return null;
    const hp = hp0 - power;
    if (hp > 0) {
      this.rockHp.set(idx, hp);
      this.st.hp.set(idx, hp);
      return { hp, broke: false, drops: [] };
    }
    this.rockHp.delete(idx);
    this.st.broken.add(idx);
    this.st.hp.delete(idx);
    this.remaining--;
    const at = new THREE.Vector3(spec.x + 0.5, 0, spec.z + 0.5);
    const drops = rollRockLoot(() => this.rng.next(), spec.ore, spec.big, this.L.biome).map((id) => this.drop(id, at, 1.4));
    if (!this.st.ladder) {
      const total = this.L.rocks.length;
      const done = 1 - this.remaining / Math.max(1, total);
      const p = 0.035 + done * done * 0.3 + (this.monsters.every((m) => !m.alive) ? 0.08 : 0);
      if (this.rng.next() < p || this.remaining < total * 0.12) this.reveal(spec.x, spec.z);
    }
    return { hp: 0, broke: true, drops };
  }

  /** Sword verdict: the same arc test / damage roll as the live map. */
  strike(origin: THREE.Vector3, dir: THREE.Vector3, reach: number, arcCos: number, dmg: [number, number], crit: number): StrikeHit[] {
    const hits: StrikeHit[] = [];
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const dx = m.pos.x - origin.x;
      const dz = m.pos.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > reach + m.radius + 0.3) continue;
      const dot = d > 1e-3 ? (dx * dir.x + dz * dir.z) / d : 1;
      if (d > 0.7 && dot < arcCos && !(d < 1.5 + m.radius && dot > -0.15)) continue;
      const c = this.rng.next() < crit;
      const damage = Math.round((dmg[0] + this.rng.next() * (dmg[1] - dmg[0])) * (c ? 2 : 1));
      const k = new THREE.Vector3(dx, 0, dz).normalize();
      if (!Number.isFinite(k.x)) k.copy(dir);
      const killed = m.hit(damage, k, c ? 1.5 : 1);
      hits.push({ monster: m, damage, crit: c, killed });
    }
    return hits;
  }

  /** Loot someone is standing on (≥ 0.9 s after it dropped, within the 2.5-tile magnet). */
  collect(dt: number, farmers: { id: number; pos: THREE.Vector3; targetable: boolean }[]): { rec: LootRec; who: number }[] {
    const out: { rec: LootRec; who: number }[] = [];
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i]!;
      l.t += dt;
      if (l.t < 0.9) continue;
      let best = 2.5;
      let who = -1;
      for (const f of farmers) {
        if (!f.targetable) continue;
        const d = Math.hypot(f.pos.x - l.x, f.pos.z - l.z);
        if (d < best) {
          best = d;
          who = f.id;
        }
      }
      if (who < 0) continue;
      this.loot.splice(i, 1);
      out.push({ rec: l, who });
    }
    return out;
  }

  dispose(): void {
    for (const m of this.monsters) m.dispose();
    this.monsters.length = 0;
  }
}

// ─────────────────────────────────────────────────────────── the co-op layer

interface Mirror {
  samples: { t: number; x: number; y: number; z: number; yaw: number }[];
  seen: number;
}

export class MineCoop implements MineNetApi {
  private role: Role = 'solo';
  private peers = new Map<number, Peer>();
  private floors = new Map<number, FloorState>();
  private tick = 0;
  private seed = 0;
  private hostSeed: number | null = null;
  private numbers: DamageNumbers;
  private arcs: SlashArc[] = [];
  private arcNext = 0;
  private mirrors = new Map<number, Mirror>();
  private others = new Map<number, { floor: number; pos: THREE.Vector3; alive: boolean }>();
  private lastFloor = -2;
  private msgsIn = 0;
  private msgsOut = 0;
  private hurtsOut = 0;
  private hurtsIn = 0;
  readonly hooks: MineHooks;

  constructor(private game: Game) {
    this.numbers = new DamageNumbers(game.opts.uiRoot);
    for (let i = 0; i < 3; i++) {
      const a = new SlashArc();
      game.scene.add(a.mesh);
      this.arcs.push(a);
    }
    this.hooks = {
      beforeFloor: (old) => this.beforeFloor(old),
      afterFloor: (n) => this.afterFloor(n),
      rock: (idx, hp, broke, drops, striker) => this.onRock(idx, hp, broke, drops, striker),
      rockIntent: (tx, tz, power) => this.toHost(['m.rk', this.myFloor(), tx, tz, power]),
      strikeIntent: (o, d, bonk) => this.toHost(['m.sw', this.myFloor(), cm(o.x), cm(o.z), Math.round(d.x * 100), Math.round(d.z * 100), bonk ? -1 : this.swordTier()]),
      hits: (striker, hits, origin) => this.onHits(this.myFloor(), striker, hits, origin),
      drops: (drops) => this.toFloor(this.myFloor(), ['m.dr', this.myFloor(), packDrops(drops)]),
      ladder: (x, z) => this.onLadder(this.myFloor(), x, z),
      shoot: (from, dir) => this.toFloor(this.myFloor(), ['m.fb', this.myFloor(), cm(from.x), cm(from.y), cm(from.z), Math.round(dir.x * 100), Math.round(dir.z * 100)]),
      hurt: (target, dmg, x, z, kind) => {
        this.hurtsOut++;
        this.send(target, ['m.hurt', dmg, cm(x), cm(z), kind]);
      },
    };
    game.provide('mineNet', this);
    game.events.on('net:ext', ({ from, data }) => this.receive(from, data));
    game.events.on('map:change', () => this.attach());
    game.events.on('mine:floor', () => this.announce());
    // The host's own pick / sword swings play on everyone else's screen on that floor.
    game.events.on('combat:strike', (e) => {
      const f = this.myFloor();
      if (this.role === 'host' && f > 0) this.toFloor(f, ['m.swg', f, this.myId(), cm(e.x), cm(e.z), Math.round(e.dx * 100), Math.round(e.dz * 100)]);
    });
    game.events.on('tool:swing', ({ tool }) => {
      const f = this.myFloor();
      if (tool === 'pickaxe' && this.role === 'host' && f > 0) this.toFloor(f, ['m.pk', f, this.myId()]);
    });
    game.events.on('day:start', () => {
      for (const st of this.floors.values()) st.headless?.dispose();
      this.floors.clear();
    });
  }

  // ─────────────────────────────── plumbing

  private net(): NetLike | null {
    return (this.game.services.net as unknown as NetLike | undefined) ?? null;
  }

  /** Wire link, installed by the net layer's bridge (net/bridge.ts) when a session starts. */
  private link: { send(to: number | '*' | 'host', d: unknown[]): void } | null = null;

  setLink(link: { send(to: number | '*' | 'host', d: unknown[]): void } | null): void {
    this.link = link;
  }

  private send(to: number | '*' | 'host', d: unknown[]): void {
    if (!this.link || this.role === 'solo') return;
    this.msgsOut++;
    this.link.send(to, d);
  }

  private toHost(d: unknown[]): void {
    this.send('host', d);
  }

  /** Host: send to every farmhand on `floor`. */
  private toFloor(floor: number, d: unknown[], except = -1): void {
    if (this.role !== 'host') return;
    for (const p of this.peers.values()) if (p.floor === floor && p.id !== except) this.send(p.id, d);
  }

  private mine(): MineMap | null {
    const m = this.game.world.current;
    return m instanceof MineMap ? m : null;
  }

  /** This machine's mine floor (0 = entrance, -1 = elsewhere). */
  private myFloor(): number {
    const id = this.game.world.current?.id;
    if (id === 'mine-entrance') return 0;
    const m = this.mine();
    return m ? m.floor : -1;
  }

  private myId(): number {
    return this.net()?.myId() ?? 0;
  }

  private swordTier(): number {
    const t = (this.game.services.health as unknown as { tier?: number } | undefined)?.tier;
    return typeof t === 'number' ? t : 0;
  }

  private mineSeed(): number {
    return this.game.rng.fork('mine').seed;
  }

  // ─────────────────────────────── api

  sameFloor(id: number): boolean {
    const mine = this.myFloor();
    if (mine < 1) return true;
    return this.floorOf(id) === mine;
  }

  floorOf(id: number): number {
    if (this.role === 'host') return this.peers.get(id)?.floor ?? -1;
    return this.others.get(id)?.floor ?? -1;
  }

  stats(): ReturnType<MineNetApi['stats']> {
    return {
      role: this.role,
      floors: [...this.floors.keys()],
      headless: [...this.floors.values()].filter((f) => f.headless).map((f) => f.floor),
      peers: this.peers.size,
      mirrors: this.mirrors.size,
      msgsIn: this.msgsIn,
      msgsOut: this.msgsOut,
      hurtsOut: this.hurtsOut,
      hurtsIn: this.hurtsIn,
    };
  }

  // ─────────────────────────────── attach / roles

  /** (Re)bind to the current mine map with this machine's role. */
  private attach(): void {
    const m = this.mine();
    if (!m) return;
    if (this.role === 'solo') {
      m.hooks = null;
      m.puppet = false;
      m.remotes = [];
      return;
    }
    m.hooks = this.hooks;
    m.localId = this.myId();
    m.strikerId = this.myId();
    // Host: loot a farmhand vacuumed up goes to their backpack; everyone removes it.
    m.onRemoteLoot = (who, id, qty, net) => {
      if (this.role !== 'host') return;
      this.send(who, ['m.give', id, qty]);
      this.toFloor(m.floor, ['m.lt', m.floor, net, who]);
    };
    m.onLocalLoot = (_id, _qty, net) => {
      if (this.role === 'host') this.toFloor(m.floor, ['m.lt', m.floor, net, this.myId()]);
    };
    if (this.role === 'client') {
      if (this.hostSeed !== null && m.seed !== this.hostSeed) {
        m.seed = this.hostSeed;
        m.puppet = true;
        m.setFloor(m.floor, true);
      } else if (!m.puppet) {
        m.puppet = true;
        this.clearMonsters(m);
      }
      this.toHost(['m.need', m.floor]);
    } else {
      m.puppet = false;
      this.hostArrive(m.floor, m);
    }
  }

  private clearMonsters(m: MineMap): void {
    for (const mo of [...m.monsters]) m.removeMonster(mo);
    this.mirrors.clear();
  }

  private announce(): void {
    if (this.role === 'solo') return;
    this.lastFloor = -2;
    this.sendPos();
  }

  private beforeFloor(old: number): void {
    if (this.role !== 'host') return;
    const m = this.mine();
    const st = this.floors.get(old);
    if (!m || !st) return;
    // Others stay down there: the floor keeps running headless on the host.
    if ([...this.peers.values()].some((p) => p.floor === old)) {
      const h = new Headless(old, this.mineSeed(), st);
      for (const mo of m.monsters) if (mo.alive) h.addMonster(mo.kind, mo.pos.x, mo.pos.z, mo.netId, mo.hp);
      for (const it of m.pickups.items) h.loot.push({ net: it.net, id: it.id, qty: it.qty, x: it.pos.x, y: 0, z: it.pos.z, t: 1 });
      this.wireHeadless(h);
      st.headless = h;
    } else this.floors.delete(old);
  }

  private afterFloor(n: number): void {
    const m = this.mine();
    if (!m) return;
    if (this.role === 'client') {
      this.mirrors.clear();
      this.toHost(['m.need', n]);
    } else if (this.role === 'host') this.hostArrive(n, m);
  }

  /** Host walks onto floor n: adopt a headless sim's state if one is running there. */
  private hostArrive(n: number, m: MineMap): void {
    let st = this.floors.get(n);
    if (!st) {
      st = { floor: n, broken: new Set(), hp: new Map(), ladder: null, headless: null };
      this.floors.set(n, st);
      return;
    }
    const h = st.headless;
    m.removeRocks([...st.broken]);
    for (const [idx, hp] of st.hp) {
      const r = m.rockAt(idx % FLOOR_W, Math.floor(idx / FLOOR_W));
      if (r) r.hp = hp;
    }
    if (st.ladder) m.revealLadder(st.ladder.x, st.ladder.z, true);
    if (!h) return;
    for (const mo of [...m.monsters]) m.removeMonster(mo);
    for (const mo of h.monsters) {
      if (!mo.alive) continue;
      const nm = m.addMonster(mo.kind, mo.pos.x, mo.pos.z, undefined, undefined, mo.netId);
      nm.hp = mo.hp;
    }
    for (const l of h.loot) m.spawnDrop(l.id, new THREE.Vector3(l.x, 0, l.z), l.qty, 0, l.net, new THREE.Vector3(0, 0.5, 0));
    h.dispose();
    st.headless = null;
  }

  private wireHeadless(h: Headless): void {
    const f = h.floor;
    h.onAttack = (who, dmg, x, z, kind) => {
      if (who === this.myId()) return;
      this.hurtsOut++;
      this.send(who, ['m.hurt', dmg, cm(x), cm(z), kind]);
    };
    h.onShoot = (from, dir) => this.toFloor(f, ['m.fb', f, cm(from.x), cm(from.y + 0.6), cm(from.z), Math.round(dir.x * 100), Math.round(dir.z * 100)]);
    h.onDrops = (d) => this.toFloor(f, ['m.dr', f, packDrops(d)]);
    h.onLadder = (x, z) => this.toFloor(f, ['m.ld', f, x, z]);
  }

  // ─────────────────────────────── frame

  update(dt: number, time: number): void {
    const role = this.net()?.role() ?? 'solo';
    if (role !== this.role) {
      this.role = role;
      this.peers.clear();
      this.others.clear();
      for (const st of this.floors.values()) st.headless?.dispose();
      this.floors.clear();
      this.hostSeed = null;
      setPendingMineSeed(null);
      this.attach();
    }
    this.numbers.update(dt, this.game.rc.camera, window.innerWidth, window.innerHeight);
    for (const a of this.arcs) a.update(dt);
    if (this.role === 'solo') return;
    const m = this.mine();
    if (this.role === 'host') this.hostFrame(dt, time, m);
    else this.clientFrame(dt, m);
    this.tick += dt;
    if (this.tick >= TICK) {
      this.tick %= TICK;
      if (this.role === 'client') this.sendPos();
      else this.hostTick(m);
    }
  }

  private sendPos(): void {
    if (this.role !== 'client') return;
    const p = this.game.player.position;
    const f = this.myFloor();
    const alive = (this.game.services.health?.value() ?? 1) > 0 && (this.mine()?.playerTargetable ?? true);
    if (f < 0 && this.lastFloor === f) return;
    this.lastFloor = f;
    this.toHost(['m.p', f, cm(p.x), cm(p.z), alive ? 1 : 0]);
  }

  private farmersOn(floor: number): { id: number; pos: THREE.Vector3; targetable: boolean }[] {
    const out: { id: number; pos: THREE.Vector3; targetable: boolean }[] = [];
    for (const p of this.peers.values()) if (p.floor === floor) out.push({ id: p.id, pos: p.pos, targetable: p.alive });
    return out;
  }

  private hostFrame(dt: number, time: number, m: MineMap | null): void {
    if (m) m.remotes = this.farmersOn(m.floor);
    for (const st of this.floors.values()) {
      const h = st.headless;
      if (!h) continue;
      const farmers = this.farmersOn(st.floor);
      h.update(this.game.paused ? 0 : dt, time, farmers);
      for (const { rec, who } of h.collect(dt, farmers)) {
        this.send(who, ['m.give', rec.id, rec.qty]);
        this.toFloor(st.floor, ['m.lt', st.floor, rec.net, who]);
      }
    }
  }

  private hostTick(m: MineMap | null): void {
    const me = this.myId();
    const p = this.game.player.position;
    const myF = this.myFloor();
    // Everyone learns who is on which floor (+ where: loot flies to the nearest farmer).
    const rows: [number, number, number, number, number][] = [[me, myF, cm(p.x), cm(p.z), m?.playerTargetable === false ? 0 : 1]];
    for (const q of this.peers.values()) rows.push([q.id, q.floor, cm(q.pos.x), cm(q.pos.z), q.alive ? 1 : 0]);
    for (const q of this.peers.values()) if (q.floor >= 0) this.send(q.id, ['m.pl', rows]);
    // Drop floors nobody stands on any more (they reset, as in solo play).
    for (const [f, st] of this.floors) {
      if (f === myF && m) continue;
      if (![...this.peers.values()].some((q) => q.floor === f)) {
        st.headless?.dispose();
        this.floors.delete(f);
      }
    }
    // Monster snapshots per occupied floor.
    for (const [f, st] of this.floors) {
      if (![...this.peers.values()].some((q) => q.floor === f)) continue;
      const list = st.headless ? st.headless.monsters : f === myF && m ? m.monsters : [];
      const snap = list.filter((mo) => mo.alive).map((mo) => [mo.netId, KINDS.indexOf(mo.kind), cm(mo.pos.x), cm(mo.pos.y - (st.headless ? 0 : m!.heightAt(mo.pos.x, mo.pos.z))), cm(mo.pos.z), Math.round(mo.root.rotation.y * 100), Math.round(mo.hp), Math.round(mo.maxHp)]);
      this.toFloor(f, ['m.ms', f, snap]);
    }
  }

  private clientFrame(dt: number, m: MineMap | null): void {
    if (!m) return;
    m.puppet = true;
    // Other farmers on my floor pull loot visually (the host decides who got it).
    const rem: { id: number; pos: THREE.Vector3; targetable: boolean }[] = [];
    for (const [id, o] of this.others) if (o.floor === m.floor && id !== this.myId()) rem.push({ id, pos: o.pos, targetable: o.alive });
    m.remotes = rem;
    // Mirrors: interpolate the host's snapshots ~120 ms behind.
    const now = performance.now() / 1000 - INTERP;
    for (const mo of m.monsters) {
      const mi = this.mirrors.get(mo.netId);
      if (!mi || !mi.samples.length || mo.dying >= 0) continue;
      const s = mi.samples;
      let a = s[0]!;
      let b = s[s.length - 1]!;
      for (let i = 0; i < s.length - 1; i++)
        if (s[i]!.t <= now && s[i + 1]!.t >= now) {
          a = s[i]!;
          b = s[i + 1]!;
          break;
        }
      const k = b.t > a.t ? THREE.MathUtils.clamp((now - a.t) / (b.t - a.t), 0, 1) : 1;
      const x = a.x + (b.x - a.x) * k;
      const z = a.z + (b.z - a.z) * k;
      mo.pos.set(x, m.heightAt(x, z) + a.y + (b.y - a.y) * k, z);
      let dy = b.yaw - a.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      mo.mirrorYaw(a.yaw + dy * k);
    }
    // A mirror the host stopped reporting (and that is not mid-death) goes away.
    const t = performance.now() / 1000;
    for (const mo of [...m.monsters]) {
      const mi = this.mirrors.get(mo.netId);
      if (mo.dying >= 0) continue;
      if (!mi || t - mi.seen > 0.8) {
        m.removeMonster(mo);
        this.mirrors.delete(mo.netId);
      }
    }
    void dt;
  }

  // ─────────────────────────────── host verdict hooks (live floor)

  private onRock(idx: number, hp: number, broke: boolean, drops: DropInfo[], striker: number): void {
    if (this.role !== 'host') return;
    const f = this.myFloor();
    const st = this.floors.get(f);
    if (st) {
      if (broke) {
        st.broken.add(idx);
        st.hp.delete(idx);
      } else st.hp.set(idx, hp);
    }
    this.toFloor(f, ['m.rs', f, idx, hp, broke ? 1 : 0, striker, packDrops(drops)]);
  }

  private onLadder(f: number, x: number, z: number): void {
    if (this.role !== 'host') return;
    const st = this.floors.get(f);
    if (st) st.ladder = { x, z };
    this.toFloor(f, ['m.ld', f, x, z]);
  }

  private onHits(f: number, striker: number, hits: StrikeHit[], origin: THREE.Vector3): void {
    if (this.role !== 'host') return;
    const rows = hits.map((h) => {
      const k = new THREE.Vector3(h.monster.pos.x - origin.x, 0, h.monster.pos.z - origin.z).normalize();
      return [h.monster.netId, h.damage, h.crit ? 1 : 0, h.killed ? 1 : 0, Math.round((k.x || 0) * 100), Math.round((k.z || 0) * 100)];
    });
    this.toFloor(f, ['m.hit', f, striker, cm(origin.x), cm(origin.z), rows]);
    if (striker !== this.myId()) this.popHits(this.mine(), hits.map((h) => ({ mo: h.monster, dmg: h.damage, crit: h.crit })), origin);
  }

  // ─────────────────────────────── receive

  /** A relayed 'm.*' payload (from the bridge). */
  receive(from: number, d: unknown[]): void {
    const kind = d[0];
    if (typeof kind !== 'string' || !kind.startsWith('m.')) return;
    this.msgsIn++;
    try {
      if (this.role === 'host') this.hostMsg(from, kind, d);
      else if (this.role === 'client') this.clientMsg(kind, d);
    } catch (err) {
      console.error('[mine-net] bad message', kind, err);
    }
  }

  private hostMsg(from: number, kind: string, d: unknown[]): void {
    let p = this.peers.get(from);
    if (kind === 'm.p') {
      const [, floor, x, z, alive] = d as [string, number, number, number, number];
      if (!p) {
        p = { id: from, floor: -1, pos: new THREE.Vector3(), alive: true, seen: 0, seeded: false };
        this.peers.set(from, p);
      }
      if (!p.seeded) {
        p.seeded = true;
        this.send(from, ['m.seed', this.mineSeed()]);
      }
      p.pos.set(x / 100, 0, z / 100);
      p.alive = alive === 1;
      p.seen = performance.now();
      if (floor !== p.floor) {
        p.floor = floor;
        if (floor > 0) this.ensureFloor(floor);
      }
      return;
    }
    if (!p) return;
    const myF = this.myFloor();
    const m = this.mine();
    switch (kind) {
      case 'm.need': {
        const f = Number(d[1]);
        if (f > 0) {
          p.floor = f;
          this.ensureFloor(f);
          this.sendFull(from, f);
        }
        return;
      }
      case 'm.rk': {
        const [, f, tx, tz, power] = d as [string, number, number, number, number];
        if (f !== p.floor || Math.hypot(p.pos.x - (tx + 0.5), p.pos.z - (tz + 0.5)) > 2.6) return;
        const pw = Math.max(1, Math.min(6, Math.floor(power)));
        const idx = tz * FLOOR_W + tx;
        this.toFloor(f, ['m.pk', f, from], from);
        this.remoteAnim(from, 'pick');
        if (f === myF && m) {
          m.striker = p.pos;
          m.strikerId = from;
          m.strikeRock(tx, tz, pw);
          m.striker = null;
          m.strikerId = this.myId();
        } else {
          const h = this.floors.get(f)?.headless;
          const res = h?.strikeRock(idx, pw);
          if (res) this.toFloor(f, ['m.rs', f, idx, res.hp, res.broke ? 1 : 0, from, packDrops(res.drops)]);
        }
        return;
      }
      case 'm.sw': {
        const [, f, ox, oz, dx, dz, tier] = d as [string, number, number, number, number, number, number];
        if (f !== p.floor) return;
        const origin = new THREE.Vector3(ox / 100, 0, oz / 100);
        if (origin.distanceTo(p.pos.clone().setY(0)) > 2) origin.copy(p.pos).setY(0);
        const dir = new THREE.Vector3(dx / 100, 0, dz / 100).normalize();
        // tier -1 = a pickaxe bonk (short reach, light damage), else the sword tier.
        const bonk = tier < 0;
        const t = Math.max(0, Math.min(SWORD_TIERS.length - 1, Math.floor(tier)));
        const reach = bonk ? 1.35 : SWORD_REACH + t * 0.12;
        const arc = bonk ? 0.5 : SWORD_ARC_COS;
        const dmg: [number, number] = bonk ? [3, 5] : SWORD_TIERS[t]!.dmg;
        const crit = bonk ? 0 : SWORD_CRIT;
        if (!bonk) {
          this.toFloor(f, ['m.swg', f, from, ox, oz, dx, dz], from);
          this.remoteAnim(from, 'sword', dir);
        }
        if (f === myF && m) {
          if (!bonk) this.arcAt(origin.clone().setY(m.heightAt(origin.x, origin.z)), dir);
          m.striker = p.pos;
          m.strikerId = from;
          m.strike(origin, dir, reach, arc, dmg, crit);
          m.striker = null;
          m.strikerId = this.myId();
        } else {
          const h = this.floors.get(f)?.headless;
          if (!h) return;
          const hits = h.strike(origin, dir, reach, arc, dmg, crit);
          if (hits.length) this.onHits(f, from, hits, origin);
        }
        return;
      }
    }
  }

  /** Host: make sure an occupied floor has a record (+ a headless sim if the host isn't on it). */
  private ensureFloor(f: number): FloorState {
    let st = this.floors.get(f);
    if (!st) {
      st = { floor: f, broken: new Set(), hp: new Map(), ladder: null, headless: null };
      this.floors.set(f, st);
    }
    if (f !== this.myFloor() && !st.headless) {
      const h = new Headless(f, this.mineSeed(), st);
      h.spawnLayoutMonsters();
      this.wireHeadless(h);
      st.headless = h;
    }
    return st;
  }

  private sendFull(to: number, f: number): void {
    const st = this.floors.get(f)!;
    const m = this.mine();
    const live = f === this.myFloor() && m ? m : null;
    const mons = (st.headless ? st.headless.monsters : live ? live.monsters : [])
      .filter((mo) => mo.alive)
      .map((mo) => [mo.netId, KINDS.indexOf(mo.kind), cm(mo.pos.x), 0, cm(mo.pos.z), Math.round(mo.root.rotation.y * 100), Math.round(mo.hp), Math.round(mo.maxHp)]);
    const loot = st.headless ? st.headless.loot.map((l) => [l.net, l.id, l.qty, cm(l.x), cm(l.z)]) : live ? live.pickups.items.map((l) => [l.net, l.id, l.qty, cm(l.pos.x), cm(l.pos.z)]) : [];
    const ladder = st.ladder ?? (live?.ladderDown ? { ...live.ladderDown } : null);
    this.send(to, ['m.seed', this.mineSeed()]);
    this.send(to, ['m.full', f, { broken: [...st.broken], hp: [...st.hp], ladder: ladder ? [ladder.x, ladder.z] : null, loot, mons }]);
  }

  private clientMsg(kind: string, d: unknown[]): void {
    const m = this.mine();
    const myF = this.myFloor();
    switch (kind) {
      case 'm.seed': {
        const seed = Number(d[1]) >>> 0;
        if (seed === this.hostSeed) return;
        this.hostSeed = seed;
        setPendingMineSeed(seed);
        if (m && m.seed !== seed) {
          m.seed = seed;
          m.setFloor(m.floor, true);
        }
        return;
      }
      case 'm.pl': {
        const rows = d[1] as [number, number, number, number, number][];
        const seen = new Set<number>();
        for (const [id, floor, x, z, alive] of rows) {
          seen.add(id);
          let o = this.others.get(id);
          if (!o) this.others.set(id, (o = { floor, pos: new THREE.Vector3(), alive: true }));
          o.floor = floor;
          o.pos.set(x / 100, 0, z / 100);
          o.alive = alive === 1;
        }
        for (const id of [...this.others.keys()]) if (!seen.has(id)) this.others.delete(id);
        return;
      }
    }
    switch (kind) {
      case 'm.give': {
        const [, id, qty] = d as [string, string, number];
        mineSfx.blip();
        this.game.events.emit('item:give', { itemId: id, qty });
        this.game.events.emit('mine:pickup', { itemId: id, qty });
        return;
      }
      case 'm.hurt': {
        const [, dmg, x, z, k] = d as [string, number, number, number, MonsterKind | 'lava'];
        this.hurtsIn++;
        this.game.events.emit('combat:playerHit', { damage: dmg, x: x / 100, z: z / 100, kind: k });
        return;
      }
    }
    // Everything below is about one floor: ignore other floors' news.
    if (!m || Number(d[1]) !== myF) return;
    switch (kind) {
      case 'm.full': {
        const s = d[2] as { broken: number[]; hp: [number, number][]; ladder: [number, number] | null; loot: [number, string, number, number, number][]; mons: number[][] };
        m.removeRocks(s.broken);
        for (const [idx, hp] of s.hp) {
          const r = m.rockAt(idx % FLOOR_W, Math.floor(idx / FLOOR_W));
          if (r) r.hp = hp;
        }
        if (s.ladder && !m.ladderDown) m.revealLadder(s.ladder[0], s.ladder[1], true);
        m.pickups.clear();
        for (const [net, id, qty, x, z] of s.loot) m.spawnDrop(id, new THREE.Vector3(x / 100, m.heightAt(x / 100, z / 100), z / 100), qty, 0, net, new THREE.Vector3(0, 0.5, 0));
        this.clearMonsters(m);
        this.snapshot(m, s.mons);
        return;
      }
      case 'm.ms':
        this.snapshot(m, d[2] as number[][]);
        return;
      case 'm.rs': {
        const [, , idx, hp, broke, striker, drops] = d as [string, number, number, number, number, number, number[][]];
        const who = striker === this.myId() ? null : (this.others.get(striker)?.pos ?? null);
        m.applyRock(idx, hp, broke === 1, unpackDrops(drops, m), who ?? (striker === this.myId() ? this.game.player.position : null));
        return;
      }
      case 'm.dr':
        for (const dr of unpackDrops(d[2] as number[][], m)) m.spawnDrop(dr.id, new THREE.Vector3(dr.x, dr.y, dr.z), dr.qty, 1, dr.net, new THREE.Vector3(dr.vx, dr.vy, dr.vz));
        return;
      case 'm.lt': {
        const [, , net, who] = d as [string, number, number, number];
        const target = who === this.myId() ? this.game.player.position : this.others.get(who)?.pos;
        m.pickups.take(net, target);
        return;
      }
      case 'm.ld': {
        const [, , x, z] = d as [string, number, number, number];
        if (!m.ladderDown) m.revealLadder(x, z, true);
        return;
      }
      case 'm.hit': {
        const [, , striker, ox, oz, rows] = d as [string, number, number, number, number, number[][]];
        const origin = new THREE.Vector3(ox / 100, 0, oz / 100);
        const shown: { mo: Monster; dmg: number; crit: boolean }[] = [];
        let kill = false;
        for (const [id, dmg, crit, killed, kx, kz] of rows as [number, number, number, number, number, number][]) {
          const mo = m.monsters.find((x) => x.netId === id);
          if (!mo) continue;
          const k = new THREE.Vector3(kx / 100, 0, kz / 100);
          mo.hitFx(k, killed === 1);
          kill ||= killed === 1;
          shown.push({ mo, dmg, crit: crit === 1 });
          const at = mo.pos.clone().setY(mo.pos.y + 0.4);
          m.fx.sparks(at, { color: 0xffffff, to: crit ? 0xffc040 : 0xffe8c0, count: crit ? 18 : 10, speed: crit ? 5 : 3.6, up: 0.8, size: crit ? 0.14 : 0.1, gravity: 4, drag: 3, life: 0.28, dir: k, cone: 0.4 });
          if (mo.kind === 'slime') m.fx.puff(at, { color: 0x7ed957, count: 10, speed: 2.6, up: 1.2, size: 0.16, gravity: 9, drag: 1, life: 0.6, dir: k, cone: 0.5 });
          if (killed === 1) m.fx.splat(mo.pos, new THREE.Color(mo.kind === 'slime' ? 0x5fa840 : 0x3a302c), mo.kind === 'slime' ? 0.95 : 0.7, 6);
          mineSfx.hitFlesh(crit === 1);
        }
        this.popHits(m, shown, origin);
        if (striker === this.myId() && shown.length) {
          this.game.rc.rig.addShake(kill ? 0.22 : 0.14);
          if (kill) m.freeze(0.06);
        }
        return;
      }
      case 'm.fb': {
        const [, , x, y, z, dx, dz] = d as [string, number, number, number, number, number, number];
        m.shoot('imp', new THREE.Vector3(x / 100, y / 100, z / 100), new THREE.Vector3(dx / 100, 0, dz / 100), 0);
        return;
      }
      case 'm.swg': {
        const [, , who, ox, oz, dx, dz] = d as [string, number, number, number, number, number, number];
        const dir = new THREE.Vector3(dx / 100, 0, dz / 100).normalize();
        this.arcAt(new THREE.Vector3(ox / 100, m.heightAt(ox / 100, oz / 100), oz / 100), dir);
        this.remoteAnim(who, 'sword', dir);
        return;
      }
      case 'm.pk':
        this.remoteAnim(Number(d[2]), 'pick');
        return;
    }
  }

  /** Farmhand: apply a monster snapshot (spawn missing mirrors, queue samples). */
  private snapshot(m: MineMap, rows: number[][]): void {
    const t = performance.now() / 1000;
    for (const r of rows) {
      const [id, k, x, y, z, yaw, hp, max] = r as [number, number, number, number, number, number, number, number];
      let mo = m.monsters.find((q) => q.netId === id);
      if (!mo) {
        const kind = KINDS[k] ?? 'slime';
        mo = m.addMonster(kind, x / 100, z / 100, undefined, undefined, id);
        mo.maxHp = max;
      }
      if (mo.dying >= 0) continue;
      mo.hp = hp;
      let mi = this.mirrors.get(id);
      if (!mi) this.mirrors.set(id, (mi = { samples: [], seen: t }));
      mi.seen = t;
      mi.samples.push({ t, x: x / 100, y: y / 100, z: z / 100, yaw: yaw / 100 });
      if (mi.samples.length > 6) mi.samples.shift();
    }
  }

  // ─────────────────────────────── visuals for other farmers' actions

  private popHits(m: MineMap | null, hits: { mo: Monster; dmg: number; crit: boolean }[], origin: THREE.Vector3): void {
    if (!m) return;
    hits.forEach((h, i) => {
      const at = new THREE.Vector3();
      h.mo.headPos(at);
      at.y -= h.mo.kind === 'bat' || h.mo.kind === 'wisp' ? 0.25 : 0.45;
      const dx = h.mo.pos.x - origin.x;
      const dz = h.mo.pos.z - origin.z;
      const d = Math.hypot(dx, dz) || 1;
      at.x += (dx / d) * h.mo.radius * 0.6;
      this.numbers.pop(at, String(h.dmg), h.crit ? 'crit' : 'dmg', { dy: -i * 30 });
    });
  }

  private arcAt(pos: THREE.Vector3, dir: THREE.Vector3): void {
    const a = this.arcs[this.arcNext]!;
    this.arcNext = (this.arcNext + 1) % this.arcs.length;
    const f = Math.abs(dir.x) > Math.abs(dir.z) ? new THREE.Vector3(Math.sign(dir.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(dir.z) || 1);
    a.fire(pos, f, Math.random() < 0.5 ? 1 : -1);
    setTimeout(() => a.impact(false, true), 80);
    mineSfx.whoosh();
  }

  private remoteAnim(id: number, what: 'pick' | 'sword', dir?: THREE.Vector3): void {
    const r = this.net()?.remotes?.get(id);
    if (!r) return;
    if (dir) r.farmer.setFacingYaw(Math.atan2(dir.x, dir.z));
    try {
      r.farmer.act(what === 'pick' ? 'chop' : 'sweep', what === 'pick' ? 'pickaxe' : null);
    } catch {
      /* rig without that action */
    }
  }

  dispose(): void {
    for (const st of this.floors.values()) st.headless?.dispose();
    this.floors.clear();
    this.numbers.clear();
  }
}

function packDrops(d: DropInfo[]): number[][] {
  return d.map((x) => [x.net, ITEM_CODES.indexOf(x.id) >= 0 ? ITEM_CODES.indexOf(x.id) : -1, x.qty, cm(x.x), cm(x.y), cm(x.z), cm(x.vx), cm(x.vy), cm(x.vz), ...(ITEM_CODES.indexOf(x.id) >= 0 ? [] : [x.id as unknown as number])]);
}

function unpackDrops(rows: number[][], m: MineMap): DropInfo[] {
  return rows.map((r) => {
    const id = r[1]! >= 0 ? ITEM_CODES[r[1]!]! : String(r[9]);
    const x = r[3]! / 100;
    const z = r[5]! / 100;
    return { net: r[0]!, id, qty: r[2]!, x, y: Math.max(r[4]! / 100, m.heightAt(x, z)), z, vx: r[6]! / 100, vy: r[7]! / 100, vz: r[8]! / 100 };
  });
}

/** Loot ids with a compact wire code (anything else travels as its string). */
const ITEM_CODES = ['stone', 'coal', 'copperOre', 'ironOre', 'goldOre', 'quartz', 'amethyst', 'topaz', 'aquamarine', 'frostShard', 'ruby', 'emberOpal', 'diamond', 'slimeGel', 'duskWing', 'crabCarapace'];

void FLOOR_D;
