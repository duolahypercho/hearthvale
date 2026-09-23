/**
 * Day/night lighting rig. Drives sun/moon (single shadow-casting directional light),
 * hemisphere sky fill, bounce fill, fog, sky dome, exposure, bloom and the color grade
 * from the calendar's time of day, season and weather.
 */
import * as THREE from 'three';
import type { Season, Weather } from '../core/time';
import type { RenderContext } from './renderer';
import { globalUniforms } from './uniforms';
import { nightGlow, interiorGlow } from './materials';

interface Key {
  h: number;
  sun: number; // hex sRGB
  sunI: number;
  sky: number;
  ground: number;
  hemiI: number;
  fog: number;
  skyTop: number;
  horizon: number;
  exposure: number;
  lift: [number, number, number];
  gain: [number, number, number];
  sat: number;
  contrast: number;
  vignette: number;
  night: number;
}

// Hand-tuned palette over the day (6:00 → 26:00).
const KEYS: Key[] = [
  { h: 5.0, sun: 0x8fa6ff, sunI: 0.35, sky: 0x2a3c6e, ground: 0x151822, hemiI: 0.85, fog: 0x2b3656, skyTop: 0x0e1633, horizon: 0x3c4d7a, exposure: 1.25, lift: [0.02, 0.03, 0.08], gain: [0.9, 0.95, 1.1], sat: 0.95, contrast: 1.05, vignette: 0.55, night: 1 },
  { h: 6.0, sun: 0xffa27a, sunI: 1.1, sky: 0x8a9fd0, ground: 0x4a3d3a, hemiI: 1.0, fog: 0xc9a9a6, skyTop: 0x5a78b8, horizon: 0xf2b494, exposure: 1.05, lift: [0.03, 0.02, 0.05], gain: [1.05, 0.98, 0.98], sat: 1.08, contrast: 1.04, vignette: 0.42, night: 0.3 },
  { h: 7.2, sun: 0xffc896, sunI: 2.7, sky: 0x9ec0f0, ground: 0x5a4a36, hemiI: 1.1, fog: 0xd8d4c8, skyTop: 0x6f9be0, horizon: 0xf7d9b5, exposure: 1.0, lift: [0.02, 0.015, 0.03], gain: [1.06, 1.0, 0.95], sat: 1.12, contrast: 1.05, vignette: 0.36, night: 0 },
  { h: 9.5, sun: 0xffe6c4, sunI: 3.2, sky: 0xa8cbf5, ground: 0x5c5038, hemiI: 1.15, fog: 0xd6e2ea, skyTop: 0x6aa0ea, horizon: 0xdcecf5, exposure: 1.0, lift: [0.01, 0.015, 0.03], gain: [1.03, 1.01, 0.98], sat: 1.12, contrast: 1.05, vignette: 0.32, night: 0 },
  { h: 13.0, sun: 0xfff2e0, sunI: 3.4, sky: 0xaccff8, ground: 0x5e533c, hemiI: 1.15, fog: 0xd7e6ef, skyTop: 0x5f9ae8, horizon: 0xdff0fa, exposure: 0.98, lift: [0.01, 0.015, 0.03], gain: [1.02, 1.01, 0.99], sat: 1.1, contrast: 1.05, vignette: 0.3, night: 0 },
  { h: 16.5, sun: 0xffe2b8, sunI: 3.1, sky: 0xa6c4ee, ground: 0x5e5038, hemiI: 1.1, fog: 0xdcdcd2, skyTop: 0x6496e0, horizon: 0xf0e2c8, exposure: 1.0, lift: [0.015, 0.012, 0.03], gain: [1.05, 1.0, 0.96], sat: 1.12, contrast: 1.05, vignette: 0.32, night: 0 },
  { h: 18.2, sun: 0xffc98a, sunI: 2.9, sky: 0x9fb0e0, ground: 0x5a4432, hemiI: 1.0, fog: 0xe6c3a0, skyTop: 0x5b7ecb, horizon: 0xffc58c, exposure: 1.02, lift: [0.03, 0.015, 0.04], gain: [1.1, 0.98, 0.9], sat: 1.14, contrast: 1.06, vignette: 0.38, night: 0 },
  { h: 19.0, sun: 0xffb070, sunI: 2.4, sky: 0x8f9ad0, ground: 0x4e3a30, hemiI: 0.85, fog: 0xe0a882, skyTop: 0x4f64b0, horizon: 0xffae70, exposure: 1.05, lift: [0.035, 0.02, 0.06], gain: [1.1, 0.97, 0.88], sat: 1.14, contrast: 1.09, vignette: 0.46, night: 0.04 },
  { h: 19.8, sun: 0xff8a5a, sunI: 1.5, sky: 0x6c6aa8, ground: 0x3a2a30, hemiI: 0.85, fog: 0xa8708a, skyTop: 0x34408a, horizon: 0xe8806a, exposure: 1.1, lift: [0.05, 0.03, 0.08], gain: [1.05, 0.95, 0.98], sat: 1.1, contrast: 1.07, vignette: 0.5, night: 0.3 },
  { h: 20.5, sun: 0x8a90ff, sunI: 0.08, sky: 0x3a4880, ground: 0x181a28, hemiI: 0.75, fog: 0x2e3a60, skyTop: 0x141c44, horizon: 0x4a4f86, exposure: 1.25, lift: [0.03, 0.04, 0.1], gain: [0.92, 0.96, 1.1], sat: 1.0, contrast: 1.07, vignette: 0.55, night: 0.88 },
  { h: 21.3, sun: 0x8fa6ff, sunI: 1.1, sky: 0x34487e, ground: 0x10141c, hemiI: 0.74, fog: 0x1c2748, skyTop: 0x0b1230, horizon: 0x2a3766, exposure: 1.32, lift: [0.02, 0.03, 0.085], gain: [0.9, 0.97, 1.14], sat: 1.02, contrast: 1.1, vignette: 0.6, night: 1 },
  { h: 26.0, sun: 0x8fa6ff, sunI: 1.05, sky: 0x304478, ground: 0x10141c, hemiI: 0.72, fog: 0x18223f, skyTop: 0x09102a, horizon: 0x24305c, exposure: 1.32, lift: [0.02, 0.03, 0.085], gain: [0.9, 0.97, 1.14], sat: 1.0, contrast: 1.1, vignette: 0.62, night: 1 },
];

