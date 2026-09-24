/**
 * Crouch-and-pluck pose for foraging: the farmer drops into a squat, reaches down with the right
 * hand (tool stowed: whatever was in the hand is hidden, never removed), plucks on the impact
 * frame, and springs back up. Drives `player.actionPose` by WRAPPING the installed driver (farm
 * tool actions keep working; this one only answers while a pluck plays), like world/mine/actions.
 */
import * as THREE from 'three';
import type { Player, PlayerRig, ActionPose } from '../../entities/player';

interface Key {
  t: number;
  aR: [number, number];
  aL: [number, number];
  torso: number;
  head: number;
  sy: number;
  bob: number;
  leg: number;
}

const REST: Omit<Key, 't'> = { aR: [0, -0.12], aL: [0, 0.12], torso: 0, head: 0, sy: 1, bob: 0, leg: 0 };
const KEYS: Key[] = [
  { t: 0, ...REST },
  // Anticipation: squat, lean in, reach.
  { t: 0.14, aR: [-0.95, -0.25], aL: [-0.35, 0.3], torso: 0.62, head: 0.25, sy: 0.84, bob: -0.12, leg: 0.55 },
  // Grab (impact) — the find pops here.
  { t: 0.22, aR: [-1.15, -0.2], aL: [-0.4, 0.3], torso: 0.7, head: 0.3, sy: 0.8, bob: -0.15, leg: 0.6 },
  // Spring up with the find, a little stretch.
  { t: 0.36, aR: [-2.2, -0.35], aL: [-0.3, 0.25], torso: -0.12, head: -0.25, sy: 1.08, bob: 0.03, leg: 0 },
  { t: 0.62, ...REST },
];
export const PLUCK_IMPACT = 0.22;

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class PluckAction {
  private t = -1;
  private fired = false;
  private onImpact: (() => void) | null = null;
  private prev: Player['actionPose'] = null;
  private hidden: THREE.Object3D[] = [];
  private socketWas = false;
  private readonly fn: NonNullable<Player['actionPose']>;

  constructor(private player: Player) {
    this.fn = (rig, dt) => (this.t >= 0 ? this.pose(rig, dt) : (this.prev?.(rig, dt) ?? null));
  }

  get active(): boolean {
    return this.t >= 0;
  }

  private ensure(): void {
    if (this.player.actionPose === this.fn) return;
    this.prev = this.player.actionPose;
    this.player.actionPose = this.fn;
  }

  start(onImpact: () => void): void {
    this.ensure();
    if (this.t >= 0) this.finish();
    this.t = 0;
    this.fired = false;
    this.onImpact = onImpact;
    // Stow the tool: a hoe never "picks" a flower.
    const socket = this.player.rig.tool;
    this.socketWas = socket.visible;
    this.hidden = socket.children.filter((c) => c.visible);
    for (const c of this.hidden) c.visible = false;
    socket.visible = false;
    this.player.busy = true;
  }

  private finish(): void {
    this.t = -1;
    for (const c of this.hidden) c.visible = true;
    this.hidden = [];
    this.player.rig.tool.visible = this.socketWas;
    this.player.busy = false;
    if (!this.fired) {
      this.fired = true;
      this.onImpact?.();
    }
  }

  private pose(rig: PlayerRig, dt: number): ActionPose | null {
    this.t += dt;
    if (!this.fired && this.t >= PLUCK_IMPACT) {
      this.fired = true;
      this.onImpact?.();
    }
    const end = KEYS[KEYS.length - 1]!.t;
    if (this.t >= end) {
      this.finish();
      return null;
    }
    let i = 0;
    while (i < KEYS.length - 2 && this.t > KEYS[i + 1]!.t) i++;
    const a = KEYS[i]!;
    const b = KEYS[i + 1]!;
    const e = ease(THREE.MathUtils.clamp((this.t - a.t) / (b.t - a.t), 0, 1));
    const m = (x: number, y: number): number => x + (y - x) * e;
    rig.armR.rotation.x = m(a.aR[0], b.aR[0]);
    rig.armR.rotation.z = m(a.aR[1], b.aR[1]);
    rig.armL.rotation.x = m(a.aL[0], b.aL[0]);
    rig.armL.rotation.z = m(a.aL[1], b.aL[1]);
    rig.torso.rotation.set(m(a.torso, b.torso), 0, 0);
    rig.head.rotation.x = m(a.head, b.head);
    const leg = m(a.leg, b.leg);
    // Knees forward in the squat (legs swing opposite the torso lean).
    rig.legL.rotation.x = -leg;
    rig.legR.rotation.x = -leg * 0.8;
    rig.tool.visible = false;
    return { sy: m(a.sy, b.sy), bob: m(a.bob, b.bob) };
  }
}
