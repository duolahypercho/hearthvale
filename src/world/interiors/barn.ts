/**
 * The barn, inside: a tall timber-framed hall of warm red boards.
 *
 *   back       six straw-bedded stalls; each has its own manger + a planked half-door on the aisle,
 *              a name plaque on the door, tack on the wall above. Animals live in their own stall
 *              (eat at the manger facing the aisle, sleep in the bedding at the back).
 *   aisle      a board walk along the stall fronts and down to the big door, straw kicked over its edges
 *   left       a hay loft on posts along the wall (bales up top, a ladder), bales + loose hay below,
 *              milking stool and pails by the cow stalls
 *   right      stone water trough, milk cans, shears + halter on pegs, a grain barrel, stacked crates,
 *              a shearing sawhorse with a fresh fleece + hand shears, a basket of rolled wool
 *   front      a short front (r10: 7.2 deep): heaped hay cart, feed sacks + milk cans either side of the door lane
 *   light      two lanterns over the aisle + a lantern between each pair of stalls (lit at night)
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import { Rng } from '../../core/rng';
import { InteriorMap } from './room';
import { Kit } from './kit';
import { mat, roundedBox, lumpySphere } from '../geom';
import type { PenAnchors, PenSlot } from './pen';
import { hayPile, hayBale, strawTufts, lanternHook, bucket, pitchfork, feedSack, milkCan, crate, strawDrift, spokedWheel, STRAW_DRY } from './pen';

export const BARN_EXIT = { x: 46.5, z: 35.9 };

const W = 13;
/** r10: 9 -> 7.2 deep: the stall row sits on the upper third, the whole box fits above the hotbar. */
const D = 7.2;
const SW = W / 6;
/** Stall front line (mangers + half-doors). */
const SF = 3.1;
const PLANK = 0xc08a62;
/** Stall dividers: weathered grey-brown, darker than the animals they frame. */
const DIVIDER = 0x8a7868;
/** The loft along the left wall (z range). */
const LOFT0 = 4.3;
const LOFT1 = 6.6;
/** Pasture door in the front knee wall (tile x; the knee-wall row z = D). */
const HATCH_X = 8;
const POST = 0x6a4430;
/** Manger centre (stall-local x) and where the half-door starts. */
const MX = 0.8;
/** The board walk: a darker weathered grey-brown (r10: it was the same orange as the straw + stalls). */
const AISLE = 0x8e9294;
const DOOR0 = 1.3;

