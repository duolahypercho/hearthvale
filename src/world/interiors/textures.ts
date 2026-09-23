/**
 * Procedural interior textures (canvas, seeded, cached): honey-oak floor planks, sprig wallpaper,
 * beadboard wainscot, woven + braided rugs, a patchwork quilt, straw bedding, weathered barn boards,
 * the painted window view, light-shaft gradient, heart sprite, and the "photo atlas" (grandmother's
 * framed photographs + the cross-stitch sampler) so every picture on the walls is one material.
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { PeriodicNoise, makeTileNoise, tileFbm, smoothstep, clamp } from '../../core/noise';
import { type TexPair, type RGB, hex, mix3, scale3, makeCanvas, toTexture, pixels, cached } from '../../render/tex/core';

/** Long honey-oak floorboards running along X. 1 repeat = 1 m × 1 m, 5 boards. */
export function floorPlanks(): TexPair {
  return cached('i:floor', () => {
    const S = 512;
    const rows = 5;
    const grain = new PeriodicNoise(6, 'fl-grain');
    const n = makeTileNoise(4, 4, 'fl');
    const rng = new Rng('floor');
    const tone: number[][] = [];
    const joint: number[] = [];
    for (let r = 0; r < rows; r++) {
      tone.push([0.84 + rng.next() * 0.26, 0.84 + rng.next() * 0.26]);
      joint.push(rng.next());
    }
    const light = hex(0xd9a067);
    const dark = hex(0x9a5f34);
    const { color, height } = pixels(S, (u, v) => {
      const pv = v * rows;
      const ri = Math.floor(pv);
      const rf = pv - ri;
      const j = joint[ri]!;
      const seg = (u - j + 1) % 1 < 0.5 ? 0 : 1;
      const local = ((u - j + 1) % 1) * 2 - seg;
      const g1 = grain.get(u * 1.5 + ri * 3.1, rf * 0.9 + seg * 2.3);
      const rings = Math.sin((rf * 2.2 + g1 * 1.6 + u * 0.4) * 14) * 0.5 + 0.5;
      const f = tileFbm(n, u, v, 4);
      let c = mix3(dark, light, 0.4 + rings * 0.35 + f * 0.25);
      c = scale3(c, tone[ri]![seg]!);
      const edgeV = Math.min(rf, 1 - rf);
      const gapV = smoothstep(0, 0.045, edgeV);
      const edgeU = Math.min(local, 1 - local) * 0.5;
      const gapU = smoothstep(0, 0.006, edgeU);
      const bevel = smoothstep(0.02, 0.14, edgeV);
      c = scale3(c, (0.42 + 0.58 * gapV * gapU) * (0.86 + 0.14 * bevel));
      // Nail heads near each board end.
      for (const nu of [0.03, 0.47]) {
        const du = ((u - j + 1) % 1) - nu - seg * 0.5;
        const dv = rf - 0.5;
        if (Math.abs(dv) < 0.25 && Math.hypot(du * 4, (Math.abs(dv) - 0.28) * 1) < 0.018) c = scale3(c, 0.55);
      }
      return { c, h: gapV * gapU * (0.75 + 0.25 * bevel) + rings * 0.06 };
    });
    return { map: toTexture(color, true), bump: toTexture(height, false) };
  });
}

