/**
 * Terrain GLSL shaders (WebGL2 / GLSL ES 3.00).
 *
 * The escape-time math here is intentionally identical to the JS sampler in
 * apps/simulation/src/terrain.ts, so rendered terrain and simulated biology
 * agree. Perturbation-theory rendering (deep zoom, 10^12+) uses a reference
 * orbit computed on the CPU in double precision and read from a texture.
 */

export const TERRAIN_VERT = /* glsl */ `
precision highp float;
precision highp int;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;

in vec3 position;
in vec2 uv;

out vec2 vWorldPos;
out vec2 vUv;

void main() {
  // Tiled terrain: convert local position to world (complex-plane) coords.
  vec4 world = modelMatrix * vec4(position.xy, 0.0, 1.0);
  vWorldPos = world.xy;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const TERRAIN_FRAG = /* glsl */ `
precision highp float;
precision highp int;

in vec2 vWorldPos;
in vec2 vUv;
out vec4 fragColor;

uniform float uCenterX;
uniform float uCenterY;
uniform float uScale;          // complex width of the full viewport
uniform int   uMaxIter;
uniform float uEscapeRadius;
uniform int   uFractalType;    // 0 mandelbrot, 1 julia, 2 perlin
uniform float uCReal;          // julia seed
uniform float uCImag;
uniform int   uPerlinSeed;

uniform int   uLayerMode;      // 0 base, 1 height, 2 energy, 3 moisture, 4 hazard
uniform float uLayerMix;

// perturbation (deep zoom)
uniform int   uPerturb;        // 0 = direct, 1 = perturbed reference orbit
uniform sampler2D uReference;  // RG float texture: reference orbit z_n
uniform int   uRefCount;
uniform float uRefEsc;         // squared magnitude at which the reference is considered escaped

const float TAU = 6.28318530718;

float smoothNu(vec2 p) {
  int type = uFractalType;
  vec2 z = (type == 1) ? p : vec2(0.0, 0.0);
  vec2 c = (type == 1) ? vec2(uCReal, uCImag) : p;
  float B2 = uEscapeRadius * uEscapeRadius;
  float it = 0.0;
  float zre2 = z.x * z.x;
  float zim2 = z.y * z.y;
  for (int i = 0; i < 4096; i++) {
    if (i >= uMaxIter) break;
    if (zre2 + zim2 >= B2) break;
    float nx = zre2 - zim2 + c.x;
    float ny = 2.0 * z.x * z.y + c.y;
    z = vec2(nx, ny);
    zre2 = z.x * z.x;
    zim2 = z.y * z.y;
    it += 1.0;
  }
  float mag2 = zre2 + zim2;
  if (it >= float(uMaxIter) || mag2 <= 1.0) return float(uMaxIter);
  float nu = it + 1.0 - log2(log(mag2) / log(uEscapeRadius));
  return clamp(nu, 0.0, float(uMaxIter));
}

// Perlin / value-noise fbm (integer hash — matches apps/simulation terrain.ts)
float hash2i(int x, int y, int seed) {
  int h = seed ^ (x * 0x27d4eb2d) ^ (y * 0x165667b1);
  h = (h ^ (h >> 13)) * 0x5bd1e995;
  h = h ^ (h >> 16);
  return float(h & 0x7fffffff) * (2.0 / 2147483647.0) - 1.0;
}

float smoothstep01(float t) { return t * t * (3.0 - 2.0 * t); }

float noiseAt(float x, float y) {
  int ix = int(floor(x));
  int iy = int(floor(y));
  float fx = x - floor(x);
  float fy = y - floor(y);
  float ux = smoothstep01(fx);
  float uy = smoothstep01(fy);
  float a = hash2i(ix, iy, uPerlinSeed);
  float b = hash2i(ix + 1, iy, uPerlinSeed);
  float c = hash2i(ix, iy + 1, uPerlinSeed);
  float d = hash2i(ix + 1, iy + 1, uPerlinSeed);
  float ab = a + (b - a) * ux;
  float cd = c + (d - c) * ux;
  return ab + (cd - ab) * uy;
}

