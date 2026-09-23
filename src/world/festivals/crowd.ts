/**
 * Festival crowd: every festival-goer (named villagers + townsfolk) merged into ONE mesh and
 * posed on the GPU. Each vertex carries its bone (legs, torso, head, arms, eyes), the bone's pivot
 * and its member index; a small float DataTexture holds per-member position / yaw / animation /
 * phase / speed / scale. The vertex shader evaluates the animation (idle, cheer, clap, dance,
 * skate, sit, lantern-raise, sack hop, fiddle, carol…) and applies the rig hierarchy.
 *
 * Result: 40+ fully animated chibi villagers in festival outfits for 1 main + 1 shadow draw call.
 * Same proportions and palette as entities/villager.ts so they read as the same people.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { NpcLook } from '../../data/npcs';
import { prep, roundedBox, mat, lumpySphere, sphericalNormals } from '../geom';
import { applyWorldFx } from '../../render/worldfx';
import { patchMaterial, after, before } from '../../render/patch';
import { globalUniforms } from '../../render/uniforms';
import { Rng } from '../../core/rng';

/** Animation clips evaluated in the vertex shader. */
export const Anim = {
  idle: 0,
  cheer: 1,
  clap: 2,
  dance: 3,
  skate: 4,
  walk: 5,
  wave: 6,
  sit: 7,
  lantern: 8,
  talk: 9,
  judge: 10,
  sack: 11,
  fiddle: 12,
  carol: 13,
  sway: 14,
  toast: 15,
} as const;
export type AnimName = keyof typeof Anim;

export type Outfit = 'spring' | 'summer' | 'fall' | 'winter' | 'plain';
export type HeldProp =
  | 'lantern'
  | 'lanternPole'
  | 'clipboard'
  | 'songbook'
  | 'fiddle'
  | 'bouquet'
  | 'sack'
  | 'mug'
  | 'gift'
  | 'balloon'
  | 'flag'
  | 'skates'
  | 'rosette'
  | 'pie'
  | 'flute';

export interface CrowdSpec {
  id?: string;
  look: NpcLook;
  outfit: Outfit;
  anim: AnimName;
  x: number;
  z: number;
  yaw: number;
  /** Height offset above the ground (seats, stages, floats). */
  lift?: number;
  phase?: number;
  speed?: number;
  props?: HeldProp[];
  /** Festive recolour of the top / bottom (else the look's own colours). */
  top?: number;
  bottom?: number;
  accent?: number;
}

const enum Bone {
  Root = 0,
  Torso = 1,
  Head = 2,
  ArmL = 3,
  ArmR = 4,
  LegL = 5,
  LegR = 6,
  Eye = 7,
}

const WAIST = new THREE.Vector3(0, 0.5, 0);
const NECK = new THREE.Vector3(0, 0.96, 0);
const HEAD_S = 1.15;
const R = 0.32;

/** Accumulates bone-tagged parts for one member (canonical, unscaled rig space). */
class RigBuilder {
  parts: THREE.BufferGeometry[] = [];
  add(bone: Bone, pivot: THREE.Vector3, geo: THREE.BufferGeometry, m: THREE.Matrix4 | undefined, color: THREE.ColorRepresentation, glow = 0): void {
    const g = prep(geo, color);
    if (m) g.applyMatrix4(m);
    const n = g.attributes.position!.count;
    const bone32 = new Float32Array(n).fill(bone);
    const piv = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      piv[i * 3] = pivot.x;
      piv[i * 3 + 1] = pivot.y;
      piv[i * 3 + 2] = pivot.z;
    }
    g.setAttribute('aBone', new THREE.BufferAttribute(bone32, 1));
    g.setAttribute('aPivot', new THREE.BufferAttribute(piv, 3));
    g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
    this.parts.push(g);
  }
}

const tmpM = new THREE.Matrix4();
/** Head-local → rig space. */
function headM(local?: THREE.Matrix4): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeTranslation(NECK.x, NECK.y, NECK.z).multiply(tmpM.makeScale(HEAD_S, HEAD_S, HEAD_S));
  return local ? m.multiply(local) : m;
}
function shade(c: number, k: number): number {
  return new THREE.Color(c).multiplyScalar(k).getHex();
}

