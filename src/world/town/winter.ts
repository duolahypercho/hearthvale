/**
 * Winter dressing for the town: snowmen the village children built (each a little different:
 * knitted hat or flowerpot hat, scarf colour, twig arms waving or drooping, a lopsided head), and
 * winter goods on the produce stands (burlap lids over the fruit, firewood, preserves, wool).
 * Everything is one merged 'white' mesh (colours in vertex tints), shown only in winter.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { MeshBuilder, lumpySphere, bevelCylinder, mat } from '../geom';
import { textures } from '../../render/textures';
import { patchMaterial, after, before } from '../../render/patch';

const SNOW = 0xeef2f7;

/** A snowman at (x, y, z) facing `rot` (+Z front) into builder `b`. */
function snowman(b: MeshBuilder, rng: Rng, x: number, y: number, z: number, rot: number, style: number): void {
  const R = new THREE.Matrix4().makeRotationY(rot);
  const T = new THREE.Matrix4().makeTranslation(x, y, z);
  // (r13 critic: "the snowmen are tiny" next to chibi villagers — built 1.6x, about a villager's height)
  const W = T.multiply(R).multiply(new THREE.Matrix4().makeScale(1.6, 1.6, 1.6));
  const add = (geo: THREE.BufferGeometry, m: THREE.Matrix4, tint: number): void => {
    b.add('white', geo, W.clone().multiply(m), { tint });
  };
  const r0 = 0.44;
  const r1 = 0.33;
  const r2 = 0.24;
  const y0 = r0 * 0.82;
  const y1 = y0 + r0 * 0.72 + r1 * 0.72;
  const y2 = y1 + r1 * 0.74 + r2 * 0.78;
  const lean = (rng.next() - 0.5) * 0.12;
  const s0 = lumpySphere(r0, 2, 0.06, rng, 1.4);
  s0.scale(1.04, 0.9, 1.0);
  add(s0, mat(0, y0, 0), SNOW);
  add(lumpySphere(r1, 2, 0.05, rng, 1.5), mat(0.02, y1, 0, 0, 0, lean), SNOW);
  const hx = Math.sin(-lean) * 0.1;
  add(lumpySphere(r2, 2, 0.04, rng, 1.6), mat(hx, y2, 0.01, 0, 0, lean * 1.6), SNOW);
  // Snow skirt where the base meets the ground.
  const skirt = lumpySphere(r0 * 1.25, 1, 0.08, rng, 1.2);
  skirt.scale(1, 0.18, 1);
  add(skirt, mat(0, 0.02, 0), SNOW);
  // Coal eyes + smile, carrot nose.
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.028, 6, 5), mat(hx + s * 0.085, y2 + 0.06, r2 * 0.92), 0x1c1a1a);
  for (let i = 0; i < 5; i++) {
    const a = -0.55 + (i / 4) * 1.1;
    add(new THREE.SphereGeometry(0.017, 5, 4), mat(hx + Math.sin(a) * 0.11, y2 - 0.07 + Math.cos(a * 1.2) * 0.02 - 0.02, r2 * 0.93 - Math.abs(a) * 0.03), 0x1c1a1a);
  }
  const nose = new THREE.ConeGeometry(0.035, 0.2, 7);
  nose.rotateX(Math.PI / 2);
  add(nose, mat(hx, y2 + 0.0, r2 + 0.08, 0.15 * (rng.next() - 0.5), 0, 0), 0xf07a2a);
  // Coal buttons down the middle ball.
  for (let i = 0; i < 3; i++) add(new THREE.SphereGeometry(0.03, 6, 5), mat(0.02, y1 + 0.14 - i * 0.13, r1 * 0.95 - Math.abs(i - 1) * 0.02), 0x1c1a1a);
  // Scarf: a wrap and a hanging tail.
  const scarfC = [0xd8443a, 0x3f7fb0, 0x4a9a5a][style % 3]!;
  const wrap = new THREE.TorusGeometry(r2 * 0.9, 0.055, 6, 16);
  wrap.rotateX(Math.PI / 2);
  add(wrap, mat(hx * 0.5, y2 - r2 * 0.72, 0, 0.1, 0, 0), scarfC);
  const tail = bevelCylinder(0.06, 0.06, 0.34, 0.02, 6);
  tail.scale(1, 1, 0.45);
  add(tail, mat(0.12, y2 - r2 * 0.72 - 0.18, r2 * 0.72, 0.2, 0, 0.25), scarfC);
  // Twig arms (three-pronged), one raised in a wave for the second snowman.
  for (const s of [-1, 1]) {
    const up = style % 2 === 1 && s === 1 ? 0.9 : 0.25;
    const arm = new THREE.CylinderGeometry(0.014, 0.022, 0.55, 5);
    arm.translate(0, 0.275, 0);
    add(arm, mat(s * r1 * 0.85, y1 + 0.06, 0, 0, 0, -s * (Math.PI / 2 - up)), 0x5a3a24);
    const tipX = s * (r1 * 0.85 + Math.cos(up) * 0.55);
    const tipY = y1 + 0.06 + Math.sin(up) * 0.55;
    for (const f of [-0.5, 0.5]) {
      const tw = new THREE.CylinderGeometry(0.008, 0.012, 0.16, 4);
      tw.translate(0, 0.08, 0);
      add(tw, mat(tipX - s * 0.02, tipY - 0.02, 0, 0, 0, -s * (Math.PI / 2 - up) + f), 0x5a3a24);
    }
  }
  // Hat: a knitted bobble hat, or an upturned flowerpot.
  if (style % 2 === 0) {
    const hat = new THREE.SphereGeometry(r2 * 0.98, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    add(hat, mat(hx, y2 + r2 * 0.25, 0, -0.12, 0, lean * 1.6), 0xc8443a);
    const band = new THREE.TorusGeometry(r2 * 0.97, 0.035, 5, 16);
    band.rotateX(Math.PI / 2);
    add(band, mat(hx, y2 + r2 * 0.27, 0, -0.12, 0, lean * 1.6), 0xf2ead8);
    add(lumpySphere(0.06, 1, 0.1, rng), mat(hx - 0.02, y2 + r2 * 1.25, -0.03), 0xf2ead8);
  } else {
    add(bevelCylinder(0.12, 0.16, 0.2, 0.02, 12), mat(hx, y2 + r2 * 0.95, -0.01, -0.1, 0, 0.12), 0xb8643e);
    add(bevelCylinder(0.175, 0.175, 0.04, 0.012, 12), mat(hx, y2 + r2 * 0.82, -0.01, -0.1, 0, 0.12), 0xa8563a);
  }
}

