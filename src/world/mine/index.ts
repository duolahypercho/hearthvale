/**
 * The Hollowdeep: one GameMap ('mine') whose contents are rebuilt per floor from a seeded layout
 * (gen.ts): cave shell (cave.ts), set dressing (props.ts), breakable ore rocks (ores.ts), monsters
 * (entities/monsters.ts), loot (pickups.ts), VFX (fx.ts) and the underground lighting takeover
 * (lighting.ts). Systems drive it through the small gameplay API below:
 *
 *   setFloor(n)                     rebuild for floor n (no-op if already there)
 *   strikeRock(tx, tz, power)       pickaxe hit → wobble / chips / break + loot + maybe a ladder
 *   strike(origin, dir, …)          sword arc → monster hits (knockback, flash, goo, drops)
 *   interactAt(tx, tz)              'ladderUp' | 'ladderDown' | 'elevator' | null
 *
 * Tile truth lives in `grid` (walls = Cliff+Blocked, lava = Void+Blocked, rocks = solid objects).
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import type { Facing } from '../../core/events';
import type { GameMap } from '../map';
import { TileGrid, TileType, TileFlag } from '../tiles';
import { Rng } from '../../core/rng';
import { generateFloor, FLOOR_W, FLOOR_D, type FloorLayout } from './gen';
import { buildCave, type CaveBuild } from './cave';
import { buildProps, buildLadderDown, buildChest, FG_FADE, type MineProps } from './props';
import { RockField, oreColor, type MineRock } from './ores';
import { MineFX, glowPoint } from './fx';
import { Pickups, type Collector } from './pickups';
import { CaveLighting } from './lighting';
import { BIOMES, ORE_STYLE, biomeForFloor, type MonsterKind } from './biomes';
import { createMonster, monsterColor, type ArenaCtx, type Monster } from '../../entities/monsters';
import { mineSfx } from './sfx';
import './events';

export interface StrikeHit {
  monster: Monster;
  damage: number;
  crit: boolean;
  killed: boolean;
}

export type MineInteract = 'ladderUp' | 'ladderDown' | 'elevator' | 'chest' | null;

/** A loot drop as it left its source (co-op relays it so every screen shows the same arc). */
export interface DropInfo {
  net: number;
  id: string;
  qty: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** Co-op hooks (set by world/mine/coop.ts; all optional, solo play leaves them null). */
export interface MineHooks {
  /** About to leave floor `old` (host: hand its live state to a headless sim if others stay). */
  beforeFloor?(old: number): void;
  /** Floor `n` was just built (host: adopt a headless sim's state; farmhand: clear + ask). */
  afterFloor?(n: number): void;
  /** Authority: a rock was hit (idx = tile index) or broke with these drops. */
  rock?(idx: number, hp: number, broke: boolean, drops: DropInfo[], striker: number): void;
  /** Farmhand: the local farmer struck a rock (ask the host). */
  rockIntent?(tx: number, tz: number, power: number): void;
  /** Farmhand: the local sword swing reached its impact frame (ask the host). */
  strikeIntent?(origin: THREE.Vector3, dir: THREE.Vector3, bonk: boolean): void;
  /** Authority: a strike landed (striker = collector id of the farmer). */
  hits?(striker: number, hits: StrikeHit[], origin: THREE.Vector3): void;
  /** Authority: monster loot dropped. */
  drops?(drops: DropInfo[]): void;
  /** Authority: the ladder down appeared. */
  ladder?(x: number, z: number): void;
  /** Authority: an imp threw a fireball. */
  shoot?(from: THREE.Vector3, dir: THREE.Vector3): void;
  /** Authority: a monster / fireball / the lava hurt a remote farmer. */
  hurt?(target: number, damage: number, x: number, z: number, kind: MonsterKind | 'lava'): void;
}

/** Loot tables for monsters: [item, chance]. */
export const MONSTER_DROPS: Record<MonsterKind, [string, number][]> = {
  slime: [
    ['slimeGel', 0.75],
    ['slimeGel', 0.25],
  ],
  bat: [
    ['duskWing', 0.55],
    ['coal', 0.15],
  ],
  crab: [
    ['crabCarapace', 0.6],
    ['stone', 0.8],
    ['copperOre', 0.3],
  ],
  wisp: [
    ['frostShard', 0.45],
    ['quartz', 0.25],
  ],
  imp: [
    ['coal', 0.6],
    ['emberOpal', 0.08],
  ],
};

interface Projectile {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  damage: number;
  owner: MonsterKind;
}

/** Floors whose milestone chest has been opened (module-level: survives map rebuilds). */
export const OPENED_CHESTS = new Set<number>();

let pendingFloor = 1;
let pendingSeed: number | null = null;
/** Co-op farmhand: build floors from the host's mine seed (null = this world's own seed). */
export function setPendingMineSeed(seed: number | null): void {
  pendingSeed = seed;
}

/**
 * Loot for a broken rock: 1–2 of its ore, always ≥ 1 stone (+1 on big / 25 % on plain rocks), a
 * little coal outside the earth band. Shared by the live map and the co-op host's headless floors.
 */
export function rollRockLoot(next: () => number, ore: string | null, big: boolean, biome: string): string[] {
  const out: string[] = [];
  if (ore) {
    out.push(ore);
    if (next() < 0.35) out.push(ore);
  }
  out.push('stone');
  if (big || (!ore && next() < 0.25)) out.push('stone');
  if (biome !== 'earth' && next() < 0.06) out.push('coal');
  return out;
}
/** Floor the map builds when it is first constructed (set before the first load). */
export function setPendingMineFloor(n: number): void {
  pendingFloor = Math.max(1, Math.floor(n));
}

export class MineMap implements GameMap {
  readonly id = 'mine';
  title = 'The Hollowdeep';
  readonly grid = new TileGrid(FLOOR_W, FLOOR_D);
  readonly root = new THREE.Group();
  spawn: { x: number; z: number; facing: Facing } = { x: 10, z: 8, facing: 'down' };
  readonly cameraBounds = new THREE.Box2(new THREE.Vector2(6, 5), new THREE.Vector2(FLOOR_W - 6, FLOOR_D - 4));
  floor = 0;
  layout!: FloorLayout;
  monsters: Monster[] = [];
  rocks: RockField | null = null;
  ladderDown: { x: number; z: number } | null = null;
  readonly fx = new MineFX();
  readonly pickups: Pickups;
  readonly lighting: CaveLighting;
  /** Called when loot is vacuumed up (set by the mining system; default: item:give). */
  onPickup: ((id: string, qty: number, at: THREE.Vector3) => void) | null = null;
  /** Co-op: this machine's collector id (0 solo / host). */
  localId = 0;
  /** Co-op: other farmers on this floor (loot collectors + monster targets), set by the net layer. */
  remotes: { id: number; pos: THREE.Vector3; targetable: boolean }[] = [];
  /** Co-op (host): loot collected by a remote farmer. */
  onRemoteLoot: ((who: number, id: string, qty: number, net: number) => void) | null = null;
  /** Co-op: loot collected by this farmer (host broadcasts the removal). */
  onLocalLoot: ((id: string, qty: number, net: number) => void) | null = null;
  /** Co-op farmhand: the host owns loot + monsters (this machine only mirrors them). */
  puppet = false;
  private collectorList: Collector[] = [];
  private localCollector: Collector = { id: 0, pos: new THREE.Vector3() };
  /** Invulnerable / passed-out player: monsters ignore them. */
  playerTargetable = true;
  /** Demo / cutscene: freeze monster AI (they still breathe). */
  freezeAI = false;
  /** Demo arena: monsters keep simulating while the game is paused for a staged shot. */
  live = false;
  /** Demo stills: particles / chunks / rock wobble hold their current frame. */
  freezeFx = false;
  /** Floors whose milestone chest has been opened (saved by the mining system). */
  readonly openedChests = OPENED_CHESTS;
  private chest: { group: THREE.Group; lid: THREE.Object3D; glow: THREE.Mesh; open: number; target: number; x: number; z: number } | null = null;

