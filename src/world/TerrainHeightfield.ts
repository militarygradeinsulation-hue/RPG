import { BiomeId } from '../types/game';

export const WATER_LEVEL = 0.0;
export const CHUNK_SIZE = 144;
export const CHUNK_SEGMENTS = 64;

export interface IslandDef {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  height: number;
  biome: BiomeId;
  hasHarbor?: boolean;
  hasWreck?: boolean;
  hasLighthouse?: boolean;
}

export const NAMED_ISLANDS: IslandDef[] = [
  { id: 'isle_coral', name: 'Emerald Coral Atoll', x: -118, z: 168, radius: 34, height: 7.5, biome: 'verdant', hasHarbor: true },
  { id: 'isle_basalt', name: 'Cinderrock Anchorage', x: 112, z: 162, radius: 38, height: 11.2, biome: 'ember', hasLighthouse: true },
  { id: 'isle_siren', name: 'Siren’s Crown Isle', x: -12, z: 235, radius: 44, height: 14.5, biome: 'aether', hasHarbor: true, hasLighthouse: true },
  { id: 'isle_frostfang', name: 'Frostfang Outer Bastion', x: -195, z: 105, radius: 40, height: 13.0, biome: 'aether', hasWreck: true },
  { id: 'isle_smuggler', name: 'Smuggler’s Reef', x: 185, z: 228, radius: 30, height: 8.4, biome: 'ember', hasWreck: true },
  // Outer sea expansion: distinct discoverable destinations whose height,
  // biome, minimap marker, and landmark generation share the same source data.
  { id: 'isle_moonveil', name: 'Moonveil Sanctuary', x: -275, z: 330, radius: 47, height: 18.0, biome: 'aether', hasLighthouse: true },
  { id: 'isle_thornwild', name: 'Thornwild Expanse', x: -90, z: 405, radius: 58, height: 17.5, biome: 'verdant', hasWreck: true },
  { id: 'isle_ashen', name: 'Ashen Crown Caldera', x: 225, z: 365, radius: 51, height: 22.0, biome: 'ember', hasLighthouse: true },
  { id: 'isle_storm', name: 'Stormglass Reach', x: 35, z: 530, radius: 43, height: 15.0, biome: 'aether', hasWreck: true },
];

export const ROAD_SEGMENTS: ReadonlyArray<{ ax: number; az: number; bx: number; bz: number; width: number }> = [
  // Central Citadel to Verdant Vale
  { ax: 0, az: 0, bx: -64, bz: 48, width: 3.4 },
  // Central Citadel to Ember Crag
  { ax: 0, az: 0, bx: 68, bz: 46, width: 3.4 },
  // Central Citadel to Aether Spire
  { ax: 0, az: 0, bx: 0, bz: -74, width: 3.6 },
  // Southern King's Harbor Road down to Suncrest Haven Harbor
  { ax: 0, az: 8, bx: -22, bz: 92, width: 3.8 },
  // Coastal trail Verdant Port -> Suncrest Haven
  { ax: -64, az: 48, bx: -22, bz: 92, width: 3.0 },
  // Eastern Outpost to Ember Docks
  { ax: 68, az: 46, bx: 94, bz: 102, width: 3.0 },
];

function fract(x: number): number {
  return x - Math.floor(x);
}

export function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function valueNoise2D(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function fbm2D(x: number, y: number, octaves = 4): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * (valueNoise2D(x * freq, y * freq) * 2 - 1);
    freq *= 2.03;
    amp *= 0.5;
  }
  return val;
}

export function ridged2D(x: number, y: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise2D(x * freq, y * freq) * 2 - 1);
    sum += n * n * amp;
    freq *= 2.1;
    amp *= 0.5;
  }
  return sum;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { dist: number; t: number } {
  const vx = bx - ax;
  const vz = bz - az;
  const lenSq = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / lenSq));
  const cx = ax + vx * t;
  const cz = az + vz * t;
  return { dist: Math.hypot(px - cx, pz - cz), t };
}

