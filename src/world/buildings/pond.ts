/**
 * Paddock water + mud: the duck pond and the pig's wallow (plus the muddy aprons at the trough) as ONE
 * shaded mesh (one draw), instead of flat tinted decals.
 *
 * Every pool is a wobbly-rimmed disc whose vertices carry `aDepth` (0 at the rim → 1 in the middle) and
 * `aKind` (0 water, 1 mud), so the shader fakes a basin without carving the terrain:
 *   water  stylised: jade shallows → deep blue-teal by depth, a soft view-angle sky gradient, sparse
 *          drifting glints, a clean foam line + lapping line at the shore, clean expanding rings + a soft
 *          contact shadow round every duck on it (`pondUniforms.uDucks`), rain rings in wet weather.
 *   mud    dry crusted rim → darker wet ring → a glossy puddle film in the middle (sky + sun glint),
 *          clumpy normal noise, hoof dimples and the odd slow bubble.
 *
 *   const pools = new PondBuilder(heightAt);
 *   pools.water(x, z, rx, rz); pools.mud(x, z, rx, rz);
 *   scene.add(pools.build());
 *   pondUniforms.uDucks.value[i].set(x, z, strength, phase);   // animals system, every frame
 */
import * as THREE from 'three';
import { globalUniforms } from '../../render/uniforms';
import { NOISE_GLSL } from '../../render/shaders/noise';

export const MAX_DUCKS = 4;

/** Ducks on the water (x, z, strength 0..1, phase): ripple rings + contact shadow. */
export const pondUniforms = {
  uDucks: { value: Array.from({ length: MAX_DUCKS }, () => new THREE.Vector4(0, 0, 0, 0)) },
};

const wob = (x: number, z: number): number =>
  0.5 + 0.25 * Math.sin(x * 2.3 + Math.sin(z * 1.7) * 1.6) * Math.sin(z * 2.9 + Math.sin(x * 1.3) * 1.4) + 0.25 * Math.sin(x * 5.1 - z * 4.3 + Math.sin(x * 3.7));

export class PondBuilder {
  private pos: number[] = [];
  private depth: number[] = [];
  private kind: number[] = [];
  private index: number[] = [];

  constructor(private heightAt: (x: number, z: number) => number) {}

  water(cx: number, cz: number, rx: number, rz: number, lift = 0.034): void {
    // (64 rim segments: at 36 the wobbly shore + its foam line showed polygon kinks)
    this.disc(cx, cz, rx, rz, 0, lift, 64, 6);
  }

  mud(cx: number, cz: number, rx: number, rz: number, lift = 0.022): void {
    this.disc(cx, cz, rx, rz, 1, lift, 26, 4);
  }

  /** A wobbly elliptical disc: centre + `rings` rings of `seg` vertices, depth = 1 - r² (rim 0). */
  private disc(cx: number, cz: number, rx: number, rz: number, kind: number, lift: number, seg: number, rings: number): void {
    const base = this.pos.length / 3;
    const y = (x: number, z: number): number => this.heightAt(x, z) + lift;
    this.pos.push(cx, y(cx, cz), cz);
    this.depth.push(1);
    this.kind.push(kind);
    for (let r = 1; r <= rings; r++) {
      const k = r / rings;
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        // (water: a smooth lobed shore — the ragged wobble field read as a gear / spiky outline)
        const w = kind === 0 ? 0.92 + 0.06 * Math.sin(a * 3 + cx) + 0.04 * Math.sin(a * 5 + cz * 2) + 0.025 * Math.sin(a * 2 + 2.1) : 0.82 + 0.22 * wob(cx * 3 + Math.cos(a) * 2.2, cz * 3 + Math.sin(a) * 2.2);
        const x = cx + Math.cos(a) * rx * w * k;
        const z = cz + Math.sin(a) * rz * w * k;
        this.pos.push(x, y(x, z), z);
        this.depth.push(1 - k * k);
        this.kind.push(kind);
      }
    }
    for (let i = 0; i < seg; i++) this.index.push(base, base + 1 + ((i + 1) % seg), base + 1 + i);
    for (let r = 1; r < rings; r++) {
      const a0 = base + 1 + (r - 1) * seg;
      const a1 = base + 1 + r * seg;
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        this.index.push(a0 + i, a0 + j, a1 + i, a0 + j, a1 + j, a1 + i);
      }
    }
  }

  build(): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(this.depth, 1));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kind, 1));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, pondMaterial());
    m.name = 'paddock-pools';
    m.userData.noAO = true;
    m.renderOrder = 2;
    m.castShadow = false;
    m.receiveShadow = false;
    return m;
  }
}

let shared: THREE.ShaderMaterial | null = null;

