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
      uniform float uRain;
      uniform float uSnow;
      varying vec3 vW;
      ${NOISE_GLSL}
      vec2 ripples(vec2 p, float t) {
        vec2 acc = vec2(0.0);
        for (int k = 0; k < 3; k++) {
          vec2 q = p * (1.6 + float(k) * 0.9) + float(k) * 5.3;
          vec2 id = floor(q);
          vec2 f = fract(q) - 0.5;
          vec2 jit = hvHash22(id) - 0.5;
          float ph = fract(t * (0.8 + 0.5 * hvHash12(id + 1.7)) + hvHash12(id));
          vec2 d = f - jit * 0.5;
          float r = length(d);
          float rr = ph * 0.5;
          float ring = sin((r - rr) * 55.0) * smoothstep(0.07, 0.0, abs(r - rr)) * (1.0 - ph);
          acc += normalize(d + 1e-4) * ring;
        }
        return acc;
      }
      float wh(vec2 q, float t) {
        return hvNoise(q * 1.1 + vec2(t * 0.22, t * 0.15)) * 0.5
             + hvNoise(q * 2.6 - vec2(t * 0.2, t * 0.31)) * 0.3
             + hvNoise(q * 6.3 + vec2(t * 0.5, -t * 0.35)) * 0.2;
      }
      // Voronoi border distance (F2 - F1): irregular fracture network for winter ice.
      float iceEdge(vec2 q) {
        vec2 ip = floor(q);
        vec2 fp = fract(q);
        float d1 = 8.0;
        float d2 = 8.0;
        for (int y = -1; y <= 1; y++)
        for (int x = -1; x <= 1; x++) {
          vec2 o = vec2(float(x), float(y));
          vec2 r = o + hvHash22(ip + o) - fp;
          float d = dot(r, r);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
        }
        return sqrt(d2) - sqrt(d1);
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
        float ice = smoothstep(0.5, 0.9, uSnow);
        amp *= 1.0 - ice * 0.95;
        vec3 n = normalize(vec3(-hx / (2.0 * e) * amp, 1.0, -hz / (2.0 * e) * amp));
        if (uRain > 0.01) {
          vec2 rp = ripples(p, t) * 0.9 * uRain * (1.0 - ice);
          n = normalize(n + vec3(rp.x, 0.0, rp.y));
        }
        vec3 V = normalize(cameraPosition - vW);
        vec3 L = normalize(uSunDir);
        float ndv = max(dot(n, V), 0.0);
        // Schlick Fresnel, water F0 = 0.02 (boosted a touch for the stylised look).
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        fres = max(fres, 0.06);

        // Depth absorption: shallow teal #6fc7c0 → deep #2b5d7a (linear), plus a green-brown silt tint at the edge.
        vec3 shallow = vec3(0.159, 0.571, 0.527);
        vec3 deep = vec3(0.024, 0.110, 0.195);
        float dd = clamp(depth, 0.0, 2.0);
        vec3 col = mix(shallow, deep, smoothstep(0.0, 1.1, dd));
        col = mix(col, vec3(0.2, 0.3, 0.18), smoothstep(0.12, 0.0, dd) * 0.5);
        // Caustic shimmer in the shallows.
        float caus = pow(hvNoise(p * 3.0 + vec2(t * 0.4, t * 0.3)) * hvNoise(p * 3.7 - vec2(t * 0.35, t * 0.2)), 1.5);
        col += vec3(0.5, 0.8, 0.7) * caus * 0.3 * (1.0 - smoothstep(0.0, 0.6, dd));

        float cloud = hvCloudShadow(p, t, uCloudShadow);
        float diff = 0.55 + 0.45 * max(dot(n, L), 0.0);
        vec3 lit = col * (uSunColor * diff * 0.9 * cloud + uSkyColor * 0.55);
        // Reflection: the sky gradient along the reflected ray, with the dark tree-lined banks
        // mirrored in a band near the shore (cheap stand-in for a planar reflection).
        vec3 Rv = reflect(-V, n);
        vec3 skyR = mix(uHorizonColor, uSkyColor, smoothstep(0.0, 0.7, Rv.y));
        float bank = smoothstep(0.7, 0.15, dd) * (0.55 + 0.45 * hvNoise(p * 0.9 + n.xz * 2.0));
        vec3 bankCol = mix(vec3(0.05, 0.1, 0.05), vec3(0.12, 0.2, 0.08), hvNoise(p * 2.2)) * (uSunColor * 0.4 + uSkyColor * 0.5);
        vec3 refl = mix(skyR * 1.05, bankCol, bank * 0.75);
        vec3 c = mix(lit, refl, clamp(fres * 1.6 + bank * 0.35, 0.0, 0.85));

        vec3 R = reflect(-L, n);
        float spec = pow(max(dot(R, V), 0.0), 220.0) * 6.0 + pow(max(dot(R, V), 0.0), 24.0) * 0.18;
        c += uSunColor * spec * cloud * (1.0 - uNight * 0.6);

        // Shoreline foam: a broken, animated ~0.3 m band (noise-thresholded), not a solid liner.
        float fn = hvNoise(p * 4.0 + t * 0.3);
        float fn2 = hvNoise(p * 9.0 - vec2(t * 0.5, t * 0.2));
        float edgeW = smoothstep(0.1, 0.0, depth);
        float foamN = fn * 0.6 + fn2 * 0.4;
        float shoreF = smoothstep(0.52, 0.66, foamN + edgeW * 0.55 - 0.18) * smoothstep(0.12, 0.02, depth);
        float band = smoothstep(0.8, 1.0, sin(depth * 22.0 - t * 1.6 + fn * 4.0)) * smoothstep(0.28, 0.06, depth) * smoothstep(0.35, 0.6, fn2);
        float foam = clamp(shoreF * 0.8 + band * 0.35, 0.0, 1.0);
        vec3 foamCol = vec3(0.95, 0.97, 0.96) * (uSunColor * 0.6 + uSkyColor * 0.6);
        c = mix(c, foamCol, foam);

        // Winter: the pond freezes — dark, glassy black ice (deep blue-teal, mirror-bright sky in it),
        // an irregular network of white fracture lines, trapped air bubbles, and wind-swept frost /
        // snow dusting thickening towards the shore.
        if (ice > 0.0) {
          vec2 wq = p + (vec2(hvNoise(p * 0.7), hvNoise(p * 0.7 + 5.2)) - 0.5) * 1.6;
          float e1 = iceEdge(wq * 0.55);
          float e2 = iceEdge(wq * 1.45 + 7.0);
          float crack = smoothstep(0.05, 0.0, e1) * 0.85 + smoothstep(0.035, 0.0, e2) * 0.45 * smoothstep(0.35, 0.65, hvNoise(p * 0.6 + 2.0));
          // Hairline cracks glow faintly under the surface (depth offset along the view).
          float sub = smoothstep(0.08, 0.0, iceEdge((wq - V.xz * 0.12) * 0.55)) * 0.25;
          vec3 deepIce = vec3(0.035, 0.1, 0.16);
          vec3 shallowIce = vec3(0.16, 0.3, 0.38);
          vec3 iceCol = mix(deepIce, shallowIce, smoothstep(1.2, 0.0, dd));
          iceCol *= uSunColor * 0.35 + uSkyColor * 0.9;
          // Bubbles: clusters of little white discs frozen in the ice.
          vec2 bq = p * 5.0;
          vec2 bid = floor(bq);
          vec2 bo = hvHash22(bid) - 0.5;
          float bsz = 0.1 + 0.18 * hvHash12(bid + 3.1);
          float bub = smoothstep(bsz, bsz * 0.55, length(fract(bq) - 0.5 - bo * 0.5)) * step(hvHash12(bid + 7.7), 0.2) * smoothstep(0.4, 0.7, hvNoise(p * 0.8 + 9.0));
          // Glassy: strong Fresnel sky mirror + a broad sheen and a crisp sun glint.
          vec3 Vn = normalize(cameraPosition - vW);
          float ifr = 0.12 + 0.88 * pow(1.0 - max(Vn.y, 0.0), 4.0);
          vec3 ic = mix(iceCol, skyR * 0.9, clamp(ifr * 0.9 + 0.12, 0.0, 0.7));
          ic += vec3(0.75, 0.88, 1.0) * (crack * 0.55 + sub) * (uSunColor * 0.4 + uSkyColor * 0.8);
          ic = mix(ic, vec3(0.8, 0.88, 0.95) * (uSkyColor * 0.9 + uSunColor * 0.25), bub * 0.7);
          vec3 Ri = reflect(-L, vec3(0.0, 1.0, 0.0));
          float ispec = pow(max(dot(Ri, Vn), 0.0), 60.0) * 1.2 + pow(max(dot(Ri, Vn), 0.0), 900.0) * 6.0;
          ic += uSunColor * ispec;
          // Frost + blown snow: streaky drifts across the ice, thick at the rim.
          vec2 sw = mat2(0.8, 0.6, -0.6, 0.8) * p;
          float drift = smoothstep(0.55, 0.85, hvNoise(vec2(sw.x * 0.35, sw.y * 1.6)) * 0.6 + hvNoise(p * 1.3) * 0.4);
          float rim = smoothstep(0.45, 0.0, depth + (fn - 0.5) * 0.35);
          float snowOn = clamp(max(rim, drift * 0.8) * smoothstep(0.3, 0.9, uSnow), 0.0, 1.0);
          vec3 snowCol = vec3(0.78, 0.84, 0.92) * (uSunColor * 0.45 + uSkyColor * 0.7);
          ic = mix(ic, snowCol, snowOn);
          c = mix(c, ic, ice);
        }
        float alpha = mix(0.55, 0.94, smoothstep(0.0, 0.7, dd));
        alpha = mix(alpha, 0.97, ice);
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
  mat.uniforms.uRain = globalUniforms.uRain;
  mat.uniforms.uSnow = globalUniforms.uSnow;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.userData.noAO = true;
  mesh.renderOrder = 2;
  return mesh;
}
