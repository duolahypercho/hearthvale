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
import { roundedBox, lumpySphere, bevelCylinder, smoothNormals } from '../world/geom';
import { applyWorldFx } from '../render/worldfx';
import { globalUniforms } from '../render/uniforms';
import { patchMaterial, after, before } from '../render/patch';
import { Rng } from '../core/rng';

let shared: THREE.MeshStandardMaterial | null = null;
/** Night-scene face fill strength for every villager (0 = off; NpcSystem eases it in during night talks / events). */
export const VILLAGER_FILL = { value: 0 };
function sharedMat(): THREE.MeshStandardMaterial {
  if (!shared) {
    shared = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    shared.name = 'villager';
    applyWorldFx(shared, { snow: false, clouds: true, wet: true });
    // Ink edge + warm rim: silhouettes darken towards grazing angles (a free, pass-less outline that
    // separates the chibi bodies from the cobbles) and pick up a soft sky-lit rim on top.
    patchMaterial(shared, 'villager-ink', (shader) => {
      shader.uniforms.uHvFill = VILLAGER_FILL;
      shader.fragmentShader = before(shader.fragmentShader, 'void main() {', 'uniform float uHvFill;');
      shader.fragmentShader = after(
        shader.fragmentShader,
        '#include <opaque_fragment>',
        /* glsl */ `{
          float hvNdV = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
          // Night scene face fill (a soft lens-side bounce, NpcSystem drives uHvFill during night talks /
          // heart events): albedo-relative, so skin tones keep their colour, and darker albedo (deep skin
          // tones, dark wool) gets more of it — faces read at night instead of crushing to black.
          if (uHvFill > 0.001) {
            float hvLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            float hvLift = uHvFill * (1.0 + 0.7 * (1.0 - smoothstep(0.03, 0.4, hvLum)));
            gl_FragColor.rgb += diffuseColor.rgb * hvLift * (0.3 + 0.7 * hvNdV);
          }
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
export const MOOD_GESTURE: Record<string, Gesture> = { happy: 'open', laugh: 'laugh', sad: 'lookdown', angry: 'angry', surprised: 'surprise', blush: 'chest', worried: 'wring', thinking: 'think', neutral: 'nod', wistful: 'chest' };

const FACING_YAW: Record<Facing, number> = { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };
const DEFAULT_WALK: WalkStyle = { speed: 1.55, stride: 0.55, bounce: 0.045, sway: 0.06, hunch: 0, arms: 0.45 };

type PropName = 'broom' | 'book' | 'hammer' | 'can' | 'brush' | 'palette' | 'saw' | 'rod' | 'cane' | 'mug' | 'umbrella';
const PROPS: PropName[] = ['broom', 'book', 'hammer', 'can', 'brush', 'palette', 'saw', 'rod', 'cane', 'mug', 'umbrella'];
/** Activities that leave a hand free for an umbrella in the rain. */
const UMBRELLA_OK = new Set<Activity>(['idle', 'chat', 'wander', 'read', 'lean', 'play', 'sit', 'inside']);
/** Umbrella canopy colours (picked per villager). */
const UMBRELLAS = [0xc8412f, 0x3f6f9a, 0xe8b04a, 0x5a8a4a, 0x8a4a8a, 0xe87a5a, 0x2f8f8a, 0xf2e6d0];
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
  // Anyone who is ever outdoors on a rainy day carries an umbrella (it is only built for them).
  const wet = def.rainSchedule ?? def.schedule;
  if (wet.some((s) => s[2] !== 'inside')) out.add('umbrella');
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

/**
 * A sculpted hair shell instead of a smooth dome: `grooves` locks run from the crown down to the
 * hem (a gentle twist, a wobble so they're not machine-even), the hem breaks into lock tips
 * (`scallop` rad of extra length on each ridge) and a per-vertex tone darkens the grooves and lifts
 * the ridges — reads as combed, clumped hair (chibi figurine style), not a plastic helmet.
 * Seam at the back; azimuth 0 = the face.
 */
function hairShell(r: number, thetaStart: number, thetaLen: number, grooves: number, depth: number, scallop: number, seed = 0, twist = 0.9): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, Math.max(24, grooves * 4), 14, 0, Math.PI * 2, thetaStart, thetaLen);
  g.rotateY(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const shade = new Float32Array(pos.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const th = Math.acos(THREE.MathUtils.clamp(v.y / r, -1, 1));
    const az = Math.atan2(v.x, v.z);
    const t = thetaLen > 0 ? THREE.MathUtils.clamp((th - thetaStart) / thetaLen, 0, 1) : 0;
    const crown = THREE.MathUtils.smoothstep(th, 0.04, 0.5);
    const ph = az * grooves + Math.sin(az * 3 + seed) * 0.55 + Math.sin(az * 5 - seed * 1.7) * 0.25 + t * twist;
    const ridge = 0.5 + 0.5 * Math.cos(ph);
    const rr = r * (1 + depth * crown * (ridge * ridge - 0.35));
    // Temples lifted (r7 portrait gate: in the three-quarter bust the hem at ±70° hung over the far eye).
    const temple = Math.exp(-(((Math.abs(az) - 1.2) / 0.45) ** 2)) * THREE.MathUtils.smoothstep(t, 0.45, 1);
    const th2 = th + scallop * THREE.MathUtils.smoothstep(t, 0.55, 1) * Math.pow(ridge, 1.6) - temple * Math.PI * 0.075;
    v.set(rr * Math.sin(th2) * Math.sin(az), rr * Math.cos(th2), rr * Math.sin(th2) * Math.cos(az));
    pos.setXYZ(i, v.x, v.y, v.z);
    // An anisotropic sheen ring across the crown, broken up by the locks (brightest on the ridges).
    const sheen = Math.exp(-(((th - 0.7) / 0.1) ** 2)) * Math.abs(Math.cos(az * 0.5)) ** 0.6;
    shade[i] = 0.8 + 0.3 * (crown * ridge + (1 - crown) * 0.7) - 0.06 * t + sheen * ridge * 0.28;
  }
  g.computeVertexNormals();
  g.setAttribute('shade', new THREE.BufferAttribute(shade, 1));
  return g;
}

/** Radial pleats / gathers around Y (a baker's toque band, a knotted scarf's folds). */
function pleat(g: THREE.BufferGeometry, n: number, depth: number): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const shade = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const c = Math.cos(Math.atan2(x, z) * n);
    const k = 1 + depth * c;
    pos.setXYZ(i, x * k, pos.getY(i), z * k);
    shade[i] = 0.9 + 0.1 * c;
  }
  if (g.index) g.computeVertexNormals();
  else smoothNormals(g);
  g.setAttribute('shade', new THREE.BufferAttribute(shade, 1));
  return g;
}

/** Collects parts weighted to single bones and merges them into one skinned geometry. */
class RigBuilder {
  private parts: THREE.BufferGeometry[] = [];
  /**
   * Material part id written per vertex (attribute 'part', read only by the portrait's painted pass):
   * 0 = auto (skin colour → 1, the eye ink → 3, else 4 cloth), 2 = hair / brows, 5 = hat, 6 = beard / moustache.
   */
  tag = 0;
  skin = -1;
  /**
   * Body-proportion warp (rig space, per bone): stretches the torso, widens the shoulders, pushes a
   * belly out and carries the arms / held props with it. Applied to every vertex after its matrix.
   */
  warp: ((v: THREE.Vector3, nrm: THREE.Vector3, bone: number) => void) | null = null;
  add(bone: number, geo: THREE.BufferGeometry, m: THREE.Matrix4 | undefined, color: number, ao = 1): void {
    let g = geo.index ? geo.clone() : geo.clone();
    // Optional per-vertex tone (hair locks: darker grooves, lit ridges) multiplies the part colour.
    const tone = g.attributes.shade as THREE.BufferAttribute | undefined;
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
    if (this.warp) {
      const v = new THREE.Vector3();
      const nv = new THREE.Vector3();
      const nrm = g.attributes.normal as THREE.BufferAttribute;
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, i);
        nv.fromBufferAttribute(nrm, i);
        this.warp(v, nv, bone);
        pos.setXYZ(i, v.x, v.y, v.z);
        nrm.setXYZ(i, nv.x, nv.y, nv.z);
      }
    }
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const part = new Float32Array(n).fill(this.tag || (color === this.skin ? 1 : color === 0x1d1612 ? 3 : 4));
    for (let i = 0; i < n; i++) {
      const y = pos.getY(i);
      // Contact darkening towards the feet.
      const a = ao * (0.8 + 0.2 * THREE.MathUtils.smoothstep(y, 0.0, 0.35)) * (tone ? tone.getX(i) : 1);
      col[i * 3] = c.r * a;
      col[i * 3 + 1] = c.g * a;
      col[i * 3 + 2] = c.b * a;
      si[i * 4] = bone;
      sw[i * 4] = 1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setAttribute('part', new THREE.BufferAttribute(part, 1));
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
  // Face rig: brows (V when angry, tented when sad), closed "^" eyes (laugh), a tear, a blush.
  browL,
  browR,
  lidL,
  lidR,
  tear,
  blush,
  /** Knitted-brow crease between the brows (anger). */
  furrow,
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
  /**
   * Stage cheat while talking: the direction (yaw) of the lens. The villager opens up to ~28° from
   * the farmer towards it, so the face reads three-quarter instead of in profile.
   */
  talkCheat: number | null = null;
  private headCheat = 0;
  /** Mouth flaps while true (dialogue typewriter). */
  speaking = false;
  /**
   * Head-only look target (a seated villager keeps the bench's yaw and turns just the head, ±60°,
   * towards whoever they talk to — turning the body would swing it through the backrest).
   */
  headLook: THREE.Vector3 | null = null;
  /** Direction (yaw) from this villager to the camera, pushed each frame by NpcSystem (null = unknown). */
  lensYaw: number | null = null;
  private headLookY = 0;
  /** Raining on this villager (outdoors): the umbrella goes up whenever a hand is free. */
  rain = false;
  private umbrellaUp = 0;
  /** Current activity (loops while standing still). */
  activity: Activity = 'idle';
  private talkT = 0;
  readonly walkStyle: WalkStyle;
  readonly speed: number;
  readonly scaleS: number;
  /** Height of the head top above the feet (world m) — emote bubbles, name tags. */
  readonly headTop: number;
  /** Rig-space height of the head bone (torso length + neck move it). */
  private headRigY = 0.96;

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
    this.headTop = (this.headRigY + 0.8 * HEAD_BOOST * (def.look.head ?? 1)) * this.scaleS;
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
    // Body proportions (r6 critic: one template for all ten — the lineup must read by shape alone).
    // Geometry is authored on the default chibi torso; the warp below stretches / widens / bellies it.
    const tl = L.torso ?? 1;
    const swk = L.shoulders ?? 1;
    const belly = L.belly ?? 0;
    const neckL = L.neck ?? 0;
    const hk = L.hands ?? 1;
    const headY = hipY + 0.46 * tl + neckL;
    this.headRigY = headY;
    const shoulderY = hipY + 0.32;
    const shoes = L.shoes ?? 0x5a3a24;
    const sleeve = L.coat ?? L.top;
    // Shoulders sit just outside the torso shell (and further out under a shawl / vest) so the arms
    // never sink into the body (r4 critic: Hazel's and June's arms vanished into the torso).
    const AX = (L.acc?.includes('shawl') ? 0.285 : L.vest !== undefined || L.coat !== undefined ? 0.272 : 0.262) * bw;
    // ── face structure (r7: per villager — skull proportions, eye size / spacing / height, mouth
    // width; the crown stays anchored under the hair, the face lengthens / narrows below it).
    const FP = L.fp ?? {};
    const face = L.face ?? 'round';
    const faceS: [number, number, number] = face === 'long' ? [0.97, 1.05, 1] : face === 'square' ? [1.08, 0.95, 1] : face === 'heart' ? [1.02, 0.98, 1] : [1.04, 0.96, 1];
    const fW = FP.w ?? 1;
    const fH = FP.h ?? 1;
    faceS[0] *= Math.min(1, fW);
    // Skull centre: lowered so the crown (top of the sphere) stays where the hair expects it.
    const skullY = R * 0.92 + R * faceS[1] * (1 - fH);
    faceS[1] *= fH;
    /** Head-space depth of the skull surface at (x, y) (the face sphere, unscaled in z). */
    const surfZ = (x: number, y: number): number => R * Math.sqrt(Math.max(0.02, 1 - (x / (R * faceS[0])) ** 2 - ((y - skullY) / (R * faceS[1])) ** 2));
    const gap = FP.gap ?? 1;
    const eyeK = FP.eye ?? 1;
    const EXo = 0.12 * gap;
    const EY = R * (0.95 + (FP.eyeY ?? 0));
    const EZ = surfZ(EXo, EY) - R * 0.032;
    const mouthY = R * (0.64 - Math.max(0, fH - 1) * 0.55 + Math.max(0, 1 - fH) * 0.2);
    const mouthZ = surfZ(0, mouthY) + R * 0.003;
    const browY = R * ((L.hat ? 1.15 : 1.2) + (FP.eyeY ?? 0) * 0.8);
    const browZ = surfZ(EXo, browY) + R * 0.044;
    const rb = new RigBuilder();
    rb.skin = L.skin;

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
      [B.eyeL, B.head, -0.115 * gap * hs, headY + EY * hs, EZ * hs],
      [B.eyeR, B.head, 0.115 * gap * hs, headY + EY * hs, EZ * hs],
      [B.mouth, B.head, 0, headY + mouthY * hs, mouthZ * hs],
      [B.hairBack, B.head, 0, headY + R * 1.3 * hs, -R * 0.7 * hs],
      [B.armL, B.spine, -AX, shoulderY, 0],
      [B.foreL, B.armL, -AX, shoulderY - 0.15, 0],
      [B.armR, B.spine, AX, shoulderY, 0],
      [B.foreR, B.armR, AX, shoulderY - 0.15, 0],
      [B.propBase, B.root, 0, 0, 0],
      [B.browL, B.head, -EXo * hs, headY + browY * hs, browZ * hs],
      [B.browR, B.head, EXo * hs, headY + browY * hs, browZ * hs],
      [B.lidL, B.head, -EXo * hs, headY + EY * hs, EZ * hs],
      [B.lidR, B.head, EXo * hs, headY + EY * hs, EZ * hs],
      [B.tear, B.head, -0.13 * gap * hs, headY + (EY - R * 0.25) * hs, (EZ + R * 0.05) * hs],
      [B.blush, B.head, 0, headY + R * 0.74 * hs, R * 0.9 * hs],
      [B.furrow, B.head, 0, headY + R * 1.08 * hs, R * 0.97 * hs],
    ];
    // ── proportion warp (rig space). Torso bones stretch / widen / belly; arms and the props in
    // their hands move rigidly with the shoulder; legs and the head subtree are authored in place.
    const group = new Map<number, number>([[B.spine, 0], [B.hips, 0], [B.armL, -1], [B.foreL, -1], [B.armR, 1], [B.foreR, 1]]);
    const widen = (y: number): number => THREE.MathUtils.smoothstep(y, hipY + 0.05, hipY + 0.28) * (1 - 0.6 * THREE.MathUtils.smoothstep(y, hipY + 0.38, hipY + 0.5));
    const armDX = AX * (swk - 1) * 0.85 + belly * 0.045;
    const armDY = (shoulderY - hipY) * (tl - 1);
    const warpPt = (v: THREE.Vector3, nrm: THREE.Vector3 | null, bone: number): void => {
      const gp = group.get(bone);
      if (gp === undefined) return;
      if (gp !== 0) {
        v.x += gp * armDX;
        v.y += armDY;
        return;
      }
      const y0 = v.y;
      if (belly > 0) {
        const gs = Math.exp(-(((y0 - (hipY + 0.08)) / 0.17) ** 2));
        const r = Math.hypot(v.x, v.z);
        if (r > 1e-4) {
          const f = Math.max(0, v.z / r);
          const push = belly * 0.12 * gs * (0.45 + 0.55 * f);
          v.x += (v.x / r) * push * 0.9;
          v.z += (v.z / r) * push;
        }
      }
      const w = 1 + (swk - 1) * widen(y0);
      v.x *= w;
      if (y0 > hipY) v.y = hipY + (y0 - hipY) * tl;
      if (nrm) {
        nrm.x /= w;
        if (y0 > hipY) nrm.y /= tl;
        nrm.normalize();
      }
    };
    if (tl !== 1 || swk !== 1 || belly > 0) rb.warp = warpPt;
    const world: THREE.Vector3[] = [];
    for (const [id, parent, x0, y0, z0] of bonePos) {
      const bone = new THREE.Bone();
      bone.name = B[id]!;
      const wp = new THREE.Vector3(x0, y0, z0);
      warpPt(wp, null, id);
      const { x, y, z } = wp;
      world[id] = wp;
      if (parent === -1) bone.position.set(x, y, z);
      else {
        bone.position.set(x, y, z).sub(world[parent]!);
        this.bones[parent]!.add(bone);
      }
      this.bones[id] = bone;
    }
    // Prop bones hang off the hands.
    const handL = new THREE.Vector3(-AX, shoulderY - 0.31, 0.02);
    const handR = new THREE.Vector3(AX, shoulderY - 0.31, 0.02);
    const propIndex = new Map<PropName, number>();
    for (const p of PROPS) {
      const bone = new THREE.Bone();
      bone.name = `prop-${p}`;
      const left = p === 'palette' || p === 'cane' || p === 'umbrella';
      const hand = left ? handL : handR;
      const parent = left ? B.foreL : B.foreR;
      const wHand = hand.clone();
      warpPt(wHand, null, parent);
      bone.position.copy(wHand).sub(world[parent]!);
      this.bones[parent]!.add(bone);
      propIndex.set(p, this.bones.length);
      group.set(this.bones.length, left ? -1 : 1);
      this.bones.push(bone);
      world.push(wHand);
      this.propBones.set(p, bone);
    }
    // Winter knitwear bone (scarf / muffler), scaled to zero outside winter.
    const neck = new THREE.Vector3(0, hipY + 0.38, 0);
    const winterIdx = this.bones.length;
    {
      const bone = new THREE.Bone();
      bone.name = 'winter';
      const wNeck = neck.clone();
      warpPt(wNeck, null, B.spine);
      bone.position.copy(wNeck).sub(world[B.spine]!);
      this.bones[B.spine]!.add(bone);
      group.set(this.bones.length, 0);
      this.bones.push(bone);
      world.push(wNeck);
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
      // A capelet over the shoulders (short: the arms swing out from under it, not inside it).
      const shawl = new THREE.CylinderGeometry(0.17, 0.27 * bw, 0.17, 16, 1, true);
      rb.add(B.spine, shawl, M(0, hipY + 0.32, 0.0), L.scarf ?? 0xf2e2c0);
      rb.add(B.spine, new THREE.TorusGeometry(0.27 * bw, 0.014, 4, 20), M(0, hipY + 0.235, 0, Math.PI / 2), shadeHex(L.scarf ?? 0xf2e2c0, 0.82));
      rb.add(B.spine, new THREE.ConeGeometry(0.1, 0.18, 3), M(0, hipY + 0.12, 0.2 * bw, Math.PI, 0, 0), L.scarf ?? 0xf2e2c0);
    }
    if (acc.has('stethoscope')) {
      rb.add(B.spine, new THREE.TorusGeometry(0.15, 0.013, 5, 18, Math.PI * 1.2), M(0, hipY + 0.36, 0.02, Math.PI / 2 - 0.35, 0, Math.PI * 0.9), 0x3a3a44);
      rb.add(B.spine, roundedBox(0.02, 0.2, 0.02, 0.008), M(0.05, hipY + 0.22, 0.2 * bw), 0x3a3a44);
      rb.add(B.spine, new THREE.CylinderGeometry(0.032, 0.032, 0.02, 10), M(0.05, hipY + 0.11, 0.205 * bw, Math.PI / 2), 0xc8c8d0);
    }
    // Signature silhouettes at the belt / shoulder (read at 16 px: the baker's rolling pin, the smith's
    // tongs, the doctor's bag, the shopkeeper's keys, the gardener's trowel, the lamplighter's lantern,
    // the innkeeper's tea towel).
    if (acc.has('rollingpin')) {
      rb.add(B.hips, new THREE.CylinderGeometry(0.042, 0.042, 0.3, 10), M(0.12 * bw, hipY + 0.005, 0.215 * bw, 0, 0.35, Math.PI / 2 - 0.18), 0xd8a868);
      for (const e of [-1, 1]) rb.add(B.hips, new THREE.CylinderGeometry(0.018, 0.022, 0.09, 6), M(0.12 * bw + e * 0.2 * Math.cos(0.18), hipY + 0.005 - e * 0.2 * Math.sin(0.18), 0.215 * bw - e * 0.07, 0, 0.35, Math.PI / 2 - 0.18), 0x9a6a3a);
    }
    if (acc.has('tongs')) {
      for (const e of [-1, 1]) rb.add(B.hips, roundedBox(0.026, 0.46, 0.022, 0.008), M(-0.215 * bw + e * 0.022, hipY - 0.2, 0.1 * bw, 0.06, 0, e * 0.07), 0x34343a);
      rb.add(B.hips, new THREE.TorusGeometry(0.03, 0.009, 4, 10), M(-0.215 * bw, hipY + 0.03, 0.1 * bw), 0x5a5a62);
      for (const e of [-1, 1]) rb.add(B.hips, roundedBox(0.03, 0.06, 0.03, 0.01), M(-0.215 * bw + e * 0.04, hipY - 0.44, 0.115 * bw, 0.06, 0, e * 0.25), 0x26262c);
    }
    if (acc.has('docbag')) {
      rb.add(B.spine, new THREE.TorusGeometry(0.24, 0.014, 4, 24), M(0, hipY + 0.15, 0, 0, 0, -0.75, 1.05 * bw, 1.3, 0.95 * bw), 0x3a2422);
      rb.add(B.hips, roundedBox(0.26, 0.17, 0.12, 0.05), M(0.27 * bw, hipY - 0.06, 0.02, 0, 0.35, 0), 0x6a2a26);
      rb.add(B.hips, roundedBox(0.27, 0.035, 0.125, 0.015), M(0.27 * bw, hipY + 0.02, 0.02, 0, 0.35, 0), 0x4a1c1a);
      rb.add(B.hips, roundedBox(0.04, 0.035, 0.03, 0.01), M(0.27 * bw + 0.02, hipY + 0.025, 0.085, 0, 0.35, 0), 0xe0b84a);
    }
    if (acc.has('keys')) {
      rb.add(B.hips, new THREE.TorusGeometry(0.04, 0.008, 4, 12), M(0.2 * bw, hipY - 0.03, 0.17 * bw + belly * 0.08, 0, 0.6, 0), 0xd8b04a);
      for (let i = 0; i < 3; i++) rb.add(B.hips, roundedBox(0.018, 0.08, 0.008, 0.004), M(0.2 * bw + (i - 1) * 0.025, hipY - 0.09, 0.175 * bw + belly * 0.08, 0, 0.6, (i - 1) * 0.3), i === 1 ? 0xb8b8c0 : 0xd8b04a);
    }
    if (acc.has('trowel')) {
      rb.add(B.hips, new THREE.CylinderGeometry(0.018, 0.022, 0.12, 6), M(0.17 * bw, hipY + 0.06, 0.2 * bw, -0.2, 0, -0.35), 0x9a6a3a);
      rb.add(B.hips, roundedBox(0.07, 0.13, 0.012, 0.01), M(0.19 * bw, hipY - 0.05, 0.215 * bw, -0.2, 0, -0.35), 0xa8b0b8);
    }
    if (acc.has('lantern')) {
      rb.add(B.hips, new THREE.TorusGeometry(0.03, 0.007, 4, 10, Math.PI), M(0.25 * bw, hipY - 0.0, 0.08, 0, 0.3, 0), 0x3a3a3a);
      rb.add(B.hips, roundedBox(0.09, 0.12, 0.09, 0.02), M(0.25 * bw, hipY - 0.1, 0.08, 0, 0.3, 0), 0xf2c86a);
      rb.add(B.hips, new THREE.ConeGeometry(0.065, 0.05, 4), M(0.25 * bw, hipY - 0.015, 0.08, 0, 0.3 + Math.PI / 4, 0), 0x3a3a3a);
      rb.add(B.hips, roundedBox(0.1, 0.02, 0.1, 0.008), M(0.25 * bw, hipY - 0.165, 0.08, 0, 0.3, 0), 0x3a3a3a);
    }
    if (acc.has('towel')) {
      for (const e of [-1, 1]) rb.add(B.spine, roundedBox(0.11, 0.24, 0.02, 0.01), M(-0.15 * bw, hipY + 0.3, e * 0.2 * bw, e * 0.12, 0, 0.15), 0xf6f0e4);
      for (const e of [-1, 1]) rb.add(B.spine, roundedBox(0.112, 0.02, 0.022, 0.006), M(-0.15 * bw - 0.02, hipY + 0.22, e * 0.205 * bw, e * 0.12, 0, 0.15), 0xc8412f);
      rb.add(B.spine, new THREE.CylinderGeometry(0.06, 0.06, 0.11, 10, 1, true, 0, Math.PI), M(-0.15 * bw, hipY + 0.42, 0, 0, 0, Math.PI / 2 + 0.15, 1, 1, 1.9 * bw), 0xf6f0e4);
    }
    if (neckL > 0.015) {
      // A visible neck (the doctor's long one) between the collar and the head, with a collar band.
      const warp = rb.warp;
      rb.warp = null;
      const n0 = hipY + 0.4 * tl;
      rb.add(B.spine, new THREE.CylinderGeometry(0.068, 0.078, headY - n0 + 0.06, 10), M(0, (n0 + headY + 0.06) / 2, 0.0), L.skin);
      rb.add(B.spine, new THREE.CylinderGeometry(0.088, 0.1, 0.07, 12, 1, true), M(0, n0 + 0.03, 0), L.top);
      rb.warp = warp;
    }
    if (!L.coat && !L.vest && !L.apron) for (let i = 0; i < 3; i++) rb.add(B.spine, new THREE.SphereGeometry(0.018, 6, 4), M(0, hipY + 0.32 - i * 0.08, 0.2 * bw), 0xf0e0c0);

    // Shoulder yoke: a soft bar across the top of the torso out to the arm sockets, so the arms hang
    // from a shoulder line instead of floating as puffy balls beside the torso (broad builds square up).
    {
      const yoke = new THREE.CapsuleGeometry(0.072, Math.max(0.05, 2 * AX - 0.2), 4, 10);
      yoke.rotateZ(Math.PI / 2);
      rb.add(B.spine, yoke, M(0, shoulderY + 0.01, -0.005, 0, 0, 0, 1, 1, 1.12), sleeve);
    }
    // ── arms (upper + fore + hand)
    for (const [arm, fore, sx] of [[B.armL, B.foreL, -1], [B.armR, B.foreR, 1]] as const) {
      const x = sx * AX;
      rb.add(arm, new THREE.SphereGeometry(0.085, 10, 8), M(x, shoulderY, 0), sleeve);
      rb.add(arm, new THREE.CapsuleGeometry(0.074, 0.07, 3, 8), M(x, shoulderY - 0.07, 0), sleeve);
      rb.add(fore, new THREE.CapsuleGeometry(0.06, 0.1, 3, 8), M(x, shoulderY - 0.2, 0), L.coat !== undefined ? L.coat : (acc.has('toolbelt') || L.apron !== undefined) && !L.longSleeves ? L.skin : L.top);
      if (L.mittens !== undefined) {
        // Knitted mittens: a ribbed cuff, a chunky mitt and a thumb.
        rb.add(fore, new THREE.CylinderGeometry(0.064, 0.064, 0.05, 10), M(x, shoulderY - 0.25, 0.005), shadeHex(L.mittens, 0.85));
        rb.add(fore, new THREE.SphereGeometry(0.078 * hk, 10, 8), M(x, shoulderY - 0.315 - (hk - 1) * 0.05, 0.012, 0, 0, 0, 1, 1.12, 1), L.mittens);
        rb.add(fore, new THREE.SphereGeometry(0.03, 6, 5), M(x - sx * 0.05, shoulderY - 0.29, 0.05), L.mittens);
      } else {
        // A cupped hand: a mitt (palm + fingers as one soft wedge, turned a little in) and a thumb
        // split off towards the front — not a ball.
        rb.add(fore, new THREE.SphereGeometry(0.066 * hk, 10, 8), M(x, shoulderY - 0.305 - (hk - 1) * 0.05, 0.004, 0.1, -sx * 0.35, 0, 0.82, 1.12, 0.92), L.skin);
        rb.add(fore, new THREE.CapsuleGeometry(0.022 * hk, 0.035 * hk, 2, 6), M(x - sx * 0.045 * hk, shoulderY - 0.29 - (hk - 1) * 0.04, 0.042 * hk, 0.5, 0, sx * 0.6), shadeHex(L.skin, 0.97));
        rb.add(fore, new THREE.CapsuleGeometry(0.008 * hk, 0.05 * hk, 2, 4), M(x + sx * 0.012, shoulderY - 0.335 - (hk - 1) * 0.07, 0.05 * hk, 0.2, 0, 0), shadeHex(L.skin, 0.8));
      }
    }

    // ── head
    const H = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(0, headY, 0).multiply(new THREE.Matrix4().makeScale(hs, hs, hs)).multiply(M(x, y, z, rx, ry, rz, sx, sy, sz));
    rb.add(B.head, new THREE.SphereGeometry(R, 24, 16), H(0, skullY, 0, 0, 0, 0, ...faceS), L.skin);
    // Lower face (r7): cheek / jowl mass for wide faces, a jaw block (soft → square), and the chin
    // (pointed / jutting, or soft with a little double chin) — what tells ten faces apart with the
    // hair hidden. Stubble tints the jaw pieces instead of a shell laid over the eyes (r6 blocker).
    const beardK = L.beard === true ? 'full' : L.beard;
    const jawC = beardK === 'stubble' ? mixHex(L.skin, L.hair, 0.32) : L.skin;
    const chinY = skullY - R * faceS[1];
    const jawK = FP.jaw ?? (face === 'square' ? 0.8 : face === 'heart' ? 0 : 0.25);
    const chinK = FP.chin ?? (face === 'heart' ? 0.4 : 0);
    if (fW > 1.01) rb.add(B.head, new THREE.SphereGeometry(R, 18, 12), H(0, skullY - R * 0.36, R * 0.04, 0, 0, 0, faceS[0] * fW * 0.93, 0.62 * faceS[1], 0.9), L.skin);
    if (jawK > 0.05) {
      const jw = R * 0.7 * (0.82 + 0.42 * jawK) * Math.max(0.9, Math.min(1.2, fW));
      rb.add(B.head, new THREE.SphereGeometry(1, 18, 12), H(0, chinY + R * (0.5 - 0.1 * jawK), R * 0.06, 0.1, 0, 0, jw, R * (0.46 + 0.04 * jawK), R * 0.66), jawC);
    }
    if (chinK > 0.05) {
      {
        // (sits on the jaw line, mostly inside the skull: a firmer / longer point, not an egg)
        const cy = chinY + R * (0.2 - 0.12 * chinK);
        rb.add(B.head, new THREE.SphereGeometry(1, 14, 10), H(0, cy, surfZ(0, cy + R * 0.08) - R * (0.2 - 0.04 * chinK), 0.35, 0, 0, R * (0.26 - 0.06 * chinK), R * (0.2 + 0.08 * chinK), R * 0.22), jawC);
      }
    } else if (chinK < -0.3) {
      // Soft chin: a rounded pad tucked under the jaw line (a gentle double chin from the side; a
      // milder soft chin is just the round skull — the r7 pad on Kit read as a pale beard).
      rb.add(B.head, new THREE.SphereGeometry(1, 14, 10), H(0, chinY + R * 0.06, R * 0.3, 0, 0, 0, R * 0.4, R * 0.17 * (1 - chinK * 0.5), R * 0.34), shadeHex(L.skin, 0.97));
    }
    if (FP.cleft) {
      rb.tag = 1;
      rb.add(B.head, new THREE.CapsuleGeometry(0.006, 0.03, 2, 4), H(0, chinY + R * (0.16 - 0.1 * chinK), surfZ(0, chinY + R * 0.2) + R * (0.12 + 0.1 * chinK)), mixHex(jawC, 0x5a2a1a, 0.4));
      rb.tag = 0;
    }
    const earK = FP.ears ?? 1;
    const earX = R * 0.98 * Math.min(1, faceS[0] / 1.04);
    for (const sx of [-1, 1]) {
      rb.add(B.head, new THREE.SphereGeometry(0.07, 10, 8), H(sx * earX, R * 0.88, 0, 0, 0, 0, 0.6 * earK, earK, earK), L.skin);
      // Inner ear fold (a darker crescent: ears read as ears, not balls).
      rb.tag = 1;
      rb.add(B.head, new THREE.TorusGeometry(0.03 * earK, 0.008, 4, 10, Math.PI * 1.2), H(sx * (earX + 0.03 * earK), R * 0.88, 0.012, 0, sx * 1.25, 0.6), mixHex(L.skin, 0x8a3a2a, 0.3));
      rb.tag = 0;
    }
    rb.tag = 1;
    // Noses (r7): a button, an old man's bulb, a long straight nose, a hook, a snub, a broad nose.
    {
      const nose = FP.nose ?? 'button';
      const nc = shadeHex(L.skin, 1.04);
      const nY = R * (0.78 - Math.max(0, fH - 1) * 0.25);
      const nZ = surfZ(0, nY);
      switch (nose) {
        case 'bulb':
          rb.add(B.head, new THREE.SphereGeometry(0.044, 12, 10), H(0, nY - R * 0.03, nZ + 0.002, 0, 0, 0, 1.05, 0.95, 0.9), nc);
          for (const sx of [-1, 1]) rb.add(B.head, new THREE.SphereGeometry(0.022, 8, 6), H(sx * 0.036, nY - R * 0.06, nZ - 0.012), shadeHex(L.skin, 1.0));
          break;
        case 'long':
          rb.add(B.head, new THREE.SphereGeometry(0.03, 12, 10), H(0, nY + R * 0.02, nZ - 0.004, -0.3, 0, 0, 0.78, 2.0, 1.0), nc);
          break;
        case 'hook': {
          rb.add(B.head, new THREE.CapsuleGeometry(0.02, 0.09, 3, 8), H(0, nY + R * 0.12, nZ + 0.004, 0.42, 0, 0), nc);
          rb.add(B.head, new THREE.SphereGeometry(0.036, 12, 10), H(0, nY - R * 0.03, nZ + 0.012, 0, 0, 0, 0.95, 1.1, 1.05), nc);
          break;
        }
        case 'snub':
          rb.add(B.head, new THREE.SphereGeometry(0.024, 10, 8), H(0, nY + R * 0.01, nZ - 0.002, 0.4, 0, 0, 1.15, 0.85, 1.0), nc);
          break;
        case 'broad':
          rb.add(B.head, new THREE.SphereGeometry(0.034, 12, 10), H(0, nY - R * 0.02, nZ - 0.002, 0, 0, 0, 1.5, 0.95, 0.9), nc);
          for (const sx of [-1, 1]) rb.add(B.head, new THREE.SphereGeometry(0.02, 8, 6), H(sx * 0.042, nY - R * 0.05, nZ - 0.014), shadeHex(L.skin, 0.99));
          break;
        default:
          rb.add(B.head, new THREE.SphereGeometry(0.03, 10, 8), H(0, nY, nZ), nc);
      }
    }
    // Age lines (r7): crow's feet, under-eye bags, smile folds, forehead lines — thin creases a shade
    // darker than the skin (the painter inks them as colour edges).
    {
      const lk = FP.lines ?? (acc.has('wrinkles') ? 0.8 : 0);
      const lc = mixHex(L.skin, 0x6a2e1e, 0.38 + 0.12 * lk);
      const ex = EXo;
      if (lk >= 0.3)
        for (const sx of [-1, 1])
          for (let i = 0; i < (lk > 0.7 ? 3 : 2); i++) {
            const x = sx * (ex + 0.07 * eyeK + 0.012);
            const y = EY + R * (0.06 - i * 0.07);
            rb.add(B.head, new THREE.CapsuleGeometry(0.0055, 0.028, 2, 4), H(x, y, surfZ(x, y) - 0.002, 0, sx * 0.6, sx * (1.1 - i * 0.45)), lc);
          }
      if (lk >= 0.55)
        for (const sx of [-1, 1]) {
          const y = EY - R * 0.2 * eyeK;
          rb.add(B.head, new THREE.TorusGeometry(0.038 * eyeK, 0.005, 3, 10, Math.PI * 0.8), H(sx * ex, y, surfZ(sx * ex, y) - 0.003, -0.2, sx * 0.35, Math.PI * 1.1), lc);
        }
      if (lk >= 0.5)
        for (const sx of [-1, 1]) {
          // A ')' fold from the nose wing round the mouth corner (arc bowing outwards).
          const y = mouthY + R * 0.08;
          const x = sx * (0.085 * (FP.mouth ?? 1) + 0.02);
          rb.add(B.head, new THREE.TorusGeometry(0.06, 0.0055, 3, 10, Math.PI * 0.5), H(x - sx * 0.06, y, surfZ(x, y) - 0.004, 0, sx * 0.45, sx > 0 ? -Math.PI * 0.3 : Math.PI * 0.8), lc);
        }
      if (lk >= 0.75 && !L.hat && L.hairStyle !== 'bob' && L.hairStyle !== 'curly')
        for (let i = 0; i < 2; i++) {
          const y = browY + R * (0.12 + i * 0.07);
          rb.add(B.head, new THREE.TorusGeometry(0.16, 0.005, 3, 14, Math.PI * 0.32), H(0, y - 0.16, surfZ(0, y) - 0.03, -0.25, 0, Math.PI * 0.34), lc);
        }
    }
    rb.tag = 0;
    const hatted = !!L.hat;
    for (const sx of [-1, 1]) {
      // Brows sit just above the eyes; under a hat they tuck in below the brim / cuff line.
      // (chunky brows: they carry the mood from the high camera — and the portrait is this face)
      // Per villager: thickness (bushy elders, the smith's straight bars, fine arched lines) and arch.
      const bt = L.brow ?? 1;
      const arch = L.browArch ?? 0.15;
      const browC = shadeHex(L.hair, L.hair > 0xc0c0c0 ? (bt > 1.3 ? 0.78 : 0.55) : 0.62);
      const bb = sx < 0 ? B.browL : B.browR;
      const by = browY;
      void hatted;
      if (arch > 0.12) {
        // An arched brow: two short capsules meeting in a soft peak two thirds out.
        rb.add(bb, new THREE.CapsuleGeometry(0.019 * bt, 0.05, 3, 6), H(sx * (EXo - 0.022), by, browZ + R * 0.01, 0, 0, Math.PI / 2 + sx * (0.06 + arch * 0.4), 1, 1, 0.7), browC);
        rb.add(bb, new THREE.CapsuleGeometry(0.017 * bt, 0.04, 3, 6), H(sx * (EXo + 0.032), by + 0.002, browZ - R * 0.03, 0, sx * 0.3, Math.PI / 2 - sx * (0.22 + arch * 0.8), 1, 1, 0.7), browC);
      } else rb.add(bb, new THREE.CapsuleGeometry(0.021 * bt, 0.08 + (bt > 1.3 ? 0.012 : 0), 3, 6), H(sx * EXo, by, browZ, 0, 0, Math.PI / 2 + sx * (0.14 - arch), 1, 1, 0.7), browC);
      if (bt > 1.5) rb.add(bb, new THREE.CapsuleGeometry(0.016 * bt, 0.05, 3, 6), H(sx * (EXo + 0.03), by + 0.012, browZ - R * 0.03, 0, sx * 0.3, Math.PI / 2 + sx * 0.4, 1, 1, 0.7), shadeHex(browC, 1.12));
      // Anger crease: two short knit lines between the brows.
      rb.tag = 1;
      rb.add(B.furrow, new THREE.CapsuleGeometry(0.008, 0.035, 2, 4), H(sx * 0.022, browY - R * 0.1, surfZ(0, browY - R * 0.1) + R * 0.01, 0, 0, sx * 0.3), mixHex(L.skin, 0x5a2a1a, 0.55));
      if (acc.has('freckles'))
        for (let i = 0; i < 4; i++) {
          // On the cheek surface (the face sphere is ~4 % wider than tall), facing out along its normal.
          const fx = sx * (EXo + (i % 2) * 0.034 + (i > 1 ? 0.017 : 0));
          const fy = EY - R * (0.15 + (i > 1 ? 0.075 : 0) - (i % 2) * 0.025);
          const dyy = fy - skullY;
          const fz = surfZ(fx, fy) + 0.004;
          rb.add(B.head, new THREE.CircleGeometry(0.0125, 7), H(fx, fy, fz, -dyy / R * 0.8, Math.asin(Math.max(-1, Math.min(1, fx / R))), 0), mixHex(L.skin, 0x7a3a1e, 0.5));
        }
      const ck = FP.cheeks ?? 0.6;
      if (ck > 0.05) {
        const cx = sx * (EXo + 0.07);
        const cy = EY - R * 0.21;
        rb.add(B.head, new THREE.CircleGeometry(0.036 + 0.024 * ck, 14), H(cx, cy, surfZ(cx, cy) - 0.006, 0, sx * 0.55, 0, 1.15, 0.85, 1), mixHex(L.skin, 0xf07a6a, 0.12 + 0.55 * ck));
      }
      rb.tag = 0;
      if (acc.has('earrings')) rb.add(B.head, new THREE.SphereGeometry(0.022, 8, 6), H(sx * R * 1.0, R * 0.68, 0.02), 0xf2c43a);
    }
    // Mouth (flaps on its own bone while talking).
    rb.tag = 3;
    const mW = FP.mouth ?? 1;
    rb.add(B.mouth, new THREE.TorusGeometry(0.036, 0.01, 6, 12, Math.PI), H(0, mouthY, mouthZ, 0, 0, Math.PI, mW, 1, 1), 0x3a1a14);
    rb.add(B.mouth, new THREE.CircleGeometry(0.03, 10, Math.PI, Math.PI), H(0, mouthY, mouthZ - R * 0.005, 0, 0, 0, mW, 1, 1), 0x8a3a30);
    rb.tag = 0;
    if (L.glasses) {
      // (a warm tortoiseshell, a touch thicker: the ink edge turned thin dark rims into a scribble)
      for (const sx of [-1, 1]) rb.add(B.head, new THREE.TorusGeometry(0.07 * Math.max(0.9, eyeK), 0.0135, 6, 18), H(sx * 0.115 * gap, EY + R * 0.02, EZ + R * 0.1), 0x9a6a3a);
      rb.add(B.head, roundedBox(Math.max(0.04, 0.23 * gap - 0.14 * Math.max(0.9, eyeK)), 0.016, 0.016, 0.005, 1), H(0, EY + R * 0.05, EZ + R * 0.12), 0x9a6a3a);
      for (const sx of [-1, 1]) rb.add(B.head, roundedBox(0.012, 0.012, 0.26, 0.004, 1), H(sx * Math.max(0.19, 0.115 * gap + 0.075), EY + R * 0.05, EZ - R * 0.1, 0, sx * 0.3, 0), 0x6a4a2a);
    }
    const beard = L.beard === true ? 'full' : L.beard;
    rb.tag = 6;
    if (beard === 'full') {
      const bg = lumpySphere(0.2, 3, 0.12, rng, 2);
      bg.scale(1.35, 0.9, 0.7);
      // The mouth cut through the beard: a soft hollow scooped out where the lips sit, so the face
      // talks, laughs and gasps through it (r4 critic: "a white mask with no mouth").
      {
        const pa = bg.attributes.position as THREE.BufferAttribute;
        const my = R * 0.62 - R * 0.5;
        for (let i = 0; i < pa.count; i++) {
          const z = pa.getZ(i);
          if (z <= 0) continue;
          const f = Math.exp(-((pa.getX(i) / 0.085) ** 2 + ((pa.getY(i) - my) / 0.05) ** 2));
          pa.setZ(i, z - f * 0.085);
        }
        pa.needsUpdate = true;
        smoothNormals(bg);
        // Combed strands: vertical grooves fanning down from the cheeks, darker underneath.
        const tone = new Float32Array(pa.count);
        for (let i = 0; i < pa.count; i++) {
          const x = pa.getX(i);
          const y = pa.getY(i);
          const a = Math.atan2(x, Math.max(0.02, pa.getZ(i)));
          const groove = Math.abs(Math.sin(a * 9 + y * 10));
          tone[i] = (0.8 + 0.2 * groove) * (0.84 + 0.16 * THREE.MathUtils.smoothstep(y, -0.16, 0.05));
        }
        bg.setAttribute('shade', new THREE.BufferAttribute(tone, 1));
      }
      rb.add(B.head, bg, H(0, R * 0.5, R * 0.62), L.hair);
      // Moustache as two sweeping wings over the hollow (not one bar).
      for (const sx of [-1, 1]) {
        const st = new THREE.CapsuleGeometry(0.03, 0.075, 3, 8);
        st.rotateZ(Math.PI / 2 + sx * 0.32);
        rb.add(B.head, st, H(sx * 0.048, R * 0.76, R * 1.0), shadeHex(L.hair, 0.92));
      }
    } else if (beard === 'mustache') {
      for (const sx of [-1, 1]) {
        const st = new THREE.CapsuleGeometry(0.026, 0.07, 3, 8);
        st.rotateZ(Math.PI / 2 + sx * 0.35);
        rb.add(B.head, st, H(sx * 0.045, R * 0.72, R * 0.97), shadeHex(L.hair, 0.85));
      }
    } else if (beard === 'stubble') {
      // Stubble (r7 blocker fix): a skin-tagged band on the jaw only, well below the mouth corners —
      // the r6 hair-tagged shell rode up over the eyes and the painter lit it as pale hair.
      rb.tag = 1;
      const sh = new THREE.SphereGeometry(R * 1.006, 24, 8, -Math.PI * 0.1, Math.PI * 1.2, Math.PI * 0.72, Math.PI * 0.24);
      rb.add(B.head, sh, H(0, skullY, 0.002, 0, 0, 0, ...faceS), jawC);
    }
    rb.tag = 0;
    rb.tag = 2;
    this.buildHair(rb, L, H, R, rng);
    rb.tag = 5;
    this.buildHat(rb, L, H, R, rng);
    rb.tag = 0;
    if (acc.has('pencil')) rb.add(B.head, new THREE.CylinderGeometry(0.012, 0.012, 0.2, 6), H(R * 0.98, R * 1.08, 0.02, 0.2, 0, 1.2), 0xf2c43a);
    if (acc.has('flower')) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        rb.add(B.head, new THREE.SphereGeometry(0.03, 6, 5), H(-R * 0.75 + Math.cos(a) * 0.035, R * 1.55 + Math.sin(a) * 0.035, R * 0.45), 0xff8fab);
      }
      rb.add(B.head, new THREE.SphereGeometry(0.025, 6, 5), H(-R * 0.75, R * 1.55, R * 0.48), 0xffd166);
    }
    // Eyes (blink bones). Each villager has their own cut (NpcLook.eyeShape): the shape is a squash /
    // tilt about the eye centre applied to every eye part, plus lid lines, lashes or a heavy lid.
    const shape = L.eyeShape ?? 'round';
    const ES: Record<string, [number, number, number]> = {
      // [width, height, outer-corner lift (rad)]
      round: [1, 1, 0],
      wide: [1.08, 1.06, 0.04],
      almond: [1.18, 0.66, 0.2],
      narrow: [1.12, 0.46, -0.06],
      sleepy: [1.1, 0.78, -0.1],
      beady: [0.72, 0.62, 0],
    };
    const [ew, eh, lift] = ES[shape] ?? ES.round!;
    const lashC = mixHex(0x1d1612, L.hair, 0.15);
    rb.tag = 3;
    for (const [eye, sx] of [[B.eyeL, -1], [B.eyeR, 1]] as const) {
      const ex = sx * EXo;
      const c0 = new THREE.Vector3().setFromMatrixPosition(H(ex, EY, (EZ - R * 0.01)));
      const T = new THREE.Matrix4().makeTranslation(c0.x, c0.y, c0.z).multiply(M(0, 0, 0, 0, 0, sx * lift, ew * eyeK, eh * eyeK, eyeK)).multiply(new THREE.Matrix4().makeTranslation(-c0.x, -c0.y, -c0.z));
      const E = (...a: number[]): THREE.Matrix4 => T.clone().multiply(H(...a));
      // Big glossy chibi eyes: a dark oval with an iris-tinted lower half and two catch-lights.
      rb.add(eye, new THREE.CapsuleGeometry(0.043, 0.05, 3, 10), E(ex, EY, (EZ - R * 0.01), -0.12), 0x1d1612);
      const irisK = shape === 'wide' ? 1.18 : 1;
      rb.add(eye, new THREE.SphereGeometry(0.03 * irisK, 10, 6, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), E(ex, EY + 0.004, EZ + 0.016, -0.35, 0, 0, 1, 1.25, 0.9), mixHex(0x1d1612, L.eyes ?? 0x3a2418, shape === 'wide' ? 0.9 : 0.75));
      // Catch-lights stay round (counter-scaled) whatever the cut.
      rb.add(eye, new THREE.SphereGeometry(0.016, 8, 6), E(ex + 0.015, EY + 0.028 * Math.min(1, 0.8 / eh), EZ + 0.034, 0, 0, 0, 1 / ew, 1 / eh, 1), 0xffffff);
      if (shape !== 'beady' && shape !== 'narrow') rb.add(eye, new THREE.SphereGeometry(0.009, 6, 4), E(ex - 0.013, EY - 0.022, EZ + 0.034, 0, 0, 0, 1 / ew, 1 / eh, 1), mixHex(0xffffff, L.eyes ?? 0x3a2418, 0.3));
      if (shape === 'wide') rb.add(eye, new THREE.SphereGeometry(0.007, 6, 4), E(ex + 0.02, EY - 0.012, EZ + 0.036), 0xffffff);
      // Lid line: a soft ink arc over the top of every cut but the plain chibi oval (gives the eye a shape).
      if (shape !== 'round' && shape !== 'beady') {
        const lid = new THREE.TorusGeometry(0.05, 0.0085 / Math.max(0.5, eh), 4, 12, Math.PI * 0.9);
        lid.rotateZ(Math.PI * 0.05);
        rb.add(eye, lid, E(ex, EY + 0.004, EZ + 0.012, -0.2), lashC);
      }
      if (shape === 'sleepy') {
        // A heavy upper lid (skin) over the top third, laid-back.
        const lidCap = new THREE.SphereGeometry(0.056, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.42);
        rb.tag = 1;
        rb.add(eye, lidCap, E(ex, EY + 0.016, (EZ - R * 0.01) - 0.01, 0.35, 0, 0, 1.05, 0.8, 0.9), shadeHex(L.skin, 0.95));
        rb.tag = 3;
      }
      if (L.lashes) {
        for (let i = 0; i < 2; i++) {
          const lash = new THREE.CapsuleGeometry(0.0075, 0.03 - i * 0.006, 2, 4);
          rb.add(eye, lash, E(ex + sx * (0.05 + i * 0.006), EY + 0.04 - i * 0.022, EZ + 0.005, 0, 0, -sx * (0.9 + i * 0.45)), lashC);
        }
      }
      // Closed happy eyes (laugh): a thick "^" arc, scaled up only while laughing.
      rb.add(sx < 0 ? B.lidL : B.lidR, new THREE.TorusGeometry(0.042 * Math.max(0.85, ew) * eyeK, 0.013, 5, 12, Math.PI), H(ex, EY - R * 0.05, EZ + R * 0.03, -0.1), 0x1d1612);
    }
    rb.tag = 0;
    // A tear welling under the left eye with a wet streak (sad), and a hot blush over both cheeks.
    rb.tag = 1;
    {
      // (follows the eye: spacing, height and the face's depth there)
      const tx = -EXo - 0.01;
      const ty = EY - R * 0.35;
      const tz = surfZ(tx, ty);
      rb.add(B.tear, new THREE.SphereGeometry(0.026, 10, 8), H(tx, ty, tz + R * 0.02, 0, 0, 0, 0.8, 1.25, 0.6), 0x8ad0f8);
      rb.add(B.tear, new THREE.SphereGeometry(0.01, 6, 4), H(tx - 0.007, ty + R * 0.03, tz + R * 0.04), 0xffffff);
      rb.add(B.tear, new THREE.CapsuleGeometry(0.009, 0.07, 2, 6), H(tx + 0.002, EY - R * 0.19, surfZ(tx, EY - R * 0.19) + R * 0.01, 0.25, 0, 0), 0xa8dcf6);
    }
    for (const sx of [-1, 1]) {
      const bx = sx * (EXo + 0.06);
      const by = EY - R * 0.21;
      const bz = surfZ(bx, by);
      rb.add(B.blush, new THREE.CircleGeometry(0.075, 16), H(bx, by, bz - R * 0.01, 0, sx * 0.5, 0, 1.2, 0.8, 1), mixHex(L.skin, 0xf04a5a, 0.72));
      for (let i = 0; i < 3; i++) rb.add(B.blush, new THREE.CapsuleGeometry(0.006, 0.035, 2, 4), H(bx + sx * (i - 1) * 0.03, by, bz + R * 0.02, 0, sx * 0.5, 0.5), mixHex(L.skin, 0xa8283a, 0.8));
    }
    rb.tag = 0;
    // ── held props (built at the hand, in rig space)
    // Only the props this villager ever uses (schedule, rainy days, heart events, staged demos)
    // are built — hidden props still cost triangles in every pass.
    const used = usedProps(this.def);
    const addProp = (p: PropName, fn: (add: (g: THREE.BufferGeometry, m: THREE.Matrix4, c: number) => void) => void): void => {
      if (!used.has(p)) return;
      const bi = propIndex.get(p)!;
      const hand = p === 'palette' || p === 'cane' || p === 'umbrella' ? handL : handR;
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
    addProp('umbrella', (add) => {
      // Built upright in rig space; the bone is counter-rotated against the raised arm each frame.
      const col = UMBRELLAS[(rng.next() * UMBRELLAS.length) | 0]!;
      add(new THREE.CylinderGeometry(0.013, 0.013, 1.3, 5), M(0, 0.6, 0), 0x3a2a22);
      add(new THREE.TorusGeometry(0.035, 0.012, 4, 8, Math.PI), M(0.035, -0.04, 0, 0, 0, Math.PI), 0x6a4a2a);
      const can = new THREE.ConeGeometry(0.66, 0.28, 8, 1, true);
      add(can, M(0, 1.33, 0), col);
      const under = new THREE.ConeGeometry(0.64, 0.26, 8, 1, true);
      under.scale(-1, 1, 1);
      add(under, M(0, 1.325, 0), shadeHex(col, 0.62));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        add(new THREE.SphereGeometry(0.022, 5, 4), M(Math.cos(a) * 0.65, 1.19, Math.sin(a) * 0.65), shadeHex(col, 0.8));
      }
      add(new THREE.SphereGeometry(0.03, 6, 5), M(0, 1.49, 0), 0x3a2a22);
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
      // Under a flat cap only the hair below the band shows (a full dome would poke out over the crown).
      const top = L.hat === 'flatcap' || L.hat === 'bandana' ? Math.PI * 0.3 : 0;
      // [grooves, depth, hem scallop, twist] per style: sculpted locks, not a smooth dome.
      const SHELL: Partial<Record<string, [number, number, number, number]>> = {
        bun: [12, 0.06, 0.08, 0.4],
        short: [13, 0.075, 0.15, 1.1],
        bob: [11, 0.07, 0.2, 0.7],
        curly: [10, 0.05, 0.06, 0.6],
        ponytail: [12, 0.06, 0.1, 0.4],
        long: [12, 0.06, 0.1, 0.5],
        spiky: [9, 0.11, 0.24, 1.4],
        braids: [15, 0.05, 0.04, 0.2],
        slick: [16, 0.022, 0.04, 2.2],
      };
      const [gv, dp, sc, tw] = SHELL[style] ?? [12, 0.06, 0.1, 0.8];
      // Under a headscarf the hair follows the scarf's tilt and sits just inside it (no dark patches
      // poking through the cloth over the crown).
      const scarf = L.hat === 'bandana';
      // (under a beanie the shell stops above the eyes: r6 Rowan's temple locks hung over the far eye)
      const cap = hairShell(R * (scarf ? 1.035 : 1.07), top, (L.hat === 'beanie' ? Math.PI * 0.46 : Math.PI * 0.55) - top, gv, top > 0 ? dp * 0.4 : dp, scarf ? 0.02 : top > 0 || hatted ? sc * 0.3 : sc, (L.hair % 97) * 0.13, tw);
      rb.add(B.head, cap, scarf ? H(0, R * 0.98, -0.03, -0.5, 0, 0, 0.97, 0.76, 0.98) : H(0, R * 0.98, -0.02, -0.25, 0, 0), hair);
      // A glossy sheen band across the crown (reads as combed, not a plastic dome) and a darker
      // underlayer at the nape.
      // (the sheen band is painted into the shell's tone, across the ridges)
      // Fringe: tapered locks along the hairline break the straight cap edge over the forehead
      // (short in the middle so the brows and eyes stay clear, longer at the temples).
      const fringe = !hatted && (style === 'bun' || style === 'spiky' || style === 'short' || style === 'ponytail' || style === 'long' || style === 'braids' || style === 'bob');
      if (fringe) {
        // [angle round the head, tip height (head space), length]
        // (r7: the middle three a touch higher — in a bowed angry / sad bust they reached the nose bridge)
        const locks: [number, number, number][] = [[0, R * 1.16, 0.1], [0.62, R * 1.02, 0.13], [-0.62, R * 1.02, 0.13], [0.88, R * 0.9, 0.15], [-0.88, R * 0.9, 0.15], [1.12, R * 0.82, 0.17], [-1.12, R * 0.82, 0.17], [0.34, R * 1.21, 0.07], [-0.34, R * 1.21, 0.07]];
        const brimmed = L.hat === 'sunhat';
        locks.forEach(([a, tip0, len0], i) => {
          // (under a brim the fringe is swept up: r6 Hazel's locks curtained her eyes when she bowed)
          const len = brimmed && Math.abs(a) < 0.7 ? len0 * 0.55 : len0;
          const tip = brimmed && Math.abs(a) < 0.7 ? tip0 + (len0 - len) * 0.9 : tip0;
          // A soft teardrop lock (round at the root, tapering to a curled tip), flattened against the
          // brow so neighbouring locks overlap into a scalloped fringe rather than a row of spikes.
          const cone = new THREE.SphereGeometry(1, 9, 7);
          const pa = cone.attributes.position as THREE.BufferAttribute;
          for (let v = 0; v < pa.count; v++) {
            const y = pa.getY(v);
            const k = y < 0 ? 1 + y * 0.72 : 1;
            pa.setXYZ(v, pa.getX(v) * k + (y < 0 ? y * y * 0.18 * (i % 2 ? 1 : -1) : 0), y, pa.getZ(v) * k);
          }
          cone.computeVertexNormals();
          cone.scale(0.058 + (i % 3) * 0.008, len * 0.62, 0.028);
          cone.rotateZ(-Math.sin(a) * 0.3 + (i % 2 ? 0.08 : -0.08));
          cone.rotateX(0.12);
          cone.rotateY(a);
          const cy = tip + len / 2;
          const hr = Math.sqrt(Math.max(0.01, (R * 1.07) ** 2 - (cy - R * 0.98) ** 2)) * 0.985;
          rb.add(B.head, cone, H(Math.sin(a) * hr, cy, Math.cos(a) * hr - 0.02), i % 3 === 1 ? hi : hair);
        });
      }
    }
    switch (style) {
      case 'bun':
        rb.add(B.hairBack, lumpySphere(0.17, 1, 0.12, rng, 2), H(0, R * 1.85, -R * 0.35), hair);
        for (const sx of [-1, 1]) rb.add(B.head, lumpySphere(0.12, 1, 0.1, rng), H(sx * R * 0.9, R * 1.1, -R * 0.08, 0, 0, 0, 0.55, 1.0, 0.85), hair);
        rb.add(B.head, lumpySphere(0.2, 1, 0.1, rng, 1.4), H(0, R * 1.42, R * 0.55, 0.5, 0, 0, 1.6, 0.5, 0.7), hi);
        rb.add(B.hairBack, new THREE.TorusGeometry(0.1, 0.02, 5, 12), H(0, R * 1.72, -R * 0.3, 1.2, 0, 0), shadeHex(L.top, 0.9));
        break;
      case 'bob':
        // A chin-length bob: tapered locks hanging round the sides and back (flat against the head,
        // tips flicking out a little), alternating lengths so the hem reads choppy, not a lumpy ring.
        for (let i = 0; i < 13; i++) {
          // (from 70° round: the front locks hung across the cheeks in the three-quarter bust)
          const a = Math.PI * 0.39 + (i / 12) * Math.PI * 1.22;
          const len = 0.24 + (i % 2) * 0.05 + (i % 3) * 0.015;
          const lock = new THREE.SphereGeometry(1, 9, 7);
          const pa = lock.attributes.position as THREE.BufferAttribute;
          for (let v = 0; v < pa.count; v++) {
            const y = pa.getY(v);
            const k = y < 0 ? 1 + y * 0.6 : 1;
            // taper to the tip and curl it outwards (+z = away from the head after rotateY)
            pa.setXYZ(v, pa.getX(v) * k, y, pa.getZ(v) * k + (y < 0 ? y * y * 0.5 : 0));
          }
          lock.computeVertexNormals();
          lock.scale(0.1 + (i % 3) * 0.012, len * 0.55, 0.06);
          lock.rotateY(a);
          const r = R * 0.98;
          rb.add(B.head, lock, H(Math.sin(a) * r, R * 0.78 - len * 0.18, Math.cos(a) * r - 0.02), i % 3 === 1 ? hi : hair);
        }
        // (the fringe is the shared teardrop locks above: a choppy edge, not three lumps)
        break;
      case 'cap': {
        // Baker's toque.
        // A pleated band (starched folds all the way round) under a gathered, billowing crown.
        // (cloth, not hair: the painter / portrait gate read the white toque as pale hair)
        rb.tag = 5;
        rb.add(B.head, pleat(new THREE.CylinderGeometry(R * 1.02, R * 1.04, 0.16, 48, 1, true), 16, 0.035), H(0, R * 1.55, -0.02, -0.12, 0, 0), 0xe8e0d0);
        const puff = pleat(lumpySphere(R * 1.05, 2, 0.1, rng, 1.6), 7, 0.07);
        puff.scale(1.12, 0.62, 1.12);
        rb.add(B.head, puff, H(0, R * 1.78, -0.05, -0.15, 0, 0), 0xece6da);
        rb.tag = 2;
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
          if (L.hat === 'beanie' && y > R * 1.45) continue;
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
      case 'spiky': {
        // Tousled tufts growing out of the shell (base buried, tip out along the surface normal,
        // flopping a little forwards / down): a scruffy kid's mop with a readable spiky silhouette.
        const c = new THREE.Vector3(0, R * 0.98, -0.02);
        const up = new THREE.Vector3(0, 1, 0);
        const q = new THREE.Quaternion();
        const tufts: [number, number, number][] = [[0, 0.12, 0.2], [0.55, 0.2, 0.19], [-0.55, 0.2, 0.19], [1.1, 0.3, 0.17], [-1.1, 0.3, 0.17], [1.7, 0.36, 0.16], [-1.7, 0.36, 0.16], [2.4, 0.3, 0.17], [-2.4, 0.3, 0.17], [3.1, 0.22, 0.18], [0.25, 0.3, 0.16], [-0.3, 0.32, 0.15], [0.9, 0.08, 0.14], [-0.9, 0.08, 0.14], [2.0, 0.12, 0.15], [-2.0, 0.12, 0.15]];
        tufts.forEach(([az, pol, len0], i) => {
          if (L.hat === 'beanie' && pol < 0.3) return;
          // (front tufts a little shorter: in the portrait's laugh / sad tilt they fell over the eyes)
          const len = Math.abs(az) < 0.7 ? len0 * 0.5 : Math.abs(az) < 1.2 ? len0 * 0.72 : len0;
          const th = pol * Math.PI;
          const dir = new THREE.Vector3(Math.sin(th) * Math.sin(az), Math.cos(th), Math.sin(th) * Math.cos(az));
          // Swept down along the scalp (towards the hem), tips lifting off: locks, not a chestnut burr.
          const down = new THREE.Vector3(Math.cos(th) * Math.sin(az), -Math.sin(th), Math.cos(th) * Math.cos(az));
          const flop = dir.clone().multiplyScalar(0.55).addScaledVector(down, 0.85).normalize();
          q.setFromUnitVectors(up, flop);
          const pos = c.clone().addScaledVector(dir, R * 1.0).addScaledVector(flop, len * 0.3);
          const cone = new THREE.ConeGeometry(0.085, len * 1.35, 7);
          cone.scale(1, 1, 0.55);
          rb.add(B.head, cone, H().multiply(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1))), i % 3 === 0 ? hi : hair);
        });
        break;
      }
      case 'braids':
        // Two plaits from behind the ears, over the shoulders and down the front of the chest (as in
        // the portrait): woven beads along a curve, a cloth tie at each end.
        for (const sx of [-1, 1]) {
          const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(sx * R * 0.9, R * 0.72, -R * 0.28),
            new THREE.Vector3(sx * R * 0.84, R * 0.22, 0),
            new THREE.Vector3(sx * R * 0.66, -R * 0.3, R * 0.58),
            new THREE.Vector3(sx * R * 0.6, -R * 0.82, R * 0.7),
          ]);
          // A tapered plait: a continuous core rope, then two rows of interlocking lobes tilted
          // alternately left / right along the tangent (the woven chevron of a real braid).
          const n = 13;
          const core = new THREE.TubeGeometry(curve, 16, 0.04, 7, false);
          {
            const pa = core.attributes.position as THREE.BufferAttribute;
            // Taper the core towards the tie: shrink each ring towards the curve point.
            const ctr = new THREE.Vector3();
            const v = new THREE.Vector3();
            for (let i = 0; i < pa.count; i++) {
              const ring = Math.floor(i / 8);
              const t = ring / 16;
              curve.getPoint(t, ctr);
              v.fromBufferAttribute(pa, i).sub(ctr).multiplyScalar(1 - t * 0.45).add(ctr);
              pa.setXYZ(i, v.x, v.y, v.z);
            }
          }
          rb.add(B.head, core, H(), shadeHex(hair, 0.8));
          const tan = new THREE.Vector3();
          const up = new THREE.Vector3(0, 1, 0);
          const q = new THREE.Quaternion();
          for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            const p = curve.getPoint(t);
            curve.getTangent(t, tan);
            q.setFromUnitVectors(up, tan.clone().negate());
            const side = i % 2 ? 1 : -1;
            const r = 0.05 * (1 - t * 0.42);
            const lobe = new THREE.SphereGeometry(r, 8, 6);
            lobe.scale(0.78, 1.55, 0.7);
            lobe.rotateZ(side * 0.62);
            lobe.translate(side * r * 0.42, 0, 0);
            lobe.applyQuaternion(q);
            lobe.translate(p.x, p.y, p.z);
            rb.add(B.head, lobe, H(), i % 2 ? hair : hi);
          }
          const e = curve.getPoint(1);
          rb.add(B.head, new THREE.SphereGeometry(0.034, 8, 6), H(e.x, e.y - 0.05, e.z + 0.01, 0, 0, 0, 1, 0.8, 1), L.hatColor ?? 0xc8412f);
          rb.add(B.head, new THREE.ConeGeometry(0.03, 0.08, 6), H(e.x, e.y - 0.11, e.z + 0.01, Math.PI, 0, 0), shadeHex(hair, 1.1));
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
        // A tweed newsboy cap: a soft crown pulled forward over the brim, eight panel seams meeting
        // at a covered button, a band round the head and a stiff curved peak.
        const crown = new THREE.SphereGeometry(R * 1.1, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.42);
        rb.add(B.head, crown, H(0, R * 1.1, 0.03, -0.2, 0, 0, 1.06, 0.8, 1.14), c);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const seam = new THREE.TorusGeometry(R * 1.1, 0.006, 3, 14, Math.PI * 0.4);
          seam.rotateZ(Math.PI * 0.1);
          seam.rotateY(Math.PI / 2 + a);
          rb.add(B.head, seam, H(0, R * 1.1, 0.03, -0.2, 0, 0, 1.065, 0.805, 1.145), shadeHex(c, 0.72));
        }
        rb.add(B.head, bevelCylinder(R * 1.06, R * 1.07, 0.07, 0.02, 24), H(0, R * 1.2, 0.0, -0.2, 0, 0), shadeHex(c, 0.78));
        const brim = new THREE.CylinderGeometry(R * 0.78, R * 0.78, 0.035, 18, 1, false, -Math.PI / 2, Math.PI);
        // (peak tipped up ~10°: the eyes read under it from the high lens)
        rb.add(B.head, brim, H(0, R * 1.28, R * 0.66, 0.09, 0, 0, 1.05, 1, 0.62), shadeHex(c, 0.66));
        rb.add(B.head, new THREE.TorusGeometry(R * 0.78, 0.008, 3, 16, Math.PI), H(0, R * 1.29, R * 0.66, Math.PI / 2 + 0.09, 0, 0, 1.05, 0.62, 1), shadeHex(c, 0.55));
        rb.add(B.head, new THREE.SphereGeometry(0.034, 8, 6), H(0, R * 1.97, -0.1, 0, 0, 0, 1, 0.6, 1), shadeHex(c, 0.7));
        // Flecks of tweed.
        for (let i = 0; i < 14; i++) {
          const a = rng.next() * Math.PI * 2;
          const up = 0.25 + rng.next() * 0.5;
          rb.add(B.head, new THREE.SphereGeometry(0.012, 4, 3), H(Math.sin(a) * Math.sin(up) * R * 1.16, R * 1.12 + Math.cos(up) * R * 0.86, Math.cos(a) * Math.sin(up) * R * 1.24 + 0.03), i % 2 ? shadeHex(c, 1.35) : shadeHex(c, 0.6));
        }
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
          rb.add(B.head, roundedBox(0.026, 0.09, 0.012, 0.005, 1), H(Math.sin(a) * R * 1.128, R * 1.4 + Math.cos(a) * R * 1.128 * 0.333, Math.cos(a) * R * 1.128 * 0.943 - 0.06, -0.34, a, 0), shadeHex(c, 0.84));
        }
        const pom = lumpySphere(0.075, 1, 0.22, rng, 3);
        rb.add(B.head, pom, H(-0.03, R * 2.36, -0.32), shadeHex(c, 1.08));
        break;
      }
      case 'sunhat': {
        // Brim kept modest (≈1.45 head radii) so the face still reads from the high camera.
        // Tipped back ~25° (brim front up): from the high diorama lens the face shows under it, not a disc.
        const tip = -0.43;
        const brim = new THREE.CylinderGeometry(R * 1.62, R * 1.72, 0.03, 30);
        rb.add(B.head, brim, H(0, R * 1.52, -0.05, tip, 0, 0), c);
        const crown = new THREE.SphereGeometry(R * 1.02, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
        rb.add(B.head, crown, H(0, R * 1.46, -0.08, tip, 0, 0, 1, 0.8, 1), shadeHex(c, 1.04));
        rb.add(B.head, new THREE.TorusGeometry(R * 1.0, 0.03, 6, 22), H(0, R * 1.56, -0.08, Math.PI / 2 + tip, 0, 0), L.scarf ?? 0xa8587a);
        for (let i = 0; i < 3; i++) rb.add(B.head, lumpySphere(0.05, 0, 0.3, rng), H(R * 0.75 + i * 0.03, R * 1.62, R * 0.4 - i * 0.05), [0xff8fab, 0xffd166, 0xffffff][i]!);
        break;
      }
      case 'earmuffs': {
        // Fluffy earmuffs: a slim band over the crown (sitting just on the hair) and two plush puffs
        // over the ears with a darker ring where they meet the head.
        const band = new THREE.TorusGeometry(R * 1.13, 0.024, 6, 22, Math.PI);
        rb.add(B.head, band, H(0, R * 0.95, -0.04, 0, 0, 0, 1, 1.02, 1).multiply(new THREE.Matrix4().makeRotationX(-0.18)), shadeHex(c, 0.75));
        for (const sx of [-1, 1]) {
          const puff = lumpySphere(0.14, 1, 0.16, rng, 2.6);
          puff.scale(0.62, 1, 1);
          rb.add(B.head, puff, H(sx * R * 1.08, R * 0.9, -0.03), c);
          rb.add(B.head, new THREE.TorusGeometry(0.1, 0.022, 6, 14), H(sx * R * 1.02, R * 0.9, -0.03, 0, Math.PI / 2, 0), shadeHex(c, 0.8));
        }
        break;
      }
      case 'bandana': {
        // A knotted headscarf hugging the crown: tilted back so the hairline and temples show (not a
        // helmet), flat printed polka dots (as in the portrait), a rolled hem, a knot and two tails.
        const tilt = -0.5;
        const rr = R * 1.075;
        const polar = Math.PI * 0.44;
        const T = (): THREE.Matrix4 => H(0, R * 0.98, -0.03, tilt, 0, 0);
        // Soft cloth folds gathered towards the knot (a sculpted shell, not a smooth dome).
        const dome = hairShell(rr, 0, polar, 7, 0.035, 0, 1.3, 0.2);
        // Hugging the skull (a low crown, not a helmet dome).
        dome.scale(1.0, 0.8, 1.03);
        rb.add(B.head, dome, T(), c);
        const hem = new THREE.TorusGeometry(rr * Math.sin(polar) * 1.03, 0.016, 6, 32);
        hem.rotateX(Math.PI / 2);
        hem.translate(0, rr * Math.cos(polar) * 0.8, 0);
        rb.add(B.head, hem, T(), shadeHex(c, 0.8));
        const N = 26;
        const dots: THREE.BufferGeometry[] = [];
        for (let i = 0; i < N; i++) {
          const a = (i * 2.399963) % (Math.PI * 2);
          const th = Math.acos(1 - ((i + 0.5) / N) * (1 - Math.cos(polar - 0.12)));
          const q = new THREE.Vector3(Math.sin(a) * Math.sin(th) * rr * 1.03, Math.cos(th) * rr * 0.83, Math.cos(a) * Math.sin(th) * rr * 1.06);
          const d = new THREE.CircleGeometry(0.027 + (i % 3) * 0.004, 10);
          d.lookAt(new THREE.Vector3(q.x / 1.08, q.y, q.z / 1.08));
          q.multiplyScalar(1.006);
          d.translate(q.x, q.y, q.z);
          dots.push(d);
        }
        for (const d of dots) rb.add(B.head, d, T(), 0xf6ecd8);
        // The knot at the nape and two tails fluttering down over the braids.
        rb.add(B.hairBack, lumpySphere(0.06, 1, 0.18, rng, 2), H(0, R * 0.86, -R * 1.1), shadeHex(c, 0.92));
        for (const sx of [-1, 1]) rb.add(B.hairBack, roundedBox(0.075, 0.2, 0.026, 0.02), H(sx * 0.05, R * 0.62, -R * 1.12, 0.18, 0, sx * 0.35), shadeHex(c, 0.86));
        break;
      }
    }
  }

  // ───────────────────────────────────────────── API

  /**
   * Hold a scene prop (heart events): parented to the spine so it follows sitting, bobbing and turning.
   * 'lap' rests it on the thighs (seated), 'chest' holds it up in front of the chest. Rig units.
   */
  /**
   * A received gift held up in both hands at the chest for the reaction line (r6 critic: the juice
   * was invisible in stills). `url` = the item's icon; dropped after `dur` s or by the next gift.
   */
  private heldIcon: THREE.Sprite | null = null;
  private heldT = 0;
  holdIcon(url: string, dur = 3.4): void {
    this.dropIcon();
    const tex = iconTexture(url);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    s.center.set(0.5, 0.25);
    s.scale.setScalar(0.4 / this.scaleS);
    s.position.set(0, 0.2 * (this.def.look.torso ?? 1), 0.32 + (this.def.look.belly ?? 0) * 0.1);
    s.renderOrder = 3;
    s.userData.noAO = true;
    this.bones[B.spine]!.add(s);
    this.heldIcon = s;
    this.heldT = dur;
    // Arms come up round it.
    this.gesture('chest', dur);
  }
  /** Put the held gift down (the conversation ended). */
  dropIcon(): void {
    if (!this.heldIcon) return;
    this.heldIcon.removeFromParent();
    this.heldIcon.material.dispose();
    this.heldIcon = null;
  }

  holdProp(obj: THREE.Object3D, pose: 'lap' | 'chest'): void {
    const spine = this.bones[B.spine]!;
    spine.add(obj);
    if (pose === 'lap') {
      obj.position.set(0, 0.06, 0.3);
      obj.rotation.set(0.62, 0, 0);
    } else {
      obj.position.set(0, 0.2, 0.3);
      obj.rotation.set(1.15, 0, 0);
    }
    obj.scale.setScalar(1 / Math.max(0.5, this.scaleS) * 1.15);
  }

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
    for (const [p, b] of this.propBones) if (p !== 'umbrella') b.scale.setScalar(list.includes(p) ? 1 : 0.0001);
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
    if (this.heldIcon) {
      this.heldT -= dt;
      this.heldIcon.position.y = 0.2 * (this.def.look.torso ?? 1) + Math.sin(this.t * 3) * 0.012;
      if (this.heldT <= 0) this.dropIcon();
    }
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
      if (this.talkCheat !== null) {
        const d = Math.atan2(Math.sin(this.talkCheat - this.targetYaw), Math.cos(this.talkCheat - this.targetYaw));
        this.targetYaw += THREE.MathUtils.clamp(d, -0.5, 0.5);
        // The head turns the rest of the way towards the lens (a stage cheat: the face reads).
        this.headCheat += (THREE.MathUtils.clamp(d - THREE.MathUtils.clamp(d, -0.5, 0.5), -0.45, 0.45) - this.headCheat) * (1 - Math.exp(-6 * dt));
      } else this.headCheat *= 1 - Math.min(1, dt * 6);
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
    // (dt = 0: a staging / audit settle — the pose snaps to its target)
    this.sitBlend += ((sitting ? 1 : 0) - this.sitBlend) * (dt === 0 ? 1 : 1 - Math.exp(-8 * dt));
    this.actBlend += ((act !== 'idle' && act !== 'chat' && act !== 'wander' && act !== 'inside' ? 1 : 0) - this.actBlend) * (dt === 0 ? 1 : 1 - Math.exp(-6 * dt));

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
        head.rotation.y = this.headCheat;
        head.rotation.x += Math.sin(this.talkT * 6) * 0.06;
        head.rotation.z = Math.sin(this.talkT * 2.3) * 0.05;
        aR.rotation.x = -0.7 + Math.sin(this.talkT * 3.1) * 0.25;
        aR.rotation.z = 0.35;
        fR.rotation.x = -0.9 + Math.sin(this.talkT * 3.1 + 0.5) * 0.3;
      } else {
        this.lookT -= dt;
        if (this.lookT <= 0) {
          if (this.lensYaw !== null && this.lookTarget === 0) {
            // Glances favour the lens side (a face, not the back of a hat, from the diorama camera).
            let d = this.lensYaw - this.yaw;
            d = Math.atan2(Math.sin(d), Math.cos(d));
            const toward = THREE.MathUtils.clamp(d, -0.75, 0.75);
            this.lookTarget = Math.abs(toward) < 0.25 ? (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.2) : toward * (0.65 + Math.random() * 0.35);
          } else this.lookTarget = this.lookTarget !== 0 ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.4);
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
    // Seated head turn towards a speaker (body stays square to the bench).
    {
      let want = 0;
      if (this.headLook && this.sitBlend > 0.5) {
        const d = Math.atan2(this.headLook.x - this.position.x, this.headLook.z - this.position.z) - this.yaw;
        want = THREE.MathUtils.clamp(Math.atan2(Math.sin(d), Math.cos(d)), -1.05, 1.05);
      }
      this.headLookY += (want - this.headLookY) * (1 - Math.exp(-6 * dt));
      if (Math.abs(this.headLookY) > 0.002) {
        head.rotation.y = this.headLookY + head.rotation.y * 0.3;
        spine.rotation.y += this.headLookY * 0.25;
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
    // Rain: the umbrella goes up in the left hand (the cane hand too) whenever it is free.
    const ub = this.propBones.get('umbrella');
    if (ub) {
      const want = this.rain && (this.moving || UMBRELLA_OK.has(act)) ? 1 : 0;
      this.umbrellaUp += (want - this.umbrellaUp) * (1 - Math.exp(-7 * dt));
      const k = this.umbrellaUp;
      ub.scale.setScalar(k > 0.02 ? Math.max(0.0001, Math.min(1, k * 1.4)) : 0.0001);
      if (k > 0.02) {
        aL.rotation.x = THREE.MathUtils.lerp(aL.rotation.x, -0.62, k);
        aL.rotation.z = THREE.MathUtils.lerp(aL.rotation.z, 0.05, k);
        fL.rotation.x = THREE.MathUtils.lerp(fL.rotation.x, -0.95, k);
        fL.rotation.z = THREE.MathUtils.lerp(fL.rotation.z, 0, k);
        // Keep the shaft upright over the head whatever the arm and spine do.
        ub.rotation.x = -(aL.rotation.x + fL.rotation.x + spine.rotation.x) - 0.08;
        ub.rotation.z = -(aL.rotation.z + fL.rotation.z) + 0.12;
      }
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
    // (hats: a little more — the brim must not hide the eyes from the 36° lens)
    head.rotation.x -= FACE_UP + (this.def.look.hat && this.def.look.hat !== 'earmuffs' && this.def.look.hat !== 'bandana' ? 0.07 : 0);
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
    this.applyFace(dt, act);
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
      // (big reactions — a loved gift — leave the ground: a 0.3 s hop off the stretch)
      if (t > 0.1) this.body.position.y += Math.max(0, Math.sin(((t - 0.1) / 0.3) * Math.PI)) * (k > 1.5 ? 0.22 * (k - 1) : 0.07 * k) * (t < 0.4 ? 1 : 0);
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
    // Speech bark: a short line in a parchment bubble (pops in, bobs, fades); it replaces the emote.
    if (this.barkSprite && this.barkSprite.visible) {
      this.barkT -= dt;
      const age = this.barkDur - this.barkT;
      const pop = age < 0.3 ? THREE.MathUtils.smoothstep(age, 0, 0.2) * (1 + 0.18 * Math.sin((age / 0.3) * Math.PI)) : 1;
      const fade = THREE.MathUtils.clamp(this.barkT / 0.35, 0, 1);
      // (≈ 19 px text at 1080p from the 27 m town lens: r3 critic found 14 px barks too small)
      const h = 0.88 * pop;
      this.barkSprite.scale.set(h * this.barkAspect, h, 1);
      this.barkLiftCur += (this.barkLift - this.barkLiftCur) * Math.min(1, dt * 8);
      this.barkSprite.position.set(this.barkSide * h * this.barkAspect * 0.32, this.headTop + 0.6 + this.barkLiftCur + Math.sin(age * 2.2) * 0.025, 0);
      this.barkSprite.material.opacity = fade;
      if (this.emoteSprite) this.emoteSprite.visible = false;
      if (this.barkT <= 0) this.barkSprite.visible = false;
    }
  }

  private barkSprite: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private barkT = 0;
  private barkDur = 3.4;
  private barkAspect = 3;
  /** Bubble shifted to the open side (-1 left, 0 centred, 1 right) when a neighbour stands close. */
  private barkSide = 0;
  /**
   * Extra height for the speech bubble (m): NpcSystem raises it over a co-op farmer's name tag that
   * would otherwise clip its first words (a screen-space repulsion, eased).
   */
  barkLift = 0;
  private barkLiftCur = 0;
  /** Say a short line out loud (street chatter): a speech bubble over the head for `dur` s. */
  bark(text: string, dur = 3.4, side = 0): void {
    this.barkSide = side;
    const { tex, aspect } = barkTexture(text);
    if (!this.barkSprite) {
      this.barkSprite = billboard(tex, 21);
      this.barkSprite.name = 'npc-bark';
      this.barkSprite.userData.perfTag = 'npcs';
      this.root.add(this.barkSprite);
    }
    this.barkSprite.material.map = tex;
    this.barkSprite.material.needsUpdate = true;
    this.barkSprite.visible = true;
    this.barkAspect = aspect;
    this.barkT = this.barkDur = dur;
  }

  /** Drop any speech bark at once (a conversation / scene takes the stage). */
  hush(): void {
    if (this.barkSprite) this.barkSprite.visible = false;
    this.barkT = 0;
  }

  get barking(): boolean {
    return !!this.barkSprite?.visible;
  }

  /** Facial expression the villager wears (follows the dialogue line's [mood] tag; 'neutral' = resting face). */
  private mood = 'neutral';
  private moodT = 1;

  /** Swap the 3D face to a mood (the same tag that swaps the portrait): brows, eyes, mouth, tear, blush. */
  setMood(m: string): void {
    if (m === this.mood) return;
    this.mood = m;
    this.moodT = 0;
  }

  get currentMood(): string {
    return this.mood;
  }

  /**
   * Face rig per frame: blinks, the mood's brows / eyes / mouth (blended in over ~120 ms), mouth
   * flaps while speaking. Laughs close the eyes into "^" arcs, sorrow tents the brows and wells a
   * tear, anger knits them into a V, surprise pops the eyes and rounds the mouth.
   */
  private applyFace(dt: number, act: Activity): void {
    const bn = this.bones;
    this.moodT += dt;
    const w = THREE.MathUtils.smoothstep(this.moodT, 0, 0.12);
    const m = this.mood;
    // brow: [inner tilt (rad, + = inner end down), lift (m)], eye scale y, mouth [sx, sy, flip]
    // Resting face: a small, calm mouth (a contented "neutral", clearly apart from the open happy smile).
    let tilt = 0;
    let lift = 0;
    let eyeY = 1;
    let eyeX = 1;
    let mx = 0.72;
    let my = 0.55;
    let flip = false;
    let closed = false;
    let tear = false;
    let blush = false;
    let furrow = false;
    let browAsym = 0;
    let smirk = 0;
    switch (m) {
      case 'happy':
        // Cheeks lift into the eyes (a squinting smile), brows up, an open grin.
        eyeY = 0.66;
        mx = 1.4;
        my = 1.9;
        lift = 0.018;
        tilt = -0.1;
        break;
      case 'laugh':
        closed = true;
        mx = 1.45;
        my = 3.1;
        lift = 0.026;
        tilt = -0.16;
        break;
      case 'sad':
        tilt = -0.55;
        lift = 0.012;
        eyeY = 0.72;
        mx = 0.8;
        my = 0.9;
        flip = true;
        tear = true;
        break;
      case 'worried':
        tilt = -0.46;
        lift = 0.016;
        eyeY = 1.02;
        mx = 0.75;
        my = 0.85;
        flip = true;
        break;
      case 'angry':
        // Brows knit hard into a V (≈35°) and drop onto narrowed eyes; a crease between them.
        tilt = 0.62;
        lift = -0.03;
        eyeY = 0.56;
        eyeX = 1.05;
        mx = 1.2;
        my = 0.75;
        flip = true;
        furrow = true;
        break;
      case 'surprised':
        lift = 0.05;
        eyeY = 1.3;
        eyeX = 1.15;
        // (a round 'o', not a streak: r6 Marigold's gasp ran down her chin like drool)
        mx = 0.72;
        my = 2.1;
        break;
      case 'blush':
        blush = true;
        eyeY = 0.74;
        mx = 0.85;
        my = 1.05;
        tilt = -0.2;
        break;
      case 'wistful':
        // Fond sorrow: lids lowered, a soft closed smile, brows gently tented, one tear.
        eyeY = 0.5;
        mx = 0.85;
        my = 0.62;
        tilt = -0.28;
        lift = 0.006;
        tear = true;
        break;
      case 'thinking':
        // One brow up, eyes narrowed, the mouth pressed into a lopsided "hmm".
        browAsym = 0.045;
        eyeY = 0.74;
        mx = 0.62;
        my = 0.3;
        smirk = 0.32;
        break;
    }
    const L = (a: number, b: number): number => a + (b - a) * w;
    // Blinks close the eyes briefly; reading villagers look down through half-lids.
    const blinkS = this.blinkT > 0 ? 0.12 : act === 'read' ? 0.55 : 1;
    const ey = closed ? 0.0001 : Math.min(blinkS, L(1, eyeY));
    const ex = closed ? 0.0001 : L(1, eyeX);
    bn[B.eyeL]!.scale.set(ex, ey, ex);
    bn[B.eyeR]!.scale.set(ex, ey, ex);
    const lid = closed ? Math.max(0.0001, w) : 0.0001;
    bn[B.lidL]!.scale.setScalar(lid);
    bn[B.lidR]!.scale.setScalar(lid);
    const bL = bn[B.browL]!;
    const bR = bn[B.browR]!;
    // Left brow: inner end is +x, so a positive tilt (inner down) is a clockwise (negative z) turn.
    bL.rotation.z = -L(0, tilt);
    bR.rotation.z = L(0, tilt);
    bL.position.y += L(0, lift);
    bR.position.y += L(0, lift + browAsym);
    bn[B.tear]!.scale.setScalar(tear ? Math.max(0.0001, w * (1 + Math.sin(this.t * 2.2) * 0.06)) : 0.0001);
    bn[B.tear]!.position.y -= tear ? ((this.t * 0.02) % 0.03) : 0;
    bn[B.blush]!.scale.setScalar(blush ? Math.max(0.0001, w) : 0.0001);
    bn[B.furrow]!.scale.setScalar(furrow ? Math.max(0.0001, w) : 0.0001);
    const mouth = bn[B.mouth]!;
    let sx = L(1, mx);
    let sy = L(1, my);
    if (this.speaking) {
      const flap = 0.5 + 0.5 * Math.abs(Math.sin(this.t * 17)) * (0.6 + 0.4 * Math.sin(this.t * 5.3));
      sx *= 1 - flap * 0.2;
      sy *= 1 + flap * (m === 'surprised' || m === 'laugh' ? 0.5 : 1.6);
    }
    // The open mouth stays inside the chin whatever the mood + talk flap.
    mouth.scale.set(sx, Math.min(sy, 2.4), 1);
    if (flip) mouth.rotation.z = Math.PI * w;
    else if (smirk) mouth.rotation.z = smirk * w;
  }

  /**
   * Portrait pose (ui/portraits renders this very model for the dialogue card, so face and portrait
   * are one character): the mood's face and gesture at their peak, no blink / glance / talk flap.
   */
  posePortrait(mood: string, yaw: number): void {
    this.look = this.lookTarget = 0;
    this.lookT = 1e9;
    this.nextBlink = 1e9;
    this.blinkT = 0;
    this.speaking = false;
    this.talkTo = null;
    this.talkCheat = null;
    this.rain = false;
    this.target = null;
    this.squashT = -1;
    this.setActivity('idle');
    this.mood = '';
    this.setMood(mood);
    const g = MOOD_GESTURE[mood];
    this.gest = null;
    if (g && g !== 'nod') this.gesture(g, 1e9);
    this.t = 0.6;
    this.setPosition(0, 0, 0);
    this.setYaw(yaw);
    for (let i = 0; i < 14; i++) this.update(1 / 24, () => 0, false);
    this.root.updateMatrixWorld(true);
  }

  /**
   * Portrait linework: the brows, the furrow and the mouth are drawn as 2D ink strokes over the
   * painted bust (renderVillagerPortrait), so the rig's versions are tucked away, and the feature
   * anchors (eye / brow / mouth centres, world space) are handed to the drawing.
   */
  portraitFeatures(): { eyeL: THREE.Vector3; eyeR: THREE.Vector3; browL: THREE.Vector3; browR: THREE.Vector3; mouth: THREE.Vector3 } {
    const bn = this.bones;
    const at = (b: B): THREE.Vector3 => bn[b]!.getWorldPosition(new THREE.Vector3());
    const out = { eyeL: at(B.eyeL), eyeR: at(B.eyeR), browL: at(B.browL), browR: at(B.browR), mouth: at(B.mouth) };
    for (const b of [B.mouth, B.browL, B.browR, B.furrow]) bn[b]!.scale.setScalar(0.0001);
    this.root.updateMatrixWorld(true);
    return out;
  }

  /** World centre of the head sphere (portrait framing) and its world radius. */
  headCenter(out: THREE.Vector3): { center: THREE.Vector3; radius: number } {
    const hs = 1.15 * HEAD_BOOST * (this.def.look.head ?? 1);
    this.bones[B.head]!.localToWorld(out.set(0, 0.32 * 0.92 * hs, 0));
    return { center: out, radius: 0.32 * hs * this.scaleS };
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
        // (a small nod down: the diorama lens sits above, a deep bow would show only the crown)
        head.rotation.x += 0.2 * w;
        spine.rotation.x += 0.1 * w;
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
        // Hopscotch between laps: fists on hips (elbows out), one knee tucked, a springy hop that
        // alternates legs every other beat; the free arm pumps a little on the take-off.
        const beat = t * 2.6;
        const side = Math.floor(beat / 2) % 2 ? 1 : -1;
        const ph = beat % 1;
        const h = Math.sin(ph * Math.PI);
        this.hop = h * 0.1 * k;
        const sL2 = bn[B.shinL]!;
        const sR2 = bn[B.shinR]!;
        const tuck = side < 0 ? [tL, sL2] : [tR, sR2];
        tuck[0]!.rotation.x = lerp(0, -0.55, k);
        tuck[1]!.rotation.x = lerp(0, 1.25, k);
        // Hands on hips: upper arm out to the side and back, forearm folded in towards the waist.
        aL.rotation.x = lerp(0, 0.25, k);
        aR.rotation.x = lerp(0, 0.25, k);
        aL.rotation.z = lerp(-0.12, -0.62 - h * 0.08, k);
        aR.rotation.z = lerp(0.12, 0.62 + h * 0.08, k);
        fL.rotation.z = lerp(0, 1.35, k);
        fR.rotation.z = lerp(0, -1.35, k);
        fL.rotation.x = lerp(-0.15, -0.35, k);
        fR.rotation.x = lerp(-0.15, -0.35, k);
        spine.rotation.z = side * 0.07 * k;
        head.rotation.z = -side * 0.1 * k;
        head.rotation.x += (0.1 - h * 0.12) * k;
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

/**
 * A candle in a glass jar on a saucer (heart-event prop, June's window candle): wax, a wick, a
 * flame bright enough to bloom, a soft warm halo billboard and a flicker. Origin at the saucer.
 */
export function buildCandle(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'npc-candle';
  const std = (c: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });
  const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.025, 16), std(0x8a5a3a, { metalness: 0.3, roughness: 0.4 }));
  saucer.position.y = 0.012;
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.048, 0.13, 14), std(0xf6ecd6, { roughness: 0.5, emissive: 0xffb060, emissiveIntensity: 0.25 }));
  wax.position.y = 0.09;
  const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.2, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xffe8c8, transparent: true, opacity: 0.28, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }));
  jar.position.y = 0.12;
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.78, 0.4).multiplyScalar(4), toneMapped: false }));
  flame.scale.set(1, 1.9, 1);
  flame.position.y = 0.19;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,214,150,0.85)');
  gr.addColorStop(0.35, 'rgba(255,170,90,0.3)');
  gr.addColorStop(1, 'rgba(255,150,70,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const halo = billboard(tex, 19);
  (halo.material as THREE.MeshBasicMaterial).blending = THREE.AdditiveBlending;
  (halo.material as THREE.MeshBasicMaterial).depthTest = true;
  halo.scale.setScalar(0.62);
  halo.position.y = 0.19;
  for (const m of [saucer, wax, jar, flame]) {
    m.castShadow = false;
    m.userData.noAO = true;
    g.add(m);
  }
  g.add(halo);
  flame.onBeforeRender = () => {
    const t = performance.now() / 1000;
    const f = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.06;
    flame.scale.set(1, 1.9 * f, 1);
    halo.scale.setScalar(0.62 * (0.94 + 0.06 * f));
  };
  return g;
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

/** Speech-bark bubbles: one canvas texture per line (a handful per villager), cached. */
const BARK_TEX = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>();
function barkTexture(text: string): { tex: THREE.CanvasTexture; aspect: number } {
  const hit = BARK_TEX.get(text);
  if (hit) return hit;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = '800 38px Nunito, "Trebuchet MS", sans-serif';
  g.font = font;
  const tw = Math.ceil(g.measureText(text).width);
  const W = tw + 70;
  const BH = 86;
  c.width = W;
  c.height = BH + 30;
  g.font = font;
  const r = 34;
  const path = (): void => {
    g.beginPath();
    g.moveTo(8 + r, 8);
    g.arcTo(W - 8, 8, W - 8, BH, r);
    g.arcTo(W - 8, BH, 8, BH, r);
    // the tail, down-left of centre, pointing at the speaker's head
    g.lineTo(W / 2 + 4, BH);
    g.lineTo(W / 2 - 14, BH + 24);
    g.lineTo(W / 2 - 22, BH);
    g.arcTo(8, BH, 8, 8, r);
    g.arcTo(8, 8, W - 8, 8, r);
    g.closePath();
  };
  g.shadowColor = 'rgba(60,30,10,0.35)';
  g.shadowBlur = 8;
  g.shadowOffsetY = 3;
  g.fillStyle = '#fff6e2';
  path();
  g.fill();
  g.shadowColor = 'transparent';
  g.lineWidth = 5;
  g.strokeStyle = '#8a5a34';
  path();
  g.stroke();
  // A soft inner highlight along the top edge (parchment, not plastic).
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(8 + r, 14);
  g.lineTo(W - 8 - r, 14);
  g.stroke();
  g.fillStyle = '#4a2c18';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, W / 2, BH / 2 + 5);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const out = { tex, aspect: c.width / c.height };
  BARK_TEX.set(text, out);
  return out;
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
  private toss: { s: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; done: () => void; hold?: number } | null = null;
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
  tossItem(url: string, from: THREE.Vector3, to: THREE.Vector3, done: () => void, dur = 0.52): void {
    const tex = iconTexture(url);
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
      // Ease-in-out flight with a high arc; on the catch a short hit-stop (~2 frames) with a squash
      // pulse before the item settles into the villager's hands.
      const e = u * u * (3 - 2 * u);
      k.s.position.lerpVectors(k.from, k.to, e);
      k.s.position.y += Math.sin(e * Math.PI) * 0.85;
      k.s.userData.rot = e * 5;
      k.s.scale.setScalar(0.46 * (1 - 0.3 * e));
      if (u >= 1 && k.hold === undefined) k.hold = 0.07;
      if (k.hold !== undefined) {
        k.hold -= dt;
        k.s.scale.set(0.46 * 0.7 * 1.25, 0.46 * 0.7 * 0.8, 1);
      }
      if (k.hold !== undefined && k.hold <= 0) {
        k.s.removeFromParent();
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

/**
 * Wren's river painting on a low field stand (heart event prop): a hand-painted canvas texture —
 * swirling blue-green water that is more feeling than river, a stone bridge arc, a lemon sun —
 * facing +z, ~1 m tall.
 */
export function buildPainting(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'npc-painting';
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 208;
  const x = c.getContext('2d')!;
  const sky = x.createLinearGradient(0, 0, 0, 110);
  sky.addColorStop(0, '#f6d7a8');
  sky.addColorStop(1, '#bfe0e8');
  x.fillStyle = sky;
  x.fillRect(0, 0, 256, 208);
  // Sun + far hills.
  x.fillStyle = '#ffd35a';
  x.beginPath();
  x.arc(196, 40, 20, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#8fbf6a';
  x.beginPath();
  x.moveTo(0, 96);
  x.quadraticCurveTo(60, 60, 130, 90);
  x.quadraticCurveTo(190, 70, 256, 92);
  x.lineTo(256, 208);
  x.lineTo(0, 208);
  x.fill();
  // The river: bold swirls in five blues and greens (it will not sit still).
  const cols = ['#2f6f9a', '#3f8fb8', '#5ab0c8', '#7ad0c0', '#e8f4f0', '#2a5a7a'];
  let s = 7;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
  x.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const cx = rnd() * 256;
    const cy = 112 + rnd() * 96;
    const r = 6 + rnd() * 18;
    x.strokeStyle = cols[i % cols.length]!;
    x.lineWidth = 3 + rnd() * 5;
    x.beginPath();
    x.arc(cx, cy, r, rnd() * 6, rnd() * 6 + 3.5);
    x.stroke();
  }
  // The bridge.
  x.strokeStyle = '#a89078';
  x.lineWidth = 12;
  x.beginPath();
  x.arc(128, 150, 70, Math.PI * 1.1, Math.PI * 1.9);
  x.stroke();
  x.strokeStyle = '#6a5040';
  x.lineWidth = 3;
  x.beginPath();
  x.arc(128, 150, 62, Math.PI * 1.12, Math.PI * 1.88);
  x.stroke();
  // Signature dab.
  x.fillStyle = '#c8412f';
  x.fillRect(222, 190, 18, 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const wood = new THREE.MeshStandardMaterial({ color: 0xa87a50, roughness: 0.8 });
  const art = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.585), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  art.position.set(0, 0.78, 0.035);
  art.rotation.x = -0.14;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.625, 0.03), new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.9 }));
  back.position.set(0, 0.78, 0.015);
  back.rotation.x = -0.14;
  g.add(art, back);
  for (const [px, rz, rx, h] of [[-0.3, -0.1, -0.14, 1.12], [0.3, 0.1, -0.14, 1.12], [0, 0, 0.4, 1.05]] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, h, 0.04), wood);
    leg.position.set(px, h / 2 - 0.02, rx > 0 ? -0.2 : 0);
    leg.rotation.set(rx, 0, rz);
    g.add(leg);
  }
  const ledge = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.04, 0.09), wood);
  ledge.position.set(0, 0.47, 0.06);
  g.add(ledge);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return g;
}

// ───────────────────────────────────────────── portraits (the dialogue card is this model)

/** Per-mood three-quarter turn of the bust (towards the dialogue text on the card's left). */
const PORTRAIT_TURN: Record<string, number> = { neutral: -0.38, happy: -0.32, laugh: -0.26, sad: -0.52, angry: -0.12, surprised: -0.08, blush: -0.62, worried: -0.4, thinking: -0.58, wistful: -0.5 };

let portraitRig: {
  r: THREE.WebGLRenderer;
  scene: THREE.Scene;
  cam: THREE.PerspectiveCamera;
  models: Map<string, Villager>;
  /** Neutral-pose head centre / radius per model: every mood is cropped to it (r7: June's laugh lost her hair). */
  frames: Map<string, { c: THREE.Vector3; r: number }>;
  size: number;
  rtLit: THREE.WebGLRenderTarget;
  rtId: THREE.WebGLRenderTarget;
  rtN: THREE.WebGLRenderTarget;
  nMat: THREE.MeshNormalMaterial;
  idMat: THREE.ShaderMaterial;
  paint: THREE.ShaderMaterial;
  quad: THREE.Scene;
  quadCam: THREE.Camera;
} | null = null;

/** Painted pass switch (A/B shots: `__game` eval can't reach it, the portraits module re-exports it). */
export const PORTRAIT_PAINT = { on: true };

/**
 * Id pass: flat albedo (vertex colour) + the material part id (RigBuilder 'part') in alpha.
 * Skinned like the real material, no lighting.
 */
function portraitIdMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      attribute float part;
      varying vec3 vCol;
      varying float vPart;
      void main() {
        vCol = color;
        vPart = part;
        #include <skinbase_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        #include <project_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      varying float vPart;
      void main() { gl_FragColor = vec4(vCol, (floor(vPart + 0.5) + 1.0) / 8.0); }`,
    blending: THREE.NoBlending,
    toneMapped: false,
  });
}

/**
 * The painter: turns the lit render into an illustration — Kuwahara brush patches, coloured ink
 * lines on every material boundary (eyes, mouth, hair line, collars, apron…), painted hair (strand
 * strokes + a jagged "angel ring" shine on the lit side), warm skin shadows / cool cloth shadows,
 * a painted rim light off the silhouette's back edge, and a canvas tooth.
 */
function portraitPainter(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tLit: { value: null },
      tId: { value: null },
      tN: { value: null },
      px: { value: new THREE.Vector2() },
      crown: { value: new THREE.Vector2() },
      headC: { value: new THREE.Vector2() },
      headR: { value: 0.2 },
      rimCol: { value: new THREE.Color(1.0, 0.86, 0.62) },
      seed: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tLit;
      uniform sampler2D tId;
      uniform sampler2D tN;
      uniform vec2 px;
      uniform vec2 crown;
      uniform vec2 headC;
      uniform float headR;
      uniform vec3 rimCol;
      uniform float seed;
      varying vec2 vUv;
      float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vn(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
      }
      vec4 lit(vec2 uv) { vec4 c = texture2D(tLit, uv); c.rgb /= max(c.a, 0.002); return c; }
      float partAt(vec2 uv) { return floor(texture2D(tId, uv).a * 8.0 + 0.5) - 1.0; }
      float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      // Kuwahara: the flattest of four quadrant means (brush patches with crisp edges).
      vec3 kuwahara(vec2 uv, float r) {
        vec3 best = vec3(0.0); float bv = 1e9;
        for (int q = 0; q < 4; q++) {
          vec2 dir = vec2(q == 0 || q == 2 ? -1.0 : 1.0, q < 2 ? -1.0 : 1.0);
          vec3 m = vec3(0.0); float s = 0.0; float s2 = 0.0; float n = 0.0;
          for (int j = 0; j <= 3; j++) for (int i = 0; i <= 3; i++) {
            vec2 o = dir * vec2(float(i), float(j)) * r / 3.0;
            vec4 c = lit(uv + o * px);
            float w = step(0.5, c.a);
            float l = luma(c.rgb);
            m += c.rgb * w; s += l * w; s2 += l * l * w; n += w;
          }
          if (n < 1.0) continue;
          m /= n; s /= n;
          float v = s2 / n - s * s;
          if (v < bv) { bv = v; best = m; }
        }
        return best;
      }
      void main() {
        vec4 base = lit(vUv);
        float a = texture2D(tLit, vUv).a;
        if (a < 0.004) { gl_FragColor = vec4(0.0); return; }
        vec4 idc = texture2D(tId, vUv);
        float part = floor(idc.a * 8.0 + 0.5) - 1.0;
        bool eyeish = part > 2.5 && part < 3.5;
        // (6 = facial hair: beards / moustaches paint as hair but the portrait gate tells them apart)
        bool hairish = (part > 1.5 && part < 2.5) || part > 5.5;
        // Fine brush near the eyes (they stay crisp), broad patches elsewhere.
        vec3 col = eyeish ? base.rgb : mix(base.rgb, kuwahara(vUv, hairish ? 3.5 : 3.0), 0.85);
        float L = luma(col);
        // Posterised ramps (r6): the light on the surface (lit ÷ flat albedo) picks one of four
        // hand-tuned tones per material — a hue-shifted core shadow (rosy skin, cool cloth, a dark
        // violet hair core), the local colour, a warm light and a glint — with anti-aliased steps, the
        // way an illustrator blocks a bust in. A little of the smooth render stays under it for form.
        if (!eyeish) {
          vec3 alb = idc.rgb;
          float al = max(luma(alb), 0.02);
          float sh = L / al;
          float b1 = smoothstep(0.5, 0.58, sh);
          float b2 = smoothstep(1.02, 1.12, sh);
          float b3 = smoothstep(1.55, 1.7, sh);
          vec3 sC; vec3 mC; vec3 lC; vec3 gC;
          if (part > 0.5 && part < 1.5) {
            sC = alb * vec3(0.8, 0.6, 0.58); mC = alb * 0.93; lC = alb * 1.1 + vec3(0.035, 0.02, 0.0); gC = alb * 1.28;
          } else if (hairish) {
            // (hue-kept ramp: the old glint mixed 30 % white in — dark hair, whose lit / albedo ratio
            // always lands in the top band, came out pale grey: r6 Rowan)
            sC = alb * vec3(0.36, 0.33, 0.46); mC = alb * 0.86; lC = alb * 1.22; gC = alb * 1.55 + vec3(0.025, 0.02, 0.015);
          } else {
            sC = alb * vec3(0.44, 0.45, 0.6); mC = alb * 0.88; lC = alb * 1.08 + vec3(0.03, 0.02, 0.0); gC = alb * 1.22;
          }
          vec3 post = mix(mix(mix(sC, mC, b1), lC, b2), gC, b3);
          col = mix(col, post, 0.8);
          L = luma(col);
        }
        float shadow = smoothstep(0.42, 0.06, L);
        float light = smoothstep(0.5, 1.0, L);
        if (part > 0.5 && part < 1.5) {
          // Skin: shadows warm towards rose (blood under the skin), lights a touch of peach.
          col = mix(col, col * vec3(1.06, 0.86, 0.84), shadow * 0.35);
          col += vec3(0.05, 0.025, 0.0) * light;
        } else if (hairish) {
          // Hair: radial strand strokes from the crown, a jagged shine band on the lit side.
          vec2 d = (vUv - crown) / headR;
          d.y *= -1.0;
          float rr = length(d);
          float th = atan(d.x, -d.y);
          float wob = vn(vec2(rr * 3.0, th * 2.0 + seed)) * 0.6;
          // Clump rim: a hair pixel whose neighbour towards the key (upper left) is not hair gets
          // a light edge — each lock / the outer contour reads as a lit shape, not noise.
          float pk = partAt(vUv + vec2(-3.5, 3.5) * px);
          float ak = texture2D(tLit, vUv + vec2(-3.5, 3.5) * px).a;
          float rimH = ((abs(pk - 2.0) > 0.5 && pk < 5.5) || ak < 0.5) ? 1.0 : 0.0;
          col = mix(col, col * 1.42 + vec3(0.035, 0.028, 0.02), rimH * 0.6);
          float zig = abs(fract(th * 6.5 + 0.25) - 0.5) * 0.22;
          float ring = 1.0 - smoothstep(0.0, 0.07, abs(rr - 0.74 - zig));
          float sideLit = smoothstep(0.35, -0.55, d.x) * smoothstep(-1.2, 0.2, d.y);
          // (hue-kept: a dark brown shine is a lighter brown, never a grey band — r6 Rowan)
          vec3 shine = col * 1.62 + vec3(0.06, 0.05, 0.035);
          col = mix(col, shine, ring * sideLit * 0.85 * (0.4 + 0.6 * smoothstep(0.05, 0.4, L)));
          // A couple of loose fly-away highlight strokes.
          float hl = smoothstep(0.035, 0.0, abs(fract(th * 4.0 + wob * 2.0) - 0.5)) * smoothstep(0.3, 0.6, rr) * smoothstep(1.3, 0.8, rr);
          col = mix(col, shine, hl * sideLit * 0.45);
        } else if (part > 3.5 && part < 5.5) {
          // Cloth / hats: cool violet shadows, warm lights.
          col = mix(col, col * vec3(0.84, 0.86, 1.08), shadow * 0.7);
          col += vec3(0.05, 0.035, 0.0) * light;
        }
        // Ink: material boundaries (part change) always, colour boundaries when strong.
        float ink = 0.0;
        vec3 c0 = idc.rgb;
        vec3 n0 = texture2D(tN, vUv).rgb * 2.0 - 1.0;
        for (int k = 0; k < 8; k++) {
          float ang = float(k) * 0.7853982;
          vec2 dir = vec2(cos(ang), sin(ang));
          // Material boundaries: a bold line (~4 px at 560); colour edges inside a material: fine.
          vec4 n = texture2D(tId, vUv + dir * 3.6 * px);
          float pn = floor(n.a * 8.0 + 0.5) - 1.0;
          float e = 0.0;
          if (pn > -0.5 && abs(pn - part) > 0.5) {
            e = (pn > 2.5 && pn < 3.5) || eyeish ? 1.0 : 0.92;
          } else {
            vec4 nf = texture2D(tId, vUv + dir * 2.0 * px);
            float pf = floor(nf.a * 8.0 + 0.5) - 1.0;
            if (pf > -0.5 && abs(pf - part) < 0.5) {
              vec3 dc = abs(nf.rgb - c0);
              e = smoothstep(0.1, 0.26, max(dc.r, max(dc.g, dc.b))) * (hairish ? 0.3 : part > 4.5 && part < 5.5 ? 0.25 : 0.7);
            }
          }
          // Contour lines inside one material where the surface folds away (jaw over the neck,
          // the nose, ears, an arm over the chest): a normal break, heavier on the shadow side.
          vec4 nn = texture2D(tN, vUv + dir * 2.6 * px);
          if (nn.a > 0.5 && pn > -0.5 && !eyeish) {
            float cr = smoothstep(0.72, 0.3, dot(n0, nn.rgb * 2.0 - 1.0));
            e = max(e, cr * (hairish ? 0.45 : 0.75) * (0.55 + 0.45 * shadow));
          }
          ink = max(ink, e);
        }
        // Ink inside the eyes themselves: none (keeps the catch-lights clean).
        if (eyeish) ink *= 0.0;
        vec3 inkC = mix(col * vec3(0.3, 0.2, 0.2), vec3(0.08, 0.04, 0.03), 0.55);
        col = mix(col, inkC, ink * 0.92);
        // Painted rim: the silhouette's back edge (upper right) catches the warm light behind.
        float a2 = texture2D(tLit, vUv + vec2(5.5, -3.5) * px).a;
        float rim = a * (1.0 - a2);
        col += rimCol * rim * 0.5 * (1.0 - ink);
        // Gentle saturation lift + canvas tooth + a hint of directional brush grain.
        float g = luma(col);
        col = mix(vec3(g), col, 1.1);
        vec2 sp = vUv / px;
        float tooth = vn(sp * 0.45) * 0.6 + vn(sp * 1.3) * 0.4;
        float brush = vn(vec2(sp.x * 0.06 + sp.y * 0.03, sp.y * 0.5 - sp.x * 0.2));
        col *= 0.955 + tooth * 0.06 + (brush - 0.5) * 0.05;
        gl_FragColor = vec4(max(col, 0.0), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor = vec4(gl_FragColor.rgb * a, a);
      }`,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
  });
}
/**
 * Item icons are SVG data URLs with only a viewBox (TextureLoader got a 0×0 image: the r5 gift arc
 * and held item never showed): rasterise them onto a 128 px canvas once and share the texture.
 */
const ICON_TEX = new Map<string, THREE.CanvasTexture>();
function iconTexture(url: string): THREE.CanvasTexture {
  let t = ICON_TEX.get(url);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const tex = t;
  const img = new Image(128, 128);
  img.onload = (): void => {
    c.getContext('2d')?.drawImage(img, 4, 4, 120, 120);
    tex.needsUpdate = true;
  };
  img.src = url;
  ICON_TEX.set(url, t);
  return t;
}

let portraitFailed = false;
/** 2D ink linework (brows, mouth) over the painted bust — false = the rig's own 3D brows / mouth. */
export const PORTRAIT_INK = { on: true };
/** Head centre / radius (fractions of the frame) of each rendered portrait canvas. */
export const PORTRAIT_HEAD = new WeakMap<HTMLCanvasElement, { x: number; y: number; r: number }>();

/**
 * Illustrated features drawn over the painted bust (r6 critic: rig poses read as a toy, Wren's anger
 * as worry, her sad mouth as a moustache). Everything is laid out in the face's own frame: x along
 * the eye line (screen-left eye → right eye), y down the face, in units of the eye spacing, so the
 * three-quarter turn and head tilt carry through. Tapered brows with an ink edge per mood (a 45° V
 * for anger, tented sorrow, a raised quizzical brow), and mouths as shapes: a soft closed smile, an
 * open "D" grin with tongue and teeth, a clenched toothy snarl, a round gasp, a clean frown.
 */
function drawFaceInk(g: CanvasRenderingContext2D, a: { eL: THREE.Vector2; eR: THREE.Vector2; bL: THREE.Vector2; bR: THREE.Vector2; m: THREE.Vector2 }, mood: string, L: NpcLook): void {
  const ex = a.eR.clone().sub(a.eL);
  const es = Math.max(8, ex.length());
  const ux = ex.clone().divideScalar(es);
  const uy = new THREE.Vector2(-ux.y, ux.x);
  if (uy.y < 0) uy.negate();
  const P = (o: THREE.Vector2, x: number, y: number): [number, number] => [o.x + (ux.x * x + uy.x * y) * es, o.y + (ux.y * x + uy.y * y) * es];
  const ink = '#2a120c';
  const hex = (h: number): string => `#${h.toString(16).padStart(6, '0')}`;
  // ── brows
  const light = ((L.hair >> 16) & 255) + ((L.hair >> 8) & 255) + (L.hair & 255) > 520;
  const browC = hex(new THREE.Color(L.hair).multiplyScalar(light ? 0.62 : 0.4).lerp(new THREE.Color(0x2a140c), light ? 0.15 : 0.25).getHex());
  const bt = L.brow ?? 1;
  // [inner dy, outer dy, arch (− = up), lift] per mood, eye-spacing units (y down).
  const BR: Record<string, [number, number, number, number]> = {
    neutral: [0.0, 0.03, -0.07, 0],
    happy: [-0.05, 0.02, -0.11, -0.06],
    laugh: [-0.07, 0.02, -0.13, -0.1],
    blush: [-0.1, 0.03, -0.06, -0.03],
    sad: [-0.22, 0.1, -0.02, -0.02],
    worried: [-0.2, 0.08, 0.03, -0.05],
    wistful: [-0.12, 0.06, -0.04, 0.0],
    angry: [0.15, -0.17, 0.03, 0.0],
    surprised: [-0.12, -0.08, -0.15, -0.17],
    thinking: [0.04, 0.02, -0.03, 0.03],
  };
  for (const side of [-1, 1] as const) {
    let [di, dout, arch, lift] = BR[mood] ?? BR.neutral!;
    if (mood === 'thinking' && side === 1) [di, dout, arch, lift] = [-0.07, -0.02, -0.1, -0.05];
    // (a touch lower than the rig's brow line: closer to the eyes they carry the expression)
    const c = (side < 0 ? a.bL : a.bR).clone().lerp(side < 0 ? a.eL : a.eR, 0.18);
    const len = 0.46 * Math.min(1.25, Math.max(0.85, Math.pow(bt, 0.35)));
    const xi = -side * len * 0.45;
    const xo = side * len * 0.55;
    const pts: [number, number][] = [];
    const wid: number[] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const x = xi + (xo - xi) * t;
      const y = lift + di * (1 - t) + dout * t + arch * 4 * t * (1 - t) + (mood === 'worried' ? Math.sin(t * Math.PI * 2) * 0.025 : 0);
      pts.push(P(c, x, y));
      // Thick at the inner head, tapering to a fine tail (bushier for big brows).
      wid.push(es * (0.05 + 0.055 * bt * (1 - t * 0.75)) * (mood === 'angry' ? 1.2 : 1));
    }
    for (const pass of [0, 1]) {
      g.fillStyle = pass === 0 ? ink : browC;
      for (let i = 0; i < pts.length; i++) {
        g.beginPath();
        g.arc(pts[i]![0], pts[i]![1], wid[i]! * 0.5 + (pass === 0 ? Math.max(1.6, es * 0.022) : 0), 0, Math.PI * 2);
        g.fill();
      }
      for (let i = 0; i < pts.length - 1; i++) {
        g.strokeStyle = g.fillStyle;
        g.lineWidth = (wid[i]! + (pass === 0 ? 2 * Math.max(1.6, es * 0.022) : 0));
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(pts[i]![0], pts[i]![1]);
        g.lineTo(pts[i + 1]![0], pts[i + 1]![1]);
        g.stroke();
      }
    }
  }
  if (mood === 'angry') {
    // Knit creases between the brows.
    const mid = a.bL.clone().add(a.bR).multiplyScalar(0.5);
    g.strokeStyle = ink;
    g.lineWidth = Math.max(2, es * 0.03);
    g.lineCap = 'round';
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(...P(mid, side * 0.04, 0.1));
      g.quadraticCurveTo(...P(mid, side * 0.07, 0.2), ...P(mid, side * 0.05, 0.3));
      g.stroke();
    }
  }
  // ── mouth
  const m = a.m;
  // Mouth width follows the face (r7 FaceShape.mouth), not the eye spacing it is measured in.
  const mw = (L.fp?.mouth ?? 1) / (L.fp?.gap ?? 1);
  const lw = Math.max(2.4, es * 0.05);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const path = (cmds: (['M' | 'L', number, number] | ['Q', number, number, number, number])[]): void => {
    g.beginPath();
    for (const c of cmds) {
      if (c[0] === 'M') g.moveTo(...P(m, c[1] * mw, c[2]));
      else if (c[0] === 'L') g.lineTo(...P(m, c[1] * mw, c[2]));
      else g.quadraticCurveTo(...P(m, c[1] * mw, c[2]), ...P(m, (c[3] as number) * mw, c[4] as number));
    }
  };
  const fillStroke = (fill: string): void => {
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = lw;
    g.stroke();
  };
  const inside = '#5a1612';
  const tongue = '#e0756e';
  const clipDo = (draw: () => void): void => {
    g.save();
    g.clip();
    draw();
    g.restore();
  };
  const open = (w: number, top: number, bot: number, teeth: boolean): void => {
    const shape = (): void => path([['M', -w, top], ['Q', 0, top + 0.05, w, top], ['Q', w * 0.75, bot, 0, bot], ['Q', -w * 0.75, bot, -w, top]]);
    shape();
    g.fillStyle = inside;
    g.fill();
    clipDo(() => {
      g.fillStyle = tongue;
      g.beginPath();
      g.ellipse(...P(m, 0.02, bot - 0.02), w * 0.6 * es * mw, (bot - top) * 0.42 * es, Math.atan2(ux.y, ux.x), 0, Math.PI * 2);
      g.fill();
      if (teeth) {
        g.fillStyle = '#fffaf2';
        path([['M', -w, top - 0.02], ['L', w, top - 0.02], ['L', w * 0.9, top + 0.07], ['Q', 0, top + 0.1, -w * 0.9, top + 0.07]]);
        g.fill();
      }
    });
    shape();
    g.strokeStyle = ink;
    g.lineWidth = lw;
    g.stroke();
  };
  switch (mood) {
    case 'happy':
      open(0.24, -0.04, 0.32, true);
      break;
    case 'laugh':
      open(0.3, -0.07, 0.5, true);
      break;
    case 'surprised': {
      g.beginPath();
      g.ellipse(...P(m, 0, 0.08), 0.12 * es * mw, 0.17 * es, Math.atan2(ux.y, ux.x), 0, Math.PI * 2);
      g.fillStyle = inside;
      g.fill();
      clipDo(() => {
        g.fillStyle = tongue;
        g.beginPath();
        g.ellipse(...P(m, 0, 0.21), 0.09 * es, 0.06 * es, 0, 0, Math.PI * 2);
        g.fill();
      });
      g.beginPath();
      g.ellipse(...P(m, 0, 0.08), 0.12 * es * mw, 0.17 * es, Math.atan2(ux.y, ux.x), 0, Math.PI * 2);
      g.strokeStyle = ink;
      g.lineWidth = lw;
      g.stroke();
      break;
    }
    case 'angry': {
      // Clenched teeth: a wide, flat snarl with the corners pulled down, the bite line and tooth gaps.
      const shape = (): void => path([['M', -0.26, 0.09], ['Q', 0, -0.09, 0.26, 0.09], ['Q', 0, 0.2, -0.26, 0.09]]);
      shape();
      g.fillStyle = '#fffaf2';
      g.fill();
      clipDo(() => {
        g.strokeStyle = '#7a4a3a';
        g.lineWidth = Math.max(1.4, es * 0.022);
        path([['M', -0.3, 0.075], ['Q', 0, 0.035, 0.3, 0.075]]);
        g.stroke();
        for (const x of [-0.15, -0.05, 0.05, 0.15]) {
          path([['M', x, -0.06], ['L', x * 1.05, 0.2]]);
          g.stroke();
        }
      });
      shape();
      g.strokeStyle = ink;
      g.lineWidth = lw * 1.15;
      g.stroke();
      break;
    }
    case 'sad':
      // A clean frown with a pouting lower-lip tick (never a wavy line — that read as a moustache).
      path([['M', -0.17, 0.1], ['Q', 0, -0.07, 0.17, 0.1]]);
      g.strokeStyle = ink;
      g.lineWidth = lw;
      g.stroke();
      path([['M', -0.06, 0.13], ['Q', 0, 0.15, 0.06, 0.13]]);
      g.lineWidth = lw * 0.6;
      g.stroke();
      break;
    case 'worried':
      // A small tight grimace, the corners down.
      path([['M', -0.17, 0.08], ['Q', 0, -0.05, 0.17, 0.08], ['Q', 0, 0.1, -0.17, 0.08]]);
      fillStroke(inside);
      break;
    case 'blush':
      path([['M', -0.11, 0.02], ['Q', -0.05, 0.08, 0, 0.03], ['Q', 0.05, 0.08, 0.11, 0.02]]);
      g.strokeStyle = ink;
      g.lineWidth = lw * 0.9;
      g.stroke();
      break;
    case 'thinking':
      path([['M', -0.15, 0.04], ['Q', 0.02, 0.02, 0.12, -0.02], ['Q', 0.17, -0.04, 0.16, 0.02]]);
      g.strokeStyle = ink;
      g.lineWidth = lw;
      g.stroke();
      break;
    case 'wistful':
      path([['M', -0.13, 0.01], ['Q', 0, 0.06, 0.13, 0.01]]);
      g.strokeStyle = ink;
      g.lineWidth = lw * 0.85;
      g.stroke();
      break;
    default:
      // Neutral: a soft closed smile with little dimple ticks.
      path([['M', -0.16, -0.0], ['Q', 0, 0.09, 0.16, -0.0]]);
      g.strokeStyle = ink;
      g.lineWidth = lw;
      g.stroke();
      g.lineWidth = lw * 0.55;
      for (const sx of [-1, 1]) {
        path([['M', sx * 0.19, -0.03], ['Q', sx * 0.185, 0.0, sx * 0.16, 0.01]]);
        g.stroke();
      }
  }
}

/**
 * Render a villager's bust in a mood with the real 3D model (same mesh, colours, hair, hat, face rig)
 * under a soft three-point studio light, on a transparent background, with a warm ink outline baked
 * round the silhouette. A small dedicated WebGL context (the game renderer's state, passes and perf
 * counters stay untouched); ~3-6 ms per render after the first compile. Null when WebGL is missing.
 */
/** Portrait self-audit (r7 blocker: Rowan's hair was painted over his eyes, pale grey on dark hair). */
export const PORTRAIT_AUDIT: { on: boolean; last: { hairOverEyes: number; hairOverNose: number; hairLum: number; lookLum: number; hueDiff: number } | null } = { on: false, last: null };

/**
 * Reads the bust's id pass (material part per pixel) around the eyes and the nose: the fraction of
 * hair pixels there, and the painted hair's mean colour against the NpcLook hair (lightness + hue).
 */
function auditBust(r: THREE.WebGLRenderer, rtId: THREE.WebGLRenderTarget, g: CanvasRenderingContext2D, size: number, eL: THREE.Vector2, eR: THREE.Vector2, m: THREE.Vector2, L: NpcLook): { hairOverEyes: number; hairOverNose: number; hairLum: number; lookLum: number; hueDiff: number } {
  const id = new Uint8Array(size * size * 4);
  r.readRenderTargetPixels(rtId, 0, 0, size, size, id);
  const part = (x: number, y: number): number => {
    const i = ((size - 1 - Math.round(y)) * size + Math.round(x)) * 4;
    return id[i + 3]! < 8 ? -1 : Math.round((id[i + 3]! / 255) * 8) - 1;
  };
  const es = Math.max(8, eL.distanceTo(eR));
  const frac = (cx: number, cy: number, rx: number, ry: number): number => {
    let n = 0;
    let h = 0;
    for (let y = cy - ry; y <= cy + ry; y += 2)
      for (let x = cx - rx; x <= cx + rx; x += 2) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const p = part(x, y);
        if (p < 0) continue;
        n++;
        if (p === 2) h++;
      }
    return n ? h / n : 0;
  };
  // (the eye itself, not the brow line above it; the nose bridge, not a moustache under it)
  const eyes = Math.max(frac(eL.x, eL.y, es * 0.18, es * 0.12), frac(eR.x, eR.y, es * 0.18, es * 0.12));
  const nc = eL.clone().add(eR).multiplyScalar(0.5).lerp(m, 0.35);
  const nose = frac(nc.x, nc.y, es * 0.1, es * 0.12);
  // Mean painted hair colour (the canvas already holds the painted bust, before the ink brows).
  const img = g.getImageData(0, 0, size, size).data;
  let rr = 0;
  let gg = 0;
  let bb = 0;
  let n = 0;
  for (let y = 0; y < size; y += 3)
    for (let x = 0; x < size; x += 3) {
      if (part(x, y) !== 2) continue;
      const i = (y * size + x) * 4;
      if (img[i + 3]! < 200) continue;
      rr += img[i]!;
      gg += img[i + 1]!;
      bb += img[i + 2]!;
      n++;
    }
  const painted = new THREE.Color(n ? rr / n / 255 : 0, n ? gg / n / 255 : 0, n ? bb / n / 255 : 0);
  const want = new THREE.Color().setHex(L.hair, THREE.SRGBColorSpace);
  const hp = { h: 0, s: 0, l: 0 };
  const hw = { h: 0, s: 0, l: 0 };
  painted.getHSL(hp, THREE.LinearSRGBColorSpace);
  new THREE.Color(((L.hair >> 16) & 255) / 255, ((L.hair >> 8) & 255) / 255, (L.hair & 255) / 255).getHSL(hw, THREE.LinearSRGBColorSpace);
  void want;
  const dh = Math.abs(((hp.h - hw.h + 1.5) % 1) - 0.5) * 360;
  return { hairOverEyes: eyes, hairOverNose: nose, hairLum: hp.l, lookLum: hw.l, hueDiff: hw.s > 0.18 && hp.s > 0.1 ? dh : 0 };
}

