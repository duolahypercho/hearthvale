/**
 * Painted moonlit valley behind the end-of-day ledger — a layered SVG "night diorama" that echoes the 3D farm:
 * milky way, haloed moon, moonlit clouds, far mountains, two forest bands of mixed species (fir, oak, poplar,
 * shrub — each tree its own scale and jitter, rim-lit from the moon), drifting mist, the farmhouse with glowing
 * windows (and the cat on the sill), chimney smoke, barn + silo, a fence line, lantern, scarecrow and crop rows
 * in the foreground. Layers carry `data-depth` for pointer parallax and drift slowly on their own.
 */

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 1920;
const f1 = (n: number): string => n.toFixed(1);

type Ridge = (x: number) => number;

function ridge(base: number, a: number, b: number, seed: number): Ridge {
  const r = rng(seed);
  const p1 = r() * 6;
  const p2 = r() * 6;
  const p3 = r() * 6;
  return (x) => base + Math.sin(x * 0.0021 + p1) * a + Math.sin(x * 0.0057 + p2) * b + Math.sin(x * 0.013 + p3) * b * 0.35;
}

function ridgePath(y: Ridge, bottom = 1080, step = 24): string {
  let d = `M0 ${bottom} L0 ${f1(y(0))}`;
  for (let x = step; x <= W + step; x += step) d += ` L${x} ${f1(y(x))}`;
  return `${d} L${W + step} ${bottom} Z`;
}

/** Mountain range: sharper peaks than hills, with moonlit facets on the right slopes and snow on the tall ones. */
function mountains(base: number, seed: number): { d: string; lit: string; snow: string } {
  const r = rng(seed);
  let d = `M0 1080 L0 ${base}`;
  let lit = '';
  let snow = '';
  let x = 0;
  let prevY = base;
  while (x < W) {
    const w = 140 + r() * 220;
    const h = 50 + r() * 150;
    const px = x + w * (0.4 + r() * 0.2);
    const py = base - h;
    const ex = x + w;
    const ey = base - r() * 30;
    d += ` L${f1(px)} ${f1(py)} L${f1(ex)} ${f1(ey)}`;
    // Lit facet: from the peak down the right slope, folding back to a valley crease under the peak.
    const cx = px + (ex - px) * 0.18;
    lit += `M${f1(px)} ${f1(py)} L${f1(ex)} ${f1(ey)} L${f1(cx)} ${f1(base + 30)} Z `;
    if (h > 120) {
      const k = 0.26;
      const lx = px - (px - x) * k;
      const ly = py + (prevY - py) * k;
      const rx = px + (ex - px) * k;
      const ry = py + (ey - py) * k;
      snow += `M${f1(px)} ${f1(py)} L${f1(rx)} ${f1(ry)} L${f1(px + (rx - px) * 0.45)} ${f1(ry - 6)} L${f1(px)} ${f1(ry + 4)} L${f1(px - (px - lx) * 0.5)} ${f1(ly - 4)} L${f1(lx)} ${f1(ly)} Z `;
    }
    prevY = ey;
    x += w;
  }
  return { d: `${d} L${W} 1080 Z`, lit, snow };
}

