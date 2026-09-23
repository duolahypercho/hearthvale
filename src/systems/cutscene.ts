/**
 * CutsceneSystem: runs the command scripts in data/story-scenes.ts.
 *   camera   eased keyframes (`cam`) and Catmull-Rom rails (`rail`) that take over the camera rig
 *   actors   story cast + villagers (procedural Villager rigs) and the player: place, walk paths,
 *            face, hold a lantern / clipboard, pop emote bubbles (!, ?, ♥, ♪, …, sweat, sparkle)
 *   screen   letterbox bars, fades, title captions, letters, dialogue with portraits, choices
 *   world    `cue` commands are re-broadcast as `cutscene:cue` for the story systems (coach,
 *            lantern ignition, valley restoration, festival)
 * Esc twice skips (fast-forwards to the end; choices still wait). `stage(scene)` fast-forwards
 * to the scene's `mark` and freezes the frame there — used by the demos (a choice held there stays
 * live: pick it and the scene plays on).
 *
 * Framing guards (every frame while a scene runs):
 *   occluders  trees between the lens and the look target / an actor's head are hidden for the rest
 *              of the scene; a building in the way pulls the camera in in front of it (spring arm)
 *   blocking   each spoken line projects the speaker's head to the screen and warns when another
 *              actor covers it (`blocking()` lists them)
 * `audit()` steps every scene's camera keys on its map and reports keys whose view ray is blocked
 * by a tree or a building (npm test fails on any).
 *
 * Service `cutscene`: play(scene), stage(scene), playing, skip(), register(id, cmds), audit(), blocking().
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import type { Facing } from '../core/events';
import { SCENES, ROOM_SCENES, type Cmd, type CamKey, type Ease, type Emote, type PropKind } from '../data/story-scenes';
import { CAST, type CastId } from '../data/story';
import { NPCS, type NpcDef, type NpcId } from '../data/npcs';
import { Villager } from '../entities/villager';
import { CinemaOverlay } from '../ui/journal-cutscene';
import { portraitSvg } from '../ui/portraits';

export interface CutsceneApi {
  play(scene: string | Cmd[], id?: string): Promise<void>;
  /** Fast-forward to the scene's `mark` command and hold the frame (demos / critics). */
  stage(scene: string, mark?: string): Promise<void>;
  readonly playing: boolean;
  skip(): void;
  register(id: string, cmds: Cmd[]): void;
  has(id: string): boolean;
  /** Camera keys whose view is blocked by a tree / building (loads each scene's maps). */
  audit(): Promise<string[]>;
  /** Lines this session where another actor covered the speaker's face. */
  blocking(): string[];
}

declare module '../core/game' {
  interface GameServices {
    cutscene: CutsceneApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'cutscene:start': { scene: string };
    'cutscene:end': { scene: string; skipped: boolean };
    /** World beat inside a scene. `instant` = fast-forwarding (skip / demo staging): jump to the end state. */
    'cutscene:cue': { cue: string; arg?: string; instant: boolean };
    /** A scene set a story flag (choices, milestones). */
    'story:flag': { key: string; value: string };
  }
}

const FACING_YAW: Record<Facing, number> = { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };
/** Town tiles that are building walls (grid object ids = building group names). */
const BUILDING_RE = /hall|store|bakery|cottage|forge|inn|clinic|house|school|shop|smithy|library|mill|chapel/i;

