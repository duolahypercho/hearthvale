/**
 * Mine monsters: procedural rigs + AI + game feel. Pure entities — they know nothing about
 * systems; the arena (mine map) hands them an ArenaCtx each frame and they report contact
 * attacks through `ctx.onAttack`.
 *
 *  Slime  glossy gel blob with big eyes. Spring-damper jiggle on squash / lean, hop cycle with
 *         anticipation squash → stretch in the air → splat on landing that rings out. Contact damage.
 *  Bat    fuzzy body, scalloped membrane wings flapping at ~9 Hz, glowing eyes. Weaves in, then
 *         swoops at the player and retreats; flies over rocks (never through walls).
 *  Crab   hides as a mine rock until the player comes close (or hits it), then pops up on six legs
 *         with eye stalks and scuttles sideways. Armoured: short knockback, high hp.
 *
 * Shared: white hit flash, knockback + stun, squash impulse, death animation then `dead`.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import { lumpySphere, smoothNormals } from '../world/geom';
import { facetRock, crystalPrism } from '../world/mine/rockgeo';
import { glowPoint } from '../world/mine/fx';
import { patchMaterial, after, before } from '../render/patch';
import type { Biome, MonsterKind } from '../world/mine/biomes';

export interface ArenaCtx {
  time: number;
  player: THREE.Vector3;
  /** False while the player is invulnerable / passed out (monsters keep wandering). */
  playerTargetable: boolean;
  walkable(x: number, z: number): boolean;
  flyable(x: number, z: number): boolean;
  heightAt(x: number, z: number): number;
  /**
   * Is a disc of radius r at (x, z) on open floor, clear of the cave shell (whose rock foot wanders
   * into the edge tiles)? `fly` = only the wall mass above bat height counts.
   */
  clear?(x: number, z: number, r: number, fly?: boolean): boolean;
  onAttack(m: Monster, damage: number): void;
  /** Launch a projectile (imp fireballs) from `from` along the xz direction `dir`. */
  shoot?(m: Monster, from: THREE.Vector3, dir: THREE.Vector3, damage: number): void;
  /** Particle hooks. */
  puff(p: THREE.Vector3, color: number, count: number, kind: 'dust' | 'goo' | 'spark'): void;
  rng: Rng;
}

/** Bat fresnel rim light per biome (reads the silhouette against any floor). */
const BAT_RIM: Record<Biome, number> = { earth: 0xe0b8ff, ice: 0xffd8a8, lava: 0xff9a4a };

const PALETTE: Record<Biome, { slime: number; slimeCore: number; bat: number; batEye: number; crab: number; crabLeg: number }> = {
  earth: { slime: 0x7ed957, slimeCore: 0x3f9a2a, bat: 0x5a4668, batEye: 0xffd24a, crab: 0xa29c94, crabLeg: 0xd8764a },
  ice: { slime: 0x7fd8ff, slimeCore: 0x2a7ac8, bat: 0x3e4a86, batEye: 0xffd24a, crab: 0x9fb4c8, crabLeg: 0x5a8ac8 },
  lava: { slime: 0xff7a2a, slimeCore: 0xc81e0a, bat: 0x3a2a2a, batEye: 0xff5a1a, crab: 0x4e4240, crabLeg: 0xa83a1a },
};

const STATS: Record<MonsterKind, { hp: number; dmg: number; radius: number; knock: number }> = {
  // knock = knockback distance in tiles (eased out over KB_TIME).
  slime: { hp: 24, dmg: 6, radius: 0.42, knock: 1.65 },
  bat: { hp: 16, dmg: 6, radius: 0.35, knock: 1.8 },
  crab: { hp: 42, dmg: 9, radius: 0.45, knock: 0.85 },
  wisp: { hp: 20, dmg: 4, radius: 0.36, knock: 1.5 },
  imp: { hp: 26, dmg: 7, radius: 0.38, knock: 1.55 },
};

/** Standard material with a patchable flash + rim (per monster, so each can flash on its own). */
function monsterMat(color: number, opts: { rough?: number; clearcoat?: boolean | number; emissive?: number; emissiveI?: number; rim?: number; flat?: boolean; rimColor?: number } = {}): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color,
    roughness: opts.rough ?? 0.6,
    clearcoat: typeof opts.clearcoat === 'number' ? opts.clearcoat : opts.clearcoat ? 1 : 0,
    clearcoatRoughness: typeof opts.clearcoat === 'number' ? 0.4 : 0.12,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveI ?? 1,
    flatShading: opts.flat ?? false,
  });
  const uFlash = { value: 0 };
  const uRim = { value: opts.rim ?? 0.4 };
  const uRimC = { value: new THREE.Color(opts.rimColor ?? 0xffffff) };
  const uRimT = { value: opts.rimColor !== undefined ? 1 : 0 };
  m.userData.uFlash = uFlash;
  patchMaterial(m, `monster-flash:${opts.rim ?? 0.4}:${opts.rimColor ?? '-'}`, (shader) => {
    shader.uniforms.uFlash = uFlash;
    shader.uniforms.uRimK = uRim;
    shader.uniforms.uRimC = uRimC;
    shader.uniforms.uRimT = uRimT;
    let fs = before(shader.fragmentShader, 'void main() {', 'uniform float uFlash; uniform float uRimK; uniform vec3 uRimC; uniform float uRimT;');
    fs = after(
      fs,
      '#include <emissivemap_fragment>',
      `{
        float fr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.5);
        totalEmissiveRadiance += mix(diffuseColor.rgb, uRimC, uRimT) * fr * uRimK;
        // Hit flash: a hot rim + a lifted body that keeps the creature's own hue (never a white blob).
        float frF = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 1.5);
        totalEmissiveRadiance += (diffuseColor.rgb * 0.55 + vec3(0.35)) * uFlash + vec3(1.0, 0.95, 0.85) * frF * uFlash * 1.2;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.6 + 0.4, uFlash * 0.4);
      }`,
    );
    shader.fragmentShader = fs;
  });
  return m;
}

/** Knockback slide duration (s). */
export const KB_TIME = 0.18;

let blobGeo: THREE.CircleGeometry | null = null;
function shadowBlob(r: number): THREE.Mesh {
  blobGeo ??= new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2) as THREE.CircleGeometry;
  const m = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
  m.scale.setScalar(r);
  m.renderOrder = 1;
  m.userData.noAO = true;
  return m;
}

function eye(r: number, glow?: number): THREE.Group {
  const g = new THREE.Group();
  if (glow !== undefined) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(glow).multiplyScalar(3) }));
    g.add(m);
    return g;
  }
  const white = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }));
  white.scale.set(1, 1.2, 0.7);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * 0.62, 12, 8), new THREE.MeshStandardMaterial({ color: 0x14100e, roughness: 0.2 }));
  pupil.position.set(0, -r * 0.1, r * 0.42);
  pupil.scale.set(1, 1.25, 0.6);
  const glint = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  glint.position.set(r * 0.25, r * 0.28, r * 0.72);
  g.add(white, pupil, glint);
  return g;
}

/**
 * Draw-call diet: bake several static parts (descendants of `parent`) into ONE mesh under it.
 * `mat` given = they share that lit material (position + normal only); otherwise the parts' own
 * material colours are baked into vertex colours under one unlit material (eyes, fangs, mouths,
 * gloss highlights: cartoon details that read better unlit anyway, and glow colours > 1 still bloom).
 */
