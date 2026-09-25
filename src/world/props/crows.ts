/**
 * Crows that raid unprotected crops: a tiny rig (body + head + two flapping wings) per bird,
 * with a small state machine — fly in on a swooping arc, flare and land, hop and peck the plant
 * (calling `onEat` on the third peck), then flap off when done or when the farmer comes near.
 */
import * as THREE from 'three';
import { MeshBuilder, lumpySphere, mat } from '../geom';
import { Rng } from '../../core/rng';
import { applyWorldFx } from '../../render/worldfx';
import { patchMaterial, after } from '../../render/patch';

type State = 'in' | 'peck' | 'out';

interface Crow {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  wingL: THREE.Group;
  wingR: THREE.Group;
  /** Closed wings (smooth volumes along the flanks, primaries crossing over the tail) on the ground. */
  folded: THREE.Mesh;
  state: State;
  t: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  exit: THREE.Vector3;
  pecks: number;
  peckT: number;
  onEat: (() => void) | null;
  flap: number;
  /** Each peck (beak world position): leaf scraps / feathers. */
  onPeck: ((p: THREE.Vector3) => void) | null;
  /** Keep pecking until scared (staged raids). */
  stay: boolean;
  /** Peck on which `onEat` fires. */
  eatAt: number;
  bob: number;
  /** The plant being raided (the crow faces it and pecks toward it). */
  crop: THREE.Vector3;
  /** Heading toward the crop while on the ground. */
  face: number;
}

let crowMat: THREE.MeshStandardMaterial | null = null;
/**
 * Two-tone blue-black plumage: glossy (low roughness) with an iridescent blue-violet rim so the
 * silhouette reads against dark soil, and a warm-grey beak that catches the same rim light.
 */
function material(): THREE.MeshStandardMaterial {
  if (!crowMat) {
    crowMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.04 });
    crowMat.name = 'crow';
    applyWorldFx(crowMat, { snow: false });
    patchMaterial(crowMat, 'crow-sheen', (shader) => {
      shader.fragmentShader = after(
        shader.fragmentShader,
        '#include <emissivemap_fragment>',
        /* glsl */ `
        {
          float ndv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
          float rim = pow(1.0 - ndv, 2.4);
          // Oil-slick sheen: blue at the rim shading to violet, stronger on the darkest feathers.
          float ink = 1.0 - smoothstep(0.05, 0.3, dot(diffuseColor.rgb, vec3(0.33)));
          totalEmissiveRadiance += mix(vec3(0.12, 0.17, 0.34), vec3(0.2, 0.14, 0.3), ndv) * rim * (0.25 + 0.3 * ink) + diffuseColor.rgb * rim * 0.4;
        }`,
      );
    });
  }
  return crowMat;
}

function part(fn: (b: MeshBuilder) => void, name: string): THREE.Mesh {
  const b = new MeshBuilder();
  fn(b);
  const g = b.build({ name, castShadow: true });
  const m = g.children[0] as THREE.Mesh;
  m.removeFromParent();
  return m;
}

// Slate blue-black rather than pure ink: the form (breast, folded wing, crown) keeps reading
// against dark soil and leaf shadow instead of collapsing into a black blob.
const INK = 0x1c202c;
const SHEEN = 0x3a4666;
const BREAST = 0x2c3242;
const WING = 0x252c42;

const _cc = new THREE.Color();
const _cs = new THREE.Color();

