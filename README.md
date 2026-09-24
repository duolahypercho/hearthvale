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
                         settings.ts (quality + live fps, fullscreen, frame limit 30/60/vsync, FPS chip, volumes, UI size, reduce
                         motion, 24h clock, key rebinding) · pause.ts (+ save slots with real world snapshots, overwrite / delete
                         confirms) · newgame.ts (New Journal: in-world character creator — name, farm, look via the co-op profile,
                         pet, journal slot) · profile.ts (journal: name / farm / pet / slot, saved per slot) · menutabs.ts (one
                         fixed 1140×690 game-menu frame; tab swaps cross-fade the page only) · `place:<item>` panel · icons.ts (procedural SVG item icons; `registerItemIcon` for other teams) · itemtip.ts ·
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
`openUI(name)`, `give(item,qty)`, `setGold(n)`, `setEnergy(n)`, `setHealth(n)`, `grow(days)`, `demo(name)`, `ready()`, `pause(bool)`,
plus `quality(q)`, `camera({yaw,pitch,distance,offsetX,offsetZ})`, `step(frames)`, `save/load(slot)`, `info()`, `demos`.
`info().perf` reports draw calls / triangles for the last frame (all passes) against the budget
(≤ 300 draw calls, ≤ 1.5 M triangles); `scripts/shot.mjs` prints a warning when a shot exceeds it.
It also carries `lights` (point lights in the scene / handed to the renderer) and `adaptive` (governor state).

Render-engine perf rules (pillar 14, `src/render/`): BatchedMesh keeps a draw list per camera and only re-uploads it
when it changes (`batching.ts`); at most `preset.pointLights` point lights (high: 8) shade each frame, the most
important in view, cross-faded, constant count so no recompiles (`lightbudget.ts`); objects whose shaders aren't
compiled yet are held back a frame or two and compiled off-thread (`shadergate.ts`), compiled programs are never
evicted, map warps compile behind the fade; GTAO runs at half res; pausing menus refresh the world at 20 Hz; the
adaptive governor (`governor.ts`) sheds GTAO → bloom → shadow res → render scale when the 1 s average runs over
16.7 ms and restores them with back-off (off under automation; `?adaptive=1|0` to force).

URL: `?demo=farm-morning`, `?map=farm&x=30&z=20&time=18.5&season=fall&weather=rain&day=3&gold=900&facing=up&pause=1`,
`&ui=inventory`, `&quality=low|medium|high|ultra`, `&hud=0` (hide HUD), `&cam=yaw,pitch,dist[,offX,offZ]`, `&seed=abc`,
`&notitle=1` (accepted; the title screen is a UI-team deliverable).

Demos: `farm-morning`, `farm-noon`, `farm-evening`, `farm-night`, `farm-fall`, `farm-winter`, `farm-rain`, `farm-pond`,
`farm-field`, `winter-night` (+ DESIGN names `town-evening`, `beach-sunset`, `forest-rain`, `mine`, `festival`, which
stage on the farm until those maps exist).
UI screens: `ui-title`, `ui-hud` (toasts), `ui-inventory`, `ui-shop`, `ui-shop-smith`, `ui-shop-carpenter`, `ui-crafting`,
`ui-placement` (in-world ghost), `ui-dayend`, `ui-dayend-quiet` (nothing shipped), `ui-map`, `ui-settings`, `ui-pause`, `ui-saves`, `ui-icons` (item almanac),
`ui-newgame` (New Journal creator; `ui=newgame:demo` pre-filled), `ui-hud-low` (both tubes low + red heartbeat vignette; any demo takes
`&energy=0.1&health=0.2`), `ui-coop` (co-op lobby from the title) — or
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
  The day seed only varies figuration and humanisation, never the tune. Songs run intro · A · A · B · A ·
  C (a bridge in a new harmonic area, often handed to another voice) · A · outro, 2–3 minutes each; the
  counter-line answers the tune (it moves on the beats where the melody holds or rests, in contrary motion)
  and 'always' pads sit out the first A and thin to two voices in the later ones.
  **Three songs per season** (`themes.ts` + `src/audio/songbook.ts`), rotated by `select.ts` playlists
  (`farm:<season>`: day-seeded, never the same opener two days running, never the same song twice in a row):
  spring — First Furrow (flute + kalimba, 4/4), Clover Lane (kalimba jig, 6/8), Apple Blossom Waltz (ocarina,
  3/4); summer — Long Light (marimba + nylon guitar), Porch Swing (fiddle waltz), Lemonade Afternoon (bossa
  nylon-guitar lead); fall — Amber Waltz (clarinet, cello bridge), Cider & Candle (cello hymn, 4/4), Woodsmoke
  (oboe, 6/8); winter — Hush of Snow (music box), Frostglass (celesta + harp rolls, bell bridge), Hearthside
  (low flute over a music-box figure, 6/8). Nights (`night:<season>`): Lamplight, Dew at Dusk, Owl Hour,
  Snowlight Lullaby. Plus town (ocarina + pizzicato), beach (steel pan + ukulele), forest (dorian whistle + harp,
  6/8), inn (swing vibraphone over Rhodes comp, also the town square 17:30–20:00), rain lo-fi, mine / mine-ice /
  mine-lava (by floor band), festival jig + four festival arrangements, title.