/** One tree silhouette at (x, y) (base of trunk), height h. Species 0 fir · 1 oak · 2 poplar · 3 shrub. */
function tree(kind: number, x: number, y: number, h: number, r: () => number): string {
  const tr = (s: string): string => `<g transform="translate(${f1(x)} ${f1(y)})">${s}</g>`;
  if (kind === 0) {
    const w = h * (0.34 + r() * 0.08);
    const t = (k: number, ww: number): string => `M0 ${f1(-h * k)} L${f1(ww)} ${f1(-h * (k - 0.34))} L${f1(-ww)} ${f1(-h * (k - 0.34))} Z`;
    return tr(`<path d="${t(1, w * 0.55)} ${t(0.78, w * 0.8)} ${t(0.54, w)} M${f1(-h * 0.035)} 0 h${f1(h * 0.07)} v${f1(-h * 0.24)} h${f1(-h * 0.07)} Z"/>`);
  }
  if (kind === 1) {
    const c = (dx: number, dy: number, rr: number): string => `<circle cx="${f1(h * dx)}" cy="${f1(-h * dy)}" r="${f1(h * rr)}"/>`;
    const j = (): number => (r() - 0.5) * 0.08;
    return tr(`<path d="M${f1(-h * 0.05)} 0 L${f1(-h * 0.035)} ${f1(-h * 0.45)} L${f1(h * 0.035)} ${f1(-h * 0.45)} L${f1(h * 0.05)} 0 Z"/>${c(0, 0.6 + j(), 0.27)}${c(-0.22 + j(), 0.5, 0.22)}${c(0.23 + j(), 0.52, 0.23)}${c(0.05, 0.82 + j(), 0.2)}${c(-0.12, 0.74, 0.18)}`);
  }
  if (kind === 2) {
    return tr(`<ellipse cx="0" cy="${f1(-h * 0.56)}" rx="${f1(h * (0.12 + r() * 0.04))}" ry="${f1(h * 0.45)}"/><rect x="${f1(-h * 0.02)}" y="${f1(-h * 0.14)}" width="${f1(h * 0.04)}" height="${f1(h * 0.14)}"/>`);
  }
  const e = (dx: number, dy: number, rx: number, ry: number): string => `<ellipse cx="${f1(h * dx)}" cy="${f1(-h * dy)}" rx="${f1(h * rx)}" ry="${f1(h * ry)}"/>`;
  return tr(`${e(-0.22, 0.2, 0.26, 0.22)}${e(0.2, 0.22, 0.28, 0.24)}${e(0, 0.3, 0.3, 0.3)}`);
}

/** A band of mixed trees along a ridge; jittered spacing, varied scale, gaps kept for the farm. */
function forest(y: Ridge, seed: number, hMin: number, hMax: number, gapMin: number, gapMax: number, skip: [number, number][] = []): string {
  const r = rng(seed);
  const out: string[] = [];
  let x = -30 + r() * 30;
  while (x < W + 40) {
    const inSkip = skip.some(([a, b]) => x > a && x < b);
    if (!inSkip) {
      // Clusters: 1–4 trees close together, then a breath of open hillside.
      const n = 1 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const k = r();
        const kind = k < 0.42 ? 0 : k < 0.72 ? 1 : k < 0.86 ? 2 : 3;
        const scale = 0.7 + r() * 0.6;
        const h = (hMin + r() * (hMax - hMin)) * scale * (kind === 3 ? 0.45 : kind === 2 ? 1.15 : 1);
        const tx = x + i * (hMin * 0.28) + (r() - 0.5) * 10;
        out.push(tree(kind, tx, y(tx) + 4 + r() * 6, h, r));
      }
      x += n * hMin * 0.28;
    }
    x += gapMin + r() * (gapMax - gapMin);
  }
  return out.join('');
}

/** Rim-lit silhouette: the moon (upper right) catches the top-right edges. */
function rimLit(shapes: string, fill: string, rim: string, d = 2): string {
  return `<g fill="${rim}" transform="translate(${d} ${-d})">${shapes}</g><g fill="${fill}">${shapes}</g>`;
}

