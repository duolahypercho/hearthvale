/**
 * Tile target cursor: four bold rounded corner brackets on the tile the farmer is about to act on
 * (and every tile of a charged area-of-effect) — outline only, no wash over the soil, so you can
 * watch the ground change under it. Each bracket has a soft dark under-stroke so it reads on
 * bright grass and on wet soil alike. Instanced textured quads hugging the ground / soil height,
 * colour-coded (valid = warm cream, blocked = muted red, charge = gold, neutral = dim white) with
 * a gentle breathing inset. One draw call.
 */
import * as THREE from 'three';

function cursorTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const pad = 9;
  const r = 20;
  // Barely-there inner tint (≤ 6 %) so a lone tile on bare soil still reads as "selected".
  g.fillStyle = 'rgba(255,255,255,0.05)';
  g.beginPath();
  g.roundRect(pad + 6, pad + 6, S - (pad + 6) * 2, S - (pad + 6) * 2, r - 6);
  g.fill();
  const L = 38;
  const corner = (x: number, y: number, sx: number, sy: number): void => {
    g.beginPath();
    g.moveTo(x, y + sy * L);
    g.lineTo(x, y + sy * r);
    g.quadraticCurveTo(x, y, x + sx * r, y);
    g.lineTo(x + sx * L, y);
  };
  const cs: [number, number, number, number][] = [
    [pad, pad, 1, 1],
    [S - pad, pad, -1, 1],
    [pad, S - pad, 1, -1],
    [S - pad, S - pad, -1, -1],
  ];
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // Soft dark under-stroke (a contact shadow for the bracket).
  for (const [x, y, sx, sy] of cs) {
    corner(x + sx * 1.5, y + sy * 1.5, sx, sy);
    g.lineWidth = 15;
    g.strokeStyle = 'rgba(28,16,6,0.38)';
    g.stroke();
  }
  for (const [x, y, sx, sy] of cs) {
    corner(x, y, sx, sy);
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.stroke();
  }
  // Faint dotted edge joining the brackets (reads the tile edge without a solid frame).
  g.setLineDash([2, 9]);
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(255,255,255,0.45)';
  g.beginPath();
  g.roundRect(pad, pad, S - pad * 2, S - pad * 2, r);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A rounded "✕" (dark under-stroke + light core) marking a tile the tool can't work. */
function crossTexture(): THREE.CanvasTexture {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.lineCap = 'round';
  const X = (w: number, style: string, o = 0): void => {
    g.lineWidth = w;
    g.strokeStyle = style;
    g.beginPath();
    g.moveTo(16 + o, 16 + o);
    g.lineTo(48 + o, 48 + o);
    g.moveTo(48 + o, 16 + o);
    g.lineTo(16 + o, 48 + o);
    g.stroke();
  };
  X(15, 'rgba(28,10,6,0.45)', 1.5);
  X(9, 'rgba(255,255,255,1)');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export type CursorState = 'valid' | 'blocked' | 'charge' | 'neutral';

const COLORS: Record<CursorState, THREE.Color> = {
  valid: new THREE.Color(0xfff1c8),
  blocked: new THREE.Color(0xe8705e),
  charge: new THREE.Color(0xffcf3a),
  neutral: new THREE.Color(0xdfe6ee),
};
const ALPHA: Record<CursorState, number> = { valid: 1, blocked: 0.8, charge: 1, neutral: 0.55 };

export class TileCursor {
  readonly mesh: THREE.InstancedMesh;
  /** ✕ marks in the middle of blocked tiles (child of `mesh`, same draw order). */
  private cross: THREE.InstancedMesh;
  private t = 0;
  private tiles: { x: number; y: number; z: number; state: CursorState }[] = [];
  private m = new THREE.Matrix4();
  private c = new THREE.Color();
  private shown = 0;

  constructor(max = 25) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: cursorTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false, fog: false });
    mat.name = 'tile-cursor';
    this.mesh = new THREE.InstancedMesh(g, mat, max);
    this.mesh.name = 'tile-cursor';
    this.mesh.userData.perfTag = 'farmfx';
    this.mesh.userData.noAO = true;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.count = 0;
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, this.c.set(0xffffff));
    const cg = new THREE.PlaneGeometry(1, 1);
    cg.rotateX(-Math.PI / 2);
    const cm = new THREE.MeshBasicMaterial({ map: crossTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false, fog: false });
    cm.name = 'tile-cursor-x';
    this.cross = new THREE.InstancedMesh(cg, cm, 4);
    this.cross.name = 'tile-cursor-x';
    this.cross.frustumCulled = false;
    this.cross.renderOrder = 4;
    this.cross.count = 0;
    for (let i = 0; i < 4; i++) this.cross.setColorAt(i, this.c.set(0xffffff));
    this.mesh.add(this.cross);
  }

  /** Replace the targeted tiles (world tile coords + surface height). */
  set(tiles: { x: number; y: number; z: number; state: CursorState }[]): void {
    this.tiles = tiles.slice(0, this.mesh.instanceMatrix.count);
  }

  update(dt: number, visible: boolean): void {
    this.t += dt;
    const target = visible ? 1 : 0;
    this.shown += (target - this.shown) * (1 - Math.exp(-dt * (visible ? 14 : 22)));
    const n = this.shown > 0.02 ? this.tiles.length : 0;
    this.mesh.count = n;
    this.cross.count = 0;
    if (!n) return;
    let nx = 0;
    for (let i = 0; i < n; i++) {
      const tl = this.tiles[i]!;
      // Brackets breathe inward a touch; charged tiles pulse faster.
      const b = tl.state === 'charge' ? Math.sin(this.t * 12 + i) * 0.03 : Math.sin(this.t * 5) * 0.022;
      const s = (0.9 + 0.1 * this.shown) * (1.02 + b);
      this.m.makeScale(s, 1, s).setPosition(tl.x + 0.5, tl.y, tl.z + 0.5);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.c.copy(COLORS[tl.state]).multiplyScalar(this.shown * ALPHA[tl.state]));
      if (tl.state === 'blocked' && nx < 4) {
        const k = 0.34 * (0.85 + 0.15 * this.shown);
        this.m.makeScale(k, 1, k).setPosition(tl.x + 0.5, tl.y + 0.002, tl.z + 0.5);
        this.cross.setMatrixAt(nx, this.m);
        this.cross.setColorAt(nx, this.c.copy(COLORS.blocked).multiplyScalar(this.shown));
        nx++;
      }
    }
    this.cross.count = nx;
    if (nx) {
      this.cross.instanceMatrix.needsUpdate = true;
      if (this.cross.instanceColor) this.cross.instanceColor.needsUpdate = true;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, this.shown * 1.1);
  }
}