function mergeParts(parent: THREE.Object3D, parts: THREE.Mesh[], mat?: THREE.Material): THREE.Mesh {
  parent.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const geos: THREE.BufferGeometry[] = [];
  for (const m of parts) {
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (!mat) {
      const c = ((m.material as THREE.MeshBasicMaterial).color ?? new THREE.Color(1, 1, 1)).clone();
      const n = g.attributes.position!.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    geos.push(g);
    m.removeFromParent();
    if (!mat) (m.material as THREE.Material).dispose?.();
  }
  const merged = mergeGeometries(geos)!;
  for (const g of geos) g.dispose();
  const out = new THREE.Mesh(merged, mat ?? new THREE.MeshBasicMaterial({ vertexColors: true }));
  parent.add(out);
  return out;
}

/** Bake a part's material colour into a per-vertex colour attribute. */
function bakeColor(g: THREE.BufferGeometry, m: THREE.Mesh): void {
  const c = ((m.material as THREE.MeshBasicMaterial).color ?? new THREE.Color(1, 1, 1)).clone();
  const n = g.attributes.position!.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/**
 * Draw-call diet for ARTICULATED parts (legs, claws, eye stalks, tails): bake meshes hanging off
 * several animated pivots into ONE rigidly skinned mesh. Every vertex is bound 100 % to its nearest
 * pivot in `bones` (or to `host` itself), so the pivots' existing rotation / scale animation keeps
 * working untouched. `mat` given = shared lit material (the parts' own colours are baked into
 * vertex colours when `mat.vertexColors` is on); otherwise one unlit vertex-coloured material.
 * Call while every pivot is at rest scale (before any reveal / squash is applied).
 */
function rigidSkin(host: THREE.Object3D, bones: THREE.Object3D[], parts: THREE.Mesh[], mat?: THREE.Material): THREE.SkinnedMesh {
  host.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(host.matrixWorld).invert();
  const geos: THREE.BufferGeometry[] = [];
  const bake = !mat || (mat as THREE.MeshStandardMaterial).vertexColors;
  const owned = new Set<THREE.Material>();
  for (const m of parts) {
    let bi = bones.length;
    for (let o: THREE.Object3D | null = m.parent; o && o !== host; o = o.parent) {
      const k = bones.indexOf(o);
      if (k >= 0) {
        bi = k;
        break;
      }
    }
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (bake) bakeColor(g, m);
    const n = g.attributes.position!.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = bi;
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geos.push(g);
    m.removeFromParent();
    m.geometry.dispose();
    const mm = m.material as THREE.Material;
    if (mm !== mat) owned.add(mm);
  }
  const merged = mergeGeometries(geos)!;
  for (const g of geos) g.dispose();
  const out = new THREE.SkinnedMesh(merged, mat ?? new THREE.MeshBasicMaterial({ vertexColors: true }));
  host.add(out);
  out.updateMatrixWorld(true);
  out.bind(new THREE.Skeleton([...bones, host] as THREE.Bone[]));
  merged.computeBoundingSphere();
  // Generous: the limbs swing around the rest pose (never culled while partly on screen).
  out.boundingSphere = merged.boundingSphere!.clone();
  out.boundingSphere.radius += 0.35;
  // Only the parts' private materials go; ones still used elsewhere on the rig stay (monster mats
  // are disposed with the rig).
  for (const mm of owned) if (!mm.userData.uFlash) mm.dispose();
  return out;
}

export abstract class Monster {
  readonly root = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  hp: number;
  maxHp: number;
  readonly radius: number;
  readonly damage: number;
  readonly knockback: number;
  /** 0..1 flash. */
  protected flash = 0;
  protected stun = 0;
  protected mats: THREE.MeshPhysicalMaterial[] = [];
  protected blob: THREE.Mesh;
  protected facing = 0;
  dying = -1;
  dead = false;
  aggro = false;
  attackCooldown = 0;
  /** Demo stills: keep the hit flash lit. */
  holdFlash = false;
  protected seed: number;
  /** Active knockback slide: direction, distance, eased progress. */
  protected kb: { dx: number; dz: number; dist: number; t: number; e: number } | null = null;
  /** 0..1 hit squash on the whole rig (3–4 frames). */
  protected squash = 0;
  /** Network id (host-assigned; co-op snapshots address monsters by it). */
  netId = 0;

  constructor(
    readonly kind: MonsterKind,
    readonly biome: Biome,
    x: number,
    z: number,
    tier: number,
    band: number,
    seed: number,
  ) {
    const st = STATS[kind];
    const scale = 1 + band * 0.55 + tier * 1.2;
    this.hp = this.maxHp = Math.round(st.hp * scale);
    this.damage = Math.round(st.dmg * (1 + band * 0.45 + tier));
    this.radius = st.radius;
    this.knockback = st.knock;
    this.seed = seed;
    this.pos.set(x, 0, z);
    this.root.name = `monster:${kind}`;
    this.root.userData.perfTag = 'monsters';
    this.blob = shadowBlob(st.radius * 1.05);
    this.root.add(this.blob);
  }

  get alive(): boolean {
    return this.dying < 0 && !this.dead;
  }

  /** Fliers (bats, wisps) pass over walkers and hover at head height. */
  get flies(): boolean {
    return this.kind === 'bat' || this.kind === 'wisp';
  }

  /** Apply a hit; returns true if it killed. */
  hit(dmg: number, dir: THREE.Vector3, power = 1): boolean {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.flash = 1;
    this.stun = KB_TIME + 0.16;
    this.aggro = true;
    // Knockback: a fixed-distance ease-out slide (≥ 1.5 tiles for the soft ones), not an impulse
    // the AI's own damping would eat.
    this.vel.x = 0;
    this.vel.z = 0;
    const len = Math.hypot(dir.x, dir.z) || 1;
    this.kb = { dx: dir.x / len, dz: dir.z / len, dist: this.knockback * Math.min(1.35, power), t: 0, e: 0 };
    this.squash = 1;
    this.onHit(dir);
    if (this.hp <= 0) {
      this.dying = 0;
      return true;
    }
    return false;
  }

  protected onHit(_dir: THREE.Vector3): void {}

  /** World position of the damage-number anchor. */
  headPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pos).setY(this.pos.y + 1.05);
  }

  /** Slide-move with tile collision. */
  protected move(dt: number, ctx: ArenaCtx, fly = false): void {
    const tiles = (x: number, z: number): boolean => {
      const r = this.radius * 0.8;
      for (const [ox, oz] of [[-r, -r], [r, -r], [-r, r], [r, r]] as const) {
        const tx = Math.floor(x + ox);
        const tz = Math.floor(z + oz);
        if (!(fly ? ctx.flyable(tx, tz) : ctx.walkable(tx, tz))) return false;
      }
      return true;
    };
    // Radius-aware against the rock itself (never half inside a wall). A monster that somehow is
    // already overlapping the rock may still move (so it can walk out).
    const inRock = ctx.clear ? !ctx.clear(this.pos.x, this.pos.z, this.radius, fly) : false;
    const ok = (x: number, z: number): boolean => tiles(x, z) && (inRock || !ctx.clear || ctx.clear(x, z, this.radius, fly));
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    if (ok(nx, this.pos.z)) this.pos.x = nx;
    else this.vel.x *= -0.4;
    if (ok(this.pos.x, nz)) this.pos.z = nz;
    else this.vel.z *= -0.4;
  }

  protected touchPlayer(ctx: ArenaCtx, reach = 0.35): void {
    if (!ctx.playerTargetable || this.attackCooldown > 0 || this.stun > 0) return;
    const d = Math.hypot(ctx.player.x - this.pos.x, ctx.player.z - this.pos.z);
    if (d < this.radius + reach) {
      this.attackCooldown = 1.1;
      ctx.onAttack(this, this.damage);
    }
  }

  /** Collision-checked displacement (knockback). Returns false if fully blocked. */
  protected slide(dx: number, dz: number, ctx: ArenaCtx): boolean {
    const vx = this.vel.x;
    const vz = this.vel.z;
    this.vel.set(dx, this.vel.y, dz);
    const x0 = this.pos.x;
    const z0 = this.pos.z;
    this.move(1, ctx, this.flies);
    this.vel.x = vx;
    this.vel.z = vz;
    return this.pos.x !== x0 || this.pos.z !== z0;
  }

  /** Knockback slide + rig squash (runs before the AI each frame). */
  private react(dt: number, ctx: ArenaCtx): void {
    const k = this.kb;
    if (k) {
      k.t += dt;
      const u = Math.min(1, k.t / KB_TIME);
      const e = 1 - Math.pow(1 - u, 3);
      const step = (e - k.e) * k.dist;
      k.e = e;
      if (step > 0 && !this.slide(k.dx * step, k.dz * step, ctx)) this.kb = null;
      else if (u >= 1) this.kb = null;
    }
    if (this.squash > 0) this.squash = Math.max(0, this.squash - dt / 0.075);
    const s = this.squash;
    this.root.scale.set(1 + 0.26 * s, 1 - 0.3 * s, 1 + 0.26 * s);
  }

  /** Co-op mirror: face this way (the host's heading). */
  mirrorYaw(yaw: number): void {
    this.facing = yaw;
    this.root.rotation.y = yaw;
  }

  /** Co-op mirror: play a hit (flash, squash, jiggle, death) without simulating it. */
  hitFx(dir: THREE.Vector3, killed: boolean): void {
    if (!this.alive) return;
    this.flash = 1;
    this.squash = 1;
    this.aggro = true;
    this.onHit(dir);
    if (killed) {
      this.hp = 0;
      this.dying = 0;
    }
  }

  /** Currently sliding from a hit (co-op snapshots mark it). */
  get knocked(): boolean {
    return !!this.kb;
  }

  update(dt: number, ctx: ArenaCtx, frozen = false): void {
    this.flash = this.holdFlash ? 0.22 : Math.max(0, this.flash - dt * 7);
    if (frozen && this.dying < 0) {
      if (this.squash > 0) {
        this.squash = Math.max(0, this.squash - dt / 0.075);
        const s = this.squash;
        this.root.scale.set(1 + 0.26 * s, 1 - 0.3 * s, 1 + 0.26 * s);
      }
      for (const m of this.mats) (m.userData.uFlash as { value: number }).value = this.flash;
      this.pose(dt, ctx);
      this.root.position.copy(this.pos);
      return;
    }
    for (const m of this.mats) (m.userData.uFlash as { value: number }).value = this.flash;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    if (this.dying >= 0) {
      this.dying += dt;
      this.react(dt, ctx);
      this.animateDeath(dt, ctx);
      return;
    }
    if (this.stun > 0) {
      this.stun -= dt;
      const k = Math.exp(-dt * 7);
      this.vel.x *= k;
      this.vel.z *= k;
    }
    this.react(dt, ctx);
    this.think(dt, ctx);
    this.root.position.copy(this.pos);
  }

  protected abstract think(dt: number, ctx: ArenaCtx): void;
  /** Idle-only animation while the arena is frozen (demos / paused). */
  protected pose(_dt: number, _ctx: ArenaCtx): void {}
  protected abstract animateDeath(dt: number, ctx: ArenaCtx): void;

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        if (m.geometry !== blobGeo) m.geometry.dispose();
        const mm = m.material as THREE.Material;
        mm.dispose();
        (m as THREE.SkinnedMesh).skeleton?.dispose();
      }
    });
  }
}

