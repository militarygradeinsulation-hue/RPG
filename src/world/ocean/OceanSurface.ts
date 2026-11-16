import * as THREE from 'three';
import { groundHeightAt, WATER_LEVEL } from '../TerrainHeightfield';
import { OCEAN_WAVE_SPECTRUM } from './OceanWaveSampler';

/**
 * High-detail radial-biased ocean surface grid following the player/ship cleanly
 * with shared 4-octave Gerstner waves, Beer-Lambert depth absorption, shoreline/crest foam,
 * and Fresnel lunar/solar reflection glints.
 */
export class OceanSurface {
  public readonly mesh: THREE.Mesh;
  public readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.BufferGeometry;
  private readonly gridSize = 480;
  private readonly segs = 128;
  private lastSnapX = 99999;
  private lastSnapZ = 99999;

  public readonly uniforms = {
    uTime: { value: 0 },
    uSwellScale: { value: 1.0 },
    uOriginOffset: { value: new THREE.Vector2(0, 0) },
    uLightDir: { value: new THREE.Vector3(0.48, 0.56, 0.45).normalize() },
    uLightColor: { value: new THREE.Color(0xb8d4ff) },
    uSkyHorizon: { value: new THREE.Color(0x16243d) },
    uSkyZenith: { value: new THREE.Color(0x060c1c) },
    uShallowColor: { value: new THREE.Color(0x146c78) },
    uDeepColor: { value: new THREE.Color(0x05182e) },
    uFogColor: { value: new THREE.Color(0x0e182b) },
    uFogDensity: { value: 0.0052 },
    uIsNight: { value: 1.0 },
    uIsUnderwater: { value: 0.0 },
  };