/**
 * Every villager's bust in each mood, self-audited: hair over the eyes (> 22 %) or the nose bridge (> 20 %),
 * painted hair lightness off the look's by > .3 or its hue by > 45° fails (r7 portrait gate).
 */
export function auditPortraits(defs: NpcDef[], moods: string[]): { checked: number; fails: string[]; stats: Record<string, string> } {
  const out = { checked: 0, fails: [] as string[], stats: {} as Record<string, string> };
  PORTRAIT_AUDIT.on = true;
  try {
    for (const d of defs)
      for (const m of moods) {
        PORTRAIT_AUDIT.last = null;
        const c = renderVillagerPortrait(d, d.look, m);
        const a = PORTRAIT_AUDIT.last as { hairOverEyes: number; hairOverNose: number; hairLum: number; lookLum: number; hueDiff: number } | null;
        if (!c || !a) continue;
        out.checked++;
        const k = `${d.id}/${m}`;
        if (m === moods[0]) out.stats[d.id] = `eyes ${(a.hairOverEyes * 100).toFixed(0)}% nose ${(a.hairOverNose * 100).toFixed(0)}% L ${a.hairLum.toFixed(2)}/${a.lookLum.toFixed(2)} dh ${a.hueDiff.toFixed(0)}`;
        if (a.hairOverEyes > 0.22) out.fails.push(`${k}: hair over the eyes ${(a.hairOverEyes * 100).toFixed(0)} %`);
        if (a.hairOverNose > 0.2) out.fails.push(`${k}: hair over the nose ${(a.hairOverNose * 100).toFixed(0)} %`);
        if (Math.abs(a.hairLum - a.lookLum) > 0.3) out.fails.push(`${k}: painted hair lightness ${a.hairLum.toFixed(2)} vs look ${a.lookLum.toFixed(2)}`);
        if (a.hueDiff > 45) out.fails.push(`${k}: painted hair hue off by ${a.hueDiff.toFixed(0)}°`);
      }
  } finally {
    PORTRAIT_AUDIT.on = false;
  }
  return out;
}

