/**
 * Mine action poses: pickaxe chop and sword slashes (alternating fore / back hand), keyframed
 * like the farm tool actions (anticipation → impact → hit-stop → follow-through → recovery).
 * Drives the player rig through `player.actionPose`, WRAPPING whatever driver is installed (the
 * farm's tool actions keep working: this one only answers while a mine action is playing).
 * The held mesh goes into the rig's tool socket; the socket's other children are only hidden,
 * never removed, so other drivers find their props where they left them.
 * Also: a blade-tip ribbon trail and the sword mesh.
 */
import * as THREE from 'three';
import type { Player, PlayerRig, ActionPose } from '../../entities/player';
import { MeshBuilder, roundedBox, mat } from '../geom';
import { patchMaterial, after } from '../../render/patch';

export type MineActionKind = 'chop' | 'slash' | 'backslash';

/** Held-tool scale while a mine action plays. */
export const TOOL_SWING_SCALE = 1.4;

interface Key {
  t: number;
  ease?: 'in' | 'out' | 'inout' | 'back';
  aR?: [number, number];
  aL?: [number, number];
  torso?: [number, number, number];
  head?: number;
  sy?: number;
  tool?: [number, number, number];
}

const REST = { aR: [0, -0.12] as [number, number], aL: [0, 0.12] as [number, number], torso: [0, 0, 0] as [number, number, number], head: 0, sy: 1, tool: [Math.PI / 2, 0, 0] as [number, number, number] };

const TRACKS: Record<MineActionKind, { keys: Key[]; impact: number }> = {
  chop: {
    impact: 0.27,
    keys: [
      { t: 0 },
      { t: 0.19, ease: 'out', aR: [-2.95, -0.1], aL: [-2.6, 0.1], torso: [-0.24, 0, 0], head: -0.2, sy: 0.93, tool: [Math.PI / 2 + 0.35, 0, 0] },
      { t: 0.27, ease: 'in', aR: [-0.32, -0.05], aL: [-0.2, 0.05], torso: [0.46, 0, 0], head: 0.15, sy: 1.08, tool: [Math.PI / 2 - 0.2, 0, 0] },
      { t: 0.36, ease: 'out', aR: [-0.26, -0.05], aL: [-0.16, 0.05], torso: [0.5, 0, 0], head: 0.2, sy: 0.92, tool: [Math.PI / 2 - 0.25, 0, 0] },
      { t: 0.6, ease: 'inout' },
    ],
  },
  slash: {
    impact: 0.16,
    keys: [
      { t: 0 },
      { t: 0.09, ease: 'out', aR: [-1.35, -1.35], aL: [-0.5, 0.35], torso: [0.1, 1.0, 0.06], head: -0.05, sy: 0.93, tool: [Math.PI / 2, 0, -1.25] },
      { t: 0.19, ease: 'in', aR: [-1.4, 0.55], aL: [-0.7, 0.15], torso: [0.2, -1.1, -0.06], head: 0.1, sy: 1.06, tool: [Math.PI / 2, 0, -1.25] },
      { t: 0.26, ease: 'out', aR: [-1.25, 0.6], aL: [-0.6, 0.15], torso: [0.18, -1.2, -0.05], sy: 0.96, tool: [Math.PI / 2, 0, -1.25] },
      { t: 0.44, ease: 'inout' },
    ],
  },
  backslash: {
    impact: 0.16,
    keys: [
      { t: 0 },
      { t: 0.09, ease: 'out', aR: [-1.45, 0.65], aL: [-0.6, 0.2], torso: [0.12, -1.05, -0.05], head: -0.05, sy: 0.93, tool: [Math.PI / 2, 0, 1.3] },
      { t: 0.19, ease: 'in', aR: [-1.3, -1.3], aL: [-0.5, 0.35], torso: [0.2, 1.05, 0.06], head: 0.1, sy: 1.06, tool: [Math.PI / 2, 0, 1.3] },
      { t: 0.26, ease: 'out', aR: [-1.2, -1.4], aL: [-0.45, 0.35], torso: [0.18, 1.15, 0.05], sy: 0.96, tool: [Math.PI / 2, 0, 1.3] },
      { t: 0.44, ease: 'inout' },
    ],
  },
};

