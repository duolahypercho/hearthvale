/**
 * Shared material library. All outdoor materials get the world FX patch (snow, wetness,
 * cloud shadows). Materials expect a `color` vertex attribute (baked AO/tint); geometry
 * built through world/geom.ts MeshBuilder always has one.
 *
 *   const m = materials.get('wood');
 *
 * Night-glow materials (windows, lanterns) are registered in `nightGlow` and have their
 * emissiveIntensity driven by the day/night rig.
 */
import * as THREE from 'three';
import { textures } from './textures';
import { applyWorldFx } from './worldfx';
import { patchMaterial, after, before } from './patch';
import { globalUniforms } from './uniforms';

export type MaterialName =
  | 'wood'
  | 'woodGrain'
  | 'woodDark'
  | 'woodPaint'
  | 'stone'
  | 'roof'
  | 'thatch'
  | 'plaster'
  | 'metal'
  | 'glass'
  | 'lampGlow'
  | 'rock'
  | 'bark'
  | 'cloth'
  | 'white'
  | 'soilPot'
  | 'stillWater'
  | 'boxFlower'
  | 'roofTile'
  | 'paperLantern';

const cache = new Map<MaterialName, THREE.Material>();

/** Emissive materials that light up at night: [material, intensity at full night]. */
export const nightGlow: { material: THREE.MeshStandardMaterial; max: number }[] = [];

function std(params: THREE.MeshStandardMaterialParameters, fx = true): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, ...params });
  if (fx) applyWorldFx(m);
  return m;
}

function build(name: MaterialName): THREE.Material {
  switch (name) {
    case 'wood': {
      const t = textures.wood();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 2.5, roughness: 0.82, color: 0xffffff });
    }
    case 'woodGrain': {
      const t = textures.woodGrain();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 1.5, roughness: 0.8 });
    }
    case 'woodDark': {
      const t = textures.woodGrain();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 1.5, roughness: 0.85, color: 0x8a6a55 });
    }
    case 'woodPaint': {
      const t = textures.woodGrain();
      return std({ bumpMap: t.bump, bumpScale: 0.6, roughness: 0.7, color: 0xf2e8d5 });
    }
    case 'stone': {
      const t = textures.stone();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 3, roughness: 0.92 });
    }
    case 'roof': {
      const t = textures.shingles();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 3, roughness: 0.72, color: 0xb87258 });
    }
    case 'thatch': {
      const t = textures.thatch();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 2, roughness: 0.95 });
    }
    case 'plaster':
      return std({ roughness: 0.9, color: 0xf1e4c8 });
    case 'metal':
      return std({ roughness: 0.45, metalness: 0.35, color: 0x5a554f });
    case 'glass': {
      const m = std({ roughness: 0.15, metalness: 0.0, color: 0x3a4a5c, emissive: 0xffa94d, emissiveIntensity: 0 }, false);
      nightGlow.push({ material: m, max: 2.6 });
      return m;
    }
    case 'lampGlow': {
      const m = std({ roughness: 0.4, color: 0xfff0d0, emissive: 0xffc070, emissiveIntensity: 0.2 }, false);
      nightGlow.push({ material: m, max: 4 });
      return m;
    }
    case 'rock': {
      const t = textures.granite();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 2.2, roughness: 0.84 });
    }
    case 'bark': {
      const t = textures.bark();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 2, roughness: 0.95 });
    }
    case 'cloth':
      return std({ roughness: 0.95 });
    case 'white':
      return std({ roughness: 0.8 });
    case 'soilPot':
      return std({ roughness: 0.85, color: 0xb8643e });
    case 'boxFlower': {
      // Window-box planting that follows the seasons: spring/summer blooms, fall mums,
      // winter evergreen sprigs with holly berries.
      const m = std({ roughness: 0.75 });
      patchMaterial(m, 'box-flower', (shader) => {
        shader.uniforms.uSeasonW = globalUniforms.uSeasonW;
        let fs = before(shader.fragmentShader, 'void main() {', 'uniform vec4 uSeasonW;');
        fs = after(
          fs,
          '#include <color_fragment>',
          /* glsl */ `
          {
            vec3 bc = diffuseColor.rgb;
            bool leafy = bc.g > bc.r * 1.15 && bc.g > bc.b * 1.1;
            float hb = fract(sin(dot(floor(vHvWorldPos * 9.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            vec3 mum = hb < 0.3 ? vec3(0.62, 0.12, 0.05) : hb < 0.6 ? vec3(0.85, 0.35, 0.05) : hb < 0.85 ? vec3(0.85, 0.6, 0.1) : vec3(0.35, 0.12, 0.45);
            vec3 fallC = leafy ? bc * vec3(0.9, 0.8, 0.55) : mum;
            vec3 winterC = leafy ? vec3(0.06, 0.16, 0.08) : (hb < 0.5 ? vec3(0.55, 0.03, 0.03) : vec3(0.07, 0.18, 0.09));
            diffuseColor.rgb = bc * (uSeasonW.x + uSeasonW.y) + fallC * uSeasonW.z + winterC * uSeasonW.w;
          }`,
        );
        shader.fragmentShader = fs;
      });
      return m;
    }
    case 'roofTile': {
      // Neutral shingles: the vertex tint IS the roof colour (town roofs of every hue).
      const t = textures.shingles();
      return std({ map: t.map, bumpMap: t.bump, bumpScale: 3, roughness: 0.72, color: 0xffffff });
    }
    case 'paperLantern': {
      // Festival paper lanterns: glow in their own (vertex) colour at night.
      const m = std({ roughness: 0.6 }, false);
      patchMaterial(m, 'paper-lantern', (shader) => {
        shader.uniforms.uLamps = globalUniforms.uLamps;
        let fs = before(shader.fragmentShader, 'void main() {', 'uniform float uLamps;');
        fs = after(fs, '#include <emissivemap_fragment>', 'totalEmissiveRadiance += diffuseColor.rgb * diffuseColor.rgb * uLamps * 1.4;');
        shader.fragmentShader = fs;
      });
      return m;
    }
    case 'stillWater':
      return std({ roughness: 0.08, metalness: 0.1, color: 0x6a9ab8 }, false);
  }
}

export const materials = {
  get(name: MaterialName): THREE.Material {
    let m = cache.get(name);
    if (!m) {
      m = build(name);
      m.name = name;
      cache.set(name, m);
    }
    return m;
  },
};
