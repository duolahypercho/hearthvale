/**
 * Customisable chibi farmer as ONE skinned mesh (1 draw call + 1 shadow draw per farmer).
 *
 * - `buildFarmerMesh(look, bones)` merges every body part (the same shapes as entities/player.ts,
 *   recoloured by a FarmerLook, plus hair styles and hats) into a single vertex-coloured
 *   SkinnedMesh whose "bones" are plain Groups laid out exactly like the Player rig. The same mesh
 *   can therefore be bound to the local Player's own rig groups (custom look for the local farmer,
 *   every animation / tool pose keeps working) or to a RemoteFarmer's rig.
 * - `RemoteFarmer`: a co-op farmhand driven by network state — interpolated position, the Player's
 *   walk / run / idle animation, the real tool actions (FarmerActions: same keyframes as the local
 *   farmer), a fishing pose, 3D emote bubbles, a contact shadow blob.
 */
import * as THREE from 'three';
import type { Facing } from '../core/events';
import type { Player, PlayerRig, ActionPose } from './player';
import { FarmerActions, type ActionKind } from './farmer-actions';
import { MeshBuilder, roundedBox, mat, lumpySphere, sphericalNormals } from '../world/geom';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyWorldFx } from '../render/worldfx';
import { patchMaterial } from '../render/patch';
import { buildTool, CAN_SPOUT } from '../world/props/tools';
import { registerWarm } from '../render/warmkit';
import { Rng } from '../core/rng';
import { DEFAULT_LOOK, extra, type FarmerLook } from './remote-look';
import { EmoteBubble, type EmoteId } from './remote-emotes';

const HEAD_R = 0.32;
const BODY_SCALE = 1.22;

/** The rig groups a farmer mesh is skinned to (names mirror entities/player.ts). */
export interface FarmerBones {
  body: THREE.Object3D;
  hips: THREE.Object3D;
  torso: THREE.Object3D;
  head: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  hat: THREE.Object3D;
  eyeL: THREE.Object3D;
  eyeR: THREE.Object3D;
}

const BONE_ORDER: (keyof FarmerBones)[] = ['body', 'hips', 'torso', 'head', 'armL', 'armR', 'legL', 'legR', 'hat', 'eyeL', 'eyeR'];

/** Rest layout of the rig (identical to Player.buildRig). */
type RestRig = { [K in keyof FarmerBones]: THREE.Group } & { root: THREE.Group; tool: THREE.Group };

function restRig(): RestRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const hips = new THREE.Group();
  const torso = new THREE.Group();
  const head = new THREE.Group();
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  const hat = new THREE.Group();
  const eyeL = new THREE.Group();
  const eyeR = new THREE.Group();
  const tool = new THREE.Group();
  root.add(body);
  body.add(hips);
  body.scale.setScalar(BODY_SCALE);
  hips.position.y = 0.5;
  legL.position.set(-0.12, 0, 0);
  legR.position.set(0.12, 0, 0);
  hips.add(legL, legR, torso);
  armL.position.set(-0.25, 0.33, 0);
  armR.position.set(0.25, 0.33, 0);
  torso.add(armL, armR);
  head.position.y = 0.46;
  head.scale.setScalar(1.15);
  torso.add(head);
  eyeL.position.set(-0.12, HEAD_R * 0.9, HEAD_R * 0.9);
  eyeR.position.set(0.12, HEAD_R * 0.9, HEAD_R * 0.9);
  eyeL.rotation.x = eyeR.rotation.x = -0.12;
  hat.position.set(0, HEAD_R * 1.55, -0.09);
  hat.rotation.x = -0.52;
  head.add(eyeL, eyeR, hat);
  tool.position.set(0, -0.3, 0.02);
  tool.rotation.x = Math.PI / 2;
  tool.visible = false;
  armR.add(tool);
  return { root, body, hips, torso, head, armL, armR, legL, legR, hat, eyeL, eyeR, tool };
}

let sharedMat: THREE.MeshStandardMaterial | null = null;
/** One material for every farmer (vertex colours carry the look). */
export function farmerMaterial(): THREE.MeshStandardMaterial {
  if (!sharedMat) {
    sharedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 });
    sharedMat.name = 'farmer-skinned';
    applyWorldFx(sharedMat, { snow: false, clouds: true, wet: true });
    // Face fill: surfaces turned toward the camera get a share of the ambient term again (a soft
    // "camera light"), so a face under a hat brim or in its own head shadow never reads as a dark
    // hole from the high 3/4 camera; scales with the ambient, so night stays night. Plus a faint rim.
    patchMaterial(sharedMat, 'farmer-face-fill', (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `{
          float hvNdv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
          outgoingLight += reflectedLight.indirectDiffuse * (0.55 * hvNdv * hvNdv) + reflectedLight.indirectDiffuse * 0.35 * pow(1.0 - hvNdv, 3.0);
        }
        #include <opaque_fragment>`,
      );
    });
  }
  return sharedMat;
}

const C = (c: number, mul = 1): THREE.Color => new THREE.Color(c).multiplyScalar(mul);