export function getRoadMaskAt(x: number, z: number): number {
  // Keep shrine plaza radial stone pad
  const distCenter = Math.hypot(x, z);
  if (distCenter < 15.5) return 1.0;

  let maxMask = 0;
  for (let i = 0; i < ROAD_SEGMENTS.length; i++) {
    const r = ROAD_SEGMENTS[i];
    const { dist } = distToSegment(x, z, r.ax, r.az, r.bx, r.bz);
    if (dist < r.width + 1.8) {
      const m = 1 - smoothstep(r.width * 0.55, r.width + 1.8, dist);
      if (m > maxMask) maxMask = m;
    }
  }
  return maxMask;
}

export function getBiomeAt(x: number, z: number): BiomeId {
  const dist = Math.hypot(x, z);
  if (dist < 44) return 'suncrest';
  if (z < -36 && Math.abs(x) < Math.abs(z) * 1.15) return 'aether';
  if (x < 0) return 'verdant';
  return 'ember';
}

export function groundHeightAt(x: number, z: number): number {
  const distFromCenter = Math.hypot(x, z);

  // 1. Domain-warped organic rolling relief + snow-drifted micro terrain
  const warpX = fbm2D(x * 0.0055 + 3.1, z * 0.0055 - 1.7, 2) * 18;
  const warpZ = fbm2D(x * 0.0055 - 4.2, z * 0.0055 + 2.9, 2) * 18;
  const wx = x + warpX;
  const wz = z + warpZ;

  let h =
    fbm2D(wx * 0.011, wz * 0.011, 4) * 9.5 +
    Math.sin(x * 0.029) * Math.cos(z * 0.029) * 1.9 +
    Math.sin(x * 0.21 + Math.cos(z * 0.17) * 1.6) * 0.22;

  // 2. Alpine ridged mountain chains north/northwest/northeast (sky-line silhouette depth)
  if (z < -32 || distFromCenter > 105) {
    const northMask = smoothstep(-30, -145, z);
    const farLandMask = smoothstep(105, 195, distFromCenter) * (1 - smoothstep(75, 145, z));
    const ridgeWeight = Math.max(northMask, farLandMask * 0.72);
    const mountains = ridged2D(wx * 0.0085 + 7.2, wz * 0.0085 - 3.4, 3) * 26.0;
    h += ridgeWeight * mountains;
  }

  // 3. Ember Crag volcanic highland plateaus on the east
  if (x > 20 && z > -40 && z < 115) {
    const emberMask = smoothstep(20, 66, x) * smoothstep(-40, 20, z) * (1 - smoothstep(82, 118, z));
    const basaltPlateau = ridged2D(x * 0.014, z * 0.014, 2) * 7.2;
    h += emberMask * (3.6 + basaltPlateau * 0.6);
  }

  // 4. Meandering western Verdant River flowing down into the Southern Sea
  const riverCurveX = -34 + Math.sin(z * 0.036) * 14 + Math.cos(z * 0.013) * 10;
  const distRiver = Math.abs(x - riverCurveX);
  if (distRiver < 10.5 && z > -80) {
    const carve = 1 - smoothstep(3.2, 10.5, distRiver);
    h -= carve * 4.2;
  }

  // 5. Eastern volcanic fjord / ash gorge
  const gorgeCurveX = 128 + Math.cos(z * 0.032) * 16;
  const distGorge = Math.abs(x - gorgeCurveX);
  if (distGorge < 11 && z < 130) {
    const carve = 1 - smoothstep(3.4, 11, distGorge);
    h -= carve * 4.4;
  }

  // 6. Aether Crystal Lake moat around northern spire (0, -74)
  const distAetherCenter = Math.hypot(x, z + 74);
  if (distAetherCenter > 9.5 && distAetherCenter < 25) {
    const moat = 1 - Math.abs(distAetherCenter - 17) / 7.5;
    h -= Math.max(0, moat) * 3.1;
  }
  if (distAetherCenter < 11) {
    h += (1 - smoothstep(5, 11, distAetherCenter)) * 2.8;
  }

  // 7. Southern Kingdom Coastline -> Deep Navigable Sapphire Ocean (z > ~86) + Western Sea Shelf
  const coastSin = Math.sin(x * 0.022) * 12 + Math.cos(x * 0.051) * 5;
  const coastZ = 88 + coastSin;
  // Harbor cove indentation gently welcomes ships near (-22, 92) and (94, 102)
  const distSuncrestHaven = Math.hypot(x + 22, z - 92);
  const havenBay = (1 - smoothstep(14, 34, distSuncrestHaven)) * (z > 82 ? 1.8 : 0);

  let oceanShelfDrop = 0;
  if (z > coastZ - 14) {
    const tSea = smoothstep(coastZ - 14, coastZ + 38, z);
    oceanShelfDrop = tSea * 14.8 + havenBay;
  }
  // Open sea also expands beyond far eastern & western edges south of z=0
  if (Math.abs(x) > 155 && z > 15) {
    const sideSea = smoothstep(155, 225, Math.abs(x)) * smoothstep(15, 70, z);
    oceanShelfDrop = Math.max(oceanShelfDrop, sideSea * 14.5);
  }

  // Suncrest Keep central plaza & Shrine hilltop flattening
  const keepFlatten = smoothstep(15.5, 36, distFromCenter);
  let baseHeight = keepFlatten * (h + 1.55) + (1 - keepFlatten) * 1.55;
  baseHeight -= oceanShelfDrop;

  // 8. Offshore Archipelago Islands (Named + Seeded Infinite Ocean Islands)
  for (let i = 0; i < NAMED_ISLANDS.length; i++) {
    const isl = NAMED_ISLANDS[i];
    const d = Math.hypot(x - isl.x, z - isl.z);
    if (d < isl.radius * 1.35) {
      const cone = 1 - smoothstep(isl.radius * 0.18, isl.radius * 1.28, d);
      const ridge = ridged2D(x * 0.032 + i * 5, z * 0.032, 2) * isl.height * 0.55;
      const islandElev = cone * (isl.height + 5.5 + ridge);
      baseHeight = Math.max(baseHeight, -11.5 + islandElev);
    }
  }

  // Deterministic endless procedural islands in outer deep sea (grid cells 220m x 220m)
  if (z > 240 || Math.abs(x) > 250) {
    const cellSize = 220;
    const cx = Math.floor(x / cellSize);
    const cz = Math.floor(z / cellSize);
    const cellSeed = hash2(cx * 3.17, cz * 7.41);
    if (cellSeed > 0.56) {
      const ix = (cx + 0.25 + fract(cellSeed * 13.7) * 0.5) * cellSize;
      const iz = (cz + 0.25 + fract(cellSeed * 29.3) * 0.5) * cellSize;
      const rad = 26 + fract(cellSeed * 41.1) * 28;
      const d = Math.hypot(x - ix, z - iz);
      if (d < rad * 1.35) {
        const cone = 1 - smoothstep(rad * 0.2, rad * 1.3, d);
        const peak = 11 + fract(cellSeed * 19.9) * 10 + ridged2D(x * 0.028, z * 0.028, 2) * 5;
        baseHeight = Math.max(baseHeight, -11 + cone * peak);
      }
    }
  }

  // 9. Smoothly grade Harbor forecourts & Cave forecourts so architecture sits flush
  const flatPads: Array<[number, number, number, number]> = [
    [-22, 86, 9, 1.35], // Suncrest Haven Harbor Quay
    [94, 96, 8, 1.4],   // Ember Docks Quay
    [32, -28, 7, 1.8],  // Cave portals
    [-58, 62, 7, 1.6],
    [72, 58, 7, 2.2],
    [-28, -88, 7, 2.0],
  ];
  for (const [fx, fz, radius, minTarget] of flatPads) {
    const d = Math.hypot(x - fx, z - fz);
    if (d < radius) {
      const blend = 1 - smoothstep(radius * 0.4, radius, d);
      const target = Math.max(minTarget, baseHeight);
      baseHeight = baseHeight * (1 - blend * 0.72) + target * (blend * 0.72);
    }
  }

  // Gentle road crown grading (keeps roads dry above riverbanks & walkable over hills)
  const roadMask = getRoadMaskAt(x, z);
  if (roadMask > 0.02 && z < 84) {
    const minDry = WATER_LEVEL + 0.85;
    if (baseHeight < minDry) {
      baseHeight = baseHeight * (1 - roadMask * 0.75) + minDry * (roadMask * 0.75);
    }
  }

  return baseHeight;
}

