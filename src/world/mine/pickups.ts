/**
 * Loot that pops out of broken rocks and defeated monsters: little 3D items that arc out, bounce,
 * settle into a bob-and-spin with a soft glow, then get vacuumed into the player when close.
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { facetRock, crystalPrism } from './rockgeo';
import { ORE_STYLE, type OreId } from './biomes';
import { textures } from '../../render/textures';

/** Halo colour per loot kind (gems glow their own colour, metals warm, monster drops soft). */
function haloColor(id: string): number {
  const ore = (ORE_STYLE as Record<string, (typeof ORE_STYLE)[OreId] | undefined>)[id];
  if (ore) return ore.kind === 'coal' ? 0xffd8a0 : ore.color;
  if (id === 'slimeGel') return 0x9aff7a;
  if (id === 'duskWing') return 0xd8b0ff;
  return 0xffe8c0;
}

interface Pickup {
  id: string;
  qty: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  rest: boolean;
  seed: number;
  magnet: boolean;
  /** Stable id (co-op: the host names drops so every machine removes the same one). */
  net: number;
  /** Collector the loot is flying to (-1 = none yet). */
  to: number;
}

/** Someone who can vacuum loot up (the local farmer = id 0 by convention; co-op peers by net id). */
export interface Collector {
  id: number;
  pos: THREE.Vector3;
}

const geoCache = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material }>();

function visualFor(id: string): { geo: THREE.BufferGeometry; mat: THREE.Material } {
  let v = geoCache.get(id);
  if (v) return v;
  const r = new Rng(`pickup:${id}`);
  const ore = (ORE_STYLE as Record<string, (typeof ORE_STYLE)[OreId] | undefined>)[id];
  if (ore && ore.kind === 'gem') {
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 3; k++) {
      const g = crystalPrism(0.05 + (k === 0 ? 0.03 : 0), k === 0 ? 0.3 : 0.18, 0.35);
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((k - 1) * 0.06, 0, (k % 2) * 0.04), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, (k - 1) * 0.45)), new THREE.Vector3(1, 1, 1)));
      parts.push(g);
    }
    const geo = merge(parts);
    const c = new THREE.Color(ore.color);
    v = { geo, mat: new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9 + ore.glow * 0.6, roughness: 0.1, flatShading: true }) };
  } else if (ore) {
    const geo = facetRock(r, 0.13, ore.kind === 'coal' ? 0x2a262c : ore.color, { detail: 0, squash: 0.85, rim: 0.2, facet: 0.4 });
    v = { geo, mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: ore.kind === 'coal' ? 0.35 : 0.3, metalness: ore.kind === 'coal' ? 0.2 : 0.8, flatShading: true, emissive: ore.color, emissiveIntensity: ore.kind === 'metal' ? 0.12 : 0 }) };
  } else if (id === 'slimeGel') {
    // A wobbly glossy droplet (pointed crown, round belly), translucent green with a lit core.
    const geo = new THREE.SphereGeometry(0.13, 18, 14);
    const pa = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i) / 0.13;
      const k = y > 0 ? 1 - y * y * 0.55 : 1 + y * 0.12;
      pa.setXYZ(i, pa.getX(i) * k, pa.getY(i) * (y > 0 ? 1.35 : 0.8), pa.getZ(i) * k);
    }
    geo.computeVertexNormals();
    v = { geo, mat: new THREE.MeshPhysicalMaterial({ color: 0x8ef060, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.86, emissive: 0x3fbf2a, emissiveIntensity: 0.55, sheen: 1, sheenColor: new THREE.Color(0xd8ffc0) }) };
  } else if (id === 'duskWing') {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(0.12, 0.16, 0.26, 0.06);
    s.lineTo(0.2, -0.02);
    s.quadraticCurveTo(0.14, -0.08, 0.08, -0.03);
    s.lineTo(0, 0);
    const geo = new THREE.ShapeGeometry(s, 6).rotateX(-Math.PI / 2.4);
    v = { geo, mat: new THREE.MeshStandardMaterial({ color: 0x5a4668, roughness: 0.7, side: THREE.DoubleSide }) };
  } else {
    const col = id === 'crabCarapace' ? 0xb08a60 : 0x9a9088;
    const geo = facetRock(r, 0.12, col, { detail: 0, squash: 0.8, rim: 0.3 });
    v = { geo, mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }) };
  }
  geoCache.set(id, v);
  return v;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of list) n += g.attributes.position!.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position!.array as Float32Array, o * 3);
    nor.set(g.attributes.normal!.array as Float32Array, o * 3);
    o += g.attributes.position!.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

