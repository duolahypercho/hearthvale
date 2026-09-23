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
import { Villager } from '../entities/villager';
import { SPOTS } from '../world/town/layout';
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
  }
}

const FACING_YAW: Record<Facing, number> = { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };
const PLAZA_C = { x: 32, z: 25, r: 3.55 };
const EMOTES_CHAT: Emote[] = ['music', 'exclaim', 'question', 'heart', 'dots', 'idea'];

/** Beauty-shot blocking for the town demos: [villager, x, z, yaw (deg, 0 = facing camera), activity]. */
type Mark = [NpcId, number, number, number, Activity];
const STAGES: Record<string, Mark[]> = {
  'town-day': [
    ['marigold', 20.4, 21.1, 20, 'sweep'],
    ['hazel', 28.6, 15.4, 180, 'water'],
    ['tobias', 25.75, 23.8, 100, 'sit'],
    ['wren', 25.3, 22.25, 175, 'paint'],
    ['bram', 42.4, 20.9, -15, 'knead'],
    ['odessa', 43.7, 22.3, -120, 'chat'],
    ['kit', 37.6, 27.4, -40, 'play'],
    ['june', 29.0, 27.9, 60, 'chat'],
    ['linus', 30.3, 28.5, -110, 'chat'],
    ['rowan', 27.6, 20.9, 170, 'idle'],
  ],
  'town-evening': [
    ['tobias', 33.3, 14.4, 180, 'idle'],
    ['kit', 31.3, 14.1, 20, 'sit'],
    ['marigold', 27.4, 20.9, 180, 'read'],
    ['hazel', 25.75, 23.8, 100, 'sit'],
    ['wren', 32.3, 27.7, 0, 'sit'],
    ['bram', 44.6, 22.7, -150, 'chat'],
    ['june', 45.5, 21.4, -40, 'chat'],
    ['odessa', 38.9, 25.7, -60, 'chat'],
    ['rowan', 37.7, 26.6, 120, 'chat'],
    ['linus', 21.8, 24.6, 60, 'read'],
  ],
  'town-winter': [
    ['marigold', 20.4, 21.1, 20, 'sweep'],
    ['tobias', 25.75, 23.8, 100, 'sit'],
    ['bram', 42.4, 20.9, -15, 'knead'],
    ['kit', 37.6, 27.4, -40, 'play'],
    ['odessa', 29.0, 27.9, 60, 'chat'],
    ['rowan', 30.3, 28.5, -110, 'chat'],
    ['june', 44.4, 22.8, -130, 'chat'],
    ['linus', 43.4, 21.9, 50, 'chat'],
    ['wren', 33.4, 14.9, 180, 'idle'],
    ['hazel', 36.0, 20.6, 200, 'idle'],
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
  private camGoal: THREE.Vector3 | null = null;
  private camSaved: { yaw: number; pitch: number; distance: number; off: THREE.Vector3 } | null = null;
  private lookPoint = new THREE.Vector3();
  /** Heart events: the camera follows the actors' centroid until a scripted 'cam' beat takes over. */
  private camTrack = false;
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
    });
    game.hud.registerPanel('social', new SocialPanel(game, game.hud.root));
    game.hud.registerPanel('portraits', new PortraitSheetPanel(game, game.hud.root));
    game.events.on('player:interact', ({ x, z }) => this.tryTalk(x, z));
    game.events.on('ui:close', ({ name }) => {
      if (name === 'dialogue' && this.talking) {
        this.talking.v.talkTo = null;
        this.talking.v.speaking = false;
        this.talking = null;
      }
    });
    game.events.on('dialogue:speaking', ({ id, on }) => {
      const a = this.agents.get(id as NpcId);
      if (a) a.v.speaking = on;
    });
    game.events.on('npc:emote', ({ id, emote }) => this.agents.get(id as NpcId)?.v.emote(emote));
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
    const g = pickGroup(def, { first: (rel?.talks(id) ?? 0) === 0, season: c.season, weather: c.weather, hour: c.hour, hearts, birthday });
    // Rotate through the group's lines by talk count so repeat visits feel fresh.
    let lines = g?.lines ?? ['...'];
    const talks = rel?.talks(id) ?? 0;
    if (!g?.first && lines.length > 1) lines = [lines[talks % lines.length]!];
    const ask = g?.ask && !(rel?.talkedToday(id) ?? false) ? g.ask : undefined;
    return { id: def.id, name: def.name, role: def.role, lines, ask, hearts, birthday, look: def.look, portraitBg: def.portraitBg };
  }

  private tryTalk(x: number, z: number): void {
    if (!this.active || this.eventRunning) return;
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
  }

  // ───────────────────────────────────────────── map + placement

  onMapChange(mapId: string, game: Game): void {
    const map = game.world.current;
    this.active = mapId === 'town' && !!map;
    for (const a of this.agents.values()) a.v.root.removeFromParent();
    this.keyLight.removeFromParent();
    this.blobs.removeFromParent();
    if (!this.active || !map) return;
    map.root.add(this.blobs);
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
      for (const [id, x, z, deg, act] of marks) {
        const a = this.agents.get(id)!;
        this.setInside(a, false, true);
        a.v.setPosition(x, map.heightAt(x, z), z);
        a.v.setYaw((deg * Math.PI) / 180);
        this.setActivity(a, act);
        a.anchor = { x, z };
        a.stepKey = '';
        if (act === 'chat') a.v.speaking = Math.random() < 0.5;
      }
      return;
    }
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
      a.v.talkTo = p;
      this.talking = a;
      const mood = params.get('mood');
      const extra = params.get('gift') ? `/gift/${params.get('gift')}` : mood ? `/${mood}` : params.get('ask') ? '/ask' : '';
      this.game.events.emit('ui:open', { name: `dialogue:${a.def.id}${extra}` });
      window.setTimeout(() => this.game.services.dialogueBox?.finishLine(), 30);
      return;
    }
    if (name === 'town-heart-event') {
      const ev = params.get('event') ?? 'wren-2';
      const step = params.get('step');
      this.stageEvent(ev, step !== null ? Number(step) : undefined);
    }
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
  }

  private frame(ev: HeartEvent): void {
    const rig = this.game.rc.rig;
    if (!this.camSaved) this.camSaved = { yaw: rig.yaw, pitch: rig.pitch, distance: rig.distance, off: rig.lookOffset.clone() };
    rig.yaw = ev.camera.yaw ?? 0;
    // Never lower than 45°: flatter angles let street trees and eaves swallow the actors.
    rig.pitch = Math.max(45, ev.camera.pitch ?? 45);
    rig.distance = ev.camera.distance ?? 15;
    this.camGoal = new THREE.Vector3(ev.camera.x, 0, ev.camera.z);
    this.camTrack = true;
    this.trackActors(true);
  }

  /**
   * Frame the actors (scripted villagers + the farmer) in the upper-middle of the screen, clear of
   * the dialogue box: the look point sits a little south of their centroid.
   */
  private trackActors(snap = false): void {
    if (!this.camGoal) return;
    let x = 0;
    let z = 0;
    let n = 0;
    for (const a of this.agents.values()) {
      if (!a.scripted || a.inside) continue;
      x += a.v.position.x;
      z += a.v.position.z;
      n++;
    }
    if (!n) return;
    const p = this.game.player.position;
    // The farmer counts half: villagers are the subject.
    x = (x + p.x * 0.5) / (n + 0.5);
    z = (z + p.z * 0.5) / (n + 0.5);
    // Offset towards the camera so the actors sit up-screen, clear of the dialogue box.
    const yaw = THREE.MathUtils.degToRad(this.game.rc.rig.yaw);
    this.camGoal.set(x + Math.sin(yaw) * 1.5, 0, z + Math.cos(yaw) * 1.5);
    if (snap) this.lookPoint.copy(this.camGoal);
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
    else if ('cam' in s) {
      this.camTrack = false;
      this.camGoal = new THREE.Vector3(s.cam.x, 0, s.cam.z);
      this.lookPoint.copy(this.camGoal);
    }
  }

  stageEvent(id: string, step?: number): void {
    const he = heartEvent(id);
    if (!he || !this.active) return;
    const { npc, ev } = he;
    this.game.calendar.setHour(ev.demoTime ?? ev.hours[0] + 0.5);
    // The hour jump must not trigger the 'big time jump' re-placement of everyone.
    this.lastHour = this.game.calendar.hour;
    this.lastQuarter = Math.floor(this.lastHour * 4);
    this.castEvent(ev);
    this.frame(ev);
    this.game.input.enabled = false;
    this.game.player.controllable = false;
    let mark = step ?? ev.script.findIndex((s) => 'choice' in s);
    if (mark < 0) mark = ev.script.findIndex((s) => 'say' in s);
    for (let i = 0; i < mark; i++) this.applyInstant(ev.script[i]!);
    if (this.camTrack) this.trackActors(true);
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
    box?.cinema(true);
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
    void npc;
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
    this.game.followPlayer(true);
    const rig = this.game.rc.rig;
    rig.lookOffset.set(this.lookPoint.x - this.game.player.position.x, 0, this.lookPoint.z - this.game.player.position.z);
    rig.snap();
    await this.game.hud.fade(false);
    box?.cinema(true, ev.title, `${npc.name.split(' ')[0]} · ${ev.hearts} hearts`);
    await this.wait(1.6);
    let boxOpen = false;
    for (const s of ev.script) {
      const talky = 'say' in s || 'choice' in s || 'narrate' in s;
      if (!talky && boxOpen && !('emote' in s)) {
        box?.end();
        boxOpen = false;
      }
      if ('say' in s) {
        boxOpen = true;
        this.faceSpeaker(s.say);
        await box?.say(s.say, s.text, s.mood);
      } else if ('narrate' in s) {
        boxOpen = true;
        await box?.narrate(s.narrate);
      } else if ('choice' in s) {
        boxOpen = true;
        const i = (await box?.choose(s.choice, s.q, s.options.map((o) => o.text), 'thinking')) ?? 0;
        const opt = s.options[i]!;
        this.game.events.emit('npc:choice', { npcId: s.choice, delta: opt.delta });
        await box?.say(s.choice, opt.reply, opt.mood ?? 'happy');
      } else if ('walk' in s) await this.walkActor(s.walk, s.to, s.face, s.run);
      else if ('face' in s) {
        this.faceTo(s.face, s.to);
        await this.wait(0.35);
      } else if ('emote' in s) {
        this.who(s.emote)?.v.emote(s.icon);
        await this.wait(1.1);
      } else if ('act' in s) {
        this.setActivity(this.agents.get(s.act)!, s.activity);
      } else if ('wait' in s) await this.wait(s.wait);
      else if ('cam' in s) {
        this.camTrack = false;
        this.camGoal = new THREE.Vector3(s.cam.x, 0, s.cam.z);
        if (s.cam.yaw !== undefined) rig.yaw = s.cam.yaw;
        if (s.cam.pitch !== undefined) rig.pitch = Math.max(45, s.cam.pitch);
        if (s.cam.distance !== undefined) rig.distance = s.cam.distance;
        await this.wait(1.0);
      } else if ('fade' in s) await this.game.hud.fade(s.fade === 'out');
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
    const rig = this.game.rc.rig;
    if (this.camSaved) {
      rig.yaw = this.camSaved.yaw;
      rig.pitch = this.camSaved.pitch;
      rig.distance = this.camSaved.distance;
      rig.lookOffset.copy(this.camSaved.off);
      this.camSaved = null;
    }
    this.camGoal = null;
    this.camTrack = false;
    this.playerPath = [];
    this.playerArrive = null;
    this.game.input.enabled = true;
    this.game.player.controllable = true;
    this.eventRunning = false;
    this.placeAll();
    this.game.followPlayer(true);
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
    // Camera framing during events: keep the look point fixed while the player moves.
    this.updateKeyLight(dt, game);
    if (this.camGoal) {
      if (this.camTrack) this.trackActors();
      this.lookPoint.lerp(this.camGoal, 1 - Math.exp(-3 * dt));
      const p = game.player.position;
      game.rc.rig.lookOffset.set(this.lookPoint.x - p.x, 0, this.lookPoint.z - p.z);
    }
    const simulate = !game.paused || this.eventRunning;
    const h = (x: number, z: number): number => map.heightAt(x, z);
    const pl = game.player.position;
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
    if (!this.eventRunning && !game.paused) {
      this.eventCheckT -= dt;
      if (this.eventCheckT <= 0) {
        this.eventCheckT = 1;
        this.checkEvents();
      }
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
    if (this.camGoal) {
      // lookPoint already sits 1.5 m camera-side of the actors: the key hangs just behind it.
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
  private ambient(a: Agent, dt: number, simulate: boolean, pl: THREE.Vector3): void {
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
      if (a.activity === 'chat' && partner) {
        v.facePoint(partner.v.position.x, partner.v.position.z);
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
