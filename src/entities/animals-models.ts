/**
 * Farm animal models: chunky, big-headed, glossy-eyed. Each species is one rigid-skinned mesh
 * (animals-rig.ts) with a standard bone set the animator drives:
 *
 *   root → body → head → eyes · earL · earR          (every species)
 *               → legFL legFR legBL legBR | legL legR (quadruped | bird)
 *               → tail · wingL · wingR · wool         (when the species has them)
 *
 * Variants (0..2) change coats: white / brown hens, white / mallard ducks, holstein / jersey cows,
 * white / chocolate goats, cream / black-faced sheep, pink / spotted pigs, shiba / collie dogs,
 * orange / grey tabby cats.
 */
import * as THREE from 'three';
import { mat } from '../world/geom';
import { RigBuilder, ellipsoid, capsuleZ, limb, noise3, animalMaterial, type CoatPatch } from './animals-rig';

export type Species = 'chicken' | 'duck' | 'cow' | 'goat' | 'sheep' | 'pig' | 'dog' | 'cat';

export interface Gait {
  biped: boolean;
  /** Walk speed (m/s). */
  speed: number;
  /** Steps per second. */
  freq: number;
  legAmp: number;
  bob: number;
  /** Head pitch when eating (rad, + = down). */
  eatPitch: number;
  /** Body capsule radius (m, model units; the actor multiplies by its scale). */
  radius: number;
  /** Half-length of the body capsule's core segment along the heading (0 = a circle). */
  len: number;
  /** Root → mouth distance along +Z (where the animal stands to eat from a manger). */
  reach: number;
  /** Heart pop / label height. */
  top: number;
  /** How far the body drops when lying down. */
  sleepDrop: number;
  /** Leg fold scale when lying. */
  fold: number;
}

export interface AnimalModel {
  mesh: THREE.SkinnedMesh;
  bones: Record<string, THREE.Bone>;
  gait: Gait;
  species: Species;
}

const EYE = 0x16110f;
const HI = 0xffffff;

interface EyeOpts {
  /** Light rim behind the eye (dark faces). */
  rim?: number;
  /** Coloured iris with a horizontal bar pupil (goats). */
  iris?: number;
}

/** Big glossy chibi eyes: a dark lens, a large upper catchlight and a small lower one (+ optional rim / goat iris). */
function eyes(r: RigBuilder, x: number, y: number, z: number, size: number, ry = 0.25, o: EyeOpts = {}): void {
  for (const s of [-1, 1]) {
    const rot = mat(s * x, y, z, 0, s * ry, 0);
    if (o.rim != null) r.part('eyes', ellipsoid(size * 1.28, size * 1.34, size * 0.6, 12, 10), mat(s * x, y, z - size * 0.12, 0, s * ry, 0), o.rim, { flat: true });
    if (o.iris != null) {
      r.part('eyes', ellipsoid(size, size * 1.05, size * 0.66, 14, 10), rot, o.iris, { flat: true });
      // Horizontal bar pupil, sitting just proud of the iris.
      const pupil = ellipsoid(size * 0.78, size * 0.26, size * 0.2, 12, 6);
      r.part('eyes', pupil, new THREE.Matrix4().makeRotationY(s * ry).premultiply(new THREE.Matrix4().makeTranslation(s * x + s * Math.sin(ry) * size * 0.55, y, z + Math.cos(ry) * size * 0.55)), EYE, { flat: true });
    } else r.part('eyes', ellipsoid(size, size * 1.14, size * 0.7, 14, 10), rot, EYE, { flat: true });
    // Catchlights: big one up-and-out, a small one low-and-in (reads "alive" at any zoom).
    const fx = Math.sin(ry) * s;
    const fz = Math.cos(ry);
    r.part('eyes', ellipsoid(size * 0.42, size * 0.42, size * 0.22, 10, 8), mat(s * x + fx * size * 0.62 + s * size * 0.22, y + size * 0.42, z + fz * size * 0.62), HI, { flat: true });
    r.part('eyes', ellipsoid(size * 0.18, size * 0.18, size * 0.12, 8, 6), mat(s * x + fx * size * 0.64 - s * size * 0.2, y - size * 0.38, z + fz * size * 0.6), HI, { flat: true });
  }
}

function cheeks(r: RigBuilder, x: number, y: number, z: number, size: number, tint = 0xff9a9a): void {
  for (const s of [-1, 1]) r.part('head', ellipsoid(size, size * 0.6, size * 0.3, 8, 6), mat(s * x, y, z, 0, s * 0.6, 0), tint, { flat: true });
}

/** Pure height threshold patch (socks, blazes): colour below (yK < 0) / above (yK > 0) `y0`. */
function band(color: THREE.ColorRepresentation, y0: number, below = true): CoatPatch {
  return { color, freq: [0, 0, 0], seed: 0, edge: 0, yK: below ? -1 : 1, y0 };
}

// ───────────────────────────────────────────── birds

