import { strict as assert } from 'node:assert';
import { INITIAL_OUTPOSTS, INITIAL_QUESTS, ITEMS } from './worldData';
import { test } from 'node:test';
import { FRONTIER_QUESTS, FRONTIER_DISCOVERY_QUESTS, FRONTIER_REQUIRED_QUESTS, FRONTIER_GUARDIAN_QUESTS, advanceFrontierGuardian, mergeOutpostCatalog, mergeQuestCatalog, advanceFrontierDiscovery, unlockFrontierFinale } from './frontierSaga';

test('all four outer islands have one valid discovery storyline', () => {
  const regional = FRONTIER_QUESTS.filter((quest) => quest.id !== 'quest_frontier_crown');
  assert.equal(regional.length, 4);
  assert.equal(Object.keys(FRONTIER_DISCOVERY_QUESTS).length, 4);
  for (const id of Object.values(FRONTIER_DISCOVERY_QUESTS)) {
    const quest = regional.find((item) => item.id === id);
    assert.ok(quest, `Missing regional quest: ${id}`);
    assert.equal(quest.status, 'available');
    assert.ok(quest.choices && quest.choices.length === 2);
    assert.ok(quest.choices.every((choice) => choice.rewardXp > 0));
  }
});

test('existing saved quests are preserved and new chapters append exactly once', () => {
  const completed = { ...FRONTIER_QUESTS[0], status: 'completed' as const, step: 2 };
  const first = mergeQuestCatalog([completed], FRONTIER_QUESTS);
  assert.equal(first.length, FRONTIER_QUESTS.length);
  assert.equal(first[0].status, 'completed');
  assert.equal(mergeQuestCatalog(first, FRONTIER_QUESTS).length, FRONTIER_QUESTS.length);
});

test('visiting an island unlocks its decision but does not award a reward', () => {
  const initial = mergeQuestCatalog(undefined, FRONTIER_QUESTS);
  const next = advanceFrontierDiscovery(initial, 'poi_isle_moonveil');
  assert.equal(next.find(q => q.id === 'quest_moonveil')?.step, 1);
  assert.equal(next.find(q => q.id === 'quest_moonveil')?.status, 'active');
  assert.equal(next.find(q => q.id === 'quest_ashen_crown')?.status, 'available');
  assert.equal(advanceFrontierDiscovery(next, 'poi_isle_moonveil')[0].step, 1);
});

test('the final chapter unlocks only after all four island story choices', () => {
  const quests = mergeQuestCatalog(undefined, FRONTIER_QUESTS);
  assert.equal(unlockFrontierFinale(quests).find(q => q.id === 'quest_frontier_crown')?.status, 'available');
  const ready = quests.map((quest) => FRONTIER_REQUIRED_QUESTS.includes(quest.id as typeof FRONTIER_REQUIRED_QUESTS[number])
    ? { ...quest, status: 'completed' as const, step: quest.maxSteps }
    : quest);
  const updated = unlockFrontierFinale(ready);
  assert.equal(updated.find(q => q.id === 'quest_frontier_crown')?.status, 'active');
  assert.equal(updated.find(q => q.id === 'quest_frontier_crown')?.step, 1);
});

test('all frontier artifact rewards resolve to items and every ending is collectible', () => {
  const rewards = FRONTIER_QUESTS.flatMap(q => q.choices ?? []);
  assert.equal(rewards.length, 10);
  for (const choice of rewards) {
    assert.ok(choice.rewardItemId, `Missing artifact on ${choice.id}`);
    assert.ok(ITEMS[choice.rewardItemId], `Unknown artifact ${choice.rewardItemId}`);
  }
  assert.equal(INITIAL_QUESTS.filter(q => FRONTIER_QUESTS.some(f => f.id === q.id)).length, 5);
});

test('existing built outposts survive when new island settlements are installed', () => {
  const old = [{ ...INITIAL_OUTPOSTS[0], level: 2 }];
  const merged = mergeOutpostCatalog(old, INITIAL_OUTPOSTS);
  assert.equal(merged.length, INITIAL_OUTPOSTS.length);
  assert.equal(merged[0].level, 2);
  assert.equal(new Set(merged.map(x => x.id)).size, merged.length);
  assert.equal(mergeOutpostCatalog(merged, INITIAL_OUTPOSTS).length, merged.length);
  for (const id of ['outpost_moonveil', 'outpost_thornwild', 'outpost_ashen', 'outpost_storm']) {
    assert.ok(merged.find(o => o.id === id), `Missing frontier settlement ${id}`);
  }
});

test('guardians gate each frontier decision and cannot unlock undiscovered quests', () => {
  const fresh = mergeQuestCatalog(undefined, FRONTIER_QUESTS);
  assert.equal(advanceFrontierGuardian(fresh, 'guardian_moonveil').find(q => q.id === 'quest_moonveil')?.step, 0);
  const discovered = advanceFrontierDiscovery(fresh, 'poi_isle_moonveil');
  assert.equal(discovered.find(q => q.id === 'quest_moonveil')?.step, 1);
  const won = advanceFrontierGuardian(discovered, 'guardian_moonveil');
  assert.equal(won.find(q => q.id === 'quest_moonveil')?.step, 2);
  assert.equal(won.find(q => q.id === 'quest_thornwild')?.step, 0);
  assert.equal(Object.keys(FRONTIER_GUARDIAN_QUESTS).length, 4);
  assert.ok(FRONTIER_QUESTS.filter(q => q.id !== 'quest_frontier_crown').every(q => q.maxSteps === 3));
});