export function renderVillagerPortrait(def: NpcDef, look: NpcLook, mood: string, size = 560): HTMLCanvasElement | null {
  if (portraitFailed || typeof document === 'undefined') return null;
  try {
    if (!portraitRig || portraitRig.size !== size) {
      portraitRig?.r.dispose();
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
      r.setPixelRatio(1);
      r.setSize(size, size, false);
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.08;
      r.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      // Studio light: warm key high on the left (the face's lit side), cool fill low right, a warm
      // rim from behind for the hair / shoulder edge, and a sky / ground bounce.
      scene.add(new THREE.HemisphereLight(0xfff2e2, 0x7a5a48, 1.05));
      const key = new THREE.DirectionalLight(0xffeed4, 3.0);
      key.position.set(-1.7, 2.3, 2.6);
      const fill = new THREE.DirectionalLight(0xcad8ff, 0.75);
      fill.position.set(2.4, 0.4, 2.0);
      const rim = new THREE.DirectionalLight(0xffe0b0, 2.4);
      rim.position.set(2.0, 2.2, -2.4);
      const rim2 = new THREE.DirectionalLight(0xd8e4ff, 1.1);
      rim2.position.set(-2.4, 1.2, -2.0);
      scene.add(key, fill, rim, rim2);
      const cam = new THREE.PerspectiveCamera(18, 1, 0.1, 40);
      const rtLit = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, samples: 4 });
      const rtId = new THREE.WebGLRenderTarget(size, size, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      const paint = portraitPainter();
      const quad = new THREE.Scene();
      const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), paint);
      q.frustumCulled = false;
      quad.add(q);
      const rtN = new THREE.WebGLRenderTarget(size, size, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      portraitRig = { r, scene, cam, models: new Map(), frames: new Map(), size, rtLit, rtId, rtN, nMat: new THREE.MeshNormalMaterial(), idMat: portraitIdMaterial(), paint, quad, quadCam: new THREE.Camera() };
    }
    const rig = portraitRig;
    const key = `${def.id}|${JSON.stringify(look)}`;
    let v = rig.models.get(key);
    if (!v) {
      v = new Villager(look === def.look ? def : { ...def, look }, { blob: false });
      rig.models.set(key, v);
    }
    for (const m of rig.models.values()) m.root.removeFromParent();
    rig.scene.add(v.root);
    let frame = rig.frames.get(key);
    if (!frame) {
      v.posePortrait('neutral', PORTRAIT_TURN.neutral ?? -0.35);
      const hc = v.headCenter(new THREE.Vector3());
      frame = { c: hc.center.clone(), r: hc.radius };
      rig.frames.set(key, frame);
    }
    v.posePortrait(mood, PORTRAIT_TURN[mood] ?? -0.35);
    const feats = PORTRAIT_INK.on ? v.portraitFeatures() : null;
    // (the head as posed — manga marks follow it — but the crop is the neutral pose's, for every mood)
    const { center, radius } = v.headCenter(new THREE.Vector3());
    // Framing (r6: tighter — the face carries the card): head in the upper middle, the shoulders cut
    // by the bottom edge. (room above for buns, toques, pom-poms and sunhat crowns)
    // (curly / spiky volume counts as tall: r6 June's laugh lost the top of her curls)
    const tall = look.hairStyle === 'bun' || look.hairStyle === 'cap' || look.hairStyle === 'curly' || look.hairStyle === 'spiky' || look.hat === 'beanie' || look.hat === 'sunhat' ? 1 : 0;
    // A wide brim fits inside the card (r6: Hazel's sunhat was clipped on both sides).
    const brim = look.hat === 'sunhat' ? 0.62 : 0;
    const view = frame.r * (2.78 + tall * 0.34 + brim);
    const dist = view / 2 / Math.tan(THREE.MathUtils.degToRad(rig.cam.fov / 2));
    const look0 = new THREE.Vector3(frame.c.x, frame.c.y - frame.r * (0.2 - tall * 0.17 + brim * 0.12), frame.c.z);
    rig.cam.position.set(look0.x + Math.sin(-0.06) * dist, look0.y + dist * 0.14, look0.z + dist);
    rig.cam.lookAt(look0);
    rig.cam.updateMatrixWorld();
    // World FX off for the studio (cloud shadows / rain gloss / golden-hour rim are the town's).
    const U = globalUniforms;
    const saved = [U.uCloudShadow.value, U.uWet.value, U.uRim.value, VILLAGER_FILL.value] as const;
    U.uCloudShadow.value = 0;
    U.uWet.value = 0;
    U.uRim.value = 0;
    VILLAGER_FILL.value = 0;
    if (PORTRAIT_PAINT.on) {
      // Lit pass + id pass into targets, then the painter onto the canvas.
      rig.r.setRenderTarget(rig.rtLit);
      rig.r.clear();
      rig.r.render(rig.scene, rig.cam);
      rig.scene.overrideMaterial = rig.idMat;
      rig.r.setRenderTarget(rig.rtId);
      rig.r.clear();
      rig.r.render(rig.scene, rig.cam);
      rig.scene.overrideMaterial = rig.nMat;
      rig.r.setRenderTarget(rig.rtN);
      rig.r.clear();
      rig.r.render(rig.scene, rig.cam);
      rig.scene.overrideMaterial = null;
      rig.r.setRenderTarget(null);
      const u = rig.paint.uniforms;
      u.tLit!.value = rig.rtLit.texture;
      u.tId!.value = rig.rtId.texture;
      u.tN!.value = rig.rtN.texture;
      (u.px!.value as THREE.Vector2).set(1 / size, 1 / size);
      const toUv = (v: THREE.Vector3, out: THREE.Vector2): THREE.Vector2 => {
        const p = v.clone().project(rig.cam);
        return out.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
      };
      // Crown: the top of the skull, a little behind the hairline (strands fan out from it).
      const crownW = center.clone().add(new THREE.Vector3(0, radius * 0.92, -radius * 0.25));
      toUv(crownW, u.crown!.value as THREE.Vector2);
      toUv(center, u.headC!.value as THREE.Vector2);
      const edge = new THREE.Vector2();
      toUv(center.clone().add(new THREE.Vector3(radius, 0, 0)), edge);
      u.headR!.value = Math.abs(edge.x - (u.headC!.value as THREE.Vector2).x) * 1.05;
      u.seed!.value = (def.id.charCodeAt(0) % 7) * 1.3;
      (u.rimCol!.value as THREE.Color).set(mood === 'sad' || mood === 'worried' ? 0xb8c8ff : mood === 'angry' ? 0xff8a5a : 0xffd8a0);
      rig.r.render(rig.quad, rig.quadCam);
    } else rig.r.render(rig.scene, rig.cam);
    [U.uCloudShadow.value, U.uWet.value, U.uRim.value, VILLAGER_FILL.value] = saved;
    v.root.removeFromParent();
    // Bake: warm ink outline (the silhouette dilated in 12 directions) under the render.
    const out = document.createElement('canvas');
    out.width = out.height = size;
    const g = out.getContext('2d');
    if (!g) return null;
    const sil = document.createElement('canvas');
    sil.width = sil.height = size;
    const sg = sil.getContext('2d')!;
    sg.drawImage(rig.r.domElement, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = '#3a1c10';
    sg.fillRect(0, 0, size, size);
    const ow = Math.max(3, Math.round(size / 112));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      g.drawImage(sil, Math.cos(a) * ow, Math.sin(a) * ow);
    }
    g.drawImage(rig.r.domElement, 0, 0);
    const toPx = (w: THREE.Vector3): THREE.Vector2 => {
      const p = w.clone().project(rig.cam);
      return new THREE.Vector2((p.x * 0.5 + 0.5) * size, (0.5 - p.y * 0.5) * size);
    };
    if (PORTRAIT_AUDIT.on && feats && PORTRAIT_PAINT.on) PORTRAIT_AUDIT.last = auditBust(rig.r, rig.rtId, g, size, toPx(feats.eyeL), toPx(feats.eyeR), toPx(feats.mouth), look);
    if (feats) drawFaceInk(g, { eL: toPx(feats.eyeL), eR: toPx(feats.eyeR), bL: toPx(feats.browL), bR: toPx(feats.browR), m: toPx(feats.mouth) }, mood, look);
    // Head placement for the card's manga marks (fractions of the frame).
    const hc = toPx(center);
    const he = toPx(center.clone().add(new THREE.Vector3(radius, 0, 0)));
    PORTRAIT_HEAD.set(out, { x: hc.x / size, y: hc.y / size, r: Math.abs(he.x - hc.x) / size });
    return out;
  } catch (e) {
    portraitFailed = true;
    console.warn('[portraits] 3D portrait renderer unavailable', e);
    return null;
  }
}

