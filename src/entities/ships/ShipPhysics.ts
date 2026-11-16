import * as THREE from 'three';
import { groundHeightAt, WATER_LEVEL } from '../../world/TerrainHeightfield';
import { OceanWaveSampler } from '../../world/ocean/OceanWaveSampler';
import { ShipType } from '../../types/game';
import { SHIP_SPECS, ShipModelParts } from './ShipBuilder';

export interface ShipRuntime {
  id: string;
  name: string;
  type: ShipType;
  isPlayerOwned: boolean;
  isHostile: boolean;
  x: number;
  y: number;
  z: number;
  heading: number; // radians, +Z when 0
  vx: number;
  vz: number;
  angularVel: number;
  pitch: number;
  roll: number;
  hull: number;
  maxHull: number;
  sailSetting: number; // 0 .. 1
  anchored: boolean;
  cannonCooldown: number;
  respawnTimer: number;
  parts: ShipModelParts;
}

export interface CannonballRuntime {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fromPlayer: boolean;
  damage: number;
  life: number;
  mesh: THREE.Mesh;
}

/**
 * Simulates 4-point wave buoyancy (bow, stern, port, starboard), wind-sail aerodynamics,
 * rudder torque, shallow-ground keel collision, and AI pirate broadside patrols.
 */
export function stepShipBuoyancyAndPhysics(
  ship: ShipRuntime,
  dt: number,
  timeSec: number,
  waveSampler: OceanWaveSampler,
  windAngleRad: number,
  windKnots: number,
  steerInput: number // -1 right, +1 left
): number {
  const spec = SHIP_SPECS[ship.type];
  const sinH = Math.sin(ship.heading);
  const cosH = Math.cos(ship.heading);

  // Sample 4 hull floatation corners in world coordinates
  const sampleAtLocal = (lx: number, lz: number) => {
    const wx = ship.x + cosH * lx + sinH * lz;
    const wz = ship.z - sinH * lx + cosH * lz;
    const bed = groundHeightAt(wx, wz);
    const depth = Math.max(0.2, WATER_LEVEL - bed);
    const damp = THREE.MathUtils.clamp(depth / 2.2, 0.15, 1.0);
    return WATER_LEVEL + waveSampler.sampleHeight(wx, wz, timeSec, damp);
  };

  const hBow = sampleAtLocal(0, ship.parts.lengthHalf);
  const hStern = sampleAtLocal(0, -ship.parts.lengthHalf);
  const hPort = sampleAtLocal(ship.parts.beamHalf, 0);
  const hStbd = sampleAtLocal(-ship.parts.beamHalf, 0);

  const avgWaveY = (hBow + hStern + hPort + hStbd) * 0.25;
  const targetPitch = -Math.atan2(hBow - hStern, ship.parts.lengthHalf * 2) * 0.85;
  const targetRoll = Math.atan2(hPort - hStbd, ship.parts.beamHalf * 2) * 0.85;

  ship.y = THREE.MathUtils.lerp(ship.y, avgWaveY - 0.18, Math.min(1, dt * 7.5));
  ship.pitch = THREE.MathUtils.lerp(ship.pitch, targetPitch, Math.min(1, dt * 6.0));
  ship.roll = THREE.MathUtils.lerp(ship.roll, targetRoll, Math.min(1, dt * 6.0));

  // Sail thrust relative to wind direction (never stalls dead into wind so sailing feels crisp)
  const windFactor = 0.58 + 0.42 * (0.5 + 0.5 * Math.cos(ship.heading - windAngleRad));
  const targetThrust = ship.anchored ? 0 : ship.sailSetting * (windKnots / 14) * windFactor * spec.maxSpeed;

  const forwardX = sinH;
  const forwardZ = cosH;
  const rightX = cosH;
  const rightZ = -sinH;

  const forwardSpeed = ship.vx * forwardX + ship.vz * forwardZ;
  const lateralSpeed = ship.vx * rightX + ship.vz * rightZ;

  // Apply longitudinal sail drive + hydrodynamic drag & strong keel lateral resistance
  const nextForward = THREE.MathUtils.lerp(forwardSpeed, targetThrust, Math.min(1, dt * (ship.anchored ? 2.4 : 1.15)));
  const nextLateral = lateralSpeed * Math.max(0, 1 - dt * 3.8);

  ship.vx = forwardX * nextForward + rightX * nextLateral;
  ship.vz = forwardZ * nextForward + rightZ * nextLateral;

  // Steering authority scales gently with forward speed + minimum bow thruster feel
  const steerAuthority = ship.anchored ? 0.18 : Math.min(1.15, 0.38 + Math.abs(nextForward) / 10);
  const targetAngVel = steerInput * spec.turnRate * steerAuthority;
  ship.angularVel = THREE.MathUtils.lerp(ship.angularVel, targetAngVel, Math.min(1, dt * 5.0));
  ship.heading += ship.angularVel * dt;

  // Shallow-ground keel hull check so ships bump off reefs/beaches smoothly instead of flying inland
  const nextX = ship.x + ship.vx * dt;
  const nextZ = ship.z + ship.vz * dt;
  const lookAheadBed = groundHeightAt(nextX + forwardX * 2.5, nextZ + forwardZ * 2.5);
  const centerBed = groundHeightAt(nextX, nextZ);
  if (lookAheadBed < WATER_LEVEL - 0.55 && centerBed < WATER_LEVEL - 0.55) {
    ship.x = nextX;
    ship.z = nextZ;
  } else {
    // Softly slide along shoreline
    const bedXOnly = groundHeightAt(nextX, ship.z);
    const bedZOnly = groundHeightAt(ship.x, nextZ);
    if (bedXOnly < WATER_LEVEL - 0.55) ship.x = nextX;
    if (bedZOnly < WATER_LEVEL - 0.55) ship.z = nextZ;
    ship.vx *= 0.65;
    ship.vz *= 0.65;
  }

  if (ship.cannonCooldown > 0) ship.cannonCooldown = Math.max(0, ship.cannonCooldown - dt);

  // Animate visual sails, rudder & wheel
  const visualSailZ = ship.anchored ? 0.16 : 0.2 + ship.sailSetting * 0.85;
  ship.parts.sails.forEach((s) => {
    s.scale.y = THREE.MathUtils.lerp(s.scale.y, visualSailZ, Math.min(1, dt * 5));
  });
  ship.parts.rudder.rotation.y = THREE.MathUtils.lerp(ship.parts.rudder.rotation.y, -steerInput * 0.55, Math.min(1, dt * 8));
  ship.parts.wheel.rotation.z -= ship.angularVel * dt * 2.6;

  return Math.abs(nextForward);
}
