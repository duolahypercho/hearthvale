/**
 * Renderer + camera rig + post pipeline wrapper.
 * Camera: perspective ~35° FOV, pitched ~50° down, smoothly following a target.
 */
import * as THREE from 'three';
import type { Quality } from '../core/events';
import { PostPipeline, QUALITY_PRESETS, type QualityPreset } from './post';
import './batching';
import { LightBudget } from './lightbudget';
import { QualityGovernor } from './governor';
import { ShaderGate } from './shadergate';
import { setMaxAnisotropy } from './textures';
import { globalUniforms } from './uniforms';

export class CameraRig {
  readonly target = new THREE.Vector3();
  private smoothTarget = new THREE.Vector3();
  /** Degrees down from horizontal. */
  pitch = 50;
  /** Degrees; 0 = looking north (-Z). */
  yaw = 0;
  distance = 24;
  /** Exponential follow sharpness (higher = snappier). */
  follow = 5;
  /** World-space offset applied to the look target (e.g. look slightly ahead). */
  readonly lookOffset = new THREE.Vector3();
  /** Clamp region for the target (map bounds). */
  bounds: THREE.Box2 | null = null;
  private shake = 0;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  snap(): void {
    this.smoothTarget.copy(this.target);
    this.apply(0);
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-this.follow * dt);
    this.smoothTarget.lerp(this.target, k);
    this.apply(dt);
  }

  private apply(dt: number): void {
    const t = this.smoothTarget.clone().add(this.lookOffset);
    if (this.bounds) {
      t.x = THREE.MathUtils.clamp(t.x, this.bounds.min.x, this.bounds.max.x);
      t.z = THREE.MathUtils.clamp(t.z, this.bounds.min.y, this.bounds.max.y);
    }
    const p = THREE.MathUtils.degToRad(this.pitch);
    const y = THREE.MathUtils.degToRad(this.yaw);
    const off = new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)).multiplyScalar(this.distance);
    this.camera.position.copy(t).add(off);
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.25;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    this.camera.lookAt(t);
  }

  /** Current smoothed look-at point (after bounds). */
  get focus(): THREE.Vector3 {
    return this.smoothTarget;
  }
}

