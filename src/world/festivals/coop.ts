/**
 * Co-op festivals (DESIGN pillar 13). Every farmer at the festival plays the mini-games on their own
 * machine; this module shares what makes it one festival:
 *
 *   scores   farmhand → host   ['fe.sc', act, score, place]     a finished mini-game
 *            host → all        ['fe.bd', act, rows]             today's board for that activity
 *   join     farmhand → host   ['fe.hi']                        just joined: send me today's festival
 *            host → farmhand   ['fe.snap', snapshot]            boards + what the host has played
 *   races    owner → all       ['fe.lob', act, race, msLeft]    "I'm at the start line" (sack race / skate)
 *            joiner → owner    ['fe.join', act, race]           count me in
 *            owner → racers    ['fe.go', act, race, lanes]      3-2-1 now; lanes = [[id, lane], …]
 *            racer → all       ['fe.pr', race, t, p, fin, …x]   live progress at 10 Hz (race clock s,
 *                                                               progress 0..1, finish time or -1, extras)
 *
 * Board rows carry `p<netId>` player keys on the wire; each machine shows its own row as 'local'.
 * Payloads ride the net layer's extension channel (`services.net.sendExt` → `net:ext`); solo play
 * never touches it. The lobby owner is whoever reached the start line first — no host round trip,
 * so a farmhand can open a race the host then joins.
 */
import type { Game } from '../../core/game';
import type { ActivityId } from '../../data/festivals';

type Role = 'solo' | 'host' | 'client';
interface NetLike {
  role(): Role;
  myId(): number;
  sendExt(to: number | '*' | 'host', data: unknown[]): void;
  players(): { id: number; name: string; isMe: boolean; isHost: boolean; map: string; look: { scarf: number } }[];
  remotes?: { get(id: number): { farmer: { root: import('three').Object3D } } | undefined };
}

/** One board row on the wire / in the system (mirrors systems/festivals FestivalScore). */
export interface CoopRow {
  player: string;
  name: string;
  score: number;
  place: number;
  color?: string;
}

/** Another farmer in a shared race. */
export interface CoopRacer {
  id: number;
  key: string;
  name: string;
  color: string;
  lane: number;
}

export interface CoopSample {
  t: number;
  p: number;
  fin: number;
  x: number[];
  /** performance.now() when it arrived. */
  at: number;
}

/** A race shared with other farmers (sack race lanes, skate heats). */
export interface CoopRace {
  act: ActivityId;
  id: string;
  /** This farmer's lane (the lobby owner races lane 0). */
  myLane: number;
  racers: CoopRacer[];
  sample(id: number): CoopSample | null;
  /** Report this farmer's progress (throttled to 10 Hz; a finish is always sent). */
  report(t: number, p: number, fin: number, extra?: number[]): void;
  /** Remote farmer avatars (net layer), for dressing them for the race (sacks). */
  avatar(id: number): import('three').Object3D | null;
}

/** The start-line lobby shown before a shared race (the overlay renders it). */
export interface CoopLobby {
  owner: boolean;
  act: ActivityId;
  /** Farmers lined up so far (not you). */
  joined(): { name: string; color: string }[];
  /** Farmers on the grounds who could still join. */
  waitingFor(): { name: string; color: string }[];
  /** Seconds until the race starts anyway. */
  left(): number;
  /** Owner: start now with whoever is at the line. */
  startNow(): void;
  cancel(): void;
  result: Promise<CoopRace | null>;
}

const LOBBY_MS = 10_000;
const RACE_ACTS = new Set<ActivityId>(['sackrace', 'skate']);

export class FestivalCoop {
  /** Open lobbies other farmers announced: act → {owner, race, until}. */
  private invites = new Map<ActivityId, { owner: number; race: string; until: number; name: string }>();
  private mine: { act: ActivityId; race: string; joined: number[]; go: (r: CoopRace | null) => void; until: number; done: boolean; timer: number } | null = null;
  private waitGo: { act: ActivityId; race: string; owner: number; go: (r: CoopRace | null) => void } | null = null;
  private samples = new Map<string, Map<number, CoopSample>>();
  private raceN = 0;
  private lastSend = 0;
  private saidHi = '';
  private hiTries = 0;
  private gotSnap = false;
  stats = { msgsIn: 0, msgsOut: 0, progIn: 0, progUsed: 0, invites: 0, trace: [] as string[] };
  /** Progress that arrived before this machine's race object existed (fe.go / fe.pr reordering). */
  private early = new Map<string, Map<number, CoopSample>>();

