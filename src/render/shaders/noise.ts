/** GLSL noise helpers, inject once per shader via `NOISE_GLSL`. Guarded against double inclusion. */
export const NOISE_GLSL = /* glsl */ `
#ifndef HV_NOISE
#define HV_NOISE
float hvHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hvHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float hvNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hvHash12(i);
  float b = hvHash12(i + vec2(1.0, 0.0));
  float c = hvHash12(i + vec2(0.0, 1.0));
  float d = hvHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float hvFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * hvNoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3;
    a *= 0.5;
  }
  return s / 0.9375;
}
// Rotate hue by \`a\` radians (Rodrigues around the grey axis), keeps luminance roughly.
vec3 hvHueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
// Large-scale (8–12 m) meadow variation: ±4° hue, ±6 % value, shared by terrain + grass.
vec3 hvMeadowVar(vec3 c, vec2 wp) {
  float h = hvFbm(wp * 0.095 + 41.0) - 0.5;
  float v = hvFbm(wp * 0.11 + 83.0) - 0.5;
  return hvHueShift(c, h * 0.28) * (1.0 + v * 0.24);
}
// Patchy 3-tone lawn mottling (2-5 m blobs): cool-dark / base / warm-light, ±12 % value, ±7° hue.
// Shared by terrain + grass so blades and ground agree. Returns the tone (-1..1) via \`tone\`.
vec3 hvMottle(vec3 c, vec2 wp, out float tone) {
  vec2 q = mat2(0.8, 0.6, -0.6, 0.8) * wp;
  float m = hvFbm(q * 0.27 + 61.0) * 0.75 + hvNoise(q * 0.9 + 13.0) * 0.25;
  tone = smoothstep(0.52, 0.64, m) - smoothstep(0.42, 0.3, m);
  vec3 warm = hvHueShift(c, -0.12) * 1.12;
  vec3 cool = hvHueShift(c, 0.1) * 0.88;
  return tone > 0.0 ? mix(c, warm, tone) : mix(c, cool, -tone);
}
vec3 hvMottle(vec3 c, vec2 wp) { float t; return hvMottle(c, wp, t); }
// Soft moving cloud shadows, 1 = lit, lower = shadowed.
float hvCloudShadow(vec2 wp, float t, float strength) {
  // Night / interiors / mines run with strength 0: skip the 4-octave fbm (uniform branch).
  if (strength < 0.001) return 1.0;
  vec2 q = wp * 0.028 + vec2(t * 0.012, t * 0.006);
  float n = hvFbm(q);
  float c = smoothstep(0.52, 0.72, n);
  return 1.0 - c * strength;
}
#endif
`;
