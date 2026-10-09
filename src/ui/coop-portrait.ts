/**
 * Real 3D portrait chips of a co-op farmer (r7): the same skinned RemoteFarmer the world draws, posed
 * three-quarters to the lens and framed head-and-shoulders, so the roster, lobby cards, bedtime banner
 * and day-end rows show the farmer you'll actually see in the field (hair colour + style, hat, face,
 * kerchief) — never a generic disc. One small persistent low-power WebGL context (like the villager
 * portraits), 144 px PNG data URLs cached per look; a look is rendered once, off the frame budget.
 */
import * as THREE from 'three';
import { RemoteFarmer } from '../entities/remote-farmer';
import type { FarmerLook } from '../entities/remote-look';

const SIZE = 144;
const cache = new Map<string, string>();
let rig: { r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera } | null = null;
let failed = false;

const keyOf = (look: FarmerLook): string => JSON.stringify(look);

function setup(): NonNullable<typeof rig> {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  r.setPixelRatio(1);
  r.setSize(SIZE, SIZE, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.12;
  r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  // The creator's warm portrait key (front-left, golden), a soft bounce and a cool rim that
  // separates the hat / hair from the chip's coloured ring.
  scene.add(new THREE.HemisphereLight(0xfff0d8, 0x8a6a4a, 2.0));
  const key = new THREE.DirectionalLight(0xffdcae, 2.9);
  key.position.set(-1.8, 2.6, 3.2);
  const fill = new THREE.DirectionalLight(0xffeedd, 0.8);
  fill.position.set(2.4, 0.6, 2.2);
  const rim = new THREE.DirectionalLight(0xcfe0ff, 2.0);
  rim.position.set(2.2, 2.4, -2.6);
  scene.add(key, fill, rim);
  const cam = new THREE.PerspectiveCamera(24, 1, 0.05, 20);
  return { r, scene, cam };
}

/** PNG data URL of the farmer's bust (null without WebGL — callers keep the painted disc). */
export function farmerPortraitUrl(look: FarmerLook): string | null {
  const k = keyOf(look);
  const hit = cache.get(k);
  if (hit) return hit;
  if (failed || typeof document === 'undefined') return null;
  try {
    rig ??= setup();
    const f = new RemoteFarmer(look);
    f.gaze = 0;
    f.yaw = f.targetYaw = 0.42;
    f.anim = 'idle';
    f.update(1 / 60, 0.4);
    // (the contact-shadow blob would read as a dark collar from this angle)
    f.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry?.type === 'CircleGeometry') o.visible = false;
    });
    rig.scene.add(f.root);
    f.root.updateMatrixWorld(true);
    // Frame the head + hat: centre a touch below the head top anchor, shoulders just in.
    const top = f.headWorld(new THREE.Vector3());
    // (r7b) A hat sits above the tag anchor's head top: frame a touch higher and wider so the whole
    // crown reads inside the circular chip (the straw brim was clipped to a faint arc).
    const hatted = look.hat !== 'none';
    const c = new THREE.Vector3(0, top.y - (hatted ? 0.6 : 0.74), 0);
    const dist = hatted ? 3.55 : 3.1;
    rig.cam.position.set(c.x + 0.05, c.y + 0.34, c.z + dist);
    rig.cam.lookAt(c.x, c.y + 0.02, c.z);
    rig.r.render(rig.scene, rig.cam);
    const url = rig.r.domElement.toDataURL('image/png');
    rig.scene.remove(f.root);
    f.dispose();
    cache.set(k, url);
    // (the creator renders a chip per tweak: keep the newest few dozen)
    if (cache.size > 48) cache.delete(cache.keys().next().value!);
    return url;
  } catch {
    failed = true;
    return null;
  }
}
