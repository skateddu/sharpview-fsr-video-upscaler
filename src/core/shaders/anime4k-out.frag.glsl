// Last step of Anime4K: scales its result to the output with bilinear filtering (as
// AutoDownscalePre does in mpv) and applies the clamp of Clamp_Highlights, which mpv runs
// just before this scaling: no pixel brighter than the brightest one around it in the source.

uniform sampler2D u_stats;  // STATSMAX: highest luma in a 5×5 window of the source
uniform bool u_clamp;       // u_stats is available

void main() {
  vec2 p = outPos();
  if (splitCompare(p)) return;
  vec2 uv = p / u_outSize;
  vec3 c = texture(u_in, uv).rgb;
  if (u_clamp) {
    float l = dot(vec3(0.299, 0.587, 0.114), c);
    c -= max(l - texture(u_stats, uv).x, 0.0);
  }
  fragColor = vec4(dither(clamp(c, 0.0, 1.0)), 1.0);
}
