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
 *
 * Co-op (DESIGN §13, host-authoritative) — the net layer wires these; solo play needs none of it:
 *   fishing:net     out, ~10 Hz while fishing + on every state change: a compact FishNetSnap of this
 *                   farmer's angling (state, power, feet, yaw, float, fish, catch arc, tension)
 *   remote(id, snap, t)   feed another farmer's snapshots in: they render as a RemoteAngler (rod,
 *                   catenary line, float, bite "!", splash, fish held up) interpolated ~100 ms behind
 *   setRoller(fn)   a farmhand installs the host round-trip: every cast's fish / size luck / treasure
 *                   is rolled by the host (hostRoll) — the minigame itself stays local
 *   hostRoll(from, req) / validateCatch(from, claim)   host side: roll with the host's calendar and
 *                   remember it; a catch claim must match an issued, unused roll ('fishing:claim' out)
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { FISH, fishDef, fishXp, fishingLevel, FISHING_XP, ROD_TIERS, type FishDef } from '../data/fish';
import { itemDef } from '../data/items';
import { TileFlag } from '../world/tiles';
import { FishingGear } from '../world/beach/tackle';
import { FishingOverlay, type ReelView } from '../ui/fishing';
import { newReel, stepReel, treasureVisible, type ReelState } from '../ui/fishing-reel';
import { RemoteAngler, STATE_CODES, poseAnglerArms, type FishNetSnap, type NetState } from '../world/beach/remote-angler';
import { RemoteFarmer } from '../entities/remote-farmer';
import { PRESET_LOOKS } from '../entities/remote-look';
import { FishingSfx } from '../ui/fishing-sfx';
import '../ui/fishing-art';
import { TackleScreen } from '../ui/fishing-shop';

export type FishingState = 'idle' | 'charging' | 'casting' | 'waiting' | 'bite' | 'reeling' | 'caught' | 'escaped' | 'reelin';

export interface FishingRecord {
  caught: number;
  best: number;
}

export interface FishingApi {
  state(): FishingState;
  /** Fishing skill level (0..10) and total XP. */
  level(): number;
  xp(): number;
  /** Rod tier (0 bamboo, 1 fiberglass, 2 iridium). */
  rodTier(): number;
  /** Upgrade the rod (tackle counter); ignored if not higher than the current tier. */
  upgradeRod(tier: number): void;
  /** Fish that can bite here and now (any zone). */
  available(): FishDef[];
  /** Cast with power 0..1 in the facing direction. */
  cast(power: number): void;
  /** Legacy: force the minigame result (≥ 1 catches, ≤ 0 escapes). */
  reel(progress: number): void;
  records(): Record<string, FishingRecord>;
  /** Co-op: current local snapshot (null when idle). */
  snapshot(): FishNetSnap | null;
  /** Co-op: another farmer's snapshot (null = gone); `t` = sender clock ms (defaults to now). */
  remote(id: number, snap: FishNetSnap | null, t?: number): void;
  /** Co-op (farmhand): route every cast's roll through the host; null = roll locally (host / solo). */
  setRoller(fn: ((req: FishRollReq) => Promise<FishRoll>) | null): void;
  /** Co-op (host): roll a farmhand's cast with the host's calendar and remember it for validation. */
  hostRoll(from: number, req: FishRollReq): FishRoll;
  /** Co-op (host): does a farmhand's catch match a roll we issued (and not already claimed)? */
  validateCatch(from: number, claim: FishClaim): boolean;
  /** Is this remote farmer fishing (the net layer hides its own rod pose while it is)? */
  remoteActive(id: number): boolean;
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
    'fishing:level': { level: number };
    /** Co-op: this farmer's angling snapshot (relay to peers; null = stopped fishing). */
    'fishing:net': { snap: FishNetSnap | null };
    /** Co-op: a farmhand's catch claim for the host to validate (FishingApi.validateCatch). */
    'fishing:claim': { claim: FishClaim };
  }
}

/** What the host rolls for a cast (fish, luck for the size, treasure, bite timing). */
export interface FishRoll {
  rid: number;
  fishId: string | null;
  /** 0..1 luck share of the size roll. */
  luck: number;
  treasure: boolean;
  /** Seconds to the bite and nibble times (counting down). */
  wait: number;
  nibbles: number[];
}

export interface FishRollReq {
  rid: number;
  map: string;
  /** Water depth at the float (m) and cast power (0..1) — clamped by the host. */
  depth: number;
  power: number;
  baited: boolean;
  lure: boolean;
  level: number;
  tier: number;
  streak: number;
}

export interface FishClaim {
  rid: number;
  fishId: string;
  perfect: boolean;
  treasure: boolean;
}

interface Minigame extends ReelState {
  def: FishDef;
}