const SEASON_GRASS: Record<Season, { a: number; b: number; tip: number; dry: number; dryAmt: number }> = {
  spring: { a: 0x4d8c38, b: 0x7fb246, tip: 0xb6d46a, dry: 0xa2b05a, dryAmt: 0.45 },
  summer: { a: 0x437f2f, b: 0x6aa13a, tip: 0xa8c855, dry: 0x9c9e48, dryAmt: 0.5 },
  fall: { a: 0x86863a, b: 0xb0a048, tip: 0xd6b252, dry: 0xa8602c, dryAmt: 0.9 },
  winter: { a: 0xdfe8f0, b: 0xc9d6e2, tip: 0xf2f6fa, dry: 0xaebdcc, dryAmt: 0.3 },
};
const SEASON_W: Record<Season, [number, number, number, number]> = { spring: [1, 0, 0, 0], summer: [0, 1, 0, 0], fall: [0, 0, 1, 0], winter: [0, 0, 0, 1] };

/** Distance (world units) from the view centre back towards the sun that shadow casters are gathered. */
const SHADOW_REACH = 25;

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

function lerpHex(a: number, b: number, t: number, out: THREE.Color): THREE.Color {
  _c1.setHex(a);
  _c2.setHex(b);
  return out.copy(_c1).lerp(_c2, t);
}

