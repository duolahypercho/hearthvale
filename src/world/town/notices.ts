/**
 * The notice board's paperwork, painted: a canvas laid over the board face with pinned notes that
 * actually say things — Marigold's LOST CAT poster (a sketch of Pip), the Lantern Hall bundle flyer
 * lettering round the gold lantern, a bake-sale card, the forge's help-wanted slip with a hammer, a
 * child's crayon drawing, a tide / weather table and handwriting squiggles, each with a coloured
 * pin, a curled corner and a soft drop shadow. One quad, one draw call.
 */
import * as THREE from 'three';

const W = 1024;
const H = 620;
/** Board face size (m) in the notice board's local space (townkit buildNoticeBoard). */
const FACE = { w: 1.86, h: 1.12, y: 1.35, z: 0.079 };

type Note = { x: number; y: number; w: number; h: number; rot: number; paper: string; pin: string; draw: (g: CanvasRenderingContext2D, w: number, h: number) => void };

function squiggles(g: CanvasRenderingContext2D, x: number, y: number, w: number, rows: number, gap: number, ink = '#4a3a2e', seed = 1): void {
  g.strokeStyle = ink;
  g.lineWidth = 3;
  g.lineCap = 'round';
  let s = seed;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < rows; r++) {
    const len = w * (r === rows - 1 ? 0.45 + rnd() * 0.3 : 0.8 + rnd() * 0.2);
    g.beginPath();
    let cx = x;
    const cy = y + r * gap;
    g.moveTo(cx, cy);
    while (cx < x + len) {
      const step = 7 + rnd() * 9;
      g.quadraticCurveTo(cx + step / 2, cy - 4 - rnd() * 5, cx + step, cy + (rnd() - 0.5) * 3);
      cx += step;
      if (rnd() < 0.12) {
        cx += 8;
        g.moveTo(cx, cy);
      }
    }
    g.stroke();
  }
}

function hand(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center'): void {
  g.fillStyle = color;
  g.font = `700 ${size}px Fredoka, "Comic Sans MS", Nunito, sans-serif`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(text, x, y);
}