/** Build per-bone part geometry (bone-local space) for a look. */
function partsFor(look: FarmerLook): Record<keyof FarmerBones, MeshBuilder> {
  const rng = new Rng('player');
  const M = farmerMaterial();
  const mk = (): MeshBuilder => new MeshBuilder();
  const parts = Object.fromEntries(BONE_ORDER.map((k) => [k, mk()])) as Record<keyof FarmerBones, MeshBuilder>;
  const add = (bone: keyof FarmerBones, geo: THREE.BufferGeometry, m: THREE.Matrix4 | undefined, color: THREE.ColorRepresentation): void => {
    parts[bone].add(M, geo, m, { tint: color });
  };
  const skin = look.skin;
  const hair = look.hair;
  const shirt = look.shirt;
  const denim = look.overalls;
  const denimLight = C(denim).lerp(new THREE.Color(0xffffff), 0.28).getHex();
  const denimDark = C(denim, 0.8).getHex();
  const dark = 0x1d1612;
  const white = 0xffffff;
  const blush = C(skin).lerp(new THREE.Color(0xf07a70), 0.55).getHex();
  const boot = 0x6a4128;

  const cut = extra(look, 'outfit');
  const acc = extra(look, 'accessory');
  // Leg wear by cut: denim legs (overalls), tights under a pinafore, trousers under a vest / apron.
  const legCol = cut === 'overalls' ? denim : cut === 'pinafore' ? C(shirt).lerp(new THREE.Color(0xf4ece0), 0.5).getHex() : cut === 'vest' ? C(denim, 0.62).getHex() : 0x6a5442;

  // Legs
  for (const [bone, sx] of [['legL', -1], ['legR', 1]] as const) {
    add(bone, new THREE.CapsuleGeometry(0.095, 0.22, 4, 10), mat(0, -0.19, 0), legCol);
    if (sx > 0 && cut === 'overalls') add(bone, roundedBox(0.09, 0.08, 0.02, 0.015), mat(0, -0.2, 0.09, 0.1, 0, 0.1), denimLight);
    add(bone, new THREE.CylinderGeometry(0.1, 0.1, 0.05, 12), mat(0, -0.34, 0), cut === 'pinafore' ? C(look.scarf, 0.9) : C(shirt, 0.88));
    add(bone, roundedBox(0.19, 0.14, 0.27, 0.06), mat(0, -0.43, 0.035), boot);
    add(bone, roundedBox(0.2, 0.04, 0.29, 0.02), mat(0, -0.49, 0.04), 0x3a2618);
  }

  // Torso: shirt + the outfit cut + neckerchief (or a knitted scarf)
  add('torso', new THREE.CapsuleGeometry(0.2, 0.16, 6, 14), mat(0, 0.19, 0, 0, 0, 0, 1.05, 1, 0.9), shirt);
  if (cut === 'overalls' || cut === 'pinafore') {
    if (cut === 'overalls') add('torso', new THREE.CylinderGeometry(0.215, 0.2, 0.2, 14), mat(0, 0.02, 0, 0, 0, 0, 1.05, 1, 0.92), denim);
    else {
      // A-line pinafore skirt flaring over the hips, a contrast hem band.
      add('torso', new THREE.CylinderGeometry(0.21, 0.33, 0.34, 16), mat(0, -0.06, 0, 0, 0, 0, 1.05, 1, 0.95), denim);
      add('torso', new THREE.CylinderGeometry(0.335, 0.34, 0.04, 16), mat(0, -0.22, 0, 0, 0, 0, 1.05, 1, 0.95), denimLight);
    }
    add('torso', roundedBox(0.26, 0.2, 0.08, 0.03), mat(0, 0.2, 0.16), denim);
    for (const sx of [-1, 1]) {
      add('torso', roundedBox(0.05, 0.26, 0.05, 0.02), mat(sx * 0.1, 0.33, 0.1, 0.35, 0, 0), denim);
      add('torso', new THREE.SphereGeometry(0.022, 8, 6), mat(sx * 0.1, 0.28, 0.2), 0xd8bc6a);
    }
    add('torso', roundedBox(0.1, 0.07, 0.03, 0.01), mat(0, 0.16, 0.205), denimDark);
    if (cut === 'overalls') {
      for (let i = 0; i < 5; i++) add('torso', roundedBox(0.016, 0.006, 0.006, 0.002), mat(-0.04 + i * 0.02, 0.2, 0.222), 0xf2d890);
      for (const sx2 of [-1, 1]) for (let i = 0; i < 3; i++) add('torso', roundedBox(0.006, 0.016, 0.006, 0.002), mat(sx2 * 0.052, 0.13 + i * 0.022, 0.222), 0xf2d890);
      add('torso', roundedBox(0.08, 0.07, 0.02, 0.012), mat(-0.12, 0.02, 0.19, 0, 0.4, 0.2), C(denim).lerp(new THREE.Color(0xd89a4a), 0.7));
    } else {
      // A heart patch pocket.
      add('torso', new THREE.SphereGeometry(0.035, 8, 6), mat(-0.13, -0.02, 0.27, 0, 0, 0, 1, 0.9, 0.35), look.scarf);
    }
  } else if (cut === 'vest') {
    // Open waistcoat over the shirt: two front panels, a back, a belt with a brass buckle.
    add('torso', new THREE.CylinderGeometry(0.212, 0.205, 0.2, 14), mat(0, 0.02, 0, 0, 0, 0, 1.05, 1, 0.92), C(denim, 0.62));
    add('torso', roundedBox(0.4, 0.05, 0.36, 0.02), mat(0, 0.1, 0, 0, 0, 0, 1.05, 1, 1), 0x4a3020);
    add('torso', roundedBox(0.07, 0.05, 0.02, 0.01), mat(0, 0.1, 0.19), 0xe0b850);
    for (const sx of [-1, 1]) {
      add('torso', roundedBox(0.13, 0.27, 0.05, 0.03), mat(sx * 0.1, 0.24, 0.165, 0.18, -sx * 0.2, 0), denim);
      add('torso', new THREE.SphereGeometry(0.016, 6, 4), mat(sx * 0.055, 0.2 - 0.05 * (sx + 1), 0.205), 0xf2d890);
    }
    add('torso', roundedBox(0.4, 0.3, 0.06, 0.03), mat(0, 0.24, -0.15, -0.15, 0, 0), denim);
  } else {
    // Long work apron over shirt + trousers: bib, skirt to the knees, neck strap, big pocket.
    add('torso', new THREE.CylinderGeometry(0.212, 0.205, 0.2, 14), mat(0, 0.02, 0, 0, 0, 0, 1.05, 1, 0.92), 0x6a5442);
    // Bib laid against the chest (r4: a 27 cm flat board tilted forward floated off the round torso).
    add('torso', roundedBox(0.22, 0.23, 0.05, 0.022), mat(0, 0.2, 0.152, -0.06, 0, 0), denim);
    add('torso', roundedBox(0.36, 0.36, 0.04, 0.03), mat(0, -0.1, 0.205, -0.08, 0, 0), denim);
    add('torso', roundedBox(0.2, 0.1, 0.02, 0.015), mat(0, -0.06, 0.232, -0.08, 0, 0), C(denim).lerp(new THREE.Color(0xffffff), 0.25));
    add('torso', new THREE.TorusGeometry(0.1, 0.014, 5, 14, Math.PI), mat(0, 0.31, 0.11, -0.5, 0, 0), denim);
    add('torso', new THREE.TorusGeometry(0.215, 0.012, 5, 18), mat(0, 0.08, 0, Math.PI / 2, 0, 0, 1.05, 1, 0.95), C(denim, 0.8));
  }
  if (acc === 'scarf') {
    // A chunky knitted scarf in the accent colour, one tail down the front.
    add('torso', new THREE.TorusGeometry(0.15, 0.06, 8, 18), mat(0, 0.39, 0.0, Math.PI / 2 - 0.2, 0, 0), look.scarf);
    add('torso', roundedBox(0.1, 0.24, 0.06, 0.03), mat(0.08, 0.24, 0.2, 0.15, 0, 0.08), C(look.scarf, 0.9));
    for (let i = 0; i < 3; i++) add('torso', roundedBox(0.105, 0.012, 0.065, 0.004), mat(0.08, 0.17 + i * 0.06, 0.2, 0.15, 0, 0.08), C(look.scarf, 0.75));
  } else {
    add('torso', new THREE.TorusGeometry(0.13, 0.035, 8, 18), mat(0, 0.38, 0.0, Math.PI / 2 - 0.25, 0, 0), look.scarf);
    add('torso', new THREE.ConeGeometry(0.07, 0.12, 4), mat(0, 0.3, 0.14, 0.2, Math.PI / 4, Math.PI), look.scarf);
  }

  // Arms
  for (const bone of ['armL', 'armR'] as const) {
    add(bone, new THREE.CapsuleGeometry(0.075, 0.08, 4, 10), mat(0, -0.06, 0), shirt);
    add(bone, new THREE.CapsuleGeometry(0.058, 0.12, 4, 10), mat(0, -0.2, 0), skin);
    add(bone, new THREE.SphereGeometry(0.07, 14, 10), mat(0, -0.3, 0.01), C(skin).lerp(new THREE.Color(0xffffff), 0.2));
  }

  // Head
  const r = HEAD_R;
  add('head', new THREE.SphereGeometry(r, 28, 20), mat(0, r * 0.92, 0, 0, 0, 0, 1.04, 0.96, 1), skin);
  for (const sx of [-1, 1]) add('head', new THREE.SphereGeometry(0.07, 10, 8), mat(sx * r * 0.98, r * 0.88, 0, 0, 0, 0, 0.6, 1, 1), skin);
  add('head', new THREE.SphereGeometry(0.03, 10, 8), mat(0, r * 0.8, r * 0.99), C(skin).lerp(new THREE.Color(0xffffff), 0.35));
  hairFor(look, (g, m, k = 1) => add('head', g, m, k === 1 ? hair : C(hair, k)), rng);
  const browCol = C(hair, 0.85);
  const brows = extra(look, 'brows');
  for (const sx of [-1, 1]) {
    if (brows === 'soft') add('head', new THREE.CapsuleGeometry(0.013, 0.055, 3, 6), mat(sx * 0.12, r * 1.14, r * 0.94, 0, 0, Math.PI / 2 + sx * 0.18), browCol);
    else if (brows === 'bold') add('head', new THREE.CapsuleGeometry(0.021, 0.07, 3, 6), mat(sx * 0.12, r * 1.15, r * 0.94, 0, 0, Math.PI / 2 - sx * 0.12), C(hair, 0.62));
    else add('head', new THREE.TorusGeometry(0.05, 0.012, 4, 10, Math.PI * 0.75), mat(sx * 0.12, r * 1.09, r * 0.945, 0, 0, Math.PI * 0.125), browCol);
    add('head', new THREE.CircleGeometry(0.05, 14), mat(sx * 0.19, r * 0.76, r * 0.875, 0, sx * 0.55, 0), blush);
  }
  const mouth = extra(look, 'mouth');
  if (mouth === 'smile') add('head', new THREE.TorusGeometry(0.045, 0.011, 6, 14, Math.PI), mat(0, r * 0.6, r * 0.955, 0, 0, Math.PI), dark);
  else if (mouth === 'grin') {
    // An open, laughing D: dark mouth, a strip of teeth, a pink tongue.
    add('head', new THREE.CircleGeometry(0.05, 14, Math.PI, Math.PI), mat(0, r * 0.64, r * 0.968, -0.25, 0, 0), 0x5a1f1a);
    add('head', new THREE.CircleGeometry(0.03, 10, Math.PI * 1.2, Math.PI * 0.6), mat(0, r * 0.6, r * 0.972, -0.25, 0, 0), 0xe0707a);
    add('head', roundedBox(0.08, 0.012, 0.004, 0.002), mat(0, r * 0.628, r * 0.974, -0.25, 0, 0), white);
  } else if (mouth === 'cat') {
    for (const sx of [-1, 1]) add('head', new THREE.TorusGeometry(0.024, 0.009, 5, 10, Math.PI), mat(sx * 0.024, r * 0.62, r * 0.958, 0, 0, Math.PI), dark);
  } else add('head', new THREE.TorusGeometry(0.022, 0.01, 6, 14), mat(0, r * 0.6, r * 0.958, -0.25, 0, 0, 1, 1.25, 1), dark);
  if (acc === 'glasses') {
    // Round wire specs: rims in front of each eye, a bridge, arms back to the ears.
    for (const sx of [-1, 1]) {
      add('head', new THREE.TorusGeometry(0.07, 0.011, 5, 18), mat(sx * 0.12, r * 0.9, r * 1.03, -0.12, sx * 0.18, 0), 0x6a4a2a);
      add('head', roundedBox(0.012, 0.012, 0.22, 0.004), mat(sx * 0.2, r * 0.95, r * 0.66, 0, sx * 0.1, 0), 0x6a4a2a);
    }
    add('head', new THREE.TorusGeometry(0.03, 0.009, 4, 8, Math.PI), mat(0, r * 0.92, r * 1.06, 0, 0, 0), 0x6a4a2a);
  } else if (acc === 'flower') {
    // A daisy tucked behind the left ear.
    const fx = -r * 0.98;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add('head', new THREE.SphereGeometry(0.035, 7, 5), mat(fx - 0.02, r * 1.05 + Math.sin(a) * 0.045, 0.06 + Math.cos(a) * 0.045, 0, -1.2, 0, 1, 1, 0.4), 0xfdf6ee);
    }
    add('head', new THREE.SphereGeometry(0.026, 8, 6), mat(fx - 0.035, r * 1.05, 0.06), 0xf2c94c);
  }

  // Eyes
  const eyes = extra(look, 'eyes');
  for (const bone of ['eyeL', 'eyeR'] as const) {
    const side = bone === 'eyeL' ? -1 : 1;
    if (eyes === 'joyful') {
      // ^ ^ closed happy arcs.
      add(bone, new THREE.TorusGeometry(0.036, 0.012, 5, 12, Math.PI), mat(0, -0.01, 0.03), dark);
    } else if (eyes === 'sleepy') {
      // Half-lidded: a flattened eye under a skin-tone lid with a lash line.
      add(bone, new THREE.CapsuleGeometry(0.04, 0.02, 4, 12), mat(0, -0.012, 0, 0, 0, 0, 1, 0.8, 1), dark);
      add(bone, new THREE.SphereGeometry(0.014, 6, 4), mat(0.012, -0.004, 0.038), white);
      add(bone, new THREE.CapsuleGeometry(0.047, 0.03, 4, 12), mat(0, 0.028, 0.004, 0, 0, Math.PI / 2, 0.62, 1.05, 1), skin);
      add(bone, new THREE.CapsuleGeometry(0.008, 0.08, 3, 6), mat(0, 0.008, 0.042, 0, 0, Math.PI / 2), dark);
    } else if (eyes === 'bright') {
      // Big sparkly eyes with a lash flick at the outer corner.
      add(bone, new THREE.CapsuleGeometry(0.05, 0.058, 4, 12), undefined, dark);
      add(bone, new THREE.SphereGeometry(0.022, 8, 6), mat(0.016, 0.032, 0.042), white);
      add(bone, new THREE.SphereGeometry(0.011, 6, 4), mat(-0.016, -0.026, 0.045), white);
      add(bone, new THREE.CapsuleGeometry(0.009, 0.035, 3, 6), mat(side * 0.05, 0.05, 0.02, 0, 0, side * -0.9), dark);
    } else {
      add(bone, new THREE.CapsuleGeometry(0.043, 0.05, 4, 12), undefined, dark);
      add(bone, new THREE.SphereGeometry(0.018, 8, 6), mat(0.016, 0.028, 0.036), white);
      add(bone, new THREE.SphereGeometry(0.008, 6, 4), mat(-0.014, -0.022, 0.038), white);
    }
  }

  // Hat (authored in head space, converted into the tilted hat bone's space).
  hatFor(look, (g, m, c) => add('hat', g, m, c));
  return parts;
}