/** Snowmen at [x, z, rot] (terrain height via `h`). */
/**
 * Winter goods on a produce-crate stand (same footprint as buildProduceCrates): burlap lids over the
 * summer fruit, split firewood, jars of preserves and skeins of wool, a crust of snow on the lids.
 */
function winterGoods(b: MeshBuilder, rng: Rng, x: number, y: number, z: number, rot: number): void {
  const W = new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationY(rot));
  const add = (geo: THREE.BufferGeometry, m: THREE.Matrix4, tint: number): void => {
    b.add('white', geo, W.clone().multiply(m), { tint });
  };
  for (let c = 0; c < 3; c++) {
    const cx = c === 1 ? 0 : (c - 1) * 0.62;
    const cy = c === 1 ? 0.5 : 0;
    const cz = c === 1 ? 0.05 : 0;
    const top = cy + 0.4;
    add(new THREE.BoxGeometry(0.6, 0.05, 0.5), mat(cx, top, cz, 0, (rng.next() - 0.5) * 0.08, 0), 0xb89a6a);
    if (c === 0) {
      // Split firewood, two rows.
      for (let i = 0; i < 5; i++) {
        const log = new THREE.CylinderGeometry(0.058, 0.062, 0.46, 7);
        log.rotateX(Math.PI / 2);
        add(log, mat(cx - 0.19 + (i % 3) * 0.13 + (i > 2 ? 0.065 : 0), top + 0.08 + (i > 2 ? 0.1 : 0), cz), i % 2 ? 0x8a5a3a : 0x9a6a44);
        const end = new THREE.CircleGeometry(0.052, 7);
        add(end, mat(cx - 0.19 + (i % 3) * 0.13 + (i > 2 ? 0.065 : 0), top + 0.08 + (i > 2 ? 0.1 : 0), cz + 0.232), 0xe0c08a);
      }
    } else if (c === 1) {
      // Jars of preserves with cloth caps.
      const jar = [0xc8412f, 0xe8a03a, 0x7a3a6a, 0xc8412f, 0x5a8a3a, 0xe8a03a];
      for (let i = 0; i < 6; i++) {
        const jx = cx - 0.16 + (i % 3) * 0.16;
        const jz = cz - 0.08 + Math.floor(i / 3) * 0.17;
        add(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 10), mat(jx, top + 0.095, jz), jar[i]!);
        add(new THREE.CylinderGeometry(0.072, 0.066, 0.03, 10), mat(jx, top + 0.175, jz), i % 2 ? 0xf2e6d0 : 0xd8573e);
      }
    } else {
      // Skeins of wool.
      const wool = [0xe8e0d0, 0x3f6f9a, 0xc8412f, 0xe8b04a, 0x5a8a4a];
      for (let i = 0; i < 5; i++) {
        const sk = lumpySphere(0.085, 1, 0.12, rng, 2);
        sk.scale(1.15, 0.85, 1);
        add(sk, mat(cx - 0.17 + (i % 3) * 0.17 + (i > 2 ? 0.085 : 0), top + 0.08 + (i > 2 ? 0.1 : 0), cz + (i > 2 ? 0 : 0.04)), wool[i]!);
      }
    }
    // A crust of snow along the lid's back edge.
    const crust = lumpySphere(0.16, 1, 0.12, rng, 1.6);
    crust.scale(1.7, 0.28, 0.6);
    add(crust, mat(cx, top + 0.04, cz - 0.19), SNOW);
  }
}

