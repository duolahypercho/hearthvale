/**
 * Shared-farm state for co-op: apply other farmers' actions to this machine's farm, digest the farm
 * into compact per-tile strings, and reconcile this machine's farm to the host's.
 *
 * The farming system (systems/farming.ts, owned by the farming pod) is driven only through its
 * public methods and its normal `item:use` path — nothing in it is rewritten:
 *  - `remote()` runs a callback "as another farmer": our own farmer is parked far away (so the
 *    farming system skips the local swing animation and resolves the impact immediately), the energy
 *    service is proxied (a farmhand's stamina is their own), gained farming XP is handed back,
 *    item:give is routed to the acting farmer instead of our backpack, and chatter (toasts, refusals)
 *    is swallowed. World effects (tilled soil, crops, debris, sprinklers) and their FX happen for real.
 *  - `withFarm()` lets that happen even when this machine is looking at another map.
 *  - `digest()` / `reconcileTile()` / `applyFull()` converge a farmhand's farm onto the host's.
 */
import type { Game } from '../core/game';
import type { EventName, GameEvents } from '../core/events';
import type { System } from '../core/system';
import type { GameMap } from '../world/map';
import type { TileGrid } from '../world/tiles';
import { TileFlag, TileType } from '../world/tiles';
import type { Nature } from '../world/props/nature';

/** The farming system's public tile ops (class methods, not all on FarmingApi). */
interface FarmingNet extends System {
  till(x: number, z: number, force?: boolean, animate?: boolean): boolean;
  untill(x: number, z: number): void;
  water(x: number, z: number, fadeIn?: number): boolean;
  plant(id: string, x: number, z: number, days?: number, seed?: number): boolean;
  harvest(x: number, z: number, style?: 'pull' | 'cut' | 'instant', delay?: number): boolean;
  cropAt(x: number, z: number): { id: string; stage: number; ripe: boolean; dead: boolean } | null;
  xp(): number;
  addXp(n: number): void;
  save(): unknown;
  load(d: unknown): void;
}

interface SavedTile {
  x: number;
  z: number;
  wet: boolean;
  tilled?: boolean;
  crop?: { id: string; days: number; base: number; seed: number; dead?: boolean; missed?: number; eaten?: boolean };
  sprinkler?: boolean | string;
  fert?: number;
}

interface FarmSave {
  tiles: SavedTile[];
  giants?: unknown[];
  tiers?: unknown;
  water?: number;
  xp?: number;
  showcase?: unknown;
  glass?: unknown;
}

export const DEBRIS = new Set(['weed', 'stone', 'boulder', 'twig', 'stump', 'bush']);
/** Items the farm hands out (so predicted gives can be recognised). */
export const FARM_TOOLS = new Set(['hoe', 'wateringCan', 'axe', 'pickaxe', 'scythe']);

/** Events that still fire while replaying another farmer's action (world FX + ambience SFX). */
const PASS = new Set<EventName>(['item:use', 'soil:tilled', 'soil:watered', 'crop:planted', 'sprinkler:spray', 'soil:fertilized', 'tool:impact', 'crop:giant'] as EventName[]);

export type Interceptor = <K extends EventName>(name: K, payload: GameEvents[K]) => boolean;

export interface EventsWithHook {
  interceptor: Interceptor | null;
}

export class FarmSync {
  /** Nesting depth of remote() scopes. */
  private depth = 0;

  constructor(private game: Game) {}

  farming(): FarmingNet | null {
    const s = this.game.systems.find((x) => x.name === 'farming') as FarmingNet | undefined;
    return s && typeof s.till === 'function' && typeof s.save === 'function' ? s : null;
  }

  /** The farm map (loaded or cached), or null if it was never built. */
  farmMap(): GameMap | null {
    const w = this.game.world;
    if (w.current?.id === 'farm') return w.current;
    const cache = (w as unknown as { cache?: Map<string, GameMap> }).cache;
    return cache?.get('farm') ?? null;
  }

  grid(): TileGrid | null {
    return this.farmMap()?.grid ?? null;
  }