const NOTES: Note[] = [
  {
    // LOST CAT — Pip, drawn in pencil.
    x: 40, y: 40, w: 250, h: 300, rot: -0.05, paper: '#fbf4e2', pin: '#d8412f',
    draw: (g, w) => {
      hand(g, 'LOST CAT', w / 2, 38, 40, '#b8322a');
      g.strokeStyle = '#3a2a22';
      g.lineWidth = 3.5;
      g.fillStyle = '#f0a050';
      g.beginPath();
      g.ellipse(w / 2, 150, 62, 48, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.beginPath();
      g.ellipse(w / 2, 100, 40, 34, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      for (const sx of [-1, 1]) {
        g.beginPath();
        g.moveTo(w / 2 + sx * 34, 84);
        g.lineTo(w / 2 + sx * 30, 58);
        g.lineTo(w / 2 + sx * 14, 72);
        g.fill();
        g.stroke();
        g.beginPath();
        g.arc(w / 2 + sx * 14, 98, 3.5, 0, Math.PI * 2);
        g.fillStyle = '#3a2a22';
        g.fill();
        g.fillStyle = '#f0a050';
      }
      g.beginPath();
      g.moveTo(w / 2 + 60, 160);
      g.quadraticCurveTo(w / 2 + 100, 150, w / 2 + 88, 110);
      g.stroke();
      g.strokeStyle = '#c8783a';
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.moveTo(w / 2 - 30 + i * 22, 118 + i * 4);
        g.lineTo(w / 2 - 22 + i * 22, 190);
        g.stroke();
      }
      hand(g, '“Pip” — orange, round,', w / 2, 222, 22, '#4a3a2e');
      hand(g, 'judgmental. Ask Marigold', w / 2, 248, 22, '#4a3a2e');
      squiggles(g, 30, 276, w - 60, 1, 20, '#7a6a5e', 7);
    },
  },
  {
    // Bake sale card.
    x: 305, y: 70, w: 190, h: 170, rot: 0.06, paper: '#fff1d6', pin: '#3f7fb0',
    draw: (g, w) => {
      hand(g, 'Bake Sale!', w / 2, 34, 32, '#c0482e');
      g.fillStyle = '#e8a860';
      g.beginPath();
      g.arc(w / 2, 86, 30, Math.PI, 0);
      g.fill();
      g.fillStyle = '#c8783a';
      g.fillRect(w / 2 - 34, 86, 68, 14);
      g.strokeStyle = '#8a4a2a';
      g.lineWidth = 3;
      for (let i = -1; i <= 1; i++) {
        g.beginPath();
        g.moveTo(w / 2 + i * 14 - 6, 66);
        g.lineTo(w / 2 + i * 14 + 6, 80);
        g.stroke();
      }
      hand(g, 'Sat. · The Hearth Oven', w / 2, 126, 19, '#4a3a2e');
      squiggles(g, 24, 150, w - 48, 1, 18, '#7a6a5e', 3);
    },
  },
  {
    // Crayon drawing by Kit: a house, a sun and a very large frog.
    x: 300, y: 300, w: 200, h: 170, rot: -0.09, paper: '#f4f8ff', pin: '#e8b83a',
    draw: (g) => {
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.strokeStyle = '#f2b43a';
      g.beginPath();
      g.arc(160, 36, 18, 0, Math.PI * 2);
      g.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.beginPath();
        g.moveTo(160 + Math.cos(a) * 26, 36 + Math.sin(a) * 26);
        g.lineTo(160 + Math.cos(a) * 36, 36 + Math.sin(a) * 36);
        g.stroke();
      }
      g.strokeStyle = '#c0482e';
      g.beginPath();
      g.moveTo(22, 130);
      g.lineTo(22, 84);
      g.lineTo(56, 56);
      g.lineTo(90, 84);
      g.lineTo(90, 130);
      g.closePath();
      g.stroke();
      g.strokeStyle = '#4a9a3a';
      g.beginPath();
      g.ellipse(140, 118, 40, 26, 0, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#2a2a2a';
      g.beginPath();
      g.arc(126, 100, 5, 0, Math.PI * 2);
      g.arc(154, 100, 5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#3a8a4a';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(10, 152);
      g.quadraticCurveTo(100, 140, 190, 152);
      g.stroke();
      hand(g, 'by KIT', 44, 158, 17, '#3f5fa0');
    },
  },
  {
    // Right of the flyer: the forge wants a hand.
    x: 740, y: 36, w: 240, h: 190, rot: 0.04, paper: '#f6e7c4', pin: '#5a8a4a',
    draw: (g, w) => {
      hand(g, 'HELP WANTED', w / 2, 32, 30, '#3a2a22');
      g.save();
      g.translate(58, 96);
      g.rotate(-0.6);
      g.fillStyle = '#8a5a32';
      g.fillRect(-5, -6, 10, 64);
      g.fillStyle = '#4a4a50';
      g.fillRect(-26, -22, 52, 22);
      g.restore();
      squiggles(g, 104, 76, w - 128, 4, 22, '#4a3a2e', 11);
      hand(g, '— Flint & Ember', w - 20, 170, 18, '#6a4a2e', 'right');
    },
  },
  {
    // A weather / tide table with a ruled grid.
    x: 760, y: 262, w: 220, h: 230, rot: -0.04, paper: '#fbfbf2', pin: '#d8412f',
    draw: (g, w) => {
      hand(g, 'Market Days', w / 2, 30, 26, '#3a5a7a');
      g.strokeStyle = 'rgba(60,90,120,0.55)';
      g.lineWidth = 2;
      for (let i = 0; i <= 4; i++) {
        g.beginPath();
        g.moveTo(18, 58 + i * 34);
        g.lineTo(w - 18, 58 + i * 34);
        g.stroke();
      }
      for (let j = 0; j <= 3; j++) {
        g.beginPath();
        g.moveTo(18 + (j * (w - 36)) / 3, 58);
        g.lineTo(18 + (j * (w - 36)) / 3, 194);
        g.stroke();
      }
      const marks = ['#e8574a', '#5a8a4a', '#f2b43a', '#3f7fb0'];
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 3; j++)
          if ((i * 3 + j) % 3 !== 1) {
            g.fillStyle = marks[(i + j) % 4]!;
            g.beginPath();
            g.arc(18 + ((j + 0.5) * (w - 36)) / 3, 75 + i * 34, 7, 0, Math.PI * 2);
            g.fill();
          }
      squiggles(g, 24, 212, w - 48, 1, 16, '#7a6a5e', 5);
    },
  },
  {
    // The lantern flyer's lettering (the gold lantern itself is modelled on the board).
    x: 520, y: 30, w: 205, h: 60, rot: 0, paper: 'transparent', pin: '',
    draw: (g, w) => {
      hand(g, 'LANTERN HALL', w / 2, 30, 27, '#9a5a1e');
    },
  },
  {
    x: 520, y: 470, w: 205, h: 90, rot: 0, paper: 'transparent', pin: '',
    draw: (g, w) => {
      hand(g, 'Bring bundles!', w / 2, 22, 22, '#6a3a1e');
      squiggles(g, 30, 56, w - 60, 2, 18, '#7a5a3e', 13);
    },
  },
  {
    // A torn scrap low on the left.
    x: 60, y: 380, w: 200, h: 150, rot: 0.08, paper: '#e8f0f8', pin: '#8a4ab0',
    draw: (g, w) => {
      hand(g, 'Choir — Thurs.', w / 2, 30, 24, '#3a3a6a');
      squiggles(g, 22, 70, w - 44, 3, 22, '#3a3a6a', 17);
    },
  },
];

let tex: THREE.CanvasTexture | null = null;

function paint(): THREE.CanvasTexture {
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  for (const n of NOTES) {
    g.save();
    g.translate(n.x + n.w / 2, n.y + n.h / 2);
    g.rotate(n.rot);
    g.translate(-n.w / 2, -n.h / 2);
    if (n.paper !== 'transparent') {
      g.shadowColor = 'rgba(40,20,5,0.45)';
      g.shadowBlur = 10;
      g.shadowOffsetX = 3;
      g.shadowOffsetY = 5;
      g.fillStyle = n.paper;
      g.beginPath();
      // A curled bottom-right corner.
      g.moveTo(0, 0);
      g.lineTo(n.w, 0);
      g.lineTo(n.w, n.h - 26);
      g.quadraticCurveTo(n.w - 6, n.h - 6, n.w - 28, n.h);
      g.lineTo(0, n.h);
      g.closePath();
      g.fill();
      g.shadowColor = 'transparent';
      g.fillStyle = 'rgba(120,90,50,0.18)';
      g.beginPath();
      g.moveTo(n.w, n.h - 26);
      g.quadraticCurveTo(n.w - 16, n.h - 18, n.w - 28, n.h);
      g.quadraticCurveTo(n.w - 10, n.h - 12, n.w, n.h - 26);
      g.fill();
      // Paper grain: faint fibres.
      g.globalAlpha = 0.06;
      g.fillStyle = '#6a4a2a';
      for (let i = 0; i < 40; i++) g.fillRect((i * 37) % n.w, (i * 53) % n.h, 2 + (i % 5), 1);
      g.globalAlpha = 1;
    }
    n.draw(g, n.w, n.h);
    if (n.pin) {
      const px = n.w / 2;
      g.shadowColor = 'rgba(0,0,0,0.4)';
      g.shadowBlur = 4;
      g.shadowOffsetY = 3;
      g.fillStyle = n.pin;
      g.beginPath();
      g.arc(px, 10, 10, 0, Math.PI * 2);
      g.fill();
      g.shadowColor = 'transparent';
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.beginPath();
      g.arc(px - 3, 7, 3.5, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** The painted notes quad for a notice board at (x, y, z) turned by rot (board local frame). */
export function buildNoticeOverlay(): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(FACE.w, FACE.h),
    new THREE.MeshStandardMaterial({ map: paint(), transparent: true, alphaTest: 0.04, roughness: 0.85, depthWrite: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  m.name = 'notice-papers';
  m.position.set(0, FACE.y, FACE.z);
  m.castShadow = false;
  m.receiveShadow = true;
  m.userData.perfTag = 'props';
  return m;
}