  constructor() {
    this.geometry = new THREE.PlaneGeometry(this.gridSize, this.gridSize, this.segs, this.segs);
    this.geometry.rotateX(-Math.PI / 2);

    const vCount = this.geometry.attributes.position.count;
    this.geometry.setAttribute('aWaterDepth', new THREE.BufferAttribute(new Float32Array(vCount), 1));

    const w0 = OCEAN_WAVE_SPECTRUM[0];
    const w1 = OCEAN_WAVE_SPECTRUM[1];
    const w2 = OCEAN_WAVE_SPECTRUM[2];
    const w3 = OCEAN_WAVE_SPECTRUM[3];

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: true,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uSwellScale;
        uniform vec2 uOriginOffset;
        attribute float aWaterDepth;

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vDepth;
        varying float vCrestFoam;

        void evalWave(vec2 wp, vec2 dir, float amp, float wl, float spd, float damp, inout float h, inout vec2 grad, inout float crest) {
          float k = 6.2831853 / wl;
          float a = amp * uSwellScale * damp;
          float phase = k * dot(dir, wp) - spd * uTime;
          float s = sin(phase);
          float c = cos(phase);
          h += s * a;
          grad += dir * (k * a * c);
          crest += max(0.0, s);
        }

        void main() {
          vec4 worldBase = modelMatrix * vec4(position, 1.0);
          vec2 wp = worldBase.xz + uOriginOffset;
          float damp = clamp(aWaterDepth / 2.6, 0.14, 1.0);

          float h = 0.0;
          vec2 grad = vec2(0.0);
          float crest = 0.0;

          evalWave(wp, vec2(${w0.dx.toFixed(3)}, ${w0.dz.toFixed(3)}), ${w0.amplitude.toFixed(3)}, ${w0.wavelength.toFixed(2)}, ${w0.speed.toFixed(2)}, damp, h, grad, crest);
          evalWave(wp, vec2(${w1.dx.toFixed(3)}, ${w1.dz.toFixed(3)}), ${w1.amplitude.toFixed(3)}, ${w1.wavelength.toFixed(2)}, ${w1.speed.toFixed(2)}, damp, h, grad, crest);
          evalWave(wp, vec2(${w2.dx.toFixed(3)}, ${w2.dz.toFixed(3)}), ${w2.amplitude.toFixed(3)}, ${w2.wavelength.toFixed(2)}, ${w2.speed.toFixed(2)}, damp, h, grad, crest);
          evalWave(wp, vec2(${w3.dx.toFixed(3)}, ${w3.dz.toFixed(3)}), ${w3.amplitude.toFixed(3)}, ${w3.wavelength.toFixed(2)}, ${w3.speed.toFixed(2)}, damp, h, grad, crest);

          vec3 displaced = position;
          displaced.y += h;

          vec4 finalWorld = modelMatrix * vec4(displaced, 1.0);
          vWorldPos = finalWorld.xyz;
          vNormal = normalize(vec3(-grad.x, 1.0, -grad.y));
          vDepth = aWaterDepth;
          vCrestFoam = clamp((crest - 1.35) * 0.65, 0.0, 1.0);

          gl_Position = projectionMatrix * viewMatrix * finalWorld;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec2 uOriginOffset;
        uniform vec3 uLightDir;
        uniform vec3 uLightColor;
        uniform vec3 uSkyHorizon;
        uniform vec3 uSkyZenith;
        uniform vec3 uShallowColor;
        uniform vec3 uDeepColor;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform float uIsNight;
        uniform float uIsUnderwater;

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vDepth;
        varying float vCrestFoam;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float noise2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        void main() {
          vec2 wp = vWorldPos.xz + uOriginOffset;
          // High-frequency capillary micro-normals
          float n1 = noise2(wp * 0.55 + vec2(uTime * 0.28, -uTime * 0.19));
          float n2 = noise2(wp * 1.45 - vec2(uTime * 0.35, uTime * 0.24));
          vec3 micro = vec3((n1 - 0.5) * 0.22 + (n2 - 0.5) * 0.14, 0.0, (n2 - n1) * 0.22);
          vec3 N = normalize(vNormal + micro);
          if (uIsUnderwater > 0.5) N = -N;

          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 L = normalize(uLightDir);
          vec3 R = reflect(-V, N);

          // Schlick Fresnel reflection
          float ndotv = max(dot(N, V), 0.001);
          float fresnel = 0.03 + 0.97 * pow(1.0 - ndotv, 4.4);

          // Sky reflection gradient
          float reflElev = clamp(R.y, 0.0, 1.0);
          vec3 skyRefl = mix(uSkyHorizon, uSkyZenith, pow(reflElev, 0.65));

          // Sun/Moon glitter specular lobe (tight path + broad halo)
          vec3 H = normalize(L + V);
          float ndoth = max(dot(N, H), 0.0);
          float specTight = pow(ndoth, 240.0) * 2.4;
          float specBroad = pow(ndoth, 28.0) * 0.22;
          vec3 specular = uLightColor * (specTight + specBroad);

          // Beer-Lambert depth absorption + subsurface wave crest scatter
          float depthClamped = max(0.0, vDepth);
          float absorb = 1.0 - exp(-depthClamped * 0.42);
          vec3 waterBody = mix(uShallowColor, uDeepColor, absorb);
          float sss = pow(max(0.0, dot(-L, V)) * 0.5 + 0.5, 2.0) * max(0.0, vWorldPos.y + 0.25) * 0.35;
          waterBody += vec3(0.06, 0.28, 0.34) * sss;

          vec3 col = mix(waterBody, skyRefl, fresnel * 0.84) + specular;

          // Animated shoreline surf foam + wind whitecaps
          float foamNoise = noise2(wp * 0.72 + vec2(uTime * 0.45, uTime * 0.3));
          float shoreWave = smoothstep(1.35, 0.0, depthClamped) * (0.48 + 0.52 * sin(depthClamped * 6.5 - uTime * 2.6));
          float shoreFoam = smoothstep(0.32, 0.75, shoreWave * (0.65 + 0.5 * foamNoise));
          float crestFoam = smoothstep(0.35, 0.85, vCrestFoam * (0.5 + 0.65 * foamNoise));
          float foam = clamp(shoreFoam * 0.78 + crestFoam * 0.65, 0.0, 0.92);

          vec3 foamCol = mix(vec3(0.55, 0.68, 0.82), vec3(0.92, 0.96, 1.0), 1.0 - uIsNight * 0.55);
          col = mix(col, foamCol, foam);

          // Exponential distance + height fog matching world atmosphere
          float dist = length(cameraPosition - vWorldPos);
          float fogFactor = 1.0 - exp(-pow(dist * uFogDensity, 1.35));
          col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

          float alpha = mix(0.68, 0.97, clamp(absorb * 0.85 + foam * 0.5 + fresnel * 0.35, 0.0, 1.0));
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.renderOrder = 2;
  }

  /**
   * Snaps the ocean grid every 18 meters to follow the player cleanly while computing
   * per-vertex depth relative to terrain heightfield so shoreline foam & shallow reefs align accurately.
   */
  public followPlayer(worldX: number, worldZ: number, originX: number, originZ: number): void {
    const snapStep = 18;
    const snapX = Math.round(worldX / snapStep) * snapStep;
    const snapZ = Math.round(worldZ / snapStep) * snapStep;

    this.mesh.position.set(snapX - originX, WATER_LEVEL, snapZ - originZ);
    this.uniforms.uOriginOffset.value.set(originX, originZ);

    if (snapX === this.lastSnapX && snapZ === this.lastSnapZ) return;
    this.lastSnapX = snapX;
    this.lastSnapZ = snapZ;

    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    const depthAttr = this.geometry.attributes.aWaterDepth as THREE.BufferAttribute;
    const depths = depthAttr.array as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      const wx = snapX + pos.getX(i);
      const wz = snapZ + pos.getZ(i);
      const bedY = groundHeightAt(wx, wz);
      depths[i] = Math.max(-1.0, WATER_LEVEL - bedY);
    }
    depthAttr.needsUpdate = true;
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
