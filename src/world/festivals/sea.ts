/**
 * NightSea: the Tide Lantern Night sea at Driftglass Cove.
 *
 *   depth     terrain height texture → inky shallows over pale sand, deep indigo further out
 *   surface   rolling swell + layered ripple normals; night-sky Fresnel reflection; a broken moon
 *             glitter path; warm lantern-light shimmer bands (the lanterns' own reflection streaks
 *             are drawn by `Lanterns`)
 *   glow      bioluminescence: every wave that rolls in lights up as an electric-cyan foam front
 *             where it breaks on the sand, with clustered plankton sparkles flickering in the
 *             shallows and in the wake of drifting lanterns (all HDR, it feeds the bloom)
 *   far       a flat plane beyond the near grid reaching to the horizon
 *
 * One transparent draw call (+1 far), no shadows / AO.
 */
import * as THREE from 'three';
import { globalUniforms } from '../../render/uniforms';
import { NOISE_GLSL } from '../../render/shaders/noise';
import type { Terrain } from '../terrain';

export interface NightSeaOptions {
  terrain: Terrain;
  level: number;
  near: { x0: number; z0: number; x1: number; z1: number };
  /** Direction the waves roll in from (unit xz, pointing shoreward). */
  shoreward?: THREE.Vector2;
  /** Bioluminescence strength (0..∞). */
  glow?: number;
}

export class NightSea {
  readonly group = new THREE.Group();
  readonly glow = { value: 1 };
  /** Warm light (fireworks flash) tinting the water, rgb × intensity. */
  readonly flash = { value: new THREE.Color(0, 0, 0) };