// ───────────────────────────────────────────── the farmer's winter wardrobe

/** Rig groups of a chibi farmer (entities/player.ts / remote-farmer.ts `rig`). */
interface FarmerRigLike {
  head: THREE.Object3D;
  torso: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  hat?: THREE.Object3D;
}

let winterMat: THREE.MeshStandardMaterial | null = null;
function knitGeo(parts: [THREE.BufferGeometry, THREE.Matrix4, number][]): THREE.BufferGeometry {
  const gs = parts.map(([g0, m, c]) => {
    let g = g0.index ? g0.toNonIndexed() : g0.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.applyMatrix4(m);
    const n = g.attributes.position!.count;
    const col = new Float32Array(n * 3);
    const cc = new THREE.Color(c);
    const pa = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      // Knit rib: a fine vertical stripe in the tone (reads as wool at gameplay zoom).
      const k = 0.9 + 0.1 * Math.abs(Math.sin(Math.atan2(pa.getX(i), pa.getZ(i)) * 18));
      col[i * 3] = cc.r * k;
      col[i * 3 + 1] = cc.g * k;
      col[i * 3 + 2] = cc.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g0.dispose();
    void g;
    return g;
  });
  return mergeGeometries(gs, false)!;
}

/**
 * Dress (or undress) a farmer rig for winter, the same way the villagers' seasonal wardrobe works:
 * a knit beanie with a pom-pom (the straw hat goes on the peg), a wool coat with an open front over
 * the overalls, coat sleeves to the wrist with knitted cuffs and mittens, and a chunky scarf.
 * `hat: false` keeps the rig's own hat (a remote farmer's look already swaps it to its beanie).
 */
