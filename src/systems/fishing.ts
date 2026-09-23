/**
 * FishingSystem — the whole fishing loop, on any map with WaterSource tiles (farm pond, town
 * river, Driftsand Beach):
 *
 *   charging  hold use with the rod: power meter oscillates, farmer cocks the rod back
 *   casting   release: whip forward, bobber flies a parabola, line pays out (verlet rope), plop
 *   waiting   bobber bobs; 0–3 nibbles (dips + rings); a fish shadow circles in
 *   bite      "!" + splash + yank; press use within the window to set the hook
 *   reeling   minigame: hold to lift the catch bar (gravity, bounce), fish AI per behaviour
 *             (mixed / smooth / dart / sinker / floater, scaled by difficulty), progress meter,
 *             treasure chest; the rod bends and shakes, the line goes taut, splashes at the float
 *   caught    fish arcs out of the water into the farmer's hands, held overhead + catch card
 *   escaped / reelin: line snaps or reels back
 *
 * Which fish: data/fish.ts filtered by map / season / hour / weather and zone (depth at the float),
 * weighted by rarity; longer casts into deeper water bias towards rarer fish and bigger sizes.
 * Records (count + best length per species) are saved.
 *   in:  item:use (rod), demo:stage ('fishing-cast' | 'fishing-reel' | 'fishing-catch'), ui:open fishing (practice)
 *   out: fishing:cast, fishing:bite, fishing:hook, fishing:catch, fishing:escape, item:give
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { FISH, fishDef, type FishDef } from '../data/fish';
import { TileFlag } from '../world/tiles';
import { FishingGear } from '../world/beach/tackle';
import { FishingOverlay, type ReelView } from '../ui/fishing';
import { FishingSfx } from '../ui/fishing-sfx';
import '../ui/fishing-art';

export type FishingState = 'idle' | 'charging' | 'casting' | 'waiting' | 'bite' | 'reeling' | 'caught' | 'escaped' | 'reelin';

export interface FishingRecord {
  caught: number;
  best: number;
}

export interface FishingApi {
  state(): FishingState;
  /** Fish that can bite here and now (any zone). */
  available(): FishDef[];
  /** Cast with power 0..1 in the facing direction. */
  cast(power: number): void;
  /** Legacy: force the minigame result (≥ 1 catches, ≤ 0 escapes). */
  reel(progress: number): void;
  records(): Record<string, FishingRecord>;
}

declare module '../core/game' {
  interface GameServices {
    fishing: FishingApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'fishing:cast': { power: number; x: number; z: number };
    'fishing:bite': { fishId: string };
    'fishing:hook': { fishId: string };
    'fishing:catch': { fishId: string; perfect: boolean; size?: number; quality?: number; treasure?: boolean };
    'fishing:escape': { fishId: string };
  }
}

interface Minigame extends ReelView {
  def: FishDef;
  barV: number;
  fishTarget: number;
  retarget: number;
  t: number;
  auto: boolean;
}

const TREASURE: [string, number][] = [
  ['seaGlass', 1],
  ['spiralConch', 1],
  ['cockle', 2],
  ['coralSprig', 1],
  ['stone', 8],
  ['wood', 10],
];

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

interface RigView {
  root: THREE.Group;
  body: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  tool?: THREE.Object3D;
  swingT?: number;
  state?: string;
  yaw?: number;
  targetYaw?: number;
}

export class FishingSystem implements System, FishingApi {
  readonly name = 'fishing';
  private game!: Game;
  private st: FishingState = 'idle';
  private stT = 0;
  private gear!: FishingGear;
  private ui!: FishingOverlay;
  private sfx!: FishingSfx;
  private power = 0;
  private powerT = 0;
  private castPower = 0;
  private castFrom = new THREE.Vector3();
  private target = new THREE.Vector3();
  private onWater = false;
  private depth = 0;
  private bob = new THREE.Vector3();
  private waitT = 0;
  private nibbles: number[] = [];
  private hooked: FishDef | null = null;
  private mg: Minigame | null = null;
  private result: { def: FishDef; lengthCm: number; quality: number; perfect: boolean; treasure: string | null } | null = null;
  private recs: Record<string, FishingRecord> = {};
  /** Demo staging: freeze a phase for screenshots (sim paused). */
  private demo: 'cast' | 'flight' | 'reel' | 'catch' | 'wait' | 'bite' | null = null;
  private practice = false;
  private splashT = 0;
  private biteWindow = 1;
  private wasHolding = false;
  private waterY = 0;
  private catchArc = 0;
  private cardShown = false;
  private heldT = 0;
  /** Where the caught fish is held (between the farmer's hands, in front of the chest). */
  private holdPt = new THREE.Vector3();
  /** Body yaw before the farmer turned to show the catch to the camera (restored after). */
  private preCatchYaw: number | null = null;

