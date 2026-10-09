/**
 * CritterSystem: ambient animal life on maps that publish points of interest (`map.poi`):
 * butterflies over flower beds (sunny days, not winter), songbirds hopping in the yard,
 * the farm cat on the porch, chickens pecking around their run.
 *
 * Perf g22 (pillar 14): every critter part (butterfly, bird body / head, cat body / head / eyes / tail
 * segments, chicken body / head) shares one vertex-coloured material, so they all draw from two
 * BatchedMeshes — shadow casters (cat, chickens) and the rest — instead of one draw per part per pass
 * (farm: ~21 colour + ~8 shadow draws -> 2 + 1). The rigs stay as they are (hidden Object3D parts that
 * the critters animate); each frame their world matrices are written into the batch instances.
 * `?critterbatch=0` = one mesh per part (A/B).
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { Butterfly, Songbird, Cat, Chicken } from '../entities/critters';

function batchOn(): boolean {
  try {
    return new URLSearchParams(location.search).get('critterbatch') !== '0';
  } catch {
    return true;
  }
}

interface BatchedPart {
  mesh: THREE.Mesh;
  batch: THREE.BatchedMesh;
  id: number;
}

/** All critter parts of one map drawn from two batches (casters / non-casters), driven by the hidden rigs. */
class CritterBatch {
  private parts: BatchedPart[] = [];
  private batches: THREE.BatchedMesh[] = [];

  constructor(private group: THREE.Group) {}

  /** Moves every rendered part of `roots` into the batches (the part meshes stay as hidden rig nodes). */
  build(roots: THREE.Object3D[]): void {
    const meshes: THREE.Mesh[] = [];
    for (const r of roots) r.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material)) meshes.push(m);
    });
    if (!meshes.length) return;
    const material = meshes[0]!.material as THREE.Material;
    if (meshes.some((m) => m.material !== material || !!m.geometry.index !== !!meshes[0]!.geometry.index)) return;
    for (const cast of [true, false]) {
      const list = meshes.filter((m) => m.castShadow === cast);
      if (!list.length) continue;
      let v = 0;
      let idx = 0;
      for (const m of list) {
        v += m.geometry.attributes.position!.count;
        idx += m.geometry.index?.count ?? 0;
      }
      const batch = new THREE.BatchedMesh(list.length, v, idx || v * 2, material);
      batch.name = cast ? 'critters:cast' : 'critters:lit';
      batch.castShadow = cast;
      batch.receiveShadow = true;
      // Per-instance culling happens inside the batch (render/batching.ts); the batch sphere would go stale.
      batch.frustumCulled = false;
      batch.perObjectFrustumCulled = true;
      batch.sortObjects = false;
      for (const m of list) {
        const id = batch.addInstance(batch.addGeometry(m.geometry));
        this.parts.push({ mesh: m, batch, id });
      }
      this.batches.push(batch);
      this.group.add(batch);
    }
    // The rig parts no longer draw themselves (castShadow off too: no hidden-caster warm-up proxies).
    for (const p of this.parts) {
      p.mesh.userData.critterCast = p.batch.castShadow;
      p.mesh.visible = false;
      p.mesh.castShadow = false;
      p.mesh.userData.critterPart = true;
    }
    this.sync();
  }

  /** Writes the rigs' current world matrices / visibility into the batch instances. */
  sync(): void {
    if (!this.parts.length) return;
    this.group.updateMatrixWorld(true);
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i]!;
      // Visible when every rig ancestor (other than the hidden parts themselves) is.
      let vis = true;
      for (let n = p.mesh.parent; n && n !== this.group; n = n.parent) {
        if (!n.visible && !n.userData.critterPart) {
          vis = false;
          break;
        }
      }
      p.batch.setVisibleAt(p.id, vis);
      if (vis) p.batch.setMatrixAt(p.id, p.mesh.matrixWorld);
    }
  }

  dispose(): void {
    for (const b of this.batches) {
      b.removeFromParent();
      b.dispose();
    }
    this.batches = [];
    this.parts = [];
  }
}

