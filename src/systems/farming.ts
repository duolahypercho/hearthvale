/**
 * FarmingSystem — the core farming loop and its game feel.
 *
 *   Soil      hoe → raised soil pad heaves up (clods fly, dust, shock ring); watering can pours an arc
 *             of droplets, the soil darkens smoothly where they land; sprinklers (3 tiers) spray in
 *             the morning with rotating jets.
 *   Crops     18 crops · 6 visual stages · regrowing / trellis / giant (3×3) crops · quality stars ·
 *             wither at season change · crows raid unprotected fields (scarecrows guard r = 8.5).
 *   Tools     tiers basic/copper/iron/gold; hoe & can charge on hold (3 / 5 tiles / 3×3 slam),
 *             watering-can capacity + refill at water, per-action energy costs.
 *   Feel      anticipation → impact → hit-stop → recovery poses (entities/farmer-actions), camera
 *             micro-shake, squash & stretch on crops, produce popping into the air above the farmer's
 *             head and arcing into the toolbar, tile target cursor with validity colours.
 *   Weeds     regrow a few tiles a night around existing weed clumps.
 *
 * Tile truth lives in the map TileGrid flags (Tilled / Watered) plus this system's crop map.
 * Talks to others only via events / services:
 *   in:  item:use, player:interact, day:start, crops:grow, season:change, demo:stage
 *   out: soil:tilled, soil:watered, crop:planted, crop:harvested, crop:withered, crop:giant,
 *        crow:arrive, crow:eat, tool:swing, tool:impact, tool:charge, can:refill, can:empty,
 *        sprinkler:spray, harvest:collect, item:give · service `farming`
 * SFX hooks: every `tool:*`, `can:*`, `crow:*`, `crop:*` and `harvest:collect` event is timed to the
 * visual moment (impact frame, landing, pop) so the audio team can bind sounds 1:1.
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import type { Season } from '../core/time';
import type { GameMap } from '../world/map';
import { TileFlag, TileType } from '../world/tiles';
import {
  CROPS,
  RIPE_STAGE,
  stageForDays,
  daysToRipe,
  daysForStage,
  cropsFor,
  SPRINKLERS,
  sprinklerOffsets,
  SCARECROW_RADIUS,
  CAN_CAPACITY,
  QUALITY_COLORS,
  FERTILIZERS,
  FARMING_LEVELS,
  farmingLevel,
  harvestXp,
  qualityOdds,
  rollQualityFrom,
  type CropId,
  type CropQuality,
  type ToolTier,
} from '../data/crops';
import { itemDef } from '../data/items';
import { SoilBeds, SOIL_HEIGHT, SOIL_LIFT } from '../world/props/soil';
import { CropVisuals, produceGeometry, cropTriangleStats, buildProduceCrate, type CropHandle, type GiantKind } from '../world/props/crops';
import { FarmFX } from '../world/props/farmfx';
import { TileCursor, type CursorState } from '../world/props/tilecursor';
import { CrowFlock } from '../world/props/crows';
import { buildTool, CAN_SPOUT } from '../world/props/tools';
import { buildSprinklerModel, type SprinklerModel } from '../world/props/sprinklers';
import { FarmerActions, IMPACT, type ActionKind } from '../entities/farmer-actions';
import type { Nature, NatureHandle } from '../world/props/nature';
import { flyItemToToolbar } from '../ui/item-fly';
import { registerFarmIcons } from '../ui/farm-icons';
import { Rng } from '../core/rng';

export type FarmTool = 'hoe' | 'wateringCan' | 'axe' | 'pickaxe' | 'scythe';
export type ImpactKind = 'soil' | 'tilled' | 'water' | 'refill' | 'stone' | 'wood' | 'weed' | 'crop' | 'giant' | 'none';

declare module '../core/events' {
  interface GameEvents {
    'soil:tilled': { x: number; z: number };
    'soil:watered': { x: number; z: number };
    'crop:planted': { cropId: CropId; x: number; z: number };
    'crop:harvested': { cropId: CropId; x: number; z: number; qty: number; quality: number };
    'crop:withered': { cropId: CropId; x: number; z: number };
    'crop:giant': { cropId: CropId; x: number; z: number };
    /** A crow lands on the field (caw). */
    'crow:arrive': { x: number; z: number };
    /** A crow ate a crop. */
    'crow:eat': { cropId: CropId; x: number; z: number };
    /** Tool wind-up started (whoosh). `charge` = AOE level for charged slams. */
    'tool:swing': { tool: string; tier: number; charge: number };
    /** The tool connected (fires on the impact frame). */
    'tool:impact': { tool: string; x: number; z: number; hit: ImpactKind; strength: number };
    /** Charge level reached while holding a tool (rising chime). */
    'tool:charge': { tool: string; level: number };
    'can:refill': { x: number; z: number };
    'can:empty': Record<string, never>;
    'sprinkler:spray': { x: number; z: number; on: boolean };
    /** Produce reached the backpack (end of the harvest pop). */
    'harvest:collect': { itemId: string; qty: number; quality: number };
    /** Fertilizer worked into a tile (a soft scatter SFX). */
    'soil:fertilized': { x: number; z: number; tier: number };
    /** Farming XP gained (harvests); `level` is the level after the gain. */
    'farming:xp': { gained: number; xp: number; level: number };
    /** Farming level up (fanfare). */
    'farming:level': { level: number };
    /** A tool action was refused (too tired): a weary grunt, no swing. */
    'tool:refused': { tool: string; reason: 'tired' };
  }
}

export interface FarmingApi {
  toolTier(tool: FarmTool): ToolTier;
  setToolTier(tool: FarmTool, tier: ToolTier): void;
  /** Watering can contents. */
  can(): { water: number; capacity: number };
  cropAt(x: number, z: number): { id: CropId; stage: number; ripe: boolean; dead: boolean } | null;
  /** Debug / demos: perform an action on the tile the farmer faces. */
  act(what: FarmTool | 'sow' | 'harvest' | 'charge', opts?: { level?: number; seed?: string }): void;
  /** Debug / demos: stage a showcase ('field' | 'harvest' | 'tools' | 'giant' | 'crows'). */
  stage(name: string): void;
  /** Debug / shots: resume a frozen demo action and freeze it again at `t` seconds (scrub a swing). */
  scrub(t: number): void;
  /** Farming skill (0..10) and XP. */
  level(): number;
  xp(): number;
  addXp(n: number): void;
  /** Quality odds for a harvest on (x, z) right now (skill + fertilizer + care). */
  odds(x: number, z: number): { radiant: number; gold: number; silver: number } | null;
  /** Fertilizer tier worked into (x, z) (0 = none). */
  fertAt(x: number, z: number): number;
  /** Mark a rect as greenhouse ground: crops there ignore the season (no wither, plant anything). */
  setGreenhouse(rect: { x0: number; z0: number; x1: number; z1: number }, on?: boolean): void;
  isGreenhouse(x: number, z: number): boolean;
  /** Debug: triangles per crop per growth stage (render-budget tuning). */
  cropStats(): Record<string, number[]>;
}

declare module '../core/game' {
  interface GameServices {
    farming: FarmingApi;
  }
}

interface CropState {
  id: CropId;
  days: number;
  /** Days of growth when last harvested (regrowing crops), else 0. */
  base: number;
  handle: CropHandle | null;
  stage: number;
  seed: number;
  dead: boolean;
  /** Days the tile was dry while the crop was growing (lowers quality). */
  missed: number;
  /** A crow got it: a chewed stub instead of a withered husk (still dead; scythe it). */
  eaten?: boolean;
}

interface Sprinkler {
  id: string;
  model: SprinklerModel;
  spin: number;
  /** Seconds of test spray left (after placing). */
  test: number;
}

interface FarmTile {
  x: number;
  z: number;
  crop: CropState | null;
  sprinkler: Sprinkler | null;
  /** Fertilizer tier worked into the soil (0 none, 1 basic, 2 quality); lost when un-tilled. */
  fert?: number;
}

interface Giant {
  id: CropId;
  x0: number;
  z0: number;
  handle: CropHandle;
  hp: number;
  wobble: number;
}

interface SavedTile {
  x: number;
  z: number;
  wet: boolean;
  /** false = sprinkler on grass (absent in old saves = tilled). */
  tilled?: boolean;
  crop?: { id: CropId; days: number; base: number; seed: number; dead?: boolean; missed?: number; eaten?: boolean };
  sprinkler?: boolean | string;
  fert?: number;
}

interface CropAnim {
  h: CropHandle;
  kind: 'grow' | 'water' | 'rustle' | 'harvest' | 'wobble';
  t: number;
  dir: number;
  /** Remove the handle when done (harvested plant). */
  kill?: boolean;
}

const key = (x: number, z: number): string => `${x},${z}`;
const TOOLS: FarmTool[] = ['hoe', 'wateringCan', 'axe', 'pickaxe', 'scythe'];
const SOIL_COLOR = 0x6e4a30;
/** Cosmetic randomness (particles, wobble directions): seeded so demos and tests replay exactly. */
const fxRng = new Rng('farming-fx');
const rnd = (a: number, b: number): number => a + fxRng.next() * (b - a);

/** Seconds of each swing during which the tool head leaves a smear (downswing → follow-through). */
const SWING_WINDOW: Partial<Record<ActionKind, [number, number]>> = { chop: [0.2, 0.31], slam: [0.14, 0.27], sweep: [0.1, 0.3] };
/** Tool-local [inner, outer] edge of the smear per tool (see world/props/tools.ts). */
const TRAIL_POINTS: Record<string, [THREE.Vector3, THREE.Vector3]> = {
  // Wide ribbon: from the handle's upper third out to the blade's cutting edge.
  hoe: [new THREE.Vector3(0, 0.36, 0.02), new THREE.Vector3(0, 0.57, 0.2)],
  axe: [new THREE.Vector3(0, 0.53, 0.16), new THREE.Vector3(0, 0.57, 0.23)],
  pickaxe: [new THREE.Vector3(0, 0.58, 0.22), new THREE.Vector3(0, 0.6, 0.3)],
  scythe: [new THREE.Vector3(0, 0.8, 0.08), new THREE.Vector3(0, 0.68, 0.52)],
};

/** farm-crows: the unguarded patch the crows raid (outside the field scarecrow's radius). */
const CROW_PATCH = { x0: 24, z0: 30, x1: 27, z1: 32 };

/** Smear tint per tool tier (basic / copper / iron / gold). */
const TIER_TRAIL = [0xfff6e0, 0xffc89a, 0xe6f2ff, 0xffdc6a];

/** Showcase planting per season: row crop ids (back → front). */
const SHOWCASE: Record<Season, CropId[]> = {
  spring: ['greenBean', 'cauliflower', 'parsnip', 'kale', 'potato', 'strawberry'],
  summer: ['corn', 'sunflower', 'tomato', 'hotPepper', 'blueberry'],
  fall: ['corn', 'sunflower', 'eggplant', 'beet', 'yam'],
  winter: [],
};

/** Hero harvest field rows per season (back → front), plus which giant crop to feature. */
/** `null` rows are a packed-dirt path splitting the field into a tall bed (north) and a low bed (south). */
const HARVEST_ROWS: Record<Season, { rows: (CropId | null)[]; giant: CropId | null; trellis: CropId | null; crate: CropId[] }> = {
  spring: { rows: ['greenBean', 'cauliflower', 'kale', 'potato', null, 'parsnip', 'strawberry', 'cauliflower', 'strawberry'], giant: 'cauliflower', trellis: 'greenBean', crate: ['cauliflower', 'parsnip', 'strawberry', 'potato'] },
  summer: { rows: ['hops', 'corn', 'sunflower', 'tomato', null, 'blueberry', 'melon', 'melon', 'hotPepper'], giant: 'melon', trellis: 'hops', crate: ['tomato', 'melon', 'corn', 'hotPepper', 'blueberry'] },
  fall: { rows: ['grape', 'corn', 'sunflower', 'eggplant', null, 'beet', 'pumpkin', 'pumpkin', 'yam'], giant: 'pumpkin', trellis: 'grape', crate: ['pumpkin', 'eggplant', 'beet', 'corn', 'yam'] },
  winter: { rows: [], giant: null, trellis: null, crate: [] },
};

export class FarmingSystem implements System, FarmingApi {
  readonly name = 'farming';
  private game!: Game;
  private tiles = new Map<string, FarmTile>();
  private giants = new Map<string, Giant>();
  private soil: SoilBeds | null = null;
  private crops: CropVisuals | null = null;
  private fx!: FarmFX;
  private cursor = new TileCursor();
  private crows!: CrowFlock;
  private actions: FarmerActions | null = null;
  private map: GameMap | null = null;
  private seededGarden = false;
  private showcase: string | null = null;
  private splatDirty = false;
  private tiers: Record<FarmTool, ToolTier> = { hoe: 0, wateringCan: 0, axe: 0, pickaxe: 0, scythe: 0 };
  private canLevel: number = CAN_CAPACITY[0];
  private timers: { t: number; fn: () => void }[] = [];
  private anims: CropAnim[] = [];
  private chargeTool: FarmTool | null = null;
  private chargeLevel = 0;
  private chargeHold = 0;
  private hitStop = 0;
  private fxScale = 1;
  /** Demo slow motion (`&slow=0.3`): action + FX time scale, so frame sequences catch a whole swing. */
  private slow = 1;
  private sprayAlways = false;
  private sprayT = 0;
  private wasSpraying = false;
  private autoLoop: { tool: string; t: number } | null = null;
  /** Tile the running action targets (the cursor stays locked on it through the swing). */
  private actTile: { x: number; z: number } | null = null;
  /** A demo staged crops outside the starter field (reset before the next demo). */
  private bigStaged = false;
  /** Gameplay rolls (quality, yields, giants, crows, weeds): seeded per save. */
  private rng!: Rng;
  private xpTotal = 0;
  private glass: { x0: number; z0: number; x1: number; z1: number }[] = [];
  /** Cursor: hidden for a beat after an impact so the soil change reads; tool of the last action. */
  private cursorHold = 0;
  private lastTool: { id: string; t: number } | null = null;
  private doneTile: { x: number; z: number } | null = null;
  /** Splat texels whose path value we raised (trampled rim around beds) → original value. */
  private rimOrig = new Map<number, number>();
  /** Demo staging: dirt paths painted (tile index → original path splat) and props set down. */
  private pathOrig = new Map<number, number>();
  private stageProps: THREE.Object3D[] = [];

