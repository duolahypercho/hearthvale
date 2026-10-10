/**
 * Catch-card portraits rendered from the species' own 3D mesh (world/beach/fishmesh.ts: the same
 * lofted body, canvas skin, fins and eyes as the fish held up on the pier), so the card and the fish
 * in the farmer's fist are unmistakably one animal (critic r4: the painted SVG Dusk Grouper read
 * purple-pink, the 3D one red-orange). A small dedicated WebGL context (the game renderer's state,
 * passes and perf counters stay untouched), a soft studio light, transparent background; one render
 * per species, cached as a data URL. Null when WebGL is unavailable (the card falls back to the SVG).
 */
import * as THREE from 'three';
import type { FishDef } from '../data/fish';
import { buildFishMesh } from '../world/beach/fishmesh';

const W = 360;
const H = 216;
const cache = new Map<string, string>();
let rig: { r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera } | null = null;
let failed = false;

function setup(): NonNullable<typeof rig> {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  r.setPixelRatio(1);
  r.setSize(W, H, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  // Daylight studio: warm key from above-front, cool fill from below, a bright rim along the back
  // (the dorsal line reads against the card's water), sky / sand bounce.
  scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x9a8a70, 1.2));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.6);
  key.position.set(-1.2, 2.4, 2.6);
  const fill = new THREE.DirectionalLight(0xc8dcff, 0.7);
  fill.position.set(1.6, -0.8, 2.0);
  const rim = new THREE.DirectionalLight(0xffffff, 1.8);
  rim.position.set(0.6, 1.8, -2.4);
  scene.add(key, fill, rim);
  const cam = new THREE.PerspectiveCamera(20, W / H, 0.1, 20);
  return { r, scene, cam };
}

/** Data URL of `def` rendered from its 3D mesh (side view, head left), or null (no WebGL). */
export function fishPortraitUrl(def: FishDef): string | null {
  const hit = cache.get(def.id);
  if (hit) return hit;
  if (failed || typeof document === 'undefined') return null;
  try {
    if (!rig) rig = setup();
    const mesh = buildFishMesh(def);
    const g = mesh.group;
    // Three-quarter side view, nose a touch down-left (a "swimming" tilt like the old painting).
    g.rotation.set(0.12, -0.32, -0.06);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(new THREE.Vector3());
    const ctr = box.getCenter(new THREE.Vector3());
    const tan = Math.tan(THREE.MathUtils.degToRad(rig.cam.fov / 2));
    // Fit: 86 % of the width or 80 % of the height, whichever binds.
    const dW = size.x / 0.86 / (2 * tan * rig.cam.aspect);
    const dH = size.y / 0.8 / (2 * tan);
    const d = Math.max(dW, dH) + size.z * 0.5;
    rig.cam.position.set(ctr.x, ctr.y + d * 0.05, ctr.z + d);
    rig.cam.lookAt(ctr);
    rig.scene.add(g);
    rig.r.render(rig.scene, rig.cam);
    rig.scene.remove(g);
    let url = rig.r.domElement.toDataURL('image/webp', 0.92);
    if (!url.startsWith('data:image/webp')) url = rig.r.domElement.toDataURL('image/png');
    // Geometry + materials are this render's own; the skin canvases are shared caches (kept).
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
    });
    cache.set(def.id, url);
    return url;
  } catch {
    failed = true;
    return null;
  }
}

/** Render ahead (idle time, e.g. when the fish is hooked) so the card never waits on it. */
export function prewarmFishPortrait(def: FishDef): void {
  if (cache.has(def.id) || failed) return;
  const run = (): void => void fishPortraitUrl(def);
  const ric = (globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(run, { timeout: 1200 });
  else setTimeout(run, 60);
}
