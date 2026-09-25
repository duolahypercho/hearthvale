/**
 * Static shadow cache (DESIGN pillar 14). The sun's shadow map used to re-render every caster
 * (~75 on the farm: buildings, trees, fences, props) every frame although almost all of them never
 * move. Now the still casters are baked into a cached depth map, which is refreshed only when it
 * goes stale; each frame that cache is blitted back into the live map and just the moving casters
 * (player, villagers, animals, swaying cloth / foliage with a wind depth material, skinned meshes,
 * anything whose transform changed in the last STILL_FRAMES) are drawn on top.
 *
 * The cache is refreshed (one full shadow render, i.e. what every frame used to cost) when:
 *   - the shadow camera moved: lighting.ts steps the sun direction / frustum in coarse, texel-exact
 *     increments, so this is a few times a second while walking and ~never standing still,
 *   - a baked caster moved, changed geometry / instances, or disappeared,
 *   - a caster settled (still for STILL_FRAMES) and is not in the cache yet,
 *   - the map was reallocated (quality / governor shadow resolution), or every REFRESH_S anyway.
 * Only a single directional shadow light (the sun / moon) is cached; anything else (interiors with
 * point-light shadows, the mine's own static-shadow mode) passes straight through.
 *
 * `?shadowcache=0` disables it (A/B). Stats: PostPipeline.shadowCache.stats.
 */
import * as THREE from 'three';

type Caster = THREE.Object3D & {
  isMesh?: boolean;
  isLine?: boolean;
  isPoints?: boolean;
  isSkinnedMesh?: boolean;
  isInstancedMesh?: boolean;
  isBatchedMesh?: boolean;
  geometry?: THREE.BufferGeometry;
  customDepthMaterial?: THREE.Material;
  instanceMatrix?: THREE.BufferAttribute;
  count?: number;
};

interface Track {
  m: Float64Array;
  geo: unknown;
  ver: number;
  dynUntil: number;
}

type ShadowRender = (lights: THREE.Light[], scene: THREE.Object3D, camera: THREE.Camera) => void;

/** Frames a caster must hold still before it is baked into the cache. */
const STILL_FRAMES = 60;
/** Safety net for changes the tracker cannot see (batched visibility, material swaps). */
const REFRESH_S = 2;
const KEY_LEN = 40;

function enabledByUrl(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('shadowcache');
    return !(q === '0' || q === 'false');
  } catch {
    return true;
  }
}

function versionOf(o: Caster): number {
  const g = o.geometry;
  let v = (g?.attributes.position as THREE.BufferAttribute | undefined)?.version ?? 0;
  if (o.isInstancedMesh) v += (o.instanceMatrix?.version ?? 0) * 7 + (o.count ?? 0) * 131;
  if (o.isBatchedMesh) v += ((o as unknown as { _matricesTexture?: THREE.Texture })._matricesTexture?.version ?? 0) * 7;
  return v;
}

export class StaticShadowCache {
  enabled = enabledByUrl();
  readonly stats = { frames: 0, refreshes: 0, dynamic: 0, baked: 0, why: { map: 0, light: 0, caster: 0, timer: 0 } };
  private cache: THREE.WebGLRenderTarget | null = null;
  private tracks = new WeakMap<THREE.Object3D, Track>();
  private baked = new Set<THREE.Object3D>();
  private dyn: Caster[] = [];
  private still: Caster[] = [];
  private stack: THREE.Object3D[] = [];
  private key = new Float64Array(KEY_LEN);
  private keyNow = new Float64Array(KEY_LEN);
  private keyMap: unknown = null;
  private light: THREE.Light | null = null;
  private frame = 0;
  private lastRefresh = -Infinity;
  /** The live map holds cache + dynamic casters (needs a blit before the next dynamic pass). */
  private mapDirty = false;
  private readonly orig: ShadowRender;
  private readonly noClear = (): void => {};

