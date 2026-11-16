import * as THREE from 'three';
import physicsConfig from '../data/physics.json';
import { computeTerrainSlope, groundHeightAt, WATER_LEVEL } from '../world/TerrainHeightfield';
import { OceanWaveSampler } from '../world/ocean/OceanWaveSampler';
import { ShipRuntime } from './ships/ShipPhysics';

export interface CircleCollider {
  x: number;
  z: number;
  radius: number;
  height?: number;
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
  fallImpactHeight: number;
}

/**
 * Deterministic fixed-timestep player locomotion & collision solver (Laws 1 & 2):
 * - Uses data-driven tuning from /src/data/physics.json
 * - Overworld capsule sliding against static stone/building/tree/boulder colliders & steep cliffs (>45 deg)
 * - Surface wading & deep-snow friction/speed modifiers
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
  extraColliders?: CircleCollider[];
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
    extraColliders,
    iceBridges,
    ships,
    waveSampler,
  } = params;

  let x = params.x;
  let y = params.y;
  let z = params.z;
  let vy = params.vy;
  const wasGrounded = params.isGrounded;
  let isGrounded = params.isGrounded;
  let isSwimming = false;
  let isUnderwater = false;
  let isOnShipId: string | null = null;
  let fallImpactHeight = 0;

  if (params.isClimbing) {
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
      fallImpactHeight: 0,
    };
  }

  // Surface speed modifier (wading in shallow water slows 25% per Section 2.5)
  const currentBedY = activeDungeon ? 0 : groundHeightAt(x, z);
  const wadingDepth = activeDungeon ? 0 : Math.max(0, WATER_LEVEL - currentBedY);
  const surfaceMult = wadingDepth > 0.18 && wadingDepth < 0.72 ? physicsConfig.surfaceSpeedMultipliers.water : 1.0;

  // Steep slope resistance (>45 deg slope gently slides player downhill per Section 2.1)
  let nextX = x + moveDirX * speed * surfaceMult * dt;
  let nextZ = z + moveDirZ * speed * surfaceMult * dt;

  if (activeDungeon) {
    nextX = THREE.MathUtils.clamp(nextX, activeDungeon.minX, activeDungeon.maxX);
    nextZ = THREE.MathUtils.clamp(nextZ, activeDungeon.minZ, activeDungeon.maxZ);
    x = nextX;
    z = nextZ;

    vy -= physicsConfig.gravityMps2 * 2.15 * dt;
    const preLandingVy = vy;
    y += vy * dt;
    if (y <= 0.05) {
      if (!wasGrounded && preLandingVy < -9.5) {
        fallImpactHeight = (preLandingVy * preLandingVy) / (2 * physicsConfig.gravityMps2 * 2.15);
      }
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
      fallImpactHeight,
    };
  }

  // Sweep each axis separately, then resolve residual overlap. Independent axis
  // movement allows the player to slide along obstacles instead of snapping
  // diagonally away from them. Include the degenerate exact-centre case.
  const playerRadius = 0.52;
  const candidateColliders = extraColliders?.length
    ? [...colliders, ...extraColliders]
    : colliders;
  const resolveAxis = (axis: 'x' | 'z', proposed: number, other: number) => {
    let value = proposed;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of candidateColliders) {
        if (c.height !== undefined && y > groundHeightAt(c.x, c.z) + c.height) continue;
        const radius = c.radius + playerRadius;
        const fixedOffset = other - (axis === 'x' ? c.z : c.x);
        if (Math.abs(fixedOffset) >= radius) continue;
        const center = axis === 'x' ? c.x : c.z;
        const reach = Math.sqrt(Math.max(0, radius * radius - fixedOffset * fixedOffset));
        const delta = value - center;
        if (Math.abs(delta) < reach) {
          // Prefer the incoming side if we start inside an obstacle.
          const start = axis === 'x' ? x : z;
          const startDelta = start - center;
          // Do not tunnel through a collider when a frame's proposed
          // movement crosses its centre. Resolve toward the entry side.
          const sign = Math.abs(startDelta) >= reach - 1e-4
            ? Math.sign(startDelta)
            : Math.abs(delta) > 1e-6
              ? Math.sign(delta)
              : (startDelta < 0 ? -1 : 1);
          value = center + sign * reach;
        }
      }
    }
    return value;
  };
  // Resolve the dominant motion axis first to reduce corner jitter.
  if (Math.abs(nextX - x) >= Math.abs(nextZ - z)) {
    nextX = resolveAxis('x', nextX, z);
    nextZ = resolveAxis('z', nextZ, nextX);
  } else {
    nextZ = resolveAxis('z', nextZ, x);
    nextX = resolveAxis('x', nextX, nextZ);
  }

  // Check if player stands on a floating ship deck
  let deckHeight = -999;
  for (const s of ships) {
    if (s.hull <= 0) continue;
    const dx = nextX - s.x;
    const dz = nextZ - s.z;
    const cosH = Math.cos(s.heading);
    const sinH = Math.sin(s.heading);
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

  // Slope check (max walkable slope ~45 deg -> slope > 1.0 slides back if moving uphill)
  if (isGrounded && deckHeight < -900 && pierHeight < -900 && iceHeight < -900) {
    const slope = computeTerrainSlope(nextX, nextZ);
    if (slope > 1.05 && bedY > groundHeightAt(x, z)) {
      nextX = THREE.MathUtils.lerp(nextX, x, 0.72);
      nextZ = THREE.MathUtils.lerp(nextZ, z, 0.72);
    }
  }

  const waterDepth = Math.max(0, WATER_LEVEL - bedY);
  const waveY =
    WATER_LEVEL + waveSampler.sampleHeight(nextX, nextZ, elapsed, THREE.MathUtils.clamp(waterDepth / 2.2, 0.14, 1.0));

  const onDryStructure = deckHeight > -900 || pierHeight > -900 || iceHeight > -900;
  if (!onDryStructure && floorY < waveY - 0.72 && y < waveY + 0.45) {
    isSwimming = true;
    const swimSurfaceY = waveY - 0.92;
    if (diveHeld) {
      vy = THREE.MathUtils.lerp(vy, -4.4, Math.min(1, dt * 7));
    } else if (ascendHeld) {
      vy = THREE.MathUtils.lerp(vy, 4.8, Math.min(1, dt * 7));
    } else {
      const diff = swimSurfaceY - y;
      vy = THREE.MathUtils.lerp(vy, THREE.MathUtils.clamp(diff * 4.5, -2.5, 4.0), Math.min(1, dt * 5));
    }
    y += vy * dt;
    if (y > waveY - 0.35 && ascendHeld) {
      vy = 5.4;
    }
    if (y < bedY + 0.25) {
      y = bedY + 0.25;
      vy = Math.max(0, vy);
    }
    isUnderwater = y < waveY - 1.35;
    isGrounded = false;
  } else {
    vy -= physicsConfig.gravityMps2 * 2.15 * dt;
    const preLandingVy = vy;
    y += vy * dt;
    if (y <= floorY + 0.04) {
      if (!wasGrounded && preLandingVy < -9.0) {
        fallImpactHeight = (preLandingVy * preLandingVy) / (2 * physicsConfig.gravityMps2 * 2.15);
      }
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
    vx: moveDirX * speed * surfaceMult,
    vz: moveDirZ * speed * surfaceMult,
    vy,
    isGrounded,
    isSwimming,
    isUnderwater,
    isClimbing: false,
    isOnShipId,
    fallImpactHeight,
  };
}

/**
 * Law 1 Camera Sphere Collider sweep:
 * Prevents the camera from ever clipping inside walls, pillars, boulders, trees, or terrain.
 */