export function dressFarmerWinter(rig: FarmerRigLike, on: boolean, opts: { hat?: boolean; coat?: number; knit?: number; cuff?: number } = {}): void {
  const tag = 'winter-wear';
  for (const g of [rig.head, rig.torso, rig.armL, rig.armR]) for (const c of [...g.children]) if (c.name === tag) {
    c.removeFromParent();
    (c as THREE.Mesh).geometry?.dispose();
  }
  if (rig.hat) for (const c of rig.hat.children) if (c.name !== tag) c.visible = !on || opts.hat === false;
  if (!on) return;
  if (!winterMat) {
    winterMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    winterMat.name = 'farmer-winter';
    applyWorldFx(winterMat, { snow: false, clouds: true, wet: true });
  }
  const coat = opts.coat ?? 0x6a4a3a;
  const knit = opts.knit ?? 0xc8443a;
  const cuff = opts.cuff ?? 0xf0e6d6;
  const add = (parent: THREE.Object3D, parts: [THREE.BufferGeometry, THREE.Matrix4, number][], shadow: boolean): void => {
    const m = new THREE.Mesh(knitGeo(parts), winterMat!);
    m.name = tag;
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
  };
  const R = 0.32;
  if (opts.hat !== false) {
    const rng = new Rng('farmer-beanie');
    const pom = lumpySphere(0.08, 1, 0.22, rng, 3);
    add(
      rig.head,
      [
        // Snug dome over the crown, worn back so the brow and eyes stay clear from the high lens.
        [new THREE.SphereGeometry(R * 1.12, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), M(0, R * 1.22, -0.05, -0.36, 0, 0, 1, 1.08, 1), knit],
        [bevelCylinder(R * 1.14, R * 1.16, 0.12, 0.03, 24), M(0, R * 1.3, -0.05, -0.36), cuff],
        [pom, M(0, R * 2.32, -0.3), cuff],
      ],
      false,
    );
  }
  // Coat: open-front wool over shirt + overalls, down past the hips.
  add(
    rig.torso,
    [
      [new THREE.CylinderGeometry(0.228, 0.262, 0.44, 18, 1, true, 0.42, Math.PI * 2 - 0.84), M(0, 0.12, 0, 0, 0, 0, 1.05, 1, 0.95), coat],
      [new THREE.TorusGeometry(0.255, 0.022, 5, 20, Math.PI * 2 - 0.84), M(0, -0.1, 0, Math.PI / 2, 0, Math.PI / 2 + 0.42, 1.05, 0.95, 1), shadeHex(coat, 0.8)],
      // Shoulders of the coat (rounded yoke).
      [new THREE.SphereGeometry(0.235, 18, 8, 0.42, Math.PI * 2 - 0.84, 0, Math.PI * 0.42), M(0, 0.3, 0, 0, 0, 0, 1.05, 0.55, 0.95), coat],
      // Chunky scarf: a wrapped roll and two fringed tails over the chest.
      [new THREE.TorusGeometry(0.135, 0.055, 8, 18), M(0, 0.37, 0.01, Math.PI / 2 - 0.22, 0, 0), knit],
      [roundedBox(0.09, 0.24, 0.035, 0.016), M(0.07, 0.22, 0.215, 0.12, 0, 0.1), knit],
      [roundedBox(0.085, 0.18, 0.035, 0.016), M(0.0, 0.25, 0.22, 0.1, 0, -0.16), shadeHex(knit, 0.88)],
      [roundedBox(0.095, 0.025, 0.04, 0.01), M(0.082, 0.098, 0.228, 0.12, 0, 0.1), cuff],
    ],
    true,
  );
  for (const [arm, sx] of [[rig.armL, -1], [rig.armR, 1]] as const) {
    add(
      arm,
      [
        [new THREE.CapsuleGeometry(0.083, 0.09, 4, 10), M(0, -0.06, 0), coat],
        [new THREE.CapsuleGeometry(0.068, 0.11, 4, 10), M(0, -0.19, 0), coat],
        [new THREE.CylinderGeometry(0.07, 0.07, 0.045, 12), M(0, -0.255, 0.004), cuff],
        // Mitten + thumb.
        [new THREE.SphereGeometry(0.074, 12, 8), M(0, -0.31, 0.012, 0, 0, 0, 0.95, 1.1, 0.95), knit],
        [new THREE.SphereGeometry(0.03, 8, 6), M(-sx * 0.05, -0.29, 0.05), knit],
      ],
      false,
    );
  }
}