/** Cream wallpaper with sage stripes and tiny flower sprigs. 1 repeat ≈ 0.8 m. */
export function wallpaper(): TexPair {
  return cached('i:wallpaper', () => {
    const S = 256;
    const [c, ctx] = makeCanvas(S);
    ctx.fillStyle = '#efe2c4';
    ctx.fillRect(0, 0, S, S);
    const rng = new Rng('wp');
    // Soft paper mottling
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(${150 + rng.next() * 60},${120 + rng.next() * 50},80,${0.03 + rng.next() * 0.03})`;
      ctx.beginPath();
      ctx.arc(rng.next() * S, rng.next() * S, 4 + rng.next() * 14, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 4; i++) {
      const x = (i + 0.5) * (S / 4);
      ctx.fillStyle = 'rgba(122,150,112,0.30)';
      ctx.fillRect(x - 7, 0, 14, S);
      ctx.fillStyle = 'rgba(122,150,112,0.45)';
      ctx.fillRect(x - 9, 0, 2, S);
      ctx.fillRect(x + 7, 0, 2, S);
    }
    // Sprigs between stripes
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const x = i * (S / 4) + (j % 2 ? 6 : -6);
        const y = j * (S / 4) + S / 8;
        ctx.strokeStyle = 'rgba(104,132,86,0.8)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x, y + 9);
        ctx.quadraticCurveTo(x + 3, y, x, y - 8);
        ctx.stroke();
        ctx.fillStyle = 'rgba(104,140,86,0.85)';
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(x + s * 4, y + 1, 3.2, 1.6, s * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = j % 2 ? 'rgba(214,120,110,0.9)' : 'rgba(226,170,80,0.9)';
        ctx.beginPath();
        ctx.arc(x, y - 9, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return { map: toTexture(c, true) };
  });
}

/** Painted beadboard: vertical boards with V-grooves. 1 repeat = 1 m (8 boards). */
export function beadboard(): TexPair {
  return cached('i:bead', () => {
    const S = 256;
    const n = makeTileNoise(4, 3, 'bead');
    const { color, height } = pixels(S, (u, v) => {
      const bu = (u * 8) % 1;
      const groove = smoothstep(0, 0.07, Math.min(bu, 1 - bu));
      const bead = 1 - Math.exp(-Math.pow((bu - 0.5) * 9, 2)) * 0.12;
      const f = tileFbm(n, u, v, 3);
      const k = (0.62 + 0.38 * groove) * bead * (0.94 + f * 0.1);
      return { c: [255 * k, 255 * k, 255 * k] as RGB, h: groove * 0.8 + (1 - bead) };
    });
    return { map: toTexture(color, true), bump: toTexture(height, false) };
  });
}

/** Weathered vertical barn boards (grey-brown, knots, gaps). 1 repeat = 1.2 m (5 boards). */
export function barnBoards(): TexPair {
  return cached('i:barnBoards', () => {
    const S = 512;
    const boards = 5;
    const grain = new PeriodicNoise(8, 'bb');
    const n = makeTileNoise(4, 4, 'bbn');
    const rng = new Rng('bb');
    const tone: number[] = [];
    const off: number[] = [];
    for (let i = 0; i < boards; i++) {
      tone.push(0.8 + rng.next() * 0.35);
      off.push(rng.next() * 10);
    }
    const a = hex(0x8c6a4a);
    const b = hex(0xb08a60);
    const { color, height } = pixels(S, (u, v) => {
      const bu = u * boards;
      const i = Math.floor(bu);
      const f = bu - i;
      const g = Math.sin((f * 2 + grain.get(f + off[i]!, v * 6) * 4 + off[i]!) * 9) * 0.5 + 0.5;
      const fb = tileFbm(n, u, v, 4);
      let c = mix3(a, b, g * 0.6 + fb * 0.4);
      c = scale3(c, tone[i]!);
      const gap = smoothstep(0, 0.05, Math.min(f, 1 - f));
      c = scale3(c, 0.35 + 0.65 * gap);
      return { c, h: gap * 0.8 + g * 0.15 };
    });
    return { map: toTexture(color, true), bump: toTexture(height, false) };
  });
}

/** Straw bedding over packed earth (coop / barn floor). 1 repeat = 2 m. */
export function strawFloor(): TexPair {
  return cached('i:straw', () => {
    const S = 512;
    const [c, ctx] = makeCanvas(S);
    const [h, hctx] = makeCanvas(S);
    const rng = new Rng('strawfloor');
    const ground = ctx.createLinearGradient(0, 0, S, S);
    ground.addColorStop(0, '#8a6a42');
    ground.addColorStop(1, '#7a5c38');
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, S, S);
    hctx.fillStyle = '#303030';
    hctx.fillRect(0, 0, S, S);
    ctx.lineCap = hctx.lineCap = 'round';
    for (let i = 0; i < 16000; i++) {
      const x = rng.next() * S;
      const y = rng.next() * S;
      const len = 6 + rng.next() * 22;
      const ang = rng.next() * Math.PI;
      const t = rng.next();
      const r = 175 + t * 70;
      ctx.strokeStyle = `rgba(${r},${r * 0.82},${r * 0.45},${0.55 + t * 0.4})`;
      ctx.lineWidth = 0.8 + rng.next() * 1.4;
      hctx.strokeStyle = `rgba(${120 + t * 130},${120 + t * 130},${120 + t * 130},1)`;
      hctx.lineWidth = ctx.lineWidth;
      for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]] as const) {
        const px = x + ox;
        const py = y + oy;
        if (px < -len || px > S + len || py < -len || py > S + len) continue;
        for (const [g, gg] of [[ctx, 0], [hctx, 1]] as const) {
          void gg;
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
          g.stroke();
        }
      }
    }
    return { map: toTexture(c, true), bump: toTexture(h, false) };
  });
}

/** Woven rug: border bands, a lozenge field and tassels at the short ends. Not repeating. */
export function wovenRug(): TexPair {
  return cached('i:rug', () => {
    const W = 512;
    const [c, ctx] = makeCanvas(W);
    const H = W;
    ctx.fillStyle = '#a8413a';
    ctx.fillRect(0, 0, W, H);
    const band = (inset: number, width: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
    };
    band(22, 20, '#2f4a6a');
    band(40, 8, '#e8c77a');
    band(54, 10, '#6f8f5a');
    band(66, 4, '#f2e2c0');
    // Diamond field
    ctx.save();
    ctx.beginPath();
    ctx.rect(72, 72, W - 144, H - 144);
    ctx.clip();
    for (let y = 72; y < H; y += 56) {
      for (let x = 72; x < W; x += 56) {
        const cx = x + 28;
        const cy = y + 28;
        ctx.fillStyle = ((x + y) / 56) % 2 ? '#c7584a' : '#8e3530';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 26);
        ctx.lineTo(cx + 26, cy);
        ctx.lineTo(cx, cy + 26);
        ctx.lineTo(cx - 26, cy);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#e8c77a';
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    // Central medallion
    ctx.fillStyle = '#2f4a6a';
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2, 92, 70, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8c77a';
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2, 70, 50, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6f8f5a';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(W / 2 + Math.cos(a) * 36, H / 2 + Math.sin(a) * 26, 12, 6, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#a8413a';
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 16, 0, Math.PI * 2);
    ctx.fill();
    // Weave texture: fine horizontal + vertical threads and wear.
    const rng = new Rng('rugweave');
    for (let y = 0; y < H; y += 3) {
      ctx.fillStyle = `rgba(0,0,0,${0.05 + rng.next() * 0.05})`;
      ctx.fillRect(0, y, W, 1);
    }
    for (let x = 0; x < W; x += 4) {
      ctx.fillStyle = `rgba(255,240,220,${0.03 + rng.next() * 0.03})`;
      ctx.fillRect(x, 0, 1, H);
    }
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(255,235,200,0.05)`;
      ctx.beginPath();
      ctx.arc(W / 2 + (rng.next() - 0.5) * 200, H / 2 + (rng.next() - 0.5) * 200, 20 + rng.next() * 40, 0, Math.PI * 2);
      ctx.fill();
    }
    return { map: toTexture(c, true, false) };
  });
}