  get inRemote(): boolean {
    return this.depth > 0;
  }

  /** Run `fn` with the farming system pointed at the farm, even if we're standing elsewhere. */
  withFarm<T>(fn: () => T): T | null {
    const f = this.farming();
    const farm = this.farmMap();
    if (!f || !farm) return null;
    const onFarm = this.game.world.current?.id === 'farm';
    const fm = f as unknown as { map: GameMap | null };
    if (onFarm || fm.map === farm) return fn();
    const pl = this.game.player;
    const busy = pl.busy;
    const toolVis = pl.rig.tool.visible;
    const proxy = Object.create(this.game, { world: { value: { current: farm } } }) as Game;
    f.onMapChange?.('farm', proxy);
    try {
      return fn();
    } finally {
      f.onMapChange?.(this.game.world.current?.id ?? '', this.game);
      pl.busy = busy;
      pl.rig.tool.visible = toolVis;
    }
  }

  /**
   * Run `fn` as another farmer (see file header). `give` receives the items that farmer earned;
   * `facing` is the direction they face (scythe arcs, particle directions).
   */
  remote<T>(opts: { give?: (itemId: string, qty: number, quality: number) => void; facing?: 'up' | 'down' | 'left' | 'right'; quiet?: boolean }, fn: () => T): T | null {
    const game = this.game;
    const bus = game.events as unknown as EventsWithHook;
    const prev = bus.interceptor;
    const hook: Interceptor = (name, payload) => {
      if (name === 'item:give') {
        const p = payload as GameEvents['item:give'];
        opts.give?.(p.itemId, p.qty, p.quality ?? 0);
        return true;
      }
      if (name === 'tool:impact') {
        const p = payload as GameEvents['tool:impact'];
        if (p.hit === 'none' || opts.quiet) return true;
        return prev ? prev(name, payload) : false;
      }
      if (!PASS.has(name)) return true;
      return prev ? prev(name, payload) : false;
    };
    const pl = game.player;
    const px = pl.position.x;
    const facing = pl.facing;
    const f = this.farming();
    const internals = f as unknown as { canLevel?: number } | null;
    const can = internals?.canLevel;
    const xp0 = f?.xp() ?? 0;
    const energy = game.services.energy;
    if (energy) {
      game.services.energy = { ...energy, value: () => energy.value(), max: () => energy.max(), spend: () => true, restore: () => {}, set: () => {}, exhausted: () => false, canAct: () => true };
    }
    bus.interceptor = hook;
    this.depth++;
    pl.position.x = px + 100000;
    if (opts.facing) pl.facing = opts.facing;
    try {
      return this.withFarm(fn);
    } catch (err) {
      console.error('[net] remote apply failed', err);
      return null;
    } finally {
      pl.position.x = px;
      pl.facing = facing;
      if (f) {
        const gained = f.xp() - xp0;
        if (gained) f.addXp(-gained);
      }
      if (internals && typeof can === 'number') internals.canLevel = can;
      if (energy) game.services.energy = energy;
      this.depth--;
      bus.interceptor = prev;
    }
  }

  /** Apply a farmer's tool / seed use on (x, z) (host: validated intent; farmhands: a replay). */
  applyUse(itemId: string, x: number, z: number, facing: 'up' | 'down' | 'left' | 'right', give?: (itemId: string, qty: number, quality: number) => void, quiet = false): boolean {
    const f = this.farming();
    if (!f) return false;
    const before = this.tileKey(x, z);
    this.remote({ give, facing, quiet }, () => {
      if (itemId === 'scythe') {
        // Ripe crops in the arc are harvested without the "held overhead" pop (it would fly to us).
        const { dx, dz } = dirVec(facing);
        for (const [tx, tz] of [[x, z], [x - dz, z + dx], [x + dz, z - dx]] as [number, number][]) {
          const c = f.cropAt(tx, tz);
          if (c?.ripe && !c.dead) f.harvest(tx, tz, 'instant');
        }
      }
      this.game.events.emit('item:use', { itemId, x, z, slot: -1 });
    });
    return this.tileKey(x, z) !== before;
  }