// ───────────────────────────────────────────── heart-event hero props

function propCanvas(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A handwritten letter held open at the chest (rowan-4, linus-4): cream paper, a fold crease, ink lines. */
export function buildLetter(seal = 0xc8412f): THREE.Group {
  const g = new THREE.Group();
  g.name = 'npc-letter';
  const tex = propCanvas(256, 320, (x) => {
    const gr = x.createLinearGradient(0, 0, 0, 320);
    gr.addColorStop(0, '#fbf3df');
    gr.addColorStop(1, '#efe0bc');
    x.fillStyle = gr;
    x.fillRect(0, 0, 256, 320);
    x.strokeStyle = 'rgba(160,130,90,0.5)';
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(0, 160);
    x.lineTo(256, 160);
    x.stroke();
    x.strokeStyle = 'rgba(60,40,28,0.85)';
    x.lineWidth = 2.4;
    let sd = 7;
    const rnd = (): number => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let y = 44, r = 0; y < 290; y += 24, r++) {
      x.beginPath();
      let px = 26 + (r === 0 ? 0 : 8);
      x.moveTo(px, y);
      const end = r === 0 ? 120 : r % 4 === 3 ? 150 : 228;
      while (px < end) {
        const w = 6 + rnd() * 10;
        x.quadraticCurveTo(px + w / 2, y - 5 - rnd() * 4, px + w, y);
        px += w + (rnd() < 0.18 ? 7 : 0);
        x.moveTo(px, y);
      }
      x.stroke();
    }
    x.fillStyle = `#${seal.toString(16).padStart(6, '0')}`;
    x.beginPath();
    x.arc(206, 286, 15, 0, Math.PI * 2);
    x.fill();
  });
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide });
  const geo = new THREE.PlaneGeometry(0.24, 0.3, 1, 6);
  const pa = geo.attributes.position as THREE.BufferAttribute;
  // A soft bow at the fold (it has lived in a drawer / a pocket).
  for (let i = 0; i < pa.count; i++) pa.setZ(i, -Math.abs(pa.getY(i)) * 0.12 + 0.018);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  // (held facing out, towards whoever the holder faces)
  m.rotation.set(-Math.PI / 2 + 0.25, 0, 0);
  m.castShadow = true;
  g.add(m);
  return g;
}

