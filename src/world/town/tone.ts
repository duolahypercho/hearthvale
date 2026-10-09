/**
 * Town dusk / night tone (r15, critic: "the evening treatment is overcooked: orange-red lamp pools and
 * crushed shadows swallow façade materials, props and villager silhouettes"). While the town is the
 * current map, a chained scene.onBeforeRender hook (the mine / interiors precedent — render/lighting.ts
 * stays untouched) re-tones the day/night rig's dusk and night values once per frame:
 *
 *  - dusk (≈18.6–21.2, peak ~19.6–20.4): the low sun loses its red (a peach-gold key, a little dimmer),
 *    the sky fill turns cool lavender-blue and lifts (+40 %) so shadowed façades and faces keep their
 *    midtones, the magenta haze cools, the grade's red gain and saturation come down, bloom softens;
 *  - night: a cool moonlit fill under the practicals so the frame's thirds don't sink to near-black,
 *    bloom kept for the few hottest focal lights.
 *
 * Idempotent per frame (keyed on game.time): AO / normal pre-passes render the scene too.
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import { globalUniforms } from '../../render/uniforms';

/** Live-tunable (window.__townTone) for look-dev. */
export const TOWN_TONE = { dusk: 1, night: 1, winter: 1 };
(globalThis as unknown as { __townTone: typeof TOWN_TONE }).__townTone = TOWN_TONE;

const _sunGold = new THREE.Color(0xffc49a);
// (r17: bluer — the plaza still read lavender-pink against Stardew's blue-violet dusk)
const _skyCool = new THREE.Color(0x8698e0);
const _groundCool = new THREE.Color(0x3e4668);
const _fogCool = new THREE.Color(0x7e88bc);
const _moonSky = new THREE.Color(0x5a6cae);
const _moonGround = new THREE.Color(0x262a40);
const _winSky = new THREE.Color(0x7fb4ec);
const _winGround = new THREE.Color(0x5a7cb8);
const _winSun = new THREE.Color(0xfff0d8);
const _winFog = new THREE.Color(0xc4d8ee);

let installed = false;

export function installTownTone(game: Game): void {
  if (installed) return;
  installed = true;
  const scene = game.scene;
  const prev = scene.onBeforeRender;
  let lastT = -1;
  scene.onBeforeRender = function (...args) {
    prev.apply(this, args);
    if (game.world.current?.id !== 'town') return;
    if (game.time === lastT) return;
    lastT = game.time;
    apply(game);
  };
}

function apply(game: Game): void {
  const L = game.lighting;
  const h = game.calendar.hour;
  const snow = globalUniforms.uSnow.value;
  const ss = THREE.MathUtils.smoothstep;
  // Dusk weight: rises through sunset, holds through the blue hour, hands over to night.
  const dusk = ss(h, 18.4, 19.3) * (1 - ss(h, 20.6, 21.4)) * TOWN_TONE.dusk;
  const night = ss(L.night, 0.55, 1) * TOWN_TONE.night;
  const rc = game.rc;
  // r16 winter day (critic: "town-winter is bleached: near-white snow with almost no value structure
  // … Stardew's winter lives on cyan and blue shadow tones"): the sky fill turns a clear cyan-blue so
  // every shadow and occluded side of the snow goes blue, the sun stays a warm cream, the exposure and
  // highlights come down off the clip and contrast rises so drifts, banks and roofs read in value.
  const wint = snow * (1 - dusk) * (1 - ss(L.night, 0.2, 0.7)) * TOWN_TONE.winter;
  if (wint > 0.002) {
    L.hemi.color.lerp(_winSky, 0.75 * wint);
    L.hemi.groundColor.lerp(_winGround, 0.7 * wint);
    L.hemi.intensity *= 1 - 0.08 * wint;
    L.sun.color.lerp(_winSun, 0.5 * wint);
    L.sun.intensity *= 1 - 0.1 * wint;
    L.bounce.color.copy(L.hemi.groundColor).lerp(L.sun.color, 0.35);
    L.fog.color.lerp(_winFog, 0.6 * wint);
    (rc.scene.background as THREE.Color).copy(L.fog.color);
    globalUniforms.uSunColor.value.copy(L.sun.color).multiplyScalar(L.sun.intensity / 3);
    rc.renderer.toneMappingExposure *= 1 - 0.1 * wint;
    const g = rc.post.grade.uniforms;
    (g.uGain!.value as THREE.Vector3).lerp(_v.set(0.97, 0.99, 1.04), 0.7 * wint);
    (g.uLift!.value as THREE.Vector3).lerp(_v.set(0.0, 0.012, 0.04), 0.6 * wint);
    g.uContrast!.value *= 1 + 0.1 * wint;
    g.uSaturation!.value *= 1 + 0.08 * wint;
  }
  if (dusk < 0.002 && night < 0.002) return;
  if (dusk > 0.002) {
    L.sun.color.lerp(_sunGold, 0.55 * dusk);
    L.sun.intensity *= 1 - 0.22 * dusk;
    L.hemi.color.lerp(_skyCool, 0.68 * dusk);
    L.hemi.groundColor.lerp(_groundCool, 0.45 * dusk);
    L.hemi.intensity *= 1 + 0.4 * dusk;
    L.bounce.color.copy(L.hemi.groundColor).lerp(L.sun.color, 0.5);
    L.fog.color.lerp(_fogCool, 0.5 * dusk);
    (rc.scene.background as THREE.Color).copy(L.fog.color);
    globalUniforms.uSunColor.value.copy(L.sun.color).multiplyScalar(L.sun.intensity / 3);
    rc.renderer.toneMappingExposure *= 1 - 0.05 * dusk;
    const g = rc.post.grade.uniforms;
    const gain = g.uGain!.value as THREE.Vector3;
    gain.lerp(_v.set(0.985, 0.985, 1.04), 0.7 * dusk);
    const lift = g.uLift!.value as THREE.Vector3;
    lift.lerp(_v.set(0.03, 0.035, 0.07), 0.5 * dusk);
    g.uSaturation!.value *= 1 - 0.1 * dusk;
    g.uContrast!.value *= 1 - 0.03 * dusk;
    g.uVignette!.value *= 1 - 0.2 * dusk;
  }
  if (night > 0.002) {
    // (a snowy night is already bright off the snow)
    const k = night * (1 - 0.6 * snow);
    L.hemi.color.lerp(_moonSky, 0.35 * k);
    L.hemi.groundColor.lerp(_moonGround, 0.4 * k);
    // (r18 blind judge on the night heart event: "much of the frame edge is murky and dark" — a
    // little more moonlit fill and less vignette so the mid-ground props and façades keep reading)
    L.hemi.intensity *= 1 + 0.44 * k;
    const g = rc.post.grade.uniforms;
    (g.uLift!.value as THREE.Vector3).lerp(_v.set(0.034, 0.042, 0.088), 0.45 * k);
    g.uVignette!.value *= 1 - 0.3 * k;
  }
  // Bloom: kept for the few hottest focal lights (lamp glass, the forge mouth), not the lit ground.
  rc.post.setBloom((0.3 + L.night * 0.22) * (1 - 0.3 * Math.max(dusk, night * 0.6)), 0.94);
}

const _v = new THREE.Vector3();
