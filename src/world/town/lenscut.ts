import * as THREE from 'three';

/**
 * r16 lens cut-away (critic: "a lamp-post lantern sits right over the farmer's face, a bench cuts
 * across the lower foreground" in a real talk). While the talk / heart-event director owns the frame
 * it publishes up to six sight capsules — the lens to each speaker's head and body — and every town
 * street-prop material screen-door fades the fragments that fall inside one, nearer the lens than the
 * speaker. Static props are merged per 12 m cell, so a single lamp post can't be hidden by instance:
 * the cut works per fragment instead. Off (one uniform branch) outside conversations and scenes.
 */
export const LENS_CUT = {
  on: { value: 0 },
  /** xyz = target point, w = capsule radius at the target. */
  pts: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, -999, 0, 0)) },
  n: { value: 0 },
  /** Props nearer the lens than this (m) fade too: the near foreground of a close talk lens. */
  near: { value: 0 },
};

const patched = new WeakSet<THREE.Material>();

/** Patch a (shared) prop material in place; chained after any onBeforeCompile it already has. */
export function installLensCut(mat: THREE.Material): void {
  if (patched.has(mat)) return;
  const m = mat as THREE.Material & { isMeshStandardMaterial?: boolean; isMeshLambertMaterial?: boolean; isMeshPhongMaterial?: boolean; isMeshToonMaterial?: boolean; isMeshBasicMaterial?: boolean };
  if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial || m.isMeshBasicMaterial)) return;
  patched.add(mat);
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (this: THREE.Material, s, r) {
    prev?.call(this, s, r);
    s.uniforms.hvCutOn = LENS_CUT.on;
    s.uniforms.hvCutPts = LENS_CUT.pts;
    s.uniforms.hvCutN = LENS_CUT.n;
    s.uniforms.hvCutNear = LENS_CUT.near;
    if (!s.vertexShader.includes('#include <project_vertex>')) return;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHvCutW;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  {
    vec4 hvW = vec4( transformed, 1.0 );
    #ifdef USE_BATCHING
      hvW = batchingMatrix * hvW;
    #endif
    #ifdef USE_INSTANCING
      hvW = instanceMatrix * hvW;
    #endif
    vHvCutW = ( modelMatrix * hvW ).xyz;
  }`,
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vHvCutW;
uniform float hvCutOn;
uniform float hvCutN;
uniform float hvCutNear;
uniform vec4 hvCutPts[6];`,
      )
      .replace(
        'void main() {',
        `void main() {
  if ( hvCutOn > 0.5 ) {
    vec3 hvA = cameraPosition;
    float hvCut = 1.0 - smoothstep( hvCutNear - 0.3, hvCutNear, length( vHvCutW - hvA ) );
    for ( int i = 0; i < 6; i++ ) {
      if ( float( i ) >= hvCutN ) break;
      vec3 hvB = hvCutPts[ i ].xyz;
      vec3 ab = hvB - hvA;
      float t = clamp( dot( vHvCutW - hvA, ab ) / max( dot( ab, ab ), 1e-4 ), 0.0, 1.0 );
      // (only in front of the target: the capsule ends 0.35 m short of it, and it narrows to the lens)
      float len = length( ab );
      if ( t * len > len - 0.35 ) continue;
      float r = hvCutPts[ i ].w * mix( 0.45, 1.0, t );
      float d = length( vHvCutW - ( hvA + ab * t ) );
      hvCut = max( hvCut, 1.0 - smoothstep( r * 0.82, r, d ) );
    }
    if ( hvCut > 0.0 ) {
      // 4x4 ordered dither: a soft-edged hole, solid nowhere inside
      ivec2 q = ivec2( mod( floor( gl_FragCoord.xy ), 4.0 ) );
      mat4 hvB4 = mat4( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
      float bayer = ( hvB4[ q.x ][ q.y ] + 0.5 ) / 16.0;
      if ( min( 1.0, hvCut * 1.15 ) > bayer ) discard;
    }
  }`,
      );
  };
  mat.customProgramCacheKey = () => `${prevKey ? prevKey.call(mat) : ''}|hvcut`;
  mat.needsUpdate = true;
}

/** Publish the speakers' sight capsules (empty list = off). */
export function setLensCut(pts: { x: number; y: number; z: number; r: number }[], near = 0): void {
  const n = Math.min(6, pts.length);
  LENS_CUT.near.value = near;
  for (let i = 0; i < n; i++) LENS_CUT.pts.value[i]!.set(pts[i]!.x, pts[i]!.y, pts[i]!.z, pts[i]!.r);
  LENS_CUT.n.value = n;
  LENS_CUT.on.value = n > 0 ? 1 : 0;
}

/**
 * r16 (critic: "in talk close-ups the grass cards are knee-high, poke through Hazel's skirt and look
 * like thin paper strips"): while a talk / event owns the frame, the blades round the speakers' feet
 * shrink to a lawn (≈ 25 % height inside 0.6 m, back to full by 1.7 m) and the near blades thin.
 */
export const GRASS_CLEAR = {
  on: { value: 0 },
  pts: { value: [new THREE.Vector3(0, -999, 0), new THREE.Vector3(0, -999, 0), new THREE.Vector3(0, -999, 0)] },
};
const grassPatched = new WeakSet<THREE.Material>();
export function installGrassClear(mat: THREE.Material): void {
  if (grassPatched.has(mat)) return;
  grassPatched.add(mat);
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (this: THREE.Material, s, r) {
    prev?.call(this, s, r);
    if (!s.vertexShader.includes('vGOrigin') || !s.vertexShader.includes('#include <project_vertex>')) return;
    s.uniforms.hvClearOn = GRASS_CLEAR.on;
    s.uniforms.hvClearPts = GRASS_CLEAR.pts;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float hvClearOn;\nuniform vec3 hvClearPts[3];')
      .replace(
        '#include <project_vertex>',
        `if ( hvClearOn > 0.5 ) {
    float hvK = 1.0;
    for ( int i = 0; i < 3; i++ ) hvK = min( hvK, smoothstep( 0.55, 1.7, length( vGOrigin.xz - hvClearPts[ i ].xz ) ) );
    transformed.y *= mix( 0.25, 1.0, hvK );
    transformed.xz *= mix( 0.7, 1.0, hvK );
  }
  #include <project_vertex>`,
      );
  };
  mat.customProgramCacheKey = () => `${prevKey ? prevKey.call(mat) : ''}|hvclear`;
  mat.needsUpdate = true;
}
export function setGrassClear(pts: { x: number; z: number }[]): void {
  for (let i = 0; i < 3; i++) {
    const p = pts[i];
    GRASS_CLEAR.pts.value[i]!.set(p ? p.x : 0, p ? 0 : -999, p ? p.z : -9999);
  }
  GRASS_CLEAR.on.value = pts.length ? 1 : 0;
}
