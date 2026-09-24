/**
 * Co-op forage in Cindergrove (DESIGN pillar 13): the HOST owns the day's forage ledger.
 *
 * Every machine rolls the same finds from the same seed (`forage:<year>:<season>:<day>`); what
 * diverges is who picked what. The ledger is a set of picked tiles per day, and it lives here (a
 * system) rather than in the forest map, so a host that never walked into the forest still
 * referees its farmhands' picks.
 *
 *   farmhand → host  ['f.pick', day, tx, tz]              "I'm plucking this" (the pluck plays at once)
 *   host → all       ['f.rm', day, tx, tz, by]             it's gone: `by` gets the item
 *   host → farmhand  ['f.no', day, tx, tz]                 somebody beat you to it
 *   host → joiner    ['f.led', day, [tx, tz, tx, tz, …]]   today's picks so far (on join / rejoin)
 *
 * Payloads ride the net layer's extension channel (`services.net.sendExt` → `net:ext`). Solo play
 * never touches the wire. Local events: `forage:removed` (another farmer's pick: drop the visual),
 * `forage:verdict` (the host's answer to this machine's pick), `forage:ledger` (bulk sync).
 *
 * Demo `coop-forest`: two scripted farmhands in the forest (no server): one plucks a find through
 * the same host path, both flinch under a synced strike.
 */
import * as THREE from 'three';
import type { System } from '../../core/system';
import type { Game } from '../../core/game';
import { PRESET_LOOKS, type FarmerLook } from '../../entities/remote-look';
import type { ActionKind } from '../../entities/farmer-actions';
import type { EmoteId } from '../../entities/remote-emotes';

declare module '../../core/events' {
  interface GameEvents {
    /** Another farmer picked the find on (tx, tz) (co-op): remove it without granting anything. */
    'forage:removed': { day: string; tx: number; tz: number; by: number };
    /** The host's answer to this farmhand's pick on (tx, tz). */
    'forage:verdict': { day: string; tx: number; tz: number; ok: boolean };
    /** Bulk ledger sync (join): every tile listed is gone for `day`. */
    'forage:ledger': { day: string; tiles: [number, number][] };
  }
}

export interface ForageNetApi {
  /** Ledger key of the current day (also the finds' spawn seed). */
  dayKey(): string;
  isPicked(tx: number, tz: number, day?: string): boolean;
  /**
   * This machine's farmer plucks (tx, tz): 'grant' = it's yours (solo / host), 'pending' = asked
   * the host (a `forage:verdict` follows), 'deny' = already gone.
   */
  claim(tx: number, tz: number): 'grant' | 'pending' | 'deny';
  /** Host / solo: a farmer (`by`, net id) picked (tx, tz). False if it was already gone. */
  hostPick(tx: number, tz: number, by: number): boolean;
  stats(): { role: string; day: string; picked: number; pending: number; msgsIn: number; msgsOut: number };
}

declare module '../../core/game' {
  interface GameServices {
    forageNet: ForageNetApi;
  }
}

type Role = 'solo' | 'host' | 'client';
interface NetLike {
  role(): Role;
  myId(): number;
  sendExt(to: number | '*' | 'host', data: unknown[]): void;
  players?(): { id: number; isMe: boolean }[];
  remotes?: {
    add(id: number, name: string, look: FarmerLook): DemoRemote;
    remove(id: number): void;
    get(id: number): DemoRemote | undefined;
  };
  showChat?(id: number, text: string): void;
}
interface DemoRemote {
  id: number;
  map: string;
  farmer: { position: THREE.Vector3; speed: number; targetYaw: number; yaw: number; act(kind: ActionKind, tool: string | null): void };
  emote(e: EmoteId, dur?: number): void;
}

interface Bot {
  p: DemoRemote;
  x: number;
  z: number;
  yaw: number;
  t: number;
  job: 'forage' | 'watch';
  done: boolean;
}

const KEY = (tx: number, tz: number): number => tz * 4096 + tx;

export class ForestCoopSystem implements System, ForageNetApi {
  readonly name = 'forest-coop';
  private game!: Game;
  /** day key → picked tile keys. */
  private ledger = new Map<string, Set<number>>();
  private pending = new Set<number>();
  private known = new Set<number>();
  private msgsIn = 0;
  private msgsOut = 0;
  private bots: Bot[] = [];

