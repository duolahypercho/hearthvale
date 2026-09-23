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
import { textures } from '../render/textures';
import { FireFX } from '../render/particles';
import { Rng } from '../core/rng';
import { ROOMS, BUNDLES, type RoomDef, type RoomId } from '../data/bundles';
import { HALL } from '../data/story-scenes';

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
    cloth: std({ roughness: 0.96 }, 'cloth'),
    glass: std({ roughness: 0.1, metalness: 0.1, color: 0x9ab4cc, transparent: true, opacity: 0.38, depthWrite: false }, 'glass'),
    water: std({ roughness: 0.15, color: 0x2a8a9a, emissive: 0x1a6a8a, emissiveIntensity: 0.6, transparent: true, opacity: 0.82 }, 'water'),
    leaf: std({ roughness: 0.8 }, 'leaf'),
    candle: std({ roughness: 0.5, color: 0xfff2dc, emissive: 0xffb050, emissiveIntensity: 2.4 }, 'candle'),
    web: std({ roughness: 1, color: 0xe8ecf2, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }, 'web'),
  };
  (MATS.glass as THREE.MeshStandardMaterial).vertexColors = false;
  (MATS.web as THREE.MeshStandardMaterial).vertexColors = false;
  return MATS;
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
      ny = Math.pow(y, 0.8) * 0.42 + 0.02 * Math.sin(a * 3 + ph2) * y;
      nr = Math.min(1, rad * 1.04) * (1 + 0.025 * Math.sin(a * 5 + ph));
    } else {
      // Skirt: drop to the floor, flare and fold more towards the hem.
      const k = -y;
      ny = -k * 1.0;
      const fold = 0.09 * Math.pow(k, 1.4) * Math.sin(a * 7 + ph) + 0.05 * k * Math.sin(a * 12 + ph2) + 0.03 * Math.sin(a * 3 + ph2);
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
  /** 0 = dark … 1 = fully lit (animated). */
  glow: number;
  target: number;
  flash: number;
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
  private beams: THREE.Mesh[] = [];
  private beamMat = beamMaterial();
  private windowMat: THREE.MeshStandardMaterial;
  private greatCore: THREE.MeshStandardMaterial;
  private greatLight: THREE.PointLight;
  /** The farmer's hand-lantern pool: warm against the moonlight while the hall is dark. */
  private carryLight = new THREE.PointLight(0xffb060, 0, 7.5, 1.6);
  private hearthFire: FireFX;
  private hearthLight: THREE.PointLight;
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
    this.root.add(this.moths.points, this.motes.points);
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
        const open = [6, 12, 18].some((c) => Math.abs(z + 0.5 - c) < 1.4);
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
      g.fillStyle = grout;
      g.fillRect(X(x0), Z(z0), (x1 - x0) * PX, (z1 - z0) * PX);
      for (let z = z0, j = 0; z < z1; z += s, j++) {
        for (let x = x0, i = 0; x < x1; x += s, i++) {
          const [h, sa, l] = colors[checker ? (i + j) % colors.length : Math.floor(r.next() * colors.length)]!;
          g.fillStyle = hsl(h + (r.next() - 0.5) * 5, sa, l + (r.next() - 0.5) * 7);
          const gap = 0.035;
          g.beginPath();
          g.roundRect(X(x + gap), Z(z + gap), (Math.min(s, x1 - x) - gap * 2) * PX, (Math.min(s, z1 - z) - gap * 2) * PX, 4);
          g.fill();
          // glaze highlight
          g.fillStyle = 'rgba(255,255,255,0.07)';
          g.fillRect(X(x + gap + 0.04), Z(z + gap + 0.04), (s * 0.5) * PX, 3);
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
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
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
      box(b, 'woodGrain', w + 0.1, 0.26, t + 0.2, (x0 + x1) / 2, h - 0.02, z, TRIM);
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
      box(b, 'woodGrain', 1.8, 0.26, 0.6, wx, H - 0.02, bz, TRIM);
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
        box(b, 'woodGrain', 0.6, 0.26, w, sx, SIDE_H - 0.02, (z0 + z1) / 2, TRIM);
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
        box(b, 'woodGrain', x1 - x0 + 0.04, 0.1, 0.46, (x0 + x1) / 2, 1.3, wz, TRIM);
        // Turned spindles + a honey-oak rail (a dark rail reads as a black wire across the room from above).
        for (let x = x0 + 1.2; x < x1 - 0.6; x += 2.2) cyl(b, 'woodGrain', 0.06, 0.07, 0.9, x, 1.85, wz, 0xa8764a, 8);
        box(b, 'woodGrain', x1 - x0, 0.1, 0.16, (x0 + x1) / 2, 2.28, wz, 0xb8844e);
      }
    }
    // Front knee wall with the doorway (cut-away so the camera sees in).
    for (const [x0, x1] of [[1.8, 13.6], [16.4, 28.2]] as const) {
      box(b, 'stone', x1 - x0, 0.35, 0.46, (x0 + x1) / 2, 0, 21.2, STONE);
      box(b, 'wood', x1 - x0, 0.55, 0.4, (x0 + x1) / 2, 0.35, 21.2, WAIN);
      box(b, 'woodGrain', x1 - x0 + 0.1, 0.12, 0.56, (x0 + x1) / 2, 0.9, 21.2, TRIM);
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
    box(b, 'woodGrain', 0.5, 0.2, w, x, h - 0.05, (z0 + z1) / 2, 0x5e3a22);
  }

  private archAt(b: B, x: number, z: number, h: number): void {
    // Lintel above the opening and a round timber arch.
    box(b, 'plaster', 0.3, h - 2.45, 3.0, x, 2.45, z, 0xf0e2c6, 0, 0.02);
    box(b, 'woodGrain', 0.5, 0.2, 3.0, x, h - 0.05, z, 0x5e3a22);
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
    const glass = new THREE.MeshStandardMaterial({ color: new THREE.Color(def.color).multiplyScalar(0.35), emissive: def.color, emissiveIntensity: 0, roughness: 0.25, metalness: 0.1 });
    glass.name = `hall-lantern-${def.id}`;
    const light = new THREE.PointLight(def.color, 0, 9, 1.7);
    light.position.set(f.plinth.x, 2.1, f.plinth.z + 0.3);
    this.root.add(light);
    const dark = new THREE.Group();
    const lit = new THREE.Group();
    const sacks = new THREE.Group();
    dark.name = `hall-dark-${def.id}`;
    lit.name = `hall-lit-${def.id}`;
    sacks.name = `hall-sacks-${def.id}`;
    this.root.add(dark, lit, sacks);
    const paneMat = glass.clone();
    paneMat.name = `hall-pane-${def.id}`;
    this.rooms.set(def.id, { frame: f, dark, lit, sacks, glass, pane: paneMat, light, glow: 0, target: 0, flash: 0, glimmer: false });

    // Plinth + room lantern.
    const p = f.plinth;
    const m = hallMats();
    shell.add(m.stone, bevelCylinder(0.62, 0.7, 0.2, 0.04, 16), mat(p.x, 0.1, p.z), { tint: 0xa8a090 });
    shell.add(m.stone, bevelCylinder(0.34, 0.42, 0.8, 0.04, 8), mat(p.x, 0.6, p.z), { tint: 0xc0b6a4 });
    shell.add(m.stone, bevelCylinder(0.5, 0.42, 0.14, 0.04, 8), mat(p.x, 1.06, p.z), { tint: 0xb0a898 });
    shell.add(m.metal, new THREE.CylinderGeometry(0.28, 0.32, 0.08, 6), mat(p.x, 1.17, p.z), { tint: 0x2e2a28 });
    shell.add(m.metal, new THREE.ConeGeometry(0.36, 0.3, 6), mat(p.x, 1.93, p.z), { tint: 0x2e2a28 });
    shell.add(m.metal, new THREE.TorusGeometry(0.09, 0.025, 5, 10), mat(p.x, 2.13, p.z), { tint: 0x2e2a28 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      shell.add(m.metal, new THREE.CylinderGeometry(0.022, 0.022, 0.6, 4), mat(p.x + Math.cos(a) * 0.27, 1.5, p.z + Math.sin(a) * 0.27), { tint: 0x2e2a28 });
    }
    const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.58, 6), glass);
    lg.position.set(p.x, 1.5, p.z);
    lg.castShadow = false;
    this.root.add(lg);
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
    // A few dust sheets draped over lumpy shapes.
    const sheets = f.def.id === 'hearth' ? [[3.1, -1.3], [3.1, 1.3]] : f.def.id === 'harvest' ? [[3.4, 1.2]] : f.def.id === 'sun' ? [[3.2, 2.1]] : [[5.4, 2.2]];
    for (const [u, dz] of sheets) {
      const w = 1.3 + r.next() * 0.5;
      b.add(m.cloth, drapedSheet(r, w, 0.95 + r.next() * 0.35, w * (0.7 + r.next() * 0.2)), mat(f.X(u!), 0, f.def.z + dz!, 0, (r.next() - 0.5) * 0.6, 0), { tint: 0xd8d0c0 });
    }
    // A smaller sheet over a chair / crate, and a sheet slumped in a heap on the floor.
    b.add(m.cloth, drapedSheet(r, 0.75, 0.85, 0.7), mat(f.X(6.3), 0, f.def.z - 1.9, 0, r.next(), 0), { tint: 0xcfc6b4 });
    b.add(m.cloth, drapedSheet(r, 1.0, 0.22, 0.7), mat(f.X(8.2), 0, f.def.z + 2.3, 0, r.next() * 3, 0), { tint: 0xc8bfae });
    // Blown-in leaves.
    for (let k = 0; k < 26; k++) {
      const leaf = new THREE.CircleGeometry(0.07 + r.next() * 0.05, 5);
      leaf.rotateX(-Math.PI / 2);
      b.add(m.leaf, leaf, mat(f.X(2 + r.next() * 6.5), 0.012 + k * 0.0004, f.def.z + (r.next() - 0.5) * 5, 0, r.next() * 6, 0), { tint: [0xa8602c, 0xc88a3a, 0x8a4a24, 0x9a8a3a][k % 4] });
    }
    // A toppled crate.
    b.add(m.woodGrain, boxUV(roundedBox(0.55, 0.45, 0.55, 0.03), 1), mat(f.X(7.2), 0.25, f.def.z + 0.9, 0.2, 0.6, 1.3), { tint: 0x8a6a48 });
    // Dry, wilted stalks in the plinth vase.
    b.add(m.cloth, bevelCylinder(0.09, 0.07, 0.24, 0.02, 8), mat(f.plinth.x + f.side * 0.62, 0.12, f.plinth.z + 0.5), { tint: 0x7a6a5a });
    for (let k = 0; k < 4; k++) b.add(m.leaf, new THREE.CylinderGeometry(0.008, 0.012, 0.42, 4), mat(f.plinth.x + f.side * 0.62, 0.42, f.plinth.z + 0.5, (r.next() - 0.5) * 0.9, 0, (r.next() - 0.5) * 0.9), { tint: 0x7a6a44 });
    // Cobweb in the outer back corner.
    const web = new THREE.CircleGeometry(0.9, 6, 0, Math.PI / 2);
    b.add(m.web, web, mat(f.X(0.25), f.def.id === 'hearth' ? 3.9 : 2.2, f.z0 + 0.25, 0, f.side > 0 ? Math.PI / 4 : -Math.PI / 4 - Math.PI / 2, Math.PI));
  }

  private dressLit(b: B, f: RoomFrame): void {
    const r = this.rng.fork(`lit-${f.def.id}`);
    const m = hallMats();
    const accent = f.def.color;
    // Room rug (border + field + stripe).
    const rx = f.X(4.6);
    const rz = f.def.z + 0.9;
    b.add(m.cloth, roundedBox(3.4, 0.02, 2.0, 0.01), mat(rx, 0.012, rz), { tint: new THREE.Color(accent).multiplyScalar(0.55).getHex() });
    b.add(m.cloth, roundedBox(3.0, 0.024, 1.6, 0.01), mat(rx, 0.014, rz), { tint: 0xf0e2c0 });
    b.add(m.cloth, roundedBox(2.6, 0.026, 0.28, 0.01), mat(rx, 0.016, rz), { tint: accent });
    for (const dz of [-0.55, 0.55]) b.add(m.cloth, roundedBox(2.6, 0.026, 0.08, 0.01), mat(rx, 0.016, rz + dz), { tint: new THREE.Color(accent).multiplyScalar(0.7).getHex() });
    // Diamond medallions along the stripe + tasselled fringe at both ends.
    for (let k = -2; k <= 2; k++) b.add(m.cloth, roundedBox(0.2, 0.03, 0.2, 0.01), mat(rx + k * 0.5, 0.018, rz, 0, Math.PI / 4, 0), { tint: k % 2 ? 0xf0e2c0 : new THREE.Color(accent).multiplyScalar(0.55).getHex() });
    for (const sx of [-1, 1]) for (let k = 0; k < 11; k++) b.add(m.cloth, roundedBox(0.14, 0.012, 0.035, 0.005), mat(rx + sx * 1.76, 0.008, rz - 0.9 + k * 0.18), { tint: 0xe8d8b0 });
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

  /** Cutscene: ignite a room's lantern (flash, glowmoth burst, dressing swap at the flash peak). */
  ignite(room: RoomId): void {
    const v = this.rooms.get(room);
    if (!v) return;
    v.target = 1;
    v.flash = 1;
    this.swarm();
  }

  /** Glowmoths burst outward from the lanterns and settle back into orbit. */
  swarm(): void {
    for (let i = 0; i < this.moths.n; i++) {
      if (this.mothSeed[i * 4 + 3]! < 0.5) this.mothSeed[i * 4 + 3] = 1.2 + Math.random();
    }
  }

  private applyRoomLook(v: RoomVisual): void {
    const on = v.target > 0.5;
    v.dark.visible = !on;
    v.lit.visible = on;
    const col = v.glimmer ? new THREE.Color(0xdff4ff) : new THREE.Color(v.frame.def.color);
    v.glass.emissive.copy(col);
    v.pane.emissive.copy(col);
    v.light.color.copy(col);
    if (v.frame.def.id === 'hearth') this.hearthFire.active = on && !v.glimmer;
  }

  get litCount(): number {
    let n = 0;
    for (const v of this.rooms.values()) if (v.target > 0.5) n++;
    return n;
  }

  redrawDust(): void {
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
      for (let k = 0; k < 26; k++) blotch(f.X(0.3 + r.next() * 9.4), f.z0 + 0.3 + r.next() * 5.4, 0.5 + r.next() * 1.1, 0.34);
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
      const flick = 0.92 + Math.sin(t * 7.3 + v.frame.def.x) * 0.04 + Math.sin(t * 17.1 + v.frame.def.z) * 0.03;
      v.glass.emissiveIntensity = v.glow * (v.glimmer ? 5 : 3.6) * flick + v.flash * 9;
      v.pane.emissiveIntensity = v.glow * (v.glimmer ? 1.8 : 1.3) * flick + v.flash * 4;
      v.light.intensity = v.glow * (v.glimmer ? 9 : 7) * flick + v.flash * 16;
      lit += v.glow;
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

  init(game: Game): void {
    this.game = game;
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
        this.hall.swarm();
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
      if (game.world.current?.id === 'hall' && this.hall) this.interiorLight(this.hall.warmth);
    };
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

  /** Interior grade: moonlit blue when dark → warm lamplight as rooms relight. */
  private interiorLight(w: number): void {
    const L = this.game.lighting;
    const rc = this.game.rc;
    const cool = new THREE.Color(0x8aa4ff);
    const warm = new THREE.Color(0xffc896);
    L.sun.color.copy(cool).lerp(warm, w);
    L.sun.intensity = 1.25 - w * 0.55;
    L.hemi.color.set(0x5a6aa8).lerp(new THREE.Color(0xffd8b0), w);
    L.hemi.groundColor.set(0x2a2230).lerp(new THREE.Color(0x5a3a28), w);
    L.hemi.intensity = 0.85 + w * 0.1;
    L.bounce.intensity = 0.12 + w * 0.2;
    L.bounce.color.set(0xffb070);
    const bg = new THREE.Color(0x0a0c16).lerp(new THREE.Color(0x160e0a), w);
    L.fog.color.copy(bg);
    L.fog.near = 60;
    L.fog.far = 140;
    (rc.scene.background as THREE.Color).copy(bg);
    rc.scene.environmentIntensity = 0.18 + w * 0.12;
    rc.renderer.toneMappingExposure = 1.22 - w * 0.02;
    const g = rc.post.grade.uniforms;
    (g.uLift!.value as THREE.Vector3).set(0.02 + w * 0.02, 0.022 + w * 0.01, 0.05 - w * 0.02);
    (g.uGain!.value as THREE.Vector3).set(0.96 + w * 0.12, 0.98 + w * 0.02, 1.08 - w * 0.14);
    g.uSaturation!.value = 1.02 + w * 0.1;
    g.uContrast!.value = 1.08;
    g.uVignette!.value = 0.62 - w * 0.12;
    rc.post.setBloom(0.55 + w * 0.15, 0.9);
  }
}
