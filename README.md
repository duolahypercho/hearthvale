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
    post.ts              EffectComposer: GTAO → Bloom → Output → SMAA → tilt-shift → grade/vignette/grain; quality presets
    lighting.ts          DayNight: sun/moon, hemi, bounce, fog, sky dome, PMREM IBL, exposure + grade keyed by hour/season/weather
    textures.ts          procedural canvas textures (grass, dirt/path, soil, wet soil, stone, cliff, wood, bark, shingles, thatch, leaves, sand…)
    materials.ts         shared material library (+ nightGlow emissives driven by the rig)
    wind.ts              applyWind(material, opts) — world-space wind sway for any material (+ windDepthMaterial for shadows)
    worldfx.ts           applyWorldFx(material) — snow (drift normals, blue skylight, glints, path slush), wetness,
                         cloud shadows, golden-hour back-rim
    patch.ts             composable onBeforeCompile patches
    uniforms.ts          globalUniforms shared by every patched shader (time, wind, night, snow, palette, sun…)
    particles.ts         SmokeEmitter (chimneys), Ambience (pollen, fireflies, falling leaves), BurstFX (tool/harvest/sprinkler)
    precipitation.ts     GPU rain streaks + splash rings (terrain-height aware) + snowfall, camera-following volumes
    foliage.ts           applyPlantLighting(): two-sided leaf lighting, ambient floor, back-lit translucency
    shaders/noise.ts     GLSL hash/value noise/fbm/cloud-shadow helpers
  world/
    tiles.ts             TileGrid: type, flags (Blocked/Tillable/Tilled/Watered/…), height, TileObject per tile
    map.ts               GameMap interface + World (map registry / loader)
    terrain.ts           chunked heightfield + splat-blended ground shader (grass/path/tilled/wet/sand, triplanar cliffs,
                         seasonal rust patches, rain puddles with ripples + sky reflection)
    water.ts             depth-tinted animated water (foam, glints, caustics, rain ripples, winter ice)
    grass.ts             chunked instanced grass (1 draw/chunk, distance LOD), wind, player push, seasonal colour,
                         winter straw; clearTile(x,z)
    geom.ts              roundedBox, bevelCylinder, lumpySphere, AO baking, MeshBuilder, mergeStatic (props → 1 mesh/material)
    farm.ts              the farm map (layout, paths, pond, house, field + garden plots, yard dressing, POIs, forest)
    props/               instanced.ts  BatchPool/InstancedSet — THREE.BatchedMesh per material (multi-draw + per-instance culling)
                         trees.ts      oak/maple/pine/blossom, hero + forest LOD
                         nature.ts     sculpted rocks/pebbles, weeds (→ frozen twigs in winter), bushes (3-tone seasonal
                                       palette), flowers (fall mums), reeds, lilies, ferns…
                         structures.ts farmhouse, shipping bin, mailbox (waving flag), lantern post, fences, dock
                         farmkit.ts    scarecrow, sprinkler, wheelbarrow, hay, laundry line (wind cloth), bird bath,
                                       beehive, tool rack, bench, harvest displays, pots, signpost, trough, snowman…
                         crops.ts      9 crops × 5 growth stages, batched, wind + translucency
                         soil.ts       raised tilled-soil beds (furrows, clods, dry/watered materials, merged rims)
                         decals.ts     fall leaf litter, lamp light pools, winter footprints
  entities/              player.ts (chibi farmer rig: blink, weight shift, look-around, swing), critters.ts
                         (butterflies, songbirds, farm cat, chickens)
  ui/                    hud.ts + hud.css (clock, toolbar bound to the inventory, energy, toasts, panel registry),
                         inventory.ts (backpack panel), icons.ts (tools, seeds, produce, resources)
  systems/               season.ts, weather.ts (precipitation, lightning), inventory.ts, farming.ts, shipping.ts, critters.ts
  data/                  crops.ts, items.ts (pure data tables)
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
