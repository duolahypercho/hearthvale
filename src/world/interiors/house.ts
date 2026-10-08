/**
 * Grandmother Rosalind's farmhouse, inside: one warm open room.
 *
 *   back-left   kitchen: sage cabinets + butcher-block counter, apron sink under the window, open
 *               shelves of preserves, cast-iron cookstove with a kettle, hanging copper pots, hutch
 *   left        dining table under a pendant lamp, bookshelf, fiddle-leaf fig
 *   back-centre stone hearth: animated fire + sparks + flicker light + glow pool, mantel clock,
 *               candles, framed photos, the "Hearth & Home" sampler; braided rug, armchair,
 *               rocking chair with knitting, pendulum wall clock
 *   back-right  quilted bed under the east window (morning light falls across the quilt),
 *               nightstand lamp, grandmother's photo wall, wardrobe, blanket chest
 *   front       woven runner up a clear door lane; mudroom nooks along the knee wall either side of the
 *               door (coat rack + boots + lantern + seed chest left; bench, milk can, trunk right)
 *
 * The bed is the sleep target (see systems/sleep.ts: `house.bed`).
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import { Rng } from '../../core/rng';
import { InteriorMap, type RoomLight } from './room';
import { Kit, imat, floorPlane } from './kit';
import { atlasUV, glowDisc, PHOTO_CELLS, type PhotoName } from './textures';
import { mat, roundedBox, lumpySphere } from '../geom';
import { HearthFlames, Wisps } from './fx';

export const HOUSE_DOOR = { x: 31, z: 17 };
/** Where you step out onto the porch. */
export const HOUSE_PORCH = { x: 31.5, z: 18.75 };

const CAB = 0x86a596;
const CAB_D = 0x6d8a7c;
const BLOCK = 0xd09a62;
const CREAM = 0xf3ead6;
const WALNUT = 0x7a4e32;
const OAK = 0xc08850;

export class HouseInterior extends InteriorMap {
  /** Bed: interact anywhere along it to sleep. Tiles are world coords inside the house. */
  readonly bed = { x0: 10.3, z0: 0, x1: 12.1, z1: 2.3, wakeX: 9.6, wakeZ: 2.9 };
  private pendulum!: THREE.Object3D;
  private flames!: HearthFlames;
  private sparks!: Wisps;
  private smoke!: Wisps;
  private steam!: Wisps;
  private fireLight!: THREE.PointLight;
  private fireK = 1;
  private tuckQuilt!: THREE.Object3D;
  /** Pillow point the sleeping farmer's head rests on (world coords inside the house). */
  readonly pillow = new THREE.Vector3(11.2, 0.86, 0.5);

  constructor(game: Game) {
    super(game, {
      id: 'house',
      title: 'Farmhouse',
      W: 13,
      D: 8,
      H: 3.1,
      doorX: 6,
      exit: { to: 'farm', x: HOUSE_PORCH.x, z: HOUSE_PORCH.z, facing: 'down' },
      floor: 'floor',
      // A touch darker + cooler than the raw boards: the plank field no longer outshouts the props.
      // (r14: ~12 % lower value, cooler — the critic's "saturated orange planks overpower the props")
      floorTint: 0xd2cbc6,
      style: 'house',
      // Cool lavender-grey paper: the hearth, lamps and honey floor pop warm against it.
      wallTint: 0xd6d6ee,
      wainscotTint: 0x98b0a8,
      windows: [
        { wall: 'back', at: 1.9, w: 1.05, y0: 1.2, y1: 2.25, curtains: 0xf2e6c8 },
        { wall: 'back', at: 11.2, w: 1.2, y0: 1.5, y1: 2.55, curtains: 0xe8a8a0 },
        { wall: 'right', at: 5.7, w: 1.1, y0: 1.3, y1: 2.35, curtains: 0xe8a8a0 },
        { wall: 'left', at: 3.2, w: 1.0, y0: 1.2, y1: 2.2, curtains: 0xf2e6c8, shaft: 0.5 },
      ],
      sunDir: [-0.34, 0.58, -0.74],
    });
    this.coolFill = 0.38;
    // (r13: a touch brighter by day — the side walls went murky under the vignette)
    this.exposureBoost = 0.1;
    this.morningCool = 1;
    this.shaftK = 1.05;
    // r11: the shafts land — a soft window-shaped pool of sun where each beam hits the boards.
    this.sunPoolK = 0.3;
    this.moonShaft = 0.07;
    const rng = new Rng('house-interior');
    this.kitchen(rng);
    this.dining(rng);
    this.hearth(rng);
    this.bedroom(rng);
    this.front(rng);
    this.finalize();
  }

  // ───────────────────────────────────────────── kitchen

