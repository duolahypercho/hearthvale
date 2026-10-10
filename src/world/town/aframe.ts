/**
 * Chalk A-frame boards for the square (r8 critic: the dark menu boards seen edge-on read as blank
 * slabs in the talk lenses). A lighter honey-wood frame with a painted chalk menu on both faces —
 * a header, two lines of chalk lettering, a little loaf and cup doodle, a ruled border and eraser
 * smudges — one shared canvas texture, so every board in a batch cell merges into one draw.
 */
import * as THREE from 'three';
import { MeshBuilder, roundedBox, mat } from '../geom';

let FACE_MAT: THREE.MeshStandardMaterial | null = null;

function chalkFace(): THREE.MeshStandardMaterial {
  if (FACE_MAT) return FACE_MAT;
  const W = 256;
  const H = 360;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // Slate, a touch green, lifted so it reads as a board (not a hole) from the high lens.
  const gr = g.createLinearGradient(0, 0, W, H);
  gr.addColorStop(0, '#3e5a4e');
  gr.addColorStop(1, '#2f4a40');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  // Eraser smudges.
  g.globalAlpha = 0.12;
  g.fillStyle = '#e8efe6';
  for (const [x, y, rx, ry] of [[70, 250, 60, 18], [180, 120, 50, 14], [120, 320, 70, 12]] as const) {
    g.beginPath();
    g.ellipse(x, y, rx, ry, -0.2, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const chalk = (text: string, x: number, y: number, size: number, col: string): void => {
    g.font = `700 ${size}px Fredoka, "Comic Sans MS", Nunito, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = col;
    g.globalAlpha = 0.92;
    g.fillText(text, x, y);
    g.globalAlpha = 1;
  };
  // Ruled chalk border.
  g.strokeStyle = 'rgba(240,236,220,0.75)';
  g.lineWidth = 4;
  g.setLineDash([14, 8]);
  g.strokeRect(14, 14, W - 28, H - 28);
  g.setLineDash([]);
  chalk('TODAY', W / 2, 52, 44, '#ffd36a');
  g.strokeStyle = '#ffd36a';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(60, 80);
  g.quadraticCurveTo(W / 2, 90, W - 60, 78);
  g.stroke();
  chalk('fresh buns', W / 2, 122, 30, '#f4f0e2');
  chalk('honey tea', W / 2, 164, 30, '#f4f0e2');
  chalk('2g', W / 2, 204, 26, '#ff9ab0');
  // Doodles: a loaf and a steaming cup.
  g.strokeStyle = '#f4f0e2';
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.beginPath();
  g.ellipse(84, 276, 42, 26, 0, Math.PI, 0);
  g.lineTo(126, 290);
  g.lineTo(42, 290);
  g.closePath();
  g.stroke();
  for (const x of [66, 84, 102]) {
    g.beginPath();
    g.moveTo(x - 6, 262);
    g.lineTo(x + 6, 252);
    g.stroke();
  }
  g.strokeStyle = '#9ad8f0';
  g.beginPath();
  g.moveTo(152, 258);
  g.lineTo(158, 300);
  g.lineTo(196, 300);
  g.lineTo(202, 258);
  g.closePath();
  g.stroke();
  g.beginPath();
  g.arc(208, 276, 10, -Math.PI / 2, Math.PI / 2);
  g.stroke();
  g.strokeStyle = 'rgba(244,240,226,0.7)';
  for (const x of [166, 178, 190]) {
    g.beginPath();
    g.moveTo(x, 246);
    g.quadraticCurveTo(x + 6, 236, x, 226);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  FACE_MAT = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, name: 'chalkFace' });
  return FACE_MAT;
}

/** An A-frame chalk board, ~0.95 m tall, legs splayed; `tint` colours the frame's trim. */
export function buildChalkAFrame(tint = 0x56786a): THREE.Group {
  const b = new MeshBuilder();
  const frame = 0xc8965e;
  for (const s of [-1, 1]) {
    // Honey-wood frame: two stiles and a top rail, the trim colour on the header cap.
    for (const x of [-0.27, 0.27]) b.add('woodGrain', roundedBox(0.06, 0.92, 0.05, 0.02), mat(x, 0.45, s * 0.14, s * 0.18, 0, 0), { tint: frame });
    b.add('woodGrain', roundedBox(0.6, 0.07, 0.055, 0.02), mat(0, 0.88, s * 0.165, s * 0.18, 0, 0), { tint });
    b.add('woodGrain', roundedBox(0.56, 0.05, 0.05, 0.02), mat(0, 0.12, s * 0.12, s * 0.18, 0, 0), { tint: frame });
  }
  const g = b.build({ name: 'chalk-aframe' });
  const faceMat = chalkFace();
  for (const s of [-1, 1]) {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.68), faceMat);
    q.position.set(0, 0.48, s * 0.172);
    // (each face turned outwards and tilted with its half of the frame)
    q.rotation.set(s * 0.18, s < 0 ? Math.PI : 0, 0);
    q.castShadow = false;
    q.receiveShadow = true;
    g.add(q);
  }
  return g;
}
