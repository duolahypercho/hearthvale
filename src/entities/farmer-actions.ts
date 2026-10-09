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

export type ActionKind = 'chop' | 'sweep' | 'pour' | 'sow' | 'pull' | 'lift' | 'place' | 'slam' | 'refill' | 'shrug';

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
  /**
   * Held tool rotation in the TORSO frame (Euler XYZ; handle +Y, working edge +Z, farmer facing +Z,
   * +X = the wind-up side). Independent of the arm angles, so a wind-up can place the blade exactly
   * (e.g. up and out beside the hat, never hidden behind it). Interpolates with `tool` keys by slerp.
   */
  toolT?: [number, number, number];
  /** Tool rotation relative to "upright in the torso frame" (watering can). */
  level?: number;
  /** Slide the hands down the handle (m): the tool head reaches further out (overhead wind-ups). */
  grip?: number;
  /** Arm stretch (Y scale, cartoon squash & stretch): the "ta-da" hold reaches over the big head. */
  reach?: number;
  /** Hips [pitch, twist] (rad): the pelvis drives the swing; the torso rides on it. */
  hips?: [number, number];
  /** Lunge (rad): front leg forward / back leg back; the body drops so the boots stay planted (knee compression). */
  stance?: number;
}

type Pose = Required<Pick<Key, 'aR' | 'aL' | 'torso' | 'head' | 'sy' | 'bob' | 'grip' | 'reach' | 'hips' | 'stance'>> & { tool: [number, number, number] | null; level: number | null; toolT?: [number, number, number] | null; toolQ?: THREE.Quaternion | null };

const REST: Pose = { aR: [0, -0.12], aL: [0, 0.12], torso: [0, 0, 0], head: 0, sy: 1, bob: 0, grip: 0, reach: 1, hips: [0, 0], stance: 0, tool: null, level: null };
const TOOL_REST: [number, number, number] = [Math.PI / 2, 0, 0];
/** The straw hat's resting tilt (player rig: worn pushed back). */
const HAT_TILT = -0.52;

