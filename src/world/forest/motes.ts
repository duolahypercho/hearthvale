/**
 * Dust motes drifting inside Cindergrove's light shafts: tiny additive glints that only light up
 * while they float inside a beam (brightness follows `atmosphere.shafts`, so they swell on fog
 * mornings and vanish under overcast). One Points draw, positions updated on the CPU (~360 motes).
 */
import * as THREE from 'three';

export interface ShaftSpot {
  x: number;
  y: number;
  z: number;
  w: number;
}

const _ls = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/** The same art-directed beam direction the height-fog pass uses (slanted across the view). */
export function shaftDirection(sunDir: THREE.Vector3, camera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
  camera.getWorldDirection(_fwd);
  let sx = -_fwd.z;
  let sz = _fwd.x;
  const l = Math.hypot(sx, sz) || 1;
  sx /= l;
  sz /= l;
  const hs = Math.hypot(sunDir.x, sunDir.z) || 1;
  const lean = (sunDir.x / hs) * sx + (sunDir.z / hs) * sz >= 0 ? 1 : -1;
  return out.set(sx * lean * 0.58 + sunDir.x * 0.15, 0.82, sz * lean * 0.58 + sunDir.z * 0.15).normalize();
}

export class ShaftMotes {
  readonly points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private seeds: Float32Array;
  private readonly n: number;

  constructor(n = 360) {
    this.n = n;
    this.seeds = new Float32Array(n * 4);
    let s = 7349;
    for (let i = 0; i < this.seeds.length; i++) {
      s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
      this.seeds[i] = (s >>> 8) / 16777216;
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(1, 0.93, 0.75) }, uPx: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aGlow;
        uniform float uPx;
        varying float vGlow;
        void main() {
          vGlow = aGlow;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uPx * 0.05 / -mv.z, 1.5, 5.0) * (0.7 + 0.6 * aGlow);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vGlow;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = exp(-d * d * 3.5) * vGlow;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 9;
    this.points.name = 'shaft-motes';
    this.points.userData.noAO = true;
    this.points.userData.perfTag = 'fx';
  }

  update(time: number, shafts: ShaftSpot[], strength: number, sunDir: THREE.Vector3, camera: THREE.Camera, bufH: number): void {
    const k = Math.min(1, strength * 0.6);
    this.points.visible = k > 0.02 && shafts.length > 0;
    if (!this.points.visible) return;
    this.mat.uniforms.uPx!.value = bufH;
    (this.mat.uniforms.uColor!.value as THREE.Color).setRGB(1, 0.93, 0.75).multiplyScalar(0.9 * k);
    const ls = shaftDirection(sunDir, camera, _ls);
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const glow = this.geo.attributes.aGlow as THREE.BufferAttribute;
    // Perpendicular basis around the beam.
    const u = new THREE.Vector3(0, 1, 0).cross(ls).normalize();
    const v = ls.clone().cross(u).normalize();
    const S = this.seeds;
    for (let i = 0; i < this.n; i++) {
      const sh = shafts[i % shafts.length]!;
      const a = S[i * 4]!;
      const b = S[i * 4 + 1]!;
      const c = S[i * 4 + 2]!;
      const d = S[i * 4 + 3]!;
      // Slow upward drift along the beam + a lazy swirl across it.
      const t = ((b * 9 + time * (0.05 + d * 0.06)) % 9) + 0.3;
      const ang = a * 6.283 + time * (0.15 + c * 0.2);
      const r = sh.w * 0.55 * Math.sqrt(c);
      const x = sh.x + ls.x * t + (u.x * Math.cos(ang) + v.x * Math.sin(ang)) * r;
      const y = sh.y + ls.y * t + (u.y * Math.cos(ang) + v.y * Math.sin(ang)) * r;
      const z = sh.z + ls.z * t + (u.z * Math.cos(ang) + v.z * Math.sin(ang)) * r;
      pos.setXYZ(i, x, y, z);
      // Twinkle as the flake turns; fade in / out at the ends of its climb.
      const tw = 0.45 + 0.55 * Math.max(0, Math.sin(time * (1.3 + d * 2.5) + a * 40));
      const ends = Math.min(1, (t - 0.3) / 1.2) * Math.min(1, (9.3 - t) / 2.5);
      glow.setX(i, tw * ends);
    }
    pos.needsUpdate = true;
    glow.needsUpdate = true;
  }
}
