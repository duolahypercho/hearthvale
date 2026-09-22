# Hearthvale — Design Contract

An original cozy farming/life sim in the spirit of Stardew Valley, built in Three.js.
**Original IP only**: no Stardew names, characters, sprites, music, maps, or text. Same genre
pillars (farm, seasons, town, relationships, fishing, mining, crafting, story), our own world.

This file is the shared contract every contributor (human or agent) builds against.
Change it only deliberately, and keep it current when you do.

## Art direction — "living diorama"

Not pixel art. A hand-crafted **stylized 3D diorama** seen from a high 3/4 camera
(perspective, ~35° FOV, pitched ~50° down, gently following the player). Think
tilt-shift miniature + Ghibli color + modern cozy games (A Short Hike, Tunic, Animal Crossing NH).

- **Shapes**: chunky, rounded, slightly irregular. Bevel everything. No raw boxes with hard 90° edges
  unless intentional. Silhouettes readable at gameplay zoom.
- **Materials**: `MeshStandardMaterial`/custom toon-PBR hybrids with procedural canvas/shader textures
  (noise, wood grain, stone, soil clods, thatch). Vertex-color AO baked into procedural meshes.
- **Light**: warm key sun + cool sky fill (HemisphereLight) + soft PCF shadows sized to the view.
  Time of day drives sun angle/color, sky gradient, fog tint, and exposure.
- **Post**: EffectComposer chain — SSAO/GTAO (subtle), bloom (threshold high, for lamps/sun glints),
  tilt-shift/DOF blur at top & bottom edges, color grade (LUT-ish lift/gamma/gain per time of day),
  vignette, film grain (very light), SMAA/FXAA. Must be toggleable via a quality setting.
- **Life**: wind-swayed grass/crops/trees (vertex shader), drifting particles (pollen, leaves, snow,
  fireflies at night, rain streaks + splash), water with animated normals, shoreline foam, reflections
  of sky tint. Nothing in frame should ever be perfectly still.
- **Palette**: saturated but soft; seasons shift the whole palette (spring greens/pinks, summer
  deep greens/golds, fall oranges/reds, winter blue-white).
- **UI**: warm wood + parchment panels, rounded, soft drop shadows, crisp readable type
  (Google Fonts allowed: e.g. "Fredoka" for headers, "Nunito" for body). Icons drawn procedurally
  to canvas or inline SVG. Every panel animates in/out (ease-out-back, 150–250 ms).

## Tech

- Vite + TypeScript (strict) + `three` (latest) + `three/examples/jsm` (postprocessing, etc).
- No external asset downloads required at runtime. Everything procedural (geometry, textures,
  audio via WebAudio synthesis). Fonts via Google Fonts `<link>` are the only exception.
- 60 fps target on an M-series laptop at 1440p with "high" quality. Render budget per frame (all passes:
  shadow + main + AO): ≤ 300 draw calls, ≤ 1.5 M triangles — reported by `__game.info().perf`, warned by
  `scripts/shot.mjs`, enforced by `npm test`. Batch props by material (`BatchPool`), merge static meshes
  (`mergeStatic`), LOD distant trees/grass.
- Deterministic seeded RNG (`src/core/rng.ts`) for world generation.

## Source layout & ownership

```
src/
  main.ts                 bootstrap only
  core/                   engine loop, input, events (typed bus), rng, save/load, time/calendar, debug API
  render/                 renderer, post-processing, lighting/sky/day-night, materials & procedural textures, shaders
  world/                  tile grid, maps (farm, town, beach, forest, mine), terrain meshes, props, buildings, water
  entities/               player (procedural rig + animation), NPCs (rig, schedules, pathfinding), animals
  systems/                farming, items/inventory, tools, crafting, shipping/economy, fishing, mining/combat,
                          relationships & gifting, dialogue, quests/story, weather, seasons, audio
  ui/                     DOM/CSS overlay: title screen, HUD, toolbar, inventory, dialogue box, shop, menus
  data/                   pure data tables: items, crops, npcs, dialogue, recipes, fish, quests, story beats
scripts/shot.mjs          headless screenshot harness (see below)
```

Rule: a module talks to others via the typed event bus (`core/events.ts`) or through the
`Game` context object (`core/game.ts`, incl. typed `game.services`) — no imports between `systems/*`
siblings (`npm run lint` fails the build). When you add a system, register it in `core/game.ts` in one line.

