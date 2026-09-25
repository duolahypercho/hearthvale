/**
 * FestivalSystem: the four seasonal festivals.
 *
 *  - Registers one map per festival (built lazily on first visit): fest-spring, fest-summer,
 *    fest-fall, fest-winter (see world/festivals/*).
 *  - Calendar: on a festival day the morning shows an invitation; walking into town during the
 *    open hours leads to the festival grounds instead (once per day, leaving goes home).
 *  - On the grounds: talking to a villager (player:interact) plays their festival line; the host of
 *    an activity (or its spot: the blossom pole, the wish arch, the race start, the judging table,
 *    the gift circle, the river bank) offers the mini-game — Ribbon Dance, Lantern Release, Sack
 *    Race, Produce Judging, Gift Exchange, Starlight Skate (world/festivals/games.ts overlay +
 *    the map staging the 3D side). Rewards: gold, friendship, items.
 *  - `openUI('festival:<activity>')` starts a mini-game directly (demos: fest-*-<activity>); while
 *    the game is paused (demo) it plays itself in attract mode.
 *  - Demo staging: `demo:stage` for a festival map stages its showcase moment.
 *  - Events for other teams: 'festival:start' / 'festival:end' (+ 'festival:music' mood hints
 *    for the audio system), 'festival:minigame' results.
 *  - Service `festivals`: today(), active(), enter(id), mapFor(id), play(activity).
 *  - Co-op (host-authoritative, net-layer agnostic): every finished mini-game emits
 *    'festival:score' (player 'local' = this browser; the net layer stamps its peer id and relays it);
 *    peers feed relayed scores back through `record()`. Today's per-activity board ranks every
 *    farmer who played and is shown on the result card whenever more than one farmer has a score.
 *    `snapshot()` / `applySnapshot()` hand the festival day's state (done activities + boards) to a
 *    joining client. `&coop=1` (demos) seeds two visiting farmers so the board can be staged.
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { FESTIVALS, ACTIVITIES, ACTIVITY_PAR, festivalOn, festivalForMap, activitiesFor, shortName, coopVisitors, type FestivalDef, type FestivalId, type ActivityId } from '../data/festivals';
import { NPCS, MOODS, type NpcId, type Mood } from '../data/npcs';
import { SpringParade } from '../world/festivals/spring';
import { SummerLanterns } from '../world/festivals/summer';
import { HarvestFair } from '../world/festivals/fall';
import { StarfallSquare } from '../world/festivals/winter';
import { FestivalOverlay } from '../world/festivals/games';
import type { FestivalMap } from '../world/festivals/base';
import { FestivalCoop, type CoopRow } from '../world/festivals/coop';

export interface FestivalApi {
  /** Festival scheduled for today (any hour), if any. */
  today(): FestivalDef | null;
  /** Festival whose grounds the player is on right now. */
  active(): FestivalDef | null;
  /** Travel to a festival's grounds. */
  enter(id: FestivalId): Promise<void>;
  mapFor(id: FestivalId): string;
  /** Start a festival mini-game (must be on its grounds). */
  play(activity: ActivityId): Promise<void>;
  /** Today's co-op board for an activity, best first. */
  board(activity: ActivityId): FestivalScore[];
  /** Add / update a farmer's score (net layer: a relayed 'festival:score' from a peer). */
  record(activity: ActivityId, entry: FestivalScore): void;
  /** Festival-day state for a joining co-op client. */
  snapshot(): FestivalSnapshot;
  applySnapshot(s: FestivalSnapshot): boolean;
  /** Co-op wiring diagnostics (tests): messages in / out over the net extension channel. */
  coopStats(): { msgsIn: number; msgsOut: number; progIn: number; progUsed: number; invites: number; trace: string[]; role: string };
}

/** One farmer's result in a festival mini-game (co-op board row). */
export interface FestivalScore {
  /** 'local' = this browser's farmer; otherwise the net layer's peer id. */
  player: string;
  name: string;
  score: number;
  /** 0 = 1st .. ; ≥ 3 = no ribbon. */
  place: number;
  /** CSS colour of the farmer's name tag (co-op customisation), optional. */
  color?: string;
}

export interface FestivalSnapshot {
  /** Calendar key `year:season:day` the state belongs to. */
  day: string;
  done: string[];
  boards: Partial<Record<ActivityId, FestivalScore[]>>;
}

