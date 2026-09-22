/**
 * Map abstraction + World (map manager). Other teams add maps (town, beach, forest, mine)
 * by implementing GameMap and registering a factory:
 *
 *   world.registerMap('town', (game) => new TownMap(game));
 */
import * as THREE from 'three';
import type { Game } from '../core/game';
import type { Facing } from '../core/events';
import type { Season, Weather } from '../core/time';
import type { TileGrid } from './tiles';
import type { Terrain } from './terrain';

export interface GameMap {
  readonly id: string;
  readonly grid: TileGrid;
  readonly root: THREE.Group;
  readonly spawn: { x: number; z: number; facing: Facing };
  /** Camera look-target clamp (world XZ). */
  readonly cameraBounds: THREE.Box2;
  readonly terrain?: Terrain;
  /** Named farmable rectangles (tile coords, inclusive), e.g. 'garden', 'field'. */
  readonly plots?: Record<string, { x0: number; z0: number; x1: number; z1: number }>;
  /** Points of interest for ambient life (flower beds, porch, yard...), world coords. */
  readonly poi?: Record<string, { x: number; y?: number; z: number; rot?: number }[]>;
  heightAt(x: number, z: number): number;
  /** Remove grass / small decorative cover from a tile (tilling, placing objects). */
  clearGroundCover?(x: number, z: number): void;
  update(dt: number, game: Game): void;
  setSeason?(season: Season): void;
  setWeather?(weather: Weather): void;
  dispose(): void;
}

export type MapFactory = (game: Game) => GameMap | Promise<GameMap>;

export class World {
  private factories = new Map<string, MapFactory>();
  private cache = new Map<string, GameMap>();
  current: GameMap | null = null;

  constructor(private game: Game) {}

  registerMap(id: string, factory: MapFactory): void {
    this.factories.set(id, factory);
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  get mapIds(): string[] {
    return [...this.factories.keys()];
  }

  async load(id: string): Promise<GameMap> {
    if (this.current?.id === id) return this.current;
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`[world] unknown map "${id}" (known: ${this.mapIds.join(', ')})`);
    const prev = this.current;
    if (prev) this.game.scene.remove(prev.root);
    let map = this.cache.get(id);
    if (!map) {
      map = await factory(this.game);
      this.cache.set(id, map);
    }
    this.current = map;
    this.game.scene.add(map.root);
    map.setSeason?.(this.game.calendar.season);
    map.setWeather?.(this.game.calendar.weather);
    this.game.rc.rig.bounds = map.cameraBounds;
    this.game.events.emit('map:change', { map: id, prev: prev?.id ?? null });
    return map;
  }

  heightAt(x: number, z: number): number {
    return this.current ? this.current.heightAt(x, z) : 0;
  }
}
