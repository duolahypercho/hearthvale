/**
 * Everyday festoon lights: strings of little glass bulbs slung around the plaza (on short iron
 * masts above the lamp posts), zig-zagging over the market row and along the Copper Kettle's
 * terrace. Shopkeepers switch them on at dusk — earlier than the street lamps — and in winter
 * they swap their warm whites for coloured holiday bulbs.
 *
 * Cost: every cord in town is one merged mesh, every bulb another (vertex colours tint both the
 * glass and its glow; a per-bulb phase attribute gives a slow, subtle shimmer). No shadows.
 * Masts / poles are returned as static props so the town merges them into its batched cells.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import type { Season } from '../../core/time';
import { MeshBuilder, roundedBox, bevelCylinder, mat } from '../geom';
import { patchMaterial, after, before } from '../../render/patch';
import { globalUniforms } from '../../render/uniforms';

type V3 = [number, number, number];

export interface FestoonSpan {
  /** World-space anchor points (y absolute). */
  a: V3;
  b: V3;
  /** Sag at mid-span (m). */
  sag: number;
}

/** Warm "Edison" whites with the odd amber; winter: red, green, gold, blue, white. */
const WARM = [0xffd9a2, 0xffc27a, 0xffb86a, 0xffe0b4, 0xffa956];
const WINTER = [0xff4a3a, 0x4adf6a, 0xffc93a, 0x4a9aff, 0xfff1d8];

const MAX_SPANS = 40;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function catenary(a: THREE.Vector3, b: THREE.Vector3, sag: number, t: number, out: THREE.Vector3): THREE.Vector3 {
  out.copy(a).lerp(b, t);
  out.y -= 4 * sag * t * (1 - t);
  return out;
}

export class Festoons {
  readonly group = new THREE.Group();
  private bulbMat: THREE.MeshStandardMaterial;
  private bulbGeo: THREE.BufferGeometry;
  private warm: Float32Array;
  private winter: Float32Array;
  private season: Season = 'spring';
  /** 0..1 how brightly the strings glow. */
  lit = 0;
  /** Resolved spans (world space) — the camera director tests its sight lines against them. */
  readonly spans: FestoonSpan[];
  /** Per-span visibility (1 = hidden): close lenses take the strings that cross a face down. */
  private hide = new Float32Array(MAX_SPANS);
  private hideU = { value: this.hide };
  private cordMat: THREE.MeshStandardMaterial;