export class DayNight {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly bounce: THREE.DirectionalLight;
  readonly fog: THREE.Fog;
  readonly sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private nightLights: { light: THREE.PointLight | THREE.SpotLight; max: number }[] = [];
  /** 0 day .. 1 night (read by props/particles). */
  night = 0;
  /** 0..1 morning ground-mist haze (set every frame by the weather system): thicker, paler fog. */
  mist = 0;
  /** Minimum wetness (weather system: surfaces stay damp for a while after the rain stops). */
  wetFloor = 0;
  /** Current weather blend (smoothed). */
  private overcast = 0;
  private snowTarget = 0;
  private wetTarget = 0;
  private windTarget = 1;
  private grassColors = { a: new THREE.Color(), b: new THREE.Color(), tip: new THREE.Color(), dry: new THREE.Color() };
  private grassTarget = { a: new THREE.Color(), b: new THREE.Color(), tip: new THREE.Color(), dry: new THREE.Color() };
  private seasonTint = new THREE.Color(1, 1, 1);
  private seasonW = new THREE.Vector4(1, 0, 0, 0);
  private dryAmtTarget = 0.45;
  private flash = 0;
  private first = true;
  private sunDir = new THREE.Vector3();
  // Image-based lighting: a tiny gradient-sky scene prefiltered with PMREM, refreshed
  // whenever the (quantized) time of day / weather changes.
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envMat: THREE.ShaderMaterial;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envKey = '';

  constructor(private rc: RenderContext) {
    const scene = rc.scene;
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(rc.preset.shadowMapSize, rc.preset.shadowMapSize);
    this.sun.shadow.radius = rc.preset.shadowRadius;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = SHADOW_REACH + 14;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a4a36, 1.1);
    scene.add(this.hemi);

    this.bounce = new THREE.DirectionalLight(0xffe0b0, 0.35);
    scene.add(this.bounce, this.bounce.target);

    this.fog = new THREE.Fog(0xd6e2ea, 40, 120);
    scene.fog = this.fog;
    scene.background = new THREE.Color(0xd6e2ea);

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: globalUniforms.uSunDir,
        uSunColor: globalUniforms.uSunColor,
        uNight: globalUniforms.uNight,
        uTime: globalUniforms.uTime,
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uNight; uniform float uTime;
        varying vec3 vDir;
        float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main() {
          vec3 d = normalize(vDir);
          float t = smoothstep(-0.05, 0.6, d.y);
          vec3 c = mix(uHorizon, uTop, t);
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          c += uSunColor * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.25) * (1.0 - uNight * 0.7);
          vec3 sp = floor(d * 380.0);
          float star = step(0.9975, h3(sp)) * smoothstep(0.1, 0.4, d.y) * uNight;
          star *= 0.6 + 0.4 * sin(uTime * 2.0 + h3(sp + 3.0) * 30.0);
          c += vec3(star);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    scene.add(this.sky);

