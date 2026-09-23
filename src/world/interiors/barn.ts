/**
 * The barn, inside: a tall timber-framed hall of warm red boards.
 *
 *   back       six straw-bedded stalls; each has its own manger + a planked half-door on the aisle,
 *              a name plaque on the door, tack on the wall above. Animals live in their own stall
 *              (eat at the manger facing the aisle, sleep in the bedding at the back).
 *   aisle      a board walk along the stall fronts and down to the big door, straw kicked over its edges
 *   left       a hay loft on posts along the wall (bales up top, a ladder), bales + loose hay below,
 *              milking stool and pails by the cow stalls
 *   right      stone water trough, milk cans, shears + halter on pegs, a grain barrel, stacked crates
 *   front      bales along the knee wall, a wheelbarrow of hay, feed sacks by the door
 *   light      two lanterns over the aisle + a lantern between each pair of stalls (lit at night)
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import { Rng } from '../../core/rng';
import { InteriorMap } from './room';
import { Kit } from './kit';
import { mat, roundedBox } from '../geom';
import type { PenAnchors, PenSlot } from './pen';
import { hayPile, hayBale, strawTufts, lanternHook, bucket, pitchfork, feedSack, milkCan, wheelbarrow, crate, strawDrift } from './pen';

export const BARN_EXIT = { x: 46.5, z: 35.9 };

const W = 13;
const D = 9;
const SW = W / 6;
/** Stall front line (mangers + half-doors). */
const SF = 3.1;
const PLANK = 0xc08a62;
const POST = 0x6a4430;