// ───────────────────────────────────────────── Slime

export class Slime extends Monster {
  private body = new THREE.Group();
  private gel: THREE.Mesh;
  // Jiggle springs.
  private sy = 1;
  private vy = 0;
  private lean = new THREE.Vector2();
  private leanV = new THREE.Vector2();
  private hopT = 0;
  private state: 'idle' | 'wind' | 'air' = 'idle';
  private stateT = 0;
  private y = 0;
  private yv = 0;
  private wait: number;
  private color: number;
  private eyes: THREE.Group;

  constructor(biome: Biome, x: number, z: number, tier: number, band: number, seed: number) {
    super('slime', biome, x, z, tier, band, seed);
    const pal = PALETTE[biome];
    this.color = pal.slime;
    const r = new Rng(seed);
    const geo = lumpySphere(0.42, 3, 0.035, r, 1.2);
    // Flat-ish bottom, domed top.
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      let yy = p.getY(i);
      if (yy < -0.12) yy = -0.12 + (yy + 0.12) * 0.25;
      p.setY(i, yy + 0.18);
    }
    smoothNormals(geo);
    const gelMat = monsterMat(pal.slime, { rough: 0.16, clearcoat: true, emissive: pal.slime, emissiveI: biome === 'lava' ? 0.5 : 0.12, rim: 0.9 });
    this.mats.push(gelMat);
    this.gel = new THREE.Mesh(geo, gelMat);
    this.gel.castShadow = true;
    this.body.add(this.gel);
    // Inner core shadow (seen through the glossy top as a darker belly band).
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 10), monsterMat(pal.slimeCore, { rough: 0.3, emissive: pal.slimeCore, emissiveI: biome === 'lava' ? 1.2 : 0.2, rim: 0.2 }));
    core.position.set(0, 0.2, -0.12);
    core.scale.set(1.3, 0.7, 1);
    this.mats.push(core.material as THREE.MeshPhysicalMaterial);
    this.body.add(core);
    // Specular blob highlight (cartoon gel read).
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    hl.position.set(-0.14, 0.5, 0.2);
    hl.scale.set(1.3, 0.6, 0.8);
    hl.rotation.z = 0.5;
    this.body.add(hl);
    // Eyes + mouth.
    this.eyes = new THREE.Group();
    for (const sx of [-1, 1]) {
      const e = eye(0.1);
      e.position.set(sx * 0.14, 0.42, 0.3);
      e.rotation.x = -0.45;
      this.eyes.add(e);
    }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 12, Math.PI), new THREE.MeshBasicMaterial({ color: 0x1a1210 }));
    mouth.position.set(0, 0.3, 0.37);
    mouth.rotation.x = -0.4;
    mouth.rotation.z = Math.PI;
    this.eyes.add(mouth);
    this.body.add(this.eyes);
    this.root.add(this.body);
    // One unlit mesh for the whole face + gloss highlight (was 8 meshes).
    hl.removeFromParent();
    this.eyes.add(hl);
    hl.position.y -= this.eyes.position.y;
    const face: THREE.Mesh[] = [];
    this.eyes.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) face.push(o as THREE.Mesh);
    });
    mergeParts(this.eyes, face);
    this.wait = 0.4 + r.next() * 1.5;
    this.facing = (r.next() - 0.5) * 1.6;
  }

  protected override onHit(): void {
    this.vy -= 5.5;
    this.leanV.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    this.state = 'idle';
    this.wait = 0.5;
  }

  protected think(dt: number, ctx: ArenaCtx): void {
    const g = ctx.heightAt(this.pos.x, this.pos.z);
    const toP = new THREE.Vector2(ctx.player.x - this.pos.x, ctx.player.z - this.pos.z);
    const dist = toP.length();
    if (dist < 6.5) this.aggro = true;
    if (dist > 11) this.aggro = false;
    this.stateT += dt;

    if (this.stun <= 0) {
      if (this.state === 'idle') {
        this.vel.x *= Math.exp(-dt * 9);
        this.vel.z *= Math.exp(-dt * 9);
        this.wait -= dt;
        if (this.wait <= 0) {
          this.state = 'wind';
          this.stateT = 0;
          this.vy -= 2.2;
        }
      } else if (this.state === 'wind') {
        // Anticipation: squash down before the hop.
        if (this.stateT > 0.22) {
          this.state = 'air';
          this.stateT = 0;
          let dir: THREE.Vector2;
          if (this.aggro && ctx.playerTargetable) dir = toP.clone().normalize();
          else {
            const a = ctx.rng.next() * Math.PI * 2;
            dir = new THREE.Vector2(Math.cos(a), Math.sin(a));
          }
          const sp = this.aggro ? 2.6 + Math.min(1, dist / 3) * 1.2 : 1.3;
          this.vel.x = dir.x * sp;
          this.vel.z = dir.y * sp;
          this.yv = this.aggro ? 4.2 : 3.2;
          this.vy += 4.5;
          // Face the hop, but never turn the face fully away from the camera (always readable).
          this.facing = THREE.MathUtils.clamp(Math.atan2(dir.x, dir.y), -1.25, 1.25);
        }
      } else if (this.state === 'air') {
        this.yv -= 16 * dt;
        this.y += this.yv * dt;
        if (this.y <= 0) {
          this.y = 0;
          this.state = 'idle';
          this.vy -= 5.5 + Math.abs(this.yv) * 0.4;
          this.yv = 0;
          this.wait = this.aggro ? 0.25 + ctx.rng.next() * 0.35 : 0.8 + ctx.rng.next() * 1.6;
          ctx.puff(this.pos.clone().setY(g + 0.05), this.biome === 'ice' ? 0xdff0ff : 0x8a7058, 4, 'dust');
        }
      }
    } else if (this.state === 'air') {
      this.yv -= 16 * dt;
      this.y = Math.max(0, this.y + this.yv * dt);
      if (this.y === 0) this.state = 'idle';
    }
    this.move(dt, ctx);
    this.pos.y = g + this.y;
    if (this.y < 0.3) this.touchPlayer(ctx, 0.3);
    this.springs(dt, ctx);
  }

  protected override pose(dt: number, ctx: ArenaCtx): void {
    this.pos.y = ctx.heightAt(this.pos.x, this.pos.z) + this.y;
    this.springs(dt, ctx);
  }

  private springs(dt: number, ctx: ArenaCtx): void {
    // Springs: vertical squash + lean against velocity.
    let target = 1;
    if (this.state === 'wind') target = 0.72;
    if (this.state === 'air') target = 1 + Math.min(0.25, Math.abs(this.yv) * 0.05);
    const breathe = this.state === 'idle' ? Math.sin(ctx.time * 3.2 + this.seed) * 0.03 : 0;
    this.vy += (-(this.sy - (target + breathe)) * 170 - this.vy * 9) * dt;
    this.sy += this.vy * dt;
    const lt = new THREE.Vector2(-this.vel.x * 0.07, -this.vel.z * 0.07);
    this.leanV.x += (-(this.lean.x - lt.x) * 120 - this.leanV.x * 7) * dt;
    this.leanV.y += (-(this.lean.y - lt.y) * 120 - this.leanV.y * 7) * dt;
    this.lean.addScaledVector(this.leanV, dt);

    const sy = THREE.MathUtils.clamp(this.sy, 0.5, 1.5);
    const sxz = 1 / Math.sqrt(sy);
    this.body.scale.set(sxz, sy, sxz);
    this.body.rotation.set(this.lean.y, 0, -this.lean.x);
    let d = this.facing - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * (1 - Math.exp(-dt * 8));
    // Eyes look at the player when close.
    this.eyes.position.y = (sy - 1) * -0.05;
    this.blob.position.y = -this.y + 0.03;
    this.blob.scale.setScalar(this.radius * sxz * 1.05 * (1 - Math.min(0.4, this.y * 0.5)));
  }

  protected animateDeath(dt: number, ctx: ArenaCtx): void {
    const t = this.dying;
    // Flatten + spread, then pop.
    const k = Math.min(1, t / 0.22);
    this.body.scale.set(1 + k * 0.6, 1 - k * 0.75, 1 + k * 0.6);
    this.root.position.copy(this.pos);
    if (t > 0.22 && !this.dead) {
      this.dead = true;
      const p = this.pos.clone().setY(this.pos.y + 0.3);
      ctx.puff(p, this.color, 22, 'goo');
      ctx.puff(p, 0xe8e0d0, 10, 'dust');
    }
    void dt;
  }
}

