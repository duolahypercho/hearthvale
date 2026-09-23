/**
 * LanternHallSystem: the interior of the Lantern Hall — a cut-away diorama map ('hall').
 *
 *   ┌──────── back wall: three moonlit arched windows + the rose window ────────┐
 *   │  Seed Room      │        nave         │      Sun Room       │
 *   │  Harvest Room   │   Great Lantern ↑   │      Hearth Room    │
 *   │  Crafter's Room │   runner rug        │      Tide Room      │
 *   └──────────── knee wall ──── doors ──── knee wall ────────────┘
 *
 * Each room has a stone plinth with its lantern and the room's bundle sacks (interact → bundle UI),
 * themed furniture, and two dressings: *dark* (dust sheets, cobwebs, blown-in leaves, dust on the
 * floor) and *restored* (rugs, flowers, candles, bunting). Relighting a room ignites its lantern and
 * its pane of the Great Lantern / rose window, glowmoths swarm it, and the room's dressing swaps.
 * Interior lighting overrides the day/night rig while the hall is the current map (cool moonlight
 * through the windows when dark → warm lamplight when restored).
 *
 * Also adds the town ↔ hall warps and handles the `hall:ignite` cutscene cue.
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import type { GameMap, MapWarp } from '../world/map';
import { TileGrid, TileType, TileFlag } from '../world/tiles';
import { MeshBuilder, roundedBox, bevelCylinder, lumpySphere, mat, boxUV } from '../world/geom';
import { leafBlade } from '../world/props/flora';
import { textures } from '../render/textures';
import { FireFX } from '../render/particles';
import { Rng } from '../core/rng';
import { ROOMS, BUNDLES, type RoomDef, type RoomId } from '../data/bundles';
import { HALL } from '../data/story-scenes';
import { WorldHints, type HintPoint } from '../ui/journal-hint';

// ─────────────────────────────────────────────── materials (interior: no snow / rain / cloud patch)

type HallMat = 'plaster' | 'wood' | 'woodGrain' | 'stone' | 'metal' | 'cloth' | 'glass' | 'water' | 'leaf' | 'candle' | 'web';
let MATS: Record<HallMat, THREE.Material> | null = null;
function hallMats(): Record<HallMat, THREE.Material> {
  if (MATS) return MATS;
  const w = textures.wood();
  const wg = textures.woodGrain();
  const st = textures.stone();
  const std = (p: THREE.MeshStandardMaterialParameters, name: string): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, ...p });
    m.name = `hall-${name}`;
    return m;
  };
  MATS = {
    plaster: std({ roughness: 0.92, color: 0xffffff }, 'plaster'),
    wood: std({ map: w.map, bumpMap: w.bump, bumpScale: 2.2, roughness: 0.8 }, 'wood'),
    woodGrain: std({ map: wg.map, bumpMap: wg.bump, bumpScale: 1.4, roughness: 0.78 }, 'woodGrain'),
    stone: std({ map: st.map, bumpMap: st.bump, bumpScale: 2.6, roughness: 0.9 }, 'stone'),
    metal: std({ roughness: 0.42, metalness: 0.45, color: 0xffffff }, 'metal'),
    cloth: std({ roughness: 1 }, 'cloth'),
    glass: std({ roughness: 0.1, metalness: 0.1, color: 0x9ab4cc, transparent: true, opacity: 0.38, depthWrite: false }, 'glass'),
    water: std({ roughness: 0.15, color: 0x2a8a9a, emissive: 0x1a6a8a, emissiveIntensity: 0.6, transparent: true, opacity: 0.82 }, 'water'),
    leaf: std({ roughness: 0.8, side: THREE.DoubleSide }, 'leaf'),
    candle: std({ roughness: 0.5, color: 0xfff2dc, emissive: 0xffb050, emissiveIntensity: 2.4 }, 'candle'),
    web: std({ roughness: 1, color: 0xe8ecf2, map: webTexture(), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }, 'web'),
  };
  (MATS.glass as THREE.MeshStandardMaterial).vertexColors = false;
  (MATS.web as THREE.MeshStandardMaterial).vertexColors = false;
  return MATS;
}

/** Cobweb: spokes + a sagging spiral on transparent canvas (also reads as cracks on glass). */
function webTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const r = new Rng('web');
  g.strokeStyle = 'rgba(235,238,245,0.55)';
  g.lineWidth = 1.6;
  const cx = S * 0.5;
  const cy = S * 0.5;
  const spokes: number[] = [];
  for (let i = 0; i < 11; i++) spokes.push((i / 11) * Math.PI * 2 + (r.next() - 0.5) * 0.3);
  for (const a of spokes) {
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * S * 0.5, cy + Math.sin(a) * S * 0.5);
    g.stroke();
  }
  g.lineWidth = 1.1;
  for (let ring = 1; ring < 9; ring++) {
    const rad = ring * S * 0.052;
    g.beginPath();
    spokes.forEach((a, i) => {
      const b = spokes[(i + 1) % spokes.length]!;
      const p = [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad];
      const q = [cx + Math.cos(b) * rad, cy + Math.sin(b) * rad];
      const m = [cx + Math.cos((a + b) / 2) * rad * 0.88, cy + Math.sin((a + b) / 2) * rad * 0.88];
      if (i === 0) g.moveTo(p[0]!, p[1]!);
      g.quadraticCurveTo(m[0]!, m[1]!, q[0]!, q[1]!);
    });
    g.stroke();
  }
  // A few dust clumps caught in it.
  for (let k = 0; k < 14; k++) {
    g.fillStyle = 'rgba(200,196,188,0.35)';
    g.beginPath();
    g.arc(cx + (r.next() - 0.5) * S * 0.7, cy + (r.next() - 0.5) * S * 0.7, 1 + r.next() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Additive floor pool: the lantern's colour washing the boards round its plinth. */
function poolMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uI: { value: 0 } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uI; varying vec2 vP; void main(){ float r = length(vP) / 3.2; float a = pow(max(0.0, 1.0 - r), 2.2) * uI; gl_FragColor = vec4(uColor * a, a); }',
  });
}

/** Shockwave ring on ignition: a bright band that races out across the floor. */
function ringMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(0xffffff) }, uA: { value: 0 }, uW: { value: 0.12 } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uA; uniform float uW; varying vec2 vP; void main(){ float r = length(vP); float band = smoothstep(1.0 - uW, 1.0 - uW * 0.3, r) * smoothstep(1.0, 1.0 - uW * 0.3, r); float inner = smoothstep(1.0 - uW * 3.0, 1.0, r) * 0.06; float a = (band + inner) * uA; gl_FragColor = vec4(uColor * a * 1.6, a); }',
  });
}

const STERILE_PANEL = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f6ff, emissiveIntensity: 3.2, roughness: 0.3, side: THREE.DoubleSide });
STERILE_PANEL.name = 'hall-everglow-panel';

/** Glimmerco logo plaque (a small cold card screwed onto each plinth). */
let LOGO: THREE.MeshStandardMaterial | null = null;
function logoMaterial(): THREE.MeshStandardMaterial {
  if (LOGO) return LOGO;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#eef6fb';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#8aa4b8';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 248, 120);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.strokeStyle = '#2fc8e8';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(58 + Math.cos(a) * 18, 64 + Math.sin(a) * 18);
    g.lineTo(58 + Math.cos(a) * 34, 64 + Math.sin(a) * 34);
    g.stroke();
  }
  g.fillStyle = '#2fc8e8';
  g.beginPath();
  g.arc(58, 64, 13, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a3a52';
  g.font = '800 34px Fredoka, Nunito, sans-serif';
  g.fillText('EverGlow', 100, 62);
  g.font = '700 18px Nunito, sans-serif';
  g.fillStyle = '#4a7088';
  g.fillText('Glimmerco', 102, 90);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  LOGO = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.3 });
  LOGO.name = 'hall-glimmer-logo';
  return LOGO;
}

/** Woven rug: border, a lattice field of little diamonds, a centre medallion — one canvas per room. */
function rugTexture(accent: number, seed: string): THREE.CanvasTexture {
  const W = 512;
  const H = 300;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const r = new Rng(seed);
  const A = new THREE.Color(accent);
  const css = (col: THREE.Color, k = 1): string => `rgb(${Math.round(col.r * 255 * k)},${Math.round(col.g * 255 * k)},${Math.round(col.b * 255 * k)})`;
  const deep = A.clone().multiplyScalar(0.5);
  const cream = new THREE.Color(0xf2e4c4);
  g.fillStyle = css(deep);
  g.fillRect(0, 0, W, H);
  g.fillStyle = css(cream);
  g.fillRect(18, 18, W - 36, H - 36);
  g.fillStyle = css(A, 0.85);
  g.fillRect(30, 30, W - 60, H - 60);
  g.fillStyle = css(cream, 0.96);
  g.fillRect(44, 44, W - 88, H - 88);
  // Lattice of diamonds.
  for (let y = 60; y < H - 50; y += 22) {
    for (let x = 60 + ((y / 22) % 2) * 11; x < W - 50; x += 22) {
      g.fillStyle = (x + y) % 44 === 0 ? css(A, 0.9) : css(deep, 1.2);
      g.beginPath();
      g.moveTo(x, y - 6);
      g.lineTo(x + 6, y);
      g.lineTo(x, y + 6);
      g.lineTo(x - 6, y);
      g.fill();
    }
  }
  // Medallion.
  g.fillStyle = css(deep);
  g.beginPath();
  g.ellipse(W / 2, H / 2, 70, 48, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = css(A);
  g.beginPath();
  g.ellipse(W / 2, H / 2, 56, 36, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = css(cream);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.beginPath();
    g.ellipse(W / 2 + Math.cos(a) * 28, H / 2 + Math.sin(a) * 18, 9, 5, a, 0, Math.PI * 2);
    g.fill();
  }
  // Weave: fine warp / weft stripes + wear.
  for (let y = 0; y < H; y += 3) {
    g.fillStyle = `rgba(0,0,0,${0.04 + r.next() * 0.03})`;
    g.fillRect(0, y, W, 1);
  }
  for (let x = 0; x < W; x += 3) {
    g.fillStyle = `rgba(255,255,255,${0.03 + r.next() * 0.03})`;
    g.fillRect(x, 0, 1, H);
  }
  const wear = g.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.6);
  wear.addColorStop(0, 'rgba(255,240,210,0.12)');
  wear.addColorStop(1, 'rgba(40,20,10,0.18)');
  g.fillStyle = wear;
  g.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Soft additive glow points (glowmoths, dust motes). */
class GlowPoints {
  readonly points: THREE.Points;
  readonly pos: Float32Array;
  readonly col: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  private mat: THREE.ShaderMaterial;
  constructor(readonly n: number) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3).fill(1);
    this.size = new Float32Array(n).fill(0.1);
    this.alpha = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale; varying vec3 vC; varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          vC = aColor; vA = aAlpha;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float core = smoothstep(0.35, 0.0, d);
          float halo = pow(max(0.0, 1.0 - d), 2.2) * 0.55;
          float a = (core * 1.6 + halo) * vA;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vC * a, a);
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    this.points.userData.noAO = true;
  }
  flush(viewportH: number): void {
    this.mat.uniforms.uScale!.value = viewportH * 0.9;
    const g = this.points.geometry;
    for (const k of ['position', 'aColor', 'aSize', 'aAlpha']) (g.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Moonbeam / sunbeam through a window: an additive, softly-edged volumetric card. */
function beamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0x6f8fff) }, uStrength: { value: 0.5 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uStrength; uniform float uTime; varying vec2 vUv; varying vec3 vW;
      float h(float x){ return fract(sin(x * 91.7) * 43758.5); }
      void main(){
        float edge = smoothstep(0.0, 0.28, vUv.x) * smoothstep(1.0, 0.72, vUv.x);
        float len = smoothstep(0.0, 0.18, vUv.y) * (0.35 + 0.65 * vUv.y);
        float streak = 0.75 + 0.25 * sin(vUv.x * 23.0 + uTime * 0.3) * sin(vUv.x * 7.0 - uTime * 0.17);
        float a = edge * len * streak * uStrength;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
}

// ─────────────────────────────────────────────── geometry helpers

type B = MeshBuilder;
const box = (b: B, m: HallMat, w: number, h: number, d: number, x: number, y: number, z: number, tint: number, ry = 0, r = 0.04): void => {
  b.add(hallMats()[m], m === 'wood' || m === 'stone' || m === 'woodGrain' ? boxUV(roundedBox(w, h, d, r), 0.9) : roundedBox(w, h, d, r), mat(x, y + h / 2, z, 0, ry, 0), { tint });
};
const cyl = (b: B, m: HallMat, rt: number, rb: number, h: number, x: number, y: number, z: number, tint: number, seg = 10): void => {
  b.add(hallMats()[m], bevelCylinder(rt, rb, h, Math.min(0.03, rt * 0.3), seg), mat(x, y, z), { tint });
};

interface RoomFrame {
  def: RoomDef;
  /** +1 = west wing (outer wall at x=2), -1 = east wing (outer wall at x=28). */
  side: number;
  /** World x of a point `u` metres in from the outer wall. */
  X: (u: number) => number;
  z0: number;
  z1: number;
  plinth: THREE.Vector3;
}

function frameFor(def: RoomDef): RoomFrame {
  const side = def.x < 15 ? 1 : -1;
  const outer = side > 0 ? 2.2 : 27.8;
  return { def, side, X: (u) => outer + side * u, z0: def.z - 3, z1: def.z + 3, plinth: new THREE.Vector3(def.x + side * 0.4, 0, def.z - 0.6) };
}

/** Broken floor in the derelict hall: [x, z, w, d, kind, rot]. Planks split to soil, tiles missing, a cracked flag. */
type Hole = [number, number, number, number, 'plank' | 'tile' | 'flag', number];
const HOLES: Hole[] = [
  [5.7, 6.4, 0.9, 0.9, 'tile', 0],
  [25.5, 6.2, 1.2, 0.6, 'tile', 0],
  [4.3, 10.9, 1.5, 0.55, 'plank', 0],
  [25.1, 12.2, 1.1, 0.8, 'flag', 0.4],
  [5.1, 19.9, 0.52, 1.5, 'plank', 0],
  [25.2, 16.3, 1.2, 0.8, 'tile', 0],
  [17.1, 16.6, 0.6, 1.4, 'plank', 0],
  [12.9, 10.2, 0.6, 1.0, 'plank', 0],
];

/**
 * A dust sheet thrown over furniture: a soft domed top, shoulders, and a skirt that flares out to the
 * floor in irregular folds. Base at y = 0, footprint w × d, height h.
 */
function drapedSheet(r: Rng, w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 36, 18);
  const p = g.attributes.position as THREE.BufferAttribute;
  const ph = r.next() * 6.28;
  const ph2 = r.next() * 6.28;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const rad = Math.hypot(x, z);
    let ny: number;
    let nr: number;
    if (y >= 0) {
      // Dome: flattened, a few soft creases.
      ny = Math.pow(y, 0.8) * 0.42 + 0.035 * Math.sin(a * 3 + ph2) * y + 0.02 * Math.sin(a * 9 + ph) * (1 - y);
      nr = Math.min(1, rad * 1.04) * (1 + 0.04 * Math.sin(a * 5 + ph));
    } else {
      // Skirt: drop to the floor, flare and fold more towards the hem.
      const k = -y;
      ny = -k * 1.0;
      const fold = 0.14 * Math.pow(k, 1.2) * Math.sin(a * 7 + ph) + 0.07 * k * Math.sin(a * 13 + ph2) + 0.04 * Math.sin(a * 3 + ph2);
      nr = (1 + 0.16 * Math.pow(k, 1.6)) * (1 + fold);
    }
    const s = rad > 1e-5 ? nr / rad : 0;
    p.setXYZ(i, x * s * (w / 2), ((ny + 1) / 1.44) * h, z * s * (d / 2));
  }
  g.computeVertexNormals();
  return g;
}

// ─────────────────────────────────────────────── the map

interface RoomVisual {
  frame: RoomFrame;
  dark: THREE.Group;
  lit: THREE.Group;
  sacks: THREE.Group;
  glass: THREE.MeshStandardMaterial;
  /** This room's pane of the Great Lantern / rose-window petal (dimmer than the room lantern: six share one spot). */
  pane: THREE.MeshStandardMaterial;
  light: THREE.PointLight;
  /** The lantern's filament (a bright core behind the tinted glass). */
  core: THREE.MeshStandardMaterial;
  /** Additive pool of the lantern's colour on the floor round the plinth. */
  pool: THREE.ShaderMaterial;
  /** EverGlow dressing (Glimmerco path): ceiling panel, logo plaque, cable runs. */
  sterile: THREE.Group;
  /** 0 = dark … 1 = fully lit (animated). */
  glow: number;
  target: number;
  flash: number;
  /** Seconds since this room's lantern ignited (-1 = not igniting). */
  ign: number;
  glimmer: boolean;
}

