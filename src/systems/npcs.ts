/**
 * NpcSystem: the villagers of Hearthvale.
 *   · spawns one Villager per data/npcs.ts entry on the town map
 *   · daily schedules ([hour, spot, activity], rainy-day variants) resolved to named SPOTS / doors,
 *     A*-pathfound along the streets; 'inside' walks to the door and steps in (fades out)
 *   · activities at the spot (sweep, read, hammer, paint, water, knead, saw, fish, lean, sit),
 *     wandering, a child's play laps, pairs of villagers chatting (turn to each other, alternate
 *     talking, emote), idle villagers glance at a nearby player, ambient emotes
 *   · talking: player:interact next to a villager → ui:open 'dialogue:<id>' (holding a gift-able
 *     item → 'dialogue:<id>/gift/<item>'), mouth flaps while the box types
 *   · heart events: two scripted mini cutscenes per villager (data/npcs.ts `events`) — trigger when
 *     friendship is high enough and the player is near at the right hour; letterbox, title card,
 *     camera framing, walks, emotes, dialogue with expressions, choices with friendship deltas
 *   · demo staging: villagers at their schedule spots for the demo hour, `?npc=&mood=` for the
 *     dialogue demo, `?event=<id>[&step=N]` for 'town-heart-event'
 *
 * Service `npcs`: conversation(id), positions(), playEvent(id), stageEvent(id, step?), seenEvents().
 * Friendship (points, hearts, gifts) lives in RelationshipSystem; read via services.
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import type { Facing } from '../core/events';
import { NPCS, NPC_IDS, pickGroup, heartEvent, type NpcId, type NpcLook, type NpcDef, type Activity, type Ask, type HeartEvent, type CutStep, type Place, type Who, type Emote } from '../data/npcs';
import { itemDef } from '../data/items';
import { Villager, buildCat, MOOD_GESTURE, ReactionFx } from '../entities/villager';
import { SPOTS, NEW_BUILDINGS } from '../world/town/layout';
import { BUILDINGS } from '../data/town-layout';
import { itemIconUrl } from '../ui/icons';
import { findPath, type Waypoint } from '../world/town/pathfind';
import { SocialPanel, PortraitSheetPanel } from '../ui/dialogue';

export interface Conversation {
  id: NpcId;
  name: string;
  role: string;
  /** Lines of the matching group ("[mood] text" tags allowed). */
  lines: string[];
  ask?: Ask;
  hearts: number;
  birthday: boolean;
  look: NpcLook;
  portraitBg: [number, number];
}

export interface NpcApi {
  conversation(id: string): Conversation | null;
  /** World positions of the villagers on the current map (outdoors only). */
  positions(): { id: NpcId; x: number; z: number }[];
  /** Run a heart event now (teleports to town if needed). */
  playEvent(id: string): Promise<void>;
  /** Freeze a heart event at a step for a beauty shot (default: its choice). */
  stageEvent(id: string, step?: number): void;
  seenEvents(): string[];
  /**
   * Heart-event camera audit: stages every talky beat of every event (or one), computes its shot and
   * reports beats whose actors are hidden behind a building or off-frame / under the dialogue box.
   * Trees in the way are listed too (they are hidden at run time). Empty `fails` = all clear.
   */
  auditEvents(id?: string): { beats: number; fails: string[]; trees: number };
}

declare module '../core/game' {
  interface GameServices {
    npcs: NpcApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'npc:talk': { id: string };
    'npc:event': { id: string; npcId: string; phase: 'start' | 'end' };
    /** The dialogue box shows a villager's line in this mood (body language follows). */
    'npc:line': { id: string; mood: string };
  }
}

const _ab = new THREE.Vector3();
const _q = new THREE.Vector3();
const _hp = new THREE.Vector3();
const _q2 = new THREE.Vector3();
const FACING_YAW: Record<Facing, number> = { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };
const PLAZA_C = { x: 32, z: 25, r: 3.55 };
const EMOTES_CHAT: Emote[] = ['music', 'exclaim', 'question', 'heart', 'dots', 'idea'];

/**
 * Beauty-shot blocking for the town demos: [villager, x, z, yaw (deg, 0 = facing camera), activity,
 * emote held over the head]. Pairs stand three-quarter to the lens so faces read.
 */
type Mark = [NpcId, number, number, number, Activity, Emote?];
const STAGES: Record<string, Mark[]> = {
  'town-day': [
    ['marigold', 20.6, 21.3, 25, 'sweep'],
    ['hazel', 32.9, 21.35, -10, 'water', 'music'],
    ['tobias', 27.9, 22.7, -48, 'chat'],
    ['rowan', 26.5, 22.1, 42, 'chat', 'exclaim'],
    ['wren', 25.4, 22.9, 75, 'paint'],
    ['bram', 42.4, 20.9, -15, 'knead'],
    ['odessa', 43.9, 22.4, -62, 'chat', 'idea'],
    ['kit', 37.4, 27.6, -30, 'play'],
    ['june', 27.5, 26.5, 38, 'chat', 'heart'],
    ['linus', 28.8, 27.1, -40, 'chat'],
  ],
  'town-evening': [
    ['tobias', 33.3, 14.4, 180, 'idle'],
    ['kit', 31.3, 14.1, 20, 'sit'],
    ['marigold', 26.3, 22.1, 40, 'chat', 'heart'],
    ['hazel', 27.7, 22.7, -55, 'chat'],
    ['wren', 29.4, 28.7, 25, 'idle', 'idea'],
    ['bram', 44.3, 22.9, 48, 'chat', 'music'],
    ['june', 45.6, 22.1, -25, 'chat'],
    ['odessa', 36.4, 24.6, 45, 'chat'],
    ['rowan', 37.7, 23.9, -28, 'chat', 'exclaim'],
    ['linus', 21.8, 24.6, 60, 'read'],
  ],
  'town-winter': [
    ['marigold', 20.6, 21.3, 25, 'sweep'],
    ['hazel', 32.9, 21.35, -10, 'idle', 'music'],
    ['tobias', 27.9, 22.7, -48, 'chat'],
    ['rowan', 26.5, 22.1, 42, 'chat', 'exclaim'],
    ['bram', 42.4, 20.9, -15, 'knead'],
    ['odessa', 43.9, 22.4, -62, 'chat', 'idea'],
    ['kit', 37.4, 27.6, -30, 'play'],
    ['june', 27.5, 26.5, 38, 'chat', 'heart'],
    ['linus', 28.8, 27.1, -40, 'chat'],
    ['wren', 36.2, 24.4, -20, 'idle'],
  ],
};
/** 'town-cast': everyone in a row in front of the fountain (model sheet). */
const CAST_ORDER: NpcId[] = ['kit', 'wren', 'marigold', 'bram', 'odessa', 'linus', 'june', 'tobias', 'rowan', 'hazel'];

interface Agent {
  v: Villager;
  def: NpcDef;
  stepKey: string;
  path: Waypoint[];
  goal: { x: number; z: number; yaw: number } | null;
  activity: Activity;
  inside: boolean;
  /** 0 = hidden indoors, 1 = fully out (door fade). */
  vis: number;
  visTarget: number;
  wanderT: number;
  chatT: number;
  emoteT: number;
  speakT: number;
  anchor: { x: number; z: number } | null;
  scripted: boolean;
  onArrive: (() => void) | null;
  run: boolean;
  /** Demo blocking: hold the staged yaw (no turning towards chat partners / the player). */
  staged?: boolean;
  /** Seconds until this villager may wave at a passing farmer again. */
  greetT?: number;
}