  constructor(spans: FestoonSpan[], rng: Rng) {
    this.group.name = 'festoons';
    this.group.userData.perfTag = 'festoons';
    this.group.userData.festoons = this;
    this.spans = spans.slice(0, MAX_SPANS);
    spans = this.spans;
    const cords: THREE.BufferGeometry[] = [];
    const cordSpan: number[] = [];
    const bulbSpan: number[] = [];
    const bulbs: THREE.BufferGeometry[] = [];
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    const A = new THREE.Vector3();
    const B = new THREE.Vector3();
    const warm: number[] = [];
    const winter: number[] = [];
    const phases: number[] = [];
    const base = new THREE.SphereGeometry(0.052, 8, 6);
    base.scale(1, 1.3, 1);
    base.deleteAttribute('uv');
    const cap = new THREE.CylinderGeometry(0.024, 0.028, 0.05, 6);
    cap.deleteAttribute('uv');
    let k = 0;
    for (let si = 0; si < spans.length; si++) {
      const s = spans[si]!;
      A.set(...s.a);
      B.set(...s.b);
      const L = A.distanceTo(B);
      const segs = Math.max(4, Math.round(L / 0.45));
      for (let i = 0; i < segs; i++) {
        catenary(A, B, s.sag, i / segs, p);
        catenary(A, B, s.sag, (i + 1) / segs, q);
        const d = q.clone().sub(p);
        const len = d.length();
        const g = new THREE.CylinderGeometry(0.008, 0.008, len, 4, 1, true);
        g.deleteAttribute('uv');
        g.rotateZ(Math.PI / 2);
        g.applyMatrix4(mat((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2, 0, -Math.atan2(d.z, d.x), Math.atan2(d.y, Math.hypot(d.x, d.z))));
        cords.push(g);
        for (let v = 0; v < g.attributes.position!.count; v++) cordSpan.push(si);
      }
      // Bulbs hang from the cord on short drops, skipping the very ends.
      const n = Math.max(2, Math.round(L / 0.62));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        catenary(A, B, s.sag, t, p);
        const drop = 0.07 + rng.next() * 0.03;
        const c = cap.clone().translate(p.x, p.y - drop + 0.03, p.z);
        const bulb = base.clone().translate(p.x, p.y - drop - 0.04, p.z);
        // Socket (dark) + glass (lit): the socket gets a near-black tint that never glows.
        const wc = new THREE.Color(WARM[Math.floor(rng.next() * WARM.length)]!);
        const xc = new THREE.Color(WINTER[k % WINTER.length]!);
        const ph = rng.next() * 6.283;
        for (const [geo, dark] of [[c, true], [bulb, false]] as [THREE.BufferGeometry, boolean][]) {
          const cnt = geo.attributes.position!.count;
          for (let v = 0; v < cnt; v++) {
            if (dark) {
              warm.push(0.05, 0.045, 0.04);
              winter.push(0.05, 0.045, 0.04);
            } else {
              warm.push(wc.r, wc.g, wc.b);
              winter.push(xc.r, xc.g, xc.b);
            }
            phases.push(dark ? -1 : ph);
            bulbSpan.push(si);
          }
          bulbs.push(geo);
        }
        k++;
      }
    }
    const cordGeo = mergeSimple(cords);
    cordGeo.setAttribute('aSpan', new THREE.BufferAttribute(new Float32Array(cordSpan), 1));
    this.cordMat = new THREE.MeshStandardMaterial({ name: 'festoonCord', color: 0x3a3029, roughness: 0.8 });
    this.hideSpans(this.cordMat, 'festoon-cord');
    const cordMesh = new THREE.Mesh(cordGeo, this.cordMat);
    cordMesh.name = 'festoon-cords';
    cordMesh.castShadow = cordMesh.receiveShadow = false;
    cordMesh.userData.noAO = true;
    this.group.add(cordMesh);

    this.bulbGeo = mergeSimple(bulbs);
    this.warm = new Float32Array(warm);
    this.winter = new Float32Array(winter);
    this.bulbGeo.setAttribute('color', new THREE.BufferAttribute(this.warm.slice(), 3));
    this.bulbGeo.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(phases), 1));
    this.bulbGeo.setAttribute('aSpan', new THREE.BufferAttribute(new Float32Array(bulbSpan), 1));
    this.bulbMat = new THREE.MeshStandardMaterial({ name: 'festoonBulb', vertexColors: true, roughness: 0.25, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0 });
    patchMaterial(this.bulbMat, 'festoon', (shader) => {
      shader.uniforms.uTime = globalUniforms.uTime;
      shader.uniforms.uHide = this.hideU;
      shader.vertexShader = before(shader.vertexShader, 'void main() {', `attribute float aPhase;\nvarying float vPhase;\nattribute float aSpan;\nuniform float uHide[${MAX_SPANS}];`);
      shader.vertexShader = after(shader.vertexShader, 'void main() {', 'vPhase = aPhase;');
      shader.vertexShader = after(shader.vertexShader, '#include <project_vertex>', 'if (uHide[int(aSpan + 0.5)] > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
      shader.fragmentShader = before(shader.fragmentShader, 'void main() {', 'uniform float uTime;\nvarying float vPhase;');
      // Glow in the bulb's own colour; sockets (phase < 0) stay dark. A slow, gentle shimmer.
      shader.fragmentShader = after(
        shader.fragmentShader,
        '#include <emissivemap_fragment>',
        'totalEmissiveRadiance *= vColor.rgb * step(0.0, vPhase) * (0.86 + 0.14 * sin(uTime * 1.7 + vPhase) * sin(uTime * 0.63 + vPhase * 2.1));',
      );
    });
    const bulbMesh = new THREE.Mesh(this.bulbGeo, this.bulbMat);
    bulbMesh.name = 'festoon-bulbs';
    bulbMesh.castShadow = false;
    bulbMesh.receiveShadow = false;
    bulbMesh.userData.noAO = true;
    this.group.add(bulbMesh);
  }

  /** Collapse the vertices of hidden spans (one uniform array, no extra draw calls). */
  private hideSpans(m: THREE.Material, key: string): void {
    patchMaterial(m, key, (shader) => {
      shader.uniforms.uHide = this.hideU;
      shader.vertexShader = before(shader.vertexShader, 'void main() {', `attribute float aSpan;\nuniform float uHide[${MAX_SPANS}];`);
      shader.vertexShader = after(shader.vertexShader, '#include <project_vertex>', 'if (uHide[int(aSpan + 0.5)] > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
    });
  }

  /** Hide / show individual spans (index into `spans`); an empty list shows them all. */
  setHidden(hidden: readonly number[]): void {
    this.hide.fill(0);
    for (const i of hidden) if (i >= 0 && i < MAX_SPANS) this.hide[i] = 1;
  }

  /** Point on span i at t (0..1), world space. */
  point(i: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    const s = this.spans[i]!;
    return catenary(_a.set(...s.a), _b.set(...s.b), s.sag, t, out);
  }

  setSeason(season: Season): void {
    if (season === this.season) return;
    this.season = season;
    const attr = this.bulbGeo.attributes.color as THREE.BufferAttribute;
    (attr.array as Float32Array).set(season === 'winter' ? this.winter : this.warm);
    attr.needsUpdate = true;
  }

  /**
   * hour: calendar hour; lamps: the rig's street-lamp level (0..1). The strings come on through
   * dusk (from 17:00, from 14:00 on dark winter afternoons) and stay on until the lamps go out.
   */
  update(hour: number, lamps: number): void {
    const from = this.season === 'winter' ? 14 : 17;
    const dusk = hour >= 12 ? THREE.MathUtils.smoothstep(hour, from, from + 1.6) : 1 - THREE.MathUtils.smoothstep(hour, 5.8, 6.8);
    this.lit = Math.max(dusk, lamps);
    this.bulbMat.emissiveIntensity = 0.12 + this.lit * 2.7;
  }
}

