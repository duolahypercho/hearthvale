/**
 * Seasonal forageables in Cindergrove. Every morning ~10 fresh finds appear at seeded spots on
 * the forest floor (never on paths / water): spring leeks, morels and violets; summer berries,
 * fiddleheads and sweet peas; autumn chanterelles, hazelnuts and ember caps; winter snow roots,
 * frost holly and crystal cones. Interact (right click / X) to pick: item + a little burst.
 * Visuals are batched instanced sets (one draw per material). Item defs are registered here.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { Rng as RngClass } from '../../core/rng';
import type { Season } from '../../core/time';
import { MeshBuilder, mat, lumpySphere } from '../geom';
import { applyWorldFx } from '../../render/worldfx';
import { applyPlantLighting } from '../../render/foliage';
import { InstancedSet, type BatchPool, type InstancedPart } from '../props/instanced';
import { ITEMS, type ItemDef } from '../../data/items';

export interface ForageDef {
  id: string;
  name: string;
  season: Season;
  sell: number;
  color: number;
  blurb: string;
}

export const FOREST_FORAGE: ForageDef[] = [
  { id: 'wildLeek', name: 'Wild Leek', season: 'spring', sell: 60, color: 0x9fd07a, blurb: 'Pungent and sweet. Grows where the stream mist settles.' },
  { id: 'morel', name: 'Morel', season: 'spring', sell: 150, color: 0xa8845a, blurb: 'A honeycombed prize from the damp roots of old elders.' },
  { id: 'duskViolet', name: 'Dusk Violet', season: 'spring', sell: 45, color: 0x9a6ad8, blurb: 'Smells faintly of rain on warm stone.' },
  { id: 'hedgeBerry', name: 'Hedge Berry', season: 'summer', sell: 50, color: 0xd8344a, blurb: 'Tart little berries the jays fight over.' },
  { id: 'fiddlehead', name: 'Fiddlehead', season: 'summer', sell: 90, color: 0x6fae45, blurb: 'A young fern still curled like a sleeping snail.' },
  { id: 'sweetPea', name: 'Sweet Pea', season: 'summer', sell: 50, color: 0xf29ac0, blurb: 'Frilly and fragrant. Villagers love it on the table.' },
  { id: 'chanterelle', name: 'Chanterelle', season: 'fall', sell: 160, color: 0xf0a83a, blurb: 'Golden, apricot-scented and worth the hunt.' },
  { id: 'hazelnut', name: 'Hazelnut', season: 'fall', sell: 90, color: 0x9a6a3a, blurb: 'Rattles in its husk when shaken.' },
  { id: 'emberCap', name: 'Ember Cap', season: 'fall', sell: 120, color: 0xe0502a, blurb: 'Glossy red caps said to grow where the old fire slept.' },
  { id: 'snowRoot', name: 'Snow Root', season: 'winter', sell: 70, color: 0xe8dcc8, blurb: 'Crisp, peppery root dug from under the frost.' },
  { id: 'frostHolly', name: 'Frost Holly', season: 'winter', sell: 80, color: 0x3f8a4a, blurb: 'Glossy leaves, blood-red berries, a rime of ice.' },
  { id: 'crystalCone', name: 'Crystal Cone', season: 'winter', sell: 110, color: 0xbfe0f0, blurb: 'A fir cone glazed in clear ice. It chimes when tapped.' },
];

// Register item defs (kind 'forage': the UI paints a keyword / kind icon for them).
for (const f of FOREST_FORAGE) {
  if (!ITEMS[f.id]) ITEMS[f.id] = { id: f.id, name: f.name, kind: 'forage', icon: f.id, sell: f.sell, stack: 999, color: f.color, description: f.blurb } as ItemDef;
}

let _mat: THREE.MeshStandardMaterial | null = null;
function forageMaterial(): THREE.MeshStandardMaterial {
  if (_mat) return _mat;
  _mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, color: 0xffffff, side: THREE.DoubleSide });
  _mat.name = 'forage';
  applyWorldFx(_mat, { snowUp: 0.9 });
  applyPlantLighting(_mat, { translucency: 0.3, floor: 0.08 });
  return _mat;
}

function blade(len: number, w: number, bend: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, len, 1, 4);
  g.translate(0, len / 2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / len;
    p.setZ(i, y * y * bend);
    p.setX(i, p.getX(i) * (1 - y * 0.7));
  }
  g.computeVertexNormals();
  return g;
}

function build(id: string, r: Rng): InstancedPart[] {
  const b = new MeshBuilder();
  const m = forageMaterial();
  const C = (h: number) => new THREE.Color(h);
  switch (id) {
    case 'wildLeek':
      for (let i = 0; i < 4; i++) b.add(m, blade(0.42 + r.next() * 0.15, 0.07, 0.12), mat(0, 0.04, 0, 0, (i / 4) * Math.PI * 2 + r.next(), 0).multiply(mat(0, 0, 0, -0.18, 0, 0)), { tint: C(0x6fbf4a) });
      b.add(m, lumpySphere(0.06, 1, 0.1, r).scale(1, 1.2, 1), mat(0, 0.04, 0), { tint: C(0xf4f0e0) });
      break;
    case 'morel': {
      const cap = new THREE.ConeGeometry(0.08, 0.2, 9, 4);
      const p = cap.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const s = 1 + (Math.sin(p.getY(i) * 60) * Math.sin(Math.atan2(p.getZ(i), p.getX(i)) * 7)) * 0.12;
        p.setX(i, p.getX(i) * s);
        p.setZ(i, p.getZ(i) * s);
      }
      cap.computeVertexNormals();
      b.add(m, new THREE.CylinderGeometry(0.035, 0.045, 0.1, 7), mat(0, 0.05, 0), { tint: C(0xf0e4c8) });
      b.add(m, cap, mat(0, 0.2, 0), { tint: C(0x9a7248) });
      break;
    }
    case 'duskViolet':
    case 'sweetPea': {
      const pc = id === 'duskViolet' ? C(0x9a62e0) : C(0xf49ac4);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const x = Math.cos(a) * 0.09;
        const z = Math.sin(a) * 0.09;
        const h = 0.14 + r.next() * 0.1;
        b.add(m, new THREE.CylinderGeometry(0.008, 0.01, h, 4).translate(0, h / 2, 0), mat(x, 0, z), { tint: C(0x4f8a34) });
        for (let k = 0; k < 4; k++) {
          const petal = new THREE.CircleGeometry(0.035, 5);
          petal.translate(0.03, 0, 0);
          b.add(m, petal, mat(x, h, z, -Math.PI / 2 + 0.4, (k / 4) * Math.PI * 2, 0), { tint: pc.clone().offsetHSL(0, 0, (r.next() - 0.5) * 0.08) });
        }
        b.add(m, new THREE.SphereGeometry(0.015, 5, 3), mat(x, h + 0.01, z), { tint: C(0xffe070) });
      }
      for (let i = 0; i < 5; i++) b.add(m, blade(0.16, 0.06, 0.06), mat(0, 0, 0, -0.9, i * 1.3, 0), { tint: C(0x5a9a3a) });
      break;
    }
    case 'hedgeBerry':
    case 'frostHolly': {
      const leaf = id === 'frostHolly' ? C(0x2f7a42) : C(0x4f9a38);
      for (let i = 0; i < 7; i++) {
        const lg = new THREE.CircleGeometry(0.09, 6);
        lg.scale(0.5, 1, 1);
        lg.translate(0, 0.09, 0);
        b.add(m, lg, mat(0, 0.05, 0, -0.9 + r.next() * 0.3, (i / 7) * Math.PI * 2, 0), { tint: leaf.clone().offsetHSL(0, 0, (r.next() - 0.5) * 0.1) });
      }
      for (let i = 0; i < 9; i++) {
        const a = r.next() * Math.PI * 2;
        const d = r.next() * 0.1;
        b.add(m, new THREE.SphereGeometry(0.032, 7, 5), mat(Math.cos(a) * d, 0.12 + r.next() * 0.06, Math.sin(a) * d), { tint: id === 'frostHolly' ? C(0xd8202c) : C(0xc8283e) });
      }
      break;
    }
    case 'fiddlehead':
      for (let i = 0; i < 3; i++) {
        const t = new THREE.TorusGeometry(0.05, 0.016, 5, 10, Math.PI * 1.6);
        const h = 0.18 + r.next() * 0.08;
        b.add(m, new THREE.CylinderGeometry(0.012, 0.016, h, 5).translate(0, h / 2, 0), mat((i - 1) * 0.06, 0, 0, 0, 0, (i - 1) * 0.2), { tint: C(0x6fae45) });
        b.add(m, t, mat((i - 1) * 0.08, h + 0.03, 0, 0, Math.PI / 2, 0), { tint: C(0x7fbe4f) });
      }
      break;
    case 'chanterelle':
    case 'emberCap':
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + r.next();
        const d = i === 0 ? 0 : 0.08;
        const h = 0.08 + r.next() * 0.05;
        const s = i === 0 ? 1 : 0.7;
        const col = id === 'chanterelle' ? C(0xf2a838) : C(0xd8401e);
        b.add(m, new THREE.CylinderGeometry(0.02 * s, 0.028 * s, h, 6).translate(0, h / 2, 0), mat(Math.cos(a) * d, 0, Math.sin(a) * d), { tint: id === 'chanterelle' ? col : C(0xf4ead8) });
        const cap = id === 'chanterelle' ? new THREE.CylinderGeometry(0.07 * s, 0.02 * s, 0.05, 9, 1, true) : new THREE.SphereGeometry(0.075 * s, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1);
        b.add(m, cap, mat(Math.cos(a) * d, h + (id === 'chanterelle' ? 0.02 : 0), Math.sin(a) * d), { tint: col });
      }
      break;
    case 'hazelnut':
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        b.add(m, lumpySphere(0.045, 1, 0.08, r).scale(1, 1.15, 1), mat(Math.cos(a) * 0.06, 0.045, Math.sin(a) * 0.06), { tint: C(0x9a6a3a) });
        b.add(m, blade(0.07, 0.07, 0.02), mat(Math.cos(a) * 0.06, 0.07, Math.sin(a) * 0.06, 0, a, 0), { tint: C(0x8aa04a) });
      }
      break;
    case 'snowRoot':
      b.add(m, new THREE.ConeGeometry(0.05, 0.22, 7).rotateX(Math.PI).translate(0, 0.02, 0), mat(0, 0, 0, 1.3, 0.4, 0), { tint: C(0xe8d8c0) });
      for (let i = 0; i < 3; i++) b.add(m, blade(0.14, 0.05, 0.08), mat(0.08, 0.05, 0, -0.3, i * 2, 0), { tint: C(0x7a8a5a) });
      break;
    case 'crystalCone': {
      const cone = lumpySphere(0.07, 1, 0.25, r, 3).scale(1, 1.6, 1);
      b.add(m, cone, mat(0, 0.08, 0, 1.2, 0, 0.3), { tint: C(0x9a7050) });
      b.add(m, new THREE.OctahedronGeometry(0.05, 0).scale(1, 1.8, 1), mat(0.05, 0.13, 0.02, 0.3, 0, 0.2), { tint: C(0xd8f4ff) });
      b.add(m, new THREE.OctahedronGeometry(0.035, 0).scale(1, 1.8, 1), mat(-0.05, 0.1, 0.03, -0.3, 0, -0.2), { tint: C(0xd8f4ff) });
      break;
    }
  }
  return [...b.geometries()].map(([mm, geo]) => ({ geometry: geo, material: mm as THREE.Material, castShadow: false }));
}

export interface ForageSpot {
  x: number;
  y: number;
  z: number;
}

export interface ForageItem {
  def: ForageDef;
  tx: number;
  tz: number;
  set: InstancedSet;
  id: number;
  pos: THREE.Vector3;
}

export class ForageField {
  private sets = new Map<string, InstancedSet>();
  readonly items = new Map<number, ForageItem>();

  constructor(
    private pool: BatchPool,
    private rng: Rng,
  ) {}

  private setFor(id: string): InstancedSet {
    let s = this.sets.get(id);
    if (!s) {
      s = new InstancedSet(`forage-${id}`, build(id, this.rng.fork(`forage-${id}`)), this.pool);
      this.sets.set(id, s);
    }
    return s;
  }

  /** Remove everything (visuals only). */
  clear(): void {
    for (const it of this.items.values()) it.set.remove(it.id);
    this.items.clear();
  }

  /**
   * Fresh finds for a day: `count` picks from the season's table at seeded spots.
   * `key(tx, tz)` gives a unique tile key; `claim` reserves a tile (returns false if occupied).
   */
  spawn(seedKey: string, season: Season, spots: ForageSpot[], count: number, claim: (tx: number, tz: number, item: ForageItem) => boolean): void {
    this.clear();
    const table = FOREST_FORAGE.filter((f) => f.season === season);
    if (!table.length || !spots.length) return;
    const r = new RngClass(seedKey);
    const order = r.shuffle(spots.map((_, i) => i));
    let placed = 0;
    for (const i of order) {
      if (placed >= count) break;
      const s = spots[i]!;
      const def = table[Math.floor(r.next() * table.length)]!;
      const tx = Math.floor(s.x);
      const tz = Math.floor(s.z);
      const set = this.setFor(def.id);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y - 0.01, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.next() * 6.28), new THREE.Vector3(1.25, 1.25, 1.25));
      const item: ForageItem = { def, tx, tz, set, id: -1, pos: new THREE.Vector3(s.x, s.y, s.z) };
      if (!claim(tx, tz, item)) continue;
      item.id = set.add(m);
      this.items.set(tz * 4096 + tx, item);
      placed++;
    }
  }

  take(tx: number, tz: number): ForageItem | null {
    const k = tz * 4096 + tx;
    const it = this.items.get(k);
    if (!it) return null;
    it.set.remove(it.id);
    this.items.delete(k);
    return it;
  }
}
