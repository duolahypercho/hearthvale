/**
 * Festival crowd: every festival-goer (named villagers + townsfolk) merged into ONE mesh and
 * posed on the GPU. Each vertex carries its bone (legs, torso, head, arms, eyes, skirt), the bone's
 * pivot and its member index; a small float DataTexture holds per-member position / yaw / animation
 * / phase / speed / scale (+ a juice row: squash, lean, hem flare). The vertex shader evaluates the
 * animation (idle, cheer, clap, dance, ribbon dance, skate, sit, lantern-raise, sack hop, fiddle,
 * carol…) and applies the rig hierarchy.
 *
 * Budget: ~1.4k triangles a head (low-segment capsules, box details, one hair shell per style), so
 * 60 animated villagers cost ~85k triangles for 1 main + 1 shadow draw call.
 * Named villagers keep their signature silhouettes (hats, coats, vests, bow ties, hair styles,
 * skirts, shoes, canes) so the town reads as the same people you meet every day.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { NpcLook } from '../../data/npcs';
import { prep, mat, lumpySphere, sphericalNormals, roundedBox } from '../geom';
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
  /** Maypole: right hand raised holding a ribbon, skip-steps. */
  ribbonR: 16,
  /** Maypole: left hand raised holding a ribbon, skip-steps. */
  ribbonL: 17,
  /** Seated on a bench / log (hips at the seat, feet on the ground). */
  perch: 18,
  /** A child riding on a grown-up's shoulders: legs either side of the neck, arms up waving. */
  ride: 19,
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
  /** Townsfolk hat colour (only ~40 % wear a hat; see `headwear`). */
  hatTint?: number;
  /** Never moved by the crowd separation pass (e.g. a grown-up carrying a child on the shoulders). */
  pinned?: boolean;
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
  /** Skirt / coat hem: root-bound, swings with the legs and flares on hops. */
  Skirt = 8,
}

const WAIST = new THREE.Vector3(0, 0.5, 0);
const NECK = new THREE.Vector3(0, 0.96, 0);
const HEAD_S = 1.15;
const R = 0.32;
/** Shoulder offset (× build) and hand drop from the shoulder pivot. */
const SHOULDER_X = 0.25;
const HAND_Y = -0.31;

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

function shade(c: number, k: number): number {
  return new THREE.Color(c).multiplyScalar(k).getHex();
}
/** 12-triangle box for tiny details (buttons, scarf tails, straps). */
function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}
function ball(r: number, w = 6, h = 4): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, w, h);
}
function lump(r: number, rng: Rng, detail = 0, amp = 0.14): THREE.BufferGeometry {
  const g = lumpySphere(r, detail, amp, rng, 2);
  sphericalNormals(g, new THREE.Vector3(), 0.75);
  return g;
}

const SKIRTED = new Set(['bun']);

