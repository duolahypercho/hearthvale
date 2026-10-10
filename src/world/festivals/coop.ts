/**
 * Co-op festivals (DESIGN pillar 13) — host-authoritative end to end.
 *
 * The host's browser owns every festival activity: its id, seed, start tick, participants, live race
 * progress, outcome and the staged world events other farmers watch. A farmhand only submits
 * *inputs* (I'm starting X, this moment happened, my progress claim, my finish) and renders what the
 * host broadcasts back; the host validates each one (known activity + event kind, finite values,
 * progress no faster than the game allows, finish times within a lag window, scores within the par
 * band) before it reaches anybody.
 *
 *   activities  farmer → host  ['fe.req', key, act, partner]      I'm starting `act` (key = my handle)
 *               host → all     ['fe.stage', sid, pid, act, partner, seed, key]
 *                                                                 session opened: id, seed, owner
 *               farmer → host  ['fe.ev', sid, kind, value]        a staged moment (hit, release, judge…)
 *               host → others  ['fe.x', sid, kind, value, ms]     …validated + stamped (ms since start)
 *               farmer → host  ['fe.end', sid, score, place]      finished
 *               host → all     ['fe.fin', sid, pid, score, place] authoritative outcome (+ 'fe.bd')
 *   races       farmer → host  ['fe.line', act, lobby?]           at the start line (open / join)
 *               host → all     ['fe.lob', act, id, msLeft, owner, members]
 *               farmer → host  ['fe.start', id] / ['fe.leave', id]
 *               host → all     ['fe.go', act, id, seed, lanes, delayMs]   host-owned start tick
 *               racer → host   ['fe.in', id, t, p, fin, …x]       progress claim (10 Hz)
 *               host → all     ['fe.st', id, tHost, rows]         authoritative state, rows [pid, p, fin, …x]
 *               host → all     ['fe.res', id, rows]               final standings [pid, place, fin]
 *   boards      host → all     ['fe.bd', act, rows]
 *   join        farmhand → host ['fe.hi'];  host → farmhand ['fe.snap', snapshot (+ live sessions)]
 *
 * The host runs its own games through exactly the same paths (handled locally, no round trip), so
 * a farmhand sees the host's dance / lanterns / judging / gifts staged in 3D the way the host sees
 * theirs. Villager racers are a pure function of the host's seed and the race clock
 * (`sackNpcPos`), so every machine — racer or spectator — shows the same field, and only the host
 * ranks the finish. Payloads ride the net layer's extension channel (`services.net.sendExt` →
 * `net:ext`); solo play never touches it.
 */
import type { Game } from '../../core/game';
import { ACTIVITY_PAR, type ActivityId } from '../../data/festivals';

