/**
 * Co-op lobby / character-creator rendering (DESIGN pillar 14: the lobby must not cost more than
 * the farm).
 *
 * While the co-op screen is open the world behind it is a blurred backdrop nobody plays in, so:
 *  - the world is rendered ONCE, copied off the canvas, downsampled + blurred + colour-graded on the
 *    GPU (the look of the CSS `.u-backdrop` filter, which is switched off for this screen), and every
 *    later frame just draws that still — one full-screen quad instead of the whole farm;
 *  - the farmer turntable is drawn by the MAIN renderer (no second WebGL context): into a scissored
 *    corner of the canvas, copied into the preview's 2D canvas (same task, so the drawing buffer is
 *    still there), then covered by the backdrop quad.
 * Result: a few draw calls per frame for the whole screen.
 */
import * as THREE from 'three';
import type { Game } from '../core/game';

/** Anything the lobby renderer can draw into a 2D canvas: the character-creator turntable. */
export interface TurntableView {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  /** CSS size of the preview. */
  readonly width: number;
  readonly height: number;
  tick(dt: number): void;
}

const FULL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tSrc, vUv) * 0.2270270;
  c += texture2D(tSrc, vUv + uStep * 1.3846154) * 0.3162162;
  c += texture2D(tSrc, vUv - uStep * 1.3846154) * 0.3162162;
  c += texture2D(tSrc, vUv + uStep * 3.2307692) * 0.0702703;
  c += texture2D(tSrc, vUv - uStep * 3.2307692) * 0.0702703;
  gl_FragColor = c;
}`;

// Same grade as `.u-backdrop` (hud.css): saturate(1.4) contrast(1.12) sepia(0.06) brightness(0.98),
// applied to display-referred (sRGB) values like CSS filters are.
const GRADE_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tSharp;
uniform float uK;
varying vec2 vUv;
void main() {
  vec3 c = mix(texture2D(tSharp, vUv).rgb, texture2D(tSrc, vUv).rgb, uK);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.4);
  c = (c - 0.5) * 1.12 + 0.5;
  vec3 sep = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
  c = mix(c, sep, 0.06) * 0.98;
  gl_FragColor = vec4(mix(texture2D(tSharp, vUv).rgb, clamp(c, 0.0, 1.0), uK), 1.0);
}`;

export class LobbyRenderer {
  private fb: THREE.FramebufferTexture | null = null;
  private rtA: THREE.WebGLRenderTarget | null = null;
  private rtB: THREE.WebGLRenderTarget | null = null;
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quadScene = new THREE.Scene();
  private readonly quad: THREE.Mesh;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly gradeMat: THREE.ShaderMaterial;
  private captured = false;
  /** Seconds after opening at which the backdrop is re-taken (the world may still be settling:
   *  first frame after a load, fades, AO / shadows converging). Then it stays frozen. */
  private recapture = [0.3, 1.2, 3];
  private view: TurntableView | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private active = false;
  private openedAt = 0;
  private readonly size = new THREE.Vector2();
  private readonly db = new THREE.Vector2();
  private readonly onResize = (): void => {
    this.captured = false;
  };

