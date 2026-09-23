/**
 * MiningSystem: the Hollowdeep. Registers the two mine maps (the mountain entrance and the
 * rebuilt-per-floor cave), and drives everything that is not combat:
 *   - pickaxe on the mine floor (chop pose → rock wobble / chips / shatter + loot, ladder reveal);
 *   - ladders (down / up), the mine mouth, the lift (elevator panel, a stop every 5 floors);
 *   - floor transitions (fade, rebuild, arrival banner), the floor plaque HUD;
 *   - demo staging: mine-entrance, mine-floor (earth), mine-ice, mine-lava (+ &floor=N);
 *     &pick=1 swings the pickaxe at the nearest ore rock (+ &still=1 freezes on impact),
 *     &god=1 keeps the farmer unhurt, &ui=elevator opens the Mine Lift (e.g. &floor=5).
 *   in:  item:use (pickaxe), player:interact, player:tile, mine:goto, demo:stage, day:start
 *   out: mine:floor, mine:rock, mine:rockHit, tool:swing, tool:impact
 * Service `mining`: floor(), deepest(), descend(), goto(floor), breakRock(...) (debug / other systems).
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { MineMap, setPendingMineFloor, OPENED_CHESTS } from '../world/mine';
import { MineEntranceMap, MOUTH, LIFT, ENTRANCE_SPAWN } from '../world/mine/entrance';
import { BIOMES, ELEVATOR_EVERY, MAX_FLOOR, biomeForFloor } from '../world/mine/biomes';
import { FLOOR_W, FLOOR_D } from '../world/mine/gen';
import { FloorPlaque, ElevatorPanel, DamageNumbers } from '../world/mine/hud';
import { mineActions } from '../world/mine/actions';
import { registerMineIcons } from '../world/mine/icons';
import { mineSfx } from '../world/mine/sfx';
import { buildTool } from '../world/props/tools';
import { itemDef } from '../data/items';
import '../world/mine/events';

export interface MiningApi {
  floor(): number;
  deepest(): number;
  descend(): void;
  /** Travel to a floor (0 = the entrance). Resolves once the player stands on it. */
  goto(floor: number, via?: 'ladder' | 'elevator' | 'debug' | 'entrance'): Promise<void>;
  /** A rock broke on the current floor (drops are rolled by the map). */
  breakRock(x: number, z: number, ore: string | null): void;
}

declare module '../core/game' {
  interface GameServices {
    mining: MiningApi;
  }
}

/** Demo floors (URL `&floor=N` overrides). */
const DEMO_FLOORS: Record<string, number> = { 'mine-floor': 3, 'mine-ice': 14, 'mine-lava': 24, 'mine-combat': 2, 'mine-chest': 10, mine: 1 };

export class MiningSystem implements System, MiningApi {
  readonly name = 'mining';
  private game!: Game;
  private cur = 0;
  private best = 0;
  private busy = false;
  private plaque!: FloorPlaque;
  private numbers!: DamageNumbers;
  private pickaxe: THREE.Object3D | null = null;
  /** Floors whose milestone chest is open (shared with the map, saved here). */
  private chests = OPENED_CHESTS;
  private pickTier = -1;