  init(game: Game): void {
    this.game = game;
    game.provide('fishing', this);
    this.gear = new FishingGear();
    game.scene.add(this.gear.group);
    this.ui = new FishingOverlay(game.opts.uiRoot);
    this.sfx = new FishingSfx();
    this.giveRod();

    game.events.on('item:use', ({ itemId }) => {
      if (itemId !== 'rod') return;
      if (this.st === 'idle') this.beginCharge();
    });
    game.events.on('toolbar:select', () => {
      if (this.st === 'charging' || this.st === 'waiting') this.cancel();
    });
    game.events.on('map:change', ({ map }) => {
      this.cancel(true);
      this.sfx.setBeach(map === 'beach');
    });
    // The demo sets hour + facing right after 'demo:stage' (same tick): stage once that settles.
    game.events.on('demo:stage', ({ showcase }) => {
      this.cancel(true);
      queueMicrotask(() => this.stageDemo(showcase));
    });
    // `__game.openUI('fishing')` → a practice fight right where the farmer stands.
    game.hud.registerPanel('fishing', {
      open: () => this.startPractice(),
      close: () => {
        if (this.practice) this.cancel(true);
      },
    });
  }

  // ───────────────────────────────────────────── API

  state(): FishingState {
    return this.st;
  }

  records(): Record<string, FishingRecord> {
    return this.recs;
  }

  available(): FishDef[] {
    const c = this.game.calendar;
    const map = this.game.world.current?.id ?? '';
    return FISH.filter((f) => f.maps.includes(map) && f.seasons.includes(c.season) && c.hour >= f.hours[0] && c.hour <= f.hours[1] && (!f.weather || f.weather.includes(c.weather)));
  }

  cast(power: number): void {
    this.power = THREE.MathUtils.clamp(power, 0, 1);
    this.release();
  }

  reel(progress: number): void {
    if (this.st !== 'reeling' || !this.mg) return;
    this.mg.progress = progress;
  }

  save(): unknown {
    return { recs: this.recs };
  }

  load(data: unknown): void {
    const d = data as { recs?: Record<string, FishingRecord> } | null;
    if (d?.recs) this.recs = d.recs;
  }

  // ───────────────────────────────────────────── setup

  /** Grandmother's rod: into the first free toolbar slot (or swapped with the last non-tool). */
  private giveRod(): void {
    const inv = this.game.services.inventory;
    if (!inv || inv.count('rod') > 0) return;
    const slots = inv.slots as (typeof inv.slots[number])[];
    let slot = slots.slice(0, 10).findIndex((s) => !s);
    if (slot < 0) {
      for (let i = 9; i >= 0; i--) {
        const s = slots[i];
        if (s && !['hoe', 'wateringCan', 'axe', 'pickaxe', 'scythe'].includes(s.id) && !s.id.endsWith('Seeds')) {
          slot = i;
          break;
        }
      }
    }
    if (slot < 0) {
      inv.add('rod', 1);
      return;
    }
    const moved = slots[slot];
    if (moved) {
      const free = slots.findIndex((s, i) => i >= 10 && !s);
      if (free < 0) {
        inv.add('rod', 1);
        return;
      }
      slots[free] = moved;
    }
    slots[slot] = { id: 'rod', qty: 1 };
    inv.add('rod', 0); // publish inventory:change
  }

  private rodSlot(): number {
    const inv = this.game.services.inventory;
    return inv ? inv.slots.findIndex((s) => s?.id === 'rod') : -1;
  }

  private get rig(): RigView {
    return this.game.player as unknown as RigView;
  }

  private waterLevel(): number {
    const map = this.game.world.current as unknown as { waterLevel?: number; terrain?: { opts: { waterLevel: number } } } | null;
    if (!map) return 0;
    if (typeof map.waterLevel === 'number') return map.waterLevel;
    return map.terrain?.opts.waterLevel ?? 0;
  }

  private isWater(x: number, z: number): boolean {
    const g = this.game.world.current?.grid;
    if (!g) return false;
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    return g.inBounds(tx, tz) && g.hasFlag(tx, tz, TileFlag.WaterSource);
  }

  private facingDir(): THREE.Vector3 {
    switch (this.game.player.facing) {
      case 'up':
        return new THREE.Vector3(0, 0, -1);
      case 'down':
        return new THREE.Vector3(0, 0, 1);
      case 'left':
        return new THREE.Vector3(-1, 0, 0);
      default:
        return new THREE.Vector3(1, 0, 0);
    }
  }

  // ───────────────────────────────────────────── flow

  private setState(s: FishingState): void {
    this.st = s;
    this.stT = 0;
  }

  private lockPlayer(lock: boolean): void {
    const p = this.game.player;
    p.controllable = !lock;
    const r = this.rig;
    if (lock) {
      // Cancel the generic tool swing the use press started.
      if (typeof r.swingT === 'number') r.swingT = -1;
      if (r.tool) r.tool.visible = false;
      if (r.state === 'swing') r.state = 'idle';
    }
  }

  private beginCharge(): void {
    if (this.game.services.energy && this.game.services.energy.value() <= 0) return;
    this.lockPlayer(true);
    this.setState('charging');
    this.powerT = 0;
    this.power = 0;
    this.gear.setRodVisible(true);
    this.gear.hold(null);
  }