    this.pmrem = new THREE.PMREMGenerator(rc.renderer);
    this.envMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunDir; uniform vec3 uSunColor; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir);
          vec3 c = d.y > 0.0 ? mix(uHorizon, uTop, smoothstep(0.0, 0.7, d.y)) : mix(uHorizon, uGround, smoothstep(0.0, 0.25, -d.y));
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          c += uSunColor * (pow(s, 64.0) * 6.0 + pow(s, 6.0) * 0.4);
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), this.envMat));
  }

  private updateEnv(hour: number, key: string): void {
    const k = `${Math.round(hour * 4)}|${key}`;
    if (k === this.envKey) return;
    this.envKey = k;
    const u = this.envMat.uniforms;
    (u.uTop!.value as THREE.Color).copy(this.skyMat.uniforms.uTop!.value as THREE.Color);
    (u.uHorizon!.value as THREE.Color).copy(this.skyMat.uniforms.uHorizon!.value as THREE.Color);
    (u.uGround!.value as THREE.Color).copy(this.hemi.groundColor).multiplyScalar(0.8);
    (u.uSunDir!.value as THREE.Vector3).copy(this.sunDir);
    (u.uSunColor!.value as THREE.Color).copy(this.sun.color).multiplyScalar(this.sun.intensity / 3);
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
    this.envRT?.dispose();
    this.envRT = rt;
    this.rc.scene.environment = rt.texture;
  }

  addNightLight(light: THREE.PointLight | THREE.SpotLight, max: number): void {
    light.intensity = 0;
    this.nightLights.push({ light, max });
  }

  setSeason(season: Season, instant = false): void {
    const s = SEASON_GRASS[season];
    this.grassTarget.a.setHex(s.a);
    this.grassTarget.b.setHex(s.b);
    this.grassTarget.tip.setHex(s.tip);
    this.grassTarget.dry.setHex(s.dry);
    this.dryAmtTarget = s.dryAmt;
    this.seasonW.fromArray(SEASON_W[season]);
    this.snowTarget = season === 'winter' ? 1 : 0;
    this.seasonTint.setRGB(1, 1, 1);
    if (season === 'fall') this.seasonTint.setRGB(1.04, 0.98, 0.9);
    if (season === 'winter') this.seasonTint.setRGB(0.93, 0.97, 1.06);
    if (instant) this.snapSeason();
  }

  private snapSeason(): void {
    this.grassColors.a.copy(this.grassTarget.a);
    this.grassColors.b.copy(this.grassTarget.b);
    this.grassColors.tip.copy(this.grassTarget.tip);
    this.grassColors.dry.copy(this.grassTarget.dry);
    globalUniforms.uSnow.value = this.snowTarget;
    globalUniforms.uSeasonW.value.copy(this.seasonW);
    globalUniforms.uDryAmt.value = this.dryAmtTarget;
  }

  /** Lightning flash 0..1 (storm), set every frame by the weather system. */
  setFlash(f: number): void {
    this.flash = f;
  }

  setWeather(w: Weather, instant = false): void {
    this.wetTarget = w === 'rain' || w === 'storm' ? 1 : 0;
    this.windTarget = w === 'storm' ? 2.6 : w === 'wind' ? 2.0 : w === 'rain' ? 1.5 : 1.0;
    this.overcastTarget = w === 'rain' ? 0.9 : w === 'storm' ? 1.0 : w === 'snow' ? 0.55 : 0;
    if (w === 'snow') this.snowTarget = 1;
    if (instant) {
      this.overcast = this.overcastTarget;
      globalUniforms.uWet.value = this.wetTarget;
      globalUniforms.uWindStrength.value = this.windTarget;
      globalUniforms.uSnow.value = this.snowTarget;
    }
  }
  private overcastTarget = 0;

  private sample(h: number): { a: Key; b: Key; t: number } {
    const hh = THREE.MathUtils.clamp(h, KEYS[0]!.h, KEYS[KEYS.length - 1]!.h);
    for (let i = 0; i < KEYS.length - 1; i++) {
      const a = KEYS[i]!;
      const b = KEYS[i + 1]!;
      if (hh >= a.h && hh <= b.h) {
        const t = (hh - a.h) / (b.h - a.h);
        return { a, b, t: t * t * (3 - 2 * t) };
      }
    }
    const k = KEYS[KEYS.length - 1]!;
    return { a: k, b: k, t: 0 };
  }

  /** Direction towards the sun/moon for an hour. */
  lightDirection(h: number, out: THREE.Vector3): THREE.Vector3 {
    if (h < 20.7 && h >= 5.5) {
      // Low, raking sun in the morning and a long golden-hour (~9° at 19:00) before sunset.
      const t = THREE.MathUtils.clamp((h - 5.8) / (20.2 - 5.8), 0, 1);
      const el = THREE.MathUtils.degToRad(4 + Math.pow(Math.sin(t * Math.PI), 1.2) * 54);
      const hx = Math.cos(t * Math.PI);
      const hz = 0.55 + 0.25 * Math.sin(t * Math.PI);
      const len = Math.hypot(hx, hz);
      out.set((hx / len) * Math.cos(el), Math.sin(el), (hz / len) * Math.cos(el));
    } else {
      // Moon: high in the south-west, drifting slowly across the night.
      const t = THREE.MathUtils.clamp((h >= 20.7 ? h - 20.7 : h + 3.3) / 6, 0, 1);
      out.set(-0.35 + t * 0.6, 0.78, 0.55).normalize();
    }
    return out;
  }

  update(dt: number, hour: number): void {
    const { a, b, t } = this.sample(hour);
    const k = this.first ? 1 : 1 - Math.exp(-dt * 1.5);
    if (this.first) this.snapSeason();
    this.first = false;

    // Smooth weather/season transitions.
    this.overcast += (this.overcastTarget - this.overcast) * k;
    globalUniforms.uWet.value += (this.wetTarget - globalUniforms.uWet.value) * k * 0.5;
    globalUniforms.uWet.value = Math.max(globalUniforms.uWet.value, this.wetFloor);
    globalUniforms.uWindStrength.value += (this.windTarget - globalUniforms.uWindStrength.value) * k;
    globalUniforms.uSnow.value += (this.snowTarget - globalUniforms.uSnow.value) * k * 0.4;
    for (const key of ['a', 'b', 'tip', 'dry'] as const) this.grassColors[key].lerp(this.grassTarget[key], k * 0.5);
    globalUniforms.uSeasonW.value.lerp(this.seasonW, k * 0.5);
    globalUniforms.uDryAmt.value += (this.dryAmtTarget - globalUniforms.uDryAmt.value) * k * 0.5;
    globalUniforms.uGrassA.value.copy(this.grassColors.a);
    globalUniforms.uGrassB.value.copy(this.grassColors.b);
    globalUniforms.uGrassTip.value.copy(this.grassColors.tip);
    globalUniforms.uGrassDry.value.copy(this.grassColors.dry);

    const oc = this.overcast;
    const L = THREE.MathUtils.lerp;
    this.night = L(a.night, b.night, t);
    globalUniforms.uNight.value = this.night;

    // Sun / moon
    this.lightDirection(hour, this.sunDir);
    globalUniforms.uSunDir.value.copy(this.sunDir);
    lerpHex(a.sun, b.sun, t, this.sun.color).multiply(this.seasonTint);
    const grey = new THREE.Color(0.75, 0.78, 0.82);
    this.sun.color.lerp(grey, oc * 0.6);
    this.sun.intensity = L(a.sunI, b.sunI, t) * (1 - oc * 0.8);
    globalUniforms.uSunColor.value.copy(this.sun.color).multiplyScalar(this.sun.intensity / 3);

    // Hemisphere + bounce (snow: cool blue skylight fills the shadows; lightning: flash)
    const snow = globalUniforms.uSnow.value;
    lerpHex(a.sky, b.sky, t, this.hemi.color).lerp(new THREE.Color(0.62, 0.66, 0.72), oc * 0.5).lerp(new THREE.Color(0.62, 0.74, 1.0), snow * 0.35 * (1 - this.night));
    lerpHex(a.ground, b.ground, t, this.hemi.groundColor).lerp(new THREE.Color(0.55, 0.6, 0.7), snow * 0.4 * (1 - this.night));
    this.hemi.intensity = L(a.hemiI, b.hemiI, t) * 0.8 * (1 + oc * 0.35) + this.flash * 3.5;
    this.bounce.color.copy(this.hemi.groundColor).lerp(this.sun.color, 0.5);
    this.bounce.intensity = this.sun.intensity * 0.12;

    // Fog + sky
    lerpHex(a.fog, b.fog, t, this.fog.color).lerp(new THREE.Color(0.55, 0.58, 0.62).multiplyScalar(1 - this.night * 0.7), oc * 0.6);
    (this.rc.scene.background as THREE.Color).copy(this.fog.color);
    // Rain: ~2.5x denser, blue-grey fog.
    const rainy = Math.max(0, oc - 0.6) / 0.4;
    const storm = Math.max(0, oc - 0.9) / 0.1;
    this.fog.color.lerp(new THREE.Color(0.46, 0.52, 0.6).multiplyScalar((1 - this.night * 0.75) * (1 - storm * 0.3)), rainy * 0.6);
    (this.rc.scene.background as THREE.Color).copy(this.fog.color);
    this.fog.near = this.rc.rig.distance * (1.25 - rainy * 0.55);
    this.fog.far = this.rc.rig.distance * (4.2 - oc * 1.1 - rainy * 1.25);
    if (this.mist > 0.001) {
      const m = this.mist;
      _c1.setRGB(0.86, 0.87, 0.86).lerp(this.sun.color, 0.25).multiplyScalar(1 - this.night * 0.75);
      this.fog.color.lerp(_c1, m * 0.7);
      (this.rc.scene.background as THREE.Color).copy(this.fog.color);
      this.fog.near *= 1 - m * 0.6;
      this.fog.far *= 1 - m * 0.42;
    }
    lerpHex(a.skyTop, b.skyTop, t, this.skyMat.uniforms.uTop!.value as THREE.Color);
    lerpHex(a.horizon, b.horizon, t, this.skyMat.uniforms.uHorizon!.value as THREE.Color);
    (this.skyMat.uniforms.uTop!.value as THREE.Color).lerp(this.fog.color, oc * 0.7);
    (this.skyMat.uniforms.uHorizon!.value as THREE.Color).lerp(this.fog.color, oc * 0.7);
    globalUniforms.uSkyColor.value.copy(this.skyMat.uniforms.uTop!.value as THREE.Color);
    globalUniforms.uHorizonColor.value.copy(this.skyMat.uniforms.uHorizon!.value as THREE.Color);
    globalUniforms.uCloudShadow.value = 0.32 * (1 - oc) * (1 - this.night);

    // Exposure + grade
    this.rc.renderer.toneMappingExposure = L(a.exposure, b.exposure, t) * (1 - Math.max(0, oc - 0.85) * 1.2) + this.flash * 0.5;
    // Golden-hour rim: strongest with a low sun, gone at night / under overcast.
    const elev = Math.asin(THREE.MathUtils.clamp(this.sunDir.y, -1, 1));
    // …and a cool moonlit rim at night so canopies keep their silhouettes against the dark.
    globalUniforms.uRim.value = Math.max((1 - THREE.MathUtils.smoothstep(elev, 0.14, 0.5)) * (1 - this.night), this.night * 0.55) * (1 - oc * 0.9);
    const g = this.rc.post.grade.uniforms;
    (g.uLift!.value as THREE.Vector3).set(L(a.lift[0], b.lift[0], t), L(a.lift[1], b.lift[1], t), L(a.lift[2], b.lift[2], t));
    (g.uGain!.value as THREE.Vector3).set(L(a.gain[0], b.gain[0], t), L(a.gain[1], b.gain[1], t), L(a.gain[2], b.gain[2], t));
    g.uSaturation!.value = L(a.sat, b.sat, t) * (1 - oc * 0.18);
    g.uContrast!.value = L(a.contrast, b.contrast, t) * (1 - oc * 0.04);
    g.uVignette!.value = L(a.vignette, b.vignette, t);
    // Bloom threshold stays high day and night (only emissives / sun glints exceed it); night only
    // raises the strength a little so lit windows and lanterns glow — lamp-lit ground never blooms.
    this.rc.post.setBloom(0.3 + this.night * 0.22, 0.92);

    // Night emissives + practical lights: lamps come on at dusk (18:30) and stay on until dawn.
    const dusk = hour >= 12 ? THREE.MathUtils.smoothstep(hour, 18.3, 19.3) : 1 - THREE.MathUtils.smoothstep(hour, 5.8, 6.6);
    const glow = Math.min(1, Math.max(dusk * 0.85 + THREE.MathUtils.smoothstep(this.night, 0.3, 0.9) * 0.15, THREE.MathUtils.smoothstep(this.night, 0.15, 0.85)) + oc * 0.3);
    globalUniforms.uLamps.value = glow;
    for (const n of nightGlow) n.material.emissiveIntensity = n.max * glow;
    // Interiors: 0 at noon → full by ~18:00, off again by mid-morning (+ a little on dark rainy days).
    const inside = Math.min(1, (hour >= 12 ? THREE.MathUtils.smoothstep(hour, 15.2, 18.2) : 1 - THREE.MathUtils.smoothstep(hour, 6.4, 8.2)) + oc * 0.35);
    for (const n of interiorGlow) n.material.emissiveIntensity = n.max * inside;
    // Snow reflects ~2x the light of grass: dim the practicals over snow cover so pools stay warm, not white.
    const lampK = glow * (1 - 0.45 * snow);
    for (const n of this.nightLights) n.light.intensity = n.max * lampK;

    this.rc.scene.environmentIntensity = 0.55 * (1 - this.night * 0.6);
    this.updateEnv(hour, `${this.overcastTarget}:${this.snowTarget}`);

    this.fitShadow();
  }

  /**
   * Fit the directional shadow frustum to the camera's ground footprint (the 4 view-frustum corner
   * rays hitting the ground plane), in light space, plus a margin for tall casters. Size is
   * quantised and the centre texel-snapped so shadows don't shimmer while the camera follows.
   */
  private fitShadow(): void {
    const rig = this.rc.rig;
    const cam = this.sun.shadow.camera;
    const camera = this.rc.camera;
    camera.updateMatrixWorld();
    const lightRot = new THREE.Matrix4().lookAt(this.sunDir, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    const inv = lightRot.clone().invert();
    const groundY = rig.focus.y;
    const origin = camera.position;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const p = new THREE.Vector3();
    const dir = new THREE.Vector3();
    for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1]] as const) {
      dir.set(nx, ny, 0.5).unproject(camera).sub(origin).normalize();
      // Ray → ground plane (clamped for rays near the horizon).
      const t = dir.y < -0.05 ? Math.min((groundY - origin.y) / dir.y, rig.distance * 3) : rig.distance * 3;
      for (const h of [0, 5]) {
        p.copy(origin).addScaledVector(dir, t);
        p.y = groundY + h;
        p.applyMatrix4(inv);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
    const margin = 2.5;
    const q = 2;
    const halfW = Math.ceil(((maxX - minX) / 2 + margin) / q) * q;
    const halfH = Math.ceil(((maxY - minY) / 2 + margin) / q) * q;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.updateProjectionMatrix();
    const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, 0);
    // Light-space z of the focus point (the box centre sits on the view's ground).
    center.z = rig.focus.clone().applyMatrix4(inv).z;
    const texelX = (halfW * 2) / this.sun.shadow.mapSize.x;
    const texelY = (halfH * 2) / this.sun.shadow.mapSize.y;
    center.x = Math.round(center.x / texelX) * texelX;
    center.y = Math.round(center.y / texelY) * texelY;
    center.applyMatrix4(lightRot);
    this.sun.target.position.copy(center);
    // Only casters within ~45 m up-light of the view can land a shadow in it (a 12 m tree at a
    // 9° golden-hour sun throws ~75 m, but it's clipped by the cliffs/forest long before that).
    // A short light column keeps the plateau forest out of the shadow pass.
    this.sun.position.copy(center).addScaledVector(this.sunDir, SHADOW_REACH);
    this.sun.target.updateMatrixWorld();
    this.bounce.position.copy(center).add(new THREE.Vector3(-this.sunDir.x, 0.4, -this.sunDir.z).multiplyScalar(30));
    this.bounce.target.position.copy(center);
    this.bounce.target.updateMatrixWorld();
    this.sky.position.copy(this.rc.camera.position);
  }
}