/** Per-vertex colour pass over a geometry (the builder multiplies it by the part tint). */
function paint(g: THREE.BufferGeometry, fn: (p: THREE.Vector3, n: THREE.Vector3, uv: THREE.Vector2, out: THREE.Color) => void): THREE.BufferGeometry {
  g.computeVertexNormals();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const uvA = g.attributes.uv as THREE.BufferAttribute | undefined;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const uv = new THREE.Vector2();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    if (uvA) uv.fromBufferAttribute(uvA, i);
    fn(p, n, uv, _cc.set(INK));
    col[i * 3] = _cc.r;
    col[i * 3 + 1] = _cc.g;
    col[i * 3 + 2] = _cc.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Body profile shared by the torso and the wing shells so the shells hug it exactly. */
function bodyShape(p: THREE.Vector3, R: number, grow = 1): void {
  p.z *= 1.5;
  const L = R * 1.5;
  if (p.z < 0) {
    const k = -p.z / L;
    p.x *= 1 - 0.5 * Math.pow(k, 1.3);
    p.y *= 1 - 0.42 * k;
    p.y += 0.012 * k;
  } else if (p.y < 0) p.y *= 1.08; // full breast
  p.x *= 0.8 * grow;
  p.y *= 0.76 * grow;
  p.z *= grow;
}

function crowBody(): THREE.BufferGeometry {
  const R = 0.1;
  const g = new THREE.SphereGeometry(R, 22, 14);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    bodyShape(p, R);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  return paint(g, (q, n, _uv, c) => {
    // Slate breast and belly, glossy blue-black mantle, a faint scallop of feather rows.
    c.lerp(_cs.set(BREAST), THREE.MathUtils.smoothstep(-n.y, -0.1, 0.6) * 0.9);
    c.lerp(_cs.set(SHEEN), THREE.MathUtils.smoothstep(n.y, 0.35, 0.95) * 0.55);
    const rows = 0.5 + 0.5 * Math.sin(q.z * 110 + Math.abs(q.x) * 60);
    c.multiplyScalar(0.9 + 0.14 * rows);
  });
}

/** A closed wing: a thin curved shell over one flank, its primaries tapering to a point past the tail. */
function wingShell(side: number): THREE.BufferGeometry {
  const R = 0.1;
  const g = new THREE.SphereGeometry(R, 14, 8, Math.PI - 1.35, 2.6, Math.PI * 0.26, Math.PI * 0.36);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    bodyShape(p, R, 1.07);
    if (p.z < 0) {
      // Primaries: stretched back past the tail and pinched toward the midline.
      const k = Math.min(1, -p.z / 0.15);
      p.z *= 1 + 0.55 * k * k;
      p.x *= 1 - 0.35 * k * k;
      p.y += 0.01 * k;
    }
    p.x *= side;
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  return paint(g, (q, _n, uv, c) => {
    // uv.y: 1 at the top of the shell → 0 at its lower edge (a dark tucked line against the flank).
    const edge = THREE.MathUtils.smoothstep(uv.y, 0.0, 0.3);
    const back = THREE.MathUtils.smoothstep(-q.z, 0.02, 0.16);
    // Coverts (front half): bluish sheen in scalloped rows; primaries: long dark quills.
    const scallop = 0.5 + 0.5 * Math.sin(q.z * 150 + Math.sin(uv.y * 9) * 1.4);
    c.set(WING).lerp(_cs.set(SHEEN), (1 - back) * (0.35 + 0.35 * scallop));
    const quill = 0.5 + 0.5 * Math.sin(uv.y * 26);
    c.lerp(_cs.set(INK), back * (0.45 + 0.3 * quill));
    c.multiplyScalar(0.62 + 0.38 * edge);
  });
}

function tailFan(): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(-0.026, 0.02);
  sh.lineTo(0.026, 0.02);
  sh.quadraticCurveTo(0.05, -0.07, 0.048, -0.12);
  sh.quadraticCurveTo(0, -0.14, -0.048, -0.12);
  sh.quadraticCurveTo(-0.05, -0.07, -0.026, 0.02);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -0.003);
  g.rotateX(Math.PI / 2);
  return paint(g, (q, n, _uv, c) => {
    // Glossy top, feather shafts fanning out, darker tips.
    const ang = Math.atan2(q.x, -q.z + 0.03);
    c.set(INK).lerp(_cs.set(SHEEN), (0.5 + 0.5 * Math.cos(ang * 22)) * 0.35 * Math.max(0, n.y));
    c.multiplyScalar(1 - 0.3 * THREE.MathUtils.smoothstep(-q.z, 0.07, 0.13));
  });
}

function headGeo(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.062, 16, 12);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * 0.9;
    let y = pos.getY(i) * 0.9;
    const z = pos.getZ(i) * 1.12;
    if (y > 0.02) y = 0.02 + (y - 0.02) * 0.85; // flat crown
    if (z > 0.03 && y < 0) y *= 0.85; // chin tucks into the bill
    pos.setXYZ(i, x, y, z);
  }
  return paint(g, (_q, n, _uv, c) => {
    c.lerp(_cs.set(SHEEN), THREE.MathUtils.smoothstep(n.y, 0.4, 1) * 0.5);
  });
}

