# Hearthvale

An original cozy farming sim built as a stylized 3D "living diorama" in Three.js.
Design contract (art direction, scope, debug API): **[DESIGN.md](DESIGN.md)** — read it first.

## Run

```bash
npm install
npm run dev          # http://127.0.0.1:5173  (try /?demo=farm-morning)
npm run typecheck    # tsc --noEmit (strict)
npm run lint         # architecture rule: no imports between sibling systems
npm test             # headless smoke test: boots the game, exercises every __game API + the farming loop,
                     #   fails on page/console errors or a blown render budget
npm run check        # typecheck + lint + test
npm run build        # typecheck + lint + production bundle in dist/ (three.js in its own vendor chunk)
npm run shot -- --url "?demo=farm-evening" --out shots/evening.png
sh scripts/critic-shots.sh  # re-capture the critic shot list into shots/r3/set (+ perf per shot)
sh scripts/perf-shot.sh "?demo=town-evening" shots/t.png   # shot + per-system perf table
```

Controls: **WASD / arrows** move (Shift runs) · **left click / C / Space** use tool ·
**right click / X / F** interact · **1–0** toolbar · **E** inventory · **Esc** menu.

## Architecture

```
src/
  main.ts                bootstrap only (creates Game, installs debug API, applies URL params)
  core/
    game.ts              Game context: engine services + SYSTEMS registry + typed game.services + fixed-step loop
    system.ts            System interface (init / fixedUpdate / update / onMapChange / save / load)
    events.ts            typed EventBus + GameEvents map (extend via declaration merging)
    time.ts              Calendar: 10 game-min per 7 real s, 6:00→26:00, 28-day seasons, weather
    input.ts             keyboard/mouse → actions, move axis, toolbar hotkeys
    save.ts              SaveManager: register(key, {save, load}); localStorage slots
    rng.ts, noise.ts     seeded RNG (mulberry32), hashes, simplex + tileable value noise
    debug.ts, demos.ts   window.__game API, URL params, canned beauty scenes
  render/
    renderer.ts          WebGLRenderer (ACES, sRGB, PCF soft shadows) + CameraRig (35° FOV, pitched, smooth follow)
                         + per-system draw/triangle probe → __game.info().perf.bySystem
    post.ts              EffectComposer: GTAO → Bloom (threshold 0.92, emissive-only) → Output → SMAA → tilt-shift → grade
                         (film grain luminance-weighted, off at medium / low)
    lighting.ts          DayNight: sun/moon, hemi, bounce, fog, sky dome, PMREM IBL, exposure + grade keyed by hour/season/
                         weather; shadow frustum fitted to the view footprint; lamps dimmed over snow
    textures.ts          procedural texture library (index) → tex/{core,ground,stone,wood,foliage,fx}.ts
    materials.ts         shared material library (+ nightGlow emissives, roofTile, paperLantern)
    wind.ts, worldfx.ts, patch.ts, uniforms.ts, particles.ts (smoke, ambience, bees, bursts, fire + embers),
                         precipitation.ts (2-layer hairline rain, splashes, snow), foliage.ts
    shaders/noise.ts     GLSL hash/value noise/fbm/cloud-shadow + hvMeadowVar (8–12 m hue/value variation)
  world/
    tiles.ts, map.ts     TileGrid + GameMap (warps, title) + World (map registry / loader)
    terrain.ts           chunked heightfield + splat (path/tilled/wet/sand) + ground-cover texture (clover/moss/
                         trampled/contact AO) shader; half-res shadow-proxy chunks; optional cobble path texture
    water.ts             Fresnel sky + bank reflection, depth absorption, broken animated shore foam, ice
    grass.ts             chunked instanced grass: 12 m full (3-seg) / 22 m 40 % (1-seg) / fade-out LOD
    geom.ts              roundedBox, bevelCylinder, lumpySphere, AO baking, MeshBuilder (+ material aliases), mergeStatic
    farm/                index.ts (assembly) · paint.ts (shape, splat + cover masks, grass density) ·
                         layout.ts (structures, vignettes + contact AO, trees, pond/cliff dressing) ·
                         overgrowth.ts (seeded Poisson-disk debris: ~650 clearable weeds/stones/sticks/stumps/logs/bushes
                         in clumps + a ~r 0.7 m ground-cover layer: clover, daisies, buttercups, leaf litter, ferns)
    town/index.ts        Hearthvale Square: plaza + fountain, Lantern Hall, store, bakery, cottages, stall, festival
    props/               instanced.ts (BatchPool/InstancedSet) · trees.ts · nature.ts (registry only) ·
                         rocks.ts (faceted, mossy, 3 tints) · debris.ts (chunky sticks, branches, stumps, logs, leaves) ·
                         flora.ts (weeds, ferns, bushes, flowers, reeds, ground cover) · structures.ts · farmkit.ts ·
                         homestead.ts · townkit.ts (townhouses, hall with lit interior cards, fountain, stalls, café,
                         flower cart) · festival.ts (catenary bunting, lantern poles, maypole, feast table, braziers) ·
                         crops.ts · soil.ts (wet mask, winter snow-in-furrows + husks) · decals.ts
  entities/              player.ts (chibi farmer), villager.ts (NPC rig: walk / idle / talk), critters.ts
  ui/                    hud.ts + hud.css (clock, toolbar, energy, toasts, fade, banner, panel registry) · screens.css ·
                         inventory.ts · dialogue.ts (typewriter + portraits) · portraits.ts (procedural SVG) ·
                         title.ts (title screen + grandmother's letter) · panels.ts (shop, crafting, map, fishing) · icons.ts
  systems/               economy (gold), energy, season, weather, inventory, farming, shipping, critters, npcs, warps,
                         audio, sleep (end of day / pass out), relationships, fishing*, mining*, crafting, quests
                         (* typed stubs: state + events + service, ready for their teams) — see systems/README.md
  data/                  crops.ts, items.ts, npcs.ts (villagers + festival-goers), fish.ts, recipes.ts, bundles.ts,
                         farm-layout.ts, town-layout.ts (incl. FESTIVAL layout)
scripts/shot.mjs         headless screenshot harness
```