/** Build one festival-goer (rig space: feet at origin, facing +Z). */
function buildMember(spec: CrowdSpec, seed: string): THREE.BufferGeometry {
  const L = spec.look;
  const rng = new Rng(seed);
  const b = new RigBuilder();
  const bw = L.build;
  const props = new Set(spec.props ?? []);
  const o = spec.outfit;
  const top = spec.top ?? L.top;
  const bottom = spec.bottom ?? L.bottom;
  const accent = spec.accent ?? 0xf5c542;
  const winter = o === 'winter';
  const skates = props.has('skates');
  const hand = winter ? shade(accent, 0.9) : L.skin;

  // ── legs
  for (const [bone, sx] of [[Bone.LegL, -1], [Bone.LegR, 1]] as const) {
    const pv = new THREE.Vector3(sx * 0.12 * bw, 0.5, 0);
    const T = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1, sy = s, sz = s) => new THREE.Matrix4().makeTranslation(pv.x, pv.y, pv.z).multiply(mat(x, y, z, rx, ry, rz, s, sy, sz));
    b.add(bone, pv, new THREE.CapsuleGeometry(0.095, 0.22, 3, 8), T(0, -0.19, 0), winter ? shade(bottom, 0.9) : bottom);
    const boot = winter ? 0x6a4a36 : o === 'summer' ? 0xc89a6a : 0x5a3a24;
    b.add(bone, pv, roundedBox(0.19, winter ? 0.18 : 0.14, 0.26, 0.06, 1), T(0, winter ? -0.41 : -0.43, 0.035), boot);
    b.add(bone, pv, roundedBox(0.2, 0.04, 0.28, 0.02, 1), T(0, -0.49, 0.04), shade(boot, 0.65));
    if (winter) b.add(bone, pv, new THREE.TorusGeometry(0.1, 0.03, 4, 10), T(0, -0.33, 0.02, Math.PI / 2), 0xf4efe6);
    if (skates) {
      b.add(bone, pv, roundedBox(0.03, 0.06, 0.34, 0.01, 1), T(0, -0.53, 0.04), 0xd8dde4);
      b.add(bone, pv, new THREE.TorusGeometry(0.05, 0.012, 4, 8, Math.PI), T(0, -0.52, 0.2, 0, Math.PI / 2, 0), 0xd8dde4);
    }
  }
  // ── torso (waist pivot)
  const P = WAIST;
  const TT = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().makeTranslation(P.x, P.y, P.z).multiply(mat(x, y, z, rx, ry, rz, sx, sy, sz));
  const puff = winter ? 1.14 : 1;
  b.add(Bone.Torso, P, new THREE.CapsuleGeometry(0.2, 0.18, 3, 10), TT(0, 0.18, 0, 0, 0, 0, 1.05 * bw * puff, 1, 0.92 * bw * puff), top);
  b.add(Bone.Torso, P, new THREE.CylinderGeometry(0.215 * bw * puff, 0.205 * bw * puff, 0.18, 12), TT(0, 0.0, 0), winter ? top : bottom);
  if (winter) {
    // Puffy coat: quilted bands + toggles, fleece collar.
    for (const y of [0.1, 0.24]) b.add(Bone.Torso, P, new THREE.TorusGeometry(0.228 * bw, 0.022, 4, 16), TT(0, y, 0, Math.PI / 2, 0, 0, 1, 0.92, 1), shade(top, 0.86));
    b.add(Bone.Torso, P, new THREE.TorusGeometry(0.14, 0.05, 6, 14), TT(0, 0.37, 0, Math.PI / 2), 0xf4efe6);
    for (let i = 0; i < 3; i++) b.add(Bone.Torso, P, roundedBox(0.05, 0.02, 0.02, 0.008, 1), TT(0, 0.3 - i * 0.1, 0.235 * bw), 0xf0e0c0);
  } else {
    for (let i = 0; i < 3; i++) b.add(Bone.Torso, P, new THREE.SphereGeometry(0.018, 5, 4), TT(0, 0.32 - i * 0.08, 0.2 * bw), 0xf0e0c0);
  }
  // Outfit layers on the torso / root.
  if (o === 'spring') {
    // Pastel sash + a flower garland necklace.
    b.add(Bone.Torso, P, new THREE.TorusGeometry(0.215 * bw, 0.028, 4, 16), TT(0, 0.2, 0, Math.PI / 2 - 0.5, 0, 0.25), accent);
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * 0.15 + (i / 8) * Math.PI * 0.7;
      b.add(Bone.Torso, P, new THREE.IcosahedronGeometry(0.035, 0), TT(Math.cos(a) * 0.17, 0.33 - Math.sin(a) * 0.05, Math.sin(a) * 0.16), [0xff8fab, 0xffffff, 0xffd166][i % 3]!);
    }
  } else if (o === 'summer') {
    // Wrap robe: crossed collar + a wide obi-style sash with a bow at the back.
    b.add(Bone.Torso, P, roundedBox(0.07, 0.34, 0.02, 0.01, 1), TT(0.04, 0.2, 0.19 * bw, 0, 0, -0.45), shade(top, 1.25));
    b.add(Bone.Torso, P, new THREE.CylinderGeometry(0.225 * bw, 0.225 * bw, 0.1, 14), TT(0, 0.06, 0), accent);
    b.add(Bone.Torso, P, roundedBox(0.22, 0.12, 0.06, 0.03, 1), TT(0, 0.07, -0.22 * bw), accent);
  } else if (o === 'fall') {
    // Knit cardigan front panels + a scarf.
    for (const sx of [-1, 1]) b.add(Bone.Torso, P, roundedBox(0.1, 0.36, 0.03, 0.012, 1), TT(sx * 0.08, 0.17, 0.195 * bw), shade(top, 0.75));
    b.add(Bone.Torso, P, new THREE.TorusGeometry(0.13, 0.045, 6, 14), TT(0, 0.38, 0, Math.PI / 2 - 0.2), accent);
    b.add(Bone.Torso, P, roundedBox(0.09, 0.24, 0.04, 0.02, 1), TT(0.07, 0.24, 0.18, 0.15, 0, 0.15), accent);
  }
  if (winter) {
    // Long knitted scarf with tails.
    const sc = spec.accent ?? 0xd8473a;
    b.add(Bone.Torso, P, new THREE.TorusGeometry(0.14, 0.055, 6, 14), TT(0, 0.4, 0, Math.PI / 2 - 0.18), sc);
    b.add(Bone.Torso, P, roundedBox(0.1, 0.3, 0.045, 0.02, 1), TT(-0.08, 0.2, 0.2, 0.1, 0, -0.12), sc);
    b.add(Bone.Torso, P, roundedBox(0.1, 0.2, 0.045, 0.02, 1), TT(0.12, 0.34, -0.19, -0.3, 0, 0.3), sc);
    for (const y of [0.1, 0.24]) b.add(Bone.Torso, P, roundedBox(0.105, 0.02, 0.05, 0.008, 1), TT(-0.08, y, 0.21), 0xf4efe6);
  }
  // Skirt / robe hem (root-bound so the legs swing under it).
  const skirt = o === 'summer' || (o === 'spring' && L.hairStyle !== 'short' && L.hairStyle !== 'cap') || L.hairStyle === 'bun';
  if (skirt || winter) {
    const len = o === 'summer' ? 0.3 : winter ? 0.2 : 0.22;
    const g = new THREE.CylinderGeometry(0.215 * bw * puff, (0.3 + (winter ? 0.02 : 0.05)) * bw, len, 16, 1, true);
    b.add(Bone.Root, WAIST, g, mat(0, 0.5 - len / 2 - 0.04, 0), winter ? top : o === 'summer' ? top : bottom);
    if (o === 'spring') b.add(Bone.Root, WAIST, new THREE.TorusGeometry(0.34 * bw, 0.018, 4, 18), mat(0, 0.5 - len - 0.04, 0, Math.PI / 2), 0xffffff);
    if (winter) b.add(Bone.Root, WAIST, new THREE.TorusGeometry(0.31 * bw, 0.035, 4, 18), mat(0, 0.5 - len - 0.04, 0, Math.PI / 2), 0xf4efe6);
  }
  if (props.has('sack')) {
    // Burlap sack pulled up to the waist, gathered at the top.
    const sack = new THREE.CylinderGeometry(0.29 * bw, 0.26 * bw, 0.62, 12, 3, true);
    const sp = sack.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) sp.setX(i, sp.getX(i) * (1 + (rng.next() - 0.5) * 0.08));
    b.add(Bone.Root, WAIST, sack, mat(0, 0.3, 0), 0xc8a46a);
    b.add(Bone.Root, WAIST, new THREE.CircleGeometry(0.26 * bw, 12), mat(0, 0.0, 0, -Math.PI / 2), 0xb08a52);
    b.add(Bone.Root, WAIST, new THREE.TorusGeometry(0.29 * bw, 0.03, 4, 14), mat(0, 0.6, 0, Math.PI / 2), 0xa88450);
    b.add(Bone.Root, WAIST, roundedBox(0.2, 0.12, 0.01, 0.01, 1), mat(0, 0.34, 0.29 * bw), 0x8a3a2a);
  }
  if (props.has('rosette')) {
    b.add(Bone.Torso, P, new THREE.CylinderGeometry(0.06, 0.06, 0.015, 10), TT(-0.1, 0.3, 0.2, Math.PI / 2), 0x3f6fd0);
    b.add(Bone.Torso, P, new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), TT(-0.1, 0.3, 0.21, Math.PI / 2), 0xf5c542);
    for (const sx of [-1, 1]) b.add(Bone.Torso, P, roundedBox(0.03, 0.1, 0.008, 0.004, 1), TT(-0.1 + sx * 0.02, 0.22, 0.205, 0, 0, sx * 0.25), 0x3f6fd0);
  }

  // ── arms
  for (const [bone, sx] of [[Bone.ArmL, -1], [Bone.ArmR, 1]] as const) {
    const pv = new THREE.Vector3(sx * 0.25 * bw, 0.82, 0);
    const T = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1, sy = s, sz = s) => new THREE.Matrix4().makeTranslation(pv.x, pv.y, pv.z).multiply(mat(x, y, z, rx, ry, rz, s, sy, sz));
    const sleeve = winter ? top : o === 'summer' ? top : top;
    b.add(bone, pv, new THREE.CapsuleGeometry(0.075 * puff, 0.08, 3, 8), T(0, -0.06, 0), sleeve);
    b.add(bone, pv, new THREE.CapsuleGeometry(0.058 * puff, 0.12, 3, 8), T(0, -0.2, 0), sleeve);
    if (o === 'summer') b.add(bone, pv, new THREE.CylinderGeometry(0.075, 0.1, 0.16, 10, 1, true), T(0, -0.2, 0), shade(top, 0.95));
    if (winter) b.add(bone, pv, new THREE.TorusGeometry(0.06, 0.022, 4, 10), T(0, -0.27, 0, Math.PI / 2), 0xf4efe6);
    b.add(bone, pv, new THREE.SphereGeometry(winter ? 0.078 : 0.07, 8, 6), T(0, -0.31, 0), hand);
    const H = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1, sy = s, sz = s) => T(0, -0.31, 0).multiply(mat(x, y, z, rx, ry, rz, s, sy, sz));
    if (bone === Bone.ArmR) {
      if (props.has('lantern')) {
        // Paper lantern held up between the hands (glows).
        const lan = lumpySphere(0.13, 1, 0.03, rng, 2);
        lan.scale(1, 1.2, 1);
        b.add(bone, pv, lan, H(-0.24 * bw, -0.2, 0.04), spec.accent ?? 0xff9a50, 1);
        b.add(bone, pv, new THREE.CylinderGeometry(0.06, 0.06, 0.03, 8), H(-0.24 * bw, -0.05, 0.04), 0x3a2a1e);
        b.add(bone, pv, new THREE.CylinderGeometry(0.05, 0.05, 0.03, 8), H(-0.24 * bw, -0.36, 0.04), 0x3a2a1e);
      }
      if (props.has('lanternPole')) {
        // Little lantern dangling from a bamboo stick.
        b.add(bone, pv, new THREE.CylinderGeometry(0.012, 0.012, 0.7, 5), H(0, -0.05, 0.3, Math.PI / 2 - 0.5), 0xb89a5a);
        b.add(bone, pv, new THREE.CylinderGeometry(0.004, 0.004, 0.12, 3), H(0, -0.16, 0.6), 0x3a2a1e);
        const lan = lumpySphere(0.09, 1, 0.02, rng, 2);
        lan.scale(1, 1.25, 1);
        b.add(bone, pv, lan, H(0, -0.3, 0.6), spec.accent ?? 0xffb050, 1);
      }
      if (props.has('mug')) {
        b.add(bone, pv, new THREE.CylinderGeometry(0.055, 0.05, 0.11, 10), H(0, -0.02, 0.07), 0xd8573e);
        b.add(bone, pv, new THREE.CylinderGeometry(0.047, 0.047, 0.01, 10), H(0, 0.04, 0.07), 0x5a3020);
      }
      if (props.has('flag')) {
        b.add(bone, pv, new THREE.CylinderGeometry(0.01, 0.01, 0.5, 4), H(0, -0.1, 0.05), 0xb89a5a);
        const s = new THREE.Shape();
        s.moveTo(0, 0);
        s.lineTo(0.22, -0.06);
        s.lineTo(0, -0.14);
        s.closePath();
        b.add(bone, pv, new THREE.ShapeGeometry(s), H(0.0, -0.33, 0.05, 0, Math.PI / 2, Math.PI), spec.accent ?? 0xe8674a);
      }
      if (props.has('bouquet')) {
        b.add(bone, pv, new THREE.ConeGeometry(0.06, 0.16, 7), H(0, 0.03, 0.06, Math.PI), 0xf6ecd8);
        for (let i = 0; i < 5; i++) b.add(bone, pv, new THREE.IcosahedronGeometry(0.035, 0), H((i % 3) * 0.03 - 0.03, 0.14, 0.06 + (i % 2) * 0.03), [0xff8fab, 0xffd166, 0xffffff, 0xc77dff, 0xff6a6a][i]!);
      }
      if (props.has('songbook')) b.add(bone, pv, roundedBox(0.2, 0.02, 0.15, 0.01, 1), H(-0.08, 0.02, 0.07, -0.4), 0x8a2a2a);
      if (props.has('pie')) {
        b.add(bone, pv, new THREE.CylinderGeometry(0.15, 0.12, 0.05, 12), H(-0.12, 0.05, 0.1), 0xd89048);
        b.add(bone, pv, new THREE.CylinderGeometry(0.13, 0.13, 0.012, 12), H(-0.12, 0.08, 0.1), 0x8a2a3a);
      }
      if (props.has('gift')) {
        b.add(bone, pv, roundedBox(0.24, 0.2, 0.2, 0.02, 1), H(-0.22 * bw, 0.02, 0.08), spec.accent ?? 0x3f8f6a);
        b.add(bone, pv, roundedBox(0.25, 0.21, 0.04, 0.01, 1), H(-0.22 * bw, 0.02, 0.08), 0xf5c542);
        b.add(bone, pv, new THREE.TorusGeometry(0.04, 0.015, 4, 8), H(-0.22 * bw, 0.14, 0.08, 0, 0, Math.PI / 2), 0xf5c542);
      }
      if (props.has('balloon')) {
        b.add(bone, pv, new THREE.CylinderGeometry(0.003, 0.003, 0.9, 3), H(0, 0.45, 0), 0xf4f0e8);
        const bl = new THREE.SphereGeometry(0.16, 10, 8);
        bl.scale(1, 1.2, 1);
        b.add(bone, pv, bl, H(0, 1.0, 0), spec.accent ?? 0xe8574a);
      }
      if (props.has('fiddle')) {
        // Bow (right hand).
        b.add(bone, pv, roundedBox(0.012, 0.012, 0.55, 0.004, 1), H(0, 0, 0.2, 0.2, 0.9, 0), 0x6a3a1e);
      }
      if (props.has('flute')) b.add(bone, pv, new THREE.CylinderGeometry(0.014, 0.014, 0.36, 6), H(-0.12, 0.02, 0.06, 0, 0, Math.PI / 2 - 0.2), 0xd8b060);
    } else {
      if (props.has('clipboard')) {
        b.add(bone, pv, roundedBox(0.2, 0.26, 0.02, 0.01, 1), H(0.06, 0.02, 0.1, -0.7), 0x9a6a44);
        b.add(bone, pv, roundedBox(0.17, 0.2, 0.01, 0.005, 1), H(0.06, 0.02, 0.114, -0.7), 0xf6f0e0);
      }
      if (props.has('fiddle')) {
        const body = new THREE.SphereGeometry(0.1, 8, 6);
        body.scale(0.75, 1.2, 0.3);
        b.add(bone, pv, body, H(0.1, 0.02, 0.12, 0.3, 0, 1.0), 0xa0522d);
        b.add(bone, pv, roundedBox(0.03, 0.26, 0.02, 0.008, 1), H(0.02, 0.12, 0.1, 0.3, 0, 1.0), 0x3a2010);
      }
    }
  }

  // ── head
  const HP = NECK;
  const hm = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => headM(mat(x, y, z, rx, ry, rz, sx, sy, sz));
  b.add(Bone.Head, HP, new THREE.SphereGeometry(R, 14, 10), hm(0, R * 0.92, 0, 0, 0, 0, 1.04, 0.96, 1), L.skin);
  for (const sx of [-1, 1]) b.add(Bone.Head, HP, new THREE.SphereGeometry(0.07, 7, 5), hm(sx * R * 0.98, R * 0.88, 0, 0, 0, 0, 0.6, 1, 1), L.skin);
  b.add(Bone.Head, HP, new THREE.SphereGeometry(0.03, 6, 5), hm(0, R * 0.78, R * 0.99), shade(L.skin, 1.05));
  for (const sx of [-1, 1]) {
    b.add(Bone.Head, HP, new THREE.CapsuleGeometry(0.012, 0.05, 2, 5), hm(sx * 0.115, R * 1.2, R * 0.93, 0, 0, Math.PI / 2 + sx * 0.14), shade(L.hair, 0.8));
    b.add(Bone.Head, HP, new THREE.CircleGeometry(0.052, 10), hm(sx * 0.19, R * 0.74, R * 0.875, 0, sx * 0.55, 0), winter ? 0xf08a80 : 0xf29a86);
  }
  // Open happy smile at festivals.
  b.add(Bone.Head, HP, new THREE.CircleGeometry(0.042, 10, Math.PI, Math.PI), hm(0, R * 0.66, R * 0.975, -0.2), 0x6a2a24);
  b.add(Bone.Head, HP, new THREE.CircleGeometry(0.03, 8, Math.PI * 1.15, Math.PI * 0.7), hm(0, R * 0.635, R * 0.985, -0.2), 0xe87a7a);
  if (L.glasses) {
    for (const sx of [-1, 1]) b.add(Bone.Head, HP, new THREE.TorusGeometry(0.068, 0.011, 4, 14), hm(sx * 0.115, R * 0.97, R * 1.0), 0x6a4a2a);
    b.add(Bone.Head, HP, roundedBox(0.07, 0.014, 0.014, 0.005, 1), hm(0, R * 1.0, R * 1.02), 0x6a4a2a);
  }
  if (L.beard) {
    const beard = lumpySphere(0.2, 1, 0.18, rng, 2);
    beard.scale(1.35, 0.9, 0.7);
    b.add(Bone.Head, HP, beard, hm(0, R * 0.5, R * 0.62), L.hair);
    const st = new THREE.CapsuleGeometry(0.035, 0.12, 2, 6);
    st.rotateZ(Math.PI / 2);
    b.add(Bone.Head, HP, st, hm(0, R * 0.73, R * 0.95), shade(L.hair, 0.9));
  }
  // Hair (winter hats replace the crown)
  const hatted = winter && L.hairStyle !== 'cap';
  const cap = new THREE.SphereGeometry(R * 1.07, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.55);
  b.add(Bone.Head, HP, cap, hm(0, R * 0.98, -0.02, -0.25, 0, 0), L.hair);
  if (L.hairStyle === 'bun') {
    if (!hatted) b.add(Bone.Head, HP, lumpySphere(0.17, 1, 0.12, rng, 2), hm(0, R * 1.85, -R * 0.35), L.hair);
    for (const sx of [-1, 1]) b.add(Bone.Head, HP, lumpySphere(0.12, 1, 0.1, rng), hm(sx * R * 0.86, R * 1.0, R * 0.2, 0, 0, 0, 0.6, 1.1, 0.9), L.hair);
    b.add(Bone.Head, HP, lumpySphere(0.2, 1, 0.1, rng, 1.4), hm(0, R * 1.42, R * 0.55, 0.5, 0, 0, 1.6, 0.5, 0.7), L.hair);
  } else if (L.hairStyle === 'bob') {
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * 0.35 + (i / 8) * Math.PI * 1.3;
      b.add(Bone.Head, HP, lumpySphere(0.15, 1, 0.15, rng), hm(Math.sin(a) * R * 0.92, R * 0.62 + (i % 2) * 0.04, Math.cos(a) * R * 0.88), L.hair);
    }
    for (const [a, len] of [[-0.45, 1.3], [0.1, 1.15], [0.55, 1.0]] as const) {
      const lock = lumpySphere(0.15, 1, 0.08, rng, 1.2);
      lock.scale(len, 0.5, 0.6);
      sphericalNormals(lock, new THREE.Vector3(), 0.35);
      b.add(Bone.Head, HP, lock, hm(Math.sin(a) * R * 0.72, R * 1.36, Math.cos(a) * R * 0.72, 0.6, a, 0), L.hair);
    }
  } else if (L.hairStyle === 'cap') {
    const capTint = winter ? accent : 0xf6f0e4;
    b.add(Bone.Head, HP, new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.12, 16, 1, true), hm(0, R * 1.55, -0.02, -0.12), capTint);
    const pf = lumpySphere(R * 1.05, 1, 0.12, rng, 1.6);
    pf.scale(1.1, 0.55, 1.1);
    b.add(Bone.Head, HP, pf, hm(0, R * 1.78, -0.05, -0.15), winter ? shade(accent, 1.1) : 0xfaf6ee);
    for (const sx of [-1, 1]) b.add(Bone.Head, HP, lumpySphere(0.1, 1, 0.12, rng), hm(sx * R * 0.9, R * 0.95, R * 0.1, 0, 0, 0, 0.6, 1, 0.9), L.hair);
  } else {
    for (let i = 0; i < 6; i++) {
      const a = -0.9 + i * 0.36;
      b.add(Bone.Head, HP, lumpySphere(0.13, 1, 0.18, rng), hm(Math.sin(a) * R * 0.8, R * 1.35, Math.cos(a) * R * 0.75), L.hair);
    }
  }
  // Festival headwear
  if (o === 'spring') {
    // Flower crown.
    const ring = new THREE.TorusGeometry(R * 0.98, 0.028, 4, 20);
    b.add(Bone.Head, HP, ring, hm(0, R * 1.52, -0.02, Math.PI / 2 - 0.28), 0x5a9a3a);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const fx = Math.cos(a) * R * 0.98;
      const fz = Math.sin(a) * R * 0.98;
      const tilt = -0.28;
      const y = R * 1.52 - fz * Math.sin(tilt) * -1;
      b.add(Bone.Head, HP, new THREE.IcosahedronGeometry(i % 3 === 0 ? 0.055 : 0.042, 0), hm(fx, y, fz * Math.cos(tilt) - 0.02), [0xff8fab, 0xffffff, 0xffd166, 0xc77dff, 0xff6a8a][(i + (spec.phase ?? 0) * 10) % 5 | 0]!);
    }
  } else if (o === 'summer') {
    // A big flower tucked behind the ear.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const pet = new THREE.SphereGeometry(0.06, 6, 4);
      pet.scale(1, 0.35, 0.6);
      b.add(Bone.Head, HP, pet, hm(R * 0.95 + Math.cos(a) * 0.05, R * 1.25 + Math.sin(a) * 0.05, R * 0.25, 0, Math.PI / 2, a), accent);
    }
    b.add(Bone.Head, HP, new THREE.SphereGeometry(0.03, 6, 4), hm(R * 1.0, R * 1.25, R * 0.25), 0xffe070);
  } else if (o === 'fall' && L.hairStyle !== 'cap' && L.hairStyle !== 'bun') {
    // Felt hat with a band and a feather.
    b.add(Bone.Head, HP, new THREE.CylinderGeometry(R * 1.35, R * 1.35, 0.03, 18), hm(0, R * 1.5, 0, -0.12), shade(accent, 0.55));
    b.add(Bone.Head, HP, new THREE.CylinderGeometry(R * 0.75, R * 0.85, 0.24, 14), hm(0, R * 1.5 + 0.13, -0.02, -0.12), shade(accent, 0.55));
    b.add(Bone.Head, HP, new THREE.CylinderGeometry(R * 0.86, R * 0.86, 0.06, 14), hm(0, R * 1.5 + 0.05, -0.02, -0.12), 0x8a2a1e);
    b.add(Bone.Head, HP, roundedBox(0.03, 0.22, 0.01, 0.01, 1), hm(R * 0.8, R * 1.9, -0.05, 0, 0, -0.5), 0xd8a040);
  } else if (hatted) {
    // Knit beanie with a pompom (+ earmuffs for bob hairstyles).
    const hat = new THREE.SphereGeometry(R * 1.1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    b.add(Bone.Head, HP, hat, hm(0, R * 1.12, -0.02, -0.2), accent);
    b.add(Bone.Head, HP, new THREE.TorusGeometry(R * 1.06, 0.05, 5, 18), hm(0, R * 1.15, -0.02, Math.PI / 2 - 0.2), shade(accent, 0.8));
    b.add(Bone.Head, HP, lumpySphere(0.09, 1, 0.2, rng, 3), hm(0, R * 2.2, -R * 0.25), 0xf4efe6);
  }

  // ── eyes (blink)
  for (const sx of [-1, 1]) {
    const local = new THREE.Vector3(sx * 0.115, R * 0.95, R * 0.9);
    const pivot = local.clone().multiplyScalar(HEAD_S).add(NECK);
    const em = headM(mat(local.x, local.y, local.z, -0.12));
    // Happy crescent eyes for some, round for others.
    b.add(Bone.Eye, pivot, new THREE.CapsuleGeometry(0.036, 0.046, 3, 8), em, 0x1d1612);
    b.add(Bone.Eye, pivot, new THREE.SphereGeometry(0.014, 5, 4), em.clone().multiply(mat(0.013, 0.024, 0.03)), 0xffffff);
  }

  const merged = mergeGeometries(b.parts);
  for (const p of b.parts) p.dispose();
  return merged!;
}