export function buildSnowmen(rng: Rng, spots: [number, number, number][], h: (x: number, z: number) => number, goods: [number, number, number][] = []): THREE.Group {
  const b = new MeshBuilder();
  spots.forEach(([x, z, rot], i) => snowman(b, rng, x, h(x, z) - 0.04, z, rot, i));
  for (const [x, z, rot] of goods) winterGoods(b, rng, x, h(x, z), z, rot);
  const g = b.build({ name: 'snowmen' });
  g.userData.perfTag = 'props';
  return g;
}

/**
 * Swept lanes: in winter the townsfolk shovel the cobbles clear. A thin overlay following the
 * street mask (same cobble texture + UV scale as the terrain's paths) sits just above the snowed
 * terrain; its ragged, noise-broken alpha edge leaves slush and snow in the joints and at the
 * margins. Shown only in winter; one draw, no shadow casting.
 */
export function buildSweptPaths(
  bounds: { x0: number; z0: number; x1: number; z1: number },
  street: (x: number, z: number) => number,
  height: (x: number, z: number) => number,
  noise: (x: number, z: number) => number,
  pathScale: number,
): THREE.Mesh {
  const step = 0.5;
  const nx = Math.round((bounds.x1 - bounds.x0) / step) + 1;
  const nz = Math.round((bounds.z1 - bounds.z0) / step) + 1;
  const alpha = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = bounds.x0 + i * step;
      const z = bounds.z0 + j * step;
      const sv = street(x, z);
      if (sv <= 0.05) continue;
      const n = noise(x, z);
      alpha[j * nx + i] = THREE.MathUtils.clamp(THREE.MathUtils.smoothstep(sv, 0.42 + n * 0.12, 0.85) * (0.8 + 0.2 * n), 0, 1);
    }
  }
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const map = new Int32Array(nx * nz).fill(-1);
  const vert = (i: number, j: number): number => {
    const k = j * nx + i;
    if (map[k]! >= 0) return map[k]!;
    const x = bounds.x0 + i * step;
    const z = bounds.z0 + j * step;
    map[k] = pos.length / 3;
    pos.push(x, height(x, z) + 0.025, z);
    uv.push(x * pathScale, z * pathScale);
    const a = alpha[k]!;
    col.push(1, 1, 1, a);
    return map[k]!;
  };
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = alpha[j * nx + i]! + alpha[j * nx + i + 1]! + alpha[(j + 1) * nx + i]! + alpha[(j + 1) * nx + i + 1]!;
      if (a < 0.02) continue;
      const v00 = vert(i, j);
      const v10 = vert(i + 1, j);
      const v01 = vert(i, j + 1);
      const v11 = vert(i + 1, j + 1);
      idx.push(v00, v01, v10, v10, v01, v11);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  const tex = textures.cobble();
  // Cold, damp cobbles: a touch darker and bluer than the dry summer lanes, a little glossy.
  const m = new THREE.MeshStandardMaterial({
    name: 'sweptCobble',
    map: tex.map,
    color: 0xb4bcc8,
    roughness: 0.62,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  // r17 (critic: "the plaza is bare grey cobble while it is snowing"): the overnight fall still lies in
  // the joints and in a thin uneven dusting over the swept setts (the stones' worn crowns show through),
  // so the lanes read as swept snow, not a summer street under a white rug.
  patchMaterial(m, 'town-swept-dust', (shader) => {
    let fs = shader.fragmentShader;
    fs = before(
      fs,
      'void main() {',
      /* glsl */ `float hvSwH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hvSwN(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hvSwH(i), hvSwH(i + vec2(1.0, 0.0)), f.x), mix(hvSwH(i + vec2(0.0, 1.0)), hvSwH(i + vec2(1.0, 1.0)), f.x), f.y);
}`,
    );
    fs = after(
      fs,
      '#include <map_fragment>',
      /* glsl */ `
      {
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        float joint = 1.0 - smoothstep(0.06, 0.12, lum); // (linear: setts ≈ 0.18, joints ≈ 0.05)
        vec2 q = vMapUv;
        float dust = smoothstep(0.42, 0.78, hvSwN(q * 0.9) * 0.65 + hvSwN(q * 3.1 + 7.0) * 0.35);
        float k = clamp(joint * 0.8 + dust * 0.55, 0.0, 0.88);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.98), k);
      }`,
    );
    shader.fragmentShader = fs;
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'swept-paths';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.userData.perfTag = 'terrain';
  mesh.userData.noAO = true;
  return mesh;
}

/**
 * Seasonal dressing for the Lantern Hall's door wreath (the holly wreath with red berries is the
 * winter one): spring tucks blossoms and a pastel ribbon into it, summer daisies and sunflowers,
 * fall russet leaves, rose hips and little gourds. One small merged mesh per season; `at` = the
 * wreath centre in world space (the doors face +Z).
 */
export function buildWreathDressing(rng: Rng, at: THREE.Vector3): Record<'spring' | 'summer' | 'fall', THREE.Group> {
  const mk = (season: 'spring' | 'summer' | 'fall'): THREE.Group => {
    const b = new MeshBuilder();
    const add = (geo: THREE.BufferGeometry, m: THREE.Matrix4, tint: number): void => {
      b.add('white', geo, new THREE.Matrix4().makeTranslation(at.x, at.y, at.z).multiply(m), { tint });
    };
    const pal = season === 'spring' ? [0xff9ab8, 0xfff2f6, 0xffd166, 0xc8a0f0] : season === 'summer' ? [0xfff6e0, 0xffc83a, 0xfff6e0, 0x8ab8f0] : [0xd8642a, 0xb8401e, 0xe8a03a, 0x8a3a1e];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.2;
      const r = 0.3 + (rng.next() - 0.5) * 0.04;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      const c = pal[i % pal.length]!;
      if (season === 'fall') {
        // Russet leaves (flattened, tilted) with a rose hip or a tiny gourd every third.
        const leaf = lumpySphere(0.09, 0, 0.25, rng, 1.2);
        leaf.scale(1.3, 0.8, 0.35);
        add(leaf, mat(x, y, 0.1, 0, 0, a + 0.6), c);
        if (i % 3 === 0) add(new THREE.SphereGeometry(0.045, 8, 6), mat(x * 0.92, y * 0.92, 0.16, 0, 0, 0, 1.15, 0.9, 1), i % 2 ? 0xe8902a : 0xc8241e);
      } else {
        // A five-petal blossom (or a sunflower in summer) facing out of the door.
        const big = season === 'summer' && i % 4 === 1;
        const pr = big ? 0.05 : 0.035;
        for (let k = 0; k < 5; k++) {
          const pa = (k / 5) * Math.PI * 2;
          const pet = new THREE.SphereGeometry(pr, 6, 5);
          pet.scale(1, 0.7, 0.45);
          add(pet, mat(x + Math.cos(pa) * pr * 0.95, y + Math.sin(pa) * pr * 0.95, 0.12, 0, 0, pa), c);
        }
        add(new THREE.SphereGeometry(pr * 0.55, 6, 5), mat(x, y, 0.14), big ? 0x6a3a1e : 0xffd166);
      }
    }
    // A ribbon bow over the holly's red one, in the season's colour.
    const bow = season === 'spring' ? 0xb8a0e8 : season === 'summer' ? 0x5aa8d8 : 0xc8842a;
    for (const sx of [-1, 1]) add(new THREE.ConeGeometry(0.1, 0.22, 5), mat(sx * 0.085, -0.28, 0.13, 0, 0, sx * 1.2), bow);
    add(new THREE.SphereGeometry(0.055, 8, 6), mat(0, -0.28, 0.15), bow);
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.2, 0.012), mat(sx * 0.05, -0.4, 0.14, 0, 0, sx * 0.25), bow);
    const g = b.build({ name: `wreath-${season}` });
    g.userData.perfTag = 'props';
    g.traverse((o) => (o.castShadow = false));
    return g;
  };
  return { spring: mk('spring'), summer: mk('summer'), fall: mk('fall') };
}