let ringTex: THREE.Texture | null = null;
/** Contact shadow + soft glow ring texture (tinted per instance). */
function ringTexture(): THREE.Texture {
  if (ringTex) return ringTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const sh = g.createRadialGradient(32, 32, 0, 32, 32, 16);
  sh.addColorStop(0, 'rgba(0,0,0,0.55)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh;
  g.fillRect(0, 0, 64, 64);
  const ring = g.createRadialGradient(32, 32, 14, 32, 32, 31);
  ring.addColorStop(0, 'rgba(255,255,255,0)');
  ring.addColorStop(0.55, 'rgba(255,255,255,0.75)');
  ring.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = ring;
  g.fillRect(0, 0, 64, 64);
  ringTex = new THREE.CanvasTexture(c);
  return ringTex;
}

const CAP = 96;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

/** One instanced mesh per loot kind (grown on demand). */
class ItemPool {
  mesh: THREE.InstancedMesh;
  used = 0;
  constructor(
    readonly id: string,
    private parent: THREE.Object3D,
  ) {
    const v = visualFor(id);
    this.mesh = new THREE.InstancedMesh(v.geo, v.mat, 16);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.name = `pickup:${id}`;
    parent.add(this.mesh);
  }
  set(i: number, m: THREE.Matrix4): void {
    if (i >= this.mesh.instanceMatrix.count) {
      const old = this.mesh;
      const n = new THREE.InstancedMesh(old.geometry, old.material, old.instanceMatrix.count * 2);
      n.frustumCulled = false;
      n.name = old.name;
      for (let k = 0; k < old.count; k++) {
        old.getMatrixAt(k, _m);
        n.setMatrixAt(k, _m);
      }
      this.parent.remove(old);
      old.dispose();
      this.parent.add(n);
      this.mesh = n;
    }
    this.mesh.setMatrixAt(i, m);
  }
}

export class Pickups {
  readonly group = new THREE.Group();
  private list: Pickup[] = [];
  private nextNet = 1;
  /** Seconds before loot starts flying to a collector / radius (tiles) that pulls it in. */
  static readonly MAGNET_DELAY = 0.5;
  static readonly MAGNET_R = 2.5;
  /** Live pull radius (the mine-combat demo arena widens it so its farmer, who never walks, still
   * vacuums every drop instead of leaving a carpet of gel). */
  magnetR = Pickups.MAGNET_R;
  // Instanced rendering: ONE draw per loot kind + one for every ground ring + one for every halo
  // (was 3 draws per drop: a pile of monster loot blew the frame's draw-call budget).
  private pools = new Map<string, ItemPool>();
  private rings: THREE.InstancedMesh;
  private halos: THREE.Points;
  private haloPos: Float32Array;
  private haloCol: Float32Array;
  private haloSize: Float32Array;

  constructor(
    private heightAt: (x: number, z: number) => number,
    private onCollect: (id: string, qty: number, at: THREE.Vector3, collector: number, net: number) => void,
  ) {
    this.group.name = 'mine-pickups';
    this.group.userData.perfTag = 'mine-pickups';
    this.group.userData.noAO = true;
    const rg = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);
    const rm = new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, depthWrite: false, toneMapped: false });
    this.rings = new THREE.InstancedMesh(rg, rm, CAP);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 1;
    this.rings.name = 'pickup-rings';
    this.group.add(this.rings);
    const hg = new THREE.BufferGeometry();
    this.haloPos = new Float32Array(CAP * 3);
    this.haloCol = new Float32Array(CAP * 3);
    this.haloSize = new Float32Array(CAP);
    hg.setAttribute('position', new THREE.BufferAttribute(this.haloPos, 3).setUsage(THREE.DynamicDrawUsage));
    hg.setAttribute('aColor', new THREE.BufferAttribute(this.haloCol, 3).setUsage(THREE.DynamicDrawUsage));
    hg.setAttribute('aSize', new THREE.BufferAttribute(this.haloSize, 1).setUsage(THREE.DynamicDrawUsage));
    hg.setDrawRange(0, 0);
    const hm = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uMap: { value: textures.softDot().map }, uScale: { value: 1000 } },
      vertexShader: `attribute vec3 aColor; attribute float aSize; uniform float uScale; varying vec3 vC;
        void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / -mv.z; }`,
      fragmentShader: `uniform sampler2D uMap; varying vec3 vC; void main(){ float a = texture2D(uMap, gl_PointCoord).a * 0.7; gl_FragColor = vec4(vC * a, a); }`,
    });
    this.halos = new THREE.Points(hg, hm);
    this.halos.frustumCulled = false;
    this.halos.renderOrder = 9;
    this.halos.name = 'pickup-halos';
    this.group.add(this.halos);
  }

  /**
   * Pop loot out of `at`: it arcs ~1.2 tiles out, bounces, bobs + spins over a glow ring, and after
   * 0.5 s flies to the nearest collector within 2.5 tiles. `net` names it (co-op: host-assigned).
   * `vel` replays a host's exact launch on a farmhand.
   */
  spawn(id: string, at: THREE.Vector3, qty = 1, power = 1, net = 0, vel?: THREE.Vector3): number {
    if (!this.pools.has(id)) this.pools.set(id, new ItemPool(id, this.group));
    const a = Math.random() * Math.PI * 2;
    const sp = (0.9 + Math.random() * 0.9) * power;
    const v = vel ? vel.clone() : new THREE.Vector3(Math.cos(a) * sp, 3.8 + Math.random() * 1.2, Math.sin(a) * sp);
    const n = net || this.nextNet++;
    if (net >= this.nextNet) this.nextNet = net + 1;
    this.list.push({ id, qty, pos: at.clone().setY(at.y + 0.35), vel: v, age: 0, rest: false, seed: Math.random() * 10, magnet: false, net: n, to: -1 });
    return n;
  }

  /** Launch velocity of a drop (co-op: the host sends it so farmhands see the same arc). */
  launch(net: number): THREE.Vector3 | null {
    return this.list.find((p) => p.net === net)?.vel.clone() ?? null;
  }

  /** Remove a drop without collecting it (co-op: another farmer got it). Returns its position. */
  take(net: number, flyTo?: THREE.Vector3): boolean {
    const i = this.list.findIndex((p) => p.net === net);
    if (i < 0) return false;
    this.list.splice(i, 1);
    void flyTo;
    return true;
  }

  get items(): readonly { net: number; id: string; qty: number; pos: THREE.Vector3; age: number }[] {
    return this.list;
  }

  /**
   * @param collectors who can vacuum loot (nearest wins); `authority` false = a co-op farmhand:
   * loot flies to its collector visually but only the host's word (take / collect) removes it.
   */
  update(dt: number, time: number, collectors: Collector[], canCollect: boolean, authority = true): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]!;
      p.age += dt;
      const fy = this.heightAt(p.pos.x, p.pos.z);
      if (canCollect && p.age > Pickups.MAGNET_DELAY && !p.magnet) {
        let best: Collector | null = null;
        let bd = this.magnetR;
        for (const c of collectors) {
          const dd = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z);
          if (dd < bd) {
            bd = dd;
            best = c;
          }
        }
        if (best) {
          p.magnet = true;
          p.to = best.id;
        }
      }
      const target = p.magnet ? (collectors.find((c) => c.id === p.to)?.pos ?? null) : null;
      if (p.magnet && !target) {
        p.magnet = false;
        p.to = -1;
      }
      const player = target ?? p.pos;
      const dx = player.x - p.pos.x;
      const dz = player.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (p.magnet) {
        const pull = 14 + (2.5 - Math.min(2.5, d)) * 10 + Math.max(0, d - 2.5) * 6;
        p.vel.x += (dx / (d + 1e-4)) * pull * dt;
        p.vel.z += (dz / (d + 1e-4)) * pull * dt;
        p.vel.x *= Math.exp(-dt * 3);
        p.vel.z *= Math.exp(-dt * 3);
        p.pos.x += p.vel.x * dt;
        p.pos.z += p.vel.z * dt;
        p.pos.y += ((player.y + 0.7) - p.pos.y) * (1 - Math.exp(-dt * 8));
        if (d < 0.38 && authority) {
          this.onCollect(p.id, p.qty, p.pos.clone(), p.to, p.net);
          this.list.splice(i, 1);
          continue;
        }
      } else if (!p.rest) {
        p.vel.y -= 15 * dt;
        p.pos.addScaledVector(p.vel, dt);
        if (p.pos.y < fy + 0.12) {
          p.pos.y = fy + 0.12;
          if (Math.abs(p.vel.y) < 1.4) {
            p.rest = true;
            p.vel.set(0, 0, 0);
          } else {
            p.vel.y = -p.vel.y * 0.42;
            p.vel.x *= 0.6;
            p.vel.z *= 0.6;
          }
        }
      }
    }
    this.render(time);
  }

  /** Write every drop into the instanced pools (items by kind, rings, halos). */
  private render(time: number): void {
    for (const pool of this.pools.values()) pool.used = 0;
    let n = 0;
    for (const p of this.list) {
      const fy = this.heightAt(p.pos.x, p.pos.z);
      const bob = p.rest && !p.magnet ? 0.08 + Math.sin(time * 3 + p.seed) * 0.05 : 0;
      const pool = this.pools.get(p.id)!;
      _e.set(p.rest ? 0 : p.age * 9, time * 1.8 + p.seed, 0);
      _q.setFromEuler(_e);
      _s.set(p.pos.x, p.pos.y + bob, p.pos.z);
      _m.compose(_s, _q, new THREE.Vector3(1.3, 1.3, 1.3));
      pool.set(pool.used++, _m);
      if (n >= CAP) continue;
      // Ring: contact shadow + tinted glow on the floor, shrinking while the drop is in the air.
      const air = p.pos.y + bob - fy;
      const rs = Math.max(0.3, 1 - air * 0.8) * (p.rest ? 1 + 0.08 * Math.sin(time * 4 + p.seed) : 1);
      _e.set(0, -time * 0.6, 0);
      _q.setFromEuler(_e);
      _m.compose(_s.set(p.pos.x, fy + 0.02, p.pos.z), _q, new THREE.Vector3(rs, 1, rs));
      this.rings.setMatrixAt(n, _m);
      _c.setHex(haloColor(p.id)).lerp(new THREE.Color(1, 1, 1), 0.3);
      this.rings.setColorAt(n, _c);
      _c.setHex(haloColor(p.id));
      this.haloPos.set([p.pos.x, p.pos.y + bob, p.pos.z], n * 3);
      this.haloCol.set([_c.r, _c.g, _c.b], n * 3);
      this.haloSize[n] = (p.rest ? 0.85 : 0.6) * (1 + 0.18 * Math.sin(time * 4 + p.seed * 3));
      n++;
    }
    for (const pool of this.pools.values()) {
      pool.mesh.count = pool.used;
      pool.mesh.visible = pool.used > 0;
      pool.mesh.instanceMatrix.needsUpdate = true;
    }
    this.rings.count = n;
    this.rings.visible = n > 0;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    const g = this.halos.geometry;
    g.setDrawRange(0, n);
    this.halos.visible = n > 0;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.halos.material as THREE.ShaderMaterial).uniforms.uScale!.value = (typeof innerHeight === 'number' ? innerHeight : 1000) * 1.1;
  }

  clear(): void {
    this.list.length = 0;
    this.render(0);
  }

  get count(): number {
    return this.list.length;
  }
}
