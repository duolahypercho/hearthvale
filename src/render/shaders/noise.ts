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
// Soft moving cloud shadows, 1 = lit, lower = shadowed.
float hvCloudShadow(vec2 wp, float t, float strength) {
  vec2 q = wp * 0.028 + vec2(t * 0.012, t * 0.006);
  float n = hvFbm(q);
  float c = smoothstep(0.52, 0.72, n);
  return 1.0 - c * strength;
}
#endif
`;
