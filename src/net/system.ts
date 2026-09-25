/**
 * NetSystem — 1-4 player co-op on a shared farm (DESIGN pillar 13).
 *
 * Topology: every browser connects to the relay (server/index.mjs). The HOST's browser runs the
 * authoritative simulation; farmhands (clients) send intents, the host validates + applies them and
 * broadcasts compact deltas. Solo play never touches any of this (role 'solo', no socket).
 *
 *   farmhand → *      ['st', seq, t, map, xcm, zcm, yawc, anim, energy, rtt]   20 Hz own state, stamped
 *                     with the farmhand's frame clock. Sent to everyone: the host validates it (['fix']),
 *                     the other farmhands interpolate it on the sender's clock (no host re-stamping).
 *   farmhand → host   ['use', seq, itemId, x, z, facing]  tool / seed intent (predicted locally)
 *                     ['act', seq, x, z]                   harvest-by-hand intent (predicted)
 *                     ['gold', seq, delta]                 purse change (host may deny a spend: ['gdeny'])
 *                     ['psave', seq, data, counts]         personal save (versioned; on every backpack change)
 *                     ['chat', text] · ['emo', id] · ['bed', 0|1] · ['look', look, name] · ['ping', t]
 *                     ['need'] · ['hello', {name, look, pid, fresh, rejoin}]
 *   host → farmhands  ['s', t, [[id, map, xcm, zcm, yawc, anim]]]   20 Hz host sample (host frame clock)
 *                     ['did', id, itemId|'@act', x, z, facing]  another farmer acted (replayed + animated)
 *                     ['ack', seq, ok, [[tile, state], ...]]    ok: 0 refused · 1 applied · 2 no-op
 *                     ['give', itemId, qty, quality] · ['fix', seq, x, z] · ['gdeny', seq]
 *                     ['farm', [[tile, state], ...]]   farm tile deltas (≤ 5 Hz, only when something changed)
 *                     ['full', {save, debris, digest}] whole farm (join, rejoin, every morning)
 *                     ['cal', day, season, year, hour, weather] 1 Hz · ['gold', total, {id: seq}]
 *                     ['roster', [...]] · ['beds', [ids]] · ['sleep'] · ['chat', id, text] · ['emo', id, emote]
 *                     ['welcome', {...}] · ['pong', t]
 *   worker ↔ worker   ['~ping', t] / ['~pong', t]  network RTT, answered in the socket worker (transport.ts)
 *
 * Timing: all periodic sends run on a 50 ms interval ticker (not the render loop) and carry the
 * timestamp of the frame the state was sampled on, so irregular frame pacing never distorts motion.
 *
 * Identity + saves: every browser has a persistent player id (localStorage `hearthvale.pid`); the host
 * keys farmhand personal saves by it (never by display name). A farmhand never writes the host's farm
 * into its own save slots (SaveManager guard) — its personal state lives on the host (psave) and in a
 * local per-farm copy; when the session ends it goes back to its own farm (the snapshot taken on join).
 *
 * Local player: movement is predicted locally; the host range-checks it and answers with ['fix'],
 * which the farmhand reconciles against its position history. Remote players: interpolated ~100 ms
 * behind (net/players.ts). Shared: farm tiles, crops, debris, gold, calendar, weather. Per player:
 * inventory, energy, skills, relationships (each farmhand's own game systems).
 *
 * Limits: no host migration — if the host leaves, farmhands return to their own farms.
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import type { SaveFile } from '../core/save';
import type { EventName, GameEvents, Facing } from '../core/events';
import { SEASONS, WEATHERS, type Season, type Weather } from '../core/time';
import { FarmSync, FARM_TOOLS } from './farmsync';
import { RemotePlayers, type RemotePlayer } from './players';
import { Transport, defaultServerUrl, type Ctrl } from './transport';
import { Cabins, CABIN_SITES, cabinDoor, cabinFront } from './cabins';
import { CoopDemo } from './demo';
import { NetBridge } from './bridge';
import { IMPACT, type ActionKind } from '../entities/farmer-actions';
import { applyLookToPlayer } from '../entities/remote-farmer';
import { DEFAULT_LOOK, isDefaultLook, loadProfile, saveProfile, sanitizeLook, hex, PRESET_LOOKS, type FarmerLook, type FarmerProfile } from '../entities/remote-look';
import { EmoteBubble, EMOTES, renderEmoteOverlay, type EmoteId } from '../entities/remote-emotes';
import { itemDef } from '../data/items';
import { CROPS } from '../data/crops';
import { CoopUi } from '../ui/coop';

export type Role = 'solo' | 'host' | 'client';

export interface PlayerView {
  id: number;
  name: string;
  look: FarmerLook;
  isHost: boolean;
  isMe: boolean;
  ready: boolean;
  ping: number;
  map: string;
  away: boolean;
  cabin: number;
}

export interface NetStats {
  role: Role;
  status: string;
  code: string | null;
  id: number;
  players: number;
  /** Network round trip to the host through the relay (worker-timed), ms. */
  rtt: number;
  /** Round trip to the relay server only, ms. */
  relayRtt: number;
  /** App-level round trip (main thread → host main thread → back), ms. */
  appRtt: number;
  fps: number;
  frameMs: { avg: number; p95: number; p99: number };
  bytesIn: number;
  bytesOut: number;
  msgsIn: number;
  msgsOut: number;
  pendingIntents: number;
  queued: number;
  farmTiles: number;
  /** Host edits applied to our farm (other farmers' work arriving; tiles that actually changed). */
  reconciles: number;
  /** Drift: tiles where our farm disagreed with the host's with no edit in flight (should stay ~0). */
  drift: number;
  /** Full-farm resyncs asked for mid-day (a tile we couldn't rebuild); join / morning syncs aren't counted. */
  needs: number;
  /** Last drift fixes, `tile:ours→host's` (diagnostics). */
  driftLog: string[];
  fullSyncs: number;
  corrections: number;
  refunds: number;
  goldDenied: number;
}

export interface NetApi {
  role(): Role;
  status(): string;
  code(): string | null;
  myId(): number;
  players(): PlayerView[];
  profile(): FarmerProfile;
  setProfile(p: FarmerProfile): void;
  /** Open this farm to co-op (connects to the relay, returns the invite code). */
  host(): Promise<string>;
  /** Join a farm. `fromTitle`: leaving later returns to the title screen instead of a restored farm. */
  join(code: string, opts?: { fromTitle?: boolean }): Promise<void>;
  leave(): void;
  /** Host: remove a farmhand from the farm (frees their slot; they can't rejoin for a minute). */
  kick(id: number): void;
  chat(text: string): void;
  emote(id: EmoteId): void;
  /** Ready for bed (co-op: the day ends when everyone is). */
  goToBed(where: 'house' | 'cabin'): void;
  cancelBed(): void;
  sleeping(): boolean;
  /** Host: end the day now even though someone is still up ("sleep anyway"). */
  forceSleep(): void;
  /** performance.now() when this farmer got into bed (0 = awake). */
  bedSince(): number;
  stats(): NetStats;
  serverUrl: string;
  /** Tests: drop the socket (auto-reconnect + rejoin follows). */
  simulateDrop(): void;
  mySlot(): number;
  /** This browser's persistent player id (keys the host's personal saves). */
  playerId(): string;
  /**
   * Extension channel for other pods: send `data` (JSON array) to a player id, everyone ('*') or the
   * host ('host'); it arrives there as the `net:ext` event. No-op in solo play.
   */
  sendExt(to: number | '*' | 'host', data: unknown[]): void;
  /** The last night's "Farm today" tally (every farmer's harvest / watering / tilling / sowing), or null. */
  dayTally(): DayTally[] | null;
}

/** One farmer's work over the day that just ended (day-end card). */
export interface DayTally {
  id: number;
  name: string;
  look: FarmerLook;
  isMe: boolean;
  /** [harvested, watered, tilled, sown] */
  n: number[];
}

declare module '../core/game' {
  interface GameServices {
    net: NetApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'net:status': { role: Role; status: string; code: string | null };
    'net:roster': { players: PlayerView[] };
    'net:chat': { id: number; name: string; text: string; color: string; system?: boolean };
    'net:emote': { id: number; emote: EmoteId };
    'net:beds': { ready: number[]; total: number; sleeping: boolean };
    'net:error': { text: string };
    /**
     * Extension channel for other pods' co-op wiring (e.g. world/mine/coop.ts): a payload another
     * machine sent with `services.net.sendExt(to, data)`. `from` = sender's player id (always a
     * member of this lobby — anything else is dropped before it reaches you).
     */
    'net:ext': { from: number; data: unknown[] };
  }
}

const TICK_MS = 50;
const FARM_MS = 200;
const CAL_MS = 1000;
const PING_MS = 2000;
const PSAVE_MS = 10_000;
const MAX_REACH = 2.9;
const MAX_SPEED = 9.5;
/** Largest single purse gain a farmhand may report (a full shipping bin of rare goods). */
const MAX_GOLD_GAIN = 250_000;
const PERSONAL_KEYS = ['inventory', 'energy', 'relationships', 'fishing', 'mining', 'combat'];
const PID_KEY = 'hearthvale.pid';

/** Produce / materials a farm action can hand out (recognises our own predicted loot). */
const FARM_LOOT = new Set<string>(['fiber', 'wood', 'stone', 'hardwood', 'sap', 'coal', 'copperOre', 'ironOre', 'clay', 'sprinkler', 'qualitySprinkler', ...Object.values(CROPS).map((c) => c.produce)]);

const cm = (v: number): number => Math.round(v * 100);

function isFarmItem(id: string): boolean {
  if (FARM_TOOLS.has(id)) return true;
  const d = itemDef(id);
  return d?.kind === 'seed' || /fertilizer/i.test(id) || /sprinkler/i.test(id);
}

/** Items a farm action uses up (the host checks the farmhand has them; refunded if the action no-ops). */
function isConsumable(id: string): boolean {
  return !FARM_TOOLS.has(id) && isFarmItem(id);
}

export function actionFor(itemId: string): { kind: ActionKind; tool: string | null } {
  if (itemId === '@act') return { kind: 'pull', tool: null };
  if (itemId === 'hoe' || itemId === 'axe' || itemId === 'pickaxe') return { kind: 'chop', tool: itemId };
  if (itemId === 'scythe') return { kind: 'sweep', tool: 'scythe' };
  if (itemId === 'wateringCan') return { kind: 'pour', tool: 'wateringCan' };
  if (/sprinkler/i.test(itemId)) return { kind: 'place', tool: null };
  return { kind: 'sow', tool: 'seeds' };
}

const FACINGS: Facing[] = ['up', 'down', 'left', 'right'];
const yawOf = (f: Facing): number => (f === 'down' ? 0 : f === 'up' ? Math.PI : f === 'left' ? -Math.PI / 2 : Math.PI / 2);

