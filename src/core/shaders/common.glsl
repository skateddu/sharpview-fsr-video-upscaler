// Shared by all fragment shaders (prepended by the renderer after #version/precision).

uniform vec2 u_outSize;    // render target size in pixels
uniform bool u_flipY;      // true when drawing to the canvas (origin at the bottom left)
uniform sampler2D u_src;   // raw source frame, for the split comparison (LINEAR filtering)
uniform sampler2D u_in;    // input of this pass: source, debanded source or upscaled frame
uniform float u_split;     // output x left of which plain bilinear is shown; < 0 disables
uniform bool u_dither;     // last pass of a debanded frame: dither to the 8-bit output

out vec4 fragColor;

// Output pixel position, y down with centers at .5, like textures uploaded from <video>.
vec2 outPos() {
  vec2 p = gl_FragCoord.xy;
  if (u_flipY) p.y = u_outSize.y - p.y;
  return p;
}

// Approximate luma used by FSR1 (range 0..2).
float luma(vec3 c) {
  return c.b * 0.5 + (c.r * 0.5 + c.g);
}

// Up to half a level of noise before the 8-bit output, so gradients rebuilt by the deband do
// not turn back into steps (interleaved gradient noise: no visible pattern).
vec3 dither(vec3 c) {
  if (!u_dither) return c;
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  return c + (n - 0.5) / 255.0;
}

// If the pixel falls in the comparison area, writes its color and returns true.
bool splitCompare(vec2 p) {
  if (u_split < 0.0 || p.x > u_split + 1.0) return false;
  if (p.x > u_split - 1.0) {
    fragColor = vec4(1.0, 0.8, 0.2, 1.0);
    return true;
  }
  fragColor = vec4(texture(u_src, p / u_outSize).rgb, 1.0);
  return true;
}