  init(game: Game): void {
    this.game = game;
    registerMineIcons();
    game.world.registerMap('mine-entrance', (g) => new MineEntranceMap(g));
    game.world.registerMap('mine', (g) => new MineMap(g));
    game.provide('mining', this);

    const ui = game.opts.uiRoot;
    this.plaque = new FloorPlaque(ui);
    this.numbers = new DamageNumbers(ui);
    const lift = new ElevatorPanel(
      ui,
      () => this.liftStops(),
      (f) => void this.goto(f, 'elevator'),
      () => game.events.emit('ui:open', { name: 'none' }),
      () => this.cur,
    );
    game.hud.registerPanel('elevator', { open: () => lift.open(), close: () => lift.close() });

    game.events.on('item:use', ({ itemId, x, z }) => {
      if (itemId === 'pickaxe') this.usePickaxe(x, z);
    });
    game.events.on('player:interact', ({ x, z }) => this.interact(x, z));
    game.events.on('player:tile', ({ map, x, z }) => {
      if (map !== 'mine-entrance' || this.busy || game.paused) return;
      // Step into the dark of the mine mouth.
      if (z <= Math.floor(MOUTH.z - 0.6) && Math.abs(x + 0.5 - MOUTH.x) < 1.8) void this.goto(1, 'entrance');
    });
    game.events.on('mine:goto', ({ floor, via }) => void this.goto(floor, via));
    // Loot feedback has ONE channel: the HUD item toast (item:give) + the pickup sparkle. No world
    // label over the farmer's hat (they piled up into unreadable overprints).
    game.events.on('demo:stage', ({ name }) => this.stageDemo(name));
  }

  // ───────────────────────────────────────────── api

  floor(): number {
    return this.cur;
  }

  deepest(): number {
    return this.best;
  }

  descend(): void {
    void this.goto(this.cur + 1, 'debug');
  }

  breakRock(x: number, z: number, _ore: string | null): void {
    this.mine()?.strikeRock(x, z, 99);
  }

  private mine(): MineMap | null {
    const m = this.game.world.current;
    return m instanceof MineMap ? m : null;
  }

  private liftStops(): { floor: number; biome: string; unlocked: boolean; current: boolean }[] {
    const out = [{ floor: 0, biome: 'earth', unlocked: true, current: this.cur === 0 }];
    for (let f = ELEVATOR_EVERY; f <= Math.max(20, Math.min(MAX_FLOOR, Math.ceil((this.best + 1) / ELEVATOR_EVERY) * ELEVATOR_EVERY + 5)); f += ELEVATOR_EVERY) {
      out.push({ floor: f, biome: biomeForFloor(f), unlocked: f <= this.best, current: this.cur === f });
    }
    return out.slice(0, 12);
  }

  /** Build floor n (0 = entrance) and put the player on it. No fade (callers wrap it). */
  private async place(n: number, via: string): Promise<void> {
    const game = this.game;
    if (n <= 0) {
      const lift = via === 'elevator';
      await game.teleport('mine-entrance', lift ? LIFT.x - 0.2 : MOUTH.x + 0.5, lift ? LIFT.z + 1.4 : ENTRANCE_SPAWN.z);
      game.player.setFacing('down');
      this.cur = 0;
      return;
    }
    setPendingMineFloor(n);
    await game.world.load('mine');
    const m = this.mine()!;
    m.setFloor(n);
    const L = m.layout;
    const p = via === 'elevator' && L.elevator ? { x: L.elevator.x + 0.5, z: L.elevator.z + 1.6 } : L.spawn;
    game.player.teleport(p.x, p.z);
    game.player.setFacing('down');
    game.followPlayer(true);
    this.cur = n;
    this.best = Math.max(this.best, n);
  }

  async goto(n: number, via: 'ladder' | 'elevator' | 'debug' | 'entrance' = 'debug'): Promise<void> {
    if (this.busy) return;
    n = Math.max(0, Math.min(MAX_FLOOR, Math.floor(n)));
    this.busy = true;
    const game = this.game;
    game.player.controllable = false;
    if (via === 'elevator') mineSfx.lift();
    else mineSfx.ladder();
    await game.hud.fade(true);
    try {
      await this.place(n, via);
    } finally {
      await new Promise((r) => setTimeout(r, 160));
      await game.hud.fade(false);
      game.player.controllable = true;
      this.busy = false;
    }
    this.announce();
  }

  private announce(): void {
    const n = this.cur;
    this.game.events.emit('mine:floor', { floor: n, deepest: this.best });
    if (n > 0) {
      const def = BIOMES[biomeForFloor(n)];
      this.game.hud.banner(`Floor ${n}`, def.name);
      if (n % ELEVATOR_EVERY === 0) this.game.events.emit('ui:toast', { text: `Lift stop unlocked: floor ${n}`, kind: 'good' });
    } else this.game.hud.banner('Hollowdeep Mine', 'The mountain shelf');
  }