  private floorGroup = new THREE.Group();
  private cave: CaveBuild | null = null;
  private props: MineProps | null = null;
  private ladderGroup: THREE.Object3D | null = null;
  private dropped = new WeakSet<Monster>();
  private rng = new Rng(1);
  private ventT = 0;
  private sparkleT = 0;
  private ctx: ArenaCtx;
  private active = false;
  private savedCam: { pitch: number; yaw: number; distance: number; off: THREE.Vector3 } | null = null;
  private brokenCount = 0;
  private hazardT = 0;
  /** Position of whoever is striking right now (co-op: a remote farmer); null = the local farmer. */
  striker: THREE.Vector3 | null = null;
  /** Collector id of the striker (co-op), `localId` for the local farmer. */
  strikerId = 0;
  /** Co-op hooks (null in solo play). */
  hooks: MineHooks | null = null;
  /** Seed override (co-op farmhands build the host's floors). */
  seed: number | null = pendingSeed;
  private nextMonsterId = 1;
  /** Who each monster is after this frame (collector id; -1 = nobody). */
  private targetOf = new WeakMap<Monster, number>();
  /** Global hit-stop (s): monsters, projectiles, loot and FX hold for a beat on kills. */
  private stopT = 0;

  /** Freeze the arena for `s` seconds (kill hit-stop). */
  freeze(s: number): void {
    this.stopT = Math.max(this.stopT, s);
  }

  constructor(private game: Game) {
    this.root.name = 'map:mine';
    this.lighting = new CaveLighting(game);
    this.root.add(this.floorGroup, this.fx.group, this.lighting.group);
    this.pickups = new Pickups(
      (x, z) => this.heightAt(x, z),
      (id, qty, at, who, net) => {
        this.fx.sparks(at, { color: 0xfff2c0, count: 6, speed: 1.2, size: 0.12, gravity: 0, drag: 4, life: 0.35, star: true });
        if (who !== this.localId) {
          // Co-op: another farmer vacuumed it (the net layer hands it to them).
          this.onRemoteLoot?.(who, id, qty, net);
          return;
        }
        mineSfx.blip();
        if (this.onPickup) this.onPickup(id, qty, at);
        else game.events.emit('item:give', { itemId: id, qty });
        game.events.emit('mine:pickup', { itemId: id, qty });
        this.onLocalLoot?.(id, qty, net);
      },
    );
    this.root.add(this.pickups.group);
    this.ctx = {
      time: 0,
      player: game.player.position,
      playerTargetable: true,
      walkable: (x, z) => this.grid.isWalkable(x, z),
      flyable: (x, z) => x >= 0 && z >= 0 && x < FLOOR_W && z < FLOOR_D && !this.layout.solid[z * FLOOR_W + x],
      heightAt: (x, z) => this.heightAt(x, z),
      clear: (x, z, r, fly) => this.clearAt(x, z, r, fly),
      onAttack: (m, dmg) => {
        const who = this.targetOf.get(m) ?? this.localId;
        if (who === this.localId) game.events.emit('combat:playerHit', { damage: dmg, x: m.pos.x, z: m.pos.z, kind: m.kind });
        else this.hooks?.hurt?.(who, dmg, m.pos.x, m.pos.z, m.kind);
      },
      puff: (p, color, count, kind) => this.puff(p, color, count, kind),
      shoot: (m, from, dir, damage) => this.shoot(m.kind, from, dir, damage),
      rng: this.rng,
    };
    game.events.on('map:change', ({ map }) => {
      if (map === 'mine') this.activate();
      else this.deactivate();
    });
    this.setFloor(pendingFloor);
  }

  // ───────────────────────────────────────────── floors