/** Persistent per-browser player id. */
function loadPid(): string {
  const make = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `p${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
  try {
    let id = localStorage.getItem(PID_KEY);
    if (!id) {
      id = make();
      localStorage.setItem(PID_KEY, id);
    }
    return id;
  } catch {
    return make();
  }
}

interface Pending {
  seq: number;
  tiles: number[];
  t: number;
  /** Consumable spent by the local prediction (refunded if the host's answer is refused / no-op). */
  spent: string | null;
}

interface PSave {
  seq: number;
  data: Record<string, unknown>;
}

interface GoldPending {
  seq: number;
  delta: number;
  /** Items that arrived with this purchase (rolled back if the host denies the spend). */
  items: Map<string, number> | null;
}

interface Home {
  snap: SaveFile;
  debris: [number, string][];
  fromTitle: boolean;
}

export class NetSystem implements System, NetApi {
  readonly name = 'net';
  private game!: Game;
  sync!: FarmSync;
  remotes!: RemotePlayers;
  private cabins = new Cabins();
  private ui!: CoopUi;
  private demo!: CoopDemo;
  private bridge!: NetBridge;

  private _role: Role = 'solo';
  private _status = 'offline';
  private transport: Transport | null = null;
  private id = 0;
  private hostId = 0;
  private _code: string | null = null;
  private token: string | null = null;
  serverUrl = defaultServerUrl();
  private prof: FarmerProfile = { name: 'Farmer', look: DEFAULT_LOOK };
  /** Name the lobby gave us (deduped: "Ash 2"). */
  private sessionName: string | null = null;
  private pid = '';
  /** pid as the relay sees it (a second tab of the same browser gets a derived one). */
  private sessionPid = '';
  private undoLook: (() => void) | null = null;
  private myBubble: EmoteBubble | null = null;

  // shared
  private timers: { at: number; fn: () => void }[] = [];
  private ticker = 0;
  private tFarm = 0;
  private tCal = 0;
  private tPing = 0;
  private tDrift = 0;
  private tPsave = 0;
  private lastTickAt = 0;
  /** Frame clock: when the latest rendered frame sampled the player (ms, performance.now()). */
  private frameAt = 0;
  private frameNo = 0;
  private sentFrame = -1;
  private appRtt = 0;
  private appRtts: number[] = [];
  private frameTimes = new Float32Array(240);
  private frameIdx = 0;
  private frameCount = 0;
  private ready = false;
  private asleep = false;
  /**
   * Farmhand: between the host's 'sleep' order and our own end-of-day. The host's morning farm can
   * land before our (slower) fade finishes; applying it and then running our own overnight growth on
   * top would double-grow and dry the farm. It is held (`heldFull`) and applied after our roll.
   */
  private rolling = false;
  private rollingAt = 0;
  private heldFull: FullState | null = null;
  private asleepAt = 0;
  private bedWhere: 'house' | 'cabin' = 'house';
  private applyingGold = false;
  private hostBeds = new Set<number>();
  private counters = { reconciles: 0, drift: 0, needs: 0, fullSyncs: 0, corrections: 0, refunds: 0, goldDenied: 0 };
  /** Our own work today: [harvested, watered, tilled, sown] (farmhands report it to the host). */
  private today = [0, 0, 0, 0];
  private todayDirty = false;
  private todaySentAt = 0;
  /** Host: each farmhand's reported tally for today. */
  private tallies = new Map<number, number[]>();
  private lastTally: DayTally[] | null = null;

  // host
  private sentTiles = new Map<number, string>();
  private farmDirty = true;
  private goldDirty = false;
  private goldAcks: Record<number, number> = {};
  private cabinOf = new Map<number, number>();
  /** Farmhand personal saves, keyed by persistent player id. */
  private psaves = new Map<string, PSave>();
  private pidOf = new Map<number, string>();
  /** Host mirror of each farmhand's consumables (from psave counts; decremented per applied use). */
  private stock = new Map<number, Map<string, number>>();
  private lastFullAt = 0;

  // farmhand
  private seq = 0;
  private stSeq = 0;
  private pending = new Map<number, Pending>();
  private pendingTiles = new Map<number, number>();
  /**
   * Farmhand: tiles another farmer's swing is about to land on (a 'did' replay is scheduled at its
   * impact frame). The host's delta for them usually arrives first — it is held back and checked
   * after the replay, so the change plays with its FX at impact instead of popping in early.
   */
  private replayTiles = new Map<number, number>();
  private hostTiles = new Map<number, string>();
  private goldPending: GoldPending[] = [];
  private giveOk = false;
  private predictUntil = 0;
  private history: { seq: number; x: number; z: number }[] = [];
  private correction = { x: 0, z: 0 };
  private needFullAt = 0;
  private welcomed = false;
  private hostName = 'Host';
  private lastPos = { x: 0, z: 0, map: '', t: 0 };
  private teleported = false;
  private planted = -1;
  private pseq = 0;
  private psaveDirty = false;
  private psaveTimer = 0;
  private localPsaveTimer = 0;
  private starter: Record<string, unknown> = {};
  private home: Home | null = null;
  private restoring = false;

  init(game: Game): void {
    this.game = game;
    this.sync = new FarmSync(game);
    this.remotes = new RemotePlayers(game);
    game.provide('net', this);
    this.pid = loadPid();
    const p = loadProfile();
    if (p) this.prof = p;
    this.applyLocalLook();
    this.ui = new CoopUi(game, this);
    this.demo = new CoopDemo(game, this);
    this.bridge = new NetBridge(game, {
      role: () => this._role,
      myId: () => this.id,
      toHost: (d) => this.toHost(d),
      toAll: (d) => this.toAll(d),
      to: (id, d) => this.to(id, d),
      peersOn: (map) => [...this.remotes.list.values()].filter((p) => !p.away && (map === '*' || p.map === map)).map((p) => p.id),
    });
    this.remotes.fishingCheck = (id) => this.bridge.fishing(id);
    // Mine floors share one map id: only show farmers on our floor (the mine pod knows who is where).
    this.remotes.visibleCheck = (id) => {
      const mn = (game.services as Record<string, unknown>).mineNet as { sameFloor?: (id: number) => boolean } | undefined;
      return typeof mn?.sameFloor === 'function' ? mn.sameFloor(id) : true;
    };
    // A new farmhand arrives with a fresh starter kit (their own farm's backpack stays at home).
    this.starter = this.personalData();

    // One permanent interceptor: routes bed / cabin interactions in co-op, recognises our own
    // predicted farm actions, and swallows loot we predicted (the host's ['give'] is authoritative).
    const prev = game.events.interceptor;
    game.events.interceptor = (name, payload) => {
      if (this.intercept(name, payload)) return true;
      return prev ? prev(name, payload) : false;
    };

    // Flag our own teleports (warps, beds, debug) so the host never treats them as speeding.
    const pl = game.player;
    const tp = pl.teleport.bind(pl);
    pl.teleport = (x: number, z: number): void => {
      tp(x, z);
      this.teleported = true;
    };
    // A farmhand never writes the host's farm into its own save slots: "saving" stores the personal
    // part (backpack, energy, friendships, skills) on the host + in a local per-farm copy instead.
    game.saves.guard = (slot) => {
      if (this._role !== 'client') return null;
      void slot;
      this.persistLocalPsave();
      if (this.welcomed) this.sendPersonal();
      return true;
    };
    game.events.on('load:after', () => {
      // Loading one of your own saves mid-session: you're home now.
      if (this._role === 'client' && !this.restoring) {
        this.home = null;
        this.leave();
      }
    });
    game.events.on('item:use', (e) => this.onLocalUse(e));
    game.events.on('crop:planted', ({ x, z }) => {
      const g = this.sync.grid();
      if (g && !this.sync.inRemote) this.planted = g.idx(x, z);
    });
    game.events.on('soil:fertilized', ({ x, z }) => {
      const g = this.sync.grid();
      if (g && !this.sync.inRemote) this.planted = g.idx(x, z);
    });
    game.events.on('gold:change', ({ delta }) => this.onGold(delta));
    game.events.on('inventory:change', () => this.markPersonal());
    game.events.on('day:start', () => this.onDayStart());
    game.events.on('map:change', () => this.refreshCabins());
    game.events.on('demo:stage', ({ showcase, name }) => this.demo.stage(name, showcase));
    game.events.on('game:pause', ({ paused }) => {
      // Co-op never stops the shared clock for a menu (the host's time is everyone's time).
      if (paused && this._role !== 'solo' && game.hud.openPanelName) queueMicrotask(() => this.game.setPaused(false));
    });
    for (const n of ['soil:tilled', 'soil:watered', 'crop:planted', 'crop:harvested', 'crop:withered', 'crop:giant', 'tool:impact', 'crow:eat', 'player:interact'] as EventName[]) {
      game.events.on(n, () => (this.farmDirty = true));
    }
    // "Farm today": count our own farm work (not other farmers' work replayed on our farm).
    (['crop:harvested', 'soil:watered', 'soil:tilled', 'crop:planted'] as EventName[]).forEach((n, i) =>
      game.events.on(n, () => {
        if (this._role === 'solo' || this.sync.inRemote || this.demo.active) return;
        this.today[i]!++;
        this.todayDirty = true;
      }),
    );
    game.events.on('game:ready', () => this.autoStart());
    // Name tags / chat bubbles follow this frame's camera (placed after the render, even when paused).
    this.remotes.localBubble = () => this.myBubble;
    game.afterRender.push(() => {
      // Layout first (it pins the emote bubbles beside their name pills), then the bubble pass —
      // not over the lobby's blurred still (the world isn't what's on screen then).
      this.remotes.placeTags(this.game.simDt);
      if (!this.game.renderOverride) renderEmoteOverlay(this.game.rc.renderer, this.game.rc.camera);
    });
    // Last chance to hand the host our backpack before the tab goes away.
    window.addEventListener('pagehide', () => {
      if (this._role !== 'client') return;
      this.persistLocalPsave();
      if (this.welcomed) this.sendPersonal();
    });
  }

  // ════════════════════════════════════════════════════════════ API

  role(): Role {
    return this._role;
  }
  status(): string {
    return this._status;
  }
  code(): string | null {
    return this._code;
  }
  myId(): number {
    return this.id;
  }
  playerId(): string {
    return this.sessionPid || this.pid;
  }
  profile(): FarmerProfile {
    return this.prof;
  }
  sleeping(): boolean {
    return this.asleep;
  }
  dayTally(): DayTally[] | null {
    return this.demo.active ? this.demo.tally() : this.lastTally;
  }
  bedSince(): number {
    return this.asleep ? this.asleepAt : 0;
  }
  mySlot(): number {
    return this._role === 'client' ? (this.cabinOf.get(this.id) ?? -1) : -1;
  }
  private myName(): string {
    return this.sessionName ?? this.prof.name;
  }

  /** Staged demos (net/demo.ts): the host's display name while a solo farm plays co-op; null restores. */
  demoName(n: string | null): void {
    if (this._role !== 'solo') return;
    this.sessionName = n && this.prof.name === 'Farmer' ? n : null;
    this.emitRoster();
  }

  setProfile(p: FarmerProfile): void {
    this.prof = { name: p.name.trim().slice(0, 20) || 'Farmer', look: sanitizeLook(p.look) };
    saveProfile(this.prof);
    this.applyLocalLook();
    if (this._role === 'client') {
      this.sessionName = null;
      this.toHost(['look', this.prof.look, this.prof.name]);
    }
    if (this._role === 'host') this.broadcastRoster();
    this.emitRoster();
  }

  private applyLocalLook(): void {
    this.undoLook?.();
    this.undoLook = null;
    if (!isDefaultLook(this.prof.look)) this.undoLook = applyLookToPlayer(this.game.player, this.prof.look);
  }

  players(): PlayerView[] {
    const me: PlayerView = {
      id: this.id || 1,
      name: this.myName(),
      look: this.prof.look,
      isHost: this._role !== 'client',
      isMe: true,
      ready: this.asleep,
      ping: this._role === 'client' ? this.rtt() : 0,
      map: this.game.world.current?.id ?? '',
      away: false,
      cabin: this.mySlot(),
    };
    const out = [me];
    for (const p of this.remotes.list.values()) {
      // (a farmhand's latency to the host is its own round trip)
      const ping = this._role === 'client' && p.id === this.hostId ? this.rtt() : p.ping;
      out.push({ id: p.id, name: p.name, look: p.look, isHost: p.isHost, isMe: false, ready: p.ready, ping, map: p.map, away: p.away, cabin: p.cabin });
    }
    return out.sort((a, b) => Number(b.isHost) - Number(a.isHost) || a.id - b.id);
  }

  /** Network RTT to the host (worker-timed through the relay), falling back to the app ping. */
  private rtt(): number {
    const t = this.transport;
    return t && t.timedInWorker && t.peerRtt > 0 ? t.peerRtt : this.appRtt;
  }

  stats(): NetStats {
    const n = Math.min(this.frameCount, this.frameTimes.length);
    const ft = Array.from(this.frameTimes.subarray(0, n)).sort((a, b) => a - b);
    const avg = n ? ft.reduce((s, v) => s + v, 0) / n : 0;
    const q = (k: number): number => (n ? ft[Math.min(n - 1, Math.floor(n * k))]! : 0);
    const t = this.transport;
    const r1 = (v: number): number => Math.round(v * 10) / 10;
    return {
      role: this._role,
      status: this._status,
      code: this._code,
      id: this.id,
      players: 1 + this.remotes.list.size,
      rtt: r1(this._role === 'client' ? this.rtt() : 0),
      relayRtt: r1(t?.relayRtt ?? 0),
      appRtt: r1(this.appRtt),
      fps: avg ? Math.round(10000 / avg) / 10 : 0,
      frameMs: { avg: Math.round(avg * 100) / 100, p95: Math.round(q(0.95) * 100) / 100, p99: Math.round(q(0.99) * 100) / 100 },
      bytesIn: t?.bytesIn ?? 0,
      bytesOut: t?.bytesOut ?? 0,
      msgsIn: t?.msgsIn ?? 0,
      msgsOut: t?.msgsOut ?? 0,
      pendingIntents: this.pending.size,
      queued: t?.queued ?? 0,
      farmTiles: this._role === 'client' ? this.hostTiles.size : this.sentTiles.size,
      ...this.counters,
      driftLog: this.driftLog.slice(),
    };
  }

  host(): Promise<string> {
    if (this._role === 'host' && this._code) return Promise.resolve(this._code);
    this.leave();
    this.demo.clear();
    this._role = 'host';
    this.id = 1;
    this.hostId = 1;
    this.sessionName = null;
    this.setStatus('connecting');
    return new Promise((resolve, reject) => {
      const t = this.makeTransport();
      t.hello = () => (this._code && this.token ? { t: 'host', code: this._code, token: this.token, name: this.prof.name, look: this.prof.look, pid: this.pid } : { t: 'host', name: this.prof.name, look: this.prof.look, pid: this.pid });
      let settled = false;
      const off = this.game.events.on('net:status', ({ status }) => {
        if (settled) return;
        if (status === 'hosting' && this._code) {
          settled = true;
          off();
          resolve(this._code);
        } else if (status === 'offline') {
          settled = true;
          off();
          reject(new Error('could not reach the co-op server'));
        }
      });
      t.connect();
      setTimeout(() => {
        if (settled) return;
        settled = true;
        off();
        reject(new Error('the co-op server did not answer'));
      }, 12000);
    });
  }

  join(code: string, opts?: { fromTitle?: boolean }): Promise<void> {
    // Remember our own farm so leaving (or the host closing up) brings us home.
    // (Joined from the title screen: the world in memory was never started — go back to the title.)
    if (this._role === 'solo') this.home = { snap: this.game.saves.snapshot(), debris: this.sync.debris(), fromTitle: opts?.fromTitle ?? this.game.hud.openPanelName === 'title' };
    this.leave(true);
    this.demo.clear();
    this._role = 'client';
    this._code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    this.welcomed = false;
    this.sessionName = null;
    // Intent seqs start at wall-clock ms: always newer than anything a previous page load sent.
    this.seq = Math.max(this.seq, Date.now());
    this.setStatus('connecting');
    let rejoinToken: string | null = null;
    try {
      const s = JSON.parse(sessionStorage.getItem('hearthvale.coop') ?? 'null') as { code?: string; token?: string } | null;
      if (s?.code === this._code && s.token) rejoinToken = s.token;
    } catch {
      /* ignore */
    }
    this.token = rejoinToken;
    return new Promise((resolve, reject) => {
      const t = this.makeTransport();
      t.hello = () => ({ t: 'join', code: this._code, name: this.prof.name, look: this.prof.look, token: this.token ?? undefined, pid: this.pid });
      let settled = false;
      const offW = this.game.events.on('net:status', ({ status }) => {
        if (settled) return;
        if (status === 'playing') {
          settled = true;
          offW();
          offE();
          resolve();
        } else if (status === 'offline') {
          settled = true;
          offW();
          offE();
          reject(new Error('could not join'));
        }
      });
      const offE = this.game.events.on('net:error', ({ text }) => {
        if (settled) return;
        settled = true;
        offW();
        offE();
        reject(new Error(text));
      });
      t.connect();
      setTimeout(() => {
        if (settled) return;
        settled = true;
        offW();
        offE();
        reject(new Error('the farm did not answer'));
      }, 30000);
    });
  }

  /** `keepHome`: switching farms — don't restore our own farm in between. */
  leave(keepHome = false): void {
    if (this._role === 'solo' && !this.transport) return;
    if (this._role === 'client' && this.welcomed) {
      this.persistLocalPsave();
      this.sendPersonal();
    }
    this.transport?.close();
    this.transport = null;
    this.endSession(keepHome);
  }

  kick(id: number): void {
    if (this._role !== 'host' || id === this.id) return;
    this.transport?.sendCtrl({ t: 'kick', id });
  }

  simulateDrop(): void {
    this.transport?.drop();
  }

  sendExt(to: number | '*' | 'host', data: unknown[]): void {
    if (this._role === 'solo' || !this.transport) return;
    const msg = ['x', data];
    if (to === 'host') {
      if (this._role === 'client') this.toHost(msg);
    } else if (to === '*') this.toAll(msg);
    else if (to !== this.id) this.to(to, msg);
  }

  private endSession(keepHome = false): void {
    const wasClient = this._role === 'client';
    this._role = 'solo';
    this.bridge?.setRole('solo');
    this._code = null;
    this.id = 0;
    this.sessionName = null;
    this.remotes.clear();
    this.cabinOf.clear();
    this.refreshCabins();
    this.pending.clear();
    this.pendingTiles.clear();
    this.replayTiles.clear();
    this.rolling = false;
    this.heldFull = null;
    this.hostTiles.clear();
    this.sentTiles.clear();
    this.goldPending = [];
    this.hostBeds.clear();
    this.stock.clear();
    this.stopTicker();
    clearTimeout(this.psaveTimer);
    this.psaveTimer = 0;
    this.psaveDirty = false;
    if (this.asleep) this.wakeUp();
    const welcomed = this.welcomed;
    this.welcomed = false;
    this.setStatus('offline');
    this.emitRoster();
    if (wasClient && !keepHome) this.returnHome(welcomed);
  }

  /** Farmhand: the session is over — back to our own farm, exactly as we left it. */
  private returnHome(wasOnFarm: boolean): void {
    const h = this.home;
    this.home = null;
    if (!h || !wasOnFarm) return;
    const g = this.game;
    this.restoring = true;
    try {
      g.saves.restore(h.snap);
      const farm = h.snap.data.farming;
      if (farm) this.sync.applyFull({ save: farm, debris: h.debris });
    } catch (err) {
      console.error('[net] could not restore the home farm', err);
    } finally {
      this.restoring = false;
    }
    g.applySeason(g.calendar.season, true);
    g.applyWeather(g.calendar.weather, true);
    if (h.fromTitle) g.events.emit('ui:open', { name: 'title' });
    else g.events.emit('ui:toast', { text: 'Back on <b>your own farm</b>', kind: 'info' });
  }

  private makeTransport(): Transport {
    this.transport?.close();
    const t = new Transport(this.serverUrl, {
      ctrl: (m) => this.onCtrl(m),
      game: (from, d) => this.onGame(from, d),
      status: (s) => {
        if (s === 'open') this.setStatus(this._role === 'client' && this.welcomed ? 'playing' : this._role === 'host' && this._code ? 'hosting' : 'connected');
        else if (s === 'reconnecting') this.setStatus('reconnecting');
        else if (s === 'connecting') this.setStatus('connecting');
        else if (s === 'closed' && this._role !== 'solo') {
          this.game.events.emit('ui:toast', { text: 'Lost the co-op server — playing <b>solo</b>', kind: 'bad' });
          this.transport = null;
          this.endSession();
        }
      },
    });
    this.transport = t;
    this.startTicker();
    return t;
  }

  private startTicker(): void {
    if (this.ticker) return;
    this.lastTickAt = performance.now();
    this.ticker = window.setInterval(() => this.tick(), TICK_MS);
  }

  private stopTicker(): void {
    clearInterval(this.ticker);
    this.ticker = 0;
  }

  private setStatus(s: string): void {
    this._status = s;
    this.game.events.emit('net:status', { role: this._role, status: s, code: this._code });
  }

  chat(text: string): void {
    const s = text.trim().slice(0, 140);
    if (!s) return;
    this.showChat(this.id || 1, s);
    if (this._role === 'client') this.toHost(['chat', s]);
    else if (this._role === 'host') this.toAll(['chat', this.id, s]);
  }

  emote(id: EmoteId): void {
    if (!EMOTES.includes(id)) return;
    this.showEmote(this.id || 1, id);
    if (this._role === 'client') this.toHost(['emo', id]);
    else if (this._role === 'host') this.toAll(['emo', this.id, id]);
  }

  goToBed(where: 'house' | 'cabin'): void {
    if (this.asleep) return;
    const sl = this.game.services.sleep;
    if (this._role === 'solo') {
      void sl?.goToBed();
      return;
    }
    this.asleep = true;
    this.asleepAt = performance.now();
    this.bedWhere = where;
    const pl = this.game.player;
    pl.controllable = false;
    if (where === 'cabin') pl.root.visible = false;
    this.game.events.emit('net:beds', { ready: [...this.readyIds()], total: 1 + this.remotes.list.size, sleeping: true });
    if (this._role === 'client') {
      this.sendToday();
      this.toHost(['bed', 1]);
    } else {
      this.hostBeds.add(this.id);
      this.checkBeds();
    }
    this.emitRoster();
  }

  cancelBed(): void {
    if (!this.asleep) return;
    this.wakeUp();
    if (this._role === 'client') this.toHost(['bed', 0]);
    else {
      this.hostBeds.delete(this.id);
      this.broadcastBeds();
    }
    this.emitRoster();
  }

  forceSleep(): void {
    if (this._role !== 'host') return;
    this.chatSystem(`<b>${esc(this.myName())}</b> called it a night for everyone`, 'info');
    this.hostBeds.clear();
    this.hostSleep();
  }

  private wakeUp(): void {
    this.asleep = false;
    this.asleepAt = 0;
    const pl = this.game.player;
    pl.controllable = true;
    pl.root.visible = true;
    this.game.events.emit('net:beds', { ready: [...this.readyIds()], total: 1 + this.remotes.list.size, sleeping: false });
  }

  private readyIds(): Set<number> {
    if (this._role === 'host') return this.hostBeds;
    const s = new Set<number>();
    if (this.asleep) s.add(this.id);
    for (const p of this.remotes.list.values()) if (p.ready) s.add(p.id);
    return s;
  }

  // ════════════════════════════════════════════════════════════ messaging

  private toHost(d: unknown[]): void {
    this.transport?.send(this.hostId, d);
  }
  private toAll(d: unknown[]): void {
    this.transport?.send('*', d);
  }
  private to(id: number, d: unknown[]): void {
    this.transport?.send(id, d);
  }
  private toOthers(except: number, d: unknown[]): void {
    for (const p of this.remotes.list.values()) if (p.id !== except && !p.away) this.to(p.id, d);
  }

  private onCtrl(m: Ctrl): void {
    switch (m.t) {
      case 'hosted': {
        this._code = m.code;
        this.token = m.token;
        this.id = m.id;
        this.hostId = m.id;
        this.transport?.flush();
        this.setStatus('hosting');
        this.bridge.setRole('host');
        if (!m.rejoin) {
          this.game.events.emit('ui:toast', { text: `Farm open to co-op · code <b>${m.code}</b>`, kind: 'gold' });
          this.farmDirty = true;
        }
        this.emitRoster();
        return;
      }
      case 'joined': {
        this._code = m.code;
        this.token = m.token;
        this.id = m.id;
        this.hostId = m.hostId;
        if (m.pid) this.sessionPid = m.pid;
        if (m.name && m.name !== this.prof.name) this.sessionName = m.name;
        try {
          sessionStorage.setItem('hearthvale.coop', JSON.stringify({ code: m.code, token: m.token }));
        } catch {
          /* ignore */
        }
        const h = m.peers.find((p) => p.id === m.hostId);
        if (h) this.hostName = h.name;
        this.transport?.setPingTarget(m.hostId);
        // Anything that queued up while we were away goes out first (in order), then hello.
        this.transport?.flush();
        this.setStatus(m.rejoin && this.welcomed ? 'resyncing' : 'joining');
        this.toHost(['hello', { name: this.myName(), look: this.prof.look, fresh: !this.welcomed, rejoin: !!m.rejoin, pid: this.playerId() }]);
        return;
      }
      case 'peer+': {
        if (this._role === 'host') {
          const p = this.remotes.get(m.id);
          if (p) {
            p.away = false;
            this.chatSystem(`<b>${esc(p.name)}</b> is back`, 'good');
          }
        }
        return;
      }
      case 'peer~': {
        const p = this.remotes.get(m.id);
        if (p) {
          p.away = true;
          p.ready = false;
          this.hostBeds.delete(m.id);
          this.chatSystem(`<b>${esc(p.name)}</b> lost connection…`, 'bad');
          if (this._role === 'host') {
            this.broadcastRoster();
            // They might have been the last one awake: the rest of the farm can sleep now.
            this.checkBeds();
          }
          this.emitRoster();
        }
        return;
      }
      case 'peer-': {
        const p = this.remotes.get(m.id);
        if (p) {
          const why = m.reason === 'kicked' ? 'was asked to leave' : m.reason === 'evicted' ? 'gave up their slot' : 'left the farm';
          this.chatSystem(`<b>${esc(p.name)}</b> ${why}`, 'info');
          this.remotes.remove(m.id);
          this.cabinOf.delete(m.id);
          this.hostBeds.delete(m.id);
          this.stock.delete(m.id);
          this.pidOf.delete(m.id);
          delete this.goldAcks[m.id];
          this.refreshCabins();
          if (this._role === 'host') {
            this.broadcastRoster();
            this.checkBeds();
          }
          this.emitRoster();
        }
        return;
      }
      case 'host~':
        this.chatSystem(`Lost contact with <b>${esc(this.hostName)}</b>… waiting`, 'bad');
        this.setStatus('host-away');
        return;
      case 'host+':
        this.chatSystem(`<b>${esc(this.hostName)}</b> is back`, 'good');
        this.setStatus('playing');
        return;
      case 'error':
        this.game.events.emit('net:error', { text: m.text });
        this.game.events.emit('ui:toast', { text: esc(m.text), kind: 'bad' });
        this.transport?.close();
        this.transport = null;
        this.endSession();
        return;
      case 'closed':
        if (this._role !== 'solo') {
          const text = m.reason === 'host-left' ? `${esc(this.hostName)} closed the farm` : m.reason === 'kicked' ? `${esc(this.hostName)} asked you to leave the farm` : 'Co-op session ended';
          this.game.events.emit('ui:toast', { text, kind: m.reason === 'kicked' ? 'bad' : 'info' });
          try {
            sessionStorage.removeItem('hearthvale.coop');
          } catch {
            /* ignore */
          }
          this.transport?.close();
          this.transport = null;
          this.endSession();
        }
        return;
      case 'pong':
        return;
    }
  }

  private onGame(from: number, d: unknown[]): void {
    const kind = d[0];
    if (typeof kind !== 'string') return;
    // Only lobby members may talk to us (the relay routes peer → peer directly).
    const member = from === this.hostId || this.remotes.list.has(from);
    if (kind === 'x') {
      if (member && Array.isArray(d[1])) this.game.events.emit('net:ext', { from, data: d[1] as unknown[] });
      return;
    }
    try {
      if (this._role === 'host') {
        if (!this.bridge.handle(kind, from, d)) this.hostMsg(from, kind, d);
      } else if (this._role === 'client') {
        if (from === this.hostId) {
          if (!this.bridge.handle(kind, from, d)) this.clientMsg(kind, d);
        } else if (kind === 'st' && member) this.peerState(from, d);
      }
    } catch (err) {
      console.error('[net] bad message', kind, err);
    }
  }

  // ════════════════════════════════════════════════════════════ host

  private hostMsg(from: number, kind: string, d: unknown[]): void {
    const g = this.game;
    if (kind === 'hello') {
      const h = d[1] as { name?: string; look?: unknown; fresh?: boolean; pid?: string };
      const look = sanitizeLook(h.look);
      const name = String(h.name ?? `Farmhand ${from}`).slice(0, 24);
      const pid = String(h.pid ?? `id${from}`).slice(0, 64);
      const isNew = !this.remotes.get(from);
      const p = this.remotes.add(from, name, look);
      p.away = false;
      this.pidOf.set(from, pid);
      if (!this.cabinOf.has(from)) this.cabinOf.set(from, this.freeCabin());
      p.cabin = this.cabinOf.get(from)!;
      this.refreshCabins();
      const spawn = p.cabin >= 0 ? cabinFront(p.cabin) : { x: 32, z: 20.5 };
      if (isNew) {
        p.snap(spawn.x, spawn.z, 'farm');
        this.chatSystem(`<b>${esc(name)}</b> joined the farm`, 'good');
      }
      const ps = this.psaves.get(pid) ?? null;
      if (ps) this.setStock(from, ps.data);
      const full = this.sync.fullState();
      this.to(from, [
        'welcome',
        {
          host: this.myName(),
          cal: this.calPayload(),
          gold: g.services.economy?.gold() ?? 0,
          goldAck: this.goldAcks[from] ?? 0,
          cabin: p.cabin,
          spawn,
          full: full ? { ...full, digest: [...this.sync.digest()] } : null,
          psave: ps,
          reps: this.bridge.snapshots(),
        },
      ]);
      this.broadcastRoster();
      this.emitRoster();
      return;
    }
    const p = this.remotes.get(from);
    if (!p) return;
    switch (kind) {
      case 'st': {
        const [, seq, t, map, x, z, yaw, flags, energy, rtt] = d as [string, number, number, string, number, number, number, number, number, number];
        const anim = flags & 7;
        const teleported = (flags & 8) !== 0;
        const X = x / 100;
        const Z = z / 100;
        const now = performance.now();
        // Validate: speed (in the farmhand's own clock, so network jitter never trips it) and
        // blocked terrain on maps we know. Teleports (warps, beds, map changes) are flagged and pass.
        const dt = Math.max(0.02, (t - (p.last.ct || t)) / 1000);
        const dist = Math.hypot(X - p.last.x, Z - p.last.z);
        const sameMap = map === p.last.map;
        const tooFast = sameMap && p.last.ct > 0 && dist > MAX_SPEED * dt + 0.75;
        // (mine floors differ per farmer: only validate against our grid when they're on our floor)
        const mineNet = (g.services as Record<string, unknown>).mineNet as { sameFloor?: (id: number) => boolean } | undefined;
        const otherFloor = map === 'mine' && typeof mineNet?.sameFloor === 'function' && !mineNet.sameFloor(from);
        const grid = otherFloor ? null : map === g.world.current?.id ? g.world.current.grid : map === 'farm' ? this.sync.grid() : null;
        const tx = Math.floor(X);
        const tz = Math.floor(Z);
        const blocked = grid ? !grid.inBounds(tx, tz) || grid.type[grid.idx(tx, tz)] === 5 || grid.hasFlag(tx, tz, 1) : false;
        if ((tooFast || blocked) && sameMap && !teleported && anim !== 4) {
          this.counters.corrections++;
          this.to(from, ['fix', seq, cm(p.last.x), cm(p.last.z)]);
          return;
        }
        p.last = { x: X, z: Z, t: now, ct: t, map, yaw: yaw / 100, anim };
        p.energy = energy;
        p.ping = rtt;
        p.lastSeq = seq;
        p.push(t, X, Z, yaw / 100, anim, map);
        return;
      }
      case 'use': {
        const [, seq, itemId, x, z, facing] = d as [string, number, string, number, number, Facing];
        this.hostApply(p, seq, String(itemId), x, z, FACINGS.includes(facing) ? facing : 'down');
        return;
      }
      case 'act': {
        const [, seq, x, z] = d as [string, number, number, number];
        this.hostApply(p, seq, '@act', x, z, 'down');
        return;
      }
      case 'gold': {
        const [, seq, delta] = d as [string, number, number];
        if (typeof seq !== 'number' || seq <= (this.goldAcks[from] ?? 0)) return; // resend of one we already applied
        const eco = g.services.economy;
        if (!eco) return;
        this.goldAcks[from] = seq;
        this.goldDirty = true;
        const gold = eco.gold();
        if (!Number.isFinite(delta) || delta > MAX_GOLD_GAIN || (delta < 0 && gold + delta < 0)) {
          // Two farmers spent the same coins (or a bogus amount): the host's purse is the truth.
          this.counters.goldDenied++;
          this.to(from, ['gdeny', seq]);
          return;
        }
        eco.add(Math.round(delta));
        return;
      }
      case 'chat': {
        const text = String(d[1] ?? '').slice(0, 140);
        if (!text) return;
        this.showChat(from, text);
        this.toOthers(from, ['chat', from, text]);
        return;
      }
      case 'emo': {
        const e = d[1] as EmoteId;
        if (!EMOTES.includes(e)) return;
        this.showEmote(from, e);
        this.toOthers(from, ['emo', from, e]);
        return;
      }
      case 'day': {
        this.tallies.set(from, d.slice(1, 5).map((v) => Math.max(0, Math.min(9999, Math.round(Number(v) || 0)))));
        return;
      }
      case 'bed': {
        p.ready = d[1] === 1;
        if (p.ready) this.hostBeds.add(from);
        else this.hostBeds.delete(from);
        this.broadcastBeds();
        this.checkBeds();
        this.broadcastRoster();
        this.emitRoster();
        return;
      }
      case 'look': {
        const look = sanitizeLook(d[1]);
        p.setLook(look);
        if (typeof d[2] === 'string') p.setName(d[2].slice(0, 24), look);
        this.refreshCabins();
        this.broadcastRoster();
        this.emitRoster();
        return;
      }
      case 'ping':
        this.to(from, ['pong', d[1]]);
        return;
      case 'psave': {
        const [, seq, data, counts] = d as [string, number, Record<string, unknown>, Record<string, number> | undefined];
        const pid = this.pidOf.get(from);
        if (!pid || typeof seq !== 'number' || !data || typeof data !== 'object') return;
        const cur = this.psaves.get(pid);
        if (cur && cur.seq >= seq) return;
        this.psaves.set(pid, { seq, data });
        this.setStock(from, data, counts);
        return;
      }
      case 'need': {
        const now = performance.now();
        if (now - this.lastFullAt < 1500) return;
        this.lastFullAt = now;
        this.sendFull(from);
        return;
      }
    }
  }

  /** Host mirror of a farmhand's consumables (seeds, fertilizer, sprinklers). */
  private setStock(id: number, data: Record<string, unknown>, counts?: Record<string, number>): void {
    const m = new Map<string, number>();
    if (counts && typeof counts === 'object') {
      for (const [k, v] of Object.entries(counts)) if (typeof v === 'number') m.set(k, v);
    } else {
      const slots = (data.inventory as { slots?: ({ id: string; qty: number } | null)[] } | undefined)?.slots ?? [];
      for (const s of slots) if (s && isConsumable(s.id)) m.set(s.id, (m.get(s.id) ?? 0) + s.qty);
    }
    this.stock.set(id, m);
  }

  /** Validate + apply a farmhand's tool / harvest intent at their swing's impact frame. */
  private hostApply(p: RemotePlayer, seq: number, itemId: string, x: number, z: number, facing: Facing): void {
    const grid = this.sync.grid();
    const now = performance.now();
    const pos = p.last;
    const reach = Math.hypot(pos.x - (x + 0.5), pos.z - (z + 0.5));
    const stock = this.stock.get(p.id);
    const owns = !isConsumable(itemId) || !stock || (stock.get(itemId) ?? 0) > 0;
    const ok = !!grid && pos.map === 'farm' && reach <= MAX_REACH && grid.inBounds(x, z) && (itemId === '@act' || isFarmItem(itemId)) && owns && now - p.lastUse > 120;
    const tiles = this.affected(itemId, x, z, facing);
    if (!ok) {
      this.to(p.id, ['ack', seq, 0, this.sync.tiles(tiles)]);
      return;
    }
    p.lastUse = now;
    const act = actionFor(itemId);
    p.farmer.setFacingYaw(yawOf(facing));
    p.farmer.act(act.kind, act.tool);
    this.toOthers(p.id, ['did', p.id, itemId, x, z, facing]);
    this.later(IMPACT[act.kind] * 1000, () => {
      const give = (id: string, qty: number, quality: number): void => this.to(p.id, ['give', id, qty, quality]);
      const changed = itemId === '@act' ? this.sync.applyHarvest(x, z, give) : this.sync.applyUse(itemId, x, z, facing, give);
      if (changed && stock && isConsumable(itemId)) stock.set(itemId, Math.max(0, (stock.get(itemId) ?? 0) - 1));
      this.farmDirty = true;
      this.to(p.id, ['ack', seq, changed ? 1 : 2, this.sync.tiles(tiles)]);
    });
  }

  private affected(itemId: string, x: number, z: number, facing: Facing): number[] {
    const g = this.sync.grid();
    if (!g) return [];
    const out = [[x, z]];
    if (itemId === 'scythe') {
      const dx = facing === 'left' ? -1 : facing === 'right' ? 1 : 0;
      const dz = facing === 'up' ? -1 : facing === 'down' ? 1 : 0;
      out.push([x - dz, z + dx], [x + dz, z - dx]);
    }
    return out.filter(([a, b]) => g.inBounds(a!, b!)).map(([a, b]) => g.idx(a!, b!));
  }

  private freeCabin(): number {
    const used = new Set(this.cabinOf.values());
    for (let i = 0; i < CABIN_SITES.length; i++) if (!used.has(i)) return i;
    return -1;
  }

  private calPayload(): unknown[] {
    const c = this.game.calendar;
    return [c.day, SEASONS.indexOf(c.season), c.year, Math.round(c.hour * 1000) / 1000, WEATHERS.indexOf(c.weather)];
  }

  private rosterPayload(): unknown[] {
    const me = [this.id, this.myName(), this.prof.look, this.hostBeds.has(this.id) ? 1 : 0, 0, -1, 0];
    const rest = [...this.remotes.list.values()].map((p) => [p.id, p.name, p.look, p.ready ? 1 : 0, Math.round(p.ping), p.cabin, p.away ? 1 : 0]);
    return [me, ...rest];
  }

  private broadcastRoster(): void {
    if (this._role !== 'host') return;
    this.toAll(['roster', this.rosterPayload()]);
  }

  private broadcastBeds(): void {
    this.toAll(['beds', [...this.hostBeds]]);
    this.game.events.emit('net:beds', { ready: [...this.hostBeds], total: 1 + this.remotes.list.size, sleeping: this.asleep });
  }

  private checkBeds(): void {
    if (this._role !== 'host') return;
    this.broadcastBeds();
    if (!this.hostBeds.size) return;
    const everyone = [this.id, ...[...this.remotes.list.values()].filter((p) => !p.away).map((p) => p.id)];
    if (!everyone.every((i) => this.hostBeds.has(i))) return;
    this.hostBeds.clear();
    this.hostSleep();
  }

  /** Host: end the day for everyone, handing out the day's "Farm today" tally with the order. */
  private hostSleep(): void {
    const rows: number[][] = [[this.id, ...this.today]];
    for (const p of this.remotes.list.values()) if (!p.away) rows.push([p.id, ...(this.tallies.get(p.id) ?? [0, 0, 0, 0])]);
    this.toAll(['sleep', rows]);
    this.setTally(rows);
    this.sleepNow();
  }

  private setTally(rows: unknown): void {
    if (!Array.isArray(rows)) return;
    const out: DayTally[] = [];
    for (const r of rows as unknown[]) {
      if (!Array.isArray(r)) continue;
      const id = Number(r[0]);
      const n = r.slice(1, 5).map((v) => Math.max(0, Math.min(9999, Math.round(Number(v) || 0))));
      const isMe = id === this.id;
      const p = this.remotes.get(id);
      if (!isMe && !p) continue;
      out.push({ id, name: isMe ? this.myName() : p!.name, look: isMe ? this.prof.look : p!.look, isMe, n });
    }
    this.lastTally = out.length > 1 ? out : null;
  }

  /** Farmhand: report today's work to the host (throttled; also right before bed). */
  private sendToday(): void {
    this.todayDirty = false;
    this.todaySentAt = performance.now();
    this.toHost(['day', ...this.today]);
  }

  private sendFull(to: number | '*'): void {
    const full = this.sync.fullState();
    if (!full) return;
    const msg = ['full', { ...full, digest: [...this.sync.digest()] }];
    if (to === '*') this.toAll(msg);
    else this.to(to, msg);
  }

  /** Host: periodic sends (interval ticker). */
  private hostTick(ms: number): void {
    const g = this.game;
    const others = this.remotes.list.size > 0;
    if (others && this.frameNo !== this.sentFrame) {
      this.sentFrame = this.frameNo;
      const pl = g.player;
      const row = [this.id, g.world.current?.id ?? '', cm(pl.position.x), cm(pl.position.z), Math.round(pl.rig.body.rotation.y * 100), this.localAnim()];
      this.toAll(['s', this.frameAt, [row]]);
    }
    if (this.goldDirty) {
      this.goldDirty = false;
      this.toAll(['gold', g.services.economy?.gold() ?? 0, this.goldAcks]);
    }
    this.tFarm += ms;
    if (this.tFarm >= FARM_MS) {
      this.tFarm = 0;
      this.tDrift += FARM_MS;
      if (this.farmDirty || this.tDrift >= 2000) {
        this.tDrift = 0;
        this.farmDirty = false;
        const dg = this.sync.digest();
        const changes: [number, string][] = [];
        for (const [i, s] of dg) if (this.sentTiles.get(i) !== s) changes.push([i, s]);
        for (const i of this.sentTiles.keys()) if (!dg.has(i)) changes.push([i, '']);
        this.sentTiles = dg;
        if (changes.length && others) this.toAll(['farm', changes]);
      }
    }
    this.tCal += ms;
    if (this.tCal >= CAL_MS) {
      this.tCal = 0;
      if (others) this.toAll(['cal', ...this.calPayload()]);
      this.broadcastRoster();
    }
  }

  // ════════════════════════════════════════════════════════════ farmhand

  /** Another farmhand's own state sample (sent to everyone; stamped with *their* clock). */
  private peerState(from: number, d: unknown[]): void {
    const [, , t, map, x, z, yaw, flags] = d as [string, number, number, string, number, number, number, number];
    const p = this.remotes.get(from);
    if (!p || typeof t !== 'number') return;
    p.push(t, x / 100, z / 100, yaw / 100, flags & 7, map);
  }

  private clientMsg(kind: string, d: unknown[]): void {
    const g = this.game;
    switch (kind) {
      case 'welcome': {
        const w = d[1] as Welcome;
        this.hostName = w.host;
        this.bridge.setRole('client');
        this.bridge.applySnapshots(w.reps);
        const first = !this.welcomed;
        this.welcomed = true;
        this.cabinOf.set(this.id, w.cabin);
        void this.enterWorld(first, w);
        return;
      }
      case 's': {
        const [, t, rows] = d as [string, number, [number, string, number, number, number, number][]];
        for (const r of rows) {
          if (r[0] === this.id) continue;
          const p = this.remotes.get(r[0]);
          p?.push(t, r[2] / 100, r[3] / 100, r[4] / 100, r[5], r[1]);
        }
        return;
      }
      case 'roster': {
        const rows = d[1] as [number, string, unknown, number, number, number, number][];
        const seen = new Set<number>();
        for (const [id, name, look, ready, ping, cabin, away] of rows) {
          if (id === this.id) {
            this.cabinOf.set(id, cabin);
            continue;
          }
          seen.add(id);
          const lk = sanitizeLook(look);
          const fresh = !this.remotes.get(id);
          const p = this.remotes.add(id, name, lk);
          if (fresh && this.welcomed && id !== this.hostId) this.chatSystem(`<b>${esc(name)}</b> joined the farm`, 'good');
          if (JSON.stringify(p.look) !== JSON.stringify(lk)) p.setLook(lk);
          p.isHost = id === this.hostId;
          p.ready = ready === 1;
          p.ping = ping;
          p.cabin = cabin;
          p.away = away === 1;
          this.cabinOf.set(id, cabin);
        }
        for (const id of [...this.remotes.list.keys()]) if (!seen.has(id)) this.remotes.remove(id);
        this.refreshCabins();
        this.emitRoster();
        return;
      }
      case 'did': {
        const [, id, itemId, x, z, facing] = d as [string, number, string, number, number, Facing];
        const p = this.remotes.get(id);
        const act = actionFor(itemId);
        if (p) {
          p.farmer.setFacingYaw(yawOf(facing));
          p.farmer.act(act.kind, act.tool);
        }
        const tiles = this._role === 'client' ? this.affected(itemId, x, z, facing) : [];
        for (const i of tiles) this.replayTiles.set(i, (this.replayTiles.get(i) ?? 0) + 1);
        this.later(IMPACT[act.kind] * 1000, () => {
          if (itemId === '@act') this.sync.applyHarvest(x, z);
          else this.sync.applyUse(itemId, x, z, facing);
          // Now settle those tiles on the host's word (normally a no-op: the replay matched it).
          for (const i of tiles) {
            const n = (this.replayTiles.get(i) ?? 1) - 1;
            if (n > 0) {
              this.replayTiles.set(i, n);
              continue;
            }
            this.replayTiles.delete(i);
            if (!this.pendingTiles.has(i) && this.hostTiles.has(i)) this.reconcile(i, this.hostTiles.get(i)!);
            else if (!this.pendingTiles.has(i)) this.reconcile(i, '');
          }
        });
        return;
      }
      case 'ack': {
        const [, seq, ok, tiles] = d as [string, number, number, [number, string][]];
        const pd = this.pending.get(seq);
        this.pending.delete(seq);
        // Our predicted sow / fertilize didn't happen on the host (someone beat us to the tile, or it
        // was refused): give the seed back.
        if (pd?.spent && ok !== 1) {
          this.counters.refunds++;
          this.giveOk = true;
          g.events.emit('item:give', { itemId: pd.spent, qty: 1 });
          this.giveOk = false;
        }
        for (const [i, s] of tiles) {
          this.hostTiles.set(i, s);
          if ((this.pendingTiles.get(i) ?? 0) <= seq) {
            this.pendingTiles.delete(i);
            this.reconcile(i, s);
          }
        }
        return;
      }
      case 'give': {
        const [, itemId, qty, quality] = d as [string, string, number, number];
        this.giveOk = true;
        g.events.emit('item:give', { itemId, qty, quality: quality || undefined });
        this.giveOk = false;
        return;
      }
      case 'farm': {
        for (const [i, s] of d[1] as [number, string][]) {
          if (s) this.hostTiles.set(i, s);
          else this.hostTiles.delete(i);
          if (!this.pendingTiles.has(i) && !this.replayTiles.has(i) && !this.rolling) this.reconcile(i, s);
        }
        return;
      }
      case 'full': {
        if (this.rolling && performance.now() - this.rollingAt < 20000) this.heldFull = d[1] as FullState;
        else this.applyFull(d[1] as FullState);
        return;
      }
      case 'cal':
        this.applyCal(d.slice(1));
        return;
      case 'gold': {
        const [, total, acks] = d as [string, number, Record<string, number>];
        this.settleGold(total, acks?.[this.id] ?? 0);
        return;
      }
      case 'gdeny': {
        const seq = Number(d[1]);
        const i = this.goldPending.findIndex((x) => x.seq === seq);
        if (i < 0) return;
        const [gp] = this.goldPending.splice(i, 1);
        this.counters.goldDenied++;
        // Put back what that purchase brought in (the purse never paid for it).
        const inv = g.services.inventory;
        let back = 0;
        if (gp?.items && inv) {
          for (const [id, n] of gp.items) {
            const take = Math.min(n, inv.count(id));
            if (take > 0 && inv.remove(id, take)) back += take;
          }
        }
        g.events.emit('ui:toast', { text: back ? 'The shared purse came up short — <b>purchase returned</b>' : 'The shared purse came up short', kind: 'bad' });
        const eco = g.services.economy;
        if (eco) this.setGold(eco.gold() - (gp?.delta ?? 0));
        return;
      }
      case 'fix': {
        const [, seq, x, z] = d as [string, number, number, number];
        const h = this.history.find((e) => e.seq === seq);
        const pos = g.player.position;
        if (h) {
          this.correction.x += x / 100 - h.x;
          this.correction.z += z / 100 - h.z;
        } else {
          this.correction.x += x / 100 - pos.x;
          this.correction.z += z / 100 - pos.z;
        }
        this.counters.corrections++;
        return;
      }
      case 'chat': {
        const [, id, text] = d as [string, number, string];
        this.showChat(id, String(text).slice(0, 140));
        return;
      }
      case 'emo': {
        const [, id, e] = d as [string, number, EmoteId];
        if (EMOTES.includes(e)) this.showEmote(id, e);
        return;
      }
      case 'beds': {
        const ids = new Set(d[1] as number[]);
        for (const p of this.remotes.list.values()) p.ready = ids.has(p.id);
        g.events.emit('net:beds', { ready: [...ids], total: 1 + this.remotes.list.size, sleeping: this.asleep });
        this.emitRoster();
        return;
      }
      case 'sleep':
        this.setTally(d[1]);
        this.sleepNow();
        return;
      case 'pong': {
        const t = Number(d[1]);
        const r = performance.now() - t;
        this.appRtts.push(r);
        if (this.appRtts.length > 7) this.appRtts.shift();
        this.appRtt = [...this.appRtts].sort((x, y) => x - y)[this.appRtts.length >> 1]!;
        return;
      }
    }
  }

  private setGold(n: number): void {
    const eco = this.game.services.economy;
    if (!eco || eco.gold() === n) return;
    this.applyingGold = true;
    eco.set(n);
    this.applyingGold = false;
  }

  /** Host total + our purse changes it hasn't seen yet. */
  private settleGold(total: number, acked: number): void {
    this.goldPending = this.goldPending.filter((x) => x.seq > acked);
    this.setGold(total + this.goldPending.reduce((s, x) => s + x.delta, 0));
  }

  private async enterWorld(first: boolean, w: Welcome): Promise<void> {
    const g = this.game;
    if (first) {
      g.events.emit('ui:open', { name: 'none' });
      if (g.world.current?.id !== 'farm') await g.teleport('farm', w.spawn.x, w.spawn.z);
      else g.player.teleport(w.spawn.x, w.spawn.z);
      g.player.setFacing('down');
      g.setPaused(false);
      g.input.enabled = true;
      const rig = g.rc.rig;
      rig.yaw = 0;
      rig.pitch = 50;
      rig.distance = 24;
      rig.lookOffset.set(0, 0, 0);
      g.followPlayer(true);
      // Personal state on this farm: the newest of the host's copy and ours (a reload never rolls
      // the backpack back); a first visit starts from a fresh farmhand kit.
      const local = this.loadLocalPsave();
      const hostPs = w.psave;
      const best = local && (!hostPs || local.seq > hostPs.seq) ? local : hostPs;
      this.restorePersonal(best ? best.data : this.starter);
      this.pseq = Math.max(this.pseq, best?.seq ?? 0);
      if (best !== hostPs || !best) this.psaveDirty = true;
    } else {
      // Rejoin in the same page: our in-memory state is the newest — tell the host, and resend purse
      // changes it may never have seen (it drops the ones it already applied by seq).
      this.psaveDirty = true;
      for (const gp of this.goldPending) if (gp.seq > (w.goldAck ?? 0)) this.toHost(['gold', gp.seq, gp.delta]);
    }
    this.applyCal(w.cal, true);
    this.settleGold(w.gold, w.goldAck ?? 0);
    if (w.full) this.applyFull(w.full);
    this.refreshCabins();
    this.setStatus('playing');
    this.flushPersonal();
    if (first) {
      g.hud.banner(`${this.hostName}'s Farm`, 'Co-op · farm together, sleep together');
      this.chatSystem(`You joined <b>${esc(this.hostName)}</b>'s farm`, 'good');
    }
  }

  private applyCal(c: unknown[], instant = false): void {
    const g = this.game;
    const cal = g.calendar;
    const [day, si, year, hour, wi] = c as number[];
    const season = SEASONS[si!] as Season | undefined;
    const weather = WEATHERS[wi!] as Weather | undefined;
    if (season && season !== cal.season) {
      cal.setSeason(season);
      g.applySeason(season, instant);
    }
    if (weather && weather !== cal.weather) {
      cal.setWeather(weather);
      g.applyWeather(weather, instant);
    }
    if (typeof day === 'number') cal.day = day;
    if (typeof year === 'number') cal.year = year;
    if (typeof hour === 'number') {
      const diff = hour - cal.hour;
      if (Math.abs(diff) > 0.1 || instant) cal.setHour(hour);
      else cal.hour += diff * 0.5;
    }
  }

  private applyFull(f: FullState): void {
    this.counters.fullSyncs++;
    this.sync.applyFull(f);
    this.hostTiles = new Map(f.digest);
    this.pendingTiles.clear();
    this.replayTiles.clear();
    this.pending.clear();
  }

  private driftLog: string[] = [];

  private reconcile(i: number, s: string, have?: string, drift = false): void {
    const ok = this.sync.reconcileTile(i, s, have);
    if (this.sync.lastChanged) {
      if (drift) {
        this.counters.drift++;
        this.driftLog.push(`${i}:${this.sync.lastHave}→${s}`);
        if (this.driftLog.length > 24) this.driftLog.shift();
      } else this.counters.reconciles++;
    }
    if (!ok) this.requestFull();
  }

  private requestFull(): void {
    const now = performance.now();
    if (now - this.needFullAt < 4000) return;
    this.needFullAt = now;
    this.counters.needs++;
    this.toHost(['need']);
  }

  /** Farmhand: compare our farm to the host's mirror and fix drift (never touching predicted tiles). */
  private driftCheck(): void {
    if (!this.welcomed || this.rolling) return;
    const local = this.sync.digest();
    let n = 0;
    const check = (i: number): void => {
      if (n > 60 || this.pendingTiles.has(i) || this.replayTiles.has(i)) return;
      const want = this.hostTiles.get(i) ?? '';
      const have = local.get(i) ?? '';
      if (have !== want) {
        n++;
        this.reconcile(i, want, have, true);
      }
    };
    for (const i of this.hostTiles.keys()) check(i);
    for (const i of local.keys()) if (!this.hostTiles.has(i)) check(i);
  }

  /** Farmhand: periodic sends (interval ticker). */
  private clientTick(ms: number): void {
    const g = this.game;
    if (!this.welcomed) return;
    if (this.frameNo !== this.sentFrame) {
      this.sentFrame = this.frameNo;
      const pl = g.player;
      const seq = ++this.stSeq;
      const map = g.world.current?.id ?? '';
      let anim = this.localAnim();
      // Big jumps (warps, beds) are flagged so the host doesn't treat them as speeding.
      if (this.teleported || map !== this.lastPos.map || Math.hypot(pl.position.x - this.lastPos.x, pl.position.z - this.lastPos.z) > 1.5) anim |= 8;
      this.teleported = false;
      this.lastPos = { x: pl.position.x, z: pl.position.z, map, t: this.frameAt };
      this.history.push({ seq, x: pl.position.x, z: pl.position.z });
      if (this.history.length > 60) this.history.shift();
      // To everyone: the host validates it, the other farmhands interpolate it on our clock.
      this.toAll(['st', seq, this.frameAt, map, cm(pl.position.x), cm(pl.position.z), Math.round(pl.rig.body.rotation.y * 100), anim, Math.round(g.services.energy?.value() ?? 0), Math.round(this.rtt())]);
    }
    this.tPing += ms;
    if (this.tPing >= PING_MS) {
      this.tPing = 0;
      this.toHost(['ping', performance.now()]);
    }
    if (this.todayDirty && this.frameAt - this.todaySentAt > 2000) this.sendToday();
    this.tDrift += ms;
    if (this.tDrift >= 2500) {
      this.tDrift = 0;
      this.driftCheck();
      // Stale predictions (lost ack): give the tile back to the host's state.
      const now = performance.now();
      for (const [seq, pd] of this.pending) {
        if (now - pd.t < 4000) continue;
        this.pending.delete(seq);
        for (const i of pd.tiles) if (this.pendingTiles.get(i) === seq) this.pendingTiles.delete(i);
      }
    }
    this.tPsave += ms;
    if (this.tPsave >= PSAVE_MS) {
      this.tPsave = 0;
      this.psaveDirty = true;
      this.flushPersonal();
    }
  }

  private tick(): void {
    const now = performance.now();
    const ms = Math.min(1000, now - this.lastTickAt);
    this.lastTickAt = now;
    if (this._role === 'host') this.hostTick(ms);
    else if (this._role === 'client') this.clientTick(ms);
  }

  // ── personal saves (farmhand) ──

  private personalData(): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const k of PERSONAL_KEYS) {
      const s = this.game.systems.find((x) => x.name === k);
      if (!s?.save) continue;
      try {
        data[k] = JSON.parse(JSON.stringify(s.save()));
      } catch {
        /* skip */
      }
    }
    return data;
  }

  private consumableCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of this.game.services.inventory?.slots ?? []) if (s && isConsumable(s.id)) out[s.id] = (out[s.id] ?? 0) + s.qty;
    return out;
  }

  /** The backpack (or energy, friendships…) changed: persist locally now, tell the host soon. */
  private markPersonal(): void {
    if (this._role !== 'client' || !this.welcomed || this.sync.inRemote) return;
    this.psaveDirty = true;
    if (!this.localPsaveTimer) this.localPsaveTimer = window.setTimeout(() => this.persistLocalPsave(), 0);
    if (!this.psaveTimer) this.psaveTimer = window.setTimeout(() => this.flushPersonal(), 250);
  }

  private flushPersonal(): void {
    clearTimeout(this.psaveTimer);
    this.psaveTimer = 0;
    if (!this.psaveDirty || this._role !== 'client' || !this.welcomed) return;
    this.sendPersonal();
  }

  private nextPseq(): number {
    this.pseq = Math.max(this.pseq + 1, Date.now());
    return this.pseq;
  }

  private sendPersonal(bias?: string): void {
    if (this._role !== 'client' || !this.welcomed) return;
    this.psaveDirty = false;
    const counts = this.consumableCounts();
    // Sent just before the 'use' that spent `bias`: the host checks against the pre-use count.
    if (bias) counts[bias] = (counts[bias] ?? 0) + 1;
    this.toHost(['psave', this.nextPseq(), this.personalData(), counts]);
    this.persistLocalPsave();
  }

  private localKey(): string | null {
    return this._code ? `hearthvale.coop.psave.${this._code}.${this.playerId()}` : null;
  }

  private persistLocalPsave(): void {
    clearTimeout(this.localPsaveTimer);
    this.localPsaveTimer = 0;
    if (this._role !== 'client' || !this.welcomed) return;
    const k = this.localKey();
    if (!k) return;
    try {
      localStorage.setItem(k, JSON.stringify({ seq: this.nextPseq(), data: this.personalData() }));
    } catch {
      /* storage full / blocked */
    }
  }

  private loadLocalPsave(): PSave | null {
    const k = this.localKey();
    if (!k) return null;
    try {
      const v = JSON.parse(localStorage.getItem(k) ?? 'null') as PSave | null;
      return v && typeof v.seq === 'number' && v.data && typeof v.data === 'object' ? v : null;
    } catch {
      return null;
    }
  }

  private restorePersonal(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    this.restoring = true;
    try {
      this.game.saves.restore({ version: 1, savedAt: '', data: data as Record<string, unknown> });
    } finally {
      this.restoring = false;
    }
  }

  // ════════════════════════════════════════════════════════════ local events

  private intercept<K extends EventName>(name: K, payload: GameEvents[K]): boolean {
    if (this._role === 'solo' || this.sync.inRemote) return false;
    const g = this.game;
    if (name === 'item:give' && this._role === 'client' && !this.giveOk && performance.now() < this.predictUntil) {
      // Loot from our own predicted farm action: the host's ['give'] is the real one.
      return FARM_LOOT.has((payload as GameEvents['item:give']).itemId);
    }
    if (name === 'player:interact') {
      const { x, z } = payload as GameEvents['player:interact'];
      const map = g.world.current;
      if (!map) return false;
      // Bed (farmhouse) → co-op readiness instead of ending the day alone.
      if (map.id === 'house') {
        const bed = (map as unknown as { bed?: { x0: number; z0: number; x1: number; z1: number } }).bed;
        if (bed && x >= Math.floor(bed.x0) && x <= Math.floor(bed.x1) && z >= Math.floor(bed.z0) && z <= Math.floor(bed.z1)) {
          if (g.services.sleep?.canSleep()) this.goToBed('house');
          else g.events.emit('ui:toast', { text: 'Not sleepy yet… the quilt can wait until <b>6 pm</b>', kind: 'info' });
          return true;
        }
      }
      if (map.id === 'farm') {
        // Our cabin door.
        const slot = this.mySlot();
        if (slot >= 0) {
          const door = cabinDoor(slot);
          if (x === door.x && (z === door.z || z === door.z + 1)) {
            if (g.services.sleep?.canSleep()) this.goToBed('cabin');
            else g.events.emit('ui:toast', { text: 'Your cabin — bed down here after <b>6 pm</b>', kind: 'info' });
            return true;
          }
        }
        // Harvest by hand: predicted locally, sent to the host (host: tell the others).
        const crop = this.sync.farming()?.cropAt(x, z);
        if (crop?.ripe && !crop.dead) {
          if (this._role === 'client') {
            this.predict('@act', x, z, g.player.facing, null);
            this.toHost(['act', this.seq, x, z]);
          } else this.toAll(['did', this.id, '@act', x, z, g.player.facing]);
        }
      }
    }
    return false;
  }

  private predict(itemId: string, x: number, z: number, facing: Facing, spent: string | null): void {
    const seq = ++this.seq;
    const tiles = this.affected(itemId, x, z, facing);
    this.pending.set(seq, { seq, tiles, t: performance.now(), spent });
    for (const i of tiles) this.pendingTiles.set(i, seq);
    this.predictUntil = performance.now() + 1500;
  }

  private onLocalUse(e: GameEvents['item:use']): void {
    const planted = this.planted;
    this.planted = -1;
    if (this._role === 'solo' || this.sync.inRemote || e.slot < 0) return;
    if (this.game.world.current?.id !== 'farm' || !isFarmItem(e.itemId)) return;
    const f = this.game.player.facing;
    if (this._role === 'client') {
      // Did our local prediction actually use the seed / fertilizer up? (refunded if the host no-ops)
      const g = this.sync.grid();
      const spent = isConsumable(e.itemId) && g && g.inBounds(e.x, e.z) && planted === g.idx(e.x, e.z) ? e.itemId : null;
      if (isConsumable(e.itemId) && (this.psaveDirty || spent)) {
        clearTimeout(this.psaveTimer);
        this.psaveTimer = 0;
        this.sendPersonal(spent ?? undefined);
      }
      this.predict(e.itemId, e.x, e.z, f, spent);
      this.toHost(['use', this.seq, e.itemId, e.x, e.z, f]);
    } else {
      this.toAll(['did', this.id, e.itemId, e.x, e.z, f]);
      this.farmDirty = true;
    }
  }

  private onGold(delta: number): void {
    if (this.applyingGold || this.restoring || !delta) return;
    if (this._role === 'client' && this.welcomed) {
      const seq = ++this.seq;
      const gp: GoldPending = { seq, delta, items: null };
      this.goldPending.push(gp);
      this.toHost(['gold', seq, delta]);
      if (delta < 0) {
        // A purchase: note what lands in the backpack along with it (shops add right after spending).
        const inv = this.game.services.inventory;
        const before = new Map<string, number>();
        for (const s of inv?.slots ?? []) if (s) before.set(s.id, (before.get(s.id) ?? 0) + s.qty);
        setTimeout(() => {
          const got = new Map<string, number>();
          const now = new Map<string, number>();
          for (const s of inv?.slots ?? []) if (s) now.set(s.id, (now.get(s.id) ?? 0) + s.qty);
          for (const [id, n] of now) if (n > (before.get(id) ?? 0)) got.set(id, n - (before.get(id) ?? 0));
          if (got.size) gp.items = got;
        }, 0);
      }
    } else if (this._role === 'host') this.goldDirty = true;
  }

  private onDayStart(): void {
    this.today.fill(0);
    this.todayDirty = false;
    this.tallies.clear();
    if (this._role === 'solo') return;
    for (const p of this.remotes.list.values()) p.ready = false;
    this.hostBeds.clear();
    if (this._role === 'host') {
      this.later(400, () => this.sendFull('*'));
      this.farmDirty = true;
    } else
      this.later(3000, () => {
        this.psaveDirty = true;
        this.flushPersonal();
      });
    this.emitRoster();
  }

  /** Everyone is in bed: end the day here (host and farmhands alike). */
  private sleepNow(): void {
    const g = this.game;
    const sl = g.services.sleep;
    const where = this.bedWhere;
    this.asleep = false;
    this.asleepAt = 0;
    g.player.root.visible = true;
    g.events.emit('net:beds', { ready: [], total: 1 + this.remotes.list.size, sleeping: false });
    if (this._role === 'client') {
      this.rolling = true;
      this.rollingAt = performance.now();
      this.heldFull = null;
    }
    // Our day has rolled: now the host's morning (if it already came) is the truth.
    const rolled = (): void => {
      if (!this.rolling) return;
      this.rolling = false;
      const f = this.heldFull;
      this.heldFull = null;
      if (f) this.applyFull(f);
    };
    const endDay = (): void => {
      // Crops only grow while the farming system sees the farm: end the day with it in view.
      const r = this.sync.withFarm(() => sl?.sleep());
      if (r === null) sl?.sleep();
      rolled();
    };
    if (where === 'house' && g.world.current?.id === 'house' && sl) {
      const orig = sl.sleep.bind(sl);
      sl.sleep = () => {
        sl.sleep = orig;
        const r = this.sync.withFarm(() => orig());
        if (r === null) orig();
        rolled();
      };
      void sl.goToBed().finally(() => {
        sl.sleep = orig;
        rolled();
      });
      return;
    }
    // Cabin (or anywhere else): fade, end the day, wake on the cabin porch.
    g.player.controllable = false;
    void g.hud.fade(true).then(async () => {
      endDay();
      const slot = this.mySlot();
      const front = slot >= 0 ? cabinFront(slot) : { x: 32, z: 20.5 };
      if (g.world.current?.id !== 'farm') await g.teleport('farm', front.x, front.z);
      else g.player.teleport(front.x, front.z);
      g.player.setFacing('down');
      g.followPlayer(true);
      await new Promise((r) => setTimeout(r, 250));
      await g.hud.fade(false);
      g.player.controllable = true;
      g.events.emit('sleep:wake', { passedOut: false });
    });
  }

  // ════════════════════════════════════════════════════════════ shared helpers

  private localAnim(): number {
    const g = this.game;
    if (this.asleep && this.bedWhere === 'cabin') return 4;
    const st = g.services.fishing?.state();
    if (st && st !== 'idle') return 3;
    const pos = g.player.position;
    const lp = this.lastPos;
    const dt = Math.max(16, this.frameAt - lp.t) / 1000;
    const sp = Math.hypot(pos.x - lp.x, pos.z - lp.z) / dt;
    if (this._role === 'host') this.lastPos = { x: pos.x, z: pos.z, map: g.world.current?.id ?? '', t: this.frameAt };
    return sp > 5.2 ? 2 : sp > 0.4 ? 1 : 0;
  }

  /** Speech bubble over the farmer + a line in the chat log (`log: false` = bubble only, demos). */
  showChat(id: number, text: string, log = true): void {
    const isMe = id === (this.id || 1);
    const p = this.remotes.get(id);
    const name = isMe ? this.myName() : (p?.name ?? '?');
    const look = isMe ? this.prof.look : (p?.look ?? DEFAULT_LOOK);
    if (isMe) this.remotes.sayLocal(text);
    else p?.chat(text);
    if (log) this.game.events.emit('net:chat', { id, name, text, color: hex(look.scarf) });
  }

  private chatSystem(html: string, kind: 'good' | 'bad' | 'info'): void {
    this.game.events.emit('net:chat', { id: 0, name: '', text: html, color: '#c8a060', system: true });
    this.game.events.emit('ui:toast', { text: html, kind });
  }

  showEmote(id: number, e: EmoteId): void {
    if (id === (this.id || 1)) {
      if (!this.myBubble) {
        this.myBubble = new EmoteBubble(this.game.player.root);
      }
      this.myBubble.show(e);
    } else this.remotes.get(id)?.emote(e);
    this.game.events.emit('net:emote', { id, emote: e });
  }

  emitRoster(): void {
    this.game.events.emit('net:roster', { players: this.players() });
  }

  /** Cabins for every farmhand slot in use (plus demo bots). */
  refreshCabins(extra?: Map<number, number>): void {
    const slots = new Map<number, number>();
    for (const [id, slot] of this.cabinOf) {
      if (slot < 0) continue;
      const look = id === this.id ? this.prof.look : this.remotes.get(id)?.look;
      slots.set(slot, (look ?? PRESET_LOOKS[slot % PRESET_LOOKS.length]!).scarf);
    }
    if (extra) for (const [k, v] of extra) slots.set(k, v);
    const farm = this.sync.farmMap();
    for (const s of slots.keys()) {
      const site = CABIN_SITES[s];
      if (site) this.sync.claimFootprint(site.x0, site.z0, site.x0 + 2, site.z0 + 2);
    }
    this.cabins.set(farm, slots);
  }

  later(ms: number, fn: () => void): void {
    this.timers.push({ at: performance.now() + ms, fn });
  }

  private autoStart(): void {
    const q = new URLSearchParams(location.search);
    const name = q.get('name');
    if (name) this.setProfile({ name, look: q.get('look') === 'random' ? PRESET_LOOKS[Math.floor(Math.random() * 3)]! : this.prof.look });
    const preset = q.get('preset');
    if (preset !== null && PRESET_LOOKS[Number(preset)]) this.setProfile({ name: this.prof.name, look: PRESET_LOOKS[Number(preset)]! });
    if (q.get('coop') === 'host') void this.host().catch((e) => console.warn('[net] host failed', e));
    const code = q.get('join');
    if (code) void this.join(code).catch((e) => console.warn('[net] join failed', e));
  }

  // ════════════════════════════════════════════════════════════ frame

  update(dt: number, game: Game): void {
    // Frame-time meter (the co-op perf gate reads it) — a ring buffer, no per-frame allocation.
    this.frameTimes[this.frameIdx] = dt * 1000;
    this.frameIdx = (this.frameIdx + 1) % this.frameTimes.length;
    this.frameCount++;
    const now = frameClock();
    this.frameAt = now;
    this.frameNo++;
    if (this.timers.length) {
      let due = false;
      for (const t of this.timers) if (t.at <= now) due = true;
      if (due) {
        const run = this.timers.filter((t) => t.at <= now);
        this.timers = this.timers.filter((t) => t.at > now);
        for (const t of run) {
          try {
            t.fn();
          } catch (err) {
            console.error('[net] timer failed', err);
          }
        }
      }
    }
    if (this._role === 'client') {
      // Reconciliation: bleed position corrections in over ~150 ms (no snapping).
      const c = this.correction;
      if (Math.abs(c.x) + Math.abs(c.z) > 1e-3) {
        const k = 1 - Math.exp(-dt * 20);
        const pos = game.player.position;
        pos.x += c.x * k;
        pos.z += c.z * k;
        c.x -= c.x * k;
        c.z -= c.z * k;
        if (Math.hypot(c.x, c.z) > 3) {
          game.player.teleport(pos.x + c.x, pos.z + c.z);
          c.x = c.z = 0;
        }
      }
    }
    if (this._role !== 'solo') this.bridge.tick(dt);
    this.demo.update(dt, game.time);
    this.remotes.update(dt, game.time, !this.demo.active, now);
    this.myBubble?.update(dt, game.time);
    this.ui.update(dt);
  }

  save(): unknown {
    return { psaves: Object.fromEntries(this.psaves) };
  }

  load(data: unknown): void {
    if (this.restoring) return;
    const d = data as { psaves?: Record<string, unknown> } | null;
    if (!d?.psaves) return;
    this.psaves.clear();
    // Only versioned, pid-keyed entries (older saves keyed farmhands by display name).
    for (const [k, v] of Object.entries(d.psaves)) {
      const p = v as PSave | null;
      if (p && typeof p.seq === 'number' && p.data && typeof p.data === 'object') this.psaves.set(k, p);
    }
  }
}

interface FullState {
  save: unknown;
  debris: [number, string][];
  digest: [number, string][];
}

interface Welcome {
  host: string;
  cal: unknown[];
  gold: number;
  goldAck?: number;
  cabin: number;
  spawn: { x: number; z: number };
  full: FullState | null;
  psave: PSave | null;
  reps?: Record<string, unknown>;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/**
 * This frame's clock (ms, performance.now() domain): the animation-frame timestamp — the vsync time
 * every rAF callback of the frame shares and the one the player's movement was integrated to — not
 * performance.now() taken part-way through a busy frame. Stamping our state and sampling remote
 * farmers on it keeps their motion even when CPU time before the net update varies frame to frame.
 * Falls back to performance.now() outside a rendered frame (tests stepping by hand, hidden tab).
 */
function frameClock(): number {
  const now = performance.now();
  const t = typeof document !== 'undefined' ? Number(document.timeline?.currentTime) : NaN;
  return Number.isFinite(t) && t <= now && now - t < 250 ? t : now;
}
