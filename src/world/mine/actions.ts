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

export type MineActionKind = 'chop' | 'slash' | 'backslash';

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
    if (this.held) socket.remove(this.held);
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

let swordProto: THREE.Group | null = null;
/** Miner's shortsword: grip at the origin, blade up +Y (tool-socket convention). */
export function buildSword(): THREE.Group {
  if (swordProto) return swordProto.clone();
  const steel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.9, envMapIntensity: 1.6 });
  steel.name = 'sword-steel';
  const trim = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.7 });
  trim.name = 'sword-trim';
  const leather = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  leather.name = 'sword-grip';
  const b = new MeshBuilder();
  // Blade: tapered diamond cross-section with a darker fuller, bright bevel edges.
  const s = new THREE.Shape();
  s.moveTo(-0.042, 0);
  s.lineTo(-0.036, 0.62);
  s.lineTo(0, 0.78);
  s.lineTo(0.036, 0.62);
  s.lineTo(0.042, 0);
  s.closePath();
  const blade = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.009, bevelSegments: 1 });
  blade.translate(0, 0.17, -0.006);
  b.add(steel, blade, undefined, { tint: 0xe8eef4 });
  b.add(steel, roundedBox(0.016, 0.5, 0.03, 0.006), mat(0, 0.45, 0), { tint: 0x8a96a4 });
  // Crossguard + ricasso collar.
  b.add(trim, roundedBox(0.26, 0.045, 0.06, 0.018), mat(0, 0.15, 0), { tint: 0xd8a84a });
  for (const sx of [-1, 1]) b.add(trim, new THREE.SphereGeometry(0.03, 10, 8), mat(sx * 0.135, 0.15, 0), { tint: 0xe8b85a });
  // Grip wrap + pommel.
  b.add(leather, new THREE.CylinderGeometry(0.026, 0.03, 0.2, 10), mat(0, 0.03, 0), { tint: 0x6a3a22 });
  for (let i = 0; i < 4; i++) b.add(leather, new THREE.TorusGeometry(0.029, 0.006, 5, 12), mat(0, -0.05 + i * 0.05, 0, Math.PI / 2, 0, 0), { tint: 0x4a2414 });
  b.add(trim, new THREE.SphereGeometry(0.042, 12, 10), mat(0, -0.09, 0), { tint: 0xd8a84a });
  swordProto = b.build({ name: 'sword', castShadow: true });
  return swordProto.clone();
}

/** Blade-tip / blade-base in sword-local space (for the trail + hit sparks). */
export const SWORD_TIP = new THREE.Vector3(0, 0.95, 0);
export const SWORD_BASE = new THREE.Vector3(0, 0.34, 0);

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
        float edge = smoothstep(0.0, 0.9, vE);
        vec3 c = mix(uColor * 0.55, vec3(1.6, 1.55, 1.4), pow(edge, 3.0));
        float a = vA * (0.15 + 0.85 * edge);
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
    while (this.ages.length && this.ages[this.ages.length - 1]! > 0.16) {
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
      const age = this.ages[k]! / 0.16;
      const fade = (1 - age) * (1 - k / TRAIL_N) * (i < n ? 1 : 0);
      this.alpha[i * 2] = fade;
      this.alpha[i * 2 + 1] = fade;
    }
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}
