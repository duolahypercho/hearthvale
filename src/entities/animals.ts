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
import { buildAnimal, type Species, type Gait, type AnimalModel } from './animals-models';
import { heartSprite } from '../world/interiors/textures';
import { textures } from '../render/textures';

export type { Species } from './animals-models';

type State = 'idle' | 'walk' | 'eat' | 'sleep' | 'happy' | 'sit';

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
  private blinkT = 1 + Math.random() * 3;
  private blink = 0;
  private look = 0;
  private lookTarget = 0;
  private earT = Math.random() * 5;
  private seed = Math.random() * 100;
  private speedK = 1;
  private forced: { x: number; z: number; cb?: () => void } | null = null;
  private stuck = 0;

  constructor(species: Species, variant = 0) {
    const m = instantiate(species, variant);
    this.species = species;
    this.gait = m.gait;
    this.mesh = m.mesh;
    this.b = m.bones;
    this.root.add(this.mesh);
    this.root.name = `animal:${species}`;
    for (const [k, bone] of Object.entries(this.b)) this.rest[k] = { bone, p: bone.position.clone(), q: bone.rotation.clone() };
    this.speedK = 0.85 + Math.random() * 0.3;
    this.dur = 0.5 + Math.random() * 2;
  }

  place(x: number, z: number, heading = this.heading): void {
    this.pos.set(x, this.heightAt(x, z), z);
    this.heading = heading;
    this.root.position.copy(this.pos);
    this.root.rotation.y = heading;
    this.target.copy(this.pos);
    this.state = this.sleeping ? 'sleep' : 'idle';
    this.stateT = 0;
  }

  setScale(s: number): void {
    this.scale = s;
    this.root.scale.setScalar(s);
  }

  /** Snap straight into the current pose weights (after teleports / demo staging). */
  settle(): void {
    this.sleepW = this.sleeping ? 1 : 0;
    this.sitW = 0;
    this.walkW = 0;
  }

  /** Walk somewhere specific (door, bowl) ignoring the wander brain; `cb` on arrival. */
  goTo(x: number, z: number, cb?: () => void): void {
    this.forced = { x, z, cb };
    this.target.set(x, 0, z);
    this.setState('walk', 60);
  }

  get busy(): boolean {
    return !!this.forced;
  }

  pet(): void {
    this.happyT = 0;
    if (this.state !== 'sleep') this.setState('happy', 0.9);
  }

  get isSleeping(): boolean {
    return this.sleepW > 0.5;
  }

  get isEating(): boolean {
    return this.state === 'eat' && this.eatW > 0.6;
  }

  /** World-space top of the head (heart pops, labels). */
  topPoint(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.pos).setY(this.pos.y + this.gait.top * this.scale * (1 - this.sleepW * 0.3));
  }

  private setState(s: State, dur: number): void {
    this.state = s;
    this.stateT = 0;
    this.dur = dur;
  }

  private pickTarget(): boolean {
    const a = this.area;
    for (let i = 0; i < 8; i++) {
      const r = 0.8 + Math.random() * 2.6;
      const ang = Math.random() * Math.PI * 2;
      const x = THREE.MathUtils.clamp(this.pos.x + Math.cos(ang) * r, a.x0, a.x1);
      const z = THREE.MathUtils.clamp(this.pos.z + Math.sin(ang) * r, a.z0, a.z1);
      if (this.walkable(x, z) && Math.hypot(x - this.pos.x, z - this.pos.z) > 0.5) {
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
    if (this.sleeping) {
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
    if (r < 0.42 && this.pickTarget()) this.setState('walk', 8);
    else if (r < (this.grazes || birds ? 0.78 : 0.55)) this.setState('eat', 2.5 + Math.random() * 4);
    else if (this.sitter && r < 0.9) this.setState('sit', 4 + Math.random() * 6);
    else this.setState('idle', 1.5 + Math.random() * 3.5);
    if (this.state === 'idle' || this.state === 'sit') this.lookTarget = (Math.random() - 0.5) * 1.2;
  }

  update(dt: number, t: number, neighbours: readonly AnimalActor[]): void {
    this.stateT += dt;
    // Night: wind down wherever we are (or at the bed spot once reached).
    if (this.sleeping && !this.forced && this.state !== 'sleep' && this.state !== 'walk') this.think();
    if (!this.sleeping && this.state === 'sleep') this.setState('idle', 0.6 + Math.random());
    if (this.stateT > this.dur && !(this.forced && this.state === 'walk')) this.think();

    // ── locomotion
    let moving = false;
    if (this.state === 'walk') {
      const dx = this.target.x - this.pos.x;
      const dz = this.target.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.08) {
        if (this.forced) {
          const cb = this.forced.cb;
          this.forced = null;
          this.setState('idle', 0.5 + Math.random());
          cb?.();
        } else if (this.sleeping) this.setState('sleep', 30);
        else if (this.hungry && this.feedSpot && Math.hypot(this.feedSpot.x - this.pos.x, this.feedSpot.z - this.pos.z) < 0.35) {
          this.heading = this.feedHeading;
          this.setState('eat', 5 + Math.random() * 3);
        } else this.setState(Math.random() < 0.5 ? 'idle' : 'eat', 1 + Math.random() * 2.5);
      } else {
        const want = Math.atan2(dx, dz);
        let dh = want - this.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        this.heading += dh * (1 - Math.exp(-6 * dt));
        const align = Math.max(0, Math.cos(dh));
        const spd = this.gait.speed * this.speedK * align * Math.min(1, d * 2 + 0.3) * (this.sleeping ? 1.2 : 1);
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
      }
    } else if (this.state === 'eat' && this.hungry && this.feedSpot) {
      let dh = this.feedHeading - this.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += dh * (1 - Math.exp(-4 * dt));
    }
    // Gentle separation (never stack up in a corner).
    for (const o of neighbours) {
      if (o === this) continue;
      const dx = this.pos.x - o.pos.x;
      const dz = this.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      const min = this.gait.radius + o.gait.radius;
      if (d > 1e-3 && d < min) {
        const push = ((min - d) / d) * 0.5 * Math.min(1, dt * 6);
        const nx = this.pos.x + dx * push;
        const nz = this.pos.z + dz * push;
        if (this.walkable(nx, nz)) {
          this.pos.x = nx;
          this.pos.z = nz;
        }
      }
    }
    this.pos.y = this.heightAt(this.pos.x, this.pos.z);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;

    // ── pose weights
    this.walkW = damp(this.walkW, moving ? 1 : 0, 8, dt);
    this.eatW = damp(this.eatW, this.state === 'eat' ? 1 : 0, 5, dt);
    this.sleepW = damp(this.sleepW, this.state === 'sleep' ? 1 : 0, 2.2, dt);
    this.sitW = damp(this.sitW, this.state === 'sit' ? 1 : 0, 4, dt);
    if (moving) this.phase += dt * this.gait.freq * Math.PI * 2 * this.speedK;
    if (this.happyT >= 0) {
      this.happyT += dt;
      if (this.happyT > 1.0) this.happyT = -1;
    }
    this.animate(dt, t);
  }

  private reset(): void {
    for (const r of Object.values(this.rest)) {
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
      head.rotation.x += (g.eatPitch + nib) * E;
      if (g.biped) body.rotation.x += 0.35 * E;
      else body.rotation.x += 0.06 * E;
    }

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
      else if (this.species === 'cow') tail.rotation.z += Math.sin(t * 1.9 + this.seed) * 0.25;
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
      head.rotation.x += (g.biped ? 0.25 : 0.35) * Z;
      head.rotation.y += (g.biped ? 0.9 : 0.25) * Z;
      head.position.y -= (g.biped ? 0.03 : g.sleepDrop * 0.25) * Z;
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
    }

    // Blink (eyes shut asleep or happy)
    this.blinkT -= dt;
    if (this.blinkT < 0) {
      this.blink = 1;
      this.blinkT = 2 + Math.random() * 4;
    }
    this.blink = Math.max(0, this.blink - dt * 8);
    const shut = Math.max(Z, this.happyT >= 0 ? 0.85 : 0, this.blink > 0.5 ? 1 : 0);
    if (b.eyes) b.eyes.scale.y = Math.max(0.08, 1 - shut * 0.92);
  }
}

