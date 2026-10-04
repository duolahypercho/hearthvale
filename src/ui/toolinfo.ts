/**
 * Tool tiers in the UI: what a farm tool's tier does (copy taken from the farming rules — charge rows,
 * can capacity, pick power), the metal pips shown on tooltips / the backpack card, and the forge's upgrade
 * ladder (Odessa's "Tool upgrades" shelf in shop.ts). Tiers are per farmer: a farmhand's upgrade sets their
 * own tier (net/farmsync keeps each farmer's tiers through the host's farm snapshot).
 */
import { TIER_NAMES, TIER_COLORS, CAN_CAPACITY } from '../data/crops';
/** Mirrors systems/farming's FarmTool (ui/ may not import systems/, even for types). */
export type FarmTool = 'hoe' | 'wateringCan' | 'axe' | 'pickaxe' | 'scythe';

/** Farm tools whose tier changes how they work (axe / scythe tiers are cosmetic, so the forge doesn't sell them). */
export const UPGRADABLE: FarmTool[] = ['hoe', 'wateringCan', 'pickaxe'];
const FARM_TOOLS = new Set<string>(['hoe', 'wateringCan', 'axe', 'pickaxe', 'scythe']);

/** Forge price to reach tier `t` (index 1..3): gold + 5 of that metal's ore. */
export const UPGRADE_COST: ({ gold: number; ore: string; n: number } | null)[] = [
  null,
  { gold: 1000, ore: 'copperOre', n: 5 },
  { gold: 2500, ore: 'ironOre', n: 5 },
  { gold: 5000, ore: 'goldOre', n: 5 },
];

let source: ((tool: FarmTool) => number) | null = null;
/** The HUD wires this to the farming service (tooltips have no Game handle). */
export function setTierSource(fn: ((tool: FarmTool) => number) | null): void {
  source = fn;
}

/** Current tier of a farm tool id, or null for anything else. */
export function tierOf(id: string): number | null {
  if (!FARM_TOOLS.has(id) || !source) return null;
  try {
    return source(id as FarmTool);
  } catch {
    return null;
  }
}

/** What the tool does at tier `t` (short, for a tooltip line). */
export function tierPower(id: string, t: number): string {
  if (id === 'hoe' || id === 'wateringCan') {
    const reach = t >= 3 ? 'a 3×3 patch' : t === 2 ? 'a row of 5' : t === 1 ? 'a row of 3' : '';
    const can = id === 'wateringCan' ? `holds ${CAN_CAPACITY[t as 0 | 1 | 2 | 3]}` : '';
    if (!reach) return id === 'hoe' ? 'one tile a swing' : `${can} · one tile a pour`;
    return `${can ? `${can} · ` : ''}hold to charge: ${reach}`;
  }
  if (id === 'pickaxe') return `strikes ×${1 + t}${t ? ` · ${8 * t}% faster swings below` : ''}`;
  return t ? 'a finer edge' : 'trusty and plain';
}

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** Four metal pips (lit up to `t`) + the tier's name. */
export function tierPips(t: number): string {
  const pips = [0, 1, 2, 3].map((k) => `<i class="tp${k <= t ? ' on' : ''}" style="--tc:${hex(TIER_COLORS[k as 0 | 1 | 2 | 3])}"></i>`).join('');
  return `<span class="t-tier"><span class="pips">${pips}</span><b style="--tc:${hex(TIER_COLORS[t as 0 | 1 | 2 | 3] ?? TIER_COLORS[0])}">${TIER_NAMES[t as 0 | 1 | 2 | 3] ?? 'Basic'}</b></span>`;
}

/** Tooltip / backpack line for a farm tool: tier pips + what it does + where to improve it. */
export function toolFactsHtml(id: string): string {
  const t = tierOf(id);
  if (t === null) return '';
  const next = UPGRADABLE.includes(id as FarmTool) && t < 3 ? `<small class="t-up">${TIER_NAMES[(t + 1) as 1 | 2 | 3]} at Odessa’s forge</small>` : '';
  return `<div class="t-toolrow">${tierPips(t)}<span class="t-pow">${tierPower(id, t)}</span>${next}</div>`;
}