const CROWD_GLSL = /* glsl */ `
uniform sampler2D uCrowd;
uniform float uCrowdN;
attribute float aBone;
attribute vec3 aPivot;
attribute float aMember;
attribute float aGlow;
varying float vCrowdGlow;
mat3 crX(float a){ float c = cos(a), s = sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }
mat3 crY(float a){ float c = cos(a), s = sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }
mat3 crZ(float a){ float c = cos(a), s = sin(a); return mat3(c,s,0.0, -s,c,0.0, 0.0,0.0,1.0); }
float crPos(float x){ return max(x, 0.0); }
void crowdPose(inout vec3 p, inout vec3 n) {
  vec4 A = texelFetch(uCrowd, ivec2(int(aMember), 0), 0);
  vec4 B = texelFetch(uCrowd, ivec2(int(aMember), 1), 0);
  float anim = B.x;
  float t = uTime * B.z + B.y * 6.2831;
  float ph = B.y;
  // Joint angles
  float legLx = 0.0, legRx = 0.0, legLz = 0.0, legRz = 0.0;
  float armLx = 0.0, armRx = 0.0, armLs = 0.12, armRs = 0.12; // s = outward spread
  float torX = 0.0, torY = 0.0, torZ = 0.0;
  float hdX = 0.0, hdY = 0.0, hdZ = 0.0;
  float bob = 0.0, squash = 1.0, roll = 0.0, spin = 0.0;
  float look = sin(t * 0.31 + ph * 11.0) * 0.35 * smoothstep(0.2, 0.8, abs(sin(t * 0.17 + ph * 3.0)));
  float br = sin(t * 2.0);
  if (anim < 0.5) { // idle
    squash = 1.0 + br * 0.018; torZ = sin(t * 0.5) * 0.04; hdY = look; hdX = sin(t * 0.8) * 0.03; armLs = 0.12 + br * 0.03; armRs = 0.12 + br * 0.03;
  } else if (anim < 1.5) { // cheer: hop with both arms up, waving
    float h = abs(sin(t * 4.0));
    bob = h * 0.11; squash = 1.0 + (h - 0.6) * 0.08;
    armLs = 2.55 + sin(t * 8.0) * 0.22; armRs = 2.55 + sin(t * 8.0 + 1.6) * 0.22; armLx = -0.25; armRx = -0.25;
    hdX = -0.18; hdZ = sin(t * 4.0) * 0.08; torZ = sin(t * 4.0) * 0.05;
  } else if (anim < 2.5) { // clap
    float c = sin(t * 9.0);
    armLx = -1.15; armRx = -1.15; armLs = -0.28 - c * 0.14; armRs = -0.28 - c * 0.14;
    bob = abs(sin(t * 4.5)) * 0.025; hdX = sin(t * 4.5) * 0.06 - 0.05; hdY = look * 0.5; torZ = sin(t * 2.25) * 0.04;
  } else if (anim < 3.5) { // dance: step-hop, swinging arms, twirling torso
    float s = sin(t * 3.0);
    bob = abs(s) * 0.09; squash = 1.0 + (abs(s) - 0.5) * 0.06;
    legLx = -crPos(s) * 0.55; legRx = -crPos(-s) * 0.55;
    armLs = 1.1 + s * 0.9; armRs = 1.1 - s * 0.9; armLx = -0.3; armRx = -0.3;
    torY = s * 0.28; torZ = cos(t * 3.0) * 0.08; hdZ = -s * 0.12; hdX = -0.08;
    spin = sin(t * 1.5) * 0.35;
  } else if (anim < 4.5) { // skate: lean, alternating side pushes, arms swinging
    float s = sin(t * 1.7);
    torX = 0.32; hdX = -0.25;
    legLz = -crPos(s) * 0.42; legRz = crPos(-s) * 0.42; legLx = crPos(s) * 0.35; legRx = crPos(-s) * 0.35;
    armLx = s * 0.7; armRx = -s * 0.7; armLs = 0.45; armRs = 0.45;
    roll = s * 0.1; bob = -0.03 - abs(s) * 0.02;
  } else if (anim < 5.5) { // walk
    float s = sin(t * 4.2);
    legLx = s * 0.6; legRx = -s * 0.6; armLx = -s * 0.5; armRx = s * 0.5;
    bob = abs(cos(t * 4.2)) * 0.05; torY = s * 0.07;
  } else if (anim < 6.5) { // wave
    armRs = 2.35 + sin(t * 7.0) * 0.32; armRx = -0.2; armLs = 0.12 + br * 0.03;
    hdZ = 0.1; hdX = -0.06; torZ = -0.05 + sin(t * 3.5) * 0.02; bob = abs(sin(t * 3.5)) * 0.015;
  } else if (anim < 7.5) { // sit (on the ground / a bench / a float)
    legLx = -1.45; legRx = -1.4; legLz = 0.12; legRz = -0.12; bob = -0.3;
    armLx = -0.75; armRx = -0.75; armLs = -0.1; armRs = -0.1; torX = -0.08;
    hdY = look; squash = 1.0 + br * 0.015; hdX = sin(t * 0.7) * 0.04;
  } else if (anim < 8.5) { // lantern: both hands holding a lantern up, gentle sway
    armLx = -2.35 + sin(t * 1.2) * 0.08; armRx = -2.35 + sin(t * 1.2) * 0.08; armLs = -0.32; armRs = -0.32;
    hdX = -0.38; torX = -0.1; torZ = sin(t * 0.9) * 0.05; squash = 1.0 + br * 0.015;
  } else if (anim < 9.5) { // talk
    hdX = sin(t * 6.0) * 0.06; hdZ = sin(t * 2.3) * 0.05; armRx = -0.9 + sin(t * 3.1) * 0.25; armRs = -0.2;
    armLs = 0.14 + br * 0.03; torZ = sin(t * 0.5) * 0.03;
  } else if (anim < 10.5) { // judge: hand to chin, clipboard, pondering tilt
    armRx = -1.95; armRs = -0.62; armLx = -1.0; armLs = -0.15;
    hdZ = 0.14 + sin(t * 0.6) * 0.05; hdX = 0.05 + sin(t * 1.3) * 0.04; hdY = sin(t * 0.4) * 0.3; torZ = -0.04;
  } else if (anim < 11.5) { // sack race hop
    float h = crPos(sin(t * 5.2));
    bob = pow(h, 0.7) * 0.32; squash = 1.0 + (0.25 - h) * 0.22;
    armLx = -0.35; armRx = -0.35; armLs = -0.3; armRs = -0.3; torX = 0.12 - h * 0.2; hdX = -0.1;
  } else if (anim < 12.5) { // fiddle
    armLx = -1.55; armLs = 0.2; armRx = -1.25; armRs = 0.35 + sin(t * 5.0) * 0.35;
    hdZ = 0.35; hdY = 0.25; torZ = sin(t * 2.5) * 0.07; bob = abs(sin(t * 2.5)) * 0.02;
  } else if (anim < 13.5) { // carol: holding a song book, swaying
    armLx = -1.0; armRx = -1.0; armLs = -0.3; armRs = -0.3;
    torZ = sin(t * 1.3) * 0.09; hdZ = sin(t * 1.3) * 0.1; hdX = -0.12 + sin(t * 2.6) * 0.04; squash = 1.0 + br * 0.02;
  } else if (anim < 14.5) { // sway (music)
    torZ = sin(t * 1.8) * 0.1; hdZ = sin(t * 1.8 + 0.4) * 0.1; hdY = look * 0.6; armLs = 0.2 + sin(t * 1.8) * 0.08; armRs = 0.2 - sin(t * 1.8) * 0.08;
    bob = abs(sin(t * 1.8)) * 0.02;
  } else { // toast: mug raised
    armRx = -1.6 + sin(t * 1.3) * 0.2; armRs = -0.1; armLs = 0.14 + br * 0.03; hdX = -0.08; hdY = look * 0.5; torZ = sin(t * 0.7) * 0.04;
  }
  vec3 q = p;
  vec3 m = n;
  int bone = int(aBone + 0.5);
  if (bone == 7) { // eyes: blink, then follow the head
    float bl = step(0.965, fract(t * 0.27 + ph * 7.1));
    q.y = aPivot.y + (q.y - aPivot.y) * mix(1.0, 0.15, bl);
  }
  if (bone == 5 || bone == 6) {
    mat3 Rl = bone == 5 ? crZ(legLz) * crX(legLx) : crZ(legRz) * crX(legRx);
    q = aPivot + Rl * (q - aPivot); m = Rl * m;
  }
  if (bone == 3 || bone == 4) {
    mat3 Ra = bone == 3 ? crX(armLx) * crZ(-armLs) : crX(armRx) * crZ(armRs);
    q = aPivot + Ra * (q - aPivot); m = Ra * m;
  }
  if (bone == 2 || bone == 7) {
    mat3 Rh = crY(hdY) * crX(hdX) * crZ(hdZ);
    q = vec3(0.0, 0.96, 0.0) + Rh * (q - vec3(0.0, 0.96, 0.0)); m = Rh * m;
  }
  if (bone >= 1 && bone <= 4 || bone == 7) {
    mat3 Rt = crY(torY) * crX(torX) * crZ(torZ);
    q = vec3(0.0, 0.5, 0.0) + Rt * (q - vec3(0.0, 0.5, 0.0)); m = Rt * m;
  }
  // Whole body: squash, roll, bob, yaw, scale, translate.
  q.y *= squash; q.xz /= sqrt(squash);
  mat3 Rr = crZ(roll);
  q = Rr * q; m = Rr * m;
  q.y += bob;
  mat3 Ry = crY(A.w + spin);
  q = Ry * q; m = Ry * m;
  p = A.xyz + q * B.w;
  n = normalize(m);
  vCrowdGlow = aGlow;
}
`;

