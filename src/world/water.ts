/**
 * Stylized water surface: depth-tinted (shallow turquoise → deep teal) using the terrain
 * height texture, animated procedural normals, sky-tinted fresnel reflection, sun glints
 * (feed the bloom), soft shoreline foam with travelling ripple bands, and fog.
 */
import * as THREE from 'three';
import { globalUniforms } from '../render/uniforms';
import { NOISE_GLSL } from '../render/shaders/noise';
import type { Terrain } from './terrain';

export function createWater(terrain: Terrain, bounds: { x0: number; z0: number; x1: number; z1: number }, level: number): THREE.Mesh {
  const w = bounds.x1 - bounds.x0;
  const d = bounds.z1 - bounds.z0;
  const geo = new THREE.PlaneGeometry(w, d, Math.ceil(w * 2), Math.ceil(d * 2));
  geo.rotateX(-Math.PI / 2);
  geo.translate(bounds.x0 + w / 2, level, bounds.z0 + d / 2);
  const o = terrain.opts;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uHeight: { value: terrain.heightTex },
        uHOrigin: { value: new THREE.Vector2(o.minX, o.minZ) },
        uHSize: { value: new THREE.Vector2(o.maxX - o.minX, o.maxZ - o.minZ) },
        uLevel: { value: level },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform sampler2D uHeight;
      uniform vec2 uHOrigin;
      uniform vec2 uHSize;
      uniform float uLevel;
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyColor;
      uniform vec3 uHorizonColor;
      uniform float uNight;
      uniform float uWindStrength;
      uniform float uCloudShadow;
      varying vec3 vW;
      ${NOISE_GLSL}
      float wh(vec2 q, float t) {
        return hvNoise(q * 1.1 + vec2(t * 0.22, t * 0.15)) * 0.5
             + hvNoise(q * 2.6 - vec2(t * 0.2, t * 0.31)) * 0.3
             + hvNoise(q * 6.3 + vec2(t * 0.5, -t * 0.35)) * 0.2;
      }
      void main() {
        vec2 huv = (vW.xz - uHOrigin) / uHSize;
        float ground = texture2D(uHeight, huv).r;
        float depth = uLevel - ground;
        if (depth < -0.03) discard;
        float t = uTime;
        vec2 p = vW.xz;
        float e = 0.06;
        float amp = 0.28 + 0.12 * uWindStrength;
        float hx = wh(p + vec2(e, 0.0), t) - wh(p - vec2(e, 0.0), t);
        float hz = wh(p + vec2(0.0, e), t) - wh(p - vec2(0.0, e), t);
        vec3 n = normalize(vec3(-hx / (2.0 * e) * amp, 1.0, -hz / (2.0 * e) * amp));
        vec3 V = normalize(cameraPosition - vW);
        vec3 L = normalize(uSunDir);
        float ndv = max(dot(n, V), 0.0);
        float fres = 0.08 + 0.92 * pow(1.0 - ndv, 4.0);

        vec3 shallow = vec3(0.22, 0.62, 0.58);
        vec3 mid = vec3(0.06, 0.36, 0.42);
        vec3 deep = vec3(0.02, 0.14, 0.22);
        float dd = clamp(depth, 0.0, 2.0);
        vec3 col = mix(shallow, mid, smoothstep(0.0, 0.35, dd));
        col = mix(col, deep, smoothstep(0.35, 1.1, dd));
        // Caustic shimmer in the shallows.
        float caus = pow(hvNoise(p * 3.0 + vec2(t * 0.4, t * 0.3)) * hvNoise(p * 3.7 - vec2(t * 0.35, t * 0.2)), 1.5);
        col += vec3(0.5, 0.8, 0.7) * caus * 0.35 * (1.0 - smoothstep(0.0, 0.6, dd));

        float cloud = hvCloudShadow(p, t, uCloudShadow);
        float diff = 0.55 + 0.45 * max(dot(n, L), 0.0);
        vec3 lit = col * (uSunColor * diff * 0.9 * cloud + uSkyColor * 0.55);
        vec3 refl = mix(uHorizonColor, uSkyColor, 0.35) * 1.05;
        vec3 c = mix(lit, refl, fres * 0.75);

        vec3 R = reflect(-L, n);
        float spec = pow(max(dot(R, V), 0.0), 220.0) * 6.0 + pow(max(dot(R, V), 0.0), 24.0) * 0.18;
        c += uSunColor * spec * cloud * (1.0 - uNight * 0.6);

        // Shoreline foam + travelling ripple bands.
        float fn = hvNoise(p * 4.0 + t * 0.3);
        float shoreF = smoothstep(0.16, 0.0, depth + (fn - 0.5) * 0.08);
        float band = smoothstep(0.75, 1.0, sin(depth * 26.0 - t * 1.8 + fn * 3.0)) * smoothstep(0.32, 0.05, depth);
        float foam = clamp(shoreF * 0.9 + band * 0.45, 0.0, 1.0);
        vec3 foamCol = vec3(0.95, 0.97, 0.96) * (uSunColor * 0.6 + uSkyColor * 0.6);
        c = mix(c, foamCol, foam);

        float alpha = mix(0.55, 0.94, smoothstep(0.0, 0.7, dd));
        alpha = max(alpha, foam);
        alpha *= smoothstep(-0.03, 0.02, depth);
        gl_FragColor = vec4(c, alpha);
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uTime = globalUniforms.uTime;
  mat.uniforms.uSunDir = globalUniforms.uSunDir;
  mat.uniforms.uSunColor = globalUniforms.uSunColor;
  mat.uniforms.uSkyColor = globalUniforms.uSkyColor;
  mat.uniforms.uHorizonColor = globalUniforms.uHorizonColor;
  mat.uniforms.uNight = globalUniforms.uNight;
  mat.uniforms.uWindStrength = globalUniforms.uWindStrength;
  mat.uniforms.uCloudShadow = globalUniforms.uCloudShadow;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.userData.noAO = true;
  mesh.renderOrder = 2;
  return mesh;
}
