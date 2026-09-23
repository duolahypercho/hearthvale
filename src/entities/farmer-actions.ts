/**
 * Farmer action poses — the "feel" half of every tool use. Drives the player rig through
 * keyframed poses with anticipation → impact → hit-stop → follow-through → recovery, swaps the
 * held tool mesh, and fires `onImpact` on the exact frame the tool connects (FX, shake, SFX).
 *
 *   const fa = new FarmerActions(player);        // installs player.actionPose
 *   fa.start('chop', { tool: buildTool('hoe', 1), onImpact: () => ... });
 *   fa.charge(tool) / fa.release()                // hold-to-charge tools
 */
import * as THREE from 'three';
import type { Player, PlayerRig, ActionPose } from './player';

export type ActionKind = 'chop' | 'sweep' | 'pour' | 'sow' | 'pull' | 'place' | 'slam' | 'refill';

interface Key {
  t: number;
  ease?: 'out' | 'in' | 'inout' | 'back' | 'linear';
  aR?: [number, number];
  aL?: [number, number];
  torso?: [number, number, number];
  head?: number;
  sy?: number;
  bob?: number;
  /** Held tool rotation (arm space). */
  tool?: [number, number, number];
  /** Tool rotation relative to "upright in the torso frame" (watering can). */
  level?: number;
  /** Slide the hands down the handle (m): the tool head reaches further out (overhead wind-ups). */
  grip?: number;
}

type Pose = Required<Pick<Key, 'aR' | 'aL' | 'torso' | 'head' | 'sy' | 'bob' | 'grip'>> & { tool: [number, number, number] | null; level: number | null };

const REST: Pose = { aR: [0, -0.12], aL: [0, 0.12], torso: [0, 0, 0], head: 0, sy: 1, bob: 0, grip: 0, tool: null, level: null };
const TOOL_REST: [number, number, number] = [Math.PI / 2, 0, 0];

