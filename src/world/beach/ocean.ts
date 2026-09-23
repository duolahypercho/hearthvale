/**
 * Stylised ocean for Driftsand Beach.
 *
 *   depth     from the terrain height texture: turquoise shallows → teal → deep ocean blue,
 *             see-through near the shore (the sandy bed + its caustics show through)
 *   swash     every wave cycle the water sheet physically runs up the beach (vertex lift that only
 *             exists in the shallows) and slides back; a bright lacy foam front leads it
 *   breakers  crest lines travel shoreward and break over the sandbar / inshore as foam bands,
 *             with back-lit turquoise at the crest (sub-surface)
 *   surface   multi-octave directional normals + swell; sky-gradient reflection with Fresnel;
 *             hot sun glints (> 1.0, they feed the bloom) and a glitter path under a low sun
 *   far       a second, flat plane reaches to the horizon and dissolves into the sky's horizon colour
 * Plus HorizonClouds: a band of streaky, sun-lit clouds low on the sky dome (sunset hero shots).
 *
 * The swash phase is shared (SWASH_GLSL / swashPhase) with the sand shader so the wet band and the
 * foam lace left on the sand line up with the water.
 */
import * as THREE from 'three';
import { globalUniforms } from '../../render/uniforms';
import { NOISE_GLSL } from '../../render/shaders/noise';
import type { Terrain } from '../terrain';

/** Seconds per wave cycle. */
export const WAVE_PERIOD = 7.2;

export const SWASH_GLSL = /* glsl */ `
float hvSwashPhase(vec2 p, float t) {
  return t / ${WAVE_PERIOD.toFixed(2)} + p.x * 0.0045 + hvNoise(p * 0.035) * 0.35;
}
// Lift of the water sheet over the beach: quick run-up, slow backwash (m).
float hvSwash(vec2 p, float t) {
  float ph = fract(hvSwashPhase(p, t));
  float up = smoothstep(0.0, 0.22, ph) * (1.0 - smoothstep(0.22, 0.95, ph));
  return up * 0.13 - 0.025;
}
`;

/** Wave-cycle phase at world x (for audio / crabs / gameplay), matches the shader. */
export function swashPhase(x: number, t: number): number {
  return t / WAVE_PERIOD + x * 0.0045;
}

const VORONOI_GLSL = /* glsl */ `
vec2 hvVor(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hvHash22(i + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return vec2(sqrt(d1), sqrt(d2));
}
// Foam lace: bright cell borders.
float hvLace(vec2 p, float t) {
  vec2 v = hvVor(p + vec2(hvNoise(p * 0.5 + t * 0.2), hvNoise(p * 0.5 - t * 0.17)) * 0.8);
  return smoothstep(0.16, 0.02, v.y - v.x);
}
`;

export { VORONOI_GLSL };

export interface OceanOptions {
  terrain: Terrain;
  level: number;
  near: { x0: number; z0: number; x1: number; z1: number };
  step?: number;
}

