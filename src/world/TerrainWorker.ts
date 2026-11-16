import { BiomeId, SeasonType } from '../types/game';
import { generateChunkBuffers } from './TerrainHeightfield';

export interface TerrainWorkerRequest {
  jobId: number;
  cx: number;
  cz: number;
  centerX: number;
  centerZ: number;
  chunkSize: number;
  segments: number;
  biomeHealths: Record<BiomeId, number>;
  isWinter: boolean;
  season: SeasonType;
}

export interface TerrainWorkerResponse {
  jobId: number;
  cx: number;
  cz: number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  biomeAttr: Float32Array;
  indices: Uint32Array;
}

self.onmessage = (e: MessageEvent<TerrainWorkerRequest>) => {
  const req = e.data;
  const buffers = generateChunkBuffers(
    req.centerX,
    req.centerZ,
    req.chunkSize,
    req.segments,
    req.biomeHealths,
    req.isWinter,
    req.season
  );

  const response: TerrainWorkerResponse = {
    jobId: req.jobId,
    cx: req.cx,
    cz: req.cz,
    ...buffers,
  };

  (self as unknown as Worker).postMessage(response, [
    buffers.positions.buffer,
    buffers.normals.buffer,
    buffers.uvs.buffer,
    buffers.colors.buffer,
    buffers.biomeAttr.buffer,
    buffers.indices.buffer,
  ]);
};
