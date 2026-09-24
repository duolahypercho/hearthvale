/**
 * Item art for animal goods the UI painter has no keyword for (eggs / milk are painted by
 * ui/icons.ts). 64×64 viewBox like the painted set.
 */
import * as THREE from 'three';
import { registerItemIcon } from '../../ui/icons';
import { buildAnimal, type Species } from '../../entities/animals-models';

const portraits = new Map<string, string>();

/**
 * Turntable portraits of the real 3D animal models for the carpenter's cards (3/4 view, soft key +
 * rim light, 256 px PNG data URLs, cached). Rendered once on a throwaway WebGL context so the game's
 * renderer state is untouched.
 */
export function animalPortraits(list: { species: Species; variant: number }[]): Map<string, string> {
  const todo = list.filter((a) => !portraits.has(`${a.species}:${a.variant}`));
  if (!todo.length) return portraits;
  const S = 256;
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(S, S, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x8a6a4a, 1.6));
    const key = new THREE.DirectionalLight(0xfff0d8, 2.6);
    key.position.set(2, 4, 3);
    const rim = new THREE.DirectionalLight(0xcfe0ff, 1.4);
    rim.position.set(-3, 2, -2);
    scene.add(key, rim);
    const cam = new THREE.PerspectiveCamera(26, 1, 0.05, 50);
    for (const a of todo) {
      const m = buildAnimal(a.species, a.variant);
      const root = new THREE.Group();
      root.add(m.mesh);
      root.rotation.y = 0.62;
      scene.add(root);
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(m.mesh);
      const c = box.getCenter(new THREE.Vector3());
      const r = box.getSize(new THREE.Vector3()).length() * 0.5;
      const dist = r / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 0.9;
      cam.position.set(c.x, c.y + dist * 0.32, c.z + dist * 0.95);
      cam.lookAt(c.x, c.y - r * 0.05, c.z);
      renderer.render(scene, cam);
      portraits.set(`${a.species}:${a.variant}`, canvas.toDataURL('image/png'));
      scene.remove(root);
    }
  } catch {
    /* no WebGL (tests): the cards keep their painted medallions */
  } finally {
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
  return portraits;
}

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