function oceanMaterial(terrain: Terrain, level: number, far: boolean): THREE.ShaderMaterial {
  const o = terrain.opts;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHeight: { value: terrain.heightTex },
      uHOrigin: { value: new THREE.Vector2(o.minX, o.minZ) },
      uHSize: { value: new THREE.Vector2(o.maxX - o.minX, o.maxZ - o.minZ) },
      uLevel: { value: level },
      uFar: { value: far ? 1 : 0 },
      uTime: globalUniforms.uTime,
      uSunDir: globalUniforms.uSunDir,
      uSunColor: globalUniforms.uSunColor,
      uSkyColor: globalUniforms.uSkyColor,
      uHorizonColor: globalUniforms.uHorizonColor,
      uNight: globalUniforms.uNight,
      uWindStrength: globalUniforms.uWindStrength,
      uCloudShadow: globalUniforms.uCloudShadow,
      uRain: globalUniforms.uRain,
      uFogColor: { value: new THREE.Color() },
    },
    vertexShader: /* glsl */ `
      uniform sampler2D uHeight;
      uniform vec2 uHOrigin;
      uniform vec2 uHSize;
      uniform float uLevel;
      uniform float uFar;
      uniform float uTime;
      varying vec3 vW;
      varying float vLift;
      ${NOISE_GLSL}
      ${SWASH_GLSL}
      float groundAt(vec2 xz) {
        vec2 huv = (xz - uHOrigin) / uHSize;
        if (uFar > 0.5 || huv.x < 0.0 || huv.y < 0.0 || huv.x > 1.0 || huv.y > 1.0) return -6.0;
        return texture2D(uHeight, huv).r;
      }
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float ground = groundAt(wp.xz);
        float d0 = uLevel - ground;
        float lift = 0.0;
        if (uFar < 0.5) {
          lift = hvSwash(wp.xz, uTime) * smoothstep(1.4, 0.0, d0);
          // Open-water swell (fades out in the shallows so the waterline stays put).
          float sw = sin(dot(wp.xz, vec2(0.05, 0.42)) - uTime * 0.9) * 0.045 + sin(dot(wp.xz, vec2(-0.28, 0.31)) - uTime * 1.4) * 0.02;
          lift += sw * smoothstep(0.4, 2.5, d0);
        }
        wp.y += lift;
        vLift = lift;
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uHeight;
      uniform vec2 uHOrigin;
      uniform vec2 uHSize;
      uniform float uLevel;
      uniform float uFar;
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyColor;
      uniform vec3 uHorizonColor;
      uniform float uNight;
      uniform float uWindStrength;
      uniform float uCloudShadow;
      uniform float uRain;
      varying vec3 vW;
      varying float vLift;
      ${NOISE_GLSL}
      ${SWASH_GLSL}
      ${VORONOI_GLSL}
      float groundAt(vec2 xz) {
        vec2 huv = (xz - uHOrigin) / uHSize;
        if (uFar > 0.5 || huv.x < 0.0 || huv.y < 0.0 || huv.x > 1.0 || huv.y > 1.0) return -6.0;
        return texture2D(uHeight, huv).r;
      }
      // Directional wave height field (wind from the south-west, towards shore = -Z).
      float wh(vec2 q, float t) {
        vec2 a = vec2(q.x * 0.8 + q.y * 0.35, q.y);
        return hvNoise(a * 0.55 + vec2(0.0, t * 0.32)) * 0.5
             + hvNoise(a * 1.4 + vec2(t * 0.11, t * 0.5)) * 0.28
             + hvNoise(q * 3.3 + vec2(-t * 0.35, t * 0.6)) * 0.14
             + hvNoise(q * 7.9 + vec2(t * 0.7, -t * 0.4)) * 0.08;
      }
      vec2 ripples(vec2 p, float t) {
        vec2 acc = vec2(0.0);
        for (int k = 0; k < 2; k++) {
          vec2 q = p * (1.8 + float(k) * 0.9) + float(k) * 5.3;
          vec2 id = floor(q);
          vec2 f = fract(q) - 0.5;
          vec2 jit = hvHash22(id) - 0.5;
          float ph = fract(t * (0.8 + 0.5 * hvHash12(id + 1.7)) + hvHash12(id));
          vec2 d = f - jit * 0.5;
          float r = length(d);
          float ring = sin((r - ph * 0.5) * 55.0) * smoothstep(0.07, 0.0, abs(r - ph * 0.5)) * (1.0 - ph);
          acc += normalize(d + 1e-4) * ring;
        }
        return acc;
      }
      void main() {
        float t = uTime;
        vec2 p = vW.xz;
        float ground = groundAt(p);
        float level = uLevel + vLift;
        float depth = level - ground;
        if (depth < 0.0) discard;
        vec3 toCam = cameraPosition - vW;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec3 L = normalize(uSunDir);

        // Normals: detail fades with distance (no shimmer at the horizon).
        float detail = 1.0 - smoothstep(40.0, 160.0, dist);
        float e = 0.08;
        float amp = (0.22 + 0.1 * uWindStrength) * mix(0.35, 1.0, detail) * smoothstep(0.0, 0.25, depth);
        float hx = wh(p + vec2(e, 0.0), t) - wh(p - vec2(e, 0.0), t);
        float hz = wh(p + vec2(0.0, e), t) - wh(p - vec2(0.0, e), t);
        vec3 n = normalize(vec3(-hx / (2.0 * e) * amp, 1.0, -hz / (2.0 * e) * amp));

        // Breakers: crest lines travelling shoreward (towards shallower water).
        float ph = hvSwashPhase(p, t);
        float wv = fract(ph + depth * 0.55 + hvNoise(p * 0.12) * 0.12);
        float crest = smoothstep(0.86, 1.0, wv) + smoothstep(0.12, 0.0, wv);
        float breakZone = smoothstep(1.35, 0.55, depth) * smoothstep(0.02, 0.18, depth);
        float swellZone = smoothstep(0.6, 2.2, depth) * (1.0 - smoothstep(4.0, 7.0, depth));
        // Crest tilts the normal back towards the sea (+Z) = catches the light like a wave face.
        n = normalize(n + vec3(0.0, 0.0, 0.35) * crest * (breakZone + swellZone * 0.4) * detail);
        if (uRain > 0.01) {
          vec2 rp = ripples(p, t) * 0.8 * uRain * detail;
          n = normalize(n + vec3(rp.x, 0.0, rp.y));
        }
        float ndv = max(dot(n, V), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        fres = clamp(fres * 1.25 + 0.03, 0.0, 1.0);

        // Water body colour by depth.
        vec3 shallow = vec3(0.26, 0.74, 0.68);
        vec3 mid = vec3(0.035, 0.38, 0.5);
        vec3 deep = vec3(0.012, 0.11, 0.26);
        vec3 col = mix(shallow, mid, smoothstep(0.05, 0.9, depth));
        col = mix(col, deep, smoothstep(0.9, 3.6, depth));
        float cloud = hvCloudShadow(p, t, uCloudShadow);
        float diff = 0.6 + 0.4 * max(dot(n, L), 0.0);
        vec3 lit = col * (uSunColor * diff * 0.75 * cloud + uSkyColor * 0.5 + uHorizonColor * 0.12);
        // Sub-surface glow in thin crests, back-lit by the sun.
        float sss = pow(max(dot(-V, L) * 0.5 + 0.5, 0.0), 3.0) * crest * (breakZone + swellZone * 0.5);
        lit += vec3(0.1, 0.55, 0.5) * uSunColor * sss * 0.9;
        // Shallow caustic shimmer on the surface.
        float caus = pow(hvNoise(p * 2.6 + vec2(t * 0.35, t * 0.2)) * hvNoise(p * 3.1 - vec2(t * 0.28, t * 0.17)), 1.4);
        lit += vec3(0.55, 0.85, 0.75) * caus * 0.35 * (1.0 - smoothstep(0.0, 0.7, depth)) * cloud;

        // Reflection: sky gradient + the low sun's glow path.
        vec3 R = reflect(-V, n);
        vec3 sky = mix(uHorizonColor, uSkyColor, smoothstep(0.0, 0.55, R.y));
        float sunR = max(dot(R, L), 0.0);
        sky += uSunColor * (pow(sunR, 18.0) * 0.55 + pow(sunR, 4.0) * 0.12) * (1.0 - uNight * 0.5);
        vec3 c = mix(lit, sky, fres);

        // Glints: pinpoint > 1.0 for the bloom, denser under a low sun.
        float lowSun = 1.0 - smoothstep(0.1, 0.55, L.y);
        float sparkle = hvNoise(p * 9.0 + vec2(t * 1.3, -t * 0.9)) * hvNoise(p * 13.0 - vec2(t * 0.8, t * 1.1));
        float spec = pow(sunR, 700.0) * 26.0 + pow(sunR, 90.0) * 1.2;
        spec += smoothstep(0.32, 0.5, sparkle) * pow(sunR, 24.0 - lowSun * 14.0) * (3.5 + lowSun * 8.0) * detail;
        c += uSunColor * spec * cloud * (1.0 - uNight * 0.55);

        // Foam: breaker bands, the swash front, lace in the shallows.
        float lace = hvLace(p * 1.7, t);
        float lace2 = hvLace(p * 3.3 + 7.0, t * 1.3);
        float band = crest * breakZone * (0.55 + 0.45 * lace) * smoothstep(0.25, 0.6, hvNoise(p * 0.7 + t * 0.1) + crest * 0.3);
        float front = smoothstep(0.07, 0.0, depth) * (0.65 + 0.35 * lace2);
        float wash = smoothstep(0.35, 0.05, depth) * lace * 0.75 * smoothstep(0.35, 0.8, fract(ph) );
        float foam = clamp(band * 0.95 + front + wash, 0.0, 1.0) * detail;
        // Spindrift on the far swell (white horses when it's windy).
        foam += smoothstep(0.93, 1.0, wv) * swellZone * smoothstep(0.6, 0.8, hvNoise(p * 0.5 + t * 0.05)) * 0.35 * (uWindStrength - 0.5) * detail;
        vec3 foamCol = vec3(0.96, 0.98, 0.97) * (uSunColor * 0.62 * cloud + uSkyColor * 0.55 + uHorizonColor * 0.1);
        c = mix(c, foamCol, clamp(foam, 0.0, 1.0));

        // Horizon: dissolve into the sky's horizon colour (+ the sun's haze).
        float haze = smoothstep(55.0, 250.0, dist);
        vec3 hz = uHorizonColor + uSunColor * pow(max(dot(-V, L) * 0.5 + 0.5, 0.0), 12.0) * 0.35;
        c = mix(c, hz, haze * 0.92);

        float alpha = mix(0.42, 0.94, smoothstep(0.0, 1.1, depth));
        alpha = max(alpha, fres * 0.9);
        alpha = max(alpha, foam);
        alpha *= smoothstep(0.0, 0.035, depth) * 0.85 + 0.15 * step(0.004, depth);
        alpha = mix(alpha, 1.0, haze);
        gl_FragColor = vec4(c, alpha);
      }`,
  });
  mat.name = far ? 'oceanFar' : 'ocean';
  return mat;
}

