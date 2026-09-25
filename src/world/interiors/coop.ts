/**
 * The coop, inside: a snug whitewashed henhouse (8 × 6 m — small enough that the flock fills it).
 *
 *   back-left    two tiers of straw-lined nesting boxes (eggs appear here each morning) + a ramp
 *   back-right   the roost: a ladder of perches over a straw pile (where the birds sleep)
 *   middle       a dust bath, a standing grain feeder in a halo of spilled grain, a stoneware water crock
 *                on its wet ring, a little bale climbing frame + stump, a tipped feed sack spilling corn, feathers
 *   front-left   long feed trough fed by a hopper (interact with hay to fill it)
 *   front-right  feed sacks, an egg basket on a crate, a pail of wildflowers, the pop-door hatch in the
 *                knee wall (interact: open / shut the door to the pasture)
 *   walls        chalkboard with the flock's names, herb bundles drying, two lanterns on brackets
 *
 * No tie beam across the room: from the high camera it sliced through the farmer and the roosting hens.
 * Anchors (`pen`) tell the animal system where birds eat, sleep and lay.
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import { Rng } from '../../core/rng';
import { InteriorMap } from './room';
import { Kit } from './kit';
import { mat, lumpySphere, roundedBox } from '../geom';
import type { PenAnchors } from './pen';
import { hayPile, strawTufts, lanternHook, feedSack, strawDrift, hayBale } from './pen';

export const COOP_EXIT = { x: 39.5, z: 35.4 };
/** Roost ladder: bar i sits at y = Y0 + i·DY, z = Z0 − i·DZ (x 4.7 … 7.2). */
const ROOST_Y0 = 0.3;
const ROOST_DY = 0.42;
const ROOST_Z0 = 1.4;
const ROOST_DZ = 0.18;
const W = 8;
const D = 6;
/** Pop-door hatch in the front knee wall (tile x, the knee-wall row z = D). */
const HATCH_X = 5;

export class CoopInterior extends InteriorMap {
  readonly pen: PenAnchors;
  private hatch!: THREE.Object3D;
  private hatchK = 1;

  constructor(game: Game) {
    super(game, {
      id: 'coop',
      title: 'Coop',
      W,
      D,
      H: 2.8,
      doorX: 4,
      exit: { to: 'farm', x: COOP_EXIT.x, z: COOP_EXIT.z, facing: 'down' },
      floor: 'straw',
      style: 'barn',
      wallMat: 'limewash',
      wallTint: 0xffffff,
      timberLight: 1.7,
      floorTint: 0xd4c6ae,
      windows: [
        { wall: 'back', at: 3.75, w: 0.85, y0: 1.2, y1: 2.0 },
        { wall: 'right', at: 2.6, w: 0.8, y0: 1.2, y1: 1.9 },
        { wall: 'left', at: 2.5, w: 0.8, y0: 1.25, y1: 1.95 },
      ],
      sunDir: [-0.4, 0.62, -0.68],
    });
    this.camera = { yaw: 0, pitch: 48, distance: 12.6, offsetX: 0, offsetZ: 0.4 };
    this.dayScale = 1.3;
    this.sunPoolK = 0.4;
    this.exposureBoost = 0.28;
    const rng = new Rng('coop-interior');
    const trough = { x0: 0.55, x1: 3.55, z: 5.35 };
    // Beds on the straw under the roost (ducks); chickens flutter up onto the perches.
    const beds = [[5.2, 2.35], [6.0, 2.55], [6.8, 2.3], [5.55, 2.95], [6.45, 3.0], [7.2, 2.8]];
    const slots = Array.from({ length: 6 }, (_, i) => {
      const x = 0.85 + i * 0.5;
      return {
        feed: new THREE.Vector3(x, 0, trough.z - 0.3),
        feedHeading: 0,
        bed: new THREE.Vector3(beds[i]![0], 0, beds[i]![1]),
        hay: new THREE.Vector3(x, 0.24, trough.z),
      };
    });
    const perches: THREE.Vector3[] = [];
    for (const bar of [1, 2]) for (let j = 0; j < 3; j++) perches.push(new THREE.Vector3(5.2 + j * 0.72 + (bar - 1) * 0.3, ROOST_Y0 + bar * ROOST_DY + 0.03, ROOST_Z0 - bar * ROOST_DZ));
    const nests: THREE.Vector3[] = [];
    for (let row = 0; row < 2; row++) for (let i = 0; i < 3; i++) nests.push(new THREE.Vector3(0.75 + i * 0.72, 0.52 + row * 0.66, 0.32));
    this.pen = {
      kind: 'coop',
      capacity: 6,
      slots,
      nests,
      area: { x0: 0.6, z0: 1.2, x1: 7.4, z1: 4.9 },
      trough: { x0: 0, z0: 5, x1: 3, z1: 5 },
      feedTile: { x: 2, z: 5 },
      board: { at: new THREE.Vector3(W - 0.075, 1.51, 3.9), ry: -Math.PI / 2 },
      perches,
      hatch: { x: HATCH_X, z: D },
    };
    this.furnish(rng, trough);
    this.popDoor();
    this.finalize();
  }

