/** Inline SVG item/tool icons (procedural, crisp at any DPI). 24×24 viewBox. */
const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const HANDLE = '#a8743f';
const HANDLE_D = '#6e4524';
const METAL = '#c8cfd6';
const METAL_D = '#6f7a86';

export const ICONS: Record<string, string> = {
  hoe: svg(
    `<path d="M6 21 L16 7" stroke="${HANDLE_D}" stroke-width="3.2"/><path d="M6 21 L16 7" stroke="${HANDLE}" stroke-width="2"/>` +
      `<path d="M13.5 5.5 L19.5 4 L20 8 L16.5 8.5 Z" fill="${METAL}" stroke="${METAL_D}" stroke-width="1.2"/>`,
  ),
  wateringCan: svg(
    `<path d="M5 10 h10 v8 a2 2 0 0 1 -2 2 h-6 a2 2 0 0 1 -2 -2 z" fill="#5fa3c9" stroke="#2f5f7d" stroke-width="1.2"/>` +
      `<path d="M15 12 L21 7" stroke="#2f5f7d" stroke-width="2.6"/><path d="M15 12 L21 7" stroke="#5fa3c9" stroke-width="1.4"/>` +
      `<path d="M7 10 a3 3 0 0 1 6 0" fill="none" stroke="#2f5f7d" stroke-width="1.6"/><path d="M6.5 13 h7" stroke="#8fcbe8" stroke-width="1"/>`,
  ),
  axe: svg(
    `<path d="M7 21 L15 6" stroke="${HANDLE_D}" stroke-width="3.2"/><path d="M7 21 L15 6" stroke="${HANDLE}" stroke-width="2"/>` +
      `<path d="M12.5 5 C15 2 20 3 20.5 7 C18 7.5 16 8 14.5 9.5 Z" fill="${METAL}" stroke="${METAL_D}" stroke-width="1.2"/>`,
  ),
  pickaxe: svg(
    `<path d="M8 21 L14 9" stroke="${HANDLE_D}" stroke-width="3.2"/><path d="M8 21 L14 9" stroke="${HANDLE}" stroke-width="2"/>` +
      `<path d="M5 8 C9 3.5 16 3 21 6.5 C16 5.5 10 6 5 8 Z" fill="${METAL}" stroke="${METAL_D}" stroke-width="1.2"/>`,
  ),
  scythe: svg(
    `<path d="M9 22 L12 5" stroke="${HANDLE_D}" stroke-width="3"/><path d="M9 22 L12 5" stroke="${HANDLE}" stroke-width="1.8"/>` +
      `<path d="M12 5 C17 3 21 6 21.5 11 C19 7.5 15.5 6.5 12 7 Z" fill="${METAL}" stroke="${METAL_D}" stroke-width="1.1"/>`,
  ),
  seeds: svg(
    `<path d="M6 9 C6 6 8 5 12 5 C16 5 18 6 18 9 L19 19 C19 20.5 18 21 16.5 21 H7.5 C6 21 5 20.5 5 19 Z" fill="#e3c48f" stroke="#8a6436" stroke-width="1.2"/>` +
      `<path d="M8 6 C10 7.5 14 7.5 16 6" fill="none" stroke="#8a6436" stroke-width="1.2"/>` +
      `<circle cx="12" cy="14" r="3.2" fill="#7fbf4a" stroke="#3f7a2a" stroke-width="1"/><path d="M12 12 v4 M10 14 h4" stroke="#3f7a2a" stroke-width="0.9"/>`,
  ),
  parsnip: svg(
    `<path d="M12 22 C9 17 8.5 12 9.5 10 C10.5 8.5 13.5 8.5 14.5 10 C15.5 12 15 17 12 22 Z" fill="#f2dfa8" stroke="#a88a4a" stroke-width="1.1"/>` +
      `<path d="M12 9 C10 5 8 4 7 4 M12 9 C12 5 13 3 14 2.5 M12 9 C14 6 16 5 17.5 5" stroke="#5aa03e" stroke-width="1.8" fill="none"/>`,
  ),
  coin: svg(`<circle cx="12" cy="12" r="8" fill="#f5c542" stroke="#a87412" stroke-width="1.6"/><circle cx="12" cy="12" r="5" fill="none" stroke="#d99a1c" stroke-width="1.2"/><path d="M10.5 9.5 h3 M10.5 14.5 h3 M12 8.5 v7" stroke="#a87412" stroke-width="1.2"/>`),
  sun: svg(`<circle cx="12" cy="12" r="4.5" fill="#ffd166" stroke="#d9912b" stroke-width="1.2"/><g stroke="#e8a33a" stroke-width="1.6"><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></g>`),
  rain: svg(`<path d="M7 14 a4 4 0 0 1 0.5 -8 a5 5 0 0 1 9.5 1.5 a3.3 3.3 0 0 1 0 6.5 Z" fill="#dfe8f2" stroke="#7c8ea3" stroke-width="1.2"/><g stroke="#4f8fd6" stroke-width="1.6"><path d="M9 17l-1 3M13 17l-1 3M17 17l-1 3"/></g>`),
  storm: svg(`<path d="M7 13 a4 4 0 0 1 0.5 -8 a5 5 0 0 1 9.5 1.5 a3.3 3.3 0 0 1 0 6.5 Z" fill="#b8c2d0" stroke="#5c6878" stroke-width="1.2"/><path d="M12 13 l-2 4 h3 l-2 5" fill="none" stroke="#ffd166" stroke-width="1.8"/>`),
  snow: svg(`<g stroke="#7fb2e0" stroke-width="1.8"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/></g><circle cx="12" cy="12" r="2" fill="#eaf4ff" stroke="#7fb2e0"/>`),
  wind: svg(`<g fill="none" stroke="#8aa6bf" stroke-width="1.8"><path d="M3 9h11a3 3 0 1 0 -3 -3"/><path d="M3 14h15a3 3 0 1 1 -3 3"/><path d="M3 19h7"/></g>`),
  moon: svg(`<path d="M15 3 a9 9 0 1 0 6 13 a7 7 0 0 1 -6 -13 Z" fill="#f2e6b8" stroke="#b8a060" stroke-width="1.2"/>`),
  spring: svg(`<g fill="#ff9fbf" stroke="#d9678c" stroke-width="0.8"><circle cx="12" cy="7" r="3.2"/><circle cx="16.8" cy="10.5" r="3.2"/><circle cx="15" cy="16" r="3.2"/><circle cx="9" cy="16" r="3.2"/><circle cx="7.2" cy="10.5" r="3.2"/></g><circle cx="12" cy="12" r="2.4" fill="#ffd166"/>`),
  summer: svg(`<circle cx="12" cy="12" r="6" fill="#ffc94a" stroke="#e08a1e" stroke-width="1.4"/>`),
  fall: svg(`<path d="M12 3 C17 6 20 11 18 16 C16 20 10 21 7 18 C4 15 5 8 12 3 Z" fill="#e8812e" stroke="#9c4a17" stroke-width="1.2"/><path d="M7 18 L15 8" stroke="#9c4a17" stroke-width="1.2"/>`),
  winter: svg(`<g stroke="#6aa6d8" stroke-width="1.8"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/></g>`),
};

export const WEATHER_ICON: Record<string, string> = { sun: 'sun', rain: 'rain', storm: 'storm', snow: 'snow', wind: 'wind' };
