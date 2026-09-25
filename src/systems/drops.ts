/**
 * DropsSystem: items that did not fit in a full backpack land on the ground at the farmer's feet
 * (instead of vanishing) and float back in once there is room, like Stardew's overflow debris.
 *   in:  item:overflow (InventorySystem / backpack UI)
 *   out: ui:toast, inventory.add on pickup
 * Drops are per map, bob over a soft shadow as the item's icon, and persist in the save.
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { itemDef } from '../data/items';
import { itemIconUrl } from '../ui/icons';

declare module '../core/events' {
  interface GameEvents {
    /** Items that did not fit in the backpack (dropped on the ground by the local farmer). */
    'item:overflow': { itemId: string; qty: number; quality?: number };
  }
}

interface Drop {
  id: string;
  qty: number;
  quality: number;
  map: string;
  x: number;
  z: number;
  /** Seconds since dropped (a short grace before it can be collected again). */
  age: number;
  seed: number;
  sprite: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null;
  /** Flying to the farmer (room was found for it). */
  magnet: boolean;
}

const PICK_R = 1.6;
const GRACE = 0.8;
const texCache = new Map<string, THREE.Texture>();
let shadowTex: THREE.Texture | null = null;

/** The item's HUD icon rasterized onto a canvas (an SVG <img> uploaded straight to WebGL comes out blank). */
function iconTexture(id: string): THREE.Texture {
  let t = texCache.get(id);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const img = new Image();
    img.onload = () => {
      c.getContext('2d')!.drawImage(img, 0, 0, 128, 128);
      tex.needsUpdate = true;
    };
    img.src = itemIconUrl(id);
    texCache.set(id, (t = tex));
  }
  return t;
}

