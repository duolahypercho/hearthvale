/**
 * Tile target cursor: a soft rounded frame with bold corner brackets on the tile the farmer is
 * about to act on (and every tile of a charged area-of-effect). Instanced textured quads that
 * hug the ground / soil height, colour-coded (valid = warm cream, blocked = muted red,
 * charge = gold) with a gentle breathing pulse. One draw call.
 */
import * as THREE from 'three';

function cursorTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const pad = 8;
  const r = 22;
  const rr = (x: number, y: number, w: number, h: number, rad: number): void => {
    g.beginPath();
    g.moveTo(x + rad, y);
    g.arcTo(x + w, y, x + w, y + h, rad);
    g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad);
    g.arcTo(x, y, x + w, y, rad);
    g.closePath();
  };
  // Soft inner fill (brighter towards the rim).
  const grad = g.createRadialGradient(S / 2, S / 2, 8, S / 2, S / 2, S * 0.62);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1, 'rgba(255,255,255,0.26)');
  rr(pad, pad, S - pad * 2, S - pad * 2, r);
  g.fillStyle = grad;
  g.fill();
  // Thin full outline
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  rr(pad + 2, pad + 2, S - pad * 2 - 4, S - pad * 2 - 4, r - 2);
  g.stroke();
  // Bold corner brackets with a dark under-stroke so they read on bright grass and dark soil.
  const L = 34;
  const corner = (x: number, y: number, sx: number, sy: number): void => {
    g.beginPath();
    g.moveTo(x, y + sy * L);
    g.lineTo(x, y + sy * r * 0.5);
    g.quadraticCurveTo(x, y, x + sx * r * 0.5, y);
    g.lineTo(x + sx * L, y);
  };
  const cs: [number, number, number, number][] = [
    [pad + 3, pad + 3, 1, 1],
    [S - pad - 3, pad + 3, -1, 1],
    [pad + 3, S - pad - 3, 1, -1],
    [S - pad - 3, S - pad - 3, -1, -1],
  ];
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const [x, y, sx, sy] of cs) {
    corner(x, y, sx, sy);
    g.lineWidth = 12;
    g.strokeStyle = 'rgba(40,24,10,0.45)';
    g.stroke();
  }
  for (const [x, y, sx, sy] of cs) {
    corner(x, y, sx, sy);
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export type CursorState = 'valid' | 'blocked' | 'charge' | 'neutral';

const COLORS: Record<CursorState, THREE.Color> = {
  valid: new THREE.Color(0xfff3cc),
  blocked: new THREE.Color(0xff8a7a),
  charge: new THREE.Color(0xffd24a),
  neutral: new THREE.Color(0xe8f0ff),
};

export class TileCursor {
  readonly mesh: THREE.InstancedMesh;
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
  }

  /** Replace the targeted tiles (world tile coords + surface height). */
  set(tiles: { x: number; y: number; z: number; state: CursorState }[]): void {
    this.tiles = tiles.slice(0, this.mesh.instanceMatrix.count);
  }

  update(dt: number, visible: boolean): void {
    this.t += dt;
    const target = visible ? 1 : 0;
    this.shown += (target - this.shown) * (1 - Math.exp(-dt * 14));
    const n = this.shown > 0.02 ? this.tiles.length : 0;
    this.mesh.count = n;
    if (!n) return;
    const pulse = 1 + Math.sin(this.t * 5.5) * 0.025;
    for (let i = 0; i < n; i++) {
      const tl = this.tiles[i]!;
      const s = (0.92 + 0.08 * this.shown) * (tl.state === 'charge' ? 1 + Math.sin(this.t * 12 + i) * 0.03 : pulse);
      this.m.makeScale(s, 1, s).setPosition(tl.x + 0.5, tl.y, tl.z + 0.5);
      this.mesh.setMatrixAt(i, this.m);
      const k = this.shown * (tl.state === 'blocked' ? 0.7 : 0.95 + Math.sin(this.t * 5.5) * 0.05);
      this.mesh.setColorAt(i, this.c.copy(COLORS[tl.state]).multiplyScalar(k));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, this.shown * 1.1);
  }
}
