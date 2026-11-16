import * as THREE from 'three';

export interface PBRTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  aoMap: THREE.CanvasTexture;
}

export interface SnowShaderUniforms {
  uSnowAmount: { value: number };
  uTime: { value: number };
  uLightDir: { value: THREE.Vector3 };
}

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function finalizeTexture(
  canvas: HTMLCanvasElement,
  maxAnisotropy: number,
  isColor: boolean,
  repeat = 1
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

function heightCanvasToNormalCanvas(heightCanvas: HTMLCanvasElement, strength = 2.6): HTMLCanvasElement {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const srcCtx = heightCanvas.getContext('2d')!;
  const srcData = srcCtx.getImageData(0, 0, w, h).data;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext('2d')!;
  const outImg = outCtx.createImageData(w, h);
  const dst = outImg.data;

  const sample = (x: number, y: number): number => {
    const wx = ((x % w) + w) % w;
    const wy = ((y % h) + h) % h;
    return srcData[(wy * w + wx) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const u = sample(x, y - 1);
      const d = sample(x, y + 1);
      const dx = (l - r) * strength;
      const dy = (u - d) * strength;
      const dz = 1.0;
      const invLen = 1 / Math.hypot(dx, dy, dz);
      const idx = (y * w + x) * 4;
      dst[idx] = Math.round((dx * invLen * 0.5 + 0.5) * 255);
      dst[idx + 1] = Math.round((dy * invLen * 0.5 + 0.5) * 255);
      dst[idx + 2] = Math.round((dz * invLen * 0.5 + 0.5) * 255);
      dst[idx + 3] = 255;
    }
  }
  outCtx.putImageData(outImg, 0, 0);
  return outCanvas;
}

export function createStonePBRTextures(maxAnisotropy: number, size = 1024): PBRTextureSet {
  const colorCanvas = document.createElement('canvas');
  const heightCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  const aoCanvas = document.createElement('canvas');
  colorCanvas.width = heightCanvas.width = roughCanvas.width = aoCanvas.width = size;
  colorCanvas.height = heightCanvas.height = roughCanvas.height = aoCanvas.height = size;

  const cCtx = colorCanvas.getContext('2d')!;
  const hCtx = heightCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;
  const aCtx = aoCanvas.getContext('2d')!;

  cCtx.fillStyle = '#1b222e';
  cCtx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#181818';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#f2f2f2';
  rCtx.fillRect(0, 0, size, size);
  aCtx.fillStyle = '#555555';
  aCtx.fillRect(0, 0, size, size);

  const scale = size / 512;
  const rows = 10;
  const rowH = size / rows;
  const baseColW = 86 * scale;

  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    const offset = r % 2 === 0 ? 0 : baseColW * 0.48;
    for (let x = -baseColW; x < size + baseColW; x += baseColW) {
      const seed = hash2((x * 0.11) / scale, r * 0.71);
      const jitterW = (seed - 0.5) * 14 * scale;
      const bw = baseColW - 6 * scale + jitterW * 0.25;
      const bh = rowH - 6 * scale;
      const bx = x + offset + 3 * scale;
      const by = y + 3 * scale;

      const base = Math.floor(68 + seed * 44);
      const warmTint = Math.floor((hash2(r, x) - 0.5) * 10);
      const grad = cCtx.createLinearGradient(bx, by, bx + bw, by + bh);
      grad.addColorStop(0, `rgb(${base + 14 + warmTint}, ${base + 16}, ${base + 24})`);
      grad.addColorStop(0.55, `rgb(${base + 3 + warmTint}, ${base + 6}, ${base + 14})`);
      grad.addColorStop(1, `rgb(${base - 12}, ${base - 8}, ${base + 2})`);
      cCtx.fillStyle = grad;
      cCtx.fillRect(bx, by, bw, bh);

      cCtx.strokeStyle = 'rgba(218, 229, 245, 0.16)';
      cCtx.lineWidth = Math.max(1, 1.5 * scale);
      cCtx.strokeRect(bx + scale, by + scale, bw - 2 * scale, bh - 2 * scale);

      const bumpVal = Math.floor(165 + seed * 75);
      hCtx.fillStyle = `rgb(${bumpVal},${bumpVal},${bumpVal})`;
      hCtx.fillRect(bx + 2 * scale, by + 2 * scale, bw - 4 * scale, bh - 4 * scale);

      hCtx.strokeStyle = `rgb(${Math.floor(bumpVal * 0.68)},${Math.floor(bumpVal * 0.68)},${Math.floor(bumpVal * 0.68)})`;
      hCtx.lineWidth = 3 * scale;
      hCtx.strokeRect(bx + scale, by + scale, bw - 2 * scale, bh - 2 * scale);

      const roughVal = Math.floor(155 + seed * 70);
      rCtx.fillStyle = `rgb(${roughVal},${roughVal},${roughVal})`;
      rCtx.fillRect(bx, by, bw, bh);

      aCtx.fillStyle = '#e8e8e8';
      aCtx.fillRect(bx + 3 * scale, by + 3 * scale, bw - 6 * scale, bh - 6 * scale);
    }
  }

  const speckCount = Math.floor(7500 * scale);
  for (let i = 0; i < speckCount; i++) {
    const px = hash2(i, 1.3) * size;
    const py = hash2(i, 5.7) * size;
    const sz = (1 + hash2(i, 2.9) * 2.2) * scale;
    const dark = hash2(i, 9.1) > 0.45;
    cCtx.fillStyle = dark ? 'rgba(10,16,28,0.22)' : 'rgba(215,228,244,0.14)';
    cCtx.fillRect(px, py, sz, sz);
    hCtx.fillStyle = dark ? 'rgba(35,35,35,0.34)' : 'rgba(245,245,245,0.22)';
    hCtx.fillRect(px, py, sz, sz);
    if (dark) {
      aCtx.fillStyle = 'rgba(40,40,40,0.2)';
      aCtx.fillRect(px, py, sz, sz);
    }
  }

  const normalCanvas = heightCanvasToNormalCanvas(heightCanvas, 3.2);
  return {
    map: finalizeTexture(colorCanvas, maxAnisotropy, true, 2),
    normalMap: finalizeTexture(normalCanvas, maxAnisotropy, false, 2),
    bumpMap: finalizeTexture(heightCanvas, maxAnisotropy, false, 2),
    roughnessMap: finalizeTexture(roughCanvas, maxAnisotropy, false, 2),
    aoMap: finalizeTexture(aoCanvas, maxAnisotropy, false, 2),
  };
}

