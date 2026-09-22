# systems/

Gameplay systems (farming, tools, items, shipping, NPCs, dialogue, fishing, mining, weather, audio, …).
Each exports a class implementing `System` (see `src/core/system.ts`) and is registered with ONE line in
`SYSTEMS` in `src/core/game.ts`. Talk to other systems only through `game.events` / the `Game` context.
