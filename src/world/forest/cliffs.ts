/**
 * Cindergrove's waterfall cliff.
 *
 *  - CLIFF_STRATA_GLSL: hand-cut layered sandstone / slate shading (beds of varying thickness, a
 *    2-octave domain warp, fracture columns, water stains, moss tongues, snow on the ledges). Shared by
 *    the terrain's steep faces and the cliff wall below.
 *  - buildCliffWall: a dedicated rock-face mesh laid over the plateau's south face. A steep face
 *    sampled on the 0.5 m terrain grid folds into saw-tooth facets (the "zig-zag bands"); this wall
 *    follows a smoothed contour instead, bulges and overhangs with layered noise, tucks its top edge
 *    under the plateau lip and sinks its foot into the ground.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { Noise2D } from '../../core/noise';
import { applyWorldFx } from '../../render/worldfx';
import { patchMaterial, after, before } from '../../render/patch';
import { forestMoss } from './rocks';
import type { Terrain } from '../terrain';

/** Needs (declared by the caller): uniform vec3 uMossC; uniform float uSnow; NOISE_GLSL. */
export const CLIFF_STRATA_GLSL = /* glsl */ `
vec3 hvCliffStrata(vec3 p, vec3 n, float along) {
  // 2-octave domain warp: beds dip, pinch and swell along the face (horizontal banding dominates).
  float w1 = hvNoise(vec2(along * 0.09, p.y * 0.05)) - 0.5;
  float w2 = hvNoise(vec2(along * 0.33 + 3.7, p.y * 0.12 + 1.3)) - 0.5;
  float s = p.y + w1 * 1.0 + w2 * 0.32 + along * 0.03;
  // Faulted blocks: the face is cut into 1.6-3 m columns and each column slumps / rises by up to
  // ±0.45 m, so bed lines step at the joints instead of running as unbroken stripes (no lasagna).
  float colA = along * 0.42 + (hvNoise(vec2(along * 0.21, p.y * 0.3 + 2.0)) - 0.5) * 0.6;
  float colC = floor(colA);
  float slump = (hvHash12(vec2(colC, 1.9)) - 0.5) * 0.9 * step(0.35, hvHash12(vec2(colC, 7.3)));
  // ...and every third one sags on its outer edge (a tilted, settled block).
  slump += (fract(colA) - 0.5) * 0.5 * step(0.66, hvHash12(vec2(colC, 4.4)));
  s += slump;
  // Coarse 1.6 m beds, each split into 2-3 sub-beds at random heights: from ~0.3 m shale partings
  // to 1.3 m massive sandstone (no two neighbouring bands the same thickness).
  float bi0 = floor(s / 1.6);
  float bf0 = fract(s / 1.6);
  float a1 = 0.18 + 0.5 * hvHash12(vec2(bi0, 5.3));
  float a2 = a1 + 0.18 + 0.4 * hvHash12(vec2(bi0, 6.1));
  float three = step(0.45, hvHash12(vec2(bi0, 2.1))) * step(a2, 0.88);
  float sub;
  float f;
  if (bf0 < a1) { sub = 0.0; f = bf0 / a1; }
  else if (three > 0.5 && bf0 < a2) { sub = 1.0; f = (bf0 - a1) / (a2 - a1); }
  else { float lo = three > 0.5 ? a2 : a1; sub = 1.0 + three; f = (bf0 - lo) / (1.0 - lo); }
  float layer = bi0 * 3.0 + sub;
  float lr = hvHash12(vec2(layer, 3.7));
  vec3 c = mix(vec3(0.15, 0.13, 0.105), vec3(0.27, 0.23, 0.18), lr);
  c = mix(c, vec3(0.15, 0.16, 0.175), step(0.7, hvHash12(vec2(layer, 9.1))) * 0.75);
  // Fracture columns: joints every ~1.2-2.5 m, wandering a little, continuing through 1-3 beds.
  float ja = along * 0.52 + (hvNoise(vec2(along * 0.3, p.y * 0.35)) - 0.5) * 0.5 + floor(layer / 3.0) * 0.37;
  float jcell = floor(ja);
  float jd = abs(fract(ja) - 0.5);
  float jon = step(0.3, hvHash12(vec2(jcell, floor(layer / 2.0))));
  // Each block between joints gets its own value + a lit / shaded side.
  c *= 0.86 + 0.24 * hvHash12(vec2(jcell, layer));
  c *= 1.0 - smoothstep(0.5, 0.36, jd) * 0.08 * sign(fract(ja) - 0.5);
  c *= 1.0 - smoothstep(0.035, 0.0, 0.5 - jd) * 0.55 * jon;
  // The fault seams between slumped columns: a deep vertical crack through every bed.
  float cd = min(fract(colA), 1.0 - fract(colA));
  c *= 1.0 - smoothstep(0.045, 0.0, cd) * 0.62;
  // Each bed: a lit, weathered lip on top and a deep undercut shadow at its base.
  c *= 0.78 + 0.36 * smoothstep(0.05, 0.92, f);
  c *= 1.0 - smoothstep(0.16, 0.0, f) * 0.5;
  c = mix(c, c * vec3(1.18, 1.14, 1.05), smoothstep(0.88, 0.99, f) * 0.6);
  // Grain + tiny pits.
  c *= 0.9 + 0.2 * hvNoise(vec2(along * 5.0, p.y * 6.5));
  // Dark water stains running down the face (vertical, breaks the banding).
  float stain = smoothstep(0.58, 0.82, hvNoise(vec2(along * 1.3 + 17.0, p.y * 0.08)));
  c *= 1.0 - stain * 0.32;
  // Moss cushions on the ledge tops + ivy / moss tongues dripping down from them.
  float mn = hvFbm(vec2(along * 0.6, p.y * 0.8) + 11.0);
  float moss = smoothstep(0.66, 0.95, f + (mn - 0.5) * 0.45) * smoothstep(0.3, 0.62, mn);
  float tongue = smoothstep(0.58, 0.84, hvNoise(vec2(along * 2.6, layer * 1.9))) * smoothstep(0.05 + 0.6 * hvNoise(vec2(along * 4.1, layer)), 0.95, f);
  // Long moss drips spilling from a ledge down across the bed below (vertical: breaks the bands).
  float drip = smoothstep(0.7, 0.9, hvNoise(vec2(along * 1.7 + 5.0, 0.0))) * smoothstep(0.035, 0.0, abs(fract(along * 1.7) - 0.5) - 0.12 * hvNoise(vec2(along * 3.0, p.y * 1.1))) * smoothstep(0.2, 0.85, hvNoise(vec2(along * 0.9, p.y * 0.45 + 3.0)));
  tongue = max(tongue, drip * 0.85);
  float m = clamp(max(moss, tongue * 0.9), 0.0, 1.0);
  c = mix(c, uMossC * (0.55 + 0.55 * mn), m * 0.8);
  // Winter: snow on every ledge top and in the joints.
  float ledge = smoothstep(0.7, 0.93, f + (mn - 0.5) * 0.3) + smoothstep(0.3, 0.9, n.y) * 0.8;
  c = mix(c, vec3(0.6, 0.65, 0.74), clamp(ledge, 0.0, 1.0) * smoothstep(0.3, 0.85, uSnow));
  return c;
}
`;

