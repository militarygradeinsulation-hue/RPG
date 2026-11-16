import { BiomeId } from '../../types/game';
import { hash2, NAMED_ISLANDS, WATER_LEVEL, groundHeightAt } from '../TerrainHeightfield';

export interface WorldPoiDef {
  id: string;
  name: string;
  kind: 'capital' | 'town' | 'harbor' | 'seal' | 'dungeon' | 'lighthouse' | 'wreck';
  biomeId: BiomeId;
  x: number;
  z: number;
  hasShipyard?: boolean;
}

export interface WindAndSeaState {
  windDirRad: number; // angle from +Z
  windKnots: number;
  swellIntensity: number; // 0.65 (calm) .. 2.2 (thunderstorm)
}

export const WORLD_POIS: WorldPoiDef[] = [
  { id: 'poi_suncrest', name: 'Suncrest Citadel', kind: 'capital', biomeId: 'suncrest', x: 0, z: 0 },
  { id: 'poi_haven', name: 'Suncrest Haven Port', kind: 'harbor', biomeId: 'suncrest', x: -22, z: 92, hasShipyard: true },
  { id: 'poi_verdant_mkt', name: 'Riverbend Market', kind: 'town', biomeId: 'verdant', x: -50, z: 32 },
  { id: 'poi_ember_forge', name: 'Ironbound Forge', kind: 'town', biomeId: 'ember', x: 56, z: 38 },
  { id: 'poi_ember_dock', name: 'Cinderwash Docks', kind: 'harbor', biomeId: 'ember', x: 94, z: 102, hasShipyard: true },
  { id: 'poi_aether_mon', name: 'Skyreach Monastery', kind: 'town', biomeId: 'aether', x: 0, z: -74 },
  ...NAMED_ISLANDS.map((isl) => ({
    id: `poi_${isl.id}`,
    name: isl.name,
    kind: (isl.hasHarbor ? 'harbor' : isl.hasLighthouse ? 'lighthouse' : 'wreck') as WorldPoiDef['kind'],
    biomeId: isl.biome,
    x: isl.x,
    z: isl.z,
    hasShipyard: Boolean(isl.hasHarbor),
  })),
];

export interface SalvageWreckDef {
  id: string;
  name: string;
  x: number;
  z: number;
  depthY: number;
  rewardGold: number;
  rewardItem: string;
  looted: boolean;
}

export function generateSeaWrecks(): SalvageWreckDef[] {
  const wrecks: SalvageWreckDef[] = [
    { id: 'wreck_royal_barge', name: 'Royal Suncrest Barge', x: -42, z: 132, depthY: 0, rewardGold: 110, rewardItem: 'crown_amulet', looted: false },
    { id: 'wreck_iron_galleon', name: 'Ironbound Ore Hulk', x: 46, z: 144, depthY: 0, rewardGold: 95, rewardItem: 'ember_greatsword', looted: false },
    { id: 'wreck_siren_reef', name: 'Siren’s Reef Cache', x: -85, z: 192, depthY: 0, rewardGold: 135, rewardItem: 'storm_crystal', looted: false },
    { id: 'wreck_frostfang', name: 'Frostfang Icebreaker', x: -178, z: 122, depthY: 0, rewardGold: 140, rewardItem: 'frost_lotus', looted: false },
    { id: 'wreck_smuggler', name: 'Smuggler’s Sloop', x: 168, z: 215, depthY: 0, rewardGold: 125, rewardItem: 'thermal_bomb', looted: false },
  ];

  // Add deterministic seeded outer sea wrecks
  for (let i = 0; i < 6; i++) {
    const wx = (hash2(i, 91.3) - 0.5) * 480;
    const wz = 220 + hash2(i, 42.7) * 260;
    const bed = groundHeightAt(wx, wz);
    if (bed < WATER_LEVEL - 1.5) {
      wrecks.push({
        id: `wreck_outer_${i}`,
        name: `Sunken Corsair Wreck #${i + 1}`,
        x: wx,
        z: wz,
        depthY: bed,
        rewardGold: 90 + i * 20,
        rewardItem: i % 2 === 0 ? 'storm_crystal' : 'frost_lotus',
        looted: false,
      });
    }
  }

  wrecks.forEach((w) => {
    w.depthY = Math.min(WATER_LEVEL - 2.2, groundHeightAt(w.x, w.z) + 0.5);
  });
  return wrecks;
}
