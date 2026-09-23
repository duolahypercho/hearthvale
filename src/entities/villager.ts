/**
 * Villagers: chibi proportions like the farmer, built per NpcLook into ONE skinned mesh
 * (1 draw call + 1 shadow call per villager): hips, knees, spine, shoulders, elbows, head,
 * eyes (blink), mouth (talk flap), a hair bone (ponytail / braid sway) and one bone per held
 * prop (broom, book, hammer, can, brush + palette, saw, rod, cane) that is scaled to zero when
 * the prop is put away.
 *
 * Silhouettes come from the look: height, build, leg length, head size, 11 hair styles, 4 hats,
 * skirts, coats with tails, vests, bow ties, tool belts, satchels, shawls, beards, glasses.
 * Walks come from WalkStyle (stride, bounce, sway, stoop, arm swing, a child's skip).
 * Activities (sweep, read, chat, hammer, paint, water, sit, knead, saw, fish, lean, play) are
 * procedural loops layered on the idle (breathing, weight shift, blinks, look-arounds).
 *
 * API kept stable for the cutscene system: new Villager(def), root, position, setPosition,
 * setFacing, setYaw, walkTo, isMoving, update(dt, heightAt, simulate), talkTo.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Facing } from '../core/events';
import type { NpcDef, NpcLook, Activity, Emote, WalkStyle } from '../data/npcs';
import { NPCS } from '../data/npcs';
import { roundedBox, lumpySphere, bevelCylinder } from '../world/geom';
import { applyWorldFx } from '../render/worldfx';
import { patchMaterial, after } from '../render/patch';
import { Rng } from '../core/rng';

let shared: THREE.MeshStandardMaterial | null = null;
function sharedMat(): THREE.MeshStandardMaterial {
  if (!shared) {
    shared = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    shared.name = 'villager';
    applyWorldFx(shared, { snow: false, clouds: true, wet: true });
    // Ink edge + warm rim: silhouettes darken towards grazing angles (a free, pass-less outline that
    // separates the chibi bodies from the cobbles) and pick up a soft sky-lit rim on top.
    patchMaterial(shared, 'villager-ink', (shader) => {
      shader.fragmentShader = after(
        shader.fragmentShader,
        '#include <opaque_fragment>',
        /* glsl */ `{
          float hvNdV = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
          float hvInk = smoothstep(0.34, 0.06, hvNdV);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.32, 0.24, 0.22), hvInk * 0.85);
          float hvRim = smoothstep(0.62, 0.3, hvNdV) * (1.0 - hvInk) * clamp(normal.y * 0.8 + 0.35, 0.0, 1.0);
          gl_FragColor.rgb += vec3(1.0, 0.86, 0.66) * hvRim * 0.1;
        }`,
      );
    });
  }
  return shared;
}

/** Heads are drawn bigger than the body (chibi) so faces read from the high diorama camera. */
const HEAD_BOOST = 1.2;
/** Chin up: faces tilt towards the camera. */
const FACE_UP = 0.15;

/** Body-language clips layered over any pose (heart events, conversations). */
export type Gesture = 'chest' | 'shrug' | 'laugh' | 'lookdown' | 'point' | 'wave' | 'think' | 'wring' | 'surprise' | 'angry' | 'nod' | 'open' | 'hug';
/** Portrait mood → the gesture that sells it. */
export const MOOD_GESTURE: Record<string, Gesture> = { happy: 'open', laugh: 'laugh', sad: 'lookdown', angry: 'angry', surprised: 'surprise', blush: 'chest', worried: 'wring', thinking: 'think', neutral: 'nod' };

const FACING_YAW: Record<Facing, number> = { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };
const DEFAULT_WALK: WalkStyle = { speed: 1.55, stride: 0.55, bounce: 0.045, sway: 0.06, hunch: 0, arms: 0.45 };

type PropName = 'broom' | 'book' | 'hammer' | 'can' | 'brush' | 'palette' | 'saw' | 'rod' | 'cane' | 'mug';
const PROPS: PropName[] = ['broom', 'book', 'hammer', 'can', 'brush', 'palette', 'saw', 'rod', 'cane', 'mug'];
const ACTIVITY_PROPS: Partial<Record<Activity, PropName[]>> = {
  sweep: ['broom'],
  read: ['book'],
  hammer: ['hammer'],
  water: ['can'],
  paint: ['brush', 'palette'],
  saw: ['saw'],
  fish: ['rod'],
};

/** Activities a villager may perform (schedules, rainy days, heart-event beats) → their props. */
function usedProps(def: NpcDef): Set<PropName> {
  const acts = new Set<string>();
  for (const s of [...def.schedule, ...(def.rainSchedule ?? [])]) if (s[2]) acts.add(s[2]);
  for (const n of Object.values(NPCS)) for (const ev of n.events) for (const st of ev.script) if ('act' in st && st.act === def.id) acts.add(st.activity);
  const out = new Set<PropName>();
  for (const a of acts) for (const p of ACTIVITY_PROPS[a as Activity] ?? []) out.add(p);
  if (def.look.acc?.includes('cane')) out.add('cane');
  return out;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _s.set(sx, sy, sz);
  _p.set(x, y, z);
  return new THREE.Matrix4().compose(_p.clone(), _q.clone(), _s.clone());
}

const shadeHex = (h: number, k: number): number => new THREE.Color(h).multiplyScalar(k).getHex();
const mixHex = (a: number, b: number, t: number): number => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

/** Collects parts weighted to single bones and merges them into one skinned geometry. */
class RigBuilder {
  private parts: THREE.BufferGeometry[] = [];
  add(bone: number, geo: THREE.BufferGeometry, m: THREE.Matrix4 | undefined, color: number, ao = 1): void {
    let g = geo.index ? geo.clone() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.index) {
      const n = g.attributes.position!.count;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    } else if (!(g.index.array instanceof Uint32Array)) {
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index.array), 1));
    }
    if (m) g.applyMatrix4(m);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const y = pos.getY(i);
      // Contact darkening towards the feet.
      const a = ao * (0.8 + 0.2 * THREE.MathUtils.smoothstep(y, 0.0, 0.35));
      col[i * 3] = c.r * a;
      col[i * 3 + 1] = c.g * a;
      col[i * 3 + 2] = c.b * a;
      si[i * 4] = bone;
      sw[i * 4] = 1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    this.parts.push(g);
    void g;
  }
  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    g.computeBoundingSphere();
    return g;
  }
}

enum B {
  root,
  hips,
  thighL,
  shinL,
  thighR,
  shinR,
  spine,
  head,
  eyeL,
  eyeR,
  mouth,
  hairBack,
  armL,
  foreL,
  armR,
  foreR,
  propBase,
}