  private kitchen(rng: Rng): void {
    const k = new Kit();
    // Base cabinets along the back wall (x 0.1 .. 2.95), counter top, apron sink.
    const cz = 0.34;
    k.box('paint', [2.85, 0.1, 0.56], [1.52, 0, cz], { tint: 0x3a2a20 }); // toe kick
    k.box('paint', [2.9, 0.78, 0.6], [1.52, 0.08, cz], { tint: CAB, ao: 0.3 });
    for (const x of [0.5, 1.1, 2.6]) {
      // Door panels + knobs
      k.box('paint', [0.5, 0.56, 0.03], [x, 0.18, cz + 0.31], { tint: CAB_D });
      k.box('paint', [0.4, 0.46, 0.03], [x, 0.23, cz + 0.325], { tint: CAB });
      k.sphere('brass', 0.022, [x + 0.16, 0.6, cz + 0.35]);
    }
    k.box('wood', [2.98, 0.07, 0.68], [1.52, 0.86, cz + 0.02], { tint: BLOCK, uv: 2 });
    // Apron-front farmhouse sink (under window A)
    k.box('ceramic', [0.8, 0.44, 0.62], [1.9, 0.5, cz + 0.05], { tint: 0xf6f2ea, r: 0.05 });
    k.box('ceramic', [0.66, 0.05, 0.46], [1.9, 0.82, cz + 0.02], { tint: 0xb8c4c8 });
    const tap = new THREE.TorusGeometry(0.1, 0.018, 6, 14, Math.PI);
    k.add('brass', tap, mat(1.9, 1.05, 0.1, 0, Math.PI / 2, 0));
    k.cyl('brass', 0.02, 0.025, 0.14, [1.9, 0.93, 0.06]);
    // Dish rack with plates, a crock of utensils, cutting board with bread, bowl of apples
    for (let i = 0; i < 4; i++) k.cyl('ceramic', 0.13, 0.13, 0.015, [0.72 + i * 0.05, 0.93, 0.3], { rx: 0, rz: Math.PI / 2 - 0.2, tint: i % 2 ? 0xf2f0ea : 0xdce8f0, seg: 20 });
    k.cyl('ceramic', 0.07, 0.06, 0.2, [0.3, 0.93, 0.2], { tint: 0xd8c0a0 });
    for (let i = 0; i < 5; i++) k.cyl('wood', 0.012, 0.012, 0.28, [0.3 + (i - 2) * 0.02, 1.02, 0.2], { rz: (i - 2) * 0.12, tint: 0xa87850 });
    k.box('wood', [0.45, 0.03, 0.3], [2.62, 0.93, 0.42], { tint: 0xd8a870, r: 0.012 });
    k.add('ceramic', lumpySphere(0.12, 2, 0.05, rng), mat(2.62, 1.01, 0.42, 0, 0, 0, 1.2, 0.55, 0.75), { tint: 0xd89048 });
    k.cyl('ceramic', 0.17, 0.1, 0.1, [2.25, 0.93, 0.5], { tint: 0xe8e0d0 });
    for (let i = 0; i < 4; i++) k.sphere('ceramic', 0.055, [2.2 + (i % 2) * 0.09, 1.05 + Math.floor(i / 2) * 0.05, 0.47 + (i % 3) * 0.03], i === 2 ? 0x8ab83a : 0xc8322a);
    // Open shelves left of the window with preserves + stacked bowls
    for (const y of [1.45, 1.9]) {
      k.box('wood', [1.05, 0.05, 0.26], [0.72, y, 0.14], { tint: OAK });
      for (const x of [0.28, 1.16]) k.box('wood', [0.04, 0.12, 0.2], [x, y - 0.12, 0.12], { tint: WALNUT, rx: 0 });
    }
    const jarCols = [0xc83a3a, 0xe8a030, 0x7a3a6a, 0xd8c040, 0x5a8a3a, 0xe86a3a];
    for (let i = 0; i < 6; i++) {
      const x = 0.33 + i * 0.16;
      const c = jarCols[i]!;
      k.cyl('ceramic', 0.055, 0.055, 0.17, [x, 1.5, 0.14], { tint: c });
      k.cyl('fabric', 0.065, 0.065, 0.03, [x, 1.66, 0.14], { tint: i % 2 ? 0xf0e8d8 : 0xd84a4a });
    }
    for (let i = 0; i < 3; i++) k.cyl('ceramic', 0.13 - i * 0.012, 0.09 - i * 0.01, 0.06, [0.5, 1.95 + i * 0.055, 0.15], { tint: [0xf2eee4, 0x9cc0d8, 0xf2eee4][i] });
    k.cyl('ceramic', 0.08, 0.1, 0.24, [0.95, 1.95, 0.14], { tint: 0x3a6a9a });
    // Cast-iron cookstove + stovepipe + kettle
    const sx = 3.4;
    k.box('iron', [0.86, 0.72, 0.62], [sx, 0.12, 0.36], { r: 0.03, tint: 0x3c3836, ao: 0.25 });
    for (const [lx, lz] of [[-0.36, 0.1], [0.36, 0.1], [-0.36, 0.6], [0.36, 0.6]] as const) k.cyl('iron', 0.035, 0.025, 0.13, [sx + lx, 0, lz], { tint: 0x2a2624 });
    k.box('iron', [0.92, 0.05, 0.68], [sx, 0.84, 0.36], { tint: 0x2a2624 });
    for (const bx of [-0.2, 0.2]) k.cyl('iron', 0.13, 0.13, 0.02, [sx + bx, 0.89, 0.42], { tint: 0x1c1a18, seg: 20 });
    k.box('iron', [0.42, 0.38, 0.03], [sx - 0.14, 0.26, 0.68], { tint: 0x4a4644 });
    // Firebox draught slots glowing with embers (warm life in the kitchen corner at night)
    for (let i = 0; i < 4; i++) k.box('glow', [0.05, 0.12, 0.012], [sx - 0.26 + i * 0.08, 0.34, 0.698], { tint: 0xff7a30, r: 0.004 });
    k.box('brass', [0.3, 0.03, 0.04], [sx - 0.14, 0.56, 0.71]);
    k.box('brass', [0.9, 0.025, 0.03], [sx, 0.78, 0.69]);
    k.cyl('iron', 0.09, 0.09, 2.2, [sx + 0.2, 0.9, 0.18], { tint: 0x2a2624 });
    k.cyl('iron', 0.11, 0.11, 0.05, [sx + 0.2, 1.8, 0.18], { tint: 0x2a2624 });
    // Kettle
    k.add('ceramic', new THREE.SphereGeometry(0.14, 16, 12), mat(sx - 0.2, 1.0, 0.42, 0, 0, 0, 1, 0.78, 1), { tint: 0xc84a3a });
    k.add('ceramic', new THREE.ConeGeometry(0.03, 0.18, 8), mat(sx - 0.05, 1.04, 0.42, 0, 0, -1.1), { tint: 0xc84a3a });
    k.add('iron', new THREE.TorusGeometry(0.1, 0.012, 5, 12, Math.PI), mat(sx - 0.2, 1.08, 0.42, 0, 0, 0), { tint: 0x2a2624 });
    this.steam = new Wisps(new THREE.Vector3(sx + 0.05, 1.1, 0.42), { rate: 7, life: 1.8, rise: 0.45, spread: 0.04, size: 0.22, color: 0xffffff, additive: false, count: 24, opacity: 0.35 });
    this.root.add(this.steam.points);
    // Copper pots hanging from a rail above the counter end
    k.cyl('iron', 0.015, 0.015, 1.1, [2.85, 2.35, 0.2], { rz: Math.PI / 2, tint: 0x2a2624 });
    for (const [px, r, h] of [[2.45, 0.12, 0.14], [2.78, 0.1, 0.12], [3.1, 0.14, 0.1]] as const) {
      k.cyl('iron', 0.006, 0.006, 0.2, [px, 2.16, 0.2], { tint: 0x2a2624 });
      k.cyl('brass', r, r * 0.85, h, [px, 2.16 - h - 0.03, 0.22], { tint: 0xd8804a });
    }
    // Hutch against the left wall with plates on display
    const hz = 2.0;
    k.box('paint', [0.52, 0.95, 1.3], [0.28, 0, hz], { tint: CAB, ao: 0.3 });
    k.box('wood', [0.56, 0.05, 1.36], [0.3, 0.95, hz], { tint: BLOCK });
    k.box('paint', [0.3, 1.1, 1.3], [0.16, 1.0, hz], { tint: CAB_D });
    k.box('paint', [0.36, 0.08, 1.4], [0.2, 2.08, hz], { tint: CAB });
    for (const y of [1.35, 1.72]) k.box('wood', [0.28, 0.03, 1.24], [0.2, y, hz], { tint: OAK });
    for (let i = 0; i < 4; i++) {
      for (const y of [1.38, 1.75]) {
        const g = new THREE.CylinderGeometry(0.13, 0.13, 0.015, 22);
        k.add('ceramic', g, mat(0.24, y + 0.14, hz - 0.45 + i * 0.3, 0, 0, Math.PI / 2 - 0.25), { tint: (i + (y > 1.5 ? 1 : 0)) % 2 ? 0xf4f0e8 : 0x6f9cc8 });
      }
    }
    for (const dz of [-0.33, 0.33]) {
      k.box('paint', [0.03, 0.72, 0.55], [0.555, 0.12, hz + dz], { tint: CAB_D });
      k.sphere('brass', 0.022, [0.58, 0.62, hz + dz * 0.15]);
    }
    // Herb bundles drying on the left wall
    for (let i = 0; i < 4; i++) {
      const z = 4.9 + i * 0.3;
      k.cyl('fabric', 0.006, 0.006, 0.3, [0.08, 2.2, z], { tint: 0xc8a878 });
      k.add('leaf', new THREE.ConeGeometry(0.08, 0.34, 7), mat(0.1, 1.95, z, Math.PI, 0, 0), { tint: [0x7a9a58, 0x9aa860, 0xb88aa8, 0x6a8a4a][i] });
    }
    // Calendar on the wall between the shelves and the stove
    this.photo(k, 'calendar', [2.95 + 0.0, 1.5, 0.02], 0.34, 0.66, 'back', false);
    // Glazed quarry-tile floor for the kitchen zone, framed by an oak edge strip (the boards take over
    // at the dining rug) — the room reads as zones, not one plank box.
    // (r12: the tiles run on under the dining table — kitchen + dining read as ONE zone, framed by the
    // oak strip, instead of a tiled patch plus a separate rug island)
    const TW = 4.3;
    const TD = 5.15;
    k.add('tile', floorPlane(TW, TD, 1), mat(TW / 2, 0.0015, TD / 2), { tint: 0xe6dcd2 });
    k.box('wood', [TW - 0.55, 0.018, 0.07], [(TW + 0.55) / 2, 0, TD], { tint: 0x8a5a38, r: 0.008 });
    k.box('wood', [0.07, 0.018, TD - 0.7], [TW, 0, (TD + 0.7) / 2], { tint: 0x8a5a38, r: 0.008 });
    // A rag mat at the sink
    k.add('rug', floorPlane(1.0, 0.6), mat(1.9, 0.006, 1.05));
    this.statics.push(k.build('kitchen'));
    // Sink window: rays through all but the lowest band cleared the counter and landed mid-floor as two
    // stray squares (read as a decal bug). An invisible caster keeps only the counter + sink sunlit.
    const cast = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.05), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    cast.position.set(1.9, 1.87, -0.02);
    cast.castShadow = true;
    cast.receiveShadow = false;
    cast.userData.noAO = true;
    cast.userData.dynamic = true;
    cast.name = 'shadow-caster';
    this.root.add(cast);
    this.solid(0, 0, 3.9, 0.72, 'counter');
    this.solid(0, 1.35, 0.6, 2.65, 'hutch');
  }

  // ───────────────────────────────────────────── dining

  private dining(rng: Rng): void {
    const k = new Kit();
    const tx = 2.3;
    const tz = 4.3;
    this.table(k, tx, tz, 1.6, 0.95);
    // Linen runner, vase of flowers, teapot, cups, bread
    k.box('fabric', [0.4, 0.012, 1.02], [tx, 0.8, tz], { tint: 0xf0e2c0, r: 0.004 });
    k.box('fabric', [0.4, 0.14, 0.012], [tx, 0.68, tz + 0.51], { tint: 0xf0e2c0, r: 0.004 });
    k.box('fabric', [0.4, 0.14, 0.012], [tx, 0.68, tz - 0.51], { tint: 0xf0e2c0, r: 0.004 });
    k.cyl('ceramic', 0.06, 0.08, 0.2, [tx - 0.05, 0.81, tz - 0.05], { tint: 0x5a8ab0 });
    const blooms = [0xf06a8a, 0xffd166, 0xfff4f0, 0xc77dff, 0xf06a8a, 0xffa8c0];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const r = i === 0 ? 0 : 0.07 + (i % 2) * 0.03;
      const p = new THREE.Vector3(tx - 0.05 + Math.cos(a) * r, 1.08 + (i % 3) * 0.04, tz - 0.05 + Math.sin(a) * r);
      k.cyl('leaf', 0.006, 0.006, 0.28, [p.x * 0.5 + (tx - 0.05) * 0.5, 0.95, p.z * 0.5 + (tz - 0.05) * 0.5], { tint: 0x4a7a3a, rx: Math.sin(a) * 0.3, rz: -Math.cos(a) * 0.3 });
      k.add('fabric', lumpySphere(0.045, 1, 0.3, rng, 3), mat(p.x, p.y, p.z), { tint: blooms[i % blooms.length] });
      if (i % 2) k.add('leaf', new THREE.SphereGeometry(0.04, 6, 4), mat(p.x + 0.04, p.y - 0.08, p.z, 0, 0, 0, 1.6, 0.4, 0.8), { tint: 0x5a9a3a });
    }
    k.add('ceramic', new THREE.SphereGeometry(0.1, 14, 10), mat(tx + 0.22, 0.88, tz + 0.25, 0, 0, 0, 1, 0.8, 1), { tint: 0xf2eee4 });
    k.add('ceramic', new THREE.ConeGeometry(0.025, 0.12, 8), mat(tx + 0.34, 0.92, tz + 0.25, 0, 0, -1.0), { tint: 0xf2eee4 });
    k.sphere('ceramic', 0.025, [tx + 0.22, 0.97, tz + 0.25], 0xf2eee4);
    for (const [cx, cz] of [[tx - 0.5, tz + 0.25], [tx + 0.52, tz - 0.22]] as const) {
      k.cyl('ceramic', 0.075, 0.075, 0.012, [cx, 0.8, cz], { tint: 0xf4f0e8, seg: 18 });
      k.cyl('ceramic', 0.04, 0.032, 0.06, [cx, 0.812, cz], { tint: 0xf4f0e8 });
    }
    this.chair(k, tx - 1.05, tz, Math.PI / 2, 0xb07a4a);
    this.chair(k, tx + 1.05, tz, -Math.PI / 2, 0xb07a4a);
    // Hurricane lantern on the table (the room's warm evening pool)
    k.cyl('brass', 0.07, 0.08, 0.03, [tx + 0.35, 0.8, tz - 0.22]);
    k.add('glow', new THREE.SphereGeometry(0.03, 10, 8), mat(tx + 0.35, 0.9, tz - 0.22, 0, 0, 0, 1, 1.6, 1), { tint: 0xffd890 });
    k.add('glow', new THREE.SphereGeometry(0.065, 12, 10), mat(tx + 0.35, 0.93, tz - 0.22, 0, 0, 0, 1, 1.5, 1), { tint: 0xe8a050 });
    k.add('brass', new THREE.TorusGeometry(0.07, 0.006, 5, 12, Math.PI), mat(tx + 0.35, 1.03, tz - 0.22));
    this.addLamp(new THREE.Vector3(tx + 0.3, 1.6, tz + 0.05), 0xffc27a, 0, 2.2, 0.04, 6);
    // Bookshelf (left wall, front) with books, a globe and a plant
    const bz = 5.9;
    k.box('wood', [0.42, 2.0, 1.3], [0.24, 0, bz], { tint: WALNUT, ao: 0.3 });
    for (let s = 0; s < 4; s++) {
      const y = 0.12 + s * 0.48;
      k.box('wood', [0.36, 0.035, 1.18], [0.29, y, bz], { tint: 0x5a3824 });
      let z = bz - 0.54;
      while (z < bz + 0.5) {
        const w = 0.04 + rng.next() * 0.05;
        const h = 0.26 + rng.next() * 0.14;
        if (rng.next() < 0.08) {
          z += 0.08;
          continue;
        }
        const lean = rng.next() < 0.08 ? 0.25 : 0;
        k.box('paint', [0.26, h, w], [0.3, y + 0.035, z + w / 2], { tint: [0x8a3a3a, 0x3a5a7a, 0x5a7a4a, 0xc8a050, 0x6a4a6a, 0xe8dcc0, 0x2a4a4a][Math.floor(rng.next() * 7)], rx: lean, r: 0.008 });
        z += w + 0.005;
      }
    }
    k.sphere('ceramic', 0.13, [0.3, 2.14, bz - 0.3], 0x6a9ac0);
    k.cyl('brass', 0.05, 0.08, 0.06, [0.3, 2.0, bz - 0.3]);
    this.pottedPlant(k, rng, 0.35, bz + 0.35, 2.0, 0.5);
    // Fiddle-leaf fig in the front-left corner
    this.pottedPlant(k, rng, 0.55, 7.35, 0, 1.4);
    this.statics.push(k.build('dining'));
    this.solid(1.1, 3.7, 3.5, 4.9, 'table');
    this.solid(0, 5.2, 0.5, 6.6, 'bookshelf');
    this.solid(0.2, 7.0, 0.9, 7.7, 'plant');
  }

  // ───────────────────────────────────────────── hearth

  private hearth(rng: Rng): void {
    const k = new Kit();
    const cx = 6.5;
    const H = this.spec.H;
    const D0 = 0.68; // breast depth
    const stone = 0xc8b8a4;
    // Chimney breast with the firebox opening (1.1 wide × 0.9 high).
    k.box('stone', [0.62, H, D0], [cx - 0.86, 0, D0 / 2], { tint: stone, uv: 1.6, ao: 0.4 });
    k.box('stone', [0.62, H, D0], [cx + 0.86, 0, D0 / 2], { tint: stone, uv: 1.6, ao: 0.4 });
    k.box('stone', [1.12, H - 0.92, D0], [cx, 0.92, D0 / 2], { tint: stone, uv: 1.6 });
    // Sooty firebox interior + arch keystone
    k.box('brick', [1.12, 0.92, 0.1], [cx, 0, 0.08], { tint: 0x4a3028, uv: 3 });
    for (const s of [-1, 1]) k.box('brick', [0.08, 0.92, D0 - 0.1], [cx + s * 0.54, 0, D0 / 2 + 0.02], { tint: 0x3a2620, uv: 3 });
    k.box('stone', [0.2, 0.22, 0.08], [cx, 0.82, D0 + 0.02], { tint: 0xb0a090 });
    k.box('iron', [1.12, 0.03, 0.06], [cx, 0.9, D0 - 0.02], { tint: 0x2a2624 });
    // Hearth slab
    k.box('stone', [2.7, 0.08, 0.62], [cx, 0, D0 + 0.3], { tint: 0xb8aa98, uv: 1.4, r: 0.03 });
    // Mantel beam + corbels
    k.box('wood', [2.6, 0.14, 0.34], [cx, 1.3, D0 + 0.09], { tint: 0x6a4228, uv: 1 });
    for (const s of [-1, 1]) k.box('wood', [0.12, 0.22, 0.24], [cx + s * 1.05, 1.08, D0 + 0.08], { tint: 0x5a3820 });
    // Andirons + logs + ember bed
    for (const s of [-1, 1]) {
      k.box('iron', [0.05, 0.22, 0.05], [cx + s * 0.32, 0, 0.55], { tint: 0x2a2624 });
      k.box('iron', [0.04, 0.04, 0.4], [cx + s * 0.32, 0.12, 0.38], { tint: 0x2a2624 });
    }
    // Split logs on the dogs: charred bark, a glowing seam along each underside (the heat reads from
    // below, never as a white lamp), a bright split end facing the room.
    const logs: [number, number, number, number][] = [[0, 0.35, 0.2, 0.08], [-0.1, 0.44, -0.35, 0.07], [0.12, 0.3, 0.6, 0.065]];
    const ember = new Kit();
    for (const [lx, lz, ry, rr] of logs) {
      const g = new THREE.CylinderGeometry(rr, rr, 0.8, 9);
      g.rotateZ(Math.PI / 2);
      k.add('stone', g, mat(cx + lx, 0.14 + rr * 0.5, lz, 0, ry, 0), { tint: 0x5a3c26 });
      // Glow seam: a slimmer ember cylinder sunk under the log, peeking out along its belly.
      const sg = new THREE.CylinderGeometry(rr * 0.82, rr * 0.82, 0.66, 9);
      sg.rotateZ(Math.PI / 2);
      ember.add('ember', sg, mat(cx + lx, 0.14 + rr * 0.5 - rr * 0.32, lz, 0, ry, 0), { tint: 0xd8501a });
    }
    // Ember bed: a mound of coals in three heats (dull red at the rim, orange towards the middle, a
    // few hot yellow-orange hearts under the flames), char-dark between them.
    for (let i = 0; i < 26; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next());
      const ex = Math.cos(a) * r * 0.36;
      const ez = Math.sin(a) * r * 0.17;
      const heat = 1 - r;
      const tint = heat > 0.62 ? 0xffa040 : heat > 0.3 ? 0xf06a1c : rng.next() < 0.5 ? 0xa8300e : 0x3a2016;
      const sz = 0.035 + rng.next() * 0.035;
      ember.add('ember', lumpySphere(sz, 1, 0.3, rng), mat(cx + ex, 0.05 + heat * 0.03, 0.4 + ez, 0, rng.next() * 3, 0, 1, 0.55, 1), { tint });
    }
    const emberG = ember.build('embers', false);
    emberG.traverse((o) => (o.userData.noAO = true));
    this.root.add(emberG);
    // Flames, sparks, a thin smoke curl, the flicker light and a glow pool on the hearth + floor.
    // (r11: the soft fire-blob particles stacked additively into a white lamp inside the firebox: the
    // flame cards carry the fire alone now, with a few lazy sparks winking up the flue.)
    this.flames = new HearthFlames(0.8, 0.76, 6);
    this.flames.group.position.set(cx, 0.12, 0.4);
    this.root.add(this.flames.group);
    // Firelight on the sooty back + cheeks of the firebox (an additive glow card, flickering with the fire).
    {
      // (r13: deeper, lower and smaller — the old card read as a whitish hood above the logs)
      const gm = new THREE.MeshBasicMaterial({ map: glowDisc().map, color: 0xd8461a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const g = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.62), gm);
      g.position.set(cx, 0.2, 0.145);
      g.userData.noAO = true;
      g.userData.dynamic = true;
      g.renderOrder = 3;
      this.root.add(g);
      const c0 = new THREE.Color(0xd8461a);
      this.updaters.push((_dt, _t, L) => gm.color.copy(c0).multiplyScalar((0.2 + L.night * 0.04) * this.fireK * (1 - this.dim * 0.5)));
    }
    this.sparks = new Wisps(new THREE.Vector3(cx, 0.3, 0.4), { rate: 5, life: 1.3, rise: 0.75, spread: 0.45, size: 0.035, color: 0xffa040, additive: true, count: 24 });
    this.root.add(this.sparks.points);
    this.smoke = new Wisps(new THREE.Vector3(cx, 0.75, 0.3), { rate: 3, life: 1.2, rise: 0.4, spread: 0.3, size: 0.3, color: 0x6a5a50, additive: false, count: 16, opacity: 0.25 });
    this.root.add(this.smoke.points);
    this.fireLight = this.addLamp(new THREE.Vector3(cx, 0.6, 0.95), 0xff8a3c, 2.2, 7.5, 0, 9);
    this.glowPool(cx, 1.3, 1.9, 0xff7a30, () => (0.22 + this.light.night * 0.16) * this.fireK);
    // The warm fan reaches out across the hearth rug even at 8 am (the fire is the room's warm pocket).
    this.glowPool(cx, 2.55, 2.5, 0xff8a40, () => (0.11 + this.light.night * 0.05) * this.fireK, 0.016);
    this.glowPool(cx, 0.55, 0.9, 0xffa050, () => (0.3 - this.light.night * 0.08) * this.fireK, 0.09);
    // Mantel dressing: clock, candlesticks, two small photos, a jar of dried flowers, pinecones
    const my = 1.44;
    k.box('wood', [0.3, 0.34, 0.14], [cx, my, D0 + 0.08], { tint: 0x7a4a2a, r: 0.04 });
    k.cyl('ceramic', 0.1, 0.1, 0.02, [cx, my + 0.19, D0 + 0.16], { rx: Math.PI / 2, tint: 0xf4ecd8, seg: 22 });
    k.box('iron', [0.012, 0.07, 0.01], [cx, my + 0.18, D0 + 0.175], { tint: 0x1a1a1a, rz: 0.6 });
    k.box('iron', [0.01, 0.05, 0.01], [cx, my + 0.18, D0 + 0.175], { tint: 0x1a1a1a, rz: -1.2 });
    for (const s of [-1, 1]) {
      k.cyl('brass', 0.04, 0.05, 0.03, [cx + s * 0.95, my, D0 + 0.1]);
      k.cyl('brass', 0.015, 0.02, 0.16, [cx + s * 0.95, my + 0.03, D0 + 0.1]);
      k.cyl('paint', 0.022, 0.022, 0.2, [cx + s * 0.95, my + 0.19, D0 + 0.1], { tint: 0xf4ecd8 });
      k.add('glow', new THREE.SphereGeometry(0.022, 8, 6), mat(cx + s * 0.95, my + 0.42, D0 + 0.1, 0, 0, 0, 0.8, 1.8, 0.8), { tint: 0xffc060 });
    }
    this.photo(k, 'couple', [cx - 0.55, my, D0 + 0.12], 0.22, 0.34, 'back', true, -0.12);
    this.photo(k, 'girl', [cx + 0.55, my, D0 + 0.12], 0.2, 0.3, 'back', true, 0.15);
    k.cyl('ceramic', 0.05, 0.06, 0.16, [cx - 0.28, my, D0 + 0.1], { tint: 0x8aa0b8 });
    for (let i = 0; i < 5; i++) k.add('fabric', lumpySphere(0.03, 0, 0.3, rng, 3), mat(cx - 0.28 + (rng.next() - 0.5) * 0.1, my + 0.22 + rng.next() * 0.08, D0 + 0.1), { tint: [0xd8b0d0, 0xf0e0b0, 0xc8a0c0][i % 3] });
    for (let i = 0; i < 2; i++) k.add('wood', lumpySphere(0.04, 1, 0.35, rng, 4), mat(cx + 0.3 + i * 0.08, my + 0.04, D0 + 0.12, 0, 0, 0, 0.8, 1.2, 0.8), { tint: 0x8a5a30 });
    // The "Hearth & Home" sampler above the mantel
    this.photo(k, 'sampler', [cx, 1.75, D0 + 0.01], 0.9, 0.9, 'back', false);
    // Firewood basket + poker stand
    k.cyl('thatch', 0.28, 0.24, 0.34, [4.85, 0, 1.0], { tint: 0xc8a068 });
    for (let i = 0; i < 5; i++) {
      const g = new THREE.CylinderGeometry(0.06, 0.06, 0.55, 8);
      g.rotateZ(Math.PI / 2);
      k.add('stone', g, mat(4.85 + (rng.next() - 0.5) * 0.1, 0.36 + (i % 3) * 0.08, 0.9 + (i % 2) * 0.14, 0, rng.next() * 0.6 - 0.3, 0), { tint: 0x8a6444 });
    }
    k.cyl('iron', 0.1, 0.12, 0.03, [8.1, 0, 0.9], { tint: 0x2a2624 });
    k.cyl('iron', 0.012, 0.012, 0.7, [8.1, 0.02, 0.9], { tint: 0x2a2624 });
    for (let i = 0; i < 3; i++) k.cyl('iron', 0.01, 0.01, 0.62, [8.06 + i * 0.04, 0.05, 0.88], { rz: (i - 1) * 0.08, tint: 0x3a3634 });
    // Braided rug, armchair, rocking chair, side table + oil lamp, knitting basket
    // Oval braided rug (a real ellipse — no square card around it).
    const rug = new THREE.CircleGeometry(0.5, 72);
    rug.rotateX(-Math.PI / 2);
    rug.scale(3.4, 1, 2.3);
    k.add('braid', rug, mat(cx, 0.008, 2.75));
    this.armchair(k, 4.95, 2.85, 0.75);
    this.rocker(k, 8.05, 2.8, -0.85);
    k.cyl('wood', 0.26, 0.26, 0.04, [8.95, 0.56, 1.85], { tint: OAK, seg: 20 });
    k.cyl('wood', 0.03, 0.04, 0.56, [8.95, 0, 1.85], { tint: WALNUT });
    k.cyl('wood', 0.18, 0.2, 0.03, [8.95, 0, 1.85], { tint: WALNUT });
    k.cyl('brass', 0.07, 0.09, 0.08, [8.95, 0.6, 1.85]);
    k.add('glow', new THREE.SphereGeometry(0.075, 12, 10), mat(8.95, 0.78, 1.85, 0, 0, 0, 1, 1.4, 1), { tint: 0xfff0d0 });
    k.cyl('ceramic', 0.035, 0.045, 0.12, [8.95, 0.86, 1.85], { tint: 0xf4f4f0 });
    this.addLamp(new THREE.Vector3(8.95, 1.25, 1.95), 0xffc27a, 0, 1.4, 0.05, 4.5);
    k.cyl('ceramic', 0.045, 0.035, 0.05, [8.8, 0.6, 1.98], { tint: 0xf2eee4 });
    // (r12: the knitting basket left the bedroom doorway — the bed-to-door lane is clear planks)
    // The pet's wicker bed by the hearth: a plaid cushion, a chewed rope toy
    const pbx = 7.6;
    const pbz = 1.45;
    const pbed = new THREE.LatheGeometry([[0.0, 0.0], [0.34, 0.0], [0.38, 0.05], [0.4, 0.14], [0.37, 0.19], [0.33, 0.17], [0.31, 0.08], [0.0, 0.08]].map(([a, b]) => new THREE.Vector2(a!, b!)), 28);
    // (r16: 1.25x roomier — the curled dog fills the cushion instead of hanging over the rim)
    k.add('thatch', pbed, mat(pbx, 0, pbz, 0, 0, 0, 1.25, 1, 1.0), { tint: 0xc8a068 });
    k.add('fabric', lumpySphere(0.3, 2, 0.08, rng), mat(pbx, 0.08, pbz, 0, 0, 0, 1.25, 0.22, 1.0), { tint: 0xb84a3e });
    for (let i = 0; i < 3; i++) k.add('fabric', roundedBox(0.66, 0.012, 0.04, 0.005), mat(pbx, 0.135, pbz - 0.18 + i * 0.18), { tint: 0xe8d8b0 });
    k.add('fabric', new THREE.TorusGeometry(0.06, 0.02, 6, 12), mat(pbx + 0.58, 0.02, pbz + 0.44, Math.PI / 2, 0, 0.4), { tint: 0x5a8ac0 });
    // Pendulum wall clock between the stove and the hearth
    const clk = { x: 4.6, y: 1.55 };
    k.box('wood', [0.36, 0.95, 0.12], [clk.x, clk.y, 0.07], { tint: 0x6a3a22, r: 0.03 });
    k.box('wood', [0.44, 0.08, 0.15], [clk.x, clk.y + 0.95, 0.08], { tint: 0x5a3018 });
    k.cyl('ceramic', 0.13, 0.13, 0.02, [clk.x, clk.y + 0.72, 0.135], { rx: Math.PI / 2, tint: 0xf4ecd8, seg: 22 });
    k.box('iron', [0.012, 0.09, 0.01], [clk.x, clk.y + 0.7, 0.15], { tint: 0x1a1a1a, rz: 2.2 });
    k.box('iron', [0.01, 0.07, 0.01], [clk.x, clk.y + 0.7, 0.15], { tint: 0x1a1a1a, rz: -0.4 });
    k.box('paint', [0.26, 0.5, 0.012], [clk.x, clk.y + 0.1, 0.132], { tint: 0x2a1a12 });
    const pk = new Kit();
    pk.cyl('brass', 0.006, 0.006, 0.36, [0, -0.36, 0], { tint: 0xd8a850 });
    pk.cyl('brass', 0.055, 0.055, 0.015, [0, -0.42, 0], { rx: Math.PI / 2, seg: 18 });
    this.pendulum = pk.build('pendulum');
    this.pendulum.position.set(clk.x, clk.y + 0.58, 0.14);
    this.root.add(this.pendulum);
    this.statics.push(k.build('hearth'));
    this.solid(cx - 1.2, 0, cx + 1.2, 0.8, 'hearth');
    this.solid(4.4, 2.4, 5.5, 3.3, 'armchair');
    this.solid(7.6, 2.4, 8.5, 3.3, 'rocker');
    this.solid(8.7, 1.6, 9.2, 2.1, 'side-table');
    this.solid(7.15, 1.07, 8.05, 1.83, 'pet-bed');
    this.updaters.push((dt, t, L) => this.tickHearth(dt, t, L));
  }

  /** Sleep system: fold the quilt over the farmer lying in bed (or turn it down again). */
  tuckIn(on: boolean): void {
    this.tuckQuilt.visible = on;
  }

  private tickHearth(dt: number, t: number, L: RoomLight): void {
    this.fireK = 0.85 + 0.12 * Math.sin(t * 11.3) * Math.sin(t * 6.1 + 1) + 0.08 * Math.sin(t * 23.7) + 0.06 * Math.sin(t * 3.1);
    this.fireLight.intensity *= this.fireK;
    this.flames.gain = (0.78 - L.night * 0.2) * (0.9 + 0.2 * this.fireK) * (1 - this.dim * 0.55);
    this.flames.update(t);
    this.sparks.update(dt, 0.7 + 0.3 * this.fireK);
    this.smoke.update(dt);
    this.steam.update(dt);
    this.pendulum.rotation.z = Math.sin(t * Math.PI) * 0.2;
  }

  // ───────────────────────────────────────────── bedroom

  private bedroom(rng: Rng): void {
    const k = new Kit();
    const bx = 11.2;
    const bw = 1.8;
    const bl = 2.25;
    // Headboard: turned posts with finials, panel with an arched crest
    for (const s of [-1, 1]) {
      k.cyl('wood', 0.055, 0.06, 1.3, [bx + (s * bw) / 2, 0, 0.1], { tint: 0x8a5634 });
      k.sphere('wood', 0.075, [bx + (s * bw) / 2, 1.35, 0.1], 0x8a5634);
      k.cyl('wood', 0.05, 0.055, 0.78, [bx + (s * bw) / 2, 0, bl], { tint: 0x8a5634 });
      k.sphere('wood', 0.065, [bx + (s * bw) / 2, 0.82, bl], 0x8a5634);
      k.box('wood', [0.05, 0.16, bl - 0.1], [bx + (s * (bw - 0.06)) / 2, 0.28, bl / 2 + 0.05], { tint: 0x7a4a2c });
    }
    k.box('wood', [bw - 0.1, 0.62, 0.06], [bx, 0.42, 0.1], { tint: 0x9a6440, r: 0.02 });
    k.add('wood', new THREE.CylinderGeometry(bw / 2 - 0.05, bw / 2 - 0.05, 0.06, 28, 1, false, -Math.PI / 2, Math.PI), mat(bx, 1.04, 0.1, Math.PI / 2, 0, 0, 1, 1, 0.32), { tint: 0x9a6440 });
    for (let i = 0; i < 5; i++) k.box('wood', [0.05, 0.4, 0.02], [bx - 0.6 + i * 0.3, 0.52, 0.14], { tint: 0x7a4a2c });
    k.box('wood', [bw - 0.1, 0.36, 0.05], [bx, 0.34, bl], { tint: 0x9a6440, r: 0.02 });
    // Mattress, sheet fold, pillows, patchwork quilt with draped sides, folded throw
    k.box('fabric', [bw - 0.08, 0.24, bl - 0.08], [bx, 0.36, bl / 2 + 0.04], { tint: 0xf4efe4, r: 0.08 });
    // Plump pillows (r11): a pinched, crease-dented cushion shape leaning on the headboard, not blocks.
    for (const s of [-1, 1]) k.add('fabric', pillowGeo(0.34, 0.1, 0.21, s), mat(bx + s * 0.4, 0.72, 0.42, -0.32, s * 0.08, s * 0.03), { tint: s < 0 ? 0xfaf6ee : 0xeef2f6 });
    // Patchwork quilt (r11): one draped cloth — puffy quilted squares over the mattress top, rolling
    // over the edges and hanging 30 cm down the sides + foot with a soft wave, hanging corners flared;
    // a turned-down cuff at the head shows the cream backing and the sheet under it.
    const qz0 = 0.86;
    const ql = bl - qz0 - 0.02;
    k.add('quilt', drapedQuilt(bw - 0.06, ql, 0.32, 0.07), mat(bx, 0.6, qz0));
    k.add('fabric', roundedBox(bw - 0.02, 0.05, 0.26, 0.025, 2), mat(bx, 0.63, qz0 - 0.08, -0.06, 0, 0), { tint: 0xf6efe2 });
    k.add('fabric', roundedBox(bw - 0.02, 0.012, 0.035, 0.006), mat(bx, 0.657, qz0 + 0.035, -0.06, 0, 0), { tint: 0xc86a5a });
    k.add('fabric', roundedBox(bw - 0.1, 0.03, 0.2, 0.015, 2), mat(bx, 0.6, qz0 - 0.24), { tint: 0xfaf8f2 });
    // r14: a knitted mustard throw folded across the foot — a soft cloth lying over the quilt's puffs,
    // rolling over the edges and hanging down both sides + the foot (was a rigid slab), its folded head
    // edge a soft roll.
    {
      const tz0 = bl - 0.5;
      k.add('fabric', drapedQuilt(bw + 0.02, 0.5, 0.26, 0.09), mat(bx, 0.665, tz0, 0, 0.015, 0, 1, 0.55, 1), { tint: 0xd49a3c });
      k.add('fabric', new THREE.CapsuleGeometry(0.045, bw - 0.12, 4, 12).rotateZ(Math.PI / 2), mat(bx, 0.715, tz0 + 0.03, 0, 0.015, 0, 1, 0.75, 1), { tint: 0xe2ac50 });
    }
    // A sleepy book left on the quilt
    k.box('paint', [0.22, 0.04, 0.3], [bx - 0.45, 0.685, 1.3], { tint: 0x3a5a7a, ry: 0.4, r: 0.01 });
    // Nightstand: drawer, lamp, glasses, water glass
    const nx = 9.75;
    k.box('wood', [0.6, 0.62, 0.5], [nx, 0, 0.3], { tint: OAK, ao: 0.25, r: 0.03 });
    k.box('wood', [0.5, 0.18, 0.02], [nx, 0.36, 0.56], { tint: 0xa87040 });
    k.sphere('brass', 0.022, [nx, 0.45, 0.58]);
    k.cyl('ceramic', 0.07, 0.09, 0.22, [nx - 0.08, 0.62, 0.22], { tint: 0x8ab0c8 });
    k.add('glow', new THREE.CylinderGeometry(0.11, 0.17, 0.2, 18, 1, true), mat(nx - 0.08, 0.95, 0.22), { tint: 0xe08a4a });
    k.add('glow', new THREE.TorusGeometry(0.17, 0.008, 4, 20), mat(nx - 0.08, 0.85, 0.22, Math.PI / 2, 0, 0), { tint: 0xffe8c0 });
    k.cyl('fabric', 0.11, 0.11, 0.005, [nx - 0.08, 1.05, 0.22], { tint: 0xd07a44 });
    this.addLamp(new THREE.Vector3(nx - 0.08, 1.3, 0.6), 0xffc890, 0, 1.0, 0, 5);
    k.cyl('ceramic', 0.035, 0.03, 0.12, [nx + 0.18, 0.62, 0.35], { tint: 0xd8e8f0 });
    k.add('iron', new THREE.TorusGeometry(0.035, 0.006, 5, 12), mat(nx + 0.1, 0.63, 0.42, Math.PI / 2, 0, 0), { tint: 0xc8a050 });
    k.add('iron', new THREE.TorusGeometry(0.035, 0.006, 5, 12), mat(nx + 0.19, 0.63, 0.44, Math.PI / 2, 0, 0), { tint: 0xc8a050 });
    // Grandmother's photo wall (between the hearth and the bed window)
    this.photo(k, 'grandma', [8.65, 1.25, 0.02], 0.55, 0.78, 'back', false);
    this.photo(k, 'valley', [9.45, 1.85, 0.02], 0.4, 0.55, 'back', false);
    this.photo(k, 'couple', [9.45, 1.28, 0.02], 0.3, 0.42, 'back', false);
    this.photo(k, 'recipe', [8.0, 1.95, 0.02], 0.26, 0.38, 'back', false);
    // Wardrobe on the right wall
    const wz = 3.9;
    k.box('paint', [0.62, 2.1, 1.3], [12.66, 0, wz], { tint: 0x9aa8b8, ao: 0.3, r: 0.03 });
    k.box('paint', [0.7, 0.1, 1.4], [12.64, 2.1, wz], { tint: 0x8a98a8 });
    for (const s of [-1, 1]) {
      k.box('paint', [0.03, 1.7, 0.58], [12.34, 0.25, wz + s * 0.31], { tint: 0x8a98a8 });
      k.box('paint', [0.03, 1.5, 0.46], [12.32, 0.35, wz + s * 0.31], { tint: 0xa8b6c4 });
      k.sphere('brass', 0.025, [12.3, 1.1, wz + s * 0.06]);
    }
    k.box('thatch', [0.5, 0.3, 0.4], [12.66, 2.2, wz - 0.3], { tint: 0xc8a068, r: 0.04 });
    // Blanket chest at the foot of the bed
    k.box('wood', [1.3, 0.48, 0.5], [bx, 0, 2.72], { tint: 0x8a5634, ao: 0.25, r: 0.04 });
    k.box('wood', [1.34, 0.06, 0.54], [bx, 0.48, 2.72], { tint: 0x7a4a2c, r: 0.03 });
    for (const s of [-1, 1]) k.box('iron', [0.05, 0.5, 0.52], [bx + s * 0.45, 0.02, 2.72], { tint: 0x3a3634 });
    k.box('fabric', [0.5, 0.08, 0.4], [bx - 0.3, 0.54, 2.72], { tint: 0x7aa0c8, r: 0.03, ry: 0.2 });
    // (r12) The sleeping zone's own floor: one broad woven rug under the bed in a cool dusk tone, so the
    // bedroom reads as a room (kitchen = tiles, living = the braided hearth rug, bedroom = this).
    k.add('rug', floorPlane(3.3, 2.95), mat(bx + 0.05, 0.005, 2.35, 0, Math.PI / 2, 0), { tint: 0xc4c2e2 });
    // Window-sill plants
    this.pottedPlant(k, rng, 12.8, 5.3, 1.22, 0.3);
    this.statics.push(k.build('bedroom'));
    // Bedtime quilt: a turned-down patchwork cover the sleep system folds over the farmer (hidden by day).
    const qk = new Kit();
    // A domed half-cylinder of patchwork from just under the chin to the foot of the bed, tall enough to
    // swallow the farmer's body (only the head shows on the pillow), a turned-down sheet cuff at the top.
    const cov = new THREE.CylinderGeometry(0.94, 0.94, 1.3, 28, 1, true, -Math.PI / 2, Math.PI);
    cov.rotateX(-Math.PI / 2);
    qk.add('quilt', cov, mat(bx, 0.6, 1.64, 0, 0, 0, 1, 0.66, 1));
    qk.add('quilt', new THREE.CircleGeometry(0.94, 28, 0, Math.PI), mat(bx, 0.6, 2.29, 0, 0, 0, 1, 0.66, 1));
    qk.add('fabric', new THREE.CylinderGeometry(0.96, 0.96, 0.16, 28, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), mat(bx, 0.6, 1.02, 0, 0, 0, 1, 0.68, 1), { tint: 0xfaf8f2 });
    qk.add('fabric', new THREE.CircleGeometry(0.96, 28, 0, Math.PI).rotateY(Math.PI), mat(bx, 0.6, 0.94, 0, 0, 0, 1, 0.68, 1), { tint: 0xeee8dc });
    this.tuckQuilt = qk.build('bed-quilt');
    this.tuckQuilt.visible = false;
    this.tuckQuilt.userData.dynamic = true;
    this.root.add(this.tuckQuilt);
    this.partition();
    this.solid(10.2, 0, 12.2, 2.3, 'bed');
    this.solid(9.4, 0, 10.1, 0.6, 'nightstand');
    this.solid(12.3, 3.2, 13, 4.6, 'wardrobe');
    this.solid(10.5, 2.45, 11.9, 3.0, 'chest');
  }

  // ───────────────────────────────────────────── front

  private front(rng: Rng): void {
    const k = new Kit();
    // Woven runner inside the door + a second runner leading up to the hearth rug
    k.add('runner', floorPlane(1.05, 1.75), mat(6.5, 0.008, 6.6, 0, 0.05, 0));
    // Living corner: a loveseat facing the hearth (its back to the door), a side table with a little
    // glass lamp, a basket of kindling-dry magazines — closes the hearth circle instead of a lone runner.
    this.loveseat(k, rng, 6.5, 4.3);
    const stx = 7.72;
    const stz = 4.35;
    k.cyl('wood', 0.24, 0.24, 0.035, [stx, 0.5, stz], { tint: OAK, seg: 20 });
    k.cyl('wood', 0.03, 0.04, 0.5, [stx, 0, stz], { tint: WALNUT });
    k.cyl('wood', 0.17, 0.19, 0.03, [stx, 0, stz], { tint: WALNUT });
    k.cyl('ceramic', 0.06, 0.08, 0.16, [stx - 0.05, 0.535, stz - 0.04], { tint: 0xc8704a });
    // Rose-amber shade (keeps its colour lit; a hot rim at the hem + the bulb's glow inside)
    k.add('glow', new THREE.CylinderGeometry(0.09, 0.15, 0.16, 16, 1, true), mat(stx - 0.05, 0.76, stz - 0.04), { tint: 0xd8783e });
    k.add('glow', new THREE.TorusGeometry(0.15, 0.008, 4, 20), mat(stx - 0.05, 0.68, stz - 0.04, Math.PI / 2, 0, 0), { tint: 0xffe8c0 });
    k.cyl('fabric', 0.09, 0.09, 0.005, [stx - 0.05, 0.84, stz - 0.04], { tint: 0xc87040 });
    k.box('paint', [0.2, 0.03, 0.15], [stx + 0.08, 0.535, stz + 0.1], { tint: 0x3a5a7a, ry: 0.4, r: 0.01 });
    k.cyl('ceramic', 0.04, 0.032, 0.07, [stx + 0.1, 0.565, stz + 0.1], { tint: 0xf2eee4 });
    this.glowPool(stx - 0.1, stz, 1.2, 0xffb060, () => this.light.night * 0.14 * (1 - this.dim));
    this.solid(5.75, 3.95, 7.25, 4.65, 'loveseat');
    // r14: a slim sofa table along the loveseat's back (the classic cottage console): turned legs, a
    // stretcher shelf with a basket, a stack of books, a fern in a terracotta pot, a framed photo and a
    // bowl of apples — gives the open plank band between the hearth circle and the door runner a middle.
    {
      const cx = 6.5;
      const cz = 4.98;
      const cw = 1.32;
      k.box('wood', [cw, 0.045, 0.3], [cx, 0.66, cz], { tint: OAK, r: 0.015, uv: 1.5 });
      k.box('wood', [cw - 0.12, 0.06, 0.24], [cx, 0.6, cz], { tint: 0xa87040 });
      k.box('wood', [cw - 0.14, 0.025, 0.24], [cx, 0.16, cz], { tint: 0xa87040 });
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const g = new THREE.LatheGeometry([new THREE.Vector2(0.022, 0), new THREE.Vector2(0.032, 0.08), new THREE.Vector2(0.024, 0.28), new THREE.Vector2(0.036, 0.4), new THREE.Vector2(0.026, 0.56), new THREE.Vector2(0.032, 0.64)], 10);
          k.add('wood', g, mat(cx + sx * (cw / 2 - 0.06), 0, cz + sz * 0.1), { tint: 0xa87040 });
        }
      // Basket on the stretcher shelf, a folded cloth in it
      const bk = new THREE.LatheGeometry([[0, 0], [0.15, 0], [0.18, 0.04], [0.19, 0.17], [0.17, 0.17], [0.16, 0.04], [0, 0.03]].map(([a2, b2]) => new THREE.Vector2(a2!, b2!)), 20);
      k.add('thatch', bk, mat(cx - 0.3, 0.17, cz, 0, 0, 0, 1.25, 1, 0.7), { tint: 0xc89a60 });
      k.add('fabric', roundedBox(0.3, 0.05, 0.16, 0.02), mat(cx - 0.3, 0.32, cz), { tint: 0xc86a5a });
      // Books lying + standing between a bookend
      for (const [i, c] of [[0, 0x6a4a7a], [1, 0x3a6a5a], [2, 0xb8703a]] as const) k.box('paint', [0.24 - i * 0.02, 0.035, 0.17], [cx - 0.42, 0.7 + i * 0.036, cz + 0.01], { tint: c, ry: (i - 1) * 0.12, r: 0.008 });
      // Fern in a terracotta pot
      k.cyl('ceramic', 0.075, 0.06, 0.12, [cx + 0.02, 0.685, cz], { tint: 0xc0704a, seg: 14 });
      for (let i = 0; i < 9; i++) {
        const a2 = (i / 9) * Math.PI * 2 + rng.next() * 0.3;
        const fr = new THREE.ConeGeometry(0.03, 0.26, 4);
        fr.scale(1, 1, 0.3);
        k.add('leaf', fr, mat(cx + 0.02 + Math.cos(a2) * 0.05, 0.86, cz + Math.sin(a2) * 0.05, Math.sin(a2) * 0.7, 0, -Math.cos(a2) * 0.7), { tint: i % 2 ? 0x5a8a3a : 0x6a9a44 });
      }
      // Framed photo leaning on a little stand + a wooden bowl of red apples
      k.box('wood', [0.16, 0.2, 0.02], [cx + 0.3, 0.705, cz - 0.03], { tint: 0x5a3a24, rx: -0.15, r: 0.006 });
      k.box('paint', [0.12, 0.15, 0.005], [cx + 0.3, 0.73, cz - 0.016], { tint: 0xe8d8b0, rx: -0.15 });
      k.add('wood', new THREE.SphereGeometry(0.12, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1, 0.45, 1), mat(cx + 0.5, 0.76, cz + 0.01), { tint: 0x9a6a3c });
      for (let i = 0; i < 4; i++) k.sphere('ceramic', 0.045, [cx + 0.47 + (i % 2) * 0.06, 0.75 + (i > 1 ? 0.045 : 0), cz - 0.02 + (i % 3) * 0.025], i === 2 ? 0xd8b040 : 0xc8302a);
    }
    this.solid(5.78, 4.65, 7.22, 5.15, 'sofa-table');
    this.solid(7.5, 4.15, 7.95, 4.6, 'side-table');
    // Laundry basket by the wardrobe: folded linens, a sheet spilling over the rim
    const lbx = 9.95;
    const lbz = 3.35;
    const lb = new THREE.LatheGeometry([[0, 0], [0.24, 0], [0.28, 0.06], [0.3, 0.3], [0.32, 0.33], [0.29, 0.33], [0.27, 0.06], [0, 0.04]].map(([a, b]) => new THREE.Vector2(a!, b!)), 24);
    k.add('thatch', lb, mat(lbx, 0, lbz, 0, 0, 0, 1.25, 1, 0.9), { tint: 0xd0aa70 });
    for (const [i, c] of [[0, 0xf4efe4], [1, 0xc8d8e8], [2, 0xf2dcd0]] as const) k.add('fabric', roundedBox(0.48 - i * 0.05, 0.06, 0.34 - i * 0.03, 0.025), mat(lbx + (i - 1) * 0.02, 0.27 + i * 0.06, lbz, 0, (i - 1) * 0.15, 0), { tint: c });
    k.add('fabric', roundedBox(0.3, 0.02, 0.36, 0.01), mat(lbx + 0.36, 0.2, lbz + 0.02, 0, 0, -1.1), { tint: 0xf4efe4 });
    this.solid(9.5, 3.0, 10.4, 3.7, 'laundry');
    // r16 mid-floor anchors (critic: "the bottom third between the door runner and the benches is bare
    // boards"): grandmother's sewing basket right of the runner — wicker, lid propped open, balls of
    // wool, needles, a strand trailing over the rim to a ball that rolled away — and the dog's knotted
    // rope toy on the boards left of it.
    {
      const sbx = 7.62;
      const sbz = 6.15;
      const sb = new THREE.LatheGeometry([[0, 0], [0.2, 0], [0.24, 0.05], [0.25, 0.2], [0.27, 0.22], [0.24, 0.22], [0.23, 0.05], [0, 0.04]].map(([a, b]) => new THREE.Vector2(a!, b!)), 22);
      k.add('thatch', sb, mat(sbx, 0, sbz, 0, 0, 0, 1.1, 1, 0.85), { tint: 0xc89a5c });
      // the lid, set down on the boards leaning against the basket's side
      k.add('thatch', new THREE.CylinderGeometry(0.27, 0.27, 0.035, 22), mat(sbx + 0.42, 0.1, sbz - 0.05, 0, 0, 0.42, 1.0, 1, 0.85), { tint: 0xb88a50 });
      for (const [i, c] of [[0, 0xc8504a], [1, 0x5a86b8], [2, 0xf0e2c4], [3, 0x7a9a5a]] as const) {
        const a = i * 1.7;
        k.add('fabric', lumpySphere(0.085, 1, 0.12, rng), mat(sbx + Math.cos(a) * 0.1, 0.2 + (i % 2) * 0.03, sbz + Math.sin(a) * 0.07), { tint: c });
      }
      k.cyl('wood', 0.006, 0.006, 0.36, [sbx + 0.05, 0.2, sbz], { rz: 0.9, rx: 0.3, tint: 0xd8b070 });
      k.cyl('wood', 0.006, 0.006, 0.36, [sbx - 0.02, 0.2, sbz + 0.02], { rz: -0.8, rx: 0.2, tint: 0xd8b070 });
      // a strand of red wool over the rim to the ball that rolled off
      k.add('fabric', new THREE.TorusGeometry(0.22, 0.008, 4, 18, 1.6), mat(sbx - 0.2, 0.02, sbz + 0.22, Math.PI / 2, 0, 0.7), { tint: 0xc8504a });
      k.add('fabric', lumpySphere(0.07, 1, 0.12, rng), mat(sbx - 0.42, 0.065, sbz + 0.38), { tint: 0xc8504a });
      this.solid(sbx - 0.3, sbz - 0.25, sbx + 0.3, sbz + 0.25, 'sewing-basket');
      // knotted rope toy: a twisted rope between two fat knots, plus a chewed tennis-style rag ball
      const tx = 4.25;
      const tz = 6.75;
      k.add('fabric', new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8).rotateZ(Math.PI / 2), mat(tx, 0.035, tz, 0, 0.5, 0), { tint: 0xe8d8b0 });
      k.add('fabric', new THREE.CylinderGeometry(0.032, 0.032, 0.34, 8, 1).rotateZ(Math.PI / 2), mat(tx, 0.04, tz, 0.9, 0.5, 0), { tint: 0xd85a4a });
      for (const s2 of [-1, 1]) k.add('fabric', lumpySphere(0.058, 1, 0.18, rng), mat(tx + Math.cos(0.5) * s2 * 0.19, 0.05, tz - Math.sin(0.5) * s2 * 0.19), { tint: 0xe8d8b0 });
      k.add('fabric', lumpySphere(0.055, 1, 0.1, rng), mat(tx + 0.36, 0.055, tz + 0.12), { tint: 0xc8d850 });
    }
    // Coat rack + straw hat + scarf, boots
    // Mudroom nook along the front knee wall left of the door (coat rack, boot tray, lantern, seed chest):
    // the door lane (x 5.5–7.5) stays clear from the door right up to the rug.
    // (r10: one mudroom vignette in a row along the front-left knee wall, x 1.1–5.3: coat stand in the
    // corner by the fig, the seed chest as the boot bench with the lantern + egg basket on it, the boot
    // tray in front of it, today's harvest crate + pumpkin at the end by the door lane)
    const rx = 1.35;
    const rz = 7.45;
    k.cyl('wood', 0.2, 0.24, 0.06, [rx, 0, rz], { tint: OAK });
    k.cyl('wood', 0.05, 0.06, 1.75, [rx, 0.05, rz], { tint: OAK });
    k.sphere('wood', 0.07, [rx, 1.82, rz], OAK);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      k.cyl('wood', 0.022, 0.022, 0.24, [rx + Math.cos(a) * 0.09, 1.58, rz + Math.sin(a) * 0.09], { rz: -Math.cos(a) * 0.9, rx: Math.sin(a) * 0.9, tint: OAK });
    }
    // A waxed barn coat hanging off the back peg (folds: three tapered panels + a collar)
    for (let f = 0; f < 3; f++) k.add('fabric', new THREE.CylinderGeometry(0.07, 0.12, 0.95, 8), mat(rx - 0.1 + f * 0.07, 1.05, rz - 0.1, 0.08, 0, (f - 1) * 0.06), { tint: f === 1 ? 0x56683e : 0x62744a });
    k.add('fabric', new THREE.TorusGeometry(0.09, 0.03, 5, 12), mat(rx - 0.03, 1.52, rz - 0.08, Math.PI / 2, 0, 0), { tint: 0x7a5a3a });
    k.cyl('thatch', 0.28, 0.28, 0.025, [rx + 0.1, 1.62, rz + 0.05], { tint: 0xe6c275, rz: 0.3 });
    k.cyl('thatch', 0.13, 0.15, 0.13, [rx + 0.12, 1.64, rz + 0.05], { tint: 0xe6c275, rz: 0.3 });
    k.cyl('fabric', 0.155, 0.155, 0.03, [rx + 0.12, 1.66, rz + 0.05], { tint: 0x3d6f8f, rz: 0.3 });
    k.box('fabric', [0.1, 0.8, 0.04], [rx - 0.1, 0.8, rz + 0.02], { tint: 0xe07a5f, rz: 0.08 });
    // Boot tray inside the door: a slatted tray, muddy boots, a pair of clogs
    const btx = 3.55;
    const btz = 7.5;
    k.box('wood', [0.8, 0.04, 0.42], [btx, 0, btz], { tint: 0x8a6442, r: 0.01 });
    for (let i = 0; i < 5; i++) k.box('wood', [0.04, 0.03, 0.4], [btx - 0.32 + i * 0.16, 0.04, btz], { tint: 0x6a4a30 });
    for (const s of [0, 1]) {
      k.box('paint', [0.13, 0.3, 0.16], [btx - 0.2 + s * 0.16, 0.05, btz - 0.06], { tint: 0x5a3a24, r: 0.04 });
      k.box('paint', [0.13, 0.08, 0.28], [btx - 0.2 + s * 0.16, 0.05, btz], { tint: 0x5a3a24, r: 0.03 });
      k.box('paint', [0.135, 0.04, 0.12], [btx - 0.2 + s * 0.16, 0.05, btz + 0.08], { tint: 0x7a5a3a, r: 0.015 });
      k.box('paint', [0.12, 0.07, 0.24], [btx + 0.18 + s * 0.14, 0.05, btz + 0.02], { tint: 0xc0503a, r: 0.03, ry: 0.15 });
    }
    this.solid(3.15, 7.25, 3.95, 7.8, 'boot-tray');
    const eb = new THREE.LatheGeometry([[0, 0], [0.12, 0], [0.16, 0.04], [0.17, 0.12], [0.15, 0.12], [0.14, 0.04], [0, 0.03]].map(([a, b]) => new THREE.Vector2(a!, b!)), 18);
    // Egg basket set on the seed chest's lid (left end)
    const ebx = 1.98;
    const eby = 0.53;
    const ebz = 7.42;
    k.add('thatch', eb, mat(ebx, eby, ebz), { tint: 0xc89a60 });
    k.add('thatch', new THREE.TorusGeometry(0.14, 0.012, 4, 16, Math.PI), mat(ebx, eby + 0.12, ebz, 0, 0.6, 0), { tint: 0xb08850 });
    for (let i = 0; i < 5; i++) k.sphere('ceramic', 0.045, [ebx - 0.05 + (i % 3) * 0.06, eby + 0.13 + Math.floor(i / 3) * 0.04, ebz - 0.04 + (i % 2) * 0.07], i % 2 ? 0xd99a62 : 0xf6eee0, [1, 1.25, 1]);
    // Big potted plant (front right) + a watering can by it
    this.pottedPlant(k, rng, 12.3, 7.3, 0, 1.2);
    // Grandmother's writing desk under the east window: the letter, ink, a quill, spectacles
    const dx = 12.45;
    const dz = 5.7;
    k.box('wood', [0.7, 0.05, 1.2], [dx, 0.74, dz], { tint: OAK, r: 0.02, uv: 1.5 });
    k.box('wood', [0.6, 0.16, 1.1], [dx, 0.58, dz], { tint: 0xa87040 });
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) k.cyl('wood', 0.025, 0.02, 0.58, [dx + sx * 0.28, 0, dz + sz * 0.52], { tint: 0xa87040 });
    k.box('paint', [0.3, 0.004, 0.22], [dx - 0.05, 0.79, dz + 0.05], { tint: 0xf6ecd4, ry: 0.15, r: 0.001 });
    k.box('paint', [0.3, 0.004, 0.22], [dx - 0.02, 0.795, dz - 0.22], { tint: 0xefe0c0, ry: -0.2, r: 0.001 });
    k.cyl('ceramic', 0.035, 0.04, 0.05, [dx + 0.15, 0.79, dz + 0.35], { tint: 0x1a2a4a });
    k.add('fabric', new THREE.ConeGeometry(0.02, 0.3, 5), mat(dx + 0.13, 0.95, dz + 0.36, 0.3, 0, 0.4), { tint: 0xf4f0e8 });
    k.add('iron', new THREE.TorusGeometry(0.03, 0.005, 5, 12), mat(dx - 0.1, 0.8, dz - 0.4, Math.PI / 2, 0, 0), { tint: 0xc8a050 });
    k.add('iron', new THREE.TorusGeometry(0.03, 0.005, 5, 12), mat(dx - 0.1, 0.8, dz - 0.32, Math.PI / 2, 0, 0), { tint: 0xc8a050 });
    this.chair(k, dx - 0.72, dz, Math.PI / 2 + Math.PI, 0x9a6440);
    // Brass desk lamp with a green glass shade (the east side's evening pool of light)
    k.cyl('brass', 0.08, 0.09, 0.025, [dx + 0.12, 0.79, dz - 0.05]);
    k.cyl('brass', 0.012, 0.012, 0.3, [dx + 0.12, 0.8, dz - 0.05]);
    k.add('glow', new THREE.SphereGeometry(0.05, 12, 10), mat(dx + 0.12, 1.08, dz - 0.05), { tint: 0xfff2d0 });
    k.add('glow', new THREE.CylinderGeometry(0.07, 0.15, 0.12, 18, 1, true), mat(dx + 0.12, 1.12, dz - 0.05), { tint: 0x58a878 });
    this.addLamp(new THREE.Vector3(dx - 0.35, 1.45, dz - 0.05), 0xffcf8a, 0, 1.25, 0.02, 5);
    this.glowPool(dx - 0.5, dz, 1.3, 0xffb060, () => this.light.night * 0.07);
    // Grandmother's spinning wheel + a basket of carded wool (the empty east floor)
    // (r12: pushed back against the wardrobe wall and the loose wool basket gone — no floor strays in
    // the lane from the bedroom doorway to the front door)
    this.spinningWheel(k, 11.75, 4.55, -1.2);
    // Entry bench (front right): a settle with a plaid cushion, a basket of apples + a farm-gloves pair,
    // a tin milk can at its end — the farmer’s drop zone by the door.
    // (front right, against the knee wall: clear of the door lane)
    const bx = 8.45;
    const bz = 7.5;
    k.box('wood', [1.45, 0.07, 0.42], [bx, 0.44, bz], { tint: OAK, r: 0.025, uv: 1.4 });
    for (const sx of [-1, 1]) {
      k.box('wood', [0.07, 0.62, 0.44], [bx + sx * 0.7, 0, bz], { tint: WALNUT, r: 0.02 });
      k.box('wood', [0.1, 0.05, 0.5], [bx + sx * 0.7, 0.62, bz], { tint: WALNUT, r: 0.02 });
    }
    k.box('wood', [1.35, 0.05, 0.05], [bx, 0.12, bz - 0.15], { tint: 0x8a5a38 });
    k.add('fabric', roundedBox(0.66, 0.08, 0.36, 0.035), mat(bx - 0.3, 0.51, bz - 0.02, 0, 0.03, 0), { tint: 0x9a3a3a });
    for (let i = 0; i < 3; i++) k.box('fabric', [0.66, 0.084, 0.02], [bx - 0.3, 0.508, bz - 0.12 + i * 0.1], { tint: 0x2a4a3a, ry: 0.03 });
    const ab = new THREE.LatheGeometry([[0, 0], [0.13, 0], [0.17, 0.04], [0.18, 0.13], [0.16, 0.13], [0.15, 0.04], [0, 0.03]].map(([a, b]) => new THREE.Vector2(a!, b!)), 18);
    k.add('thatch', ab, mat(bx + 0.35, 0.475, bz - 0.02), { tint: 0xc89a60 });
    for (let i = 0; i < 6; i++) k.sphere('ceramic', 0.052, [bx + 0.29 + (i % 3) * 0.06, 0.6 + Math.floor(i / 3) * 0.045, bz - 0.06 + (i % 2) * 0.07], i === 4 ? 0x9ab83a : i % 2 ? 0xb8262a : 0xd8442e);
    k.add('fabric', roundedBox(0.16, 0.03, 0.1, 0.012), mat(bx + 0.02, 0.495, bz - 0.08, 0, 0.5, 0), { tint: 0xc8a068 });
    k.add('fabric', roundedBox(0.16, 0.03, 0.1, 0.012), mat(bx + 0.06, 0.52, bz - 0.05, 0, 0.8, 0.1), { tint: 0xb89058 });
    k.cyl('tin', 0.1, 0.12, 0.34, [bx + 0.98, 0, bz - 0.02], { tint: 0xc8d0d4, seg: 18 });
    k.cyl('tin', 0.07, 0.1, 0.08, [bx + 0.98, 0.34, bz - 0.02], { tint: 0xc8d0d4, seg: 18 });
    k.cyl('tin', 0.075, 0.075, 0.04, [bx + 0.98, 0.42, bz - 0.02], { tint: 0xb0b8bc, seg: 18 });
    this.solid(7.65, 7.15, 9.6, 7.9, 'bench');
    // Seed chest (front left): a painted blanket-box of seed packets, a crate of seed potatoes, sacks
    const cx = 2.4;
    const cz = 7.45;
    k.box('paint', [1.0, 0.46, 0.5], [cx, 0.04, cz], { tint: CAB, r: 0.03, ao: 0.25 });
    k.box('wood', [1.06, 0.06, 0.56], [cx, 0.5, cz], { tint: BLOCK, r: 0.025 });
    for (const sx of [-1, 1]) k.box('brass', [0.05, 0.36, 0.02], [cx + sx * 0.38, 0.1, cz - 0.26], { tint: 0x8a6a3a });
    k.box('paint', [0.4, 0.2, 0.012], [cx, 0.18, cz - 0.255], { tint: 0xf2e6c8 });
    for (const [px, pr, c] of [[0.02, -0.15, 0x7ab04a], [0.2, 0.35, 0xd86a8a]] as const) {
      k.box('paint', [0.13, 0.012, 0.18], [cx + px, 0.566, cz + (pr > 0 ? -0.05 : 0.06)], { tint: c, ry: pr, r: 0.003 });
      k.box('paint', [0.09, 0.013, 0.06], [cx + px, 0.572, cz + (pr > 0 ? -0.05 : 0.06)], { tint: 0xf6efe0, ry: pr, r: 0.003 });
    }
    this.solid(1.85, 7.1, 2.95, 7.8, 'seed-chest');
    // Hurricane lantern on the floor by the seed chest: the door side's own warm pool at night (the
    // lower floor no longer falls off into black between the hearth glow and the front wall).
    // (r10: stood on the seed chest's lid, right end — part of the mudroom group, not a floor stray)
    const hx = 2.68;
    const hz = 7.48;
    const hy = 0.53;
    k.cyl('tin', 0.13, 0.15, 0.06, [hx, hy, hz], { tint: 0x8a3a2a, seg: 16 });
    k.cyl('tin', 0.1, 0.12, 0.08, [hx, hy + 0.06, hz], { tint: 0xa84a32, seg: 16 });
    // Amber glass chimney with a small hot flame inside (a white globe blew out to a flat disc at night)
    k.add('glow', new THREE.SphereGeometry(0.1, 14, 10), mat(hx, hy + 0.25, hz, 0, 0, 0, 1, 1.45, 1), { tint: 0xd88a40 });
    k.add('glow', new THREE.SphereGeometry(0.035, 10, 8), mat(hx, hy + 0.24, hz + 0.05, 0, 0, 0, 1, 1.7, 1), { tint: 0xfff0c8 });
    k.cyl('tin', 0.07, 0.11, 0.06, [hx, hy + 0.4, hz], { tint: 0x8a3a2a, seg: 16 });
    for (const s2 of [-1, 1]) k.cyl('iron', 0.008, 0.008, 0.32, [hx + s2 * 0.12, hy + 0.1, hz], { tint: 0x2a2624, rz: -s2 * 0.08 });
    k.add('iron', new THREE.TorusGeometry(0.09, 0.008, 5, 14, Math.PI), mat(hx, hy + 0.47, hz), { tint: 0x2a2624 });
    // (Glow pools, not point lights: every point light is paid per pixel by every lit material in the
    // room, and the farmhouse already carries the hearth, four lamps and the farmer's rim.)
    // (kept inside the knee wall: an additive floor card past it glowed over the void under the diorama)
    this.glowPool(hx + 0.1, hz - 0.95, 1.45, 0xffa458, () => this.light.night * 0.22 * (1 - this.dim));
    this.glowPool(hx, hz - 0.1, 0.8, 0xffc080, () => this.light.night * 0.4 * (1 - this.dim), 0.02);
    // Gran's blanket trunk against the front knee wall (front right, beside the entry bench): painted
    // sea-green with a domed lid, brass corners + hasp, leather straps, a folded quilt on top (r6: off the
    // open floor — the middle of the room is walking space).
    {
      const tx = 10.7;
      const tz = 7.4;
      // (r7: angled off the knee wall — a row of furniture square to the front edge read as a showroom)
      const ry = -0.24;
      const P = (lx: number, ly: number, lz: number, rx = 0, rry = 0, rz = 0) => mat(tx + lx * Math.cos(ry) + lz * Math.sin(ry), ly, tz - lx * Math.sin(ry) + lz * Math.cos(ry), rx, ry + rry, rz);
      k.add('paint', roundedBox(0.96, 0.4, 0.52, 0.03), P(0, 0.2, 0), { tint: 0x5a8a82 });
      const lid = new THREE.CylinderGeometry(0.26, 0.26, 0.96, 18, 1, false, 0, Math.PI);
      lid.rotateZ(Math.PI / 2);
      lid.scale(1, 0.42, 1);
      k.add('paint', lid, P(0, 0.4, 0), { tint: 0x4e7c74 });
      for (const sx of [-0.3, 0.3]) {
        k.add('wood', roundedBox(0.07, 0.43, 0.545, 0.01), P(sx, 0.2, 0), { tint: 0x6a4028 });
        k.add('wood', new THREE.TorusGeometry(0.262, 0.018, 4, 16, Math.PI).scale(1, 0.42, 1), P(sx, 0.4, 0, 0, Math.PI / 2, 0), { tint: 0x6a4028 });
      }
      for (const sx of [-0.47, 0.47]) for (const sz of [-0.25, 0.25]) k.add('brass', roundedBox(0.06, 0.4, 0.06, 0.01), P(sx, 0.2, sz));
      k.add('brass', roundedBox(0.08, 0.1, 0.02, 0.008), P(0, 0.34, 0.265));
      // Folded quilt (a thick stack, slightly askew)
      k.add('quilt', roundedBox(0.58, 0.11, 0.4, 0.04), P(-0.08, 0.56, 0.02, 0, 0.12, 0));
      k.add('fabric', roundedBox(0.5, 0.05, 0.34, 0.02), P(-0.1, 0.64, 0.04, 0, 0.2, 0), { tint: 0xe8dcc0 });
    }
    this.playCorner(k, rng);
    this.readingNook(k, rng);
    this.dairyCorner(k, rng);
    this.statics.push(k.build('front'));
    this.solid(11.2, 4.0, 12.3, 5.1, 'spinning-wheel');
    this.solid(10.1, 7.15, 11.2, 7.8, 'blanket-trunk');
    this.solid(1.1, 7.2, 1.6, 7.8, 'coat-rack');
    this.solid(11.9, 6.9, 12.8, 7.7, 'plant');
    this.solid(11.6, 5.0, 13, 6.4, 'desk');
  }

  /**
   * Lower-left floor: a wall sconce whose warm pool keeps the front half of the room readable at night.
   * (r8: the rocking horse / toy basket / cushion island is gone — loose props in the walking floor read
   * as a furniture showroom; the planks between the dining rug and the mudroom stay open.)
   */
  private playCorner(k: Kit, _rng: Rng): void {
    const cx = 3.25;
    const cz = 6.15;
    // Wall sconce on the left wall over the corner: brass plate, curled arm, a frosted tulip shade
    const wx = 0.13;
    const wz = 6.1;
    k.box('brass', [0.03, 0.22, 0.12], [wx, 1.55, wz], { r: 0.01 });
    k.add('brass', new THREE.TorusGeometry(0.08, 0.01, 5, 12, Math.PI), mat(wx + 0.08, 1.7, wz, 0, 0, Math.PI));
    k.add('glow', new THREE.SphereGeometry(0.06, 12, 10), mat(wx + 0.16, 1.74, wz, 0, 0, 0, 1, 1.2, 1), { tint: 0xffe2b0 });
    k.add('ceramic', new THREE.CylinderGeometry(0.11, 0.06, 0.13, 16, 1, true), mat(wx + 0.16, 1.82, wz), { tint: 0xf4d8a8 });
    this.glowPool(1.2, 6.2, 1.9, 0xffa858, () => this.light.night * 0.2 * (1 - this.dim));
    this.glowPool(cx, cz, 1.5, 0xffb870, () => this.light.night * 0.08 * (1 - this.dim));
  }

  /**
   * Reading corner under the wall sconce by the bookshelf: Gran's armchair turned to the room and a round
   * side table with a book stack + teacup — both against the left wall. (r12: no rug / footstool island,
   * and the knitting pouf + yarn rug by the spinning wheel are gone: the critic counted too many floor
   * islands at equal weight; the open planks now carry the bed-to-door lane.)
   */
  private readingNook(k: Kit, _rng: Rng): void {
    const ax = 1.45;
    const az = 6.05;
    // Gran's reading chair in faded sage velvet (the hearth chair is the rose one)
    this.armchair(k, ax, az, 0.95, 0x6f8e78, 0x86a48c);
    // Side table: round oak top, turned stem, a stack of books + teacup on a saucer
    const tx = 2.35;
    const tz = 5.6;
    k.cyl('wood', 0.22, 0.22, 0.035, [tx, 0.55, tz], { tint: OAK, seg: 20 });
    k.cyl('wood', 0.03, 0.04, 0.55, [tx, 0, tz], { tint: WALNUT });
    k.cyl('wood', 0.15, 0.17, 0.03, [tx, 0, tz], { tint: WALNUT });
    for (const [i, c] of [[0, 0x8a3a3a], [1, 0x3a5a7a], [2, 0xc8a050]] as const) k.box('paint', [0.24 - i * 0.02, 0.045, 0.17], [tx - 0.06, 0.585 + i * 0.047, tz - 0.02], { tint: c, ry: 0.3 - i * 0.25, r: 0.008 });
    k.cyl('ceramic', 0.075, 0.075, 0.012, [tx + 0.12, 0.585, tz + 0.08], { tint: 0xf2eee4 });
    k.cyl('ceramic', 0.045, 0.035, 0.06, [tx + 0.12, 0.595, tz + 0.08], { tint: 0xe8f0f4 });
    this.solid(0.95, 5.55, 2.0, 6.55, 'armchair');
    this.solid(2.1, 5.35, 2.6, 5.85, 'side-table');
  }

  /**
   * Lower-right floor: a reading lamp by the desk whose pool keeps the front-right corner readable at
   * night. (r8: the churn / stool / veg-crate island is gone — open floor between the spinning wheel and
   * the entry bench.)
   */
  private dairyCorner(k: Kit, _rng: Rng): void {
    // Floor lamp in the front-right corner by the desk: turned walnut stem, pleated cream shade
    const lx = 11.55;
    const lz = 6.75;
    k.cyl('wood', 0.16, 0.19, 0.05, [lx, 0, lz], { tint: WALNUT, seg: 18 });
    // (a reading-lamp height, not a pole: from the high camera a tall stem read as a toppled stick; the
    // shade is a closed drum — open-ended, its inside showed as a dark cut-out disc)
    k.cyl('wood', 0.022, 0.03, 1.0, [lx, 0.05, lz], { tint: WALNUT });
    k.sphere('wood', 0.04, [lx, 0.5, lz], WALNUT);
    k.add('glow', new THREE.SphereGeometry(0.07, 12, 10), mat(lx, 1.02, lz), { tint: 0xffe8c0 });
    // (r10: the pleated shade is lit — glows warm after sunset like every other lamp in the room)
    // (r16: a pale parchment shade — the old burnt-orange tint glowed so dimly it read as a dead prop)
    k.add('glow', new THREE.CylinderGeometry(0.15, 0.24, 0.26, 20, 1, false), mat(lx, 1.17, lz), { tint: 0xffc890 });
    k.add('glow', new THREE.TorusGeometry(0.24, 0.01, 4, 22), mat(lx, 1.04, lz, Math.PI / 2, 0, 0), { tint: 0xffd8a0 });
    k.add('fabric', new THREE.TorusGeometry(0.15, 0.012, 4, 20), mat(lx, 1.3, lz, Math.PI / 2, 0, 0), { tint: 0xc87a4a });
    this.solid(lx - 0.2, lz - 0.2, lx + 0.2, lz + 0.2, 'floor-lamp');
    this.glowPool(lx - 0.3, lz, 2.3, 0xffa858, () => this.light.night * 0.5 * (1 - this.dim));
    this.addLamp(new THREE.Vector3(lx, 1.0, lz), 0xffb870, 0, 0.9, 0.02, 3.6);
  }

  // ───────────────────────────────────────────── furniture helpers

  /** Saxony spinning wheel: slanted bench on three legs, big spoked wheel, treadle, distaff of wool. */
  private spinningWheel(k: Kit, x: number, z: number, ry: number): void {
    const tint = 0x9a6440;
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const m = (lx: number, ly: number, lz: number, rx = 0, rz = 0) => mat(x + lx * c + lz * s, ly, z - lx * s + lz * c, rx, ry, rz);
    k.add('wood', roundedBox(0.95, 0.07, 0.24, 0.02), m(0, 0.42, 0, 0, 0.12), { tint });
    for (const [lx, lz] of [[-0.4, -0.09], [-0.4, 0.09], [0.4, 0]] as const) k.add('wood', new THREE.CylinderGeometry(0.02, 0.026, 0.46, 8), m(lx, 0.2, lz, lz * 1.2, lx * 0.25), { tint });
    // Uprights + the wheel
    for (const lz of [-0.07, 0.07]) k.add('wood', new THREE.CylinderGeometry(0.018, 0.02, 0.62, 8), m(-0.2, 0.72, lz), { tint });
    const wheel = new THREE.TorusGeometry(0.32, 0.028, 8, 36);
    k.add('wood', wheel, m(-0.2, 0.92, 0), { tint: 0x8a5634 });
    for (let i = 0; i < 8; i++) k.add('wood', new THREE.CylinderGeometry(0.008, 0.008, 0.62, 5), mat(0, 0, 0).multiply(m(-0.2, 0.92, 0)).multiply(new THREE.Matrix4().makeRotationZ((i / 8) * Math.PI)), { tint });
    k.add('brass', new THREE.CylinderGeometry(0.035, 0.035, 0.18, 12).rotateX(Math.PI / 2), m(-0.2, 0.92, 0));
    // Flyer + bobbin, drive band
    k.add('wood', roundedBox(0.2, 0.05, 0.05, 0.015), m(0.3, 0.62, 0), { tint });
    k.add('fabric', new THREE.CylinderGeometry(0.035, 0.035, 0.1, 10).rotateZ(Math.PI / 2), m(0.3, 0.68, 0), { tint: 0xf0e8d8 });
    k.add('fabric', new THREE.CylinderGeometry(0.004, 0.004, 0.62, 3), m(0.05, 0.8, 0.03, 0, 1.05), { tint: 0xe8dcc0 });
    // Distaff with a cloud of wool, treadle
    k.add('wood', new THREE.CylinderGeometry(0.012, 0.015, 0.5, 6), m(0.38, 0.72, 0, 0, -0.25), { tint });
    k.add('fabric', lumpySphere(0.09, 1, 0.3, new Rng('distaff')), m(0.43, 0.98, 0), { tint: 0xf4efe4 });
    k.add('wood', roundedBox(0.3, 0.025, 0.16, 0.01), m(-0.05, 0.05, 0, 0, -0.15), { tint });
  }

  /**
   * Bedroom nook: a proper half wall off the living room (x = 9.3) — beadboard on a dark skirting, a
   * wide cream top rail you can read from the high camera, running from the back wall to the bedroom
   * doorway and on again past it, each run ending in a turned newel post with a ball finial. The
   * doorway between (z 1.3–3.2) carries a short sill board and a rag rug threshold.
   * (r9: the old framed archway stood edge-on to the lens — from the gameplay camera it read as a
   * freestanding post and a shelf stub floating mid-floor)
   */
  private partition(): void {
    const k = new Kit();
    const x = 9.3;
    const h = 1.02;
    const TRIM = 0xf2e8d2;
    const NEWEL = 0xb47e50;
    const run = (z0: number, z1: number, ends: number[]): void => {
      const len = z1 - z0;
      const zc = (z0 + z1) / 2;
      k.box('bead', [0.2, h, len], [x, 0, zc], { tint: 0x98b0a8, uv: 1 });
      k.box('paint', [0.22, 0.13, len], [x, 0, zc], { tint: 0x5e4232 });
      // Top rail: a wide cream cap with a moulded lip under it (a clear line from above)
      k.box('paint', [0.3, 0.06, len + 0.06], [x, h, zc], { tint: TRIM, r: 0.018 });
      k.box('paint', [0.25, 0.04, len], [x, h - 0.04, zc], { tint: 0xd8ccb0, r: 0.01 });
      for (const ez of ends) {
        k.box('paint', [0.19, h + 0.2, 0.19], [x, 0, ez], { tint: NEWEL, r: 0.03 });
        k.box('paint', [0.24, 0.06, 0.24], [x, h + 0.2, ez], { tint: TRIM, r: 0.018 });
        k.sphere('wood', 0.085, [x, h + 0.33, ez], NEWEL);
      }
    };
    run(0.02, 1.3, [1.3]);
    run(3.2, 4.05, [3.2, 4.05]);
    // Doorway sill + a little rag rug across the threshold into the bedroom
    k.box('wood', [0.24, 0.025, 1.78], [x, 0, 2.25], { tint: 0x8a5a38, r: 0.008 });
    k.add('runner', floorPlane(0.7, 0.9), mat(x + 0.5, 0.008, 2.25, 0, Math.PI / 2, 0));
    // Dressing on the rails: a jug of meadow flowers and two books on the front run, a folded shawl
    // draped over the back run
    const fz = 3.62;
    k.cyl('ceramic', 0.055, 0.045, 0.14, [x, h + 0.06, fz], { tint: 0x5a7ea0, seg: 14 });
    for (let i = 0; i < 5; i++) k.sphere('fabric', 0.03, [x + Math.cos(i * 1.3) * 0.05, h + 0.24 + (i % 2) * 0.03, fz + Math.sin(i * 1.3) * 0.05], [0xf4f0e4, 0xe8a0b0, 0xf4d060, 0xc8a0e0, 0xf4f0e4][i]!);
    k.box('paint', [0.15, 0.04, 0.22], [x, h + 0.06, 3.38], { tint: 0x8a3a3a, r: 0.008 });
    k.box('paint', [0.14, 0.035, 0.2], [x, h + 0.1, 3.39], { tint: 0x3a5a7a, r: 0.008, ry: 0.15 });
    k.add('fabric', roundedBox(0.26, 0.05, 0.42, 0.02), mat(x, h + 0.06, 0.62, 0, 0.05, 0), { tint: 0x7a9a8a });
    k.add('fabric', roundedBox(0.24, 0.03, 0.4, 0.015), mat(x, h + 0.1, 0.63, 0, -0.06, 0), { tint: 0xe8dcc0 });
    this.statics.push(k.build('bed-nook'));
    this.solid(9.2, 0, 9.4, 1.35, 'partition');
    this.solid(9.2, 3.15, 9.4, 4.05, 'partition-stub');
  }

  /** A low two-seat sofa (sage velvet), back to the door: cushions, rolled arms, a knitted throw. */
  private loveseat(k: Kit, rng: Rng, x: number, z: number): void {
    const fab = 0x6f9a86;
    const dk = 0x5a8472;
    const W2 = 1.5;
    k.add('fabric', roundedBox(W2, 0.28, 0.74, 0.08, 3), mat(x, 0.24, z), { tint: dk });
    for (const s of [-1, 1]) k.add('fabric', roundedBox(0.68, 0.14, 0.62, 0.06, 3), mat(x + s * 0.35, 0.44, z - 0.04), { tint: fab });
    k.add('fabric', roundedBox(W2 - 0.04, 0.52, 0.2, 0.09, 3), mat(x, 0.6, z + 0.3, 0.14, 0, 0), { tint: fab });
    for (const s of [-1, 1]) {
      k.add('fabric', roundedBox(0.16, 0.3, 0.74, 0.07, 3), mat(x + s * 0.73, 0.5, z), { tint: dk });
      k.add('fabric', new THREE.CylinderGeometry(0.1, 0.1, 0.74, 12).rotateX(Math.PI / 2), mat(x + s * 0.73, 0.66, z), { tint: fab });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add('wood', new THREE.CylinderGeometry(0.03, 0.02, 0.12, 8), mat(x + sx * 0.66, 0.05, z + sz * 0.3), { tint: WALNUT });
    // Cushions: a cream embroidered one + a mustard one; a knitted throw over the right arm
    k.add('fabric', roundedBox(0.36, 0.3, 0.12, 0.06, 2), mat(x - 0.42, 0.66, z + 0.14, -0.35, 0.2, 0), { tint: 0xf2e6c8 });
    k.add('fabric', roundedBox(0.32, 0.28, 0.12, 0.06, 2), mat(x + 0.4, 0.65, z + 0.14, -0.3, -0.25, 0), { tint: 0xe0a840 });
    k.add('fabric', roundedBox(0.5, 0.03, 0.8, 0.012), mat(x + 0.58, 0.8, z + 0.02, 0, 0, -0.35), { tint: 0xe07a5f });
    k.add('fabric', roundedBox(0.03, 0.4, 0.8, 0.012), mat(x + 0.84, 0.55, z + 0.02, 0, 0, 0.12), { tint: 0xe07a5f });
    for (let i = 0; i < 5; i++) k.add('fabric', roundedBox(0.52, 0.035, 0.03, 0.01), mat(x + 0.58, 0.815, z - 0.3 + i * 0.15, 0, 0, -0.35), { tint: 0xf2d0b8 });
    void rng;
  }

  private table(k: Kit, x: number, z: number, w: number, d: number): void {
    k.box('wood', [w, 0.06, d], [x, 0.74, z], { tint: OAK, uv: 1.5, r: 0.025 });
    k.box('wood', [w - 0.16, 0.1, d - 0.16], [x, 0.64, z], { tint: 0xa87040 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const g = new THREE.LatheGeometry([new THREE.Vector2(0.03, 0), new THREE.Vector2(0.045, 0.1), new THREE.Vector2(0.035, 0.3), new THREE.Vector2(0.05, 0.45), new THREE.Vector2(0.035, 0.6), new THREE.Vector2(0.045, 0.74)], 10);
      k.add('wood', g, mat(x + sx * (w / 2 - 0.1), 0, z + sz * (d / 2 - 0.1)), { tint: 0xa87040 });
    }
  }

  private chair(k: Kit, x: number, z: number, ry: number, tint: number): void {
    const m = (lx: number, ly: number, lz: number, rx = 0) => {
      const c = Math.cos(ry);
      const s = Math.sin(ry);
      return mat(x + lx * c + lz * s, ly, z - lx * s + lz * c, rx, ry, 0);
    };
    k.add('wood', roundedBox(0.44, 0.05, 0.42, 0.02), m(0, 0.46, 0), { tint });
    k.add('fabric', roundedBox(0.38, 0.05, 0.36, 0.025, 2), m(0, 0.5, 0.01), { tint: 0xd8743a });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add('wood', new THREE.CylinderGeometry(0.02, 0.022, 0.46, 8), m(sx * 0.18, 0.23, sz * 0.17), { tint });
    for (const sx of [-1, 1]) k.add('wood', new THREE.CylinderGeometry(0.02, 0.022, 0.5, 8), m(sx * 0.18, 0.72, -0.19, -0.1), { tint });
    k.add('wood', roundedBox(0.42, 0.1, 0.03, 0.01), m(0, 0.92, -0.21, -0.1), { tint });
    for (let i = 0; i < 3; i++) k.add('wood', roundedBox(0.03, 0.34, 0.02, 0.008), m(-0.09 + i * 0.09, 0.7, -0.195, -0.1), { tint });
  }

  private armchair(k: Kit, x: number, z: number, ry: number, fab = 0xc27a78, seat = 0xd08a86): void {
    const m = (lx: number, ly: number, lz: number, rx = 0) => {
      const c = Math.cos(ry);
      const s = Math.sin(ry);
      return mat(x + lx * c + lz * s, ly, z - lx * s + lz * c, rx, ry, 0);
    };
    k.add('fabric', roundedBox(0.9, 0.3, 0.8, 0.1, 3), m(0, 0.3, 0), { tint: fab });
    k.add('fabric', roundedBox(0.72, 0.14, 0.62, 0.07, 3), m(0, 0.5, 0.06), { tint: seat });
    k.add('fabric', roundedBox(0.86, 0.66, 0.2, 0.1, 3), m(0, 0.72, -0.32, -0.12), { tint: fab });
    for (const s of [-1, 1]) k.add('fabric', roundedBox(0.16, 0.34, 0.74, 0.08, 3), m(s * 0.4, 0.54, 0.02), { tint: fab });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add('wood', new THREE.CylinderGeometry(0.03, 0.02, 0.16, 8), m(sx * 0.36, 0.08, sz * 0.32), { tint: WALNUT });
    k.add('fabric', roundedBox(0.36, 0.3, 0.12, 0.06, 2), m(0.12, 0.7, -0.14, -0.3), { tint: 0xf0d8a0 });
  }

  private rocker(k: Kit, x: number, z: number, ry: number): void {
    const tint = 0x9a6440;
    const m = (lx: number, ly: number, lz: number, rx = 0, rz = 0) => {
      const c = Math.cos(ry);
      const s = Math.sin(ry);
      return mat(x + lx * c + lz * s, ly, z - lx * s + lz * c, rx, ry, rz);
    };
    for (const s of [-1, 1]) {
      const run = new THREE.TorusGeometry(1.2, 0.025, 5, 20, 0.7);
      run.rotateZ(-Math.PI / 2 - 0.35);
      run.rotateY(Math.PI / 2);
      k.add('wood', run, m(s * 0.22, 1.23, 0.02), { tint });
      for (const sz of [-1, 1]) k.add('wood', new THREE.CylinderGeometry(0.022, 0.022, 0.42, 8), m(s * 0.22, 0.24, sz * 0.2), { tint });
      k.add('wood', new THREE.CylinderGeometry(0.022, 0.024, 0.66, 8), m(s * 0.22, 0.78, -0.24, -0.18), { tint });
      k.add('wood', roundedBox(0.05, 0.04, 0.46, 0.015), m(s * 0.25, 0.64, 0), { tint });
    }
    k.add('wood', roundedBox(0.5, 0.05, 0.48, 0.02), m(0, 0.46, 0), { tint });
    for (let i = 0; i < 5; i++) k.add('wood', new THREE.CylinderGeometry(0.012, 0.012, 0.52, 6), m(-0.16 + i * 0.08, 0.78, -0.26, -0.18), { tint });
    k.add('wood', roundedBox(0.52, 0.08, 0.04, 0.015), m(0, 1.08, -0.3, -0.18), { tint });
    // Knitted throw over the back + a cushion
    k.add('fabric', roundedBox(0.5, 0.04, 0.5, 0.02), m(0, 0.5, 0.02), { tint: 0x7aa0c8 });
    k.add('fabric', roundedBox(0.54, 0.5, 0.04, 0.02), m(0.02, 0.72, -0.24, -0.2, 0.05), { tint: 0xe8b050 });
    k.add('fabric', roundedBox(0.2, 0.4, 0.04, 0.02), m(0.2, 0.42, -0.08, 0, 0.1), { tint: 0xe8b050 });
  }

  private pottedPlant(k: Kit, rng: Rng, x: number, z: number, y: number, size: number): void {
    const pr = 0.12 + size * 0.1;
    k.cyl('ceramic', pr, pr * 0.78, pr * 1.3, [x, y, z], { tint: 0xc0683e });
    k.cyl('ceramic', pr * 1.08, pr * 1.08, pr * 0.22, [x, y + pr * 1.12, z], { tint: 0xb05a34 });
    k.cyl('stone', pr * 0.95, pr * 0.95, 0.02, [x, y + pr * 1.2, z], { tint: 0x4a3222 });
    const n = size > 1 ? 14 : 7;
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2;
      const h = y + pr * 1.3 + (size > 1 ? 0.25 + rng.next() * size * 0.85 : rng.next() * 0.25 * size + 0.05);
      const r = (size > 1 ? 0.15 : 0.08) + rng.next() * 0.12 * size;
      const leaf = new THREE.CircleGeometry(size > 1 ? 0.13 : 0.06, 10);
      leaf.scale(0.7, 1.25, 1);
      if (size > 1) k.cyl('leaf', 0.01, 0.012, h - y - pr * 1.2, [x + Math.cos(a) * r * 0.4, y + pr * 1.2, z + Math.sin(a) * r * 0.4], { tint: 0x5a4a2a, rz: Math.cos(a) * 0.12, rx: -Math.sin(a) * 0.12 });
      k.add('leaf', leaf, mat(x + Math.cos(a) * r, h, z + Math.sin(a) * r, -0.9 + rng.next() * 0.5, -a + Math.PI / 2, 0), { tint: rng.next() < 0.5 ? 0x3f7a34 : 0x5a9a44 });
    }
  }

  /** Framed picture from the atlas. `stand` = propped on a shelf (tilted back, easel foot). */
  private photo(k: Kit, name: PhotoName, [x, y, z]: [number, number, number], w: number, h: number, _wall: 'back', stand: boolean, ry = 0): void {
    const frame = stand ? 0x3a2418 : 0x5a3620;
    const tilt = stand ? -0.14 : 0;
    const m = (dy: number, dz: number) => mat(x, y + dy, z + dz, tilt, ry, 0);
    k.add('wood', roundedBox(w + 0.07, h + 0.07, 0.035, 0.012), m(h / 2 + 0.035, 0.018), { tint: frame });
    k.add('paint', roundedBox(w + 0.015, h + 0.015, 0.01, 0.003), m(h / 2 + 0.035, 0.036), { tint: 0xf0e8d8 });
    const g = atlasUV(new THREE.PlaneGeometry(w - 0.02, h - 0.02), PHOTO_CELLS[name]);
    k.add('photo', g, m(h / 2 + 0.035, 0.043));
    void imat;
  }
}

