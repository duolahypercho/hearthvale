/**
 * FarmBuildings: the farm-side half of the building system — coop + barn exteriors (or their
 * construction sites), the fenced pasture, the carpenter's build board and the pet corner
 * (doghouse + bowl). Everything static is rebuilt and merged into ONE mesh per material whenever
 * the set of buildings changes (rare), so the whole compound costs a handful of draw calls.
 *
 * Placing a building clears its footprint (debris, grass, ground cover), paints a trampled dirt
 * apron at the door and marks the footprint tiles solid.
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import type { GameMap } from '../map';
import { Rng } from '../../core/rng';
import { mergeStatic } from '../geom';
import { buildFence } from '../props/structures';
import { buildCoopExterior, buildBarnExterior, buildConstruction, buildCarpenterBoard, buildDoghouse, buildBowl, buildWaterTrough, buildHayRack, COOP_SIZE, BARN_SIZE } from './models';

export type BuildingKind = 'coop' | 'barn';

/** Sites (world coords). `door` is the (solid) door tile the player faces to go in. */
export const SITES = {
  coop: { x: 39.5, z: 33.45, door: { x: 39, z: 34 }, tiles: { x0: 38, z0: 32, x1: 40, z1: 34 } },
  barn: { x: 46.5, z: 32.75, door: { x: 46, z: 34 }, tiles: { x0: 44, z0: 31, x1: 48, z1: 34 } },
  pasture: { x0: 36.5, z0: 36.2, x1: 51.5, z1: 43.5 },
  board: { x: 36.2, z: 29.7, tile: { x: 36, z: 29 } },
  doghouse: { x: 36.2, z: 16.2, rot: -0.55, tiles: [[35, 15], [36, 15], [35, 16], [36, 16]] as [number, number][] },
  bowl: { x: 34.9, z: 17.5 },
} as const;

/** Gaps in the pasture's top fence (in front of the doors). */
const GAPS: [number, number][] = [
  [38.6, 40.4],
  [45.6, 47.4],
];

const LIGHT_ONLY = new Set(['windowCard', 'lampGlow', 'stillWater', 'boxFlower']);
const DEBRIS = new Set(['weed', 'stone', 'twig', 'stump', 'boulder', 'bush', 'log', 'branch', 'pebbles']);

export class FarmBuildings {
  private group = new THREE.Group();
  private merged: THREE.Group | null = null;
  private cleared = new Set<string>();
  private bowlWater: THREE.Mesh;
  private sig = '';

  constructor(private game: Game, private map: GameMap) {
    this.group.name = 'farm-buildings';
    this.group.userData.perfTag = 'buildings';
    map.root.add(this.group);
    // Water / kibble in the pet bowl (toggled by the animal system).
    const wm = new THREE.MeshStandardMaterial({ color: 0x7ab8d8, roughness: 0.1, metalness: 0.1 });
    this.bowlWater = new THREE.Mesh(new THREE.CircleGeometry(0.14, 18).rotateX(-Math.PI / 2), wm);
    this.bowlWater.position.set(SITES.bowl.x, this.h(SITES.bowl.x, SITES.bowl.z) + 0.07, SITES.bowl.z);
    this.bowlWater.visible = false;
    this.bowlWater.name = 'bowl-water';
    this.bowlWater.userData.noAO = true;
    this.group.add(this.bowlWater);
    // Carpenter board + pet corner are always there.
    this.clearRect(SITES.board.tile.x - 1, SITES.board.tile.z - 1, SITES.board.tile.x + 1, SITES.board.tile.z, false);
    this.solid(SITES.board.tile.x, SITES.board.tile.z);
    for (const [x, z] of SITES.doghouse.tiles) {
      this.clearTile(x, z, true);
      this.solid(x, z);
    }
  }

  private h(x: number, z: number): number {
    return this.map.heightAt(x, z);
  }

  private solid(x: number, z: number, on = true): void {
    if (on) this.map.grid.setObject(x, z, { kind: 'building', id: 'farm-building', solid: true });
    else if (this.map.grid.getObject(x, z)?.id === 'farm-building') this.map.grid.setObject(x, z, null);
  }