// Emote bubbles (shared textures per icon).
const EMOTE_TEX = new Map<Emote, THREE.Texture>();
function emoteTexture(e: Emote): THREE.Texture {
  let t = EMOTE_TEX.get(e);
  if (t) return t;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  // Bubble with a little tail and a warm outline.
  g.shadowColor = 'rgba(60,30,10,0.35)';
  g.shadowBlur = 8;
  g.shadowOffsetY = 3;
  g.fillStyle = '#fffaf0';
  g.strokeStyle = '#7a4a2a';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(30, 16);
  g.lineTo(98, 16);
  g.quadraticCurveTo(116, 16, 116, 34);
  g.lineTo(116, 80);
  g.quadraticCurveTo(116, 98, 98, 98);
  g.lineTo(74, 98);
  g.lineTo(62, 116);
  g.lineTo(56, 98);
  g.lineTo(30, 98);
  g.quadraticCurveTo(12, 98, 12, 80);
  g.lineTo(12, 34);
  g.quadraticCurveTo(12, 16, 30, 16);
  g.closePath();
  g.fill();
  g.shadowColor = 'transparent';
  g.stroke();
  const cx = 64;
  const cy = 57;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  switch (e) {
    case 'heart': {
      g.fillStyle = '#e8483e';
      g.beginPath();
      g.moveTo(cx, cy + 26);
      g.bezierCurveTo(cx - 40, cy, cx - 22, cy - 34, cx, cy - 14);
      g.bezierCurveTo(cx + 22, cy - 34, cx + 40, cy, cx, cy + 26);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.beginPath();
      g.ellipse(cx - 13, cy - 10, 6, 4, -0.6, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'exclaim':
      g.fillStyle = '#e8573e';
      g.beginPath();
      g.roundRect(cx - 7, cy - 30, 14, 40, 7);
      g.fill();
      g.beginPath();
      g.arc(cx, cy + 22, 8, 0, Math.PI * 2);
      g.fill();
      break;
    case 'question':
      g.strokeStyle = '#3f7fb0';
      g.lineWidth = 11;
      g.beginPath();
      g.arc(cx, cy - 12, 15, Math.PI * 1.1, Math.PI * 2.4);
      g.lineTo(cx, cy + 10);
      g.stroke();
      g.fillStyle = '#3f7fb0';
      g.beginPath();
      g.arc(cx, cy + 25, 7, 0, Math.PI * 2);
      g.fill();
      break;
    case 'music':
      g.fillStyle = '#6a4ab0';
      g.strokeStyle = '#6a4ab0';
      g.lineWidth = 7;
      g.beginPath();
      g.ellipse(cx - 14, cy + 18, 11, 8, -0.4, 0, Math.PI * 2);
      g.ellipse(cx + 18, cy + 10, 11, 8, -0.4, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(cx - 5, cy + 16);
      g.lineTo(cx - 5, cy - 26);
      g.lineTo(cx + 27, cy - 34);
      g.lineTo(cx + 27, cy + 8);
      g.stroke();
      break;
    case 'sweat':
      g.fillStyle = '#6ab8e8';
      g.beginPath();
      g.moveTo(cx, cy - 30);
      g.quadraticCurveTo(cx + 24, cy + 4, cx, cy + 26);
      g.quadraticCurveTo(cx - 24, cy + 4, cx, cy - 30);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.beginPath();
      g.ellipse(cx - 6, cy + 6, 4, 8, 0.3, 0, Math.PI * 2);
      g.fill();
      break;
    case 'anger':
      g.strokeStyle = '#d8342a';
      g.lineWidth = 9;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        g.beginPath();
        g.moveTo(cx + sx * 8, cy + sy * 26);
        g.quadraticCurveTo(cx + sx * 8, cy + sy * 8, cx + sx * 26, cy + sy * 8);
        g.stroke();
      }
      break;
    case 'idea':
      g.fillStyle = '#f2c43a';
      g.beginPath();
      g.arc(cx, cy - 6, 20, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#9a8a70';
      g.fillRect(cx - 9, cy + 14, 18, 12);
      break;
    case 'sad':
      g.fillStyle = '#5a7ab0';
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.ellipse(cx - 22 + i * 22, cy + (i % 2) * 10 - 4, 6, 10, 0, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'zzz':
      g.fillStyle = '#5a6ab0';
      g.font = 'bold 44px Fredoka, Nunito, sans-serif';
      g.textAlign = 'center';
      g.fillText('z', cx - 16, cy + 22);
      g.font = 'bold 32px Fredoka, Nunito, sans-serif';
      g.fillText('z', cx + 16, cy);
      break;
    case 'dots':
      g.fillStyle = '#7a5a3a';
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(cx - 24 + i * 24, cy + 4, 8, 0, Math.PI * 2);
        g.fill();
      }
      break;
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  EMOTE_TEX.set(e, t);
  return t;
}

export class Villager {
  readonly root = new THREE.Group();
  readonly position = new THREE.Vector3();
  /** Scaled body (rotates with yaw, bobs, squashes). */
  private body = new THREE.Group();
  private mesh!: THREE.SkinnedMesh;
  private bones: THREE.Bone[] = [];
  private rest: THREE.Vector3[] = [];
  private propBones = new Map<PropName, THREE.Bone>();
  private yaw = 0;
  private targetYaw = 0;
  private target: THREE.Vector3 | null = null;
  private arriveFacing: Facing | number = 'down';
  private phase = 0;
  private t = Math.random() * 10;
  private blinkT = 0;
  private nextBlink = 1 + Math.random() * 3;
  private lookT = 2 + Math.random() * 3;
  private look = 0;
  private lookTarget = 0;
  private moving = false;
  private runMul = 1;
  private hipY = 0.5;
  private sitBlend = 0;
  private actBlend = 0;
  private hairSwing = 0;
  private hop = 0;
  private hairVel = 0;
  private emoteSprite: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private emoteT = 0;
  private gest: Gesture | null = null;
  private gestT = 0;
  private gestDur = 0;
  private squashT = -1;
  private squashK = 1;
  /** World point to face while talking (null = not talking). */
  talkTo: THREE.Vector3 | null = null;
  /** Mouth flaps while true (dialogue typewriter). */
  speaking = false;
  /** Current activity (loops while standing still). */
  activity: Activity = 'idle';
  private talkT = 0;
  readonly walkStyle: WalkStyle;
  readonly speed: number;
  readonly scaleS: number;
  /** Height of the head top above the feet (world m) — emote bubbles, name tags. */
  readonly headTop: number;

  /** Contact-shadow radius (m). */
  readonly blobR: number;

  /** `blob: false` when the owner draws all contact shadows in one instanced call (NpcSystem). */
  constructor(readonly def: NpcDef, opts: { blob?: boolean } = {}) {
    this.root.name = `npc:${def.id}`;
    this.walkStyle = def.walk ?? DEFAULT_WALK;
    this.speed = this.walkStyle.speed;
    this.scaleS = 1.22 * def.look.scale;
    this.build(def.look);
    this.body.scale.setScalar(this.scaleS);
    this.headTop = (this.hipY + 0.46 + 0.8 * HEAD_BOOST * (def.look.head ?? 1)) * this.scaleS;
    this.blobR = 0.42 * Math.max(0.9, def.look.build) * def.look.scale;
    if (opts.blob === false) return;
    const blob = new THREE.Mesh(new THREE.CircleGeometry(this.blobR, 20), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.2, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    blob.renderOrder = 1;
    blob.userData.noAO = true;
    blob.name = 'npc-blob';
    this.root.add(blob);
  }

  // ───────────────────────────────────────────── build

  private build(L: NpcLook): void {
    const rng = new Rng(`npc:${this.def.id}`);
    const bw = L.build;
    const legLen = 0.5 * (L.legs ?? 1);
    const hipY = legLen;
    this.hipY = hipY;
    const hs = 1.15 * HEAD_BOOST * (L.head ?? 1);
    const R = 0.32;
    const headY = hipY + 0.46;
    const shoulderY = hipY + 0.32;
    const shoes = L.shoes ?? 0x5a3a24;
    const sleeve = L.coat ?? L.top;
    const rb = new RigBuilder();

    // ── bones (rig space positions)
    const bonePos: [B, B | -1, number, number, number][] = [
      [B.root, -1, 0, 0, 0],
      [B.hips, B.root, 0, hipY, 0],
      [B.thighL, B.hips, -0.12 * bw, hipY, 0],
      [B.shinL, B.thighL, -0.12 * bw, hipY - legLen * 0.46, 0],
      [B.thighR, B.hips, 0.12 * bw, hipY, 0],
      [B.shinR, B.thighR, 0.12 * bw, hipY - legLen * 0.46, 0],
      [B.spine, B.hips, 0, hipY, 0],
      [B.head, B.spine, 0, headY, 0],
      [B.eyeL, B.head, -0.115 * hs, headY + R * 0.95 * hs, R * 0.9 * hs],
      [B.eyeR, B.head, 0.115 * hs, headY + R * 0.95 * hs, R * 0.9 * hs],
      [B.mouth, B.head, 0, headY + R * 0.64 * hs, R * 0.96 * hs],
      [B.hairBack, B.head, 0, headY + R * 1.3 * hs, -R * 0.7 * hs],
      [B.armL, B.spine, -0.25 * bw, shoulderY, 0],
      [B.foreL, B.armL, -0.25 * bw, shoulderY - 0.15, 0],
      [B.armR, B.spine, 0.25 * bw, shoulderY, 0],
      [B.foreR, B.armR, 0.25 * bw, shoulderY - 0.15, 0],
      [B.propBase, B.root, 0, 0, 0],
    ];
    const world: THREE.Vector3[] = [];
    for (const [id, parent, x, y, z] of bonePos) {
      const bone = new THREE.Bone();
      bone.name = B[id]!;
      world[id] = new THREE.Vector3(x, y, z);
      if (parent === -1) bone.position.set(x, y, z);
      else {
        bone.position.set(x, y, z).sub(world[parent]!);
        this.bones[parent]!.add(bone);
      }
      this.bones[id] = bone;
    }
    // Prop bones hang off the hands.
    const handL = new THREE.Vector3(-0.25 * bw, shoulderY - 0.31, 0.02);
    const handR = new THREE.Vector3(0.25 * bw, shoulderY - 0.31, 0.02);
    const propIndex = new Map<PropName, number>();
    for (const p of PROPS) {
      const bone = new THREE.Bone();
      bone.name = `prop-${p}`;
      const left = p === 'palette' || p === 'cane';
      const hand = left ? handL : handR;
      const parent = left ? B.foreL : B.foreR;
      bone.position.copy(hand).sub(world[parent]!);
      this.bones[parent]!.add(bone);
      propIndex.set(p, this.bones.length);
      this.bones.push(bone);
      world.push(hand.clone());
      this.propBones.set(p, bone);
    }
    // Winter knitwear bone (scarf / muffler), scaled to zero outside winter.
    const neck = new THREE.Vector3(0, hipY + 0.38, 0);
    const winterIdx = this.bones.length;
    {
      const bone = new THREE.Bone();
      bone.name = 'winter';
      bone.position.copy(neck).sub(world[B.spine]!);
      this.bones[B.spine]!.add(bone);
      this.bones.push(bone);
      world.push(neck.clone());
      this.winterBone = bone;
    }
    for (const b of this.bones) this.rest.push(b.position.clone());

    // ── legs
    for (const [thigh, shin, sx] of [[B.thighL, B.shinL, -1], [B.thighR, B.shinR, 1]] as const) {
      const x = sx * 0.12 * bw;
      rb.add(thigh, new THREE.CapsuleGeometry(0.1, legLen * 0.34, 3, 8), M(x, hipY - legLen * 0.24, 0), L.skirt ? shadeHex(L.bottom, 0.8) : L.bottom);
      rb.add(shin, new THREE.CapsuleGeometry(0.088, legLen * 0.32, 3, 8), M(x, hipY - legLen * 0.68, 0), L.skirt ? shadeHex(L.skin, 0.95) : L.bottom);
      rb.add(shin, roundedBox(0.19, 0.14, 0.27, 0.06, 1), M(x, 0.08, 0.04), shoes);
      rb.add(shin, roundedBox(0.2, 0.04, 0.29, 0.02), M(x, 0.02, 0.045), shadeHex(shoes, 0.6));
    }
    // ── torso (spine)
    const topShape = M(0, hipY + 0.18, 0, 0, 0, 0, 1.05 * bw, 1, 0.92 * bw);
    rb.add(B.spine, new THREE.CapsuleGeometry(0.2, 0.18, 6, 14), topShape, L.coat ?? L.top);
    rb.add(B.hips, new THREE.CylinderGeometry(0.215 * bw, 0.205 * bw, 0.18, 14), M(0, hipY, 0), L.skirt ? L.bottom : L.bottom);
    if (L.skirt) {
      // A-line skirt flaring from the waist to mid-shin.
      const sk = new THREE.CylinderGeometry(0.21 * bw, 0.34 * bw, legLen * 0.72, 18, 1, true);
      rb.add(B.hips, sk, M(0, hipY - legLen * 0.3, 0), L.bottom);
      rb.add(B.hips, new THREE.TorusGeometry(0.335 * bw, 0.022, 5, 20), M(0, hipY - legLen * 0.66, 0, Math.PI / 2), shadeHex(L.bottom, 0.8));
    }
    if (L.coat !== undefined) {
      // Coat tails + lapels + the shirt peeking through.
      const tails = new THREE.CylinderGeometry(0.225 * bw, 0.3 * bw, legLen * 0.62, 16, 1, true, Math.PI * 0.12, Math.PI * 1.76);
      rb.add(B.hips, tails, M(0, hipY - legLen * 0.24, 0), L.coat);
      rb.add(B.spine, roundedBox(0.12 * bw, 0.3, 0.03, 0.02), M(0, hipY + 0.22, 0.19 * bw), L.top);
      for (const sx of [-1, 1]) rb.add(B.spine, roundedBox(0.08, 0.24, 0.03, 0.015), M(sx * 0.08 * bw, hipY + 0.26, 0.2 * bw, 0, 0, sx * 0.25), shadeHex(L.coat, 0.88));
    }
    if (L.vest !== undefined) {
      const vest = new THREE.CapsuleGeometry(0.205, 0.16, 6, 14, 1);
      rb.add(B.spine, vest, M(0, hipY + 0.17, -0.004, 0, 0, 0, 1.08 * bw, 0.98, 0.95 * bw), L.vest);
      rb.add(B.spine, roundedBox(0.11 * bw, 0.28, 0.03, 0.02), M(0, hipY + 0.2, 0.2 * bw), L.top);
    }
    if (L.apron !== undefined) {
      // Cloth apron wrapped over the torso curve: a bib (with a stitched hem + neck straps),
      // a flared skirt panel on the hips with a pocket, and a waist tie with a bow at the back.
      const ap = L.apron;
      const bib = new THREE.CylinderGeometry(0.212, 0.222, 0.26, 12, 1, true, -0.62, 1.24);
      rb.add(B.spine, bib, M(0, hipY + 0.17, 0, 0, 0, 0, 1.05 * bw, 1, 0.92 * bw), ap);
      const hem = new THREE.TorusGeometry(0.223, 0.009, 4, 10, 1.24);
      hem.rotateX(Math.PI / 2);
      hem.rotateY(0.62 - Math.PI / 2);
      rb.add(B.spine, hem, M(0, hipY + 0.3, 0, 0, 0, 0, 1.05 * bw, 1, 0.92 * bw), shadeHex(ap, 0.82));
      for (const sx of [-1, 1]) rb.add(B.spine, new THREE.CapsuleGeometry(0.012, 0.16, 2, 5), M(sx * 0.1 * bw, hipY + 0.37, 0.12 * bw, -0.5, 0, sx * 0.35), shadeHex(ap, 0.85));
      const skirt = new THREE.CylinderGeometry(0.228, 0.29, 0.3, 12, 1, true, -0.95, 1.9);
      rb.add(B.hips, skirt, M(0, hipY - 0.12, 0, 0, 0, 0, 1.0 * bw, 1, 0.95 * bw), ap);
      const pocket = new THREE.CylinderGeometry(0.262, 0.272, 0.09, 8, 1, true, -0.34, 0.68);
      rb.add(B.hips, pocket, M(0, hipY - 0.16, 0.006, 0, 0, 0, 1.0 * bw, 1, 0.95 * bw), shadeHex(ap, 0.9));
      rb.add(B.spine, new THREE.TorusGeometry(0.212, 0.016, 5, 16), M(0, hipY + 0.035, 0, Math.PI / 2, 0, 0, 1.03 * bw, 0.9 * bw, 1), shadeHex(ap, 0.8));
      for (const sx of [-1, 1]) rb.add(B.spine, new THREE.SphereGeometry(0.035, 6, 5), M(sx * 0.035, hipY + 0.035, -0.2 * bw, 0, 0, 0, 1.3, 0.8, 0.7), shadeHex(ap, 0.8));
    }
    if (L.scarf !== undefined) {
      rb.add(B.spine, new THREE.TorusGeometry(0.13, 0.045, 8, 16), M(0, hipY + 0.38, 0, Math.PI / 2 - 0.2, 0, 0), L.scarf);
      // Two knotted tails lying against the chest.
      rb.add(B.spine, new THREE.SphereGeometry(0.045, 8, 6), M(0.07, hipY + 0.33, 0.17 * bw), shadeHex(L.scarf, 0.92));
      rb.add(B.spine, new THREE.CapsuleGeometry(0.032, 0.12, 2, 6), M(0.085, hipY + 0.24, 0.185 * bw, 0.18, 0, 0.12, 1, 1, 0.55), L.scarf);
      rb.add(B.spine, new THREE.CapsuleGeometry(0.028, 0.09, 2, 6), M(0.035, hipY + 0.255, 0.19 * bw, 0.16, 0, -0.18, 1, 1, 0.55), shadeHex(L.scarf, 0.88));
    }
    if (L.bowtie !== undefined) {
      for (const sx of [-1, 1]) rb.add(B.spine, new THREE.ConeGeometry(0.045, 0.08, 4), M(sx * 0.04, hipY + 0.37, 0.16, 0, 0, sx * Math.PI / 2), L.bowtie);
      rb.add(B.spine, new THREE.SphereGeometry(0.022, 6, 5), M(0, hipY + 0.37, 0.17), shadeHex(L.bowtie, 0.8));
    }
    const acc = new Set(L.acc ?? []);
    if (acc.has('toolbelt')) {
      rb.add(B.hips, new THREE.TorusGeometry(0.225 * bw, 0.028, 6, 18), M(0, hipY + 0.03, 0, Math.PI / 2), 0x5a3a22);
      for (const sx of [-1, 1]) rb.add(B.hips, roundedBox(0.1, 0.12, 0.07, 0.025), M(sx * 0.18 * bw, hipY - 0.04, 0.12 * bw, 0, sx * 0.5, 0), 0x6a4428);
      rb.add(B.hips, roundedBox(0.03, 0.14, 0.03, 0.01), M(0.2 * bw, hipY - 0.1, 0.14 * bw), 0x8a8a8a);
    }
    if (acc.has('satchel')) {
      rb.add(B.spine, new THREE.TorusGeometry(0.24, 0.016, 4, 24), M(0, hipY + 0.15, 0, 0, 0, 0.75, 1.05 * bw, 1.3, 0.95 * bw), 0x8a5a32);
      rb.add(B.hips, roundedBox(0.2, 0.17, 0.08, 0.04), M(-0.24 * bw, hipY - 0.02, 0.05, 0, -0.4, 0), 0xa86a3a);
      rb.add(B.hips, roundedBox(0.2, 0.07, 0.085, 0.03), M(-0.24 * bw, hipY + 0.04, 0.055, 0, -0.4, 0), 0x8a5a32);
    }
    if (acc.has('shawl')) {
      const shawl = new THREE.CylinderGeometry(0.17, 0.3 * bw, 0.24, 16, 1, true);
      rb.add(B.spine, shawl, M(0, hipY + 0.29, 0.0), L.scarf ?? 0xf2e2c0);
      rb.add(B.spine, new THREE.ConeGeometry(0.1, 0.18, 3), M(0, hipY + 0.12, 0.2 * bw, Math.PI, 0, 0), L.scarf ?? 0xf2e2c0);
    }
    if (acc.has('stethoscope')) {
      rb.add(B.spine, new THREE.TorusGeometry(0.15, 0.013, 5, 18, Math.PI * 1.2), M(0, hipY + 0.36, 0.02, Math.PI / 2 - 0.35, 0, Math.PI * 0.9), 0x3a3a44);
      rb.add(B.spine, roundedBox(0.02, 0.2, 0.02, 0.008), M(0.05, hipY + 0.22, 0.2 * bw), 0x3a3a44);
      rb.add(B.spine, new THREE.CylinderGeometry(0.032, 0.032, 0.02, 10), M(0.05, hipY + 0.11, 0.205 * bw, Math.PI / 2), 0xc8c8d0);
    }
    if (!L.coat && !L.vest && !L.apron) for (let i = 0; i < 3; i++) rb.add(B.spine, new THREE.SphereGeometry(0.018, 6, 4), M(0, hipY + 0.32 - i * 0.08, 0.2 * bw), 0xf0e0c0);

    // ── arms (upper + fore + hand)
    for (const [arm, fore, sx] of [[B.armL, B.foreL, -1], [B.armR, B.foreR, 1]] as const) {
      const x = sx * 0.25 * bw;
      rb.add(arm, new THREE.SphereGeometry(0.085, 10, 8), M(x, shoulderY, 0), sleeve);
      rb.add(arm, new THREE.CapsuleGeometry(0.074, 0.07, 3, 8), M(x, shoulderY - 0.07, 0), sleeve);
      rb.add(fore, new THREE.CapsuleGeometry(0.06, 0.1, 3, 8), M(x, shoulderY - 0.2, 0), L.coat !== undefined ? L.coat : acc.has('toolbelt') || L.apron !== undefined ? L.skin : L.top);
      rb.add(fore, new THREE.SphereGeometry(0.07, 10, 8), M(x, shoulderY - 0.31, 0.01), L.skin);
    }

    // ── head
    const H = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(0, headY, 0).multiply(new THREE.Matrix4().makeScale(hs, hs, hs)).multiply(M(x, y, z, rx, ry, rz, sx, sy, sz));
    const face = L.face ?? 'round';
    const faceS: [number, number, number] = face === 'long' ? [0.97, 1.05, 1] : face === 'square' ? [1.08, 0.95, 1] : face === 'heart' ? [1.02, 0.98, 1] : [1.04, 0.96, 1];
    rb.add(B.head, new THREE.SphereGeometry(R, 20, 14), H(0, R * 0.92, 0, 0, 0, 0, ...faceS), L.skin);
    if (face === 'square') rb.add(B.head, new THREE.SphereGeometry(R * 0.72, 16, 10), H(0, R * 0.62, R * 0.12, 0, 0, 0, 1.25, 0.8, 1), L.skin);
    for (const sx of [-1, 1]) rb.add(B.head, new THREE.SphereGeometry(0.07, 8, 6), H(sx * R * 0.98, R * 0.88, 0, 0, 0, 0, 0.6, 1, 1), L.skin);
    rb.add(B.head, new THREE.SphereGeometry(0.03, 10, 8), H(0, R * 0.78, R * 0.99), shadeHex(L.skin, 1.04));
    const hatted = !!L.hat;
    for (const sx of [-1, 1]) {
      // Brows sit just above the eyes; under a hat they tuck in below the brim / cuff line.
      rb.add(B.head, new THREE.CapsuleGeometry(0.014, 0.06, 3, 6), H(sx * 0.12, R * (hatted ? 1.15 : 1.2), R * 0.93, 0, 0, Math.PI / 2 + sx * 0.14), shadeHex(L.hair, 0.72));
      rb.add(B.head, new THREE.CircleGeometry(0.052, 14), H(sx * 0.19, R * 0.74, R * 0.875, 0, sx * 0.55, 0), mixHex(L.skin, 0xf07a6a, 0.55));
      if (acc.has('earrings')) rb.add(B.head, new THREE.SphereGeometry(0.022, 8, 6), H(sx * R * 1.0, R * 0.68, 0.02), 0xf2c43a);
    }
    // Mouth (flaps on its own bone while talking).
    rb.add(B.mouth, new THREE.TorusGeometry(0.036, 0.01, 6, 12, Math.PI), H(0, R * 0.64, R * 0.96, 0, 0, Math.PI), 0x3a1a14);
    rb.add(B.mouth, new THREE.CircleGeometry(0.03, 10, Math.PI, Math.PI), H(0, R * 0.64, R * 0.955), 0x8a3a30);
    if (L.glasses) {
      for (const sx of [-1, 1]) rb.add(B.head, new THREE.TorusGeometry(0.07, 0.011, 6, 18), H(sx * 0.115, R * 0.97, R * 1.0), 0x6a4a2a);
      rb.add(B.head, roundedBox(0.07, 0.014, 0.014, 0.005, 1), H(0, R * 1.0, R * 1.02), 0x6a4a2a);
      for (const sx of [-1, 1]) rb.add(B.head, roundedBox(0.012, 0.012, 0.26, 0.004, 1), H(sx * 0.19, R * 1.0, R * 0.8, 0, sx * 0.3, 0), 0x6a4a2a);
    }
    const beard = L.beard === true ? 'full' : L.beard;
    if (beard === 'full') {
      const bg = lumpySphere(0.2, 1, 0.18, rng, 2);
      bg.scale(1.35, 0.9, 0.7);
      rb.add(B.head, bg, H(0, R * 0.5, R * 0.62), L.hair);
      const stache = new THREE.CapsuleGeometry(0.035, 0.12, 3, 8);
      stache.rotateZ(Math.PI / 2);
      rb.add(B.head, stache, H(0, R * 0.73, R * 0.95), shadeHex(L.hair, 0.9));
    } else if (beard === 'mustache') {
      for (const sx of [-1, 1]) {
        const st = new THREE.CapsuleGeometry(0.026, 0.07, 3, 8);
        st.rotateZ(Math.PI / 2 + sx * 0.35);
        rb.add(B.head, st, H(sx * 0.045, R * 0.72, R * 0.97), shadeHex(L.hair, 0.85));
      }
    } else if (beard === 'stubble') {
      const sh = new THREE.SphereGeometry(R * 1.005, 20, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.3);
      rb.add(B.head, sh, H(0, R * 0.92, 0.004, -0.25, 0, 0, ...faceS), mixHex(L.skin, L.hair, 0.3));
    }
    this.buildHair(rb, L, H, R, rng);
    this.buildHat(rb, L, H, R, rng);
    if (acc.has('pencil')) rb.add(B.head, new THREE.CylinderGeometry(0.012, 0.012, 0.2, 6), H(R * 0.98, R * 1.08, 0.02, 0.2, 0, 1.2), 0xf2c43a);
    if (acc.has('flower')) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        rb.add(B.head, new THREE.SphereGeometry(0.03, 6, 5), H(-R * 0.75 + Math.cos(a) * 0.035, R * 1.55 + Math.sin(a) * 0.035, R * 0.45), 0xff8fab);
      }
      rb.add(B.head, new THREE.SphereGeometry(0.025, 6, 5), H(-R * 0.75, R * 1.55, R * 0.48), 0xffd166);
    }
    // Eyes (blink bones).
    for (const [eye, sx] of [[B.eyeL, -1], [B.eyeR, 1]] as const) {
      const ex = sx * 0.12;
      // Big glossy chibi eyes: a dark oval with an iris-tinted lower half and two catch-lights.
      rb.add(eye, new THREE.CapsuleGeometry(0.043, 0.05, 3, 10), H(ex, R * 0.95, R * 0.89, -0.12), 0x1d1612);
      rb.add(eye, new THREE.SphereGeometry(0.03, 10, 6, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), H(ex, R * 0.95 + 0.004, R * 0.9 + 0.016, -0.35, 0, 0, 1, 1.25, 0.9), mixHex(0x1d1612, L.eyes ?? 0x3a2418, 0.75));
      rb.add(eye, new THREE.SphereGeometry(0.016, 8, 6), H(ex + 0.015, R * 0.95 + 0.028, R * 0.9 + 0.034), 0xffffff);
      rb.add(eye, new THREE.SphereGeometry(0.009, 6, 4), H(ex - 0.013, R * 0.95 - 0.022, R * 0.9 + 0.034), mixHex(0xffffff, L.eyes ?? 0x3a2418, 0.3));
    }
    // ── held props (built at the hand, in rig space)
    // Only the props this villager ever uses (schedule, rainy days, heart events, staged demos)
    // are built — hidden props still cost triangles in every pass.
    const used = usedProps(this.def);
    const addProp = (p: PropName, fn: (add: (g: THREE.BufferGeometry, m: THREE.Matrix4, c: number) => void) => void): void => {
      if (!used.has(p)) return;
      const bi = propIndex.get(p)!;
      const hand = p === 'palette' || p === 'cane' ? handL : handR;
      fn((g, m, c) => rb.add(bi, g, new THREE.Matrix4().makeTranslation(hand.x, hand.y, hand.z).multiply(m), c));
    };
    addProp('broom', (add) => {
      add(new THREE.CylinderGeometry(0.018, 0.018, 1.2, 6), M(0, -0.1, 0.05, 0.25, 0, 0), 0xb89060);
      add(new THREE.ConeGeometry(0.12, 0.28, 8), M(0, -0.68, 0.2, 0.25, 0, 0), 0xd8b060);
      add(new THREE.TorusGeometry(0.05, 0.012, 3, 8), M(0, -0.56, 0.17, Math.PI / 2 + 0.25, 0, 0), 0xc8412f);
    });
    addProp('book', (add) => {
      add(roundedBox(0.2, 0.26, 0.05, 0.015), M(-0.1 * Math.sign(handR.x), 0.02, 0.14, -0.9, 0, 0), 0x8a3a3a);
      add(roundedBox(0.18, 0.24, 0.045, 0.01), M(-0.1 * Math.sign(handR.x), 0.03, 0.16, -0.9, 0, 0), 0xf8f0dc);
    });
    addProp('hammer', (add) => {
      add(new THREE.CylinderGeometry(0.018, 0.02, 0.36, 6), M(0, -0.02, 0.1, Math.PI / 2, 0, 0), 0x8a5a32);
      add(roundedBox(0.08, 0.08, 0.18, 0.02), M(0, -0.02, 0.28, 0, 0, 0), 0x4a4a50);
    });
    addProp('can', (add) => {
      const can = new THREE.CylinderGeometry(0.09, 0.1, 0.18, 12);
      add(can, M(0, -0.1, 0.08), 0x5a9ab0);
      add(new THREE.CylinderGeometry(0.015, 0.025, 0.24, 6), M(0, -0.04, 0.24, -0.9, 0, 0), 0x5a9ab0);
      add(new THREE.TorusGeometry(0.07, 0.012, 4, 10, Math.PI), M(0, 0.0, 0.08, 0, Math.PI / 2, 0), 0x4a8aa0);
    });
    addProp('brush', (add) => {
      add(new THREE.CylinderGeometry(0.01, 0.012, 0.3, 5), M(0, 0.02, 0.1, -1.1, 0, 0), 0xc8a060);
      add(new THREE.ConeGeometry(0.018, 0.05, 5), M(0, 0.1, 0.24, -1.1 + Math.PI, 0, 0), 0xe8574a);
    });
    addProp('palette', (add) => {
      add(new THREE.CylinderGeometry(0.14, 0.14, 0.02, 14), M(0.02, 0.02, 0.1, -1.2, 0, 0), 0xd8b48a);
      const blobs = [0xe8574a, 0x4a8aa8, 0xffd166, 0x7ab05a, 0xffffff];
      blobs.forEach((c, i) => add(new THREE.SphereGeometry(0.025, 6, 4), M(0.02 + Math.cos(i * 1.2) * 0.08, 0.04 + Math.sin(i * 1.2) * 0.03, 0.12 + Math.sin(i * 1.2) * 0.07, -1.2, 0, 0), c));
    });
    addProp('saw', (add) => {
      add(roundedBox(0.05, 0.1, 0.12, 0.02), M(0, 0, 0.04), 0x8a5a32);
      add(roundedBox(0.01, 0.12, 0.5, 0.005), M(0, -0.02, 0.34), 0xc8c8cc);
    });
    addProp('rod', (add) => {
      add(new THREE.CylinderGeometry(0.012, 0.022, 1.7, 5), M(0, 0.25, 0.6, -1.05, 0, 0), 0x8a6a42);
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), M(0, -0.02, 0.1, 0, 0, Math.PI / 2), 0x3a3a3a);
    });
    addProp('cane', (add) => {
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 6), M(0, -0.3, 0.06, 0.1, 0, 0), 0x6a4a2a);
      add(new THREE.TorusGeometry(0.05, 0.02, 5, 10, Math.PI), M(0, 0.01, 0.03, 0, Math.PI / 2, 0), 0x6a4a2a);
    });
    addProp('mug', (add) => {
      add(new THREE.CylinderGeometry(0.05, 0.045, 0.1, 10), M(0, 0.02, 0.07), 0xf2ece0);
      add(new THREE.TorusGeometry(0.03, 0.01, 4, 8), M(0.05, 0.02, 0.07, 0, 0, Math.PI / 2), 0xf2ece0);
    });

    if (L.scarf === undefined && !acc.has('shawl')) {
      // A chunky knitted muffler (colour picked per villager) with a striped tail.
      const knit = [0xc8412f, 0x3f6f9a, 0xe8b04a, 0x5a8a4a, 0x8a4a8a, 0xe87a5a][(rng.next() * 6) | 0]!;
      const W = (m: THREE.Matrix4) => new THREE.Matrix4().makeTranslation(neck.x, neck.y, neck.z).multiply(m);
      rb.add(winterIdx, new THREE.TorusGeometry(0.14 * Math.max(0.9, bw * 0.9), 0.055, 8, 16), W(M(0, 0, 0.005, Math.PI / 2 - 0.18, 0, 0, 1, 1, 1)), knit);
      rb.add(winterIdx, new THREE.TorusGeometry(0.145 * Math.max(0.9, bw * 0.9), 0.02, 4, 16), W(M(0, 0.03, 0.01, Math.PI / 2 - 0.18, 0, 0)), 0xf6efe2);
      rb.add(winterIdx, new THREE.CapsuleGeometry(0.038, 0.14, 2, 6), W(M(0.08, -0.13, 0.17 * bw, 0.2, 0, 0.1, 1, 1, 0.55)), knit);
      rb.add(winterIdx, new THREE.CapsuleGeometry(0.036, 0.02, 2, 6), W(M(0.09, -0.19, 0.18 * bw, 0.2, 0, 0.1, 1.05, 1, 0.6)), 0xf6efe2);
    }
    const geo = rb.build();
    this.mesh = new THREE.SkinnedMesh(geo, sharedMat());
    this.mesh.name = 'npc-body';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.noAO = true;
    this.mesh.frustumCulled = false;
    this.mesh.add(this.bones[B.root]!);
    this.mesh.add(this.bones[B.propBase]!);
    this.mesh.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones);
    this.mesh.bind(skeleton);
    // Cull off-screen villagers (main + shadow passes): a rest-pose sphere padded for gestures / props.
    this.mesh.boundingSphere = (geo.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 1.2)).clone();
    this.mesh.boundingSphere.radius *= 1.35;
    this.mesh.frustumCulled = true;
    this.body.add(this.mesh);
    this.root.add(this.body);
    this.showProps(acc.has('cane') ? ['cane'] : []);
    this.setWinter(false);
  }

  private buildHair(rb: RigBuilder, L: NpcLook, H: (...a: number[]) => THREE.Matrix4, R: number, rng: Rng): void {
    const hair = L.hair;
    const hi = shadeHex(hair, 1.12);
    const style = L.hairStyle;
    const hatted = L.hat === 'beanie' || L.hat === 'bandana' || L.hat === 'flatcap';
    if (style !== 'bald' && style !== 'cap') {
      const cap = new THREE.SphereGeometry(R * 1.07, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
      rb.add(B.head, cap, H(0, R * 0.98, -0.02, -0.25, 0, 0), hair);
    }
    switch (style) {
      case 'bun':
        rb.add(B.hairBack, lumpySphere(0.17, 1, 0.12, rng, 2), H(0, R * 1.85, -R * 0.35), hair);
        for (const sx of [-1, 1]) rb.add(B.head, lumpySphere(0.12, 1, 0.1, rng), H(sx * R * 0.86, R * 1.0, R * 0.2, 0, 0, 0, 0.6, 1.1, 0.9), hair);
        rb.add(B.head, lumpySphere(0.2, 1, 0.1, rng, 1.4), H(0, R * 1.42, R * 0.55, 0.5, 0, 0, 1.6, 0.5, 0.7), hi);
        rb.add(B.hairBack, new THREE.TorusGeometry(0.1, 0.02, 5, 12), H(0, R * 1.72, -R * 0.3, 1.2, 0, 0), shadeHex(L.top, 0.9));
        break;
      case 'bob':
        for (let i = 0; i < 9; i++) {
          const a = Math.PI * 0.35 + (i / 8) * Math.PI * 1.3;
          rb.add(B.head, lumpySphere(0.15, 1, 0.15, rng), H(Math.sin(a) * R * 0.92, R * 0.62 + (i % 2) * 0.04, Math.cos(a) * R * 0.88), i % 3 ? hair : hi);
        }
        for (const [a, len] of [[-0.45, 1.3], [0.1, 1.15], [0.55, 1.0]] as const) {
          const lock = lumpySphere(0.15, 1, 0.08, rng, 1.2);
          lock.scale(len, 0.5, 0.6);
          rb.add(B.head, lock, H(Math.sin(a) * R * 0.72, R * 1.36, Math.cos(a) * R * 0.72, 0.6, a, 0), hi);
        }
        break;
      case 'cap': {
        // Baker's toque.
        rb.add(B.head, new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.12, 20, 1, true), H(0, R * 1.55, -0.02, -0.12, 0, 0), 0xe8e0d0);
        const puff = lumpySphere(R * 1.05, 1, 0.12, rng, 1.6);
        puff.scale(1.1, 0.55, 1.1);
        rb.add(B.head, puff, H(0, R * 1.78, -0.05, -0.15, 0, 0), 0xece6da);
        rb.add(B.head, new THREE.SphereGeometry(R * 1.02, 20, 8, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.25), H(0, R * 0.96, -0.02, -0.25, 0, 0), hair);
        for (const sx of [-1, 1]) rb.add(B.head, lumpySphere(0.1, 1, 0.12, rng), H(sx * R * 0.9, R * 0.95, R * 0.1, 0, 0, 0, 0.6, 1, 0.9), hair);
        break;
      }
      case 'curly':
        for (let i = 0; i < 26; i++) {
          const a = rng.next() * Math.PI * 2;
          const up = 0.15 + rng.next() * 1.1;
          const x = Math.cos(a) * Math.sin(up) * R * 1.12;
          const z = Math.sin(a) * Math.sin(up) * R * 1.1 - 0.02;
          const y = R * 0.95 + Math.cos(up) * R * 1.05;
          if (z > R * 0.55 && y < R * 1.35) continue;
          rb.add(B.head, lumpySphere(0.1 + rng.next() * 0.04, 1, 0.2, rng, 2.2), H(x, y, z), i % 4 ? hair : hi);
        }
        for (let i = 0; i < 8; i++) {
          const a = Math.PI * 0.55 + (i / 7) * Math.PI * 0.9;
          rb.add(B.hairBack, lumpySphere(0.11, 1, 0.22, rng, 2.2), H(Math.cos(a) * R * 0.9, R * 0.45 + (i % 2) * 0.08, -Math.abs(Math.sin(a)) * R * 0.85), hair);
        }
        break;
      case 'ponytail': {
        rb.add(B.hairBack, lumpySphere(0.08, 1, 0.1, rng), H(0, R * 1.35, -R * 0.95), shadeHex(L.top, 0.9));
        for (let i = 0; i < 4; i++) rb.add(B.hairBack, lumpySphere(0.1 - i * 0.012, 1, 0.12, rng), H(0, R * 1.2 - i * 0.12, -R * 1.05 - i * 0.03), hair);
        rb.add(B.head, lumpySphere(0.18, 1, 0.1, rng, 1.4), H(0.08, R * 1.45, R * 0.55, 0.5, 0.2, 0, 1.5, 0.5, 0.7), hi);
        break;
      }
      case 'long':
        for (const sx of [-1, 1]) {
          const side = lumpySphere(0.14, 1, 0.1, rng, 1.2);
          side.scale(0.7, 2.2, 0.9);
          rb.add(B.head, side, H(sx * R * 0.92, R * 0.55, R * 0.05), hair);
        }
        {
          const back = lumpySphere(0.3, 1, 0.08, rng, 1.2);
          back.scale(1.05, 1.8, 0.5);
          rb.add(B.hairBack, back, H(0, R * 0.5, -R * 0.75), hair);
        }
        rb.add(B.head, lumpySphere(0.2, 1, 0.1, rng, 1.4), H(-0.08, R * 1.42, R * 0.55, 0.5, -0.2, 0, 1.6, 0.5, 0.7), hi);
        break;
      case 'bald':
        for (const sx of [-1, 1]) rb.add(B.head, lumpySphere(0.12, 1, 0.12, rng), H(sx * R * 0.9, R * 0.95, -R * 0.1, 0, 0, 0, 0.6, 0.9, 1.1), hair);
        rb.add(B.head, lumpySphere(0.16, 1, 0.1, rng), H(0, R * 0.85, -R * 0.85, 0, 0, 0, 1.6, 0.8, 0.6), hair);
        break;
      case 'spiky':
        for (let i = 0; i < 11; i++) {
          const a = -1.4 + (i / 10) * 2.8;
          const tilt = 0.5 + rng.next() * 0.4;
          const cone = new THREE.ConeGeometry(0.075, 0.2 + rng.next() * 0.08, 6);
          rb.add(B.head, cone, H(Math.sin(a) * R * 0.75, R * 1.5 - Math.abs(a) * 0.05, Math.cos(a) * R * 0.45 - 0.06, tilt * Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9), i % 3 ? hair : hi);
        }
        for (let i = 0; i < 4; i++) {
          const cone = new THREE.ConeGeometry(0.07, 0.18, 6);
          rb.add(B.hairBack, cone, H(-0.15 + i * 0.1, R * 1.3, -R * 0.85, -1.1, 0, 0), hair);
        }
        break;
      case 'braids':
        for (const sx of [-1, 1]) {
          for (let i = 0; i < 6; i++) {
            rb.add(B.hairBack, lumpySphere(0.07 - i * 0.004, 1, 0.12, rng), H(sx * R * 0.55, R * 1.05 - i * 0.11, -R * 0.8 - (i < 2 ? 0 : 0.04)), i % 2 ? hair : hi);
          }
          rb.add(B.hairBack, new THREE.SphereGeometry(0.035, 6, 5), H(sx * R * 0.55, R * 1.05 - 6 * 0.11, -R * 0.84), L.hatColor ?? 0xc8412f);
        }
        break;
      case 'slick': {
        const sweep = lumpySphere(0.24, 1, 0.05, rng, 1.2);
        sweep.scale(1.35, 0.4, 1.05);
        rb.add(B.head, sweep, H(0.04, R * 1.62, R * 0.05, 0.1, 0, -0.08), hi);
        for (const sx of [-1, 1]) rb.add(B.head, lumpySphere(0.1, 1, 0.08, rng), H(sx * R * 0.92, R * 1.0, -R * 0.05, 0, 0, 0, 0.55, 1, 1), hair);
        break;
      }
      default:
        if (!hatted) for (let i = 0; i < 6; i++) {
          const a = -0.9 + i * 0.36;
          rb.add(B.head, lumpySphere(0.13, 1, 0.18, rng), H(Math.sin(a) * R * 0.8, R * 1.35, Math.cos(a) * R * 0.75), i % 2 ? hair : hi);
        }
        else for (const sx of [-1, 1]) rb.add(B.head, lumpySphere(0.1, 1, 0.12, rng), H(sx * R * 0.9, R * 0.95, R * 0.05, 0, 0, 0, 0.6, 1, 1), hair);
    }
  }

  private buildHat(rb: RigBuilder, L: NpcLook, H: (...a: number[]) => THREE.Matrix4, R: number, rng: Rng): void {
    const c = L.hatColor ?? 0x5a6a5a;
    switch (L.hat) {
      case 'flatcap': {
        const crown = new THREE.SphereGeometry(R * 1.1, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42);
        rb.add(B.head, crown, H(0, R * 1.1, -0.01, -0.12, 0, 0, 1.02, 0.7, 1.08), c);
        const brim = new THREE.CylinderGeometry(R * 0.72, R * 0.72, 0.03, 16, 1, false, -Math.PI / 2, Math.PI);
        rb.add(B.head, brim, H(0, R * 1.3, R * 0.62, 0.22, 0, 0, 1, 1, 0.55), shadeHex(c, 0.85));
        rb.add(B.head, new THREE.SphereGeometry(0.03, 6, 5), H(0, R * 1.86, 0.02), shadeHex(c, 0.8));
        break;
      }
      case 'beanie': {
        const dome = new THREE.SphereGeometry(R * 1.1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
        // Worn high and pushed back (like a woodworker's knit cap) so the brow + eyes stay clear.
        rb.add(B.head, dome, H(0, R * 1.3, -0.06, -0.34, 0, 0, 1, 1.05, 1), c);
        // Knitted beanie: a thick folded cuff (ribbed by little bumps), a slouched crown and a pom-pom.
        rb.add(B.head, bevelCylinder(R * 1.12, R * 1.14, 0.12, 0.03, 24), H(0, R * 1.4, -0.06, -0.34, 0, 0), shadeHex(c, 0.88));
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          rb.add(B.head, roundedBox(0.03, 0.1, 0.02, 0.01, 1), H(Math.sin(a) * R * 1.135, R * 1.4 + Math.cos(a) * R * 1.135 * 0.333, Math.cos(a) * R * 1.135 * 0.943 - 0.06, -0.34, a, 0), shadeHex(c, 0.8));
        }
        const pom = lumpySphere(0.075, 1, 0.22, rng, 3);
        rb.add(B.head, pom, H(-0.03, R * 2.36, -0.32), shadeHex(c, 1.08));
        break;
      }
      case 'sunhat': {
        // Brim kept modest (≈1.45 head radii) so the face still reads from the high camera.
        const brim = new THREE.CylinderGeometry(R * 1.42, R * 1.5, 0.03, 28);
        rb.add(B.head, brim, H(0, R * 1.5, -0.02, -0.26, 0, 0), c);
        const crown = new THREE.SphereGeometry(R * 1.02, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
        rb.add(B.head, crown, H(0, R * 1.44, -0.05, -0.26, 0, 0, 1, 0.8, 1), shadeHex(c, 1.04));
        rb.add(B.head, new THREE.TorusGeometry(R * 1.0, 0.03, 6, 22), H(0, R * 1.54, -0.05, Math.PI / 2 - 0.26, 0, 0), L.scarf ?? 0xa8587a);
        for (let i = 0; i < 3; i++) rb.add(B.head, lumpySphere(0.05, 0, 0.3, rng), H(R * 0.75 + i * 0.03, R * 1.62, R * 0.4 - i * 0.05), [0xff8fab, 0xffd166, 0xffffff][i]!);
        break;
      }
      case 'bandana': {
        const dome = new THREE.SphereGeometry(R * 1.1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.46);
        rb.add(B.head, dome, H(0, R * 1.0, -0.02, -0.3, 0, 0, 1.02, 1.05, 1.02), c);
        rb.add(B.hairBack, roundedBox(0.1, 0.1, 0.06, 0.04), H(0, R * 1.1, -R * 1.02), shadeHex(c, 0.9));
        for (const sx of [-1, 1]) rb.add(B.hairBack, roundedBox(0.07, 0.2, 0.03, 0.02), H(sx * 0.05, R * 0.9, -R * 1.04, 0.2, 0, sx * 0.4), shadeHex(c, 0.85));
        for (let i = 0; i < 5; i++) rb.add(B.head, new THREE.SphereGeometry(0.018, 5, 4), H(-0.2 + i * 0.1, R * 1.62 - Math.abs(i - 2) * 0.03, R * 0.6), 0xf6ecd8);
        break;
      }
    }
  }

  // ───────────────────────────────────────────── API

  setPosition(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.root.position.copy(this.position);
  }

  setFacing(f: Facing): void {
    this.targetYaw = FACING_YAW[f];
    this.yaw = this.targetYaw;
  }

  setYaw(yaw: number): void {
    this.yaw = this.targetYaw = yaw;
  }

  /** Smoothly turn towards a yaw / facing / point. */
  faceYaw(yaw: number): void {
    this.targetYaw = yaw;
  }

  facePoint(x: number, z: number): void {
    this.targetYaw = Math.atan2(x - this.position.x, z - this.position.z);
  }

  walkTo(x: number, z: number, facing: Facing | number, run = false): void {
    this.target = new THREE.Vector3(x, 0, z);
    this.arriveFacing = facing;
    this.runMul = run ? 1.7 : 1;
  }

  stop(): void {
    this.target = null;
  }

  get isMoving(): boolean {
    return this.moving;
  }

  get hasTarget(): boolean {
    return this.target !== null;
  }

  setActivity(a: Activity): void {
    if (a === this.activity) return;
    this.activity = a;
    const props = [...(ACTIVITY_PROPS[a] ?? [])];
    if (this.def.look.acc?.includes('cane') && !props.length) props.push('cane');
    this.showProps(props);
  }

  private winterBone: THREE.Bone | null = null;
  private winterOn = true;

  /** Winter knitwear on / off (the season is pushed by NpcSystem). */
  setWinter(on: boolean): void {
    if (on === this.winterOn || !this.winterBone) return;
    this.winterOn = on;
    this.winterBone.scale.setScalar(on ? 1 : 0.0001);
  }

  private showProps(list: PropName[]): void {
    for (const [p, b] of this.propBones) b.scale.setScalar(list.includes(p) ? 1 : 0.0001);
  }

  /** Play a body-language clip over the current pose (blends in / out). */
  gesture(g: Gesture, dur = 2.4): void {
    this.gest = g;
    this.gestT = 0;
    this.gestDur = dur;
  }

  /** Squash-and-stretch hit (gift received, surprise): k > 1 = bigger. */
  squash(k = 1): void {
    this.squashT = 0;
    this.squashK = k;
  }

  /** Pop an emote bubble over the head for ~2.2 s. */
  emote(e: Emote, dur = 2.4): void {
    if (!this.emoteSprite) {
      this.emoteSprite = billboard(emoteTexture(e), 20);
      this.emoteSprite.name = 'npc-emote';
      this.root.add(this.emoteSprite);
    }
    this.emoteSprite.material.map = emoteTexture(e);
    this.emoteSprite.material.needsUpdate = true;
    this.emoteSprite.visible = true;
    this.emoteT = dur;
    this.emoteDur = dur;
  }
  private emoteDur = 2.4;

  update(dt: number, heightAt: (x: number, z: number) => number, simulate: boolean): void {
    this.t += dt;
    this.moving = false;
    const W = this.walkStyle;
    const speed = this.speed * this.runMul;
    if (simulate && this.target && !this.talkTo) {
      const dx = this.target.x - this.position.x;
      const dz = this.target.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const step = Math.min(d, speed * dt);
        this.position.x += (dx / d) * step;
        this.position.z += (dz / d) * step;
        this.targetYaw = Math.atan2(dx, dz);
        this.moving = true;
      } else {
        this.target = null;
        this.runMul = 1;
        this.targetYaw = typeof this.arriveFacing === 'number' ? this.arriveFacing : FACING_YAW[this.arriveFacing];
      }
    }
    this.position.y = heightAt(this.position.x, this.position.z);
    if (this.talkTo) {
      this.targetYaw = Math.atan2(this.talkTo.x - this.position.x, this.talkTo.z - this.position.z);
      this.talkT += dt;
    } else this.talkT = 0;
    let dy = this.targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * (1 - Math.exp(-9 * dt));
    this.root.position.copy(this.position);
    this.body.rotation.y = this.yaw;

    // ── reset pose
    const bn = this.bones;
    for (let i = 0; i < bn.length; i++) {
      bn[i]!.position.copy(this.rest[i]!);
      bn[i]!.rotation.set(0, 0, 0);
    }
    bn[B.eyeL]!.scale.set(1, 1, 1);
    bn[B.eyeR]!.scale.set(1, 1, 1);
    bn[B.mouth]!.scale.set(1, 1, 1);
    const hips = bn[B.hips]!;
    const spine = bn[B.spine]!;
    const head = bn[B.head]!;
    const tL = bn[B.thighL]!;
    const tR = bn[B.thighR]!;
    const sL = bn[B.shinL]!;
    const sR = bn[B.shinR]!;
    const aL = bn[B.armL]!;
    const aR = bn[B.armR]!;
    const fL = bn[B.foreL]!;
    const fR = bn[B.foreR]!;
    aL.rotation.z = -0.12;
    aR.rotation.z = 0.12;
    fL.rotation.x = -0.15;
    fR.rotation.x = -0.15;
    spine.rotation.x = W.hunch;
    head.rotation.x = -W.hunch * 0.7;

    const act = this.moving || this.talkTo ? 'idle' : this.activity;
    const sitting = act === 'sit' && !this.moving;
    this.sitBlend += ((sitting ? 1 : 0) - this.sitBlend) * (1 - Math.exp(-8 * dt));
    this.actBlend += ((act !== 'idle' && act !== 'chat' && act !== 'wander' && act !== 'inside' ? 1 : 0) - this.actBlend) * (1 - Math.exp(-6 * dt));

    let bob = 0;
    let sy = 1;
    if (this.moving) {
      const run = this.runMul > 1;
      this.phase += dt * speed * (run ? 2.5 : 2.9) / Math.max(0.8, W.stride * 1.6);
      const s = Math.sin(this.phase);
      const c = Math.cos(this.phase);
      const stride = W.stride * (run ? 1.35 : 1);
      tL.rotation.x = s * stride;
      tR.rotation.x = -s * stride;
      // Knees bend on the passing / lifting leg.
      sL.rotation.x = Math.max(0, -Math.cos(this.phase - 0.6)) * stride * 1.3;
      sR.rotation.x = Math.max(0, Math.cos(this.phase - 0.6)) * stride * 1.3;
      aL.rotation.x = -s * W.arms * (run ? 1.5 : 1);
      aR.rotation.x = s * W.arms * (run ? 1.5 : 1);
      fL.rotation.x = -0.3 - Math.max(0, s) * W.arms * 0.8;
      fR.rotation.x = -0.3 - Math.max(0, -s) * W.arms * 0.8;
      bob = Math.abs(c) * W.bounce * (run ? 1.6 : 1);
      if (W.skip) bob += Math.max(0, Math.sin(this.phase * 0.5)) * 0.08;
      sy = 1 + (Math.abs(c) - 0.5) * 0.05;
      hips.rotation.z = s * W.sway;
      hips.rotation.y = s * W.sway * 0.8;
      spine.rotation.z = -s * W.sway * 0.8;
      spine.rotation.y = -s * W.sway * 1.2;
      spine.rotation.x = W.hunch + (run ? 0.18 : 0.04);
      head.rotation.x = -W.hunch * 0.7 - (run ? 0.1 : 0);
      if (this.def.look.acc?.includes('cane')) {
        aL.rotation.x = -0.35 + s * 0.2;
        fL.rotation.x = -0.4;
      }
    } else {
      const br = Math.sin(this.t * 2.0);
      sy = 1 + br * 0.016;
      const shift = Math.sin(this.t * 0.5);
      hips.rotation.z = shift * 0.03;
      spine.rotation.z = -shift * 0.04;
      aL.rotation.z = -0.12 - br * 0.02;
      aR.rotation.z = 0.12 + br * 0.02;
      if (this.talkTo) {
        head.rotation.x += Math.sin(this.talkT * 6) * 0.06;
        head.rotation.z = Math.sin(this.talkT * 2.3) * 0.05;
        aR.rotation.x = -0.7 + Math.sin(this.talkT * 3.1) * 0.25;
        aR.rotation.z = 0.35;
        fR.rotation.x = -0.9 + Math.sin(this.talkT * 3.1 + 0.5) * 0.3;
      } else {
        this.lookT -= dt;
        if (this.lookT <= 0) {
          this.lookTarget = this.lookTarget !== 0 ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.4);
          this.lookT = this.lookTarget !== 0 ? 1.2 + Math.random() : 3 + Math.random() * 4;
        }
        this.look += (this.lookTarget - this.look) * (1 - Math.exp(-dt * 4));
        if (act === 'idle' || act === 'wander' || act === 'chat') head.rotation.y = this.look;
        head.rotation.x += Math.sin(this.t * 0.8) * 0.02;
        this.animateActivity(act, dt);
        if (this.def.look.acc?.includes('cane') && act === 'idle') {
          aL.rotation.x = -0.3;
          fL.rotation.x = -0.35;
        }
      }
    }
    // Sitting: fold the legs, lower the hips onto the seat.
    if (this.sitBlend > 0.001) {
      const k = this.sitBlend;
      tL.rotation.x = THREE.MathUtils.lerp(tL.rotation.x, -1.45, k);
      tR.rotation.x = THREE.MathUtils.lerp(tR.rotation.x, -1.4, k);
      sL.rotation.x = THREE.MathUtils.lerp(sL.rotation.x, 1.45, k);
      sR.rotation.x = THREE.MathUtils.lerp(sR.rotation.x, 1.4, k);
      hips.position.y = THREE.MathUtils.lerp(this.hipY, 0.47 / this.scaleS, k);
      hips.position.z -= 0.1 * k;
      aL.rotation.x = THREE.MathUtils.lerp(aL.rotation.x, -0.5, k);
      aR.rotation.x = THREE.MathUtils.lerp(aR.rotation.x, -0.5, k);
      fL.rotation.x = THREE.MathUtils.lerp(fL.rotation.x, -0.5, k);
      fR.rotation.x = THREE.MathUtils.lerp(fR.rotation.x, -0.5, k);
    }
    // Body language on top of everything (conversations, heart events).
    if (this.gest) {
      this.gestT += dt;
      if (this.gestT >= this.gestDur) this.gest = null;
      else {
        const w = Math.min(1, this.gestT / 0.22) * Math.min(1, (this.gestDur - this.gestT) / 0.4);
        this.applyGesture(this.gest, w * w * (3 - 2 * w), this.gestT);
      }
    }
    // Chin up towards the high camera so faces read.
    head.rotation.x -= FACE_UP;
    // Secondary motion: hair / braids lag behind head + body motion.
    const drive = (this.moving ? Math.sin(this.phase) * 0.12 : 0) - dy * 0.6;
    this.hairVel += (drive - this.hairSwing) * 40 * dt;
    this.hairVel *= Math.exp(-6 * dt);
    this.hairSwing += this.hairVel * dt;
    bn[B.hairBack]!.rotation.z = this.hairSwing;
    bn[B.hairBack]!.rotation.x = (this.moving ? 0.12 : 0) + Math.sin(this.t * 1.3) * 0.02;
    // Blink + talk.
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blinkT = 0.13;
      this.nextBlink = 2.2 + Math.random() * 3.2;
    }
    this.blinkT -= dt;
    const eyeS = this.blinkT > 0 ? 0.12 : act === 'read' ? 0.55 : 1;
    bn[B.eyeL]!.scale.y = eyeS;
    bn[B.eyeR]!.scale.y = eyeS;
    if (this.speaking) {
      const flap = 0.5 + 0.5 * Math.abs(Math.sin(this.t * 17)) * (0.6 + 0.4 * Math.sin(this.t * 5.3));
      bn[B.mouth]!.scale.set(1 - flap * 0.2, 1 + flap * 1.6, 1);
    }
    this.body.position.y = bob + this.hop;
    this.hop = 0;
    // Sit on the front of the seat, not inside the backrest.
    if (this.sitBlend > 0.001) {
      this.root.position.x += Math.sin(this.yaw) * 0.14 * this.sitBlend;
      this.root.position.z += Math.cos(this.yaw) * 0.14 * this.sitBlend;
    }
    if (this.squashT >= 0) {
      // 0–0.1 s squash, 0.1–0.3 s stretch, then a damped settle.
      const t = (this.squashT += dt);
      const k = this.squashK;
      const q = t < 0.1 ? -0.16 * Math.sin((t / 0.1) * Math.PI * 0.5) : t < 0.3 ? -0.16 + 0.26 * Math.sin(((t - 0.1) / 0.2) * Math.PI * 0.5) : 0.1 * Math.exp(-(t - 0.3) * 9) * Math.cos((t - 0.3) * 22);
      sy *= 1 + q * k;
      if (t > 0.3) this.body.position.y += Math.max(0, Math.sin(((t - 0.3) / 0.25) * Math.PI)) * 0.07 * k * (t < 0.55 ? 1 : 0);
      if (t > 0.8) this.squashT = -1;
    }
    const S = this.scaleS;
    this.body.scale.set(S / Math.sqrt(sy), S * sy, S / Math.sqrt(sy));
    // Emote bubble: pop in, bob, fade.
    if (this.emoteSprite && this.emoteSprite.visible) {
      this.emoteT -= dt;
      const age = this.emoteDur - this.emoteT;
      const pop = age < 0.25 ? THREE.MathUtils.smoothstep(age, 0, 0.18) * (1 + 0.25 * Math.sin((age / 0.25) * Math.PI)) : 1;
      const fade = THREE.MathUtils.clamp(this.emoteT / 0.3, 0, 1);
      const s = 0.62 * pop;
      this.emoteSprite.scale.set(s, s, 1);
      this.emoteSprite.position.set(0, this.headTop + 0.42 + Math.sin(age * 3) * 0.04, 0);
      this.emoteSprite.material.opacity = fade;
      if (this.emoteT <= 0) this.emoteSprite.visible = false;
    }
  }

  /** Gesture poses, blended by w over whatever the base pose is this frame. */
  private applyGesture(g: Gesture, w: number, t: number): void {
    const bn = this.bones;
    const L = THREE.MathUtils.lerp;
    const head = bn[B.head]!;
    const spine = bn[B.spine]!;
    const aL = bn[B.armL]!;
    const aR = bn[B.armR]!;
    const fL = bn[B.foreL]!;
    const fR = bn[B.foreR]!;
    const set = (b: THREE.Bone, x?: number, y?: number, z?: number): void => {
      if (x !== undefined) b.rotation.x = L(b.rotation.x, x, w);
      if (y !== undefined) b.rotation.y = L(b.rotation.y, y, w);
      if (z !== undefined) b.rotation.z = L(b.rotation.z, z, w);
    };
    switch (g) {
      case 'chest': // hand on heart, head tipped
        set(aR, -0.85, 0, -0.5);
        set(fR, -1.55);
        set(aL, -0.15, 0, -0.1);
        head.rotation.z += 0.14 * w;
        head.rotation.x += 0.08 * w;
        break;
      case 'shrug':
        set(aL, -0.35, 0, -0.6);
        set(aR, -0.35, 0, 0.6);
        set(fL, -1.1);
        set(fR, -1.1);
        aL.position.y += 0.035 * w;
        aR.position.y += 0.035 * w;
        head.rotation.z += 0.16 * w;
        break;
      case 'laugh': {
        const b = Math.abs(Math.sin(t * 13));
        head.rotation.x -= (0.28 + b * 0.06) * w;
        spine.rotation.x -= 0.1 * w;
        set(aR, -0.45, 0, -0.2);
        set(fR, -1.35);
        set(aL, -0.3, 0, -0.35);
        set(fL, -0.9);
        this.hop += b * 0.035 * w;
        break;
      }
      case 'lookdown':
        head.rotation.x += 0.42 * w;
        spine.rotation.x += 0.14 * w;
        set(aL, 0.05, 0, -0.04);
        set(aR, 0.05, 0, 0.04);
        set(fL, -0.25);
        set(fR, -0.25);
        aL.position.y -= 0.03 * w;
        aR.position.y -= 0.03 * w;
        break;
      case 'point':
        set(aR, -1.45, 0, 0.12);
        set(fR, -0.12);
        head.rotation.x -= 0.06 * w;
        break;
      case 'wave':
        set(aR, -0.2, 0, 2.5);
        set(fR, 0, 0, 0.35 * Math.sin(t * 11));
        break;
      case 'think':
        set(aR, -0.55, 0, -0.3);
        set(fR, -2.25);
        set(aL, -0.55, 0, 0.4);
        set(fL, -1.3);
        head.rotation.z += 0.15 * w;
        head.rotation.y += 0.22 * w;
        head.rotation.x -= 0.1 * w;
        break;
      case 'wring': {
        const j = Math.sin(t * 9) * 0.06;
        set(aL, -0.62 + j, 0, 0.32);
        set(aR, -0.62 - j, 0, -0.32);
        set(fL, -1.15);
        set(fR, -1.15);
        head.rotation.x += 0.12 * w;
        head.rotation.y += Math.sin(t * 2.4) * 0.15 * w;
        break;
      }
      case 'surprise': {
        const hopT = Math.min(1, t / 0.32);
        this.hop += Math.sin(hopT * Math.PI) * 0.11 * w;
        set(aL, -0.4, 0, -0.95);
        set(aR, -0.4, 0, 0.95);
        set(fL, -1.25);
        set(fR, -1.25);
        head.rotation.x -= 0.16 * w;
        spine.rotation.x -= 0.12 * w;
        break;
      }
      case 'angry': {
        const stamp = t < 0.35 ? Math.sin((t / 0.35) * Math.PI) : 0;
        this.hop += stamp * 0.05 * w;
        set(aL, 0.28, 0, -0.22);
        set(aR, 0.28, 0, 0.22);
        set(fL, -0.55);
        set(fR, -0.55);
        spine.rotation.x += 0.16 * w;
        head.rotation.x += 0.1 * w;
        head.rotation.y += Math.sin(t * 7) * 0.06 * w;
        break;
      }
      case 'nod':
        head.rotation.x += (t < 1.2 ? Math.sin(t * 8) * 0.14 : 0) * w;
        break;
      case 'open':
        set(aL, -0.55, 0, -0.5);
        set(aR, -0.55, 0, 0.5);
        set(fL, -0.65);
        set(fR, -0.65);
        head.rotation.z += 0.08 * w;
        this.hop += Math.max(0, Math.sin(t * 7)) * 0.02 * w * (t < 0.9 ? 1 : 0);
        break;
      case 'hug':
        set(aL, -1.3, 0, 0.3);
        set(aR, -1.3, 0, -0.3);
        set(fL, -0.8);
        set(fR, -0.8);
        spine.rotation.x += 0.1 * w;
        break;
    }
  }

  /** Procedural activity loops (standing still). */
  private animateActivity(act: Activity, _dt: number): void {
    const bn = this.bones;
    const t = this.t;
    const k = this.actBlend;
    const spine = bn[B.spine]!;
    const head = bn[B.head]!;
    const aL = bn[B.armL]!;
    const aR = bn[B.armR]!;
    const fL = bn[B.foreL]!;
    const fR = bn[B.foreR]!;
    const tL = bn[B.thighL]!;
    const tR = bn[B.thighR]!;
    const lerp = THREE.MathUtils.lerp;
    switch (act) {
      case 'sweep': {
        const s = Math.sin(t * 3.2);
        spine.rotation.y = s * 0.25 * k;
        spine.rotation.x += 0.2 * k;
        aR.rotation.x = lerp(0, -0.55 + s * 0.2, k);
        aR.rotation.z = lerp(0.12, 0.35, k);
        fR.rotation.x = lerp(-0.15, -0.5, k);
        aL.rotation.x = lerp(0, -0.9 + s * 0.2, k);
        aL.rotation.z = lerp(-0.12, 0.45, k);
        fL.rotation.x = lerp(-0.15, -0.6, k);
        head.rotation.x += 0.25 * k;
        break;
      }
      case 'read': {
        const turn = Math.max(0, Math.sin(t * 0.45) - 0.93) * 12;
        aR.rotation.x = lerp(0, -0.55, k);
        aR.rotation.z = lerp(0.12, -0.15, k);
        fR.rotation.x = lerp(-0.15, -1.25, k);
        aL.rotation.x = lerp(0, -0.55 - turn * 0.2, k);
        aL.rotation.z = lerp(-0.12, 0.25, k);
        fL.rotation.x = lerp(-0.15, -1.2, k);
        head.rotation.x += 0.35 * k;
        head.rotation.y = Math.sin(t * 1.4) * 0.06 * k;
        break;
      }
      case 'hammer': {
        // Anticipation → strike → rebound, every 1.1 s.
        const c = (t % 1.1) / 1.1;
        const raise = c < 0.55 ? THREE.MathUtils.smoothstep(c, 0, 0.55) : c < 0.66 ? 1 - THREE.MathUtils.smoothstep(c, 0.55, 0.66) : 0.08 * Math.sin((c - 0.66) * 20) * (1 - c);
        aR.rotation.x = lerp(0, -0.35 - raise * 1.9, k);
        fR.rotation.x = lerp(-0.15, -0.6 - raise * 0.7, k);
        spine.rotation.x += (0.18 - raise * 0.12) * k;
        aL.rotation.x = lerp(0, -0.7, k);
        fL.rotation.x = lerp(-0.15, -0.9, k);
        head.rotation.x += 0.3 * k;
        break;
      }
      case 'water': {
        const tilt = 0.5 + Math.sin(t * 1.3) * 0.12;
        aR.rotation.x = lerp(0, -0.75, k);
        fR.rotation.x = lerp(-0.15, -0.25, k);
        fR.rotation.z = lerp(0, tilt, k);
        spine.rotation.x += 0.15 * k;
        head.rotation.x += 0.3 * k;
        break;
      }
      case 'paint': {
        const dab = Math.max(0, Math.sin(t * 2.6)) ** 3;
        aR.rotation.x = lerp(0, -1.1 - dab * 0.25, k);
        aR.rotation.z = lerp(0.12, 0.2, k);
        fR.rotation.x = lerp(-0.15, -0.45 + dab * 0.2, k);
        aL.rotation.x = lerp(0, -0.6, k);
        aL.rotation.z = lerp(-0.12, -0.3, k);
        fL.rotation.x = lerp(-0.15, -1.0, k);
        head.rotation.z = Math.sin(t * 0.7) * 0.1 * k;
        head.rotation.x += (Math.sin(t * 0.3) > 0.6 ? -0.08 : 0.06) * k;
        break;
      }
      case 'knead': {
        const p = Math.sin(t * 3.4);
        aL.rotation.x = lerp(0, -0.8 + p * 0.3, k);
        aR.rotation.x = lerp(0, -0.8 - p * 0.3, k);
        fL.rotation.x = lerp(-0.15, -0.7, k);
        fR.rotation.x = lerp(-0.15, -0.7, k);
        spine.rotation.x += (0.22 + Math.abs(p) * 0.06) * k;
        head.rotation.x += 0.2 * k;
        break;
      }
      case 'saw': {
        const p = Math.sin(t * 5.2);
        spine.rotation.x += 0.38 * k;
        aR.rotation.x = lerp(0, -0.9 + p * 0.35, k);
        fR.rotation.x = lerp(-0.15, -0.35 - p * 0.3, k);
        aL.rotation.x = lerp(0, -0.9, k);
        aL.rotation.z = lerp(-0.12, 0.2, k);
        fL.rotation.x = lerp(-0.15, -0.5, k);
        tL.rotation.x = -0.25 * k;
        tR.rotation.x = 0.15 * k;
        head.rotation.x += 0.2 * k;
        break;
      }
      case 'fish': {
        const bobble = Math.sin(t * 1.1) * 0.04 + (Math.sin(t * 0.37) > 0.97 ? Math.sin(t * 25) * 0.08 : 0);
        aR.rotation.x = lerp(0, -0.7 + bobble, k);
        fR.rotation.x = lerp(-0.15, -0.5, k);
        aL.rotation.x = lerp(0, -0.6 + bobble, k);
        aL.rotation.z = lerp(-0.12, 0.35, k);
        fL.rotation.x = lerp(-0.15, -0.8, k);
        break;
      }
      case 'lean': {
        spine.rotation.x += 0.35 * k;
        aL.rotation.x = lerp(0, -1.2, k);
        aR.rotation.x = lerp(0, -1.2, k);
        aL.rotation.z = lerp(-0.12, 0.3, k);
        aR.rotation.z = lerp(0.12, -0.3, k);
        fL.rotation.x = lerp(-0.15, -1.1, k);
        fR.rotation.x = lerp(-0.15, -1.1, k);
        tR.rotation.x = 0.12 * k;
        head.rotation.x += -0.2 * k + Math.sin(t * 0.4) * 0.05;
        head.rotation.y = Math.sin(t * 0.25) * 0.3 * k;
        break;
      }
      case 'play': {
        // Hop on the spot between laps.
        const h = Math.max(0, Math.sin(t * 5));
        this.hop = h * 0.12;
        aL.rotation.z = -0.4 - h * 1.2;
        aR.rotation.z = 0.4 + h * 1.2;
        break;
      }
      case 'sit': {
        // Hands in the lap, a slow look around.
        head.rotation.y = Math.sin(t * 0.3) * 0.35;
        break;
      }
      default:
        break;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.skeleton.dispose();
  }
}

