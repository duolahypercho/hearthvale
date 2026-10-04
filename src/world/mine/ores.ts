/**
 * Breakable mine rocks: faceted stones in the biome's tints, some carrying ore — metal nuggets
 * (copper / iron / gold / coal) studding the surface or gem crystals bursting out of it.
 * Rendered through the shared BatchPool (one multi-draw per material: rock bodies, metal nuggets,
 * gem crystals), with per-rock hit wobble (squash + tilt spring) and removal on break.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { BatchPool, InstancedSet } from '../props/instanced';
import type { FloorLayout, RockSpec } from './gen';
import { BIOMES, ORE_STYLE, type Biome, type OreId } from './biomes';
import { facetRock, crystalPrism, knob } from './rockgeo';
import { patchMaterial, after, before } from '../../render/patch';
import { globalUniforms } from '../../render/uniforms';
import { crystalMaterial } from './props';
import { stoneMaterial, ORE_CODE } from './stone';

const VARIANTS = 4;
const WHITE = new THREE.Color(1, 1, 1);

let metalMat: THREE.MeshStandardMaterial | null = null;
/**
 * Ore nuggets (baked saturated vertex colours): semi-polished, a faint self-glow so the colour
 * survives the dark beyond the lantern pool, an emissive view rim that outlines each nugget
 * against its darker host rock, and slow star glints twinkling on a few up-facing facets
 * (world-anchored, so they don't crawl when the camera follows the farmer).
 */
function metalMaterial(): THREE.MeshStandardMaterial {
  if (!metalMat) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.3, emissive: 0x000000, flatShading: true });
    m.name = 'mine-ore-metal';
    patchMaterial(m, 'mine-ore-metal-v2', (shader) => {
      shader.uniforms.uTime = globalUniforms.uTime;
      let vs = before(shader.vertexShader, 'void main() {', 'varying vec3 vNugW;');
      vs = after(
        vs,
        '#include <begin_vertex>',
        `{
          vec4 nw = vec4(transformed, 1.0);
          #ifdef USE_BATCHING
            nw = batchingMatrix * nw;
          #endif
          #ifdef USE_INSTANCING
            nw = instanceMatrix * nw;
          #endif
          vNugW = (modelMatrix * nw).xyz;
        }`,
      );
      shader.vertexShader = vs;
      let fs = before(shader.fragmentShader, 'void main() {', 'uniform float uTime; varying vec3 vNugW;\nfloat hvNg(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }');
      fs = after(
        fs,
        '#include <emissivemap_fragment>',
        `{
          float fr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.0);
          vec3 vc = vColor.rgb;
          vec3 wn = normalize(inverseTransformDirection(normal, viewMatrix));
          totalEmissiveRadiance += vc * (0.16 + fr * 0.5);
          // Star glints: one candidate per ~12 cm cell, only on up-facing facets, a slow pulse.
          vec3 cell = floor(vNugW * 8.0);
          float h = hvNg(cell + 2.3);
          float tw = pow(max(0.0, sin(uTime * (0.9 + h * 1.4) + h * 40.0)), 24.0);
          totalEmissiveRadiance += mix(vc, vec3(1.0), 0.65) * step(0.62, h) * tw * smoothstep(0.35, 0.8, wn.y) * 2.4;
        }`,
      );
      shader.fragmentShader = fs;
    });
    metalMat = m;
  }
  return metalMat;
}

const COPPER = new THREE.Color(0xff8450);
const PATINA = new THREE.Color(0xffb48a);
const IRON = new THREE.Color(0xb4c8f0);
const IRON_EDGE = new THREE.Color(0xf4f8ff);
const GOLD = new THREE.Color(0xffd030);

