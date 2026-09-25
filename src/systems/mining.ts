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
import { MineCoop } from '../world/mine/coop';
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
const DEMO_FLOORS: Record<string, number> = { 'mine-coop': 4, 'mine-floor': 3, 'mine-ice': 14, 'mine-lava': 24, 'mine-combat': 2, 'mine-chest': 10, mine: 1 };

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
  /** Co-op: host-authoritative floors (world/mine/coop.ts). */
  private coop!: MineCoop;

  init(game: Game): void {
    this.game = game;
    registerMineIcons();
    game.world.registerMap('mine-entrance', (g) => new MineEntranceMap(g));
    game.world.registerMap('mine', (g) => new MineMap(g));
    game.provide('mining', this);
    this.coop = new MineCoop(game);

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
    }
    // (no banner on the entrance: the HOLLOWDEEP sign over the mouth already says it, and a banner
    // printed right over it; the floor plaque names the place)
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
    this.coop.update(dt, game.time);
    const id = game.world.current?.id;
    const inMine = id === 'mine' || id === 'mine-entrance';
    this.plaque.show(inMine && game.opts.hud);
    if (inMine) this.plaque.dodge(dt);
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
    this.coop.clearDemo();
    mineActions(game.player).twist = 0;
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
    // Staged frames: nothing hugs the farmer (a rock just north of them is drawn behind the hat).
    // (the 42° camera draws anything up to ~2.3 m north of the farmer right behind the hat)
    const hug = (m.rocks?.rocks ?? []).filter((r) => {
      if (!r.alive) return false;
      const dx = r.pos.x - spot.x;
      const dz = r.pos.z - spot.z;
      return Math.hypot(dx, dz) < 0.6 + 0.5 * r.scale || (dz < 0 && dz > -2.4 && Math.abs(dx) < 0.75 + 0.45 * r.scale);
    });
    m.removeRocks(hug.map((r) => r.spec.z * FLOOR_W + r.spec.x));
    // Nothing standing inside the farmer (or hiding them) in a staged frame.
    for (const mo of [...m.monsters]) if (Math.hypot(mo.pos.x - spot.x, mo.pos.z - spot.z) < 2.4) m.removeMonster(mo);
    this.plaqueKey = '';
    // `&pick=1`: swing the pickaxe at the nearest ore rock (side-on); with `&still=1` the pose,
    // chips and wobble freeze on the impact frame.
    if (q.get('pick') === '1') this.stagePick(m, q.get('still') === '1');
    // Beauty frames carry a clear threat in view (a biome monster sizing the farmer up, a few
    // steps off to the side); `&foe=0` leaves it out.
    else if (name === 'mine-coop') this.coop.stageDemo(m, spot);
    else if (name !== 'mine-combat' && name !== 'mine' && q.get('foe') !== '0') this.stageFoe(m, spot);
  }

  private stageFoe(m: MineMap, spot: { x: number; z: number }): void {
    const kind = m.layout.biome === 'ice' ? 'wisp' : m.layout.biome === 'lava' ? 'imp' : 'slime';
    const ring: [number, number][] = [];
    for (const r of [2.6, 2.1, 3.2]) for (let k = 0; k < 12; k++) ring.push([Math.cos((k / 12) * Math.PI * 2 + 0.3) * r, Math.sin((k / 12) * Math.PI * 2 + 0.3) * r * 0.8]);
    // Prefer beside / below the farmer (reads in frame) over behind them.
    ring.sort((a, b) => Math.abs(a[1]) * 0.6 - a[1] * 0.3 - (Math.abs(b[1]) * 0.6 - b[1] * 0.3));
    for (const [ox, oz] of ring) {
      const x = spot.x + ox;
      const z = spot.z + oz;
      const fly = kind === 'wisp';
      if (!m.grid.isWalkable(Math.floor(x), Math.floor(z)) || !m.clearAt(x, z, 0.5, fly)) continue;
      if (m.rocks?.rocks.some((r) => r.alive && Math.hypot(r.pos.x - x, r.pos.z - z) < 0.9)) continue;
      const mo = m.addMonster(kind, x, z);
      mo.root.rotation.y = Math.atan2(spot.x - x, spot.z - z);
      m.freezeAI = true;
      return;
    }
  }

  private freezeOnImpact = false;

  private stagePick(m: MineMap, still: boolean): void {
    const p = this.game.player.position;
    const L = m.layout;
    const open = (x: number, z: number): boolean => m.grid.isWalkable(x, z) && !m.rockAt(x, z);
    let best: { x: number; z: number; s: number } | null = null;
    for (const rk of m.rocks?.rocks ?? []) {
      if (!rk.alive) continue;
      // Side-on: the farmer stands just WEST of the rock facing right, so the pick's whole arc,
      // the head biting into the stone and the chips all read in profile (a face-the-camera chop
      // only showed the hat crown), and the torso turns three-quarters towards the lens.
      const sx = rk.spec.x - 1;
      const sz = rk.spec.z;
      if (!open(sx, sz)) continue;
      // Open floor towards the camera (nothing between the lens and the swing) and beside it.
      if (!open(sx, sz + 1) || !m.grid.isWalkable(rk.spec.x, sz + 1) || !open(sx - 1, sz)) continue;
      let s = -Math.hypot(sx + 0.5 - p.x, sz + 0.5 - p.z) * 0.35;
      if (rk.spec.ore) s += 4;
      // Keep walls out of the foreground (the lower third of the frame) and a dressed wall behind.
      for (let dz = 1; dz <= 3; dz++) for (let dx = -2; dx <= 2; dx++) if (L.solid[(sz + dz) * FLOOR_W + sx + dx]) s -= 0.8;
      for (let dz = 3; dz <= 6; dz++) if (L.solid[(sz - dz) * FLOOR_W + sx]) { s += 1.5; break; }
      if (!best || s > best.s) best = { x: rk.spec.x, z: rk.spec.z, s };
    }
    if (!best) return;
    const fx = best.x + 0.5 - 0.78;
    const fz = best.z + 0.55;
    this.game.player.teleport(fx, fz);
    // Nothing else crowding the swing, and nothing in front of it (towards the camera) or right
    // behind the hat.
    const crowd = (m.rocks?.rocks ?? []).filter((r) => {
      if (!r.alive || (r.spec.x === best!.x && r.spec.z === best!.z)) return false;
      const dx = r.pos.x - (fx + 0.4);
      const dz = r.pos.z - fz;
      return Math.hypot(dx, dz) < 1.5 || (dz > 0 && dz < 2.6 && Math.abs(dx) < 1.3) || (dz < 0 && dz > -1.8 && Math.abs(dx) < 1.0);
    });
    m.removeRocks(crowd.map((r) => r.spec.z * FLOOR_W + r.spec.x));
    for (const mo of [...m.monsters]) if (Math.hypot(mo.pos.x - fx, mo.pos.z - fz) < 2.4) m.removeMonster(mo);
    m.freezeAI = true;
    const tx = best.x;
    const tz = best.z;
    this.freezeOnImpact = still;
    const acts = mineActions(this.game.player);
    // Three-quarter turn towards the camera (the farmer faces +X; negative yaw swings the chest to +Z).
    acts.twist = -0.8;
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
      // Hard clearance: nothing (rock, crystal, solid prop) within 1.15 tiles of the farmer's
      // feet — no crystal ever clips into the hat or body in a staged frame.
      const cx = x + 0.5;
      const cz = z + 0.5;
      // (anything just NORTH of the farmer is drawn behind the hat by the 3/4 camera: it needs
      // ~1.7x the room of things beside / in front)
      const room = (x: number, z: number): number => Math.hypot(x - cx, (z - cz) * (z < cz ? 0.72 : 1));
      if (L.rocks.some((r) => Math.hypot(r.x + 0.5 - cx, r.z + 0.5 - cz) < 1.15)) continue;
      if (L.crystals.some((c) => room(c.x, c.z) < 1.3)) continue;
      if (L.decor.some((d) => d.solid && Math.hypot(d.x - cx, d.z - cz) < 1.2)) continue;
      // Combat arena: no timber shoring within reach (its cross-beam cuts through the farmer once a
      // fight shoves them about), and open floor to both sides so side-on swings read.
      if (open && L.decor.some((d) => (d.kind === 'post' || d.kind === 'lanternPost') && Math.hypot(d.x - cx, d.z - cz) < 3.2)) continue;
      if (open && [-2, -1, 1, 2].some((dx) => !m.grid.isWalkable(x + dx, z))) continue;
      if (!m.clearAt(cx, cz, 0.6)) continue;
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
      // Ice: a warm survey lantern in frame (amber pool against the blue, not just the farmer's own).
      if (L.biome === 'ice') {
        let warm = 0;
        for (const d of L.decor) {
          if (d.kind !== 'lanternPost') continue;
          const dx = d.x - cx;
          const dz = d.z - cz;
          if (Math.abs(dx) < 8 && dz > -6 && dz < 2.5 && Math.hypot(dx, dz) > 2.2) warm = Math.max(warm, 1);
        }
        s += warm * 3;
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