const ease = (e: Ease | undefined, t: number): number => {
  switch (e ?? 'inOut') {
    case 'linear':
      return t;
    case 'in':
      return t * t * t;
    case 'out':
      return 1 - Math.pow(1 - t, 3);
    default:
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
};

// ─────────────────────────────────────────────── emote bubbles

const EMOTE_TEX = new Map<Emote, THREE.Texture>();
const EMOTE_QUAD = new THREE.PlaneGeometry(1, 1);
function emoteTexture(e: Emote): THREE.Texture {
  let t = EMOTE_TEX.get(e);
  if (t) return t;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  // Rounded speech bubble with a tail, warm outline and a soft drop shadow.
  const bubble = (dx: number, dy: number, fill: string, stroke: string | null): void => {
    g.beginPath();
    g.moveTo(24 + dx, 14 + dy);
    g.arcTo(112 + dx, 14 + dy, 112 + dx, 96 + dy, 22);
    g.arcTo(112 + dx, 92 + dy, 24 + dx, 92 + dy, 22);
    g.lineTo(74 + dx, 92 + dy);
    g.lineTo(62 + dx, 118 + dy);
    g.lineTo(54 + dx, 92 + dy);
    g.arcTo(16 + dx, 92 + dy, 16 + dx, 14 + dy, 22);
    g.arcTo(16 + dx, 14 + dy, 112 + dx, 14 + dy, 22);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    if (stroke) {
      g.lineWidth = 6;
      g.strokeStyle = stroke;
      g.stroke();
    }
  };
  bubble(0, 5, 'rgba(60,30,10,0.35)', null);
  bubble(0, 0, '#fffaf0', '#6a4020');
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const cx = 64;
  const cy = 53;
  switch (e) {
    case 'exclaim':
      g.fillStyle = '#e8574a';
      g.beginPath();
      g.moveTo(cx - 9, cy - 28);
      g.lineTo(cx + 9, cy - 28);
      g.lineTo(cx + 5, cy + 10);
      g.lineTo(cx - 5, cy + 10);
      g.closePath();
      g.fill();
      g.beginPath();
      g.arc(cx, cy + 24, 7, 0, Math.PI * 2);
      g.fill();
      break;
    case 'question':
      g.strokeStyle = '#3f7fb0';
      g.lineWidth = 11;
      g.beginPath();
      g.arc(cx, cy - 10, 15, Math.PI * 1.1, Math.PI * 0.45);
      g.lineTo(cx, cy + 12);
      g.stroke();
      g.fillStyle = '#3f7fb0';
      g.beginPath();
      g.arc(cx, cy + 27, 6.5, 0, Math.PI * 2);
      g.fill();
      break;
    case 'heart': {
      const grd = g.createLinearGradient(0, cy - 26, 0, cy + 28);
      grd.addColorStop(0, '#ff8a8a');
      grd.addColorStop(1, '#d8323e');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(cx, cy + 28);
      g.bezierCurveTo(cx - 44, cy, cx - 26, cy - 34, cx, cy - 14);
      g.bezierCurveTo(cx + 26, cy - 34, cx + 44, cy, cx, cy + 28);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.beginPath();
      g.ellipse(cx - 14, cy - 12, 6, 4, -0.6, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'note':
      g.fillStyle = '#7a4ab0';
      g.strokeStyle = '#7a4ab0';
      g.lineWidth = 6;
      g.beginPath();
      g.ellipse(cx - 14, cy + 20, 11, 8, -0.4, 0, Math.PI * 2);
      g.ellipse(cx + 18, cy + 12, 11, 8, -0.4, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(cx - 4, cy + 18);
      g.lineTo(cx - 4, cy - 26);
      g.lineTo(cx + 28, cy - 34);
      g.lineTo(cx + 28, cy + 10);
      g.stroke();
      break;
    case 'dots':
      g.fillStyle = '#6a4020';
      for (const dx of [-24, 0, 24]) {
        g.beginPath();
        g.arc(cx + dx, cy + 4, 7.5, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'sweat':
      g.fillStyle = '#6fb8e8';
      g.strokeStyle = '#2f6a9a';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(cx + 4, cy - 30);
      g.bezierCurveTo(cx + 30, cy, cx + 24, cy + 28, cx + 2, cy + 28);
      g.bezierCurveTo(cx - 20, cy + 28, cx - 22, cy, cx + 4, cy - 30);
      g.fill();
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.beginPath();
      g.ellipse(cx - 4, cy + 10, 4, 8, 0.3, 0, Math.PI * 2);
      g.fill();
      break;
    case 'sparkle': {
      const star = (x: number, y: number, r: number, col: string): void => {
        g.fillStyle = col;
        g.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
          const rr = i % 2 ? r * 0.3 : r;
          g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        g.closePath();
        g.fill();
      };
      star(cx - 6, cy + 2, 30, '#f5b82a');
      star(cx + 26, cy - 22, 13, '#ffd86a');
      star(cx + 22, cy + 22, 9, '#ffd86a');
      break;
    }
    case 'angry':
      g.strokeStyle = '#d8323e';
      g.lineWidth = 9;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        g.beginPath();
        g.moveTo(cx + sx * 8, cy + sy * 22);
        g.quadraticCurveTo(cx + sx * 8, cy + sy * 8, cx + sx * 22, cy + sy * 8);
        g.stroke();
      }
      break;
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  EMOTE_TEX.set(e, t);
  return t;
}

// ─────────────────────────────────────────────── actors

interface Actor {
  id: string;
  villager: Villager | null;
  /** Head height for emotes (world units above the feet). */
  headY: number;
  path: THREE.Vector3[];
  speed: number;
  arrive?: Facing;
  onArrive: (() => void) | null;
  prop: THREE.Object3D | null;
  holdsLantern: boolean;
}

function buildLanternProp(): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2e2a28, roughness: 0.5, metalness: 0.4 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffb455, emissiveIntensity: 3.2, roughness: 0.4 });
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.09, 6), metal);
  cap.position.y = 0.2;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.2, 6), glow);
  body.position.y = 0.08;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.04, 6), metal);
  base.position.y = -0.03;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 5, 10), metal);
  ring.position.y = 0.29;
  g.add(cap, body, base, ring);
  g.traverse((o) => (o.userData.noAO = true));
  return g;
}

function buildClipboardProp(): THREE.Group {
  const g = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.02), new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.8 }));
  const paper = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.25, 0.022), new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.6, emissive: 0x6fd2e8, emissiveIntensity: 0.15 }));
  paper.position.set(0, -0.01, 0.004);
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.03), new THREE.MeshStandardMaterial({ color: 0xd8dde4, metalness: 0.8, roughness: 0.25 }));
  clip.position.y = 0.14;
  g.add(board, paper, clip);
  g.rotation.x = -0.5;
  g.traverse((o) => (o.userData.noAO = true));
  return g;
}

/** A hand-held paper lantern on a stick (festival crowd): warm, bottom-lit, no light of its own. */
let PAPER_MAT: THREE.MeshStandardMaterial | null = null;
function buildPaperLanternProp(hue: number): THREE.Group {
  const g = new THREE.Group();
  PAPER_MAT ??= new THREE.MeshStandardMaterial({ color: 0xfff0d8, emissive: 0xff9a40, emissiveIntensity: 2.4, roughness: 0.7, vertexColors: true });
  const pts = [new THREE.Vector2(0.02, -0.13), new THREE.Vector2(0.1, -0.1), new THREE.Vector2(0.135, 0), new THREE.Vector2(0.12, 0.1), new THREE.Vector2(0.05, 0.14), new THREE.Vector2(0.02, 0.145)];
  const body = new THREE.LatheGeometry(pts, 12);
  const c = new THREE.Color().setHSL(hue, 0.85, 0.62);
  const col = new Float32Array(body.attributes.position!.count * 3);
  for (let i = 0; i < body.attributes.position!.count; i++) {
    const y = body.attributes.position!.getY(i);
    const k = 0.75 + (0.14 - y) * 1.6;
    col.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const lantern = new THREE.Mesh(body, PAPER_MAT);
  lantern.position.set(0, 0.62, 0.34);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.9, 5), new THREE.MeshStandardMaterial({ color: 0x6a4226, roughness: 0.8 }));
  stick.position.set(0, 0.42, 0.18);
  stick.rotation.x = 0.5;
  g.add(stick, lantern);
  g.traverse((o) => (o.userData.noAO = true));
  return g;
}

/** Sterling's Glimmerco lapel badge: a cyan disc that glows. */
function buildBadgeProp(): THREE.Group {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 16), new THREE.MeshStandardMaterial({ color: 0xd8e2ec, metalness: 0.9, roughness: 0.2 }));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), new THREE.MeshStandardMaterial({ color: 0xbff4ff, emissive: 0x3fd8f0, emissiveIntensity: 3.5, roughness: 0.3 }));
  disc.position.z = 0.004;
  g.add(rim, disc);
  g.traverse((o) => (o.userData.noAO = true));
  return g;
}

