/**
 * CutsceneSystem: runs the command scripts in data/story-scenes.ts.
 *   camera   eased keyframes (`cam`) and Catmull-Rom rails (`rail`) that take over the camera rig
 *   actors   story cast + villagers (procedural Villager rigs) and the player: place, walk paths,
 *            face, hold a lantern / clipboard, pop emote bubbles (!, ?, ♥, ♪, …, sweat, sparkle)
 *   screen   letterbox bars, fades, title captions, letters, dialogue with portraits, choices
 *   world    `cue` commands are re-broadcast as `cutscene:cue` for the story systems (coach,
 *            lantern ignition, valley restoration, festival)
 * Esc twice skips (fast-forwards to the end; choices still wait). `stage(scene)` fast-forwards
 * to the scene's `mark` and freezes the frame there — used by the demos.
 *
 * Service `cutscene`: play(scene), stage(scene), playing, skip(), register(id, cmds).
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import type { Facing } from '../core/events';
import { SCENES, ROOM_SCENES, type Cmd, type CamKey, type Ease, type Emote } from '../data/story-scenes';
import { CAST, type CastId } from '../data/story';
import { NPCS, type NpcDef, type NpcId } from '../data/npcs';
import { Villager } from '../entities/villager';
import { CinemaOverlay } from '../ui/journal-cutscene';
import { portraitSvg } from '../ui/portraits';

export interface CutsceneApi {
  play(scene: string | Cmd[], id?: string): Promise<void>;
  /** Fast-forward to the scene's `mark` command and hold the frame (demos / critics). */
  stage(scene: string): Promise<void>;
  readonly playing: boolean;
  skip(): void;
  register(id: string, cmds: Cmd[]): void;
  has(id: string): boolean;
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

interface EmoteFx {
  sprite: THREE.Sprite;
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

  async stage(scene: string): Promise<void> {
    const cmds = this.scenes.get(scene);
    if (!cmds) {
      console.warn(`[cutscene] stage: unknown scene "${scene}"`);
      return;
    }
    const mark = cmds.findIndex((c) => c.do === 'mark');
    this.begin(scene);
    this.instant = true;
    await this.runList(mark >= 0 ? cmds.slice(0, mark) : cmds, false);
    this.instant = false;
    // Hold on the frame: the next line of dialogue (if any) is shown complete.
    const next = mark >= 0 ? cmds.slice(mark + 1).find((c) => c.do === 'say' || c.do === 'choice' || c.do === 'caption') : undefined;
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
    this.overlay.reset();
    this.cam = null;
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
        if (hold) {
          this.overlay.say(who, c.text, true);
          return;
        }
        if (this.fast) return;
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
          this.overlay.caption(c.text, c.sub, 0, true);
          return;
        }
        if (this.fast) return;
        await this.overlay.caption(c.text, c.sub, c.dur ?? 3, false);
        return;
      case 'letter': {
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

  private spawn(id: string, x: number, z: number, facing?: Facing, prop?: 'lantern' | 'clipboard'): void {
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
    const mat = new THREE.SpriteMaterial({ map: emoteTexture(e), depthTest: false, transparent: true });
    const s = new THREE.Sprite(mat);
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
    rig.distance = n.dist;
    g.rc.focusPoint.set(n.x, gy + (n.y ?? 0.8), n.z);
    rig.snap();
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
    if (this.waiters.length) {
      const due = this.waiters.filter((w) => w.until <= this.clock);
      if (due.length) {
        this.waiters = this.waiters.filter((w) => w.until > this.clock);
        for (const w of due) w.resolve();
      }
    }
    if (this.running) this.stepCam(dt);
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
      e.sprite.position.set(p.x, p.y + e.actor.headY + Math.sin(e.t * 5) * 0.04 + (1 - fade) * 0.25, p.z);
      (e.sprite.material as THREE.SpriteMaterial).opacity = fade;
      if (e.t >= e.life) {
        e.sprite.removeFromParent();
        (e.sprite.material as THREE.SpriteMaterial).dispose();
        return false;
      }
      return true;
    });
    if (this.running) this.applyCam();
  }
}
