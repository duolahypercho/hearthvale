/**
 * Loot that pops out of broken rocks and defeated monsters: little 3D items that arc out, bounce,
 * settle into a bob-and-spin with a soft glow, then get vacuumed into the player when close.
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { facetRock, crystalPrism } from './rockgeo';
import { ORE_STYLE, type OreId } from './biomes';
import { glowPoint } from './fx';

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
  mesh: THREE.Group;
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

let blob: THREE.BufferGeometry | null = null;
const ringMats = new Map<number, THREE.Material>();
let ringTex: THREE.Texture | null = null;
/** Contact shadow + a soft coloured glow ring on the floor (one texture, tinted per loot kind). */
function ringMat(color: number): THREE.Material {
  let m = ringMats.get(color);
  if (m) return m;
  if (!ringTex) {
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
  }
  m = new THREE.MeshBasicMaterial({ map: ringTex, color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.3), transparent: true, depthWrite: false, toneMapped: false });
  ringMats.set(color, m);
  return m;
}

export class Pickups {
  readonly group = new THREE.Group();
  private list: Pickup[] = [];
  private nextNet = 1;
  /** Seconds before loot starts flying to a collector / radius (tiles) that pulls it in. */
  static readonly MAGNET_DELAY = 0.5;
  static readonly MAGNET_R = 2.5;

  constructor(
    private heightAt: (x: number, z: number) => number,
    private onCollect: (id: string, qty: number, at: THREE.Vector3, collector: number, net: number) => void,
  ) {
    this.group.name = 'mine-pickups';
    this.group.userData.perfTag = 'mine-pickups';
    this.group.userData.noAO = true;
  }

  /**
   * Pop loot out of `at`: it arcs ~1.2 tiles out, bounces, bobs + spins over a glow ring, and after
   * 0.5 s flies to the nearest collector within 2.5 tiles. `net` names it (co-op: host-assigned).
   * `vel` replays a host's exact launch on a farmhand.
   */
  spawn(id: string, at: THREE.Vector3, qty = 1, power = 1, net = 0, vel?: THREE.Vector3): number {
    const vis = visualFor(id);
    const g = new THREE.Group();
    const m = new THREE.Mesh(vis.geo, vis.mat);
    // A little oversized + a soft halo: loot must read from the 17–25 m mine camera.
    m.scale.setScalar(1.3);
    g.add(m);
    blob ??= new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);
    const sh = new THREE.Mesh(blob, ringMat(haloColor(id)));
    sh.renderOrder = 1;
    sh.name = 'shadow';
    g.add(sh);
    const halo = glowPoint(haloColor(id), 0.8, 0.7);
    halo.name = 'halo';
    g.add(halo);
    this.group.add(g);
    const a = Math.random() * Math.PI * 2;
    const sp = (0.9 + Math.random() * 0.9) * power;
    const v = vel ? vel.clone() : new THREE.Vector3(Math.cos(a) * sp, 3.8 + Math.random() * 1.2, Math.sin(a) * sp);
    const n = net || this.nextNet++;
    if (net >= this.nextNet) this.nextNet = net + 1;
    this.list.push({ id, qty, mesh: g, pos: at.clone().setY(at.y + 0.35), vel: v, age: 0, rest: false, seed: Math.random() * 10, magnet: false, net: n, to: -1 });
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
    const p = this.list[i]!;
    this.drop(p);
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
        let bd = Pickups.MAGNET_R;
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
        const pull = 14 + (2.5 - Math.min(2.5, d)) * 10;
        p.vel.x += (dx / (d + 1e-4)) * pull * dt;
        p.vel.z += (dz / (d + 1e-4)) * pull * dt;
        p.vel.x *= Math.exp(-dt * 3);
        p.vel.z *= Math.exp(-dt * 3);
        p.pos.x += p.vel.x * dt;
        p.pos.z += p.vel.z * dt;
        p.pos.y += ((player.y + 0.7) - p.pos.y) * (1 - Math.exp(-dt * 8));
        if (d < 0.38 && authority) {
          this.onCollect(p.id, p.qty, p.pos.clone(), p.to, p.net);
          this.drop(p);
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
      const bob = p.rest && !p.magnet ? 0.08 + Math.sin(time * 3 + p.seed) * 0.05 : 0;
      p.mesh.position.set(p.pos.x, p.pos.y + bob, p.pos.z);
      const item = p.mesh.children[0]!;
      item.rotation.y = time * 1.8 + p.seed;
      item.rotation.x = p.rest ? 0 : p.age * 9;
      const halo = p.mesh.children[2];
      if (halo) ((halo as THREE.Points).material as THREE.PointsMaterial).size = (p.rest ? 0.85 : 0.6) * (1 + 0.18 * Math.sin(time * 4 + p.seed * 3));
      const sh = p.mesh.children[1]!;
      sh.position.y = fy - p.pos.y - bob + 0.02;
      sh.scale.setScalar(Math.max(0.3, 1 - (p.pos.y + bob - fy) * 0.8) * (p.rest ? 1 + 0.08 * Math.sin(time * 4 + p.seed) : 1));
      sh.rotation.y = -time * 0.6;
    }
  }

  private drop(p: Pickup): void {
    this.group.remove(p.mesh);
    const h = p.mesh.children[2] as THREE.Points | undefined;
    if (h) {
      h.geometry.dispose();
      (h.material as THREE.Material).dispose();
    }
  }

  clear(): void {
    for (const p of this.list) this.drop(p);
    this.list.length = 0;
  }

  get count(): number {
    return this.list.length;
  }
}