function ease(k: Key['ease'], t: number): number {
  switch (k) {
    case 'in':
      return t * t * t;
    case 'out':
      return 1 - Math.pow(1 - t, 3);
    case 'back': {
      const c = 1.9;
      return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
    }
    default:
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}

interface Active {
  kind: MineActionKind;
  t: number;
  onImpact?: () => void;
  onUpdate?: (t: number) => void;
  onDone?: () => void;
  fired: boolean;
  speed: number;
}

export class MineActions {
  private cur: Active | null = null;
  private prev: Player['actionPose'] = null;
  private held: THREE.Object3D | null = null;
  private hiddenKids: THREE.Object3D[] = [];
  private socketWasVisible = false;
  /** Seconds of hit-stop remaining (pose frozen). */
  hitStop = 0;
  /** Freeze the pose at the current time (demo stills). */
  frozen = false;
  private readonly fn: NonNullable<Player['actionPose']>;

  constructor(private player: Player) {
    this.fn = (rig, dt) => (this.cur ? this.pose(rig, dt) : (this.prev?.(rig, dt) ?? null));
    this.ensure();
  }

  /** (Re)install the wrapper if another driver replaced player.actionPose. */
  ensure(): void {
    if (this.player.actionPose === this.fn) return;
    this.prev = this.player.actionPose;
    this.player.actionPose = this.fn;
  }

  get active(): boolean {
    return !!this.cur;
  }

  get kind(): MineActionKind | null {
    return this.cur?.kind ?? null;
  }

  get time(): number {
    return this.cur?.t ?? 0;
  }

  start(kind: MineActionKind, tool: THREE.Object3D | null, opts: { onImpact?: () => void; onUpdate?: (t: number) => void; onDone?: () => void; speed?: number } = {}): void {
    this.ensure();
    if (this.cur) this.finish(false);
    this.hold(tool);
    this.cur = { kind, t: 0, fired: false, speed: opts.speed ?? 1, onImpact: opts.onImpact, onUpdate: opts.onUpdate, onDone: opts.onDone };
    this.player.busy = true;
  }

  /** World position of a point in the held tool's local space (e.g. the blade tip). */
  toolPoint(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    const socket = this.player.rig.tool;
    const target = this.held ?? socket;
    target.updateWorldMatrix(true, false);
    return out.copy(local).applyMatrix4(target.matrixWorld);
  }

  private hold(tool: THREE.Object3D | null): void {
    const socket = this.player.rig.tool;
    // Mine tools swing 1.4x oversized (readability: the blade / pick head clears the hat brim).
    if (tool) {
      tool.userData.hvBaseScale ??= tool.scale.x;
      tool.scale.setScalar((tool.userData.hvBaseScale as number) * TOOL_SWING_SCALE);
    }
    this.socketWasVisible = socket.visible;
    this.hiddenKids = [];
    for (const c of socket.children) {
      if (c === tool || !c.visible) continue;
      c.visible = false;
      this.hiddenKids.push(c);
    }
    if (tool && tool.parent !== socket) socket.add(tool);
    if (tool) tool.visible = true;
    this.held = tool;
    socket.visible = true;
  }

  private release(): void {
    const socket = this.player.rig.tool;
    if (this.held) {
      socket.remove(this.held);
      if (typeof this.held.userData.hvBaseScale === 'number') this.held.scale.setScalar(this.held.userData.hvBaseScale);
    }
    for (const c of this.hiddenKids) c.visible = true;
    this.hiddenKids = [];
    this.held = null;
    socket.visible = false;
    socket.rotation.set(REST.tool[0], REST.tool[1], REST.tool[2]);
  }

  private finish(callDone = true): void {
    const a = this.cur;
    this.cur = null;
    this.release();
    this.player.busy = false;
    if (callDone) a?.onDone?.();
  }

  cancel(): void {
    if (this.cur) this.finish(false);
  }

  private pose(rig: PlayerRig, dt: number): ActionPose | null {
    const a = this.cur!;
    const track = TRACKS[a.kind];
    if (!this.frozen) {
      if (this.hitStop > 0) this.hitStop -= dt;
      else a.t += dt * a.speed;
    }
    if (!a.fired && a.t >= track.impact) {
      a.fired = true;
      a.onImpact?.();
    }
    a.onUpdate?.(a.t);
    const ks = track.keys;
    const end = ks[ks.length - 1]!.t;
    if (a.t >= end) {
      this.finish();
      return null;
    }
    let i = 0;
    while (i < ks.length - 2 && a.t > ks[i + 1]!.t) i++;
    const k0 = ks[i]!;
    const k1 = ks[i + 1]!;
    const u = THREE.MathUtils.clamp((a.t - k0.t) / Math.max(1e-4, k1.t - k0.t), 0, 1);
    const e = ease(k1.ease, u);
    const m = (x: number, y: number): number => x + (y - x) * e;
    const aR0 = k0.aR ?? REST.aR;
    const aR1 = k1.aR ?? REST.aR;
    const aL0 = k0.aL ?? REST.aL;
    const aL1 = k1.aL ?? REST.aL;
    const t0 = k0.torso ?? REST.torso;
    const t1 = k1.torso ?? REST.torso;
    const tl0 = k0.tool ?? k1.tool ?? REST.tool;
    const tl1 = k1.tool ?? k0.tool ?? REST.tool;
    rig.armR.rotation.x = m(aR0[0], aR1[0]);
    rig.armR.rotation.z = m(aR0[1], aR1[1]);
    rig.armL.rotation.x = m(aL0[0], aL1[0]);
    rig.armL.rotation.z = m(aL0[1], aL1[1]);
    rig.torso.rotation.set(m(t0[0], t1[0]), m(t0[1], t1[1]), m(t0[2], t1[2]));
    rig.head.rotation.x = m(k0.head ?? 0, k1.head ?? 0);
    rig.tool.position.set(0, -0.3, 0.02);
    rig.tool.rotation.set(m(tl0[0], tl1[0]), m(tl0[1], tl1[1]), m(tl0[2], tl1[2]));
    const brace = Math.max(0, rig.torso.rotation.x) * 0.5;
    rig.legL.rotation.x = -brace;
    rig.legR.rotation.x = brace * 0.6;
    return { sy: m(k0.sy ?? 1, k1.sy ?? 1), bob: 0 };
  }
}

let shared: MineActions | null = null;
/** One driver per player, shared by the mining (pickaxe) and combat (sword) systems. */
export function mineActions(player: Player): MineActions {
  shared ??= new MineActions(player);
  shared.ensure();
  return shared;
}

// ───────────────────────────────────────────── sword

const swordProtos = new Map<number, THREE.Group>();
/** Blade / trim / glow per sword tier (0 = the notched Miner's Shortsword). */
const SWORD_LOOK = [
  { blade: 0xe8eef4, fuller: 0x7a8aa0, trim: 0xd8a84a, grip: 0x6a3a22, glow: 0x000000, len: 1 },
  { blade: 0xf6f9ff, fuller: 0x8c9cb4, trim: 0xd0d6e0, grip: 0x3a2a4a, glow: 0x000000, len: 1.06 },
  { blade: 0xd8f6ff, fuller: 0x4aa8c8, trim: 0x7ad8e8, grip: 0x24405a, glow: 0x2a8ab8, len: 1.1 },
  { blade: 0xffe2c0, fuller: 0xc8481a, trim: 0xe8b04a, grip: 0x3a1a14, glow: 0xc84a10, len: 1.14 },
];

/** Sword for a tier: grip at the origin, blade up +Y (tool-socket convention). */
export function buildSword(tier = 0): THREE.Group {
  const t = Math.max(0, Math.min(SWORD_LOOK.length - 1, tier));
  const cached = swordProtos.get(t);
  if (cached) return cached.clone();
  const L = SWORD_LOOK[t]!;
  const steel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 1, envMapIntensity: 1.8, emissive: L.glow, emissiveIntensity: L.glow ? 0.9 : 0 });
  steel.name = `sword-steel-${t}`;
  // Polished steel in a dark cave: a bright view-rim + a faint cool sheen so the blade always
  // separates from the warm floor (metal with no environment would read as a dark slab).
  patchMaterial(steel, 'sword-rim', (shader) => {
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <emissivemap_fragment>',
      `{
        float fr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.4);
        totalEmissiveRadiance += vColor.rgb * (0.22 + fr * 1.35) + vec3(0.9, 0.95, 1.0) * fr * 0.5;
      }`,
    );
  });
  const trim = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.7 });
  trim.name = 'sword-trim';
  const leather = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  leather.name = 'sword-grip';
  const b = new MeshBuilder();
  // Blade: tapered diamond cross-section with a darker fuller, bright bevel edges.
  const s = new THREE.Shape();
  // Short, chunky blade (≈ 30 % shorter than a longsword: it reads as a miner's shortsword and
  // never dwarfs the chibi farmer).
  const top = 0.4 * L.len;
  s.moveTo(-0.066, 0);
  s.lineTo(-0.06, top);
  s.lineTo(0, top + 0.15);
  s.lineTo(0.06, top);
  s.lineTo(0.066, 0);
  s.closePath();
  const blade = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.009, bevelSegments: 1 });
  blade.translate(0, 0.17, -0.006);
  b.add(steel, blade, undefined, { tint: L.blade });
  b.add(steel, roundedBox(0.022, 0.34 * L.len, 0.034, 0.008), mat(0, 0.17 + 0.19 * L.len, 0), { tint: L.fuller });
  // Crossguard + ricasso collar (winged on the higher tiers).
  b.add(trim, roundedBox(0.3 + t * 0.03, 0.055, 0.07, 0.02), mat(0, 0.15, 0), { tint: L.trim });
  for (const sx of [-1, 1]) b.add(trim, new THREE.SphereGeometry(0.03 + t * 0.004, 10, 8), mat(sx * (0.135 + t * 0.015), 0.15 + t * 0.012, 0), { tint: L.trim });
  if (t >= 2) b.add(steel, new THREE.OctahedronGeometry(0.035, 0), mat(0, 0.15, 0.04), { tint: L.fuller });
  // Grip wrap + pommel.
  b.add(leather, new THREE.CylinderGeometry(0.026, 0.03, 0.2, 10), mat(0, 0.03, 0), { tint: L.grip });
  for (let i = 0; i < 4; i++) b.add(leather, new THREE.TorusGeometry(0.029, 0.006, 5, 12), mat(0, -0.05 + i * 0.05, 0, Math.PI / 2, 0, 0), { tint: 0x2a1a10 });
  b.add(trim, new THREE.SphereGeometry(0.042, 12, 10), mat(0, -0.09, 0), { tint: L.trim });
  const proto = b.build({ name: 'sword', castShadow: true });
  swordProtos.set(t, proto);
  return proto.clone();
}