### Rules of the road

- Siblings talk through `game.events` (typed) or `game.services` (typed via declaration merging) — never by
  importing each other (`npm run lint` enforces it).
- World generation uses `game.rng.fork('<label>')` so content is deterministic per seed.
- Outdoor materials: `applyWorldFx(mat)`; anything that should sway: `applyWind(mat, …)` and set
  `mesh.customDepthMaterial = windDepthMaterial(sameOpts)` so its shadow sways too.
- Anything glowing at night: use `materials.get('glass' | 'lampGlow')` or push to `nightGlow`; practical lights via
  `game.lighting.addNightLight(light, maxIntensity)`.

### Adding a system

```ts
// src/systems/farming.ts
import type { System } from '../core/system';
import type { Game } from '../core/game';

declare module '../core/events' {
  interface GameEvents { 'crop:harvested': { cropId: string; x: number; z: number } }
}

export class FarmingSystem implements System {
  readonly name = 'farming';
  init(game: Game) {
    game.events.on('player:use', ({ x, z }) => { /* hoe / water / plant on tile (x,z) */ });
    game.events.on('day:start', () => { /* grow crops */ });
  }
  save() { return {}; }
  load(_data: unknown) {}
}
```

Then add one line to `SYSTEMS` in `src/core/game.ts`: `() => new FarmingSystem(),`

Publishing an API for other systems (no imports needed on the consumer side):

```ts
declare module '../core/game' { interface GameServices { inventory: InventoryApi } }
game.provide('inventory', this);                 // producer
game.services.inventory?.add('parsnip', 3);      // consumer
```

Useful hooks for gameplay teams:
- Maps expose `grid` (TileGrid), `terrain`, `plots` (named farm rects), `poi` (ambient-life anchors),
  `clearGroundCover(x, z)`; `grid.removeObject(x, z)` removes debris visuals via `onRemove`.
- Farming events: `item:use` → till / water / plant / scythe / pickaxe / axe; `day:start` grows watered crops;
  `crops:grow` (debug) advances all crops; `demo:stage` with `showcase: ['field']` plants the beauty-shot field.
- Player: `game.player.facingTile()`, `game.player.swing()`, `game.player.controllable`.
- Camera: `game.rc.rig` (`target`, `pitch`, `yaw`, `distance`, `addShake()`).
- UI: `game.hud.registerPanel('inventory', { open, close })`; `ui:open` events route to it. `__game.openUI(name)`
  logs a console error when no panel is registered (the shot harness and smoke test surface it).

## Debug API & URL params

`window.__game`: `setTime(h)`, `setDay(d)`, `setSeason(s)`, `setWeather(w)`, `teleport(map,x,z)`, `facing(dir)`,
`openUI(name)`, `give(item,qty)`, `setGold(n)`, `grow(days)`, `demo(name)`, `ready()`, `pause(bool)`,
plus `quality(q)`, `camera({yaw,pitch,distance,offsetX,offsetZ})`, `step(frames)`, `save/load(slot)`, `info()`, `demos`.
`info().perf` reports draw calls / triangles for the last frame (all passes) against the budget
(≤ 300 draw calls, ≤ 1.5 M triangles); `scripts/shot.mjs` prints a warning when a shot exceeds it.

URL: `?demo=farm-morning`, `?map=farm&x=30&z=20&time=18.5&season=fall&weather=rain&day=3&gold=900&facing=up&pause=1`,
`&ui=inventory`, `&quality=low|medium|high|ultra`, `&hud=0` (hide HUD), `&cam=yaw,pitch,dist[,offX,offZ]`, `&seed=abc`,
`&notitle=1` (accepted; the title screen is a UI-team deliverable).

Demos: `farm-morning`, `farm-noon`, `farm-evening`, `farm-night`, `farm-fall`, `farm-winter`, `farm-rain`, `farm-pond`,
`farm-field`, `winter-night` (+ DESIGN names `town-evening`, `beach-sunset`, `forest-rain`, `mine`, `festival`, which
stage on the farm until those maps exist).

## Screenshots

```bash
node scripts/shot.mjs --url "?demo=farm-morning" --out shots/farm-morning.png [--w 1920 --h 1080] [--wait 1500]
node scripts/shot.mjs --url "?demo=farm-night" --out shots/night.png --frames 6 --every 250    # sequence → night_000.png …
node scripts/shot.mjs --url "?time=10" --out shots/walk.png --hold "KeyD:800,KeyS:400"        # hold keys before capture
node scripts/shot.mjs --url "?demo=farm-field" --out shots/x.png --eval "__game.setTime(19)"   # run JS after ready
```

Each run starts its own Vite server on a free port (parallel-safe), uses headless Chromium with GPU (ANGLE/Metal)
and falls back to SwiftShader, awaits `__game.ready()`, prints console errors and exits non-zero on page errors.
`SHOT_VERBOSE=1` echoes page logs. Shots go in `shots/` (gitignored).