  private note(s: string): void {
    this.stats.trace.push(`${Math.round(performance.now())} ${s}`);
    if (this.stats.trace.length > 24) this.stats.trace.shift();
  }

  constructor(
    private game: Game,
    private hooks: {
      /** Host: a farmhand finished a mini-game. */
      onScore(act: ActivityId, row: CoopRow): void;
      /** A board arrived from the host (rows keyed p<id>; your own row is 'local'). */
      onBoard(act: ActivityId, rows: CoopRow[]): void;
      snapshot(): unknown;
      /** False = not applicable yet (e.g. the calendar hasn't synced to the host's day). */
      applySnapshot(s: unknown): boolean;
      /** Current festival map id (null = not on the grounds). */
      grounds(): string | null;
    },
  ) {
    game.events.on('net:ext', ({ from, data }) => this.receive(from, data));
    game.events.on('net:status', ({ role, code }) => {
      // A farmhand that just joined asks the host for today's festival (boards, who played).
      if (role === 'client' && code && this.saidHi !== code) {
        this.saidHi = code;
        this.hiTries = 0;
        this.gotSnap = false;
        // Keep asking until the host answers (a hello that races our own roster entry on the host
        // is dropped there as a non-member).
        const ask = (): void => {
          if (this.gotSnap || this.role() !== 'client' || this.hiTries++ > 40) return;
          this.send('host', ['fe.hi']);
          setTimeout(ask, 1500);
        };
        setTimeout(ask, 600);
      }
      if (role === 'solo') this.saidHi = '';
    });
  }

  // ───────────────────────────────────────────── plumbing

  private net(): NetLike | null {
    const n = this.game.services.net as unknown as NetLike | undefined;
    return n && typeof n.sendExt === 'function' ? n : null;
  }

  role(): Role {
    return this.net()?.role() ?? 'solo';
  }

  myId(): number {
    return this.net()?.myId() ?? 0;
  }

  private send(to: number | '*' | 'host', d: unknown[]): void {
    const n = this.net();
    if (!n || n.role() === 'solo') return;
    this.stats.msgsOut++;
    n.sendExt(to, d);
  }

  /** Name + tag colour of a farmer by net id. */
  who(id: number): { name: string; color: string } {
    const p = this.net()?.players().find((x) => x.id === id);
    return { name: p?.name ?? `Farmer ${id}`, color: p ? `#${p.look.scarf.toString(16).padStart(6, '0')}` : '#b89a7a' };
  }

  /** Other farmers standing on this festival's grounds right now. */
  others(): number[] {
    const n = this.net();
    const map = this.hooks.grounds();
    if (!n || n.role() === 'solo' || !map) return [];
    return n.players().filter((p) => !p.isMe && p.map === map).map((p) => p.id);
  }

  // ───────────────────────────────────────────── scores

  /** This machine finished a mini-game (after recording it locally as 'local'). */
  shareScore(act: ActivityId, score: number, place: number, board: CoopRow[]): void {
    const role = this.role();
    if (role === 'client') this.send('host', ['fe.sc', act, score, place]);
    else if (role === 'host') this.broadcastBoard(act, board);
  }

  /** Host: send today's board for `act` to everyone ('local' = the host's own row). */
  broadcastBoard(act: ActivityId, board: CoopRow[]): void {
    if (this.role() !== 'host') return;
    const me = this.myId();
    const rows = board.map((r) => (r.player === 'local' ? { ...r, player: `p${me}`, name: this.who(me).name, color: this.who(me).color } : r));
    this.send('*', ['fe.bd', act, rows]);
  }

  /** Board rows from the wire: your own key becomes 'local'. */
  private localise(rows: CoopRow[]): CoopRow[] {
    const me = `p${this.myId()}`;
    return rows.map((r) => (r.player === me ? { ...r, player: 'local', name: 'You' } : r));
  }

  // ───────────────────────────────────────────── races

  /** Is another farmer's start-line lobby open for `act` (you'd join it)? */
  invite(act: ActivityId): { name: string; left: number } | null {
    const inv = this.invites.get(act);
    if (!inv || inv.until < performance.now()) return null;
    return { name: inv.name, left: (inv.until - performance.now()) / 1000 };
  }