  // ───────────────────────────────────────────── tools

  private pickaxeMesh(): THREE.Object3D {
    const tier = this.game.services.farming?.toolTier('pickaxe') ?? 0;
    if (!this.pickaxe || tier !== this.pickTier) {
      this.pickaxe = buildTool('pickaxe', tier);
      this.pickTier = tier;
    }
    return this.pickaxe;
  }

  private usePickaxe(x: number, z: number): void {
    const m = this.mine();
    if (!m) return;
    const acts = mineActions(this.game.player);
    if (acts.active) return;
    const tier = this.game.services.farming?.toolTier('pickaxe') ?? 0;
    const player = this.game.player;
    const origin = player.position.clone();
    this.game.events.emit('tool:swing', { tool: 'pickaxe', tier, charge: 0 });
    acts.start('chop', this.pickaxeMesh(), {
      speed: 1 + tier * 0.08,
      onImpact: () => {
        acts.hitStop = 0.05;
        const res = m.strikeRock(x, z, 1 + tier);
        // The pick also bonks whatever is standing in front (a rock crab pretending to be a rock).
        const dir = facingVec(player.facing);
        const hits = m.strike(origin, dir, 1.35, 0.5, [3, 5], 0);
        for (const h of hits) this.game.events.emit('combat:monsterHit', { kind: h.monster.kind, damage: h.damage, crit: false, killed: h.killed, x: h.monster.pos.x, z: h.monster.pos.z });
        if (this.freezeOnImpact) {
          this.freezeOnImpact = false;
          setTimeout(() => {
            acts.frozen = true;
            m.freezeFx = true;
          }, 60);
        }
        if (res) {
          this.game.services.energy?.spend(res.broke ? 2 : 1);
          this.game.events.emit('mine:rockHit', { x, z, ore: res.ore, broke: res.broke });
          this.game.events.emit('tool:impact', { tool: 'pickaxe', x, z, hit: 'stone', strength: res.broke ? 1.2 : 1 });
          if (res.broke) acts.hitStop = 0.08;
        } else {
          const c = new THREE.Vector3(x + 0.5, m.heightAt(x + 0.5, z + 0.5) + 0.05, z + 0.5);
          m.fx.puff(c, { color: BIOMES[m.layout.biome].floor[0], count: 4, speed: 0.8, up: 0.5, size: 0.4, grow: 1.3, gravity: -0.2, drag: 3, life: 0.5, alpha: 0.4 });
          this.game.rc.rig.addShake(0.05);
          this.game.events.emit('tool:impact', { tool: 'pickaxe', x, z, hit: 'none', strength: 0.3 });
        }
      },
    });
  }

  // ───────────────────────────────────────────── interaction

  private interact(x: number, z: number): void {
    const game = this.game;
    if (this.busy) return;
    const id = game.world.current?.id;
    if (id === 'mine-entrance') {
      const p = game.player.position;
      if (Math.hypot(p.x - LIFT.x, p.z - (LIFT.z + 0.6)) < 2.2) {
        game.events.emit('ui:open', { name: 'elevator' });
      } else if (Math.abs(p.x - MOUTH.x) < 2 && p.z < MOUTH.z + 2.4) void this.goto(1, 'entrance');
      return;
    }
    const m = this.mine();
    if (!m) return;
    switch (m.interactAt(x, z)) {
      case 'ladderDown':
        void this.goto(this.cur + 1, 'ladder');
        break;
      case 'ladderUp':
        // The ladder up climbs all the way out (the lift is the way back down).
        void this.goto(0, 'ladder');
        break;
      case 'elevator':
        game.events.emit('ui:open', { name: 'elevator' });
        break;
      case 'chest':
        if (m.openChest()) {
          this.chests.add(m.floor);
          game.events.emit('mine:chest', { floor: m.floor });
        }
        break;
    }
  }

