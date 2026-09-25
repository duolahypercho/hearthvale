/**
 * Fall — the Harvest Fair on Hearthvale Commons (golden mid-afternoon).
 *
 *   north  the show stage ("Hearthvale Harvest Fair" banner) with the giant-pumpkin contest lined up
 *          in front on straw plinths, prize rosettes beside the winners and two judges pacing the row
 *          with clipboards; the big striped marquee (pie + jam tent) to the west
 *   east   the corn maze: a seeded labyrinth of swaying corn with a scarecrow keeping the centre and
 *          a hay-bale gate
 *   middle the sack race: a straw-edged lane between a start and a finish gate, five racers hopping
 *          for glory, the crowd cheering behind hay bales
 *   south  produce stalls heaped with pumpkins and apples, the cider press, apple bobbing, feast
 *          tables; maples dropping leaves over everything
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import { smoothstep } from '../../core/noise';
import type { Rng } from '../../core/rng';
import { NPCS, NPC_IDS, type NpcLook } from '../../data/npcs';
import { OUTFIT_PALETTES, produceRivals } from '../../data/festivals';
import { TileType } from '../tiles';
import { MeshBuilder, bevelCylinder, mat, groundAO } from '../geom';
import { textures } from '../../render/textures';
import { applyWorldFx } from '../../render/worldfx';
import { buildMarketStall, buildTownHouse } from '../props/townkit';
import { buildBunting } from '../props/festival';
import { buildHayBale, buildHarvestPile, buildScarecrow, buildBench } from '../props/farmkit';
import { FestivalMap, type PlayState } from './base';
import type { ActionPose, PlayerRig } from '../../entities/player';
import { buildShowStage, buildMarquee, buildGiantPumpkin, buildRosette, buildEntryCard, buildCornField, buildRaceGate, buildAppleTub, buildCiderPress, buildGourdGarland, buildBanquetTable } from './kit';
import { PetalStorm, GroundScatter } from './fx';
import { produceGeometry } from '../props/crops';
import { CROPS, type CropId } from '../../data/crops';
import { randomLook, shoulderLift, type CrowdSpec } from './crowd';

const STAGE = { x: 35, z: 10.6 };
const LANE = { x0: 13, x1: 41, z: 25.0 };
/** Five racing lanes, 1.05 m apart (lane 0 = the player, nearest the camera, like the HUD's bottom row). */
const LANES = 5;
const LANE_W = 1.05;
const HALF = (LANES * LANE_W) / 2;
/** Ropes + spectators stand clear of the lanes. */
const ROPE = HALF + 0.4;
const laneZ = (i: number): number => LANE.z + HALF - LANE_W / 2 - i * LANE_W;
const MAZE = { x0: 46.5, z0: 11.5, cols: 6, rows: 7, cell: 2 };
/** Judges pace this line, 1.2 m clear of the pallets' front edges. */
const JUDGE_Z = 19.4;
const PUMPKINS: [number, number, number, number][] = [
  // x, z, radius, tint
  [29.4, 16.4, 0.78, 0xe8862a],
  [33.4, 16.6, 1.08, 0xf07a1e],
  [37.6, 16.5, 0.92, 0xe8d8b0],
  [41.4, 16.3, 0.7, 0x8a9a4a],
];

export class HarvestFair extends FestivalMap {
  private leaves!: PetalStorm;
  private racers: { i: number; speed: number; off: number; lastX: number; lastPh: number; wob: number }[] = [];
  /** Player stumble (sack race): tumble pose timer. */
  private stumbleT = 0;
  /** Produce Judging: your entry on the last pallet of the giants' table (an empty draped stand until you enter). */
  private entry: THREE.Group | null = null;
  private entryAt = { x: PUMPKINS[3]![0], z: PUMPKINS[3]![1] };
  /** Pallet radius per table slot (this year's rivals are sized by their score). */
  private tableR = PUMPKINS.map((p) => p[2]);
  /** The morning's rosettes on the rivals' pallets (hidden while the judging is being staged live). */
  private tableRosettes: THREE.Object3D[] = [];
  private judges: { i: number; phase: number; x?: number; z?: number }[] = [];
  /** Produce Judging: the entry the judges are inspecting (walk there, lean in), and 3D rosettes pinned so far. */
  private judgeAt: { x: number; z: number } | null = null;
  private pinned: THREE.Object3D[] = [];
  /** Sack race over (result card up): hold the finish-line framing instead of tracking the pack. */
  private raceOver = false;
  private cheer: number[] = [];
  private raceT0 = 0;
  /** Race clock (advances with the render clock, frozen while a demo shot is staged). */
  private raceClock = 0;
  private sack: THREE.Mesh | null = null;
  /** Sacks pulled onto co-op farmers' avatars for a shared race. */
  private remoteSacks = new Map<number, THREE.Object3D>();

  constructor(game: Game) {
    super(game, {
      id: 'fest-fall',
      title: 'Harvest Fair · the Commons',
      size: { w: 64, d: 48 },
      extent: { minX: -20, minZ: -20, maxX: 84, maxZ: 68 },
      spawn: { x: 31.5, z: 38, facing: 'up' },
      bounds: [12, 12, 52, 38],
      terrain: { pathTexture: textures.cobble().map, pathScale: 0.48 },
      warps: [{ x0: 29, z0: 47, x1: 34, z1: 47, to: 'farm', x: 61.5, z: 28.5, facing: 'left' }],
    });
    this.activitySpots.push({ id: 'sackrace', x: LANE.x0 + 1.2, z: LANE.z, r: 2.6 }, { id: 'pumpkin', x: 35.4, z: 18.4, r: 2.4 });
    this.visitorSpots.push({ x: 28.6, z: 29.0, yaw: 2.6 }, { x: 34.2, z: 21.2, yaw: -0.3 });
    this.confettiColors = [0xd8573e, 0xf2b928, 0x6a8a3a, 0xe8864a, 0xffffff];
  }

  // ───────────────────────────────────────────── shape

