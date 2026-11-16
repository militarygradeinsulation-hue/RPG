import type { BiomeId, QuestState } from '../types/game';

const contracts: Record<BiomeId, { item: string; label: string; faction: 'suncrest_order' | 'verdant_circle' | 'ironbound_guild' }> = {
  suncrest: { item: 'runed_stone', label: 'Runed Stone', faction: 'suncrest_order' },
  verdant: { item: 'sunleaf_herb', label: 'Sunleaf Herb', faction: 'verdant_circle' },
  ember: { item: 'ember_ore', label: 'Ember Ore', faction: 'ironbound_guild' },
  aether: { item: 'storm_crystal', label: 'Storm Crystal', faction: 'suncrest_order' },
};

/** Generate a persistent, deterministic supply contract from a town identity. */
export function makeVillageContract(
  settlementId: string,
  settlementName: string,
  biomeId: BiomeId,
): QuestState {
  const config = contracts[biomeId];
  const hash = [...settlementId].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0, 2166136261);
  const qty = 2 + hash % 3;
  const xp = 65 + hash % 45;
  return {
    id: `contract:${settlementId}`,
    title: `The Needs of ${settlementName}`,
    isProphecyMain: false,
    giverNpcId: `${settlementId}:resident`,
    biomeId,
    status: 'active',
    step: 1,
    maxSteps: 2,
    description: `The people of ${settlementName} need supplies. Gather ${qty} ${config.label} and choose whether to support the community or sell your surplus.`,
    objectives: [`Collect ${qty} ${config.label}`, 'Deliver supplies or sell them for personal profit'],
    requiredItemId: config.item,
    requiredItemQty: qty,
    choices: [
      {
        id: `aid:${settlementId}`,
        label: `Deliver supplies to ${settlementName} (+Light)`,
        moralDelta: 8, repDelta: { factionId: config.faction, delta: 12 },
        biomeHealthDelta: { biomeId, delta: 5 }, rewardGold: 35 + qty * 8, rewardXp: xp,
        consequenceText: `The people of ${settlementName} remember your generosity.`,
      },
      {
        id: `trade:${settlementId}`,
        label: 'Sell the gathered supplies at a premium (+Shadow)',
        moralDelta: -7, repDelta: { factionId: 'ironbound_guild', delta: 5 },
        rewardGold: 90 + qty * 17, rewardXp: xp,
        consequenceText: `Your profits rise, but ${settlementName} must source supplies elsewhere.`,
      },
    ],
  };
}

export function hasVillageContractMaterials(quest: QuestState, inventory: readonly { id: string; qty: number }[]): boolean {
  if (!quest.requiredItemId) return true;
  return (inventory.find(item => item.id === quest.requiredItemId)?.qty ?? 0) >= (quest.requiredItemQty ?? 0);
}