  constructor(o: NightSeaOptions) {
    this.glow.value = o.glow ?? 1;
    const t = o.terrain.opts;
    const uniforms = {
      ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      uHeight: { value: o.terrain.heightTex },
      uHOrigin: { value: new THREE.Vector2(t.minX, t.minZ) },
      uHSize: { value: new THREE.Vector2(t.maxX - t.minX, t.maxZ - t.minZ) },
      uLevel: { value: o.level },
      uShore: { value: (o.shoreward ?? new THREE.Vector2(0, 1)).clone().normalize() },
      uTime: globalUniforms.uTime,
      uSunDir: globalUniforms.uSunDir,
      uSunColor: globalUniforms.uSunColor,
      uSkyColor: globalUniforms.uSkyColor,
      uHorizonColor: globalUniforms.uHorizonColor,
      uNight: globalUniforms.uNight,
      uLamps: globalUniforms.uLamps,
      uGlow: this.glow,
      uFlash: this.flash,
      uFar: { value: 0 },
    };
    const make = (far: boolean): THREE.ShaderMaterial => {
      const m = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: true,
        uniforms: { ...uniforms, uFar: { value: far ? 1 : 0 } },
        vertexShader: /* glsl */ `
          uniform sampler2D uHeight; uniform vec2 uHOrigin; uniform vec2 uHSize; uniform float uLevel; uniform float uTime; uniform vec2 uShore; uniform float uFar;
          varying vec3 vW;
          ${NOISE_GLSL}
          #include <fog_pars_vertex>
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            // Rolling swell (fades out in the shallows, where the waves break instead).
            float along = dot(wp.xz, uShore);
            float sw = sin(along * 0.55 - uTime * 1.1) * 0.05 + sin(dot(wp.xz, vec2(0.31, 0.12)) + uTime * 0.7) * 0.03;
            wp.y += sw * (1.0 - uFar);
            vW = wp.xyz;
            vec4 mvPosition = viewMatrix * wp;
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform vec3 uHorizonColor;
          uniform float uNight; uniform float uLamps; uniform float uGlow; uniform vec3 uFlash; uniform vec2 uShore; uniform float uLevel; uniform float uFar;
          uniform sampler2D uHeight; uniform vec2 uHOrigin; uniform vec2 uHSize;
          varying vec3 vW;
          ${NOISE_GLSL}
          #include <fog_pars_fragment>
          vec2 cellSpark(vec2 p, float t) {
            // Clustered plankton: sparse cells blink on and off.
            vec2 i = floor(p);
            vec2 f = fract(p) - 0.5;
            vec2 h = hvHash22(i);
            vec2 o = (h - 0.5) * 0.7;
            float d = length(f - o);
            float blink = pow(max(0.0, sin(t * (1.5 + h.x * 3.0) + h.y * 40.0)), 6.0);
            return vec2((1.0 - smoothstep(0.0, 0.12, d)) * blink, h.x);
          }
          void main() {
            vec2 huv = (vW.xz - uHOrigin) / uHSize;
            float ground = texture2D(uHeight, clamp(huv, 0.0, 1.0)).r;
            if (uFar > 0.5 || huv.x < 0.0 || huv.y < 0.0 || huv.x > 1.0 || huv.y > 1.0) ground = uLevel - 6.0;
            float vDepth = uLevel - ground;
            float depth = max(vDepth, 0.0);
            if (vDepth < -0.05) discard;
            vec2 p = vW.xz;
            float t = uTime;
            // Normals: two scrolling ripple layers + swell.
            vec2 e = vec2(0.15, 0.0);
            float s1 = hvFbm(p * 0.35 + vec2(t * 0.05, t * 0.08));
            float s2 = hvNoise(p * 1.3 - vec2(t * 0.22, -t * 0.12));
            float hx = hvFbm((p + e.xy) * 0.35 + vec2(t * 0.05, t * 0.08)) + (hvNoise((p + e.xy) * 1.3 - vec2(t * 0.22, -t * 0.12)) - s2) * 0.35;
            float hz = hvFbm((p + e.yx) * 0.35 + vec2(t * 0.05, t * 0.08)) + (hvNoise((p + e.yx) * 1.3 - vec2(t * 0.22, -t * 0.12)) - s2) * 0.35;
            vec3 n = normalize(vec3((s1 - hx) * 2.2, 1.0, (s1 - hz) * 2.2));
            vec3 V = normalize(cameraPosition - vW);
            float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
            // Base: inky shallows → indigo deep.
            float dk = 1.0 - exp(-depth * 0.9);
            vec3 shallow = vec3(0.035, 0.09, 0.11);
            vec3 deep = vec3(0.01, 0.022, 0.06);
            vec3 col = mix(shallow, deep, dk);
            // Sky reflection (night sky + horizon glow at grazing angles).
            vec3 R = reflect(-V, n);
            vec3 sky = mix(uHorizonColor, uSkyColor, smoothstep(0.0, 0.5, R.y)) * 0.4;
            col = mix(col, sky, fres * 0.6);
            // Moon glitter path.
            vec3 L = normalize(uSunDir);
            float spec = pow(max(dot(R, L), 0.0), 220.0);
            float glit = step(0.72, hvNoise(p * 3.0 + t * 0.4)) * pow(max(dot(R, L), 0.0), 18.0);
            col += uSunColor * (spec * 2.4 + glit * 0.9) * mix(1.0, 0.7, uNight);
            // Fireworks / lantern warm wash.
            col += uFlash * (0.25 + fres * 0.9) * (0.4 + 0.6 * s1);
            // Bioluminescent surf: wave fronts running shoreward, breaking over the sand.
            float along = dot(p, uShore);
            float wobble = hvNoise(p * 0.18 + 3.0) * 3.0 + hvNoise(p * 0.6) * 0.6;
            float phase = fract(along * 0.12 - t * 0.085 + wobble * 0.12);
            float front = smoothstep(0.0, 0.03, phase) * (1.0 - smoothstep(0.03, 0.14, phase));
            float breakZone = (1.0 - smoothstep(0.12, 1.1, depth)) * smoothstep(-0.02, 0.06, depth);
            float lace = smoothstep(0.35, 0.75, hvNoise(p * 2.4 + vec2(t * 0.3, 0.0))) * 0.7 + 0.3;
            float surf = front * breakZone * lace;
            // Edge: the thin film on the sand always glimmers faintly.
            float edge = (1.0 - smoothstep(0.0, 0.16, depth)) * (0.25 + 0.75 * smoothstep(0.3, 0.9, hvNoise(p * 1.7 + t * 0.5)));
            vec2 sp = cellSpark(p * 2.6, t);
            vec2 sp2 = cellSpark(p * 5.1 + 7.0, t * 1.3);
            float plank = (sp.x + sp2.x * 0.6) * (1.0 - smoothstep(0.2, 3.0, depth)) * (0.35 + 0.65 * smoothstep(0.3, 0.7, hvNoise(p * 0.25 + t * 0.02)));
            vec3 cyan = vec3(0.18, 0.95, 1.0);
            vec3 blue = vec3(0.1, 0.45, 1.0);
            vec3 bio = mix(blue, cyan, surf + edge * 0.5) * (surf * 3.2 + edge * 0.9 + plank * 2.6);
            col += bio * uGlow * uNight * (1.0 - uFar);
            // Pale foam that isn't glowing (visible in the day).
            col = mix(col, vec3(0.8, 0.85, 0.85), surf * 0.25 * (1.0 - uNight));
            float alpha = mix(0.55, 0.97, smoothstep(0.0, 0.9, depth));
            alpha = max(alpha, clamp(surf * 1.5 + edge, 0.0, 1.0));
            alpha *= smoothstep(-0.05, 0.03, vDepth);
            gl_FragColor = vec4(col, alpha);
            #include <fog_fragment>
          }`,
      });
      m.name = far ? 'night-sea-far' : 'night-sea';
      return m;
    };
    const n = o.near;
    const w = n.x1 - n.x0;
    const d = n.z1 - n.z0;
    const geo = new THREE.PlaneGeometry(w, d, Math.ceil(w / 0.6), Math.ceil(d / 0.6));
    geo.rotateX(-Math.PI / 2);
    geo.translate(n.x0 + w / 2, o.level, n.z0 + d / 2);
    const near = new THREE.Mesh(geo, make(false));
    near.renderOrder = 2;
    near.frustumCulled = false;
    near.userData.noAO = true;
    near.name = 'night-sea';
    this.group.add(near);
    // Far: beyond the near grid, out to the horizon (north).
    const fg = new THREE.PlaneGeometry(900, 420, 8, 8);
    fg.rotateX(-Math.PI / 2);
    fg.translate((n.x0 + n.x1) / 2, o.level - 0.01, n.z0 - 210);
    const far = new THREE.Mesh(fg, make(true));
    far.renderOrder = 2;
    far.frustumCulled = false;
    far.userData.noAO = true;
    far.name = 'night-sea-far';
    this.group.add(far);
    this.group.name = 'night-sea';
    this.group.userData.perfTag = 'water';
    this.group.userData.noAO = true;
  }
}