export class RenderContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: CameraRig;
  post: PostPipeline;
  quality: Quality;
  /** World point the tilt-shift keeps in focus (the player). */
  readonly focusPoint = new THREE.Vector3();
  private focusV = new THREE.Vector3();
  preset: QualityPreset;
  private width = 1;
  private height = 1;
  /** Per-tag draw calls / triangles of the last frame (all passes), see perfBreakdown(). */
  private perfAcc = new Map<string, { calls: number; triangles: number }>();
  private perfLast: Record<string, { calls: number; triangles: number }> = {};
  /** Debug: split the per-system breakdown by pass (shadow / ao / main). */
  perfPasses = false;
  /** Forward point-light budget (render/lightbudget.ts), sized by the quality preset. */
  readonly lights: LightBudget;
  /** Adaptive quality (render/governor.ts): sheds post / shadow res / pixel ratio when frames run long. */
  readonly governor: QualityGovernor;
  /** Holds back objects whose shaders aren't compiled yet and compiles them off-thread (render/shadergate.ts). */
  readonly shaderGate: ShaderGate;
  /** True while compile() runs: frames are skipped (the canvas keeps its last image) instead of compiling synchronously. */
  private compiling = 0;
  /** Governor-driven render-resolution scale (1 = preset pixel ratio). */
  resScale = 1;
  /**
   * Behind full-screen menus (blurred backdrop, sim paused) the world only needs to refresh at a
   * few Hz: >0 caps world renders to this rate; the canvas keeps its last frame in between.
   */
  backdropHz = 0;
  private lastRenderAt = -1;
  private lastFrameAt = -1;

  constructor(private container: HTMLElement, quality: Quality) {
    this.quality = quality;
    this.preset = QUALITY_PRESETS[quality];
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement);
    setMaxAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    this.camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.5, 400);
    this.rig = new CameraRig(this.camera);
    this.scene.add(this.camera);

    this.lights = new LightBudget(this.preset.pointLights);
    this.shaderGate = new ShaderGate(this.renderer, this.scene, this.camera, () => this.sceneTarget());
    this.lights.visit = (o) => this.shaderGate.visit(o);
    this.governor = new QualityGovernor(this);
    this.installPerfProbe();
    this.measure();
    this.post = new PostPipeline(this.renderer, this.scene, this.camera, this.preset);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private measure(): void {
    this.width = Math.max(1, this.container.clientWidth || window.innerWidth);
    this.height = Math.max(1, this.container.clientHeight || window.innerHeight);
  }

  get pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.preset.pixelRatioCap) * this.resScale;
  }

  resize(): void {
    this.measure();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    const s = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(s);
    this.post.setSize(s.x, s.y);
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.preset = QUALITY_PRESETS[q];
    this.post.dispose();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.post = new PostPipeline(this.renderer, this.scene, this.camera, this.preset);
    this.lights.max = this.preset.pointLights;
    this.governor.reset();
    this.resize();
  }

  render(dt: number, time: number): void {
    globalUniforms.uTime.value = time;
    this.rig.update(dt);
    const now = performance.now();
    if (this.lastFrameAt >= 0) this.governor.sample(now - this.lastFrameAt);
    this.lastFrameAt = now;
    if (this.compiling > 0) return;
    if (this.backdropHz > 0 && this.lastRenderAt >= 0 && now - this.lastRenderAt < 1000 / this.backdropHz - 1) return;
    this.lastRenderAt = now;
    this.lights.update(this.scene, this.camera, this.rig.focus, dt);
    this.shaderGate.flush();
    // Tilt-shift: keep a band around the player sharp, gentle (≤4 px) blur above / below.
    this.camera.updateMatrixWorld();
    this.focusV.copy(this.focusPoint).project(this.camera);
    const f = THREE.MathUtils.clamp(this.focusV.y * 0.5 + 0.5, 0.2, 0.7);
    this.post.setTiltShift(f, 0.26, 0.7);
    // Accumulate stats over all passes of the frame (shadow, AO, main, post).
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.perfAcc.clear();
    this.lights.beginRender();
    try {
      this.post.render(time);
    } finally {
      this.lights.endRender();
    }
    this.pinPrograms();
    const out: Record<string, { calls: number; triangles: number }> = {};
    for (const [k, v] of [...this.perfAcc.entries()].sort((a, b) => b[1].triangles - a[1].triangles)) out[k] = { ...v };
    this.perfLast = out;
  }

  /**
   * Attribute every draw (shadow, AO, main, post) to a tag so teams can see their cost:
   * the nearest ancestor with `userData.perfTag`, else the top-level object under a map root /
   * the scene. Read via perfBreakdown() → __game.info().perf.bySystem.
   */
  private installPerfProbe(): void {
    const r = this.renderer as THREE.WebGLRenderer & { renderBufferDirect: (...a: unknown[]) => void };
    const orig = r.renderBufferDirect.bind(r);
    const info = this.renderer.info.render;
    const tagOf = (o: THREE.Object3D): string => {
      const cached = o.userData.__perfTag as string | undefined;
      if (cached) return cached;
      let n: THREE.Object3D | null = o;
      let tag = '';
      while (n) {
        if (n.userData.perfTag) {
          tag = n.userData.perfTag as string;
          break;
        }
        const p: THREE.Object3D | null = n.parent;
        if (!p || (p as THREE.Scene).isScene || p.name.startsWith('map:')) {
          tag = n.name || n.type;
          break;
        }
        n = p;
      }
      if (!tag) tag = o.name || o.type;
      if (o.parent) o.userData.__perfTag = tag;
      return tag;
    };
    r.renderBufferDirect = (...a: unknown[]) => {
      const c0 = info.calls;
      const t0 = info.triangles;
      orig(...a);
      const obj = a[4] as THREE.Object3D;
      let tag = obj.parent ? tagOf(obj) : 'post';
      if (this.perfPasses) {
        const cam = a[0] as THREE.Camera & { isOrthographicCamera?: boolean };
        const mat = a[3] as THREE.Material;
        tag += cam.isOrthographicCamera ? '/shadow' : mat.type === 'MeshNormalMaterial' ? '/ao' : '/main';
      }
      let e = this.perfAcc.get(tag);
      if (!e) this.perfAcc.set(tag, (e = { calls: 0, triangles: 0 }));
      e.calls += info.calls - c0;
      e.triangles += info.triangles - t0;
    };
  }

  /** Draw calls / triangles per system tag for the last rendered frame, heaviest first. */
  perfBreakdown(): Record<string, { calls: number; triangles: number }> {
    return this.perfLast;
  }

  /**
   * compile() only builds `object.material`; shadow-pass depth variants (alpha-tested / custom depth
   * materials) compiled the first time a caster entered the sun's frustum mid-play. One throwaway
   * render with frustum culling off (1×1 target, shadow maps forced) builds them all up front.
   */
  private warmShadowPass(): void {
    const r = this.renderer;
    const unculled: THREE.Object3D[] = [];
    const batches: THREE.BatchedMesh[] = [];
    // Hidden casters (a fish that leaps later, a prop shown at dusk) render nothing now: draw a
    // proxy (same geometry + material) so their depth variant exists too (a textured material
    // needs its own `map` depth program even without alpha test).
    const proxies = new THREE.Group();
    const seen = new Set<string>();
    const shown = (o: THREE.Object3D): boolean => {
      for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
      return true;
    };
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!o.castShadow || !m.isMesh || (o as THREE.SkinnedMesh).isSkinnedMesh || (o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.BatchedMesh).isBatchedMesh || Array.isArray(m.material) || shown(o)) return;
      const key = `${(m.material as THREE.Material).uuid}|${Object.keys(m.geometry.attributes).join()}|${Object.keys(m.geometry.morphAttributes).length}`;
      if (seen.has(key)) return;
      seen.add(key);
      const px = new THREE.Mesh(m.geometry, m.material);
      px.castShadow = true;
      px.frustumCulled = false;
      if (o.customDepthMaterial) px.customDepthMaterial = o.customDepthMaterial;
      proxies.add(px);
    });
    this.scene.add(proxies);
    this.scene.traverse((o) => {
      if (o.castShadow && o.frustumCulled && ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints)) {
        o.frustumCulled = false;
        unculled.push(o);
      }
      // A batch whose instances are all outside the sun frustum right now draws nothing (and so
      // compiles nothing) until the camera pans: draw every instance once.
      const b = o as THREE.BatchedMesh;
      if (b.isBatchedMesh && b.perObjectFrustumCulled) {
        b.perObjectFrustumCulled = false;
        batches.push(b);
      }
    });
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    const prev = r.getRenderTarget();
    const auto = r.shadowMap.autoUpdate;
    // three shares one depth material between casters and only re-picks its program on a state
    // change, so which `map` / `alphaMap` variants exist depends on draw order. Force the re-pick
    // for every caster during the warm-up so each one's variant is built (cached ones are reused).
    const rr = r as unknown as { renderBufferDirect: (...a: unknown[]) => void };
    const rbd = rr.renderBufferDirect;
    rr.renderBufferDirect = function (this: unknown, ...a: unknown[]) {
      const mat = a[3] as THREE.Material & { isMeshDepthMaterial?: boolean; isMeshDistanceMaterial?: boolean };
      if (mat && (mat.isMeshDepthMaterial || mat.isMeshDistanceMaterial)) mat.needsUpdate = true;
      return rbd.apply(this, a);
    };
    try {
      r.shadowMap.autoUpdate = false;
      r.shadowMap.needsUpdate = true;
      r.setRenderTarget(rt);
      r.render(this.scene, this.camera);
    } finally {
      rr.renderBufferDirect = rbd;
      r.setRenderTarget(prev);
      r.shadowMap.autoUpdate = auto;
      for (const o of unculled) o.frustumCulled = true;
      for (const b of batches) b.perObjectFrustumCulled = true;
      proxies.removeFromParent();
      rt.dispose();
    }
  }

  /**
   * Program cache retention: three destroys a shader program as soon as the last material using it
   * is disposed, so per-spawn / per-hit materials (monsters, FX) recompiled the same program every
   * time (0.3-0.9 s stalls in mine combat). Pin every program once: disposing materials no longer
   * evicts them, and the set is bounded by the game's distinct shader variants.
   */
  private pinnedPrograms = 0;
  private pinPrograms(): void {
    const progs = this.renderer.info.programs as unknown as ({ usedTimes: number; __hvPinned?: boolean }[] | null);
    if (!progs || progs.length === this.pinnedPrograms) return;
    for (const p of progs) {
      if (p.__hvPinned) continue;
      p.__hvPinned = true;
      p.usedTimes++;
    }
    this.pinnedPrograms = progs.length;
  }

  /** The render target scene passes draw into (linear HDR, no tone mapping). */
  private sceneTarget(): THREE.WebGLRenderTarget | null {
    return this.post.composer.readBuffer ?? null;
  }

  /** Pre-compile all materials in the scene. */
  async compile(): Promise<void> {
    // Settle the light budget first: programs are keyed by the light count.
    this.camera.updateMatrixWorld();
    const gate = this.shaderGate.enabled;
    this.shaderGate.enabled = false;
    this.lights.update(this.scene, this.camera, this.rig.focus, 0);
    this.shaderGate.enabled = gate;
    const r = this.renderer as THREE.WebGLRenderer & { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown> };
    this.compiling++;
    try {
      // Compile for the target the scene is really drawn into (the composer's linear HDR buffer):
      // programs are keyed by output colour space + tone mapping, so compiling against the canvas
      // built sRGB / tone-mapped variants no frame ever used (and the real ones compiled on first draw).
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(this.sceneTarget());
      let job: Promise<unknown> | null = null;
      try {
        if (r.compileAsync) job = r.compileAsync(this.scene, this.camera);
        else this.renderer.compile(this.scene, this.camera);
      } finally {
        this.renderer.setRenderTarget(prev);
      }
      // Never hold frames longer than a few seconds, whatever the driver does.
      if (job) await Promise.race([job, new Promise((res) => setTimeout(res, 4000))]);
      this.warmShadowPass();
      this.pinPrograms();
    } finally {
      this.compiling--;
      this.shaderGate.settle();
    }
  }
}
