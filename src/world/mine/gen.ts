/**
 * Seeded mine-floor generator (pure logic, no three.js): cellular-automata caverns carved from
 * solid rock, the largest connected chamber kept, spurs eroded and 1-wide squeezes widened so
 * the diorama camera always reads the space. Then gameplay + set dressing is placed on it:
 * ladder-up (against a north wall so it reads as a cliff-face ladder), an elevator every 5
 * floors, breakable rocks clustered by noise with ore rolled from the biome table, monsters
 * spawned away from the arrival point, crystals / timber shoring / mushrooms / lava channels /
 * frozen pools / basalt columns per biome, and up to 5 accent light sources spread apart.
 */
import { Rng } from '../../core/rng';
import { Noise2D } from '../../core/noise';
import { BIOMES, ELEVATOR_EVERY, ORE_STYLE, biomeForFloor, tierForFloor, type Biome, type MonsterKind, type OreId } from './biomes';

export interface RockSpec {
  x: number;
  z: number;
  ore: OreId | null;
  big: boolean;
  /** Hits to break. */
  hp: number;
  /** Visual seed. */
  seed: number;
}

export type DecorKind =
  | 'post'
  | 'lanternPost'
  | 'cart'
  | 'rail'
  | 'crate'
  | 'barrel'
  | 'mushrooms'
  | 'stalagmite'
  | 'bones'
  | 'icicles'
  | 'snowdrift'
  | 'iceSpike'
  | 'basalt'
  | 'vent'
  | 'pickStand';

export interface DecorSpec {
  kind: DecorKind;
  x: number;
  z: number;
  rot: number;
  scale: number;
  /** Blocks its tile. */
  solid: boolean;
}

export interface CrystalSpec {
  x: number;
  z: number;
  rot: number;
  scale: number;
  color: number;
}

export interface LightSpec {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  distance: number;
  flicker: number;
}

export interface FloorLayout {
  floor: number;
  biome: Biome;
  tier: number;
  w: number;
  d: number;
  /** 1 = rock wall. */
  solid: Uint8Array;
  /** 1 = lava (impassable liquid). */
  lava: Uint8Array;
  /** 1 = shallow puddle / frozen pool (walkable, decorative). */
  pool: Uint8Array;
  /** Wall tile the ladder-up leans on; the player arrives on the tile south of it. */
  ladderUp: { x: number; z: number };
  spawn: { x: number; z: number };
  elevator: { x: number; z: number } | null;
  /** Milestone treasure chest (floors 10, 20, 30, …): reforges the sword. */
  chest: { x: number; z: number } | null;
  rocks: RockSpec[];
  monsters: { kind: MonsterKind; x: number; z: number }[];
  crystals: CrystalSpec[];
  decor: DecorSpec[];
  lights: LightSpec[];
  /** BFS distance (tiles) from the spawn over walkable floor (-1 = unreachable). */
  dist: Int16Array;
}

export const FLOOR_W = 40;
export const FLOOR_D = 32;

const N8 = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;
const N4 = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