## Debug / automation API (required — critics and tests depend on it)

`window.__game` exposes:

- `setTime(hour: number)` (6–26 range, 24+ = after midnight), `setDay(day)`, `setSeason('spring'|'summer'|'fall'|'winter')`
- `setWeather('sun'|'rain'|'storm'|'snow'|'wind')`
- `teleport(map: string, x: number, z: number)` and `facing(dir)`
- `openUI(name: string)` — e.g. 'inventory', 'shop', 'dialogue:<npcId>', 'title', 'fishing', 'crafting', 'map', 'none'
- `give(itemId, qty)`, `setGold(n)`, `grow(days)` advance crops
- `demo(name)` — stage a canned beauty scene, e.g. 'farm-morning', 'town-evening', 'town-day',
  'town-dialogue', 'festival', 'title', 'winter-night' ('beach-sunset', 'forest-rain', 'mine' fall back to
  the farm until those maps exist)
- `ready(): Promise<void>` resolves after world + shaders are compiled and a few frames rendered.
- `info().perf.bySystem` — draw calls / triangles per system tag (grass, trees, nature, props, terrain…)
  for the last frame, all passes. Tag your root with `userData.perfTag`.
- `pause(bool)` freezes simulation time (not rendering) for reproducible shots.

URL params mirror these: `?demo=farm-morning`, `?map=town&x=..&z=..&time=18.5&season=fall&weather=rain&ui=inventory&quality=high&notitle=1`.
A plain boot (no demo / map / ui params) opens the title screen.

## Screenshot harness

`node scripts/shot.mjs --url "?demo=farm-morning" --out shots/farm-morning.png [--w 1920 --h 1080] [--wait 1500]`

- Starts its own Vite dev server on a free port (safe to run many in parallel), opens headless
  Chromium via Playwright with GPU flags (`--use-angle=metal` / `--enable-gpu`, fallback swiftshader),
  awaits `__game.ready()`, waits `--wait` ms, writes PNG, prints console errors, exits non-zero on page errors.
- `--frames N --every ms` captures a sequence (for judging animation).

Critics judge from these PNGs. Put scratch shots in `shots/` (gitignored).

## Gameplay pillars (scope)

1. **Farming**: hoe → water can → seeds → daily growth stages (distinct meshes per stage) → harvest
   pop with particles; sprinklers; seasonal crops die at season end; scarecrow vs crows.
2. **Time & energy**: 10 in-game min per 7 real s; day 6:00→2:00; bed ends day with end-of-day
   shipping summary screen; energy bar; passing out penalty.
3. **Economy**: shipping bin, shop (seeds/tools upgrades), gold, prices by quality (normal/silver/gold star).
4. **Town & NPCs**: ~8 original villagers with personalities, schedules, portraits (procedural 2D
   portrait art on canvas or SVG), heart levels, gift tastes, birthdays, heart events.
5. **Story**: player inherits grandmother's overgrown farm in Hearthvale; the town's old
   "Lantern Hall" is dark — restoring it through bundles of seasonal goods relights the valley.
   Main questline + a villain-ish rival (a corporate "EverMart" style — keep it original: "Glimmerco").
6. **Fishing**: cast with power meter, bite, reel minigame (bar & fish), fish per location/season/time/weather.
7. **Mining**: procedurally generated floors, rocks with ores, ladder down, slimes with simple combat.
8. **Crafting**: recipes (chest, sprinkler, scarecrow, fence, path), placement grid preview.
9. **Animals** (stretch): coop/barn, chickens, cows.
10. **Festivals** (stretch): one per season.
11. **Audio**: procedural WebAudio — ambient bed per map/time/weather, footsteps per surface, tool SFX,
    UI clicks, a gentle generative music system (pentatonic, seasonal instrument timbres).
12. **Save/Load**: localStorage slots, autosave at end of day.

## Quality bar

Every feature is judged by a harsh visual critic against the genre benchmark. "Works" is not done.
Done = a blind side-by-side judge prefers our frame over a comparable Stardew Valley frame for
beauty, readability, and charm — and gameplay feels juicy (anticipation, squash/stretch, particles, sound).