/** Head-space matrix → hat-bone space (the hat bone sits pushed back and tilted, like the straw hat). */
const HAT_REST = mat(0, HEAD_R * 1.55, -0.09, -0.52, 0, 0);
const HAT_REST_INV = HAT_REST.clone().invert();
const inHat = (m: THREE.Matrix4): THREE.Matrix4 => HAT_REST_INV.clone().multiply(m);

function hairFor(look: FarmerLook, add: (g: THREE.BufferGeometry, m: THREE.Matrix4, k?: number) => void, rng: Rng): void {
  const r = HEAD_R;
  const style = look.hairStyle;
  const capScale = style === 'buzz' ? 1.03 : 1.07;
  const cap = new THREE.SphereGeometry(r * capScale, 28, 16, 0, Math.PI * 2, 0, Math.PI * (style === 'buzz' ? 0.5 : 0.55));
  // The scalp layer sits a value step darker than the locks (roots): pale hair reads as hair with
  // depth, not as a fuzzy white blob, and the locks pop off it.
  add(cap, mat(0, r * 0.98, -0.02, -0.25, 0, 0), style === 'buzz' ? 1 : 0.68);
  const lock = (radius: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number): void => {
    const g = lumpySphere(radius, 2, 0.08, rng, 1.2);
    g.scale(sx, sy, sz);
    sphericalNormals(g, new THREE.Vector3(), 0.35);
    add(g, mat(x, y, z, rx, ry, rz));
  };
  const fringe = (scale: number): void => {
    const locks: [number, number, number, number][] = [
      [-0.55, 0.16, 1.25, -0.5],
      [-0.1, 0.14, 1.12, -0.25],
      [0.4, 0.12, 1.02, 0.1],
    ];
    for (const [a, rad, len, roll] of locks) lock(rad * scale, Math.sin(a) * r * 0.72, r * 1.34, Math.cos(a) * r * 0.72, 0.55, a, roll, len, 0.55, 0.62);
  };
  const sides = (len: number, z = r * 0.28): void => {
    for (const sx of [-1, 1]) {
      const side = lumpySphere(0.1, 1, 0.12, rng);
      side.scale(0.55, 1.1 * len, 0.8);
      add(side, mat(sx * r * 0.94, r * (0.95 - (len - 1) * 0.35), z, 0, 0, sx * 0.15));
    }
  };
  const backTufts = (): void => {
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * 0.55 + (i / 5) * Math.PI * 0.9;
      const tuft = lumpySphere(0.13, 1, 0.2, rng);
      add(tuft, mat(Math.sin(a) * r * 0.85, r * 0.72 + rng.next() * 0.08, Math.cos(a) * r * 0.82));
    }
  };
  switch (style) {
    case 'tousled':
      fringe(1);
      sides(1);
      backTufts();
      break;
    case 'bob': {
      fringe(0.95);
      // A rounded helmet of hair that falls to the jaw, open over the face.
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * 0.42 + (i / 8) * Math.PI * 1.16;
        const blob = lumpySphere(0.15, 1, 0.12, rng);
        blob.scale(0.9, 1.35, 0.9);
        add(blob, mat(Math.sin(a) * r * 0.9, r * 0.62, Math.cos(a) * r * 0.86));
      }
      break;
    }
    case 'bun': {
      fringe(0.8);
      sides(0.9);
      const bun = lumpySphere(0.14, 2, 0.08, rng, 1.5);
      add(bun, mat(0, r * 1.78, -r * 0.62));
      add(new THREE.TorusGeometry(0.1, 0.025, 6, 16), mat(0, r * 1.62, -r * 0.55, -0.9, 0, 0));
      break;
    }
    case 'spiky': {
      fringe(0.85);
      // Swept-back spikes (an anime cowlick crest), tips lighter than roots; none over the brow.
      // Under a hat only short spikes flare out below the brim (a crest would poke through it).
      if (look.hat !== 'none' && look.hat !== 'flower') {
        for (let i = 0; i < 6; i++) {
          const a = Math.PI * 0.4 + (i / 5) * Math.PI * 1.2;
          const cone = new THREE.ConeGeometry(0.07, 0.2, 6);
          add(cone, mat(Math.sin(a) * r * 0.86, r * 1.12, Math.cos(a) * r * 0.84 - 0.03, Math.cos(a) * 1.25, 0, -Math.sin(a) * 1.25), i % 2 ? 1 : 0.86);
        }
        backTufts();
        break;
      }
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * 0.35 + (i / 6) * Math.PI * 1.3;
        const tilt = 0.7 + (i % 2) * 0.18;
        const cone = new THREE.ConeGeometry(0.085, 0.3, 6);
        add(cone, mat(Math.sin(a) * r * 0.6, r * 1.58, Math.cos(a) * r * 0.6 - 0.06, Math.cos(a) * tilt, 0, -Math.sin(a) * tilt), i % 2 ? 1 : 0.86);
      }
      add(new THREE.ConeGeometry(0.09, 0.32, 6), mat(0, r * 1.9, -0.1, -0.5, 0, 0), 1.08);
      backTufts();
      break;
    }
    case 'long': {
      fringe(1);
      // Long locks fall behind the ears (tucked back): from the high camera they framed the cheeks
      // like a hood and hid half the face.
      sides(1.9, r * 0.02);
      // A curtain down the back to the shoulder blades.
      const back = new THREE.CapsuleGeometry(0.2, 0.34, 6, 14);
      add(back, mat(0, r * 0.35, -r * 0.62, 0.12, 0, 0, 1.45, 1, 0.62));
      backTufts();
      break;
    }
    case 'buzz':
      for (const sx of [-1, 1]) add(roundedBox(0.04, 0.09, 0.05, 0.015), mat(sx * r * 0.93, r * 0.78, r * 0.3));
      break;
  }
}