/** Keyframes per action (seconds). Impact times are in IMPACT. */
const TRACKS: Record<ActionKind, Key[]> = {
  // Anticipation: a quick crouch, then the whole body stretches up with the tool held high
  // overhead (blade reads above the hat from the 3/4 camera); the downswing whips the head of the
  // tool through faster than the arms; impact squashes the body and plants the legs.
  chop: [
    { t: 0 },
    { t: 0.06, ease: 'out', aR: [-0.7, -0.1], aL: [-0.6, 0.1], torso: [0.12, 0, 0], head: 0.05, sy: 0.93, tool: [Math.PI / 2 - 0.1, 0, 0] },
    { t: 0.19, ease: 'back', aR: [-2.9, -0.1], aL: [-2.6, 0.1], torso: [-0.26, 0, 0], head: -0.22, sy: 1.07, grip: 0.32, tool: [2.75, 0, 0.3] },
    { t: 0.27, ease: 'in', aR: [-0.34, -0.05], aL: [-0.22, 0.05], torso: [0.4, 0, 0], head: -0.08, sy: 0.9, bob: -0.02, tool: [Math.PI / 2 - 0.2, 0, 0] },
    { t: 0.36, ease: 'out', aR: [-0.26, -0.05], aL: [-0.16, 0.05], torso: [0.42, 0, 0], head: -0.04, sy: 0.95, tool: [Math.PI / 2 - 0.25, 0, 0] },
    { t: 0.66, ease: 'inout' },
  ],
  slam: [
    { t: 0 },
    { t: 0.14, ease: 'back', aR: [-3.1, -0.1], aL: [-2.8, 0.1], torso: [-0.3, 0, 0], head: -0.25, sy: 1.1, grip: 0.34, tool: [2.75, 0, 0.3] },
    { t: 0.22, ease: 'in', aR: [-0.2, -0.05], aL: [-0.15, 0.05], torso: [0.55, 0, 0], head: 0.2, sy: 0.86, bob: -0.04, tool: [Math.PI / 2 - 0.3, 0, 0] },
    { t: 0.36, ease: 'out', aR: [-0.18, -0.05], aL: [-0.12, 0.05], torso: [0.6, 0, 0], head: 0.2, sy: 0.92, bob: -0.03, tool: [Math.PI / 2 - 0.3, 0, 0] },
    { t: 0.75, ease: 'inout' },
  ],
  sweep: [
    { t: 0 },
    { t: 0.13, ease: 'out', aR: [-1.3, -1.25], aL: [-0.6, 0.3], torso: [0.12, 0.95, 0.05], sy: 0.95, tool: [Math.PI / 2, 0, -1.35] },
    { t: 0.25, ease: 'in', aR: [-1.35, 0.35], aL: [-0.8, 0.1], torso: [0.18, -1.05, -0.05], sy: 1.04, tool: [Math.PI / 2, 0, -1.35] },
    { t: 0.32, ease: 'out', aR: [-1.2, 0.45], aL: [-0.7, 0.1], torso: [0.15, -1.15, -0.05], sy: 0.97, tool: [Math.PI / 2, 0, -1.35] },
    { t: 0.56, ease: 'inout' },
  ],
  pour: [
    { t: 0 },
    { t: 0.2, ease: 'back', aR: [-1.2, -0.25], aL: [-0.95, 0.25], torso: [0.14, 0, 0], sy: 0.97, level: 0 },
    { t: 0.32, ease: 'inout', aR: [-1.25, -0.25], aL: [-1.0, 0.25], torso: [0.2, 0, 0], sy: 0.98, level: 0.9 },
    { t: 0.72, ease: 'linear', aR: [-1.32, -0.2], aL: [-1.05, 0.25], torso: [0.22, 0, 0], sy: 0.98, level: 1.0 },
    { t: 0.84, ease: 'inout', aR: [-1.2, -0.25], aL: [-0.95, 0.25], torso: [0.12, 0, 0], sy: 1.0, level: 0 },
    { t: 1.05, ease: 'inout' },
  ],
  refill: [
    { t: 0 },
    { t: 0.22, ease: 'out', aR: [-0.9, -0.2], aL: [-0.4, 0.2], torso: [0.55, 0, 0], sy: 0.9, level: -0.4 },
    { t: 0.6, ease: 'linear', aR: [-0.85, -0.2], aL: [-0.4, 0.2], torso: [0.58, 0, 0], sy: 0.9, level: -0.5 },
    { t: 0.9, ease: 'inout' },
  ],
  sow: [
    { t: 0 },
    { t: 0.11, ease: 'out', aR: [-0.5, -0.35], aL: [-0.2, 0.2], torso: [0.3, 0.15, 0], sy: 0.93, tool: [0.3, 0, 0] },
    { t: 0.2, ease: 'in', aR: [-1.05, 0.15], aL: [-0.25, 0.2], torso: [0.38, -0.1, 0], sy: 0.96, tool: [0.3, 0, 0] },
    { t: 0.46, ease: 'inout' },
  ],
  place: [
    { t: 0 },
    { t: 0.14, ease: 'out', aR: [-0.7, -0.1], aL: [-0.7, 0.1], torso: [0.5, 0, 0], sy: 0.88 },
    { t: 0.22, ease: 'in', aR: [-0.6, -0.1], aL: [-0.6, 0.1], torso: [0.55, 0, 0], sy: 0.9 },
    { t: 0.5, ease: 'inout' },
  ],
  pull: [
    { t: 0 },
    { t: 0.13, ease: 'out', aR: [-0.75, -0.1], aL: [-0.75, 0.1], torso: [0.52, 0, 0], head: 0.2, sy: 0.87 },
    { t: 0.26, ease: 'back', aR: [-2.95, -0.15], aL: [-2.95, 0.15], torso: [-0.12, 0, 0], head: -0.15, sy: 1.08, bob: 0.05 },
    { t: 0.36, ease: 'out', aR: [-2.85, -0.2], aL: [-2.85, 0.2], torso: [-0.08, 0, 0], head: -0.2, sy: 0.97, bob: 0.0 },
    { t: 0.78, ease: 'linear', aR: [-2.8, -0.2], aL: [-2.8, 0.2], torso: [-0.05, 0, 0], head: -0.18, sy: 1.0 },
    { t: 1.0, ease: 'inout' },
  ],
};

export const IMPACT: Record<ActionKind, number> = { chop: 0.27, slam: 0.22, sweep: 0.2, pour: 0.3, refill: 0.24, sow: 0.19, place: 0.2, pull: 0.2 };

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
    case 'linear':
      return t;
    default:
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}

function resolve(k: Key, prev: Pose): Pose {
  return {
    aR: k.aR ?? (k.t === 0 ? REST.aR : REST.aR),
    aL: k.aL ?? REST.aL,
    torso: k.torso ?? REST.torso,
    head: k.head ?? 0,
    sy: k.sy ?? 1,
    bob: k.bob ?? 0,
    grip: k.grip ?? 0,
    tool: k.tool ?? (prev.tool && k.level === undefined ? null : null),
    level: k.level ?? null,
  };
}

const lerp = THREE.MathUtils.lerp;
const GRIP_V = new THREE.Vector3();

export interface ActionOpts {
  tool?: THREE.Object3D | null;
  /** Fires once on the impact frame. */
  onImpact?: () => void;
  /** Every frame while active: (seconds since start). */
  onUpdate?: (t: number) => void;
  onDone?: () => void;
  /** Playback speed multiplier (>1 = snappier). */
  speed?: number;
  /** Freeze the whole action at this time (seconds) — for demo stills. */
  freezeAt?: number;
}