/** Keyframes per action (seconds). Impact times are in IMPACT. */
const TRACKS: Record<ActionKind, Key[]> = {
  // Anticipation: a quick crouch, then the whole body stretches up with the tool held high
  // overhead (blade reads above the hat from the 3/4 camera); the downswing whips the head of the
  // tool through faster than the arms; impact squashes the body and plants the legs.
  // The wind-up swings the tool up over the shoulder on the camera side (see FarmerActions.side),
  // torso twisted and leaning back, so the tool head clears the hat silhouette at the top.
  chop: [
    { t: 0 },
    // (r22) Gather: a deep crouch — knees give, hips sit back and coil a touch toward the tile, both
    // hands low on the handle with the blade drawn back along the ground toward the boots.
    // (r27) Deeper and HELD (two frames): the r10 critic found the anticipation frames interchangeable
    // and the legs passive — the knees load, the pelvis coils away from the tile (hips twist with the
    // chest counter-turned so it stays on the work), the rear foot plants.
    { t: 0.1, ease: 'out', aR: [-0.5, -0.1], aL: [-0.44, 0.12], torso: [0.32, 0.02, 0.05], head: -0.3, sy: 0.74, bob: -0.04, hips: [0.22, 0.3], stance: 0.42, tool: [Math.PI / 2 + 0.24, 0, 0] },
    { t: 0.13, ease: 'linear', aR: [-0.56, -0.1], aL: [-0.5, 0.12], torso: [0.3, 0.0, 0.05], head: -0.3, sy: 0.73, bob: -0.042, hips: [0.2, 0.34], stance: 0.44, tool: [Math.PI / 2 + 0.3, 0, 0] },
    // (r22) Rising (r9 critic: "wind-up lacks bodily commitment"): an overhead heave out of the
    // crouch — the body arches back and stretches tall in a wide split stance (rear foot planted),
    // both fists climb past the hat brim on the camera side and the shaft lays back over the
    // shoulder, the blade cocked up behind and out (the face stays open below the arms). No chest
    // twist toward the lens: the coil is a back arch, so the silhouette stays in profile.
    // (r25) A centred overhead coil (r10 critic: the wind-up turned square to the lens with the hoe
    // held at the shoulder like a flag): no twist or side roll — the chest stays on the tile — both
    // fists climb straight up over the hat and the blade swings up and BACK over the crown.
    { t: 0.17, ease: 'out', aR: [-2.6, -0.2], aL: [-2.48, -0.02], torso: [-0.12, -0.14, -0.04], head: 0.0, sy: 1.1, hips: [-0.06, 0.2], stance: 0.5, grip: 0.12, reach: 1.26, toolT: [-0.45, 0, 0.16] },
    // Top: the held beat before the blow — arched back, fists high over the head, the hoe laid back
    // ~45° in the torso (≈ 65° from plumb once the back arch adds its lean) so the blade stands HIGH
    // above and behind the hat, chin up (exertion). (r24: at 79° + the arch the shaft lay flat behind
    // the neck like a bindle, the blade at ear height.)
    // (r25) Top: hands above the head, back arched, body stretched tall (rear heel up), the blade high
    // behind the hat, cocked a touch to the lens side so the crown never hides it.
    // (A light arch only: a deep one turned the face up into a high lens, reading as a turn to camera.)
    // (r27) The pelvis stays coiled at the top (hips 0.22 back, chest counter-turned onto the tile), so
    // the downswing is a visible unwinding from the legs up rather than arms alone.
    { t: 0.205, ease: 'out', aR: [-2.88, -0.18], aL: [-2.76, 0.0], torso: [-0.18, -0.16, -0.05], head: 0.0, sy: 1.15, hips: [-0.08, 0.22], stance: 0.58, grip: 0.16, reach: 1.36, toolT: [-0.6, 0, 0.18] },
    // Downswing (two readable frames, ~70 ms): the hips fire first, the body jack-knifes forward, the
    // arms whip down; the blade sweeps over OUT FRONT of the face (shaft ~50° forward, never across it).
    { t: 0.24, ease: 'in', aR: [-2.05, -0.3], aL: [-1.95, -0.42], torso: [0.1, 0.0, -0.08], head: -0.2, sy: 1.02, hips: [0.08, -0.08], stance: 0.56, grip: 0.06, reach: 1.24, toolT: [0.85, 0, 0.35] },
    { t: 0.258, ease: 'in', aR: [-1.25, -0.2], aL: [-1.12, -0.12], torso: [0.32, -0.04, -0.02], head: -0.36, sy: 0.86, hips: [0.12, -0.02], stance: 0.56, grip: 0.04, reach: 1.24, toolT: [1.45, 0, 0.14] },
    // Impact: the torso whips over, knees drop into a lunge, the body squashes hard; the blade bites
    // below the surface (blade-tip IK, see `aim`).
    { t: 0.275, ease: 'in', aR: [-0.42, -0.05], aL: [-0.3, 0.05], torso: [0.38, -0.02, 0], head: -0.4, sy: 0.76, bob: -0.02, hips: [0.12, 0.08], stance: 0.56, tool: [Math.PI / 2 - 0.15, 0, 0] },
    // Bite: held two frames in the ground, the body still sinking into it (exertion). (r22) The head
    // stays tipped back against the body's lean (negative = chin up) so the face never hides under the hat.
    { t: 0.32, ease: 'linear', aR: [-0.38, -0.05], aL: [-0.27, 0.05], torso: [0.4, 0.02, 0], head: -0.4, sy: 0.77, bob: -0.02, hips: [0.13, 0.08], stance: 0.56, tool: [Math.PI / 2 - 0.12, 0, 0] },
    // Recoil: the hoe is ripped back toward the boots (blade LOW, in front of the shins — never up
    // by the face), the body springs up past rest and rocks back.
    // (r27) A stronger recoil: the body springs up well past rest (stretch 1.16) and rocks back, the
    // blade kept pointing down at the shins (r26 flipped it blade-up in front of the knees mid-release).
    { t: 0.42, ease: 'out', aR: [-0.44, -0.08], aL: [-0.34, 0.06], torso: [-0.12, 0.08, 0.02], head: 0.1, sy: 1.16, bob: 0.03, hips: [-0.08, 0.04], stance: 0.24, tool: [Math.PI / 2 + 0.22, 0, 0] },
    // (r20) Recovery to a blade-down rest: the hoe settles with its blade on the ground in front of
    // the boots (never a shaft carried across the hips).
    { t: 0.54, ease: 'inout', aR: [-0.5, -0.08], aL: [-0.36, 0.08], torso: [0.1, 0.04, 0], head: -0.06, sy: 0.99, hips: [0.02, 0.02], stance: 0.1, tool: [Math.PI / 2 + 0.05, 0, 0] },
    { t: 0.68, ease: 'inout' },
  ],
  // Released from the charge hold: it starts up beside the hat (same as the charge pose, no pop
  // back to rest), rises a touch higher, then comes down hard.
  slam: [
    { t: 0, aR: [-2.95, -0.45], aL: [-2.75, -0.25], torso: [-0.18, -0.24, -0.1], head: -0.12, sy: 0.95, hips: [-0.1, -0.14], stance: 0.12, grip: 0.24, toolT: [-0.8, 0, 0.5] },
    { t: 0.15, ease: 'out', aR: [-3.05, -0.5], aL: [-2.85, -0.3], torso: [-0.22, -0.24, -0.1], head: -0.16, sy: 1.14, hips: [-0.12, -0.15], stance: 0.14, grip: 0.3, toolT: [-0.85, 0, 0.5] },
    { t: 0.22, ease: 'in', aR: [-0.3, -0.05], aL: [-0.2, 0.05], torso: [0.44, 0, 0], head: -0.3, sy: 0.76, hips: [0.24, 0.05], stance: 0.62, tool: [Math.PI / 2 - 0.18, 0, 0] },
    { t: 0.3, ease: 'linear', aR: [-0.27, -0.05], aL: [-0.18, 0.05], torso: [0.46, 0, 0], head: -0.3, sy: 0.77, hips: [0.25, 0.05], stance: 0.64, tool: [Math.PI / 2 - 0.15, 0, 0] },
    { t: 0.44, ease: 'out', aR: [-0.7, -0.06], aL: [-0.55, 0.05], torso: [0.26, 0, 0], head: -0.12, sy: 1.05, hips: [0.08, 0.02], stance: 0.32, tool: [Math.PI / 2 - 0.5, 0, 0] },
    { t: 0.75, ease: 'inout' },
  ],
  sweep: [
    { t: 0 },
    { t: 0.13, ease: 'out', aR: [-1.3, -1.25], aL: [-0.6, 0.3], torso: [0.12, 0.95, 0.05], sy: 0.95, tool: [Math.PI / 2, 0, -1.35] },
    { t: 0.25, ease: 'in', aR: [-1.35, 0.35], aL: [-0.8, 0.1], torso: [0.18, -1.05, -0.05], sy: 1.04, tool: [Math.PI / 2, 0, -1.35] },
    { t: 0.32, ease: 'out', aR: [-1.2, 0.45], aL: [-0.7, 0.1], torso: [0.15, -1.15, -0.05], sy: 0.97, tool: [Math.PI / 2, 0, -1.35] },
    { t: 0.56, ease: 'inout' },
  ],
  // Two-hand pour: the can is carried by its top handle well out in front at hip height (in the
  // camera-side hand, see `start`), the free hand steadying its belly from below; it tips ~35°
  // about the farmer's own left-right axis, rolling forward off the body (never into the bib), so
  // the rose points along the facing and the droplets arc out to the tile.
  pour: [
    { t: 0 },
    // (r19) Anticipation: a dip — knees give, the can swings back a touch on its handle.
    // (r27) A real dip: knees give hard, the can swings back on its handle (rose up), shoulders drop.
    { t: 0.12, ease: 'out', aR: [-0.5, -0.14], aL: [-0.4, 0.5], torso: [0.1, 0, -0.04], head: -0.08, sy: 0.86, bob: -0.035, level: -0.26, reach: 1.12, stance: 0.12 },
    // The lift: a committed heave up past shoulder height, the free hand under the belly, body tall.
    // (r22) Higher and held further out (r9 critic: "the can barely tips"): the can rides up to chin
    // height so the water has a real drop to arc across.
    // (r27) The heave overshoots (rear heel up, body stretched, can cocked back past level) so the
    // tip that follows is a visible change of direction, not a drift.
    { t: 0.3, ease: 'back', aR: [-2.02, -0.16], aL: [-1.62, 0.6], torso: [-0.12, 0, 0.08], head: 0.04, sy: 1.12, level: 0.08, reach: 1.22, stance: 0.16 },
    // The tip: the shoulder rolls hard into it (torso roll toward the can, hips under it), the can
    // pitched ~45° so the rose levels out over the tile and the water leaves it forward in a long arc
    // (the face stays up, clear of the hat).
    // (r27) Committed: the whole body leans into the pour (chest over the front foot, split stance,
    // shoulder rolled ~20°) and the can tips ~55° — the rose points down the arc it throws.
    { t: 0.4, ease: 'inout', aR: [-1.8, -0.16], aL: [-1.44, 0.62], torso: [0.17, 0, 0.34], head: -0.1, sy: 0.97, level: 1.0, reach: 1.2, stance: 0.32, hips: [0.08, 0] },
    // Held tipped (pours ~0.6 s), tipping further as the can empties.
    { t: 0.92, ease: 'linear', aR: [-1.74, -0.16], aL: [-1.38, 0.62], torso: [0.2, 0, 0.37], head: -0.1, sy: 0.96, level: 1.14, reach: 1.2, stance: 0.34, hips: [0.09, 0] },
    { t: 1.08, ease: 'inout', aR: [-0.95, -0.14], aL: [-0.6, 0.45], torso: [0.03, 0, 0.02], sy: 1.05, level: 0.05, reach: 1.2 },
    { t: 1.26, ease: 'inout' },
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
  // Too tired: shoulders lift, arms flop out, head droops (a sigh).
  shrug: [
    { t: 0 },
    { t: 0.14, ease: 'out', aR: [-0.25, -0.55], aL: [-0.25, 0.55], torso: [-0.08, 0, 0], head: -0.12, sy: 1.05 },
    { t: 0.36, ease: 'inout', aR: [-0.05, -0.3], aL: [-0.05, 0.3], torso: [0.12, 0, 0], head: 0.3, sy: 0.93 },
    { t: 0.7, ease: 'inout' },
  ],
  // Yank it out (crouch → spring up), then the show-off: the right arm thrown up and out
  // (stretched a touch, cartoon reach) holding the produce up beside the head, the free fist
  // thrown up too in a cheer (a 'ta-da' V, never a doll's T-pose).
  // The grab is a squat (body squashed + dropped), not a deep bow: the torso tips only ~17° and the
  // head tilts BACK (face up) so the big hat never covers the farmer from the high camera.
  pull: [
    { t: 0 },
    { t: 0.11, ease: 'out', aR: [-0.95, -0.1], aL: [-0.95, 0.1], torso: [0.35, 0, 0], head: -0.22, sy: 0.8, bob: -0.075 },
    // Held crouch (two frames of anticipation: knees bent, torso pitched ~20° over the crop).
    { t: 0.19, ease: 'linear', aR: [-1.0, -0.1], aL: [-1.0, 0.1], torso: [0.36, 0, 0], head: -0.2, sy: 0.79, bob: -0.08 },
    { t: 0.3, ease: 'back', aR: [0.12, 2.45], aL: [-0.3, -2.7], torso: [-0.1, 0, -0.1], head: -0.1, sy: 1.08, bob: 0.05, reach: 1.5 },
    { t: 0.4, ease: 'out', aR: [0.1, 2.38], aL: [-0.28, -2.6], torso: [-0.06, 0, -0.08], head: -0.12, sy: 0.97, bob: 0.0, reach: 1.46 },
    // Held up until the produce zips off to the backpack (it leaves at ~0.82 s); the arm drops
    // with it (no empty hand left hanging in the air).
    { t: 0.83, ease: 'linear', aR: [0.08, 2.34], aL: [-0.26, -2.55], torso: [-0.04, 0, -0.07], head: -0.1, sy: 1.0, reach: 1.44 },
    { t: 1.04, ease: 'inout' },
  ],
  // Big produce (melon, pumpkin, cauliflower): squat and hold the crouch, heave, then hug it up in
  // front of the chest with BOTH palms pressed on its sides (the produce sits between the hands,
  // under the chin — the face stays clear above it), leaning back a touch under the weight.
  lift: [
    { t: 0 },
    { t: 0.12, ease: 'out', aR: [-1.0, 0.2], aL: [-1.0, -0.2], torso: [0.36, 0, 0], head: -0.2, sy: 0.8, bob: -0.08 },
    { t: 0.22, ease: 'linear', aR: [-1.05, 0.2], aL: [-1.05, -0.2], torso: [0.37, 0, 0], head: -0.2, sy: 0.78, bob: -0.085 },
    { t: 0.38, ease: 'back', aR: [-1.94, 0.18], aL: [-1.94, -0.18], torso: [-0.14, 0, 0], head: -0.22, sy: 1.08, bob: 0.06, reach: 1.4 },
    { t: 0.5, ease: 'out', aR: [-1.86, 0.17], aL: [-1.86, -0.17], torso: [-0.1, 0, 0], head: -0.18, sy: 0.95, bob: -0.01, reach: 1.38 },
    { t: 1.02, ease: 'linear', aR: [-1.84, 0.17], aL: [-1.84, -0.17], torso: [-0.09, 0, 0], head: -0.17, sy: 0.99, reach: 1.38 },
    { t: 1.24, ease: 'inout' },
  ],
};

export const IMPACT: Record<ActionKind, number> = { chop: 0.275, slam: 0.22, sweep: 0.2, pour: 0.38, refill: 0.24, sow: 0.19, place: 0.2, pull: 0.2, lift: 0.24, shrug: 0.36 };

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
    reach: k.reach ?? 1,
    hips: k.hips ?? [0, 0],
    stance: k.stance ?? 0,
    tool: k.tool ?? (prev.tool && k.level === undefined ? null : null),
    level: k.level ?? null,
    toolT: k.toolT ?? null,
  };
}

