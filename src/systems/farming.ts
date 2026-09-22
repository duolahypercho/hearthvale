/**
 * FarmingSystem: tilled soil, watering, planting, daily growth through 5 visual stages,
 * harvest (with particles + item pop), sprinklers, seasonal die-off.
 *
 * Tile truth lives in the map TileGrid flags (Tilled / Watered) plus this system's crop map.
 * Visuals: SoilBeds (raised soil pads) + CropVisuals (batched stage meshes) under the map root.
 *
 * Talks to others only via events / services:
 *   in:  item:use, player:interact, day:start, crops:grow, season:change, demo:stage
 *   out: soil:tilled, soil:watered, crop:planted, crop:harvested, item:give, energy:change
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import type { Season } from '../core/time';
import type { GameMap } from '../world/map';
import { TileFlag } from '../world/tiles';
import { CROPS, RIPE_STAGE, stageForDays, daysToRipe, type CropId } from '../data/crops';
import { itemDef } from '../data/items';
import { SoilBeds, SOIL_HEIGHT, SOIL_LIFT } from '../world/props/soil';
import { CropVisuals, type CropHandle } from '../world/props/crops';
import { buildSprinkler } from '../world/props/farmkit';
import { BurstFX } from '../render/particles';

declare module '../core/events' {
  interface GameEvents {
    'soil:tilled': { x: number; z: number };
    'soil:watered': { x: number; z: number };
    'crop:planted': { cropId: CropId; x: number; z: number };
    'crop:harvested': { cropId: CropId; x: number; z: number; qty: number };
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
}

interface FarmTile {
  x: number;
  z: number;
  crop: CropState | null;
  sprinkler: THREE.Object3D | null;
}

interface SavedTile {
  x: number;
  z: number;
  wet: boolean;
  crop?: { id: CropId; days: number; base: number; seed: number };
  sprinkler?: boolean;
}

const key = (x: number, z: number): string => `${x},${z}`;

/** Showcase planting per season: rows of crops at mixed stages (demos / beauty shots). */
const SHOWCASE: Record<Season, CropId[]> = {
  spring: ['cauliflower', 'parsnip', 'potato', 'kale', 'strawberry'],
  summer: ['corn', 'tomato', 'sunflower', 'tomato', 'corn'],
  fall: ['pumpkin', 'corn', 'sunflower', 'pumpkin', 'corn'],
  winter: [],
};

export class FarmingSystem implements System {
  readonly name = 'farming';
  private game!: Game;
  private tiles = new Map<string, FarmTile>();
  private soil: SoilBeds | null = null;
  private crops: CropVisuals | null = null;
  private fx = new BurstFX();
  private map: GameMap | null = null;
  private seededGarden = false;
  private showcase = false;
  private splatDirty = false;

  init(game: Game): void {
    this.game = game;
    game.scene.add(this.fx.object);
    game.events.on('item:use', (e) => this.useItem(e.itemId, e.x, e.z, e.slot));
    game.events.on('player:interact', ({ x, z }) => this.interact(x, z));
    game.events.on('day:start', () => this.newDay());
    game.events.on('crops:grow', ({ days }) => this.growAll(days, false));
    game.events.on('season:change', ({ season }) => this.onSeason(season));
    game.events.on('demo:stage', ({ showcase }) => {
      if (showcase.includes('field')) this.stageShowcase(game.calendar.season);
    });
  }

  onMapChange(mapId: string, game: Game): void {
    const map = game.world.current;
    if (!map || mapId !== 'farm') {
      this.map = null;
      return;
    }
    this.map = map;
    if (!this.soil) {
      this.soil = new SoilBeds(map.grid.width, map.grid.depth);
      this.crops = new CropVisuals();
      map.root.add(this.soil.group, this.crops.group);
    }
    if (!this.seededGarden) {
      this.seededGarden = true;
      this.plantGarden(game.calendar.season);
    }
  }

  // ───────────────────────────────────────────── tile ops

  private grid() {
    return this.map?.grid ?? null;
  }

  private tileY(x: number, z: number): number {
    return this.map ? this.map.heightAt(x + 0.5, z + 0.5) : 0;
  }

  private isTilled(x: number, z: number): boolean {
    return this.grid()?.hasFlag(x, z, TileFlag.Tilled) ?? false;
  }

