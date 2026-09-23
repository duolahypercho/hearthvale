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
import { RigBuilder, ellipsoid, capsuleZ, limb, noise3, animalMaterial, blendPatch } from './animals-rig';

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
  /** Separation radius (m). */
  radius: number;
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

const EYE = 0x1a1412;
const HI = 0xffffff;

function eyes(r: RigBuilder, x: number, y: number, z: number, size: number, ry = 0.25): void {
  for (const s of [-1, 1]) {
    r.part('eyes', ellipsoid(size, size * 1.12, size * 0.7, 12, 10), mat(s * x, y, z, 0, s * ry, 0), EYE, { flat: true });
    r.part('eyes', ellipsoid(size * 0.34, size * 0.34, size * 0.2, 8, 6), mat(s * x + s * size * 0.2, y + size * 0.38, z + size * 0.55), HI, { flat: true });
  }
}

function cheeks(r: RigBuilder, x: number, y: number, z: number, size: number, tint = 0xff9a9a): void {
  for (const s of [-1, 1]) r.part('head', ellipsoid(size, size * 0.6, size * 0.3, 8, 6), mat(s * x, y, z, 0, s * 0.6, 0), tint, { flat: true });
}

// ───────────────────────────────────────────── birds

function chicken(variant: number): AnimalModel {
  const r = new RigBuilder();
  const brown = variant === 1;
  const body = brown ? 0xc9773c : 0xeee8dc;
  const tail = brown ? 0x5c3420 : 0xece4d4;
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
  const speck: (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => void = (p, _n, c) => {
    if (brown && noise3(p.x * 9, p.y * 9, p.z * 9, 2) > 0.62) c.multiplyScalar(0.78);
  };
  r.part('body', ellipsoid(0.19, 0.17, 0.22), mat(0, 0.3, -0.01), body, { paint: speck });
  r.part('body', ellipsoid(0.155, 0.16, 0.13), mat(0, 0.33, 0.09), body, { paint: speck });
  // Fluffy bottom
  r.part('body', ellipsoid(0.14, 0.08, 0.15), mat(0, 0.18, -0.03), brown ? 0xe0a06a : 0xffffff);
  for (const [a, h, z] of [[-0.55, 0.16, -0.2], [-0.2, 0.19, -0.2], [0.15, 0.15, -0.19]] as const) {
    r.part('tail', ellipsoid(0.035, h, 0.07, 10, 8), mat(a * 0.08, 0.44, z, -0.55, 0, a * 0.5), tail);
  }
  for (const s of [-1, 1]) {
    const w = s < 0 ? 'wingL' : 'wingR';
    r.part(w, ellipsoid(0.045, 0.11, 0.16), mat(s * 0.175, 0.31, -0.03, -0.25, 0, s * 0.12), brown ? 0xa85a2a : 0xf0e8d8);
    const legB = s < 0 ? 'legL' : 'legR';
    r.part(legB, limb(0.019, 0.016, 0.18, 0.02, 8), mat(s * 0.06, 0, 0), leg, { flat: true });
    for (const a of [-0.45, 0, 0.45]) {
      const t = limb(0.011, 0.009, 0.045, 0, 5);
      t.rotateX(Math.PI / 2);
      r.part(legB, t, mat(s * 0.06 + Math.sin(a) * 0.02, 0.012, 0.01, 0, a, 0), leg, { flat: true });
    }
  }
  // Head: round, red comb + wattle, stubby beak
  r.part('head', ellipsoid(0.115, 0.12, 0.115), mat(0, 0.53, 0.15), body);
  for (const [z, y, s] of [[0.1, 0.645, 0.036], [0.15, 0.665, 0.042], [0.2, 0.64, 0.034]] as const) r.part('head', ellipsoid(s * 0.55, s, s), mat(0, y, z), 0xe8342c);
  r.part('head', ellipsoid(0.022, 0.036, 0.02), mat(0, 0.455, 0.235), 0xe8342c);
  const beak = new THREE.ConeGeometry(0.032, 0.075, 10);
  beak.rotateX(Math.PI / 2);
  r.part('head', beak, mat(0, 0.515, 0.285), 0xf2b43a, { flat: true });
  eyes(r, 0.072, 0.555, 0.22, 0.021, 0.7);
  cheeks(r, 0.09, 0.505, 0.2, 0.022, 0xff7a70);
  const { mesh, bones } = r.build(animalMaterial(), 'chicken');
  return { mesh, bones, species: 'chicken', gait: { biped: true, speed: 0.55, freq: 3.2, legAmp: 0.55, bob: 0.025, eatPitch: 0.9, radius: 0.22, top: 0.72, sleepDrop: 0.1, fold: 0.25 } };
}

function duck(variant: number): AnimalModel {
  const r = new RigBuilder();
  const mallard = variant === 1;
  const body = mallard ? 0xb89a7c : 0xeae6dc;
  const head = mallard ? 0x2f7a4c : body;
  const bill = mallard ? 0xe8c040 : 0xf29a2a;
  const feet = 0xf29a2a;
  r.bone('body', 'root', [0, 0.26, 0]);
  r.bone('head', 'body', [0, 0.33, 0.15]);
  r.bone('eyes', 'head', [0, 0.555, 0.235]);
  r.bone('earL', 'head', [-0.05, 0.6, 0.18]);
  r.bone('earR', 'head', [0.05, 0.6, 0.18]);
  r.bone('tail', 'body', [0, 0.3, -0.24]);
  r.bone('wingL', 'body', [-0.14, 0.32, 0.0]);
  r.bone('wingR', 'body', [0.14, 0.32, 0.0]);
  r.bone('legL', 'body', [-0.065, 0.15, 0.0]);
  r.bone('legR', 'body', [0.065, 0.15, 0.0]);
  r.part('body', ellipsoid(0.17, 0.14, 0.25), mat(0, 0.26, -0.03), body);
  r.part('body', ellipsoid(0.145, 0.135, 0.13), mat(0, 0.27, 0.11), mallard ? 0x8a5a3e : body);
  r.part('tail', ellipsoid(0.07, 0.04, 0.09), mat(0, 0.33, -0.27, 0.6, 0, 0), mallard ? 0x3a3a3a : body);
  for (const s of [-1, 1]) {
    const w = s < 0 ? 'wingL' : 'wingR';
    r.part(w, ellipsoid(0.04, 0.09, 0.19), mat(s * 0.15, 0.29, -0.05, -0.12, 0, s * 0.1), mallard ? 0x9a8068 : 0xf0ece2);
    if (mallard) r.part(w, ellipsoid(0.02, 0.025, 0.05), mat(s * 0.185, 0.3, -0.06), 0x3a5ad8, { flat: true });
    const legB = s < 0 ? 'legL' : 'legR';
    r.part(legB, limb(0.02, 0.017, 0.15, 0.02, 8), mat(s * 0.065, 0, 0), feet, { flat: true });
    r.part(legB, ellipsoid(0.05, 0.012, 0.065, 10, 6), mat(s * 0.065, 0.013, 0.035), feet, { flat: true });
  }
  r.part('head', ellipsoid(0.065, 0.11, 0.065), mat(0, 0.41, 0.17), head);
  if (mallard) r.part('head', new THREE.TorusGeometry(0.066, 0.012, 6, 16), mat(0, 0.38, 0.17, Math.PI / 2 - 0.2, 0, 0), 0xffffff);
  r.part('head', ellipsoid(0.1, 0.1, 0.105), mat(0, 0.53, 0.19), head);
  r.part('head', ellipsoid(0.058, 0.02, 0.085), mat(0, 0.5, 0.31, -0.08, 0, 0), bill, { flat: true });
  r.part('head', ellipsoid(0.05, 0.014, 0.07), mat(0, 0.488, 0.3, -0.05, 0, 0), bill, { flat: true });
  eyes(r, 0.07, 0.555, 0.245, 0.019, 0.7);
  cheeks(r, 0.085, 0.515, 0.23, 0.02);
  const { mesh, bones } = r.build(animalMaterial(), 'duck');
  return { mesh, bones, species: 'duck', gait: { biped: true, speed: 0.5, freq: 2.8, legAmp: 0.5, bob: 0.02, eatPitch: 0.75, radius: 0.24, top: 0.72, sleepDrop: 0.1, fold: 0.25 } };
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
  return new THREE.LatheGeometry(pts, 12);
}

function legs(r: RigBuilder, d: QuadDims, coat: THREE.ColorRepresentation, hoofTint: number, paint?: (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => void): void {
  const top = d.bodyY - d.bodyR * 0.35;
  for (const [nm, x, z] of [['legFL', -d.hipX, d.frontZ], ['legFR', d.hipX, d.frontZ], ['legBL', -d.hipX, d.backZ], ['legBR', d.hipX, d.backZ]] as const) {
    r.bone(nm, 'body', [x, top, z]);
    r.part(nm, legGeo(d.legR, top + 0.04, d.hoof), mat(x, 0, z), coat, { paint, ground: true });
    // Rounded hoof: a squat bevelled cylinder with a darker sole
    const hoofG = new THREE.CylinderGeometry(d.legR * 0.92, d.legR * 1.08, d.hoof, 12, 1);
    hoofG.translate(0, d.hoof / 2, 0);
    r.part(nm, hoofG, mat(x, 0, z + d.legR * 0.08), hoofTint, { flat: true });
  }
}

/** Shoulder + haunch masses over a capsule body: gives quadrupeds a chest, a rump and a belly. */
function bodyMasses(r: RigBuilder, d: QuadDims, tint: THREE.ColorRepresentation, paint?: (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => void, k = 1): void {
  const R = d.bodyR;
  r.part('body', ellipsoid(R * 0.98, R * 1.02, R * 0.9), mat(0, d.bodyY + R * 0.06, d.frontZ + R * 0.1), tint, { paint });
  r.part('body', ellipsoid(R * 1.02, R * 1.0 * k, R * 0.95), mat(0, d.bodyY + R * 0.08, d.backZ - R * 0.05), tint, { paint });
  r.part('body', ellipsoid(R * 0.92, R * 0.8, (d.frontZ - d.backZ) * 0.75), mat(0, d.bodyY - R * 0.22, (d.frontZ + d.backZ) / 2), tint, { paint });
}

function cow(variant: number): AnimalModel {
  const r = new RigBuilder();
  const jersey = variant === 1;
  const base = jersey ? 0xc98f5e : 0xe8e2d6;
  const patch = jersey ? 0xf4e6d0 : 0x2c2826;
  const seed = variant * 3.3 + 1;
  const spots = (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
    if (jersey) blendPatch(c, patch, noise3(p.x * 2.2, p.y * 2.2, p.z * 2.2, seed), 0.55, 0.08);
    else blendPatch(c, patch, noise3(p.x * 3.4, p.y * 3.0, p.z * 3.2, seed) + 0.25 * Math.sin(p.z * 9 + p.x * 4), 0.22, 0.05);
  };
  const d: QuadDims = { bodyY: 0.74, bodyR: 0.36, bodyLen: 0.5, hipX: 0.2, frontZ: 0.26, backZ: -0.32, legR: 0.085, hoof: 0.09 };
  r.bone('body', 'root', [0, d.bodyY, 0]);
  r.bone('head', 'body', [0, 0.92, 0.42]);
  r.bone('eyes', 'head', [0, 1.09, 0.78]);
  r.bone('earL', 'head', [-0.23, 1.12, 0.55]);
  r.bone('earR', 'head', [0.23, 1.12, 0.55]);
  r.bone('tail', 'body', [0, 0.96, -0.6]);
  r.part('body', capsuleZ(d.bodyR, d.bodyLen, 10, 20), mat(0, d.bodyY, -0.04, 0, 0, 0, 1, 0.95, 1), base, { paint: spots });
  bodyMasses(r, d, base, spots, 1.02);
  // Udder + teats
  r.part('body', ellipsoid(0.14, 0.085, 0.15), mat(0, 0.44, -0.24), 0xf2aaa6);
  for (const [x, z] of [[-0.05, -0.2], [0.05, -0.2], [-0.05, -0.29], [0.05, -0.29]] as const) r.part('body', limb(0.018, 0.015, 0.4, 0.34, 6), mat(x, 0, z), 0xe8908c, { flat: true });
  // Collar + bell
  r.part('body', new THREE.TorusGeometry(0.235, 0.03, 8, 22), mat(0, 0.9, 0.42, Math.PI / 2 - 0.55, 0, 0), 0xc83a2e);
  r.part('body', new THREE.SphereGeometry(0.06, 12, 10), mat(0, 0.73, 0.55), 0xe8b840, { flat: true });
  r.part('body', limb(0.025, 0.025, 0.69, 0.67, 8), mat(0, 0, 0.55), 0x6a4a1a, { flat: true });
  legs(r, d, base, 0x3e302a, spots);
  // Tail with a tuft
  r.part('tail', limb(0.022, 0.018, 0.97, 0.5, 6), mat(0, 0, -0.63), base);
  r.part('tail', ellipsoid(0.045, 0.08, 0.045, 10, 8), mat(0, 0.47, -0.63), jersey ? 0x5a3a24 : 0x2c2826);
  // Big chibi head
  r.part('head', ellipsoid(0.27, 0.25, 0.26), mat(0, 1.06, 0.6), base, { paint: (p, n, c) => {
    if (!jersey && p.x > 0.02 && p.y > 1.0) blendPatch(c, patch, noise3(p.x * 4, p.y * 4, p.z * 4, 7), 0.05, 0.1);
  } });
  r.part('head', ellipsoid(0.21, 0.135, 0.14), mat(0, 0.95, 0.8), 0xf4bcae);
  for (const s of [-1, 1]) r.part('head', ellipsoid(0.028, 0.02, 0.012, 8, 6), mat(s * 0.075, 0.97, 0.935, 0, s * 0.3, 0), 0x6a3a34, { flat: true });
  r.part('head', ellipsoid(0.06, 0.018, 0.012, 8, 6), mat(0, 0.9, 0.935), 0x8a4a44, { flat: true });
  for (const s of [-1, 1]) {
    const horn = new THREE.ConeGeometry(0.04, 0.12, 10);
    r.part('head', horn, mat(s * 0.15, 1.3, 0.55, 0, 0, -s * 0.55), 0xf2e6c8, { flat: true });
    const ear = s < 0 ? 'earL' : 'earR';
    r.part(ear, ellipsoid(0.12, 0.05, 0.075), mat(s * 0.33, 1.11, 0.54, 0, 0, s * 0.3), base);
    r.part(ear, ellipsoid(0.08, 0.02, 0.05), mat(s * 0.34, 1.12, 0.575, 0, 0, s * 0.3), 0xf0a8a0, { flat: true });
  }
  // Forelock tuft
  for (let i = 0; i < 3; i++) r.part('head', ellipsoid(0.05, 0.04, 0.05, 8, 6), mat(-0.04 + i * 0.04, 1.29, 0.6 + (i % 2) * 0.03), jersey ? 0x9a6238 : base);
  eyes(r, 0.12, 1.09, 0.79, 0.042, 0.35);
  cheeks(r, 0.18, 1.0, 0.76, 0.04);
  const { mesh, bones } = r.build(animalMaterial(), 'cow');
  return { mesh, bones, species: 'cow', gait: { biped: false, speed: 0.55, freq: 1.55, legAmp: 0.38, bob: 0.02, eatPitch: 0.95, radius: 0.55, top: 1.55, sleepDrop: 0.36, fold: 0.3 } };
}

function goat(variant: number): AnimalModel {
  const r = new RigBuilder();
  const choc = variant === 1;
  const base = choc ? 0x7a4e30 : 0xf6f2e8;
  const saddle = choc ? 0x2e2420 : 0xc89868;
  const paint = (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
    if (p.z < 0.1) blendPatch(c, saddle, noise3(p.x * 3, p.y * 3, p.z * 3, 4) + (p.y - 0.7) * 6, -0.1, 0.15);
  };
  const d: QuadDims = { bodyY: 0.62, bodyR: 0.24, bodyLen: 0.36, hipX: 0.13, frontZ: 0.19, backZ: -0.22, legR: 0.05, hoof: 0.07 };
  r.bone('body', 'root', [0, d.bodyY, 0]);
  r.bone('head', 'body', [0, 0.78, 0.28]);
  r.bone('eyes', 'head', [0, 0.97, 0.5]);
  r.bone('earL', 'head', [-0.13, 0.95, 0.38]);
  r.bone('earR', 'head', [0.13, 0.95, 0.38]);
  r.bone('tail', 'body', [0, 0.74, -0.38]);
  r.part('body', capsuleZ(d.bodyR, d.bodyLen, 10, 18), mat(0, d.bodyY, -0.03), base, { paint });
  bodyMasses(r, d, base, paint);
  legs(r, d, base, 0x3a2e28);
  r.part('tail', ellipsoid(0.04, 0.09, 0.035, 8, 6), mat(0, 0.8, -0.4, -0.4, 0, 0), choc ? saddle : base);
  // Head + long snout + beard
  r.part('head', ellipsoid(0.165, 0.17, 0.18), mat(0, 0.95, 0.42), base);
  r.part('head', ellipsoid(0.105, 0.1, 0.13), mat(0, 0.88, 0.57), choc ? 0x8e6040 : 0xf2e4dc);
  r.part('head', ellipsoid(0.02, 0.012, 0.01, 6, 5), mat(-0.035, 0.9, 0.695), 0x4a2e2a, { flat: true });
  r.part('head', ellipsoid(0.02, 0.012, 0.01, 6, 5), mat(0.035, 0.9, 0.695), 0x4a2e2a, { flat: true });
  const beard = new THREE.ConeGeometry(0.04, 0.13, 8);
  beard.rotateX(Math.PI);
  r.part('head', beard, mat(0, 0.75, 0.58, 0.2, 0, 0), choc ? 0x2e2420 : 0xe6dccc);
  for (const s of [-1, 1]) {
    // Swept-back horns: a tapered tube curving up and over the crown
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 0.03, 0.09, -0.03), new THREE.Vector3(s * 0.06, 0.14, -0.11), new THREE.Vector3(s * 0.08, 0.12, -0.2)]);
    const horn = new THREE.TubeGeometry(curve, 10, 0.024, 7, false);
    const hp = horn.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < hp.count; i++) {
      const t = Math.floor(i / 8) / 10;
      const cp = curve.getPoint(Math.min(1, t));
      const k = 1 - t * 0.75;
      hp.setXYZ(i, cp.x + (hp.getX(i) - cp.x) * k, cp.y + (hp.getY(i) - cp.y) * k, cp.z + (hp.getZ(i) - cp.z) * k);
    }
    horn.computeVertexNormals();
    r.part('head', horn, mat(s * 0.07, 1.06, 0.42), 0xc8b898, { flat: true });
    const ear = s < 0 ? 'earL' : 'earR';
    r.part(ear, ellipsoid(0.1, 0.03, 0.05), mat(s * 0.22, 0.94, 0.39, 0, 0, s * -0.35), base);
    r.part(ear, ellipsoid(0.07, 0.015, 0.035), mat(s * 0.22, 0.945, 0.41, 0, 0, s * -0.35), 0xf0b0a8, { flat: true });
  }
  eyes(r, 0.1, 0.97, 0.52, 0.03, 0.5);
  cheeks(r, 0.12, 0.9, 0.52, 0.03);
  const { mesh, bones } = r.build(animalMaterial(), 'goat');
  return { mesh, bones, species: 'goat', gait: { biped: false, speed: 0.65, freq: 2.1, legAmp: 0.42, bob: 0.025, eatPitch: 0.9, radius: 0.4, top: 1.2, sleepDrop: 0.28, fold: 0.3 } };
}

