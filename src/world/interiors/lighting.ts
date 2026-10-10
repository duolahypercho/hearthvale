/**
 * InteriorLighting: while an InteriorMap is the current map, swap the outdoor day/night rig for the
 * room's own light profile — without touching render/lighting.ts. It hooks scene.onBeforeRender
 * (runs after DayNight.update, before three builds its render list + shadow maps, once per scene
 * render incl. the GTAO pass) and:
 *   - hides every top-level scene object that doesn't belong indoors (sky dome, rain / snow volumes,
 *     outdoor critters...) — only the room, the player, lights and objects flagged
 *     `userData.indoors = true` stay visible (restored in onAfterRender);
 *   - re-aims the sun as the window light (fixed room direction, texel-snapped shadow box around
 *     the room) and sets hemi / fog / background / exposure / env / grade / bloom from the room;
 *   - zeroes outdoor-only shader globals (cloud shadows, golden rim, wetness, snow).
 * Values DayNight writes absolutely each frame need no restore; the smoothed globals do.
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import { globalUniforms } from '../../render/uniforms';
import { atmosphere } from '../../render/heightfog';
import type { InteriorMap } from './room';

export function isInterior(m: unknown): m is InteriorMap {
  return !!m && (m as { interior?: boolean }).interior === true;
}

export function installInteriorLighting(game: Game): void {
  const scene = game.scene;
  const prevBefore = scene.onBeforeRender;
  const prevAfter = scene.onAfterRender;
  const hidden: THREE.Object3D[] = [];
  let saved: { wet: number; snow: number; rain: number; bias: number; normalBias: number; shadowK: number } | null = null;
  const center = new THREE.Vector3();

  scene.onBeforeRender = function (...args) {
    prevBefore.apply(this, args);
    const room = game.world.current;
    if (!isInterior(room)) return;
    // 1. Only the room, the player and indoor-flagged objects render.
    for (const o of scene.children) {
      if (!o.visible || o === room.root || o === game.player.root || (o as THREE.Light).isLight || o === game.rc.camera) continue;
      if (o.userData.indoors) continue;
      // Co-op: other farmers in this room render too (r10: they were hidden with the outdoor world —
      // the host saw only a floating name pill where the farmhand stood in the coop).
      if (o.name === 'remote-farmer') continue;
      if ((o as THREE.Object3D).type === 'Object3D' && o.children.length === 0) continue; // light targets
      o.visible = false;
      hidden.push(o);
    }
    // 2. Light rig.
    const L = room.light;
    const lit = game.lighting;
    const sun = lit.sun;
    center.copy(room.center).setY(room.spec.H * 0.5);
    sun.color.copy(L.sunColor);
    sun.intensity = L.sunI;
    sun.position.copy(center).addScaledVector(L.sunDir, 18);
    sun.target.position.copy(center);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    const cam = sun.shadow.camera;
    // Tight box around the room (+ the shadow-caster ceiling lip): more texels per metre, no acne
    // stripes on the farmer's hat under the low window sun.
    const half = Math.max(room.spec.W, room.spec.D) * 0.5 + 1.4;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = 40;
    cam.updateProjectionMatrix();
    lit.hemi.color.copy(L.hemiSky);
    lit.hemi.groundColor.copy(L.hemiGround);
    lit.hemi.intensity = L.hemiI;
    lit.bounce.intensity = 0;
    lit.fog.near = 400;
    lit.fog.far = 800;
    (scene.background as THREE.Color | null)?.copy?.(L.bg);
    game.rc.renderer.toneMappingExposure = L.exposure;
    scene.environmentIntensity = L.envI;
    const g = game.rc.post.grade.uniforms;
    (g.uLift!.value as THREE.Vector3).set(...L.lift);
    (g.uGain!.value as THREE.Vector3).set(...L.gain);
    g.uSaturation!.value = L.sat;
    g.uContrast!.value = L.contrast;
    g.uVignette!.value = L.vignette;
    game.rc.post.setBloom(L.bloom, 0.9);
    // 3. Outdoor-only shader globals.
    if (!saved) saved = { wet: globalUniforms.uWet.value, snow: globalUniforms.uSnow.value, rain: globalUniforms.uRain.value, bias: sun.shadow.bias, normalBias: sun.shadow.normalBias, shadowK: sun.shadow.intensity };
    // Grazing window light: push the lookup off the surface along the normal (hat brims, animal backs).
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.035;
    // (r8: moonlight is a soft fill, not a key — at full strength the farmer threw a black wedge from the
    // back windows across the lamp-lit floor straight at the lens; the shadow fades to 40 % by night)
    // (r13: 20 % by night — the farmer's moon shadow still lay across the foreground floor as a big wedge)
    // (r24: 8 % — at 20 % the farmer's moon shadow still ran as a long dark wedge from their feet to the
    // sofa in house-night; the lamps don't cast, so the moon's shadow was the only one and read as a stain)
    sun.shadow.intensity = THREE.MathUtils.lerp(0.8, 0.08, L.night);
    globalUniforms.uWet.value = 0;
    globalUniforms.uSnow.value = 0;
    globalUniforms.uRain.value = 0;
    globalUniforms.uCloudShadow.value = 0;
    // No ground mist indoors (the weather system re-writes it every frame outside).
    atmosphere.fog = 0;
    globalUniforms.uRim.value = 0;
    globalUniforms.uSunDir.value.copy(L.sunDir);
    globalUniforms.uSunColor.value.copy(L.sunColor).multiplyScalar(L.sunI / 3);
  };

  scene.onAfterRender = function (...args) {
    prevAfter.apply(this, args);
    for (const o of hidden) o.visible = true;
    hidden.length = 0;
    if (saved) {
      globalUniforms.uWet.value = saved.wet;
      globalUniforms.uSnow.value = saved.snow;
      globalUniforms.uRain.value = saved.rain;
      game.lighting.sun.shadow.bias = saved.bias;
      game.lighting.sun.shadow.normalBias = saved.normalBias;
      game.lighting.sun.shadow.intensity = saved.shadowK;
      saved = null;
    }
  };
}