/** Rosalind's ledger: an old cloth-bound account book lying open, columns of entries in faded ink. */
export function buildLedger(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'npc-ledger';
  const page = (side: number): THREE.CanvasTexture =>
    propCanvas(256, 320, (x) => {
      const gr = x.createLinearGradient(side > 0 ? 0 : 256, 0, side > 0 ? 256 : 0, 0);
      gr.addColorStop(0, '#d8c49a');
      gr.addColorStop(0.12, '#f4e6c4');
      gr.addColorStop(1, '#efdcb4');
      x.fillStyle = gr;
      x.fillRect(0, 0, 256, 320);
      // Ruled columns (date | entry | paid) and a red margin.
      x.strokeStyle = 'rgba(90,120,160,0.45)';
      x.lineWidth = 1.5;
      for (let y = 46; y < 310; y += 22) {
        x.beginPath();
        x.moveTo(14, y);
        x.lineTo(242, y);
        x.stroke();
      }
      x.strokeStyle = 'rgba(190,60,50,0.6)';
      x.beginPath();
      x.moveTo(58, 20);
      x.lineTo(58, 310);
      x.moveTo(192, 20);
      x.lineTo(192, 310);
      x.stroke();
      x.fillStyle = '#4a2e1c';
      x.font = 'italic 20px Georgia, serif';
      x.fillText(side > 0 ? 'Rosalind' : 'Seeds — spring', 22, 30);
      x.font = 'italic 15px Georgia, serif';
      let s = side > 0 ? 11 : 5;
      const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let y = 42, i = 0; y < 300; y += 22, i++) {
        x.fillStyle = 'rgba(60,40,28,0.85)';
        x.fillText(`${(i * 3 + 4) % 28 + 1}/${(i % 4) + 3}`, 16, y);
        // Scribbled entries: wavy ink strokes standing in for handwriting.
        x.strokeStyle = 'rgba(60,40,28,0.8)';
        x.lineWidth = 1.6;
        x.beginPath();
        let px = 66;
        x.moveTo(px, y - 5);
        while (px < 180 - rnd() * 40) {
          px += 4 + rnd() * 5;
          x.lineTo(px, y - 5 - rnd() * 7);
        }
        x.stroke();
        x.fillStyle = side > 0 && i === 11 ? '#c8412f' : 'rgba(60,40,28,0.85)';
        x.fillText(i % 3 === 2 ? 'pie' : 'pie ✓', 198, y);
      }
      if (side > 0) {
        // The last page: one blank line left, a pressed violet tucked in the gutter.
        x.fillStyle = '#8a5ab0';
        for (let k = 0; k < 5; k++) {
          x.beginPath();
          x.ellipse(28 + Math.cos(k * 1.256) * 9, 290 + Math.sin(k * 1.256) * 9, 7, 4, k * 1.256, 0, Math.PI * 2);
          x.fill();
        }
        x.fillStyle = '#f2c43a';
        x.beginPath();
        x.arc(28, 290, 4, 0, Math.PI * 2);
        x.fill();
      }
    });
  const cover = new THREE.MeshStandardMaterial({ color: 0x6a2a2a, roughness: 0.75 });
  for (const side of [-1, 1]) {
    const pg = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.25), new THREE.MeshStandardMaterial({ map: page(side), roughness: 0.92 }));
    // The two pages open in a shallow V.
    pg.position.set(side * 0.098, 0.022, 0);
    pg.rotation.set(-Math.PI / 2, side * 0.12, 0);
    g.add(pg);
    const block = new THREE.Mesh(roundedBox(0.2, 0.018, 0.25, 0.006), new THREE.MeshStandardMaterial({ color: 0xe8d6ae, roughness: 0.9 }));
    block.position.set(side * 0.1, 0.011, 0);
    block.rotation.z = -side * 0.12;
    g.add(block);
  }
  const back = new THREE.Mesh(roundedBox(0.43, 0.012, 0.27, 0.005), cover);
  back.position.y = -0.002;
  g.add(back);
  // Ribbon bookmark trailing off the bottom.
  const rib = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.004, 0.12), new THREE.MeshStandardMaterial({ color: 0xc8a03a, roughness: 0.6 }));
  rib.position.set(0.02, 0.006, 0.17);
  rib.rotation.y = 0.2;
  g.add(rib);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return g;
}

