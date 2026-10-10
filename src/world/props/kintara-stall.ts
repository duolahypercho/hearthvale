/**
 * The Kintara Exchange: Perpetua Vane's ledger cart in Hearthvale square. A teal-and-cream striped stall with a
 * slate "tally wall" behind the counter (chalk marks, one for every kind deed), an open ledger, a lantern whose
 * flame grows with the Lantern Fund, and a hanging sign. Same conventions as townkit.ts (origin = ground centre of
 * the footprint, +Z = the customer side).
 */
import * as THREE from 'three';
import { MeshBuilder, roundedBox, boxUV, mat } from '../geom';
import { lantern } from './structures';

const TEAL = 0x2f7f86;
const CREAM = 0xd0c4a4;

const groundAO = (h = 0.5, min = 0.6) => (p: THREE.Vector3): number => min + (1 - min) * THREE.MathUtils.smoothstep(p.y, 0, h);

function signTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, 160);
  bg.addColorStop(0, '#f6e9c4');
  bg.addColorStop(1, '#e8d29c');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 160);
  g.strokeStyle = '#2f6f78';
  g.lineWidth = 8;
  g.strokeRect(10, 10, 492, 140);
  g.strokeStyle = 'rgba(47,111,120,.45)';
  g.lineWidth = 2;
  g.strokeRect(22, 22, 468, 116);
  g.fillStyle = '#2b5a62';
  g.textAlign = 'center';
  g.font = '700 58px Fredoka, Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText('KINTARA', 256, 78);
  g.font = '700 30px Fredoka, Nunito, ui-rounded, system-ui, sans-serif';
  g.fillStyle = '#9a6a2a';
  g.fillText('EXCHANGE', 256, 118);
  // a tiny lantern each side
  for (const x of [58, 454]) {
    g.fillStyle = '#e8a53a';
    g.beginPath();
    g.roundRect(x - 11, 62, 22, 30, 5);
    g.fill();
    g.strokeStyle = '#6a4a1a';
    g.lineWidth = 3;
    g.stroke();
    g.beginPath();
    g.moveTo(x - 7, 62);
    g.lineTo(x, 48);
    g.lineTo(x + 7, 62);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The slate tally wall: dark slate with rows of chalk tally strokes. */
function slateTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2c3a3c';
  g.fillRect(0, 0, 256, 160);
  for (let i = 0; i < 80; i++) {
    g.fillStyle = `rgba(255,255,255,${0.008 + (i % 5) * 0.004})`;
    g.fillRect((i * 53) % 256, (i * 31) % 160, 60, 2);
  }
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.strokeStyle = 'rgba(244,240,224,.82)';
  g.lineWidth = 2;
  g.lineCap = 'round';
  for (let row = 0; row < 6; row++) {
    let x = 12 + rnd() * 10;
    const y = 18 + row * 24;
    for (let grp = 0; grp < 6 && x < 232; grp++) {
      const n = row > 3 && grp > 3 ? 0 : 4;
      for (let k = 0; k < n; k++) {
        g.beginPath();
        g.moveTo(x + k * 5, y + rnd() * 2);
        g.lineTo(x + k * 5 + (rnd() - 0.5) * 2, y + 15 + rnd() * 3);
        g.stroke();
      }
      if (n) {
        g.beginPath();
        g.moveTo(x - 3, y + 11);
        g.lineTo(x + 20, y + 4);
        g.stroke();
      }
      x += 34 + rnd() * 6;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A tall teal pennant: a lantern over a column of chalk tallies. */
function bannerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 320;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f7f86';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(128, 0);
  g.lineTo(128, 290);
  g.lineTo(64, 250);
  g.lineTo(0, 290);
  g.closePath();
  g.fill();
  g.strokeStyle = '#f4ecd8';
  g.lineWidth = 6;
  g.strokeRect(9, 9, 110, 252);
  // lantern
  g.fillStyle = '#ffd66a';
  g.strokeStyle = '#7a4a10';
  g.lineWidth = 4;
  g.beginPath();
  g.roundRect(44, 52, 40, 56, 9);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(48, 52);
  g.lineTo(64, 30);
  g.lineTo(80, 52);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.fillRect(52, 62, 8, 30);
  // tallies
  g.strokeStyle = '#f4ecd8';
  g.lineWidth = 5;
  g.lineCap = 'round';
  for (let row = 0; row < 3; row++) {
    const y = 134 + row * 38;
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.moveTo(28 + k * 17, y);
      g.lineTo(28 + k * 17, y + 26);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(20, y + 20);
    g.lineTo(100, y + 6);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface KintaraStallParts {
  group: THREE.Group;
  /** Lantern flame light (warm). */
  light: THREE.PointLight;
  /** Fund tier 0..4 → flame size / brightness. */
  setTier(t: number): void;
  /** Gentle pennant sway. */
  tick(time: number, night: number): void;
}

export function buildKintaraStall(): KintaraStallParts {
  const b = new MeshBuilder();
  const W = 2.8;
  // Counter + top slab
  b.add('wood', boxUV(roundedBox(W, 0.92, 0.82, 0.04), 1 / 1.2), mat(0, 0.46, 0), { tint: 0xd8c4a0, aoWorld: groundAO(0.3) });
  b.add('woodGrain', roundedBox(W + 0.2, 0.08, 0.98, 0.03), mat(0, 0.96, 0.02), { tint: 0xe0b484 });
  // teal front panel
  b.add('woodPaint', roundedBox(W - 0.3, 0.5, 0.05, 0.02), mat(0, 0.5, 0.43), { tint: TEAL });
  for (let i = -2; i <= 2; i++) b.add('woodPaint', roundedBox(0.05, 0.5, 0.06, 0.015), mat(i * 0.6, 0.5, 0.44), { tint: CREAM });
  // posts
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('woodGrain', roundedBox(0.09, 2.8, 0.09, 0.03), mat(sx * (W / 2 + 0.05), 1.4, sz * 0.52), { tint: 0xa87a50 });
  // striped awning
  const n = 8;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 - 0.15 + (i + 0.5) * ((W + 0.3) / n);
    b.add('cloth', roundedBox((W + 0.3) / n + 0.01, 0.04, 1.5, 0.015), mat(x, 2.86, 0.05, 0.07, 0, 0), { tint: i % 2 ? CREAM : TEAL });
    const sc = new THREE.CylinderGeometry((W + 0.3) / n / 2, (W + 0.3) / n / 2, 0.035, 10, 1, false, 0, Math.PI);
    sc.rotateX(Math.PI / 2);
    b.add('cloth', sc, mat(x, 2.66, 0.78, 0, 0, Math.PI), { tint: i % 2 ? CREAM : TEAL });
  }
  // open ledger on the counter: two pages, spine, a ribbon and a quill
  b.add('white', roundedBox(0.34, 0.035, 0.46, 0.012), mat(-0.19, 1.025, 0.06, 0, 0.06, 0.04), { tint: 0xf6efd8 });
  b.add('white', roundedBox(0.34, 0.035, 0.46, 0.012), mat(0.19, 1.025, 0.06, 0, -0.06, -0.04), { tint: 0xf6efd8 });
  b.add('woodDark', roundedBox(0.78, 0.025, 0.5, 0.01), mat(0, 1.0, 0.06), { tint: 0x2f6f78 });
  b.add('white', roundedBox(0.02, 0.01, 0.3, 0.004), mat(0.02, 1.052, 0.2), { tint: 0xe8674a });
  b.add('white', new THREE.CylinderGeometry(0.008, 0.008, 0.36, 5), mat(0.5, 1.03, 0.12, 0.2, 0.8, Math.PI / 2 - 0.2), { tint: 0xf4f0e0 });
  // stack of sealed deed scrolls (little cream cylinders with teal bands)
  for (let i = 0; i < 3; i++) {
    b.add('white', new THREE.CylinderGeometry(0.045, 0.045, 0.34, 8), mat(-0.95, 1.07 + (i === 2 ? 0.08 : 0), 0.08 + (i % 2) * 0.1 - 0.02 * i, 0, 0.3 * i, Math.PI / 2), { tint: CREAM });
    b.add('white', new THREE.CylinderGeometry(0.05, 0.05, 0.05, 8), mat(-0.95, 1.07 + (i === 2 ? 0.08 : 0), 0.08 + (i % 2) * 0.1 - 0.02 * i, 0, 0.3 * i, Math.PI / 2), { tint: TEAL });
  }
  // a brass scale (the "weighing" of a good deed)
  b.add('metal', new THREE.CylinderGeometry(0.05, 0.07, 0.04, 10), mat(0.95, 1.02, 0.1), { tint: 0xd8a64a });
  b.add('metal', new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), mat(0.95, 1.2, 0.1), { tint: 0xd8a64a });
  b.add('metal', roundedBox(0.4, 0.02, 0.02, 0.008), mat(0.95, 1.35, 0.1, 0, 0, 0.06), { tint: 0xd8a64a });
  for (const sx of [-1, 1]) b.add('metal', new THREE.CylinderGeometry(0.075, 0.055, 0.025, 10), mat(0.95 + sx * 0.2, 1.2 - sx * 0.012, 0.1), { tint: 0xd8a64a });
  // lantern on the counter (flame = the Lantern Fund)
  lantern(b, -0.45, 1.2, -0.05, 1.5);
  // post lanterns
  lantern(b, -W / 2 - 0.02, 2.3, 0.56, 1.0);
  lantern(b, W / 2 + 0.02, 2.3, 0.56, 1.0);
  // tally wall: slate in a wooden frame leaning behind the counter
  b.add('woodDark', roundedBox(1.95, 1.25, 0.07, 0.03), mat(0.0, 1.8, -0.5, -0.05, 0, 0));
  const group = b.build({ name: 'kintara-stall' });

  const slate = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), new THREE.MeshStandardMaterial({ map: slateTexture(), roughness: 0.9 }));
  slate.position.set(0, 1.8, -0.455);
  slate.rotation.x = -0.05;
  group.add(slate);
  // hanging sign (plank board under the awning front)
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 0.61), new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.8 }));
  sign.position.set(0, 2.18, 0.86);
  sign.rotation.x = -0.04;
  group.add(sign);
  const bo = new THREE.Mesh(new THREE.BoxGeometry(2.03, 0.69, 0.03), new THREE.MeshStandardMaterial({ color: 0x6a4630, roughness: 0.8 }));
  bo.position.set(0, 2.18, 0.835);
  group.add(bo);
  for (const sx of [-1, 1]) {
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.28, 5), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.6, roughness: 0.5 }));
    chain.position.set(sx * 0.9, 2.5, 0.86);
    group.add(chain);
  }

  // Silhouette: two pennants rising over the awning, and a lantern pole with a string of lanterns leading in from the square.
  const bt = bannerTexture();
  for (const sx of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.5, 6), new THREE.MeshStandardMaterial({ color: 0x6a4630, roughness: 0.8 }));
    pole.position.set(sx * (W / 2 + 0.05), 3.4, -0.5);
    group.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.25), new THREE.MeshStandardMaterial({ map: bt, roughness: 0.85, side: THREE.DoubleSide, transparent: true, alphaTest: 0.4 }));
    flag.position.set(sx * (W / 2 + 0.05) + sx * 0.27, 3.45, -0.5);
    flag.userData.sway = sx;
    group.add(flag);
  }
  const POLE = { x: 3.7, z: 0.9, h: 3.4 };
  const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, POLE.h, 7), new THREE.MeshStandardMaterial({ color: 0x5a3a26, roughness: 0.8 }));
  lp.position.set(POLE.x, POLE.h / 2, POLE.z);
  group.add(lp);
  const lb = new MeshBuilder();
  lantern(lb, POLE.x, POLE.h + 0.1, POLE.z, 1.5);
  const a0 = new THREE.Vector3(W / 2 + 0.05, 2.9, -0.5);
  const a1 = new THREE.Vector3(POLE.x, POLE.h, POLE.z);
  const N = 7;
  for (let i = 1; i < N; i++) {
    const t = i / N;
    const p = a0.clone().lerp(a1, t);
    p.y -= Math.sin(t * Math.PI) * 0.55;
    lantern(lb, p.x, p.y - 0.12, p.z, 0.7);
  }
  const wire = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => { const t = i / 8; const p = a0.clone().lerp(a1, t); p.y -= Math.sin(t * Math.PI) * 0.55; return p; })), 16, 0.012, 4),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7 }),
  );
  group.add(wire, lb.build({ name: 'kintara-string' }));
  // Warm pools of light on the ground: one at the keeper's end of the counter, one in front of the stall.
  const glowTex = (): THREE.CanvasTexture => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,214,140,0.9)');
    gr.addColorStop(0.45, 'rgba(255,190,110,0.35)');
    gr.addColorStop(1, 'rgba(255,170,90,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  };
  const gt = glowTex();
  const glows: THREE.Mesh[] = [];
  for (const [gx, gz, gs] of [[-2.0, 0.5, 3.6], [0, 1.5, 4.8], [3.7, 0.9, 3.0]] as [number, number, number][]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(gs, gs), new THREE.MeshBasicMaterial({ map: gt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(gx, 0.05, gz);
    m.renderOrder = 2;
    group.add(m);
    glows.push(m);
  }
  const light = new THREE.PointLight(0xffc878, 0, 5.5, 1.6);
  light.position.set(-1.4, 1.7, 0.6);
  group.add(light);
  let tierNow = 0;
  const setTier = (t: number): void => {
    tierNow = t;
    // The Lantern Fund widens the lamp's pool of light (its brightness follows the night, see DayNight).
    light.distance = 4.2 + 0.9 * t;
    for (const m of glows) (m.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.1 * t;
    light.color.setHex([0xffc878, 0xffcf80, 0xffd68c, 0xffdf9a, 0xffe8ae][Math.min(4, t)]!);
  };
  setTier(0);
  group.traverse((o) => {
    o.userData.noAO = true;
  });
  group.userData.perfTag = 'kintara';
  const tick = (time: number, night: number): void => {
    for (const m of glows) (m.material as THREE.MeshBasicMaterial).opacity = (0.5 + 0.1 * tierNow) * (0.25 + 0.75 * night);
    group.traverse((o) => {
      if (o.userData.sway) o.rotation.y = Math.sin(time * 1.6 + o.userData.sway) * 0.18;
    });
  };
  return { group, light, setTier, tick };
}
