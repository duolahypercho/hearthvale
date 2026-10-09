/**
 * Tile target cursor: four bold rounded corner brackets on the tile the farmer is about to act on
 * (and every tile of a charged area-of-effect) — outline only, no wash over the soil, so you can
 * watch the ground change under it. Each bracket has a soft dark under-stroke so it reads on
 * bright grass and on wet soil alike. Instanced textured quads hugging the ground / soil height,
 * colour-coded (valid = warm cream, blocked = muted red, charge = gold, neutral = dim white) with
 * a gentle breathing inset. One draw call.
 */
import * as THREE from 'three';

function cursorTexture(w = 1): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const pad = 9;
  const r = 20;
  // A light inner wash (~10 %, tinted per state: cream valid, red blocked) so the target reads at
  // the gameplay camera on pale path and dry soil alike (r7: thin brackets vanished there).
  // (r16) A slightly stronger state-tinted ground fill carries the read; the brackets got lighter.
  // (r17) No wash at all: an alpha fill read as a pale glass coaster over grass / fresh soil and
  // bleached the very tile the player is watching change. Brackets + a dotted rim carry the read.
  // (r19) Lighter, shorter strokes (r9 critic: oversized and pale), a darker contact under-stroke that
  // seats the bracket on the ground.
  const L = 26;
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
    corner(x + sx * 1.2, y + sy * 1.8, sx, sy);
    g.lineWidth = 8.5 * w;
    g.strokeStyle = 'rgba(24,12,4,0.5)';
    g.stroke();
  }
  for (const [x, y, sx, sy] of cs) {
    corner(x, y, sx, sy);
    g.lineWidth = 4.2 * w;
    g.strokeStyle = 'rgba(255,255,255,0.86)';
    g.stroke();
  }
  // Faint dotted edge joining the brackets (reads the tile edge without a solid frame).
  g.setLineDash([2, 9]);
  g.lineWidth = 2.4 * Math.min(1.4, w);
  g.strokeStyle = 'rgba(255,255,255,0.22)';
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

