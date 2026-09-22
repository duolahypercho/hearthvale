/**
 * Post-processing pipeline:
 *   Render(HDR) → GTAO (subtle) → UnrealBloom (high threshold) → Output (ACES + sRGB)
 *   → SMAA → tilt-shift (H,V) → grade (lift/gamma/gain, saturation, contrast, vignette, grain)
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
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: { pixelRatioCap: 1, shadowMapSize: 1024, shadowRadius: 2, ao: false, aoSamples: 8, bloom: false, tiltShift: false, smaa: true, grassDensity: 0.35 },
  medium: { pixelRatioCap: 1.25, shadowMapSize: 2048, shadowRadius: 3, ao: false, aoSamples: 8, bloom: true, tiltShift: true, smaa: true, grassDensity: 0.65 },
  high: { pixelRatioCap: 1.5, shadowMapSize: 4096, shadowRadius: 3, ao: true, aoSamples: 12, bloom: true, tiltShift: true, smaa: true, grassDensity: 1 },
  ultra: { pixelRatioCap: 2, shadowMapSize: 4096, shadowRadius: 4, ao: true, aoSamples: 16, bloom: true, tiltShift: true, smaa: true, grassDensity: 1.3 },
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
    uGrain: { value: 0.025 },
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
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
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
      c += n * uGrain * (1.0 - l * 0.5);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

export class PostPipeline {
  readonly composer: EffectComposer;
  readonly grade: ShaderPass;
  private renderPass: RenderPass;
  private gtao: GTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private smaa: SMAAPass | null = null;
  private tiltH: ShaderPass | null = null;
  private tiltV: ShaderPass | null = null;
  private size = new THREE.Vector2();

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    public preset: QualityPreset,
  ) {
    renderer.getDrawingBufferSize(this.size);
    const rt = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    if (preset.ao) {
      this.gtao = new GTAOPass(scene, camera, this.size.x, this.size.y);
      this.gtao.blendIntensity = 0.75;
      this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: preset.aoSamples, distanceFallOff: 1 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
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
      this.tiltV = new ShaderPass(TiltShiftShader);
      (this.tiltV.uniforms.uDir!.value as THREE.Vector2).set(0, 1);
      this.composer.addPass(this.tiltH);
      this.composer.addPass(this.tiltV);
    }
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.setSize(this.size.x, this.size.y);
  }

  /** Tilt-shift parameters: focus (0 bottom..1 top), clear band half-height, blur strength px. */
  setTiltShift(focus: number, band: number, strength: number): void {
    for (const p of [this.tiltH, this.tiltV]) {
      if (!p) continue;
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
    for (const p of [this.tiltH, this.tiltV, this.grade]) {
      if (p) (p.uniforms.uResolution!.value as THREE.Vector2).set(w, h);
    }
  }

  render(time: number): void {
    this.grade.uniforms.uTime!.value = time;
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