- **Instruments** (`src/audio/instruments.ts`): mallets are modal notes pre-rendered once per pitch
  (kalimba tine inharmonics + buzz + box body, marimba, music box comb modes + case, celesta, glockenspiel,
  vibraphone with motor tremolo, hand bells, steel pan);
  plucked strings are Karplus-Strong with body modes baked in; winds (flute, whistle, ocarina, clarinet, oboe)
  crossfade a soft and a bright spectrum by velocity, register and the note's own swell (the clarinet's even
  harmonics only arrive when it is pushed), with a random-walk pitch drift of a few cents, vibrato that deepens
  on held notes, a messa di voce on long notes and breath as noise through a resonant band tracking the pitch;
  bowed strings are detuned Helmholtz
  oscillators with bow noise and velocity-following tilt through generated body IRs; the pad is a
  five-voice drifting string ensemble with formant EQ. Shared LFOs, a buffer cache and a polyphony budget
  (72 voices, texture tracks dropped first) keep the per-note cost low.
- **Transitions** (`src/audio/music.ts`): crossfades with a key bridge — a change of place fades the old song
  over 1.3 s while the new one opens on a bar of its tonic chord built only from tones both keys share; a mood
  change in the same place waits for the phrase to end first (2.5 s fade). No dead air, no clashing keys.
  The director's recent decisions are in `__game.info().audio.trace`. Songs are composed in a Web Worker
  (`src/audio/compose.worker.ts` via `prefetch.ts`): the opening song is requested as the save loads (before
  the first click), forced demo / cutscene themes on request, the next song while the old fades — and in real
  time a song is never composed on the main thread (`__game.info().audio.compose`: worker hits vs misses).
- **In game**: a "now playing" card (`src/audio/nowplaying.ts`) engraves the first two bars of the new
  tune on a staff, and little notes float out of it into the scene in time with the melody while it is up;
  the morning chime quotes the tune about to play, the first day of a season its hook.
- **Ambience**: every bed is decorrelated stereo noise (L/R correlation ~0.3); rain is a 4–6 kHz hiss plus
  two looping droplet textures (45 / 110 drops/s, 2–8 kHz pings and the odd puddle plink, spread across the
  field); surf swells travel from one side to the other.
- **Mix**: gameplay verbs (hoe, watering with its soil splash, footsteps with a 2–4 kHz scuff, scythe) peak
  around -18…-22 dBFS in game, menu cues -24…-28, ambience events at or below -30; the music bus cuts 280 Hz,
  lifts 3.2 kHz / 7 kHz, harmony tracks lose 2.5 dB at 320 Hz and the melody gets a 9 kHz air shelf.
