/**
 * Mine set dressing, built per floor and merged per material (a handful of draw calls):
 * timber shoring with hanging lanterns, a minecart on rails, crates / barrels, glowcap mushrooms,
 * stalagmites / ice spikes / basalt columns, bones, icicles on the cliff faces, snow drifts,
 * ember vents, glowing crystal clusters, the ladder up (with a shaft of daylight falling from the
 * hole above), the elevator cage and the ladder-down hole revealed under a broken rock.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { MeshBuilder, roundedBox, bevelCylinder, mat, lumpySphere, boxUV, mergeStatic } from '../geom';
import { buildCrate, buildBarrel } from '../props/structures';
import { globalUniforms } from '../../render/uniforms';
import { patchMaterial, after, before } from '../../render/patch';
import type { FloorLayout } from './gen';
import { BIOMES } from './biomes';
import { facetRock, crystalPrism } from './rockgeo';
import { stoneMaterial } from './stone';

type H = (x: number, z: number) => number;

let crystalMat: THREE.MeshStandardMaterial | null = null;
/** Emissive crystal: glows in its vertex colour, brighter towards the tips, with a slow shimmer. */
export function crystalMaterial(): THREE.MeshStandardMaterial {
  if (crystalMat) return crystalMat;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.05, emissive: 0xffffff, emissiveIntensity: 1, flatShading: true });
  m.name = 'mine-crystal';
  patchMaterial(m, 'mine-crystal', (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    let vs = before(shader.vertexShader, 'void main() {', 'varying vec3 vCrW;');
    vs = after(vs, '#include <project_vertex>', 'vCrW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.vertexShader = vs;
    let fs = before(shader.fragmentShader, 'void main() {', 'uniform float uTime; varying vec3 vCrW;');
    fs = after(
      fs,
      '#include <emissivemap_fragment>',
      `{
        float shimmer = 0.8 + 0.2 * sin(uTime * 1.6 + vCrW.x * 2.1 + vCrW.z * 1.7 + vCrW.y * 3.0);
        float fr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.0);
        // Per-facet value (flat normals): some faces catch the inner glow, some stay deep and
        // saturated, so a cluster reads as cut glass rather than flat petals.
        vec3 fnW = normalize(inverseTransformDirection(normal, viewMatrix));
        float facet = fract(sin(dot(floor(fnW * 3.5 + 0.5), vec3(12.9898, 78.233, 45.164))) * 43758.5453);
        float up = clamp(fnW.y, 0.0, 1.0);
        vec3 deep = vColor.rgb * vColor.rgb * 0.9;
        vec3 body = mix(deep, vColor.rgb, 0.35 + 0.65 * facet);
        float lift = smoothstep(0.0, 1.6, vCrW.y);
        totalEmissiveRadiance = body * (0.55 + 0.9 * lift) * shimmer + vColor.rgb * fr * 0.9
          + mix(vColor.rgb, vec3(1.0), 0.6) * pow(up, 6.0) * 0.55 * shimmer;
      }`,
    );
    shader.fragmentShader = fs;
  });
  crystalMat = m;
  return m;
}

let glowMat: THREE.MeshStandardMaterial | null = null;
/** Vertex-coloured emissive (mushroom caps, vent cores, ember seams). */
function glowMaterial(): THREE.MeshStandardMaterial {
  if (glowMat) return glowMat;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 1 });
  m.name = 'mine-glow';
  patchMaterial(m, 'mine-glow', (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    let fs = before(shader.fragmentShader, 'void main() {', 'uniform float uTime;');
    fs = after(fs, '#include <emissivemap_fragment>', 'totalEmissiveRadiance = vColor.rgb * (1.6 + 0.4 * sin(uTime * 2.2 + vViewPosition.x * 3.0));');
    shader.fragmentShader = fs;
  });
  glowMat = m;
  return m;
}

let rockMat: THREE.MeshStandardMaterial | null = null;
export function mineRockMaterial(): THREE.MeshStandardMaterial {
  if (!rockMat) {
    // Normals come from the geometry: soft-cut breakables blend flat + smooth, props stay faceted.
    // Procedural stone (3D noise albedo / roughness / bump) over the baked vertex colour + AO.
    rockMat = stoneMaterial(false, 0.8);
  }
  return rockMat;
}

let iceMat: THREE.MeshStandardMaterial | null = null;
function iceMaterial(): THREE.MeshStandardMaterial {
  if (!iceMat) {
    iceMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.1, emissive: 0x2a6a9a, emissiveIntensity: 0.35, flatShading: true });
    iceMat.name = 'mine-ice';
  }
  return iceMat;
}

/** Soft additive light shaft: daylight falling through the hole above the ladder. */
function shaftMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: globalUniforms.uTime, uColor: { value: color } },
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec2 vUv; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){
        float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
        float fall = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
        float streak = 0.6 + 0.4 * n(vec2(vUv.x * 7.0, vUv.y * 1.5 - uTime * 0.12));
        float motes = step(0.985, h(floor(vec2(vUv.x * 40.0, vUv.y * 60.0 + uTime * 3.0)))) * 1.5;
        float a = edge * fall * (streak + motes) * 0.22;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
}