/**
 * A quilt draped over a mattress: local origin at the head-end centre of the mattress top, +z to the
 * foot. Flat top `w` × `l`, edges rolling over a radius `r` and hanging `drop` down both sides and the
 * foot; quilted puff per 25 cm patch; UVs in metres × 0.5 along the cloth (patches stay square over
 * the roll). Hanging corners flare out a little and the hems wave.
 */
function drapedQuilt(w: number, l: number, drop: number, r: number): THREE.BufferGeometry {
  const a = w / 2 - r;
  const arc = (r * Math.PI) / 2;
  const fall = drop - r;
  const S = w / 2 + arc - r + fall + r; // half arc-length across (flat a + roll + hang)
  const T = l - r + arc + fall;
  const ns = 72;
  const nt = 64;
  const map = (u: number, lim: number): [number, number, number] => {
    // → (offset, drop y, fall fraction) for an arc-length u past the flat part `lim`.
    if (u <= lim) return [u, 0, 0];
    const k = u - lim;
    if (k <= arc) {
      const th = k / r;
      return [lim + r * Math.sin(th), -r * (1 - Math.cos(th)), 0];
    }
    const f = k - arc;
    return [lim + r, -r - f, f / Math.max(1e-3, fall)];
  };
  const pos: number[] = [];
  const uv: number[] = [];
  for (let j = 0; j <= nt; j++) {
    const t = (j / nt) * T;
    const [z, yt, ft] = map(t, l - r);
    for (let i = 0; i <= ns; i++) {
      const sa = (i / ns) * 2 * S - S;
      const [xa, ys, fs] = map(Math.abs(sa), a);
      let x = Math.sign(sa) * xa;
      let zz = z;
      let y = Math.max(-drop - 0.04, ys + yt);
      // Hanging corners flare outward; hems wave.
      const f = Math.max(fs, ft);
      x += Math.sign(sa) * 0.05 * fs * ft + Math.sign(sa) * Math.sin(t * 9) * 0.012 * fs;
      zz += 0.05 * fs * ft + Math.sin(sa * 8) * 0.012 * ft;
      // Quilted puff on the top: each 25 cm patch domes, the seams stay down.
      if (ys > -1e-4 && yt > -1e-4) {
        const pu = Math.sin(Math.PI * (((sa / 0.25) % 1) + 1) % 1) * Math.sin(Math.PI * (((t / 0.25) % 1) + 1) % 1);
        y += 0.025 + 0.06 * Math.pow(Math.max(0, pu), 0.35);
      } else y += 0.035 * (1 - f);
      pos.push(x, y, zz);
      uv.push((sa + S) * 0.5, t * 0.5);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nt; j++) {
    for (let i = 0; i < ns; i++) {
      const p = j * (ns + 1) + i;
      idx.push(p, p + ns + 1, p + 1, p + 1, p + ns + 1, p + ns + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A plump pillow (half-sizes hx × hy × hz): squared-off soft body, pinched corners, a crease dent. */
function pillowGeo(hx: number, hy: number, hz: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 28, 16);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const sx = Math.sign(x) * Math.pow(Math.abs(x), 0.55);
    const sz = Math.sign(z) * Math.pow(Math.abs(z), 0.55);
    const edge = Math.max(Math.abs(sx), Math.abs(sz));
    let yy = y * (1 - 0.55 * Math.pow(edge, 3));
    // A soft crease across the middle (where a head rested), off-centre per pillow.
    yy -= 0.22 * Math.exp(-(((sx - 0.15 * seed) / 0.22) ** 2)) * Math.max(0, y);
    p.setXYZ(i, sx * hx, yy * hy, sz * hz);
  }
  g.computeVertexNormals();
  return g;
}
