/**
 * AnimalActor: a living farm animal — wanders its area, grazes / pecks, trots to the trough when
 * hungry, naps, lies down at night, and reacts to pets with a happy hop. Every pose is layered
 * procedurally on the rigid-skinned rig from animals-models.ts:
 *
 *   walk   diagonal trot (quadrupeds) / waddle + head-bob (birds), body bob, ear bounce
 *   eat    head dips to the ground, nibbling; birds peck in quick jabs
 *   idle   breathing, look-arounds, ear flicks, tail swish / wag, blinks
 *   sleep  body lowered, legs folded, head tucked, eyes shut, slow breathing (+ Zzz from the system)
 *   happy  squash-and-hop, wiggle, eyes squeezed shut
 *   sit    dog / cat sit (haunches down, front legs straight)
 *
 * The owning system sets `area`, `walkable`, `sleeping`, `feedSpot`, `hungry`, and calls
 * update(dt, t, neighbours) every frame.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildAnimal, buildCurl, type Species, type Gait, type AnimalModel } from './animals-models';
import { RIG_DETAIL } from './animals-rig';
import { heartSprite } from '../world/interiors/textures';
import { textures } from '../render/textures';

export type { Species } from './animals-models';

type State = 'idle' | 'walk' | 'eat' | 'sleep' | 'happy' | 'sit';
/** Wire codes for co-op pose sync (index = code). */
const STATES: readonly State[] = ['idle', 'walk', 'eat', 'sleep', 'happy', 'sit'];

interface Rest {
  bone: THREE.Bone;
  p: THREE.Vector3;
  q: THREE.Euler;
}

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

/** One built model per species × variant; actors clone it (shared geometry, own skeleton). */
const templates = new Map<string, AnimalModel>();
function instantiate(species: Species, variant: number): AnimalModel {
  const key = `${species}:${variant}`;
  let t = templates.get(key);
  if (!t) {
    t = buildAnimal(species, variant);
    templates.set(key, t);
  }
  const mesh = cloneSkinned(t.mesh) as THREE.SkinnedMesh;
  mesh.boundingSphere = t.mesh.boundingSphere?.clone() ?? null;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const bones: Record<string, THREE.Bone> = {};
  mesh.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
  });
  return { mesh, bones, gait: t.gait, species };
}

/** Far LOD templates: the same rig built at ~0.55 tessellation (same bones, same bone order). */
const loTemplates = new Map<string, AnimalModel>();
function loTemplate(species: Species, variant: number): AnimalModel {
  const key = `${species}:${variant}`;
  let t = loTemplates.get(key);
  if (!t) {
    RIG_DETAIL.k = 0.55;
    try {
      t = buildAnimal(species, variant);
    } finally {
      RIG_DETAIL.k = 1;
    }
    loTemplates.set(key, t);
  }
  return t;
}