/** A crow bill: a laterally flattened cone pointing +Z from its base at z = 0, hooked by `curve`. */
function billGeo(r: number, len: number, curve: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, len, 8, 3);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, len / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const t = z / len;
    pos.setX(i, pos.getX(i) * 0.72);
    pos.setY(i, pos.getY(i) - curve * t * t * len * 0.3);
  }
  return paint(g, (q, n, _uv, c) => {
    // Pale ridge (culmen) catching the light; darker toward the gape.
    c.setRGB(1, 1, 1).multiplyScalar(0.8 + 0.35 * Math.max(0, n.y));
    c.multiplyScalar(0.9 + 0.1 * (q.z / 0.12));
  });
}

export class CrowFlock {
  readonly group = new THREE.Group();
  private crows: Crow[] = [];
  private rng = new Rng('crows');

  constructor(private ground: (x: number, z: number) => number) {
    this.group.name = 'crows';
    this.group.userData.perfTag = 'critters';
  }

  get count(): number {
    return this.crows.length;
  }

  private build(): Pick<Crow, 'root' | 'body' | 'head' | 'wingL' | 'wingR' | 'folded'> {
    const M = material();
    const r = this.rng;
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    body.add(
      part((b) => {
        // One sculpted body: breast forward, back sloping into the tail, the closed wings painted
        // into the same surface (no separate pods). Coloured per vertex: slate belly, glossy back,
        // scalloped wing-covert rows so it reads as feathers, not a black egg.
        b.add(M, crowBody(), mat(0, 0.15, -0.01, -0.16, 0, 0));
        // Closed wings: thin curved shells hugging the flanks, primaries meeting over the tail.
        for (const sd of [-1, 1]) b.add(M, wingShell(sd), mat(0, 0.15, -0.01, -0.16, 0, 0));
        // Tail: a rounded, bevelled fan angled down behind the body (the crow's tell-tale tail).
        b.add(M, tailFan(), mat(0, 0.13, -0.17, -0.3, 0, 0));
        // Legs + toes (three forward, one back)
        for (const sd of [-1, 1]) {
          b.add(M, new THREE.CylinderGeometry(0.008, 0.007, 0.09, 5), mat(sd * 0.032, 0.045, 0.02), { tint: 0x34302e });
          for (const a of [-0.45, 0, 0.45]) b.add(M, new THREE.CylinderGeometry(0.0055, 0.0035, 0.05, 4), mat(sd * 0.032 + Math.sin(a) * 0.018, 0.004, 0.04 + Math.cos(a) * 0.012, Math.PI / 2, 0, -a), { tint: 0x34302e });
          b.add(M, new THREE.CylinderGeometry(0.005, 0.0035, 0.035, 4), mat(sd * 0.032, 0.004, 0.0, -Math.PI / 2, 0, 0), { tint: 0x34302e });
        }
      }, 'crow-body'),
    );
    const head = new THREE.Group();
    head.position.set(0, 0.22, 0.1);
    head.add(
      part((b) => {
        // Neck ruff blending the head into the breast, then a slightly flat-crowned head.
        b.add(M, new THREE.SphereGeometry(0.058, 12, 9), mat(0, -0.03, -0.02, 0, 0, 0, 1, 1, 1.05), { tint: INK });
        b.add(M, headGeo(), mat(0, 0.02, 0.02));
        // Heavy crow bill: horn-grey (lighter than the plumage so it reads at gameplay zoom), a deep
        // curved upper mandible over a thinner lower one, bristles at the base.
        b.add(M, billGeo(0.03, 0.12, 0.1), mat(0, 0.016, 0.07, 0, 0, 0), { tint: 0x55545c });
        b.add(M, billGeo(0.02, 0.09, -0.05), mat(0, -0.004, 0.07, 0.1, 0, 0), { tint: 0x3a3940 });
        b.add(M, new THREE.SphereGeometry(0.03, 8, 6), mat(0, 0.02, 0.07, 0, 0, 0, 1, 0.9, 0.7), { tint: 0x2a2e3c });
        for (const sd of [-1, 1]) {
          // Dark eye in a slate ring with a hard white glint (reads at gameplay zoom).
          b.add(M, new THREE.SphereGeometry(0.017, 10, 8), mat(sd * 0.044, 0.036, 0.048), { tint: 0x3a4050 });
          b.add(M, new THREE.SphereGeometry(0.0145, 10, 8), mat(sd * 0.048, 0.037, 0.05), { tint: 0x050507 });
          b.add(M, new THREE.SphereGeometry(0.0055, 6, 4), mat(sd * 0.058, 0.044, 0.058), { tint: 0xffffff });
        }
      }, 'crow-head'),
    );
    body.add(head);
    const wing = (s: number): THREE.Group => {
      const w = new THREE.Group();
      w.position.set(s * 0.07, 0.19, 0.0);
      w.add(
        part((b) => {
          // A proper wing silhouette: rounded shoulder, then four splayed primary "fingers".
          const sh = new THREE.Shape();
          sh.moveTo(0, 0.05);
          sh.quadraticCurveTo(0.12, 0.09, 0.2, 0.06);
          const fingers = 4;
          for (let f = 0; f < fingers; f++) {
            const x0 = 0.2 + f * 0.035;
            sh.lineTo(x0 + 0.075, 0.035 - f * 0.028);
            sh.lineTo(x0 + 0.03, 0.02 - f * 0.028);
          }
          sh.lineTo(0.2, -0.08);
          sh.quadraticCurveTo(0.08, -0.1, 0, -0.06);
          sh.closePath();
          const g = new THREE.ShapeGeometry(sh, 3);
          g.rotateX(-Math.PI / 2);
          const p = g.attributes.position as THREE.BufferAttribute;
          for (let i = 0; i < p.count; i++) p.setY(i, Math.sin(p.getX(i) * 9) * 0.012);
          g.computeVertexNormals();
          b.add(M, g, mat(0, 0, 0, 0, 0, 0, s, 1, 1), { tint: INK });
          // Covert feathers: a slightly lighter band along the leading edge.
          const cv = new THREE.PlaneGeometry(0.16, 0.05, 2, 1);
          cv.rotateX(-Math.PI / 2);
          b.add(M, cv, mat(s * 0.09, 0.004, -0.035, 0, 0, 0, s, 1, 1), { tint: SHEEN });
        }, 'crow-wing'),
      );
      ((w.children[0] as THREE.Mesh).material as THREE.Material).side = THREE.DoubleSide;
      return w;
    };
    const wingL = wing(-1);
    const wingR = wing(1);
    // On the ground the flat flight wings would read as blades sticking out of a blob: a perched
    // crow shows closed wings instead — smooth, glossy teardrops hugging the flanks, the long
    // primaries crossing in a point over the tail.
    // The closed wings are part of the body now; this is only the half-lifted "flick" pose (the
    // shells raised off the back for one hop), shown instead of the flight wings.
    const folded = part((b) => {
      for (const sd of [-1, 1]) b.add(M, wingShell(sd), mat(sd * 0.012, 0.165, -0.01, -0.22, sd * 0.12, sd * 0.28, 1.05, 1, 1.02));
    }, 'crow-folded');
    folded.visible = false;
    body.add(wingL, wingR, folded);
    return { root, body, head, wingL, wingR, folded };
  }

