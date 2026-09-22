#!/bin/sh
# Re-capture the critic's shot list into a folder (default shots/r3/set): same URLs as critic-r2.
OUT=${1:-shots/r3/set}
mkdir -p "$OUT"
cd "$(dirname "$0")/.."
run() { node scripts/shot.mjs --url "$1" --out "$OUT/$2" $3 > "$OUT/log-${2%.png}.txt" 2>&1; }
run "?demo=farm-morning" morning.png &
run "?demo=farm-evening" evening.png &
run "?demo=farm-morning&season=fall" fall.png &
run "?demo=farm-morning&weather=rain" rain.png &
wait
run "?demo=farm-morning&time=22" night.png &
run "?demo=farm-morning&season=winter" winter.png &
run "?demo=winter-night" winter-night.png &
run "?demo=farm-pond" pond.png &
wait
run "?map=farm&x=30&z=26&time=9" walk.png "--frames 3 --every 400 --hold KeyD:500,KeyS:500" &
run "?demo=farm-morning&ui=inventory" inventory.png &
run "?demo=town-evening" town-evening.png &
run "?demo=town-dialogue" town-dialogue.png &
wait
run "?demo=festival" festival.png &
run "?demo=title" title.png &
run "?demo=farm-field" field.png &
run "?demo=farm-morning" seq.png "--frames 6 --every 250" &
wait
for f in "$OUT"/log-*.txt; do printf '%s ' "$(basename $f)"; grep -o '"drawCalls":[0-9]*,"triangles":[0-9]*' "$f" | head -1; grep -i "pageerror\|console.error\|failed" "$f" | head -3; done