  constructor(private game: Game) {
    this.blurMat = new THREE.ShaderMaterial({ vertexShader: FULL_VERT, fragmentShader: BLUR_FRAG, uniforms: { tSrc: { value: null }, uStep: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false });
    this.gradeMat = new THREE.ShaderMaterial({ vertexShader: FULL_VERT, fragmentShader: GRADE_FRAG, uniforms: { tSrc: { value: null }, tSharp: { value: null }, uK: { value: 0 } }, depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Take over the frame (screen opened). `view`: the turntable to draw, if any. */
  begin(view: TurntableView | null): void {
    this.view = view;
    this.ctx = view ? view.canvas.getContext('2d') : null;
    if (this.active) return;
    this.active = true;
    this.captured = false;
    this.recapture = [0.3, 1.2, 3];
    this.openedAt = performance.now();
    window.addEventListener('resize', this.onResize);
    this.game.renderOverride = (dt) => this.frame(dt);
  }

  setView(view: TurntableView | null): void {
    this.view = view;
    this.ctx = view ? view.canvas.getContext('2d') : null;
  }

  end(): void {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('resize', this.onResize);
    if (this.game.renderOverride) this.game.renderOverride = null;
    this.view = null;
    this.ctx = null;
    // Keep the textures for the next open (same size); they're small next to the world's targets.
  }

  private frame(dt: number): boolean {
    const g = this.game;
    const r = g.rc.renderer;
    const age = (performance.now() - this.openedAt) / 1000;
    if (this.recapture.length && age >= this.recapture[0]!) {
      this.recapture.shift();
      this.captured = false;
    }
    if (!this.captured) {
      // One real world frame, then keep it.
      g.rc.render(dt, g.time);
      this.capture(r);
    }
    r.info.reset();
    if (this.view && this.ctx) this.drawTurntable(r, this.view, this.ctx, dt);
    this.drawBackdrop(r);
    return true;
  }

  private capture(r: THREE.WebGLRenderer): void {
    r.getDrawingBufferSize(this.db);
    const w = Math.max(1, Math.floor(this.db.x));
    const h = Math.max(1, Math.floor(this.db.y));
    if (!this.fb || this.fb.image.width !== w || this.fb.image.height !== h) {
      this.fb?.dispose();
      this.fb = new THREE.FramebufferTexture(w, h);
      this.fb.minFilter = THREE.LinearFilter;
      this.fb.magFilter = THREE.LinearFilter;
      const qw = Math.max(1, Math.round(w / 3));
      const qh = Math.max(1, Math.round(h / 3));
      this.rtA?.dispose();
      this.rtB?.dispose();
      const opts = { depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
      this.rtA = new THREE.WebGLRenderTarget(qw, qh, opts);
      this.rtB = new THREE.WebGLRenderTarget(qw, qh, opts);
    }
    r.setRenderTarget(null);
    r.copyFramebufferToTexture(this.fb, null);
    const qw = this.rtA!.width;
    const qh = this.rtA!.height;
    const step = this.blurMat.uniforms.uStep!.value as THREE.Vector2;
    const src = this.blurMat.uniforms.tSrc!;
    this.quad.material = this.blurMat;
    const prevAuto = r.autoClear;
    r.autoClear = false;
    // Downsample (1/3) + one separable 9-tap blur ≈ CSS blur(6px) at 1080p.
    const passes: [THREE.Texture, THREE.WebGLRenderTarget, number, number][] = [
      [this.fb, this.rtA!, 0.75 / qw, 0],
      [this.rtA!.texture, this.rtB!, 0, 0.75 / qh],
    ];
    for (const [tex, rt, sx, sy] of passes) {
      src.value = tex;
      step.set(sx, sy);
      r.setRenderTarget(rt);
      r.render(this.quadScene, this.quadCam);
    }
    r.setRenderTarget(null);
    r.autoClear = prevAuto;
    this.gradeMat.uniforms.tSrc!.value = this.rtB!.texture;
    this.gradeMat.uniforms.tSharp!.value = this.fb;
    this.captured = true;
  }

  private drawTurntable(r: THREE.WebGLRenderer, v: TurntableView, ctx: CanvasRenderingContext2D, dt: number): void {
    v.tick(dt);
    r.getSize(this.size);
    const pr = r.getPixelRatio();
    const w = Math.min(v.width, this.size.x);
    const h = Math.min(v.height, this.size.y);
    const exposure = r.toneMappingExposure;
    r.toneMappingExposure = 1;
    r.setRenderTarget(null);
    // Top-left corner of the canvas (GL viewport origin is bottom-left).
    r.setViewport(0, this.size.y - h, w, h);
    r.setScissor(0, this.size.y - h, w, h);
    r.setScissorTest(true);
    r.clear(true, true, false);
    r.render(v.scene, v.camera);
    r.setScissorTest(false);
    r.setViewport(0, 0, this.size.x, this.size.y);
    r.toneMappingExposure = exposure;
    const cw = v.canvas.width;
    const ch = v.canvas.height;
    ctx.drawImage(r.domElement, 0, 0, Math.round(w * pr), Math.round(h * pr), 0, 0, cw, ch);
  }

  private drawBackdrop(r: THREE.WebGLRenderer): void {
    if (!this.captured) return;
    // Ease the blur in like the CSS backdrop used to (240 ms).
    const k = Math.min(1, (performance.now() - this.openedAt) / 240);
    this.gradeMat.uniforms.uK!.value = k * k * (3 - 2 * k);
    this.quad.material = this.gradeMat;
    r.setRenderTarget(null);
    const prevAuto = r.autoClear;
    r.autoClear = false;
    r.render(this.quadScene, this.quadCam);
    r.autoClear = prevAuto;
  }
}