  private release(): void {
    const p = this.game.player.position;
    const dir = this.facingDir();
    const dist = 1.6 + this.power * 5.6;
    this.castPower = this.power;
    this.lockPlayer(true);
    this.gear.setRodVisible(true);
    this.waterY = this.waterLevel();
    this.gear.waterY = this.waterY;
    // Farthest water point along the throw (so a strong cast over a narrow pond still lands wet).
    this.onWater = false;
    let land = dist;
    for (let d = dist; d >= 0.9; d -= 0.2) {
      if (this.isWater(p.x + dir.x * d, p.z + dir.z * d)) {
        land = d;
        this.onWater = true;
        break;
      }
    }
    this.target.set(p.x + dir.x * land, 0, p.z + dir.z * land);
    const map = this.game.world.current;
    const ground = map ? map.heightAt(this.target.x, this.target.z) : 0;
    this.target.y = this.onWater ? this.waterY : ground + 0.05;
    this.depth = this.onWater ? Math.max(0, this.waterY - ground) : 0;
    this.setState('casting');
    this.game.services.energy?.spend(3);
    this.sfx.whoosh(this.power);
    this.game.events.emit('fishing:cast', { power: this.power, x: this.target.x, z: this.target.z });
  }

  private landed(): void {
    this.bob.copy(this.target);
    if (!this.onWater) {
      this.note("Can't fish here…");
      this.setState('reelin');
      return;
    }
    this.gear.splash(this.target, false);
    this.sfx.plop();
    this.setState('waiting');
    const pool = this.pickPool();
    this.hooked = pool.length ? this.pickFish(pool) : null;
    this.waitT = this.hooked ? 2.2 + Math.random() * 6.5 * (1.1 - this.castPower * 0.35) : 9 + Math.random() * 4;
    this.nibbles = [];
    const n = Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.nibbles.push(this.waitT * (0.3 + Math.random() * 0.6));
    this.nibbles.sort((a, b) => a - b);
  }

  private pickPool(): FishDef[] {
    const deep = this.depth > 1.05;
    return this.available().filter((f) => f.zone === 'any' || (f.zone === 'deep' ? deep : !deep || this.depth < 1.6));
  }