function hatFor(look: FarmerLook, add: (g: THREE.BufferGeometry, m: THREE.Matrix4, color: number | THREE.Color) => void): void {
  const r = HEAD_R;
  const hc = look.hatColor;
  switch (look.hat) {
    case 'straw': {
      // Authored directly in hat space (identical to the original straw hat).
      add(new THREE.CylinderGeometry(0.37, 0.39, 0.035, 32), mat(0, 0, 0), hc);
      add(new THREE.TorusGeometry(0.37, 0.025, 6, 32), mat(0, 0, 0, Math.PI / 2, 0, 0), hc);
      add(new THREE.CylinderGeometry(0.24, 0.3, 0.2, 24), mat(0, 0.11, 0), hc);
      add(new THREE.SphereGeometry(0.24, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0, 0.2, 0, 0, 0, 0, 1, 0.35, 1), hc);
      add(new THREE.CylinderGeometry(0.305, 0.305, 0.065, 24, 1, true), mat(0, 0.05, 0), hc === DEFAULT_LOOK.hatColor ? 0x3d6f8f : C(hc, 0.55));
      break;
    }
    case 'cap': {
      const dome = new THREE.SphereGeometry(r * 1.1, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
      // Worn pushed up and back with the bill tipped up: from the high 3/4 camera the brim used to
      // sit over the eyes (a faceless cap); now the brow, eyes and a fringe read under it.
      add(dome, inHat(mat(0, r * 1.1, -0.07, -0.34, 0, 0, 1, 0.8, 1)), hc);
      add(roundedBox(0.34, 0.03, 0.2, 0.012), inHat(mat(0, r * 1.42, r * 0.86, -0.22, 0, 0)), C(hc, 0.8));
      add(new THREE.SphereGeometry(0.03, 8, 6), inHat(mat(0, r * 1.92, -0.2)), C(hc, 0.75));
      add(new THREE.CylinderGeometry(r * 1.1, r * 1.1, 0.04, 24, 1, true), inHat(mat(0, r * 1.12, -0.07, -0.34, 0, 0)), C(hc, 0.7));
      break;
    }
    case 'beanie': {
      // A knitted cap worn high and pushed well back (a woodworker's beanie): from the high 3/4
      // camera the brow and eyes stay clear instead of reading as a mushroom cap over the face.
      // Folded, ribbed cuff + a slouched crown + a pom-pom over the back of the head.
      const tip = -0.5;
      const cy = r * 1.3;
      const cz = -0.09;
      const dome = new THREE.SphereGeometry(r * 1.0, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
      add(dome, inHat(mat(0, cy, cz, tip, 0, 0, 1, 1.12, 1)), hc);
      add(new THREE.CylinderGeometry(r * 1.04, r * 1.07, 0.12, 28), inHat(mat(0, cy + 0.02, cz, tip, 0, 0)), C(hc, 0.86));
      const ribs = 18;
      const ribM = new THREE.Matrix4();
      const tilt = new THREE.Matrix4().makeRotationX(tip);
      for (let i = 0; i < ribs; i++) {
        const a = (i / ribs) * Math.PI * 2;
        ribM.makeRotationY(a).setPosition(Math.sin(a) * r * 1.065, 0, Math.cos(a) * r * 1.065);
        const m = new THREE.Matrix4().makeTranslation(0, cy + 0.02, cz).multiply(tilt).multiply(ribM);
        add(roundedBox(0.03, 0.115, 0.016, 0.006), inHat(m), C(hc, 0.78));
      }
      add(lumpySphere(0.085, 1, 0.24, new Rng('pom')), inHat(mat(0, cy + r * 0.95, cz - r * 0.62)), C(hc).lerp(new THREE.Color(0xffffff), 0.5));
      break;
    }
    case 'flower': {
      const cx = r * 0.66;
      const cy = r * 1.42;
      const cz = r * 0.45;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const petal = new THREE.SphereGeometry(0.05, 10, 8);
        add(petal, inHat(mat(cx + Math.cos(a) * 0.055, cy + Math.sin(a) * 0.055, cz, 0, 0.5, 0, 1, 1, 0.45)), hc);
      }
      add(new THREE.SphereGeometry(0.032, 10, 8), inHat(mat(cx, cy, cz + 0.012)), 0xf2c94c);
      add(new THREE.SphereGeometry(0.04, 8, 6), inHat(mat(cx - 0.05, cy - 0.08, cz - 0.02, 0, 0, 0, 1.3, 0.5, 0.7)), 0x6aa84f);
      break;
    }
    case 'none':
      break;
  }
}

/**
 * Build the skinned farmer mesh for `look`, bound to `bones` (whose parent chain must match the
 * rest rig: body under the mesh's parent, etc.). The mesh must be added to the same parent as
 * `bones.body` with an identity transform.
 */
export function buildFarmerMesh(look: FarmerLook, bones: FarmerBones): THREE.SkinnedMesh {
  const rest = restRig();
  rest.root.updateMatrixWorld(true);
  const parts = partsFor(look);
  const M = farmerMaterial();
  const geos: THREE.BufferGeometry[] = [];
  const inverses: THREE.Matrix4[] = [];
  BONE_ORDER.forEach((name, bi) => {
    const restBone = rest[name];
    inverses.push(restBone.matrixWorld.clone().invert());
    const g = parts[name].geometries().get(M);
    if (!g) return;
    g.applyMatrix4(restBone.matrixWorld);
    const n = g.attributes.position!.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = bi;
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geos.push(g);
  });
  const merged = mergeGeometries(geos)!;
  for (const g of geos) g.dispose();
  merged.computeBoundingBox();
  merged.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 1.6);
  const mesh = new THREE.SkinnedMesh(merged, M);
  mesh.name = 'farmer-skinned';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const skeleton = new THREE.Skeleton(BONE_ORDER.map((k) => bones[k]) as unknown as THREE.Bone[], inverses);
  mesh.bind(skeleton, new THREE.Matrix4());
  // Skinned bounds never need recomputing: a fixed sphere around the farmer.
  mesh.computeBoundingSphere = function () {
    this.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 1.6);
  };
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 1.6);
  return mesh;
}