export function isWaterAt(x: number, z: number): boolean {
  return groundHeightAt(x, z) < WATER_LEVEL - 0.04;
}

export function computeTerrainSlope(x: number, z: number): number {
  const h = groundHeightAt(x, z);
  const hx = groundHeightAt(x + 0.9, z) - h;
  const hz = groundHeightAt(x, z + 0.9) - h;
  return Math.min(1, Math.hypot(hx, hz) * 1.15);
}

/**
 * Computes chunk vertex positions, normals, and attribute channels (`color` + `aBiomeData`)
 * directly into typed arrays so it can run inside the Web Worker OR synchronously on main thread.
 */
export function generateChunkBuffers(
  centerX: number,
  centerZ: number,
  chunkSize: number,
  segments: number,
  biomeHealths: Record<BiomeId, number>,
  isWinter: boolean,
  season: 'Spring' | 'Summer' | 'Autumn' | 'Winter'
): {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  biomeAttr: Float32Array;
  indices: Uint32Array;
} {
  const gridX = segments + 1;
  const gridZ = segments + 1;
  const count = gridX * gridZ;

  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const colors = new Float32Array(count * 3);
  // aBiomeData: x = roadMask (0..1), y = moisture/verdant lushness (0..1), z = volcanic ember glow/ash (0..1), w = snow cover (0..1)
  const biomeAttr = new Float32Array(count * 4);

  const half = chunkSize * 0.5;
  let ptr = 0;
  for (let iz = 0; iz < gridZ; iz++) {
    const vz = iz / segments;
    const localZ = (vz - 0.5) * chunkSize;
    const wz = centerZ + localZ;
    for (let ix = 0; ix < gridX; ix++) {
      const vx = ix / segments;
      const localX = (vx - 0.5) * chunkSize;
      const wx = centerX + localX;

      const y = groundHeightAt(wx, wz);
      const hx = groundHeightAt(wx + 0.85, wz);
      const hxm = groundHeightAt(wx - 0.85, wz);
      const hz = groundHeightAt(wx, wz + 0.85);
      const hzm = groundHeightAt(wx, wz - 0.85);

      const dx = (hxm - hx) / 1.7;
      const dz = (hzm - hz) / 1.7;
      const ny = 1.0;
      const invLen = 1 / Math.hypot(dx, ny, dz);
      const nx = dx * invLen;
      const nny = ny * invLen;
      const nz = dz * invLen;
      const slope = 1 - nny;

      positions[ptr * 3] = localX;
      positions[ptr * 3 + 1] = y;
      positions[ptr * 3 + 2] = localZ;

      normals[ptr * 3] = nx;
      normals[ptr * 3 + 1] = nny;
      normals[ptr * 3 + 2] = nz;

      uvs[ptr * 2] = wx * 0.08;
      uvs[ptr * 2 + 1] = wz * 0.08;

      const biome = getBiomeAt(wx, wz);
      const healthRatio = (biomeHealths[biome] ?? 50) / 100;
      const roadMask = zRoadCheck(wx, wz, y);
      const driftMacro = Math.sin(wx * 0.075 + wz * 0.048) * 0.5 + 0.5;

      let r = 0.35;
      let g = 0.42;
      let b = 0.32;
      let snowCover = 0.0;
      let volcanicWeight = 0.0;
      let lushWeight = 0.0;

      if (y < WATER_LEVEL + 0.65) {
        // Sandy coastal shore & seabed sediment
        const drySand = smoothstep(WATER_LEVEL - 1.2, WATER_LEVEL + 0.65, y);
        r = 0.28 + drySand * 0.34;
        g = 0.27 + drySand * 0.3;
        b = 0.24 + drySand * 0.19;
        snowCover = 0;
      } else if (biome === 'suncrest') {
        if (isWinter) {
          r = 0.42 + driftMacro * 0.16;
          g = 0.49 + driftMacro * 0.16;
          b = 0.58 + driftMacro * 0.16;
          snowCover = 0.92;
        } else {
          r = 0.2 + (1 - healthRatio) * 0.08;
          g = 0.22 + healthRatio * 0.2;
          b = 0.18 + (1 - healthRatio) * 0.06;
          lushWeight = healthRatio * 0.6;
        }
      } else if (biome === 'verdant') {
        lushWeight = healthRatio;
        if (isWinter) {
          r = 0.39 + driftMacro * 0.14;
          g = 0.48 + driftMacro * 0.14;
          b = 0.56 + driftMacro * 0.15;
          snowCover = 0.78;
        } else if (season === 'Autumn') {
          r = 0.18 + healthRatio * 0.26;
          g = 0.16 + healthRatio * 0.15;
          b = 0.2 + (1 - healthRatio) * 0.08;
        } else {
          r = 0.16 * (1 - healthRatio) + 0.14 * healthRatio;
          g = 0.14 * (1 - healthRatio) + 0.38 * healthRatio;
          b = 0.22 * (1 - healthRatio) + 0.16 * healthRatio;
        }
      } else if (biome === 'ember') {
        volcanicWeight = 1.0 - healthRatio * 0.35;
        r = 0.18 + healthRatio * 0.16 + (y > 5 ? 0.1 : 0);
        g = 0.13 + healthRatio * 0.11;
        b = 0.14 + (isWinter ? 0.12 : 0.02);
        if (isWinter && y > 6.5) snowCover = 0.38;
      } else {
        // Aether Spire northern alpine glaciers & highland slate
        snowCover = isWinter ? 0.95 : smoothstep(5.5, 11.5, y) * 0.75;
        r = 0.28 + snowCover * 0.26;
        g = 0.36 + snowCover * 0.24;
        b = 0.48 + snowCover * 0.22;
      }

      // Snow altitude line even outside Winter on high alpine peaks
      if (y > 9.5) {
        const altSnow = smoothstep(9.5, 16.5, y);
        snowCover = Math.max(snowCover, altSnow * (1 - volcanicWeight * 0.55));
      }

      // Steep rocky cliff face sheds snow & reveals dark basalt/granite
      const rockExpose = smoothstep(0.16, 0.44, slope);
      snowCover *= 1 - rockExpose * 0.92;
      if (rockExpose > 0.05) {
        const rockR = 0.2;
        const rockG = 0.23;
        const rockB = 0.27;
        r = r * (1 - rockExpose) + rockR * rockExpose;
        g = g * (1 - rockExpose) + rockG * rockExpose;
        b = b * (1 - rockExpose) + rockB * rockExpose;
      }

      // Cobbled road surface tint
      if (roadMask > 0.05) {
        const roadR = 0.27;
        const roadG = 0.28;
        const roadB = 0.31;
        r = r * (1 - roadMask * 0.75) + roadR * (roadMask * 0.75);
        g = g * (1 - roadMask * 0.75) + roadG * (roadMask * 0.75);
        b = b * (1 - roadMask * 0.75) + roadB * (roadMask * 0.75);
        snowCover *= 1 - roadMask * 0.68;
      }

      const micro = Math.sin(wx * 0.39) * Math.cos(wz * 0.39) * 0.025;
      colors[ptr * 3] = Math.max(0, Math.min(1, r + micro));
      colors[ptr * 3 + 1] = Math.max(0, Math.min(1, g + micro));
      colors[ptr * 3 + 2] = Math.max(0, Math.min(1, b + micro));

      biomeAttr[ptr * 4] = roadMask;
      biomeAttr[ptr * 4 + 1] = lushWeight;
      biomeAttr[ptr * 4 + 2] = volcanicWeight;
      biomeAttr[ptr * 4 + 3] = snowCover;

      void half;
      ptr++;
    }
  }

  const indices = new Uint32Array(segments * segments * 6);
  let iPtr = 0;
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * gridX + ix;
      const b = a + 1;
      const c = (iz + 1) * gridX + ix;
      const d = c + 1;
      indices[iPtr++] = a;
      indices[iPtr++] = c;
      indices[iPtr++] = b;
      indices[iPtr++] = b;
      indices[iPtr++] = c;
      indices[iPtr++] = d;
    }
  }

  return { positions, normals, uvs, colors, biomeAttr, indices };
}

function zRoadCheck(wx: number, wz: number, y: number): number {
  if (y < WATER_LEVEL + 0.15) return 0;
  return getRoadMaskAt(wx, wz);
}