  private rimDist(x: number, z: number): number {
    const qx = Math.abs(x - 32) - 23;
    const qz = Math.abs(z - 24.5) - 14.5;
    return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) + this.noise.fbm(x * 0.07, z * 0.07, 3) * 2.2;
  }

  private exitMask(x: number, z: number): number {
    return smoothstep(3.2, 1.6, Math.abs(x - 31.5)) * smoothstep(40, 46, z);
  }

  protected height(x: number, z: number): number {
    const d = this.rimDist(x, z);
    const n = this.noise;
    const hills = (smoothstep(-0.5, 5, d) * 1.6 + smoothstep(4, 20, d) * (2.8 + n.fbm(x * 0.04 + 5, z * 0.04, 3) * 3)) * (1 - this.exitMask(x, z));
    const rise = smoothstep(16, 9, z) * 0.3;
    return hills + rise + n.fbm(x * 0.05 + 3, z * 0.05, 2) * 0.14;
  }

  private laneValue(x: number, z: number): number {
    return smoothstep(HALF + 0.3, HALF - 0.1, Math.abs(z - LANE.z)) * smoothstep(LANE.x0 - 1.5, LANE.x0, x) * smoothstep(LANE.x1 + 1.5, LANE.x1, x);
  }

  private pathValue(x: number, z: number): number {
    const nz = this.noise.get(x * 0.4, z * 0.4) * 0.25;
    // Loop path: stage apron, stall row, south exit, maze entrance.
    let v = smoothstep(1.3, 0.9, Math.abs(z - 19.6 + nz)) * smoothstep(14, 16, x) * smoothstep(46, 44, x);
    v = Math.max(v, smoothstep(1.2, 0.8, Math.abs(z - 30.2 + nz)) * smoothstep(10, 12, x) * smoothstep(54, 52, x));
    v = Math.max(v, smoothstep(1.1, 0.7, Math.abs(x - 31.5 + nz)) * smoothstep(29, 31, z));
    v = Math.max(v, smoothstep(1.0, 0.6, Math.abs(x - 52.5 + nz)) * smoothstep(26, 28, z) * smoothstep(31.5, 30, z));
    v = Math.max(v, smoothstep(1.0, 0.6, Math.abs(x - 12 + nz)) * smoothstep(18.5, 20, z) * smoothstep(31.5, 30, z));
    return v;
  }

  protected paint(): void {
    this.terrain.paint('path', (x, z) => this.pathValue(x, z));
    // The race lane is a mown sports-day strip: alternating deep-green clover / trodden straw lanes
    // (one per racer) so it reads as a groomed track with real value contrast, not one ochre slab.
    const stripe = (x: number, z: number): number => {
      const lane = this.laneValue(x, z);
      if (lane <= 0) return -1;
      return Math.floor((z - (LANE.z - HALF)) / LANE_W) % 2;
    };
    this.terrain.paintCover('dry', (x, z) => (stripe(x, z) === 1 ? 0.5 * this.laneValue(x, z) : 0) + smoothstep(0.6, 0.85, this.noise.fbm(x * 0.12, z * 0.12, 2) * 0.5 + 0.5) * 0.22 * (1 - this.laneValue(x, z)), { x0: -2, z0: -2, x1: 66, z1: 50 });
    // The fairground is a watered, mown green (deep clover under the blades, patchier toward the
    // edges): it holds its own against the ochre autumn woods instead of melting into one band.
    this.terrain.paintCover(
      'clover',
      (x, z) => {
        const lane = this.laneValue(x, z);
        const field = (0.5 + 0.4 * smoothstep(0.45, 0.75, this.noise.fbm(x * 0.15 + 9, z * 0.15, 2) * 0.5 + 0.5)) * smoothstep(2, 10, Math.min(x, 64 - x, z - 2, 48 - z));
        return Math.max(stripe(x, z) === 0 ? 0.95 * lane : 0, field * (1 - this.pathValue(x, z)) * (1 - lane));
      },
      { x0: -2, z0: -2, x1: 66, z1: 50 },
    );
  }

  protected override tileBlocked(x: number, z: number): boolean {
    return this.rimDist(x, z) > -0.2 && this.exitMask(x, z) < 0.5;
  }

  protected override tileType(x: number, z: number): TileType {
    return this.terrain.splatAt(x, z, 'path') > 0.5 ? TileType.Stone : TileType.Grass;
  }

  protected grassDensity(x: number, z: number): number {
    const t = this.terrain;
    if (t.slopeAt(x, z) < 0.78) return 0;
    const pv = t.splatAt(x, z, 'path');
    if (pv > 0.25) return 0;
    if (this.laneValue(x, z) > 0.4) return 0.8;
    if (this.inMaze(x, z, 0.4)) return 1.2;
    const clump = smoothstep(-0.1, 0.5, this.noise.fbm(x * 0.13 + 4, z * 0.13, 2));
    return (3 + clump * 4.5) * (pv > 0.05 ? 0.55 : 1);
  }

  private inMaze(x: number, z: number, pad = 0): boolean {
    return x > MAZE.x0 - pad && x < MAZE.x0 + MAZE.cols * MAZE.cell + pad && z > MAZE.z0 - pad && z < MAZE.z0 + MAZE.rows * MAZE.cell + pad;
  }

  // ───────────────────────────────────────────── dressing

  protected dress(): void {
    const r = this.rng.fork('dress');
    this.buildStageAndContest(r);
    this.buildMaze(r);
    this.buildRace(r);
    this.buildStalls(r);
    this.buildBackdrop(r);
    this.plantTrees(r);
    this.plantNature(r);
    this.buildCrowd(r);
    this.leaves = new PetalStorm({ count: 380, box: new THREE.Vector3(46, 10, 34), colors: [0xd8573e, 0xe8864a, 0xf2b928, 0xc8452a, 0xb86a2a], drift: 1.1, fall: 0.55, kind: 'leaf' });
    this.leaves.mesh.userData.perfTag = 'festival';
    this.root.add(this.leaves.mesh);
    this.fx.push({ update: (_dt, game) => this.leaves.update(game.rc.rig.focus) });
    // Leaf litter under the trees and drifted against props.
    const items: { x: number; y: number; z: number; rot: number; color: number }[] = [];
    const lr = this.rng.fork('litter');
    for (let i = 0; i < 1600; i++) {
      const x = 2 + lr.next() * 60;
      const z = 6 + lr.next() * 38;
      if (this.laneValue(x, z) > 0.3 || this.inMaze(x, z)) continue;
      const clump = this.noise.fbm(x * 0.3 + 5, z * 0.3, 2);
      if (clump < 0.05 && lr.next() < 0.85) continue;
      const tx = Math.floor(x);
      const tz = Math.floor(z);
      if (this.grid.inBounds(tx, tz) && !this.grid.isWalkable(tx, tz) && lr.next() < 0.6) continue;
      items.push({ x, y: this.H(x, z), z, rot: lr.next() * 6.28, color: [0xd8573e, 0xe8864a, 0xf2b928, 0xa8452a, 0x8a5a2a][Math.floor(lr.next() * 5)]! });
    }
    const litter = new GroundScatter(items, 'leaf');
    litter.mesh.userData.perfTag = 'festival';
    this.root.add(litter.mesh);
  }

  private buildStageAndContest(r: Rng): void {
    this.addProp(buildShowStage(r, 'Hearthvale Harvest Fair'), STAGE.x, STAGE.z, 0, { solidRect: [7.4, 3.6], ao: 4 });
    // The giants' table holds THIS year's three rival entries (the same ones the judging card draws,
    // in the same order), sized by their score; the fourth pallet is yours — a draped, empty stand
    // until you bring something to enter.
    const rivals = produceRivals(this.game.calendar.year);
    PUMPKINS.forEach(([x, z, rad0], k) => {
      const rv = rivals[k];
      const rad = rv ? 0.66 + THREE.MathUtils.clamp((rv.score - 55) / 40, 0, 1) * 0.44 : rad0;
      this.tableR[k] = k < 3 ? rad : rad0;
      const tint = rv ? new THREE.Color(rv.tint).getHex() : 0xc8a070;
      const p = buildGiantPumpkin(r, k < 3 ? rad : rad0, tint, true, k < 3 && !rv?.crop);
      this.addProp(p.group, x, z, (x * 7) % 1, { solidR: this.tableR[k]! + 0.5, ao: this.tableR[k]! * 1.6 });
      if (rv?.crop) {
        // A root crop: the real produce model blown up to prize size, lying on its pallet.
        const geo = produceGeometry(rv.crop);
        geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        const sc = (rad * 1.9) / Math.max(0.05, bb.max.y - bb.min.y);
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }));
        m.scale.setScalar(sc);
        m.position.set(x, this.H(x, z) + 0.36 - bb.min.y * sc, z);
        m.rotation.y = 0.5;
        m.castShadow = true;
        m.userData.perfTag = 'festival';
        m.userData.noAO = true;
        this.root.add(m);
      }
    });
    // Rosettes from the morning's early round on the rivals (best score = gold).
    const order = rivals.map((rv, k) => ({ k, s: rv.score })).sort((a, b) => b.s - a.s);
    order.forEach(({ k }, place) => {
      const [x, z] = PUMPKINS[k]!;
      const rad = this.tableR[k]!;
      const g = buildRosette((place + 1) as 1 | 2 | 3);
      g.position.set(x + rad + 0.45, this.H(x + rad + 0.45, z + rad * 0.6 + 0.3), z + rad * 0.6 + 0.3);
      g.rotation.y = -0.2;
      g.userData.perfTag = 'festival';
      this.root.add(g);
      this.tableRosettes.push(g);
    });
    this.ensureEntryStand();
    // Straw bale seating in front of the contest row.
    for (const [x, z, rot] of [[27, 19.8, 0.1], [42.4, 19.9, -0.1]] as const) this.addProp(buildHayBale(r), x, z, rot, { solidRect: [1.0, 0.6] });
    // Stage dressing: pumpkin piles + bales on the boards, a sheaf at each wing.
    const sy = this.H(STAGE.x, STAGE.z) + 0.72;
    this.addProp(buildHarvestPile(r, 'pumpkins'), STAGE.x - 2.6, STAGE.z + 0.9, 0.4, { y: sy });
    this.addProp(buildHarvestPile(r, 'basket'), STAGE.x + 1.2, STAGE.z + 1.0, 0, { y: sy });
    this.addProp(buildHayBale(r), STAGE.x - 1.2, STAGE.z - 0.6, 0.1, { y: sy });
    this.addProp(buildMarquee(r, 3.6, [0xd8473a, 0xf6ecd8]), 18.8, 12.4, 0.12, { solidR: 3.7, ao: 4.4 });
    this.addProp(buildBanquetTable(r, 3.6, 'fall'), 18.2, 18.2, 0.05, { solidRect: [3.8, 2.2], ao: 1.8 });
  }

  private buildMaze(r: Rng): void {
    const { cols, rows, cell, x0, z0 } = MAZE;
    // Seeded depth-first maze. walls[h][row][col]: horizontal walls on the north edge of each cell.
    const hW: boolean[][] = Array.from({ length: rows + 1 }, () => Array(cols).fill(true));
    const vW: boolean[][] = Array.from({ length: rows }, () => Array(cols + 1).fill(true));
    const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
    const stack: [number, number][] = [[Math.floor(cols / 2), rows - 1]];
    seen[rows - 1]![Math.floor(cols / 2)] = true;
    while (stack.length) {
      const [c, rw] = stack[stack.length - 1]!;
      const nb: [number, number, number][] = [];
      if (rw > 0 && !seen[rw - 1]![c]) nb.push([c, rw - 1, 0]);
      if (rw < rows - 1 && !seen[rw + 1]![c]) nb.push([c, rw + 1, 1]);
      if (c > 0 && !seen[rw]![c - 1]) nb.push([c - 1, rw, 2]);
      if (c < cols - 1 && !seen[rw]![c + 1]) nb.push([c + 1, rw, 3]);
      if (!nb.length) {
        stack.pop();
        continue;
      }
      const [nc, nr, dir] = nb[Math.floor(r.next() * nb.length)]!;
      if (dir === 0) hW[rw]![c] = false;
      else if (dir === 1) hW[rw + 1]![c] = false;
      else if (dir === 2) vW[rw]![c] = false;
      else vW[rw]![c + 1] = false;
      seen[nr]![nc] = true;
      stack.push([nc, nr]);
    }
    // Entrance (south, middle) + exit (north, west-ish); open the centre cell for the scarecrow.
    const mid = Math.floor(cols / 2);
    hW[rows]![mid] = false;
    hW[0]![1] = false;
    const spots: [number, number, number, number, number][] = [];
    const stalk = (x: number, z: number): void => {
      const jx = x + (r.next() - 0.5) * 0.22;
      const jz = z + (r.next() - 0.5) * 0.22;
      spots.push([jx, this.H(jx, jz) - 0.04, jz, r.next() * 6.28, 0.85 + r.next() * 0.3]);
      this.terrain.stampCover('ao', jx, jz, 0.35, 0.25);
      this.terrain.stampCover('dry', jx, jz, 0.5, 0.5);
    };
    const run = (ax: number, az: number, bx: number, bz: number): void => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.round(len / 0.36));
      for (let i = 0; i <= n; i++) {
        const x = ax + ((bx - ax) * i) / n;
        const z = az + ((bz - az) * i) / n;
        stalk(x, z);
        this.blockCircle(x, z, 0.45);
      }
    };
    for (let rw = 0; rw <= rows; rw++) for (let c = 0; c < cols; c++) if (hW[rw]![c]) run(x0 + c * cell, z0 + rw * cell, x0 + (c + 1) * cell, z0 + rw * cell);
    for (let rw = 0; rw < rows; rw++) for (let c = 0; c <= cols; c++) if (vW[rw]![c]) run(x0 + c * cell, z0 + rw * cell, x0 + c * cell, z0 + (rw + 1) * cell);
    const corn = buildCornField(r, spots);
    corn.userData.perfTag = 'corn';
    this.root.add(corn);
    // Scarecrow at the heart of the maze + a hay-bale gate at the entrance.
    const cx = x0 + (mid + 0.5) * cell;
    const cz = z0 + Math.floor(rows / 2 + 0.5) * cell - cell / 2;
    this.addProp(buildScarecrow(r), cx, cz, 0.3, { solidR: 0.4 });
    const ex = x0 + (mid + 0.5) * cell;
    const ez = z0 + rows * cell + 0.9;
    for (const sx of [-1, 1]) {
      this.addProp(buildHayBale(r, true), ex + sx * 1.5 - 0.4, ez, 0, { solidR: 0.6 });
      this.addProp(buildHarvestPile(r, 'pumpkins'), ex + sx * 1.6, ez + 0.9, 0, {});
    }
    this.addProp(buildRaceGate(r, 2.8, 'Corn Maze', '#6a4a2a'), ex, ez + 0.2, 0, {});
  }

  private buildRace(r: Rng): void {
    this.addProp(buildRaceGate(r, HALF * 2 + 0.7, 'Start', '#2f6a8a'), LANE.x0, LANE.z, Math.PI / 2, {});
    this.addProp(buildRaceGate(r, HALF * 2 + 0.7, 'Finish', '#8a2a1e'), LANE.x1, LANE.z, Math.PI / 2, {});
    for (const sz of [-1, 1]) {
      // Rope on stakes along the lane + a few bales.
      const z = LANE.z + sz * ROPE;
      const A: THREE.Vector3[] = [];
      for (let x = LANE.x0 + 1.5; x <= LANE.x1 - 1.4; x += 3.3) {
        this.addProp(buildRaceStake(r), x, z, 0, { solidR: 0.25 });
        A.push(new THREE.Vector3(x, this.H(x, z) + 0.72, z));
      }
      for (let i = 0; i + 1 < A.length; i++) this.addProp(buildBunting(r, A[i]!, A[i + 1]!, 0.12, 5, 0), 0, 0, 0, { y: 0 });
    }
    for (const [x, z] of [[11.4, 28.4], [42.6, 21.4]] as const) this.addProp(buildHayBale(r), x, z, (x * 3) % 0.4, { solidRect: [1.0, 0.6] });
    // Pennant lines strung across the lane on tall poles (sports-day rhythm over the track: the eye
    // runs start → finish under them) + distance flags on the north rope.
    for (const x of [LANE.x0 + 7.4, LANE.x0 + 14.2, LANE.x0 + 21.0]) {
      const zN = LANE.z - ROPE - 0.25;
      const zS = LANE.z + ROPE + 0.25;
      this.addProp(buildRaceStake(r, 3.0), x, zN, 0, { solidR: 0.25 });
      this.addProp(buildRaceStake(r, 3.0), x, zS, 0, { solidR: 0.25 });
      this.addProp(buildBunting(r, new THREE.Vector3(x, this.H(x, zN) + 2.9, zN), new THREE.Vector3(x, this.H(x, zS) + 2.9, zS), 0.35, 15, 0), 0, 0, 0, { y: 0 });
    }
    this.buildLaneChalk(r);
  }

  /** Hand-limed chalk: lane dividers, start + finish lines, distance ticks, and straw kicked up along the ropes. */
  private buildLaneChalk(r: Rng): void {
    const b = new MeshBuilder();
    const chalk = new THREE.MeshStandardMaterial({ color: 0xf4efe0, roughness: 1, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    applyWorldFx(chalk);
    const strip = (ax: number, az: number, bx: number, bz: number, w: number): void => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / 0.5));
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      const px = -uz * w * 0.5;
      const pz = ux * w * 0.5;
      const pos: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= n; i++) {
        const x = ax + ((bx - ax) * i) / n;
        const z = az + ((bz - az) * i) / n;
        // Worn edges: the width breathes a little along the line.
        const k = 0.75 + r.next() * 0.35;
        pos.push(x + px * k, this.H(x + px, z + pz) + 0.018, z + pz * k, x - px * k, this.H(x - px, z - pz) + 0.018, z - pz * k);
        if (i < n) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      b.add(chalk, g, undefined, { tint: 0xffffff, ao: () => 0.9 + r.next() * 0.1 });
    };
    const xs = LANE.x0 + 1.0;
    const xf = LANE.x1 - 1.0;
    // Dividers: dashed, a hand-pushed marker's rhythm with scuffed gaps where racers crossed.
    for (let k = 0; k <= LANES; k++) {
      const z = LANE.z - HALF + k * LANE_W;
      let x = xs;
      while (x < xf) {
        const seg = 0.9 + r.next() * 1.6;
        const x1 = Math.min(xf, x + seg);
        strip(x, z + (r.next() - 0.5) * 0.04, x1, z + (r.next() - 0.5) * 0.04, k === 0 || k === LANES ? 0.09 : 0.06);
        x = x1 + (r.next() < 0.3 ? 0.25 + r.next() * 0.4 : 0.06);
      }
    }
    // Start + finish lines (the finish doubled) and a tick every five metres.
    strip(xs, LANE.z - HALF, xs, LANE.z + HALF, 0.12);
    strip(xf, LANE.z - HALF, xf, LANE.z + HALF, 0.12);
    strip(xf - 0.3, LANE.z - HALF, xf - 0.3, LANE.z + HALF, 0.07);
    for (let x = xs + 5; x < xf - 2; x += 5) for (const sz of [-1, 1]) strip(x, LANE.z + sz * HALF, x, LANE.z + sz * (HALF - 0.25), 0.08);
    const g = b.build({ name: 'lane-chalk' });
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = false;
        o.receiveShadow = true;
        o.userData.noAO = true;
      }
    });
    g.userData.perfTag = 'festival';
    this.root.add(g);
    // Straw flicked out of the sacks, thickest near the start and along the ropes.
    const items: { x: number; y: number; z: number; rot: number; color: number; scale: number }[] = [];
    for (let i = 0; i < 520; i++) {
      const x = LANE.x0 + r.next() * (LANE.x1 - LANE.x0);
      const edge = r.next() < 0.6;
      const z = edge ? LANE.z + (r.next() < 0.5 ? -1 : 1) * (HALF + 0.05 + r.next() * 0.4) : LANE.z + (r.next() - 0.5) * HALF * 2;
      if (!edge && r.next() < smoothstep(LANE.x0, LANE.x0 + 10, x) * 0.8) continue;
      items.push({ x, y: this.H(x, z), z, rot: r.next() * 6.28, color: [0xe8c878, 0xd8b060, 0xc8a050, 0xf0d890][Math.floor(r.next() * 4)]!, scale: 0.6 + r.next() * 0.5 });
    }
    const straw = new GroundScatter(items, 'leaf');
    straw.mesh.userData.perfTag = 'festival';
    this.root.add(straw.mesh);
  }

  private buildStalls(r: Rng): void {
    const stalls: [number, number, number, [number, number]][] = [
      [15.2, 33.2, 0.08, [0xd8573e, 0xf4ecd8]],
      [21.6, 33.8, -0.04, [0x6a8a3a, 0xf4ecd8]],
      [42.4, 33.6, 0.05, [0xe8a030, 0xf4ecd8]],
    ];
    stalls.push([48.4, 30.0, -0.35, [0x8a3a8a, 0xf4ecd8]]);
    // The jam-and-honey stall on the lawn between the pie marquee and the stage (fills the fair's
    // north lawn: the stage, the marquee and this stall frame the giant-produce table).
    stalls.push([25.6, 11.6, 0.06, [0x3f6fa8, 0xf4ecd8]]);
    for (const [x, z, rot, stripes] of stalls) {
      this.addProp(buildMarketStall(r, stripes), x, z, rot, { solidRect: [2.8, 1.2], ao: 1.6, lights: 'none' });
      this.addProp(buildHarvestPile(r, 'pumpkins'), x - 1.7, z + 0.6, 0, {});
      this.addProp(buildHarvestPile(r, r.next() < 0.5 ? 'basket' : 'crate'), x + 1.7, z + 0.7, 0.3, {});
      this.addProp(buildHarvestPile(r, 'crate'), x + 0.9, z + 1.05, 0.1, {});
      // Hanging gourds + dried corn along the awning's front edge.
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      const ay = this.H(x, z) + 2.12;
      const A = new THREE.Vector3(x - 1.3 * c + 0.62 * sn, ay, z + 1.3 * sn + 0.62 * c);
      const B = new THREE.Vector3(x + 1.3 * c + 0.62 * sn, ay, z - 1.3 * sn + 0.62 * c);
      this.addProp(buildGourdGarland(r, A, B, 9), 0, 0, 0, { y: 0 });
    }
    this.addProp(buildCiderPress(r), 53.4, 33.6, -0.2, { solidRect: [2.2, 1.2], ao: 1.3 });
    this.addProp(buildAppleTub(r), 27.2, 33.6, 0, { solidR: 0.7, ao: 0.9 });
    this.addProp(buildBanquetTable(r, 4.2, 'fall'), 37.2, 36.6, -0.03, { solidRect: [4.4, 2.4], ao: 2 });
    this.addProp(buildBench(), 24.8, 37.8, Math.PI, { solidR: 0.6 });
    // Pumpkin piles + bales dressing the lane ends and the stage wings.
    for (const [x, z] of [[11.2, 22.6], [44.4, 22.0], [28.6, 13.0], [41.8, 13.4], [9.8, 30.8], [54.6, 30.6]] as const) this.addProp(buildHarvestPile(r, 'pumpkins'), x, z, (x * 13) % 6, {});
    for (const [x, z, round] of [[9.6, 26.6, true], [45.4, 26.8, true], [26.2, 12.8, false], [44.2, 12.6, false]] as const) this.addProp(buildHayBale(r, round), x, z, (z * 7) % 1, { solidR: 0.6 });
  }

  private buildBackdrop(r: Rng): void {
    // A row of cottages beyond the fair (north-west) and bunting over the stall row.
    const houses: [number, number, Parameters<typeof buildTownHouse>[1]][] = [
      [7.5, 11.2, { w: 5.6, d: 4.4, wallH: 2.8, wall: 'wood', wallTint: 0xf2e2c8, roofTint: 0xa8482a, doorTint: 0x3f6a4a, shutterTint: 0x3f6a4a, chimney: true, flowerBoxes: true }],
    ];
    for (const [x, z, spec] of houses) {
      const bp = buildTownHouse(r, spec);
      this.addProp(bp, x, z, 0.1, { solidRect: [spec.w + 0.4, spec.d + 0.4], ao: spec.w * 0.62, lights: 'none' });
      if (bp.anchors.chimney) this.addSmoke(bp.anchors.chimney.clone().applyMatrix4(bp.group.matrixWorld), 2.5);
    }
    const poles: THREE.Vector3[] = [];
    for (const [x, z] of [[11.5, 31.6], [18.4, 31.4], [25.2, 31.2], [38.6, 31.2], [45.6, 31.4], [52.4, 31.6]] as const) {
      this.addProp(buildRaceStake(r, 3.2), x, z, 0, { solidR: 0.3 });
      poles.push(new THREE.Vector3(x, this.H(x, z) + 3.1, z));
    }
    for (let i = 0; i + 1 < poles.length; i++) if (i !== 2) this.addProp(buildBunting(r, poles[i]!, poles[i + 1]!, 0.45, 12, 0), 0, 0, 0, { y: 0 });
    this.addProp(buildBunting(r, poles[2]!, poles[3]!, 0.9, 20, 0), 0, 0, 0, { y: 0 });
  }

  private plantTrees(r: Rng): void {
    for (const [x, z, s, sp] of [[9, 17, 1.1, 'maple'], [55.5, 36.5, 1.05, 'maple'], [9.5, 37.5, 1.0, 'oak'], [26, 7.5, 0.9, 'maple'], [44.5, 7.8, 0.95, 'oak'], [49, 40, 0.9, 'maple'], [14, 41, 0.95, 'maple'], [60, 24, 1.0, 'oak']] as const) this.addTree(sp, x, z, s);
    for (let z = -18; z < 66; z += 2.4) {
      for (let x = -18; x < 82; x += 2.4) {
        const jx = x + (r.next() - 0.5) * 2;
        const jz = z + (r.next() - 0.5) * 2;
        const d = this.rimDist(jx, jz);
        if (d < 1.2 || this.exitMask(jx, jz) > 0.2 || r.next() < 0.3) continue;
        if (this.terrain.slopeAt(jx, jz) < 0.75) continue;
        // Keep the lens clear south of the fair (arrival framing).
        if (jz > 36 && jz < 56 && Math.abs(jx - 31.5) < 14) continue;
        const roll = r.next();
        const sp = roll < 0.2 ? 'pine' : roll < 0.55 ? 'maple' : 'oak';
        this.trees.add(sp, jx, this.H(jx, jz) - 0.08, jz, 0.85 + r.next() * 0.45, undefined, d > 2.2 ? 1 : 0);
      }
    }
  }

  private plantNature(r: Rng): void {
    const g = this.grid;
    for (let z = 0; z < g.depth; z++) {
      for (let x = 0; x < g.width; x++) {
        const cx = x + 0.5 + (r.next() - 0.5) * 0.6;
        const cz = z + 0.5 + (r.next() - 0.5) * 0.6;
        if (!g.isWalkable(x, z)) continue;
        if (this.terrain.splatAt(cx, cz, 'path') > 0.05 || this.laneValue(cx, cz) > 0.1 || this.inMaze(cx, cz)) continue;
        const d = this.rimDist(cx, cz);
        const roll = r.next();
        const y = this.H(cx, cz);
        if (d > -2.4) {
          if (roll < 0.2) this.nature.place(r.next() < 0.3 ? 'berryBush' : 'bush', cx, y, cz, { scale: 0.8 + r.next() * 0.4, lod: 1 });
          else if (roll < 0.3) this.nature.place('tallGrass', cx, y, cz, { scale: 1.2 });
          continue;
        }
        if (roll < 0.05) this.nature.place('mushroom', cx, y, cz, {});
        else if (roll < 0.1) this.nature.place('leaves', cx, y, cz, {});
        else if (roll < 0.14) this.nature.place('flower', cx, y, cz, { color: [0xf2b928, 0xe8864a, 0xc77dff][Math.floor(r.next() * 3)]! });
      }
    }
  }

  // ───────────────────────────────────────────── crowd

  private buildCrowd(r: Rng): void {
    const P = OUTFIT_PALETTES.fall;
    const specs: CrowdSpec[] = [];
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(r.next() * a.length)]!;
    const person = (look: NpcLook, anim: CrowdSpec['anim'], x: number, z: number, yaw: number, extra: Partial<CrowdSpec> = {}): number => {
      specs.push({ look, outfit: 'fall', anim, x, z, yaw, top: pick(P.tops), accent: pick(P.accents), hatTint: pick(P.hats), phase: r.next(), speed: 0.85 + r.next() * 0.3, ...extra });
      return specs.length - 1;
    };
    // Named villagers: the judges, the pie table, the cider press, cheering at the finish.
    const spot: Record<string, [number, number, number, CrowdSpec['anim'], CrowdSpec['props']]> = {
      marigold: [31.4, JUDGE_Z, Math.PI, 'judge', ['clipboard', 'rosette']],
      bram: [18.4, 20.0, Math.PI, 'talk', ['pie']],
      wren: [LANE.x1 + 1.6, LANE.z + ROPE + 0.9, -2.4, 'cheer', ['flag']],
    };
    const around: [number, number, number, CrowdSpec['anim'], CrowdSpec['props']][] = [
      [39.4, JUDGE_Z, Math.PI, 'judge', ['clipboard']],
      [47.4, 33.9, -2.8, 'talk', ['mug']],
      [26.4, 34.3, 0.3, 'clap', []],
      [21.4, 35.2, Math.PI, 'talk', []],
      [LANE.x1 - 1.5, LANE.z - ROPE - 0.8, 0.3, 'cheer', []],
      [43.0, 34.9, Math.PI, 'wave', []],
      [36.0, 38.0, Math.PI, 'sit', ['mug']],
    ];
    let k = 0;
    for (const id of NPC_IDS) {
      const s = spot[id] ?? around[k++ % around.length]!;
      const i = person({ ...NPCS[id].look }, s[3], s[0], s[1], s[2], { id, props: s[4], lift: s[3] === 'sit' ? 0.18 : 0 });
      if (s[3] === 'judge') this.judges.push({ i, phase: this.judges.length * 0.5 });
    }
    // The fair band on the stage.
    const sy = 0.74;
    person(randomLook(r, { palette: P.tops }), 'fiddle', STAGE.x - 0.4, STAGE.z + 0.2, 0.2, { props: ['fiddle'], lift: sy });
    person(randomLook(r, { palette: P.tops }), 'toast', STAGE.x + 0.5, STAGE.z - 0.1, -0.2, { props: ['flute'], lift: sy });
    // Sack racers (animated along the lane in tick).
    const racerTints = [0xd8392f, 0x3f6fd0, 0xf2b928, 0x3a8a4a, 0x8a3a8a];
    for (let k2 = 0; k2 < 5; k2++) {
      const z = laneZ(k2);
      const i = person(randomLook(r, { palette: P.tops, child: k2 === 3 }), 'sack', LANE.x0 + 2, z, Math.PI / 2, { props: ['sack'], top: racerTints[k2], speed: 1 + k2 * 0.04 });
      this.racers.push({ i, speed: 1.7 + k2 * 0.22 + r.next() * 0.2, off: r.next() * 3, lastX: LANE.x0 + 1.3, lastPh: 0, wob: 0 });
    }
    // Spectators along the lane in little knots of 2–4 (varied stances, some perched on bales),
    // turned to the race and the camera. The north bank is the grandstand; the south bank is sparse.
    const knots: [number, number, number][] = [
      // x, side (-1 north / 1 south), size
      [15.8, -1, 3],
      [21.2, -1, 2],
      [26.4, -1, 3],
      [32.2, -1, 3],
      [37.8, -1, 2],
      [22.8, 1, 2],
      [37.4, 1, 2],
    ];
    for (const [kx, side, size] of knots) {
      const z0 = LANE.z + side * (ROPE + 0.75);
      const hasBale = size >= 3 && r.next() < 0.7;
      if (hasBale) this.addProp(buildHayBale(r), kx, z0 + side * 0.35, side * 0.1, { solidRect: [1.0, 0.6] });
      for (let m = 0; m < size; m++) {
        const child = r.next() < 0.3;
        const dx = (m - (size - 1) / 2) * 0.72 + (r.next() - 0.5) * 0.2;
        const dz = (m % 2) * 0.45 * side + (r.next() - 0.5) * 0.15;
        const x = kx + dx;
        const z = z0 + dz;
        // Facing: north bank looks at the lane (and the camera); south bank turns side-on to the race.
        const base = side < 0 ? 0 : Math.PI + (dx < 0 ? 1.25 : -1.25);
        const yaw = base + (r.next() - 0.5) * 0.7;
        const perch = hasBale && m < 2;
        const anim = perch ? 'perch' : pick(['cheer', 'clap', 'cheer', 'wave', 'talk'] as const);
        const i = person(randomLook(r, { child, palette: P.tops }), anim, perch ? kx - 0.3 + m * 0.6 : x, perch ? z0 + side * 0.35 : z, perch ? (side < 0 ? 0.2 * (m ? 1 : -1) : Math.PI) : yaw, {
          lift: perch ? 0.52 - 0.46 : 0,
          props: child ? [pick(['balloon', 'flag'] as const)] : r.next() < 0.25 ? ['flag'] : r.next() < 0.2 ? ['mug'] : [],
        });
        if (!perch) this.cheer.push(i);
      }
    }
    // A little one up on a grown-up's shoulders to see over the rope.
    {
      const a = randomLook(r, { palette: P.tops });
      const c = randomLook(r, { palette: P.tops, child: true });
      const z = LANE.z + ROPE + 1.5;
      person(a, 'lantern', 34.0, z, Math.PI + 0.3, { pinned: true });
      person(c, 'ride', 34.0, z, Math.PI + 0.3, { lift: shoulderLift(a, c), props: ['balloon'] });
    }
    // Crowd at the contest: flanking the pallets, turned three-quarters to the camera.
    for (const [x, z, yaw] of [[26.6, 19.8, 0.9], [27.4, 20.6, 0.5], [44.2, 19.6, -0.9], [43.4, 20.5, -0.4], [26.0, 17.4, 1.4]] as const) {
      person(randomLook(r, { palette: P.tops, child: r.next() < 0.25 }), pick(['clap', 'idle', 'talk', 'cheer'] as const), x, z, yaw, {});
    }
    // The band's audience: a bench on the lawn east of the stage (a couple listening, a child
    // dancing to the fiddle, a grown-up clapping along), so the stage plays to somebody.
    {
      const bx = 41.2;
      const bz = 12.4;
      const th = -1.15;
      this.addProp(buildBench(), bx, bz, th, { solidR: 0.7 });
      const ax = Math.cos(th);
      const az = -Math.sin(th);
      for (const s of [-0.38, 0.38]) person(randomLook(r, { palette: P.tops }), 'sit', bx + ax * s, bz + az * s, th, { lift: 0.2, props: s < 0 ? ['mug'] : [] });
      person(randomLook(r, { palette: P.tops, child: true }), 'cheer', bx - 1.3, bz + 1.0, th - 0.2, { props: ['balloon'] });
      person(randomLook(r, { palette: P.tops }), 'clap', bx + 0.4, bz + 1.5, th + 0.3, {});
    }
    for (const [x, z, yaw, anim] of [[15.6, 35.2, Math.PI, 'talk'], [22.4, 35.6, Math.PI - 0.3, 'idle'], [28.0, 34.8, -0.4, 'cheer'], [38.2, 38.2, Math.PI, 'sit'], [36.2, 35.0, 0, 'sit'], [52.0, 27.6, Math.PI + 0.6, 'wave'], [19.2, 16.0, 0, 'toast'], [25.5, 10.7, 0.1, 'talk'], [26.9, 13.6, Math.PI + 0.7, 'talk'], [24.2, 13.9, 2.5, 'idle']] as const) {
      person(randomLook(r, { palette: P.tops, child: r.next() < 0.2 }), anim, x, z, yaw, { lift: anim === 'sit' ? 0.2 : 0, props: anim === 'toast' ? ['mug'] : [] });
    }
    this.crowdSpecs = specs;
  }

  // ───────────────────────────────────────────── runtime

  protected override tick(dt: number, game: Game): void {
    const crowd = this.crowd;
    if (!crowd) return;
    const t = game.time;
    const span = LANE.x1 - LANE.x0 - 2.6;
    const race = 16;
    // Demo stills freeze the race mid-lane (hops keep animating in place); otherwise it loops.
    if (!(game.paused && this.staged)) this.raceClock += dt;
    const rt = (((this.raceClock - this.raceT0) % race) + race) % race;
    const play = this.play?.id === 'sackrace' ? this.play : null;
    this.racers.forEach((rc, k) => {
      const m = crowd.members[rc.i]!;
      let x: number;
      let lane: number;
      let hopping: boolean;
      let done: boolean;
      if (play) {
        // Racing the player: villager racer k runs the k-th villager lane at exactly the HUD's
        // progress (x = start + p × length). Lanes taken by co-op farmers (their own avatars, driven
        // by the net layer) leave spare villagers cheering behind the start rope.
        const kinds = play.kinds ?? ['me', 'npc', 'npc', 'npc', 'npc'];
        const lanes = play.lanes ?? [0, 1, 2, 3, 4];
        let ri = -1;
        for (let i = 0, n = 0; i < kinds.length; i++) if (kinds[i] === 'npc' && n++ === k) ri = i;
        if (ri < 0) {
          crowd.place(rc.i, LANE.x0 - 0.4 - (4 - k) * 0.75, LANE.z - ROPE - 0.8, 0.4);
          crowd.setAnim(rc.i, 'cheer');
          m.lean = 0;
          m.squash = 1;
          return;
        }
        const pr = play.progress[ri] ?? 0;
        x = LANE.x0 + 1.3 + pr * span;
        lane = lanes[ri] ?? k + 1;
        done = pr >= 1;
        hopping = play.live && !done;
        // Wobbling racers (the HUD slows them) tumble: a squash + a sideways roll.
        const v = (x - rc.lastX) / Math.max(dt, 1e-3);
        rc.wob = THREE.MathUtils.lerp(rc.wob, hopping && v < 1.1 ? 1 : 0, 1 - Math.exp(-10 * dt));
      } else {
        const run = Math.max(0, rt - 1.5 - rc.off * 0.3);
        x = Math.min(LANE.x0 + 1.3 + run * rc.speed, LANE.x0 + 1.3 + span);
        lane = k;
        done = x >= LANE.x0 + 1.3 + span;
        hopping = run > 0 && !done;
        rc.wob = 0;
      }
      // Finishers hop on past the line and fan out on a diagonal (never piled on the tape).
      if (done) x += 0.5 + lane * 0.45;
      crowd.place(rc.i, x, laneZ(lane), done ? Math.PI / 2 - 0.9 : Math.PI / 2);
      crowd.setAnim(rc.i, done ? 'cheer' : hopping ? 'sack' : 'idle');
      m.lean = rc.wob * Math.sin(t * 13 + k) * 0.38;
      m.squash = 1 - rc.wob * 0.14;
      rc.lastX = x;
      // A dust puff each time the sack lands (the shader's hop: max(sin(5.2·t'), 0), t' = uTime·speed + phase·2π).
      if (hopping) {
        const ph = ((t * m.speed + m.phase * 6.2831) * 5.2) % (Math.PI * 2);
        if (rc.lastPh < Math.PI && ph >= Math.PI) this.burst(x - 0.15, m.y + 0.04, laneZ(lane), { color: 0xc8a870, count: 4, speed: 0.8, size: 0.09, gravity: 5, life: 0.45, up: 0.6, spread: 0.25 });
        rc.lastPh = ph;
      }
    });
    if (play) {
      const pr = play.progress[0] ?? 0;
      const px = LANE.x0 + 1.3 + pr * span;
      this.movePlayer(px, laneZ(play.lanes?.[0] ?? 0));
      // Burlap squash & stretch: stretched in the air, squashed flat on landing.
      if (this.sack) {
        const h = play.hop;
        const air = h < 1 ? Math.sin(h * Math.PI) : 0;
        const land = h < 1 && h > 0.8 ? Math.sin(((h - 0.8) / 0.2) * Math.PI) : 0;
        const sy = this.stumbleT > 0 ? 0.82 : 1 + air * 0.15 - land * 0.2;
        this.sack.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
      }
      // Co-op racers: their farmers (net avatars) climb into sacks too.
      for (const r of play.coop?.racers ?? []) {
        const av = play.coop!.avatar(r.id);
        if (!av || this.remoteSacks.has(r.id) || !this.sack) continue;
        const s2 = this.sack.clone();
        s2.scale.set(1, 1, 1);
        s2.position.set(0, 0.3, 0);
        av.add(s2);
        this.remoteSacks.set(r.id, s2);
      }
      // The camera tracks the pack: centred between you and the leader, pulling back as they spread.
      let lead = pr;
      for (let k = 1; k < 5; k++) lead = Math.max(lead, play.progress[k] ?? 0);
      const gap = (lead - pr) * span;
      if (!this.raceOver) this.reframe(gap * 0.5 + 2.2, -2.4, 22 + Math.min(8, gap * 0.6));
    }
    // Judges pace the pumpkin row, pausing at each entry — during the Produce Judging they gather
    // round YOUR plinth, leaning in with their clipboards.
    if (this.play?.id === 'pumpkin' && this.entry?.visible) {
      // The judges walk plinth to plinth as each card turns (and end at yours), leaning in to judge.
      const at = this.judgeAt ?? this.entryAt;
      const front = 1.35;
      this.judges.forEach((j, k) => {
        const sx = k % 2 ? 1 : -1;
        const gx = at.x + sx * 1.05;
        const gz = at.z + front;
        const m = crowd.members[j.i]!;
        j.x ??= m.x;
        j.z ??= m.z;
        const dx = gx - j.x;
        const dz = gz - j.z;
        const d = Math.hypot(dx, dz);
        const step = Math.min(d, 2.6 * dt);
        if (d > 0.02) {
          j.x += (dx / d) * step;
          j.z += (dz / d) * step;
        }
        const walking = d > 0.12;
        crowd.place(j.i, j.x, j.z, walking ? Math.atan2(dx, dz) : Math.atan2(at.x - j.x, at.z - j.z));
        crowd.setAnim(j.i, walking ? 'walk' : 'judge');
      });
      this.entry.rotation.y = Math.sin(t * 0.8) * 0.25;
      crowd.commit();
      return;
    }
    for (const j of this.judges) {
      const u = ((((t * 0.035 + j.phase) % 1) + 1) % 1) || 0;
      const tri = u < 0.5 ? u * 2 : 2 - u * 2;
      const s = THREE.MathUtils.smootherstep(tri * 3 - Math.floor(tri * 3), 0.35, 0.65);
      const seg = THREE.MathUtils.clamp(Math.floor(tri * 3), 0, 3);
      const xa = PUMPKINS[seg]![0];
      const xb = PUMPKINS[Math.min(3, seg + 1)]![0];
      const x = xa + (xb - xa) * s;
      const moving = s > 0.02 && s < 0.98;
      const dir = u < 0.5 ? 1 : -1;
      // A pace in front of the pallets (clear of the produce), facing the entry while judging.
      crowd.place(j.i, x, JUDGE_Z, moving ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : Math.PI + (seg % 2 ? 0.25 : -0.25));
      crowd.setAnim(j.i, moving ? 'walk' : 'judge');
    }
    crowd.commit();
  }

  override stage(): void {
    super.stage();
    // Catch the sack race mid-lane, the field strung out between the leader and the stragglers.
    this.raceT0 = this.raceClock - 10.5;
  }

  // ───────────────────────────────────────────── Sack Race + Produce Judging mini-games

  protected override onBeginPlay(play: PlayState): void {
    if (play.id === 'sackrace') {
      this.raceOver = false;
      this.placePlayer(LANE.x0 + 1.3, laneZ(0), 'right');
      if (!this.sack) {
        const g = new THREE.CylinderGeometry(0.3, 0.26, 0.62, 12, 3, true);
        const pos = g.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          // Lumpy burlap: bulge at the bottom, gathered at the top.
          const y = pos.getY(i);
          const k = 1 + 0.12 * Math.sin(pos.getX(i) * 20 + y * 9) * (0.5 - y) - (y > 0.25 ? 0.18 : 0);
          pos.setX(i, pos.getX(i) * k);
          pos.setZ(i, pos.getZ(i) * k);
        }
        g.computeVertexNormals();
        const m = new THREE.MeshStandardMaterial({ color: 0xc8a068, roughness: 0.95, side: THREE.DoubleSide, map: textures.thatch().map });
        this.sack = new THREE.Mesh(g, m);
        this.sack.castShadow = true;
        this.sack.position.y = 0.3;
      }
      this.sack.visible = true;
      this.game.player.rig.body.add(this.sack);
      this.frame({ pitch: 40, distance: 22, yaw: 0, ox: 2.2, oz: -2.4 });
    } else if (play.id === 'pumpkin') {
      // You stand beside your own pallet (clear of it, so the entry reads), facing the table.
      this.placePlayer(this.entryAt.x - 1.25, this.entryAt.z + 2.3, 'up');
      this.clearEntry();
      this.judgeAt = null;
      for (const g of this.tableRosettes) g.visible = false;
      // Frame the whole giants' table (the rivals + your entry) above the lower-third results ribbon.
      const px = this.entryAt.x - 1.25;
      this.frame({ pitch: 44, distance: 19, yaw: 0, ox: 35.6 - px, oz: 17.2 - (this.entryAt.z + 2.3) });
    }
  }

  protected override onPlayEvent(play: PlayState, kind: string, value: number): void {
    const p = this.game.player.position;
    if (play.id === 'sackrace') {
      if (kind === 'hop') this.burst(p.x - 0.1, p.y + 0.05, p.z, { color: 0xc8a870, count: 5 + Math.round(value * 4), speed: 0.9, size: 0.09, gravity: 5, life: 0.5, up: 0.8, spread: 0.3 });
      else if (kind === 'stumble') {
        this.stumbleT = 0.55;
        this.burst(p.x, p.y + 0.1, p.z, { color: 0xb89060, count: 16, speed: 1.4, size: 0.12, gravity: 5, life: 0.7, up: 0.9, spread: 0.4 });
      }
      else if (kind === 'finish') {
        const cols = [0xd8573e, 0xf2b928, 0x6a8a3a, 0xe8864a, 0xffffff];
        for (let k = 0; k < 5; k++) this.burst(LANE.x1, this.H(LANE.x1, LANE.z) + 3, LANE.z - 1.6 + k * 0.8, { color: cols[k]!, count: 20, speed: 2.4, size: 0.12, gravity: 1.5, life: 2, up: 0.6, spread: 0.5 });
        this.cheerAll(value === 0);
      }
      else if (kind === 'win' || kind === 'lose') {
        // Result card: frame the finish tape (winners fanning out behind it) with you in the shot.
        this.raceOver = true;
        const fx = LANE.x1 - 1.2;
        this.reframe((fx - p.x) * 0.62, LANE.z - p.z - 1.6, 16 + Math.min(6, Math.abs(fx - p.x) * 0.25));
      }
    } else if (play.id === 'pumpkin') {
      if (kind === 'enter') this.showEntry(play.partner ?? 'pumpkin');
      else if (kind === 'judge') {
        // value: 0..2 = a rival's pumpkin (PUMPKINS order), 3 = your entry.
        this.judgeAt = value >= 3 ? this.entryAt : { x: PUMPKINS[value]![0], z: PUMPKINS[value]![1] };
      } else if (kind === 'rosette') {
        // value = slot + 4 × place: pin a big rosette on a stake beside that entry.
        const slot = value % 4;
        const place = Math.floor(value / 4);
        const at = { x: PUMPKINS[slot]![0], z: PUMPKINS[slot]![1], r: this.tableR[slot]! };
        // Staked into the front corner of the pallet (not floating over the produce): the stake
        // grounds it, and the camera's pitch keeps the rosette face clear of the crop.
        const g = buildRosette((place + 1) as 1 | 2 | 3);
        g.scale.setScalar(1.9);
        const rx = at.x + at.r * 0.95 + 0.15;
        const rz = at.z + at.r * 0.8 + 0.3;
        g.position.set(rx, this.H(rx, rz) + 0.12, rz);
        g.rotation.y = -0.25;
        g.userData.perfTag = 'festival';
        this.root.add(g);
        this.pinned.push(g);
        const cols = [0xf2b928, 0x3f6fd0, 0xd8573e];
        this.burst(g.position.x, g.position.y + 1.15, g.position.z, { color: cols[place]!, count: 22, speed: 1.8, size: 0.11, gravity: 1.5, life: 1.4, up: 1, spread: 0.4 });
      } else if (kind === 'ribbon') {
        const cols = [0xf2b928, 0xd8573e, 0xffffff, 0x3f6fd0];
        PUMPKINS.forEach(([x, z, rad], k) => this.burst(x, this.H(x, z) + rad * 2 + 0.6, z, { color: cols[k]!, count: 18, speed: 2, size: 0.12, gravity: 2, life: 1.6, up: 1, spread: 0.6 }));
        this.cheerAll(value === 0);
      }
    }
  }

  /** Your entry set on a little draped plinth (a giant, prize-sized version of the crop). */
  private ensureEntryStand(): THREE.Group {
    if (!this.entry) {
      const b = new MeshBuilder();
      b.add('woodGrain', bevelCylinder(0.42, 0.46, 0.5, 0.03, 12), mat(0, 0, 0), { tint: 0x9a6a3a });
      b.add('cloth', bevelCylinder(0.47, 0.5, 0.2, 0.02, 14), mat(0, 0.34, 0), { tint: 0xd8473a });
      b.add('cloth', bevelCylinder(0.5, 0.5, 0.04, 0.01, 14), mat(0, 0.52, 0), { tint: 0xe8c878 });
      const g = b.build({ name: 'entry-plinth' });
      g.userData.perfTag = 'festival';
      this.entry = g;
      this.root.add(g);
      // On your pallet (its straw top is 0.36 m up).
      g.position.set(this.entryAt.x, this.H(this.entryAt.x, this.entryAt.z) + 0.36, this.entryAt.z);
      // Its name card, staked at the front of the pallet: the empty stand reads as waiting for you.
      const card = buildEntryCard('Your entry');
      const cx = this.entryAt.x + 0.1;
      const cz = this.entryAt.z + this.tableR[3]! * 1.2 + 0.15;
      card.position.set(cx, this.H(cx, cz), cz);
      card.userData.perfTag = 'festival';
      this.root.add(card);
    }
    return this.entry;
  }

  private clearEntry(): void {
    this.entry?.children.filter((c) => c.name === 'entry-crop').forEach((c) => c.removeFromParent());
  }

  private showEntry(id: string): void {
    const g = this.ensureEntryStand();
    this.clearEntry();
    const crop = id in CROPS ? produceGeometry(id as CropId) : null;
    const mesh = new THREE.Mesh(crop ?? new THREE.IcosahedronGeometry(0.16, 1), new THREE.MeshStandardMaterial({ vertexColors: !!crop, color: crop ? 0xffffff : 0x9a9a9a, roughness: 0.55 }));
    mesh.name = 'entry-crop';
    // Prize-sized: whatever you enter stands ~1 m tall on the stand, like the rivals' giants.
    crop?.computeBoundingBox();
    const bb = crop?.boundingBox;
    const sc = bb ? THREE.MathUtils.clamp(0.95 / Math.max(0.05, bb.max.y - bb.min.y), 2.4, 6) : 2.4;
    mesh.scale.setScalar(sc);
    mesh.castShadow = true;
    mesh.userData.noAO = true;
    mesh.position.y = 0.56 + (bb ? -bb.min.y * sc : 0.38);
    g.add(mesh);
    g.visible = true;
    const p = g.position;
    for (const c of [0xf2b928, 0xffffff]) this.burst(p.x, p.y + 1.2, p.z, { color: c, count: 14, speed: 1.6, size: 0.1, gravity: 1.2, life: 1.3, up: 1, spread: 0.4 });
  }

  private cheerAll(big: boolean): void {
    const c = this.crowd;
    if (!c) return;
    for (const i of this.cheer) c.setAnim(i, big ? 'cheer' : 'clap');
  }

  protected override onEndPlay(play: PlayState): void {
    if (play.id === 'pumpkin') {
      this.clearEntry();
      for (const g of this.tableRosettes) g.visible = true;
    }
    for (const g of this.pinned) g.removeFromParent();
    this.pinned = [];
    this.judgeAt = null;
    this.raceOver = false;
    for (const j of this.judges) j.x = j.z = undefined;
    if (play.id === 'sackrace' && this.sack) {
      this.sack.removeFromParent();
      this.sack.visible = false;
    }
    for (const s of this.remoteSacks.values()) s.removeFromParent();
    this.remoteSacks.clear();
  }

  protected override playerPose(rig: PlayerRig, play: PlayState, _dt: number): ActionPose | null {
    if (play.id === 'sackrace') {
      rig.tool.visible = false;
      if (this.stumbleT > 0) {
        // Tangled: a sideways topple with windmilling arms, squashed into the sack.
        this.stumbleT = Math.max(0, this.stumbleT - _dt);
        const w = Math.sin(play.t * 20);
        const tip = Math.sin((this.stumbleT / 0.55) * Math.PI);
        rig.torso.rotation.set(0.2, 0, tip * 0.45);
        rig.head.rotation.set(0.1, 0, -tip * 0.3);
        rig.armL.rotation.set(-2.2 + w * 0.7, 0, 1.1);
        rig.armR.rotation.set(-2.2 - w * 0.7, 0, -1.1);
        return { bob: -0.04 * tip, sy: 1 - tip * 0.16 };
      }
      const h = play.hop;
      const air = h < 1 ? Math.sin(h * Math.PI) : 0;
      const land = h < 1 && h > 0.75 ? (h - 0.75) * 4 : 0;
      rig.legL.rotation.set(-0.1, 0, 0.05);
      rig.legR.rotation.set(-0.1, 0, -0.05);
      // Fists clutching the sack rim; arms flare in the air.
      rig.armL.rotation.set(-0.5 - air * 0.4, 0, 0.35 + air * 0.5);
      rig.armR.rotation.set(-0.5 - air * 0.4, 0, -0.35 - air * 0.5);
      rig.torso.rotation.set(0.12 - air * 0.1, 0, 0);
      rig.head.rotation.set(-0.08, 0, 0);
      return { bob: air * 0.42, sy: 1 + air * 0.08 - land * 0.1 };
    }
    if (play.id === 'pumpkin') {
      rig.tool.visible = false;
      // Hands clasped, bouncing on the toes while the judges deliberate.
      const b = Math.abs(Math.sin(play.t * 5));
      rig.armL.rotation.set(-0.8, 0, 0.5);
      rig.armR.rotation.set(-0.8, 0, -0.5);
      return { bob: b * 0.03 };
    }
    return null;
  }
}

/** Plain turned stake with a knob (rope / bunting post). */
function buildRaceStake(r: Rng, h = 0.85): THREE.Group {
  void r;
  const b = new MeshBuilder();
  b.add('woodGrain', bevelCylinder(0.045, 0.055, h, 0.012, 7), mat(0, 0, 0), { tint: 0x9a7048, aoWorld: groundAO(0.3) });
  b.add('woodGrain', new THREE.SphereGeometry(0.06, 8, 6), mat(0, h, 0), { tint: 0x8a6040 });
  return b.build({ name: 'stake' });
}
