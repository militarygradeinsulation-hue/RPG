import * as THREE from 'three';
import { BiomeId, SeasonType, WeatherType } from '../types/game';
import { groundHeightAt, WATER_LEVEL } from '../world/TerrainHeightfield';

function createSoftParticleTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.35, 'rgba(235,245,255,0.75)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createLunarTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size * 0.46, size * 0.44, 6, size * 0.5, size * 0.5, size * 0.48);
  g.addColorStop(0, '#f4f8ff');
  g.addColorStop(0.75, '#dbe6f7');
  g.addColorStop(1, '#9fb2cc');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2);
  ctx.fill();

  // Subtle maria & crater shading
  const craters = [
    [0.36, 0.38, 12, 0.14],
    [0.58, 0.48, 16, 0.16],
    [0.44, 0.64, 10, 0.12],
    [0.64, 0.3, 8, 0.1],
  ];
  craters.forEach(([cx, cy, r, a]) => {
    ctx.fillStyle = `rgba(96, 114, 146, ${a})`;
    ctx.beginPath();
    ctx.arc(size * cx, size * cy, r, 0, Math.PI * 2);
    ctx.fill();
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class SkyAndWeather {
  public readonly group = new THREE.Group();
  public readonly skyMesh: THREE.Mesh;
  public readonly skyUniforms = {
    uTopColor: { value: new THREE.Color(0x040814) },
    uHorizonColor: { value: new THREE.Color(0x16243d) },
    uGlowColor: { value: new THREE.Color(0x28476e) },
    uSunDir: { value: new THREE.Vector3(0.45, 0.5, 0.42).normalize() },
    uTime: { value: 0 },
    uNightAmount: { value: 0.9 },
    uStormAmount: { value: 0.0 },
    uWeatherAsh: { value: 0.0 },
  };
  public readonly fog: THREE.FogExp2;
  public readonly celestialGroup = new THREE.Group();
  public readonly sunMoonMesh: THREE.Mesh;
  public readonly starsPoints: THREE.Points;

  private readonly particleTex: THREE.CanvasTexture;
  private readonly lunarTex: THREE.CanvasTexture;
  private readonly precipPoints: THREE.Points;
  private readonly farSnowPoints: THREE.Points;
  private readonly emberPoints: THREE.Points;
  private readonly rainRippleMesh: THREE.InstancedMesh;
  private readonly ripples: { x: number; y: number; z: number; age: number; maxAge: number }[] = [];
  private readonly dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene, particleCount = 640) {
    this.particleTex = createSoftParticleTexture();
    this.lunarTex = createLunarTexture();

    this.fog = new THREE.FogExp2(0x0e182b, 0.0052);
    scene.fog = this.fog;
    scene.background = new THREE.Color(0x090f1d);

    // 1. Atmospheric Sky Dome with Rayleigh/Mie Horizon Glow + Aurora Borealis + Volumetric Cloud FBM
    const skyGeo = new THREE.SphereGeometry(980, 36, 22);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          vWorldDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTopColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uGlowColor;
        uniform vec3 uSunDir;
        uniform float uTime;
        uniform float uNightAmount;
        uniform float uStormAmount;
        uniform float uWeatherAsh;
        varying vec3 vWorldDir;

        float hash2(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
            mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise(p);
            p *= 2.04;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 dir = normalize(vWorldDir);
          float h = clamp(dir.y, 0.0, 1.0);
          vec3 col = mix(uHorizonColor, uTopColor, pow(h, 0.52));

          // Mie forward scatter corona around Sun or Moon
          float sDot = max(0.0, dot(dir, normalize(uSunDir)));
          float halo = pow(sDot, 8.0) * 0.28 + pow(sDot, 96.0) * 0.55;
          col += uGlowColor * halo;

          // Subtle Volumetric Clouds projected onto high sky plane
          if (dir.y > 0.03) {
            vec2 cloudUv = dir.xz / (dir.y + 0.22) * 0.95 + vec2(uTime * 0.008, uTime * 0.004);
            float cNoise = fbm(cloudUv * 2.2);
            float cloudMask = smoothstep(0.46 - uStormAmount * 0.16, 0.78, cNoise) * smoothstep(0.03, 0.24, dir.y);
            vec3 cloudCol = mix(uHorizonColor * 1.15, uGlowColor * 1.35, pow(sDot, 4.0) * 0.65);
            col = mix(col, cloudCol, cloudMask * (0.42 + uStormAmount * 0.36));
          }

          // Northern Aurora Borealis curtains shimmering softly at night
          if (uNightAmount > 0.2 && dir.y > 0.06 && dir.y < 0.72) {
            float wave = sin(dir.x * 5.2 + uTime * 0.22 + dir.z * 3.1) * 0.5 + 0.5;
            float ribbon = smoothstep(0.1, 0.32, dir.y) * smoothstep(0.68, 0.28, dir.y);
            float curtain = smoothstep(0.55, 0.96, wave * fbm(vec2(dir.x * 4.5 + uTime * 0.04, dir.z * 4.5)));
            vec3 auroraCol = mix(vec3(0.08, 0.62, 0.52), vec3(0.28, 0.35, 0.85), wave);
            col += auroraCol * ribbon * curtain * uNightAmount * (1.0 - uStormAmount * 0.7) * 0.32;
          }

          // Horizon mist & ashfall tint band
          float band = exp(-abs(dir.y) * 9.5);
          col = mix(col, uHorizonColor * (1.0 + uWeatherAsh * 0.2), band * 0.38);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.group.add(this.skyMesh);

    // 2. Crisp Moon / Sun Disc
    this.sunMoonMesh = new THREE.Mesh(
      new THREE.CircleGeometry(26, 32),
      new THREE.MeshBasicMaterial({
        map: this.lunarTex,
        color: 0xe6f0ff,
        fog: false,
        transparent: true,
        depthWrite: false,
      })
    );
    this.celestialGroup.add(this.sunMoonMesh);
    this.group.add(this.celestialGroup);

    // 3. Starfield Dome
    const starCount = 720;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(0.08 + Math.random() * 0.92);
      const r = 890;
      starPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      starPos[i * 3 + 1] = r * Math.cos(ph);
      starPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starsPoints = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        color: 0xdbeafe,
        size: 1.9,
        transparent: true,
        opacity: 0.78,
        fog: false,
        depthWrite: false,
      })
    );
    this.group.add(this.starsPoints);

    // 4. Precipitation & Ember Pools
    const mkPoints = (count: number, span: number, height: number, size: number, color: number, additive = false) => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * span;
        pos[i * 3 + 1] = Math.random() * height;
        pos[i * 3 + 2] = (Math.random() - 0.5) * span;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color,
        map: this.particleTex,
        size,
        transparent: true,
        opacity: additive ? 0.88 : 0.72,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false,
        alphaTest: 0.02,
      });
      return new THREE.Points(geo, mat);
    };

    this.precipPoints = mkPoints(particleCount, 90, 28, 0.34, 0xdbeafe);
    this.farSnowPoints = mkPoints(Math.floor(particleCount * 0.55), 120, 34, 0.24, 0xcbd5e1);
    this.emberPoints = mkPoints(Math.floor(particleCount * 0.45), 74, 18, 0.42, 0xfb923c, true);
    this.emberPoints.visible = false;

    this.group.add(this.precipPoints, this.farSnowPoints, this.emberPoints);

    // 5. Rain Ripples Instanced Pool
    const rippleCount = 44;
    const rGeo = new THREE.RingGeometry(0.32, 0.42, 18);
    rGeo.rotateX(-Math.PI / 2);
    const rMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.rainRippleMesh = new THREE.InstancedMesh(rGeo, rMat, rippleCount);
    for (let i = 0; i < rippleCount; i++) {
      this.ripples.push({
        x: (Math.random() - 0.5) * 44,
        y: WATER_LEVEL + 0.05,
        z: (Math.random() - 0.5) * 44,
        age: Math.random() * 0.9,
        maxAge: 0.7 + Math.random() * 0.4,
      });
    }
    this.rainRippleMesh.visible = false;
    this.group.add(this.rainRippleMesh);
  }

  public update(
    dt: number,
    elapsed: number,
    playerLocalX: number,
    playerLocalZ: number,
    playerWorldX: number,
    playerWorldZ: number,
    cameraY: number,
    timeOfDayIndex: number,
    weather: WeatherType,
    season: SeasonType,
    biomeId: BiomeId,
    biomeHealth: number,
    sunDirOut: THREE.Vector3
  ): { isNight: boolean; isUnderwater: boolean; lightColorHex: number } {
    this.skyUniforms.uTime.value = elapsed;
    this.skyMesh.position.set(playerLocalX, 0, playerLocalZ);
    this.celestialGroup.position.set(playerLocalX, 0, playerLocalZ);
    this.starsPoints.position.set(playerLocalX, 0, playerLocalZ);

    const isUnderwater = cameraY < WATER_LEVEL - 0.08;
    const isNight = timeOfDayIndex < 0.22 || timeOfDayIndex > 0.74;
    const nightWeight = isNight
      ? 1.0
      : timeOfDayIndex < 0.34
        ? 1.0 - THREE.MathUtils.smoothstep(timeOfDayIndex, 0.22, 0.34)
        : timeOfDayIndex > 0.64
          ? THREE.MathUtils.smoothstep(timeOfDayIndex, 0.64, 0.74)
          : 0.0;

    // Solar/Lunar Orbital Vector
    const angle = (timeOfDayIndex - 0.25) * Math.PI * 2;
    const rawSunY = Math.sin(angle);
    if (isNight) {
      sunDirOut.set(0.46, 0.58, 0.42).normalize();
    } else {
      sunDirOut.set(Math.cos(angle) * 0.72, Math.max(0.2, rawSunY), 0.45).normalize();
    }
    this.skyUniforms.uSunDir.value.copy(sunDirOut);
    this.skyUniforms.uNightAmount.value = nightWeight;
    this.skyUniforms.uStormAmount.value = weather === 'Thunderstorm' ? 1.0 : weather === 'Rain' ? 0.55 : 0.0;
    this.skyUniforms.uWeatherAsh.value = weather === 'Ashfall' ? 1.0 : 0.0;

    // Position visible moon/sun disc on sky dome
    this.sunMoonMesh.position.copy(sunDirOut).multiplyScalar(760);
    this.sunMoonMesh.lookAt(playerLocalX, 0, playerLocalZ);
    (this.sunMoonMesh.material as THREE.MeshBasicMaterial).color.setHex(isNight ? 0xdbeafe : 0xfff3d1);

    const starMat = this.starsPoints.material as THREE.PointsMaterial;
    starMat.opacity = nightWeight * (weather === 'Clear' ? 0.85 : 0.28);
    this.starsPoints.visible = !isUnderwater && starMat.opacity > 0.04;

    // Sky & Fog Color Palette
    if (isUnderwater) {
      this.fog.color.setHex(0x0c3c5e);
      this.fog.density = 0.026;
    } else {
      let topHex = 0x0b1830;
      let horizHex = 0x263f66;
      let glowHex = 0x6897d4;
      let fogDens = 0.0034;

      if (!isNight) {
        if (timeOfDayIndex < 0.34 || timeOfDayIndex > 0.66) {
          // Dawn / Golden Dusk
          topHex = 0x263561;
          horizHex = 0x9c6552;
          glowHex = 0xfbbf24;
          fogDens = 0.0036;
        } else {
          // Clear Day
          topHex = 0x2662a8;
          horizHex = 0x8cb8e0;
          glowHex = 0xfef3c7;
          fogDens = 0.0028;
        }
      }

      if (weather === 'Ashfall' || biomeId === 'ember') {
        horizHex = isNight ? 0x382026 : 0x704338;
        fogDens += 0.0014;
      } else if (weather === 'Mist') {
        horizHex = isNight ? 0x283c5e : 0x8ea4ba;
        fogDens += 0.0028;
      } else if (weather === 'Thunderstorm') {
        topHex = 0x0d1629;
        horizHex = 0x1d2e45;
        fogDens += 0.002;
      }

      if (biomeHealth < 35) {
        fogDens += 0.0009;
      }

      this.skyUniforms.uTopColor.value.setHex(topHex);
      this.skyUniforms.uHorizonColor.value.setHex(horizHex);
      this.skyUniforms.uGlowColor.value.setHex(glowHex);
      this.fog.color.setHex(horizHex);
      this.fog.density = fogDens;
    }

    // Update Falling Precipitation / Snow / Rising Embers around player
    const showSnow = season === 'Winter' && weather !== 'Rain' && weather !== 'Thunderstorm' && weather !== 'Ashfall' && !isUnderwater;
    const showRain = (weather === 'Rain' || weather === 'Thunderstorm') && !isUnderwater;
    const showAsh = (weather === 'Ashfall' || biomeId === 'ember') && !showRain && !isUnderwater;

    this.precipPoints.visible = showSnow || showRain;
    this.farSnowPoints.visible = showSnow;
    this.emberPoints.visible = showAsh;
    this.rainRippleMesh.visible = showRain;

    if (this.precipPoints.visible) {
      this.precipPoints.position.set(playerLocalX, 0, playerLocalZ);
      const pMat = this.precipPoints.material as THREE.PointsMaterial;
      pMat.size = showRain ? 0.22 : 0.34;
      pMat.color.setHex(showRain ? 0xbae6fd : 0xe2ecff);

      const pos = this.precipPoints.geometry.attributes.position as THREE.BufferAttribute;
      const fallSpeed = showRain ? 26 : 3.2;
      const windDrift = showRain ? 4.2 : 1.4;
      for (let i = 0; i < pos.count; i++) {
        let px = pos.getX(i) + dt * windDrift;
        let py = pos.getY(i) - dt * fallSpeed;
        if (py < -2) {
          py = 26;
          px = (Math.random() - 0.5) * 90;
        }
        if (px > 45) px -= 90;
        pos.setXY(i, px, py);
      }
      pos.needsUpdate = true;
    }

    if (this.farSnowPoints.visible) {
      this.farSnowPoints.position.set(playerLocalX, 0, playerLocalZ);
      const pos = this.farSnowPoints.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let py = pos.getY(i) - dt * 1.9;
        if (py < -2) py = 32;
        pos.setY(i, py);
      }
      pos.needsUpdate = true;
    }

    if (this.emberPoints.visible) {
      this.emberPoints.position.set(playerLocalX, 0, playerLocalZ);
      const pos = this.emberPoints.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let py = pos.getY(i) + dt * 2.8;
        const px = pos.getX(i) + Math.sin(elapsed * 2 + i) * dt * 0.9;
        if (py > 18) py = 0.2;
        pos.setXY(i, px, py);
      }
      pos.needsUpdate = true;
    }

    if (this.rainRippleMesh.visible) {
      for (let i = 0; i < this.ripples.length; i++) {
        const rp = this.ripples[i];
        rp.age += dt;
        if (rp.age >= rp.maxAge) {
          rp.age = 0;
          rp.x = playerWorldX + (Math.random() - 0.5) * 40;
          rp.z = playerWorldZ + (Math.random() - 0.5) * 40;
          rp.y = Math.max(WATER_LEVEL + 0.05, groundHeightAt(rp.x, rp.z) + 0.06);
        }
        const t = rp.age / rp.maxAge;
        this.dummy.position.set(rp.x - (playerWorldX - playerLocalX), rp.y, rp.z - (playerWorldZ - playerLocalZ));
        this.dummy.scale.setScalar(0.35 + t * 2.1);
        this.dummy.updateMatrix();
        this.rainRippleMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.rainRippleMesh.instanceMatrix.needsUpdate = true;
    }

    return {
      isNight,
      isUnderwater,
      lightColorHex: isNight ? 0x9ec5ff : timeOfDayIndex < 0.34 || timeOfDayIndex > 0.66 ? 0xffbe86 : 0xfff5e4,
    };
  }

  public dispose(): void {
    this.particleTex.dispose();
    this.lunarTex.dispose();
    this.skyMesh.geometry.dispose();
    (this.skyMesh.material as THREE.Material).dispose();
    this.sunMoonMesh.geometry.dispose();
    (this.sunMoonMesh.material as THREE.Material).dispose();
    this.starsPoints.geometry.dispose();
    (this.starsPoints.material as THREE.Material).dispose();
    this.precipPoints.geometry.dispose();
    (this.precipPoints.material as THREE.Material).dispose();
    this.farSnowPoints.geometry.dispose();
    (this.farSnowPoints.material as THREE.Material).dispose();
    this.emberPoints.geometry.dispose();
    (this.emberPoints.material as THREE.Material).dispose();
    this.rainRippleMesh.geometry.dispose();
    (this.rainRippleMesh.material as THREE.Material).dispose();
  }
}
