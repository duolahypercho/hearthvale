/**
 * window.__game debug / automation API (see DESIGN.md). Critics and tests depend on it.
 * Also parses URL params that mirror the API.
 */
import type { Game } from './game';
import type { Facing, Quality } from './events';
import { SEASONS, WEATHERS, type Season, type Weather } from './time';
import { DEMOS } from './demos';

export interface DebugApi {
  game: Game;
  setTime(hour: number): void;
  setDay(day: number): void;
  setSeason(season: Season): void;
  setWeather(weather: Weather): void;
  teleport(map: string, x: number, z: number): Promise<void>;
  facing(dir: Facing): void;
  openUI(name: string): void;
  give(itemId: string, qty?: number): void;
  setGold(n: number): void;
  grow(days: number): void;
  demo(name: string): Promise<void>;
  ready(): Promise<void>;
  pause(p?: boolean): void;
  quality(q: Quality): void;
  camera(opts: { yaw?: number; pitch?: number; distance?: number; offsetX?: number; offsetZ?: number }): void;
  save(slot?: string): boolean;
  load(slot?: string): boolean;
  /** Advance N frames synchronously (dt each) — for deterministic tests. */
  step(frames?: number, dt?: number): void;
  info(): Record<string, unknown>;
  demos: string[];
}

declare global {
  interface Window {
    __game: DebugApi;
  }
}

export function installDebugApi(game: Game): DebugApi {
  const api: DebugApi = {
    game,
    setTime: (h) => game.calendar.setHour(h),
    setDay: (d) => game.calendar.setDay(d),
    setSeason: (s) => {
      if (!SEASONS.includes(s)) throw new Error(`bad season ${s}`);
      game.calendar.setSeason(s);
    },
    setWeather: (w) => {
      if (!WEATHERS.includes(w)) throw new Error(`bad weather ${w}`);
      game.calendar.setWeather(w);
    },
    teleport: (map, x, z) => game.teleport(map, x, z),
    facing: (d) => game.player.setFacing(d),
    openUI: (name) => {
      const base = name.split(':')[0]!;
      if (base !== 'none' && !game.hud.hasPanel(base)) console.error(`[ui] openUI("${name}"): no panel registered for "${base}"`);
      game.events.emit('ui:open', { name });
    },
    give: (itemId, qty = 1) => game.events.emit('item:give', { itemId, qty }),
    setGold: (n) => game.setGold(n),
    grow: (days) => game.events.emit('crops:grow', { days }),
    demo: async (name) => {
      const d = DEMOS[name];
      if (!d) throw new Error(`unknown demo "${name}" (known: ${Object.keys(DEMOS).join(', ')})`);
      game.events.emit('ui:open', { name: 'none' });
      let map = d.map;
      if (!game.world.has(map)) {
        console.warn(`[demo] map "${map}" not implemented yet; staging on farm`);
        map = 'farm';
      }
      game.calendar.setSeason(d.season);
      game.calendar.setWeather(d.weather);
      game.applySeason(d.season, true);
      game.applyWeather(d.weather, true);
      await game.teleport(map, map === d.map ? d.x : 31.2, map === d.map ? d.z : 20.2);
      game.events.emit('demo:stage', { name, showcase: d.showcase ?? ['field'] });
      game.calendar.setHour(d.time);
      game.player.setFacing(d.facing);
      api.camera(d.camera ?? {});
      game.setPaused(true);
      if (d.ui) api.openUI(d.ui);
      game.followPlayer(true);
    },
    ready: () => game.ready(),
    pause: (p = true) => game.setPaused(p),
    quality: (q) => game.setQuality(q),
    camera: (o) => {
      const rig = game.rc.rig;
      rig.yaw = o.yaw ?? 0;
      rig.pitch = o.pitch ?? 50;
      rig.distance = o.distance ?? 24;
      rig.lookOffset.set(o.offsetX ?? 0, 0, o.offsetZ ?? 0);
      rig.snap();
    },
    save: (slot) => game.saves.save(slot),
    load: (slot) => game.saves.load(slot),
    step: (frames = 1, dt = 1 / 60) => {
      for (let i = 0; i < frames; i++) game.step(dt);
    },
    info: () => ({
      perf: game.perf(),
      map: game.world.current?.id,
      player: { x: game.player.position.x, z: game.player.position.z, facing: game.player.facing },
      calendar: game.calendar.serialize(),
      gold: game.gold,
      quality: game.rc.quality,
      paused: game.paused,
      frame: game.frame,
      drawCalls: game.rc.renderer.info.render.calls,
      triangles: game.rc.renderer.info.render.triangles,
    }),
    demos: Object.keys(DEMOS),
  };
  window.__game = api;
  return api;
}

/** Apply URL params (?demo=..&map=..&x=..&z=..&time=..&season=..&weather=..&ui=..&day=..&gold=..&pause=1). */
export async function applyUrlParams(api: DebugApi, params: URLSearchParams): Promise<void> {
  const demo = params.get('demo');
  if (demo) await api.demo(demo);
  const map = params.get('map');
  const x = params.get('x');
  const z = params.get('z');
  if (map || x || z) {
    const cur = api.game.world.current;
    await api.teleport(map ?? cur?.id ?? 'farm', x ? Number(x) : (cur?.spawn.x ?? 32), z ? Number(z) : (cur?.spawn.z ?? 20));
  }
  const season = params.get('season') as Season | null;
  if (season) {
    api.setSeason(season);
    api.game.applySeason(season, true);
  }
  const weather = params.get('weather') as Weather | null;
  if (weather) {
    api.setWeather(weather);
    api.game.applyWeather(weather, true);
  }
  const day = params.get('day');
  if (day) api.setDay(Number(day));
  const time = params.get('time');
  if (time) api.setTime(Number(time));
  const gold = params.get('gold');
  if (gold) api.setGold(Number(gold));
  const facing = params.get('facing') as Facing | null;
  if (facing) api.facing(facing);
  if (params.get('pause') === '1') api.pause(true);
  // ?cam=yaw,pitch,distance[,offsetX,offsetZ]
  const cam = params.get('cam');
  if (cam) {
    const [yaw, pitch, distance, offsetX, offsetZ] = cam.split(',').map(Number);
    api.camera({ yaw, pitch, distance, offsetX, offsetZ });
  }
  const ui = params.get('ui');
  if (ui) api.openUI(ui);
}