  private mask(x: number, z: number): number {
    return (this.isTilled(x, z - 1) ? 1 : 0) | (this.isTilled(x + 1, z) ? 2 : 0) | (this.isTilled(x, z + 1) ? 4 : 0) | (this.isTilled(x - 1, z) ? 8 : 0);
  }

  private refreshSoil(x: number, z: number): void {
    const g = this.grid();
    if (!g || !this.soil) return;
    if (!g.hasFlag(x, z, TileFlag.Tilled)) {
      this.soil.clear(x, z);
      return;
    }
    this.soil.set(x, z, this.tileY(x, z), { wet: g.hasFlag(x, z, TileFlag.Watered), mask: this.mask(x, z) });
  }

  private refreshAround(x: number, z: number): void {
    this.refreshSoil(x, z);
    this.refreshSoil(x + 1, z);
    this.refreshSoil(x - 1, z);
    this.refreshSoil(x, z + 1);
    this.refreshSoil(x, z - 1);
  }

  private paint(x: number, z: number): void {
    const t = this.map?.terrain;
    const g = this.grid();
    if (!t || !g) return;
    t.setTileSplat(x, z, { tilled: g.hasFlag(x, z, TileFlag.Tilled) ? 1 : 0, wet: g.hasFlag(x, z, TileFlag.Watered) ? 1 : 0 });
    this.splatDirty = true;
  }

  private tile(x: number, z: number): FarmTile {
    let t = this.tiles.get(key(x, z));
    if (!t) {
      t = { x, z, crop: null, sprinkler: null };
      this.tiles.set(key(x, z), t);
    }
    return t;
  }

  /** Till a tile. `force` clears debris / cover (showcase staging). */
  till(x: number, z: number, force = false): boolean {
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
    this.refreshAround(x, z);
    this.game.events.emit('soil:tilled', { x, z });
    return true;
  }

  untill(x: number, z: number): void {
    const g = this.grid();
    if (!g || !g.hasFlag(x, z, TileFlag.Tilled)) return;
    const t = this.tiles.get(key(x, z));
    if (t?.crop) this.removeCrop(t);
    g.setFlag(x, z, TileFlag.Tilled, false);
    g.setFlag(x, z, TileFlag.Watered, false);
    this.paint(x, z);
    this.refreshAround(x, z);
  }

  water(x: number, z: number): boolean {
    const g = this.grid();
    if (!g || !g.hasFlag(x, z, TileFlag.Tilled)) return false;
    if (!g.hasFlag(x, z, TileFlag.Watered)) {
      g.setFlag(x, z, TileFlag.Watered);
      this.paint(x, z);
      this.refreshSoil(x, z);
    }
    this.game.events.emit('soil:watered', { x, z });
    return true;
  }

  plant(id: CropId, x: number, z: number, days = 0, seed?: number): boolean {
    const g = this.grid();
    if (!g || !g.hasFlag(x, z, TileFlag.Tilled)) return false;
    const t = this.tile(x, z);
    if (t.crop || t.sprinkler) return false;
    t.crop = { id, days, base: 0, handle: null, stage: -1, seed: seed ?? Math.floor(Math.random() * 1e6) };
    g.setObject(x, z, { kind: 'crop', id, solid: false });
    this.refreshCrop(t);
    this.game.events.emit('crop:planted', { cropId: id, x, z });
    return true;
  }

  private refreshCrop(t: FarmTile): void {
    const c = t.crop;
    if (!c || !this.crops) return;
    const stage = stageForDays(CROPS[c.id], c.days);
    if (stage === c.stage && c.handle) return;
    if (c.handle) this.crops.remove(c.handle);
    c.stage = stage;
    c.handle = this.crops.add(c.id, stage, t.x + 0.5, this.tileY(t.x, t.z) + SOIL_LIFT + SOIL_HEIGHT * 0.85, t.z + 0.5, c.seed);
  }

  private removeCrop(t: FarmTile): void {
    if (t.crop?.handle) this.crops?.remove(t.crop.handle);
    t.crop = null;
    const g = this.grid();
    if (g?.getObject(t.x, t.z)?.kind === 'crop') g.setObject(t.x, t.z, null);
  }