function chicken(variant: number): AnimalModel {
  const r = new RigBuilder();
  const brown = variant === 1;
  const body = brown ? 0xc9773c : 0xeae4d8;
  const tail = brown ? 0xa4542a : 0xe8e0d0;
  const tailTip = brown ? 0x3a4a3a : 0xe4dccb;
  const leg = 0xf0a832;
  r.bone('body', 'root', [0, 0.3, 0]);
  r.bone('head', 'body', [0, 0.42, 0.1]);
  r.bone('eyes', 'head', [0, 0.555, 0.2]);
  r.bone('earL', 'head', [-0.05, 0.6, 0.14]);
  r.bone('earR', 'head', [0.05, 0.6, 0.14]);
  r.bone('tail', 'body', [0, 0.38, -0.16]);
  r.bone('wingL', 'body', [-0.16, 0.36, 0.02]);
  r.bone('wingR', 'body', [0.16, 0.36, 0.02]);
  r.bone('legL', 'body', [-0.06, 0.17, 0]);
  r.bone('legR', 'body', [0.06, 0.17, 0]);
  const speck = (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
    if (brown && noise3(p.x * 9, p.y * 9, p.z * 9, 2) > 0.62) c.multiplyScalar(0.84);
  };
  r.part('body', ellipsoid(0.19, 0.17, 0.22), mat(0, 0.3, -0.01), body, { paint: speck });
  r.part('body', ellipsoid(0.16, 0.165, 0.135), mat(0, 0.335, 0.09), body, { paint: speck });
  // Fluffy bottom
  r.part('body', ellipsoid(0.14, 0.08, 0.15), mat(0, 0.18, -0.03), brown ? 0xe0a06a : 0xf4f0e6);
  // Tail: a cocked fan of rounded feathers (tips darker on the red hen)
  // Fanned wide and cocked up over the back so it reads as a plume from behind, never as a dark hole.
  for (const [a, h, z] of [[-0.75, 0.15, -0.19], [-0.25, 0.19, -0.21], [0.25, 0.19, -0.21], [0.75, 0.15, -0.19]] as const) {
    r.part('tail', ellipsoid(0.05, h, 0.07, 10, 8), mat(a * 0.1, 0.47, z, -0.38, 0, a * 0.55), tail, { patch: band(tailTip, 0.6, false) });
  }
  for (const s of [-1, 1]) {
    const w = s < 0 ? 'wingL' : 'wingR';
    r.part(w, ellipsoid(0.045, 0.11, 0.16), mat(s * 0.175, 0.31, -0.03, -0.25, 0, s * 0.12), brown ? 0xb0622e : 0xefe8da);
    const legB = s < 0 ? 'legL' : 'legR';
    r.part(legB, limb(0.02, 0.017, 0.18, 0.02, 8), mat(s * 0.06, 0, 0), leg, { flat: true });
    for (const a of [-0.45, 0, 0.45]) {
      const t = limb(0.012, 0.009, 0.05, 0, 5);
      t.rotateX(Math.PI / 2);
      r.part(legB, t, mat(s * 0.06 + Math.sin(a) * 0.02, 0.012, 0.012, 0, a, 0), leg, { flat: true });
    }
  }
  // Head: round, big red comb + wattle, stubby beak
  r.part('head', ellipsoid(0.12, 0.125, 0.12), mat(0, 0.53, 0.15), body);
  for (const [z, y, s] of [[0.09, 0.65, 0.04], [0.145, 0.675, 0.048], [0.2, 0.65, 0.04]] as const) r.part('head', ellipsoid(s * 0.55, s, s), mat(0, y, z), 0xf03a2e);
  for (const s of [-1, 1]) r.part('head', ellipsoid(0.02, 0.036, 0.02), mat(s * 0.014, 0.455, 0.235), 0xf03a2e);
  const beak = new THREE.ConeGeometry(0.034, 0.078, 10);
  beak.rotateX(Math.PI / 2);
  r.part('head', beak, mat(0, 0.515, 0.29), 0xf5b43a, { flat: true });
  eyes(r, 0.078, 0.56, 0.22, 0.031, 0.72);
  cheeks(r, 0.095, 0.505, 0.2, 0.022, 0xff7a70);
  const { mesh, bones } = r.build(animalMaterial(), 'chicken');
  return { mesh, bones, species: 'chicken', gait: { biped: true, speed: 0.55, freq: 3.2, legAmp: 0.55, bob: 0.025, eatPitch: 0.9, radius: 0.19, len: 0.05, reach: 0.3, top: 0.74, sleepDrop: 0.1, fold: 0.25 } };
}

