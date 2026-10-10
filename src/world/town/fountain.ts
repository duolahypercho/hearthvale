/**
 * Plaza fountain water (the stone fountain itself is props/townkit.ts `buildFountain`):
 *   · four arcing jets from the crown into the upper bowl + six overflow streams from the bowl's
 *     lip into the pool — one merged tube mesh with a scrolling, glinting stream shader
 *   · expanding ripple rings where the water lands (one instanced, additive mesh)
 * Two draw calls, main pass only (no shadows, no AO). Dims with the night.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const STREAM_VS = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const STREAM_FS = /* glsl */ `
  uniform float uTime;
  uniform float uDim;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    // uv.x runs along the stream (0 = source), uv.y around the tube.
    float flow = uv_flow(vUv.x * 26.0 - uTime * 9.0);
    float rim = 1.0 - abs(dot(normalize(vN), vView));
    float a = (0.16 + 0.5 * rim) * (0.5 + 0.5 * flow);
    a *= smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.86, 1.0, vUv.x) * 0.6);
    vec3 col = mix(vec3(0.5, 0.74, 0.9), vec3(0.96, 0.99, 1.0), 0.25 + 0.75 * flow * rim);
    gl_FragColor = vec4(col * uDim, a * (0.55 + 0.45 * uDim));
  }
`.replace(
  'void main() {',
  /* glsl */ `
  float uv_flow(float x) {
    return 0.5 + 0.5 * sin(x) * sin(x * 0.37 + 1.7);
  }
  void main() {`,
);

/** A tube along a ballistic arc from `a` (launched along `dir`) landing at `b`. */
function arc(a: THREE.Vector3, b: THREE.Vector3, lift: number, radius: number, seg = 16): THREE.BufferGeometry {
  const mid = a.clone().lerp(b, 0.5);
  mid.y = Math.max(a.y, b.y) + lift;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  return new THREE.TubeGeometry(curve, seg, radius, 6, false);
}

export class FountainFX {
  readonly group = new THREE.Group();
  private streamMat: THREE.ShaderMaterial;
  private rings: THREE.InstancedMesh;
  private ringSpots: { x: number; y: number; z: number; r: number; phase: number; speed: number }[] = [];
  private m = new THREE.Matrix4();
  private c = new THREE.Color();
  private t = 0;

  /** `base`: fountain ground centre (world). */
  constructor(base: THREE.Vector3) {
    this.group.name = 'fountain-water';
    this.group.userData.perfTag = 'fountain';
    this.group.position.copy(base);
    const parts: THREE.BufferGeometry[] = [];
    // Crown jets: from just above the finial, arcing into the upper bowl.
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const a = new THREE.Vector3(Math.cos(ang) * 0.06, 2.5, Math.sin(ang) * 0.06);
      const b = new THREE.Vector3(Math.cos(ang) * 0.62, 1.76, Math.sin(ang) * 0.62);
      parts.push(arc(a, b, 0.28, 0.024));
      this.ringSpots.push({ x: b.x, y: 1.765, z: b.z, r: 0.28, phase: i * 0.27, speed: 1.4 });
    }
    // Overflow streams from the bowl lip into the pool.
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + 0.2;
      const a = new THREE.Vector3(Math.cos(ang) * 0.99, 1.79, Math.sin(ang) * 0.99);
      const b = new THREE.Vector3(Math.cos(ang) * 1.3, 0.37, Math.sin(ang) * 1.3);
      parts.push(arc(a, b, 0.04, 0.034, 14));
      this.ringSpots.push({ x: b.x, y: 0.375, z: b.z, r: 0.5, phase: i * 0.19, speed: 0.9 });
    }
    const geo = mergeGeometries(parts)!;
    for (const p of parts) p.dispose();
    this.streamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uDim: { value: 1 } },
      vertexShader: STREAM_VS,
      fragmentShader: STREAM_FS,
      transparent: true,
      depthWrite: false,
    });
    const streams = new THREE.Mesh(geo, this.streamMat);
    streams.name = 'fountain-streams';
    streams.renderOrder = 2;
    streams.userData.noAO = true;
    this.group.add(streams);

    // Ripple rings: two per landing spot, offset in phase.
    const ringGeo = new THREE.RingGeometry(0.82, 1, 28, 1).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    this.rings = new THREE.InstancedMesh(ringGeo, ringMat, this.ringSpots.length * 2);
    this.rings.name = 'fountain-ripples';
    this.rings.renderOrder = 2;
    this.rings.frustumCulled = false;
    this.rings.userData.noAO = true;
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.ringSpots.length * 2 * 3), 3);
    this.group.add(this.rings);
    this.update(0, 0);
  }

  update(dt: number, night: number): void {
    this.t += dt;
    const dim = 1 - 0.72 * night;
    this.streamMat.uniforms.uTime!.value = this.t;
    this.streamMat.uniforms.uDim!.value = dim;
    let k = 0;
    for (const s of this.ringSpots) {
      for (let j = 0; j < 2; j++) {
        const p = (this.t * s.speed * 0.6 + s.phase + j * 0.5) % 1;
        const r = s.r * (0.15 + 0.85 * p);
        this.m.makeScale(r, 1, r).setPosition(s.x, s.y + 0.004 * j, s.z);
        this.rings.setMatrixAt(k, this.m);
        const a = (1 - p) * (1 - p) * 0.55 * dim;
        this.c.setRGB(a * 0.85, a * 0.95, a);
        this.rings.setColorAt(k, this.c);
        k++;
      }
    }
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }
}

