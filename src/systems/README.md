# systems/

Gameplay systems. Each exports a class implementing `System` (see `src/core/system.ts`) and is registered with ONE line in
`SYSTEMS` in `src/core/game.ts`. Talk to other systems only through `game.events` (typed, extend via declaration
merging) or `game.services` (typed APIs published with `game.provide(...)`). Importing a sibling system fails
`npm run lint`.

| system       | owns                                                                                          |
|--------------|-----------------------------------------------------------------------------------------------|
| `economy`    | the purse: service `economy` (gold / set / add / spend), `gold:change`, `gold:insufficient`      |
| `energy`     | stamina: service `energy` (spend / restore), overnight refill (½ after passing out), `energy:exhausted` |
| `season`     | applies the calendar season to lighting + map (blend on `season:change`, snap on `season:apply`) |
| `weather`    | lighting/map weather, rain streaks + splashes, snowfall, storm lightning                        |
| `inventory`  | 30-slot backpack (first 10 = toolbar), `item:use` from `player:use`, `item:give`; service `inventory` |
| `farming`    | till / water / plant / grow / harvest, sprinklers, seasonal die-off, soil + crop visuals, demo field |
| `shipping`   | shipping bin deposits, overnight payout + `shipping:summary`                                     |
| `critters`   | butterflies, songbirds, farm cat, chickens placed from the map's `poi` anchors                    |
| `npcs`       | villagers on the town map: schedules, staging (demo / festival ring), talking → `npc:talk`      |
| `warps`      | map transitions at the grid's warp tiles                                                       |
| `audio`      | procedural WebAudio ambience, music, footsteps, SFX                                             |
| `sleep`      | bed (farmhouse door after 18:00) / pass-out at 2 am, gold penalty, `sleep:summary`; service `sleep` |
| `relationships` | friendship points → hearts, daily talk bonus, gifts by taste (birthday ×8); service `relationships` |
| `fishing`    | stub: cast → bite → reel state machine over data/fish.ts; service `fishing`, `fishing:*` events  |
| `mining`     | stub: current / deepest floor, rock breaks; service `mining`, `mine:*` events                    |
| `crafting`   | recipes (data/recipes.ts) paid from the inventory; service `crafting`, `craft:made` / `craft:failed` |
| `quests`     | Lantern Hall bundles (data/bundles.ts): contribute, relight lanterns, `quest:hallRestored`       |