/**
 * FrozenRiver: a glossy ice sheet over a terrain channel (discarded where the ground rises above
 * it). Blue-green depth under clear ice, milky snow-dusted edges, criss-crossing skate scratches,
 * frozen bubbles and cracks, a sky / aurora-tinted Fresnel sheen and warm lamp glints.
 */
export class FrozenRiver {
  readonly mesh: THREE.Mesh;
  readonly aurora = { value: 1 };
  constructor(terrain: Terrain, level: number, bounds: { x0: number; z0: number; x1: number; z1: number }) {
    const t = terrain.opts;
    const w = bounds.x1 - bounds.x0;
    const d = bounds.z1 - bounds.z0;
    const geo = new THREE.PlaneGeometry(w, d, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(bounds.x0 + w / 2, level, bounds.z0 + d / 2);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: true,
      fog: true,
      uniforms: {
        ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
        uHeight: { value: terrain.heightTex },
        uHOrigin: { value: new THREE.Vector2(t.minX, t.minZ) },
        uHSize: { value: new THREE.Vector2(t.maxX - t.minX, t.maxZ - t.minZ) },
        uLevel: { value: level },
        uTime: globalUniforms.uTime,
        uSunDir: globalUniforms.uSunDir,
        uSunColor: globalUniforms.uSunColor,
        uSkyColor: globalUniforms.uSkyColor,
        uHorizonColor: globalUniforms.uHorizonColor,
        uNight: globalUniforms.uNight,
        uLamps: globalUniforms.uLamps,
        uAurora: this.aurora,
      },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        #include <fog_pars_vertex>
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uHeight; uniform vec2 uHOrigin; uniform vec2 uHSize; uniform float uLevel; uniform float uTime;
        uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform vec3 uHorizonColor; uniform float uNight; uniform float uLamps; uniform float uAurora;
        varying vec3 vW;
        ${NOISE_GLSL}
        #include <fog_pars_fragment>
        float scratch(vec2 p, float ang, float freq) {
          vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;
          float n = hvNoise(vec2(q.x * 0.35, q.y * freq));
          return smoothstep(0.93, 0.99, n) * smoothstep(0.3, 0.7, hvNoise(q * 0.2));
        }
        void main() {
          vec2 huv = (vW.xz - uHOrigin) / uHSize;
          float ground = texture2D(uHeight, clamp(huv, 0.0, 1.0)).r;
          float depth = uLevel - ground;
          if (depth < 0.0) discard;
          vec2 p = vW.xz;
          vec3 V = normalize(cameraPosition - vW);
          // Gentle undulating normal (frozen ripples) + cracks.
          float r1 = hvFbm(p * 0.6);
          float r2 = hvFbm(p * 0.6 + vec2(0.12, 0.0));
          float r3 = hvFbm(p * 0.6 + vec2(0.0, 0.12));
          vec3 n = normalize(vec3((r1 - r2) * 0.35, 1.0, (r1 - r3) * 0.35));
          float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
          float dk = smoothstep(0.0, 0.5, depth);
          vec3 deep = vec3(0.025, 0.1, 0.19);
          vec3 clear = vec3(0.13, 0.32, 0.44);
          vec3 col = mix(clear, deep, dk);
          // Frozen bubbles.
          vec2 bc = floor(p * 3.0);
          vec2 bf = fract(p * 3.0) - 0.5 - (hvHash22(bc) - 0.5) * 0.6;
          float bub = (1.0 - smoothstep(0.02, 0.07, length(bf))) * step(0.82, hvHash12(bc + 3.1));
          col += bub * 0.25;
          // Skate scratches (criss-crossing arcs).
          float sc = scratch(p, 0.35, 5.0) + scratch(p + 7.0, -0.5, 6.0) + scratch(p * 1.3 + 3.0, 1.2, 4.0) * 0.6;
          // Crack lines.
          float cr = (1.0 - smoothstep(0.0, 0.035, abs(hvFbm(p * 0.35 + 2.0) - 0.5))) * 0.6;
          // Light: diffuse sky + moon.
          vec3 L = normalize(uSunDir);
          float ndl = max(dot(n, L), 0.0);
          vec3 lit = col * (uSkyColor * 0.9 + uSunColor * ndl * 0.35 + vec3(0.04));
          lit += vec3(0.9, 0.95, 1.0) * (sc * 0.22 + cr * 0.12) * (uSkyColor + uSunColor * 0.3);
          // Reflection: sky gradient + aurora ribbons (night) + moon glint.
          vec3 R = reflect(-V, n);
          vec3 sky = mix(uHorizonColor, uSkyColor, smoothstep(0.0, 0.6, R.y)) * 0.7;
          float band = hvNoise(vec2(p.x * 0.08 + uTime * 0.02, p.y * 0.02)) * hvNoise(vec2(p.x * 0.5 - uTime * 0.05, 1.3));
          vec3 aur = mix(vec3(0.1, 0.9, 0.5), vec3(0.1, 0.6, 0.9), hvNoise(p * 0.05 + 4.0)) * pow(band, 1.6) * 0.9 * uAurora * smoothstep(0.4, 0.9, uNight);
          lit = mix(lit, sky * 0.5 + aur, min(fres, 0.6) * 0.55);
          lit += aur * 0.22;
          // Glassy lamp glints: warm sparkles scattered where the lamplight grazes the ice.
          vec2 gc = floor(p * 2.2);
          vec2 gf = fract(p * 2.2) - 0.5 - (hvHash22(gc + 2.1) - 0.5) * 0.6;
          float dot0 = 1.0 - smoothstep(0.0, 0.07, length(gf));
          float gl = dot0 * step(0.86, hvHash12(gc + 7.7)) * pow(max(0.0, sin(uTime * (0.6 + hvHash12(gc) * 1.4) + hvHash12(gc + 1.3) * 30.0)), 8.0);
          lit += vec3(1.0, 0.75, 0.45) * gl * uLamps * 0.9;
          float spec = pow(max(dot(R, L), 0.0), 300.0);
          lit += uSunColor * spec * 3.0;
          // Warm lamp sheen (uniform glow from the square).
          lit += vec3(1.0, 0.62, 0.3) * uLamps * 0.08 * (0.5 + sc);
          // Snow-dusted, milky edges.
          float edge = 1.0 - smoothstep(0.02, 0.12, depth);
          float drift = smoothstep(0.45, 0.75, hvFbm(p * 0.7 + 9.0));
          vec3 snow = vec3(0.86, 0.9, 0.98) * (uSkyColor * 0.8 + uSunColor * 0.4 * ndl + 0.05);
          lit = mix(lit, snow, clamp(edge + drift * 0.14, 0.0, 1.0));
          gl_FragColor = vec4(lit, 1.0);
          #include <fog_fragment>
        }`,
    });
    m.name = 'frozen-river';
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.name = 'frozen-river';
    this.mesh.receiveShadow = false;
    this.mesh.userData.noAO = true;
    this.mesh.userData.perfTag = 'water';
    this.mesh.renderOrder = 1;
  }
}