function patchCrowd(m: THREE.Material, tex: { value: THREE.Texture | null }, depth: boolean): void {
  patchMaterial(m, depth ? 'crowd-depth' : 'crowd', (shader) => {
    shader.uniforms.uCrowd = tex;
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uLamps = globalUniforms.uLamps;
    let vs = shader.vertexShader;
    if (!vs.includes('uniform float uTime;')) vs = before(vs, 'void main() {', 'uniform float uTime;');
    vs = before(vs, 'void main() {', CROWD_GLSL);
    if (depth) {
      vs = after(vs, '#include <begin_vertex>', 'vec3 crN = vec3(0.0, 1.0, 0.0); crowdPose(transformed, crN);');
    } else {
      vs = after(vs, '#include <beginnormal_vertex>', 'vec3 crP = position; crowdPose(crP, objectNormal);');
      vs = after(vs, '#include <begin_vertex>', 'transformed = crP;');
    }
    shader.vertexShader = vs;
    if (!depth) {
      let fs = shader.fragmentShader;
      fs = before(fs, 'void main() {', 'varying float vCrowdGlow;\nuniform float uLamps;');
      fs = after(fs, '#include <emissivemap_fragment>', 'totalEmissiveRadiance += diffuseColor.rgb * diffuseColor.rgb * vCrowdGlow * (0.6 + uLamps * 3.2);');
      shader.fragmentShader = fs;
    }
  });
}