function shadowTexture(): THREE.Texture {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(0,0,0,0.45)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

export class DropsSystem implements System {
  readonly name = 'drops';
  private game!: Game;
  private drops: Drop[] = [];
  private readonly group = new THREE.Group();
  private readonly cardGeo = new THREE.PlaneGeometry(0.5, 0.5);
  private readonly shadowGeo = new THREE.PlaneGeometry(0.55, 0.55).rotateX(-Math.PI / 2);
  private readonly shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false });

  init(game: Game): void {
    this.game = game;
    this.group.name = 'overflow-drops';
    this.group.userData.perfTag = 'overflow-drops';
    // Flat cards: keep them out of the AO G-buffer (they would darken the ground as solid squares).
    this.group.userData.noAO = true;
    game.scene.add(this.group);
    game.events.on('item:overflow', ({ itemId, qty, quality }) => {
      if (qty <= 0) return;
      this.drop(itemId, qty, quality ?? 0);
      const name = itemDef(itemId)?.name ?? itemId;
      game.events.emit('ui:toast', { text: `Backpack full · <b>${qty > 1 ? `${qty}× ` : ''}${name}</b> dropped on the ground`, icon: itemId, kind: 'bad' });
    });
  }

  /** Drop items at the farmer's feet (scattered a little so piles stay readable). */
  drop(id: string, qty: number, quality = 0): void {
    const map = this.game.world.current?.id;
    if (!map) return;
    const p = this.game.player.position;
    const a = Math.random() * Math.PI * 2;
    const r = 0.35 + Math.random() * 0.35;
    // Merge into a pile of the same item right here rather than stacking sprites.
    const x = p.x + Math.cos(a) * r;
    const z = p.z + Math.sin(a) * r;
    const near = this.drops.find((d) => d.map === map && d.id === id && d.quality === quality && !d.magnet && Math.hypot(d.x - x, d.z - z) < 0.8);
    if (near) {
      near.qty += qty;
      near.age = 0;
      return;
    }
    this.drops.push({ id, qty, quality, map, x, z, age: 0, seed: Math.random() * 10, sprite: null, magnet: false });
  }

  /** How many of this item the backpack could take right now. */
  private room(id: string, quality: number): number {
    const inv = this.game.services.inventory;
    if (!inv) return 0;
    const max = inv.stackMax(id);
    let n = 0;
    for (const s of inv.slots) n += !s ? max : s.id === id && (s.quality ?? 0) === quality ? Math.max(0, max - s.qty) : 0;
    return n;
  }

  fixedUpdate(dt: number): void {
    const map = this.game.world.current?.id;
    const inv = this.game.services.inventory;
    if (!map || !inv) return;
    const p = this.game.player.position;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      if (d.map !== map) continue;
      d.age += dt;
      const dist = Math.hypot(p.x - d.x, p.z - d.z);
      if (!d.magnet) {
        if (d.age > GRACE && dist < PICK_R && this.room(d.id, d.quality) > 0) d.magnet = true;
        continue;
      }
      if (dist > PICK_R * 2.5) {
        d.magnet = false;
        continue;
      }
      const k = 1 - Math.exp(-dt * 10);
      d.x += (p.x - d.x) * k;
      d.z += (p.z - d.z) * k;
      if (dist < 0.3) {
        const left = inv.add(d.id, d.qty, d.quality);
        if (left > 0) {
          d.qty = left;
          d.magnet = false;
          d.age = 0;
        } else {
          this.unmount(d);
          this.drops.splice(i, 1);
        }
      }
    }
  }

  update(): void {
    const map = this.game.world.current?.id;
    const t = this.game.time;
    for (const d of this.drops) {
      const here = d.map === map;
      if (!here) {
        if (d.sprite) d.sprite.visible = (d.sprite.userData.shadow as THREE.Mesh).visible = false;
        continue;
      }
      if (!d.sprite) d.sprite = this.makeSprite(d.id);
      const s = d.sprite;
      s.visible = true;
      const fy = this.game.world.heightAt(d.x, d.z);
      const bob = d.magnet ? 0.45 : 0.32 + Math.sin(t * 3 + d.seed) * 0.06;
      s.position.set(d.x, fy + bob, d.z);
      const shadow = s.userData.shadow as THREE.Mesh;
      shadow.position.set(d.x, fy + 0.02, d.z);
      shadow.visible = true;
    }
  }

  /** Camera-facing icon card (a mesh billboard like villager emotes: THREE.Sprite does not suit the post pipeline). */
  private makeSprite(id: string): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    const s = new THREE.Mesh(this.cardGeo, new THREE.MeshBasicMaterial({ map: iconTexture(id), transparent: true, alphaTest: 0.1, depthWrite: false, toneMapped: false }));
    s.renderOrder = 2;
    s.castShadow = s.receiveShadow = false;
    s.name = `drop:${id}`;
    s.onBeforeRender = (_r, _s, cam) => {
      s.quaternion.copy(cam.quaternion);
      s.updateMatrixWorld();
    };
    const sh = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    sh.renderOrder = 1;
    s.userData.shadow = sh;
    this.group.add(s, sh);
    return s;
  }

  private unmount(d: Drop): void {
    if (!d.sprite) return;
    this.group.remove(d.sprite, d.sprite.userData.shadow as THREE.Mesh);
    d.sprite.material.dispose();
    d.sprite = null;
  }

  save(): unknown {
    return { drops: this.drops.map(({ id, qty, quality, map, x, z }) => ({ id, qty, quality, map, x, z })) };
  }

  load(data: unknown): void {
    for (const d of this.drops) this.unmount(d);
    this.drops = [];
    const list = (data as { drops?: { id: string; qty: number; quality?: number; map: string; x: number; z: number }[] })?.drops;
    if (!Array.isArray(list)) return;
    for (const d of list) {
      if (!d || typeof d.id !== 'string' || !itemDef(d.id) || !(d.qty > 0)) continue;
      this.drops.push({ id: d.id, qty: d.qty | 0, quality: d.quality ?? 0, map: d.map, x: d.x, z: d.z, age: GRACE, seed: Math.random() * 10, sprite: null, magnet: false });
    }
  }
}
