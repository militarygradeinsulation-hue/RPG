import type { QuestState } from '../types/game';

/**
 * The Frontier Saga extends the Four Seals campaign into the Sapphire Ocean.
 * Each island provides a discovery objective and an earned moral decision.
 * All quest state is stored in the existing game save snapshot.
 */
export const FRONTIER_QUESTS: QuestState[] = [
  {
    id: 'quest_moonveil',
    title: 'The Moonveil Oath',
    isProphecyMain: false,
    giverNpcId: 'npc_vespera',
    biomeId: 'aether',
    status: 'available',
    step: 0,
    maxSteps: 2,
    description: 'A forgotten lighthouse transmits an oath across the Sapphire Ocean. The Moonveil wardens guarded a second, hidden covenant. Find their waystone circle before the storm erases its memory.',
    objectives: ['Sail to Moonveil Sanctuary and reach the ancient waystones', 'Decide whether to protect or exploit the lunar covenant'],
    choices: [
      { id: 'moonveil_guard', label: 'Restore the lunar ward (+Light)', moralDelta: 16, biomeHealthDelta: { biomeId: 'aether', delta: 9 }, repDelta: { factionId: 'suncrest_order', delta: 12 }, rewardGold: 130, rewardXp: 220, consequenceText: 'Moonveil shines over the sea again. Travelers find safe passage by its light.' },
      { id: 'moonveil_claim', label: 'Claim the ward for your fleet (+Shadow)', moralDelta: -17, biomeHealthDelta: { biomeId: 'aether', delta: -5 }, repDelta: { factionId: 'ironbound_guild', delta: 14 }, rewardGold: 280, rewardXp: 220, consequenceText: 'Moonveil bends to your will, but the northern sky grows uneasy.' },
    ],
  },
  {
    id: 'quest_thornwild',
    title: 'The Heart Beneath the Thorns',
    isProphecyMain: false,
    giverNpcId: 'npc_lyra',
    biomeId: 'verdant',
    status: 'available',
    step: 0,
    maxSteps: 2,
    description: 'A forest rose from the sea after the Crown shattered. A living root-mind beneath Thornwild Expanse has begun to remember the names of those who abandoned it.',
    objectives: ['Discover the waystones of Thornwild Expanse', 'Choose how to settle the ancient forest debt'],
    choices: [
      { id: 'thornwild_replant', label: 'Protect the root-mind and restore the grove (+Light)', moralDelta: 18, biomeHealthDelta: { biomeId: 'verdant', delta: 12 }, repDelta: { factionId: 'verdant_circle', delta: 18 }, rewardGold: 145, rewardXp: 230, consequenceText: 'Green life returns to the outer sea. The Verdant Circle recognizes the oath.' },
      { id: 'thornwild_harvest', label: 'Harvest the rare heartwood for the guild (+Shadow)', moralDelta: -15, biomeHealthDelta: { biomeId: 'verdant', delta: -7 }, repDelta: { factionId: 'ironbound_guild', delta: 16 }, rewardGold: 315, rewardXp: 230, consequenceText: 'Your holds fill with rare timber as the Thornwild canopy begins to thin.' },
    ],
  },
  {
    id: 'quest_ashen_crown',
    title: 'The Crownfire Accord',
    isProphecyMain: false,
    giverNpcId: 'npc_thorin',
    biomeId: 'ember',
    status: 'available',
    step: 0,
    maxSteps: 2,
    description: 'Below Ashen Crown Caldera lies an unsealed forge. Its fire can warm every port in Aethelgard or supply a conqueror with enough steel to break the kingdom.',
    objectives: ['Reach the Ashen Crown Caldera waystones', 'Set the terms of the lost forge accord'],
    choices: [
      { id: 'ashen_share', label: 'Open the forge to independent smiths (+Light)', moralDelta: 20, biomeHealthDelta: { biomeId: 'ember', delta: 10 }, repDelta: { factionId: 'suncrest_order', delta: 16 }, rewardGold: 165, rewardXp: 245, consequenceText: 'The forge opens its doors. Ember ships bring tools instead of tribute.' },
      { id: 'ashen_monopoly', label: 'Give the forge to the Ironbound monopoly (+Shadow)', moralDelta: -21, biomeHealthDelta: { biomeId: 'ember', delta: -9 }, repDelta: { factionId: 'ironbound_guild', delta: 23 }, rewardGold: 350, rewardXp: 245, consequenceText: 'Ironbound gains the forge and the coasts hear the sound of marching steel.' },
    ],
  },
  {
    id: 'quest_stormglass',
    title: 'Where Storms Remember',
    isProphecyMain: false,
    giverNpcId: 'npc_rowan',
    biomeId: 'aether',
    status: 'available',
    step: 0,
    maxSteps: 2,
    description: 'Stormglass Reach holds the final map of the First Navigators. The surviving sky crystals speak of another crown, buried beyond the southern currents.',
    objectives: ['Find Stormglass Reach and investigate its runic circle', 'Decide what the Navigators\' lost knowledge becomes'],
    choices: [
      { id: 'stormglass_beacon', label: 'Share the chart with every harbor (+Light)', moralDelta: 17, biomeHealthDelta: { biomeId: 'aether', delta: 11 }, repDelta: { factionId: 'verdant_circle', delta: 14 }, rewardGold: 180, rewardXp: 260, consequenceText: 'A new sea route opens in the minds of Aethelgard\'s captains.' },
      { id: 'stormglass_secret', label: 'Keep the chart for a private dominion (+Shadow)', moralDelta: -18, biomeHealthDelta: { biomeId: 'aether', delta: -6 }, repDelta: { factionId: 'ironbound_guild', delta: 17 }, rewardGold: 380, rewardXp: 260, consequenceText: 'You alone hold the hidden chart. The coast grows wary of your fleet.' },
    ],
  },
  {
    id: 'quest_frontier_crown',
    title: 'The Crown Beyond the Horizon',
    isProphecyMain: true,
    giverNpcId: 'npc_rowan',
    biomeId: 'suncrest',
    status: 'available',
    step: 0,
    maxSteps: 2,
    description: 'Four distant covenants define who may control the Sapphire Ocean. Resolve all four island oaths, then choose the future of the sea itself.',
    objectives: ['Complete Moonveil, Thornwild, Ashen Crown, and Stormglass storylines', 'Decide the fate of the Sapphire Covenant'],
    choices: [
      { id: 'frontier_union', label: 'Unite the harbors under a common covenant (+Light)', moralDelta: 30, biomeHealthDelta: { biomeId: 'suncrest', delta: 20 }, repDelta: { factionId: 'suncrest_order', delta: 25 }, rewardGold: 500, rewardXp: 600, consequenceText: 'The Sapphire Covenant is forged. Independent ports pledge safe passage to every traveler.' },
      { id: 'frontier_throne', label: 'Claim the sea as your own throne (+Shadow)', moralDelta: -30, biomeHealthDelta: { biomeId: 'suncrest', delta: -12 }, repDelta: { factionId: 'ironbound_guild', delta: 28 }, rewardGold: 900, rewardXp: 600, consequenceText: 'Your banner rises over the Sapphire Ocean. Every captain knows who commands the horizon.' },
    ],
  },
];

