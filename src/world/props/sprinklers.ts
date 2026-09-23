/**
 * Placeable sprinklers (three tiers) with a separately rotating spray head.
 *   basic   steel dish, brass riser, 4-jet cross head
 *   brass   all brass, 8 jets, little dome cap
 *   gold    gold + teal enamel ring, 8 long jets and a finial
 * Origin = ground centre. `head` spins while spraying; `nozzle` is the jet height.
 */
import * as THREE from 'three';
import { MeshBuilder, roundedBox, bevelCylinder, mat } from '../geom';
import { applyWorldFx } from '../../render/worldfx';

let sMat: THREE.MeshStandardMaterial | null = null;
function material(): THREE.MeshStandardMaterial {
  if (!sMat) {
    sMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.5, envMapIntensity: 1.2 });
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

const TIERS = [
  { dish: 0xc8ced6, riser: 0xe0b050, head: 0xf2c860, jets: 4, ring: 0x9aa2ac },
  { dish: 0xd8a860, riser: 0xe8b860, head: 0xf5cf70, jets: 8, ring: 0xb07a3a },
  { dish: 0xf2c24a, riser: 0xf5d070, head: 0xffe08a, jets: 8, ring: 0x3aa8a0 },
];

export function buildSprinklerModel(tier: number): SprinklerModel {
  const T = TIERS[Math.max(0, Math.min(2, tier))]!;
  const M = material();
  const base = new MeshBuilder();
  base.add(M, bevelCylinder(0.17, 0.21, 0.07, 0.02, 14), undefined, { tint: T.dish });
  base.add(M, new THREE.TorusGeometry(0.19, 0.018, 6, 20), mat(0, 0.045, 0, Math.PI / 2, 0, 0), { tint: T.ring });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    base.add(M, new THREE.SphereGeometry(0.018, 6, 4), mat(Math.cos(a) * 0.14, 0.07, Math.sin(a) * 0.14), { tint: 0x8a8f96 });
  }
  base.add(M, new THREE.CylinderGeometry(0.03, 0.042, 0.24, 10), mat(0, 0.18, 0), { tint: T.riser });
  const root = base.build({ name: `sprinkler-${tier}` });
  const hb = new MeshBuilder();
  hb.add(M, new THREE.SphereGeometry(0.055, 12, 8), mat(0, 0, 0, 0, 0, 0, 1, 0.8, 1), { tint: T.head });
  for (let i = 0; i < T.jets; i++) {
    const a = (i / T.jets) * Math.PI * 2;
    const len = tier >= 2 ? 0.2 : 0.16;
    hb.add(M, roundedBox(len, 0.022, 0.03, 0.01), mat(Math.cos(a) * len * 0.5, 0.0, Math.sin(a) * len * 0.5, 0, -a, 0.22), { tint: T.head });
    hb.add(M, new THREE.CylinderGeometry(0.012, 0.016, 0.03, 6), mat(Math.cos(a) * len, 0.01, Math.sin(a) * len), { tint: 0x6a7078 });
  }
  if (tier >= 1) hb.add(M, new THREE.SphereGeometry(0.04, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0, 0.03, 0), { tint: T.head });
  if (tier >= 2) hb.add(M, new THREE.ConeGeometry(0.018, 0.08, 8), mat(0, 0.1, 0), { tint: 0xfff0b0 });
  const head = hb.build({ name: 'sprinkler-head' });
  head.position.y = 0.31;
  root.add(head);
  return { root, head, nozzle: 0.33, jets: T.jets };
}
