/**
 * "Overgrown inheritance" pass: grandmother's fields have gone wild.
 *
 * Bridson Poisson-disk candidates over the whole basin floor, kept by a clustered noise density
 * (thick thickets + clear glades, never a uniform sprinkle). Each cluster has a biome — meadow
 * (weeds, tall grass), rocky (stones, boulders, pebbles) or woody (stumps, branches, logs, bushes,
 * near trees) — that picks the object mix from OVERGROWTH weights in data/farm-layout.ts.
 * Every object is an instance in the Nature BatchPool (1 draw call per material) and a clearable
 * TileObject for the farming tools (scythe: weeds / tall grass, pickaxe: stones, axe: wood).
 */
import { smoothstep } from '../../core/noise';
import type { Rng } from '../../core/rng';
import { HOUSE, POND, PLOT, FIELD, VIGNETTES, OVERGROWTH, HERO_TREES } from '../../data/farm-layout';
import { TileType, type TileGrid, type TileObjectKind } from '../tiles';
import type { Terrain } from '../terrain';
import type { Nature, NatureKind } from '../props/nature';
import type { FarmShape } from './paint';

type Piece = 'weedA' | 'weedB' | 'weedC' | 'tallGrass' | 'stone' | 'boulder' | 'pebbles' | 'branch' | 'stump' | 'log' | 'bush';

const PIECES: Record<Piece, { kind: NatureKind; variant?: number; tile: TileObjectKind | null; solid: boolean; hp: number; scale: [number, number] }> = {
  weedA: { kind: 'weed', variant: 0, tile: 'weed', solid: false, hp: 1, scale: [0.85, 1.2] },
  weedB: { kind: 'weed', variant: 1, tile: 'weed', solid: false, hp: 1, scale: [0.85, 1.15] },
  weedC: { kind: 'weed', variant: 2, tile: 'weed', solid: false, hp: 1, scale: [0.9, 1.2] },
  tallGrass: { kind: 'tallGrass', tile: 'weed', solid: false, hp: 1, scale: [0.85, 1.25] },
  stone: { kind: 'stone', tile: 'stone', solid: true, hp: 1, scale: [0.75, 1.25] },
  boulder: { kind: 'boulder', tile: 'boulder', solid: true, hp: 5, scale: [0.75, 1.0] },
  pebbles: { kind: 'pebbles', tile: null, solid: false, hp: 0, scale: [0.9, 1.3] },
  branch: { kind: 'branch', tile: 'twig', solid: false, hp: 1, scale: [0.85, 1.1] },
  stump: { kind: 'stump', tile: 'stump', solid: true, hp: 5, scale: [0.9, 1.15] },
  log: { kind: 'log', tile: 'stump', solid: true, hp: 5, scale: [0.85, 1.0] },
  bush: { kind: 'bush', tile: 'bush', solid: true, hp: 3, scale: [0.7, 1.0] },
};

/** Bridson Poisson-disk sampling in a rectangle. */
function poissonDisk(rng: Rng, x0: number, z0: number, x1: number, z1: number, r: number, k = 20): [number, number][] {
  const cell = r / Math.SQRT2;
  const gw = Math.ceil((x1 - x0) / cell);
  const gh = Math.ceil((z1 - z0) / cell);
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts: [number, number][] = [];
  const active: number[] = [];
  const add = (x: number, z: number): void => {
    pts.push([x, z]);
    active.push(pts.length - 1);
    grid[Math.floor((z - z0) / cell) * gw + Math.floor((x - x0) / cell)] = pts.length - 1;
  };
  add(x0 + rng.next() * (x1 - x0), z0 + rng.next() * (z1 - z0));
  while (active.length) {
    const ai = Math.floor(rng.next() * active.length);
    const [px, pz] = pts[active[ai]!]!;
    let found = false;
    for (let t = 0; t < k; t++) {
      const a = rng.next() * Math.PI * 2;
      const d = r * (1 + rng.next());
      const x = px + Math.cos(a) * d;
      const z = pz + Math.sin(a) * d;
      if (x < x0 || z < z0 || x >= x1 || z >= z1) continue;
      const gx = Math.floor((x - x0) / cell);
      const gz = Math.floor((z - z0) / cell);
      let ok = true;
      for (let j = Math.max(0, gz - 2); j <= Math.min(gh - 1, gz + 2) && ok; j++) {
        for (let i = Math.max(0, gx - 2); i <= Math.min(gw - 1, gx + 2); i++) {
          const q = grid[j * gw + i]!;
          if (q >= 0) {
            const [qx, qz] = pts[q]!;
            if ((qx - x) ** 2 + (qz - z) ** 2 < r * r) {
              ok = false;
              break;
            }
          }
        }
      }
      if (ok) {
        add(x, z);
        found = true;
        break;
      }
    }
    if (!found) active.splice(ai, 1);
  }
  return pts;
}

export interface OvergrowthResult {
  placed: number;
  byPiece: Record<string, number>;
}

