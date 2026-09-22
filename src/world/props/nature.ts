/**
 * Small nature props as instanced sets: stones, boulders, twigs, weeds, stumps, logs,
 * bushes (seasonal, optional berries), flowers (tinted petals), reeds/cattails, lily pads.
 *
 *   const nature = new Nature(rng);
 *   const h = nature.place('weed', x, y, z);   nature.remove(h);
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import type { Season } from '../../core/time';
import { MeshBuilder, lumpySphere, bevelCylinder, sphericalNormals, uvScale, mat, smoothNormals } from '../geom';
import { materials } from '../../render/materials';
import { textures } from '../../render/textures';
import { applyWind, windDepthMaterial, type WindOptions } from '../../render/wind';
import { applyWorldFx } from '../../render/worldfx';
import { InstancedSet, type InstancedPart } from './instanced';

export type NatureKind =
  | 'stone'
  | 'boulder'
  | 'twig'
  | 'weed'
  | 'stump'
  | 'log'
  | 'bush'
  | 'berryBush'
  | 'flower'
  | 'tallFlower'
  | 'reed'
  | 'lilypad'
  | 'mushroom'
  | 'fern';

export interface NatureHandle {
  kind: NatureKind;
  set: InstancedSet;
  id: number;
}

const BUSH_COLORS: Record<Season, number> = { spring: 0x6fb543, summer: 0x4a9136, fall: 0xc9762c, winter: 0x7d8a6a };
const WEED_COLORS: Record<Season, number> = { spring: 0xffffff, summer: 0xe8ffe0, fall: 0xffd29a, winter: 0xa89878 };

function vcolor(g: THREE.BufferGeometry, fn: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const c = fn(p.fromBufferAttribute(pos, i), n.fromBufferAttribute(nor, i));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** A single curved leaf blade (for weeds/ferns/reeds). */
function leafBlade(len: number, width: number, bend: number, segs = 4): THREE.BufferGeometry {
  const pos: number[] = [];
  const pts: [number, number, number][] = [];
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const w = width * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05)) * (1 - t * 0.3);
    const y = Math.sin(t * Math.PI * 0.5) * len * (1 - bend * 0.4);
    const z = t * t * bend * len;
    pts.push([w, y, z]);
  }
  for (let s = 0; s < segs; s++) {
    const [w0, y0, z0] = pts[s]!;
    const [w1, y1, z1] = pts[s + 1]!;
    pos.push(-w0, y0, z0, w0, y0, z0, -w1, y1, z1);
    pos.push(w0, y0, z0, w1, y1, z1, -w1, y1, z1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // soften: bias normals upward so leaves read as volume
  const nor = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < nor.count; i++) {
    const n = new THREE.Vector3().fromBufferAttribute(nor, i).lerp(new THREE.Vector3(0, 1, 0), 0.5).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

function plantMaterial(name: string, wind: WindOptions, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, ...extra });
  m.name = name;
  applyWorldFx(m, { snowUp: 0.6 });
  applyWind(m, wind);
  // Two-sided leaves: don't darken back faces.
  return m;
}

export class Nature {
  readonly group = new THREE.Group();
  private sets = new Map<string, InstancedSet>();
  private bushMat: THREE.MeshStandardMaterial | null = null;
  private weedMat: THREE.MeshStandardMaterial | null = null;
  private seasonal: { kind: NatureKind; set: InstancedSet; hideIn: Season[] }[] = [];

  constructor(private rng: Rng) {
    this.group.name = 'nature';
  }