  // ───────────────────────────────────────────── frame

  update(dt: number, game: Game): void {
    const id = game.world.current?.id;
    const inMine = id === 'mine' || id === 'mine-entrance';
    this.plaque.show(inMine && game.opts.hud);
    this.numbers.update(dt, game.rc.camera, window.innerWidth, window.innerHeight);
    if (!inMine) return;
    const key = `${id}:${this.cur}`;
    if (this.plaqueKey !== key) {
      this.plaqueKey = key;
      if (id === 'mine') {
        const m = this.mine()!;
        this.plaque.set(m.floor, BIOMES[m.layout.biome].name, m.layout.biome);
      } else this.plaque.set(0, 'Mountain shelf', 'entrance');
    }
    // Keep the mine-action pose driver installed over whatever the farm installs.
    const m = this.mine();
    if (m) this.cur = m.floor;
  }

  private plaqueKey = '';

  onMapChange(mapId: string): void {
    if (mapId !== 'mine' && mapId !== 'mine-entrance') this.cur = 0;
    if (mapId === 'mine-entrance') this.cur = 0;
    this.plaqueKey = '';
  }

  // ───────────────────────────────────────────── demos

  private stageDemo(name: string): void {
    const game = this.game;
    if (name === 'mine-entrance') {
      game.player.teleport(22.6, 14.4);
      return;
    }
    if (!(name in DEMO_FLOORS) || game.world.current?.id !== 'mine') return;
    const q = new URLSearchParams(location.search);
    const n = Number(q.get('floor')) || DEMO_FLOORS[name]!;
    const m = this.mine()!;
    m.setFloor(n);
    this.cur = n;
    this.best = Math.max(this.best, n);
    if (name === 'mine-chest' && m.layout.chest) {
      // Stand just south of the chest, facing it; open it after a beat (&open=0 keeps it shut).
      const c = m.layout.chest;
      if (q.get('open') !== '0') this.chests.delete(n);
      m.freezeAI = true;
      for (const mo of [...m.monsters]) if (Math.hypot(mo.pos.x - c.x, mo.pos.z - c.z) < 5) m.removeMonster(mo);
      // Side-on: the farmer stands west of the chest, facing it, so lid, glow and farmer all read.
      game.player.teleport(c.x - 0.75, c.z + 0.62);
      setTimeout(() => game.player.setFacing('right'), 0);
      if (q.get('open') !== '0')
        setTimeout(() => {
          if (this.mine() !== m) return;
          game.player.setFacing('right');
          this.interact(c.x, c.z);
        }, 700);
      this.plaqueKey = '';
      return;
    }
    const spot = showcaseSpot(m, name === 'mine-combat');
    game.player.teleport(spot.x, spot.z);
    // Nothing standing inside the farmer (or hiding them) in a staged frame.
    for (const mo of [...m.monsters]) if (Math.hypot(mo.pos.x - spot.x, mo.pos.z - spot.z) < 2.4) m.removeMonster(mo);
    this.plaqueKey = '';
    // `&pick=1`: swing the pickaxe at the nearest ore rock (side-on); with `&still=1` the pose,
    // chips and wobble freeze on the impact frame.
    if (q.get('pick') === '1') this.stagePick(m, q.get('still') === '1');
  }

  private freezeOnImpact = false;

