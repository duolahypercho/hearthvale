/**
 * Tile grid: the gameplay truth of a map. 1 tile = 1 world unit; tile (x,z) spans
 * world [x, x+1) × [z, z+1), its center is (x+0.5, z+0.5). +X east, +Z south (towards camera).
 *
 * Stores per tile: type, flags (blocked/tillable/tilled/watered...), ground height, and an
 * optional TileObject (debris, trees, placed items...). Farming/crafting teams extend
 * `TileObject.kind` and use `data` for their own state.
 */

export enum TileType {
  Void = 0,
  Grass = 1,
  Dirt = 2,
  Path = 3,
  Water = 4,
  Cliff = 5,
  Floor = 6,
  Sand = 7,
  Stone = 8,
}

export const TileFlag = {
  /** Static blocker (building footprint, cliff, deep water, fence...). */
  Blocked: 1 << 0,
  /** Can be hoed. */
  Tillable: 1 << 1,
  Tilled: 1 << 2,
  Watered: 1 << 3,
  /** Water you can fish/refill from. */
  WaterSource: 1 << 4,
  /** Nothing may be placed here (doors, warps, paths reserved). */
  NoPlace: 1 << 5,
  /** Reserved for later teams. */
  Custom1: 1 << 6,
  Custom2: 1 << 7,
} as const;

export type TileObjectKind =
  | 'weed'
  | 'stone'
  | 'twig'
  | 'stump'
  | 'boulder'
  | 'tree'
  | 'bush'
  | 'fence'
  | 'building'
  | 'prop'
  | 'crop'
  | (string & {});

export interface TileObject {
  kind: TileObjectKind;
  /** Stable id (e.g. 'weed', 'oak', 'shipping_bin'). */
  id: string;
  /** Blocks movement. */
  solid: boolean;
  hp?: number;
  /** Renderer handle: whoever spawned it knows how to remove its visuals. */
  onRemove?: () => void;
  data?: Record<string, unknown>;
}

export class TileGrid {
  readonly type: Uint8Array;
  readonly flags: Uint8Array;
  readonly height: Float32Array;
  readonly objects = new Map<number, TileObject>();

  constructor(
    readonly width: number,
    readonly depth: number,
  ) {
    const n = width * depth;
    this.type = new Uint8Array(n).fill(TileType.Grass);
    this.flags = new Uint8Array(n);
    this.height = new Float32Array(n);
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.depth;
  }

  idx(x: number, z: number): number {
    return z * this.width + x;
  }

  getType(x: number, z: number): TileType {
    return this.inBounds(x, z) ? (this.type[this.idx(x, z)]! as TileType) : TileType.Void;
  }

  setType(x: number, z: number, t: TileType): void {
    if (this.inBounds(x, z)) this.type[this.idx(x, z)] = t;
  }

  hasFlag(x: number, z: number, f: number): boolean {
    return this.inBounds(x, z) && (this.flags[this.idx(x, z)]! & f) !== 0;
  }

  setFlag(x: number, z: number, f: number, on = true): void {
    if (!this.inBounds(x, z)) return;
    const i = this.idx(x, z);
    this.flags[i] = on ? this.flags[i]! | f : this.flags[i]! & ~f;
  }

  getObject(x: number, z: number): TileObject | undefined {
    return this.inBounds(x, z) ? this.objects.get(this.idx(x, z)) : undefined;
  }

  setObject(x: number, z: number, o: TileObject | null): void {
    if (!this.inBounds(x, z)) return;
    const i = this.idx(x, z);
    if (o) this.objects.set(i, o);
    else this.objects.delete(i);
  }

  /** Removes the object and calls its visual teardown. */
  removeObject(x: number, z: number): TileObject | undefined {
    const o = this.getObject(x, z);
    if (o) {
      o.onRemove?.();
      this.objects.delete(this.idx(x, z));
    }
    return o;
  }

  isWalkable(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const i = this.idx(x, z);
    const t = this.type[i]!;
    if (t === TileType.Void || t === TileType.Water || t === TileType.Cliff) return false;
    if (this.flags[i]! & TileFlag.Blocked) return false;
    const o = this.objects.get(i);
    return !(o && o.solid);
  }

  /** World position → tile coords (floored). */
  worldToTile(wx: number, wz: number): { x: number; z: number } {
    return { x: Math.floor(wx), z: Math.floor(wz) };
  }

  tileCenter(x: number, z: number): { x: number; z: number } {
    return { x: x + 0.5, z: z + 0.5 };
  }

  forEach(fn: (x: number, z: number, i: number) => void): void {
    for (let z = 0; z < this.depth; z++) for (let x = 0; x < this.width; x++) fn(x, z, z * this.width + x);
  }
}
