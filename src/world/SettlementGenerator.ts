import { getBiomeAt, groundHeightAt, hash2, NAMED_ISLANDS } from './TerrainHeightfield';
import type { BiomeId } from '../types/game';

export const SETTLEMENT_CELL_SIZE = 180;
export type BuildingKind = 'cottage' | 'workshop' | 'inn' | 'chapel' | 'watchtower' | 'keep';
export interface BuildingPlan {
  id: string;
  kind: BuildingKind;
  x: number;
  z: number;
  yaw: number;
  width: number;
  depth: number;
  floors: number;
  seed: number;
}
export interface SettlementPlan {
  id: string;
  name: string;
  x: number;
  z: number;
  biome: BiomeId;
  style: number;
  island: boolean;
  buildings: BuildingPlan[];
  residents: number;
}

const prefixes = ['Amber', 'Thorn', 'Silver', 'Oaken', 'Dusk', 'Frost', 'Iron', 'Star', 'Raven', 'Willow', 'High', 'Ember'];
const suffixes = ['hold', 'watch', 'haven', 'mere', 'ford', 'brook', 'spire', 'rest', 'gate', 'fall', 'wick', 'stead'];
const random = (x: number, z: number, salt: number) => hash2(x * 0.137 + salt * 7.21, z * 0.213 - salt * 3.17);

function buildPlan(id: string, x: number, z: number, seed: number, island: boolean): SettlementPlan {
  const biome = getBiomeAt(x, z);
  const style = Math.floor(random(x, z, 7) * 6);
  const name = prefixes[Math.floor(random(x, z, 8) * prefixes.length)] +
    suffixes[Math.floor(random(x, z, 9) * suffixes.length)];
  const count = island ? 3 + Math.floor(random(x, z, 10) * 2) : 4 + Math.floor(random(x, z, 10) * 4);
  const hasKeep = !island && seed > 0.84;
  const buildings: BuildingPlan[] = [];
  const centerClearance = hasKeep ? 18 : 8;
  if (hasKeep) buildings.push({
    id: id + ':keep', kind: 'keep', x, z, yaw: random(x, z, 11) * Math.PI * 2,
    width: 17, depth: 15, floors: 3, seed,
  });
  for (let i = 0; i < count; i++) {
    const angle = i * 2.39996 + random(x, z, 12) * Math.PI * 2;
    const radius = island ? 4.5 + Math.sqrt(i + 1) * 3.6 : centerClearance + 11 + Math.sqrt(i + 1) * 5.5;
    const bx = x + Math.cos(angle) * radius;
    const bz = z + Math.sin(angle) * radius;
    if (groundHeightAt(bx, bz) < 0.9) continue;
    const variant = random(bx, bz, 13);
    const kind: BuildingKind = i === 0 && !hasKeep ? 'inn'
      : i === 1 ? 'workshop' : variant > 0.89 ? 'chapel' : variant > 0.73 ? 'watchtower' : 'cottage';
    const floors = kind === 'watchtower' ? 3 : kind === 'inn' ? 2 : 1 + (variant > 0.83 ? 1 : 0);
    buildings.push({
      id: id + ':' + i,
      kind, x: bx, z: bz,
      yaw: angle + Math.PI * 0.5 + random(bx, bz, 14) * 0.5,
      width: kind === 'inn' ? 8 : 5 + random(bx, bz, 15) * 2.8,
      depth: kind === 'inn' ? 8 : 5 + random(bx, bz, 16) * 2,
      floors, seed: variant,
    });
  }
  // An accepted site must never become an empty village. The centre was
  // already checked for adequate elevation for procedural land settlements.
  // On named islands, the island peak is the safe fallback location.
  const minimum = island ? 2 : 1;
  while (buildings.length < minimum) {
    const i = buildings.length;
    const bx = x + (i === 0 ? -2.8 : 3.5);
    const bz = z + (i === 0 ? 2.7 : -3.3);
    buildings.push({
      id: id + ':core:' + i,
      kind: i === 0 ? 'inn' : 'cottage',
      x: bx, z: bz, yaw: i * 1.1,
      width: 5.5 + i, depth: 5.1 + i, floors: i === 0 ? 2 : 1,
      seed: random(x, z, 30 + i),
    });
  }
  return { id, name, x, z, biome, style, island, buildings, residents: Math.max(2, buildings.length + 1) };
}

/** Pure, reproducible settlement plan: same coordinate always yields the same village. */
export function settlementsForCell(cx: number, cz: number): SettlementPlan[] {
  const sites: SettlementPlan[] = [];
  const x = (cx + 0.22 + random(cx, cz, 1) * 0.55) * SETTLEMENT_CELL_SIZE;
  const z = (cz + 0.22 + random(cx, cz, 2) * 0.55) * SETTLEMENT_CELL_SIZE;
  const seed = random(cx, cz, 3);
  const nearAuthored = NAMED_ISLANDS.some(isle => Math.hypot(x - isle.x, z - isle.z) < isle.radius + 85);
  const onMainland = Math.hypot(x, z) > 155;
  if (seed > 0.23 && onMainland && !nearAuthored &&
      groundHeightAt(x, z) > 2 && groundHeightAt(x + 12, z + 12) > 0.9) {
    sites.push(buildPlan(`settlement:${cx}:${cz}`, x, z, seed, false));
  }
  for (const island of NAMED_ISLANDS) {
    if (Math.floor(island.x / SETTLEMENT_CELL_SIZE) !== cx ||
        Math.floor(island.z / SETTLEMENT_CELL_SIZE) !== cz) continue;
    sites.push(buildPlan(`settlement:${island.id}`, island.x, island.z, 0.7, true));
  }
  // The terrain engine also produces seeded islands forever beyond the
  // authored archipelago. Recover those exact centers from its 220m lattice
  // and populate suitable land with settlements. Never spawn on open water.
  const fract = (n: number) => n - Math.floor(n);
  const minX = cx * SETTLEMENT_CELL_SIZE;
  const maxX = minX + SETTLEMENT_CELL_SIZE;
  const minZ = cz * SETTLEMENT_CELL_SIZE;
  const maxZ = minZ + SETTLEMENT_CELL_SIZE;
  for (let iz = Math.floor(minZ / 220) - 1; iz <= Math.floor(maxZ / 220) + 1; iz++) {
    for (let ix = Math.floor(minX / 220) - 1; ix <= Math.floor(maxX / 220) + 1; ix++) {
      const islandSeed = hash2(ix * 3.17, iz * 7.41);
      if (islandSeed <= 0.56) continue;
      const islandX = (ix + 0.25 + fract(islandSeed * 13.7) * 0.5) * 220;
      const islandZ = (iz + 0.25 + fract(islandSeed * 29.3) * 0.5) * 220;
      if (islandX < minX || islandX >= maxX || islandZ < minZ || islandZ >= maxZ) continue;
      if (!(islandZ > 240 || Math.abs(islandX) > 250)) continue;
      if (NAMED_ISLANDS.some(island => Math.hypot(islandX - island.x, islandZ - island.z) < island.radius + 70)) continue;
      if (groundHeightAt(islandX, islandZ) <= 1.5) continue;
      sites.push(buildPlan(`settlement:outer:${ix}:${iz}`, islandX, islandZ, islandSeed, true));
    }
  }
  return sites;
}

export function settlementCellAt(x: number, z: number): { cx: number; cz: number } {
  return { cx: Math.floor(x / SETTLEMENT_CELL_SIZE), cz: Math.floor(z / SETTLEMENT_CELL_SIZE) };
}
