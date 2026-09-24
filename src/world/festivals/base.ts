/**
 * FestivalMap: shared scaffolding for the four seasonal festival grounds. Each festival is its own
 * small hand-dressed map (terrain + splat, grass, trees, nature, merged static props, a GPU crowd,
 * practical lights, glow points and effects) built once on first visit.
 *
 * Subclasses implement the shape (`height`, `paint`, `grassDensity`) and the dressing (`dress`),
 * then per-frame `tick` and the showcase `stage` (the beauty moment critics / demos capture).
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import type { Rng } from '../../core/rng';
import { Noise2D } from '../../core/noise';
import type { Facing } from '../../core/events';
import type { Season, Weather } from '../../core/time';
import type { GameMap, MapWarp } from '../map';
import { TileGrid, TileType, TileFlag } from '../tiles';
import { Terrain, type TerrainOptions } from '../terrain';
import { GrassField } from '../grass';
import { TreeField, type TreeSpecies } from '../props/trees';
import { Nature } from '../props/nature';
import { mergeStatic } from '../geom';
import { SmokeEmitter, Ambience, FireFX, BurstFX } from '../../render/particles';
import type { ActivityId } from '../../data/festivals';
import type { ActionPose, PlayerRig } from '../../entities/player';
import { LightPools } from '../props/decals';
import type { BuiltProp } from '../props/structures';
import { Crowd, Anim, type CrowdSpec } from './crowd';
import { GlowPoints, type GlowPoint } from './fx';
import { buildRosette } from './kit';
import { RemoteFarmer } from '../../entities/remote-farmer';
import { coopVisitors } from '../../data/festivals';
import { NPCS } from '../../data/npcs';
import type { CoopRace } from './coop';

export interface FestivalMapDef {
  id: string;
  title: string;
  size: { w: number; d: number };
  extent: { minX: number; minZ: number; maxX: number; maxZ: number };
  spawn: { x: number; z: number; facing: Facing };
  bounds: [number, number, number, number];
  terrain?: Partial<Pick<TerrainOptions, 'pathTexture' | 'pathScale' | 'waterLevel'>>;
  warps?: MapWarp[];
}

export interface Updatable {
  update(dt: number, game: Game, viewportH: number): void;
}

/**
 * A mini-game in progress. The overlay (games.ts) writes input + progress, the map reads it every
 * frame to stage the 3D side (racers, partner, skater, lanterns) and writes back what only the
 * world knows (skate: stars collected).
 */
export interface PlayState {
  id: ActivityId;
  /** Seconds since the mini-game began (render clock). */
  t: number;
  /** Villager partner / recipient id (dance, gift swap). */
  partner?: string;
  /** Steering input -1..1 (skate) and boost. */
  steer: number;
  boost: boolean;
  /** Per-racer progress 0..1 (sack race: [player, npc…]); skate: [progress along the river]. */
  progress: number[];
  /** Score counters (skate: stars collected / total). */
  score: number;
  total: number;
  /** Beat clock (dance), 0..n. */
  beat: number;
  /** Player hop / pose phase (0..1 per hop) — sack race. */
  hop: number;
  /** Set by the overlay when the game has started (after the countdown). */
  live: boolean;
  done: boolean;
  /** Free-form counters the map reports back to the HUD (skate: laps, gates, cracks, combo…). */
  stats: Record<string, number>;
  /** Sack race: lane per racer (racer 0 = you) and who each racer is (co-op farmers race too). */
  lanes?: number[];
  kinds?: ('me' | 'npc' | 'farmer')[];
  /** Co-op race shared with other farmers (null / absent = solo). */
  coop?: CoopRace | null;
}

/** Activity trigger spot: interacting within `r` starts the host's activity. */
export interface ActivitySpot {
  id: ActivityId;
  x: number;
  z: number;
  r: number;
}

