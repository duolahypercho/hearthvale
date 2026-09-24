/**
 * One-shot GPU bakes (DESIGN pillar 14): static per-pixel work (e.g. the terrain's world-space noise
 * fields) rendered once into a texture instead of recomputed for every pixel of every frame.
 *
 * Owners queue a bake when they build their material (no renderer needed at that point); the render
 * context runs pending bakes before the next compile() / frame, so the texture is filled before the
 * first draw that samples it.
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

type Bake = (renderer: THREE.WebGLRenderer) => void;
const pending: Bake[] = [];

export function queueBake(fn: Bake): void {
  pending.push(fn);
}

/** Run every queued bake (cheap no-op when nothing is queued). */
export function runBakes(renderer: THREE.WebGLRenderer): void {
  if (!pending.length) return;
  const prev = renderer.getRenderTarget();
  const auto = renderer.autoClear;
  try {
    for (const fn of pending.splice(0)) fn(renderer);
  } finally {
    renderer.autoClear = auto;
    renderer.setRenderTarget(prev);
  }
}

let quad: FullScreenQuad | null = null;

/** Render `material` over the whole of `target` (a full-screen triangle; `vUv` = texel centre). */
export function bakeInto(renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget): void {
  quad ??= new FullScreenQuad();
  quad.material = material;
  renderer.setRenderTarget(target);
  renderer.autoClear = false;
  quad.render(renderer);
}

/** A texture target for a bake: RGBA8, bilinear, clamped, no depth. */
export function bakeTarget(w: number, h: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
  rt.texture.minFilter = THREE.LinearFilter;
  rt.texture.magFilter = THREE.LinearFilter;
  rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  return rt;
}