/** Soft gold wash for each tile of a charged area (the area's one outline is drawn separately). */
function fillTexture(): THREE.CanvasTexture {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  // Faint and edge-to-edge (no seams: a dark grid between washed tiles read as a mat).
  // (r18) Fainter still: the flat wash sank into the furrow troughs and tinted a slammed block gold.
  g.fillStyle = 'rgba(255,255,255,0.05)';
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * One merged rounded outline around a charged footprint (r7 critic: nine overlapping bracket sets
 * cluttered the gold 3×3 slam). A flat ring: dark under-stroke + bright core, vertex coloured.
 */
function areaOutline(w: number, d: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const R = 0.2;
  const pts: [number, number][] = [];
  const hw = w / 2 - R;
  const hd = d / 2 - R;
  const corners: [number, number, number][] = [[hw, hd, 0], [-hw, hd, Math.PI / 2], [-hw, -hd, Math.PI], [hw, -hd, Math.PI * 1.5]];
  for (const [cx, cz, a0] of corners) for (let i = 0; i <= 6; i++) {
    const a = a0 + (i / 6) * (Math.PI / 2);
    pts.push([cx + Math.cos(a) * R, cz + Math.sin(a) * R]);
  }
  const band = (inner: number, outer: number, rgb: [number, number, number], alpha: number, y: number): void => {
    const base = pos.length / 3;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const [x, z] = pts[i]!;
      const [px, pz] = pts[(i - 1 + n) % n]!;
      const [qx, qz] = pts[(i + 1) % n]!;
      let nx = qz - pz;
      let nz = -(qx - px);
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
      pos.push(x + nx * inner, y, z + nz * inner, x + nx * outer, y, z + nz * outer);
      col.push(...rgb, alpha, ...rgb, alpha);
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      const b = base + ((i + 1) % n) * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  };
  // (r19) A fine line, not a neon tube (r9 critic): thin bright core over a narrow dark contact band.
  band(-0.035, 0.045, [0.11, 0.06, 0.02], 0.42, 0);
  band(-0.014, 0.017, [1, 1, 1], 0.9, 0.002);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

/** `hover`: the tile under the mouse when it's out of reach (a faint, smaller bracket — "you're pointing here"). */
export type CursorState = 'valid' | 'blocked' | 'charge' | 'neutral' | 'hover';

const COLORS: Record<CursorState, THREE.Color> = {
  valid: new THREE.Color(0xfff1c8),
  blocked: new THREE.Color(0xe8705e),
  charge: new THREE.Color(0xf6d47c),
  neutral: new THREE.Color(0xdfe6ee),
  hover: new THREE.Color(0xf4ead2),
};
const ALPHA: Record<CursorState, number> = { valid: 0.8, blocked: 0.9, charge: 0.85, neutral: 0.5, hover: 0.28 };

export class TileCursor {
  /** (r25) Charged-area wash multiplier: the slam turns it off for good (per-tile quads at different
   *  heights left faint seam lines over the struck block). */
  wash = 1;
  readonly mesh: THREE.InstancedMesh;
  /** ✕ marks in the middle of blocked tiles (child of `mesh`, same draw order). */
  private cross: THREE.InstancedMesh;
  private t = 0;
  private tiles: { x: number; y: number; z: number; state: CursorState }[] = [];
  private m = new THREE.Matrix4();
  private c = new THREE.Color();
  private shown = 0;
  /** Impact pulse (1 → 0 over ~0.35 s): the bracket punches out and flares on the hit frame. */
  private pulseT = 0;

  /** (r20) Stroke weight by lens distance: thin up close, ~1.8× at the gameplay camera. */
  private texNear = cursorTexture(1);
  private texFar: THREE.CanvasTexture | null = null;
  private far = false;

  /** Pick the stroke weight for the camera's distance to the cursor (m). */
  setLens(dist: number): void {
    const far = dist > 12.5;
    if (far === this.far) return;
    this.far = far;
    if (far && !this.texFar) this.texFar = cursorTexture(1.8);
    (this.mesh.material as THREE.MeshBasicMaterial).map = far ? this.texFar : this.texNear;
  }

  constructor(max = 25) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: this.texNear, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false, fog: false });
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
    const fg = new THREE.PlaneGeometry(1, 1);
    fg.rotateX(-Math.PI / 2);
    const fm = new THREE.MeshBasicMaterial({ map: fillTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false, fog: false });
    fm.name = 'tile-cursor-fill';
    this.fill = new THREE.InstancedMesh(fg, fm, max);
    this.fill.name = 'tile-cursor-fill';
    this.fill.frustumCulled = false;
    this.fill.renderOrder = 4;
    this.fill.count = 0;
    for (let i = 0; i < max; i++) this.fill.setColorAt(i, this.c.set(0xffffff));
    this.mesh.add(this.fill);
    const om = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5, toneMapped: false, fog: false, side: THREE.DoubleSide });
    om.name = 'tile-cursor-area';
    this.area = new THREE.Mesh(new THREE.BufferGeometry(), om);
    this.area.name = 'tile-cursor-area';
    this.area.frustumCulled = false;
    this.area.renderOrder = 5;
    this.area.visible = false;
    this.mesh.add(this.area);
  }

  private fill: THREE.InstancedMesh;
  private area: THREE.Mesh;
  private areaKey = '';

  /** Replace the targeted tiles (world tile coords + surface height). */
  set(tiles: { x: number; y: number; z: number; state: CursorState }[]): void {
    this.tiles = tiles.slice(0, this.mesh.instanceMatrix.count);
  }

  /** Flash the brackets on the impact frame (the player sees exactly which tiles were hit). */
  pulse(): void {
    this.pulseT = 1;
  }

  /** (r17) A glancing blow on untillable ground: the red ✕ pops (1 → 1.6 → 1) and flares. */
  pop(): void {
    this.popT = 1;
  }
  private popT = 0;

  update(dt: number, visible: boolean): void {
    this.t += dt;
    this.pulseT = Math.max(0, this.pulseT - dt / 0.35);
    this.popT = Math.max(0, this.popT - dt / 0.45);
    const pk = this.pulseT * this.pulseT;
    const target = visible ? 1 : 0;
    this.shown += (target - this.shown) * (1 - Math.exp(-dt * (visible ? 14 : 22)));
    const n = this.shown > 0.02 ? this.tiles.length : 0;
    this.mesh.count = n;
    this.cross.count = 0;
    this.fill.count = 0;
    this.area.visible = false;
    if (!n) return;
    // A charged area of several tiles: one merged outline + a gold wash per tile (blocked tiles
    // inside it keep their red bracket + ✕), instead of a bracket set on every tile.
    const merged = n > 1 && this.tiles.some((t) => t.state === 'charge');
    if (merged) {
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      let y = -Infinity;
      for (const t of this.tiles) {
        x0 = Math.min(x0, t.x);
        x1 = Math.max(x1, t.x + 1);
        z0 = Math.min(z0, t.z);
        z1 = Math.max(z1, t.z + 1);
        y = Math.max(y, t.y);
      }
      const k = `${x0},${x1},${z0},${z1}`;
      if (k !== this.areaKey) {
        this.areaKey = k;
        this.area.geometry.dispose();
        this.area.geometry = areaOutline(x1 - x0, z1 - z0);
      }
      const b = 1 + Math.sin(this.t * 12) * 0.008 + pk * 0.05;
      this.area.position.set((x0 + x1) / 2, y + 0.004, (z0 + z1) / 2);
      this.area.scale.set(b, 1, b);
      this.area.visible = true;
      const om = this.area.material as THREE.MeshBasicMaterial;
      om.color.copy(COLORS.charge).multiplyScalar(Math.min(1.25, 1 + pk * 0.6));
      om.opacity = this.shown;
    }
    let nx = 0;
    let nb = 0;
    let nf = 0;
    for (let i = 0; i < n; i++) {
      const tl = this.tiles[i]!;
      if (merged && tl.state === 'charge') {
        this.m.makeScale(1, 1, 1).setPosition(tl.x + 0.5, tl.y, tl.z + 0.5);
        this.fill.setMatrixAt(nf, this.m);
        // (r18) The wash gets out of the way on the slam (the fresh earth takes the stage), like the brackets.
        this.fill.setColorAt(nf, this.c.copy(COLORS.charge).multiplyScalar(this.shown * 0.85 * (1 - pk * 0.85) * this.wash));
        nf++;
        continue;
      }
      // Brackets breathe inward a touch; charged tiles pulse faster.
      const b = tl.state === 'charge' ? Math.sin(this.t * 12 + i) * 0.03 : Math.sin(this.t * 5) * 0.022;
      // (r16) On impact the bracket compresses onto the tile and fades, giving the hit the stage.
      // (r19) Seated a touch inside the tile edge; collapses hard onto the tile on the hit (~0.1 s).
      const s = (0.9 + 0.1 * this.shown) * (0.96 + b - pk * 0.3) * (tl.state === 'hover' ? 0.78 : 1);
      this.m.makeScale(s, 1, s).setPosition(tl.x + 0.5, tl.y, tl.z + 0.5);
      this.mesh.setMatrixAt(nb, this.m);
      this.mesh.setColorAt(nb, this.c.copy(COLORS[tl.state]).multiplyScalar(this.shown * ALPHA[tl.state]));
      nb++;
      if (tl.state === 'blocked' && nx < 4) {
        const pp = this.popT > 0 ? Math.sin((1 - this.popT) * Math.PI) * this.popT : 0;
        const k = 0.34 * (0.85 + 0.15 * this.shown) * (1 + pp * 1.1);
        this.m.makeScale(k, 1, k).setPosition(tl.x + 0.5, tl.y + 0.002, tl.z + 0.5);
        this.cross.setMatrixAt(nx, this.m);
        this.cross.setColorAt(nx, this.c.copy(COLORS.blocked).multiplyScalar(this.shown * (1 + pp * 0.5)));
        nx++;
      }
    }
    this.mesh.count = nb;
    this.fill.count = nf;
    if (nf) {
      this.fill.instanceMatrix.needsUpdate = true;
      if (this.fill.instanceColor) this.fill.instanceColor.needsUpdate = true;
    }
    this.cross.count = nx;
    if (nx) {
      this.cross.instanceMatrix.needsUpdate = true;
      if (this.cross.instanceColor) this.cross.instanceColor.needsUpdate = true;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, this.shown * 1.1) * 0.78 * (1 - 0.92 * Math.sqrt(this.pulseT));
  }
}
