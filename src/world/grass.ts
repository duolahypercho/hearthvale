/**
 * Instanced grass tufts with wind, player push, seasonal colour matching the terrain,
 * base AO and backlit tip translucency. Chunked (16×16 tiles) for culling and so tools
 * (scythe, hoe) can clear individual tiles: `grass.clearTile(x, z)`.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { globalUniforms } from '../render/uniforms';
import { NOISE_GLSL } from '../render/shaders/noise';
import { applyWind } from '../render/wind';
import { patchMaterial, after, before, replace } from '../render/patch';

const CHUNK = 16;

function tuftGeometry(rng: Rng, blades: number, variant: 'short' | 'tall'): THREE.BufferGeometry {
  const pos: number[] = [];
  const hAttr: number[] = [];
  const nor: number[] = [];
  const segs = variant === 'tall' ? 3 : 2;
  for (let b = 0; b < blades; b++) {
    const ang = rng.next() * Math.PI * 2;
    const r = rng.next() * 0.2;
    const bx = Math.cos(ang) * r;
    const bz = Math.sin(ang) * r;
    const height = (variant === 'tall' ? 0.5 : 0.28) * (0.65 + rng.next() * 0.7);
    const width = (variant === 'tall' ? 0.075 : 0.065) * (0.8 + rng.next() * 0.4);
    const face = rng.next() * Math.PI * 2;
    const lean = 0.12 + rng.next() * 0.3;
    const leanDir = ang + (rng.next() - 0.5) * 0.8;
    const fx = Math.cos(face);
    const fz = Math.sin(face);
    const pts: [number, number, number, number][] = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const y = t * height;
      const off = lean * t * t * height * 1.6;
      const cx = bx + Math.cos(leanDir) * off;
      const cz = bz + Math.sin(leanDir) * off;
      const w = width * (1 - t * 0.92) * 0.5;
      pts.push([cx, y, cz, w]);
    }
    for (let s = 0; s < segs; s++) {
      const [x0, y0, z0, w0] = pts[s]!;
      const [x1, y1, z1, w1] = pts[s + 1]!;
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      const a = [x0 - fx * w0, y0, z0 - fz * w0];
      const bb = [x0 + fx * w0, y0, z0 + fz * w0];
      const c = [x1 - fx * w1, y1, z1 - fz * w1];
      const d = [x1 + fx * w1, y1, z1 + fz * w1];
      if (s === segs - 1) {
        // Tip: a single triangle to the blade point.
        pos.push(...a, ...bb, x1, y1, z1);
        hAttr.push(t0, t0, t1);
      } else {
        pos.push(...a, ...bb, ...c, ...bb, ...d, ...c);
        hAttr.push(t0, t0, t1, t0, t1, t1);
      }
    }
  }
  for (let i = 0; i < pos.length / 3; i++) nor.push(0, 1, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(hAttr, 1));
  return g;
}

function grassMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  m.name = 'grass';
  applyWind(m, { mode: 'height', height: 0.5, amplitude: 0.16, flutter: 0.35, playerPush: true });
  patchMaterial(m, 'grass-color', (shader) => {
    shader.uniforms.uGrassA = globalUniforms.uGrassA;
    shader.uniforms.uGrassB = globalUniforms.uGrassB;
    shader.uniforms.uGrassTip = globalUniforms.uGrassTip;
    shader.uniforms.uGrassDry = globalUniforms.uGrassDry;
    shader.uniforms.uSunDir = globalUniforms.uSunDir;
    shader.uniforms.uSunColor = globalUniforms.uSunColor;
    shader.uniforms.uSnow = globalUniforms.uSnow;
    shader.uniforms.uCloudShadow = globalUniforms.uCloudShadow;
    let vs = shader.vertexShader;
    vs = before(vs, 'void main() {', 'attribute float aH;\nvarying float vGH;\nvarying vec3 vGOrigin;\nvarying vec3 vGWorld;\nuniform float uSnow;');
    vs = after(
      vs,
      '#include <begin_vertex>',
      `transformed.y *= 1.0 - uSnow * 0.75;\nvGH = aH;\n{ mat4 gm = modelMatrix;\n#ifdef USE_INSTANCING\n gm = modelMatrix * instanceMatrix;\n#endif\n vGOrigin = (gm * vec4(0.0,0.0,0.0,1.0)).xyz; }`,
    );
    vs = after(vs, '#include <project_vertex>', '{ mat4 gm2 = modelMatrix;\n#ifdef USE_INSTANCING\n gm2 = modelMatrix * instanceMatrix;\n#endif\n vGWorld = (gm2 * vec4(transformed,1.0)).xyz; }');
    shader.vertexShader = vs;
    let fs = shader.fragmentShader;
    fs = before(
      fs,
      'void main() {',
      `varying float vGH;\nvarying vec3 vGOrigin;\nvarying vec3 vGWorld;\nuniform vec3 uGrassA;\nuniform vec3 uGrassB;\nuniform vec3 uGrassTip;\nuniform vec3 uGrassDry;\nuniform vec3 uSunDir;\nuniform vec3 uSunColor;\nuniform float uCloudShadow;\nuniform float uTime;\n${NOISE_GLSL}`,
    );
    fs = replace(
      fs,
      '#include <map_fragment>',
      /* glsl */ `
      vec2 gp = vGOrigin.xz;
      float gmix = smoothstep(0.3, 0.72, hvFbm(gp * 0.055));
      vec3 gbase = mix(uGrassA, uGrassB, gmix);
      gbase = mix(gbase, uGrassDry, smoothstep(0.62, 0.9, hvFbm(gp * 0.09 + 5.0)) * 0.45);
      float glush = smoothstep(0.35, 0.78, hvFbm(gp * 0.11 + 20.0));
      gbase = mix(gbase, uGrassA * vec3(0.7, 0.86, 0.74), glush * 0.55) * 0.9;
      vec3 gtip = mix(gbase, uGrassTip, 0.55);
      float gh = vGH;
      vec3 gcol = mix(gbase * 0.62, gbase * 1.02, smoothstep(0.0, 0.45, gh));
      gcol = mix(gcol, gtip, smoothstep(0.45, 1.0, gh));
      diffuseColor.rgb = gcol;
      `,
    );
    // Blades use up-facing normals on both sides (don't flip for back faces).
    fs = after(fs, '#include <normal_fragment_begin>', 'normal = normalize(vNormal);');
    fs = after(
      fs,
      '#include <emissivemap_fragment>',
      /* glsl */ `
      {
        vec3 V = normalize(cameraPosition - vGWorld);
        float back = pow(max(dot(-V, normalize(uSunDir)), 0.0), 2.0) * 1.1 + 0.1;
        totalEmissiveRadiance += gcol * uSunColor * gh * gh * back * 0.35 * hvCloudShadow(vGWorld.xz, uTime, uCloudShadow);
      }`,
    );
    shader.fragmentShader = fs;
  });
  return m;
}