export function scatterOvergrowth(rng: Rng, shape: FarmShape, terrain: Terrain, grid: TileGrid, nature: Nature): OvergrowthResult {
  const O = OVERGROWTH;
  const byPiece: Record<string, number> = {};
  let placed = 0;
  const clears = VIGNETTES.filter((v) => v.clearRadius && v.ground.length).map((v) => ({ x: v.ground[0]!.x, z: v.ground[0]!.z, r: v.clearRadius! }));
  const trees = HERO_TREES.map(([, x, z]) => ({ x, z }));
  const n = shape.noise;
  const n2 = shape.noise2;
  const pts = poissonDisk(rng.fork('poisson'), 1, 1, grid.width - 1, grid.depth - 1, O.spacing);
  const pick = (w: Readonly<Record<string, number>>): Piece => rng.weighted(Object.entries(w) as [Piece, number][]);

  for (const [x, z] of pts) {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (!grid.isWalkable(tx, tz) || grid.getType(tx, tz) !== TileType.Grass) continue;
    // Keep-outs: basin rim (cliff dressing owns it), house yard, gardens, pond, vignettes, paths.
    const bd = shape.basinDist(x, z);
    if (bd > -1.9) continue;
    if (Math.hypot((x - HOUSE.x) * 0.75, z - HOUSE.z - 1.5) < 7.2) continue;
    if (x > PLOT.x0 - 1.8 && x < PLOT.x1 + 2.8 && z > PLOT.z0 - 1.8 && z < PLOT.z1 + 3.2) continue;
    if (x > FIELD.x0 - 2.2 && x < FIELD.x1 + 3.2 && z > FIELD.z0 - 1.6 && z < FIELD.z1 + 2.4) continue;
    if (Math.hypot(x - POND.x, (z - POND.z) * 1.1) < POND.r + 1.8) continue;
    if (clears.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) continue;
    if (terrain.splatAt(x, z, 'path') > 0.02 || shape.pathDistance(x, z) < O.pathMargin) continue;
    if (shape.exitMask(x, z) > 0.1) continue;

    // Clustered density: thickets where the low-frequency noise is high, glades where it's low.
    const cl = n.fbm(x * O.clusterScale + 11, z * O.clusterScale - 7, 3) * 0.5 + 0.5;
    const detail = n2.get(x * 0.45 + 3, z * 0.45) * 0.5 + 0.5;
    let p = smoothstep(0.36, 0.66, cl) * 0.95 + detail * 0.12 - 0.08;
    // The homestead surroundings were kept a little tidier.
    p *= 0.8 + 0.2 * smoothstep(7, 12, Math.hypot(x - HOUSE.x, z - HOUSE.z - 4));
    p *= O.density / 0.32;
    if (rng.next() > p) continue;

    // Biome for this cluster.
    const nearTree = trees.some((t) => Math.hypot(t.x - x, t.z - z) < 5.5);
    const b = n.get(x * 0.06 + 200, z * 0.06 - 40);
    const biome = nearTree || b < -0.38 ? O.woody : b > 0.34 ? O.rocky : O.meadow;
    const piece = pick(biome);
    const spec = PIECES[piece];
    const occupied = !!grid.getObject(tx, tz);
    if (occupied && spec.tile) continue;
    const s = spec.scale[0] + rng.next() * (spec.scale[1] - spec.scale[0]);
    const ox = spec.solid ? tx + 0.5 + (rng.next() - 0.5) * 0.3 : x;
    const oz = spec.solid ? tz + 0.5 + (rng.next() - 0.5) * 0.3 : z;
    const y = terrain.heightAt(ox, oz);
    // Field debris uses the lighter mesh LOD (bushes / boulders): hundreds on screen at once.
    const h = nature.place(spec.kind, ox, y, oz, { scale: s, variant: spec.variant, sink: spec.kind === 'boulder' ? 0.06 : 0.02, lod: 1 });
    const extras: ReturnType<Nature['place']>[] = [];
    // Grounding: soft contact AO under solid debris; stones get a pebble skirt, stumps a moss ring.
    if (spec.solid) terrain.stampCover('ao', ox, oz, (spec.kind === 'boulder' ? 0.95 : spec.kind === 'log' ? 0.9 : 0.55) * s, 0.55);
    if (piece === 'stone' && rng.next() < 0.55) extras.push(nature.place('pebbles', ox + (rng.next() - 0.5) * 0.7, y, oz + (rng.next() - 0.5) * 0.7));
    if (piece === 'stump' || piece === 'log') terrain.stampCover('moss', ox, oz, 1.1, 0.7);
    if (piece === 'tallGrass' || piece === 'weedB') {
      // Satellite tufts make the clump read as a thicket, not a single plant.
      const m = 1 + Math.floor(rng.next() * 2);
      for (let i = 0; i < m; i++) {
        const a = rng.next() * Math.PI * 2;
        const d = 0.35 + rng.next() * 0.3;
        const sx = ox + Math.cos(a) * d;
        const sz = oz + Math.sin(a) * d;
        extras.push(nature.place('tallGrass', sx, terrain.heightAt(sx, sz), sz, { scale: 0.6 + rng.next() * 0.35 }));
      }
    }
    if (spec.tile) {
      grid.setObject(tx, tz, {
        kind: spec.tile,
        id: spec.kind,
        solid: spec.solid,
        hp: spec.hp,
        onRemove: () => {
          nature.remove(h);
          for (const e of extras) nature.remove(e);
        },
      });
    }
    byPiece[piece] = (byPiece[piece] ?? 0) + 1;
    placed++;
  }
  return { placed, byPiece };
}