  /**
   * Line up for a shared race. Null = race solo (activity isn't a race, solo play, nobody else on the
   * grounds). Otherwise the lobby resolves to a CoopRace (or null if everyone else wandered off).
   */
  lineUp(act: ActivityId): CoopLobby | null {
    if (!RACE_ACTS.has(act) || this.role() === 'solo') return null;
    const inv = this.invites.get(act);
    const now = performance.now();
    // (Any lobby member will do — the roster's map field can lag a teleport by a tick or two, and
    // opening a rival lobby instead would leave two farmers waiting at two different lines.)
    if (inv && inv.until > now && (this.others().includes(inv.owner) || !!this.net()?.players().some((p) => p.id === inv.owner && !p.isMe))) {
      this.note(`join ${inv.race}`);
      // Join the open lobby.
      this.send(inv.owner, ['fe.join', act, inv.race]);
      let cancel = (): void => {};
      const result = new Promise<CoopRace | null>((resolve) => {
        this.waitGo = { act, race: inv.race, owner: inv.owner, go: resolve };
        const tm = setTimeout(() => {
          if (this.waitGo?.race === inv.race) {
            this.waitGo = null;
            resolve(null);
          }
        }, Math.max(0, inv.until - now) + 4000);
        cancel = () => {
          clearTimeout(tm);
          if (this.waitGo?.race === inv.race) this.waitGo = null;
          resolve(null);
        };
      });
      const ow = this.who(inv.owner);
      return {
        owner: false,
        act,
        joined: () => [ow],
        waitingFor: () => [],
        left: () => Math.max(0, (inv.until - performance.now()) / 1000),
        startNow: () => {},
        cancel: () => cancel(),
        result,
      };
    }
    const others = this.others();
    if (!others.length) return null;
    const race = `${this.myId()}:${++this.raceN}`;
    const until = now + LOBBY_MS;
    this.send('*', ['fe.lob', act, race, LOBBY_MS]);
    this.note(`lobby ${race} (others ${others.join(',')})`);
    let resolveFn: (r: CoopRace | null) => void = () => {};
    const result = new Promise<CoopRace | null>((res) => (resolveFn = res));
    const lob = { act, race, joined: [] as number[], go: resolveFn, until, done: false, timer: 0 };
    this.mine = lob;
    const finish = (): void => {
      if (lob.done) return;
      lob.done = true;
      if (this.mine === lob) this.mine = null;
      clearInterval(lob.timer);
      // Everyone who joined gets a lane (owner lane 0, then join order); the rest see the lobby close.
      const lanes: [number, number][] = [[this.myId(), 0], ...lob.joined.map((id, k) => [id, k + 1] as [number, number])];
      this.note(`go ${race} joined ${lob.joined.join(',') || '-'}`);
      this.send('*', ['fe.go', act, race, lob.joined.length ? lanes : []]);
      resolveFn(lob.joined.length ? this.makeRace(act, race, lanes) : null);
    };
    lob.timer = window.setInterval(() => {
      const present = this.others();
      const all = present.length > 0 && present.every((id) => lob.joined.includes(id));
      if (performance.now() >= lob.until || all) finish();
    }, 250);
    return {
      owner: true,
      act,
      joined: () => lob.joined.map((id) => this.who(id)),
      waitingFor: () => this.others().filter((id) => !lob.joined.includes(id)).map((id) => this.who(id)),
      left: () => Math.max(0, (lob.until - performance.now()) / 1000),
      startNow: () => finish(),
      cancel: () => {
        lob.joined.length = 0;
        finish();
      },
      result,
    };
  }

  private makeRace(act: ActivityId, id: string, lanes: [number, number][]): CoopRace {
    const me = this.myId();
    const myLane = lanes.find(([p]) => p === me)?.[1] ?? 0;
    const racers = lanes.filter(([p]) => p !== me).map(([p, lane]) => ({ id: p, key: `p${p}`, lane, ...this.who(p) }));
    const buf = this.early.get(id) ?? new Map<number, CoopSample>();
    this.early.delete(id);
    this.samples.set(id, buf);
    this.note(`race ${id} lane ${myLane} vs ${racers.map((r) => `${r.id}@${r.lane}`).join(',') || '-'}`);
    // Keep only a couple of races' samples around.
    for (const k of [...this.samples.keys()]) if (this.samples.size > 3 && k !== id) this.samples.delete(k);
    return {
      act,
      id,
      myLane,
      racers,
      sample: (p) => buf.get(p) ?? null,
      report: (t, p, fin, extra = []) => {
        const now = performance.now();
        if (fin < 0 && now - this.lastSend < 95) return;
        this.lastSend = now;
        this.send('*', ['fe.pr', id, +t.toFixed(3), +p.toFixed(4), +fin.toFixed(3), ...extra.map((v) => +v.toFixed(3))]);
      },
      avatar: (p) => this.net()?.remotes?.get(p)?.farmer.root ?? null,
    };
  }

  // ───────────────────────────────────────────── inbound