/** Near (swash-displaced) + far (horizon) ocean meshes. */
export function createOcean(opts: OceanOptions): THREE.Group {
  const { terrain, level, near } = opts;
  const step = opts.step ?? 0.5;
  const g = new THREE.Group();
  g.name = 'ocean';
  g.userData.perfTag = 'water';
  g.userData.noAO = true;
  const w = near.x1 - near.x0;
  const d = near.z1 - near.z0;
  const geo = new THREE.PlaneGeometry(w, d, Math.ceil(w / step), Math.ceil(d / step));
  geo.rotateX(-Math.PI / 2);
  geo.translate(near.x0 + w / 2, level, near.z0 + d / 2);
  const nearMesh = new THREE.Mesh(geo, oceanMaterial(terrain, level, false));
  nearMesh.name = 'ocean-near';
  nearMesh.renderOrder = 2;
  nearMesh.frustumCulled = false;
  nearMesh.userData.noAO = true;
  g.add(nearMesh);
  // Far: three flat pieces around the near grid out to the horizon.
  const farMat = oceanMaterial(terrain, level, true);
  const R = 420;
  const pieces: [number, number, number, number][] = [
    [-R, near.z1, R + 100, R + 100], // south, beyond the near grid
    [-R, near.z0 - 60, near.x0, near.z1], // west strip
    [near.x1, near.z0 - 60, R + 100, near.z1], // east strip
  ];
  for (const [x0, z0, x1, z1] of pieces) {
    const pw = x1 - x0;
    const pd = z1 - z0;
    const pg = new THREE.PlaneGeometry(pw, pd, 24, 24);
    pg.rotateX(-Math.PI / 2);
    pg.translate(x0 + pw / 2, level - 0.02, z0 + pd / 2);
    const m = new THREE.Mesh(pg, farMat);
    m.name = 'ocean-far';
    m.renderOrder = 2;
    m.frustumCulled = false;
    m.userData.noAO = true;
    g.add(m);
  }
  return g;
}

