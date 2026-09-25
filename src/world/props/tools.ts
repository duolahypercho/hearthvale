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
    // basic: forged, slightly rough iron · copper: warm satin · iron: bright steel · gold: polished.
    const rough = [0.42, 0.32, 0.26, 0.2][tier] ?? 0.3;
    m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0.6, envMapIntensity: 1.3 });
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

/** Starter watering can enamel (matches the toolbar icon). */
const CAN_PAINT = 0x3f93bd;
let enamelMat: THREE.MeshStandardMaterial | null = null;
function enamel(): THREE.MeshStandardMaterial {
  if (!enamelMat) {
    enamelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.46, metalness: 0.05 });
    enamelMat.name = 'tool-enamel';
    applyWorldFx(enamelMat, { snow: false });
  }
  return enamelMat;
}

const HANDLE = 0xa8743f;
/** Blade body colour per tier (the tint is the honed-edge colour). */
const HEAD_BODY = [0x70767e, 0xc0703c, 0xb4bec8, 0xe8b43a];

/** Tapered tube along a curve (vertex colour white; tinted by the builder). */
function neckTube(pts: THREE.Vector3[], r0: number, r1: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts);
  const segs = 10;
  const radial = 7;
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const c = curve.getPointAt(i / segs);
    const r = THREE.MathUtils.lerp(r0, r1, i / segs);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      p.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, p.x, p.y, p.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Hoe blade hanging down from the origin (top edge at y=0, cutting edge at y≈-0.155): bevelled
 * extruded trapezoid, dished along its width; vertex colours carry the forged body with hammer
 * mottling, a dark line where the bevel starts and a bright honed edge.
 */
function hoeBlade(body: THREE.Color, edge: THREE.Color): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  const tw = 0.092;
  const bw = 0.118;
  const h = 0.15;
  sh.moveTo(-tw + 0.02, 0);
  sh.lineTo(tw - 0.02, 0);
  sh.quadraticCurveTo(tw, 0, tw + 0.004, -0.02);
  sh.lineTo(bw, -h + 0.012);
  sh.quadraticCurveTo(bw, -h, bw - 0.014, -h);
  sh.lineTo(-bw + 0.014, -h);
  sh.quadraticCurveTo(-bw, -h, -bw, -h + 0.012);
  sh.lineTo(-tw - 0.004, -0.02);
  sh.quadraticCurveTo(-tw, 0, -tw + 0.02, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.006, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -0.006);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const dark = body.clone().multiplyScalar(0.42);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // Dish the blade (the cutting edge curls slightly forward) and thin it toward the edge.
    const z = pos.getZ(i) * (1 - 0.55 * THREE.MathUtils.smoothstep(-y, 0.1, h)) + (x / bw) * (x / bw) * 0.012 + THREE.MathUtils.smoothstep(-y, 0.08, h) * 0.01;
    pos.setZ(i, z);
    const d = -y; // 0 top → h edge
    if (d > h - 0.022) c.copy(edge);
    else if (d > h - 0.03) c.copy(dark);
    else {
      const mott = 0.86 + 0.14 * Math.sin(x * 210 + y * 150) * Math.sin(x * 97 - y * 230);
      c.copy(body).multiplyScalar(mott * (0.8 + 0.2 * (1 - d / h)));
    }
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
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
      const body = new THREE.Color(HEAD_BODY[tier] ?? tint);
      // Socket: a tapered ferrule clamping the handle, with a rolled collar.
      b.add(M, new THREE.CylinderGeometry(0.029, 0.036, 0.11, 12), mat(0, 0.675, 0), { tint: body.clone().multiplyScalar(0.8).getHex() });
      b.add(M, new THREE.TorusGeometry(0.033, 0.009, 6, 14), mat(0, 0.625, 0, Math.PI / 2, 0, 0), { tint: body.clone().multiplyScalar(0.7).getHex() });
      // Goose neck: a forged bar bending forward and down to the blade.
      b.add(M, neckTube([new THREE.Vector3(0, 0.72, 0), new THREE.Vector3(0, 0.765, 0.045), new THREE.Vector3(0, 0.755, 0.115), new THREE.Vector3(0, 0.705, 0.158)], 0.015, 0.012), undefined, { tint: body.clone().multiplyScalar(0.85).getHex() });
      // Blade: a bevelled, slightly dished trapezoid — dark forged body, a dark line at the bevel,
      // a bright honed cutting edge.
      b.add(M, hoeBlade(body, new THREE.Color(edge)), mat(0, 0.705, 0.165, -0.22, 0, 0));
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
      // The starter can is painted enamel (the toolbar icon's sky blue) over zinc bands and rose;
      // upgraded cans show their metal. Enamel is non-metallic, so it never reads as chrome.
      const P = tier === 0 ? enamel() : M;
      const paint = tier === 0 ? CAN_PAINT : tint;
      const band = tier === 0 ? 0x8d969e : edge;
      const body = new THREE.CylinderGeometry(0.13, 0.15, 0.24, 18, 2);
      b.add(P, body, mat(0, -0.23, -0.02), { tint: paint });
      b.add(M, new THREE.TorusGeometry(0.14, 0.016, 6, 20), mat(0, -0.11, -0.02, Math.PI / 2, 0, 0), { tint: band });
      b.add(M, new THREE.TorusGeometry(0.15, 0.016, 6, 20), mat(0, -0.35, -0.02, Math.PI / 2, 0, 0), { tint: band });
      b.add(P, new THREE.CylinderGeometry(0.1, 0.13, 0.04, 16), mat(0, -0.095, -0.02), { tint: paint });
      // Top handle arc (the grip, at the origin)
      const arc = new THREE.TorusGeometry(0.1, 0.018, 6, 14, Math.PI);
      b.add(P, arc, mat(0, -0.09, -0.02, 0, Math.PI / 2, 0), { tint: paint });
      // Spout + rose
      const spout = new THREE.CylinderGeometry(0.018, 0.03, 0.34, 8);
      b.add(P, spout, mat(0, -0.2, 0.2, 1.0, 0, 0), { tint: paint });
      b.add(M, new THREE.CylinderGeometry(0.045, 0.025, 0.04, 10), mat(0, -0.06, 0.33, 1.0, 0, 0), { tint: band });
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