declare module '../core/game' {
  interface GameServices {
    festivals: FestivalApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'festival:start': { id: string; name: string; map: string };
    'festival:end': { id: string };
    /** Mood hint for the music system: tempo (bpm), mode, timbre. */
    'festival:music': { id: string; tempo: number; mode: string; timbre: string; intensity: number };
    'festival:minigame': { id: string; game: string; score: number; won: boolean };
    /** A farmer's mini-game result — the co-op relay payload (see FestivalApi.record). */
    'festival:score': { id: string; game: string; player: string; name: string; score: number; place: number };
  }
}

/** Score bands (fraction of par) per ribbon tier: [top, 1st/2nd cut, 2nd/3rd cut, 3rd/none cut]. */
const TIER_BANDS: Partial<Record<ActivityId, number[]>> = {
  dance: [0.92, 0.74, 0.55, 0.37],
  lanterns: [1.0, 0.83, 0.57, 0.37],
  pumpkin: [0.99, 0.86, 0.78, 0.6],
  skate: [0.98, 0.85, 0.65, 0.45],
};

type MapCtor = new (game: Game) => FestivalMap;
const MAPS: Partial<Record<string, MapCtor>> = {
  'fest-spring': SpringParade,
  'fest-summer': SummerLanterns,
  'fest-fall': HarvestFair,
  'fest-winter': StarfallSquare,
};

export class FestivalSystem implements System {
  readonly name = 'festivals';
  private game!: Game;
  private current: FestivalDef | null = null;
  private visited = new Set<string>();
  private invited = -1;
  private overlay!: FestivalOverlay;
  private busy = false;
  /** Activities finished today (key: day:activity) — hosts thank you instead of re-offering. */
  private done = new Set<string>();
  /** Activities ever won (1st place) — the dance offers its fast encore chart after a win. */
  private wins = new Set<ActivityId>();
  private lineIx = new Map<string, number>();
  /** Co-op boards for today, keyed by dayKey(activity). */
  private boards = new Map<string, FestivalScore[]>();
  /** The festival map the player is on (so its prize ribbon comes off when they leave). */
  private grounds: FestivalMap | null = null;
  /** Co-op relay (scores, boards, start-line lobbies, live race progress). */
  private coop!: FestivalCoop;