export const FRONTIER_DISCOVERY_QUESTS: Readonly<Record<string, string>> = {
  poi_isle_moonveil: 'quest_moonveil',
  poi_isle_thornwild: 'quest_thornwild',
  poi_isle_ashen: 'quest_ashen_crown',
  poi_isle_storm: 'quest_stormglass',
};

export const FRONTIER_REQUIRED_QUESTS = [
  'quest_moonveil', 'quest_thornwild', 'quest_ashen_crown', 'quest_stormglass',
] as const;

/** Add new quest content to old save slots without overwriting existing progress. */
export function mergeQuestCatalog(saved: QuestState[] | undefined, catalog: QuestState[]): QuestState[] {
  if (!saved) return structuredClone(catalog);
  const known = new Set(saved.map((quest) => quest.id));
  return [
    ...saved,
    ...catalog.filter((quest) => !known.has(quest.id)).map((quest) => structuredClone(quest)),
  ];
}

/** A discovered island unlocks its storyline's choice, once. */
export function advanceFrontierDiscovery(quests: QuestState[], poiId: string): QuestState[] {
  const questId = FRONTIER_DISCOVERY_QUESTS[poiId];
  if (!questId) return quests;
  return quests.map((quest) =>
    quest.id === questId && quest.status !== 'completed'
      ? { ...quest, status: 'active', step: Math.max(1, quest.step) }
      : quest
  );
}

/** Final chapter becomes available when the four regional decisions are complete. */
export function unlockFrontierFinale(quests: QuestState[]): QuestState[] {
  const ready = FRONTIER_REQUIRED_QUESTS.every((id) =>
    quests.some((quest) => quest.id === id && quest.status === 'completed')
  );
  if (!ready) return quests;
  return quests.map((quest) =>
    quest.id === 'quest_frontier_crown' && quest.status !== 'completed'
      ? { ...quest, status: 'active', step: Math.max(1, quest.step) }
      : quest
  );
}
