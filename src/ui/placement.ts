/**
 * In-world placement preview: while a placeable item (sprinkler, chest, scarecrow, fence, path …) is the
 * selected toolbar item, a translucent ghost of it hovers on the tile the farmer faces, over a pulsing tile
 * frame — green when it can go there, red when the tile is blocked. Sprinklers also tint the tiles they
 * will water. 3 draw calls, only while a placeable is held.
 */
import * as THREE from 'three';
import type { Game } from '../core/game';
import { itemDef } from '../data/items';
import { SPRINKLERS, sprinklerOffsets } from '../data/crops';

const OK = new THREE.Color(0x9cf07a);
const BAD = new THREE.Color(0xff6a5a);
const WATER = new THREE.Color(0x7ec8ff);

function ghostGeometry(id: string): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, x = 0, y = 0, z = 0): void => {
    g.translate(x, y, z);
    parts.push(g.toNonIndexed());
  };
  if (SPRINKLERS[id] || /sprinkler/i.test(id)) {
    add(new THREE.CylinderGeometry(0.22, 0.26, 0.08, 16), 0, 0.04, 0);
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 10), 0, 0.26, 0);
    add(new THREE.SphereGeometry(0.1, 12, 8), 0, 0.46, 0);
  } else if (/chest/i.test(id)) {
    add(new THREE.BoxGeometry(0.72, 0.42, 0.5), 0, 0.21, 0);
    add(new THREE.CylinderGeometry(0.25, 0.25, 0.72, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), 0, 0.42, 0);
  } else if (/scarecrow/i.test(id)) {
    add(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 8), 0, 0.65, 0);
    add(new THREE.BoxGeometry(0.9, 0.06, 0.06), 0, 0.95, 0);
    add(new THREE.SphereGeometry(0.17, 12, 8), 0, 1.3, 0);
    add(new THREE.ConeGeometry(0.3, 0.2, 12), 0, 1.5, 0);
  } else if (/fence/i.test(id)) {
    add(new THREE.BoxGeometry(0.1, 0.7, 0.1), -0.4, 0.35, 0);
    add(new THREE.BoxGeometry(0.1, 0.7, 0.1), 0.4, 0.35, 0);
    add(new THREE.BoxGeometry(1, 0.08, 0.05), 0, 0.5, 0);
    add(new THREE.BoxGeometry(1, 0.08, 0.05), 0, 0.25, 0);
  } else if (/path|floor/i.test(id)) {
    add(new THREE.BoxGeometry(0.92, 0.04, 0.92), 0, 0.02, 0);
  } else {
    add(new THREE.BoxGeometry(0.6, 0.6, 0.6), 0, 0.3, 0);
  }
  const pos: number[] = [];
  for (const p of parts) pos.push(...(p.getAttribute('position').array as Float32Array));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export class PlacementGhost {
  private root = new THREE.Group();
  private frame: THREE.Mesh;
  private ghost: THREE.Mesh;
  private water: THREE.InstancedMesh;
  private frameMat: THREE.MeshBasicMaterial;
  private ghostMat: THREE.MeshStandardMaterial;
  private waterMat: THREE.MeshBasicMaterial;
  private itemId = '';
  private added = false;
  private t = 0;

  constructor(private game: Game) {
    this.root.userData.perfTag = 'ui-ghost';
    this.root.visible = false;
    // Rounded tile frame (ring made from a shape with a hole).
    const s = new THREE.Shape();
    const r = 0.08;
    const h = 0.5;
    s.moveTo(-h + r, -h);
    s.lineTo(h - r, -h);
    s.quadraticCurveTo(h, -h, h, -h + r);
    s.lineTo(h, h - r);
    s.quadraticCurveTo(h, h, h - r, h);
    s.lineTo(-h + r, h);
    s.quadraticCurveTo(-h, h, -h, h - r);
    s.lineTo(-h, -h + r);
    s.quadraticCurveTo(-h, -h, -h + r, -h);
    const hole = new THREE.Path();
    const k = 0.4;
    hole.moveTo(-k, -k);
    hole.lineTo(-k, k);
    hole.lineTo(k, k);
    hole.lineTo(k, -k);
    hole.lineTo(-k, -k);
    s.holes.push(hole);
    const fg = new THREE.ShapeGeometry(s, 4).rotateX(-Math.PI / 2);
    this.frameMat = new THREE.MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.85, depthWrite: false });
    this.frame = new THREE.Mesh(fg, this.frameMat);
    this.frame.renderOrder = 5;
    this.ghostMat = new THREE.MeshStandardMaterial({ color: OK, emissive: OK, emissiveIntensity: 0.35, transparent: true, opacity: 0.45, depthWrite: false, roughness: 0.6 });
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), this.ghostMat);
    this.ghost.renderOrder = 6;
    this.waterMat = new THREE.MeshBasicMaterial({ color: WATER, transparent: true, opacity: 0.35, depthWrite: false });
    this.water = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.86, 0.86).rotateX(-Math.PI / 2), this.waterMat, 25);
    this.water.count = 0;
    this.water.frustumCulled = false;
    this.water.renderOrder = 4;
    this.root.add(this.frame, this.ghost, this.water);
    for (const o of [this.frame, this.ghost, this.water]) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  }

  update(active: boolean): void {
    const game = this.game;
    const inv = game.services.inventory;
    const st = inv?.selected();
    const d = st ? itemDef(st.id) : undefined;
    const map = game.world.current;
    const show = active && !!d && d.kind === 'placeable' && !!map && game.player.controllable !== false;
    if (!show) {
      this.root.visible = false;
      return;
    }
    if (!this.added) {
      game.scene.add(this.root);
      this.added = true;
    }
    if (this.itemId !== d!.id) {
      this.itemId = d!.id;
      this.ghost.geometry.dispose();
      this.ghost.geometry = ghostGeometry(d!.id);
    }
    const t = game.player.facingTile();
    const grid = map!.grid;
    const ok = grid.inBounds(t.x, t.z) && !grid.getObject(t.x, t.z) && grid.isWalkable(t.x, t.z) && !grid.hasFlag(t.x, t.z, 1 << 5);
    const cx = t.x + 0.5;
    const cz = t.z + 0.5;
    const y = game.world.heightAt(cx, cz);
    this.t += 1 / 60;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 5);
    const col = ok ? OK : BAD;
    this.frameMat.color.copy(col);
    this.frameMat.opacity = 0.55 + pulse * 0.4;
    this.ghostMat.color.copy(col);
    this.ghostMat.emissive.copy(col);
    this.ghostMat.opacity = 0.38 + pulse * 0.14;
    this.frame.position.set(cx, y + 0.04, cz);
    this.ghost.position.set(cx, y + 0.02 + pulse * 0.04, cz);
    this.ghost.rotation.y = Math.sin(this.t * 1.3) * 0.08;
    // Sprinkler reach.
    const offs = SPRINKLERS[d!.id] ? sprinklerOffsets(d!.id) : [];
    const m = new THREE.Matrix4();
    let n = 0;
    for (const [dx, dz] of offs) {
      if (n >= 25) break;
      const x = cx + dx;
      const z = cz + dz;
      m.makeTranslation(x, game.world.heightAt(x, z) + 0.035, z);
      this.water.setMatrixAt(n++, m);
    }
    this.water.count = ok ? n : 0;
    this.water.instanceMatrix.needsUpdate = true;
    this.waterMat.opacity = 0.2 + pulse * 0.2;
    this.root.visible = true;
  }
}