// ───────────────────────────────────────────── Bat

function wingGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.18, 0.18, 0.42, 0.22, 0.62, 0.12);
  s.lineTo(0.56, -0.02);
  s.quadraticCurveTo(0.5, -0.1, 0.42, -0.06);
  s.quadraticCurveTo(0.34, -0.16, 0.25, -0.1);
  s.quadraticCurveTo(0.16, -0.18, 0.08, -0.1);
  s.lineTo(0, -0.05);
  const g = new THREE.ShapeGeometry(s, 8);
  g.rotateX(-Math.PI / 2);
  return g;
}

export class Bat extends Monster {
  private body = new THREE.Group();
  private wingL = new THREE.Group();
  private wingR = new THREE.Group();
  private alt = 1.5;
  private home: THREE.Vector2;
  private mode: 'wander' | 'approach' | 'swoop' | 'retreat' = 'wander';
  private modeT = 0;
  private swoopDir = new THREE.Vector2();
  private flap = 0;
  private spin = 0;

  constructor(biome: Biome, x: number, z: number, tier: number, band: number, seed: number) {
    super('bat', biome, x, z, tier, band, seed);
    const pal = PALETTE[biome];
    const r = new Rng(seed);
    this.home = new THREE.Vector2(x, z);
    const furMat = monsterMat(pal.bat, { rough: 0.9, rim: 0.3, rimColor: BAT_RIM[biome], emissive: biome === 'lava' ? 0x301008 : 0x000000 });
    this.mats.push(furMat);
    const bodyGeo = lumpySphere(0.2, 2, 0.12, r, 3.2);
    const bodyM = new THREE.Mesh(bodyGeo, furMat);
    bodyM.scale.set(1, 1.05, 0.95);
    bodyM.castShadow = true;
    this.body.add(bodyM);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 5), furMat);
      ear.position.set(sx * 0.1, 0.2, 0);
      ear.rotation.z = -sx * 0.35;
      this.body.add(ear);
      const e = eye(0.045, pal.batEye);
      e.position.set(sx * 0.075, 0.05, 0.17);
      this.body.add(e);
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 4), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      fang.position.set(sx * 0.035, -0.07, 0.17);
      fang.rotation.x = Math.PI;
      this.body.add(fang);
    }
    {
      // Fur (body + ears) as one mesh, eyes + fangs as one unlit mesh (was 7 meshes).
      const fur: THREE.Mesh[] = [];
      const face: THREE.Mesh[] = [];
      this.body.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        (m.material === furMat ? fur : face).push(m);
      });
      const fm = mergeParts(this.body, fur, furMat);
      fm.castShadow = true;
      mergeParts(this.body, face);
    }
    const wingMat = monsterMat(new THREE.Color(pal.bat).multiplyScalar(0.7).getHex(), { rough: 0.7, rim: 0.1, rimColor: BAT_RIM[biome] });
    wingMat.side = THREE.DoubleSide;
    this.mats.push(wingMat);
    const wg = wingGeometry();
    const wl = new THREE.Mesh(wg, wingMat);
    wl.castShadow = true;
    const wr = new THREE.Mesh(wg, wingMat);
    wr.scale.x = -1;
    wr.castShadow = true;
    this.wingR.add(wl);
    this.wingL.add(wr);
    this.wingR.position.set(0.12, 0.04, 0);
    this.wingL.position.set(-0.12, 0.04, 0);
    this.body.add(this.wingL, this.wingR);
    this.body.scale.setScalar(1.35);
    this.root.add(this.body);
    this.flap = r.next() * 10;
    this.alt = 1.3 + r.next() * 0.5;
  }

  override headPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pos).setY(this.pos.y + 0.55);
  }

  protected override onHit(): void {
    this.mode = 'retreat';
    this.modeT = 0;
    this.spin = 1;
  }

  protected think(dt: number, ctx: ArenaCtx): void {
    const g = ctx.heightAt(this.pos.x, this.pos.z);
    const to = new THREE.Vector2(ctx.player.x - this.pos.x, ctx.player.z - this.pos.z);
    const dist = to.length();
    if (dist < 7) this.aggro = true;
    this.modeT += dt;
    let want = new THREE.Vector2();
    let targetAlt = this.alt + Math.sin(ctx.time * 2.3 + this.seed) * 0.15;
    if (this.stun <= 0) {
      switch (this.mode) {
        case 'wander': {
          const a = ctx.time * 0.8 + this.seed;
          const tx = this.home.x + Math.cos(a) * 1.8;
          const tz = this.home.y + Math.sin(a * 1.3) * 1.2;
          want.set(tx - this.pos.x, tz - this.pos.z).clampLength(0, 1).multiplyScalar(2.2);
          if (this.aggro && ctx.playerTargetable) this.mode = 'approach';
          break;
        }
        case 'approach': {
          const side = new THREE.Vector2(-to.y, to.x).normalize().multiplyScalar(Math.sin(ctx.time * 3 + this.seed) * 1.6);
          want.copy(to).normalize().multiplyScalar(3.2).add(side);
          if (dist < 2.6 && this.attackCooldown <= 0 && this.modeT > 0.8) {
            this.mode = 'swoop';
            this.modeT = 0;
            this.swoopDir.copy(to).normalize();
          }
          if (!ctx.playerTargetable) this.mode = 'wander';
          break;
        }
        case 'swoop':
          want.copy(this.swoopDir).multiplyScalar(7);
          targetAlt = 0.75;
          if (this.modeT > 0.55) {
            this.mode = 'retreat';
            this.modeT = 0;
          }
          break;
        case 'retreat':
          want.copy(to).normalize().multiplyScalar(-3.2);
          targetAlt = this.alt + 0.4;
          if (this.modeT > 1.0) {
            this.mode = 'approach';
            this.modeT = 0;
          }
          break;
      }
      const k = 1 - Math.exp(-dt * (this.mode === 'swoop' ? 9 : 3.5));
      this.vel.x += (want.x - this.vel.x) * k;
      this.vel.z += (want.y - this.vel.z) * k;
    } else {
      want = new THREE.Vector2();
      targetAlt = this.alt;
    }
    this.move(dt, ctx, true);
    // Personal space: never clip into the farmer (≥ 0.6 m from their 0.3 m capsule).
    {
      const px = this.pos.x - ctx.player.x;
      const pz = this.pos.z - ctx.player.z;
      const d = Math.hypot(px, pz);
      const min = 0.9;
      if (d < min) {
        const k = d > 1e-3 ? min / d : 0;
        const nx = d > 1e-3 ? ctx.player.x + px * k : ctx.player.x + min;
        const nz = d > 1e-3 ? ctx.player.z + pz * k : ctx.player.z;
        if (ctx.flyable(Math.floor(nx), Math.floor(nz))) {
          this.pos.x = nx;
          this.pos.z = nz;
        }
      }
    }
    const cy = this.pos.y - g;
    this.pos.y = g + cy + (targetAlt - cy) * (1 - Math.exp(-dt * 5));
    if (this.mode === 'swoop') this.touchPlayer(ctx, 0.64);

    // Flap faster when climbing / swooping.
    this.flap += dt * (this.mode === 'swoop' ? 13 : 10);
    const f = Math.sin(this.flap * Math.PI * 2 * 0.9);
    this.wingR.rotation.z = f * 0.95 + 0.1;
    this.wingL.rotation.z = -f * 0.95 - 0.1;
    this.body.position.y = -f * 0.05;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.3) {
      const yaw = Math.atan2(this.vel.x, this.vel.z);
      let d = yaw - this.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.root.rotation.y += d * (1 - Math.exp(-dt * 8));
    }
    this.spin = Math.max(0, this.spin - dt * 2.5);
    this.body.rotation.x = Math.min(0.6, speed * 0.07) + this.spin * 0.8;
    this.body.rotation.z = this.spin * Math.sin(ctx.time * 30) * 0.5;
    const hgt = this.pos.y - g;
    this.blob.position.y = -hgt + 0.03;
    this.blob.scale.setScalar(this.radius * (1.1 - Math.min(0.5, hgt * 0.2)));
    (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.28 - Math.min(0.14, hgt * 0.06);
  }

  protected override pose(dt: number, ctx: ArenaCtx): void {
    const g = ctx.heightAt(this.pos.x, this.pos.z);
    this.pos.y = g + this.alt + Math.sin(ctx.time * 2.3 + this.seed) * 0.12;
    this.flap += dt * 10;
    const f = Math.sin(this.flap * Math.PI * 2 * 0.9);
    this.wingR.rotation.z = f * 0.95 + 0.1;
    this.wingL.rotation.z = -f * 0.95 - 0.1;
    this.body.position.y = -f * 0.05;
    this.blob.position.y = -this.alt + 0.03;
  }

  protected animateDeath(dt: number, ctx: ArenaCtx): void {
    const t = this.dying;
    this.pos.y = Math.max(ctx.heightAt(this.pos.x, this.pos.z) + 0.15, this.pos.y - dt * 4);
    this.body.rotation.z += dt * 18;
    this.body.scale.setScalar(1.35 * (1 - Math.min(1, t / 0.3) * 0.6));
    this.root.position.copy(this.pos);
    if (t > 0.3 && !this.dead) {
      this.dead = true;
      ctx.puff(this.pos.clone(), PALETTE[this.biome].bat, 16, 'dust');
      ctx.puff(this.pos.clone(), PALETTE[this.biome].batEye, 8, 'spark');
    }
  }
}

