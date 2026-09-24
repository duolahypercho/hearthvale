/**
 * Point-light budget (DESIGN pillar 14).
 *
 * Every visible PointLight is a loop iteration in EVERY lit fragment (forward shading), whether it
 * is lit or not — town / hall scenes carried 23-24 (lamps, windows, festoons), ~35 % of the frame.
 * Each frame this picks the `max` lights that matter most for the current view (lit, inside the
 * view frustum, nearest the camera focus) and hides the rest from the renderer via their layer
 * mask (owners keep full control of `visible` / `intensity`). The emissive bulbs and bloom still
 * show every lamp; only the light pool of far / off-screen lamps is dropped.
 *
 * - The number of lights handed to three stays constant (= max, once a scene has ≥ max), so
 *   swapping which lamps are active never changes the shader permutation → no recompiles; it
 *   also means every map with ≥ max lamps shares the same programs.
 * - Swaps cross-fade: a light leaving the set fades out before its slot is handed over, the
 *   newcomer fades in (instant when it's off-screen or the camera cut).
 * - Intensity is scaled only for the duration of the render call and restored afterwards.
 */
import * as THREE from 'three';

interface Entry {
  light: THREE.PointLight;
  /** Fade weight 0..1 while holding a slot. */
  w: number;
  active: boolean;
  mask: number;
  seen: number;
  score: number;
  inView: boolean;
}

const FADE_S = 0.35;
const _frustum = new THREE.Frustum();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Sphere();

export class LightBudget {
  /** Max point lights handed to the renderer (Infinity disables the budget). */
  max: number;
  private entries = new Map<THREE.PointLight, Entry>();
  private list: Entry[] = [];
  private frame = 0;
  private lastCam = new THREE.Vector3(NaN, NaN, NaN);
  private scaled: { l: THREE.PointLight; i: number }[] = [];
  private stack: THREE.Object3D[] = [];
  private want = new Set<Entry>();
  /** Visible shadow-casting directional / spot lights (collected in the same walk; the governor scales their maps). */
  readonly shadowLights: (THREE.DirectionalLight | THREE.SpotLight)[] = [];
  /** Stats for __game.info().perf. */
  stats = { total: 0, active: 0 };

  constructor(max: number) {
    this.max = max;
  }

  /** Called for every visible drawable during the walk (the shader gate piggybacks on it). */
  visit: ((o: THREE.Object3D) => void) | null = null;

  /** Collect visible point lights (walks only visible subtrees). */
  private gather(scene: THREE.Scene): void {
    const visit = this.visit;
    this.frame++;
    const f = this.frame;
    const stack = this.stack;
    stack.length = 0;
    stack.push(scene);
    this.shadowLights.length = 0;
    while (stack.length) {
      const o = stack.pop()!;
      if (!o.visible) continue;
      if ((o as THREE.Light).isLight && o.castShadow && ((o as THREE.DirectionalLight).isDirectionalLight || (o as THREE.SpotLight).isSpotLight)) this.shadowLights.push(o as THREE.DirectionalLight);
      if ((o as THREE.PointLight).isPointLight) {
        const l = o as THREE.PointLight;
        let e = this.entries.get(l);
        if (!e) {
          e = { light: l, w: 0, active: false, mask: l.layers.mask, seen: f, score: 0, inView: false };
          this.entries.set(l, e);
        }
        e.seen = f;
      }
      else if (visit && ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite)) visit(o);
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) stack.push(ch[i]!);
    }
    this.list.length = 0;
    for (const [l, e] of this.entries) {
      if (e.seen !== f) {
        // Removed / hidden: give its layer mask back and forget it.
        if (!e.active) l.layers.mask = e.mask;
        this.entries.delete(l);
        continue;
      }
      this.list.push(e);
    }
  }

  /**
   * Pick the active set for this frame. `focus` = what the camera looks at (the player).
   * Call before any render / compile of the frame.
   */
  update(scene: THREE.Scene, camera: THREE.Camera, focus: THREE.Vector3, dt: number): void {
    this.gather(scene);
    const list = this.list;
    this.stats.total = list.length;
    if (!Number.isFinite(this.max) || list.length <= this.max) {
      // Under budget: everything on, full weight.
      for (const e of list) {
        if (e.light.layers.mask === 0) e.light.layers.mask = e.mask || 1;
        e.active = true;
        e.w = 1;
      }
      this.stats.active = list.length;
      return;
    }
    // Camera cut (teleport / demo / cutscene jump): no cross-fades.
    const cut = !(this.lastCam.distanceToSquared(camera.position) < 16);
    this.lastCam.copy(camera.position);

    camera.updateMatrixWorld();
    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_m, camera.coordinateSystem);
    for (const e of list) {
      const l = e.light;
      l.getWorldPosition(_p);
      const range = l.distance > 0 ? l.distance : 30;
      _s.set(_p, range);
      e.inView = _frustum.intersectsSphere(_s);
      // Lower = more important. Lit lamps in view nearest the focus win; unlit ones go last.
      let score = Math.max(0, _p.distanceTo(focus) - range * 0.5);
      if (!e.inView) score += 1000;
      if (l.intensity <= 0) score += 4000;
      // Hysteresis: a lamp holding a slot keeps it unless something is clearly more important.
      if (e.active) score -= 3;
      e.score = score;
    }
    list.sort((a, b) => a.score - b.score);
    const want = this.want;
    want.clear();
    for (let i = 0; i < this.max; i++) want.add(list[i]!);

    let held = 0;
    const k = dt / FADE_S;
    // Release / fade out lamps that lost their spot.
    for (const e of list) {
      if (!e.active) continue;
      if (want.has(e)) {
        e.w = cut ? 1 : Math.min(1, e.w + k);
      } else {
        e.w = cut || !e.inView || e.light.intensity <= 0 ? 0 : e.w - k;
        if (e.w <= 0) {
          e.active = false;
          e.w = 0;
          continue;
        }
      }
      held++;
    }
    // Hand free slots to the most important waiting lamps.
    for (const e of list) {
      if (held >= this.max) break;
      if (e.active || !want.has(e)) continue;
      e.active = true;
      e.w = cut || !e.inView || e.light.intensity <= 0 ? 1 : 0;
      held++;
    }
    // Keep the light count constant while a slot is between owners (no shader permutation change).
    for (const e of list) {
      if (held >= this.max) break;
      if (e.active) continue;
      e.active = true;
      e.w = 0;
      held++;
    }
    for (const e of list) {
      const l = e.light;
      if (e.active) {
        if (l.layers.mask === 0) l.layers.mask = e.mask || 1;
      } else if (l.layers.mask !== 0) {
        e.mask = l.layers.mask;
        l.layers.mask = 0;
      }
    }
    this.stats.active = held;
  }

  /** Scale active, fading lights for the duration of the frame's render calls. */
  beginRender(): void {
    this.scaled.length = 0;
    for (const e of this.list) {
      if (!e.active || e.w >= 1) continue;
      this.scaled.push({ l: e.light, i: e.light.intensity });
      e.light.intensity *= e.w;
    }
  }

  endRender(): void {
    for (const s of this.scaled) s.l.intensity = s.i;
    this.scaled.length = 0;
  }

  /** Give every light back (budget disabled). */
  reset(): void {
    for (const e of this.entries.values()) {
      if (e.light.layers.mask === 0) e.light.layers.mask = e.mask || 1;
    }
    this.entries.clear();
    this.list.length = 0;
  }
}
