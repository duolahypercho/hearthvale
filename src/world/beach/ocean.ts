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

/** Deepest sea floor (matches the height clamp in layout.ts); used where there's no terrain. */
const FLOOR_MIN = -4.2;

let blank: THREE.DataTexture | null = null;
function blankPileTex(): THREE.DataTexture {
  if (!blank) {
    blank = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
    blank.needsUpdate = true;
  }
  return blank;
}

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
// Foam lace: heavily domain-warped, soft-edged threads, broken into open scraps (never a closed
// cell network / crackled glass).
float hvLace(vec2 p, float t) {
  vec2 w1 = vec2(hvNoise(p * 0.42 + vec2(t * 0.16, 1.7)), hvNoise(p * 0.42 + vec2(5.3, -t * 0.13))) - 0.5;
  vec2 w2 = vec2(hvNoise(p * 1.35 + vec2(-t * 0.22, 8.1)), hvNoise(p * 1.35 + vec2(2.9, t * 0.19))) - 0.5;
  vec2 v = hvVor(p + w1 * 2.5 + w2 * 0.8);
  float e = v.y - v.x;
  // Soft (gaussian, smooth-min style) edge instead of a hard F2 - F1 cut.
  float edge = exp(-e * e * 110.0);
  // Only some segments survive: open, drifting threads + a few bunched clots of foam.
  float threads = smoothstep(0.45, 0.72, hvNoise(p * 1.7 + w1 * 3.0 + vec2(t * 0.05, 0.0)));
  float clot = smoothstep(0.6, 0.9, hvNoise(p * 0.8 - vec2(t * 0.04, 3.0)));
  return edge * max(threads, clot * 0.7);
}
// Caustics: thin, bright, wobbly filaments (two warped layers; brightest where they cross).
float hvCaustic(vec2 p, float t) {
  vec2 w = vec2(hvNoise(p * 0.5 + vec2(t * 0.13, 0.0)), hvNoise(p * 0.5 + vec2(3.0, -t * 0.11))) - 0.5;
  vec2 w2 = vec2(hvNoise(p * 1.9 + vec2(0.0, t * 0.3)), hvNoise(p * 1.9 + vec2(-t * 0.27, 6.0))) - 0.5;
  vec2 q = p + w * 2.2 + w2 * 0.45;
  vec2 a = hvVor(q + vec2(t * 0.09, t * 0.05));
  vec2 b = hvVor(q * 1.41 - vec2(t * 0.07, -t * 0.1) + 4.0);
  float ea = a.y - a.x;
  float eb = b.y - b.x;
  float la = exp(-ea * ea * 260.0);
  float lb = exp(-eb * eb * 320.0);
  // Break the filaments so no closed cells read.
  float brk = smoothstep(0.3, 0.62, hvNoise(q * 1.3 + vec2(t * 0.06, 1.0)));
  return (la * 0.45 + lb * 0.3) * brk + la * lb * 1.6;
}
`;

export { VORONOI_GLSL };

export interface OceanOptions {
  terrain: Terrain;
  level: number;
  near: { x0: number; z0: number; x1: number; z1: number };
  step?: number;
}

function oceanMaterial(terrain: Terrain, level: number, far: boolean, pool = false): THREE.ShaderMaterial {
  const o = terrain.opts;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    // Writes depth so the post passes (height fog, tilt-shift) see the water surface, not the sea
    // floor under it (otherwise misty weather pools as a milky fog bank over the whole sea).
    depthWrite: true,
    fog: false,
    uniforms: {
      uHeight: { value: terrain.heightTex },
      uHOrigin: { value: new THREE.Vector2(o.minX, o.minZ) },
      uHSize: { value: new THREE.Vector2(o.maxX - o.minX, o.maxZ - o.minZ) },
      uLevel: { value: level },
      uFar: { value: far ? 1 : 0 },
      uPool: { value: pool ? 1 : 0 },
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
      uNear: { value: new THREE.Vector4(0, 0, 1, 1) },
      uPileTex: { value: blankPileTex() },
      uPileRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uLampPos: { value: [new THREE.Vector3(1e5, 0, 1e5), new THREE.Vector3(1e5, 0, 1e5), new THREE.Vector3(1e5, 0, 1e5), new THREE.Vector3(1e5, 0, 1e5)] },
      uLamps: globalUniforms.uLamps,
    },
    vertexShader: /* glsl */ `
      uniform sampler2D uHeight;
      uniform vec2 uHOrigin;
      uniform vec2 uHSize;
      uniform float uLevel;
      uniform float uFar;
      uniform float uPool;
      uniform float uTime;
      uniform vec4 uNear;
      varying vec3 vW;
      varying float vLift;
      ${NOISE_GLSL}
      ${SWASH_GLSL}
      float groundAt(vec2 xz) {
        vec2 huv = (xz - uHOrigin) / uHSize;
        if (uFar > 0.5 || huv.x < 0.0 || huv.y < 0.0 || huv.x > 1.0 || huv.y > 1.0) return ${FLOOR_MIN.toFixed(2)};
        return texture2D(uHeight, huv).r;
      }
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float ground = groundAt(wp.xz);
        float d0 = uLevel - ground;
        float lift = 0.0;
        if (uFar < 0.5 && uPool < 0.5) {
          lift = hvSwash(wp.xz, uTime) * smoothstep(1.4, 0.0, d0);
          // Open-water swell (fades out in the shallows so the waterline stays put).
          float sw = sin(dot(wp.xz, vec2(0.05, 0.42)) - uTime * 0.9) * 0.045 + sin(dot(wp.xz, vec2(-0.28, 0.31)) - uTime * 1.4) * 0.02;
          float rim = min(min(wp.x - uNear.x, uNear.z - wp.x), min(wp.z - uNear.y, uNear.w - wp.z));
          lift += sw * smoothstep(0.4, 2.5, d0) * smoothstep(0.5, 6.0, rim);
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
      uniform float uPool;
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyColor;
      uniform vec3 uHorizonColor;
      uniform float uNight;
      uniform float uWindStrength;
      uniform float uCloudShadow;
      uniform float uRain;
      uniform sampler2D uPileTex;
      uniform vec4 uPileRect;
      uniform vec3 uLampPos[4];
      uniform float uLamps;
      varying vec3 vW;
      varying float vLift;
      ${NOISE_GLSL}
      ${SWASH_GLSL}
      ${VORONOI_GLSL}
      float groundAt(vec2 xz) {
        vec2 huv = (xz - uHOrigin) / uHSize;
        if (uFar > 0.5 || huv.x < 0.0 || huv.y < 0.0 || huv.x > 1.0 || huv.y > 1.0) return ${FLOOR_MIN.toFixed(2)};
        return texture2D(uHeight, huv).r;
      }
      // Directional wave height field (wind from the south-west, towards shore = -Z).
      // lod3 / lod4: weights of the two fine octaves (1 near; they fade out far away, where they
      // are sub-pixel shimmer under the haze, and are skipped entirely once 0 — perf pillar 14).
      float wh(vec2 q, float t, float lod3, float lod4) {
        vec2 a = vec2(q.x * 0.8 + q.y * 0.35, q.y);
        float h = hvNoise(a * 0.55 + vec2(0.0, t * 0.32)) * 0.5
                + hvNoise(a * 1.4 + vec2(t * 0.11, t * 0.5)) * 0.28;
        if (lod3 > 0.0) h += hvNoise(q * 3.3 + vec2(-t * 0.35, t * 0.6)) * 0.14 * lod3;
        if (lod4 > 0.0) h += hvNoise(q * 7.9 + vec2(t * 0.7, -t * 0.4)) * 0.08 * lod4;
        return h;
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
        // Below the ground the sheet is made fully transparent at the end of main(), not discarded:
        // it writes depth, and discard + depth write turns early-Z off, so every sea fragment hidden
        // under the sand / rock shelf / pier ran this whole shader (the beach frames' GPU cost, perf
        // r3). Only the few below-ground fragments that pass the depth test still shade (no early
        // return either: it would break the fwidth() quads at the waterline).
        vec3 toCam = cameraPosition - vW;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec3 L = normalize(uSunDir);

        // Normals: detail fades with distance (no shimmer at the horizon).
        float detail = 1.0 - smoothstep(40.0, 160.0, dist);
        float e = 0.08;
        float amp = (0.22 + 0.1 * uWindStrength) * mix(0.35, 1.0, detail) * smoothstep(0.0, 0.25, depth);
        // Wind slicks: long glassy streaks down-wind where the ripples lie flat (they mirror the sky,
        // so open water reads as more than one flat blue).
        // Soft-edged, and faded out at grazing angles: there the Fresnel jump between glassy and rippled
        // water turns a slick's edge into a hard pale sheet.
        float slickN = hvNoise(vec2(p.x * 0.035 + p.y * 0.012, p.y * 0.22 - p.x * 0.05) + vec2(t * 0.006, t * 0.02));
        float slick = smoothstep(0.46, 0.84, slickN);
        slick *= smoothstep(1.2, 2.5, depth) * (1.0 - uPool) * smoothstep(0.3, 0.65, V.y);
        amp *= 1.0 - 0.7 * slick;
        // Same 2e-wide difference as a central one, taken forward from p (3 taps, not 4, and the
        // whitecaps below reuse h0): the normal is the one 8 cm up-wave, identical to the eye.
        float lod3 = 1.0 - smoothstep(110.0, 220.0, dist);
        float lod4 = 1.0 - smoothstep(60.0, 150.0, dist);
        float h0 = wh(p, t, lod3, lod4);
        float hx = wh(p + vec2(2.0 * e, 0.0), t, lod3, lod4) - h0;
        float hz = wh(p + vec2(0.0, 2.0 * e), t, lod3, lod4) - h0;
        vec3 n = normalize(vec3(-hx / (2.0 * e) * amp, 1.0, -hz / (2.0 * e) * amp));

        // Breakers: crest lines travelling shoreward (towards shallower water), two or three at a time
        // over the shelf. wv: 0.9 → 1 = the steepening face (shore side), 0 → 0.35 = the foam it leaves.
        float ph = hvSwashPhase(p, t);
        float wvRaw = ph + depth * 1.15 + hvNoise(p * 0.08) * 0.3;
        float wv = fract(wvRaw);
        // Phase gradient per metre: where the bed is flat the phase barely changes across the water,
        // and a crest would light a whole lobed sheet at once (a white flash) instead of a moving line.
        // There the crest fades out and its lip is held to a fixed width in metres.
        float wGrad = fwidth(wvRaw) / max(fwidth(p.x) + fwidth(p.y), 1e-4) * 1.4;
        float crestOk = smoothstep(0.025, 0.07, wGrad);
        // Signed distance to the break point (wv = 1 ≡ 0), in (-0.5, 0.5]: < 0 the face coming in,
        // > 0 the water it leaves. Every term below is continuous across the wrap (no hard sheet edge).
        float wd = wv > 0.5 ? wv - 1.0 : wv;
        // The leading edge wanders along the crest (scrolling noise), so no crest reads as a ruled line.
        wd += (hvNoise(vec2(p.x * 0.45 + t * 0.07, p.y * 0.3)) - 0.5) * 0.05;
        float face = smoothstep(-0.12, -0.015, wd) * (1.0 - smoothstep(-0.015, 0.015, wd)) * crestOk;
        float trail = smoothstep(-0.01, 0.03, wd) * (1.0 - smoothstep(0.03, 0.26, wd)) * mix(0.35, 1.0, crestOk);
        float wdm = wd / max(wGrad, 1e-3); // metres to the break point
        float crest = face + trail * 0.6;
        float breakZone = smoothstep(1.7, 0.95, depth) * smoothstep(0.03, 0.22, depth) * (1.0 - uPool);
        float swellZone = smoothstep(0.9, 2.2, depth) * (1.0 - smoothstep(4.0, 7.0, depth)) * (1.0 - uPool);
        // Crest tilts the normal back towards the sea (+Z) = catches the light like a wave face.
        // (Out on the swell only a gentle tilt: a strong one flips the Fresnel and the whole crest
        // reads as a pale cellophane sheet over the deep water.)
        n = normalize(n + vec3(0.0, 0.0, 0.45) * face * (breakZone + swellZone * 0.22) * detail);
        if (uRain > 0.01) {
          vec2 rp = ripples(p, t) * 0.8 * uRain * detail;
          n = normalize(n + vec3(rp.x, 0.0, rp.y));
        }
        float ndv = max(dot(n, V), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        fres = clamp(fres * 1.25 + 0.03, 0.0, 1.0) * (1.0 - uPool * 0.55);

        // Water body colour by depth.
        vec3 shallow = vec3(0.3, 0.8, 0.72);
        vec3 mid = vec3(0.03, 0.44, 0.55);
        vec3 deep = vec3(0.012, 0.13, 0.3);
        vec3 col = mix(shallow, mid, smoothstep(0.05, 0.75, depth));
        col = mix(col, deep, smoothstep(0.9, 3.6, depth));
        // Rock pools: shaded, clear green-teal water (the floor and its life should read through it).
        col = mix(col, vec3(0.06, 0.34, 0.33), uPool * (0.35 + 0.45 * smoothstep(0.02, 0.25, depth)));
        // Mid-depth life under the surface: kelp beds (swaying fronds) and dark reef rocks, seen with
        // a little parallax (they sit on the bed, not on the surface). Never in the shallows / far sea.
        {
          float kz = smoothstep(0.9, 1.7, depth) * (1.0 - smoothstep(3.0, 4.1, depth)) * (1.0 - uPool) * (1.0 - uFar) * detail;
          if (kz > 0.001) {
            vec2 pb = p - V.xz / max(V.y, 0.35) * depth * 0.55;
            vec2 kq = pb * vec2(0.2, 0.32) + vec2(hvNoise(pb * 0.09) * 2.2, hvNoise(pb * 0.07 + 3.0) * 1.4);
            float bed = smoothstep(0.56, 0.7, hvNoise(kq) * 0.75 + hvNoise(pb * 0.6) * 0.25);
            float frond = smoothstep(0.5, 0.78, hvNoise(vec2(pb.x * 1.9 + sin(t * 0.6 + pb.y * 0.45) * 0.4, pb.y * 0.42)));
            float kelp = kz * bed * (0.55 + 0.45 * frond);
            float reef = kz * smoothstep(0.66, 0.76, hvNoise(pb * 0.16 + 9.0)) * (0.7 + 0.3 * hvNoise(pb * 1.3));
            col = mix(col, col * vec3(0.32, 0.5, 0.36), kelp * 0.7);
            col = mix(col, col * vec3(0.42, 0.44, 0.5), reef * 0.55);
          }
        }
        // Night: a deep, desaturated ink-blue (hsl ~225°, 45 %, 18 %), not a saturated royal blue.
        col = mix(col, mix(vec3(0.1, 0.13, 0.26), vec3(0.08, 0.2, 0.24), 1.0 - smoothstep(0.3, 1.4, depth)) * 0.9, uNight * 0.85);
        float cloud = hvCloudShadow(p, t, uCloudShadow);
        float diff = 0.6 + 0.4 * max(dot(n, L), 0.0);
        vec3 light = uSunColor * diff * 0.75 * cloud + uSkyColor * 0.5 + uHorizonColor * 0.12;
        // Golden hour: the whole sea takes the evening's colour, not just its reflections. The body
        // colour loses half its cyan saturation, and it is lit by the warm sun + horizon instead of the
        // (still blue) zenith, so the water under the camera never stays a daytime turquoise.
        float goldH = (1.0 - smoothstep(0.12, 0.5, L.y)) * (1.0 - uNight);
        col = mix(col, vec3(dot(col, vec3(0.3, 0.55, 0.15))), goldH * 0.5);
        light = mix(light, uSunColor * (0.55 + 0.35 * diff) * cloud + uHorizonColor * 0.45, goldH * 0.6);
        // At night the moon / sky light is a saturated blue: multiplied into the ink-blue body it
        // tints the sea a flat royal blue. Keep its brightness, drop most of its hue.
        light = mix(light, vec3(dot(light, vec3(0.3, 0.55, 0.15))) * vec3(0.86, 0.93, 1.06), uNight * 0.8);
        vec3 lit = col * light;
        // Sub-surface glow in thin crests, back-lit by the sun.
        float sss = pow(max(dot(-V, L) * 0.5 + 0.5, 0.0), 3.0) * crest * (breakZone + swellZone * 0.3);
        lit += vec3(0.1, 0.55, 0.5) * uSunColor * sss * 0.9;
        // Shallow caustic shimmer on the surface.
        if (depth < 0.7 && uNight < 0.999) {
          float caus = pow(hvNoise(p * 2.6 + vec2(t * 0.35, t * 0.2)) * hvNoise(p * 3.1 - vec2(t * 0.28, t * 0.17)), 1.4);
          lit += vec3(0.55, 0.85, 0.75) * caus * 0.35 * (1.0 - smoothstep(0.0, 0.7, depth)) * cloud * (1.0 - uNight);
        }

        // Reflection: sky gradient + the low sun's glow path.
        vec3 R = reflect(-V, n);
        vec3 sky = mix(uHorizonColor, uSkyColor, smoothstep(0.0, 0.55, R.y));
        // Night sky in the water: desaturated, and modulated by the waves (keeps the swell readable).
        float skyL = dot(sky, vec3(0.3, 0.55, 0.15));
        sky = mix(sky, vec3(skyL) * vec3(0.8, 0.9, 1.15) * (0.6 + 0.4 * diff), uNight * 0.85);
        float sunR = max(dot(R, L), 0.0);
        // The sun's reflection breaks up into the wave facets (no smooth white blob on calm water).
        // (pow(sunR, 90) < 1e-4 off the sun's path: the facet noise is only paid for on it.)
        if (sunR > 0.9) {
          float facet = smoothstep(0.35, 0.75, hvNoise(p * 3.1 + vec2(t * 0.6, -t * 0.4)) * 0.6 + hvNoise(p * 7.3 - vec2(t * 0.5, 0.0)) * 0.4);
          sky += uSunColor * pow(sunR, 90.0) * 0.3 * facet * (1.0 - uNight * 0.5);
        }
        // At golden hour even the steep near water mirrors 25-35 % of the warm sky.
        vec3 c = mix(lit, sky, max(fres, goldH * 0.3 * (1.0 - uPool * 0.5)));

        // Glints: pinpoint > 1.0 for the bloom, denser under a low sun.
        float lowSun = 1.0 - smoothstep(0.1, 0.55, L.y);
        // Thousands of pinpoint glints (hashed cells that twinkle on and off), not one glowing fog.
        vec2 gq = p * 11.0 + n.xz * 6.0;
        vec2 gc = floor(gq);
        float gh = hvHash12(gc);
        float tw = fract(gh * 7.3 + t * (0.8 + gh * 1.6));
        float twinkle = smoothstep(0.5, 0.0, abs(tw - 0.5) * 2.0 - 0.6) * smoothstep(0.28, 0.08, length(fract(gq) - 0.5 - (hvHash22(gc) - 0.5) * 0.5)) * step(gh, 0.55);
        // Sparkle only matters on the sun's glitter path (pow(sunR, 34) < 5e-4 off it) or at night (moon).
        float sparkle = 0.0;
        if (sunR > 0.8 || uNight > 0.01) sparkle = hvNoise(p * 9.0 + vec2(t * 1.3, -t * 0.9)) * hvNoise(p * 13.0 - vec2(t * 0.8, t * 1.1));
        float spec = pow(sunR, 900.0) * 14.0 + pow(sunR, 140.0) * 0.8;
        spec += (twinkle * 0.8 + smoothstep(0.4, 0.56, sparkle) * 0.35) * (pow(sunR, 70.0) * (2.4 + lowSun * 2.0) + pow(sunR, 34.0) * 0.18) * detail;
        // Clamp before bloom: the path glitters, it never blows out into a smear.
        spec = min(spec, 2.5);
        c += uSunColor * spec * cloud * (1.0 - uNight);
        // Moon glitter path at night (the same twinkles, cool and dim).
        if (uNight > 0.01) {
          // The moon hangs low ahead of the camera (a little right of centre), so every night framing
          // gets its silver glitter road running up the sea towards the horizon.
          vec3 camF = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
          vec2 cf = normalize(camF.xz + vec2(1e-4, 0.0));
          vec2 mf = vec2(cf.x * 0.93 - cf.y * 0.36, cf.x * 0.36 + cf.y * 0.93);
          vec3 M = normalize(vec3(mf.x, 0.3, mf.y));
          float mR = max(dot(R, M), 0.0);
          float moonR = pow(mR, 60.0);
          float road = pow(mR, 22.0);
          c += vec3(0.72, 0.82, 1.0) * min((twinkle * 1.6 + smoothstep(0.44, 0.58, sparkle) * 0.6) * moonR * 2.2 + road * 0.045 + pow(mR, 500.0) * 1.6, 1.5) * uNight * detail;
        }

        // Foam: breaker bands, the swash front, lace in the shallows (only in drifting patches).
        float lacePatch = smoothstep(0.42, 0.74, hvNoise(p * 0.11 + vec2(t * 0.012, -t * 0.008)));
        // Gaps along each crest so the lines break up like real surf.
        float gaps = smoothstep(0.28, 0.62, hvNoise(vec2(p.x * 0.22, p.y * 0.05) + vec2(t * 0.03, 0.0)) + face * 0.2);
        // The lace (warped voronoi, the priciest term) is only evaluated where a term below uses it:
        // breaker trails in the surf zone, the backwash in the shallows, the swash front. Out on the
        // open / far sea and in the rock pools it is exactly 0 (perf pillar 14).
        float lace = 0.0;
        float lace2 = 0.0;
        if (detail > 0.0) {
          bool trailLace = trail * breakZone * gaps > 0.0;
          bool washLace = depth < 0.35 && lacePatch > 0.0 && uPool < 0.5 && fract(ph) > 0.35;
          if (trailLace || washLace) lace = hvLace(p * 0.9, t);
          if (depth < 0.09 && uPool < 0.5) lace2 = hvLace(p * 1.8 + 7.0, t * 1.3);
        }
        // The lip: a bright, broken line only on the crest's leading edge; behind it lace, never a milky sheet.
        float lip = smoothstep(-0.05, -0.012, wd) * (1.0 - smoothstep(-0.012, 0.012, wd));
        lip = min(lip, smoothstep(-0.7, -0.18, wdm) * (1.0 - smoothstep(-0.18, 0.18, wdm))) * crestOk;
        float band = (lip * 0.95 + face * 0.25) * breakZone * gaps + min(trail * lace * breakZone * gaps * (0.3 + 0.7 * lacePatch), 0.32);
        // Swash front: a thin bright edge, then lace behind it (on the flat, gently shelving parts of
        // the beach a wide solid band would read as a white ribbon).
        float front = smoothstep(0.035, 0.0, depth) * (0.72 + 0.28 * lace2) + smoothstep(0.09, 0.035, depth) * smoothstep(0.0, 0.035, depth) * lace2 * 0.55;
        float nearFront = smoothstep(0.28, 0.05, depth);
        float wash = smoothstep(0.35, 0.04, depth) * lace * smoothstep(0.35, 0.8, fract(ph)) * lacePatch * (1.0 - uPool);
        // Rock pools: a thin, still meniscus at the rim instead of surf.
        front *= 1.0 - uPool;
        float meniscus = uPool * smoothstep(0.035, 0.008, depth) * smoothstep(0.0, 0.004, depth);
        wash = min(wash, mix(0.35, 0.75, nearFront));
        float foam = clamp(band + front + wash, 0.0, 1.0) * detail;
        // Foam collars where the pier pilings stand in the water: a clinging ring + small rings that
        // spread out on each swell.
        {
          vec2 pu = (p - uPileRect.xy) / uPileRect.zw;
          if (pu.x > 0.0 && pu.y > 0.0 && pu.x < 1.0 && pu.y < 1.0) {
            float pd = texture2D(uPileTex, pu).r;
            // Collar: ragged and pushed downstream by the swell; one faint wake ring now and then.
            float wob = hvNoise(p * 9.0 + vec2(t * 0.9, -t * 0.4));
            float collar = smoothstep(0.1 + 0.08 * wob, 0.0, pd) * smoothstep(0.25, 0.6, wob + 0.2);
            float ringPh = fract(t * 0.3 + hvHash12(floor(p * 0.8)) * 3.0);
            float spread = smoothstep(0.03, 0.0, abs(pd - 0.05 - ringPh * 0.45)) * (1.0 - ringPh) * smoothstep(0.35, 0.7, wob) * 0.4;
            foam = max(foam, (collar * 0.8 + spread) * smoothstep(0.02, 0.25, depth) * detail);
          }
        }
        // Whitecaps on open water: sparse, varied crescents that sit on wave crests and roll shoreward.
        // Calm days show almost none; they fade out towards the (tilt-shift blurred) distance.
        if (dist < 38.0 && depth > 1.8) {
          float crestK = smoothstep(0.5, 0.7, h0);
          vec2 q = p * vec2(0.34, 0.5) + vec2(t * 0.015, t * 0.1);
          float ticks = 0.0;
          for (int k = 0; k < 2; k++) {
            vec2 qq = q + float(k) * vec2(0.5, 0.37);
            vec2 id = floor(qq);
            float h = hvHash12(id + 4.7 + float(k) * 3.1);
            if (h > 0.05 + 0.15 * uWindStrength) continue;
            vec2 rnd = hvHash22(id + 11.0);
            float sc = mix(0.5, 1.6, hvHash12(id + 2.3));
            vec2 f = (fract(qq) - 0.5 - (rnd - 0.5) * 0.4) / sc;
            float life = fract(t * 0.16 + h * 7.0);
            float vis = smoothstep(0.0, 0.25, life) * (1.0 - smoothstep(0.55, 1.0, life));
            float r = length(f * vec2(1.0, 2.2));
            float arcLen = mix(0.07, 0.2, hvHash12(id + 5.9));
            float along = clamp(f.x / arcLen, -1.0, 1.0);
            float brk = smoothstep(0.25, 0.55, hvNoise(vec2(f.x * 16.0 + h * 40.0, t * 0.6 + h * 9.0)));
            float arc = smoothstep(0.035, 0.008, abs(r - 0.15 - life * 0.03)) * step(f.y, 0.0) * (1.0 - along * along) * brk;
            ticks = max(ticks, arc * vis);
          }
          foam += ticks * crestK * smoothstep(1.8, 3.2, depth) * (0.45 + 0.35 * uWindStrength) * (1.0 - smoothstep(20.0, 38.0, dist));
        }
        // Spindrift on the far swell (white horses when it's windy).
        if (face * swellZone * detail > 0.0 && uWindStrength > 0.5)
          foam += face * swellZone * smoothstep(0.6, 0.8, hvNoise(p * 0.5 + t * 0.05)) * 0.35 * (uWindStrength - 0.5) * detail;
        // Wind-slick edges: faint foam streaks drawn out down-wind along the glassy lanes.
        if (dist < 45.0 && depth > 1.2 && uPool < 0.5) {
          float sn = slickN;
          float edgeS = smoothstep(0.47, 0.52, sn) * (1.0 - smoothstep(0.54, 0.6, sn));
          float streak = smoothstep(0.45, 0.8, hvNoise(vec2(p.x * 1.6, p.y * 0.25) + vec2(0.0, t * 0.05)));
          foam += edgeS * streak * 0.32 * smoothstep(1.2, 2.5, depth) * (1.0 - uPool) * detail * (1.0 - smoothstep(25.0, 45.0, dist));
        }
        vec3 foamCol = vec3(0.96, 0.98, 0.97) * (uSunColor * 0.62 * cloud + uSkyColor * 0.55 + uHorizonColor * 0.1);
        foamCol = mix(foamCol, vec3(dot(foamCol, vec3(0.3, 0.55, 0.15))) * vec3(0.8, 0.88, 1.0) * 0.7, uNight * 0.8);
        c = mix(c, foamCol, clamp(foam, 0.0, 1.0));
        // Night: faint bioluminescence in the surf (the swash front, the breaking lip, stirred lace),
        // so the shoreline still reads as a line of cold light against the moonlit sand.
        if (uNight > 0.01) {
          float stir = 0.45 + 0.55 * smoothstep(0.3, 0.75, hvNoise(p * 1.4 + vec2(t * 0.25, -t * 0.18)));
          float bio = (front * 0.9 + band * 0.6 + wash * 0.5) * stir * (1.0 - uPool);
          c += vec3(0.18, 0.8, 1.0) * bio * 0.3 * uNight * detail;
        }
        // Pool meniscus: a bright hairline where the still water meets the rock.
        c = mix(c, mix(sky, vec3(1.0), 0.5) * 1.1, meniscus * 0.75);

        // Lamp light on the water at night: warm, broken up by the ripples, stretched towards the viewer.
        if (uLamps > 0.01) {
          float lg = 0.0;
          for (int i = 0; i < 4; i++) {
            vec3 lp = uLampPos[i];
            vec2 d = p - lp.xz;
            vec2 tv = normalize(cameraPosition.xz - lp.xz + 1e-3);
            float along = dot(d, tv);
            float across = dot(d, vec2(-tv.y, tv.x));
            lg += exp(-(across * across) / 0.5 - max(0.0, along) * max(0.0, along) / 9.0 - min(0.0, along) * min(0.0, along) / 1.2);
          }
          float rip = 0.35 + 0.65 * smoothstep(0.3, 0.7, hvNoise(p * 4.0 + vec2(t * 0.8, -t * 0.5)) * 0.7 + hvNoise(p * 11.0 - vec2(0.0, t)) * 0.3);
          c += vec3(1.0, 0.62, 0.3) * lg * rip * uLamps * 0.9 * (1.0 - uPool);
        }
        // Horizon: dissolve into the sky's horizon colour (+ the sun's haze).
        float haze = smoothstep(55.0, 250.0, dist);
        vec3 hzc = uHorizonColor + uSunColor * pow(max(dot(-V, L) * 0.5 + 0.5, 0.0), 12.0) * 0.16;
        hzc = mix(hzc, vec3(dot(hzc, vec3(0.3, 0.55, 0.15))) * vec3(0.75, 0.88, 1.2), uNight * 0.8);
        c = mix(c, hzc, haze * 0.72);

        float alpha = mix(0.34, 0.95, smoothstep(0.0, 1.4, depth));
        alpha = mix(alpha, (0.3 + 0.3 * smoothstep(0.02, 0.3, depth)) * smoothstep(0.0, 0.09, depth), uPool);
        // At night the shallows turn to a dark sheet (the moonlit sand under them would otherwise
        // read as the same value as the dry beach and the waterline would vanish).
        alpha = mix(alpha, max(alpha, 0.8 * smoothstep(0.0, 0.14, depth)), uNight * (1.0 - uPool));
        alpha = max(alpha, fres * 0.75);
        alpha = max(alpha, foam);
        alpha = max(alpha, meniscus * 0.8);
        alpha *= smoothstep(0.0, 0.035, depth) * 0.85 + 0.15 * step(0.004, depth);
        alpha = mix(alpha, 1.0, haze);
        gl_FragColor = vec4(c, depth < 0.0 ? 0.0 : alpha);
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
  const nearMat = oceanMaterial(terrain, level, false);
  nearMat.uniforms.uNear!.value.set(near.x0, near.z0, near.x1, near.z1);
  const nearMesh = new THREE.Mesh(geo, nearMat);
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
  // AO proxy: one flat quad at sea level that only the AO G-buffer pass sees (colour + depth writes
  // off in the main pass). Without it GTAO sees the deep sea floor under the pier and paints a big
  // dark slab round the pilings; with it the pier gets a soft contact shade on the water instead.
  const proxyGeo = new THREE.PlaneGeometry(1, 1);
  proxyGeo.rotateX(-Math.PI / 2);
  const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  proxyMat.name = 'oceanAOProxy';
  const proxy = new THREE.Mesh(proxyGeo, proxyMat);
  proxy.name = 'ocean-ao-proxy';
  proxy.scale.set(900, 1, 900);
  proxy.position.set((near.x0 + near.x1) / 2, level, (near.z0 + near.z1) / 2);
  proxy.frustumCulled = false;
  proxy.userData.ao = true;
  g.add(proxy);
  return g;
}

/**
 * Still rock-pool water (same look as the shallows: clear, caustic-lit, sky reflections — no swash,
 * surf or whitecaps) over the given rect, clipped to the pools.
 */
export function createPoolWater(
  terrain: Terrain,
  level: number,
  rect: { x0: number; z0: number; x1: number; z1: number },
  inside: (x: number, z: number) => boolean,
  bedAt?: (x: number, z: number) => number,
): THREE.Mesh {
  const w = rect.x1 - rect.x0;
  const d = rect.z1 - rect.z0;
  const geo = new THREE.PlaneGeometry(w, d, Math.ceil(w / 0.25), Math.ceil(d / 0.25));
  geo.rotateX(-Math.PI / 2);
  geo.translate(rect.x0 + w / 2, level, rect.z0 + d / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const idx = geo.index!;
  const keep: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t);
    const b = idx.getX(t + 1);
    const c = idx.getX(t + 2);
    if (inside(pos.getX(a), pos.getZ(a)) || inside(pos.getX(b), pos.getZ(b)) || inside(pos.getX(c), pos.getZ(c))) keep.push(a, b, c);
  }
  geo.setIndex(keep);
  geo.computeBoundingSphere();
  const mat = oceanMaterial(terrain, level, false, true);
  if (bedAt) {
    // The pools' own bed (the stone bowl) baked at 6 cm: the terrain's 0.5 m height texture would
    // cut the waterline into straight polygon facets round each pool.
    const res = 0.06;
    const W = Math.ceil(w / res);
    const H = Math.ceil(d / res);
    const data = new Uint16Array(W * H);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) data[j * W + i] = THREE.DataUtils.toHalfFloat(bedAt(rect.x0 + ((i + 0.5) / W) * w, rect.z0 + ((j + 0.5) / H) * d));
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    mat.uniforms.uHeight!.value = tex;
    (mat.uniforms.uHOrigin!.value as THREE.Vector2).set(rect.x0, rect.z0);
    (mat.uniforms.uHSize!.value as THREE.Vector2).set(w, d);
  }
  const m = new THREE.Mesh(geo, mat);
  m.name = 'tide-pool-water';
  m.renderOrder = 2;
  m.userData.noAO = true;
  m.userData.perfTag = 'water';
  return m;
}

