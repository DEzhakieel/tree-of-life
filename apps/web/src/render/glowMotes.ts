import * as THREE from 'three';

/**
 * Instanced gaussian motes: one camera-facing quad per record, shaded with a
 * radial gaussian (hot core + wide skirt) and drawn additively so neighbours
 * melt into continuous glowing masses — the Lenia look. Quads live in world
 * space, so zoom is the camera's job and there is no gl_PointSize driver
 * limit to fight; additive overlaps feed the bloom pass for free.
 */
const VERT = /* glsl */ `
attribute vec3 aOffset;
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vUv = uv;
  vColor = aColor;
  vAlpha = aAlpha;
  vec3 p = aOffset + vec3(position.xy * aSize, 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uSharp;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d2 = dot(p, p);
  if (d2 > 1.0) discard;
  float g = exp(-d2 * uSharp * 3.0);
  float core = exp(-d2 * uSharp * 14.0);
  vec3 c = vColor * g + vec3(0.9, 0.95, 1.0) * core * 0.45;
  gl_FragColor = vec4(c, g * vAlpha);
}
`;

export class GlowMotes {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private maxCount: number;

  constructor(maxCount: number, sharpness = 1.5) {
    this.maxCount = maxCount;
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    const dyn = (n: number): THREE.InstancedBufferAttribute =>
      new THREE.InstancedBufferAttribute(new Float32Array(maxCount * n), n).setUsage(
        THREE.DynamicDrawUsage,
      );
    this.geo.setAttribute('aOffset', dyn(3));
    this.geo.setAttribute('aColor', dyn(3));
    this.geo.setAttribute('aSize', dyn(1));
    this.geo.setAttribute('aAlpha', dyn(1));
    this.geo.instanceCount = 0;

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uSharp: { value: sharpness } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    // drawn after the opaque/early transparent passes so the glow always sits
    // on top of terrain and lattice heatmaps
    this.mesh.renderOrder = 5;
  }

  get max(): number {
    return this.maxCount;
  }

  attr(name: 'aOffset' | 'aColor' | 'aSize' | 'aAlpha'): THREE.InstancedBufferAttribute {
    return this.geo.getAttribute(name) as THREE.InstancedBufferAttribute;
  }

  commit(count: number): void {
    this.geo.instanceCount = Math.min(count, this.maxCount);
    (this.geo.getAttribute('aOffset') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Gaussian tightness: low = soft Lenia blob, high = crisp marker. */
  setSharpness(v: number): void {
    this.mat.uniforms.uSharp!.value = v;
  }

  setVisible(v: boolean): void {
    this.mesh.visible = v;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