// ─────────────────────────────────────────────────────────────── local player look

/**
 * Re-skin the LOCAL player with a look: hides the Player's own part meshes and binds a skinned
 * mesh to its rig groups (animations, tool poses and the held tool are untouched). Returns an undo.
 */
export function applyLookToPlayer(player: Player, look: FarmerLook): () => void {
  const rig = player.rig;
  const root = player.root;
  const eyes = rig.head.children.filter((c) => c !== rig.hat && c.children.some((k) => k.name === 'eye'));
  const bones: FarmerBones = {
    body: rig.body,
    hips: rig.hips,
    torso: rig.torso,
    head: rig.head,
    armL: rig.armL,
    armR: rig.armR,
    legL: rig.legL,
    legR: rig.legR,
    hat: rig.hat ?? new THREE.Group(),
    eyeL: eyes[0] ?? new THREE.Group(),
    eyeR: eyes[1] ?? new THREE.Group(),
  };
  const hidden: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && /^(leg|torso|arm|head|eye|hat):player$/.test(o.name) && o.visible) hidden.push(o);
  });
  for (const o of hidden) o.visible = false;
  const mesh = buildFarmerMesh(look, bones);
  root.add(mesh);
  return () => {
    mesh.removeFromParent();
    mesh.geometry.dispose();
    for (const o of hidden) o.visible = true;
  };
}