// ───────────────────────────────────────────── Rock crab

export class Crab extends Monster {
  private shell: THREE.Mesh;
  private body = new THREE.Group();
  private legs: THREE.Group[] = [];
  private stalks: THREE.Group[] = [];
  private claws: THREE.Group[] = [];
  private reveal = 0;
  private hidden = true;
  private walk = 0;
  private strafe = 1;
  private strafeT = 0;

  constructor(biome: Biome, x: number, z: number, tier: number, band: number, seed: number) {
    super('crab', biome, x, z, tier, band, seed);
    const pal = PALETTE[biome];
    const r = new Rng(seed);
    const shellGeo = facetRock(r, 0.44, pal.crab, { chunky: true, squash: 0.74, cap: biome === 'ice' ? 0xf4faff : undefined, capAmt: 0.9, rim: 0.5 });
    const shellMat = monsterMat(0xffffff, { rough: 0.7, rim: 0.3, flat: true, clearcoat: 0.55 });
    shellMat.vertexColors = true;
    this.mats.push(shellMat);
    this.shell = new THREE.Mesh(shellGeo, shellMat);
    this.shell.castShadow = true;
    this.body.add(this.shell);
    const legMat = monsterMat(pal.crabLeg, { rough: 0.5, clearcoat: true, rim: 0.5 });
    this.mats.push(legMat);
    const jointMat = monsterMat(new THREE.Color(pal.crabLeg).multiplyScalar(0.42).getHex(), { rough: 0.45, clearcoat: true, rim: 0.3 });
    this.mats.push(jointMat);
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const k = i % 3;
      const leg = new THREE.Group();
      // Thick segments (x1.8) + dark knuckles / claw tips, merged to two meshes per leg.
      const ug = new THREE.CapsuleGeometry(0.063, 0.2, 3, 8).applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(side * 0.1, 0.02, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, side * 1.1)), new THREE.Vector3(1, 1, 1)));
      const lg = new THREE.CapsuleGeometry(0.054, 0.22, 3, 8).applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(side * 0.24, -0.1, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, side * 0.3)), new THREE.Vector3(1, 1, 1)));
      const kg = new THREE.SphereGeometry(0.07, 10, 8).translate(side * 0.2, -0.02, 0);
      const tg = new THREE.ConeGeometry(0.045, 0.1, 6).applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(side * 0.27, -0.24, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI + side * 0.3)), new THREE.Vector3(1, 1, 1)));
      const seg = new THREE.Mesh(mergeGeometries([ug, lg])!, legMat);
      const joints = new THREE.Mesh(mergeGeometries([kg, tg])!, jointMat);
      for (const g of [ug, lg, kg, tg]) g.dispose();
      seg.castShadow = true;
      leg.add(seg, joints);
      leg.position.set(side * 0.28, 0.16, (k - 1) * 0.2);
      this.legs.push(leg);
      this.body.add(leg);
    }
    for (const sx of [-1, 1]) {
      const stalk = new THREE.Group();
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.22, 6), legMat);
      st.position.y = 0.11;
      const e = eye(0.06);
      e.position.y = 0.24;
      stalk.add(st, e);
      stalk.position.set(sx * 0.12, 0.3, 0.26);
      this.stalks.push(stalk);
      this.body.add(stalk);
      const claw = new THREE.Group();
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.16, 3, 6), legMat);
      arm.rotation.x = Math.PI / 2;
      arm.position.z = 0.1;
      const pincer = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), legMat);
      pincer.scale.set(0.8, 0.6, 1.2);
      pincer.position.z = 0.24;
      claw.add(arm, pincer);
      claw.position.set(sx * 0.2, 0.14, 0.3);
      this.claws.push(claw);
      this.body.add(claw);
    }
    this.root.add(this.body);
    {
      // Draw-call diet (was 26 meshes): legs + knuckles + claws + stalks as ONE rigidly skinned lit
      // mesh (leg / joint colours baked per vertex), the four eye parts as one unlit skinned mesh.
      const limbMat = monsterMat(0xffffff, { rough: 0.48, clearcoat: true, rim: 0.45 });
      limbMat.vertexColors = true;
      this.mats.push(limbMat);
      const bones: THREE.Object3D[] = [...this.legs, ...this.stalks, ...this.claws];
      const lit: THREE.Mesh[] = [];
      const face: THREE.Mesh[] = [];
      for (const b of bones)
        b.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          (m.material === legMat || m.material === jointMat ? lit : face).push(m);
        });
      const limbs = rigidSkin(this.body, bones, lit, limbMat);
      limbs.castShadow = true;
      rigidSkin(this.body, bones, face);
    }
    this.root.rotation.y = r.next() * 6;
    this.applyReveal();
  }

  get disguised(): boolean {
    return this.hidden;
  }

  protected override onHit(): void {
    this.hidden = false;
  }

  /** Drop the disguise and pop up (demo staging / something disturbed it). */
  wake(): void {
    this.hidden = false;
  }

  private applyReveal(): void {
    const k = this.reveal;
    const ov = k < 1 ? k : 1;
    for (const l of this.legs) l.scale.setScalar(Math.max(0.001, ov));
    for (const s of this.stalks) s.scale.set(1, Math.max(0.001, easeOutBack(ov)), 1);
    for (const c of this.claws) c.scale.setScalar(Math.max(0.001, ov));
  }

  protected think(dt: number, ctx: ArenaCtx): void {
    const g = ctx.heightAt(this.pos.x, this.pos.z);
    const to = new THREE.Vector2(ctx.player.x - this.pos.x, ctx.player.z - this.pos.z);
    const dist = to.length();
    if (this.hidden && dist < 1.7) this.hidden = false;
    if (!this.hidden) this.aggro = true;
    const target = this.hidden ? 0 : 1;
    this.reveal += (target - this.reveal) * (1 - Math.exp(-dt * 9));
    this.applyReveal();
    let lift = 0;
    if (!this.hidden) {
      lift = 0.12 * this.reveal;
      if (this.stun <= 0 && ctx.playerTargetable) {
        this.strafeT -= dt;
        if (this.strafeT <= 0) {
          this.strafe = -this.strafe;
          this.strafeT = 0.8 + ctx.rng.next() * 0.8;
        }
        const dir = to.clone().normalize();
        const side = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(this.strafe * 1.2);
        const want = dir.multiplyScalar(1.9).add(side);
        const k = 1 - Math.exp(-dt * 6);
        this.vel.x += (want.x - this.vel.x) * k;
        this.vel.z += (want.y - this.vel.z) * k;
        const yaw = Math.atan2(to.x, to.y);
        let d = yaw - this.root.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.root.rotation.y += d * (1 - Math.exp(-dt * 6));
      }
      this.move(dt, ctx);
      this.touchPlayer(ctx, 0.3);
    } else {
      this.vel.set(0, 0, 0);
    }
    this.pos.y = g;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.walk += dt * speed * 9;
    this.legs.forEach((l, i) => {
      const ph = this.walk + (i % 2) * Math.PI;
      l.rotation.x = Math.sin(ph) * 0.5 * Math.min(1, speed);
      l.rotation.y = Math.cos(ph) * 0.2 * Math.min(1, speed);
    });
    this.claws.forEach((c, i) => (c.rotation.x = Math.sin(ctx.time * 5 + i * 2) * 0.25 * this.reveal));
    this.body.position.y = lift + Math.abs(Math.sin(this.walk)) * 0.03 * Math.min(1, speed);
    this.blob.position.y = 0.03;
  }

  protected animateDeath(dt: number, ctx: ArenaCtx): void {
    this.body.scale.setScalar(Math.max(0.01, 1 - this.dying * 3));
    this.root.position.copy(this.pos);
    if (this.dying > 0.12 && !this.dead) {
      this.dead = true;
      ctx.puff(this.pos.clone().setY(this.pos.y + 0.3), PALETTE[this.biome].crab, 14, 'dust');
      ctx.puff(this.pos.clone().setY(this.pos.y + 0.3), 0xffd080, 10, 'spark');
    }
    void dt;
  }
}

