/**
 * In-world placement preview: while a placeable item (sprinkler, chest, scarecrow, fence, path …) is the
 * selected toolbar item, a ghost of it hovers on the tile the farmer faces — the item in its own colours at
 * ~55 % opacity with a pulsing inverted-hull outline (green = can place, red = blocked) — over a crisp dashed
 * tile frame. Sprinklers show every tile they will water: a dashed blue outline + soft fill where the water
 * lands, and a red tile with an X where something is in the way. ≤ 6 draw calls, only while a placeable is held.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../core/game';
import { itemDef } from '../data/items';
import { SPRINKLERS, sprinklerOffsets } from '../data/crops';

const OK = new THREE.Color(0x8cf06a);
const BAD = new THREE.Color(0xe0584a);
const WATER = new THREE.Color(0x7ec8ff);
const MAXT = 25;

type Part = [THREE.BufferGeometry, number, number, number, number];

/** A stylised stand-in of the real prop, vertex-coloured per part. */
function ghostGeometry(id: string): THREE.BufferGeometry {
  const parts: Part[] = [];
  const add = (g: THREE.BufferGeometry, col: number, x = 0, y = 0, z = 0): void => {
    parts.push([g, col, x, y, z]);
  };
  const brass = id === 'goldSprinkler' ? 0xf2c230 : id === 'brassSprinkler' ? 0xd98a3a : 0x9aa4ae;
  if (SPRINKLERS[id] || /sprinkler/i.test(id)) {
    const big = id === 'goldSprinkler' ? 1.25 : id === 'brassSprinkler' ? 1.12 : 1;
    add(new THREE.CylinderGeometry(0.24 * big, 0.28 * big, 0.08, 18), 0x6a6a70, 0, 0.04, 0);
    add(new THREE.CylinderGeometry(0.06, 0.07, 0.34 * big, 10), brass, 0, 0.25 * big, 0);
    add(new THREE.SphereGeometry(0.12 * big, 14, 10), brass, 0, 0.44 * big, 0);
    const n = id === 'goldSprinkler' ? 8 : id === 'brassSprinkler' ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      add(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6).rotateZ(Math.PI / 2).rotateY(a), 0x5a5a60, Math.cos(a) * 0.12 * big, 0.44 * big, -Math.sin(a) * 0.12 * big);
    }
  } else if (/chest/i.test(id)) {
    add(new THREE.BoxGeometry(0.72, 0.42, 0.5), 0xb07038, 0, 0.21, 0);
    add(new THREE.CylinderGeometry(0.25, 0.25, 0.72, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), 0xc4843e, 0, 0.42, 0);
    add(new THREE.BoxGeometry(0.76, 0.06, 0.54), 0x5a5a60, 0, 0.42, 0);
    add(new THREE.BoxGeometry(0.1, 0.12, 0.04), 0xf2c230, 0, 0.36, 0.26);
  } else if (/scarecrow/i.test(id)) {
    add(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 8), 0x8a5a30, 0, 0.65, 0);
    add(new THREE.BoxGeometry(0.9, 0.06, 0.06), 0x8a5a30, 0, 0.95, 0);
    add(new THREE.CylinderGeometry(0.2, 0.26, 0.5, 10), 0x5a7ab0, 0, 0.9, 0);
    add(new THREE.SphereGeometry(0.17, 12, 8), 0xe8d8a8, 0, 1.3, 0);
    add(new THREE.ConeGeometry(0.3, 0.2, 12), 0xc8a040, 0, 1.5, 0);
  } else if (/fence/i.test(id)) {
    add(new THREE.BoxGeometry(0.1, 0.7, 0.1), 0x9a6a3a, -0.4, 0.35, 0);
    add(new THREE.BoxGeometry(0.1, 0.7, 0.1), 0x9a6a3a, 0.4, 0.35, 0);
    add(new THREE.BoxGeometry(1, 0.08, 0.05), 0xb07a44, 0, 0.5, 0);
    add(new THREE.BoxGeometry(1, 0.08, 0.05), 0xb07a44, 0, 0.25, 0);
  } else if (/path|floor/i.test(id)) {
    add(new THREE.BoxGeometry(0.44, 0.05, 0.44), 0xb8b2a6, -0.22, 0.025, -0.22);
    add(new THREE.BoxGeometry(0.44, 0.05, 0.44), 0xc8c2b4, 0.22, 0.025, -0.22);
    add(new THREE.BoxGeometry(0.44, 0.05, 0.44), 0xc4beb0, -0.22, 0.025, 0.22);
    add(new THREE.BoxGeometry(0.44, 0.05, 0.44), 0xaca698, 0.22, 0.025, 0.22);
  } else {
    add(new THREE.BoxGeometry(0.6, 0.6, 0.6), 0xb08050, 0, 0.3, 0);
  }
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (const [g, hex, x, y, z] of parts) {
    g.translate(x, y, z);
    const p = g.toNonIndexed().getAttribute('position').array as Float32Array;
    pos.push(...p);
    c.setHex(hex);
    for (let i = 0; i < p.length / 3; i++) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Crisp dashed square outline (flat, tile-sized), one geometry. */
function dashedSquare(size: number, dashes: number, w: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const h = size / 2;
  const step = size / dashes;
  const len = step * 0.58;
  for (let i = 0; i < dashes; i++) {
    const o = -h + step * (i + 0.5);
    for (const [x, z, rot] of [
      [o, -h, 0],
      [o, h, 0],
      [-h, o, 1],
      [h, o, 1],
    ] as [number, number, number][]) {
      const g = new THREE.PlaneGeometry(rot ? w : len, rot ? len : w).rotateX(-Math.PI / 2);
      g.translate(x, 0, z);
      parts.push(g.toNonIndexed());
    }
  }
  const pos: number[] = [];
  for (const p of parts) pos.push(...(p.getAttribute('position').array as Float32Array));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function crossGeometry(s: number, w: number): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(s, w).rotateX(-Math.PI / 2).rotateY(Math.PI / 4).toNonIndexed();
  const b = new THREE.PlaneGeometry(s, w).rotateX(-Math.PI / 2).rotateY(-Math.PI / 4).toNonIndexed();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...(a.getAttribute('position').array as Float32Array), ...(b.getAttribute('position').array as Float32Array)], 3));
  return g;
}