  private clearTile(x: number, z: number, cover: boolean): void {
    const o = this.map.grid.getObject(x, z);
    if (o && (DEBRIS.has(o.kind) || DEBRIS.has(o.id))) this.map.grid.removeObject(x, z);
    else if (o && o.kind !== 'tree' && o.kind !== 'building' && o.kind !== 'crop' && o.kind !== 'prop' && o.kind !== 'fence') this.map.grid.removeObject(x, z);
    if (cover) this.map.clearGroundCover?.(x, z);
  }

  private clearRect(x0: number, z0: number, x1: number, z1: number, cover: boolean): void {
    const key = `${x0},${z0},${x1},${z1},${cover}`;
    if (this.cleared.has(key)) return;
    this.cleared.add(key);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.clearTile(x, z, cover);
  }

  /** Trampled dirt apron + contact AO under a footprint. */
  private groundWork(kind: BuildingKind): void {
    const t = this.map.terrain;
    if (!t) return;
    const s = SITES[kind];
    const size = kind === 'coop' ? COOP_SIZE : BARN_SIZE;
    t.stampCover('ao', s.x, s.z, Math.max(size.W, size.D) * 0.62, 0.8, size.D / size.W);
    t.stampCover('dry', s.x, s.z + size.D / 2 + 0.9, 1.6, 0.9, 0.6);
    const dx = s.door.x + 0.5;
    const dz = s.door.z + 1.4;
    t.paint('path', (x, z) => {
      const d = Math.hypot((x - dx) / 1.25, (z - dz) / 0.85);
      return 0.85 * (1 - THREE.MathUtils.smoothstep(d, 0.5, 1.0));
    });
    t.commitSplat();
    t.commitCover();
  }

