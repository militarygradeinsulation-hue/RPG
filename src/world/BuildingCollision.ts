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
        // Avoid indeterminate normal if a long movement ends inside a wall.
        const left = Math.abs(from.x - minX);
        const right = Math.abs(from.x - maxX);
        const back = Math.abs(from.z - minZ);
        const front = Math.abs(from.z - maxZ);
        const smallest = Math.min(left, right, back, front);
        if (smallest === left) { dx = -1; dz = 0; }
        else if (smallest === right) { dx = 1; dz = 0; }
        else if (smallest === back) { dx = 0; dz = -1; }
        else { dx = 0; dz = 1; }
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
