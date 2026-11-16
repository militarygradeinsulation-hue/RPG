import * as THREE from 'three';
import { groundHeightAt, WATER_LEVEL } from '../world/TerrainHeightfield';
import { OceanWaveSampler } from '../world/ocean/OceanWaveSampler';
import { ShipRuntime } from './ships/ShipPhysics';

export interface CircleCollider {
  x: number;
  z: number;
  radius: number;
}

export interface IceBridgePatch {
  x: number;
  z: number;
  radius: number;
}

export interface DungeonBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface PlayerPhysicsResult {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  vy: number;
  isGrounded: boolean;
  isSwimming: boolean;
  isUnderwater: boolean;
  isClimbing: boolean;
  isOnShipId: string | null;
}

/**
 * Deterministic fixed-timestep player locomotion & collision solver:
 * - Overworld capsule sliding against static stone/building colliders & steep cliffs
 * - Ice bridge walkable elevation support over lakes/rivers
 * - Ship deck boarding & relative movement when walking on ships
 * - Swimming surface buoyancy & 3D underwater diving (Space rise, C dive)
 */
export function stepPlayerPhysics(params: {
  dt: number;
  elapsed: number;
  x: number;
  y: number;
  z: number;
  vy: number;
  moveDirX: number;
  moveDirZ: number;
  speed: number;
  isGrounded: boolean;
  isCrouching: boolean;
  isClimbing: boolean;
  ascendHeld: boolean;
  diveHeld: boolean;
  activeDungeon: DungeonBounds | null;
  colliders: CircleCollider[];
  iceBridges: IceBridgePatch[];
  ships: ShipRuntime[];
  waveSampler: OceanWaveSampler;
}): PlayerPhysicsResult {
  const {
    dt,
    elapsed,
    moveDirX,
    moveDirZ,
    speed,
    ascendHeld,
    diveHeld,
    activeDungeon,
    colliders,
    iceBridges,
    ships,
    waveSampler,
  } = params;

  let x = params.x;
  let y = params.y;
  let z = params.z;
  let vy = params.vy;
  let isGrounded = params.isGrounded;
  let isSwimming = false;
  let isUnderwater = false;
  let isOnShipId: string | null = null;

  if (params.isClimbing) {
    // Climbing handled vertically along climb tower wall
    return {
      x,
      y,
      z,
      vx: moveDirX * 2.0,
      vz: moveDirZ * 2.0,
      vy: ascendHeld ? 4.4 : 0,
      isGrounded: false,
      isSwimming: false,
      isUnderwater: false,
      isClimbing: true,
      isOnShipId: null,
    };
  }

  let nextX = x + moveDirX * speed * dt;
  let nextZ = z + moveDirZ * speed * dt;

  if (activeDungeon) {
    nextX = THREE.MathUtils.clamp(nextX, activeDungeon.minX, activeDungeon.maxX);
    nextZ = THREE.MathUtils.clamp(nextZ, activeDungeon.minZ, activeDungeon.maxZ);
    x = nextX;
    z = nextZ;

    vy -= 22.0 * dt;
    y += vy * dt;
    if (y <= 0.05) {
      y = 0.05;
      vy = 0;
      isGrounded = true;
    }
    return {
      x,
      y,
      z,
      vx: moveDirX * speed,
      vz: moveDirZ * speed,
      vy,
      isGrounded,
      isSwimming: false,
      isUnderwater: false,
      isClimbing: false,
      isOnShipId: null,
    };
  }

  // Overworld horizontal cylinder collider sliding
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const dx = nextX - c.x;
    const dz = nextZ - c.z;
    const dist = Math.hypot(dx, dz);
    if (dist < c.radius + 0.52 && dist > 0.001) {
      const push = (c.radius + 0.52 - dist) / dist;
      nextX += dx * push;
      nextZ += dz * push;
    }
  }

  // Check if player stands on a floating ship deck
  let deckHeight = -999;
  for (const s of ships) {
    if (s.hull <= 0) continue;
    const dx = nextX - s.x;
    const dz = nextZ - s.z;
    const cosH = Math.cos(s.heading);
    const sinH = Math.sin(s.heading);
    // Project into ship local deck coordinates
    const localX = dx * cosH - dz * sinH;
    const localZ = dx * sinH + dz * cosH;
    if (Math.abs(localX) <= s.parts.deckWidth * 0.55 && Math.abs(localZ) <= s.parts.deckLength * 0.52) {
      const h = s.y + s.parts.deckY;
      if (y >= h - 1.35) {
        deckHeight = Math.max(deckHeight, h);
        isOnShipId = s.id;
      }
    }
  }

  // Check harbor pier wooden deck height at Suncrest Haven (-22, 86..108) & Cinderwash (94, 96..118)
  let pierHeight = -999;
  const checkPier = (px: number, startZ: number, endZ: number) => {
    if (Math.abs(nextX - px) < 2.85 && nextZ >= startZ && nextZ <= endZ) {
      pierHeight = Math.max(pierHeight, WATER_LEVEL + 1.28);
    }
  };
  checkPier(-22, 85, 109);
  checkPier(94, 95, 119);

  // Ice bridges created by Frost magic
  let iceHeight = -999;
  for (let i = 0; i < iceBridges.length; i++) {
    const ib = iceBridges[i];
    if (Math.hypot(nextX - ib.x, nextZ - ib.z) <= ib.radius) {
      iceHeight = WATER_LEVEL + 0.28;
    }
  }

  const bedY = groundHeightAt(nextX, nextZ);
  const floorY = Math.max(bedY, deckHeight, pierHeight, iceHeight);

  // Wave surface at player position
  const waterDepth = Math.max(0, WATER_LEVEL - bedY);
  const waveY =
    WATER_LEVEL + waveSampler.sampleHeight(nextX, nextZ, elapsed, THREE.MathUtils.clamp(waterDepth / 2.2, 0.14, 1.0));

  // Enter swim/dive mode when floor is submerged > 0.72m and player is not standing on pier/ship/ice
  const onDryStructure = deckHeight > -900 || pierHeight > -900 || iceHeight > -900;
  if (!onDryStructure && floorY < waveY - 0.72 && y < waveY + 0.45) {
    isSwimming = true;
    const swimSurfaceY = waveY - 0.92;
    if (diveHeld) {
      vy = THREE.MathUtils.lerp(vy, -4.4, Math.min(1, dt * 7));
    } else if (ascendHeld) {
      vy = THREE.MathUtils.lerp(vy, 4.8, Math.min(1, dt * 7));
    } else {
      // Gentle buoyancy restoring toward surface when not diving deeply
      const diff = swimSurfaceY - y;
      vy = THREE.MathUtils.lerp(vy, THREE.MathUtils.clamp(diff * 4.5, -2.5, 4.0), Math.min(1, dt * 5));
    }
    y += vy * dt;
    if (y > waveY - 0.35 && ascendHeld) {
      // Swim-hop out onto nearby shore / ship
      vy = 5.4;
    }
    if (y < bedY + 0.25) {
      y = bedY + 0.25;
      vy = Math.max(0, vy);
    }
    isUnderwater = y < waveY - 1.35;
    isGrounded = false;
  } else {
    vy -= 22.0 * dt;
    y += vy * dt;
    if (y <= floorY + 0.04) {
      y = floorY;
      vy = 0;
      isGrounded = true;
    } else if (y > floorY + 0.22) {
      isGrounded = false;
    }
  }

  return {
    x: nextX,
    y,
    z: nextZ,
    vx: moveDirX * speed,
    vz: moveDirZ * speed,
    vy,
    isGrounded,
    isSwimming,
    isUnderwater,
    isClimbing: false,
    isOnShipId,
  };
}