export abstract class FestivalMap implements GameMap {
  readonly id: string;
  readonly title: string;
  readonly grid: TileGrid;
  readonly root = new THREE.Group();
  readonly spawn: { x: number; z: number; facing: Facing };
  readonly cameraBounds: THREE.Box2;
  terrain!: Terrain;
  grass!: GrassField;
  readonly warps: MapWarp[];
  readonly poi: Record<string, { x: number; y?: number; z: number; rot?: number }[]> = {};
  crowd: Crowd | null = null;
  /** Named villagers' crowd indices (for talking / mini-games). */
  readonly named = new Map<string, number>();
  protected rng: Rng;
  protected noise: Noise2D;
  protected trees!: TreeField;
  protected nature!: Nature;
  protected staticRoots: THREE.Object3D[] = [];
  protected pools = new LightPools();
  protected smoke: SmokeEmitter[] = [];
  protected fires: THREE.Vector3[] = [];
  protected fire: FireFX | null = null;
  protected ambience!: Ambience;
  protected glowList: GlowPoint[] = [];
  protected glow: GlowPoints | null = null;
  protected crowdSpecs: CrowdSpec[] = [];
  protected fx: Updatable[] = [];
  protected lights: { light: THREE.PointLight; max: number; seed: number; flicker: number }[] = [];
  protected season: Season = 'spring';
  protected staged = false;
  /** One-shot sparkle / petal / confetti bursts (mini-game juice). */
  protected bursts = new BurstFX(700);
  /** Activity trigger spots (see ActivitySpot). */
  readonly activitySpots: ActivitySpot[] = [];
  /** Mini-game in progress, if any. */
  play: PlayState | null = null;
  private prevPose: ((rig: PlayerRig, dt: number) => ActionPose | null) | null = null;
  private camGoal: { pitch: number; distance: number; yaw: number; ox: number; oz: number } | null = null;
  private camSaved: { pitch: number; distance: number; yaw: number; ox: number; oz: number } | null = null;
  private camRelease = 0;
  private poseFn: ((rig: PlayerRig, dt: number) => ActionPose | null) | null = null;
  /** Seconds since the showcase / festival started (render clock). */
  protected showT = 0;
  /** Confetti colours for win celebrations (per festival). */
  protected confettiColors = [0xf2b928, 0xe8574a, 0x3f8fd0, 0x6ab04a, 0xffffff];
  /** Crowd members cheering a win (restored to their own clip when it ends). */
  private winCheer: { i: number; anim: number }[] = [];
  private cheerUntil = 0;
  /** The prize ribbon pinned to the player's chest after a win (until they leave the grounds). */
  private pin: THREE.Group | null = null;
  /** Where visiting co-op farmers stand (by the activities) when staged with `&coop=1`. */
  protected visitorSpots: { x: number; z: number; yaw: number }[] = [];
  private visitors: { f: RemoteFarmer; x: number; z: number; yaw: number; seed: number }[] = [];

  constructor(protected game: Game, protected def: FestivalMapDef) {
    this.id = def.id;
    this.title = def.title;
    this.grid = new TileGrid(def.size.w, def.size.d);
    this.spawn = { ...def.spawn };
    this.cameraBounds = new THREE.Box2(new THREE.Vector2(def.bounds[0], def.bounds[1]), new THREE.Vector2(def.bounds[2], def.bounds[3]));
    this.warps = def.warps ?? [];
    this.root.name = `map:${def.id}`;
    this.rng = game.rng.fork(def.id);
    this.noise = new Noise2D(this.rng.fork('n').seed);
  }

  // ───────────────────────────────────────────── subclass hooks
  protected abstract height(x: number, z: number): number;
  protected abstract paint(): void;
  protected abstract grassDensity(x: number, z: number): number;
  protected abstract dress(): void;
  protected grassTallness(x: number, z: number): number {
    return 0.15 + 0.35 * THREE.MathUtils.smoothstep(this.noise.fbm(x * 0.09, z * 0.09, 2), 0.1, 0.6);
  }
  /** Extra blockers (water, cliffs…) on top of the slope rule. */
  protected tileBlocked(_x: number, _z: number): boolean {
    return false;
  }
  protected tileType(x: number, z: number): TileType {
    return this.terrain.splatAt(x, z, 'path') > 0.5 ? TileType.Stone : this.terrain.splatAt(x, z, 'sand') > 0.5 ? TileType.Sand : TileType.Grass;
  }
  /** Per-frame life (runs while paused too). */
  protected tick(_dt: number, _game: Game): void {}
  /** Stage the showcase moment. */
  stage(): void {
    this.staged = true;
    this.showT = 0;
  }

