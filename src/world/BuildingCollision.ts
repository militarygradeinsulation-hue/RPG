import type { BuildingPlan } from './SettlementGenerator';

/**
 * Resolves a ground-level player's circular footprint against a building's
 * four walls. The front wall has a real opening, matching the rendered door.
 * This is an oriented footprint: rotate into building space, resolve short
 * wall segments, and rotate back. Interior space stays walkable.
 */
export function resolveBuildingCollision(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  building: Pick<BuildingPlan, 'x' | 'z' | 'yaw' | 'width' | 'depth'>,
  playerRadius = 0.52,
): { x: number; z: number } {
  const cos = Math.cos(building.yaw);
  const sin = Math.sin(building.yaw);
  const local = (x: number, z: number) => ({
    x: (x - building.x) * cos + (z - building.z) * sin,
    z: -(x - building.x) * sin + (z - building.z) * cos,
  });
  const from = local(fromX, fromZ);
  const current = local(toX, toZ);
  const hw = building.width * 0.5;
  const hd = building.depth * 0.5;
  const thickness = 0.34;
  const doorHalf = Math.min(2.1, building.width * 0.34) * 0.5;
  const wallSegments: [number, number, number, number][] = [
    [-hw, -hd, hw, -hd + thickness],
    [-hw, hd - thickness, -doorHalf, hd],
    [doorHalf, hd - thickness, hw, hd],
    [-hw, -hd, -hw + thickness, hd],
    [hw - thickness, -hd, hw, hd],
  ];

  // Continuous swept footprint catches fast movement that skips entirely
  // through a thin wall between two fixed simulation samples.
  for (const [x1, z1, x2, z2] of wallSegments) {
    const loX = x1 - playerRadius;
    const hiX = x2 + playerRadius;
    const loZ = z1 - playerRadius;
    const hiZ = z2 + playerRadius;
    if (from.x > loX && from.x < hiX && from.z > loZ && from.z < hiZ) continue;
    const deltaX = current.x - from.x;
    const deltaZ = current.z - from.z;
    let entry = 0;
    let exit = 1;
    let hitAxis: 'x' | 'z' | null = null;
    let valid = true;
    for (const axis of ['x', 'z'] as const) {
      const start = axis === 'x' ? from.x : from.z;
      const delta = axis === 'x' ? deltaX : deltaZ;
      const low = axis === 'x' ? loX : loZ;
      const high = axis === 'x' ? hiX : hiZ;
      if (Math.abs(delta) < 1e-8) {
        if (start < low || start > high) valid = false;
        continue;
      }
      const near = Math.min((low - start) / delta, (high - start) / delta);
      const far = Math.max((low - start) / delta, (high - start) / delta);
      if (near > entry) { entry = near; hitAxis = axis; }
      exit = Math.min(exit, far);
    }
    if (!valid || !hitAxis || entry > exit || entry < 0 || entry > 1) continue;
    if (hitAxis === 'x') current.x = from.x + deltaX * Math.max(0, entry - 0.0001);
    else current.z = from.z + deltaZ * Math.max(0, entry - 0.0001);
  }

  // Two sweeps let the player slide around corners without crossing the wall.
  // Use the starting side when an oversize movement step reaches a wall.
  for (let pass = 0; pass < 2; pass++) {
    for (const [minX, minZ, maxX, maxZ] of wallSegments) {
      const nearestX = Math.max(minX, Math.min(maxX, current.x));
      const nearestZ = Math.max(minZ, Math.min(maxZ, current.z));
      let dx = current.x - nearestX;
      let dz = current.z - nearestZ;
      let distance = Math.hypot(dx, dz);
      if (distance >= playerRadius) continue;
      if (distance < 1e-7) {
        // Pick the wall face from the incoming position, not the nearest
        // endpoint. An overlapping player approaching a front facade must
        // be pushed back outside rather than sideways into its end cap.
        if (from.z > maxZ) { dx = 0; dz = 1; }
        else if (from.z < minZ) { dx = 0; dz = -1; }
        else if (from.x > maxX) { dx = 1; dz = 0; }
        else if (from.x < minX) { dx = -1; dz = 0; }
        else {
          const left = Math.abs(current.x - minX);
          const right = Math.abs(current.x - maxX);
          const back = Math.abs(current.z - minZ);
          const front = Math.abs(current.z - maxZ);
          const smallest = Math.min(left, right, back, front);
          if (smallest === left) { dx = -1; dz = 0; }
          else if (smallest === right) { dx = 1; dz = 0; }
          else if (smallest === back) { dx = 0; dz = -1; }
          else { dx = 0; dz = 1; }
        }
        distance = 1;
      }
      const push = playerRadius - (distance < 1e-7 ? 0 : Math.hypot(current.x - nearestX, current.z - nearestZ));
      current.x += (dx / distance) * push;
      current.z += (dz / distance) * push;
    }
  }
  return {
    x: building.x + current.x * cos - current.z * sin,
    z: building.z + current.x * sin + current.z * cos,
  };
}

/** Only collide with currently streamed buildings within immediate range. */
export function resolveVillageMovement(
  fromX: number, fromZ: number, toX: number, toZ: number,
  buildings: readonly BuildingPlan[],
): { x: number; z: number } {
  let x = toX;
  let z = toZ;
  for (const building of buildings) {
    const reach = Math.max(building.width, building.depth) + 2;
    if (Math.abs(building.x - x) > reach || Math.abs(building.z - z) > reach) continue;
    ({ x, z } = resolveBuildingCollision(fromX, fromZ, x, z, building));
  }
  return { x, z };
}