  init(game: Game): void {
    this.game = game;
    this.rng = game.rng.fork('farming');
    registerFarmIcons();
    const ground = (x: number, z: number): number => this.surfaceY(x, z);
    this.fx = new FarmFX(ground);
    this.crows = new CrowFlock((x, z) => (this.map ? this.map.heightAt(x, z) : 0));
    game.scene.add(this.fx.group, this.cursor.mesh);
    this.actions = new FarmerActions(game.player);
    game.provide('farming', this);
    game.events.on('item:use', (e) => this.useItem(e.itemId, e.x, e.z, e.slot));
    game.events.on('player:interact', ({ x, z }) => this.interact(x, z));
    game.events.on('day:start', () => this.newDay());
    game.events.on('crops:grow', ({ days }) => this.growAll(days, false));
    game.events.on('season:change', ({ season }) => this.onSeason(season));
    game.events.on('demo:stage', ({ name, showcase }) => this.onDemo(name, showcase));
  }

  onMapChange(mapId: string, game: Game): void {
    const map = game.world.current;
    this.crows.clear();
    this.actions?.cancel();
    if (!map || mapId !== 'farm') {
      this.map = null;
      return;
    }
    this.map = map;
    if (!this.soil) {
      this.soil = new SoilBeds(map.grid.width, map.grid.depth);
      this.crops = new CropVisuals();
      map.root.add(this.soil.group, this.crops.group, this.crows.group);
    }
    const gh = map.plots?.greenhouse;
    if (gh && !this.isGreenhouse(gh.x0, gh.z0)) this.setGreenhouse(gh);
    if (!this.seededGarden) {
      this.seededGarden = true;
      this.plantGarden(game.calendar.season);
    }
  }

  // ═════════════════════════════════════════════ service API

  toolTier(tool: FarmTool): ToolTier {
    return this.tiers[tool] ?? 0;
  }

  setToolTier(tool: FarmTool, tier: ToolTier): void {
    this.tiers[tool] = tier;
    if (tool === 'wateringCan') this.canLevel = CAN_CAPACITY[tier];
  }

  can(): { water: number; capacity: number } {
    return { water: this.canLevel, capacity: CAN_CAPACITY[this.tiers.wateringCan] };
  }

  cropAt(x: number, z: number): { id: CropId; stage: number; ripe: boolean; dead: boolean } | null {
    const c = this.tiles.get(key(x, z))?.crop;
    return c ? { id: c.id, stage: c.stage, ripe: c.stage >= RIPE_STAGE && !c.dead, dead: c.dead } : null;
  }

  act(what: FarmTool | 'sow' | 'harvest' | 'charge', opts: { level?: number; seed?: string } = {}): void {
    const t = this.game.player.facingTile();
    if (what === 'harvest') return this.interact(t.x, t.z);
    if (what === 'sow') return this.useItem(opts.seed ?? `${cropsFor(this.game.calendar.season)[0] ?? 'parsnip'}Seeds`, t.x, t.z, -1);
    if (what === 'charge') {
      const tool: FarmTool = this.tiers.wateringCan > 0 && opts.seed === 'wateringCan' ? 'wateringCan' : 'hoe';
      this.releaseCharge(tool, Math.max(1, Math.min(3, opts.level ?? this.tiers[tool] ?? 1)));
      return;
    }
    this.useItem(what, t.x, t.z, -1);
  }

  stage(name: string): void {
    this.onDemo(name, [name]);
  }

  scrub(t: number): void {
    const acts = this.actions;
    if (!acts?.active) return;
    acts.setFreeze(t);
    acts.timeScale = this.slow;
    this.fxScale = this.slow;
  }

  // ═════════════════════════════════════════════ tile helpers

  private grid() {
    return this.map?.grid ?? null;
  }

  private tileY(x: number, z: number): number {
    return this.map ? this.map.heightAt(x + 0.5, z + 0.5) : 0;
  }

  /** Ground / soil surface height at a world point (particles land on this). */
  private surfaceY(wx: number, wz: number): number {
    if (!this.map) return 0;
    const x = Math.floor(wx);
    const z = Math.floor(wz);
    const g = this.map.grid;
    if (g.hasFlag(x, z, TileFlag.Tilled)) return this.tileY(x, z) + SOIL_LIFT + SOIL_HEIGHT * 0.9;
    return this.map.heightAt(wx, wz) + 0.01;
  }

  private cropY(x: number, z: number): number {
    return this.tileY(x, z) + SOIL_LIFT + SOIL_HEIGHT * 0.85;
  }

  private isTilled(x: number, z: number): boolean {
    return this.grid()?.hasFlag(x, z, TileFlag.Tilled) ?? false;
  }

  private mask(x: number, z: number): number {
    return (this.isTilled(x, z - 1) ? 1 : 0) | (this.isTilled(x + 1, z) ? 2 : 0) | (this.isTilled(x, z + 1) ? 4 : 0) | (this.isTilled(x - 1, z) ? 8 : 0);
  }

  private refreshSoil(x: number, z: number, animate = false): void {
    const g = this.grid();
    if (!g || !this.soil) return;
    if (!g.hasFlag(x, z, TileFlag.Tilled)) {
      this.soil.clear(x, z);
      return;
    }
    this.soil.set(x, z, this.tileY(x, z), { wet: g.hasFlag(x, z, TileFlag.Watered), mask: this.mask(x, z), animate, fert: this.tiles.get(key(x, z))?.fert });
  }

  private refreshAround(x: number, z: number, animate = false): void {
    this.refreshSoil(x, z, animate);
    this.refreshSoil(x + 1, z);
    this.refreshSoil(x - 1, z);
    this.refreshSoil(x, z + 1);
    this.refreshSoil(x, z - 1);
  }

  private paint(x: number, z: number): void {
    const t = this.map?.terrain;
    const g = this.grid();
    if (!t || !g) return;
    // The soil pad draws the bed itself; the terrain only gets a sub-threshold 'tilled' value, which
    // its shader turns into a soft contact-AO darkening of the turf around (and under) the pad.
    t.setTileSplat(x, z, { tilled: g.hasFlag(x, z, TileFlag.Tilled) ? 0.42 : 0, wet: g.hasFlag(x, z, TileFlag.Watered) ? 1 : 0 });
    this.splatDirty = true;
    this.rim(x, z);
    this.rim(x + 1, z);
    this.rim(x - 1, z);
    this.rim(x, z + 1);
    this.rim(x, z - 1);
  }

  /**
   * Trampled margin: untilled ground beside a bed gets a light "path" splat, so the lawn goes
   * darker and scuffed where it meets the soil (contact AO + the beds pop off the grass).
   * Restores the original value when the neighbouring beds go away.
   */
  private rim(x: number, z: number, strength = 0.3): void {
    const t = this.map?.terrain;
    const g = this.grid();
    if (!t || !g || !g.inBounds(x, z)) return;
    const idx = z * g.width + x;
    const want = !g.hasFlag(x, z, TileFlag.Tilled) && (this.isTilled(x + 1, z) || this.isTilled(x - 1, z) || this.isTilled(x, z + 1) || this.isTilled(x, z - 1)) && g.getType(x, z) !== TileType.Water ? strength : 0;
    const orig = this.rimOrig.get(idx);
    if (want > 0) {
      const base = orig ?? t.splatAt(x + 0.5, z + 0.5, 'path');
      if (orig === undefined) this.rimOrig.set(idx, base);
      t.setTileSplat(x, z, { path: Math.max(base, want) });
      this.splatDirty = true;
    } else if (orig !== undefined) {
      t.setTileSplat(x, z, { path: orig });
      this.rimOrig.delete(idx);
      this.splatDirty = true;
    }
  }

  private tile(x: number, z: number): FarmTile {
    let t = this.tiles.get(key(x, z));
    if (!t) {
      t = { x, z, crop: null, sprinkler: null };
      this.tiles.set(key(x, z), t);
    }
    return t;
  }

  private later(t: number, fn: () => void): void {
    if (t <= 0) fn();
    else this.timers.push({ t, fn });
  }

  private center(x: number, z: number, lift = 0.1): THREE.Vector3 {
    return new THREE.Vector3(x + 0.5, this.surfaceY(x + 0.5, z + 0.5) + lift - 0.1, z + 0.5);
  }

  private shake(a: number): void {
    this.game.rc.rig.addShake(a);
  }

  // ═════════════════════════════════════════════ tile ops (logic applies immediately)

  /** Till a tile. `force` clears debris / cover (showcase staging). */
  till(x: number, z: number, force = false, animate = false): boolean {
    const g = this.grid();
    if (!g || !g.inBounds(x, z)) return false;
    if (!g.hasFlag(x, z, TileFlag.Tillable) || g.hasFlag(x, z, TileFlag.Tilled) || g.hasFlag(x, z, TileFlag.Blocked)) return false;
    const obj = g.getObject(x, z);
    if (obj) {
      if (!force && obj.solid) return false;
      if (!force && obj.kind !== 'weed') return false;
      g.removeObject(x, z);
    }
    g.setFlag(x, z, TileFlag.Tilled);
    this.map?.clearGroundCover?.(x, z);
    this.paint(x, z);
    this.refreshAround(x, z, animate);
    this.game.events.emit('soil:tilled', { x, z });
    return true;
  }

  untill(x: number, z: number): void {
    const g = this.grid();
    if (!g || !g.hasFlag(x, z, TileFlag.Tilled)) return;
    const t = this.tiles.get(key(x, z));
    if (t?.crop) this.removeCrop(t);
    if (t) t.fert = 0;
    g.setFlag(x, z, TileFlag.Tilled, false);
    g.setFlag(x, z, TileFlag.Watered, false);
    this.paint(x, z);
    this.refreshAround(x, z);
  }

  /**
   * Water a tilled tile. `fadeIn` ≥ 0 delays the darkening until the water lands, then floods the
   * tile outward from `from` (world point) over ~0.35 s.
   */
  water(x: number, z: number, fadeIn = -1, from?: { x: number; z: number }): boolean {
    const g = this.grid();
    if (!g || !g.hasFlag(x, z, TileFlag.Tilled)) return false;
    if (!g.hasFlag(x, z, TileFlag.Watered)) {
      g.setFlag(x, z, TileFlag.Watered);
      if (fadeIn >= 0) {
        this.soil?.setWet(x, z, false);
        this.later(fadeIn, () => {
          this.soil?.setWet(x, z, true, true, from);
          this.paint(x, z);
        });
      } else {
        this.paint(x, z);
        this.refreshSoil(x, z);
      }
    }
    this.game.events.emit('soil:watered', { x, z });
    return true;
  }

  plant(id: CropId, x: number, z: number, days = 0, seed?: number): boolean {
    const g = this.grid();
    if (!g || !g.hasFlag(x, z, TileFlag.Tilled)) return false;
    const t = this.tile(x, z);
    if (t.crop || t.sprinkler || this.giantAt(x, z)) return false;
    t.crop = { id, days, base: 0, handle: null, stage: -1, seed: seed ?? this.rng.int(0, 999999), dead: false, missed: 0 };
    g.setObject(x, z, { kind: 'crop', id, solid: !!CROPS[id].trellis });
    this.refreshCrop(t);
    this.game.events.emit('crop:planted', { cropId: id, x, z });
    return true;
  }

  private refreshCrop(t: FarmTile, anim: CropAnim['kind'] | null = null): void {
    const c = t.crop;
    if (!c || !this.crops) return;
    const y = this.cropY(t.x, t.z);
    if (c.dead) {
      if (c.handle) this.crops.remove(c.handle);
      c.handle = c.eaten ? this.crops.addEaten(t.x + 0.5, y, t.z + 0.5, c.seed, !!CROPS[c.id].trellis, CROPS[c.id].leaf) : this.crops.addWithered(t.x + 0.5, y, t.z + 0.5, c.seed, !!CROPS[c.id].trellis);
      c.stage = -2;
      return;
    }
    const stage = stageForDays(CROPS[c.id], c.days);
    if (stage === c.stage && c.handle) return;
    if (c.handle) this.crops.remove(c.handle);
    c.stage = stage;
    c.handle = this.crops.add(c.id, stage, t.x + 0.5, y, t.z + 0.5, c.seed);
    if (anim) this.animate(c.handle, anim);
  }

  private removeCrop(t: FarmTile, animateOut = false): void {
    const h = t.crop?.handle;
    if (h) {
      if (animateOut) this.animate(h, 'harvest', true);
      else this.crops?.remove(h);
    }
    t.crop = null;
    const g = this.grid();
    if (g?.getObject(t.x, t.z)?.kind === 'crop') g.setObject(t.x, t.z, null);
  }

  private animate(h: CropHandle, kind: CropAnim['kind'], kill = false): void {
    // One animation per handle: replace any running one.
    const i = this.anims.findIndex((a) => a.h === h);
    if (i >= 0) {
      if (this.anims[i]!.kill) return;
      this.anims.splice(i, 1);
    }
    this.anims.push({ h, kind, t: 0, dir: fxRng.next() < 0.5 ? -1 : 1, kill });
  }

  private giantAt(x: number, z: number): Giant | null {
    for (const gi of this.giants.values()) if (x >= gi.x0 && x < gi.x0 + 3 && z >= gi.z0 && z < gi.z0 + 3) return gi;
    return null;
  }

  // ═════════════════════════════════════════════ harvest