/** Ice sheet canvas: pale blue-white ice with a frosted rim lip, white cracks with blue shadow, snow dust. */
function iceTexture(seed = 7): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  let s = seed;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
  // (the icicles / frozen jets sample the top-left corner: glassy blue-white)
  g.fillStyle = '#d4ebf7';
  g.fillRect(0, 0, S, S);
  const rad = g.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S / 2);
  rad.addColorStop(0, '#6fa6cf');
  rad.addColorStop(0.55, '#8dbde0');
  rad.addColorStop(0.86, '#c4e0f2');
  rad.addColorStop(0.97, '#f4f9fd');
  rad.addColorStop(1, '#f8fbfe');
  g.fillStyle = rad;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  g.fill();
  // Cloudy freeze patches (trapped air) and a few bubbles.
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * S * 0.42;
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    const gr = g.createRadialGradient(x, y, 0, x, y, 18 + rnd() * 40);
    gr.addColorStop(0, `rgba(240,248,255,${0.18 + rnd() * 0.25})`);
    gr.addColorStop(1, 'rgba(240,248,255,0)');
    g.fillStyle = gr;
    g.fillRect(x - 60, y - 60, 120, 120);
  }
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * S * 0.4;
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 1.5 + rnd() * 3, 0, Math.PI * 2);
    g.stroke();
  }
  // Cracks: branching lines from a few impact points, a blue shadow under a white edge.
  const crack = (x: number, y: number, ang: number, len: number, w: number, depth: number): void => {
    let px = x;
    let py = y;
    const pts: [number, number][] = [[px, py]];
    const n = Math.max(3, Math.floor(len / 14));
    for (let i = 0; i < n; i++) {
      ang += (rnd() - 0.5) * 0.7;
      px += Math.cos(ang) * (len / n);
      py += Math.sin(ang) * (len / n);
      if (Math.hypot(px - S / 2, py - S / 2) > S * 0.47) break;
      pts.push([px, py]);
      if (depth > 0 && rnd() < 0.18) crack(px, py, ang + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6), len * 0.45, w * 0.7, depth - 1);
    }
    for (const [col, lw, oy] of [['rgba(60,110,150,0.55)', w + 1.6, 1.4], ['rgba(255,255,255,0.95)', w, 0]] as const) {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(pts[0]![0], pts[0]![1] + oy);
      for (const p of pts) g.lineTo(p[0], p[1] + oy);
      g.stroke();
    }
  };
  for (let k = 0; k < 3; k++) {
    const a = rnd() * Math.PI * 2;
    const r = S * (0.12 + rnd() * 0.18);
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    for (let j = 0; j < 4 + Math.floor(rnd() * 3); j++) crack(x, y, rnd() * Math.PI * 2, S * (0.12 + rnd() * 0.2), 2.2, 2);
    // A star of short hairlines round the impact.
    for (let j = 0; j < 7; j++) crack(x, y, (j / 7) * Math.PI * 2, S * 0.04, 1, 0);
  }
  // Snow dust blown onto the ice: soft drifts against the rim (thicker on one side) and a few skiffs.
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2;
    const lee = 0.5 + 0.5 * Math.cos(a - 2.2);
    const r = S * (0.4 + rnd() * 0.08);
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    const R = 10 + rnd() * 26 * (0.4 + lee);
    const gr = g.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, `rgba(255,255,255,${0.5 + 0.45 * lee})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(x - R, y - R, R * 2, R * 2);
  }
  for (let i = 0; i < 9; i++) {
    const x = S * (0.25 + rnd() * 0.5);
    const y = S * (0.25 + rnd() * 0.5);
    g.save();
    g.translate(x, y);
    g.rotate(rnd() * Math.PI);
    g.scale(1, 0.3);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 30 + rnd() * 30);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(-70, -70, 140, 140);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** UVs of a geometry pinned to the texture's glassy corner (icicles, frozen jets). */
function cornerUV(gm: THREE.BufferGeometry): THREE.BufferGeometry {
  const uv = gm.attributes.uv as THREE.BufferAttribute | undefined;
  if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.012 + (i % 3) * 0.004, 0.012 + (i % 5) * 0.003);
  return gm;
}

/**
 * r12 (critic: "the fountain basin is still open liquid blue in a snowstorm"): the winter fountain —
 * an ice sheet over the pool and the upper bowl (cracks, trapped air, snow blown against the rim), the
 * four crown jets frozen mid-arc, the overflow streams caught as fat icicle columns half way down, and
 * icicles fringing both lips. One mesh, one draw call, main pass only.
 */
export function buildFountainIce(base: THREE.Vector3): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const disc = (r: number, y: number): void => {
    parts.push(new THREE.CircleGeometry(r, 48).rotateX(-Math.PI / 2).translate(0, y, 0));
  };
  disc(1.99, 0.385);
  disc(0.88, 1.765);
  let s = 11;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
  // Frozen crown jets: thicker, lumpy glass arcs ending in a drip.
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const a = new THREE.Vector3(Math.cos(ang) * 0.06, 2.5, Math.sin(ang) * 0.06);
    const b = new THREE.Vector3(Math.cos(ang) * 0.6, 1.8, Math.sin(ang) * 0.6);
    parts.push(cornerUV(arc(a, b, 0.24, 0.04, 12)));
    parts.push(cornerUV(new THREE.ConeGeometry(0.05, 0.16, 7).rotateX(Math.PI).translate(b.x, b.y - 0.02, b.z)));
  }
  // Overflow streams caught mid-fall: a tapering column from the bowl lip, an icicle tip below.
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + 0.2;
    const x = Math.cos(ang) * 1.02;
    const z = Math.sin(ang) * 1.02;
    const len = 0.5 + rnd() * 0.45;
    parts.push(cornerUV(new THREE.CylinderGeometry(0.045, 0.06, len, 7).translate(x * 1.03, 1.78 - len / 2, z * 1.03)));
    parts.push(cornerUV(new THREE.ConeGeometry(0.045, 0.22 + rnd() * 0.12, 7).rotateX(Math.PI).translate(x * 1.03, 1.78 - len - 0.1, z * 1.03)));
  }
  // Icicle fringes on the upper bowl's lip and the basin rim's outer edge.
  for (let i = 0; i < 26; i++) {
    const ang = (i / 26) * Math.PI * 2 + rnd() * 0.15;
    const l = 0.08 + rnd() * 0.2;
    parts.push(cornerUV(new THREE.ConeGeometry(0.016 + rnd() * 0.014, l, 5).rotateX(Math.PI).translate(Math.cos(ang) * 0.99, 1.78 - l / 2, Math.sin(ang) * 0.99)));
  }
  for (let i = 0; i < 34; i++) {
    const ang = (i / 34) * Math.PI * 2 + rnd() * 0.12;
    const l = 0.05 + rnd() * 0.12;
    parts.push(cornerUV(new THREE.ConeGeometry(0.014 + rnd() * 0.01, l, 5).rotateX(Math.PI).translate(Math.cos(ang) * 2.24, 0.56 - l / 2, Math.sin(ang) * 2.24)));
  }
  // (CircleGeometry is indexed, the cones / tubes too; mergeGeometries needs one kind: drop indices)
  const flat = parts.map((p) => {
    const q = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') q.deleteAttribute(k);
    return q;
  });
  const geo = mergeGeometries(flat)!;
  for (const p of parts) p.dispose();
  const mat = new THREE.MeshStandardMaterial({ map: iceTexture(), roughness: 0.16, metalness: 0, emissive: new THREE.Color(0x5d8fb4), emissiveIntensity: 0.1 });
  mat.name = 'fountain-ice';
  const m = new THREE.Mesh(geo, mat);
  m.name = 'fountain-ice';
  m.position.copy(base);
  m.userData.perfTag = 'fountain';
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}