export class HallMap implements GameMap {
  readonly id = 'hall';
  readonly title = 'The Lantern Hall';
  readonly grid = new TileGrid(30, 26);
  readonly root = new THREE.Group();
  readonly spawn = { x: HALL.entrance.x, z: 20.2, facing: 'up' as const };
  readonly cameraBounds = new THREE.Box2(new THREE.Vector2(13.5, 9), new THREE.Vector2(16.5, 15.5));
  readonly warps: MapWarp[] = [{ x0: 13, z0: 22, x1: 16, z1: 23, to: 'town', x: 32, z: 14.9, facing: 'down' }];
  readonly poi: Record<string, { x: number; z: number }[]> = {};
  readonly rooms = new Map<RoomId, RoomVisual>();
  private rng = new Rng('lantern-hall');
  private dustCanvas: HTMLCanvasElement;
  private dustTex: THREE.CanvasTexture;
  private floorClean!: HTMLCanvasElement;
  private floorGrime!: HTMLCanvasElement;
  private floorLive!: HTMLCanvasElement;
  private floorTex!: THREE.CanvasTexture;
  private beams: THREE.Mesh[] = [];
  private beamMat = beamMaterial();
  private windowMat: THREE.MeshStandardMaterial;
  private greatCore: THREE.MeshStandardMaterial;
  private greatLight: THREE.PointLight;
  /** The farmer's hand-lantern pool: warm against the moonlight while the hall is dark. */
  private carryLight = new THREE.PointLight(0xffb060, 0, 7.5, 1.6);
  private hearthFire: FireFX;
  private hearthLight: THREE.PointLight;
  private ring = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), ringMaterial());
  private ringAt = new THREE.Vector3();
  private ringT = -1;
  private burst = new GlowPoints(220);
  private burstVel = new Float32Array(220 * 3);
  private burstAge = new Float32Array(220).fill(99);
  private burstLife = new Float32Array(220).fill(1);
  private burstAlive = false;
  private moths = new GlowPoints(140);
  private mothSeed = new Float32Array(140 * 4);
  private motes = new GlowPoints(90);
  private moteVel = new Float32Array(90 * 3);
  private t = 0;
  /** 0..1 how restored the whole hall looks (drives the interior grade). */
  warmth = 0;

  constructor(private game: Game) {
    this.root.name = 'map:hall';
    this.root.userData.perfTag = 'hall';
    for (let i = 0; i < this.mothSeed.length; i++) this.mothSeed[i] = Math.random();
    this.classify();
    // Dust / leaves decal over the floor, redrawn when rooms change state.
    this.dustCanvas = document.createElement('canvas');
    this.dustCanvas.width = 1040;
    this.dustCanvas.height = 720;
    this.dustTex = new THREE.CanvasTexture(this.dustCanvas);
    this.dustTex.colorSpace = THREE.SRGBColorSpace;
    this.windowMat = new THREE.MeshStandardMaterial({ color: 0x1a2440, emissive: 0x5a78c8, emissiveIntensity: 0.8, roughness: 0.2 });
    this.greatCore = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xffd08a, emissiveIntensity: 0, roughness: 0.3 });
    this.greatLight = new THREE.PointLight(0xffc27a, 0, 18, 1.5);
    // In front of the lantern (a light near the back wall bleaches the plaster white).
    this.greatLight.position.set(HALL.dais.x, 3.0, HALL.dais.z + 2.2);
    this.root.add(this.greatLight);
    this.root.add(this.carryLight);
    this.build();
    // Hearth fire (Hearth Room) — only burns once the room is lit.
    const hearth = ROOMS.find((r) => r.id === 'hearth')!;
    const hf = frameFor(hearth);
    this.hearthFire = new FireFX([new THREE.Vector3(hf.X(0.55), 0.3, hearth.z + 0.2)]);
    this.hearthFire.active = false;
    this.root.add(this.hearthFire.object);
    this.hearthLight = new THREE.PointLight(0xff8a3a, 0, 7, 1.6);
    this.hearthLight.position.set(hf.X(1.2), 0.9, hearth.z + 0.2);
    this.root.add(this.hearthLight);
    this.root.add(this.moths.points, this.motes.points, this.burst.points);
    this.ring.visible = false;
    this.ring.renderOrder = 6;
    this.ring.userData.noAO = true;
    this.root.add(this.ring);
    for (let i = 0; i < this.motes.n; i++) this.respawnMote(i, true);
    this.redrawDust();
  }

  // ───────────────────────────── tiles

  private classify(): void {
    const g = this.grid;
    g.forEach((x, z, i) => {
      const inside = x >= 2 && x <= 27 && z >= 3 && z <= 20;
      const door = z >= 21 && x >= 13 && x <= 16;
      g.type[i] = inside || door ? TileType.Floor : TileType.Void;
      g.height[i] = 0;
    });
    const block = (x0: number, z0: number, x1: number, z1: number): void => {
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (this.grid.inBounds(x, z)) this.grid.setFlag(x, z, TileFlag.Blocked);
    };
    // Divider walls (arches at each room's centre stay open).
    for (const wx of [11, 18]) {
      for (let z = 3; z <= 20; z++) {
        // Arches are 3 m wide: keep all four tiles under them walkable (the old 2-tile gap snagged).
        const open = [6, 12, 18].some((c) => Math.abs(z + 0.5 - c) <= 1.5);
        if (!open) block(wx, z, wx, z);
      }
    }
    for (const wz of [8, 14]) {
      block(2, wz, 10, wz);
      block(19, wz, 27, wz);
    }
    // Great Lantern dais.
    block(13, 3, 16, 6);
    this.poi.hall = [{ x: HALL.dais.x, z: HALL.dais.z }];
  }

  blockRect(x0: number, z0: number, x1: number, z1: number): void {
    for (let z = Math.floor(z0); z <= Math.floor(z1); z++) for (let x = Math.floor(x0); x <= Math.floor(x1); x++) if (this.grid.inBounds(x, z)) this.grid.setFlag(x, z, TileFlag.Blocked);
  }

  // ───────────────────────────── build

  private build(): void {
    const b = new MeshBuilder();
    this.buildFloor();
    this.buildShell(b);
    this.buildGreatLantern(b);
    for (const def of ROOMS) this.buildRoom(b, def);
    const shell = b.build({ name: 'hall-shell' });
    shell.userData.perfTag = 'hall';
    this.root.add(shell);
  }

  private buildFloor(): void {
    // One painted floor for the whole interior: themed per room, planked nave, baked wall AO.
    const PX = 80;
    const W = 26;
    const D = 18;
    const c = document.createElement('canvas');
    c.width = W * PX;
    c.height = D * PX;
    const g = c.getContext('2d')!;
    const r = new Rng('hall-floor');
    const X = (x: number): number => (x - 2) * PX;
    const Z = (z: number): number => (z - 3) * PX;
    const hsl = (h: number, s: number, l: number): string => `hsl(${h} ${s}% ${l}%)`;
    const planks = (x0: number, z0: number, x1: number, z1: number, dir: 'ns' | 'ew', w: number, base: [number, number, number]): void => {
      const along = dir === 'ns' ? z1 - z0 : x1 - x0;
      const across = dir === 'ns' ? x1 - x0 : z1 - z0;
      for (let k = 0; k * w < across; k++) {
        let s = -r.next() * 1.5;
        while (s < along) {
          const len = 1.2 + r.next() * 1.8;
          const [h, sa, l] = base;
          g.fillStyle = hsl(h + (r.next() - 0.5) * 6, sa + (r.next() - 0.5) * 8, l + (r.next() - 0.5) * 9);
          const a0 = Math.max(0, s);
          const a1 = Math.min(along, s + len);
          if (dir === 'ns') g.fillRect(X(x0 + k * w), Z(z0 + a0), w * PX, (a1 - a0) * PX);
          else g.fillRect(X(x0 + a0), Z(z0 + k * w), (a1 - a0) * PX, w * PX);
          // grain
          g.strokeStyle = `rgba(60,30,10,${0.06 + r.next() * 0.06})`;
          g.lineWidth = 1;
          for (let q = 0; q < 4; q++) {
            const o = (0.15 + r.next() * 0.7) * w;
            g.beginPath();
            if (dir === 'ns') {
              g.moveTo(X(x0 + k * w + o), Z(z0 + a0));
              g.bezierCurveTo(X(x0 + k * w + o + 0.03), Z(z0 + a0 + len * 0.3), X(x0 + k * w + o - 0.03), Z(z0 + a0 + len * 0.6), X(x0 + k * w + o), Z(z0 + a1));
            } else {
              g.moveTo(X(x0 + a0), Z(z0 + k * w + o));
              g.bezierCurveTo(X(x0 + a0 + len * 0.3), Z(z0 + k * w + o + 0.03), X(x0 + a0 + len * 0.6), Z(z0 + k * w + o - 0.03), X(x0 + a1), Z(z0 + k * w + o));
            }
            g.stroke();
          }
          // seams + nail dots
          g.fillStyle = 'rgba(40,20,8,0.55)';
          if (dir === 'ns') {
            g.fillRect(X(x0 + k * w), Z(z0 + a1) - 1, w * PX, 2);
            g.fillRect(X(x0 + k * w + 0.1), Z(z0 + a0) + 6, 2, 2);
          } else {
            g.fillRect(X(x0 + a1) - 1, Z(z0 + k * w), 2, w * PX);
            g.fillRect(X(x0 + a0) + 6, Z(z0 + k * w + 0.1), 2, 2);
          }
          s += len;
        }
        g.fillStyle = 'rgba(40,20,8,0.5)';
        if (dir === 'ns') g.fillRect(X(x0 + k * w), Z(z0), 1.5, along * PX);
        else g.fillRect(X(x0), Z(z0 + k * w), along * PX, 1.5);
      }
    };
    const tiles = (x0: number, z0: number, x1: number, z1: number, s: number, colors: [number, number, number][], grout: string, checker = false): void => {
      // Grout bed, then each tile as a glazed bevelled slab: lit top-left lip, shaded bottom-right
      // lip, a soft AO ring in the grout round every tile and a few chips + speckles in the glaze.
      g.fillStyle = grout;
      g.fillRect(X(x0), Z(z0), (x1 - x0) * PX, (z1 - z0) * PX);
      const gap = 0.04;
      for (let z = z0, j = 0; z < z1 - 0.01; z += s, j++) {
        for (let x = x0, i = 0; x < x1 - 0.01; x += s, i++) {
          const [h, sa, l] = colors[checker ? (i + j) % colors.length : Math.floor(r.next() * colors.length)]!;
          const L = l + (r.next() - 0.5) * 8;
          const tx = X(x + gap);
          const tz = Z(z + gap);
          const tw = (Math.min(s, x1 - x) - gap * 2) * PX;
          const th = (Math.min(s, z1 - z) - gap * 2) * PX;
          // AO in the grout.
          g.fillStyle = 'rgba(30,18,8,0.28)';
          g.beginPath();
          g.roundRect(tx - 2, tz - 1, tw + 4, th + 4, 6);
          g.fill();
          g.fillStyle = hsl(h + (r.next() - 0.5) * 5, sa, L);
          g.beginPath();
          g.roundRect(tx, tz, tw, th, 5);
          g.fill();
          // Glaze gradient: slightly domed.
          const gr = g.createLinearGradient(tx, tz, tx + tw, tz + th);
          gr.addColorStop(0, 'rgba(255,255,255,0.14)');
          gr.addColorStop(0.5, 'rgba(255,255,255,0)');
          gr.addColorStop(1, 'rgba(40,20,5,0.16)');
          g.fillStyle = gr;
          g.beginPath();
          g.roundRect(tx, tz, tw, th, 5);
          g.fill();
          // Bevel lips.
          g.fillStyle = 'rgba(255,248,230,0.3)';
          g.fillRect(tx + 3, tz + 1, tw - 6, 2.5);
          g.fillRect(tx + 1, tz + 3, 2.5, th - 6);
          g.fillStyle = 'rgba(40,18,6,0.3)';
          g.fillRect(tx + 3, tz + th - 3, tw - 5, 2.5);
          g.fillRect(tx + tw - 3, tz + 3, 2.5, th - 5);
          for (let k = 0; k < 6; k++) {
            g.fillStyle = r.next() < 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(60,30,10,0.12)';
            g.fillRect(tx + r.next() * tw, tz + r.next() * th, 1.5, 1.5);
          }
          if (r.next() < 0.12) {
            g.fillStyle = 'rgba(70,40,20,0.35)';
            g.beginPath();
            g.arc(tx + (r.next() < 0.5 ? 3 : tw - 3), tz + (r.next() < 0.5 ? 3 : th - 3), 3 + r.next() * 3, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
    };
    const flags = (x0: number, z0: number, x1: number, z1: number): void => {
      g.fillStyle = '#6a625a';
      g.fillRect(X(x0), Z(z0), (x1 - x0) * PX, (z1 - z0) * PX);
      for (let z = z0; z < z1; ) {
        const rowH = 0.5 + r.next() * 0.45;
        for (let x = x0; x < x1; ) {
          const w = 0.6 + r.next() * 0.7;
          const l = 52 + r.next() * 14;
          g.fillStyle = hsl(28 + r.next() * 14, 8 + r.next() * 8, l);
          g.beginPath();
          g.roundRect(X(x + 0.04), Z(z + 0.04), (Math.min(w, x1 - x) - 0.08) * PX, (Math.min(rowH, z1 - z) - 0.08) * PX, 10);
          g.fill();
          x += w;
        }
        z += rowH;
      }
    };
    planks(12, 3, 18, 21, 'ns', 0.3, [30, 48, 44]); // nave: honey oak
    tiles(2, 3, 12, 9, 0.5, [[14, 52, 50], [18, 55, 46], [10, 48, 44]], '#caa888'); // seed: terracotta
    tiles(18, 3, 28, 9, 0.6, [[45, 30, 82], [100, 18, 62]], '#b8b0a0', true); // sun: cream + sage checker
    planks(2, 9, 12, 15, 'ew', 0.36, [24, 42, 34]); // harvest: dark wide planks
    flags(18, 9, 28, 15); // hearth: flagstones
    planks(2, 15, 12, 21, 'ns', 0.26, [36, 44, 56]); // craft: pale pine
    tiles(18, 15, 28, 21, 0.4, [[178, 40, 40], [168, 36, 46], [190, 34, 36]], '#d8d4c4'); // tide: sea-glass tiles
    // Stone apron around the dais.
    g.fillStyle = '#8a8276';
    g.beginPath();
    g.arc(X(HALL.dais.x), Z(HALL.dais.z), 2.9 * PX, 0, Math.PI * 2);
    g.fill();
    // Baked AO: soft darkening along every wall foot + room corners.
    const edge = (x0: number, z0: number, x1: number, z1: number): void => {
      const grd = g.createLinearGradient(X(x0), Z(z0), X(x1), Z(z1));
      grd.addColorStop(0, 'rgba(20,10,4,0.55)');
      grd.addColorStop(1, 'rgba(20,10,4,0)');
      g.fillStyle = grd;
      const xa = Math.min(x0, x1);
      const za = Math.min(z0, z1);
      g.fillRect(X(xa), Z(za), Math.max(Math.abs(x1 - x0), 0.02) * PX || W * PX, Math.max(Math.abs(z1 - z0), 0.02) * PX || D * PX);
    };
    const ao = (x0: number, z0: number, x1: number, z1: number, dir: 'n' | 's' | 'e' | 'w', depth = 0.7): void => {
      const grd = dir === 'n' || dir === 's' ? g.createLinearGradient(0, Z(dir === 'n' ? z0 : z1), 0, Z(dir === 'n' ? z0 + depth : z1 - depth)) : g.createLinearGradient(X(dir === 'w' ? x0 : x1), 0, X(dir === 'w' ? x0 + depth : x1 - depth), 0);
      grd.addColorStop(0, 'rgba(18,8,2,0.6)');
      grd.addColorStop(1, 'rgba(18,8,2,0)');
      g.fillStyle = grd;
      g.fillRect(X(x0), Z(z0), (x1 - x0) * PX, (z1 - z0) * PX);
    };
    void edge;
    ao(2, 3, 28, 21, 'n', 0.9);
    ao(2, 3, 28, 21, 'w', 0.8);
    ao(2, 3, 28, 21, 'e', 0.8);
    for (const wx of [12, 18]) {
      ao(wx - 1, 3, wx, 21, 'e', 0.5);
      ao(wx, 3, wx + 1, 21, 'w', 0.5);
    }
    for (const wz of [9, 15]) {
      ao(2, wz, 12, wz + 1, 'n', 0.55);
      ao(18, wz, 28, wz + 1, 'n', 0.55);
      ao(2, wz - 1, 12, wz, 's', 0.4);
      ao(18, wz - 1, 28, wz, 's', 0.4);
    }
    // The clean floor is kept; a derelict twin (desaturated 40 %, ×0.6, grimed, holed) is derived
    // from it, and the live texture composites the two per room (see composeFloor).
    this.floorClean = c;
    this.floorGrime = this.makeGrime(c, PX);
    this.floorLive = document.createElement('canvas');
    this.floorLive.width = c.width;
    this.floorLive.height = c.height;
    this.floorLive.getContext('2d')!.drawImage(c, 0, 0);
    const tex = new THREE.CanvasTexture(this.floorLive);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.floorTex = tex;
    const floorMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78, metalness: 0 });
    floorMat.name = 'hall-floor';
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(15, 0, 12);
    floor.receiveShadow = true;
    this.root.add(floor);
    // Dust decal (drawn in redrawDust).
    const dustMat = new THREE.MeshStandardMaterial({ map: this.dustTex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
    dustMat.name = 'hall-dust';
    const dust = new THREE.Mesh(new THREE.PlaneGeometry(W, D), dustMat);
    dust.rotation.x = -Math.PI / 2;
    dust.position.set(15, 0.006, 12);
    dust.receiveShadow = true;
    dust.renderOrder = 1;
    dust.userData.noAO = true;
    this.root.add(dust);
    // The diorama base the hall stands on: a dressed-stone foundation course, then a mossy garden slab
    // with a soil cross-section at its edge (reads as a cut-away model on a dark table).
    const bb = new MeshBuilder();
    // Top sits 4 cm under the painted floor (coplanar faces z-fight into a cobble patchwork).
    bb.add(hallMats().stone, boxUV(roundedBox(27.9, 0.5, 19.9, 0.08), 0.9), mat(15, -0.29, 12.1), { tint: 0x9a9082 });
    bb.add(hallMats().cloth, roundedBox(33.5, 0.5, 25.5, 0.22), mat(15, -0.47, 12.6), { tint: 0x3f5a34 });
    bb.add(hallMats().cloth, roundedBox(33.2, 1.6, 25.2, 0.3), mat(15, -1.45, 12.6), { tint: 0x4a3222 });
    bb.add(hallMats().stone, roundedBox(33.0, 0.5, 25.0, 0.2), mat(15, -2.1, 12.6), { tint: 0x5a544c });
    // Garden edging: low clipped hedges and a few stepping stones to the doors.
    const gr = new Rng('hall-garden');
    for (const [x0, x1, z] of [[0.2, 12.8, 23.0], [17.2, 29.8, 23.0]] as const) {
      for (let x = x0; x < x1; x += 0.9) bb.add(hallMats().leaf, lumpySphere(0.5, 1, 0.12, gr, 2), mat(x + 0.45, 0.02, z + (gr.next() - 0.5) * 0.15, 0, gr.next() * 3, 0, 1, 0.8, 0.9), { tint: [0x3f6a34, 0x4a7a3a, 0x36602e][Math.floor(gr.next() * 3)]! });
    }
    for (let k = 0; k < 3; k++) bb.add(hallMats().stone, bevelCylinder(0.42, 0.46, 0.08, 0.03, 12), mat(15 + (k % 2 ? 0.25 : -0.2), -0.18, 22.4 + k * 0.85, 0, gr.next(), 0, 1.3, 1, 1), { tint: 0xb8b0a0 });
    for (const sx of [0.6, 29.4]) {
      for (let z = 3.5; z < 22; z += 1.6) bb.add(hallMats().leaf, lumpySphere(0.55, 1, 0.14, gr, 2), mat(sx, 0.05, z, 0, gr.next() * 3, 0, 0.9, 1.1, 1.1), { tint: [0x3f6a34, 0x4a7a3a, 0x36602e][Math.floor(gr.next() * 3)]! });
    }
    const base = bb.build({ name: 'hall-base' });
    base.traverse((o) => {
      o.receiveShadow = true;
      o.castShadow = false;
    });
    this.root.add(base);
  }

  private buildShell(b: B): void {
    const PLASTER = 0xf0e2c6;
    const WAIN = 0x8a5a36;
    const TRIM = 0x5e3a22;
    /** Wall-top caps: the cut-away section the camera looks down on reads as honey oak, not a black bar. */
    const CAP = 0xa87448;
    const STONE = 0xb8ad9c;
    const H = 5.2;
    const SIDE_H = 4.4;
    // Back wall with three tall arched windows + rose window.
    const wins = [7, 23];
    const wall = (x0: number, x1: number, z: number, h: number, t = 0.4): void => {
      const w = x1 - x0;
      box(b, 'stone', w, 0.35, t + 0.06, (x0 + x1) / 2, 0, z, STONE);
      box(b, 'wood', w, 1.05, t + 0.04, (x0 + x1) / 2, 0.35, z, WAIN);
      box(b, 'plaster', w, h - 1.4, t, (x0 + x1) / 2, 1.4, z, PLASTER, 0, 0.02);
      box(b, 'woodGrain', w, 0.12, t + 0.14, (x0 + x1) / 2, 1.38, z, TRIM);
      box(b, 'woodGrain', w + 0.1, 0.26, t + 0.2, (x0 + x1) / 2, h - 0.02, z, CAP);
    };
    // Back wall pieces around the two side windows; the centre section rises higher for the rose window.
    const bz = 2.8;
    wall(1.8, 6.15, bz, H);
    wall(7.85, 22.15, bz, H + 0.9);
    wall(23.85, 28.2, bz, H);
    for (const wx of wins) {
      box(b, 'stone', 1.7, 0.35, 0.46, wx, 0, bz, STONE);
      box(b, 'wood', 1.7, 1.05, 0.44, wx, 0.35, bz, WAIN);
      box(b, 'plaster', 1.7, 0.5, 0.4, wx, 1.4, bz, PLASTER);
      box(b, 'plaster', 1.7, 0.75, 0.4, wx, 4.45, bz, PLASTER);
      box(b, 'woodGrain', 1.8, 0.26, 0.6, wx, H - 0.02, bz, CAP);
      this.windowAt(b, wx, 1.9, bz + 0.21, 1.6, 2.3);
    }
    // Rose window (6 petals = 6 rooms) over the dais.
    const rx = HALL.dais.x;
    const ry = 4.35;
    const rz = bz + 0.22;
    b.add(hallMats().stone, new THREE.TorusGeometry(1.02, 0.12, 8, 36), mat(rx, ry, rz), { tint: 0xd8cfc0 });
    b.add(hallMats().stone, new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16).rotateX(Math.PI / 2), mat(rx, ry, rz + 0.02), { tint: 0xd8cfc0 });
    ROOMS.forEach((room, i) => {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 2;
      const petal = new THREE.CircleGeometry(0.36, 16);
      petal.scale(0.75, 1.15, 1);
      b.add(hallMats().stone, new THREE.TorusGeometry(0.36, 0.035, 5, 18).scale(0.75, 1.15, 1), mat(rx + Math.cos(a) * 0.58, ry + Math.sin(a) * 0.58, rz + 0.03, 0, 0, a - Math.PI / 2), { tint: 0x3a3230 });
      this.pendingPetals.push({ room: room.id, geo: petal, m: mat(rx + Math.cos(a) * 0.58, ry + Math.sin(a) * 0.58, rz + 0.01, 0, 0, a - Math.PI / 2) });
    });
    // Side walls (west / east) with two tall windows each.
    for (const sx of [1.8, 28.2]) {
      const seg = (z0: number, z1: number): void => {
        const w = z1 - z0;
        box(b, 'stone', 0.46, 0.35, w, sx, 0, (z0 + z1) / 2, STONE);
        box(b, 'wood', 0.44, 1.05, w, sx, 0.35, (z0 + z1) / 2, WAIN);
        box(b, 'plaster', 0.4, SIDE_H - 1.4, w, sx, 1.4, (z0 + z1) / 2, PLASTER, 0, 0.02);
        box(b, 'woodGrain', 0.54, 0.12, w, sx, 1.38, (z0 + z1) / 2, TRIM);
        box(b, 'woodGrain', 0.6, 0.26, w, sx, SIDE_H - 0.02, (z0 + z1) / 2, CAP);
      };
      seg(2.6, 21.3);
    }
    // Divider walls between the nave and the wings, with arched openings.
    for (const wx of [12, 18]) {
      const openings = [6, 12, 18];
      let z = 3;
      for (const oz of openings) {
        this.dividerSeg(b, wx, z, oz - 1.5, 3.0);
        this.archAt(b, wx, oz, 3.0);
        z = oz + 1.5;
      }
      this.dividerSeg(b, wx, z, 21, 3.0);
      // Columns at the junctions.
      for (const cz of [3.1, 9, 15, 20.9]) {
        cyl(b, 'stone', 0.3, 0.34, 0.4, wx, 0.2, cz, STONE, 12);
        cyl(b, 'woodGrain', 0.2, 0.22, 3.3, wx, 1.95, cz, 0x7a4e2e, 10);
        cyl(b, 'stone', 0.32, 0.26, 0.3, wx, 3.6, cz, STONE, 12);
      }
    }
    // Half walls between rooms (E-W), with a shelf-top rail so the camera sees over them.
    for (const wz of [9, 15]) {
      for (const [x0, x1] of [[2, 11.8], [18.2, 28]] as const) {
        box(b, 'stone', x1 - x0, 0.3, 0.34, (x0 + x1) / 2, 0, wz, STONE);
        box(b, 'wood', x1 - x0, 1.0, 0.3, (x0 + x1) / 2, 0.3, wz, WAIN);
        // A honey-oak cap only: an upper rail on spindles read as a wire strung across the room from above.
        box(b, 'woodGrain', x1 - x0 + 0.04, 0.1, 0.46, (x0 + x1) / 2, 1.3, wz, CAP);
      }
    }
    // Front knee wall with the doorway (cut-away so the camera sees in).
    for (const [x0, x1] of [[1.8, 13.6], [16.4, 28.2]] as const) {
      box(b, 'stone', x1 - x0, 0.35, 0.46, (x0 + x1) / 2, 0, 21.2, STONE);
      box(b, 'wood', x1 - x0, 0.55, 0.4, (x0 + x1) / 2, 0.35, 21.2, WAIN);
      box(b, 'woodGrain', x1 - x0 + 0.1, 0.12, 0.56, (x0 + x1) / 2, 0.9, 21.2, CAP);
    }
    for (const dx of [13.5, 16.5]) {
      cyl(b, 'stone', 0.28, 0.32, 0.4, dx, 0.2, 21.2, STONE, 12);
      cyl(b, 'woodGrain', 0.18, 0.2, 2.4, dx, 1.5, 21.2, 0x6a4226, 10);
      box(b, 'metal', 0.08, 0.08, 0.4, dx, 2.2, 21.4, 0x2e2a28);
    }
    // Door threshold + mat.
    box(b, 'stone', 2.8, 0.06, 0.8, 15, 0, 21.6, 0xa8a090);
    box(b, 'cloth', 1.9, 0.03, 1.1, 15, 0.005, 20.2, 0x8a4a3a, 0, 0.01);
    // Corner cobwebs up in the back corners stay regardless (it's an old building).
    // Back-wall hangings: two banners either side of the rose window (faded).
    for (const bx of [11.3, 18.7]) {
      box(b, 'woodGrain', 1.3, 0.08, 0.08, bx, 4.45, 3.1, TRIM);
      box(b, 'cloth', 1.1, 1.9, 0.04, bx, 2.55, 3.07, bx < 15 ? 0x6a3a4a : 0x3a4a6a, 0, 0.02);
      b.add(hallMats().cloth, new THREE.ConeGeometry(0.55, 0.4, 3).rotateZ(Math.PI), mat(bx, 2.45, 3.07, 0, 0, 0, 1, 1, 0.05), { tint: bx < 15 ? 0x6a3a4a : 0x3a4a6a });
      b.add(hallMats().metal, new THREE.CircleGeometry(0.28, 20), mat(bx, 3.6, 3.1), { tint: 0xc8a050 });
    }
  }

  private pendingPetals: { room: RoomId; geo: THREE.BufferGeometry; m: THREE.Matrix4 }[] = [];

  private dividerSeg(b: B, x: number, z0: number, z1: number, h: number): void {
    if (z1 - z0 < 0.05) return;
    const w = z1 - z0;
    box(b, 'stone', 0.4, 0.3, w, x, 0, (z0 + z1) / 2, 0xb8ad9c);
    box(b, 'wood', 0.36, 0.95, w, x, 0.3, (z0 + z1) / 2, 0x8a5a36);
    box(b, 'plaster', 0.3, h - 1.25, w, x, 1.25, (z0 + z1) / 2, 0xf0e2c6, 0, 0.02);
    box(b, 'woodGrain', 0.46, 0.1, w, x, 1.24, (z0 + z1) / 2, 0x5e3a22);
    box(b, 'woodGrain', 0.5, 0.2, w, x, h - 0.05, (z0 + z1) / 2, 0xa87448);
  }

  private archAt(b: B, x: number, z: number, h: number): void {
    // Lintel above the opening and a round timber arch.
    box(b, 'plaster', 0.3, h - 2.45, 3.0, x, 2.45, z, 0xf0e2c6, 0, 0.02);
    box(b, 'woodGrain', 0.5, 0.2, 3.0, x, h - 0.05, z, 0xa87448);
    const arch = new THREE.TorusGeometry(1.5, 0.1, 6, 20, Math.PI);
    arch.rotateY(Math.PI / 2);
    b.add(hallMats().woodGrain, arch, mat(x, 1.25, z, 0, 0, 0, 1, 0.8, 1), { tint: 0x6a4226 });
  }

  private windowAt(b: B, x: number, y: number, z: number, w: number, h: number): void {
    const m = hallMats();
    // Frame, sill, mullions, arched head.
    box(b, 'woodGrain', w + 0.2, 0.12, 0.3, x, y - 0.1, z + 0.02, 0x5e3a22);
    for (const sx of [-1, 1]) box(b, 'woodGrain', 0.12, h, 0.2, x + (sx * (w + 0.06)) / 2, y, z, 0x5e3a22);
    box(b, 'woodGrain', 0.06, h, 0.1, x, y, z + 0.02, 0x4a2e1a);
    for (let k = 1; k < 4; k++) box(b, 'woodGrain', w, 0.05, 0.08, x, y + (k * h) / 4, z + 0.02, 0x4a2e1a);
    const pane = new THREE.PlaneGeometry(w, h);
    const glass = new THREE.Mesh(pane, this.windowMat);
    glass.position.set(x, y + h / 2, z - 0.05);
    this.root.add(glass);
    const head = new THREE.Mesh(new THREE.CircleGeometry(w / 2, 20, 0, Math.PI), this.windowMat);
    head.position.set(x, y + h, z - 0.05);
    this.root.add(head);
    b.add(m.woodGrain, new THREE.TorusGeometry(w / 2 + 0.04, 0.07, 6, 18, Math.PI), mat(x, y + h, z), { tint: 0x5e3a22 });
    b.add(m.plaster, new THREE.RingGeometry(w / 2 + 0.08, w / 2 + 0.9, 18, 1, 0, Math.PI), mat(x, y + h, z - 0.02), { tint: 0xf0e2c6 });
    // Moonbeam falling into the room.
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.3, 7.5), this.beamMat);
    beam.position.set(x + 0.2, y + h * 0.45 - 1.5, z + 2.3);
    beam.rotation.set(-0.72, 0.08, 0);
    beam.userData.noAO = true;
    beam.renderOrder = 5;
    this.beams.push(beam);
    this.root.add(beam);
  }

  private buildGreatLantern(b: B): void {
    const { x, z } = HALL.dais;
    const m = hallMats();
    // Two-step round dais.
    b.add(m.stone, bevelCylinder(2.3, 2.4, 0.22, 0.05, 32), mat(x, 0.11, z), { tint: 0xb0a898 });
    b.add(m.stone, bevelCylinder(1.6, 1.7, 0.22, 0.05, 28), mat(x, 0.33, z), { tint: 0xc4baa8 });
    // Iron stand: four legs curling up into a crown.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.add(m.metal, new THREE.CylinderGeometry(0.05, 0.07, 2.6, 6), mat(x + Math.cos(a) * 0.55, 1.7, z + Math.sin(a) * 0.55, Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2), { tint: 0x2e2a28 });
      b.add(m.metal, new THREE.TorusGeometry(0.16, 0.035, 5, 12, Math.PI * 1.4), mat(x + Math.cos(a) * 0.75, 0.62, z + Math.sin(a) * 0.75, 0, -a, 0), { tint: 0x2e2a28 });
    }
    b.add(m.metal, new THREE.TorusGeometry(0.72, 0.05, 6, 28), mat(x, 3.0, z, Math.PI / 2), { tint: 0x3a3430 });
    // Lantern body: copper roof, hex frame, six coloured panes (added per room below), finial.
    b.add(m.metal, new THREE.ConeGeometry(0.95, 0.7, 6), mat(x, 4.65, z), { tint: 0xb87a3a });
    b.add(m.metal, new THREE.CylinderGeometry(0.98, 0.98, 0.1, 6), mat(x, 4.28, z), { tint: 0x7a4a24 });
    b.add(m.metal, new THREE.CylinderGeometry(0.9, 0.8, 0.12, 6), mat(x, 3.1, z), { tint: 0x7a4a24 });
    b.add(m.metal, new THREE.SphereGeometry(0.12, 10, 8), mat(x, 5.08, z), { tint: 0xe8b84a });
    b.add(m.metal, new THREE.TorusGeometry(0.14, 0.03, 5, 12), mat(x, 5.28, z), { tint: 0xe8b84a });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.add(m.metal, new THREE.CylinderGeometry(0.04, 0.04, 1.2, 5), mat(x + Math.cos(a) * 0.86, 3.7, z + Math.sin(a) * 0.86), { tint: 0x2e2a28 });
    }
    // Inner flame core (its own material: brightness = rooms lit).
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), this.greatCore);
    core.scale.set(1, 1.5, 1);
    core.position.set(x, 3.7, z);
    this.root.add(core);
    // Offering bowls around the dais (dry until restored).
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      b.add(m.stone, bevelCylinder(0.22, 0.14, 0.18, 0.03, 10), mat(x + Math.cos(a) * 2.0, 0.31, z + Math.sin(a) * 2.0 + 0.2), { tint: 0xa8a090 });
    }
  }

  // ───────────────────────────── rooms

  private buildRoom(shell: B, def: RoomDef): void {
    const f = frameFor(def);
    const glass = new THREE.MeshStandardMaterial({ color: new THREE.Color(def.color).lerp(new THREE.Color(0xffffff), 0.35).multiplyScalar(0.55), emissive: def.color, emissiveIntensity: 0, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.62, depthWrite: false });
    glass.name = `hall-lantern-${def.id}`;
    const core = new THREE.MeshStandardMaterial({ color: 0xfff4e0, emissive: new THREE.Color(def.color).lerp(new THREE.Color(0xfff2d8), 0.55), emissiveIntensity: 0, roughness: 0.4 });
    core.name = `hall-filament-${def.id}`;
    // Low and in front of the lantern so its colour pools on the floor (range 5 m).
    const light = new THREE.PointLight(def.color, 0, 5.5, 1.5);
    light.position.set(f.plinth.x - f.side * 0.25, 1.35, f.plinth.z + 0.55);
    this.root.add(light);
    const dark = new THREE.Group();
    const lit = new THREE.Group();
    const sacks = new THREE.Group();
    const sterile = new THREE.Group();
    dark.name = `hall-dark-${def.id}`;
    lit.name = `hall-lit-${def.id}`;
    sacks.name = `hall-sacks-${def.id}`;
    sterile.name = `hall-sterile-${def.id}`;
    sterile.visible = false;
    this.root.add(dark, lit, sacks, sterile);
    const paneMat = glass.clone();
    paneMat.name = `hall-pane-${def.id}`;
    paneMat.transparent = false;
    paneMat.opacity = 1;
    paneMat.depthWrite = true;
    paneMat.color.copy(new THREE.Color(def.color).multiplyScalar(0.35));
    const pool = poolMaterial(def.color);
    const poolMesh = new THREE.Mesh(new THREE.CircleGeometry(3.2, 40), pool);
    poolMesh.rotation.x = -Math.PI / 2;
    poolMesh.position.set(f.plinth.x - f.side * 0.3, 0.014, f.plinth.z + 0.6);
    poolMesh.renderOrder = 2;
    poolMesh.userData.noAO = true;
    this.root.add(poolMesh);
    this.rooms.set(def.id, { frame: f, dark, lit, sacks, sterile, glass, core, pool, pane: paneMat, light, glow: 0, target: 0, flash: 0, ign: -1, glimmer: false });

    // Plinth + room lantern: a bevelled brass-and-glass lantern with a glowing filament.
    const p = f.plinth;
    const m = hallMats();
    const BRASS = 0xd4a24a;
    const BRASS_D = 0x8a5a24;
    shell.add(m.stone, bevelCylinder(0.62, 0.7, 0.2, 0.04, 16), mat(p.x, 0.1, p.z), { tint: 0xa8a090 });
    shell.add(m.stone, bevelCylinder(0.34, 0.42, 0.8, 0.04, 8), mat(p.x, 0.6, p.z), { tint: 0xc0b6a4 });
    shell.add(m.stone, bevelCylinder(0.5, 0.42, 0.14, 0.04, 8), mat(p.x, 1.06, p.z), { tint: 0xb0a898 });
    shell.add(m.metal, bevelCylinder(0.32, 0.36, 0.08, 0.03, 16), mat(p.x, 1.17, p.z), { tint: BRASS_D });
    shell.add(m.metal, bevelCylinder(0.28, 0.31, 0.06, 0.02, 16), mat(p.x, 1.24, p.z), { tint: BRASS });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      shell.add(m.metal, roundedBox(0.05, 0.64, 0.05, 0.015), mat(p.x + Math.cos(a) * 0.255, 1.27, p.z + Math.sin(a) * 0.255, 0, -a, 0), { tint: BRASS });
    }
    shell.add(m.metal, new THREE.TorusGeometry(0.265, 0.025, 6, 24).rotateX(Math.PI / 2), mat(p.x, 1.6, p.z), { tint: BRASS_D });
    shell.add(m.metal, bevelCylinder(0.31, 0.28, 0.07, 0.02, 16), mat(p.x, 1.92, p.z), { tint: BRASS });
    const dome = new THREE.SphereGeometry(0.29, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.62, 1);
    shell.add(m.metal, dome, mat(p.x, 1.955, p.z), { tint: BRASS });
    shell.add(m.metal, new THREE.ConeGeometry(0.06, 0.16, 8), mat(p.x, 2.2, p.z), { tint: BRASS_D });
    shell.add(m.metal, new THREE.SphereGeometry(0.045, 10, 8), mat(p.x, 2.3, p.z), { tint: 0xf0c060 });
    shell.add(m.metal, new THREE.TorusGeometry(0.08, 0.018, 6, 14), mat(p.x, 2.4, p.z), { tint: BRASS });
    // Wick holder under the filament.
    shell.add(m.metal, bevelCylinder(0.05, 0.07, 0.14, 0.015, 10), mat(p.x, 1.34, p.z), { tint: BRASS_D });
    const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.6, 6, 1, true).rotateY(Math.PI / 6), glass);
    lg.position.set(p.x, 1.58, p.z);
    lg.castShadow = false;
    lg.renderOrder = 3;
    this.root.add(lg);
    const fil = new THREE.SphereGeometry(0.07, 12, 10);
    fil.scale(1, 1.7, 1);
    const fm = new THREE.Mesh(fil, core);
    fm.position.set(p.x, 1.56, p.z);
    fm.castShadow = false;
    fm.userData.noAO = true;
    this.root.add(fm);
    // This room's pane of the Great Lantern + petal of the rose window share the glass.
    const i = ROOMS.indexOf(def);
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.14), paneMat);
    pane.position.set(HALL.dais.x + Math.cos(a) * 0.76, 3.7, HALL.dais.z + Math.sin(a) * 0.76);
    pane.lookAt(HALL.dais.x + Math.cos(a) * 3, 3.7, HALL.dais.z + Math.sin(a) * 3);
    this.root.add(pane);
    const petal = this.pendingPetals.find((q) => q.room === def.id);
    if (petal) {
      const pm = new THREE.Mesh(petal.geo, paneMat);
      pm.applyMatrix4(petal.m);
      this.root.add(pm);
    }
    // Plinth table for the bundle sacks.
    const tx = p.x + f.side * 1.25;
    shell.add(m.woodGrain, roundedBox(1.1, 0.08, 0.7, 0.03), mat(tx, 0.62, p.z + 0.1), { tint: 0x8a5a36 });
    for (const [dx, dz] of [[-0.45, -0.25], [0.45, -0.25], [-0.45, 0.45], [0.45, 0.45]] as const) shell.add(m.woodGrain, roundedBox(0.07, 0.6, 0.07, 0.02), mat(tx + dx, 0.3, p.z + dz), { tint: 0x6a4226 });
    this.blockRect(Math.min(p.x, tx) - 0.5, p.z - 0.5, Math.max(p.x, tx) + 0.5, p.z + 0.6);

    // Themed furniture (shared by both states) + the two dressings.
    const db = new MeshBuilder();
    const lb = new MeshBuilder();
    this.furnish(shell, db, lb, f);
    this.dressDark(db, f);
    this.dressLit(lb, f);
    const dg = db.build({ name: `hall-dark-${def.id}` });
    const lgp = lb.build({ name: `hall-lit-${def.id}` });
    dark.add(dg);
    lit.add(lgp);
    lit.visible = false;
    this.dressSterile(sterile, f);
  }

  /** Place furniture; `dark`/`lit` builders get the state-specific bits (sheets vs. uncovered). */
  private furnish(b: B, dark: B, lit: B, f: RoomFrame): void {
    const { X, side } = f;
    const z = f.def.z;
    const r = this.rng.fork(f.def.id);
    const shelf = (u: number, zc: number, w: number, h: number, alongZ: boolean, jars: number[]): void => {
      // A tall open shelf unit against a wall with jars / crocks on each board.
      const sx = X(u);
      const bw = alongZ ? 0.45 : w;
      const bd = alongZ ? w : 0.45;
      box(b, 'woodGrain', bw, h, bd, sx, 0, zc, 0x6a4226, 0, 0.03);
      for (let k = 0; k < 4; k++) {
        const y = 0.25 + k * ((h - 0.35) / 3);
        box(b, 'woodGrain', bw + 0.06, 0.05, bd + 0.06, sx, y, zc, 0x8a5a36, 0, 0.015);
        const n = Math.floor(w / 0.26);
        for (let q = 0; q < n; q++) {
          if (r.next() < 0.25) continue;
          const o = -w / 2 + 0.16 + q * 0.26;
          const jx = alongZ ? sx : sx + o;
          const jz = alongZ ? zc + o : zc;
          const c = jars[Math.floor(r.next() * jars.length)]!;
          const jh = 0.14 + r.next() * 0.1;
          cyl(b, 'cloth', 0.07, 0.075, jh, jx, y + 0.03 + jh / 2, jz, c, 8);
          cyl(b, 'cloth', 0.075, 0.075, 0.03, jx, y + 0.05 + jh, jz, 0xe8dcc0, 8);
        }
      }
      this.blockRect(sx - bw / 2, zc - bd / 2, sx + bw / 2, zc + bd / 2);
    };
    const table = (x: number, zc: number, w: number, d: number, tint = 0x8a5a36): void => {
      box(b, 'woodGrain', w, 0.08, d, x, 0.72, zc, tint, 0, 0.03);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) box(b, 'woodGrain', 0.08, 0.72, 0.08, x + (dx * (w - 0.16)) / 2, 0, zc + (dz * (d - 0.16)) / 2, 0x6a4226, 0, 0.02);
      this.blockRect(x - w / 2, zc - d / 2, x + w / 2, zc + d / 2);
    };
    const barrel = (x: number, zc: number, tint = 0x8a5a36, s = 1): void => {
      b.add(hallMats().wood, bevelCylinder(0.3 * s, 0.28 * s, 0.8 * s, 0.04, 12), mat(x, 0.4 * s, zc), { tint });
      for (const y of [0.15, 0.65]) b.add(hallMats().metal, new THREE.TorusGeometry(0.3 * s, 0.018, 4, 16), mat(x, y * s, zc, Math.PI / 2), { tint: 0x3a3430 });
      this.blockRect(x - 0.3, zc - 0.3, x + 0.3, zc + 0.3);
    };
    const pot = (bb: B, x: number, zc: number, s: number, leaf: number, bloom?: number): void => {
      bb.add(hallMats().cloth, bevelCylinder(0.16 * s, 0.12 * s, 0.24 * s, 0.02, 10), mat(x, 0.12 * s, zc), { tint: 0xb8643e });
      const top = lumpySphere(0.24 * s, 1, 0.1, r, 2.2);
      bb.add(hallMats().leaf, top, mat(x, 0.36 * s, zc, 0, 0, 0, 1, 0.9, 1), { tint: leaf });
      if (bloom !== undefined) for (let k = 0; k < 5; k++) bb.add(hallMats().leaf, new THREE.SphereGeometry(0.045 * s, 6, 5), mat(x + (r.next() - 0.5) * 0.3 * s, 0.44 * s + r.next() * 0.12 * s, zc + (r.next() - 0.5) * 0.3 * s), { tint: bloom });
    };
    switch (f.def.id) {
      case 'seed': {
        shelf(0.4, z - 1.2, 2.4, 2.3, true, [0xd8c8a0, 0xc8a878, 0xa8c890, 0xe8c070, 0xb89a70]);
        shelf(2.6, f.z0 + 0.45, 2.6, 2.1, false, [0xd8c8a0, 0xe8a070, 0xa8c890, 0xf0d890]);
        table(X(2.2), z + 1.9, 2.2, 0.8);
        for (let k = 0; k < 4; k++) pot(lit, X(1.4 + k * 0.5), z + 1.9, 0.9, 0x5a9a3a, k % 2 ? 0xff9ec0 : undefined);
        for (let k = 0; k < 4; k++) pot(dark, X(1.4 + k * 0.5), z + 1.9, 0.9, 0x6a5a3a);
        // seed sacks by the arch
        for (let k = 0; k < 3; k++) b.add(hallMats().cloth, lumpySphere(0.3, 1, 0.12, r, 2), mat(X(6.6 + k * 0.55), 0.26, f.z0 + 0.6 + (k % 2) * 0.3, 0, 0, 0, 1, 1.2, 1), { tint: 0xc8a878 });
        this.blockRect(X(6.4) - 0.4, f.z0 + 0.2, X(8) + 0.4, f.z0 + 1.1);
        break;
      }
      case 'sun': {
        // Cold frames (glass boxes on timber) along the back wall.
        for (const u of [1.4, 3.8]) {
          box(b, 'woodGrain', 2.0, 0.5, 0.9, X(u + 0.6), 0, f.z0 + 0.7, 0x8a5a36);
          b.add(hallMats().glass, roundedBox(1.9, 0.5, 0.8, 0.02), mat(X(u + 0.6), 0.75, f.z0 + 0.7));
          for (let k = 0; k < 5; k++) lit.add(hallMats().leaf, lumpySphere(0.13, 0, 0.1, r), mat(X(u + 0.6) - 0.7 + k * 0.35, 0.58, f.z0 + 0.7), { tint: 0x6aaa3a });
          this.blockRect(X(u + 0.6) - 1, f.z0 + 0.2, X(u + 0.6) + 1, f.z0 + 1.1);
        }
        // Potted citrus trees in the corners.
        for (const [u, zz] of [[0.7, z + 2.2], [7.8, f.z0 + 0.8]] as const) {
          b.add(hallMats().cloth, bevelCylinder(0.34, 0.26, 0.5, 0.03, 12), mat(X(u), 0.25, zz), { tint: 0xc8704a });
          b.add(hallMats().woodGrain, new THREE.CylinderGeometry(0.05, 0.07, 1.0, 6), mat(X(u), 0.95, zz), { tint: 0x6a4226 });
          lit.add(hallMats().leaf, lumpySphere(0.62, 1, 0.16, r, 2), mat(X(u), 1.75, zz), { tint: 0x4a8a34 });
          for (let k = 0; k < 7; k++) lit.add(hallMats().leaf, new THREE.SphereGeometry(0.07, 8, 6), mat(X(u) + (r.next() - 0.5) * 0.9, 1.5 + r.next() * 0.7, zz + (r.next() - 0.5) * 0.9), { tint: 0xf2c43a });
          dark.add(hallMats().leaf, new THREE.CylinderGeometry(0.02, 0.04, 0.8, 5), mat(X(u) + 0.15, 1.6, zz, 0, 0, 0.5), { tint: 0x5a4a30 });
          dark.add(hallMats().leaf, new THREE.CylinderGeometry(0.02, 0.04, 0.7, 5), mat(X(u) - 0.1, 1.55, zz, 0.4, 0, -0.4), { tint: 0x5a4a30 });
          this.blockRect(X(u) - 0.35, zz - 0.35, X(u) + 0.35, zz + 0.35);
        }
        // Wicker settee.
        box(b, 'woodGrain', 1.8, 0.42, 0.7, X(3.2), 0, z + 2.1, 0xc8a060);
        box(b, 'woodGrain', 1.8, 0.5, 0.14, X(3.2), 0.42, z + 2.45, 0xc8a060);
        lit.add(hallMats().cloth, roundedBox(0.7, 0.14, 0.55, 0.06), mat(X(2.8), 0.49, z + 2.05), { tint: 0xf2c43a });
        lit.add(hallMats().cloth, roundedBox(0.7, 0.14, 0.55, 0.06), mat(X(3.6), 0.49, z + 2.05), { tint: 0xe8674a });
        this.blockRect(X(3.2) - 0.9, z + 1.7, X(3.2) + 0.9, z + 2.5);
        break;
      }
      case 'harvest': {
        // Long table with benches.
        table(X(3.4), z + 1.2, 3.8, 1.0, 0x7a4a2a);
        for (const dz of [-0.75, 0.75]) box(b, 'woodGrain', 3.4, 0.08, 0.34, X(3.4), 0.44, z + 1.2 + dz, 0x6a4226);
        // Barrels + cider press along the outer wall.
        for (let k = 0; k < 3; k++) barrel(X(0.5), f.z0 + 0.7 + k * 0.7, [0x8a5a36, 0x7a4a2a, 0x9a6a40][k]);
        barrel(X(1.2), f.z0 + 0.6, 0x8a5a36, 0.85);
        box(b, 'woodGrain', 0.9, 0.9, 0.9, X(6.6), 0, f.z0 + 0.6, 0x6a4226);
        b.add(hallMats().metal, new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), mat(X(6.6), 1.3, f.z0 + 0.6), { tint: 0x3a3430 });
        b.add(hallMats().metal, new THREE.TorusGeometry(0.3, 0.04, 6, 14), mat(X(6.6), 1.72, f.z0 + 0.6, Math.PI / 2), { tint: 0x3a3430 });
        this.blockRect(X(6.6) - 0.45, f.z0 + 0.15, X(6.6) + 0.45, f.z0 + 1.05);
        // Hay bale + pumpkins.
        box(b, 'cloth', 1.2, 0.55, 0.7, X(8.5), 0, z + 2.3, 0xd8b868, 0.3, 0.1);
        this.blockRect(X(8.5) - 0.6, z + 1.9, X(8.5) + 0.6, z + 2.7);
        for (let k = 0; k < 3; k++) lit.add(hallMats().leaf, lumpySphere(0.22 - k * 0.03, 1, 0.08, r), mat(X(7.6 + k * 0.4), 0.2, z + 2.6 - k * 0.2, 0, 0, 0, 1.1, 0.8, 1.1), { tint: 0xe8812e });
        // Candles + a loaf on the table (lit only).
        for (const u of [2.4, 4.4]) {
          lit.add(hallMats().candle, new THREE.CylinderGeometry(0.035, 0.035, 0.22, 8), mat(X(u), 0.87, z + 1.2));
        }
        lit.add(hallMats().cloth, roundedBox(3.4, 0.01, 0.4, 0.004), mat(X(3.4), 0.77, z + 1.2), { tint: 0xe8d8b8 });
        lit.add(hallMats().leaf, lumpySphere(0.14, 1, 0.05, r), mat(X(3.4), 0.84, z + 1.2, 0, 0, 0, 1.6, 0.7, 1), { tint: 0xc8843a });
        break;
      }
      case 'hearth': {
        // The great hearth on the outer wall.
        const hz = z + 0.2;
        box(b, 'stone', 1.1, 2.7, 3.2, X(0.45), 0, hz, 0xb0a290, 0, 0.06);
        box(b, 'stone', 0.8, 1.9, 3.4, X(0.4), 2.7, hz, 0xa89a88, 0, 0.05);
        box(b, 'stone', 0.5, 1.05, 1.5, X(1.0), 0, hz, 0x2a2420, 0, 0.03); // firebox mouth (dark)
        box(b, 'woodGrain', 0.5, 0.16, 3.5, X(1.1), 1.35, hz, 0x5e3a22); // mantel
        box(b, 'stone', 1.0, 0.1, 3.3, X(1.35), 0, hz, 0x8a8076); // hearthstone
        this.blockRect(X(0) - 0.5, hz - 1.7, X(1.6) + 0.1, hz + 1.7);
        // Andirons + logs (lit: burning, dark: cold ash).
        lit.add(hallMats().woodGrain, new THREE.CylinderGeometry(0.08, 0.08, 0.8, 6).rotateX(Math.PI / 2), mat(X(0.9), 0.2, hz - 0.1, 0, 0.3, 0), { tint: 0x3a2618 });
        lit.add(hallMats().woodGrain, new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6).rotateX(Math.PI / 2), mat(X(0.95), 0.32, hz + 0.1, 0, -0.4, 0), { tint: 0x3a2618 });
        dark.add(hallMats().cloth, lumpySphere(0.3, 1, 0.1, r), mat(X(0.95), 0.08, hz, 0, 0, 0, 1.3, 0.3, 1), { tint: 0x6a6660 });
        // Mantel things: clock, candlesticks, a portrait frame above.
        box(b, 'woodGrain', 0.25, 0.4, 0.3, X(1.05), 1.51, hz, 0x6a4226);
        lit.add(hallMats().candle, new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), mat(X(1.1), 1.61, hz - 1.1));
        lit.add(hallMats().candle, new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), mat(X(1.1), 1.61, hz + 1.1));
        box(b, 'woodGrain', 0.08, 0.9, 1.2, X(0.9), 2.0, hz, 0xc8a050);
        box(b, 'cloth', 0.04, 0.72, 1.02, X(0.95), 2.09, hz, 0x6a8a9a);
        // Armchairs + side table + firewood stack.
        for (const dz of [-1.3, 1.3]) {
          const cx = X(3.1);
          box(b, 'cloth', 0.9, 0.45, 0.85, cx, 0, hz + dz, 0x7a3a3a, 0, 0.12);
          box(b, 'cloth', 0.9, 0.7, 0.2, cx + side * 0.36, 0.4, hz + dz, 0x7a3a3a, 0, 0.1);
          this.blockRect(cx - 0.45, hz + dz - 0.45, cx + 0.45, hz + dz + 0.45);
        }
        for (let k = 0; k < 9; k++) b.add(hallMats().woodGrain, new THREE.CylinderGeometry(0.1, 0.1, 0.9, 7).rotateZ(Math.PI / 2), mat(X(7.4), 0.1 + Math.floor(k / 3) * 0.19, f.z0 + 0.55 + (k % 3) * 0.21 + (Math.floor(k / 3) % 2) * 0.1, 0, Math.PI / 2, 0), { tint: [0x8a5a36, 0x7a4a2a, 0x9a6a40][k % 3] });
        this.blockRect(X(7.4) - 0.5, f.z0 + 0.3, X(7.4) + 0.5, f.z0 + 1.2);
        break;
      }
      case 'craft': {
        // Workbench along the outer wall with a pegboard of tools.
        table(X(0.7), z - 0.2, 0.9, 2.6, 0x7a4a2a);
        box(b, 'woodGrain', 0.06, 1.2, 2.4, X(0.08), 1.0, z - 0.2, 0xb88a5a);
        for (let k = 0; k < 6; k++) b.add(hallMats().metal, roundedBox(0.04, 0.35, 0.08, 0.01), mat(X(0.15), 1.5, z - 1.1 + k * 0.36, 0, 0, (r.next() - 0.5) * 0.3), { tint: k % 2 ? 0xa8aeb4 : 0x8a5a36 });
        // Loom.
        const lx = X(4.8);
        const lz = f.z0 + 0.8;
        for (const dx of [-0.8, 0.8]) box(b, 'woodGrain', 0.1, 1.6, 0.1, lx + dx, 0, lz, 0x8a5a36);
        box(b, 'woodGrain', 1.8, 0.1, 0.12, lx, 1.55, lz, 0x8a5a36);
        box(b, 'woodGrain', 1.8, 0.08, 0.5, lx, 0.72, lz + 0.2, 0x8a5a36);
        lit.add(hallMats().cloth, roundedBox(1.4, 0.7, 0.02, 0.01), mat(lx, 1.15, lz), { tint: 0x5a9a8a });
        for (let k = 0; k < 5; k++) lit.add(hallMats().cloth, roundedBox(1.4, 0.06, 0.025, 0.01), mat(lx, 0.9 + k * 0.12, lz), { tint: [0xe8b64a, 0xd8573e, 0xf2ead2][k % 3] });
        this.blockRect(lx - 0.9, lz - 0.2, lx + 0.9, lz + 0.5);
        // Lumber + stone blocks.
        for (let k = 0; k < 5; k++) box(b, 'woodGrain', 2.2, 0.12, 0.2, X(7.6), k * 0.12, z + 2.2 - (k % 2) * 0.22, 0xb88a5a, 0, 0.02);
        for (let k = 0; k < 3; k++) box(b, 'stone', 0.45, 0.35, 0.45, X(8.8 - k * 0.5), 0, z - 1.4 + (k % 2) * 0.3, 0xb0a898);
        this.blockRect(X(6.5), z + 1.8, X(8.7), z + 2.5);
        // Spools.
        for (let k = 0; k < 3; k++) lit.add(hallMats().cloth, new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10), mat(X(0.8), 0.81, z + 0.6 + k * 0.16), { tint: [0xe8574a, 0x4a8ab8, 0xf2c43a][k] });
        break;
      }
      case 'tide': {
        // Two aquariums on stands along the outer wall.
        for (const dz of [-1.2, 1.2]) {
          const ax = X(0.75);
          box(b, 'woodGrain', 1.0, 0.7, 2.0, ax, 0, z + dz * 0.95, 0x5a4a3a);
          b.add(hallMats().glass, roundedBox(0.9, 0.8, 1.9, 0.02), mat(ax, 1.1, z + dz * 0.95));
          lit.add(hallMats().water, roundedBox(0.84, 0.66, 1.84, 0.01), mat(ax, 1.05, z + dz * 0.95));
          dark.add(hallMats().cloth, roundedBox(0.84, 0.08, 1.84, 0.01), mat(ax, 0.76, z + dz * 0.95), { tint: 0x6a6450 });
          for (let k = 0; k < 4; k++) lit.add(hallMats().leaf, new THREE.ConeGeometry(0.05, 0.35 + r.next() * 0.2, 5), mat(ax + (r.next() - 0.5) * 0.5, 0.95, z + dz * 0.95 + (r.next() - 0.5) * 1.4), { tint: 0x3a9a5a });
          this.blockRect(ax - 0.5, z + dz * 0.95 - 1, ax + 0.5, z + dz * 0.95 + 1);
        }
        // Rowboat hanging on the knee wall side / crab pots / anchor.
        // A painted rowboat on trestles: hull (bowl-up), cream gunwale, thwarts and a pair of oars.
        const bx = X(5.2);
        const bz = f.z1 - 0.9;
        const hull = new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
        hull.scale(1.3, 0.42, 0.52);
        b.add(hallMats().woodGrain, hull, mat(bx, 0.72, bz), { tint: 0x4a9ab8 });
        b.add(hallMats().woodGrain, new THREE.TorusGeometry(1, 0.05, 5, 28).scale(1.3, 0.52, 1), mat(bx, 0.72, bz, Math.PI / 2, 0, 0), { tint: 0xf2ead2 });
        b.add(hallMats().woodGrain, new THREE.CircleGeometry(1, 24).scale(1.22, 0.46, 1), mat(bx, 0.6, bz, -Math.PI / 2, 0, 0), { tint: 0xb88a5a });
        for (const dx of [-0.45, 0.35]) b.add(hallMats().woodGrain, roundedBox(0.16, 0.05, 0.92, 0.015), mat(bx + dx, 0.66, bz), { tint: 0xc89a64 });
        for (const dx of [-0.9, 0.9]) box(b, 'woodGrain', 0.12, 0.34, 0.7, bx + dx, 0, bz, 0x6a4226);
        for (const s of [-1, 1]) {
          b.add(hallMats().woodGrain, new THREE.CylinderGeometry(0.03, 0.03, 1.9, 6), mat(bx + 0.1, 0.8, bz + s * 0.18, 0, 0, Math.PI / 2 + s * 0.06), { tint: 0xd8b07a });
          b.add(hallMats().woodGrain, roundedBox(0.36, 0.02, 0.12, 0.01), mat(bx + 1.05, 0.8 + s * 0.06, bz + s * 0.18, 0, 0, s * 0.06), { tint: 0xd84a3a });
        }
        this.blockRect(bx - 1.4, f.z1 - 1.4, bx + 1.4, f.z1 - 0.4);
        for (let k = 0; k < 2; k++) {
          const cx = X(8.2 + k * 0.7);
          b.add(hallMats().woodGrain, new THREE.CylinderGeometry(0.3, 0.3, 0.45, 8, 1, true), mat(cx, 0.23, f.z0 + 0.7), { tint: 0x8a6a48 });
          b.add(hallMats().cloth, new THREE.CylinderGeometry(0.28, 0.28, 0.02, 8), mat(cx, 0.45, f.z0 + 0.7), { tint: 0x9aa890 });
        }
        this.blockRect(X(8.2) - 0.3, f.z0 + 0.35, X(8.9) + 0.3, f.z0 + 1.05);
        // Net draped on the back half wall.
        b.add(hallMats().cloth, new THREE.PlaneGeometry(2.4, 0.9, 6, 3), mat(X(4.5), 1.0, f.z0 + 0.2), { tint: 0x9a9070 });
        break;
      }
    }
  }

  private dressDark(b: B, f: RoomFrame): void {
    const r = this.rng.fork(`dark-${f.def.id}`);
    const m = hallMats();
    const { X } = f;
    const z = f.def.z;
    // Dust sheets over the furniture: dull beige-grey, heavy folds (not bright marshmallows).
    const sheets = f.def.id === 'hearth' ? [[3.1, -1.3], [3.1, 1.3]] : f.def.id === 'harvest' ? [[3.4, 1.2]] : f.def.id === 'sun' ? [[3.2, 2.1]] : [[5.4, 2.2]];
    const SHEET = [0x8c8476, 0x857d70, 0x91887a];
    for (const [u, dz] of sheets) {
      const w = 1.3 + r.next() * 0.5;
      b.add(m.cloth, drapedSheet(r, w, 0.95 + r.next() * 0.35, w * (0.7 + r.next() * 0.2)), mat(X(u!), 0, z + dz!, 0, (r.next() - 0.5) * 0.6, 0), { tint: SHEET[Math.floor(r.next() * 3)]! });
    }
    b.add(m.cloth, drapedSheet(r, 0.75, 0.85, 0.7), mat(X(6.3), 0, z - 1.9, 0, r.next(), 0), { tint: 0x837b6e });
    b.add(m.cloth, drapedSheet(r, 1.0, 0.22, 0.7), mat(X(8.2), 0, z + 2.3, 0, r.next() * 3, 0), { tint: 0x7c7468 });
    // Blown-in leaves, drifted towards the walls.
    for (let k = 0; k < 40; k++) {
      const leaf = new THREE.CircleGeometry(0.07 + r.next() * 0.05, 5);
      leaf.rotateX(-Math.PI / 2);
      const u = k < 22 ? 0.3 + r.next() * 1.4 : 1.5 + r.next() * 8;
      b.add(m.leaf, leaf, mat(X(u), 0.012 + k * 0.0004, z + (r.next() - 0.5) * 5.4, 0, r.next() * 6, 0), { tint: [0x8a4a24, 0xa8602c, 0x6a4a2a, 0x7a6a34][k % 4] });
    }
    // Toppled crates, a broken chair, barrel staves, plaster fallen from the ceiling.
    b.add(m.woodGrain, boxUV(roundedBox(0.55, 0.45, 0.55, 0.03), 1), mat(X(7.2), 0.25, z + 0.9, 0.2, 0.6, 1.3), { tint: 0x7a5a3a });
    b.add(m.woodGrain, boxUV(roundedBox(0.5, 0.5, 0.5, 0.03), 1), mat(X(8.6), 0.25, z - 0.6, 0, 0.3, 0), { tint: 0x6a4a30 });
    b.add(m.woodGrain, boxUV(roundedBox(0.42, 0.36, 0.42, 0.03), 1), mat(X(8.5), 0.68, z - 0.55, 0, 0.9, 0.12), { tint: 0x7a5a3a });
    for (let k = 0; k < 4; k++) b.add(m.woodGrain, roundedBox(0.09, 0.03, 0.7, 0.01), mat(X(6.2 + r.next() * 1.5), 0.02, z - 2.2 + r.next() * 1.2, 0, r.next() * 3, 0.05), { tint: 0x6a4a2a });
    const cx = X(1.6);
    const cz = z - 2.1;
    b.add(m.woodGrain, roundedBox(0.44, 0.05, 0.44, 0.02), mat(cx, 0.2, cz, 0.3, 0.4, 1.35), { tint: 0x7a5234 });
    for (const [dx, dz, rx] of [[-0.18, -0.18, 0.9], [0.2, 0.1, 1.2], [0.05, 0.25, 0.4]] as const) b.add(m.woodGrain, roundedBox(0.05, 0.45, 0.05, 0.015), mat(cx + dx, 0.06, cz + dz, rx, r.next() * 3, 0), { tint: 0x6a4226 });
    for (let k = 0; k < 7; k++) b.add(m.plaster, lumpySphere(0.07 + r.next() * 0.1, 0, 0.3, r), mat(X(2.5 + r.next() * 5), 0.03, z + (r.next() - 0.5) * 4.6, 0, 0, 0, 1, 0.45, 1), { tint: 0xc8bca6 });
    // Dry, dead stalks in the plinth vase.
    b.add(m.cloth, bevelCylinder(0.09, 0.07, 0.24, 0.02, 8), mat(f.plinth.x + f.side * 0.62, 0.12, f.plinth.z + 0.5), { tint: 0x6a5a4a });
    for (let k = 0; k < 4; k++) b.add(m.leaf, new THREE.CylinderGeometry(0.008, 0.012, 0.42, 4), mat(f.plinth.x + f.side * 0.62, 0.42, f.plinth.z + 0.5, (r.next() - 0.5) * 0.9, 0, (r.next() - 0.5) * 0.9), { tint: 0x6a5a3a });
    // Weeds pushing up through the broken floor and along the wall foot; ivy creeping in at the outer wall.
    const weed = (x: number, zz: number, n: number, h: number): void => {
      for (let k = 0; k < n; k++) {
        const blade = leafBlade(h * (0.6 + r.next() * 0.6), 0.05 + r.next() * 0.04, 0.35 + r.next() * 0.4, 3);
        b.add(m.leaf, blade, mat(x + (r.next() - 0.5) * 0.25, 0, zz + (r.next() - 0.5) * 0.25, (r.next() - 0.5) * 0.4, r.next() * Math.PI * 2, (r.next() - 0.5) * 0.4), { tint: [0x5a7a34, 0x6a8a3a, 0x4a6a2e, 0x7a8a44][k % 4] });
      }
    };
    for (const [hx, hz, , , kind] of HOLES) {
      if (Math.abs(hx - f.def.x) > 5.2 || Math.abs(hz - z) > 3.1) continue;
      weed(hx, hz, kind === 'flag' ? 9 : 6, kind === 'flag' ? 0.5 : 0.42);
      if (kind === 'plank') {
        // Splintered board ends standing proud of the hole.
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + r.next();
          b.add(m.woodGrain, roundedBox(0.1, 0.03, 0.34 + r.next() * 0.2, 0.01), mat(hx + Math.cos(a) * 0.3, 0.05, hz + Math.sin(a) * 0.45, (r.next() - 0.5) * 0.7, r.next() * 0.3, (r.next() - 0.5) * 0.5), { tint: 0x9a7048 });
        }
      } else if (kind === 'tile') {
        for (let k = 0; k < 3; k++) b.add(m.stone, roundedBox(0.2, 0.03, 0.18, 0.01), mat(hx + (r.next() - 0.5) * 1.5, 0.015, hz + (r.next() - 0.5) * 1.3, 0, r.next() * 3, (r.next() - 0.5) * 0.3), { tint: 0x8a8274 });
      }
    }
    for (let k = 0; k < 3; k++) weed(X(0.35), z - 2.4 + k * 2.2 + r.next() * 0.4, 5, 0.34);
    // Ivy: stems climbing the outer wall from a floor crack, clusters of leaves along them.
    for (let v = 0; v < 2; v++) {
      const vz = z - 1.6 + v * 3.1 + r.next() * 0.5;
      let y = 0;
      let dz = 0;
      for (let k = 0; k < 11; k++) {
        const ny = y + 0.2 + r.next() * 0.1;
        const ndz = dz + (r.next() - 0.5) * 0.22;
        b.add(m.leaf, new THREE.CylinderGeometry(0.012, 0.015, ny - y + 0.03, 4), mat(X(0.08), (y + ny) / 2, vz + (dz + ndz) / 2, (ndz - dz) * 1.5, 0, 0), { tint: 0x4a5a2a });
        for (let q = 0; q < 2; q++) b.add(m.leaf, lumpySphere(0.06 + r.next() * 0.04, 0, 0.3, r), mat(X(0.12), ny, vz + ndz + (q ? 0.08 : -0.08), 0, 0, 0, 0.35, 1, 1), { tint: [0x4a7a30, 0x5a8a36, 0x3f6a2a][Math.floor(r.next() * 3)]! });
        y = ny;
        dz = ndz;
      }
    }
    // Cobwebs: in the outer back corner (high), over the plinth lantern, between a shelf and the wall.
    const webG = (s: number): THREE.BufferGeometry => new THREE.CircleGeometry(s, 10, 0, Math.PI / 2);
    b.add(m.web, webG(1.0), mat(X(0.22), f.def.id === 'hearth' ? 3.8 : 2.4, f.z0 + 0.22, 0, f.side > 0 ? Math.PI / 4 : -Math.PI / 4 - Math.PI / 2, Math.PI));
    b.add(m.web, webG(0.8), mat(X(0.22), 2.3, f.z1 - 0.3, 0, f.side > 0 ? -Math.PI / 4 - Math.PI / 2 + Math.PI : Math.PI / 4, Math.PI));
    b.add(m.web, new THREE.CircleGeometry(0.42, 10), mat(f.plinth.x, 1.66, f.plinth.z + 0.3, 0, 0, 0.3));
    b.add(m.web, new THREE.PlaneGeometry(0.9, 0.7), mat(f.plinth.x + f.side * 0.8, 1.05, f.plinth.z + 0.12, 0, 0, 0));
    // The Tide Room's tanks: dry, cracked, crusted.
    if (f.def.id === 'tide') {
      for (const dz of [-1.2, 1.2]) {
        const ax = X(0.75);
        const az = z + dz * 0.95;
        b.add(m.web, new THREE.PlaneGeometry(1.8, 0.76), mat(ax - f.side * 0.47, 1.1, az, 0, f.side > 0 ? Math.PI / 2 : -Math.PI / 2, 0));
        b.add(m.cloth, roundedBox(0.84, 0.06, 1.84, 0.01), mat(ax, 0.73, az), { tint: 0x7a6a4a });
        for (let k = 0; k < 6; k++) b.add(m.leaf, lumpySphere(0.05, 0, 0.3, r), mat(ax + (r.next() - 0.5) * 0.6, 0.78, az + (r.next() - 0.5) * 1.6, 0, 0, 0, 1, 0.4, 1), { tint: 0x5a6a3a });
      }
      // A shattered pane on the floor.
      for (let k = 0; k < 8; k++) b.add(m.glass, new THREE.CircleGeometry(0.06 + r.next() * 0.08, 3).rotateX(-Math.PI / 2), mat(X(1.5) + (r.next() - 0.5) * 0.8, 0.012, z - 0.2 + (r.next() - 0.5) * 1.2, 0, r.next() * 3, 0));
    }
  }

  private dressLit(b: B, f: RoomFrame): void {
    const r = this.rng.fork(`lit-${f.def.id}`);
    const m = hallMats();
    const accent = f.def.color;
    // Woven room rug (its own texture) with a tasselled fringe at both ends.
    const rx = f.X(4.6);
    const rz = f.def.z + 0.9;
    const rugMat = new THREE.MeshStandardMaterial({ map: rugTexture(accent, `rug-${f.def.id}`), roughness: 1 });
    rugMat.name = `hall-rug-${f.def.id}`;
    b.add(rugMat, new THREE.PlaneGeometry(3.4, 2.0).rotateX(-Math.PI / 2), mat(rx, 0.016, rz));
    for (const sx of [-1, 1]) for (let k = 0; k < 11; k++) b.add(m.cloth, roundedBox(0.14, 0.012, 0.035, 0.005), mat(rx + sx * 1.76, 0.01, rz - 0.9 + k * 0.18), { tint: 0xe8d8b0 });
    void r;
    // Flowers in the plinth vase.
    const vx = f.plinth.x + f.side * 0.62;
    const vz = f.plinth.z + 0.5;
    b.add(m.cloth, bevelCylinder(0.09, 0.07, 0.24, 0.02, 8), mat(vx, 0.12, vz), { tint: 0x5a8ab8 });
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      b.add(m.leaf, new THREE.CylinderGeometry(0.008, 0.01, 0.34, 4), mat(vx + Math.cos(a) * 0.04, 0.38, vz + Math.sin(a) * 0.04, Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3), { tint: 0x4a8a34 });
      b.add(m.leaf, new THREE.SphereGeometry(0.05, 7, 5), mat(vx + Math.cos(a) * 0.1, 0.56 + r.next() * 0.05, vz + Math.sin(a) * 0.1), { tint: [accent, 0xffffff, 0xffd166][k % 3] });
    }
    // Bunting along the outer wall top.
    const n = 9;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const zz = f.z0 + 0.4 + t * 5.2;
      const y = 3.35 - Math.sin(t * Math.PI) * 0.35;
      const flag = new THREE.ConeGeometry(0.13, 0.3, 3);
      flag.rotateZ(Math.PI);
      b.add(m.cloth, flag, mat(f.X(0.12), y, zz, 0, Math.PI / 2, 0, 1, 1, 0.2), { tint: [accent, 0xf2ead2, new THREE.Color(accent).multiplyScalar(0.7).getHex()][k % 3] });
    }
    // Candles on the plinth base.
    for (const dz of [-0.35, 0.35]) b.add(m.candle, new THREE.CylinderGeometry(0.035, 0.035, 0.18 + r.next() * 0.08, 8), mat(f.plinth.x - f.side * 0.52, 0.3, f.plinth.z + dz));
    // (Only materials this builder already uses — cloth, leaf, candle — so the dressing adds no draw calls.)
    // Festoon strings of warm bulbs from the outer wall to the nave arcade (back and front of the room):
    // the room reads as "someone is having a party in here" from the gameplay camera.
    const bulb = new THREE.SphereGeometry(0.055, 8, 6);
    for (const [zA, zB, y0, sag] of [[f.z0 + 0.55, f.z0 + 1.1, 3.05, 0.5], [f.z1 - 0.45, f.z1 - 1.0, 2.75, 0.4]] as const) {
      const u0 = 0.25;
      const u1 = 9.35;
      const N = 15;
      let prev: THREE.Vector3 | null = null;
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const p = new THREE.Vector3(f.X(u0 + (u1 - u0) * t), y0 - Math.sin(t * Math.PI) * sag, zA + (zB - zA) * t);
        if (prev) {
          const d = p.clone().sub(prev);
          const seg = new THREE.CylinderGeometry(0.01, 0.01, d.length(), 4);
          seg.rotateZ(Math.PI / 2);
          const yaw = Math.atan2(-d.z, d.x);
          const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
          b.add(m.cloth, seg, mat((p.x + prev.x) / 2, (p.y + prev.y) / 2, (p.z + prev.z) / 2, 0, yaw, pitch), { tint: 0x3a2a20 });
        }
        if (k > 0 && k < N) b.add(m.candle, bulb, mat(p.x, p.y - 0.07, p.z));
        prev = p;
      }
    }
    // A harvest basket of the room's goods by the rug, and a second small one by the outer wall.
    const GOODS: Record<RoomId, number[]> = {
      seed: [0xf2dfa8, 0x8fc46a, 0xe8607a, 0xf3efe0],
      sun: [0xe8573e, 0xf2c43a, 0xffd166, 0x8fbf4a],
      harvest: [0xe8812e, 0xc8955a, 0xd8573e, 0xf2c43a],
      hearth: [0xd8573e, 0xf3e6c8, 0x9ad8ff, 0xc8955a],
      craft: [0x8ab86a, 0xc8a068, 0x5a9ab8, 0xd8b04a],
      tide: [0x5fe3d6, 0x9ac8e8, 0xf2c46a, 0x7a9a5a],
    };
    const goods = GOODS[f.def.id];
    for (const [u, dz, s] of [[7.9, 2.25, 1], [1.1, -0.2, 0.8]] as const) {
      const bx = f.X(u);
      const bz = f.def.z + dz;
      b.add(m.cloth, bevelCylinder(0.34 * s, 0.26 * s, 0.26 * s, 0.04, 12), mat(bx, 0.13 * s, bz), { tint: 0xb8864e });
      b.add(m.cloth, new THREE.TorusGeometry(0.34 * s, 0.03, 5, 16).rotateX(Math.PI / 2), mat(bx, 0.26 * s, bz), { tint: 0x8a5a30 });
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + r.next();
        const rr = k === 0 ? 0 : 0.17 * s;
        b.add(m.leaf, lumpySphere((0.09 + r.next() * 0.04) * s, 0, 0.25, r), mat(bx + Math.cos(a) * rr, 0.3 * s + (k === 0 ? 0.07 : 0), bz + Math.sin(a) * rr), { tint: goods[k % goods.length]! });
      }
    }
  }

  /** The EverGlow fit-out: a humming ceiling panel on chains, cable runs, a logo plaque, no rugs or flowers. */
  private dressSterile(g: THREE.Group, f: RoomFrame): void {
    const b = new MeshBuilder();
    const m = hallMats();
    const cx = f.X(4.6);
    const cz = f.def.z + 0.4;
    for (const dz of [-0.6, 0.6]) b.add(m.metal, new THREE.CylinderGeometry(0.01, 0.01, 1.0, 4), mat(cx, 3.35, cz + dz), { tint: 0x9aa4ae });
    b.add(m.metal, roundedBox(2.4, 0.08, 1.5, 0.03), mat(cx, 2.8, cz), { tint: 0xd8e0e8 });
    // Grey cable taped across the floor from the plinth to the wall, and a junction box.
    for (let k = 0; k < 8; k++) b.add(m.metal, new THREE.CylinderGeometry(0.02, 0.02, 0.62, 5).rotateZ(Math.PI / 2), mat(f.plinth.x - f.side * (0.4 + k * 0.6), 0.02, f.plinth.z + 0.9 + Math.sin(k) * 0.05, 0, 0.05 * Math.sin(k * 2), 0), { tint: 0x5a6068 });
    b.add(m.metal, roundedBox(0.3, 0.4, 0.14, 0.03), mat(f.X(0.28), 0.4, f.plinth.z + 0.9), { tint: 0xc8d2dc });
    const shell = b.build({ name: `hall-sterile-${f.def.id}` });
    g.add(shell);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3).rotateX(Math.PI / 2), STERILE_PANEL);
    panel.position.set(cx, 2.755, cz);
    panel.userData.noAO = true;
    g.add(panel);
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), logoMaterial());
    const p = f.plinth;
    plaque.position.set(p.x - f.side * 0.43, 0.72, p.z + 0.2);
    plaque.lookAt(p.x - f.side * 3, 0.72, p.z + 1.2);
    g.add(plaque);
  }

  // ───────────────────────────── state

  /** Rebuild a room's bundle sacks from its bundle completion flags. */
  setSacks(room: RoomId, done: boolean[]): void {
    const v = this.rooms.get(room);
    if (!v) return;
    for (const c of [...v.sacks.children]) {
      c.removeFromParent();
      c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    const defs = BUNDLES.filter((b) => b.room === room);
    const b = new MeshBuilder();
    const m = hallMats();
    const r = new Rng(`sacks-${room}`);
    const f = v.frame;
    const tx = f.plinth.x + f.side * 1.25;
    defs.forEach((def, i) => {
      const x = tx - 0.36 + i * (0.72 / Math.max(1, defs.length - 1));
      const full = !!done[i];
      const s = lumpySphere(0.2, 1, 0.1, r, 2.2);
      b.add(m.cloth, s, mat(x, 0.66 + (full ? 0.17 : 0.1), f.plinth.z + 0.1, 0, r.next() * 3, 0, 1, full ? 1.15 : 0.6, 1), { tint: full ? def.color : new THREE.Color(def.color).lerp(new THREE.Color(0x8a8070), 0.55).getHex() });
      b.add(m.cloth, new THREE.ConeGeometry(0.09, 0.14, 7), mat(x, 0.66 + (full ? 0.44 : 0.28), f.plinth.z + 0.1), { tint: full ? def.color : 0x8a8070 });
      b.add(m.metal, new THREE.TorusGeometry(0.07, 0.018, 5, 12), mat(x, 0.66 + (full ? 0.37 : 0.23), f.plinth.z + 0.1, Math.PI / 2), { tint: full ? 0xe8b84a : 0x7a6a50 });
    });
    const g = b.build({ name: `hall-sacks-${room}` });
    v.sacks.add(g);
  }

  /** Visual state of a room (instant). */
  setRoomLit(room: RoomId, lit: boolean, glimmer = false): void {
    const v = this.rooms.get(room);
    if (!v) return;
    v.target = lit ? 1 : 0;
    v.glow = v.target;
    v.glimmer = glimmer;
    this.applyRoomLook(v);
    this.redrawDust();
  }

  /**
   * Cutscene: ignite a room's lantern — its light spikes 0 → 12 in 0.4 s and settles at 6, a
   * shockwave ring races across the floor (and echoes), a column of 200 sparks rises in the room's
   * colour and lingers as motes, glowmoths swarm, and the dressing swaps at the flash peak.
   * `pre` fast-forwards the effect (demo stills).
   */
  ignite(room: RoomId, pre = 0): void {
    const v = this.rooms.get(room);
    if (!v) return;
    v.target = 1;
    v.flash = 1;
    v.ign = 0;
    this.swarm();
    const col = new THREE.Color(v.glimmer ? 0xdff4ff : v.frame.def.color);
    this.ringAt.set(v.frame.plinth.x, 0.02, v.frame.plinth.z + 0.1);
    this.ringT = 0;
    (this.ring.material as THREE.ShaderMaterial).uniforms.uColor!.value.copy(col).lerp(new THREE.Color(0xffffff), 0.3);
    const B = this.burst;
    for (let i = 0; i < B.n; i++) {
      const a = Math.random() * Math.PI * 2;
      const lingering = i >= 170;
      const sp = lingering ? 0.2 + Math.random() * 0.4 : 0.6 + Math.random() * 2.2;
      B.pos.set([v.frame.plinth.x + (Math.random() - 0.5) * 0.3, 1.5 + Math.random() * 0.3, v.frame.plinth.z + (Math.random() - 0.5) * 0.3], i * 3);
      this.burstVel.set([Math.cos(a) * sp * (lingering ? 2.4 : 0.55), (lingering ? 0.25 : 1.4) + Math.random() * (lingering ? 0.5 : 2.2), Math.sin(a) * sp * (lingering ? 2.4 : 0.55)], i * 3);
      this.burstAge[i] = 0;
      this.burstLife[i] = lingering ? 5 + Math.random() * 4 : 1.6 + Math.random() * 2.2;
      const k = 1.6 + Math.random() * 1.6;
      B.col.set([Math.min(4, col.r * k + 0.3), Math.min(4, col.g * k + 0.3), Math.min(4, col.b * k + 0.3)], i * 3);
      B.size[i] = lingering ? 0.05 + Math.random() * 0.05 : 0.06 + Math.random() * 0.08;
    }
    if (pre > 0) for (let t = 0; t < pre; t += 1 / 30) this.stepIgnite(1 / 30);
  }

  /** Advance the ignition FX (ring, spark column). */
  private stepIgnite(dt: number): void {
    if (this.ringT >= 0) {
      this.ringT += dt;
      const u = this.ringT;
      const mat = this.ring.material as THREE.ShaderMaterial;
      // Main wave 0–1.4 s out to 5.5 m; an echo from 1.1 s to 3 m.
      const a = u < 1.4 ? Math.pow(1 - u / 1.4, 1.5) : 0;
      const e = u > 1.1 && u < 2.9 ? Math.sin(((u - 1.1) / 1.8) * Math.PI) * 0.55 : 0;
      const R = a > e ? 0.3 + (1 - Math.pow(1 - Math.min(1, u / 1.4), 2)) * 5.5 : 0.3 + Math.min(1, (u - 1.1) / 1.8) * 3.2;
      this.ring.scale.set(R, R, 1);
      this.ring.position.copy(this.ringAt);
      mat.uniforms.uA!.value = Math.max(a, e);
      mat.uniforms.uW!.value = 0.14;
      this.ring.visible = u < 2.9;
      if (u >= 2.9) this.ringT = -1;
    }
    const B = this.burst;
    let alive = 0;
    for (let i = 0; i < B.n; i++) {
      const age = (this.burstAge[i]! += dt);
      const life = this.burstLife[i]!;
      if (age >= life) {
        B.alpha[i] = 0;
        continue;
      }
      alive++;
      const vx = this.burstVel[i * 3]!;
      const vy = this.burstVel[i * 3 + 1]!;
      const vz = this.burstVel[i * 3 + 2]!;
      B.pos[i * 3] = B.pos[i * 3]! + vx * dt + Math.sin(age * 3 + i) * 0.004;
      B.pos[i * 3 + 1] = B.pos[i * 3 + 1]! + vy * dt;
      B.pos[i * 3 + 2] = B.pos[i * 3 + 2]! + vz * dt + Math.cos(age * 2.6 + i) * 0.004;
      const drag = Math.exp(-dt * 1.6);
      this.burstVel[i * 3] = vx * drag;
      this.burstVel[i * 3 + 1] = vy * Math.exp(-dt * 0.9) + dt * 0.08;
      this.burstVel[i * 3 + 2] = vz * drag;
      const u = age / life;
      B.alpha[i] = Math.min(1, age * 8) * (1 - u) * (0.7 + 0.3 * Math.sin(age * 14 + i));
    }
    this.burstAlive = alive > 0;
  }

  /** Glowmoths burst outward from the lanterns and settle back into orbit. */
  swarm(): void {
    for (let i = 0; i < this.moths.n; i++) {
      if (this.mothSeed[i * 4 + 3]! < 0.5) this.mothSeed[i * 4 + 3] = 1.2 + Math.random();
    }
  }

  private applyRoomLook(v: RoomVisual): void {
    const on = v.target > 0.5;
    // EverGlow rooms get the sterile fit-out: no dust, but no rugs, flowers or candles either.
    v.dark.visible = !on;
    v.lit.visible = on && !v.glimmer;
    v.sterile.visible = on && v.glimmer;
    const col = v.glimmer ? new THREE.Color(0xdff4ff) : new THREE.Color(v.frame.def.color);
    v.glass.emissive.copy(col);
    v.pane.emissive.copy(col);
    v.light.color.copy(v.glimmer ? new THREE.Color(0xe6f2ff) : col);
    v.core.emissive.copy(v.glimmer ? new THREE.Color(0xffffff) : col.clone().lerp(new THREE.Color(0xfff2d8), 0.55));
    (v.pool.uniforms.uColor!.value as THREE.Color).copy(v.glimmer ? new THREE.Color(0x9ab8d8) : col);
    if (v.frame.def.id === 'hearth') this.hearthFire.active = on && !v.glimmer;
  }

  /** How many rooms burn EverGlow white (drives the cold interior grade). */
  get glimmerCount(): number {
    let n = 0;
    for (const v of this.rooms.values()) if (v.glimmer && v.target > 0.5) n++;
    return n;
  }

  get litCount(): number {
    let n = 0;
    for (const v of this.rooms.values()) if (v.target > 0.5) n++;
    return n;
  }

  /**
   * The derelict floor: the clean floor desaturated 40 % and darkened to ×0.6 under blotchy grime,
   * dirt drifted along the walls, water stains, scratches, and holes broken through to the soil.
   */
  private makeGrime(src: HTMLCanvasElement, PX: number): HTMLCanvasElement {
    const W = src.width;
    const H = src.height;
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const g = out.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(src, 0, 0);
    const img = g.getImageData(0, 0, W, H);
    const d = img.data;
    const r = new Rng('hall-grime');
    const NW = 70;
    const NH = Math.round((NW * H) / W);
    const nz = new Float32Array(NW * NH);
    for (let i = 0; i < nz.length; i++) nz[i] = r.next();
    for (let y = 0; y < H; y++) {
      const fy = (y / H) * (NH - 1);
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const y1 = Math.min(NH - 1, y0 + 1);
      for (let x = 0; x < W; x++) {
        const fx = (x / W) * (NW - 1);
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const x1 = Math.min(NW - 1, x0 + 1);
        const n = (nz[y0 * NW + x0]! * (1 - tx) + nz[y0 * NW + x1]! * tx) * (1 - ty) + (nz[y1 * NW + x0]! * (1 - tx) + nz[y1 * NW + x1]! * tx) * ty;
        const i = (y * W + x) * 4;
        const R = d[i]!;
        const G = d[i + 1]!;
        const B = d[i + 2]!;
        const l = R * 0.3 + G * 0.59 + B * 0.11;
        const k = 0.6 * (0.8 + n * 0.36);
        // 40 % toward a warm grey (old dust is brownish, not neutral).
        d[i] = (R + (l * 1.02 - R) * 0.4) * k;
        d[i + 1] = (G + (l * 0.96 - G) * 0.4) * k;
        d[i + 2] = (B + (l * 0.86 - B) * 0.4) * k;
      }
    }
    g.putImageData(img, 0, 0);
    const X = (x: number): number => (x - 2) * PX;
    const Z = (z: number): number => (z - 3) * PX;
    // Dirt drifted into the corners and along every wall foot.
    const drift = (x0: number, z0: number, x1: number, z1: number): void => {
      const grd = g.createLinearGradient(X(x0), Z(z0), X(x1), Z(z1));
      grd.addColorStop(0, 'rgba(70,52,34,0.55)');
      grd.addColorStop(1, 'rgba(70,52,34,0)');
      g.fillStyle = grd;
      g.fillRect(Math.min(X(x0), X(x1)), Math.min(Z(z0), Z(z1)), Math.abs(X(x1) - X(x0)) || W, Math.abs(Z(z1) - Z(z0)) || H);
    };
    drift(2, 3, 2, 4.1);
    drift(2, 3, 3.1, 3);
    drift(28, 3, 26.9, 3);
    for (const wz of [9, 15]) {
      g.save();
      g.beginPath();
      g.rect(X(2), Z(wz - 0.9), X(28) - X(2), 0.9 * PX);
      g.clip();
      drift(2, wz, 2, wz - 0.9);
      g.restore();
    }
    // Water stains and mildew blooms.
    for (let k = 0; k < 70; k++) {
      const x = 2 + r.next() * 26;
      const z = 3 + r.next() * 18;
      const rad = (0.3 + r.next() * 0.9) * PX;
      const grd = g.createRadialGradient(X(x), Z(z), rad * 0.2, X(x), Z(z), rad);
      const tone = r.next() < 0.3 ? '40,52,30' : '48,34,22';
      grd.addColorStop(0, `rgba(${tone},0.0)`);
      grd.addColorStop(0.75, `rgba(${tone},0.22)`);
      grd.addColorStop(1, `rgba(${tone},0)`);
      g.fillStyle = grd;
      g.beginPath();
      g.arc(X(x), Z(z), rad, 0, Math.PI * 2);
      g.fill();
    }
    // Scratches and hairline cracks.
    g.lineCap = 'round';
    for (let k = 0; k < 160; k++) {
      const x = 2 + r.next() * 26;
      const z = 3 + r.next() * 18;
      g.strokeStyle = r.next() < 0.5 ? 'rgba(20,12,6,0.4)' : 'rgba(210,190,160,0.14)';
      g.lineWidth = 1 + r.next() * 1.5;
      g.beginPath();
      g.moveTo(X(x), Z(z));
      let px = X(x);
      let pz = Z(z);
      for (let q = 0; q < 4; q++) {
        px += (r.next() - 0.5) * 50;
        pz += (r.next() - 0.5) * 50;
        g.lineTo(px, pz);
      }
      g.stroke();
    }
    // Holes through to the soil (dirt texture), with dark inner shadow and splintered / chipped rims.
    const dirtImg = textures.dirt().map.image as CanvasImageSource | undefined;
    const pat = dirtImg ? g.createPattern(dirtImg, 'repeat') : null;
    for (const [hx, hz, hw, hd, kind, rot] of HOLES) {
      g.save();
      g.translate(X(hx), Z(hz));
      g.rotate(rot);
      const path = new Path2D();
      if (kind === 'tile') {
        // Missing tiles: a ragged block of squares.
        const s = 0.46 * PX;
        const nx = Math.max(1, Math.round((hw * PX) / s));
        const nzz = Math.max(1, Math.round((hd * PX) / s));
        for (let i = 0; i < nx; i++) for (let j = 0; j < nzz; j++) if (!((i === 0 || i === nx - 1) && (j === 0 || j === nzz - 1)) || r.next() < 0.5) path.rect(-nx * s * 0.5 + i * s, -nzz * s * 0.5 + j * s, s + 0.5, s + 0.5);
      } else {
        const n = 16;
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          const jag = kind === 'plank' ? 0.65 + r.next() * 0.45 : 0.8 + r.next() * 0.25;
          const px = Math.cos(a) * hw * 0.5 * PX * (kind === 'plank' ? Math.min(1, 1.25 * jag) : jag);
          const pz = Math.sin(a) * hd * 0.5 * PX * (kind === 'plank' ? 1 : jag);
          if (i === 0) path.moveTo(px, pz);
          else path.lineTo(px, pz);
        }
        path.closePath();
      }
      g.save();
      g.clip(path);
      if (pat) {
        pat.setTransform(new DOMMatrix().scale(0.6));
        g.fillStyle = pat;
      } else g.fillStyle = '#6a4a30';
      g.fillRect(-hw * PX, -hd * PX, hw * 2 * PX, hd * 2 * PX);
      g.fillStyle = 'rgba(24,14,6,0.5)';
      g.fillRect(-hw * PX, -hd * PX, hw * 2 * PX, hd * 2 * PX);
      const sh = g.createRadialGradient(0, 0, Math.min(hw, hd) * 0.1 * PX, 0, 0, Math.max(hw, hd) * 0.62 * PX);
      sh.addColorStop(0, 'rgba(10,6,2,0)');
      sh.addColorStop(1, 'rgba(10,6,2,0.8)');
      g.fillStyle = sh;
      g.fillRect(-hw * PX, -hd * PX, hw * 2 * PX, hd * 2 * PX);
      g.restore();
      g.strokeStyle = kind === 'plank' ? 'rgba(214,170,112,0.85)' : 'rgba(200,190,170,0.6)';
      g.lineWidth = kind === 'plank' ? 3 : 2;
      g.stroke(path);
      g.strokeStyle = 'rgba(15,8,3,0.55)';
      g.lineWidth = 5;
      g.translate(2, 3);
      g.stroke(path);
      g.restore();
    }
    return out;
  }

  /** Live floor = clean floor, with each dark room (and the nave, by how dark the hall is) swapped for the derelict floor. */
  private composeFloor(): void {
    if (!this.floorLive) return;
    const g = this.floorLive.getContext('2d')!;
    const PX = this.floorLive.width / 26;
    const X = (x: number): number => (x - 2) * PX;
    const Z = (z: number): number => (z - 3) * PX;
    g.globalAlpha = 1;
    g.drawImage(this.floorClean, 0, 0);
    for (const v of this.rooms.values()) {
      if (v.target > 0.5) continue;
      const x0 = v.frame.side > 0 ? 2 : 18;
      g.drawImage(this.floorGrime, X(x0), Z(v.frame.z0), 10 * PX, 6 * PX, X(x0), Z(v.frame.z0), 10 * PX, 6 * PX);
    }
    const dim = 1 - this.litCount / 6;
    if (dim > 0) {
      g.globalAlpha = Math.min(1, dim * 1.2);
      g.drawImage(this.floorGrime, X(12), Z(3), 6 * PX, 18 * PX, X(12), Z(3), 6 * PX, 18 * PX);
      g.globalAlpha = 1;
    }
    this.floorTex.needsUpdate = true;
  }

  redrawDust(): void {
    this.composeFloor();
    const c = this.dustCanvas;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const PX = c.width / 26;
    const r = new Rng('hall-dust');
    const X = (x: number): number => (x - 2) * PX;
    const Z = (z: number): number => (z - 3) * PX;
    const blotch = (x: number, z: number, rad: number, a: number): void => {
      const grd = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), rad * PX);
      grd.addColorStop(0, `rgba(198,190,176,${a})`);
      grd.addColorStop(1, 'rgba(198,190,176,0)');
      g.fillStyle = grd;
      g.fillRect(X(x - rad), Z(z - rad), rad * 2 * PX, rad * 2 * PX);
    };
    const dim = 1 - this.litCount / 6;
    // Nave: dust, with a trodden path of footprints to the Great Lantern.
    for (let k = 0; k < 40; k++) blotch(12.2 + r.next() * 5.6, 3.5 + r.next() * 17, 0.6 + r.next() * 1.2, 0.2 * dim);
    for (const v of this.rooms.values()) {
      if (v.target > 0.5) continue;
      const f = v.frame;
      for (let k = 0; k < 26; k++) blotch(f.X(0.3 + r.next() * 9.4), f.z0 + 0.3 + r.next() * 5.4, 0.5 + r.next() * 1.1, 0.2);
      // corners gather the thickest dust
      for (const [u, dz] of [[0.3, 0.3], [0.3, 5.7], [9.6, 0.3]] as const) blotch(f.X(u), f.z0 + dz, 1.1, 0.5);
    }
    if (dim > 0) {
      g.fillStyle = `rgba(110,90,70,${0.22 * dim})`;
      for (let z = 20.6; z > 7.5; z -= 0.62) {
        for (const sx of [-1, 1]) {
          const x = 15 + sx * 0.16 + Math.sin(z * 0.8) * 0.12;
          g.beginPath();
          g.ellipse(X(x), Z(z + (sx > 0 ? 0.31 : 0)), 0.07 * PX, 0.13 * PX, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    this.dustTex.needsUpdate = true;
  }

  // ───────────────────────────── runtime

  heightAt(): number {
    return 0;
  }

  private respawnMote(i: number, anywhere: boolean): void {
    const w = [7, 15, 23][i % 3]!;
    this.motes.pos[i * 3] = w + (Math.random() - 0.5) * 2.2;
    this.motes.pos[i * 3 + 1] = anywhere ? Math.random() * 4 : 3.8 + Math.random() * 0.6;
    this.motes.pos[i * 3 + 2] = 3.5 + Math.random() * 5.5;
    this.moteVel[i * 3] = (Math.random() - 0.5) * 0.05;
    this.moteVel[i * 3 + 1] = -0.03 - Math.random() * 0.05;
    this.moteVel[i * 3 + 2] = (Math.random() - 0.2) * 0.06;
    this.motes.size[i] = 0.035 + Math.random() * 0.04;
    this.motes.alpha[i] = 0;
  }

  update(dt: number, game: Game): void {
    this.t += dt;
    const t = this.t;
    let lit = 0;
    for (const v of this.rooms.values()) {
      v.glow += (v.target - v.glow) * (1 - Math.exp(-dt * 2.2));
      if (v.flash > 0) {
        v.flash = Math.max(0, v.flash - dt * 0.8);
        // Swap the dressing at the flash peak.
        if (v.flash < 0.75 && v.dark.visible) {
          this.applyRoomLook(v);
          this.redrawDust();
        }
      }
      // Warm lanterns breathe; EverGlow hums at a flat 1.5× with the odd cold stutter.
      const flick = v.glimmer ? (Math.sin(t * 61 + v.frame.def.x) > 0.97 ? 0.72 : 1) : 0.92 + Math.sin(t * 7.3 + v.frame.def.x) * 0.04 + Math.sin(t * 17.1 + v.frame.def.z) * 0.03;
      // Ignition: 0 → 12 in 0.4 s, then settle to the steady 6.
      let spike = 0;
      if (v.ign >= 0) {
        v.ign += dt;
        spike = v.ign < 0.4 ? v.ign / 0.4 : Math.exp(-(v.ign - 0.4) * 1.6);
        if (v.ign > 5) v.ign = -1;
      }
      const steady = v.glimmer ? 9 : 6;
      v.light.intensity = v.ign >= 0 ? Math.max(v.glow * steady * flick, 12 * spike + steady * Math.min(1, v.ign / 0.4) * (1 - spike)) : v.glow * steady * flick;
      v.glass.emissiveIntensity = v.glow * (v.glimmer ? 2.4 : 1.4) * flick + spike * 4;
      v.core.emissiveIntensity = v.glow * (v.glimmer ? 7 : 5.5) * flick + spike * 8;
      v.pane.emissiveIntensity = v.glow * (v.glimmer ? 1.8 : 1.3) * flick + v.flash * 4;
      v.pool.uniforms.uI!.value = v.glow * (v.glimmer ? 0.18 : 0.42) * flick + spike * 0.6;
      lit += v.glow;
    }
    if (this.ringT >= 0 || this.burstAlive) {
      this.stepIgnite(dt);
      this.burst.flush(game.rc.renderer.domElement.height);
    }
    const frac = lit / 6;
    this.warmth = frac;
    this.greatCore.emissiveIntensity = frac * frac * 2.6 * (0.94 + Math.sin(t * 5.1) * 0.04);
    this.greatLight.intensity = frac * frac * 8;
    // Hand lantern: a warm pool around the farmer that fades as the rooms relight.
    const pp = game.player.position;
    this.carryLight.position.set(pp.x + 0.35, 1.35, pp.z + 0.35);
    this.carryLight.intensity = Math.max(0, 1 - frac * 1.6) * 6.5 * (0.93 + Math.sin(t * 9.1) * 0.04 + Math.sin(t * 23.3) * 0.03) * (game.player.root.visible ? 1 : 0);
    this.hearthLight.intensity = this.hearthFire.active ? 5.5 * (0.8 + Math.sin(t * 13) * 0.1 + Math.sin(t * 29) * 0.08) : 0;
    const h = game.rc.renderer.domElement.height;
    this.hearthFire.update(dt, h);
    // Beams: cool moonlight when dark, faint warm dust-light when restored.
    const hour = game.calendar.hour;
    const day = hour > 7 && hour < 18.5 ? 1 : 0;
    this.beamMat.uniforms.uTime!.value = t;
    (this.beamMat.uniforms.uColor!.value as THREE.Color).setHex(day ? 0xffe2b0 : 0x7a98ff).lerp(new THREE.Color(0xffc890), frac * 0.6);
    this.beamMat.uniforms.uStrength!.value = (day ? 0.38 : 0.62) * (1 - frac * 0.55);
    this.windowMat.emissive.setHex(day ? 0xcfe4ff : 0x4a68c0);
    this.windowMat.emissiveIntensity = day ? 1.1 : 0.9;
    // Dust motes drift down through the beams.
    for (let i = 0; i < this.motes.n; i++) {
      const p = this.motes.pos;
      p[i * 3]! += (this.moteVel[i * 3]! + Math.sin(t * 0.7 + i) * 0.02) * dt;
      p[i * 3 + 1]! += this.moteVel[i * 3 + 1]! * dt;
      p[i * 3 + 2]! += this.moteVel[i * 3 + 2]! * dt;
      this.motes.alpha[i] = Math.min(1, this.motes.alpha[i]! + dt * 0.5) * (0.5 + 0.5 * Math.sin(t * 2 + i * 1.7));
      const c = day ? [1.4, 1.3, 1.1] : [0.9, 1.1, 1.8];
      this.motes.col.set(c, i * 3);
      if (p[i * 3 + 1]! < 0.2) this.respawnMote(i, false);
    }
    this.motes.flush(h);
    // Glowmoths: orbit lit lanterns (more per lit room), swarm on ignition.
    const litRooms = [...this.rooms.values()].filter((v) => v.glow > 0.05);
    for (let i = 0; i < this.moths.n; i++) {
      const s = this.mothSeed;
      const home = litRooms.length ? litRooms[i % litRooms.length]! : null;
      const great = i % 7 === 0 && frac > 0.3;
      const cx = great ? HALL.dais.x : home ? home.frame.plinth.x : HALL.dais.x;
      const cz = great ? HALL.dais.z : home ? home.frame.plinth.z : HALL.dais.z;
      const cy = great ? 3.7 : 1.6;
      let burst = s[i * 4 + 3]!;
      if (burst > 0.5) {
        burst -= dt * 0.9;
        s[i * 4 + 3] = burst;
      }
      const rad = (great ? 1.4 : 0.5) + s[i * 4]! * 1.3 + Math.max(0, burst - 0.5) * 1.5;
      const sp = 0.35 + s[i * 4 + 1]! * 0.5;
      const a = t * sp * (s[i * 4 + 2]! > 0.5 ? 1 : -1) + s[i * 4]! * 20;
      this.moths.pos[i * 3] = cx + Math.cos(a) * rad;
      this.moths.pos[i * 3 + 1] = cy + Math.sin(t * 1.3 + i) * 0.5 + s[i * 4 + 1]! * 1.2;
      this.moths.pos[i * 3 + 2] = cz + Math.sin(a) * rad * 0.8;
      const col = home ? new THREE.Color(home.glimmer ? 0xdff4ff : home.frame.def.color) : new THREE.Color(0xffc870);
      const k = 2.2 + Math.max(0, burst - 0.5) * 3;
      this.moths.col.set([col.r * k, col.g * k, col.b * k], i * 3);
      const want = home ? Math.min(1, frac * 1.4 + 0.25) : i < 6 ? 0.25 : 0;
      const tw = 0.55 + 0.45 * Math.sin(t * (3 + s[i * 4]! * 4) + i);
      this.moths.alpha[i] = want * tw * (home?.glimmer ? 0.3 : 1);
      this.moths.size[i] = 0.05 + s[i * 4 + 1]! * 0.05;
    }
    this.moths.flush(h);
  }

  dispose(): void {
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

// ─────────────────────────────────────────────── system

export class LanternHallSystem implements System {
  readonly name = 'hall';
  private game!: Game;
  private hall: HallMap | null = null;
  /** Rooms whose visuals wait for their celebration cutscene to ignite. */
  private pending = new Set<RoomId>();
  /** Demo override: force every room dark / lit. */
  private preview: 'dark' | 'restored' | null = null;
  private baseRender: THREE.Object3D['onBeforeRender'] | null = null;
  private hints!: WorldHints;

  init(game: Game): void {
    this.game = game;
    // "F · Offer" over each plinth still wanting bundles, "F · Great Lantern" at the dais.
    const root = game.hud.root;
    this.hints = new WorldHints(game, root.parentElement ?? root, () => {
      const out: HintPoint[] = [];
      const q = game.services.quests;
      for (const def of ROOMS) {
        const f = frameFor(def);
        if (!q?.room(def.id)?.done) out.push({ map: 'hall', x: f.plinth.x + f.side * 0.6, z: f.plinth.z, y: 2.75, label: 'Offer', r: 2.3 });
      }
      out.push({ map: 'hall', x: HALL.dais.x, z: HALL.dais.z + 2.2, y: 2.4, label: 'Great Lantern', r: 2.6 });
      return out;
    });
    game.world.registerMap('hall', (g) => {
      this.hall = new HallMap(g);
      this.sync();
      return this.hall;
    });
    // Town → hall doors.
    game.events.on('map:change', ({ map }) => {
      if (map === 'town') {
        const town = game.world.current;
        const warps = town?.warps as MapWarp[] | undefined;
        if (warps && !warps.some((w) => w.to === 'hall')) warps.push({ x0: 31, z0: 13, x1: 32, z1: 13, to: 'hall', x: HALL.entrance.x, z: 20.2, facing: 'up' });
      }
      if (map === 'hall') this.sync();
    });
    game.events.on('player:interact', ({ x, z }) => this.interact(x, z));
    game.events.on('quest:room', ({ roomId }) => {
      if (this.game.services.cutscene) this.pending.add(roomId as RoomId);
      this.sync();
    });
    game.events.on('quest:bundle', () => this.sync());
    game.events.on('quest:sync', () => {
      this.pending.clear();
      this.sync();
    });
    game.events.on('cutscene:cue', ({ cue, arg, instant }) => {
      if (cue !== 'hall:ignite' || !arg) return;
      this.pending.delete(arg as RoomId);
      if (!this.hall) return;
      if (instant) {
        // Skips / demo stills land on the lit room with the glowmoth swarm still in the air.
        this.hall.setRoomLit(arg as RoomId, true, this.isGlimmer(arg));
        this.hall.ignite(arg as RoomId);
      } else this.hall.ignite(arg as RoomId);
    });
    game.events.on('demo:stage', ({ showcase }) => {
      this.preview = showcase.includes('hall:restored') ? 'restored' : showcase.includes('hall:dark') ? 'dark' : null;
      this.sync();
    });
    // Interior light: override the outdoor rig while the hall is on screen.
    const scene = game.scene;
    this.baseRender = scene.onBeforeRender;
    scene.onBeforeRender = (...args) => {
      this.baseRender?.apply(scene, args);
      if (game.world.current?.id === 'hall' && this.hall) this.interiorLight(this.hall.warmth, this.hall.glimmerCount / 6);
    };
  }

  update(): void {
    this.hints.update();
  }

  private isGlimmer(room: string): boolean {
    return this.game.services.quests?.room(room)?.glimmer ?? false;
  }

  private sync(): void {
    const h = this.hall;
    if (!h) return;
    const q = this.game.services.quests;
    for (const def of ROOMS) {
      const st = q?.room(def.id);
      let lit = !!st?.done && !this.pending.has(def.id);
      if (this.preview) lit = this.preview === 'restored';
      const v = h.rooms.get(def.id)!;
      const glimmer = !!st?.glimmer && this.preview !== 'restored';
      if ((v.target > 0.5) !== lit || v.glimmer !== glimmer) h.setRoomLit(def.id, lit, glimmer);
      const bundles = BUNDLES.filter((b) => b.room === def.id);
      h.setSacks(
        def.id,
        bundles.map((b) => (this.preview === 'restored' ? true : this.preview === 'dark' ? false : !!q?.bundleDone(b.id))),
      );
    }
  }

  private interact(x: number, z: number): void {
    const g = this.game;
    if (g.world.current?.id !== 'hall' || !this.hall || g.services.cutscene?.playing) return;
    const p = g.player.position;
    let best: RoomDef | null = null;
    let bd = 2.3;
    for (const def of ROOMS) {
      const f = this.hall.rooms.get(def.id)!.frame;
      const tx = f.plinth.x + f.side * 1.25;
      const d = Math.min(Math.hypot(p.x - f.plinth.x, p.z - f.plinth.z), Math.hypot(p.x - tx, p.z - f.plinth.z), Math.hypot(x + 0.5 - f.plinth.x, z + 0.5 - f.plinth.z));
      if (d < bd) {
        bd = d;
        best = def;
      }
    }
    if (best) {
      g.events.emit('ui:open', { name: `bundles:${best.id}` });
      return;
    }
    if (Math.hypot(p.x - HALL.dais.x, p.z - HALL.dais.z) < 4) g.events.emit('ui:open', { name: 'journal:hall' });
  }

  /**
   * Interior grade: moonlit blue when dark → warm lamplight as rooms relight; EverGlow rooms (`cold`
   * = their share) pull it to a flat 6500 K office white, desaturated, with a blue gain.
   */
  private interiorLight(w0: number, cold: number): void {
    const L = this.game.lighting;
    const rc = this.game.rc;
    const w = w0 * (1 - cold);
    const cool = new THREE.Color(0x8aa4ff);
    const warm = new THREE.Color(0xffc896);
    const office = new THREE.Color(0xeaf4ff);
    L.sun.color.copy(cool).lerp(warm, w).lerp(office, cold);
    L.sun.intensity = 1.25 - w * 0.55 + cold * 0.5;
    L.hemi.color.set(0x5a6aa8).lerp(new THREE.Color(0xffd8b0), w).lerp(new THREE.Color(0xdde8f4), cold);
    L.hemi.groundColor.set(0x2a2230).lerp(new THREE.Color(0x5a3a28), w).lerp(new THREE.Color(0x4a5460), cold);
    L.hemi.intensity = 0.85 + w * 0.1 + cold * 0.35;
    L.bounce.intensity = 0.12 + w * 0.2;
    L.bounce.color.set(0xffb070).lerp(new THREE.Color(0xcfe0f0), cold);
    const bg = new THREE.Color(0x0a0c16).lerp(new THREE.Color(0x160e0a), w).lerp(new THREE.Color(0x0e1418), cold);
    L.fog.color.copy(bg);
    L.fog.near = 60;
    L.fog.far = 140;
    (rc.scene.background as THREE.Color).copy(bg);
    rc.scene.environmentIntensity = 0.18 + w * 0.12 + cold * 0.1;
    rc.renderer.toneMappingExposure = 1.22 - w * 0.02 + cold * 0.06;
    const g = rc.post.grade.uniforms;
    (g.uLift!.value as THREE.Vector3).set(0.02 + w * 0.02, 0.022 + w * 0.01 + cold * 0.01, 0.05 - w * 0.02 + cold * 0.01);
    (g.uGain!.value as THREE.Vector3).set(0.96 + w * 0.12 - cold * 0.04, 0.98 + w * 0.02 + cold * 0.02, 1.08 - w * 0.14 + cold * 0.06);
    g.uSaturation!.value = 1.02 + w * 0.1 - cold * 0.3;
    g.uContrast!.value = 1.08 - cold * 0.04;
    g.uVignette!.value = 0.62 - w * 0.12 - cold * 0.2;
    rc.post.setBloom(0.55 + w * 0.15, 0.9);
  }
}