// ─────────────────────────────────────────────────────────────── remote farmer

export type RemoteAnim = 'idle' | 'walk' | 'run' | 'fish' | 'hidden';

const TOOL_TIER_DEFAULT = 0;

export class RemoteFarmer {
  readonly root = new THREE.Group();
  readonly position = new THREE.Vector3();
  /** Structural stand-ins for the Player API FarmerActions drives. */
  busy = false;
  actionPose: ((rig: PlayerRig, dt: number) => ActionPose | null) | null = null;
  facing: Facing = 'down';
  anim: RemoteAnim = 'idle';
  /** Ground speed (m/s) from the interpolation, drives the walk cycle. */
  speed = 0;
  yaw = 0;
  targetYaw = 0;
  look: FarmerLook;

  private rigParts: ReturnType<typeof restRig>;
  private mesh: THREE.SkinnedMesh;
  private actions: FarmerActions;
  private blob: THREE.Mesh;
  private phase = 0;
  private stateTime = 0;
  private blink = 0;
  private nextBlink = 2 + Math.random() * 2;
  private lookYaw = 0;
  private lookTarget = 0;
  private lookT = 3;
  /** World yaw the idle head looks toward (null = the random look-around). */
  gaze: number | null = null;
  private rod: THREE.Object3D | null = null;
  readonly bubble: EmoteBubble;
  /** World yaw of a farmer that faces the camera (players.ts sets it from the camera rig per frame). */
  static camFace = 0;
  /** A prop carried in front of the chest with both arms (hauling a basket). */
  private carried: THREE.Object3D | null = null;
  private waveT = 0;

  constructor(look: FarmerLook = DEFAULT_LOOK) {
    this.look = look;
    this.root.name = 'remote-farmer';
    this.root.userData.noAO = true;
    this.root.userData.perfTag = 'farmers';
    this.rigParts = restRig();
    this.root.add(this.rigParts.body);
    this.mesh = buildFarmerMesh(look, this.rigParts);
    this.root.add(this.mesh);
    const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
    this.blob = new THREE.Mesh(BLOB_GEO, blobMat);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.03;
    this.blob.renderOrder = 1;
    this.root.add(this.blob);
    this.actions = new FarmerActions(this as unknown as Player);
    this.bubble = new EmoteBubble(this.root);
  }

  get rig(): PlayerRig {
    const p = this.rigParts;
    return { body: p.body, hips: p.hips, torso: p.torso, head: p.head, armL: p.armL, armR: p.armR, legL: p.legL, legR: p.legR, tool: p.tool, hat: p.hat };
  }

  setLook(look: FarmerLook): void {
    this.look = look;
    const old = this.mesh;
    this.mesh = buildFarmerMesh(look, this.rigParts);
    this.root.add(this.mesh);
    old.removeFromParent();
    old.geometry.dispose();
  }