function sheep(variant: number): AnimalModel {
  const r = new RigBuilder();
  const blackFace = variant === 1;
  const wool = 0xe6dece;
  const face = blackFace ? 0x4a3e3a : 0xf4e2d2;
  const d: QuadDims = { bodyY: 0.58, bodyR: 0.25, bodyLen: 0.3, hipX: 0.13, frontZ: 0.17, backZ: -0.2, legR: 0.045, hoof: 0.06 };
  r.bone('body', 'root', [0, d.bodyY, 0]);
  r.bone('wool', 'body', [0, d.bodyY + 0.02, -0.02]);
  r.bone('head', 'body', [0, 0.72, 0.3]);
  r.bone('eyes', 'head', [0, 0.86, 0.555]);
  r.bone('earL', 'head', [-0.12, 0.85, 0.42]);
  r.bone('earR', 'head', [0.12, 0.85, 0.42]);
  r.bone('tail', 'body', [0, 0.62, -0.4]);
  // Shorn body underneath
  r.part('body', capsuleZ(d.bodyR, d.bodyLen, 8, 16), mat(0, d.bodyY, -0.02), 0xe8d8c4);
  // Wool cloud: puffs over an ellipsoid shell
  const puff = (x: number, y: number, z: number, s: number) => r.part('wool', new THREE.IcosahedronGeometry(s, 2), mat(x, y, z), wool, { paint: (p, _n, c) => c.multiplyScalar(0.94 + 0.06 * noise3(p.x * 20, p.y * 20, p.z * 20, 3)) });
  let k = 0;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    for (let j = 0; j < 3; j++) {
      const t = j - 1;
      const z = -0.02 + t * 0.2;
      const ry = 0.28 * Math.sqrt(1 - t * t * 0.3);
      const y = d.bodyY + 0.03 + Math.sin(a) * ry * 0.9;
      const x = Math.cos(a) * 0.3 * Math.sqrt(1 - t * t * 0.3);
      if (y < d.bodyY - 0.18) continue;
      puff(x, y, z, 0.15 + ((k++ * 37) % 5) * 0.01);
    }
  }
  puff(0, d.bodyY + 0.28, -0.02, 0.18);
  puff(0, d.bodyY + 0.02, -0.33, 0.17);
  puff(0, d.bodyY + 0.05, 0.26, 0.17);
  puff(0, d.bodyY - 0.12, -0.02, 0.2);
  legs(r, d, face, 0x3a302c);
  r.part('tail', new THREE.IcosahedronGeometry(0.07, 1), mat(0, 0.62, -0.43), wool);
  // Head: face + wool cap
  r.part('head', ellipsoid(0.14, 0.15, 0.17), mat(0, 0.82, 0.45), face);
  r.part('head', ellipsoid(0.1, 0.085, 0.09), mat(0, 0.77, 0.56), blackFace ? 0x5a4a46 : 0xf6d2c8);
  r.part('head', ellipsoid(0.03, 0.012, 0.01, 6, 5), mat(0, 0.78, 0.648), 0x3a2626, { flat: true });
  for (const [x, y, z, s] of [[0, 0.97, 0.4, 0.1], [-0.08, 0.94, 0.44, 0.075], [0.08, 0.94, 0.44, 0.075], [0, 0.93, 0.34, 0.1]] as const) {
    r.part('head', new THREE.IcosahedronGeometry(s, 1), mat(x, y, z), wool);
  }
  for (const s of [-1, 1]) {
    const ear = s < 0 ? 'earL' : 'earR';
    r.part(ear, ellipsoid(0.1, 0.03, 0.05), mat(s * 0.2, 0.85, 0.42, 0, 0.3 * s, s * -0.2), face);
    r.part(ear, ellipsoid(0.07, 0.015, 0.03), mat(s * 0.2, 0.855, 0.44, 0, 0.3 * s, s * -0.2), 0xf0a8a0, { flat: true });
  }
  eyes(r, 0.085, 0.86, 0.56, 0.028, 0.45);
  cheeks(r, 0.11, 0.79, 0.53, 0.028);
  const { mesh, bones } = r.build(animalMaterial(), 'sheep');
  return { mesh, bones, species: 'sheep', gait: { biped: false, speed: 0.5, freq: 2.0, legAmp: 0.4, bob: 0.02, eatPitch: 0.95, radius: 0.42, top: 1.15, sleepDrop: 0.26, fold: 0.3 } };
}