  constructor(private renderer: THREE.WebGLRenderer) {
    const sm = renderer.shadowMap as unknown as { render: ShadowRender };
    this.orig = sm.render.bind(renderer.shadowMap);
    sm.render = (lights, scene, camera) => this.render(lights, scene, camera);
  }

  /** Force a full re-render next frame. */
  invalidate(): void {
    this.lastRefresh = -Infinity;
  }

  dispose(): void {
    const sm = this.renderer.shadowMap as unknown as { render: ShadowRender };
    sm.render = this.orig;
    this.cache?.dispose();
    this.cache = null;
    this.baked.clear();
  }

  private render(lights: THREE.Light[], scene: THREE.Object3D, camera: THREE.Camera): void {
    const sm = this.renderer.shadowMap;
    const light = lights[0] as THREE.DirectionalLight | undefined;
    if (
      !this.enabled ||
      lights.length !== 1 ||
      !light?.isDirectionalLight ||
      sm.type === THREE.VSMShadowMap ||
      (sm.autoUpdate === false && sm.needsUpdate === false) ||
      light.shadow.autoUpdate === false
    ) {
      // Pass through. Other renders in the frame (bakes, previews) arrive with needsUpdate already
      // spent and draw nothing; only a real re-render of the cached light invalidates the cache.
      const spent = sm.autoUpdate === false && sm.needsUpdate === false;
      if (!spent && this.light && lights.includes(this.light)) {
        this.baked.clear();
        this.keyMap = null;
      }
      this.orig(lights, scene, camera);
      return;
    }
    this.light = light;
    const shadow = light.shadow;
    this.frame++;
    this.stats.frames++;
    this.classify(scene, camera);
    const why = this.stats.why;
    let refresh = false;
    if (!shadow.map || shadow.map !== this.keyMap || !this.cache) (refresh = true), why.map++;
    else if (this.keyChanged(light)) (refresh = true), why.light++;
    else if (this.needRefresh) (refresh = true), why.caster++;
    else if (performance.now() - this.lastRefresh > REFRESH_S * 1000) (refresh = true), why.timer++;
    if (refresh) this.keyChanged(light);
    const dyn = this.dyn;
    const still = this.still;
    if (refresh) {
      for (let i = 0; i < dyn.length; i++) dyn[i]!.castShadow = false;
      sm.needsUpdate = true;
      try {
        this.orig(lights, scene, camera);
      } finally {
        for (let i = 0; i < dyn.length; i++) dyn[i]!.castShadow = true;
      }
      const map = shadow.map;
      if (!map?.depthTexture) {
        this.baked.clear();
        return;
      }
      this.ensureCache(map);
      this.renderer.copyTextureToTexture(map.depthTexture, this.cache!.depthTexture!);
      this.baked.clear();
      for (let i = 0; i < still.length; i++) this.baked.add(still[i]!);
      this.keyMap = map;
      this.key.set(this.keyNow);
      this.lastRefresh = performance.now();
      this.mapDirty = false;
      this.stats.refreshes++;
    } else if (this.mapDirty || dyn.length > 0) {
      // Restore the baked depth (the live map still holds last frame's moving casters).
      if (this.mapDirty) this.renderer.copyTextureToTexture(this.cache!.depthTexture!, shadow.map!.depthTexture!);
      this.mapDirty = false;
    }
    this.stats.dynamic = dyn.length;
    this.stats.baked = this.baked.size;
    if (dyn.length === 0) {
      sm.needsUpdate = false;
      return;
    }
    // Moving casters on top of the baked depth: no clear, still casters hidden.
    for (let i = 0; i < still.length; i++) still[i]!.castShadow = false;
    const r = this.renderer as unknown as { clear: (c?: boolean, d?: boolean, s?: boolean) => void };
    const clear = r.clear;
    r.clear = this.noClear;
    sm.needsUpdate = true;
    try {
      this.orig(lights, scene, camera);
    } finally {
      r.clear = clear;
      for (let i = 0; i < still.length; i++) still[i]!.castShadow = true;
    }
    this.mapDirty = true;
  }