function farmhouse(): string {
  // Ground at y=0; ~200 px wide. Faces the viewer; warm windows are the brightest thing in the valley.
  return `
  <g class="de-house">
    <circle cx="-52" cy="-62" r="120" fill="url(#deGlow)" class="de-wglow"/>
    <circle cx="44" cy="-62" r="120" fill="url(#deGlow)" class="de-wglow b"/>
    <path d="M-112 -100 L0 -196 L112 -100 Z" fill="#b8b4ec" opacity=".55" transform="translate(3 -3)"/>
    <rect x="30" y="-190" width="26" height="60" rx="3" fill="#232849"/>
    <rect x="26" y="-196" width="34" height="10" rx="3" fill="#2b3056"/>
    <rect x="-92" y="-112" width="184" height="112" rx="4" fill="#1d2248"/>
    <g stroke="#2a3060" stroke-width="2">${Array.from({ length: 6 }, (_, i) => `<path d="M-92 ${-96 + i * 17} H92"/>`).join('')}</g>
    <path d="M-112 -100 L0 -196 L112 -100 Z" fill="#2c2141"/>
    <g stroke="#3a2c52" stroke-width="3">${Array.from({ length: 5 }, (_, i) => `<path d="M${-100 + i * 11} ${-110 - i * 9} L${100 - i * 11} ${-110 - i * 9}"/>`).join('')}</g>
    <circle cx="0" cy="-140" r="12" fill="#f3b35a" opacity=".85"/>
    <path d="M0 -152 V-128 M-12 -140 H12" stroke="#2c2141" stroke-width="3"/>
    <rect x="-70" y="-84" width="38" height="42" rx="3" fill="url(#deWin)"/>
    <rect x="26" y="-84" width="38" height="42" rx="3" fill="url(#deWin)"/>
    <g stroke="#3b2412" stroke-width="3.5"><path d="M-51 -84 V-42 M-70 -63 H-32 M45 -84 V-42 M26 -63 H64"/></g>
    <rect x="-74" y="-44" width="46" height="6" rx="2" fill="#2b3058"/>
    <rect x="22" y="-44" width="46" height="6" rx="2" fill="#2b3058"/>
    <path d="M40 -44 c0 -10 3 -16 8 -16 l2 -6 l3 5 h4 l3 -5 l2 6 c5 0 7 6 7 16 Z M62 -48 q10 2 6 -10" fill="#141633" stroke="#141633" stroke-width="2" class="de-cat"/>
    <rect x="-14" y="-64" width="28" height="64" rx="3" fill="#120f24"/>
    <rect x="-14" y="-64" width="28" height="64" rx="3" fill="none" stroke="#3a2c52" stroke-width="3"/>
    <path d="M-34 -66 L0 -84 L34 -66 Z" fill="#2c2141"/>
    <rect x="-34" y="-66" width="4" height="66" fill="#262b52"/><rect x="30" y="-66" width="4" height="66" fill="#262b52"/>
    <circle cx="-22" cy="-56" r="4.5" fill="#ffd27a"/><circle cx="-22" cy="-56" r="30" fill="url(#deGlow)" opacity=".8"/>
    <path d="M-92 -100 H92" stroke="#c9c3ff" stroke-opacity=".25" stroke-width="2"/>
    <g class="de-smoke" filter="url(#deSoft2)">${Array.from({ length: 5 }, (_, i) => `<circle cx="43" cy="-200" r="${10 + i * 3}" style="animation-delay:${-i * 1.3}s"/>`).join('')}</g>
  </g>`;
}

function barn(): string {
  return `
  <g>
    <path d="M-100 -110 L-80 -160 L0 -196 L80 -160 L100 -110 Z" fill="#b8b4ec" opacity=".45" transform="translate(3 -3)"/>
    <rect x="-96" y="-112" width="192" height="112" rx="3" fill="#1b2046"/>
    <path d="M-104 -106 L-82 -160 L0 -196 L82 -160 L104 -106 Z" fill="#241c3c"/>
    <rect x="-40" y="-86" width="80" height="86" rx="2" fill="#141836"/>
    <path d="M-40 -86 L40 0 M40 -86 L-40 0" stroke="#252a55" stroke-width="5"/>
    <rect x="-16" y="-150" width="32" height="26" rx="2" fill="#6a5a8a" opacity=".6"/>
    <rect x="118" y="-170" width="54" height="170" rx="6" fill="#1a1f44"/>
    <path d="M118 -170 Q145 -214 172 -170 Z" fill="#26204a"/>
    <path d="M172 -170 V0" stroke="#c9c3ff" stroke-opacity=".22" stroke-width="3"/>
  </g>`;
}