/** Up to four lamps whose light the sea reflects at night (world positions). */
export function setOceanLamps(ocean: THREE.Group, lamps: THREE.Vector3[]): void {
  const mesh = ocean.getObjectByName('ocean-near') as THREE.Mesh | undefined;
  if (!mesh) return;
  const u = (mesh.material as THREE.ShaderMaterial).uniforms.uLampPos!.value as THREE.Vector3[];
  lamps.slice(0, 4).forEach((l, i) => u[i]!.copy(l));
}

/**
 * Bake a distance-to-nearest-piling mask (metres from the piling surface, 0..1) for the foam
 * collars around the pier's legs. `pts` are piling centres + radii.
 */
export function setOceanPilings(ocean: THREE.Group, pts: { x: number; z: number; r: number }[]): void {
  const mesh = ocean.getObjectByName('ocean-near') as THREE.Mesh | undefined;
  if (!mesh || !pts.length) return;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x - 1.2);
    z0 = Math.min(z0, p.z - 1.2);
    x1 = Math.max(x1, p.x + 1.2);
    z1 = Math.max(z1, p.z + 1.2);
  }
  const res = 0.08;
  const w = Math.ceil((x1 - x0) / res);
  const h = Math.ceil((z1 - z0) / res);
  const data = new Uint8Array(w * h).fill(255);
  for (const p of pts) {
    const r = Math.ceil(1.1 / res);
    const cx = Math.floor((p.x - x0) / res);
    const cz = Math.floor((p.z - z0) / res);
    for (let j = Math.max(0, cz - r); j < Math.min(h, cz + r); j++) {
      for (let i = Math.max(0, cx - r); i < Math.min(w, cx + r); i++) {
        const d = Math.max(0, Math.hypot(x0 + (i + 0.5) * res - p.x, z0 + (j + 0.5) * res - p.z) - p.r);
        const v = Math.min(255, Math.round(d * 255));
        const k = j * w + i;
        if (v < data[k]!) data[k] = v;
      }
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const mat = mesh.material as THREE.ShaderMaterial;
  mat.uniforms.uPileTex!.value = tex;
  mat.uniforms.uPileRect!.value.set(x0, z0, x1 - x0, z1 - z0);
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
