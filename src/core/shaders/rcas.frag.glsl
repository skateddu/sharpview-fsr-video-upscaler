// FSR 1 RCAS (Robust Contrast Adaptive Sharpening).
// Port of the fp32 path of ffx_fsr1.h (AMD, MIT license, see THIRD_PARTY_NOTICES.md).
// Works 1:1: u_tex has the same size as the output.

uniform sampler2D u_tex;
uniform float u_sharpness;  // 0..1: 1.0 = maximum sharpening (exp2(-stops) in the AMD original)
uniform bool u_denoise;     // less sharpening on noise (useful on compressed video)

#define FSR_RCAS_LIMIT (0.25 - (1.0 / 16.0))

vec3 fetch(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(u_outSize) - 1);
  // RCAS produces NaN with negative input: clamp to [0, 1].
  return clamp(texelFetch(u_tex, p, 0).rgb, 0.0, 1.0);
}

void main() {
  vec2 p = outPos();
  if (splitCompare(p)) return;
  ivec2 sp = ivec2(p);

  //    b
  //  d e f
  //    h
  vec3 b = fetch(sp + ivec2( 0, -1));
  vec3 d = fetch(sp + ivec2(-1,  0));
  vec3 e = fetch(sp);
  vec3 f = fetch(sp + ivec2( 1,  0));
  vec3 h = fetch(sp + ivec2( 0,  1));

  vec3 mn4 = min(min(b, d), min(f, h));
  vec3 mx4 = max(max(b, d), max(f, h));

  // Largest lobe that keeps the result within [0, 1].
  vec2 peakC = vec2(1.0, -4.0);
  vec3 hitMin = min(mn4, e) / max(4.0 * mx4, 1.0e-5);
  vec3 hitMax = (peakC.x - max(mx4, e)) / min(4.0 * mn4 + peakC.y, -1.0e-5);
  vec3 lobeRGB = max(-hitMin, hitMax);
  float lobe = max(-FSR_RCAS_LIMIT, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * u_sharpness;

  if (u_denoise) {
    float bL = luma(b), dL = luma(d), eL = luma(e), fL = luma(f), hL = luma(h);
    float nz = 0.25 * bL + 0.25 * dL + 0.25 * fL + 0.25 * hL - eL;
    float range = max(max(max(bL, dL), max(eL, fL)), hL) - min(min(min(bL, dL), min(eL, fL)), hL);
    nz = clamp(abs(nz) / max(range, 1.0e-5), 0.0, 1.0);
    lobe *= -0.5 * nz + 1.0;
  }

  vec3 c = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
  fragColor = vec4(c, 1.0);
}