float fbm(float x, float y) {
  float amp = 1.0;
  float freq = 1.0;
  float sum = 0.0;
  float norm = 0.0;
  for (int o = 0; o < 4; o++) {
    sum += amp * noiseAt(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// Perturbation theory: z = reference + delta, iterated in float32. The
// reference is the orbit of the viewport centre (CPU, double precision).
// ---------------------------------------------------------------------------

float perturbedNu(vec2 p) {
  vec2 center = vec2(uCenterX, uCenterY);
  vec2 dc = p - center;            // delta c (mandelbrot) or delta z0 (julia)
  vec2 d = dc;
  float B2 = uEscapeRadius * uEscapeRadius;
  float it = 0.0;
  for (int i = 0; i < 4096; i++) {
    if (i >= uMaxIter) break;
    vec2 ref = texture(uReference, vec2(float(i) / float(uRefCount), 0.25)).xy;
    if (i == 0) {
      // mag2 of first iterate uses d alone (ref is c or z0)
      if (dot(d, d) >= B2) break;
    }
    d = 2.0 * ref * d + d * d + dc;
    vec2 z = ref + d;
    float mag2 = dot(z, z);
    if (mag2 >= B2) {
      it = float(i) + 1.0;
      float nu = it + 1.0 - log2(log(mag2) / log(uEscapeRadius));
      return clamp(nu, 0.0, float(uMaxIter));
    }
    it += 1.0;
  }
  return float(uMaxIter);
}

// ---------------------------------------------------------------------------
// Biological layers derived from the escape-time field
// ---------------------------------------------------------------------------

struct Layers {
  float height;
  float energy;
  float moisture;
  float hazard;
};

Layers computeLayers(float nu) {
  Layers L;
  float maxIter = float(uMaxIter);
  L.height = nu / maxIter;
  // stability of escape phase -> photosynthesis zones
  L.energy = 0.5 + 0.5 * cos(nu * TAU);
  // derivative proxy: rate of change of nu between adjacent passes
  L.moisture = fract(nu) < 0.5 ? 0.3 : 0.7;
  L.hazard = (nu / maxIter) * (1.0 - L.energy);
  return L;
}

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

vec3 paletteBase(float t) {
  vec3 c0 = vec3(0.011, 0.008, 0.157);
  vec3 c1 = vec3(0.149, 0.027, 0.475);
  vec3 c2 = vec3(0.647, 0.075, 0.404);
  vec3 c3 = vec3(0.976, 0.541, 0.251);
  vec3 c4 = vec3(0.988, 0.867, 0.560);
  vec3 c5 = vec3(0.996, 0.988, 0.937);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.5) / 0.25);
  if (t < 0.95) return mix(c3, c4, (t - 0.75) / 0.2);
  return mix(c4, c5, (t - 0.95) / 0.05);
}

vec3 paletteHeight(float t) {
  vec3 deep = vec3(0.06, 0.16, 0.30);
  vec3 low = vec3(0.25, 0.42, 0.24);
  vec3 mid = vec3(0.62, 0.53, 0.34);
  vec3 rock = vec3(0.55, 0.5, 0.47);
  vec3 snow = vec3(0.95, 0.97, 1.0);
  if (t < 0.35) return mix(deep, low, t / 0.35);
  if (t < 0.65) return mix(low, mid, (t - 0.35) / 0.3);
  if (t < 0.85) return mix(mid, rock, (t - 0.65) / 0.2);
  return mix(rock, snow, (t - 0.85) / 0.15);
}

vec3 paletteEnergy(float t) {
  vec3 barren = vec3(0.10, 0.09, 0.05);
  vec3 low = vec3(0.13, 0.33, 0.13);
  vec3 lush = vec3(0.20, 0.75, 0.20);
  vec3 hot = vec3(0.92, 0.85, 0.25);
  if (t < 0.4) return mix(barren, low, t / 0.4);
  if (t < 0.8) return mix(low, lush, (t - 0.4) / 0.4);
  return mix(lush, hot, (t - 0.8) / 0.2);
}

vec3 paletteMoisture(float t) {
  vec3 dry = vec3(0.42, 0.30, 0.16);
  vec3 damp = vec3(0.25, 0.45, 0.5);
  vec3 wet = vec3(0.08, 0.25, 0.75);
  vec3 flood = vec3(0.02, 0.6, 0.98);
  if (t < 0.33) return mix(dry, damp, t / 0.33);
  if (t < 0.66) return mix(damp, wet, (t - 0.33) / 0.33);
  return mix(wet, flood, (t - 0.66) / 0.34);
}

vec3 paletteHazard(float t) {
  vec3 safe = vec3(0.2, 0.4, 0.22);
  vec3 warn = vec3(0.9, 0.6, 0.15);
  vec3 lethal = vec3(0.78, 0.05, 0.08);
  vec3 dead = vec3(0.05, 0.0, 0.08);
  if (t < 0.5) return mix(safe, warn, t / 0.5);
  if (t < 0.85) return mix(warn, lethal, (t - 0.5) / 0.35);
  return mix(lethal, dead, (t - 0.85) / 0.15);
}

void main() {
  float nu;
  if (uPerturb == 1) {
    nu = perturbedNu(vWorldPos);
  } else {
    nu = smoothNu(vWorldPos);
  }
  Layers L = computeLayers(nu);
  float t = sqrt(clamp(nu / float(uMaxIter), 0.0, 1.0));
  vec3 base = paletteBase(t);
  vec3 layerColor = base;
  if (uLayerMode == 1) layerColor = paletteHeight(L.height);
  else if (uLayerMode == 2) layerColor = paletteEnergy(L.energy);
  else if (uLayerMode == 3) layerColor = paletteMoisture(L.moisture);
  else if (uLayerMode == 4) layerColor = paletteHazard(L.hazard);
  vec3 color = mix(base, layerColor, uLayerMix);
  fragColor = vec4(color, 1.0);
}
`;

/**
 * Compute a double-precision reference orbit for the perturbation renderer.
 * z0/c depend on fractal type; returns { values, count, escaped }.
 */
export function computeReferenceOrbit(opts: {
  centerX: number;
  centerY: number;
  cReal: number;
  cImag: number;
  maxIter: number;
  escapeRadius: number;
  fractalType: 'mandelbrot' | 'julia' | 'perlin';
}): { data: Float32Array; count: number } {
  const { centerX, centerY, cReal, cImag, maxIter, escapeRadius, fractalType } = opts;
  const isJulia = fractalType === 'julia';
  let zre = isJulia ? centerX : 0;
  let zim = isJulia ? centerY : 0;
  const cre = isJulia ? cReal : centerX;
  const cim = isJulia ? cImag : centerY;
  const B2 = escapeRadius * escapeRadius;
  const data = new Float32Array(maxIter * 4);
  let count = 0;
  let zre2 = zre * zre;
  let zim2 = zim * zim;
  for (let i = 0; i < maxIter; i++) {
    data[i * 4] = zre;
    data[i * 4 + 1] = zim;
    count = i + 1;
    if (zre2 + zim2 >= B2) break;
    const nx = zre2 - zim2 + cre;
    const ny = 2 * zre * zim + cim;
    zre = nx;
    zim = ny;
    zre2 = zre * zre;
    zim2 = zim * zim;
  }
  return { data, count };
}

/** Perlin integer hash — MUST stay in lockstep with apps/simulation terrain.ts */
export function hash2i(x: number, y: number, seed: number): number {
  let h = ((seed | 0) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h >>> 0;
}