/** Build one festival-goer (rig space: feet at origin, facing +Z). */
function buildMember(spec: CrowdSpec, seed: string): THREE.BufferGeometry {
  const L = spec.look;
  const rng = new Rng(seed);
  const b = new RigBuilder();
  const bw = L.build;
  const props = new Set(spec.props ?? []);
  const o = spec.outfit;
  const named = !!spec.id;
  const top = spec.top ?? L.top;
  const bottom = spec.bottom ?? L.bottom;
  const accent = spec.accent ?? 0xf5c542;
  const winter = o === 'winter';
  const skates = props.has('skates');
  const hand = winter ? shade(accent, 0.9) : L.skin;
  const hs = HEAD_S * (L.head ?? 1);
  const headM = (local?: THREE.Matrix4): THREE.Matrix4 => {
    const m = new THREE.Matrix4().makeTranslation(NECK.x, NECK.y, NECK.z).multiply(new THREE.Matrix4().makeScale(hs, hs, hs));
    return local ? m.multiply(local) : m;
  };
  const shoe = L.shoes ?? (winter ? 0x6a4a36 : o === 'summer' ? 0xc89a6a : 0x5a3a24);
  // Townsfolk headwear roll: ~40 % a seasonal hat, ~25 % a small accessory (headband / earmuffs /
  // hair bow), the rest bare hair — so the crowd shows its hair styles and colours.
  const hw = named ? -1 : new Rng(`${seed}:hw`).next();
  const hatOn = named || hw < 0.4;
  const accOn = !named && hw >= 0.4 && hw < 0.65;
  const hatTint = spec.hatTint ?? accent;
  const skirt = L.skirt || o === 'summer' || (o === 'spring' && !named && L.hairStyle !== 'short' && L.hairStyle !== 'cap') || SKIRTED.has(L.hairStyle);

  // ── legs (a single capsule + a rounded shoe — legs and feet read below every hem)
  for (const [bone, sx] of [[Bone.LegL, -1], [Bone.LegR, 1]] as const) {
    const pv = new THREE.Vector3(sx * 0.11 * bw, 0.5, 0);
    const T = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1, sy = s, sz = s) => new THREE.Matrix4().makeTranslation(pv.x, pv.y, pv.z).multiply(mat(x, y, z, rx, ry, rz, s, sy, sz));
    const legC = winter ? shade(bottom, 0.9) : skirt ? (o === 'summer' ? shade(L.skin, 0.95) : 0xf4ece0) : bottom;
    b.add(bone, pv, new THREE.CapsuleGeometry(0.085, 0.26, 1, 6), T(0, -0.2, 0), legC);
    const sh = ball(0.105, 7, 4);
    sh.scale(1, winter ? 0.75 : 0.62, 1.45);
    b.add(bone, pv, sh, T(0, winter ? -0.42 : -0.44, 0.045), shoe);
    if (winter) b.add(bone, pv, new THREE.TorusGeometry(0.095, 0.028, 3, 8), T(0, -0.35, 0.01, Math.PI / 2), 0xf4efe6);
    if (skates) {
      b.add(bone, pv, box(0.025, 0.06, 0.36), T(0, -0.53, 0.05), 0xdfe6ee);
      b.add(bone, pv, box(0.03, 0.025, 0.08), T(0, -0.5, 0.2, 0.6), 0xdfe6ee);
    }
  }

  // ── torso (waist pivot)
  const P = WAIST;
  const TT = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().makeTranslation(P.x, P.y, P.z).multiply(mat(x, y, z, rx, ry, rz, sx, sy, sz));
  const puff = winter ? 1.12 : 1;
  const coat = !winter && L.coat !== undefined && named;
  const torsoC = coat ? L.coat! : top;
  b.add(Bone.Torso, P, new THREE.CapsuleGeometry(0.2, 0.18, 2, 8), TT(0, 0.18, 0, 0, 0, 0, 1.05 * bw * puff, 1, 0.92 * bw * puff), torsoC);
  b.add(Bone.Torso, P, new THREE.CylinderGeometry(0.215 * bw * puff, 0.205 * bw * puff, 0.16, 10, 1, true), TT(0, 0.0, 0), winter || coat ? torsoC : bottom);
  if (coat) {
    // Open coat: shirt showing down the front, lapels.
    b.add(Bone.Torso, P, box(0.13, 0.3, 0.02), TT(0, 0.2, 0.2 * bw), top);
    for (const s of [-1, 1]) b.add(Bone.Torso, P, box(0.05, 0.2, 0.02), TT(s * 0.07, 0.28, 0.205 * bw, 0, 0, s * 0.3), shade(L.coat!, 0.85));
  } else if (L.vest !== undefined && named && !winter) {
    for (const s of [-1, 1]) b.add(Bone.Torso, P, box(0.11, 0.3, 0.03), TT(s * 0.085, 0.17, 0.195 * bw), L.vest);
  }
  if (L.bowtie !== undefined && named) for (const s of [-1, 1]) b.add(Bone.Torso, P, new THREE.ConeGeometry(0.035, 0.07, 4), TT(s * 0.035, 0.38, 0.19, 0, 0, s * Math.PI / 2), L.bowtie);
  if (winter) {
    // Puffy coat: quilted band + toggles, fleece collar.
    b.add(Bone.Torso, P, new THREE.TorusGeometry(0.226 * bw, 0.02, 3, 12), TT(0, 0.16, 0, Math.PI / 2, 0, 0, 1, 0.92, 1), shade(top, 0.86));
    b.add(Bone.Torso, P, new THREE.TorusGeometry(0.14, 0.05, 4, 10), TT(0, 0.37, 0, Math.PI / 2), 0xf4efe6);
    for (let i = 0; i < 3; i++) b.add(Bone.Torso, P, box(0.05, 0.02, 0.02), TT(0, 0.3 - i * 0.1, 0.235 * bw), 0xf0e0c0);
  } else if (!coat) {
    for (let i = 0; i < 2; i++) b.add(Bone.Torso, P, new THREE.IcosahedronGeometry(0.018, 0), TT(0, 0.32 - i * 0.1, 0.2 * bw), 0xf0e0c0);
  }
  // Outfit layers on the torso / root.
  if (o === 'spring') {
    // Pastel sash + a flower garland necklace.
    b.add(Bone.Torso, P, new THREE.TorusGeometry(0.215 * bw, 0.026, 3, 12), TT(0, 0.2, 0, Math.PI / 2 - 0.5, 0, 0.25), accent);
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * 0.15 + (i / 5) * Math.PI * 0.7;
      b.add(Bone.Torso, P, new THREE.IcosahedronGeometry(0.038, 0), TT(Math.cos(a) * 0.17, 0.33 - Math.sin(a) * 0.05, Math.sin(a) * 0.16), [0xff8fab, 0xffffff, 0xffd166][i % 3]!);
    }
  } else if (o === 'summer') {
    // Wrap robe: crossed collar + a wide obi-style sash with a bow at the back.
    b.add(Bone.Torso, P, box(0.07, 0.34, 0.02), TT(0.04, 0.2, 0.19 * bw, 0, 0, -0.45), shade(top, 1.25));
    b.add(Bone.Torso, P, new THREE.CylinderGeometry(0.225 * bw, 0.225 * bw, 0.1, 12, 1, true), TT(0, 0.06, 0), accent);
    b.add(Bone.Torso, P, roundedBox(0.22, 0.12, 0.06, 0.03, 1), TT(0, 0.07, -0.22 * bw), accent);
  } else if (o === 'fall') {
    // Knit cardigan front panels + a scarf.
    if (!coat) for (const sx of [-1, 1]) b.add(Bone.Torso, P, box(0.1, 0.36, 0.03), TT(sx * 0.08, 0.17, 0.195 * bw), shade(top, 0.75));
    b.add(Bone.Torso, P, new THREE.TorusGeometry(0.13, 0.045, 4, 10), TT(0, 0.38, 0, Math.PI / 2 - 0.2), accent);
    b.add(Bone.Torso, P, box(0.09, 0.24, 0.04), TT(0.07, 0.24, 0.18, 0.15, 0, 0.15), accent);
  }
  const scarf = winter ? (spec.accent ?? 0xd8473a) : named && L.scarf !== undefined && o !== 'fall' ? L.scarf : undefined;
  if (scarf !== undefined) {
    b.add(Bone.Torso, P, new THREE.TorusGeometry(0.14, 0.055, 4, 10), TT(0, 0.4, 0, Math.PI / 2 - 0.18), scarf);
    b.add(Bone.Torso, P, box(0.1, 0.3, 0.045), TT(-0.08, 0.2, 0.2, 0.1, 0, -0.12), scarf);
    b.add(Bone.Torso, P, box(0.1, 0.2, 0.045), TT(0.12, 0.34, -0.19, -0.3, 0, 0.3), scarf);
    if (winter) b.add(Bone.Torso, P, box(0.105, 0.02, 0.05), TT(-0.08, 0.12, 0.21), 0xf4efe6);
  }
  if ((L.acc?.includes('satchel') && named) || (!named && hw > 0.8 && !winter)) {
    b.add(Bone.Torso, P, box(0.04, 0.5, 0.03), TT(0, 0.2, 0.2 * bw, 0, 0, 0.75), 0x7a5234);
    // (townsfolk: the bag itself on the hip)
    if (!named) b.add(Bone.Torso, P, roundedBox(0.16, 0.14, 0.07, 0.02, 1), TT(0.2 * bw, -0.02, 0.1), shade(bottom, 0.8));
  }
  // Skirt / robe / coat tails (skirt bone: swings with the legs, flares on hops). Short enough that
  // legs and shoes always show underneath.
  if (skirt || winter || coat) {
    const len = coat ? 0.3 : o === 'summer' ? 0.25 : winter ? 0.18 : 0.21;
    const flare = coat ? 0.02 : winter ? 0.02 : 0.045;
    const c = coat ? L.coat! : winter ? top : o === 'summer' ? top : bottom;
    const g = new THREE.CylinderGeometry(0.212 * bw * puff, (0.235 + flare) * bw * puff, len, 12, 2, true);
    if (coat) {
      // Coat tails open at the front.
      const cg = new THREE.CylinderGeometry(0.22 * bw, 0.25 * bw, len, 12, 2, true, Math.PI * 0.62, Math.PI * 1.76);
      b.add(Bone.Skirt, WAIST, cg, mat(0, 0.5 - len / 2 - 0.02, 0), c);
      g.dispose();
    } else {
      b.add(Bone.Skirt, WAIST, g, mat(0, 0.5 - len / 2 - 0.04, 0), c);
      const trim = o === 'spring' ? 0xffffff : winter ? 0xf4efe6 : o === 'summer' ? shade(accent, 1) : 0;
      if (trim) b.add(Bone.Skirt, WAIST, new THREE.TorusGeometry((0.235 + flare) * bw * puff, 0.016, 3, 14), mat(0, 0.5 - len - 0.04, 0, Math.PI / 2), trim);
    }
  }
  if (props.has('sack')) {
    // Burlap sack pulled up to the waist, gathered at the top.
    const sack = new THREE.CylinderGeometry(0.29 * bw, 0.26 * bw, 0.62, 10, 2, true);
    const sp = sack.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) sp.setX(i, sp.getX(i) * (1 + (rng.next() - 0.5) * 0.08));
    b.add(Bone.Root, WAIST, sack, mat(0, 0.3, 0), 0xc8a46a);
    b.add(Bone.Root, WAIST, new THREE.CircleGeometry(0.26 * bw, 10), mat(0, 0.0, 0, -Math.PI / 2), 0xb08a52);
    b.add(Bone.Root, WAIST, new THREE.TorusGeometry(0.29 * bw, 0.03, 3, 12), mat(0, 0.6, 0, Math.PI / 2), 0xa88450);
    b.add(Bone.Root, WAIST, box(0.2, 0.12, 0.01), mat(0, 0.34, 0.29 * bw), 0x8a3a2a);
  }
  if (props.has('rosette')) {
    b.add(Bone.Torso, P, new THREE.CylinderGeometry(0.06, 0.06, 0.015, 8), TT(-0.1, 0.3, 0.2, Math.PI / 2), 0x3f6fd0);
    b.add(Bone.Torso, P, new THREE.CylinderGeometry(0.03, 0.03, 0.02, 6), TT(-0.1, 0.3, 0.21, Math.PI / 2), 0xf5c542);
    for (const sx of [-1, 1]) b.add(Bone.Torso, P, box(0.03, 0.1, 0.008), TT(-0.1 + sx * 0.02, 0.22, 0.205, 0, 0, sx * 0.25), 0x3f6fd0);
  }

  // ── arms (one capsule sleeve + a hand)
  for (const [bone, sx] of [[Bone.ArmL, -1], [Bone.ArmR, 1]] as const) {
    const pv = new THREE.Vector3(sx * SHOULDER_X * bw, 0.82, 0);
    const T = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1, sy = s, sz = s) => new THREE.Matrix4().makeTranslation(pv.x, pv.y, pv.z).multiply(mat(x, y, z, rx, ry, rz, s, sy, sz));
    const sleeve = coat ? L.coat! : top;
    b.add(bone, pv, new THREE.CapsuleGeometry(0.066 * puff, 0.2, 1, 6), T(0, -0.14, 0), sleeve);
    if (o === 'summer') b.add(bone, pv, new THREE.CylinderGeometry(0.075, 0.1, 0.16, 8, 1, true), T(0, -0.2, 0), shade(top, 0.95));
    if (winter) b.add(bone, pv, new THREE.TorusGeometry(0.06, 0.022, 3, 8), T(0, -0.26, 0, Math.PI / 2), 0xf4efe6);
    b.add(bone, pv, ball(winter ? 0.076 : 0.068, 6, 4), T(0, HAND_Y, 0), hand);
    const H = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1, sy = s, sz = s) => T(0, HAND_Y, 0).multiply(mat(x, y, z, rx, ry, rz, s, sy, sz));
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
        b.add(bone, pv, new THREE.CylinderGeometry(0.012, 0.012, 0.7, 4), H(0, -0.05, 0.3, Math.PI / 2 - 0.5), 0xb89a5a);
        b.add(bone, pv, box(0.006, 0.12, 0.006), H(0, -0.16, 0.6), 0x3a2a1e);
        const lan = lumpySphere(0.09, 1, 0.02, rng, 2);
        lan.scale(1, 1.25, 1);
        b.add(bone, pv, lan, H(0, -0.3, 0.6), spec.accent ?? 0xffb050, 1);
      }
      if (props.has('mug')) {
        b.add(bone, pv, new THREE.CylinderGeometry(0.055, 0.05, 0.11, 8), H(0, -0.02, 0.07), 0xd8573e);
        b.add(bone, pv, new THREE.CircleGeometry(0.047, 8).rotateX(-Math.PI / 2), H(0, 0.04, 0.07), 0x5a3020);
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
        b.add(bone, pv, new THREE.ConeGeometry(0.06, 0.16, 6), H(0, 0.03, 0.06, Math.PI), 0xf6ecd8);
        for (let i = 0; i < 5; i++) b.add(bone, pv, new THREE.IcosahedronGeometry(0.037, 0), H((i % 3) * 0.03 - 0.03, 0.14, 0.06 + (i % 2) * 0.03), [0xff8fab, 0xffd166, 0xffffff, 0xc77dff, 0xff6a6a][i]!);
      }
      if (props.has('songbook')) b.add(bone, pv, box(0.2, 0.02, 0.15), H(-0.08, 0.02, 0.07, -0.4), 0x8a2a2a);
      if (props.has('pie')) {
        b.add(bone, pv, new THREE.CylinderGeometry(0.15, 0.12, 0.05, 10), H(-0.12, 0.05, 0.1), 0xd89048);
        b.add(bone, pv, new THREE.CylinderGeometry(0.13, 0.13, 0.012, 10), H(-0.12, 0.08, 0.1), 0x8a2a3a);
      }
      if (props.has('gift')) {
        b.add(bone, pv, box(0.24, 0.2, 0.2), H(-0.22 * bw, 0.02, 0.08), spec.accent ?? 0x3f8f6a);
        b.add(bone, pv, box(0.25, 0.21, 0.04), H(-0.22 * bw, 0.02, 0.08), 0xf5c542);
        b.add(bone, pv, new THREE.TorusGeometry(0.04, 0.015, 3, 8), H(-0.22 * bw, 0.14, 0.08, 0, 0, Math.PI / 2), 0xf5c542);
      }
      if (props.has('balloon')) {
        b.add(bone, pv, box(0.006, 0.9, 0.006), H(0, 0.45, 0), 0xf4f0e8);
        const bl = new THREE.SphereGeometry(0.16, 8, 6);
        bl.scale(1, 1.2, 1);
        b.add(bone, pv, bl, H(0, 1.0, 0), spec.accent ?? 0xe8574a);
      }
      if (props.has('fiddle')) b.add(bone, pv, box(0.012, 0.012, 0.55), H(0, 0, 0.2, 0.2, 0.9, 0), 0x6a3a1e);
      if (props.has('flute')) b.add(bone, pv, new THREE.CylinderGeometry(0.014, 0.014, 0.36, 5), H(-0.12, 0.02, 0.06, 0, 0, Math.PI / 2 - 0.2), 0xd8b060);
    } else {
      if (props.has('clipboard')) {
        b.add(bone, pv, box(0.2, 0.26, 0.02), H(0.06, 0.02, 0.1, -0.7), 0x9a6a44);
        b.add(bone, pv, box(0.17, 0.2, 0.01), H(0.06, 0.02, 0.114, -0.7), 0xf6f0e0);
      }
      if (props.has('fiddle')) {
        const body = new THREE.SphereGeometry(0.1, 7, 5);
        body.scale(0.75, 1.2, 0.3);
        b.add(bone, pv, body, H(0.1, 0.02, 0.12, 0.3, 0, 1.0), 0xa0522d);
        b.add(bone, pv, box(0.03, 0.26, 0.02), H(0.02, 0.12, 0.1, 0.3, 0, 1.0), 0x3a2010);
      }
      if (L.acc?.includes('cane') && named && !props.size) b.add(bone, pv, new THREE.CylinderGeometry(0.018, 0.018, 0.62, 5), H(0.02, -0.26, 0.08, 0.15), 0x6a4428);
    }
  }

  // ── head
  const HP = NECK;
  const hm = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => headM(mat(x, y, z, rx, ry, rz, sx, sy, sz));
  const face = L.face ?? 'round';
  const fy = face === 'long' ? 1.06 : face === 'square' ? 0.96 : 0.96;
  const fx = face === 'square' ? 1.08 : face === 'long' ? 0.98 : 1.04;
  b.add(Bone.Head, HP, new THREE.SphereGeometry(R, 12, 8), hm(0, R * 0.92, 0, 0, 0, 0, fx, fy, 1), L.skin);
  for (const sx of [-1, 1]) b.add(Bone.Head, HP, ball(0.07, 5, 4), hm(sx * R * 0.98 * fx, R * 0.88, 0, 0, 0, 0, 0.6, 1, 1), L.skin);
  b.add(Bone.Head, HP, ball(0.032, 5, 4), hm(0, R * 0.78, R * 0.99), shade(L.skin, 1.05));
  // Faces differ person to person: brow tilt / weight, cheek size, mouth (open laugh, closed
  // smile, little 'o' of a song, lopsided grin), freckles on some.
  const fr = new Rng(`${seed}:face`);
  const browTilt = (fr.next() - 0.35) * 0.5;
  const browW = 0.065 + fr.next() * 0.025;
  const cheek = 0.04 + fr.next() * 0.02;
  const mouth = named ? 0 : Math.floor(fr.next() * 4);
  for (const sx of [-1, 1]) {
    b.add(Bone.Head, HP, box(browW, 0.018 + (mouth === 3 ? 0.006 : 0), 0.02), hm(sx * 0.115, R * 1.2, R * 0.93, 0, 0, sx * (0.14 + browTilt)), shade(L.hair, 0.8));
    b.add(Bone.Head, HP, new THREE.CircleGeometry(cheek, 8), hm(sx * 0.19, R * 0.74, R * 0.875, 0, sx * 0.55, 0), winter ? 0xf08a80 : 0xf29a86);
  }
  if (mouth === 1) {
    // Closed, content smile.
    b.add(Bone.Head, HP, new THREE.TorusGeometry(0.04, 0.011, 3, 8, Math.PI), hm(0, R * 0.7, R * 0.98, -0.2, 0, Math.PI), 0x5a2420);
  } else if (mouth === 2) {
    // A little round 'o' (singing / gasping at the fireworks).
    b.add(Bone.Head, HP, new THREE.CircleGeometry(0.026, 8), hm(0, R * 0.66, R * 0.985, -0.2), 0x6a2a24);
  } else if (mouth === 3) {
    // Lopsided grin.
    b.add(Bone.Head, HP, new THREE.CircleGeometry(0.046, 8, Math.PI * 1.05, Math.PI * 0.8), hm(0.012, R * 0.67, R * 0.975, -0.2, 0, 0.15), 0x6a2a24);
  } else {
    // Open happy smile.
    b.add(Bone.Head, HP, new THREE.CircleGeometry(0.042, 8, Math.PI, Math.PI), hm(0, R * 0.66, R * 0.975, -0.2), 0x6a2a24);
    b.add(Bone.Head, HP, new THREE.CircleGeometry(0.03, 6, Math.PI * 1.15, Math.PI * 0.7), hm(0, R * 0.635, R * 0.985, -0.2), 0xe87a7a);
  }
  if (!named && fr.next() < 0.22) for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) b.add(Bone.Head, HP, new THREE.CircleGeometry(0.009, 5), hm(sx * (0.15 + k * 0.03), R * (0.8 + (k % 2) * 0.05), R * 0.93, 0, sx * 0.4, 0), shade(L.skin, 0.72));
  if (L.glasses) {
    for (const sx of [-1, 1]) b.add(Bone.Head, HP, new THREE.TorusGeometry(0.068, 0.011, 3, 12), hm(sx * 0.115, R * 0.97, R * 1.0), 0x6a4a2a);
    b.add(Bone.Head, HP, box(0.07, 0.014, 0.014), hm(0, R * 1.0, R * 1.02), 0x6a4a2a);
  }
  if (L.beard) {
    if (L.beard !== 'mustache' && L.beard !== 'stubble') {
      const beard = lumpySphere(0.2, 1, 0.18, rng, 2);
      beard.scale(1.35, 0.9, 0.7);
      b.add(Bone.Head, HP, beard, hm(0, R * 0.5, R * 0.62), L.hair);
    }
    const st = new THREE.CapsuleGeometry(0.035, 0.12, 1, 5);
    st.rotateZ(Math.PI / 2);
    b.add(Bone.Head, HP, st, hm(0, R * 0.73, R * 0.95), shade(L.hair, 0.9));
  }
  if (L.acc?.includes('earrings') && named) for (const sx of [-1, 1]) b.add(Bone.Head, HP, ball(0.022, 5, 3), hm(sx * R * 1.0, R * 0.62, 0.02), 0xf2c43a);

  // Hair (winter beanies replace the crown; named villagers keep their signature hat)
  const hat = named ? L.hat : undefined;
  const winterHat = winter && !hat && L.hairStyle !== 'cap' && hatOn;
  const style = L.hairStyle;
  if (style !== 'bald') {
    const cap = new THREE.SphereGeometry(R * 1.07, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.55);
    b.add(Bone.Head, HP, cap, hm(0, R * 0.98, -0.02, -0.25, 0, 0), L.hair);
  }
  if (style === 'bun') {
    if (!winterHat && hat !== 'sunhat') b.add(Bone.Head, HP, lump(0.16, rng, 1, 0.12), hm(0, R * 1.85, -R * 0.35), L.hair);
    for (const sx of [-1, 1]) b.add(Bone.Head, HP, lump(0.11, rng), hm(sx * R * 0.86, R * 1.0, R * 0.2, 0, 0, 0, 0.6, 1.1, 0.9), L.hair);
    b.add(Bone.Head, HP, lump(0.2, rng, 1, 0.1), hm(0, R * 1.42, R * 0.55, 0.5, 0, 0, 1.6, 0.5, 0.7), L.hair);
  } else if (style === 'bob' || style === 'long' || style === 'ponytail') {
    // One shell falling to the jaw (open at the face) + a soft fringe.
    const drop = style === 'long' ? 0.8 : 0.66;
    const shell = new THREE.SphereGeometry(R * 1.13, 12, 6, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * drop);
    b.add(Bone.Head, HP, shell, hm(0, R * 0.96, -0.02, 0, 0, 0, 1.02, 1.04, 1), L.hair);
    const fringe = lump(0.17, rng, 1, 0.08);
    fringe.scale(1.55, 0.5, 0.75);
    b.add(Bone.Head, HP, fringe, hm(0, R * 1.42, R * 0.6, 0.55, 0, 0), L.hair);
    if (style === 'ponytail') b.add(Bone.Head, HP, new THREE.CapsuleGeometry(0.08, 0.3, 1, 6), hm(0, R * 1.0, -R * 1.1, 0.35), L.hair);
  } else if (style === 'cap') {
    // Tweed / linen caps (a pale cream read as a chef's hat under the sun + bloom).
    const capTint = winter ? accent : o === 'fall' ? shade(accent, 0.5) : [0x8a7a62, 0x5a6a7a, 0x9a8468][Math.floor((spec.phase ?? 0) * 3) % 3]!;
    if (!hat) {
      b.add(Bone.Head, HP, new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.12, 12, 1, true), hm(0, R * 1.55, -0.02, -0.12), capTint);
      const pf = lump(R * 1.05, rng, 1, 0.12);
      pf.scale(1.1, 0.55, 1.1);
      b.add(Bone.Head, HP, pf, hm(0, R * 1.78, -0.05, -0.15), winter ? shade(accent, 1.1) : shade(capTint, 1.12));
    }
    for (const sx of [-1, 1]) b.add(Bone.Head, HP, lump(0.1, rng), hm(sx * R * 0.9, R * 0.95, R * 0.1, 0, 0, 0, 0.6, 1, 0.9), L.hair);
  } else if (style === 'curly') {
    for (let i = 0; i < 9; i++) {
      const a = -1.2 + (i / 8) * 2.4 + Math.PI;
      const up = i % 2 ? 1.5 : 1.25;
      b.add(Bone.Head, HP, lump(0.12, rng, 0, 0.2), hm(Math.sin(a) * R * 0.95, R * up, Math.cos(a) * R * 0.9), L.hair);
    }
    for (let i = 0; i < 4; i++) b.add(Bone.Head, HP, lump(0.11, rng, 0, 0.2), hm(-0.15 + i * 0.1, R * 1.55, R * 0.45), L.hair);
  } else if (style === 'spiky') {
    for (let i = 0; i < 7; i++) {
      const a = -1.1 + (i / 6) * 2.2;
      b.add(Bone.Head, HP, new THREE.ConeGeometry(0.07, 0.2, 5), hm(Math.sin(a) * R * 0.55, R * 1.75, Math.cos(a) * R * 0.25 - 0.02, Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.7), L.hair);
    }
  } else if (style === 'braids') {
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) b.add(Bone.Head, HP, lump(0.075 - i * 0.008, rng, 0, 0.1), hm(sx * R * 0.72, R * (0.55 - i * 0.3), -R * 0.5), L.hair);
  } else if (style === 'slick') {
    const sl = new THREE.SphereGeometry(R * 1.1, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.45);
    b.add(Bone.Head, HP, sl, hm(0, R * 1.0, -0.03, -0.35, 0.2, 0), shade(L.hair, 1.08));
  } else if (style !== 'bald') {
    for (let i = 0; i < 5; i++) {
      const a = -0.9 + i * 0.45;
      b.add(Bone.Head, HP, lump(0.13, rng, 0, 0.18), hm(Math.sin(a) * R * 0.8, R * 1.35, Math.cos(a) * R * 0.75), L.hair);
    }
  }
  // Signature hats (named villagers)
  const hatC = L.hatColor ?? accent;
  if (hat === 'flatcap') {
    const pf = lump(R * 1.08, rng, 1, 0.08);
    pf.scale(1.08, 0.48, 1.12);
    b.add(Bone.Head, HP, pf, hm(0, R * 1.62, -0.02, -0.1), hatC);
    b.add(Bone.Head, HP, new THREE.CylinderGeometry(R * 0.7, R * 0.75, 0.03, 10, 1, false, -Math.PI * 0.5, Math.PI), hm(0, R * 1.45, R * 0.72, 0.22), shade(hatC, 0.85));
  } else if (hat === 'beanie' || (winterHat && !named) || (winter && hat === 'sunhat')) {
    const c = hat ? hatC : hatTint;
    const bh = new THREE.SphereGeometry(R * 1.1, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
    b.add(Bone.Head, HP, bh, hm(0, R * 1.12, -0.02, -0.2), c);
    b.add(Bone.Head, HP, new THREE.TorusGeometry(R * 1.06, 0.05, 4, 14), hm(0, R * 1.15, -0.02, Math.PI / 2 - 0.2), shade(c, 0.8));
    b.add(Bone.Head, HP, lump(0.09, rng, 0, 0.2), hm(0, R * 2.2, -R * 0.25), 0xf4efe6);
  } else if (hat === 'sunhat') {
    b.add(Bone.Head, HP, new THREE.CylinderGeometry(R * 1.9, R * 1.95, 0.03, 16), hm(0, R * 1.5, -0.02, -0.14), hatC);
    b.add(Bone.Head, HP, new THREE.CylinderGeometry(R * 0.85, R * 1.0, 0.26, 12), hm(0, R * 1.68, -0.04, -0.14), hatC);
    b.add(Bone.Head, HP, new THREE.CylinderGeometry(R * 1.01, R * 1.01, 0.07, 12, 1, true), hm(0, R * 1.58, -0.04, -0.14), o === 'spring' ? 0xf06a8a : 0xa8587a);
  } else if (hat === 'bandana') {
    const bn = new THREE.SphereGeometry(R * 1.1, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.46);
    b.add(Bone.Head, HP, bn, hm(0, R * 1.02, -0.02, -0.28), hatC);
    b.add(Bone.Head, HP, box(0.12, 0.08, 0.14), hm(0, R * 1.35, -R * 1.02, 0.4), hatC);
  } else if (winterHat) {
    // Named villagers without a hat get a beanie in their own accent.
    const bh = new THREE.SphereGeometry(R * 1.1, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
    b.add(Bone.Head, HP, bh, hm(0, R * 1.12, -0.02, -0.2), accent);
    b.add(Bone.Head, HP, new THREE.TorusGeometry(R * 1.06, 0.05, 4, 14), hm(0, R * 1.15, -0.02, Math.PI / 2 - 0.2), shade(accent, 0.8));
    b.add(Bone.Head, HP, lump(0.09, rng, 0, 0.2), hm(0, R * 2.2, -R * 0.25), 0xf4efe6);
  }
  // Festival headwear
  if (o === 'spring' && hat !== 'sunhat' && !hatOn && accOn) {
    // A ribbon bow in the hair.
    for (const sx of [-1, 1]) b.add(Bone.Head, HP, new THREE.ConeGeometry(0.06, 0.12, 4), hm(R * 0.5 + sx * 0.06, R * 1.62, -R * 0.1, 0, 0, sx * Math.PI / 2), accent);
    b.add(Bone.Head, HP, ball(0.03, 5, 3), hm(R * 0.5, R * 1.62, -R * 0.1), shade(accent, 0.8));
  } else if (o === 'spring' && hat !== 'sunhat' && hatOn) {
    // Flower crown (rides on the hat band when there is one).
    const cy = hat ? R * 1.5 : R * 1.52;
    b.add(Bone.Head, HP, new THREE.TorusGeometry(R * 0.98, 0.026, 3, 14), hm(0, cy, -0.02, Math.PI / 2 - 0.28), 0x5a9a3a);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const fx2 = Math.cos(a) * R * 0.98;
      const fz = Math.sin(a) * R * 0.98;
      const y = cy + fz * Math.sin(-0.28);
      b.add(Bone.Head, HP, new THREE.IcosahedronGeometry(i % 3 === 0 ? 0.06 : 0.047, 0), hm(fx2, y, fz * Math.cos(0.28) - 0.02), [0xff8fab, 0xffffff, 0xffd166, 0xc77dff, 0xff6a8a][(i + (spec.phase ?? 0) * 10) % 5 | 0]!);
    }
  } else if (o === 'summer' && (named || hw < 0.55)) {
    // A big flower tucked behind the ear.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const pet = ball(0.06, 5, 3);
      pet.scale(1, 0.35, 0.6);
      b.add(Bone.Head, HP, pet, hm(R * 0.95 + Math.cos(a) * 0.05, R * 1.25 + Math.sin(a) * 0.05, R * 0.25, 0, Math.PI / 2, a), accent);
    }
    b.add(Bone.Head, HP, ball(0.03, 5, 3), hm(R * 1.0, R * 1.25, R * 0.25), 0xffe070);
  } else if (o === 'fall' && !hat && style !== 'cap' && style !== 'bun' && hatOn) {
    // Felt hat (muted browns / slates / olives) with a contrasting band and a feather.
    b.add(Bone.Head, HP, new THREE.CylinderGeometry(R * 1.35, R * 1.35, 0.03, 14), hm(0, R * 1.5, 0, -0.12), hatTint);
    b.add(Bone.Head, HP, new THREE.CylinderGeometry(R * 0.75, R * 0.85, 0.24, 10), hm(0, R * 1.5 + 0.13, -0.02, -0.12), hatTint);
    b.add(Bone.Head, HP, new THREE.CylinderGeometry(R * 0.86, R * 0.86, 0.06, 10, 1, true), hm(0, R * 1.5 + 0.05, -0.02, -0.12), accent);
    b.add(Bone.Head, HP, box(0.03, 0.22, 0.01), hm(R * 0.8, R * 1.9, -0.05, 0, 0, -0.5), 0xd8a040);
  }
  if (accOn && style !== 'bald') {
    if (winter) {
      // Earmuffs: a band over the crown + two fluffy muffs.
      b.add(Bone.Head, HP, new THREE.TorusGeometry(R * 1.12, 0.022, 3, 12, Math.PI), hm(0, R * 1.0, 0, 0, 0, 0), shade(accent, 0.8));
      for (const sx of [-1, 1]) b.add(Bone.Head, HP, lump(0.1, rng, 0, 0.1), hm(sx * R * 1.08, R * 0.95, 0, 0, 0, 0, 0.7, 1, 1), accent);
    } else if (o === 'fall') {
      // Knit headband.
      b.add(Bone.Head, HP, new THREE.TorusGeometry(R * 1.04, 0.045, 4, 14), hm(0, R * 1.28, -0.02, Math.PI / 2 - 0.3), accent);
    } else if (o !== 'spring') {
      // Hair bow / clip.
      for (const sx of [-1, 1]) b.add(Bone.Head, HP, new THREE.ConeGeometry(0.05, 0.1, 4), hm(-R * 0.55 + sx * 0.05, R * 1.55, R * 0.2, 0, 0, sx * Math.PI / 2), accent);
    }
  }

  // ── eyes (blink)
  for (const sx of [-1, 1]) {
    const local = new THREE.Vector3(sx * 0.115, R * 0.95, R * 0.9);
    const pivot = local.clone().multiplyScalar(hs).add(NECK);
    const em = headM(mat(local.x, local.y, local.z, -0.12));
    const eyeS = named ? 1 : 0.88 + new Rng(`${seed}:eye`).next() * 0.26;
    b.add(Bone.Eye, pivot, new THREE.CapsuleGeometry(0.036 * eyeS, 0.046 * eyeS, 1, 6), em, 0x1d1612);
    b.add(Bone.Eye, pivot, ball(0.014, 4, 3), em.clone().multiply(mat(0.013, 0.024, 0.03)), 0xffffff);
  }

  const merged = mergeGeometries(b.parts);
  for (const p of b.parts) p.dispose();
  return merged!;
}