let _wallMat: THREE.MeshStandardMaterial | null = null;
function cliffWallMaterial(): THREE.MeshStandardMaterial {
  if (_wallMat) return _wallMat;
  _wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, color: 0xffffff });
  _wallMat.name = 'cliffWall';
  applyWorldFx(_wallMat, { snowUp: 0.5 });
  patchMaterial(_wallMat, 'cliff-wall-strata', (shader) => {
    shader.uniforms.uMossC = forestMoss;
    let fs = shader.fragmentShader;
    fs = before(fs, 'void main() {', `uniform vec3 uMossC;\n${CLIFF_STRATA_GLSL}`);
    // Same albedo as the terrain's rock (vertex colour = baked AO).
    fs = after(fs, '#include <color_fragment>', 'diffuseColor.rgb *= hvCliffStrata(vHvWorldPos, normalize(vHvWorldNormal), vHvWorldPos.x + vHvWorldPos.z * 0.25);');
    shader.fragmentShader = fs;
  });
  return _wallMat;
}

export interface CliffSpan {
  x0: number;
  x1: number;
  /** z of the plateau lip (search starts north of it). */
  lipZ: number;
  topY: number;
}

/**
 * Rock wall over the plateau's south face between x0..x1. Returns the mesh and the smoothed face
 * line (x, z of the top edge, z of the foot, outward normal) for dressing.
 */