function fence(x0: number, x1: number, y: Ridge, dy: number): string {
  let posts = '';
  let rail1 = '';
  let rail2 = '';
  for (let x = x0; x <= x1; x += 36) {
    const b = y(x) + dy;
    posts += `<rect x="${x - 3}" y="${f1(b - 34)}" width="6" height="36" rx="2"/>`;
    rail1 += `${x === x0 ? 'M' : 'L'}${x} ${f1(b - 26)} `;
    rail2 += `${x === x0 ? 'M' : 'L'}${x} ${f1(b - 13)} `;
  }
  return `<g fill="#0c1026">${posts}</g><path d="${rail1}" stroke="#0c1026" stroke-width="4" fill="none"/><path d="${rail2}" stroke="#0c1026" stroke-width="4" fill="none"/>`;
}

function crops(r: () => number): string {
  let s = '';
  for (let row = 0; row < 5; row++) {
    const y = 952 + row * 30;
    const x0 = 360 - row * 30;
    const x1 = 1560 + row * 30;
    s += `<path d="M${x0} ${y} Q960 ${y - 14} ${x1} ${y}" stroke="#141a38" stroke-width="${11 + row * 2}" stroke-linecap="round" fill="none"/>`;
    for (let x = x0 + 20; x < x1 - 10; x += 26 + row * 4) {
      const yy = y - 4 - Math.sin(((x - x0) / (x1 - x0)) * Math.PI) * 7;
      const h = 8 + row * 2.2 + r() * 5;
      s += `<path d="M${f1(x)} ${f1(yy)} q-${f1(h * 0.5)} -${f1(h * 0.4)} -${f1(h * 0.7)} -${f1(h)} M${f1(x)} ${f1(yy)} q${f1(h * 0.4)} -${f1(h * 0.5)} ${f1(h * 0.6)} -${f1(h * 1.05)}" stroke="#0b0f24" stroke-width="${2.2 + row * 0.5}" stroke-linecap="round" fill="none"/>`;
    }
  }
  return s;
}

function scarecrow(): string {
  return `<g fill="#0a0d20" stroke="#0a0d20" stroke-linecap="round">
    <path d="M0 0 V-84" stroke-width="6"/><path d="M-36 -62 L36 -58" stroke-width="5"/>
    <path d="M-16 -66 L16 -66 L20 -30 L-20 -30 Z"/><circle cx="0" cy="-80" r="12"/>
    <path d="M-20 -86 L20 -86 L10 -100 L-8 -100 Z" stroke-width="2"/><path d="M-26 -86 H26" stroke-width="4"/>
    <path d="M-36 -62 l-6 8 M36 -58 l6 8" stroke-width="3"/>
  </g>`;
}

function grassFront(r: () => number): string {
  let s = '';
  const tuft = (x: number, y: number, h: number): string => {
    let p = '';
    for (let i = 0; i < 7; i++) {
      const a = (i - 3) * 0.16 + (r() - 0.5) * 0.15;
      const hh = h * (0.6 + r() * 0.5);
      p += `M${f1(x + (i - 3) * 3)} ${y} q${f1(Math.sin(a) * hh * 0.4)} ${f1(-hh * 0.5)} ${f1(Math.sin(a) * hh)} ${f1(-hh)} `;
    }
    return p;
  };
  let d = '';
  for (let x = -10; x < W + 20; x += 18 + r() * 40) {
    const edge = x < 420 || x > 1500;
    d += tuft(x, 1086, edge ? 40 + r() * 50 : 16 + r() * 18);
  }
  s += `<path d="${d}" stroke="#05081a" stroke-width="3" stroke-linecap="round" fill="none"/>`;
  // A few flower heads catching moonlight at the corners.
  for (let i = 0; i < 9; i++) {
    const x = i < 5 ? 30 + r() * 340 : 1560 + r() * 340;
    const y = 1000 + r() * 50;
    s += `<path d="M${f1(x)} 1086 Q${f1(x + 6)} ${f1((y + 1086) / 2)} ${f1(x)} ${f1(y)}" stroke="#05081a" stroke-width="2.5" fill="none"/><circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(4 + r() * 3)}" fill="#8f86c8" opacity=".55"/>`;
  }
  return s;
}

