/**
 * Plaza wear (r12 critic: "the plaza is a large empty cobble disc"): one draped decal over the square
 * that tells where people walk and where they don't — a polished, darker ring of foot traffic round
 * the fountain and along the desire lines to the shops and the Hall, moss creeping into the joints at
 * the quiet edges and behind the benches, damp patches under the basin's lip and the flower beds, a
 * scatter of petals and leaves blown into the corners. One mesh, one draw call, main pass only
 * (transparent, no shadow / AO), hidden under winter snow.
 */
import * as THREE from 'three';

function wearTexture(cx: number, cz: number, R: number, seed = 5): THREE.CanvasTexture {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  let s = seed;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
  const px = (x: number): number => ((x - (cx - R)) / (2 * R)) * S;
  const pz = (z: number): number => ((z - (cz - R)) / (2 * R)) * S;
  const m = S / (2 * R);
  const blob = (x: number, y: number, r: number, col: string, a: number, sy = 1, rot = 0): void => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.scale(1, sy);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    gr.addColorStop(0, `rgba(${col},${a})`);
    gr.addColorStop(0.6, `rgba(${col},${a * 0.55})`);
    gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr;
    g.fillRect(-r, -r, r * 2, r * 2);
    g.restore();
  };
  // r13 (critic: "large empty cobble expanses in the foreground"): laid paving that breaks the
  // field — a ring of pale sandstone setts round the basin (three courses, staggered joints) and a
  // herringbone brick runner from the ring down the Meadow Lane desire line (south, towards the lens).
  const sett = (x: number, y: number, w: number, h: number, rot: number, col: string): void => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.fillStyle = 'rgba(46,36,30,0.55)';
    g.beginPath();
    g.roundRect(-w / 2 - 1.2, -h / 2 - 1.2, w + 2.4, h + 2.4, 3);
    g.fill();
    g.fillStyle = col;
    g.beginPath();
    g.roundRect(-w / 2, -h / 2, w, h, 2.5);
    g.fill();
    // a lit top edge and a worn centre
    g.fillStyle = 'rgba(255,248,230,0.22)';
    g.fillRect(-w / 2 + 1.5, -h / 2 + 1, w - 3, 1.6);
    g.restore();
  };
  const sand = ['226,206,170', '214,192,152', '236,218,184', '204,182,146'];
  for (let course = 0; course < 3; course++) {
    const r = 4.55 + course * 0.27;
    const n = Math.round((Math.PI * 2 * r) / 0.34);
    for (let i = 0; i < n; i++) {
      const a = ((i + (course % 2) * 0.5) / n) * Math.PI * 2;
      sett(px(cx + Math.cos(a) * r), pz(cz + Math.sin(a) * r), m * 0.3, m * 0.21, a + Math.PI / 2, `rgba(${sand[Math.floor(rnd() * sand.length)]},0.95)`);
    }
  }
  {
    const brick = ['168,92,64', '150,80,58', '182,104,72', '140,74,52'];
    const z0 = cz + 5.45;
    const z1 = cz + R;
    // Running bond (staggered courses of upright bricks). The earlier 45-degree herringbone overlapped its own dark
    // joint outlines into a blurry red X lattice that read as a decal pasted under the characters.
    for (let z = z0, row = 0; z < z1; z += 0.105, row++)
      for (let x = cx - 0.78 + (row % 2 ? 0.1 : 0); x <= cx + 0.78; x += 0.2)
        sett(px(x), pz(z), m * 0.178, m * 0.084, 0, `rgba(${brick[Math.floor(rnd() * brick.length)]},0.93)`);
    // kerb setts edging the runner
    for (const sx of [-1, 1]) for (let z = z0; z < z1; z += 0.26) sett(px(cx + sx * 0.92), pz(z), m * 0.14, m * 0.24, 0, `rgba(${sand[Math.floor(rnd() * sand.length)]},0.95)`);
  }
  // Foot-traffic ring round the basin: polished, a touch darker and warmer.
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 3.0 + rnd() * 1.6;
    blob(px(cx + Math.cos(a) * r), pz(cz + Math.sin(a) * r), m * (0.8 + rnd() * 1.1), '62,48,38', 0.09 + rnd() * 0.06);
  }
  // Desire lines: to the Hall steps (north), the store (north-west), the bakery (north-east), the
  // market road (east) and Meadow Lane (south).
  const lines: [number, number][] = [
    [32, 15.5],
    [24.5, 18.5],
    [39.5, 18.5],
    [44, 24.5],
    [32, 34],
    [20, 25],
  ];
  for (const [tx, tz] of lines) {
    for (let i = 0; i < 26; i++) {
      const t = 0.15 + (i / 26) * 0.85;
      const a = Math.atan2(tz - cz, tx - cx);
      const r0 = 3.2;
      const x = cx + Math.cos(a) * r0 + (tx - cx - Math.cos(a) * r0) * t + (rnd() - 0.5) * 0.7;
      const z = cz + Math.sin(a) * r0 + (tz - cz - Math.sin(a) * r0) * t + (rnd() - 0.5) * 0.7;
      blob(px(x), pz(z), m * (0.7 + rnd() * 0.6), '58,46,36', 0.07 + rnd() * 0.05, 0.6, a);
    }
  }
  // Moss in the joints at the quiet edges (the plaza rim between the desire lines) and behind benches.
  for (let i = 0; i < 150; i++) {
    const a = rnd() * Math.PI * 2;
    const nearLine = lines.some(([tx, tz]) => {
      const d = Math.abs(((Math.atan2(tz - cz, tx - cx) - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      return d < 0.32;
    });
    if (nearLine) continue;
    const r = 5.2 + rnd() * 2.3;
    const x = px(cx + Math.cos(a) * r);
    const y = pz(cz + Math.sin(a) * r);
    blob(x, y, m * (0.25 + rnd() * 0.5), '78,108,42', 0.28 + rnd() * 0.25);
    // speckled clumps
    for (let k = 0; k < 6; k++) blob(x + (rnd() - 0.5) * m * 0.9, y + (rnd() - 0.5) * m * 0.9, m * (0.05 + rnd() * 0.08), '92,128,48', 0.6);
  }
  // Damp under the basin lip (the overflow's splash) and in a few low spots.
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 2.35 + rnd() * 0.5;
    blob(px(cx + Math.cos(a) * r), pz(cz + Math.sin(a) * r), m * (0.3 + rnd() * 0.4), '40,46,52', 0.16 + rnd() * 0.1);
  }
  // Petals and leaves blown into the corners and against the kerbs.
  const petal = ['246,170,196', '255,236,240', '214,120,72', '170,140,60'];
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() < 0.7 ? 5.4 + rnd() * 2.0 : 2.5 + rnd() * 2.5;
    const x = px(cx + Math.cos(a) * r);
    const y = pz(cz + Math.sin(a) * r);
    g.save();
    g.translate(x, y);
    g.rotate(rnd() * Math.PI);
    g.fillStyle = `rgba(${petal[Math.floor(rnd() * petal.length)]},0.92)`;
    g.beginPath();
    g.ellipse(0, 0, m * (0.035 + rnd() * 0.03), m * (0.02 + rnd() * 0.015), 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  // r17 (critic: "large empty cobble expanses in the foreground" of the plaza lenses): Kit's chalk —
  // a hopscotch court laid across the view south-east of the basin (numbered, a home arc at the end),
  // a lopsided sun, a heart, an arrow and a dropped stub of chalk. Grainy dry strokes over the setts.
  {
    const chalkLine = (x0: number, y0: number, x1: number, y1: number, col: string, wpx: number): void => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(2, Math.round(len / 2.2));
      for (let pass = 0; pass < 2; pass++) {
        g.strokeStyle = `rgba(${col},${pass ? 0.42 : 0.78})`;
        g.lineWidth = wpx * (pass ? 1.7 : 1);
        g.lineCap = 'round';
        g.beginPath();
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const jx = (rnd() - 0.5) * wpx * 0.5;
          const jy = (rnd() - 0.5) * wpx * 0.5;
          const x = x0 + (x1 - x0) * t + jx;
          const y = y0 + (y1 - y0) * t + jy;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      // dry-chalk skips: tiny gaps where the stroke missed the stone's low spots
      g.save();
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < len / 3; i++) {
        const t = rnd();
        blob(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, wpx * (0.4 + rnd() * 0.5), '0,0,0', 0.5);
      }
      g.restore();
    };
    const W = 'cream';
    const C: Record<string, string> = { cream: '246,240,226', pink: '246,170,196', yellow: '250,224,120', blue: '150,196,240', green: '170,226,150' };
    const lw = m * 0.055;
    const box = (x: number, z: number, s: number, col: string): void => {
      const a = px(x - s / 2);
      const b = px(x + s / 2);
      const c0 = pz(z - s / 2);
      const d = pz(z + s / 2);
      chalkLine(a, c0, b, c0, col, lw);
      chalkLine(b, c0, b, d, col, lw);
      chalkLine(b, d, a, d, col, lw);
      chalkLine(a, d, a, c0, col, lw);
    };
    const num = (x: number, z: number, n: number, col: string): void => {
      g.save();
      g.translate(px(x), pz(z));
      g.rotate((rnd() - 0.5) * 0.3);
      g.font = `700 ${Math.round(m * 0.26)}px Nunito, 'Trebuchet MS', sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = `rgba(${C[col]},0.86)`;
      g.fillText(String(n), 0, 0);
      g.restore();
    };
    // The court: 1 · 2 · 3|4 · 5 · 6|7 · home (left to right as the plaza lens sees it).
    const s = 0.44;
    const z0 = cz + 4.35;
    let x = cx + 1.25;
    const cols = ['pink', 'yellow', 'blue', 'green'];
    let k = 1;
    const plan = [1, 1, 2, 1, 2];
    for (let i = 0; i < plan.length; i++) {
      const col = C[cols[i % cols.length]!]!;
      if (plan[i] === 1) {
        box(x, z0, s, col);
        num(x, z0, k++, cols[i % cols.length]!);
      } else {
        box(x, z0 - s / 2, s, col);
        box(x, z0 + s / 2, s, col);
        num(x, z0 - s / 2, k++, cols[i % cols.length]!);
        num(x, z0 + s / 2, k++, cols[i % cols.length]!);
      }
      x += s;
    }
    // home: a half-round cap
    g.save();
    g.strokeStyle = `rgba(${C[W]},0.6)`;
    g.lineWidth = lw;
    g.beginPath();
    g.arc(px(x - s / 2), pz(z0), m * s * 0.95, -Math.PI / 2, Math.PI / 2);
    g.stroke();
    g.restore();
    // the start line and a stub of chalk left on it
    chalkLine(px(cx + 1.25 - s / 2 - 0.25), pz(z0 - 0.5), px(cx + 1.25 - s / 2 - 0.25), pz(z0 + 0.5), C[W]!, lw * 0.8);
    g.save();
    g.translate(px(cx + 0.72), pz(z0 + 0.38));
    g.rotate(0.6);
    g.fillStyle = 'rgba(246,170,196,0.95)';
    g.fillRect(-m * 0.05, -m * 0.017, m * 0.1, m * 0.034);
    g.restore();
    // A lopsided sun with rays, a heart, an arrow pointing at the bakery.
    const sx = px(cx - 2.15);
    const sy = pz(cz + 3.75);
    const sr = m * 0.36;
    g.save();
    g.strokeStyle = `rgba(${C.yellow},0.7)`;
    g.lineWidth = lw;
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r = sr * (1 + (rnd() - 0.5) * 0.08);
      if (i === 0) g.moveTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
      else g.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
    }
    g.stroke();
    g.restore();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.2;
      chalkLine(sx + Math.cos(a) * sr * 1.3, sy + Math.sin(a) * sr * 1.3, sx + Math.cos(a) * sr * 1.85, sy + Math.sin(a) * sr * 1.85, C.yellow!, lw * 0.9);
    }
    // a smile in the sun
    g.save();
    g.strokeStyle = `rgba(${C.yellow},0.7)`;
    g.lineWidth = lw * 0.8;
    g.beginPath();
    g.arc(sx, sy + sr * 0.05, sr * 0.5, 0.35, Math.PI - 0.35);
    g.stroke();
    g.fillStyle = `rgba(${C.yellow},0.75)`;
    for (const e of [-1, 1]) g.fillRect(sx + e * sr * 0.32 - lw / 2, sy - sr * 0.3, lw, lw * 1.6);
    g.restore();
    // heart
    const hx = px(cx - 1.25);
    const hy = pz(cz + 4.6);
    const hs = m * 0.2;
    g.save();
    g.strokeStyle = `rgba(${C.pink},0.72)`;
    g.lineWidth = lw;
    g.beginPath();
    g.moveTo(hx, hy + hs);
    g.bezierCurveTo(hx - hs * 1.6, hy - hs * 0.2, hx - hs * 0.7, hy - hs * 1.3, hx, hy - hs * 0.4);
    g.bezierCurveTo(hx + hs * 0.7, hy - hs * 1.3, hx + hs * 1.6, hy - hs * 0.2, hx, hy + hs);
    g.stroke();
    g.restore();
    // arrow towards the bakery (north-east)
    const ax0 = px(cx + 4.1);
    const ay0 = pz(cz + 3.0);
    const ax1 = px(cx + 4.9);
    const ay1 = pz(cz + 2.1);
    chalkLine(ax0, ay0, ax1, ay1, C.blue!, lw);
    chalkLine(ax1, ay1, ax1 - m * 0.3, ay1 + m * 0.02, C.blue!, lw);
    chalkLine(ax1, ay1, ax1 - m * 0.02, ay1 + m * 0.3, C.blue!, lw);
  }
  // Fade out at the decal's round edge (no visible square).
  g.globalCompositeOperation = 'destination-in';
  const edge = g.createRadialGradient(S / 2, S / 2, S * 0.38, S / 2, S / 2, S * 0.5);
  edge.addColorStop(0, 'rgba(0,0,0,1)');
  edge.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = edge;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The plaza wear decal centred on (cx, cz), radius R, draped on the terrain. */
export function buildPlazaWear(cx: number, cz: number, R: number, heightAt: (x: number, z: number) => number): THREE.Mesh {
  const N = 48;
  const geo = new THREE.PlaneGeometry(2 * R, 2 * R, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx;
    const z = pos.getZ(i) + cz;
    pos.setXYZ(i, x, heightAt(x, z) + 0.018, z);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ map: wearTexture(cx, cz, R), transparent: true, depthWrite: false, roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mat.name = 'plaza-wear';
  const m = new THREE.Mesh(geo, mat);
  m.name = 'plaza-wear';
  m.renderOrder = 1;
  m.receiveShadow = true;
  m.castShadow = false;
  m.userData.perfTag = 'terrain';
  m.userData.noAO = true;
  return m;
}

/**
 * r13: two rain puddles in the low spots of the square (south-east and south-west of the basin) —
 * dark, near-mirror patches that pick up the sky and the lamps (the scene's environment map), with a
 * damp halo round each. One merged mesh, one draw; hidden with the wear decal in winter.
 */
export function buildPlazaPuddles(cx: number, cz: number, heightAt: (x: number, z: number) => number): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const spots: [number, number, number, number, number][] = [
    [cx + 3.9, cz + 5.6, 0.95, 0.55, 0.4],
    [cx - 4.6, cz + 4.4, 0.7, 0.42, -0.6],
    [cx - 3.7, cz + 5.15, 0.32, 0.22, 0.2],
  ];
  for (const [x, z, rx, rz, rot] of spots) {
    const n = 22;
    const shape = new THREE.Shape();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const wob = 1 + 0.16 * Math.sin(a * 3 + x) + 0.08 * Math.sin(a * 5 + z);
      const px = Math.cos(a) * rx * wob;
      const pz = Math.sin(a) * rz * wob;
      if (i === 0) shape.moveTo(px, pz);
      else shape.lineTo(px, pz);
    }
    const g = new THREE.ShapeGeometry(shape, 2);
    g.rotateX(-Math.PI / 2);
    g.rotateY(rot);
    g.translate(x, heightAt(x, z) + 0.022, z);
    parts.push(g);
  }
  const geo = mergeGeos(parts);
  const mat = new THREE.MeshStandardMaterial({ name: 'puddle', color: 0x3a4652, roughness: 0.04, metalness: 0.35, transparent: true, opacity: 0.86, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const m = new THREE.Mesh(geo, mat);
  m.name = 'plaza-puddles';
  m.renderOrder = 2;
  m.receiveShadow = true;
  m.userData.perfTag = 'terrain';
  m.userData.noAO = true;
  return m;
}

function mergeGeos(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.index ? p.index.count : p.attributes.position!.count;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    const q = p.index ? p.toNonIndexed() : p;
    const a = q.attributes.position!.array as Float32Array;
    pos.set(a, o);
    o += a.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  for (const p of parts) p.dispose();
  return g;
}
