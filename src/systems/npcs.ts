/**
 * NpcSystem: the villagers of Hearthvale. Spawns one Villager per data/npcs.ts entry on the
 * town map, walks them along their daily schedule, and handles talking:
 *   player:interact next to a villager → ui:open 'dialogue:<id>' (villager turns to the player).
 * Friendship (points, hearts, gifts) lives in RelationshipSystem; this reads it via services.
 *
 * Service `npcs` (for the dialogue UI): conversation(id) → name, role, lines, hearts, portrait look.
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { NPCS, NPC_IDS, FESTIVAL_EXTRAS, pickLines, type NpcId, type NpcLook } from '../data/npcs';
import { Villager } from '../entities/villager';

export interface Conversation {
  id: NpcId;
  name: string;
  role: string;
  lines: string[];
  hearts: number;
  look: NpcLook;
  portraitBg: [number, number];
}

export interface NpcApi {
  conversation(id: string): Conversation | null;
  /** World positions of the villagers on the current map. */
  positions(): { id: NpcId; x: number; z: number }[];
}

declare module '../core/game' {
  interface GameServices {
    npcs: NpcApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'npc:talk': { id: string };
  }
}

/** Demo staging spots (plaza evening), used instead of the schedule for beauty shots. */
const SHOWCASE: Record<NpcId, [number, number, number]> = {
  marigold: [28.4, 21.8, 0.6],
  bram: [36.4, 21.6, -0.7],
  wren: [26.6, 26.9, 1.3],
};

/** Festival staging: a loose ring around the maypole, everyone facing the centre. */
const FESTIVAL_RING: Record<NpcId, number> = { marigold: -140, bram: -60, wren: 160 };
const PLAZA_C = { x: 32, z: 25, r: 3.55 };

export class NpcSystem implements System {
  readonly name = 'npcs';
  private game!: Game;
  private villagers = new Map<NpcId, Villager>();
  private active = false;
  private talking: Villager | null = null;
  private staged = false;
  private festival = false;
  /** Background festival-goers (built lazily, only on the map while a festival is staged). */
  private extras: { v: Villager; angle: number }[] = [];
  private lastHour = -1;

  init(game: Game): void {
    this.game = game;
    for (const id of NPC_IDS) {
      this.villagers.set(id, new Villager(NPCS[id]));
    }
    game.provide('npcs', {
      conversation: (id) => this.conversation(id),
      positions: () => (this.active ? [...this.villagers.values()].map((v) => ({ id: v.def.id, x: v.position.x, z: v.position.z })) : []),
    });
    game.events.on('player:interact', ({ x, z }) => this.tryTalk(x, z));
    game.events.on('ui:close', ({ name }) => {
      if (name === 'dialogue' && this.talking) {
        this.talking.talkTo = null;
        this.talking = null;
      }
    });
    game.events.on('demo:stage', ({ showcase }) => {
      this.staged = showcase.includes('npcs');
      this.festival = showcase.includes('festival');
      if (this.staged && this.active) this.stage();
    });
  }

  private conversation(id: string): Conversation | null {
    const def = NPCS[id as NpcId];
    if (!def) return null;
    const rel = this.game.services.relationships;
    const c = this.game.calendar;
    const lines = pickLines(def, { first: (rel?.talks(id) ?? 0) === 0, season: c.season, weather: c.weather, hour: c.hour });
    return { id: def.id, name: def.name, role: def.role, lines, hearts: Math.min(10, rel?.hearts(id) ?? 0), look: def.look, portraitBg: def.portraitBg };
  }

  private tryTalk(x: number, z: number): void {
    if (!this.active) return;
    const p = this.game.player.position;
    let best: Villager | null = null;
    let bd = 1.35;
    for (const v of this.villagers.values()) {
      const d = Math.min(Math.hypot(v.position.x - (x + 0.5), v.position.z - (z + 0.5)), Math.hypot(v.position.x - p.x, v.position.z - p.z) - 0.4);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    if (!best) return;
    this.talking = best;
    best.talkTo = p;
    this.game.events.emit('ui:open', { name: `dialogue:${best.def.id}` });
    // After the panel read the "first meeting" lines: RelationshipSystem counts the talk.
    this.game.events.emit('npc:talk', { id: best.def.id });
  }

  onMapChange(mapId: string, game: Game): void {
    const map = game.world.current;
    this.active = mapId === 'town' && !!map;
    for (const v of this.villagers.values()) v.root.removeFromParent();
    for (const e of this.extras) e.v.root.removeFromParent();
    if (!this.active || !map) return;
    for (const v of this.villagers.values()) {
      map.root.add(v.root);
      const [x, z, f] = this.scheduleAt(v, game.calendar.hour);
      v.setPosition(x, map.heightAt(x, z), z);
      v.setFacing(f);
    }
    if (this.staged) this.stage();
    this.lastHour = -1;
  }

  private stage(): void {
    const map = this.game.world.current;
    if (!map) return;
    if (this.festival && !this.extras.length) {
      this.extras = FESTIVAL_EXTRAS.map(([look, angle], i) => ({ v: new Villager({ ...NPCS.bram, id: 'bram', name: `extra-${i}`, look, dialogue: [], schedule: [] }), angle }));
      for (const e of this.extras) e.v.root.name = `npc:extra`;
    }
    for (const e of this.extras) {
      if (!this.festival) {
        e.v.root.removeFromParent();
        continue;
      }
      map.root.add(e.v.root);
      const a = (e.angle * Math.PI) / 180;
      const x = PLAZA_C.x + Math.cos(a) * PLAZA_C.r;
      const z = PLAZA_C.z + Math.sin(a) * PLAZA_C.r;
      e.v.setPosition(x, map.heightAt(x, z), z);
      e.v.setYaw(Math.atan2(PLAZA_C.x - x, PLAZA_C.z - z));
    }
    for (const v of this.villagers.values()) {
      let [x, z, yaw] = SHOWCASE[v.def.id];
      if (this.festival) {
        const a = (FESTIVAL_RING[v.def.id] * Math.PI) / 180;
        x = PLAZA_C.x + Math.cos(a) * PLAZA_C.r;
        z = PLAZA_C.z + Math.sin(a) * PLAZA_C.r;
        yaw = Math.atan2(PLAZA_C.x - x, PLAZA_C.z - z);
      }
      v.setPosition(x, map.heightAt(x, z), z);
      v.setYaw(yaw);
    }
  }

  private scheduleAt(v: Villager, hour: number): [number, number, 'up' | 'down' | 'left' | 'right'] {
    let cur = v.def.schedule[0]!;
    for (const s of v.def.schedule) if (hour >= s[0]) cur = s;
    return [cur[1], cur[2], cur[3]];
  }

  update(dt: number, game: Game): void {
    if (!this.active) return;
    const map = game.world.current!;
    const h = Math.floor(game.calendar.hour * 4);
    if (h !== this.lastHour && !this.staged) {
      this.lastHour = h;
      for (const v of this.villagers.values()) {
        const [x, z, f] = this.scheduleAt(v, game.calendar.hour);
        v.walkTo(x, z, f);
      }
    }
    for (const v of this.villagers.values()) v.update(dt, (x, z) => map.heightAt(x, z), !game.paused);
    if (this.festival) for (const e of this.extras) e.v.update(dt, (x, z) => map.heightAt(x, z), !game.paused);
  }
}