// ───────────────────────────────────────────── feedback sprites

interface Pop {
  sprite: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  t: number;
  life: number;
  from: THREE.Vector3;
  kind: 'heart' | 'z' | 'note';
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

/** Heart pops (petting), sleepy Zzz and sparkle puffs above animals. One small sprite pool. */
export class AnimalPops {
  readonly group = new THREE.Group();
  private pops: Pop[] = [];
  // Camera-facing quads (not THREE.Sprite: the AO G-buffer pass only skips flagged meshes).
  private heartMat = new THREE.MeshBasicMaterial({ map: heartSprite().map, transparent: true, depthWrite: false, depthTest: false, fog: false });
  private zMat = new THREE.MeshBasicMaterial({ map: zzzTexture(), transparent: true, depthWrite: false, fog: false, opacity: 0.85 });
  private sparkMat = new THREE.MeshBasicMaterial({ map: textures.softDot().map, color: 0xfff2b0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  private quad = new THREE.PlaneGeometry(1, 1);

  constructor() {
    this.group.name = 'animal-pops';
    this.group.userData.noAO = true;
    this.group.userData.indoors = true;
    this.group.renderOrder = 20;
  }

  heart(at: THREE.Vector3, big = true): void {
    const n = big ? 1 : 1;
    for (let i = 0; i < n; i++) this.spawn('heart', at, this.heartMat.clone(), 1.25);
    for (let i = 0; i < 5; i++) {
      const p = this.spawn('note', at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, Math.random() * 0.2, (Math.random() - 0.5) * 0.5)), this.sparkMat.clone(), 0.6 + Math.random() * 0.4);
      p.sprite.scale.setScalar(0.12);
    }
  }