export interface GrassOptions {
  bounds: { x0: number; z0: number; x1: number; z1: number };
  /** Tufts per tile at world tile (x,z); 0 = none. */
  density: (x: number, z: number) => number;
  /** Ground height. */
  height: (x: number, z: number) => number;
  /** Probability that a tuft is the tall variant. */
  tallness: (x: number, z: number) => number;
  seed: string;
  densityScale: number;
}

interface TileRef {
  mesh: THREE.InstancedMesh;
  indices: number[];
}

export class GrassField {
  readonly group = new THREE.Group();
  private material = grassMaterial();
  private tileRefs = new Map<string, TileRef[]>();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(opts: GrassOptions) {
    this.group.name = 'grass';
    const rng = new Rng(opts.seed);
    const geos = [tuftGeometry(rng, 9, 'short'), tuftGeometry(rng, 8, 'short'), tuftGeometry(rng, 7, 'tall'), tuftGeometry(rng, 9, 'tall')];
    const { x0, z0, x1, z1 } = opts.bounds;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (let cz = z0; cz < z1; cz += CHUNK) {
      for (let cx = x0; cx < x1; cx += CHUNK) {
        const per: { mats: THREE.Matrix4[]; cols: THREE.Color[]; tiles: string[] }[] = geos.map(() => ({ mats: [], cols: [], tiles: [] }));
        for (let tz = cz; tz < Math.min(cz + CHUNK, z1); tz++) {
          for (let tx = cx; tx < Math.min(cx + CHUNK, x1); tx++) {
            const dens = opts.density(tx + 0.5, tz + 0.5) * opts.densityScale;
            let n = Math.floor(dens);
            if (rng.next() < dens - n) n++;
            for (let k = 0; k < n; k++) {
              const x = tx + rng.next();
              const z = tz + rng.next();
              const tall = rng.next() < opts.tallness(x, z);
              const vi = (tall ? 2 : 0) + (rng.next() < 0.5 ? 0 : 1);
              p.set(x, opts.height(x, z) - 0.02, z);
              q.setFromAxisAngle(up, rng.next() * Math.PI * 2);
              const sc = 0.75 + rng.next() * 0.6;
              s.set(sc * (0.9 + rng.next() * 0.3), sc * (0.85 + rng.next() * 0.35), sc);
              m.compose(p, q, s);
              const bucket = per[vi]!;
              bucket.mats.push(m.clone());
              const v = 0.86 + rng.next() * 0.24;
              col.setRGB(v * (0.96 + rng.next() * 0.08), v, v * (0.9 + rng.next() * 0.1));
              bucket.cols.push(col.clone());
              bucket.tiles.push(`${tx},${tz}`);
            }
          }
        }
        per.forEach((b, vi) => {
          if (!b.mats.length) return;
          const mesh = new THREE.InstancedMesh(geos[vi]!, this.material, b.mats.length);
          b.mats.forEach((mm, i) => {
            mesh.setMatrixAt(i, mm);
            mesh.setColorAt(i, b.cols[i]!);
            const key = b.tiles[i]!;
            let refs = this.tileRefs.get(key);
            if (!refs) {
              refs = [];
              this.tileRefs.set(key, refs);
            }
            let ref = refs.find((r) => r.mesh === mesh);
            if (!ref) {
              ref = { mesh, indices: [] };
              refs.push(ref);
            }
            ref.indices.push(i);
          });
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.computeBoundingSphere();
          mesh.receiveShadow = true;
          mesh.castShadow = false;
          mesh.name = `grass-chunk-${cx}-${cz}`;
          mesh.userData.noAO = true;
          this.group.add(mesh);
        });
      }
    }
  }

  /** Remove all tufts on a tile (scythe / hoe / placing objects). */
  clearTile(x: number, z: number): void {
    const refs = this.tileRefs.get(`${x},${z}`);
    if (!refs) return;
    for (const r of refs) {
      for (const i of r.indices) r.mesh.setMatrixAt(i, this.zero);
      r.mesh.instanceMatrix.needsUpdate = true;
    }
    this.tileRefs.delete(`${x},${z}`);
  }

  get instanceCount(): number {
    let n = 0;
    this.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) n += (o as THREE.InstancedMesh).count;
    });
    return n;
  }
}
