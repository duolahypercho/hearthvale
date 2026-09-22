/**
 * Ground decals:
 *  - LeafLitter: ~2.2k fallen leaves (4 hues) drifted under deciduous trees and along the yard
 *    (visible in fall).
 *  - LightPools: additive warm radial glows painted on the ground under lamps / lit windows,
 *    faded in with the lamps (globalUniforms.uLamps). Makes night lighting read as pools.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { textures } from '../../render/textures';
import { applyWorldFx } from '../../render/worldfx';
import { globalUniforms } from '../../render/uniforms';

export class LeafLitter {
  readonly mesh: THREE.InstancedMesh;

  constructor(rng: Rng, spots: { x: number; z: number; r: number }[], heightAt: (x: number, z: number) => number, count = 2200) {
    const g = new THREE.CircleGeometry(0.5, 7);
    // Leaf silhouette: pointed ellipse with a slight cup.
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      pos.setXYZ(i, x * 0.62 * (1 - Math.abs(y) * 0.35), y, (x * x) * 0.25);
    }
    g.rotateX(-Math.PI / 2);
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide });
    m.name = 'leafLitter';
    applyWorldFx(m, { snowUp: 0.3, clouds: true });
    this.mesh = new THREE.InstancedMesh(g, m, count);
    this.mesh.name = 'leaf-litter';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.userData.noAO = true;
    const hues = [0xd9772a, 0xc0412c, 0xe3b03a, 0x9a5a2a];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const mtx = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      let x: number;
      let z: number;
      if (spots.length && rng.next() < 0.8) {
        const s = spots[Math.floor(rng.next() * spots.length)]!;
        const a = rng.next() * Math.PI * 2;
        const d = Math.pow(rng.next(), 0.7) * s.r * 1.35;
        x = s.x + Math.cos(a) * d + 0.8;
        z = s.z + Math.sin(a) * d * 0.8 + 0.6;
      } else {
        x = 12 + rng.next() * 42;
        z = 9 + rng.next() * 30;
      }
      const sz = 0.12 + rng.next() * 0.1;
      e.set((rng.next() - 0.5) * 0.5, rng.next() * Math.PI * 2, (rng.next() - 0.5) * 0.5);
      q.setFromEuler(e);
      mtx.compose(new THREE.Vector3(x, heightAt(x, z) + 0.025 + rng.next() * 0.02, z), q, new THREE.Vector3(sz, sz, sz));
      this.mesh.setMatrixAt(i, mtx);
      c.setHex(hues[Math.floor(rng.next() * hues.length)]!).multiplyScalar(0.8 + rng.next() * 0.35);
      this.mesh.setColorAt(i, c);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.mesh.visible = false;
  }
}

export class LightPools {
  readonly group = new THREE.Group();
  private mat: THREE.MeshBasicMaterial;

  constructor() {
    this.group.name = 'light-pools';
    this.mat = new THREE.MeshBasicMaterial({
      map: textures.softDot().map,
      color: 0xffa24a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mat.name = 'lightPool';
  }

  add(x: number, z: number, y: number, radius: number): void {
    const g = new THREE.PlaneGeometry(radius * 2, radius * 2);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, this.mat);
    m.position.set(x, y + 0.04, z);
    m.renderOrder = 3;
    m.userData.noAO = true;
    this.group.add(m);
  }

  update(): void {
    const v = globalUniforms.uLamps.value * (0.35 + 0.35 * globalUniforms.uNight.value) * (1 - 0.55 * globalUniforms.uSnow.value);
    this.mat.opacity = v;
    this.group.visible = v > 0.01;
  }
}

/** Winter-only: boot prints pressed into the snow along a trail (left/right alternating). */
export class Footprints {
  readonly mesh: THREE.InstancedMesh;

  constructor(trail: [number, number][], heightAt: (x: number, z: number) => number) {
    const g = new THREE.CircleGeometry(0.5, 12);
    g.scale(0.55, 1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({
      color: 0x7f92b8,
      roughness: 0.9,
      transparent: true,
      opacity: 0.85,
      alphaMap: textures.softDot().map,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    m.name = 'footprints';
    const pts: { x: number; z: number; a: number; side: number }[] = [];
    for (let i = 0; i < trail.length - 1; i++) {
      const [x0, z0] = trail[i]!;
      const [x1, z1] = trail[i + 1]!;
      const L = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.floor(L / 0.34));
      const a = Math.atan2(x1 - x0, z1 - z0);
      for (let k = 0; k < n; k++) {
        const t = k / n;
        pts.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, a, side: (pts.length % 2) * 2 - 1 });
      }
    }
    this.mesh = new THREE.InstancedMesh(g, m, pts.length);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    pts.forEach((p, i) => {
      const ox = Math.cos(p.a) * 0.11 * p.side;
      const oz = -Math.sin(p.a) * 0.11 * p.side;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.a);
      mtx.compose(new THREE.Vector3(p.x + ox, heightAt(p.x + ox, p.z + oz) + 0.03, p.z + oz), q, new THREE.Vector3(0.3, 1, 0.34));
      this.mesh.setMatrixAt(i, mtx);
    });
    this.mesh.name = 'footprints';
    this.mesh.renderOrder = 3;
    this.mesh.userData.noAO = true;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
  }
}