  setFloor(n: number, force = false): void {
    n = Math.max(1, Math.floor(n));
    if (n === this.floor && this.cave && !force) return;
    if (this.cave) this.hooks?.beforeFloor?.(this.floor);
    this.live = false;
    this.clearFloor();
    this.floor = n;
    const seed = this.seed ?? this.game.rng.fork('mine').seed;
    const L = generateFloor(n, seed);
    this.layout = L;
    this.rng = new Rng((seed ^ (n * 7919)) >>> 0);
    this.ctx.rng = this.rng;
    const def = BIOMES[L.biome];
    this.title = `The Hollowdeep · ${def.name}`;
    const r = new Rng((seed ^ Math.imul(n, 0x85ebca6b)) >>> 0);

    // Grid truth.
    const g = this.grid;
    g.objects.clear();
    g.forEach((x, z, i) => {
      g.height[i] = 0;
      if (L.solid[i]) {
        g.type[i] = TileType.Cliff;
        g.flags[i] = TileFlag.Blocked | TileFlag.NoPlace;
      } else if (L.lava[i]) {
        g.type[i] = TileType.Void;
        g.flags[i] = TileFlag.Blocked | TileFlag.NoPlace;
      } else {
        g.type[i] = L.biome === 'ice' ? TileType.Stone : TileType.Dirt;
        g.flags[i] = TileFlag.NoPlace;
      }
    });

    this.cave = buildCave(L, r.fork('cave'));
    this.floorGroup.add(this.cave.group);
    this.settle(L);
    this.props = buildProps(L, r.fork('props'), (x, z) => this.cave!.heightAt(x, z), (x, z) => this.cave!.surfaceAt(x, z));
    this.floorGroup.add(this.props.group);
    for (const d of L.decor) if (d.solid) g.setObject(Math.floor(d.x), Math.floor(d.z), { kind: 'prop', id: d.kind, solid: true });
    for (const c of L.crystals) {
      const tx = Math.floor(c.x);
      const tz = Math.floor(c.z);
      if (!L.solid[tz * FLOOR_W + tx]) g.setObject(tx, tz, { kind: 'prop', id: 'crystal', solid: true });
    }
    if (L.elevator) g.setObject(L.elevator.x, L.elevator.z, { kind: 'prop', id: 'elevator', solid: true });
    if (L.chest) {
      const c = buildChest();
      const cx = L.chest.x + 0.5;
      const cz = L.chest.z + 0.5;
      c.group.position.set(cx, this.cave.heightAt(cx, cz), cz);
      const opened = this.openedChests.has(n);
      c.lid.rotation.x = opened ? -1.95 : 0;
      (c.glow.material as THREE.ShaderMaterial).uniforms.uStrength!.value = opened ? 0.8 : 0.0;
      this.floorGroup.add(c.group);
      this.chest = { ...c, open: opened ? 1 : 0, target: opened ? 1 : 0, x: cx, z: cz };
      g.setObject(L.chest.x, L.chest.z, { kind: 'prop', id: 'chest', solid: true });
    }

    this.rocks = new RockField(L, r.fork('rocks'), (x, z) => this.cave!.heightAt(x, z));
    this.floorGroup.add(this.rocks.group);
    for (const rk of this.rocks.rocks) g.setObject(rk.spec.x, rk.spec.z, { kind: 'mineRock', id: rk.spec.ore ?? 'rock', solid: true, hp: rk.hp, data: { ore: rk.spec.ore } });

    const band = Math.floor((n - 1) / 10) % 3;
    for (const m of L.monsters) this.addMonster(m.kind, m.x, m.z, L.tier, band);

    this.spawn = { x: L.spawn.x, z: L.spawn.z, facing: 'down' };
    this.fx.setFloor((x, z) => this.heightAt(x, z), def.motes, def.moteColor);
    this.lighting.configure(def, L.lights);
    this.brokenCount = 0;
    if (this.puppet) {
      // Farmhand: the host owns this floor's monsters (they arrive in its snapshot).
      for (const m of this.monsters) {
        m.root.removeFromParent();
        m.dispose();
      }
      this.monsters = [];
    }
    this.hooks?.afterFloor?.(n);
  }

  /**
   * Keep dressing out of the rock: the shell's wall foot wanders ±0.4 m across the edge tiles, so
   * crystals / lantern posts / glowcaps placed on a wall-edge tile can end up half inside the wall
   * (only their glow showing, floating in the dark). Slide each one within its own tile to where
   * its base sits on the floor (≤ 0.2 m of shell above floor level), drop it if there is no such
   * spot, and move / drop the accent light that belonged to it.
   */
  private settle(L: FloorLayout): void {
    const cave = this.cave!;
    const buried = (x: number, z: number): boolean => cave.surfaceAt(x, z) - cave.heightAt(x, z) > 0.2;
    const slide = (x: number, z: number): [number, number] | null => {
      if (!buried(x, z)) return [0, 0];
      const tx = Math.floor(x);
      const tz = Math.floor(z);
      for (let rr = 0.1; rr <= 0.8; rr += 0.1)
        for (let a = 0; a < 16; a++) {
          const ang = (a / 16) * Math.PI * 2;
          const nx = x + Math.cos(ang) * rr;
          const nz = z + Math.sin(ang) * rr;
          if (Math.floor(nx) !== tx || Math.floor(nz) !== tz) continue;
          if (nx - tx < 0.08 || nx - tx > 0.92 || nz - tz < 0.08 || nz - tz > 0.92) continue;
          if (!buried(nx, nz)) return [nx - x, nz - z];
        }
      return null;
    };
    const moves: { x: number; z: number; d: [number, number] | null }[] = [];
    L.crystals = L.crystals.filter((c) => {
      const d = slide(c.x, c.z);
      moves.push({ x: c.x, z: c.z, d });
      if (!d) return false;
      c.x += d[0];
      c.z += d[1];
      return true;
    });
    L.decor = L.decor.filter((dc) => {
      if (dc.kind !== 'mushrooms' && dc.kind !== 'lanternPost' && dc.kind !== 'post' && dc.kind !== 'crate' && dc.kind !== 'barrel') return true;
      const d = slide(dc.x, dc.z);
      moves.push({ x: dc.x, z: dc.z, d });
      if (!d) return false;
      dc.x += d[0];
      dc.z += d[1];
      return true;
    });
    L.lights = L.lights.filter((l) => {
      let best: (typeof moves)[number] | null = null;
      let bd = 1.2;
      for (const m of moves) {
        const dd = Math.hypot(m.x - l.x, m.z - l.z);
        if (dd < bd) {
          bd = dd;
          best = m;
        }
      }
      if (best) {
        if (!best.d) return false;
        l.x += best.d[0];
        l.z += best.d[1];
      }
      // Never leave a practical light inside the rock mass.
      return cave.surfaceAt(l.x, l.z) - cave.heightAt(l.x, l.z) < Math.max(0.4, l.y - 0.3);
    });
  }

  addMonster(kind: MonsterKind, x: number, z: number, tier = this.layout.tier, band = Math.floor((this.floor - 1) / 10) % 3, netId = 0): Monster {
    const m = createMonster(kind, this.layout.biome, x, z, tier, band, this.rng.int(1, 1e6));
    m.netId = netId || this.nextMonsterId++;
    if (netId >= this.nextMonsterId) this.nextMonsterId = netId + 1;
    m.pos.y = this.heightAt(x, z);
    m.root.position.copy(m.pos);
    this.monsters.push(m);
    this.floorGroup.add(m.root);
    return m;
  }

  /** Remove a monster silently (no drops / kill events): demo staging. */
  removeMonster(m: Monster): void {
    const i = this.monsters.indexOf(m);
    if (i < 0) return;
    this.monsters.splice(i, 1);
    m.root.removeFromParent();
    m.dispose();
  }

  private clearFloor(): void {
    for (const pr of this.projectiles ?? []) pr.mesh.removeFromParent();
    if (this.projectiles) this.projectiles.length = 0;
    for (const m of this.monsters) {
      m.root.removeFromParent();
      m.dispose();
    }
    this.monsters = [];
    this.pickups.clear();
    if (this.ladderGroup) this.ladderGroup.removeFromParent();
    this.chest = null;
    this.ladderGroup = null;
    this.ladderDown = null;
    this.rocks?.dispose();
    this.rocks?.group.removeFromParent();
    this.rocks = null;
    this.props?.dispose();
    this.props?.group.removeFromParent();
    this.props = null;
    this.cave?.dispose();
    this.cave?.group.removeFromParent();
    this.cave = null;
    this.floorGroup.clear();
  }

  // ───────────────────────────────────────────── activation (lighting + camera)