export class PlacementGhost {
  private root = new THREE.Group();
  private frame: THREE.Mesh;
  private ghost: THREE.Mesh;
  private hull: THREE.Mesh;
  private fills: THREE.InstancedMesh;
  private outlines: THREE.InstancedMesh;
  private crosses: THREE.InstancedMesh;
  private frameMat: THREE.MeshBasicMaterial;
  private ghostMat: THREE.MeshStandardMaterial;
  private hullMat: THREE.MeshBasicMaterial;
  private fillMat: THREE.MeshBasicMaterial;
  private outlineMat: THREE.MeshBasicMaterial;
  private crossMat: THREE.MeshBasicMaterial;
  private itemId = '';
  private added = false;
  private t = 0;

  constructor(private game: Game) {
    this.root.userData.perfTag = 'ui-ghost';
    this.root.visible = false;
    const flat = (m: THREE.Object3D, order: number): void => {
      m.renderOrder = order;
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = false;
    };
    this.frameMat = new THREE.MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.95, depthWrite: false });
    this.frame = new THREE.Mesh(dashedSquare(0.94, 3, 0.06), this.frameMat);
    flat(this.frame, 7);
    this.ghostMat = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: OK, emissiveIntensity: 0.25, transparent: true, opacity: 0.55, depthWrite: false, roughness: 0.55 });
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), this.ghostMat);
    flat(this.ghost, 8);
    // Inverted hull: the same mesh pushed out along its normals, back faces only → a crisp pulsing outline.
    this.hullMat = new THREE.MeshBasicMaterial({ color: OK, side: THREE.BackSide, transparent: true, opacity: 0.7, depthWrite: false });
    this.hullMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normal * 0.022;');
    };
    this.hull = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), this.hullMat);
    flat(this.hull, 7);
    this.fillMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false });
    this.fills = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2), this.fillMat, MAXT + 1);
    this.fills.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((MAXT + 1) * 3), 3);
    flat(this.fills, 4);
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false });
    this.outlines = new THREE.InstancedMesh(dashedSquare(0.86, 3, 0.04), this.outlineMat, MAXT);
    this.outlines.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXT * 3), 3);
    flat(this.outlines, 5);
    this.crossMat = new THREE.MeshBasicMaterial({ color: BAD, transparent: true, opacity: 0.95, depthWrite: false });
    this.crosses = new THREE.InstancedMesh(crossGeometry(0.42, 0.07), this.crossMat, MAXT + 1);
    flat(this.crosses, 6);
    this.root.add(this.fills, this.outlines, this.crosses, this.frame, this.hull, this.ghost);
  }

  private free(x: number, z: number): boolean {
    const grid = this.game.world.current?.grid;
    return !!grid && grid.inBounds(x, z) && !grid.getObject(x, z) && grid.isWalkable(x, z) && !grid.hasFlag(x, z, 1 << 5);
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
      this.hull.geometry.dispose();
      this.ghost.geometry = ghostGeometry(d!.id);
      // Smooth normals for the hull so the outline stays unbroken at box corners.
      const h = this.ghost.geometry.clone();
      h.deleteAttribute('normal');
      h.deleteAttribute('color');
      this.hull.geometry = mergeVertices(h, 1e-4);
      this.hull.geometry.computeVertexNormals();
    }
    const t = game.player.facingTile();
    const ok = this.free(t.x, t.z);
    const cx = t.x + 0.5;
    const cz = t.z + 0.5;
    const y = game.world.heightAt(cx, cz);
    this.t += 1 / 60;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 5);
    const col = ok ? OK : BAD;
    this.frameMat.color.copy(col);
    this.frameMat.opacity = 0.75 + pulse * 0.25;
    this.hullMat.color.copy(col);
    this.hullMat.opacity = 0.35 + pulse * 0.4;
    this.ghostMat.emissive.copy(col);
    this.ghostMat.emissiveIntensity = 0.04 + pulse * 0.1;
    this.ghostMat.opacity = ok ? 0.62 : 0.45;
    this.frame.position.set(cx, y + 0.045, cz);
    this.frame.rotation.y = 0;
    const bob = pulse * 0.05;
    for (const m of [this.ghost, this.hull]) {
      m.position.set(cx, y + 0.02 + bob, cz);
      m.rotation.y = Math.sin(this.t * 1.3) * 0.08;
    }
    // Reach tiles: dashed outline everywhere the item reaches; blue fill where it works, red fill + X where blocked.
    const offs = SPRINKLERS[d!.id] ? sprinklerOffsets(d!.id) : [];
    const m = new THREE.Matrix4();
    let nf = 0;
    let no = 0;
    let nx = 0;
    const water = new THREE.Color().copy(WATER);
    const bad = new THREE.Color().copy(BAD);
    for (const [dx, dz] of offs) {
      if (no >= MAXT) break;
      const tx = t.x + dx;
      const tz = t.z + dz;
      const x = tx + 0.5;
      const z = tz + 0.5;
      const hy = game.world.heightAt(x, z);
      const g = game.world.current?.grid;
      const free = !!g && g.inBounds(tx, tz) && g.isWalkable(tx, tz) && !g.getObject(tx, tz);
      m.makeTranslation(x, hy + 0.03, z);
      this.fills.setMatrixAt(nf, m);
      this.fills.setColorAt(nf++, free ? water : bad);
      m.makeTranslation(x, hy + 0.04, z);
      this.outlines.setMatrixAt(no, m);
      this.outlines.setColorAt(no++, free ? water : bad);
      if (!free) {
        m.makeTranslation(x, hy + 0.05, z);
        this.crosses.setMatrixAt(nx++, m);
      }
    }
    // The target tile itself when blocked: red fill + X.
    if (!ok) {
      m.makeTranslation(cx, y + 0.03, cz);
      this.fills.setMatrixAt(nf, m);
      this.fills.setColorAt(nf++, bad);
      m.makeTranslation(cx, y + 0.05, cz);
      this.crosses.setMatrixAt(nx++, m);
    }
    this.fills.count = nf;
    this.outlines.count = no;
    this.crosses.count = nx;
    for (const im of [this.fills, this.outlines, this.crosses]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.visible = im.count > 0;
    }
    this.fillMat.opacity = 0.3 + pulse * 0.15;
    this.crossMat.opacity = 0.75 + pulse * 0.25;
    this.root.visible = true;
  }
}
