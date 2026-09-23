/**
 * Crepuscular light shafts slanting through canopy gaps. Each shaft is a quad stretched from the
 * ground along the sun direction and turned (around that axis) to face the camera; soft gaussian
 * falloff across, fading at both ends, with slowly drifting dust / leaf-shadow breakup.
 * Brightness follows the sun (strong low morning / golden sun, gone at night / under overcast)
 * and is boosted by morning fog (`setFog`). One draw call, additive.
 */
import * as THREE from 'three';
import { globalUniforms } from '../../render/uniforms';
import { NOISE_GLSL } from '../../render/shaders/noise';

export interface RaySpot {
  x: number;
  y: number;
  z: number;
  /** Width (m). */
  w: number;
}

export class GodRays {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  readonly uniforms: { uStrength: THREE.IUniform<number>; uFog: THREE.IUniform<number> };

  constructor(spots: RaySpot[], length = 13) {
    const n = spots.length;
    const g = new THREE.InstancedBufferGeometry();
    // Quad: x across (-0.5..0.5), y along the shaft (0 ground .. 1 top).
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const a = new Float32Array(n * 4);
    const s = new Float32Array(n);
    spots.forEach((p, i) => {
      a.set([p.x, p.y, p.z, p.w], i * 4);
      s[i] = Math.random();
    });
    g.setAttribute('aSpot', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(s, 1));
    g.instanceCount = n;
    this.uniforms = { uStrength: { value: 1 }, uFog: { value: 0 } };
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: globalUniforms.uTime,
        uSunDir: globalUniforms.uSunDir,
        uSunColor: globalUniforms.uSunColor,
        uNight: globalUniforms.uNight,
        uLen: { value: length },
        ...this.uniforms,
      },
      vertexShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform float uLen;
        uniform float uTime;
        attribute vec4 aSpot;
        attribute float aSeed;
        varying vec2 vUv;
        varying float vSeed;
        varying float vFacing;
        void main() {
          vec3 L = normalize(uSunDir);
          // Keep shafts from lying flat when the sun is very low.
          L = normalize(vec3(L.x, max(L.y, 0.42), L.z));
          vec3 base = aSpot.xyz;
          vec3 mid = base + L * uLen * 0.5;
          vec3 toCam = normalize(cameraPosition - mid);
          vec3 side = normalize(cross(L, toCam));
          float w = aSpot.w * (1.0 + position.y * 0.55);
          float sway = sin(uTime * 0.35 + aSeed * 30.0) * 0.12;
          vec3 wp = base + side * (position.x * w + sway * position.y) + L * position.y * uLen;
          vUv = vec2(position.x + 0.5, position.y);
          vSeed = aSeed;
          vFacing = abs(dot(toCam, L));
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunColor;
        uniform float uNight;
        uniform float uStrength;
        uniform float uFog;
        varying vec2 vUv;
        varying float vSeed;
        varying float vFacing;
        ${NOISE_GLSL}
        void main() {
          float across = exp(-pow((vUv.x - 0.5) * 2.6, 2.0) * 2.2);
          float along = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
          // Leaf-gap flicker: a few bright striations drifting across the shaft.
          float stri = hvNoise(vec2(vUv.x * 5.0 + vSeed * 13.0, vUv.y * 0.6 - uTime * 0.05)) * 0.55
                     + hvNoise(vec2(vUv.x * 11.0 - uTime * 0.07, vSeed * 7.0)) * 0.45;
          float flick = 0.75 + 0.25 * sin(uTime * 0.7 + vSeed * 40.0);
          float lum = dot(uSunColor, vec3(0.3, 0.5, 0.2));
          float k = uStrength * (0.9 + uFog * 1.6) * smoothstep(0.08, 0.5, lum) * (1.0 - uNight);
          float a = across * along * (0.35 + 0.65 * smoothstep(0.25, 0.75, stri)) * flick * k * 0.16;
          // Fade shafts seen end-on (looking straight down the beam).
          a *= 1.0 - smoothstep(0.85, 0.98, vFacing);
          vec3 col = uSunColor * vec3(1.05, 0.98, 0.82);
          gl_FragColor = vec4(col * a, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'god-rays';
    this.mesh.userData.noAO = true;
    this.mesh.userData.perfTag = 'godrays';
  }
}