export interface CrowdMember {
  spec: CrowdSpec;
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: number;
  phase: number;
  speed: number;
  scale: number;
}

/**
 * One draw call crowd. `members[i]` can be moved / re-animated at runtime; call `commit()` after.
 */
export class Crowd {
  readonly mesh: THREE.Mesh;
  readonly members: CrowdMember[] = [];
  private data: Float32Array;
  private tex: THREE.DataTexture;
  private texU: { value: THREE.Texture | null };

  constructor(specs: CrowdSpec[], private heightAt: (x: number, z: number) => number, name = 'crowd') {
    const W = Math.max(1, specs.length);
    this.data = new Float32Array(W * 2 * 4);
    this.tex = new THREE.DataTexture(this.data, W, 2, THREE.RGBAFormat, THREE.FloatType);
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    this.texU = { value: this.tex };
    const geos: THREE.BufferGeometry[] = [];
    specs.forEach((s, i) => {
      const g = buildMember(s, `${name}:${s.id ?? i}`);
      const n = g.attributes.position!.count;
      g.setAttribute('aMember', new THREE.BufferAttribute(new Float32Array(n).fill(i), 1));
      geos.push(g);
      const scale = 1.22 * s.look.scale;
      this.members.push({ spec: s, x: s.x, y: heightAt(s.x, s.z) + (s.lift ?? 0), z: s.z, yaw: s.yaw, anim: Anim[s.anim], phase: s.phase ?? (i * 0.137) % 1, speed: s.speed ?? 1, scale });
    });
    const geo = specs.length ? mergeGeometries(geos)! : new THREE.BufferGeometry();
    for (const g of geos) g.dispose();
    // Per-crowd material (its data-texture uniform is per crowd; the GL program is shared).
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74 });
    m.name = 'crowd';
    applyWorldFx(m, { snow: false, clouds: true, wet: true });
    patchCrowd(m, this.texU, false);
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    patchCrowd(dm, this.texU, true);
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.name = name;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.customDepthMaterial = dm;
    this.mesh.userData.noAO = true;
    this.mesh.userData.perfTag = 'crowd';
    this.commit();
  }

  /** Re-seat a member on the ground (after moving x/z) and upload. */
  place(i: number, x: number, z: number, yaw?: number, lift = this.members[i]!.spec.lift ?? 0): void {
    const m = this.members[i]!;
    m.x = x;
    m.z = z;
    m.y = this.heightAt(x, z) + lift;
    if (yaw !== undefined) m.yaw = yaw;
  }

  setAnim(i: number, anim: AnimName, speed?: number): void {
    const m = this.members[i]!;
    m.anim = Anim[anim];
    if (speed !== undefined) m.speed = speed;
  }

  commit(): void {
    const W = this.tex.image.width;
    this.members.forEach((m, i) => {
      this.data.set([m.x, m.y, m.z, m.yaw], i * 4);
      this.data.set([m.anim, m.phase, m.speed, m.scale], (W + i) * 4);
    });
    this.tex.needsUpdate = true;
  }

  indexOf(id: string): number {
    return this.members.findIndex((m) => m.spec.id === id);
  }
}

