/**
 * Post-processing pipeline:
 *   Render(HDR) → GTAO (subtle) → UnrealBloom (high threshold) → Output (ACES + sRGB)
 *   → SMAA → tilt-shift H → grade (+ tilt-shift V fused; lift/gamma/gain, saturation, contrast, vignette, grain)
 * GTAO runs at `aoScale` resolution and multiplies straight onto the read buffer.
 * Each stage is toggled by the quality preset.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { Quality } from '../core/events';
import { HeightFogPass } from './heightfog';
import { StaticShadowCache } from './shadowcache';

export interface QualityPreset {
  pixelRatioCap: number;
  shadowMapSize: number;
  shadowRadius: number;
  ao: boolean;
  aoSamples: number;
  bloom: boolean;
  tiltShift: boolean;
  smaa: boolean;
  /** Multiplier for instanced grass density. */
  grassDensity: number;
  /** Film-grain amplitude (luminance-weighted, shadows only); 0 disables it. */
  grain: number;
  /** GTAO resolution scale (0.5 = half-res normal / AO / denoise targets, bilinear upsample in the blend). */
  aoScale: number;
  /** Max forward-shaded point lights per frame (render/lightbudget.ts); the most important in view win. */
  pointLights: number;
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: { pixelRatioCap: 1, shadowMapSize: 1024, shadowRadius: 2, ao: false, aoSamples: 8, bloom: false, tiltShift: false, smaa: true, grassDensity: 0.35, grain: 0, aoScale: 0.5, pointLights: 4 },
  medium: { pixelRatioCap: 1.25, shadowMapSize: 2048, shadowRadius: 3, ao: false, aoSamples: 8, bloom: true, tiltShift: true, smaa: true, grassDensity: 0.65, grain: 0, aoScale: 0.5, pointLights: 6 },
  // pixelRatioCap 1.25 / 2048 shadows (was 1.5 / 4096): ~30 % fewer pixels on Retina and a quarter of
  // the shadow fill for no visible loss after SMAA + tilt-shift (A/B shots, pillar 14); ultra keeps the rest.
  high: { pixelRatioCap: 1.25, shadowMapSize: 2048, shadowRadius: 3, ao: true, aoSamples: 12, bloom: true, tiltShift: true, smaa: true, grassDensity: 1, grain: 0.016, aoScale: 0.5, pointLights: 8 },
  ultra: { pixelRatioCap: 2, shadowMapSize: 4096, shadowRadius: 4, ao: true, aoSamples: 16, bloom: true, tiltShift: true, smaa: true, grassDensity: 1.3, grain: 0.018, aoScale: 1, pointLights: 12 },
};

