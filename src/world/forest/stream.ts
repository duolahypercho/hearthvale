/**
 * Running water for Cindergrove (on top of the still water planes from world/water.ts):
 *  - Waterfall: an arcing ribbon from the plateau lip into the plunge pool with fast scrolling
 *    streaks, torn translucent edges, a white churn at the base; freezes into pale ice in winter.
 *  - Plunge churn: radial foam spreading from the impact point.
 *  - Mist: soft sprites billowing up from the base (GPU-looped, no CPU work).
 *  - Flow lines: a ribbon along each stream carrying drifting foam threads + sun glints downstream.
 */
import * as THREE from 'three';
import { globalUniforms } from '../../render/uniforms';
import { NOISE_GLSL } from '../../render/shaders/noise';
import { textures } from '../../render/textures';

function commonUniforms(): Record<string, THREE.IUniform> {
  return {
    uTime: globalUniforms.uTime,
    uSunDir: globalUniforms.uSunDir,
    uSunColor: globalUniforms.uSunColor,
    uSkyColor: globalUniforms.uSkyColor,
    uHorizonColor: globalUniforms.uHorizonColor,
    uNight: globalUniforms.uNight,
    uSnow: globalUniforms.uSnow,
    uRain: globalUniforms.uRain,
  };
}

const HEAD = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform float uNight;
uniform float uSnow;
uniform float uRain;
${NOISE_GLSL}
`;

function withFog(u: Record<string, THREE.IUniform>): Record<string, THREE.IUniform> {
  const fog = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
  return { ...fog, ...u };
}

// ───────────────────────────────────────────── waterfall

export interface FallsSpec {
  x: number;
  lipZ: number;
  top: number;
  bottom: number;
  width: number;
  /** Horizontal throw at the bottom (m). */
  throw: number;
}

export function buildWaterfall(s: FallsSpec): THREE.Mesh {
  const NU = 14;
  const NV = 30;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const drop = s.top - s.bottom;
  const len = drop + s.throw;
  for (let j = 0; j <= NV; j++) {
    const v = j / NV;
    // Short lip curl, then a ballistic arc (z ∝ t, y ∝ t²).
    const t = v;
    const y = s.top + 0.06 - drop * t * t - 0.05 * Math.sin(t * Math.PI);
    const z = s.lipZ - 0.25 + s.throw * Math.sqrt(t) * 0.35 + s.throw * t * 0.65;
    const w = s.width * (0.92 + 0.28 * t);
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      const xx = s.x + (u - 0.5) * w;
      // Slight bulge so the sheet reads as a rounded curtain.
      const bulge = Math.sin(u * Math.PI) * 0.18 * (0.3 + t);
      pos.push(xx, y, z + bulge);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NU; i++) {
      const a = j * (NU + 1) + i;
      const b = a + NU + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: withFog({ ...commonUniforms(), uLen: { value: len }, uWidth: { value: s.width } }),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying vec3 vW;
      varying vec3 vN;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      ${HEAD}
      uniform float uLen;
      uniform float uWidth;
      varying vec2 vUv;
      varying vec3 vW;
      varying vec3 vN;
      void main() {
        float ice = smoothstep(0.5, 0.9, uSnow);
        float t = uTime * (1.0 - ice * 0.97);
        vec2 q = vec2(vUv.x * uWidth * 5.0, vUv.y * uLen);
        float s1 = hvNoise(vec2(q.x * 1.0, q.y * 0.55 - t * 3.4));
        float s2 = hvNoise(vec2(q.x * 2.3 + 7.0, q.y * 0.9 - t * 4.6));
        float s3 = hvNoise(vec2(q.x * 5.1 + 3.0, q.y * 1.6 - t * 6.0));
        float streak = s1 * 0.5 + s2 * 0.32 + s3 * 0.18;
        // Torn, translucent edges and a few gaps where the rock shows through.
        float edgeN = hvNoise(vec2(vUv.y * uLen * 1.3 - t * 2.0, 3.0)) * 0.14;
        float edge = smoothstep(0.0, 0.14 + edgeN, vUv.x) * smoothstep(1.0, 0.86 - edgeN, vUv.x);
        float gaps = smoothstep(0.18, 0.42, streak + vUv.y * 0.35);
        float lip = smoothstep(0.0, 0.05, vUv.y);
        float churn = smoothstep(0.72, 1.0, vUv.y);
        float white = smoothstep(0.45, 0.8, streak) + churn * 0.8;
        vec3 deep = vec3(0.13, 0.32, 0.34);
        vec3 foam = vec3(0.93, 0.97, 0.98);
        vec3 col = mix(deep, foam, clamp(white, 0.0, 1.0));
        vec3 light = uSunColor * 0.62 + uSkyColor * 0.55 + uHorizonColor * 0.15;
        col *= light;
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - abs(dot(normalize(vN), V)), 3.0);
        col += mix(uHorizonColor, uSkyColor, 0.5) * fres * 0.25;
        // Glints sliding down the sheet.
        float gl = pow(hvNoise(vec2(q.x * 9.0, q.y * 3.0 - t * 8.0)), 12.0) * 3.0 * (1.0 - uNight * 0.8);
        col += uSunColor * gl;
        float a = edge * lip * mix(0.5, 0.94, gaps) * mix(0.72, 1.0, white);
        // Winter: frozen curtain of pale ice with glassy vertical ridges.
        if (ice > 0.0) {
          float ridge = hvNoise(vec2(q.x * 3.0, q.y * 0.12)) * 0.6 + hvNoise(vec2(q.x * 11.0, q.y * 0.3)) * 0.4;
          vec3 iceCol = mix(vec3(0.62, 0.8, 0.9), vec3(0.93, 0.97, 1.0), ridge) * (uSunColor * 0.5 + uSkyColor * 0.75);
          iceCol += uSunColor * pow(ridge, 8.0) * 1.2;
          col = mix(col, iceCol, ice);
          a = mix(a, edge * lip * (0.82 + 0.18 * ridge), ice);
        }
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'waterfall';
  mesh.renderOrder = 4;
  mesh.userData.noAO = true;
  mesh.userData.perfTag = 'water';
  return mesh;
}

// ───────────────────────────────────────────── plunge churn (foam disc)

export function buildChurn(x: number, y: number, z: number, r: number): THREE.Mesh {
  const g = new THREE.CircleGeometry(r, 40);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: withFog({ ...commonUniforms(), uC: { value: new THREE.Vector2(x, z) }, uR: { value: r } }),
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
      ${HEAD}
      uniform vec2 uC;
      uniform float uR;
      varying vec3 vW;
      void main() {
        float ice = smoothstep(0.5, 0.9, uSnow);
        if (ice > 0.98) discard;
        vec2 d = vW.xz - uC;
        d.y *= 1.35;
        float r = length(d) / uR;
        float ang = atan(d.y, d.x);
        float t = uTime;
        float n1 = hvNoise(vec2(ang * 3.0, r * 6.0 - t * 1.6));
        float n2 = hvNoise(vec2(ang * 7.0 + 3.0, r * 12.0 - t * 2.4));
        float n3 = hvNoise(vec2(ang * 13.0 - 2.0, r * 20.0 - t * 3.1));
        float foam = smoothstep(0.5, 0.78, n1 * 0.5 + n2 * 0.32 + n3 * 0.18 + (1.0 - r) * 0.34);
        float core = smoothstep(0.35, 0.0, r) * 0.35;
        float a = clamp(foam * 0.75 + core, 0.0, 1.0) * smoothstep(1.0, 0.45, r) * (1.0 - ice);
        vec3 col = vec3(0.94, 0.97, 0.98) * (uSunColor * 0.6 + uSkyColor * 0.6);
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'churn';
  mesh.renderOrder = 3;
  mesh.userData.noAO = true;
  mesh.userData.perfTag = 'water';
  return mesh;
}

// ───────────────────────────────────────────── mist

export function buildMist(x: number, y: number, z: number, spread: number, count = 34): THREE.Mesh {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  g.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: withFog({ ...commonUniforms(), uOrigin: { value: new THREE.Vector3(x, y, z) }, uSpread: { value: spread }, uTex: { value: textures.smokePuff().map } }),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform float uTime;
      uniform vec3 uOrigin;
      uniform float uSpread;
      attribute vec4 aSeed;
      varying vec2 vUv;
      varying float vA;
      void main() {
        float life = 3.2 + aSeed.w * 2.5;
        float age = fract(uTime / life + aSeed.x);
        vec3 p = uOrigin + vec3((aSeed.y - 0.5) * uSpread, 0.0, (aSeed.z - 0.5) * uSpread * 0.5);
        p.y += age * (1.6 + aSeed.w * 1.4);
        p.z += age * 1.1;
        p.x += sin(uTime * 0.6 + aSeed.x * 20.0) * 0.4 * age;
        float size = (0.9 + aSeed.w * 1.2) * (0.6 + age * 1.4);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 wp = p + (right * position.x + up * position.y) * size;
        vUv = uv;
        vA = smoothstep(0.0, 0.2, age) * (1.0 - smoothstep(0.5, 1.0, age));
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform sampler2D uTex;
      uniform vec3 uSunColor;
      uniform vec3 uSkyColor;
      uniform float uSnow;
      varying vec2 vUv;
      varying float vA;
      void main() {
        float tex = texture2D(uTex, vUv).a;
        float a = tex * vA * 0.2 * (1.0 - smoothstep(0.5, 0.9, uSnow));
        if (a < 0.003) discard;
        gl_FragColor = vec4(vec3(0.92, 0.95, 0.97) * (uSunColor * 0.5 + uSkyColor * 0.7), a);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.name = 'falls-mist';
  mesh.renderOrder = 9;
  mesh.userData.noAO = true;
  mesh.userData.perfTag = 'water';
  return mesh;
}

// ───────────────────────────────────────────── flow ribbon

/**
 * Ribbon hugging a stream centreline at the water surface: uv.x across (0..1), uv.y along (m).
 * `widthAt(t)` gives the half-width.
 */
export function buildFlow(points: [number, number][], y: number, halfWidth: (t: number) => number, speed: number, t0 = 0, t1 = 1): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal');
  const L = curve.getLength() * (t1 - t0);
  const N = Math.max(8, Math.ceil(L / 0.5));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const side = new THREE.Vector3();
  for (let j = 0; j <= N; j++) {
    const t = t0 + (j / N) * (t1 - t0);
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    side.set(-tan.z, 0, tan.x).normalize();
    const w = halfWidth(t);
    for (let i = 0; i <= 4; i++) {
      const u = i / 4;
      pos.push(p.x + side.x * (u - 0.5) * 2 * w, y, p.z + side.z * (u - 0.5) * 2 * w);
      uv.push(u, (j / N) * L);
    }
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < 4; i++) {
      const a = j * 5 + i;
      const b = a + 5;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: withFog({ ...commonUniforms(), uSpeed: { value: speed } }),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying vec3 vW;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      ${HEAD}
      uniform float uSpeed;
      varying vec2 vUv;
      varying vec3 vW;
      void main() {
        float ice = smoothstep(0.5, 0.9, uSnow);
        if (ice > 0.98) discard;
        float t = uTime * uSpeed;
        float u = vUv.x;
        float along = vUv.y;
        // Threads of foam stretched along the flow, meandering across it.
        float wob = hvNoise(vec2(along * 0.25 - t * 0.2, 1.7)) * 0.3;
        float n1 = hvNoise(vec2((u + wob) * 9.0, along * 0.7 - t));
        float n2 = hvNoise(vec2((u - wob) * 17.0 + 5.0, along * 1.3 - t * 1.35));
        float threads = smoothstep(0.66, 0.86, n1 * 0.6 + n2 * 0.4);
        float edge = smoothstep(0.0, 0.2, u) * smoothstep(1.0, 0.8, u);
        float bankFoam = (1.0 - smoothstep(0.0, 0.16, min(u, 1.0 - u))) * smoothstep(0.45, 0.7, hvNoise(vec2(u * 6.0, along * 1.8 - t * 1.2)));
        vec3 light = uSunColor * 0.6 + uSkyColor * 0.6;
        vec3 col = vec3(0.9, 0.96, 0.97) * light;
        // Sun glints riding the current.
        vec3 V = normalize(cameraPosition - vW);
        vec2 gq = vec2(u * 30.0, along * 4.0 - t * 3.0);
        float glint = pow(hvNoise(gq) * hvNoise(gq * 1.7 + 4.0), 6.0) * 40.0;
        vec3 H = normalize(normalize(uSunDir) + V);
        float spec = pow(max(H.y, 0.0), 24.0);
        col += uSunColor * glint * spec * (1.0 - uNight * 0.8);
        float a = (threads * 0.34 + bankFoam * 0.3) * edge + glint * spec * 0.4 * edge;
        a *= 1.0 - ice;
        a = clamp(a, 0.0, 0.9);
        if (a < 0.004) discard;
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'stream-flow';
  mesh.renderOrder = 3;
  mesh.userData.noAO = true;
  mesh.userData.perfTag = 'water';
  return mesh;
}