function duck(variant: number): AnimalModel {
  const r = new RigBuilder();
  const mallard = variant === 1;
  const body = mallard ? 0xb4aca0 : 0xece7dc;
  const back = mallard ? 0x8a7a66 : 0xece6d8;
  const chest = mallard ? 0x8a4a30 : body;
  const head = mallard ? 0x2a7a4c : body;
  const bill = mallard ? 0xe8c848 : 0xf5a030;
  const feet = 0xf5a030;
  r.bone('body', 'root', [0, 0.25, 0]);
  r.bone('head', 'body', [0, 0.33, 0.15]);
  r.bone('eyes', 'head', [0, 0.545, 0.235]);
  r.bone('earL', 'head', [-0.05, 0.6, 0.18]);
  r.bone('earR', 'head', [0.05, 0.6, 0.18]);
  r.bone('tail', 'body', [0, 0.3, -0.26]);
  r.bone('wingL', 'body', [-0.14, 0.32, 0.0]);
  r.bone('wingR', 'body', [0.14, 0.32, 0.0]);
  r.bone('legL', 'body', [-0.065, 0.14, 0.0]);
  r.bone('legR', 'body', [0.065, 0.14, 0.0]);
  // Boat-shaped body: long keel, full chest, back darker than the flanks
  r.part('body', ellipsoid(0.165, 0.125, 0.27), mat(0, 0.25, -0.03), body, { patch: { ...band(back, 0.31, false) } });
  r.part('body', ellipsoid(0.145, 0.14, 0.14), mat(0, 0.28, 0.1), chest);
  r.part('body', ellipsoid(0.13, 0.06, 0.2), mat(0, 0.16, -0.02), mallard ? 0xc8c0b4 : 0xf4f0e8);
  // Up-curled tail (the drake's black curl)
  r.part('tail', ellipsoid(0.07, 0.045, 0.1), mat(0, 0.31, -0.28, 0.5, 0, 0), mallard ? 0x26282a : body);
  if (mallard) r.part('tail', new THREE.TorusGeometry(0.025, 0.009, 5, 10, Math.PI * 1.4), mat(0, 0.37, -0.3, 0, Math.PI / 2, 0), 0x26282a, { flat: true });
  for (const s of [-1, 1]) {
    const w = s < 0 ? 'wingL' : 'wingR';
    r.part(w, ellipsoid(0.04, 0.085, 0.2), mat(s * 0.15, 0.29, -0.06, -0.1, 0, s * 0.1), mallard ? 0x9a8a74 : 0xf0ebe0);
    if (mallard) {
      // Speculum: a thin dark-blue stripe along the trailing edge of the folded wing.
      r.part(w, ellipsoid(0.01, 0.014, 0.1, 10, 6), mat(s * 0.184, 0.262, -0.1, -0.1, 0, s * 0.1), 0x34489a, { flat: true });
    }
    const legB = s < 0 ? 'legL' : 'legR';
    r.part(legB, limb(0.02, 0.017, 0.14, 0.02, 8), mat(s * 0.065, 0, 0), feet, { flat: true });
    r.part(legB, ellipsoid(0.055, 0.012, 0.07, 10, 6), mat(s * 0.065, 0.013, 0.04), feet, { flat: true });
  }
  // Neck + head (drake: green head over a white collar)
  r.part('head', ellipsoid(0.066, 0.1, 0.066), mat(0, 0.4, 0.17), head);
  if (mallard) r.part('head', new THREE.TorusGeometry(0.064, 0.013, 6, 18), mat(0, 0.355, 0.17, Math.PI / 2 - 0.2, 0, 0), 0xffffff);
  r.part('head', ellipsoid(0.1, 0.098, 0.112), mat(0, 0.52, 0.19), head);
  // Spatula bill: a flat rounded paddle with a nail
  r.part('head', ellipsoid(0.058, 0.021, 0.09), mat(0, 0.49, 0.31, -0.08, 0, 0), bill, { flat: true });
  r.part('head', ellipsoid(0.05, 0.014, 0.075), mat(0, 0.477, 0.3, -0.05, 0, 0), bill, { flat: true });
  r.part('head', ellipsoid(0.014, 0.006, 0.01, 6, 4), mat(0, 0.5, 0.395), 0x3a3028, { flat: true });
  eyes(r, 0.07, 0.545, 0.245, 0.03, 0.72);
  if (!mallard) cheeks(r, 0.085, 0.505, 0.23, 0.02);
  const { mesh, bones } = r.build(animalMaterial(), 'duck');
  return { mesh, bones, species: 'duck', gait: { biped: true, speed: 0.5, freq: 2.8, legAmp: 0.5, bob: 0.02, eatPitch: 0.6, radius: 0.19, len: 0.08, reach: 0.36, top: 0.72, sleepDrop: 0.1, fold: 0.25 } };
}

// ───────────────────────────────────────────── quadrupeds

interface QuadDims {
  bodyY: number;
  bodyR: number;
  bodyLen: number;
  hipX: number;
  frontZ: number;
  backZ: number;
  legR: number;
  hoof: number;
}

/** Sculpted leg (lathe): full upper leg → knee bulge → slim cannon → fetlock, from `top` down to `hoof`. */
function legGeo(R: number, top: number, hoof: number): THREE.BufferGeometry {
  const h = top - hoof;
  const pts = [
    [R * 0.2, h + 0.05],
    [R * 1.15, h - 0.02],
    [R * 1.18, h * 0.78],
    [R * 0.9, h * 0.58],
    [R * 1.0, h * 0.48],
    [R * 0.78, h * 0.36],
    [R * 0.72, h * 0.14],
    [R * 0.86, h * 0.05],
    [R * 0.9, 0],
  ].map(([x, y]) => new THREE.Vector2(x!, y! + hoof));
  return new THREE.LatheGeometry(pts, 10);
}

function legs(r: RigBuilder, d: QuadDims, coat: THREE.ColorRepresentation, hoofTint: number, patch?: CoatPatch): void {
  const top = d.bodyY - d.bodyR * 0.35;
  for (const [nm, x, z] of [['legFL', -d.hipX, d.frontZ], ['legFR', d.hipX, d.frontZ], ['legBL', -d.hipX, d.backZ], ['legBR', d.hipX, d.backZ]] as const) {
    r.bone(nm, 'body', [x, top, z]);
    r.part(nm, legGeo(d.legR, top + 0.04, d.hoof), mat(x, 0, z), coat, { patch, ground: true });
    // Rounded hoof: a squat bevelled cylinder with a darker sole
    const hoofG = new THREE.CylinderGeometry(d.legR * 0.92, d.legR * 1.08, d.hoof, 10, 1);
    hoofG.translate(0, d.hoof / 2, 0);
    r.part(nm, hoofG, mat(x, 0, z + d.legR * 0.08), hoofTint, { flat: true });
  }
}

