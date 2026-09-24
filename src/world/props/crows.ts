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
    crowMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.08 });
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
          totalEmissiveRadiance += mix(vec3(0.16, 0.24, 0.5), vec3(0.3, 0.2, 0.46), ndv) * rim * (0.35 + 0.4 * ink) + diffuseColor.rgb * rim * 0.5;
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

const INK = 0x16171f;
const SHEEN = 0x2c3456;

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
        const torso = lumpySphere(0.1, 1, 0.08, r);
        b.add(M, torso, mat(0, 0.14, 0, 0, 0, 0, 0.85, 0.8, 1.35), { tint: INK });
        b.add(M, new THREE.SphereGeometry(0.07, 8, 6), mat(0, 0.12, 0.06, 0, 0, 0, 1, 0.9, 1.1), { tint: SHEEN });
        // Tail fan
        const tail = new THREE.ConeGeometry(0.06, 0.18, 4);
        b.add(M, tail, mat(0, 0.17, -0.18, -Math.PI / 2 - 0.35, 0, 0, 1, 1, 0.3), { tint: INK });
        // Legs
        for (const s of [-1, 1]) b.add(M, new THREE.CylinderGeometry(0.008, 0.008, 0.08, 4), mat(s * 0.035, 0.04, 0.02), { tint: 0x3a3228 });
      }, 'crow-body'),
    );
    const head = new THREE.Group();
    head.position.set(0, 0.22, 0.1);
    head.add(
      part((b) => {
        b.add(M, new THREE.SphereGeometry(0.065, 10, 8), mat(0, 0.02, 0.02), { tint: INK });
        const beak = new THREE.ConeGeometry(0.024, 0.1, 6);
        b.add(M, beak, mat(0, 0.005, 0.115, Math.PI / 2, 0, 0), { tint: 0x8a8174 });
        for (const s of [-1, 1]) {
          // Glossy dark eye ringed in grey, with a hard white glint (reads at gameplay zoom).
          b.add(M, new THREE.SphereGeometry(0.019, 8, 6), mat(s * 0.043, 0.036, 0.055), { tint: 0x55586a });
          b.add(M, new THREE.SphereGeometry(0.014, 8, 6), mat(s * 0.049, 0.037, 0.06), { tint: 0x0a0a0e });
          b.add(M, new THREE.SphereGeometry(0.0055, 6, 4), mat(s * 0.058, 0.044, 0.068), { tint: 0xffffff });
        }
        // A glossy blue-violet sheen over the crown (readable form instead of a black blob).
        b.add(M, new THREE.SphereGeometry(0.05, 8, 6), mat(0, 0.05, -0.005, 0, 0, 0, 1.05, 0.7, 1.05), { tint: 0x3a4468 });
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
    const folded = part((b) => {
      for (const s of [-1, 1]) {
        b.add(M, new THREE.SphereGeometry(0.06, 10, 8), mat(s * 0.062, 0.165, -0.035, 0.22, s * 0.12, 0, 0.5, 0.62, 1.75), { tint: 0x262c46 });
        const prim = new THREE.ConeGeometry(0.03, 0.17, 6);
        b.add(M, prim, mat(s * 0.022, 0.19, -0.2, -Math.PI / 2 - 0.12, 0, s * 0.18, 1, 1, 0.45), { tint: INK });
      }
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
    const lx = x + Math.cos(side) * 0.4;
    const lz = z + Math.sin(side) * 0.4;
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
    crow.root.scale.setScalar(opts.scale ?? 0.95);
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
        this.showWings(c, flick > 0.35);
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