  private needRefresh = false;
  /** Debug: the caster behind the last caster-triggered refresh (null = one vanished). */
  lastCause: THREE.Object3D | null | undefined = undefined;

  /** Split this frame's shadow casters into moving (drawn every frame) and still (baked). */
  private classify(scene: THREE.Object3D, camera: THREE.Camera): void {
    const dyn = this.dyn;
    const still = this.still;
    dyn.length = 0;
    still.length = 0;
    this.needRefresh = false;
    this.lastCause = undefined;
    let bakedSeen = 0;
    const frame = this.frame;
    const stack = this.stack;
    stack.length = 0;
    stack.push(scene);
    while (stack.length) {
      const o = stack.pop() as Caster;
      if (!o.visible) continue;
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) stack.push(ch[i]!);
      if (!o.castShadow || !(o.isMesh || o.isLine || o.isPoints) || !o.layers.test(camera.layers)) continue;
      const e = o.matrixWorld.elements;
      const ver = versionOf(o);
      let t = this.tracks.get(o);
      if (!t) {
        t = { m: new Float64Array(e), geo: o.geometry, ver, dynUntil: frame + STILL_FRAMES };
        this.tracks.set(o, t);
      } else {
        const m = t.m;
        // BatchedMesh add / delete / setVisibleAt / setMatrixAt raise _visibilityChanged until its next
        // draw (cleared inside the shadow pass itself, so it is still set here).
        let moved = t.geo !== o.geometry || t.ver !== ver || (o.isBatchedMesh === true && (o as unknown as { _visibilityChanged?: boolean })._visibilityChanged === true);
        for (let i = 0; i < 16 && !moved; i++) moved = m[i] !== e[i];
        if (moved) {
          m.set(e);
          t.geo = o.geometry;
          t.ver = ver;
          t.dynUntil = frame + STILL_FRAMES;
        }
      }
      const moving = o.isSkinnedMesh === true || !!o.customDepthMaterial || frame < t.dynUntil;
      const baked = this.baked.has(o);
      if (baked) bakedSeen++;
      if (moving) {
        dyn.push(o);
        // Baked at a stale transform.
        if (baked) (this.needRefresh = true), (this.lastCause ??= o);
      } else {
        still.push(o);
        // Settled but not in the cache yet.
        if (!baked) (this.needRefresh = true), (this.lastCause ??= o);
      }
    }
    // A baked caster vanished (hidden, removed, castShadow off).
    if (bakedSeen !== this.baked.size) (this.needRefresh = true), (this.lastCause ??= null);
  }

  private keyChanged(light: THREE.DirectionalLight): boolean {
    const k = this.keyNow;
    const s = light.shadow;
    const cam = s.camera as THREE.OrthographicCamera;
    k.set(light.matrixWorld.elements, 0);
    k.set(light.target.matrixWorld.elements, 16);
    k[32] = cam.left;
    k[33] = cam.right;
    k[34] = cam.top;
    k[35] = cam.bottom;
    k[36] = cam.near;
    k[37] = cam.far;
    k[38] = s.mapSize.x;
    k[39] = s.mapSize.y;
    const o = this.key;
    for (let i = 0; i < KEY_LEN; i++) if (k[i] !== o[i]) return true;
    return false;
  }

  private ensureCache(map: THREE.RenderTarget): void {
    const w = map.width;
    const h = map.height;
    if (this.cache && this.cache.width === w && this.cache.height === h) return;
    this.cache?.dispose();
    const dt = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    dt.format = THREE.DepthFormat;
    dt.minFilter = dt.magFilter = THREE.NearestFilter;
    this.cache = new THREE.WebGLRenderTarget(w, h, { depthTexture: dt, generateMipmaps: false });
    this.renderer.initRenderTarget(this.cache);
  }
}