/** Radial additive glow decal (light pool on the floor). */
export function poolMaterial(color: number, strength = 0.5): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.2) * uStrength; gl_FragColor = vec4(uColor * a, a); }`,
  });
}

/** Shared uniforms of the foreground fade (buffer height set per frame by the mine map). */
export const FG_FADE = { uFgH: { value: 1080 } };

const fgCache = new Map<THREE.Material, THREE.Material>();
/**
 * Clone of a (possibly shared library) material with its shader patches, plus a screen-space
 * dither fade over the bottom ~18 % of the frame. Cached per source material.
 */
function fgFade(src: THREE.Material): THREE.Material {
  const hit = fgCache.get(src);
  if (hit) return hit;
  const c = src.clone();
  c.name = `${src.name}+fg`;
  const patches = (src as THREE.Material & { __hvPatches?: { key: string; fn: Parameters<typeof patchMaterial>[2] }[] }).__hvPatches;
  if (patches) for (const p of patches) patchMaterial(c, p.key, p.fn);
  else if (src.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) {
    const ob = src.onBeforeCompile.bind(src);
    patchMaterial(c, `orig:${src.customProgramCacheKey()}`, (sh, r) => ob(sh, r));
  }
  patchMaterial(c, 'mine-fg-fade', (shader) => {
    shader.uniforms.uFgH = FG_FADE.uFgH;
    let fs = before(shader.fragmentShader, 'void main() {', 'uniform float uFgH;');
    fs = after(
      fs,
      '#include <clipping_planes_fragment>',
      `{
        float fgk = 1.0 - smoothstep(uFgH * 0.07, uFgH * 0.19, gl_FragCoord.y);
        float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (ign < fgk * 0.88) discard;
      }`,
    );
    shader.fragmentShader = fs;
  });
  fgCache.set(src, c);
  return c;
}

export interface MineProps {
  group: THREE.Group;
  /** Positions of ember vents (particle emitters). */
  vents: THREE.Vector3[];
  /** World anchor of the ladder-up foot, elevator door. */
  ladderUp: THREE.Vector3;
  elevator: THREE.Vector3 | null;
  dispose(): void;
}

let obsidianMat: THREE.MeshStandardMaterial | null = null;
function obsidianMaterial(): THREE.MeshStandardMaterial {
  if (!obsidianMat) {
    // Emissive floor (min ambient ≈ 0.06): obsidian keeps its silhouette out of the lantern.
    obsidianMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.14, metalness: 0.35, flatShading: true, envMapIntensity: 1.4, emissive: 0x1a1016, emissiveIntensity: 1 });
    obsidianMat.name = 'mine-obsidian';
  }
  return obsidianMat;
}

export function buildProps(L: FloorLayout, rng: Rng, heightAt: H, surfaceAt: H = heightAt): MineProps {
  const def = BIOMES[L.biome];
  const group = new THREE.Group();
  group.name = 'mine-props';
  group.userData.perfTag = 'mine-props';
  const b = new MeshBuilder();
  const glowB = new MeshBuilder();
  const crystalB = new MeshBuilder();
  const rockB = new MeshBuilder();
  const iceB = new MeshBuilder();
  const roots: THREE.Object3D[] = [];
  const vents: THREE.Vector3[] = [];
  const disposables: { dispose(): void }[] = [];
  const woodTint = L.biome === 'lava' ? 0x6a4a3a : L.biome === 'ice' ? 0xbfc8d0 : 0xd8b088;
  const wallTop = 3.0;

  const place = (g: THREE.Object3D, x: number, z: number, rot: number, s = 1): void => {
    g.position.set(x, heightAt(x, z) - 0.02, z);
    g.rotation.y = rot;
    g.scale.setScalar(s);
    group.add(g);
    roots.push(g);
  };

  // ── ladder up + daylight shaft ──────────────────────────────────
  const lx = L.ladderUp.x + 0.5;
  const lz = L.ladderUp.z + 1.02;
  const ly = heightAt(lx, lz + 0.3);
  {
    const lb = new MeshBuilder();
    const H = wallTop + 0.6;
    // Leans back onto the cliff (top towards -Z).
    const a = -0.2;
    const along = (t: number): [number, number] => [t * Math.cos(a), t * Math.sin(a)];
    for (const sx of [-1, 1]) {
      const [cy, cz] = along(H / 2);
      lb.add('woodGrain', boxUV(roundedBox(0.09, H, 0.09, 0.025), 2), mat(sx * 0.3, cy, cz, a, 0, 0), { tint: woodTint, aoWorld: (p) => 0.6 + 0.4 * THREE.MathUtils.smoothstep(p.y, 0, 0.6) });
    }
    for (let t = 0.3; t < H - 0.1; t += 0.34) {
      const [cy, cz] = along(t);
      lb.add('woodGrain', roundedBox(0.66, 0.06, 0.07, 0.02), mat(0, cy, cz + 0.02, a, 0, 0), { tint: woodTint });
    }
    place(lb.build({ name: 'ladder-up' }), lx, lz, 0);
    // Shaft of pale daylight from the hole above.
    const sh = new THREE.PlaneGeometry(1.9, 7.5, 1, 1);
    // (dimmed in the lava band: a white-hot column there read as a blown-out light card)
    const sm = shaftMaterial(new THREE.Color(L.biome === 'ice' ? 0xcfe8ff : L.biome === 'lava' ? 0x5a4a44 : 0xfff0d0));
    const shaft = new THREE.Mesh(sh, sm);
    shaft.position.set(lx, ly + 3.2, lz + 0.8);
    shaft.rotation.set(-0.35, 0, 0);
    shaft.renderOrder = 8;
    shaft.userData.noAO = true;
    group.add(shaft);
    const shaft2 = shaft.clone();
    shaft2.rotation.set(-0.35, Math.PI / 2, 0);
    shaft2.scale.set(0.8, 1, 1);
    group.add(shaft2);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.6).rotateX(-Math.PI / 2), poolMaterial(L.biome === 'ice' ? 0x9fd0ff : 0xffd7a0, 0.32));
    pool.position.set(lx, ly + 0.03, lz + 1.1);
    pool.renderOrder = 7;
    pool.userData.noAO = true;
    group.add(pool);
    disposables.push(sh, sm, pool.geometry, pool.material as THREE.Material);
  }

  // ── elevator cage ───────────────────────────────────────────────
  let elevator: THREE.Vector3 | null = null;
  if (L.elevator) {
    const ex = L.elevator.x + 0.5;
    const ez = L.elevator.z + 0.35;
    elevator = new THREE.Vector3(ex, heightAt(ex, ez + 0.6), ez + 0.6);
    const eb = new MeshBuilder();
    const Hh = 2.7;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) eb.add('woodDark', boxUV(roundedBox(0.16, Hh, 0.16, 0.035), 2), mat(sx * 0.62, Hh / 2, sz * 0.5), { tint: woodTint });
    for (const y of [0.12, Hh - 0.1]) {
      for (const sz of [-1, 1]) eb.add('woodDark', roundedBox(1.42, 0.14, 0.14, 0.03), mat(0, y, sz * 0.5), { tint: woodTint });
      for (const sx of [-1, 1]) eb.add('woodDark', roundedBox(0.14, 0.14, 1.12, 0.03), mat(sx * 0.62, y, 0), { tint: woodTint });
    }
    eb.add('wood', boxUV(roundedBox(1.2, 0.1, 0.95, 0.03), 1), mat(0, 0.1, 0), { tint: 0xc09060 });
    // Gate bars.
    for (let i = -3; i <= 3; i++) eb.add('metal', new THREE.CylinderGeometry(0.018, 0.018, 1.5, 6), mat(i * 0.16, 0.95, 0.5), { tint: 0x8a8580 });
    eb.add('metal', roundedBox(1.2, 0.05, 0.04, 0.01), mat(0, 1.7, 0.5), { tint: 0x9a948c });
    eb.add('metal', roundedBox(1.2, 0.05, 0.04, 0.01), mat(0, 0.25, 0.5), { tint: 0x9a948c });
    // Pulley wheel + cables up into the dark.
    const wheel = new THREE.TorusGeometry(0.34, 0.06, 8, 20);
    eb.add('metal', wheel, mat(0, Hh + 0.42, 0), { tint: 0xb0a898 });
    for (let k = 0; k < 6; k++) eb.add('metal', roundedBox(0.03, 0.62, 0.03, 0.01), mat(0, Hh + 0.42, 0, 0, 0, (k / 6) * Math.PI), { tint: 0x8a847a });
    eb.add('woodDark', roundedBox(1.6, 0.16, 0.18, 0.03), mat(0, Hh + 0.02, 0), { tint: woodTint });
    for (const sx of [-0.3, 0.3]) eb.add('metal', new THREE.CylinderGeometry(0.015, 0.015, 3.5, 5), mat(sx, Hh + 1.9, -0.05), { tint: 0x5a5650 });
    // Lever + brass plate with the floor number dial.
    eb.add('woodDark', roundedBox(0.2, 0.9, 0.2, 0.04), mat(0.95, 0.45, 0.35), { tint: woodTint });
    eb.add('metal', new THREE.CylinderGeometry(0.025, 0.025, 0.55, 6), mat(0.95, 1.05, 0.42, 0.5, 0, 0), { tint: 0xc0b8a8 });
    eb.add('lampGlow', new THREE.SphereGeometry(0.06, 10, 8), mat(0.95, 1.28, 0.55), { tint: 0xff6040 });
    eb.add('metal', new THREE.CylinderGeometry(0.2, 0.2, 0.04, 16), mat(0.95, 0.72, 0.46, Math.PI / 2, 0, 0), { tint: 0xd8b060 });
    const eg = eb.build({ name: 'elevator' });
    place(eg, ex, ez, 0);
    // Lantern on the cage.
    const lanB = new MeshBuilder();
    lanternInto(lanB, -0.75, 2.05, 0.55, 1.1);
    place(lanB.build({ name: 'elevator-lantern' }), ex, ez, 0);
  }

  // ── decor ───────────────────────────────────────────────────────
  for (const d of L.decor) {
    const y = heightAt(d.x, d.z);
    const r = rng;
    switch (d.kind) {
      case 'post':
      case 'lanternPost': {
        const pb = new MeshBuilder();
        const Hh = 2.5;
        pb.add('woodDark', boxUV(roundedBox(0.2, Hh, 0.2, 0.04), 2), mat(0, Hh / 2, 0, 0, 0, (r.next() - 0.5) * 0.06), { tint: woodTint, aoWorld: (p) => 0.55 + 0.45 * THREE.MathUtils.smoothstep(p.y, 0, 0.7) });
        pb.add('woodDark', boxUV(roundedBox(0.2, 0.2, 1.4, 0.04), 2), mat(0, Hh - 0.05, -0.55), { tint: woodTint });
        pb.add('woodDark', roundedBox(0.12, 0.8, 0.12, 0.03), mat(0, Hh - 0.4, -0.3, -0.7, 0, 0), { tint: woodTint });
        pb.add('metal', roundedBox(0.23, 0.05, 0.23, 0.01), mat(0, 0.5, 0), { tint: 0x6a625a });
        pb.add('metal', roundedBox(0.23, 0.05, 0.23, 0.01), mat(0, Hh - 0.35, 0), { tint: 0x6a625a });
        if (d.kind === 'lanternPost') {
          pb.add('woodDark', roundedBox(0.08, 0.08, 0.55, 0.02), mat(0, 1.95, 0.3), { tint: woodTint });
          pb.add('metal', new THREE.CylinderGeometry(0.008, 0.008, 0.16, 4), mat(0, 1.83, 0.52));
          lanternInto(pb, 0, 1.62, 0.52, 1.15);
        }
        place(pb.build({ name: d.kind }), d.x, d.z, d.rot);
        break;
      }
      case 'rail': {
        const rb = new MeshBuilder();
        // Dark iron rails with a worn, polished running surface that catches the lantern.
        for (const sz of [-0.28, 0.28]) {
          rb.add('metal', roundedBox(1.02, 0.06, 0.06, 0.015), mat(0, 0.07, sz), { tint: 0x5a524c });
          rb.add('metal', roundedBox(1.02, 0.014, 0.034, 0.005), mat(0, 0.103, sz), { tint: 0xe8e2d8 });
        }
        for (const sx of [-0.25, 0.25]) rb.add('woodDark', roundedBox(0.16, 0.06, 0.82, 0.02), mat(sx + (r.next() - 0.5) * 0.04, 0.03, 0, 0, (r.next() - 0.5) * 0.1, 0), { tint: woodTint });
        // The run never stops dead mid-floor: a timber buffer stop at one end, a rockfall at the other.
        const railAt = (x: number): boolean => L.decor.some((o) => o.kind === 'rail' && Math.abs(o.z - d.z) < 0.1 && Math.abs(o.x - x) < 0.1);
        for (const side of [-1, 1]) {
          if (railAt(d.x + side)) continue;
          const ex = side * 0.46;
          if (side > 0) {
            for (const sz of [-0.3, 0.3]) rb.add('woodGrain', roundedBox(0.16, 0.62, 0.16, 0.03), mat(ex, 0.31, sz, 0, 0, -side * 0.12), { tint: 0x8a6440 });
            rb.add('woodGrain', roundedBox(0.2, 0.2, 0.9, 0.04), mat(ex - side * 0.04, 0.5, 0), { tint: 0x9a7048 });
            rb.add('metal', roundedBox(0.06, 0.12, 0.7, 0.02), mat(ex - side * 0.14, 0.5, 0), { tint: 0x4a4440 });
            rb.add('woodDark', roundedBox(0.5, 0.06, 0.1, 0.02), mat(ex - side * 0.22, 0.2, 0, 0, 0, side * 0.7), { tint: 0x6a4a30 });
          } else {
            for (let k = 0; k < 6; k++) {
              const g = facetRock(r, 0.13 + r.next() * 0.13, def.rock[k % def.rock.length]!, { detail: 1, squash: 0.7, smooth: 0.5 });
              rockB.add(mineRockMaterial(), g, mat(d.x + ex + (r.next() - 0.5) * 0.4, y - 0.02, d.z + (r.next() - 0.5) * 0.7));
            }
          }
        }
        place(rb.build({ name: 'rail' }), d.x, d.z, 0);
        break;
      }
      case 'cart': {
        const cb = new MeshBuilder();
        const top = new THREE.CylinderGeometry(0.72, 0.52, 0.62, 4, 1, true);
        top.rotateY(Math.PI / 4);
        top.scale(1.25, 1, 0.85);
        cb.add('metal', top, mat(0, 0.62, 0), { tint: 0x6e5a4a });
        cb.add('metal', roundedBox(0.95, 0.06, 0.62, 0.02), mat(0, 0.32, 0), { tint: 0x4a403a });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const w = new THREE.CylinderGeometry(0.15, 0.15, 0.07, 12);
          w.rotateX(Math.PI / 2);
          cb.add('metal', w, mat(sx * 0.32, 0.16, sz * 0.32), { tint: 0x3a3430 });
        }
        for (const y of [0.45, 0.8]) cb.add('metal', roundedBox(1.28, 0.05, 0.92, 0.02), mat(0, y, 0, 0, 0, 0, y > 0.6 ? 1.02 : 0.85, 1, y > 0.6 ? 1.0 : 0.85), { tint: 0x9a8a72 });
        // Heap of ore.
        for (let k = 0; k < 9; k++) {
          const ore = [0xe07a3a, 0x8a7a6a, 0xc9ccd4, 0x6a5a4a][k % 4]!;
          const g = facetRock(r, 0.16 + r.next() * 0.08, ore, { detail: 0, squash: 0.8 });
          rockB.add(mineRockMaterial(), g, mat(d.x + (r.next() - 0.5) * 0.7, y + 0.78 + r.next() * 0.1, d.z + (r.next() - 0.5) * 0.45));
        }
        place(cb.build({ name: 'cart' }), d.x, d.z, 0);
        break;
      }
      case 'crate':
        place(buildCrate(), d.x, d.z, d.rot);
        break;
      case 'barrel':
        place(buildBarrel(), d.x, d.z, d.rot, 0.95);
        break;
      case 'mushrooms': {
        const n = 3 + r.int(0, 3);
        for (let k = 0; k < n; k++) {
          const a = r.next() * Math.PI * 2;
          const dd = r.next() * 0.35;
          const x = d.x + Math.cos(a) * dd;
          const z = d.z + Math.sin(a) * dd;
          const s = d.scale * (0.5 + r.next() * 0.7);
          const hh = 0.22 * s + 0.1;
          b.add('white', bevelCylinder(0.035 * s + 0.01, 0.05 * s + 0.01, hh, 0.01, 8), mat(x, heightAt(x, z), z, (r.next() - 0.5) * 0.3, 0, (r.next() - 0.5) * 0.3), { tint: 0xd8e8dc });
          const cap = new THREE.SphereGeometry(0.13 * s + 0.03, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
          cap.scale(1, 0.65, 1);
          glowB.add(glowMaterial(), cap, mat(x, heightAt(x, z) + hh, z), { tint: k % 3 === 0 ? 0x1a6a90 : 0x1c8a62 });
        }
        break;
      }
      case 'stalagmite': {
        const g = lumpySphere(0.36 * d.scale, 1, 0.25, r, 2);
        g.scale(1, 2.6 + r.next(), 1);
        g.translate(0, 0.55 * d.scale, 0);
        rockB.add(mineRockMaterial(), facetize(g, def.strata[2]!, def.strata[4]!), mat(d.x, y - 0.1, d.z, 0, d.rot, 0));
        const g2 = lumpySphere(0.2 * d.scale, 1, 0.3, r, 2);
        g2.scale(1, 2.2, 1);
        g2.translate(0, 0.3 * d.scale, 0);
        rockB.add(mineRockMaterial(), facetize(g2, def.strata[1]!, def.strata[3]!), mat(d.x + 0.3, y - 0.05, d.z + 0.15, 0, d.rot, 0.15));
        break;
      }
      case 'iceSpike': {
        const n = 3 + r.int(0, 2);
        for (let k = 0; k < n; k++) {
          const hgt = (0.9 + r.next() * 1.4) * d.scale * (k === 0 ? 1.3 : 0.8);
          const g = crystalPrism(0.16 * d.scale + r.next() * 0.08, hgt, 0.35);
          iceB.add(iceMaterial(), g, mat(d.x + (r.next() - 0.5) * 0.5, y - 0.05, d.z + (r.next() - 0.5) * 0.5, (r.next() - 0.5) * 0.5, r.next() * 6, (r.next() - 0.5) * 0.5), { tint: k === 0 ? 0xdff4ff : 0xa8d8f8 });
        }
        break;
      }
      case 'basalt': {
        const n = 3 + r.int(0, 3);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + r.next();
          const dd = k === 0 ? 0 : 0.28 + r.next() * 0.1;
          const hgt = (k === 0 ? 1.8 : 0.7 + r.next() * 0.9) * d.scale;
          const g = new THREE.CylinderGeometry(0.2, 0.22, hgt, 6, 1);
          g.translate(0, hgt / 2, 0);
          const x = d.x + Math.cos(a) * dd;
          const z = d.z + Math.sin(a) * dd;
          b.add('stone', g, mat(x, heightAt(x, z) - 0.05, z, 0, r.next(), 0), { tint: 0x3a3032, aoWorld: (p) => 0.5 + 0.5 * THREE.MathUtils.smoothstep(p.y - y, 0, 1.0) });
          const topc = new THREE.CylinderGeometry(0.2, 0.2, 0.03, 6);
          glowB.add(glowMaterial(), topc, mat(x, heightAt(x, z) + hgt - 0.03, z, 0, r.next(), 0), { tint: 0x5a1a08 });
        }
        break;
      }
      case 'vent': {
        const n = 7;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          rockB.add(mineRockMaterial(), facetRock(r, 0.2 + r.next() * 0.08, def.strata[1]!, { detail: 0, squash: 0.8 }), mat(d.x + Math.cos(a) * 0.42, y - 0.04, d.z + Math.sin(a) * 0.42, 0, r.next() * 6, 0));
        }
        const core = new THREE.CircleGeometry(0.36, 16);
        core.rotateX(-Math.PI / 2);
        glowB.add(glowMaterial(), core, mat(d.x, y + 0.05, d.z), { tint: 0xff4a0a });
        vents.push(new THREE.Vector3(d.x, y + 0.1, d.z));
        break;
      }
      case 'bones': {
        for (let k = 0; k < 4; k++) {
          const g = new THREE.CapsuleGeometry(0.025, 0.26, 3, 6);
          b.add('white', g, mat(d.x + (r.next() - 0.5) * 0.4, y + 0.03, d.z + (r.next() - 0.5) * 0.4, Math.PI / 2, r.next() * 6, 0), { tint: 0xe8dcc0 });
        }
        const skull = new THREE.SphereGeometry(0.11, 10, 8);
        skull.scale(1, 0.85, 1.15);
        b.add('white', skull, mat(d.x + 0.15, y + 0.08, d.z - 0.05, 0.3, 0.6, 0), { tint: 0xeee2c8 });
        break;
      }
      case 'icicles': {
        const n = 4 + r.int(0, 4);
        for (let k = 0; k < n; k++) {
          const len = (0.35 + r.next() * 0.9) * d.scale;
          const g = new THREE.ConeGeometry(0.05 + r.next() * 0.05, len, 5);
          g.rotateX(Math.PI);
          const x = d.x + (r.next() - 0.5) * 0.9;
          iceB.add(iceMaterial(), g, mat(x, wallTop - 0.25 - len / 2 - r.next() * 0.4, d.z - 0.28 - r.next() * 0.1), { tint: 0xe6f6ff });
        }
        break;
      }
      case 'snowdrift': {
        const g = lumpySphere(0.5 * d.scale, 1, 0.2, r, 1.5);
        g.scale(1.4, 0.35, 1);
        b.add('white', g, mat(d.x, y - 0.05, d.z, 0, d.rot, 0), { tint: 0xeaf4ff });
        break;
      }
      case 'pickStand':
        break;
    }
  }

  // ── wall dressing: every 4–6 m of camera-facing wall gets a set piece ─────
  wallDressing(L, rng.fork('walls'), heightAt, surfaceAt, { b, glowB, iceB, rockB, woodTint });
  sideDressing(L, rng.fork('side-walls'), heightAt, surfaceAt, { b, glowB, iceB, rockB, woodTint });

  // ── crystal clusters ────────────────────────────────────────────
  for (const c of L.crystals) {
    const y = heightAt(c.x, c.z);
    const n = 4 + rng.int(0, 3);
    const col = new THREE.Color(c.color);
    // Rock base the crystals burst out of.
    rockB.add(mineRockMaterial(), facetRock(rng, 0.36 * c.scale, def.strata[1]!, { chunky: true, squash: 0.6 }), mat(c.x, y - 0.08, c.z, 0, rng.next() * 6, 0));
    for (let k = 0; k < n; k++) {
      const hgt = (k === 0 ? 1.25 : 0.45 + rng.next() * 0.7) * c.scale;
      const rad = (k === 0 ? 0.15 : 0.07 + rng.next() * 0.06) * c.scale;
      const g = crystalPrism(rad, hgt, 0.3);
      // Tilt outward from the wall (local -Z is the wall).
      const a = (rng.next() - 0.5) * 1.8;
      const tilt = k === 0 ? 0.15 : 0.35 + rng.next() * 0.45;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(c.x + Math.sin(a + c.rot) * 0.15 * c.scale, y - 0.05, c.z + Math.cos(a + c.rot) * 0.15 * c.scale),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt * Math.cos(a), c.rot + rng.next() * 6, tilt * Math.sin(a))),
        new THREE.Vector3(1, 1, 1),
      );
      const tint = col.clone().offsetHSL((rng.next() - 0.5) * 0.04, 0, (rng.next() - 0.5) * 0.12);
      crystalB.add(crystalMaterial(), g, m, { tint });
    }
    // Glow pool on the floor under the cluster.
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.8 * c.scale, 2.8 * c.scale).rotateX(-Math.PI / 2), poolMaterial(c.color, 0.22));
    pool.position.set(c.x, y + 0.025, c.z + 0.3);
    pool.renderOrder = 7;
    pool.userData.noAO = true;
    group.add(pool);
    disposables.push(pool.geometry, pool.material as THREE.Material);
  }

  const built: THREE.Group[] = [];
  for (const [builder, name] of [
    [b, 'mine-decor'],
    [glowB, 'mine-glow'],
    [crystalB, 'mine-crystals'],
    [rockB, 'mine-decor-rocks'],
    [iceB, 'mine-ice'],
  ] as const) {
    const g = builder.build({ name });
    if (name === 'mine-glow' || name === 'mine-crystals') g.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = false) : 0));
    group.add(g);
    built.push(g);
  }
  // Merge every placed prop into a few meshes per material.
  const merged = mergeStaticLocal([...roots, ...built]);
  group.add(merged);
  // Foreground occluders (props at the bottom of the frame, between lens and floor, under the
  // toolbar) dither away instead of cutting into the shot.
  merged.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fgFade) : fgFade(mesh.material);
  });
  merged.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) disposables.push(m.geometry);
  });

  return {
    group,
    vents,
    ladderUp: new THREE.Vector3(lx, ly, lz + 0.55),
    elevator,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

/** Local copy of the lantern kit so the mine keeps its own emissive (always lit underground). */
function lanternInto(b: MeshBuilder, x: number, y: number, z: number, s = 1): void {
  b.add('metal', roundedBox(0.2 * s, 0.05 * s, 0.2 * s, 0.015), mat(x, y + 0.14 * s, z));
  b.add('metal', new THREE.ConeGeometry(0.15 * s, 0.1 * s, 4), mat(x, y + 0.21 * s, z, 0, Math.PI / 4, 0));
  b.add('lampGlow', roundedBox(0.13 * s, 0.2 * s, 0.13 * s, 0.02), mat(x, y + 0.02 * s, z));
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) b.add('metal', new THREE.BoxGeometry(0.02 * s, 0.24 * s, 0.02 * s), mat(x + dx * 0.075 * s, y + 0.02 * s, z + dz * 0.075 * s));
  b.add('metal', roundedBox(0.18 * s, 0.035 * s, 0.18 * s, 0.01), mat(x, y - 0.1 * s, z));
}

/** Turn a smooth lumpy blob into flat-shaded vertex-coloured rock (strata by height). */
function facetize(g: THREE.BufferGeometry, lo: number, hi: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  const pos = ng.attributes.position as THREE.BufferAttribute;
  ng.computeBoundingBox();
  const bb = ng.boundingBox!;
  const col = new Float32Array(pos.count * 3);
  const a = new THREE.Color(lo);
  const bcol = new THREE.Color(hi);
  const c = new THREE.Color();
  for (let f = 0; f < pos.count; f += 3) {
    const jit = 0.88 + ((f * 2654435761) % 1000) / 1000 * 0.22;
    for (let k = 0; k < 3; k++) {
      const i = f + k;
      const t = (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y + 1e-5);
      c.copy(a).lerp(bcol, t).multiplyScalar(jit * (0.5 + 0.5 * THREE.MathUtils.smoothstep(t, 0, 0.35)));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}

function mergeStaticLocal(roots: THREE.Object3D[]): THREE.Group {
  const g = mergeStatic(roots, 'mine-props-merged');
  for (const r of roots) r.removeFromParent();
  return g;
}

/** Ladder-down hole revealed under a broken rock: a dark pit, a rubble rim and the ladder top. */
export function buildLadderDown(biome: FloorLayout['biome'], rng: Rng): THREE.Group {
  const g = new THREE.Group();
  g.name = 'ladder-down';
  const pit = new THREE.Mesh(new THREE.CircleGeometry(0.62, 24).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {},
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.72, d); gl_FragColor = vec4(vec3(0.0), a * 0.97); }`,
  }));
  pit.position.y = 0.03;
  pit.renderOrder = 2;
  g.add(pit);
  const def = BIOMES[biome];
  const rb = new MeshBuilder();
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + rng.next() * 0.3;
    rb.add(mineRockMaterial(), facetRock(rng, 0.13 + rng.next() * 0.07, def.rock[k % def.rock.length]!, { detail: 0, squash: 0.7, cap: biome === 'ice' ? 0xf0f8ff : undefined, capAmt: 0.6 }), mat(Math.cos(a) * 0.66, 0, Math.sin(a) * 0.66, 0, rng.next() * 6, 0));
  }
  for (const sx of [-1, 1]) rb.add('woodGrain', roundedBox(0.08, 0.9, 0.08, 0.02), mat(sx * 0.24, 0.05, -0.05, 0.12, 0, 0), { tint: 0xd8b088 });
  rb.add('woodGrain', roundedBox(0.52, 0.06, 0.07, 0.02), mat(0, 0.28, 0.0, 0.12, 0, 0), { tint: 0xd8b088 });
  rb.add('woodGrain', roundedBox(0.52, 0.06, 0.07, 0.02), mat(0, -0.02, -0.03, 0.12, 0, 0), { tint: 0xd8b088 });
  g.add(rb.build({ name: 'ladder-down-kit', castShadow: true }));
  // Faint warm glow rising out of the hole (it leads deeper).
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2), poolMaterial(0xffa050, 0.18));
  glow.position.y = 0.04;
  glow.renderOrder = 3;
  g.add(glow);
  g.traverse((o) => (o.userData.noAO = true));
  return g;
}