export function generateFloor(floor: number, seed: number): FloorLayout {
  const W = FLOOR_W;
  const D = FLOOR_D;
  const biome = biomeForFloor(floor);
  const def = BIOMES[biome];
  const tier = tierForFloor(floor);
  const rng = new Rng((seed ^ Math.imul(floor + 1, 0x9e3779b1)) >>> 0);
  const noise = new Noise2D(rng.int(0, 1e9));
  const idx = (x: number, z: number): number => z * W + x;
  const inb = (x: number, z: number): boolean => x >= 0 && z >= 0 && x < W && z < D;

  let solid = new Uint8Array(W * D);
  // ── caverns ─────────────────────────────────────────────────────
  for (let attempt = 0; attempt < 10; attempt++) {
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const border = x < 2 || z < 2 || x >= W - 2 || z >= D - 2;
        // Big-chamber bias: low-frequency noise opens halls, the rim stays rockier.
        const edge = Math.min(x, z, W - 1 - x, D - 1 - z);
        const bias = noise.fbm(x * 0.09 + attempt * 7, z * 0.09, 2) * 0.16 - (edge < 4 ? -0.08 : 0.04);
        solid[idx(x, z)] = border || rng.next() < 0.46 + bias ? 1 : 0;
      }
    }
    for (let it = 0; it < 6; it++) {
      const next = new Uint8Array(W * D);
      for (let z = 0; z < D; z++) {
        for (let x = 0; x < W; x++) {
          if (x < 2 || z < 2 || x >= W - 2 || z >= D - 2) {
            next[idx(x, z)] = 1;
            continue;
          }
          let n = 0;
          for (const [dx, dz] of N8) if (!inb(x + dx, z + dz) || solid[idx(x + dx, z + dz)]) n++;
          const s = solid[idx(x, z)]!;
          next[idx(x, z)] = n >= 5 || (it < 2 && n <= 0) ? 1 : n <= 3 ? 0 : s;
        }
      }
      solid = next;
    }
    keepLargest(solid, W, D);
    let open = 0;
    for (let i = 0; i < W * D; i++) if (!solid[i]) open++;
    const frac = open / ((W - 4) * (D - 4));
    if (frac > 0.4 && frac < 0.7) break;
  }
  // Erode spurs and single-tile pillars; widen 1-tile squeezes (the camera needs room).
  for (let pass = 0; pass < 2; pass++) {
    for (let z = 2; z < D - 2; z++) {
      for (let x = 2; x < W - 2; x++) {
        const i = idx(x, z);
        if (solid[i]) {
          let n4 = 0;
          for (const [dx, dz] of N4) if (solid[idx(x + dx, z + dz)]) n4++;
          if (n4 <= 1) solid[i] = 0;
        } else {
          if (solid[idx(x - 1, z)] && solid[idx(x + 1, z)]) {
            const xx = x + (rng.next() < 0.5 ? -1 : 1);
            if (xx > 2 && xx < W - 3) solid[idx(xx, z)] = 0;
          }
          if (solid[idx(x, z - 1)] && solid[idx(x, z + 1)]) {
            const zz = z + (rng.next() < 0.5 ? -1 : 1);
            if (zz > 2 && zz < D - 3) solid[idx(x, zz)] = 0;
          }
        }
      }
    }
  }
  keepLargest(solid, W, D);

  // ── arrival: ladder against a north wall, up-left-ish ────────────
  const open = (x: number, z: number): boolean => inb(x, z) && !solid[idx(x, z)];
  const target = { x: W * (0.2 + rng.next() * 0.25), z: D * (0.2 + rng.next() * 0.2) };
  let best: { x: number; z: number; s: number } | null = null;
  for (let z = 3; z < D - 4; z++) {
    for (let x = 3; x < W - 3; x++) {
      if (!solid[idx(x, z - 1)] || !open(x, z) || !open(x, z + 1) || !open(x - 1, z) || !open(x + 1, z) || !open(x, z + 2) || !open(x - 1, z + 1) || !open(x + 1, z + 1)) continue;
      const s = Math.hypot(x - target.x, z - target.z) + rng.next() * 2;
      if (!best || s < best.s) best = { x, z, s };
    }
  }
  if (!best) {
    // Degenerate cave: carve an arrival pocket.
    best = { x: 8, z: 6, s: 0 };
    for (let z = 5; z <= 9; z++) for (let x = 6; x <= 10; x++) solid[idx(x, z)] = 0;
    solid[idx(8, 4)] = 1;
  }
  const ladderUp = { x: best.x, z: best.z - 1 };
  const spawn = { x: best.x + 0.5, z: best.z + 1.5 };

  const lava = new Uint8Array(W * D);
  const pool = new Uint8Array(W * D);
  const reserved = new Uint8Array(W * D);
  const reserve = (x: number, z: number, r = 0): void => {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (inb(x + dx, z + dz)) reserved[idx(x + dx, z + dz)] = 1;
  };
  reserve(best.x, best.z, 1);
  reserve(best.x, best.z + 2, 1);

  // ── elevator every 5 floors ─────────────────────────────────────
  let elevator: { x: number; z: number } | null = null;
  if (floor % ELEVATOR_EVERY === 0) {
    let eb: { x: number; z: number; s: number } | null = null;
    for (let z = 3; z < D - 3; z++) {
      for (let x = 3; x < W - 3; x++) {
        if (!solid[idx(x, z - 1)] || !open(x, z) || !open(x, z + 1) || !open(x - 1, z) || !open(x + 1, z) || reserved[idx(x, z)]) continue;
        const d = Math.hypot(x - best.x, z - best.z);
        if (d < 3.5) continue;
        const s = Math.abs(d - 5) + rng.next();
        if (!eb || s < eb.s) eb = { x, z, s };
      }
    }
    if (eb) {
      elevator = { x: eb.x, z: eb.z };
      reserve(eb.x, eb.z, 1);
      reserve(eb.x, eb.z + 1, 0);
    }
  }

  // ── milestone chest every 10 floors: a few steps from the arrival, in open floor ─────
  let chest: { x: number; z: number } | null = null;
  if (floor % 10 === 0) {
    let cb: { x: number; z: number; s: number } | null = null;
    for (let z = 3; z < D - 3; z++)
      for (let x = 3; x < W - 3; x++) {
        if (reserved[idx(x, z)]) continue;
        let ok = true;
        for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1 && ok; dx++) if (!open(x + dx, z + dz) || reserved[idx(x + dx, z + dz)]) ok = false;
        if (!ok) continue;
        const d = Math.hypot(x - spawn.x, z - spawn.z);
        if (d < 2.5) continue;
        // Open floor towards the camera (south) and to the west (where the farmer stands to open
        // it), a wall a few tiles north as a backdrop.
        let southOpen = true;
        for (let dz = 2; dz <= 4 && southOpen; dz++) for (let dx = -2; dx <= 1 && southOpen; dx++) if (!open(x + dx, z + dz)) southOpen = false;
        if (!southOpen || !open(x - 2, z)) continue;
        let wallN = 3;
        for (let dz = 2; dz <= 5; dz++) if (!open(x, z - dz)) {
          wallN = 0;
          break;
        }
        const sc = Math.abs(d - 4.5) * 0.6 + wallN + rng.next() * 0.5;
        if (!cb || sc < cb.s) cb = { x, z, s: sc };
      }
    if (cb) {
      chest = { x: cb.x, z: cb.z };
      reserve(cb.x, cb.z, 1);
    }
  }

  // ── liquids ─────────────────────────────────────────────────────
  const floorCount = (): number => {
    let n = 0;
    for (let i = 0; i < W * D; i++) if (!solid[i] && !lava[i]) n++;
    return n;
  };
  if (biome === 'lava') {
    // Molten channels (2 wide, meandering) + a pooled basin; a channel that would cut the cave in
    // two gets basalt bridges punched through it, and is only dropped if that still fails.
    const reachable = (): number => {
      const reach = bfs(solid, lava, W, D, Math.floor(spawn.x), Math.floor(spawn.z));
      let n = 0;
      for (let i = 0; i < W * D; i++) if (reach[i]! >= 0) n++;
      return n;
    };
    const paint = (px: number, pz: number): void => {
      if (!inb(px, pz) || solid[idx(px, pz)] || reserved[idx(px, pz)]) return;
      if (Math.hypot(px - spawn.x, pz - spawn.z) < 4 || (elevator && Math.hypot(px - elevator.x, pz - elevator.z) < 3)) return;
      lava[idx(px, pz)] = 1;
    };
    const channels = 2 + rng.int(0, 1);
    for (let c = 0; c <= channels; c++) {
      const snap = lava.slice();
      const path: [number, number][] = [];
      let x = rng.int(6, W - 7);
      let z = rng.int(5, D - 6);
      if (c === channels) {
        // Basin: a lumpy molten pool.
        const rx = 1.8 + rng.next() * 1.6;
        const rz = rx * (0.6 + rng.next() * 0.3);
        for (let pz = Math.floor(z - rz - 1); pz <= z + rz + 1; pz++)
          for (let px = Math.floor(x - rx - 1); px <= x + rx + 1; px++) {
            const d = Math.hypot((px + 0.5 - x) / rx, (pz + 0.5 - z) / rz) + noise.get(px * 0.6, pz * 0.6) * 0.35;
            if (d < 1) paint(px, pz);
          }
      } else {
        let a = rng.next() * Math.PI * 2;
        const len = 14 + rng.int(0, 12);
        for (let st = 0; st < len; st++) {
          a += (rng.next() - 0.5) * 0.8;
          x += Math.cos(a);
          z += Math.sin(a) * 0.8;
          const tx = Math.round(x);
          const tz = Math.round(z);
          path.push([tx, tz]);
          const wdt = rng.next() < 0.75 ? 1 : 0;
          for (let dz = 0; dz <= wdt; dz++) for (let dx = 0; dx <= wdt; dx++) paint(tx + dx, tz + dz);
        }
      }
      const want = floorCount() * 0.93;
      if (reachable() >= want) continue;
      // Bridges at thirds of the channel.
      for (const f of [0.33, 0.66, 0.5, 0.15, 0.85]) {
        const pt = path[Math.floor(f * (path.length - 1))];
        if (!pt) continue;
        for (let dz = -2; dz <= 2; dz++) for (let dx = -1; dx <= 2; dx++) if (inb(pt[0] + dx, pt[1] + dz) && Math.abs(dx - 0.5) + Math.abs(dz) < 2.6) lava[idx(pt[0] + dx, pt[1] + dz)] = 0;
        if (reachable() >= floorCount() * 0.93) break;
      }
      if (reachable() < floorCount() * 0.93) lava.set(snap);
    }
  } else {
    // Puddles (earth) / frozen pools (ice): walkable decoration.
    const pools = biome === 'ice' ? 3 + rng.int(0, 2) : 1 + rng.int(0, 2);
    for (let p = 0; p < pools; p++) {
      const cx = rng.int(4, W - 5);
      const cz = rng.int(4, D - 5);
      const rx = 1.2 + rng.next() * (biome === 'ice' ? 2.6 : 1.4);
      const rz = rx * (0.6 + rng.next() * 0.4);
      for (let z = Math.floor(cz - rz - 1); z <= cz + rz + 1; z++) {
        for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
          if (!inb(x, z) || solid[idx(x, z)] || reserved[idx(x, z)]) continue;
          const d = Math.hypot((x + 0.5 - cx) / rx, (z + 0.5 - cz) / rz) + noise.get(x * 0.5, z * 0.5) * 0.3;
          if (d < 1) pool[idx(x, z)] = 1;
        }
      }
    }
  }

  const dist = bfs(solid, lava, W, D, Math.floor(spawn.x), Math.floor(spawn.z));
  const isFloor = (x: number, z: number): boolean => inb(x, z) && !solid[idx(x, z)] && !lava[idx(x, z)];
  const wallAdj = (x: number, z: number): number => {
    let n = 0;
    for (const [dx, dz] of N4) if (inb(x + dx, z + dz) && solid[idx(x + dx, z + dz)]) n++;
    return n;
  };
  const taken = new Uint8Array(W * D);
  for (let i = 0; i < W * D; i++) if (reserved[i]) taken[i] = 1;

  // ── set dressing ───────────────────────────────────────────────
  const decor: DecorSpec[] = [];
  const crystals: CrystalSpec[] = [];
  const lightSources: (LightSpec & { w: number })[] = [];
  const addDecor = (kind: DecorKind, x: number, z: number, rot: number, scale: number, solidTile: boolean): void => {
    decor.push({ kind, x, z, rot, scale, solid: solidTile });
    if (solidTile) taken[idx(Math.floor(x), Math.floor(z))] = 1;
  };

  // Wall-edge candidates: floor tile with a wall to the N / E / W (faces the camera or the side).
  const edges: { x: number; z: number; dir: number }[] = [];
  for (let z = 2; z < D - 2; z++) {
    for (let x = 2; x < W - 2; x++) {
      if (!isFloor(x, z) || reserved[idx(x, z)] || pool[idx(x, z)]) continue;
      if (solid[idx(x, z - 1)]) edges.push({ x, z, dir: 0 });
      else if (solid[idx(x - 1, z)]) edges.push({ x, z, dir: 1 });
      else if (solid[idx(x + 1, z)]) edges.push({ x, z, dir: 2 });
    }
  }
  rng.shuffle(edges);
  const spaced = (list: { x: number; z: number }[], x: number, z: number, min: number): boolean => list.every((p) => Math.hypot(p.x - x, p.z - z) >= min);

  // Crystals hug the walls.
  const crystalPts: { x: number; z: number }[] = [];
  for (const e of edges) {
    if (crystals.length >= def.crystalCount) break;
    if (!spaced(crystalPts, e.x, e.z, biome === 'ice' ? 2.4 : 3.1) || Math.hypot(e.x - spawn.x, e.z - spawn.z) < 2.5) continue;
    crystalPts.push(e);
    const ox = e.dir === 1 ? -0.42 : e.dir === 2 ? 0.42 : (rng.next() - 0.5) * 0.4;
    const oz = e.dir === 0 ? -0.4 : (rng.next() - 0.5) * 0.4;
    const color = rng.pick(def.crystals);
    const scale = (biome === 'ice' ? 1.0 + rng.next() * 0.8 : 0.7 + rng.next() * 0.5) * (tier ? 1.1 : 1);
    const rot = e.dir === 0 ? 0 : e.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
    crystals.push({ x: e.x + 0.5 + ox, z: e.z + 0.5 + oz, rot, scale, color });
    taken[idx(e.x, e.z)] = 1;
    lightSources.push({ x: e.x + 0.5 + ox * 0.6, y: 1.25 * scale, z: e.z + 0.5 + oz * 0.6 + 0.3, color, intensity: biome === 'ice' ? 5.5 : 4.2, distance: 6.5, flicker: 0, w: scale });
  }

  if (biome === 'earth') {
    // Timber shoring against the walls, a lantern on every other post.
    const posts: { x: number; z: number }[] = [];
    let lanternToggle = rng.next() < 0.5;
    for (const e of edges) {
      if (posts.length >= 7) break;
      if (taken[idx(e.x, e.z)] || !spaced(posts, e.x, e.z, 5) || !spaced(crystalPts, e.x, e.z, 2)) continue;
      posts.push(e);
      const rot = e.dir === 0 ? 0 : e.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
      const ox = e.dir === 1 ? -0.3 : e.dir === 2 ? 0.3 : 0;
      const oz = e.dir === 0 ? -0.3 : 0;
      lanternToggle = !lanternToggle;
      addDecor(lanternToggle ? 'lanternPost' : 'post', e.x + 0.5 + ox, e.z + 0.5 + oz, rot, 1, true);
      if (lanternToggle) lightSources.push({ x: e.x + 0.5 + ox * 0.2 + (e.dir === 0 ? 0 : 0), y: 1.7, z: e.z + 0.5 + oz * 0.2 + 0.35, color: 0xffa04a, intensity: 9, distance: 7.5, flicker: 1, w: 1.4 });
    }
    // Minecart on rails running away from the arrival point.
    const railDir = rng.next() < 0.5 ? 1 : -1;
    const rz = Math.floor(spawn.z) + 1;
    let len = 0;
    for (let k = 1; k < 12; k++) {
      const x = Math.floor(spawn.x) + railDir * k;
      if (!isFloor(x, rz) || pool[idx(x, rz)]) break;
      len = k;
    }
    if (len >= 4) {
      for (let k = 1; k <= len; k++) {
        const x = Math.floor(spawn.x) + railDir * k;
        decor.push({ kind: 'rail', x: x + 0.5, z: rz + 0.5, rot: 0, scale: 1, solid: false });
        taken[idx(x, rz)] = 1;
      }
      const cx = Math.floor(spawn.x) + railDir * Math.min(len, 3 + rng.int(0, 2));
      addDecor('cart', cx + 0.5, rz + 0.5, 0, 1, true);
    }
    // Glowcap mushrooms in damp corners.
    let mush = 0;
    for (const e of edges) {
      if (mush >= 6) break;
      if (taken[idx(e.x, e.z)] || wallAdj(e.x, e.z) < 2 || Math.hypot(e.x - spawn.x, e.z - spawn.z) < 4) continue;
      addDecor('mushrooms', e.x + 0.5, e.z + 0.5, rng.next() * 6, 0.8 + rng.next() * 0.5, false);
      taken[idx(e.x, e.z)] = 1;
      mush++;
      if (mush % 2 === 1) lightSources.push({ x: e.x + 0.5, y: 0.5, z: e.z + 0.6, color: 0x5affc0, intensity: 2.2, distance: 4, flicker: 0, w: 0.6 });
    }
  }

  // Crates / barrels (+ a pick stand) near the arrival: somebody worked here once.
  if (biome !== 'lava' || rng.next() < 0.5) {
    const around: [number, number][] = [
      [-2, 0],
      [2, 0],
      [-2, 1],
      [2, 1],
      [-1, -0],
      [1, -0],
    ];
    rng.shuffle(around);
    let placed = 0;
    for (const [dx, dz] of around) {
      const x = best.x + dx;
      const z = best.z + dz;
      if (placed >= 2 || !isFloor(x, z) || taken[idx(x, z)] || pool[idx(x, z)] || (dx === 0 && dz <= 1)) continue;
      if (Math.abs(dx) < 2 && dz === 0) continue;
      addDecor(placed === 0 ? (biome === 'earth' ? 'crate' : 'barrel') : 'barrel', x + 0.5 + (rng.next() - 0.5) * 0.2, z + 0.5 + (rng.next() - 0.5) * 0.2, rng.next() * 6, 1, true);
      placed++;
    }
  }

  // Stalagmites / ice spikes / basalt columns: solid silhouettes that break up the halls.
  const spikeKind: DecorKind = biome === 'earth' ? 'stalagmite' : biome === 'ice' ? 'iceSpike' : 'basalt';
  const spikeN = biome === 'lava' ? 8 : 6;
  let spikes = 0;
  for (const e of edges) {
    if (spikes >= spikeN) break;
    if (taken[idx(e.x, e.z)] || pool[idx(e.x, e.z)] || Math.hypot(e.x - spawn.x, e.z - spawn.z) < 4 || (dist[idx(e.x, e.z)] ?? -1) < 0) continue;
    if (elevator && Math.hypot(e.x - elevator.x, e.z - elevator.z) < 2.5) continue;
    // Only where it can't seal a corridor: 2+ wall neighbours already.
    if (wallAdj(e.x, e.z) < 2) continue;
    addDecor(spikeKind, e.x + 0.5 + (rng.next() - 0.5) * 0.2, e.z + 0.5 + (rng.next() - 0.5) * 0.2, rng.next() * 6, 0.8 + rng.next() * 0.5, true);
    spikes++;
  }
  if (biome === 'ice') {
    // Icicles hang off the tops of the north cliff faces; snow drifts pile at wall feet.
    let n = 0;
    for (const e of edges) {
      if (e.dir !== 0 || n > 14) continue;
      decor.push({ kind: 'icicles', x: e.x + 0.5, z: e.z + 0.05, rot: 0, scale: 0.8 + rng.next() * 0.5, solid: false });
      n++;
    }
    let s = 0;
    for (const e of edges) {
      if (s > 10 || taken[idx(e.x, e.z)]) continue;
      decor.push({ kind: 'snowdrift', x: e.x + 0.5, z: e.z + 0.4, rot: rng.next() * 6, scale: 0.8 + rng.next() * 0.6, solid: false });
      s++;
    }
  }
  if (biome === 'lava') {
    let v = 0;
    for (const e of edges) {
      if (v >= 3 || taken[idx(e.x, e.z)] || Math.hypot(e.x - spawn.x, e.z - spawn.z) < 5) continue;
      addDecor('vent', e.x + 0.5, e.z + 0.5, rng.next() * 6, 1, true);
      v++;
    }
    // Lava light pools: sample channel tiles.
    const lavaTiles: { x: number; z: number }[] = [];
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (lava[idx(x, z)]) lavaTiles.push({ x, z });
    rng.shuffle(lavaTiles);
    const picked: { x: number; z: number }[] = [];
    for (const t of lavaTiles) {
      if (!spaced(picked, t.x, t.z, 5)) continue;
      picked.push(t);
      lightSources.push({ x: t.x + 0.5, y: 1.1, z: t.z + 0.5, color: 0xff6a24, intensity: 3.6, distance: 6.5, flicker: 0.5, w: 3 });
    }
  }
  if (biome === 'earth') {
    let b = 0;
    for (const e of edges) {
      if (b >= 2 || taken[idx(e.x, e.z)] || rng.next() < 0.7) continue;
      decor.push({ kind: 'bones', x: e.x + 0.5, z: e.z + 0.5, rot: rng.next() * 6, scale: 1, solid: false });
      taken[idx(e.x, e.z)] = 1;
      b++;
    }
  }

  // ── breakable rocks ─────────────────────────────────────────────
  const rocks: RockSpec[] = [];
  const depthInBand = ((floor - 1) % 10) / 9;
  const oreTable = oreTableFor(floor, def.ores, depthInBand, tier);
  for (let z = 2; z < D - 2; z++) {
    for (let x = 2; x < W - 2; x++) {
      const i = idx(x, z);
      if (!isFloor(x, z) || taken[i] || reserved[i] || pool[i]) continue;
      const ds = dist[i]!;
      if (ds < 0 || ds < 3) continue;
      if (elevator && Math.hypot(x - elevator.x, z - elevator.z) < 2) continue;
      const cl = noise.fbm(x * 0.16 + 31, z * 0.16 - 7, 2);
      const p = 0.13 + Math.max(0, cl) * 1.05 + wallAdj(x, z) * 0.07;
      if (rng.next() > p) continue;
      let ore = rng.weighted(oreTable);
      // Ore veins cluster: a neighbour's ore is contagious.
      const left = rocks.find((r) => (r.x === x - 1 && r.z === z) || (r.x === x && r.z === z - 1));
      if (left?.ore && rng.next() < 0.35) ore = left.ore;
      const big = !ore && rng.next() < 0.1;
      const oreHp = ore ? ({ copperOre: 1, ironOre: 2, goldOre: 3, coal: 1 } as Record<string, number>)[ore] ?? 2 : 0;
      rocks.push({ x, z, ore, big, hp: 1 + (big ? 2 : 0) + oreHp + tier + (biome === 'lava' ? 1 : biome === 'ice' ? 0 : 0), seed: rng.int(0, 1e6) });
      taken[i] = 1;
    }
  }

  // Blue-noise thinning: drop ~30 % of the cluster tiles, crowded interiors first, so clusters
  // get ragged edges and gaps (ore survives a little more often: it is the reward).
  {
    const at = new Map<number, RockSpec>();
    for (const r of rocks) at.set(idx(r.x, r.z), r);
    const order = rocks.slice();
    rng.shuffle(order);
    for (const r of order) {
      let n8 = 0;
      for (const [dx, dz] of N8) if (at.has(idx(r.x + dx, r.z + dz))) n8++;
      const p = Math.min(0.55, 0.08 + n8 * 0.065) * (r.ore ? 0.65 : 1);
      if (rng.next() < p) {
        at.delete(idx(r.x, r.z));
        taken[idx(r.x, r.z)] = 0;
      }
    }
    for (let i = rocks.length - 1; i >= 0; i--) if (!at.has(idx(rocks[i]!.x, rocks[i]!.z))) rocks.splice(i, 1);
  }

  // ── monsters ───────────────────────────────────────────────────
  const monsters: { kind: MonsterKind; x: number; z: number }[] = [];
  const count = Math.min(12, 3 + Math.floor(((floor - 1) % 10) * 0.5) + tier * 2 + (floor >= 3 ? 1 : 0));
  const spots: { x: number; z: number }[] = [];
  // Never on a tile within 1.5 tiles of rock or lava (the shell's foot and the lava lip wander into
  // the edge tiles: a monster there reads as half-buried in the wall).
  const roomy = (x: number, z: number): boolean => {
    for (const [dx, dz] of N8) if (!isFloor(x + dx, z + dz)) return false;
    return true;
  };
  for (let z = 2; z < D - 2; z++) for (let x = 2; x < W - 2; x++) if (isFloor(x, z) && !taken[idx(x, z)] && dist[idx(x, z)]! >= 7 && roomy(x, z)) spots.push({ x, z });
  rng.shuffle(spots);
  const mTable = def.monsters.filter(([k]) => k !== 'crab' || floor >= 4);
  for (const s of spots) {
    if (monsters.length >= count) break;
    if (!spaced(monsters, s.x + 0.5, s.z + 0.5, 3)) continue;
    monsters.push({ kind: rng.weighted(mTable), x: s.x + 0.5, z: s.z + 0.5 });
  }

  // ── pebble scatter (non-solid set dressing) is done by the mesh builder from the noise ──

  // ── accent lights: farthest-point pick, strongest first ─────────
  lightSources.sort((a, b) => b.w - a.w);
  const lights: LightSpec[] = [];
  for (const l of lightSources) {
    if (lights.length >= 5) break;
    if (!spaced(lights, l.x, l.z, 5.5)) continue;
    lights.push({ x: l.x, y: l.y, z: l.z, color: l.color, intensity: l.intensity, distance: l.distance, flicker: l.flicker });
  }

  return { floor, biome, tier, w: W, d: D, solid, lava, pool, ladderUp, spawn, elevator, chest, rocks, monsters, crystals, decor, lights, dist };
}