  init(game: Game): void {
    this.game = game;
    this.overlay = new FestivalOverlay(game);
    this.coop = new FestivalCoop(game, {
      // Host: a farmhand's result joins the board, and everyone gets the new board.
      onScore: (a, row) => {
        this.record(a, row);
        this.coop.broadcastBoard(a, this.board(a));
        this.boardToast(a, row);
      },
      // Farmhand: the host's board replaces ours (our own row comes back as 'local').
      onBoard: (a, rows) => {
        const before = new Set(this.board(a).map((r) => r.player));
        this.boards.set(this.dayKey(a), rows.map((r) => ({ ...r })));
        for (const r of rows) if (r.player !== 'local' && !before.has(r.player)) this.boardToast(a, r);
      },
      snapshot: () => {
        const snap = this.snapshot();
        const me = this.coop.myId();
        const w = this.coop.who(me);
        for (const k of Object.keys(snap.boards) as ActivityId[]) snap.boards[k] = snap.boards[k]!.map((r) => (r.player === 'local' ? { ...r, player: `p${me}`, name: w.name, color: w.color } : r));
        return snap;
      },
      applySnapshot: (s) => this.applySnapshot(s as FestivalSnapshot),
      grounds: () => this.map()?.id ?? null,
    });
    // Another farmer is at a start line: say how to join.
    game.events.on('festival:lobby', ({ act, name, left }) => {
      const def = ACTIVITIES[act as ActivityId];
      if (!def || !this.map() || this.overlay.running) return;
      game.hud.banner(`${name} is at the ${def.name} start line!`, `Talk to ${shortName(NPCS[def.host as NpcId]?.name ?? 'the host')} within ${left}s to race them`);
    });
    for (const [id, Ctor] of Object.entries(MAPS)) {
      if (!Ctor) continue;
      game.world.registerMap(id, (g) => new Ctor(g).build());
    }
    game.provide('festivals', {
      today: () => festivalOn(game.calendar.season, game.calendar.day),
      active: () => this.current,
      enter: (id) => this.enter(id),
      mapFor: (id) => FESTIVALS[id].map,
      play: (a) => this.runActivity(a, false),
      board: (a) => this.board(a),
      record: (a, e) => this.record(a, e),
      snapshot: () => this.snapshot(),
      applySnapshot: (snap) => this.applySnapshot(snap),
      coopStats: () => ({ ...this.coop.stats, trace: [...this.coop.stats.trace], role: this.coop.role() }),
    });
    // `openUI('festival:<activity>')` — critics / demos stage a mini-game directly.
    game.hud.registerPanel('festival', {
      open: (arg) => {
        const id = (arg ?? '') as ActivityId;
        if (arg === '__run') return;
        if (!ACTIVITIES[id]) {
          console.error(`[festival] unknown activity "${arg}" (known: ${Object.keys(ACTIVITIES).join(', ')})`);
          return;
        }
        if (!this.busy) void this.runActivity(id, true);
      },
      close: () => this.overlay.abort(),
    });
    game.events.on('demo:stage', ({ name }) => {
      const map = this.map();
      if (map && name.startsWith('fest')) map.stage();
    });
    game.events.on('day:start', ({ day, season }) => {
      const f = festivalOn(season, day);
      if (f && this.invited !== day) {
        this.invited = day;
        game.hud.banner(`${f.name} today!`, f.blurb);
      }
    });
    game.events.on('player:interact', ({ x, z }) => this.interact(x, z));
    // Walking into town during a festival leads to the festival grounds (once per day).
    game.events.on('map:change', ({ map }) => {
      const cal = game.calendar;
      const f = festivalOn(cal.season, cal.day);
      const onGrounds = festivalForMap(map);
      if (onGrounds) {
        this.grounds = this.map();
        if (this.current?.id !== onGrounds.id) {
          this.current = onGrounds;
          game.events.emit('festival:start', { id: onGrounds.id, name: onGrounds.name, map });
          game.events.emit('festival:music', { id: onGrounds.id, ...onGrounds.music, intensity: 1 });
        }
        return;
      }
      this.grounds?.unpin();
      this.grounds = null;
      if (this.current) {
        game.events.emit('festival:end', { id: this.current.id });
        this.current = null;
      }
      const key = `${cal.year}:${cal.season}:${cal.day}`;
      if (map === 'town' && f && cal.hour >= f.open && cal.hour < f.close && !this.visited.has(key) && game.world.has(f.map) && !game.paused) {
        this.visited.add(key);
        void this.enter(f.id);
      }
    });
  }

  // ───────────────────────────────────────────── co-op board

  private calKey(): string {
    const c = this.game.calendar;
    return `${c.year}:${c.season}:${c.day}`;
  }

  private board(a: ActivityId): FestivalScore[] {
    return [...(this.boards.get(this.dayKey(a)) ?? [])].sort((x, y) => x.place - y.place || y.score - x.score);
  }

  private record(a: ActivityId, e: FestivalScore): void {
    if (!ACTIVITIES[a]) return;
    const k = this.dayKey(a);
    const list = (this.boards.get(k) ?? []).filter((r) => r.player !== e.player);
    list.push({ ...e });
    this.boards.set(k, list);
    // Only today's boards are kept (a festival is one day).
    const day = this.calKey() + ':';
    for (const key of this.boards.keys()) if (!key.startsWith(day)) this.boards.delete(key);
  }

  private snapshot(): FestivalSnapshot {
    const day = this.calKey();
    const boards: FestivalSnapshot['boards'] = {};
    for (const [k, v] of this.boards) if (k.startsWith(day + ':')) boards[k.slice(day.length + 1) as ActivityId] = v.map((e) => ({ ...e }));
    return { day, done: [...this.done].filter((k) => k.startsWith(day + ':')), boards };
  }

  /**
   * A joining farmhand adopts the festival day's boards. Activities are per farmer (everyone gets
   * their own go at the dance, the race…), so the host's `done` list only marks which activities
   * already have a board; a farmhand's own completions stay theirs.
   */
  private applySnapshot(snap: FestivalSnapshot): boolean {
    if (!snap || snap.day !== this.calKey()) return false;
    for (const [a, list] of Object.entries(snap.boards) as [ActivityId, FestivalScore[]][]) for (const e of list ?? []) if (e.player !== 'local' || !this.done.has(this.dayKey(a))) this.record(a, e);
    return true;
  }

