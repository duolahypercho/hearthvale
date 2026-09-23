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
npm run perf         # pillar 14: every demo at 2560x1440 high, 3 s warmup + 8 s → avg fps / p95 / p99 / draws / tris,
                     #   shots/perf/latest.json + history.jsonl, FAIL (<60 fps or p99>25 ms) / REGR flags
                     #   (--demos a,b · --filter re · --profile 15 · --eval "<js>" A/B · --strict · see scripts/perf.mjs)
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
    town/                index.ts (map assembly, river, batched props) · layout.ts (buildings, streets, props, SPOTS) ·
                         buildings.ts (forge, inn, clinic, schoolhouse, cottages, bridges, stalls…) · pathfind.ts (A*)
    props/               instanced.ts (BatchPool/InstancedSet) · trees.ts · nature.ts (registry only) ·
                         rocks.ts (faceted, mossy, 3 tints) · debris.ts (chunky sticks, branches, stumps, logs, leaves) ·
                         flora.ts (weeds, ferns, bushes, flowers, reeds, ground cover) · structures.ts · farmkit.ts ·
                         homestead.ts · townkit.ts (townhouses, hall with lit interior cards, fountain, stalls, café,
                         flower cart) · festival.ts (catenary bunting, lantern poles, maypole, feast table, braziers) ·
                         crops.ts · soil.ts (wet mask, winter snow-in-furrows + husks) · decals.ts
  entities/              player.ts (chibi farmer), villager.ts (NPC rig: walk / idle / talk), critters.ts
  ui/                    hud.ts + hud.css (clock dial, toolbar, energy/health, toasts, fade, banner, screen router, focus nav,
                         gamepad) · kit.ts (Screen base, frames, tooltip, focus) · ui.css (all screens; UI zoomed to the
                         window via --uiz) · title.ts · inventory.ts (drag & drop, detail card) · shop.ts (per-keeper stock) ·
                         crafting.ts (iso placement preview, craft payoff → Backpack tab) · placement.ts (in-world ghost:
                         real colours + pulsing outline, dashed reach tiles, red ✕ where blocked) · dayend.ts + dayend-art.ts
                         (painted night valley, quiet-day vignette; `ui=dayend:quiet`) · mapscreen.ts + mapart.ts (watercolour
                         valley: paper grain, washes, fields, Poisson woods, villager heads, season palettes) ·
                         settings.ts (quality, volumes, UI size, reduce motion, 24h clock, key rebinding) · pause.ts (+ save
                         slots) · icons.ts (procedural SVG item icons; `registerItemIcon` for other teams) · itemtip.ts ·
                         demo-kit.ts (stocks the backpack for ui-* demos) · dialogue.ts · portraits.ts · fishing.ts · journal*
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
UI screens: `ui-title`, `ui-hud` (toasts), `ui-inventory`, `ui-shop`, `ui-shop-smith`, `ui-shop-carpenter`, `ui-crafting`,
`ui-placement` (in-world ghost), `ui-dayend`, `ui-dayend-quiet` (nothing shipped), `ui-map`, `ui-settings`, `ui-pause`, `ui-saves`, `ui-icons` (item almanac) — or
`?demo=<any>&ui=<screen>[:arg]` (e.g. `ui=shop:odessa`, `ui=saves:save`).

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

## Audio

Fully procedural WebAudio, no files: `src/audio/` is the engine (mixer + generated-IR convolution reverbs +
music-bus EQ + glue compressor / limiter, composer, synthesised instruments, ambience beds, SFX library) and
`src/systems/audio.ts` adapts it to game events.

- **The score** (`src/audio/themes.ts`): every song has a hand-written tune — scale degrees + rhythm per bar,
  an anacrusis into each A, an alternate final cadence — restated literally whenever A comes round, so the
  player learns it. `src/audio/composer.ts` arranges it: roman-numeral harmony with voice-led voicings,
  per-bar figuration variants, a fill every 4th bar (bass pickup runs, anticipations), drum fills into the
  final A, a stop-time (or 3/4 "breath") bar before B, section crescendi, a key lift in the title theme.
  The day seed only varies figuration and humanisation, never the tune. Themes: spring (flute + kalimba),
  summer (marimba + nylon guitar, glockenspiel on the repeats), fall (clarinet waltz + cello), winter (music
  box + celesta), town (ocarina + pizzicato), beach (steel pan + ukulele), forest (dorian whistle + harp, 6/8),
  inn (swing vibraphone over Rhodes comp, also the town square 17:30–20:00), night lullaby, rain lo-fi, mine / mine-ice / mine-lava
  (by floor band), festival jig + four festival arrangements, title.