/** Kit's secret map: a crayon drawing of the valley on a creased sheet, weighted with pebbles. */
export function buildKidMap(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'npc-map';
  const tex = propCanvas(512, 380, (x) => {
    x.fillStyle = '#f4e8c8';
    x.fillRect(0, 0, 512, 380);
    // Fold creases.
    x.strokeStyle = 'rgba(150,120,80,0.35)';
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(256, 0);
    x.lineTo(256, 380);
    x.moveTo(0, 190);
    x.lineTo(512, 190);
    x.stroke();
    x.lineCap = 'round';
    x.lineJoin = 'round';
    const crayon = (col: string, w: number, pts: [number, number][]): void => {
      x.strokeStyle = col;
      x.lineWidth = w;
      x.beginPath();
      pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b)));
      x.stroke();
    };
    // The river (wobbly blue), the bridge, the forest (green scribble trees), the mountains.
    crayon('#3f8fd8', 14, [[330, -10], [350, 70], [320, 140], [360, 220], [340, 300], [380, 390]]);
    crayon('#8a6a4a', 10, [[300, 182], [400, 182]]);
    for (let i = 0; i < 9; i++) {
      const tx = 40 + (i % 5) * 44;
      const ty = 40 + Math.floor(i / 5) * 54;
      crayon('#3a8a3a', 8, [[tx, ty + 30], [tx + 16, ty], [tx + 32, ty + 30], [tx, ty + 30]]);
      crayon('#7a4a2a', 6, [[tx + 16, ty + 30], [tx + 16, ty + 42]]);
    }
    crayon('#7a7a8a', 9, [[400, 70], [440, 20], [470, 60], [500, 15], [520, 70]]);
    // The farm: a square house + field rows; "the blob is you".
    crayon('#c8412f', 8, [[70, 250], [130, 250], [130, 300], [70, 300], [70, 250], [100, 222], [130, 250]]);
    for (let r = 0; r < 4; r++) crayon('#8a6a2a', 6, [[150, 260 + r * 14], [230, 260 + r * 14]]);
    x.fillStyle = '#e8a03a';
    x.beginPath();
    x.ellipse(175, 330, 14, 10, 0.3, 0, Math.PI * 2);
    x.fill();
    // The Hall with a lantern, a dotted trail, and the big red X.
    crayon('#6a5a8a', 8, [[400, 250], [460, 250], [460, 300], [400, 300], [400, 250], [430, 225], [460, 250]]);
    x.fillStyle = '#f2c43a';
    x.beginPath();
    x.arc(430, 270, 9, 0, Math.PI * 2);
    x.fill();
    x.setLineDash([4, 12]);
    crayon('#5a3a2a', 5, [[180, 320], [260, 300], [300, 260], [380, 330], [440, 340]]);
    x.setLineDash([]);
    crayon('#d8241a', 12, [[425, 320], [465, 360]]);
    crayon('#d8241a', 12, [[465, 320], [425, 360]]);
    x.fillStyle = '#3a2a1a';
    x.font = 'bold 30px "Comic Sans MS", "Chalkboard SE", sans-serif';
    x.fillText('TOP SECRET', 26, 362);
    x.font = 'bold 18px "Comic Sans MS", "Chalkboard SE", sans-serif';
    x.fillText('by Kit', 236, 30);
  });
  const sheet = new THREE.PlaneGeometry(1.05, 0.78, 6, 4);
  {
    // Creased and curling at the corners.
    const pa = sheet.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      const u = pa.getX(i) / 0.525;
      const v = pa.getY(i) / 0.39;
      pa.setZ(i, 0.025 * (u * u * v * v) + 0.008 * Math.abs(Math.sin(u * 3.1)) * (Math.abs(u) < 0.08 ? 0 : 1));
    }
    sheet.computeVertexNormals();
  }
  const m = new THREE.Mesh(sheet, new THREE.MeshStandardMaterial({ map: tex, color: 0xc8bfae, roughness: 0.95, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  m.receiveShadow = true;
  g.add(m);
  const peb = new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9 });
  for (const [px, pz, r] of [[-0.5, -0.36, 0.05], [0.49, -0.37, 0.045], [-0.49, 0.36, 0.04], [0.5, 0.37, 0.055]] as const) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), peb);
    p.scale.set(1.2, 0.7, 1);
    p.position.set(px, 0.035, pz);
    p.castShadow = true;
    g.add(p);
  }
  return g;
}

/**
 * Forge sparks: bursts of white-hot sparks off the anvil every hammer strike (additive points, one
 * draw), plus a flickering forge-glow light. `tick(dt)` animates it (NpcSystem calls it per frame).
 */
export function buildSparks(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'npc-sparks';
  const N = 64;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const life = new Float32Array(N).fill(-1);
  // White-hot streaks stretched along their flight (unlit, past 1.0 so the bloom catches them).
  const streak = new THREE.CylinderGeometry(0.026, 0.01, 1, 5, 1);
  streak.translate(0, -0.5, 0);
  const sm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.05, 0.45), toneMapped: false });
  const pts = new THREE.InstancedMesh(streak, sm, N);
  pts.frustumCulled = false;
  pts.castShadow = false;
  g.add(pts);
  const _m4 = new THREE.Matrix4();
  const _qq = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _sc = new THREE.Vector3();
  const _ps = new THREE.Vector3();
  const light = new THREE.PointLight(0xff8a3a, 0, 5.5, 1.6);
  light.position.set(0, 0.9, 0);
  g.add(light);
  let t = 0;
  let next = 0;
  let flash = 0;
  g.userData.tick = (dt: number): void => {
    t += dt;
    if (t >= next) {
      next = t + 0.7 + Math.random() * 0.25;
      flash = 1;
      let k = 0;
      for (let i = 0; i < N && k < 26; i++) {
        if (life[i]! > 0) continue;
        k++;
        life[i] = 0.35 + Math.random() * 0.45;
        pos[i * 3] = (Math.random() - 0.5) * 0.08;
        pos[i * 3 + 1] = 0.8;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 0.08;
        const a = Math.random() * Math.PI * 2;
        const sp = 1.4 + Math.random() * 2.6;
        vel[i * 3] = Math.cos(a) * sp;
        vel[i * 3 + 1] = 2.0 + Math.random() * 2.8;
        vel[i * 3 + 2] = Math.sin(a) * sp;
      }
    }
    for (let i = 0; i < N; i++) {
      if (life[i]! <= 0) {
        pos[i * 3 + 1] = -50;
        continue;
      }
      life[i]! -= dt;
      vel[i * 3 + 1]! -= 9 * dt;
      pos[i * 3]! += vel[i * 3]! * dt;
      pos[i * 3 + 1] = Math.max(0.02, pos[i * 3 + 1]! + vel[i * 3 + 1]! * dt);
      pos[i * 3 + 2]! += vel[i * 3 + 2]! * dt;
    }
    for (let i = 0; i < N; i++) {
      if (life[i]! <= 0) {
        _m4.makeScale(0, 0, 0);
      } else {
        _v.set(vel[i * 3]!, vel[i * 3 + 1]!, vel[i * 3 + 2]!);
        const sp = _v.length() || 1;
        _qq.setFromUnitVectors(_up, _v.multiplyScalar(1 / sp));
        _sc.set(1, Math.min(0.42, sp * 0.075), 1);
        _m4.compose(_ps.set(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!), _qq, _sc);
      }
      pts.setMatrixAt(i, _m4);
    }
    pts.instanceMatrix.needsUpdate = true;
    flash = Math.max(0, flash - dt * 4);
    light.intensity = 2.2 + Math.sin(t * 13) * 0.3 + Math.sin(t * 7.3) * 0.25 + flash * 5;
  };
  // (a burst already in the air: a paused still shows sparks)
  (g.userData.tick as (dt: number) => void)(0.001);
  (g.userData.tick as (dt: number) => void)(0.22);
  return g;
}