export function createWoodPBRTextures(maxAnisotropy: number, size = 512): PBRTextureSet {
  const colorCanvas = document.createElement('canvas');
  const heightCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  const aoCanvas = document.createElement('canvas');
  colorCanvas.width = heightCanvas.width = roughCanvas.width = aoCanvas.width = size;
  colorCanvas.height = heightCanvas.height = roughCanvas.height = aoCanvas.height = size;

  const cCtx = colorCanvas.getContext('2d')!;
  const hCtx = heightCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;
  const aCtx = aoCanvas.getContext('2d')!;

  cCtx.fillStyle = '#5a3822';
  cCtx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#9c9c9c';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#d4d4d4';
  rCtx.fillRect(0, 0, size, size);
  aCtx.fillStyle = '#dedede';
  aCtx.fillRect(0, 0, size, size);

  for (let y = 0; y < size; y += 2) {
    const wave = Math.sin(y * 0.09) * 0.5 + 0.5;
    const n = hash2(y, 3.3);
    cCtx.fillStyle =
      n > 0.52 ? `rgba(28, 15, 7, ${0.16 + wave * 0.16})` : `rgba(148, 102, 58, ${0.12 + wave * 0.14})`;
    cCtx.fillRect(0, y, size, 2);

    const bv = Math.floor(124 + wave * 68 + n * 32);
    hCtx.fillStyle = `rgb(${bv},${bv},${bv})`;
    hCtx.fillRect(0, y, size, 2);
  }

  for (let p = 0; p < 6; p++) {
    const py = p * (size / 6);
    cCtx.fillStyle = 'rgba(15, 8, 4, 0.62)';
    cCtx.fillRect(0, py, size, 4);
    hCtx.fillStyle = '#1f1f1f';
    hCtx.fillRect(0, py, size, 4);
    rCtx.fillStyle = '#f2f2f2';
    rCtx.fillRect(0, py, size, 4);
    aCtx.fillStyle = '#525252';
    aCtx.fillRect(0, py, size, 5);
  }

  const normalCanvas = heightCanvasToNormalCanvas(heightCanvas, 2.4);
  return {
    map: finalizeTexture(colorCanvas, maxAnisotropy, true, 1),
    normalMap: finalizeTexture(normalCanvas, maxAnisotropy, false, 1),
    bumpMap: finalizeTexture(heightCanvas, maxAnisotropy, false, 1),
    roughnessMap: finalizeTexture(roughCanvas, maxAnisotropy, false, 1),
    aoMap: finalizeTexture(aoCanvas, maxAnisotropy, false, 1),
  };
}