  harvest(x: number, z: number): boolean {
    const t = this.tiles.get(key(x, z));
    const c = t?.crop;
    if (!t || !c || c.stage < RIPE_STAGE) return false;
    const def = CROPS[c.id];
    const qty = 1 + (Math.random() < 0.15 ? 1 : 0);
    const p = new THREE.Vector3(x + 0.5, this.tileY(x, z) + 0.3, z + 0.5);
    this.fx.emit(p, { color: def.color, count: 16, speed: 1.8, size: 0.14, gravity: 5, up: 1.6 });
    this.fx.emit(p, { color: 0xfff2b0, count: 10, speed: 1.2, size: 0.08, gravity: 0.5, up: 1.2, life: 0.9 });
    this.game.events.emit('item:give', { itemId: def.produce, qty });
    this.game.events.emit('crop:harvested', { cropId: c.id, x, z, qty });
    if (def.regrow) {
      c.base = daysToRipe(def) - def.regrow;
      c.days = c.base;
      c.stage = -1;
      this.refreshCrop(t);
    } else this.removeCrop(t);
    return true;
  }

  private placeSprinkler(x: number, z: number): boolean {
    const g = this.grid();
    if (!g || !this.map || !g.isWalkable(x, z)) return false;
    const t = this.tile(x, z);
    if (t.crop || t.sprinkler) return false;
    const obj = buildSprinkler();
    obj.position.set(x + 0.5, this.tileY(x, z) + (this.isTilled(x, z) ? SOIL_HEIGHT : 0), z + 0.5);
    this.map.root.add(obj);
    t.sprinkler = obj;
    g.setObject(x, z, { kind: 'sprinkler', id: 'sprinkler', solid: true, onRemove: () => obj.removeFromParent() });
    this.map.clearGroundCover?.(x, z);
    return true;
  }

  // ───────────────────────────────────────────── gameplay

  private spend(energy: number): void {
    this.game.services.energy?.spend(energy);
  }

  private useItem(itemId: string, x: number, z: number, slot: number): void {
    const g = this.grid();
    if (!g || !this.map) return;
    const def = itemDef(itemId);
    const center = new THREE.Vector3(x + 0.5, this.tileY(x, z) + 0.1, z + 0.5);
    const obj = g.getObject(x, z);
    switch (itemId) {
      case 'hoe':
        if (this.till(x, z)) {
          this.fx.emit(center, { color: 0x7a5236, count: 14, speed: 1.4, size: 0.1, gravity: 7 });
          this.spend(2);
        }
        return;
      case 'wateringCan':
        if (this.water(x, z)) {
          this.fx.emit(center.setY(center.y + 0.35), { color: 0x9fd4ff, count: 18, speed: 1.1, size: 0.07, gravity: 9, up: 0.4, spread: 0.6 });
          this.spend(2);
        }
        return;
      case 'scythe':
        if (this.harvest(x, z)) return;
        if (obj?.kind === 'weed') {
          g.removeObject(x, z);
          this.fx.emit(center, { color: 0x6fae45, count: 12, speed: 1.3, size: 0.09 });
          this.game.events.emit('item:give', { itemId: 'fiber', qty: 1 });
        }
        return;
      case 'pickaxe':
        if (obj?.kind === 'stone' || obj?.kind === 'boulder') {
          g.removeObject(x, z);
          this.fx.emit(center, { color: 0x9a948a, count: 14, speed: 1.6, size: 0.1 });
          this.game.events.emit('item:give', { itemId: 'stone', qty: obj.kind === 'boulder' ? 5 : 1 });
          this.spend(3);
        } else if (obj?.kind === 'sprinkler') {
          g.removeObject(x, z);
          const t = this.tiles.get(key(x, z));
          if (t) t.sprinkler = null;
          this.game.events.emit('item:give', { itemId: 'sprinkler', qty: 1 });
        } else if (this.isTilled(x, z) && !this.tiles.get(key(x, z))?.crop) this.untill(x, z);
        return;
      case 'axe':
        if (obj?.kind === 'twig' || obj?.kind === 'stump' || obj?.kind === 'bush') {
          g.removeObject(x, z);
          this.fx.emit(center, { color: obj.kind === 'bush' ? 0x5e9a3a : 0x8a6440, count: 12, speed: 1.4, size: 0.09 });
          this.game.events.emit('item:give', { itemId: obj.kind === 'bush' ? 'fiber' : 'wood', qty: obj.kind === 'stump' ? 4 : obj.kind === 'bush' ? 2 : 1 });
          this.spend(3);
        }
        return;
    }
    if (def?.kind === 'seed' && def.crop) {
      const crop = CROPS[def.crop];
      if (!crop.seasons.includes(this.game.calendar.season)) return;
      if (this.plant(def.crop, x, z)) {
        this.game.services.inventory?.takeFromSlot(slot, 1);
        this.fx.emit(center, { color: 0x6b4a2e, count: 6, speed: 0.8, size: 0.07 });
      }
    } else if (itemId === 'sprinkler') {
      if (this.placeSprinkler(x, z)) this.game.services.inventory?.takeFromSlot(slot, 1);
    }
  }

