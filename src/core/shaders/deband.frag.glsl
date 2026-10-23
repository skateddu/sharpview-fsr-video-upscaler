/*
 * Deband, after mpv's deband (itself after flash3kyuu). Runs at the source resolution: each
 * iteration averages 4 samples at a random distance and direction, and keeps the average only
 * where it differs from the pixel by less than a threshold, so flat steps between bands blend
 * into a gradient while real edges stay as they are. The output needs more than 8 bits (or the
 * final dither) to keep the new in-between values.
 */

uniform vec2 u_inSize;  // source size in pixels

#define ITERATIONS 2
#define RANGE 16.0
// Maximum difference from the average, on the 0..1 scale: 3 of 255 levels.
#define THRESHOLD (3.0 / 255.0)

float rand(inout float h) {
  h = fract(h * 0.1031);
  h *= h + 33.33;
  h *= h + h;
  return fract(h);
}

vec3 sampleAt(vec2 p) {
  return texture(u_in, p / u_inSize).rgb;
}

void main() {
  vec2 p = outPos();
  vec3 c = texelFetch(u_in, ivec2(p), 0).rgb;
  // Fixed per pixel, so a still frame always gives the same result.
  float h = fract(dot(p, vec2(12.9898, 78.233)) * 0.3183099) * 4096.0 + 1.0;

  for (int i = 1; i <= ITERATIONS; i++) {
    float fi = float(i);
    float dist = rand(h) * RANGE * fi;
    float dir = rand(h) * 6.2831853;
    vec2 o = dist * vec2(cos(dir), sin(dir));
    vec3 avg = (sampleAt(p + o) + sampleAt(p + vec2(-o.y, o.x)) +
                sampleAt(p - o) + sampleAt(p + vec2(o.y, -o.x))) * 0.25;
    // Per channel: the average replaces the pixel only on near-flat areas.
    c = mix(avg, c, step(THRESHOLD / fi, abs(c - avg)));
  }
  fragColor = vec4(c, 1.0);
}
