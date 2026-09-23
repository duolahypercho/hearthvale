/**
 * BuildingSystem: farm buildings, their interiors and getting in / out of them.
 *
 *   - registers the interior maps (house, coop, barn) + the interior lighting hook;
 *   - doors: interact with (or walk into) the farmhouse / coop / barn door → fade, enter; the
 *     interior's doorway warp (GameMap.warps, handled by WarpSystem) brings you back out;
 *   - camera: interiors use their own close diorama framing; the outdoor framing is restored on exit;
 *   - construction: the carpenter panel orders a coop / barn → a staked construction site appears,
 *     the building is finished the next morning (`building:built`); service `buildings`;
 *   - demos: coop-interior / barn-interior / animals-pasture stage the buildings instantly.
 */
import type { System } from '../../core/system';
import type { Game } from '../../core/game';
import { installInteriorLighting, isInterior } from '../interiors/lighting';
import { HouseInterior, HOUSE_DOOR } from '../interiors/house';
import { CoopInterior } from '../interiors/coop';
import { BarnInterior } from '../interiors/barn';
import { FarmBuildings, SITES, type BuildingKind } from './farm';
import { CarpenterPanel } from './carpenter';

export interface BuildingsApi {
  /** Finished buildings. */
  has(kind: BuildingKind): boolean;
  /** Under construction (finishes next morning). */
  pending(kind: BuildingKind): boolean;
  /** Order a building (spends gold / materials). Returns an error message or null. */
  order(kind: BuildingKind): string | null;
  /** Build instantly (debug / demos). */
  complete(kind: BuildingKind): void;
  /** Pasture rectangle (world coords) animals may roam on sunny days. */
  pasture(): { x0: number; z0: number; x1: number; z1: number };
  /** Outdoor door front (world) of a building. */
  doorFront(kind: BuildingKind): { x: number; z: number };
}

declare module '../../core/game' {
  interface GameServices {
    buildings: BuildingsApi;
  }
}

declare module '../../core/events' {
  interface GameEvents {
    'building:ordered': { kind: string };
    'building:built': { kind: string };
    /** Player entered / left a building interior. */
    'building:enter': { kind: string };
  }
}

export const COSTS: Record<BuildingKind, { gold: number; wood: number; stone: number; name: string; blurb: string; houses: string }> = {
  coop: { gold: 4000, wood: 300, stone: 100, name: 'Coop', blurb: 'A snug red henhouse with nesting boxes, a roost ladder and a feed bench.', houses: 'Chickens · Ducks' },
  barn: { gold: 6000, wood: 350, stone: 150, name: 'Barn', blurb: 'A tall gambrel barn with stalls, a hay loft and a long feeding trough.', houses: 'Cows · Goats · Sheep · Pigs' },
};

const OUTDOOR_CAM_DEFAULT = { yaw: 0, pitch: 50, distance: 24, offX: 0, offZ: 0 };

export class BuildingSystem implements System, BuildingsApi {
  readonly name = 'buildings';
  private game!: Game;
  private built = new Set<BuildingKind>();
  private orders = new Set<BuildingKind>();
  /** Built by a demo (removed again when another demo is staged). */
  private demoBuilt = new Set<BuildingKind>();
  private farm: FarmBuildings | null = null;
  private outdoorCam = { ...OUTDOOR_CAM_DEFAULT };
  private wasInside = false;
  private busy = false;
  private pushT = 0;

  init(game: Game): void {
    this.game = game;
    game.provide('buildings', this);
    installInteriorLighting(game);
    game.world.registerMap('house', (g) => new HouseInterior(g));
    game.world.registerMap('coop', (g) => new CoopInterior(g));
    game.world.registerMap('barn', (g) => new BarnInterior(g));
    game.hud.registerPanel('carpenter', new CarpenterPanel(game, game.hud.root));

    game.events.on('player:interact', ({ x, z }) => this.interact(x, z));
    game.events.on('day:start', () => {
      for (const k of [...this.orders]) {
        this.orders.delete(k);
        this.built.add(k);
        this.refreshFarm();
        game.events.emit('building:built', { kind: k });
      }
    });
    game.events.on('demo:stage', ({ name }) => this.stageDemo(name));
  }

  // ───────────────────────────────────────────── api

  has(kind: BuildingKind): boolean {
    return this.built.has(kind);
  }

  pending(kind: BuildingKind): boolean {
    return this.orders.has(kind);
  }

  order(kind: BuildingKind): string | null {
    if (this.built.has(kind) || this.orders.has(kind)) return 'Already on the farm.';
    const c = COSTS[kind];
    const inv = this.game.services.inventory;
    const eco = this.game.services.economy;
    if (!eco || eco.gold() < c.gold) return `Needs ${c.gold.toLocaleString()}g.`;
    if (!inv || inv.count('wood') < c.wood) return `Needs ${c.wood} wood.`;
    if (inv.count('stone') < c.stone) return `Needs ${c.stone} stone.`;
    eco.spend(c.gold, `build:${kind}`);
    inv.remove('wood', c.wood);
    inv.remove('stone', c.stone);
    this.orders.add(kind);
    this.refreshFarm();
    this.game.events.emit('building:ordered', { kind });
    return null;
  }