  /** "Ash placed 2nd in the Sack Race" (a co-op farmer's result arrives). */
  private boardToast(a: ActivityId, r: CoopRow): void {
    if (r.player === 'local' || !this.map()) return;
    const ord = ['1st', '2nd', '3rd'][r.place];
    this.game.events.emit('ui:toast', { text: `<b>${r.name.replace(/[<>&]/g, '')}</b> ${ord ? `took <b>${ord}</b> in` : 'finished'} the ${ACTIVITIES[a].name}`, kind: 'info' });
  }

  /**
   * `&coop=1` staging (attract mode only): two visiting farmers with results of their own, drawn from
   * a seeded skill distribution against the game's par (independent of your score), so a flop ranks
   * below them and a great run above.
   */
  private demoPeers(auto: boolean, a: ActivityId): FestivalScore[] {
    if (!auto || !new URLSearchParams(location.search).has('coop')) return [];
    const names = Object.entries(NPCS).flatMap(([id, n]) => [id, shortName(n.name)]);
    const c = this.game.calendar;
    return coopVisitors(names).map((v, k) => {
      // Deterministic per day / farmer / game: skill in 0.5..0.97.
      let h = 2166136261;
      for (const ch of `${c.year}:${c.season}:${c.day}:${a}:${v.id}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      const u = ((((h >>> 0) % 1000) / 1000) * 0.97 + k * 0.29) % 1;
      // Ribbon tier first (skill), then a score inside that tier's band of the par, so the board
      // never shows a lower tier out-scoring a higher one.
      const place = u >= 0.72 ? 0 : u >= 0.45 ? 1 : u >= 0.22 ? 2 : 3;
      const band = TIER_BANDS[a] ?? TIER_BANDS.dance!;
      const [lo, hi] = [band[place + 1] ?? 0.1, band[place]!];
      const w = (u * 7.3) % 1;
      const score = a === 'sackrace' ? 1000 - 200 * Math.min(4, place + k) : Math.round(ACTIVITY_PAR[a] * (lo + (hi - lo) * (0.15 + w * 0.7)));
      return { player: v.id, name: v.name, score, place, color: v.color };
    });
  }

  private map(): FestivalMap | null {
    const m = this.game.world.current as FestivalMap | null;
    return m && festivalForMap(m.id) ? m : null;
  }

  private async enter(id: FestivalId): Promise<void> {
    const f = FESTIVALS[id];
    if (!this.game.world.has(f.map)) return;
    await this.game.hud.fade(true);
    await this.game.teleport(f.map, f.arrive.x, f.arrive.z);
    this.game.player.setFacing('up');
    await this.game.hud.fade(false);
    this.game.hud.banner(f.name, f.event.name + ' at ' + fmtHour(f.event.hour));
  }

  // ───────────────────────────────────────────── talking

  private dayKey(a: ActivityId): string {
    const c = this.game.calendar;
    return `${c.year}:${c.season}:${c.day}:${a}`;
  }

  private interact(tx: number, tz: number): void {
    const map = this.map();
    const fest = map && festivalForMap(map.id);
    if (!map || !fest || this.busy || this.overlay.running) return;
    const p = this.game.player.position;
    const cx = tx + 0.5;
    const cz = tz + 0.5;
    const who = map.nearestNamed(cx, cz, 1.25) ?? map.nearestNamed(p.x, p.z, 1.9);
    const acts = activitiesFor(fest.id);
    if (who) {
      const act = acts.find((a) => a.host === who.id);
      map.faceMember(who.i, p.x, p.z);
      if (act && !this.done.has(this.dayKey(act.id))) {
        void this.offer(act.id);
        return;
      }
      void this.say(who.id as NpcId, this.lineFor(fest, who.id));
      return;
    }
    const spot = map.activitySpots.find((s) => Math.hypot(s.x - cx, s.z - cz) < s.r || Math.hypot(s.x - p.x, s.z - p.z) < s.r);
    if (spot && !this.done.has(this.dayKey(spot.id))) void this.offer(spot.id);
  }

  private lineFor(f: FestivalDef, id: string): string {
    const own = f.lines[id] ?? [];
    const pool = [...own, ...own, ...(f.lines['*'] ?? [])];
    const k = this.lineIx.get(`${f.id}:${id}`) ?? 0;
    this.lineIx.set(`${f.id}:${id}`, k + 1);
    return pool[k % pool.length] ?? 'Happy festival!';
  }

  private async say(id: NpcId, text: string): Promise<void> {
    const box = this.game.services.dialogueBox;
    if (!box || !NPCS[id]) return;
    this.busy = true;
    try {
      const l = splitMood(text, 'happy');
      await box.say(id, l.text, l.mood);
      box.end();
    } finally {
      this.busy = false;
    }
  }

  private async offer(a: ActivityId): Promise<void> {
    const def = ACTIVITIES[a];
    const box = this.game.services.dialogueBox;
    const host = def.host as NpcId;
    if (!box) return this.runActivity(a, false);
    this.busy = true;
    try {
      const l = splitMood(def.ask, 'happy');
      const k = await box.choose(host, l.text, [def.yes, def.no], l.mood);
      box.end();
      if (k !== 0) return;
    } finally {
      this.busy = false;
    }
    await this.runActivity(a, false);
  }

  /** Pick a dance partner (the villagers you know best + the host's suggestion). */
  private async choosePartner(auto: boolean): Promise<string | null> {
    const rel = this.game.services.relationships;
    const ids = (Object.keys(NPCS) as NpcId[]).filter((i) => i !== 'hazel' && i !== 'kit');
    ids.sort((a, b) => (rel?.points(b) ?? 0) - (rel?.points(a) ?? 0));
    const opts = ids.slice(0, 3);
    if (auto) return 'wren';
    const box = this.game.services.dialogueBox;
    if (!box) return opts[0]!;
    this.busy = true;
    try {
      const k = await box.choose('hazel', 'Now — who will you dance with?', [...opts.map((i) => shortName(NPCS[i].name)), 'Surprise me!'], 'thinking');
      box.end();
      if (k < 0) return null;
      return k < 3 ? opts[k]! : ids[3 + Math.floor(Math.random() * (ids.length - 3))]!;
    } finally {
      this.busy = false;
    }
  }

  // ───────────────────────────────────────────── mini-games

  private async runActivity(a: ActivityId, direct: boolean): Promise<void> {
    const map = this.map();
    const def = ACTIVITIES[a];
    const fest = FESTIVALS[def.festival];
    if (!map || map.id !== fest.map) {
      console.error(`[festival] "${a}" can only be played on ${fest.map}`);
      return;
    }
    if (this.busy || this.overlay.running) return;
    const game = this.game;
    const auto = direct && game.paused;
    let partner: string | undefined;
    if (a === 'dance') partner = (await this.choosePartner(auto)) ?? undefined;
    if (a === 'dance' && !partner) return;
    if (a === 'giftswap') {
      const ids = (Object.keys(NPCS) as NpcId[]).filter((i) => i !== def.host);
      partner = auto ? 'wren' : ids[Math.floor(Math.random() * ids.length)];
    }
    this.busy = true;
    const hudOpen = game.hud.openPanelName;
    if (hudOpen !== 'festival') game.hud.open('festival:__run');
    game.player.controllable = false;
    const play = map.beginPlay(a, partner);
    // Co-op: other farmers on the grounds can join a race at the start line.
    const lobby = auto ? null : this.coop.lineUp(a);
    let result: Awaited<ReturnType<FestivalOverlay['run']>> = null;
    try {
      result = await this.overlay.run({
        game,
        map,
        play,
        def,
        festival: fest,
        auto,
        hard: a === 'dance' && this.wins.has('dance'),
        lobby,
        // The result card ranks every farmer who played today (co-op); your row is folded in live.
        board: (r) => {
          const you: FestivalScore = { player: 'local', name: 'You', score: r.score, place: r.noRibbon ? 3 : r.place };
          const known = this.board(a).filter((e) => e.player !== 'local');
          // Farmers who just raced you are on the card straight away (their own result reaches the
          // board a moment later through the host).
          const live = (r.rivals ?? []).filter((x) => !known.some((k) => k.player === x.player));
          const rows = [...known, ...live, ...this.demoPeers(auto, a), you];
          return rows.sort((x, y) => Math.min(x.place, 3) - Math.min(y.place, 3) || y.score - x.score);
        },
      });
    } finally {
      map.endPlay(result ?? {});
      game.player.controllable = true;
      this.busy = false;
      if (game.hud.openPanelName === 'festival') game.hud.open('none');
    }
    if (!result) return;
    const firstWin = result.place === 0 && !result.noRibbon && !result.reaction && !this.wins.has(a);
    if (result.place === 0 && !result.noRibbon && !result.reaction) this.wins.add(a);
    // Win the Ribbon Dance and the fiddler offers the fast encore reel (same day); otherwise done.
    if (!(a === 'dance' && firstWin)) this.done.add(this.dayKey(a));
    if (result.gold) game.services.economy?.add(result.gold, `festival:${a}`);
    for (const h of result.hearts ?? []) game.services.relationships?.adjust(h.id, h.delta);
    game.events.emit('festival:minigame', { id: fest.id, game: a, score: result.score, won: result.place === 0 && !result.noRibbon });
    if (!result.reaction) {
      const me: FestivalScore = { player: 'local', name: 'You', score: result.score, place: result.noRibbon ? 3 : result.place };
      this.record(a, me);
      game.events.emit('festival:score', { id: fest.id, game: a, player: me.player, name: me.name, score: me.score, place: me.place });
      this.coop.shareScore(a, me.score, me.place, this.board(a));
    }
    if (result.gold) game.events.emit('ui:toast', { text: `<b>+${result.gold}g</b> ${def.name} ${result.noRibbon ? 'consolation' : 'prize'}`, kind: 'gold' });
    const thanks: Partial<Record<ActivityId, string[]>> = {
      dance: ['[laugh] Now THAT is how the ribbons are meant to weave!', '[happy] Lovely footwork, dear. The pole approves.', '[happy] You went the wrong way twice. So did your gran. Perfect.'],
      lanterns: ['[happy] Look at them go. The whole bay is carrying your wishes now.'],
      sackrace: ['[laugh] You hop like a champion! Well. Like a very determined potato.'],
      pumpkin: ['[happy] The judges have spoken! And eaten a little of the pie table.'],
      giftswap: ['[happy] That’s the Starfall spirit, dear. Warm hands, warm hearts.'],
      skate: ['[neutral] Not bad. Your ankles survived. Come back next year.'],
    };
    const laughs: Partial<Record<ActivityId, string>> = {
      dance: '[laugh] You tied three people to the pole, dear. That is a record. Try again next spring!',
      lanterns: '[happy] The sea is patient. So am I. Next year, hold them a breath longer.',
      sackrace: '[laugh] You hopped like a potato with somewhere to be. Very brave. Very slow.',
      pumpkin: '[thinking] Size matters to these judges, I’m afraid. Grow something enormous for next year.',
      skate: '[neutral] The ice won that round. Cocoa is on me.',
    };
    const lines = thanks[a] ?? [];
    let line = result.noRibbon ? laughs[a] : lines[Math.min(result.place, lines.length - 1)];
    if (a === 'dance' && firstWin) line = '[laugh] Now THAT is how the ribbons are meant to weave! The fiddler wants an encore — the fast reel. Come back to me when you dare.';
    if (line && !direct) await this.say(def.host as NpcId, line);
  }

  save(): unknown {
    return { visited: [...this.visited], done: [...this.done], wins: [...this.wins] };
  }

  load(data: unknown): void {
    const d = data as { visited?: string[]; done?: string[]; wins?: ActivityId[] } | null;
    this.visited = new Set(d?.visited ?? []);
    this.done = new Set(d?.done ?? []);
    this.wins = new Set(d?.wins ?? []);
  }
}

/** "[mood] text" → mood + clean text (the scripted dialogue box doesn't parse tags). */
function splitMood(text: string, fallback: Mood): { mood: Mood; text: string } {
  const m = /^\[(\w+)\]\s*/.exec(text);
  const mood = m && (MOODS as string[]).includes(m[1]!) ? (m[1] as Mood) : fallback;
  return { mood, text: m ? text.slice(m[0].length) : text };
}

function fmtHour(h: number): string {
  const hh = Math.floor(h) % 24;
  return `${hh % 12 === 0 ? 12 : hh % 12}${hh < 12 ? ' am' : ' pm'}`;
}