/**
 * Floor-gated ore weights: copper (+ coal / quartz) on floors 1–4, iron from 5, gold from 21, and
 * gems kept to ≤ 2 % of rolls above floor 10 (a gem up there is an event, not a pocketful).
 * Richer deeper in each band and on the repeat tiers.
 */
export function oreTableFor(floor: number, ores: [OreId | null, number][], depthInBand: number, tier: number): (readonly [OreId | null, number])[] {
  const gate = (o: OreId): boolean => {
    if (tier > 0) return true;
    if (o === 'ironOre') return floor >= 5;
    if (o === 'goldOre') return floor >= 21;
    return true;
  };
  const rows = ores.filter(([o]) => o === null || gate(o)).map(([o, w]) => [o, o === null ? w * (1 - depthInBand * 0.25) : w * (1 + depthInBand * 0.4 + tier * 0.3)] as [OreId | null, number]);
  if (floor < 10 && tier === 0) {
    const isGem = (o: OreId | null): boolean => o !== null && o !== 'quartz' && ORE_STYLE[o].kind === 'gem';
    const total = rows.reduce((a, [, w]) => a + w, 0);
    const gems = rows.filter(([o]) => isGem(o)).reduce((a, [, w]) => a + w, 0);
    const cap = total * 0.02;
    if (gems > cap) for (const r of rows) if (isGem(r[0])) r[1] *= cap / gems;
  }
  return rows;
}