  /**
   * Send a crow to peck the crop at (x, z) (tile centre). `onEat` fires on the third peck (or
   * `opts.eatAt`). `opts.landed` starts it already on the ground mid-raid (demos); `opts.stay`
   * keeps it pecking until the farmer scares it; `opts.onPeck` fires on every peck.
   */
  spawn(x: number, z: number, onEat: () => void, delay = 0, opts: { landed?: boolean; stay?: boolean; eatAt?: number; onPeck?: (p: THREE.Vector3) => void; scale?: number; side?: number } = {}): void {
    if (this.crows.length >= 5) return;
    const parts = this.build();
    const a = this.rng.next() * Math.PI - Math.PI;
    // Lands on the soil at the tile's edge (never in the middle of the plant), facing the crop.
    const side = opts.side ?? this.rng.next() * Math.PI * 2;
    const lx = x + Math.cos(side) * 0.52;
    const lz = z + Math.sin(side) * 0.52;
    const gy = this.ground(lx, lz);
    const from = new THREE.Vector3(x + Math.cos(a) * 12, gy + 7 + this.rng.next() * 2, z + Math.sin(a) * 8 - 6);
    const crow: Crow = {
      ...parts,
      state: 'in',
      t: -delay,
      from,
      to: new THREE.Vector3(lx, gy, lz),
      crop: new THREE.Vector3(x, gy, z),
      exit: new THREE.Vector3(x - Math.cos(a) * 14, gy + 9, z - 10),
      pecks: 0,
      peckT: 0.4,
      onEat,
      flap: this.rng.next() * 6,
      onPeck: opts.onPeck ?? null,
      stay: !!opts.stay,
      eatAt: opts.eatAt ?? 3,
      bob: this.rng.next() * 6,
      face: Math.atan2(x - lx, z - lz),
    };
    crow.root.position.copy(from);
    if (opts.landed) {
      crow.state = 'peck';
      crow.t = 0;
      crow.peckT = 0.15 + this.rng.next() * 0.5;
      crow.root.position.copy(crow.to);
      crow.root.rotation.y = crow.face;
    }
    // ~0.25 m body: a real crow beside a knee-high plant (the old 1.5× read as head-sized).
    crow.root.scale.setScalar(opts.scale ?? 0.82);
    crow.root.visible = delay <= 0;
    this.group.add(crow.root);
    this.crows.push(crow);
  }