// ───────────────────────────────────────────── townsfolk generator

const SKINS = [0xf2c8a2, 0xe8b894, 0xf0c4a0, 0xc88a64, 0x9a6444, 0xf6d2b4, 0xb87a56, 0x7a4a32];
const HAIRS = [0x3a2418, 0x6a4228, 0x8a6a58, 0xd8b068, 0x2a1a14, 0xb8542a, 0xd8d4cc, 0x4a3a30, 0xe8c890];
const STYLES: NpcLook['hairStyle'][] = ['short', 'bob', 'bun', 'short', 'bob', 'cap'];

/** A seeded random villager look (townsfolk filling out the crowd). */
export function randomLook(rng: Rng, opts: { child?: boolean; palette: number[] }): NpcLook {
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rng.next() * a.length)]!;
  const child = !!opts.child;
  const style = pick(STYLES);
  return {
    skin: pick(SKINS),
    hair: pick(HAIRS),
    hairStyle: style,
    top: pick(opts.palette),
    bottom: pick([0x4a5a78, 0x5a4a6a, 0x6a5a48, 0x3e4a5a, 0x7a6a5a, 0x5a6a4a]),
    glasses: !child && rng.next() < 0.15,
    beard: !child && style === 'short' && rng.next() < 0.3,
    scale: child ? 0.74 + rng.next() * 0.06 : 0.92 + rng.next() * 0.1,
    build: child ? 0.95 : 0.95 + rng.next() * 0.2,
  };
}