let done = false;
export function registerAnimalIcons(): void {
  if (done) return;
  done = true;
  registerItemIcon(
    'wool',
    svg(
      `<defs><radialGradient id="wl" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#f3ead6"/><stop offset="1" stop-color="#c8b898"/></radialGradient></defs>` +
        `<ellipse cx="32" cy="55" rx="22" ry="4" fill="#000" opacity=".16"/>` +
        `<path d="M12 40 C6 38 6 28 13 27 C12 19 21 15 26 19 C29 12 39 12 41 19 C48 15 57 21 53 28 C60 30 59 41 52 42 C52 50 42 53 37 48 C33 54 23 53 21 47 C14 50 8 45 12 40 Z" fill="url(#wl)" stroke="#8a7456" stroke-width="3"/>` +
        `<path d="M20 30 C23 27 27 28 28 31 M34 25 C37 22 41 23 42 26 M36 38 C39 35 43 36 44 39 M22 40 C25 37 29 38 30 41" fill="none" stroke="#c8b28a" stroke-width="2"/>` +
        `<ellipse cx="24" cy="24" rx="5" ry="3" fill="#fff" opacity=".9" transform="rotate(-20 24 24)"/>`,
    ),
  );
  registerItemIcon(
    'truffle',
    svg(
      `<defs><radialGradient id="tf" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#7a5a48"/><stop offset=".55" stop-color="#3e2a22"/><stop offset="1" stop-color="#1c120e"/></radialGradient></defs>` +
        `<ellipse cx="32" cy="55" rx="20" ry="4" fill="#000" opacity=".2"/>` +
        `<path d="M14 36 C10 24 20 12 32 13 C46 12 56 24 51 38 C48 50 40 55 31 55 C21 55 16 48 14 36 Z" fill="url(#tf)" stroke="#120a08" stroke-width="3"/>` +
        `<g fill="#5e4436" opacity=".9"><circle cx="22" cy="28" r="2.4"/><circle cx="30" cy="22" r="2"/><circle cx="40" cy="26" r="2.6"/><circle cx="26" cy="38" r="2.2"/><circle cx="36" cy="36" r="2.8"/><circle cx="44" cy="40" r="2"/><circle cx="30" cy="47" r="2"/></g>` +
        `<ellipse cx="25" cy="22" rx="5" ry="2.6" fill="#fff" opacity=".35" transform="rotate(-25 25 22)"/>` +
        `<path d="M44 12 C46 8 50 8 52 10" fill="none" stroke="#5a8a3a" stroke-width="2.4"/><ellipse cx="53" cy="12" rx="4" ry="2" fill="#7ab04a" transform="rotate(-30 53 12)"/>`,
    ),
  );
  registerItemIcon(
    'hay',
    svg(
      `<defs><linearGradient id="hy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbe49a"/><stop offset=".6" stop-color="#e2b650"/><stop offset="1" stop-color="#a87a24"/></linearGradient></defs>` +
        `<ellipse cx="32" cy="56" rx="24" ry="4" fill="#000" opacity=".16"/>` +
        `<path d="M8 24 C8 18 14 16 32 16 C50 16 56 18 56 24 V46 C56 52 50 54 32 54 C14 54 8 52 8 46 Z" fill="url(#hy)" stroke="#7a5418" stroke-width="3"/>` +
        `<path d="M8 30 H56 M8 40 H56" stroke="#b83a2a" stroke-width="3"/>` +
        `<path d="M14 20 L12 50 M22 18 L21 52 M30 17 L31 53 M38 17 L40 53 M46 18 L48 52" stroke="#c89a3a" stroke-width="1.4" opacity=".8"/>` +
        `<path d="M10 22 L4 16 M54 22 L60 15 M18 17 L15 10 M44 17 L48 10 M30 16 L31 9" stroke="#e8c464" stroke-width="2"/>`,
    ),
  );
  registerItemIcon(
    'milkPail',
    svg(
      `<defs><linearGradient id="mp" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9aa6ac"/><stop offset=".35" stop-color="#f4f8fa"/><stop offset=".7" stop-color="#c8d2d6"/><stop offset="1" stop-color="#8a969c"/></linearGradient></defs>` +
        `<ellipse cx="32" cy="57" rx="20" ry="4" fill="#000" opacity=".18"/>` +
        `<path d="M14 22 C14 10 50 10 50 22" fill="none" stroke="#5a6468" stroke-width="3.2"/>` +
        `<path d="M13 24 L17 52 C18 56 46 56 47 52 L51 24 Z" fill="url(#mp)" stroke="#4a5458" stroke-width="3"/>` +
        `<ellipse cx="32" cy="24" rx="19" ry="5.5" fill="#fbf8ef" stroke="#4a5458" stroke-width="3"/>` +
        `<ellipse cx="27" cy="23" rx="7" ry="1.8" fill="#fff" opacity=".9"/>` +
        `<path d="M15.5 34 H48.5 M16.8 44 H47.2" stroke="#8a969c" stroke-width="2"/>` +
        `<path d="M20 30 L22 50" stroke="#fff" stroke-width="2.4" opacity=".7"/>`,
    ),
  );
  registerItemIcon(
    'shears',
    svg(
      `<ellipse cx="32" cy="58" rx="18" ry="3.5" fill="#000" opacity=".16"/>` +
        `<path d="M30 8 L22 40 L28 41 Z" fill="#dfe6ea" stroke="#4a5458" stroke-width="2.6"/>` +
        `<path d="M34 8 L42 40 L36 41 Z" fill="#c8d2d6" stroke="#4a5458" stroke-width="2.6"/>` +
        `<path d="M24 11 L23 36" stroke="#fff" stroke-width="1.6" opacity=".8"/>` +
        `<path d="M22 40 C18 48 22 56 32 56 C42 56 46 48 42 40 C38 46 26 46 22 40 Z" fill="#c8503a" stroke="#6a2418" stroke-width="3"/>` +
        `<path d="M27 49 C30 51 34 51 37 49" stroke="#f0a088" stroke-width="2" fill="none"/>`,
    ),
  );
  registerItemIcon(
    'duckFeather',
    svg(
      `<defs><linearGradient id="df" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7ae0a0"/><stop offset=".5" stop-color="#2e8a5e"/><stop offset="1" stop-color="#1e4a6a"/></linearGradient></defs>` +
        `<path d="M50 8 C30 14 14 30 12 50 C24 50 42 38 50 8 Z" fill="url(#df)" stroke="#123a2e" stroke-width="3"/>` +
        `<path d="M50 8 L10 56" stroke="#f4f0e0" stroke-width="2.4"/>` +
        `<path d="M40 20 L30 22 M34 28 L24 30 M28 36 L20 38 M42 24 L40 32 M36 32 L34 40" stroke="#123a2e" stroke-width="1.4" opacity=".6"/>`,
    ),
  );
}