  private interact(x: number, z: number): void {
    this.harvest(x, z);
  }

  private newDay(): void {
    const g = this.grid();
    if (!g) return;
    const raining = this.game.calendar.weather === 'rain' || this.game.calendar.weather === 'storm';
    // Grow crops that were watered overnight.
    for (const t of this.tiles.values()) {
      if (t.crop && (g.hasFlag(t.x, t.z, TileFlag.Watered) || raining)) {
        t.crop.days++;
        this.refreshCrop(t);
      }
    }
    // Dry out, then rain / sprinklers re-water.
    for (const t of this.tiles.values()) {
      if (g.hasFlag(t.x, t.z, TileFlag.Watered)) {
        g.setFlag(t.x, t.z, TileFlag.Watered, false);
        this.paint(t.x, t.z);
        this.refreshSoil(t.x, t.z);
      }
    }
    for (const t of [...this.tiles.values()]) {
      if (raining) {
        if (this.isTilled(t.x, t.z)) this.water(t.x, t.z);
      } else if (t.sprinkler) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) this.water(t.x + dx, t.z + dz);
      }
    }
  }

  growAll(days: number, needWater: boolean): void {
    const g = this.grid();
    for (const t of this.tiles.values()) {
      if (!t.crop) continue;
      if (needWater && g && !g.hasFlag(t.x, t.z, TileFlag.Watered)) continue;
      t.crop.days += days;
      this.refreshCrop(t);
    }
  }

  private onSeason(season: Season): void {
    if (this.showcase) {
      this.plantGarden(season, true);
      this.stageShowcase(season);
      return;
    }
    for (const t of this.tiles.values()) {
      if (t.crop && !CROPS[t.crop.id].seasons.includes(season)) this.removeCrop(t);
    }
  }

  // ───────────────────────────────────────────── staging

  private rect(name: string): { x0: number; z0: number; x1: number; z1: number } | null {
    return this.map?.plots?.[name] ?? null;
  }

  /** Grandmother's kitchen garden: a few rows already coming up on day one. */
  private plantGarden(season: Season, replace = false): void {
    const r = this.rect('garden');
    if (!r) return;
    if (replace) {
      for (let z = r.z0; z <= r.z1; z++) {
        for (let x = r.x0; x <= r.x1; x++) {
          const t = this.tiles.get(key(x, z));
          if (t?.crop) this.removeCrop(t);
          const g = this.grid();
          if (g?.hasFlag(x, z, TileFlag.Watered)) {
            g.setFlag(x, z, TileFlag.Watered, false);
            this.paint(x, z);
            this.refreshSoil(x, z);
          }
        }
      }
    }
    const crops: CropId[] = season === 'spring' ? ['parsnip', 'parsnip', 'strawberry', 'potato'] : season === 'summer' ? ['tomato', 'tomato', 'sunflower', 'corn'] : season === 'fall' ? ['pumpkin', 'pumpkin', 'corn', 'sunflower'] : [];
    let n = 0;
    for (let z = r.z0; z <= r.z1; z++) {
      for (let x = r.x0; x <= r.x1; x++) {
        this.till(x, z, true);
        const id = crops[(z - r.z0) % Math.max(1, crops.length)];
        if (id) {
          const h = (x * 928371 + z * 1231) >>> 0;
          this.plant(id, x, z, Math.min(daysToRipe(CROPS[id]), 1 + (h % 4) + (x - r.x0)), h);
        }
        if (z - r.z0 < 2 && season !== 'winter') this.water(x, z);
        n++;
      }
    }
    this.commit();
    void n;
  }

  /** Demo showcase: a tended field with mixed crops at stages 2-4, a watered patch and a sprinkler. */
  stageShowcase(season: Season): void {
    const r = this.rect('field');
    if (!r) return;
    this.showcase = true;
    const ids = SHOWCASE[season];
    const sx = Math.floor((r.x0 + r.x1) / 2);
    const sz = Math.floor((r.z0 + r.z1) / 2);
    for (let z = r.z0; z <= r.z1; z++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const t = this.tile(x, z);
        if (t.crop) this.removeCrop(t);
        this.till(x, z, true);
        if (x === sx && z === sz) {
          if (!t.sprinkler) this.placeSprinkler(x, z);
          continue;
        }
        const row = z - r.z0;
        const id = ids[row % Math.max(1, ids.length)];
        if (id) {
          const def = CROPS[id];
          const ripe = daysToRipe(def);
          const h = (x * 73856093 ^ z * 19349663) >>> 0;
          // Ripeness ramps across the row (older plantings to the west) with some jitter.
          const f = 1 - (x - r.x0) / Math.max(1, r.x1 - r.x0);
          const target = 2 + Math.round(f * 2.2 + ((h % 5) - 2) * 0.25);
          let days = 0;
          while (stageForDays(def, days) < Math.min(RIPE_STAGE, Math.max(2, target)) && days < ripe) days++;
          this.plant(id, x, z, days, h);
        }
        // Watered patch: the sprinkler's reach plus the freshly watered western rows.
        const nearSprinkler = Math.abs(x - sx) + Math.abs(z - sz) === 1;
        if (season !== 'winter' && (nearSprinkler || x - r.x0 < 3)) this.water(x, z);
      }
    }
    this.commit();
  }

  private commit(): void {
    if (this.splatDirty) this.map?.terrain?.commitSplat();
    this.splatDirty = false;
  }

  private sprayT = 0;

  update(dt: number, game: Game): void {
    // Sprinklers run for the first couple of hours of a dry morning: rotating arcs of droplets.
    const cal = game.calendar;
    const dry = cal.weather !== 'rain' && cal.weather !== 'storm' && cal.season !== 'winter';
    if (dry && cal.hour >= 6 && cal.hour < 9 && this.map) {
      this.sprayT += dt;
      const p = new THREE.Vector3();
      for (const t of this.tiles.values()) {
        if (!t.sprinkler) continue;
        for (let k = 0; k < 2; k++) {
          const a = this.sprayT * 5 + k * Math.PI;
          p.set(t.x + 0.5 + Math.cos(a) * 0.08, t.sprinkler.position.y + 0.32, t.z + 0.5 + Math.sin(a) * 0.08);
          this.fx.emitDir(p, Math.cos(a), Math.sin(a), { color: 0xbfe6ff, count: 2, speed: 1.9, size: 0.06, gravity: 7, life: 0.6 });
        }
      }
    }
    this.fx.update(dt, game.rc.renderer.domElement.height);
    this.commit();
  }

  // ───────────────────────────────────────────── persistence

  save(): unknown {
    const g = this.grid();
    const out: SavedTile[] = [];
    for (const t of this.tiles.values()) {
      out.push({
        x: t.x,
        z: t.z,
        wet: g?.hasFlag(t.x, t.z, TileFlag.Watered) ?? false,
        crop: t.crop ? { id: t.crop.id, days: t.crop.days, base: t.crop.base, seed: t.crop.seed } : undefined,
        sprinkler: !!t.sprinkler,
      });
    }
    return { tiles: out, showcase: this.showcase };
  }

  load(data: unknown): void {
    const d = data as { tiles?: SavedTile[]; showcase?: boolean };
    if (!d?.tiles) return;
    for (const t of [...this.tiles.values()]) {
      if (t.crop) this.removeCrop(t);
      if (t.sprinkler) this.grid()?.removeObject(t.x, t.z);
      this.untill(t.x, t.z);
    }
    this.tiles.clear();
    for (const s of d.tiles) {
      this.till(s.x, s.z, true);
      if (s.wet) this.water(s.x, s.z);
      if (s.sprinkler) this.placeSprinkler(s.x, s.z);
      if (s.crop) {
        this.plant(s.crop.id, s.x, s.z, s.crop.days, s.crop.seed);
        const c = this.tiles.get(key(s.x, s.z))?.crop;
        if (c) c.base = s.crop.base;
      }
    }
    this.showcase = !!d.showcase;
    this.commit();
  }
}