/**
 * Winter wear (r9 critic: "the square remains pristine spring geometry painted white — no traffic-
 * compressed paths, slush, frozen public fixtures"): the villagers' daily routes (A* between their
 * winter schedule spots, `paths`) are rasterised into a traffic field. Where traffic is heavy the snow
 * is trodden to grey-brown slush (an alpha overlay over terrain + swept lanes); off the cobbles a trail
 * of boot prints follows each route (left / right, toe-out, pressed blue-grey), and both river banks
 * grow shelves of shore ice with a few loose floes. One merged mesh each.
 */
export function buildWinterWear(
  paths: { x: number; z: number }[][],
  height: (x: number, z: number) => number,
  street: (x: number, z: number) => number,
  river: { samples: THREE.Vector3[]; half: number; waterY: number; skip: (x: number, z: number) => boolean },
  rng: Rng,
  stands: { x: number; z: number }[] = [],
): THREE.Group {
  const out = new THREE.Group();
  out.name = 'town-winter-wear';
  // ── traffic field (0.5 m cells over the town)
  const X0 = -6;
  const Z0 = -2;
  const S = 0.5;
  const NX = 230;
  const NZ = 150;
  const traffic = new Float32Array(NX * NZ);
  const splat = (x: number, z: number, r: number, w: number): void => {
    const i0 = Math.max(0, Math.floor((x - r - X0) / S));
    const i1 = Math.min(NX - 1, Math.ceil((x + r - X0) / S));
    const j0 = Math.max(0, Math.floor((z - r - Z0) / S));
    const j1 = Math.min(NZ - 1, Math.ceil((z + r - Z0) / S));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(X0 + i * S - x, Z0 + j * S - z);
        if (d < r) traffic[j * NX + i] += w * (1 - d / r);
      }
  };
  const prints = new MeshBuilder();
  // (r13 critic: the prints read as scattered twigs) — each print is a pressed oval: a deep blue-grey
  // sole with a heel, inside a lighter packed-snow rim, ~0.13 x 0.26 m, in clear left / right rows.
  const printGeo = new THREE.CircleGeometry(0.07, 9);
  printGeo.rotateX(-Math.PI / 2);
  printGeo.scale(0.82, 1, 1.25);
  printGeo.translate(0, 0, 0.035);
  const heelGeo = new THREE.CircleGeometry(0.052, 8);
  heelGeo.rotateX(-Math.PI / 2);
  heelGeo.translate(0, 0, -0.075);
  const rimGeo = new THREE.CircleGeometry(0.1, 10);
  rimGeo.rotateX(-Math.PI / 2);
  rimGeo.scale(0.78, 1, 1.42);
  for (const p of paths) {
    let side = 1;
    let carry = 0;
    for (let k = 0; k + 1 < p.length; k++) {
      const a = p[k]!;
      const b = p[k + 1]!;
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 1e-3) continue;
      const dx = (b.x - a.x) / L;
      const dz = (b.z - a.z) / L;
      for (let t = 0; t < L; t += 0.35) splat(a.x + dx * t, a.z + dz * t, 1.1, 0.6);
      // Boot prints off the cobbles (the snow keeps them): a stride of 0.36 m, ±0.11 m to the side.
      const yaw = Math.atan2(dx, dz);
      for (let t = carry; t < L; t += 0.36) {
        const jx = (rng.next() - 0.5) * 0.05;
        const x = a.x + dx * t + dz * side * 0.11 + jx;
        const z = a.z + dz * t - dx * side * 0.11;
        side = -side;
        if (street(x, z) > 0.35 || rng.next() < 0.1) continue;
        const y = height(x, z);
        const r = yaw + side * 0.14;
        prints.add('white', rimGeo.clone(), mat(x, y + 0.028, z, 0, r), { tint: 0xf4f8ff });
        prints.add('white', printGeo.clone(), mat(x, y + 0.032, z, 0, r), { tint: 0x6a7c98 });
        prints.add('white', heelGeo.clone(), mat(x, y + 0.032, z, 0, r), { tint: 0x6a7c98 });
      }
      carry = 0.36 - ((L - carry) % 0.36);
    }
  }
  const pm = prints.build({ name: 'boot-prints' });
  pm.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = false;
    m.receiveShadow = true;
    // (own material: the merged 'white' one is shared with the snowmen)
    const mm = (m.material as THREE.MeshStandardMaterial).clone();
    m.material = mm;
    mm.transparent = true;
    mm.opacity = 0.86;
    mm.depthWrite = false;
    mm.polygonOffset = true;
    mm.polygonOffsetFactor = -3;
    mm.polygonOffsetUnits = -3;
  });
  pm.userData.noAO = true;
  out.add(pm);
  // Where people stand all day (shop steps, the board, the fountain rim) the snow is stamped to slush.
  for (const st of stands) splat(st.x + (rng.next() - 0.5) * 0.4, st.z + (rng.next() - 0.5) * 0.4, 1.5 + rng.next() * 0.5, 3.2);
  // ── slush: an alpha overlay where the traffic is heavy
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const vmap = new Int32Array(NX * NZ).fill(-1);
  const alphaAt = (i: number, j: number): number => {
    const t = traffic[j * NX + i]!;
    return THREE.MathUtils.smoothstep(t, 0.9, 4.5) * 0.78;
  };
  const vert = (i: number, j: number): number => {
    const k = j * NX + i;
    if (vmap[k]! >= 0) return vmap[k]!;
    const x = X0 + i * S;
    const z = Z0 + j * S;
    vmap[k] = pos.length / 3;
    pos.push(x, height(x, z) + 0.035, z);
    // grey-brown trodden slush, darker in the deepest ruts
    const a = alphaAt(i, j);
    const d = 0.62 - a * 0.25 + (rng.next() - 0.5) * 0.04;
    // (r16 critic: "grey dishwater slush" — warmed toward a brown-violet melt, wet and darker in the ruts)
    col.push(d * 1.04, d * 0.9, d * 0.92, a);
    return vmap[k]!;
  };
  for (let j = 0; j < NZ - 1; j++)
    for (let i = 0; i < NX - 1; i++) {
      if (alphaAt(i, j) + alphaAt(i + 1, j) + alphaAt(i, j + 1) + alphaAt(i + 1, j + 1) < 0.01) continue;
      const v00 = vert(i, j);
      const v10 = vert(i + 1, j);
      const v01 = vert(i, j + 1);
      const v11 = vert(i + 1, j + 1);
      idx.push(v00, v01, v10, v10, v01, v11);
    }
  if (idx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({ name: 'slush', color: 0x86706e, roughness: 0.3, metalness: 0, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2.5, polygonOffsetUnits: -2.5 }),
    );
    m.name = 'slush';
    m.receiveShadow = true;
    m.renderOrder = 2;
    m.userData.noAO = true;
    out.add(m);
  }
  // ── snow dusting (r13 critic: "the plaza is bare grey cobble while it is snowing"): a thin white
  // layer over the swept cobbles, broken by noise into drifts in the joints, cleared only where the
  // villagers' routes run — so the trodden lanes read against white.
  {
    const dpos: number[] = [];
    const dcol: number[] = [];
    const didx: number[] = [];
    const dmap = new Int32Array(NX * NZ).fill(-1);
    const hash = (i: number, j: number): number => {
      const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
      return h - Math.floor(h);
    };
    const dustAt = (i: number, j: number): number => {
      const x = X0 + i * S;
      const z = Z0 + j * S;
      const sv = street(x, z);
      if (sv < 0.3) return 0;
      const lane = THREE.MathUtils.smoothstep(traffic[j * NX + i]!, 0.35, 2.2);
      const n = 0.55 + 0.45 * Math.sin(x * 0.9 + Math.sin(z * 0.7) * 2) * Math.sin(z * 0.8 + x * 0.3);
      return THREE.MathUtils.smoothstep(sv, 0.3, 0.6) * (1 - lane) * THREE.MathUtils.clamp(0.42 + n * 0.4 + (hash(i, j) - 0.5) * 0.18, 0, 0.86);
    };
    const dv = (i: number, j: number): number => {
      const k = j * NX + i;
      if (dmap[k]! >= 0) return dmap[k]!;
      const x = X0 + i * S;
      const z = Z0 + j * S;
      dmap[k] = dpos.length / 3;
      dpos.push(x, height(x, z) + 0.03, z);
      dcol.push(0.95, 0.97, 1.0, dustAt(i, j));
      return dmap[k]!;
    };
    for (let j = 0; j < NZ - 1; j++)
      for (let i = 0; i < NX - 1; i++) {
        if (dustAt(i, j) + dustAt(i + 1, j) + dustAt(i, j + 1) + dustAt(i + 1, j + 1) < 0.02) continue;
        const v00 = dv(i, j);
        const v10 = dv(i + 1, j);
        const v01 = dv(i, j + 1);
        const v11 = dv(i + 1, j + 1);
        didx.push(v00, v01, v10, v10, v01, v11);
      }
    if (didx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(dcol, 4));
      g.setIndex(didx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: 'snowDust', color: 0xffffff, roughness: 0.85, metalness: 0, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2.2, polygonOffsetUnits: -2.2 }));
      m.name = 'snow-dust';
      m.receiveShadow = true;
      m.renderOrder = 1;
      m.userData.noAO = true;
      m.userData.perfTag = 'terrain';
      out.add(m);
    }
  }
  // ── shore ice: a ragged shelf along each bank, a few loose floes mid-stream
  const ice = new MeshBuilder();
  const sm = river.samples;
  for (const side of [-1, 1]) {
    const shelf: number[] = [];
    const sIdx: number[] = [];
    for (let k = 0; k < sm.length; k++) {
      const p = sm[k]!;
      const q = sm[Math.min(sm.length - 1, k + 1)]!;
      const o = sm[Math.max(0, k - 1)]!;
      let tx = q.x - o.x;
      let tz = q.z - o.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const nx = -tz * side;
      const nz = tx * side;
      const w = 0.45 + 0.65 * Math.abs(Math.sin(k * 0.37 + side)) + rng.next() * 0.25;
      const outer = river.half + 0.15;
      const inner = river.half - w;
      shelf.push(p.x + nx * outer, river.waterY + 0.035, p.z + nz * outer, p.x + nx * inner, river.waterY + 0.035, p.z + nz * inner);
      if (k > 0) {
        const b = (k - 1) * 2;
        if (!river.skip(p.x + nx * river.half, p.z + nz * river.half)) sIdx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(shelf, 3));
    g.setIndex(sIdx);
    g.computeVertexNormals();
    if (g.attributes.normal) for (let i = 0; i < g.attributes.normal.count; i++) g.attributes.normal.setXYZ(i, 0, 1, 0);
    ice.add('white', g, new THREE.Matrix4(), { tint: 0xdfeaf4 });
  }
  for (let i = 0; i < 26; i++) {
    const p = sm[Math.floor(rng.next() * sm.length)]!;
    const off = (rng.next() - 0.5) * river.half * 1.2;
    const x = p.x + off;
    const z = p.z + (rng.next() - 0.5) * 2;
    if (river.skip(x, z)) continue;
    // (r15: broken, irregular plates — the six-sided discs read as white hexagons)
    const sh = new THREE.Shape();
    const r0 = 0.25 + rng.next() * 0.35;
    const nv = 8 + Math.floor(rng.next() * 4);
    for (let v = 0; v < nv; v++) {
      const a = (v / nv) * Math.PI * 2 + (rng.next() - 0.5) * 0.4;
      const rr = r0 * (0.6 + rng.next() * 0.55);
      if (v === 0) sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    const f = new THREE.ShapeGeometry(sh);
    f.rotateX(-Math.PI / 2);
    f.scale(1, 1, 0.6 + rng.next() * 0.5);
    ice.add('white', f, mat(x, river.waterY + 0.03, z, 0, rng.next() * 6), { tint: 0xe8f0f8 });
  }
  // r15 (critic: "a more unmistakable frozen-river treatment"): wind-blown snow lying on the ice in
  // long streaks along the current, so the river reads as a frozen surface you could walk on.
  for (let i = 0; i < 34; i++) {
    const k = Math.floor(rng.next() * (sm.length - 2)) + 1;
    const p = sm[k]!;
    const q = sm[k + 1]!;
    const off = (rng.next() - 0.5) * river.half * 1.5;
    const tx = q.x - p.x;
    const tz = q.z - p.z;
    const tl = Math.hypot(tx, tz) || 1;
    const x = p.x + (-tz / tl) * off;
    const z = p.z + (tx / tl) * off;
    if (river.skip(x, z)) continue;
    const d = lumpySphere(0.5, 1, 0.3, rng, 1.6);
    d.scale(1.6 + rng.next() * 2.2, 0.012, 0.35 + rng.next() * 0.35);
    ice.add('white', d, mat(x, river.waterY + 0.04, z, 0, Math.atan2(tx, tz) - Math.PI / 2 + (rng.next() - 0.5) * 0.3), { tint: 0xf2f6fb });
  }
  // r18 (critic: "a more unmistakable frozen-river treatment"): the town uses the ice — skate tracks
  // carved in looping figure-eights and long glides, and an ice-fishing hole (black open water in a
  // slush collar, a pail beside it). Nobody skates on running water: the read is instant.
  const near = (x: number, z: number): number => {
    let bi = 1;
    let bd = Infinity;
    for (let k = 1; k < sm.length - 1; k++) {
      const d = Math.hypot(sm[k]!.x - x, sm[k]!.z - z);
      if (d < bd) [bd, bi] = [d, k];
    }
    return bi;
  };
  const frame = (k: number): { p: THREE.Vector3; tx: number; tz: number } => {
    const p = sm[k]!;
    const q = sm[Math.min(sm.length - 1, k + 1)]!;
    const o = sm[Math.max(0, k - 1)]!;
    const tl = Math.hypot(q.x - o.x, q.z - o.z) || 1;
    return { p, tx: (q.x - o.x) / tl, tz: (q.z - o.z) / tl };
  };
  const strip = (pts: [number, number][], w: number, tint: number): void => {
    const pos: number[] = [];
    const idx: number[] = [];
    let n = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(pts.length - 1, i + 1)]!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / l;
      const nz = (b[0] - a[0]) / l;
      const [x, z] = pts[i]!;
      if (river.skip(x, z)) {
        n = 0;
        continue;
      }
      const ww = w * (0.6 + 0.4 * Math.sin(i * 0.9) ** 2);
      const base = pos.length / 3;
      pos.push(x + nx * ww, river.waterY + 0.046, z + nz * ww, x - nx * ww, river.waterY + 0.046, z - nz * ww);
      // (both windings: the loops double back on themselves, so half of every strip faced down)
      if (n > 0) idx.push(base - 2, base - 1, base, base, base - 1, base + 1, base - 2, base, base - 1, base, base + 1, base - 1);
      n++;
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    for (let i = 0; i < g.attributes.normal!.count; i++) g.attributes.normal!.setXYZ(i, 0, 1, 0);
    ice.add('white', g, new THREE.Matrix4(), { tint });
  };
  // Sample `d` metres along the river from the Kettle Bridge (clear of the deck and its abutments).
  const kb = near(64.2, 25.3);
  const along = (d: number): number => {
    let k = kb;
    let acc = 0;
    const st = d < 0 ? -1 : 1;
    while (acc < Math.abs(d) && k + st > 0 && k + st < sm.length - 1) {
      acc += Math.hypot(sm[k + st]!.x - sm[k]!.x, sm[k + st]!.z - sm[k]!.z);
      k += st;
    }
    return k;
  };
  for (const [dist, A, B, turns] of [[-8.5, 2.6, 1.2, 2], [8, 2.1, 1.0, 1], [-15, 3.2, 1.4, 1]] as const) {
    const { p, tx, tz } = frame(along(dist));
    const nx = -tz;
    const nz = tx;
    for (let r = 0; r < turns + 1; r++) {
      const pts: [number, number][] = [];
      const ph = rng.next() * 0.4;
      const sA = A * (1 - r * 0.12);
      const sB = B * (1 + r * 0.18) * Math.min(1, river.half / 2.2);
      for (let i = 0; i <= 64; i++) {
        const t = (i / 64) * Math.PI * 2 + ph;
        // Gerono lemniscate (a skater's figure-eight) along the current, a little wobble per lap.
        const u = sA * Math.sin(t);
        const v = sB * Math.sin(t) * Math.cos(t) + 0.12 * Math.sin(t * 3 + r);
        pts.push([p.x + tx * u + nx * v, p.z + tz * u + nz * v]);
      }
      strip(pts, 0.03, 0xd2deec);
    }
    // A long glide in and out of the loops.
    const g: [number, number][] = [];
    const off = (rng.next() - 0.5) * river.half * 0.8;
    for (let i = 0; i <= 30; i++) {
      const u = -A * 2.6 + (i / 30) * A * 5.2;
      g.push([p.x + tx * u + nx * (off + Math.sin(i * 0.25) * 0.35), p.z + tz * u + nz * (off + Math.sin(i * 0.25) * 0.35)]);
    }
    strip(g, 0.024, 0xd8e3ef);
  }
  {
    // The ice-fishing hole: open black water, a cracked slush collar, a pail and its lid on the ice.
    const { p, tx, tz } = frame(along(-4.5));
    const hx = p.x + -tz * river.half * 0.35;
    const hz = p.z + tx * river.half * 0.35;
    if (!river.skip(hx, hz)) {
      const hole = new THREE.CircleGeometry(0.36, 16);
      hole.rotateX(-Math.PI / 2);
      ice.add('white', hole, mat(hx, river.waterY + 0.07, hz, 0, 0, 0), { tint: 0x0b1a28 });
      // (a ring of chipped slush round the hole, not a disc over it)
      const collar = new THREE.TorusGeometry(0.46, 0.12, 5, 18);
      collar.rotateX(Math.PI / 2);
      collar.scale(1.05, 0.35, 1);
      ice.add('white', collar, mat(hx, river.waterY + 0.06, hz), { tint: 0xd2dce8 });
      for (let k = 0; k < 5; k++) {
        const a = k * 1.3 + rng.next();
        const chip = lumpySphere(0.08 + rng.next() * 0.05, 1, 0.3, rng, 1.2);
        chip.scale(1, 0.4, 1);
        ice.add('white', chip, mat(hx + Math.cos(a) * 0.75, river.waterY + 0.06, hz + Math.sin(a) * 0.75), { tint: 0xe4ecf4 });
      }
      const pail = new THREE.CylinderGeometry(0.16, 0.13, 0.26, 10);
      ice.add('white', pail, mat(hx + tx * 0.7, river.waterY + 0.17, hz + tz * 0.7), { tint: 0x9a4a3a });
      const rim = new THREE.TorusGeometry(0.16, 0.018, 4, 12);
      rim.rotateX(Math.PI / 2);
      ice.add('white', rim, mat(hx + tx * 0.7, river.waterY + 0.3, hz + tz * 0.7), { tint: 0x6a6a72 });
      const fish = lumpySphere(0.12, 1, 0.2, rng, 1.2);
      fish.scale(1.8, 0.35, 0.55);
      ice.add('white', fish, mat(hx - tz * 0.55, river.waterY + 0.07, hz + tx * 0.55, 0, 0.6, 0), { tint: 0x8aa0b0 });
    }
  }
  const ig = ice.build({ name: 'shore-ice' });
  ig.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = false;
    m.receiveShadow = true;
    const mm = (m.material as THREE.MeshStandardMaterial).clone();
    m.material = mm;
    mm.roughness = 0.18;
    mm.transparent = true;
    mm.opacity = 0.88;
  });
  ig.userData.noAO = true;
  out.add(ig);
  out.userData.perfTag = 'terrain';
  return out;
}