export function nightValleySvg(seed = 7): string {
  const r = rng(seed);
  const farY = ridge(770, 16, 10, seed + 1);
  const midY = ridge(835, 14, 8, seed + 2);
  const nearY: Ridge = (x) => 900 + Math.sin(x * 0.0026 + 1.2) * 14 + Math.sin(x * 0.009) * 4;
  // Milky way: soft band + dense dust of tiny stars along it.
  let dust = '';
  for (let i = 0; i < 360; i++) {
    const t = r();
    const x = t * 2200 - 140;
    const off = (r() + r() + r() - 1.5) * 90;
    const y = 120 + t * 330 + off;
    dust += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(0.5 + r() * 1.1)}" opacity="${(0.25 + r() * 0.6).toFixed(2)}"/>`;
  }
  const mtn = mountains(700, seed + 5);
  const houseX = 1705;
  const houseY = nearY(houseX) + 6;
  const barnX = 205;
  const barnY = nearY(barnX) + 8;
  return `<svg class="de-art" viewBox="0 0 ${W} 1080" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="deMoonHalo"><stop offset="0" stop-color="#fff2cf" stop-opacity=".42"/><stop offset=".25" stop-color="#e8dcff" stop-opacity=".14"/><stop offset="1" stop-color="#b8a8ff" stop-opacity="0"/></radialGradient>
    <radialGradient id="deMoon" cx=".38" cy=".35"><stop offset="0" stop-color="#fffdf2"/><stop offset=".7" stop-color="#f8ecc6"/><stop offset="1" stop-color="#e8d49c"/></radialGradient>
    <radialGradient id="deGlow"><stop offset="0" stop-color="#ffcf70" stop-opacity=".6"/><stop offset=".35" stop-color="#ff9a40" stop-opacity=".18"/><stop offset="1" stop-color="#ff8a30" stop-opacity="0"/></radialGradient>
    <linearGradient id="deWin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset=".6" stop-color="#ffc45a"/><stop offset="1" stop-color="#f09a3a"/></linearGradient>
    <linearGradient id="deMtn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a78"/><stop offset=".45" stop-color="#2e3068"/><stop offset=".8" stop-color="#3a3470"/></linearGradient>
    <linearGradient id="deMist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8a4e0" stop-opacity="0"/><stop offset=".5" stop-color="#c8b0e8" stop-opacity=".3"/><stop offset="1" stop-color="#b8a4e0" stop-opacity="0"/></linearGradient>
    <linearGradient id="dePath" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c3160"/><stop offset="1" stop-color="#1c2146"/></linearGradient>
    <filter id="deSoft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="deSoft2" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>
  <g class="de-l" data-depth="2">
    <g transform="rotate(-14 960 300)"><ellipse cx="960" cy="300" rx="1150" ry="110" fill="#c9b8ff" opacity=".1" filter="url(#deSoft)"/><ellipse cx="900" cy="300" rx="700" ry="46" fill="#ffd8f0" opacity=".08" filter="url(#deSoft)"/></g>
    <g fill="#fff">${dust}</g>
  </g>
  <g class="de-l" data-depth="3">
    <circle cx="1560" cy="176" r="260" fill="url(#deMoonHalo)"/>
    <circle cx="1560" cy="176" r="60" fill="url(#deMoon)"/>
    <g fill="#e2cc92" opacity=".32"><circle cx="1540" cy="160" r="11"/><circle cx="1578" cy="196" r="8"/><circle cx="1582" cy="152" r="5"/><circle cx="1546" cy="200" r="5.5"/></g>
  </g>
  <g class="de-l de-clouds" data-depth="4">
    <g filter="url(#deSoft2)">
      <g class="de-cloud a"><ellipse cx="300" cy="220" rx="190" ry="26" fill="#3c3b78" opacity=".75"/><ellipse cx="360" cy="206" rx="110" ry="24" fill="#4a4888" opacity=".7"/><ellipse cx="380" cy="198" rx="70" ry="12" fill="#9a90d0" opacity=".35"/></g>
      <g class="de-cloud b"><ellipse cx="1260" cy="330" rx="230" ry="22" fill="#3c3b78" opacity=".6"/><ellipse cx="1330" cy="318" rx="120" ry="20" fill="#4c4a8c" opacity=".6"/><ellipse cx="1360" cy="310" rx="80" ry="10" fill="#b8aee0" opacity=".32"/></g>
    </g>
  </g>
  <g class="de-l" data-depth="6">
    <path d="${mtn.d}" fill="url(#deMtn)"/>
    <path d="${mtn.lit}" fill="#6a68b0" opacity=".38"/>
    <path d="${mtn.snow}" fill="#e4e0ff" opacity=".5"/>
    <path d="${mtn.d}" fill="none" stroke="#d8d0ff" stroke-opacity=".2" stroke-width="2"/>
    <rect x="0" y="650" width="${W}" height="140" fill="url(#deMist)"/>
  </g>
  <g class="de-l" data-depth="10">
    <path d="${ridgePath(farY)}" fill="#252a5c"/>
    ${rimLit(forest(farY, seed + 11, 58, 92, 20, 70), '#252a5c', '#5a5aa0', 1.5)}
    <rect x="0" y="770" width="${W}" height="110" fill="url(#deMist)" class="de-mist"/>
  </g>
  <g class="de-l" data-depth="16">
    <path d="${ridgePath(midY)}" fill="#181d44"/>
    ${rimLit(forest(midY, seed + 21, 88, 140, 30, 110, [[1560, 1860], [70, 360]]), '#181d44', '#4a4a92', 2)}
  </g>
  <g class="de-l" data-depth="24">
    <path d="${ridgePath(nearY)}" fill="#11163a"/>
    <path d="M${houseX - 10} ${f1(houseY)} C${houseX - 40} 960 ${houseX - 150} 1010 ${houseX - 190} 1090 L${houseX - 90} 1090 C${houseX - 60} 1010 ${houseX + 4} 960 ${houseX + 14} ${f1(houseY)} Z" fill="url(#dePath)" opacity=".8"/>
    <g transform="translate(${barnX} ${f1(barnY)})">${barn()}</g>
    <g transform="translate(${houseX} ${f1(houseY)})">${farmhouse()}</g>
    ${fence(0, 560, nearY, 26)}${fence(1380, 1580, nearY, 24)}
    <g transform="translate(${houseX - 150} ${f1(nearY(houseX - 150) + 60)})">
      <circle cx="0" cy="-84" r="60" fill="url(#deGlow)" class="de-wglow"/>
      <path d="M0 0 V-76 M0 -76 h10" stroke="#0c1026" stroke-width="5" fill="none"/>
      <rect x="4" y="-78" width="14" height="18" rx="3" fill="#ffd88a"/><path d="M4 -78 h14 l-3 -5 h-8 Z" fill="#0c1026"/>
    </g>
    <g transform="translate(${houseX + 132} ${f1(houseY + 4)})"><rect x="-26" y="-30" width="52" height="30" rx="3" fill="#161a3c"/><path d="M-30 -30 h60 l-4 -10 h-52 Z" fill="#221b3e"/></g>
  </g>
  <g class="de-l" data-depth="34">
    <path d="M0 1080 L0 930 C300 910 640 926 960 930 C1280 934 1620 912 ${W} 924 L${W} 1080 Z" fill="#0b0f28"/>
    ${crops(r)}
    <g transform="translate(470 1000)">${scarecrow()}</g>
    ${grassFront(r)}
  </g>
</svg>`;
}