/** Joint angles per clip (shared by the vertex shader and the CPU hand solver below). */
const CROWD_GLSL = /* glsl */ `
uniform sampler2D uCrowd;
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
  vec4 C = texelFetch(uCrowd, ivec2(int(aMember), 2), 0);
  float anim = B.x;
  float t = uTime * B.z + B.y * 6.2831;
  float ph = B.y;
  // Joint angles
  float legLx = 0.0, legRx = 0.0, legLz = 0.0, legRz = 0.0;
  float armLx = 0.0, armRx = 0.0, armLs = 0.12, armRs = 0.12; // s = outward spread
  float torX = 0.0, torY = 0.0, torZ = 0.0;
  float hdX = 0.0, hdY = 0.0, hdZ = 0.0;
  float bob = 0.0, squash = 1.0, roll = 0.0, spin = 0.0, flare = 0.0;
  float look = sin(t * 0.31 + ph * 11.0) * 0.35 * smoothstep(0.2, 0.8, abs(sin(t * 0.17 + ph * 3.0)));
  float br = sin(t * 2.0);
  if (anim < 0.5) { // idle
    squash = 1.0 + br * 0.018; torZ = sin(t * 0.5) * 0.04; hdY = look; hdX = sin(t * 0.8) * 0.03; armLs = 0.12 + br * 0.03; armRs = 0.12 + br * 0.03;
  } else if (anim < 1.5) { // cheer: hop with both arms up, waving
    float h = abs(sin(t * 4.0));
    bob = h * 0.11; squash = 1.0 + (h - 0.6) * 0.08; flare = h;
    armLs = 2.55 + sin(t * 8.0) * 0.22; armRs = 2.55 + sin(t * 8.0 + 1.6) * 0.22; armLx = -0.25; armRx = -0.25;
    hdX = -0.18; hdZ = sin(t * 4.0) * 0.08; torZ = sin(t * 4.0) * 0.05;
  } else if (anim < 2.5) { // clap
    float c = sin(t * 9.0);
    armLx = -1.15; armRx = -1.15; armLs = -0.28 - c * 0.14; armRs = -0.28 - c * 0.14;
    bob = abs(sin(t * 4.5)) * 0.025; hdX = sin(t * 4.5) * 0.06 - 0.05; hdY = look * 0.5; torZ = sin(t * 2.25) * 0.04;
  } else if (anim < 3.5) { // dance: step-hop, swinging arms, twirling torso
    float s = sin(t * 3.0);
    bob = abs(s) * 0.09; squash = 1.0 + (abs(s) - 0.5) * 0.06; flare = abs(s);
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
  } else if (anim < 7.5) { // sit (on the ground / a float)
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
  } else if (anim < 15.5) { // toast: mug raised
    armRx = -1.6 + sin(t * 1.3) * 0.2; armRs = -0.1; armLs = 0.14 + br * 0.03; hdX = -0.08; hdY = look * 0.5; torZ = sin(t * 0.7) * 0.04;
  } else if (anim < 17.5) { // ribbon dance (16 = right hand up, 17 = left hand up): skip-steps
    float s = sin(t * 3.2);
    float up = 2.3 + sin(t * 1.6) * 0.06;
    float free = 0.55 + s * 0.35;
    bob = abs(s) * 0.07; flare = abs(s);
    legLx = -crPos(s) * 0.5; legRx = -crPos(-s) * 0.5;
    if (anim < 16.5) { armRs = up; armRx = -0.3; armLs = free; armLx = -0.2; torZ = -0.07; hdZ = 0.12; }
    else { armLs = up; armLx = -0.3; armRs = free; armRx = -0.2; torZ = 0.07; hdZ = -0.12; }
    hdX = -0.12;
  } else if (anim > 18.5) { // ride: on someone's shoulders, legs dangling either side, waving
    float s = sin(t * 3.0);
    legLx = -0.55; legRx = -0.55; legLz = 0.75 + s * 0.08; legRz = -0.75 + s * 0.08;
    armLs = 2.4 + sin(t * 7.0) * 0.25; armRs = 2.2 + sin(t * 6.0 + 1.3) * 0.3; armLx = -0.2; armRx = -0.2;
    torZ = s * 0.06; hdZ = -s * 0.1; hdX = -0.15; bob = abs(s) * 0.02;
  } else { // perch: seated on a bench / log, feet planted, chatting
    legLx = -1.5; legRx = -1.5; bob = -0.02;
    armLx = -0.55 + sin(t * 1.1) * 0.05; armRx = -0.75 + sin(t * 1.7) * 0.12; armLs = 0.05; armRs = -0.05; torX = -0.06;
    hdY = look; squash = 1.0 + br * 0.015; hdX = sin(t * 0.7) * 0.04;
  }
  // Juice row: extra squash (spring hops), lean.
  squash *= C.x;
  roll += C.y;
  flare += C.z;
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
  if (bone == 8) { // skirt hem: swings after the legs, flares out on hops
    float drop = clamp((0.5 - q.y) / 0.3, 0.0, 1.0);
    float swing = (legLx + legRx) * 0.5;
    if (anim > 6.5 && anim < 7.5) swing = -0.9;
    if (anim > 17.5 && anim < 18.5) swing = -1.0;
    if (anim > 18.5) swing = -0.5;
    q.z += -sin(swing) * drop * 0.22 + sin(t * 2.1 + ph * 9.0) * 0.012 * drop;
    q.y += (1.0 - cos(swing)) * drop * 0.06;
    q.xz *= 1.0 + flare * 0.12 * drop;
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
  /** Juice: extra squash (1 = none), roll lean (rad), hem flare. */
  squash: number;
  lean: number;
  flare: number;
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
    this.data = new Float32Array(W * 3 * 4);
    this.tex = new THREE.DataTexture(this.data, W, 3, THREE.RGBAFormat, THREE.FloatType);
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
      this.members.push({ spec: s, x: s.x, y: heightAt(s.x, s.z) + (s.lift ?? 0), z: s.z, yaw: s.yaw, anim: Anim[s.anim], phase: s.phase ?? (i * 0.137) % 1, speed: s.speed ?? 1, scale, squash: 1, lean: 0, flare: 0 });
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

  /** Upload member state (runs every frame on animated maps: no allocations). */
  commit(): void {
    const W = this.tex.image.width;
    const d = this.data;
    const ms = this.members;
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i]!;
      let o = i * 4;
      d[o] = m.x;
      d[o + 1] = m.y;
      d[o + 2] = m.z;
      d[o + 3] = m.yaw;
      o = (W + i) * 4;
      d[o] = m.anim;
      d[o + 1] = m.phase;
      d[o + 2] = m.speed;
      d[o + 3] = m.scale;
      o = (2 * W + i) * 4;
      d[o] = m.squash;
      d[o + 1] = m.lean;
      d[o + 2] = m.flare;
      d[o + 3] = 0;
    }
    this.tex.needsUpdate = true;
  }

  indexOf(id: string): number {
    return this.members.findIndex((m) => m.spec.id === id);
  }

  /**
   * World position of a member's raised hand for the ribbon-dance clips (mirrors the vertex
   * shader exactly: arm → torso lean → squash → bob → yaw → scale). `time` = the shader's uTime.
   */
  ribbonHand(i: number, time: number, out: THREE.Vector3): THREE.Vector3 {
    const m = this.members[i]!;
    const right = m.anim < 16.5;
    const t = time * m.speed + m.phase * 6.2831;
    const s = Math.sin(t * 3.2);
    const up = 2.3 + Math.sin(t * 1.6) * 0.06;
    const armX = -0.3;
    const torZ = right ? -0.07 : 0.07;
    const bob = Math.abs(s) * 0.07;
    const bw = m.spec.look.build;
    // Hand centre relative to the shoulder: crZ(±up) then crX(armX) applied to (0, HAND_Y - 0.03, 0).
    const d = HAND_Y - 0.04;
    const sz = right ? up : -up;
    let x = -Math.sin(sz) * d;
    let y = Math.cos(sz) * d;
    let z = 0;
    const cx = Math.cos(armX);
    const sx = Math.sin(armX);
    [y, z] = [cx * y - sx * z, sx * y + cx * z];
    x += (right ? 1 : -1) * SHOULDER_X * bw;
    y += 0.82;
    // Torso roll about the waist (crZ).
    const ty = y - 0.5;
    const ct = Math.cos(torZ);
    const st = Math.sin(torZ);
    [x, y] = [ct * x - st * ty, st * x + ct * ty + 0.5];
    const sq = m.squash;
    y *= sq;
    x /= Math.sqrt(sq);
    z /= Math.sqrt(sq);
    const cr = Math.cos(m.lean);
    const sr = Math.sin(m.lean);
    [x, y] = [cr * x - sr * y, sr * x + cr * y];
    y += bob;
    const cy = Math.cos(m.yaw);
    const sy = Math.sin(m.yaw);
    return out.set(m.x + (cy * x + sy * z) * m.scale, m.y + y * m.scale, m.z + (-sy * x + cy * z) * m.scale);
  }
}

// ───────────────────────────────────────────── townsfolk generator

const SKINS = [0xf2c8a2, 0xe8b894, 0xf0c4a0, 0xc88a64, 0x9a6444, 0xf6d2b4, 0xb87a56, 0x7a4a32];
const HAIRS = [0x3a2418, 0x6a4228, 0x8a6a58, 0xd8b068, 0x2a1a14, 0xb8542a, 0xa8a29a, 0x4a3a30, 0xe0b880, 0x8a3a1e, 0xe8e0d0, 0x1a1a24, 0xc88a4a, 0x5a2a1a];
const STYLES: NpcLook['hairStyle'][] = ['short', 'bob', 'bun', 'curly', 'long', 'cap', 'ponytail', 'short', 'braids', 'spiky', 'slick', 'bob', 'curly', 'long'];

/** A seeded random villager look (townsfolk filling out the crowd). */
export function randomLook(rng: Rng, opts: { child?: boolean; palette: number[] }): NpcLook {
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rng.next() * a.length)]!;
  const child = !!opts.child;
  let style = pick(STYLES);
  if (!child && style === 'spiky') style = 'short';
  const elder = !child && rng.next() < 0.18;
  if (elder && rng.next() < 0.3) style = 'bald';
  return {
    skin: pick(SKINS),
    hair: elder ? pick([0xa8a29a, 0xe8e0d0, 0xc8c0b8]) : pick(HAIRS),
    hairStyle: style,
    top: pick(opts.palette),
    bottom: pick([0x4a5a78, 0x5a4a6a, 0x6a5a48, 0x3e4a5a, 0x7a6a5a, 0x5a6a4a, 0x2e3a4a, 0x8a6a4a, 0x6a3a3a, 0x4a4a3a]),
    glasses: !child && rng.next() < (elder ? 0.5 : 0.14),
    beard: !child && (style === 'short' || style === 'bald') && rng.next() < 0.35 ? (rng.next() < 0.4 ? 'mustache' : 'full') : undefined,
    // Height ±10 %, width ±8 % (children and elders read at a glance).
    scale: child ? 0.7 + rng.next() * 0.1 : (elder ? 0.9 : 0.92) + rng.next() * 0.18,
    build: child ? 0.92 + rng.next() * 0.08 : 0.92 + rng.next() * 0.26,
    head: child ? 1.1 : 1,
  };
}

/**
 * Lift for a child riding on a grown-up's shoulders (both CrowdSpec looks): the child's hips sit
 * just above the grown-up's neck.
 */
export function shoulderLift(parent: NpcLook, child: NpcLook): number {
  return 0.96 * 1.22 * parent.scale + 0.06 - 0.5 * 1.22 * child.scale;
}