/**
 * A chubby orange cat (heart-event actor, e.g. Pip on the notice-board roof): one merged mesh in
 * the villager material, curled up asleep or sitting.
 */
export function buildCat(pose: 'sit' | 'curl' = 'sit', color = 0xe8903e): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, m: THREE.Matrix4, c: number): void => {
    const gg = (g.index ? g.toNonIndexed() : g.clone()) as THREE.BufferGeometry;
    for (const k of Object.keys(gg.attributes)) if (k !== 'position' && k !== 'normal') gg.deleteAttribute(k);
    gg.applyMatrix4(m);
    const n = gg.attributes.position!.count;
    const col = new Float32Array(n * 3);
    const cc = new THREE.Color(c);
    for (let i = 0; i < n; i++) {
      const y = gg.attributes.position!.getY(i);
      const a = 0.78 + 0.22 * THREE.MathUtils.smoothstep(y, 0, 0.25);
      col[i * 3] = cc.r * a;
      col[i * 3 + 1] = cc.g * a;
      col[i * 3 + 2] = cc.b * a;
    }
    gg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(gg);
    g.dispose();
  };
  const light = shadeHex(color, 1.25);
  const dark = shadeHex(color, 0.72);
  if (pose === 'curl') {
    add(new THREE.SphereGeometry(0.2, 16, 10), M(0, 0.12, 0, 0, 0, 0, 1.25, 0.62, 1), color);
    add(new THREE.SphereGeometry(0.13, 14, 10), M(0.17, 0.16, 0.06, 0, 0, 0, 1, 0.9, 1), color);
  } else {
    add(new THREE.SphereGeometry(0.18, 16, 10), M(0, 0.17, 0, 0, 0, 0, 1, 1.05, 1.2), color);
    add(new THREE.SphereGeometry(0.1, 12, 8), M(0, 0.12, 0.13, 0, 0, 0, 1, 0.9, 0.8), light);
    add(new THREE.SphereGeometry(0.14, 16, 10), M(0, 0.4, 0.08), color);
    for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.045, 8, 6), M(sx * 0.07, 0.03, 0.17, 0, 0, 0, 1, 0.7, 1.3), light);
  }
  const hx = pose === 'curl' ? 0.17 : 0;
  const hy = pose === 'curl' ? 0.16 : 0.4;
  const hz = pose === 'curl' ? 0.06 : 0.08;
  for (const sx of [-1, 1]) {
    add(new THREE.ConeGeometry(0.05, 0.1, 4), M(hx + sx * 0.075, hy + 0.12, hz - 0.01, 0, Math.PI / 4, sx * -0.25), color);
    add(new THREE.ConeGeometry(0.028, 0.06, 4), M(hx + sx * 0.075, hy + 0.115, hz + 0.012, 0, Math.PI / 4, sx * -0.25), 0xf2a0a0);
    // Stripes.
    add(new THREE.TorusGeometry(0.12, 0.012, 4, 10, Math.PI * 0.6), M(hx, hy + 0.02 + sx * 0.03, hz - 0.02, 0, Math.PI / 2, Math.PI * 0.2), dark);
    // Eyes: happy closed arcs when curled, open when sitting.
    if (pose === 'curl') add(new THREE.TorusGeometry(0.018, 0.006, 3, 6, Math.PI), M(hx + 0.1, hy + 0.01, hz + sx * 0.04, 0, Math.PI / 2, Math.PI), 0x2a1a12);
    else add(new THREE.SphereGeometry(0.022, 6, 5), M(sx * 0.05, hy + 0.02, hz + 0.12, 0, 0, 0, 0.8, 1.2, 0.6), 0x2a1a12);
  }
  if (pose !== 'curl') add(new THREE.SphereGeometry(0.02, 6, 4), M(0, hy - 0.03, hz + 0.135), 0xe86a6a);
  // Tail curling round.
  const tail = new THREE.TorusGeometry(0.17, 0.035, 6, 14, Math.PI * 1.1);
  add(tail, pose === 'curl' ? M(-0.02, 0.07, 0.02, Math.PI / 2, 0, 0.6) : M(0, 0.05, -0.02, Math.PI / 2, 0, Math.PI * 0.9), dark);
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  mesh.castShadow = true;
  mesh.name = 'npc-cat';
  return mesh;
}