/** Quiet-day vignette: moonlit window, sleeping cat and a sprout on the sill (warm, on parchment). */
export function quietVignetteSvg(): string {
  return `<svg viewBox="0 0 260 220" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="qvSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a2150"/><stop offset=".7" stop-color="#3a3470"/><stop offset="1" stop-color="#6a4a78"/></linearGradient>
    <radialGradient id="qvHalo"><stop offset="0" stop-color="#fff4d0" stop-opacity=".6"/><stop offset="1" stop-color="#fff4d0" stop-opacity="0"/></radialGradient>
    <linearGradient id="qvWood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8783e"/><stop offset="1" stop-color="#7a4620"/></linearGradient>
  </defs>
  <path d="M40 200 V80 a90 70 0 0 1 180 0 V200 Z" fill="url(#qvWood)" stroke="#4a2810" stroke-width="4"/>
  <path d="M56 190 V84 a74 58 0 0 1 148 0 V190 Z" fill="url(#qvSky)"/>
  <circle cx="160" cy="70" r="46" fill="url(#qvHalo)"/>
  <circle cx="160" cy="70" r="17" fill="#fff6d8"/><circle cx="167" cy="64" r="15" fill="#2c2c64" opacity=".92"/>
  <g fill="#fff">${[
    [80, 70, 1.6],
    [100, 50, 1.2],
    [120, 88, 1],
    [186, 104, 1.3],
    [90, 110, 1],
    [140, 40, 1.4],
  ]
    .map(([x, y, rr]) => `<circle cx="${x}" cy="${y}" r="${rr}" class="qv-tw"/>`)
    .join('')}</g>
  <path d="M56 160 C100 140 150 150 204 138 V190 H56 Z" fill="#232a5a"/>
  <path d="M56 172 C110 160 160 168 204 158 V190 H56 Z" fill="#1a1f48"/>
  <path d="M130 84 V190 M56 130 H204" stroke="#6a3c18" stroke-width="6"/>
  <rect x="28" y="190" width="204" height="16" rx="5" fill="#c98c4c" stroke="#4a2810" stroke-width="3"/>
  <g transform="translate(86 190)">
    <path d="M-30 0 C-34 -24 -10 -34 12 -30 C30 -27 36 -12 32 0 Z" fill="#e8a060" stroke="#6a3c18" stroke-width="3"/>
    <path d="M18 -26 l4 -12 l7 9 Z M28 -24 l8 -9 l2 12 Z" fill="#e8a060" stroke="#6a3c18" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M20 -14 q4 3 8 0 M-30 0 c-12 -2 -12 -14 -2 -14" stroke="#6a3c18" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M-12 -24 q6 -4 12 0 M-18 -14 q8 -3 14 1" stroke="#c07838" stroke-width="3" fill="none" stroke-linecap="round"/>
  </g>
  <g transform="translate(184 190)">
    <path d="M-16 0 L-19 -24 H19 L16 0 Z" fill="#c8643a" stroke="#6a2e14" stroke-width="3" stroke-linejoin="round"/>
    <rect x="-22" y="-30" width="44" height="8" rx="3" fill="#d87a48" stroke="#6a2e14" stroke-width="3"/>
    <path d="M0 -30 C0 -44 -2 -52 0 -60" stroke="#4a8a2a" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path d="M0 -50 C-14 -58 -20 -50 -18 -44 C-10 -42 -4 -46 0 -50 Z M0 -58 C12 -70 22 -62 20 -56 C12 -52 4 -54 0 -58 Z" fill="#7cc04a" stroke="#3a6a1a" stroke-width="2.5"/>
  </g>
  <g class="qv-z" fill="#8a8ac0" font-family="Fredoka, sans-serif" font-weight="700"><text x="112" y="150" font-size="14">z</text><text x="124" y="136" font-size="18">z</text></g>
</svg>`;
}
