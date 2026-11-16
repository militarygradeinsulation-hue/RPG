export {
  WATER_LEVEL,
  CHUNK_SIZE,
  CHUNK_SEGMENTS,
  getBiomeAt,
  groundHeightAt,
  isWaterAt,
  computeTerrainSlope,
  getRoadMaskAt,
  NAMED_ISLANDS,
  ROAD_SEGMENTS,
} from '../world/TerrainHeightfield';

export type { PBRTextureSet } from '../render/MaterialLibrary';
export {
  createStonePBRTextures,
  createWoodPBRTextures,
  createTerrainDetailTextures,
  createSnowSparkleNormalMap,
  createProceduralNightEquirectEnv,
} from '../render/MaterialLibrary';