  /** Harvest by hand (interact) as another farmer. */
  applyHarvest(x: number, z: number, give?: (itemId: string, qty: number, quality: number) => void): boolean {
    const f = this.farming();
    if (!f) return false;
    const c = f.cropAt(x, z);
    if (!c?.ripe || c.dead) return false;
    let ok = false;
    this.remote({ give }, () => {
      ok = f.harvest(x, z, 'instant');
    });
    return ok;
  }

  // ─────────────────────────────────────────── digest

  private savedTiles(): Map<number, SavedTile> {
    const out = new Map<number, SavedTile>();
    const g = this.grid();
    const f = this.farming();
    if (!g || !f) return out;
    const s = f.save() as FarmSave;
    for (const t of s.tiles ?? []) out.set(g.idx(t.x, t.z), t);
    return out;
  }

  private stateOf(g: TileGrid, i: number, t: SavedTile | undefined): string {
    const fl = g.flags[i]!;
    const tilled = (fl & TileFlag.Tilled) !== 0;
    const wet = (fl & TileFlag.Watered) !== 0;
    const o = g.objects.get(i);
    const deb = o && DEBRIS.has(o.kind) ? o.kind : '';
    const c = t?.crop;
    const crop = c ? `${c.id}:${c.days}:${c.dead ? 1 : 0}:${c.seed}` : '';
    const sp = t?.sprinkler ? (typeof t.sprinkler === 'string' ? t.sprinkler : 'sprinkler') : '';
    if (!tilled && !wet && !deb && !crop && !sp) return '';
    return `${tilled ? 1 : 0}${wet ? 1 : 0}|${deb}|${crop}|${sp}`;
  }

  /** Compact state of every interesting farm tile (tilled / debris / crop / sprinkler). */
  digest(): Map<number, string> {
    const out = new Map<number, string>();
    const g = this.grid();
    if (!g) return out;
    const saved = this.savedTiles();
    const idxs = new Set<number>(saved.keys());
    for (const [i, o] of g.objects) if (DEBRIS.has(o.kind)) idxs.add(i);
    for (let i = 0; i < g.flags.length; i++) if (g.flags[i]! & (TileFlag.Tilled | TileFlag.Watered)) idxs.add(i);
    for (const i of idxs) {
      const s = this.stateOf(g, i, saved.get(i));
      if (s) out.set(i, s);
    }
    return out;
  }

  /** State of specific tiles (acks). */
  tiles(idxs: number[]): [number, string][] {
    const g = this.grid();
    if (!g) return [];
    const saved = this.savedTiles();
    return idxs.map((i) => [i, this.stateOf(g, i, saved.get(i))]);
  }

  tileKey(x: number, z: number): string {
    const g = this.grid();
    if (!g || !g.inBounds(x, z)) return '';
    const i = g.idx(x, z);
    const f = this.farming();
    const c = f?.cropAt(x, z);
    return `${g.flags[i]}|${g.objects.get(i)?.kind ?? ''}|${c ? `${c.id}${c.stage}${c.dead}` : ''}`;
  }

  // ─────────────────────────────────────────── reconcile (farmhands)

  /**
   * Bring one farm tile to the host's state `want` ('' = plain ground). Returns false if the tile
   * needs a full resync (a state we can't build incrementally, e.g. a withered crop).
   */
  reconcileTile(idx: number, want: string, known?: string): boolean {
    const g = this.grid();
    const f = this.farming();
    if (!g || !f) return true;
    const x = idx % g.width;
    const z = Math.floor(idx / g.width);
    const have = known ?? this.stateOf(g, idx, this.savedTiles().get(idx));
    if (have === want) return true;
    const [hf = '00', hd = '', hc = '', hs = ''] = have ? have.split('|') : [];
    const [wf = '00', wd = '', wc = '', ws = ''] = want ? want.split('|') : [];
    if (hs !== ws) return false;
    let ok = true;
    this.remote({ quiet: true }, () => {
      // Debris
      if (hd && hd !== wd) g.removeObject(x, z);
      if (wd && wd !== hd && !g.getObject(x, z)) {
        if (wd === 'weed') this.addWeed(x, z);
        else ok = false;
      }
      if (hf === wf && hc === wc) return;
      // Soil / crop: rebuild the tile from bare ground.
      const wTilled = wf[0] === '1';
      const wWet = wf[1] === '1';
      if (hf[0] === '1' || hc) f.untill(x, z);
      if (wTilled) f.till(x, z, true, true);
      if (wWet) f.water(x, z);
      if (wc) {
        const [id = '', days = '0', dead = '0', seed = '0'] = wc.split(':');
        if (dead === '1') ok = false;
        else f.plant(id, x, z, Number(days), Number(seed));
      }
    });
    return ok;
  }

