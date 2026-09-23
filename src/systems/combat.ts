/**
 * CombatSystem: player health + the Miner's Shortsword.
 *   - Sword: alternating slash / backslash poses (world/mine/actions), a bold 125° crescent slash
 *     (SlashArc: sweeps in with the blade, flashes on impact, fades) over a blade-tip ribbon, aim assist to the nearest monster, arc hit test on the impact frame (MineMap.strike):
 *     knockback, white hit flash, goo / shell chips, hit-stop, camera kick, pop-up damage numbers
 *     (gold + bigger on crits).
 *   - Health: 100 hp, i-frames after a hit (flicker), knockback away from the attacker, red edge
 *     pulse, hurt number; refilled each morning. Service `health` (the HUD's red tube reads it).
 *   - Passing out at 0 hp in the mine: lantern gutters, blackout, a passing miner carries the
 *     farmer to the lean-to at the mine entrance (+2 h), some gold and a few loot stacks are lost.
 *   - Demo `mine-combat`: a live arena (monsters keep moving while the demo is paused) with an
 *     autopilot that keeps swinging at whatever wobbles closest; killed monsters are replaced.
 *     URL &still=1 freezes the first landed hit (pose, crescent, flash, numbers); &god=1 = no damage.
 *   in:  item:use (sword), combat:playerHit, day:start, demo:stage, map:change
 *   out: combat:swing, combat:monsterHit, combat:health, combat:passOut
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { MineMap } from '../world/mine';
import { Crab } from '../entities/monsters';
import { mineActions, buildSword, SwordTrail, SlashArc, SWORD_TIP, SWORD_BASE } from '../world/mine/actions';
import { DamageNumbers, ScreenFx } from '../world/mine/hud';
import { mineSfx } from '../world/mine/sfx';
import type { MonsterKind } from '../world/mine/biomes';
import { itemDef } from '../data/items';
import '../world/mine/events';

export interface HealthApi {
  value(): number;
  max(): number;
  set(n: number): void;
  heal(n: number): void;
  /** Take damage (ignored during i-frames). Returns the damage actually dealt. */
  damage(n: number): number;
}

declare module '../core/game' {
  interface GameServices {
    health: HealthApi;
  }
}

const MAX_HP = 100;
const IFRAMES = 1.1;
const REACH = 1.75;
const ARC_COS = Math.cos(THREE.MathUtils.degToRad(82));
const BASE_DMG: [number, number] = [8, 13];
const CRIT = 0.1;

