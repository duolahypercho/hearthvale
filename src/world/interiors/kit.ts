/**
 * Interior material library + a tiny furniture builder.
 *
 * Interior materials are NOT world-fx patched (no snow on the kitchen table, no cloud shadows
 * indoors). Everything is vertex-coloured like the outdoor kit so parts merge per material.
 *
 *   const k = new Kit();
 *   k.box('paint', [1, 0.8, 0.5], [x, 0, z], 0x9ab08a);         // y = bottom of the box
 *   k.add('fabric', someGeometry, mat(...), { tint });
 *   room.add(k.build('kitchen'));
 */
import * as THREE from 'three';
import { MeshBuilder, roundedBox, mat, groundAO, type AOFn } from '../geom';
import { textures } from '../../render/textures';
import { floorPlanks, wallpaper, beadboard, barnBoards, strawFloor, wovenRug, braidedRug, quilt, photoAtlas, limewashBoards, burlap, kitchenTile } from './textures';

export type IMat =
  | 'floor'
  | 'wallpaper'
  | 'bead'
  | 'wood'
  | 'plank'
  | 'barn'
  | 'paint'
  | 'fabric'
  | 'rug'
  | 'braid'
  | 'quilt'
  | 'stone'
  | 'brick'
  | 'iron'
  | 'brass'
  | 'ceramic'
  | 'straw'
  | 'photo'
  | 'glow'
  | 'ember'
  | 'thatch'
  | 'leaf'
  | 'limewash'
  | 'tin'
  | 'burlap'
  | 'tile';

const cache = new Map<IMat, THREE.MeshStandardMaterial>();

/** Emissive materials whose intensity the interior lighting drives (lamp shades, candle flames, embers). */
export const interiorEmissive: { material: THREE.MeshStandardMaterial; day: number; night: number }[] = [];

function std(p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, ...p });
}

function build(name: IMat): THREE.MeshStandardMaterial {
  switch (name) {
    case 'floor': {
      const t = floorPlanks();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 1.4, roughness: 0.55 });
    }
    case 'wallpaper':
      return std({ map: wallpaper().map, roughness: 0.92 });
    case 'bead': {
      const t = beadboard();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 1.2, roughness: 0.6 });
    }
    case 'wood': {
      const t = textures.woodGrain();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 1.2, roughness: 0.62 });
    }
    case 'plank': {
      const t = textures.wood();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 2, roughness: 0.8 });
    }
    case 'barn': {
      const t = barnBoards();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 2.2, roughness: 0.88 });
    }
    case 'paint':
      return std({ roughness: 0.55 });
    case 'limewash': {
      const t = limewashBoards();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 2, roughness: 0.95 });
    }
    case 'tile': {
      // Laid over the floorboards: pulled forward in depth (no z-fight) but still under the room AO card.
      const t = kitchenTile();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 1.6, roughness: 0.42, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    }
    case 'burlap': {
      const t = burlap();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 2.5, roughness: 1 });
    }
    case 'tin':
      // Galvanised steel (founts, pails): bright enough to read without an outdoor sky to reflect.
      return std({ roughness: 0.38, metalness: 0.25, color: 0xe4e8ea });
    case 'fabric':
      return std({ roughness: 0.98, side: THREE.DoubleSide });
    case 'rug':
      return std({ map: wovenRug().map, roughness: 1 });
    case 'braid': {
      const t = braidedRug();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 3, roughness: 1, alphaTest: 0.5 });
    }
    case 'quilt':
      return std({ map: quilt().map, roughness: 0.95 });
    case 'stone': {
      const t = textures.stone();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 3, roughness: 0.9 });
    }
    case 'brick': {
      const t = textures.cobble();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 2.5, roughness: 0.92 });
    }
    case 'iron':
      return std({ roughness: 0.42, metalness: 0.6, color: 0x4a4644 });
    case 'brass':
      return std({ roughness: 0.3, metalness: 0.85, color: 0xd8a850 });
    case 'ceramic':
      return std({ roughness: 0.22 });
    case 'straw': {
      const t = strawFloor();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 2.5, roughness: 1 });
    }
    case 'thatch': {
      const t = textures.thatch();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 2, roughness: 1 });
    }
    case 'photo':
      return std({ map: photoAtlas().map, roughness: 0.5 });
    case 'leaf':
      return std({ roughness: 0.7, side: THREE.DoubleSide });
    case 'glow': {
      // Lamp shades, candle flames, window cards at night: vertex colour doubles as emissive.
      const m = std({ roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0 });
      m.onBeforeCompile = (s) => {
        s.fragmentShader = s.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor.rgb;',
        );
      };
      m.customProgramCacheKey = () => 'i-glow';
      interiorEmissive.push({ material: m, day: 0.15, night: 1.05 });
      return m;
    }
    case 'ember': {
      const m = std({ roughness: 0.9, emissive: 0xff5a18, emissiveIntensity: 1.5 });
      interiorEmissive.push({ material: m, day: 1.4, night: 2.4 });
      return m;
    }
  }
}