  init(game: Game): void {
    this.game = game;
    game.provide('forageNet', this);
    game.events.on('net:ext', ({ from, data }) => this.receive(from, data));
    game.events.on('net:roster', ({ players }) => this.onRoster(players));
    game.events.on('day:start', () => {
      // Keep only today's ledger (a farmhand's calendar may trail the host's by a second).
      const d = this.dayKey();
      for (const k of [...this.ledger.keys()]) if (k !== d) this.ledger.delete(k);
      this.pending.clear();
    });
    game.events.on('demo:stage', ({ name }) => this.stageDemo(name));
    game.events.on('map:change', ({ map }) => {
      if (map !== 'forest') this.clearDemo();
    });
  }

  // ───────────────────────────────────────────── api

  dayKey(): string {
    const c = this.game.calendar;
    return `forage:${c.year}:${c.season}:${c.day}`;
  }

  private set(day = this.dayKey()): Set<number> {
    let s = this.ledger.get(day);
    if (!s) this.ledger.set(day, (s = new Set()));
    return s;
  }

  isPicked(tx: number, tz: number, day = this.dayKey()): boolean {
    return this.ledger.get(day)?.has(KEY(tx, tz)) ?? false;
  }

  private net(): NetLike | null {
    return (this.game.services.net as unknown as NetLike | undefined) ?? null;
  }

  private role(): Role {
    return this.net()?.role() ?? 'solo';
  }

  private myId(): number {
    return this.net()?.myId() ?? 0;
  }

  private send(to: number | '*' | 'host', d: unknown[]): void {
    const n = this.net();
    if (!n || n.role() === 'solo') return;
    this.msgsOut++;
    n.sendExt(to, d);
  }

  claim(tx: number, tz: number): 'grant' | 'pending' | 'deny' {
    if (this.isPicked(tx, tz)) return 'deny';
    if (this.role() === 'client') {
      const day = this.dayKey();
      this.set(day).add(KEY(tx, tz));
      this.pending.add(KEY(tx, tz));
      this.send('host', ['f.pick', day, tx, tz]);
      return 'pending';
    }
    return this.hostPick(tx, tz, this.myId()) ? 'grant' : 'deny';
  }

  hostPick(tx: number, tz: number, by: number): boolean {
    const day = this.dayKey();
    const s = this.set(day);
    if (s.has(KEY(tx, tz))) return false;
    s.add(KEY(tx, tz));
    this.send('*', ['f.rm', day, tx, tz, by]);
    if (by !== this.myId()) this.game.events.emit('forage:removed', { day, tx, tz, by });
    return true;
  }

  stats(): ReturnType<ForageNetApi['stats']> {
    return { role: this.role(), day: this.dayKey(), picked: this.ledger.get(this.dayKey())?.size ?? 0, pending: this.pending.size, msgsIn: this.msgsIn, msgsOut: this.msgsOut };
  }

  // ───────────────────────────────────────────── wire

  private receive(from: number, d: unknown[]): void {
    const kind = d[0];
    if (typeof kind !== 'string' || !kind.startsWith('f.')) return;
    this.msgsIn++;
    const role = this.role();
    const day = String(d[1]);
    const tx = Number(d[2]);
    const tz = Number(d[3]);
    switch (kind) {
      case 'f.pick': {
        if (role !== 'host') return;
        // Only today's finds, one farmer each.
        if (day !== this.dayKey() || !this.hostPick(tx, tz, from)) this.send(from, ['f.no', day, tx, tz]);
        return;
      }
      case 'f.rm': {
        if (role !== 'client') return;
        const by = Number(d[4]);
        this.set(day).add(KEY(tx, tz));
        if (by === this.myId()) {
          this.pending.delete(KEY(tx, tz));
          this.game.events.emit('forage:verdict', { day, tx, tz, ok: true });
        } else {
          if (this.pending.delete(KEY(tx, tz))) this.game.events.emit('forage:verdict', { day, tx, tz, ok: false });
          this.game.events.emit('forage:removed', { day, tx, tz, by });
        }
        return;
      }
      case 'f.no': {
        if (role !== 'client') return;
        this.pending.delete(KEY(tx, tz));
        this.game.events.emit('forage:verdict', { day, tx, tz, ok: false });
        return;
      }
      case 'f.led': {
        if (role !== 'client') return;
        const flat = Array.isArray(d[2]) ? (d[2] as number[]) : [];
        const s = this.set(day);
        const tiles: [number, number][] = [];
        for (let i = 0; i + 1 < flat.length; i += 2) {
          s.add(KEY(flat[i]!, flat[i + 1]!));
          tiles.push([flat[i]!, flat[i + 1]!]);
        }
        this.game.events.emit('forage:ledger', { day, tiles });
        return;
      }
    }
  }

