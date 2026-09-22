#!/bin/sh
# usage: scripts/perf-shot.sh "<url>" out.png [wait] → shot + per-system perf table
LOG="${2%.png}.log"
node "$(dirname "$0")/shot.mjs" --url "$1" --out "$2" ${3:+--wait $3} > "$LOG" 2>&1
grep -v '^\[shot\] info' "$LOG" | grep -iv 'wrote\|gpu:\|ready in' 
grep '\[shot\] info' "$LOG" | sed 's/.*info //' | python3 -c "
import json,sys
d=json.load(sys.stdin); p=d['perf']
print('TOTAL', p['drawCalls'], p['triangles'])
for k,v in list(p.get('bySystem',{}).items())[:14]: print('  %-22s %4d %8d' % (k, v['calls'], v['triangles']))
"