/** Paint a merged ore geometry's vertex colours from its normals / heights. */
function paintOre(g: THREE.BufferGeometry, ore: string, r: Rng): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const col = g.attributes.color as THREE.BufferAttribute;
  const c = new THREE.Color();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nor, i);
    const y = pos.getY(i);
    const wob = Math.sin(pos.getX(i) * 31 + pos.getZ(i) * 17 + y * 23) * 0.5 + 0.5;
    // facetRock baked a per-facet value jitter into the (white) vertex colour: keep it.
    const fv = THREE.MathUtils.clamp(col.getX(i), 0.78, 1.18);
    if (ore === 'copperOre') {
      // Salmon-orange copper, its up-facing facets a paler polished peach.
      c.copy(COPPER).lerp(PATINA, THREE.MathUtils.smoothstep(n.y, 0.55, 0.95) * 0.55);
    } else if (ore === 'ironOre') {
      // Pale blue-white iron: grazing facets brighter (chipped, mirror-ish edges).
      const edge = 1 - Math.abs(n.y);
      c.copy(IRON).lerp(IRON_EDGE, THREE.MathUtils.smoothstep(edge, 0.45, 0.9) * 0.6);
    } else if (ore === 'goldOre') {
      c.copy(GOLD).multiplyScalar(0.92 + wob * 0.12);
    } else {
      c.setRGB(0.8, 0.8, 0.8).multiplyScalar(0.8 + (r.next() - 0.5) * 0.3);
    }
    c.multiplyScalar(fv);
    col.setXYZ(i, c.r, c.g, c.b);
  }
}

interface Kit {
  body: THREE.BufferGeometry[];
  big: THREE.BufferGeometry[];
  coal: THREE.BufferGeometry[];
  nuggets: Map<string, THREE.BufferGeometry>;
}

const kits = new Map<Biome, Kit>();

function nuggetGeo(r: Rng, kind: 'metal' | 'gem' | 'coal', radius: number, big: boolean, ore = ''): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const R = radius * (big ? 1.3 : 1);
  if (kind === 'gem') {
    // One chunky crystal cluster bursting from a crack on top (a hero prism + stubby satellites)
    // and two small shards on the flanks, so the rock reads as "gem" from any angle.
    const base = new THREE.Vector3((r.next() - 0.5) * R * 0.3, R * 0.52, (r.next() - 0.5) * R * 0.3);
    const cl = 5;
    for (let k = 0; k < cl; k++) {
      const hero = k === 0;
      const a = (k / cl) * Math.PI * 2 + r.next() * 0.7;
      const tilt = hero ? 0.12 + r.next() * 0.15 : 0.45 + r.next() * 0.35;
      const hgt = (hero ? 1.15 + r.next() * 0.25 : 0.5 + r.next() * 0.35) * R;
      const g = crystalPrism((hero ? 0.155 : 0.09 + r.next() * 0.04) * (R / 0.44), hgt, hero ? 0.3 : 0.38);
      const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.next() * 6));
      const p = base.clone().add(new THREE.Vector3(Math.cos(a) * R * 0.1, -R * 0.08, Math.sin(a) * R * 0.1));
      g.applyMatrix4(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
      parts.push(g);
    }
    for (let k = 0; k < 2; k++) {
      const a = r.next() * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(a) * 0.8, 0.6, Math.sin(a) * 0.8).normalize();
      const g = crystalPrism(0.05 * (R / 0.44), R * (0.3 + r.next() * 0.15), 0.4);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const p = new THREE.Vector3(Math.cos(a) * R * 0.72, R * 0.22, Math.sin(a) * R * 0.72);
      g.applyMatrix4(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
      parts.push(g);
    }
  } else if (kind === 'coal') {
    // Coal: a band of big glossy black chunks breaking out of a darker rock (a seam, not spots).
    const a0 = r.next() * Math.PI * 2;
    const n = 5;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const el = 0.2 + Math.sin(t * Math.PI) * 0.75;
      const az = a0 + (t - 0.5) * 2.2;
      const g = facetRock(r, R * (0.24 + r.next() * 0.1), 0xffffff, { detail: 0, squash: 0.6, chunky: true, rim: 0.15, facet: 0.7 });
      const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      const p = dir.clone().multiply(new THREE.Vector3(R * 0.78, R * 0.56, R * 0.78)).add(new THREE.Vector3(0, R * 0.16, 0));
      g.applyMatrix4(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(r.next() * 6, r.next() * 6, 0)), new THREE.Vector3(1, 1, 1)));
      parts.push(g);
    }
  } else {
    // Metal ores: 5–8 raised, faceted NUGGETS studding the rock's crown and flanks in the ore's
    // own saturated colour (copper salmon-orange, iron pale blue-white, gold yellow): the ore type
    // reads from across the hall, like a sprite with clear colour specks. Nuggets sit half proud
    // of the surface (they cast tiny shadows and catch the lantern on their facets).
    const n = ore === 'goldOre' ? 8 : ore === 'ironOre' ? 6 : 7;
    const a0 = r.next() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      // Spread round the rock (golden-angle azimuths), biased to the camera-facing upper half.
      const az = a0 + k * 2.39996 + (r.next() - 0.5) * 0.5;
      const el = 0.28 + r.next() * 0.95;
      const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      const p = dir.clone().multiply(new THREE.Vector3(R * 0.86, R * 0.6, R * 0.86)).add(new THREE.Vector3(0, R * 0.17, 0));
      const hero = k === 0;
      const rad = R * (ore === 'goldOre' ? (hero ? 0.2 : 0.1 + r.next() * 0.06) : ore === 'ironOre' ? (hero ? 0.24 : 0.14 + r.next() * 0.06) : hero ? 0.22 : 0.12 + r.next() * 0.06);
      let g = facetRock(r, rad, 0xffffff, { detail: 0, squash: ore === 'ironOre' ? 0.55 : 0.75, chunky: true, rim: 0, facet: 0.45 });
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().lerp(new THREE.Vector3(0, 1, 0), 0.3).normalize());
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.next() * 6));
      g.applyMatrix4(new THREE.Matrix4().compose(p.addScaledVector(dir, rad * 0.25), q, new THREE.Vector3(1, 1, 1)));
      if (g.index) g = g.toNonIndexed();
      parts.push(g);
    }
  }
  const out = mergeNonIndexed(parts);
  if (kind === 'metal') {
    paintOre(out, ore, r);
    return out;
  }
  // Gems / coal take their colour from the instance: keep vertex colour a bright neutral.
  const col = out.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < col.count; i++) {
    const v = kind === 'gem' ? 1 : 0.8 + (col.getX(i) - 0.5) * 0.4;
    col.setXYZ(i, v, v, v);
  }
  return out;
}