- **Instruments** (`src/audio/instruments.ts`): mallets are modal notes pre-rendered once per pitch
  (kalimba tine inharmonics + buzz + box body, marimba, music box comb modes + case, celesta, glockenspiel,
  vibraphone with motor tremolo, hand bells, steel pan);
  plucked strings are Karplus-Strong with body modes baked in; bowed strings are detuned Helmholtz
  oscillators with bow noise and velocity-following tilt through generated body IRs; the pad is a
  five-voice drifting string ensemble with formant EQ. Shared LFOs, a buffer cache and a polyphony budget
  (72 voices, texture tracks dropped first) keep the per-note cost low.
- **Transitions** (`src/audio/music.ts`): never two keys at once — a mood change in the same place waits
  for the phrase to end, then fades ≤ 2.5 s; a change of place fades 1.4 s; the new song starts after.
  The director's recent decisions are in `__game.info().audio.trace`. Songs are composed in a Web Worker
  (`src/audio/compose.worker.ts` via `prefetch.ts`) while the previous one fades / the score rests, so a
  song start never costs a frame (`__game.info().audio.compose` counts worker hits vs main-thread misses).
- **In game**: a "now playing" card (`src/audio/nowplaying.ts`) engraves the first two bars of the new
  tune on a staff; the morning chime quotes the tune about to play, the first day of a season its hook.
- Hear it: `?demo=audio&theme=<id>` (`&theme=none` for ambience only, `&sfx=<name>` repeats an SFX every 2.5 s,
  `&audio=1` starts the context without a click where autoplay allows, `&card=1` pins the now-playing card,
  `&card=0` hides it). Any demo plays its own music after a click.
- From code: `game.services.audio.play('coin')`, `.music('festival' | null | 'none')`, `.state()`, `.meter()`;
  cutscenes use `{ do: 'cue', cue: 'music' | 'sfx', arg }`. `__game.info().audio` shows the live state.
- **Co-op / positional**: `audio.playAt(name, x, z, { map? })` pans along the camera's screen axis and fades
  with distance from the local farmer (inaudible sounds cost nothing), `audio.stepAt(x, z, { run? })` voices a
  remote farmer's footfall on the tile's surface, `audio.say(id, text, x?, z?)` speaks a chat line in
  sim-speak with a stable voice per id; SFX `join` / `leave` / `chat` and `emote:<kind>` exist for the net
  layer. `tool:impact` and `crop:harvested` are already placed at their tile, so a partner's replayed
  intents pan and fade by themselves. Hear it with `?demo=audio&coop=1` (a phantom partner circles you,
  stepping, hoeing, emoting and chatting).
- Judge it without speakers: `node scripts/audio-render.mjs` renders every theme (30 s), theme+ambience mixes,
  ambience presets, the SFX reel and three live-director handoffs (`transition-*.wav`, checked for overlap)
  through the real mixer with `OfflineAudioContext` into `shots/audio/*.wav` (+ piano-roll/spectrogram PNGs)
  and prints loudness (LUFS), true peak, clipping, silence, spectral centroid and band balance with flags
  (day themes fail as `DULL` under 7 % presence + air and are reported `mellow` under 12 %; see the calibration note in the script). `--describe <theme>` dumps the melody,
  `--stems --only <ids>` solos every track, `--live` boots the game and checks theme-per-scene, audible
  output, 20 beach⇄mine handoffs, the audio-node creation rate and SFX end to end.

## Town & villagers