function pig(variant: number): AnimalModel {
  const r = new RigBuilder();
  const spotted = variant === 1;
  const base = 0xf6b2aa;
  const spots = (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
    if (spotted) blendPatch(c, 0x5a3a36, noise3(p.x * 4, p.y * 4, p.z * 4, 9), 0.5, 0.08);
  };
  const d: QuadDims = { bodyY: 0.45, bodyR: 0.29, bodyLen: 0.32, hipX: 0.15, frontZ: 0.2, backZ: -0.21, legR: 0.062, hoof: 0.05 };
  r.bone('body', 'root', [0, d.bodyY, 0]);
  r.bone('head', 'body', [0, 0.52, 0.3]);
  r.bone('eyes', 'head', [0, 0.64, 0.56]);
  r.bone('earL', 'head', [-0.12, 0.74, 0.4]);
  r.bone('earR', 'head', [0.12, 0.74, 0.4]);
  r.bone('tail', 'body', [0, 0.52, -0.46]);
  r.part('body', capsuleZ(d.bodyR, d.bodyLen, 10, 18), mat(0, d.bodyY, -0.03, 0, 0, 0, 1, 0.94, 1), base, { paint: spots });
  legs(r, d, base, 0x7a4a44, spots);
  r.part('tail', new THREE.TorusGeometry(0.04, 0.013, 6, 14, 5.4), mat(0, 0.54, -0.47, 0, Math.PI / 2, 0), base);
  r.part('head', ellipsoid(0.22, 0.21, 0.2), mat(0, 0.58, 0.42), base, { paint: spots });
  const snout = new THREE.CylinderGeometry(0.1, 0.105, 0.09, 18);
  snout.rotateX(Math.PI / 2);
  r.part('head', snout, mat(0, 0.53, 0.6), 0xf29890);
  r.part('head', new THREE.CylinderGeometry(0.095, 0.095, 0.005, 18).rotateX(Math.PI / 2), mat(0, 0.53, 0.647), 0xf7aaa2, { flat: true });
  for (const s of [-1, 1]) r.part('head', ellipsoid(0.018, 0.028, 0.01, 6, 5), mat(s * 0.035, 0.53, 0.652), 0x8a4a48, { flat: true });
  for (const s of [-1, 1]) {
    const ear = s < 0 ? 'earL' : 'earR';
    const e = new THREE.ConeGeometry(0.085, 0.16, 4);
    e.scale(1, 1, 0.35);
    r.part(ear, e, mat(s * 0.13, 0.8, 0.44, 0.75, 0, s * -0.35), 0xf4a49c);
  }
  eyes(r, 0.1, 0.64, 0.57, 0.028, 0.4);
  cheeks(r, 0.14, 0.57, 0.55, 0.035, 0xff8a8a);
  const { mesh, bones } = r.build(animalMaterial(), 'pig');
  return { mesh, bones, species: 'pig', gait: { biped: false, speed: 0.5, freq: 2.5, legAmp: 0.45, bob: 0.02, eatPitch: 0.7, radius: 0.42, top: 1.0, sleepDrop: 0.2, fold: 0.35 } };
}