interface Active {
  kind: ActionKind;
  t: number;
  keys: Pose[];
  times: Key[];
  opts: ActionOpts;
  fired: boolean;
  dur: number;
}

export class FarmerActions {
  private cur: Active | null = null;
  private charging: { t: number; level: number; tool: THREE.Object3D | null } | null = null;
  private held: THREE.Object3D | null = null;
  private rig: PlayerRig;
  /** Time scale (0 freezes the pose). */
  timeScale = 1;
  /** Seconds since the last action ended (the idle blends back from the last pose). */
  private recover = 1;

  constructor(private player: Player) {
    this.rig = player.rig;
    player.actionPose = (rig, dt) => this.pose(rig, dt);
  }

  get active(): boolean {
    return !!this.cur || !!this.charging;
  }

  get kind(): ActionKind | null {
    return this.cur?.kind ?? null;
  }

  get isCharging(): boolean {
    return !!this.charging;
  }

  get chargeTime(): number {
    return this.charging?.t ?? 0;
  }

  /** Put a mesh in the farmer's right hand (null = empty hand). */
  hold(obj: THREE.Object3D | null): void {
    const socket = this.rig.tool;
    if (this.held === obj && obj) {
      socket.visible = true;
      return;
    }
    for (const c of [...socket.children]) socket.remove(c);
    this.held = obj;
    if (obj) {
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      socket.add(obj);
    }
    socket.visible = !!obj;
  }

  start(kind: ActionKind, opts: ActionOpts = {}): void {
    if (opts.tool !== undefined) this.hold(opts.tool);
    const track = TRACKS[kind];
    const keys: Pose[] = [];
    let prev = REST;
    for (const k of track) {
      const p = resolve(k, prev);
      keys.push(p);
      prev = p;
    }
    this.charging = null;
    this.cur = { kind, t: 0, keys, times: track, opts, fired: false, dur: track[track.length - 1]!.t };
    this.player.busy = true;
  }

  /** Freeze the running action when it reaches `t` seconds (demo stills). */
  setFreeze(t: number): void {
    if (this.cur) this.cur.opts.freezeAt = t;
  }

  /** Enter the hold-to-charge pose (tool raised, trembling). */
  charge(): void {
    this.cur = null;
    this.charging = { t: 0, level: 0, tool: this.held };
    this.player.busy = true;
  }

  cancel(): void {
    this.cur = null;
    this.charging = null;
    this.player.busy = false;
    this.rig.tool.visible = false;
  }

  /** World position of a point in the held tool's local space (e.g. the can spout). */
  toolPoint(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    const socket = this.rig.tool;
    socket.updateWorldMatrix(true, false);
    return out.copy(local).applyMatrix4(socket.matrixWorld);
  }

  /**
   * World positions of tool-local points at earlier moments `times` (s) of the running action —
   * re-poses the rig for each moment and restores the current pose after. Lets motion smears
   * trace the true arc of a swing at any frame rate (a 20 fps frame would otherwise cut a chord).
   */
  toolPointsAt(times: number[], locals: THREE.Vector3[], each: (pts: THREE.Vector3[]) => void): void {
    const a = this.cur;
    if (!a) return;
    const now = a.t;
    const pts = locals.map(() => new THREE.Vector3());
    for (const t of times) {
      a.t = t;
      this.apply(this.rig, this.sample(a));
      locals.forEach((l, i) => this.toolPoint(l, pts[i]));
      each(pts);
    }
    a.t = now;
    this.apply(this.rig, this.sample(a));
  }

  /** World direction of a tool-local axis. */
  toolDir(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    const socket = this.rig.tool;
    socket.updateWorldMatrix(true, false);
    return out.copy(local).transformDirection(socket.matrixWorld);
  }

