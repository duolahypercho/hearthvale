/**
 * The coop, inside: a whitewashed henhouse.
 *
 *   back-left    two tiers of straw-lined nesting boxes (eggs appear here each morning)
 *   back-right   the roost: a ladder of perches over a straw pile (where the birds sleep)
 *   front-left   long feed trough fed by a hopper (interact with hay to fill it)
 *   front-right  galvanized water fount, feed sacks, egg basket, broom
 *   walls        chalkboard with the flock's names, hanging lantern, window with a light shaft
 *
 * Anchors (`pen`) tell the animal system where birds eat, sleep and lay.
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import { Rng } from '../../core/rng';
import { InteriorMap } from './room';
import { Kit } from './kit';
import { mat, lumpySphere } from '../geom';
import type { PenAnchors } from './pen';
import { hayPile, strawTufts, lanternHook, feedSack, bucket, pitchfork } from './pen';

export const COOP_EXIT = { x: 39.5, z: 35.4 };

export class CoopInterior extends InteriorMap {
  readonly pen: PenAnchors;

  constructor(game: Game) {
    super(game, {
      id: 'coop',
      title: 'Coop',
      W: 9,
      D: 7,
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
        { wall: 'back', at: 5.2, w: 0.9, y0: 1.2, y1: 2.0 },
        { wall: 'right', at: 3.2, w: 0.8, y0: 1.2, y1: 1.9 },
        { wall: 'left', at: 2.9, w: 0.8, y0: 1.25, y1: 1.95 },
      ],
      sunDir: [-0.4, 0.62, -0.68],
    });
    this.camera = { yaw: 0, pitch: 52, distance: 12.5, offsetX: 0, offsetZ: 0.3 };
    this.dayScale = 1.3;
    this.exposureBoost = 0.28;
    const rng = new Rng('coop-interior');
    const trough = { x0: 0.55, x1: 3.55, z: 6.35 };
    const slots = Array.from({ length: 6 }, (_, i) => {
      const x = 0.85 + i * 0.5;
      return {
        feed: new THREE.Vector3(x, 0, 5.82),
        feedHeading: 0,
        bed: new THREE.Vector3(5.5 + (i % 3) * 0.75, 0, 1.5 + Math.floor(i / 3) * 0.7),
        hay: new THREE.Vector3(x, 0.24, trough.z),
      };
    });
    const nests: THREE.Vector3[] = [];
    for (let row = 0; row < 2; row++) for (let i = 0; i < 3; i++) nests.push(new THREE.Vector3(0.75 + i * 0.72, 0.52 + row * 0.66, 0.32));
    this.pen = {
      kind: 'coop',
      capacity: 6,
      slots,
      nests,
      area: { x0: 0.6, z0: 1.2, x1: 8.4, z1: 5.9 },
      trough: { x0: 0, z0: 5, x1: 4, z1: 6 },
      feedTile: { x: 2, z: 6 },
    };
    this.furnish(rng, trough);
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
    const rx0 = 5.2;
    for (const s of [0, 1]) {
      const g = new THREE.CylinderGeometry(0.035, 0.035, 2.2, 8);
      k.add('wood', g, mat(rx0 + s * 2.4, 0.95, 1.05, -0.42, 0, 0), { tint: DARK });
    }
    for (let i = 0; i < 4; i++) {
      const y = 0.3 + i * 0.42;
      const z = 1.4 - i * 0.18;
      const g = new THREE.CylinderGeometry(0.03, 0.03, 2.5, 8);
      g.rotateZ(Math.PI / 2);
      k.add('wood', g, mat(rx0 + 1.2, y, z), { tint: 0x8a6040 });
    }
    hayPile(k, rng, 6.5, 1.75, 2.2, 1.2, 0.3);
    // Droppings board shadow + feathers scattered
    for (let i = 0; i < 9; i++) {
      const f = new THREE.PlaneGeometry(0.05, 0.12);
      f.rotateX(-Math.PI / 2);
      k.add('fabric', f, mat(1 + rng.next() * 7, 0.012, 1.2 + rng.next() * 4.6, 0, rng.next() * 3, 0), { tint: rng.next() < 0.5 ? 0xf8f4ea : 0xc8844a });
    }

    // ── Feed trough (front-left) + hopper
    const tl = trough.x1 - trough.x0;
    const tc = (trough.x0 + trough.x1) / 2;
    k.box('wood', [tl, 0.06, 0.34], [tc, 0.06, trough.z], { tint: 0xa87850 });
    for (const s of [-1, 1]) k.box('wood', [tl, 0.2, 0.05], [tc, 0.06, trough.z + s * 0.17], { tint: 0x9a6a44 });
    for (const x of [trough.x0 + 0.05, trough.x1 - 0.05]) k.box('wood', [0.06, 0.24, 0.4], [x, 0.02, trough.z], { tint: DARK });
    for (const x of [trough.x0 + 0.2, tc, trough.x1 - 0.2]) k.box('wood', [0.08, 0.08, 0.44], [x, 0, trough.z], { tint: DARK });
    // Hopper: a slanted-lid bin at the trough's left end
    k.box('wood', [0.5, 0.9, 0.5], [0.3, 0, 5.2], { tint: 0xc8a070, ao: 0.3 });
    k.box('wood', [0.58, 0.06, 0.6], [0.3, 0.92, 5.2], { tint: DARK, rx: -0.2 });
    k.box('paint', [0.3, 0.18, 0.02], [0.3, 0.5, 5.46], { tint: 0xf2e6c8 });

    // ── Water fount + dish, feed sacks, egg basket, broom
    k.cyl('tin', 0.26, 0.26, 0.04, [6.5, 0, 5.7], { tint: 0xc8d0d4, seg: 22 });
    k.cyl('tin', 0.17, 0.2, 0.42, [6.5, 0.04, 5.7], { tint: 0xe0e6ea, seg: 20 });
    k.add('tin', new THREE.SphereGeometry(0.17, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(6.5, 0.46, 5.7), { tint: 0xe0e6ea });
    k.add('tin', new THREE.TorusGeometry(0.07, 0.012, 6, 14), mat(6.5, 0.66, 5.7), { tint: 0xa8b0b4 });
    for (const y of [0.12, 0.34]) k.add('tin', new THREE.TorusGeometry(0.19, 0.01, 5, 20), mat(6.5, y, 5.7, Math.PI / 2, 0, 0), { tint: 0xb0b8bc });
    k.cyl('ceramic', 0.22, 0.22, 0.012, [6.5, 0.045, 5.7], { tint: 0x7ab0d0, seg: 22 });
    feedSack(k, 7.9, 6.0, 0.2, 0xfff0d8);
    feedSack(k, 8.35, 5.6, -0.4, 0xe8d4b4);
    feedSack(k, 8.2, 6.3, 0.9, 0xfff0d8, true);
    // Egg basket on an upturned crate
    k.box('wood', [0.5, 0.36, 0.4], [5.4, 0, 6.35], { tint: 0xb08858, ao: 0.25 });
    k.cyl('thatch', 0.2, 0.15, 0.16, [5.4, 0.36, 6.35], { tint: 0xc8a068 });
    k.add('thatch', new THREE.TorusGeometry(0.16, 0.015, 5, 16, Math.PI), mat(5.4, 0.52, 6.35), { tint: 0xb08850 });
    for (let i = 0; i < 4; i++) k.sphere('ceramic', 0.045, [5.33 + (i % 2) * 0.13, 0.5 + Math.floor(i / 2) * 0.04, 6.3 + ((i * 7) % 3) * 0.04], i % 2 ? 0xf6eee0 : 0xd8a070, [1, 1.25, 1]);
    // Broom leaning in the corner
    k.cyl('wood', 0.015, 0.015, 1.35, [8.72, 0.3, 4.2], { rz: 0.18, tint: 0xa87850 });
    k.cyl('thatch', 0.06, 0.13, 0.36, [8.82, 0, 4.2], { rz: 0.18, tint: 0xd8b060 });
    // Chalkboard on the right wall: the flock's names
    k.box('wood', [0.04, 0.62, 0.9], [8.97, 1.2, 4.6], { tint: DARK });
    k.box('paint', [0.03, 0.52, 0.8], [8.945, 1.25, 4.6], { tint: 0x2e3a34 });
    // (the flock's names are chalked on by the animal system)
    // Straw scatter + a spilled grain pile
    strawTufts(k, rng, 4.5, 0.02, 3.4, 40, 3.8);
    for (let i = 0; i < 30; i++) k.sphere('ceramic', 0.012, [2 + rng.next() * 0.5, 0.012, 5.4 + rng.next() * 0.3], 0xe8c050);
    // Hanging galvanised feeder pan (chain from the rafters)
    const hx = 3.1;
    const hz = 3.7;
    k.cyl('iron', 0.006, 0.006, 1.9, [hx, 0.9, hz], { tint: 0x5a5654 });
    k.cyl('tin', 0.1, 0.13, 0.34, [hx, 0.46, hz], { tint: 0xd8dee2 });
    k.add('tin', new THREE.ConeGeometry(0.11, 0.1, 16), mat(hx, 0.85, hz), { tint: 0xc8d0d4 });
    k.cyl('tin', 0.3, 0.24, 0.07, [hx, 0.36, hz], { tint: 0xc0c8cc, seg: 24 });
    k.cyl('ceramic', 0.25, 0.25, 0.01, [hx, 0.42, hz], { tint: 0xe0b040, seg: 24 });
    // Egg shelf with cartons + a lantern on the right wall (back corner)
    k.box('wood', [0.3, 0.04, 1.1], [8.84, 1.3, 1.1], { tint: 0xb08058 });
    for (const z of [0.7, 1.5]) k.box('wood', [0.2, 0.18, 0.04], [8.9, 1.14, z], { tint: 0x6a4a32 });
    for (let i = 0; i < 2; i++) {
      k.box('paint', [0.22, 0.08, 0.36], [8.8, 1.34, 0.85 + i * 0.42], { tint: 0xd8c8a8, r: 0.02 });
      for (let e = 0; e < 3; e++) k.sphere('ceramic', 0.035, [8.8, 1.44, 0.74 + i * 0.42 + e * 0.11], e % 2 ? 0xd99a62 : 0xfbf5ea, [1, 1.25, 1]);
    }
    k.box('fabric', [0.18, 0.02, 0.9], [8.8, 1.32, 1.1], { tint: 0xd86a5a });
    // Tin pail of wildflowers by the sacks
    k.cyl('tin', 0.12, 0.1, 0.24, [7.25, 0, 6.55], { tint: 0xc8d0d4, seg: 16 });
    const fcols = [0xf2c84a, 0xffffff, 0xc77dff, 0xf06a8a];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = 0.03 + (i % 3) * 0.035;
      k.cyl('leaf', 0.005, 0.005, 0.3, [7.25 + Math.cos(a) * r * 0.6, 0.2, 6.55 + Math.sin(a) * r * 0.6], { tint: 0x4a7a3a, rz: Math.cos(a) * 0.3, rx: Math.sin(a) * 0.3 });
      k.add('fabric', lumpySphere(0.035, 0, 0.3, rng, 3), mat(7.25 + Math.cos(a) * r * 1.4, 0.5 + (i % 4) * 0.03, 6.55 + Math.sin(a) * r * 1.4), { tint: fcols[i % fcols.length] });
    }
    this.statics.push(k.build('coop-furniture'));
    this.solid(0.2, 0, 2.6, 0.7, 'nests');
    this.solid(0.4, 6.1, 3.6, 6.6, 'trough');
    this.solid(0, 4.9, 0.6, 5.5, 'hopper');
    this.solid(6.2, 5.4, 6.8, 6.0, 'fount');
    this.solid(7.6, 5.4, 8.9, 6.6, 'sacks');
    this.solid(5.1, 6.1, 5.7, 6.6, 'basket');
    this.solid(7.05, 6.35, 7.45, 6.75, 'flowers');

    // Lantern + practical light (evening warmth)
    const lk = new Kit();
    lanternHook(lk, 4.5, 2.35, 3.0);
    const lg = lk.build('coop-lantern', false);
    this.statics.push(lg);
    this.addLamp(new THREE.Vector3(4.5, 2.0, 3.0), 0xffc27a, 0.5, 3.2, 0.03, 8);
    this.glowPool(4.5, 3.0, 2.6, 0xffb060, () => 0.05 + this.light.night * 0.18);
    void pitchfork;
    void bucket;
  }
}
