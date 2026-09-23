/**
 * Held tool meshes (the farmer's hand props), one per tool × upgrade tier.
 * Convention: origin = the grip, handle along +Y, working edge / spout towards +Z.
 * Watering can: origin at the top handle, body hangs below (-Y), spout forward (+Z).
 * Two materials per tool (wood handle, metal head tinted per tier: basic / copper / iron / gold).
 */
import * as THREE from 'three';
import { MeshBuilder, roundedBox, mat } from '../geom';
import { applyWorldFx } from '../../render/worldfx';
import { TIER_COLORS } from '../../data/crops';

let woodMat: THREE.MeshStandardMaterial | null = null;
const metalMats = new Map<number, THREE.MeshStandardMaterial>();

function wood(): THREE.MeshStandardMaterial {
  if (!woodMat) {
    woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68 });
    woodMat.name = 'tool-wood';
    applyWorldFx(woodMat, { snow: false });
  }
  return woodMat;
}

function metal(tier: number): THREE.MeshStandardMaterial {
  let m = metalMats.get(tier);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: tier === 3 ? 0.22 : 0.3, metalness: 0.55, envMapIntensity: 1.3 });
    if (tier === 3) {
      m.emissive = new THREE.Color(0x3a2a00);
      m.emissiveIntensity = 0.4;
    }
    m.name = `tool-metal-${tier}`;
    applyWorldFx(m, { snow: false });
    metalMats.set(tier, m);
  }
  return m;
}

const HANDLE = 0xa8743f;
const GRIP = 0x6a4128;
const cache = new Map<string, THREE.Group>();

function handle(b: MeshBuilder, len: number, from = -0.28): void {
  const h = new THREE.CylinderGeometry(0.024, 0.029, len, 8);
  b.add(wood(), h, mat(0, from + len / 2, 0), { tint: HANDLE });
  // Leather wrap at the grip + end knob
  b.add(wood(), new THREE.CylinderGeometry(0.033, 0.033, 0.14, 8), mat(0, 0, 0), { tint: GRIP });
  b.add(wood(), new THREE.SphereGeometry(0.036, 8, 6), mat(0, from, 0), { tint: GRIP });
}