/** Shoulder + haunch masses over a capsule body: gives quadrupeds a chest, a rump and a belly. */
function bodyMasses(r: RigBuilder, d: QuadDims, tint: THREE.ColorRepresentation, patch?: CoatPatch, k = 1, paint?: (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => void): void {
  const R = d.bodyR;
  r.part('body', ellipsoid(R * 0.98, R * 1.02, R * 0.9), mat(0, d.bodyY + R * 0.06, d.frontZ + R * 0.1), tint, { patch, paint });
  r.part('body', ellipsoid(R * 1.02, R * 1.0 * k, R * 0.95), mat(0, d.bodyY + R * 0.08, d.backZ - R * 0.05), tint, { patch, paint });
  r.part('body', ellipsoid(R * 0.92, R * 0.8, (d.frontZ - d.backZ) * 0.75), mat(0, d.bodyY - R * 0.22, (d.frontZ + d.backZ) / 2), tint, { patch, paint });
}

function cow(variant: number): AnimalModel {
  const r = new RigBuilder();
  const jersey = variant === 1;
  const base = jersey ? 0xcb8d58 : 0xdfd9cc;
  const spots: CoatPatch | undefined = jersey ? undefined : { color: 0x26221f, freq: [3.4, 3.0, 3.2], seed: 4.3, edge: 0.24, sinAmp: 0.25 };
  // Jersey: fawn, shading darker over the hindquarters and down the legs (a smooth gradient, no patches).
  const shade = jersey ? (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => c.multiplyScalar(1 - 0.16 * THREE.MathUtils.smoothstep(-p.z, 0.0, 0.6)) : undefined;
  const d: QuadDims = { bodyY: 0.74, bodyR: 0.36, bodyLen: 0.5, hipX: 0.2, frontZ: 0.26, backZ: -0.32, legR: 0.085, hoof: 0.09 };
  r.bone('body', 'root', [0, d.bodyY, 0]);
  r.bone('head', 'body', [0, 0.92, 0.42]);
  r.bone('eyes', 'head', [0, 1.09, 0.78]);
  r.bone('earL', 'head', [-0.23, 1.12, 0.55]);
  r.bone('earR', 'head', [0.23, 1.12, 0.55]);
  r.bone('tail', 'body', [0, 0.96, -0.6]);
  r.part('body', capsuleZ(d.bodyR, d.bodyLen, 10, 20), mat(0, d.bodyY, -0.04, 0, 0, 0, 1, 0.95, 1), base, { patch: spots, paint: shade });
  bodyMasses(r, d, base, spots, 1.02, shade);
  // Udder + teats
  r.part('body', ellipsoid(0.14, 0.085, 0.15), mat(0, 0.44, -0.24), 0xf4b0aa);
  for (const [x, z] of [[-0.05, -0.2], [0.05, -0.2], [-0.05, -0.29], [0.05, -0.29]] as const) r.part('body', limb(0.018, 0.015, 0.4, 0.34, 6), mat(x, 0, z), 0xe8908c, { flat: true });
  // Leather collar + brass bell
  r.part('body', new THREE.TorusGeometry(0.235, 0.032, 8, 22), mat(0, 0.9, 0.42, Math.PI / 2 - 0.55, 0, 0), 0xc03a2c);
  r.part('body', new THREE.CylinderGeometry(0.045, 0.07, 0.1, 14), mat(0, 0.69, 0.56), 0xe8b840, { flat: true });
  r.part('body', new THREE.SphereGeometry(0.02, 8, 6), mat(0, 0.635, 0.56), 0x5a4020, { flat: true });
  legs(r, d, base, 0x3e302a, jersey ? band(0x6a4228, 0.22) : spots);
  // Tail with a tuft
  r.part('tail', limb(0.022, 0.018, 0.97, 0.5, 6), mat(0, 0, -0.63), base);
  r.part('tail', ellipsoid(0.045, 0.085, 0.045, 10, 8), mat(0, 0.47, -0.63), jersey ? 0x3a2418 : 0x26221f);
  // Big chibi head (holstein: a black patch over the left eye + ear), rounded pink muzzle with nostrils
  const headPatch: CoatPatch | undefined = jersey ? undefined : { color: 0x26221f, freq: [4.2, 3.6, 3.0], seed: 1.7, edge: 0.3 };
  // Jersey: the face darkens softly around the eyes (a gradient, not a patch)
  const faceShade = jersey ? (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => c.multiplyScalar(1 - 0.22 * THREE.MathUtils.smoothstep(Math.abs(p.x), 0.02, 0.2) * THREE.MathUtils.smoothstep(p.y, 0.98, 1.12)) : undefined;
  r.part('head', ellipsoid(0.27, 0.25, 0.26), mat(0, 1.07, 0.6), base, { patch: headPatch, paint: faceShade });
  // Muzzle: jersey's pale "mealy" ring around a dark nose; holstein pink
  const muzzle = jersey ? 0xf0dcc0 : 0xf6c0b4;
  r.part('head', ellipsoid(0.215, 0.15, 0.15), mat(0, 0.94, 0.8), muzzle);
  r.part('head', ellipsoid(jersey ? 0.13 : 0.17, jersey ? 0.075 : 0.1, 0.07), mat(0, 0.95, 0.9), jersey ? 0x4a3830 : 0xf09a94);
  for (const s of [-1, 1]) r.part('head', ellipsoid(0.03, 0.022, 0.012, 8, 6), mat(s * 0.07, 0.955, 0.965, 0, s * 0.3, 0), jersey ? 0x140e0c : 0x3a2418, { flat: true });
  r.part('head', ellipsoid(0.07, 0.014, 0.012, 8, 6), mat(0, 0.865, 0.92), 0x4a2a1e, { flat: true });
  for (const s of [-1, 1]) {
    const horn = new THREE.ConeGeometry(0.04, 0.12, 10);
    r.part('head', horn, mat(s * 0.15, 1.31, 0.55, 0, 0, -s * 0.55), 0xf2e6c8, { flat: true });
    const ear = s < 0 ? 'earL' : 'earR';
    const earPatch = !jersey && s < 0 ? band(0x26221f, -9, false) : undefined;
    r.part(ear, ellipsoid(0.12, 0.05, 0.075), mat(s * 0.33, 1.11, 0.54, 0, 0, s * 0.3), base, { patch: earPatch });
    r.part(ear, ellipsoid(0.08, 0.02, 0.05), mat(s * 0.34, 1.12, 0.575, 0, 0, s * 0.3), 0xf0a8a0, { flat: true });
  }
  // Forelock tuft
  for (let i = 0; i < 3; i++) r.part('head', ellipsoid(0.05, 0.04, 0.05, 8, 6), mat(-0.04 + i * 0.04, 1.3, 0.6 + (i % 2) * 0.03), jersey ? 0x9a6238 : base);
  eyes(r, 0.125, 1.1, 0.79, 0.05, 0.36, { rim: 0xf6efe4 });
  cheeks(r, 0.18, 1.0, 0.76, 0.04);
  const { mesh, bones } = r.build(animalMaterial(), 'cow');
  return { mesh, bones, species: 'cow', gait: { biped: false, speed: 0.55, freq: 1.55, legAmp: 0.38, bob: 0.02, eatPitch: 0.95, radius: 0.36, len: 0.42, reach: 0.98, top: 1.55, sleepDrop: 0.36, fold: 0.3 } };
}

function goat(variant: number): AnimalModel {
  const r = new RigBuilder();
  const togg = variant === 1;
  // 0: snowy Saanen · 1: Toggenburg (cocoa coat, cream muzzle, ear rims and socks)
  const base = togg ? 0x8e5c38 : 0xeee8dc;
  const cream = 0xf4e8d4;
  const socks = togg ? band(cream, 0.26) : undefined;
  const d: QuadDims = { bodyY: 0.64, bodyR: 0.21, bodyLen: 0.34, hipX: 0.12, frontZ: 0.2, backZ: -0.2, legR: 0.042, hoof: 0.07 };
  r.bone('body', 'root', [0, d.bodyY, 0]);
  r.bone('head', 'body', [0, 0.86, 0.34]);
  r.bone('eyes', 'head', [0, 1.06, 0.5]);
  r.bone('earL', 'head', [-0.12, 1.04, 0.42]);
  r.bone('earR', 'head', [0.12, 1.04, 0.42]);
  r.bone('tail', 'body', [0, 0.78, -0.36]);
  // Barrel: deep chest tapering to a tucked flank and a neat rump
  r.part('body', capsuleZ(d.bodyR, d.bodyLen, 10, 18), mat(0, d.bodyY, -0.02, 0, 0, 0, 1, 1.05, 1), base);
  r.part('body', ellipsoid(d.bodyR * 1.05, d.bodyR * 1.18, d.bodyR * 0.95), mat(0, d.bodyY + 0.02, d.frontZ + 0.02), base);
  r.part('body', ellipsoid(d.bodyR * 0.95, d.bodyR * 0.98, d.bodyR * 0.9), mat(0, d.bodyY + 0.04, d.backZ - 0.03), base);
  r.part('body', ellipsoid(d.bodyR * 0.8, d.bodyR * 0.62, 0.22), mat(0, d.bodyY - 0.08, 0.0), base);
  // Neck rising from the chest
  r.part('body', ellipsoid(0.1, 0.19, 0.11), mat(0, 0.83, 0.3, 0.45, 0, 0), base);
  // Red leather collar + brass bell
  r.part('body', new THREE.TorusGeometry(0.1, 0.022, 7, 18), mat(0, 0.85, 0.33, Math.PI / 2 - 0.45, 0, 0), 0xc83a2e);
  r.part('body', new THREE.CylinderGeometry(0.03, 0.05, 0.07, 12), mat(0, 0.735, 0.4), 0xe8b840, { flat: true });
  r.part('body', new THREE.SphereGeometry(0.014, 8, 6), mat(0, 0.698, 0.4), 0x5a4020, { flat: true });
  legs(r, d, base, 0x3a2e28, socks);
  // Perky flag tail
  r.part('tail', ellipsoid(0.035, 0.08, 0.03, 8, 6), mat(0, 0.83, -0.37, -0.6, 0, 0), togg ? 0x6a4228 : base);
  // Head: domed skull, long tapering muzzle angled down, beard, floppy-flat ears, swept horns
  r.part('head', ellipsoid(0.145, 0.15, 0.16), mat(0, 1.04, 0.43), base);
  r.part('head', ellipsoid(0.09, 0.09, 0.14), mat(0, 0.96, 0.58, 0.35, 0, 0), togg ? cream : base);
  r.part('head', ellipsoid(0.075, 0.06, 0.05), mat(0, 0.92, 0.69), togg ? 0xd8b8a0 : 0xf2c4b8);
  for (const s of [-1, 1]) r.part('head', ellipsoid(0.016, 0.011, 0.008, 6, 5), mat(s * 0.028, 0.93, 0.738, 0, s * 0.3, 0), 0x4a2e2a, { flat: true });
  r.part('head', ellipsoid(0.03, 0.006, 0.01, 6, 4), mat(0, 0.885, 0.715), 0x6a4040, { flat: true });
  if (togg) for (const s of [-1, 1]) r.part('head', ellipsoid(0.028, 0.1, 0.02, 8, 6), mat(s * 0.06, 1.02, 0.555, 0.45, s * 0.35, 0), cream);
  const beard = new THREE.ConeGeometry(0.045, 0.17, 9);
  beard.rotateX(Math.PI);
  r.part('head', beard, mat(0, 0.82, 0.62, 0.3, 0, 0), togg ? 0x5a3a24 : 0xece2d2);
  for (const s of [-1, 1]) {
    // Horns: a tapered tube arcing up, back and out over the crown
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 0.02, 0.1, -0.02), new THREE.Vector3(s * 0.055, 0.17, -0.1), new THREE.Vector3(s * 0.09, 0.17, -0.2), new THREE.Vector3(s * 0.11, 0.12, -0.26)]);
    const horn = new THREE.TubeGeometry(curve, 14, 0.03, 8, false);
    const hp = horn.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < hp.count; i++) {
      const t = Math.floor(i / 9) / 14;
      const cp = curve.getPoint(Math.min(1, t));
      const k = 1 - t * 0.8;
      hp.setXYZ(i, cp.x + (hp.getX(i) - cp.x) * k, cp.y + (hp.getY(i) - cp.y) * k, cp.z + (hp.getZ(i) - cp.z) * k);
    }
    horn.computeVertexNormals();
    r.part('head', horn, mat(s * 0.06, 1.15, 0.44), 0xd8c8a4, { patch: band(0x9a8a70, 1.3, false) });
    const ear = s < 0 ? 'earL' : 'earR';
    r.part(ear, ellipsoid(0.12, 0.034, 0.055), mat(s * 0.2, 1.02, 0.41, 0, s * 0.25, s * -0.3), togg ? 0x6a4228 : base);
    r.part(ear, ellipsoid(0.085, 0.016, 0.036), mat(s * 0.205, 1.026, 0.43, 0, s * 0.25, s * -0.3), togg ? cream : 0xf4b8ae, { flat: true });
  }
  eyes(r, 0.105, 1.06, 0.52, 0.042, 0.55, { rim: togg ? 0xf4e8d4 : 0xe8dcc8 });
  cheeks(r, 0.12, 0.97, 0.53, 0.03);
  const { mesh, bones } = r.build(animalMaterial(), 'goat');
  return { mesh, bones, species: 'goat', gait: { biped: false, speed: 0.65, freq: 2.1, legAmp: 0.42, bob: 0.025, eatPitch: 0.9, radius: 0.25, len: 0.2, reach: 0.72, top: 1.3, sleepDrop: 0.3, fold: 0.3 } };
}