interface EmoteFx {
  /** Camera-facing quad (a Mesh, not a Sprite: the AO G-buffer pass only skips flagged meshes). */
  sprite: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  actor: Actor;
  t: number;
  life: number;
}

interface Waiter {
  until: number;
  resolve: () => void;
}

export class CutsceneSystem implements System, CutsceneApi {
  readonly name = 'cutscene';
  private game!: Game;
  private overlay!: CinemaOverlay;
  private scenes = new Map<string, Cmd[]>();
  private actors = new Map<string, Actor>();
  private emotes: EmoteFx[] = [];
  private waiters: Waiter[] = [];
  private clock = 0;
  private running: string | null = null;
  private skipping = false;
  private instant = false;
  private cam: { from: CamKey; to: CamKey | null; keys: CamKey[] | null; t: number; dur: number; ease: Ease; done: (() => void) | null } | null = null;
  private camNow: CamKey = { x: 0, z: 0, yaw: 0, pitch: 50, dist: 24 };
  private lanternLight!: THREE.PointLight;
  private hidden: THREE.Object3D[] = [];
  private escAt = -10;
  private playerHidden = false;
  /** Staged demo holding on a live choice: unpause when it is picked. */
  private stagedLive = false;
  /** Tree instances hidden because they stood in front of the lens (restored when the scene ends). */
  private occluded: { mesh: THREE.BatchedMesh; id: number }[] = [];
  private treeCache: { map: string; meshes: THREE.BatchedMesh[] } | null = null;
  private ray = new THREE.Raycaster();
  private occFrame = 0;
  private blockLog: string[] = [];
  private lineNo = 0;

  init(game: Game): void {
    this.game = game;
    this.overlay = new CinemaOverlay(game.hud.root.parentElement ?? document.body, game.hud.root);
    for (const [k, v] of Object.entries(SCENES)) this.scenes.set(k, v);
    for (const [k, v] of Object.entries(ROOM_SCENES)) this.scenes.set(k, v);
    // One permanent practical for a held lantern (always in the scene: no shader recompiles mid-scene).
    this.lanternLight = new THREE.PointLight(0xffb45e, 0, 7, 1.8);
    this.lanternLight.name = 'cutscene-lantern';
    game.scene.add(this.lanternLight);
    game.provide('cutscene', this);
    window.addEventListener('keydown', (e) => {
      if (!this.running || e.code !== 'Escape') return;
      if (this.clock - this.escAt < 1.6) this.skip();
      else {
        this.escAt = this.clock;
        this.overlay.skipHint();
      }
    });
    game.events.on('map:change', () => {
      for (const a of [...this.actors.keys()]) if (a !== 'player') this.removeActor(a);
      this.occluded = [];
      this.treeCache = null;
    });
  }

  get playing(): boolean {
    return this.running !== null;
  }

  register(id: string, cmds: Cmd[]): void {
    this.scenes.set(id, cmds);
  }

  has(id: string): boolean {
    return this.scenes.has(id);
  }

  blocking(): string[] {
    return [...this.blockLog];
  }

  skip(): void {
    if (!this.running) return;
    this.skipping = true;
    this.overlay.flushLine();
    this.flushWaits();
  }

  // ─────────────────────────────── running

  async play(scene: string | Cmd[], id?: string): Promise<void> {
    const cmds = typeof scene === 'string' ? this.scenes.get(scene) : scene;
    const name = id ?? (typeof scene === 'string' ? scene : 'inline');
    if (!cmds) {
      console.warn(`[cutscene] unknown scene "${String(scene)}"`);
      return;
    }
    if (this.running) {
      console.warn(`[cutscene] "${name}" requested while "${this.running}" plays; queued after it`);
      await new Promise<void>((r) => {
        const off = this.game.events.on('cutscene:end', () => {
          off();
          r();
        });
      });
    }
    this.begin(name);
    await this.runList(cmds, false);
    this.end(name);
  }

  async stage(scene: string, markId?: string): Promise<void> {
    const cmds = this.scenes.get(scene);
    if (!cmds) {
      console.warn(`[cutscene] stage: unknown scene "${scene}"`);
      return;
    }
    const mark = cmds.findIndex((c) => c.do === 'mark' && (!markId || c.id === markId));
    this.begin(scene);
    this.instant = true;
    await this.runList(mark >= 0 ? cmds.slice(0, mark) : cmds, false);
    this.instant = false;
    // Hold on the frame: the next line of dialogue (if any) is shown complete.
    const rest = mark >= 0 ? cmds.slice(mark + 1) : [];
    const ni = rest.findIndex((c) => c.do === 'say' || c.do === 'choice' || c.do === 'caption' || c.do === 'letter');
    const next = ni >= 0 ? rest[ni] : undefined;
    if (next?.do === 'choice') {
      // A choice stays live (keyboard / pad / click): picking it plays the rest of the scene.
      this.stagedLive = true;
      const jump = await this.exec(next, false);
      if (!this.running) return;
      if (this.game.paused) this.game.setPaused(false);
      this.stagedLive = false;
      if (jump) {
        const cont = this.scenes.get(jump);
        if (cont) await this.runList(cont, true);
      } else await this.runList(rest.slice(ni + 1), false);
      this.end(scene);
      return;
    }
    if (next) void this.exec(next, true);
  }

  private begin(name: string): void {
    this.running = name;
    this.skipping = false;
    const g = this.game;
    g.cinematic = true;
    g.calendar.frozen = true;
    g.player.controllable = false;
    g.input.enabled = false;
    g.rc.rig.bounds = null;
    this.readCam();
    this.lineNo = 0;
    this.actors.set('player', { id: 'player', villager: null, headY: 2.15, path: [], speed: 2.2, onArrive: null, prop: null, holdsLantern: false });
    g.events.emit('cutscene:start', { scene: name });
  }

