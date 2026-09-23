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
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { FESTIVALS, ACTIVITIES, festivalOn, festivalForMap, activitiesFor, type FestivalDef, type FestivalId, type ActivityId } from '../data/festivals';
import { NPCS, type NpcId } from '../data/npcs';
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
  private lineIx = new Map<string, number>();

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
      await box.say(id, text.startsWith('[') ? text : `[happy] ${text}`);
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
      const k = await box.choose(host, def.ask, [def.yes, def.no], 'happy');
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
      const k = await box.choose('hazel', '[thinking] Now — who will you dance with?', [...opts.map((i) => NPCS[i].name.split(' ')[0]!), 'Surprise me!'], 'happy');
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
      result = await this.overlay.run({ game, map, play, def, festival: fest, auto });
    } finally {
      map.endPlay(result ?? {});
      game.player.controllable = true;
      this.busy = false;
      if (game.hud.openPanelName === 'festival') game.hud.open('none');
    }
    if (!result) return;
    this.done.add(this.dayKey(a));
    if (result.gold) game.services.economy?.add(result.gold, `festival:${a}`);
    for (const h of result.hearts ?? []) game.services.relationships?.adjust(h.id, h.delta);
    game.events.emit('festival:minigame', { id: fest.id, game: a, score: result.score, won: result.place === 0 });
    if (result.gold) game.events.emit('ui:toast', { text: `<b>+${result.gold}g</b> ${def.name} prize`, kind: 'gold' });
    const thanks: Partial<Record<ActivityId, string[]>> = {
      dance: ['[laugh] Now THAT is how the ribbons are meant to weave!', '[happy] Lovely footwork, dear. The pole approves.', '[happy] You went the wrong way twice. So did your gran. Perfect.'],
      lanterns: ['[happy] Look at them go. The whole bay is carrying your wishes now.'],
      sackrace: ['[laugh] You hop like a champion! Well. Like a very determined potato.'],
      pumpkin: ['[happy] The judges have spoken! And eaten a little of the pie table.'],
      giftswap: ['[happy] That’s the Starfall spirit, dear. Warm hands, warm hearts.'],
      skate: ['[neutral] Not bad. Your ankles survived. Come back next year.'],
    };
    const lines = thanks[a] ?? [];
    const line = lines[Math.min(result.place, lines.length - 1)];
    if (line && !direct) await this.say(def.host as NpcId, line);
  }

  save(): unknown {
    return { visited: [...this.visited], done: [...this.done] };
  }

  load(data: unknown): void {
    const d = data as { visited?: string[]; done?: string[] } | null;
    this.visited = new Set(d?.visited ?? []);
    this.done = new Set(d?.done ?? []);
  }
}

function fmtHour(h: number): string {
  const hh = Math.floor(h) % 24;
  return `${hh % 12 === 0 ? 12 : hh % 12}${hh < 12 ? ' am' : ' pm'}`;
}