  private stagePick(m: MineMap, still: boolean): void {
    const p = this.game.player.position;
    let best: { x: number; z: number; s: number } | null = null;
    for (const rk of m.rocks?.rocks ?? []) {
      if (!rk.alive) continue;
      const sx = rk.spec.x - 1;
      const sz = rk.spec.z;
      if (!m.grid.isWalkable(sx, sz)) continue;
      const s = Math.hypot(sx + 0.5 - p.x, sz + 0.5 - p.z) - (rk.spec.ore ? 2.5 : 0);
      if (!best || s < best.s) best = { x: rk.spec.x, z: rk.spec.z, s };
    }
    if (!best) return;
    this.game.player.teleport(best.x - 0.5, best.z + 0.5);
    m.freezeAI = true;
    const tx = best.x;
    const tz = best.z;
    this.freezeOnImpact = still;
    // After the demo applies its own facing (same tick), turn to the rock; then chop on a loop so
    // any capture sequence catches a full swing (a still freezes the first impact, chips and all).
    setTimeout(() => this.game.player.setFacing('right'), 0);
    const loop = (): void => {
      if (this.mine() !== m) return;
      const rk = m.rockAt(tx, tz);
      if (!rk) return;
      rk.hp = Math.max(rk.hp, 2);
      this.game.player.setFacing('right');
      this.usePickaxe(tx, tz);
      if (!still) setTimeout(loop, 1500);
    };
    setTimeout(loop, 900);
  }

  save(): unknown {
    return { deepest: this.best, chests: [...this.chests] };
  }

  load(data: unknown): void {
    const d = data as { deepest?: number; chests?: number[] } | null;
    this.best = d?.deepest ?? 0;
    this.chests.clear();
    for (const f of d?.chests ?? []) this.chests.add(f);
  }
}

function facingVec(f: string): THREE.Vector3 {
  return f === 'up' ? new THREE.Vector3(0, 0, -1) : f === 'down' ? new THREE.Vector3(0, 0, 1) : f === 'left' ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0);
}


/**
 * Pick the most photogenic walkable tile on a floor: ore rocks and crystals close by (and for the
 * combat demo, open floor around it), away from the walls.
 */
function showcaseSpot(m: MineMap, open: boolean): { x: number; z: number } {
  const L = m.layout;
  let best = { x: L.spawn.x, z: L.spawn.z, s: -1e9 };
  for (let z = 4; z < FLOOR_D - 4; z++) {
    for (let x = 5; x < FLOOR_W - 5; x++) {
      if (!m.grid.isWalkable(x, z)) continue;
      let s = 0;
      for (const r of L.rocks) {
        const d = Math.hypot(r.x - x, r.z - z);
        if (d < 5) s += (r.ore ? 3 : 0.6) * (1 - d / 5);
        if (d < 1.2) s -= 4;
      }
      for (const c of L.crystals) {
        const d = Math.hypot(c.x - x, c.z - z);
        if (d < 6) s += 2.2 * (1 - d / 6);
      }
      // Lava channels / frozen pools in view (but not underfoot).
      for (let dz = -4; dz <= 5; dz++)
        for (let dx = -6; dx <= 6; dx++) {
          const i = (z + dz) * FLOOR_W + x + dx;
          if (i < 0 || i >= L.lava.length) continue;
          const d = Math.hypot(dx, dz);
          if (L.lava[i] || L.pool[i]) s += d < 1.6 ? -3 : L.lava[i] ? 1.3 : 0.5;
        }
      let openN = 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (m.grid.isWalkable(x + dx, z + dz)) openN++;
      s += openN * (open ? 0.6 : 0.2);
      // Keep the lower half of the frame (towards the camera) inside the cave.
      for (let dz = 1; dz <= 4; dz++) if (L.solid[(z + dz) * FLOOR_W + x]) s -= 1.5;
      // ...and a dressed back wall in the upper third: open floor for 2–3 tiles north, then rock.
      for (let dz = 1; dz <= 2; dz++) if (L.solid[(z - dz) * FLOOR_W + x]) s -= 2.5;
      let wallN = false;
      for (let dz = 3; dz <= 6; dz++) if (L.solid[(z - dz) * FLOOR_W + x]) wallN = true;
      if (wallN) s += 2;
      if (s > best.s) best = { x: x + 0.5, z: z + 0.5, s };
    }
  }
  return best;
}
