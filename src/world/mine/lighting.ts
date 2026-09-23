/**
 * Underground lighting. While the mine map is current it takes over the frame from the day/night
 * rig (which keeps running for the calendar): a scene.onBeforeRender hook (chained, and removed on
 * exit) re-applies cave values after DayNight.update — no sun, no sky dome, a dim biome-tinted
 * hemisphere fill, black-to-tinted fog, per-biome exposure / grade / bloom, world-FX uniforms off.
 *
 * Practicals (constant light count so floors never recompile shaders):
 *  - lantern key: a SpotLight hung above and slightly in front of the player, the only shadow
 *    caster (one shadow pass), soft cone + distance decay = a warm pool that follows you;
 *  - lantern fill: a small warm PointLight at hip height (face + near walls);
 *  - 5 accent PointLights at the floor's crystal clusters / lanterns / lava (flicker where fiery).
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import { globalUniforms } from '../../render/uniforms';
import { nightGlow } from '../../render/materials';
import type { BiomeDef } from './biomes';
import type { LightSpec } from './gen';

const ACCENTS = 5;

/** Live-tunable light levels (exposed as window.__caveTune for look-dev). */
export const CAVE_TUNE = { key: 1.15, fill: 0.05, bounce: 0.3, accent: 1, hemi: 0.8, exposure: 1 };
(globalThis as unknown as { __caveTune: typeof CAVE_TUNE }).__caveTune = CAVE_TUNE;

export class CaveLighting {
  readonly group = new THREE.Group();
  readonly key: THREE.SpotLight;
  readonly fill: THREE.PointLight;
  /** Broad, soft lantern bounce high over the farmer: the hall 6–12 m out keeps a readable
   * silhouette (walls, rocks) instead of crushing to black. */
  readonly bounce: THREE.PointLight;
  /** Cool back-light just behind / above the farmer: a rim that separates them from the floor. */
  readonly rim: THREE.PointLight;
  private accents: { light: THREE.PointLight; spec: LightSpec | null; seed: number }[] = [];
  private def: BiomeDef | null = null;
  private active = false;
  private prevHook: THREE.Object3D['onBeforeRender'] | null = null;
  private hook: THREE.Object3D['onBeforeRender'] | null = null;
  private fog = new THREE.Color();
  /** Extra exposure punch (hit flashes, lightning-like crystal bursts). */
  flash = 0;
  /** 0..1 lantern intensity scale (dims while passing out). */
  lanternScale = 1;