  complete(kind: BuildingKind): void {
    this.orders.delete(kind);
    if (this.built.has(kind)) return;
    this.built.add(kind);
    this.refreshFarm();
    this.game.events.emit('building:built', { kind });
  }

  pasture(): { x0: number; z0: number; x1: number; z1: number } {
    return SITES.pasture;
  }

  doorFront(kind: BuildingKind): { x: number; z: number } {
    const s = SITES[kind];
    return { x: s.door.x + 0.5, z: s.door.z + 1.4 };
  }

  // ───────────────────────────────────────────── farm structures

  private refreshFarm(): void {
    const map = this.game.world.current;
    if (map?.id !== 'farm') return;
    if (!this.farm) this.farm = new FarmBuildings(this.game, map);
    this.farm.sync(this.built, this.orders);
  }

  onMapChange(mapId: string, game: Game): void {
    const map = game.world.current;
    const rig = game.rc.rig;
    if (isInterior(map)) {
      if (!this.wasInside) this.outdoorCam = { yaw: rig.yaw, pitch: rig.pitch, distance: rig.distance, offX: rig.lookOffset.x, offZ: rig.lookOffset.z };
      const c = map.camera;
      rig.yaw = c.yaw;
      rig.pitch = c.pitch;
      rig.distance = c.distance;
      rig.lookOffset.set(c.offsetX, 0, c.offsetZ);
      rig.snap();
      this.wasInside = true;
      game.events.emit('building:enter', { kind: mapId });
    } else if (this.wasInside) {
      const c = this.outdoorCam;
      rig.yaw = c.yaw;
      rig.pitch = c.pitch;
      rig.distance = c.distance;
      rig.lookOffset.set(c.offX, 0, c.offZ);
      rig.snap();
      this.wasInside = false;
    }
    if (mapId === 'farm') this.refreshFarm();
  }

  // ───────────────────────────────────────────── doors

  private doorAt(x: number, z: number): 'house' | BuildingKind | null {
    if (this.game.world.current?.id !== 'farm') return null;
    if (x === HOUSE_DOOR.x && z === HOUSE_DOOR.z) return 'house';
    for (const k of ['coop', 'barn'] as const) {
      const d = SITES[k].door;
      if (this.built.has(k) && x === d.x && z === d.z) return k;
    }
    return null;
  }

  private interact(x: number, z: number): void {
    const d = this.doorAt(x, z);
    if (d) {
      void this.enter(d);
      return;
    }
    if (this.game.world.current?.id === 'farm' && this.farm?.isBoard(x, z)) this.game.events.emit('ui:open', { name: 'carpenter' });
  }

  async enter(target: 'house' | BuildingKind): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const g = this.game;
    g.player.controllable = false;
    await g.hud.fade(true);
    const spawn = await (async () => {
      const m = await g.world.load(target);
      return m.spawn;
    })();
    g.player.teleport(spawn.x, spawn.z);
    g.player.setFacing('up');
    g.followPlayer(true);
    await new Promise((r) => setTimeout(r, 120));
    await g.hud.fade(false);
    g.player.controllable = true;
    this.busy = false;
  }

  /** Walking into a door (pushing against it for a moment) also opens it. */
  fixedUpdate(dt: number, game: Game): void {
    if (this.busy || game.paused || !game.player.controllable || game.world.current?.id !== 'farm') return;
    const p = game.player.position;
    const t = game.player.facingTile();
    const d = game.player.facing === 'up' ? this.doorAt(t.x, t.z) : null;
    const axis = game.input.moveAxis();
    const pushing = d && Math.abs(p.x - (t.x + 0.5)) < 0.55 && p.z - (t.z + 1) < 0.5 && Math.hypot(axis.x, axis.y) > 0.3;
    this.pushT = pushing ? this.pushT + dt : 0;
    if (pushing && this.pushT > 0.18 && d) {
      this.pushT = 0;
      void this.enter(d);
    }
  }

  update(dt: number, game: Game): void {
    if (game.world.current?.id === 'farm') this.farm?.update(dt, game);
  }

  // ───────────────────────────────────────────── demos

  private stageDemo(name: string): void {
    const wants = name === 'animals-pasture' || name === 'coop-interior' || name === 'barn-interior';
    if (wants) {
      for (const k of ['coop', 'barn'] as const) {
        if (!this.built.has(k)) {
          this.demoBuilt.add(k);
          this.complete(k);
        }
      }
      return;
    }
    if (this.demoBuilt.size) {
      for (const k of this.demoBuilt) this.built.delete(k);
      this.demoBuilt.clear();
      this.refreshFarm();
    }
  }

  // ───────────────────────────────────────────── save

  save(): unknown {
    return { built: [...this.built].filter((k) => !this.demoBuilt.has(k)), orders: [...this.orders] };
  }

  load(data: unknown): void {
    const d = data as { built?: BuildingKind[]; orders?: BuildingKind[] };
    this.built = new Set(d?.built ?? []);
    this.orders = new Set(d?.orders ?? []);
    this.demoBuilt.clear();
    this.refreshFarm();
  }
}

export type { BuildingKind };