  private end(name: string): void {
    const g = this.game;
    const skipped = this.skipping;
    for (const a of [...this.actors.keys()]) if (a !== 'player') this.removeActor(a);
    this.actors.clear();
    for (const o of this.hidden) o.visible = true;
    this.hidden = [];
    this.restoreOccluders();
    this.overlay.reset();
    this.cam = null;
    this.playerHidden = false;
    g.player.root.visible = true;
    g.cinematic = false;
    g.calendar.frozen = g.paused;
    g.player.controllable = true;
    g.input.enabled = g.hud.openPanelName === null;
    const rig = g.rc.rig;
    rig.bounds = g.world.current?.cameraBounds ?? null;
    rig.yaw = 0;
    rig.pitch = 50;
    rig.distance = 24;
    rig.lookOffset.set(0, 0, 0);
    g.followPlayer(true);
    this.running = null;
    this.skipping = false;
    g.events.emit('cutscene:end', { scene: name, skipped });
  }

  private async runList(cmds: Cmd[], nested: boolean): Promise<void> {
    for (const c of cmds) {
      if (!this.running) return;
      const jump = await this.exec(c, false);
      if (jump) {
        const next = this.scenes.get(jump);
        if (next) await this.runList(next, true);
        return;
      }
    }
    void nested;
  }

  private get fast(): boolean {
    return this.skipping || this.instant;
  }