  constructor(private game: Game) {
    this.group.name = 'cave-lights';
    this.key = new THREE.SpotLight(0xffb46a, 30, 22, 0.95, 0.85, 1.25);
    this.key.castShadow = true;
    const q = game.rc.preset.shadowMapSize >= 4096 ? 2048 : 1024;
    this.key.shadow.mapSize.set(q, q);
    this.key.shadow.bias = -0.0008;
    this.key.shadow.normalBias = 0.03;
    this.key.shadow.radius = 4;
    this.key.shadow.camera.near = 0.8;
    this.key.shadow.camera.far = 20;
    this.group.add(this.key, this.key.target);
    this.fill = new THREE.PointLight(0xffb46a, 3, 6, 1.6);
    this.group.add(this.fill);
    this.bounce = new THREE.PointLight(0xffc890, 0, 15, 1.1);
    this.group.add(this.bounce);
    this.rim = new THREE.PointLight(0x9ab8ff, 0, 3.2, 2);
    this.group.add(this.rim);
    for (let i = 0; i < ACCENTS; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 7, 1.6);
      l.position.set(0, -100, 0);
      this.group.add(l);
      this.accents.push({ light: l, spec: null, seed: Math.random() * 10 });
    }
  }

  configure(def: BiomeDef, lights: LightSpec[]): void {
    this.def = def;
    this.fog.setHex(def.fog);
    this.key.color.setHex(def.lantern[0]);
    this.fill.color.setHex(def.lantern[0]);
    this.bounce.color.setHex(def.lantern[0]).lerp(new THREE.Color(def.hemi[0]), 0.35);
    this.rim.color.setHex(def.id === 'ice' ? 0xffd0a0 : def.id === 'lava' ? 0x9ec4ff : 0xb0c4ff);
    this.accents.forEach((a, i) => {
      const s = lights[i] ?? null;
      a.spec = s;
      if (s) {
        a.light.color.setHex(s.color);
        a.light.position.set(s.x, s.y, s.z);
        a.light.distance = s.distance;
      } else {
        a.light.position.set(0, -100, 0);
        a.light.intensity = 0;
      }
    });
  }

  activate(): void {
    if (this.active) return;
    this.active = true;
    const scene = this.game.scene;
    const dn = this.game.lighting;
    dn.sky.visible = false;
    // Keep the sun's shadow slot (constant light layout = no shader recompiles) but stop redrawing
    // it; render it once so a never-drawn map is not bound to the shadow sampler (black frame).
    dn.sun.shadow.autoUpdate = false;
    dn.sun.shadow.needsUpdate = true;
    dn.sun.castShadow = true;
    this.prevHook = scene.onBeforeRender;
    const prev = this.prevHook;
    this.hook = (renderer, sc, camera, geometry, material, group) => {
      prev?.call(scene, renderer, sc, camera, geometry, material, group);
      this.apply();
    };
    scene.onBeforeRender = this.hook;
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    const scene = this.game.scene;
    const dn = this.game.lighting;
    dn.sky.visible = true;
    dn.sun.shadow.autoUpdate = true;
    if (scene.onBeforeRender === this.hook) scene.onBeforeRender = this.prevHook ?? (() => {});
    this.hook = null;
  }

  /** Per-frame practicals (lantern follows the player, flicker). */
  update(dt: number, time: number, player: THREE.Vector3): void {
    const def = this.def;
    if (!def) return;
    this.flash = Math.max(0, this.flash - dt * 4);
    const flick = 0.93 + 0.045 * Math.sin(time * 11.3) + 0.025 * Math.sin(time * 27.1 + 1.3);
    this.key.position.set(player.x + 0.8, player.y + 6.2, player.z + 2.2);
    this.key.target.position.set(player.x, player.y, player.z - 0.4);
    this.key.intensity = def.lantern[1] * CAVE_TUNE.key * flick * this.lanternScale;
    this.fill.position.set(player.x + 0.35, player.y + 1.25, player.z + 0.45);
    this.fill.intensity = def.lantern[1] * CAVE_TUNE.fill * flick * this.lanternScale;
    this.bounce.position.set(player.x, player.y + 5.5, player.z + 0.5);
    this.bounce.intensity = def.lantern[1] * CAVE_TUNE.bounce * this.lanternScale;
    this.rim.position.set(player.x - 0.3, player.y + 1.9, player.z - 1.1);
    this.rim.intensity = (def.id === 'lava' ? 5.5 : 4) * this.lanternScale;
    for (const a of this.accents) {
      const s = a.spec;
      if (!s) continue;
      const f = s.flicker ? 1 - s.flicker * 0.25 + s.flicker * 0.15 * Math.sin(time * 9 + a.seed) + s.flicker * 0.1 * Math.sin(time * 23 + a.seed * 3) : 0.9 + 0.1 * Math.sin(time * 1.3 + a.seed);
      a.light.intensity = s.intensity * f * CAVE_TUNE.accent;
    }
    this.key.updateMatrixWorld();
    this.key.target.updateMatrixWorld();
  }

  /** Re-apply cave values after DayNight wrote the outdoor ones (runs inside render()). */
  private apply(): void {
    const def = this.def;
    if (!def) return;
    const dn = this.game.lighting;
    const rc = this.game.rc;
    dn.sun.intensity = 0;
    dn.bounce.intensity = 0;
    dn.hemi.color.setHex(def.hemi[0]);
    dn.hemi.groundColor.setHex(def.hemi[1]);
    dn.hemi.intensity = def.hemi[2] * CAVE_TUNE.hemi;
    dn.fog.color.copy(this.fog);
    dn.fog.near = rc.rig.distance * 0.95;
    dn.fog.far = rc.rig.distance * 2.1;
    (rc.scene.background as THREE.Color).copy(this.fog);
    rc.renderer.toneMappingExposure = def.exposure * CAVE_TUNE.exposure * (1 + this.flash * 0.6);
    rc.scene.environmentIntensity = 0.12;
    const g = rc.post.grade.uniforms;
    (g.uLift!.value as THREE.Vector3).set(...def.lift);
    (g.uGain!.value as THREE.Vector3).set(...def.gain);
    g.uSaturation!.value = def.sat;
    g.uContrast!.value = def.contrast;
    g.uVignette!.value = def.vignette;
    rc.post.setBloom(def.bloom[0], def.bloom[1]);
    globalUniforms.uSnow.value = 0;
    globalUniforms.uWet.value = 0;
    globalUniforms.uCloudShadow.value = 0;
    globalUniforms.uRim.value = 0.25;
    globalUniforms.uSunColor.value.setHex(def.lantern[0]).multiplyScalar(0.35);
    globalUniforms.uSunDir.value.set(0.2, 0.9, 0.4).normalize();
    globalUniforms.uLamps.value = 1;
    for (const n of nightGlow) n.material.emissiveIntensity = n.max;
  }

  dispose(): void {
    this.deactivate();
    this.key.shadow.map?.dispose();
  }
}