Hearthvale town (`src/world/town/`): the plaza with its fountain and the Lantern Hall, Thimble & Pip's store,
The Hearth Oven bakery, the market row, the river with the Kettle Bridge and a rope footbridge, Flint & Ember
forge, The Copper Kettle inn, the Birch house + lumber yard, the lamplighter's cottage, and Meadow Lane in the
south (Willowmere Clinic, the schoolhouse with its bell cupola, the Pennywhistle cottage's kitchen garden, an
orchard). Street life: everyday festoon lights (`world/town/festoons.ts`: strings over the plaza, a zig-zag over the
market row, the inn terrace; on from dusk, coloured holiday bulbs in winter), songbirds, the town cat asleep on the
west plaza bench; winter adds shovelled cobble lanes with snow banks along their edges, drifts against every building
and snowmen (`world/town/winter.ts`).
Layout data lives in `world/town/layout.ts` (buildings, streets, props, trees, festoons, snowmen, named `SPOTS`).
Static props are merged per 12 m cell and fed to one `BatchPool`: one multi-draw per material, per-cell culling.

Ten villagers (`src/data/npcs.ts`): look (height, build, face, 11 hair styles, hats, outfits, accessories), walk
style, schedule + rainy schedule over named spots (A* on the tile grid, `world/town/pathfind.ts`; seven of them work the
square between 9 and 12), activities (sweep, read, paint, water, knead, hammer, saw, fish, sit, play, chat…), gift
tastes, birthday, dialogue groups (first meeting, birthday, season, weather, hours, hearts; `[mood]` tags swap the
portrait) and two heart events each (scripted mini cutscenes: walks, emotes, choices with friendship deltas, extra
actors such as Pip the shop cat).
- **Models** (`entities/villager.ts`, one skinned mesh each, frustum-culled): chibi heads (1.2×) tilted chin-up so
  faces read from the diorama camera, glossy eyes, an ink-edge + rim shader instead of an outline pass, 13 gesture
  clips (hand to chest, shrug, laugh, look down, point, wave, think, wring, surprise, stamp, nod, open arms, hug)
  that follow each line's mood, squash and stretch, emotes as AO-safe billboards.
- **Camera director** (`systems/npcs.ts`): heart events cut between wide, two-shot and close-up; the angle is
  scored so the speaker is three-quarter to the lens, the listener or a bystander isn't in front of their face and no
  building cuts a sight line (swing ±15–45°, raise, pull in), trees in the way are hidden (sphere-cached), and the
  actors sit above the dialogue box; tilt-shift focuses on them. `npcs.auditEvents(id?)` checks every talky beat of
  all 20 events. Conversations lean in the same way through the look offset (no cinematic, so co-op farmers stay
  visible). Friendship is per player (co-op farmhands keep their own), villagers run from the shared calendar.
- **Gifts**: the item arcs from the farmer's hands, the villager squashes and reacts (hug / open arms / shrug),
  hearts, sparkles or a grey puff burst over the head, and the new heart pops on the meter.
- `systems/relationships.ts` owns points / hearts / gifts (`meet()` for demo staging), `ui/dialogue.ts` the typewriter
  box (name tab, top-left layout-stable text, choices, gift ribbons, heart meter, birthday toast), the 'social' page and
  the 'portraits' model sheet; `ui/portraits.ts` paints the SVG portraits: nine moods, each with its own head / shoulder
  pose, hand gesture and colour temperature (warm gold joy, cool blue sorrow, red-rimmed anger), bezier hair locks,
  cel-shaded neck and two-tone cloth folds, per-villager backdrops.

Demos: `town-day` (closer social frame, held emotes), `town-evening` (19:05, lamps lit), `town-winter`, `town-rain`,
`town-east`, `town-south`, `town-cast`, `town-dialogue` (`&npc=<id>&mood=<mood>` · `&gift=<item>` · `&ask=1` ·
`&first=1` for the first meeting), `town-night-talk`, `town-heart-event` (`&event=<npc>-<2|4>&step=N`),
`town-portraits` (`&ui=portraits:<npc>` = all nine moods), `town-social`, `festival`.

## Driftsand Beach & fishing