function pondMaterial(): THREE.ShaderMaterial {
  if (shared) return shared;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute float aDepth;
      attribute float aKind;
      varying vec3 vW;
      varying float vDepth;
      varying float vKind;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vDepth = aDepth;
        vKind = aKind;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyColor;
      uniform vec3 uHorizonColor;
      uniform float uNight;
      uniform float uWindStrength;
      uniform float uCloudShadow;
      uniform float uRain;
      uniform vec4 uDucks[${MAX_DUCKS}];
      varying vec3 vW;
      varying float vDepth;
      varying float vKind;
      ${NOISE_GLSL}
      float wh(vec2 q, float t) {
        return hvNoise(q * 1.6 + vec2(t * 0.25, t * 0.17)) * 0.5
             + hvNoise(q * 3.4 - vec2(t * 0.22, t * 0.33)) * 0.3
             + hvNoise(q * 7.5 + vec2(t * 0.5, -t * 0.4)) * 0.2;
      }
      void main() {
        float t = uTime;
        vec2 p = vW.xz;
        vec3 V = normalize(cameraPosition - vW);
        vec3 L = normalize(uSunDir);
        float cloud = hvCloudShadow(p, t, uCloudShadow);
        vec3 c;
        float alpha;
        if (vKind < 0.5) {
          // ── Water ── (r7: stylised, not physical. A flat depth-tinted base, a soft view-angle sky
          // gradient, clean concentric rings round each duck and a continuous foam line at the shore.
          // No noise-derived normals anywhere: their gradients read as a gear / mosaic pattern on a
          // surface this small.)
          float d = vDepth;
          vec3 shallow = vec3(0.13, 0.27, 0.22);
          vec3 mid = vec3(0.04, 0.16, 0.18);
          vec3 deep = vec3(0.016, 0.075, 0.125);
          vec3 col = mix(shallow, mid, smoothstep(0.05, 0.4, d));
          col = mix(col, deep, smoothstep(0.4, 0.95, d));
          // A broad, slow tonal drift across the basin (cloud of silt), smooth and very low contrast.
          col *= 0.94 + 0.12 * hvNoise(p * 0.9 + vec2(t * 0.03, -t * 0.02));
          // Duck rings + contact shadow
          float rings = 0.0;
          float shade = 0.0;
          for (int i = 0; i < ${MAX_DUCKS}; i++) {
            vec4 dk = uDucks[i];
            if (dk.z <= 0.0) continue;
            vec2 dv = p - dk.xy;
            float r = length(dv * vec2(1.0, 1.12));
            for (int k = 0; k < 3; k++) {
              float ph = fract(t * 0.38 + dk.w * 0.13 + float(k) / 3.0);
              float rr = 0.2 + ph * 0.95;
              float w = 0.016 + ph * 0.02;
              rings += smoothstep(w, 0.0, abs(r - rr)) * pow(1.0 - ph, 1.6) * dk.z;
            }
            shade = max(shade, smoothstep(0.3, 0.06, length(dv * vec2(1.0, 1.35) + vec2(-0.03, -0.05))) * dk.z);
          }
          col *= 1.0 - shade * 0.4;
          vec3 lit = col * (uSunColor * 0.85 * cloud + uSkyColor * 0.6);
          // Sky: a soft gradient by view angle only (horizon colour at grazing angles, zenith above).
          float vy = clamp(V.y, 0.0, 1.0);
          vec3 sky = mix(uHorizonColor, uSkyColor, smoothstep(0.3, 0.95, vy));
          float fres = 0.08 + 0.42 * pow(1.0 - vy, 3.0);
          c = mix(lit, sky * 0.9, fres);
          // Bank shade: the rim's own dark reflection, a smooth band (no noise).
          c *= 1.0 - 0.22 * smoothstep(0.32, 0.1, d) * smoothstep(0.0, 0.08, d);
          // Wind sparkle: sparse soft glints drifting across the open water (sunny days only).
          // (tiny twinkles on a jittered cell grid, each fading in and out on its own clock — big noise
          // blobs read as white paint spills)
          vec2 gq = p * 6.5 + vec2(t * 0.12, t * 0.05);
          vec2 gid = floor(gq);
          vec2 go = fract(gq) - 0.5 - (hvHash22(gid) - 0.5) * 0.6;
          float gph = fract(t * 0.5 + hvHash12(gid + 3.7) * 9.0);
          float glint = smoothstep(0.07, 0.0, length(go * vec2(1.0, 2.2))) * step(hvHash12(gid + 1.3), 0.35) * sin(gph * 3.14159) * smoothstep(0.15, 0.45, d);
          c += (uSunColor * 0.5 + 0.2) * glint * 0.45 * cloud * (1.0 - uNight * 0.8);
          // Rain: tiny expanding rings all over
          if (uRain > 0.01) {
            vec2 rq = p * 3.5;
            vec2 rid = floor(rq);
            vec2 ro = fract(rq) - 0.5 - (hvHash22(rid) - 0.5) * 0.5;
            float rph = fract(t * 1.3 + hvHash12(rid) * 7.0);
            rings += smoothstep(0.03, 0.0, abs(length(ro) - rph * 0.4)) * (1.0 - rph) * uRain * 0.8;
          }
          vec3 ringCol = mix(uSkyColor, vec3(1.0), 0.4) * (uSunColor * 0.25 + 0.55);
          c = mix(c, ringCol, clamp(rings, 0.0, 1.0) * 0.55);
          // Shore: a clean wobbly foam line just inside the rim + a lapping line that creeps in and fades.
          float dd = d + (hvNoise(p * 5.0 + vec2(t * 0.15, -t * 0.1)) - 0.5) * 0.035;
          float shore = smoothstep(0.012, 0.028, dd) * (1.0 - smoothstep(0.065, 0.085, dd));
          float lp = fract(t * 0.22);
          float lapD = 0.09 + lp * 0.12;
          float lap = smoothstep(0.012, 0.0, abs(dd - lapD)) * (1.0 - lp) * 0.7;
          vec3 foamCol = vec3(0.96, 0.98, 0.97) * (uSunColor * 0.45 + uSkyColor * 0.7);
          float foam = clamp(shore * 0.9 + lap, 0.0, 1.0);
          c = mix(c, foamCol, foam);
          alpha = mix(0.86, 0.97, smoothstep(0.0, 0.4, d));
          alpha = max(alpha, foam) * smoothstep(0.0, 0.014, d);
        } else {
          // ── Mud ──
          float d = vDepth;
          float clump = hvNoise(p * 11.0) * 0.6 + hvNoise(p * 27.0) * 0.4;
          // Hoof dimples: small dark cups scattered over the soft middle
          vec2 hq = p * 3.2;
          vec2 hid = floor(hq);
          vec2 ho = hvHash22(hid) - 0.5;
          float hoof = smoothstep(0.17, 0.07, length(fract(hq) - 0.5 - ho * 0.5)) * step(hvHash12(hid + 2.3), 0.55) * smoothstep(0.15, 0.4, d);
          float wet = smoothstep(0.12, 0.5, d + (clump - 0.5) * 0.25);
          float film = smoothstep(0.55, 0.8, d + (hvNoise(p * 3.0) - 0.5) * 0.3);
          vec3 dry = vec3(0.36, 0.25, 0.15);
          vec3 damp = vec3(0.17, 0.10, 0.055);
          vec3 soaked = vec3(0.11, 0.065, 0.035);
          vec3 col = mix(dry, damp, wet);
          col = mix(col, soaked, film);
          col *= 0.82 + 0.36 * clump;
          col *= 1.0 - hoof * 0.35;
          // Crusted lighter rim with a darker wet line just inside it
          col = mix(col, dry * 1.15, smoothstep(0.14, 0.0, d) * 0.6);
          col *= 1.0 - smoothstep(0.08, 0.2, d) * smoothstep(0.34, 0.2, d) * 0.25;
          // Normals: lumpy outside, flattening to a still film in the middle
          float e = 0.03;
          float bump = (1.0 - film * 0.85) * 0.5;
          float nx = (hvNoise((p + vec2(e, 0.0)) * 11.0) - hvNoise((p - vec2(e, 0.0)) * 11.0)) / (2.0 * e) * 0.03 * bump;
          float nz = (hvNoise((p + vec2(0.0, e)) * 11.0) - hvNoise((p - vec2(0.0, e)) * 11.0)) / (2.0 * e) * 0.03 * bump;
          float rip = sin(length(p * 6.0) * 6.0 - t * 0.8) * 0.02 * film;
          vec3 n = normalize(vec3(-nx + rip, 1.0, -nz));
          float diff = 0.45 + 0.55 * max(dot(n, L), 0.0);
          c = col * (uSunColor * diff * 0.95 * cloud + uSkyColor * 0.5);
          // Glossy film: sky in it, a sharp sun glint (bloom) and a broad sheen on the wet ring
          float ndv = max(dot(n, V), 0.0);
          float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
          vec3 Rv = reflect(-V, n);
          vec3 skyR = mix(uHorizonColor, uSkyColor, smoothstep(0.0, 0.7, Rv.y));
          float gloss = mix(wet * 0.25, 1.0, film);
          // (The film is muddy water: the sky in it is tinted brown, not blue.)
          c = mix(c, skyR * vec3(0.5, 0.42, 0.34), clamp(fres * 1.3 + 0.1, 0.0, 0.45) * gloss);
          vec3 R = reflect(-L, n);
          float spec = pow(max(dot(R, V), 0.0), 140.0) * 3.5 * film + pow(max(dot(R, V), 0.0), 18.0) * 0.12 * wet;
          c += uSunColor * spec * cloud * (1.0 - uNight * 0.6);
          // A slow bubble now and then in the deepest part
          vec2 bq = p * 2.0 + vec2(0.0, floor(t * 0.25));
          vec2 bid = floor(bq);
          float bub = smoothstep(0.06, 0.035, length(fract(bq) - 0.5 - (hvHash22(bid) - 0.5) * 0.6)) * step(hvHash12(bid + 9.1), 0.3) * film;
          c += vec3(0.6) * bub * (uSkyColor * 0.5 + uSunColor * 0.3);
          alpha = smoothstep(0.0, 0.16, d + (clump - 0.5) * 0.12);
        }
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
  mat.uniforms.uDucks = pondUniforms.uDucks;
  shared = mat;
  return mat;
}
