/**
 * Loot that pops out of broken rocks and defeated monsters: little 3D items that arc out, bounce,
 * settle into a bob-and-spin with a soft glow, then get vacuumed into the player when close.
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { facetRock, crystalPrism } from './rockgeo';
import { ORE_STYLE, type OreId } from './biomes';

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
    const geo = new THREE.SphereGeometry(0.12, 14, 10);
    geo.scale(1, 0.75, 1);
    v = { geo, mat: new THREE.MeshPhysicalMaterial({ color: 0x7ed957, roughness: 0.12, clearcoat: 1, emissive: 0x3f9a2a, emissiveIntensity: 0.3 }) };
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
let blobMat: THREE.Material | null = null;

export class Pickups {
  readonly group = new THREE.Group();
  private list: Pickup[] = [];

  constructor(
    private heightAt: (x: number, z: number) => number,
    private onCollect: (id: string, qty: number, at: THREE.Vector3) => void,
  ) {
    this.group.name = 'mine-pickups';
    this.group.userData.perfTag = 'mine-pickups';
    this.group.userData.noAO = true;
  }

  spawn(id: string, at: THREE.Vector3, qty = 1, power = 1): void {
    const vis = visualFor(id);
    const g = new THREE.Group();
    const m = new THREE.Mesh(vis.geo, vis.mat);
    g.add(m);
    blob ??= new THREE.CircleGeometry(0.16, 14).rotateX(-Math.PI / 2);
    blobMat ??= new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
    const sh = new THREE.Mesh(blob, blobMat);
    sh.renderOrder = 1;
    sh.name = 'shadow';
    g.add(sh);
    this.group.add(g);
    const a = Math.random() * Math.PI * 2;
    const sp = (0.8 + Math.random() * 1.4) * power;
    this.list.push({ id, qty, mesh: g, pos: at.clone().setY(at.y + 0.35), vel: new THREE.Vector3(Math.cos(a) * sp, 3.6 + Math.random() * 1.5, Math.sin(a) * sp), age: 0, rest: false, seed: Math.random() * 10, magnet: false });
  }

  update(dt: number, time: number, player: THREE.Vector3, canCollect: boolean): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]!;
      p.age += dt;
      const fy = this.heightAt(p.pos.x, p.pos.z);
      const dx = player.x - p.pos.x;
      const dz = player.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (canCollect && p.age > 0.45 && d < 1.9) p.magnet = true;
      if (p.magnet) {
        const pull = 14 + (1.9 - Math.min(1.9, d)) * 10;
        p.vel.x += (dx / (d + 1e-4)) * pull * dt;
        p.vel.z += (dz / (d + 1e-4)) * pull * dt;
        p.vel.x *= Math.exp(-dt * 3);
        p.vel.z *= Math.exp(-dt * 3);
        p.pos.x += p.vel.x * dt;
        p.pos.z += p.vel.z * dt;
        p.pos.y += ((player.y + 0.7) - p.pos.y) * (1 - Math.exp(-dt * 8));
        if (d < 0.38) {
          this.onCollect(p.id, p.qty, p.pos.clone());
          this.group.remove(p.mesh);
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
      const sh = p.mesh.children[1]!;
      sh.position.y = fy - p.pos.y - bob + 0.02;
      sh.scale.setScalar(Math.max(0.3, 1 - (p.pos.y + bob - fy) * 0.8));
    }
  }

  clear(): void {
    for (const p of this.list) this.group.remove(p.mesh);
    this.list.length = 0;
  }

  get count(): number {
    return this.list.length;
  }
}