export function buildTool(id: string, tier: number): THREE.Group {
  const key = `${id}:${tier}`;
  const hit = cache.get(key);
  if (hit) return hit.clone();
  const b = new MeshBuilder();
  const M = metal(tier);
  const tint = TIER_COLORS[Math.max(0, Math.min(3, tier)) as 0 | 1 | 2 | 3];
  const edge = new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.45).getHex();
  switch (id) {
    case 'hoe': {
      handle(b, 1.0);
      b.add(M, new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8), mat(0, 0.7, 0), { tint });
      b.add(M, roundedBox(0.05, 0.05, 0.14, 0.015), mat(0, 0.72, 0.06), { tint });
      // Blade: wide plate turned down, bright bevelled edge.
      b.add(M, roundedBox(0.24, 0.17, 0.028, 0.012), mat(0, 0.64, 0.14, -0.15, 0, 0), { tint });
      b.add(M, roundedBox(0.245, 0.03, 0.03, 0.01), mat(0, 0.56, 0.155, -0.15, 0, 0), { tint: edge });
      break;
    }
    case 'axe': {
      handle(b, 0.9);
      const head = new THREE.Shape();
      head.moveTo(-0.03, -0.05);
      head.lineTo(0.1, -0.1);
      head.quadraticCurveTo(0.2, 0, 0.1, 0.1);
      head.lineTo(-0.03, 0.05);
      head.lineTo(-0.07, 0.03);
      head.lineTo(-0.07, -0.03);
      head.closePath();
      const hg = new THREE.ExtrudeGeometry(head, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 });
      hg.translate(0, 0, -0.0225);
      hg.rotateY(-Math.PI / 2);
      b.add(M, hg, mat(0, 0.56, 0.02), { tint });
      b.add(M, roundedBox(0.03, 0.2, 0.02, 0.008), mat(0, 0.56, 0.19), { tint: edge });
      break;
    }
    case 'pickaxe': {
      handle(b, 0.92);
      // Two curved picks tapering to points (cones bent down at the tips).
      for (const s of [1, -1]) {
        const cone = new THREE.ConeGeometry(0.03, 0.28, 7, 4);
        const cp = cone.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < cp.count; i++) {
          const y = cp.getY(i) + 0.14;
          cp.setZ(i, cp.getZ(i) - y * y * 0.35);
        }
        cone.computeVertexNormals();
        b.add(M, cone, mat(0, 0.6, s * 0.15, s * Math.PI / 2, 0, 0), { tint });
      }
      b.add(M, roundedBox(0.07, 0.08, 0.08, 0.02), mat(0, 0.6, 0), { tint: new THREE.Color(tint).multiplyScalar(0.8).getHex() });
      break;
    }
    case 'scythe': {
      handle(b, 1.15, -0.35);
      b.add(wood(), new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6), mat(0.06, 0.1, 0, 0, 0, Math.PI / 2), { tint: HANDLE });
      const blade = new THREE.Shape();
      blade.moveTo(0, 0);
      blade.quadraticCurveTo(0.28, 0.12, 0.55, -0.12);
      blade.quadraticCurveTo(0.3, 0.02, 0, -0.07);
      blade.closePath();
      const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.012, bevelEnabled: false });
      bg.rotateY(-Math.PI / 2);
      b.add(M, bg, mat(0, 0.78, 0.0), { tint });
      break;
    }
    case 'wateringCan': {
      const body = new THREE.CylinderGeometry(0.13, 0.15, 0.24, 18, 2);
      b.add(M, body, mat(0, -0.23, -0.02), { tint });
      b.add(M, new THREE.TorusGeometry(0.14, 0.016, 6, 20), mat(0, -0.11, -0.02, Math.PI / 2, 0, 0), { tint: edge });
      b.add(M, new THREE.TorusGeometry(0.15, 0.016, 6, 20), mat(0, -0.35, -0.02, Math.PI / 2, 0, 0), { tint: edge });
      b.add(M, new THREE.CylinderGeometry(0.1, 0.13, 0.04, 16), mat(0, -0.095, -0.02), { tint });
      // Top handle arc (the grip, at the origin)
      const arc = new THREE.TorusGeometry(0.1, 0.018, 6, 14, Math.PI);
      b.add(M, arc, mat(0, -0.09, -0.02, 0, Math.PI / 2, 0), { tint });
      // Spout + rose
      const spout = new THREE.CylinderGeometry(0.018, 0.03, 0.34, 8);
      b.add(M, spout, mat(0, -0.2, 0.2, 1.0, 0, 0), { tint });
      b.add(M, new THREE.CylinderGeometry(0.045, 0.025, 0.04, 10), mat(0, -0.06, 0.33, 1.0, 0, 0), { tint: edge });
      break;
    }
    case 'seeds': {
      // Cloth seed pouch held in the hand.
      const g = new THREE.SphereGeometry(0.09, 10, 8);
      g.scale(1, 1.1, 0.9);
      b.add(wood(), g, mat(0, -0.04, 0.02), { tint: 0xe3c48f });
      b.add(wood(), new THREE.TorusGeometry(0.05, 0.012, 5, 12), mat(0, 0.06, 0.02, Math.PI / 2, 0, 0), { tint: 0x8a6436 });
      break;
    }
    default:
      handle(b, 0.9);
  }
  const g = b.build({ name: `tool:${key}`, castShadow: true, receiveShadow: true });
  cache.set(key, g);
  return g.clone();
}

/** World-space position of the watering can's rose (spout tip) for a can built by buildTool. */
export const CAN_SPOUT = new THREE.Vector3(0, -0.05, 0.36);