  private furnish(rng: Rng, trough: { x0: number; x1: number; z: number }): void {
    const k = new Kit();
    const WOOD = 0xb08058;
    const DARK = 0x6a4a32;
    // ── Nesting boxes: 2 tiers × 3 on a sturdy frame against the back wall.
    const nx0 = 0.35;
    const nw = 0.72;
    k.box('wood', [nw * 3 + 0.12, 0.08, 0.62], [nx0 + (nw * 3) / 2, 0.36, 0.32], { tint: WOOD });
    for (let row = 0; row < 2; row++) {
      const y = 0.44 + row * 0.66;
      k.box('wood', [nw * 3 + 0.12, 0.05, 0.62], [nx0 + (nw * 3) / 2, y + 0.58, 0.32], { tint: WOOD });
      for (let i = 0; i <= 3; i++) k.box('wood', [0.05, 0.58, 0.6], [nx0 + i * nw, y, 0.32], { tint: DARK });
      // Lip board (keeps the straw in) + straw nests
      k.box('wood', [nw * 3 + 0.1, 0.1, 0.04], [nx0 + (nw * 3) / 2, y, 0.62], { tint: 0xc89868 });
      for (let i = 0; i < 3; i++) {
        const cx = nx0 + nw * (i + 0.5);
        k.add('thatch', lumpySphere(0.24, 1, 0.3, rng), mat(cx, y + 0.02, 0.34, 0, rng.next() * 3, 0, 1.2, 0.35, 1), { tint: 0xe8c878 });
        strawTufts(k, rng, cx, y + 0.1, 0.5, 5, 0.18);
      }
    }
    // Legs + a ramp up to the top row
    for (const x of [nx0 + 0.02, nx0 + nw * 3 - 0.02]) k.box('wood', [0.08, 0.4, 0.08], [x, 0, 0.58], { tint: DARK });
    const ramp = new THREE.Matrix4().compose(new THREE.Vector3(nx0 + nw * 3 + 0.35, 0.55, 0.9), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.75)), new THREE.Vector3(1, 1, 1));
    k.add('plank', new THREE.BoxGeometry(1.25, 0.04, 0.3), ramp, { tint: 0xc09060 });
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5 - 0.5;
      k.add('wood', new THREE.BoxGeometry(0.04, 0.03, 0.3), mat(nx0 + nw * 3 + 0.35 + Math.cos(0.75) * 1.25 * t, 0.57 + Math.sin(0.75) * 1.25 * t, 0.9, 0, 0, 0.75), { tint: DARK });
    }
    // Name plaque over the boxes
    k.box('paint', [1.3, 0.22, 0.03], [nx0 + (nw * 3) / 2, 1.82, 0.05], { tint: 0x3a5a4a, r: 0.02 });
    k.box('paint', [1.2, 0.03, 0.035], [nx0 + (nw * 3) / 2, 1.9, 0.06], { tint: 0xf2e6c8 });

    // ── Roost: a leaning ladder of perches over a straw pile (back-right).
    const rx0 = 4.75;
    for (const s of [0, 1]) {
      const g = new THREE.CylinderGeometry(0.035, 0.035, 2.2, 8);
      k.add('wood', g, mat(rx0 + s * 2.4, 0.95, 1.05, -0.42, 0, 0), { tint: DARK });
    }
    for (let i = 0; i < 4; i++) {
      const y = ROOST_Y0 + i * ROOST_DY;
      const z = ROOST_Z0 - i * ROOST_DZ;
      const g = new THREE.CylinderGeometry(0.03, 0.03, 2.5, 8);
      g.rotateZ(Math.PI / 2);
      k.add('wood', g, mat(rx0 + 1.2, y, z), { tint: 0x8a6040 });
    }
    hayPile(k, rng, 5.95, 1.75, 2.2, 1.2, 0.3);

    // ── Feed trough (front-left) + hopper
    const tl = trough.x1 - trough.x0;
    const tc = (trough.x0 + trough.x1) / 2;
    k.box('wood', [tl, 0.06, 0.34], [tc, 0.06, trough.z], { tint: 0xa87850 });
    for (const s of [-1, 1]) k.box('wood', [tl, 0.2, 0.05], [tc, 0.06, trough.z + s * 0.17], { tint: 0x9a6a44 });
    for (const x of [trough.x0 + 0.05, trough.x1 - 0.05]) k.box('wood', [0.06, 0.24, 0.4], [x, 0.02, trough.z], { tint: DARK });
    for (const x of [trough.x0 + 0.2, tc, trough.x1 - 0.2]) k.box('wood', [0.08, 0.08, 0.44], [x, 0, trough.z], { tint: DARK });
    // Hopper: a slanted-lid bin against the left wall behind the trough's end
    k.box('wood', [0.5, 0.9, 0.5], [0.3, 0, 4.35], { tint: 0xc8a070, ao: 0.3 });
    k.box('wood', [0.58, 0.06, 0.6], [0.3, 0.92, 4.35], { tint: DARK, rx: -0.2 });
    k.box('paint', [0.3, 0.18, 0.02], [0.3, 0.5, 4.61], { tint: 0xf2e6c8 });

    // ── Middle: dust bath (a scooped hollow of fine dry soil, ragged soft-edged discs, a berm of clods)
    const dbx = 2.75;
    const dbz = 2.15;
    for (let i = 0; i < 7; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = 0.12 + rng.next() * 0.18;
      const sc = 0.56 - i * 0.042 + rng.next() * 0.08;
      const tint = new THREE.Color(0xa87c42).lerp(new THREE.Color(0x8a6444), i / 6);
      k.add('fabric', new THREE.CircleGeometry(sc, 18).rotateX(-Math.PI / 2).scale(1.25, 1, 0.85), mat(dbx + Math.cos(a) * r * (1 - i / 8), 0.01 + i * 0.003, dbz + Math.sin(a) * r * 0.7 * (1 - i / 8)), { tint });
    }
    k.add('fabric', new THREE.CircleGeometry(0.33, 22).rotateX(-Math.PI / 2).scale(1.2, 1, 0.8), mat(dbx + 0.05, 0.034, dbz), { tint: 0x7a5a3e });
    for (let i = 0; i < 30; i++) {
      const a = rng.next() * Math.PI * 2;
      const rr = 0.46 + rng.next() * 0.32;
      k.cyl('thatch', 0.007, 0.007, 0.14 + rng.next() * 0.14, [dbx + Math.cos(a) * rr * 1.2, 0.045, dbz + Math.sin(a) * rr * 0.85], { rz: Math.PI / 2, ry: rng.next() * Math.PI, tint: rng.next() < 0.5 ? 0xe8c878 : 0xc8a050 });
    }
    for (let i = 0; i < 16; i++) {
      const a = rng.next() * Math.PI * 2;
      const rr = 0.5 + rng.next() * 0.6;
      k.add('fabric', lumpySphere(0.018 + rng.next() * 0.025, 1, 0.4, rng), mat(dbx + Math.cos(a) * rr, 0.01, dbz + Math.sin(a) * rr * 0.72, 0, rng.next() * 3, 0, 1, 0.6, 1), { tint: rng.next() < 0.5 ? 0x7e5e42 : 0xa0805c });
    }
    // Standing grain feeder (galvanised hopper on a round pan, raised on an upturned crate lid) with a
    // halo of spilled grain + two pecked-clean patches.
    const fx = 4.35;
    const fz = 2.95;
    k.box('wood', [0.62, 0.1, 0.62], [fx, 0, fz], { tint: 0x9a6a44, r: 0.02 });
    k.cyl('tin', 0.3, 0.26, 0.07, [fx, 0.1, fz], { tint: 0xc0c8cc, seg: 24 });
    k.cyl('ceramic', 0.27, 0.27, 0.012, [fx, 0.16, fz], { tint: 0xe0b040, seg: 24 });
    k.cyl('tin', 0.13, 0.16, 0.44, [fx, 0.16, fz], { tint: 0xd8dee2, seg: 20 });
    for (const y of [0.3, 0.52]) k.add('tin', new THREE.TorusGeometry(0.155, 0.01, 5, 20), mat(fx, y, fz, Math.PI / 2, 0, 0), { tint: 0xa8b0b4 });
    k.add('tin', new THREE.ConeGeometry(0.17, 0.14, 20), mat(fx, 0.67, fz), { tint: 0xc8d0d4 });
    k.add('iron', new THREE.TorusGeometry(0.05, 0.01, 5, 12, Math.PI), mat(fx, 0.74, fz), { tint: 0x3a3634 });
    for (let i = 0; i < 90; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = 0.36 + Math.sqrt(rng.next()) * 0.62;
      k.sphere('ceramic', 0.012, [fx + Math.cos(a) * r, 0.012, fz + Math.sin(a) * r * 0.8], rng.next() < 0.3 ? 0xc89a40 : 0xe8c050);
    }
    // Stoneware water crock on its dark wet ring (splashes round it)
    const wx = 5.55;
    const wz = 3.75;
    k.add('fabric', new THREE.CircleGeometry(0.42, 22).rotateX(-Math.PI / 2).scale(1.15, 1, 0.9), mat(wx, 0.011, wz), { tint: 0x8a6a48 });
    for (let i = 0; i < 5; i++) {
      const a = 0.6 + i * 1.3;
      k.add('fabric', new THREE.CircleGeometry(0.07 + (i % 2) * 0.05, 12).rotateX(-Math.PI / 2), mat(wx + Math.cos(a) * 0.55, 0.012, wz + Math.sin(a) * 0.45), { tint: 0x94744e });
    }
    k.cyl('ceramic', 0.3, 0.3, 0.05, [wx, 0, wz], { tint: 0x8a7a68, seg: 22 });
    const crock = new THREE.LatheGeometry([[0, 0], [0.16, 0], [0.2, 0.05], [0.22, 0.18], [0.18, 0.34], [0.12, 0.4], [0.13, 0.44], [0, 0.44]].map(([a, b]) => new THREE.Vector2(a!, b!)), 22);
    k.add('ceramic', crock, mat(wx, 0.04, wz), { tint: 0xd8cbb4 });
    k.add('ceramic', new THREE.TorusGeometry(0.2, 0.012, 5, 22), mat(wx, 0.2, wz, Math.PI / 2, 0, 0), { tint: 0x4a6a8a });
    k.cyl('ceramic', 0.28, 0.28, 0.012, [wx, 0.05, wz], { tint: 0x7ab0d0, seg: 22 });
    // A little bale "climbing frame" (the hens hop up it): a bale on the floor, a smaller one stacked
    // half-off it, loose straw kicked round the foot and a scatter of grain on the top.
    hayBale(k, 2.3, 0, 3.88, 0.28, 0.86);
    hayBale(k, 2.12, 0.36, 3.92, 0.12, 0.66);
    strawTufts(k, rng, 2.3, 0.02, 3.9, 16, 0.75);
    for (let i = 0; i < 14; i++) k.sphere('ceramic', 0.012, [2.0 + rng.next() * 0.35, 0.645, 3.82 + rng.next() * 0.2], rng.next() < 0.35 ? 0xc89a40 : 0xe8c050);
    k.cyl('wood', 0.19, 0.22, 0.34, [3.55, 0, 3.35], { tint: 0x96683f });
    k.cyl('wood', 0.18, 0.18, 0.01, [3.55, 0.34, 3.35], { tint: 0xd8b080 });
    k.add('ceramic', new THREE.SphereGeometry(0.045, 12, 8), mat(3.6, 0.38, 3.33, 0, 0, 0, 1, 1.25, 1), { tint: 0xd99a62 });
    // A tipped-over feed sack spilling a fan of corn towards the feeder
    const sx = 6.55;
    const sz = 4.55;
    const sack = new THREE.LatheGeometry([[0, 0], [0.18, 0.01], [0.23, 0.12], [0.23, 0.32], [0.2, 0.44], [0.22, 0.5], [0, 0.5]].map(([a, b]) => new THREE.Vector2(a!, b!)), 18);
    sack.scale(1, 1, 0.72);
    k.add('burlap', sack, mat(sx, 0.17, sz, 0, 0.9, Math.PI / 2 + 0.12), { tint: 0xfff0d8 });
    for (let i = 0; i < 70; i++) {
      const a = Math.PI + 0.9 + (rng.next() - 0.5) * 1.1;
      const r = 0.3 + Math.pow(rng.next(), 0.7) * 0.75;
      k.sphere('ceramic', 0.013, [sx + Math.cos(a) * r * 0.9, 0.012, sz - Math.sin(a) * r * 0.6], rng.next() < 0.35 ? 0xd8a830 : 0xf0c848);
    }
    // Feathers: white + russet, scattered (a few caught on the straw drifts)
    for (let i = 0; i < 22; i++) {
      const f = new THREE.CircleGeometry(0.05, 8).rotateX(-Math.PI / 2).scale(0.42, 1, 1.5);
      k.add('fabric', f, mat(0.9 + rng.next() * 6.3, 0.02 + rng.next() * 0.02, 1.3 + rng.next() * 3.5, (rng.next() - 0.5) * 0.4, rng.next() * 3, 0.15), { tint: rng.next() < 0.55 ? 0xf8f4ea : rng.next() < 0.5 ? 0xc8844a : 0x3a6a4a });
    }

    // ── Front-right: sacks, egg basket on a crate, wildflowers, broom
    feedSack(k, 7.35, 5.3, 0.2, 0xfff0d8);
    feedSack(k, 7.6, 4.8, -0.4, 0xe8d4b4, true);
    k.box('wood', [0.5, 0.36, 0.4], [6.15, 0, 5.45], { tint: 0xb08858, ao: 0.25 });
    k.cyl('thatch', 0.2, 0.15, 0.16, [6.15, 0.36, 5.45], { tint: 0xc8a068 });
    k.add('thatch', new THREE.TorusGeometry(0.16, 0.015, 5, 16, Math.PI), mat(6.15, 0.52, 5.45), { tint: 0xb08850 });
    for (let i = 0; i < 4; i++) k.sphere('ceramic', 0.045, [6.08 + (i % 2) * 0.13, 0.5 + Math.floor(i / 2) * 0.04, 5.4 + ((i * 7) % 3) * 0.04], i % 2 ? 0xf6eee0 : 0xd8a070, [1, 1.25, 1]);
    k.cyl('tin', 0.12, 0.1, 0.24, [6.7, 0, 5.6], { tint: 0xc8d0d4, seg: 16 });
    const fcols = [0xf2c84a, 0xffffff, 0xc77dff, 0xf06a8a];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = 0.03 + (i % 3) * 0.035;
      k.cyl('leaf', 0.005, 0.005, 0.3, [6.7 + Math.cos(a) * r * 0.6, 0.2, 5.6 + Math.sin(a) * r * 0.6], { tint: 0x4a7a3a, rz: Math.cos(a) * 0.3, rx: Math.sin(a) * 0.3 });
      k.add('fabric', lumpySphere(0.035, 0, 0.3, rng, 3), mat(6.7 + Math.cos(a) * r * 1.4, 0.5 + (i % 4) * 0.03, 5.6 + Math.sin(a) * r * 1.4), { tint: fcols[i % fcols.length] });
    }
    k.cyl('wood', 0.015, 0.015, 1.35, [W - 0.28, 0.3, 3.05], { rz: 0.18, tint: 0xa87850 });
    k.cyl('thatch', 0.06, 0.13, 0.36, [W - 0.18, 0, 3.05], { rz: 0.18, tint: 0xd8b060 });
    // Chalkboard on the right wall: the flock's names (chalked on by the animal system)
    k.box('wood', [0.04, 0.62, 0.9], [W - 0.03, 1.2, 3.9], { tint: DARK });
    k.box('paint', [0.03, 0.52, 0.8], [W - 0.055, 1.25, 3.9], { tint: 0x2e3a34 });
    // Herb bundles drying on a peg rail (left wall) — lavender, yarrow, mint
    k.box('wood', [0.05, 0.06, 1.3], [0.05, 2.18, 1.35], { tint: DARK });
    for (let i = 0; i < 4; i++) {
      const z = 0.85 + i * 0.33;
      k.cyl('fabric', 0.006, 0.006, 0.22, [0.1, 1.96, z], { tint: 0xc8a878 });
      k.add('leaf', new THREE.ConeGeometry(0.075, 0.32, 7), mat(0.12, 1.78, z, Math.PI, 0, 0.1), { tint: [0x9a86c8, 0xe8dca0, 0x6a9a58, 0x9aa860][i] });
      k.add('fabric', new THREE.TorusGeometry(0.03, 0.01, 4, 8), mat(0.12, 1.94, z, Math.PI / 2, 0, 0), { tint: 0xb8452e });
    }
    // Grit bowl + a spare egg basket by the nests
    k.cyl('tin', 0.16, 0.12, 0.07, [1.1, 0, 2.95], { tint: 0xc8d0d4, seg: 18 });
    for (let i = 0; i < 26; i++) k.sphere('ceramic', 0.013, [1.1 + (rng.next() - 0.5) * 0.2, 0.072, 2.95 + (rng.next() - 0.5) * 0.2], rng.next() < 0.5 ? 0x9a948c : 0xc8c0b4);
    k.cyl('thatch', 0.19, 0.14, 0.15, [0.35, 0, 1.35], { tint: 0xc8a068 });
    k.add('thatch', new THREE.TorusGeometry(0.15, 0.015, 5, 16, Math.PI), mat(0.35, 0.15, 1.35, 0, Math.PI / 2, 0), { tint: 0xb08850 });
    for (let i = 0; i < 3; i++) k.sphere('ceramic', 0.045, [0.3 + (i % 2) * 0.1, 0.15, 1.3 + i * 0.05], i === 1 ? 0xd99a62 : 0xf4ecde, [1, 1.25, 1]);
    // Straw scatter + drifts break up the bedding
    strawTufts(k, rng, 4, 0.02, 3.2, 44, 3.3);
    for (const [x, z, w, d] of [[1.55, 3.05, 1.1, 0.7], [6.35, 3.3, 1.3, 0.8], [3.05, 4.75, 0.9, 0.45], [6.95, 1.15, 0.8, 0.5], [4.9, 4.55, 0.9, 0.5]] as const) strawDrift(k, rng, x, z, w, d);
    // Egg shelf with cartons on the right wall (back corner)
    k.box('wood', [0.3, 0.04, 1.1], [W - 0.16, 1.3, 1.1], { tint: 0xb08058 });
    for (const z of [0.7, 1.5]) k.box('wood', [0.2, 0.18, 0.04], [W - 0.1, 1.14, z], { tint: 0x6a4a32 });
    for (let i = 0; i < 2; i++) {
      k.box('paint', [0.22, 0.08, 0.36], [W - 0.2, 1.34, 0.85 + i * 0.42], { tint: 0xd8c8a8, r: 0.02 });
      for (let e = 0; e < 3; e++) k.sphere('ceramic', 0.035, [W - 0.2, 1.44, 0.74 + i * 0.42 + e * 0.11], e % 2 ? 0xd99a62 : 0xfbf5ea, [1, 1.25, 1]);
    }
    k.box('fabric', [0.18, 0.02, 0.9], [W - 0.2, 1.32, 1.1], { tint: 0xd86a5a });
    // Pop-door frame in the knee wall (the hatch itself slides: popDoor())
    const hx = HATCH_X + 0.5;
    k.box('paint', [0.52, 0.06, 0.3], [hx, 0.4, D + 0.11], { tint: 0xf2e6c8, r: 0.015 });
    for (const s of [-1, 1]) k.box('paint', [0.05, 0.4, 0.3], [hx + s * 0.235, 0, D + 0.11], { tint: 0xf2e6c8, r: 0.01 });
    k.box('paint', [0.4, 0.36, 0.02], [hx, 0.02, D + 0.235], { tint: 0x1c120c, r: 0.01 });
    this.statics.push(k.build('coop-furniture'));
    this.solid(0.2, 0, 2.6, 0.7, 'nests');
    this.solid(0.4, 5.1, 3.6, 5.6, 'trough');
    this.solid(0, 4.05, 0.6, 4.65, 'hopper');
    this.solid(5.3, 3.5, 5.8, 4.0, 'crock');
    this.solid(7.0, 4.5, 7.95, 5.6, 'sacks');
    this.solid(5.9, 5.2, 6.95, 5.8, 'basket');
    this.solid(4.05, 2.65, 4.65, 3.25, 'feeder');
    this.solid(1.85, 3.6, 2.75, 4.15, 'bales');
    this.solid(3.35, 3.15, 3.75, 3.55, 'stump');
    this.solid(6.2, 4.35, 6.9, 4.75, 'spilled-sack');
    this.solid(0.1, 1.1, 0.6, 1.6, 'basket');

    // Lanterns on iron brackets (left wall, back wall over the roost) + practical lights
    const lk = new Kit();
    lk.box('iron', [0.42, 0.04, 0.04], [0.21, 2.26, 3.3], { tint: 0x2a2624 });
    lk.box('iron', [0.03, 0.26, 0.03], [0.03, 2.04, 3.3], { tint: 0x2a2624 });
    lanternHook(lk, 0.42, 2.25, 3.3);
    lk.box('iron', [0.04, 0.04, 0.45], [5.95, 2.2, 0.28], { tint: 0x2a2624 });
    lanternHook(lk, 5.95, 2.22, 0.5);
    this.statics.push(lk.build('coop-lantern', false));
    this.addLamp(new THREE.Vector3(0.75, 1.9, 3.3), 0xffc27a, 0.5, 3.2, 0.03, 7.5);
    this.addLamp(new THREE.Vector3(5.95, 1.85, 0.85), 0xffb870, 0.0, 3.6, 0.04, 5);
    this.glowPool(1.3, 3.3, 2.3, 0xffb060, () => 0.05 + this.light.night * 0.16);
    void roundedBox;
  }

  /** The pop door: a planked hatch in the knee wall, slid up (open: the flock can go out to graze). */
  private popDoor(): void {
    const hk = new Kit();
    hk.box('wood', [0.4, 0.38, 0.04], [0, 0, 0], { tint: 0xe8dcc0, r: 0.012 });
    hk.box('paint', [0.46, 0.05, 0.02], [0, 0.17, 0.028], { tint: 0xc8503a, rz: 0.72, r: 0.008 });
    hk.box('paint', [0.46, 0.05, 0.02], [0, 0.17, 0.028], { tint: 0xc8503a, rz: -0.72, r: 0.008 });
    hk.add('iron', new THREE.TorusGeometry(0.03, 0.007, 5, 10), mat(0, 0.33, 0.03), { tint: 0x2e2a28 });
    const g = hk.build('pop-door');
    g.position.set(HATCH_X + 0.5, 0.02, D + 0.27);
    g.userData.dynamic = true;
    g.name = 'pop-door';
    this.hatch = g;
    this.root.add(g);
    this.updaters.push((dt) => {
      const open = this.game.services.animals?.doorOpen('coop') ?? true;
      this.hatchK += ((open ? 1 : 0) - this.hatchK) * (1 - Math.exp(-6 * dt));
      this.hatch.position.y = 0.02 + this.hatchK * 0.34;
    });
  }
}