// ───────────────────────────────────────────── Frost wisp (ice band)

/**
 * A little knot of cold light with a cute face and three ice shards orbiting it. Drifts in slow
 * figure-eights, then glides in and "chills" the farmer on contact (small damage + a 2.5 s slow),
 * and backs off. Floats at head height (a flier: passes over rocks and slimes).
 */
export class Wisp extends Monster {
  private body = new THREE.Group();
  private shards: THREE.Group;
  private halo: THREE.Points;
  private core: THREE.Mesh;
  private mode: 'drift' | 'glide' | 'back' = 'drift';
  private modeT = 0;
  private home: THREE.Vector2;
  private alt = 0.95;
  private pulse = 0;
  private trailT = 0;

  constructor(biome: Biome, x: number, z: number, tier: number, band: number, seed: number) {
    super('wisp', biome, x, z, tier, band, seed);
    const r = new Rng(seed);
    this.home = new THREE.Vector2(x, z);
    const coreMat = monsterMat(0xc8f0ff, { rough: 0.15, clearcoat: true, emissive: 0x4ab0e8, emissiveI: 0.5, rim: 0.9, rimColor: 0xe8fbff });
    this.mats.push(coreMat);
    const cg = lumpySphere(0.22, 2, 0.03, r, 2);
    smoothNormals(cg);
    this.core = new THREE.Mesh(cg, coreMat);
    this.core.scale.set(1, 1.08, 0.95);
    this.body.add(this.core);
    for (const sx of [-1, 1]) {
      const e = eye(0.055);
      e.position.set(sx * 0.075, 0.02, 0.18);
      this.body.add(e);
    }
    const blush = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.7 });
    for (const sx of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.CircleGeometry(0.03, 10), blush);
      b.position.set(sx * 0.13, -0.05, 0.19);
      b.rotation.y = sx * 0.4;
      this.body.add(b);
    }
    this.halo = glowPoint(0x6fc8f0, 1.3, 0.42);
    this.body.add(this.halo);
    this.shards = new THREE.Group();
    const iceMat = monsterMat(0xe8f8ff, { rough: 0.08, flat: true, emissive: 0x3a90c8, emissiveI: 0.8, rim: 0.8 });
    this.mats.push(iceMat);
    for (let k = 0; k < 3; k++) {
      const g = crystalPrism(0.045, 0.2 + r.next() * 0.08, 0.35);
      const m = new THREE.Mesh(g, iceMat);
      const a = (k / 3) * Math.PI * 2;
      m.position.set(Math.cos(a) * 0.36, (k - 1) * 0.06, Math.sin(a) * 0.36);
      m.rotation.set(r.next() * 0.6, r.next() * 6, 0.5 + r.next() * 0.4);
      m.castShadow = true;
      this.shards.add(m);
    }
    this.body.add(this.shards);
    this.body.position.y = this.alt;
    this.root.add(this.body);
    {
      // Draw-call diet (was 14 meshes): the three orbiting shards as one mesh (one shadow caster),
      // eyes + blush as one unlit mesh.
      const shardParts: THREE.Mesh[] = [];
      this.shards.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) shardParts.push(o as THREE.Mesh);
      });
      mergeParts(this.shards, shardParts, iceMat).castShadow = true;
      const face: THREE.Mesh[] = [];
      for (const c of [...this.body.children]) {
        if (c === this.core || c === this.shards || c === this.halo) continue;
        c.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) face.push(o as THREE.Mesh);
        });
      }
      mergeParts(this.body, face);
    }
    this.pulse = r.next() * 10;
  }

  override headPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pos).setY(this.pos.y + this.alt + 0.45);
  }

  protected override onHit(): void {
    this.mode = 'back';
    this.modeT = 0;
  }

  protected think(dt: number, ctx: ArenaCtx): void {
    const g = ctx.heightAt(this.pos.x, this.pos.z);
    const to = new THREE.Vector2(ctx.player.x - this.pos.x, ctx.player.z - this.pos.z);
    const dist = to.length();
    if (dist < 6.5) this.aggro = true;
    this.modeT += dt;
    const want = new THREE.Vector2();
    if (this.stun <= 0) {
      if (this.mode === 'drift') {
        const a = ctx.time * 0.6 + this.seed;
        want.set(this.home.x + Math.sin(a) * 1.6 - this.pos.x, this.home.y + Math.sin(a * 2) * 0.8 - this.pos.z).clampLength(0, 1).multiplyScalar(1.4);
        if (this.aggro && ctx.playerTargetable && this.modeT > 0.6) {
          this.mode = 'glide';
          this.modeT = 0;
        }
      } else if (this.mode === 'glide') {
        const side = new THREE.Vector2(-to.y, to.x).normalize().multiplyScalar(Math.sin(ctx.time * 2.2 + this.seed) * 0.9);
        want.copy(to).normalize().multiplyScalar(2.1).add(side);
        if (!ctx.playerTargetable) this.mode = 'drift';
        if (dist < this.radius + 0.42 && this.attackCooldown <= 0) {
          this.attackCooldown = 1.6;
          ctx.onAttack(this, this.damage);
          ctx.puff(new THREE.Vector3(ctx.player.x, g + 0.9, ctx.player.z), 0xcff4ff, 14, 'spark');
          this.mode = 'back';
          this.modeT = 0;
        }
      } else {
        want.copy(to).normalize().multiplyScalar(-2.4);
        if (this.modeT > 1.1) {
          this.mode = 'glide';
          this.modeT = 0;
        }
      }
      const k = 1 - Math.exp(-dt * 3);
      this.vel.x += (want.x - this.vel.x) * k;
      this.vel.z += (want.y - this.vel.z) * k;
    }
    this.move(dt, ctx, true);
    this.pos.y = g;
    this.animate(dt, ctx);
  }

  private animate(dt: number, ctx: ArenaCtx): void {
    this.pulse += dt;
    const bob = Math.sin(ctx.time * 2.4 + this.seed) * 0.1;
    this.body.position.y = this.alt + bob;
    this.shards.rotation.y += dt * (this.mode === 'glide' ? 3.2 : 1.6);
    const glow = 0.85 + 0.15 * Math.sin(this.pulse * 5);
    (this.halo.material as THREE.PointsMaterial).size = 1.25 * glow + (this.mode === 'glide' ? 0.2 : 0);
    this.core.scale.set(1 / Math.sqrt(glow), 1.08 * glow, 0.95);
    this.core.rotation.y = Math.sin(ctx.time * 1.3 + this.seed) * 0.3;
    this.blob.position.y = 0.03;
    this.blob.scale.setScalar(this.radius * 0.9);
    (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.18;
    this.trailT -= dt;
    if (this.trailT <= 0 && Math.hypot(this.vel.x, this.vel.z) > 0.6) {
      this.trailT = 0.16;
      ctx.puff(this.pos.clone().setY(this.pos.y + this.alt + bob), 0xbfefff, 1, 'spark');
    }
  }

  protected override pose(dt: number, ctx: ArenaCtx): void {
    this.pos.y = ctx.heightAt(this.pos.x, this.pos.z);
    this.animate(dt, ctx);
  }

  protected animateDeath(dt: number, ctx: ArenaCtx): void {
    const t = this.dying;
    this.body.scale.setScalar(1 + t * 2.5);
    this.shards.rotation.y += dt * 12;
    (this.halo.material as THREE.PointsMaterial).opacity = Math.max(0, 0.75 - t * 3);
    this.root.position.copy(this.pos);
    if (t > 0.22 && !this.dead) {
      this.dead = true;
      const p = this.pos.clone().setY(this.pos.y + this.alt);
      ctx.puff(p, 0xdff6ff, 24, 'spark');
      ctx.puff(p, 0xe8f4ff, 10, 'dust');
    }
  }
}