export class NpcSystem implements System {
  readonly name = 'npcs';
  private game!: Game;
  private agents = new Map<NpcId, Agent>();
  private active = false;
  private talking: Agent | null = null;
  private staged = false;
  private festival = false;
  private restage: string | null = null;
  private lastQuarter = -1;
  private lastHour = -1;
  private seen = new Set<string>();
  private eventRunning = false;
  private eventCheckT = 0;
  private waits: { t: number; r: () => void }[] = [];
  private clock = 0;
  private playerPath: Waypoint[] = [];
  private playerArrive: { resolve: () => void; face?: Facing | number } | null = null;
  private camSaved: { yaw: number; pitch: number; distance: number; off: THREE.Vector3 } | null = null;
  private lookPoint = new THREE.Vector3();
  /** Who the director frames: a heart event's cast, or the farmer + the villager being talked to. */
  private camMode: 'event' | 'talk' | null = null;
  /** Current shot: wide (establishing / walks / narration), two-shot, or a close-up on the speaker. */
  private shot: { kind: 'wide' | 'two' | 'close'; speaker: NpcId | null; anchor: { x: number; z: number; yaw?: number; pitch?: number; distance?: number } | null } = { kind: 'wide', speaker: null, anchor: null };
  private baseYaw = 0;
  private camCur = { yaw: 0, pitch: 45, dist: 15, target: new THREE.Vector3(), set: false };
  private camPick: { key: string; t: number; dy: number; dp: number; k: number } = { key: '', t: 0, dy: 0, dp: 0, k: 1 };
  private camRelease: { t: number; from: { yaw: number; pitch: number; distance: number; off: THREE.Vector3 } } | null = null;
  private lineNo = 0;
  /** Tree instances hidden because they stood between the lens and an actor (restored after). */
  private occluded: { mesh: THREE.BatchedMesh; id: number }[] = [];
  private treeCache: { map: string; meshes: THREE.BatchedMesh[] } | null = null;
  private occFrame = 0;
  private eventProps: THREE.Object3D[] = [];
  private fx = new ReactionFx();
  /** Warm key light on the actors during night-time conversations and heart events (always in the map, 0 by day). */
  private keyLight = new THREE.PointLight(0xffd2a0, 0, 8, 1.4);
  private keyPos = new THREE.Vector3();
  /** Every villager's soft contact shadow in one instanced draw call. */
  private blobs = (() => {
    const m = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.2, depthWrite: false }), NPC_IDS.length);
    m.name = 'npc-blobs';
    m.renderOrder = 1;
    m.frustumCulled = false;
    m.castShadow = m.receiveShadow = false;
    m.userData.noAO = true;
    m.userData.perfTag = 'npcs';
    return m;
  })();
  private blobM = new THREE.Matrix4();

  init(game: Game): void {
    this.game = game;
    for (const id of NPC_IDS) {
      const v = new Villager(NPCS[id], { blob: false });
      this.agents.set(id, { v, def: NPCS[id], stepKey: '', path: [], goal: null, activity: 'idle', inside: false, vis: 1, visTarget: 1, wanderT: 0, chatT: 2 + Math.random() * 3, emoteT: 4 + Math.random() * 8, speakT: 0, anchor: null, scripted: false, onArrive: null, run: false });
    }
    game.provide('npcs', {
      conversation: (id) => this.conversation(id),
      positions: () => (this.active ? [...this.agents.values()].filter((a) => !a.inside).map((a) => ({ id: a.def.id, x: a.v.position.x, z: a.v.position.z })) : []),
      playEvent: (id) => this.playEvent(id),
      stageEvent: (id, step) => this.stageEvent(id, step),
      seenEvents: () => [...this.seen],
      auditEvents: (id) => this.auditEvents(id),
    });
    game.hud.registerPanel('social', new SocialPanel(game, game.hud.root));
    game.hud.registerPanel('portraits', new PortraitSheetPanel(game, game.hud.root));
    game.events.on('player:interact', ({ x, z }) => this.tryTalk(x, z));
    game.events.on('ui:close', ({ name }) => {
      if (name !== 'dialogue') return;
      // The clock stands still while you read.
      if (!this.eventRunning) game.calendar.frozen = game.paused;
      if (this.talking) {
        this.talking.v.talkTo = null;
        this.talking.v.speaking = false;
        this.talking = null;
      }
      if (this.camMode === 'talk') this.releaseCam();
    });
    game.events.on('ui:open', ({ name }) => {
      if (name.startsWith('dialogue')) game.calendar.frozen = true;
    });
    game.events.on('dialogue:speaking', ({ id, on }) => {
      const a = this.agents.get(id as NpcId);
      if (a) a.v.speaking = on;
    });
    game.events.on('npc:emote', ({ id, emote }) => this.agents.get(id as NpcId)?.v.emote(emote));
    game.events.on('npc:line', ({ id, mood }) => {
      const a = this.agents.get(id as NpcId);
      const g = MOOD_GESTURE[mood];
      if (a && g) a.v.gesture(g, mood === 'sad' || mood === 'thinking' ? 3.2 : 2.4);
    });
    game.events.on('npc:gift', ({ npcId, itemId, reaction }) => this.giftJuice(npcId as NpcId, itemId, reaction));
    game.events.on('demo:stage', ({ name, showcase }) => {
      this.staged = showcase.includes('npcs');
      this.festival = showcase.includes('festival');
      if (this.active) this.restage = name;
    });
  }

  // ───────────────────────────────────────────── conversation

  private conversation(id: string): Conversation | null {
    const def = NPCS[id as NpcId];
    if (!def) return null;
    const rel = this.game.services.relationships;
    const c = this.game.calendar;
    const hearts = Math.min(10, rel?.hearts(id) ?? 0);
    const birthday = rel?.isBirthday(id) ?? false;
    // Old friends (hearts earned through gifts / staging) are never met for the "first" time.
    const first = (rel?.talks(id) ?? 0) === 0 && (rel?.points(id) ?? 0) < 250;
    const g = pickGroup(def, { first, season: c.season, weather: c.weather, hour: c.hour, hearts, birthday });
    // Rotate through the group's lines by talk count so repeat visits feel fresh.
    let lines = g?.lines ?? ['...'];
    const talks = rel?.talks(id) ?? 0;
    if (!g?.first && lines.length > 1) lines = [lines[talks % lines.length]!];
    const ask = g?.ask && !(rel?.talkedToday(id) ?? false) ? g.ask : undefined;
    return { id: def.id, name: def.name, role: def.role, lines, ask, hearts, birthday, look: def.look, portraitBg: def.portraitBg };
  }

  private tryTalk(x: number, z: number): void {
    // One press = one conversation: the player's fixed-step loop can re-emit 'interact' on every
    // substep of a frame; once the box is open (or input is off) further presses are ignored.
    if (!this.active || this.eventRunning || this.talking || this.game.hud.openPanelName || !this.game.input.enabled) return;
    const p = this.game.player.position;
    let best: Agent | null = null;
    let bd = 1.45;
    for (const a of this.agents.values()) {
      if (a.inside || a.vis < 0.5) continue;
      const v = a.v;
      const d = Math.min(Math.hypot(v.position.x - (x + 0.5), v.position.z - (z + 0.5)), Math.hypot(v.position.x - p.x, v.position.z - p.z) - 0.4);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    if (!best) return;
    this.talking = best;
    best.v.talkTo = p;
    const sel = this.game.services.inventory?.selected();
    const kind = sel ? itemDef(sel.id)?.kind : undefined;
    const gift = sel && kind && kind !== 'tool' && kind !== 'seed' && kind !== 'placeable';
    this.game.events.emit('ui:open', { name: gift ? `dialogue:${best.def.id}/gift/${sel.id}` : `dialogue:${best.def.id}` });
    this.game.events.emit('npc:talk', { id: best.def.id });
    this.startTalkCam();
  }

  /** Conversations lean in: a gentle two-shot of the farmer and the villager, above the dialogue box. */
  private startTalkCam(): void {
    if (this.camMode === 'event' || !this.talking) return;
    this.takeCam('talk');
    this.shot = { kind: 'two', speaker: this.talking.def.id, anchor: null };
  }

  // ───────────────────────────────────────────── gifts

  /** The gift arcs from the farmer's hands to the villager, who squashes and bursts into a reaction. */
  private giftJuice(id: NpcId, itemId: string, reaction: 'love' | 'like' | 'neutral' | 'dislike'): void {
    const a = this.agents.get(id);
    if (!a || !this.active) return;
    const p = this.game.player.position;
    const v = a.v;
    const from = new THREE.Vector3(p.x, p.y + 1.05, p.z);
    const to = new THREE.Vector3(v.position.x, v.position.y + v.headTop * 0.62, v.position.z);
    let url = '';
    try {
      url = itemIconUrl(itemId);
    } catch {
      /* no icon: skip the toss */
    }
    const land = (): void => {
      v.squash(reaction === 'love' ? 1.3 : reaction === 'dislike' ? 0.7 : 1);
      v.gesture(reaction === 'love' ? 'hug' : reaction === 'like' ? 'open' : reaction === 'dislike' ? 'shrug' : 'nod', 1.8);
      this.fx.burst(new THREE.Vector3(v.position.x, v.position.y + v.headTop + 0.15, v.position.z), reaction);
    };
    if (url) this.fx.tossItem(url, from, to, land);
    else land();
  }

  // ───────────────────────────────────────────── map + placement

  onMapChange(mapId: string, game: Game): void {
    const map = game.world.current;
    this.active = mapId === 'town' && !!map;
    for (const a of this.agents.values()) a.v.root.removeFromParent();
    this.keyLight.removeFromParent();
    this.blobs.removeFromParent();
    this.fx.group.removeFromParent();
    this.occluded = [];
    this.treeCache = null;
    this.treeBalls = null;
    if (!this.active || !map) return;
    map.root.add(this.blobs, this.fx.group);
    for (const a of this.agents.values()) map.root.add(a.v.root);
    this.keyLight.name = 'npc-keylight';
    this.keyLight.castShadow = false;
    map.root.add(this.keyLight);
    this.placeAll();
    if (this.staged) this.restage = this.restage ?? 'map';
  }

  private spot(name: string): { x: number; z: number; yaw: number } | null {
    const map = this.game.world.current;
    if (name.startsWith('door:')) {
      const id = name.slice(5);
      const d = map?.poi?.[id]?.[0];
      if (!d) return null;
      const b = map?.root.getObjectByName(id);
      const yaw = b ? Math.atan2(b.position.x - d.x, b.position.z - d.z) : 0;
      return { x: d.x, z: d.z, yaw };
    }
    const s = SPOTS[name];
    if (!s) return null;
    return { x: s[0], z: s[1], yaw: typeof s[2] === 'number' ? s[2] : FACING_YAW[s[2]] };
  }

  private place(p: Place): { x: number; z: number; yaw: number } | null {
    if (typeof p === 'string') return this.spot(p);
    return { x: p[0], z: p[1], yaw: 0 };
  }

  private stepFor(a: Agent, hour: number): [number, string, Activity?] {
    const w = this.game.calendar.weather;
    const list = (w === 'rain' || w === 'storm') && a.def.rainSchedule ? a.def.rainSchedule : a.def.schedule;
    let cur = list[0]!;
    for (const s of list) if (hour >= s[0]) cur = s;
    return cur;
  }

  /** Put everyone where their schedule says right now (no walking). */
  private placeAll(): void {
    const map = this.game.world.current;
    if (!map) return;
    const hour = this.game.calendar.hour;
    for (const a of this.agents.values()) {
      a.staged = false;
      if (a.scripted) continue;
      const [, spotName, act] = this.stepFor(a, hour);
      a.stepKey = `${spotName}|${act ?? 'idle'}`;
      const s = this.spot(spotName) ?? this.spot('fountain_s')!;
      a.path = [];
      a.onArrive = null;
      a.v.stop();
      a.v.talkTo = null;
      a.anchor = { x: s.x, z: s.z };
      a.v.setPosition(s.x, map.heightAt(s.x, s.z), s.z);
      a.v.setYaw(s.yaw);
      a.goal = null;
      this.setInside(a, act === 'inside', true);
      this.setActivity(a, act ?? 'idle');
    }
    this.lastHour = hour;
    this.lastQuarter = Math.floor(hour * 4);
  }

  private setInside(a: Agent, inside: boolean, instant = false): void {
    a.inside = inside;
    a.visTarget = inside ? 0 : 1;
    if (instant) {
      a.vis = a.visTarget;
      a.v.root.visible = a.vis > 0.01;
      a.v.root.scale.setScalar(1);
    }
  }

  private setActivity(a: Agent, act: Activity): void {
    a.activity = act;
    a.v.setActivity(act === 'inside' ? 'idle' : act);
    a.wanderT = 1 + Math.random() * 3;
  }

  private goTo(a: Agent, spotName: string, act: Activity): void {
    const map = this.game.world.current;
    const s = this.spot(spotName);
    if (!map || !s) return;
    const wasInside = a.inside;
    if (wasInside) {
      // Step out of the building we were in (at our current door), then walk.
      this.setInside(a, false);
      a.vis = 0.01;
      a.v.root.visible = true;
    }
    this.setActivity(a, 'idle');
    const path = findPath(map.grid, a.v.position.x, a.v.position.z, s.x, s.z);
    a.path = path.length ? path.slice(1) : [{ x: s.x, z: s.z }];
    a.goal = s;
    a.anchor = { x: s.x, z: s.z };
    a.onArrive = () => {
      a.v.faceYaw(s.yaw);
      if (act === 'inside') this.setInside(a, true);
      this.setActivity(a, act);
    };
    this.nextWaypoint(a);
  }

  private nextWaypoint(a: Agent): void {
    const w = a.path.shift();
    if (!w) {
      const cb = a.onArrive;
      a.onArrive = null;
      a.run = false;
      cb?.();
      return;
    }
    const last = a.path.length === 0;
    a.v.walkTo(w.x, w.z, last && a.goal ? a.goal.yaw : 'down', a.run);
  }

  // ───────────────────────────────────────────── staging (demos)

  private stage(name: string): void {
    const map = this.game.world.current;
    if (!map) return;
    this.placeAll();
    const params = new URLSearchParams(window.location.search);
    if (this.festival) {
      // Festival: everyone in a loose ring around the maypole, facing the centre.
      const ids = NPC_IDS;
      ids.forEach((id, i) => {
        const a = this.agents.get(id)!;
        const ang = ((-150 + (i * 300) / ids.length) * Math.PI) / 180 + (i % 2 ? 0.08 : -0.05);
        const r = PLAZA_C.r + (i % 2) * 0.9;
        const x = PLAZA_C.x + Math.cos(ang) * r;
        const z = PLAZA_C.z + Math.sin(ang) * r;
        this.setInside(a, false, true);
        a.v.setPosition(x, map.heightAt(x, z), z);
        a.v.setYaw(Math.atan2(PLAZA_C.x - x, PLAZA_C.z - z));
        this.setActivity(a, i % 3 === 0 ? 'chat' : 'idle');
        a.anchor = { x, z };
      });
      return;
    }
    const marks = STAGES[name];
    if (marks) {
      this.applyMarks(marks);
      return;
    }
    if (name === 'town-social' || name === 'town-dialogue' || name === 'town-night-talk') this.seedFriendship(name !== 'town-social' && params.get('first') === '1' ? ((params.get('npc') as NpcId | null) ?? 'marigold') : null);
    // A daytime conversation happens in the living square: the rest of the town keeps its day blocking.
    if (name === 'town-dialogue' && this.game.calendar.hour < 17) this.applyMarks(STAGES['town-day']!, (params.get('npc') as NpcId | null) ?? 'marigold');
    this.stageRest(name, params);
  }

  /** Demo blocking: put each marked villager on their spot, holding yaw, activity and emote. */
  private applyMarks(marks: Mark[], skip?: NpcId): void {
    const map = this.game.world.current!;
    {
      for (const [id, x, z, deg, act, emote] of marks) {
        if (id === skip) continue;
        const a = this.agents.get(id)!;
        this.setInside(a, false, true);
        a.v.setPosition(x, map.heightAt(x, z), z);
        a.v.setYaw((deg * Math.PI) / 180);
        this.setActivity(a, act);
        a.anchor = { x, z };
        a.stepKey = '';
        a.staged = true;
        if (act === 'chat') a.v.speaking = !!emote;
        if (emote) {
          a.v.emote(emote, 600);
          a.emoteT = 600;
        }
      }
    }
  }

  private stageRest(name: string, params: URLSearchParams): void {
    const map = this.game.world.current!;
    // The social page rendered before the seeding: reopen it.
    if (name === 'town-social') this.game.events.emit('ui:open', { name: 'social' });
    if (name === 'town-cast') {
      CAST_ORDER.forEach((id, i) => {
        const a = this.agents.get(id)!;
        const x = 26.6 + i * 1.3;
        const z = 29.2;
        this.setInside(a, false, true);
        a.v.setPosition(x, map.heightAt(x, z), z);
        a.v.setYaw(0);
        this.setActivity(a, 'idle');
        a.anchor = { x, z };
      });
      return;
    }
    if (name === 'town-dialogue' || name === 'town-night-talk') {
      const id = (params.get('npc') as NpcId | null) ?? (name === 'town-night-talk' ? 'tobias' : 'marigold');
      const a = this.agents.get(id) ?? this.agents.get('marigold')!;
      // Face-to-face with the farmer on a diagonal (up-screen, to the right) so both read clearly.
      const p = this.game.player.position;
      const x = p.x + 1.4;
      const z = p.z - 0.6;
      this.setInside(a, false, true);
      a.v.setPosition(x, map.heightAt(x, z), z);
      a.v.setYaw(Math.atan2(p.x - x, p.z - z));
      this.game.player.setFacing('right');
      // Anyone else standing right behind the pair steps aside.
      for (const b of this.agents.values()) if (b !== a && Math.hypot(b.v.position.x - x, b.v.position.z - z) < 2.2) this.setInside(b, true, true);
      this.setActivity(a, 'idle');
      const mood = params.get('mood');
      const extra = params.get('gift') ? `/gift/${params.get('gift')}` : mood ? `/${mood}` : params.get('ask') ? '/ask' : '';
      // Reopening the box closes the demo's first one ('ui:close' clears `talking`): set it after.
      this.game.events.emit('ui:open', { name: `dialogue:${a.def.id}${extra}` });
      a.v.talkTo = p;
      this.talking = a;
      this.startTalkCam();
      this.snapCam();
      window.setTimeout(() => this.game.services.dialogueBox?.finishLine(), 30);
      return;
    }
    if (name === 'town-heart-event') {
      const ev = params.get('event') ?? 'wren-2';
      const step = params.get('step');
      this.stageEvent(ev, step !== null ? Number(step) : undefined);
    }
  }

  /**
   * Demo staging only: a believable spread of friendship so heart meters aren't all empty, and every
   * seeded villager counts as already met (no first-meeting lines at 5 hearts). `stranger` stays at 0.
   */
  private seedFriendship(stranger: NpcId | null = null): void {
    const rel = this.game.services.relationships;
    if (!rel || NPC_IDS.some((id) => rel.points(id) > 0)) return;
    const spread = [3.4, 5.2, 2.6, 6.8, 1.8, 4.5, 7.3, 3.0, 2.2, 5.9];
    NPC_IDS.forEach((id, i) => {
      if (id === stranger) return;
      rel.adjust(id, Math.round(spread[i % spread.length]! * 250));
      rel.meet(id);
    });
  }

  // ───────────────────────────────────────────── heart events

  private who(w: Who): Agent | null {
    return w === 'player' ? null : (this.agents.get(w) ?? null);
  }

  private whoPos(w: Who): THREE.Vector3 {
    return w === 'player' ? this.game.player.position : this.agents.get(w)!.v.position;
  }

  private faceTo(w: Who, to: Facing | Who): void {
    let yaw: number;
    if (to in FACING_YAW) yaw = FACING_YAW[to as Facing];
    else {
      const a = this.whoPos(w);
      const b = this.whoPos(to as Who);
      yaw = Math.atan2(b.x - a.x, b.z - a.z);
    }
    if (w === 'player') {
      const f: Facing = Math.abs(Math.sin(yaw)) > Math.abs(Math.cos(yaw)) ? (Math.sin(yaw) > 0 ? 'right' : 'left') : Math.cos(yaw) > 0 ? 'down' : 'up';
      this.game.player.setFacing(f);
    } else this.agents.get(w)?.v.faceYaw(yaw);
  }

  private wait(sec: number): Promise<void> {
    return new Promise((r) => this.waits.push({ t: this.clock + sec, r }));
  }

  private castEvent(ev: HeartEvent): void {
    const map = this.game.world.current!;
    for (const [w, spec] of Object.entries(ev.cast) as [Who, [Place, Facing]][]) {
      const p = this.place(spec[0]);
      if (!p) continue;
      if (w === 'player') {
        this.game.player.teleport(p.x, p.z);
        this.game.player.setFacing(spec[1]);
        continue;
      }
      const a = this.agents.get(w)!;
      a.scripted = true;
      a.path = [];
      a.onArrive = null;
      a.v.stop();
      a.v.talkTo = null;
      this.setInside(a, false, true);
      a.v.setPosition(p.x, map.heightAt(p.x, p.z), p.z);
      a.v.setYaw(typeof spec[0] === 'string' && !spec[0].startsWith('door:') ? p.yaw : FACING_YAW[spec[1]]);
      this.setActivity(a, 'idle');
    }
    // Everyone else who stands in the shot steps aside (indoors).
    for (const a of this.agents.values()) {
      if (a.scripted) continue;
      if (Math.hypot(a.v.position.x - ev.camera.x, a.v.position.z - ev.camera.z) < 9) this.setInside(a, true, true);
    }
    this.clearEventProps();
    for (const pr of ev.props ?? []) {
      if (pr.kind !== 'cat') continue;
      // Pip is the town cat: the one napping on the plaza bench steps off stage meanwhile.
      const nap = map.poi?.cat?.[0];
      const crit = this.game.scene.getObjectByName('critters');
      if (nap && crit)
        for (const c of crit.children)
          if (c.visible && Math.hypot(c.position.x - nap.x, c.position.z - nap.z) < 0.4) {
            c.visible = false;
            this.hiddenCats.push(c);
          }
      const cat = buildCat(pr.pose ?? 'sit');
      cat.scale.setScalar(pr.scale ?? 1);
      cat.position.set(pr.at[0], map.heightAt(pr.at[0], pr.at[1]) + (pr.y ?? 0), pr.at[1]);
      cat.rotation.y = pr.rot ?? 0;
      cat.userData.perfTag = 'npcs';
      map.root.add(cat);
      this.eventProps.push(cat);
    }
  }

  private hiddenCats: THREE.Object3D[] = [];

  private clearEventProps(): void {
    for (const c of this.hiddenCats) c.visible = true;
    this.hiddenCats = [];
    for (const o of this.eventProps) {
      o.removeFromParent();
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    }
    this.eventProps = [];
  }

  // ───────────────────────────────────────────── camera director (heart events + conversations)

  /** Take the camera rig (saved for release) and drive it ourselves. */
  private takeCam(mode: 'event' | 'talk'): void {
    const rig = this.game.rc.rig;
    if (!this.camSaved) this.camSaved = { yaw: rig.yaw, pitch: rig.pitch, distance: rig.distance, off: rig.lookOffset.clone() };
    if (this.camRelease) {
      this.camSaved = { ...this.camSaved };
      this.camRelease = null;
    }
    if (!this.camMode) {
      this.camCur.yaw = rig.yaw;
      this.camCur.pitch = rig.pitch;
      this.camCur.dist = rig.distance;
      this.camCur.target.copy(rig.focus).add(rig.lookOffset);
      this.camCur.set = true;
      this.baseYaw = mode === 'talk' ? rig.yaw : this.baseYaw;
    }
    this.camMode = mode;
    this.camPick.key = '';
    // Heart events are cinematics (the rig stops following; co-op hides other farmers). A chat only
    // leans the camera in through the look offset, so everyone else stays on screen in co-op.
    this.game.cinematic = mode === 'event';
    rig.lookOffset.set(0, 0, 0);
  }

  /** Hand the camera back to the player follow, blending yaw / pitch / distance home. */
  private releaseCam(): void {
    if (!this.camMode) return;
    const wasEvent = this.camMode === 'event';
    this.camMode = null;
    this.game.cinematic = false;
    const rig = this.game.rc.rig;
    if (this.camSaved) {
      // Event cams hand back from their own target (the rig's follow smooths it); chats blend the offset home.
      const off = wasEvent ? this.camSaved.off.clone() : rig.lookOffset.clone();
      this.camRelease = { t: 0, from: { yaw: rig.yaw, pitch: rig.pitch, distance: rig.distance, off } };
      rig.lookOffset.copy(off);
    }
    this.game.followPlayer(false);
    this.restoreOccluders();
  }

  /** Jump straight to the current shot (staging, cuts). */
  private snapCam(): void {
    if (!this.camMode) return;
    this.camPick.key = '';
    const g = this.shotGoal();
    if (!g) return;
    this.camCur.yaw = g.yaw;
    this.camCur.pitch = g.pitch;
    this.camCur.dist = g.dist;
    this.camCur.target.copy(g.target);
    this.applyCam();
    this.game.rc.rig.snap();
    this.game.rc.camera.updateMatrixWorld(true);
  }

  private applyCam(): void {
    const rig = this.game.rc.rig;
    rig.yaw = this.camCur.yaw;
    rig.pitch = this.camCur.pitch;
    rig.distance = this.camCur.dist;
    if (this.camMode === 'talk') {
      const p = this.game.player.position;
      rig.lookOffset.set(this.camCur.target.x - p.x, this.camCur.target.y - p.y, this.camCur.target.z - p.z);
    } else {
      rig.target.copy(this.camCur.target);
      rig.lookOffset.set(0, 0, 0);
    }
    this.lookPoint.copy(this.camCur.target);
  }

  /** The actors the director frames (world position, head height). */
  private camActors(): { id: Who; x: number; y: number; z: number; head: number }[] {
    const out: { id: Who; x: number; y: number; z: number; head: number }[] = [];
    const p = this.game.player.position;
    if (this.camMode === 'talk') {
      const a = this.talking;
      if (a) out.push({ id: a.def.id, x: a.v.position.x, y: a.v.position.y, z: a.v.position.z, head: a.v.headTop });
    } else
      for (const a of this.agents.values())
        if (a.scripted && !a.inside && a.v.root.visible) out.push({ id: a.def.id, x: a.v.position.x, y: a.v.position.y, z: a.v.position.z, head: a.v.headTop });
    if (this.game.player.root.visible !== false) out.push({ id: 'player', x: p.x, y: p.y, z: p.z, head: 1.85 });
    return out;
  }

  /** Building footprints + roof heights (the director keeps them out of the sight lines). */
  private static readonly BLOCKERS: { r: [number, number, number, number]; h: number }[] = [
    ...BUILDINGS.map((b) => ({ r: [b.block[0], b.block[1], b.block[2] + 1, b.block[3] + 1] as [number, number, number, number], h: b.kind === 'hall' ? 11 : 6.2 })),
    ...NEW_BUILDINGS.map((b) => ({ r: [b.block[0], b.block[1], b.block[2] + 1, b.block[3] + 1] as [number, number, number, number], h: b.kind === 'inn' || b.kind === 'school' ? 7.5 : 6.2 })),
    // The fountain: low basin rim, then the tiered spout.
    { r: [29.7, 22.7, 34.3, 27.3], h: 0.62 },
    { r: [31.0, 24.0, 33.0, 26.0], h: 2.2 },
  ];

  /** Number of actor sight lines (head + chest) cut by a building from this camera position. */
  private buildingHits(cam: THREE.Vector3, acts: { x: number; y: number; z: number; head: number }[]): number {
    const map = this.game.world.current;
    if (!map) return 0;
    let hits = 0;
    for (const a of acts) {
      for (const hy of [a.head - 0.3, a.head * 0.5]) {
        const ax = a.x;
        const ay = a.y + hy;
        const az = a.z;
        const len = Math.hypot(cam.x - ax, cam.y - ay, cam.z - az);
        const n = Math.ceil(len / 0.3);
        let hit = false;
        for (let i = Math.ceil(0.9 / 0.3); i < n && !hit; i++) {
          const t = i / n;
          const x = ax + (cam.x - ax) * t;
          const y = ay + (cam.y - ay) * t;
          const z = az + (cam.z - az) * t;
          for (const b of NpcSystem.BLOCKERS) {
            const [x0, z0, x1, z1] = b.r;
            if (x < x0 || x > x1 || z < z0 || z > z1) continue;
            if (y - map.heightAt(x, z) < b.h) {
              hit = true;
              break;
            }
          }
        }
        if (hit) hits++;
      }
    }
    return hits;
  }

  /**
   * How many of the speaker's face points (eyes, mouth) are hidden behind another actor's head /
   * hat or shoulders from this lens position (0–2). Heads are spheres sized for hats and hair.
   */
  private faceBlocked(pos: THREE.Vector3, lead: { id: Who; x: number; y: number; z: number; head: number }, acts: { id: Who; x: number; y: number; z: number; head: number }[]): number {
    let n = 0;
    const la = lead.id !== 'player' ? this.agents.get(lead.id) : null;
    const fr = la ? 0.62 * (la.v.headTop / 1.9) : 0.3;
    for (const dy of [0.42, 0.72]) {
      _ab.set(lead.x, lead.y + lead.head - fr * (dy + 0.2), lead.z);
      const dl = pos.distanceTo(_ab);
      let hit = false;
      for (const o of acts) {
        if (o === lead) continue;
        // Head (with a hat brim for the farmer), then the shoulders.
        for (const [oy, r] of [[o.head - (o.id === 'player' ? 0.38 : 0.34), o.id === 'player' ? 0.5 : 0.4], [o.head * 0.55, 0.3]] as const) {
          _hp.set(o.x, o.y + oy, o.z);
          if (pos.distanceTo(_hp) > dl - 0.2) continue;
          _q.subVectors(_ab, pos);
          const t = THREE.MathUtils.clamp(_q2.subVectors(_hp, pos).dot(_q) / _q.lengthSq(), 0, 1);
          if (_q2.copy(pos).addScaledVector(_q, t).distanceTo(_hp) < r) hit = true;
        }
      }
      if (hit) n++;
    }
    return n;
  }

  private camPosFor(target: THREE.Vector3, yawDeg: number, pitchDeg: number, dist: number, out = new THREE.Vector3()): THREE.Vector3 {
    const p = THREE.MathUtils.degToRad(pitchDeg);
    const y = THREE.MathUtils.degToRad(yawDeg);
    return out.set(target.x + Math.sin(y) * Math.cos(p) * dist, target.y + Math.sin(p) * dist, target.z + Math.cos(y) * Math.cos(p) * dist);
  }

  /**
   * The shot for right now: a two-shot square to the line between speaker and listener, a close-up
   * that favours the speaker, or a wide establishing frame; the look point is lifted so the actors sit
   * in the upper-middle of the frame, clear of the dialogue box. Buildings in the way swing the yaw
   * (±15–45°) or raise the camera; trees in the way are hidden per frame (guardView).
   */
  private shotGoal(): { yaw: number; pitch: number; dist: number; target: THREE.Vector3; focus: THREE.Vector3 } | null {
    const map = this.game.world.current;
    const acts = this.camActors();
    if (!map || !acts.length) return null;
    const s = this.shot;
    let wx = 0;
    let wz = 0;
    let W = 0;
    for (const a of acts) {
      const w = a.id === 'player' ? 0.6 : a.id === s.speaker ? 1.5 : 1;
      wx += a.x * w;
      wz += a.z * w;
      W += w;
    }
    let cx = wx / W;
    let cz = wz / W;
    let spread = 0;
    for (const a of acts) for (const b of acts) spread = Math.max(spread, Math.hypot(a.x - b.x, a.z - b.z));
    const lead = acts.find((a) => a.id === s.speaker) ?? acts.find((a) => a.id !== 'player') ?? acts[0]!;
    const other = acts.find((a) => a !== lead && a.id === 'player') ?? acts.find((a) => a !== lead);
    const base = this.baseYaw;
    let yaw = base;
    let kind = s.kind;
    // A speaker turned away from the lens (talking to a cat on a roof…) gets the wide frame instead.
    const la = lead.id !== 'player' ? this.agents.get(lead.id) : null;
    if (la && kind !== 'wide') {
      const toCam = THREE.MathUtils.degToRad(base);
      const fy = (la.v as unknown as { yaw: number }).yaw;
      const off = Math.abs(Math.atan2(Math.sin(fy - toCam), Math.cos(fy - toCam)));
      if (off > THREE.MathUtils.degToRad(115)) {
        // …framed over their shoulder on what they are looking at, far actors left out.
        kind = 'wide';
        cx = lead.x + Math.sin(fy) * 2.2;
        cz = lead.z + Math.cos(fy) * 2.2;
        spread = 0;
      }
    }
    // Scene props (Pip on the roof) pull the wide frame towards them.
    if (kind === 'wide' && this.eventProps.length && !s.anchor) {
      for (const o of this.eventProps) {
        cx = (cx * W + o.position.x * 0.8) / (W + 0.8);
        cz = (cz * W + o.position.z * 0.8) / (W + 0.8);
      }
    }
    if (kind !== 'wide' && other && Math.hypot(other.x - lead.x, other.z - lead.z) > 0.5) {
      // Camera offset (sin y, cos y) perpendicular to the pair: y = atan2(-dz, dx) or + 180°.
      const c1 = THREE.MathUtils.radToDeg(Math.atan2(-(other.z - lead.z), other.x - lead.x));
      const d = (a: number): number => Math.abs(((a - base + 540) % 360) - 180);
      const pick = d(c1) < d(c1 + 180) ? c1 : c1 + 180;
      // (the candidate search below swings towards the listener's shoulder for a three-quarter view)
      let delta = ((pick - base + 540) % 360) - 180;
      delta = THREE.MathUtils.clamp(delta, -34, 34);
      yaw = base + delta;
    } else if (kind !== 'wide') kind = 'close';
    let pitch: number;
    let dist: number;
    if (kind === 'wide') {
      pitch = 40;
      dist = Math.max(12.5, spread * 1.5 + 9);
      if (s.anchor) {
        cx = s.anchor.x;
        cz = s.anchor.z;
        yaw = s.anchor.yaw ?? base;
        pitch = Math.max(34, s.anchor.pitch ?? 40);
        dist = s.anchor.distance ?? dist;
      }
    } else if (kind === 'two') {
      pitch = this.camMode === 'talk' ? 38 : 33;
      dist = this.camMode === 'talk' ? 11 : THREE.MathUtils.clamp(spread * 1.35 + 5.8, 8, 12.5);
    } else {
      // Close-up: lower for short actors (children) so the lens meets the face, not the crown.
      pitch = lead.head < 1.6 ? 22 : 28;
      dist = THREE.MathUtils.clamp(spread * 0.8 + 5.4, 6.2, 8.5);
      cx = THREE.MathUtils.lerp(cx, lead.x, 0.5);
      cz = THREE.MathUtils.lerp(cz, lead.z, 0.5);
    }
    // Pick a clear angle (cached per shot and re-checked twice a second).
    const key = `${kind}|${s.speaker}|${Math.round(cx)}|${Math.round(cz)}|${Math.round(yaw / 5)}`;
    if (key !== this.camPick.key || this.clock - this.camPick.t > 0.5) {
      const probe = new THREE.Vector3(cx, map.heightAt(cx, cz) + 0.9, cz);
      const cands: [number, number, number][] = [];
      for (const k of [1, 0.75]) for (const dp of [0, 10, 20]) for (const dy of [0, 15, -15, 30, -30, 45, -45]) cands.push([dy, dp, k]);
      let best = cands[cands.length - 1]!;
      let bestHits = 99;
      // Score: blocked sight lines dominate; then a speaker turned from the lens (three-quarter is
      // best), the listener's head in front of the speaker's face, then distance from the base angle.
      const fy = la ? (la.v as unknown as { yaw: number }).yaw : null;
      const lh = other ? new THREE.Vector3(other.x, other.y + other.head - 0.25, other.z) : null;
      const v1 = new THREE.Vector3();
      const v2 = new THREE.Vector3();
      // Bystanders (other villagers near the pair) must not stand in front of the actors either.
      const ids = new Set(acts.map((a) => a.id));
      const by: THREE.Vector3[] = [];
      for (const o of this.agents.values())
        if (!ids.has(o.def.id) && !o.inside && o.v.root.visible && Math.hypot(o.v.position.x - cx, o.v.position.z - cz) < 10) by.push(new THREE.Vector3(o.v.position.x, o.v.position.y + o.v.headTop * 0.55, o.v.position.z));
      const segD = (a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3): number => {
        v1.subVectors(b, a);
        const t = THREE.MathUtils.clamp(v2.subVectors(p, a).dot(v1) / (v1.lengthSq() || 1), 0, 1);
        return v2.copy(a).addScaledVector(v1, t).distanceTo(p);
      };
      for (const c of cands) {
        const cy = yaw + c[0];
        // Test the lens where it will really sit: the look point is lifted towards it (see below).
        const cp = Math.min(62, pitch + c[1]);
        const cd = dist * c[2];
        const upK = kind === 'close' ? 0.2 : this.camMode === 'talk' || kind === 'two' ? 0.28 : 0.16;
        const lf = (cd * Math.tan(upK * Math.tan(THREE.MathUtils.degToRad(this.game.rc.camera.fov) / 2))) / Math.sin(THREE.MathUtils.degToRad(cp));
        const cyr = THREE.MathUtils.degToRad(cy);
        const pos = this.camPosFor(_q2.set(probe.x + Math.sin(cyr) * lf, probe.y, probe.z + Math.cos(cyr) * lf), cy, cp, cd);
        let h = this.buildingHits(pos, acts) * 10;
        for (const b of by) for (const a of acts) if (segD(pos, new THREE.Vector3(a.x, a.y + a.head * 0.6, a.z), b) < 0.55) h += 3;
        if (fy !== null && kind !== 'wide') {
          const cr = THREE.MathUtils.degToRad(cy);
          const off = Math.abs(Math.atan2(Math.sin(fy - cr), Math.cos(fy - cr)));
          if (off > THREE.MathUtils.degToRad(100)) h += 6;
          h += (Math.abs(off - 0.6) / Math.PI) * 3;
          if (lh) h += this.faceBlocked(pos, lead, acts) * 8;
        }
        h += Math.abs(c[0]) / 180 + c[1] / 60 + (1 - c[2]) * 2;
        if (h < bestHits) {
          bestHits = h;
          best = c;
        }
      }
      this.camPick = { key, t: this.clock, dy: best[0], dp: best[1], k: best[2] };
    }
    yaw += this.camPick.dy;
    pitch = Math.min(62, pitch + this.camPick.dp);
    dist *= this.camPick.k;
    // Lift the look point towards the lens so the actors sit ~26 % above centre (clear of the box).
    const fov = THREE.MathUtils.degToRad(this.game.rc.camera.fov);
    const up = kind === 'close' ? 0.2 : this.camMode === 'talk' || kind === 'two' ? 0.28 : 0.16;
    const lift = (dist * Math.tan(up * Math.tan(fov / 2))) / Math.sin(THREE.MathUtils.degToRad(pitch));
    const yr = THREE.MathUtils.degToRad(yaw);
    const gy = map.heightAt(cx, cz);
    const target = new THREE.Vector3(cx + Math.sin(yr) * lift, gy + lead.head * (kind === 'close' ? 0.5 : 0.42), cz + Math.cos(yr) * lift);
    const focus = new THREE.Vector3(cx, gy + 1.0, cz);
    return { yaw, pitch, dist, target, focus };
  }

  private updateCam(dt: number): void {
    const rig = this.game.rc.rig;
    if (this.camRelease && this.camSaved && !this.camMode) {
      const r = this.camRelease;
      r.t += dt;
      const u = Math.min(1, r.t / 0.7);
      const e = u * u * (3 - 2 * u);
      let dy = this.camSaved.yaw - r.from.yaw;
      dy = ((dy + 540) % 360) - 180;
      rig.yaw = r.from.yaw + dy * e;
      rig.pitch = THREE.MathUtils.lerp(r.from.pitch, this.camSaved.pitch, e);
      rig.distance = THREE.MathUtils.lerp(r.from.distance, this.camSaved.distance, e);
      rig.lookOffset.lerpVectors(r.from.off, this.camSaved.off, e);
      if (u >= 1) {
        this.camRelease = null;
        this.camSaved = null;
      }
    }
    if (!this.camMode) return;
    const g = this.shotGoal();
    if (!g) return;
    const k = 1 - Math.exp(-2.6 * dt);
    let dy = g.yaw - this.camCur.yaw;
    dy = ((dy + 540) % 360) - 180;
    this.camCur.yaw += dy * k;
    this.camCur.pitch += (g.pitch - this.camCur.pitch) * k;
    this.camCur.dist += (g.dist - this.camCur.dist) * k;
    this.camCur.target.lerp(g.target, k);
    this.applyCam();
    if (this.camMode === 'event') this.game.rc.focusPoint.lerp(g.focus, k);
    this.guardView();
  }

  // ── trees in the sight lines (same approach as the story cutscenes)

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

  /**
   * Tree instances as bounding spheres grouped by trunk position (canopy + trunk batches share a
   * spot), built once per map: occlusion tests are segment-vs-sphere, not triangle raycasts.
   */
  private treeBalls: { map: string; list: { c: THREE.Vector3; r: number; parts: { mesh: THREE.BatchedMesh; id: number }[] }[] } | null = null;
  private balls(): { c: THREE.Vector3; r: number; parts: { mesh: THREE.BatchedMesh; id: number }[] }[] {
    const map = this.game.world.current;
    if (!map) return [];
    if (this.treeBalls?.map === map.id) return this.treeBalls.list;
    const groups = new Map<string, { c: THREE.Vector3; r: number; parts: { mesh: THREE.BatchedMesh; id: number }[] }>();
    const m = new THREE.Matrix4();
    const sp = new THREE.Sphere();
    for (const mesh of this.trees()) {
      mesh.updateMatrixWorld();
      const max = (mesh as unknown as { maxInstanceCount?: number }).maxInstanceCount ?? 0;
      for (let i = 0; i < max; i++) {
        let gid: number;
        try {
          mesh.getMatrixAt(i, m);
          gid = mesh.getGeometryIdAt(i);
          if (gid < 0 || !mesh.getBoundingSphereAt(gid, sp)) continue;
        } catch {
          continue;
        }
        m.premultiply(mesh.matrixWorld);
        const base = new THREE.Vector3().setFromMatrixPosition(m);
        const key = `${Math.round(base.x * 10)},${Math.round(base.z * 10)}`;
        const c = sp.center.clone().applyMatrix4(m);
        const r = sp.radius * m.getMaxScaleOnAxis();
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { c, r, parts: [] }));
        else if (r > g.r) {
          g.c = c;
          g.r = r;
        }
        g.parts.push({ mesh, id: i });
      }
    }
    this.treeBalls = { map: map.id, list: [...groups.values()] };
    return this.treeBalls.list;
  }

  private treeHits(a: THREE.Vector3, b: THREE.Vector3): { mesh: THREE.BatchedMesh; id: number }[] {
    const out: { mesh: THREE.BatchedMesh; id: number }[] = [];
    const ab = _ab.subVectors(b, a);
    const len2 = ab.lengthSq() || 1;
    const q = _q;
    for (const g of this.balls()) {
      // Closest point on the segment to the canopy centre (spheres are loose: shrink 15 %).
      const t = THREE.MathUtils.clamp(q.subVectors(g.c, a).dot(ab) / len2, 0, 1);
      q.copy(a).addScaledVector(ab, t);
      const rr = g.r * 0.85;
      if (q.distanceToSquared(g.c) < rr * rr) out.push(...g.parts);
    }
    return out;
  }

  private hideTree(mesh: THREE.BatchedMesh, id: number): void {
    if (this.occluded.some((o) => o.mesh === mesh && o.id === id)) return;
    try {
      if (!mesh.getVisibleAt(id)) return;
      mesh.setVisibleAt(id, false);
      this.occluded.push({ mesh, id });
    } catch {
      /* instance gone */
    }
  }

  private restoreOccluders(): void {
    for (const o of this.occluded) {
      try {
        o.mesh.setVisibleAt(o.id, true);
      } catch {
        /* instance gone */
      }
    }
    this.occluded = [];
  }

  /** Every other frame: trees between the lens and an actor's head / chest are hidden for the scene. */
  private guardView(force = false): void {
    if (!force && ++this.occFrame % 3) return;
    const cam = this.game.rc.camera.position;
    for (const a of this.camActors())
      for (let k = 0; k < 2; k++) {
        _hp.set(a.x, a.y + (k ? a.head * 0.45 : a.head - 0.3), a.z);
        for (const h of this.treeHits(cam, _hp)) this.hideTree(h.mesh, h.id);
      }
  }

  /** Shot for a script beat (heart events). */
  private shotFor(ev: HeartEvent, i: number): void {
    const s = ev.script[i]!;
    const next = ev.script.slice(i + 1).find((x) => 'say' in x || 'choice' in x || 'narrate' in x);
    if ('say' in s) {
      this.lineNo++;
      const intimate = s.mood === 'sad' || s.mood === 'blush' || s.mood === 'worried';
      const close = intimate || (next !== undefined && 'choice' in next) || this.lineNo % 3 === 0;
      this.shot = { kind: close ? 'close' : 'two', speaker: s.say, anchor: null };
    } else if ('choice' in s) this.shot = { kind: 'two', speaker: s.choice, anchor: null };
    else if ('narrate' in s) this.shot = { kind: 'wide', speaker: null, anchor: null };
    else if ('walk' in s) this.shot = { kind: 'wide', speaker: s.walk === 'player' ? null : s.walk, anchor: null };
    else if ('cam' in s) this.shot = { kind: 'wide', speaker: null, anchor: s.cam };
  }

  private frame(ev: HeartEvent): void {
    this.baseYaw = ev.camera.yaw ?? 0;
    this.takeCam('event');
    this.lineNo = 0;
    this.shot = { kind: 'wide', speaker: null, anchor: null };
  }

  /** Apply a step instantly (fast-forward for staging). */
  private applyInstant(s: CutStep): void {
    const map = this.game.world.current!;
    if ('walk' in s) {
      const p = this.place(s.to);
      if (!p) return;
      if (s.walk === 'player') this.game.player.teleport(p.x, p.z);
      else {
        const a = this.agents.get(s.walk)!;
        a.v.setPosition(p.x, map.heightAt(p.x, p.z), p.z);
      }
      if (s.face) this.faceTo(s.walk, s.face);
      if (s.walk !== 'player') {
        const a = this.agents.get(s.walk)!;
        a.v.setYaw((a.v as unknown as { targetYaw: number }).targetYaw);
      }
    } else if ('face' in s) {
      this.faceTo(s.face, s.to);
      if (s.face !== 'player') {
        const a = this.agents.get(s.face)!;
        a.v.setYaw((a.v as unknown as { targetYaw: number }).targetYaw);
      }
    } else if ('act' in s) this.setActivity(this.agents.get(s.act)!, s.activity);
  }

  /** Friendship at least as high as the event requires (demos / staging: the meter must agree with the title card). */
  private seedFor(npc: NpcId, hearts: number): void {
    const rel = this.game.services.relationships;
    if (!rel) return;
    const want = hearts * 250 + 120;
    if (rel.points(npc) < want) rel.adjust(npc, want - rel.points(npc));
    rel.meet(npc);
  }

  stageEvent(id: string, step?: number): void {
    const he = heartEvent(id);
    if (!he || !this.active) return;
    const { npc, ev } = he;
    this.seedFor(npc.id, ev.hearts);
    // Morning events stage at mid-morning (clear of the dawn haze) unless they pin a time.
    const [h0, h1] = ev.hours;
    this.game.calendar.setHour(ev.demoTime ?? (h0 < 10 && h1 > 10.5 ? 10.5 : h0 + 0.5));
    // The hour jump must not trigger the 'big time jump' re-placement of everyone.
    this.lastHour = this.game.calendar.hour;
    this.lastQuarter = Math.floor(this.lastHour * 4);
    this.castEvent(ev);
    this.frame(ev);
    this.game.input.enabled = false;
    this.game.player.controllable = false;
    let mark = step ?? ev.script.findIndex((s) => 'choice' in s);
    if (mark < 0) mark = ev.script.findIndex((s) => 'say' in s);
    mark = Math.max(0, Math.min(ev.script.length - 1, mark));
    for (let i = 0; i < mark; i++) {
      this.applyInstant(ev.script[i]!);
      if ('say' in ev.script[i]!) this.lineNo++;
      if ('cam' in ev.script[i]!) this.shotFor(ev, i);
    }
    this.shotFor(ev, mark);
    for (const a of this.agents.values()) if (a.scripted) a.v.update(0, (x, z) => this.game.world.heightAt(x, z), false);
    // Show the last emote before the mark so the bubble is in the shot.
    for (let i = mark - 1; i >= 0; i--) {
      const s = ev.script[i]!;
      if ('emote' in s) {
        this.who(s.emote)?.v.emote(s.icon);
        break;
      }
      if ('say' in s || 'choice' in s) break;
    }
    const box = this.game.services.dialogueBox;
    box?.cinema(true, ev.title, `${npc.name.split(' ')[0]} · ${ev.hearts} hearts`);
    this.snapCam();
    this.guardView(true);
    const s = ev.script[mark];
    if (!s || !box) return;
    if ('choice' in s) void box.choose(s.choice, s.q, s.options.map((o) => o.text), 'thinking');
    else if ('say' in s) {
      void box.say(s.say, s.text, s.mood);
      window.setTimeout(() => box.finishLine(), 30);
    } else if ('narrate' in s) {
      void box.narrate(s.narrate);
      window.setTimeout(() => box.finishLine(), 30);
    }
  }

  async playEvent(id: string): Promise<void> {
    const he = heartEvent(id);
    if (!he || this.eventRunning) return;
    const { npc, ev } = he;
    if (this.game.world.current?.id !== 'town') {
      const c = ev.cast.player;
      const p = c ? this.place(c[0]) : null;
      await this.game.teleport('town', p?.x ?? 32, p?.z ?? 28);
    }
    this.eventRunning = true;
    this.seen.add(id);
    this.game.events.emit('npc:event', { id, npcId: npc.id, phase: 'start' });
    this.game.events.emit('ui:open', { name: 'none' });
    this.game.input.enabled = false;
    this.game.player.controllable = false;
    const box = this.game.services.dialogueBox;
    await this.game.hud.fade(true);
    this.castEvent(ev);
    this.frame(ev);
    this.snapCam();
    this.guardView(true);
    await this.game.hud.fade(false);
    box?.cinema(true, ev.title, `${npc.name.split(' ')[0]} · ${ev.hearts} hearts`);
    await this.wait(1.6);
    let boxOpen = false;
    for (let i = 0; i < ev.script.length; i++) {
      const s = ev.script[i]!;
      const talky = 'say' in s || 'choice' in s || 'narrate' in s;
      if (!talky && boxOpen && !('emote' in s)) {
        box?.end();
        boxOpen = false;
      }
      this.shotFor(ev, i);
      if ('say' in s) {
        boxOpen = true;
        this.faceSpeaker(s.say);
        await box?.say(s.say, s.text, s.mood);
      } else if ('narrate' in s) {
        boxOpen = true;
        await box?.narrate(s.narrate);
      } else if ('choice' in s) {
        boxOpen = true;
        const k = (await box?.choose(s.choice, s.q, s.options.map((o) => o.text), 'thinking')) ?? 0;
        const opt = s.options[k]!;
        this.game.events.emit('npc:choice', { npcId: s.choice, delta: opt.delta });
        if (opt.mood === 'blush' || opt.mood === 'sad') this.shot = { kind: 'close', speaker: s.choice, anchor: null };
        await box?.say(s.choice, opt.reply, opt.mood ?? 'happy');
      } else if ('walk' in s) await this.walkActor(s.walk, s.to, s.face, s.run);
      else if ('face' in s) {
        this.faceTo(s.face, s.to);
        await this.wait(0.35);
      } else if ('emote' in s) {
        const w = this.who(s.emote);
        w?.v.emote(s.icon);
        if (w && s.icon === 'heart') {
          w.v.squash(1.1);
          this.fx.burst(new THREE.Vector3(w.v.position.x, w.v.position.y + w.v.headTop + 0.2, w.v.position.z), 'like');
        }
        await this.wait(1.1);
      } else if ('act' in s) {
        this.setActivity(this.agents.get(s.act)!, s.activity);
      } else if ('wait' in s) await this.wait(s.wait);
      else if ('cam' in s) await this.wait(1.0);
      else if ('fade' in s) await this.game.hud.fade(s.fade === 'out');
    }
    await this.wait(1.4);
    box?.end();
    box?.cinema(false);
    await this.game.hud.fade(true);
    this.endEvent();
    await this.game.hud.fade(false);
    this.game.events.emit('npc:event', { id, npcId: npc.id, phase: 'end' });
  }

  private faceSpeaker(id: NpcId): void {
    const a = this.agents.get(id);
    if (!a) return;
    // Listeners turn towards whoever is talking (only the player, here).
    const p = this.game.player.position;
    if (Math.hypot(p.x - a.v.position.x, p.z - a.v.position.z) < 5) this.faceTo('player', id);
  }

  private walkActor(w: Who, to: Place, face: Facing | Who | undefined, run = false): Promise<void> {
    const p = this.place(to);
    const map = this.game.world.current;
    if (!p || !map) return Promise.resolve();
    return new Promise((resolve) => {
      if (w === 'player') {
        const pp = this.game.player.position;
        const path = findPath(map.grid, pp.x, pp.z, p.x, p.z);
        this.playerPath = path.length ? path.slice(1) : [{ x: p.x, z: p.z }];
        this.playerArrive = {
          resolve: () => {
            if (face) this.faceTo('player', face);
            resolve();
          },
        };
        return;
      }
      const a = this.agents.get(w)!;
      const path = findPath(map.grid, a.v.position.x, a.v.position.z, p.x, p.z);
      a.path = path.length ? path.slice(1) : [{ x: p.x, z: p.z }];
      a.goal = null;
      a.run = run;
      a.onArrive = () => {
        if (face) this.faceTo(w, face);
        resolve();
      };
      this.nextWaypoint(a);
    });
  }

  private endEvent(): void {
    for (const a of this.agents.values()) a.scripted = false;
    this.clearEventProps();
    this.releaseCam();
    this.camRelease = null;
    const rig = this.game.rc.rig;
    if (this.camSaved) {
      rig.yaw = this.camSaved.yaw;
      rig.pitch = this.camSaved.pitch;
      rig.distance = this.camSaved.distance;
      rig.lookOffset.copy(this.camSaved.off);
      this.camSaved = null;
    }
    this.playerPath = [];
    this.playerArrive = null;
    this.game.input.enabled = true;
    this.game.player.controllable = true;
    this.eventRunning = false;
    this.placeAll();
    this.game.followPlayer(true);
  }

  auditEvents(only?: string): { beats: number; fails: string[]; trees: number } {
    const out = { beats: 0, fails: [] as string[], trees: 0 };
    if (!this.active || this.eventRunning) return { ...out, fails: ['not in town / event running'] };
    const cam = this.game.rc.camera;
    const savedHour = this.game.calendar.hour;
    const savedP = this.game.player.position.clone();
    for (const npc of Object.values(NPCS))
      for (const ev of npc.events) {
        if (only && ev.id !== only) continue;
        this.castEvent(ev);
        this.frame(ev);
        this.lineNo = 0;
        for (let i = 0; i < ev.script.length; i++) {
          const s = ev.script[i]!;
          if ('cam' in s) this.shotFor(ev, i);
          if ('say' in s || 'choice' in s || 'narrate' in s) {
            this.shotFor(ev, i);
            for (const a of this.agents.values()) if (a.scripted) a.v.update(0, (x, z) => this.game.world.heightAt(x, z), false);
            this.snapCam();
            out.beats++;
            const acts = this.camActors();
            const hits = this.buildingHits(cam.position, acts);
            if (hits) out.fails.push(`${ev.id}#${i}: ${hits} sight line(s) behind a building (lens ${cam.position.x.toFixed(1)},${cam.position.y.toFixed(1)},${cam.position.z.toFixed(1)}; ${acts.map((a) => `${a.id} ${a.x.toFixed(1)},${a.z.toFixed(1)}`).join(' ')})`);
            // The speaker's face must read: turned towards the lens and not behind the listener's head / hat.
            const spk = this.shot.speaker ? acts.find((a) => a.id === this.shot.speaker) : null;
            const sa = spk && spk.id !== 'player' ? this.agents.get(spk.id) : null;
            if (spk && sa && this.shot.kind !== 'wide') {
              const fy = (sa.v as unknown as { yaw: number }).yaw;
              const toC = Math.atan2(cam.position.x - spk.x, cam.position.z - spk.z);
              const off = Math.abs(Math.atan2(Math.sin(fy - toC), Math.cos(fy - toC)));
              if (off > THREE.MathUtils.degToRad(105)) out.fails.push(`${ev.id}#${i}: ${spk.id} turned from the lens (${THREE.MathUtils.radToDeg(off).toFixed(0)}°)`);
              const fb = this.faceBlocked(cam.position, spk, acts);
              if (fb) out.fails.push(`${ev.id}#${i}: ${spk.id}'s face behind another actor (${fb}/2 points)`);
            }
            for (const a of acts) {
              if (this.shot.kind === 'close' && a.id !== this.shot.speaker) continue;
              const t = this.treeHits(cam.position, new THREE.Vector3(a.x, a.y + a.head - 0.3, a.z)).length;
              out.trees += t;
              const hp = new THREE.Vector3(a.x, a.y + a.head - 0.2, a.z).project(cam);
              const fp = new THREE.Vector3(a.x, a.y + 0.1, a.z).project(cam);
              // Off-frame, or the feet under the dialogue box (its top sits ~ -0.36 NDC with the letterbox).
              if (Math.abs(hp.x) > 0.93 || hp.y > 0.8 || fp.y < -0.36) out.fails.push(`${ev.id}#${i}: ${a.id} framed badly (head ${hp.x.toFixed(2)},${hp.y.toFixed(2)} feet ${fp.y.toFixed(2)})`);
            }
          } else this.applyInstant(s);
        }
        for (const a of this.agents.values()) a.scripted = false;
      }
    this.clearEventProps();
    this.releaseCam();
    this.camRelease = null;
    if (this.camSaved) {
      const rig = this.game.rc.rig;
      rig.yaw = this.camSaved.yaw;
      rig.pitch = this.camSaved.pitch;
      rig.distance = this.camSaved.distance;
      rig.lookOffset.copy(this.camSaved.off);
      this.camSaved = null;
    }
    this.game.calendar.setHour(savedHour);
    this.game.player.teleport(savedP.x, savedP.z);
    this.placeAll();
    this.game.followPlayer(true);
    return out;
  }

  private checkEvents(): void {
    if (this.eventRunning || this.staged || !this.game.input.enabled || !this.game.player.controllable) return;
    const rel = this.game.services.relationships;
    if (!rel) return;
    const c = this.game.calendar;
    const p = this.game.player.position;
    for (const a of this.agents.values()) {
      const hearts = rel.hearts(a.def.id);
      const ev = a.def.events.find((e) => !this.seen.has(e.id) && hearts >= e.hearts);
      if (!ev) continue;
      if (c.hour < ev.hours[0] || c.hour > ev.hours[1]) continue;
      if (ev.dry && (c.weather === 'rain' || c.weather === 'storm' || c.weather === 'snow')) continue;
      const anchor = this.place(ev.cast[a.def.id]?.[0] ?? [a.v.position.x, a.v.position.z]);
      if (!anchor || Math.hypot(anchor.x - p.x, anchor.z - p.z) > 8) continue;
      void this.playEvent(ev.id);
      return;
    }
  }

  // ───────────────────────────────────────────── per frame

  fixedUpdate(dt: number): void {
    // Scripted player walks: drive position + velocity so the farmer animates its walk cycle.
    if (!this.playerPath.length) return;
    const pl = this.game.player;
    const tgt = this.playerPath[0]!;
    const dx = tgt.x - pl.position.x;
    const dz = tgt.z - pl.position.z;
    const d = Math.hypot(dx, dz);
    const speed = 2.3;
    const pv = pl as unknown as { velocity?: THREE.Vector3; targetYaw?: number };
    if (d <= speed * dt) {
      pl.position.set(tgt.x, this.game.world.heightAt(tgt.x, tgt.z), tgt.z);
      this.playerPath.shift();
      if (!this.playerPath.length) {
        pv.velocity?.set(0, 0, 0);
        const r = this.playerArrive;
        this.playerArrive = null;
        r?.resolve();
      }
      return;
    }
    pl.position.x += (dx / d) * speed * dt;
    pl.position.z += (dz / d) * speed * dt;
    pl.position.y = this.game.world.heightAt(pl.position.x, pl.position.z);
    pv.velocity?.set((dx / d) * speed, 0, (dz / d) * speed);
    if (pv.targetYaw !== undefined) pv.targetYaw = Math.atan2(dx, dz);
  }

  update(dt: number, game: Game): void {
    this.clock += dt;
    if (this.waits.length) {
      const due = this.waits.filter((w) => w.t <= this.clock);
      if (due.length) {
        this.waits = this.waits.filter((w) => w.t > this.clock);
        for (const w of due) w.r();
      }
    }
    if (!this.active) return;
    const map = game.world.current!;
    if (this.restage !== null) {
      const name = this.restage;
      this.restage = null;
      this.stage(name);
    }
    const hour = game.calendar.hour;
    // Big time jumps (setTime, sleeping): re-place instantly.
    if (!this.eventRunning && Math.abs(hour - this.lastHour) > 0.6) this.placeAll();
    this.lastHour = hour;
    const q = Math.floor(hour * 4);
    if (q !== this.lastQuarter && !this.staged && !this.eventRunning) {
      this.lastQuarter = q;
      for (const a of this.agents.values()) {
        if (a.scripted || a === this.talking) continue;
        const [, spotName, act] = this.stepFor(a, hour);
        const key = `${spotName}|${act ?? 'idle'}`;
        if (key !== a.stepKey) {
          a.stepKey = key;
          this.goTo(a, spotName, act ?? 'idle');
        }
      }
    }
    // Camera direction during heart events / conversations.
    this.updateCam(dt);
    this.updateKeyLight(dt, game);
    this.fx.update(dt);
    const winter = game.calendar.season === 'winter';
    for (const a of this.agents.values()) a.v.setWinter(winter);
    const simulate = !game.paused || this.eventRunning;
    const h = (x: number, z: number): number => map.heightAt(x, z);
    const pl = game.player.position;
    // Every farmer in town (co-op: remote farmers too) — villagers glance at and greet whoever passes.
    this.farmers.length = 0;
    this.farmers.push(pl);
    for (const o of game.scene.children) if (o.name === 'remote-farmer' && o.visible) this.farmers.push(o.position);
    for (const a of this.agents.values()) {
      const v = a.v;
      // Door fades.
      if (a.vis !== a.visTarget) {
        a.vis += Math.sign(a.visTarget - a.vis) * Math.min(Math.abs(a.visTarget - a.vis), dt * 2.5);
        v.root.visible = a.vis > 0.01;
        const s = 0.6 + 0.4 * a.vis;
        v.root.scale.set(s, a.vis < 1 ? 0.8 + 0.2 * a.vis : 1, s);
      }
      if (!v.root.visible && a.inside) continue;
      if (simulate && !v.hasTarget && a.path.length === 0 && a.onArrive) this.nextWaypoint(a);
      else if (simulate && !v.hasTarget && a.path.length) this.nextWaypoint(a);
      if (!a.scripted && !a.inside && !v.hasTarget && !a.path.length && v !== this.talking?.v) this.ambient(a, dt, simulate, pl);
      v.update(dt, h, simulate);
    }
    this.updateBlobs();
    this.updateEasels(map.root);
    if (!this.eventRunning && !game.paused) {
      this.eventCheckT -= dt;
      if (this.eventCheckT <= 0) {
        this.eventCheckT = 1;
        this.checkEvents();
      }
    }
  }

  private easels: { root: THREE.Object3D; list: THREE.Object3D[] } | null = null;
  /** A painter's easel stands in the street only while someone paints at it. */
  private updateEasels(root: THREE.Object3D): void {
    if (this.easels?.root !== root) {
      const list: THREE.Object3D[] = [];
      root.traverse((o) => {
        if (o.name === 'painter-easel') list.push(o);
      });
      this.easels = { root, list };
    }
    for (const e of this.easels.list) {
      let on = false;
      for (const a of this.agents.values())
        if (a.activity === 'paint' && !a.inside && a.v.root.visible && Math.hypot(a.v.position.x - e.position.x, a.v.position.z - e.position.z) < 1.8) on = true;
      e.visible = on;
    }
  }

  private updateBlobs(): void {
    let i = 0;
    for (const a of this.agents.values()) {
      const v = a.v;
      const s = v.root.visible ? v.blobR * v.root.scale.x : 0;
      this.blobM.makeScale(s, 1, s).setPosition(v.root.position.x, v.root.position.y + 0.03, v.root.position.z);
      this.blobs.setMatrixAt(i++, this.blobM);
    }
    this.blobs.instanceMatrix.needsUpdate = true;
  }

  /** Night scenes: lift the faces of whoever is talking with a soft warm key from camera-side. */
  private updateKeyLight(dt: number, game: Game): void {
    const night = game.lighting.night;
    let want = 0;
    const yaw = THREE.MathUtils.degToRad(game.rc.rig.yaw);
    const cx = Math.sin(yaw);
    const cz = Math.cos(yaw);
    if (this.camMode === 'event') {
      // lookPoint sits camera-side of the actors: the key hangs just behind it.
      want = 1;
      this.keyPos.set(this.lookPoint.x - cx * 0.6 + cz * 0.6, 0, this.lookPoint.z - cz * 0.6 - cx * 0.6);
    } else if (this.talking) {
      want = 1;
      const a = this.talking.v.position;
      const p = game.player.position;
      this.keyPos.set((a.x + p.x) / 2 + cx * 1.2, 0, (a.z + p.z) / 2 + cz * 1.2);
    }
    const map = game.world.current;
    if (map && want) this.keyLight.position.set(this.keyPos.x, map.heightAt(this.keyPos.x, this.keyPos.z) + 2.6, this.keyPos.z);
    const target = want * night * 7;
    this.keyLight.intensity += (target - this.keyLight.intensity) * (1 - Math.exp(-4 * dt));
    if (this.keyLight.intensity < 0.01 && !want) this.keyLight.intensity = 0;
  }

  /** Idle life at the spot: wander, play laps, chat, glance at the player, emotes. */
  private farmers: THREE.Vector3[] = [];

  private ambient(a: Agent, dt: number, simulate: boolean, pl0: THREE.Vector3): void {
    // The nearest farmer (local or co-op) is the one a villager reacts to.
    let pl = pl0;
    let best = Infinity;
    for (const f of this.farmers) {
      const d = Math.hypot(f.x - a.v.position.x, f.z - a.v.position.z);
      if (d < best) {
        best = d;
        pl = f;
      }
    }
    // A wave hello when a farmer walks up (at most every 40 s per villager).
    a.greetT = (a.greetT ?? 0) - dt;
    if (best < 2.6 && a.greetT <= 0 && simulate && !a.staged && a.activity !== 'sit' && a.activity !== 'paint') {
      a.greetT = 40;
      a.v.facePoint(pl.x, pl.z);
      a.v.gesture('wave', 1.6);
      if (a.emoteT <= 1) {
        a.v.emote('music');
        a.emoteT = 6;
      }
    }
    const v = a.v;
    const map = this.game.world.current!;
    const anchor = a.anchor ?? { x: v.position.x, z: v.position.z };
    a.emoteT -= dt;
    if (a.activity === 'wander' && simulate) {
      a.wanderT -= dt;
      if (a.wanderT <= 0) {
        a.wanderT = 5 + Math.random() * 5;
        for (let k = 0; k < 6; k++) {
          const x = anchor.x + (Math.random() - 0.5) * 7;
          const z = anchor.z + (Math.random() - 0.5) * 7;
          if (map.grid.isWalkable(Math.floor(x), Math.floor(z))) {
            v.walkTo(x, z, Math.random() * Math.PI * 2);
            break;
          }
        }
      }
    } else if (a.activity === 'play' && simulate) {
      a.wanderT -= dt;
      if (a.wanderT <= 0) {
        // A running lap around the anchor, then a breather.
        a.wanderT = 7 + Math.random() * 4;
        const pts: Waypoint[] = [];
        const r = 2.2 + Math.random() * 1.2;
        const a0 = Math.random() * Math.PI * 2;
        for (let k = 1; k <= 6; k++) {
          const ang = a0 + (k / 6) * Math.PI * 2;
          const x = anchor.x + Math.cos(ang) * r;
          const z = anchor.z + Math.sin(ang) * r;
          if (map.grid.isWalkable(Math.floor(x), Math.floor(z))) pts.push({ x, z });
        }
        a.path = pts;
        a.run = true;
        a.goal = null;
        a.onArrive = () => {
          v.faceYaw(0);
          if (Math.random() < 0.5) v.emote(Math.random() < 0.5 ? 'music' : 'exclaim');
        };
        this.nextWaypoint(a);
      }
    } else if (a.activity === 'chat' || a.activity === 'idle') {
      // Chat partner: the nearest other villager standing still within 4 m.
      let partner: Agent | null = null;
      let bd = 4.2;
      for (const b of this.agents.values()) {
        if (b === a || b.inside || b.v.isMoving) continue;
        const d = Math.hypot(b.v.position.x - v.position.x, b.v.position.z - v.position.z);
        if (d < bd && (b.activity === 'chat' || b.activity === 'idle' || b.activity === 'sit')) {
          bd = d;
          partner = b;
        }
      }
      const pd = Math.hypot(pl.x - v.position.x, pl.z - v.position.z);
      if (a.staged) {
        /* hold the blocking */
      } else if (a.activity === 'chat' && partner) {
        // Turn to the partner, but cheat three-quarter towards the lens (stage blocking) so both
        // faces read from the diorama camera instead of two profiles / a back of the head.
        const toP = Math.atan2(partner.v.position.x - v.position.x, partner.v.position.z - v.position.z);
        const cam = this.game.rc.camera.position;
        const toC = Math.atan2(cam.x - v.position.x, cam.z - v.position.z);
        let dc = toC - toP;
        dc = Math.atan2(Math.sin(dc), Math.cos(dc));
        v.faceYaw(toP + THREE.MathUtils.clamp(dc, -0.75, 0.75));
        a.chatT -= dt;
        if (a.chatT <= 0) {
          a.chatT = 1.8 + Math.random() * 2.4;
          v.speaking = !v.speaking && !partner.v.speaking;
          if (a.emoteT <= 0 && Math.random() < 0.4) {
            a.emoteT = 6 + Math.random() * 8;
            v.emote(EMOTES_CHAT[Math.floor(Math.random() * EMOTES_CHAT.length)]!);
          }
        }
      } else if (pd < 3.2 && a.activity === 'idle') {
        v.facePoint(pl.x, pl.z);
        v.speaking = false;
      } else v.speaking = false;
    }
    // Occasional ambient emotes while working / sitting.
    if (a.emoteT <= 0) {
      a.emoteT = 9 + Math.random() * 14;
      const late = this.game.calendar.hour > 21;
      const e: Emote | null = a.activity === 'paint' ? 'idea' : a.activity === 'sit' && late ? 'zzz' : a.activity === 'read' ? 'dots' : a.activity === 'water' || a.activity === 'knead' ? 'music' : a.activity === 'fish' ? 'question' : null;
      if (e && Math.random() < 0.6) v.emote(e);
    }
  }

  save(): unknown {
    return { seen: [...this.seen] };
  }

  load(data: unknown): void {
    const d = data as { seen?: string[] };
    if (d?.seen) this.seen = new Set(d.seen);
  }
}