type Role = 'solo' | 'host' | 'client';
interface NetLike {
  role(): Role;
  myId(): number;
  sendExt(to: number | '*' | 'host', data: unknown[]): void;
  players(): { id: number; name: string; isMe: boolean; isHost: boolean; map: string; look: { scarf: number } }[];
  remotes?: { get(id: number): { farmer: import('../../entities/remote-farmer').RemoteFarmer } | undefined };
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

/** Final standings row from the host (0-based place among all five racers). */
export interface CoopStanding {
  id: number;
  place: number;
  fin: number;
}

/** A race shared with other farmers (sack race lanes, skate heats) — the host's. */
export interface CoopRace {
  act: ActivityId;
  id: string;
  /** Host seed (villager racers' speeds). */
  seed: number;
  /** This farmer's net id (standings rows are keyed by it). */
  me: number;
  /** This farmer's lane. */
  myLane: number;
  racers: CoopRacer[];
  /** The host's authoritative state for a farmer (null until the first broadcast). */
  sample(id: number): CoopSample | null;
  /** Submit this farmer's progress claim (throttled to 10 Hz; the first finish goes at once). */
  report(t: number, p: number, fin: number, extra?: number[]): void;
  /** Remote farmer avatars (net layer), for dressing them for the race (sacks). */
  avatar(id: number): import('three').Object3D | null;
  /** The host's final standings (null if it never answered). */
  standings(timeoutMs?: number): Promise<CoopStanding[] | null>;
}

/** The start-line lobby shown before a shared race (the overlay renders it). */
export interface CoopLobby {
  owner: boolean;
  act: ActivityId;
  /** Nobody else is on the grounds: no line-up panel, the host just hands out the race. */
  quick: boolean;
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

/** This farmer's activity, as the host knows it (id / seed arrive a round trip after begin()). */
export interface CoopSession {
  act: ActivityId;
  sid(): string | null;
  seed(): number | null;
  /** A staged moment worth showing the other farmers (validated + relayed by the host). */
  event(kind: string, value: number): void;
  /** Finished: the host validates the result, records it on the board and tells everyone. */
  end(score: number, place: number): void;
}

/** Another farmer's activity, staged on this machine from the host's broadcasts. */
export interface CoopSpec {
  sid: string;
  pid: number;
  act: ActivityId;
  partner?: string;
  seed: number;
  name: string;
  color: string;
  /** Their avatar (net layer remote farmer), when it's on this map. */
  avatar(): import('../../entities/remote-farmer').RemoteFarmer | null;
}

/** A race other farmers run, as a spectator sees it. */
export interface CoopSpecRace {
  id: string;
  act: ActivityId;
  seed: number;
  lanes: [number, number][];
  /** Race clock (s) on this machine (0 at the host's start tick). */
  clock(): number;
  sample(id: number): CoopSample | null;
  done: boolean;
}

const LOBBY_MS = 10_000;
/** The overlay's 3-2-1 (3 × 620 ms) between the host's go tick and the race clock's zero. */
const COUNTDOWN_MS = 1860;
const GO_DELAY_MS = 350;
const RACE_ACTS = new Set<ActivityId>(['sackrace', 'skate']);
/** Fastest believable progress per second (1.0 = the whole course), with slack for frame jitter. */
const MAX_RATE: Partial<Record<ActivityId, number>> = { sackrace: 0.2, skate: 0.09 };
/** Finish-time lag window: a claimed finish may precede its arrival by at most this (s). */
const LAG_S = 1.0;
/** Staged moments each activity may relay (anything else is dropped by the host). */
const EVENTS: Record<ActivityId, string[]> = {
  dance: ['perfect', 'good', 'miss', 'restart', 'win', 'lose'],
  lanterns: ['wish', 'release', 'restart', 'win', 'lose'],
  sackrace: ['hop', 'stumble', 'finish', 'restart', 'win', 'lose'],
  pumpkin: ['enter', 'judge', 'rosette', 'ribbon', 'restart', 'win', 'lose'],
  giftswap: ['draw', 'peek', 'given', 'gift-appear', 'unwrap', 'restart', 'win', 'lose'],
  skate: ['gate', 'star', 'crack', 'lap', 'restart', 'win', 'lose'],
};

// ───────────────────────────────────────────── shared race maths

/** Sack race course length (m) — the HUD and the 3D lanes both map progress onto it. */
export const SACK_LEN = 25.4;
const NPC_SPEEDS = [2.62, 2.48, 2.75, 2.36];

/** Seeded speed / stumble rhythm of villager racer k (identical on every machine). */
function npcSpec(seed: number, k: number): { s: number; P: number; c: number } {
  const h = hash(seed * 31 + k * 7919);
  const s = NPC_SPEEDS[(k + (seed >>> 3)) % 4]! * (0.97 + 0.06 * h);
  const P = 3 + (k + 1) * 1.7;
  // Stumble windows (0.44 s at 20 % speed) centred at c + n·P.
  const c = (P / 2 - k * 1.3 + 7 * P) % P;
  return { s, P, c };
}

/** Time spent inside stumble windows of width 0.44 s centred at c + n·P, over [0, t]. */
function stumbleTime(t: number, P: number, c: number): number {
  const w = 0.22;
  let sum = 0;
  const n0 = Math.floor((-w - c) / P);
  const n1 = Math.ceil((t + w - c) / P);
  for (let n = n0; n <= n1; n++) {
    const a = Math.max(0, c + n * P - w);
    const b = Math.min(t, c + n * P + w);
    if (b > a) sum += b - a;
  }
  return sum;
}

/**
 * Villager racer k's distance (m) at race time t — closed form (frame-rate independent), so the
 * racer's HUD, the 3D lanes on every machine and the host's ranking agree to the centimetre.
 */
export function sackNpcPos(seed: number, k: number, t: number): number {
  if (t <= 0) return 0;
  const n = npcSpec(seed, k);
  // Full speed outside the stumble windows, 20 % inside; a gentle ±10 % stride rhythm.
  const eff = t - 0.8 * stumbleTime(t, n.P, n.c) - (0.1 / 7) * Math.cos(t * 7 + k) + (0.1 / 7) * Math.cos(k);
  return Math.min(SACK_LEN, Math.max(0, n.s * (0.9 * eff + 0.1 * t)));
}

/** Race time at which villager racer k crosses the line (bisection on the closed form). */
export function sackNpcFinish(seed: number, k: number): number {
  let lo = 0;
  let hi = 60;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (sackNpcPos(seed, k, mid) >= SACK_LEN) hi = mid;
    else lo = mid;
  }
  return hi;
}

function hash(n: number): number {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const num = (v: unknown, lo = -1e6, hi = 1e6): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0;
};

// ───────────────────────────────────────────── host-side state

interface HostSession {
  sid: string;
  pid: number;
  act: ActivityId;
  partner?: string;
  seed: number;
  t0: number;
  /** Last staged moments (a late joiner replays them). */
  log: [string, number][];
}

interface HostLobby {
  act: ActivityId;
  id: string;
  owner: number;
  members: number[];
  until: number;
  timer: number;
  done: boolean;
}

interface HostRace {
  act: ActivityId;
  id: string;
  seed: number;
  lanes: [number, number][];
  /** Host performance.now() of race clock 0. */
  zero: number;
  rows: Map<number, { p: number; fin: number; x: number[]; t: number }>;
  timer: number;
  done: boolean;
}

export class FestivalCoop {
  // host
  private hSessions = new Map<string, HostSession>();
  private hLobbies = new Map<ActivityId, HostLobby>();
  private hRaces = new Map<string, HostRace>();
  private sidN = 0;
  // every machine
  private mineByKey = new Map<string, { act: ActivityId; sid: string | null; seed: number | null; queue: unknown[][]; ended: [number, number] | null }>();
  private keyN = 0;
  private specs = new Map<string, CoopSpec>();
  private specRaces = new Map<string, CoopSpecRace & { zero: number }>();
  private lobbies = new Map<ActivityId, { id: string; owner: number; members: number[]; until: number }>();
  private waitGo: { act: ActivityId; go: (r: CoopRace | null) => void; lobbyId: string | null } | null = null;
  private samples = new Map<string, Map<number, CoopSample>>();
  private standingsWait = new Map<string, { rows: CoopStanding[] | null; fns: ((r: CoopStanding[] | null) => void)[] }>();
  private lastSend = 0;
  private saidHi = '';
  private hiTries = 0;
  private gotSnap = false;
  stats = { msgsIn: 0, msgsOut: 0, progIn: 0, progUsed: 0, invites: 0, staged: 0, relayed: 0, rejected: 0, trace: [] as string[] };

