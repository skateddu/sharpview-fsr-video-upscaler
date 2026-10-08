// Shared by all fragment shaders (prepended by the renderer after #version/precision).

uniform vec2 u_outSize;    // render target size in pixels
uniform bool u_flipY;      // true when drawing to the canvas (origin at the bottom left)
uniform sampler2D u_src;   // source frame (LINEAR filtering for bilinear; texelFetch ignores it)
uniform float u_split;     // output x left of which plain bilinear is shown; < 0 disables

out vec4 fragColor;

// Output pixel position with y pointing down and centers at .5,
// the same convention as textures uploaded from <video>.
vec2 outPos() {
  vec2 p = gl_FragCoord.xy;
  if (u_flipY) p.y = u_outSize.y - p.y;
  return p;
}

// Approximate luma used by FSR1 (range 0..2).
float luma(vec3 c) {
  return c.b * 0.5 + (c.r * 0.5 + c.g);
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