function kitFor(biome: Biome, r: Rng): Kit {
  let k = kits.get(biome);
  if (k) return k;
  const def = BIOMES[biome];
  const cap = biome === 'ice' ? 0xf4faff : biome === 'lava' ? 0x6e3024 : undefined;
  const capAmt = biome === 'ice' ? 0.28 : 0.35;
  k = { body: [], big: [], coal: [], nuggets: new Map() };
  // Soft boulders with a few crisp cleaved faces (hard-creased planes + worn edges): defined,
  // hand-cut silhouettes instead of smooth potatoes.
  const soft = { detail: 2, smooth: 0.62, lumps: 0.16, crevice: 0.55, cleave: true };
  for (let v = 0; v < VARIANTS; v++) k.body.push(facetRock(r, 0.44, def.rock[v % def.rock.length]!, { ...soft, chunky: v % 2 === 1, squash: 0.74, cap, capAmt, rim: 0.5 }));
  const dark = new THREE.Color(def.rock[0]!).multiplyScalar(biome === 'ice' ? 0.55 : 0.5).getHex();
  for (let v = 0; v < VARIANTS; v++) k.coal.push(facetRock(r, 0.44, dark, { ...soft, chunky: v % 2 === 0, squash: 0.72, cap, capAmt: capAmt * 0.2, rim: 0.55 }));
  for (let v = 0; v < 2; v++) k.big.push(facetRock(r, 0.62, def.rock[v]!, { ...soft, chunky: true, squash: 0.8, cap, capAmt, rim: 0.55 }));
  kits.set(biome, k);
  return k;
}

export interface MineRock {
  spec: RockSpec;
  set: InstancedSet;
  id: number;
  hp: number;
  base: THREE.Matrix4;
  pos: THREE.Vector3;
  rot: number;
  scale: number;
  wobble: number;
  /** 0..1 white hit flash (instance colour on the body). */
  flash: number;
  alive: boolean;
  /** Per-rock non-uniform silhouette scale (x, y, z) and body tone. */
  shape: THREE.Vector3;
  tint: THREE.Color;
}