  private receive(from: number, d: unknown[]): void {
    const kind = d[0];
    if (typeof kind !== 'string' || !kind.startsWith('fe.')) return;
    this.stats.msgsIn++;
    const role = this.role();
    switch (kind) {
      case 'fe.sc': {
        if (role !== 'host') return;
        const [, act, score, place] = d as [string, ActivityId, number, number];
        const w = this.who(from);
        this.hooks.onScore(act, { player: `p${from}`, name: w.name, color: w.color, score: Number(score) || 0, place: Math.max(0, Math.min(3, Number(place) | 0)) });
        return;
      }
      case 'fe.bd': {
        if (role !== 'client') return;
        const [, act, rows] = d as [string, ActivityId, CoopRow[]];
        if (Array.isArray(rows)) this.hooks.onBoard(act, this.localise(rows));
        return;
      }
      case 'fe.hi': {
        if (role === 'host') this.send(from, ['fe.snap', this.hooks.snapshot()]);
        return;
      }
      case 'fe.snap': {
        if (role !== 'client') return;
        const snap = d[1] as { boards?: Record<string, CoopRow[]> } | null;
        if (snap?.boards) for (const k of Object.keys(snap.boards)) snap.boards[k] = this.localise(snap.boards[k] ?? []);
        // Too early (our calendar is still catching up with the host's)? The hello loop asks again.
        if (this.hooks.applySnapshot(snap)) this.gotSnap = true;
        return;
      }
      case 'fe.lob': {
        const [, act, race, ms] = d as [string, ActivityId, string, number];
        const w = this.who(from);
        this.invites.set(act, { owner: from, race, until: performance.now() + Math.min(LOBBY_MS, Number(ms) || 0), name: w.name });
        this.stats.invites++;
        this.note(`invite ${race} from ${from}`);
        // Both at the line at once: the lower net id keeps the lobby, the other joins it.
        const mine = this.mine;
        if (mine && mine.act === act && !mine.done && from < this.myId() && !mine.joined.length) {
          mine.done = true;
          clearInterval(mine.timer);
          this.mine = null;
          const r = this.lineUp(act);
          void r?.result.then((x) => mine.go(x));
          return;
        }
        // The other way round (their id is higher): tell them about our line so *they* fold into it —
        // our first announcement may have reached them before they walked up to the start line.
        if (mine && mine.act === act && !mine.done && from > this.myId()) this.send(from, ['fe.lob', act, mine.race, Math.max(1500, mine.until - performance.now())]);
        this.game.events.emit('festival:lobby', { act, name: w.name, left: Math.round((Number(ms) || 0) / 1000) });
        return;
      }
      case 'fe.join': {
        const [, act, race] = d as [string, ActivityId, string];
        const mine = this.mine;
        if (mine && mine.act === act && mine.race === race && !mine.done && !mine.joined.includes(from)) {
          mine.joined.push(from);
          this.note(`joined ${race} by ${from}`);
        } else {
          // Too late — the gun went: release them straight away rather than leaving them at the line.
          this.note(`late join ${race} by ${from}`);
          this.send(from, ['fe.go', act, race, []]);
        }
        return;
      }
      case 'fe.go': {
        const [, act, race, lanes] = d as [string, ActivityId, string, [number, number][]];
        const inv = this.invites.get(act);
        if (inv?.race === race) this.invites.delete(act);
        const w = this.waitGo;
        if (w && w.race === race) {
          this.waitGo = null;
          const inRace = Array.isArray(lanes) && lanes.some(([p]) => p === this.myId());
          w.go(inRace ? this.makeRace(act, race, lanes) : null);
        }
        return;
      }
      case 'fe.pr': {
        const [, race, t, p, fin, ...x] = d as [string, string, number, number, number, ...number[]];
        this.stats.progIn++;
        let buf = this.samples.get(race);
        if (!buf) {
          // The race hasn't started on this machine yet (its fe.go is still in flight): keep it.
          buf = this.early.get(race) ?? new Map<number, CoopSample>();
          if (!this.early.has(race)) {
            this.early.set(race, buf);
            for (const k of [...this.early.keys()]) if (this.early.size > 3 && k !== race) this.early.delete(k);
          }
        } else this.stats.progUsed++;
        const prev = buf.get(from);
        if (prev && prev.fin >= 0 && Number(fin) < 0) return;
        buf.set(from, { t: Number(t), p: Number(p), fin: Number(fin), x: x.map(Number), at: performance.now() });
        return;
      }
    }
  }
}

declare module '../../core/events' {
  interface GameEvents {
    /** Another farmer opened a start-line lobby at this festival (sack race / skate). */
    'festival:lobby': { act: string; name: string; left: number };
  }
}
