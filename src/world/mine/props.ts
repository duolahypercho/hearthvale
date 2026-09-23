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
    rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, flatShading: true });
    rockMat.name = 'mine-rock';
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

export interface MineProps {
  group: THREE.Group;
  /** Positions of ember vents (particle emitters). */
  vents: THREE.Vector3[];
  /** World anchor of the ladder-up foot, elevator door. */
  ladderUp: THREE.Vector3;
  elevator: THREE.Vector3 | null;
  dispose(): void;
}

export function buildProps(L: FloorLayout, rng: Rng, heightAt: H): MineProps {
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
    const sm = shaftMaterial(new THREE.Color(L.biome === 'ice' ? 0xcfe8ff : 0xfff0d0));
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
        for (const sz of [-0.28, 0.28]) rb.add('metal', roundedBox(1.02, 0.06, 0.06, 0.015), mat(0, 0.07, sz), { tint: 0x7a7068 });
        for (const sx of [-0.25, 0.25]) rb.add('woodDark', roundedBox(0.16, 0.06, 0.82, 0.02), mat(sx + (r.next() - 0.5) * 0.04, 0.03, 0, 0, (r.next() - 0.5) * 0.1, 0), { tint: woodTint });
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
          glowB.add(glowMaterial(), cap, mat(x, heightAt(x, z) + hh, z), { tint: k % 3 === 0 ? 0x4ad8ff : 0x5affc0 });
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
