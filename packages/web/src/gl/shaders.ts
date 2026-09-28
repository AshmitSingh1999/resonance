/**
 * The backdrop shader.
 *
 * One program with a family branch rather than five programs: the whole thing is
 * a single fullscreen quad, so the branch costs almost nothing, and it keeps the
 * palette and audio uniforms defined in exactly one place.
 *
 * Everything here stays low-contrast on purpose. The backdrop exists to give the
 * type somewhere to sit, and anything assertive would compete with the lyrics.
 */

export const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = `
precision mediump float;

varying vec2 vUv;

uniform float uTime;
uniform vec2  uResolution;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uOnset;      // decays after a beat rather than being a hard flag
uniform float uIntensity;
uniform int   uField;      // 0 waves, 1 rings, 2 streaks, 3 flow, 4 scan
uniform float uIsLight;    // 1.0 when the scheme puts dark ink on a light ground
uniform vec3  uBackground;
uniform vec3  uAccent;

// Cheap value noise. Good enough for a soft field, and far cheaper than a
// gradient noise at fullscreen on an integrated GPU.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    total += noise(p) * amplitude;
    p *= 2.0;
    amplitude *= 0.5;
  }
  return total;
}

void main() {
  vec2 uv = vUv;
  // Correct for aspect so circular forms stay circular on a wide display.
  vec2 p = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float radius = length(p);
  float field = 0.0;

  if (uField == 0) {
    // Serene: slow horizontal swells, barely moving.
    field = fbm(vec2(uv.x * 2.0, uv.y * 2.0 - uTime * 0.03)) * 0.6;
    field += (1.0 - smoothstep(0.0, 0.9, radius)) * (0.12 + uBass * 0.25);
  } else if (uField == 1) {
    // Pulse: a ring that expands on each beat.
    float ring = abs(radius - fract(uTime * 0.35) * 1.2);
    field = smoothstep(0.16, 0.0, ring) * uOnset * 0.8;
    field += (1.0 - smoothstep(0.0, 1.1, radius)) * (0.08 + uBass * 0.5);
  } else if (uField == 2) {
    // Cascade: vertical streaks, drifting downward.
    float columns = floor(uv.x * 26.0);
    float speed = 0.25 + hash(vec2(columns, 0.0)) * 0.5;
    float streak = fract(uv.y + uTime * speed * 0.18 + hash(vec2(columns, 1.0)));
    field = smoothstep(0.82, 1.0, streak) * (0.18 + uMid * 0.45);
  } else if (uField == 3) {
    // Drift: a slow flowing field with no fixed centre.
    vec2 q = vec2(fbm(p * 1.4 + uTime * 0.018), fbm(p * 1.4 - uTime * 0.014));
    field = fbm(p * 1.8 + q * 1.6) * (0.5 + uBass * 0.35);
  } else {
    // Fracture: horizontal bands that tear on transients.
    float band = floor(uv.y * 44.0);
    float jitter = (hash(vec2(band, floor(uTime * 14.0))) - 0.5) * uOnset * 0.5;
    float scan = step(0.5, fract(uv.y * 44.0 + jitter));
    field = scan * (0.06 + uTreble * 0.4) + uOnset * 0.14;
  }

  field *= uIntensity;

  // Mix toward the accent so the backdrop belongs to the same palette as the
  // type, then keep it well clear of the text in contrast.
  vec3 colour = mix(uBackground, uAccent, clamp(field, 0.0, 1.0) * 0.32);

  // Vignette pulls the eye to the centre, where the active line sits. On a light
  // ground it must lighten rather than darken: multiplying down would ring the
  // page in grey and turn the whole backdrop to mud.
  float edge = smoothstep(0.45, 1.25, radius);
  vec3 darkened = colour * (1.0 - edge * 0.55);
  vec3 lightened = mix(colour, vec3(1.0), edge * 0.5);
  colour = mix(darkened, lightened, uIsLight);

  gl_FragColor = vec4(colour, 1.0);
}
`;

/**
 * Shader branch for each backdrop.
 *
 * Keyed on the backdrop rather than the family, so the field behind the lyrics
 * can be chosen independently of the typography. `none` has no branch — the
 * canvas is not mounted at all in that case.
 */
export const BACKDROP_INDEX: Record<string, number> = {
  waves: 0,
  rings: 1,
  streaks: 2,
  flow: 3,
  scan: 4,
};