  /** Host: send today's ledger to every farmhand that just joined. */
  private onRoster(players: { id: number; isMe: boolean }[]): void {
    const ids = new Set(players.filter((p) => !p.isMe).map((p) => p.id));
    if (this.role() === 'host') {
      const day = this.dayKey();
      const flat: number[] = [];
      for (const k of this.ledger.get(day) ?? []) flat.push(k % 4096, Math.floor(k / 4096));
      for (const id of ids) if (!this.known.has(id)) this.send(id, ['f.led', day, flat]);
    }
    this.known = ids;
  }

  // ───────────────────────────────────────────── demo: coop-forest (no server)

  private stageDemo(name: string): void {
    this.clearDemo();
    if (name !== 'coop-forest') return;
    const net = this.net();
    if (!net?.remotes || net.role() !== 'solo') return;
    // Wait for the forest to be current (demos load the map, then stage).
    requestAnimationFrame(() => this.spawnBots());
  }

  private spawnBots(): void {
    const net = this.net();
    const map = this.game.world.current;
    if (!net?.remotes || map?.id !== 'forest') return;
    const p0 = this.game.player.position;
    const mk = (i: number, x: number, z: number, yaw: number, job: Bot['job']): Bot => {
      const p = net.remotes!.add(910 + i, ['Juniper', 'Rowan'][i]!, PRESET_LOOKS[i + 1] ?? PRESET_LOOKS[0]!);
      p.map = 'forest';
      p.farmer.yaw = p.farmer.targetYaw = yaw;
      const b: Bot = { p, x, z, yaw, t: 0.6 + i * 0.9, job, done: false };
      this.bots.push(b);
      return b;
    };
    // Juniper crouches over the nearest find; Rowan watches the storm from the path.
    const forest = map as unknown as { forageNear?(x: number, z: number, r: number): { tx: number; tz: number; x: number; z: number } | null };
    const find = forest.forageNear?.(p0.x, p0.z, 9) ?? null;
    if (find) {
      const ang = Math.atan2(p0.x - find.x, p0.z - find.z);
      const bx = find.x + Math.sin(ang) * 0.75;
      const bz = find.z + Math.cos(ang) * 0.75;
      mk(0, bx, bz, Math.atan2(find.x - bx, find.z - bz), 'forage');
      (this.bots[0] as Bot & { find?: typeof find }).find = find;
    } else mk(0, p0.x + 1.6, p0.z + 0.4, -Math.PI / 2, 'watch');
    mk(1, p0.x - 1.4, p0.z + 0.9, Math.PI * 0.8, 'watch');
    net.showChat?.(911, 'Did you see that bolt?!');
    net.showChat?.(910, 'Mine! Found a morel');
    this.bots[1]?.p.emote('wow', 1e6);
    // Emit a roster refresh so the plate lists them.
    (net as unknown as { emitRoster?(): void }).emitRoster?.();
  }

  private clearDemo(): void {
    if (!this.bots.length) return;
    const net = this.net();
    for (const b of this.bots) net?.remotes?.remove(b.p.id);
    this.bots = [];
  }

  update(dt: number): void {
    if (!this.bots.length) return;
    const map = this.game.world.current;
    if (!map) return;
    for (const b of this.bots) {
      const f = b.p.farmer;
      f.position.set(b.x, map.heightAt(b.x, b.z), b.z);
      f.speed = 0;
      f.targetYaw = b.yaw;
      b.t -= dt;
      if (b.job === 'forage' && !b.done && b.t <= 0) {
        b.done = true;
        const find = (b as Bot & { find?: { tx: number; tz: number } }).find;
        f.act('pull', null);
        // Same host path a real farmhand's intent takes: the ledger marks it, the map drops it.
        if (find) setTimeout(() => this.hostPick(find.tx, find.tz, b.p.id), 200);
      }
    }
  }
}