Driftsand Beach (`src/world/beach/`) is reached from the east edge of the town square (the farm connects through
town; there is no direct farm-to-beach path). `ocean.ts` is the stylised sea (a depth gradient from the terrain height
texture, swash run-up that stays in sync with the wet band on the sand, breakers over the sandbar, broken
domain-warped foam lace, sparse whitecaps that sit on the crests, foam collars around the pier pilings, sun glints,
horizon haze, a far plane that continues the near grid's depth) and the still tide-pool water. `sand.ts` shades
the ground (wind ripples, a wet band, caustic filaments, the wrack-line tint, the rock shelf, pool floors).
`props.ts` builds the pier, the shack, the lighthouse, the rowboat, four driftwood silhouettes, the kelp and shell
wrack line, and the boat, campfire and sign vignettes. `shells.ts` handles the tide-line forageables (with contact
blots and star glints) and the tide-pool anemones. `life.ts` has the gulls, crabs and leaping fish.

Fishing (`systems/fishing.ts`, visuals in `world/beach/tackle.ts` + `fishmesh.ts`, UI in `ui/fishing*.ts`, data in
`data/fish.ts`) works on any map with water: the farm pond, the town river and the sea.
- Cast: hold use to charge the power meter (sweet spot at 90–100 %, MAX flash, a tick every 25 %). Aim at the pointer
  (for casts started with the mouse) or with the movement keys (8 directions); the farmer turns to face the aim. Max
  range grows with the fishing level and the rod.
- Bite: a "!" speech bubble, a splash crown with a spray column, the float dunked under, camera shake and a 60 ms
  hitstop. Press use in time to hook.
- Reel: bar-and-fish minigame (lift 3.6, gravity 3.0, velocity cap 2.0, bounce off both ends), progress starts at
  35 % with a 0.6 s grace period (2 s in practice), plus treasure chests. Quality comes from the time the fish spent
  inside the bar, a perfect fight, the perfect-catch streak, the cast and the skill. It is not a dice roll.
- Progression: fishing XP per catch (difficulty-weighted, ×1.5 for a perfect fight), levels 0–10 (a taller bar and
  longer casts). **Bait** is used up one per cast and halves the wait. **Tackle** works while carried and wears out
  after 20 catches: the Cork Bobber makes the bar taller and the Glimmer Lure makes treasure more likely. **Rod tiers**
  are Bamboo, Fiberglass and Iridium. Buy all of these at the shack's Bait & Tackle honesty box (interact at the
  porch, or `openUI('tackle')`).
- Service: `game.services.fishing` → `state()`, `available()`, `cast(power)`, `level()`, `xp()`, `rodTier()`,
  `upgradeRod(t)`, `records()`. Events: `fishing:cast|bite|hook|catch|escape|level`.

Demos: `beach-day`, `beach-sunset` (a line in the water at dusk), `beach-night`, `beach-tidepools`, `beach-tackle` (the honesty box),
`fishing-cast`, `fishing-flight` (the cast arc in the air), `fishing-wait`, `fishing-bite`, `fishing-reel`, `fishing-catch`,
`fishing-pond`, `fishing-river`. Fishing demos take `&fish=<fishId>` and `&phase=cast|flight|wait|bite|reel|catch`.
`openUI('fishing')` starts a practice fight on the spot.

## Farming

`systems/farming.ts` runs the loop (hoe → water → sow → grow → harvest) and its game feel; visuals live in
`world/props/` (`soil.ts` lofted furrow mounds + torn sod lips + sub-tile wet flood — dry soil is pale, warm and
crazed with hairline cracks, wet soil dark, cool and glossy; `crops.ts` 18 crops × 6 stages with soft-plant light
(wrap + sun transmission + rim), giant crops on a heaved soil berm with radiating vines (fractal-floret giant
cauliflower cupped by ribbed leaves), crow-eaten stubs, produce crates; `farmfx.ts` clods / torn-sod blades / can
stream (tapered camera-facing ribbon + 2 side jets, droplets, splash crowns with ripple rings) / dusty slam stamps /
dust walls / harvest pop + 3D quality star / swing smear / sprinkler mist / scarecrow radius; `tilecursor.ts`
corner-bracket cursor, `tools.ts` tiered tool meshes, `crows.ts`), poses in `entities/farmer-actions.ts`.
Tilling culls grass tufts and ground cover overhanging the tile (`grass.clearTile` margin, farm `clearGroundCover`).

- **Mechanics**: seeded rolls (`game.rng.fork('farming')`); farming XP + level 0–10 (`farming.level()`, `farming:xp`,
  `farming:level`); quality = skill + fertilizer + care (1 % gold at level 0 without fertilizer); `fertilizer` /
  `qualityFertilizer` items; greenhouse ground (`farming.setGreenhouse(rect)`, or a `greenhouse` plot on the map)
  ignores seasons; energy may run to −15 (farmer trudges, sweats) then passes out; charged slams are refused at 0
  (`tool:refused`, `energy:refused`); missed swings cost 1.