/** Braided oval rug: concentric multi-coloured braid rings (UV centre = rug centre). */
export function braidedRug(): TexPair {
  return cached('i:braid', () => {
    const S = 512;
    const cols = [hex(0x9c4a3a), hex(0xd8b070), hex(0x5f7a8e), hex(0x8a9a5a), hex(0xc27a4a), hex(0x6a4a3a), hex(0xe2d0a8)];
    const rng = new Rng('braid');
    const order: number[] = [];
    for (let i = 0; i < 40; i++) order.push(Math.floor(rng.next() * cols.length));
    const { color, height } = pixels(S, (u, v) => {
      const x = (u - 0.5) * 2;
      const y = (v - 0.5) * 2;
      const r = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      if (r > 1) return { c: [0, 0, 0] as RGB, h: 0 };
      const ring = r * 13;
      const ri = Math.floor(ring);
      const rf = ring - ri;
      // Braid: diagonal strands alternating across the ring.
      const s = Math.sin((a * (30 + ri * 6) + rf * 5) * 1) * 0.5 + 0.5;
      const k = order[ri % order.length]!;
      const k2 = order[(ri + 7) % order.length]!;
      let c = mix3(cols[k]!, cols[k2]!, s > 0.5 ? 0.25 : 0);
      const round = Math.sin(rf * Math.PI);
      c = scale3(c, 0.6 + 0.4 * round * (0.85 + 0.15 * s));
      return { c, h: round * (0.7 + 0.3 * s) };
    });
    return { map: toTexture(color, true, false), bump: toTexture(height, false, false) };
  });
}

