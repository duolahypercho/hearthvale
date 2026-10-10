/**
 * 3D bust portraits: the dialogue / shop / social portraits are snapshots of the REAL villager rig
 * (same mesh, hair, outfit, face rig and mood poses as in the square), lit by a small studio and
 * rendered once per (villager, mood) into an offscreen target, then cached as an image. One
 * art style on screen: the portrait is the same soft 3D character the player just walked up to,
 * not a separate 2D illustration.
 *
 * Cost: a one-off ~20k-triangle render per (villager, mood) the first time a face is shown
 * (a few ms), zero per frame afterwards. Falls back (returns null) when no renderer is attached
 * or anything throws, and the caller draws the painted SVG instead.
 */
import * as THREE from 'three';
import { Villager } from '../entities/villager';
import { NPCS, type NpcDef } from '../data/npcs';

let R: THREE.WebGLRenderer | null = null;
let broken = false;

/** Hand the studio the game's renderer (call once, from the Game constructor). */
export function setBustRenderer(r: THREE.WebGLRenderer): void {
  R = r;
}

const SIZE = 448;
/** Mood → tiny head turn (rad) and tilt (rad) so each face has its own pose, like the painted set. */
const POSE: Record<string, { yaw: number; tilt: number; lift: number }> = {
  neutral: { yaw: -0.34, tilt: 0, lift: 0 },
  happy: { yaw: -0.38, tilt: 0.04, lift: 0.01 },
  laugh: { yaw: -0.3, tilt: -0.06, lift: 0.015 },
  sad: { yaw: -0.22, tilt: 0.08, lift: -0.03 },
  angry: { yaw: -0.4, tilt: -0.03, lift: 0 },
  surprised: { yaw: -0.28, tilt: 0, lift: 0.02 },
  blush: { yaw: -0.44, tilt: 0.07, lift: -0.01 },
  worried: { yaw: -0.3, tilt: 0.06, lift: -0.01 },
  thinking: { yaw: -0.5, tilt: -0.05, lift: 0 },
};

interface Studio {
  scene: THREE.Scene;
  cam: THREE.PerspectiveCamera;
  rt: THREE.WebGLRenderTarget;
  rigs: Map<string, Villager>;
  px: Uint8Array;
  cv: HTMLCanvasElement;
}
let studio: Studio | null = null;

function makeStudio(): Studio {
  const scene = new THREE.Scene();
  // Warm key from the front-left, cool sky fill from above, a faint back rim: the same recipe as the square.
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x9a8468, 1.55));
  const key = new THREE.DirectionalLight(0xfff0d6, 2.6);
  key.position.set(-2.2, 3.2, 4.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffe2b8, 1.2);
  rim.position.set(3, 2, -3);
  scene.add(rim);
  const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 30);
  const rt = new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4, depthBuffer: true, type: THREE.UnsignedByteType });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  return { scene, cam, rt, rigs: new Map(), px: new Uint8Array(SIZE * SIZE * 4), cv };
}

const cache = new Map<string, string>();

/** The def a look belongs to (portraitSvg only receives the look). */
export function defForLook(look: unknown): NpcDef | null {
  for (const d of Object.values(NPCS)) if (d.look === look) return d;
  return null;
}

/** PNG data URL of the villager's bust in a mood (cached), or null when it cannot be rendered. */
export function bustUrl(def: NpcDef, mood: string): string | null {
  if (!R || broken) return null;
  const key = `${def.id}:${mood}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const url = render(def, mood);
    if (url) cache.set(key, url);
    return url;
  } catch (e) {
    broken = true;
    console.warn('[bust] 3D portraits unavailable, using painted portraits', e);
    return null;
  }
}

function render(def: NpcDef, mood: string): string | null {
  const r = R!;
  const s = (studio ??= makeStudio());
  let v = s.rigs.get(def.id);
  if (!v) {
    v = new Villager(def, { blob: false });
    s.rigs.set(def.id, v);
    s.scene.add(v.root);
    v.root.visible = false;
  }
  for (const o of s.rigs.values()) o.root.visible = o === v;
  const p = POSE[mood] ?? POSE.neutral!;
  const priv = v as unknown as { nextBlink: number; blinkT: number };
  v.setPosition(0, 0, 0);
  v.setYaw(p.yaw);
  v.setMood(mood);
  priv.nextBlink = 99;
  priv.blinkT = 0;
  // Let the face rig blend into the mood (and the pose settle) before the shutter.
  for (let i = 0; i < 24; i++) {
    priv.nextBlink = 99;
    v.update(1 / 30, () => 0, false);
  }
  v.root.updateMatrixWorld(true);
  // Frame: head and shoulders. The head is the portrait: fill ~60% of the frame height.
  const top = v.headTop;
  const view = top * 0.64;
  const cy = top - view * 0.52 + p.lift;
  const dist = view / 2 / Math.tan(THREE.MathUtils.degToRad(s.cam.fov / 2));
  s.cam.position.set(0.0, cy + dist * 0.1, dist);
  s.cam.lookAt(0, cy, 0);
  s.cam.rotateZ(p.tilt);
  s.cam.updateMatrixWorld(true);

  const prevRT = r.getRenderTarget();
  const prevClear = r.getClearColor(new THREE.Color());
  const prevAlpha = r.getClearAlpha();
  r.setRenderTarget(s.rt);
  r.setClearColor(0x000000, 0);
  r.clear();
  r.render(s.scene, s.cam);
  r.readRenderTargetPixels(s.rt, 0, 0, SIZE, SIZE, s.px);
  r.setRenderTarget(prevRT);
  r.setClearColor(prevClear, prevAlpha);
  v.root.visible = false;

  // Bottom-up, premultiplied (MSAA resolve against a transparent clear) → top-down straight alpha.
  const ctx = s.cv.getContext('2d')!;
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    const src = (SIZE - 1 - y) * SIZE * 4;
    const dst = y * SIZE * 4;
    for (let x = 0; x < SIZE; x++) {
      const i = src + x * 4;
      const a = s.px[i + 3]!;
      const k = a > 0 ? 255 / a : 0;
      img.data[dst + x * 4] = Math.min(255, s.px[i]! * k);
      img.data[dst + x * 4 + 1] = Math.min(255, s.px[i + 1]! * k);
      img.data[dst + x * 4 + 2] = Math.min(255, s.px[i + 2]! * k);
      img.data[dst + x * 4 + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return s.cv.toDataURL('image/png');
}