/** A little standing hurricane lantern: tin base, glowing glass chimney in a wire cage, cap + bail handle. */
function hurricaneLantern(k: Kit, x: number, y: number, z: number): void {
  k.cyl('iron', 0.075, 0.085, 0.06, [x, y, z], { tint: 0x3a3634 });
  k.add('glow', new THREE.CylinderGeometry(0.05, 0.062, 0.16, 12), mat(x, y + 0.14, z), { tint: 0xffd49a });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    k.cyl('iron', 0.006, 0.006, 0.19, [x + Math.cos(a) * 0.07, y + 0.05, z + Math.sin(a) * 0.07], { tint: 0x2a2624 });
  }
  k.cyl('iron', 0.08, 0.06, 0.035, [x, y + 0.235, z], { tint: 0x3a3634 });
  k.add('iron', new THREE.ConeGeometry(0.05, 0.05, 10), mat(x, y + 0.275, z), { tint: 0x3a3634 });
  k.add('iron', new THREE.TorusGeometry(0.075, 0.006, 4, 14, Math.PI), mat(x, y + 0.27, z, 0, 0.4, 0), { tint: 0x2a2624 });
}

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
      wallTint: 0xc89482,
      // r10: blue-grey limewash on the lower boards (stall backs ~40 % value): the cream sheep, pink
      // pig and tan Jersey separate from the set instead of melting into one orange hue.
      wainscotTint: 0x7c8c9a,
      timberLight: 1.05,
      floorTint: 0x9ca0a6,
      windows: [
        { wall: 'back', at: 9.5, w: 1.0, y0: 1.9, y1: 2.9 },
        { wall: 'right', at: 3.9, w: 1.0, y0: 1.5, y1: 2.5 },
        { wall: 'left', at: 5.6, w: 0.9, y0: 1.5, y1: 2.4 },
      ],
      sunDir: [-0.55, 0.5, -0.66],
    });
    // A lower 42° pitch: the stall row reads face-on (chins over the mangers), less bare floor.
    this.camera = { yaw: 0, pitch: 44, distance: 16.4, offsetX: 0, offsetZ: -0.2 };
    this.dayScale = 1.2;
    this.sunPoolK = 0.25;
    this.exposureBoost = 0.2;
    this.coolFill = 0.62;
    this.shaftK = 1.3;
    const rng = new Rng('barn-interior');
    const slots: PenSlot[] = Array.from({ length: 6 }, (_, i) => {
      const x0 = i * SW;
      const mx = x0 + MX;
      return {
        feed: new THREE.Vector3(mx, 0, SF - 0.2),
        feedHeading: 0,
        bed: new THREE.Vector3(x0 + SW / 2, 0, 1.25),
        bedHeading: 0,
        hay: new THREE.Vector3(mx, 0.6, SF - 0.1),
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
      // (r9: plaques hang low on the door's kick-board, under the animals' chins — at chest height they
      // covered half of every body from the camera)
      plaques: Array.from({ length: 6 }, (_, i) => new THREE.Vector3(i * SW + (DOOR0 + SW - 0.09) / 2, 0.27, SF + 0.075)),
      hatch: { x: HATCH_X, z: D },
    };
    this.furnish(rng);
    this.popDoor();
    this.finalize();
  }

  private hatch!: THREE.Object3D;
  private hatchK = 1;

  /** The pasture door: a planked panel in the knee wall right of the big doorway, slid aside when open. */
  private popDoor(): void {
    const fk = new Kit();
    const hx = HATCH_X + 0.5;
    fk.box('wood', [0.9, 0.06, 0.3], [hx, 0.4, D + 0.11], { tint: 0x6a4430, r: 0.015 });
    for (const s of [-1, 1]) fk.box('wood', [0.06, 0.4, 0.3], [hx + s * 0.42, 0, D + 0.11], { tint: 0x6a4430, r: 0.01 });
    fk.box('paint', [0.78, 0.36, 0.02], [hx, 0.02, D + 0.235], { tint: 0x1c120c, r: 0.01 });
    // Painted sign on the cap: a little hoof print + arrow (PASTURE)
    fk.box('paint', [0.5, 0.02, 0.2], [hx, 0.52, D + 0.11], { tint: 0xf2e6c8, r: 0.01 });
    fk.box('paint', [0.28, 0.022, 0.05], [hx - 0.04, 0.52, D + 0.11], { tint: 0x7a3a24, r: 0.01 });
    fk.box('paint', [0.07, 0.022, 0.12], [hx + 0.13, 0.52, D + 0.11], { tint: 0x7a3a24, r: 0.01, ry: 0.6 });
    this.statics.push(fk.build('pasture-door-frame'));
    const hk = new Kit();
    hk.box('wood', [0.8, 0.38, 0.04], [0, 0, 0], { tint: 0xc08a62, r: 0.012 });
    hk.box('wood', [0.84, 0.05, 0.02], [0, 0.17, 0.028], { tint: 0x9a6440, rz: 0.42, r: 0.008 });
    hk.box('iron', [0.08, 0.05, 0.03], [0.3, 0.2, 0.03], { tint: 0x2a2624, r: 0.01 });
    const g = hk.build('pasture-door');
    g.position.set(hx, 0.02, D + 0.27);
    g.userData.dynamic = true;
    this.hatch = g;
    this.root.add(g);
    this.updaters.push((dt) => {
      const open = this.game.services.animals?.doorOpen('barn') ?? true;
      this.hatchK += ((open ? 1 : 0) - this.hatchK) * (1 - Math.exp(-6 * dt));
      this.hatch.position.x = hx + this.hatchK * 0.82;
    });
  }

  private furnish(rng: Rng): void {
    const k = new Kit();
    this.stalls(k, rng);
    this.loft(k, rng);
    this.aisle(k, rng);
    this.statics.push(k.build('barn-furniture'));

    // Stalls are the animals' (the farmer reaches over the manger / door from the aisle).
    this.solid(0, 0, W, SF - 0.5, 'stall');
    this.solid(0, LOFT0, 1.2, LOFT1, 'loft');
    this.solid(0.2, 3.3, 0.9, 3.9, 'stool');
    this.solid(12.3, 4.1, 13, 5.7, 'water');
    this.solid(11.9, 6.2, 13, D, 'barrel');
    this.solid(4.4, 6.4, 5.3, D, 'sacks');
    this.solid(7.75, 6.3, 8.35, D, 'cans');
    this.solid(9.4, 4.5, 10.8, 5.9, 'stock-tank');
    this.solid(8.35, 6.0, 9.65, D, 'sawhorse');
    this.solid(9.8, 6.3, 11.6, D, 'crates-bales');
    this.solid(2.6, 4.8, 4.5, 5.6, 'grain-bin');
    this.solid(4.5, 4.3, 5.1, 4.9, 'milking');
    this.solid(1.7, 5.9, 3.4, D, 'hay-cart');

    // Lanterns: two over the aisle, one between each pair of stalls over the bedding.
    const lk = new Kit();
    // The aisle pair hang from iron brackets on the side walls (a lantern hung over the aisle sits
    // right in front of the stalls from the high camera).
    for (const s of [-1, 1]) {
      const wx = s < 0 ? 0.05 : W - 0.05;
      const x = s < 0 ? 0.42 : W - 0.42;
      const z = 3.72;
      lk.box('iron', [0.4, 0.04, 0.04], [(wx + x) / 2, 2.88, z], { tint: 0x2a2624 });
      lk.box('iron', [0.03, 0.26, 0.03], [wx, 2.66, z], { tint: 0x2a2624 });
      lanternHook(lk, x, 2.9, z);
      this.addLamp(new THREE.Vector3(x + s * -0.25, 2.5, z), 0xffc27a, 0.6, 3.6, 0.03, 8.5);
      this.glowPool(x - s * 1.2, z, 2.6, 0xffb060, () => 0.03 + this.light.night * 0.1, 0.05);
    }
    for (const i of [1, 3, 5]) {
      const x = i * SW;
      // Iron bracket high on the back wall over the divider: hung above the animals' heads so it
      // never sits in front of a face from the camera, still pooling light over the bedding.
      lk.box('iron', [0.04, 0.04, 0.36], [x, 2.78, 0.18], { tint: 0x2a2624 });
      lk.box('iron', [0.03, 0.22, 0.03], [x, 2.58, 0.03], { tint: 0x2a2624 });
      lanternHook(lk, x, 2.8, 0.34);
      this.addLamp(new THREE.Vector3(x, 2.45, 0.6), 0xffb870, 0.0, 4.6, 0.04, 5.5);
    }
    // Two hurricane lanterns set down on the floor furniture: warm pools for the lower half of the
    // barn at night (emissive + a floor glow, no extra real lights — keeps the light count flat).
    for (const [x, y, z] of [[3.25, 0.76, 5.18], [9.75, 0.02, 6.95]] as const) {
      hurricaneLantern(lk, x, y, z);
      this.glowPool(x, z + 0.1, 1.7, 0xffa850, () => this.light.night * 0.09, 0.05);
    }
    this.statics.push(lk.build('barn-lanterns', false));
  }

  /** Six stalls: dividers, bedding, a manger + a half-door on each front, plaques, tack above. */
  private stalls(k: Kit, rng: Rng): void {
    for (let i = 0; i <= 6; i++) {
      const x = THREE.MathUtils.clamp(i * SW, 0.08, W - 0.08);
      if (i > 0 && i < 6) {
        // Divider: board skirt + two rails, darker cap
        k.box('wood', [0.09, 0.92, SF - 0.14], [x, 0, SF / 2 - 0.02], { tint: DIVIDER, uv: 1.2 });
        k.box('wood', [0.08, 0.12, SF - 0.1], [x, 1.1, SF / 2], { tint: 0x7e6a5c });
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
      hayPile(k, rng, cx, 1.1, SW - 0.35, 1.5, 0.2, 0xd8c8a4);
      strawDrift(k, rng, cx, SF - 0.9, SW - 0.4, 0.9, 0xc8b48a);
      strawTufts(k, rng, cx, 0.02, 1.8, 26, 0.95);
      this.manger(k, rng, x0 + MX);
      this.halfDoor(k, x0 + DOOR0, x0 + SW - 0.09, i);
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

  /**
   * The manger: a deep feed box straddling the stall front, its aisle lip kept low and canted out so
   * the camera looks into it (bare boards when empty, a heaped hay portion when filled: the animal
   * system drops the portion mesh at the slot's `hay` anchor). Planked skirt underneath.
   */
  private manger(k: Kit, rng: Rng, x: number): void {
    const z = SF - 0.13;
    const w = 0.92;
    const y0 = 0.42;
    const RIM = 0x9a6440;
    for (const [lx, lz] of [[-0.42, -0.22], [0.42, -0.22]] as const) k.box('wood', [0.08, y0 + 0.5, 0.08], [x + lx, 0, z + lz], { tint: POST });
    // Skirt boards under the box on the aisle side (no gap showing the stall's legs + straw)
    for (let b = 0; b < 3; b++) k.box('wood', [w / 3 - 0.012, y0, 0.04], [x - w / 3 + b * (w / 3), 0, z + 0.2], { tint: b % 2 ? 0xb07a52 : 0xbc8660, r: 0.008 });
    // Box floor, stall-side back board (tall), a low aisle lip canted out (the camera sees inside)
    k.box('wood', [w, 0.05, 0.5], [x, y0, z], { tint: 0xa87450 });
    k.box('wood', [w + 0.04, 0.5, 0.05], [x, y0, z - 0.24], { tint: 0xc8925e, uv: 1.4 });
    k.box('wood', [w + 0.04, 0.15, 0.05], [x, y0, z + 0.25], { tint: 0xd49e6a, uv: 1.4, rx: 0.45 });
    for (const s of [-1, 1]) k.box('wood', [0.05, 0.3, 0.5], [x + s * (w / 2), y0, z], { tint: 0xbc8660 });
    // Rims: a dark cap on the lip + back, iron corner straps
    k.box('wood', [w + 0.1, 0.04, 0.07], [x, y0 + 0.14, z + 0.31], { tint: RIM, r: 0.012 });
    k.box('wood', [w + 0.1, 0.05, 0.08], [x, y0 + 0.5, z - 0.24], { tint: RIM, r: 0.012 });
    for (const s of [-1, 1]) k.box('iron', [0.06, 0.12, 0.012], [x + s * (w / 2 - 0.06), y0 + 0.02, z + 0.29], { tint: 0x2a2624, rx: 0.45, r: 0.004 });
    // A few stalks on the boards inside (always), spilled on the lip + the floor under it
    strawTufts(k, rng, x, y0 + 0.03, z, 7, 0.3);
    strawTufts(k, rng, x, 0.02, z + 0.45, 8, 0.35);
  }

  /** Planked half-door with a Z brace, iron strap hinges and a latch. */
  private halfDoor(k: Kit, x0: number, x1: number, i: number): void {
    const w = x1 - x0;
    const cx = (x0 + x1) / 2;
    // Sage-painted doors (worn back to wood on the ledges): a cool rhythm along the stall row.
    const tint = i % 2 ? 0x86a486 : 0x90ac8c;
    const n = 4;
    for (let b = 0; b < n; b++) k.box('paint', [w / n - 0.012, 1.02, 0.05], [x0 + (b + 0.5) * (w / n), 0.06, SF], { tint: b % 2 ? tint : 0x8aa88a, r: 0.012 });
    for (const y of [0.18, 0.9]) k.box('wood', [w - 0.02, 0.1, 0.04], [cx, y, SF + 0.04], { tint: 0x8a6a4a });
    const len = Math.hypot(w - 0.12, 0.72);
    k.box('wood', [len, 0.09, 0.035], [cx, 0.54 - 0.045, SF + 0.045], { rz: Math.atan2(0.72, w - 0.12) * (i % 2 ? 1 : -1), tint: 0x8a6a4a });
    for (const y of [0.22, 0.94]) k.box('iron', [0.3, 0.035, 0.012], [x1 - 0.15, y, SF + 0.07], { tint: 0x2a2624, r: 0.006 });
    k.box('iron', [0.08, 0.05, 0.03], [x0 + 0.06, 0.66, SF + 0.07], { tint: 0x2a2624, r: 0.01 });
    // Plaque board (the animal's name is painted on by the animal system)
    k.box('iron', [0.04, 0.04, 0.06], [cx - 0.26, 0.4, SF + 0.07], { tint: 0x2a2624, r: 0.01 });
    k.box('iron', [0.04, 0.04, 0.06], [cx + 0.26, 0.4, SF + 0.07], { tint: 0x2a2624, r: 0.01 });
  }

  /** Hay loft on posts along the left wall, bales up top, ladder; stool + pails by the cow stalls. */
  private loft(k: Kit, rng: Rng): void {
    const z0 = LOFT0;
    const z1 = LOFT1;
    const lw = 1.15;
    const ly = 2.45;
    k.box('wood', [lw, 0.1, z1 - z0], [lw / 2, ly, (z0 + z1) / 2], { tint: 0xb07a52, uv: 1.4 });
    k.box('wood', [0.1, 0.18, z1 - z0], [lw, ly - 0.14, (z0 + z1) / 2], { tint: POST });
    for (const z of [z0 + 0.08, z1 - 0.08]) k.box('wood', [0.14, ly, 0.14], [lw - 0.06, 0, z], { tint: POST, ao: 0.3 });
    k.box('wood', [0.06, 0.06, z1 - z0], [lw - 0.02, ly + 0.55, (z0 + z1) / 2], { tint: 0x8a5a3a });
    for (let i = 0; i < 5; i++) k.box('wood', [0.05, 0.55, 0.05], [lw - 0.02, ly + 0.05, z0 + 0.3 + i * 0.6], { tint: 0x8a5a3a });
    hayBale(k, 0.5, ly + 0.1, 4.8, Math.PI / 2 + 0.05, 0.9);
    hayBale(k, 0.5, ly + 0.1, 5.7, Math.PI / 2 - 0.08, 0.9);
    hayBale(k, 0.52, ly + 0.48, 5.25, Math.PI / 2 + 0.1, 0.9);
    strawTufts(k, rng, 0.6, ly + 0.1, 5.5, 20, 1.0);
    for (let i = 0; i < 9; i++) {
      const g = new THREE.CylinderGeometry(0.006, 0.006, 0.18 + rng.next() * 0.2, 3);
      k.add('fabric', g, mat(lw + 0.04, ly - 0.12, z0 + 0.2 + rng.next() * 2.4, 0.1, 0, (rng.next() - 0.5) * 0.4), { tint: 0xf0d890 });
    }
    // Ladder leaning on the loft edge
    const lean = 0.3;
    const lx = lw + 0.42;
    const lz = 5.35;
    for (const s of [-1, 1]) k.add('wood', new THREE.CylinderGeometry(0.035, 0.035, 2.8, 8), mat(lx, 1.36, lz + s * 0.22, 0, 0, lean), { tint: 0x9a6a44 });
    for (let i = 0; i < 7; i++) {
      const y = 0.25 + i * 0.34;
      const g = new THREE.CylinderGeometry(0.022, 0.022, 0.46, 6);
      g.rotateX(Math.PI / 2);
      k.add('wood', g, mat(lx - Math.sin(lean) * (y - 1.36) / Math.cos(lean), y, lz), { tint: 0x9a6a44 });
    }
    // Under the loft: a bale stack, loose hay forked down, the pitchfork
    hayBale(k, 0.55, 0, 6.15, Math.PI / 2 + 0.06);
    hayBale(k, 0.55, 0.42, 6.1, Math.PI / 2 - 0.04);
    hayPile(k, rng, 0.75, 5.0, 1.0, 0.9, 0.22);
    pitchfork(k, 1.2, 4.55, -0.16);
    // Milking corner by the cow stalls: stool, pails (one frothy)
    k.cyl('wood', 0.17, 0.17, 0.05, [0.55, 0.34, 3.6], { tint: 0xb08050, seg: 16 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      k.cyl('wood', 0.02, 0.025, 0.36, [0.55 + Math.cos(a) * 0.1, 0, 3.6 + Math.sin(a) * 0.1], { rx: Math.sin(a) * 0.15, rz: -Math.cos(a) * 0.15, tint: 0x8a5a3a });
    }
    bucket(k, 1.0, 3.45, 0xb8c0c4, true);
    bucket(k, 1.35, 3.75, 0x6a9ad0);
    // A slate on the wall over the milking corner: the day's yields chalked up
    k.box('wood', [0.04, 0.5, 0.66], [0.05, 1.5, 3.35], { tint: POST });
    k.box('paint', [0.03, 0.42, 0.58], [0.075, 1.54, 3.35], { tint: 0x3a4448 });
    for (let i = 0; i < 4; i++) k.box('paint', [0.032, 0.018, 0.3 - (i % 2) * 0.1], [0.09, 1.68 - i * 0.08, 3.28], { tint: 0xe8ecea });
  }

  /** Board walk, the right-wall water corner, front clutter along the knee wall. */
  private aisle(k: Kit, rng: Rng): void {
    // T-shaped board walk: along the stall fronts, then down to the door.
    k.box('floor', [W - 1.6, 0.03, 1.05], [W / 2 + 0.55, 0, SF + 0.62], { tint: AISLE, uv: 0.65, r: 0.01 });
    k.box('floor', [2.3, 0.03, D - SF - 1.1], [6.5, 0, (SF + 1.1 + D) / 2], { tint: AISLE, uv: 0.65, r: 0.01 });
    // Straw kicked over the board edges + drifts across the floor
    strawTufts(k, rng, 6.5, 0.035, 5.3, 18, 1.4, undefined, STRAW_DRY);
    for (const [x, z, w, d] of [[8.3, 5.2, 1.2, 0.9], [4.6, 4.1, 1.0, 0.5], [8.6, 4.1, 1.2, 0.5], [11.3, 6.1, 1.0, 0.6]] as const) strawDrift(k, rng, x, z, w, d, 0xd8d0c4);
    // Milking vignette at the aisle corner by the cow stalls: stool, a pail brimming with milk, a can,
    // a folded cloth over the can's shoulder.
    k.cyl('wood', 0.16, 0.16, 0.05, [4.65, 0.34, 4.55], { tint: 0xb08050, seg: 16 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      k.cyl('wood', 0.02, 0.025, 0.36, [4.65 + Math.cos(a) * 0.1, 0, 4.55 + Math.sin(a) * 0.1], { rx: Math.sin(a) * 0.15, rz: -Math.cos(a) * 0.15, tint: 0x8a5a3a });
    }
    bucket(k, 4.95, 4.35, 0xc8d0d4, true);
    milkCan(k, 4.95, 4.85, 0.3);
    k.add('fabric', roundedBox(0.2, 0.02, 0.24, 0.01), mat(4.95, 0.6, 4.85, 0.3, 0.3, 0.9), { tint: 0xd86a5a });
    // A two-wheeled hay cart, heaped and bristling, shafts resting on the straw (left front).
    const cx = 2.5;
    const cz = 6.45;
    k.box('wood', [1.3, 0.06, 0.8], [cx, 0.42, cz], { tint: 0xa87450, r: 0.015 });
    for (const sd of [-1, 1]) {
      k.box('wood', [1.34, 0.22, 0.04], [cx, 0.46, cz + sd * 0.4], { tint: 0xb88058, r: 0.01 });
      for (let i = 0; i < 4; i++) k.box('wood', [0.04, 0.3, 0.04], [cx - 0.6 + i * 0.4, 0.44, cz + sd * 0.41], { tint: 0x8a5a3a });
      spokedWheel(k, 0.34, mat(cx - 0.1, 0.34, cz + sd * 0.5, 0, 0, sd * 0.2));
      k.add('wood', new THREE.CylinderGeometry(0.025, 0.025, 1.1, 7).rotateZ(Math.PI / 2), mat(cx + 1.15, 0.24, cz + sd * 0.3, 0, 0, -0.35), { tint: 0x8a5a3a });
    }
    k.add('straw', lumpySphere(0.5, 2, 0.26, rng), mat(cx, 0.62, cz, 0, 0.4, 0, 1.25, 0.62, 0.8), { tint: 0xfff0c8 });
    strawTufts(k, rng, cx, 0.8, cz, 30, 0.5, () => 0.08);
    strawTufts(k, rng, cx + 0.2, 0.02, cz + 0.2, 16, 0.9);
    // A stack of bales with a pitchfork stuck in the top (right front)
    hayBale(k, 11.05, 0, 6.75, 0.05);
    hayBale(k, 11.05, 0.42, 6.75, -0.08, 0.95);
    pitchfork(k, 11.45, 6.5, 0.12, 0.4);

    // Right wall: stone water trough, pails, shears + halter pegs, grain barrel, crates
    k.box('stone', [0.55, 0.5, 1.5], [12.62, 0, 4.9], { tint: 0xb8b0a4, uv: 1.4, ao: 0.3, r: 0.05 });
    k.box('ceramic', [0.42, 0.02, 1.36], [12.62, 0.44, 4.9], { tint: 0x6aa0c0 });
    bucket(k, 12.2, 5.95, 0x6a9ad0);
    k.box('wood', [0.05, 0.08, 1.2], [12.97, 1.7, 5.4], { tint: POST });
    k.add('iron', roundedBox(0.02, 0.28, 0.06, 0.01), mat(12.93, 1.5, 5.05, 0.25, 0, 0), { tint: 0xa8b0b4 });
    k.add('iron', roundedBox(0.02, 0.28, 0.06, 0.01), mat(12.93, 1.5, 5.12, -0.25, 0, 0), { tint: 0xa8b0b4 });
    k.add('fabric', new THREE.TorusGeometry(0.14, 0.02, 5, 14), mat(12.92, 1.52, 5.7, 0, Math.PI / 2, 0), { tint: 0xb8452e });
    // Grain barrel with a scoop
    k.cyl('wood', 0.3, 0.27, 0.72, [12.3, 0, 6.6], { tint: 0x9a6a44, seg: 18 });
    for (const y of [0.12, 0.6]) k.add('iron', new THREE.TorusGeometry(0.29, 0.014, 5, 20), mat(12.3, y, 6.6, Math.PI / 2, 0, 0), { tint: 0x3a3634 });
    k.cyl('ceramic', 0.27, 0.27, 0.02, [12.3, 0.69, 6.6], { tint: 0xe0b050, seg: 18 });
    k.cyl('tin', 0.07, 0.06, 0.12, [12.22, 0.72, 6.55], { rz: 1.2, tint: 0xc8d0d4 });

    // Front, either side of the door lane: sacks | milk cans, crates
    feedSack(k, 5.0, 6.65, 0.3, 0xb4caa4);
    feedSack(k, 4.7, 6.9, -0.5, 0xa8c098, true);
    milkCan(k, 7.95, 6.55);
    milkCan(k, 8.15, 6.88, 0.4);
    crate(k, 10.1, 6.82, 0.08, 0x8a6a54);
    crate(k, 10.1, 6.84, 0.2, 0x9a7a60, 0.5);
    // Mid-right: a round galvanised stock tank with a hand pump, a sawhorse with a saddle blanket
    const tx = 10.1;
    const tz = 5.2;
    // Open-topped: an outer skin, an inward-facing inner wall, the rolled rim, then the water inside.
    k.add('tin', new THREE.CylinderGeometry(0.62, 0.6, 0.5, 28, 1, true), mat(tx, 0.25, tz), { tint: 0xb8c0c4 });
    k.add('tin', insideOut(new THREE.CylinderGeometry(0.595, 0.575, 0.48, 28, 1, true)), mat(tx, 0.26, tz), { tint: 0x7c8488 });
    k.add('tin', new THREE.TorusGeometry(0.61, 0.028, 6, 28), mat(tx, 0.5, tz, Math.PI / 2, 0, 0), { tint: 0xd4dadc });
    for (const y of [0.14, 0.32]) k.add('tin', new THREE.TorusGeometry(0.615, 0.014, 5, 28), mat(tx, y, tz, Math.PI / 2, 0, 0), { tint: 0x98a0a4 });
    // Water: deep teal with a lighter sky-lit band toward the window side, hay stalks + a leaf afloat.
    k.add('ceramic', new THREE.CircleGeometry(0.59, 28).rotateX(-Math.PI / 2), mat(tx, 0.4, tz), { tint: 0x2e5a66 });
    k.add('ceramic', new THREE.RingGeometry(0.36, 0.5, 28, 1, 2.2, 1.6).rotateX(-Math.PI / 2), mat(tx, 0.402, tz), { tint: 0x6a9aa4 });
    // Two fallen leaves afloat (r6: the hay stalks read as debris)
    for (const [lx, lz, ry, c] of [[-0.2, 0.12, 0.6, 0x8aa040], [0.18, -0.16, 2.1, 0xd8a040]] as const) {
      k.add('leaf', new THREE.CircleGeometry(0.06, 8).rotateX(-Math.PI / 2).scale(0.55, 1, 1), mat(tx + lx, 0.405, tz + lz, 0, ry, 0), { tint: c });
    }
    k.box('wood', [0.14, 0.95, 0.14], [tx + 0.72, 0, tz - 0.35], { tint: POST });
    k.cyl('iron', 0.06, 0.06, 0.34, [tx + 0.72, 0.95, tz - 0.35], { tint: 0x4a6a5a });
    k.cyl('iron', 0.02, 0.02, 0.36, [tx + 0.5, 1.12, tz - 0.35], { rz: Math.PI / 2 - 0.35, tint: 0x3a3634 });
    k.cyl('iron', 0.025, 0.02, 0.26, [tx + 0.6, 1.02, tz - 0.25], { rx: 0.9, tint: 0x4a6a5a });
    // Wet patches on the boards round the tank (r11: irregular, glossy-dark spills + a few drips, not a
    // ring of identical brown discs)
    {
      const wet = new Rng('barn-wet');
      const blob = (r: number, n: number): THREE.BufferGeometry => {
        const sh = new THREE.Shape();
        const ph = wet.next() * 6;
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          const rr = r * (0.7 + 0.22 * Math.sin(a * 3 + ph) + 0.12 * Math.sin(a * 5 - ph * 1.7) + wet.next() * 0.08);
          if (i === 0) sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          else sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        return new THREE.ShapeGeometry(sh, 2).rotateX(-Math.PI / 2);
      };
      for (const [a, r, sx2, sz2] of [[0.5, 0.26, 1.6, 0.8], [1.5, 0.16, 1.0, 1.3], [2.6, 0.2, 1.4, 0.9]] as const) {
        k.add('straw', blob(r, 22), mat(tx + Math.cos(a) * 0.8, 0.02, tz + Math.sin(a) * 0.7, 0, wet.next() * 3, 0, sx2, 1, sz2), { tint: 0xa08a6a });
      }
      for (let i = 0; i < 7; i++) {
        const a = wet.next() * Math.PI * 2;
        const r = 0.62 + wet.next() * 0.45;
        k.add('straw', blob(0.025 + wet.next() * 0.03, 10), mat(tx + Math.cos(a) * r, 0.02, tz + Math.sin(a) * r * 0.85), { tint: 0xa08a6a });
      }
    }
    // Shearing corner: a sawhorse with a freshly shorn fleece thrown over it (a fat cream cloud, curly
    // tips, the cut side showing), hand shears hung on a nail on the near leg, a basket of rolled wool.
    const sx = 9.0;
    const sz = 6.5;
    k.box('wood', [1.1, 0.09, 0.12], [sx, 0.72, sz], { tint: 0x9a6a44, r: 0.02 });
    for (const s of [-1, 1]) for (const t of [-1, 1]) k.cyl('wood', 0.03, 0.035, 0.8, [sx + s * 0.42, 0, sz + t * 0.12], { rx: t * 0.28, tint: 0x8a5a3a });
    const fleece = new Rng('barn-fleece');
    // r11: the fleece as a real shorn mat — a lumpy blanket of packed curls (staple tufts), draped over
    // the bar and hanging down both sides, the outer tips a touch darker + creamier than the cut side.
    k.add('fabric', lumpySphere(0.5, 2, 0.14, fleece), mat(sx, 0.76, sz, 0, 0.05, 0, 0.98, 0.14, 0.36), { tint: 0xf0e4cc });
    for (const t of [-1, 1]) k.add('fabric', lumpySphere(0.4, 2, 0.18, fleece), mat(sx, 0.58, sz + t * 0.2, t * 0.35, 0.05, 0, 1.15, 0.42, 0.14), { tint: 0xeadcc0 });
    for (let i = 0; i < 150; i++) {
      // Cloth coords: u across the bar (−1 … 1, past ±0.5 it hangs down the sides), v along it.
      const u = (fleece.next() * 2 - 1) * 1.1;
      const v = (fleece.next() * 2 - 1) * 0.47;
      const hang = Math.max(0, Math.abs(u) - 0.5);
      const y = 0.83 - hang * 0.62 + fleece.next() * 0.02;
      const z = sz + Math.sign(u) * Math.min(Math.abs(u), 0.5) * 0.36 + Math.sign(u) * hang * 0.1;
      const r = 0.032 + fleece.next() * 0.026;
      const tip = fleece.next();
      const tint = tip < 0.15 ? 0xdcc8a2 : tip < 0.45 ? 0xf4e8d2 : 0xfdf6e8;
      k.add('fabric', lumpySphere(r, 1, 0.4, fleece), mat(sx + v, y, z, fleece.next(), fleece.next() * 3, 0, 1, 0.7, 1), { tint });
    }
    // Hand shears: two long blades + bowed spring handle, hanging from a nail on the near leg
    k.cyl('iron', 0.012, 0.012, 0.05, [sx + 0.42, 0.62, sz + 0.2], { rx: Math.PI / 2, tint: 0x2a2624 });
    for (const s of [-1, 1]) k.add('iron', roundedBox(0.035, 0.3, 0.008, 0.004), mat(sx + 0.42 + s * 0.02, 0.36, sz + 0.24, 0, 0, s * 0.06), { tint: 0xd8dee2 });
    k.add('iron', new THREE.TorusGeometry(0.06, 0.012, 5, 14, Math.PI * 1.4), mat(sx + 0.42, 0.56, sz + 0.24, 0, 0, Math.PI * 0.8), { tint: 0x7a6a5a });
    // Basket of rolled wool beside it
    k.cyl('thatch', 0.22, 0.17, 0.22, [sx - 0.25, 0, sz - 0.62], { tint: 0xc8a068 });
    for (let i = 0; i < 4; i++) k.add('fabric', lumpySphere(0.09, 1, 0.22, fleece), mat(sx - 0.33 + (i % 2) * 0.15, 0.25 + Math.floor(i / 2) * 0.06, sz - 0.68 + (i % 3) * 0.05, 0, 0, Math.PI / 2, 1.3, 0.85, 0.85), { tint: [0xfff6e4, 0xf0e2c8, 0xfffaf0, 0xe8d8bc][i]! });
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
  }
}
