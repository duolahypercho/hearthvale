/**
 * Paddock water + mud: the duck pond and the pig's wallow (plus the muddy aprons at the trough) as ONE
 * shaded mesh (one draw), instead of flat tinted decals.
 *
 * Every pool is a wobbly-rimmed disc whose vertices carry `aDepth` (0 at the rim → 1 in the middle) and
 * `aKind` (0 water, 1 mud), so the shader fakes a basin without carving the terrain:
 *   water  shallow silt-green → deep teal by depth, caustic shimmer in the shallows, Fresnel sky + dark
 *          bank reflection, sun glints (bloom), a broken animated foam line at the rim, and expanding
 *          ripple rings + a soft contact shadow round every duck on it (`pondUniforms.uDucks`).
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
    this.disc(cx, cz, rx, rz, 0, lift, 36, 6);
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
        const w = 0.82 + 0.22 * wob(cx * 3 + Math.cos(a) * 2.2, cz * 3 + Math.sin(a) * 2.2);
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
          // ── Water ──
          float d = vDepth;
          float e = 0.05;
          float amp = 0.12 + 0.06 * uWindStrength;
          float hx = wh(p + vec2(e, 0.0), t) - wh(p - vec2(e, 0.0), t);
          float hz = wh(p + vec2(0.0, e), t) - wh(p - vec2(0.0, e), t);
          vec2 nrm = vec2(-hx, -hz) / (2.0 * e) * amp;
          // Duck wakes: rings spreading from each swimmer, plus a soft contact shadow under it.
          float wake = 0.0;
          float shade = 0.0;
          for (int i = 0; i < ${MAX_DUCKS}; i++) {
            vec4 dk = uDucks[i];
            if (dk.z <= 0.0) continue;
            vec2 dv = p - dk.xy;
            float r = length(dv);
            float ring = sin(r * 26.0 - t * 3.2 + dk.w) * exp(-r * 2.6) * smoothstep(0.12, 0.2, r);
            nrm += normalize(dv + 1e-4) * ring * 0.35 * dk.z;
            wake += max(ring, 0.0) * dk.z * smoothstep(1.1, 0.2, r);
            shade = max(shade, smoothstep(0.26, 0.05, length(dv * vec2(1.0, 1.35) + vec2(-0.03, -0.05))) * dk.z);
          }
          vec3 n = normalize(vec3(nrm.x, 1.0, nrm.y));
          float ndv = max(dot(n, V), 0.0);
          float fres = max(0.02 + 0.98 * pow(1.0 - ndv, 5.0), 0.06);
          // Silt-green shallows → clear teal → deep blue-teal in the middle
          // (The sun is HDR-bright here: these read as olive shallows → jade → a deep blue-green well.)
          vec3 shallow = vec3(0.16, 0.2, 0.08);
          vec3 mid = vec3(0.025, 0.13, 0.12);
          vec3 deep = vec3(0.006, 0.035, 0.06);
          float dk = pow(d, 0.7);
          vec3 col = mix(shallow, mid, smoothstep(0.0, 0.3, dk));
          col = mix(col, deep, smoothstep(0.3, 0.9, dk));
          // Pebbly bed visible through the shallows
          col *= 0.85 + 0.3 * hvNoise(p * 9.0) * (1.0 - smoothstep(0.1, 0.6, d));
          float caus = pow(hvNoise(p * 4.0 + vec2(t * 0.4, t * 0.3)) * hvNoise(p * 4.9 - vec2(t * 0.35, t * 0.2)), 1.5);
          col += vec3(0.5, 0.85, 0.7) * caus * 0.45 * (1.0 - smoothstep(0.0, 0.7, d));
          col *= 1.0 - shade * 0.45;
          float diff = 0.55 + 0.45 * max(dot(n, L), 0.0);
          vec3 lit = col * (uSunColor * diff * 0.9 * cloud + uSkyColor * 0.55);
          vec3 Rv = reflect(-V, n);
          vec3 skyR = mix(uHorizonColor, uSkyColor, smoothstep(0.0, 0.7, Rv.y));
          // Bank + reeds mirrored in a band along the rim (dark green), clear sky in the middle
          float bank = smoothstep(0.45, 0.0, d) * (0.5 + 0.5 * hvNoise(p * 2.0 + n.xz * 3.0));
          vec3 bankCol = mix(vec3(0.07, 0.14, 0.06), vec3(0.16, 0.24, 0.1), hvNoise(p * 3.0)) * (uSunColor * 0.4 + uSkyColor * 0.5);
          vec3 refl = mix(skyR * 0.95, bankCol, bank * 0.7);
          // (Mostly looking down into it at this pitch: a little sky, the depth colour does the work.)
          c = mix(lit, refl, clamp(fres * 1.2 + 0.05 + bank * 0.25, 0.0, 0.7));
          vec3 R = reflect(-L, n);
          float spec = pow(max(dot(R, V), 0.0), 260.0) * 7.0 + pow(max(dot(R, V), 0.0), 28.0) * 0.2;
          c += uSunColor * spec * cloud * (1.0 - uNight * 0.6);
          // Foam: a broken line hugging the rim + a lapping band just inside it; wake crests
          float fn = hvNoise(p * 7.0 + t * 0.35);
          float fn2 = hvNoise(p * 15.0 - vec2(t * 0.5, t * 0.2));
          float rim = smoothstep(0.1, 0.0, d);
          float shoreF = smoothstep(0.5, 0.68, fn * 0.6 + fn2 * 0.4 + rim * 0.5 - 0.12) * smoothstep(0.16, 0.02, d);
          float band = smoothstep(0.85, 1.0, sin(d * 40.0 - t * 1.8 + fn * 4.0)) * smoothstep(0.2, 0.06, d) * smoothstep(0.3, 0.6, fn2);
          float foam = clamp(shoreF * 0.85 + band * 0.4 + wake * 0.55 * smoothstep(0.4, 0.7, fn2 + 0.2), 0.0, 1.0);
          vec3 foamCol = vec3(0.95, 0.97, 0.96) * (uSunColor * 0.6 + uSkyColor * 0.6);
          c = mix(c, foamCol, foam);
          alpha = mix(0.72, 0.95, smoothstep(0.0, 0.5, d));
          alpha = max(alpha, foam) * smoothstep(0.0, 0.035, d);
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