/**
 * Streaky clouds low on the sky (a camera-centred band drawn at the far plane): sun-lit rims and
 * warm bellies near the sun, cool lavender shadows away from it; thin at noon, glorious at dusk.
 */
export function createHorizonClouds(): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(250, 250, 150, 64, 1, true);
  geo.translate(0, 55, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
    uniforms: {
      uTime: globalUniforms.uTime,
      uSunDir: globalUniforms.uSunDir,
      uSunColor: globalUniforms.uSunColor,
      uSkyColor: globalUniforms.uSkyColor,
      uHorizonColor: globalUniforms.uHorizonColor,
      uNight: globalUniforms.uNight,
      uCloudShadow: globalUniforms.uCloudShadow,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        vec4 p = projectionMatrix * viewMatrix * wp;
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyColor;
      uniform vec3 uHorizonColor;
      uniform float uNight;
      uniform float uCloudShadow;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float el = d.y;
        float az = atan(d.z, d.x);
        vec2 q = vec2(az * 9.0 + uTime * 0.004, el * 42.0);
        // Long stratus streaks + a few puffy heads.
        float streak = hvFbm(vec2(q.x * 0.55, q.y * 1.6)) ;
        float puff = hvFbm(vec2(q.x * 1.4, q.y * 1.1) + 11.0);
        float band = smoothstep(0.0, 0.03, el) * (1.0 - smoothstep(0.12, 0.34, el));
        float dens = smoothstep(0.5, 0.78, streak * 0.7 + puff * 0.45 + (0.18 - el) * 0.9) * band;
        dens *= 0.55 + 0.45 * smoothstep(0.3, 0.7, hvNoise(vec2(az * 2.0, 3.0)));
        if (dens < 0.01) discard;
        vec3 L = normalize(uSunDir);
        float toward = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(L.x, 0.0, L.z))), 0.0), 2.0);
        float lowSun = 1.0 - smoothstep(0.05, 0.5, L.y);
        vec3 lit = mix(uHorizonColor * 1.05, uSkyColor * 0.55 + uHorizonColor * 0.55, 0.35);
        vec3 warm = uSunColor * (0.9 + 1.4 * toward * lowSun);
        // Underside shading: darker bellies, bright rims (thin edges catch the light).
        float rim = smoothstep(0.35, 0.0, dens) * (0.5 + toward);
        vec3 belly = mix(uSkyColor * 0.55, vec3(0.42, 0.34, 0.5) * (uSunColor + 0.3), lowSun * 0.7);
        vec3 c = mix(belly, lit + warm * 0.5, 0.45 + 0.35 * toward);
        c += warm * rim * 0.6;
        c *= 1.0 - uNight * 0.75;
        float a = dens * (0.55 + 0.35 * lowSun) * (1.0 - uNight * 0.4);
        gl_FragColor = vec4(c, a);
      }`,
  });
  mat.name = 'horizonClouds';
  const m = new THREE.Mesh(geo, mat);
  m.name = 'horizon-clouds';
  m.frustumCulled = false;
  m.renderOrder = -999;
  m.userData.noAO = true;
  return m;
}
