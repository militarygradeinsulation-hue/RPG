import * as THREE from 'three';
import { BiomeId, BiomeState, SeasonType } from '../types/game';
import {
  CHUNK_SEGMENTS,
  CHUNK_SIZE,
  generateChunkBuffers,
  groundHeightAt,
} from './TerrainHeightfield';
import type { TerrainWorkerRequest, TerrainWorkerResponse } from './TerrainWorker';

interface StreamedChunk {
  cx: number;
  cz: number;
  mesh: THREE.Mesh;
  pendingJobId: number;
}

/**
 * Hitch-free multi-chunk terrain streamer backed by a Web Worker (`TerrainWorker.ts`)
 * with synchronous initial seeding for the immediate spawn area and distant mountain horizon ring.
 */
export class ChunkStreamer {
  public readonly group = new THREE.Group();
  private chunks: StreamedChunk[] = [];
  private worker: Worker | null = null;
  private jobCounter = 1;
  private lastCx = 99999;
  private lastCz = 99999;
  private horizonRingMesh: THREE.Mesh | null = null;
  private readonly radius = 2; // 5x5 grid = 720m x 720m active detailed terrain

  constructor(
    private terrainMat: THREE.MeshStandardMaterial,
    initialOriginX: number,
    initialOriginZ: number
  ) {
    try {
      this.worker = new Worker(new URL('./TerrainWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<TerrainWorkerResponse>) => {
        this.applyWorkerGeometry(e.data);
      };
    } catch {
      this.worker = null;
    }

    this.buildHorizonMountainSkirt();
    void initialOriginX;
    void initialOriginZ;
  }

  private buildHorizonMountainSkirt(): void {
    // Low-poly distant mountain ring (r = 380..950m) that sits behind the active chunks
    // giving continuous alpine horizon depth even on Low preset.
    const radialSegs = 72;
    const rings = 3;
    const innerR = 360;
    const outerR = 960;
    const geo = new THREE.RingGeometry(innerR, outerR, radialSegs, rings);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const cols = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      const ang = Math.atan2(z, x);
      const ridge =
        Math.abs(Math.sin(ang * 7.0 + r * 0.01)) * 42 +
        Math.abs(Math.cos(ang * 13.0 - r * 0.008)) * 22;
      // Dip mountains into open ocean in the south sector (z > 140)
      const southSeaMask = z > 80 ? THREE.MathUtils.smoothstep(z, 80, 340) : 0;
      const distBlend = THREE.MathUtils.smoothstep(r, innerR, outerR);
      const y = (ridge * distBlend - 6) * (1 - southSeaMask * 0.96) - southSeaMask * 4;
      pos.setY(i, y);

      const snowT = THREE.MathUtils.smoothstep(y, 14, 34);
      cols[i * 3] = THREE.MathUtils.lerp(0.14, 0.45, snowT);
      cols[i * 3 + 1] = THREE.MathUtils.lerp(0.18, 0.54, snowT);
      cols[i * 3 + 2] = THREE.MathUtils.lerp(0.26, 0.68, snowT);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.02,
      flatShading: false,
    });
    this.horizonRingMesh = new THREE.Mesh(geo, mat);
    this.horizonRingMesh.receiveShadow = false;
    this.group.add(this.horizonRingMesh);
  }

  public initAround(
    worldX: number,
    worldZ: number,
    originX: number,
    originZ: number,
    biomes: Record<BiomeId, BiomeState>,
    season: SeasonType
  ): void {
    const cx = Math.round(worldX / CHUNK_SIZE);
    const cz = Math.round(worldZ / CHUNK_SIZE);
    this.lastCx = cx;
    this.lastCz = cz;

    const healths = this.extractHealths(biomes);
    const isWinter = season === 'Winter';

    for (let dz = -this.radius; dz <= this.radius; dz++) {
      for (let dx = -this.radius; dx <= this.radius; dx++) {
        const tcx = cx + dx;
        const tcz = cz + dz;
        const wx = tcx * CHUNK_SIZE;
        const wz = tcz * CHUNK_SIZE;
        const geo = new THREE.BufferGeometry();
        // Immediate 3x3 center synchronous so start screen & spawn never have blank holes;
        // outer ring streams asynchronously in Web Worker!
        const chunk: StreamedChunk = {
          cx: tcx,
          cz: tcz,
          mesh: new THREE.Mesh(geo, this.terrainMat),
          pendingJobId: 0,
        };
        chunk.mesh.receiveShadow = true;
        chunk.mesh.position.set(wx - originX, 0, wz - originZ);
        this.group.add(chunk.mesh);
        this.chunks.push(chunk);

        if (Math.abs(dx) === 0 && Math.abs(dz) === 0) {
          const buffers = generateChunkBuffers(wx, wz, CHUNK_SIZE, CHUNK_SEGMENTS, healths, isWinter, season);
          this.writeBuffersToGeometry(geo, buffers);
        } else {
          this.dispatchChunkJob(chunk, wx, wz, healths, isWinter, season);
        }
      }
    }

    if (this.horizonRingMesh) {
      this.horizonRingMesh.position.set(worldX - originX, 0, worldZ - originZ);
    }
  }

  public update(
    worldX: number,
    worldZ: number,
    originX: number,
    originZ: number,
    biomes: Record<BiomeId, BiomeState>,
    season: SeasonType
  ): boolean {
    if (this.horizonRingMesh) {
      this.horizonRingMesh.position.set(worldX - originX, 0, worldZ - originZ);
    }

    const nextCx = Math.round(worldX / CHUNK_SIZE);
    const nextCz = Math.round(worldZ / CHUNK_SIZE);
    if (nextCx === this.lastCx && nextCz === this.lastCz) return false;

    this.lastCx = nextCx;
    this.lastCz = nextCz;

    const needed: { cx: number; cz: number }[] = [];
    for (let dz = -this.radius; dz <= this.radius; dz++) {
      for (let dx = -this.radius; dx <= this.radius; dx++) {
        needed.push({ cx: nextCx + dx, cz: nextCz + dz });
      }
    }

    const toReuse = this.chunks.filter(
      (c) => !needed.some((n) => n.cx === c.cx && n.cz === c.cz)
    );
    const missing = needed.filter(
      (n) => !this.chunks.some((c) => c.cx === n.cx && c.cz === n.cz)
    );

    const healths = this.extractHealths(biomes);
    const isWinter = season === 'Winter';

    missing.forEach((coord, i) => {
      const chunk = toReuse[i];
      if (!chunk) return;
      chunk.cx = coord.cx;
      chunk.cz = coord.cz;
      const wx = coord.cx * CHUNK_SIZE;
      const wz = coord.cz * CHUNK_SIZE;
      chunk.mesh.position.set(wx - originX, 0, wz - originZ);
      // Never show an old chunk's geometry at new world coordinates.
      chunk.mesh.visible = false;
      this.dispatchChunkJob(chunk, wx, wz, healths, isWinter, season);
    });

    return true;
  }

  public refreshVisibleChunks(
    originX: number,
    originZ: number,
    biomes: Record<BiomeId, BiomeState>,
    season: SeasonType
  ): void {
    const healths = this.extractHealths(biomes);
    const isWinter = season === 'Winter';
    this.chunks.forEach((chunk) => {
      const wx = chunk.cx * CHUNK_SIZE;
      const wz = chunk.cz * CHUNK_SIZE;
      chunk.mesh.position.set(wx - originX, 0, wz - originZ);
      this.dispatchChunkJob(chunk, wx, wz, healths, isWinter, season);
    });
  }

  private dispatchChunkJob(
    chunk: StreamedChunk,
    wx: number,
    wz: number,
    healths: Record<BiomeId, number>,
    isWinter: boolean,
    season: SeasonType
  ): void {
    const jobId = ++this.jobCounter;
    chunk.pendingJobId = jobId;
    if (this.worker) {
      const req: TerrainWorkerRequest = {
        jobId,
        cx: chunk.cx,
        cz: chunk.cz,
        centerX: wx,
        centerZ: wz,
        chunkSize: CHUNK_SIZE,
        segments: CHUNK_SEGMENTS,
        biomeHealths: healths,
        isWinter,
        season,
      };
      this.worker.postMessage(req);
    } else {
      const buffers = generateChunkBuffers(wx, wz, CHUNK_SIZE, CHUNK_SEGMENTS, healths, isWinter, season);
      this.writeBuffersToGeometry(chunk.mesh.geometry, buffers);
      chunk.mesh.visible = true;
    }
  }

  private applyWorkerGeometry(res: TerrainWorkerResponse): void {
    const chunk = this.chunks.find(
      (c) => c.cx === res.cx && c.cz === res.cz && c.pendingJobId === res.jobId
    );
    if (!chunk) return;
    this.writeBuffersToGeometry(chunk.mesh.geometry, res);
    chunk.mesh.visible = true;
  }

  private writeBuffersToGeometry(
    geo: THREE.BufferGeometry,
    buffers: {
      positions: Float32Array;
      normals: Float32Array;
      uvs: Float32Array;
      colors: Float32Array;
      biomeAttr: Float32Array;
      indices: Uint32Array;
    }
  ): void {
    geo.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(buffers.uvs, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3));
    geo.setAttribute('aBiomeData', new THREE.BufferAttribute(buffers.biomeAttr, 4));
    geo.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
    geo.computeBoundingSphere();
  }

  private extractHealths(biomes: Record<BiomeId, BiomeState>): Record<BiomeId, number> {
    return {
      suncrest: biomes.suncrest?.health ?? 50,
      verdant: biomes.verdant?.health ?? 50,
      ember: biomes.ember?.health ?? 50,
      aether: biomes.aether?.health ?? 50,
    };
  }

  public dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.chunks.forEach((c) => c.mesh.geometry.dispose());
    this.horizonRingMesh?.geometry.dispose();
    (this.horizonRingMesh?.material as THREE.Material | undefined)?.dispose();
  }
}

void groundHeightAt;
