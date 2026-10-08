// FSR 1 EASU (Edge Adaptive Spatial Upsampling).
// Port of the fp32 path of ffx_fsr1.h (AMD, MIT license, see THIRD_PARTY_NOTICES.md),
// using texelFetch instead of textureGather, which WebGL2 lacks.

uniform vec2 u_inSize;    // source size in pixels

vec3 fetch(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(u_inSize) - 1);
  return clamp(texelFetch(u_src, p, 0).rgb, 0.0, 1.0);
}

// Replaces the APrxLoRcp approximations; the max avoids 0 * inf = NaN on flat areas.
float rcpSafe(float x) {
  return 1.0 / max(x, 1.0e-8);
}

// Accumulates edge direction and length for one of the 4 center texels.
// lA up, lB left, lC center, lD right, lE down; w bilinear weight.
void easuSet(inout vec2 dir, inout float len, float w,
             float lA, float lB, float lC, float lD, float lE) {
  float dc = lD - lC;
  float cb = lC - lB;
  float lenX = rcpSafe(max(abs(dc), abs(cb)));
  float dirX = lD - lB;
  dir.x += dirX * w;
  lenX = clamp(abs(dirX) * lenX, 0.0, 1.0);
  lenX *= lenX;
  len += lenX * w;

  float ec = lE - lC;
  float ca = lC - lA;
  float lenY = rcpSafe(max(abs(ec), abs(ca)));
  float dirY = lE - lA;
  dir.y += dirY * w;
  lenY = clamp(abs(dirY) * lenY, 0.0, 1.0);
  lenY *= lenY;
  len += lenY * w;
}

// One tap of the approximate Lanczos-2 filter, rotated and stretched along the edge.
void easuTap(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len2,
             float lob, float clp, vec3 c) {
  vec2 v = vec2(off.x * dir.x + off.y * dir.y, off.x * -dir.y + off.y * dir.x);
  v *= len2;
  float d2 = min(dot(v, v), clp);
  float wB = 2.0 / 5.0 * d2 - 1.0;
  float wA = lob * d2 - 1.0;
  wB *= wB;
  wA *= wA;
  wB = 25.0 / 16.0 * wB - (25.0 / 16.0 - 1.0);
  float w = wB * wA;
  aC += c * w;
  aW += w;
}

void main() {
  vec2 p = outPos();
  if (splitCompare(p)) return;

  vec2 pp = p * (u_inSize / u_outSize) - 0.5;
  vec2 fp = floor(pp);
  pp -= fp;
  ivec2 o = ivec2(fp);

  // 12-tap footprint:
  //    b c
  //  e f g h
  //  i j k l
  //    n o
  vec3 bC = fetch(o + ivec2( 0, -1));
  vec3 cC = fetch(o + ivec2( 1, -1));
  vec3 eC = fetch(o + ivec2(-1,  0));
  vec3 fC = fetch(o + ivec2( 0,  0));
  vec3 gC = fetch(o + ivec2( 1,  0));
  vec3 hC = fetch(o + ivec2( 2,  0));
  vec3 iC = fetch(o + ivec2(-1,  1));
  vec3 jC = fetch(o + ivec2( 0,  1));
  vec3 kC = fetch(o + ivec2( 1,  1));
  vec3 lC = fetch(o + ivec2( 2,  1));
  vec3 nC = fetch(o + ivec2( 0,  2));
  vec3 oC = fetch(o + ivec2( 1,  2));

  float bL = luma(bC), cL = luma(cC), eL = luma(eC), fL = luma(fC);
  float gL = luma(gC), hL = luma(hC), iL = luma(iC), jL = luma(jC);
  float kL = luma(kC), lL = luma(lC), nL = luma(nC), oL = luma(oC);

  vec2 dir = vec2(0.0);
  float len = 0.0;
  easuSet(dir, len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
  easuSet(dir, len, pp.x * (1.0 - pp.y),         cL, fL, gL, hL, kL);
  easuSet(dir, len, (1.0 - pp.x) * pp.y,         fL, iL, jL, kL, nL);
  easuSet(dir, len, pp.x * pp.y,                 gL, jL, kL, lL, oL);

  // Normalize the direction; with no gradient use (1, 0).
  vec2 dir2 = dir * dir;
  float dirR = dir2.x + dir2.y;
  bool zro = dirR < 1.0 / 32768.0;
  dirR = zro ? 1.0 : inversesqrt(dirR);
  dir.x = zro ? 1.0 : dir.x;
  dir *= dirR;

  // Kernel shape: more stretched, with a smaller negative lobe, on sharp edges.
  len = len * 0.5;
  len *= len;
  float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
  vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
  float lob = 0.5 + ((1.0 / 4.0 - 0.04) - 0.5) * len;
  float clp = 1.0 / lob;

  vec3 aC = vec3(0.0);
  float aW = 0.0;
  easuTap(aC, aW, vec2( 0.0, -1.0) - pp, dir, len2, lob, clp, bC);
  easuTap(aC, aW, vec2( 1.0, -1.0) - pp, dir, len2, lob, clp, cC);
  easuTap(aC, aW, vec2(-1.0,  1.0) - pp, dir, len2, lob, clp, iC);
  easuTap(aC, aW, vec2( 0.0,  1.0) - pp, dir, len2, lob, clp, jC);
  easuTap(aC, aW, vec2( 0.0,  0.0) - pp, dir, len2, lob, clp, fC);
  easuTap(aC, aW, vec2(-1.0,  0.0) - pp, dir, len2, lob, clp, eC);
  easuTap(aC, aW, vec2( 1.0,  1.0) - pp, dir, len2, lob, clp, kC);
  easuTap(aC, aW, vec2( 2.0,  1.0) - pp, dir, len2, lob, clp, lC);
  easuTap(aC, aW, vec2( 2.0,  0.0) - pp, dir, len2, lob, clp, hC);
  easuTap(aC, aW, vec2( 1.0,  0.0) - pp, dir, len2, lob, clp, gC);
  easuTap(aC, aW, vec2( 1.0,  2.0) - pp, dir, len2, lob, clp, oC);
  easuTap(aC, aW, vec2( 0.0,  2.0) - pp, dir, len2, lob, clp, nC);

  // Deringing: clamp to the range of the 4 nearest texels.
  vec3 mn = min(min(fC, gC), min(jC, kC));
  vec3 mx = max(max(fC, gC), max(jC, kC));
  fragColor = vec4(clamp(aC / aW, mn, mx), 1.0);
}