  /** Share of this crop's growing days the tile was watered (misses lower quality). */
  private care(c: CropState): number {
    const grown = Math.max(1, c.days - c.base);
    return Math.max(0, 1 - c.missed / (grown + c.missed));
  }

  /** Demos: force the next harvests' quality (null = roll). */
  private forceQuality: CropQuality | null = null;

  private rollQuality(c: CropState, fert: number): CropQuality {
    if (this.forceQuality !== null) return this.forceQuality;
    return rollQualityFrom(qualityOdds(this.lvl(), fert, this.care(c)), this.rng.next(), this.rng.next(), this.rng.next());
  }

  private lvl(): number {
    return farmingLevel(this.xpTotal);
  }

  level(): number {
    return this.lvl();
  }

  xp(): number {
    return this.xpTotal;
  }

  addXp(n: number): void {
    if (n <= 0) return;
    const before = this.lvl();
    this.xpTotal += n;
    const level = this.lvl();
    this.game.events.emit('farming:xp', { gained: n, xp: this.xpTotal, level });
    if (level > before) {
      this.game.events.emit('farming:level', { level });
      const next = FARMING_LEVELS[level];
      this.game.events.emit('ui:toast', { text: `Farming <b>level ${level}</b>! Better odds of silver & gold produce${next ? '' : ' — mastered'}`, kind: 'gold' });
    }
  }

  odds(x: number, z: number): { radiant: number; gold: number; silver: number } | null {
    const t = this.tiles.get(key(x, z));
    if (!t?.crop) return null;
    return qualityOdds(this.lvl(), t.fert ?? 0, this.care(t.crop));
  }

  fertAt(x: number, z: number): number {
    return this.tiles.get(key(x, z))?.fert ?? 0;
  }

  setGreenhouse(rect: { x0: number; z0: number; x1: number; z1: number }, on = true): void {
    this.glass = this.glass.filter((r) => !(r.x0 === rect.x0 && r.z0 === rect.z0 && r.x1 === rect.x1 && r.z1 === rect.z1));
    if (on) this.glass.push({ ...rect });
  }

  cropStats(): Record<string, number[]> {
    return cropTriangleStats();
  }

  isGreenhouse(x: number, z: number): boolean {
    return this.glass.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  }

  /** Can `id` grow on (x, z) this season (greenhouse ground ignores the calendar)? */
  private inSeason(id: CropId, x: number, z: number, season: Season = this.game.calendar.season): boolean {
    return CROPS[id].seasons.includes(season) || this.isGreenhouse(x, z);
  }

  /**
   * Harvest a ripe crop. `style`: 'pull' (by hand: the farmer yanks it and holds it overhead),
   * 'cut' (scythe: pops straight into the backpack), 'instant' (no visuals).
   */
  harvest(x: number, z: number, style: 'pull' | 'cut' | 'instant' = 'pull', delay = 0): boolean {
    const t = this.tiles.get(key(x, z));
    const c = t?.crop;
    if (!t || !c || c.dead || c.stage < RIPE_STAGE) return false;
    const def = CROPS[c.id];
    const [lo, hi] = def.yield ?? [1, 1];
    const qty = lo + this.rng.int(0, hi - lo) + (this.rng.next() < 0.02 + this.lvl() * 0.01 ? 1 : 0);
    const quality = this.rollQuality(c, t.fert ?? 0);
    this.game.events.emit('item:give', { itemId: def.produce, qty, quality });
    this.addXp(harvestXp(def));
    this.game.events.emit('crop:harvested', { cropId: c.id, x, z, qty, quality });
    const oldHandle = c.handle;
    if (def.regrow) {
      c.base = daysToRipe(def) - def.regrow;
      c.days = c.base;
      c.missed = 0;
      c.stage = -1;
      c.handle = null;
      if (oldHandle) this.animate(oldHandle, 'harvest', true);
      this.later(delay + 0.18, () => {
        if (t.crop === c) this.refreshCrop(t, 'grow');
      });
    } else {
      c.handle = null;
      this.removeCrop(t, false);
      if (oldHandle) this.later(delay, () => this.animate(oldHandle, 'harvest', true));
    }
    if (style !== 'instant') this.later(delay, () => this.harvestFx(x, z, c.id, qty, quality, style));
    return true;
  }

  private harvestFx(x: number, z: number, id: CropId, qty: number, quality: number, style: 'pull' | 'cut'): void {
    const def = CROPS[id];
    const p = this.center(x, z, 0.25);
    this.fx.leafBurst(p, def.leaf, 9, 1.4);
    this.fx.harvestGlint(p, def.color, quality);
    for (let i = 0; i < 6; i++) this.fx.clod(p.clone().add(new THREE.Vector3(rnd(-0.2, 0.2), -0.1, rnd(-0.2, 0.2))), new THREE.Vector3(rnd(-1, 1), rnd(1.5, 2.8), rnd(-1, 1)), SOIL_COLOR, rnd(0.02, 0.04), 1.2);
    this.shake(0.12 + quality * 0.04);
    const pl = this.game.player;
    const geo = produceGeometry(id);
    // Held up over the hat (clear of the brim), the hero item outlined with its quality star.
    const head = (): THREE.Vector3 => pl.position.clone().add(new THREE.Vector3(0, 2.78, 0.05));
    const chest = (): THREE.Vector3 => pl.position.clone().add(new THREE.Vector3(0, 1.3, 0.2));
    const n = Math.min(3, qty);
    for (let i = 0; i < n; i++) {
      const hero = i === 0 && style === 'pull';
      const off = new THREE.Vector3((i - (n - 1) / 2) * 0.22, i * 0.05, 0);
      this.fx.pop(geo, p.clone().add(new THREE.Vector3(0, 0.1, 0)), {
        to: hero ? () => head() : () => chest().add(off),
        flight: hero ? 0.36 : 0.3 + i * 0.06,
        hold: hero ? 0.55 : 0.05,
        star: i === 0 && quality > 0 ? QUALITY_COLORS[quality as CropQuality] : null,
        scale: hero ? 1.45 : 1.2,
        onDone: i === 0 ? (pos) => this.collect(def.produce, qty, quality, pos) : undefined,
      });
    }
  }

  /** Produce reached the farmer: fly the icon into the toolbar. */
  private collect(itemId: string, qty: number, quality: number, pos: THREE.Vector3): void {
    this.game.events.emit('harvest:collect', { itemId, qty, quality });
    const inv = this.game.services.inventory;
    const slot = inv ? inv.slots.findIndex((s) => s?.id === itemId && ((s as { quality?: number }).quality ?? 0) === quality) : -1;
    const cam = this.game.rc.camera;
    const v = pos.clone().project(cam);
    const el = this.game.rc.renderer.domElement.getBoundingClientRect();
    const sx = el.left + (v.x * 0.5 + 0.5) * el.width;
    const sy = el.top + (-v.y * 0.5 + 0.5) * el.height;
    try {
      flyItemToToolbar(this.game.opts.uiRoot, itemId, { x: sx, y: sy }, slot < 0 ? (inv?.slots.findIndex((s) => s?.id === itemId) ?? -1) : slot, quality);
    } catch {
      /* HUD not mounted (tests) */
    }
  }

  // ═════════════════════════════════════════════ sprinklers

  private placeSprinkler(x: number, z: number, id = 'sprinkler', test = true): boolean {
    const g = this.grid();
    if (!g || !this.map || !g.isWalkable(x, z)) return false;
    const t = this.tile(x, z);
    if (t.crop || t.sprinkler) return false;
    const tier = SPRINKLERS[id]?.tier ?? 0;
    const model = buildSprinklerModel(tier);
    model.root.position.set(x + 0.5, this.tileY(x, z) + (this.isTilled(x, z) ? SOIL_LIFT + SOIL_HEIGHT * 0.6 : 0), z + 0.5);
    model.root.userData.perfTag = 'sprinkler';
    this.map.root.add(model.root);
    const sp: Sprinkler = { id, model, spin: rnd(0, 6), test: test ? 2.2 : 0 };
    t.sprinkler = sp;
    g.setObject(x, z, { kind: 'sprinkler', id, solid: true, onRemove: () => model.root.removeFromParent() });
    this.map.clearGroundCover?.(x, z);
    return true;
  }

  // ═════════════════════════════════════════════ gameplay

  private spend(energy: number): void {
    this.game.services.energy?.spend(energy);
  }

  private refuseT = 0;
  /** Too tired / wrong season: a head-shake instead of a swing, a shake and a (throttled) toast. */
  private refuse(tool: string, text = 'Too tired… <b>rest</b> or eat something first'): void {
    this.game.events.emit('tool:refused', { tool, reason: 'tired' });
    this.shake(0.1);
    if (this.actions && !this.actions.active) this.actions.start('shrug', { tool: null });
    if (this.refuseT > 0) return;
    this.refuseT = 1.6;
    this.game.events.emit('ui:toast', { text, kind: 'bad' });
  }

  /** Energy gate: plain swings run the bar negative (down to the pass-out floor); heavy ones need > 0. */
  private canWork(tool: string, heavy = false): boolean {
    const en = this.game.services.energy;
    if (!en || en.canAct(heavy)) return true;
    this.refuse(tool, heavy ? 'Too tired to swing that hard… <b>rest</b> first' : undefined);
    return false;
  }

  private dirVec(): { dx: number; dz: number } {
    switch (this.game.player.facing) {
      case 'up':
        return { dx: 0, dz: -1 };
      case 'down':
        return { dx: 0, dz: 1 };
      case 'left':
        return { dx: -1, dz: 0 };
      default:
        return { dx: 1, dz: 0 };
    }
  }

  /** Is the farmer actually standing next to this tile (vs. scripted item:use from tests)? */
  private near(x: number, z: number): boolean {
    const p = this.game.player.position;
    return Math.abs(p.x - (x + 0.5)) < 2.2 && Math.abs(p.z - (z + 0.5)) < 2.2;
  }

  private tool(id: string): THREE.Object3D {
    const tier = (TOOLS as string[]).includes(id) ? this.tiers[id as FarmTool] : 0;
    return buildTool(id, tier);
  }

  private startAction(kind: ActionKind, toolId: string | null, x: number, z: number, onImpact: () => void, extra: { freezeAt?: number; onUpdate?: (t: number) => void; onDone?: () => void } = {}): number {
    const acts = this.actions;
    if (!acts || !this.near(x, z)) {
      onImpact();
      return 0;
    }
    // Face the target tile.
    const p = this.game.player.position;
    const ddx = x + 0.5 - p.x;
    const ddz = z + 0.5 - p.z;
    if (Math.abs(ddx) > 0.3 || Math.abs(ddz) > 0.3) {
      const f = Math.abs(ddx) > Math.abs(ddz) ? (ddx > 0 ? 'right' : 'left') : ddz > 0 ? 'down' : 'up';
      if (f !== this.game.player.facing) this.game.player.setFacing(f);
    }
    this.actTile = { x, z };
    acts.side = this.cameraSide();
    const tier = toolId && (TOOLS as string[]).includes(toolId) ? this.tiers[toolId as FarmTool] : 0;
    this.game.events.emit('tool:swing', { tool: toolId ?? kind, tier, charge: 0 });
    acts.start(kind, {
      tool: toolId ? this.tool(toolId) : null,
      onImpact: () => {
        onImpact();
        this.cursorHold = 0.4;
        this.doneTile = { x, z };
        if (kind === 'chop' || kind === 'slam' || kind === 'sweep') this.hitStop = kind === 'slam' ? 0.09 : 0.05;
      },
      onUpdate: this.withTrail(kind, toolId, extra.onUpdate, TIER_TRAIL[tier] ?? 0xfff6e0),
      onDone: extra.onDone,
      freezeAt: extra.freezeAt,
    });
    return IMPACT[kind];
  }

  /** +1 if the camera sits on the farmer's right-hand side (wind-ups go over that shoulder). */
  private cameraSide(): number {
    const pl = this.game.player;
    const { dx, dz } = this.dirVec();
    const cam = this.game.rc.camera.position;
    // right = facing × up = (-dz, 0, dx)
    const d = -dz * (cam.x - pl.position.x) + dx * (cam.z - pl.position.z);
    return d >= 0 ? 1 : -1;
  }

  /** Wrap an action's onUpdate so the tool head leaves a motion smear through the swing window. */
  private withTrail(kind: ActionKind, toolId: string | null, inner?: (t: number) => void, color = 0xfff6e0, strength = 1): ((t: number) => void) | undefined {
    const win = SWING_WINDOW[kind];
    const pts = toolId ? TRAIL_POINTS[toolId] : undefined;
    if (!win || !pts) return inner;
    let started = false;
    let lastT = -1;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    return (t: number) => {
      inner?.(t);
      const acts = this.actions;
      // Only sample while the swing actually advances (frozen stills / hit-stop keep the smear).
      if (!acts || t < win[0] || t - lastT < 0.006) return;
      const from = Math.max(win[0], lastT);
      const to = Math.min(win[1], t);
      lastT = t;
      if (to <= from && started) return;
      if (!started) {
        started = true;
        this.fx.trail.begin(color, strength, kind === 'sweep' ? 0.2 : 0.12, kind === 'sweep' ? 0.18 : 0.1);
      }
      // Trace the real arc between the last frame and this one at ~240 Hz.
      const n = Math.max(1, Math.ceil((to - from) * 240));
      const times: number[] = [];
      for (let k = 1; k <= n; k++) times.push(from + ((to - from) * k) / n);
      acts.toolPointsAt(times, pts, (p) => this.fx.trail.sample(a.copy(p[0]!), b.copy(p[1]!)));
    };
  }