  z(at: THREE.Vector3): void {
    this.spawn('z', at, this.zMat.clone(), 2.4);
  }

  private spawn(kind: Pop['kind'], at: THREE.Vector3, m: THREE.MeshBasicMaterial, life: number): Pop {
    const sprite = new THREE.Mesh(this.quad, m);
    sprite.userData.noAO = true;
    sprite.castShadow = false;
    sprite.position.copy(at);
    sprite.renderOrder = 20;
    sprite.scale.setScalar(0.01);
    this.group.add(sprite);
    const p: Pop = { sprite, t: 0, life, from: at.clone(), kind };
    this.pops.push(p);
    return p;
  }

  update(dt: number, camera?: THREE.Camera): void {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i]!;
      p.t += dt;
      const k = p.t / p.life;
      const m = p.sprite.material;
      if (camera) p.sprite.quaternion.copy(camera.quaternion);
      if (k >= 1) {
        this.group.remove(p.sprite);
        m.dispose();
        this.pops.splice(i, 1);
        continue;
      }
      if (p.kind === 'heart') {
        // Pop in with overshoot, float up, fade.
        const pop = k < 0.18 ? THREE.MathUtils.lerp(0.05, 0.62, k / 0.18) : k < 0.3 ? THREE.MathUtils.lerp(0.62, 0.46, (k - 0.18) / 0.12) : 0.46;
        p.sprite.scale.setScalar(pop);
        p.sprite.position.set(p.from.x + Math.sin(k * 9) * 0.04, p.from.y + 0.15 + k * 0.55, p.from.z);
        m.opacity = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      } else if (p.kind === 'z') {
        p.sprite.scale.setScalar(0.12 + k * 0.18);
        p.sprite.position.set(p.from.x + Math.sin(k * 5) * 0.12 + k * 0.2, p.from.y + k * 0.6, p.from.z);
        m.opacity = Math.sin(k * Math.PI) * 0.9;
      } else {
        p.sprite.position.y += dt * 0.6;
        m.opacity = 1 - k;
      }
    }
  }
}