export class CritterSystem implements System {
  readonly name = 'critters';
  private group = new THREE.Group();
  private butterflies: Butterfly[] = [];
  private birds: Songbird[] = [];
  private chickens: Chicken[] = [];
  private cat: Cat | null = null;
  private built = new Set<string>();
  private snapT = 0;
  private batch = batchOn() ? new CritterBatch(this.group) : null;

  init(game: Game): void {
    this.group.name = 'critters';
    this.group.userData.noAO = true;
    game.scene.add(this.group);
    // (Farming pod r15) Tool work startles butterflies off the target tile (they used to perch on
    // the hoe blade mid-swing); remote farmers' replicated impacts scare them too.
    game.events.on('tool:impact', ({ x, z }) => {
      for (const b of this.butterflies) b.scare(x + 0.5, z + 0.5, 3.2);
    });
    // Staged stills: while a demo is up, any butterfly is snapped out of a ~3.6 m bubble round the
    // farmer (in play they fly off instead — no visible pop).
    game.events.on('demo:stage', () => {
      this.snapT = Infinity;
    });
  }

  onMapChange(mapId: string, game: Game): void {
    this.batch?.dispose();
    this.group.clear();
    this.butterflies = [];
    this.birds = [];
    this.chickens = [];
    this.cat = null;
    const map = game.world.current;
    const poi = map?.poi;
    if (!map || !poi) return;
    this.built.add(mapId);
    const h = (x: number, z: number): number => map.heightAt(x, z);
    const flowers = (poi.flowers ?? []).map((p) => new THREE.Vector3(p.x, 0, p.z));
    const colors = [0xffd166, 0xf7f3ea, 0x8fc8ff, 0xff9fbf, 0xffa94d];
    if (flowers.length) {
      for (let i = 0; i < 5; i++) {
        const b = new Butterfly(flowers, h, i, colors[i % colors.length]!);
        // Tiny fliers: no shadow-pass draw calls.
        b.root.traverse((o) => (o.castShadow = false));
        this.butterflies.push(b);
        this.group.add(b.root);
      }
    }
    (poi.birds ?? []).forEach((p, i) => {
      const b = new Songbird(new THREE.Vector3(p.x, 0, p.z), 2.5, h, i);
      b.root.traverse((o) => (o.castShadow = false));
      this.birds.push(b);
      this.group.add(b.root);
    });
    const cat = poi.cat?.[0];
    if (cat) {
      this.cat = new Cat(1);
      this.cat.root.position.set(cat.x, cat.y ?? h(cat.x, cat.z), cat.z);
      this.cat.root.rotation.y = cat.rot ?? 0;
      this.group.add(this.cat.root);
    }
    const yard = poi.chickens?.[0];
    if (yard) {
      for (let i = 0; i < 3; i++) {
        const c = new Chicken(new THREE.Vector3(yard.x, 0, yard.z), 3, h, i);
        this.chickens.push(c);
        this.group.add(c.root);
      }
    }
    this.batch?.build([...this.group.children]);
  }

  update(dt: number, game: Game): void {
    const t = game.time;
    const cal = game.calendar;
    const night = game.lighting.night;
    const wet = cal.weather === 'rain' || cal.weather === 'storm' || cal.weather === 'snow';
    const bfly = !wet && cal.season !== 'winter' && night < 0.3;
    // A farmer mid-action (or frozen in a staged tool still) keeps a ~2 m bubble clear of them.
    const pp = game.player.position;
    const working = game.player.busy;
    if (this.snapT > 0) this.snapT -= dt;
    for (const b of this.butterflies) {
      b.root.visible = bfly;
      if (working || this.snapT > 0) b.avoid(pp.x, pp.z, this.snapT > 0 ? 3.6 : 2.4, this.snapT > 0);
      if (bfly) b.update(dt, t);
    }
    const birds = !wet && night < 0.5;
    for (const b of this.birds) {
      if (!birds) {
        b.root.visible = false;
        continue;
      }
      b.update(dt, t, game.player.position, this.snapT > 0);
    }
    if (this.cat) {
      this.cat.update(dt, t, night);
    }
    const chick = night < 0.6;
    for (const c of this.chickens) {
      c.root.visible = chick;
      if (chick) c.update(dt, t);
    }
    this.batch?.sync();
  }
}