  private useItem(itemId: string, x: number, z: number, slot: number): void {
    const g = this.grid();
    if (!g || !this.map) return;
    if (this.actions?.active && this.near(x, z) && slot >= 0) return;
    const def = itemDef(itemId);
    const obj = g.getObject(x, z);
    const { dx, dz } = this.dirVec();
    if ((TOOLS as string[]).includes(itemId) && !this.canWork(itemId)) return;
    this.lastTool = { id: itemId, t: 2.5 };
    if (FERTILIZERS[itemId]) {
      this.fertilize(itemId, x, z, slot);
      return;
    }
    switch (itemId) {
      case 'hoe': {
        const giant = this.giantAt(x, z);
        const ok = !giant && this.till(x, z, false, false);
        if (ok) {
          // Logic done; the soil pad heaves up on the impact frame.
          this.soil?.clear(x, z, true);
          this.spend(2);
        } else this.spend(1); // a missed swing still tires the arms
        const tilledBefore = !ok && this.isTilled(x, z);
        this.startAction('chop', 'hoe', x, z, () => {
          const c = this.center(x, z, 0.05);
          if (ok) {
            this.refreshSoil(x, z, true);
            this.fx.hoeImpact(c, dx, dz, SOIL_COLOR, 1);
            // Torn sod: a few blades of grass flicked up with the clods.
            for (let i = 0; i < 6; i++) this.fx.leaf(c.clone().add(new THREE.Vector3(rnd(-0.3, 0.3), 0.05, rnd(-0.3, 0.3))), new THREE.Vector3(rnd(-1.2, 1.2), rnd(1.6, 3), rnd(-1.2, 1.2)), 0x6fae45, 0.04);
            this.shake(0.22);
          } else {
            this.fx.puff(c, new THREE.Vector3(0, 0.4, 0), 0xb89a78, 0.2, 0.6, { alpha: 0.3 });
            this.shake(0.08);
          }
          this.game.events.emit('tool:impact', { tool: 'hoe', x, z, hit: ok ? 'soil' : tilledBefore ? 'tilled' : 'none', strength: ok ? 1 : 0.3 });
        });
        this.armCharge('hoe');
        return;
      }
      case 'wateringCan': {
        this.pour(x, z, [[x, z]], 0);
        this.armCharge('wateringCan');
        return;
      }
      case 'scythe': {
        // A sweeping arc: the facing tile and its two neighbours across the swing.
        const px = -dz;
        const pz = dx;
        const targets: [number, number][] = [[x, z], [x + px, z + pz], [x - px, z - pz]];
        const cut: [number, number, string][] = [];
        for (const [tx, tz] of targets) {
          const tt = this.tiles.get(key(tx, tz));
          const o = g.getObject(tx, tz);
          if (tt?.crop?.dead) {
            cut.push([tx, tz, 'dead']);
            this.removeCrop(tt);
            this.game.events.emit('item:give', { itemId: 'fiber', qty: 1 });
          } else if (tt?.crop && tt.crop.stage >= RIPE_STAGE) {
            cut.push([tx, tz, 'crop']);
            this.harvest(tx, tz, 'cut', this.near(x, z) ? IMPACT.sweep : 0);
          } else if (o?.kind === 'weed') {
            cut.push([tx, tz, 'weed']);
            g.removeObject(tx, tz);
            this.game.events.emit('item:give', { itemId: 'fiber', qty: 1 });
          } else if (tt?.crop) {
            cut.push([tx, tz, 'rustle']);
          }
        }
        this.startAction('sweep', 'scythe', x, z, () => {
          for (const [tx, tz, what] of cut) {
            const c = this.center(tx, tz, 0.2);
            if (what === 'weed' || what === 'dead') this.fx.leafBurst(c, what === 'dead' ? 0x9a7c52 : 0x6fae45, 12, 2.2);
            if (what === 'rustle') {
              const h = this.tiles.get(key(tx, tz))?.crop?.handle;
              if (h) this.animate(h, 'rustle');
            }
          }
          // Arc of grass clippings along the blade path.
          for (let i = 0; i < 6; i++) this.fx.leaf(this.center(x + px * (i / 5 - 0.5) * 2, z + pz * (i / 5 - 0.5) * 2, 0.25), new THREE.Vector3(dx * 1.2 + rnd(-0.5, 0.5), rnd(0.8, 1.6), dz * 1.2 + rnd(-0.5, 0.5)), 0x7fb84a, 0.035);
          if (cut.length) this.shake(0.1);
          this.game.events.emit('tool:impact', { tool: 'scythe', x, z, hit: cut.some((c) => c[2] === 'crop') ? 'crop' : cut.length ? 'weed' : 'none', strength: cut.length ? 1 : 0.2 });
        });
        return;
      }
      case 'pickaxe': {
        let hit: ImpactKind = 'none';
        let give: [string, number] | null = null;
        if (obj?.kind === 'stone' || obj?.kind === 'boulder') {
          g.removeObject(x, z);
          give = ['stone', obj.kind === 'boulder' ? 5 : 1];
          hit = 'stone';
          this.spend(3);
        } else if (obj?.kind === 'sprinkler') {
          const t = this.tiles.get(key(x, z));
          const id = t?.sprinkler?.id ?? 'sprinkler';
          g.removeObject(x, z);
          if (t) t.sprinkler = null;
          give = [id, 1];
          hit = 'stone';
        } else if (this.isTilled(x, z) && !this.tiles.get(key(x, z))?.crop) {
          this.untill(x, z);
          hit = 'soil';
          this.spend(1);
        } else this.spend(1);
        this.startAction('chop', 'pickaxe', x, z, () => {
          const c = this.center(x, z, 0.1);
          if (hit === 'stone') {
            this.fx.chips(c, 0x9a948a, 14, dx, dz);
            this.fx.sparkle(c.clone().setY(c.y + 0.2), new THREE.Vector3(0, 1, 0), 0xfff0c0, 0.25, 0.25);
            this.shake(0.3);
          } else if (hit === 'soil') {
            this.fx.hoeImpact(c, dx, dz, SOIL_COLOR, 0.6);
            this.shake(0.15);
          } else this.shake(0.06);
          if (give) this.game.events.emit('item:give', { itemId: give[0], qty: give[1] });
          this.game.events.emit('tool:impact', { tool: 'pickaxe', x, z, hit, strength: hit === 'none' ? 0.3 : 1 });
        });
        return;
      }
      case 'axe': {
        const giant = this.giantAt(x, z);
        if (giant) {
          giant.hp--;
          const done = giant.hp <= 0;
          this.spend(3);
          this.startAction('chop', 'axe', x, z, () => {
            const c = new THREE.Vector3(giant.x0 + 1.5, this.tileY(giant.x0 + 1, giant.z0 + 1) + 0.6, giant.z0 + 1.5);
            this.fx.chips(c, CROPS[giant.id].color, 16, dx, dz);
            this.shake(done ? 0.55 : 0.3);
            this.game.events.emit('tool:impact', { tool: 'axe', x, z, hit: 'giant', strength: done ? 1.5 : 1 });
            if (done) this.breakGiant(giant);
            else this.animate(giant.handle, 'wobble');
          });
          return;
        }
        let hit: ImpactKind = 'none';
        if (obj?.kind === 'twig' || obj?.kind === 'stump' || obj?.kind === 'bush') {
          g.removeObject(x, z);
          hit = obj.kind === 'bush' ? 'weed' : 'wood';
          this.game.events.emit('item:give', { itemId: obj.kind === 'bush' ? 'fiber' : 'wood', qty: obj.kind === 'stump' ? 4 : obj.kind === 'bush' ? 2 : 1 });
          this.spend(3);
        } else this.spend(1);
        this.startAction('chop', 'axe', x, z, () => {
          const c = this.center(x, z, 0.1);
          if (hit === 'wood') {
            this.fx.chips(c, 0xb08050, 14, dx, dz);
            this.shake(0.28);
          } else if (hit === 'weed') {
            this.fx.leafBurst(c, 0x5e9a3a, 14, 2);
            this.shake(0.15);
          } else this.shake(0.06);
          this.game.events.emit('tool:impact', { tool: 'axe', x, z, hit, strength: hit === 'none' ? 0.3 : 1 });
        });
        return;
      }
    }
    if (def?.kind === 'seed' && def.crop) {
      const crop = CROPS[def.crop];
      if (!this.inSeason(def.crop, x, z)) {
        this.refuse('seeds', `${crop.name} won't grow in ${this.game.calendar.season}`);
        return;
      }
      if (this.plant(def.crop, x, z)) {
        if (slot >= 0) this.game.services.inventory?.takeFromSlot(slot, 1);
        const h = this.tiles.get(key(x, z))?.crop?.handle;
        if (h) this.crops?.pose(h, 0.001, 0.001);
        this.startAction('sow', 'seeds', x, z, () => {
          this.fx.sow(this.center(x, z, 0.12), crop.color);
          if (h) this.animate(h, 'grow');
          this.game.events.emit('tool:impact', { tool: 'seeds', x, z, hit: 'soil', strength: 0.5 });
        });
      }
    } else if (def && SPRINKLERS[itemId]) {
      if (this.placeSprinkler(x, z, itemId)) {
        if (slot >= 0) this.game.services.inventory?.takeFromSlot(slot, 1);
        const sp = this.tiles.get(key(x, z))?.sprinkler;
        if (sp) sp.model.root.scale.setScalar(0.001);
        this.startAction('place', null, x, z, () => {
          if (sp) this.popIn(sp.model.root);
          this.fx.puff(this.center(x, z, 0.1), new THREE.Vector3(0, 0.3, 0), 0xb89a78, 0.25, 0.7, { alpha: 0.4 });
          this.shake(0.1);
          this.game.events.emit('tool:impact', { tool: 'place', x, z, hit: 'soil', strength: 0.6 });
        });
      }
    }
  }

  /** Work fertilizer into a tilled tile (bare, or a crop no older than a sprout). */
  private fertilize(itemId: string, x: number, z: number, slot: number): void {
    const f = FERTILIZERS[itemId]!;
    const t = this.tiles.get(key(x, z));
    const c = t?.crop;
    if (!this.isTilled(x, z) || (t?.fert ?? 0) >= f.tier || (c && (c.dead || c.stage > 1)) || t?.sprinkler) return;
    const tile = this.tile(x, z);
    tile.fert = f.tier;
    if (slot >= 0) this.game.services.inventory?.takeFromSlot(slot, 1);
    this.startAction('sow', 'seeds', x, z, () => {
      this.soil?.setFert(x, z, f.tier, f.tint);
      const p = this.center(x, z, 0.12);
      this.fx.sow(p, f.tint);
      for (let i = 0; i < 10; i++) this.fx.clod(p.clone().add(new THREE.Vector3(rnd(-0.1, 0.1), 0.3, rnd(-0.1, 0.1))), new THREE.Vector3(rnd(-0.7, 0.7), rnd(0.4, 1.2), rnd(-0.7, 0.7)), f.tint, 0.012, 0.9);
      this.game.events.emit('soil:fertilized', { x, z, tier: f.tier });
      this.game.events.emit('tool:impact', { tool: 'fertilizer', x, z, hit: 'soil', strength: 0.4 });
    });
  }

