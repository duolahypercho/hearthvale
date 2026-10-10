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
 * Amortised refresh (Perf r12): a refresh that the live cache can wait for — the REFRESH_S timer, or a
 * caster that settled (it keeps drawing with the moving casters until it is baked) — is rebuilt over
 * SPLIT frames into a back buffer: each frame draws one triangle-balanced slice of the still casters
 * on top of the slices so far, and the last slice swaps the back buffer in. The frame that used to
 * re-render every still caster (town-south: +287k triangles, a 1.6M peak) now draws a third of them.
 * Anything that makes the cache wrong right now (shadow camera step, map realloc, a baked caster
 * moved or vanished, invalidate()) still refreshes in full at once and drops a pending rebuild.
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
  /** Times it moved again after settling. */
  wakes: number;
}

type ShadowRender = (lights: THREE.Light[], scene: THREE.Object3D, camera: THREE.Camera) => void;

/** Frames a caster must hold still before it is baked into the cache. */
const STILL_FRAMES = 60;
/**
 * A small caster that wakes up again after settling (a hopping critter, the mailbox flag) stays with the
 * moving casters for good after its first wake: every wake of a baked caster costs a full refresh
 * (farm-morning: 4 in 5 s, +48 draws / +130k triangles each), drawing it every frame costs a few hundred.
 */
const WAKES_DYN = 1;
const SMALL_TRIS = 4000;
/** Safety net for changes the tracker cannot see (batched visibility, material swaps). */
const REFRESH_S = 2;
const KEY_LEN = 40;
/** Frames an amortised refresh is spread over (?shadowsplit=1 = the old one-frame refresh). */
const SPLIT = ((): number => {
  try {
    const q = Number(new URLSearchParams(location.search).get('shadowsplit'));
    if (q >= 1 && q <= 8) return Math.floor(q);
  } catch {
    /* not in a browser */
  }
  return 3;
})();