interface Builders {
  b: MeshBuilder;
  glowB: MeshBuilder;
  iceB: MeshBuilder;
  rockB: MeshBuilder;
  woodTint: number;
}

/**
 * Side walls (facing east / west, seen obliquely): lighter dressing only, strands that follow the
 * face: roots + vines (earth), icicle fringes off the crest (ice), magma seams (lava).
 */
function sideDressing(L: FloorLayout, r: Rng, heightAt: H, surfaceAt: H, B: Builders): void {
  const W = L.w;
  const solid = (x: number, z: number): boolean => x < 0 || z < 0 || x >= W || z >= L.d || L.solid[z * W + x] === 1;
  const kept: { x: number; z: number }[] = [];
  const cands: { x: number; z: number; s: number }[] = [];
  for (let z = 3; z < L.d - 3; z++)
    for (let x = 3; x < W - 3; x++) {
      if (solid(x, z) || L.lava[z * W + x]) continue;
      if (solid(x - 1, z) && solid(x - 2, z) && solid(x - 1, z - 1) && solid(x - 1, z + 1)) cands.push({ x, z, s: -1 });
      else if (solid(x + 1, z) && solid(x + 2, z) && solid(x + 1, z - 1) && solid(x + 1, z + 1)) cands.push({ x, z, s: 1 });
    }
  r.shuffle(cands);
  for (const c of cands) {
    if (kept.length >= 7) break;
    if (kept.some((k) => Math.hypot(k.x - c.x, k.z - c.z) < 4.5)) continue;
    const xb = c.s < 0 ? c.x : c.x + 1;
    const base = heightAt(c.x + 0.5, c.z + 0.5);
    /** Face x at height y (walking from the floor into the wall). */
    const faceX = (z: number, y: number): number | null => {
      for (let k = -0.7; k < 2.4; k += 0.04) {
        const xx = xb + c.s * k;
        if (surfaceAt(xx, z) - base >= y) return xx;
      }
      return null;
    };
    const crestY = surfaceAt(xb + c.s * 1.3, c.z + 0.5) - base;
    if (crestY < 2.2) continue;
    kept.push(c);
    const n = L.biome === 'ice' ? 6 + r.int(0, 4) : 3 + r.int(0, 3);
    for (let k = 0; k < n; k++) {
      const z = c.z + 0.1 + r.next() * 0.8;
      if (L.biome === 'ice') {
        const len = 0.3 + r.next() * r.next() * 1.1;
        const yy = crestY - 0.12;
        const fx = faceX(z, Math.max(0.2, yy - len * 0.5));
        if (fx === null) continue;
        const g = new THREE.ConeGeometry(0.04 + r.next() * 0.04, len, 5);
        g.rotateX(Math.PI);
        B.iceB.add(iceMaterial(), g, mat(fx - c.s * 0.1, base + yy - len / 2, z), { tint: 0xdff2ff });
        continue;
      }
      const lava = L.biome === 'lava';
      const vine = !lava && r.next() < 0.5;
      const len = lava ? crestY - 0.3 : 0.8 + r.next() * 1.3;
      const pts: THREE.Vector3[] = [];
      let zz = z;
      for (let t = 0; t <= 1.0001; t += lava ? 0.12 : 0.2) {
        const yy = crestY - 0.05 - t * len;
        if (lava) zz += (r.next() - 0.5) * 0.25;
        const fx = faceX(zz, Math.max(0.1, yy));
        if (fx === null) break;
        pts.push(new THREE.Vector3(fx - c.s * (lava ? 0.02 : 0.05), base + yy, zz + (lava ? 0 : Math.sin(t * 5 + k) * 0.08)));
      }
      if (pts.length < 3) continue;
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, lava ? 0.03 : vine ? 0.02 : 0.032, 5, false);
      if (lava) B.glowB.add(glowMaterial(), tube, undefined, { tint: 0xff4a0c });
      else B.b.add(vine ? 'cloth' : 'bark', tube, undefined, { tint: vine ? 0x3f6a2e : 0x5a3e2a });
      if (lava) break;
    }
  }
}

