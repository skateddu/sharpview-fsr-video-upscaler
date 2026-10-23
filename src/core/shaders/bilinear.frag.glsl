// Reference: plain bilinear sampling of the source.
void main() {
  vec2 p = outPos();
  if (splitCompare(p)) return;
  fragColor = vec4(dither(texture(u_in, p / u_outSize).rgb), 1.0);
}