/** Snapshot rate while fishing (Hz); state changes are sent immediately. */
const NET_HZ = 10;
/** Farmhand: give up on the host's roll after this long (the float just sits: nothing bites). */
const ROLL_TIMEOUT = 2500;
/** Tackle wears out after this many catches while carried. */
const TACKLE_USES = 20;

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
// Scratch vectors for the per-frame pose (no allocations in the hot path).
const _hr = new THREE.Vector3();
const _hl = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _bodyFwd = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _side = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _sp = new THREE.Vector3();
const _fxp = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _ndc = new THREE.Vector2();

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
  /** Aim (unit, XZ): mouse direction, held movement keys (8 ways) or the facing. */
  private aim = new THREE.Vector3(1, 0, 0);
  private aimMouse = false;
  private totalXp = 0;
  private tier = 0;
  private lureUses = 0;
  private corkUses = 0;
  /** Consecutive perfect catches (feeds quality + treasure odds). */
  private streak = 0;
  private baited = false;
  private hitstop = 0;
  private powerStep = -1;
  private lastXp: { gained: number; leveled: boolean } = { gained: 0, leveled: false };
  /** This cast's roll (host-rolled in co-op); null in practice / demo fights. */
  private roll: FishRoll | null = null;
  private roller: ((req: FishRollReq) => Promise<FishRoll>) | null = null;
  private pendingRid = 0;
  private ridSeq = 1;
  /** Host: rolls issued to farmhands, keyed `${from}:${rid}`. */
  private issued = new Map<string, { roll: FishRoll; claimed: boolean; at: number }>();
  private remotes = new Map<number, RemoteAngler>();
  private netT = 0;
  private netSt: FishingState = 'idle';
  /** Camera push-in applied for end-of-fight tension (m, subtracted from the rig distance). */
  private camPush = 0;
  /** `?demo=coop-fishing`: a scripted second angler streamed through the real snapshot path. */
  private coopDemo: { farmer: RemoteFarmer; t: number; phase: number; live: boolean; netT: number; x: number; z: number; y: number } | null = null;
  /** Reused minigame view (no per-frame allocation). */
  private view: ReelView = { bar: 0, barH: 0, fish: 0, fishV: 0, progress: 0, treasure: null, holding: false, inside: false, perfect: true, bounce: 0, slack: false };

  init(game: Game): void {
    this.game = game;
    game.provide('fishing', this);
    this.gear = new FishingGear();
    game.scene.add(this.gear.group);
    this.ui = new FishingOverlay(game.opts.uiRoot);
    this.sfx = new FishingSfx();
    this.giveRod();
    this.applyRodTier();

    game.events.on('item:use', ({ itemId }) => {
      if (itemId !== 'rod') return;
      if (this.st === 'idle') this.beginCharge();
    });
    game.events.on('toolbar:select', () => {
      if (this.st === 'charging' || this.st === 'waiting') this.cancel();
    });
    game.events.on('map:change', ({ map }) => {
      this.cancel(true);
      this.releaseCamPush(true);
      this.sfx.setBeach(map === 'beach');
    });
    // The demo sets hour + facing right after 'demo:stage' (same tick): stage once that settles.
    game.events.on('demo:stage', ({ showcase }) => {
      this.cancel(true);
      this.stopCoopDemo();
      if (showcase.includes('coop-fishing')) queueMicrotask(() => this.startCoopDemo());
      // The demo sets its own camera distance: drop the push without undoing it.
      this.camPush = 0;
      queueMicrotask(() => this.stageDemo(showcase));
    });
    // Bait & Tackle counter (the Driftsand shack; `__game.openUI('tackle')`).
    game.hud.registerPanel('tackle', new TackleScreen(game, game.hud.screens));
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

  level(): number {
    return fishingLevel(this.totalXp);
  }

  xp(): number {
    return this.totalXp;
  }

  rodTier(): number {
    return this.tier;
  }

  upgradeRod(tier: number): void {
    if (tier <= this.tier) return;
    this.tier = Math.min(ROD_TIERS.length - 1, tier);
    this.applyRodTier();
  }

  private applyRodTier(): void {
    this.gear.setRodTier(this.tier);
    const d = itemDef('rod');
    if (d) d.name = ROD_TIERS[this.tier]!.name;
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

  // ───────────────────────────────────────────── co-op

  snapshot(): FishNetSnap | null {
    if (this.st === 'idle') return null;
    const p = this.game.player.position;
    const b = this.gear.bobber.visible ? this.gear.bobber.position : this.bob;
    const r2 = (v: number): number => Math.round(v * 100) / 100;
    const fishId = (this.st === 'caught' ? this.result?.def.id : this.hooked?.id) ?? '';
    const tension = this.st === 'reeling' && this.mg ? this.mg.progress : 0;
    return [
      STATE_CODES.indexOf(this.st),
      r2(this.power),
      r2(p.x),
      r2(p.y),
      r2(p.z),
      r2(this.rig.yaw ?? 0),
      r2(b.x),
      r2(b.y),
      r2(b.z),
      fishId,
      r2(this.catchArc),
      r2(tension),
      Math.round(this.result?.lengthCm ?? 0),
      this.game.world.current?.id ?? '',
    ];
  }

  remote(id: number, snap: FishNetSnap | null, t = performance.now()): void {
    let a = this.remotes.get(id);
    if (!a) {
      if (!snap) return;
      a = new RemoteAngler(id);
      this.remotes.set(id, a);
      this.game.scene.add(a.gear.group);
    }
    a.push(t, snap);
  }

  remoteActive(id: number): boolean {
    return !!this.remotes.get(id)?.active;
  }

  /** Drop a remote angler entirely (player left). */
  removeRemote(id: number): void {
    const a = this.remotes.get(id);
    if (!a) return;
    a.dispose();
    this.ui.remoteBang(id, false);
    this.remotes.delete(id);
  }

  setRoller(fn: ((req: FishRollReq) => Promise<FishRoll>) | null): void {
    this.roller = fn;
  }

  hostRoll(from: number, req: FishRollReq): FishRoll {
    const roll = this.rollFor(req);
    const now = performance.now();
    for (const [k, v] of this.issued) if (now - v.at > 10 * 60 * 1000) this.issued.delete(k);
    this.issued.set(`${from}:${req.rid}`, { roll, claimed: false, at: now });
    return roll;
  }

  validateCatch(from: number, claim: FishClaim): boolean {
    const e = this.issued.get(`${from}:${claim.rid}`);
    if (!e || e.claimed || !e.roll.fishId || e.roll.fishId !== claim.fishId) return false;
    if (claim.treasure && !e.roll.treasure) return false;
    e.claimed = true;
    return true;
  }

  /**
   * Roll a cast: which fish (map / season / hour / weather / depth zone, weighted by rarity; long
   * casts into deep water favour the rare ones), size luck, treasure and the bite timing. Uses this
   * machine's calendar — in co-op only the host calls it for everyone.
   */
  private rollFor(req: FishRollReq): FishRoll {
    const c = this.game.calendar;
    const depth = THREE.MathUtils.clamp(req.depth, 0, 4.5);
    const power = THREE.MathUtils.clamp(req.power, 0, 1);
    const tier = ROD_TIERS[THREE.MathUtils.clamp(Math.round(req.tier), 0, ROD_TIERS.length - 1)]!;
    const deep = depth > 1.05;
    const pool = FISH.filter(
      (f) =>
        f.maps.includes(req.map) &&
        f.seasons.includes(c.season) &&
        c.hour >= f.hours[0] &&
        c.hour <= f.hours[1] &&
        (!f.weather || f.weather.includes(c.weather)) &&
        (f.zone === 'any' || (f.zone === 'deep' ? deep : !deep || depth < 1.6)),
    );
    const fish = pool.length ? this.pickFish(pool, power, depth) : null;
    const quick = (req.baited ? 0.5 : 1) * tier.wait;
    const wait = fish ? (1.6 + Math.random() * 6.5 * (1.1 - power * 0.35)) * quick : 9 + Math.random() * 4;
    const nibbles: number[] = [];
    const n = Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) nibbles.push(wait * (0.3 + Math.random() * 0.6));
    nibbles.sort((a, b) => b - a);
    const lv = THREE.MathUtils.clamp(req.level, 0, 10);
    const treasureOdds = 0.14 + lv * 0.01 + (req.lure ? 0.25 : 0) + Math.min(Math.max(0, req.streak), 5) * 0.02;
    return { rid: req.rid, fishId: fish?.id ?? null, luck: Math.random(), treasure: !!fish && Math.random() < treasureOdds, wait, nibbles };
  }

  private applyRoll(r: FishRoll): void {
    this.roll = r;
    this.pendingRid = 0;
    this.hooked = r.fishId ? (fishDef(r.fishId) ?? null) : null;
    this.waitT = r.wait;
    this.nibbles = r.nibbles.slice().sort((a, b) => b - a);
  }

  private releaseCamPush(apply: boolean): void {
    if (apply) this.game.rc.rig.distance += this.camPush;
    this.camPush = 0;
  }

  save(): unknown {
    return { recs: this.recs, xp: this.totalXp, tier: this.tier, lure: this.lureUses, cork: this.corkUses, streak: this.streak };
  }

  load(data: unknown): void {
    const d = data as { recs?: Record<string, FishingRecord>; xp?: number; tier?: number; lure?: number; cork?: number; streak?: number } | null;
    if (d?.recs) this.recs = d.recs;
    this.totalXp = d?.xp ?? 0;
    this.tier = d?.tier ?? 0;
    this.lureUses = d?.lure ?? 0;
    this.corkUses = d?.cork ?? 0;
    this.streak = d?.streak ?? 0;
    this.applyRodTier();
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

  private facingDir(out = new THREE.Vector3()): THREE.Vector3 {
    switch (this.game.player.facing) {
      case 'up':
        return out.set(0, 0, -1);
      case 'down':
        return out.set(0, 0, 1);
      case 'left':
        return out.set(-1, 0, 0);
      default:
        return out.set(1, 0, 0);
    }
  }

  /**
   * Update the cast aim: towards the pointer on the water (casts started with the mouse), else the
   * held movement keys (8 directions, camera-relative like walking), else the facing. The farmer
   * turns to face it.
   */
  private updateAim(): void {
    const g = this.game;
    const p = g.player.position;
    let set = false;
    if (this.aimMouse && g.input.pointer.inside) {
      _ndc.set(g.input.pointer.x, g.input.pointer.y);
      _ray.setFromCamera(_ndc, g.rc.camera);
      _plane.constant = -(this.waterLevel() + 0.0);
      if (_ray.ray.intersectPlane(_plane, _v)) {
        _v.sub(p).setY(0);
        if (_v.lengthSq() > 0.25) {
          this.aim.copy(_v.normalize());
          set = true;
        }
      }
    }
    if (!set) {
      const a = g.input.moveAxis();
      if (Math.hypot(a.x, a.y) > 0.1) {
        const yaw = THREE.MathUtils.degToRad(g.rc.rig.yaw);
        const c = Math.cos(yaw);
        const sn = Math.sin(yaw);
        this.aim.set(a.x * c + a.y * sn, 0, -a.x * sn + a.y * c).normalize();
        set = true;
      }
    }
    if (!set && this.st === 'idle') this.facingDir(this.aim);
    this.rig.targetYaw = Math.atan2(this.aim.x, this.aim.z);
  }

  /** Max cast distance (m): grows with fishing level and the rod tier. */
  private maxCast(): number {
    return 5.6 + this.level() * 0.25 + ROD_TIERS[this.tier]!.cast;
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
    this.aimMouse = this.game.input.mouse.left;
    this.facingDir(this.aim);
    this.setState('charging');
    this.powerT = 0;
    this.power = 0;
    this.powerStep = -1;
    this.gear.setRodVisible(true);
    this.gear.hold(null);
  }

  /**
   * Where a cast of `power` lands along the aim: the farthest water point along the throw (so a
   * strong cast over a narrow pond still lands wet), else the full distance on dry ground.
   */
  private landing(power: number, out: THREE.Vector3): { onWater: boolean; depth: number } {
    const p = this.game.player.position;
    const dir = this.aim;
    const dist = 1.6 + power * this.maxCast();
    let onWater = false;
    let land = dist;
    for (let d = dist; d >= 0.9; d -= 0.2) {
      if (this.isWater(p.x + dir.x * d, p.z + dir.z * d)) {
        land = d;
        onWater = true;
        break;
      }
    }
    out.set(p.x + dir.x * land, 0, p.z + dir.z * land);
    const map = this.game.world.current;
    const ground = map ? map.heightAt(out.x, out.z) : 0;
    const wy = this.waterLevel();
    out.y = onWater ? wy : ground + 0.05;
    return { onWater, depth: onWater ? Math.max(0, wy - ground) : 0 };
  }

  private release(): void {
    this.castPower = this.power;
    this.lockPlayer(true);
    this.gear.setRodVisible(true);
    this.gear.setReticle(null);
    this.waterY = this.waterLevel();
    this.gear.waterY = this.waterY;
    const l = this.landing(this.power, this.target);
    this.onWater = l.onWater;
    this.depth = l.depth;
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
    // Bait (one per cast, if carried) and a better rod bring the bite on sooner.
    const inv = this.game.services.inventory;
    this.baited = !!inv && inv.count('bait') > 0 && inv.remove('bait', 1);
    const req: FishRollReq = {
      rid: this.ridSeq++,
      map: this.game.world.current?.id ?? '',
      depth: this.depth,
      power: this.castPower,
      baited: this.baited,
      lure: !!inv && inv.count('treasureLure') > 0,
      level: this.level(),
      tier: this.tier,
      streak: this.streak,
    };
    this.hooked = null;
    this.roll = null;
    this.nibbles = [];
    this.waitT = 1e9;
    if (!this.roller) {
      this.applyRoll(this.rollFor(req));
      return;
    }
    // Farmhand: the host rolls the fish; the float just sits until it answers (or gives up).
    const rid = req.rid;
    this.pendingRid = rid;
    const give = (r: FishRoll): void => {
      if (this.pendingRid !== rid || this.st !== 'waiting') return;
      this.applyRoll(r);
    };
    setTimeout(() => give({ rid, fishId: null, luck: 0, treasure: false, wait: 5, nibbles: [] }), ROLL_TIMEOUT);
    this.roller(req).then(give, () => give({ rid, fishId: null, luck: 0, treasure: false, wait: 3, nibbles: [] }));
  }

  private pickFish(pool: FishDef[], power = this.castPower, depth = this.depth): FishDef {
    const bonus = power * 0.5 + Math.min(1, depth / 2) * 0.5;
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
    this.splashT = 0.32;
    this.sfx.bite();
    this.game.rc.rig.addShake(0.35);
    this.hitstop = 0.06;
    this.game.events.emit('fishing:bite', { fishId: this.hooked.id });
  }

  private hook(): void {
    const def = this.hooked!;
    this.setState('reeling');
    this.sfx.hook();
    this.game.rc.rig.addShake(0.3);
    const inv = this.game.services.inventory;
    const cork = !!inv && inv.count('corkBobber') > 0;
    const lure = !!inv && inv.count('treasureLure') > 0;
    const lv = this.level();
    // Treasure: the roll decided it (host-authoritative in co-op); practice / demo fights roll here.
    const treasureOdds = this.roll ? (this.roll.treasure ? 1 : 0) : 0.14 + lv * 0.01 + (lure ? 0.25 : 0) + Math.min(this.streak, 5) * 0.02;
    const barH = 0.27 - def.difficulty * 0.04 + lv * 0.012 + ROD_TIERS[this.tier]!.bar + (cork ? 0.035 : 0);
    this.mg = { def, ...newReel({ difficulty: def.difficulty, behavior: def.behavior, barH, treasureOdds, rand: Math.random, auto: this.demo !== null }) };
    this.ui.openReel(def, { level: lv, bait: this.baited, cork, lure, tier: this.tier });
    this.game.events.emit('fishing:hook', { fishId: def.id });
  }

  private catchFish(): void {
    const mg = this.mg!;
    const def = mg.def;
    const lv = this.level();
    // Quality from how well the fight went (time inside the bar, perfect, perfect streak), the cast
    // and skill; only a pinch of luck.
    const insideK = THREE.MathUtils.clamp(mg.insideT / Math.max(0.5, mg.t), 0, 1);
    const streakK = Math.min(this.streak, 5) * 0.03;
    const luck = this.roll?.luck ?? Math.random();
    const sizeFrac = THREE.MathUtils.clamp(0.08 + insideK * 0.3 + this.castPower * 0.25 + lv * 0.025 + (mg.perfect ? 0.1 : 0) + luck * 0.25, 0, 1);
    const lengthCm = def.size[0] + (def.size[1] - def.size[0]) * sizeFrac;
    const score = insideK * 0.62 + (mg.perfect ? 0.18 : 0) + this.castPower * 0.08 + lv * 0.02 + streakK + sizeFrac * 0.06;
    const quality = mg.perfect && score > 0.95 && lv >= 4 ? 3 : score > 0.76 ? 2 : score > 0.55 ? 1 : 0;
    let treasure: string | null = null;
    if (mg.treasure?.got) {
      const [id, qty] = TREASURE[Math.floor(Math.random() * TREASURE.length)]!;
      this.game.events.emit('item:give', { itemId: id, qty });
      const gold = 40 + Math.floor(Math.random() * 90);
      this.game.services.economy?.add(gold, 'treasure');
      treasure = `${qty > 1 ? `${qty}× ` : ''}${itemDef(id)?.name ?? id} + ${gold}g`;
    }
    this.streak = mg.perfect ? this.streak + 1 : 0;
    this.wearTackle();
    this.gainXp(fishXp(def, mg.perfect));
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
    if (this.roll && this.roller) this.game.events.emit('fishing:claim', { claim: { rid: this.roll.rid, fishId: def.id, perfect: mg.perfect, treasure: !!treasure } });
  }

  /** Tackle carried in the pack wears out per catch. */
  private wearTackle(): void {
    const inv = this.game.services.inventory;
    if (!inv) return;
    if (inv.count('corkBobber') > 0 && ++this.corkUses >= TACKLE_USES) {
      this.corkUses = 0;
      inv.remove('corkBobber', 1);
      this.game.events.emit('ui:toast', { text: 'Your Cork Bobber wore out', kind: 'info' });
    }
    if (inv.count('treasureLure') > 0 && ++this.lureUses >= TACKLE_USES) {
      this.lureUses = 0;
      inv.remove('treasureLure', 1);
      this.game.events.emit('ui:toast', { text: 'Your Glimmer Lure wore out', kind: 'info' });
    }
  }

  private gainXp(n: number): void {
    const before = this.level();
    this.totalXp += n;
    const after = this.level();
    this.lastXp = { gained: n, leveled: after > before };
    if (after > before) {
      this.sfx.levelUp();
      this.game.events.emit('ui:toast', { text: `Fishing level ${after}! Taller catch bar, longer casts.`, kind: 'good' });
      this.game.events.emit('fishing:level', { level: after });
    }
  }

  private showCatchCard(): void {
    const res = this.result!;
    const rec = this.recs[res.def.id];
    const isNew = !rec;
    const isRecord = !rec || res.lengthCm > rec.best;
    this.recs[res.def.id] = { caught: (rec?.caught ?? 0) + 1, best: Math.max(rec?.best ?? 0, res.lengthCm) };
    const price = Math.round(res.def.sell * [1, 1.25, 1.5, 2][res.quality]!);
    const lv = this.level();
    const lo = FISHING_XP[lv]!;
    const hi = FISHING_XP[Math.min(FISHING_XP.length - 1, lv + 1)]!;
    this.ui.showCard({
      def: res.def,
      lengthCm: res.lengthCm,
      quality: res.quality,
      price,
      isNew,
      isRecord,
      treasure: res.treasure,
      xp: this.lastXp.gained,
      level: lv,
      levelFrac: hi > lo ? (this.totalXp - lo) / (hi - lo) : 1,
      leveled: this.lastXp.leveled,
      streak: this.streak,
    }, this.screenAt(this.game.player.position, 1.3));
    this.sfx.catchJingle(res.quality);
    if (res.treasure) setTimeout(() => this.sfx.treasure(), 450);
  }

  private escape(): void {
    const def = this.mg?.def ?? this.hooked;
    if (this.st === 'reeling') this.gainXp(1);
    this.streak = 0;
    this.ui.closeReel();
    this.mg = null;
    this.sfx.escape();
    this.note(this.st === 'bite' ? 'Too slow…' : 'It got away…');
    this.setState('reelin');
    if (def) this.game.events.emit('fishing:escape', { fishId: def.id });
  }

  private cancel(instant = false): void {
    if (this.st === 'idle') return;
    this.gear.setReticle(null);
    this.ui.hideAll();
    this.mg = null;
    this.result = null;
    this.practice = false;
    if (instant) this.finish();
    else this.setState('reelin');
  }

  private finish(): void {
    this.setState('idle');
    this.gear.setReticle(null);
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
    if (this.rig.torso) this.rig.torso.rotation.y = 0;
    this.hooked = null;
    this.result = null;
    this.roll = null;
    this.pendingRid = 0;
    this.demo = null;
    if (this.practice) {
      this.practice = false;
      this.game.events.emit('ui:open', { name: 'none' });
    }
    this.lockPlayer(false);
  }

  private startPractice(): void {
    if (this.st !== 'idle') this.cancel(true);
    const slot = this.rodSlot();
    if (slot >= 0) this.game.events.emit('toolbar:select', { slot });
    this.practice = true;
    this.lockPlayer(true);
    this.gear.setRodVisible(true);
    this.waterY = this.waterLevel();
    this.gear.waterY = this.waterY;
    const p = this.game.player.position;
    const dir = this.facingDir(this.aim);
    this.target.set(p.x + dir.x * 4, this.waterY, p.z + dir.z * 4);
    this.bob.copy(this.target);
    this.onWater = true;
    const pool = this.available();
    this.hooked = pool.length ? this.pickFish(pool) : FISH[Math.floor(Math.random() * FISH.length)]!;
    this.hook();
    if (this.mg) {
      this.mg.auto = false;
      this.mg.grace = 2; // a practice fight gives you time to find the bar
    }
    this.gear.resetLine(this.bob);
  }

  private note(text: string): void {
    const s = this.screenAt(this.game.player.position, 2.6);
    this.ui.note(text, s.x, s.y);
  }

  // ───────────────────────────────────────────── co-op demo

  private static readonly COOP_ID = 77;
  /** Scripted remote cycle: [state, seconds]. */
  private static readonly COOP_SCRIPT: [NetState, number][] = [
    ['charging', 1.3],
    ['casting', 0.95],
    ['waiting', 3.2],
    ['bite', 0.7],
    ['reeling', 5.5],
    ['caught', 3.4],
    ['reelin', 0.4],
    ['idle', 1.2],
  ];

  private startCoopDemo(): void {
    const g = this.game;
    const q = new URLSearchParams(location.search);
    const want = q.get('rphase') ?? 'reel';
    const map: Record<string, NetState> = { cast: 'casting', charge: 'charging', wait: 'waiting', bite: 'bite', reel: 'reeling', catch: 'caught' };
    const st = map[want] ?? 'reeling';
    const farmer = new RemoteFarmer(PRESET_LOOKS[1]!);
    const p = g.player.position;
    const x = p.x;
    const z = p.z + 2.7;
    const y = g.world.current ? g.world.current.heightAt(x, z) : p.y;
    farmer.position.set(x, y, z);
    farmer.yaw = farmer.targetYaw = -Math.PI / 2;
    g.scene.add(farmer.root);
    const idx = FishingSystem.COOP_SCRIPT.findIndex(([s]) => s === st);
    this.coopDemo = { farmer, t: FishingSystem.COOP_SCRIPT[idx]![1] * (st === 'caught' ? 0.6 : 0.5), phase: idx, live: q.get('live') === '1', netT: 0, x, z, y };
  }

  private stopCoopDemo(): void {
    const d = this.coopDemo;
    if (!d) return;
    d.farmer.dispose();
    this.remote(FishingSystem.COOP_ID, null);
    this.ui.remoteTag(FishingSystem.COOP_ID, null);
    this.coopDemo = null;
  }

  /** Drive the scripted remote: its body here, its fishing only through snapshots (like the net). */
  private updateCoopDemo(dt: number, game: Game): void {
    const d = this.coopDemo;
    if (!d) return;
    if (game.world.current?.id !== 'beach') return this.stopCoopDemo();
    const script = FishingSystem.COOP_SCRIPT;
    if (d.live) {
      d.t += dt;
      if (d.t > script[d.phase]![1]) {
        d.t = 0;
        d.phase = (d.phase + 1) % script.length;
      }
    } else if (script[d.phase]![0] === 'caught') d.t = Math.min(d.t + dt, script[d.phase]![1] * 0.9);
    const [st, dur] = script[d.phase]!;
    const k = Math.min(1, d.t / dur);
    const t = game.time;
    // Body: idle rig + the fishing arm pose (the RemoteFarmer's own rod stays hidden).
    const f = d.farmer;
    f.anim = 'idle';
    f.speed = 0;
    f.targetYaw = st === 'caught' && k > 0.2 ? THREE.MathUtils.degToRad(game.rc.rig.yaw) : -Math.PI / 2;
    f.update(dt, t);
    const power = st === 'charging' ? Math.min(1, k * 1.3) : 0.8;
    const arc = st === 'caught' ? Math.min(1, d.t / 0.5) : 0;
    if (st !== 'idle') poseAnglerArms(f.rig, st, t, power, arc);
    // Snapshot: feet, float along the scripted flight / wait / fight, streamed at 10 Hz.
    d.netT -= dt;
    if (d.netT > 0) return;
    d.netT = 0.1;
    const wy = this.waterLevel();
    const tx = d.x - 5.6;
    const tz = d.z + 0.5;
    let bx = tx;
    let by = wy;
    let bz = tz;
    if (st === 'charging' || st === 'idle') {
      bx = d.x - 0.4;
      by = d.y + 2.4;
      bz = d.z;
    } else if (st === 'casting') {
      const kk = Math.max(0, (d.t - 0.22) / (dur - 0.22));
      bx = THREE.MathUtils.lerp(d.x - 1.6, tx, kk);
      bz = THREE.MathUtils.lerp(d.z, tz, kk);
      by = THREE.MathUtils.lerp(d.y + 2.8, wy, kk) + Math.sin(kk * Math.PI) * 2.2;
    } else if (st === 'bite') by = wy - 0.2;
    else if (st === 'reeling') {
      bx = tx + Math.sin(t * 1.3) * 0.5 + d.t * 0.25;
      bz = tz + Math.sin(t * 0.9) * 0.9;
      by = wy - 0.08;
    } else if (st === 'reelin') {
      bx = THREE.MathUtils.lerp(tx, d.x - 1.5, k);
      by = THREE.MathUtils.lerp(wy, d.y + 2.5, k);
    }
    const tension = st === 'reeling' ? 0.3 + 0.7 * k : 0;
    const r2 = (v: number): number => Math.round(v * 100) / 100;
    const snap: FishNetSnap = [STATE_CODES.indexOf(st), r2(power), r2(d.x), r2(d.y), r2(d.z), r2(f.yaw), r2(bx), r2(by), r2(bz), st === 'reeling' || st === 'bite' || st === 'caught' ? 'coralSnapper' : '', r2(arc), r2(tension), 46, 'beach'];
    this.remote(FishingSystem.COOP_ID, snap, performance.now());
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
    const dir = this.facingDir(this.aim);
    this.rig.targetYaw = Math.atan2(dir.x, dir.z);
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
        this.mg!.treasure = { pos: 0.22, prog: 0.45, got: false };
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

  /**
   * Power-meter anchor: beside the farmer (clear of the big head) at any zoom, on the side they're
   * casting towards — the cocked rod sticks out on the other side.
   */
  private meterAt(p: THREE.Vector3): { x: number; y: number } {
    const s = this.screenAt(p, 1.1);
    const pxM = Math.abs(this.screenAt(p, 2.1).y - s.y);
    const a = this.screenAt(_w.copy(p).addScaledVector(this.aim, 1.5), 1.1);
    const side = a.x < s.x - 2 ? -1 : 1;
    // Well clear of the farmer (and the pier posts beside them), level with the chest.
    return { x: s.x + side * (46 + pxM * 1.45), y: s.y + 10 };
  }

  private useHeld(): boolean {
    const i = this.game.input;
    return i.mouse.left || i.keys.has('Space') || i.keys.has('KeyC') || i.held('use');
  }

  /** Co-op: publish our snapshot, draw other farmers' angling. */
  private updateCoop(dt: number, game: Game, h: number): void {
    this.updateCoopDemo(dt, game);
    if (this.coopDemo) {
      const s = this.screenAt(this.coopDemo.farmer.position, 2.75);
      this.ui.remoteTag(FishingSystem.COOP_ID, 'Juniper', s.x, s.y, '#4e9ee0');
    }
    this.netT -= dt;
    if (this.st !== this.netSt || (this.st !== 'idle' && this.netT <= 0)) {
      this.netT = 1 / NET_HZ;
      this.netSt = this.st;
      game.events.emit('fishing:net', { snap: this.snapshot() });
    }
    if (!this.remotes.size) return;
    const here = game.world.current?.id ?? '';
    const cam = game.rc.camera;
    for (const a of this.remotes.values()) {
      a.update(dt, game.time, cam, here, h, (p) => this.screenAt(p, 0));
      this.ui.remoteBang(a.id, a.bang.on, a.bang.x, a.bang.y - 26);
      if (a.caughtNote) {
        const s = this.screenAt(_w.set(a.gear.heldRoot.position.x, a.gear.heldRoot.position.y, a.gear.heldRoot.position.z), 1.0);
        this.ui.note(`${a.caughtNote}!`, s.x, s.y);
        a.caughtNote = null;
      }
    }
  }

  update(dt: number, game: Game): void {
    const h = game.rc.renderer.domElement.height;
    this.gear.update(dt, game.time, h);
    this.sfx.update(dt, game.time * 0.9);
    this.updateCoop(dt, game, h);
    // End-of-fight camera push-in (eases back out once the fight is over).
    {
      const want = this.tension() * 0.9;
      let np = this.camPush + (want - this.camPush) * (1 - Math.exp(-dt * (want > this.camPush ? 2.5 : 4)));
      if (want === 0 && np < 1e-3) np = 0;
      game.rc.rig.distance -= np - this.camPush;
      this.camPush = np;
    }
    if (this.st === 'idle') {
      this.wasHolding = this.useHeld();
      return;
    }
    // Sim time: real dt normally, frozen phases in demos still animate on the render clock; a short
    // hitstop on the bite freezes the fishing sim for a beat.
    let sdt = game.paused && !this.demo && !this.practice ? 0 : dt;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      sdt = 0;
    }
    this.stT += sdt;
    const holding = this.useHeld();
    // Edge from the held state, or the input's per-frame latch (a tap shorter than one frame — easy
    // at low fps — still sets the hook).
    const pressed = (holding && !this.wasHolding) || game.input.pressed('use');
    this.wasHolding = holding;
    const player = game.player;
    const head = this.screenAt(player.position, 2.2);

    switch (this.st) {
      case 'charging': {
        if (this.demo === 'cast') {
          this.power = 0.986 + 0.011 * Math.sin(game.time * 5);
        } else {
          this.updateAim();
          this.powerT += sdt;
          const k = (this.powerT / 1.5) % 2;
          this.power = k < 1 ? k : 2 - k;
          const step = this.power >= 0.97 ? 4 : Math.floor(this.power * 4);
          if (step !== this.powerStep) {
            if (step > this.powerStep) this.sfx.powerTick(step);
            this.powerStep = step;
          }
          if (!holding && this.stT > 0.08) {
            this.ui.showPower(null, 0, 0);
            this.release();
            break;
          }
        }
        const s = this.meterAt(player.position);
        this.ui.showPower(this.power, s.x, s.y);
        const l = this.landing(this.power, _sp);
        this.gear.setReticle(_sp, this.power, !l.onWater, dt);
        break;
      }
      case 'casting': {
        this.gear.setReticle(null);
        {
          const s1 = this.meterAt(player.position);
          this.ui.showPower(this.power > 0.965 && this.stT < 0.3 ? this.power : null, s1.x, s1.y);
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
        // Whoosh trail behind the flying float.
        if (k < 0.97) this.gear.fx.emit(this.bob, { color: 0xf4fbff, count: 1, speed: 0.08, size: 0.06 + this.castPower * 0.04, gravity: 0.2, life: 0.32, up: 0.05 });
        if (k >= 1 && this.demo !== 'flight') this.landed();
        break;
      }
      case 'waiting': {
        if (pressed && !this.demo) {
          this.setState('reelin');
          break;
        }
        if (this.demo !== 'wait') this.waitT -= sdt;
        while (this.nibbles.length && this.waitT <= this.nibbles[0]! && this.waitT < 1e8) {
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
        // The fish keeps tugging: spray at the float while the "!" is up.
        this.splashT -= dt;
        if (this.splashT <= 0) {
          this.splashT = this.demo === 'bite' ? 0.7 : 0.32;
          this.gear.splash(this.bob, this.demo === 'bite');
        }
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
    const frozen = this.demo === 'reel';
    const end = stepReel(mg, dt, holdingInput, Math.random, { frozen, onTreasure: () => this.sfx.treasure() });
    if (frozen) {
      // Demo: breathe around a good-looking value.
      mg.progress = 0.64 + Math.sin(mg.t * 0.7) * 0.05;
      mg.perfect = true;
    }
    // Tension past 75 %: faster, higher reel clicks (+ the rod bends harder, the camera pushes in).
    const tension = this.tension();
    this.sfx.reel(dt, mg.holding ? 16 + tension * 14 : 0, 1 + tension * 0.35);
    // Splashes at the float as the fish fights.
    this.splashT -= dt;
    if (this.splashT <= 0) {
      this.splashT = (0.5 + Math.random() * 1.1 - def.difficulty * 0.3) * (1 - tension * 0.45);
      this.gear.splash(this.bob, tension > 0.6 && Math.random() < 0.4);
      if (Math.random() < 0.5) this.sfx.fishSplash();
    }
    const v = this.view;
    v.bar = mg.bar;
    v.barH = mg.barH;
    v.fish = mg.fish;
    v.fishV = mg.fishV;
    v.progress = mg.progress;
    v.treasure = treasureVisible(mg) ? mg.treasure : null;
    v.holding = mg.holding;
    v.inside = mg.inside;
    v.perfect = mg.perfect;
    v.bounce = mg.bounce;
    v.slack = mg.slack;
    const s = this.screenAt(this.game.player.position, 1.2);
    this.ui.placeReel(s.x, s.y);
    this.ui.drawReel(v, dt);
    if (frozen) return;
    if (end === 'caught') this.catchFish();
    else if (end === 'escaped') {
      if (this.practice) {
        // Practice never ends in a lost fish: it slips, you get another go.
        mg.progress = 0.35;
        mg.grace = mg.t + 1.5;
        mg.perfect = true;
        this.sfx.escape();
        this.note('It slipped! Again…');
      } else this.escape();
    }
  }

  /** 0..1 end-of-fight tension (progress 0.75 → 1). */
  private tension(): number {
    return this.st === 'reeling' && this.mg ? THREE.MathUtils.clamp((this.mg.progress - 0.75) / 0.25, 0, 1) : 0;
  }

  /** Pose the farmer's arms + rod, move the float, simulate the line. */
  private poseAndDraw(dt: number, game: Game): void {
    const r = this.rig;
    const t = game.time;
    const st = this.st;
    const pw = this.power;
    const fwd = _fwd.copy(this.aim);
    const reelingNow = st === 'reeling' || st === 'bite';
    const holdOverhead = st === 'caught' && this.catchArc > 0.6;
    const heldScale = this.gear.heldRoot.children.length ? this.gear.heldRoot.children[0]!.scale.x : 1;
    // Arms (after the player's own animation this frame; rotations: -x raises the arm forward/up).
    if (r.armR && r.armL && r.torso) {
      let ar = -0.95;
      let al = -0.8;
      let arz = 0.3;
      let alz = -0.35;
      let torsoX = 0.05;
      let torsoY = 0;
      if (st === 'charging') {
        // Wind-up: both hands up over the right shoulder, torso twisted back.
        ar = -2.75 - pw * 0.2;
        al = -2.25 - pw * 0.2;
        arz = 0.05;
        alz = 0.35;
        torsoX = -0.1 - pw * 0.12;
        torsoY = 0.12 + pw * 0.14;
      } else if (st === 'casting') {
        const k = Math.min(1, this.stT / 0.22);
        const e = 1 - Math.pow(1 - k, 3);
        ar = THREE.MathUtils.lerp(-2.95, -0.75, e);
        al = THREE.MathUtils.lerp(-2.45, -0.9, e);
        alz = THREE.MathUtils.lerp(0.35, -0.35, e);
        torsoX = THREE.MathUtils.lerp(-0.24, 0.18, e);
        torsoY = THREE.MathUtils.lerp(0.26, -0.08, e);
      } else if (reelingNow) {
        const shake = st === 'reeling' ? Math.sin(t * 38) * (0.05 + this.tension() * 0.05) : 0;
        ar = -1.35 + shake;
        al = -1.05 + Math.sin(t * (this.mg?.holding ? 16 : 5)) * 0.25;
        alz = -0.45 + Math.cos(t * (this.mg?.holding ? 16 : 5)) * 0.15;
        torsoX = -0.12;
      } else if (holdOverhead) {
        // Presenting the catch: arms forward and spread to grip the head and the tail.
        const lift = Math.sin(t * 3) * 0.05;
        const spread = THREE.MathUtils.clamp(0.62 + (heldScale - 0.8) * 0.4, 0.6, 0.85);
        ar = -1.35 + lift;
        al = -1.35 + lift;
        arz = -spread;
        alz = spread;
        torsoX = -0.14;
      } else if (st === 'caught') {
        ar = -1.6;
        al = -1.4;
      }
      r.armR.rotation.set(ar, 0, arz);
      r.armL.rotation.set(al, 0, alz);
      if (st === 'casting' && this.stT < 0.14) {
        // Release squash: a quick crouch-and-spring (~3 frames down, then back).
        const q = Math.sin((this.stT / 0.14) * Math.PI) * (0.1 + this.castPower * 0.06);
        r.body.scale.set(r.body.scale.x * (1 + q * 0.5), r.body.scale.y * (1 - q), r.body.scale.z * (1 + q * 0.5));
      }
      r.torso.rotation.x = torsoX;
      r.torso.rotation.y = torsoY;
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
      // Grip point: between the two hands, held out in front of the chest (clear of the torso).
      _hr.set(0, -0.3, 0.02);
      _hl.set(0, -0.3, 0.02);
      r.armR.localToWorld(_hr);
      r.armL.localToWorld(_hl);
      this.holdPt.addVectors(_hr, _hl).multiplyScalar(0.5);
      _bodyFwd.set(Math.sin(r.yaw ?? 0), 0, Math.cos(r.yaw ?? 0));
      this.holdPt.addScaledVector(_bodyFwd, 0.28).y += 0.15;
    }
    // Rod pose.
    const hand = _hand.set(0, -0.34, 0.04);
    if (r.armR) r.armR.localToWorld(hand);
    else hand.copy(game.player.position).y += 1.1;
    let dir: THREE.Vector3;
    let bend = 0;
    if (st === 'charging') {
      // Rod cocked back over the shoulder, angled a little towards the camera so it reads against the sky / water.
      const cy = THREE.MathUtils.degToRad(game.rc.rig.yaw);
      _toCam.set(Math.sin(cy), 0, Math.cos(cy));
      dir = _dir.copy(fwd).multiplyScalar(-0.85).addScaledVector(_UP, 0.75 + pw * 0.2).addScaledVector(_toCam, 0.35);
      bend = 0.08 + pw * 0.1;
    } else if (st === 'casting') {
      const k = Math.min(1, this.stT / 0.22);
      const e = 1 - Math.pow(1 - k, 3);
      dir = _dir.copy(fwd).multiplyScalar(THREE.MathUtils.lerp(-0.9, 1, e)).addScaledVector(_UP, THREE.MathUtils.lerp(0.8, 0.45, e));
      bend = Math.sin(e * Math.PI) * 0.45;
    } else if (reelingNow) {
      dir = _dir.copy(fwd).multiplyScalar(0.55).addScaledVector(_UP, 1.05);
      dir.x += Math.sin(t * 9) * 0.04;
      // Heavy load: the blank arcs right over towards the fish.
      const ten = this.tension();
      bend = st === 'reeling' ? 0.84 + 0.08 * Math.sin(t * (13 + ten * 10)) + (this.mg ? (this.mg.inside ? 0.06 : -0.08) : 0) + ten * 0.14 : 0.9;
    } else if (holdOverhead) {
      _side.set(fwd.z, 0, -fwd.x);
      dir = _dir.copy(fwd).multiplyScalar(-0.3).addScaledVector(_UP, 0.2).addScaledVector(_side, -0.9);
    } else dir = _dir.copy(fwd).addScaledVector(_UP, 0.62);
    dir.normalize();
    this.gear.poseRod({ hand, dir, bend, bendTo: this.bob, crank: t * (this.mg?.holding ? 16 : st === 'reelin' ? 20 : 0) });
    // Rod goes down (out of frame) while both hands hold the catch up.
    this.gear.setRodVisible(!(st === 'caught' && this.catchArc >= 1));

    // Float.
    const bob = this.gear.bobber;
    const inWater = st === 'waiting' || st === 'bite' || st === 'reeling';
    bob.visible = st !== 'charging' && !(st === 'caught' && this.catchArc >= 1);
    this.gear.lineVisible = st !== 'charging' && !(st === 'caught' && this.catchArc >= 1) && !(st === 'casting' && this.stT < 0.22);
    const pos = _pos.copy(this.bob);
    let tiltX = 0;
    let tiltZ = 0;
    if (inWater) {
      pos.y = this.waterY + Math.sin(t * 2.4) * 0.018;
      if (st === 'waiting' && this.stT < 0.35 && this.nibbles !== null) pos.y -= Math.sin(Math.min(1, this.stT / 0.35) * Math.PI) * 0.06;
      if (st === 'bite') {
        // Yanked fully under for a beat, then tugging just below the surface.
        const dunk = this.stT < 0.15 ? 0.25 : 0.25 * Math.exp(-(this.stT - 0.15) * 9);
        pos.y -= Math.max(dunk, 0.1 + Math.sin(t * 30) * 0.03);
      }
      if (st === 'reeling' && this.mg) {
        _side.set(fwd.z, 0, -fwd.x);
        pos.addScaledVector(_side, (this.mg.fish - 0.5) * 0.9);
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
    this.gear.ease = st === 'reeling' || st === 'bite' ? 0.45 : st === 'casting' ? 0.4 : st === 'reelin' ? 0.3 : 0.12;
    // The line ties onto the float's top eye (quill tip), tilting with it.
    const eye = 0.34;
    const lineEnd = _w.set(pos.x + Math.sin(tiltZ) * -eye * 0.5, pos.y + eye * Math.cos(tiltX) * Math.cos(tiltZ), pos.z + Math.sin(tiltX) * eye * 0.5);
    if (st === 'casting' && this.stT < 0.22) this.gear.resetLine(this.gear.tip);
    this.gear.updateLine(Math.min(dt, 1 / 30), lineEnd, game.rc.camera);

    // Fish shadow circling in before the bite.
    if (st === 'waiting' && this.hooked && this.waitT < 2.6) {
      const k = THREE.MathUtils.clamp(1 - this.waitT / 2.6, 0, 1);
      const ang = t * 1.3;
      const rad = 1.3 * (1 - k) + 0.25;
      _sp.set(this.bob.x + Math.cos(ang) * rad, 0, this.bob.z + Math.sin(ang) * rad);
      this.gear.setShadow(_sp, k, -ang - Math.PI / 2);
    } else if (st === 'reeling' && this.mg) this.gear.setShadow(pos, 0.7, t * 2);
    else this.gear.setShadow(null, 0);

    // Held fish.
    if (st === 'caught' && this.result) {
      if (this.catchArc > 0 && !this.gear.heldRoot.children.length) this.gear.hold(this.result.def, this.result.lengthCm);
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
          _fxp.set(this.holdPt.x + (Math.random() - 0.5) * 1.4, this.holdPt.y + 0.2 + Math.random() * 0.7, this.holdPt.z + 0.2);
          this.gear.fx.emit(_fxp, { color: 0xfff2b0, count: 2, speed: 0.4, size: 0.07, gravity: -0.4, life: 0.9, up: 0.6 });
        }
      }
    }
  }
}