  private addWeed(x: number, z: number): void {
    const map = this.farmMap();
    const g = map?.grid;
    const nature = (map as unknown as { nature?: Nature } | null)?.nature;
    if (!map || !g || !nature) return;
    if (g.getType(x, z) !== TileType.Grass && g.getType(x, z) !== TileType.Dirt) return;
    const wx = x + 0.5;
    const wz = z + 0.5;
    const h = nature.place('weed', wx, map.heightAt(wx, wz), wz, { scale: 1, sink: 0.02 });
    g.setObject(x, z, { kind: 'weed', id: 'weedA', solid: false, hp: 1, onRemove: () => nature.remove(h) });
  }

  /** Debris list for a full sync: [tileIndex, kind]. */
  debris(): [number, string][] {
    const g = this.grid();
    if (!g) return [];
    const out: [number, string][] = [];
    for (const [i, o] of g.objects) if (DEBRIS.has(o.kind)) out.push([i, o.kind]);
    return out;
  }

  /** Host → farmhand full farm: the farming save (minus our personal fields) + debris. */
  fullState(): { save: unknown; debris: [number, string][] } | null {
    const f = this.farming();
    if (!f || !this.grid()) return null;
    const s = f.save() as FarmSave;
    const shared = { tiles: s.tiles, giants: s.giants, showcase: s.showcase ?? null, glass: s.glass };
    return { save: shared, debris: this.debris() };
  }

  /** Farmhand: replace our farm with the host's (keeps our own XP, tool tiers and can water). */
  applyFull(state: { save: unknown; debris: [number, string][] }): void {
    const f = this.farming();
    if (!f) return;
    const mine = f.save() as FarmSave;
    const host = state.save as FarmSave;
    const merged: FarmSave = { ...host, tiers: mine.tiers, water: mine.water, xp: mine.xp };
    this.remote({ quiet: true }, () => {
      f.load(merged);
      const g = this.grid();
      if (!g) return;
      const want = new Map(state.debris);
      for (const [i, o] of [...g.objects]) {
        if (!DEBRIS.has(o.kind)) continue;
        if (want.get(i) !== o.kind) g.removeObject(i % g.width, Math.floor(i / g.width));
      }
      for (const [i, kind] of want) {
        if (kind === 'weed' && !g.objects.get(i)) this.addWeed(i % g.width, Math.floor(i / g.width));
      }
    });
  }

  /** Clear debris / mark blocked tiles for a building footprint (cabins). */
  claimFootprint(x0: number, z0: number, x1: number, z1: number): void {
    const g = this.grid();
    const map = this.farmMap();
    if (!g) return;
    this.remote({ quiet: true }, () => {
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const o = g.getObject(x, z);
          if (o && (DEBRIS.has(o.kind) || o.kind === 'crop')) g.removeObject(x, z);
          g.setFlag(x, z, TileFlag.Blocked, true);
          g.setFlag(x, z, TileFlag.Tillable, false);
          map?.clearGroundCover?.(x, z);
        }
    });
  }
}

export function dirVec(f: 'up' | 'down' | 'left' | 'right'): { dx: number; dz: number } {
  return f === 'up' ? { dx: 0, dz: -1 } : f === 'down' ? { dx: 0, dz: 1 } : f === 'left' ? { dx: -1, dz: 0 } : { dx: 1, dz: 0 };
}