  /** Scare every crow within `r` of (x, z). */
  scare(x: number, z: number, r: number): number {
    let n = 0;
    for (const c of this.crows) {
      if (c.state === 'out') continue;
      if (Math.hypot(c.root.position.x - x, c.root.position.z - z) < r) {
        c.state = 'out';
        c.t = 0;
        c.from.copy(c.root.position);
        n++;
      }
    }
    return n;
  }

  /**
   * Remove every crow. `finish`: crows that were not scared off still get their meal (the raid
   * resolves off-screen when the farmer leaves the farm / the map reloads).
   */
  clear(finish = false): void {
    for (const c of this.crows) {
      if (finish && c.state !== 'out' && c.onEat) c.onEat();
      c.onEat = null;
      c.root.removeFromParent();
    }
    this.crows.length = 0;
  }

  private showWings(c: Crow, open: boolean): void {
    c.wingL.visible = open;
    c.wingR.visible = open;
    c.folded.visible = !open;
  }

  update(dt: number, player: THREE.Vector3, others: THREE.Vector3[] = []): void {
    const near = (p: THREE.Vector3, r: number): boolean => {
      if (Math.hypot(player.x - p.x, player.z - p.z) < r) return true;
      for (const o of others) if (Math.hypot(o.x - p.x, o.z - p.z) < r) return true;
      return false;
    };
    for (let i = this.crows.length - 1; i >= 0; i--) {
      const c = this.crows[i]!;
      c.t += dt;
      if (c.t < 0) continue;
      c.root.visible = true;
      c.flap += dt;
      const root = c.root;
      if (c.state === 'in') {
        this.showWings(c, true);
        c.wingL.rotation.y = 0;
        c.wingR.rotation.y = 0;
        c.wingL.scale.set(1, 1, 1);
        c.wingR.scale.set(1, 1, 1);
        const T = 2.6;
        const t = Math.min(1, c.t / T);
        const e = 1 - Math.pow(1 - t, 2.2);
        const p = new THREE.Vector3().lerpVectors(c.from, c.to, e);
        p.y += Math.sin(t * Math.PI) * 1.2 * (1 - t);
        const d = new THREE.Vector3().subVectors(c.to, c.from).setY(0);
        root.position.copy(p);
        root.rotation.y = Math.atan2(d.x, d.z);
        // Fast flaps, then a flare (wings spread, body pitched up) before touching down.
        const flare = THREE.MathUtils.smoothstep(t, 0.75, 1);
        const f = Math.sin(c.flap * 22) * (1 - flare) + 0.55 * flare;
        c.wingL.rotation.z = -f * 0.9;
        c.wingR.rotation.z = f * 0.9;
        c.body.rotation.x = -0.25 * flare + 0.15 * (1 - flare);
        // A farmer standing by the landing spot: veer off instead of landing on a hat.
        if (near(c.to, 1.6)) {
          c.state = 'out';
          c.t = 0;
          c.from.copy(root.position);
          continue;
        }
        if (t >= 1) {
          c.state = 'peck';
          c.t = 0;
          c.body.rotation.x = 0;
          root.rotation.y = c.face;
        }
      } else if (c.state === 'peck') {
        // Folded wings; hop, look around, peck.
        c.peckT -= dt;
        const k = Math.max(0, c.peckT);
        if (c.peckT <= 0) {
          c.pecks++;
          c.peckT = 0.55 + this.rng.next() * 0.4;
          if (c.pecks === c.eatAt && c.onEat) {
            c.onEat();
            c.onEat = null;
          }
          if (c.onPeck) {
            c.head.updateWorldMatrix(true, false);
            c.onPeck(c.head.localToWorld(new THREE.Vector3(0, -0.02, 0.14)));
          }
          // Shuffle about but keep facing the plant.
          root.rotation.y = c.face + (this.rng.next() - 0.5) * 0.9;
        }
        const peck = Math.max(0, Math.sin((1 - k / 0.55) * Math.PI));
        c.bob += dt;
        // Between pecks: the jerky crow head-bob and a glance around.
        const idle = 1 - peck;
        c.body.rotation.x = peck * 0.8;
        c.head.rotation.x = peck * 0.6 + idle * (Math.sin(c.bob * 11) > 0.3 ? 0.18 : -0.06);
        c.head.rotation.y = idle * Math.sin(c.bob * 1.7) * 0.6;
        c.head.position.z = 0.1 + idle * (Math.sin(c.bob * 11) > 0.3 ? 0.02 : -0.01);
        // Between pecks: a little two-footed hop with a wing flick.
        const hop = c.peckT > 0.45 ? Math.sin(((c.peckT - 0.45) / 0.3) * Math.PI) : 0;
        root.position.y = c.to.y + Math.max(0, hop) * 0.06;
        // Wings folded back along the body (a quick flick open on each hop).
        const flick = Math.max(0, hop);
        // Folded tight along the back (tips crossing over the tail), a quick flick on each hop.
        c.wingL.rotation.y = -(Math.PI / 2 - 0.06) * (1 - flick * 0.6);
        c.wingR.rotation.y = (Math.PI / 2 - 0.06) * (1 - flick * 0.6);
        c.wingL.rotation.z = -0.12 - flick * 0.6;
        c.wingR.rotation.z = 0.12 + flick * 0.6;
        // Folded, the primaries stack up: the wing is ~70 % of its spread length along the back.
        const fold = 0.7 + flick * 0.3;
        c.wingL.scale.set(fold, 1, 1);
        c.wingR.scale.set(fold, 1, 1);
        // Only a real flick opens the flight wings; otherwise the closed-wing volumes show.
        this.showWings(c, false);
        c.folded.visible = flick > 0.08;
        c.folded.scale.set(1 + flick * 0.2, 1 + flick * 0.2, 1);
        if ((c.pecks >= 6 && !c.stay) || near(root.position, 2.6)) {
          c.state = 'out';
          c.t = 0;
          c.from.copy(root.position);
        }
      } else {
        const T = 2.4;
        const t = Math.min(1, c.t / T);
        const e = t * t;
        root.position.lerpVectors(c.from, c.exit, e);
        root.position.y += Math.sin(t * Math.PI * 0.5) * 1.5;
        const d = new THREE.Vector3().subVectors(c.exit, c.from).setY(0);
        root.rotation.y = Math.atan2(d.x, d.z);
        this.showWings(c, true);
        c.wingL.rotation.y = 0;
        c.wingR.rotation.y = 0;
        c.wingL.scale.set(1, 1, 1);
        c.wingR.scale.set(1, 1, 1);
        c.body.rotation.x = -0.35 * (1 - t);
        const f = Math.sin(c.flap * 26);
        c.wingL.rotation.z = -f;
        c.wingR.rotation.z = f;
        if (t >= 1) {
          root.removeFromParent();
          this.crows.splice(i, 1);
        }
      }
    }
  }
}
