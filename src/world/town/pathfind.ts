/**
 * A* on a TileGrid (8-way, no corner cutting) for villagers. Paved tiles (stone / floor) are
 * cheaper than grass so townsfolk keep to the streets; the result is string-pulled with a
 * line-of-sight check (never across blocked tiles, and only along roughly-equal-cost ground) and
 * returned as world-space waypoints at tile centres (with the exact start / goal points).
 */
import { TileGrid, TileType } from '../tiles';

export interface Waypoint {
  x: number;
  z: number;
}

const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

function tileCost(grid: TileGrid, x: number, z: number): number {
  const t = grid.getType(x, z);
  return t === TileType.Stone || t === TileType.Floor || t === TileType.Path ? 1 : 2.2;
}

/** Binary heap keyed by f-score. */
class Heap {
  private items: number[] = [];
  constructor(private score: Float32Array) {}
  get size(): number {
    return this.items.length;
  }
  push(i: number): void {
    const a = this.items;
    a.push(i);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.score[a[p]!]! <= this.score[a[k]!]!) break;
      [a[p], a[k]] = [a[k]!, a[p]!];
      k = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && this.score[a[l]!]! < this.score[a[m]!]!) m = l;
        if (r < a.length && this.score[a[r]!]! < this.score[a[m]!]!) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k]!, a[m]!];
        k = m;
      }
    }
    return top;
  }
}

/** Nearest walkable tile to (x, z) within a small radius (spiral search). */
export function nearestWalkable(grid: TileGrid, x: number, z: number, maxR = 4): { x: number; z: number } | null {
  const tx = Math.floor(x);
  const tz = Math.floor(z);
  if (grid.isWalkable(tx, tz)) return { x: tx, z: tz };
  let best: { x: number; z: number } | null = null;
  let bd = Infinity;
  for (let r = 1; r <= maxR; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const nx = tx + dx;
        const nz = tz + dz;
        if (!grid.isWalkable(nx, nz)) continue;
        const d = Math.hypot(nx + 0.5 - x, nz + 0.5 - z);
        if (d < bd) {
          bd = d;
          best = { x: nx, z: nz };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

function lineClear(grid: TileGrid, ax: number, az: number, bx: number, bz: number): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.ceil(d / 0.2);
  const c0 = tileCost(grid, Math.floor(ax), Math.floor(az));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    // Keep a little clearance from blocked tiles (villagers have a body).
    for (const [ox, oz] of [[0, 0], [0.28, 0], [-0.28, 0], [0, 0.28], [0, -0.28]] as const) {
      if (!grid.isWalkable(Math.floor(x + ox), Math.floor(z + oz))) return false;
    }
    if (tileCost(grid, Math.floor(x), Math.floor(z)) > c0 + 0.1) return false;
  }
  return true;
}

/**
 * Path from (sx, sz) to (gx, gz) in world coords. Returns [] if unreachable. `maxNodes` caps the
 * search (the town is 100 × 64 = 6400 tiles, so a full search is cheap).
 */
export function findPath(grid: TileGrid, sx: number, sz: number, gx: number, gz: number, maxNodes = 8000): Waypoint[] {
  const s = nearestWalkable(grid, sx, sz);
  const g = nearestWalkable(grid, gx, gz);
  if (!s || !g) return [];
  const W = grid.width;
  const N = W * grid.depth;
  const gScore = new Float32Array(N).fill(Infinity);
  const fScore = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const start = s.z * W + s.x;
  const goal = g.z * W + g.x;
  const h = (i: number): number => {
    const x = i % W;
    const z = (i / W) | 0;
    const dx = Math.abs(x - g.x);
    const dz = Math.abs(z - g.z);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  gScore[start] = 0;
  fScore[start] = h(start);
  const open = new Heap(fScore);
  open.push(start);
  let visited = 0;
  while (open.size) {
    const cur = open.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (++visited > maxNodes) return [];
    const cx = cur % W;
    const cz = (cur / W) | 0;
    for (const [dx, dz, len] of DIRS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!grid.isWalkable(nx, nz)) continue;
      if (dx && dz && (!grid.isWalkable(cx + dx, cz) || !grid.isWalkable(cx, cz + dz))) continue;
      const ni = nz * W + nx;
      if (closed[ni]) continue;
      const cost = gScore[cur]! + len * tileCost(grid, nx, nz);
      if (cost < gScore[ni]!) {
        gScore[ni] = cost;
        fScore[ni] = cost + h(ni);
        from[ni] = cur;
        open.push(ni);
      }
    }
  }
  if (from[goal] === -1 && goal !== start) return [];
  const tiles: Waypoint[] = [];
  for (let i = goal; i !== -1; i = from[i]!) {
    tiles.push({ x: (i % W) + 0.5, z: ((i / W) | 0) + 0.5 });
    if (i === start) break;
  }
  tiles.reverse();
  // Exact endpoints.
  tiles[0] = { x: sx, z: sz };
  tiles.push({ x: gx, z: gz });
  // String pulling.
  const out: Waypoint[] = [tiles[0]!];
  let a = 0;
  while (a < tiles.length - 1) {
    let b = tiles.length - 1;
    while (b > a + 1 && !lineClear(grid, tiles[a]!.x, tiles[a]!.z, tiles[b]!.x, tiles[b]!.z)) b--;
    out.push(tiles[b]!);
    a = b;
  }
  return out;
}
