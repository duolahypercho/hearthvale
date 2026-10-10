/**
 * Warm kit (DESIGN pillar 14): objects the game only builds on demand mid-play (a held tool, a
 * farmhand's pour stream) get their first real draw behind the load instead of mid-play.
 *
 * The shader gate (render/shadergate.ts) keeps a never-compiled material out of the frame while it
 * compiles off-thread, but on ANGLE/Metal the first real draw of a program still finishes it on the
 * main thread (onFirstUse reflection, the Metal pipeline state for the scene target, the shadow depth
 * variant): a farmhand's first watering-can pour froze coop-farm for 330-630 ms (perf g11 probe),
 * with every program already reporting ready. Systems register factories here; RenderContext.compile()
 * adds one specimen of each to the scene (so compileAsync builds the colour programs against the real
 * light set), and the next WARM_FRAMES rendered frames draw them for real (main, AO, shadow passes)
 * shrunk to a sub-pixel speck at the camera focus, then they leave the scene. Nothing visible.
 * Overlay scenes drawn outside the graph register a one-off warm-up (registerOverlayWarm).
 * `?warmkit=0` = the old behaviour (A/B). Stats: warmStats.
 */
import * as THREE from 'three';

type Factory = () => THREE.Object3D | THREE.Object3D[];

/** `?warmkit=0` disables it (A/B). */
const ENABLED = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('warmkit') !== '0';
  } catch {
    return true; // not in a browser
  }
})();

const factories: Factory[] = [];
/** Debug / perf report: specimens in the kit, overlay warm-ups run, failures. */
export const warmStats = { specimens: 0, overlays: 0, failed: 0 };
let kit: THREE.Group | null = null;
let builtCount = 0;

/** Frames the kit stays in the scene after a compile (the shadow cache draws new casters at once). */
export const WARM_FRAMES = 3;
/** Kit scale: every triangle is far below a pixel, so it rasterises (almost) nothing. */
const SPECK = 1e-4;

/** Register something built on demand mid-play (called at module load; the factory runs lazily). */
export function registerWarm(f: Factory): void {
  factories.push(f);
}

/** The kit group (null when nothing registered). Specimens are built once and reused across loads. */
export function warmKit(): THREE.Group | null {
  if (!ENABLED || !factories.length) return null;
  if (!kit) {
    kit = new THREE.Group();
    kit.name = 'warm-kit';
    kit.scale.setScalar(SPECK);
    kit.userData.warmKit = true;
  }
  const group = kit;
  for (; builtCount < factories.length; builtCount++) {
    let made: THREE.Object3D | THREE.Object3D[];
    try {
      made = factories[builtCount]!();
    } catch (e) {
      warmStats.failed++;
      console.warn('[warmkit] factory failed', e);
      continue;
    }
    for (const o of Array.isArray(made) ? made : [made]) {
      o.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      o.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh);
      });
      for (const c of meshes) {
        const m = c;
        // Pipeline state = program + vertex layout: one plain-mesh specimen per material and
        // attribute set covers every tool x tier (24 tools, ~6 draws). Instanced / skinned objects
        // have their own variants and are kept as they are.
        const plain = !(c as THREE.InstancedMesh).isInstancedMesh && !(c as THREE.SkinnedMesh).isSkinnedMesh;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const key = `${plain ? 'm' : c.type}|${mats.map((x) => x.uuid).join()}|${Object.keys(m.geometry.attributes).sort().join()}|${c.castShadow}|${c.receiveShadow}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let s: THREE.Object3D = c;
        if (plain) {
          const px = new THREE.Mesh(m.geometry, m.material);
          px.castShadow = c.castShadow;
          px.receiveShadow = c.receiveShadow;
          if (c.customDepthMaterial) px.customDepthMaterial = c.customDepthMaterial;
          c.matrixWorld.decompose(px.position, px.quaternion, px.scale);
          s = px;
        } else c.removeFromParent();
        // Drawn in every pass wherever it sits (the shadow pass culls by the sun frustum).
        s.frustumCulled = false;
        s.visible = true;
        group.add(s);
        warmStats.specimens++;
      }
    }
  }
  return kit;
}

const seen = new Set<string>();

type OverlayWarm = (renderer: THREE.WebGLRenderer, camera: THREE.Camera) => void;
const overlayWarms: OverlayWarm[] = [];
let overlaysDone = 0;

/**
 * Register a warm-up for something drawn OUTSIDE the scene graph (an overlay scene rendered straight
 * to the canvas, e.g. the co-op emote bubbles): the gate and compile() never see those, so their first
 * show compiled synchronously mid-play (coop-farm: a 0.6-0.8 s freeze on the first emote). Each runs
 * once per page from RenderContext.compile(), behind the load; programs are pinned afterwards.
 */
export function registerOverlayWarm(f: OverlayWarm): void {
  overlayWarms.push(f);
}

export function runOverlayWarms(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
  if (!ENABLED) return;
  for (; overlaysDone < overlayWarms.length; overlaysDone++) {
    try {
      overlayWarms[overlaysDone]!(renderer, camera);
      warmStats.overlays++;
    } catch (e) {
      warmStats.failed++;
      console.warn('[warmkit] overlay warm failed', e);
    }
  }
}