  private popIn(o: THREE.Object3D): void {
    let t = 0;
    const step = (): void => {
      t += 1 / 60;
      const k = Math.min(1, t / 0.35);
      const e = 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2);
      o.scale.set(e, 2 - e, e).multiplyScalar(1);
      o.scale.set(Math.max(0.001, e), Math.max(0.001, e * (1 + (1 - k) * 0.3)), Math.max(0.001, e));
      if (k < 1) this.later(1 / 60, step);
      else o.scale.setScalar(1);
    };
    step();
  }

  /** Pour the watering can over `tiles` (first one = aimed tile). */
  private pour(x: number, z: number, tiles: [number, number][], charge: number): void {
    const g = this.grid();
    if (!g) return;
    const refill = g.hasFlag(x, z, TileFlag.WaterSource) || g.getType(x, z) === TileType.Water;
    if (refill) {
      const cap = CAN_CAPACITY[this.tiers.wateringCan];
      this.canLevel = cap;
      this.startAction('refill', 'wateringCan', x, z, () => {
        const c = new THREE.Vector3(x + 0.5, this.map!.heightAt(x + 0.5, z + 0.5) + 0.05, z + 0.5);
        this.fx.ring(c, 0.1, 0.9, 0.8, 0x9fd4ff);
        this.fx.ring(c, 0.05, 0.5, 0.6, 0xffffff);
        for (let i = 0; i < 14; i++) this.fx.drop(c.clone().add(new THREE.Vector3(rnd(-0.2, 0.2), 0.05, rnd(-0.2, 0.2))), new THREE.Vector3(rnd(-0.8, 0.8), rnd(1.5, 3), rnd(-0.8, 0.8)), 0.025);
        for (let i = 0; i < 8; i++) this.fx.sparkle(c.clone().add(new THREE.Vector3(rnd(-0.3, 0.3), 0.1, rnd(-0.3, 0.3))), new THREE.Vector3(0, rnd(0.2, 0.6), 0), 0xe8f8ff, 0.12, 0.6);
        this.shake(0.1);
        this.game.events.emit('can:refill', { x, z });
        this.game.events.emit('tool:impact', { tool: 'wateringCan', x, z, hit: 'refill', strength: 1 });
      });
      return;
    }
    if (this.canLevel <= 0) {
      this.startAction('pour', 'wateringCan', x, z, () => {
        this.game.events.emit('can:empty', {});
        const sp = this.actions?.toolPoint(CAN_SPOUT);
        if (sp) this.fx.drop(sp, new THREE.Vector3(0, -0.2, 0), 0.02);
      });
      return;
    }
    const wet: [number, number][] = [];
    for (const [tx, tz] of tiles) {
      if (this.canLevel <= 0) break;
      if (this.isTilled(tx, tz)) {
        wet.push([tx, tz]);
        this.canLevel--;
      }
    }
    const targets = tiles.length ? tiles : [[x, z] as [number, number]];
    const near = this.near(x, z);
    // Where the stream lands on each tile: the near side first (the pour floods outward from there).
    const pl = this.game.player.position;
    const landAt = (tx: number, tz: number): THREE.Vector3 => {
      const c = new THREE.Vector3(tx + 0.5, 0, tz + 0.5);
      const d = new THREE.Vector3(pl.x - c.x, 0, pl.z - c.z);
      if (d.lengthSq() > 1e-4) d.normalize().multiplyScalar(0.12);
      c.add(d);
      c.y = this.surfaceY(c.x, c.z);
      return c;
    };
    // Pour window (action time): the stream leaves the rose at 0.3 s, lands ~0.34 s later, and the
    // aim sweeps across the charged tiles in order. Soil floods from the landing point.
    const P0 = 0.3;
    const P1 = 0.78;
    const FLY = 0.34;
    const sweep = (i: number): number => P0 + ((P1 - P0) * i) / Math.max(1, targets.length);
    const wetSet = new Set(wet.map(([a, b]) => key(a, b)));
    targets.forEach(([tx, tz], i) => {
      if (!wetSet.has(key(tx, tz))) return;
      const land = near ? sweep(i) + FLY : 0;
      this.water(tx, tz, land, landAt(tx, tz));
      const h = this.tiles.get(key(tx, tz))?.crop?.handle;
      if (h) this.later(land, () => this.animate(h, 'water'));
    });
    this.spend(wet.length ? Math.max(1, 2 + charge * 2 - this.tiers.wateringCan) : 1);
    let emitted = 0;
    let splashT = 0;
    let lastT = 0;
    this.startAction('pour', 'wateringCan', x, z, () => {
      this.game.events.emit('tool:impact', { tool: 'wateringCan', x, z, hit: wet.length ? 'water' : 'none', strength: 0.5 + charge * 0.25 });
    }, {
      onUpdate: (t) => {
        const acts = this.actions;
        if (!acts) return;
        const dt = Math.max(0, t - lastT);
        lastT = t;
        if (t < P0) return;
        if (t > P1) {
          this.fx.stream.stop();
          return;
        }
        // Which tile is the stream on right now?
        const i = Math.min(targets.length - 1, Math.floor(((t - P0) / (P1 - P0)) * targets.length));
        const [tx, tz] = targets[i]!;
        const sp = acts.toolPoint(CAN_SPOUT);
        const aim = landAt(tx, tz);
        aim.x += Math.sin(t * 13) * 0.05;
        aim.z += Math.cos(t * 11) * 0.05;
        this.fx.stream.aim(sp, aim, FLY);
        // Fine shower from the rose around the main stream + droplets breaking off its end.
        const want = Math.floor((t - P0) * 90 * (1 + charge * 0.4));
        while (emitted < want) {
          emitted++;
          const T = rnd(0.3, 0.4);
          const a = aim.clone().add(new THREE.Vector3(rnd(-0.28, 0.28), 0, rnd(-0.28, 0.28)));
          a.y = this.surfaceY(a.x, a.z);
          const v = new THREE.Vector3((a.x - sp.x) / T, (a.y - sp.y) / T + 4.9 * T, (a.z - sp.z) / T);
          this.fx.drop(sp.clone().add(new THREE.Vector3(rnd(-0.025, 0.025), rnd(-0.01, 0.01), rnd(-0.025, 0.025))), v, rnd(0.006, 0.01), emitted % 3 === 0);
        }
        const end = this.fx.stream.end;
        if (end > FLY * 0.9) {
          splashT -= dt;
          if (splashT <= 0) {
            splashT = 0.06;
            this.fx.splash(aim, 1.1);
            if (!this.isTilled(tx, tz)) this.fx.wetSpot(aim, 0.45, 3);
          }
        }
      },
      onDone: () => this.fx.stream.stop(),
    });
  }

  // ─────────────────────────────── charge (hold the use button with an upgraded hoe / can)

  private armCharge(tool: FarmTool): void {
    if (this.tiers[tool] <= 0 || !this.game.input.held('use')) return;
    if (this.game.services.energy?.exhausted()) return;
    this.chargeTool = tool;
    this.chargeLevel = 0;
    this.chargeHold = 0;
  }

  private chargeTiles(level: number): [number, number][] {
    const t = this.game.player.facingTile();
    const { dx, dz } = this.dirVec();
    const out: [number, number][] = [];
    if (level >= 3) {
      for (let d = 0; d < 3; d++) for (let s = -1; s <= 1; s++) out.push([t.x + dx * d - dz * s, t.z + dz * d + dx * s]);
    } else {
      const n = level === 2 ? 5 : level === 1 ? 3 : 1;
      for (let d = 0; d < n; d++) out.push([t.x + dx * d, t.z + dz * d]);
    }
    return out;
  }

  private updateCharge(dt: number): void {
    const tool = this.chargeTool;
    const acts = this.actions;
    if (!tool || !acts) return;
    const held = this.game.input.held('use');
    this.chargeHold += dt;
    if (!acts.isCharging) {
      if (!held) {
        this.chargeTool = null;
        return;
      }
      if (this.chargeHold > 0.34) {
        acts.side = this.cameraSide();
        acts.charge();
        acts.hold(this.tool(tool));
      }
      return;
    }
    const tier = this.tiers[tool];
    const lv = Math.min(tier, 1 + Math.floor(acts.chargeTime / 0.45));
    if (lv !== this.chargeLevel) {
      this.chargeLevel = lv;
      this.game.events.emit('tool:charge', { tool, level: lv });
      this.shake(0.06 + lv * 0.03);
      const tip = acts.toolPoint(new THREE.Vector3(0, 0.7, 0));
      for (let i = 0; i < 10 + lv * 4; i++) this.fx.sparkle(tip, new THREE.Vector3(rnd(-1, 1), rnd(-0.2, 1.2), rnd(-1, 1)), lv === 3 ? 0xffe27a : lv === 2 ? 0xe8f4ff : 0xffb870, 0.14, 0.5);
    }
    if (fxRng.next() < dt * 20) {
      const tip = acts.toolPoint(new THREE.Vector3(0, 0.7, 0));
      this.fx.sparkle(tip, new THREE.Vector3(rnd(-0.3, 0.3), rnd(0.2, 0.6), rnd(-0.3, 0.3)), 0xfff0c0, 0.08, 0.4);
    }
    if (!held) {
      this.chargeTool = null;
      this.releaseCharge(tool, this.chargeLevel);
    }
  }

  private releaseCharge(tool: FarmTool, level: number): void {
    if (!this.canWork(tool, true)) {
      this.actions?.cancel();
      return;
    }
    this.lastTool = { id: tool, t: 2.5 };
    const tiles = this.chargeTiles(level);
    const [fx0, fz0] = tiles[0]!;
    if (tool === 'wateringCan') {
      this.actions?.cancel();
      this.pour(fx0, fz0, tiles, level);
      return;
    }
    const tilled: [number, number][] = [];
    for (const [tx, tz] of tiles) {
      if (this.till(tx, tz, false, false)) {
        tilled.push([tx, tz]);
        this.soil?.clear(tx, tz, true);
      }
    }
    this.spend(2 + level * 2);
    const { dx, dz } = this.dirVec();
    this.game.events.emit('tool:swing', { tool, tier: this.tiers[tool], charge: level });
    const doImpact = (): void => {
      // The struck block heaves tile by tile (rippling away from the farmer): fresh soil rises out
      // of the turf, already-tilled beds are punched down and spring back.
      const fresh = new Set(tilled.map(([a, b]) => key(a, b)));
      const hit = tiles.filter(([tx, tz]) => fresh.has(key(tx, tz)) || this.isTilled(tx, tz));
      hit.forEach(([tx, tz], i) => {
        this.later(i * 0.03, () => {
          if (fresh.has(key(tx, tz))) this.refreshSoil(tx, tz, true);
          else this.soil?.heave(tx, tz, 0, 0.7);
          this.fx.hoeImpact(this.center(tx, tz, 0.05), dx, dz, SOIL_COLOR, 0.55);
        });
      });
      // A dust wall rolls out from the rim of exactly the struck tiles + cracked ground under each.
      this.fx.dustWall(hit.map(([tx, tz]) => this.center(tx, tz, 0.02)), dx, dz);
      this.shake(0.3 + level * 0.1);
      this.game.events.emit('tool:impact', { tool, x: fx0, z: fz0, hit: tilled.length ? 'soil' : 'none', strength: 1 + level * 0.5 });
    };
    if (!this.actions || !this.near(fx0, fz0)) return doImpact();
    const gold = [0xffc890, 0xfff2d8, 0xffe27a][Math.min(2, level - 1)] ?? 0xfff6e0;
    this.actTile = { x: fx0, z: fz0 };
    this.actions.side = this.cameraSide();
    this.actions.start('slam', {
      tool: this.tool(tool),
      onImpact: () => {
        doImpact();
        this.hitStop = 0.1;
        this.cursorHold = 0.5;
      },
      onUpdate: this.withTrail('slam', tool, undefined, gold, 1.25),
    });
  }

  // ─────────────────────────────── interact (by hand)

  private interact(x: number, z: number): void {
    const t = this.tiles.get(key(x, z));
    const c = t?.crop;
    if (!c || c.dead || c.stage < RIPE_STAGE) return;
    if (this.actions && this.near(x, z) && !this.actions.active) {
      this.harvest(x, z, 'pull', IMPACT.pull);
      this.startAction('pull', null, x, z, () => {
        this.game.events.emit('tool:impact', { tool: 'hand', x, z, hit: 'crop', strength: 1 });
      });
    } else this.harvest(x, z, 'pull');
  }

  // ═════════════════════════════════════════════ days & seasons

  private newDay(): void {
    const g = this.grid();
    if (!g) return;
    const cal = this.game.calendar;
    const raining = cal.weather === 'rain' || cal.weather === 'storm';
    for (const t of this.tiles.values()) {
      const c = t.crop;
      if (!c || c.dead) continue;
      if (g.hasFlag(t.x, t.z, TileFlag.Watered) || (raining && !this.isGreenhouse(t.x, t.z))) {
        c.days++;
        this.refreshCrop(t);
      } else if (c.stage < RIPE_STAGE) c.missed++;
    }
    this.checkGiants(0.22);
    for (const t of this.tiles.values()) {
      if (g.hasFlag(t.x, t.z, TileFlag.Watered)) {
        g.setFlag(t.x, t.z, TileFlag.Watered, false);
        this.paint(t.x, t.z);
        this.soil?.setWet(t.x, t.z, false);
      }
    }
    for (const t of [...this.tiles.values()]) {
      const glass = this.isGreenhouse(t.x, t.z);
      if (raining && !glass) {
        if (this.isTilled(t.x, t.z)) this.water(t.x, t.z);
      }
      if (t.sprinkler && (glass || (!raining && cal.season !== 'winter'))) {
        for (const [dx, dz] of sprinklerOffsets(t.sprinkler.id)) this.water(t.x + dx, t.z + dz);
      }
    }
    if (!raining && cal.season !== 'winter') this.sendCrows();
    if (cal.season !== 'winter') this.regrowWeeds();
    this.commit();
  }

  growAll(days: number, needWater: boolean): void {
    const g = this.grid();
    for (const t of this.tiles.values()) {
      if (!t.crop || t.crop.dead) continue;
      if (needWater && g && !g.hasFlag(t.x, t.z, TileFlag.Watered)) continue;
      const before = t.crop.stage;
      t.crop.days += days;
      this.refreshCrop(t, 'grow');
      void before;
    }
  }

  private onSeason(season: Season): void {
    if (this.showcase) {
      this.plantGarden(season, true);
      this.onDemo(this.showcase, [this.showcase]);
      return;
    }
    this.witherOutOfSeason(season);
  }

  /** Crops that can't grow in `season` wither (giant crops too — they collapse into husks). */
  private witherOutOfSeason(season: Season): void {
    // Giant crops rot where they sit: the block falls back to nine withered husks.
    for (const gi of [...this.giants.values()]) {
      if (this.inSeason(gi.id, gi.x0 + 1, gi.z0 + 1, season)) continue;
      this.crops?.remove(gi.handle);
      this.giants.delete(key(gi.x0, gi.z0));
      for (let dz = 0; dz < 3; dz++) {
        for (let dx = 0; dx < 3; dx++) {
          this.grid()?.setObject(gi.x0 + dx, gi.z0 + dz, null);
          this.plant(gi.id, gi.x0 + dx, gi.z0 + dz, daysToRipe(CROPS[gi.id]), (gi.x0 + dx) * 31 + (gi.z0 + dz) * 7);
        }
      }
    }
    for (const t of this.tiles.values()) {
      const c = t.crop;
      if (c && !c.dead && !this.inSeason(c.id, t.x, t.z, season)) {
        c.dead = true;
        this.refreshCrop(t);
        this.game.events.emit('crop:withered', { cropId: c.id, x: t.x, z: t.z });
      }
    }
  }

  private dry(x: number, z: number): void {
    const g = this.grid();
    if (!g) return;
    g.setFlag(x, z, TileFlag.Watered, false);
    this.paint(x, z);
    this.refreshSoil(x, z);
  }

  /** Fuse 3×3 blocks of ripe giant-capable crops (chance per block). */
  private checkGiants(chance: number, force = false): void {
    for (const t of this.tiles.values()) {
      const c = t.crop;
      if (!c || c.dead || c.stage < RIPE_STAGE || !CROPS[c.id].giant) continue;
      const block: FarmTile[] = [];
      for (let dz = 0; dz < 3; dz++) {
        for (let dx = 0; dx < 3; dx++) {
          const n = this.tiles.get(key(t.x + dx, t.z + dz));
          if (n?.crop && !n.crop.dead && n.crop.id === c.id && n.crop.stage >= RIPE_STAGE) block.push(n);
        }
      }
      if (block.length === 9 && (force || this.rng.next() < chance)) this.makeGiant(c.id, t.x, t.z);
    }
  }

  private makeGiant(id: CropId, x0: number, z0: number): void {
    const g = this.grid();
    if (!g || !this.crops) return;
    for (let dz = 0; dz < 3; dz++) {
      for (let dx = 0; dx < 3; dx++) {
        const t = this.tiles.get(key(x0 + dx, z0 + dz));
        if (t?.crop) this.removeCrop(t);
      }
    }
    const handle = this.crops.addGiant(id as GiantKind, x0 + 1.5, this.cropY(x0 + 1, z0 + 1), z0 + 1.5, (x0 * 31 + z0 * 17) >>> 0);
    const giant: Giant = { id, x0, z0, handle, hp: 3, wobble: 0 };
    this.giants.set(key(x0, z0), giant);
    for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) g.setObject(x0 + dx, z0 + dz, { kind: 'giantCrop', id, solid: true });
    this.game.events.emit('crop:giant', { cropId: id, x: x0 + 1, z: z0 + 1 });
  }

  private breakGiant(gi: Giant): void {
    const g = this.grid();
    const def = CROPS[gi.id];
    this.giants.delete(key(gi.x0, gi.z0));
    this.animate(gi.handle, 'harvest', true);
    for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) g?.setObject(gi.x0 + dx, gi.z0 + dz, null);
    const qty = 15 + this.rng.int(0, 6);
    this.game.events.emit('item:give', { itemId: def.produce, qty });
    this.game.events.emit('crop:harvested', { cropId: gi.id, x: gi.x0 + 1, z: gi.z0 + 1, qty, quality: 0 });
    const c = new THREE.Vector3(gi.x0 + 1.5, this.tileY(gi.x0 + 1, gi.z0 + 1) + 0.5, gi.z0 + 1.5);
    this.fx.harvestGlint(c, def.color, 2);
    this.fx.leafBurst(c, def.leaf, 24, 3);
    this.fx.chips(c, def.color, 24);
    const geo = produceGeometry(gi.id);
    const pl = this.game.player;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.fx.pop(geo, c.clone().add(new THREE.Vector3(Math.cos(a) * 0.6, 0.2, Math.sin(a) * 0.6)), {
        to: () => pl.position.clone().add(new THREE.Vector3(Math.cos(a) * 0.3, 1.4 + i * 0.03, 0.2)),
        flight: 0.45 + i * 0.05,
        hold: 0.05,
        scale: 1.4,
        onDone: i === 0 ? (pos) => this.collect(def.produce, qty, 0, pos) : undefined,
      });
    }
  }

  /** Crows raid fields without scarecrow cover (1 attempt per 16 crops). */
  private sendCrows(force = 0): void {
    const g = this.grid();
    if (!g) return;
    const scarecrows: { x: number; z: number }[] = [];
    for (const [i, o] of g.objects) {
      if (o.id === 'scarecrow' || o.kind === 'scarecrow') scarecrows.push({ x: i % g.width, z: Math.floor(i / g.width) });
    }
    const guarded = (t: FarmTile, r: number): boolean => scarecrows.some((s) => Math.hypot(s.x - t.x, s.z - t.z) <= r);
    const live = [...this.tiles.values()].filter((t) => t.crop && !t.crop.dead && t.crop.stage >= 1 && !this.isGreenhouse(t.x, t.z));
    let exposed = live.filter((t) => !guarded(t, SCARECROW_RADIUS));
    // Staged raids (force) still keep a respectful distance from the scarecrow itself.
    if (force > 0 && !exposed.length) exposed = live.filter((t) => !guarded(t, 3.5));
    const all = [...this.tiles.values()].filter((t) => t.crop && !t.crop.dead).length;
    const attempts = force || Math.floor(all / 16);
    let n = 0;
    for (let i = 0; i < attempts && exposed.length; i++) {
      if (!force && this.rng.next() > 0.35) continue;
      const t = exposed.splice(this.rng.int(0, exposed.length - 1), 1)[0]!;
      const c = t.crop!;
      const eat = (): void => {
        if (t.crop !== c) return;
        const p = this.center(t.x, t.z, 0.25);
        this.fx.leafBurst(p, CROPS[c.id].leaf, 14, 1.8);
        // A puff of black feathers from the scuffle.
        for (let k = 0; k < 7; k++) this.fx.leaf(p.clone().setY(p.y + 0.35), new THREE.Vector3(rnd(-0.8, 0.8), rnd(0.6, 1.5), rnd(-0.8, 0.8)), 0x1e2028, rnd(0.05, 0.075));
        // What's left is a chewed stub (dead: scythe it for fiber).
        c.dead = true;
        c.eaten = true;
        this.refreshCrop(t);
        if (c.handle) this.animate(c.handle, 'rustle');
        this.game.events.emit('crow:eat', { cropId: c.id, x: t.x, z: t.z });
      };
      if (this.map && this.game.world.current === this.map) {
        this.crows.spawn(t.x + 0.5, t.z + 0.5, eat, 1 + n * 0.9);
        this.later(1 + n * 0.9 + 2.4, () => this.game.events.emit('crow:arrive', { x: t.x, z: t.z }));
      } else eat();
      n++;
    }
  }

  private regrowWeeds(): void {
    const g = this.grid();
    const nature = (this.map as unknown as { nature?: Nature } | null)?.nature;
    if (!g || !nature || !this.map) return;
    const weeds: number[] = [];
    for (const [i, o] of g.objects) if (o.kind === 'weed') weeds.push(i);
    if (!weeds.length) return;
    const tries = 3 + this.rng.int(0, 3);
    for (let k = 0; k < tries; k++) {
      const i = weeds[this.rng.int(0, weeds.length - 1)]!;
      const x = (i % g.width) + this.rng.int(-2, 2);
      const z = Math.floor(i / g.width) + this.rng.int(-2, 2);
      if (!g.inBounds(x, z) || !g.hasFlag(x, z, TileFlag.Tillable) || g.hasFlag(x, z, TileFlag.Tilled) || g.getObject(x, z) || g.getType(x, z) !== TileType.Grass) continue;
      const wx = x + 0.5 + this.rng.range(-0.15, 0.15);
      const wz = z + 0.5 + this.rng.range(-0.15, 0.15);
      const h: NatureHandle = nature.place('weed', wx, this.map.heightAt(wx, wz), wz, { scale: this.rng.range(0.85, 1.15), sink: 0.02 });
      g.setObject(x, z, { kind: 'weed', id: 'weedA', solid: false, hp: 1, onRemove: () => nature.remove(h) });
    }
  }

  // ═════════════════════════════════════════════ staging

  private rect(name: string): { x0: number; z0: number; x1: number; z1: number } | null {
    return this.map?.plots?.[name] ?? null;
  }

  private clearRect(x0: number, z0: number, x1: number, z1: number): void {
    const g = this.grid();
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const t = this.tiles.get(key(x, z));
        if (t?.crop) this.removeCrop(t);
        if (t?.sprinkler) {
          g?.removeObject(x, z);
          t.sprinkler = null;
        }
        const gi = this.giantAt(x, z);
        if (gi) {
          this.crops?.remove(gi.handle);
          this.giants.delete(key(gi.x0, gi.z0));
          for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) g?.setObject(gi.x0 + dx, gi.z0 + dz, null);
        }
        if (g?.hasFlag(x, z, TileFlag.Watered)) {
          g.setFlag(x, z, TileFlag.Watered, false);
          this.paint(x, z);
          this.refreshSoil(x, z);
        }
      }
    }
  }

  /** Grandmother's kitchen garden: a few rows already coming up on day one. */
  private plantGarden(season: Season, replace = false): void {
    const r = this.rect('garden');
    if (!r) return;
    if (replace) this.clearRect(r.x0, r.z0, r.x1, r.z1);
    const crops: CropId[] = season === 'spring' ? ['parsnip', 'kale', 'strawberry', 'potato'] : season === 'summer' ? ['tomato', 'hotPepper', 'blueberry', 'corn'] : season === 'fall' ? ['beet', 'eggplant', 'pumpkin', 'yam'] : [];
    for (let z = r.z0; z <= r.z1; z++) {
      for (let x = r.x0; x <= r.x1; x++) {
        this.till(x, z, true);
        const id = crops[(z - r.z0) % Math.max(1, crops.length)];
        if (id) {
          const h = (x * 928371 + z * 1231) >>> 0;
          this.plant(id, x, z, Math.min(daysToRipe(CROPS[id]), 1 + (h % 4) + (x - r.x0)), h);
        }
        if (z - r.z0 < 2 && season !== 'winter') this.water(x, z);
      }
    }
    this.commit();
  }

  /** Days of growth that land a crop on `stage`. */
  private daysAt(id: CropId, stage: number): number {
    return daysForStage(CROPS[id], stage);
  }

  /** Demo showcase: the tended field with mixed crops at stages 2-5, a watered patch and a sprinkler. */
  stageShowcase(season: Season): void {
    const r = this.rect('field');
    if (!r) return;
    this.clearRect(r.x0, r.z0, r.x1, r.z1);
    const ids = SHOWCASE[season];
    const sx = Math.floor((r.x0 + r.x1) / 2);
    const sz = Math.floor((r.z0 + r.z1) / 2);
    for (let z = r.z0; z <= r.z1; z++) {
      for (let x = r.x0; x <= r.x1; x++) {
        this.till(x, z, true);
        if (x === sx && z === sz && season !== 'winter') {
          this.placeSprinkler(x, z, 'brassSprinkler', false);
          continue;
        }
        const id = ids[(z - r.z0) % Math.max(1, ids.length)];
        if (id) {
          const h = (x * 73856093 ^ z * 19349663) >>> 0;
          // Ripeness ramps across the row (older plantings to the west) with some jitter.
          const f = 1 - (x - r.x0) / Math.max(1, r.x1 - r.x0);
          const stage = Math.max(2, Math.min(RIPE_STAGE, 2 + Math.round(f * 3.2 + ((h % 5) - 2) * 0.3)));
          this.plant(id, x, z, this.daysAt(id, stage), h);
        }
        const nearSprinkler = Math.abs(x - sx) <= 1 && Math.abs(z - sz) <= 1;
        if (season !== 'winter' && (nearSprinkler || x - r.x0 < 3)) this.water(x, z);
      }
    }
    this.commit();
  }

  /**
   * Hero harvest field: a big, lush mid-season field — rows of every crop of the season at
   * mature / ripe stages, a trellis row, a giant crop, gold sprinklers spraying, soil mostly wet.
   */
  private stageHarvest(season: Season): void {
    const g = this.grid();
    if (!g) return;
    const plan = HARVEST_ROWS[season];
    const X0 = 16;
    const X1 = 29;
    const Z0 = 20;
    const Z1 = 28;
    this.clearRect(X0, Z0, X1, Z1);
    if (!plan.rows.length) return this.stageShowcase(season);
    const walk = 23; // packed-dirt walkway column
    const pathRows = plan.rows.map((id, i) => (id ? -1 : Z0 + i)).filter((z) => z >= 0);
    const giantAt = { x: X0 + 1, z: Z1 - 2 };
    const sprinklers: [number, number][] = [[26, 22], [20, 22]];
    for (let z = Z0; z <= Z1; z++) {
      for (let x = X0; x <= X1; x++) {
        if (x === walk || pathRows.includes(z)) continue;
        const o = g.getObject(x, z);
        if (o && (o.kind === 'prop' || o.kind === 'building' || o.kind === 'fence' || o.kind === 'tree')) continue;
        if (!g.hasFlag(x, z, TileFlag.Tillable) || g.hasFlag(x, z, TileFlag.Blocked) || g.getType(x, z) === TileType.Path) continue;
        this.till(x, z, true);
      }
    }
    for (const [x, z] of sprinklers) if (this.isTilled(x, z)) this.placeSprinkler(x, z, 'goldSprinkler', false);
    for (let z = Z0; z <= Z1; z++) {
      const id = plan.rows[z - Z0];
      for (let x = X0; x <= X1; x++) {
        if (!this.isTilled(x, z) || this.tile(x, z).sprinkler) continue;
        if (plan.giant && x >= giantAt.x && x < giantAt.x + 3 && z >= giantAt.z && z < giantAt.z + 3) {
          this.plant(plan.giant, x, z, daysToRipe(CROPS[plan.giant]), (x * 7 + z * 13) >>> 0);
          continue;
        }
        if (!id) continue;
        const h = (x * 73856093 ^ z * 19349663) >>> 0;
        const roll = (h >>> 3) % 100;
        const stage = roll < 62 ? RIPE_STAGE : roll < 90 ? 4 : 3;
        this.plant(id, x, z, this.daysAt(id, stage), h);
      }
    }
    if (plan.giant) this.checkGiants(1, true);
    for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++) if (this.isTilled(x, z) && ((x * 13 + z * 7) % 11 !== 0 || z > Z0 + 3)) this.water(x, z);
    // Packed-dirt paths through and around the beds, so the crops read against bare earth rather
    // than green lawn; a couple of produce crates and a basket at the path ends.
    for (let z = Z0 - 1; z <= Z1 + 1; z++) {
      for (let x = X0 - 1; x <= X1 + 1; x++) {
        if (this.isTilled(x, z) || !g.inBounds(x, z) || g.getType(x, z) === TileType.Water) continue;
        const inner = x === walk || pathRows.includes(z);
        const edge = x === X0 - 1 || x === X1 + 1 || z === Z0 - 1 || z === Z1 + 1;
        if (inner && z >= Z0 && z <= Z1) this.stagePath(x, z, 0.9);
        else if (edge || inner) this.stagePath(x, z, 0.5);
      }
    }
    if (plan.crate.length) {
      this.stageProp(buildProduceCrate(plan.crate, 11, 'crate'), walk + 0.5, Z1 + 1.35, 0.25);
      this.stageProp(buildProduceCrate([...plan.crate].reverse(), 23, 'basket'), walk + 0.62, pathRows[0] !== undefined ? pathRows[0] + 0.5 : Z1 + 1.4, -0.4);
      this.stageProp(buildProduceCrate(plan.crate.slice(1), 37, 'crate'), X1 + 1.45, Z1 - 0.4, 1.3);
    }
    this.sprayAlways = true;
    this.commit();
  }

  /** Staged dirt path splat (restored by resetBigStage). */
  private stagePath(x: number, z: number, v: number): void {
    const t = this.map?.terrain;
    const g = this.grid();
    if (!t || !g) return;
    const idx = z * g.width + x;
    if (!this.pathOrig.has(idx)) this.pathOrig.set(idx, t.splatAt(x + 0.5, z + 0.5, 'path'));
    t.setTileSplat(x, z, { path: Math.max(v, this.pathOrig.get(idx)!) });
    this.splatDirty = true;
  }

  private stageProp(o: THREE.Object3D, x: number, z: number, rot: number): void {
    if (!this.map) return;
    o.position.set(x, this.map.heightAt(x, z), z);
    o.rotation.y = rot;
    this.map.root.add(o);
    this.stageProps.push(o);
  }

  /** Tool showcase: a half-hoed bed — fresh furrows, a watered strip, a seeded row. */
  private stageTools(): void {
    const X0 = 22;
    const X1 = 29;
    const Z0 = 20;
    const Z1 = 23;
    this.clearRect(X0, Z0, X1, Z1);
    const g = this.grid();
    if (!g) return;
    // The farmer stands on the north edge facing the camera; the top row is half-hoed toward him,
    // with a watered strip, seedlings and freshly sown furrows behind.
    for (let z = Z0; z <= Z1; z++) {
      for (let x = X0; x <= X1; x++) {
        if (z === Z0 && x >= 26) {
          this.untill(x, z);
          continue;
        }
        this.till(x, z, true);
        const h = (x * 97 + z * 31) >>> 0;
        if (z <= Z0 + 1) this.water(x, z);
        if (z === Z0) this.plant(x % 2 ? 'parsnip' : 'potato', x, z, this.daysAt(x % 2 ? 'parsnip' : 'potato', 2 + (x % 2)), h);
        if (z === Z0 + 1 && x <= 27) this.plant(x % 3 ? 'cauliflower' : 'kale', x, z, this.daysAt(x % 3 ? 'cauliflower' : 'kale', 1 + (x % 3)), h);
        if (z === Z0 + 2 && x <= 26) this.plant('parsnip', x, z, 0, h);
      }
    }
    this.commit();
  }

  private onDemo(name: string, showcase: string[]): void {
    this.sprayAlways = false;
    const slowP = Number(new URLSearchParams(location.search).get('slow'));
    this.slow = slowP > 0 && slowP <= 1 ? slowP : 1;
    this.fxScale = this.slow;
    if (this.actions) this.actions.timeScale = this.slow;
    this.actions?.cancel();
    this.crows.clear();
    this.fx.clear();
    this.timers.length = 0;
    this.autoLoop = null;
    const season = this.game.calendar.season;
    const params = new URLSearchParams(location.search);
    // A previous big staging (hero field / gallery / wither) must not leak into the next demo
    // (the smoke test cycles every demo; leftover fields blew the render budget).
    if (this.bigStaged && this.map) {
      this.resetBigStage();
      this.bigStaged = false;
    }
    if (showcase.some((s) => s === 'harvest' || s === 'giant' || s === 'wither' || s === 'gallery')) this.bigStaged = true;
    const tier = params.get('tier');
    if (tier) for (const t of TOOLS) this.setToolTier(t, Math.max(0, Math.min(3, Number(tier))) as ToolTier);
    const q = params.get('quality');
    this.forceQuality = q !== null ? (Math.max(0, Math.min(3, Number(q))) as CropQuality) : null;
    if (showcase.includes('harvest')) {
      this.showcase = 'harvest';
      this.plantGarden(season, true);
      this.stageHarvest(season);
      const act = params.get('act');
      if (act) this.later(0.3, () => this.demoAct(act, params));
    } else if (showcase.includes('tools')) {
      this.showcase = 'tools';
      this.stageTools();
      const tool = params.get('tool') ?? showcase.find((t) => t.startsWith('tool:'))?.slice(5) ?? 'hoe';
      const pose = params.get('pose');
      if (tool === 'harvest' && this.forceQuality === null) this.forceQuality = 2;
      // The toolbar shows the tool being staged.
      const inv = this.game.services.inventory;
      const slotId = tool === 'charge' ? 'hoe' : tool === 'sow' ? `${cropsFor(season)[0] ?? 'parsnip'}Seeds` : tool;
      const slot = inv ? inv.slots.findIndex((st) => st?.id === slotId) : -1;
      if (slot >= 0) this.game.events.emit('toolbar:select', { slot });
      const loop = params.get('loop');
      if (loop) this.autoLoop = { tool: loop, t: 0.2 };
      else this.later(0.25, () => this.demoAct(tool, params, pose === null ? undefined : Number(pose)));
    } else if (showcase.includes('gallery')) {
      // Every crop of the season (rows) × every growth stage (columns), for art review.
      this.showcase = 'gallery';
      const ids = params.get('crops')?.split(',').filter((c) => c in CROPS) as CropId[] | undefined;
      const list = ids?.length ? ids : cropsFor(season === 'winter' ? 'spring' : season);
      // Rows start inside the starter field's rect (row 0 used to sit on the lawn above it).
      const gz = (this.rect('field')?.z0 ?? 20);
      this.clearRect(20, gz, 29, gz + list.length);
      list.forEach((id, row) => {
        for (let st = 0; st <= RIPE_STAGE; st++) {
          const x = 21 + st;
          const z = gz + row;
          this.till(x, z, true);
          this.water(x, z);
          this.plant(id, x, z, this.daysAt(id, st), 11 + row * 7 + st);
        }
      });
      this.commit();
    } else if (showcase.includes('wither')) {
      // The morning after the season turned: last season's field withered where it stood.
      this.showcase = null;
      const prev: Season = season === 'summer' ? 'spring' : season === 'fall' ? 'summer' : season === 'winter' ? 'fall' : 'fall';
      this.stageHarvest(prev);
      this.sprayAlways = false;
      this.witherOutOfSeason(season);
      for (const t of this.tiles.values()) if (this.grid()?.hasFlag(t.x, t.z, TileFlag.Watered)) this.dry(t.x, t.z);
      this.commit();
    } else if (showcase.includes('giant')) {
      this.showcase = 'giant';
      this.stageHarvest(season);
    } else if (showcase.includes('crows')) {
      // A patch just outside the scarecrow's reach (its radius ring shows) gets raided at mid-morning.
      this.showcase = 'crows';
      this.bigStaged = true;
      this.stageShowcase(season);
      this.stageCrowPatch(season);
      this.later(0.2, () => this.sendCrows(3));
    } else if (showcase.includes('field')) {
      this.showcase = 'field';
      this.stageShowcase(season);
    }
    void name;
  }

  /** Crow bait: a patch south of the showcase field, outside the scarecrow radius. */
  private stageCrowPatch(season: Season): void {
    const g = this.grid();
    if (!g) return;
    const ids = SHOWCASE[season].length ? SHOWCASE[season] : SHOWCASE.summer;
    for (let z = CROW_PATCH.z0; z <= CROW_PATCH.z1; z++) {
      for (let x = CROW_PATCH.x0; x <= CROW_PATCH.x1; x++) {
        if (!g.hasFlag(x, z, TileFlag.Tillable) || g.hasFlag(x, z, TileFlag.Blocked) || g.getType(x, z) === TileType.Path) continue;
        const o = g.getObject(x, z);
        if (o && o.kind !== 'weed' && o.kind !== 'twig' && o.kind !== 'stone') continue;
        if (!this.till(x, z, true)) continue;
        const id = ids[(z - CROW_PATCH.z0 + 2) % ids.length]!;
        const h = (x * 73856093 ^ z * 19349663) >>> 0;
        this.plant(id, x, z, this.daysAt(id, 3 + (h % 3)), h);
        this.water(x, z);
      }
    }
    this.commit();
  }

  /** Undo a hero-field staging: clear crops / sprinklers / giants, untill outside the starter field. */
  private resetBigStage(): void {
    const f = this.rect('field');
    const X0 = 16, X1 = 29, Z0 = 19, Z1 = 28;
    const t = this.map?.terrain;
    const g = this.grid();
    if (t && g) for (const [idx, v] of this.pathOrig) t.setTileSplat(idx % g.width, Math.floor(idx / g.width), { path: v });
    this.pathOrig.clear();
    this.splatDirty = true;
    for (const o of this.stageProps) o.removeFromParent();
    this.stageProps.length = 0;
    this.clearRect(X0, Z0, X1, Z1);
    for (let z = Z0; z <= Z1; z++) {
      for (let x = X0; x <= X1; x++) {
        if (f && x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1) continue;
        this.untill(x, z);
      }
    }
    // The crow patch south of the field.
    this.clearRect(CROW_PATCH.x0, CROW_PATCH.z0, CROW_PATCH.x1, CROW_PATCH.z1);
    for (let z = CROW_PATCH.z0; z <= CROW_PATCH.z1; z++) for (let x = CROW_PATCH.x0; x <= CROW_PATCH.x1; x++) this.untill(x, z);
    this.commit();
  }

  /** Demo: perform an action on the faced tile, optionally freezing it at `pose` seconds. */
  private demoAct(what: string, params: URLSearchParams, pose?: number): void {
    const t = this.game.player.facingTile();
    const g = this.grid();
    if (!g) return;
    const freeze = pose ?? (what === 'wateringCan' ? 0.55 : what === 'harvest' ? 0.62 : what === 'scythe' ? 0.26 : IMPACT.chop + 0.07);
    if (what === 'hoe' || what === 'charge') {
      if (this.isTilled(t.x, t.z)) this.untill(t.x, t.z);
      g.removeObject(t.x, t.z);
    }
    if (what === 'wateringCan' && !g.hasFlag(t.x, t.z, TileFlag.WaterSource)) {
      // Pour onto a fresh, dry furrow so the darkening reads.
      if (!this.isTilled(t.x, t.z)) this.till(t.x, t.z, true);
      if (g.hasFlag(t.x, t.z, TileFlag.Watered)) {
        g.setFlag(t.x, t.z, TileFlag.Watered, false);
        this.paint(t.x, t.z);
        this.refreshSoil(t.x, t.z);
      }
    }
    if (what === 'harvest') {
      const tt = this.tiles.get(key(t.x, t.z));
      const id = cropsFor(this.game.calendar.season)[0] ?? 'parsnip';
      if (!tt?.crop || tt.crop.stage < RIPE_STAGE) {
        if (!this.isTilled(t.x, t.z)) this.till(t.x, t.z, true);
        if (tt?.crop) this.removeCrop(tt);
        const want = (params.get('crop') as CropId | null) ?? id;
        this.plant(CROPS[want] ? want : id, t.x, t.z, daysToRipe(CROPS[CROPS[want] ? want : id]), 7);
      }
    }
    if (what === 'charge') {
      if (!params.get('tier')) this.setToolTier('hoe', 3);
      this.releaseCharge('hoe', Math.max(1, this.tiers.hoe || 3));
    } else if (what === 'harvest') this.interact(t.x, t.z);
    else if (what === 'sow') this.useItem(`${cropsFor(this.game.calendar.season)[0] ?? 'parsnip'}Seeds`, t.x, t.z, -1);
    else this.useItem(what, t.x, t.z, -1);
    if (pose !== undefined && pose < 0) return;
    // Freeze the pose (and the FX) for a still.
    const acts = this.actions;
    if (!acts) return;
    acts.setFreeze(freeze);
  }

  private commit(): void {
    if (this.splatDirty) this.map?.terrain?.commitSplat();
    this.splatDirty = false;
  }

  // ═════════════════════════════════════════════ per frame

  update(dt: number, game: Game): void {
    // Hit-stop: a few frames of frozen pose on hard impacts.
    if (this.actions) {
      if (this.hitStop > 0) {
        this.hitStop -= dt;
        this.actions.timeScale = this.actions.timeScale === 0 && this.fxScale === 0 ? 0 : 0.08;
        if (this.hitStop <= 0) this.actions.timeScale = this.slow;
      }
      // Demo freeze: when an action froze itself, freeze its particles too. A freeze past the end of
      // the action (scrubbing to the recovery) releases everything again.
      if (this.actions.timeScale === 0 && !this.actions.active) {
        this.actions.timeScale = this.slow;
        this.fxScale = this.slow;
      }
      if (this.actions.timeScale === 0 && this.hitStop <= 0) this.fxScale = 0;
    }
    const fdt = dt * this.fxScale;
    this.refuseT = Math.max(0, this.refuseT - dt);
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i]!;
      tm.t -= fdt;
      if (tm.t <= 0) {
        this.timers.splice(i, 1);
        tm.fn();
      }
    }
    this.updateCharge(dt);
    if (this.autoLoop) {
      this.autoLoop.t -= dt;
      if (this.autoLoop.t <= 0 && !this.actions?.active) {
        this.autoLoop.t = 0.7;
        this.demoAct(this.autoLoop.tool, new URLSearchParams(location.search), -1);
      }
    }
    this.updateAnims(fdt);
    this.updateSprinklers(fdt, game);
    this.updateCursor(dt);
    this.soil?.tick(fdt);
    game.rc.camera.getWorldDirection(this.fx.trail.view);
    this.fx.update(fdt, game.rc.renderer.domElement.height);
    this.crows.update(fdt, game.player.position);
    this.commit();
  }

  private updateAnims(dt: number): void {
    if (!this.crops) return;
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i]!;
      a.t += dt;
      const t = a.t;
      let done = false;
      let sxz = 1;
      let sy = 1;
      let lx = 0;
      switch (a.kind) {
        case 'grow': {
          // Pops up out of the soil with a springy overshoot.
          const k = Math.min(1, t / 0.55);
          const base = 1 - Math.pow(1 - Math.min(1, t / 0.18), 3);
          const osc = Math.sin(t * 16) * Math.exp(-t * 6);
          sy = Math.max(0.02, base * (1 + osc * 0.28));
          sxz = Math.max(0.02, base * (1 - osc * 0.14));
          done = k >= 1;
          break;
        }
        case 'water': {
          const osc = Math.sin(t * 22) * Math.exp(-t * 7);
          sy = 1 - osc * 0.1;
          sxz = 1 + osc * 0.05;
          lx = osc * 0.05 * a.dir;
          done = t > 0.6;
          break;
        }
        case 'rustle':
        case 'wobble': {
          const s = a.kind === 'wobble' ? 0.07 : 0.16;
          const osc = Math.sin(t * 20) * Math.exp(-t * 5);
          lx = osc * s * a.dir;
          sy = 1 - Math.abs(osc) * 0.05;
          sxz = 1 + Math.abs(osc) * 0.04;
          done = t > 0.7;
          break;
        }
        case 'harvest': {
          // Squash down (anticipation), then stretch up and vanish.
          if (t < 0.08) {
            const k = t / 0.08;
            sy = 1 - 0.3 * k;
            sxz = 1 + 0.2 * k;
          } else {
            const k = Math.min(1, (t - 0.08) / 0.16);
            sy = (0.7 + 0.7 * k) * (1 - k);
            sxz = (1.2 - 0.6 * k) * (1 - k * 0.8);
          }
          done = t > 0.24;
          break;
        }
      }
      if (done) {
        this.anims.splice(i, 1);
        if (a.kill) this.crops.remove(a.h);
        else this.crops.pose(a.h, 1, 1);
        continue;
      }
      this.crops.pose(a.h, Math.max(0.001, sxz), Math.max(0.001, sy), lx, 0);
    }
  }

  private updateSprinklers(dt: number, game: Game): void {
    const cal = game.calendar;
    const dry = cal.weather !== 'rain' && cal.weather !== 'storm' && cal.season !== 'winter';
    const morning = dry && cal.hour >= 6 && cal.hour < 8.5;
    const spraying = !!this.map && (morning || (this.sprayAlways && dry));
    this.sprayT += dt;
    const p = new THREE.Vector3();
    for (const t of this.tiles.values()) {
      const sp = t.sprinkler;
      if (!sp) continue;
      if (sp.test > 0) sp.test -= dt;
      const on = (spraying || sp.test > 0) && dry;
      if (!on) continue;
      const s = SPRINKLERS[sp.id] ?? SPRINKLERS.sprinkler!;
      sp.spin += dt * (s.tier >= 2 ? 2.6 : 3.4);
      sp.model.head.rotation.y = sp.spin;
      // 3–4 rotating jets throw ballistic streams of streaks out to the watered ring.
      const jets = Math.min(4, sp.model.jets) - (s.tier === 0 ? 1 : 0);
      const reach = s.reach + (s.cross ? 0.35 : 0.5);
      const base = sp.model.root.position;
      const rate = dt * (s.tier >= 2 ? 70 : 55);
      for (let j = 0; j < jets; j++) {
        const a = sp.spin + (j / jets) * Math.PI * 2;
        let acc = rate + fxRng.next();
        while (acc >= 1) {
          acc -= 1;
          // Most water rides the main arc; some falls short (a spray, not a laser).
          const f = fxRng.next();
          const d = (f < 0.7 ? rnd(0.82, 1.0) : rnd(0.3, 0.8)) * reach;
          const T = 0.42 + d * 0.09;
          const aa = a + rnd(-0.06, 0.06);
          p.set(base.x + Math.cos(aa) * 0.13, base.y + sp.model.nozzle, base.z + Math.sin(aa) * 0.13);
          const gy = this.surfaceY(base.x + Math.cos(aa) * d, base.z + Math.sin(aa) * d);
          const vy = (gy - p.y) / T + 4.9 * T;
          this.fx.drop(p, new THREE.Vector3((Math.cos(aa) * d) / T, vy, (Math.sin(aa) * d) / T), rnd(0.008, 0.013), f < 0.12);
        }
      }
    }
    if (spraying !== this.wasSpraying) {
      this.wasSpraying = spraying;
      for (const t of this.tiles.values()) if (t.sprinkler) this.game.events.emit('sprinkler:spray', { x: t.x, z: t.z, on: spraying });
    }
  }

  /** What would the selected item do on (x, z)? */
  private targetState(itemId: string | null, x: number, z: number): CursorState | null {
    const g = this.grid();
    if (!g || !g.inBounds(x, z)) return null;
    const t = this.tiles.get(key(x, z));
    const c = t?.crop;
    if (c && !c.dead && c.stage >= RIPE_STAGE && itemId !== 'hoe' && itemId !== 'pickaxe' && itemId !== 'axe') return 'valid';
    if (!itemId) return null;
    const o = g.getObject(x, z);
    const tilled = g.hasFlag(x, z, TileFlag.Tilled);
    switch (itemId) {
      case 'hoe':
        return !tilled && g.hasFlag(x, z, TileFlag.Tillable) && !g.hasFlag(x, z, TileFlag.Blocked) && (!o || o.kind === 'weed') ? 'valid' : 'blocked';
      case 'wateringCan':
        if (g.hasFlag(x, z, TileFlag.WaterSource) || g.getType(x, z) === TileType.Water) return 'valid';
        return tilled && this.canLevel > 0 ? (g.hasFlag(x, z, TileFlag.Watered) ? 'neutral' : 'valid') : 'blocked';
      case 'scythe':
        return o?.kind === 'weed' || c?.dead || (c && c.stage >= RIPE_STAGE) ? 'valid' : 'neutral';
      case 'pickaxe':
        return o?.kind === 'stone' || o?.kind === 'boulder' || o?.kind === 'sprinkler' || (tilled && !c) ? 'valid' : 'blocked';
      case 'axe':
        return o?.kind === 'twig' || o?.kind === 'stump' || o?.kind === 'bush' || o?.kind === 'giantCrop' ? 'valid' : 'blocked';
    }
    const fz = FERTILIZERS[itemId];
    if (fz) return tilled && (t?.fert ?? 0) < fz.tier && !t?.sprinkler && (!c || (!c.dead && c.stage <= 1)) ? 'valid' : 'blocked';
    const def = itemDef(itemId);
    if (def?.kind === 'seed' && def.crop) return tilled && !c && !t?.sprinkler && this.inSeason(def.crop, x, z) ? 'valid' : 'blocked';
    if (SPRINKLERS[itemId]) return g.isWalkable(x, z) && !c ? 'valid' : 'blocked';
    return null;
  }

  private prevSel: string | null = null;

  private updateCursor(dt: number): void {
    this.cursorHold = Math.max(0, this.cursorHold - dt);
    if (this.lastTool && (this.lastTool.t -= dt) <= 0) this.lastTool = null;
    const pl = this.game.player;
    let visible = false;
    if (this.map && this.game.world.current === this.map && pl.controllable) {
      const sel = this.game.services.inventory?.selected()?.id ?? null;
      if (sel !== this.prevSel) {
        // Picking another toolbar slot hands the cursor back to the selection.
        this.prevSel = sel;
        this.lastTool = null;
        this.doneTile = null;
      }
      // Right after an action the state follows the tool that was actually used (scripted uses,
      // demos), not whatever the toolbar happens to show.
      const tool = this.lastTool?.id ?? sel;
      const f = pl.facingTile();
      if (this.doneTile && (this.doneTile.x !== f.x || this.doneTile.z !== f.z)) this.doneTile = null;
      const acts = this.actions;
      if (acts?.isCharging && this.chargeTool) {
        const lv = Math.max(1, this.chargeLevel);
        this.cursor.set(this.chargeTiles(lv).map(([x, z]) => ({ x, z, y: this.cursorY(x, z), state: 'charge' as CursorState })));
        visible = true;
      } else if (acts?.active) {
        // Mid-action: a neutral lock on the worked tile — hidden for a beat after the impact so the
        // soil change reads.
        if (this.actTile && this.cursorHold <= 0) {
          this.cursor.set([{ x: this.actTile.x, z: this.actTile.z, y: this.cursorY(this.actTile.x, this.actTile.z), state: 'neutral' }]);
          visible = true;
        }
      } else if (this.cursorHold <= 0) {
        let st = this.targetState(tool, f.x, f.z);
        // The tile we just worked isn't an error: show it done (neutral), not blocked.
        if (st === 'blocked' && this.doneTile) st = 'neutral';
        if (st) {
          this.cursor.set([{ x: f.x, z: f.z, y: this.cursorY(f.x, f.z), state: st }]);
          visible = true;
        }
      }
    }
    if (this.fxScale === 0 && this.showcase !== 'tools') visible = false;
    // Beauty stills (hero fields, gallery, crows) don't need a targeting cursor on screen.
    if (this.showcase === 'harvest' || this.showcase === 'giant' || this.showcase === 'gallery' || this.showcase === 'crows') visible = false;
    this.cursor.update(dt, visible);
    // Scarecrow in hand (or the crows demo): show the nearest scarecrow's protection radius.
    const sel = this.game.services.inventory?.selected()?.id ?? null;
    this.fx.showRadius(this.map && this.game.world.current === this.map && (sel === 'scarecrow' || this.showcase === 'crows') ? this.nearestScarecrow() : null, SCARECROW_RADIUS);
  }

  private nearestScarecrow(): THREE.Vector3 | null {
    const g = this.grid();
    if (!g || !this.map) return null;
    const p = this.game.player.position;
    let best: THREE.Vector3 | null = null;
    let bd = Infinity;
    for (const [i, o] of g.objects) {
      if (o.id !== 'scarecrow' && o.kind !== 'scarecrow') continue;
      const x = (i % g.width) + 0.5;
      const z = Math.floor(i / g.width) + 0.5;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < bd) {
        bd = d;
        best = new THREE.Vector3(x, 0, z);
      }
    }
    return best;
  }


  private cursorY(x: number, z: number): number {
    return this.isTilled(x, z) ? this.tileY(x, z) + SOIL_LIFT + SOIL_HEIGHT + 0.015 : (this.map?.heightAt(x + 0.5, z + 0.5) ?? 0) + 0.04;
  }

  // ═════════════════════════════════════════════ persistence

  save(): unknown {
    const g = this.grid();
    const out: SavedTile[] = [];
    for (const t of this.tiles.values()) {
      // Only live soil: untilled tiles linger in the map after hoe-backs / demo resets.
      if (!this.isTilled(t.x, t.z) && !t.sprinkler && !t.crop) continue;
      out.push({
        x: t.x,
        z: t.z,
        wet: g?.hasFlag(t.x, t.z, TileFlag.Watered) ?? false,
        tilled: this.isTilled(t.x, t.z) ? undefined : false,
        crop: t.crop ? { id: t.crop.id, days: t.crop.days, base: t.crop.base, seed: t.crop.seed, dead: t.crop.dead || undefined, missed: t.crop.missed || undefined, eaten: t.crop.eaten || undefined } : undefined,
        sprinkler: t.sprinkler ? t.sprinkler.id : undefined,
        fert: t.fert || undefined,
      });
    }
    const giants = [...this.giants.values()].map((gi) => ({ id: gi.id, x0: gi.x0, z0: gi.z0, hp: gi.hp }));
    return { tiles: out, giants, tiers: this.tiers, water: this.canLevel, showcase: this.showcase, xp: this.xpTotal, glass: this.glass };
  }

  load(data: unknown): void {
    const d = data as { tiles?: SavedTile[]; giants?: { id: CropId; x0: number; z0: number; hp: number }[]; tiers?: Record<FarmTool, ToolTier>; water?: number; showcase?: string | boolean | null; xp?: number; glass?: { x0: number; z0: number; x1: number; z1: number }[] };
    if (!d?.tiles) return;
    if (typeof d.xp === 'number') this.xpTotal = d.xp;
    if (Array.isArray(d.glass)) this.glass = d.glass.map((r) => ({ ...r }));
    for (const t of [...this.tiles.values()]) {
      if (t.crop) this.removeCrop(t);
      if (t.sprinkler) this.grid()?.removeObject(t.x, t.z);
      this.untill(t.x, t.z);
    }
    for (const gi of this.giants.values()) {
      this.crops?.remove(gi.handle);
      for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) this.grid()?.setObject(gi.x0 + dx, gi.z0 + dz, null);
    }
    this.giants.clear();
    this.tiles.clear();
    for (const s of d.tiles) {
      if (s.tilled !== false) this.till(s.x, s.z, true);
      if (s.fert) {
        this.tile(s.x, s.z).fert = s.fert;
        this.refreshSoil(s.x, s.z);
      }
      if (s.wet) this.water(s.x, s.z);
      if (s.sprinkler) this.placeSprinkler(s.x, s.z, typeof s.sprinkler === 'string' ? s.sprinkler : 'sprinkler', false);
      if (s.crop) {
        this.plant(s.crop.id, s.x, s.z, s.crop.days, s.crop.seed);
        const t = this.tiles.get(key(s.x, s.z));
        const c = t?.crop;
        if (c && t) {
          c.base = s.crop.base;
          c.missed = s.crop.missed ?? 0;
          if (s.crop.dead) {
            c.dead = true;
            c.eaten = s.crop.eaten;
            this.refreshCrop(t);
          }
        }
      }
    }
    for (const gi of d.giants ?? []) {
      this.makeGiant(gi.id, gi.x0, gi.z0);
      const made = this.giants.get(key(gi.x0, gi.z0));
      if (made) made.hp = gi.hp;
    }
    if (d.tiers) this.tiers = { ...this.tiers, ...d.tiers };
    if (typeof d.water === 'number') this.canLevel = d.water;
    this.showcase = typeof d.showcase === 'string' ? d.showcase : d.showcase ? 'field' : null;
    this.commit();
  }
}