/** Keep only the largest 4-connected open region (others become rock). */
function keepLargest(solid: Uint8Array, W: number, D: number): void {
  const label = new Int32Array(W * D).fill(-1);
  let bestLabel = -1;
  let bestSize = 0;
  let cur = 0;
  const stack: number[] = [];
  for (let i = 0; i < W * D; i++) {
    if (solid[i] || label[i]! >= 0) continue;
    let size = 0;
    stack.push(i);
    label[i] = cur;
    while (stack.length) {
      const j = stack.pop()!;
      size++;
      const x = j % W;
      const z = (j / W) | 0;
      for (const [dx, dz] of N4) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
        const k = nz * W + nx;
        if (solid[k] || label[k]! >= 0) continue;
        label[k] = cur;
        stack.push(k);
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = cur;
    }
    cur++;
  }
  for (let i = 0; i < W * D; i++) if (!solid[i] && label[i] !== bestLabel) solid[i] = 1;
}

/** 4-connected BFS distance over walkable tiles (not rock, not lava). */
export function bfs(solid: Uint8Array, lava: Uint8Array, W: number, D: number, sx: number, sz: number): Int16Array {
  const dist = new Int16Array(W * D).fill(-1);
  const q: number[] = [];
  const s = sz * W + sx;
  if (solid[s] || lava[s]) return dist;
  dist[s] = 0;
  q.push(s);
  for (let h = 0; h < q.length; h++) {
    const j = q[h]!;
    const x = j % W;
    const z = (j / W) | 0;
    for (const [dx, dz] of N4) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
      const k = nz * W + nx;
      if (solid[k] || lava[k] || dist[k]! >= 0) continue;
      dist[k] = dist[j]! + 1;
      q.push(k);
    }
  }
  return dist;
}