function sheep(variant: number): AnimalModel {
  const r = new RigBuilder();
  // 0: cream fleece, soft taupe face · 1: black-faced (Suffolk-ish). Both: dark legs + face under white wool.
  const blackFace = variant === 1;
  const wool = blackFace ? 0xebe4d6 : 0xede6d8;
  const face = blackFace ? 0x2e2826 : 0x6e5a50;
  // Short, sturdy legs (chibi): long thin ones read as sticks under the fleece from the high camera.
  const d: QuadDims = { bodyY: 0.53, bodyR: 0.23, bodyLen: 0.28, hipX: 0.12, frontZ: 0.16, backZ: -0.18, legR: 0.056, hoof: 0.068 };
  r.bone('body', 'root', [0, d.bodyY, 0]);
  r.bone('wool', 'body', [0, d.bodyY + 0.04, -0.02]);
  r.bone('head', 'body', [0, 0.69, 0.3]);
  r.bone('eyes', 'head', [0, 0.8, 0.575]);
  r.bone('earL', 'head', [-0.12, 0.81, 0.45]);
  r.bone('earR', 'head', [0.12, 0.81, 0.45]);
  r.bone('tail', 'body', [0, 0.59, -0.42]);
  // Shorn body underneath
  r.part('body', capsuleZ(d.bodyR, d.bodyLen, 8, 16), mat(0, d.bodyY, -0.02), 0xe8dcc8);
  // Fleece: an overlapping cloud of puffs over the back and flanks — kept above the knees so the legs read
  const puff = (x: number, y: number, z: number, s: number) =>
    r.part('wool', new THREE.IcosahedronGeometry(s, s > 0.15 ? 2 : 1), mat(x, y, z), wool, { paint: (p, _n, c) => c.multiplyScalar(0.92 + 0.08 * noise3(p.x * 22, p.y * 22, p.z * 22, 3)) });
  let k = 0;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI + 0.02;
    for (let j = 0; j < 3; j++) {
      const t = j - 1;
      const z = -0.03 + t * 0.19;
      const sq = Math.sqrt(1 - t * t * 0.3);
      const y = d.bodyY + 0.02 + Math.sin(a) * 0.25 * sq;
      const x = Math.cos(a) * 0.27 * sq;
      puff(x, y, z, 0.14 + ((k++ * 37) % 5) * 0.01);
    }
  }
  puff(0, d.bodyY + 0.27, -0.03, 0.17);
  puff(0, d.bodyY + 0.03, -0.3, 0.16);
  puff(0, d.bodyY + 0.07, 0.24, 0.17);
  for (const s of [-1, 1]) puff(s * 0.2, d.bodyY - 0.05, 0.0, 0.15);
  legs(r, d, face, 0x221c1a);
  r.part('tail', new THREE.IcosahedronGeometry(0.07, 1), mat(0, 0.59, -0.43), wool);
  // Head poking forward out of the fleece: long face, dark nose, ears sticking straight out sideways
  r.part('head', ellipsoid(0.125, 0.14, 0.16), mat(0, 0.79, 0.48), face);
  r.part('head', ellipsoid(0.09, 0.085, 0.1), mat(0, 0.72, 0.59, 0.25, 0, 0), blackFace ? 0x3a3230 : 0x7e6a60);
  r.part('head', ellipsoid(0.034, 0.014, 0.01, 6, 5), mat(0, 0.73, 0.685), 0x1a1414, { flat: true });
  r.part('head', ellipsoid(0.028, 0.005, 0.01, 6, 4), mat(0, 0.695, 0.675), 0x1a1414, { flat: true });
  // Wool topknot
  for (const [x, y, z, s] of [[0, 0.93, 0.43, 0.095], [-0.075, 0.9, 0.46, 0.07], [0.075, 0.9, 0.46, 0.07], [0, 0.9, 0.36, 0.1]] as const) {
    r.part('head', new THREE.IcosahedronGeometry(s, 1), mat(x, y, z), wool);
  }
  for (const s of [-1, 1]) {
    const ear = s < 0 ? 'earL' : 'earR';
    r.part(ear, ellipsoid(0.11, 0.032, 0.05), mat(s * 0.2, 0.81, 0.45, 0, 0.3 * s, s * -0.12), face);
    r.part(ear, ellipsoid(0.075, 0.015, 0.03), mat(s * 0.205, 0.815, 0.47, 0, 0.3 * s, s * -0.12), 0xe8a098, { flat: true });
  }
  eyes(r, 0.085, 0.805, 0.585, 0.036, 0.48, { rim: 0xf6f0e6 });
  cheeks(r, 0.11, 0.73, 0.56, 0.026, 0xe88a86);
  const { mesh, bones } = r.build(animalMaterial(), 'sheep');
  return { mesh, bones, species: 'sheep', gait: { biped: false, speed: 0.5, freq: 2.0, legAmp: 0.4, bob: 0.02, eatPitch: 0.95, radius: 0.3, len: 0.18, reach: 0.64, top: 1.13, sleepDrop: 0.24, fold: 0.3 } };
}