  private activate(): void {
    if (this.active) return;
    this.active = true;
    const rig = this.game.rc.rig;
    this.savedCam = { pitch: rig.pitch, yaw: rig.yaw, distance: rig.distance, off: rig.lookOffset.clone() };
    rig.pitch = 42;
    rig.yaw = 0;
    rig.distance = 17.5;
    rig.lookOffset.set(0, 0, -0.9);
    this.lighting.activate();
  }

  private deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.lighting.deactivate();
    const rig = this.game.rc.rig;
    if (this.savedCam) {
      rig.pitch = this.savedCam.pitch;
      rig.yaw = this.savedCam.yaw;
      rig.distance = this.savedCam.distance;
      rig.lookOffset.copy(this.savedCam.off);
    }
  }

  // ───────────────────────────────────────────── gameplay API

  heightAt(x: number, z: number): number {
    return this.cave ? this.cave.heightAt(x, z) : 0;
  }

  /**
   * A disc of radius r at (x, z) sits on open floor: walkable tiles (flyable for `fly`) and no
   * cave shell raised above the floor under it (walkers) / above bat height (fliers).
   */
  clearAt(x: number, z: number, r: number, fly = false): boolean {
    const cave = this.cave;
    if (!cave) return true;
    const lim = fly ? 1.0 : 0.12;
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const rr = k === 8 ? 0 : r;
      const px = x + Math.cos(a) * rr;
      const pz = z + Math.sin(a) * rr;
      const tx = Math.floor(px);
      const tz = Math.floor(pz);
      if (fly ? !this.ctx.flyable(tx, tz) : !this.grid.isWalkable(tx, tz)) return false;
      if (cave.surfaceAt(px, pz) - cave.heightAt(px, pz) > lim) return false;
    }
    return true;
  }

  rockAt(tx: number, tz: number): MineRock | undefined {
    return this.rocks?.at(tx, tz);
  }

  /**
   * Pickaxe strike on a tile. Returns null if there is no rock there. Authoritative (solo / co-op
   * host): hp, loot, ladder. A co-op farmhand (`puppet`) only predicts the hit FX and asks the host.
   */
  strikeRock(tx: number, tz: number, power = 1): { broke: boolean; ore: string | null; pos: THREE.Vector3 } | null {
    const rock = this.rockAt(tx, tz);
    if (!rock || !this.rocks) return null;
    const ore = rock.spec.ore;
    const pos = rock.pos.clone().setY(rock.pos.y + 0.35);
    if (this.puppet) {
      this.rockHitFx(rock);
      this.hooks?.rockIntent?.(tx, tz, power);
      return { broke: false, ore, pos };
    }
    rock.hp -= power;
    const broke = rock.hp <= 0;
    if (!broke) {
      this.rockHitFx(rock);
      this.hooks?.rock?.(tz * FLOOR_W + tx, rock.hp, false, [], this.strikerId);
      return { broke, ore, pos };
    }
    const drops = this.rockBreakFx(rock, true);
    this.brokenCount++;
    this.game.events.emit('mine:rock', { x: tx, z: tz, ore, floor: this.floor });
    this.hooks?.rock?.(tz * FLOOR_W + tx, 0, true, drops, this.strikerId);
    // Ladder down?
    if (!this.ladderDown) {
      const total = this.layout.rocks.length;
      const left = this.rocks.remaining;
      const done = 1 - left / Math.max(1, total);
      const allDead = this.monsters.every((m) => !m.alive);
      const p = 0.035 + done * done * 0.3 + (allDead ? 0.08 : 0) + (this.brokenCount > 18 ? 0.1 : 0);
      if (this.rng.next() < p || left < total * 0.12) this.revealLadder(tx, tz);
    }
    return { broke, ore, pos };
  }

  /** Hit reaction on a rock: squash + white flash, 8–12 chips, sparks, a dust ring. */
  rockHitFx(rock: MineRock): void {
    if (!this.rocks) return;
    const ore = rock.spec.ore;
    const pos = rock.pos.clone().setY(rock.pos.y + 0.35);
    const def = BIOMES[this.layout.biome];
    const baseCol = new THREE.Color(def.rock[0]!);
    this.rocks.hit(rock);
    const from = this.striker ?? this.game.player.position;
    const dir = new THREE.Vector3(rock.pos.x - from.x, 0, rock.pos.z - from.z).normalize();
    // Every hit: 8–12 tumbling chips flying back towards the miner, sparks, and a dust ring in
    // the biome's floor colour rolling out from the rock's foot.
    this.fx.sparks(pos, { color: 0xffe0a0, to: 0xff7a20, count: ore ? 12 : 8, speed: 3.4, up: 1.0, size: 0.08, gravity: 9, drag: 1.2, life: 0.38 });
    this.fx.shatter(pos, baseCol.clone().multiplyScalar(1.1), 8 + Math.floor(Math.random() * 5), 0.55, dir.clone().negate());
    if (ore) this.fx.shatter(pos, oreColor(ore as never), 2, 0.6, dir.clone().negate());
    const dust = new THREE.Color(def.floor[0]).lerp(new THREE.Color(0xe8dcc8), 0.35);
    this.fx.dustRing(rock.pos.clone().setY(rock.pos.y + 0.1), dust, 12, 2.4, 0.5);
    this.fx.puff(pos, { color: dust, count: 3, speed: 0.6, up: 0.6, size: 0.55, grow: 1.4, gravity: -0.3, drag: 3, life: 0.6, alpha: 0.45 });
    mineSfx.pick(!!ore);
    if (!this.striker) this.game.rc.rig.addShake(0.08);
  }

  /**
   * Break a rock: remove it, burst 20+ lit chunks, dust bloom, scree, flash; `roll` rolls + spawns
   * the loot (authority) and returns it, else the caller spawns the host's drops.
   */
  rockBreakFx(rock: MineRock, roll: boolean): DropInfo[] {
    if (!this.rocks) return [];
    const ore = rock.spec.ore;
    const pos = rock.pos.clone().setY(rock.pos.y + 0.35);
    const def = BIOMES[this.layout.biome];
    const baseCol = new THREE.Color(def.rock[0]!);
    this.rocks.remove(rock);
    this.grid.setObject(rock.spec.x, rock.spec.z, null);
    const big = rock.spec.big;
    const chunkCol = baseCol.clone().multiplyScalar(1.15);
    this.fx.shatter(pos, chunkCol, big ? 26 : 20, big ? 1.2 : 1.0, undefined, true);
    this.fx.dustRing(rock.pos.clone().setY(rock.pos.y + 0.1), new THREE.Color(def.floor[0]).lerp(new THREE.Color(0xe8dcc8), 0.35), 16, 3.2, 0.7);
    this.fx.puff(pos, { color: baseCol.clone().lerp(new THREE.Color(0xe8dcc8), 0.5), count: big ? 12 : 8, speed: 1.4, up: 0.5, size: 0.8, grow: 1.6, gravity: -0.2, drag: 3, life: 1.1, alpha: 0.5 });
    this.fx.sparks(pos.clone().setY(pos.y + 0.1), { color: 0xfff6e0, count: 1, speed: 0, up: 0, size: big ? 2.2 : 1.7, gravity: 0, drag: 0, life: 0.12, alpha: 0.85 });
    this.fx.rubble(rock.pos, baseCol.clone().multiplyScalar(0.9), big ? 6 : 4, big ? 0.55 : 0.42);
    const near = Math.hypot(rock.pos.x - this.game.player.position.x, rock.pos.z - this.game.player.position.z) < 6;
    if (near) this.game.rc.rig.addShake(big ? 0.3 : this.striker ? 0.08 : 0.18);
    mineSfx.crumble(big);
    const drops: DropInfo[] = [];
    if (ore) {
      const oc = oreColor(ore as never);
      const bright = oc.clone().lerp(new THREE.Color(0xffffff), 0.45);
      this.fx.shatter(pos, oc, 5, 1.1, undefined, true);
      // Ore burst: a 0.3 s additive star in the ore colour + a spray of glints.
      this.fx.sparks(pos.clone().setY(pos.y + 0.25), { color: bright, count: 2, speed: 0.05, up: 0, size: 1.5, gravity: 0, drag: 0, life: 0.3, star: true });
      this.fx.sparks(pos, { color: bright, count: 16, speed: 2.4, up: 1.4, size: 0.24, gravity: 2, drag: 2.5, life: 0.9, star: true });
      this.fx.rubble(rock.pos, oc.clone().multiplyScalar(0.8), 1, 0.3);
      if (ORE_STYLE[ore as keyof typeof ORE_STYLE]?.kind === 'gem') mineSfx.gem();
    }
    if (!roll) return drops;
    for (const id of rollRockLoot(() => this.rng.next(), ore, big, this.layout.biome)) drops.push(this.spawnDrop(id, rock.pos, 1, 1.4));
    return drops;
  }

  /** Spawn a loot drop and describe it (co-op relays the exact launch). */
  spawnDrop(id: string, at: THREE.Vector3, qty = 1, power = 1, net = 0, vel?: THREE.Vector3): DropInfo {
    const n = this.pickups.spawn(id, at, qty, power, net, vel);
    const v = this.pickups.launch(n) ?? new THREE.Vector3();
    return { net: n, id, qty, x: at.x, y: at.y, z: at.z, vx: v.x, vy: v.y, vz: v.z };
  }

  /** Co-op farmhand: apply the host's verdict on a rock (hp / break + its exact drops). */
  applyRock(idx: number, hp: number, broke: boolean, drops: DropInfo[], striker: THREE.Vector3 | null): void {
    const rock = this.rockAt(idx % FLOOR_W, Math.floor(idx / FLOOR_W));
    if (!rock) return;
    this.striker = striker;
    rock.hp = hp;
    if (broke) {
      this.rockBreakFx(rock, false);
      for (const d of drops) this.spawnDrop(d.id, new THREE.Vector3(d.x, d.y, d.z), d.qty, 1, d.net, new THREE.Vector3(d.vx, d.vy, d.vz));
    } else if (striker) this.rockHitFx(rock);
    this.striker = null;
  }

  /** Remove rocks silently (co-op join: rocks already broken on the host). */
  removeRocks(idxs: number[]): void {
    for (const idx of idxs) {
      const rock = this.rockAt(idx % FLOOR_W, Math.floor(idx / FLOOR_W));
      if (!rock || !this.rocks) continue;
      this.rocks.remove(rock);
      this.grid.setObject(rock.spec.x, rock.spec.z, null);
    }
  }

  /** Nearest free tile with ≥ 2 tiles of open floor all around it (a ladder never reads as a
   * ladder into the void on a cliff lip). Falls back to the requested tile. */
  private ladderTile(tx: number, tz: number): [number, number] {
    const L = this.layout;
    const open = (x: number, z: number): boolean => x >= 0 && z >= 0 && x < L.w && z < L.d && !L.solid[z * L.w + x] && !L.lava[z * L.w + x];
    const inside = (x: number, z: number): boolean => {
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dz) <= 3 && !open(x + dx, z + dz)) return false;
      return !this.grid.getObject(x, z) && this.clearAt(x + 0.5, z + 0.5, 0.7);
    };
    if (inside(tx, tz)) return [tx, tz];
    for (let r = 1; r <= 6; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (inside(tx + dx, tz + dz)) return [tx + dx, tz + dz];
        }
    return [tx, tz];
  }

  revealLadder(tx0: number, tz0: number, exact = false): void {
    if (this.ladderDown) return;
    const [tx, tz] = exact ? [tx0, tz0] : this.ladderTile(tx0, tz0);
    this.hooks?.ladder?.(tx, tz);
    this.ladderDown = { x: tx, z: tz };
    const g = buildLadderDown(this.layout.biome, this.rng);
    g.position.set(tx + 0.5, this.heightAt(tx + 0.5, tz + 0.5), tz + 0.5);
    this.floorGroup.add(g);
    this.ladderGroup = g;
    this.grid.setObject(tx, tz, { kind: 'ladderDown', id: 'ladder', solid: false });
    const p = g.position.clone().setY(g.position.y + 0.3);
    this.fx.sparks(p, { color: 0xffe6a0, count: 26, speed: 2, up: 1.6, size: 0.22, gravity: 1.5, drag: 2, life: 1.1, star: true });
    this.fx.puff(p, { color: 0xd8c0a0, count: 10, speed: 1.2, up: 0.4, size: 0.9, grow: 1.5, gravity: -0.3, drag: 3, life: 1, alpha: 0.4 });
    mineSfx.reveal();
    this.game.events.emit('mine:ladder', { x: tx, z: tz, floor: this.floor });
  }

  /** Sword arc: every live monster within reach and inside the arc gets hit. */
  strike(origin: THREE.Vector3, dir: THREE.Vector3, reach: number, arcCos: number, dmg: [number, number], critChance: number): StrikeHit[] {
    const hits: StrikeHit[] = [];
    if (this.puppet) {
      // Farmhand: the host resolves the swing (its verdict comes back as hit FX + numbers).
      this.hooks?.strikeIntent?.(origin, dir, reach < 1.5);
      return hits;
    }
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const dx = m.pos.x - origin.x;
      const dz = m.pos.z - origin.z;
      const d = Math.hypot(dx, dz);
      // 0.3-tile forgiveness on reach; anything close in front-ish always connects.
      if (d > reach + m.radius + 0.3) continue;
      const dot = d > 1e-3 ? (dx * dir.x + dz * dir.z) / d : 1;
      if (d > 0.7 && dot < arcCos && !(d < 1.5 + m.radius && dot > -0.15)) continue;
      if (m.kind === 'bat' && m.pos.y - this.heightAt(m.pos.x, m.pos.z) > 2.2) continue;
      const crit = this.rng.next() < critChance;
      const damage = Math.round((dmg[0] + this.rng.next() * (dmg[1] - dmg[0])) * (crit ? 2 : 1));
      const kdir = new THREE.Vector3(dx, 0, dz).normalize();
      if (!Number.isFinite(kdir.x)) kdir.copy(dir);
      const killed = m.hit(damage, kdir, crit ? 1.5 : 1);
      hits.push({ monster: m, damage, crit, killed });
      const at = m.pos.clone().setY(m.pos.y + (m.kind === 'bat' ? 0.1 : m.kind === 'wisp' ? 0.95 : 0.4));
      const col = monsterColor(m.kind, this.layout.biome);
      if (m.kind === 'slime') {
        this.fx.puff(at, { color: col, count: 10, speed: 2.6, up: 1.2, size: 0.16, gravity: 9, drag: 1, life: 0.6, dir: kdir, cone: 0.5 });
        mineSfx.squish();
      } else if (m.kind === 'crab') {
        this.fx.shatter(at, new THREE.Color(col), 3, 0.7, kdir);
        mineSfx.hitShell();
      } else if (m.kind === 'wisp') {
        this.fx.sparks(at, { color: 0xdff6ff, count: 14, speed: 3, up: 0.8, size: 0.14, gravity: 3, drag: 2, life: 0.5, dir: kdir, cone: 0.5, star: true });
        mineSfx.zap();
      } else if (m.kind === 'imp') {
        this.fx.sparks(at, { color: 0xffb040, to: 0xff3010, count: 16, speed: 3, up: 1.2, size: 0.12, gravity: 4, drag: 2, life: 0.5, dir: kdir, cone: 0.5 });
        mineSfx.squish();
      } else {
        mineSfx.screech();
      }
      this.fx.sparks(at, { color: 0xffffff, to: crit ? 0xffc040 : 0xffe8c0, count: crit ? 18 : 10, speed: crit ? 5 : 3.6, up: 0.8, size: crit ? 0.14 : 0.1, gravity: 4, drag: 3, life: 0.28, dir: kdir, cone: 0.4 });
      mineSfx.hitFlesh(crit);
    }
    // The blade cuts fireballs out of the air.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i]!;
      const dx = pr.pos.x - origin.x;
      const dz = pr.pos.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > reach + 0.3 || (d > 0.5 && (dx * dir.x + dz * dir.z) / d < arcCos)) continue;
      this.popProjectile(i, true);
    }
    if (hits.length) this.hooks?.hits?.(this.strikerId, hits, origin);
    return hits;
  }

  // ───────────────────────────────────────────── projectiles (imp fireballs)

  private projectiles: Projectile[] = [];
  private fireGeo: THREE.SphereGeometry | null = null;
  private fireMat: THREE.MeshBasicMaterial | null = null;

  shoot(owner: MonsterKind, from: THREE.Vector3, dir: THREE.Vector3, damage: number): void {
    this.fireGeo ??= new THREE.SphereGeometry(0.14, 14, 10);
    this.fireMat ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc060).multiplyScalar(2.4) });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.fireGeo, this.fireMat));
    g.add(glowPoint(0xff7a20, 1.1, 0.9));
    g.position.copy(from);
    g.userData.noAO = true;
    this.floorGroup.add(g);
    this.projectiles.push({ mesh: g, pos: from.clone(), vel: dir.clone().setY(0).normalize().multiplyScalar(5.2), age: 0, damage: this.puppet ? 0 : damage, owner });
    if (!this.puppet) this.hooks?.shoot?.(from, dir);
    this.fx.sparks(from, { color: 0xffc060, to: 0xff4010, count: 10, speed: 1.5, up: 1, size: 0.12, gravity: 1, drag: 2, life: 0.4 });
    mineSfx.fireball();
  }

  private popProjectile(i: number, parried = false): void {
    const pr = this.projectiles[i]!;
    this.projectiles.splice(i, 1);
    pr.mesh.removeFromParent();
    const hp = pr.mesh.children[1] as THREE.Points | undefined;
    if (hp) {
      hp.geometry.dispose();
      (hp.material as THREE.Material).dispose();
    }
    this.fx.sparks(pr.pos, { color: parried ? 0xfff0c0 : 0xffb040, to: 0xff3010, count: parried ? 22 : 16, speed: 2.6, up: 1.2, size: 0.13, gravity: 3, drag: 2, life: 0.55, star: parried });
    this.fx.puff(pr.pos, { color: 0x4a3a38, count: 4, speed: 0.6, up: 1, size: 0.6, grow: 1.6, gravity: -0.6, drag: 2, life: 0.8, alpha: 0.4 });
    if (parried) mineSfx.hitShell();
  }

  private updateProjectiles(dt: number, player: THREE.Vector3): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i]!;
      pr.age += dt;
      pr.pos.addScaledVector(pr.vel, dt);
      const g = this.heightAt(pr.pos.x, pr.pos.z);
      pr.pos.y += (g + 0.6 - pr.pos.y) * (1 - Math.exp(-dt * 4));
      pr.mesh.position.copy(pr.pos);
      const hp = pr.mesh.children[1] as THREE.Points | undefined;
      if (hp) (hp.material as THREE.PointsMaterial).size = 1.0 + Math.sin(pr.age * 30) * 0.15;
      if (Math.random() < 0.7) this.fx.sparks(pr.pos, { color: 0xffa040, to: 0xff2a08, count: 1, speed: 0.3, up: 0.5, size: 0.1, gravity: -0.5, drag: 1, life: 0.45 });
      const hitP = this.playerTargetable && Math.hypot(pr.pos.x - player.x, pr.pos.z - player.z) < 0.45;
      if (hitP) {
        if (pr.damage > 0) this.game.events.emit('combat:playerHit', { damage: pr.damage, x: pr.pos.x - pr.vel.x * 0.1, z: pr.pos.z - pr.vel.z * 0.1, kind: pr.owner });
        this.popProjectile(i);
        continue;
      }
      const hitR = this.remotes.find((r) => r.targetable && Math.hypot(pr.pos.x - r.pos.x, pr.pos.z - r.pos.z) < 0.45);
      if (hitR) {
        if (pr.damage > 0) this.hooks?.hurt?.(hitR.id, pr.damage, pr.pos.x - pr.vel.x * 0.1, pr.pos.z - pr.vel.z * 0.1, pr.owner);
        this.popProjectile(i);
        continue;
      }
      if (pr.age > 2.6 || !this.clearAt(pr.pos.x, pr.pos.z, 0.1, true)) this.popProjectile(i);
    }
  }

  /** Swing the milestone chest open (burst of gold light + glints). Returns false if none / open. */
  openChest(): boolean {
    const c = this.chest;
    if (!c || c.target === 1) return false;
    c.target = 1;
    this.openedChests.add(this.floor);
    const p = new THREE.Vector3(c.x, c.group.position.y + 0.6, c.z);
    this.fx.sparks(p, { color: 0xffe6a0, count: 34, speed: 2.4, up: 2, size: 0.26, gravity: 1.2, drag: 2, life: 1.3, star: true });
    this.fx.sparks(p, { color: 0xfff6d0, count: 1, speed: 0, up: 0, size: 2.4, gravity: 0, drag: 0, life: 0.25 });
    this.lighting.flash = Math.max(this.lighting.flash, 0.4);
    mineSfx.chest();
    return true;
  }

  /** What is at / next to this tile for the interact key. */
  interactAt(tx: number, tz: number): MineInteract {
    const L = this.layout;
    const p = this.game.player.position;
    const near = (x: number, z: number, r: number): boolean => Math.hypot(p.x - x, p.z - z) < r;
    if (this.ladderDown && ((tx === this.ladderDown.x && tz === this.ladderDown.z) || near(this.ladderDown.x + 0.5, this.ladderDown.z + 0.5, 1.0))) return 'ladderDown';
    if ((tx === L.ladderUp.x && tz === L.ladderUp.z) || near(L.ladderUp.x + 0.5, L.ladderUp.z + 1.5, 1.1)) return 'ladderUp';
    if (L.elevator && ((tx === L.elevator.x && tz === L.elevator.z) || near(L.elevator.x + 0.5, L.elevator.z + 1.2, 1.2))) return 'elevator';
    if (this.chest && this.chest.target === 0 && ((L.chest && tx === L.chest.x && tz === L.chest.z) || near(this.chest.x, this.chest.z, 1.3))) return 'chest';
    return null;
  }

  private puff(p: THREE.Vector3, color: number, count: number, kind: 'dust' | 'goo' | 'spark'): void {
    if (kind === 'goo') {
      this.fx.puff(p, { color, count, speed: 3, up: 1.4, size: 0.2, gravity: 10, drag: 0.8, life: 0.8 });
      this.fx.sparks(p, { color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5), count: 10, speed: 2, up: 1, size: 0.18, gravity: 0, drag: 3, life: 0.5, star: true });
      this.fx.puff(p, { color: 0xf0ece0, count: 6, speed: 1, up: 0.5, size: 0.9, grow: 1.4, gravity: -0.4, drag: 3, life: 0.7, alpha: 0.55 });
      mineSfx.pop();
    } else if (kind === 'spark') {
      this.fx.sparks(p, { color, count, speed: 2.5, up: 1, size: 0.12, gravity: 3, drag: 2, life: 0.5 });
    } else {
      this.fx.puff(p, { color, count, speed: 1.1, up: 0.4, size: 0.55, grow: 1.4, gravity: -0.2, drag: 3, life: 0.7, alpha: 0.45 });
    }
  }

  // ───────────────────────────────────────────── frame

  update(dt0: number, game: Game): void {
    // Kill hit-stop: the arena (monsters, shots, loot, particles) holds for a beat.
    const stopped = this.stopT > 0;
    this.stopT = Math.max(0, this.stopT - dt0);
    const dt = stopped ? 0 : dt0;
    const time = game.time;
    const player = game.player.position;
    const simDt = game.paused ? 0 : dt;
    this.ctx.time = time;
    this.ctx.player = player;
    this.ctx.playerTargetable = this.playerTargetable && !this.freezeAI;
    for (const m of this.monsters) {
      if (m.dead) continue;
      if (this.puppet || this.freezeAI || (game.paused && !this.live)) {
        m.update(dt, this.ctx, true);
        continue;
      }
      // Co-op: every monster chases the nearest farmer on this floor who can be hurt.
      if (this.remotes.length) {
        let best = this.playerTargetable ? Math.hypot(m.pos.x - player.x, m.pos.z - player.z) : Infinity;
        let who = this.localId;
        let at: THREE.Vector3 = player;
        for (const r of this.remotes) {
          if (!r.targetable) continue;
          const d = Math.hypot(m.pos.x - r.pos.x, m.pos.z - r.pos.z);
          if (d < best) {
            best = d;
            who = r.id;
            at = r.pos;
          }
        }
        this.targetOf.set(m, best < Infinity ? who : -1);
        this.ctx.player = at;
        this.ctx.playerTargetable = best < Infinity && !this.freezeAI;
      } else this.targetOf.delete(m);
      m.update(this.live ? dt : simDt, this.ctx);
      this.ctx.player = player;
      this.ctx.playerTargetable = this.playerTargetable && !this.freezeAI;
    }
    // Separation between monsters.
    for (let i = 0; i < this.monsters.length; i++) {
      const a = this.monsters[i]!;
      if (!a.alive) continue;
      for (let j = i + 1; j < this.monsters.length; j++) {
        const b = this.monsters[j]!;
        if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        // Fliers and walkers pass over each other; same-layer monsters never merge into one blob.
        if (a.flies !== b.flies) continue;
        const min = (a.radius + b.radius) * 1.08;
        if (d < min) {
          const nx = d > 1e-3 ? dx / d : 1;
          const nz = d > 1e-3 ? dz / d : 0;
          // Soft push (≈ 6·overlap per frame at 60 fps, capped) so packs spread instead of popping.
          const push = Math.min((min - d) * 0.5, (min - d) * Math.min(1, 6 * dt * 6));
          const fa = a.flies;
          if (this.clearAt(a.pos.x - nx * push, a.pos.z - nz * push, a.radius * 0.8, fa)) {
            a.pos.x -= nx * push;
            a.pos.z -= nz * push;
          }
          if (this.clearAt(b.pos.x + nx * push, b.pos.z + nz * push, b.radius * 0.8, fa)) {
            b.pos.x += nx * push;
            b.pos.z += nz * push;
          }
        }
      }
    }
    // Lava lip: standing on the hot shoreline scorches (tick + shove back onto the rock).
    this.hazardT = Math.max(0, this.hazardT - simDt);
    if (this.cave && this.layout.biome === 'lava' && this.playerTargetable && simDt > 0 && this.hazardT <= 0) {
      let hot: { x: number; z: number; v: number } | null = null;
      for (let k = 0; k < 9; k++) {
        const a = (k / 8) * Math.PI * 2;
        const rr = k === 8 ? 0 : 0.34;
        const x = player.x + Math.cos(a) * rr;
        const z = player.z + Math.sin(a) * rr;
        const v = this.cave.lavaAt(x, z);
        if (v > 0.45 && (!hot || v > hot.v)) hot = { x, z, v };
      }
      if (hot) {
        this.hazardT = 0.9;
        const at = new THREE.Vector3(player.x, player.y + 0.1, player.z);
        this.fx.sparks(at, { color: 0xffc060, to: 0xff3010, count: 14, speed: 1.6, up: 2.2, size: 0.12, gravity: 1, drag: 1.5, life: 0.7 });
        this.fx.puff(at, { color: 0x6a5a58, count: 5, speed: 0.6, up: 1.4, size: 0.6, grow: 1.8, gravity: -1, drag: 2, life: 0.9, alpha: 0.4 });
        mineSfx.sizzle();
        this.game.events.emit('combat:playerHit', { damage: 5 + this.layout.tier * 3, x: hot.x, z: hot.z, kind: 'lava' });
      }
    }
    // Personal space: walkers never stand inside the farmer (contact attacks still land at the rim).
    if (this.playerTargetable) {
      for (const m of this.monsters) {
        if (!m.alive || m.flies) continue;
        const dx = m.pos.x - player.x;
        const dz = m.pos.z - player.z;
        const d = Math.hypot(dx, dz);
        const min = m.radius + 0.24;
        if (d >= min) continue;
        const nx = d > 1e-3 ? dx / d : 0;
        const nz = d > 1e-3 ? dz / d : 1;
        const x = player.x + nx * min;
        const z = player.z + nz * min;
        if (this.clearAt(x, z, m.radius * 0.8)) {
          m.pos.x = x;
          m.pos.z = z;
        }
      }
    }
    // Deaths → drops.
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i]!;
      if (!m.dead || this.dropped.has(m)) continue;
      this.dropped.add(m);
      if (!this.puppet) {
        const drops: DropInfo[] = [];
        for (const [id, chance] of MONSTER_DROPS[m.kind]) if (this.rng.next() < chance) drops.push(this.spawnDrop(id, m.pos, 1, 0.8));
        if (drops.length) this.hooks?.drops?.(drops);
      }
      this.game.events.emit('combat:monsterKilled', { kind: m.kind, x: m.pos.x, z: m.pos.z, floor: this.floor });
      m.root.removeFromParent();
      m.dispose();
      this.monsters.splice(i, 1);
      if (!this.puppet && !this.ladderDown && this.monsters.every((x) => !x.alive)) {
        const tx = Math.floor(m.pos.x);
        const tz = Math.floor(m.pos.z);
        if (this.grid.isWalkable(tx, tz)) this.revealLadder(tx, tz);
      }
    }
    if (!this.freezeFx) this.updateProjectiles(this.live ? dt : simDt, player);
    if (this.chest) {
      const c = this.chest;
      c.open += (c.target - c.open) * (1 - Math.exp(-dt * 6));
      const k = c.open;
      c.lid.rotation.x = -1.95 * (k < 1 ? 1 - Math.pow(1 - k, 3) : 1) + Math.sin(k * Math.PI) * 0.15;
      (c.glow.material as THREE.ShaderMaterial).uniforms.uStrength!.value = c.target ? 0.8 + (1 - k) * 1.2 + 0.12 * Math.sin(time * 3) : 0.0;
      if (c.target === 0 && Math.random() < dt * 2.2) this.fx.sparks(new THREE.Vector3(c.x + (Math.random() - 0.5) * 0.8, c.group.position.y + 0.3 + Math.random() * 0.4, c.z + 0.1), { color: 0xffe6a0, count: 1, speed: 0.05, up: 0, size: 0.3, gravity: 0, drag: 5, life: 0.6, star: true });
    }
    this.rocks?.update(this.freezeFx ? 0 : dt);
    this.localCollector.id = this.localId;
    this.localCollector.pos = player;
    this.collectorList.length = 0;
    if (this.playerTargetable) this.collectorList.push(this.localCollector);
    for (const r of this.remotes) if (r.targetable) this.collectorList.push(r);
    this.pickups.update(dt, time, this.collectorList, true, !this.puppet);
    // Ambient: vents puff embers, ore rocks glint now and then.
    this.ventT -= dt;
    if (this.props && this.ventT <= 0) {
      this.ventT = 0.06;
      for (const v of this.props.vents) {
        this.fx.sparks(v, { color: 0xffb040, to: 0xff3010, count: 1, speed: 0.4, up: 3, size: 0.09, gravity: -0.6, drag: 0.6, life: 1.8 });
        if (Math.random() < 0.3) this.fx.puff(v, { color: 0x3a2a2a, count: 1, speed: 0.2, up: 2, size: 0.7, grow: 2, gravity: -0.8, drag: 0.5, life: 2.2, alpha: 0.35 });
      }
    }
    this.sparkleT -= dt;
    if (this.rocks && this.sparkleT <= 0) {
      this.sparkleT = 0.12;
      const list = this.rocks.rocks;
      for (let k = 0; k < 2; k++) {
        const rk = list[Math.floor(Math.random() * list.length)];
        if (!rk || !rk.alive || !rk.spec.ore || Math.hypot(rk.pos.x - player.x, rk.pos.z - player.z) > 11) continue;
        const c = oreColor(rk.spec.ore).lerp(new THREE.Color(0xffffff), 0.6);
        this.fx.sparks(rk.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.35 + Math.random() * 0.3, (Math.random() - 0.5) * 0.5)), { color: c, count: 1, speed: 0.05, up: 0, size: 0.24, gravity: 0, drag: 5, life: 0.7, star: true });
      }
    }
    // Gold (and gem) nodes wink every ~1.5 s each, phase-staggered, so they read from across a hall.
    if (this.rocks) {
      for (const rk of this.rocks.rocks) {
        if (!rk.alive || !rk.spec.ore) continue;
        const st = ORE_STYLE[rk.spec.ore];
        if (rk.spec.ore !== 'goldOre' && st.kind !== 'gem') continue;
        const period = rk.spec.ore === 'goldOre' ? 1.5 : 2.4;
        const ph = (rk.spec.seed % 1000) / 1000;
        const a = Math.floor(time / period + ph);
        const b = Math.floor((time - dt) / period + ph);
        if (a === b || Math.hypot(rk.pos.x - player.x, rk.pos.z - player.z) > 13) continue;
        const c = oreColor(rk.spec.ore).lerp(new THREE.Color(0xffffff), 0.55);
        const sy = rk.spec.big ? 0.75 : 0.55;
        this.fx.sparks(rk.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, sy * rk.scale + Math.random() * 0.15, (Math.random() - 0.5) * 0.4)), { color: c, count: 1, speed: 0.02, up: 0, size: 0.42, gravity: 0, drag: 5, life: 0.55, star: true });
      }
    }
    const h = game.rc.renderer.domElement.height;
    FG_FADE.uFgH.value = h;
    this.lighting.update(dt, time, player);
    this.fx.update(this.freezeFx ? 0 : dt, time, h, game.rc.rig.focus, this.lighting.fill.position);
  }

  dispose(): void {
    this.clearFloor();
    this.fx.dispose();
    this.lighting.dispose();
  }
}

export { biomeForFloor };