/**
 * Authored-looking wall dressing along the north (camera-facing) walls, spaced 4–6 m apart:
 *  earth: timber shoring sets (posts following the rock face, cap beam, knee braces, a hanging
 *         lantern on every other one) with roots + vines trailing down the face (some vines carry
 *         tiny glow-moss beads: a cool secondary accent against the warm lantern);
 *  ice:   frost ledges (snow-capped shelves with icicle fringes) and icicle curtains off the crest;
 *  lava:  obsidian columns leaning on the face and glowing magma seams zig-zagging up the rock.
 */
function wallDressing(L: FloorLayout, r: Rng, heightAt: H, surfaceAt: H, B: Builders): void {
  const W = L.w;
  const solid = (x: number, z: number): boolean => x < 0 || z < 0 || x >= W || z >= L.d || L.solid[z * W + x] === 1;
  /** Southmost z (≤ zb + 0.6) where the shell reaches height y (the rock face at that height). */
  const faceZ = (x: number, zb: number, y: number): number | null => {
    const base = heightAt(x, zb + 0.5);
    for (let z = zb + 0.7; z > zb - 2.4; z -= 0.04) if (surfaceAt(x, z) - base >= y) return z;
    return null;
  };
  const edges: { x: number; z: number }[] = [];
  for (let z = 2; z < L.d - 2; z++)
    for (let x = 2; x < W - 2; x++) {
      if (solid(x, z) || L.lava[z * W + x] || !solid(x, z - 1)) continue;
      // Needs a real cliff: two wall tiles north and wall neighbours along the face.
      if (!solid(x, z - 2) || (!solid(x - 1, z - 1) && !solid(x + 1, z - 1))) continue;
      edges.push({ x, z });
    }
  r.shuffle(edges);
  const keep: { x: number; z: number }[] = [];
  const avoid: { x: number; z: number; r: number }[] = [
    { x: L.ladderUp.x + 0.5, z: L.ladderUp.z + 1, r: 2.2 },
    ...(L.elevator ? [{ x: L.elevator.x + 0.5, z: L.elevator.z + 0.5, r: 2.6 }] : []),
    ...L.crystals.map((c) => ({ x: c.x, z: c.z, r: 1.3 })),
    ...L.decor.filter((d) => d.kind === 'post' || d.kind === 'lanternPost').map((d) => ({ x: d.x, z: d.z, r: 1.6 })),
  ];
  const woodT = B.woodTint;
  let lanternToggle = false;
  let n = 0;
  for (const e of edges) {
    if (n >= 14) break;
    const cx = e.x + 0.5 + (r.next() - 0.5) * 0.3;
    if (keep.some((k) => Math.hypot(k.x - cx, k.z - e.z) < 4.2 + (n % 3) * 0.7)) continue;
    if (avoid.some((a) => Math.hypot(a.x - cx, a.z - (e.z + 0.5)) < a.r)) continue;
    const zb = e.z;
    const top = surfaceAt(cx, zb - 1.3) - heightAt(cx, zb + 0.5);
    if (top < 2.3) continue;
    const foot = faceZ(cx, zb, 0.2);
    const upper = faceZ(cx, zb, 2.4);
    if (foot === null || upper === null) continue;
    keep.push({ x: cx, z: zb });
    n++;
    const y0 = heightAt(cx, foot + 0.2);
    if (L.biome === 'earth') {
      const timber = n % 3 !== 0;
      if (timber) {
        // Two posts that follow the face, cap beam across, knee braces, iron straps.
        const tops: THREE.Vector3[] = [];
        for (const sx of [-0.85, 0.85]) {
          const x = cx + sx;
          const fz = faceZ(x, zb, 0.2) ?? foot;
          const tz = faceZ(x, zb, 2.5) ?? upper;
          const by = heightAt(x, fz + 0.2);
          const b0 = new THREE.Vector3(x, by - 0.05, fz + 0.16);
          const b1 = new THREE.Vector3(x, by + 2.55, tz + 0.14);
          const len = b0.distanceTo(b1);
          const th = Math.atan2(b1.z - b0.z, b1.y - b0.y);
          const mid = b0.clone().add(b1).multiplyScalar(0.5);
          B.b.add('woodDark', boxUV(roundedBox(0.2, len, 0.2, 0.04), 2), mat(mid.x, mid.y, mid.z, th, 0, (r.next() - 0.5) * 0.05), { tint: woodT, aoWorld: (p) => 0.55 + 0.45 * THREE.MathUtils.smoothstep(p.y - by, 0, 0.8) });
          B.b.add('metal', roundedBox(0.23, 0.05, 0.23, 0.01), mat(b0.x, by + 0.45, THREE.MathUtils.lerp(b0.z, b1.z, 0.18), th, 0, 0), { tint: 0x5a524a });
          tops.push(b1);
        }
        const tA = tops[0]!;
        const tB = tops[1]!;
        const bz = Math.max(tA.z, tB.z) + 0.02;
        const by = (tA.y + tB.y) / 2 + 0.08;
        B.b.add('woodDark', boxUV(roundedBox(2.15, 0.24, 0.24, 0.04), 2), mat(cx, by, bz, 0, 0, (r.next() - 0.5) * 0.04), { tint: woodT });
        for (const sx of [-1, 1]) B.b.add('woodDark', roundedBox(0.12, 0.62, 0.12, 0.03), mat(cx + sx * 0.62, by - 0.3, bz + 0.02, 0, 0, sx * 0.72), { tint: woodT });
        lanternToggle = !lanternToggle;
        if (lanternToggle) {
          B.b.add('metal', new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), mat(cx + 0.35, by - 0.27, bz + 0.16));
          lanternInto(B.b, cx + 0.35, by - 0.62, bz + 0.16, 1.05);
        }
      }
      // Roots + vines trail down the face from the crest (both kinds of set get them).
      const strands = timber ? 3 + r.int(0, 2) : 6 + r.int(0, 3);
      for (let k = 0; k < strands; k++) {
        const x = cx + (r.next() - 0.5) * (timber ? 3.2 : 2.2);
        const vine = r.next() < 0.5;
        const len = 0.8 + r.next() * (vine ? 1.6 : 1.1);
        const tt = surfaceAt(x, zb - 1.3) - y0;
        const pts: THREE.Vector3[] = [];
        for (let t = 0; t <= 1.0001; t += 0.2) {
          const yy = tt - 0.05 - t * len;
          const fz = faceZ(x, zb, Math.max(0.1, yy)) ?? foot;
          pts.push(new THREE.Vector3(x + Math.sin(t * 5 + k) * 0.08, y0 + yy, fz + 0.05 + t * 0.04));
        }
        const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, vine ? 0.02 : 0.03 + r.next() * 0.015, 5, false);
        B.b.add(vine ? 'cloth' : 'bark', tube, undefined, { tint: vine ? 0x3f6a2e : 0x5a3e2a });
        if (vine) {
          for (let q = 1; q < pts.length; q++) {
            const pp = pts[q]!;
            const leaf = new THREE.SphereGeometry(0.07, 6, 4);
            leaf.scale(1, 0.35, 0.7);
            B.b.add('cloth', leaf, mat(pp.x + (q % 2 ? 0.06 : -0.06), pp.y, pp.z + 0.03, 0.4, r.next() * 6, q % 2 ? 0.5 : -0.5), { tint: q % 3 ? 0x5a8a3a : 0x7aa04a });
          }
          if (r.next() < 0.45) {
            const pp = pts[pts.length - 1]!;
            B.glowB.add(glowMaterial(), new THREE.SphereGeometry(0.035, 8, 6), mat(pp.x, pp.y - 0.03, pp.z + 0.02), { tint: 0x3ad8b0 });
          }
        }
      }
    } else if (L.biome === 'ice') {
      // Frost ledge: a snow-capped shelf growing out of the face, icicles fringing its lip.
      const ly = 1.25 + r.next() * 0.9;
      const lz = faceZ(cx, zb, ly) ?? foot;
      const w = 1.3 + r.next() * 0.9;
      const shelf = lumpySphere(0.5, 1, 0.18, r, 2);
      shelf.scale(w, 0.28, 0.62);
      B.b.add('white', shelf, mat(cx, y0 + ly, lz + 0.1), { tint: 0xe4f0fc });
      const cap = lumpySphere(0.45, 1, 0.2, r, 2);
      cap.scale(w * 0.95, 0.16, 0.55);
      B.b.add('white', cap, mat(cx, y0 + ly + 0.1, lz + 0.08), { tint: 0xfafcff });
      const nIc = 5 + r.int(0, 4);
      for (let k = 0; k < nIc; k++) {
        const len = 0.18 + r.next() * 0.5;
        const g = new THREE.ConeGeometry(0.035 + r.next() * 0.03, len, 5);
        g.rotateX(Math.PI);
        B.iceB.add(iceMaterial(), g, mat(cx + (k / (nIc - 1) - 0.5) * w * 0.85, y0 + ly - 0.08 - len / 2, lz + 0.22 + r.next() * 0.06), { tint: 0xe6f6ff });
      }
      // Icicle curtain off the crest, following the face.
      const cN = 7 + r.int(0, 5);
      const crest = surfaceAt(cx, zb - 1.3) - y0;
      for (let k = 0; k < cN; k++) {
        const x = cx + (r.next() - 0.5) * 2.6;
        const len = 0.3 + r.next() * r.next() * 1.2;
        const yy = crest - 0.12;
        const fz = faceZ(x, zb, Math.max(0.2, yy - len * 0.5)) ?? lz;
        const g = new THREE.ConeGeometry(0.04 + r.next() * 0.04, len, 5);
        g.rotateX(Math.PI);
        B.iceB.add(iceMaterial(), g, mat(x, y0 + yy - len / 2, fz + 0.1), { tint: 0xdff2ff });
      }
    } else {
      // Obsidian columns leaning on the face + glowing magma seams climbing the rock.
      const cols = 2 + r.int(0, 2);
      for (let k = 0; k < cols; k++) {
        const x = cx + (k - (cols - 1) / 2) * 0.46 + (r.next() - 0.5) * 0.15;
        const fz = faceZ(x, zb, 0.2) ?? foot;
        const hh = 1.4 + r.next() * 1.6;
        const tz = faceZ(x, zb, hh) ?? fz;
        const by = heightAt(x, fz + 0.2);
        const g = new THREE.CylinderGeometry(0.2 + r.next() * 0.06, 0.24, hh, 6, 1);
        const col = new Float32Array(g.attributes.position!.count * 3);
        const c = new THREE.Color();
        const pa = g.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pa.count; i++) {
          const t = (pa.getY(i) + hh / 2) / hh;
          c.setHex(0x1a1420).lerp(new THREE.Color(0x3a2e44), t * 0.6);
          col.set([c.r, c.g, c.b], i * 3);
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const th = Math.atan2(tz - fz, hh);
        B.rockB.add(obsidianMaterial(), g.toNonIndexed(), mat(x, by + hh / 2 - 0.05, (fz + tz) / 2 + 0.22, th, r.next(), 0));
        const capG = new THREE.CylinderGeometry(0.21, 0.21, 0.03, 6);
        B.glowB.add(glowMaterial(), capG, mat(x, by + hh - 0.04, tz + 0.22 + Math.sin(th) * 0.02, th, r.next(), 0), { tint: 0x4a1406 });
      }
      const seams = 1 + r.int(0, 1);
      for (let k = 0; k < seams; k++) {
        const x0 = cx + (r.next() - 0.5) * 2.4;
        const crest = surfaceAt(x0, zb - 1.3) - y0;
        const pts: THREE.Vector3[] = [];
        let x = x0;
        for (let yy = 0.15; yy < crest - 0.2; yy += 0.28) {
          x += (r.next() - 0.5) * 0.28;
          const fz = faceZ(x, zb, yy) ?? foot;
          pts.push(new THREE.Vector3(x, y0 + yy, fz + 0.02));
        }
        if (pts.length < 3) continue;
        const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 3, 0.03, 4, false);
        B.glowB.add(glowMaterial(), tube, undefined, { tint: 0xff4a0c });
      }
    }
  }
}

