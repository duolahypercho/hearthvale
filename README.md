# Hearthvale

An original cozy farming sim built as a stylized 3D "living diorama" in Three.js.
Design contract (art direction, scope, debug API): **[DESIGN.md](DESIGN.md)** — read it first.

## Run

```bash
npm install
npm run dev          # http://127.0.0.1:5173  (try /?demo=farm-morning)
npm run typecheck    # tsc --noEmit (strict)
npm run build        # typecheck + production bundle in dist/
npm run shot -- --url "?demo=farm-evening" --out shots/evening.png
```

Controls: **WASD / arrows** move (Shift runs) · **left click / C / Space** use tool ·
**right click / X / F** interact · **1–0** toolbar · **E** inventory · **Esc** menu.

## Architecture

```
src/
  main.ts                bootstrap only (creates Game, installs debug API, applies URL params)
  core/
    game.ts              Game context: services + SYSTEMS registry + fixed-step loop (60 Hz sim, per-frame render)
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
    worldfx.ts           applyWorldFx(material) — snow cover, rain wetness, moving cloud shadows
    patch.ts             composable onBeforeCompile patches
    uniforms.ts          globalUniforms shared by every patched shader (time, wind, night, snow, palette, sun…)
    particles.ts         SmokeEmitter (chimneys), Ambience (pollen, fireflies, falling leaves)
    shaders/noise.ts     GLSL hash/value noise/fbm/cloud-shadow helpers
  world/
    tiles.ts             TileGrid: type, flags (Blocked/Tillable/Tilled/Watered/…), height, TileObject per tile
    map.ts               GameMap interface + World (map registry / loader)
    terrain.ts           heightfield mesh + splat-blended ground shader (grass/path/tilled/wet/sand + triplanar cliffs)
    water.ts             depth-tinted animated water (foam, glints, caustics)
    grass.ts             chunked instanced grass with wind, player push, seasonal colour; clearTile(x,z)
    geom.ts              roundedBox, bevelCylinder, lumpySphere, AO baking, MeshBuilder (merge per material)
    farm.ts              the farm map (layout, paths, pond, house, debris, forest, dressing)
    props/               trees.ts (oak/maple/pine/blossom), nature.ts (rocks, weeds, bushes, flowers, reeds…),
                         structures.ts (farmhouse, shipping bin, mailbox, lantern post, fences, dock…), instanced.ts
  entities/player.ts     procedural chibi farmer rig: idle / walk / run / tool swing with squash & stretch; grid collision
  ui/                    hud.ts + hud.css (clock, date, weather/season, gold, toolbar, energy; panel registry), icons.ts
  systems/               gameplay systems go here (farming, tools, shipping, NPCs, fishing, …)
  data/                  pure data tables
scripts/shot.mjs         headless screenshot harness
```

### Rules of the road

- Siblings talk through `game.events` (typed) or the `Game` context — no deep cross-imports between `systems/*`.
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

Useful hooks for gameplay teams:
- Farm tiles: `const farm = game.world.current as FarmMap;` → `farm.grid` (TileGrid), `farm.terrain.setTileSplat(x, z, { tilled: 1, wet: 1 })` + `commitSplat()`, `farm.grass.clearTile(x, z)`, `farm.grid.removeObject(x, z)` (debris visuals removed via `onRemove`).
- Player: `game.player.facingTile()`, `game.player.swing()`, `game.player.controllable`.
- Camera: `game.rc.rig` (`target`, `pitch`, `yaw`, `distance`, `addShake()`).
- UI: `game.hud.registerPanel('inventory', { open, close })`; `ui:open` events route to it.

## Debug API & URL params

`window.__game`: `setTime(h)`, `setDay(d)`, `setSeason(s)`, `setWeather(w)`, `teleport(map,x,z)`, `facing(dir)`,
`openUI(name)`, `give(item,qty)`, `setGold(n)`, `grow(days)`, `demo(name)`, `ready()`, `pause(bool)`,
plus `quality(q)`, `camera({yaw,pitch,distance,offsetX,offsetZ})`, `step(frames)`, `save/load(slot)`, `info()`, `demos`.

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
