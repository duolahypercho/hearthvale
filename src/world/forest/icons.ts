/**
 * Item art for Cindergrove's forageables (64×64 viewBox, the painted set's look: a dark warm outline,
 * soft gradient body, a white gloss dab, a contact shadow). The toast, the toolbar flight, the
 * backpack and the shipping ledger all show the find itself rather than a generic leaf.
 */
import { registerItemIcon } from '../../ui/icons';

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;
const shadow = (rx = 20): string => `<ellipse cx="32" cy="57" rx="${rx}" ry="3.6" fill="#000" opacity=".18"/>`;
const OUT = '#3a2616';

const ART: Record<string, string> = {
  wildLeek:
    `<defs><linearGradient id="lk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd86a"/><stop offset="1" stop-color="#3f8a2e"/></linearGradient><radialGradient id="lb" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fffdf2"/><stop offset="1" stop-color="#e2d6b4"/></radialGradient></defs>` +
    shadow(14) +
    `<path d="M30 40 C24 28 14 16 8 6 C18 12 28 22 33 34 Z" fill="url(#lk)" stroke="${OUT}" stroke-width="2.6"/>` +
    `<path d="M33 38 C34 24 38 12 46 4 C44 16 40 28 37 40 Z" fill="url(#lk)" stroke="${OUT}" stroke-width="2.6"/>` +
    `<path d="M34 40 C40 30 50 24 58 20 C52 28 44 36 38 42 Z" fill="url(#lk)" stroke="${OUT}" stroke-width="2.6"/>` +
    `<path d="M24 46 C24 38 30 34 34 34 C40 34 44 40 42 46 C40 52 34 54 32 54 C28 54 24 51 24 46 Z" fill="url(#lb)" stroke="${OUT}" stroke-width="3"/>` +
    `<path d="M28 54 L25 60 M32 55 L32 61 M36 54 L39 60" stroke="#b8a680" stroke-width="2" fill="none"/>` +
    `<ellipse cx="30" cy="42" rx="3" ry="2" fill="#fff" opacity=".9"/>`,
  morel:
    `<defs><radialGradient id="mc" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#e2c08a"/><stop offset=".6" stop-color="#b08652"/><stop offset="1" stop-color="#7a5430"/></radialGradient></defs>` +
    shadow(15) +
    `<path d="M24 44 L22 56 C26 58 38 58 42 56 L40 44 Z" fill="#f2e6cc" stroke="${OUT}" stroke-width="3"/>` +
    `<path d="M32 4 C44 8 48 26 44 44 C38 48 26 48 20 44 C16 26 20 8 32 4 Z" fill="url(#mc)" stroke="${OUT}" stroke-width="3"/>` +
    `<g fill="#5a3a1e" opacity=".75"><ellipse cx="27" cy="16" rx="3" ry="4"/><ellipse cx="36" cy="14" rx="3" ry="4"/><ellipse cx="24" cy="28" rx="3" ry="4.5"/><ellipse cx="32" cy="26" rx="3" ry="4.5"/><ellipse cx="40" cy="27" rx="2.6" ry="4.5"/><ellipse cx="27" cy="39" rx="3" ry="4"/><ellipse cx="36" cy="38" rx="3" ry="4"/></g>` +
    `<ellipse cx="28" cy="10" rx="3" ry="1.8" fill="#fff" opacity=".7"/>`,
  duskViolet:
    `<defs><radialGradient id="dv" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#d8b8ff"/><stop offset=".7" stop-color="#8a5ad0"/><stop offset="1" stop-color="#5a3494"/></radialGradient></defs>` +
    shadow(14) +
    `<path d="M32 36 C31 44 30 50 32 58" stroke="#3f7a2e" stroke-width="3.4" fill="none"/>` +
    `<path d="M31 50 C22 44 14 46 10 52 C18 56 26 54 31 50 Z" fill="#5fa040" stroke="${OUT}" stroke-width="2.4"/>` +
    `<g stroke="${OUT}" stroke-width="2.6" fill="url(#dv)"><ellipse cx="32" cy="12" rx="8" ry="10"/><ellipse cx="18" cy="24" rx="10" ry="8" transform="rotate(-20 18 24)"/><ellipse cx="46" cy="24" rx="10" ry="8" transform="rotate(20 46 24)"/><ellipse cx="24" cy="38" rx="8" ry="9" transform="rotate(25 24 38)"/><ellipse cx="40" cy="38" rx="8" ry="9" transform="rotate(-25 40 38)"/></g>` +
    `<path d="M32 26 L32 16 M30 28 L20 24 M34 28 L44 24" stroke="#4a2a7a" stroke-width="1.4" opacity=".7"/>` +
    `<circle cx="32" cy="28" r="4.4" fill="#ffd84a" stroke="${OUT}" stroke-width="2"/>` +
    `<ellipse cx="29" cy="9" rx="2.6" ry="1.6" fill="#fff" opacity=".8"/>`,
  hedgeBerry:
    `<defs><radialGradient id="hb" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ff8a8a"/><stop offset=".55" stop-color="#d8283e"/><stop offset="1" stop-color="#8a1224"/></radialGradient></defs>` +
    shadow(18) +
    `<path d="M32 22 C26 10 14 6 6 10 C12 20 24 24 32 22 Z" fill="#5fa040" stroke="${OUT}" stroke-width="2.4"/>` +
    `<path d="M34 22 C40 10 52 6 58 12 C50 20 42 24 34 22 Z" fill="#4f9036" stroke="${OUT}" stroke-width="2.4"/>` +
    `<path d="M32 22 L24 34 M32 22 L40 32 M32 22 L32 40" stroke="#6a4a2a" stroke-width="2.4" fill="none"/>` +
    `<g stroke="${OUT}" stroke-width="2.6" fill="url(#hb)"><circle cx="22" cy="40" r="9"/><circle cx="42" cy="38" r="9"/><circle cx="32" cy="48" r="9"/></g>` +
    `<g fill="#fff" opacity=".85"><ellipse cx="19" cy="36" rx="2.6" ry="1.8"/><ellipse cx="39" cy="34" rx="2.6" ry="1.8"/><ellipse cx="29" cy="44" rx="2.6" ry="1.8"/></g>`,
  fiddlehead:
    `<defs><linearGradient id="fh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b8e678"/><stop offset="1" stop-color="#4a8a2a"/></linearGradient></defs>` +
    shadow(14) +
    `<path d="M36 58 C38 46 44 38 44 28" stroke="${OUT}" stroke-width="9" fill="none"/>` +
    `<path d="M36 58 C38 46 44 38 44 28" stroke="url(#fh)" stroke-width="5" fill="none"/>` +
    `<circle cx="32" cy="22" r="16" fill="url(#fh)" stroke="${OUT}" stroke-width="3"/>` +
    `<path d="M44 28 C46 16 38 10 30 12 C22 14 20 24 26 28 C30 31 36 28 35 23 C34 19 30 19 29 22" stroke="#2f6a1e" stroke-width="3" fill="none"/>` +
    `<g fill="#8ac85a" stroke="${OUT}" stroke-width="1.6"><path d="M16 18 l-5 -3 l2 5 z"/><path d="M18 32 l-5 2 l5 2 z"/><path d="M28 38 l-2 5 l4 -2 z"/></g>` +
    `<ellipse cx="26" cy="12" rx="3.4" ry="2" fill="#fff" opacity=".7"/>`,
  sweetPea:
    `<defs><radialGradient id="sp" cx="45%" cy="40%" r="70%"><stop offset="0" stop-color="#ffe0ee"/><stop offset=".6" stop-color="#f28ab8"/><stop offset="1" stop-color="#c04a86"/></radialGradient></defs>` +
    shadow(14) +
    `<path d="M30 40 C28 48 30 54 34 58" stroke="#3f7a2e" stroke-width="3.2" fill="none"/>` +
    `<path d="M31 48 C38 46 44 50 46 44 C48 38 42 38 42 42" stroke="#5fa040" stroke-width="2.2" fill="none"/>` +
    `<path d="M12 22 C12 8 30 2 40 8 C52 14 54 30 44 34 C38 36 36 30 32 30 C26 30 22 36 16 34 C12 32 12 28 12 22 Z" fill="url(#sp)" stroke="${OUT}" stroke-width="3"/>` +
    `<path d="M20 22 C24 16 32 14 38 18" stroke="#fff" stroke-width="2" fill="none" opacity=".7"/>` +
    `<path d="M24 30 C24 38 28 42 32 42 C36 42 40 38 38 32 C34 34 28 34 24 30 Z" fill="#f7a8cc" stroke="${OUT}" stroke-width="2.6"/>` +
    `<path d="M16 30 q3 -2 5 1 M44 30 q-3 -2 -5 1" stroke="#c04a86" stroke-width="1.6" fill="none"/>`,
  chanterelle:
    `<defs><linearGradient id="ch" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset=".6" stop-color="#f0a83a"/><stop offset="1" stop-color="#c47a1e"/></linearGradient></defs>` +
    shadow(15) +
    `<path d="M8 18 C14 12 24 16 32 14 C40 12 50 12 56 18 C54 26 42 30 38 36 C36 44 38 52 36 56 C32 58 30 58 26 56 C26 50 28 42 26 36 C20 30 10 26 8 18 Z" fill="url(#ch)" stroke="${OUT}" stroke-width="3"/>` +
    `<path d="M14 20 C20 22 26 22 32 20 C38 22 44 22 50 20" stroke="#fff3c8" stroke-width="2" fill="none" opacity=".75"/>` +
    `<path d="M20 25 L28 36 M32 24 L31 40 M44 25 L36 36" stroke="#b86a1a" stroke-width="1.6" opacity=".7"/>`,
  hazelnut:
    `<defs><radialGradient id="hz" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#d8a06a"/><stop offset=".6" stop-color="#9a6a3a"/><stop offset="1" stop-color="#5e3a1c"/></radialGradient></defs>` +
    shadow(16) +
    `<path d="M32 6 C44 10 50 26 48 38 C46 50 38 56 32 56 C26 56 18 50 16 38 C14 26 20 10 32 6 Z" fill="url(#hz)" stroke="${OUT}" stroke-width="3"/>` +
    `<path d="M22 20 C24 32 24 44 30 54 M38 12 C42 24 42 40 38 54" stroke="#7a4e28" stroke-width="1.6" fill="none" opacity=".6"/>` +
    `<path d="M10 42 C14 36 18 44 22 38 C24 44 28 38 32 44 C36 38 40 44 42 38 C46 44 50 36 54 42 C54 52 44 60 32 60 C20 60 10 52 10 42 Z" fill="#b8c060" stroke="${OUT}" stroke-width="2.8"/>` +
    `<path d="M16 48 L20 54 M26 48 L28 56 M38 48 L36 56 M48 48 L44 54" stroke="#7a8a30" stroke-width="1.6"/>` +
    `<ellipse cx="26" cy="16" rx="3.6" ry="2.2" fill="#fff" opacity=".75"/>`,
  emberCap:
    `<defs><radialGradient id="ec" cx="40%" cy="28%" r="80%"><stop offset="0" stop-color="#ffb06a"/><stop offset=".5" stop-color="#e0502a"/><stop offset="1" stop-color="#8a1e10"/></radialGradient></defs>` +
    shadow(16) +
    `<path d="M26 34 C25 42 24 50 22 56 C28 58 36 58 42 56 C40 50 39 42 38 34 Z" fill="#f4ead2" stroke="${OUT}" stroke-width="3"/>` +
    `<path d="M6 34 C6 18 18 8 32 8 C46 8 58 18 58 34 C50 38 14 38 6 34 Z" fill="url(#ec)" stroke="${OUT}" stroke-width="3"/>` +
    `<g fill="#ffe08a" stroke="#b8401e" stroke-width="1"><circle cx="20" cy="22" r="3.4"/><circle cx="34" cy="16" r="2.8"/><circle cx="46" cy="26" r="3.2"/><circle cx="30" cy="29" r="2.2"/></g>` +
    `<path d="M16 16 C22 11 30 10 36 11" stroke="#fff" stroke-width="2.6" fill="none" opacity=".75"/>`,
  snowRoot:
    `<defs><linearGradient id="sr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffaf0"/><stop offset=".6" stop-color="#e8dcc8"/><stop offset="1" stop-color="#b8a488"/></linearGradient></defs>` +
    shadow(12) +
    `<path d="M30 16 C24 8 18 6 14 4 M32 16 C34 8 38 4 44 2 M31 16 C30 10 30 6 30 2" stroke="#5f8a4a" stroke-width="3.4" fill="none"/>` +
    `<path d="M20 22 C20 14 44 14 44 22 C44 34 38 46 32 60 C26 46 20 34 20 22 Z" fill="url(#sr)" stroke="${OUT}" stroke-width="3"/>` +
    `<path d="M24 28 L30 29 M36 34 L40 33 M28 40 L33 41" stroke="#a89070" stroke-width="1.6"/>` +
    `<g fill="#d8f0ff"><circle cx="26" cy="20" r="1.6"/><circle cx="38" cy="22" r="1.4"/><circle cx="34" cy="30" r="1.2"/><circle cx="28" cy="34" r="1"/></g>` +
    `<ellipse cx="26" cy="22" rx="2.4" ry="3.4" fill="#fff" opacity=".85"/>`,
  frostHolly:
    `<defs><linearGradient id="fhl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6ab870"/><stop offset="1" stop-color="#1f5a30"/></linearGradient></defs>` +
    shadow(18) +
    `<path d="M32 34 L8 20 L14 18 L12 12 L20 14 L22 8 L26 14 L30 10 L32 18 Z" fill="url(#fhl)" stroke="${OUT}" stroke-width="2.6"/>` +
    `<path d="M32 34 L56 20 L50 18 L52 12 L44 14 L42 8 L38 14 L34 10 L32 18 Z" fill="url(#fhl)" stroke="${OUT}" stroke-width="2.6"/>` +
    `<path d="M32 34 L20 54 L24 52 L26 58 L30 52 L34 56 L34 48 L38 46 Z" fill="url(#fhl)" stroke="${OUT}" stroke-width="2.6"/>` +
    `<path d="M12 16 L30 28 M52 16 L34 28" stroke="#b8f0c0" stroke-width="1.4" opacity=".7"/>` +
    `<g stroke="#e8f6ff" stroke-width="1.6" opacity=".85"><path d="M16 14 l2 -2 M24 12 l1 -3 M42 12 l-1 -3 M48 14 l-2 -2"/></g>` +
    `<g stroke="${OUT}" stroke-width="2.4" fill="#e0242e"><circle cx="28" cy="36" r="6"/><circle cx="38" cy="36" r="6"/><circle cx="33" cy="44" r="6"/></g>` +
    `<g fill="#fff" opacity=".9"><circle cx="26" cy="34" r="1.8"/><circle cx="36" cy="34" r="1.8"/><circle cx="31" cy="42" r="1.8"/></g>`,
  crystalCone:
    `<defs><linearGradient id="cc2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4fcff"/><stop offset=".5" stop-color="#9fd4ee"/><stop offset="1" stop-color="#4a8ab8"/></linearGradient></defs>` +
    shadow(13) +
    `<path d="M32 4 C44 12 48 30 44 46 C40 56 24 56 20 46 C16 30 20 12 32 4 Z" fill="url(#cc2)" stroke="#23405e" stroke-width="3"/>` +
    `<g fill="none" stroke="#3a6a90" stroke-width="1.8" opacity=".8"><path d="M22 20 Q32 26 42 20"/><path d="M20 30 Q32 36 44 30"/><path d="M20 40 Q32 46 44 40"/><path d="M26 14 L30 24 L26 34 L30 44 M38 14 L34 24 L38 34 L34 44"/></g>` +
    `<path d="M26 12 L24 26" stroke="#fff" stroke-width="3" opacity=".85"/>` +
    `<path d="M50 10 l2 -4 l2 4 l4 2 l-4 2 l-2 4 l-2 -4 l-4 -2 z" fill="#fff"/>` +
    `<path d="M30 54 L30 60" stroke="#6a4a2a" stroke-width="3"/>`,
};

let done = false;
export function registerForestIcons(): void {
  if (done) return;
  done = true;
  for (const [id, body] of Object.entries(ART)) registerItemIcon(id, svg(body));
}