/** Milestone treasure chest: iron-banded wood, a brass lock, and a lid that swings open. */
export function buildChest(): { group: THREE.Group; lid: THREE.Object3D; glow: THREE.Mesh } {
  const g = new THREE.Group();
  g.name = 'mine-chest';
  const body = new MeshBuilder();
  const W = 0.9;
  const Dp = 0.6;
  const H = 0.46;
  body.add('woodGrain', boxUV(roundedBox(W, H, Dp, 0.05), 1.2), mat(0, H / 2, 0), { tint: 0xb06a34, aoWorld: (p) => 0.6 + 0.4 * THREE.MathUtils.smoothstep(p.y, 0, 0.3) });
  for (const sx of [-0.3, 0.3]) body.add('metal', roundedBox(0.07, H + 0.02, Dp + 0.03, 0.015), mat(sx, H / 2, 0), { tint: 0x5a524a });
  body.add('metal', roundedBox(W + 0.03, 0.06, Dp + 0.03, 0.015), mat(0, 0.05, 0), { tint: 0x5a524a });
  body.add('metal', roundedBox(0.16, 0.18, 0.05, 0.02), mat(0, H - 0.06, Dp / 2 + 0.02), { tint: 0xe8b84a });
  g.add(body.build({ name: 'chest-body', castShadow: true }));
  // Treasure heaped inside (hidden under the domed lid until it swings open).
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc83a, roughness: 0.28, metalness: 0.85, emissive: 0x8a5a08, emissiveIntensity: 0.6 });
  gold.name = 'chest-gold';
  const tb = new MeshBuilder();
  const tr = { next: (() => {
    let t = 0.37;
    return () => (t = (t * 9301 + 0.49297) % 1);
  })() };
  for (let k = 0; k < 16; k++) {
    const a = tr.next() * Math.PI * 2;
    const d = Math.sqrt(tr.next()) * 0.28;
    tb.add(gold, new THREE.CylinderGeometry(0.055, 0.055, 0.018, 10), mat(Math.cos(a) * d * 1.3, H + 0.02 + (0.3 - d) * 0.25 + tr.next() * 0.03, Math.sin(a) * d * 0.8, (tr.next() - 0.5) * 0.8, 0, (tr.next() - 0.5) * 0.8));
  }
  tb.add(crystalMaterial(), crystalPrism(0.05, 0.16, 0.35), mat(0.16, H + 0.04, 0.05, 0.3, 0, -0.4), { tint: 0x40e0e8 });
  tb.add(crystalMaterial(), crystalPrism(0.045, 0.13, 0.35), mat(-0.2, H + 0.04, -0.05, -0.2, 0, 0.5), { tint: 0xff4a6a });
  g.add(tb.build({ name: 'chest-treasure' }));
  const lidB = new MeshBuilder();
  const lidG = new THREE.CylinderGeometry(Dp / 2, Dp / 2, W, 16, 1, false, 0, Math.PI);
  lidG.rotateZ(Math.PI / 2);
  lidG.scale(1, 0.62, 1);
  lidB.add('woodGrain', lidG, mat(0, 0, Dp / 2), { tint: 0xc07a40 });
  for (const sx of [-0.3, 0.3]) {
    const band = new THREE.CylinderGeometry(Dp / 2 + 0.015, Dp / 2 + 0.015, 0.07, 16, 1, false, 0, Math.PI);
    band.rotateZ(Math.PI / 2);
    band.scale(1, 0.62, 1);
    lidB.add('metal', band, mat(sx, 0, Dp / 2), { tint: 0x5a524a });
  }
  // Solid underside so the open lid never shows its hollow back faces.
  lidB.add('woodDark', roundedBox(W, 0.04, Dp, 0.015), mat(0, 0.02, Dp / 2), { tint: 0x7a4a26 });
  const lid = lidB.build({ name: 'chest-lid', castShadow: true });
  const hinge = new THREE.Group();
  hinge.position.set(0, H, -Dp / 2);
  hinge.add(lid);
  g.add(hinge);
  // Treasure glow spilling out when the lid opens (and a faint gleam at the seam while shut).
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, Dp * 0.8).rotateX(-Math.PI / 2), poolMaterial(0xffd070, 1.2));
  glow.position.y = H + 0.012;
  glow.renderOrder = 8;
  glow.userData.noAO = true;
  g.add(glow);
  const floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2), poolMaterial(0xffc060, 0.35));
  floorGlow.position.y = 0.03;
  floorGlow.renderOrder = 7;
  floorGlow.userData.noAO = true;
  g.add(floorGlow);
  return { group: g, lid: hinge, glow };
}