const _bbQ = new THREE.Quaternion();
const _bbZ = new THREE.Vector3(0, 0, 1);
const BB_GEO = new THREE.PlaneGeometry(1, 1);
/**
 * A camera-facing quad (a Mesh, not a Sprite, so the AO G-buffer pass skips it via `noAO` instead of
 * stamping a dark square under it). `userData.rot` spins it in screen space.
 */
function billboard(tex: THREE.Texture, renderOrder: number): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const m = new THREE.Mesh(BB_GEO, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
  m.renderOrder = renderOrder;
  m.userData.noAO = true;
  m.castShadow = m.receiveShadow = false;
  m.frustumCulled = false;
  m.onBeforeRender = (_r, _s, cam) => {
    m.quaternion.copy(cam.quaternion);
    const rot = (m.userData.rot as number | undefined) ?? 0;
    if (rot) m.quaternion.multiply(_bbQ.setFromAxisAngle(_bbZ, rot));
    m.updateMatrixWorld();
  };
  return m;
}

/** Shared canvas textures for the reaction particles. */
const FX_TEX = new Map<string, THREE.Texture>();
function fxTexture(kind: 'heart' | 'puff' | 'drop' | 'spark'): THREE.Texture {
  let t = FX_TEX.get(kind);
  if (t) return t;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const cx = S / 2;
  if (kind === 'heart') {
    g.fillStyle = '#ff5a5a';
    g.strokeStyle = '#a8282a';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, 54);
    g.bezierCurveTo(4, 30, 12, 6, cx, 20);
    g.bezierCurveTo(52, 6, 60, 30, cx, 54);
    g.fill();
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.beginPath();
    g.ellipse(20, 22, 6, 4, -0.6, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'puff') {
    const gr = g.createRadialGradient(cx, cx, 2, cx, cx, 30);
    gr.addColorStop(0, 'rgba(160,160,170,0.9)');
    gr.addColorStop(1, 'rgba(160,160,170,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  } else if (kind === 'drop') {
    g.fillStyle = '#7ac4f0';
    g.strokeStyle = '#3a78a8';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, 6);
    g.quadraticCurveTo(54, 40, cx, 58);
    g.quadraticCurveTo(10, 40, cx, 6);
    g.fill();
    g.stroke();
  } else {
    g.fillStyle = '#fff4c0';
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 ? 9 : 28;
      g.lineTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r);
    }
    g.fill();
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  FX_TEX.set(kind, t);
  return t;
}

