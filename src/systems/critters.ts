/**
 * CritterSystem: ambient animal life on maps that publish points of interest (`map.poi`):
 * butterflies over flower beds (sunny days, not winter), songbirds hopping in the yard,
 * the farm cat on the porch, chickens pecking around their run.
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { Butterfly, Songbird, Cat, Chicken } from '../entities/critters';

export class CritterSystem implements System {
  readonly name = 'critters';
  private group = new THREE.Group();
  private butterflies: Butterfly[] = [];
  private birds: Songbird[] = [];
  private chickens: Chicken[] = [];
  private cat: Cat | null = null;
  private built = new Set<string>();

  init(game: Game): void {
    this.group.name = 'critters';
    this.group.userData.noAO = true;
    game.scene.add(this.group);
  }

  onMapChange(mapId: string, game: Game): void {
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
  }

  update(dt: number, game: Game): void {
    const t = game.time;
    const cal = game.calendar;
    const night = game.lighting.night;
    const wet = cal.weather === 'rain' || cal.weather === 'storm' || cal.weather === 'snow';
    const bfly = !wet && cal.season !== 'winter' && night < 0.3;
    for (const b of this.butterflies) {
      b.root.visible = bfly;
      if (bfly) b.update(dt, t);
    }
    const birds = !wet && night < 0.5;
    for (const b of this.birds) {
      if (!birds) {
        b.root.visible = false;
        continue;
      }
      b.update(dt, t, game.player.position);
    }
    if (this.cat) {
      this.cat.update(dt, t, night);
    }
    const chick = night < 0.6;
    for (const c of this.chickens) {
      c.root.visible = chick;
      if (chick) c.update(dt, t);
    }
  }
}