- **Harvest feel**: yank (crouch → spring) → the produce arcs into the raised right hand, lands with a squash
  (1.25 / 0.8 → 1, ease-out-back), is held up ~0.4 s with a rim-lit presenting sway while a bevelled 4-point quality
  star spins in beside it (0 → 1.3 → 1, emissive → bloom, twinkles), then its icon flies to the toolbar slot (460 ms,
  1.15 slot bounce). Co-op: another farmer's harvest (`harvest(x, z, 'instant')`) pops the produce in place over the tile.
- **Events for audio**: `tool:swing` / `tool:impact` (impact frame) / `tool:charge` / `tool:refused`, `can:refill` /
  `can:empty`, `soil:tilled` / `soil:watered` / `soil:fertilized`, `crop:planted` / `crop:harvested` / `crop:withered` /
  `crop:giant`, `crow:arrive` / `crow:eat`, `sprinkler:spray`, `harvest:collect`, `energy:exhausted` / `energy:passout`.
- **Demos**: `farm-harvest` (summer hero field, farmer mid-harvest holding a melon with a gold star; `&act=none` for an
  empty-handed field, `&crop=<id>`), `farm-harvest-fall` (pumpkin), `farm-harvest&season=spring` (cauliflower),
  `farm-giant`, `farm-crops` (gallery: every crop × stage, `&crops=melon,pumpkin`, `&season=`), `farm-tools` (hoe,
  side-on, frozen just after impact), `farm-water`, `farm-pop` (produce held up with a gold star; `&quality=0..3`),
  `farm-slam` (tier-3 charged hoe), `farm-crows` (a raid in progress: crows pecking, feathers, a chewed stub;
  `&raid=fly` = crows flying in), `farm-wither`, `farm-field`.
  Params: `&tool=hoe|wateringCan|scythe|axe|pickaxe|sow|harvest|charge`, `&pose=<s>` freezes the action at s seconds
  (`__game.game.services.farming.scrub(t)` advances a frozen pose), `&loop=<tool>` repeats the action,
  `&slow=0.25` slow motion (so `--frames 8 --every 80` spans a whole swing), `&tier=0..3`.
  e.g. `node scripts/shot.mjs --url "?demo=farm-tools&loop=hoe&slow=0.3" --frames 8 --every 80 --out shots/hoe.png`.

## Story, quests & the Lantern Hall

"The Lanterns of Hearthvale" (data in `src/data/story.ts`, `story-scenes.ts`, `bundles.ts`, `quests.ts`): Gran Rosalind's
letter read on the rainy evening coach, Mayor Hollis meeting you at the stop with a lantern, the overgrown farm by
lantern light, the first night at her kitchen table. The Lantern Hall at the top of the square is dark: six rooms
(Seed · Sun · Harvest · Hearth · Crafter's · Tide), each with bundles of seasonal goods. Filling a room relights its
lantern (celebration cutscene: ignition, glowmoths, the room's dressing swaps from dust sheets to rugs, festoons and
baskets) and restores something in the valley (blossom arch, market day, the harvest-lantern lane, the Hall chimney,
flower baskets, glowing koi). Glimmerco's Sterling Vance surveys the Hall, leans on Marigold's shop, then makes an
offer on the Hall steps at three rooms — sign (+5,000 g, EverGlow white Hall, three villagers cool on you) or refuse
(his kiosk packs up; after the Hall is lit by hand he returns, redeemed). Winter 28's Lantern Festival lights the
whole valley. Gran's sealed letters, villager mail and Glimmerco flyers arrive in the farm mailbox; daily Help
Wanted notes are pinned to the board in the square.

- Systems: `systems/story.ts` (flags, mail, beats), `systems/quests.ts` (bundles + Help Wanted), `systems/cutscene.ts`
  (camera keys + Catmull-Rom rails, letterbox, fades, captions, actors walk / face / emote / hold props, dialogue +
  choices, `cue`s for world beats; Esc twice skips), `systems/story-hall.ts` (the Hall interior), `systems/story-world.ts`
  (coach, Hall landmark, valley restorations, Glimmerco kiosk / van). UI: `ui/journal*.ts` (journal J, bundle altar,
  notice board, letter reader, cinema overlay + painted coach window).
- Services: `story`, `letters`, `quests`, `cutscene` (`play`, `stage(scene, mark)`, `skip`, `audit()`).
- Co-op (host-authoritative; the net layer drives it): `story.setRole('host'|'guest')`; the host authors every beat
  (`story:scene` → guests `story.playRemote(scene)`, which returns the farmhand to where they stood), picks the moral
  choice (guests see it locked, `story:choice` → `cutscene.resolveRemoteChoice(i)`), and owns the shared state
  (`story:dirty` once a frame → `story.netState()` / `applyNetState()`: flags, mail, bundles, board). Farmhand hand-ins
  reach the host as `quests.contributeRemote / contributeGoldRemote / deliverRemote`. Co-op avatars (`remote-farmer`)
  and ambient villagers who would twin a cast member or block the lens step aside while a scene plays.
- Perf: the Hall's showing room dressings + bundle sacks are merged per material (`hall-dressing`, ~25 draws for all
  six rooms); cutscene tree occlusion tests cached canopy spheres every third frame (no per-frame raycasts).
