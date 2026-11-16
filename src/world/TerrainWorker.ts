import { BiomeId, SeasonType } from '../types/game';
import { generateChunkBuffers } from './TerrainHeightfield';

export interface TerrainWorkerRequest {
  jobId: number;
  generation: number;
  priority?: number;
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

// Only process the newest request for each chunk coordinate. Yield between
// jobs so new player positions can reprioritize the worker's queue.
const pending = new Map<string, TerrainWorkerRequest>();
let scheduled = false;
let latestGeneration = 0;

function processNext(): void {
  scheduled = false;
  if (pending.size === 0) return;

  let chosenKey = '';
  let chosen: TerrainWorkerRequest | null = null;
  for (const [key, req] of pending) {
    if (!chosen || (req.priority ?? 100) < (chosen.priority ?? 100) ||
        ((req.priority ?? 100) === (chosen.priority ?? 100) && req.jobId > chosen.jobId)) {
      chosen = req;
      chosenKey = key;
    }
  }
  if (!chosen) return;
  pending.delete(chosenKey);

  const buffers = generateChunkBuffers(
    chosen.centerX,
    chosen.centerZ,
    chosen.chunkSize,
    chosen.segments,
    chosen.biomeHealths,
    chosen.isWinter,
    chosen.season
  );
  const response: TerrainWorkerResponse = {
    jobId: chosen.jobId,
    cx: chosen.cx,
    cz: chosen.cz,
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
  scheduleNext();
}

function scheduleNext(): void {
  if (scheduled || pending.size === 0) return;
  scheduled = true;
  setTimeout(processNext, 0);
}

self.onmessage = (e: MessageEvent<TerrainWorkerRequest>) => {
  const req = e.data;
  // A full visible-set refresh supersedes older queued terrain jobs. Jobs
  // already rendering may finish, but their generation IDs are checked by
  // ChunkStreamer and cannot overwrite newer geometry.
  if (req.generation < latestGeneration) return;
  if (req.generation > latestGeneration) {
    latestGeneration = req.generation;
    pending.clear();
  }
  pending.set(`${req.cx}:${req.cz}`, req);
  scheduleNext();
};
