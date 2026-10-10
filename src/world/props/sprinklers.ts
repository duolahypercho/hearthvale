/**
 * Placeable sprinklers (three tiers) with a separately rotating spray head.
 * Origin = ground centre. `head` spins while spraying; `nozzle` is the jet height.
 */
import * as THREE from 'three';
import { MeshBuilder, bevelCylinder, mat } from '../geom';
import { applyWorldFx } from '../../render/worldfx';

let sMat: THREE.MeshStandardMaterial | null = null;
function material(): THREE.MeshStandardMaterial {
  if (!sMat) {
    // (r20) Satin cast metal (mostly diffuse): the r19 0.5-metal brass read as a shiny toy.
    sMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.46, metalness: 0.32, envMapIntensity: 1.0 });
    sMat.name = 'sprinkler';
    applyWorldFx(sMat, { snowUp: 0.5 });
  }
  return sMat;
}

export interface SprinklerModel {
  root: THREE.Group;
  head: THREE.Group;
  nozzle: number;
  jets: number;
}

/**
 * (r20) Three readable silhouettes by tier (r10 critic: a brass toy with ribbon fins):
 *   0 basic    squat dark cast-iron hub on a stubby riser, 4 short up-angled nozzles with copper tips
 *   1 quality  hammered copper dome on a taller riser, 3 swan-neck arms (curved pipes), dark bands
 *   2 gold     gold turret on a teal-enamel ring, 4 long arms with ball joints + a spire finial
 */
const TIERS = [
  { dish: 0x3c4146, rim: 0x2a2e33, riser: 0x4a4f55, head: 0x50565c, tip: 0xc0743c, jets: 4, riserH: 0.2 },
  { dish: 0x8a4a28, rim: 0x5a2e18, riser: 0xa85a30, head: 0xc06a38, tip: 0x6a3a20, jets: 3, riserH: 0.26 },
  { dish: 0xd8a438, rim: 0x2f8e88, riser: 0xe6b448, head: 0xf0c050, tip: 0x8a5a18, jets: 4, riserH: 0.26 },
];

function pipe(pts: THREE.Vector3[], r: number): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, r, 6, false);
}

export function buildSprinklerModel(tier: number): SprinklerModel {
  const ti = Math.max(0, Math.min(2, tier));
  const T = TIERS[ti]!;
  const M = material();
  const base = new MeshBuilder();
  // Weighted base plate with a rolled rim and four rivets / feet.
  base.add(M, bevelCylinder(0.17, 0.21, 0.06, 0.02, 14), undefined, { tint: T.dish });
  base.add(M, new THREE.TorusGeometry(0.19, 0.02, 6, 20), mat(0, 0.04, 0, Math.PI / 2, 0, 0), { tint: T.rim });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    base.add(M, new THREE.SphereGeometry(0.02, 6, 4), mat(Math.cos(a) * 0.14, 0.065, Math.sin(a) * 0.14), { tint: T.rim });
  }
  // Riser pipe with a hex coupling nut half-way up.
  const top = 0.06 + T.riserH;
  base.add(M, new THREE.CylinderGeometry(0.026, 0.036, T.riserH, 10), mat(0, 0.06 + T.riserH / 2, 0), { tint: T.riser });
  base.add(M, new THREE.CylinderGeometry(0.042, 0.042, 0.035, 6), mat(0, 0.06 + T.riserH * 0.45, 0), { tint: T.rim });
  if (ti === 2) base.add(M, new THREE.TorusGeometry(0.05, 0.016, 6, 16), mat(0, top - 0.01, 0, Math.PI / 2, 0, 0), { tint: T.rim });
  const root = base.build({ name: `sprinkler-${tier}` });
  const hb = new MeshBuilder();
  if (ti === 0) {
    // Squat cast-iron hub: a flattened lumpy disc with a cap boss.
    hb.add(M, new THREE.CylinderGeometry(0.065, 0.075, 0.05, 12), mat(0, 0, 0), { tint: T.head });
    hb.add(M, new THREE.SphereGeometry(0.035, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0, 0.022, 0), { tint: T.rim });
    for (let i = 0; i < T.jets; i++) {
      const a = (i / T.jets) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      hb.add(M, pipe([new THREE.Vector3(c * 0.05, 0, sn * 0.05), new THREE.Vector3(c * 0.09, 0.015, sn * 0.09), new THREE.Vector3(c * 0.12, 0.04, sn * 0.12)], 0.014), undefined, { tint: T.head });
      hb.add(M, new THREE.CylinderGeometry(0.012, 0.017, 0.03, 8), mat(c * 0.124, 0.05, sn * 0.124, -sn * 0.7, 0, c * 0.7), { tint: T.tip });
    }
  } else {
    // Domed turret (copper hammered / gold) with swan-neck (copper) or long jointed (gold) arms.
    hb.add(M, new THREE.SphereGeometry(0.06, 14, 8), mat(0, 0, 0, 0, 0, 0, 1, 0.75, 1), { tint: T.head });
    hb.add(M, new THREE.TorusGeometry(0.058, 0.01, 6, 16), mat(0, -0.012, 0, Math.PI / 2, 0, 0), { tint: T.rim });
    const len = ti === 2 ? 0.21 : 0.16;
    for (let i = 0; i < T.jets; i++) {
      const a = (i / T.jets) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const pts = ti === 1
        ? [new THREE.Vector3(c * 0.05, 0.01, sn * 0.05), new THREE.Vector3(c * 0.1, 0.07, sn * 0.1), new THREE.Vector3(c * 0.15, 0.06, sn * 0.15), new THREE.Vector3(c * len, 0.03, sn * len)]
        : [new THREE.Vector3(c * 0.05, 0.0, sn * 0.05), new THREE.Vector3(c * len * 0.6, 0.02, sn * len * 0.6), new THREE.Vector3(c * len, 0.035, sn * len)];
      hb.add(M, pipe(pts, ti === 2 ? 0.012 : 0.011), undefined, { tint: T.head });
      if (ti === 2) hb.add(M, new THREE.SphereGeometry(0.019, 8, 6), mat(c * len * 0.6, 0.02, sn * len * 0.6), { tint: T.rim });
      hb.add(M, new THREE.CylinderGeometry(0.011, 0.016, 0.028, 8), mat(c * len, 0.04, sn * len, -sn * 0.9, 0, c * 0.9), { tint: T.tip });
    }
    if (ti === 1) hb.add(M, new THREE.CylinderGeometry(0.012, 0.02, 0.03, 8), mat(0, 0.05, 0), { tint: T.rim });
    if (ti === 2) {
      hb.add(M, new THREE.ConeGeometry(0.016, 0.09, 8), mat(0, 0.085, 0), { tint: 0xfff0b0 });
      hb.add(M, new THREE.SphereGeometry(0.014, 8, 6), mat(0, 0.135, 0), { tint: T.rim });
    }
  }
  const head = hb.build({ name: 'sprinkler-head' });
  head.position.y = top + 0.03;
  root.add(head);
  return { root, head, nozzle: top + 0.06, jets: T.jets };
}