export class RockField {
  readonly group = new THREE.Group();
  readonly rocks: MineRock[] = [];
  private pool = new BatchPool('mine-rocks');
  private sets = new Map<string, InstancedSet>();
  private byTile = new Map<number, MineRock>();
  private wobbling = new Set<MineRock>();
  private m = new THREE.Matrix4();
  private fc = new THREE.Color();

  constructor(private L: FloorLayout, rng: Rng, heightAt: (x: number, z: number) => number) {
    this.group.name = 'mine-rocks';
    this.group.userData.perfTag = 'mine-rocks';
    this.group.add(this.pool.group);
    const kit = kitFor(L.biome, rng.fork('kit'));
    for (const s of L.rocks) {
      const r = rngFrom(s.seed);
      const variant = s.seed % (s.big ? 2 : VARIANTS);
      const ore = s.ore;
      const style = ore ? ORE_STYLE[ore] : null;
      const key = `${s.big ? 'B' : 'r'}${variant}:${style?.kind === 'metal' ? ore : (style?.kind ?? '-')}`;
      let set = this.sets.get(key);
      if (!set) {
        const body = withOre((s.big ? kit.big : style?.kind === 'coal' ? kit.coal : kit.body)[variant]!, ore);
        const parts: { geometry: THREE.BufferGeometry; material: THREE.Material; tinted?: boolean }[] = [{ geometry: body, material: stoneMaterial(true, 1, L.biome === 'ice'), tinted: true }];
        // Ore breaks out of the (darker, desaturated) host rock as nuggets / crystals / coal.
        if (style) {
          const nk = `${key}`;
          let ng = kit.nuggets.get(nk);
          if (!ng) {
            ng = nuggetGeo(rngFrom(variant * 31 + (s.big ? 7 : 0) + (ore?.length ?? 0) * 13), style.kind, s.big ? 0.62 : 0.44, s.big, ore ?? '');
            // Bake the ore colour (the instance colour belongs to the body: hit flash).
            if (style.kind !== 'metal') {
              const oc = oreColor(ore!);
              const ca = ng.attributes.color as THREE.BufferAttribute;
              for (let i = 0; i < ca.count; i++) ca.setXYZ(i, ca.getX(i) * oc.r, ca.getY(i) * oc.g, ca.getZ(i) * oc.b);
            }
            kit.nuggets.set(nk, ng);
          }
          parts.push({ geometry: ng, material: style.kind === 'gem' ? crystalMaterial() : metalMaterial(), tinted: false, castShadow: style.kind !== 'gem' } as never);
        }
        set = new InstancedSet(key, parts, this.pool);
        this.sets.set(key, set);
      }
      // Natural scatter: ±0.3 m off the tile centre, any yaw, 0.75–1.25 scale (ore / big a bit larger).
      const x = s.x + 0.5 + (r.next() - 0.5) * 0.6;
      const z = s.z + 0.5 + (r.next() - 0.5) * 0.6;
      const pos = new THREE.Vector3(x, heightAt(x, z) - 0.03, z);
      const rot = r.next() * Math.PI * 2;
      const scale = (0.75 + r.next() * 0.5) * (s.ore ? 1.25 : 1);
      // Silhouette + value variety (drawn after the placement draws, so layouts are unchanged):
      // plain stones become low slabs, tall knuckles or squat lumps; every rock gets its own
      // tone, so a field of them stops reading as one potato stamped 90 times.
      const kind = s.ore ? 3 : Math.floor(r.next() * 3);
      const j = (): number => 0.92 + r.next() * 0.16;
      const shape = kind === 0 ? new THREE.Vector3(1.22 * j(), 0.7 * j(), 1.05 * j()) : kind === 1 ? new THREE.Vector3(0.84 * j(), 1.24 * j(), 0.9 * j()) : new THREE.Vector3(j(), j(), j());
      const v = s.ore ? 0.74 + r.next() * 0.08 : 0.8 + r.next() * 0.3;
      const w = (r.next() - 0.5) * 0.08;
      const tint = new THREE.Color(v * (1 + w), v, v * (1 - w));
      const base = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), shape.clone().multiplyScalar(scale));
      const id = set.add(base, tint);
      const rock: MineRock = { spec: s, set, id, hp: s.hp, base, pos, rot, scale, wobble: 0, flash: 0, alive: true, shape, tint };
      this.rocks.push(rock);
      this.byTile.set(s.z * L.w + s.x, rock);
    }
    for (const mesh of this.pool.meshes) mesh.userData.perfTag = 'mine-rocks';
    // Rubble skirt: 1–3 small pebbles around each rock so clusters read as scree, not a grid.
    const pr = rngFrom((L.floor * 7919) ^ 0x5bd1);
    const pebs: THREE.BufferGeometry[] = [];
    const def = BIOMES[L.biome];
    const pcap = L.biome === 'ice' ? 0xf4faff : undefined;
    for (const rk of this.rocks) {
      const n = pr.int(0, 3);
      for (let k = 0; k < n; k++) {
        const a = pr.next() * Math.PI * 2;
        const d = 0.38 + pr.next() * 0.35;
        const px = rk.pos.x + Math.cos(a) * d * rk.scale;
        const pz = rk.pos.z + Math.sin(a) * d * rk.scale;
        const rad = 0.05 + pr.next() * pr.next() * 0.1;
        const g = facetRock(pr, rad, def.rock[pr.int(0, def.rock.length - 1)]!, { detail: 0, squash: 0.6, cap: pcap, capAmt: 0.7, rim: 0.4 });
        g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(px, heightAt(px, pz) - 0.015, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, pr.next() * 6, 0)), new THREE.Vector3(1, 1, 1)));
        pebs.push(g);
      }
    }
    if (pebs.length) {
      const pm = new THREE.Mesh(mergeNonIndexed(pebs), stoneMaterial(false));
      pm.name = 'mine-rubble';
      pm.castShadow = false;
      pm.receiveShadow = true;
      pm.userData.perfTag = 'mine-rocks';
      this.rubble = pm;
      this.group.add(pm);
    }
    this.buildPools(L);
  }

  private rubble: THREE.Mesh | null = null;
  /** Ore-coloured light pools under ore rocks (one instanced additive draw). */
  private pools: THREE.InstancedMesh | null = null;
  private poolOf = new Map<MineRock, number>();

  private buildPools(L: FloorLayout): void {
    const ores = this.rocks.filter((r) => r.spec.ore);
    if (!ores.length) return;
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: globalUniforms.uTime, uGain: { value: L.biome === 'ice' ? 0.55 : L.biome === 'lava' ? 0.6 : 0.85 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vC; varying float vPh;
        void main() {
          vUv = uv - 0.5;
          vC = instanceColor;
          vPh = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 0.9;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uGain;
        varying vec2 vUv; varying vec3 vC; varying float vPh;
        void main() {
          float d = length(vUv) * 2.0;
          float a = pow(max(0.0, 1.0 - d), 2.2) * (0.85 + 0.15 * sin(uTime * 1.6 + vPh)) * uGain * 0.32;
          gl_FragColor = vec4(vC * a, a);
        }`,
    });
    const im = new THREE.InstancedMesh(g, m, ores.length);
    im.name = 'mine-ore-pools';
    im.userData.perfTag = 'mine-rocks';
    im.userData.noAO = true;
    im.renderOrder = 2;
    im.frustumCulled = false;
    const mt = new THREE.Matrix4();
    ores.forEach((rk, i) => {
      const sz = 1.9 * rk.scale;
      mt.compose(rk.pos.clone().setY(rk.pos.y + 0.06), new THREE.Quaternion(), new THREE.Vector3(sz, 1, sz));
      im.setMatrixAt(i, mt);
      im.setColorAt(i, oreColor(rk.spec.ore!).clone().multiplyScalar(ORE_STYLE[rk.spec.ore!].kind === 'gem' ? 1.1 : 1));
      this.poolOf.set(rk, i);
    });
    this.pools = im;
    this.group.add(im);
  }

  at(x: number, z: number): MineRock | undefined {
    const r = this.byTile.get(z * this.L.w + x);
    return r?.alive ? r : undefined;
  }

  /** Visual hit reaction. */
  hit(rock: MineRock): void {
    rock.wobble = 1;
    rock.flash = 1;
    this.wobbling.add(rock);
  }

  remove(rock: MineRock): void {
    if (!rock.alive) return;
    rock.alive = false;
    rock.set.remove(rock.id);
    this.wobbling.delete(rock);
    const pi = this.poolOf.get(rock);
    if (pi !== undefined && this.pools) {
      this.pools.setMatrixAt(pi, new THREE.Matrix4().makeScale(0, 0, 0));
      this.pools.instanceMatrix.needsUpdate = true;
    }
  }

  get remaining(): number {
    let n = 0;
    for (const r of this.rocks) if (r.alive) n++;
    return n;
  }

  update(dt: number): void {
    for (const r of this.wobbling) {
      r.wobble = Math.max(0, r.wobble - dt * 3.2);
      const t = 1 - r.wobble;
      // 0.08 s hard squash on the impact, then a ringing wobble.
      const hitSq = t < 0.26 ? Math.sin((t / 0.26) * Math.PI) : 0;
      const k = Math.sin(t * Math.PI * 3.5) * r.wobble * (t < 0.26 ? 0.3 : 1) + hitSq * 0.9;
      const sy = 1 - k * 0.14;
      const sxz = 1 + k * 0.08;
      if (r.flash > 0) {
        r.flash = Math.max(0, r.flash - dt / 0.09);
        this.fc.copy(r.tint).multiplyScalar(1 + r.flash * r.flash * 3.2);
        r.set.setColor(r.id, this.fc);
      }
      this.m.compose(
        r.pos,
        new THREE.Quaternion().setFromEuler(new THREE.Euler(k * 0.12, r.rot, -k * 0.1)),
        new THREE.Vector3(r.scale * sxz * r.shape.x, r.scale * sy * r.shape.y, r.scale * sxz * r.shape.z),
      );
      r.set.setMatrix(r.id, r.wobble > 0 ? this.m : r.base);
      if (r.wobble <= 0) this.wobbling.delete(r);
    }
  }

  dispose(): void {
    for (const m of this.pool.meshes) m.dispose();
    this.rubble?.geometry.dispose();
    this.pools?.geometry.dispose();
    (this.pools?.material as THREE.Material | undefined)?.dispose();
  }
}

export function oreColor(ore: OreId): THREE.Color {
  const st = ORE_STYLE[ore];
  const c = new THREE.Color(st.color);
  if (st.kind === 'gem') c.multiplyScalar(0.55 + st.glow * 0.45);
  return c;
}

function rngFrom(seed: number): Rng {
  // Local tiny RNG with the same interface subset (deterministic per rock).
  let s = (seed * 2654435761) >>> 0 || 1;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a: number, b: number) => a + (b - a) * next(),
    int: (a: number, b: number) => Math.floor(a + (b - a + 1) * next()),
    chance: (p: number) => next() < p,
    pick: <T>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)]!,
  } as unknown as Rng;
}

function mergeNonIndexed(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ['position', 'normal', 'uv', 'color'];
  let count = 0;
  for (const g of list) count += g.attributes.position!.count;
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = n === 'uv' ? 2 : 3;
    const arr = new Float32Array(count * size);
    let o = 0;
    for (const g of list) {
      let a = g.attributes[n] as THREE.BufferAttribute | undefined;
      if (!a) {
        a = new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count * size).fill(n === 'color' ? 1 : 0), size);
      }
      arr.set(a.array as Float32Array, o);
      o += a.count * size;
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

const bodyCache = new Map<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();
/** Body geometry carrying the ore (colour + kind) per vertex for the vein shader (cached). */
function withOre(g: THREE.BufferGeometry, ore: OreId | null): THREE.BufferGeometry {
  let per = bodyCache.get(g);
  if (!per) bodyCache.set(g, (per = new Map()));
  const k = ore ?? '-';
  let out = per.get(k);
  if (out) return out;
  out = g.clone();
  const st = ore ? ORE_STYLE[ore] : null;
  // Metal ores: the host rock only carries a few coloured flecks (the nuggets are geometry).
  const code = !ore ? ORE_CODE.none : st?.kind === 'metal' || ore === 'coal' ? ORE_CODE.host : ORE_CODE.gem;
  const c = new THREE.Color(st ? st.color : 0x000000);
  const n = out.attributes.position!.count;
  const a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b, code], i * 4);
  out.setAttribute('aOre', new THREE.BufferAttribute(a, 4));
  per.set(k, out);
  return out;
}