  private pickFish(pool: FishDef[]): FishDef {
    const bonus = this.castPower * 0.5 + Math.min(1, this.depth / 2) * 0.5;
    const w = pool.map((f) => f.rarity + (1 - f.rarity) * bonus * 0.35);
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) {
      r -= w[i]!;
      if (r <= 0) return pool[i]!;
    }
    return pool[pool.length - 1]!;
  }

  private bite(): void {
    if (!this.hooked) return;
    this.setState('bite');
    this.biteWindow = 1.05 - this.hooked.difficulty * 0.25;
    this.gear.splash(this.bob, true);
    this.sfx.bite();
    this.game.rc.rig.addShake(0.15);
    this.game.events.emit('fishing:bite', { fishId: this.hooked.id });
  }

  private hook(): void {
    const def = this.hooked!;
    this.setState('reeling');
    this.sfx.hook();
    this.game.rc.rig.addShake(0.3);
    this.mg = {
      def,
      bar: 0,
      barH: 0.27 - def.difficulty * 0.04,
      barV: 0,
      fish: 0.35 + Math.random() * 0.3,
      fishV: 0,
      fishTarget: 0.5,
      retarget: 0.3,
      progress: 0.3,
      treasure: Math.random() < 0.2 ? { pos: 0.2 + Math.random() * 0.6, prog: 0, got: false } : null,
      holding: false,
      inside: false,
      perfect: true,
      bounce: 0,
      t: 0,
      auto: this.demo !== null,
    };
    if (this.mg.treasure) this.mg.treasure.prog = -0.8; // appears after a moment
    this.ui.openReel(def);
    this.game.events.emit('fishing:hook', { fishId: def.id });
  }

  private catchFish(): void {
    const mg = this.mg!;
    const def = mg.def;
    const r = Math.random();
    const sizeFrac = THREE.MathUtils.clamp(Math.pow(r, 1.5) * 0.85 + this.castPower * 0.15 + (mg.perfect ? 0.05 : 0), 0, 1);
    const lengthCm = def.size[0] + (def.size[1] - def.size[0]) * sizeFrac;
    const score = sizeFrac * 0.55 + (mg.perfect ? 0.35 : 0) + this.castPower * 0.12;
    const quality = score > 0.82 ? 2 : score > 0.55 ? 1 : 0;
    let treasure: string | null = null;
    if (mg.treasure?.got) {
      const [id, qty] = TREASURE[Math.floor(Math.random() * TREASURE.length)]!;
      this.game.events.emit('item:give', { itemId: id, qty });
      const gold = 40 + Math.floor(Math.random() * 90);
      this.game.services.economy?.add(gold, 'treasure');
      treasure = `${qty > 1 ? `${qty}× ` : ''}${id.replace(/([A-Z])/g, ' $1').toLowerCase()} + ${gold}g`;
    }
    this.result = { def, lengthCm, quality, perfect: mg.perfect, treasure };
    this.ui.closeReel();
    this.mg = null;
    this.setState('caught');
    this.catchArc = 0;
    this.cardShown = false;
    this.gear.splash(this.bob, true);
    this.sfx.fishSplash(true);
    this.game.events.emit('item:give', { itemId: def.id, qty: 1 });
    this.game.events.emit('fishing:catch', { fishId: def.id, perfect: mg.perfect, size: lengthCm, quality, treasure: !!treasure });
  }

  private showCatchCard(): void {
    const res = this.result!;
    const rec = this.recs[res.def.id];
    const isNew = !rec;
    const isRecord = !rec || res.lengthCm > rec.best;
    this.recs[res.def.id] = { caught: (rec?.caught ?? 0) + 1, best: Math.max(rec?.best ?? 0, res.lengthCm) };
    const price = Math.round(res.def.sell * [1, 1.25, 1.5, 2][res.quality]!);
    this.ui.showCard({ def: res.def, lengthCm: res.lengthCm, quality: res.quality, price, isNew, isRecord, treasure: res.treasure });
    this.sfx.catchJingle(res.quality);
    if (res.treasure) setTimeout(() => this.sfx.treasure(), 450);
  }

  private escape(): void {
    const def = this.mg?.def ?? this.hooked;
    this.ui.closeReel();
    this.mg = null;
    this.sfx.escape();
    this.note(this.st === 'bite' ? 'Too slow…' : 'It got away…');
    this.setState('reelin');
    if (def) this.game.events.emit('fishing:escape', { fishId: def.id });
  }

  private cancel(instant = false): void {
    if (this.st === 'idle') return;
    this.ui.hideAll();
    this.mg = null;
    this.result = null;
    this.practice = false;
    if (instant) this.finish();
    else this.setState('reelin');
  }

  private finish(): void {
    this.setState('idle');
    this.ui.hideAll();
    this.gear.setRodVisible(false);
    this.gear.bobber.visible = false;
    this.gear.lineVisible = false;
    this.gear.setShadow(null, 0);
    this.gear.hold(null);
    this.gear.heldRoot.scale.setScalar(1);
    this.gear.glory.visible = false;
    if (this.preCatchYaw !== null) {
      this.rig.targetYaw = this.preCatchYaw;
      this.preCatchYaw = null;
    }
    this.hooked = null;
    this.result = null;
    this.demo = null;
    if (this.practice) {
      this.practice = false;
      this.game.events.emit('ui:open', { name: 'none' });
    }
    this.lockPlayer(false);
  }

  private startPractice(): void {
    if (this.st !== 'idle') this.cancel(true);
    this.practice = true;
    this.lockPlayer(true);
    this.gear.setRodVisible(true);
    this.waterY = this.waterLevel();
    this.gear.waterY = this.waterY;
    const p = this.game.player.position;
    const dir = this.facingDir();
    this.target.set(p.x + dir.x * 4, this.waterY, p.z + dir.z * 4);
    this.bob.copy(this.target);
    this.onWater = true;
    const pool = this.available();
    this.hooked = pool.length ? this.pickFish(pool) : FISH[Math.floor(Math.random() * FISH.length)]!;
    this.hook();
    if (this.mg) this.mg.auto = false;
    this.gear.resetLine(this.bob);
  }

  private note(text: string): void {
    const s = this.screenAt(this.game.player.position, 2.6);
    this.ui.note(text, s.x, s.y);
  }

  // ───────────────────────────────────────────── demos

  private stageDemo(showcase: string[]): void {
    let want = showcase.find((s) => s.startsWith('fishing-'));
    this.cancel(true);
    if (!want) return;
    // URL overrides: &phase=cast|flight|wait|bite|reel|catch, &fish=<fishId>.
    const q = new URLSearchParams(location.search);
    const phase = q.get('phase');
    if (phase) want = `fishing-${phase}`;
    const forced = q.get('fish');
    const slot = this.rodSlot();
    if (slot >= 0) this.game.events.emit('toolbar:select', { slot });
    this.lockPlayer(true);
    this.gear.setRodVisible(true);
    this.waterY = this.waterLevel();
    this.gear.waterY = this.waterY;
    const p = this.game.player.position;
    const dir = this.facingDir();
    const pick = (ids: string[]): FishDef => {
      if (forced && fishDef(forced)) return fishDef(forced)!;
      const pool = this.available();
      for (const id of ids) {
        const f = pool.find((x) => x.id === id) ?? (this.game.world.current?.id === 'beach' ? fishDef(id) : undefined);
        if (f) return f;
      }
      return pool[0] ?? FISH[0]!;
    };
    this.target.set(p.x + dir.x * 5.2, this.waterY, p.z + dir.z * 5.2);
    this.bob.copy(this.target);
    this.onWater = true;
    this.depth = 2;
    switch (want) {
      case 'fishing-cast':
        this.demo = 'cast';
        this.setState('charging');
        this.power = 0.97;
        break;
      case 'fishing-flight':
        this.demo = 'flight';
        this.power = 0.8;
        this.release();
        this.demo = 'flight';
        break;
      case 'fishing-wait':
        this.demo = 'wait';
        this.hooked = pick(['coralSnapper']);
        this.setState('waiting');
        this.waitT = 999;
        this.nibbles = [];
        this.gear.resetLine(this.bob);
        break;
      case 'fishing-bite':
        this.demo = 'bite';
        this.hooked = pick(['coralSnapper', 'pondPerch']);
        this.gear.resetLine(this.bob);
        this.bite();
        this.biteWindow = 1e9;
        break;
      case 'fishing-reel':
        this.demo = 'reel';
        this.hooked = pick(['coralSnapper', 'duskGrouper', 'pondPerch']);
        this.hook();
        this.mg!.progress = 0.64;
        this.mg!.fish = 0.52;
        this.mg!.bar = 0.4;
        this.mg!.treasure = { pos: 0.78, prog: 0.45, got: false };
        this.mg!.auto = true;
        this.gear.resetLine(this.bob);
        break;
      case 'fishing-catch':
        this.demo = 'catch';
        this.hooked = pick(['duskGrouper', 'coralSnapper', 'pondPerch']);
        this.hook();
        this.mg!.perfect = true;
        this.mg!.treasure = null;
        this.catchFish();
        this.result!.lengthCm = this.result!.def.size[0] + (this.result!.def.size[1] - this.result!.def.size[0]) * 0.78;
        this.result!.quality = 2;
        this.catchArc = 1;
        this.stT = 0.9;
        this.heldT = 0.9;
        this.recs = {};
        this.showCatchCard();
        break;
    }
  }

  // ───────────────────────────────────────────── per frame

  private screenAt(p: THREE.Vector3, up: number): { x: number; y: number } {
    _v.set(p.x, p.y + up, p.z).project(this.game.rc.camera);
    const c = this.game.rc.renderer.domElement.getBoundingClientRect();
    return { x: c.left + (_v.x * 0.5 + 0.5) * c.width, y: c.top + (-_v.y * 0.5 + 0.5) * c.height };
  }

  private useHeld(): boolean {
    const i = this.game.input;
    return i.mouse.left || i.keys.has('Space') || i.keys.has('KeyC') || i.held('use');
  }

  update(dt: number, game: Game): void {
    const h = game.rc.renderer.domElement.height;
    this.gear.update(dt, game.time, h);
    this.sfx.update(dt, game.time * 0.9);
    if (this.st === 'idle') {
      this.wasHolding = this.useHeld();
      return;
    }
    // Sim time: real dt normally, frozen phases in demos still animate on the render clock.
    const sdt = game.paused && !this.demo && !this.practice ? 0 : dt;
    this.stT += sdt;
    const holding = this.useHeld();
    const pressed = holding && !this.wasHolding;
    this.wasHolding = holding;
    const player = game.player;
    const head = this.screenAt(player.position, 2.2);

    switch (this.st) {
      case 'charging': {
        if (this.demo === 'cast') {
          this.power = 0.95 + 0.05 * Math.sin(game.time * 5);
        } else {
          this.powerT += sdt;
          const k = (this.powerT / 1.5) % 2;
          this.power = k < 1 ? k : 2 - k;
          if (!holding && this.stT > 0.08) {
            this.ui.showPower(null, 0, 0);
            this.release();
            break;
          }
        }
        // Beside the farmer (clear of the big head) at any zoom: offset by ~1.1 m of screen space.
        const s = this.screenAt(player.position, 1.1);
        const pxM = Math.abs(this.screenAt(player.position, 2.1).y - s.y);
        this.ui.showPower(this.power, s.x + 24 + pxM * 1.3, s.y + 20);
        break;
      }
      case 'casting': {
        {
          const s1 = this.screenAt(player.position, 1.1);
          const pxM = Math.abs(this.screenAt(player.position, 2.1).y - s1.y);
          this.ui.showPower(this.power > 0.965 && this.stT < 0.3 ? this.power : null, s1.x + 24 + pxM * 1.3, s1.y + 20);
        }
        const swing = 0.22;
        const fly = 0.45 + this.castFrom.distanceTo(this.target) * 0.05;
        if (this.stT < swing) {
          this.castFrom.copy(this.gear.tip);
          this.gear.resetLine(this.gear.tip);
          if (this.stT + sdt >= swing) this.sfx.zip(fly);
          break;
        }
        const k = Math.min(1, (this.stT - swing) / fly);
        if (this.demo === 'flight' && k > 0.55) {
          this.stT = swing + fly * 0.55;
        }
        const kk = this.demo === 'flight' ? 0.55 : k;
        const apex = 1.4 + this.castFrom.distanceTo(this.target) * 0.22;
        this.bob.lerpVectors(this.castFrom, this.target, kk);
        this.bob.y += Math.sin(kk * Math.PI) * apex;
        if (k >= 1 && this.demo !== 'flight') this.landed();
        break;
      }
      case 'waiting': {
        if (pressed && !this.demo) {
          this.setState('reelin');
          break;
        }
        if (this.demo !== 'wait') this.waitT -= sdt;
        while (this.nibbles.length && this.waitT <= this.nibbles[0]!) {
          this.nibbles.shift();
          this.gear.ripple(this.bob, 0.8, 0.9);
          this.sfx.nibble();
          this.stT = 0;
        }
        if (this.waitT <= 0 && this.hooked) this.bite();
        else if (this.waitT <= -1) {
          this.note('Nothing is biting…');
          this.setState('reelin');
        }
        break;
      }
      case 'bite': {
        this.ui.showBang(true, head.x, head.y - 8);
        if (pressed && this.demo !== 'bite') {
          this.ui.showBang(false);
          this.hook();
          break;
        }
        if (this.stT > this.biteWindow) {
          this.ui.showBang(false);
          this.escape();
        }
        break;
      }
      case 'reeling':
        this.stepMinigame(sdt, holding);
        break;
      case 'caught': {
        if (this.demo !== 'catch' && !this.cardShown && this.result && this.catchArc >= 1) {
          this.cardShown = true;
          this.showCatchCard();
        }
        this.catchArc = Math.min(1, this.catchArc + sdt / 0.5);
        if (this.demo !== 'catch') {
          const showing = this.ui.tickCard(sdt);
          if ((pressed && this.stT > 0.9) || (!showing && this.stT > 1.2)) {
            this.ui.hideCard();
            this.finish();
          }
        }
        break;
      }
      case 'reelin':
      case 'escaped': {
        this.ui.showBang(false);
        const k = Math.min(1, this.stT / 0.4);
        this.bob.lerp(this.gear.tip, k);
        if (k >= 1) this.finish();
        break;
      }
    }
    if ((this.st as FishingState) === 'idle') return;
    this.poseAndDraw(dt, game);
  }

  private stepMinigame(dt: number, holdingInput: boolean): void {
    const mg = this.mg;
    if (!mg) return;
    const def = mg.def;
    // Sub-steps for stable physics at any frame rate.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      mg.t += h;
      // Autopilot for demos: chase the fish with a little lag.
      const hold = mg.auto ? mg.fish + mg.fishV * 0.25 > mg.bar + mg.barH * 0.55 : holdingInput;
      mg.holding = hold;
      mg.barV += (hold ? 2.9 : -2.5) * h;
      mg.barV = THREE.MathUtils.clamp(mg.barV, -1.7, 1.7);
      mg.bar += mg.barV * h;
      if (mg.bar < 0) {
        if (mg.barV < -0.4) mg.bounce = Math.min(1, -mg.barV * 0.5);
        mg.bar = 0;
        mg.barV = -mg.barV * 0.42;
      }
      if (mg.bar > 1 - mg.barH) {
        mg.bar = 1 - mg.barH;
        mg.barV = 0;
      }
      mg.bounce = Math.max(0, mg.bounce - h * 5);
      // Fish AI.
      mg.retarget -= h;
      const d = def.difficulty;
      if (mg.retarget <= 0) {
        const r = Math.random();
        let tgt: number;
        switch (def.behavior) {
          case 'smooth':
            tgt = THREE.MathUtils.clamp(mg.fish + (Math.random() - 0.5) * 0.5, 0.05, 0.95);
            mg.retarget = 0.9 + Math.random() * 1.2 - d * 0.5;
            break;
          case 'dart':
            tgt = r < 0.5 ? Math.random() * 0.35 + (mg.fish > 0.5 ? 0 : 0.6) : Math.random();
            mg.retarget = 0.35 + Math.random() * 0.9 - d * 0.25;
            break;
          case 'sinker':
            tgt = Math.pow(Math.random(), 1.8) * 0.9 + 0.03;
            mg.retarget = 0.6 + Math.random() * 1.1 - d * 0.35;
            break;
          case 'floater':
            tgt = 0.97 - Math.pow(Math.random(), 1.8) * 0.9;
            mg.retarget = 0.6 + Math.random() * 1.1 - d * 0.35;
            break;
          default:
            tgt = 0.05 + Math.random() * 0.9;
            mg.retarget = 0.5 + Math.random() * 1.0 - d * 0.3;
        }
        mg.fishTarget = tgt;
        mg.retarget = Math.max(0.2, mg.retarget);
      }
      const k = 5 + d * 22 * (def.behavior === 'dart' ? 1.4 : def.behavior === 'smooth' ? 0.6 : 1);
      mg.fishV += (mg.fishTarget - mg.fish) * k * h;
      mg.fishV *= Math.exp(-h * (4.2 - d * 1.6));
      mg.fishV += Math.sin(mg.t * (7 + d * 9)) * d * 0.9 * h; // jitter
      mg.fish = THREE.MathUtils.clamp(mg.fish + mg.fishV * h, 0.02, 0.98);
      if (mg.fish <= 0.02 || mg.fish >= 0.98) mg.fishV *= -0.3;
      mg.inside = mg.fish >= mg.bar - 0.01 && mg.fish <= mg.bar + mg.barH + 0.01;
      if (!mg.auto || this.demo !== 'reel') {
        mg.progress += (mg.inside ? 0.24 : -(0.14 + d * 0.12)) * h;
        if (!mg.inside) mg.perfect = false;
      } else {
        // Demo: breathe around a good-looking value.
        mg.progress = 0.64 + Math.sin(mg.t * 0.7) * 0.05;
        mg.perfect = true;
      }
      if (mg.treasure && !mg.treasure.got) {
        const tr = mg.treasure;
        if (tr.prog < 0) tr.prog += h; // hidden until it appears
        else if (this.demo !== 'reel') {
          const inT = tr.pos >= mg.bar && tr.pos <= mg.bar + mg.barH;
          tr.prog = Math.max(0, tr.prog + (inT ? 0.75 : -0.35) * h);
          if (tr.prog >= 1) {
            tr.got = true;
            this.sfx.treasure();
          }
        }
      }
    }
    this.sfx.reel(dt, mg.holding ? 16 : 0);
    // Splashes at the float as the fish fights.
    this.splashT -= dt;
    if (this.splashT <= 0) {
      this.splashT = 0.5 + Math.random() * 1.1 - def.difficulty * 0.3;
      this.gear.splash(this.bob, Math.random() < 0.3);
      if (Math.random() < 0.5) this.sfx.fishSplash();
    }
    const view: ReelView = { ...mg, treasure: mg.treasure && mg.treasure.prog >= 0 ? mg.treasure : null };
    const s = this.screenAt(this.game.player.position, 1.2);
    this.ui.placeReel(s.x, s.y);
    this.ui.drawReel(view, dt);
    if (this.demo === 'reel') return;
    if (mg.progress >= 1) this.catchFish();
    else if (mg.progress <= 0) this.escape();
  }

  /** Pose the farmer's arms + rod, move the float, simulate the line. */
  private poseAndDraw(dt: number, game: Game): void {
    const r = this.rig;
    const t = game.time;
    const st = this.st;
    const pw = this.power;
    const fwd = this.facingDir();
    const reelingNow = st === 'reeling' || st === 'bite';
    const holdOverhead = st === 'caught' && this.catchArc > 0.6;
    // Arms (after the player's own animation this frame; rotations: -x raises the arm forward/up).
    if (r.armR && r.armL && r.torso) {
      let ar = -0.95;
      let al = -0.8;
      let arz = 0.3;
      let alz = -0.35;
      let torsoX = 0.05;
      if (st === 'charging') {
        ar = -2.3 - pw * 0.55;
        al = -1.0;
        arz = 0.15;
        torsoX = -0.12 - pw * 0.12;
      } else if (st === 'casting') {
        const k = Math.min(1, this.stT / 0.22);
        const e = 1 - Math.pow(1 - k, 3);
        ar = THREE.MathUtils.lerp(-2.85, -0.75, e);
        torsoX = THREE.MathUtils.lerp(-0.24, 0.18, e);
      } else if (reelingNow) {
        const shake = st === 'reeling' ? Math.sin(t * 38) * 0.05 : 0;
        ar = -1.35 + shake;
        al = -1.05 + Math.sin(t * (this.mg?.holding ? 16 : 5)) * 0.25;
        alz = -0.45 + Math.cos(t * (this.mg?.holding ? 16 : 5)) * 0.15;
        torsoX = -0.12;
      } else if (holdOverhead) {
        // Presenting the catch: both hands forward at chest height, gripping the fish, leaning back proudly.
        const lift = Math.sin(t * 3) * 0.05;
        ar = -1.5 + lift;
        al = -1.5 + lift;
        arz = -0.42;
        alz = 0.42;
        torsoX = -0.16;
      } else if (st === 'caught') {
        ar = -1.6;
        al = -1.4;
      }
      r.armR.rotation.set(ar, 0, arz);
      r.armL.rotation.set(al, 0, alz);
      r.torso.rotation.x = torsoX;
      if (holdOverhead) {
        // Turn to show the catch to the camera (restored in finish()).
        if (this.preCatchYaw === null) this.preCatchYaw = r.yaw ?? 0;
        const camYaw = THREE.MathUtils.degToRad(game.rc.rig.yaw);
        r.targetYaw = camYaw;
        if (this.demo === 'catch' && r.yaw !== undefined) r.yaw = camYaw;
        r.head.rotation.x = -0.12;
        // Happy hop.
        const hop = Math.max(0, Math.sin(Math.min(1, this.stT / 0.35) * Math.PI)) * 0.12;
        r.body.position.y = hop;
      }
      r.root.updateMatrixWorld(true);
      // Grip point: between the two hands, nudged forward.
      const hr = new THREE.Vector3(0, -0.3, 0.02);
      const hl = new THREE.Vector3(0, -0.3, 0.02);
      r.armR.localToWorld(hr);
      r.armL.localToWorld(hl);
      this.holdPt.addVectors(hr, hl).multiplyScalar(0.5);
      const bodyFwd = new THREE.Vector3(Math.sin(r.yaw ?? 0), 0, Math.cos(r.yaw ?? 0));
      this.holdPt.addScaledVector(bodyFwd, 0.08).y += 0.06;
    }
    // Rod pose.
    const hand = new THREE.Vector3(0, -0.34, 0.04);
    if (r.armR) r.armR.localToWorld(hand);
    else hand.copy(game.player.position).add(new THREE.Vector3(0, 1.1, 0));
    const up = new THREE.Vector3(0, 1, 0);
    let dir: THREE.Vector3;
    let bend = 0;
    if (st === 'charging') {
      // Rod cocked back over the shoulder, angled a little towards the camera so it reads against the sky / water.
      const cy = THREE.MathUtils.degToRad(game.rc.rig.yaw);
      const toCam = new THREE.Vector3(Math.sin(cy), 0, Math.cos(cy));
      dir = fwd.clone().multiplyScalar(-0.85).add(up.clone().multiplyScalar(0.75 + pw * 0.2)).addScaledVector(toCam, 0.35);
    }
    else if (st === 'casting') {
      const k = Math.min(1, this.stT / 0.22);
      const e = 1 - Math.pow(1 - k, 3);
      dir = fwd.clone().multiplyScalar(THREE.MathUtils.lerp(-0.9, 1, e)).add(up.clone().multiplyScalar(THREE.MathUtils.lerp(0.8, 0.45, e)));
      bend = Math.sin(e * Math.PI) * 0.35;
    } else if (reelingNow) {
      dir = fwd.clone().multiplyScalar(0.55).add(up.clone().multiplyScalar(1.05));
      dir.x += Math.sin(t * 9) * 0.04;
      bend = st === 'reeling' ? 0.55 + 0.15 * Math.sin(t * 13) + (this.mg ? (this.mg.inside ? 0.1 : -0.1) : 0) : 0.75;
    } else if (holdOverhead) {
      dir = fwd.clone().multiplyScalar(-0.3).add(up.clone().multiplyScalar(0.2)).add(new THREE.Vector3(fwd.z, 0, -fwd.x).multiplyScalar(-0.9));
    } else dir = fwd.clone().add(up.clone().multiplyScalar(0.62));
    dir.normalize();
    this.gear.poseRod({ hand, dir, bend, bendTo: this.bob, crank: t * (this.mg?.holding ? 16 : st === 'reelin' ? 20 : 0) });
    // Rod goes down (out of frame) while both hands hold the catch up.
    this.gear.setRodVisible(!(st === 'caught' && this.catchArc >= 1));

    // Float.
    const bob = this.gear.bobber;
    const inWater = st === 'waiting' || st === 'bite' || st === 'reeling';
    bob.visible = st !== 'charging' && !(st === 'caught' && this.catchArc >= 1);
    this.gear.lineVisible = st !== 'charging' && !(st === 'caught' && this.catchArc >= 1) && !(st === 'casting' && this.stT < 0.22);
    const pos = this.bob.clone();
    let tiltX = 0;
    let tiltZ = 0;
    if (inWater) {
      pos.y = this.waterY + Math.sin(t * 2.4) * 0.018;
      if (st === 'waiting' && this.stT < 0.35 && this.nibbles !== null) pos.y -= Math.sin(Math.min(1, this.stT / 0.35) * Math.PI) * 0.06;
      if (st === 'bite') pos.y -= 0.1 + Math.sin(t * 30) * 0.03;
      if (st === 'reeling' && this.mg) {
        const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
        pos.addScaledVector(side, (this.mg.fish - 0.5) * 0.9);
        pos.y -= 0.06 + Math.abs(this.mg.fishV) * 0.05;
        tiltX = Math.sin(t * 17) * 0.35;
        tiltZ = (this.mg.fish - 0.5) * 0.8;
      } else {
        tiltX = Math.sin(t * 1.7) * 0.08;
        tiltZ = Math.cos(t * 2.1) * 0.08;
      }
      if (Math.random() < dt * (st === 'reeling' ? 3 : 0.35)) this.gear.ripple(pos, st === 'reeling' ? 1.1 : 0.6, 1.3);
    } else if (st === 'caught') {
      // Fish arcs from the float into the farmer's hands.
      pos.lerpVectors(this.bob, this.holdPt, this.catchArc);
      pos.y += Math.sin(this.catchArc * Math.PI) * 1.2;
    }
    bob.position.copy(pos);
    bob.rotation.set(tiltX, 0, tiltZ);
    this.gear.slack = st === 'reeling' || st === 'bite' ? 0.05 : st === 'casting' ? 0.4 : st === 'reelin' ? 0.3 : 1;
    const lineEnd = _w.copy(pos).add(new THREE.Vector3(0, 0.1, 0));
    if (st === 'casting' && this.stT < 0.22) this.gear.resetLine(this.gear.tip);
    this.gear.updateLine(Math.min(dt, 1 / 30), lineEnd, game.rc.camera);

    // Fish shadow circling in before the bite.
    if (st === 'waiting' && this.hooked && this.waitT < 2.6) {
      const k = THREE.MathUtils.clamp(1 - this.waitT / 2.6, 0, 1);
      const ang = t * 1.3;
      const rad = 1.3 * (1 - k) + 0.25;
      const sp = new THREE.Vector3(this.bob.x + Math.cos(ang) * rad, 0, this.bob.z + Math.sin(ang) * rad);
      this.gear.setShadow(sp, k, -ang - Math.PI / 2);
    } else if (st === 'reeling' && this.mg) this.gear.setShadow(pos, 0.7, t * 2);
    else this.gear.setShadow(null, 0);

    // Held fish.
    if (st === 'caught' && this.result) {
      if (this.catchArc > 0 && !this.gear.heldRoot.children.length) this.gear.hold(this.result.def, this.result.lengthCm);
      const p = game.player.position;
      if (this.catchArc < 1) {
        this.heldT = 0;
        this.gear.heldRoot.scale.setScalar(1);
        this.gear.setGlory(null, game.rc.camera, 0, t);
        this.gear.heldRoot.position.copy(pos);
        this.gear.heldRoot.rotation.set(0, t * 6, Math.sin(t * 20) * 0.4);
      } else {
        const bobY = Math.sin(t * 3) * 0.03;
        // Pop on arrival (overshoot + settle), then a gentle bob.
        this.heldT += dt;
        const pop = 1 + 0.28 * Math.exp(-this.heldT * 5) * Math.sin(this.heldT * 16 + 0.6);
        this.gear.heldRoot.scale.setScalar(pop);
        this.gear.heldRoot.position.copy(this.holdPt);
        this.gear.heldRoot.position.y += bobY * 0.3;
        this.gear.setGlory(_w.copy(this.holdPt).setY(this.holdPt.y + 0.5), game.rc.camera, Math.min(1, this.heldT * 3) * 0.55, t, 3.0 + (this.result.lengthCm / 100) * 0.9);
        // Side-on to the camera, head to the left, a little wiggle.
        this.gear.heldRoot.rotation.set(0, -THREE.MathUtils.degToRad(game.rc.rig.yaw), Math.sin(t * 5) * 0.07 + 0.08);
        if (Math.random() < dt * 4) {
          this.gear.fx.emit(new THREE.Vector3(this.holdPt.x + (Math.random() - 0.5) * 1.4, this.holdPt.y + 0.2 + Math.random() * 0.7, this.holdPt.z + 0.2), { color: 0xfff2b0, count: 2, speed: 0.4, size: 0.07, gravity: -0.4, life: 0.9, up: 0.6 });
        }
      }
    }
  }
}