  /** Heavy construction, called once by the factory right after `new`. */
  build(): this {
    const e = this.def.extent;
    this.terrain = new Terrain({ ...e, step: 0.5, height: (x, z) => this.height(x, z), waterLevel: this.def.terrain?.waterLevel ?? -5, pathTexture: this.def.terrain?.pathTexture, pathScale: this.def.terrain?.pathScale });
    this.terrain.mesh.userData.perfTag = 'terrain';
    this.root.add(this.terrain.mesh);
    this.paint();
    this.terrain.commitSplat();
    this.classifyTiles();
    this.trees = new TreeField(this.rng.fork('trees'));
    this.nature = new Nature(this.rng.fork('nature'));
    this.dress();
    this.terrain.commitCover();
    this.trees.finalize();
    this.nature.finalize();
    this.trees.group.userData.perfTag = 'trees';
    this.nature.group.userData.perfTag = 'nature';
    this.root.add(this.trees.group, this.nature.group, this.pools.group);
    const merged = mergeStatic(this.staticRoots, `${this.id}-static`);
    merged.userData.perfTag = 'festival';
    // Only the chunky architecture takes GTAO; small / thin dressing skips the AO pass.
    merged.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = (m.material as THREE.Material).name;
      if (!['wood', 'woodGrain', 'stone', 'plaster', 'roofTile', 'thatch', 'roof', 'rock'].includes(name)) m.userData.noAO = true;
    });
    this.root.add(merged);
    this.grass = new GrassField({
      bounds: { x0: e.minX + 8, z0: e.minZ + 8, x1: e.maxX - 8, z1: e.maxZ - 8 },
      density: (x, z) => this.grassDensity(x, z),
      tallness: (x, z) => this.grassTallness(x, z),
      height: (x, z) => this.terrain.heightAt(x, z),
      seed: `${this.id}-grass`,
      densityScale: this.game.rc.preset.grassDensity,
      cover: this.terrain,
    });
    this.grass.group.userData.perfTag = 'grass';
    this.root.add(this.grass.group);
    this.ambience = new Ambience((x, z) => this.terrain.heightAt(x, z));
    this.root.add(this.ambience.group);
    if (this.crowdSpecs.length) {
      this.separateCrowd();
      this.crowd = new Crowd(this.crowdSpecs, (x, z) => this.terrain.heightAt(x, z), `${this.id}-crowd`);
      this.crowdSpecs.forEach((s, i) => {
        if (s.id) this.named.set(s.id, i);
        if (!s.lift) this.terrain.stampCover('ao', s.x, s.z, 0.45, 0.35);
      });
      this.root.add(this.crowd.mesh);
    }
    if (this.fires.length) {
      this.fire = new FireFX(this.fires);
      this.root.add(this.fire.object);
    }
    if (this.glowList.length) {
      this.glow = new GlowPoints(this.glowList, `${this.id}-glow`);
      this.root.add(this.glow.points);
    }
    this.bursts.object.userData.perfTag = 'festival';
    this.bursts.object.userData.noAO = true;
    this.root.add(this.bursts.object);
    this.terrain.commitCover();
    if (new URLSearchParams(location.search).has('coop')) this.stageVisitors();
    return this;
  }

  /**
   * Demo co-op staging: the two visiting farmers from the festival board, standing at the activity
   * spots in their own looks with colour name tags (the real net layer drives its own farmers).
   */
  private stageVisitors(): void {
    const names = Object.entries(NPCS).flatMap(([id, n]) => [id, n.name.split(/\s+/)[0]!]);
    coopVisitors(names).forEach((v, k) => {
      const spot = this.visitorSpots[k];
      if (!spot) return;
      const f = new RemoteFarmer(v.look);
      f.position.set(spot.x, this.heightAt(spot.x, spot.z), spot.z);
      f.yaw = f.targetYaw = spot.yaw;
      f.root.add(nameTag(v.name, v.color));
      this.root.add(f.root);
      this.visitors.push({ f, x: spot.x, z: spot.z, yaw: spot.yaw, seed: k * 2.7 });
    });
  }

  // ───────────────────────────────────────────── helpers

  /**
   * Relax the staged crowd so nobody stands inside anybody else: standing members closer than
   * ~0.65 m (scaled by size; children count smaller) are pushed apart, named villagers move less,
   * anyone seated / lifted / on a scripted path (skaters, racers, maypole dancers) stays put, and a
   * push never lands someone on a blocked tile.
   */
  protected separateCrowd(minD = 0.66): void {
    const S = this.crowdSpecs;
    const pinned = new Set<string>(['skate', 'sack', 'ribbonR', 'ribbonL', 'perch', 'sit']);
    const w = S.map((s) => (s.lift || s.pinned || pinned.has(s.anim) ? 0 : s.id ? 0.35 : 1));
    const r = S.map((s) => minD * 0.5 * Math.max(0.75, s.look.scale) * (0.9 + 0.1 * s.look.build));
    for (let it = 0; it < 16; it++) {
      let moved = false;
      for (let i = 0; i < S.length; i++) {
        for (let j = i + 1; j < S.length; j++) {
          const a = S[i]!;
          const b = S[j]!;
          const wa = w[i]!;
          const wb = w[j]!;
          if (!wa && !wb) continue;
          if (Math.abs((a.lift ?? 0) - (b.lift ?? 0)) > 0.6) continue;
          let dx = b.x - a.x;
          let dz = b.z - a.z;
          let d = Math.hypot(dx, dz);
          const need = r[i]! + r[j]!;
          if (d >= need) continue;
          if (d < 1e-4) {
            dx = Math.cos(i * 2.4);
            dz = Math.sin(i * 2.4);
            d = 1;
          }
          const push = (need - d) / (wa + wb);
          const ax = a.x - (dx / d) * push * wa;
          const az = a.z - (dz / d) * push * wa;
          const bx = b.x + (dx / d) * push * wb;
          const bz = b.z + (dz / d) * push * wb;
          if (wa && this.grid.isWalkable(Math.floor(ax), Math.floor(az))) [a.x, a.z] = [ax, az];
          if (wb && this.grid.isWalkable(Math.floor(bx), Math.floor(bz))) [b.x, b.z] = [bx, bz];
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  protected H(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  protected classifyTiles(): void {
    const g = this.grid;
    g.forEach((x, z, i) => {
      const cx = x + 0.5;
      const cz = z + 0.5;
      g.height[i] = this.terrain.heightAt(cx, cz);
      if (this.terrain.slopeAt(cx, cz) < 0.8 || this.tileBlocked(cx, cz)) {
        g.type[i] = TileType.Cliff;
        g.flags[i] = TileFlag.Blocked;
        return;
      }
      g.type[i] = this.tileType(cx, cz);
    });
  }

  /** Place a prop on the ground. Static props are merged; `solidR` blocks tiles within a radius. */
  protected addProp(p: BuiltProp | THREE.Group, x: number, z: number, rot = 0, o: { solidR?: number; solidRect?: [number, number]; dynamic?: boolean; ao?: number; y?: number; lights?: 'pools' | 'none' | 'glow' } = {}): BuiltProp {
    const bp: BuiltProp = p instanceof THREE.Group ? { group: p, lights: [], anchors: {} } : p;
    bp.group.position.set(x, o.y ?? this.terrain.heightAt(x, z) - 0.03, z);
    bp.group.rotation.y = rot;
    this.root.add(bp.group);
    if (!o.dynamic) this.staticRoots.push(bp.group);
    bp.group.updateMatrixWorld(true);
    for (const l of bp.lights) {
      // Props' practical lamps become glow sprites + light pools (point lights are budgeted per map).
      const wp = l.light.getWorldPosition(new THREE.Vector3());
      l.light.removeFromParent();
      if (o.lights !== 'none') {
        this.glowList.push({ x: wp.x, y: wp.y, z: wp.z, color: 0xffb45e, size: 0.9, twinkle: 0.05 });
        // 'glow' = the lamp halo only (no warm pool decal, e.g. lamps over ice / water).
        if (o.lights !== 'glow') this.pools.add(wp.x, wp.z, this.terrain.heightAt(wp.x, wp.z), Math.min(3.2, 1.4 + wp.y - this.terrain.heightAt(wp.x, wp.z)));
      }
    }
    if (o.solidR) this.blockCircle(x, z, o.solidR);
    if (o.solidRect) this.blockRect(x, z, o.solidRect[0], o.solidRect[1], rot);
    if (o.ao) this.terrain.stampCover('ao', x, z, o.ao, 0.6);
    return bp;
  }

  protected blockCircle(x: number, z: number, r: number): void {
    for (let tz = Math.floor(z - r - 1); tz <= Math.ceil(z + r + 1); tz++) {
      for (let tx = Math.floor(x - r - 1); tx <= Math.ceil(x + r + 1); tx++) {
        if (!this.grid.inBounds(tx, tz)) continue;
        if (Math.hypot(tx + 0.5 - x, tz + 0.5 - z) < r) this.grid.setFlag(tx, tz, TileFlag.Blocked);
      }
    }
  }

  /** Block an oriented rectangle (w × d) centred at x, z. */
  protected blockRect(x: number, z: number, w: number, d: number, rot = 0): void {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const R = Math.hypot(w, d) / 2 + 1;
    for (let tz = Math.floor(z - R); tz <= Math.ceil(z + R); tz++) {
      for (let tx = Math.floor(x - R); tx <= Math.ceil(x + R); tx++) {
        if (!this.grid.inBounds(tx, tz)) continue;
        const dx = tx + 0.5 - x;
        const dz = tz + 0.5 - z;
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        if (Math.abs(lx) < w / 2 && Math.abs(lz) < d / 2) this.grid.setFlag(tx, tz, TileFlag.Blocked);
      }
    }
  }

  protected addTree(sp: TreeSpecies, x: number, z: number, s = 1, lod = 0, solid = true): void {
    this.trees.add(sp, x, this.terrain.heightAt(x, z) - 0.06, z, s, undefined, lod);
    if (solid) this.blockCircle(x, z, 0.6 * s);
    if (lod === 0) this.terrain.stampCover('ao', x, z, 1.0 * s, 0.6);
  }

  protected addLight(x: number, y: number, z: number, color: number, max: number, flicker = 0, distance = 9): THREE.PointLight {
    const l = new THREE.PointLight(color, 0, distance, 1.6);
    l.position.set(x, y, z);
    this.root.add(l);
    this.lights.push({ light: l, max, seed: Math.random() * 10, flicker });
    return l;
  }

  protected addSmoke(p: THREE.Vector3, rate = 3.5): void {
    const s = new SmokeEmitter(p, rate);
    this.smoke.push(s);
    this.root.add(s.object);
  }

  protected glowPt(x: number, y: number, z: number, color: number, size: number, twinkle = 0, day = 0): void {
    this.glowList.push({ x, y, z, color, size, twinkle, day });
  }

  // ───────────────────────────────────────────── GameMap

  heightAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  clearGroundCover(x: number, z: number): void {
    this.grass.clearTile(x, z);
  }

  /** Light multiplier (0 by day .. 1 at night) — festival practicals come on early. */
  protected lampLevel(game: Game): number {
    return Math.max(0.2, game.lighting.night, THREE.MathUtils.smoothstep(game.calendar.hour, 17.5, 19.5));
  }

  update(dt: number, game: Game): void {
    this.showT += dt;
    const h = game.rc.renderer.domElement.height;
    this.pools.update();
    this.grass.update(game.rc.rig.focus);
    for (const s of this.smoke) s.update(dt, game.lighting.night, h);
    this.ambience.update(dt, game.time, game.rc.rig.focus, game.lighting.night, h);
    this.fire?.update(dt, h);
    this.glow?.setViewportHeight(h);
    const lamps = this.lampLevel(game);
    for (const f of this.lights) {
      const flick = f.flicker ? 1 - f.flicker * (0.5 + 0.3 * Math.sin(game.time * 13 + f.seed) + 0.2 * Math.sin(game.time * 31 + f.seed * 3)) : 1;
      f.light.intensity = f.max * lamps * flick;
    }
    for (const f of this.fx) f.update(dt, game, h);
    this.bursts.update(dt, h);
    for (const v of this.visitors) {
      // Shuffle on the spot now and then, glance at the player.
      const p = game.player.position;
      const look = Math.atan2(p.x - v.x, p.z - v.z);
      const t = game.time * 0.25 + v.seed;
      v.f.targetYaw = Math.sin(t) > 0.3 ? look : v.yaw;
      v.f.update(dt, game.time);
    }
    if (this.play) this.play.t += dt;
    if (this.winCheer.length && this.showT > this.cheerUntil) {
      const c = this.crowd;
      if (c) {
        for (const k of this.winCheer) c.members[k.i]!.anim = k.anim;
        c.commit();
      }
      this.winCheer = [];
    }
    if (this.camGoal) {
      const r = game.rc.rig;
      const k = 1 - Math.exp(-2.6 * dt);
      const g = this.camGoal;
      r.pitch += (g.pitch - r.pitch) * k;
      r.distance += (g.distance - r.distance) * k;
      r.yaw += (g.yaw - r.yaw) * k;
      r.lookOffset.x += (g.ox - r.lookOffset.x) * k;
      r.lookOffset.z += (g.oz - r.lookOffset.z) * k;
      if (this.camRelease > 0 && (this.camRelease -= dt) <= 0) this.camGoal = null;
    }
    this.tick(dt, game);
  }

  // ───────────────────────────────────────────── mini-games

  /** Emit a one-shot burst (sparkles, petals, confetti). */
  burst(x: number, y: number, z: number, o: { color: number; count?: number; speed?: number; size?: number; gravity?: number; life?: number; up?: number; spread?: number }): void {
    this.bursts.emit(new THREE.Vector3(x, y, z), o);
  }

  /** World position of a crowd member (feet). */
  memberPos(i: number): THREE.Vector3 {
    const m = this.crowd?.members[i];
    return m ? new THREE.Vector3(m.x, m.y, m.z) : new THREE.Vector3();
  }

  /** Nearest named villager within `r` of (x, z). */
  nearestNamed(x: number, z: number, r: number): { id: string; i: number; d: number } | null {
    let best: { id: string; i: number; d: number } | null = null;
    for (const [id, i] of this.named) {
      const m = this.crowd?.members[i];
      if (!m) continue;
      const d = Math.hypot(m.x - x, m.z - z);
      if (d < r && (!best || d < best.d)) best = { id, i, d };
    }
    return best;
  }

  /** Turn a crowd member to face a point (talking) and optionally change their clip. */
  faceMember(i: number, x: number, z: number, anim?: Parameters<Crowd['setAnim']>[1]): void {
    const c = this.crowd;
    const m = c?.members[i];
    if (!c || !m) return;
    m.yaw = Math.atan2(x - m.x, z - m.z);
    if (anim) c.setAnim(i, anim);
    c.commit();
  }

  /** Ease the camera to a mini-game framing (restored by endPlay). */
  protected frame(o: { pitch?: number; distance?: number; yaw?: number; ox?: number; oz?: number }): void {
    const r = this.game.rc.rig;
    this.camSaved ??= { pitch: r.pitch, distance: r.distance, yaw: r.yaw, ox: r.lookOffset.x, oz: r.lookOffset.z };
    this.camGoal = { pitch: o.pitch ?? r.pitch, distance: o.distance ?? r.distance, yaw: o.yaw ?? r.yaw, ox: o.ox ?? 0, oz: o.oz ?? 0 };
    this.camRelease = 0;
  }

  /** Update the live mini-game framing (camera look offset + distance) without saving it again. */
  protected reframe(ox: number, oz: number, distance?: number): void {
    const g = this.camGoal;
    if (!g) return;
    g.ox = ox;
    g.oz = oz;
    if (distance !== undefined) g.distance = distance;
  }

  /** Put the player somewhere for a mini-game (snaps height, faces `facing`). */
  protected placePlayer(x: number, z: number, facing?: Facing, y?: number): void {
    const p = this.game.player;
    p.teleport(x, z);
    if (y !== undefined) {
      p.position.y = y;
      p.root.position.y = y;
    }
    if (facing) p.setFacing(facing);
  }

  /** Slide the player (mini-games drive x / z directly); keeps the rig in sync this frame. */
  protected movePlayer(x: number, z: number, y = this.heightAt(x, z)): void {
    const p = this.game.player;
    p.position.set(x, y, z);
    p.root.position.copy(p.position);
  }

  /** Start a mini-game: stages the 3D side and takes over the player's pose. */
  beginPlay(id: ActivityId, partner?: string): PlayState {
    this.play = { id, t: 0, partner, steer: 0, boost: false, progress: [], score: 0, total: 0, beat: 0, hop: 0, live: false, done: false, stats: {} };
    const p = this.game.player;
    this.prevPose = p.actionPose;
    this.poseFn = (rig, dt) => (this.play ? this.playerPose(rig, this.play, dt) : null) ?? this.prevPose?.(rig, dt) ?? null;
    p.actionPose = this.poseFn;
    this.onBeginPlay(this.play);
    return this.play;
  }

  /** A moment in the mini-game worth staging (hit, miss, release, finish, win / lose…). */
  playEvent(kind: string, value = 0): void {
    if (!this.play) return;
    if (kind === 'win') this.celebrate(value);
    else if (kind === 'lose') {
      // No ribbon: a little grey sigh-cloud puffs over your head; the crowd claps politely.
      const p = this.game.player.position;
      this.burst(p.x, p.y + 2.3, p.z, { color: 0xb8c0cc, count: 10, speed: 0.5, size: 0.22, gravity: -0.2, life: 1.8, up: 0.3, spread: 0.25 });
    }
    this.onPlayEvent(this.play, kind, value);
  }

  /**
   * A win: everyone standing nearby jumps up cheering (5 s), confetti cannons pop around the player
   * and the prize ribbon (1st gold / 2nd blue / 3rd red) is pinned to their chest.
   */
  protected celebrate(place: number): void {
    const p = this.game.player.position;
    const c = this.crowd;
    if (c) {
      // Keep clips whose staging depends on them (skaters, racers, maypole ribbons, the seated).
      const keep = new Set([Anim.skate, Anim.sack, Anim.ribbonR, Anim.ribbonL, Anim.sit, Anim.perch, Anim.fiddle, Anim.ride]);
      c.members.forEach((m, i) => {
        if (keep.has(m.anim as never) || Math.hypot(m.x - p.x, m.z - p.z) > 18 || this.winCheer.some((k) => k.i === i)) return;
        this.winCheer.push({ i, anim: m.anim });
        m.anim = (i * 7) % 5 === 0 ? Anim.clap : Anim.cheer;
      });
      c.commit();
    }
    this.cheerUntil = this.showT + 5;
    for (const v of this.visitors) v.f.emote(place === 0 ? 'heart' : 'happy', 3);
    const cols = this.confettiColors;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      this.burst(p.x + Math.cos(a) * 1.6, p.y + 0.4, p.z + Math.sin(a) * 1.2, { color: cols[k % cols.length]!, count: 26, speed: 3.4, size: 0.12, gravity: 2.2, life: 2.6, up: 2.6, spread: 0.45 });
    }
    if (place <= 2) {
      this.unpin();
      const g = buildRosette((place + 1) as 1 | 2 | 3, true);
      g.scale.setScalar(0.5);
      g.position.set(-0.11, 0.26 - 0.62 * 0.5, 0.2);
      g.rotation.x = -0.1;
      g.traverse((o) => (o.userData.noAO = true));
      this.game.player.rig.torso.add(g);
      this.pin = g;
    }
  }

  /** Take the prize ribbon off (leaving the festival grounds). */
  unpin(): void {
    this.pin?.removeFromParent();
    this.pin = null;
  }

  endPlay(result: { place?: number; score?: number } = {}): void {
    const play = this.play;
    if (!play) return;
    this.onEndPlay(play, result);
    this.play = null;
    if (this.camSaved) {
      const c = this.camSaved;
      this.camGoal = { ...c };
      this.camRelease = 2.5;
      this.camSaved = null;
    }
    const p = this.game.player;
    if (p.actionPose === this.poseFn) p.actionPose = this.prevPose;
    this.prevPose = this.poseFn = null;
  }

  protected onBeginPlay(_play: PlayState): void {}
  protected onPlayEvent(_play: PlayState, _kind: string, _value: number): void {}
  protected onEndPlay(_play: PlayState, _result: { place?: number; score?: number }): void {}
  /** Player rig pose while a mini-game runs (null = normal animation). */
  protected playerPose(_rig: PlayerRig, _play: PlayState, _dt: number): ActionPose | null {
    return null;
  }

  setSeason(season: Season): void {
    this.season = season;
    this.trees.setSeason(season);
    this.nature.setSeason(season);
    this.ambience.setSeason(season);
  }

  setWeather(weather: Weather): void {
    this.ambience.setWeather(weather);
  }

  dispose(): void {
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

/** A small pill name tag (co-op visitor) above a farmer's head. */
function nameTag(name: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '700 30px Fredoka, Nunito, sans-serif';
  const w = Math.min(240, g.measureText(name).width + 58);
  const x0 = (256 - w) / 2;
  g.fillStyle = 'rgba(40, 22, 10, 0.85)';
  g.strokeStyle = 'rgba(255, 240, 210, 0.9)';
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(x0, 10, w, 44, 22);
  g.fill();
  g.stroke();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x0 + 24, 32, 9, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff6e4';
  g.textBaseline = 'middle';
  g.fillText(name, x0 + 40, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, fog: false, toneMapped: false }));
  sp.scale.set(1.25, 0.31, 1);
  sp.position.y = 2.55;
  sp.renderOrder = 10;
  sp.userData.noAO = true;
  return sp;
}