function trisOf(o: Caster): number {
  if (o.isBatchedMesh) {
    // Live instances only (the batch's buffers are over-reserved).
    const b = o as unknown as { _instanceInfo: { active: boolean; visible: boolean; geometryIndex: number }[]; _geometryInfo: { count: number }[] };
    let n = 0;
    for (const inst of b._instanceInfo) if (inst.active && inst.visible) n += b._geometryInfo[inst.geometryIndex]?.count ?? 0;
    return n / 3;
  }
  const g = o.geometry;
  if (!g) return 0;
  const n = (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
  return o.isInstancedMesh ? n * (o.count ?? 1) : n;
}

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
  /** Frames an amortised refresh spreads over (runtime A/B: 1 = refresh in one frame). */
  split = SPLIT;
  readonly stats = { frames: 0, refreshes: 0, split: 0, aborted: 0, dynamic: 0, baked: 0, why: { map: 0, light: 0, caster: 0, timer: 0, settle: 0 } };
  private cache: THREE.WebGLRenderTarget | null = null;
  /** Back buffer of an amortised refresh. */
  private back: THREE.WebGLRenderTarget | null = null;
  /** Pending amortised refresh: still casters snapshot -> slice index, and the next slice to draw. */
  private build: { slice: Map<THREE.Object3D, number>; next: number; of: number } | null = null;
  private buildAbort = false;
  private buildSeen = 0;
  private forceFull = false;
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
    this.forceFull = true;
  }

  dispose(): void {
    const sm = this.renderer.shadowMap as unknown as { render: ShadowRender };
    sm.render = this.orig;
    this.cache?.dispose();
    this.cache = null;
    this.back?.dispose();
    this.back = null;
    this.build = null;
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
    let lazy = false;
    if (!refresh && this.forceFull) (refresh = true), why.timer++;
    else if (!refresh && this.split > 1 && (this.needLazy || performance.now() - this.lastRefresh > REFRESH_S * 1000)) {
      // The cache is still right, just incomplete / due: rebuild it over SPLIT frames.
      lazy = true;
      if (!this.build) this.needLazy ? why.settle++ : why.timer++;
    } else if (!refresh && this.needLazy) (refresh = true), why.caster++;
    else if (!refresh && performance.now() - this.lastRefresh > REFRESH_S * 1000) (refresh = true), why.timer++;
    this.forceFull = false;
    if (refresh) this.keyChanged(light);
    const dyn = this.dyn;
    const still = this.still;
    if (this.build && (refresh || this.buildAbort || this.buildSeen !== this.build.slice.size)) {
      this.build = null;
      this.stats.aborted++;
    }
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
    } else {
      if (lazy && !this.build) this.startBuild(still);
      if (this.build) this.buildSlice(lights, scene, camera, still);
      if (this.mapDirty || dyn.length > 0) {
        // Restore the baked depth (the live map still holds last frame's moving casters / a slice).
        if (this.mapDirty) this.renderer.copyTextureToTexture(this.cache!.depthTexture!, shadow.map!.depthTexture!);
        this.mapDirty = false;
      }
    }
    // Moving casters, plus settled ones not baked yet (an amortised refresh is under way).
    let unbaked = 0;
    for (let i = 0; i < still.length; i++) if (!this.baked.has(still[i]!)) unbaked++;
    this.stats.dynamic = dyn.length + unbaked;
    this.stats.baked = this.baked.size;
    if (dyn.length === 0 && unbaked === 0) {
      sm.needsUpdate = false;
      return;
    }
    // Moving casters on top of the baked depth: no clear, baked casters hidden.
    for (let i = 0; i < still.length; i++) if (this.baked.has(still[i]!)) still[i]!.castShadow = false;
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

  /** Snapshot the still casters into SPLIT triangle-balanced slices (greedy, biggest first). */
  private startBuild(still: Caster[]): void {
    const order = still.map((o) => ({ o, t: trisOf(o) + 1 })).sort((a, b) => b.t - a.t);
    const n = this.split;
    const load = new Float64Array(n);
    const slice = new Map<THREE.Object3D, number>();
    for (const { o, t } of order) {
      let k = 0;
      for (let j = 1; j < n; j++) if (load[j]! < load[k]!) k = j;
      load[k] += t;
      slice.set(o, k);
    }
    this.build = { slice, next: 0, of: n };
    this.buildSeen = slice.size;
    this.buildAbort = false;
  }

  /** Draw the next slice into the back buffer; the last one swaps it in as the cache. */
  private buildSlice(lights: THREE.Light[], scene: THREE.Object3D, camera: THREE.Camera, still: Caster[]): void {
    const b = this.build!;
    const shadow = (lights[0] as THREE.DirectionalLight).shadow;
    const map = shadow.map;
    if (!map?.depthTexture || !this.cache) {
      this.build = null;
      return;
    }
    const k = b.next;
    const dyn = this.dyn;
    const r = this.renderer as unknown as { clear: (c?: boolean, d?: boolean, s?: boolean) => void };
    const clear = r.clear;
    // Slice 0 clears the live map; later slices stack on the back buffer's depth so far.
    if (k > 0) {
      this.renderer.copyTextureToTexture(this.back!.depthTexture!, map.depthTexture);
      r.clear = this.noClear;
    } else this.ensureBack(map);
    for (let i = 0; i < dyn.length; i++) dyn[i]!.castShadow = false;
    for (let i = 0; i < still.length; i++) if (b.slice.get(still[i]!) !== k) still[i]!.castShadow = false;
    const sm = this.renderer.shadowMap;
    sm.needsUpdate = true;
    try {
      this.orig(lights, scene, camera);
    } finally {
      r.clear = clear;
      for (let i = 0; i < dyn.length; i++) dyn[i]!.castShadow = true;
      for (let i = 0; i < still.length; i++) still[i]!.castShadow = true;
    }
    this.stats.split++;
    this.mapDirty = true;
    if (k + 1 < b.of) {
      this.renderer.copyTextureToTexture(map.depthTexture, this.back!.depthTexture!);
      b.next = k + 1;
      return;
    }
    // Complete: the live map now holds every snapshot caster; it becomes the cache.
    this.renderer.copyTextureToTexture(map.depthTexture, this.cache.depthTexture!);
    this.baked.clear();
    for (const o of b.slice.keys()) this.baked.add(o);
    this.build = null;
    this.lastRefresh = performance.now();
    this.stats.refreshes++;
    this.mapDirty = false;
  }

  private needRefresh = false;
  /** A settled caster is waiting to be baked (the cache is incomplete, not wrong). */
  private needLazy = false;
  /** Debug: the caster behind the last caster-triggered refresh (null = one vanished). */
  lastCause: THREE.Object3D | null | undefined = undefined;

  /** Split this frame's shadow casters into moving (drawn every frame) and still (baked). */
  private classify(scene: THREE.Object3D, camera: THREE.Camera): void {
    // Indexed writes + a final length (no `length = 0` + push: that dropped and re-grew the backing
    // stores every frame, ~6 KB of garbage; pillar 14).
    const dyn = this.dyn;
    const still = this.still;
    let nd = 0;
    let ns = 0;
    this.needRefresh = false;
    this.needLazy = false;
    this.lastCause = undefined;
    const build = this.build;
    let seen = 0;
    let bakedSeen = 0;
    const frame = this.frame;
    const stack = this.stack;
    let sp = 0;
    let hi = 1;
    stack[sp++] = scene;
    while (sp > 0) {
      const o = stack[--sp] as Caster;
      if (!o.visible) continue;
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) stack[sp++] = ch[i]!;
      if (sp > hi) hi = sp;
      if (!o.castShadow || !(o.isMesh || o.isLine || o.isPoints) || !o.layers.test(camera.layers)) continue;
      const e = o.matrixWorld.elements;
      const ver = versionOf(o);
      let t = this.tracks.get(o);
      if (!t) {
        t = { m: new Float64Array(e), geo: o.geometry, ver, dynUntil: frame + STILL_FRAMES, wakes: 0 };
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
          if (frame >= t.dynUntil) t.wakes++;
          t.dynUntil = t.wakes >= WAKES_DYN && trisOf(o) < SMALL_TRIS ? Infinity : frame + STILL_FRAMES;
        }
      }
      const moving = o.isSkinnedMesh === true || !!o.customDepthMaterial || frame < t.dynUntil;
      const baked = this.baked.has(o);
      if (baked) bakedSeen++;
      if (moving) {
        dyn[nd++] = o;
        // Baked at a stale transform.
        if (baked) (this.needRefresh = true), (this.lastCause ??= o);
        // A pending rebuild drew (or will draw) it where it no longer is.
        if (build && build.slice.has(o)) this.buildAbort = true;
      } else {
        still[ns++] = o;
        if (build && build.slice.has(o)) seen++;
        // Settled but not in the cache yet (drawn with the moving casters meanwhile).
        if (!baked) (this.needLazy = true), (this.lastCause ??= o);
      }
    }
    dyn.length = nd;
    still.length = ns;
    // Stale slots past this walk's high-water mark (an old map's objects must not stay reachable).
    if (stack.length > hi) stack.length = hi;
    // A baked caster vanished (hidden, removed, castShadow off).
    if (bakedSeen !== this.baked.size) (this.needRefresh = true), (this.lastCause ??= null);
    this.buildSeen = build ? seen : 0;
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

  private ensureBack(map: THREE.RenderTarget): void {
    const w = map.width;
    const h = map.height;
    if (this.back && this.back.width === w && this.back.height === h) return;
    this.back?.dispose();
    const dt = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    dt.format = THREE.DepthFormat;
    dt.minFilter = dt.magFilter = THREE.NearestFilter;
    this.back = new THREE.WebGLRenderTarget(w, h, { depthTexture: dt, generateMipmaps: false });
    this.renderer.initRenderTarget(this.back);
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
