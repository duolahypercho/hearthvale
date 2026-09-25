/**
 * GPU precipitation, zero per-frame CPU work beyond a few uniforms:
 *  - RainStreaks: two layers (near fast / far slow + faint) of camera-facing hairline quads
 *    (constant 1-1.5 px on screen) in a volume that follows the camera focus, slanted by the
 *    wind, alpha-blended in the sky colour, depth-faded near the lens.
 *  - RainSplashes: ~450 expanding rings (+ a tiny crown dot) respawning at random spots on
 *    the terrain / water surface (heights sampled from the terrain height texture).
 *  - SnowFlakes: soft round flakes drifting down on sine paths.
 * Intensity 0 hides everything (no draw calls).
 */
import * as THREE from 'three';
import { globalUniforms } from './uniforms';

const BOX = new THREE.Vector3(24, 13, 24);

function seeds(n: number, seed: number): Float32Array {
  const a = new Float32Array(n * 4);
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < a.length; i++) a[i] = rnd();
  return a;
}

function quadGeometry(n: number, seed: number, flat: boolean): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const pos = flat
    ? [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]
    : [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds(n, seed), 4));
  g.instanceCount = n;
  return g;
}

const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uIntensity;
attribute vec4 aSeed;
vec3 wrapBox(vec3 p) {
  vec3 size = uBox * 2.0;
  vec3 rel = p - (uCenter - uBox);
  rel.xz = mod(rel.xz, size.xz);
  return uCenter - uBox + rel;
}
`;

export interface RainLayer {
  /** Max instances. */
  count: number;
  /** Fall speed (m/s). */
  speed: number;
  /** Streak length (m). */
  length: number;
  /** Streak width in screen pixels (at 1080p). */
  px: number;
  /** Peak alpha. */
  alpha: number;
  /** Half-extent of the wrap volume. */
  box: THREE.Vector3;
  seed: number;
}

/** Near layer: fast, crisp hairlines around the focus. Far layer: slow, faint veil behind it. */
export const RAIN_NEAR: RainLayer = { count: 15000, speed: 19, length: 0.32, px: 1.4, alpha: 0.33, box: new THREE.Vector3(22, 12, 22), seed: 1234 };
export const RAIN_FAR: RainLayer = { count: 9000, speed: 11, length: 0.2, px: 1.1, alpha: 0.2, box: new THREE.Vector3(34, 15, 34), seed: 4321 };

export class RainStreaks {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  readonly max: number;

  constructor(readonly layer: RainLayer = RAIN_NEAR) {
    const max = layer.count;
    this.max = max;
    const geo = quadGeometry(max, layer.seed, false);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uCenter: { value: new THREE.Vector3() },
          uBox: { value: layer.box.clone() },
          uIntensity: { value: 0 },
          uSpeed: { value: layer.speed },
          uLen: { value: layer.length },
          uPx: { value: layer.px },
          uPxAngle: { value: 0.0006 },
          uAlpha: { value: layer.alpha },
          uWind: { value: new THREE.Vector2() },
          uColor: { value: new THREE.Color(0xcfe0ff) },
          uCount: { value: max },
          uGust: { value: 0 },
          uFlash: { value: 0 },
        },
      ]),
      vertexShader: /* glsl */ `
        ${COMMON}
        #include <fog_pars_vertex>
        uniform float uSpeed;
        uniform float uLen;
        uniform float uPx;
        uniform float uPxAngle;
        uniform vec2 uWind;
        uniform float uCount;
        uniform float uGust;
        varying vec2 vUv;
        varying float vA;
        float rnHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float rnNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(rnHash(i), rnHash(i + vec2(1.0, 0.0)), u.x), mix(rnHash(i + vec2(0.0, 1.0)), rnHash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        void main() {
          float idx = float(gl_InstanceID);
          float on = step(idx, uCount * uIntensity);
          float sp = uSpeed * (0.85 + 0.3 * aSeed.w);
          float h = uBox.y * 2.0;
          float y = mod(aSeed.y * h - uTime * sp, h);
          vec3 vel = vec3(uWind.x, -sp, uWind.y);
          vec3 p = vec3(aSeed.x * uBox.x * 2.0, 0.0, aSeed.z * uBox.z * 2.0);
          // slant: drops higher up are displaced upwind so all streaks share one direction
          p.xz -= vel.xz / sp * (h - y);
          p.y = y;
          p += uCenter - vec3(uBox.x, uBox.y * 0.25, uBox.z);
          p = wrapBox(p);
          // Every drop leans a little differently (±6 deg): no ruled sheet of identical slashes.
          vec3 dir = normalize(vel + vec3(aSeed.x - 0.5, 0.0, aSeed.z - 0.5) * sp * 0.21);
          vec3 toCam = normalize(cameraPosition - p);
          vec3 side = normalize(cross(dir, toCam));
          float camD = length(cameraPosition - p);
          // Storms: longer streaks (driving rain), slanted harder by the gusts; near drops read
          // longer, far ones shorter and fainter (depth).
          float depthK = smoothstep(12.0, 40.0, camD);
          float len = uLen * (0.6 + 0.8 * fract(aSeed.w * 7.31)) * (1.0 + uGust * 1.1) * mix(1.25, 0.65, depthK);
          // Constant on-screen width: thin hairlines (~0.9 px) whatever the distance.
          float w = camD * uPxAngle * uPx * 0.62 * (0.85 + 0.3 * aSeed.x) * (1.0 + uGust * 0.15);
          vec3 wp = p + side * position.x * w - dir * position.y * len;
          vUv = uv;
          // Depth fade: drops right in front of the lens read as smears, not rain.
          vA = on * (0.55 + 0.45 * aSeed.w) * smoothstep(7.0, 16.0, camD) * mix(1.0, 0.6, depthK);
          // Storm gusts: denser sheets of rain sweep through downwind, thin gaps between them.
          vec2 gw = normalize(uWind + vec2(1e-4, 0.0));
          vec2 gq = vec2(dot(p.xz, gw), dot(p.xz, vec2(-gw.y, gw.x)));
          float band = rnNoise(vec2(gq.x * 0.09 - uTime * 0.55, gq.y * 0.035)) * 0.7 + rnNoise(gq * 0.21 + uTime * 0.2) * 0.3;
          vA *= mix(1.0, 0.35 + 2.4 * smoothstep(0.3, 0.75, band), uGust);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform vec3 uColor;
        uniform float uAlpha;
        uniform float uFlash;
        varying vec2 vUv;
        varying float vA;
        void main() {
          float along = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
          float a = along * vA * uAlpha * (1.0 + uFlash * 1.5);
          if (a < 0.004) discard;
          // Lightning catches every drop for an instant.
          gl_FragColor = vec4(mix(uColor, vec3(0.95, 0.95, 1.0), uFlash), min(a, 1.0));
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.name = 'rain';
    this.mesh.userData.noAO = true;
  }

  /** `pxAngle`: world units per screen pixel per metre of distance (2·tan(fov/2) / heightPx). */
  update(center: THREE.Vector3, intensity: number, time: number, pxAngle = 0.0006, flash = 0): void {
    const u = this.mat.uniforms;
    u.uGust!.value = THREE.MathUtils.smoothstep(intensity, 0.85, 1.0);
    u.uFlash!.value = flash;
    u.uTime!.value = time;
    (u.uCenter!.value as THREE.Vector3).copy(center);
    u.uIntensity!.value = intensity;
    u.uPxAngle!.value = pxAngle;
    const wd = globalUniforms.uWindDir.value;
    const ws = globalUniforms.uWindStrength.value;
    const slant = 2.4 + u.uGust!.value * 1.8;
    (u.uWind!.value as THREE.Vector2).set(wd.x * ws * slant, wd.y * ws * slant);
    // Tinted by the sky (not white): a pale sky-grey veil by day, faint blue at night.
    const sky = globalUniforms.uSkyColor.value;
    const hor = globalUniforms.uHorizonColor.value;
    (u.uColor!.value as THREE.Color)
      .setRGB((sky.r + hor.r) * 0.5, (sky.g + hor.g) * 0.5, (sky.b + hor.b) * 0.5)
      .lerp(new THREE.Color(0.86, 0.9, 0.96), 0.4)
      .multiplyScalar(1 - globalUniforms.uNight.value * 0.55);
    this.mesh.visible = intensity > 0.01;
  }
}

export interface HeightSource {
  tex: THREE.Texture;
  origin: THREE.Vector2;
  size: THREE.Vector2;
  waterLevel: number;
}

export class RainSplashes {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(max = 700) {
    const geo = quadGeometry(max, 987, true);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uCenter: { value: new THREE.Vector3() },
          uBox: { value: new THREE.Vector3(17, 1, 15) },
          uIntensity: { value: 0 },
          uHeight: { value: null },
          uHOrigin: { value: new THREE.Vector2() },
          uHSize: { value: new THREE.Vector2(1, 1) },
          uWater: { value: -99 },
          uColor: { value: new THREE.Color(0xdde8ff) },
          uCount: { value: max },
        },
      ]),
      vertexShader: /* glsl */ `
        ${COMMON}
        #include <fog_pars_vertex>
        uniform sampler2D uHeight;
        uniform vec2 uHOrigin;
        uniform vec2 uHSize;
        uniform float uWater;
        uniform float uCount;
        varying vec2 vUv;
        varying float vAge;
        varying float vOn;
        float h1(float n) { return fract(sin(n) * 43758.5453); }
        void main() {
          float idx = float(gl_InstanceID);
          float life = 0.26 + aSeed.w * 0.1;
          float t = uTime / life + aSeed.x * 17.0;
          float cyc = floor(t);
          vAge = fract(t);
          vOn = step(idx, uCount * uIntensity);
          vec2 r = vec2(h1(cyc * 12.9898 + aSeed.y * 78.233), h1(cyc * 39.346 + aSeed.z * 11.135));
          vec3 p = vec3(uCenter.x + (r.x - 0.5) * uBox.x * 2.0, 0.0, uCenter.z + (r.y - 0.5) * uBox.z * 2.0);
          float g = texture2D(uHeight, (p.xz - uHOrigin) / uHSize).r;
          p.y = max(g, uWater) + 0.03;
          float s = 0.06 + vAge * 0.22 * (0.7 + aSeed.w * 0.6);
          vec3 wp = p + vec3(position.x * s, 0.0, position.z * s);
          vUv = uv;
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vAge;
        varying float vOn;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(0.66, 0.82, d) * (1.0 - smoothstep(0.86, 1.0, d));
          float dot_ = (1.0 - smoothstep(0.0, 0.3, d)) * (1.0 - smoothstep(0.0, 0.3, vAge));
          float a = (ring * (1.0 - vAge) * (1.0 - vAge) * 0.32 + dot_ * 0.45) * vOn;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.name = 'splashes';
    this.mesh.userData.noAO = true;
  }

  setHeightSource(h: HeightSource | null): void {
    const u = this.mat.uniforms;
    u.uHeight!.value = h?.tex ?? null;
    if (h) {
      (u.uHOrigin!.value as THREE.Vector2).copy(h.origin);
      (u.uHSize!.value as THREE.Vector2).copy(h.size);
      u.uWater!.value = h.waterLevel;
    }
  }

  update(center: THREE.Vector3, intensity: number, time: number): void {
    const u = this.mat.uniforms;
    u.uTime!.value = time;
    (u.uCenter!.value as THREE.Vector3).copy(center);
    u.uIntensity!.value = intensity;
    const sky = globalUniforms.uSkyColor.value;
    (u.uColor!.value as THREE.Color).setRGB(0.6 + sky.r * 0.5, 0.66 + sky.g * 0.5, 0.75 + sky.b * 0.5).multiplyScalar(1 - globalUniforms.uNight.value * 0.6);
    this.mesh.visible = intensity > 0.01 && u.uHeight!.value !== null;
  }
}

export class SnowFlakes {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(max = 4500) {
    const geo = quadGeometry(max, 555, false);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uCenter: { value: new THREE.Vector3() },
          uBox: { value: BOX.clone() },
          uIntensity: { value: 0 },
          uWind: { value: new THREE.Vector2() },
          uColor: { value: new THREE.Color(1, 1, 1) },
          uCount: { value: max },
          uPxAngle: { value: 0.0006 },
          uCamDist: { value: 24 },
        },
      ]),
      vertexShader: /* glsl */ `
        ${COMMON}
        #include <fog_pars_vertex>
        uniform vec2 uWind;
        uniform float uCount;
        uniform float uPxAngle;
        uniform float uCamDist;
        varying vec2 vUv;
        varying float vA;
        void main() {
          float idx = float(gl_InstanceID);
          float on = step(idx, uCount * uIntensity);
          float sp = 1.1 + aSeed.w * 0.9;
          float h = uBox.y * 2.0;
          float y = mod(aSeed.y * h - uTime * sp, h);
          float ph = aSeed.x * 40.0;
          vec3 p = vec3(aSeed.x * uBox.x * 2.0, y, aSeed.z * uBox.z * 2.0);
          p.x += sin(uTime * 0.9 + ph) * 0.6 + uWind.x * uTime;
          p.z += cos(uTime * 0.7 + ph * 1.3) * 0.5 + uWind.y * uTime;
          p += uCenter - vec3(uBox.x, uBox.y * 0.25, uBox.z);
          p = wrapBox(p);
          float s = 0.05 + aSeed.w * 0.06;
          // Never a blurry disc on the lens: at most ~8 px on screen, and flakes closer than a
          // quarter of the camera distance fade out.
          float camD = length(cameraPosition - p);
          s = min(s, camD * uPxAngle * 8.0);
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 wp = p + (right * position.x + up * (position.y - 0.5)) * s;
          vUv = uv;
          vA = on * (0.55 + 0.45 * aSeed.w) * smoothstep(uCamDist * 0.25, uCamDist * 0.42, camD);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vA;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = (1.0 - smoothstep(0.25, 1.0, d)) * vA * 0.9;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.name = 'snow';
    this.mesh.userData.noAO = true;
  }

  update(center: THREE.Vector3, intensity: number, time: number, pxAngle = 0.0006, camDist = 24): void {
    const u = this.mat.uniforms;
    u.uPxAngle!.value = pxAngle;
    u.uCamDist!.value = camDist;
    u.uTime!.value = time;
    (u.uCenter!.value as THREE.Vector3).copy(center);
    u.uIntensity!.value = intensity;
    const wd = globalUniforms.uWindDir.value;
    const ws = globalUniforms.uWindStrength.value;
    (u.uWind!.value as THREE.Vector2).set(wd.x * ws * 0.5, wd.y * ws * 0.5);
    const sky = globalUniforms.uSkyColor.value;
    const sun = globalUniforms.uSunColor.value;
    (u.uColor!.value as THREE.Color).setRGB(0.75 + sky.r * 0.25 + sun.r * 0.1, 0.78 + sky.g * 0.25 + sun.g * 0.1, 0.85 + sky.b * 0.25 + sun.b * 0.1).multiplyScalar(1 - globalUniforms.uNight.value * 0.5);
    this.mesh.visible = intensity > 0.01;
  }
}