  /** Play a tool action (same keyframes as the local farmer). `side` = which shoulder winds up. */
  act(kind: ActionKind, toolId: string | null, tier = TOOL_TIER_DEFAULT, side = 1): void {
    this.actions.side = side;
    this.actions.start(kind, { tool: toolId ? buildTool(toolId, tier) : null });
    if (kind === 'pour') this.pourT = 0;
  }

  // ── watering stream: another farmer's pour shows its arc of water (the farming FX only draws the
  // local farmer's stream). One instanced draw per farmer, only while pouring. ──
  private pourT = -1;
  private drops: { p: THREE.Vector3; v: THREE.Vector3; t: number }[] = [];
  private dropMesh: THREE.InstancedMesh | null = null;
  private spawnAcc = 0;

  private updateStream(dt: number): void {
    const live = this.pourT >= 0;
    if (!live && !this.drops.length) return;
    if (!this.dropMesh) {
      this.dropMesh = new THREE.InstancedMesh(DROP_GEO, DROP_MAT, 56);
      this.dropMesh.frustumCulled = false;
      this.dropMesh.name = 'pour-stream';
      this.dropMesh.userData.noAO = true;
    }
    const mesh = this.dropMesh;
    const parent = this.root.parent;
    if (parent && mesh.parent !== parent) parent.add(mesh);
    if (live) {
      this.pourT += dt;
      // The rose tips at ~0.3 s and pours until ~0.8 s of the pour keys.
      if (this.pourT > 0.28 && this.pourT < 0.82 && this.root.visible) {
        this.spawnAcc += dt * 90;
        const tool = this.rigParts.tool;
        tool.updateWorldMatrix(true, false);
        const fwd = _fw.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        while (this.spawnAcc >= 1 && this.drops.length < 56) {
          this.spawnAcc -= 1;
          const p = CAN_SPOUT.clone().applyMatrix4(tool.matrixWorld);
          const v = fwd.clone().multiplyScalar(1.1 + Math.random() * 0.35);
          v.x += (Math.random() - 0.5) * 0.12;
          v.z += (Math.random() - 0.5) * 0.12;
          v.y = 0.25 + Math.random() * 0.3;
          this.drops.push({ p, v, t: 0 });
        }
      }
      if (this.pourT > 1) this.pourT = -1;
    }
    const ground = this.position.y + 0.04;
    let n = 0;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      d.t += dt;
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.p.y < ground || d.t > 0.9) {
        this.drops.splice(i, 1);
        continue;
      }
    }
    for (const d of this.drops) {
      // Each drop is stretched along its own velocity so neighbouring drops overlap into one
      // continuous rope of water (r4: round beads read as a dotted line), thinning as it falls.
      const sc = 1 - d.t * 0.45;
      const sp = d.v.length();
      _dq.setFromUnitVectors(_up, _dv.copy(d.v).divideScalar(Math.max(1e-3, sp)));
      // (Capped stretch: a long stretch on fast falling drops read as one tall glass rod.)
      _ds.set(sc * 0.9, sc * (1.3 + Math.min(1.3, sp * 0.3)), sc * 0.9);
      _dm.compose(d.p, _dq, _ds);
      mesh.setMatrixAt(n++, _dm);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = n > 0 && !!parent;
  }

  get acting(): boolean {
    return this.actions.active;
  }

  emote(id: EmoteId, dur?: number): void {
    this.bubble.show(id, dur);
  }

  /** Carry `obj` in both arms (null puts it down; the caller owns the object). */
  carry(obj: THREE.Object3D | null): void {
    if (this.carried === obj) return;
    this.carried?.removeFromParent();
    this.carried = obj;
    if (obj) {
      this.rigParts.torso.add(obj);
      obj.position.set(0, 0.06, 0.33);
      obj.rotation.set(0, 0, 0);
    }
  }

  get carrying(): boolean {
    return !!this.carried;
  }

  /** A big overhead wave ("over here!") for `dur` seconds. */
  wave(dur = 1.8): void {
    this.waveT = dur;
  }

  setFacingYaw(yaw: number): void {
    this.targetYaw = yaw;
  }

  /** Name-tag lift: just above the hat (emote bubbles sit beside the pill, not under it). */
  private tagLift = 2.3;

  /** Head top in world space (name tags / chat bubbles). */
  headWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + this.tagLift, this.position.z);
  }

  update(dt: number, time: number): void {
    const hidden = this.anim === 'hidden';
    this.root.visible = !hidden;
    if (hidden) return;
    const speed = this.speed;
    const moving = speed > 0.4 && !this.busy;
    const state: 'walk' | 'idle' = moving ? 'walk' : 'idle';
    this.stateTime += dt;
    let d = this.targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-14 * dt));
    this.root.position.copy(this.position);
    const p = this.rigParts;
    p.body.rotation.y = this.yaw;

    const L = p.legL.rotation;
    const R = p.legR.rotation;
    const AL = p.armL.rotation;
    const AR = p.armR.rotation;
    L.set(0, 0, 0);
    R.set(0, 0, 0);
    AL.set(0, 0, 0.12);
    AR.set(0, 0, -0.12);
    p.torso.rotation.set(0, 0, 0);
    p.head.rotation.set(0, 0, 0);
    p.hips.rotation.z = 0;
    p.hips.position.x = 0;
    let bob = 0;
    let sy = 1;
    if (state === 'walk') {
      const run = speed > 4.2 * 1.15;
      this.phase += dt * speed * (run ? 2.3 : 2.6);
      const s = Math.sin(this.phase);
      const c = Math.cos(this.phase);
      const amp = run ? 0.85 : 0.65;
      L.x = s * amp;
      R.x = -s * amp;
      AL.x = -s * amp * 0.9;
      AR.x = s * amp * 0.9;
      bob = Math.abs(c) * (run ? 0.09 : 0.06);
      sy = 1 + (Math.abs(c) - 0.5) * (run ? 0.09 : 0.06);
      p.torso.rotation.x = run ? 0.16 : 0.07;
      p.torso.rotation.y = s * 0.08;
      p.head.rotation.x = -p.torso.rotation.x * 0.6;
      p.head.rotation.z = s * 0.03;
      this.lookYaw = 0;
    } else {
      const t = this.stateTime;
      const br = Math.sin(t * 2.2);
      sy = 1 + br * 0.018;
      const shift = Math.sin(t * 0.55);
      p.hips.rotation.z = shift * 0.035;
      p.hips.position.x = shift * 0.012;
      p.torso.rotation.z = -shift * 0.05;
      L.z = shift * 0.03;
      R.z = shift * 0.03;
      this.lookT -= dt;
      if (this.gaze !== null) {
        // Eyes on a fixed world heading (the creator's camera): the head turns up to ~40° toward it.
        const g = Math.atan2(Math.sin(this.gaze - this.yaw), Math.cos(this.gaze - this.yaw));
        this.lookTarget = Math.max(-0.7, Math.min(0.7, g));
        this.lookT = 1;
      } else if (this.lookT <= 0) {
        this.lookTarget = this.lookTarget !== 0 ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.35);
        this.lookT = this.lookTarget !== 0 ? 1.2 + Math.random() : 3 + Math.random() * 3;
      }
      this.lookYaw += (this.lookTarget - this.lookYaw) * (1 - Math.exp(-dt * 5));
      p.head.rotation.y = this.lookYaw;
      p.head.rotation.x = Math.sin(t * 0.9) * 0.02;
      AL.z = 0.12 + br * 0.03;
      AR.z = -0.12 - br * 0.03;
    }

    // Fishing: rod held out over the water, a lazy bob.
    if (this.anim === 'fish' && !this.busy) {
      if (!this.rod) this.rod = buildRod();
      if (this.rod.parent !== p.tool) {
        for (const c of [...p.tool.children]) p.tool.remove(c);
        p.tool.add(this.rod);
      }
      p.tool.visible = true;
      p.tool.position.set(0, -0.3, 0.02);
      p.tool.rotation.set(Math.PI / 2 + 0.9, 0, 0);
      const k = Math.sin(time * 1.7) * 0.05;
      AR.x = -0.95 + k;
      AR.z = -0.05;
      AL.x = -0.7 + k;
      AL.z = 0.25;
      p.torso.rotation.x = 0.05;
    } else if (this.rod && this.rod.parent === p.tool) {
      p.tool.remove(this.rod);
      if (!this.busy) p.tool.visible = false;
    }

    // Hauling: both forearms under the load, a slight lean back, a shorter swing.
    if (this.carried && !this.busy) {
      const sw = state === 'walk' ? Math.sin(this.phase) * 0.08 : 0;
      AL.set(-1.05 + sw, 0, 0.18);
      AR.set(-1.05 - sw, 0, -0.18);
      p.torso.rotation.x -= 0.08;
    }
    if (this.waveT > 0 && !this.busy) {
      this.waveT -= dt;
      const k = Math.min(1, this.waveT / 0.25, (1.8 - this.waveT) / 0.2 + 0.2);
      const w = Math.sin(this.stateTime * 13);
      AR.x = -2.75 * k;
      AR.z = (-0.35 + w * 0.38) * k;
      p.head.rotation.z += 0.08 * k;
      p.torso.rotation.z += 0.05 * k;
    }
    // Readability (pillar 13): a farmer turned toward the camera tips the head (and hat) ~9° up to
    // it, so the face is never just a hat brim from the high 3/4 camera.
    const toCam = Math.cos(this.yaw - RemoteFarmer.camFace);
    if (toCam > 0) p.head.rotation.x -= 0.16 * toCam;

    const ap = this.actionPose?.(this.rig, dt) ?? null;
    if (ap) {
      if (ap.sy !== undefined) sy = ap.sy;
      if (ap.bob !== undefined) bob = ap.bob;
    }

    this.blink -= dt;
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 0.13;
      this.nextBlink = 3 + Math.random() * 2;
    }
    const eyeY = this.blink > 0 ? 0.15 : 1;
    p.eyeL.scale.y = eyeY;
    p.eyeR.scale.y = eyeY;

    p.body.position.y = bob;
    p.body.scale.set(BODY_SCALE / Math.sqrt(sy), BODY_SCALE * sy, BODY_SCALE / Math.sqrt(sy));
    p.hat.position.y = HEAD_R * 1.55 + (state === 'walk' ? Math.abs(Math.cos(this.phase)) * 0.015 : 0);
    this.blob.scale.setScalar(1 - bob * 1.5);
    this.bubble.update(dt, time);
    this.updateStream(dt);
  }

  dispose(): void {
    this.dropMesh?.removeFromParent();
    this.dropMesh?.dispose();
    this.root.removeFromParent();
    this.mesh.geometry.dispose();
    (this.blob.material as THREE.Material).dispose();
    this.bubble.dispose();
  }
}