function pig(variant: number): AnimalModel {
  const r = new RigBuilder();
  const spotted = variant === 1;
  const base = 0xf8b8ae;
  const spots: CoatPatch | undefined = spotted ? { color: 0x4a302c, freq: [4, 4, 4], seed: 9, edge: 0.52 } : undefined;
  const d: QuadDims = { bodyY: 0.45, bodyR: 0.29, bodyLen: 0.32, hipX: 0.15, frontZ: 0.2, backZ: -0.21, legR: 0.062, hoof: 0.05 };
  r.bone('body', 'root', [0, d.bodyY, 0]);
  r.bone('head', 'body', [0, 0.52, 0.3]);
  r.bone('eyes', 'head', [0, 0.65, 0.56]);
  r.bone('earL', 'head', [-0.12, 0.74, 0.4]);
  r.bone('earR', 'head', [0.12, 0.74, 0.4]);
  r.bone('tail', 'body', [0, 0.52, -0.46]);
  r.part('body', capsuleZ(d.bodyR, d.bodyLen, 10, 18), mat(0, d.bodyY, -0.03, 0, 0, 0, 1, 0.94, 1), base, { patch: spots });
  legs(r, d, base, 0x7a4a44, spots);
  r.part('tail', new THREE.TorusGeometry(0.04, 0.013, 6, 14, 5.4), mat(0, 0.54, -0.47, 0, Math.PI / 2, 0), base);
  r.part('head', ellipsoid(0.22, 0.21, 0.2), mat(0, 0.58, 0.42), base, { patch: spots });
  const snout = new THREE.CylinderGeometry(0.1, 0.105, 0.09, 18);
  snout.rotateX(Math.PI / 2);
  r.part('head', snout, mat(0, 0.53, 0.6), 0xf29890);
  r.part('head', new THREE.CylinderGeometry(0.095, 0.095, 0.005, 18).rotateX(Math.PI / 2), mat(0, 0.53, 0.647), 0xf7aaa2, { flat: true });
  for (const s of [-1, 1]) r.part('head', ellipsoid(0.02, 0.03, 0.01, 6, 5), mat(s * 0.036, 0.53, 0.652), 0x7a3a38, { flat: true });
  for (const s of [-1, 1]) {
    const ear = s < 0 ? 'earL' : 'earR';
    const e = new THREE.ConeGeometry(0.09, 0.17, 4);
    e.scale(1, 1, 0.35);
    r.part(ear, e, mat(s * 0.13, 0.8, 0.45, 0.85, 0, s * -0.35), 0xf4a49c);
  }
  eyes(r, 0.1, 0.65, 0.575, 0.037, 0.42);
  cheeks(r, 0.145, 0.57, 0.55, 0.036, 0xff8a8a);
  const { mesh, bones } = r.build(animalMaterial(), 'pig');
  return { mesh, bones, species: 'pig', gait: { biped: false, speed: 0.5, freq: 2.5, legAmp: 0.45, bob: 0.02, eatPitch: 0.7, radius: 0.3, len: 0.2, reach: 0.66, top: 1.0, sleepDrop: 0.2, fold: 0.35 } };
}

