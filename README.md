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
node scripts/matbench.mjs --demos beach-sunset --eval "$(cat v.js)"   # shader A/B: renders only the named meshes
                     #   (default terrain chunks; --names "terrain-chunk|water", --names . --sys for per-system main-pass
                     #   cost), configs interleaved, 1-px readback per sample: resolves ±0.2 ms on a shared GPU
node scripts/abshot.mjs --url "?demo=snow-day" --eval "$(cat v.js)" --out shots/ab/snow   # same frozen frame per
                     #   config + pixel diff vs base (prove a perf change is invisible)
node scripts/framebench.mjs --demos mine-lava,lantern-festival-valley   # matbench's min-of-samples on the WHOLE frame
                     #   (shadows + main + GTAO + bloom + SMAA + tilt + grade): built-in noAO / noBloom / noSMAA / noTilt /
                     #   noShadow costs, --eval configs, --params for page-level switches
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
                         shop.ts also hosts Odessa's forge "Tool upgrades" shelf (next tier of hoe / can / pick for gold + 5 ore) · toolinfo.ts (tool tiers: metal pips, what each tier does, forge ladder; shown on tooltips + the backpack card) ·
                         crafting.ts (iso placement preview, craft payoff → Backpack tab) · placement.ts (in-world ghost:
                         real colours + pulsing outline, dashed reach tiles, red ✕ where blocked) · dayend.ts + dayend-art.ts
                         (painted night valley, quiet-day vignette; `ui=dayend:quiet`) · mapscreen.ts + mapart.ts (watercolour
                         valley laid out like the warps — mine north of the farm, Cindergrove + falls past its south gate, road east to the square and on to the beach pier: paper grain, washes, fields, Poisson woods, villager heads, season palettes) ·
                         settings.ts (quality + live fps, fullscreen, frame limit 30/60/vsync, FPS chip, volumes, UI size, reduce
                         motion, 24h clock, key rebinding) · pause.ts (+ save slots with real world snapshots — a dark frame (overnight
                         fade) is skipped and re-grabbed once the morning is on screen — overwrite / delete confirms) · newgame.ts
                         (New Journal: in-world character creator — name, farm, look via the co-op profile, six Quick looks, pet,
                         journal slot) · profile.ts (journal: name / farm / pet / slot, saved per slot) · menutabs.ts (one
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
16.7 ms and restores them with back-off (off under automation; `?adaptive=1|0` to force); a step that bought
< 4 % (AO / shadow res on a fill-bound frame) is followed by the next one after a single short window, so a fill-bound
scene reaches render scale 0.85 in ~12 s instead of ~17 s. Shader rule: pay for a layer only where its weight is > 0
(`if (w > 0.0)` around noise / taps; taps inside such a branch use `textureGrad` with derivatives taken outside it).
Terrain chunks draw after the other default-order opaques (`renderOrder` 0.5): rocks, buildings, grass and props
that cover the ground hide its shader instead of overdrawing it; an opaque decal on the ground must write depth
(polygonOffset) or take `renderOrder >= 1`.
The static sun-shadow cache (`shadowcache.ts`) rebuilds over 3 frames into a back buffer when the cache can wait
(the 2 s safety timer, a caster that settled; it keeps drawing with the moving casters until baked), one
triangle-balanced slice of the still casters per frame; a shadow-camera step, map realloc or a baked caster that
moved / vanished still refreshes at once (`?shadowsplit=1` = old one-frame refresh). MeshBuilder parts under 7.5 cm
(moss, petals, beads, rivets) merge after the larger parts of their material and depth-only passes (sun shadow, GTAO
G-buffer) draw only the larger prefix (`geom.ts` DETAIL_R, `userData.shadowCount`; `?detailr=0` = off).
Water (perf r17): solid winter ice skips the open-water colour it fully replaces and runs its crack Voronoi only on the
cracks' runs; open water takes a forward 2e wave difference (`world/water.ts`, `?waterfast=0` = old shader). The beach
ocean's swash / breaker phase noise and kelp-bed warp are per vertex on the 0.5 m near sheet (`?oceanvn=0`). Rain / snow
quads that are inactive or faded out at the lens are clipped in the vertex shader. Mine (perf r20): the lava band's
scorch / ash fbms (three coarse octaves) and crazing mask are per vertex on the cave shell's 0.2 m grid; fields that place
thin crack / joint lines stay per pixel (`world/mine/cave.ts` HV_CAVE_VN, `?cavevn=0` = old shader). The lava plane
itself measures ~0 ms in matbench (mine-lava); the shell is the mine's main-pass cost. Ground light
pools (`props/decals.ts`) are one merged mesh per map (town at night 8 draws -> 1). Measure shader changes with
`scripts/matbench.mjs --names <tag>` (isolated, min / p20 of interleaved samples) and prove them with `scripts/abshot.mjs`:
wall-clock `npm run perf` on this shared machine (load 100-400 on 18 cores) cannot resolve a 10 % change.
Shadow proxies (perf r22): an `InstancedPart` with `shadowOnly: true` draws only in the sun's shadow pass (its colour
twin sets `castShadow: false`; `render/batching.ts` zeroes it in camera passes). The forest giants and shrubs cast from a
twin built off a clone of the same RNG state with every other trunk ring / root side and icosphere detail 0 under the
canopy puffs, so every proxy vertex lies on the colour mesh. `noAO: true` keeps a part out of the GTAO G-buffer (winter
berries, stalks); the giants' finest winter whips are detail; snow collars are one batched geometry per tree
(`?forestlod=0` = all off).

URL: `?demo=farm-morning`, `?map=farm&x=30&z=20&time=18.5&season=fall&weather=rain&day=3&gold=900&facing=up&pause=1`,
`&ui=inventory`, `&quality=low|medium|high|ultra`, `&hud=0` (hide HUD), `&cam=yaw,pitch,dist[,offX,offZ]`, `&seed=abc`,
`&notitle=1` (accepted; the title screen is a UI-team deliverable).

