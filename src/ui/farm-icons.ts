/**
 * Item icons owned by the farming pod (fertilizer sacks). Registered once by the farming system.
 */
import { registerItemIcon } from './icons';

function sack(body: string, dark: string, label: string, granule: string): string {
  const dots = [
    [20, 16],
    [27, 12],
    [34, 15],
    [41, 12],
    [46, 16],
    [30, 18],
  ]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.4" fill="${granule}" stroke="#3a2a1a" stroke-width="0.8"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" class="ic">
  <ellipse cx="32" cy="58" rx="20" ry="3.5" fill="#000" opacity=".18"/>
  <path d="M14 22 Q12 40 15 54 Q32 60 49 54 Q52 40 50 22 Q32 26 14 22Z" fill="${body}" stroke="#3a2a1a" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M16 24 Q15 40 17 52" stroke="#fff" stroke-opacity=".35" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M14 22 Q20 12 32 14 Q44 12 50 22 Q32 26 14 22Z" fill="${dark}" stroke="#3a2a1a" stroke-width="2.2" stroke-linejoin="round"/>
  ${dots}
  <rect x="21" y="33" width="22" height="14" rx="3" fill="#f6ecd2" stroke="#3a2a1a" stroke-width="1.6"/>
  <text x="32" y="44" font-family="Fredoka, Nunito, sans-serif" font-size="10" font-weight="700" text-anchor="middle" fill="#5a3a20">${label}</text>
</svg>`;
}

let done = false;
export function registerFarmIcons(): void {
  if (done) return;
  done = true;
  registerItemIcon('fertilizer', () => sack('#c9a877', '#8a6a44', 'F', '#e9e2cc'));
  registerItemIcon('qualityFertilizer', () => sack('#5f9a88', '#2f6a5a', 'Q', '#9fe0cc'));
}