export function createTerrainDetailTextures(maxAnisotropy: number, size = 512): PBRTextureSet {
  const colorCanvas = document.createElement('canvas');
  const heightCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  const aoCanvas = document.createElement('canvas');
  colorCanvas.width = heightCanvas.width = roughCanvas.width = aoCanvas.width = size;
  colorCanvas.height = heightCanvas.height = roughCanvas.height = aoCanvas.height = size;

  const cCtx = colorCanvas.getContext('2d')!;
  const hCtx = heightCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;
  const aCtx = aoCanvas.getContext('2d')!;

  cCtx.fillStyle = '#d8e3ef';
  cCtx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#808080';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#cccccc';
  rCtx.fillRect(0, 0, size, size);
  aCtx.fillStyle = '#ebebeb';
  aCtx.fillRect(0, 0, size, size);

  for (let y = 0; y < size; y += 2) {
    const wave = Math.sin((y / size) * Math.PI * 10) * 0.5 + 0.5;
    const hVal = Math.floor(108 + wave * 36);
    hCtx.fillStyle = `rgb(${hVal},${hVal},${hVal})`;
    hCtx.fillRect(0, y, size, 2);
  }

  for (let i = 0; i < 14000; i++) {
    const x = hash2(i, 2.1) * size;
    const y = hash2(i, 7.9) * size;
    const rad = 1 + hash2(i, 4.4) * 2.5;
    const tone = hash2(i, 8.2);
    const cVal = Math.floor(198 + tone * 52);
    cCtx.fillStyle = `rgb(${cVal},${Math.min(255, cVal + 4)},${Math.min(255, cVal + 9)})`;
    cCtx.fillRect(x, y, rad, rad);

    const bVal = Math.floor(65 + tone * 165);
    hCtx.fillStyle = `rgb(${bVal},${bVal},${bVal})`;
    hCtx.fillRect(x, y, rad, rad);

    const rVal = Math.floor(135 + (1 - tone) * 100);
    rCtx.fillStyle = `rgb(${rVal},${rVal},${rVal})`;
    rCtx.fillRect(x, y, rad, rad);
  }

  const normalCanvas = heightCanvasToNormalCanvas(heightCanvas, 2.2);
  return {
    map: finalizeTexture(colorCanvas, maxAnisotropy, true, 16),
    normalMap: finalizeTexture(normalCanvas, maxAnisotropy, false, 16),
    bumpMap: finalizeTexture(heightCanvas, maxAnisotropy, false, 16),
    roughnessMap: finalizeTexture(roughCanvas, maxAnisotropy, false, 16),
    aoMap: finalizeTexture(aoCanvas, maxAnisotropy, false, 16),
  };
}

