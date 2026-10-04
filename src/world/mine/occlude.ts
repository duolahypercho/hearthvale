/**
 * Mine see-through + foreground lift (shared by the cave shell, boulders, rocks and props).
 *
 *  - Cutaway: every farmer (local + co-op) and up to a few monsters get a screen-space ellipse
 *    around their body. Cave geometry that is IN FRONT of them (closer to the lens than they are)
 *    and above ankle height is cut away inside it, with a thin warm rim drawn along the cut edge,
 *    so nobody vanishes behind a pillar or a wall lip. Floor never gets cut (height test).
 *  - Foreground lift: the bottom band of the frame (rock between the lens and the floor) is pulled
 *    towards a dim biome tint instead of crushing to black holes beside the HUD.
 *
 * Everything is driven by shared uniforms (no recompiles per floor); `updateOcclusion` fills them
 * once a frame from the camera and the target positions.
 */
import * as THREE from 'three';
import { patchMaterial, after, before } from '../../render/patch';

export const OCC_MAX = 6;

export const OCC = {
  /** xy = screen px (gl_FragCoord space), z = radius px, w = view depth of the target. */
  uOcc: { value: Array.from({ length: OCC_MAX }, () => new THREE.Vector4(-1e4, -1e4, 0, 0)) },
  /** Feet height (world y) per target: geometry below feet + 0.35 m is never cut. */
  uOccY: { value: new Array<number>(OCC_MAX).fill(0) },
  uOccN: { value: 0 },
  /** Frame buffer height (px) for the foreground band. */
  uOccH: { value: 0 },
  /** Dim tint the foreground band lifts towards (linear). */
  uFgLift: { value: new THREE.Color(0.03, 0.02, 0.014) },
};

const GLSL_PARS = /* glsl */ `
uniform vec4 uOcc[${OCC_MAX}];
uniform float uOccY[${OCC_MAX}];
uniform int uOccN;
uniform float uOccH;
uniform vec3 uFgLift;
`;

/**
 * Patch a lit (Standard / Physical) material with the cutaway + foreground lift.
 * @param cut  false = only the foreground lift (e.g. the floor-only meshes).
 */
export function occlusionPatch<M extends THREE.Material>(m: M, cut = true): M {
  patchMaterial(m, `mine-occ:${cut ? 1 : 0}`, (shader) => {
    shader.uniforms.uOcc = OCC.uOcc;
    shader.uniforms.uOccY = OCC.uOccY;
    shader.uniforms.uOccN = OCC.uOccN;
    shader.uniforms.uOccH = OCC.uOccH;
    shader.uniforms.uFgLift = OCC.uFgLift;
    let fs = before(shader.fragmentShader, 'void main() {', GLSL_PARS);
    fs = after(
      fs,
      'void main() {',
      cut
        ? `
      float hvOccRim = 0.0;
      {
        vec3 occV = -vViewPosition;
        // World position from view space (transpose of the view rotation).
        vec3 occW = (vec4(occV - viewMatrix[3].xyz, 0.0) * viewMatrix).xyz;
        for (int i = 0; i < ${OCC_MAX}; i++) {
          if (i >= uOccN) break;
          vec4 o = uOcc[i];
          vec2 d = (gl_FragCoord.xy - o.xy) / vec2(o.z * 0.72, o.z);
          float r = length(d);
          if (r < 1.0 && -occV.z < o.w - 0.55 && occW.y > uOccY[i] + 0.35) {
            if (r < 0.9) discard;
            hvOccRim = max(hvOccRim, 1.0 - abs(r - 0.95) / 0.05);
          }
        }
      }`
        : 'float hvOccRim = 0.0;',
    );
    fs = after(
      fs,
      '#include <dithering_fragment>',
      `{
        float fgk = 1.0 - smoothstep(uOccH * 0.03, uOccH * 0.22, gl_FragCoord.y);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.7 + uFgLift, fgk);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.9, 0.6, 0.3), clamp(hvOccRim, 0.0, 1.0) * 0.55);
      }`,
    );
    shader.fragmentShader = fs;
  });
  return m;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/**
 * Fill the cutaway slots. `targets` = feet positions (farmers first, then monsters), `heights` =
 * body height per target (m). Screen size in device px.
 */
export function updateOcclusion(cam: THREE.Camera, targets: { pos: THREE.Vector3; h: number }[], w: number, h: number): void {
  OCC.uOccH.value = h;
  let n = 0;
  const viewZ = (p: THREE.Vector3): number => -_w.copy(p).applyMatrix4(cam.matrixWorldInverse).z;
  for (const t of targets) {
    if (n >= OCC_MAX) break;
    _v.copy(t.pos);
    _v.y += t.h * 0.55;
    const depth = viewZ(_v);
    if (depth <= 0.5) continue;
    _v.project(cam);
    if (Math.abs(_v.x) > 1.2 || Math.abs(_v.y) > 1.2) continue;
    const sx = (_v.x * 0.5 + 0.5) * w;
    const sy = (_v.y * 0.5 + 0.5) * h;
    // Radius: the body's half height (+ a margin) in pixels.
    _w.copy(t.pos);
    _w.y += t.h * 1.25;
    _w.project(cam);
    const top = (_w.y * 0.5 + 0.5) * h;
    const r = Math.max(24, (top - sy) * 1.05);
    OCC.uOcc.value[n]!.set(sx, sy, r, depth);
    OCC.uOccY.value[n] = t.pos.y;
    n++;
  }
  OCC.uOccN.value = n;
}
