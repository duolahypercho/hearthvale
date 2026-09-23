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
  let saved: { wet: number; snow: number; rain: number } | null = null;
  const center = new THREE.Vector3();

  scene.onBeforeRender = function (...args) {
    prevBefore.apply(this, args);
    const room = game.world.current;
    if (!isInterior(room)) return;
    // 1. Only the room, the player and indoor-flagged objects render.
    for (const o of scene.children) {
      if (!o.visible || o === room.root || o === game.player.root || (o as THREE.Light).isLight || o === game.rc.camera) continue;
      if (o.userData.indoors) continue;
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
    const half = Math.max(room.spec.W, room.spec.D) * 0.5 + 2.5;
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
    if (!saved) saved = { wet: globalUniforms.uWet.value, snow: globalUniforms.uSnow.value, rain: globalUniforms.uRain.value };
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
      saved = null;
    }
  };
}
