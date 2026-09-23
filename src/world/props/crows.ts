/**
 * Crows that raid unprotected crops: a tiny rig (body + head + two flapping wings) per bird,
 * with a small state machine — fly in on a swooping arc, flare and land, hop and peck the plant
 * (calling `onEat` on the third peck), then flap off when done or when the farmer comes near.
 */
import * as THREE from 'three';
import { MeshBuilder, lumpySphere, mat } from '../geom';
import { Rng } from '../../core/rng';
import { applyWorldFx } from '../../render/worldfx';

type State = 'in' | 'peck' | 'out';

interface Crow {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  wingL: THREE.Group;
  wingR: THREE.Group;
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
}

let crowMat: THREE.MeshStandardMaterial | null = null;
function material(): THREE.MeshStandardMaterial {
  if (!crowMat) {
    crowMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.1 });
    crowMat.name = 'crow';
    applyWorldFx(crowMat, { snow: false });
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

const INK = 0x1c1d26;
const SHEEN = 0x2e3450;

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

  private build(): Pick<Crow, 'root' | 'body' | 'head' | 'wingL' | 'wingR'> {
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
        b.add(M, beak, mat(0, 0.005, 0.115, Math.PI / 2, 0, 0), { tint: 0x6a6258 });
        for (const s of [-1, 1]) {
          b.add(M, new THREE.SphereGeometry(0.018, 8, 6), mat(s * 0.043, 0.036, 0.055), { tint: 0xf4ecd8 });
          b.add(M, new THREE.SphereGeometry(0.01, 6, 4), mat(s * 0.05, 0.038, 0.064), { tint: 0x101010 });
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
    body.add(wingL, wingR);
    return { root, body, head, wingL, wingR };
  }

  /**
   * Send a crow to peck the crop at (x, z) (tile centre). `onEat` fires on the third peck (or
   * `opts.eatAt`). `opts.landed` starts it already on the ground mid-raid (demos); `opts.stay`
   * keeps it pecking until the farmer scares it; `opts.onPeck` fires on every peck.
   */
  spawn(x: number, z: number, onEat: () => void, delay = 0, opts: { landed?: boolean; stay?: boolean; eatAt?: number; onPeck?: (p: THREE.Vector3) => void; scale?: number } = {}): void {
    if (this.crows.length >= 5) return;
    const parts = this.build();
    const gy = this.ground(x, z);
    const a = this.rng.next() * Math.PI - Math.PI;
    const from = new THREE.Vector3(x + Math.cos(a) * 12, gy + 7 + this.rng.next() * 2, z + Math.sin(a) * 8 - 6);
    const crow: Crow = {
      ...parts,
      state: 'in',
      t: -delay,
      from,
      to: new THREE.Vector3(x + (this.rng.next() - 0.5) * 0.3, gy, z + 0.28),
      exit: new THREE.Vector3(x - Math.cos(a) * 14, gy + 9, z - 10),
      pecks: 0,
      peckT: 0.4,
      onEat,
      flap: this.rng.next() * 6,
      onPeck: opts.onPeck ?? null,
      stay: !!opts.stay,
      eatAt: opts.eatAt ?? 3,
      bob: this.rng.next() * 6,
    };
    crow.root.position.copy(from);
    if (opts.landed) {
      crow.state = 'peck';
      crow.t = 0;
      crow.peckT = 0.15 + this.rng.next() * 0.5;
      crow.root.position.copy(crow.to);
      crow.root.rotation.y = this.rng.next() * Math.PI * 2;
    }
    // 1.5× so the silhouette (wings, tail fan, beak) reads from the gameplay camera.
    crow.root.scale.setScalar(opts.scale ?? 1.5);
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

  clear(): void {
    for (const c of this.crows) c.root.removeFromParent();
    this.crows.length = 0;
  }

  update(dt: number, player: THREE.Vector3): void {
    for (let i = this.crows.length - 1; i >= 0; i--) {
      const c = this.crows[i]!;
      c.t += dt;
      if (c.t < 0) continue;
      c.root.visible = true;
      c.flap += dt;
      const root = c.root;
      if (c.state === 'in') {
        c.wingL.rotation.y = 0;
        c.wingR.rotation.y = 0;
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
        if (t >= 1) {
          c.state = 'peck';
          c.t = 0;
          c.body.rotation.x = 0;
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
          root.rotation.y += (this.rng.next() - 0.5) * 1.2;
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
        c.wingL.rotation.y = -(Math.PI / 2 - 0.22) * (1 - flick * 0.6);
        c.wingR.rotation.y = (Math.PI / 2 - 0.22) * (1 - flick * 0.6);
        c.wingL.rotation.z = 0.32 - flick * 0.5;
        c.wingR.rotation.z = -0.32 + flick * 0.5;
        if ((c.pecks >= 6 && !c.stay) || Math.hypot(player.x - root.position.x, player.z - root.position.z) < 2.6) {
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
        c.wingL.rotation.y = 0;
        c.wingR.rotation.y = 0;
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
