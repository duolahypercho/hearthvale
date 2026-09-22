# systems/

Gameplay systems. Each exports a class implementing `System` (see `src/core/system.ts`) and is registered with ONE line in
`SYSTEMS` in `src/core/game.ts`. Talk to other systems only through `game.events` (typed, extend via declaration
merging) or `game.services` (typed APIs published with `game.provide(...)`). Importing a sibling system fails
`npm run lint`.

| system       | owns                                                                                          |
|--------------|-----------------------------------------------------------------------------------------------|
| `season`     | applies the calendar season to lighting + map (blend on `season:change`, snap on `season:apply`) |
| `weather`    | lighting/map weather, rain streaks + splashes, snowfall, storm lightning                        |
| `inventory`  | 30-slot backpack (first 10 = toolbar), `item:use` from `player:use`, `item:give`; service `inventory` |
| `farming`    | till / water / plant / grow / harvest, sprinklers, seasonal die-off, soil + crop visuals, demo field |
| `shipping`   | shipping bin deposits, overnight payout + `shipping:summary`                                     |
| `critters`   | butterflies, songbirds, farm cat, chickens placed from the map's `poi` anchors                    |