export function buildCliffWall(terrain: Terrain, rng: Rng, span: CliffSpan): { mesh: THREE.Mesh; line: { x: number; zTop: number; zBot: number; yBot: number }[] } {
  const n1 = new Noise2D(Math.floor(rng.next() * 1e9));
  const n2 = new Noise2D(Math.floor(rng.next() * 1e9));
  const step = 0.25;
  const raw: { x: number; zTop: number; zBot: number; yBot: number }[] = [];
  for (let x = span.x0; x <= span.x1 + 1e-6; x += step) {
    let zTop = NaN;
    let zBot = NaN;
    for (let z = span.lipZ - 6; z < span.lipZ + 9; z += 0.05) {
      const h = terrain.heightAt(x, z);
      if (isNaN(zTop) && h < span.topY - 0.45) zTop = z;
      if (!isNaN(zTop)) {
        const ahead = terrain.heightAt(x, z + 0.5);
        if (h - ahead < 0.12) {
          zBot = z;
          break;
        }
      }
    }
    if (isNaN(zTop) || isNaN(zBot)) {
      raw.push({ x, zTop: NaN, zBot: NaN, yBot: NaN });
      continue;
    }
    raw.push({ x, zTop, zBot, yBot: terrain.heightAt(x, zBot + 0.4) });
  }
  // Smooth the contour (±1 m moving average): no staircase from the grid or the march.
  const line = raw.map((p, i) => {
    if (isNaN(p.zTop)) return p;
    let st = 0;
    let sb = 0;
    let sy = 0;
    let c = 0;
    for (let k = -4; k <= 4; k++) {
      const q = raw[i + k];
      if (!q || isNaN(q.zTop)) continue;
      st += q.zTop;
      sb += q.zBot;
      sy += q.yBot;
      c++;
    }
    return { x: p.x, zTop: st / c, zBot: sb / c, yBot: sy / c };
  });
  const NV = 12;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let cols = 0;
  const flush = (strip: typeof line): void => {
    if (strip.length < 3) return;
    const base = pos.length / 3;
    for (let i = 0; i < strip.length; i++) {
      const p = strip[i]!;
      const prev = strip[Math.max(0, i - 1)]!;
      const next = strip[Math.min(strip.length - 1, i + 1)]!;
      // Outward (downhill) horizontal normal of the contour.
      let ox = -(next.zTop - prev.zTop);
      let oz = next.x - prev.x;
      const ol = Math.hypot(ox, oz) || 1;
      ox /= ol;
      oz /= ol;
      // Ends of a strip taper into the terrain (no hard vertical edge).
      const endK = Math.min(1, i / 6, (strip.length - 1 - i) / 6);
      for (let j = 0; j <= NV + 1; j++) {
        let x: number;
        let y: number;
        let z: number;
        let ao: number;
        if (j === 0) {
          // Top tuck: curls back under the plateau lip.
          x = p.x;
          y = span.topY - 0.32;
          z = p.zTop - 0.75;
          ao = 0.75;
        } else {
          const v = (j - 1) / NV;
          const yTop = span.topY - 0.18;
          const yBot = p.yBot - 0.45;
          y = THREE.MathUtils.lerp(yTop, yBot, v);
          const zz = THREE.MathUtils.lerp(p.zTop - 0.12, p.zBot + 0.35, Math.pow(v, 1.15));
          // Bulges: a broad belly, lumpy rock masses, crisp little overhang lips at bed boundaries.
          const lump = (n1.fbm(p.x * 0.32, y * 0.42, 2) * 0.5) * 0.5 + (n2.get(p.x * 1.1, y * 1.25)) * 0.14;
          // Lips wander in height and strength along the face (never one continuous shelf line).
          const lipPh = y * 0.72 + n2.get(p.x * 0.3, 3.1) * 1.3;
          const lip = Math.pow(1 - (lipPh - Math.floor(lipPh)), 3) * 0.2 * THREE.MathUtils.clamp(0.35 + n1.get(p.x * 0.25, 9.3 + Math.floor(lipPh) * 1.7) * 1.4, 0, 1.4);
          const belly = Math.sin(Math.PI * v) * 0.22;
          const push = (0.16 + belly + lump + lip) * endK * (j === NV + 1 ? 0.3 : 1);
          x = p.x + ox * push;
          z = zz + oz * push;
          ao = (0.55 + 0.45 * (1 - v)) * (0.78 + 0.22 * THREE.MathUtils.clamp(0.5 + lump * 2.2, 0, 1)) * (0.85 + 0.15 * THREE.MathUtils.clamp(lip * 5, 0, 1));
        }
        pos.push(x, y, z);
        col.push(ao, ao, ao);
      }
    }
    const W = NV + 2;
    for (let i = 0; i < strip.length - 1; i++) {
      for (let j = 0; j < W - 1; j++) {
        const a = base + i * W + j;
        const b = a + W;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    cols += strip.length;
  };
  let cur: typeof line = [];
  for (const p of line) {
    if (isNaN(p.zTop)) {
      flush(cur);
      cur = [];
    } else cur.push(p);
  }
  flush(cur);
  void cols;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, cliffWallMaterial());
  mesh.name = 'cliff-wall';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.perfTag = 'terrain';
  return { mesh, line: line.filter((p) => !isNaN(p.zTop)) };
}