const curlTemplates = new Map<string, { mesh: THREE.SkinnedMesh; radius: number }>();
let _curlAo: THREE.MeshBasicMaterial | null = null;
function curlAoMat(): THREE.MeshBasicMaterial {
  if (_curlAo) return _curlAo;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(20,10,6,0.62)');
  gr.addColorStop(0.55, 'rgba(20,10,6,0.42)');
  gr.addColorStop(1, 'rgba(20,10,6,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _curlAo = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  return _curlAo;
}

/** Personal space per species (m, world): capsules are padded to at least this radius when separating. */
const SPACE: Record<Species, number> = { chicken: 0.25, duck: 0.25, goat: 0.4, sheep: 0.42, cow: 0.46, pig: 0.44, dog: 0.3, cat: 0.25 };
/** r18: social spacing per species (m, body surface to body surface) — how far apart animals like to
 *  stand. Wander targets that would land closer than this to another animal (or to the spot another
 *  animal is already walking to) are rejected, and a crowded animal walks off instead of idling in a
 *  knot. Big stock keep more room than the flock birds; sheep bunch a little closer (a flock). */
const SOCIAL: Record<Species, number> = { chicken: 0.32, duck: 0.36, goat: 0.75, sheep: 0.6, cow: 1.05, pig: 0.85, dog: 0.6, cat: 0.55 };
/** Soft personal-space ring round each farmer (m, from the animal's body surface). */
const FARMER_SPACE = 0.7;
/** r18: the curious animals' semicircle round the farmer (angles in the XZ plane; -PI/2 = up-screen,
 *  so the visitors stand behind the farmer as seen from the lens, faces to the camera, none in front). */
const CURIOUS_SLOTS = [-Math.PI / 2, -Math.PI / 2 - 0.82, -Math.PI / 2 + 0.82, -Math.PI / 2 - 1.55, -Math.PI / 2 + 1.55];

/** Animals currently walking up to the farmer (curiosity is capped so the herd never mobs them). */
const curiousNow = new Set<AnimalActor>();
const MAX_CURIOUS = 3;

export class AnimalActor {
  readonly root = new THREE.Group();
  readonly species: Species;
  readonly gait: Gait;
  readonly mesh: THREE.SkinnedMesh;
  readonly pos = new THREE.Vector3();
  heading = 0;
  /** Wander rectangle (world). */
  area = { x0: 0, z0: 0, x1: 1, z1: 1 };
  walkable: (x: number, z: number) => boolean = () => true;
  heightAt: (x: number, z: number) => number = () => 0;
  sleeping = false;
  hungry = false;
  /** Where to eat when hungry (trough slot). */
  feedSpot: THREE.Vector3 | null = null;
  /** Face this way when eating at the feed spot. */
  feedHeading = 0;
  /** Grazing allowed anywhere (outdoors). */
  grazes = false;
  /** Sleep spot (nest / stall bedding): walked to at dusk. */
  bedSpot: THREE.Vector3 | null = null;
  /** Wool coverage (sheep: 1 full fleece, 0.7 freshly shorn). */
  wool = 1;
  /** Pet only: sit instead of idling. */
  sitter = false;
  /** Presentation scale (root). */
  scale = 1;
  /** Hard-clamp the position to `area` (stalls: never drift through a divider). */
  confine = false;
  /** Stall life: shuffle between the manger and the bedding instead of roaming. */
  stalled = false;
  /** Curious about the farmer: now and then walk over to a slot on a ring around them. */
  curious = false;
  /** Stable index (golden-angle slot on the ring around the farmer). */
  slotId = 0;
  /** Model review: just stand, breathe and look around. */
  calm = false;
  /** Grazers' wander pull point (pasture centre / hay rack); null = the area's middle. */
  lure: THREE.Vector3 | null = null;
  /** Staged behaviour (demos): keep cycling this pose in place ('eat' = grazing / rooting / munching). */
  hold: 'eat' | 'idle' | null = null;
  /** r15: lying down awake in the daytime (cud-chewing, eyes open, no Zzz) — the 'sleep' pose without
   *  the sleep. Livestock lie down now and then on their own; `restHold` keeps a staged rest. */
  resting = false;
  restHold = false;
  private restRemote = false;
  /** r16: how far the head dips to eat / drink (1 = graze the ground; a drinker at the trough stops at the
   *  water line instead of sinking its muzzle through the boards). */
  dipK = 1;
  /** Sit up on the roost bar (bedSpot, y > 0) by day too, awake. */
  perched = false;
  /** Where the farmer stands (set by the system each frame; animals step around them). */
  player: THREE.Vector3 | null = null;
  /** Other farmers on this map (co-op): same personal-space ring as the local farmer. */
  farmers: readonly THREE.Vector3[] = [];
  /** Solid props (world AABBs: feeders, troughs, hay racks): the body capsule is pushed out of them. */
  blockers: readonly { x0: number; z0: number; x1: number; z1: number }[] = [];
  /** Water to keep out of (world ellipses: the duck pond). The body capsule stays `margin` clear of the
   *  rim and wander targets never land in it — only ducks are left without one. */
  pools: readonly { x: number; z: number; rx: number; rz: number }[] = [];
  /** True when (x, z) is inside a pool (+ margin m, + this body's radius). */
  inPool(x: number, z: number, m = 0.4): boolean {
    const r = this.gait.radius * this.scale + m;
    return this.pools.some((p) => ((x - p.x) / (p.rx + r)) ** 2 + ((z - p.z) / (p.rz + r)) ** 2 < 1);
  }

  private b: Record<string, THREE.Bone>;
  private rest: Record<string, Rest> = {};
  private state: State = 'idle';
  private stateT = 0;
  private dur = 2;
  private target = new THREE.Vector3();
  private phase = Math.random() * 10;
  private walkW = 0;
  private eatW = 0;
  private sleepW = 0;
  private sitW = 0;
  private happyT = -1;
  /** Seconds left leaning into a petting hand (head tipped up + rolled into the hand, eyes shut). */
  blissT = 0;
  /** Which side the petting farmer is on in the animal's own frame (+1 = local -x, -1 = local +x). */
  blissSide = 1;
  private blissW = 0;
  private blinkT = 1 + Math.random() * 3;
  private look = 0;
  private lookTarget = 0;
  private earT = Math.random() * 5;
  private seed = Math.random() * 100;
  private speedK = 1;
  /** Walk-speed multiplier for errands (a herd trotting home out of the rain). */
  hurry = 1;
  private forced: { x: number; z: number; cb?: () => void; r?: number } | null = null;
  private stuck = 0;
  /** Turn towards this heading while standing (null = keep). */
  private faceTo: number | null = null;
  /** Height above the floor (roost bars): eased so a bird flutters up / down. */
  private lift = 0;
  private squashT = -1;
  private blinkHold = 0;
  /** Seconds until this animal may wander up to the farmer again. */
  private curiousCD = 5 + Math.random() * 15;
  /** Co-op mirror: the host's pose for this animal (null = own wander brain). */
  private remote: { x: number; z: number; h: number; s: State } | null = null;

  constructor(species: Species, variant = 0) {
    const m = instantiate(species, variant);
    this.species = species;
    this.gait = m.gait;
    this.mesh = m.mesh;
    this.b = m.bones;
    this.root.add(this.mesh);
    this.root.name = `animal:${species}`;
    for (const [k, bone] of Object.entries(this.b)) this.rest[k] = { bone, p: bone.position.clone(), q: bone.rotation.clone() };
    if (this.b.head) {
      this.headRest = new THREE.Vector3();
      for (let b: THREE.Object3D | null = this.b.head; b && (b as THREE.Bone).isBone; b = b.parent) this.headRest.add(b.position);
    }
    this.variant = variant;
    this.speedK = 0.85 + Math.random() * 0.3;
    this.dur = 0.5 + Math.random() * 2;
  }

  private readonly variant: number;
  private headRest: THREE.Vector3 | null = null;
  private lo: THREE.SkinnedMesh | null = null;
  private far = false;

  /**
   * Far LOD (outdoor herd from the high farm camera): swap to the low-tessellation mesh, skinned to this
   * actor's own skeleton (so every pose keeps working), and drop its shadow-pass cost to the same mesh.
   */
  /** r15: off the ground (perched on a roost bar, lifted onto a bed shelf) or afloat on the pond — no
   *  ground contact shadow. */
  get offGround(): boolean {
    return this.perched || this.lift > 0.05 || !this.mesh.castShadow;
  }

  /** Cast a sun shadow (off for a duck afloat: the pond shader draws its own contact shadow — saves a
   *  shadow draw per swimmer). */
  setCastShadow(on: boolean): void {
    if (this.mesh.castShadow === on) return;
    this.mesh.castShadow = on;
    if (this.lo) this.lo.castShadow = on && !this.small;
  }

  /** r18 (perf): birds and pets at far LOD skip the sun-shadow pass — a few pixels of shadow under a
   *  hen from the high pasture lens; the contact pool grounds them. -4 dynamic shadow draws a frame. */
  private get small(): boolean {
    return this.gait.radius < 0.2;
  }

  setFar(far: boolean): void {
    if (far === this.far) return;
    this.far = far;
    if (far && !this.lo) {
      const t = loTemplate(this.species, this.variant);
      const lo = new THREE.SkinnedMesh(t.mesh.geometry, t.mesh.material);
      lo.name = `${this.mesh.name}:lo`;
      lo.bind(this.mesh.skeleton, this.mesh.bindMatrix);
      lo.boundingSphere = this.mesh.boundingSphere?.clone() ?? null;
      lo.castShadow = this.mesh.castShadow && !this.small;
      lo.receiveShadow = true;
      this.root.add(lo);
      this.lo = lo;
    }
    this.mesh.visible = !far && !this.curled;
    if (this.lo) this.lo.visible = far && !this.curled;
  }

  place(x: number, z: number, heading = this.heading): void {
    this.pos.set(x, this.heightAt(x, z), z);
    this.heading = heading;
    this.root.position.copy(this.pos);
    this.root.rotation.y = heading;
    this.target.copy(this.pos);
    this.lift = (this.sleeping || this.perched) && this.bedSpot && this.bedSpot.y > 0 && Math.hypot(this.bedSpot.x - x, this.bedSpot.z - z) < 0.3 ? this.bedSpot.y : 0;
    this.root.position.y += this.lift;
    this.state = this.sleeping || this.restHold ? 'sleep' : 'idle';
    this.resting = this.restHold && !this.sleeping;
    this.stateT = 0;
  }

  setScale(s: number): void {
    this.scale = s;
    this.root.scale.setScalar(s);
  }

  /** r15: take up the held behaviour at once (staged stills: a rooting pig's head is already down). */
  snapHold(): void {
    if (!this.hold) return;
    this.setState(this.hold, 3 + Math.random() * 3);
    this.eatW = this.state === 'eat' ? 1 : 0;
  }

  /** r15: lie down awake and stay down (a staged rest: cud-chewing in the grass / straw). */
  lieDown(): void {
    this.restHold = true;
    this.hold = null;
    this.setState('sleep', 30);
    this.resting = true;
    this.sleepW = 1;
  }

  /** Snap straight into the current pose weights (after teleports / demo staging). */
  settle(): void {
    this.sleepW = this.sleeping || (this.resting && this.state === 'sleep') ? 1 : 0;
    this.sitW = 0;
    this.walkW = 0;
  }

  /** Walk somewhere specific (door, bowl) ignoring the wander brain; `cb` on arrival. */
  goTo(x: number, z: number, cb?: () => void, radius?: number): void {
    // (`radius`: arrive anywhere this close — a herd sent to one door jammed shoulder to shoulder short of
    // the exact spot and never went in)
    this.forced = { x, z, cb, r: radius };
    this.target.set(x, 0, z);
    this.setState('walk', 60);
  }

  get busy(): boolean {
    return !!this.forced;
  }

  /** Current behaviour as a small wire code (co-op pose sync; see `follow`). */
  get stateCode(): number {
    // (+8 = lying down awake: older clients read the low bits as 'sleep')
    return Math.max(0, STATES.indexOf(this.state)) + (this.resting && this.state === 'sleep' ? 8 : 0);
  }

  /**
   * Co-op clients: mirror the host's animal. Walks over to the host's position (snaps when far
   * off, e.g. after a map change), then holds the host's behaviour and heading. Cosmetic reactions
   * (petting hops) still play locally. `release()` hands the animal back to its own brain.
   */
  follow(x: number, z: number, heading: number, stateCode: number): void {
    const s = STATES[stateCode & 7] ?? 'idle';
    this.restRemote = (stateCode & 8) !== 0;
    this.sleeping = s === 'sleep' && !this.restRemote;
    if (Math.hypot(x - this.pos.x, z - this.pos.z) > 3) {
      this.place(x, z, heading);
      this.settle();
    }
    const r = this.remote;
    const moved = !r || Math.hypot(r.x - x, r.z - z) > 0.2 || r.s !== s;
    this.remote = { x, z, h: heading, s };
    if (moved && this.state !== 'happy' && !this.forced) this.think();
  }

  release(): void {
    this.remote = null;
  }

  /** Leaving the scene: drop out of the curious walkers. */
  forget(): void {
    curiousNow.delete(this);
  }

  /** Petted: happy hop + squash; with `from` (the farmer) it turns to look up at them. */
  pet(from?: THREE.Vector3): void {
    this.happyT = 0;
    this.squashT = 0;
    if (this.state !== 'sleep') this.setState('happy', 0.9);
    if (from && this.state !== 'sleep') {
      const want = Math.atan2(from.x - this.pos.x, from.z - this.pos.z);
      // Stall animals keep facing out over the manger (the farmer reaches in from the aisle).
      if (!this.stalled) this.faceTo = want;
    }
  }

  /** Glide (≈0.4 s) to a spot + heading without walking (petting: settle at arm's length). */
  easeTo(x: number, z: number, heading: number): void {
    this.ease = { x, z, h: heading, t: 0.45 };
    this.faceTo = heading;
  }

  private ease: { x: number; z: number; h: number; t: number } | null = null;

  /** Where the mouth / muzzle is (world XZ, at the gait reach in front of the root). */
  muzzle(out = new THREE.Vector3()): THREE.Vector3 {
    const r = this.gait.reach * this.scale;
    return out.set(this.pos.x + Math.sin(this.heading) * r, this.pos.y, this.pos.z + Math.cos(this.heading) * r);
  }

  /** Where a petting hand lands: the crown just behind the eyes (follows the head bone). */
  pollPoint(out = new THREE.Vector3()): THREE.Vector3 {
    const head = this.b.head;
    if (!head) return out.copy(this.pos).setY(this.pos.y + this.gait.top * this.scale * 0.8);
    const cr = this.gait.crown;
    if (cr) {
      // r13: the real crown surface (rest model space → the head bone's frame), a hand's thickness
      // above it — the stroking hand rests on the head instead of sinking into the face.
      if (!this.headRest) {
        this.headRest = new THREE.Vector3();
        for (let b: THREE.Object3D | null = head; b && (b as THREE.Bone).isBone; b = b.parent) this.headRest.add(b.position);
      }
      out.set(0, cr[0] + 0.035 - this.headRest.y, cr[1] - 0.02 - this.headRest.z);
      head.updateWorldMatrix(true, false);
      return head.localToWorld(out);
    }
    head.getWorldPosition(out);
    const k = this.gait.biped ? 0.06 : 0.16;
    out.y += k * this.scale;
    return out;
  }

  get isSleeping(): boolean {
    return this.sleepW > 0.5;
  }

  /** Big livestock lie down to rest in the day (birds and pets have their own idles). */
  private get liesDown(): boolean {
    return !this.gait.biped && this.species !== 'dog' && this.species !== 'cat' && !curiousNow.has(this);
  }

  get isEating(): boolean {
    return this.state === 'eat' && this.eatW > 0.6;
  }

  /** World-space point just above the head (heart pops, labels) — follows the head bone. */
  topPoint(out = new THREE.Vector3()): THREE.Vector3 {
    const head = this.b.head;
    if (head) {
      head.getWorldPosition(out);
      out.y = this.pos.y + this.lift + this.gait.top * this.scale * (1 - this.sleepW * 0.3);
      return out;
    }
    return out.copy(this.pos).setY(this.pos.y + this.lift + this.gait.top * this.scale * (1 - this.sleepW * 0.3));
  }

  /** r16: a point on top of the back, `t` along the body capsule (-1 rump … 0 middle … +1 shoulder) — where
   *  a petting hand strokes when the farmer stands beside the flank (follows the body bone's bob / breath). */
  backPoint(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const L = this.gait.len * this.scale * t;
    const body = this.b.body;
    let y = this.pos.y + this.lift + this.gait.top * this.scale * 0.55;
    if (body) {
      body.getWorldPosition(out);
      y = out.y + this.gait.radius * this.scale * (this.gait.biped ? 0.85 : 0.95);
    }
    return out.set(this.pos.x + Math.sin(this.heading) * L, y, this.pos.z + Math.cos(this.heading) * L);
  }

  /** Body capsule in world XZ: segment a→b (along the heading) with radius r. (r18: written into a
   *  per-actor scratch object — the n² separation pass allocated ~14 KB a frame.) */
  capsule(): { ax: number; az: number; bx: number; bz: number; r: number } {
    const h = this.gait.len * this.scale;
    const sx = Math.sin(this.heading) * h;
    const sz = Math.cos(this.heading) * h;
    const c = this._cap;
    c.ax = this.pos.x - sx;
    c.az = this.pos.z - sz;
    c.bx = this.pos.x + sx;
    c.bz = this.pos.z + sz;
    c.r = this.gait.radius * this.scale;
    return c;
  }
  private readonly _cap = { ax: 0, az: 0, bx: 0, bz: 0, r: 0 };
  /** The other animals on this map (last update's list). */
  private nbrs: readonly AnimalActor[] = [];
  /** Seconds the way ahead has been blocked by another body (gives up the target after a while). */
  private blockedT = 0;

  /** Rough footprint radius (body radius + part of the half-length): spacing checks between bodies. */
  get extent(): number {
    return (this.gait.radius + this.gait.len * 0.75) * this.scale;
  }

  /** Where this animal is headed (its walk target) or standing — a spot others should not pick. */
  private claim(out: { x: number; z: number }): { x: number; z: number } {
    if (this.state === 'walk') {
      out.x = this.target.x;
      out.z = this.target.z;
    } else {
      out.x = this.pos.x;
      out.z = this.pos.z;
    }
    return out;
  }

  /**
   * r18: true when (x, z) leaves social room to every other animal — both where they stand and where they
   * are walking to (reserved destinations: two cows never pick the same patch of grass).
   */
  private roomAt(x: number, z: number, k = 1): boolean {
    const me = this.extent;
    for (const o of this.nbrs) {
      if (o === this || !o.root.visible) continue;
      const gap = (me + o.extent + Math.max(SOCIAL[this.species], SOCIAL[o.species]) * k) ** 2;
      if ((o.pos.x - x) ** 2 + (o.pos.z - z) ** 2 < gap) return false;
      if (o.state === 'walk') {
        const c = o.claim(_claim);
        if ((c.x - x) ** 2 + (c.z - z) ** 2 < gap) return false;
      }
    }
    return true;
  }

  /** r18: the walk target is now taken by a standing / arriving animal and we are nearly there. */
  private destTaken(d: number): boolean {
    if (d > this.extent * 2 + 1.2) return false;
    const me = this.extent;
    for (const o of this.nbrs) {
      if (o === this || !o.root.visible) continue;
      const c = o.claim(_claim);
      const gap = me + o.extent + 0.12;
      if ((c.x - this.target.x) ** 2 + (c.z - this.target.z) ** 2 < gap * gap) return true;
    }
    return false;
  }

  private readonly _steer = { x: 0, z: 0, slow: 1 };
  /**
   * r18: local avoidance. Every body in a short cone ahead (radius-aware: its extent + ours + a margin)
   * pushes the walking direction sideways — away from the side it is on, harder the closer it is — and
   * slows the walk when it sits right across the path. Returns null when the way is clear.
   */
  private avoid(ux: number, uz: number, dist: number): { x: number; z: number; slow: number } | null {
    const me = this.extent;
    const look = me + 1.1;
    let side = 0;
    let slow = 1;
    let hit = false;
    for (const o of this.nbrs) {
      if (o === this || !o.root.visible) continue;
      const vx = o.pos.x - this.pos.x;
      const vz = o.pos.z - this.pos.z;
      const f = vx * ux + vz * uz;
      if (f <= 0 || f > look + o.extent || f > dist + o.extent) continue;
      const lat = vx * uz - vz * ux; // + = the other body lies on the -perp side (perp = (-uz, ux))
      const clear = me + o.extent + 0.18;
      if (Math.abs(lat) >= clear) continue;
      hit = true;
      const w = (1 - Math.abs(lat) / clear) * (1 - Math.max(0, f - me - o.extent) / look);
      side += (lat >= 0 ? 1 : -1) * w * 1.6;
      if (f < me + o.extent + 0.25) slow = Math.min(slow, Math.max(0.2, (f - me - o.extent) / 0.25));
    }
    if (!hit) {
      this.blockedT = Math.max(0, this.blockedT - 0.05);
      return null;
    }
    if (slow < 0.5) this.blockedT += 1 / 60;
    // perpendicular to the path (left = (-uz, ux) in this frame), added to the straight line
    const s = this._steer;
    s.x = ux + -uz * side;
    s.z = uz + ux * side;
    s.slow = this.forced ? Math.max(0.45, slow) : slow;
    return s;
  }

  /** The nearest other body inside this animal's social space (null = room to breathe). */
  private crowdedBy(): AnimalActor | null {
    let best: AnimalActor | null = null;
    let bd = Infinity;
    for (const o of this.nbrs) {
      if (o === this || !o.root.visible) continue;
      const d = Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z) - this.extent - o.extent;
      if (d < Math.max(SOCIAL[this.species], SOCIAL[o.species]) * 0.55 && d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  private setState(s: State, dur: number): void {
    curiousNow.delete(this);
    if (s !== 'sleep') this.resting = false;
    this.state = s;
    this.stateT = 0;
    this.dur = dur;
  }

  private pickTarget(away: AnimalActor | null = null): boolean {
    const a = this.area;
    // Grazers drift towards the middle of the pasture (and the hay rack / trough the system names in
    // `lure`): a herd strung out along the fence left the pen's centre empty.
    const cx = this.lure ? this.lure.x : (a.x0 + a.x1) / 2;
    const cz = this.lure ? this.lure.z : (a.z0 + a.z1) / 2;
    const pull = this.grazes && !away ? 0.35 : 0;
    // (r18: away from a crowding neighbour = a half-plane of headings pointing off it)
    const base = away ? Math.atan2(this.pos.z - away.pos.z, this.pos.x - away.pos.x) : 0;
    for (let i = 0; i < 14; i++) {
      const r = (away ? 1.0 : 0.8) + Math.random() * 2.6;
      const ang = away ? base + (Math.random() - 0.5) * 2.2 : Math.random() * Math.PI * 2;
      const x = THREE.MathUtils.clamp(THREE.MathUtils.lerp(this.pos.x + Math.cos(ang) * r, cx + (Math.random() - 0.5) * (a.x1 - a.x0) * 0.6, pull), a.x0, a.x1);
      const z = THREE.MathUtils.clamp(THREE.MathUtils.lerp(this.pos.z + Math.sin(ang) * r, cz + (Math.random() - 0.5) * (a.z1 - a.z0) * 0.6, pull), a.z0, a.z1);
      // (r18: later tries relax the social gap so a full pen still finds somewhere to go)
      if (this.walkable(x, z) && !this.inPool(x, z, 0.5) && Math.hypot(x - this.pos.x, z - this.pos.z) > 0.5 && this.roomAt(x, z, i < 10 ? 1 : 0.4)) {
        this.target.set(x, 0, z);
        return true;
      }
    }
    return false;
  }

  private think(): void {
    if (this.forced) {
      this.target.set(this.forced.x, 0, this.forced.z);
      this.setState('walk', 60);
      return;
    }
    if (this.remote) {
      const r = this.remote;
      if (Math.hypot(r.x - this.pos.x, r.z - this.pos.z) > 0.25) {
        this.target.set(r.x, 0, r.z);
        this.setState('walk', 30);
      } else {
        this.setState(r.s === 'walk' || r.s === 'happy' ? 'idle' : r.s, 30);
        if (r.s === 'sleep') this.resting = this.restRemote;
        this.faceTo = r.h;
      }
      return;
    }
    if (this.restHold && !this.sleeping && this.blissT <= 0) {
      this.setState('sleep', 30);
      this.resting = true;
      return;
    }
    // Being petted: hold still under the hand (no wander, no curious turn back to the farmer's face).
    if (this.blissT > 0) {
      this.setState('idle', this.blissT + 0.2);
      return;
    }
    if (this.sleeping) {
      this.resting = false;
      if (this.bedSpot && Math.hypot(this.bedSpot.x - this.pos.x, this.bedSpot.z - this.pos.z) > 0.35 && this.state !== 'walk') {
        this.target.copy(this.bedSpot);
        this.setState('walk', 12);
        return;
      }
      this.setState('sleep', 30);
      return;
    }
    if (this.hungry && this.feedSpot) {
      const d = Math.hypot(this.feedSpot.x - this.pos.x, this.feedSpot.z - this.pos.z);
      if (d > 0.3) {
        this.target.copy(this.feedSpot);
        this.setState('walk', 12);
      } else this.setState('eat', 4 + Math.random() * 3);
      return;
    }
    const r = Math.random();
    const birds = this.gait.biped;
    if (this.hold) {
      this.setState(this.hold, 2.5 + Math.random() * 3);
      if (this.hold === 'idle') this.lookTarget = (Math.random() - 0.5) * 0.9;
      return;
    }
    if (this.calm) {
      this.setState('idle', 2 + Math.random() * 3);
      this.lookTarget = (Math.random() - 0.5) * 0.9;
      return;
    }
    if (this.stalled) {
      // Stall life: mostly stand and chew, now and then amble between the manger and the bedding.
      if (r < 0.3) {
        const a = this.area;
        const front = Math.random() < 0.6;
        const x = THREE.MathUtils.lerp(a.x0, a.x1, 0.3 + Math.random() * 0.4);
        const z = front ? a.z1 - Math.random() * 0.25 : THREE.MathUtils.lerp(a.z0, a.z1, Math.random() * 0.45);
        this.target.set(x, 0, z);
        this.setState('walk', 8);
      } else if (r < 0.62) this.setState('eat', 3 + Math.random() * 4);
      else if (r < 0.7 && this.liesDown) {
        this.setState('sleep', 12 + Math.random() * 16);
        this.resting = true;
      } else this.setState('idle', 2 + Math.random() * 4);
      if (this.state === 'idle') this.lookTarget = (Math.random() - 0.5) * 1.2;
      return;
    }
    if (this.curious && this.blissT <= 0 && this.player && r < 0.22 && this.curiousCD <= 0 && curiousNow.size < MAX_CURIOUS) {
      const pd = Math.hypot(this.player.x - this.pos.x, this.player.z - this.pos.z);
      if (pd < 4.5) {
        // r18: a readable semicircle behind the farmer (as the lens sees it): fixed slots, the first one
        // with room wins, the radius scaled to the body so the muzzle stops a hand's reach off the farmer.
        const rad = Math.max((this.gait.len + this.gait.radius) * this.scale + FARMER_SPACE + 0.12, this.gait.reach * this.scale + 0.62);
        for (const ang of CURIOUS_SLOTS) {
          const x = THREE.MathUtils.clamp(this.player.x + Math.cos(ang) * rad, this.area.x0, this.area.x1);
          const z = THREE.MathUtils.clamp(this.player.z + Math.sin(ang) * rad, this.area.z0, this.area.z1);
          if (!this.walkable(x, z) || this.inPool(x, z, 0.3) || Math.hypot(x - this.pos.x, z - this.pos.z) < 0.4 || !this.roomAt(x, z, 0.35)) continue;
          this.target.set(x, 0, z);
          this.setState('walk', 8);
          // Only a couple wander up at a time, then lose interest for 20–40 s (no scrum round the farmer).
          curiousNow.add(this);
          this.curiousCD = 20 + Math.random() * 20;
          return;
        }
      }
    }
    // r18: hemmed in (another body inside the social space) → amble off rather than stand in a knot.
    const crowd = this.grazes || this.curious ? this.crowdedBy() : null;
    if (crowd && r < 0.85 && this.pickTarget(crowd)) {
      this.setState('walk', 8);
      return;
    }
    // Grazers spend most of the day head-down (≥ 40 % of the herd grazing at any moment): shorter
    // ambles, long mouthfuls.
    if (r < (this.grazes ? 0.3 : 0.42) && this.pickTarget()) this.setState('walk', 8);
    else if (r < (this.grazes || birds ? 0.8 : 0.55)) this.setState('eat', this.grazes ? 4 + Math.random() * 5 : 2.5 + Math.random() * 4);
    else if (this.sitter && r < 0.9) this.setState('sit', 4 + Math.random() * 6);
    else if (this.liesDown && r > 0.93) {
      // r15: livestock lie down in the grass for a while to chew the cud (eyes open, head up).
      this.setState('sleep', 14 + Math.random() * 18);
      this.resting = true;
    } else this.setState('idle', 1.5 + Math.random() * 3.5);
    if (this.state === 'idle' || this.state === 'sit') this.lookTarget = (Math.random() - 0.5) * 1.2;
  }

  update(dt: number, t: number, neighbours: readonly AnimalActor[]): void {
    this.stateT += dt;
    if (this.curiousCD > 0) this.curiousCD -= dt;
    // Night: wind down wherever we are (or at the bed spot once reached).
    if (this.sleeping && !this.forced && !this.remote && this.state !== 'sleep' && this.state !== 'walk') this.think();
    if (!this.sleeping && !this.resting && this.state === 'sleep') this.setState('idle', 0.6 + Math.random());
    if (this.stateT > this.dur && !(this.forced && this.state === 'walk')) this.think();

    // ── locomotion
    let moving = false;
    if (this.state === 'walk') {
      const dx = this.target.x - this.pos.x;
      const dz = this.target.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < Math.max(0.08, this.forced?.r ?? 0)) {
        if (this.forced) {
          const cb = this.forced.cb;
          this.forced = null;
          this.setState('idle', 0.5 + Math.random());
          cb?.();
        } else if (this.remote) this.think();
        else if (this.sleeping) this.setState('sleep', 30);
        else if (this.hungry && this.feedSpot && Math.hypot(this.feedSpot.x - this.pos.x, this.feedSpot.z - this.pos.z) < 0.35) {
          this.heading = this.feedHeading;
          this.setState('eat', 5 + Math.random() * 3);
        } else {
          this.setState(Math.random() < 0.5 ? 'idle' : 'eat', 1 + Math.random() * 2.5);
          // Stall animals face out over the manger; curious ones turn to look at the farmer.
          if (this.stalled) this.faceTo = this.sleeping ? null : 0;
          else if (this.curious && this.blissT <= 0 && this.player && Math.hypot(this.player.x - this.pos.x, this.player.z - this.pos.z) < 2.6) this.faceTo = Math.atan2(this.player.x - this.pos.x, this.player.z - this.pos.z);
        }
      } else if (!this.forced && !this.remote && !this.hungry && !this.sleeping && this.destTaken(d)) {
        // r18: occupied destination — someone stands (or is about to) where we were going: stop short.
        this.setState(Math.random() < 0.6 ? 'eat' : 'idle', 1 + Math.random() * 2);
      } else {
        // r18: local avoidance — steer round the bodies ahead instead of walking into them, slow down
        // behind one, and give the target up after ~1.4 s of being blocked.
        const steer = this.remote ? null : this.avoid(dx / d, dz / d, d);
        const want = steer ? Math.atan2(steer.x, steer.z) : Math.atan2(dx, dz);
        let dh = want - this.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        this.heading += dh * (1 - Math.exp(-6 * dt));
        const align = Math.max(0, Math.cos(dh));
        const spd = this.gait.speed * this.speedK * (this.forced ? this.hurry : 1) * align * Math.min(1, d * 2 + 0.3) * (this.sleeping ? 1.2 : 1) * (steer ? steer.slow : 1);
        const nx = this.pos.x + Math.sin(this.heading) * spd * dt;
        const nz = this.pos.z + Math.cos(this.heading) * spd * dt;
        if (this.walkable(nx, nz)) {
          this.pos.x = nx;
          this.pos.z = nz;
          moving = spd > 0.05;
        } else if (this.forced) {
          // Slide along whichever axis is free (doorways, fence gaps).
          if (this.walkable(nx, this.pos.z)) this.pos.x = nx;
          else if (this.walkable(this.pos.x, nz)) this.pos.z = nz;
          else this.stuck += dt;
          moving = true;
          if (this.stuck > 2) {
            this.stuck = 0;
            this.pos.x = this.forced.x;
            this.pos.z = this.forced.z;
          }
        } else {
          this.setState('idle', 0.8 + Math.random());
        }
        if (this.blockedT > 1.4 && !this.forced && this.state === 'walk') {
          this.blockedT = 0;
          this.setState('idle', 0.6 + Math.random());
        }
      }
    } else if (this.state === 'eat' && this.hungry && this.feedSpot) {
      let dh = this.feedHeading - this.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += dh * (1 - Math.exp(-4 * dt));
    } else if (this.faceTo != null && this.state !== 'sleep') {
      let dh = this.faceTo - this.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += dh * (1 - Math.exp(-3 * dt));
      if (Math.abs(dh) < 0.02) this.faceTo = null;
    }
    if (this.state === 'walk') this.faceTo = null;
    if (this.ease) {
      const e = this.ease;
      const k = 1 - Math.exp(-12 * dt);
      const nx = this.pos.x + (e.x - this.pos.x) * k;
      const nz = this.pos.z + (e.z - this.pos.z) * k;
      if (this.walkable(nx, nz)) {
        this.pos.x = nx;
        this.pos.z = nz;
      }
      e.t -= dt;
      if (e.t <= 0) this.ease = null;
    }
    // Separation: body capsules (long cows vs goats) padded to a per-species personal space, resolved
    // fully each step (each side takes half; a confined stall animal pushes the other the whole way),
    // plus a personal-space ring round every farmer on the map.
    this.nbrs = neighbours;
    const me = this.capsule();
    const myR = Math.max(me.r, SPACE[this.species]);
    // r18: the head too — a circle round the muzzle end is kept out of every other body (long faces
    // poking into a neighbour's flank read as two animals fused together).
    const hr = (this.gait.headR ?? 0) * this.scale;
    const hk = this.gait.reach * this.scale * 0.8;
    for (const o of neighbours) {
      if (o === this || hr <= 0 || this.state === 'sleep') continue;
      const oc = o.capsule();
      const hx = this.pos.x + Math.sin(this.heading) * hk;
      const hz = this.pos.z + Math.cos(this.heading) * hk;
      segPoint(oc.ax, oc.az, oc.bx, oc.bz, hx, hz, _cp);
      const ddx = hx - _cp.px;
      const ddz = hz - _cp.pz;
      const dd = Math.hypot(ddx, ddz);
      const mn = hr + oc.r + 0.04;
      if (dd >= mn || dd < 1e-4) continue;
      const push = (mn - dd) / dd;
      this.nudge(ddx * push * (o.confine && !this.confine ? 1 : 0.6), ddz * push * (o.confine && !this.confine ? 1 : 0.6), me);
    }
    for (const o of neighbours) {
      if (o === this) continue;
      const oc = o.capsule();
      segSeg(me.ax, me.az, me.bx, me.bz, oc.ax, oc.az, oc.bx, oc.bz, _cp);
      let dx = _cp.px - _cp.qx;
      let dz = _cp.pz - _cp.qz;
      let d = Math.hypot(dx, dz);
      const min = myR + Math.max(oc.r, SPACE[o.species]);
      if (d >= min) continue;
      if (d < 1e-4) {
        dx = Math.sin(this.seed * 7.1);
        dz = Math.cos(this.seed * 7.1);
        d = 1;
      }
      const push = ((min - d) / d) * (o.confine && !this.confine ? 1 : 0.5);
      this.nudge(dx * push, dz * push, me);
    }
    // Farmers: a soft 0.7 m ring (eased out over a few frames, so a petted animal settles beside the
    // farmer instead of bouncing), hard at 0.45 m.
    const ring = (fx: number, fz: number): void => {
      segPoint(me.ax, me.az, me.bx, me.bz, fx, fz, _cp);
      const dx = _cp.px - fx;
      const dz = _cp.pz - fz;
      const d = Math.hypot(dx, dz);
      // (r16: a petted animal stands at the farmer's hand, beside them — the full ring shoved it off)
      const soft = me.r + (this.blissT > 0 ? 0.32 : FARMER_SPACE);
      if (d >= soft || d < 1e-4) return;
      const hard = me.r + (this.blissT > 0 ? 0.26 : 0.45);
      const k = d < hard ? (hard - d) / d + Math.min(1, 10 * dt) * ((soft - hard) / d) : Math.min(1, 10 * dt) * ((soft - d) / d);
      this.nudge(dx * k, dz * k, me);
    };
    if (this.player) ring(this.player.x, this.player.z);
    for (const f of this.farmers) ring(f.x, f.z);
    // Props: push the body capsule (tail, middle, muzzle end) out of every blocker box along the
    // shallowest axis — no sheep sinking into the hay rack, no cow standing in the water trough.
    for (const bx of this.blockers) {
      for (let i = 0; i < 3; i++) {
        const k = i * 0.5;
        const px = me.ax + (me.bx - me.ax) * k;
        const pz = me.az + (me.bz - me.az) * k;
        const r = me.r * 0.9;
        const ox = Math.min(px - (bx.x0 - r), bx.x1 + r - px);
        const oz = Math.min(pz - (bx.z0 - r), bx.z1 + r - pz);
        if (ox <= 0 || oz <= 0) continue;
        if (ox < oz) this.nudge(px - (bx.x0 + bx.x1) / 2 < 0 ? -ox : ox, 0, me);
        else this.nudge(0, pz - (bx.z0 + bx.z1) / 2 < 0 ? -oz : oz, me);
      }
    }
    // Water: the capsule (tail, middle, muzzle) is pushed out radially past the rim + a margin
    // (no sheep with a hind leg in the duck pond).
    for (const pl of this.pools) {
      for (let i = 0; i < 3; i++) {
        const k = i * 0.5;
        const px = me.ax + (me.bx - me.ax) * k;
        const pz = me.az + (me.bz - me.az) * k;
        const ex = pl.rx + me.r * 0.9 + 0.3;
        const ez = pl.rz + me.r * 0.9 + 0.3;
        const dx = px - pl.x;
        const dz = pz - pl.z;
        const q = (dx / ex) ** 2 + (dz / ez) ** 2;
        if (q >= 1) continue;
        const f = q < 1e-6 ? 0 : 1 / Math.sqrt(q) - 1;
        this.nudge(q < 1e-6 ? 0 : dx * f, q < 1e-6 ? ez : dz * f, me);
      }
    }
    if (this.confine) {
      const a = this.area;
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, a.x0, a.x1);
      this.pos.z = THREE.MathUtils.clamp(this.pos.z, a.z0, a.z1);
    }
    // Roost bars: flutter up onto the perch once there (bedSpot.y), down again on waking.
    const perch = (this.sleeping || this.perched) && this.bedSpot && this.bedSpot.y > 0 && Math.hypot(this.bedSpot.x - this.pos.x, this.bedSpot.z - this.pos.z) < 0.3 ? this.bedSpot.y : 0;
    this.lift = damp(this.lift, perch, perch > this.lift ? 5 : 3, dt);
    this.pos.y = this.heightAt(this.pos.x, this.pos.z);
    this.root.position.copy(this.pos);
    this.root.position.y += this.lift;
    this.root.rotation.y = this.heading;

    // ── pose weights
    this.walkW = damp(this.walkW, moving ? 1 : 0, 8, dt);
    this.eatW = damp(this.eatW, this.state === 'eat' ? 1 : 0, 5, dt);
    this.sleepW = damp(this.sleepW, this.state === 'sleep' ? 1 : 0, 2.2, dt);
    this.sitW = damp(this.sitW, this.state === 'sit' ? 1 : 0, 4, dt);
    if (moving) this.phase += dt * this.gait.freq * Math.PI * 2 * this.speedK * (this.forced ? Math.sqrt(this.hurry) : 1);
    if (this.happyT >= 0) {
      this.happyT += dt;
      if (this.happyT > 1.0) this.happyT = -1;
    }
    this.blissT = Math.max(0, this.blissT - dt);
    this.blissW = damp(this.blissW, this.blissT > 0 && this.state !== 'sleep' ? 1 : 0, this.blissT > 0 ? 7 : 4, dt);
    this.animate(dt, t);
    this.updateCurl(t);
  }

  /** r16: pets curl up in their bed (a dedicated curled model, snapped to the cushion's centre). */
  curlAt: { x: number; z: number; y: number; h: number } | null = null;
  private curl: { mesh: THREE.SkinnedMesh; body: THREE.Bone | undefined; head: THREE.Bone | undefined; disc: THREE.Mesh } | null = null;
  get curled(): boolean {
    return !!this.curl?.mesh.visible;
  }
  private updateCurl(t: number): void {
    const c = this.curlAt;
    const on = !!c && (this.species === 'dog' || this.species === 'cat') && this.state === 'sleep' && !this.resting && this.sleepW > 0.35 && Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < 0.5;
    if (!on) {
      if (this.curl?.mesh.visible) {
        this.curl.mesh.visible = false;
        this.curl.disc.visible = false;
        this.mesh.visible = !this.far;
        if (this.lo) this.lo.visible = this.far;
      }
      return;
    }
    if (!this.curl) {
      const key = `${this.species}:${this.variant}`;
      let tpl = curlTemplates.get(key);
      if (!tpl) {
        const b = buildCurl(this.species as 'dog' | 'cat', this.variant);
        tpl = { mesh: b.mesh, radius: b.radius };
        curlTemplates.set(key, tpl);
      }
      const mesh = cloneSkinned(tpl.mesh) as THREE.SkinnedMesh;
      mesh.boundingSphere = tpl.mesh.boundingSphere?.clone() ?? null;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      let body: THREE.Bone | undefined;
      let head: THREE.Bone | undefined;
      mesh.traverse((o) => {
        if (o.name === 'body') body = o as THREE.Bone;
        if (o.name === 'head') head = o as THREE.Bone;
      });
      // Contact AO: a soft dark pool pressed into the cushion under the coil.
      const disc = new THREE.Mesh(new THREE.CircleGeometry(tpl.radius * 1.12, 28).rotateX(-Math.PI / 2), curlAoMat());
      disc.position.y = 0.004;
      disc.renderOrder = 1;
      this.root.add(mesh, disc);
      this.curl = { mesh, body, head, disc };
    }
    const k = this.curl;
    // Snap onto the bed (the brain's last few cm of walking / the separation nudge never leave it adrift).
    this.root.position.set(c!.x, this.heightAt(c!.x, c!.z) + c!.y, c!.z);
    this.root.rotation.y = c!.h;
    this.mesh.visible = false;
    if (this.lo) this.lo.visible = false;
    k.mesh.visible = true;
    k.disc.visible = true;
    // Slow, deep sleeping breaths (the flank rises; the head rides it), a dream-twitch of the ears now and then.
    const br = Math.sin(t * 1.5 + this.seed);
    k.body?.scale.set(1 + br * 0.012, 1 + br * 0.04, 1 + br * 0.012);
    if (k.head) k.head.rotation.z = Math.sin(t * 0.4 + this.seed) * 0.02;
  }

  /** Move by (dx, dz) where walkable (slides along a blocked axis); keeps the capsule in sync. */
  private nudge(dx: number, dz: number, me: { ax: number; az: number; bx: number; bz: number }): void {
    let nx = this.pos.x + dx;
    let nz = this.pos.z + dz;
    if (!this.walkable(nx, nz)) {
      if (this.walkable(nx, this.pos.z)) nz = this.pos.z;
      else if (this.walkable(this.pos.x, nz)) nx = this.pos.x;
      else return;
    }
    const mx = nx - this.pos.x;
    const mz = nz - this.pos.z;
    this.pos.x = nx;
    this.pos.z = nz;
    me.ax += mx;
    me.bx += mx;
    me.az += mz;
    me.bz += mz;
  }

  private restList: Rest[] | null = null;
  private reset(): void {
    // (r18: a cached list — Object.values() allocated a fresh array per animal per frame)
    const list = (this.restList ??= Object.values(this.rest));
    for (let i = 0; i < list.length; i++) {
      const r = list[i]!;
      r.bone.position.copy(r.p);
      r.bone.rotation.copy(r.q);
      r.bone.scale.set(1, 1, 1);
    }
  }

  private animate(dt: number, t: number): void {
    this.reset();
    const g = this.gait;
    const b = this.b;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const W = this.walkW;
    const E = this.eatW;
    const Z = this.sleepW;
    const S = this.sitW;
    const body = b.body!;
    const head = b.head!;

    // Breathing (slower + deeper asleep)
    const br = Math.sin(t * (Z > 0.5 ? 1.6 : 2.6) + this.seed);
    body.scale.set(1 + br * 0.012, 1 + br * 0.018, 1);
    // Walk bob / waddle
    body.position.y += Math.abs(s) * g.bob * W * 2 - g.bob * W;
    if (g.biped) {
      body.rotation.z += s * 0.12 * W;
      head.position.z += (Math.sin(this.phase * 2) * 0.03) * W; // chicken head-bob
      head.position.y += Math.abs(c) * 0.01 * W;
      b.legL!.rotation.x += s * g.legAmp * W;
      b.legR!.rotation.x -= s * g.legAmp * W;
    } else {
      body.rotation.x += Math.sin(this.phase * 2) * 0.025 * W;
      body.rotation.z += s * 0.025 * W;
      b.legFL!.rotation.x += s * g.legAmp * W;
      b.legBR!.rotation.x += s * g.legAmp * W;
      b.legFR!.rotation.x -= s * g.legAmp * W;
      b.legBL!.rotation.x -= s * g.legAmp * W;
      head.rotation.x += Math.sin(this.phase * 2) * 0.05 * W;
    }

    // Eat: head down + nibble (birds peck)
    if (E > 0.01) {
      const nib = g.biped ? Math.max(0, Math.sin(t * 9 + this.seed)) ** 6 * 0.5 : Math.sin(t * 7 + this.seed) * 0.06;
      // (r13: a stall animal eats from the raised manger — half the dip, so the muzzle shows over its lip
      // instead of folding the head into the chest)
      head.rotation.x += (g.eatPitch * (this.stalled && !g.biped ? 0.5 : this.dipK) + nib) * E;
      // Ducks dabble with a level body (a steep tip read as a toppled bird from the high camera).
      if (g.biped) body.rotation.x += (this.species === 'duck' ? 0.14 : 0.24) * E;
      else body.rotation.x += 0.06 * E;
    }

    // Stall life from the high camera: chin up over the manger so the face reads (not the poll + ears).
    if (this.stalled) head.rotation.x -= 0.28 * (1 - E) * (1 - Z);

    // Idle look-around
    if (Math.random() < dt * 0.25) this.lookTarget = (Math.random() - 0.5) * 1.1;
    this.look = damp(this.look, this.lookTarget * (1 - W) * (1 - E) * (1 - Z), 3, dt);
    head.rotation.y += this.look;
    head.rotation.z += Math.sin(t * 0.7 + this.seed) * 0.05 * (1 - W) * (1 - Z);

    // Ears: flick now and then, bounce while walking
    this.earT -= dt;
    let flick = 0;
    if (this.earT < 0) {
      flick = Math.max(0, 1 + this.earT * 6);
      if (this.earT < -0.3) this.earT = 2 + Math.random() * 5;
    }
    for (const [ear, sd] of [[b.earL, -1], [b.earR, 1]] as const) {
      if (!ear) continue;
      ear.rotation.z += sd * (flick * 0.5 * (sd > 0 ? 1 : 0.3) + Math.abs(s) * 0.12 * W - 0.25 * Z);
    }

    // Tail
    const tail = b.tail;
    if (tail) {
      if (this.species === 'dog') tail.rotation.y += Math.sin(t * (this.happyT >= 0 ? 22 : 9)) * (this.happyT >= 0 ? 0.5 : 0.22) * (1 - Z);
      else if (this.species === 'cat') tail.rotation.x += 0.2 * Math.sin(t * 1.3 + this.seed) - 0.6 * S + 0.8 * Z;
      else if (this.species === 'cow') {
        // Lazy swish + every few seconds a hard fly-swat flick, held a little off the rump so the
        // switch reads in silhouette from the high camera.
        const swat = Math.pow(Math.max(0, Math.sin(t * 0.8 + this.seed)), 10) * Math.sin(t * 16);
        tail.rotation.z += Math.sin(t * 1.9 + this.seed) * 0.25 + swat * 0.85;
        tail.rotation.x += 0.22 + Math.abs(swat) * 0.3;
      }
      else if (this.species === 'pig') tail.rotation.z += Math.sin(t * 5 + this.seed) * 0.3;
      else tail.rotation.x += Math.sin(t * 6 + this.seed) * 0.08;
    }

    // Wings: tucked; a flap when happy
    if (b.wingL && b.wingR) {
      const flap = this.happyT >= 0 ? Math.abs(Math.sin(this.happyT * 30)) * 0.9 * (1 - this.happyT) : 0;
      b.wingL.rotation.z -= flap + Math.abs(s) * 0.1 * W;
      b.wingR.rotation.z += flap + Math.abs(s) * 0.1 * W;
    }

    // Wool (sheep)
    if (b.wool) b.wool.scale.setScalar(0.62 + 0.38 * this.wool);

    // Sit (pets): haunches down, chest up
    if (S > 0.01 && !g.biped) {
      body.rotation.x -= 0.5 * S;
      body.position.y -= g.sleepDrop * 0.35 * S;
      body.position.z -= 0.04 * S;
      b.legBL!.scale.y = 1 - 0.55 * S;
      b.legBR!.scale.y = 1 - 0.55 * S;
      b.legBL!.rotation.x -= 0.9 * S;
      b.legBR!.rotation.x -= 0.9 * S;
      b.legFL!.rotation.x += 0.5 * S;
      b.legFR!.rotation.x += 0.5 * S;
      head.rotation.x += 0.35 * S;
    }

    // Sleep: lie down, fold legs, tuck head
    if (Z > 0.01) {
      body.position.y -= g.sleepDrop * Z;
      for (const k of g.biped ? ['legL', 'legR'] : ['legFL', 'legFR', 'legBL', 'legBR']) {
        const l = b[k]!;
        l.scale.y = THREE.MathUtils.lerp(l.scale.y, g.fold, Z);
        if (!g.biped) l.rotation.x += (k.startsWith('legF') ? -1.1 : 1.1) * Z;
      }
      if (this.resting && !g.biped) {
        // Lying awake: head up and level, a slow sideways cud-chew.
        head.rotation.x -= 0.12 * Z;
        head.rotation.z += Math.sin(t * 4.2 + this.seed) * 0.035 * Z;
        head.position.y -= g.sleepDrop * 0.12 * Z;
      } else {
        head.rotation.x += (g.biped ? 0.25 : 0.35) * Z;
        head.rotation.y += (g.biped ? 0.9 : 0.25) * Z;
        head.position.y -= (g.biped ? 0.03 : g.sleepDrop * 0.25) * Z;
      }
      if (g.biped) body.scale.multiplyScalar(1 + 0.06 * Z);
    }

    // Happy hop with squash & stretch
    if (this.happyT >= 0) {
      const h = this.happyT;
      const hop = Math.max(0, Math.sin(h * Math.PI * 2.2)) * (1 - h);
      const sq = Math.sin(h * Math.PI * 4.4) * (1 - h);
      body.position.y += hop * (g.biped ? 0.12 : 0.1);
      body.scale.y *= 1 + sq * 0.12;
      body.scale.x *= 1 - sq * 0.06;
      head.rotation.z += Math.sin(h * 18) * 0.15 * (1 - h);
      head.rotation.x -= 0.3 * (1 - h);
      // Nuzzle into the farmer's hand: the head squashes + pushes forward on each rub, stretches back.
      const rub = Math.sin(h * Math.PI * 6) * (1 - h);
      head.scale.set(1 + rub * 0.07, 1 - rub * 0.09, 1 + Math.max(0, rub) * 0.06);
      head.position.z += Math.max(0, rub) * 0.035;
    }

    // Petted (r11): the head tips up 30° and rolls into the farmer's hand, eyes shut, a slow rub —
    // never nose-to-nose with the farmer (the system stands the animal beside them, muzzle clear).
    const B = this.blissW;
    if (B > 0.01) {
      const rub = Math.sin(t * 5.5 + this.seed);
      // (r16: the farmer strokes the back from the flank — the head turns back over the shoulder towards
      // them, which (with the body turned 45° to the lens) brings the shut-eyed face square to the camera)
      head.rotation.x -= (g.biped ? 0.22 : 0.3) * B;
      head.rotation.z += this.blissSide * (0.14 + rub * 0.05) * B;
      head.rotation.y -= this.blissSide * (g.biped ? 0.45 : 0.28) * B;
      body.rotation.z += this.blissSide * 0.04 * B;
    }

    // Blink (eyes shut asleep or happy)
    // Blink: eyes squeeze to a line for ~90 ms every 2–5 s.
    this.blinkT -= dt;
    if (this.blinkT < 0) {
      this.blinkHold = 0.09;
      this.blinkT = 2 + Math.random() * 3;
    }
    this.blinkHold = Math.max(0, this.blinkHold - dt);
    const shut = Math.max(this.resting ? 0 : Z, this.happyT >= 0 ? 0.9 : 0, this.blissW * 0.95, this.blinkHold > 0 ? 1 : 0);
    // r19: joy (a pat, a treat) shuts the eyes into "∩" arcs instead of a squashed slit.
    const joy = this.state !== 'sleep' && Math.max(this.happyT >= 0 ? 1 : 0, this.blissW) > 0.5;
    if (b.lids) b.lids.scale.setScalar(joy ? 1 : 1e-3);
    if (b.eyes) {
      if (joy && b.lids) b.eyes.scale.setScalar(1e-3);
      else b.eyes.scale.set(1, Math.max(0.1, 1 - shut * 0.9), 1);
    }
    // Pet squash on the whole animal: 0.85 → 1.1 → 1 over 250 ms.
    if (this.squashT >= 0) {
      this.squashT += dt;
      const k = this.squashT / 0.25;
      const sy = k < 0.3 ? THREE.MathUtils.lerp(1, 0.85, k / 0.3) : k < 0.65 ? THREE.MathUtils.lerp(0.85, 1.1, (k - 0.3) / 0.35) : THREE.MathUtils.lerp(1.1, 1, Math.min(1, (k - 0.65) / 0.35));
      const sx = 1 + (1 - sy) * 0.5;
      this.root.scale.set(this.scale * sx, this.scale * sy, this.scale * sx);
      if (k >= 1) {
        this.squashT = -1;
        this.root.scale.setScalar(this.scale);
      }
    }
  }
}

// ───────────────────────────────────────────── capsule geometry

const _cp = { px: 0, pz: 0, qx: 0, qz: 0 };
const _claim = { x: 0, z: 0 };

/** Closest point on segment a→b to point p (written to out.px/pz; out.qx/qz = p). */
function segPoint(ax: number, az: number, bx: number, bz: number, px: number, pz: number, out: typeof _cp): void {
  const ux = bx - ax;
  const uz = bz - az;
  const l2 = ux * ux + uz * uz;
  const t = l2 > 1e-8 ? THREE.MathUtils.clamp(((px - ax) * ux + (pz - az) * uz) / l2, 0, 1) : 0;
  out.px = ax + ux * t;
  out.pz = az + uz * t;
  out.qx = px;
  out.qz = pz;
}

/** Closest points between segments p1→q1 and p2→q2 (2D). */
function segSeg(p1x: number, p1z: number, q1x: number, q1z: number, p2x: number, p2z: number, q2x: number, q2z: number, out: typeof _cp): void {
  const d1x = q1x - p1x;
  const d1z = q1z - p1z;
  const d2x = q2x - p2x;
  const d2z = q2z - p2z;
  const rx = p1x - p2x;
  const rz = p1z - p2z;
  const a = d1x * d1x + d1z * d1z;
  const e = d2x * d2x + d2z * d2z;
  const f = d2x * rx + d2z * rz;
  let s = 0;
  let t = 0;
  if (a <= 1e-8 && e <= 1e-8) {
    s = t = 0;
  } else if (a <= 1e-8) {
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1z * rz;
    if (e <= 1e-8) {
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1z * d2z;
      const den = a * e - b * b;
      s = den > 1e-8 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  out.px = p1x + d1x * s;
  out.pz = p1z + d1z * s;
  out.qx = p2x + d2x * t;
  out.qz = p2z + d2z * t;
}

// ───────────────────────────────────────────── feedback sprites

interface Pop {
  /** Transform proxy: a real mesh for name tags, otherwise one instance of its kind's batch. */
  sprite: THREE.Object3D;
  /** Opacity sink: the tag's own material, or the instance's opacity slot. */
  mat: { opacity: number };
  t: number;
  life: number;
  from: THREE.Vector3;
  kind: 'heart' | 'z' | 'note' | 'mini' | 'tag' | 'drop' | 'fluff';
  /** Seconds before it appears (bursts stagger their particles). */
  delay?: number;
  /** World size (drops / fluff). */
  size?: number;
  /** Follow this animal's head (from = offset from its top point). */
  actor?: AnimalActor;
  vel?: THREE.Vector3;
  /** Screen size as a fraction of the view height (heart / tag / mini hearts: constant on screen). */
  px?: number;
  /** Tag aspect (w / h). */
  aspect?: number;
  /** Tag side (+1 camera-right / -1 left), fixed when it appears. */
  side?: number;
  /** Tag text key (name|hearts): a repeat pop with the same text keeps the live card. */
  tagKey?: string;
  /** Heart: its sideways slide off the farmer's face this frame (world units along camera-right). */
  shift?: number;
}

let zTex: THREE.Texture | null = null;
function zzzTexture(): THREE.Texture {
  if (zTex) return zTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 50px Fredoka, Nunito, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = '#2a3a6a';
  g.strokeText('z', 32, 34);
  g.fillStyle = '#e8f0ff';
  g.fillText('z', 32, 34);
  zTex = new THREE.CanvasTexture(c);
  zTex.colorSpace = THREE.SRGBColorSpace;
  return zTex;
}

/** Name + heart-meter tag (parchment pill, e.g. "Clover ♥♥♥♡♡"), cached per name × hearts. */
const tagTex = new Map<string, { tex: THREE.Texture; aspect: number }>();
function nameTag(name: string, hearts: number): { tex: THREE.Texture; aspect: number } {
  const key = `${name}:${hearts}`;
  let t = tagTex.get(key);
  if (t) return t;
  const H = 96;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = '700 40px Fredoka, Nunito, sans-serif';
  g.font = font;
  const tw = Math.ceil(g.measureText(name).width);
  const hw = 5 * 26;
  const W = Math.max(200, tw + hw + 64);
  c.width = W;
  c.height = H;
  const r = 30;
  const pill = (x: number, y: number, w: number, h: number): void => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  // Soft drop shadow, wood rim, parchment fill
  g.fillStyle = 'rgba(40,20,6,0.35)';
  pill(6, 12, W - 12, H - 16);
  g.fill();
  g.fillStyle = '#8a5528';
  pill(4, 4, W - 8, H - 16);
  g.fill();
  const grad = g.createLinearGradient(0, 10, 0, H - 18);
  grad.addColorStop(0, '#fff6de');
  grad.addColorStop(1, '#f1dcad');
  g.fillStyle = grad;
  pill(10, 10, W - 20, H - 28);
  g.fill();
  g.font = font;
  g.textBaseline = 'middle';
  g.fillStyle = '#4a2c14';
  g.fillText(name, 30, H / 2 - 5);
  // Heart meter: filled / half / empty hearts
  const heart = (x: number, y: number, s: number, fill: string, stroke: string): void => {
    g.beginPath();
    g.moveTo(x, y + s * 0.35);
    g.bezierCurveTo(x - s * 0.55, y - s * 0.05, x - s * 0.5, y - s * 0.55, x, y - s * 0.25);
    g.bezierCurveTo(x + s * 0.5, y - s * 0.55, x + s * 0.55, y - s * 0.05, x, y + s * 0.35);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = 3.5;
    g.strokeStyle = stroke;
    g.stroke();
  };
  for (let i = 0; i < 5; i++) {
    const on = hearts >= i + 1 ? 1 : hearts >= i + 0.5 ? 0.5 : 0;
    const x = W - 22 - hw + i * 26 + 13;
    heart(x, H / 2 - 3, 26, on ? '#e8385a' : '#e6d2b0', on ? '#7a1830' : '#b89a70');
    if (on === 0.5) {
      g.save();
      g.beginPath();
      g.rect(x, 0, 20, H);
      g.clip();
      heart(x, H / 2 - 3, 26, '#e6d2b0', '#b89a70');
      g.restore();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  t = { tex, aspect: W / H };
  tagTex.set(key, t);
  return t;
}

const _top = new THREE.Vector3();
const _cp2 = new THREE.Vector3();
const _right = new THREE.Vector3(1, 0, 0);
const _toCam = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _upv = new THREE.Vector3();
const easeOutBack = (x: number): number => {
  const c1 = 1.9;
  return 1 + (c1 + 1) * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/** Heart pops (petting), sleepy Zzz and sparkle puffs above animals. One small sprite pool. */
export class AnimalPops {
  readonly group = new THREE.Group();
  private pops: Pop[] = [];
  // Camera-facing quads (not THREE.Sprite: the AO G-buffer pass only skips flagged meshes).
  private heartMat = new THREE.MeshBasicMaterial({ map: heartSprite().map, transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
  private zMat = new THREE.MeshBasicMaterial({ map: zzzTexture(), transparent: true, depthWrite: false, fog: false, opacity: 0.85 });
  private sparkMat = new THREE.MeshBasicMaterial({ map: textures.softDot().map, color: 0xfff2b0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  private dropMat = new THREE.MeshBasicMaterial({ map: textures.softDot().map, color: 0xffffff, transparent: true, depthWrite: false, fog: false });
  private fluffMat = new THREE.MeshBasicMaterial({ map: textures.softDot().map, color: 0xfff8ec, transparent: true, depthWrite: false, fog: false });
  private quad = new THREE.PlaneGeometry(1, 1);
  /**
   * One instanced quad batch per pop kind (pillar 14): a petting burst used to be ~11 meshes with
   * a cloned material each (11 draws + 11 material allocations); now every live pop of a kind is
   * one instance of its batch (per-instance opacity), so all pops cost ≤ 6 draws. Name tags keep
   * their own mesh (each has its own canvas texture).
   */
  private batches = new Map<Pop['kind'], PopBatch>();

  constructor() {
    this.group.name = 'animal-pops';
    this.group.userData.noAO = true;
    this.group.userData.indoors = true;
    this.group.renderOrder = 20;
    const add = (kind: Pop['kind'], m: THREE.MeshBasicMaterial, order: number): void => {
      const b = new PopBatch(m, order);
      this.batches.set(kind, b);
      this.group.add(b.mesh);
    };
    add('mini', this.heartMat, 20);
    add('note', this.sparkMat, 20);
    add('z', this.zMat, 20);
    add('drop', this.dropMat, 20);
    add('fluff', this.fluffMat, 20);
    add('heart', this.heartMat, 22);
  }

  /** The farmer (tags sit on the side of the animal away from them, the heart is nudged off them). */
  farmer: THREE.Vector3 | null = null;

  /** Prop bounds (world) a name card should not sit over: the card flips sides when its screen rect
   *  lands on one and the other side is clearer (r10: the coop card sat on the water fount). */
  avoid: THREE.Box3[] = [];

  /** Screen-space (NDC) overlap area of a card rect with the projected `avoid` boxes. */
  private propOverlap(cam: THREE.Camera, cx: number, cy: number, hw: number, hh: number): number {
    let sum = 0;
    for (const b of this.avoid) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        _cp2.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(cam);
        x0 = Math.min(x0, _cp2.x);
        x1 = Math.max(x1, _cp2.x);
        y0 = Math.min(y0, _cp2.y);
        y1 = Math.max(y1, _cp2.y);
      }
      const ox = Math.min(x1, cx + hw) - Math.max(x0, cx - hw);
      const oy = Math.min(y1, cy + hh) - Math.max(y0, cy - hh);
      if (ox > 0 && oy > 0) sum += ox * oy;
    }
    return sum;
  }

  /**
   * Heart pop: one crisp heart (~72 px at 1080p) 0.35 m over the animal's head, nudged towards the
   * camera so it never sits on the farmer: springs 0 → 1.25 → 1 in 220 ms, holds at full strength,
   * then shrinks away fast (no long translucent fade). A burst of mini hearts + sparkles, and (with
   * `tag`) the name + heart meter on the side away from the farmer. With `actor` it all rides on the
   * animal's head as it moves.
   */
  /** Heart pops ever spawned (monotonic — the co-op matrix checks a remote pat landed without racing
   *  the pop's 1.5 s life on a loaded machine). */
  popped = 0;

  heart(at: THREE.Vector3, actor?: AnimalActor, tag?: { name: string; hearts: number }): void {
    this.popped++;
    // (r10: hugs the head it belongs to — 0.2 m up it drifted between the petted animal and its neighbour)
    const h = this.spawn('heart', actor ? new THREE.Vector3(0, 0.06, 0) : at.clone().setY(at.y + 0.06), null, 1.55);
    h.actor = actor;
    // (r18: 72 → 52 px — the big heart covered the farmer, the pond and the stall dressing)
    h.px = HEART_PX;
    const n = 3 + Math.floor(Math.random() * 3);
    // (r10: the little hearts fan out on the side away from the farmer — bursting both ways, half of
    // them landed on the farmer's cheek and read as the farmer's hearts)
    const base0 = actor ? actor.pos : at;
    const away = this.farmer ? Math.atan2(base0.z - this.farmer.z, base0.x - this.farmer.x) : 0;
    for (let i = 0; i < n; i++) {
      const a = this.farmer ? away + ((i + 0.5) / n - 0.5) * Math.PI * 1.1 + (Math.random() - 0.5) * 0.3 : (i / n) * Math.PI * 2 + Math.random() * 0.8;
      const off = new THREE.Vector3(Math.cos(a) * 0.12, 0.28, Math.sin(a) * 0.12);
      const p = this.spawn('mini', actor ? off : at.clone().add(off), null, 0.75 + Math.random() * 0.3);
      p.actor = actor;
      p.px = (17 + Math.random() * 6) / 1080;
      p.vel = new THREE.Vector3(Math.cos(a) * 1.1, 1.0 + Math.random() * 0.5, Math.sin(a) * 0.7);
    }
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      const off = new THREE.Vector3(Math.cos(a) * 0.1, 0.2 + Math.random() * 0.15, Math.sin(a) * 0.1);
      const p = this.spawn('note', actor ? off : at.clone().add(off), null, 0.5 + Math.random() * 0.35);
      p.actor = actor;
      p.vel = new THREE.Vector3(Math.cos(a) * 0.7, 0.8 + Math.random() * 0.5, Math.sin(a) * 0.7);
      p.sprite.scale.setScalar(0.1 + Math.random() * 0.06);
    }
    // (r10: a repeat pat while the animal's card is still up keeps that card — a fresh card popping in
    // over the fading one showed two overlapping name cards)
    const live = tag && actor ? this.pops.find((q) => q.kind === 'tag' && q.actor === actor && q.t < q.life - 0.35 && q.tagKey === `${tag.name}|${tag.hearts}`) : undefined;
    if (live) live.t = Math.min(live.t, 0.2);
    else if (tag) {
      for (const q of this.pops) if (q.kind === 'tag' && q.actor === actor) q.t = Math.max(q.t, q.life - 0.12);
      const nt = nameTag(tag.name, tag.hearts);
      const m = new THREE.MeshBasicMaterial({ map: nt.tex, transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
      // (r12: a smaller, shorter-lived card — in the wide pasture shot it competed with the herd's
      // silhouettes; it reads as a quick tag on the pat, not a sign)
      const p = this.spawn('tag', actor ? new THREE.Vector3(0, 0, 0) : at.clone(), m, 1.45);
      p.actor = actor;
      p.px = 36 / 1080;
      p.aspect = nt.aspect;
      p.tagKey = `${tag.name}|${tag.hearts}`;
    }
  }

  /**
   * Milking squirts (white droplets arcing into the pail) or shearing fluff (soft wool tufts puffing
   * off the fleece), at `at` (world).
   */
  burst(at: THREE.Vector3, kind: 'milk' | 'wool'): void {
    const n = kind === 'milk' ? 14 : 12;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const p = this.spawn(kind === 'milk' ? 'drop' : 'fluff', at.clone(), null, kind === 'milk' ? 0.45 + Math.random() * 0.35 : 0.9 + Math.random() * 0.5);
      p.delay = (i / n) * (kind === 'milk' ? 0.55 : 0.4);
      p.vel = kind === 'milk' ? new THREE.Vector3(Math.cos(a) * 0.25, -0.2 - Math.random() * 0.6, Math.sin(a) * 0.25) : new THREE.Vector3(Math.cos(a) * 0.9, 0.5 + Math.random() * 0.7, Math.sin(a) * 0.9);
      p.sprite.visible = false;
      p.size = kind === 'milk' ? 0.05 + Math.random() * 0.03 : 0.12 + Math.random() * 0.08;
    }
  }

  /** World positions of the live heart pops (hat fade test). */
  hearts(out: THREE.Vector3[] = []): THREE.Vector3[] {
    out.length = 0;
    for (const p of this.pops) if (p.kind === 'heart' || p.kind === 'tag') out.push(p.sprite.position);
    return out;
  }

  /** Drop every live pop (map changes / demo staging). */
  clear(): void {
    for (const p of this.pops) this.drop(p);
    this.pops.length = 0;
    for (const b of this.batches.values()) b.flush(0);
  }

  /** Release a pop (a tag's mesh + material; batched pops just stop being written). */
  private drop(p: Pop): void {
    if (p.kind !== 'tag') return;
    this.group.remove(p.sprite);
    (p.mat as THREE.Material).dispose();
  }

  z(at: THREE.Vector3): void {
    this.spawn('z', at, null, 2.4);
  }

  private spawn(kind: Pop['kind'], at: THREE.Vector3, m: THREE.MeshBasicMaterial | null, life: number): Pop {
    let sprite: THREE.Object3D;
    let mat: { opacity: number };
    if (m) {
      const mesh = new THREE.Mesh(this.quad, m);
      mesh.userData.noAO = true;
      mesh.castShadow = false;
      mesh.renderOrder = 21;
      this.group.add(mesh);
      sprite = mesh;
      mat = m;
    } else {
      // Batched: a bare transform the batch reads back each frame (never added to the scene).
      sprite = new THREE.Object3D();
      mat = { opacity: kind === 'z' ? 0.85 : 1 };
    }
    sprite.position.copy(at);
    sprite.scale.setScalar(0.01);
    const p: Pop = { sprite, mat, t: 0, life, from: at.clone(), kind };
    this.pops.push(p);
    return p;
  }

  update(dt: number, camera?: THREE.Camera): void {
    const cam = camera as THREE.PerspectiveCamera | undefined;
    const tanF = cam?.isPerspectiveCamera ? Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) : 0.32;
    // World height of the whole view at view depth d = 2·d·tan(fov/2): a sprite sized `px` of it stays
    // constant on screen. (View depth, not distance: by distance a tag near the screen edge grew ~1.3x.)
    if (cam) _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const screenK = (p: THREE.Vector3): number => (cam ? 2 * Math.max(0.5, _toCam.copy(p).sub(cam.position).dot(_fwd)) * tanF : 20);
    // One size step for every tag in the frame (from the farmer's depth), not per animal.
    const refK = this.farmer && cam ? screenK(this.farmer) : 0;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i]!;
      p.t += dt;
      // Anchored pops ride on the animal's head.
      const base = p.actor ? p.actor.topPoint(_top) : null;
      const k = p.t / p.life;
      const m = p.mat;
      if (camera) p.sprite.quaternion.copy(camera.quaternion);
      if (k >= 1) {
        this.drop(p);
        this.pops.splice(i, 1);
        continue;
      }
      if (p.delay != null && p.delay > 0) {
        p.delay -= dt;
        p.t = 0;
        continue;
      }
      if (p.kind === 'heart') {
        // 0 → 1.25 → 1 over 220 ms (ease-out, then settle), eases up 0.3 m, holds crisp, shrinks away
        // in the last 0.28 s. Nudged 0.3 m towards the camera so it floats in front of the farmer.
        const o = base ? _cp2.copy(base).add(p.from) : _cp2.copy(p.from);
        if (cam) o.addScaledVector(_toCam.copy(cam.position).sub(o).normalize(), 0.3);
        const pt = p.t;
        // (r11: springs from 0.55, not 0 — a co-op farmhand's own pat showed nothing in the first frames)
        const pop = pt < 0.13 ? 0.55 + 0.7 * (1 - Math.pow(1 - pt / 0.13, 3)) : pt < 0.22 ? 1.25 - 0.25 * Math.sin(((pt - 0.13) / 0.09) * Math.PI * 0.5) : 1;
        const out = Math.max(0, (pt - (p.life - 0.28)) / 0.28);
        const rise = 0.14 * (1 - Math.pow(1 - Math.min(1, pt / 0.7), 3));
        const size = Math.max(0.01, (p.px ?? 0.06) * screenK(o) * 1.18);
        // Slide off the farmer's side on screen (the heart belongs over the animal, never on a face).
        if (this.farmer && camera) {
          _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
          const fx = (this.farmer.x - o.x) * _right.x + (this.farmer.z - o.z) * _right.z;
          // (r15: a pat's repeat heart keeps the live one's side — two hearts slid to opposite sides of the
          // farmer's face when the trickle overlapped)
          if (p.side == null) p.side = this.pops.find((q) => q !== p && q.kind === 'heart' && q.actor === p.actor && q.side != null && q.t < q.life)?.side ?? (Math.abs(fx) < 0.08 ? 0 : fx > 0 ? -1 : 1);
          // (only as far as needed: the heart stays over the head it belongs to)
          o.addScaledVector(_right, p.side * size * 0.3);
          // r14: never over the farmer's face — with the animal stood across the farmer's front the
          // heart rose straight onto it. In the camera plane, slide it sideways (towards the animal's
          // side) until it clears the farmer's head disc.
          _upv.set(0, 1, 0).applyQuaternion(camera.quaternion);
          const hx = o.x - this.farmer.x;
          const hz = o.z - this.farmer.z;
          const sx = hx * _right.x + hz * _right.z;
          // (r15: the face is anywhere from a crouched pat (~1.05 m) to standing (~1.5 m) — checked against
          // that whole span; at 1.45 only, the heart sat on a crouching farmer's face in the wide pasture lens)
          const syAt = (hh: number): number => hx * _upv.x + (o.y + size * 0.42 - (this.farmer!.y + hh)) * _upv.y + hz * _upv.z;
          const sA = syAt(1.05);
          const sB = syAt(1.5);
          const sy = sA * sB <= 0 ? 0 : Math.abs(sA) < Math.abs(sB) ? sA : sB;
          // (r15: + the crouch's forward lean — the face sits ahead of the root; 0.42 left a lobe on the face)
          const R = 0.56 + size * 0.55;
          if (Math.abs(sy) < R && Math.abs(sx) < R) {
            const dir = p.side !== 0 ? p.side : sx >= 0 ? 1 : -1;
            p.side = dir;
            const want = dir * Math.sqrt(Math.max(0, R * R - sy * sy));
            p.shift = Math.abs(sx) < Math.abs(want) ? want - sx : 0;
            o.addScaledVector(_right, p.shift);
          } else p.shift = 0;
        }
        p.sprite.position.set(o.x + Math.sin(pt * 5) * 0.03, o.y + size * 0.42 + rise, o.z);
        p.sprite.scale.setScalar(Math.max(0.01, size * pop * (1 - out * out)));
        m.opacity = 1 - out * 0.35;
      } else if (p.kind === 'tag') {
        // Name + heart meter beside the heart, on the side away from the farmer (screen space): springs
        // in, holds, fades. Side by side keeps the pair tight over the animal (no tall tower).
        const o = base ?? p.from;
        const pop = p.t < 0.16 ? 0.5 + 0.5 * easeOutBack(p.t / 0.16) : 1;
        const sk = screenK(o);
        // Constant on screen, a touch larger from far cameras (≥ 18 px text at 1080p everywhere).
        const h = (p.px ?? 0.04) * sk * THREE.MathUtils.clamp(1 + ((refK || sk) - 7) * 0.03, 1, 1.15) * pop;
        const heart = HEART_PX * sk * 1.18;
        const w = h * (p.aspect ?? 3);
        if (camera) _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
        let dir = 1;
        if (this.farmer) {
          const fx = (this.farmer.x - o.x) * _right.x + (this.farmer.z - o.z) * _right.z;
          dir = fx > 0.05 ? -1 : 1;
        }
        if (p.side == null) p.side = dir;
        // Safe area: a card that would cross the screen edge flips to the animal's other side.
        if (cam && p.t < 0.05) {
          const off = heart * 0.95 + w * 0.5;
          const yy = o.y + 0.2 + heart * 0.42;
          const half = w / (sk * cam.aspect);
          const hh = h / sk;
          const at = (sd: number): THREE.Vector3 => _cp2.set(o.x + _right.x * off * sd, yy, o.z + _right.z * off * sd).project(cam);
          const ndc = at(p.side);
          const nx = ndc.x;
          const ny = ndc.y;
          if (Math.abs(nx) + half > 0.9 && Math.sign(nx) === p.side) p.side = -p.side;
          // (r12: a prop never pushes the card over to the farmer's side — in the coop it flipped off the
          // water fount onto the farmer's hat and face)
          else if (this.avoid.length && (!this.farmer || p.side !== dir)) {
            // Prop check: flip when this side covers a prop and the other side is clearer + on screen.
            const here = this.propOverlap(cam, nx, ny, half, hh);
            if (here > 0) {
              const o2 = at(-p.side);
              const ox = o2.x;
              const oy = o2.y;
              if (Math.abs(ox) + half <= 0.9 && this.propOverlap(cam, ox, oy, half, hh) < here * 0.5) p.side = -p.side;
            }
          }
        }
        // (r14: the card moves along with a heart slid off the farmer's face on its side — they overlapped)
        const hp = p.actor ? this.pops.find((q) => q.kind === 'heart' && q.actor === p.actor) : undefined;
        const hs = hp?.shift && Math.sign(hp.shift) === p.side ? hp.shift : 0;
        const side = p.side * (heart * 0.95 + w * 0.5) + hs;
        p.sprite.position.set(o.x + _right.x * side, o.y + 0.2 + heart * 0.42 + Math.min(0.06, p.t * 0.2), o.z + _right.z * side);
        p.sprite.scale.set(w, h, 1);
        m.opacity = 0.94 * (p.t > p.life - 0.35 ? Math.max(0, (p.life - p.t) / 0.35) : 1);
      } else if (p.kind === 'drop' || p.kind === 'fluff') {
        p.sprite.visible = true;
        if (p.vel) {
          p.from.addScaledVector(p.vel, dt);
          if (p.kind === 'drop') p.vel.y -= dt * 5.5;
          else {
            p.vel.multiplyScalar(Math.exp(-2.5 * dt));
            p.vel.y -= dt * 0.35;
          }
        }
        p.sprite.position.copy(p.from);
        const s0 = p.size ?? 0.08;
        p.sprite.scale.set(s0 * (p.kind === 'drop' ? 0.7 : 1), s0 * (p.kind === 'drop' ? 1.2 : 1), 1);
        m.opacity = p.kind === 'drop' ? 0.95 * (1 - k * k) : Math.min(1, k * 6) * (1 - k);
      } else if (p.kind === 'z') {
        p.sprite.scale.setScalar(0.12 + k * 0.18);
        p.sprite.position.set(p.from.x + Math.sin(k * 5) * 0.12 + k * 0.2, p.from.y + k * 0.6, p.from.z);
        m.opacity = Math.sin(k * Math.PI) * 0.9;
      } else {
        // Mini hearts + sparkles burst outward and up from the head, slowing as they fade.
        if (p.vel) {
          p.from.addScaledVector(p.vel, dt);
          p.vel.multiplyScalar(Math.exp(-3.2 * dt));
          p.vel.y -= dt * 0.6;
        } else p.from.y += dt * 0.6;
        if (base) p.sprite.position.copy(base).add(p.from);
        else p.sprite.position.copy(p.from);
        if (p.kind === 'mini' && camera && p.actor) {
          // r15: the burst follows its big heart off the farmer's face (it rose from the head beside the
          // farmer's and the little hearts dotted the farmer's cheeks).
          const hp = this.pops.find((q) => q.kind === 'heart' && q.actor === p.actor);
          if (hp?.shift) p.sprite.position.addScaledVector(_right.set(1, 0, 0).applyQuaternion(camera.quaternion), hp.shift * 0.85);
        }
        if (p.kind === 'mini') {
          const pop = p.t < 0.12 ? easeOutBack(p.t / 0.12) : 1;
          p.sprite.scale.setScalar(Math.max(0.01, (p.px ?? 0.02) * screenK(p.sprite.position) * pop * (1 - k * 0.4)));
          m.opacity = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
        } else m.opacity = (1 - k) * Math.min(1, k * 8);
      }
    }
    // Write every live batched pop into its kind's instance batch.
    for (const b of this.batches.values()) b.n = 0;
    for (let i = 0; i < this.pops.length; i++) {
      const p = this.pops[i]!;
      if (p.kind === 'tag' || !p.sprite.visible) continue;
      this.batches.get(p.kind)!.write(p.sprite, p.mat.opacity);
    }
    for (const b of this.batches.values()) b.flush(b.n);
  }
}

/** Heart pop size (fraction of the view height). */
// (r20: 52 -> 46 px — the critic still found the heart + card dominating the animals they belong to)
const HEART_PX = 46 / 1080;
const POP_CAP = 64;
const _popM = new THREE.Matrix4();

/** Camera-facing quads of one pop kind as one instanced draw with per-instance opacity. */
class PopBatch {
  readonly mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private opacity: THREE.InstancedBufferAttribute;
  n = 0;

  constructor(src: THREE.MeshBasicMaterial, order: number) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.opacity = new THREE.InstancedBufferAttribute(new Float32Array(POP_CAP).fill(1), 1);
    this.opacity.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPopOpacity', this.opacity);
    const m = src.clone();
    m.opacity = 1;
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPopOpacity;\nvarying float vPopOpacity;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPopOpacity = aPopOpacity;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vPopOpacity;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vPopOpacity;');
    };
    m.customProgramCacheKey = () => 'animal-pop-batch';
    this.mesh = new THREE.InstancedMesh(geo, m, POP_CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.renderOrder = order;
    this.mesh.userData.noAO = true;
  }

  write(o: THREE.Object3D, opacity: number): void {
    if (this.n >= POP_CAP) return;
    _popM.compose(o.position, o.quaternion, o.scale);
    this.mesh.setMatrixAt(this.n, _popM);
    this.opacity.setX(this.n, opacity);
    this.n++;
  }

  flush(n: number): void {
    this.n = n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.opacity.clearUpdateRanges();
    this.opacity.addUpdateRange(0, n);
    this.opacity.needsUpdate = true;
  }
}