  sync(built: Set<BuildingKind>, orders: Set<BuildingKind>): void {
    const sig = `${[...built].sort().join()}|${[...orders].sort().join()}`;
    if (sig === this.sig && this.merged) return;
    this.sig = sig;
    if (this.merged) {
      this.group.remove(this.merged);
      this.merged.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.merged = null;
    }
    const rng = new Rng('farm-buildings');
    const parts: THREE.Object3D[] = [];
    const place = (g: THREE.Object3D, x: number, z: number, rot = 0) => {
      g.position.set(x, this.h(x, z), z);
      g.rotation.y = rot;
      parts.push(g);
    };
    for (const kind of ['coop', 'barn'] as const) {
      const s = SITES[kind];
      const r = s.tiles;
      const size = kind === 'coop' ? COOP_SIZE : BARN_SIZE;
      if (built.has(kind)) {
        this.clearRect(r.x0 - 1, r.z0 - 1, r.x1 + 1, r.z1 + 2, true);
        for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) this.solid(x, z);
        // A flat pad: the building sits at the lowest corner height (plinth hides the rest).
        let y = Infinity;
        for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) y = Math.min(y, this.h(s.x + (cx * size.W) / 2, s.z + (cz * size.D) / 2));
        const g = kind === 'coop' ? buildCoopExterior(rng.fork('coop')) : buildBarnExterior(rng.fork('barn'));
        g.position.set(s.x, y - 0.04, s.z);
        parts.push(g);
        this.groundWork(kind);
      } else {
        for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) this.solid(x, z, false);
        if (orders.has(kind)) {
          this.clearRect(r.x0 - 1, r.z0 - 1, r.x1 + 1, r.z1 + 1, true);
          place(buildConstruction(rng.fork(`site-${kind}`), size.W, size.D), s.x, s.z);
        }
      }
    }
    // Pasture fence once any animal building exists.
    if (built.size) {
      this.buildPasture(rng, parts);
    }
    place(buildCarpenterBoard(rng.fork('board')), SITES.board.x, SITES.board.z, 0.25);
    place(buildDoghouse(), SITES.doghouse.x, SITES.doghouse.z, SITES.doghouse.rot);
    place(buildBowl(), SITES.bowl.x, SITES.bowl.z);
    for (const p of parts) this.group.add(p);
    this.merged = mergeStatic(parts, 'farm-buildings');
    this.merged.userData.perfTag = 'buildings';
    // Small emissive / decal batches skip the shadow + AO passes (saves ~8 draw calls).
    this.merged.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && LIGHT_ONLY.has((m.material as THREE.Material).name)) {
        m.castShadow = false;
        m.userData.noAO = true;
      }
    });
    for (const p of parts) this.group.remove(p);
    this.group.add(this.merged);
  }

  private buildPasture(rng: Rng, parts: THREE.Object3D[]): void {
    const p = SITES.pasture;
    this.clearRect(Math.floor(p.x0), Math.floor(p.z0), Math.floor(p.x1), Math.floor(p.z1), false);
    // The field oak in the middle of the paddock is felled for grazing (and so the barn reads).
    for (let z = Math.floor(p.z0); z <= Math.floor(p.z1); z++)
      for (let x = Math.floor(p.x0); x <= Math.floor(p.x1); x++) if (this.map.grid.getObject(x, z)?.kind === 'tree') this.map.grid.removeObject(x, z);
    const pts = (a: [number, number], b: [number, number]): [number, number][] => {
      const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.9));
      return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as [number, number]);
    };
    const runs: [number, number][][] = [];
    // Top edge with gaps at the doors
    let x: number = p.x0;
    for (const [g0, g1] of GAPS) {
      runs.push(pts([x, p.z0], [g0, p.z0]));
      x = g1;
    }
    runs.push(pts([x, p.z0], [p.x1, p.z0]));
    runs.push(pts([p.x1, p.z0], [p.x1, p.z1]));
    runs.push(pts([p.x1, p.z1], [p.x0, p.z1]));
    runs.push(pts([p.x0, p.z1], [p.x0, p.z0]));
    const fence = buildFence(runs, (fx, fz) => this.h(fx, fz), rng.fork('pasture-fence'));
    parts.push(fence);
    // Paddock furniture: a log water trough along the east fence, a hay rack + salt lick in the west.
    const furn: [THREE.Object3D, number, number, number, [number, number][]][] = [
      [buildWaterTrough(), p.x1 - 1.0, p.z0 + 2.6, Math.PI / 2, [[50, 37], [50, 38], [50, 39]]],
      [buildHayRack(rng.fork('hay-rack')), p.x0 + 1.9, p.z1 - 1.5, 0.12, [[38, 41], [38, 42], [39, 41], [39, 42]]],
    ];
    for (const [g, fx, fz, rot, tiles] of furn) {
      g.position.set(fx, this.h(fx, fz) - 0.02, fz);
      g.rotation.y = rot;
      parts.push(g);
      for (const [tx, tz] of tiles) this.map.grid.setObject(tx, tz, { kind: 'prop', id: 'pasture-prop', solid: true });
    }
    // Fence tiles block (animals stay in, the player walks through the gaps)
    const inGap = (fx: number) => GAPS.some(([a, b]) => fx > a - 0.2 && fx < b + 0.2);
    for (let tx = Math.floor(p.x0); tx <= Math.floor(p.x1); tx++) {
      if (!inGap(tx + 0.5)) this.map.grid.setObject(tx, Math.floor(p.z0), { kind: 'fence', id: 'pasture-fence', solid: true });
      this.map.grid.setObject(tx, Math.floor(p.z1), { kind: 'fence', id: 'pasture-fence', solid: true });
    }
    for (let tz = Math.floor(p.z0); tz <= Math.floor(p.z1); tz++) {
      this.map.grid.setObject(Math.floor(p.x0), tz, { kind: 'fence', id: 'pasture-fence', solid: true });
      this.map.grid.setObject(Math.floor(p.x1), tz, { kind: 'fence', id: 'pasture-fence', solid: true });
    }
    const t = this.map.terrain;
    if (t) {
      // Grazed, trampled meadow inside; a worn track through each gate.
      t.paintCover('dry', (fx, fz) => (fx > p.x0 && fx < p.x1 && fz > p.z0 && fz < p.z1 ? 0.25 + 0.2 * Math.sin(fx * 0.9 + Math.sin(fz * 1.3) * 2) : 0), { x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z1 });
      for (const [g0, g1] of GAPS) t.stampCover('dry', (g0 + g1) / 2, p.z0 + 0.3, 1.4, 0.8, 0.8);
      t.commitCover();
    }
  }

  isBoard(x: number, z: number): boolean {
    return x === SITES.board.tile.x && z === SITES.board.tile.z;
  }

  setBowl(full: boolean): void {
    this.bowlWater.visible = full;
  }

  update(_dt: number, _game: Game): void {}
}
