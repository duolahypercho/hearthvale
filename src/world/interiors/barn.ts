/**
 * The barn, inside: a tall timber-framed hall of warm red boards.
 *
 *   back       six straw-bedded stalls with low plank dividers, name plaques, a salt lick
 *   back-left  a hay loft on posts (bales stacked up top, a ladder), pitchfork + loose hay below
 *   front      a long feed trough along the knee wall on both sides of the big door
 *              (animals eat facing you); interact with hay to fill it
 *   right      stone water trough, milk pails, shears on a peg, a milking stool
 *   overhead   two hanging lanterns; windows throw evening light across the straw
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import { Rng } from '../../core/rng';
import { InteriorMap } from './room';
import { Kit } from './kit';
import { mat, roundedBox } from '../geom';
import type { PenAnchors } from './pen';
import { hayPile, hayBale, strawTufts, lanternHook, bucket, pitchfork, feedSack } from './pen';

export const BARN_EXIT = { x: 46.5, z: 35.9 };

const W = 13;
const D = 9;
const STALL_W = 2;
const STALL_D = 2.5;

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
      floorTint: 0xc0b09a,
      windows: [
        { wall: 'back', at: 9.5, w: 1.0, y0: 1.9, y1: 2.9 },
        { wall: 'right', at: 3.4, w: 1.0, y0: 1.5, y1: 2.5 },
        { wall: 'left', at: 5.6, w: 0.9, y0: 1.5, y1: 2.4 },
      ],
      sunDir: [-0.55, 0.5, -0.66],
    });
    this.camera = { yaw: 0, pitch: 52, distance: 16.5, offsetX: 0, offsetZ: 0.3 };
    this.dayScale = 1.2;
    const rng = new Rng('barn-interior');
    const troughZ = D - 0.62;
    const xs = [1.6, 3.2, 4.8, 8.2, 9.8, 11.4];
    const slots = xs.map((x, i) => ({
      feed: new THREE.Vector3(x, 0, troughZ - 0.72),
      feedHeading: 0,
      bed: new THREE.Vector3(1 + i * STALL_W + 0.1, 0, 1.45),
      hay: new THREE.Vector3(x, 0.3, troughZ),
    }));
    this.pen = {
      kind: 'barn',
      capacity: 6,
      slots,
      nests: [],
      area: { x0: 0.8, z0: 2.9, x1: 12.2, z1: 7.5 },
      trough: { x0: 0, z0: 7, x1: 12, z1: 8 },
      feedTile: { x: 3, z: 8 },
      plaques: Array.from({ length: 6 }, (_, i) => new THREE.Vector3(1 + i * STALL_W, 1.2, STALL_D + 0.07)),
    };
    this.furnish(rng, troughZ);
    this.finalize();
  }

  private furnish(rng: Rng, troughZ: number): void {
    const k = new Kit();
    const PLANK = 0xc08a62;
    const POST = 0x6a4430;
    // ── Stalls: dividers (posts + two rails + a board skirt), straw bedding, plaques
    for (let i = 0; i <= 6; i++) {
      const x = i * STALL_W + 0.02;
      const x0 = i === 0 ? 0.08 : x;
      if (i > 0 && i < 6) {
        k.box('wood', [0.1, 0.62, STALL_D - 0.1], [x0, 0, STALL_D / 2], { tint: PLANK, uv: 1.2 });
        k.box('wood', [0.08, 0.12, STALL_D], [x0, 0.95, STALL_D / 2], { tint: 0xa87050 });
        k.box('wood', [0.14, 0.08, STALL_D + 0.04], [x0, 1.12, STALL_D / 2], { tint: POST });
      }
      k.box('wood', [0.16, 1.3, 0.16], [x0, 0, STALL_D], { tint: POST, ao: 0.3 });
      k.sphere('wood', 0.08, [x0, 1.33, STALL_D], POST);
    }
    for (let i = 0; i < 6; i++) {
      const cx = 1 + i * STALL_W;
      hayPile(k, rng, cx + 0.1, 1.3, 1.55, 1.7, 0.2);
      strawTufts(k, rng, cx, 0.02, 1.4, 24, 0.9);
      // Name plaque + little brass hook on the stall-front post line
      k.box('paint', [0.62, 0.2, 0.03], [cx, 1.14, STALL_D + 0.06], { tint: 0xf2e6c8, r: 0.02 });
      k.box('wood', [0.68, 0.26, 0.02], [cx, 1.11, STALL_D + 0.045], { tint: POST, r: 0.02 });
    }
    // Salt lick in the corner stall
    k.box('ceramic', [0.22, 0.16, 0.18], [12.5, 0.4, 0.3], { tint: 0xf4d8d0, r: 0.03 });
    k.box('wood', [0.3, 0.05, 0.25], [12.5, 0.36, 0.3], { tint: POST });

    // ── Hay loft (back-left) with bales + ladder
    const lx0 = 0.05;
    const lx1 = 4.6;
    const ly = 2.55;
    const ld = 1.0;
    k.box('wood', [lx1 - lx0, 0.1, ld], [(lx0 + lx1) / 2, ly, ld / 2], { tint: 0xb07a52, uv: 1.4 });
    k.box('wood', [lx1 - lx0, 0.18, 0.1], [(lx0 + lx1) / 2, ly - 0.14, ld], { tint: POST });
    for (const x of [lx1 - 0.08]) k.box('wood', [0.14, ly, 0.14], [x, 0, ld - 0.05], { tint: POST });
    k.box('wood', [lx1 - lx0, 0.06, 0.06], [(lx0 + lx1) / 2, ly + 0.55, ld - 0.02], { tint: 0x8a5a3a });
    for (let i = 0; i < 6; i++) k.box('wood', [0.05, 0.55, 0.05], [lx0 + 0.4 + i * 0.75, ly + 0.05, ld - 0.02], { tint: 0x8a5a3a });
    hayBale(k, 0.7, ly + 0.1, 0.45, 0.05);
    hayBale(k, 1.65, ly + 0.1, 0.48, -0.08);
    hayBale(k, 1.15, ly + 0.52, 0.46, 0.1);
    hayBale(k, 3.0, ly + 0.1, 0.45, 0.02);
    strawTufts(k, rng, 2.3, ly + 0.1, 0.8, 22, 1.4);
    // Wisps hanging off the loft edge
    for (let i = 0; i < 10; i++) {
      const g = new THREE.CylinderGeometry(0.006, 0.006, 0.18 + rng.next() * 0.2, 3);
      k.add('fabric', g, mat(0.3 + rng.next() * 4, ly - 0.12, ld + 0.03, 0.1, 0, (rng.next() - 0.5) * 0.4), { tint: 0xf0d890 });
    }
    // Ladder up to the loft (leaning on the loft edge, right end)
    const lz0 = ld + 0.5;
    const lean = 0.3;
    for (const s of [-1, 1]) k.add('wood', new THREE.CylinderGeometry(0.035, 0.035, 2.9, 8), mat(lx1 + 0.35 + s * 0.22, 1.4, lz0, -lean, 0, 0), { tint: 0x9a6a44 });
    for (let i = 0; i < 7; i++) {
      const y = 0.25 + i * 0.36;
      const t = (y - 1.4) / Math.cos(lean);
      const g = new THREE.CylinderGeometry(0.022, 0.022, 0.46, 6);
      g.rotateZ(Math.PI / 2);
      k.add('wood', g, mat(lx1 + 0.35, y, lz0 - Math.sin(lean) * t), { tint: 0x9a6a44 });
    }

    // ── Long feed trough along the front knee wall (both sides of the door)
    for (const [a, b] of [[0.35, 5.6], [7.4, 12.65]] as const) {
      const c = (a + b) / 2;
      const w = b - a;
      k.box('wood', [w, 0.08, 0.46], [c, 0.1, troughZ], { tint: 0xa87850 });
      for (const s of [-1, 1]) k.box('wood', [w, 0.3, 0.06], [c, 0.08, troughZ + s * 0.23], { tint: 0x9a6a44, uv: 1.2 });
      for (const x of [a + 0.05, b - 0.05]) k.box('wood', [0.07, 0.34, 0.52], [x, 0.04, troughZ], { tint: POST });
      for (let x = a + 0.4; x < b - 0.2; x += 1.2) k.box('wood', [0.1, 0.1, 0.56], [x, 0, troughZ], { tint: POST });
    }
    // Hay chute bin by the trough (left) + pitchfork, loose hay
    k.box('wood', [0.8, 1.0, 0.6], [0.5, 0, 6.8], { tint: 0xb07a52, ao: 0.3, uv: 1.2 });
    hayPile(k, rng, 0.5, 6.8, 0.7, 0.5, 0.15);
    k.add('thatch', roundedBox(0.66, 0.2, 0.46, 0.06), mat(0.5, 1.0, 6.8), { tint: 0xe8c878 });
    pitchfork(k, 0.18, 5.9, 0.12);
    hayPile(k, rng, 1.3, 5.9, 0.9, 0.6, 0.12);
    hayBale(k, 0.6, 0, 3.4, Math.PI / 2 + 0.1);
    hayBale(k, 0.62, 0.42, 3.4, Math.PI / 2 - 0.05);

    // ── Right side: stone water trough, milk pails, stool, shears
    k.box('stone', [0.55, 0.5, 1.6], [12.62, 0, 4.9], { tint: 0xb8b0a4, uv: 1.4, ao: 0.3, r: 0.05 });
    k.box('ceramic', [0.42, 0.02, 1.46], [12.62, 0.44, 4.9], { tint: 0x6aa0c0 });
    bucket(k, 12.3, 6.25, 0xb8c0c4, true);
    bucket(k, 12.62, 6.65, 0xa8b0b4);
    // Milking stool
    k.cyl('wood', 0.17, 0.17, 0.05, [11.7, 0.34, 6.4], { tint: 0xb08050, seg: 16 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      k.cyl('wood', 0.02, 0.025, 0.36, [11.7 + Math.cos(a) * 0.1, 0, 6.4 + Math.sin(a) * 0.1], { rx: Math.sin(a) * 0.15, rz: -Math.cos(a) * 0.15, tint: 0x8a5a3a });
    }
    // Shears + halter on pegs (right wall)
    k.box('wood', [0.05, 0.08, 1.2], [12.97, 1.7, 4.9], { tint: POST });
    k.add('iron', roundedBox(0.02, 0.28, 0.06, 0.01), mat(12.93, 1.5, 4.55, 0.25, 0, 0), { tint: 0xa8b0b4 });
    k.add('iron', roundedBox(0.02, 0.28, 0.06, 0.01), mat(12.93, 1.5, 4.62, -0.25, 0, 0), { tint: 0xa8b0b4 });
    k.add('fabric', new THREE.TorusGeometry(0.14, 0.02, 5, 14), mat(12.92, 1.52, 5.2, 0, Math.PI / 2, 0), { tint: 0xb8452e });
    // Feed sacks by the door
    feedSack(k, 7.35, 7.35, -0.3, 0xcaa878);
    feedSack(k, 5.25, 7.4, 0.4, 0xb89a6a, true);
    // A cartwheel leaning on the left wall
    k.add('wood', new THREE.TorusGeometry(0.42, 0.04, 6, 20), mat(0.12, 0.44, 4.4, 0, Math.PI / 2, 0), { tint: 0x7a5236 });
    for (let i = 0; i < 6; i++) k.add('wood', new THREE.CylinderGeometry(0.018, 0.018, 0.8, 5), mat(0.12, 0.44, 4.4, (i / 6) * Math.PI, 0, 0), { tint: 0x8a6040 });
    // Board aisle from the big door to the stalls (straw kicked over its edges)
    k.box('floor', [2.66, 0.03, 6.2], [6.5, 0, 5.85], { tint: 0xd8c8b0, uv: 0.45, r: 0.01 });
    // Loose straw everywhere
    strawTufts(k, rng, 6.5, 0.02, 5.2, 70, 5.6);
    this.statics.push(k.build('barn-furniture'));


    this.solid(0, 0, 13, 0.6, 'stall-back');
    for (let i = 1; i < 6; i++) this.solid(i * STALL_W - 0.1, 0, i * STALL_W + 0.1, STALL_D, 'divider');
    this.solid(0.2, troughZ - 0.1, 5.6, troughZ + 0.3, 'trough');
    this.solid(7.4, troughZ - 0.1, 12.7, troughZ + 0.3, 'trough');
    this.solid(0, 6.4, 0.9, 7.2, 'hay-bin');
    this.solid(12.3, 4.0, 13, 5.8, 'water');
    this.solid(0.2, 3.1, 1.0, 3.8, 'bales');

    const lk = new Kit();
    lanternHook(lk, 3.3, 3.1, 4.6);
    lanternHook(lk, 9.7, 3.1, 4.6);
    this.statics.push(lk.build('barn-lanterns', false));
    this.addLamp(new THREE.Vector3(3.3, 2.7, 4.6), 0xffc27a, 0.6, 3.6, 0.03, 9);
    this.addLamp(new THREE.Vector3(9.7, 2.7, 4.6), 0xffc27a, 0.6, 3.6, 0.03, 9);
    this.glowPool(3.3, 4.6, 3.0, 0xffb060, () => 0.05 + this.light.night * 0.16);
    this.glowPool(9.7, 4.6, 3.0, 0xffb060, () => 0.05 + this.light.night * 0.16);
  }
}