/** Patchwork quilt: 8×8 fabric squares (gingham, dots, florals, solids) with running stitches. */
export function quilt(): TexPair {
  return cached('i:quilt', () => {
    const S = 512;
    const [c, ctx] = makeCanvas(S);
    const N = 8;
    const q = S / N;
    const rng = new Rng('quilt');
    const palette = ['#e8a0a0', '#f2d9a0', '#9cc0d8', '#b8d0a0', '#f2ece0', '#d88a6a', '#a8b8e0', '#e6c2d6', '#c8a0c8', '#f0c890'];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = i * q;
        const y = j * q;
        const base = palette[Math.floor(rng.next() * palette.length)]!;
        ctx.fillStyle = base;
        ctx.fillRect(x, y, q, q);
        const kind = Math.floor(rng.next() * 5);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, q, q);
        ctx.clip();
        if (kind === 0) {
          // gingham
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          for (let k = 0; k < q; k += 10) {
            ctx.fillRect(x + k, y, 5, q);
            ctx.fillRect(x, y + k, q, 5);
          }
        } else if (kind === 1) {
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          for (let yy = 5; yy < q; yy += 12) for (let xx = (yy / 12) % 2 ? 11 : 5; xx < q; xx += 12) {
            ctx.beginPath();
            ctx.arc(x + xx, y + yy, 2.3, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (kind === 2) {
          // little florals
          for (let k = 0; k < 7; k++) {
            const fx = x + rng.next() * q;
            const fy = y + rng.next() * q;
            ctx.fillStyle = rng.next() < 0.5 ? 'rgba(200,70,80,0.8)' : 'rgba(250,240,220,0.9)';
            for (let p = 0; p < 5; p++) {
              const a = (p / 5) * Math.PI * 2;
              ctx.beginPath();
              ctx.arc(fx + Math.cos(a) * 3, fy + Math.sin(a) * 3, 2.2, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.fillStyle = '#e8c050';
            ctx.beginPath();
            ctx.arc(fx, fy, 1.6, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (kind === 3) {
          // half-square triangle
          ctx.fillStyle = palette[Math.floor(rng.next() * palette.length)]!;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + q, y + q);
          ctx.lineTo(x, y + q);
          ctx.fill();
        }
        // fabric weave
        ctx.fillStyle = 'rgba(0,0,0,0.04)';
        for (let k = 0; k < q; k += 2) ctx.fillRect(x, y + k, q, 1);
        ctx.restore();
        // seam shadow + running stitch
        ctx.strokeStyle = 'rgba(60,30,20,0.35)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, q - 2, q - 2);
        ctx.strokeStyle = 'rgba(255,250,240,0.75)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x + 6, y + 6, q - 12, q - 12);
        ctx.setLineDash([]);
      }
    }
    return { map: toTexture(c, true) };
  });
}

/** The painted view through a window (sky, far hills, hedge, a fence). Emissive by day. */
export function windowView(): TexPair {
  return cached('i:view', () => {
    const W = 256;
    const [c, ctx] = makeCanvas(W);
    const sky = ctx.createLinearGradient(0, 0, 0, W);
    sky.addColorStop(0, '#8fc2ee');
    sky.addColorStop(0.55, '#d8ecf4');
    sky.addColorStop(1, '#f6ead0');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, W);
    const rng = new Rng('view');
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 5; i++) {
      const x = rng.next() * W;
      const y = 20 + rng.next() * 60;
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.ellipse(x + k * 14, y + (k % 2) * 4, 18, 9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#9cc08a';
    ctx.beginPath();
    ctx.moveTo(0, W * 0.62);
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, W * 0.6 - Math.sin(x * 0.03) * 16 - Math.sin(x * 0.011) * 10);
    ctx.lineTo(W, W);
    ctx.lineTo(0, W);
    ctx.fill();
    ctx.fillStyle = '#5f9a4a';
    for (let x = -10; x < W + 20; x += 18) {
      ctx.beginPath();
      ctx.arc(x, W * 0.76 + Math.sin(x) * 4, 20, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#4a8a3c';
    ctx.fillRect(0, W * 0.8, W, W * 0.2);
    ctx.fillStyle = '#f0f0e8';
    for (let x = 6; x < W; x += 30) ctx.fillRect(x, W * 0.72, 6, W * 0.2);
    ctx.fillRect(0, W * 0.77, W, 5);
    return { map: toTexture(c, true, false) };
  });
}

/** Light shaft: soft-edged vertical fade (bright at the window end, v = 1). */
export function shaftGradient(): TexPair {
  return cached('i:shaft', () => {
    const S = 128;
    const { color } = pixels(S, (u, v) => {
      const edge = smoothstep(0, 0.28, Math.min(u, 1 - u));
      const fall = Math.pow(1 - v, 0.9) * smoothstep(0, 0.12, v);
      const k = clamp(edge * fall) * 255;
      return { c: [k, k, k] as RGB };
    });
    return { map: toTexture(color, false, false) };
  });
}

/** Soft radial glow (hearth light pool, lamp halos). */
export function glowDisc(): TexPair {
  return cached('i:glow', () => {
    const S = 128;
    const [c, ctx] = makeCanvas(S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return { map: toTexture(c, false, false) };
  });
}

/** Chunky heart sprite with an outline + highlight (petting pop). */
export function heartSprite(): TexPair {
  return cached('i:heart', () => {
    const S = 128;
    const [c, ctx] = makeCanvas(S);
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(64, 108);
      ctx.bezierCurveTo(20, 80, 8, 50, 22, 30);
      ctx.bezierCurveTo(36, 12, 58, 18, 64, 38);
      ctx.bezierCurveTo(70, 18, 92, 12, 106, 30);
      ctx.bezierCurveTo(120, 50, 108, 80, 64, 108);
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    path();
    ctx.fillStyle = '#7a1830';
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#7a1830';
    ctx.stroke();
    const g = ctx.createLinearGradient(0, 16, 0, 108);
    g.addColorStop(0, '#ff7a96');
    g.addColorStop(1, '#e02a52');
    ctx.fillStyle = g;
    path();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(40, 40, 11, 7, -0.6, 0, Math.PI * 2);
    ctx.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { map: t };
  });
}

// ─────────────────────────────────────────────── photo atlas

/** Atlas cells (u0, v0, u1, v1) for framed pictures. */
export const PHOTO_CELLS = {
  grandma: [0, 0.5, 0.25, 1],
  couple: [0.25, 0.5, 0.5, 1],
  valley: [0.5, 0.5, 0.75, 1],
  girl: [0.75, 0.5, 1, 1],
  sampler: [0, 0, 0.5, 0.5],
  recipe: [0.5, 0, 0.75, 0.5],
  calendar: [0.75, 0, 1, 0.5],
} as const;
export type PhotoName = keyof typeof PHOTO_CELLS;

export function photoAtlas(): TexPair {
  return cached('i:photos', () => {
    const S = 1024;
    const [c, ctx] = makeCanvas(S);
    const cell = S / 4;
    const rng = new Rng('photos');
    const sepia = (x: number, y: number, w: number, h: number, draw: () => void, tint = 'rgba(160,110,60,0.28)') => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.translate(x, y);
      draw();
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, w, h);
      const v = ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(60,30,10,0.55)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 300; i++) {
        ctx.fillStyle = `rgba(255,240,210,${rng.next() * 0.08})`;
        ctx.fillRect(rng.next() * w, rng.next() * h, 1.5, 1.5);
      }
      ctx.restore();
    };
    // Top row = v 0.5..1 → canvas y 0..512 (flipY: canvas top = v 1).
    // 1. Grandmother Rosalind: silver bun, round spectacles, shawl, kind smile, porch behind.
    sepia(0, 0, cell, cell * 2, () => {
      const w = cell;
      const h = cell * 2;
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#d8c8a8');
      bg.addColorStop(1, '#a89070');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#9a8060';
      ctx.fillRect(0, h * 0.2, w * 0.18, h);
      ctx.fillRect(w * 0.82, h * 0.2, w * 0.18, h);
      // shoulders + shawl
      ctx.fillStyle = '#6a5a8a';
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.92, w * 0.46, h * 0.32, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#8a6aa0';
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.moveTo(w * 0.1 + i * w * 0.12, h * 0.7);
        ctx.lineTo(w * 0.16 + i * w * 0.12, h * 0.95);
        ctx.lineTo(w * 0.04 + i * w * 0.12, h * 0.95);
        ctx.fill();
      }
      ctx.fillStyle = '#e8d8c0';
      ctx.fillRect(w * 0.42, h * 0.56, w * 0.16, h * 0.08);
      // face
      ctx.fillStyle = '#e8c8a8';
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.44, w * 0.2, h * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      // hair + bun
      ctx.fillStyle = '#e8e4e0';
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.36, w * 0.23, h * 0.08, 0, Math.PI, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.25, w * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c8c4c0';
      ctx.fillRect(w * 0.3, h * 0.36, w * 0.4, h * 0.012);
      // spectacles
      ctx.strokeStyle = '#4a3a2a';
      ctx.lineWidth = 2.2;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(w / 2 + s * w * 0.08, h * 0.43, w * 0.055, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#3a2a1a';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(w / 2 + s * w * 0.08, h * 0.43, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = '#8a4a3a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.47, w * 0.06, 0.2, Math.PI - 0.2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(220,120,110,0.45)';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(w / 2 + s * w * 0.12, h * 0.47, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 2. Young couple in front of the new farmhouse.
    sepia(cell, 0, cell, cell * 2, () => {
      const w = cell;
      const h = cell * 2;
      ctx.fillStyle = '#d0c4a8';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#8a6a4a';
      ctx.fillRect(w * 0.08, h * 0.3, w * 0.84, h * 0.4);
      ctx.fillStyle = '#6a4a3a';
      ctx.beginPath();
      ctx.moveTo(0, h * 0.32);
      ctx.lineTo(w / 2, h * 0.14);
      ctx.lineTo(w, h * 0.32);
      ctx.fill();
      ctx.fillStyle = '#3a2a1a';
      ctx.fillRect(w * 0.42, h * 0.46, w * 0.16, h * 0.24);
      ctx.fillStyle = '#9a8a6a';
      ctx.fillRect(0, h * 0.7, w, h * 0.3);
      for (const [x, tall, dress] of [[0.33, 0.3, 1], [0.64, 0.34, 0]] as const) {
        ctx.fillStyle = dress ? '#e8dcc8' : '#4a4a5a';
        ctx.beginPath();
        ctx.ellipse(w * x, h * 0.82, w * 0.09, h * tall * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e0c0a0';
        ctx.beginPath();
        ctx.arc(w * x, h * (0.82 - tall * 0.45), w * 0.055, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = dress ? '#5a3a2a' : '#2a2a2a';
        ctx.beginPath();
        ctx.arc(w * x, h * (0.82 - tall * 0.47), w * 0.058, Math.PI, 0);
        ctx.fill();
      }
    });
    // 3. The valley with the Lantern Hall lit (painted watercolour, less sepia).
    sepia(cell * 2, 0, cell, cell * 2, () => {
      const w = cell;
      const h = cell * 2;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f0b890');
      g.addColorStop(0.5, '#f8dcb0');
      g.addColorStop(1, '#8aa870');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#7a9a8a';
      ctx.beginPath();
      ctx.moveTo(0, h * 0.5);
      ctx.quadraticCurveTo(w * 0.3, h * 0.36, w * 0.55, h * 0.48);
      ctx.quadraticCurveTo(w * 0.8, h * 0.38, w, h * 0.46);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.fill();
      ctx.fillStyle = '#5a7a4a';
      ctx.fillRect(0, h * 0.62, w, h * 0.4);
      ctx.fillStyle = '#6a4a3a';
      ctx.fillRect(w * 0.4, h * 0.5, w * 0.2, h * 0.12);
      ctx.beginPath();
      ctx.moveTo(w * 0.36, h * 0.51);
      ctx.lineTo(w * 0.5, h * 0.42);
      ctx.lineTo(w * 0.64, h * 0.51);
      ctx.fill();
      ctx.fillStyle = '#ffd070';
      for (const x of [0.45, 0.55]) ctx.fillRect(w * x - 4, h * 0.54, 8, 10);
      ctx.fillStyle = '#ffe8a0';
      ctx.beginPath();
      ctx.arc(w * 0.78, h * 0.22, 14, 0, Math.PI * 2);
      ctx.fill();
    }, 'rgba(170,120,70,0.12)');
    // 4. A little girl (the player, years ago) hugging a hen.
    sepia(cell * 3, 0, cell, cell * 2, () => {
      const w = cell;
      const h = cell * 2;
      ctx.fillStyle = '#c8d0b0';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#8a9a6a';
      ctx.fillRect(0, h * 0.62, w, h);
      ctx.fillStyle = '#d88a6a';
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.75, w * 0.2, h * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8c8a8';
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.5, w * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7a4a2a';
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.47, w * 0.14, Math.PI * 1.05, -0.05);
      ctx.fill();
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(w * 0.5 + s * w * 0.16, h * 0.53, w * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#f4f0e8';
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.7, w * 0.15, h * 0.07, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d83a2a';
      ctx.beginPath();
      ctx.arc(w * 0.36, h * 0.64, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a2a1a';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(w * 0.5 + s * w * 0.045, h * 0.5, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // Bottom row = v 0..0.5 → canvas y 512..1024.
    // 5. Cross-stitch sampler "Hearth & Home" with a house + hearts border.
    {
      const x = 0;
      const y = cell * 2;
      const w = cell * 2;
      const h = cell * 2;
      ctx.fillStyle = '#f2ead6';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      for (let k = 0; k < w; k += 4) {
        ctx.fillRect(x + k, y, 1, h);
        ctx.fillRect(x, y + k, w, 1);
      }
      const stitch = (sx: number, sy: number, col: string) => {
        ctx.fillStyle = col;
        ctx.fillRect(x + sx * 8 + 1, y + sy * 8 + 1, 6, 6);
      };
      for (let i = 2; i < 62; i++) {
        if (i % 4 === 0) {
          stitch(i, 3, '#b83a3a');
          stitch(i, 60, '#b83a3a');
        } else {
          stitch(i, 3, '#4a7a4a');
          stitch(i, 60, '#4a7a4a');
        }
        stitch(3, i, i % 4 ? '#4a7a4a' : '#b83a3a');
        stitch(60, i, i % 4 ? '#4a7a4a' : '#b83a3a');
      }
      // house
      for (let j = 0; j < 12; j++) for (let i = 0; i < 16; i++) stitch(24 + i, 30 + j, i > 6 && i < 10 && j > 5 ? '#6a4a2a' : '#d89a5a');
      for (let j = 0; j < 8; j++) for (let i = -j; i <= 16 + j - 1; i++) if (i >= -1 && i <= 16) stitch(24 + i, 29 - (7 - j), '#9a3a2a');
      for (const [i, j] of [[27, 33], [28, 33], [35, 33], [36, 33], [27, 34], [28, 34], [35, 34], [36, 34]]) stitch(i!, j!, '#f0d070');
      // hearts
      for (const [hx, hy] of [[10, 44], [48, 44]] as const) {
        const hp = ['01100110', '11111111', '11111111', '01111110', '00111100', '00011000'];
        hp.forEach((row, j) => [...row].forEach((ch, i) => ch === '1' && stitch(hx + i, hy + j, '#c83a4a')));
      }
      ctx.fillStyle = '#6a3a2a';
      ctx.font = 'bold 44px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('Hearth & Home', x + w / 2, y + 150);
      ctx.font = 'italic 26px Georgia, serif';
      ctx.fillText('R.  ·  Hearthvale', x + w / 2, y + 430);
    }
    // 6. Handwritten recipe card ("Rosalind's rhubarb crumble").
    {
      const x = cell * 2;
      const y = cell * 2;
      ctx.fillStyle = '#f6eed8';
      ctx.fillRect(x, y, cell, cell * 2);
      ctx.strokeStyle = 'rgba(120,150,190,0.5)';
      for (let k = 60; k < cell * 2; k += 26) {
        ctx.beginPath();
        ctx.moveTo(x + 10, y + k);
        ctx.lineTo(x + cell - 10, y + k);
        ctx.stroke();
      }
      ctx.fillStyle = '#4a3a6a';
      ctx.font = 'italic 22px Georgia, serif';
      ctx.fillText('Rhubarb', x + 24, y + 48);
      ctx.fillText('Crumble', x + 30, y + 74);
      for (let k = 0; k < 13; k++) {
        ctx.fillStyle = 'rgba(70,60,110,0.55)';
        ctx.fillRect(x + 20, y + 100 + k * 26, 60 + rng.next() * 150, 3);
      }
    }
    // 7. Calendar page with a painted hen.
    {
      const x = cell * 3;
      const y = cell * 2;
      ctx.fillStyle = '#f4ecd8';
      ctx.fillRect(x, y, cell, cell * 2);
      ctx.fillStyle = '#e8c8a0';
      ctx.fillRect(x + 16, y + 16, cell - 32, cell * 0.9);
      ctx.fillStyle = '#f8f4ec';
      ctx.beginPath();
      ctx.ellipse(x + cell / 2, y + 150, 60, 44, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d83a2a';
      ctx.beginPath();
      ctx.arc(x + cell / 2 + 40, y + 100, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6a4a2a';
      for (let j = 0; j < 5; j++) for (let i = 0; i < 7; i++) ctx.fillRect(x + 24 + i * 30, y + 280 + j * 40, 20, 4);
      ctx.fillStyle = '#b83a3a';
      ctx.font = 'bold 26px Georgia, serif';
      ctx.fillText('SPRING', x + 70, y + 262);
    }
    return { map: toTexture(c, true, false) };
  });
}

/** Map a PlaneGeometry's UVs to an atlas cell. */
export function atlasUV(g: THREE.BufferGeometry, cell: readonly [number, number, number, number]): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, cell[0] + uv.getX(i) * (cell[2] - cell[0]), cell[1] + uv.getY(i) * (cell[3] - cell[1]));
  return g;
}