/** Blade-tip / blade-base in sword-local space (for the trail + hit sparks). */
export const SWORD_TIP = new THREE.Vector3(0, 0.72, 0);
/** Ribbon root: well up the blade (from the grip it folded over the hands into ghost fingers). */
export const SWORD_BASE = new THREE.Vector3(0, 0.38, 0);

// ───────────────────────────────────────────── trail

const TRAIL_N = 18;

export class SwordTrail {
  readonly mesh: THREE.Mesh;
  private tips: THREE.Vector3[] = [];
  private bases: THREE.Vector3[] = [];
  private ages: number[] = [];
  private pos: Float32Array;
  private alpha: Float32Array;
  private uvx: Float32Array;
  private live = false;

  constructor(color = 0xfff4d8) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(TRAIL_N * 2 * 3);
    this.alpha = new Float32Array(TRAIL_N * 2);
    this.uvx = new Float32Array(TRAIL_N * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aEdge', new THREE.BufferAttribute(this.uvx, 1));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    for (let i = 0; i < TRAIL_N; i++) {
      this.uvx[i * 2] = 1;
      this.uvx[i * 2 + 1] = 0;
    }
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: `attribute float aAlpha; attribute float aEdge; varying float vA; varying float vE; void main(){ vA = aAlpha; vE = aEdge; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; varying float vE; void main(){
        // Thin accent under the crescent: transparent at the blade root, a bright line at the tip.
        float edge = smoothstep(0.0, 1.0, vE);
        vec3 c = mix(uColor * 0.7, vec3(1.5, 1.45, 1.3), pow(edge, 2.5));
        float a = vA * pow(edge, 1.6) * 0.3;
        gl_FragColor = vec4(c * a, a);
      }`,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.userData.noAO = true;
    this.mesh.visible = false;
    this.mesh.name = 'sword-trail';
  }

  reset(): void {
    this.tips.length = 0;
    this.bases.length = 0;
    this.ages.length = 0;
  }

  /** Push a blade sample (world space) while slashing. */
  push(tip: THREE.Vector3, base: THREE.Vector3): void {
    // Near-still blade (wind-up / hit-stop): no new sample, so the ribbon never bunches up.
    if (this.tips.length && this.tips[0]!.distanceToSquared(tip) < 0.05 * 0.05) return;
    this.tips.unshift(tip.clone());
    this.bases.unshift(base.clone());
    this.ages.unshift(0);
    if (this.tips.length > TRAIL_N) {
      this.tips.pop();
      this.bases.pop();
      this.ages.pop();
    }
    this.live = true;
  }

  update(dt: number): void {
    for (let i = 0; i < this.ages.length; i++) this.ages[i]! += dt;
    // Drop samples older than the ribbon lifetime.
    while (this.ages.length && this.ages[this.ages.length - 1]! > 0.26) {
      this.tips.pop();
      this.bases.pop();
      this.ages.pop();
    }
    const n = this.tips.length;
    this.mesh.visible = this.live && n >= 2;
    if (!this.mesh.visible) {
      this.live = n >= 2;
      return;
    }
    for (let i = 0; i < TRAIL_N; i++) {
      const k = Math.min(i, n - 1);
      const t = this.tips[k]!;
      const b = this.bases[k]!;
      this.pos.set([t.x, t.y, t.z], i * 6);
      this.pos.set([b.x, b.y, b.z], i * 6 + 3);
      const age = this.ages[k]! / 0.26;
      const fade = Math.max(0, 1 - age) * (1 - k / TRAIL_N) * (i < n ? 1 : 0);
      this.alpha[i * 2] = fade;
      this.alpha[i * 2 + 1] = fade;
    }
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ───────────────────────────────────────────── crescent slash

const ARC_SEG = 36;
const ARC_RAD = 6;
const ARC_SPAN = THREE.MathUtils.degToRad(135);
/** Crescent radii (m): outer (blade-tip path) and the core band thickness at the middle. */
const ARC_OUT = 1.62;
const ARC_CORE = 0.42;

/**
 * The big readable shape of a sword hit: a thick 135° crescent around the farmer in the facing
 * direction (tilted towards the camera), drawn ADDITIVELY, after everything else (no depth test,
 * high render order) so it can never hide behind the farmer or a rock. HDR white-hot leading
 * (outer) edge → warm core → soft wash towards the farmer; the bright head sweeps in with the
 * blade (60 ms), holds ~35 ms on the impact frame, then fades (90 ms). Bloom catches the edge.
 */
export class SlashArc {
  readonly mesh: THREE.Mesh;
  private u: { uHead: { value: number }; uFade: { value: number }; uDir: { value: number }; uCrit: { value: number }; uScroll: { value: number }; uHit: { value: number } };
  private t = -1;
  private hold = 0.035;
  private sweep = 0.06;
  private fade = 0.09;

  constructor() {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= ARC_SEG; i++) {
      const u = i / ARC_SEG;
      const a = -ARC_SPAN / 2 + u * ARC_SPAN;
      // Crescent: full width in the middle, both horns taper to the outer edge.
      const w = Math.pow(Math.sin(Math.PI * u), 0.7);
      const rOut = ARC_OUT - (1 - w) * 0.1;
      // v 0..0.5 = soft inner wash (towards the farmer), 0.5..1 = the core band.
      const rCore = rOut - ARC_CORE * w;
      const rIn = rOut - (ARC_CORE + 0.55) * w - 0.01;
      for (let j = 0; j <= ARC_RAD; j++) {
        const v = j / ARC_RAD;
        const r = v < 0.5 ? rIn + (rCore - rIn) * (v / 0.5) : rCore + (rOut - rCore) * ((v - 0.5) / 0.5);
        pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
        uv.push(u, v);
      }
    }
    for (let i = 0; i < ARC_SEG; i++)
      for (let j = 0; j < ARC_RAD; j++) {
        const a = i * (ARC_RAD + 1) + j;
        const b = a + ARC_RAD + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.u = { uHead: { value: 0 }, uFade: { value: 0 }, uDir: { value: 1 }, uCrit: { value: 0 }, uScroll: { value: 0 }, uHit: { value: 0 } };
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      uniforms: this.u,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uHead; uniform float uFade; uniform float uDir; uniform float uCrit; uniform float uScroll; uniform float uHit;
        varying vec2 vUv;
        void main(){
          float s = uDir > 0.0 ? vUv.x : 1.0 - vUv.x;
          if (s > uHead + 0.015) discard;
          // Brightest right behind the sweep head, a long tail behind it.
          float tail = smoothstep(uHead - 1.1, uHead, s);
          float head = smoothstep(uHead - 0.22, uHead, s);
          float v = vUv.y;
          float core = smoothstep(0.5, 0.62, v);
          float edge = smoothstep(0.84, 0.97, v) * (1.0 - smoothstep(0.985, 1.0, v));
          float wash = smoothstep(0.0, 0.5, v) * (1.0 - core) * 0.28;
          float streak = 0.8 + 0.2 * sin((s * 3.0 - uScroll * 6.0) * 6.2832 + v * 7.0);
          vec3 warm = mix(vec3(1.0, 0.62, 0.26), vec3(1.0, 0.8, 0.2), uCrit);
          vec3 hot = mix(vec3(1.0, 0.97, 0.9), vec3(1.0, 0.92, 0.6), uCrit);
          vec3 col = warm * (wash + core * 0.55 * streak) + hot * edge * (1.5 + head * 1.2 + uHit * 0.8);
          col *= tail * uFade * smoothstep(0.0, 0.07, s) * smoothstep(0.0, 0.06, uHead + 0.015 - s);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 60;
    this.mesh.userData.noAO = true;
    this.mesh.userData.perfTag = 'slash-arc';
    this.mesh.visible = false;
    this.mesh.name = 'slash-arc';
  }

  /** Start a slash at `pos` (feet), facing `dir` (xz), sweeping clockwise (+1) or back (-1). */
  fire(pos: THREE.Vector3, dir: THREE.Vector3, sweepDir: number, crit = false): void {
    this.mesh.position.set(pos.x, pos.y + 0.6, pos.z);
    this.mesh.rotation.set(0, 0, 0);
    // Tilt towards the camera (which looks down -Z from +Z), then yaw to the facing.
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.y = Math.atan2(dir.x, dir.z);
    this.mesh.rotation.x = dir.z < -0.5 ? 0.42 : dir.z > 0.5 ? -0.22 : 0;
    this.mesh.rotation.z = Math.abs(dir.x) > 0.5 ? Math.sign(dir.x) * 0.4 : 0;
    this.mesh.scale.setScalar(crit ? 1.14 : 1);
    this.u.uDir.value = sweepDir;
    this.u.uCrit.value = crit ? 1 : 0;
    this.u.uHead.value = 0;
    this.u.uFade.value = 1;
    this.u.uHit.value = 0;
    this.t = 0;
    this.mesh.visible = true;
  }

  /** Impact frame: snap the crescent to full length and (re)start the flash hold. */
  impact(crit = false, hit = false): void {
    if (this.t < 0) return;
    this.u.uCrit.value = Math.max(this.u.uCrit.value, crit ? 1 : 0);
    this.u.uHit.value = hit ? 1 : 0;
    if (crit) this.mesh.scale.setScalar(1.14);
    this.t = Math.min(this.t, this.sweep);
    this.u.uHead.value = 1;
  }

  get active(): boolean {
    return this.t >= 0;
  }

  /** Freeze on the impact frame (demo stills). */
  pin(): void {
    this.t = this.sweep;
    this.hold = 1e9;
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    const t = this.t;
    this.u.uScroll.value = t;
    if (t < this.sweep) {
      const k = t / this.sweep;
      this.u.uHead.value = Math.max(this.u.uHead.value, 1 - (1 - k) * (1 - k));
      this.u.uFade.value = 1;
    } else if (t < this.sweep + this.hold) {
      this.u.uHead.value = 1;
      this.u.uFade.value = 1;
    } else if (t < this.sweep + this.hold + this.fade) {
      const k = (t - this.sweep - this.hold) / this.fade;
      this.u.uHead.value = 1 + k * 0.5;
      this.u.uFade.value = (1 - k) * (1 - k);
    } else {
      this.t = -1;
      this.hold = 0.035;
      this.mesh.visible = false;
    }
  }
}