/**
 * r12 (critic: "flat grey-white snow with weak, neutral shadows"; Stardew's winter gets its charm from
 * saturated cyan-blue shadows): a cold contact shade multiplied over the snow — a blurred blue pool
 * round every building (heavier on the north-east, the afternoon shadow side) and under every prop,
 * stall, bench and lamp. One draped decal over the town centre, one draw call, unlit multiply, winter only.
 */
export function buildWinterShade(
  region: { x0: number; z0: number; x1: number; z1: number },
  rects: [number, number, number, number][],
  props: { x: number; z: number; r: number }[],
  heightAt: (x: number, z: number) => number,
): THREE.Mesh {
  const W = region.x1 - region.x0;
  const D = region.z1 - region.z0;
  const ppm = 16;
  const c = document.createElement('canvas');
  c.width = Math.ceil(W * ppm);
  c.height = Math.ceil(D * ppm);
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  const X = (x: number): number => (x - region.x0) * ppm;
  const Z = (z: number): number => (z - region.z0) * ppm;
  // Buildings: a wide soft pool, pushed to the shadow side, then a tighter, deeper band at the walls.
  g.filter = `blur(${Math.round(ppm * 1.1)}px)`;
  g.fillStyle = 'rgb(150,184,232)';
  for (const [x0, z0, x1, z1] of rects) g.fillRect(X(x0 - 0.6 + 0.5), Z(z0 - 1.6), (x1 - x0 + 1.6) * ppm, (z1 - z0 + 2.0) * ppm);
  g.filter = `blur(${Math.round(ppm * 0.4)}px)`;
  g.fillStyle = 'rgb(128,168,226)';
  for (const [x0, z0, x1, z1] of rects) g.fillRect(X(x0 - 0.25), Z(z0 - 0.45), (x1 - x0 + 0.7) * ppm, (z1 - z0 + 0.6) * ppm);
  // Props: a blue contact pool under each, offset to the shadow side.
  g.filter = `blur(${Math.round(ppm * 0.35)}px)`;
  for (const p of props) {
    g.fillStyle = 'rgba(122,162,224,0.85)';
    g.beginPath();
    g.ellipse(X(p.x + p.r * 0.25), Z(p.z - p.r * 0.3), p.r * ppm, p.r * ppm * 0.8, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.filter = 'none';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const NX = Math.ceil(W / 1.2);
  const NZ = Math.ceil(D / 1.2);
  const geo = new THREE.PlaneGeometry(W, D, NX, NZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + region.x0 + W / 2;
    const z = pos.getZ(i) + region.z0 + D / 2;
    pos.setXYZ(i, x, heightAt(x, z) + 0.035, z);
  }
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  mat.name = 'winter-shade';
  const m = new THREE.Mesh(geo, mat);
  m.name = 'winter-shade';
  m.renderOrder = 1;
  m.userData.perfTag = 'terrain';
  m.userData.noAO = true;
  m.castShadow = m.receiveShadow = false;
  return m;
}
