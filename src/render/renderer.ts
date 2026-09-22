/**
 * Renderer + camera rig + post pipeline wrapper.
 * Camera: perspective ~35° FOV, pitched ~50° down, smoothly following a target.
 */
import * as THREE from 'three';
import type { Quality } from '../core/events';
import { PostPipeline, QUALITY_PRESETS, type QualityPreset } from './post';
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
    return Math.min(window.devicePixelRatio || 1, this.preset.pixelRatioCap);
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
    this.resize();
  }

  render(dt: number, time: number): void {
    globalUniforms.uTime.value = time;
    this.rig.update(dt);
    // Tilt-shift: keep a band around the player sharp, gentle (≤4 px) blur above / below.
    this.camera.updateMatrixWorld();
    this.focusV.copy(this.focusPoint).project(this.camera);
    const f = THREE.MathUtils.clamp(this.focusV.y * 0.5 + 0.5, 0.2, 0.7);
    this.post.setTiltShift(f, 0.26, 0.7);
    // Accumulate stats over all passes of the frame (shadow, AO, main, post).
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.post.render(time);
  }

  /** Pre-compile all materials in the scene. */
  async compile(): Promise<void> {
    const r = this.renderer as THREE.WebGLRenderer & { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown> };
    if (r.compileAsync) await r.compileAsync(this.scene, this.camera);
    else this.renderer.compile(this.scene, this.camera);
  }
}