/** Flip a geometry's faces (and normals) so it reads from the inside (the tank's inner wall). */
function insideOut(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = g.getIndex();
  if (idx) {
    const a = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1]!;
      a[i + 1] = a[i + 2]!;
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

export class BarnInterior extends InteriorMap {
  readonly pen: PenAnchors;

  constructor(game: Game) {
    super(game, {
      id: 'barn',
      title: 'Barn',
      W,
      D,
      H: 3.6,
      doorX: 6,
      exit: { to: 'farm', x: BARN_EXIT.x, z: BARN_EXIT.z, facing: 'down' },
      floor: 'straw',
      style: 'barn',
      wallTint: 0xf0bca0,
      timberLight: 1.3,
      floorTint: 0xd0c0a8,
      windows: [
        { wall: 'back', at: 9.5, w: 1.0, y0: 1.9, y1: 2.9 },
        { wall: 'right', at: 3.9, w: 1.0, y0: 1.5, y1: 2.5 },
        { wall: 'left', at: 5.6, w: 0.9, y0: 1.5, y1: 2.4 },
      ],
      sunDir: [-0.55, 0.5, -0.66],
    });
    this.camera = { yaw: 0, pitch: 50, distance: 16.5, offsetX: 0, offsetZ: 0.45 };
    this.dayScale = 1.2;
    this.exposureBoost = 0.2;
    const rng = new Rng('barn-interior');
    const slots: PenSlot[] = Array.from({ length: 6 }, (_, i) => {
      const x0 = i * SW;
      const mx = x0 + 0.66;
      return {
        feed: new THREE.Vector3(mx, 0, SF - 0.24),
        feedHeading: 0,
        bed: new THREE.Vector3(x0 + SW / 2, 0, 1.25),
        bedHeading: 0,
        hay: new THREE.Vector3(mx, 0.5, SF - 0.24),
        stall: { x0: x0 + 0.58, z0: 0.62, x1: x0 + SW - 0.58, z1: SF - 0.3 },
      };
    });
    this.pen = {
      kind: 'barn',
      capacity: 6,
      slots,
      nests: [],
      area: { x0: 0.8, z0: 0.6, x1: 12.2, z1: SF - 0.3 },
      trough: { x0: 0, z0: 2, x1: 12, z1: 2 },
      feedTile: { x: 3, z: 2 },
      plaques: Array.from({ length: 6 }, (_, i) => new THREE.Vector3(i * SW + 1.62, 0.82, SF + 0.075)),
    };
    this.furnish(rng);
    this.finalize();
  }

  private furnish(rng: Rng): void {
    const k = new Kit();
    this.stalls(k, rng);
    this.loft(k, rng);
    this.aisle(k, rng);
    this.statics.push(k.build('barn-furniture'));

    // Stalls are the animals' (the farmer reaches over the manger / door from the aisle).
    this.solid(0, 0, W, SF - 0.5, 'stall');
    this.solid(0, 4.4, 1.2, 7.2, 'loft');
    this.solid(0.2, 3.3, 0.9, 3.9, 'stool');
    this.solid(12.3, 4.1, 13, 5.7, 'water');
    this.solid(11.6, 6.3, 13, 7.0, 'barrel');
    this.solid(0.3, 7.9, 2.9, 8.9, 'bales');
    this.solid(3.3, 7.4, 4.5, 8.4, 'barrow');
    this.solid(4.6, 8.0, 5.5, 8.8, 'sacks');
    this.solid(7.6, 8.0, 8.4, 8.8, 'cans');
    this.solid(9.6, 7.9, 12.8, 8.9, 'crates');
    this.solid(9.6, 5.2, 11.1, 6.6, 'stock-tank');
    this.solid(8.3, 6.6, 9.5, 7.6, 'sawhorse');
    this.solid(2.6, 4.8, 4.5, 5.6, 'grain-bin');

    // Lanterns: two over the aisle, one between each pair of stalls over the bedding.
    const lk = new Kit();
    for (const x of [3.25, 9.75]) {
      lanternHook(lk, x, 3.1, 3.9);
      this.addLamp(new THREE.Vector3(x, 2.7, 3.9), 0xffc27a, 0.6, 3.4, 0.03, 8);
      this.glowPool(x, 3.9, 2.6, 0xffb060, () => 0.05 + this.light.night * 0.14);
    }
    for (const i of [1, 3, 5]) {
      const x = i * SW;
      // Iron bracket on the divider post, lantern hung out over the bedding.
      lk.box('iron', [0.04, 0.04, 0.5], [x, 2.28, 0.45], { tint: 0x2a2624 });
      lanternHook(lk, x, 2.3, 0.68);
      this.addLamp(new THREE.Vector3(x, 1.95, 0.9), 0xffb870, 0.0, 4.2, 0.04, 5);
    }
    this.statics.push(lk.build('barn-lanterns', false));
  }

  /** Six stalls: dividers, bedding, a manger + a half-door on each front, plaques, tack above. */
  private stalls(k: Kit, rng: Rng): void {
    for (let i = 0; i <= 6; i++) {
      const x = THREE.MathUtils.clamp(i * SW, 0.08, W - 0.08);
      if (i > 0 && i < 6) {
        // Divider: board skirt + two rails, darker cap
        k.box('wood', [0.09, 0.92, SF - 0.14], [x, 0, SF / 2 - 0.02], { tint: PLANK, uv: 1.2 });
        k.box('wood', [0.08, 0.12, SF - 0.1], [x, 1.1, SF / 2], { tint: 0xa87050 });
        k.box('wood', [0.13, 0.07, SF - 0.06], [x, 1.32, SF / 2], { tint: POST });
      }
      // Front post with a turned ball cap
      k.box('wood', [0.16, 1.4, 0.16], [x, 0, SF], { tint: POST, ao: 0.3 });
      k.sphere('wood', 0.085, [x, 1.44, SF], POST);
    }
    // Tack rail + pegs on the back wall (halters, coiled ropes, a feed scoop, a lucky horseshoe)
    k.box('wood', [W - 0.2, 0.1, 0.06], [W / 2, 1.9, 0.06], { tint: POST });
    for (let i = 0; i < 6; i++) {
      const x0 = i * SW;
      const cx = x0 + SW / 2;
      // Bedding: a deep straw heap at the back, drifts towards the front
      hayPile(k, rng, cx, 1.1, SW - 0.35, 1.5, 0.2);
      strawDrift(k, rng, cx, SF - 0.9, SW - 0.4, 0.9);
      strawTufts(k, rng, cx, 0.02, 1.8, 26, 0.95);
      this.manger(k, rng, x0 + 0.66);
      this.halfDoor(k, x0 + 1.14, x0 + SW - 0.1, i);
      // Tack above each stall
      const px = cx + 0.5;
      k.cyl('wood', 0.025, 0.025, 0.14, [px, 1.78, 0.08], { rx: Math.PI / 2, tint: POST });
      if (i % 2 === 0) k.add('fabric', new THREE.TorusGeometry(0.14, 0.03, 6, 16), mat(px, 1.62, 0.12, 0.1, 0, 0), { tint: 0xc8a870 });
      else k.add('fabric', new THREE.TorusGeometry(0.12, 0.022, 5, 14), mat(px, 1.62, 0.12, 0.15, 0, 0.3), { tint: [0xb8452e, 0x3a6a9a, 0x4a7a3a][i % 3] });
    }
    k.add('iron', new THREE.TorusGeometry(0.1, 0.022, 6, 14, Math.PI * 1.3), mat(6.5, 2.4, 0.06, 0, 0, -Math.PI * 0.15 + Math.PI), { tint: 0x8a8480 });
    // Salt lick on its board in the last stall
    k.box('ceramic', [0.22, 0.16, 0.18], [12.45, 0.55, 0.2], { tint: 0xf4d8d0, r: 0.03 });
    k.box('wood', [0.32, 0.05, 0.26], [12.45, 0.5, 0.2], { tint: POST });
  }

  /** A slatted feed box at the stall front (the animal's mouth goes in from the stall side). */
  private manger(k: Kit, rng: Rng, x: number): void {
    const z = SF - 0.24;
    const w = 0.96;
    for (const [lx, lz] of [[-0.44, -0.19], [0.44, -0.19], [-0.44, 0.19], [0.44, 0.19]] as const) k.box('wood', [0.07, 0.34, 0.07], [x + lx, 0, z + lz], { tint: POST });
    k.box('wood', [w, 0.05, 0.44], [x, 0.3, z], { tint: 0x8a5a3a });
    k.box('wood', [w + 0.04, 0.36, 0.05], [x, 0.3, z + 0.2], { tint: 0xb07a52, uv: 1.4 });
    k.box('wood', [w + 0.04, 0.2, 0.05], [x, 0.3, z - 0.2], { tint: 0xa87050, uv: 1.4 });
    for (const s of [-1, 1]) k.box('wood', [0.05, 0.36, 0.44], [x + s * (w / 2), 0.3, z], { tint: 0xa06a48 });
    k.box('wood', [w + 0.1, 0.05, 0.09], [x, 0.66, z + 0.2], { tint: POST });
    // A few loose stalks on the rim + the floor under it
    strawTufts(k, rng, x, 0.02, z + 0.35, 8, 0.35);
  }

  /** Planked half-door with a Z brace, iron strap hinges and a latch. */
  private halfDoor(k: Kit, x0: number, x1: number, i: number): void {
    const w = x1 - x0;
    const cx = (x0 + x1) / 2;
    const tint = i % 2 ? 0xb88058 : 0xc08a62;
    const n = 4;
    for (let b = 0; b < n; b++) k.box('wood', [w / n - 0.012, 1.02, 0.05], [x0 + (b + 0.5) * (w / n), 0.06, SF], { tint: b % 2 ? tint : 0xb88460, uv: 1.2, r: 0.012 });
    for (const y of [0.18, 0.9]) k.box('wood', [w - 0.02, 0.1, 0.04], [cx, y, SF + 0.04], { tint: 0x9a6440 });
    const len = Math.hypot(w - 0.12, 0.72);
    k.box('wood', [len, 0.09, 0.035], [cx, 0.54 - 0.045, SF + 0.045], { rz: Math.atan2(0.72, w - 0.12) * (i % 2 ? 1 : -1), tint: 0x9a6440 });
    for (const y of [0.22, 0.94]) k.box('iron', [0.3, 0.035, 0.012], [x1 - 0.15, y, SF + 0.07], { tint: 0x2a2624, r: 0.006 });
    k.box('iron', [0.08, 0.05, 0.03], [x0 + 0.06, 0.66, SF + 0.07], { tint: 0x2a2624, r: 0.01 });
    // Plaque board (the animal's name is painted on by the animal system)
    k.box('wood', [0.66, 0.24, 0.02], [cx, 0.7, SF + 0.058], { tint: POST, r: 0.02 });
  }

  /** Hay loft on posts along the left wall, bales up top, ladder; stool + pails by the cow stalls. */
  private loft(k: Kit, rng: Rng): void {
    const z0 = 4.4;
    const z1 = 7.2;
    const lw = 1.15;
    const ly = 2.45;
    k.box('wood', [lw, 0.1, z1 - z0], [lw / 2, ly, (z0 + z1) / 2], { tint: 0xb07a52, uv: 1.4 });
    k.box('wood', [0.1, 0.18, z1 - z0], [lw, ly - 0.14, (z0 + z1) / 2], { tint: POST });
    for (const z of [z0 + 0.08, z1 - 0.08]) k.box('wood', [0.14, ly, 0.14], [lw - 0.06, 0, z], { tint: POST, ao: 0.3 });
    k.box('wood', [0.06, 0.06, z1 - z0], [lw - 0.02, ly + 0.55, (z0 + z1) / 2], { tint: 0x8a5a3a });
    for (let i = 0; i < 5; i++) k.box('wood', [0.05, 0.55, 0.05], [lw - 0.02, ly + 0.05, z0 + 0.3 + i * 0.6], { tint: 0x8a5a3a });
    hayBale(k, 0.5, ly + 0.1, 4.9, Math.PI / 2 + 0.05, 0.9);
    hayBale(k, 0.5, ly + 0.1, 5.85, Math.PI / 2 - 0.08, 0.9);
    hayBale(k, 0.52, ly + 0.48, 5.35, Math.PI / 2 + 0.1, 0.9);
    hayBale(k, 0.5, ly + 0.1, 6.75, Math.PI / 2, 0.9);
    strawTufts(k, rng, 0.6, ly + 0.1, 5.8, 20, 1.2);
    for (let i = 0; i < 9; i++) {
      const g = new THREE.CylinderGeometry(0.006, 0.006, 0.18 + rng.next() * 0.2, 3);
      k.add('fabric', g, mat(lw + 0.04, ly - 0.12, z0 + 0.2 + rng.next() * 2.4, 0.1, 0, (rng.next() - 0.5) * 0.4), { tint: 0xf0d890 });
    }
    // Ladder leaning on the loft edge
    const lean = 0.3;
    const lx = lw + 0.42;
    const lz = 5.6;
    for (const s of [-1, 1]) k.add('wood', new THREE.CylinderGeometry(0.035, 0.035, 2.8, 8), mat(lx, 1.36, lz + s * 0.22, 0, 0, lean), { tint: 0x9a6a44 });
    for (let i = 0; i < 7; i++) {
      const y = 0.25 + i * 0.34;
      const g = new THREE.CylinderGeometry(0.022, 0.022, 0.46, 6);
      g.rotateX(Math.PI / 2);
      k.add('wood', g, mat(lx - Math.sin(lean) * (y - 1.36) / Math.cos(lean), y, lz), { tint: 0x9a6a44 });
    }
    // Under the loft: a bale stack, loose hay forked down, the pitchfork
    hayBale(k, 0.55, 0, 6.6, Math.PI / 2 + 0.06);
    hayBale(k, 0.55, 0.42, 6.55, Math.PI / 2 - 0.04);
    hayPile(k, rng, 0.75, 5.0, 1.0, 0.9, 0.22);
    pitchfork(k, 1.2, 4.55, -0.16);
    // Milking corner by the cow stalls: stool, pails (one frothy)
    k.cyl('wood', 0.17, 0.17, 0.05, [0.55, 0.34, 3.6], { tint: 0xb08050, seg: 16 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      k.cyl('wood', 0.02, 0.025, 0.36, [0.55 + Math.cos(a) * 0.1, 0, 3.6 + Math.sin(a) * 0.1], { rx: Math.sin(a) * 0.15, rz: -Math.cos(a) * 0.15, tint: 0x8a5a3a });
    }
    bucket(k, 1.0, 3.45, 0xb8c0c4, true);
    bucket(k, 1.35, 3.75, 0xa8b0b4);
  }

  /** Board walk, the right-wall water corner, front clutter along the knee wall. */
  private aisle(k: Kit, rng: Rng): void {
    // T-shaped board walk: along the stall fronts, then down to the door.
    k.box('floor', [W - 1.6, 0.03, 1.05], [W / 2 + 0.55, 0, SF + 0.62], { tint: 0xd8c8b0, uv: 0.65, r: 0.01 });
    k.box('floor', [2.3, 0.03, D - SF - 1.1], [6.5, 0, (SF + 1.1 + D) / 2], { tint: 0xd8c8b0, uv: 0.65, r: 0.01 });
    // Straw kicked over the board edges + drifts across the floor
    strawTufts(k, rng, 6.5, 0.035, 5.6, 36, 1.6);
    for (const [x, z, w, d] of [[2.4, 6.4, 1.8, 1.0], [8.3, 5.2, 1.4, 1.0], [2.7, 7.4, 1.6, 0.8], [11.0, 7.3, 1.4, 0.8], [4.6, 4.1, 1.0, 0.5], [8.6, 4.1, 1.2, 0.5]] as const) strawDrift(k, rng, x, z, w, d);
    hayPile(k, rng, 2.0, 5.9, 0.9, 0.7, 0.14);

    // Right wall: stone water trough, pails, shears + halter pegs, grain barrel, crates
    k.box('stone', [0.55, 0.5, 1.5], [12.62, 0, 4.9], { tint: 0xb8b0a4, uv: 1.4, ao: 0.3, r: 0.05 });
    k.box('ceramic', [0.42, 0.02, 1.36], [12.62, 0.44, 4.9], { tint: 0x6aa0c0 });
    bucket(k, 12.2, 5.95, 0xa8b0b4);
    k.box('wood', [0.05, 0.08, 1.2], [12.97, 1.7, 5.4], { tint: POST });
    k.add('iron', roundedBox(0.02, 0.28, 0.06, 0.01), mat(12.93, 1.5, 5.05, 0.25, 0, 0), { tint: 0xa8b0b4 });
    k.add('iron', roundedBox(0.02, 0.28, 0.06, 0.01), mat(12.93, 1.5, 5.12, -0.25, 0, 0), { tint: 0xa8b0b4 });
    k.add('fabric', new THREE.TorusGeometry(0.14, 0.02, 5, 14), mat(12.92, 1.52, 5.7, 0, Math.PI / 2, 0), { tint: 0xb8452e });
    // Grain barrel with a scoop
    k.cyl('wood', 0.3, 0.27, 0.72, [12.3, 0, 6.65], { tint: 0x9a6a44, seg: 18 });
    for (const y of [0.12, 0.6]) k.add('iron', new THREE.TorusGeometry(0.29, 0.014, 5, 20), mat(12.3, y, 6.65, Math.PI / 2, 0, 0), { tint: 0x3a3634 });
    k.cyl('ceramic', 0.27, 0.27, 0.02, [12.3, 0.69, 6.65], { tint: 0xe0b050, seg: 18 });
    k.cyl('tin', 0.07, 0.06, 0.12, [12.22, 0.72, 6.6], { rz: 1.2, tint: 0xc8d0d4 });

    // Front, along the knee wall: bales, wheelbarrow, sacks | milk cans, crates
    hayBale(k, 0.9, 0, 8.45, 0.04);
    hayBale(k, 1.9, 0, 8.4, -0.06);
    hayBale(k, 1.4, 0.42, 8.42, 0.1);
    wheelbarrow(k, rng, 3.9, 7.85, -0.5);
    feedSack(k, 5.1, 8.35, 0.3, 0xfff0d8);
    feedSack(k, 4.8, 8.6, -0.5, 0xe8d4b4, true);
    milkCan(k, 7.85, 8.3);
    milkCan(k, 8.2, 8.55, 0.4);
    crate(k, 10.0, 8.45, 0.08, 0x9a6a44);
    crate(k, 10.75, 8.4, -0.05, 0xa87450);
    crate(k, 10.4, 8.42, 0.2, 0xb08058, 0.5);
    feedSack(k, 11.6, 8.4, -0.2, 0xfff0d8);
    bucket(k, 12.3, 8.35, 0xb8c0c4, true);
    // Mid-right: a round galvanised stock tank with a hand pump, a sawhorse with a saddle blanket
    const tx = 10.3;
    const tz = 5.9;
    // Open-topped: an outer skin, an inward-facing inner wall, the rolled rim, then the water inside.
    k.add('tin', new THREE.CylinderGeometry(0.62, 0.6, 0.5, 28, 1, true), mat(tx, 0.25, tz), { tint: 0xb8c0c4 });
    k.add('tin', insideOut(new THREE.CylinderGeometry(0.595, 0.575, 0.48, 28, 1, true)), mat(tx, 0.26, tz), { tint: 0x7c8488 });
    k.add('tin', new THREE.TorusGeometry(0.61, 0.028, 6, 28), mat(tx, 0.5, tz, Math.PI / 2, 0, 0), { tint: 0xd4dadc });
    for (const y of [0.14, 0.32]) k.add('tin', new THREE.TorusGeometry(0.615, 0.014, 5, 28), mat(tx, y, tz, Math.PI / 2, 0, 0), { tint: 0x98a0a4 });
    // Water: deep teal with a lighter sky-lit band toward the window side, hay stalks + a leaf afloat.
    k.add('ceramic', new THREE.CircleGeometry(0.59, 28).rotateX(-Math.PI / 2), mat(tx, 0.4, tz), { tint: 0x2e5a66 });
    k.add('ceramic', new THREE.RingGeometry(0.36, 0.5, 28, 1, 2.2, 1.6).rotateX(-Math.PI / 2), mat(tx, 0.402, tz), { tint: 0x6a9aa4 });
    for (let i = 0; i < 6; i++) {
      const a = i * 1.7 + 0.3;
      const r = 0.15 + (i % 3) * 0.12;
      k.cyl('thatch', 0.006, 0.006, 0.16 + (i % 2) * 0.08, [tx + Math.cos(a) * r, 0.405, tz + Math.sin(a) * r], { rz: Math.PI / 2, ry: a * 2.3, tint: 0xe0c070 });
    }
    k.box('wood', [0.14, 0.95, 0.14], [tx + 0.72, 0, tz - 0.35], { tint: POST });
    k.cyl('iron', 0.06, 0.06, 0.34, [tx + 0.72, 0.95, tz - 0.35], { tint: 0x4a6a5a });
    k.cyl('iron', 0.02, 0.02, 0.36, [tx + 0.5, 1.12, tz - 0.35], { rz: Math.PI / 2 - 0.35, tint: 0x3a3634 });
    k.cyl('iron', 0.025, 0.02, 0.26, [tx + 0.6, 1.02, tz - 0.25], { rx: 0.9, tint: 0x4a6a5a });
    // Wet splash marks on the boards around the tank
    for (let i = 0; i < 5; i++) {
      const a = 0.4 + i * 0.5;
      k.add('fabric', new THREE.CircleGeometry(0.12 + (i % 2) * 0.08, 14).rotateX(-Math.PI / 2), mat(tx + Math.cos(a) * 0.82, 0.014, tz + Math.sin(a) * 0.72), { tint: 0x8a6a48 });
    }
    // Sawhorse + saddle blanket + brush box
    const sx = 8.9;
    const sz = 6.9;
    k.box('wood', [1.1, 0.09, 0.12], [sx, 0.72, sz], { tint: 0x9a6a44, r: 0.02 });
    for (const s of [-1, 1]) for (const t of [-1, 1]) k.cyl('wood', 0.03, 0.035, 0.8, [sx + s * 0.42, 0, sz + t * 0.12], { rx: t * 0.28, tint: 0x8a5a3a });
    k.add('fabric', roundedBox(0.72, 0.03, 0.62, 0.012), mat(sx, 0.8, sz, 0, 0.05, 0), { tint: 0x3a6a9a });
    for (const s of [-1, 1]) k.add('fabric', roundedBox(0.7, 0.34, 0.025, 0.01), mat(sx, 0.64, sz + s * 0.31, s * 0.18, 0.05, 0), { tint: 0x3a6a9a });
    k.add('fabric', roundedBox(0.72, 0.045, 0.64, 0.012), mat(sx, 0.83, sz, 0, 0.05, 0), { tint: 0xd8c8a0 });
    k.box('wood', [0.46, 0.18, 0.28], [sx + 0.2, 0, sz + 0.62], { tint: 0xa87450, r: 0.02 });
    for (let i = 0; i < 3; i++) k.box('wood', [0.08, 0.05, 0.2], [sx + 0.06 + i * 0.13, 0.18, sz + 0.62], { tint: [0x6a4430, 0xc8a870, 0x8a5a3a][i]!, r: 0.02 });
    // Mid-left: a lidded grain bin + a scoop, sacks slumped against it
    const gx = 3.6;
    const gz = 5.2;
    k.box('wood', [1.2, 0.72, 0.62], [gx, 0, gz], { tint: 0xb07a52, uv: 1.3, ao: 0.3 });
    k.box('wood', [1.28, 0.06, 0.7], [gx, 0.72, gz - 0.02], { tint: 0x8a5a3a, rx: -0.08 });
    for (const s of [-1, 1]) k.box('iron', [0.04, 0.3, 0.02], [gx + s * 0.4, 0.4, gz + 0.32], { tint: 0x2a2624 });
    k.box('paint', [0.46, 0.16, 0.012], [gx, 0.36, gz + 0.315], { tint: 0xf2e6c8 });
    feedSack(k, gx - 0.85, gz + 0.1, 0.5, 0xfff0d8);
    feedSack(k, gx + 0.8, gz + 0.35, -0.3, 0xe8d4b4, true);
    k.cyl('tin', 0.09, 0.07, 0.16, [gx + 0.3, 0.78, gz - 0.05], { rz: 1.4, tint: 0xc8d0d4 });
    // A cartwheel leaning on the right wall
    k.add('wood', new THREE.TorusGeometry(0.42, 0.04, 6, 20), mat(12.88, 0.44, 7.6, 0, Math.PI / 2, 0.08), { tint: 0x7a5236 });
    for (let i = 0; i < 6; i++) k.add('wood', new THREE.CylinderGeometry(0.018, 0.018, 0.8, 5), mat(12.88, 0.44, 7.6, (i / 6) * Math.PI, 0, 0), { tint: 0x8a6040 });
  }
}
