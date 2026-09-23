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
import { FESTIVALS, ACTIVITIES, festivalOn, festivalForMap, activitiesFor, shortName, type FestivalDef, type FestivalId, type ActivityId } from '../data/festivals';
import { NPCS, MOODS, type NpcId, type Mood } from '../data/npcs';
import { SpringParade } from '../world/festivals/spring';
import { SummerLanterns } from '../world/festivals/summer';
import { HarvestFair } from '../world/festivals/fall';
import { StarfallSquare } from '../world/festivals/winter';
import { FestivalOverlay } from '../world/festivals/games';
import type { FestivalMap } from '../world/festivals/base';

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
  applySnapshot(s: FestivalSnapshot): void;
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

  init(game: Game): void {
    this.game = game;
    this.overlay = new FestivalOverlay(game);
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
        if (this.current?.id !== onGrounds.id) {
          this.current = onGrounds;
          game.events.emit('festival:start', { id: onGrounds.id, name: onGrounds.name, map });
          game.events.emit('festival:music', { id: onGrounds.id, ...onGrounds.music, intensity: 1 });
        }
        return;
      }
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

  private applySnapshot(snap: FestivalSnapshot): void {
    if (!snap || snap.day !== this.calKey()) return;
    for (const k of snap.done) this.done.add(k);
    for (const [a, list] of Object.entries(snap.boards) as [ActivityId, FestivalScore[]][]) for (const e of list ?? []) if (e.player !== 'local') this.record(a, e);
  }

  /** `&coop=1` staging (attract mode only): two visiting farmers who played just behind you. */
  private demoPeers(auto: boolean, score: number, place: number): FestivalScore[] {
    if (!auto || !new URLSearchParams(location.search).has('coop')) return [];
    return [
      { player: 'peer:juniper', name: 'Juniper', score: Math.round(score * 0.91), place: Math.min(3, place + 1), color: '#5aa0d8' },
      { player: 'peer:rowan', name: 'Rowan', score: Math.round(score * 0.74), place: Math.min(3, place + 2), color: '#d8785a' },
    ];
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
        // The result card ranks every farmer who played today (co-op); your row is folded in live.
        board: (r) => {
          const you: FestivalScore = { player: 'local', name: 'You', score: r.score, place: r.noRibbon ? 3 : r.place };
          const rows = [...this.board(a).filter((e) => e.player !== 'local'), ...this.demoPeers(auto, you.score, you.place), you];
          return rows.sort((x, y) => x.place - y.place || y.score - x.score);
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