/** Merge position/normal (+index) geometries without requiring identical attribute sets. */
function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nv = 0;
  let ni = 0;
  for (const g of list) {
    nv += g.attributes.position!.count;
    ni += g.index ? g.index.count : g.attributes.position!.count;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const idx = new Uint32Array(ni);
  let ov = 0;
  let oi = 0;
  for (const g of list) {
    const P = g.attributes.position as THREE.BufferAttribute;
    const N = g.attributes.normal as THREE.BufferAttribute;
    pos.set(P.array as Float32Array, ov * 3);
    nor.set(N.array as Float32Array, ov * 3);
    if (g.index) {
      const I = g.index.array;
      for (let i = 0; i < I.length; i++) idx[oi + i] = I[i]! + ov;
      oi += I.length;
    } else {
      for (let i = 0; i < P.count; i++) idx[oi + i] = ov + i;
      oi += P.count;
    }
    ov += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** A slim festoon pole (turned post, iron hook arm, stone footing), origin at the ground. */
export function buildFestoonPole(h = 3.3): THREE.Group {
  const b = new MeshBuilder();
  b.add('stone', roundedBox(0.36, 0.2, 0.36, 0.05), mat(0, 0.1, 0), { tint: 0xc4b8a4 });
  b.add('woodGrain', bevelCylinder(0.07, 0.09, h, 0.02, 8), mat(0, h / 2 + 0.12, 0), { tint: 0xa07a54 });
  // A short cross-tree near the top carries the strings.
  b.add('woodGrain', roundedBox(0.5, 0.07, 0.07, 0.02), mat(0, h - 0.05, 0), { tint: 0x8a6444 });
  b.add('woodGrain', new THREE.SphereGeometry(0.085, 10, 8), mat(0, h + 0.14, 0), { tint: 0x8a6444 });
  b.add('metal', new THREE.TorusGeometry(0.05, 0.011, 4, 8), mat(0, h - 0.12, 0.08, Math.PI / 2, 0, 0));
  return b.build({ name: 'festoon-pole' });
}

/** Iron mast bolted onto a plaza lamp post (adds ~0.8 m so strings clear heads). */
export function buildLampMast(): THREE.Group {
  const b = new MeshBuilder();
  b.add('metal', new THREE.CylinderGeometry(0.028, 0.032, 0.9, 6), mat(0, 2.72, 0));
  b.add('metal', new THREE.SphereGeometry(0.05, 8, 6), mat(0, 3.2, 0));
  b.add('metal', new THREE.TorusGeometry(0.045, 0.01, 4, 8), mat(0, 3.02, 0, Math.PI / 2, 0, 0));
  return b.build({ name: 'lamp-mast' });
}
