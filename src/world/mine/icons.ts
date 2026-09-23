/**
 * Item art for mine drops the UI painter has no keyword for (ores / gems / coal / the sword are
 * painted by ui/icons.ts from their names + colours). 64×64 viewBox like the painted set.
 */
import { registerItemIcon } from '../../ui/icons';

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

let done = false;
export function registerMineIcons(): void {
  if (done) return;
  done = true;
  registerItemIcon(
    'slimeGel',
    svg(
      `<defs><radialGradient id="sg" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#e4ffc0"/><stop offset=".45" stop-color="#8fe060"/><stop offset="1" stop-color="#3f9a2a"/></radialGradient></defs>` +
        `<ellipse cx="32" cy="54" rx="20" ry="4" fill="#000" opacity=".18"/>` +
        `<path d="M10 46 C8 30 20 14 32 14 C44 14 56 30 54 46 C53 53 44 55 32 55 C20 55 11 53 10 46 Z" fill="url(#sg)" stroke="#2f6a1e" stroke-width="3"/>` +
        `<ellipse cx="24" cy="26" rx="6" ry="4" fill="#fff" opacity=".85" transform="rotate(-25 24 26)"/><circle cx="36" cy="22" r="2" fill="#fff" opacity=".7"/>` +
        `<circle cx="40" cy="40" r="4" fill="#5ab83a" opacity=".6"/><circle cx="24" cy="44" r="2.6" fill="#5ab83a" opacity=".6"/>`,
    ),
  );
  registerItemIcon(
    'duskWing',
    svg(
      `<defs><linearGradient id="dw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a74a0"/><stop offset="1" stop-color="#3e2e4e"/></linearGradient></defs>` +
        `<path d="M6 24 C18 10 38 8 58 16 L54 26 C50 24 46 26 44 32 C40 28 34 30 32 36 C28 32 22 34 20 40 C16 34 10 32 6 24 Z" fill="url(#dw)" stroke="#2a1e36" stroke-width="3"/>` +
        `<path d="M8 24 L56 17 M20 20 L20 40 M32 16 L32 36 M44 15 L44 32" stroke="#c8b0e0" stroke-width="1.6" opacity=".55" fill="none"/>`,
    ),
  );
  registerItemIcon(
    'crabCarapace',
    svg(
      `<defs><linearGradient id="cc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8b890"/><stop offset=".6" stop-color="#a88460"/><stop offset="1" stop-color="#6e5238"/></linearGradient></defs>` +
        `<ellipse cx="32" cy="54" rx="22" ry="4" fill="#000" opacity=".18"/>` +
        `<path d="M8 44 L14 24 L28 14 L44 16 L56 30 L54 46 L36 52 L18 50 Z" fill="url(#cc)" stroke="#4a3624" stroke-width="3"/>` +
        `<path d="M14 24 L30 30 L44 16 M30 30 L36 52 M30 30 L56 30" stroke="#f0dcc0" stroke-width="1.8" opacity=".6" fill="none"/>` +
        `<path d="M8 44 L2 48 M10 38 L3 38 M56 42 L62 46 M56 36 L62 34" stroke="#d8764a" stroke-width="3"/>`,
    ),
  );
}