  private note(s: string): void {
    this.stats.trace.push(`${Math.round(performance.now())} ${s}`);
    if (this.stats.trace.length > 32) this.stats.trace.shift();
  }

  constructor(
    private game: Game,
    private hooks: {
      /** Host: a validated result (a farmhand's or the host's own) — record it and send the board. */
      onScore(act: ActivityId, row: CoopRow): void;
      /** A board arrived from the host (rows keyed p<id>; your own row is 'local'). */
      onBoard(act: ActivityId, rows: CoopRow[]): void;
      snapshot(): unknown;
      /** False = not applicable yet (e.g. the calendar hasn't synced to the host's day). */
      applySnapshot(s: unknown): boolean;
      /** Current festival map id (null = not on the grounds). */
      grounds(): string | null;
      /** Another farmer began an activity (host-stamped): stage it in 3D. */
      onSpecBegin(s: CoopSpec): void;
      /** A staged moment of another farmer's activity. */
      onSpecEvent(sid: string, kind: string, value: number): void;
      /** Another farmer's activity is over (authoritative score / place). */
      onSpecEnd(sid: string, score: number, place: number): void;
      /** A race went that this farmer isn't in (spectators stage the field). */
      onSpecRace(r: CoopSpecRace): void;
    },
  ) {
    game.events.on('net:ext', ({ from, data }) => this.receive(from, data));
    game.events.on('net:status', ({ role, code }) => {
      // A farmhand that just joined asks the host for today's festival (boards, live activities).
      if (role === 'client' && code && this.saidHi !== code) {
        this.saidHi = code;
        this.hiTries = 0;
        this.gotSnap = false;
        const ask = (): void => {
          if (this.gotSnap || this.role() !== 'client' || this.hiTries++ > 40) return;
          this.send('host', ['fe.hi']);
          setTimeout(ask, 1500);
        };
        setTimeout(ask, 600);
      }
      if (role === 'solo') {
        this.saidHi = '';
        for (const sid of [...this.specs.keys()]) this.endSpec(sid, 0, 3);
      }
    });
    // A farmer who leaves the session mid-activity: the host closes their sessions for everyone.
    game.events.on('net:roster', ({ players }) => {
      if (this.role() !== 'host') return;
      const ids = new Set(players.map((p) => p.id));
      for (const s of [...this.hSessions.values()]) if (!ids.has(s.pid)) this.hostEnd(s.pid, [s.sid, 0, 3], true);
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

  /** Anyone else in the session at all (a host alone in its lobby plays solo). */
  private shared(): boolean {
    const n = this.net();
    return !!n && n.role() !== 'solo' && n.players().some((p) => !p.isMe);
  }

  private send(to: number | '*' | 'host', d: unknown[]): void {
    const n = this.net();
    if (!n || n.role() === 'solo') return;
    this.stats.msgsOut++;
    n.sendExt(to, d);
  }

  /** To the host (handled in place when this machine is the host). */
  private up(d: unknown[]): void {
    if (this.role() === 'host') this.hostRecv(this.myId(), d);
    else this.send('host', d);
  }

  /** Host → every machine, this one included. */
  private all(d: unknown[]): void {
    this.send('*', d);
    this.peerRecv(this.myId(), d);
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

  private avatarOf(id: number): import('../../entities/remote-farmer').RemoteFarmer | null {
    if (id === this.myId()) return null;
    return this.net()?.remotes?.get(id)?.farmer ?? null;
  }

  // ───────────────────────────────────────────── activities (every farmer)

  /**
   * This farmer starts an activity: the host opens a session for it (id, seed, start tick) and
   * stages it for everyone else. Null in solo play.
   */
  begin(act: ActivityId, partner?: string): CoopSession | null {
    if (!this.shared()) return null;
    const key = `${this.myId()}:${++this.keyN}`;
    const rec = { act, sid: null as string | null, seed: null as number | null, queue: [] as unknown[][], ended: null as [number, number] | null };
    this.mineByKey.set(key, rec);
    for (const k of [...this.mineByKey.keys()]) if (this.mineByKey.size > 6 && k !== key) this.mineByKey.delete(k);
    this.up(['fe.req', key, act, partner ?? '']);
    return {
      act,
      sid: () => rec.sid,
      seed: () => rec.seed,
      event: (kind, value) => {
        if (!EVENTS[act].includes(kind)) return;
        const msg = ['fe.ev', '', kind, +num(value).toFixed(3)];
        if (rec.sid) {
          msg[1] = rec.sid;
          this.up(msg);
        } else if (rec.queue.length < 64) rec.queue.push(msg);
      },
      end: (score, place) => {
        rec.ended = [score, place];
        if (rec.sid) this.up(['fe.end', rec.sid, score, place]);
      },
    };
  }

  /** Host: a farmhand's result (legacy relay path kept for older clients). */
  shareScore(act: ActivityId, score: number, place: number, board: CoopRow[]): void {
    // Results now ride the session (fe.end); a host with no session for it still publishes its board.
    if (this.role() === 'host') this.broadcastBoard(act, board);
    void score;
    void place;
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

  // ───────────────────────────────────────────── races (every farmer)

  /** Is another farmer's start-line lobby open for `act` (you'd join it)? */
  invite(act: ActivityId): { name: string; left: number } | null {
    const l = this.lobbies.get(act);
    if (!l || l.until < performance.now() || l.members.includes(this.myId())) return null;
    return { name: this.who(l.owner).name, left: (l.until - performance.now()) / 1000 };
  }

  /**
   * Line up for a shared race (sack race / skate). Null in solo play. The host owns the lobby, the
   * lanes, the seed and the start tick; this resolves to the host's race (or null if it never came).
   */
  lineUp(act: ActivityId): CoopLobby | null {
    if (!RACE_ACTS.has(act) || !this.shared()) return null;
    const quick = this.others().length === 0;
    const me = this.myId();
    let cancelled = false;
    const result = new Promise<CoopRace | null>((resolve) => {
      const tm = setTimeout(() => {
        if (this.waitGo?.act === act) this.waitGo = null;
        resolve(null);
      }, LOBBY_MS + 6000);
      this.waitGo = {
        act,
        lobbyId: null,
        go: (r) => {
          clearTimeout(tm);
          resolve(cancelled ? null : r);
        },
      };
    });
    this.up(['fe.line', act, quick ? 0 : 1]);
    this.note(`line ${act}${quick ? ' (quick)' : ''}`);
    const lob = (): { id: string; owner: number; members: number[]; until: number } | undefined => this.lobbies.get(act);
    return {
      get owner() {
        return lob()?.owner === me;
      },
      act,
      quick,
      joined: () => (lob()?.members ?? []).filter((id) => id !== me).map((id) => this.who(id)),
      waitingFor: () => this.others().filter((id) => !(lob()?.members ?? []).includes(id)).map((id) => this.who(id)),
      left: () => Math.max(0, ((lob()?.until ?? performance.now()) - performance.now()) / 1000),
      startNow: () => {
        const l = lob();
        if (l) this.up(['fe.start', l.id]);
      },
      cancel: () => {
        cancelled = true;
        const l = lob();
        if (l) this.up(['fe.leave', l.id]);
        const w = this.waitGo;
        if (w?.act === act) {
          this.waitGo = null;
          w.go(null);
        }
      },
      result,
    };
  }

  private makeRace(act: ActivityId, id: string, seed: number, lanes: [number, number][]): CoopRace {
    const me = this.myId();
    const myLane = lanes.find(([p]) => p === me)?.[1] ?? 0;
    const racers = lanes.filter(([p]) => p !== me).map(([p, lane]) => ({ id: p, key: `p${p}`, lane, ...this.who(p) }));
    const buf = this.samples.get(id) ?? new Map<number, CoopSample>();
    this.samples.set(id, buf);
    for (const k of [...this.samples.keys()]) if (this.samples.size > 4 && k !== id) this.samples.delete(k);
    this.note(`race ${id} lane ${myLane} vs ${racers.map((r) => `${r.id}@${r.lane}`).join(',') || '-'}`);
    let sentFin = false;
    return {
      act,
      id,
      seed,
      me,
      myLane,
      racers,
      sample: (p) => buf.get(p) ?? null,
      report: (t, p, fin, extra = []) => {
        const now = performance.now();
        const first = fin >= 0 && !sentFin;
        if (!first && now - this.lastSend < 95) return;
        if (fin >= 0) sentFin = true;
        this.lastSend = now;
        this.up(['fe.in', id, +t.toFixed(3), +p.toFixed(4), +fin.toFixed(3), ...extra.map((v) => +v.toFixed(3))]);
      },
      avatar: (p) => this.avatarOf(p)?.root ?? null,
      standings: (timeoutMs = 4000) => {
        const w = this.standingsWait.get(id) ?? { rows: null, fns: [] };
        this.standingsWait.set(id, w);
        if (w.rows) return Promise.resolve(w.rows);
        return new Promise((res) => {
          const tm = setTimeout(() => res(null), timeoutMs);
          w.fns.push((r) => {
            clearTimeout(tm);
            res(r);
          });
        });
      },
    };
  }

  /** Races this machine is watching (not running), for the map's spectator staging. */
  specRace(act: ActivityId): CoopSpecRace | null {
    for (const r of this.specRaces.values()) if (r.act === act && !r.done) return r;
    return null;
  }

  // ───────────────────────────────────────────── host logic

  private hostRecv(from: number, d: unknown[]): void {
    const kind = d[0];
    switch (kind) {
      case 'fe.req': {
        const [, key, act, partner] = d as [string, string, ActivityId, string];
        if (!EVENTS[act]) return this.reject(from, `req ${String(act)}`);
        // One live activity per farmer: a new one closes the old.
        for (const s of [...this.hSessions.values()]) if (s.pid === from) this.hostEnd(from, [s.sid, 0, 3], true);
        const sid = `s${++this.sidN}`;
        const seed = (Math.random() * 2 ** 31) | 0;
        const s: HostSession = { sid, pid: from, act, partner: typeof partner === 'string' && partner ? partner.slice(0, 24) : undefined, seed, t0: performance.now(), log: [] };
        this.hSessions.set(sid, s);
        this.stats.staged++;
        this.all(['fe.stage', sid, from, act, s.partner ?? '', seed, String(key).slice(0, 32)]);
        return;
      }
      case 'fe.ev': {
        const [, sid, ev, value] = d as [string, string, string, number];
        const s = this.hSessions.get(sid);
        if (!s || s.pid !== from || !EVENTS[s.act].includes(ev)) return this.reject(from, `ev ${ev}`);
        const v = num(value);
        s.log.push([ev, v]);
        if (s.log.length > 48) s.log.shift();
        this.stats.relayed++;
        const msg = ['fe.x', sid, ev, v, Math.round(performance.now() - s.t0)];
        // Everyone but the farmer who played it (their own machine staged it already).
        for (const p of this.net()?.players() ?? []) if (p.id !== from && !p.isMe) this.send(p.id, msg);
        if (from !== this.myId()) this.peerRecv(this.myId(), msg);
        return;
      }
      case 'fe.end':
        return this.hostEnd(from, d.slice(1) as [string, number, number], false);
      case 'fe.line': {
        const [, act, lobby] = d as [string, ActivityId, number];
        if (!RACE_ACTS.has(act)) return this.reject(from, `line ${String(act)}`);
        const open = this.hLobbies.get(act);
        if (open && !open.done) {
          if (!open.members.includes(from) && open.members.length < 5) open.members.push(from);
          this.pubLobby(open);
          return;
        }
        const l: HostLobby = { act, id: `l${++this.sidN}`, owner: from, members: [from], until: performance.now() + (lobby ? LOBBY_MS : 0), timer: 0, done: false };
        this.hLobbies.set(act, l);
        if (!lobby) return this.hostGo(l);
        this.pubLobby(l);
        l.timer = window.setInterval(() => {
          // Everyone on the owner's grounds is at the line → go now; otherwise when the clock runs out.
          const mine = this.hooks.grounds();
          const where = (id: number): string | null => (id === this.myId() ? mine : this.mapOf(id));
          const grounds = where(l.owner);
          const present = (this.net()?.players() ?? []).filter((p) => grounds && where(p.id) === grounds).map((p) => p.id);
          const all = present.length > 1 && present.every((id) => l.members.includes(id));
          if (performance.now() >= l.until || all) this.hostGo(l);
        }, 250);
        return;
      }
      case 'fe.start': {
        const l = [...this.hLobbies.values()].find((x) => x.id === d[1]);
        if (l && !l.done && l.owner === from) this.hostGo(l);
        return;
      }
      case 'fe.leave': {
        const l = [...this.hLobbies.values()].find((x) => x.id === d[1]);
        if (!l || l.done) return;
        l.members = l.members.filter((id) => id !== from);
        if (!l.members.length) {
          l.done = true;
          clearInterval(l.timer);
          this.hLobbies.delete(l.act);
          this.all(['fe.lob', l.act, l.id, 0, l.owner, []]);
          return;
        }
        if (l.owner === from) l.owner = l.members[0]!;
        this.pubLobby(l);
        return;
      }
      case 'fe.in': {
        const [, id, t, p, fin, ...x] = d as [string, string, number, number, number, ...number[]];
        const r = this.hRaces.get(id);
        if (!r || r.done || !r.lanes.some(([q]) => q === from)) return;
        this.stats.progIn++;
        const now = (performance.now() - r.zero) / 1000;
        const row = r.rows.get(from) ?? { p: 0, fin: -1, x: [], t: 0 };
        if (row.fin >= 0) return;
        // Progress no faster than the game allows (a hacked / desynced client can't teleport).
        const rate = MAX_RATE[r.act] ?? 0.2;
        const cap = row.p + rate * Math.max(0, now - row.t + 0.3);
        const claim = num(p, 0, 1);
        if (claim > cap + 1e-4) this.stats.rejected++;
        row.p = Math.max(row.p, Math.min(claim, cap));
        row.t = now;
        row.x = x.slice(0, 4).map((v) => num(v, -1e4, 1e4));
        const f = num(fin, -1, 120);
        if (f >= 0 && row.p >= 0.999) {
          // Lag-compensated finish: the farmer's own race clock, but never earlier than the lag
          // window allows nor faster than the course can be run.
          row.fin = Math.max(1 / rate, Math.min(now, Math.max(now - LAG_S, f)));
          row.p = 1;
        }
        r.rows.set(from, row);
        if ([...r.lanes].every(([q]) => (r.rows.get(q)?.fin ?? -1) >= 0)) this.hostFinish(r);
        return;
      }
      case 'fe.hi': {
        if (from === this.myId()) return;
        const snap = this.hooks.snapshot() as Record<string, unknown>;
        // Live activities + races: a farmhand who joins mid-dance still sees it.
        snap.live = [...this.hSessions.values()].map((s) => [s.sid, s.pid, s.act, s.partner ?? '', s.seed, s.log.slice(-24)]);
        snap.races = [...this.hRaces.values()].filter((r) => !r.done).map((r) => [r.act, r.id, r.seed, r.lanes, Math.round(performance.now() - r.zero)]);
        this.send(from, ['fe.snap', snap]);
        return;
      }
      case 'fe.sc': {
        // Older farmhand build: a bare score claim (validated like a session end).
        const [, act, score, place] = d as [string, ActivityId, number, number];
        if (!EVENTS[act]) return;
        const row = this.validRow(from, act, score, place);
        this.hooks.onScore(act, row);
        return;
      }
    }
  }

  private mapOf(id: number): string | null {
    return this.net()?.players().find((p) => p.id === id)?.map ?? null;
  }

  private reject(from: number, what: string): void {
    this.stats.rejected++;
    this.note(`reject ${what} from ${from}`);
  }

  private validRow(pid: number, act: ActivityId, score: unknown, place: unknown): CoopRow {
    const w = this.who(pid);
    const hi = act === 'sackrace' ? 1000 : act === 'giftswap' ? 3 : Math.round((ACTIVITY_PAR[act] || 100) * 1.6);
    return { player: `p${pid}`, name: w.name, color: w.color, score: Math.round(num(score, 0, hi)), place: Math.max(0, Math.min(3, Math.round(num(place, 0, 3)))) };
  }

  private hostEnd(from: number, [sid, score, place]: [string, number, number], silent: boolean): void {
    const s = this.hSessions.get(sid);
    if (!s || s.pid !== from) return;
    this.hSessions.delete(sid);
    const row = this.validRow(from, s.act, score, place);
    // A race's place is the host's own ranking, whatever the client thought.
    if (s.act === 'sackrace') {
      for (const r of this.hRaces.values()) {
        const st = this.standingsWait.get(r.id)?.rows?.find((x) => x.id === from);
        if (st) {
          row.place = Math.min(3, st.place);
          row.score = st.fin >= 0 ? Math.round(1000 - st.place * 200) : 0;
        }
      }
    }
    this.all(['fe.fin', sid, from, silent ? -1 : row.score, silent ? 3 : row.place]);
    if (!silent) this.hooks.onScore(s.act, from === this.myId() ? { ...row, player: 'local', name: 'You' } : row);
  }

  private pubLobby(l: HostLobby): void {
    this.all(['fe.lob', l.act, l.id, Math.max(0, Math.round(l.until - performance.now())), l.owner, l.members]);
  }

  private hostGo(l: HostLobby): void {
    if (l.done) return;
    l.done = true;
    clearInterval(l.timer);
    this.hLobbies.delete(l.act);
    const id = `r${++this.sidN}`;
    const seed = (Math.random() * 2 ** 31) | 0;
    const lanes: [number, number][] = l.members.slice(0, 5).map((p, k) => [p, k]);
    const r: HostRace = { act: l.act, id, seed, lanes, zero: performance.now() + GO_DELAY_MS + COUNTDOWN_MS, rows: new Map(), timer: 0, done: false };
    this.hRaces.set(id, r);
    for (const k of [...this.hRaces.keys()]) if (this.hRaces.size > 4 && k !== id) this.hRaces.delete(k);
    this.note(`go ${id} lanes ${lanes.map(([p, k]) => `${p}@${k}`).join(',')}`);
    // Close the lobby for everyone, then the start tick.
    this.all(['fe.lob', l.act, l.id, 0, l.owner, []]);
    this.all(['fe.go', l.act, id, seed, lanes, GO_DELAY_MS]);
    r.timer = window.setInterval(() => {
      const t = (performance.now() - r.zero) / 1000;
      if (t < 0) return;
      const rows = r.lanes.map(([p]) => {
        const w = r.rows.get(p) ?? { p: 0, fin: -1, x: [], t: 0 };
        return [p, +w.p.toFixed(4), +w.fin.toFixed(3), ...w.x];
      });
      this.all(['fe.st', id, +t.toFixed(2), rows]);
      // Nobody finishes a sack race in 50 s (a dropped farmer doesn't hold the result forever).
      if (t > 52) this.hostFinish(r);
    }, 100);
  }

  /** Host ranks the field: every farmer (host clock + lag window) and the villager racers. */
  private hostFinish(r: HostRace): void {
    if (r.done) return;
    r.done = true;
    clearInterval(r.timer);
    const field: { id: number; fin: number; p: number; lane: number }[] = r.lanes.map(([p, lane]) => {
      const w = r.rows.get(p);
      return { id: p, fin: w?.fin ?? -1, p: w?.p ?? 0, lane };
    });
    if (r.act === 'sackrace') {
      const free = [0, 1, 2, 3, 4].filter((lane) => !r.lanes.some(([, l]) => l === lane));
      free.forEach((lane, k) => field.push({ id: -1 - k, fin: sackNpcFinish(r.seed, k), p: 1, lane }));
    }
    field.sort((a, b) => {
      const fa = a.fin >= 0 ? a.fin : 1e9;
      const fb = b.fin >= 0 ? b.fin : 1e9;
      return fa - fb || b.p - a.p || a.lane - b.lane;
    });
    const rows = field.map((f, place) => [f.id, place, +f.fin.toFixed(3)]).filter(([id]) => (id as number) >= 0);
    this.note(`res ${r.id} ${rows.map((x) => x.join('/')).join(' ')}`);
    this.all(['fe.st', r.id, +((performance.now() - r.zero) / 1000).toFixed(2), r.lanes.map(([p]) => {
      const w = r.rows.get(p) ?? { p: 0, fin: -1, x: [] };
      return [p, +w.p.toFixed(4), +w.fin.toFixed(3), ...w.x];
    })]);
    this.all(['fe.res', r.id, rows]);
  }

  // ───────────────────────────────────────────── inbound

  private receive(from: number, d: unknown[]): void {
    const kind = d[0];
    if (typeof kind !== 'string' || !kind.startsWith('fe.')) return;
    this.stats.msgsIn++;
    if (this.role() === 'host') {
      if (['fe.req', 'fe.ev', 'fe.end', 'fe.line', 'fe.start', 'fe.leave', 'fe.in', 'fe.hi', 'fe.sc'].includes(kind)) return this.hostRecv(from, d);
      return;
    }
    // Farmhand: only the host's word counts.
    const n = this.net();
    const host = n?.players().find((p) => p.isHost)?.id;
    if (host !== undefined && from !== host) return;
    this.peerRecv(from, d);
  }

  /** Host broadcasts, applied on every machine (the host's own included). */
  private peerRecv(_from: number, d: unknown[]): void {
    const me = this.myId();
    switch (d[0]) {
      case 'fe.stage': {
        const [, sid, pid, act, partner, seed, key] = d as [string, string, number, ActivityId, string, number, string];
        if (pid === me) {
          const rec = this.mineByKey.get(key);
          if (!rec) return;
          rec.sid = sid;
          rec.seed = seed;
          for (const m of rec.queue) {
            m[1] = sid;
            this.up(m);
          }
          rec.queue = [];
          if (rec.ended) this.up(['fe.end', sid, ...rec.ended]);
          return;
        }
        this.stageSpec(sid, pid, act, partner, seed);
        return;
      }
      case 'fe.x': {
        const [, sid, kind, value] = d as [string, string, string, number];
        if (this.specs.has(sid)) {
          this.stats.progUsed++;
          this.hooks.onSpecEvent(sid, kind, num(value));
        }
        return;
      }
      case 'fe.fin': {
        const [, sid, pid, score, place] = d as [string, string, number, number, number];
        if (pid !== me) this.endSpec(sid, num(score), num(place, 0, 3));
        return;
      }
      case 'fe.bd': {
        if (this.role() !== 'client') return;
        const [, act, rows] = d as [string, ActivityId, CoopRow[]];
        if (Array.isArray(rows)) this.hooks.onBoard(act, this.localise(rows));
        return;
      }
      case 'fe.snap': {
        if (this.role() !== 'client') return;
        const snap = d[1] as { boards?: Record<string, CoopRow[]>; live?: [string, number, ActivityId, string, number, [string, number][]][]; races?: [ActivityId, string, number, [number, number][], number][] } | null;
        if (snap?.boards) for (const k of Object.keys(snap.boards)) snap.boards[k] = this.localise(snap.boards[k] ?? []);
        // Too early (our calendar is still catching up with the host's)? The hello loop asks again.
        if (!this.hooks.applySnapshot(snap)) return;
        this.gotSnap = true;
        for (const [sid, pid, act, partner, seed, log] of snap?.live ?? []) {
          if (pid === me || this.specs.has(sid)) continue;
          this.stageSpec(sid, pid, act, partner, seed);
          for (const [k, v] of log ?? []) this.hooks.onSpecEvent(sid, k, num(v));
        }
        for (const [act, id, seed, lanes, ms] of snap?.races ?? []) this.watchRace(act, id, seed, lanes, -ms);
        return;
      }
      case 'fe.lob': {
        const [, act, id, ms, owner, members] = d as [string, ActivityId, string, number, number, number[]];
        if (!Array.isArray(members) || !members.length) {
          if (this.lobbies.get(act)?.id === id) this.lobbies.delete(act);
          return;
        }
        const fresh = this.lobbies.get(act)?.id !== id;
        this.lobbies.set(act, { id, owner, members, until: performance.now() + num(ms, 0, LOBBY_MS) });
        if (this.waitGo?.act === act && members.includes(me)) this.waitGo.lobbyId = id;
        if (fresh && !members.includes(me) && owner !== me) {
          this.stats.invites++;
          this.note(`invite ${id} from ${owner}`);
          this.game.events.emit('festival:lobby', { act, name: this.who(owner).name, left: Math.round(num(ms) / 1000) });
        }
        return;
      }
      case 'fe.go': {
        const [, act, id, seed, lanes, delay] = d as [string, ActivityId, string, number, [number, number][], number];
        if (!Array.isArray(lanes)) return;
        const w = this.waitGo;
        const inRace = lanes.some(([p]) => p === me);
        if (w && w.act === act && inRace) {
          this.waitGo = null;
          w.go(this.makeRace(act, id, seed, lanes));
          return;
        }
        if (!inRace) this.watchRace(act, id, seed, lanes, num(delay, 0, 5000) + COUNTDOWN_MS);
        return;
      }
      case 'fe.st': {
        const [, id, t, rows] = d as [string, string, number, (number[])[]];
        if (!Array.isArray(rows)) return;
        let buf = this.samples.get(id);
        if (!buf) {
          buf = new Map();
          this.samples.set(id, buf);
          for (const k of [...this.samples.keys()]) if (this.samples.size > 4 && k !== id) this.samples.delete(k);
        }
        const now = performance.now();
        for (const [p, pr, fin, ...x] of rows) {
          if (typeof p !== 'number') continue;
          buf.set(p, { t: num(t), p: num(pr, 0, 1), fin: num(fin, -1, 120), x: x.map((v) => num(v)), at: now });
        }
        return;
      }
      case 'fe.res': {
        const [, id, rows] = d as [string, string, [number, number, number][]];
        if (!Array.isArray(rows)) return;
        const st = rows.map(([i, place, fin]) => ({ id: num(i), place: num(place, 0, 9), fin: num(fin, -1, 120) }));
        const w = this.standingsWait.get(id) ?? { rows: null, fns: [] };
        w.rows = st;
        this.standingsWait.set(id, w);
        for (const f of w.fns.splice(0)) f(st);
        for (const k of [...this.standingsWait.keys()]) if (this.standingsWait.size > 6 && k !== id) this.standingsWait.delete(k);
        const sr = this.specRaces.get(id);
        if (sr) {
          sr.done = true;
          this.specRaces.delete(id);
        }
        return;
      }
    }
  }

  private stageSpec(sid: string, pid: number, act: ActivityId, partner: string, seed: number): void {
    if (this.specs.has(sid)) return;
    // A farmer's earlier session still showing (dropped fin): close it first.
    for (const s of [...this.specs.values()]) if (s.pid === pid) this.endSpec(s.sid, 0, 3);
    const w = this.who(pid);
    const spec: CoopSpec = { sid, pid, act, partner: partner || undefined, seed: num(seed), name: w.name, color: w.color, avatar: () => this.avatarOf(pid) };
    this.specs.set(sid, spec);
    this.note(`watch ${sid} ${act} by ${pid}`);
    this.hooks.onSpecBegin(spec);
  }

  private endSpec(sid: string, score: number, place: number): void {
    if (!this.specs.delete(sid)) return;
    this.hooks.onSpecEnd(sid, score, place);
  }

  private watchRace(act: ActivityId, id: string, seed: number, lanes: [number, number][], startInMs: number): void {
    if (this.specRaces.has(id)) return;
    const zero = performance.now() + startInMs;
    const buf = this.samples.get(id) ?? new Map<number, CoopSample>();
    this.samples.set(id, buf);
    const r = { id, act, seed: num(seed), lanes, zero, done: false, clock: () => (performance.now() - zero) / 1000, sample: (p: number) => buf.get(p) ?? null };
    this.specRaces.set(id, r);
    for (const k of [...this.specRaces.keys()]) if (this.specRaces.size > 3 && k !== id) this.specRaces.delete(k);
    this.hooks.onSpecRace(r);
  }

  /** Live games / races other farmers are playing (staged when you walk onto their grounds). */
  live(): { specs: CoopSpec[]; races: CoopSpecRace[] } {
    return { specs: [...this.specs.values()], races: [...this.specRaces.values()].filter((r) => !r.done) };
  }

  /** Spectated activities (diagnostics / tests). */
  watching(): { sid: string; pid: number; act: string }[] {
    return [...this.specs.values()].map((s) => ({ sid: s.sid, pid: s.pid, act: s.act }));
  }
}

declare module '../../core/events' {
  interface GameEvents {
    /** Another farmer opened a start-line lobby at this festival (sack race / skate). */
    'festival:lobby': { act: string; name: string; left: number };
  }
}