export function resolveCameraCollision(params: {
  targetWorldX: number;
  targetWorldY: number;
  targetWorldZ: number;
  desiredWorldX: number;
  desiredWorldY: number;
  desiredWorldZ: number;
  activeDungeon: DungeonBounds | null;
  colliders: CircleCollider[];
  extraColliders?: CircleCollider[];
}): { x: number; y: number; z: number } {
  const {
    targetWorldX,
    targetWorldY,
    targetWorldZ,
    desiredWorldX,
    desiredWorldY,
    desiredWorldZ,
    activeDungeon,
    colliders,
    extraColliders,
  } = params;

  const camRadius = physicsConfig.cameraSphereRadiusM;
  let maxT = 1.0;

  // Sweep 6 samples along the boom ray against static colliders + dungeon bounds
  const dx = desiredWorldX - targetWorldX;
  const dy = desiredWorldY - targetWorldY;
  const dz = desiredWorldZ - targetWorldZ;

  const testColliderList = (list: CircleCollider[], t: number) => {
    const sx = targetWorldX + dx * t;
    const sy = targetWorldY + dy * t;
    const sz = targetWorldZ + dz * t;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const rSum = c.radius + camRadius;
      const ox = sx - c.x;
      const oz = sz - c.z;
      if (ox * ox + oz * oz < rSum * rSum) {
        const baseH = activeDungeon ? 0 : groundHeightAt(c.x, c.z);
        const topH = baseH + (c.height ?? 5.5);
        if (sy <= topH + camRadius) {
          return true;
        }
      }
    }
    return false;
  };

  const steps = 8;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const sx = targetWorldX + dx * t;
    const sz = targetWorldZ + dz * t;
    if (activeDungeon) {
      if (
        sx <= activeDungeon.minX + camRadius ||
        sx >= activeDungeon.maxX - camRadius ||
        sz <= activeDungeon.minZ + camRadius ||
        sz >= activeDungeon.maxZ - camRadius
      ) {
        maxT = Math.max(0.22, (s - 1) / steps);
        break;
      }
    } else if (testColliderList(colliders, t) || (extraColliders && testColliderList(extraColliders, t))) {
      maxT = Math.max(0.22, (s - 1) / steps);
      break;
    }
  }

  const finalX = targetWorldX + dx * maxT;
  const finalZ = targetWorldZ + dz * maxT;
  let finalY = targetWorldY + dy * maxT;
  if (!activeDungeon) {
    finalY = Math.max(finalY, groundHeightAt(finalX, finalZ) + 0.65);
  } else {
    finalY = THREE.MathUtils.clamp(finalY, 0.7, 7.6);
  }
  return { x: finalX, y: finalY, z: finalZ };
}