- Demos: `intro-letter`, `intro-establish`, `intro-arrival`, `intro-farm`, `intro-night`, `lantern-hall-dark`,
  `lantern-hall-restored`, `lantern-room-lit`, `lantern-room-reveal` (`&room=seed|sun|harvest|hearth|craft|tide`),
  `bundle-ui` (or `ui=bundles:<room>`), `journal` (`ui=journal:quests|hall|letters`), `help-board`, `glimmer-kiosk`,
  `glimmer-survey`, `glimmer-marigold`, `glimmer-offer` (the choice), `glimmer-accept`, `glimmer-town`,
  `lantern-hall-glimmer`, `sterling-redeem`, `lantern-festival`, `lantern-festival-sky`. `&lit=N` sets rooms lit;
  `&coop=guest` stages a scene as a farmhand sees it (e.g. `?demo=glimmer-offer&coop=guest`: the choice, locked).

## Seasonal festivals

Four festival days, each a transformed map built lazily on first visit (`world/festivals/*`, system
`systems/festivals.ts`, data `data/festivals.ts`): **Blossom Parade** (spring: flower floats along the avenue, petal
storm, blossom-pole ribbon dance with a partner you choose), **Tide Lantern Night** (summer: lanterns on the bay,
fireworks over the water, bioluminescent surf + plankton drifts, boat wake rings), **Harvest Fair** (fall: stalls,
giant-produce judging with rosettes, sack race on a limed lane, corn maze), **Starfall** (winter: snowbound square,
the Great Fir, frozen-river skating under lantern reflections, gift circle, aurora). One GPU-posed crowd mesh per map
(festival outfits, 19 clips), one-draw fx (petals, lanterns, fireworks, snow, aurora).

- Mini-games (`world/festivals/games.ts`): Ribbon Dance, Lantern Release, Sack Race, Produce Judging, Gift Exchange,
  Starlight Skate. `openUI('festival:<activity>')` starts one on its map; while paused (demos) it plays itself.
- Events: `festival:start` / `festival:end`, `festival:music` (tempo / mode / timbre hints), `festival:minigame`,
  `festival:score` (co-op relay payload).
- Co-op: `festivals.record(activity, score)` takes a peer's relayed `festival:score` (player `'local'` = this browser;
  the net layer stamps its peer id); the result card ranks every farmer who played today once more than one has a
  score. `festivals.snapshot()` / `applySnapshot()` hand the festival day (done activities + boards) to a joiner.
- Demos: `fest-spring`, `fest-summer`, `fest-fall`, `fest-winter`, `fest-winter-night`, and the mini-games
  `fest-spring-dance`, `fest-summer-lanterns`, `fest-fall-race`, `fest-fall-judging`, `fest-winter-gifts`,
  `fest-winter-skate`. `&result=1` ends on the result card; `&coop=1` adds two visiting farmers to its board.

## Farm buildings, interiors & animals