/**
 * Reaction particles over a villager's head (gift reactions, heart-event beats): a small pool of
 * billboards — hearts that pop and float up for a loved gift, sparkles for a liked one, a grey puff
 * and sweat drops for a disliked one — plus a tossed item that arcs from the farmer's hand.
 */
export class ReactionFx {
  readonly group = new THREE.Group();
  private parts: { s: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; v: THREE.Vector3; life: number; age: number; size: number; spin: number; g: number }[] = [];
  private toss: { s: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; done: () => void } | null = null;
  constructor() {
    this.group.name = 'npc-reaction-fx';
    this.group.userData.noAO = true;
    this.group.userData.perfTag = 'npcs';
  }

  private sprite(tex: THREE.Texture): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    const s = billboard(tex, 22);
    this.group.add(s);
    return s;
  }

  burst(at: THREE.Vector3, kind: 'love' | 'like' | 'neutral' | 'dislike'): void {
    const spec = kind === 'love' ? { tex: 'heart', n: 9, size: 0.34, sp: 1.5 } : kind === 'like' ? { tex: 'heart', n: 5, size: 0.26, sp: 1.1 } : kind === 'neutral' ? { tex: 'spark', n: 4, size: 0.22, sp: 0.9 } : { tex: 'puff', n: 5, size: 0.5, sp: 0.5 };
    for (let i = 0; i < spec.n; i++) {
      const s = this.sprite(fxTexture(spec.tex as 'heart'));
      const a = (i / spec.n) * Math.PI * 2 + Math.random() * 0.5;
      const v = new THREE.Vector3(Math.cos(a) * spec.sp * 0.6, 1.2 + Math.random() * spec.sp, Math.sin(a) * spec.sp * 0.35);
      s.position.copy(at);
      this.parts.push({ s, v, life: 1.3 + Math.random() * 0.5, age: -i * 0.035, size: spec.size * (0.8 + Math.random() * 0.4), spin: (Math.random() - 0.5) * 2, g: kind === 'dislike' ? -0.4 : 0.9 });
    }
    if (kind === 'dislike')
      for (let i = 0; i < 2; i++) {
        const s = this.sprite(fxTexture('drop'));
        s.position.copy(at).add(new THREE.Vector3(i ? 0.28 : -0.24, 0.1, 0));
        this.parts.push({ s, v: new THREE.Vector3(i ? 0.5 : -0.5, 0.6, 0), life: 0.9, age: -0.1, size: 0.18, spin: 0, g: 2.6 });
      }
  }

  /** Arc an item icon (data URL) from → to over `dur` s, then call done. */
  tossItem(url: string, from: THREE.Vector3, to: THREE.Vector3, done: () => void, dur = 0.38): void {
    const tex = new THREE.TextureLoader().load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (this.toss) {
      this.toss.s.removeFromParent();
      this.toss.s.material.dispose();
      this.toss.done();
    }
    const s = this.sprite(tex);
    s.scale.setScalar(0.42);
    s.position.copy(from);
    this.toss = { s, from: from.clone(), to: to.clone(), t: 0, dur, done };
  }

  update(dt: number): void {
    if (this.toss) {
      const k = this.toss;
      k.t += dt;
      const u = Math.min(1, k.t / k.dur);
      k.s.position.lerpVectors(k.from, k.to, u);
      k.s.position.y += Math.sin(u * Math.PI) * 0.75;
      k.s.userData.rot = u * 5;
      k.s.scale.setScalar(0.42 * (1 - 0.35 * u));
      if (u >= 1) {
        k.s.removeFromParent();
        k.s.material.map?.dispose();
        k.s.material.dispose();
        this.toss = null;
        k.done();
      }
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]!;
      p.age += dt;
      if (p.age < 0) {
        p.s.visible = false;
        continue;
      }
      p.s.visible = true;
      const u = p.age / p.life;
      p.v.y -= p.g * dt;
      p.v.x *= Math.exp(-2 * dt);
      p.v.z *= Math.exp(-2 * dt);
      p.s.position.addScaledVector(p.v, dt);
      const pop = u < 0.15 ? THREE.MathUtils.smoothstep(u, 0, 0.1) * (1 + 0.4 * Math.sin((u / 0.15) * Math.PI)) : 1;
      p.s.scale.setScalar(p.size * pop * (1 + u * 0.3));
      p.s.userData.rot = Math.sin(p.age * 5) * 0.25 + p.spin * p.age;
      p.s.material.opacity = 1 - THREE.MathUtils.smoothstep(u, 0.65, 1);
      if (u >= 1) {
        p.s.removeFromParent();
        p.s.material.dispose();
        this.parts.splice(i, 1);
      }
    }
  }
}