const BLOB_GEO = new THREE.CircleGeometry(0.42, 24);
const DROP_GEO = new THREE.SphereGeometry(0.022, 6, 4);
const DROP_MAT = new THREE.MeshStandardMaterial({ color: 0xa8dcff, roughness: 0.15, transparent: true, opacity: 0.85, emissive: 0x2a5a80, emissiveIntensity: 0.25 });
// A farmhand's first pour stream: drawn once behind the load (render/warmkit.ts, pillar 14).
registerWarm(() => {
  const m = new THREE.InstancedMesh(DROP_GEO, DROP_MAT, 1);
  m.name = 'pour-stream-warm';
  m.userData.noAO = true;
  return m;
});
const _fw = new THREE.Vector3();
const _dm = new THREE.Matrix4();
const _dq = new THREE.Quaternion();
const _ds = new THREE.Vector3();
const _dv = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

let rodProto: THREE.Object3D | null = null;
function buildRod(): THREE.Object3D {
  if (!rodProto) {
    const b = new MeshBuilder();
    const m = farmerMaterial();
    b.add(m, new THREE.CylinderGeometry(0.012, 0.028, 1.5, 8), mat(0, 0.55, 0), { tint: 0xb98a4e });
    b.add(m, new THREE.CylinderGeometry(0.03, 0.03, 0.18, 8), mat(0, -0.05, 0), { tint: 0x5a3a22 });
    b.add(m, new THREE.CylinderGeometry(0.045, 0.045, 0.04, 12), mat(0.05, 0.08, 0, 0, 0, Math.PI / 2), { tint: 0x9aa4ae });
    const g = b.geometries().get(m)!;
    rodProto = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
    rodProto.castShadow = true;
  }
  return rodProto.clone();
}