const lerp = THREE.MathUtils.lerp;
const GRIP_V = new THREE.Vector3();
const _qArm = new THREE.Quaternion();
const _qTip = new THREE.Quaternion();
const _eArm = new THREE.Euler();
const _X = new THREE.Vector3(1, 0, 0);
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();
const _qAim = new THREE.Quaternion();
const _qId = new THREE.Quaternion();
const _aT = new THREE.Vector3();
const _aB = new THREE.Vector3();
const _hT = new THREE.Vector3();
const _DOWN = new THREE.Vector3(0, -1, 0);

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
  /**
   * Blade-tip IK: around the impact the held tool is turned (and slid along its handle) so the
   * tool-local point `local` lands exactly on `target` (world) — the hoe bites the tile centre.
   */
  aim?: { target: THREE.Vector3; local: THREE.Vector3; drag?: THREE.Vector3 };
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
  /**
   * +1 = wind up over the right shoulder, -1 = over the left (mirrors the twist / lean / tool
   * roll). The farming system points it at the camera so the tool head never hides behind the hat.
   */
  side = 1;
  private hatK = 1;
  /** The can is carried in the LEFT hand (a pour on the camera's left side): arms swap roles. */
  private leftHand = false;

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

  /** Seconds into the running action (0 when idle). */
  get time(): number {
    return this.cur?.t ?? 0;
  }

  /** Action seconds per real second right now (time scale × the action's speed). */
  get rate(): number {
    return this.timeScale * (this.cur?.opts.speed ?? 1);
  }

  /** Length of the running action (s). */
  get duration(): number {
    return this.cur?.dur ?? 0;
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
    // The can goes in the camera-side hand (never carried behind the body, never crossing it).
    this.setHand((kind === 'pour' || kind === 'refill') && this.side < 0);
    this.cur = { kind, t: 0, keys, times: track, opts, fired: false, dur: track[track.length - 1]!.t };
    this.player.busy = true;
  }

  private setHand(left: boolean): void {
    if (this.leftHand === left) return;
    this.leftHand = left;
    const arm = left ? this.rig.armL : this.rig.armR;
    arm.add(this.rig.tool);
  }

  /** Freeze the running action when it reaches `t` seconds (demo stills). */
  setFreeze(t: number): void {
    if (this.cur) this.cur.opts.freezeAt = t;
  }

  /** Enter the hold-to-charge pose (tool raised, trembling). */
  charge(): void {
    this.cur = null;
    this.setHand(false);
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
      this.aimTool(a, t);
      locals.forEach((l, i) => this.toolPoint(l, pts[i]));
      each(pts);
    }
    a.t = now;
    this.apply(this.rig, this.sample(a));
    this.aimTool(a, now);
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
    const sd = this.side;
    // Mirror about the rest pose: the arm roll offsets, torso twist / lean and tool roll flip sides.
    const mz = (v: number, rest: number): number => (sd > 0 ? v : rest - (v - rest));
    if (this.leftHand) {
      // Left-hand carry: an exact mirror (the "right" keys drive the left arm and vice versa).
      L.x = lerp(L.x, p.aR[0], w);
      L.z = lerp(L.z, -p.aR[1], w);
      R.x = lerp(R.x, p.aL[0], w);
      R.z = lerp(R.z, -p.aL[1], w);
    } else {
      R.x = lerp(R.x, p.aR[0], w);
      R.z = lerp(R.z, mz(p.aR[1], REST.aR[1]), w);
      L.x = lerp(L.x, p.aL[0], w);
      L.z = lerp(L.z, mz(p.aL[1], REST.aL[1]), w);
    }
    rig.torso.rotation.x = lerp(rig.torso.rotation.x, p.torso[0], w);
    rig.torso.rotation.y = lerp(rig.torso.rotation.y, p.torso[1] * sd, w);
    rig.torso.rotation.z = lerp(rig.torso.rotation.z, p.torso[2] * sd, w);
    rig.head.rotation.x = lerp(rig.head.rotation.x, p.head, w);
    // The idle look-around (random head turns) must not run through a swing: eyes on the work.
    rig.head.rotation.y = lerp(rig.head.rotation.y, 0, w);
    rig.head.rotation.z = lerp(rig.head.rotation.z, 0, w);
    const reach = lerp(1, p.reach, w);
    rig.armR.scale.set(1, reach, 1);
    rig.armL.scale.set(1, reach, 1);
    // The big straw hat shrinks a little while working so the swing and the target tile stay visible.
    if (rig.hat) {
      rig.hat.scale.setScalar(this.hatK);
      // Bending forward tips the hat back on the head (brim up), so the crown never fills the frame.
      rig.hat.rotation.x = HAT_TILT - Math.max(0, p.torso[0]) * 0.9 * w;
    }
    const tool = rig.tool;
    tool.position.set(0, -0.3, 0.02);
    if (p.level !== null) {
      // The can's orientation is set in the torso frame (undo the arm's pitch AND roll exactly), so
      // it only ever tips forward about the farmer's own left-right axis: the rose stays pointed
      // along the facing direction for the whole pour (never swings round to face the camera).
      const H = this.leftHand ? L : R;
      _qArm.setFromEuler(_eArm.set(H.x, H.y, H.z, H.order)).invert();
      _qTip.setFromAxisAngle(_X, p.level * 0.95);
      tool.quaternion.copy(_qArm).multiply(_qTip);
      // Tipping about the handle swings the can's body back toward the farmer: roll it forward
      // (torso frame) by the same amount so it tips over its own belly, clear of the overalls.
      if (p.level > 0) tool.position.add(GRIP_V.set(0, 0.04 * p.level, 0.2 * p.level).applyQuaternion(_qArm));
    } else if (p.toolQ) {
      tool.quaternion.copy(p.toolQ);
    } else if (p.tool) {
      tool.rotation.set(p.tool[0], p.tool[1] * sd, p.tool[2] * sd);
    } else {
      tool.rotation.set(TOOL_REST[0], TOOL_REST[1], TOOL_REST[2]);
    }
    if (p.grip) tool.position.add(GRIP_V.set(0, p.grip, 0).applyEuler(tool.rotation));
    // Legs brace during heavy swings.
    // (r15: a deeper lunge — the knees read as dipping under a heavy blow.)
    // (r16) The pelvis leads: hips pitch / twist under the torso, and a lunge splits the legs (front
    // leg forward on the wind-up side's opposite, back leg braced). One-bone legs can't bend, so the
    // body drops by the height the split lifts the boots: the knees read as compressing.
    const brace = Math.max(0, p.torso[0]) * 0.45;
    const fwd = -(brace + p.stance);
    const back = brace * 0.5 + p.stance * 0.75;
    rig.legL.rotation.x = lerp(rig.legL.rotation.x, fwd, w);
    rig.legR.rotation.x = lerp(rig.legR.rotation.x, back, w);
    rig.hips.rotation.x = lerp(rig.hips.rotation.x, p.hips[0], w);
    rig.hips.rotation.y = lerp(rig.hips.rotation.y, p.hips[1] * sd, w);
    // The hip pitch also swings the legs; counter it so the boots stay planted under the body.
    rig.legL.rotation.x -= p.hips[0] * w;
    rig.legR.rotation.x -= p.hips[0] * w;
    const split = Math.max(Math.abs(rig.legL.rotation.x + p.hips[0] * w), Math.abs(rig.legR.rotation.x + p.hips[0] * w));
    const kneeDrop = -0.6 * (1 - Math.cos(split)) * p.sy;
    return { sy: lerp(1, p.sy, w), bob: (p.bob + kneeDrop) * w };
  }

  /**
   * (r16) Two-hand grip: the free hand is locked onto the handle (one-bone arm IK aimed at a point a
   * forearm's length up the handle from the main hand, with a cartoon stretch), so both hands drive
   * the tool through the wind-up, the blow and the recoil instead of one arm waving a stick.
   */
  private twoHand(w: number, grip: number): void {
    if (w <= 0.001 || !this.held) return;
    const rig = this.rig;
    const arm = this.leftHand ? rig.armR : rig.armL;
    const parent = arm.parent;
    if (!parent) return;
    rig.tool.updateWorldMatrix(true, false);
    _hT.set(0, THREE.MathUtils.clamp(0.27 - grip, -0.1, 0.5), 0).applyMatrix4(rig.tool.matrixWorld);
    parent.updateWorldMatrix(true, false);
    parent.worldToLocal(_hT);
    _hT.sub(arm.position);
    const len = _hT.length();
    if (len < 1e-4) return;
    _hT.divideScalar(len);
    _qAim.setFromUnitVectors(_DOWN, _hT);
    arm.quaternion.slerp(_qAim, w);
    // Hand sphere sits 0.3 down the arm: stretch / squash the arm to reach the handle exactly.
    const k = THREE.MathUtils.clamp(len / 0.3, 0.6, 1.6);
    arm.scale.y = lerp(arm.scale.y, k, w);
  }

  /** Two-hand grip weight: swings (hoe / scythe / slam) grip with both hands, eased in and out. */
  private twoHandWeight(a: Active): number {
    if (a.kind !== 'chop' && a.kind !== 'slam' && a.kind !== 'sweep') return 0;
    const ss = THREE.MathUtils.smoothstep;
    return (a.kind === 'slam' ? 1 : ss(a.t, 0.0, 0.07)) * (1 - ss(a.t, a.dur - 0.16, a.dur - 0.02));
  }

  /** Weight of the blade-tip IK at action time t: ramps in through the downswing, holds, releases. */
  private aimWeight(a: Active, t: number): number {
    const imp = IMPACT[a.kind];
    const ss = THREE.MathUtils.smoothstep;
    return ss(t, imp - 0.07, imp - 0.005) * (1 - ss(t, imp + 0.16, imp + 0.32));
  }

  private aimTool(a: Active, t: number): void {
    const aim = a.opts.aim;
    if (!aim) return;
    const w = this.aimWeight(a, t);
    if (w <= 0.001) return;
    const tool = this.rig.tool;
    const parent = tool.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    _aT.copy(aim.target);
    // (r16) After the bite the blade is dragged back toward the boots (it tills, not taps).
    if (aim.drag) _aT.addScaledVector(aim.drag, THREE.MathUtils.smoothstep(t, IMPACT[a.kind] + 0.03, IMPACT[a.kind] + 0.15));
    parent.worldToLocal(_aT);
    _aB.copy(aim.local).applyQuaternion(tool.quaternion);
    const L0 = _aB.length();
    _aT.sub(tool.position);
    const L1 = _aT.length();
    if (L0 < 1e-4 || L1 < 1e-4) return;
    _aB.divideScalar(L0);
    _aT.divideScalar(L1);
    _qAim.setFromUnitVectors(_aB, _aT);
    _qAim.slerpQuaternions(_qId, _qAim, w);
    tool.quaternion.premultiply(_qAim);
    // Slide the grip along the (new) blade direction to close the length gap (bounded).
    const slide = THREE.MathUtils.clamp(L1 - L0, -0.3, 0.3) * w;
    tool.position.addScaledVector(_aT, slide);
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
    let toolQ: THREE.Quaternion | null = null;
    if ((p0.toolT || p1.toolT) && p0.level === null && p1.level === null) {
      // Torso-space key on either end: blend the two arm-space orientations by slerp.
      const q0 = this.toolQuat(p0, tool0 ?? TOOL_REST, _q0);
      const q1 = this.toolQuat(p1, tool1 ?? TOOL_REST, _q1);
      toolQ = _qOut.slerpQuaternions(q0, q1, e);
    }
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
      reach: mix(p0.reach, p1.reach),
      hips: [mix(p0.hips[0], p1.hips[0]), mix(p0.hips[1], p1.hips[1])],
      stance: mix(p0.stance, p1.stance),
      tool: tool0 && tool1 ? [mix(tool0[0], tool1[0]), mix(tool0[1], tool1[1]), mix(tool0[2], tool1[2])] : null,
      level,
      toolQ,
    };
  }

  /** A key's held-tool orientation in arm space (side-mirrored), from `toolT` or `tool`. */
  private toolQuat(p: Pose, tool: [number, number, number], out: THREE.Quaternion): THREE.Quaternion {
    const sd = this.side;
    if (!p.toolT) return out.setFromEuler(_eArm.set(tool[0], tool[1] * sd, tool[2] * sd));
    const rz = sd > 0 ? p.aR[1] : REST.aR[1] - (p.aR[1] - REST.aR[1]);
    _qArm.setFromEuler(_eArm.set(p.aR[0], 0, rz)).invert();
    // Mirror the torso-space rotation across the body's YZ plane for a left-side wind-up.
    _qTip.setFromEuler(_eArm.set(p.toolT[0], p.toolT[1] * sd, p.toolT[2] * sd));
    return out.copy(_qArm).multiply(_qTip);
  }

  private pose(rig: PlayerRig, dt: number): ActionPose | null {
    const d = dt * this.timeScale;
    // Hat: ease to 85 % while an action runs, back to full size after (real time, so stills keep it).
    const want = this.cur || this.charging ? 0.85 : 1;
    this.hatK += (want - this.hatK) * (1 - Math.exp(-dt * 14));
    if (!this.cur && !this.charging && rig.hat) rig.hat.scale.setScalar(this.hatK);
    if (!this.cur && !this.charging && rig.hat && rig.hat.rotation.x !== HAT_TILT) rig.hat.rotation.x = HAT_TILT;
    if (!this.cur && !this.charging && (rig.hips.rotation.x !== 0 || rig.hips.rotation.y !== 0)) {
      rig.hips.rotation.x = 0;
      rig.hips.rotation.y = 0;
    }
    if (!this.cur && !this.charging && rig.armR.scale.y !== 1) {
      rig.armR.scale.set(1, 1, 1);
      rig.armL.scale.set(1, 1, 1);
    }
    if (this.charging) {
      const c = this.charging;
      c.t += d;
      // Raise the tool overhead, then hold with a building tremble.
      const up = 1 - Math.pow(1 - Math.min(1, c.t / 0.2), 3);
      const tremble = Math.sin(c.t * 55) * 0.03 * Math.min(1, c.t);
      // Held high beside the hat like the swing's wind-up (handle raked up and out, torso space),
      // so the trembling, glinting blade stays in view the whole time it charges.
      const p: Pose = { ...REST, aR: [-2.95 * up + tremble, -0.12 - 0.33 * up], aL: [-2.75 * up, 0.12 - 0.37 * up], torso: [-0.18 * up, -0.24 * up, -0.1 * up], head: -0.12 * up, sy: 1 - 0.05 * up + Math.sin(c.t * 40) * 0.006, bob: 0, grip: 0.24 * up, hips: [-0.1 * up, -0.14 * up], stance: 0.12 * up, tool: null, level: null, toolT: [-0.8, 0, 0.5] };
      const q0 = this.toolQuat({ ...p, toolT: null }, TOOL_REST, _q0);
      const q1 = this.toolQuat(p, TOOL_REST, _q1);
      p.toolQ = _qOut.slerpQuaternions(q0, q1, up);
      rig.tool.visible = true;
      const cp = this.apply(rig, p);
      this.twoHand(up, p.grip);
      return cp;
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
    const sp = this.sample(a);
    const pose = this.apply(rig, sp);
    this.aimTool(a, a.t);
    this.twoHand(this.twoHandWeight(a), sp.grip);
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