function dog(variant: number): AnimalModel {
  const r = new RigBuilder();
  const collie = variant === 1;
  const base = collie ? 0x3a2e2a : 0xd88a3c;
  const cream = 0xf6ead4;
  const belly = (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => {
    if (n.y < -0.35 || (p.z > 0.14 && p.y < 0.42 && n.z > 0.2)) c.set(cream);
  };
  const socks = (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
    if (p.y < 0.12) c.set(cream);
  };
  const d: QuadDims = { bodyY: 0.37, bodyR: 0.155, bodyLen: 0.26, hipX: 0.085, frontZ: 0.15, backZ: -0.17, legR: 0.038, hoof: 0.035 };
  r.bone('body', 'root', [0, d.bodyY, 0]);
  r.bone('head', 'body', [0, 0.46, 0.2]);
  r.bone('eyes', 'head', [0, 0.585, 0.375]);
  r.bone('earL', 'head', [-0.085, 0.66, 0.24]);
  r.bone('earR', 'head', [0.085, 0.66, 0.24]);
  r.bone('tail', 'body', [0, 0.45, -0.28]);
  r.part('body', capsuleZ(d.bodyR, d.bodyLen, 8, 16), mat(0, d.bodyY, -0.02), base, { paint: belly });
  legs(r, d, base, cream, socks);
  r.part('body', new THREE.TorusGeometry(0.105, 0.022, 7, 18), mat(0, 0.48, 0.2, Math.PI / 2 - 0.5, 0, 0), 0xd83a3a);
  r.part('body', new THREE.CylinderGeometry(0.03, 0.03, 0.01, 12).rotateX(Math.PI / 2), mat(0, 0.41, 0.3), 0xf2c440, { flat: true });
  const tail = new THREE.TorusGeometry(0.065, 0.032, 7, 14, 4.6);
  r.part('tail', tail, mat(0, 0.52, -0.26, 0, Math.PI / 2, 0.4), base, { paint: (p, _n, c) => { if (p.y > 0.57) c.set(cream); } });
  r.part('head', ellipsoid(0.165, 0.15, 0.15), mat(0, 0.56, 0.25), base);
  r.part('head', ellipsoid(0.085, 0.07, 0.1), mat(0, 0.5, 0.39), cream);
  for (const s of [-1, 1]) r.part('head', ellipsoid(0.07, 0.06, 0.06), mat(s * 0.07, 0.52, 0.34), cream);
  r.part('head', ellipsoid(0.03, 0.022, 0.022, 10, 8), mat(0, 0.535, 0.49), 0x1a1412, { flat: true });
  r.part('head', ellipsoid(0.01, 0.007, 0.006, 6, 5), mat(-0.01, 0.545, 0.51), 0xffffff, { flat: true });
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
  eyes(r, 0.07, 0.585, 0.375, 0.026, 0.4);
  cheeks(r, 0.1, 0.53, 0.35, 0.026, 0xff9a8a);
  const { mesh, bones } = r.build(animalMaterial(), 'dog');
  return { mesh, bones, species: 'dog', gait: { biped: false, speed: 1.1, freq: 3.2, legAmp: 0.5, bob: 0.02, eatPitch: 0.75, radius: 0.28, top: 0.9, sleepDrop: 0.19, fold: 0.35 } };
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
  legs(r, d, base, cream, (p, _n, c) => { if (p.y < 0.07) c.set(cream); });
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
  eyes(r, 0.052, 0.44, 0.29, 0.022, 0.45);
  cheeks(r, 0.075, 0.39, 0.27, 0.02);
  const { mesh, bones } = r.build(animalMaterial(), 'cat');
  return { mesh, bones, species: 'cat', gait: { biped: false, speed: 0.8, freq: 3.0, legAmp: 0.45, bob: 0.015, eatPitch: 0.7, radius: 0.22, top: 0.7, sleepDrop: 0.14, fold: 0.35 } };
}

const BUILDERS: Record<Species, (v: number) => AnimalModel> = { chicken, duck, cow, goat, sheep, pig, dog, cat };

export function buildAnimal(species: Species, variant = 0): AnimalModel {
  return BUILDERS[species](variant);
}
