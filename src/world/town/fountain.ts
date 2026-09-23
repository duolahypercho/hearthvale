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