export function createSnowSparkleNormalMap(maxAnisotropy: number): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = Math.floor(i / size);
    const h1 = hash2(x * 1.17, y * 1.31);
    const h2 = hash2(x * 2.41 + 19, y * 2.73 + 7);
    const isFacet = h1 > 0.85;
    const nx = isFacet ? (h2 - 0.5) * 0.85 : (h2 - 0.5) * 0.14;
    const ny = isFacet ? (h1 - 0.5) * 0.85 : (h1 - 0.5) * 0.14;
    const nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
    const idx = i * 4;
    data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
    data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    data[idx + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates an alpha-cutout pine bough foliage card texture with realistic conifer needles
 * so pines read like layered branches instead of cone primitives.
 */
export function createPineBoughTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  // Woody central twig spine
  ctx.strokeStyle = '#3b281c';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.96);
  ctx.lineTo(size * 0.5, size * 0.08);
  ctx.stroke();

  // Dense layered conifer needle tufts
  for (let i = 0; i < 420; i++) {
    const t = i / 420;
    const y = size * (0.9 - t * 0.8);
    const spread = (1 - t * 0.65) * size * 0.44;
    const side = i % 2 === 0 ? 1 : -1;
    const jx = (hash2(i, 1.7) - 0.5) * 16;
    const len = spread * (0.45 + hash2(i, 3.1) * 0.55);
    const endX = size * 0.5 + side * len + jx;
    const endY = y - 10 - hash2(i, 5.2) * 26;

    const shade = Math.floor(38 + hash2(i, 9.1) * 38);
    ctx.strokeStyle = `rgb(${Math.floor(shade * 0.45)}, ${shade + 22}, ${Math.floor(shade * 0.55)})`;
    ctx.lineWidth = 2.6 + (1 - t) * 1.4;
    ctx.beginPath();
    ctx.moveTo(size * 0.5, y);
    ctx.quadraticCurveTo(size * 0.5 + side * len * 0.55, y - 4, endX, endY);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createProceduralNightEquirectEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const w = 128;
  const h = 64;
  const data = new Float32Array(w * h * 4);
  const moonDir = new THREE.Vector3(0.52, 0.62, 0.42).normalize();
  const dir = new THREE.Vector3();

  for (let y = 0; y < h; y++) {
    const v = 1 - (y + 0.5) / h;
    const phi = (1 - v) * Math.PI;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const theta = u * Math.PI * 2;
      dir.set(-Math.sin(phi) * Math.sin(theta), Math.cos(phi), -Math.sin(phi) * Math.cos(theta));

      let r = 0.08;
      let g = 0.13;
      let b = 0.24;

      if (dir.y >= 0) {
        const horizon = Math.pow(1 - dir.y, 2.1);
        r = THREE.MathUtils.lerp(0.065, 0.19, horizon);
        g = THREE.MathUtils.lerp(0.105, 0.28, horizon);
        b = THREE.MathUtils.lerp(0.21, 0.44, horizon);

        const mDot = Math.max(0, dir.dot(moonDir));
        const corona = Math.pow(mDot, 14) * 0.75 + Math.pow(mDot, 120) * 4.0;
        r += corona * 0.78;
        g += corona * 0.9;
        b += corona * 1.15;
      } else {
        const bounce = Math.pow(1 + dir.y, 1.8);
        r = THREE.MathUtils.lerp(0.045, 0.13, bounce);
        g = THREE.MathUtils.lerp(0.07, 0.18, bounce);
        b = THREE.MathUtils.lerp(0.12, 0.28, bounce);
      }

      const idx = (y * w + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 1.0;
    }
  }

  const equirect = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  equirect.magFilter = THREE.LinearFilter;
  equirect.minFilter = THREE.LinearFilter;
  equirect.colorSpace = THREE.LinearSRGBColorSpace;
  equirect.needsUpdate = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envTarget = pmrem.fromEquirectangular(equirect);
  equirect.dispose();
  pmrem.dispose();
  return envTarget.texture;
}