export function imat(name: IMat): THREE.MeshStandardMaterial {
  let m = cache.get(name);
  if (!m) {
    m = build(name);
    m.name = `i-${name}`;
    cache.set(name, m);
  }
  return m;
}

export interface BoxOpts {
  tint?: THREE.ColorRepresentation;
  /** Corner radius (default 0.02). */
  r?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  /** Ground-contact AO height (0 = none). */
  ao?: number;
  /** Box-project UVs at this scale (textured materials). */
  uv?: number;
}

/** MeshBuilder front-end with interior materials and "y = bottom" boxes. */
export class Kit {
  readonly b = new MeshBuilder();

  add(m: IMat, g: THREE.BufferGeometry, mtx?: THREE.Matrix4, opts: { tint?: THREE.ColorRepresentation; ao?: AOFn; aoWorld?: AOFn } = {}): this {
    this.b.add(imat(m), g, mtx, opts);
    return this;
  }

  /** Box of size [w,h,d] whose bottom-centre sits at [x,y,z]. */
  box(m: IMat, [w, h, d]: [number, number, number], [x, y, z]: [number, number, number], opts: BoxOpts | number = {}): this {
    const o: BoxOpts = typeof opts === 'number' ? { tint: opts } : opts;
    const g = roundedBox(w, h, d, o.r ?? 0.02);
    if (o.uv) boxProject(g, o.uv, w, h, d);
    const aoH = o.ao ?? 0;
    this.b.add(imat(m), g, mat(x, y + h / 2, z, o.rx ?? 0, o.ry ?? 0, o.rz ?? 0), {
      tint: o.tint,
      aoWorld: aoH > 0 ? groundAO(aoH, 0.6) : undefined,
    });
    return this;
  }

  cyl(m: IMat, rTop: number, rBot: number, h: number, [x, y, z]: [number, number, number], opts: BoxOpts & { seg?: number } = {}): this {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, opts.seg ?? 16);
    this.b.add(imat(m), g, mat(x, y + h / 2, z, opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0), { tint: opts.tint });
    return this;
  }

  sphere(m: IMat, r: number, [x, y, z]: [number, number, number], tint?: THREE.ColorRepresentation, scale: [number, number, number] = [1, 1, 1]): this {
    this.b.add(imat(m), new THREE.SphereGeometry(r, 14, 10), mat(x, y, z, 0, 0, 0, scale[0], scale[1], scale[2]), { tint });
    return this;
  }

  build(name: string, shadows = true): THREE.Group {
    return this.b.build({ name, castShadow: shadows, receiveShadow: true });
  }
}

/** Box-project UVs in world-ish metres (textures tile at `scale` repeats per metre). */
export function boxProject(g: THREE.BufferGeometry, scale: number, _w = 1, _h = 1, _d = 1): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else if (ax >= az) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Plane lying on the floor (XZ) with UVs 0..1 (or world-scaled). */
export function floorPlane(w: number, d: number, uvScale = 0): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  if (uvScale) {
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * uvScale, uv.getY(i) * d * uvScale);
  }
  return g;
}
