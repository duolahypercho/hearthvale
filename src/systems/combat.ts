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
/** Sword tiers: reforged by the treasure chests on floors 10, 20 and 30. */
export const SWORD_TIERS: { name: string; dmg: [number, number] }[] = [
  { name: "Miner's Shortsword", dmg: [8, 13] },
  { name: 'Tempered Shortsword', dmg: [13, 19] },
  { name: 'Glimmersteel Blade', dmg: [19, 27] },
  { name: 'Emberheart Sword', dmg: [27, 38] },
];
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
  /** A still is being held: never blink the farmer out of it. */
  private held = false;
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
    game.events.on('mine:chest', ({ floor }) => this.upgradeSword(Math.floor(floor / 10)));
    game.events.on('map:change', ({ map }) => {
      this.trail.reset();
      this.numbers.clear();
      if (map !== 'mine') this.auto = null;
      this.unchill();
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
    // Any source that empties the tube (monsters, lava, other systems, debug) collapses the farmer.
    if (this.hp <= 0 && !this.passing) void this.passOut(this.mine());
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
  /** Sword tier (0 = the Miner's Shortsword). */
  tier = 0;

  /** Reforge the sword (never downgrades). */
  upgradeSword(tier: number, announce = true): void {
    const t = Math.max(0, Math.min(SWORD_TIERS.length - 1, Math.floor(tier)));
    if (t <= this.tier) return;
    this.tier = t;
    this.sword = null;
    if (!announce) return;
    const d = SWORD_TIERS[t]!;
    this.game.events.emit('ui:toast', { text: `Sword reforged: <b>${d.name}</b> (${d.dmg[0]}–${d.dmg[1]} dmg)`, icon: 'sword', kind: 'good' });
  }

  // ───────────────────────────────────────────── chill (frost wisp)

  private slowT = 0;
  private baseSpeed: [number, number] | null = null;
  private frostT = 0;

  private chill(): void {
    const p = this.game.player;
    this.slowT = 2.5;
    if (!this.baseSpeed) {
      this.baseSpeed = [p.speed, p.runSpeed];
      p.speed *= 0.55;
      p.runSpeed *= 0.55;
    }
  }

  private unchill(): void {
    const p = this.game.player;
    this.slowT = 0;
    if (this.baseSpeed) {
      p.speed = this.baseSpeed[0];
      p.runSpeed = this.baseSpeed[1];
      this.baseSpeed = null;
    }
  }

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

  /**
   * Face the nearest live monster in reach (cardinal, like the rest of the controls). Side-on swings
   * are preferred whenever the target is not almost straight above / below the farmer: the crescent
   * reads across the frame and the monster is never hidden behind the farmer's back.
   */
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
    const side = Math.abs(best.dx) > Math.abs(best.dz) * 0.45;
    const f = side ? (best.dx > 0 ? 'right' : 'left') : best.dz > 0 ? 'down' : 'up';
    if (f !== this.game.player.facing) this.game.player.setFacing(f);
  }

  // ───────────────────────────────────────────── sword

  swing(): void {
    if (this.passing) return;
    const player = this.game.player;
    const acts = mineActions(player);
    if (acts.active) return;
    this.sword ??= buildSword(this.tier);
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

  private proj = new THREE.Vector3();

  /**
   * Screen-space push (px) that keeps a number anchored at `at` off the farmer's silhouette: when
   * it would land inside the farmer's screen box (+40 px) it slides sideways along the knockback
   * (`kx` = world x from farmer to monster) until it clears the box, at least 70 px.
   */
  private clearOfFarmer(at: THREE.Vector3, kx: number): number {
    const cam = this.game.rc.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const toScreen = (v: THREE.Vector3): [number, number] => {
      this.proj.copy(v).project(cam);
      return [(this.proj.x * 0.5 + 0.5) * w, (-this.proj.y * 0.5 + 0.5) * h];
    };
    const p = this.game.player.position;
    const [fx, fy] = toScreen(new THREE.Vector3(p.x, p.y, p.z));
    const [, hy] = toScreen(new THREE.Vector3(p.x, p.y + 2.1, p.z));
    const [ex] = toScreen(new THREE.Vector3(p.x + 0.55, p.y + 1.0, p.z));
    const halfW = Math.abs(ex - fx) + 40;
    const top = hy - 40;
    const bottom = fy + 40;
    const [nx, ny] = toScreen(at);
    if (ny < top || ny > bottom || Math.abs(nx - fx) > halfW) return 0;
    const dirX = Math.abs(kx) > 0.08 ? Math.sign(kx) : nx >= fx ? 1 : -1;
    const need = dirX > 0 ? fx + halfW - nx : nx - (fx - halfW);
    return dirX * Math.max(70, need + 18);
  }

  private resolve(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const m = this.mine();
    if (!m) return;
    const acts = mineActions(this.game.player);
    const hits = m.strike(origin, dir, REACH + this.tier * 0.12, ARC_COS, SWORD_TIERS[this.tier]!.dmg, CRIT);
    this.arc.impact(hits.some((h) => h.crit));
    if (!hits.length) return;
    this.swinging = true;
    let crit = false;
    let kill = false;
    const at = new THREE.Vector3();
    hits.forEach((h, i) => {
      crit ||= h.crit;
      kill ||= h.killed;
      h.monster.headPos(at);
      at.y -= h.monster.kind === 'bat' ? 0.3 : 0.1;
      const kx = h.monster.pos.x - this.game.player.position.x;
      this.numbers.pop(at, String(h.damage), h.crit ? 'crit' : 'dmg', { dx: this.clearOfFarmer(at, kx) + (i % 2 ? 1 : -1) * i * 14, dy: -i * 22 });
      this.game.events.emit('combat:monsterHit', { kind: h.monster.kind, damage: h.damage, crit: h.crit, killed: h.killed, x: h.monster.pos.x, z: h.monster.pos.z });
    });
    this.swinging = false;
    acts.hitStop = crit || kill ? 0.11 : 0.065;
    // (side-on hits only: the crescent reads best across the frame, never hidden behind the hat)
    if (this.still && this.auto && Math.abs(dir.x) > 0.5) {
      // Staged still: hold the impact frame (pose, crescent, flash, numbers) indefinitely.
      acts.frozen = true;
      this.arc.pin();
      m.freezeAI = true;
      setTimeout(() => (m.freezeFx = true), 50);
      this.numbers.hold = true;
      for (const h of hits) h.monster.holdFlash = true;
      this.auto = null;
      this.held = true;
    }
    this.game.rc.rig.addShake(crit ? 0.32 : kill ? 0.26 : 0.16);
    m.lighting.flash = Math.max(m.lighting.flash, crit ? 0.35 : 0.15);
  }

  // ───────────────────────────────────────────── getting hurt

  /** Knockback strength per attacker kind (hazards push hardest: get off the lava lip). */
  private static readonly KNOCK: Record<string, number> = { crab: 7, slime: 5.5, bat: 5.5, wisp: 4.5, imp: 6, lava: 8 };

  private hurt(damage: number, x: number, z: number, kind: MonsterKind | 'lava'): void {
    const m = this.mine();
    if (!m || this.passing || this.god) return;
    if (this.iframes > 0) return;
    let dmg = damage;
    if (this.auto) dmg = Math.min(dmg, Math.max(0, this.hp - this.auto.min));
    const p = this.game.player.position;
    const away = new THREE.Vector3(p.x - x, 0, p.z - z);
    if (away.lengthSq() < 1e-4) away.copy(FACE[this.game.player.facing]!).negate();
    away.normalize();
    this.push.copy(away).multiplyScalar(CombatSystem.KNOCK[kind] ?? 5.5);
    // Number first (damage() may start the pass-out, which clears nothing we need here).
    // Anchored to the farmer's shoulder, off to the side away from the attacker (never on the hat).
    const side = Math.abs(p.x - x) > 0.05 ? Math.sign(p.x - x) : 1;
    const hpBefore = this.hp;
    const dealt = this.damage(dmg);
    if (dealt <= 0 && !this.auto) return;
    this.iframes = IFRAMES;
    this.numbers.pop(p, `-${this.auto ? damage : Math.max(dealt, Math.min(dmg, hpBefore))}`, 'player', { follow: true, off: new THREE.Vector3(side * 0.75, 2.2, 0), dx: side * 26 });
    if (kind === 'wisp') this.chill();
    this.screen.hit();
    this.game.rc.rig.addShake(kind === 'lava' ? 0.22 : 0.35);
    m.lighting.flash = 0.2;
    mineSfx.hurt();
  }

  private async passOut(m: MineMap | null): Promise<void> {
    if (this.passing) return;
    this.passing = true;
    const game = this.game;
    const floor = m?.floor ?? 0;
    this.iframes = 0;
    this.push.set(0, 0, 0);
    game.events.emit('combat:passOut', { floor });
    game.player.controllable = false;
    mineActions(game.player).cancel();
    if (m) m.playerTargetable = false;
    mineSfx.passOut();
    // Lantern gutters out, then black.
    const t0 = performance.now();
    await new Promise<void>((res) => {
      const tick = (): void => {
        const k = Math.min(1, (performance.now() - t0) / 1400);
        if (m) m.lighting.lanternScale = 1 - k * 0.92;
        if (k < 1) requestAnimationFrame(tick);
        else res();
      };
      tick();
    });
    if (!m) {
      // Topside collapse (another system drained the tube): a short blackout, wake where you fell.
      this.screen.blackout(true, 'You collapse from exhaustion…');
      await new Promise((r) => setTimeout(r, 1800));
      this.hp = 0;
      this.set(Math.round(MAX_HP * 0.35));
      this.screen.blackout(false);
      game.player.controllable = true;
      this.passing = false;
      return;
    }
    const lost = this.penalty();
    this.screen.blackout(true, `You collapse on floor ${floor}…<br><small>A passing miner carries you back up to the light.</small>`);
    await new Promise((r) => setTimeout(r, 2400));
    m.lighting.lanternScale = 1;
    m.playerTargetable = true;
    await game.teleport('mine-entrance', 14.6, 15.2);
    game.player.setFacing('down');
    game.calendar.setHour(Math.min(25.5, game.calendar.hour + 2));
    this.hp = Math.round(MAX_HP * 0.35);
    this.set(this.hp);
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
      // I-frame blink between full and 35 % opacity (never invisible: a busy frame or a still must
      // always show the farmer). Not in the staged demo stills.
      const dim = !this.auto && !this.held && this.iframes > 0 && Math.floor(this.iframes * 14) % 2 === 1;
      this.blink(dim ? 0.35 : 1);
    } else if (this.blinking) this.blink(1);
    if (!player.root.visible && !this.passing) player.root.visible = true;
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
    if (this.slowT > 0) {
      this.slowT -= dt;
      this.frostT -= dt;
      if (m && this.frostT <= 0) {
        this.frostT = 0.12;
        const pp = player.position;
        m.fx.sparks(new THREE.Vector3(pp.x + (Math.random() - 0.5) * 0.6, pp.y + 0.3 + Math.random() * 1.2, pp.z + (Math.random() - 0.5) * 0.6), { color: 0xcff4ff, count: 1, speed: 0.2, up: 0.2, size: 0.16, gravity: 0.5, drag: 2, life: 0.6, star: true });
      }
      if (this.slowT <= 0) this.unchill();
    }
    if (this.auto && m) this.autopilot(dt, m);
  }

  private blinkMats: { m: THREE.Material; transparent: boolean; opacity: number }[] | null = null;
  private blinking = false;

  /** Fade the farmer's own materials (restored exactly when the blink ends). */
  private blink(opacity: number): void {
    if (!this.blinkMats) {
      const seen = new Set<THREE.Material>();
      const list: { m: THREE.Material; transparent: boolean; opacity: number }[] = [];
      this.blinkMats = list;
      this.game.player.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || mesh.name === 'shadow') return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (seen.has(m) || m.transparent) continue;
          seen.add(m);
          list.push({ m, transparent: m.transparent, opacity: m.opacity });
        }
      });
    }
    const on = opacity < 0.999;
    if (!on && !this.blinking) return;
    for (const b of this.blinkMats) {
      b.m.transparent = on ? true : b.transparent;
      b.m.opacity = on ? opacity : b.opacity;
      b.m.depthWrite = true;
    }
    // Stay in the transparent pass for the whole i-frame window (one program switch each way).
    if (on) this.blinking = true;
    else if (this.iframes <= 0) this.blinking = false;
    else for (const b of this.blinkMats) (b.m.transparent = true), (b.m.opacity = 1);
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
    const biome = m.layout.biome;
    const want: MonsterKind[] = biome === 'ice' ? ['slime', 'wisp', 'bat', 'wisp'] : biome === 'lava' ? ['slime', 'imp', 'bat', 'imp'] : ['slime', 'slime', 'bat', 'crab'];
    const have = m.monsters.filter((x) => x.alive && Math.hypot(x.pos.x - p.x, x.pos.z - p.z) < 7);
    if (initial) {
      // Clear the rest of the floor's monsters so the fight reads.
      for (const x of m.monsters) if (!have.includes(x)) x.dead = true;
    }
    const counts: Record<MonsterKind, number> = { slime: 0, bat: 0, crab: 0, wisp: 0, imp: 0 };
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
        if (!m.grid.isWalkable(Math.floor(x), Math.floor(z)) || !m.clearAt(x, z, 0.55, kind === 'bat' || kind === 'wisp')) continue;
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
    return { hp: this.hp, sword: this.tier };
  }

  load(data: unknown): void {
    const d = data as { hp?: number; sword?: number } | null;
    if (typeof d?.hp === 'number') this.hp = Math.max(1, Math.min(MAX_HP, d.hp));
    if (typeof d?.sword === 'number') {
      this.tier = 0;
      this.upgradeSword(d.sword, false);
    }
  }
}