const FACE: Record<string, THREE.Vector3> = {
  up: new THREE.Vector3(0, 0, -1),
  down: new THREE.Vector3(0, 0, 1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
};

export class CombatSystem implements System, HealthApi {
  readonly name = 'combat';
  private game!: Game;
  private hp = MAX_HP;
  private iframes = 0;
  private sword: THREE.Object3D | null = null;
  private trail = new SwordTrail(0xfff0cc);
  private arc = new SlashArc();
  /** URL `&god=1`: staged mine shots never lose the farmer to a stray slime. */
  private god = false;
  /** URL `&still=1` on mine-combat: freeze the first landed hit (crescent + hit flash) for a still. */
  private still = false;
  private numbers!: DamageNumbers;
  private screen!: ScreenFx;
  private side = false;
  private push = new THREE.Vector3();
  private passing = false;
  private tip = new THREE.Vector3();
  private base = new THREE.Vector3();
  /** mine-combat demo autopilot. */
  private auto: { t: number; min: number } | null = null;

  init(game: Game): void {
    this.game = game;
    game.provide('health', this);
    game.scene.add(this.trail.mesh, this.arc.mesh);
    const q = new URLSearchParams(location.search);
    this.god = q.get('god') === '1';
    this.still = q.get('still') === '1';
    this.numbers = new DamageNumbers(game.opts.uiRoot);
    this.screen = new ScreenFx(game.opts.uiRoot);

    game.events.on('item:use', ({ itemId }) => {
      if (itemId === 'sword') this.swing();
    });
    game.events.on('combat:playerHit', ({ damage, x, z, kind }) => this.hurt(damage, x, z, kind));
    game.events.on('combat:monsterHit', ({ damage, crit, x, z }) => {
      // Pickaxe bonks (the sword pops its own numbers with the exact anchor).
      if (this.swinging) return;
      this.numbers.pop(new THREE.Vector3(x, (this.mine()?.heightAt(x, z) ?? 0) + 1.1, z), String(damage), crit ? 'crit' : 'dmg');
    });
    game.events.on('day:start', () => this.set(MAX_HP));
    game.events.on('map:change', ({ map }) => {
      this.trail.reset();
      this.numbers.clear();
      if (map !== 'mine') this.auto = null;
      if ((map === 'mine' || map === 'mine-entrance') && !this.passing) this.grantSword();
    });
    game.events.on('demo:stage', ({ name }) => {
      this.auto = null;
      if (name === 'mine-combat') this.stageCombat();
    });
  }

  // ───────────────────────────────────────────── health api

  value(): number {
    return this.hp;
  }

  max(): number {
    return MAX_HP;
  }

  set(n: number): void {
    this.hp = Math.max(0, Math.min(MAX_HP, Math.round(n)));
    this.game.events.emit('combat:health', { hp: this.hp, max: MAX_HP });
  }

  heal(n: number): void {
    this.set(this.hp + n);
  }

  damage(n: number): number {
    if (this.iframes > 0 || this.passing) return 0;
    const before = this.hp;
    this.set(this.hp - n);
    return before - this.hp;
  }

  // ───────────────────────────────────────────── helpers

  private mine(): MineMap | null {
    const m = this.game.world.current;
    return m instanceof MineMap ? m : null;
  }

  private swinging = false;

  private grantSword(): void {
    const inv = this.game.services.inventory;
    if (!inv || inv.count('sword') > 0) return;
    if (new URLSearchParams(location.search).has('demo')) {
      // Staged shots: slip it into the backpack quietly (no toasts over the beauty frame).
      const free = inv.slots.findIndex((s, i) => i >= 10 && !s);
      if (free >= 0) inv.setSlot(free, { id: 'sword', qty: 1 });
      return;
    }
    inv.add('sword', 1);
    this.game.events.emit('ui:toast', { text: `Found a <b>${itemDef('sword')?.name ?? 'sword'}</b> by the mine mouth`, icon: 'sword', kind: 'good' });
  }

  /** Face the nearest live monster in reach (cardinal, like the rest of the controls). */
  private aim(): void {
    const m = this.mine();
    if (!m) return;
    const p = this.game.player.position;
    let best: { d: number; dx: number; dz: number } | null = null;
    for (const mo of m.monsters) {
      if (!mo.alive) continue;
      const dx = mo.pos.x - p.x;
      const dz = mo.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < REACH + 0.9 && (!best || d < best.d)) best = { d, dx, dz };
    }
    if (!best) return;
    const f = Math.abs(best.dx) > Math.abs(best.dz) ? (best.dx > 0 ? 'right' : 'left') : best.dz > 0 ? 'down' : 'up';
    if (f !== this.game.player.facing) this.game.player.setFacing(f);
  }

  // ───────────────────────────────────────────── sword

  swing(): void {
    if (this.passing) return;
    const player = this.game.player;
    const acts = mineActions(player);
    if (acts.active) return;
    this.sword ??= buildSword();
    this.aim();
    const kind = this.side ? 'backslash' : 'slash';
    this.side = !this.side;
    this.trail.reset();
    mineSfx.whoosh();
    this.game.events.emit('combat:swing', { x: player.position.x, z: player.position.z });
    this.game.events.emit('tool:swing', { tool: 'sword', tier: 0, charge: 0 });
    const origin = player.position.clone();
    const dir = FACE[player.facing]!.clone();
    let arcFired = false;
    acts.start(kind, this.sword, {
      speed: 1.05,
      onUpdate: (t) => {
        // Ribbon across the whole cutting part of the swing (secondary layer under the crescent).
        if (t > 0.02 && t < 0.38) {
          acts.toolPoint(SWORD_TIP, this.tip);
          acts.toolPoint(SWORD_BASE, this.base);
          this.trail.push(this.tip, this.base);
        }
        // The crescent sweeps in with the blade so it is full length on the impact frame.
        if (!arcFired && t >= 0.085) {
          arcFired = true;
          this.arc.fire(player.position, dir, kind === 'slash' ? 1 : -1);
        }
      },
      onImpact: () => {
        if (!arcFired) {
          arcFired = true;
          this.arc.fire(player.position, dir, kind === 'slash' ? 1 : -1);
        }
        this.resolve(origin, dir);
      },
    });
  }

  private resolve(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const m = this.mine();
    if (!m) return;
    const acts = mineActions(this.game.player);
    const hits = m.strike(origin, dir, REACH, ARC_COS, BASE_DMG, CRIT);
    this.arc.impact(hits.some((h) => h.crit));
    if (!hits.length) return;
    this.swinging = true;
    let crit = false;
    let kill = false;
    const at = new THREE.Vector3();
    for (const h of hits) {
      crit ||= h.crit;
      kill ||= h.killed;
      h.monster.headPos(at);
      at.y -= h.monster.kind === 'bat' ? 0.3 : 0.1;
      this.numbers.pop(at, String(h.damage), h.crit ? 'crit' : 'dmg');
      this.game.events.emit('combat:monsterHit', { kind: h.monster.kind, damage: h.damage, crit: h.crit, killed: h.killed, x: h.monster.pos.x, z: h.monster.pos.z });
    }
    this.swinging = false;
    acts.hitStop = crit || kill ? 0.11 : 0.065;
    if (this.still && this.auto) {
      // Staged still: hold the impact frame (pose, crescent, flash, numbers) indefinitely.
      acts.frozen = true;
      this.arc.pin();
      m.freezeAI = true;
      setTimeout(() => (m.freezeFx = true), 50);
      this.numbers.hold = true;
      for (const h of hits) h.monster.holdFlash = true;
      this.auto = null;
    }
    this.game.rc.rig.addShake(crit ? 0.32 : kill ? 0.26 : 0.16);
    m.lighting.flash = Math.max(m.lighting.flash, crit ? 0.35 : 0.15);
  }

  // ───────────────────────────────────────────── getting hurt

  private hurt(damage: number, x: number, z: number, kind: MonsterKind): void {
    const m = this.mine();
    if (!m || this.passing || this.god) return;
    let dmg = damage;
    if (this.auto) dmg = Math.min(dmg, Math.max(0, this.hp - this.auto.min));
    const dealt = this.damage(dmg);
    if (dealt <= 0 && !this.auto) return;
    this.iframes = IFRAMES;
    const p = this.game.player.position;
    const away = new THREE.Vector3(p.x - x, 0, p.z - z);
    if (away.lengthSq() < 1e-4) away.copy(FACE[this.game.player.facing]!).negate();
    away.normalize();
    this.push.copy(away).multiplyScalar(kind === 'crab' ? 7 : 5.5);
    // Above the hat and off to the side away from the attacker (never red-on-straw).
    const side = Math.abs(p.x - x) > 0.05 ? Math.sign(p.x - x) : 1;
    this.numbers.pop(new THREE.Vector3(p.x + side * 0.6, p.y + 2.6, p.z), `-${this.auto ? damage : Math.max(dealt, dmg)}`, 'player');
    this.screen.hit();
    this.game.rc.rig.addShake(0.35);
    m.lighting.flash = 0.2;
    mineSfx.hurt();
    if (this.hp <= 0) void this.passOut(m);
  }

  private async passOut(m: MineMap): Promise<void> {
    if (this.passing) return;
    this.passing = true;
    const game = this.game;
    const floor = m.floor;
    game.events.emit('combat:passOut', { floor });
    game.player.controllable = false;
    mineActions(game.player).cancel();
    m.playerTargetable = false;
    mineSfx.passOut();
    // Lantern gutters out, then black.
    const t0 = performance.now();
    await new Promise<void>((res) => {
      const tick = (): void => {
        const k = Math.min(1, (performance.now() - t0) / 1400);
        m.lighting.lanternScale = 1 - k * 0.92;
        if (k < 1) requestAnimationFrame(tick);
        else res();
      };
      tick();
    });
    const lost = this.penalty();
    this.screen.blackout(true, `You collapse on floor ${floor}…<br><small>A passing miner carries you back up to the light.</small>`);
    await new Promise((r) => setTimeout(r, 2400));
    m.lighting.lanternScale = 1;
    m.playerTargetable = true;
    await game.teleport('mine-entrance', 14.6, 15.2);
    game.player.setFacing('down');
    game.calendar.setHour(Math.min(25.5, game.calendar.hour + 2));
    this.hp = 0;
    this.set(Math.round(MAX_HP * 0.35));
    game.services.energy?.set(Math.round((game.services.energy?.max() ?? 100) * 0.3));
    this.screen.blackout(false);
    await new Promise((r) => setTimeout(r, 900));
    game.hud.banner('Hollowdeep Mine', 'You wake by the miners’ lean-to');
    if (lost) game.events.emit('ui:toast', { text: lost, kind: 'bad' });
    game.player.controllable = true;
    this.passing = false;
  }

  /** Lose 10 % of the purse (max 500g) and up to three loot stacks picked up underground. */
  private penalty(): string {
    const game = this.game;
    const parts: string[] = [];
    const eco = game.services.economy;
    if (eco) {
      const g = eco.gold();
      const loss = Math.min(500, Math.floor(g * 0.1));
      if (loss > 0) {
        eco.set(g - loss);
        parts.push(`${loss}g`);
      }
    }
    const inv = game.services.inventory;
    if (inv) {
      const loot = inv.slots
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s && itemDef(s.id)?.kind === 'resource')
        .sort(() => Math.random() - 0.5)
        .slice(0, 3);
      for (const { s, i } of loot) {
        const take = Math.max(1, Math.ceil(s!.qty * 0.5));
        inv.takeFromSlot(i, take);
        parts.push(`${take} ${itemDef(s!.id)?.name ?? s!.id}`);
      }
    }
    return parts.length ? `Lost while unconscious: ${parts.join(', ')}` : '';
  }

  // ───────────────────────────────────────────── frame

  update(dt: number, game: Game): void {
    this.trail.update(dt);
    this.arc.update(dt);
    this.numbers.update(dt, game.rc.camera, window.innerWidth, window.innerHeight);
    this.screen.update(dt);
    const player = game.player;
    const m = this.mine();
    // I-frame flicker + knockback slide (collision-checked against the tile grid).
    if (this.iframes > 0) {
      this.iframes = Math.max(0, this.iframes - dt);
      // Classic i-frame blink (not in the staged demo: a still must never catch the farmer invisible).
      player.root.visible = !!this.auto || this.iframes <= 0 || Math.floor(this.iframes * 16) % 2 === 0;
    } else if (!player.root.visible && !this.passing) player.root.visible = true;
    if (this.push.lengthSq() > 1e-4) {
      const grid = game.world.current?.grid;
      const p = player.position;
      const nx = p.x + this.push.x * dt;
      const nz = p.z + this.push.z * dt;
      const r = player.radius;
      const ok = (x: number, z: number): boolean => !!grid && [[-r, -r], [r, -r], [-r, r], [r, r]].every(([ox, oz]) => grid.isWalkable(Math.floor(x + ox!), Math.floor(z + oz!)));
      if (ok(nx, p.z)) p.x = nx;
      if (ok(p.x, nz)) p.z = nz;
      p.y = game.world.heightAt(p.x, p.z);
      this.push.multiplyScalar(Math.exp(-dt * 9));
    }
    if (this.auto && m) this.autopilot(dt, m);
  }

  // ───────────────────────────────────────────── demo

  private stageCombat(): void {
    const m = this.mine();
    if (!m) return;
    this.grantSword();
    const inv = this.game.services.inventory;
    if (inv) {
      const i = inv.slots.findIndex((s) => s?.id === 'sword');
      if (i >= 10) {
        const tmp = inv.slots[4] ?? null;
        inv.setSlot(4, inv.slots[i]!);
        inv.setSlot(i, tmp);
      }
      const j = inv.slots.findIndex((s) => s?.id === 'sword');
      if (j >= 0 && j < 10) this.game.events.emit('toolbar:select', { slot: j });
    }
    this.set(MAX_HP * 0.78);
    m.live = true;
    this.populate(m, true);
    this.auto = { t: 0.9, min: 62 };
  }

  /** Keep a small pack of monsters around the player in the demo arena. */
  private populate(m: MineMap, initial: boolean): void {
    const p = this.game.player.position;
    const want: MonsterKind[] = ['slime', 'slime', 'bat', 'crab'];
    const have = m.monsters.filter((x) => x.alive && Math.hypot(x.pos.x - p.x, x.pos.z - p.z) < 7);
    if (initial) {
      // Clear the rest of the floor's monsters so the fight reads.
      for (const x of m.monsters) if (!have.includes(x)) x.dead = true;
    }
    const counts: Record<MonsterKind, number> = { slime: 0, bat: 0, crab: 0 };
    for (const h of have) counts[h.kind]++;
    const ring = [
      [1.9, -0.6],
      [-1.8, 0.4],
      [0.5, -2.3],
      [-0.6, 2.0],
      [2.4, 1.3],
      [-2.4, -1.4],
    ];
    let k = Math.floor(Math.random() * ring.length);
    for (const kind of want) {
      if (counts[kind] > 0) {
        counts[kind]--;
        continue;
      }
      for (let tries = 0; tries < ring.length; tries++, k++) {
        const [ox, oz] = ring[k % ring.length]!;
        const x = p.x + ox!;
        const z = p.z + oz!;
        if (!m.grid.isWalkable(Math.floor(x), Math.floor(z))) continue;
        const mo = m.addMonster(kind, x, z);
        mo.aggro = true;
        if (mo instanceof Crab) mo.wake();
        if (kind === 'bat') mo.pos.y += 1.2;
        k++;
        break;
      }
    }
  }

  private autopilot(dt: number, m: MineMap): void {
    const a = this.auto!;
    a.t -= dt;
    const acts = mineActions(this.game.player);
    if (a.t > 0 || acts.active) return;
    const p = this.game.player.position;
    const near = m.monsters.some((x) => x.alive && Math.hypot(x.pos.x - p.x, x.pos.z - p.z) < REACH + 1);
    if (near) {
      this.swing();
      a.t = 0.5 + Math.random() * 0.25;
    } else {
      a.t = 0.25;
    }
    if (m.monsters.filter((x) => x.alive).length < 3) this.populate(m, false);
  }

  save(): unknown {
    return { hp: this.hp };
  }

  load(data: unknown): void {
    const hp = (data as { hp?: number })?.hp;
    if (typeof hp === 'number') this.hp = Math.max(1, Math.min(MAX_HP, hp));
  }
}
