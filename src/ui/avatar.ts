/** Painted SVG bust of the farmer (matches the 3D rig palette): straw hat, auburn hair, scarf, overalls. */
let n = 0;
export function farmerAvatar(bg: [string, string] = ['#bfe4ff', '#8fc8a0']): string {
  const id = `fa${n++}`;
  return `<svg viewBox="0 0 120 120" class="u-avatar"><defs>
  <radialGradient id="${id}b" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></radialGradient>
  <radialGradient id="${id}s" cx="42%" cy="38%" r="70%"><stop offset="0" stop-color="#fbd0ae"/><stop offset=".75" stop-color="#ecb48e"/><stop offset="1" stop-color="#d4946e"/></radialGradient>
  <linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7dc98"/><stop offset="1" stop-color="#d4a654"/></linearGradient>
  <linearGradient id="${id}o" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7aa876"/><stop offset="1" stop-color="#4a7248"/></linearGradient>
  <clipPath id="${id}c"><circle cx="60" cy="60" r="58"/></clipPath></defs>
  <g clip-path="url(#${id}c)">
  <rect width="120" height="120" fill="url(#${id}b)"/>
  <path d="M0 96 C20 86 40 90 60 92 C82 94 100 84 120 90 V120 H0 Z" fill="#6aae45" opacity=".55"/>
  <path d="M18 120 C18 96 36 86 60 86 C84 86 102 96 102 120 Z" fill="#f0e4c8" stroke="#3b2313" stroke-width="2.5"/>
  <path d="M34 120 V100 C34 96 38 94 42 94 H78 C82 94 86 96 86 100 V120 Z" fill="url(#${id}o)" stroke="#3b2313" stroke-width="2.5"/>
  <rect x="50" y="100" width="20" height="12" rx="3" fill="#4a7248" stroke="#2a4428" stroke-width="1.5"/>
  <circle cx="42" cy="99" r="2.6" fill="#e0c060" stroke="#6a5010"/><circle cx="78" cy="99" r="2.6" fill="#e0c060" stroke="#6a5010"/>
  <path d="M40 86 C48 94 72 94 80 86 L78 80 C70 86 50 86 42 80 Z" fill="#e07a5f" stroke="#3b2313" stroke-width="2.3"/>
  <path d="M60 90 L54 104 L62 102 Z" fill="#c85a44" stroke="#3b2313" stroke-width="2"/>
  <ellipse cx="60" cy="58" rx="27" ry="26" fill="url(#${id}s)" stroke="#3b2313" stroke-width="2.6"/>
  <path d="M33 56 C30 40 40 32 60 32 C80 32 90 40 87 56 C84 48 78 44 70 44 C66 48 58 50 48 48 C42 48 36 50 33 56 Z" fill="#8a4a2a" stroke="#3b2313" stroke-width="2.4"/>
  <path d="M34 58 C32 64 33 70 36 74 L38 62 Z M86 58 C88 64 87 70 84 74 L82 62 Z" fill="#8a4a2a" stroke="#3b2313" stroke-width="2"/>
  <ellipse cx="49" cy="61" rx="4" ry="5" fill="#2a1a12"/><ellipse cx="71" cy="61" rx="4" ry="5" fill="#2a1a12"/>
  <circle cx="50.4" cy="59" r="1.6" fill="#fff"/><circle cx="72.4" cy="59" r="1.6" fill="#fff"/>
  <ellipse cx="42" cy="69" rx="5" ry="3" fill="#f5a38c" opacity=".7"/><ellipse cx="78" cy="69" rx="5" ry="3" fill="#f5a38c" opacity=".7"/>
  <path d="M53 72 C56 76 64 76 67 72" fill="none" stroke="#3b2313" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M14 40 C24 34 96 34 106 40 C100 46 20 46 14 40 Z" fill="url(#${id}h)" stroke="#3b2313" stroke-width="2.5"/>
  <path d="M36 40 C36 20 84 20 84 40 Z" fill="url(#${id}h)" stroke="#3b2313" stroke-width="2.5"/>
  <path d="M36.5 34 H83.5 V40 H36.5 Z" fill="#3d6f8f" stroke="#3b2313" stroke-width="2"/>
  <path d="M42 26 C48 22 56 21 62 22" fill="none" stroke="#fff6d0" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>
  <path d="M40 24 L44 31 M50 21 L52 30 M62 21 L62 30 M72 22 L71 30" stroke="#b8893a" stroke-width="1.2" opacity=".6"/>
  </g><circle cx="60" cy="60" r="58" fill="none" stroke="#3b2313" stroke-width="3"/></svg>`;
}