  /** Wait `t` seconds of real time (resolves at once when skipping / staging). */
  private wait(t: number): Promise<void> {
    if (this.fast || t <= 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ until: this.clock + t, resolve }));
  }

  private flushWaits(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const x of w) x.resolve();
    if (this.cam) this.finishCam();
    for (const a of this.actors.values()) this.finishWalk(a);
  }

  /** Execute one command. Returns a scene id to jump to (choices). */
  private async exec(c: Cmd, hold: boolean): Promise<string | void> {
    const g = this.game;
    switch (c.do) {
      case 'fade':
        await this.overlay.fade(c.to === 'black', this.fast ? 0 : (c.dur ?? 0.8));
        return;
      case 'letterbox':
        this.overlay.letterbox(c.on, this.fast);
        return;
      case 'hud':
        this.overlay.hud(c.on);
        return;
      case 'backdrop':
        this.overlay.backdrop(c.kind);
        return;
      case 'hide': {
        const root = g.world.current?.root;
        if (!root) return;
        for (const n of c.names) {
          for (const o of root.getObjectsByProperty('name', n)) {
            if (!o.visible) continue;
            o.visible = false;
            this.hidden.push(o);
          }
        }
        return;
      }
      case 'crowd': {
        c.ids.forEach((id, i) => {
          const t = c.ids.length > 1 ? i / (c.ids.length - 1) : 0.5;
          const a = THREE.MathUtils.degToRad(c.a0 + (c.a1 - c.a0) * t);
          const r = c.radius + (i % 2 ? 0.55 : 0);
          const x = c.x + Math.sin(a) * r;
          const z = c.z + Math.cos(a) * r;
          this.spawn(id, x, z, undefined, c.prop, 0.08 + i * 0.037);
          const v = this.actors.get(id)?.villager;
          if (v) v.setYaw(Math.atan2(c.face.x - x, c.face.z - z));
        });
        return;
      }
      case 'map': {
        if (g.world.current?.id !== c.map) await g.teleport(c.map, c.x, c.z);
        else g.player.teleport(c.x, c.z);
        if (c.facing) g.player.setFacing(c.facing);
        g.rc.rig.bounds = null;
        return;
      }
      case 'time':
        if (c.season) {
          g.calendar.setSeason(c.season);
          g.applySeason(c.season, true);
        }
        if (c.day) g.calendar.setDay(c.day);
        g.calendar.setHour(c.hour);
        return;
      case 'cam':
        return this.camTo(c.to, c.dur ?? 1.5, c.ease, c.wait !== false);
      case 'rail':
        return this.camRail(c.keys, c.dur, c.wait !== false);
      case 'actor':
        this.spawn(c.id, c.x, c.z, c.facing, c.prop);
        if (c.yaw !== undefined) this.actors.get(c.id)?.villager?.setYaw(THREE.MathUtils.degToRad(c.yaw));
        return;
      case 'remove':
        this.removeActor(c.id);
        return;
      case 'walk':
        return this.walk(c.id, c.path, c.facing, c.speed, c.wait !== false);
      case 'face':
        this.face(c.id, c.facing, c.toward);
        return;
      case 'emote':
        this.emote(c.id, c.emote);
        if (c.wait !== false) await this.wait(0.9);
        return;
      case 'say': {
        const who = this.speaker(c.who, c.mood);
        const listener = this.actors.get(c.who)?.villager;
        const pl = g.player.position;
        if (listener) listener.talkTo = pl;
        this.lineNo++;
        if (hold) {
          this.overlay.say(who, c.text, true);
          window.setTimeout(() => this.checkBlocking(c.who), 60);
          return;
        }
        if (this.fast) return;
        window.setTimeout(() => this.checkBlocking(c.who), 400);
        await this.overlay.say(who, c.text, false);
        if (listener) listener.talkTo = null;
        return;
      }
      case 'choice': {
        const who = this.speaker(c.who);
        const sp = this.actors.get(c.who)?.villager;
        if (sp) sp.talkTo = g.player.position;
        this.skipping = false;
        const pick = await this.overlay.choice(who, c.text, c.options, hold);
        if (pick < 0) return;
        if (sp) sp.talkTo = null;
        const o = c.options[pick]!;
        g.events.emit('story:flag', { key: o.flag, value: o.value });
        return o.then;
      }
      case 'wait':
        await this.wait(c.t);
        return;
      case 'caption':
        if (hold) {
          this.overlay.caption(c.text, c.sub, 0, true, c.low);
          return;
        }
        if (this.fast) return;
        await this.overlay.caption(c.text, c.sub, c.dur ?? 3, false, c.low);
        return;
      case 'letter': {
        if (hold) {
          void g.services.letters?.show(c.id);
          return;
        }
        if (this.fast) return;
        const letters = g.services.letters;
        if (letters) await letters.show(c.id);
        return;
      }
      case 'cue':
        g.events.emit('cutscene:cue', { cue: c.cue, arg: c.arg, instant: this.fast });
        await this.wait(c.t ?? 0);
        return;
      case 'player':
        // Held every frame while the scene runs (map loads / other systems re-show the player).
        this.playerHidden = !c.visible;
        g.player.root.visible = c.visible;
        return;
      case 'flag':
        g.events.emit('story:flag', { key: c.key, value: c.value });
        return;
      case 'mark':
        return;
    }
  }

  private speaker(id: string, mood?: 'happy' | 'neutral' | 'surprised'): { name: string; role: string; portrait: string } {
    const cast = CAST[id as CastId];
    if (cast) return { name: cast.short, role: cast.role, portrait: portraitSvg(cast.look, cast.portraitBg, mood ?? 'happy') };
    const npc = NPCS[id as NpcId];
    if (npc) return { name: npc.name.split(' ')[0]!, role: npc.role, portrait: portraitSvg(npc.look, npc.portraitBg, mood ?? 'happy') };
    return { name: '', role: '', portrait: '' };
  }

  // ─────────────────────────────── actors

  private spawn(id: string, x: number, z: number, facing?: Facing, prop?: PropKind, hue = 0.08): void {
    const g = this.game;
    const map = g.world.current;
    if (!map) return;
    if (id === 'player') {
      g.player.teleport(x, z);
      if (facing) g.player.setFacing(facing);
      g.player.root.visible = true;
      return;
    }
    this.removeActor(id);
    const cast = CAST[id as CastId];
    const npc = NPCS[id as NpcId];
    const def: NpcDef | null = cast ? { ...NPCS.marigold, id: 'marigold', name: cast.name, role: cast.role, look: cast.look, portraitBg: cast.portraitBg, dialogue: [], schedule: [] } : npc ?? null;
    if (!def) {
      console.warn(`[cutscene] unknown actor "${id}"`);
      return;
    }
    // A villager with the same id on this map steps aside while its stand-in acts.
    const twin = map.root.getObjectByName(`npc:${id}`);
    if (twin && twin.visible) {
      twin.visible = false;
      this.hidden.push(twin);
    }
    const v = new Villager(def);
    v.root.name = `cutscene:${id}`;
    v.setPosition(x, map.heightAt(x, z), z);
    if (facing) v.setFacing(facing);
    map.root.add(v.root);
    let p: THREE.Object3D | null = null;
    const S = 1.22 * def.look.scale;
    if (prop === 'lantern') {
      p = buildLanternProp();
      p.position.set(0.36 * def.look.build * S * 0.82, 0.42 * S, 0.12);
      v.root.add(p);
    } else if (prop === 'clipboard') {
      p = buildClipboardProp();
      p.position.set(-0.12 * S, 0.62 * S, 0.3 * S);
      v.root.add(p);
    } else if (prop === 'paperLantern') {
      p = buildPaperLanternProp(hue);
      p.position.set(0.3 * def.look.build * S * 0.82, 0.12 * S, 0.02);
      v.root.add(p);
    }
    // Glimmerco's man always wears the badge.
    if (id === 'sterling') {
      const badge = buildBadgeProp();
      badge.position.set(-0.1 * S, 0.98 * S * (def.look.legs ?? 1), 0.2 * S * def.look.build);
      v.root.add(badge);
    }
    this.actors.set(id, { id, villager: v, headY: 1.95 * def.look.scale + 0.35, path: [], speed: 1.5, onArrive: null, prop: p, holdsLantern: prop === 'lantern' });
  }

  private removeActor(id: string): void {
    const a = this.actors.get(id);
    if (!a || !a.villager) return;
    a.villager.root.removeFromParent();
    a.villager.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) m.geometry.dispose();
    });
    this.emotes = this.emotes.filter((e) => {
      if (e.actor !== a) return true;
      e.sprite.removeFromParent();
      return false;
    });
    this.actors.delete(id);
  }

  private actorPos(a: Actor): THREE.Vector3 {
    return a.villager ? a.villager.position : this.game.player.position;
  }

  private walk(id: string, path: [number, number][], facing: Facing | undefined, speed: number | undefined, wait: boolean): Promise<void> {
    const a = this.actors.get(id);
    if (!a) return Promise.resolve();
    a.path = path.map(([x, z]) => new THREE.Vector3(x, 0, z));
    a.arrive = facing;
    a.speed = speed ?? (a.villager ? 1.5 : 2.4);
    if (a.villager) a.villager.talkTo = null;
    if (this.fast) {
      this.finishWalk(a);
      return Promise.resolve();
    }
    const done = new Promise<void>((r) => (a.onArrive = r));
    return wait ? done : Promise.resolve();
  }

  private finishWalk(a: Actor): void {
    if (!a.path.length) return;
    const last = a.path[a.path.length - 1]!;
    const prev = a.path.length > 1 ? a.path[a.path.length - 2]! : this.actorPos(a);
    const yaw = Math.atan2(last.x - prev.x, last.z - prev.z);
    a.path = [];
    const map = this.game.world.current;
    if (a.villager) {
      a.villager.setPosition(last.x, map?.heightAt(last.x, last.z) ?? 0, last.z);
      if (a.arrive) a.villager.setFacing(a.arrive);
      else a.villager.setYaw(yaw);
    } else {
      this.game.player.teleport(last.x, last.z);
      this.game.player.setFacing(a.arrive ?? this.yawToFacing(yaw));
    }
    const r = a.onArrive;
    a.onArrive = null;
    r?.();
  }

  private yawToFacing(yaw: number): Facing {
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    return Math.abs(s) > Math.abs(c) ? (s > 0 ? 'right' : 'left') : c > 0 ? 'down' : 'up';
  }

  private face(id: string, facing?: Facing, toward?: string): void {
    const a = this.actors.get(id);
    if (!a) return;
    let yaw = facing ? FACING_YAW[facing] : 0;
    if (toward) {
      const t = this.actors.get(toward);
      if (t) {
        const p = this.actorPos(a);
        const q = this.actorPos(t);
        yaw = Math.atan2(q.x - p.x, q.z - p.z);
      }
    }
    if (a.villager) a.villager.setYaw(yaw);
    else this.game.player.setFacing(facing ?? this.yawToFacing(yaw));
  }

  private emote(id: string, e: Emote): void {
    const a = this.actors.get(id);
    if (!a) return;
    const mat = new THREE.MeshBasicMaterial({ map: emoteTexture(e), depthTest: false, depthWrite: false, transparent: true, toneMapped: false, fog: false });
    const s = new THREE.Mesh(EMOTE_QUAD, mat);
    s.frustumCulled = false;
    s.castShadow = s.receiveShadow = false;
    s.renderOrder = 999;
    s.userData.noAO = true;
    s.scale.setScalar(0.001);
    this.game.scene.add(s);
    this.emotes = this.emotes.filter((x) => {
      if (x.actor !== a) return true;
      x.sprite.removeFromParent();
      return false;
    });
    this.emotes.push({ sprite: s, actor: a, t: 0, life: this.fast ? 99 : 1.9 });
  }

  // ─────────────────────────────── camera

  private readCam(): void {
    const rig = this.game.rc.rig;
    const f = rig.focus.clone().add(rig.lookOffset);
    this.camNow = { x: f.x, z: f.z, y: 0.8, yaw: rig.yaw, pitch: rig.pitch, dist: rig.distance };
  }

  private camTo(to: CamKey, dur: number, e: Ease | undefined, wait: boolean): Promise<void> {
    if (this.fast || dur <= 0) {
      this.cam = null;
      this.camNow = { y: 0.8, ...to };
      this.applyCam();
      return Promise.resolve();
    }
    const done = new Promise<void>((r) => {
      this.cam = { from: { ...this.camNow }, to: { y: 0.8, ...to }, keys: null, t: 0, dur, ease: e ?? 'inOut', done: r };
    });
    return wait ? done : Promise.resolve();
  }

  private camRail(keys: CamKey[], dur: number, wait: boolean): Promise<void> {
    if (this.fast) {
      this.camNow = { y: 0.8, ...keys[keys.length - 1]! };
      this.applyCam();
      return Promise.resolve();
    }
    const done = new Promise<void>((r) => {
      this.cam = { from: { ...this.camNow }, to: null, keys: [{ ...this.camNow }, ...keys], t: 0, dur, ease: 'inOut', done: r };
    });
    return wait ? done : Promise.resolve();
  }

  private finishCam(): void {
    const c = this.cam;
    if (!c) return;
    this.camNow = { y: 0.8, ...(c.to ?? c.keys![c.keys!.length - 1]!) };
    this.cam = null;
    this.applyCam();
    c.done?.();
  }

  private stepCam(dt: number): void {
    const c = this.cam;
    if (!c) return;
    c.t += dt;
    const u = Math.min(1, c.t / c.dur);
    const k = ease(c.ease, u);
    const L = THREE.MathUtils.lerp;
    if (c.to) {
      const a = c.from;
      const b = c.to;
      this.camNow = { x: L(a.x, b.x, k), z: L(a.z, b.z, k), y: L(a.y ?? 0.8, b.y ?? 0.8, k), yaw: L(a.yaw, b.yaw, k), pitch: L(a.pitch, b.pitch, k), dist: L(a.dist, b.dist, k) };
    } else if (c.keys) {
      const ks = c.keys;
      const seg = k * (ks.length - 1);
      const i = Math.min(ks.length - 2, Math.floor(seg));
      const t = seg - i;
      const p = (j: number): CamKey => ks[Math.max(0, Math.min(ks.length - 1, j))]!;
      const cr = (f: (q: CamKey) => number): number => {
        const p0 = f(p(i - 1));
        const p1 = f(p(i));
        const p2 = f(p(i + 1));
        const p3 = f(p(i + 2));
        return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
      };
      this.camNow = { x: cr((q) => q.x), z: cr((q) => q.z), y: cr((q) => q.y ?? 0.8), yaw: cr((q) => q.yaw), pitch: cr((q) => q.pitch), dist: cr((q) => q.dist) };
    }
    this.applyCam();
    if (u >= 1) {
      this.cam = null;
      c.done?.();
    }
  }

  private applyCam(): void {
    const g = this.game;
    const rig = g.rc.rig;
    const n = this.camNow;
    const gy = g.world.current?.heightAt(n.x, n.z) ?? 0;
    rig.target.set(n.x, gy + (n.y ?? 0.8) - 0.8, n.z);
    rig.lookOffset.set(0, 0, 0);
    rig.yaw = n.yaw;
    rig.pitch = n.pitch;
    // Spring arm: a building between the look target and the lens pulls the camera in front of it.
    const wall = this.buildingHit(rig.target, n.yaw, n.pitch, n.dist);
    rig.distance = wall !== null ? Math.max(2.5, wall - 0.7) : n.dist;
    g.rc.focusPoint.set(n.x, gy + (n.y ?? 0.8), n.z);
    rig.snap();
  }

  // ─────────────────────────────── framing guards

  /** Camera position of a key (same maths as CameraRig). */
  private static camPos(target: THREE.Vector3, yaw: number, pitch: number, dist: number): THREE.Vector3 {
    const p = THREE.MathUtils.degToRad(pitch);
    const y = THREE.MathUtils.degToRad(yaw);
    return new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)).multiplyScalar(dist).add(target);
  }

  /**
   * Distance from the target (along the view ray towards the lens) to the first building in the
   * way, or null. Buildings are the town's solid 'prop' tiles named like houses; walls reach ~6 m.
   */
  private buildingHit(target: THREE.Vector3, yaw: number, pitch: number, dist: number): number | null {
    const map = this.game.world.current;
    if (!map || map.id !== 'town') return null;
    const p = THREE.MathUtils.degToRad(pitch);
    const y = THREE.MathUtils.degToRad(yaw);
    const dx = Math.sin(y) * Math.cos(p);
    const dy = Math.sin(p);
    const dz = Math.cos(y) * Math.cos(p);
    for (let s = 1.2; s < dist; s += 0.35) {
      const x = target.x + dx * s;
      const z = target.z + dz * s;
      const h = target.y + dy * s - map.heightAt(x, z);
      if (h > 6.2) return null;
      const o = map.grid.inBounds(Math.floor(x), Math.floor(z)) ? map.grid.getObject(Math.floor(x), Math.floor(z)) : null;
      if (o && o.kind === 'prop' && BUILDING_RE.test(o.id ?? '')) return s;
    }
    return null;
  }

  /** Every tree batch on the current map (trees live in BatchedMeshes under the 'trees' group). */
  private trees(): THREE.BatchedMesh[] {
    const map = this.game.world.current;
    if (!map) return [];
    if (this.treeCache?.map === map.id) return this.treeCache.meshes;
    const meshes: THREE.BatchedMesh[] = [];
    map.root.traverse((o) => {
      if ((o as THREE.BatchedMesh).isBatchedMesh) {
        let p: THREE.Object3D | null = o.parent;
        while (p && p !== map.root && p.name !== 'trees') p = p.parent;
        if (p?.name === 'trees') meshes.push(o as THREE.BatchedMesh);
      }
    });
    this.treeCache = { map: map.id, meshes };
    return meshes;
  }

  /** Tree instances on the segment a → b (both directions, so a lens inside a canopy counts). */
  private treeHits(a: THREE.Vector3, b: THREE.Vector3): { mesh: THREE.BatchedMesh; id: number; d: number }[] {
    const meshes = this.trees().filter((m) => m.visible);
    if (!meshes.length) return [];
    const out: { mesh: THREE.BatchedMesh; id: number; d: number }[] = [];
    const len = a.distanceTo(b);
    for (const [from, to] of [[a, b], [b, a]] as const) {
      this.ray.set(from, to.clone().sub(from).normalize());
      this.ray.near = 0;
      this.ray.far = Math.max(0, len - 0.4);
      for (const h of this.ray.intersectObjects(meshes, false)) {
        const id = (h as unknown as { batchId?: number }).batchId;
        if (id !== undefined) out.push({ mesh: h.object as THREE.BatchedMesh, id, d: from === a ? h.distance : len - h.distance });
      }
    }
    return out;
  }

  /** Hide a tree (canopy + the trunk batch instance at the same spot) for the rest of the scene. */
  private hideTree(mesh: THREE.BatchedMesh, id: number): void {
    if (this.occluded.some((o) => o.mesh === mesh && o.id === id)) return;
    const m = new THREE.Matrix4();
    try {
      mesh.getMatrixAt(id, m);
    } catch {
      return;
    }
    const at = new THREE.Vector3().setFromMatrixPosition(m);
    const hide = (bm: THREE.BatchedMesh, i: number): void => {
      if (!bm.getVisibleAt(i)) return;
      bm.setVisibleAt(i, false);
      this.occluded.push({ mesh: bm, id: i });
    };
    hide(mesh, id);
    const q = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (const other of this.trees()) {
      if (other === mesh) continue;
      const max = (other as unknown as { maxInstanceCount?: number }).maxInstanceCount ?? 0;
      for (let i = 0; i < max; i++) {
        try {
          other.getMatrixAt(i, q);
        } catch {
          continue;
        }
        if (pos.setFromMatrixPosition(q).distanceToSquared(at) < 0.01) hide(other, i);
      }
    }
  }

  private restoreOccluders(): void {
    for (const o of this.occluded) {
      try {
        o.mesh.setVisibleAt(o.id, true);
      } catch {
        /* instance deleted meanwhile */
      }
    }
    this.occluded = [];
  }

  /** Per frame (every other): trees between the lens and the target / actors' heads get out of the way. */
  private guardView(): void {
    if (++this.occFrame % 2) return;
    const cam = this.game.rc.camera.position;
    const pts = [this.game.rc.focusPoint.clone()];
    for (const a of this.actors.values()) {
      if (!a.villager && !this.game.player.root.visible) continue;
      const p = this.actorPos(a);
      pts.push(new THREE.Vector3(p.x, p.y + a.headY - 0.35, p.z), new THREE.Vector3(p.x, p.y + 0.6, p.z));
    }
    for (const p of pts) for (const h of this.treeHits(cam, p)) this.hideTree(h.mesh, h.id);
  }

  /** Warn when another actor stands between the lens and the speaker's face. */
  private checkBlocking(who: string): void {
    const sp = this.actors.get(who);
    if (!sp || !this.running) return;
    const cam = this.game.rc.camera;
    const sp3 = this.actorPos(sp);
    const head = new THREE.Vector3(sp3.x, sp3.y + sp.headY - 0.45, sp3.z);
    const hs = head.clone().project(cam);
    const hd = cam.position.distanceTo(head);
    for (const a of this.actors.values()) {
      if (a === sp || (!a.villager && !this.game.player.root.visible)) continue;
      const p = this.actorPos(a);
      if (cam.position.distanceTo(p) > hd) continue;
      // Screen-space bounds of the other actor's body (shoulders to hat).
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const [dx, dy, dz] of [[-0.38, 0.2, 0], [0.38, 0.2, 0], [0, a.headY - 0.1, 0.38], [0, a.headY - 0.1, -0.38], [0, a.headY, 0]] as const) {
        const q = new THREE.Vector3(p.x + dx, p.y + dy, p.z + dz).project(cam);
        x0 = Math.min(x0, q.x);
        x1 = Math.max(x1, q.x);
        y0 = Math.min(y0, q.y);
        y1 = Math.max(y1, q.y);
      }
      if (hs.x > x0 && hs.x < x1 && hs.y > y0 && hs.y < y1) {
        const msg = `${this.running}: line ${this.lineNo} — ${a.id} covers ${who}'s face`;
        if (!this.blockLog.includes(msg)) this.blockLog.push(msg);
        console.warn(`[cutscene] blocking: ${msg}`);
      }
    }
  }

  async audit(): Promise<string[]> {
    const g = this.game;
    const all = [...this.scenes.entries()];
    // Collect every camera key with the map it plays on.
    const keys: { scene: string; i: number; map: string; key: CamKey }[] = [];
    for (const [id, cmds] of all) {
      let map = '';
      cmds.forEach((c, i) => {
        if (c.do === 'map') map = c.map;
        else if (c.do === 'cam') keys.push({ scene: id, i, map, key: c.to });
        else if (c.do === 'rail') for (const k of c.keys) keys.push({ scene: id, i, map, key: k });
      });
    }
    const issues: string[] = [];
    const maps = [...new Set(keys.map((k) => k.map).filter(Boolean))];
    for (const m of maps) {
      if (g.world.current?.id !== m) await g.teleport(m, 5, 5);
      const map = g.world.current;
      if (!map) continue;
      this.treeCache = null;
      for (const k of keys.filter((q) => q.map === m)) {
        const gy = map.heightAt(k.key.x, k.key.z);
        const t = new THREE.Vector3(k.key.x, gy + (k.key.y ?? 0.8) - 0.8, k.key.z);
        const c = CutsceneSystem.camPos(t, k.key.yaw, k.key.pitch, k.key.dist);
        map.root.updateMatrixWorld(true);
        const trees = this.treeHits(c, t.clone().setY(t.y + 0.8));
        const wall = this.buildingHit(t, k.key.yaw, k.key.pitch, k.key.dist);
        if (trees.length) issues.push(`${k.scene}#${k.i} (${m}): tree ${trees[0]!.d.toFixed(1)} m from the lens`);
        if (wall !== null && wall < k.key.dist - 1) issues.push(`${k.scene}#${k.i} (${m}): building ${wall.toFixed(1)} m in front of the target`);
      }
    }
    return issues;
  }

  // ─────────────────────────────── per frame

  fixedUpdate(dt: number): void {
    // The player walks scripted paths: drive position + velocity so the rig animates its walk cycle.
    const a = this.actors.get('player');
    if (!a || !a.path.length) return;
    const p = this.game.player;
    const tgt = a.path[0]!;
    const dx = tgt.x - p.position.x;
    const dz = tgt.z - p.position.z;
    const d = Math.hypot(dx, dz);
    const step = a.speed * dt;
    const pv = p as unknown as { velocity?: THREE.Vector3; targetYaw?: number };
    if (d <= step) {
      p.position.set(tgt.x, this.game.world.heightAt(tgt.x, tgt.z), tgt.z);
      a.path.shift();
      if (!a.path.length) {
        pv.velocity?.set(0, 0, 0);
        if (a.arrive) p.setFacing(a.arrive);
        const r = a.onArrive;
        a.onArrive = null;
        r?.();
      }
      return;
    }
    p.position.x += (dx / d) * step;
    p.position.z += (dz / d) * step;
    p.position.y = this.game.world.heightAt(p.position.x, p.position.z);
    pv.velocity?.set((dx / d) * a.speed, 0, (dz / d) * a.speed);
    if (pv.targetYaw !== undefined) pv.targetYaw = Math.atan2(dx, dz);
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.running && this.playerHidden) this.game.player.root.visible = false;
    if (this.waiters.length) {
      const due = this.waiters.filter((w) => w.until <= this.clock);
      if (due.length) {
        this.waiters = this.waiters.filter((w) => w.until > this.clock);
        for (const w of due) w.resolve();
      }
    }
    if (this.running) this.stepCam(dt);
    if (this.running) this.guardView();
    const map = this.game.world.current;
    const h = (x: number, z: number): number => map?.heightAt(x, z) ?? 0;
    let lantern: Actor | null = null;
    for (const a of this.actors.values()) {
      if (a.holdsLantern) lantern = a;
      const v = a.villager;
      if (!v) continue;
      if (a.path.length) {
        const tgt = a.path[0]!;
        const d = Math.hypot(tgt.x - v.position.x, tgt.z - v.position.z);
        if (d < 0.06) {
          a.path.shift();
          if (!a.path.length) {
            if (a.arrive) v.walkTo(tgt.x, tgt.z, a.arrive);
            const r = a.onArrive;
            a.onArrive = null;
            r?.();
          }
        }
        if (a.path.length) {
          const n = a.path[0]!;
          v.walkTo(n.x, n.z, a.arrive ?? 'down');
        }
      }
      (v as unknown as { speed: number }).speed = a.path.length ? a.speed : 1.55;
      v.update(dt, h, true);
    }
    // Held lantern practical follows its bearer.
    if (lantern?.prop) {
      lantern.prop.getWorldPosition(this.lanternLight.position);
      this.lanternLight.position.y += 0.1;
      const flick = 0.9 + Math.sin(this.clock * 11) * 0.05 + Math.sin(this.clock * 23.7) * 0.04;
      this.lanternLight.intensity = 5.5 * flick * (0.35 + this.game.lighting.night * 0.65);
    } else this.lanternLight.intensity = 0;
    // Emote bubbles: pop (overshoot), bob, float up + fade.
    const cam = this.game.rc.camera;
    this.emotes = this.emotes.filter((e) => {
      e.t += dt;
      const p = this.actorPos(e.actor);
      const k = Math.min(1, e.t / 0.28);
      const pop = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.35 - (1 - k) * 0.9 : 1;
      const fade = e.life - e.t < 0.35 ? Math.max(0, (e.life - e.t) / 0.35) : 1;
      const dist = cam.position.distanceTo(p);
      const S = 0.62 * Math.max(0.6, dist / 14) * pop;
      e.sprite.scale.set(S, S, 1);
      e.sprite.quaternion.copy(cam.quaternion);
      e.sprite.position.set(p.x, p.y + e.actor.headY + Math.sin(e.t * 5) * 0.04 + (1 - fade) * 0.25, p.z);
      e.sprite.material.opacity = fade;
      if (e.t >= e.life) {
        e.sprite.removeFromParent();
        e.sprite.material.dispose();
        return false;
      }
      return true;
    });
    if (this.running) this.applyCam();
  }
}