function dog(variant: number): AnimalModel {
  const r = new RigBuilder();
  const collie = variant === 1;
  const base = collie ? 0x3a2e2a : 0xd88a3c;
  const cream = 0xf6ead4;
  const belly = (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => {
    if (n.y < -0.35 || (p.z > 0.14 && p.y < 0.42 && n.z > 0.2)) c.set(cream);
  };
  const d: QuadDims = { bodyY: 0.37, bodyR: 0.155, bodyLen: 0.26, hipX: 0.085, frontZ: 0.15, backZ: -0.17, legR: 0.038, hoof: 0.035 };
  r.bone('body', 'root', [0, d.bodyY, 0]);
  r.bone('head', 'body', [0, 0.46, 0.2]);
  r.bone('eyes', 'head', [0, 0.585, 0.375]);
  r.bone('earL', 'head', [-0.085, 0.66, 0.24]);
  r.bone('earR', 'head', [0.085, 0.66, 0.24]);
  r.bone('tail', 'body', [0, 0.45, -0.28]);
  r.part('body', capsuleZ(d.bodyR, d.bodyLen, 8, 16), mat(0, d.bodyY, -0.02), base, { paint: belly });
  legs(r, d, base, cream, band(cream, 0.12));
  r.part('body', new THREE.TorusGeometry(0.105, 0.022, 7, 18), mat(0, 0.48, 0.2, Math.PI / 2 - 0.5, 0, 0), 0xd83a3a);
  r.part('body', new THREE.CylinderGeometry(0.03, 0.03, 0.01, 12).rotateX(Math.PI / 2), mat(0, 0.41, 0.3), 0xf2c440, { flat: true });
  const tail = new THREE.TorusGeometry(0.065, 0.032, 7, 14, 4.6);
  r.part('tail', tail, mat(0, 0.52, -0.26, 0, Math.PI / 2, 0.4), base, { patch: band(cream, 0.57, false) });
  r.part('head', ellipsoid(0.165, 0.15, 0.15), mat(0, 0.56, 0.25), base);
  r.part('head', ellipsoid(0.085, 0.07, 0.1), mat(0, 0.5, 0.39), cream);
  for (const s of [-1, 1]) r.part('head', ellipsoid(0.07, 0.06, 0.06), mat(s * 0.07, 0.52, 0.34), cream);
  r.part('head', ellipsoid(0.032, 0.024, 0.022, 10, 8), mat(0, 0.535, 0.49), 0x1a1412, { flat: true });
  r.part('head', ellipsoid(0.011, 0.008, 0.006, 6, 5), mat(-0.01, 0.547, 0.51), 0xffffff, { flat: true });
  // Little pink tongue
  r.part('head', ellipsoid(0.025, 0.008, 0.03, 8, 6), mat(0, 0.455, 0.43, -0.3, 0, 0), 0xf07a8a, { flat: true });
  for (const s of [-1, 1]) {
    const ear = s < 0 ? 'earL' : 'earR';
    const e = new THREE.ConeGeometry(0.055, 0.12, 8);
    e.scale(1, 1, 0.55);
    r.part(ear, e, mat(s * 0.095, 0.72, 0.24, 0, 0, -s * 0.2), base);
    const ie = new THREE.ConeGeometry(0.035, 0.08, 8);
    ie.scale(1, 1, 0.3);
    r.part(ear, ie, mat(s * 0.095, 0.71, 0.265, 0, 0, -s * 0.2), cream, { flat: true });
  }
  eyes(r, 0.07, 0.59, 0.375, 0.034, 0.42, collie ? { rim: 0xf6ead4 } : {});
  cheeks(r, 0.1, 0.53, 0.35, 0.026, 0xff9a8a);
  const { mesh, bones } = r.build(animalMaterial(), 'dog');
  return { mesh, bones, species: 'dog', gait: { biped: false, speed: 1.1, freq: 3.2, legAmp: 0.5, bob: 0.02, eatPitch: 0.75, radius: 0.17, len: 0.15, reach: 0.5, top: 0.9, sleepDrop: 0.19, fold: 0.35 } };
}

function cat(variant: number): AnimalModel {
  const r = new RigBuilder();
  const grey = variant === 1;
  const base = grey ? 0x8a8a92 : 0xe89a4a;
  const stripe = grey ? 0x55555e : 0xb8662a;
  const cream = 0xf6ecde;
  const tabby = (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => {
    if (n.y < -0.4) c.set(cream);
    else if (Math.sin(p.z * 38 + Math.sin(p.x * 12) * 1.5) > 0.55 && n.y > -0.1) c.set(stripe);
  };
  const d: QuadDims = { bodyY: 0.27, bodyR: 0.11, bodyLen: 0.2, hipX: 0.06, frontZ: 0.11, backZ: -0.12, legR: 0.028, hoof: 0.03 };
  r.bone('body', 'root', [0, d.bodyY, 0]);
  r.bone('head', 'body', [0, 0.35, 0.15]);
  r.bone('eyes', 'head', [0, 0.44, 0.285]);
  r.bone('earL', 'head', [-0.06, 0.5, 0.18]);
  r.bone('earR', 'head', [0.06, 0.5, 0.18]);
  r.bone('tail', 'body', [0, 0.3, -0.21]);
  r.part('body', capsuleZ(d.bodyR, d.bodyLen, 8, 14), mat(0, d.bodyY, -0.01), base, { paint: tabby });
  legs(r, d, base, cream, band(cream, 0.07));
  const t = limb(0.024, 0.02, 0.36, 0, 7);
  r.part('tail', t, mat(0, 0.3, -0.24, -0.5, 0, 0), base, { paint: (p, _n, c) => { if (Math.sin(p.y * 45) > 0.3) c.set(stripe); } });
  r.part('head', ellipsoid(0.125, 0.11, 0.11), mat(0, 0.42, 0.2), base, { paint: (p, _n, c) => { if (p.y > 0.47 && Math.sin(p.x * 60) > 0.4) c.set(stripe); } });
  r.part('head', ellipsoid(0.06, 0.045, 0.05), mat(0, 0.385, 0.29), cream);
  r.part('head', ellipsoid(0.014, 0.01, 0.008, 6, 5), mat(0, 0.405, 0.335), 0xe07a86, { flat: true });
  for (const s of [-1, 1]) {
    const ear = s < 0 ? 'earL' : 'earR';
    const e = new THREE.ConeGeometry(0.045, 0.09, 4);
    e.scale(1, 1, 0.5);
    r.part(ear, e, mat(s * 0.07, 0.53, 0.19, 0, 0, -s * 0.25), base);
    for (let w = 0; w < 3; w++) {
      const wh = limb(0.002, 0.002, 0.06, -0.06, 3);
      r.part('head', wh, mat(s * 0.1, 0.385 - w * 0.012, 0.3, 0, 0, s * (1.45 + (w - 1) * 0.15)), 0xffffff, { flat: true });
    }
  }
  eyes(r, 0.054, 0.445, 0.29, 0.03, 0.45);
  cheeks(r, 0.075, 0.39, 0.27, 0.02);
  const { mesh, bones } = r.build(animalMaterial(), 'cat');
  return { mesh, bones, species: 'cat', gait: { biped: false, speed: 0.8, freq: 3.0, legAmp: 0.45, bob: 0.015, eatPitch: 0.7, radius: 0.13, len: 0.11, reach: 0.34, top: 0.7, sleepDrop: 0.14, fold: 0.35 } };
}

const BUILDERS: Record<Species, (v: number) => AnimalModel> = { chicken, duck, cow, goat, sheep, pig, dog, cat };

export function buildAnimal(species: Species, variant = 0): AnimalModel {
  return BUILDERS[species](variant);
}
