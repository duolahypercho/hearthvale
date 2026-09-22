/**
 * Global shader uniforms shared (by reference) across every patched material.
 * Updated once per frame by the renderer / lighting rig. Any material can
 * pull them in via onBeforeCompile: `shader.uniforms.uTime = globalUniforms.uTime`.
 */
import * as THREE from 'three';

export const globalUniforms = {
  /** Seconds since start (render time, keeps running while sim paused). */
  uTime: { value: 0 },
  /** 0 calm .. 1 normal .. 2.5 storm. */
  uWindStrength: { value: 1 },
  /** Normalized XZ wind direction. */
  uWindDir: { value: new THREE.Vector2(0.8, 0.35).normalize() },
  /** 0 = full day .. 1 = full night. */
  uNight: { value: 0 },
  /** 0..1 amount of snow cover on up-facing surfaces. */
  uSnow: { value: 0 },
  /** 0..1 how wet surfaces are (rain darkens + adds gloss). */
  uWet: { value: 0 },
  /** Player world position (grass pushes away from it). */
  uPlayerPos: { value: new THREE.Vector3(0, -100, 0) },
  /** Seasonal palette (linear colors). */
  uGrassA: { value: new THREE.Color() },
  uGrassB: { value: new THREE.Color() },
  uGrassTip: { value: new THREE.Color() },
  uGrassDry: { value: new THREE.Color() },
  /** Sun direction (towards sun) + color, for custom shaders (water, particles). */
  uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uSkyColor: { value: new THREE.Color(0.6, 0.75, 1) },
  uHorizonColor: { value: new THREE.Color(0.9, 0.9, 1) },
  /** Moving cloud-shadow strength (0 none .. 1 strong). */
  uCloudShadow: { value: 0.35 },
};

export type GlobalUniforms = typeof globalUniforms;
