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
import { buildProps, buildLadderDown, type MineProps } from './props';
import { RockField, oreColor, type MineRock } from './ores';
import { MineFX } from './fx';
import { Pickups } from './pickups';
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

export type MineInteract = 'ladderUp' | 'ladderDown' | 'elevator' | null;

/** Loot tables for monsters: [item, chance]. */
const MONSTER_DROPS: Record<MonsterKind, [string, number][]> = {
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
};

let pendingFloor = 1;
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
  /** Invulnerable / passed-out player: monsters ignore them. */
  playerTargetable = true;
  /** Demo / cutscene: freeze monster AI (they still breathe). */
  freezeAI = false;
  /** Demo arena: monsters keep simulating while the game is paused for a staged shot. */
  live = false;

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

  constructor(private game: Game) {
    this.root.name = 'map:mine';
    this.lighting = new CaveLighting(game);
    this.root.add(this.floorGroup, this.fx.group, this.lighting.group);
    this.pickups = new Pickups(
      (x, z) => this.heightAt(x, z),
      (id, qty, at) => {
        this.fx.sparks(at, { color: 0xfff2c0, count: 6, speed: 1.2, size: 0.12, gravity: 0, drag: 4, life: 0.35, star: true });
        mineSfx.blip();
        if (this.onPickup) this.onPickup(id, qty, at);
        else game.events.emit('item:give', { itemId: id, qty });
        game.events.emit('mine:pickup', { itemId: id, qty });
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
      onAttack: (m, dmg) => game.events.emit('combat:playerHit', { damage: dmg, x: m.pos.x, z: m.pos.z, kind: m.kind }),
      puff: (p, color, count, kind) => this.puff(p, color, count, kind),
      rng: this.rng,
    };
    game.events.on('map:change', ({ map }) => {
      if (map === 'mine') this.activate();
      else this.deactivate();
    });
    this.setFloor(pendingFloor);
  }

  // ───────────────────────────────────────────── floors

  setFloor(n: number): void {
    n = Math.max(1, Math.floor(n));
    if (n === this.floor && this.cave) return;
    this.live = false;
    this.clearFloor();
    this.floor = n;
    const seed = this.game.rng.fork('mine').seed;
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
    this.props = buildProps(L, r.fork('props'), (x, z) => this.cave!.heightAt(x, z));
    this.floorGroup.add(this.props.group);
    for (const d of L.decor) if (d.solid) g.setObject(Math.floor(d.x), Math.floor(d.z), { kind: 'prop', id: d.kind, solid: true });
    for (const c of L.crystals) {
      const tx = Math.floor(c.x);
      const tz = Math.floor(c.z);
      if (!L.solid[tz * FLOOR_W + tx]) g.setObject(tx, tz, { kind: 'prop', id: 'crystal', solid: true });
    }
    if (L.elevator) g.setObject(L.elevator.x, L.elevator.z, { kind: 'prop', id: 'elevator', solid: true });

    this.rocks = new RockField(L, r.fork('rocks'), (x, z) => this.cave!.heightAt(x, z));
    this.floorGroup.add(this.rocks.group);
    for (const rk of this.rocks.rocks) g.setObject(rk.spec.x, rk.spec.z, { kind: 'mineRock', id: rk.spec.ore ?? 'rock', solid: true, hp: rk.hp, data: { ore: rk.spec.ore } });

    const band = Math.floor((n - 1) / 10) % 3;
    for (const m of L.monsters) this.addMonster(m.kind, m.x, m.z, L.tier, band);

    this.spawn = { x: L.spawn.x, z: L.spawn.z, facing: 'down' };
    this.fx.setFloor((x, z) => this.heightAt(x, z), def.motes, def.moteColor);
    this.lighting.configure(def, L.lights);
    this.brokenCount = 0;
  }

  addMonster(kind: MonsterKind, x: number, z: number, tier = this.layout.tier, band = Math.floor((this.floor - 1) / 10) % 3): Monster {
    const m = createMonster(kind, this.layout.biome, x, z, tier, band, this.rng.int(1, 1e6));
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
    for (const m of this.monsters) {
      m.root.removeFromParent();
      m.dispose();
    }
    this.monsters = [];
    this.pickups.clear();
    if (this.ladderGroup) this.ladderGroup.removeFromParent();
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
    rig.pitch = 54;
    rig.yaw = 0;
    rig.distance = 19;
    rig.lookOffset.set(0, 0, -0.6);
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

  rockAt(tx: number, tz: number): MineRock | undefined {
    return this.rocks?.at(tx, tz);
  }

  /** Pickaxe strike on a tile. Returns null if there is no rock there. */
  strikeRock(tx: number, tz: number, power = 1): { broke: boolean; ore: string | null; pos: THREE.Vector3 } | null {
    const rock = this.rockAt(tx, tz);
    if (!rock || !this.rocks) return null;
    const ore = rock.spec.ore;
    const pos = rock.pos.clone().setY(rock.pos.y + 0.35);
    const def = BIOMES[this.layout.biome];
    const baseCol = new THREE.Color(def.rock[0]!);
    rock.hp -= power;
    this.rocks.hit(rock);
    const dir = new THREE.Vector3(rock.pos.x - this.game.player.position.x, 0, rock.pos.z - this.game.player.position.z).normalize();
    // Chips + sparks on every hit.
    this.fx.sparks(pos, { color: 0xffe0a0, to: 0xff7a20, count: ore ? 10 : 6, speed: 3.2, up: 0.9, size: 0.07, gravity: 9, drag: 1.2, life: 0.35 });
    this.fx.puff(pos, { color: baseCol.clone().lerp(new THREE.Color(0xd8c8b0), 0.4), count: 3, speed: 0.6, up: 0.4, size: 0.5, grow: 1.2, gravity: -0.3, drag: 3, life: 0.6, alpha: 0.45 });
    this.fx.shatter(pos, baseCol, 2, 0.5, dir.clone().negate());
    const broke = rock.hp <= 0;
    mineSfx.pick(!!ore);
    if (!broke) {
      this.game.rc.rig.addShake(0.08);
      return { broke, ore, pos };
    }
    // Break: shards, dust bloom, loot.
    this.rocks.remove(rock);
    this.grid.setObject(tx, tz, null);
    this.brokenCount++;
    const big = rock.spec.big;
    this.fx.shatter(pos, baseCol, big ? 12 : 8, big ? 1.2 : 1);
    this.fx.puff(pos, { color: baseCol.clone().lerp(new THREE.Color(0xe8dcc8), 0.5), count: big ? 12 : 8, speed: 1.4, up: 0.5, size: 0.8, grow: 1.6, gravity: -0.2, drag: 3, life: 0.9, alpha: 0.5 });
    this.game.rc.rig.addShake(big ? 0.3 : 0.18);
    mineSfx.crumble(big);
    if (ore) {
      const oc = oreColor(ore as never);
      this.fx.shatter(pos, oc, 5, 1.1);
      this.fx.sparks(pos, { color: oc.clone().lerp(new THREE.Color(0xffffff), 0.5), count: 14, speed: 2.2, up: 1.4, size: 0.2, gravity: 2, drag: 2.5, life: 0.8, star: true });
      if (ORE_STYLE[ore as keyof typeof ORE_STYLE]?.kind === 'gem') mineSfx.gem();
      this.pickups.spawn(ore, rock.pos, 1);
      if (this.rng.next() < 0.3) this.pickups.spawn(ore, rock.pos, 1);
    }
    if (!ore || this.rng.next() < 0.5) this.pickups.spawn('stone', rock.pos, 1);
    if (big) this.pickups.spawn('stone', rock.pos, 1);
    if (this.layout.biome !== 'earth' && this.rng.next() < 0.06) this.pickups.spawn('coal', rock.pos, 1);
    this.game.events.emit('mine:rock', { x: tx, z: tz, ore, floor: this.floor });
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

  revealLadder(tx: number, tz: number): void {
    if (this.ladderDown) return;
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
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const dx = m.pos.x - origin.x;
      const dz = m.pos.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > reach + m.radius) continue;
      const dot = d > 1e-3 ? (dx * dir.x + dz * dir.z) / d : 1;
      if (d > 0.7 && dot < arcCos) continue;
      if (m.kind === 'bat' && m.pos.y - this.heightAt(m.pos.x, m.pos.z) > 2.2) continue;
      const crit = this.rng.next() < critChance;
      const damage = Math.round((dmg[0] + this.rng.next() * (dmg[1] - dmg[0])) * (crit ? 2 : 1));
      const kdir = new THREE.Vector3(dx, 0, dz).normalize();
      if (!Number.isFinite(kdir.x)) kdir.copy(dir);
      const killed = m.hit(damage, kdir, crit ? 1.5 : 1);
      hits.push({ monster: m, damage, crit, killed });
      const at = m.pos.clone().setY(m.pos.y + (m.kind === 'bat' ? 0.1 : 0.4));
      const col = monsterColor(m.kind, this.layout.biome);
      if (m.kind === 'slime') {
        this.fx.puff(at, { color: col, count: 10, speed: 2.6, up: 1.2, size: 0.16, gravity: 9, drag: 1, life: 0.6, dir: kdir, cone: 0.5 });
        mineSfx.squish();
      } else if (m.kind === 'crab') {
        this.fx.shatter(at, new THREE.Color(col), 3, 0.7, kdir);
        mineSfx.hitShell();
      } else {
        mineSfx.screech();
      }
      this.fx.sparks(at, { color: 0xffffff, to: crit ? 0xffc040 : 0xffe8c0, count: crit ? 18 : 10, speed: crit ? 5 : 3.6, up: 0.8, size: crit ? 0.14 : 0.1, gravity: 4, drag: 3, life: 0.28, dir: kdir, cone: 0.4 });
      mineSfx.hitFlesh(crit);
    }
    return hits;
  }

  /** What is at / next to this tile for the interact key. */
  interactAt(tx: number, tz: number): MineInteract {
    const L = this.layout;
    const p = this.game.player.position;
    const near = (x: number, z: number, r: number): boolean => Math.hypot(p.x - x, p.z - z) < r;
    if (this.ladderDown && ((tx === this.ladderDown.x && tz === this.ladderDown.z) || near(this.ladderDown.x + 0.5, this.ladderDown.z + 0.5, 1.0))) return 'ladderDown';
    if ((tx === L.ladderUp.x && tz === L.ladderUp.z) || near(L.ladderUp.x + 0.5, L.ladderUp.z + 1.5, 1.1)) return 'ladderUp';
    if (L.elevator && ((tx === L.elevator.x && tz === L.elevator.z) || near(L.elevator.x + 0.5, L.elevator.z + 1.2, 1.2))) return 'elevator';
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

  update(dt: number, game: Game): void {
    const time = game.time;
    const player = game.player.position;
    const simDt = game.paused ? 0 : dt;
    this.ctx.time = time;
    this.ctx.player = player;
    this.ctx.playerTargetable = this.playerTargetable && !this.freezeAI;
    for (const m of this.monsters) {
      if (m.dead) continue;
      if (this.freezeAI || (game.paused && !this.live)) m.update(dt, this.ctx, true);
      else m.update(this.live ? dt : simDt, this.ctx);
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
        const min = a.radius + b.radius;
        if (d > 1e-3 && d < min) {
          const push = (min - d) * 0.5;
          const nx = dx / d;
          const nz = dz / d;
          if (this.grid.isWalkable(Math.floor(a.pos.x - nx * push), Math.floor(a.pos.z - nz * push))) {
            a.pos.x -= nx * push;
            a.pos.z -= nz * push;
          }
          if (this.grid.isWalkable(Math.floor(b.pos.x + nx * push), Math.floor(b.pos.z + nz * push))) {
            b.pos.x += nx * push;
            b.pos.z += nz * push;
          }
        }
      }
    }
    // Deaths → drops.
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i]!;
      if (!m.dead || this.dropped.has(m)) continue;
      this.dropped.add(m);
      for (const [id, chance] of MONSTER_DROPS[m.kind]) if (this.rng.next() < chance) this.pickups.spawn(id, m.pos, 1, 0.8);
      this.game.events.emit('combat:monsterKilled', { kind: m.kind, x: m.pos.x, z: m.pos.z, floor: this.floor });
      m.root.removeFromParent();
      m.dispose();
      this.monsters.splice(i, 1);
      if (!this.ladderDown && this.monsters.every((x) => !x.alive)) {
        const tx = Math.floor(m.pos.x);
        const tz = Math.floor(m.pos.z);
        if (this.grid.isWalkable(tx, tz)) this.revealLadder(tx, tz);
      }
    }
    this.rocks?.update(dt);
    this.pickups.update(dt, time, player, this.playerTargetable);
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
    const h = game.rc.renderer.domElement.height;
    this.lighting.update(dt, time, player);
    this.fx.update(dt, time, h, game.rc.rig.focus, this.lighting.fill.position);
  }

  dispose(): void {
    this.clearFloor();
    this.fx.dispose();
    this.lighting.dispose();
  }
}

export { biomeForFloor };