  private apply(rig: PlayerRig, p: Pose, w = 1): ActionPose {
    const R = rig.armR.rotation;
    const L = rig.armL.rotation;
    R.x = lerp(R.x, p.aR[0], w);
    R.z = lerp(R.z, p.aR[1], w);
    L.x = lerp(L.x, p.aL[0], w);
    L.z = lerp(L.z, p.aL[1], w);
    rig.torso.rotation.x = lerp(rig.torso.rotation.x, p.torso[0], w);
    rig.torso.rotation.y = lerp(rig.torso.rotation.y, p.torso[1], w);
    rig.torso.rotation.z = lerp(rig.torso.rotation.z, p.torso[2], w);
    rig.head.rotation.x = lerp(rig.head.rotation.x, p.head, w);
    const tool = rig.tool;
    tool.position.set(0, -0.3, 0.02);
    if (p.level !== null) {
      // Keep the can upright in the torso frame (undo the arm pitch), then tip it forward.
      tool.rotation.set(-R.x + p.level * 0.95, 0, -R.z * 0.5);
    } else if (p.tool) {
      tool.rotation.set(p.tool[0], p.tool[1], p.tool[2]);
    } else {
      tool.rotation.set(TOOL_REST[0], TOOL_REST[1], TOOL_REST[2]);
    }
    if (p.grip) tool.position.add(GRIP_V.set(0, p.grip, 0).applyEuler(tool.rotation));
    // Legs brace during heavy swings.
    const brace = Math.max(0, p.torso[0]) * 0.5;
    rig.legL.rotation.x = lerp(rig.legL.rotation.x, -brace, w);
    rig.legR.rotation.x = lerp(rig.legR.rotation.x, brace * 0.6, w);
    return { sy: lerp(1, p.sy, w), bob: p.bob * w };
  }

  private sample(a: Active): Pose {
    const t = a.t;
    const ks = a.times;
    let i = 0;
    while (i < ks.length - 2 && t > ks[i + 1]!.t) i++;
    const k0 = ks[i]!;
    const k1 = ks[i + 1]!;
    const u = THREE.MathUtils.clamp((t - k0.t) / Math.max(1e-4, k1.t - k0.t), 0, 1);
    const e = ease(k1.ease, u);
    const p0 = a.keys[i]!;
    const p1 = a.keys[i + 1]!;
    const mix = (x: number, y: number): number => x + (y - x) * e;
    const tool0 = p0.tool ?? (p0.level === null ? TOOL_REST : null);
    const tool1 = p1.tool ?? (p1.level === null ? TOOL_REST : null);
    let level: number | null = null;
    if (p0.level !== null || p1.level !== null) level = mix(p0.level ?? 0, p1.level ?? 0);
    return {
      aR: [mix(p0.aR[0], p1.aR[0]), mix(p0.aR[1], p1.aR[1])],
      aL: [mix(p0.aL[0], p1.aL[0]), mix(p0.aL[1], p1.aL[1])],
      torso: [mix(p0.torso[0], p1.torso[0]), mix(p0.torso[1], p1.torso[1]), mix(p0.torso[2], p1.torso[2])],
      head: mix(p0.head, p1.head),
      sy: mix(p0.sy, p1.sy),
      bob: mix(p0.bob, p1.bob),
      grip: mix(p0.grip, p1.grip),
      tool: tool0 && tool1 ? [mix(tool0[0], tool1[0]), mix(tool0[1], tool1[1]), mix(tool0[2], tool1[2])] : null,
      level,
    };
  }

  private pose(rig: PlayerRig, dt: number): ActionPose | null {
    const d = dt * this.timeScale;
    if (this.charging) {
      const c = this.charging;
      c.t += d;
      // Raise the tool overhead, then hold with a building tremble.
      const up = 1 - Math.pow(1 - Math.min(1, c.t / 0.2), 3);
      const tremble = Math.sin(c.t * 55) * 0.03 * Math.min(1, c.t);
      const p: Pose = { ...REST, aR: [-2.85 * up + tremble, -0.1], aL: [-2.5 * up, 0.1], torso: [-0.2 * up, 0, 0], head: -0.15 * up, sy: 1 - 0.07 * up + Math.sin(c.t * 40) * 0.006, bob: 0, grip: 0.3 * up, tool: [Math.PI / 2 + 1.2 * up, 0, 0.3 * up], level: null };
      rig.tool.visible = true;
      return this.apply(rig, p);
    }
    const a = this.cur;
    if (!a) {
      if (this.recover < 1) this.recover += dt;
      return null;
    }
    const speed = a.opts.speed ?? 1;
    const prevT = a.t;
    a.t += d * speed;
    if (a.opts.freezeAt !== undefined && a.t >= a.opts.freezeAt) {
      a.t = a.opts.freezeAt;
      this.timeScale = 0;
    }
    const impactT = IMPACT[a.kind];
    if (!a.fired && a.t >= impactT && prevT <= impactT + 1e-6) {
      a.fired = true;
      a.opts.onImpact?.();
    }
    rig.tool.visible = !!this.held;
    const pose = this.apply(rig, this.sample(a));
    // After the pose is applied: toolPoint() now reads this frame's arm + tool transforms (the
    // player's idle animation overwrites the arms before actionPose runs).
    a.opts.onUpdate?.(a.t);
    if (a.t >= a.dur) {
      this.cur = null;
      this.player.busy = false;
      rig.tool.visible = false;
      this.recover = 0;
      a.opts.onDone?.();
    }
    return pose;
  }
}