/**
 * Safely chain multiple shader injections onto a Three.js material's onBeforeCompile
 * so CSM shadow cascades + our custom triplanar/snow/crystal shaders coexist cleanly.
 */
export function chainOnBeforeCompile(
  material: THREE.Material,
  cb: (shader: THREE.WebGLProgramParametersWithUniforms) => void
) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    cb(shader);
  };
}

/**
 * Photorealistic multi-scale terrain material with:
 * - World-space anti-tiling macro detail breakup (eliminates repeating grid patterns)
 * - Steep cliff triplanar rock roughness & wet basalt tint
 * - Wind-carved snow sastrugi micro-facets + subsurface cool-blue shadow scattering
 * - Wet dark coastal sand sheen near WATER_LEVEL
 * - Cobbled road stone patterning along road masks
 */
export function createPhotorealTerrainMaterial(
  terrainPbr: PBRTextureSet,
  stonePbr: PBRTextureSet,
  sparkleNormal: THREE.DataTexture,
  snowUniforms: SnowShaderUniforms
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: terrainPbr.map,
    normalMap: terrainPbr.normalMap,
    normalScale: new THREE.Vector2(1.05, 1.05),
    roughnessMap: terrainPbr.roughnessMap,
    aoMap: terrainPbr.aoMap,
    aoMapIntensity: 0.72,
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.04,
  });

  mat.customProgramCacheKey = () => 'aethelgard_photoreal_terrain_v2';
  chainOnBeforeCompile(mat, (shader) => {
    shader.uniforms.uSnowAmount = snowUniforms.uSnowAmount;
    shader.uniforms.uStoneMap = { value: stonePbr.map };
    shader.uniforms.uSparkleNormal = { value: sparkleNormal };
    shader.uniforms.uOriginOffset = { value: new THREE.Vector2(0, 0) };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        attribute vec4 aBiomeData;
        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNorm;
        varying vec4 vBiomeData;
        `
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTerrainWorldNorm = normalize(mat3(modelMatrix) * objectNormal);
        vBiomeData = aBiomeData;
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uSnowAmount;
        uniform sampler2D uStoneMap;
        uniform sampler2D uSparkleNormal;
        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNorm;
        varying vec4 vBiomeData;
        `
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        #include <map_fragment>
        // Dual-scale anti-tiling macro detail
        float macroA = sin(vTerrainWorldPos.x * 0.07 + cos(vTerrainWorldPos.z * 0.05) * 1.4);
        float macroB = cos(vTerrainWorldPos.x * 0.19 - vTerrainWorldPos.z * 0.16);
        float detailBreakup = 0.90 + 0.10 * macroA + 0.05 * macroB;
        diffuseColor.rgb *= detailBreakup;

        // Exposed steep cliff stratified rock (anti-snow on cliffs)
        float slope = 1.0 - clamp(vTerrainWorldNorm.y, 0.0, 1.0);
        float cliffMask = smoothstep(0.18, 0.48, slope);
        vec3 rockTri = texture2D(uStoneMap, vTerrainWorldPos.xz * 0.11).rgb * 0.45 +
                       texture2D(uStoneMap, vec2(vTerrainWorldPos.x + vTerrainWorldPos.z, vTerrainWorldPos.y) * 0.16).rgb * 0.55;
        diffuseColor.rgb = mix(diffuseColor.rgb, rockTri * 0.55, cliffMask * 0.72);

        // Cobbled road detail overlay
        float roadMask = vBiomeData.x;
        if (roadMask > 0.02) {
          vec3 cobble = texture2D(uStoneMap, vTerrainWorldPos.xz * 0.24).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb, cobble * 0.68, roadMask * 0.78);
        }

        // Wet dark shore zone near sea level (y < 0.85)
        float wetness = 1.0 - smoothstep(-0.2, 0.9, vTerrainWorldPos.y);
        diffuseColor.rgb *= mix(1.0, 0.54, wetness);

        // Cool subsurface blue shadow scatter tint on snow
        float snowMask = vBiomeData.w * uSnowAmount;
        diffuseColor.rgb += vec3(0.04, 0.075, 0.13) * snowMask * 0.35;
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        float wetShore = 1.0 - smoothstep(-0.15, 0.85, vTerrainWorldPos.y);
        roughnessFactor = mix(roughnessFactor, 0.22, wetShore);
        // Subtle crystalline snow sparkle glints
        vec3 spN = texture2D(uSparkleNormal, vTerrainWorldPos.xz * 0.65).xyz * 2.0 - 1.0;
        float glint = pow(max(0.0, dot(normalize(vTerrainWorldNorm + spN * 0.5), normalize(vec3(0.35, 0.85, 0.35)))), 18.0);
        roughnessFactor = clamp(roughnessFactor - glint * vBiomeData.w * uSnowAmount * 0.35, 0.18, 0.96);
        `
      );
  });

  return mat;
}

/**
 * Adds top-facing snow accumulation + macro color variation to masonry, roofs, boulders, and fortress walls.
 */
export function applySnowAndMacroBreakup(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  snowUniforms: SnowShaderUniforms,
  opts: { snowBias?: number; macroStrength?: number; sparkleMap?: THREE.Texture } = {}
) {
  const snowBias = opts.snowBias ?? 0.42;
  const macroStrength = opts.macroStrength ?? 0.1;

  material.customProgramCacheKey = () => `aethelgard_snow_v2_${snowBias}_${macroStrength}`;
  chainOnBeforeCompile(material, (shader) => {
    shader.uniforms.uSnowAmount = snowUniforms.uSnowAmount;
    shader.uniforms.uSparkleMap = { value: opts.sparkleMap || null };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vAethelWorldPos;
        varying vec3 vAethelWorldNorm;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vAethelWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vAethelWorldNorm = normalize(mat3(modelMatrix) * objectNormal);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uSnowAmount;
        varying vec3 vAethelWorldPos;
        varying vec3 vAethelWorldNorm;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float macro = sin(vAethelWorldPos.x * 0.14 + vAethelWorldPos.z * 0.11) * 0.5
                    + cos(vAethelWorldPos.y * 0.25 - vAethelWorldPos.x * 0.08) * 0.5;
        diffuseColor.rgb *= (1.0 + macro * ${macroStrength.toFixed(3)});
        float upSlope = smoothstep(${snowBias.toFixed(2)}, ${(snowBias + 0.35).toFixed(2)}, vAethelWorldNorm.y) * uSnowAmount;
        vec3 snowTint = vec3(0.74, 0.82, 0.92) + macro * 0.04;
        diffuseColor.rgb = mix(diffuseColor.rgb, snowTint, upSlope * 0.68);`
      );
  });
}

/**
 * Rich iridescent Fresnel + inner core crystal shader material that achieves gem depth
 * WITHOUT triggering Three.js's expensive full-scene double-pass `transmissionRenderTarget`.
 */
export function createCrystalMaterial(
  baseHex: number,
  emissiveHex: number,
  emissiveIntensity = 1.65
): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: baseHex,
    emissive: emissiveHex,
    emissiveIntensity,
    roughness: 0.14,
    metalness: 0.08,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    ior: 1.65,
    reflectivity: 0.92,
    transparent: true,
    opacity: 0.92,
  });

  mat.customProgramCacheKey = () => 'aethelgard_crystal_fresnel';
  chainOnBeforeCompile(mat, (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `
      #include <emissivemap_fragment>
      float rimFresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.2);
      totalEmissiveRadiance *= (0.65 + rimFresnel * 1.45);
      `
    );
  });
  return mat;
}