Demos: `farm-morning`, `farm-noon`, `farm-evening`, `farm-night`, `farm-fall`, `farm-winter`, `farm-rain`, `farm-pond`,
`farm-field`, `winter-night` (+ DESIGN names `town-evening`, `beach-sunset`, `forest-rain`, `mine`, `festival`, which
stage on the farm until those maps exist).
UI screens: `ui-title`, `ui-title-continue` (a returning player: Continue is the green hero), `ui-hud` (toasts), `ui-inventory`, `ui-shop`, `ui-shop-smith`, `ui-forge` (Odessa's tool upgrades with a purse that can pay), `ui-shop-carpenter`, `ui-crafting`,
`ui-placement` (in-world ghost), `ui-dayend` (dusk farm behind the ledger, lines tick + hop into the crate, season-so-far strip; `ui=dayend:big` = a 20-kind bin in two columns), `ui-dayend-quiet` (nothing shipped), `ui-sleep` (the real night: stocked bin → bed → payout → ledger over the dusk grab of the farm; shoot with `--wait 5500`), `ui-map`, `ui-settings`, `ui-pause`, `ui-saves`, `ui-icons` (item almanac),
`ui-newgame` (New Journal creator; `ui=newgame:demo` pre-filled; a villager's / the shop's name is refused), `ui-hud-low` (both tubes low: % chips, red/amber rim pulse, red edge vignette, selected-item banner held; any demo takes
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
music-bus EQ + a glue compressor on the score only + master limiter, an AudioWorklet sidechain, composer,
synthesised instruments, ambience beds, birdsong syllable banks, SFX library) and `src/systems/audio.ts`
adapts it to game events.

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
  (low flute over a music-box figure, 6/8). Nights (`night:<season>`): Lamplight, Dew at Dusk, Firefly Meadow
  (summer: vibraphone over fingerpicked nylon guitar, a lydian II, flute bridge), Owl Hour, Snowlight Lullaby. Town (`town:<season>`, `src/audio/songbook-town.ts`): Market Morning (ocarina + pizzicato), Bunting & Bread
  (tin whistle over ukulele strums, spring / summer), Lamplighter's Waltz (accordion musette, fall / winter) and
  Market Morning (Frost) (celesta, sleigh bells, winter); the square's evening (`town:eve`, 17:30–20:00) rotates
  the inn's tune with the waltz. Rainy days (`rain:<season>`, indoors too): Window Weather (lo-fi piano), Gutter
  Song (vibraphone over fingerpicked nylon guitar, spring / summer showers), Grey Lantern (felt-piano waltz with a
  cello, fall / winter). Plus beach (steel pan + ukulele), forest (dorian whistle + harp, 6/8), inn (swing
  vibraphone over Rhodes comp), mine / mine-ice / mine-lava (by floor band), title, and the festivals — each with
  its own tune: the Lantern Jig (generic festival, 6/8 fiddle), Ribbon Parade (Blossom Parade: a lydian polka,
  harp + ukulele off-beats), Harvest Reel (Harvest Fair: a D-dorian reel in 4/4 with its own hook, guitar chop,
  bodhrán), Lanterns on the Tide, Starfall Carol. Comping varies per bar (3–4 rhythm variants per pattern, the
  phrase's last bar pushes, ghost notes) and the voicing window climbs through inversions over each phrase.
- **The event score** (`src/audio/songbook-events.ts`): heart events and story scenes get their own cue
  instead of the square's music — Kindling (tender: felt piano over a rolled harp, cello on the return),
  Tiptoe (playful: staccato clarinet, pizzicato off-beats, glockenspiel wink, a comic button ending),
  The Empty Chair (wistful: a D-minor fiddle air), Lantern Dark (mystery: celesta in D lydian, the I↔II sway, a
  borrowed bVImaj7) and Glimmer & Co. (sly: an A-minor habanera, clarinet with chromatic sidesteps, tresillo
  bass, the accordion turning on the charm) and Lanterns Relit (a 3/4 fiddle hymn for the Lantern Hall room
  restorations and the town turning Glimmer away, lifted a whole step into its last A with hand bells on the
  tune). `eventCue()` maps the 20 heart events and the hall / Glimmer / restoration scenes, and any new event by
  a vote over its lines' moods. `npc:event` / `cutscene:start` swap in the cue
  with a quick fade and the place's music returns at the phrase end after `…:end`; a cutscene's own
  `cue: 'music'` still wins; co-op farmhands spectating the host's heart event hear the same cue (the
  host's 'v.e' net message). No now-playing card over the actors. Hear it: `?demo=audio-event&event=june-2`
  or `&cue=event-sly`; `?demo=town-heart-event&event=<id>` scores the staged event too.
- **Round 12** (critic r5 fixes): **one audio graph** — the mine / combat cues (`world/mine/sfx.ts`) no longer
  open a second AudioContext of oscillator beeps: they voice `sfx.ts` designs through the audio hub
  (`src/audio/hub.ts`) at the world position they happen at (limiter, sidechain, cave reverb, voice budget,
  volume / mute). Each blow is one voice per monster kind (`hit:slime` squelch / burst, `hit:crab` shell clank /
  crack, `hit:bat` screech + wing flurry, `hit:wisp` static zap / glass spray, `hit:imp` ember hiss; level bit 0 =
  crit ring, ≥ 2 = the kill), a 3-monster sweep collapses into one voice (+1.5 dB per extra target), and the
  swing / pick strike no longer play twice; `gem`, `lift`, `sizzle`, `fireball`, `parry`, `mine:reveal`,
  `passout` are new designs. Animal calls and the fishing kit borrow the same context and SFX bus (the fishing
  kit's private surf bed is gone — the ambience owns the beach). Co-op partners' sword arcs and blows are
  positional (`--coop` checks 12 tiles ≥ 5 dB under 1 tile). Demo: `?demo=audio-mine&fight=1[&floor=14]`.
  **Bass**: articulation is absolute (sustained basses tie over by 30 ms, a repeated pitch lifts for 50 ms,
  plucks leave 40 ms) and the soft bass releases over 0.12–0.38 s with a gentler sink — the critic's
  `BASS-HOLE` rule (50–220 Hz falling > 10 dB in the 300 ms before a downbeat) runs on every theme render.
  **Identity**: openings re-harmonised (melody-first spring and town-3, a mixolydian vamp into summer, a
  borrowed iv over a tonic pedal in Clover Lane, iii7 into Gutter Song, cadential 6/4 into Starfall ...), forms
  varied (AABA with a key lift, ABAB', through-composed ABCA, 0 / 1 / 4-bar intros), the title rebuilt round a
  two-bar hook ('1 2 3 5.. 3 2', eighth-note motion, IV/5 pedal, bVII) that returns as a leitmotif in
  spring's B and the town's bridge, Dew at Dusk rewritten as a stepwise line with 9-8 / 4-3 suspensions; the
  compose critic prints every song's opening and fails `SAME-OPENING` within a playlist or more than two
  Imaj7–IVmaj7 openings. New songs: Low Tide (beach bossa, vibes over nylon guitar) and Fern Hollow (forest:
  an oboe waltz in B minor) in the `beach:day` / `forest:day` playlists. **Tone**: `--calibrate` also measures
  each opening's 60–200 Hz and 2.5–6 kHz balance and `loudness.ts` `toneTrim` shelves it to the family's house
  curve (day / soft), so a playlist sits within ±2 dB (`TONE` flag over 3 dB). **Winds**: a player's vibrato
  (±20–25 c on flute / whistle, entering 250–400 ms in), a breath puff at the onset and a 2.6 kHz formant;
  +2 dB of 1.5–3 kHz presence on the melody track; the upright bass has finger noise and replaces the sine
  bass under the title. **Ambience**: calm nights drop the wind / leaf wash ~9 dB and
  calm mornings ~6 dB — critters carry the space (a rustle in the grass, a distant dog, a nightjar, a
  woodpecker, the rooster at first light); rain is patter (low bed high-passed at 150 Hz and −10 dB, denser
  drops), indoors the roof ticks at 1–4 kHz and the gutter drips; every thunder cracks before it rolls; doves
  vary pitch, tempo and length; surf periods wander 5–14 s with double sets; no static cicada band on the
  beach. Ambience presets are judged by `AMB-STATIC` (< 8 foreground events a minute) and `AMB-FLAT`
  (LRA < 4 LU) instead of their level under the music. Villager voices +3 dB with a 2–4 kHz consonant click;
  combat blows land at least level with the hoe (`--live` asserts it, and counts AudioContexts: exactly one).
  The scene cues and the title are composed in the worker at load / dawn and kept ready (never on the frame).
- **Round 13** (audio pod r6): plucked basses **ring to the next note** (`composer.ts` `letRing`: an upright /
  bass-string note is never damped early, ≤ 1.4 s past its written length; stop-time hits stay short) and the
  upright rings longer (T60 ~2.9 s, body bloom 0.85 s) — the low end no longer gates before every downbeat
  (bass dips: town 7 → 0, spring-2 15 → 3, town-2 10 → 4, festival 15 → 7; `BASS-HOLE` now needs a 60 ms hole,
  a re-struck pluck's 20-40 ms notch is articulation). Owl Hour re-sung stepwise (75 % steps, was ANGULAR).
  Quieter calm air (calm mornings -8.4 dB, calm days -6 dB, wind high-passed at 110 Hz): the live farm floor
  -25.7 → -28.1 dBFS, so hover / chat / footsteps all clear it (`--live`: all checks green, was 5 fails);
  the cave roar -3 dB (a 12-tile fight reads over it), crickets ebb together on a ~23 s swell, cicadas
  4.2-5.6 kHz (no HISSY noon), rain hiss low-passed at 6 kHz; indoors the rain comes in showers (roof, hiss,
  eaves drips and the hearth's roar breathe over ~40 s; drips are the eaves, not a puddle in the room).
  Summer's marimba ostinato moved hard left, away from the marimba tune. A sustained (soft) bass holds its
  waltz note through the bar, and a slow plucked waltz (bar ≥ 1.75 s) adds the beat-3 pluck most bars —
  bass dips before downbeats: 64 in the first 16 themes before, 20 over all 44 theme renders after (worst
  mostly 11-13 dB: a pizz decaying across a slow bar; festival-tide's jig 7). The mines get their own
  `cave` house curve (3 dB darker than the day; they were uncorrected, mine-lava's top 9 dB under the farm's)
  and the `TONE` flag judges each song against its family curve. `--amb <presets>` renders just those
  ambience presets.
- **Round 14** (audio pod r7): **phrasing**. The hooks the critic called leap-heavy were re-sung around
  stepwise contours with one arpeggio figure kept as each song's signature, a placed peak (the top note
  once per phrase, usually bar 6-7) and a written breath (a rest, or a phrase-end hold) at bar 4 / 8:
  Harvest Reel 70 → 28 % leaps (unrecovered 50 → 0; a session-reel hook "D E F D A G F E" answered a step
  down, the top G once in B), The Warm Kettle 69 → 36 % (a blue run down from the top over the IV7),
  Porch Swing 66 → 38 %, Frostglass 63 → 34 %, Low Tide 62 → 39 %, the Lantern Jig 62 → 26 %,
  Firefly Meadow 60 → 26 %, Gutter Song 60 → 27 %, Lamplighter's Waltz 59 → 26 %, Mossway 58 → 41 %,
  Lemonade Afternoon 58 → 41 %, Grey Lantern 56 → 38 %, Clover Lane 54 → 30 %, Lanterns on the Tide 54 → 26 %,
  Market Morning 51 → 44 %, Tiptoe 59 → 46 % (its staccato arpeggios are the joke). **Replay life**: the
  short loops get genuinely new strains instead of repeats — Lamplighter's Waltz a 16-bar clarinet trio in
  the relative minor (54 → 90 s), Apple Blossom Waltz and Amber Waltz their 16-bar flute / cello bridges
  (64 → 108 s, 68 → 106 s), Clover Lane A B C B A (79 → 90 s), Grey Lantern A B A C A (79 → 96 s), Mossway
  … A C B A (84 → 96 s), Hush of Snow its C strain before the last A (101 → 135 s). The composition critic
  (`critique.ts`) now flags `LEAPY` (> 52 % of moves a skip of a third or more, or > 8 % unrecovered
  leaps of a fourth+), `SHORT-LOOP` (a song under 85 s, a scene cue under 60 s) and `NO-BREATH` (< 1 breath
  per 8 bars of tune) and reports `peakPct` / `breathsPer8`: all 44 songs clean, 0 clashes, 0 b9s.
  **Lantern Dark** (event-mystery, the one TONE fail) gets its body from the arrangement, not EQ: the cello
  guide sings from the first A in its tenor (C3-C4), a low string pad holds the chord under the harp
  throughout and the harp rolls start lower. **Offline proof**: `audio-render.mjs` writes
  `manifest.json` — every job the run is expected to produce (a default run: 44 themes, 44 mixes, every
  ambience preset, the SFX reel, gameplay, 3 transitions), its status / flags as it finishes, the source
  revision (`+dirty` when the audio sources differ from it) and a verdict that passes only when every job
  is clean with no flag at all and the composition / SFX-hierarchy / gameplay / opening-loudness checks are
  clean (exit 1 otherwise). **Co-op performance**: `node scripts/audio-coop-perf.mjs` — four real clients
  over the relay on the farm, each measured in turn at 2560x1440 "high" (uncapped, the perf.mjs timing
  mode) while the three partners walk / hoe / chat around it, with an A/B window holding its AudioContext
  suspended (`services.audio.benchOff`). Gates: FPS ≥ 60, the audio stack ≤ 8 ms of main thread per
  second, audio-on vs off within max(0.35 ms, 3 %) per frame, partner footfalls voiced.
  `info().perf.frame.audioMsPerSec` now includes the off-frame work (worker note deliveries into the cache,
  the 250 ms watchdog: `src/audio/cost.ts`, also `offFrameMsPerSec`). Fix found on the way: the partners'
  strides and reel ticks advanced by one frame's dt per ~45 ms decision pass, so a walking farmhand was
  voiced at ~1/3 of their real footfall rate; they now advance by the time that passed.
  Hear the four-player farm: `?demo=audio-coop4` (three phantom farmhands on their own paths; `?demo=audio-coop&partners=2`).
- **Round 15** (audio pod r8): **the mines get a playlist per band** (`src/audio/songbook-mine.ts`;
  `select.ts` `mine:earth` / `mine:ice` / `mine:lava`, day-seeded like the farm's, the same song for every
  co-op client on that band): the drifting ambient piece now alternates with a written song of another
  character — *Lamplit Seam* (earth: a D-dorian miner's tune, low clarinet over a walking upright and
  pizzicato off-beats, a 4-bar vamp before the tune), *Hoarfrost* (ice: a slow 6/8 flute air in C# minor
  over rolled harp, the cello taking the bridge, celesta frost late) and *Cinder Hymn* (lava: an oboe
  lament in E harmonic minor — the C–D# augmented second — over a low 3+3+2 marimba pulse and a drone).
  A new `cave` percussion pattern (a damped bodhrán heartbeat, a pick ticking far down the tunnel, a
  triangle glint per strain). Composition critic: all three clean (Cinder Hymn re-sung from 55 % leaps
  and a b9 against the cello to 44 % / 0). **Low end**: a plucked bass is damped by the next pluck itself
  (it rang out 35 ms + its damping short of every note: a 10 dB notch in the last 100 ms of each bar),
  the upright's body hums longer on long notes (tau 0.85 → up to 1.5 s), a waltz guitar's "pah" chords
  leave the low string to the bass (its E3–G3 strings and box thump sat 13–15 dB over the bass in
  50–220 Hz, then sagged into the downbeat), and a soft / bowed bass holds each jig dotted-quarter — bass
  dips before downbeats over every theme render 22 → 7, the worst 20.2 → 13.0 dB (summer-2 4 → 1, town-2
  4 → 0, festival-tide 5 → 0, forest-2 2 → 0, beach-2 1 → 0); `BASS-HOLE` now also flags any pattern whose
  low end falls > 14 dB into a downbeat. Full render `shots/audio-r8/final` (rev b879ce6): 113/113 jobs
  clean, opening spread 0.6 LU, the new mine songs at -22.0 / -21.8 / -22.4 LUFS on the cave curve.
  `--live` (real game): all checks green, the mine scene resolves its band playlist, 60 fps / p95 16.7 ms
  with the audio system at 2.3 ms of main thread per second. Tenor string beds under Snowlight Lullaby / Firefly Meadow repeats,
  winter / Frostglass's tenor pads +3.5 dB, Lanterns on the Tide's harp lower + pad up, Glass Caverns' pad
  into the tenor, The Empty Chair's harp lifted off the cello. All themes recalibrated.
  Hear them: `?demo=audio-mine&floor=2&theme=mine-2`, `&floor=14&theme=mine-ice-2`, `&floor=24&theme=mine-lava-2`
  (or `&theme=mine:ice` for the band's rotation; `&fight=1` stages the combat soundcheck over it).
- **Rounds 16-17** (audio pod r9-r10, critic r6): **rain made of drops** (`src/audio/rain.ts`): leaf / soil /
  puddle (a Minnaert bubble chirping up) / wood impacts at their own distances, baked once into seamless
  loops (canopy grain, near drops you can count, heavy) played by one buffer source per layer — no
  scheduling per drop; the old hiss carpet is −10 dB under it. **Material impacts by modal synthesis**
  (`src/audio/impacts.ts`): wood, stone, soil, steel, slime, chitin, membrane, ember, crystal — each a contact
  pulse into its own modes and loss factor (wood swallows its highs, stone barely rings, steel rings ~0.6 s,
  soil is a 5 ms push) plus a texture (fibre crackle, grit, chips, gloop, chitin rattle), 4 variants per
  material baked over idle ticks; hoe / axe / pickaxe / rock break / sword blows / parry voice them. **Voice
  characters** (`sfx.ts` `VOICES`): beyond register, each villager has a spectral tilt, a vibrato (tremor,
  lilt or monotone), syllable length, nasality and the line-end creak. **Blind recognition**
  (`node scripts/audio-recognize.mjs`): every surface / tool / impact / villager rendered 6 times with fresh
  seeds and lines, classified leave-one-out by the nearest class without labels — surfaces 42/42, tools 48/48,
  impacts 63/66, voices 44/48 (`shots/audio-r10/recognize-final.log`); it also measures each effect into a
  limiter-bypassed graph (`GraphOptions.bypassLimiter`) so "everything peaks at the ceiling" is checkable.
  Hear it: `?demo=audio-foley` (impacts, then each villager speaks; `&only=axe,hoe`, `&voices=0`).
  **Whole songs**: a default `audio-render.mjs` run also renders one complete song per family
  (`--full`, `--full all`) so B / C strains and loop seams are judged, not only 30 s openings;
  `audio-continuity.mjs --song-end` checks the real game's between-song breaths (`shots/audio-r16/song-end.log`:
  12.6 s and 8.7 s of rest, the next song starts by itself). `info().audio.cost` splits the audio stack's
  main-thread ms/s into feet / decide / schedule / remote / offFrame.
- **Round 18** (audio pod r11): **every strain crests once**. The composition critic counted its 8-bar
  phrases from the top of the piece, so whenever an intro was not 8 bars long a "phrase" straddled the A/B
  seam; it now counts from each section's first bar, and the strains that bumped their ceiling were re-sung
  with one placed high point: the title (E' over the ii7 in bar 7, the only time A reaches it; phrase peak
  25 → 100 %), Market Morning (C' over the IV, its B to B' on the iii7), Long Light (A' over the ii7; its
  answer enters by step and the half cadence falls through the V's thirds — unrecovered leaps 11 → 3),
  Kindling (A' over the IVmaj7, 33 → 100 %), Cinder Hymn (the first half stops on the D# so the E' is first
  heard in bar 5, 25 → 100 %), Amber Waltz (climbs G A Bb C to D' over the tonic once — the Bb neighbour
  was its ceiling four times), Snowlight Lullaby (an Am11 sigh instead of a third E), Fern Hollow, Clover
  Lane, Cider & Candle; Ribbon Parade's leaps resolve (21 → 6 unrecovered; the closing F# rises to the G
  instead of dropping a seventh). All 47 songs: mean phrase peak 99.6 %, 0 clashes, 0 b9s, no flags. New
  critic flag `BAR-LENGTH` (a tune bar that does not fill its meter — the composer only warned). Villager
  voices: the reel now speaks two real lines with the game's line position (one sentence's luckiest
  syllable had decided the spread) and they are levelled to 0.8 LU (was 5.6); Marigold is a brisk,
  clipped patter, Wren airy and drawn out, Linus clipped, nasal and without vibrato — blind recognition
  44 → 46/48 (Marigold's margin over her nearest rival 0.8 → 2.4, Linus 1.8 → 3.2; Wren is now the one
  heard twice as June, `shots/audio-r11/recognize-voices.log`). Falling snow deadens the air: the wind is
  −3 dB on a snow day (its gust² swing had lifted the snow bed 3 LU and left the winter mix 'mellow'),
  and the snow slumps land −5 dB softer with more powder hiss. A windy day blows in sets — a 3-7 s gust,
  then a 4-10 s lull — instead of independent random targets that could average into a steady roar
  (fall-wind LRA 2.3 → 6.6 LU on the draw that flattened it); indoors the eaves drip a little quicker
  (house rain 3.9 → 6.3 audible drops/s).
- **Instruments** (`src/audio/instruments.ts`): mallets are modal notes pre-rendered once per pitch
  (kalimba tine inharmonics + buzz + box body, marimba, music box comb modes + case, celesta, glockenspiel,
  vibraphone with motor tremolo, hand bells, steel pan);
  plucked strings are Karplus-Strong with body modes baked in; winds (flute, whistle, ocarina, clarinet, oboe)
  crossfade a soft and a bright spectrum by velocity, register and the note's own swell (the clarinet's even
  harmonics only arrive when it is pushed), with a random-walk pitch drift of a few cents, vibrato that deepens
  on held notes, a messa di voce on long notes and breath as noise through a resonant band tracking the pitch;
  the solo fiddle and cello are physically modelled — a digital-waveguide string driven by a stick-slip bow
  (friction curve, slight arm wander, so the Helmholtz motion, the scratchy onset and the rosin jitter come out
  of the physics), pitch-corrected and pre-rendered per pitch with a phase-aligned sustain loop, then played
  with a per-note scoop or finger slide, delayed vibrato, bow-change rosin bursts and a fixed violin / cello
  body filter bank (~280 / 450 / 1000 / 2800 Hz) so the vibrato sweeps the harmonics through the resonances;
  the clarinet gets a bore-formant insert; plucks and the kalimba carry a 90–180 Hz air-cavity thump; the pad
  is a five-voice drifting string ensemble with formant EQ. Shared LFOs, a two-tier note cache (~18 MB of ready
  float buffers + ~18 MB of 16-bit notes the worker delivers and older notes are demoted to, promoted back by a
  copy when played; other songs' notes go before the next song's opening and the playing song's, which are
  pinned; pluck tails trimmed at -62 dB; a returning song's dropped notes are re-rendered by the worker
  before they are due, a held-back note is asked of it urgently, and a texture note / key-bridge roll / SFX
  chime still missing at the last moment is left out or played by a light stand-in rather than synthesized on
  the frame) and a hard 72-voice polyphony cap (SFX included) keep the per-note cost low: melody, bass and SFX
  steal the oldest ringing tail, else the oldest lower-priority voice, instead of being dropped; texture thins first. Every note a song, its key bridge and
  the SFX chimes in its key will need is rendered in the compose worker before it is due.
- **Transitions** (`src/audio/music.ts`): crossfades with a key bridge — a change of place fades the old song
  over 1.3 s while the new one opens on a bar of its tonic chord built only from tones both keys share; a mood
  change in the same place waits for the phrase to end first (2.5 s fade). No dead air, no clashing keys.
  The director's recent decisions are in `__game.info().audio.trace`. Songs are composed in a Web Worker
  (`src/audio/compose.worker.ts` via `prefetch.ts`): the opening song is requested as the save loads (before
  the first click), forced demo / cutscene themes on request, the next song while the old fades — and in real
  time a song is never composed on the main thread (`__game.info().audio.compose`: worker hits vs misses).
- **Continuity** (the score must never "drop out"): between songs there is only a 5–15 s breath (`rest`
  in the theme defs), and a new place / mood during it starts the new song at once; a storm keeps the rain
  tune outdoors too (quieter, `STORM_OUTDOOR_LEVEL`) so doorways never stop / restart it. Music is scheduled
  1.5 s ahead (`MUSIC_LOOKAHEAD`), so a main-thread stall shorter than that drops nothing; a slightly late
  note is played, only a > 250 ms stale one skipped. The adapter resumes a suspended / Safari-'interrupted'
  context (every gesture, `statechange`, a 2 s keep-alive), always restores the master after a hidden-tab
  fade, only kicks a clock frozen for 6 s, and a throwing music update is warned (rate-limited) and resets
  the director after three in a row. `__game.info().audio.sched` / `.musicDb` / `.ctxState` show it live;
  `node scripts/audio-continuity.mjs [--live [--minutes N]]` traces a 10-min session (farm → town → beach,
  a storm day with doorways, a hidden tab, 500 ms stalls) and fails under 90 % audible or on a dropped note.
- **In game**: a "now playing" card (`src/audio/nowplaying.ts`) engraves the first two bars of the new
  tune on a staff, and little notes float out of it into the scene in time with the melody while it is up;
  the morning chime quotes the tune about to play, the first day of a season its hook.
- **Performance** (`composer.ts` `perform()`): bars are composed in score time and then played through a
  continuous tempo map — a ±1.5 % mean-reverting drift, a smooth ritardando over the last two beats of every
  phrase (a tempo on the downbeat), a broadening final cadence and outro — with the bass a touch ahead and the
  tune laid back on lyrical themes, and AR(1)-correlated micro-timing per part instead of white jitter.
- **Crowds** (`src/audio/crowd.ts`): the square and festivals are made of people, not a noise wash — 4 (town)
  to 8 (festival) persistent formant "talkers" at their own pitch, pace and distance speaking sim-speak phrases
  (pitch arch, declination, stressed syllables, rising questions, turn-taking), laughter, festival applause,
  distant footsteps on cobbles and the shop door's bell; the wind / leaf wash sits 6 dB lower in town.
- **Ambience**: every bed is decorrelated stereo noise (L/R correlation ~0.3); rain is a 4–6 kHz hiss plus
  two looping droplet textures (45 / 110 drops/s, 2–8 kHz pings and the odd puddle plink, spread across the
  field); surf swells travel from one side to the other.
- **Mix** (`src/audio/graph.ts`): every song's *opening* (its first 30 s — what a player hears on entering
  a place) is loudness-normalised to -21 LUFS integrated at the default volume settings (mine -22, nights
  -21.8; table in `src/audio/loudness.ts`, regenerated by `node scripts/audio-render.mjs --calibrate`, which
  fails if two openings land more than 2 LU apart; the theme render prints the same OPENING LOUDNESS check). The glue compressor (2:1 above -14 dBFS) sits on the music
  bus only, so SFX never pump the score; instead world SFX (not footsteps, reel ticks or menu cues) key a
  real sidechain — an AudioWorklet RMS follower (`src/audio/ducker.ts`, 30 ms attack / 250 ms release,
  ≤ 3 dB) on the music chain. Farming verbs clear the score by ≥ +4 LU in the gameplay render; impacts
  (hoe, axe, pickaxe, rock break, sword hit, door, tree fall, hurt) carry a granular 1.5–5 kHz crunch + an
  800–2000 Hz click so they read on laptop speakers, and repeat with ±2.5 st / ±2 dB variation. The music
  bus has a +3.5 dB low shelf at 140 Hz (day themes carry 10–20 % of their power in 60–250 Hz; the render
  flags `THIN` under 6 %), cuts 300 Hz, lifts 3.2 kHz / 7 kHz; accompaniment and counter-line sit at ±0.5–0.7, doubles are a
  15 ms Haas pair, the melody gets early reflections. Phrases breathe: a ±3.5 dB arch over every 4 bars on
  top of a section contour, and velocity opens the winds' and strings' tone ~2.5×; wind melodies slur
  (portamento) through stepwise lines.
- **Birds & beds** (`src/audio/birds.ts`, `ambience.ts`): birdsong is sequenced from banks of ~40
  pre-rendered syllables per species (fundamental + 2nd/3rd harmonics with their own decays, 30–120 Hz FM,
  a band-pass formant, trills), and two birds of a species counter-sing from either side. Cicadas come in
  pulsed 4–7 kHz choruses that swell every 10–25 s; rain and wind move with a 0.05–0.2 Hz weather swell
  (±4 dB, ±30 % cutoff, drop density); puddle drips are < 80 ms bubbles; wind chimes are inharmonic tubes.
- Hear it: `?demo=audio&theme=<id>` (also `audio-summer` / `audio-fall` / `audio-winter`, `audio-night` = a summer night,
  `audio-town` = the square on a winter morning, `audio-eve` = the square's evening, `audio-rain` = a summer
  shower on the farm, `audio-coop` = the phantom farmhand, `audio-brook` = the forest brook's babble, `audio-noon` = the
  summer noon cicada chorus, `?demo=audio&ui=inventory` = the menu duck; festivals: `fest-spring` (Ribbon Parade), `fest-fall` (Harvest Reel); `theme` takes a song id or a
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
  intents pan and fade by themselves. Real remote farmhands are voiced by the adapter itself
  (`remoteVoices`): a footfall on every stride of their interpolated walk, and their fishing from their angler's
  state (cast, bite, the reel's ratchet, catch / escape) at their position. Hear it with `?demo=audio-coop`
  (= `?demo=audio&coop=1`: a visible phantom farmhand circles you, stepping, hoeing, emoting, chatting and
  watering). Dialogue speaks each typed word as it appears (the real word: its syllables, vowels, a question's
  rise, an exclamation's accent, a falling line end; words queue so a fast typewriter never stacks them).
- Judge it without speakers: `node scripts/audio-render.mjs` renders every theme (30 s), theme+ambience mixes,
  ambience presets, the SFX reel and three live-director handoffs (`transition-*.wav`, checked for overlap)
  through the real mixer with `OfflineAudioContext` into `shots/audio/*.wav` (+ piano-roll/spectrogram PNGs)
  and prints loudness (LUFS), true peak, clipping, silence, spectral centroid and band balance with flags
  (day themes fail as `DULL` under 10 % presence + air and are reported `mellow` under 12 %; see the calibration note in the script;
  each `mix-*` must hold its ambience within 10 LU of the music — `AMB-BURIED` — and mix WAVs are analysed but only kept with `--keep-wav`). `--describe <theme>` dumps the melody,
  `--stems --only <ids>` solos every track, `--live` boots the game and checks theme-per-scene, audible
  output, 20 beach⇄mine handoffs, the audio-node creation rate and SFX end to end. Renders use the game's
  default volumes and its 72-voice budget. The **gameplay** render (`gameplay.wav`, also alone with
  `--gameplay`) plays the spring theme + farm morning under a scripted 10 s of farming (8 steps, hoe ×3,
  watering, harvest, coin, menu) and reports each effect's loudness over the music under it (400 ms and
  1–4 kHz at the onset; footsteps' onset median must reach -2 dB) and the sidechain dip; `--sfx hoe,axe`
  renders just those effects (`--sfx voices` adds the villager voices). The reel asserts the SFX hierarchy:
  hover ≥ 4 LU under click, select ≈ click, open / close over click, the error cue level with open, the core
  UI set inside 8.5 LU, villager voices within 3 LU, a sword hit ≥ 2 LU over the swing, the tree crash ≥ 4 LU
  over an axe chop, the rock break ≥ 3 LU over a pickaxe tap, sand / snow steps level with the firm surfaces. The composition
  critic (`--compose`) also flags `MASKED-TUNE` (the comping at or above the tune for > 25 % of its notes; the
  composer's `clearTune` pass re-voices comping an octave under the tune)
  and `HOLLOW-MIDDLE` (> 22 semitones between the bass and the next voice). `--coop` runs two real clients over
  the relay: the farmhand must voice the host's hoe stroke as the host resolved it (a soil hit at full level, not a
  dull thunk — the replay carries the host's outcome and is heard from the farmer's real position) and meter it, and both must play the same festival
  arrangement. `__game.info().perf.frame` reports fps, mean / p95 frame time and the audio system's
  main-thread ms per second; `info().audio.notes.tiers` the cache tiers. Every job is
  isolated (a crash relaunches the browser, `report.json` is written after each job).
  `node scripts/audio-lab.mjs` keeps one browser + dev server alive and renders on request
  (`curl 'localhost:5199/gameplay'`, `/reel?names=…`, `/theme?id=…[&solo=melody]`, `/amb?p=…`,
  `/notes?inst=fiddle&seq=69:4,74:1,76:1~,78:2` to audition one instrument, `/calibrate`) for fast iteration.

## Town & villagers

Hearthvale town (`src/world/town/`): the plaza with its fountain and the Lantern Hall, Thimble & Pip's store,
The Hearth Oven bakery, the market row, the river with the Kettle Bridge and a rope footbridge, Flint & Ember
forge, The Copper Kettle inn, the Birch house + lumber yard, the lamplighter's cottage, and Meadow Lane in the
south (Willowmere Clinic, the schoolhouse with its bell cupola, the Pennywhistle cottage's kitchen garden, an
orchard). Street life: everyday festoon lights (`world/town/festoons.ts`: strings over the plaza, a zig-zag over the
market row, the inn terrace; on from dusk, coloured holiday bulbs in winter), songbirds, the town cat asleep on the
west plaza bench; winter adds shovelled cobble lanes with snow banks along their edges, drifts against every building,
snowmen, snow lips and icicles along the house eaves and winter goods on the produce stands (burlap lids, firewood,
preserves, wool), and the fountain freezes over (`world/town/winter.ts`). The Hall's door wreath is dressed per season
(blossoms in spring, daisies and sunflowers in summer, russet leaves in fall; bare holly in winter). House roofs carry
segmented ridge caps, dormers, chimneys, moss and slipped tiles (`buildings.ts buildRoofDressing`).
Layout data lives in `world/town/layout.ts` (buildings, streets, props, trees, festoons, snowmen, named `SPOTS`).
Static props are merged per 12 m cell and fed to one `BatchPool`: one multi-draw per material, per-cell culling.
Meadow Lane breaks the shared house template (`buildings.ts` silhouette kit: `dormer`, `porchRoof`, `roseTrellis`):
the clinic has a portico, two dormers and climbing roses, the Pennywhistle cottage a veranda and a dormer, the
schoolhouse a lean-to woodshed; the south lawn has a picnic and meadow flower clumps (`picnic`, `wildflowers` props).
Tree canopies whose centre projects into the bottom ~22 % of the frame are hidden while they're there
(`npcs.lensCull`, outside conversations and events), so foreground blobs never fill the lower third of the view.
Schedule spots resolve to sub-slots 1.2 m apart (chibi heads never touch) and idle villagers keep 0.9 m apart.

Ten villagers (`src/data/npcs.ts`): look (height, build, face, 11 hair styles, hats incl. earmuffs, outfits,
accessories) with a seasonal `wardrobe` (winter coats, scarves, knit hats, mittens, long sleeves — no sunhat in the snow;
`seasonLook()`; a changed look rebuilds the villager's mesh in place), winter bark pools and winter schedules (fewer
idlers: the inn, the forge, indoors), walk style, schedule + rainy schedule over named spots (A* on the tile grid, `world/town/pathfind.ts`; seven of them work the
square between 9 and 12), activities (sweep, read, paint, water, knead, hammer, saw, fish, sit, play, chat…), gift
tastes, birthday, dialogue groups (first meeting, birthday, season, weather, hours, hearts; `[mood]` tags swap the
portrait) and two heart events each (scripted mini cutscenes: walks, emotes, choices with friendship deltas, extra
actors such as Pip the shop cat).
- **Models** (`entities/villager.ts`, one skinned mesh each, frustum-culled): chibi heads (1.2×) tilted chin-up so
  faces read from the diorama camera, glossy eyes, an ink-edge + rim shader instead of an outline pass, 13 gesture
  clips (hand to chest, shrug, laugh, look down, point, wave, think, wring, surprise, stamp, nod, open arms, hug)
  that follow each line's mood, squash and stretch, emotes as AO-safe billboards. Face moods: squinting cheek-lift
  smile (happy) vs a small calm mouth (neutral), ^^ laugh, a 35° knitted V with a crease (angry), tented brows + tear
  (sad), freckles. Idle facing, look-arounds and arrival yaws favour the lens (±70°); hat brims tip back. Seated actors
  keep the bench's yaw and turn only their head (`headLook`). Night talks / events lift faces with an albedo-relative
  lens-side fill (`VILLAGER_FILL`: deep skin tones keep their colour and read).
- **Camera director** (`systems/npcs.ts`): heart events cut between wide, two-shot and close-up; the angle is
  scored so the speaker is three-quarter to the lens, the listener or a bystander isn't in front of their face and no
  building cuts a sight line (swing ±15–45°, raise, pull in), trees in the way are hidden (sphere-cached), and the
  actors sit above the dialogue box; tilt-shift focuses on them. A speaker who addresses a thing (a lantern, a rose, a cat
  on a roof) gets a reverse three-quarter lens in front of them instead of their back; villagers who turn to another actor
  (or to the farmer in a chat) cheat ~25° open towards the lens; unlit festoon cords come down for daytime events.
  `npcs.auditEvents(id?)` checks every talky beat of
  all 20 events (incl. actors standing inside a bench / prop), `npcs.auditFaces(id?)` renders every night beat and reads
  back the speaker's face (sRGB luma ≥ 42; the dark-crushed r3 frame measured ≈ 20), `npcs.auditTalk(hour?)` solves the live talk lens for every villager at their
  spot (fountain / bystander-in-front clutter is scored for both talks and events). Conversations lean in the same way
  through the look offset (no cinematic, so co-op farmers stay visible). Heart events keep up to four villagers behind
  the scene (or bring a chatting pair out) so the town lives on in the background.
- **Co-op** (pillar 13): the host streams villagers (`v.s`), a farmhand's talk locks the host's villager onto them
  (`v.t`); friendship stays per player but is host-authoritative (`relationships.ts`: farmhand intents `r.talk` /
  `r.gift` / `r.ch`, the host's ledger answers `r.set`); every gift's reaction is broadcast (`v.g`: the item arc, hearts /
  puff, the villager turning to the giver on every client); the host's heart events play for farmhands in town as
  spectators (`v.e` / `v.l` / `v.c`: title card, the lines, the choice locked "Waiting for the host…", the answer).
- **Gifts**: the item arcs from the farmer's hands, the villager squashes and reacts (hug / open arms / shrug),
  hearts, sparkles or a grey puff burst over the head, and the new heart pops on the meter.
- `systems/relationships.ts` owns points / hearts / gifts (`meet()` for demo staging), `ui/dialogue.ts` the typewriter
  box (name tab, top-left layout-stable text, choices, gift ribbons, heart meter, birthday toast), the 'social' page and
  the 'portraits' model sheet. **Portraits are the villagers' own 3D models** (`renderVillagerPortrait` in
  `entities/villager.ts`: the same mesh, outfit for the season, face rig and gesture for the mood, a three-quarter bust
  under a studio key / fill / rim light in a small dedicated WebGL context, a baked ink outline), composited by
  `ui/portraits.ts` over the painted backdrop with the mood's colour temperature (warm gold joy, cool blue sorrow,
  red-rimmed anger) and manga marks; cached per villager × season × mood and pre-warmed when the talk prompt pops.
  The painted SVG bust remains the no-WebGL fallback. **r5 painted pass** (`PORTRAIT_PAINT`): the bust renders into a
  lit target plus an id target (flat albedo + the RigBuilder `part` id: skin / hair / eyes / cloth / hat), then a painter
  shader turns it into an illustration — Kuwahara brush patches, coloured ink on every material boundary, cel bands
  relative to albedo, radial hair strands with a jagged shine ring on the lit side, warm skin / cool cloth shadows, a
  painted rim and canvas tooth. Each villager has their own eye cut (`eyeShape`: round / wide / almond / narrow /
  sleepy / beady, `lashes`) and brows (`brow` thickness, `browArch`); full beards have a mouth hollow and combed strands.
  Farmers dress for winter like the villagers (`dressFarmerWinter`: beanie, coat, scarf, mittens; farmhands get a
  beanie + scarf look and the coat overlay). Heart events can carry hero props (`ledger` held on a lap, Kit's `map`,
  forge `sparks` with a glow light); the event lens scores lamp posts behind a head (tangents), keeps the listener out
  of the near foreground and backs off until every framed head fits the letterbox (`auditEvents()`: 78/78 beats).
- **r6**: *Body proportions* — `NpcLook.torso / shoulders / belly / neck / hands` drive a rig-space warp
  (`RigBuilder.warp`: the torso stretches, the shoulders square up behind a yoke, a belly pushes out, arms and
  held props ride with the shoulder) so the cast reads by silhouette: Kit 1:1.6 heads, Bram a barrel with a
  rolling pin, Linus lanky with a long neck and a doctor's bag, Odessa and Rowan tall and broad, Marigold and
  Hazel short and round; signature belt / shoulder pieces (`rollingpin`, `tongs`, `docbag`, `keys`, `trowel`,
  `lantern`, `towel`). *Portraits* — the painter posterises each material into hand-tuned ramps with
  hue-shifted shadows, inks material edges ~4 px plus normal-break contours (jaw, nose, ears, arm over chest),
  lights hair clumps on the key side, crops tighter, and the brows + mouth are drawn as 2D ink linework over
  the bust in the face's own frame (`drawFaceInk`: a 45° anger V with clenched teeth, tented sorrow, an open
  "D" grin, a round gasp, a quizzical brow; `PORTRAIT_INK`); a tenth mood, `wistful` (lowered lids, soft closed
  smile, one tear). *Lens* — non-participant villagers in the near / low foreground of a chat or scene step
  out of the shot (`fgCull`; `auditTalk` fails > 8 % coverage), the event's owner opens to ≤ 50° of the lens
  (`cheatOpen`, seated owners pull the lens round to the bench front), no pole / trunk within 0.6 head-widths
  of a framed head (screen space, scored + audited), the portrait card never covers a face (the frame pans),
  and an event's `subject` (the Kettle Bridge in "Painting the Bridge") must be in the opening wide shot.
  *Co-op* — farmhands spectating a heart event ride the host's lens (`v.k` at 5 Hz, eased via the look offset,
  the host's farmer stays visible) and the heart row shows the host's friendship ("Host's friendship · 2♥").
  *Dialogue* — box and portrait card are one joined, equal-height frame with a riveted seam; `town-dialogue`
  meets each villager at their place of work (`&at=square` for the old plaza staging); no ambient emotes or
  "Now playing" card during a talk; speech bubbles rise over co-op name tags; barks carry context tags
  (`{store_front}…`, `{@kit}…`). *Gifts* — a 0.5 s eased arc a beat after the box opens, a hit-stop squash
  on the catch, and the item held up at the chest through the reaction line. *Town* — a restoration scaffold
  (tarp, paint pots, "Friends of the Hall" board, ivy) over the Hall's west window, and seeded street-edge
  dressing along Meadow Lane (wildflowers, pots, picket runs, mailboxes, barrels).
- **Round 7** — *Faces*: `NpcLook.fp` (FaceShape) gives every villager their own head under the hair: skull
  width / length (crown anchored), jaw block, pointed / soft chin, eye size / spacing / height, six noses
  (button, bulb, long, hook, snub, broad), mouth width, age lines (crow's feet, bags, smile folds, forehead),
  cheek discs, ear size, cleft — the 3D head is built from it, so the painted bust is too. Stubble is a
  skin-tagged jaw band (r6's hair-tagged shell sat over Rowan's eyes) and the painter's hair ramp keeps the
  hue (dark hair no longer glints grey); beards / moustaches are id 6. `npcs.auditPortraits()` renders every
  bust in every mood and fails on hair over the eyes (> 22 %) / nose bridge (> 20 %) or painted hair colour
  off the look; it and `auditEvents()` are in `npm test`. Every mood is cropped to the neutral pose's head
  (curls, buns, beanies and brims fit). *Heart events* — each event carries `insert` cards: a painted close-up
  (`ui/portraits insertArt`: the letter, the canvas, the ledger, Pip on the board, the charcoal loaf, the
  lantern cage, the last match, Kit's map, the seed tin…) taped up beside the scene while a line about it
  plays (spectators too); the letter events hold a letter at the chest; in a close-up the farmer steps out of
  frame when nearer the lens than the speaker; the card-avoid pan never pushes an actor off the left edge.
  *Live talks* — the farmer slides back to a 1.3 m gap, demo-marked bystanders step aside too, anyone clipped
  by the frame edge at the pair's depth is culled, and dev builds self-audit the open talk
  (`npcs.liveAudit()`). *Co-op* — a farmhand's gift waits for the host: ghost hearts breathe on the row
  ("Gift on its way to the host…") until the host's `r.set` acks; no ack in 9 s rolls the lock back and
  returns the item. *Box* — amber parchment, 34 px ink, the box hugs its text (≥ 3 lines) with the portrait
  card standing taller at its end, the gift ribbon under the name plaque at 18 px. *Gifts* — a loved gift
  hops (0.3 s, squash), pops a heart emote and a sparkle where it lands; the line waits for the arc.
  *Town* — a "Relight the Hall" banner over the east window (no more red X of boards), festoon masts 0.4 m
  higher, winter / day chat pairs side by side across the view, 1 m personal space, barks never repeat in a day,
  bark bubbles carry a name tab in the speaker's colour, and `town-evening` sits on a closer, lower lens (faces
  read, the Hall's rose window crowns the frame, the fountain clears the toolbar). Live talks also re-block the
  farmer across the lens (clear of lamp posts) and drop bystanders within 2.2 m of the pair from the shot.
- **Round 8** — *Live talks*: every F-talk runs the scored lens solve the demos use (`liveResolve`: up to
  four re-blocks of the farmer / villager, keeping the placement with the fewest `talkFrameFails` — a post
  between the pair, a pole on a head, the lens inside a prop, a sight line behind a building, a head cut
  by the frame); `npcs.auditLive([9, 13, 17])` stands beside every villager at three hours and is in
  `npm test`. *Portraits* — the dialogue cards are the painted SVG busts (`portraitOpts.model3d` keeps the
  3D-bust A/B): ink outline, two-tone cel shadow, a drawn jaw and chin, gradient-oval blush, brows clamped
  above the iris, a backdrop picked for a ≥ .25 value gap from the skin; `auditPainted` gates brows / value
  gap / face fill. Sad / worried lids are a mauve crescent tucked under each eye (the blue cheek ellipse
  read as a bruise). *Bubbles* — a screen-space solver places every bark clear of all head boxes (its own
  speaker's too), other bubbles, name tags and the frame edge, with a separate tail aimed at the speaker's
  head; a speaker turned away behind a nearer head fades. *Faces* — villager bodies draw into the AO
  G-buffer (`userData.ao`): flagged out, the AO of whatever stood behind them was multiplied onto their
  pixels — the grey-brown jagged 'muzzle' on lower faces, cookie-dough blotches on Kit's / Wren's hair, the
  dark disc on Rowan's cheek. Jaw / cheek / chin masses shade with the skull's own normals
  (`RigBuilder.nrmTo`), the soft-chin pad is gone (from the chin-up tilt it sat over the mouth as a disc),
  ears are skin, stubble stays in the jaw band, and a face LOD grows eyes / brows / mouth ~18 % beyond
  ~18 m. Talks and events by day get a gentle lens-side key too. *Staging* — showcase marks open to ≤ 45°
  of the lens; june-2 tips Rowan's chair back; odessa-4 puts the lantern cage in her hands; wren-2 turns
  the canvas to the lens; the farmer steps out of any tighter event shot when well in front of the
  speaker; chalk A-frame boards with a painted menu on both faces (`world/town/aframe.ts`). *Demos* —
  `town-day` / `town-winter` on a lower, wider lens (the Hall's rose window in frame, the farmer facing
  the lens), winter's lower third gets Marigold sweeping snow and Kit playing, `town-cast` lines the
  ten up south of the benches, and `town-dialogue&npc=…` no longer flashes Marigold's default line first.

- **Round 9** — *Performance*: villagers carry a second, half-segment mesh on the same skeleton
  (`entities/villager.ts` `SEGK`, `lodFor`; past 19 m of lens, `?vlod=<m>`, 0 = off): ~13k → ~5k
  triangles a body with no visible change at plaza distance; far street clutter (pots, barrels,
  sacks, wildflowers, crates…) is batched per 12 m cell and drops out past 40 m of the lens
  (`?farclutter=`); the stone bridge's 80 blocks lost a bevel segment (65k → ~40k with shadow);
  slimmer wildflower stems. *Relationships* — every heart-event answer leaves a memory flag
  (`<npc>.<word>`; `relationships.recalls / remember / townRecalls`, saved; co-op: per farmer,
  host-authoritative, `r.mem` up and the host's town memory `r.hm` down). 30 new scenes at 6, 8
  and 10 hearts (the 8s are invitations: supper, choir, a studio sitting, the workshop, the clinic's
  open evening, the longest night, the lamplighter's anniversary, the dock club, a housewarming, the
  seed swap) whose `if` / `unless` steps quote the earlier answers back. `keeps` turn memory into
  consequences: barks, changed routines on fair days (Tobias's tea on Rosalind's bench at ten,
  Odessa's night rounds at the hall lantern, Linus fishing, Hazel watering the seed beds…), flag talk
  lines, keepsakes left in the town (Pip on the shop step, a rhubarb pie on the bench, the lantern
  cage on the hall step, Rowan's mended chair at the inn, a second candle on the inn step, Wren's
  river painting by the water, Rosalind's rose in bloom) and cards pinned on the notice board (Kit's
  map, the clinic, the choir, Friday supper). *Co-op cinematic mode* — during a heart event the
  roster, chat log, watch chip, emote nudges and name tags step out (`body.hv-cine`); the spectator's
  title card names whose scene it is and the heart row reads "Juniper's 4♥ · yours 2♥".
  *Portraits* — a per-villager `Persona` (ui/portraits.ts): iris-to-white ratio, lash / lid
  weight, under-eye bags, a resting asymmetry, a mouth of their own (prim, wide, full with lip
  colour, gap-toothed, soft, lopsided), crow's feet / forehead lines / jowls / cheekbone hollow, a
  flour / soot / paint / dirt smudge, shoulder width and slump, and only the marks they would make
  (Tobias's and Bram's jaws set instead of a tear — the 3D face agrees; Odessa's one tear is rare; Bram
  sweats; Kit does everything). *Town* — `town-day` is now
  an establishing frame (plaza edge, bakery, market row, Kettle Bridge, river) with the town at work
  in asymmetric knots: free marks (profiles, backs, no lens cheat), walkers on real A* paths caught
  mid-stride (`&live=1` lets the demo run), a `carry` activity (crates of stock, on Bram's, Marigold's
  and June's schedules); `town-square` keeps the old plaza frame. *Winter* — the villagers' winter
  routes rasterised into a traffic field: grey-brown slush on the busiest lanes and stamped where
  people stand, boot-print trails off the cobbles, shore ice and floes on the river. `town-evening` is
  re-blocked the same way (Tobias at the lantern with his back to us, a knot of four at the bakery, two
  friends walking home, Linus crossing the foreground).

- **Round 10** — *Faces*: Odessa's headscarf sits on her brow over a visible hairline band (it was
  tilted back over a bald dome of forehead: "a featureless brown sphere"), with bigger eyes and
  brows; Tobias's pale moustache droops as a flattened walrus a shade darker than his beard (the
  upswept white wings read as tusks beside a white nose) and his hair tips back under the flat cap
  (no white sweatband under the brim). *Talk lenses*: small street props (logs, stumps, barrels,
  crates) looming in the near foreground of a talk / event lens drop out with the bystanders and tree
  crowns (`NpcSystem.propBalls` / `fgProps`: nearer than ~70 % of the focus distance and filling
  more than ~2.5 % of the frame; Rowan's lumber-yard talk had a dark stump blob over the box). A
  scene's painting turns its face to the lens on a cut (wren-2 showed the blank back of the canvas),
  and Wren's insert card is the same swirling, won't-sit-still river as the canvas on her easel.
  *UI*: the heart strip is pinned to the portrait's foot (a gift ribbon slid it over the name
  plaque); bark bubbles and emotes ignore fog (far barks read as ghosts in the town-day haze); the
  portrait value plate goes deep cool slate when the backdrop's hue sits within 45° of the skin
  (Bram's tan face on sunk bakery orange). *Blocking*: `town-day` puts June on the far side of her
  chat with Hazel (face and bark to the lens), `town-winter`'s Kit plays in clear snow right of the
  fountain (the bowl's rim cut him off at the chest), `town-evening`'s knot of four opens up so every
  head reads. Kit's mop is a shallow, near-even shell under the tufts (deep hem scallops showed bare
  scalp between the locks: "cookie dough").

- **Round 11** — *Plaza identities* (r8 critic: "two near-mirrored storefront masses"): Thimble & Pip's
  gets a jettied, half-timbered loading gable that breaks the eave and climbs nearly to the ridge
  (painted name board on its band, a loft door open on a lit storeroom, a hoist beam with a pulley and
  a crate of stock mid-lift; `buildStoreFront`); The Hearth Oven a domed brick bread oven on its plaza
  gable with a glowing mouth and a firewood stack, a tall round smoking flue, a louvred ridge vent
  under a gilded wheat-sheaf vane and a painted board standing on the roof (`buildBakeryFront`). The
  twin dormers are gone; both boards share one canvas atlas and skip the shadow pass, the oven glows
  in the shared `lampGlow` (no new draw call per pass). Hazel's cottage grows a plant theatre on its
  west gable: white posts under a whitewashed glazed roof with a vent propped open, three tiers of
  staging crowded with potted blooms, hanging baskets, a potting bench and a water butt
  (`buildGlasshouse`). *Coverage*: `town-winter` now sits on the town-day establishing lens (the
  bakery's flue smoking, the market under snow, the iced river and the Kettle Bridge) with its own
  winter blocking (Bram hauling a crate to the oven, Marigold clearing the market lane, Kit by the
  snowman, Odessa and Rowan at the stall end, Wren painting the frozen river, Linus trudging to the
  clinic); the old plaza frame is `town-winter-square`. `town-evening` swings 26° round to the
  bakery and the market row (Hall left, oven board centre, stalls right, fountain foreground) with
  Marigold and Hazel setting off home, Wren drifting over to the bakery knot and Linus crossing the
  near foreground. *Street life*: a sweeper pushes a seasonal drift (petals, clippings, leaves, snow
  clods) along the cobbles stroke by stroke into a pile at the broom's end; a reader turns a page now
  and then. *Heart events*: a close single drops a farmer standing off to the side (odessa-4's dark
  hat at the left edge, the blind judge's "out-of-focus foreground figure"); Odessa's headscarf comes
  forward to her brows and the broad nose's alae tuck into the tip (they inked a snout).

- **Round 12** — *Heart-event staging*: an intimate line (sad, blush, worried, wistful) or a question is
  said to the farmer — a speaker still turned to the anvil / lantern turns round first (`addressFarmer`;
  odessa-6 had the director swing a reverse angle through the forge roof with the farmer stacked behind
  her). The lens solve and `auditEvents` now measure how much of the frame a building's walls / eaves
  cover in front of the actors (`roofCover`: a 9 × 6 grid of lens rays) and fail two actors' heads
  stacked on screen or standing < 0.9 m apart; a farmer stacked with an actor or sunk behind the box
  steps out of the shot. kit-10 turns to the farmer before the club rules; hazel-2 stands beside the
  planter, side-on to the square (the reverse angle squeezed between the Hall and the store and looked
  down on her sun hat); stone-bridge pillars count as waist-high posts, not lamp posts.
  *Live cutscenes*: every event shot breathes (a slow 2° drift and a 4 % push-in from the cut), and while
  a choice is open the asker holds the portrait's `thinking` face with a living think pose (chin tap,
  sway, a glance down at what they are weighing) — for co-op spectators too. *Live talks*: a closer,
  lower lens (6.5 m, 20°, `?talkd=` A/B) centred on the villager, faces at ~10–12 % of the frame near
  the upper third; the plaza posts' hanging lanterns (face height) count as occluders and a post or
  lantern over / level with a face is a hard fail in the re-block; a villager showing the lens the back
  of their head costs far more; close lenses keep their background (`lighting.fogDistMin`). *Faces*:
  the 3D eyes are the portraits' eyes — a warm white, a big iris in the villager's own colour (dark rim,
  bright lower crescent, pupil, two catch-lights) and a heavy upper lash line with an outer flick
  (per-villager iris size / lash weight from the painted Persona); the `thinking` face is pushed so it
  reads from the event lens. *Barks*: the bubble's bottom edge sits ≤ ~0.6 m over the speaker's head
  (sliding sideways rather than up) with its tail on them, a dark walnut name chip with cream lettering
  and a dot in the villager's colour, and no bubble for a speaker off screen or behind a building.
  Emotes that would cross the top of a close lens slide down beside the head. `&ask=1` stages straight
  to one of the villager's own questions with the choices up; joking lines carry happy / laugh tags.
  *Portraits*: brows carry the mood (anger's inner ends drive down ~25° with a hot flush over the nose
  and a shadowed brow ridge, sorrow's lift hard), sad slumps, wistful looks away, the thinking bubble
  stays inside the card, every hair lock gets three tones (a dark parting line, the lit band, a sheen
  strand). *Winter*: the fountain freezes (ice sheets with cracks, trapped air and blown snow over the
  pool and the bowl, the crown jets frozen mid-arc, overflow caught as icicle columns, icicle fringes;
  `fountain.ts buildFountainIce`), a cold blue contact shade pools round every building and prop
  (`winter.ts buildWinterShade`, one multiply decal), and `town-winter` is a clear winter afternoon.
  *Town*: plaza wear (`plaza.ts`: a polished foot-traffic ring and desire lines to the shops and Hall,
  moss in the quiet joints, damp under the basin, petals blown into the corners); `town-establish`
  frames the east bank in one shot — the Kettle Bridge in front, Flint & Ember left, The Copper Kettle
  right, the town busy on it.

- **Round 13** — *Portraits* (critic blocker: "of Bram's 10 moods maybe 3 read"): the eye SHAPE carries
  the mood (`MOOD.lidO / lidI / lowUp / irisK` in `ui/portraits.ts`): a relaxed lid at rest, a smile
  squint, anger's lid slanting down into the nose over a raised lower lid, sorrow drooping at the outer
  corners, half lids when wistful, white all round a small iris in shock; the lash line rides the
  dropped lid. Brows are drawn over a hat brim / toque band (Bram, Tobias, beanies) and the toque sits
  higher. Every mood has its own mouth shape (gritted teeth with tooth gaps, a frown with a trembling
  lip, an open crooked worry, a lopsided wistful smile) and a full beard gets a warm lip window with a
  near-black interior so the mouth reads through the hair. Gruff men (`Persona.gruff`: Bram, Tobias,
  Rowan) lose lash flicks and rosy cheeks outside a real blush / belly laugh. Hazel's red lip stripe
  and cheek smudge are gone, Wren's paint is two crisp swipes low on the cheek. Cards take the
  scene's light (`setPortraitLight`, from the hour): dusk a rose wash, night a blue-violet place with
  lamp bokeh, a warm key and a cool rim. Gates: `npcs.auditPortraitContrast(min = 9)` rasterises every
  card and fails a mood whose face region differs from neutral by < 9/255 (worst now 13.5);
  `npcs.auditPalette()` fails two villagers' coloured outer garments within 20° hue and 0.1 value in
  any season (Rowan's winter coat is now teal over a mustard scarf, Kit's top a redder orange).
  *3D faces*: the mouth is four shapes on their own bones (`B.mouth` the closed smile / frown line —
  a shallow arc hung from one point, never a V — `mouthO` an open grin with teeth and tongue, `mouthR`
  a round 'o', `mouthT` gritted teeth), chosen per mood like the card; a talking line mouth opens into
  a small flapping grin. The mouth sits clear of the nose (Odessa's frown on her broad nose's tip
  read as a beak); the tear is a small wet streak tinted through the skin; sleeves end in turned-back
  cuffs. *Dialogue*: the gift ribbon is pinned over the card's top edge (the column never grows over
  the name plate), the item arcs from the farmer's hands on the villager's side and is caught at the
  chest; `&mood=` demo lines only come from groups the relationship can reach (no first meeting at
  7 hearts). *Heart events*: tobias-8's tea is a cup and saucer in his lap; wren-2's farmer stands
  lens-side so her question is a two-shot with the farmer and the painting faces the lens between
  them. *Winter*: a thin snow dust over the cobbles, cleared along the villagers' A* routes (the
  trodden lanes read against white), boot prints as paired pressed ovals with a packed rim, 1.6x
  snowmen, and the lawn grass sleeps under the snow (the dry blades read as twigs). *Town*: clipped
  hedges built as one irregular body (`world/town/hedge.ts`, no more caterpillar of balls); a sandstone
  sett ring round the basin and a herringbone brick runner break the plaza's cobble field, with two
  near-mirror rain puddles; a low picnic replaces town-day's blown-out foreground parasol; Kit runs at
  the lens. `town-evening` is 19:36 (violet ambient, warm lamp pools, the Hall's rose window in
  frame). *Perf*: villager mesh LOD at 15 m (was 19).

- **Round 14** — *Cherries* (critic: "the cherry tree is a pink cotton-candy blob with no branch
  breakup"): the town's blossom trees are grown one by one (`world/town/cherry.ts`): a leaning S-trunk
  forking into four or five arching boughs that fork again, a cauliflower cluster on every fork tip (a
  body plus three or four lobes, flat shaded undersides, gaps where the dark wood shows), crown
  clusters over a leader, bare twigs poking out. The blossom shader paints five-petal florets (3D
  cellular: pale petals, magenta eyes, buds, deep rose in the gaps, mauve under the clusters, sun-side
  glow); in spring a petal drift lies under each tree (downwind-skewed) and petals flutter down out of
  the crown (vertex-animated; lying and falling petals share one instanced draw); summer green, fall
  amber, winter bare boughs. One BatchPool (bark + bloom), ~40k triangles in town-day; the rim forest
  no longer plants generic blob blossoms (their batch cost two draws in every town frame) — smoke's
  town budget 298 calls. The cherries sit under a `trees` node, so the talk / heart-event lens culls a
  crown looming between it and the pair. *Held props*: a heart-event prop is held, not
  pinned to the chest — a chest prop (letters, the map, the ledger) is cradled in both forearms
  (applied after the mood gestures), and Odessa's lantern cage hangs plumb by its ring from her raised
  right hand (`holdProp(…, 'hand')`). *Faces*: Rowan's face is shorter with round eyes and a wider smile
  (the sleepy lids and long jaw read as a blank stare in the cast); the doctor's eyes a touch larger;
  Odessa's headscarf has a fine print and a slim hem (big white dots on a red dome read as a toadstool).
  *Blocking*: town-day's Kit runs clear of the laundry line, Odessa walks up the road in view (she was
  behind the bridge abutment / the cottage roof), Marigold and winter Linus step off the festoon poles.

- **Round 15** — *Determinism*: every run-time choice the town makes (villager blink / look-around
  phases, wander targets, chat moods and emotes, bark cooldowns, gift-burst sparkles, forge sparks)
  draws from a named stream of one town seed (`world/town/rng.ts`: `townRng('npcs.idle.<id>')`, no
  `Math.random` left in the town code); demo staging reseeds it, `?townseed=N` picks another take and
  `__game.info().town` reports `{ seed, streams: draws per stream, seq }`. *Capture sequences*:
  `&seq=<seconds>` on any town demo hands shot.mjs `--frames N` a sim clock (`__game.seqFrame`: frame i
  = the game stepped in 1/30 s ticks to i·seconds/(N−1), holdLoop on) — the typewriter runs on that
  clock, finished lines and choices advance themselves (`dialogueBox.clock / pump`), fades are skipped;
  `town-heart-event&seq=` plays the scene for real from `&step=` (default: two lines before the choice),
  `town-dialogue&gift=…&seq=` the whole gift, `town-day&seq=` the town's walkers / sweepers / readers.
  *Co-op*: a spectator's heart strip is two labelled rows, the host's hearts ("Juniper") and "Yours",
  each with its count (r14's `spectatorHearts` was never wired to the box — the critic's empty row);
  host-owned choices carry a padlock, "Juniper's choice — waiting for them to pick…", and the host's
  pick lights up before the reply; `town-heart-event&spectate=1` stages the farmhand's view
  (`&seq=` plays the handoff). *Dialogue*: the parchment hugs its text (a one-liner is a ~115 px slab,
  the portrait card keeps its size and stands up out of the frame). *Dusk / night tone*
  (`world/town/tone.ts`, a chained scene.onBeforeRender like the mine's): through the blue hour the sun
  loses its red, the sky fill turns cool lavender and lifts 40 %, the magenta haze cools, red gain /
  saturation / bloom come down; at night a cool moonlit fill keeps the frame's thirds out of
  near-black; lamp pools are gold, broader and softer (decay 2 → 1.45, 8.5 m). *Winter*: roofs carry a
  stepped snow pack (`buildings.ts roofSnowWinter`: strips 10–17 cm thick whose reach wanders up the
  slope, a wind-packed roll on each step, a back-eave cornice) over melt-darkened wet tiles at the ridge
  (its own no-snow material) — every house in both districts; floes are broken plates, snow lies on the
  river ice in long wind streaks. *Landmarks*: the forge's west gable (the bridge road's view) gets a
  slate anvil-and-sparks emblem, a horseshoe rack, a cartwheel, iron hoops and an anvil weathervane; the
  inn's gable cross-braced timbering, a big round copper-kettle emblem, wall lanterns and a copper-capped
  louvre cupola on the ridge. *Faces*: Odessa's kerchief is the portrait's (bold dots, a rolled band,
  the knot and tails at her left temple), with larger eyes; odessa-4 is re-blocked so the HALL CLOSED
  notice reads beside her. *Perf*: villagers past ~30 m leave the shadow pass; the roof packs use
  single-segment bevels.

- **Round 16** — *Talk lens*: while a talk / heart event owns the frame every farmer's opaque parts
  opt into the GTAO G-buffer (`npcs.farmersAO`; farmers skip it for perf, so the AO of the bakery
  window behind printed through the hat like a ghost). A lens cut-away (`world/town/lenscut.ts`): the
  director publishes sight capsules (lens → each framed head and body) and every town street-prop
  material screen-door fades the fragments inside one, nearer the lens than the actor (the lamp-post
  lantern over the farmer's face in a real talk); live talks also fade props ≥ 1.3 m in front of the
  nearest actor (the bench across the foreground). Static props are merged per cell, so this is per
  fragment, one uniform branch when off. Grass round the speakers' feet shrinks to a lawn during a
  talk / event (`installGrassClear`), no grass grows on paved lanes, and a sizeable bystander head
  beside the pair's heads steps out of a live talk (Kit's big head in the background).
  *Portraits* (`portraitOpts.chibi`): the painted busts take the models' chibi grammar — a rounder,
  shorter face, big low-set eyes with a large iris, a toy nose (a soft wedge under a lit dot), a small
  mouth with no lip shapes, smile folds, jowls or cheekbone hollows, narrower shoulders; curly hair is
  the model's cloud of big puffs (no sausage coils); neutral brows relax (June's neutral read as a
  scowl); the crop keeps the face ≥ 57 % of the card. *Gifts*: produce is held as the real 3D crop
  mesh in both hands, lifted from the waist over 0.3 s (ease-out-back); the heart burst stays a tight
  crown round the receiver's head. *Heart events*: wren-2 "Painting the Bridge" re-blocked across the
  river — Wren at her easel facing the water and the lens, the farmer at her shoulder on the lens side
  (both faces three-quarter in the choice two-shot), the painting between them, the Kettle Bridge
  arching beside them; an event `subject` with `hold` stays in every two-shot (scored in the lens
  solve). Chibi portraits keep the chin on the neck (the crown comes down; Kit had a giraffe neck),
  no lid creases, and Odessa's kerchief print stays inside the dome. The stone bridge's end-post flower pots floated on the deck axis 1 m up (the critic's "stray
  red octagonal prism"): gone. *Street life*: town-day has a verb in most hands (Marigold sweeps the
  market lane, Rowan and Odessa haul crates in — walkers carry while walking — Tobias reads, Bram
  unloads, Wren paints, Kit runs); the evening bakery knot opens to the lens; Odessa is taller and
  leggier, Marigold, Hazel shorter, Rowan taller. *Barks*: a far bubble grows to keep ≈ 8.5 % of the
  frame height (×1.9 max) and writes a near depth so the post-process height fog no longer greys it.
  *Town*: Hearthvale's own sett texture (`world/town/cobble.ts`: smaller stones, per-stone hue and
  value — sandstone, blue-grey granite, a few mossy stones — worn chipped edges, a polished crown);
  roof moss clumps each their own size, stretch, turn and tone; June's tea towel is two thin bands
  hugging the bodice (no paper tabs); Odessa's bandana carries a fine cream-gold print (no toadstool
  spots; the portrait agrees). *Winter*: a clear cyan-blue sky fill and blue shadows on the snow, a
  warm cream sun, exposure and gain off the clip with more contrast (`tone.ts`), roof snow in wider
  overlapping strips along one slow wave (no stair-step jaggies), slush warmed to a brown-violet melt.

- **Round 17** — *Crisp bubbles*: villager barks and emotes sit on their own layer (`BUBBLE_LAYER`)
  and NpcSystem draws them over the finished frame (`game.afterRender`, the remote-emote precedent) —
  the tilt-shift no longer smears a bark in the soft top band of the establishing lens; a turned-away
  speaker behind a nearer head keeps a whole bubble (the 35 % ghost read as a glitch in town-coop).
  *Close lenses*: any lit festoon string hanging in frame nearer the lens than the nearest actor
  comes down for the shot (odessa-4 had a row of blown bulbs across the lower third). *Faces*: the 3D
  'thinking' face arches one brow and half-drops the lids with no inner-down knit (it read as a scowl
  while the card mused). *Gift tag*: the "Loved it!" ribbon hangs from the card's top edge over the
  scene, never over the portrait's hat or brow. *Town*: hero cherries grow smaller blossom clusters
  with air between them, satellite sprays on the twigs, fresh leaves among the florets and a warmer
  pink (the crown read as one lilac cloud); sun-faded stall canopies and shop awnings (the near-white
  stripes clipped in town-day); Kit's chalk on the plaza (a numbered hopscotch court, a smiling sun, a
  heart, an arrow to the bakery, a dropped stub) breaks the foreground setts of the plaza lenses; the
  dusk tone is bluer (sky fill, ground, fog, gain) so the evening plaza reads blue-violet under warm
  pools; in winter the swept lanes keep snow in their joints and a thin uneven dusting. Evening knot:
  Odessa stands at Bram's left instead of between him and the lens. *Planters* (`hedge.ts
  buildTownPlanter`): the town's stone planters hold a cottage-garden mound of small leaf lobes, leafy
  spills over the lip, five-petal blooms in the box's colours and staked lavender spikes (they were a
  row of green balls with pastel eggs).

Demos: `town-day` (the square in full swing, villagers spread over the steps, stalls and benches), `town-river`
(the stone bridge, market row, river and inn terrace in one frame), `town-establish` (the Kettle Bridge with the forge and the inn either side, r12), `town-evening` (19:05, lamps lit, the bakery and market row), `town-winter` (the establishing lens in snow,
its own winter blocking), `town-winter-square` (the plaza in snow), `town-coop` (two scripted farmhands: Juniper chats with Bram, Pip gives Wren strawberries — the host
paths a real farmhand's intents take), `town-rain`,
`town-east`, `town-south`, `town-cast`, `town-dialogue` (`&npc=<id>&mood=<mood>` · `&gift=<item>` · `&ask=1` ·
`&first=1` for the first meeting; bystanders vary per villager and hour, busy with their own things),
`town-night-talk`, `town-heart-event` (`&event=<npc>-<2|4|6|8|10>&step=N`, `&alt=1` = the second answers
remembered, `&spectate=1` or `town-heart-spectator` = a co-op farmhand's view), any of them `&seq=<s>` for a frame sequence (r15), `town-memories` (`&mem=all|alt|<flag>,…`: the town a year in, keepsakes out), `town-square`,
`town-portraits` (`&ui=portraits:<npc>` = all ten moods), `town-social`, `festival`.

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
Beach stone (`rocks.ts`) is faceted: a low-poly noisy icosphere cut by 3-5 cleavage planes, split faces with normals
leant 72 % towards the face normal (chipped planes, soft roll at the edges), curvature AO, lichen only as sparse
rosettes on up-facing tops. The tide-pool shelf (`shelf.ts`) steps down in 21 cm wave-cut terraces, each bed tinted
its own warm / cool sandstone with a sunlit lip and a shaded riser; patchy weed round the pool lips (no collar ring),
small spray puddles, real barnacle + limpet colonies along the wet sea rim (`buildShelfCrust`) and rubble groups
(a broken block + cobbles) on the ledges. The headland sward varies straw-warm / blue-green with darker tussocks, the
thrift clusters along its rim.

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
  held is a trophy (a wider "ta-da" V, a camera push-in, a drum-roll fanfare). Every catch is shown over the hat with
  both arms flung up in a V (the chibi's short arms straight up vanish inside the head); for the celebration the
  farmer joins the GTAO G-buffer (otherwise the deck's groove AO behind prints through the face). The collection record is written the moment the
  fish lands (the card's NEW / RECORD badge comes from that write). The line is a verlet rope with a bending constraint
  and a water floor with friction. Casting right at the pier rail steps the farmer 0.42 m inboard first.
- Service: `game.services.fishing` → `state()`, `available()`, `cast(power)`, `level()`, `xp()`, `rodTier()`,
  `upgradeRod(t)`, `records()`. Events: `fishing:cast|bite|hook|catch|escape|level`.
- Round 6: a trophy (held length ≥ `TROPHY_SCALE`) is presented level across the chest in both hands, three-quarter
  to the lens with the back tipped forward (`FishingGear.presentHeld`, a one-turn arrival twirl + sparkles; remote
  farmers too via `poseAnglerArms(..., trophy)`); smaller fish still hang from the fist by the tail. The line is laid
  analytically while the float flies (`ease ≥ 1` stores no momentum) and every verlet step is velocity-clamped (no
  phantom V). The real-play fishing camera swings 50° off the throw's perpendicular (the angler faces the lens
  three-quarter) and drops to 34° pitch once a fish is on; candidate yaws whose ray to the angler's head hits the map's
  `trees` group are skipped (pond canopy). Pilings stop 0.7 m under the surface; seagrass is clumped tufts (two fixed
  blade leans), wind slicks and creased ridge normals are gone from steep views, bed caustics fade out by 1.15 m. A
  farmhand's catch line goes into their own name-tag speech bubble.

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
corner-bracket cursor (solid on the worked tile, a faint smaller bracket on a hovered tile out of reach), `tools.ts` tiered tool meshes, `crows.ts`), poses in `entities/farmer-actions.ts`.
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
- **Events for audio**: `tool:swing` / `tool:impact` (impact frame; `soil:tilled` / `soil:watered` / `crop:sown` land on the same tick) / `tool:charge` / `tool:refused`, `can:refill` /
  `can:empty`, `soil:tilled` / `soil:watered` / `soil:fertilized`, `crop:planted` / `crop:harvested` / `crop:withered` /
  `crop:giant`, `crow:arrive` / `crow:eat`, `sprinkler:spray`, `harvest:collect`, `energy:exhausted` / `energy:passout`,
  `soil:blocked` (one dull tick per tile a charged swing had to skip).
- **r14 polish**: every crop shows all six stage meshes (no zero-day stage); dry tilled soil is dusty tan, wet soil
  deep and glossy (the soak is the payoff); the can pours glassy, tapering bead ropes and lands as a low radial crown
  + double ripple (no geyser); sprinkler beads are see-through, velocity-stretched streaks that bloom into flat crown
  rings where they land; charging previews the whole footprint (red ✕ on tiles it will skip) and a multi-tile charge
  draws one merged gold outline + per-tile wash instead of nine bracket sets; the target bracket is bolder with a dark
  under-stroke and a ~10 % state-tinted wash; ripe strawberries carry 9 fat berries over the rosette, eggplants hang
  big glossy fruit, ripe sunflowers tip their faces up to the lens; held pumpkin = ribbed field pumpkin with a woody
  stem, held parsnip pale cream; the quality star floats beside the produce; giant pumpkin / melon fill the 3×3 block;
  vine leaves vary in hue / tilt; `farm-giant` frames the farmer 3/4 looking at the giant, `farm-sprinkler` keeps
  the farmer beside the bed facing the lens, `farm-crows` shows the scarecrow ring, `farm-crops-all` puts tall rows at
  the back of each block.
- **r15 polish**: summer hero field = one melon row a side (giant in the SW corner), the NE bed packed with
  peppers + tomatoes, blueberry / pepper / tomato blocks up front; peppers are rounded glossy bushes wearing their
  red pods on the outside, blueberries woody balls of small leaves with dusty-blue clusters on the lens-facing side,
  strawberries low trifoliate clumps with 5–7 berries hung off the rim on pedicels, corn a fuller fan, tomatoes four
  leaves a tier; seedlings carry a signature from the first true leaves (serrated staked tomato, glossy round pepper,
  purple-stemmed velvet eggplant) and stages 1–2 are larger. Freshly hoed (or slam-struck) earth is dark, crumbly and
  fluffed ~50 % taller for ~5 s with no tread seams; dry beds have deeper troughs. The hoe blade is 1.4×; chop / slam
  impacts drive a ~29° lean, a knee-dipped lunge and a two-frame squash. Tool impacts startle butterflies (a farmer at
  work keeps a ~2.4 m bubble; staged stills snap them out of ~3.6 m). The pour leaves as the can tips, lands ~0.24 s
  later (fatter, sparser droplets around a thicker core) and splashes until the tail lands, ~80 ms into the lift.
  Sprinkler heads turn lazily (1.25–1.6 rad/s) and throw uneven jets on real 0.6–0.9 m arcs with sun glints, beads
  thickening with camera distance. Crows are near-black with a black bill (blue lives in the rim sheen); the farm-crows
  ring is opt-in (`&ring`). Pulled roots leave a dark hole + a ring of crumbs and a bed kick (a farmhand's too). A charge
  is paid by the share of its footprint actually worked (≥ 2) and skipped tiles keep their red ✕ through the slam; the
  slam ripple is 12 ms a tile. Demos: `farm-tools` swung 24° (blade in front of the body), `farm-pop` 3/4 with the
  farmer standing in the bed, `coop-farm-work` (the co-op loop seeked mid-pick / mid-pour; demo-table `t=<sec>` token).
- **r16 polish**: *Sequences are one action* — `shot.mjs --frames N` calls `__game.seqFrame(i, n)` before each frame;
  action demos (`farm-tools`, `farm-water`, `farm-slam`, `farm-pop`, `farm-harvest`, any `&tool=` / `&loop=`) hold the
  rAF loop, restart ONE action from rest (energy + clock frozen) and step the sim by hand to 8 authored moments
  (`SEQ_PLANS`: hoe = ready · anticipation · wind-up · wind-up top · downswing · impact · bite + recoil · recovery;
  pour = lift · tip · stream leaves · lands · soaking · full soak · tail lands · wet tile); the harness prints each
  frame's phase label + the events it acknowledged (`tool:swing`, `tool:impact`, `soil:watered` …). *Swing body* —
  the free hand is IK-locked on the handle (two-hand grip through wind-up, blow and recoil), the pelvis leads (hips
  pitch / twist keys), a lunge splits the legs with the body dropped so the boots stay planted (knee compression), the
  blade bites ~5 cm into the soil then drags back toward the boots. *Water* — thin translucent threads that break into
  separated droplets low on the arc, restrained glints (no bloom), short low splashes, a timed ~0.8 s soak gradient
  spreading from where the water lands; sprinkler throws ~0.35–0.5 m apex, 72 beads a jet, thinner + sparser.
  *Cursor* — thin strokes, state-tinted fill, compresses + fades on the impact frame. *Crows* — upright on visible
  legs, neck-driven pecks, two-footed hops with wing flicks + landing squash, contact shadows, a startled crouch-and-
  leap escape; `farm-crows` shows guarded rows inside a crisp gold scarecrow ring next to the raided ones (`&ring=0`
  hides it). *Death* — per-crop skeletons (heaved root shoulders, rotted cauliflower, bolted kale, dead sunflower
  heads, husked corn cobs) in paler ashen tan with ±20 % size. *Young crops* — stage 2–3 identity cues (hilled potato
  ridge, strawberry runners + daughter crowns, melon / pumpkin runners + tendrils, first pepper / eggplant / tomato
  flowers, twining yam, woody blueberry base). Hero fields keep a wider sharp tilt-shift band (`rc.tiltBand`);
  `farm-harvest-fall` is staged in warm late-afternoon light. New demo `farm-coop-tools`: the host hoeing beside three
  real co-op farmhand avatars caught on one beat (hoe at blade contact, mid-pour onto a wet tile, a crop caught in
  raised hands with a gold star). Sequence: `node scripts/shot.mjs --url "?demo=farm-tools" --frames 8 --out s.png`.
- **r17 polish**: *Events on the hit* — `soil:tilled` (hoe + charged slam) and `soil:watered` fire on the impact /
  landing tick together with `tool:impact` (the logic still flips at the button press); `crop:planted` stays the
  synchronous state flip (co-op seed accounting reads it inside `item:use`) and the new `crop:sown` is the sow beat
  on the seeds' impact tick; the pour's
  `tool:impact` is the water landing (~0.51 s), not the can tipping; untillable ground answers with `tool:impact`
  `hit: 'blocked'` (blade glances off the turf, grass flecks, the red ✕ pops; the bracket stays red through the swing).
  *Soil* — soaked soil is darker, warmer and more saturated than dry (≈ −60 % value), matte-damp (roughness 0.68,
  env reflection cut 85 %), glossy only along the advancing meniscus; freshly hoed earth is darker than the dry bed
  (moist, crumbly), never glossy. *Cursor* — no wash at all (brackets + dotted rim only). *Clods* — faceted
  three-crumb clusters with per-facet shading in three size classes, pre-advanced so they are airborne ON the impact
  frame, paler dust ring; the hoe smear is half strength. *Swing* — the wind-up coils out to the camera side (blade
  clear of the hat), the pitch range is ~0.45 rad (no lurch toward the tile); `farm-tools` is framed at ~1.8× gameplay
  zoom, whole farmer + bed. *Sprinklers* — 3 jets a head (4 cross), 80 % of beads strung on the rope with tight
  spread, one soft translucent ribbon per jet (same draw), darker soak crescents riding under each landing point.
  *Giant melon* — pebbled rind bump + netted mottling + freckles, a wider darker contact pool, three vine runners
  climbing the belly with leaves, five big leaves leaning against it. *Summer hero field* — one species per block
  with bare spacing rows (corn | sunflower, tomato | pepper, melon patch | blueberry + tomato), red-fruited rows
  ~45 % ripe. *Sequences* — the pour plan follows the real flight (lands 0.52, tail 1.05, settled wet tile 1.6; the
  harness keeps stepping past the action's end). `farm-coop-tools` reframed (all four farmers inside), the watering
  farmhand yawed ~60° so the can reads in profile.
- **r18 polish**: *Summer hero field* — no bare spacing rows (one plant a tile, Stardew-dense): corn | sunflower
  at the back, tomato | pepper packed edge to edge in the NE bed, a blueberry row, pepper | tomato blocks, and melon only
  as one front row a side plus the giant's 3×3 corner; peppers ripe ~2/3 of the time (stage-4 sprigs read as bare soil).
  *farm-tools* — shot from the farmer's front-left at ~1.3× gameplay zoom (face, lean and blade all to the lens; the
  r17 lens sat behind his shoulder), the hoe sequence uses the same lens. *Pour* — the can stays tipped until 0.84 s,
  the stream runs ~90 ms into the lift and the tail lands ~1.15 s, so every splash lands while the can is still
  pouring (sequence moments 0.68 / 0.84 / 1.12 / 1.75); a ~2 cm core rope + 1.5 cm side jets, beads scale with camera
  distance (never under ~3 px); bounce spatter low and outward (no vertical spurt). *Sprinklers* — wider, more opaque
  jets that scale with distance (readable from the 11–17 m hero lenses), the coherent ribbon only over the first ~60 %
  of the throw, then short streaks with gaps (separate drops, not a hose). *Fall field* — the bare spacing row is a
  beet row. *Charged slam* — the gold area wash is fainter (5 %) and gets out of the way on the hit.
- **r19 polish**: *Perf* — field crops cast a STILL shadow (no wind depth material), so the static shadow cache
  bakes the whole field instead of re-drawing every crop into the sun's map each frame; giants (which breathe every
  frame) live in their own `crops-live` batch pool and keep the swaying depth pass (`?cropsway=1` = the old path for
  A/B). `__game.info().perf.frameOk` is the frame-time half of pillar 14 (≥ 58 fps mean and p95 ≤ 20 ms; `ok` /
  `budgetOk` stay the geometry budget) and `shot.mjs` warns when it fails. Sprinkler soak decals halved.
  *Pour* — dip (knees give, can swings back) → heave to shoulder height → a committed tip with the shoulder rolled into
  it, face kept up; the stream is launched ALONG the rose (flight time solved from the spout's pitch, ~0.35 s) so it
  leaves forward and curves into the tile 0.3 past its middle; a tapered glass rope (necking in travelling waves) over
  the first half of the flight breaks into the bead ropes; first contact = one broad low splash + crown + a dark wet
  pulse; `farm-water` is lensed 3/4-profile so the arc reads (sequence moments: dip · lift · tip · arc · lands · soak ·
  tail · wet tile). *Hoe* — a real crouch with the blade skimming the ground, then a bat-style two-hand coil: the
  handle laid back over the wind-up shoulder, free arm across the chest, blade cocked beside / behind the head (face
  clear), legs split; the downswing drives the hands forward at chest height with the blade low in front, then the
  lunge, the bite and a springier recoil. *Harvest* — the reward is reserved at the harvest (inventory), but the
  toolbar slot keeps its old count until the item's icon lands in it; landing fires `harvest:land` (audio hook) and a
  quality-tier star burst on the slot (silver / gold / iridium). *Sprinklers* — rope beads leave in packets of six with
  clear gaps (beaded throws, not rods), rounder drops, a short soft glass column off the nozzle, apex mist per jet.
  *Cursor* — thinner strokes, darker contact under-stroke, seated inside the tile, collapses + fades hard on the hit;
  the charged footprint outline is a fine line. *Field* — the summer hero field plants one family per bed side
  (staked tomatoes | pepper bushes, peppers | tomatoes up front). *Giants* — ~8 % smaller, slumped heavier bodies,
  dark pressed-soil pools (pumpkin too). *Demos* — `farm-coop-tools` reblocked into lanes (hoe at the north edge, the
  pour in the front bed in profile, the lift at the east end); `farm-crows&raid=flee` stages the takeoff beat.
- **r20 polish**: *Co-op can* — upgraded cans are satin, mostly-diffuse tier metal (copper / steel / gold body,
  darker rolled bands, a domed shoulder + filler cap), so a farmhand's can never reads as a hollow hoop; songbirds
  flee the nearest farmer, co-op avatars included (`farmerBubbles` in `entities/critters.ts`), and staged stills whisk
  any bird inside a farmer's 3 m bubble away. *Scarecrow reach* — a thin dashed gold line with a dark contact
  under-stroke draped on the ground (no wash band), shown only while a scarecrow is held; `farm-crows` stages it
  only with `&ring`. *Pour* — the stream lands ~0.32 m forward of the rose along the pour (a visible parabola, kept
  on the tile), drains in ~80 ms once the can lowers and the splash dies with it; dry tilled soil is sandier / warmer
  and soaked soil darker, with a cool sheen riding the meniscus. *Hoe* — the wind-up lays the shaft back over the
  shoulder at ~45° (fists at the chest, blade cocked behind), a two-key downswing (~70 ms), a blade-down recovery;
  low earth-toned dust breath instead of pale dust sheets, a small warm blade flash (no bokeh disc), a 1.45 two-frame
  soil pop and a fresh furrow fluffed ~75 % and ~1.5 cm proud. Farmer materials (player + co-op) carry a soft
  highlight knee so sunlit pale cloth never crosses the bloom threshold. *Sprinklers* — rope beads in evenly spaced
  packets (dashes with real gaps), a fainter, shorter glass column, wet glints on the leaves the jets hit; heads differ
  by tier (squat cast-iron hub with copper tips · copper dome with swan-neck arms · gold turret with jointed arms +
  spire). *Crops* — the giant melon's rind is glossy (gloss bucket) with a thick woody stem and a corkscrew tendril;
  pepper pods hang from arched pedicels at the canopy rim; ripe eggplants carry big velvet leaves over smaller
  drooping fruit; fall beets / yams are grown in densely and the fall NE bed is eggplant. *Staging* — the summer hero
  pulls a melon from a melon row (west side of the row in front of him); the quality star grows with lens distance and
  wears a warm halo; a farmhand's lift uses the host's held-produce scale. *Gameplay zoom* — cursor strokes ~1.8×
  past 12.5 m, hoe clods and splashes scale with lens distance (`FarmFX.lensK`).
- **r21 polish**: *Hoe* — the smear samples only the two downswing keys (window ends at the bite) and is cut
  on the impact tick (`SwingTrail.cut()`), tinted toward warm dust: the impact frame shows the blade in the earth
  with clods already ~70 ms airborne (big chunks) / 35–75 ms (clods), never a pale glass ribbon over the tile.
  *Sprinklers* — a faint pulsing veil ties each jet's bead packets into one arc out to ~3/4 of the throw (no
  disconnected stipple). *Crops* — mature pepper bushes close into a leafy dome (mid-branch leaf skirt, wider
  leaves); the giant melon's stem is a short dark green-brown stub with a button end (no pale curl).
  *Staging* — `farm-water` lens pulled back to 9.4 m (hat + can + target tile in frame through the whole pour);
  `farm-sprinkler` puts the farmer beside the bed in profile watching the head (no head looming at the lens).
- **r22 polish**: *Hoe* — an overhead heave instead of a twist toward the lens: deep crouch (chin up, face
  clear of the hat), then the body arches back tall in a wide split stance with both fists climbing past the hat on
  the camera side (cartoon arm reach 1.34) and the shaft laid back ~75° with the blade high behind; the downswing
  jack-knifes the body and whips the blade out in front (never across the face), the recoil rips the blade out low
  by the shins with the body springing up past rest; head pitch stays chin-up through the lunge. `farm-tools` is
  lensed 3/4 front-profile (yaw −38°, 8.2 m) so the arc reads. *Pour* — the can rises to chin height and tips ~45–54°
  with the shoulder rolled hard into it; the stream throws ~0.75 m from the rose (flight 0.33–0.40 s, lands in the
  far half of the tile), fuller 2.6 cm core rope; `farm-water` lens 7.6 m, 3/4 front. *Harvest* — the whole reward
  beat is one sequence (`farm-pop --frames 8`: reach · crouch · yank stretch · catch squash · present + star ·
  to backpack · icon arcs to toolbar · lands +1 with the tier burst): toolbar flights launched during a capture
  are paused and scrubbed on the sequence clock (`seqFlights`); the pickup toast is hidden until the icon lands
  (reward after cause); produce with no toolbar slot arcs into the bar's last slot (the bar itself is never
  bumped — its bounce replaced its centring transform). *Sprinklers* — each jet is a fan, not a wire: ~1/3 of the
  beads shed into a widening cone (angle jitter ×3.5, per-bead arc height ±15 %), packet spacing jittered per
  drop, bigger + broader landing crowns, the glass column / veil halved. *Field* — a bare furrow lane in the
  summer SE bed between blueberries and staked tomatoes. *Giants* — ~6 % smaller again and settled (x/z 1.04,
  y 0.9). *Crows* — `farm-crows&raid=beats` stages beats: a late-comer swooping in, the near raiders startled up off
  their plants while two keep tearing (wall-clock timed, so the default still stays the all-pecking raid). *Death* — each family withers in its own dead
  colour (tomato olive-khaki, pepper umber, gourds straw, berries mauve-grey, corn bleached straw, sunflower
  sienna). *Perf* — out-of-season husks are hidden (they were a moving shadow caster every frame), clod / leaf
  particle pools draw only up to their last live body.
- **r23 polish**: *Fresh till* — freshness is read per TILE in the soil fragment shader (the tile's own heave
  texel, filled out to a noise-bitten crumbly edge) instead of the bilinear per-vertex blend: the whole new square
  turns dark, moist and crumbly on the impact frame (r10 critic: only a dark smudge in its middle, the rest as
  bleached as the dry bed), with a soft ~0.2 spill onto neighbouring tiles. *Giant melon* — 160 × 84 rind with
  flame-edged tiger stripes (two serrated harmonics along the length, band-to-band width variance, a darker core
  vein inside each band), a soft waxy bloom instead of the hot painted highlight, dried soil splashed up the low
  flank. *Giant pumpkin* — `fruit({ rind })`: fine wobbling striations inside each lobe, broad ripening mottle,
  a green-grey shoulder round the stem and soil on the low flank (84 × 34, was a smooth 44 × 20 lathe). *Events* —
  the soil / crop event contract is documented on the event types (soil:tilled on the hoe's impact tick,
  soil:watered when the water lands, crop:planted is the press-time state flip — voice crop:sown). *Captures* —
  sequence captures pause only the flying item icon (`.hv-flyitem`), never other HUD animations started that tick. *Soak* — the wet flood
  starts with a dark spot under the splash on the landing frame and crosses the tile in ~0.35 s (was ~0.5 s from a
  near-zero start, so the soak only read once the can was lowered).
- **r24 polish**: *Plots* — hero fields frame every bed block in pale, sun-bleached timber edging with squat
  corner posts and mid stakes (`world/props/bededge.ts`, one merged mesh) so the field reads as intentional,
  grid-like plots with a crisp light line between the dark soil and the trodden path (blind judge: "tidy the bed
  layout", "soil, paths and fence compete"); bare spacing lanes stay dry and pale (walkable negative space); the
  ring path in front of the beds is cleared of tall lawn tufts. The giant joins a hero field only with `&giant=1`
  (it pulled focus from the farmer; `farm-giant` is its own showcase). `farm-harvest` / `farm-harvest-fall` lenses
  are ~15 % closer on the farmer; crop leaves carry a brighter rim. *Pour* — the can rides nearer the body
  (reach 1.18) and the water lands ~0.95 m out past the tile's middle after a 0.37–0.45 s flight: a parabola that
  visibly crosses a gap between rose and splash (pour plan retimed: lands 0.80). *Hoe* — the wind-up shaft stands
  ~45° back in the torso (it lay flat behind the neck like a bindle once the back arch added its lean), gripped at
  the butt so no handle end crosses the face. *Sprinklers* — a feathered mist sheath breaks into travelling puffs
  round each jet's apex. *Harvest* — the landing burst bursts on the bar's backpack end when the produce has no
  slot yet, draws above the HUD (it hid under the toolbar), a tier-coloured `+N` pops off the slot as the count
  ticks, and sequence captures pin both at their peak on the landing frame. *Row markers* — hero beds carry a stake
  + slanted sign + a sample of the crop at the walkway end of each family block (`buildRowMarkers`, one merged
  mesh). *Perf* — the closer harvest lens costs ~15–20 % more GPU fill than the old 17 m one in A/B; all six
  farming demos 59–118 fps avg under load ≈ 190 (history on a quiet machine: farm-harvest ~102). *Co-op* — `farm-coop-tools`
  lanes: hoer N-west, host N-east, waterer at the bed's west end pouring east into the front row, harvester at the
  east end turned 3/4 to the lens.
- **r25 polish**: *Hoe* — a centred overhead coil (no torso twist / side roll, chest stays on the tile; both
  fists straight up over the hat, the blade high behind the crown, a light back arch — a deep one turned the face
  up into the high lens and read as a turn to camera); `farm-tools` lensed 3/4-profile (yaw −26°) and the whole
  `--frames` run holds one camera. Clods flip OFF the blade (forward + sideways fan, low hops; none thrown back
  at the farmer), dust is warm umber, low (< 0.25 m) and gone in ~0.3 s. *Charged slam* — per-tile bursts are
  sparse (55 % clods, crumbs halved) and short-lived (0.7–1 s), freshness fades only toward a NOT-fresh
  neighbour (no seams across a contiguous slam), the gold area wash switches off on the hit, upgraded hoe blades
  +6 % a tier. *Water* — the can pours one continuous tapered glass sheet over ~88 % of the flight (beads only
  as the break-up in the landing third); sprinkler jets carry a solid glass core ribbon (refracting edges +
  specular streak) inside a feathered apex mist, rope beads only near the landing. *Hero fields* — no bare
  bands: the walkway moves to x 21 so the map's scarecrow stands at the head of the walk and the can stump at
  the cross path; the east beds split into species blocks both ways (`[west, eastNear, eastFar]`, split at
  x 26): summer gets a hops trellis block, fall its own plan (corn + sunflowers, eggplant | beet | eggplant,
  pumpkin patch beside a grape vineyard block, beets + eggplants up front) with fallen-leaf litter
  (`buildLeafLitter`, one instanced draw). *Row markers* — weathered planks with the crop's inventory icon
  painted on a cream oval (canvas atlas, `buildRowMarkers(spots, seed, itemIconUrl)`), twine lashing, no
  floating sample; 1.45×. *Crops* — fall foliage pushed further to olive-ochre with yellowing leaf tips;
  ripe pumpkins / melons vary ±12 % size, squat ↔ tall and a wider rind tint swing; beets / yams / eggplants
  fuller; seedlings (stages 1–2) ~10 % bigger; stage 0 is a dark moist dibble hole with a smooth lip, one seed
  standing tip-up and a pressed drill line (no pebble ring). *Cursor* — a held tool always keeps a quiet
  neutral bracket on the facing tile (it vanished at the gameplay lens after acting).
- **r26 polish**: `farm-giant` stages its giant again (the r24 `&giant=1` opt-in had left the showcase with
  no giant at all). Fresh-till earth is crumbly, not a smooth dark smudge: two scales of lumps with lit tops and
  near-black crevices in the soil shader. Sprinkler jets: the glass core necks and fades over 0.42–0.7 of the
  throw and the rope beads take over from 0.36 (the r25 full-length core read as a white wire from the hero
  lens). Mature tomatoes carry five broader leaves a tier plus a leafy crown (the front tomato block read as
  staked poles). Live-play event check (`?map=farm`, tile 36,31): `soil:tilled` lands with `tool:impact`
  (+13 frames after `tool:swing`), `soil:watered` one frame after the pour's impact, `crop:sown` with the seed
  impact, and hoeing untillable lawn sends `tool:impact` `hit:'blocked'`. Perf: `farm-harvest` 194 draws /
  0.82 M tris (crops 228 k), `farm-harvest-fall` 193 / 0.79 M, both at 60 fps in the harness.
- **Demos**: `farm-harvest` (summer hero field, farmer mid-harvest holding a melon with a gold star; `&act=none` for an
  empty-handed field, `&crop=<id>`), `farm-harvest-fall` (pumpkin), `farm-harvest&season=spring` (cauliflower),
  `farm-giant`, `farm-crops` (gallery: every crop × stage, `&crops=melon,pumpkin`, `&season=`), `farm-tools` (hoe,
  side-on, frozen just after impact), `farm-water`, `farm-pop` (produce held up with a gold star; `&quality=0..3`),
  `farm-slam` (tier-3 charged hoe), `farm-crows` (a raid in progress: crows pecking, feathers, a chewed stub;
  `&raid=fly` = crows flying in, `&ring` = the scarecrow's reach), `farm-wither` (per-crop dead silhouettes: staked tomato, slumped pepper, caved-in
  melon / pumpkin on a collapsed vine mat), `farm-field`, `farm-lift` (two-hand chest hug of a melon),
  `farm-sprinkler`, `farm-crops-all` (all 18 crops × 6 stages, every season, farmer out of frame, two blocks either
  side of the field's scarecrow / can-stump column; `&crops=all` on any gallery).
- **Readability (r7)**: hero fields plant tall crops as single-species blocks either side of the walkway with a bare
  spacing row (`HARVEST_ROWS` `[west, east]` pairs, `'gap'`); stakes stop a hand above the plant with a twine tie;
  corn is a paler yellow-green block, beans a dark blue-green; stage 1 is a per-family signature seedling (corn grass
  blades, gourd heart cotyledons, brassica frilly rosette, beet red stems, bean hooked sprout + tendril to the twine,
  …) and stage 0 shows the crop's own seed; ripe plants twinkle (`updateRipeGlints`). The hoed tile springs 0 → 1.3
  → 1 out of the turf with a dark inner sod rim, 2–3 big chunks + 10–14 clods, a low dust ring and a 1-frame blade
  flash; the can pours three fat bead ropes + flanking jets with a bounce spatter; the wet flood fills the tile in
  ~0.3 s with a dark meniscus at the front and a glossier finish; sprinklers throw denser bead ropes (size falloff),
  pulse dark soak spots under the turning jets, glint at the nozzle and (near the lens) hang a faint mist at the apex.
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
  (attract mode plays skilfully, ~85–90 % accuracy). Real stakes (`PRIZES` in `data/festivals.ts`): a gold trophy
  (1st) / blue (2nd) / red (3rd) rosette, each with prize gold (e.g. sack race 500 / 300 / 150 g) and hearts with the
  activity's host or partner; below the ribbon line a wilted flower — no prize money, no friendship (unless the partner
  already loves you). A win
  gets a slow title slam + rays + confetti storm, the whole nearby crowd cheering in 3D and the rosette pinned to your
  chest for the rest of the day. Produce Judging draws three rivals per year (stronger each year), stages your entry
  on a draped plinth (judges gather round it) and adds a presentation pick (the judges favour one touch a year).
  Sack Race: five 1.05 m lanes whose 3D positions are the HUD's progress, dust on every landing, tumbles on wobbles,
  finishers fan out past the tape, the camera tracks the pack. Gift Exchange unwraps the present in 3D in your hands
  (the circle steps back and you face the lens beside the recipient; cards sit to the side).
  Lantern Release (a low three-quarter from the east sand: your face lit by the paper toro lantern in your hands —
  the fireworks flash light doubles as its glow — the dark bay and the lighthouse headland beyond): five throws on a quickening swell, a radiant-streak bonus, and each of your lanterns joins the
  flotilla colour-coded by how well it was let go (gold radiant … dull sputter). Produce Judging runs as a
  lower-third ribbon while the judges walk plinth to plinth in 3D and the rosettes are staked beside the winners.
- Fireworks (tide night): shells launch on one shared period, evenly staggered, so every frame of the show holds a
  crisp opening starburst (radial comet streaks) rather than only late falling glitter; stars go out at the waterline
  and the bay carries a dim, points-only reflection. Starfall's aurora also lies on the frozen river as drifting
  green / violet curtains with fine rays (the high camera sees the ice far more than the sky).
- Crowds: townsfolk get 12+ hue families a season, ~40 % seasonal hats (the rest bare hair / headbands / earmuffs /
  bows), elders + children, ±10 % height / ±8 % width, bags; the staged crowd is relaxed so nobody stands inside
  anybody else (`FestivalMap.separateCrowd`); in close mini-game framings anyone within ~5 m of the lens shrinks away
  (`Crowd.nearCam`), so no giant cropped heads fill the frame. (r8) Winter hats come as beanies, floppy stocking
  caps, fur trappers and face-framing hoods; extras get round / long / square heads. Night festivals light faces
  with a per-crowd warm lantern fill + cool moon rim (`Crowd.light`, `FestivalMap.faceLight`). Name pips only tag
  the two villagers within 4.5 m of you.
- (r8) Composition: Tide night keeps its bottom third clear (no reeds / poles across it), half the flotilla, paper
  lanterns held under white (candle-lit gradient, `Lanterns` `glow`), villagers on dry sand, and two things to *do*
  in front of the lens — the wish table (write a slip, fold a toro lantern, a line of written wishes; `buildWishTable`)
  and a grilled-corn snack cart (`buildSnackCart`). Starfall's postcard looks over the skaters on the ice to three
  hero zones (fire + cocoa, the gift circle round the Fir with you at its open side, the ice sculptures) with the
  star against the aurora; no posts or onlookers in the gift circle's sightline. Sack racers stand in creased burlap
  sacks pulled to the chest (`sackGeometry`), crouch before take-off, pitch forward in the air and squash on
  landing; attract mode joins the race mid-lane. Skating banks into carves with a forward push crouch, an edge-spray
  fan and a bright speed streak in the blade trail; lens-side strip skaters clear the course. Ribbon Dance partners
  hold hands a step apart and swing round each other on big Blooms.
- (r9) Crowds: about 40 % fewer extras, placed as authored vignettes (`world/festivals/vignettes.ts`: a picnic on a
  blanket, an elder on a bench with a friend, a couple watching, three neighbours gossiping, kids chasing round a loop);
  townsfolk come in five body archetypes (average / stout with a belly / lanky long-legged / stooped elder / child)
  with seven eye cuts, and named villagers keep their belly / shoulders / hands / leg length. A 4th crowd data row
  drives six desynced idle families (weight shift, hands behind back, arms folded, hand-on-hip pointing, thinking,
  clasped + stretch), three cheer variants, left / right waves and laughing talkers; an albedo ceiling keeps white
  hair from blooming. Framing guard (`Crowd.screen`): in every mini-game camera an onlooker whose projected head is
  big enough to read and crosses the frame edge or a HUD panel rect folds away (participants are kept);
  `node scripts/fest-crop-test.mjs` asserts zero cropped heads in all six mini-game cameras via
  `FestivalMap.cropCheck()`. Name pips are on or off (no half-faded ghost tags); postcard stills get a gentler
  tilt-shift and a gold contact ring under your farmer.
- (r9) Ribbon Dance: the couple promenades round the pole (one lap ≈ 30 s, camera anchored on the green), turning round
  their joined hands; every Bloom swings them half round with a twirl, every other one lifts the partner; notes fade in
  inside the lane and never pass under the combo column. Gift Exchange is a choice: a hint about the recipient, three
  peeks (they act out each one in 3D) on a reaction meter, then the verdict swings the meter; the unwrap is three beats
  in 3D (ribbon, lid, the real keepsake rising on a glow) at a low three-quarter under the Fir. Starlight Skate: deep
  blue-teal ice with crisp lamp streaks and carve marks, cracks are black fractures with a pulsing red rim, a clear
  band round the course, judgement pops ride above your head. Starfall: an open northern ridge so the postcard sees
  night sky — stars and three distinct aurora curtains — round baubles + a warm tinsel garland, four different
  chalets. Tide night: lantern-topped wish-line canes, streaking firework stars, a crisp moon, a crenellated
  sandcastle with a pennant. Harvest Fair: toned marquee, ferns not round bushes, 1.8 m maze walls with a lookout
  tower + scarecrow at the centre, draped baize plinths with pennant skirts, racers warming up with small hops; the
  sack-race result frames you left of the card and the co-op board shows the purse (500 / 300 / 150 g); standing by
  the lane while another farmer races swings your camera to a grandstand view that tracks the pack.
- Perf: at most 3 dynamic point lights per festival map (constant count; lamps / stalls / lighthouse are glow sprites +
  pool decals, the firework flash is one shared light + a sea tint); the cocoa lamp rides with the skater in the skate.
- Events: `festival:start` / `festival:end`, `festival:music` (tempo / mode / timbre hints), `festival:minigame`,
  `festival:score` (co-op relay payload).
- Co-op (host-authoritative end to end, `world/festivals/coop.ts`): the host owns every activity — session id, seed,
  start tick, the start-line lobby + lanes, live race progress, the outcome and every staged moment. A farmhand only
  submits inputs (`fe.req` start, `fe.ev` moment, `fe.in` progress claim, `fe.end` result, `fe.line` / `fe.start` /
  `fe.leave` at a start line); the host validates them (known activity + event kind, finite values, progress capped
  at the game's top speed, finish times inside a 1 s lag window, scores inside the par band) and broadcasts
  `fe.stage` / `fe.x` / `fe.go` / `fe.st` (10 Hz) / `fe.res` / `fe.fin` / `fe.bd`. The host ranks the sack race
  (farmers + villager racers, whose run is a closed-form function of the host's seed and the race clock,
  `sackNpcPos`, so racer HUDs, spectators and the host agree); every machine shows the host's places.
  Spectating: another farmer's dance (partner steps up, plait + hearts), lantern release (their lanterns join the
  flotilla), judging (judges walk, rosettes staked), gift exchange (recipient + present in their hands), skate (edge
  spray) and sack race (the villager field in lanes, sacks on the farmers) are staged in 3D on everyone else's
  map (`FestivalMap.spectateBegin / Event / End / Race`), their avatar posed with the activity's own body animation
  and the nearest onlookers turning to watch, then applauding the host's result. A late joiner gets live sessions +
  races in the join snapshot. `festivals.coopStats()` → msgs, relayed, rejected, watching, staged.
  `node scripts/fest-coop-test.mjs` checks lobby → host lanes → live progress → host standings (places agree) →
  a watched solo race (relayed hops, posed avatar, villager field) → a forged teleport claim rejected → `fe.fin`
  closes it for everyone → late-joiner boards.
- Demos: `fest-spring`, `fest-summer`, `fest-fall`, `fest-winter` (8:10 pm, aurora up), `fest-winter-night`,
  `fest-winter-dusk` (afterglow, aurora just rising), and the mini-games
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
  Eggs are picked per nest box and shown off overhead with their quality star. (r11) Tall stock is staged side-on at
  the farmer's reaching hand (crown under a one-bone arm IK, muzzle ≥ ~0.9 m from the farmer's face, turned towards
  the lens), tips its head into the hand with its eyes shut; the host stages a farmhand's pat the same way and the herd
  poses carry it. Homebodies: on a pasture day one or two coop birds (and one barn animal) stay in — a hen sunning on
  the roost bar, a late sleeper — deterministic per day + id (`animals-*` showcases keep everyone out, `&homebodies=1`).
  Coat relief per part (`aCoat`: short hair / wool curls / feather scales / skin) as a screen-derivative bump.
- Demos: `house-interior`, `house-night`, `house-bedtime` (prompt), `house-asleep` (tucked in), `animals-dayend`
  (day-end card with the Animals row), `coop-interior`, `coop-eggs` (`&nest=0..5`), `coop-night`, `coop-dawn`,
  `barn-interior`, `barn-night`, `animals-pasture`, `animals-petting` (close-up), `animals-coop` (pasture + three co-op
  farmhands, perf), `animals-gallery` (every species + coat), `pet-yard`, `carpenter`, `carpenter-animals`.
  `&pet=dog|cat` picks the pet, `&hearts=0` stops the staged petting hearts, `&petted=1` pre-marks today's petting.
- Weather: rain / storm sends the herd trotting back through the pop doors (`weather:change`), the pet curls up in its
  kennel; non-duck animals keep a body-width clear of the duck pond (ducks float low in it). Indoors at night the
  moonlight shadow fades to 40 % (the farmer no longer throws a black wedge across the lamp-lit floor).
- Farmhouse floor plan: zoned rooms round an open walking floor (kitchen, dining, hearth circle, bed nook behind the
  arch, desk + spinning wheel, mudroom along the front knee wall) — no loose prop islands in the middle.
- r12 (round 10 critique): three readable farmhouse zones — kitchen + dining on one quarry-tile floor, the hearth
  circle, the bedroom on its own broad woven rug — with the puzzle table, knitting pouf, reading rug, harvest crate and
  floor strays gone and a clear bed → bedroom doorway → front door lane; softer window shafts (house 1.75 → 1.05, coop /
  barn ~0.75x) and a calmer night fire (flame gain falls at night, back-glow + slab pool trimmed). Barn stalls lived in
  (Maple head-down in her hay, Cocoa turned 3/4, a sheep side-on nosing the bedding, the pig rooting on the diagonal,
  Daisy craning to the aisle; livestock 0.9x inside). Pasture spread over three depths (jersey to the open west half,
  one hen fewer, pond ringed by clear grass). Petting card smaller (48 px), shorter-lived (1.45 s), capped growth from
  far lenses, never flipped onto the farmer by a prop.
- Co-op authority (r12): every farmhand animal intent is checked on the host against the net layer's validated
  `last` map + position (not the interpolated body): eggs only in the coop at the nest shelf, hay only in that building
  at its trough, a pop door only at its hatch, truffles / the pet bowl only beside them, a pet only on the map the animal
  is on (+ reach when the host shares it); unknown position = refused (`animals.rejected` counts). Carpenter orders
  from a farmhand need the wood / stone in the host's mirror of their backpack (a stale mirror is debited per accepted
  order; a refused order refunds at most what the mirror shows). `npm run mp-test` sends the hostile set from the
  pasture and checks the host state is untouched.
- Action demos (r12, real input / weather / carpenter / sleep paths, nothing pinned, sim running; `&act=0` holds the
  start): `animals-chores` (coop morning: two eggs off the nest shelf, hay into the trough with the 0 key, the flock
  comes to eat, a pat — `--frames 11 --every 1400`), `animals-rain` (a shower at ~2 s, the herd trots home —
  `--frames 7 --every 1500`), `animals-live` (the herd's own morning), `animals-overnight` (order a coop at dusk, bed,
  day-end card, wake, the coop stands — `--frames 10 --every 1800`).
- r13 (round 8 critique): *Petting contact* — tall stock stands ACROSS the farmer's front (between them and the
  lens), in profile turned ~25° to the camera, the crown ahead of the farmer and a little to the head side, so on
  screen the face sits below and beside the farmer's (side by side at one depth the two heads met — the "kiss");
  the hand IK lands on the real crown surface (`Gait.crown`), a clearance pass keeps the farmer ≥ body radius + 0.5 m
  off the barrel and ≥ head radius + 0.62 m off the head (local farmer steps back, else the animal eases away), and
  a farmhand's pat is staged on the side *their* lens sees. The heart slides sideways in the camera plane off the
  farmer's face (the name card moves with it), and a farmer's own pat is re-popped if a same-map reload (teleport /
  co-op resync) wiped it within 1.2 s. *Fire* — three licking tongues per card in saturated linear colour under
  normal blending (no white lamp), a smaller deeper back-glow, a warmer hearth-rug pool by day. *Animals* — sculpted
  lofts (`animals-rig.ts` `loft()`): the cow (square pins + hooks, brisket keel into a dewlap, rope tail to a hair
  switch), the pig (ham, dipped back, jowls, a flared snout disc, cupped leaf ears, a corkscrew tail), the goat (a
  lean ridged topline, countershaded, britches); anatomical legs + cloven hooves; hens get a cocked tail of separate
  cupped feathers, a hackle ruff and fanned primaries; size-aware sphere tessellation; a 4 cm shadow normal offset
  (no acne bands on the round barrels). *Coop* — a soft trodden-lane / damp-ring / droppings floor-wear decal, a
  dust-bath decal instead of stacked discs, 60 % fewer floor straws, a coop of 2+ birds keeps one at home on a fine
  day; outside, a chicken-wire run on the west wall (wire + a grey veil so it reads from the yard). *House* — 10 cm
  boards ~12 % lower in value, a sofa table behind the loveseat (books, fern, photo, apples) fills the open band, a
  draped knitted throw at the bed's foot (was a slab), softer vignette, brighter night. *Barn* — greyer trodden
  drifts and cool damp patches by the tank, fewer aisle straws. Paler pasture wallow centre.
- r15 (round 10 critique + blind judge): *Pasture* — the paddock wear has defined edges (the wobble field moves where
  the edge of the worn earth falls instead of multiplying its value: the judge's "blotchy path"); the pen gets animal
  homes and chores furniture — the pig's corrugated sage ark with a straw tongue spilling from its arched door, the
  hens' galvanised feeder + red drinker with spilled grain by the coop gate, a grain sack, a feed pail and a hay fork at
  the manger (`buildPigArk`, `buildHenFeeders`, solid via `PASTURE_PROPS`); `animals-pasture` / `animals-coop` lens
  tightened 21.5 → 18.5 m so the herd and buildings fill more of the frame (also ~5 draws / 40k tris fewer). *Contact
  shadows* — one instanced soft dark pool under every grounded animal (perched / bed-shelf / afloat skipped), all maps.
  *Resting* — livestock lie down awake now and then to chew the cud (eyes open, head up, slow chew, no Zzz; real
  behaviour, synced to farmhands as stateCode + 8); staged: the second pasture sheep, Cocoa in her straw. *Barn* —
  three behaviours along the stalls (munching, lying down, rooting) on varied yaws instead of five chins over five
  mangers; the barn's open door shows a recessed vestibule (dim straw, a stall partition, a bale) instead of a black
  card. *Petting* — the heart clears a crouching farmer's face (checked over the 1.05–1.5 m head span, + the crouch's
  lean) and the mini-heart burst follows it. *Homeward* — a herd sent in (rain, evening) walks in two legs: a mark
  square in front of its gate, then the door, arriving within a body radius of it (they used to jam shoulder to
  shoulder short of the exact door spot, or stick on a prop on the straight line, for the rest of the day).
- r16 (round 10 critic, 8.4): *Petting staging* — the animal stands BESIDE the farmer at the same depth (a touch
  towards the lens), side-on and turned ~45° to the camera with its head pointing away; the farmer strokes its back
  from the flank (arm IK on `AnimalActor.backPoint`) and turns 3/4 to the lens; the petted animal looks back over its
  shoulder (shut eyes) so its face lands square to the camera. Stall animals: the farmer steps beside the manger, never
  in front of the head. Same staging for a farmhand's pat (host side, the farmhand's lens). *Sleeping pets* — a
  dedicated curled model (`buildCurl`: a "C" coil, haunch + tucked paws, chin on the paws, eyes shut as arcs, ears
  folded, tail wrapped under the nose) snapped onto the bed cushion with a contact AO pool (`AnimalActor.curlAt`);
  the pet bed 1.25x roomier and moved clear of the rocker. *Cows* — a crested neck bound to the head bone bridges the
  head into the shoulders, knobbly knees + pointed hocks on every hoofed leg, cows 0.8x in the barn (straw shows both
  sides), the trough drinker dips to the water line (`dipK`). *Framing* — coop lens 11 → 13 m, house farmer by the
  door, barn farmer on the aisle partition line. *Barn warmth* — lanterns light from mid-afternoon (`lampEarly`), a
  warm lamplight wash on the back wall, brighter sun pool, less cool fill. *House* — lit parchment floor-lamp shade +
  its own warm lamp + a bigger pool, window shafts brightest at the window thinning to the floor (left window
  0.5x via the new per-window `shaft`), a sewing basket + the dog's rope toy anchor the floor by the door runner.
  *Coop* — three straw tones in soft drifts, pale scuffed lanes with broken stalks (not dark trodden earth), a sand
  dust bath with grit / quartz grains, hay portions as a loose heap of ~70 crossing strands. *Day-end* — the gold-star
  reason reads "well loved" only when those animals were petted; the bowl line / chore agree ("stayed full all day" →
  "Top up …'s drained bowl", the bowl empties overnight).
- r17–r19 (round 10–11 critics): *Faces* — one eye recipe for the whole herd (thin warm rim, lens + two catchlights,
  tipped up to the lens); joy (a pat, a treat) now shuts the eyes into dark "∩" arcs on their own `lids` bone (the old
  10 % squash of the eye left a slanted white slit that read as a scowl on the petted goat). *Pig* — a pear in plan
  (round hams past the shoulders, a soft waist, an arched loin, a sagging belly; no two loft stations share a width),
  peach back / cream-pink belly / blush skin paint, and broad ears flopped forward and out over the brow, backs to the
  sky, framing the face (they were 20 cm flaps edge-on to the lens). *Cows* — tail switch as a brush of tapered locks,
  gentler fur grain on dark coats, the Jersey's forelock as smooth curls (8 x 6 balls read as stacked hex coins).
  *Petting* — tall stock stands 0.72 m out (less of its rump under the farmer's face on screen), birds 0.4 m out
  with a deeper kneel, the coop demo hen staged within arm's reach; the barn pig roots on a 30° diagonal so its snout
  and eyes read (every stall but the goat's empty one shows a face). *Herd*
  — local avoidance + social spacing (no fused bodies, a full pen still finds room), a semicircle of curious slots
  behind the farmer; the paddock gets a five-bar front gate (`buildPaddockGate`). *Coop* — 9 shed feathers (was 16),
  cream not white, under the roost / nests only; the dust bath smaller and two values darker with a sunlit lip and a
  shaded inner slope (a dent, not a pale stain), the window's sun pool 0.3. *House* — morning shafts 1.3x with the
  glazing bars carried down the beam and a thinning far face; the top-shelf bowls oatmeal-glazed (they bloomed into a
  white orb at night). *Action demos* — `animals-chores` / `-rain` / `-overnight` / `-live` capture one frame per
  milestone with `shot.mjs --frames N` (egg lift, hay, pat, rain, doorway, quilt, fade, card, wake, new coop); the
  overnight demo now goes to bed in the farmhouse bed. `sleep.phase` exposes the bedtime stage; while a capture holds
  the loop the bedtime beats run in sim time, and under automation (`navigator.webdriver`) an action demo waits 8 s
  for the capture to start it (on a loaded machine the act used to run out before frame 0 — every frame showed the
  next morning).
- r20 (round 9 relay, stale 7.4 verdict): *Co-op chores* — the host's per-peer intent gate is a token bucket (4/s
  sustained, burst 3) instead of a fixed 240 ms gap: a farmhand lifting the second nest box right after the first
  had it refused (the first egg's grant came back inside 240 ms on a fast relay) and the egg went missing from their
  run; a refused intent re-broadcasts the authoritative state at once (the farmhand's optimistic prop removal is
  undone immediately). The host keeps `animals.intentLog` (last 24 farmhand intents + outcome: harvest / pat / eggs
  n / refused (rate | reach)), printed by `scripts/animals-coop-test.mjs`; the matrix counts heart pops with a
  monotonic `pops.popped` (the live-pop count raced the 1.5 s pop life on a loaded machine). *Barn* — the herd at
  three depths instead of a back-wall lineup: Maple, Cocoa and Daisy in their stalls, Mochi in the aisle with the
  farmer, the pig rooting the straw at the board walk's edge front-left and Poppy lying by the stock tank chewing
  the cud front-right (two stalls stand empty; `&lineup=1` restores the old staging). *Farmhouse* — grandmother's
  corner between the hearth and the bedroom: a walnut console with a lace runner under her portrait, now large
  (0.62 x 0.82 m) in a carved gilt frame with the recipe card and the couple's photo tucked in its corners, a lit
  taper whose halo warms the wall (stronger at night), dried flowers, her folded spectacles and teacup; the dog's
  rope toy + rag ball left the walking floor. *Coop* — the nest boxes differ (straw heaped higher / lower, fresher /
  older, a coloured name tab per lip, gingham curtains drawn aside on two boxes, the egg-tally mug on the frame);
  shafts 0.95 -> 0.68. *Feedback* — the heart pop 52 -> 46 px, the name card 40 -> 36 px. *Lens* — inside the
  farmhouse / coop / barn the tilt-shift clear band widens to 0.42 at 0.4 strength (held by the buildings system
  every frame, restored on leaving): the whole room is the diorama, and the default band smeared the back wall's
  story props (the portrait, the nest boxes, the stall row). *Verification* — critic-ready stills of the five demos
  in `shots/animals-r20/final/`; perf at 2560x1440 high (contended: 4 foreign Chromium GPU processes, load ~55):
  house-interior 167 fps / house-night 117 / coop 171 / barn 145 / pasture 97 avg, 124-214 draws, p99 28-32 ms
  (the strict 25 ms p99 gate needs an uncontended run). Co-op matrix `scripts/animals-coop-test.mjs`: 23/23.
- r21 (critic r10, 8.3): *The flock comes to eat* — hay is only eaten head-down at a trough slot (a hen pecking
  the floor when the hay went in used to count as fed where she stood and never came over); filling the trough
  makes every hungry animal drop what it is doing and scurry (birds 2.7x) to a slot. Slots are matched to the birds
  in order along the trough (crossing-free) and a bird takes a nearer free portion on the way in; the walk is
  routed round the furniture's real footprints (corner waypoints; indoors walkability is the props' rects, not
  whole grid tiles — the hens froze beside the bales), round farmers, and falls back to the errand walk after
  4.5 s. A meal is 8 s of munching that works the portion down and uses it up (`hay[slot]` cleared, host /
  solo; a trough filled where the host isn't looking is eaten after 24 s) — one hay no longer fed an animal
  forever. Sated birds linger at the trough instead of trotting over to the farmer. `animals-chores` beat
  "flock comes to eat" waits for the birds at the trough and prints the count; the farmer collects the eggs a
  tile back from the shelf, fills from the trough's end, watches from the nest boxes and pats the bird at the
  row's end from behind (the bird on the lens side). *Touch* — the pat's heart waits for the hand: the arm on
  the animal's side reaches (the right hand no longer stops at the chest for an animal on the left), the body
  half-steps up to 0.34 m towards a far target, and the heart pops when the hand is within 0.15 m of the stroked
  point (`animals.reachGap`); for tall stock the farmer turns further to the lens (face 3/4). The host stages a
  farmhand's milking / shearing (crouch at the flank, pumping hands, a tin pail under the udder, the burst) —
  `animals.remoteHarvests`; the co-op matrix checks it and the farmhand's hand gap (25 checks). *Coop* —
  farmers drawn at 0.84x inside; the translucent hat fade is gone (it drew as a ghost hat); a galvanised fount
  (pan, ribbed tank, bell lid, bail) replaces the blue pot; the floor is planks under straw (seams, two tones,
  crisper stalks), the damp ring halved. *Farmhouse* — the curled dog's face: coat-toned muzzle, a slim cream
  blaze, a small nose tipped into the tail, bigger closed-eye arcs (no more "staring eyeball"); lamp glow pools
  are clipped to the room's floor (no light on the void past the front wall). *Barn* — the shorn fleece lies
  flat on a slatted skirting table (it read as a headless sheep on a stool), each stall bedded differently plus a
  hay net + bucket, a goat's crate + cabbage, the pig's root trough with turnips and apples; the pig turned 30°
  to the lens; lens 16.2 -> 15.3. *Herd* — the jersey's head ~0.85x the holstein's and side-on in the pasture;
  the sheep's head + ears lifted 6 cm / 3 cm forward out of the fleece on a short neck, the plain face a deeper
  taupe; hens: bigger eyes, comb set back on the crown, slimmer deeper-red wattles, a bigger beak between.

## Co-op multiplayer (1–4 farmers)

```bash
npm run server        # relay + lobby server on ws://<host>:8787/ws (also serves dist/ after npm run build)
npm run dev           # then Title → Co-op → "New farm" / "My saved farm" (host) or type the 6-letter code (join)
npm run mp-test       # e2e + adversarial: relay + Vite + headless clients; screenshots + results in shots/mp/
node scripts/mp-shots.mjs [--jobs f --dir d]   # every co-op demo still from ONE Vite + browser (+ draws / tris / fps)
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
  fixes anything else, predicted loot yields to the host's `give`. Another farmer's swing is replayed at its impact
  frame; the host flushes that swing's tile delta at the same frame, and a replay the host hasn't confirmed yet waits
  (≤ 0.45 s) for it instead of being reverted. `stats()` splits `reconciles` (host edits = other farmers' work),
  `mispredicts` (our prediction / replay was wrong — a visible pop; `mispredictLog`) and `drift` (`driftLog`; paused
  between our own night and the host's morning farm, whose weeds / crows legitimately differ until it lands). Movement is predicted; the host's `fix` is
  reconciled against the position history and bled in over ~150 ms. Remote farmers use an adaptive jitter buffer
  (100 ms floor, grows with measured arrival jitter up to 260 ms) with brief extrapolation; their rendered speed is
  capped at 1.4× the path's own pace, measured over a ±150 ms window of samples (not the current segment), and the
  excess is absorbed over the next frames — also across a playout-clock restart after a sender froze for seconds. A
  guess that ran ahead (the sender stalled) is absorbed by letting the real path catch up under it: the farmer pauses
  instead of stepping back. Samples are stamped with the **sim time** of the position they carry (frame clock − the
  fixed-step accumulator, `game.simLag`), so a frame that ran 0 or 2 sim steps no longer reads as a 0× / 2× pace on
  every receiver (the r5 walk surge). Input presses are latched for the
  fixed-step sim (`input.takeFixed`), so a tap shorter than a frame still swings the tool.
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
  the same FarmerActions tool poses as the local farmer; 6 hair styles, 5 hats, eyes / brows / mouth, 4 outfit
  cuts (overalls, pinafore, waistcoat, apron), an accessory (glasses, daisy, knitted scarf), skin / hair / shirt /
  outfit / kerchief / hat colours (`entities/remote-look.ts`; the extras are optional on the wire). Readability from
  the high camera: heads tip ~9° toward the camera, caps sit pushed back, a face-fill term keeps faces out of the
  hat's shadow, hair roots a value step darker than the locks. Emote bubbles are 3D sprites (`remote-emotes.ts`) that pop with an overshoot and a burst
  of twinkles (a sparkle ring child of the bubble, ~0.5 s), and the farmer who emoted does a little squash-hop. Name tags /
  chat bubbles are DOM, placed after each render (`game.afterRender`, so they match the frame's camera even while
  paused) and stacked when farmers bunch up; emote bubbles sit beside the pill on the side away from the nearest
  other farmer (so they never read as the neighbour's); your own chat shows over your own head too. The whole layer
  hides under menus, the day-end card and cutscenes. The creator turntable's farmer keeps glancing at the camera
  (`RemoteFarmer.gaze`).
- **UI** (`ui/coop.ts`): Title → Co-op screen (character creator with a live turntable on a grass tile — tabs
  Hair & hat / Face / Outfit, "Try an emote", Surprise me — Host / Join by code, lobby with invite-code tiles, 4
  slots, ping bars, Kick), roster plate (top-left), chat (**T**: a parchment "Say:" row with a counter; a "…"
  bubble shows over whoever is typing, sent as a volatile `typ` message; log chips fade after 8 s, bubbles after
  ~6 s), emote wheel (hold **G**, 1–8; opens beside your farmer with a notch pointing at you, never over your face; number under each icon), join/leave toasts, bedtime overlay ("waiting for 2 farmers"; the host gets **Sleep anyway** after
  10 s), a Co-op card in the pause menu (players, away state, Kick).
- **Day end**: the bed (farmhouse) or your cabin door marks you ready; the day ends when everyone connected is in
  bed (a farmer who drops no longer holds the night hostage). Cabins (`net/cabins.ts`) appear for each farmhand:
  log walls, a pitched shingle roof (one plane per side: deck, flush courses, fascia, barge boards, ridge cap), a
  porch lamp that is a real point light at dusk (through the renderer's light budget, so no extra shader cost),
  and a "Zzz" bubble over the roof while its farmhand sleeps inside. Shingles in the owner's colour (weathered
  toward a warm brown: whose cabin is whose reads across the farm), lapped siding on the gables flush with the log
  faces + a round vent window, festoon bulbs up the front barge boards and a skylight on the east slope (both glow
  after dusk, so the roof never reads as a black slab at night), a fieldstone chimney with a slate cap, clay pot and a
  smoke wisp (one `SmokeEmitter` per cabin). Every machine clears a cabin's footprint
  itself; the host flushes those tiles right away and farmhands fold them into their mirror, so it never reads as
  drift. The day-end card's "Farm today" row has a legend (Harvested · Watered · Tilled · Sown) and a "Busiest"
  ribbon.
- **Perf**: 3 remote farmers cost ~17 draws; all cabins 3 draws (wood, glass, bulbs) + 1 shadow draw + one smoke
  wisp each; net work is a few small JSON messages per tick; farm digests only when
  dirty. The co-op screen (`ui/coop-stage.ts`) renders the world **once** into a GPU-blurred still and draws the
  turntable with the main renderer (no second WebGL context): ~4 draw calls per frame. `services.net.stats()`
  reports fps / frame-time percentiles, RTT, bytes, queue and reconcile / refund / denied counters.
- **Tests**: `node scripts/mp-interp.mjs` (node only) tortures the playout clock: jitter, spikes, stalls, a busy
  fixed-step sender at 150±40 ms one way (≤ 1.45× pace over 5 seeds), a sender stamping frame time, and a sender tab
  frozen 0.6 / 1.2 / 2.5 s mid-walk. `node scripts/mp-adv.mjs [--delay 150 --jitter 40 --walks 5]` (4 clients, one behind a 75±25 ms proxy) adds per-frame pop checks (only frames the game drew; ≤ 1.5× pace over 5 walks + a run), harvest
  races, drop / crash rejoin, bedtime and a per-client frame-time gate (each client measured while the other tabs
  skip drawing: p95 ≤ 20 ms). `npm run mp-test` (relay in its own process + Vite + headless clients) covers sync, convergence, RTT,
  farmhand→farmhand smoothness, drop/rejoin, and the adversarial cases: own save untouched by a co-op night,
  return home on leave, reload without dupes, crash of the last awake farmer, crash-tab rejoin, same-name impostor,
  kick, gold while disconnected, double spend, sowing race refund.
- Demos: `coop-farm` (host view, late afternoon, a 26 s loop in `net/demo-farm.ts`: Juniper and Pip work the berry
  bed from the grass lane behind it, facing the camera — Juniper picks and lobs berries into the basket, Pip waters
  the row in front of him; the host stands three-quarters to the camera at the bed's corner and picks too; Rowan
  hauls the full basket past the bed and up the path to the bin, turns round with a grin, jogs back and waves
  everyone over for coffee. Every line said goes through `net:chat`, so the log matches the bubbles; `&t=<sec>`
  seeks the loop for stills — the loop restarts at that time once `__game.ready()` resolves, so a still taken N s after
  ready lands N s into the coffee beat whatever the boot took; default t = 19.9, everyone facing the camera until ~23.5;
  `services.net.demoSeek(t)` re-seeks a live page), `coop-chat`,
  `coop-bedtime` (you at Juniper's festooned cabin under its porch lamp, a Zzz over the roof, the bedtime banner; the lens
  sits north of the blossom tree so no canopy crosses the frame), `coop-emote` = Fennel's "Wow!" held at the pop's peak
  (overshoot + sparkle ring + hop; `&live=1` lets it play out) with your wheel open beside you,
  `coop-dayend`, `coop-lobby` (creator + lobby; your lobby card follows the creator live). Emote bubbles are drawn in a small overlay pass after post-processing
  (`renderEmoteOverlay`, from `game.afterRender`) so tilt-shift / bloom never smear them.
  `MP_TIMEOUT_MIN` raises mp-test's wall-clock guard on a saturated machine (default 25). Debug: `services.net` (`host()`, `join(code)`, `kick(id)`,
  `players()`, `stats()`, `simulateDrop()`), `services.net.sync.digest()` (per-tile farm state that must match).

## The Hollowdeep (mines, ores, monsters & combat)

The mine (`src/world/mine/`, `systems/mining.ts`, `systems/combat.ts`, `entities/monsters.ts`): a mountain-shelf
entrance (`entrance.ts`: strata cliff, timbered mouth with a lamp-lit drift, the lift headframe) and seeded floors
(`gen.ts`: cellular-automata caverns from `(floor, seed)`) in three biome bands every 10 floors: Earthen Hollows,
Frostvein Grotto, Cinder Depths (`biomes.ts`), repeating with a tier (tougher monsters, richer ore) from 31.

- **Look**: `cave.ts` shell (per-pixel rock COURSES drawn from world height — stacked beds with a dark joint and a
  worn lit lip, no per-vertex banding streaks — blended biplanar slab texture + clamped derivative bump, glowing lava
  fissures over cooled basalt crust plates, packed snow vs glossy blue ice floors, a glossy frozen pool with caustics;
  deep rock merges 2x2 cells as a cheap LOD), `lighting.ts` (lantern spot key + belt-height fill + bounce + a cool rim
  light behind the farmer, 5 accent lights, per-biome grade), `props.ts` (timber frames with lanterns on every back
  wall, iron-bracket wall lanterns, one additive halo sheet for all lamps, carts on rails, crystals, spikes, basalt,
  vents). `occlude.ts`: farmers (local + co-op) and the nearest monsters get a screen-space cutaway through any cave
  geometry in front of them (warm rim on the cut); rock in the bottom band of the frame keeps its form under a soft
  fake key (no black mass), and free-standing props / rim boulders whose FOOT lands in the bottom ~19 % of the frame are
  removed down to their footprint (diorama open front). The farmer's head shadow-proxy casts nothing underground.
  Underground the HUD clock dial becomes a lantern niche and the weather badge hides (`hud.ts: setUnderground`).
- **Rocks & ore** (`gen.ts`, `ores.ts`, `stone.ts`): 3–5 wall-hugging ore seams plus a noise-clustered rock FIELD
  filling ~31 % of the open floor, with 3–4 winding lanes kept clear from the arrival (and to the lift / chest), a
  clearing at the arrival and ≥ 3 ore rocks within 6 tiles of it; on ~85 % of floors the ladder down hides under one
  plain rock out in the field (`layout.ladderRock`, revealed on its tile; the old random reveal still applies);
  one batched draw per material. Metal ores are 6–8 raised, faceted
  NUGGETS in saturated colours (copper salmon-orange, iron pale blue-white, gold yellow) with a self-glow rim and slow
  star glints on a darker, desaturated host rock; gems break out as emissive crystal clusters; coal as glossy chunks;
  every ore rock sits on a faint ore-coloured light pool. Hits flash the rock, squash it, knock ore-coloured nuggets and
  glints loose; breaks burst 20+ chunks and pop loot (≥ 1 stone per rock) that bobs over a tinted glow ring and flies
  to the nearest farmer within 2.5 tiles after 0.5 s (`pickups.ts`, instanced: one draw per loot kind). Ore by depth:
  22–28 % of rocks on floors 1–5 (gems ≤ 1 %), ≈ 26–48 % deeper, iron from 5, gold from 21, diamonds from 25.
- **Combat**: slimes (spring jiggle), bats (pale rim + eye-glow halo), rock crabs, frost wisps (chill), cinder imps
  (fireballs); tier 2+ floors escalate them (darker bodies, a crystal crust on slimes, red eye glints, ★ on the floor
  plaque). The sword (`actions.ts`: short polished blade, alternating slashes) draws a warm-white → gold crescent with two
  lagging afterimages, held 125 ms on impact; hits knock monsters back 1.65 tiles (eased 0.18 s) with a 2-frame full-white
  flash and a 1.3 / 0.7 squash, damage numbers pop 1.4→1 on the victim's head and ride its knockback (rapid hits on one target merge into one ticking number, neighbours fan out sideways; crits gold + shake; the
  farmer's own hurt number is big red with a white outline), kills freeze the arena 60 ms, kick the camera and leave a goo splat.
  Goo splats have a dark meniscus rim and a wet gloss. Arriving on a floor with a farm tool in hand switches to the
  pickaxe (the sword if a monster is within 5 tiles).
  Health tube, i-frames, passing out → carried to the entrance lean-to (+2 h, some gold / loot lost).
- **Co-op** (`coop.ts`, wired through `net/bridge.ts`): the host is authoritative for every occupied floor — seed
  sync, a ledger of broken / damaged rocks, the ladder and loot, 10 Hz monster snapshots interpolated 120 ms behind on
  farmhands, pick / sword **intents** resolved by the host and broadcast (rock state + exact drops, hits with damage /
  crit / kill), monsters chase the nearest living farmer and their hits go to that farmer (health and passing out
  are per player), loot goes to whoever vacuums it. Floors the host isn't on run as **headless sims** on the host
  and migrate live ⇄ headless (same monster ids, hp, loot) when the host arrives / leaves; farmers on other floors
  are hidden. `node scripts/mine-coop-test.mjs` runs the two-browser e2e (shots in `shots/mine-coop/`);
  `services.mineNet.stats()` shows floors, headless sims and message counts.
- **Tests**: `node scripts/mine-passout.test.mjs` drains the tube through `services.health.damage()` on a floor and
  checks the collapse (`combat:passOut`, carried to the entrance, 35 % health back).
- **Demos**: `mine-entrance`, `mine-floor` (earth, floor 3), `mine-ice` (14), `mine-lava` (24), `mine-combat`
  (live arena + autopilot; `&still=1` freezes a landed hit, `&god=1`), `mine-coop` (two scripted farmhands fighting
  and mining beside you, name tags; no server), `mine-chest` (floor 10 reforge). Params: `&floor=N`, `&pick=1`
  (`&still=1` freezes the pick impact), `&foe=0` (no staged monster), `&ui=elevator`.
- **Perf (pillar 14)**: the farmer / monster cutaway's `discard` switches off hidden-surface removal on tile GPUs, so
  every cut-patched material has a solid twin (`occlude.ts`): the shell, rim boulders, rubble and merged props are
  sorted into 2 m cells and each frame only the cells whose bounds can reach a cutaway ellipse or the foreground band
  draw the cut variant (a handful of draw ranges per mesh), the rest draws solid — same pixels. `&occvar=0` turns it
  off (A/B); `OCC_STATS` (import from `world/mine/occlude.ts`) reports cells, cut cells and ranges.

## Cindergrove forest, weather & seasons

Cindergrove (`src/world/forest/`) is south of the farm (warp at the farm's south gate). `layout.ts` holds the anchors
and terrain shape; `giants.ts` the old-growth elders / firs (painted leaf-card canopies, winter twig crowns, laden
firs) and card shrubs; `cliffs.ts` the waterfall cliff (a sculpted wall mesh over the plateau face + shared strata
shader); `props.ts` mossy logs, mushrooms, winterberries / twigs, the Ember Shrine (menhir ring, ember altar) and
the roofed glade tower (door, lit window, ivy); `stream.ts` the waterfall and flow; `forage.ts` seasonal
forageables (interact to pick, `forage:picked`); `motes.ts` dust motes in the light shafts; `foliage.ts` the card
textures, billboard / painted-light patches and the canopy see-through (logs stay solid; a giant trunk standing
between the lens and the farmer opens one crisp farmer-sized window, sized from his projected height); `arrival.ts`
the area plate (dodges the farmer's head, leaves on the first key / click).

Weather (`systems/weather.ts`, visuals in `render/precipitation.ts`, `skyfx.ts`, `groundfx.ts`, `heightfog.ts`,
grade in `render/lighting.ts`): rain + splashes + eave / canopy drips, island puddles with a dark meniscus on darker
soaked paths (`world/terrain.ts` tags standing water in the colour target's alpha, 0.05..0.5; the fog pass traces the
reflected ray through the depth buffer, so the farmer, trunks and the bridge mirror in them; puddles shrink while the
ground dries), storms (one screen-space bolt channel + 2-3 short forks, a hard cold key flash, `weather:lightning` then a
delayed `weather:thunder`, scorch + steam), snow (flakes, top-facing accumulation via `render/worldfx.ts`, drifts,
sastrugi, boot prints), wind gusts of leaves / petals, ground-hugging fog mornings with god rays, rainbows.
Light shafts reach the forest floor and land in dappled sun pools (fog pass, multiplied into the surface colour).
`game.services.weather`: `strike(at?, hold?)`, `setFog(v|null)`, `setRainbow(v|null)`, `state()` (incl. `sky` for the
HUD dial: clear / overcast / storm / snow / fog).

Demos: `forest-day`, `forest-canopy` (low lens under two elders, sun shafts + dappled pools), `forest-rain`, `forest-fall`, `forest-glade`, `forest-night`, `forest-wind`, `forest-arrival`,
`storm`, `storm-meadow`, `snow-day`, `snow-falls`, `fog-morning`, `fog-bridge`, `rainbow`, `farm-storm`, `coop-forest`.
Params: `&bolt=0|1` (posed strike), `&fog=0..1`, `&rainbow=0..1`.

Perf notes: the fog pass (`heightfog.ts`) only receives the light shafts inside the view frustum and skips the
striation noise for pixels away from every beam; the height-fog banks reuse the ground mist's noise when both run.