- Hear it: `?demo=audio&theme=<id>` (also `audio-summer` / `audio-fall` / `audio-winter`; `theme` takes a song id or a
  playlist like `farm:fall`; `&theme=none` for ambience only, `&sfx=<name>` repeats an SFX every 2.5 s,
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
wrack line, and the boat, campfire and sign vignettes. The pier's rail rope has its own material (`railRopeMaterial`)
that dithers itself out in a capsule round every farmer on the deck (local + remote, `setRailAvoid`), the west rail is
unhooked at the walkway fishing spot (`PIER_FISH_GAP`, toe board + ropes hung back on their posts), and the bracing runs
pile-to-pile above the swell. `clusters.ts` dresses the open sand (net drying rack, lobster-pot stack, fenced dune-grass
islands, `BEACH_CLUSTERS`); a second, sparser tide line of shells and kelp runs along the wet band; crabs are
Poisson-scattered (≥ 2.5 m); the headland has a sandy track to the lighthouse door, thrift cushions and a wind-burnt
rim. Flotsam comes in four kinds (plank, bleached branch, bottle, kelp raft), each sized and turned its own way, kept
out of the walkway cast corridor. At night the dry sand keeps a moonlit value, the shallows darken, the surf edge
glows faintly (bioluminescence) and the moon's glitter road runs up the sea ahead of the camera. `shells.ts` handles the tide-line forageables (with contact
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
- Catch: the held fish is sized from the rolled length (species base × length / median, 0.7-1.8×); a fish ≥ 1.1 m
  held is a trophy (arms wide, a camera push-in, a drum-roll fanfare). The collection record is written the moment the
  fish lands (the card's NEW / RECORD badge comes from that write). The line is a verlet rope with a bending constraint
  and a water floor with friction. Casting right at the pier rail steps the farmer 0.42 m inboard first.
- Service: `game.services.fishing` → `state()`, `available()`, `cast(power)`, `level()`, `xp()`, `rodTier()`,
  `upgradeRod(t)`, `records()`. Events: `fishing:cast|bite|hook|catch|escape|level`.

Demos: `beach-day`, `beach-sunset` (a line in the water at dusk), `beach-night`, `beach-tidepools`, `beach-tackle` (the honesty box),
`fishing-cast`, `fishing-flight` (the cast arc in the air), `fishing-wait`, `fishing-bite`, `fishing-reel`, `fishing-catch`,
`fishing-pond`, `fishing-river`. Fishing demos take `&fish=<fishId>` and `&phase=cast|flight|wait|bite|reel|catch`;
`fishing-catch` also takes `&size=<0..1>` (where in the species' size range the catch lands, default 0.78).
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
letter read on the rainy evening coach, the coach pulling into Hearthvale at dusk (a low three-quarter crane from the
north verge, lamps on, road dust) where Mayor Hollis waits with a lantern, the overgrown farm by lantern light, the first
night at her kitchen table. The Lantern Hall at the top of the square is dark: six rooms (Seed · Sun · Harvest · Hearth ·
Crafter's · Tide), 26 bundles. Filling a room relights its lantern (celebration cutscene: ignition, glowmoths, the room's
dressing swaps from derelict to restored) and restores something in the valley (blossom arch, market day, the
harvest-lantern lane, the Hall chimney, flower baskets, glowing koi). Glimmerco's Sterling Vance surveys the Hall, leans on
Marigold's shop, then — after Kit confides that the charter would reopen the old mill and bring his dad home from the city —
makes an offer on the Hall steps at three rooms with three answers: **sign** (+5,000 g, EverGlow white Hall, three villagers
cool on you), **ask for time** (a wager: four rooms lit by hand within 28 days → Sterling tears the charter up in public;
miss it → he returns with 8,000 g and one last choice) or **refuse** (his kiosk packs up; after the Hall is lit by hand he
returns, redeemed). Each answer brings three follow-up letters and changes what Marigold, Bram, Hazel, Kit and Odessa say
to you. Winter 28's Lantern Festival lights the whole valley: the speech on the steps, sky lanterns over the Hall, then a
crane out along the west lane as its lanterns light outward from the Hall in groups (0.15 s apart), ending behind the farmer
and friends. Gran's sealed letters, villager mail and Glimmerco flyers arrive in the farm mailbox; daily Help Wanted notes
are pinned to the board in the square.

- Bundles (`data/bundles.ts`): pick-N-of-M slots (`pick`, "any 4 of 6"), minimum produce quality (`quality`: silver /
  gold star — `quests.offerable()` only counts qualifying stacks), cross-system asks (forest forage per season, the mine's
  ores and gems, barn and coop produce, pond / river / sea fish, beachcombing), grinds capped at 30–50. Rewards unlock
  things: sprinkler tiers, fertiliser, tackle, chests, and standing perks (`reward.perk`: the Treasury's Market Charter
  pays Help Wanted +25 %, the Beachcomber bundle makes every morning a three-note board).
- Help Wanted (`systems/quests.ts`): a note only asks for what can be delivered in time — already in the backpack, wild
  (forage, fish, wood, stone, fiber), or ripe / ripening on the farm by the deadline; otherwise a smaller ask or fiber.
- The Hall (`systems/story-hall.ts`): every room has a hero piece with its own silhouette — Gran's sage seed cabinet with a
  library ladder, a glasshouse lean-to with lemon trees, the cider press + four barrels + a table for forty down the whole
  room, the great hearth + an open bookcase + rocking chair, the hundred-drawer wall + a floor loom, lit caustic tanks +
  the rowboat on the wall + net swags — each lantern its own cage (verdigris globe with enamel petals, gilded sunburst,
  iron-ribbed pumpkin, silver onion dome with icicles, geared copper box, teal ship's lantern), one diagonal festoon per
  room, raised-panel wainscot on the knee walls, vertex contact AO + baked floor shadows under every footprint. Dark:
  split boards to the soil with weeds, ivy in from the walls, leaf drifts, cobwebs, toppled chairs, a fallen banner, the
  room's goods spoiled; two moon shafts pool on the nave runner, the Great Lantern keeps an ember, the farmer's lantern
  carries the frame.
- Systems: `systems/story.ts` (flags, mail, beats, the scene queue — a room completed behind a panel / the pause menu /
  another scene plays its celebration as soon as the way is clear), `systems/quests.ts` (bundles + Help Wanted),
  `systems/cutscene.ts` (camera keys + Catmull-Rom rails, letterbox, fades, captions, actors walk / face / emote / hold
  props, dialogue + choices, `hide` / `show`, `cue`s for world beats; Esc twice skips; actors opt into the GTAO G-buffer
  for the scene so close-up faces never pick up the AO of the wall behind them), `systems/story-hall.ts`,
  `systems/story-world.ts` (coach + headlamps + dust, Hall landmark, valley restorations, Glimmerco kiosk / van, finale
  dressing, sky lanterns and the instanced valley lights). UI: `ui/journal*.ts` (journal J, bundle altar — 3-column slot
  grid, pick / quality chips, progress bar, breathing lantern, the restore seal with its spark burst that closes the altar
  itself — notice board, letter reader, cinema overlay + painted coach window).
- Services: `story`, `letters`, `quests`, `cutscene` (`play`, `stage(scene, mark)`, `skip`, `audit()`).
- Co-op (host-authoritative; the net layer drives it): `story.setRole('host'|'guest')`; the host authors every beat
  (`story:scene` → guests `story.playRemote(scene)`, which returns the farmhand to where they stood), picks the moral
  choice (guests see it locked, `story:choice` → `cutscene.resolveRemoteChoice(i)`), and owns the shared state
  (`story:dirty` once a frame → `story.netState()` / `applyNetState()`: flags, mail, bundles, board). Farmhand hand-ins
  reach the host as `quests.contributeRemote / contributeGoldRemote / deliverRemote`. Co-op avatars (`remote-farmer`)
  and ambient villagers who would twin a cast member or block the lens step aside while a scene plays.
- Perf: the Hall's showing room dressings + bundle sacks are merged per material (`hall-dressing`); the finale's sky
  lanterns and valley lights are one instanced draw each; bloom is held at 0.42 while the finale plays; cutscene tree
  occlusion tests cached canopy spheres every third frame (no per-frame raycasts).
- Demos: `intro-letter`, `intro-establish`, `intro-arrival`, `intro-farm`, `intro-night`, `lantern-hall-dark`,
  `lantern-hall-restored`, `lantern-room-lit`, `lantern-room-reveal` (`&room=seed|sun|harvest|hearth|craft|tide`),
  `bundle-ui` (or `ui=bundles:<room>`), `bundle-complete` (the whole room-complete flow, unpaused: "Offer all" is pressed
  for you, the seal lands, the altar closes, the celebration plays; `&room=`, `&auto=0`), `journal`
  (`ui=journal:quests|hall|letters`), `help-board`, `glimmer-kiosk`, `glimmer-survey`, `glimmer-marigold`,
  `glimmer-doubts` (Kit), `glimmer-offer` (the three-way choice), `glimmer-accept`, `glimmer-concede`, `glimmer-return`,
  `glimmer-town`, `lantern-hall-glimmer`, `sterling-redeem`, `lantern-festival`, `lantern-festival-sky`,
  `lantern-festival-valley`. `&lit=N` sets rooms lit; `&coop=guest` stages a scene as a farmhand sees it (e.g.
  `?demo=glimmer-offer&coop=guest`: the choice, locked).

## Seasonal festivals

Four festival days, each a transformed map built lazily on first visit (`world/festivals/*`, system
`systems/festivals.ts`, data `data/festivals.ts`): **Blossom Parade** (spring: flower floats along the avenue, petal
storm, blossom-pole ribbon dance with a partner you choose), **Tide Lantern Night** (summer: lanterns on the bay,
fireworks over the water, bioluminescent surf + plankton drifts, boat wake rings), **Harvest Fair** (fall: stalls,
giant-produce judging with rosettes, sack race on a limed lane, corn maze), **Starfall** (winter: snowbound square,
the Great Fir, frozen-river skating under lantern reflections, gift circle, aurora). One GPU-posed crowd mesh per map
(festival outfits, 19 clips), one-draw fx (petals, lanterns, fireworks, snow, aurora).

- Mini-games (`world/festivals/games.ts`): Ribbon Dance, Lantern Release, Sack Race, Produce Judging, Gift Exchange,
  Starlight Skate. `openUI('festival:<activity>')` starts one on its map; while paused (demos) it plays itself
  (attract mode plays skilfully, ~85–90 % accuracy). Real stakes: a gold trophy (1st) / blue / red rosettes, and
  below the ribbon line a wilted flower — no prize money, no friendship (unless the partner already loves you). A win
  gets a slow title slam + rays + confetti storm, the whole nearby crowd cheering in 3D and the rosette pinned to your
  chest for the rest of the day. Produce Judging draws three rivals per year (stronger each year), stages your entry
  on a draped plinth (judges gather round it) and adds a presentation pick (the judges favour one touch a year).
  Sack Race: five 1.05 m lanes whose 3D positions are the HUD's progress, dust on every landing, tumbles on wobbles,
  finishers fan out past the tape, the camera tracks the pack. Gift Exchange unwraps the present in 3D in your hands.
- Crowds: townsfolk get 12+ hue families a season, ~40 % seasonal hats (the rest bare hair / headbands / earmuffs /
  bows), elders + children, ±10 % height / ±8 % width, bags; the staged crowd is relaxed so nobody stands inside
  anybody else (`FestivalMap.separateCrowd`).
- Perf: at most 3 dynamic point lights per festival map (constant count; lamps / stalls / lighthouse are glow sprites +
  pool decals, the firework flash is one shared light + a sea tint); the cocoa lamp rides with the skater in the skate.
- Events: `festival:start` / `festival:end`, `festival:music` (tempo / mode / timbre hints), `festival:minigame`,
  `festival:score` (co-op relay payload).
- Co-op: `festivals.record(activity, score)` takes a peer's relayed `festival:score` (player `'local'` = this browser;
  the net layer stamps its peer id); the result card ranks every farmer who played today once more than one has a
  score. `festivals.snapshot()` / `applySnapshot()` hand the festival day (done activities + boards) to a joiner.
- Demos: `fest-spring`, `fest-summer`, `fest-fall`, `fest-winter`, `fest-winter-night`, and the mini-games
  `fest-spring-dance`, `fest-summer-lanterns`, `fest-fall-race`, `fest-fall-judging`, `fest-winter-gifts`,
  `fest-winter-skate`. `&result=1` ends on the result card; `&coop=1` adds two visiting farmers (villager-safe names,
  seeded skill vs each game's par) to its board AND stages them in 3D at the activity spots with name tags.

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
- Bedtime: the bed asks "Go to bed for the night?", the farmer lies down under a folded-over quilt, lamps + fire
  dim, Zzz, fade; in co-op a farmer waiting for the others lies tucked in. The day-end card gets an Animals row
  (fed / produce with quality stars / hungry names / the pet's bowl) from `animals:summary` via `sleep:summary.animals`.
- Petting: a ~64 px heart pop (ease-out-back) with mini hearts + sparkles, the animal's name + heart meter, a squash on
  the animal and a crouch-and-reach pose on the farmer; at most 3 curious animals walk up at a time (20–40 s cooldown).
  Eggs are picked per nest box and shown off overhead with their quality star.
- Demos: `house-interior`, `house-night`, `house-bedtime` (prompt), `house-asleep` (tucked in), `animals-dayend`
  (day-end card with the Animals row), `coop-interior`, `coop-eggs` (`&nest=0..5`), `coop-night`, `coop-dawn`,
  `barn-interior`, `barn-night`, `animals-pasture`, `animals-petting` (close-up), `animals-coop` (pasture + three co-op
  farmhands, perf), `animals-gallery` (every species + coat), `pet-yard`, `carpenter`, `carpenter-animals`.
  `&pet=dog|cat` picks the pet, `&hearts=0` stops the staged petting hearts, `&petted=1` pre-marks today's petting.

## Co-op multiplayer (1–4 farmers)

```bash
npm run server        # relay + lobby server on ws://<host>:8787/ws (also serves dist/ after npm run build)
npm run dev           # then Title → Co-op → "New farm" / "My saved farm" (host) or type the 6-letter code (join)
npm run mp-test       # e2e + adversarial: relay + Vite + headless clients; screenshots + results in shots/mp/
```

Friends on other machines open the game from the host's address; the relay defaults to the page's host on port
8787 (`?server=ws://host:port/ws` or the Co-op screen's "Server" field overrides it). Mid-game: Pause → Co-op →
"Open farm to co-op". URL shortcuts: `?coop=host&name=Ann`, `?join=ABC123&name=Bob&preset=0..2`.

- **Topology** (`server/`, no dependencies): a tiny Node WebSocket relay (`ws.mjs` is a hand-rolled RFC 6455
  implementation) with lobbies, 6-char invite codes, 4 slots and heartbeats. It never parses game traffic
  (`R<to>|payload` → `M<from>|payload`), so it doubles as a signaling channel for a later WebRTC upgrade.
  **Identity**: every browser has a persistent player id (`localStorage hearthvale.pid`); a dropped farmhand
  reclaims its slot by session token *or* pid (a crashed tab / new tab gets straight back in, same backpack), a
  second live tab of the same browser gets a derived pid. Names are unique per lobby ("Ash", "Ash 2"). A full lobby
  evicts a slot that has been away ≥ 10 s; the host can **Kick** (lobby cards / pause menu; refused for 60 s).
- **Transport** (`net/transport.ts` + `net/socket-worker.ts`): the socket lives in a Web Worker, which answers and
  times pings itself, so `stats().rtt` is real network RTT (relay legs in `relayRtt`, main-thread round trip in
  `appRtt`). All periodic sends run on a 50 ms interval ticker (not the render loop) and carry the timestamp of the
  frame the state was sampled on. Non-volatile messages queue while reconnecting and flush, in order, on re-admission.
- **Host-authoritative** (`src/net/system.ts`): the host's browser runs the simulation. Farmhands send intents
  (`use` tool/seed, `act` harvest, `gold`, `psave`, `chat`, `emo`, `bed`, `look`) and their own movement (`st`,
  20 Hz, to everyone: the host validates it, the other farmhands interpolate it on the sender's clock — no host
  re-stamping). The host validates (reach, speed in the sender's clock, blocked tiles, rate, **owns the seed** via a
  mirror of the farmhand's backpack) and applies intents through the farming system's normal `item:use` path
  (`net/farmsync.ts` runs it "as another farmer"), then broadcasts its own 20 Hz sample, `did` events (replayed with
  full FX at the swing's impact frame), per-tile farm deltas (≤ 5 Hz, only when something changed), calendar,
  weather and the purse. Every morning (and on join/rejoin) farmhands get the whole farm (`full`).
- **Shared purse**: farmhand purse changes are sequenced intents; the host drops resends it already applied, refuses a
  spend the purse can't cover (two farmhands spending the same coins → `gdeny`: the loser's purchase goes back) and
  absurd gains. Changes made while disconnected are queued + resent after the rejoin, so purses always converge.
- **Prediction + reconciliation**: a farmhand's own swings, seeds and harvests play instantly; the host's `ack`
  (applied / refused / no-op) carries the touched tiles, a lost race refunds the predicted seed, a 2.5 s drift check
  fixes anything else, predicted loot yields to the host's `give`. Movement is predicted; the host's `fix` is
  reconciled against the position history and bled in over ~150 ms. Remote farmers use an adaptive jitter buffer
  (100 ms floor, grows with measured arrival jitter up to 260 ms) with brief extrapolation.
- **Saves**: a farmhand never writes the host's farm into its own slots (`SaveManager.guard`: "saving" stores the
  personal part on the host + a local per-farm copy). Personal state (`psave`: backpack, energy, friendships,
  skills) is versioned and sent on every backpack change and on `pagehide`; on (re)join the newest of the host's and
  the local copy wins, so a reload never rolls the backpack back (no dupes). First visit = a fresh farmhand kit.
  Leaving (or the host closing up / kicking you) restores your own farm exactly as you left it (or the title screen
  if you joined from it). **No host migration**: if the host leaves, farmhands go home.
- **Shared**: farm tiles, crops, debris, sprinklers, gold, calendar, weather (plus, through `net/bridge.ts`, the
  animals / buildings / story / Hall pods' own co-op hooks and fishing's host rolls). **Per player**: backpack,
  energy, skills, relationships. `net:ext` payloads are only delivered from lobby members.
- **Farmers** (`entities/remote-farmer.ts`): one skinned mesh per farmer (1 draw + 1 shadow), the same shapes and
  the same FarmerActions tool poses as the local farmer; 6 hair styles, 5 hats, skin / hair / shirt / overalls /
  kerchief / hat colours (`entities/remote-look.ts`). Emote bubbles are 3D sprites (`remote-emotes.ts`). Name tags /
  chat bubbles are DOM, placed after each render (`game.afterRender`, so they match the frame's camera even while
  paused) and stacked when farmers bunch up; your own chat shows over your own head too.
- **UI** (`ui/coop.ts`): Title → Co-op screen (character creator with a live turntable, Host / Join by code,
  lobby with invite-code tiles, 4 slots, ping bars, Kick), roster plate (top-left), chat (**T**), emote wheel (hold
  **G**, 1–8), join/leave toasts, bedtime overlay ("waiting for 2 farmers"; the host gets **Sleep anyway** after
  10 s), a Co-op card in the pause menu (players, away state, Kick).
- **Day end**: the bed (farmhouse) or your cabin door marks you ready; the day ends when everyone connected is in
  bed (a farmer who drops no longer holds the night hostage). Cabins (`net/cabins.ts`) appear for each farmhand.
- **Perf**: 3 remote farmers cost ~17 draws; net work is a few small JSON messages per tick; farm digests only when
  dirty. The co-op screen (`ui/coop-stage.ts`) renders the world **once** into a GPU-blurred still and draws the
  turntable with the main renderer (no second WebGL context): ~4 draw calls per frame. `services.net.stats()`
  reports fps / frame-time percentiles, RTT, bytes, queue and reconcile / refund / denied counters.
- **Tests**: `npm run mp-test` (relay in its own process + Vite + headless clients) covers sync, convergence, RTT,
  farmhand→farmhand smoothness, drop/rejoin, and the adversarial cases: own save untouched by a co-op night,
  return home on leave, reload without dupes, crash of the last awake farmer, crash-tab rejoin, same-name impostor,
  kick, gold while disconnected, double spend, sowing race refund.
- Demos: `coop-farm` (host view: three scripted farmhands hoeing, hauling the harvest and chatting, their cabins,
  tags, roster), `coop-lobby` (creator + lobby). Debug: `services.net` (`host()`, `join(code)`, `kick(id)`,
  `players()`, `stats()`, `simulateDrop()`), `services.net.sync.digest()` (per-tile farm state that must match).

## The Hollowdeep (mines, ores, monsters & combat)

The mine (`src/world/mine/`, `systems/mining.ts`, `systems/combat.ts`, `entities/monsters.ts`): a mountain-shelf
entrance (`entrance.ts`: strata cliff, timbered mouth with a lamp-lit drift, the lift headframe) and seeded floors
(`gen.ts`: cellular-automata caverns from `(floor, seed)`) in three biome bands every 10 floors: Earthen Hollows,
Frostvein Grotto, Cinder Depths (`biomes.ts`), repeating with a tier (tougher monsters, richer ore) from 31.

- **Look**: `cave.ts` shell (baked strata + blended biplanar slab texture + clamped derivative bump, glowing lava
  fissures, dark-navy frozen sheets with bubbles, a glossy frozen pool with caustics), `lighting.ts` (lantern spot
  key + fill + bounce + a cool rim light behind the farmer, 5 accent lights, per-biome grade), `props.ts` (shoring,
  lanterns, carts on rails with polished heads ending in a buffer stop / rockfall, crystals, spikes, basalt, vents).
- **Rocks & ore** (`ores.ts`, `stone.ts`): one batched draw per material; a procedural stone shader (3D-noise albedo,
  roughness, bump; no UVs) carves ore **veins** into the rock (copper with verdigris, blue-grey iron with rust, gold
  with star glints, glossy coal), gems break out as emissive hexagonal clusters, ice rocks get a frosted fresnel skin.
  Hits flash the rock white, squash it, throw 8–12 chips + a dust ring; breaks burst 20+ chunks and pop loot
  (≥ 1 stone per rock) that bobs over a tinted glow ring and flies to the nearest farmer within 2.5 tiles after 0.5 s
  (`pickups.ts`, instanced: one draw per loot kind). Ore by depth: 12–17 % of rocks on floors 1–5 (gems ≤ 1 %),
  ≈ 20–40 % deeper, iron from 5, gold from 21, diamonds from 25 (≤ 0.5 %); repeat bands start at iron, gold ≥ 10 %.
- **Combat**: slimes (spring jiggle), bats, rock crabs, frost wisps (chill), cinder imps (fireballs). The sword
  (`actions.ts`: short polished blade, alternating slashes) draws a thick additive crescent over everything, hits
  knock monsters back 1.65 tiles (eased 0.18 s) with a squash + hot-rim flash, damage numbers pop 1.4→1 at the hit
  point (42 px, crits 56 px gold + shake), kills freeze the arena 60 ms, kick the camera and leave a goo splat.
  Health tube, i-frames, passing out → carried to the entrance lean-to (+2 h, some gold / loot lost).
- **Co-op** (`coop.ts`, wired through `net/bridge.ts`): the host is authoritative for every occupied floor — seed
  sync, a ledger of broken / damaged rocks, the ladder and loot, 10 Hz monster snapshots interpolated 120 ms behind on
  farmhands, pick / sword **intents** resolved by the host and broadcast (rock state + exact drops, hits with damage /
  crit / kill), monsters chase the nearest living farmer and their hits go to that farmer (health and passing out
  are per player), loot goes to whoever vacuums it. Floors the host isn't on run as **headless sims** on the host
  and migrate live ⇄ headless (same monster ids, hp, loot) when the host arrives / leaves; farmers on other floors
  are hidden. `node scripts/mine-coop-test.mjs` runs the two-browser e2e (shots in `shots/mine-coop/`);
  `services.mineNet.stats()` shows floors, headless sims and message counts.
- **Demos**: `mine-entrance`, `mine-floor` (earth, floor 3), `mine-ice` (14), `mine-lava` (24), `mine-combat`
  (live arena + autopilot; `&still=1` freezes a landed hit, `&god=1`), `mine-coop` (two scripted farmhands fighting
  and mining beside you, name tags; no server), `mine-chest` (floor 10 reforge). Params: `&floor=N`, `&pick=1`
  (`&still=1` freezes the pick impact), `&foe=0` (no staged monster), `&ui=elevator`.

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