const FULLSCREEN_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const TiltShiftShader = {
  name: 'TiltShift',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uDir: { value: new THREE.Vector2(1, 0) },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uFocus: { value: 0.5 },
    uBand: { value: 0.2 },
    uStrength: { value: 1.7 },
  },
  vertexShader: FULLSCREEN_VS,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uDir;
    uniform vec2 uResolution;
    uniform float uFocus;
    uniform float uBand;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      float d = abs(vUv.y - uFocus);
      float amt = smoothstep(uBand, uBand + 0.42, d) * uStrength * (uResolution.y / 1080.0);
      if (amt < 0.05) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec4 sum = vec4(0.0);
      float wsum = 0.0;
      for (int i = -6; i <= 6; i++) {
        float fi = float(i);
        float w = exp(-fi * fi / 18.0);
        sum += texture2D(tDiffuse, vUv + uDir * fi * amt / uResolution) * w;
        wsum += w;
      }
      gl_FragColor = sum / wsum;
    }
  `,
};

export const GradeShader = {
  name: 'Grade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGamma: { value: new THREE.Vector3(1, 1, 1) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSaturation: { value: 1.1 },
    uContrast: { value: 1.05 },
    uVignette: { value: 0.35 },
    uVignetteColor: { value: new THREE.Color(0.08, 0.05, 0.1) },
    uGrain: { value: 0.016 },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
  },
  vertexShader: FULLSCREEN_VS,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uLift;
    uniform vec3 uGamma;
    uniform vec3 uGain;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignette;
    uniform vec3 uVignetteColor;
    uniform float uGrain;
    uniform float uTime;
    uniform vec2 uResolution;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    #ifdef TILT
    // Vertical tilt-shift blur fused into the grade (saves a full-screen pass; same kernel as TiltShift).
    uniform float uFocus;
    uniform float uBand;
    uniform float uStrength;
    vec3 sampleScene() {
      float d = abs(vUv.y - uFocus);
      float amt = smoothstep(uBand, uBand + 0.42, d) * uStrength * (uResolution.y / 1080.0);
      if (amt < 0.05) return texture2D(tDiffuse, vUv).rgb;
      vec3 sum = vec3(0.0);
      float wsum = 0.0;
      for (int i = -6; i <= 6; i++) {
        float fi = float(i);
        float w = exp(-fi * fi / 18.0);
        sum += texture2D(tDiffuse, vUv + vec2(0.0, fi * amt / uResolution.y)).rgb * w;
        wsum += w;
      }
      return sum / wsum;
    }
    #else
    vec3 sampleScene() { return texture2D(tDiffuse, vUv).rgb; }
    #endif
    void main() {
      vec3 c = sampleScene();
      c = c * uGain + uLift * (1.0 - c);
      c = pow(max(c, vec3(0.0)), 1.0 / uGamma);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c = (c - 0.5) * uContrast + 0.5;
      vec2 q = vUv - 0.5;
      q.x *= uResolution.x / uResolution.y;
      float v = smoothstep(0.35, 1.05, length(q));
      c = mix(c, c * uVignetteColor * 2.0, v * uVignette);
      c = mix(c, c * 0.0 + uVignetteColor, v * v * uVignette * 0.35);
      float n = hash(vUv * uResolution + fract(uTime * 7.13) * 431.0) - 0.5;
      // Luminance-weighted: a whisper of grain in the shadows, none on bright grass / sky.
      c += n * uGrain * (1.0 - smoothstep(0.08, 0.45, l));
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

export class PostPipeline {
  readonly composer: EffectComposer;
  readonly grade: ShaderPass;
  private renderPass: RenderPass;
  /** Height fog + volumetric light shafts (render/heightfog.ts; driven through its `atmosphere` state). */
  readonly heightFog: HeightFogPass;
  private gtao: GTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private smaa: SMAAPass | null = null;
  private tiltH: ShaderPass | null = null;
  private size = new THREE.Vector2();
  /** Still casters baked into a cached shadow map; only moving ones re-render each frame (render/shadowcache.ts). */
  readonly shadowCache: StaticShadowCache;
  /** Adaptive-quality switches (render/governor.ts): passes can be dropped without recompiles. */
  aoEnabled = true;
  bloomEnabled = true;
  /** Governor multiplier on the preset's aoScale (1 = preset; <1 = cheaper AO targets when GPU-bound). */
  private aoScaleK = 1;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    public preset: QualityPreset,
  ) {
    renderer.getDrawingBufferSize(this.size);
    this.shadowCache = new StaticShadowCache(renderer);
    // Depth texture: the atmosphere pass (height fog + light shafts) reads the scene depth.
    const rt = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { type: THREE.HalfFloatType, samples: 0, depthTexture: new THREE.DepthTexture(this.size.x, this.size.y) });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.heightFog = new HeightFogPass(camera);
    this.composer.addPass(this.heightFog);

    if (preset.ao) {
      this.gtao = new GTAOPass(scene, camera, this.size.x, this.size.y);
      this.gtao.blendIntensity = 0.75;
      this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: preset.aoSamples, distanceFallOff: 1 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      // Skip objects flagged `userData.noAO` (dense grass, water, particles) in the AO G-buffer pass.
      const g = this.gtao as unknown as { _overrideVisibility: () => void; _visibilityCache: THREE.Object3D[] };
      // A subtree is skipped when any ancestor has noAO (unless the object opts back in with `ao`).
      // One iterative walk of the visible tree carrying the inherited flag (was a full traverse
      // plus an ancestor walk per mesh every frame); reused stacks, no per-frame allocation.
      const stack: THREE.Object3D[] = [];
      const inherited: boolean[] = [];
      g._overrideVisibility = () => {
        stack.push(scene);
        inherited.push(false);
        while (stack.length) {
          const o = stack.pop()!;
          const noAO = inherited.pop()! || !!o.userData.noAO;
          if (!o.visible) continue;
          const p = o as THREE.Object3D & { isPoints?: boolean; isLine?: boolean; isMesh?: boolean };
          if (p.isPoints || p.isLine || (p.isMesh && noAO && !o.userData.ao)) {
            o.visible = false;
            g._visibilityCache.push(o);
            continue; // hidden: its children don't draw either
          }
          const ch = o.children;
          for (let i = 0; i < ch.length; i++) {
            stack.push(ch[i]!);
            inherited.push(noAO);
          }
        }
      };
      // Half-res G-buffer / AO / denoise (≈¼ the fill of the extra scene pass and the AO kernel);
      // the blend samples the AO bilinearly at full res. Blend straight onto the read buffer
      // (multiply) instead of copy + blend into the write buffer: one full-screen pass fewer.
      const gp = this.gtao as unknown as {
        setSize: (w: number, h: number) => void;
        render: (r: THREE.WebGLRenderer, wb: THREE.WebGLRenderTarget, rb: THREE.WebGLRenderTarget, dt?: number, mask?: boolean) => void;
        _renderGBuffer: boolean;
        _restoreVisibility: () => void;
        _renderOverride: (r: THREE.WebGLRenderer, m: THREE.Material, t: THREE.WebGLRenderTarget, c: number, a: number) => void;
        _renderPass: (r: THREE.WebGLRenderer, m: THREE.Material, t: THREE.WebGLRenderTarget | null, c?: number, a?: number) => void;
        normalMaterial: THREE.Material;
        normalRenderTarget: THREE.WebGLRenderTarget;
        gtaoRenderTarget: THREE.WebGLRenderTarget;
        pdRenderTarget: THREE.WebGLRenderTarget;
        gtaoMaterial: THREE.ShaderMaterial;
        pdMaterial: THREE.ShaderMaterial;
        blendMaterial: THREE.ShaderMaterial;
        blendIntensity: number;
        output: number;
        needsSwap: boolean;
      };
      const baseSetSize = gp.setSize.bind(this.gtao);
      gp.setSize = (w: number, h: number) => {
        const k = preset.aoScale * this.aoScaleK;
        baseSetSize(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
      };
      const baseRender = gp.render.bind(this.gtao);
      gp.needsSwap = false;
      gp.render = (r, wb, rb, dt, mask) => {
        if (gp.output !== 0) {
          gp.needsSwap = true;
          baseRender(r, wb, rb, dt, mask);
          return;
        }
        gp.needsSwap = false;
        if (gp._renderGBuffer) {
          g._overrideVisibility();
          gp._renderOverride(r, gp.normalMaterial, gp.normalRenderTarget, 0x7777ff, 1.0);
          gp._restoreVisibility();
        }
        const u = gp.gtaoMaterial.uniforms;
        u.cameraNear!.value = camera.near;
        u.cameraFar!.value = camera.far;
        (u.cameraProjectionMatrix!.value as THREE.Matrix4).copy(camera.projectionMatrix);
        (u.cameraProjectionMatrixInverse!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
        (u.cameraWorldMatrix!.value as THREE.Matrix4).copy(camera.matrixWorld);
        gp._renderPass(r, gp.gtaoMaterial, gp.gtaoRenderTarget, 0xffffff, 1.0);
        (gp.pdMaterial.uniforms.cameraProjectionMatrixInverse!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
        gp._renderPass(r, gp.pdMaterial, gp.pdRenderTarget, 0xffffff, 1.0);
        gp.blendMaterial.uniforms.intensity!.value = gp.blendIntensity;
        gp.blendMaterial.uniforms.tDiffuse!.value = gp.pdRenderTarget.texture;
        gp._renderPass(r, gp.blendMaterial, rb);
      };
      this.composer.addPass(this.gtao);
    }
    if (preset.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(this.size.x, this.size.y), 0.32, 0.55, 0.92);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    if (preset.smaa) {
      this.smaa = new SMAAPass();
      this.composer.addPass(this.smaa);
    }
    if (preset.tiltShift) {
      this.tiltH = new ShaderPass(TiltShiftShader);
      this.composer.addPass(this.tiltH);
    }
    // The vertical tilt-shift blur runs inside the grade pass (TILT define).
    this.grade = new ShaderPass(
      preset.tiltShift
        ? { ...GradeShader, defines: { TILT: 1 }, uniforms: { ...GradeShader.uniforms, uFocus: { value: 0.5 }, uBand: { value: 0.2 }, uStrength: { value: 1.7 } } }
        : GradeShader,
    );
    this.grade.uniforms.uGrain!.value = preset.grain;
    this.composer.addPass(this.grade);
    this.setSize(this.size.x, this.size.y);
  }

  /** Tilt-shift parameters: focus (0 bottom..1 top), clear band half-height, blur strength px. */
  setTiltShift(focus: number, band: number, strength: number): void {
    if (!this.tiltH) return;
    for (const p of [this.tiltH, this.grade]) {
      p.uniforms.uFocus!.value = focus;
      p.uniforms.uBand!.value = band;
      p.uniforms.uStrength!.value = strength;
    }
  }

  setBloom(strength: number, threshold?: number): void {
    if (!this.bloom) return;
    this.bloom.strength = strength;
    if (threshold !== undefined) this.bloom.threshold = threshold;
  }

  setSize(w: number, h: number): void {
    this.size.set(w, h);
    this.composer.setPixelRatio(1);
    this.composer.setSize(w, h);
    for (const p of [this.tiltH, this.grade]) {
      if (p) (p.uniforms.uResolution!.value as THREE.Vector2).set(w, h);
    }
  }

  /** Adaptive quality: drop / restore GTAO and bloom without touching any shader. */
  /**
   * Adaptive quality: GTAO G-buffer / AO / denoise targets at `k` × the preset's aoScale (render-target
   * resize only, no recompile). The scene targets keep their size, so only the AO targets reallocate.
   */
  setAOScale(k: number): void {
    if (k === this.aoScaleK) return;
    this.aoScaleK = k;
    if (this.gtao) this.gtao.setSize(this.size.x, this.size.y);
  }

  setAOEnabled(on: boolean): void {
    this.aoEnabled = on;
    if (this.gtao) this.gtao.enabled = on;
  }

  setBloomEnabled(on: boolean): void {
    this.bloomEnabled = on;
    if (this.bloom) this.bloom.enabled = on;
  }

  /** Active composer passes (for perf reports). */
  activePasses(): string[] {
    return this.composer.passes.filter((p) => p.enabled).map((p) => (p as unknown as { constructor: { name: string } }).constructor.name);
  }

  render(time: number): void {
    this.grade.uniforms.uTime!.value = time;
    this.heightFog.sync();
    // Render shadow maps once per frame (the RenderPass), not again inside the GTAO pass.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.composer.render();
  }

  dispose(): void {
    this.shadowCache.dispose();
    this.composer.dispose();
  }
}