  private build(kind: NatureKind, variant: number): InstancedPart[] {
    const r = this.rng.fork(`${kind}-${variant}`);
    switch (kind) {
      case 'stone':
      case 'boulder': {
        const big = kind === 'boulder';
        const g = lumpySphere(big ? 0.75 : 0.28, big ? 2 : 1, 0.35, r, 1.3);
        g.scale(1, big ? 0.7 : 0.62, 0.9);
        g.translate(0, big ? 0.3 : 0.08, 0);
        const base = new THREE.Color().setHSL(0.08 + r.next() * 0.05, 0.08 + r.next() * 0.06, 0.52 + r.next() * 0.1);
        const moss = new THREE.Color(0x6f8f3a);
        vcolor(g, (p, n) => {
          const c = base.clone().multiplyScalar(0.72 + 0.28 * THREE.MathUtils.smoothstep(p.y, -0.05, big ? 0.6 : 0.2));
          if (n.y > 0.55 && (big || r.next() < 0.5)) c.lerp(moss, THREE.MathUtils.smoothstep(n.y, 0.55, 0.95) * (big ? 0.55 : 0.35));
          return c;
        });
        return [{ geometry: g, material: materials.get('rock') }];
      }
      case 'twig': {
        const b = new MeshBuilder();
        for (let i = 0; i < 3; i++) {
          const len = 0.45 + r.next() * 0.3;
          const g = new THREE.CylinderGeometry(0.025, 0.035, len, 5);
          g.rotateZ(Math.PI / 2);
          b.add('woodDark', g, mat((r.next() - 0.5) * 0.2, 0.035 + i * 0.03, (r.next() - 0.5) * 0.2, 0, r.next() * Math.PI, 0.05));
          const tw = new THREE.CylinderGeometry(0.012, 0.018, 0.18, 4);
          b.add('woodDark', tw, mat((r.next() - 0.5) * 0.2, 0.08, (r.next() - 0.5) * 0.2, 0.8, r.next() * 3, 0.9));
        }
        const g = b.geometries().get('woodDark')!;
        return [{ geometry: g, material: materials.get('woodDark') }];
      }
      case 'weed':
      case 'fern': {
        const fern = kind === 'fern';
        const b = new MeshBuilder();
        const n = fern ? 9 : 7 + r.int(0, 3);
        const dark = new THREE.Color(fern ? 0x2f6b2e : 0x3d6e22);
        const light = new THREE.Color(fern ? 0x7dbb4a : 0x8cc04a);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + r.next() * 0.5;
          const g = leafBlade(fern ? 0.62 : 0.34 + r.next() * 0.2, fern ? 0.1 : 0.085, 0.5 + r.next() * 0.5);
          vcolor(g, (p) => dark.clone().lerp(light, THREE.MathUtils.smoothstep(p.y, 0, 0.35)));
          b.add(this.getWeedMat(), g, mat(0, 0, 0, -0.15, a, 0));
        }
        if (!fern && r.next() < 0.5) {
          // tiny seed-head
          const s = new THREE.SphereGeometry(0.04, 6, 4);
          vcolor(s, () => new THREE.Color(0xe8e0a0));
          b.add(this.getWeedMat(), s, mat(0.05, 0.42, 0.02));
        }
        const g = b.geometries().get(this.getWeedMat())!;
        return [{ geometry: g, material: this.getWeedMat(), depthMaterial: windDepthMaterial({ height: 0.5, amplitude: 0.1 }), castShadow: true }];
      }
      case 'stump': {
        const b = new MeshBuilder();
        const bark = materials.get('bark');
        const h = 0.38 + r.next() * 0.15;
        const g = bevelCylinder(0.34, 0.4, h, 0.05, 11);
        uvScale(g, 3, 1);
        b.add(bark, g, undefined, { aoWorld: (p) => 0.6 + 0.4 * THREE.MathUtils.smoothstep(p.y, 0, 0.3) });
        const top = new THREE.CircleGeometry(0.3, 16);
        top.rotateX(-Math.PI / 2);
        vcolor(top, (p) => {
          const d = Math.hypot(p.x, p.z);
          const ring = 0.85 + 0.15 * Math.sin(d * 60);
          return new THREE.Color(0xd8b07a).multiplyScalar(ring * (1 - d * 0.6));
        });
        b.add('woodPaint', top, mat(0, h + 0.005, 0));
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + r.next();
          const root = new THREE.CylinderGeometry(0.03, 0.13, 0.5, 6);
          root.rotateZ(Math.PI / 2 - 0.35);
          b.add(bark, root, mat(Math.cos(a) * 0.38, 0.08, Math.sin(a) * 0.38, 0, -a, 0));
        }
        const geos = b.geometries();
        return [
          { geometry: geos.get(bark)!, material: bark },
          { geometry: geos.get('woodPaint')!, material: materials.get('woodPaint') },
        ];
      }
      case 'log': {
        const b = new MeshBuilder();
        const bark = materials.get('bark');
        const len = 1.6 + r.next() * 0.6;
        const g = new THREE.CylinderGeometry(0.22, 0.26, len, 10, 1, true);
        uvScale(g, 3, 2);
        g.rotateZ(Math.PI / 2);
        b.add(bark, g, mat(0, 0.22, 0));
        for (const sgn of [-1, 1]) {
          const cap = new THREE.CircleGeometry(sgn < 0 ? 0.26 : 0.22, 12);
          cap.rotateY((sgn * Math.PI) / 2);
          vcolor(cap, (p) => new THREE.Color(0xcfa270).multiplyScalar(0.85 + 0.15 * Math.sin(Math.hypot(p.y, p.z) * 55)));
          b.add('woodPaint', cap, mat((sgn * len) / 2, 0.22, 0));
        }
        const geos = b.geometries();
        return [
          { geometry: geos.get(bark)!, material: bark },
          { geometry: geos.get('woodPaint')!, material: materials.get('woodPaint') },
        ];
      }
      case 'bush':
      case 'berryBush': {
        const b = new MeshBuilder();
        const m = this.getBushMat();
        const center = new THREE.Vector3(0, 0.45, 0);
        const n = 4 + r.int(0, 2);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + r.next();
          const rr = 0.25 + r.next() * 0.2;
          const g = lumpySphere(0.42 + r.next() * 0.16, 2, 0.22, r, 2.2);
          uvScale(g, 1.2);
          g.translate(Math.cos(a) * rr, 0.4 + r.next() * 0.25, Math.sin(a) * rr);
          sphericalNormals(g, center, 0.55);
          b.add(m, g, undefined, { aoWorld: (p) => 0.45 + 0.55 * THREE.MathUtils.smoothstep(p.y, 0.0, 0.95) });
        }
        const top = lumpySphere(0.45, 2, 0.2, r, 2.2);
        uvScale(top, 1.2);
        top.translate(0, 0.75, 0);
        sphericalNormals(top, center, 0.55);
        b.add(m, top, undefined, { aoWorld: (p) => 0.45 + 0.55 * THREE.MathUtils.smoothstep(p.y, 0.0, 0.95) });
        const parts: InstancedPart[] = [
          { geometry: b.geometries().get(m)!, material: m, depthMaterial: windDepthMaterial({ height: 1.2, amplitude: 0.05 }) },
        ];
        if (kind === 'berryBush') {
          const bb = new MeshBuilder();
          const bm = materials.get('white');
          for (let i = 0; i < 14; i++) {
            const dir = new THREE.Vector3(r.next() - 0.5, r.next() * 0.8, r.next() - 0.5).normalize();
            const p = center.clone().add(new THREE.Vector3(dir.x * 0.68, 0.1 + dir.y * 0.5, dir.z * 0.68));
            bb.add(bm, new THREE.SphereGeometry(0.055, 7, 5), mat(p.x, p.y, p.z));
          }
          parts.push({ geometry: bb.geometries().get(bm)!, material: bm, tinted: true, castShadow: false });
        }
        return parts;
      }
      case 'flower':
      case 'tallFlower': {
        const tall = kind === 'tallFlower';
        const stems = new MeshBuilder();
        const petals = new MeshBuilder();
        const sm = this.flowerStemMat();
        const pm = this.flowerPetalMat();
        const heads = tall ? 1 : 3 + r.int(0, 2);
        for (let h = 0; h < heads; h++) {
          const a = r.next() * Math.PI * 2;
          const d = tall ? 0 : r.next() * 0.16;
          const hh = tall ? 0.7 + r.next() * 0.2 : 0.16 + r.next() * 0.14;
          const x = Math.cos(a) * d;
          const z = Math.sin(a) * d;
          const stem = new THREE.CylinderGeometry(0.008, 0.012, hh, 4);
          vcolor(stem, () => new THREE.Color(0x4f8a2e));
          stems.add(sm, stem, mat(x, hh / 2, z));
          const leaf = leafBlade(tall ? 0.18 : 0.1, 0.035, 0.6, 3);
          vcolor(leaf, () => new THREE.Color(0x5a9a34));
          stems.add(sm, leaf, mat(x, 0, z, 0, r.next() * 6, 0));
          const np = tall ? 7 : 5;
          const ps = tall ? 0.075 : 0.045;
          const tilt = -0.3 + r.next() * 0.2;
          for (let k = 0; k < np; k++) {
            const pa = (k / np) * Math.PI * 2;
            const petal = new THREE.SphereGeometry(ps, 6, 4);
            petal.scale(1, 0.3, 0.55);
            petal.translate(ps * 0.9, 0, 0);
            petal.rotateY(pa);
            petal.rotateX(tilt);
            vcolor(petal, (p) => new THREE.Color(1, 1, 1).multiplyScalar(0.8 + 0.2 * THREE.MathUtils.clamp(Math.hypot(p.x, p.z) / (ps * 2), 0, 1)));
            petals.add(pm, petal, mat(x, hh, z));
          }
          const c = new THREE.SphereGeometry(ps * 0.5, 6, 4);
          vcolor(c, () => new THREE.Color(0xf2c230));
          stems.add(sm, c, mat(x, hh + 0.01, z, 0, 0, 0, 1, 0.6, 1));
        }
        return [
          { geometry: stems.geometries().get(sm)!, material: sm, castShadow: false },
          { geometry: petals.geometries().get(pm)!, material: pm, tinted: true, castShadow: false },
        ];
      }
      case 'reed': {
        const b = new MeshBuilder();
        const m = this.reedMat();
        const n = 9;
        for (let i = 0; i < n; i++) {
          const a = r.next() * Math.PI * 2;
          const d = r.next() * 0.25;
          const len = 0.8 + r.next() * 0.6;
          const g = leafBlade(len, 0.035, 0.25 + r.next() * 0.3, 5);
          vcolor(g, (p) => new THREE.Color(0x3f6e2a).lerp(new THREE.Color(0x9cc05a), THREE.MathUtils.smoothstep(p.y, 0, len)));
          b.add(m, g, mat(Math.cos(a) * d, 0, Math.sin(a) * d, 0, r.next() * 6, 0));
          if (i < 3) {
            const hh = len * 0.9;
            const stalk = new THREE.CylinderGeometry(0.01, 0.012, hh, 4);
            vcolor(stalk, () => new THREE.Color(0x5b7a34));
            b.add(m, stalk, mat(Math.cos(a) * d, hh / 2, Math.sin(a) * d));
            const head = new THREE.CapsuleGeometry(0.035, 0.16, 3, 6);
            vcolor(head, () => new THREE.Color(0x6a4228));
            b.add(m, head, mat(Math.cos(a) * d, hh + 0.08, Math.sin(a) * d));
          }
        }
        return [{ geometry: b.geometries().get(m)!, material: m, depthMaterial: windDepthMaterial({ height: 1.3, amplitude: 0.12 }) }];
      }
      case 'lilypad': {
        const b = new MeshBuilder();
        const m = materials.get('white');
        const shape = new THREE.Shape();
        const R = 0.28 + r.next() * 0.1;
        shape.moveTo(0, 0);
        shape.absarc(0, 0, R, 0.25, Math.PI * 2 - 0.25, false);
        shape.lineTo(0, 0);
        const g = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.01, bevelSegments: 1, curveSegments: 18 });
        g.rotateX(-Math.PI / 2);
        smoothNormals(g.toNonIndexed());
        vcolor(g, (p) => new THREE.Color(0x4f9a3a).multiplyScalar(0.8 + 0.3 * (Math.hypot(p.x, p.z) / R)));
        b.add(m, g);
        if (r.next() < 0.45) {
          for (let k = 0; k < 6; k++) {
            const petal = new THREE.SphereGeometry(0.05, 6, 4);
            petal.scale(1, 0.5, 0.45);
            petal.translate(0.05, 0.06, 0);
            petal.rotateZ(0.5);
            petal.rotateY((k / 6) * Math.PI * 2);
            vcolor(petal, () => new THREE.Color(0xffc6d8));
            b.add(m, petal, mat(0.04, 0.02, 0.03));
          }
        }
        return [{ geometry: b.geometries().get(m)!, material: m, castShadow: false }];
      }
      case 'mushroom': {
        const b = new MeshBuilder();
        const m = materials.get('white');
        for (let i = 0; i < 3; i++) {
          const h = 0.08 + r.next() * 0.08;
          const x = (r.next() - 0.5) * 0.25;
          const z = (r.next() - 0.5) * 0.25;
          const stem = new THREE.CylinderGeometry(0.02, 0.028, h, 6);
          vcolor(stem, () => new THREE.Color(0xf0e6d0));
          b.add(m, stem, mat(x, h / 2, z));
          const cap = new THREE.SphereGeometry(0.06, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
          cap.scale(1, 0.7, 1);
          vcolor(cap, (p) => (Math.sin(p.x * 90) * Math.sin(p.z * 90) > 0.6 ? new THREE.Color(0xfff8f0) : new THREE.Color(0xc8482c)));
          b.add(m, cap, mat(x, h, z));
        }
        return [{ geometry: b.geometries().get(m)!, material: m }];
      }
    }
  }

  private getBushMat(): THREE.MeshStandardMaterial {
    if (!this.bushMat) {
      const t = textures.leaves();
      this.bushMat = new THREE.MeshStandardMaterial({ bumpMap: t.bump, bumpScale: 1.2, vertexColors: true, roughness: 0.8, color: BUSH_COLORS.spring });
      this.bushMat.name = 'bush';
      applyWorldFx(this.bushMat, { snowUp: 0.55 });
      applyWind(this.bushMat, { mode: 'height', height: 1.2, amplitude: 0.05, flutter: 0.6 });
    }
    return this.bushMat;
  }
  private getWeedMat(): THREE.MeshStandardMaterial {
    if (!this.weedMat) this.weedMat = plantMaterial('weed', { height: 0.5, amplitude: 0.1, flutter: 0.6 });
    return this.weedMat;
  }
  private _stem: THREE.MeshStandardMaterial | null = null;
  private flowerStemMat(): THREE.MeshStandardMaterial {
    if (!this._stem) this._stem = plantMaterial('flowerStem', { height: 0.7, amplitude: 0.1, flutter: 0.5 });
    return this._stem;
  }
  private _petal: THREE.MeshStandardMaterial | null = null;
  private flowerPetalMat(): THREE.MeshStandardMaterial {
    if (!this._petal) this._petal = plantMaterial('flowerPetal', { height: 0.7, amplitude: 0.1, flutter: 0.5 }, { roughness: 0.6 });
    return this._petal;
  }
  private _reed: THREE.MeshStandardMaterial | null = null;
  private reedMat(): THREE.MeshStandardMaterial {
    if (!this._reed) this._reed = plantMaterial('reed', { height: 1.3, amplitude: 0.12, flutter: 0.4 });
    return this._reed;
  }

  private setFor(kind: NatureKind, variant: number): InstancedSet {
    const key = `${kind}:${variant}`;
    let s = this.sets.get(key);
    if (!s) {
      s = new InstancedSet(`nature-${key}`, this.build(kind, variant), 2048);
      this.sets.set(key, s);
      this.group.add(s.group);
      const hide: Season[] = kind === 'flower' || kind === 'tallFlower' || kind === 'mushroom' ? ['winter'] : kind === 'lilypad' ? ['winter'] : [];
      if (hide.length) this.seasonal.push({ kind, set: s, hideIn: hide });
    }
    return s;
  }

  static readonly VARIANTS: Partial<Record<NatureKind, number>> = { stone: 4, boulder: 2, weed: 3, flower: 3, bush: 3, berryBush: 2, twig: 2, stump: 2, reed: 2, lilypad: 3 };

  place(kind: NatureKind, x: number, y: number, z: number, opts: { rot?: number; scale?: number; color?: THREE.ColorRepresentation; variant?: number } = {}): NatureHandle {
    const nv = Nature.VARIANTS[kind] ?? 1;
    const v = opts.variant ?? this.rng.int(0, nv - 1);
    const set = this.setFor(kind, v % nv);
    const s = opts.scale ?? 1;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), opts.rot ?? this.rng.next() * Math.PI * 2),
      new THREE.Vector3(s, s, s),
    );
    const id = set.add(m, opts.color !== undefined ? new THREE.Color(opts.color) : undefined);
    return { kind, set, id };
  }

  remove(h: NatureHandle): void {
    h.set.remove(h.id);
  }

  finalize(): void {
    for (const s of this.sets.values()) s.finalize();
  }

  setSeason(season: Season): void {
    this.bushMat?.color.setHex(BUSH_COLORS[season]);
    this.weedMat?.color.setHex(WEED_COLORS[season]);
    for (const e of this.seasonal) e.set.group.visible = !e.hideIn.includes(season);
  }
}
