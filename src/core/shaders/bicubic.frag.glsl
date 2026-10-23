// Catmull-Rom bicubic sampling of the source, with 9 bilinear taps instead of 16 point taps.

uniform vec2 u_inSize;  // source size in pixels

void main() {
  vec2 p = outPos();
  if (splitCompare(p)) return;

  vec2 pos = p / u_outSize * u_inSize;
  vec2 t1 = floor(pos - 0.5) + 0.5;
  vec2 f = pos - t1;

  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  // The two middle taps merge into one bilinear fetch placed between them.
  vec2 w12 = w1 + w2;
  vec2 t12 = (t1 + w2 / w12) / u_inSize;
  vec2 t0 = (t1 - 1.0) / u_inSize;
  vec2 t3 = (t1 + 2.0) / u_inSize;

  vec3 c =
      (texture(u_in, vec2(t0.x, t0.y)).rgb * w0.x +
       texture(u_in, vec2(t12.x, t0.y)).rgb * w12.x +
       texture(u_in, vec2(t3.x, t0.y)).rgb * w3.x) * w0.y +
      (texture(u_in, vec2(t0.x, t12.y)).rgb * w0.x +
       texture(u_in, vec2(t12.x, t12.y)).rgb * w12.x +
       texture(u_in, vec2(t3.x, t12.y)).rgb * w3.x) * w12.y +
      (texture(u_in, vec2(t0.x, t3.y)).rgb * w0.x +
       texture(u_in, vec2(t12.x, t3.y)).rgb * w12.x +
       texture(u_in, vec2(t3.x, t3.y)).rgb * w3.x) * w3.y;
  // Catmull-Rom overshoots near edges: keep the result displayable.
  fragColor = vec4(dither(clamp(c, 0.0, 1.0)), 1.0);
}