// ───────────────────────────────────────────── Cinder imp (lava band)

/**
 * A soot-black imp with a glowing belly, stubby horns and a flame tuft. Keeps 3.5–5 m away,
 * strafes, and every couple of seconds winds up (belly and flame flare, squash) and lobs a fireball
 * at where the farmer stands. Fireballs can be dodged — or cut out of the air with the sword.
 */
export class Imp extends Monster {
  private body = new THREE.Group();
  private belly: THREE.Object3D;
  private flame: THREE.Mesh;
  private legs: THREE.Group[] = [];
  private tail: THREE.Group;
  private windup = -1;
  private fireCd: number;
  private strafe = 1;
  private strafeT = 0;
  private hop = 0;
  private sy = 1;
  private vy = 0;

  constructor(biome: Biome, x: number, z: number, tier: number, band: number, seed: number) {
    super('imp', biome, x, z, tier, band, seed);
    const r = new Rng(seed);
    const skin = monsterMat(0x4a1e18, { rough: 0.55, emissive: 0x2a0600, emissiveI: 1, rim: 0.7, rimColor: 0xff8a3a });
    this.mats.push(skin);
    const bg = lumpySphere(0.27, 2, 0.04, r, 2);
    smoothNormals(bg);
    const bodyM = new THREE.Mesh(bg, skin);
    bodyM.scale.set(1, 0.95, 0.92);
    bodyM.position.y = 0.36;
    bodyM.castShadow = true;
    this.body.add(bodyM);
    const bellyMat = monsterMat(0xff8a2a, { rough: 0.4, emissive: 0xff6a10, emissiveI: 1.6, rim: 0.3 });
    this.mats.push(bellyMat);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), bellyMat);
    belly.scale.set(1, 1.1, 0.5);
    belly.position.set(0, 0.3, 0.19);
    this.body.add(belly);
    this.belly = belly;
    const hornMat = monsterMat(0xefe0c0, { rough: 0.5, rim: 0.3 });
    this.mats.push(hornMat);
    for (const sx of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 7), hornMat);
      h.position.set(sx * 0.14, 0.6, 0.02);
      h.rotation.z = -sx * 0.5;
      this.body.add(h);
      const e = eye(0.05, 0xffd84a);
      e.position.set(sx * 0.085, 0.45, 0.22);
      this.body.add(e);
      const leg = new THREE.Group();
      leg.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.1, 3, 6), skin));
      leg.position.set(sx * 0.12, 0.1, 0);
      this.legs.push(leg);
      this.body.add(leg);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.12, 3, 6), skin);
      arm.position.set(sx * 0.27, 0.32, 0.04);
      arm.rotation.z = sx * 0.7;
      this.body.add(arm);
    }
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb040).multiplyScalar(2.2), transparent: true, opacity: 0.95 });
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 8), flameMat);
    this.flame.position.set(0, 0.72, -0.02);
    this.body.add(this.flame);
    this.tail = new THREE.Group();
    const tailSeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.28, 3, 6), skin);
    tailSeg.rotation.x = -1.0;
    tailSeg.position.set(0, 0.12, -0.14);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 4), bellyMat);
    tip.position.set(0, 0.25, -0.3);
    tip.rotation.x = -0.6;
    this.tail.add(tailSeg, tip);
    this.tail.position.set(0, 0.18, -0.12);
    this.body.add(this.tail);
    this.root.add(this.body);
    {
      // Draw-call diet (was 14 meshes): soot skin + horns + limbs + tail as ONE rigidly skinned
      // mesh (legs / tail keep animating), the glowing belly + tail tip as another, eyes merged.
      const skinV = monsterMat(0xffffff, { rough: 0.55, emissive: 0x2a0600, emissiveI: 1, rim: 0.7, rimColor: 0xff8a3a });
      skinV.vertexColors = true;
      this.mats.push(skinV);
      const pivot = new THREE.Group();
      pivot.position.copy(this.belly.position);
      this.body.add(pivot);
      belly.removeFromParent();
      belly.position.set(0, 0, 0);
      pivot.add(belly);
      const bones: THREE.Object3D[] = [...this.legs, this.tail, pivot];
      const lit: THREE.Mesh[] = [];
      const hot: THREE.Mesh[] = [];
      const face: THREE.Mesh[] = [];
      this.body.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m === this.flame) return;
        if (m.material === skin || m.material === hornMat) lit.push(m);
        else if (m.material === bellyMat) hot.push(m);
        else face.push(m);
      });
      const sk = rigidSkin(this.body, bones, lit, skinV);
      sk.castShadow = true;
      rigidSkin(this.body, bones, hot, bellyMat);
      mergeParts(this.body, face);
      // The belly flare now scales its pivot (the skinned belly follows).
      this.belly = pivot;
    }
    this.fireCd = 1.2 + r.next() * 1.5;
  }

  override headPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pos).setY(this.pos.y + 0.95);
  }

  protected override onHit(): void {
    this.windup = -1;
    this.vy -= 4;
  }

  protected think(dt: number, ctx: ArenaCtx): void {
    const g = ctx.heightAt(this.pos.x, this.pos.z);
    const to = new THREE.Vector2(ctx.player.x - this.pos.x, ctx.player.z - this.pos.z);
    const dist = to.length();
    if (dist < 7.5) this.aggro = true;
    this.fireCd -= dt;
    if (this.stun <= 0 && this.aggro && ctx.playerTargetable) {
      const dir = to.clone().normalize();
      // Keep range: back off inside 3.5 m, close in beyond 5 m, strafe in between.
      const range = dist < 3.4 ? -1 : dist > 5 ? 1 : 0;
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafe = -this.strafe;
        this.strafeT = 1 + ctx.rng.next();
      }
      const want = dir.clone().multiplyScalar(range * 1.8).add(new THREE.Vector2(-dir.y, dir.x).multiplyScalar(this.strafe * (this.windup >= 0 ? 0 : 1.1)));
      const k = 1 - Math.exp(-dt * 5);
      this.vel.x += (want.x - this.vel.x) * k;
      this.vel.z += (want.y - this.vel.z) * k;
      this.root.rotation.y += (Math.atan2(to.x, to.y) - this.root.rotation.y) * (1 - Math.exp(-dt * 8));
      if (this.windup < 0 && this.fireCd <= 0 && dist < 7) this.windup = 0;
      if (this.windup >= 0) {
        this.windup += dt;
        if (this.windup > 0.5) {
          this.windup = -1;
          this.fireCd = 2.2 + ctx.rng.next() * 0.8;
          this.vy += 5;
          const from = this.pos.clone().setY(g + 0.55).addScaledVector(new THREE.Vector3(dir.x, 0, dir.y), 0.3);
          ctx.shoot?.(this, from, new THREE.Vector3(dir.x, 0, dir.y), this.damage);
        }
      }
    } else {
      this.vel.x *= Math.exp(-dt * 6);
      this.vel.z *= Math.exp(-dt * 6);
    }
    this.move(dt, ctx);
    this.pos.y = g;
    this.animate(dt, ctx);
    this.touchPlayer(ctx, 0.25);
  }

  private animate(dt: number, ctx: ArenaCtx): void {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.hop += dt * (4 + speed * 3);
    const hopY = Math.abs(Math.sin(this.hop * Math.PI)) * 0.08 * Math.min(1, speed + 0.3);
    const target = this.windup >= 0 ? 0.8 : 1;
    this.vy += (-(this.sy - target) * 160 - this.vy * 10) * dt;
    this.sy += this.vy * dt;
    const sy = THREE.MathUtils.clamp(this.sy, 0.6, 1.4);
    this.body.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
    this.body.position.y = hopY;
    const w = this.windup >= 0 ? Math.min(1, this.windup / 0.5) : 0;
    this.flame.scale.set(1 + w * 0.6 + Math.sin(ctx.time * 20 + this.seed) * 0.08, 1 + w * 0.9 + Math.sin(ctx.time * 15) * 0.15, 1 + w * 0.6);
    this.belly.scale.set(1 + w * 0.25, 1 + w * 0.23, 1);
    this.legs.forEach((l, i) => (l.rotation.x = Math.sin(this.hop * Math.PI + i * Math.PI) * 0.5 * Math.min(1, speed)));
    this.tail.rotation.y = Math.sin(ctx.time * 4 + this.seed) * 0.5;
    this.blob.position.y = 0.03;
  }

  protected override pose(dt: number, ctx: ArenaCtx): void {
    this.pos.y = ctx.heightAt(this.pos.x, this.pos.z);
    this.animate(dt, ctx);
  }

  protected animateDeath(dt: number, ctx: ArenaCtx): void {
    this.body.scale.setScalar(Math.max(0.01, 1 - this.dying * 3.5));
    this.body.rotation.y += dt * 20;
    this.root.position.copy(this.pos);
    if (this.dying > 0.2 && !this.dead) {
      this.dead = true;
      const p = this.pos.clone().setY(this.pos.y + 0.4);
      ctx.puff(p, 0xffa040, 22, 'spark');
      ctx.puff(p, 0x3a2a28, 12, 'dust');
    }
  }
}

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

export function createMonster(kind: MonsterKind, biome: Biome, x: number, z: number, tier: number, band: number, seed: number): Monster {
  switch (kind) {
    case 'slime':
      return new Slime(biome, x, z, tier, band, seed);
    case 'bat':
      return new Bat(biome, x, z, tier, band, seed);
    case 'crab':
      return new Crab(biome, x, z, tier, band, seed);
    case 'wisp':
      return new Wisp(biome, x, z, tier, band, seed);
    case 'imp':
      return new Imp(biome, x, z, tier, band, seed);
  }
}

/** Colour of a monster's drop puff / goo (for the arena's particle hooks). */
export function monsterColor(kind: MonsterKind, biome: Biome): number {
  const p = PALETTE[biome];
  return kind === 'slime' ? p.slime : kind === 'bat' ? p.bat : kind === 'wisp' ? 0xbfefff : kind === 'imp' ? 0xff7a2a : p.crab;
}