Enterable dollhouse interiors (`world/interiors/*`: `house.ts` grandmother's farmhouse — quilted bed, stone hearth with
animated fire + embers + glow, kitchen, braided rug, shelves, family photos, window light shafts + dust; `coop.ts`,
`barn.ts`, shared `room.ts` shell / light profile, `lighting.ts` indoor light rig, `pen.ts` straw / hay / lantern kit).
Farm structures + carpenter's board (`world/buildings/*`): coop and barn are ordered at the board by the farmhouse
(gold + wood + stone), stand as a staked site overnight, and are finished next morning. Animals
(`entities/animals*.ts`, `systems/animals.ts`): chickens, ducks, cows, goats, sheep, pigs + the family dog or cat —
one skinned mesh each (idle / walk / eat / sleep / sit / happy hop), petting hearts, hay troughs, eggs / milk / wool /
truffles with quality from friendship + mood, pasture on fine days, pet bowl + kennel (hearth-side at night).
Sleeping in the farmhouse bed ends the day (`systems/sleep.ts`; `sleep:summary`, animals add `animals:summary`).

- Co-op (host-authoritative): `animals.setAuthority(false)` / `buildings.setAuthority(false)` on a farmhand. Farmhand
  actions leave as `animals:intent` / `buildings:intent` → host `applyIntent(peer, intent)`; collected items come back
  as `animals:grant` / `buildings:grant` → farmhand `receiveGrant(items)`. Shared state: host `animals:changed` /
  `buildings:changed` → `snapshot()` → farmhand `applySnapshot()`. Herd poses (same map as the host): host
  `animals.poses()` at ~4 Hz → farmhand `animals.applyPoses()`.
- Demos: `house-interior`, `house-night`, `coop-interior`, `coop-night`, `coop-dawn`, `barn-interior`, `barn-night`,
  `animals-pasture`, `animals-gallery` (every species + coat), `pet-yard`, `carpenter`, `carpenter-animals`.
  `&pet=dog|cat` picks the pet, `&hearts=0` stops the staged petting hearts, `&petted=1` pre-marks today's petting.

## Co-op multiplayer (1–4 farmers)

```bash
npm run server        # relay + lobby server on ws://<host>:8787/ws (also serves dist/ after npm run build)
npm run dev           # then Title → Co-op → "New farm" / "My saved farm" (host) or type the 6-letter code (join)
npm run mp-test       # e2e: relay + Vite + 3 headless clients; screenshots + results in shots/mp/
```

