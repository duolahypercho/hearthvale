/**
 * Nature: small props as batched instanced sets (one draw call per material for the whole map):
 * rocks (rocks.ts), woody debris (debris.ts) and flora + lawn ground cover (flora.ts).
 * This file only owns the registry: variants, seasonal visibility and placement.
 *
 *   const nature = new Nature(rng);
 *   const h = nature.place('weed', x, y, z);   nature.remove(h);
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import type { Season } from '../../core/time';
import { InstancedSet, BatchPool, type InstancedPart } from './instanced';
import { FloraMaterials, buildFlora, type FloraKind } from './flora';
import { buildRock, buildPebbles } from './rocks';
import { buildTwig, buildBranch, buildStump, buildLog, buildLeaves } from './debris';

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
  | 'fern'
  | 'pebbles'
  | 'deadTwig'
  | 'tallGrass'
  | 'branch'
  | 'clover'
  | 'daisy'
  | 'buttercup'
  | 'leaves';

export interface NatureHandle {
  kind: NatureKind;
  set: InstancedSet;
  id: number;
  /** Linked seasonal stand-in (weed → frozen twigs in winter). */
  extra?: NatureHandle;
}

/** Kinds hidden under snow (and their winter stand-in). */
const HIDE_IN_WINTER = new Set<NatureKind>(['flower', 'tallFlower', 'mushroom', 'lilypad', 'weed', 'fern', 'tallGrass', 'clover', 'daisy', 'buttercup', 'leaves']);

export class Nature {
  readonly group = new THREE.Group();
  readonly mats = new FloraMaterials();
  private sets = new Map<string, InstancedSet>();
  private seasonal: { kind: NatureKind; set: InstancedSet; hideIn: Season[] }[] = [];

  constructor(private rng: Rng) {
    this.group.name = 'nature';
    this.group.add(this.pool.group);
  }

  /** Thin foliage batches skip the GTAO normal pass (AO adds nothing on blades/petals). */
  private markNoAO(): void {
    for (const m of this.pool.meshes) {
      const n = (m.material as THREE.Material).name;
      if (['flowerStem', 'flowerPetal', 'weed', 'deadTwig', 'reed'].includes(n)) m.userData.noAO = true;
    }
  }

  private build(kind: NatureKind, variant: number, lod = 0): InstancedPart[] {
    const r = this.rng.fork(`${kind}-${variant}`);
    switch (kind) {
      case 'stone':
      case 'boulder':
        return buildRock(kind, r, variant);
      case 'pebbles':
        return buildPebbles(r, variant);
      case 'twig':
        return buildTwig(r, this.mats);
      case 'branch':
        return buildBranch(r, this.mats);
      case 'stump':
        return buildStump(r);
      case 'log':
        return buildLog(r);
      case 'leaves':
        return buildLeaves(r, this.mats);
      default:
        return buildFlora(kind as FloraKind, r, variant, lod, this.mats);
    }
  }

  private partsCache = new Map<string, InstancedPart[]>();
  readonly pool = new BatchPool('nature');

  private setFor(kind: NatureKind, variant: number, lod = 0): InstancedSet {
    const key = `${kind}:${variant}:${lod}`;
    let s = this.sets.get(key);
    if (!s) {
      let parts = this.partsCache.get(key);
      if (!parts) {
        parts = this.build(kind, variant, lod);
        this.partsCache.set(key, parts);
      }
      s = new InstancedSet(`nature-${key}`, parts, this.pool);
      this.sets.set(key, s);
      const hide: Season[] = HIDE_IN_WINTER.has(kind) ? ['winter'] : kind === 'deadTwig' ? ['spring', 'summer', 'fall'] : [];
      if (hide.length) {
        this.seasonal.push({ kind, set: s, hideIn: hide });
        s.setVisible(!hide.includes(this.season));
      }
    }
    return s;
  }

  static readonly VARIANTS: Partial<Record<NatureKind, number>> = {
    stone: 6,
    boulder: 3,
    weed: 3,
    flower: 3,
    bush: 3,
    berryBush: 2,
    twig: 2,
    stump: 2,
    reed: 2,
    lilypad: 3,
    pebbles: 3,
    deadTwig: 2,
    tallGrass: 3,
    branch: 3,
    log: 2,
    clover: 3,
    daisy: 2,
    buttercup: 2,
    leaves: 3,
  };

  place(kind: NatureKind, x: number, y: number, z: number, opts: { rot?: number; scale?: number; color?: THREE.ColorRepresentation; variant?: number; sink?: number; lod?: number } = {}): NatureHandle {
    const nv = Nature.VARIANTS[kind] ?? 1;
    const v = opts.variant ?? this.rng.int(0, nv - 1);
    const lodable = kind === 'bush' || kind === 'berryBush';
    const set = this.setFor(kind, v % nv, lodable ? (opts.lod ?? 0) : 0);
    const s = opts.scale ?? 1;
    const rot = opts.rot ?? this.rng.next() * Math.PI * 2;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y - (opts.sink ?? 0), z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot),
      new THREE.Vector3(s, s, s),
    );
    const id = set.add(m, opts.color !== undefined ? new THREE.Color(opts.color) : undefined);
    const h: NatureHandle = { kind, set, id };
    if (kind === 'weed' || kind === 'tallGrass') h.extra = this.place('deadTwig', x, y, z, { rot, scale: s * (kind === 'tallGrass' ? 1.3 : 1) });
    return h;
  }

  remove(h: NatureHandle): void {
    h.set.remove(h.id);
    if (h.extra) this.remove(h.extra);
  }

  finalize(): void {
    for (const s of this.sets.values()) s.finalize();
    this.markNoAO();
  }

  private season: Season = 'spring';

  setSeason(season: Season): void {
    this.season = season;
    this.mats.setSeason(season);
    for (const e of this.seasonal) e.set.setVisible(!e.hideIn.includes(season));
  }
}
