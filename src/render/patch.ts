/**
 * Composable onBeforeCompile patches. Several modules (wind, snow, cloud shadows...) can
 * patch the same material; each patch has a key that participates in the program cache key.
 */
import type * as THREE from 'three';

export type ShaderPatch = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

interface PatchedMaterial extends THREE.Material {
  __hvPatches?: { key: string; fn: ShaderPatch }[];
}

export function patchMaterial<M extends THREE.Material>(material: M, key: string, fn: ShaderPatch): M {
  const m = material as M & PatchedMaterial;
  if (!m.__hvPatches) {
    m.__hvPatches = [];
    const list = m.__hvPatches;
    m.onBeforeCompile = (shader, renderer) => {
      for (const p of list) p.fn(shader, renderer);
    };
    m.customProgramCacheKey = () => list.map((p) => p.key).join('|');
  }
  const existing = m.__hvPatches.findIndex((p) => p.key === key);
  if (existing >= 0) m.__hvPatches[existing] = { key, fn };
  else m.__hvPatches.push({ key, fn });
  m.needsUpdate = true;
  return material;
}

/** Insert `code` after the first occurrence of `anchor` (throws if missing, to catch three upgrades). */
export function after(src: string, anchor: string, code: string): string {
  const i = src.indexOf(anchor);
  if (i < 0) throw new Error(`[patch] anchor not found: ${anchor}`);
  return src.slice(0, i + anchor.length) + '\n' + code + '\n' + src.slice(i + anchor.length);
}

export function before(src: string, anchor: string, code: string): string {
  const i = src.indexOf(anchor);
  if (i < 0) throw new Error(`[patch] anchor not found: ${anchor}`);
  return src.slice(0, i) + code + '\n' + src.slice(i);
}

export function replace(src: string, anchor: string, code: string): string {
  if (!src.includes(anchor)) throw new Error(`[patch] anchor not found: ${anchor}`);
  return src.replace(anchor, code);
}