Friends on other machines open the game from the host's address; the relay defaults to the page's host on port
8787 (`?server=ws://host:port/ws` or the Co-op screen's "Server" field overrides it). Mid-game: Pause → Co-op →
"Open farm to co-op". URL shortcuts: `?coop=host&name=Ann`, `?join=ABC123&name=Bob&preset=0..2`.

- **Topology** (`server/`, no dependencies): a tiny Node WebSocket relay (`ws.mjs` is a hand-rolled RFC 6455
  implementation) with lobbies, 6-char invite codes, 4 slots, rejoin tokens (a dropped farmhand keeps its slot for
  2 min; a dropped host gets 20 s) and heartbeats. It never parses game traffic (`R<to>|payload` → `M<from>|payload`),
  so it doubles as a signaling channel for a later WebRTC upgrade.
- **Host-authoritative** (`src/net/system.ts`): the host's browser runs the simulation. Farmhands send intents
  (`use` tool/seed, `act` harvest, `gold`, `chat`, `emo`, `bed`, `look`) and their own movement at 20 Hz; the host
  validates (reach, speed in the sender's clock, blocked tiles, rate) and applies them through the farming system's
  normal `item:use` path (`net/farmsync.ts` runs it "as another farmer": our farmer parked, their energy/XP/loot
  routed to them, toasts swallowed), then broadcasts 20 Hz snapshots, `did` events (replayed with full FX on every
  other client at the swing's impact frame), per-tile farm deltas (≤ 5 Hz, only when something changed), calendar,
  weather and the shared purse. Every morning (and on join/rejoin) farmhands get the whole farm (`full`).
- **Prediction + reconciliation**: a farmhand's own swings, seeds and harvests play instantly (full juice); the
  host's `ack` carries the authoritative state of the touched tiles, a 2.5 s drift check fixes anything else, and
  predicted loot is dropped in favour of the host's `give`. Movement is predicted; the host's `fix` is reconciled
  against the position history and bled in over ~150 ms. Remote farmers are interpolated 100 ms behind the freshest
  sample (clock offset = min observed delay), with brief extrapolation.
- **Shared**: farm tiles, crops, debris, sprinklers, gold, calendar, weather (plus, through `net/bridge.ts`, the
  animals / buildings / story / Hall pods' own co-op hooks and fishing's host rolls). **Per player**: backpack,
  energy, skills, relationships (each farmhand's own systems; the host keeps a copy for rejoins).
- **Farmers** (`entities/remote-farmer.ts`): one skinned mesh per farmer (1 draw + 1 shadow), the same shapes and
  the same FarmerActions tool poses as the local farmer; 6 hair styles, 5 hats, skin / hair / shirt / overalls /
  kerchief / hat colours (`entities/remote-look.ts`). A custom look re-skins the local farmer too (bound to the
  Player's own rig groups). Emote bubbles are 3D sprites (`remote-emotes.ts`), name tags / chat bubbles are DOM.
- **UI** (`ui/coop.ts`): Title → Co-op screen (character creator with a live turntable, Host / Join by code,
  lobby with invite-code tiles, 4 slots, ping bars), roster plate (top-left), chat (**T**), emote wheel (hold **G**,
  1–8), join/leave toasts, bedtime overlay ("waiting for 2 farmers"), a Co-op card in the pause menu.
- **Day end**: the bed (farmhouse) or your cabin door marks you ready; the day ends when everyone is in bed.
  Cabins (`net/cabins.ts`, one merged builder: ~6 draws for all three) appear on the farm for each farmhand.
- **Perf**: 3 remote farmers cost ~17 draws (skinned body + shadow + blob + held tool + bubble); net work is a few
  small JSON messages per frame; farm digests only when dirty. `__game.game.services.net.stats()` reports fps /
  frame-time percentiles, RTT, bytes and reconcile counters.
- Demos: `coop-farm` (host view: three scripted farmhands hoeing, watering and chatting, their cabins, tags,
  roster), `coop-lobby` (creator + lobby). Debug: `services.net` (`host()`, `join(code)`, `players()`, `stats()`,
  `simulateDrop()`), `services.net.sync.digest()` (the per-tile farm state that must match on every client).

## Cindergrove forest, weather & seasons

Cindergrove (`src/world/forest/`) is south of the farm (warp at the farm's south gate). `layout.ts` holds the anchors
and terrain shape; `giants.ts` the old-growth elders / firs (painted leaf-card canopies, winter twig crowns, laden
firs) and card shrubs; `cliffs.ts` the waterfall cliff (a sculpted wall mesh over the plateau face + shared strata
shader); `props.ts` mossy logs, mushrooms, winterberries / twigs, the Ember Shrine (menhir ring, ember altar) and
the roofed glade tower (door, lit window, ivy); `stream.ts` the waterfall and flow; `forage.ts` seasonal
forageables (interact to pick, `forage:picked`); `motes.ts` dust motes in the light shafts; `foliage.ts` the card
textures, billboard / painted-light patches and the canopy see-through (trunks and logs always stay solid).

Weather (`systems/weather.ts`, visuals in `render/precipitation.ts`, `skyfx.ts`, `groundfx.ts`, `heightfog.ts`,
grade in `render/lighting.ts`): rain + splashes + eave / canopy drips, island puddles with a meniscus on darker soaked
paths (`world/terrain.ts`), storms (screen-space forked bolts, ~+2.5 EV return stroke, `weather:lightning` then a
delayed `weather:thunder`, scorch + steam), snow (flakes, top-facing accumulation via `render/worldfx.ts`, drifts,
sastrugi, boot prints), wind gusts of leaves / petals, ground-hugging fog mornings with god rays, rainbows.
`game.services.weather`: `strike(at?, hold?)`, `setFog(v|null)`, `setRainbow(v|null)`, `state()`.

Demos: `forest-day`, `forest-rain`, `forest-fall`, `forest-glade`, `forest-night`, `forest-wind`, `storm`, `snow-day`,
`fog-morning`, `rainbow`, `farm-storm`. Params: `&bolt=0|1` (posed strike), `&fog=0..1`, `&rainbow=0..1`.
