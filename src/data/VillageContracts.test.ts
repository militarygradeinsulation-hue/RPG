import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { hasVillageContractMaterials, makeVillageContract } from './VillageContracts';
import { ITEMS } from './worldData';

test('village contracts are deterministic and unique for different settlements', () => {
  const one = makeVillageContract('settlement:4:7', 'Ironhaven', 'ember');
  assert.deepEqual(makeVillageContract('settlement:4:7', 'Ironhaven', 'ember'), one);
  const two = makeVillageContract('settlement:4:8', 'Ironhaven', 'ember');
  assert.notEqual(one.id, two.id);
  assert.equal(one.status, 'active');
  assert.equal(one.maxSteps, 2);
  assert.ok(one.choices && one.choices.length === 2);
});

test('supply items exist and all biome contracts request feasible quantities', () => {
  for (const biome of ['suncrest', 'verdant', 'ember', 'aether'] as const) {
    const contract = makeVillageContract('settlement:7:3', 'Teststead', biome);
    assert.ok(contract.requiredItemId);
    assert.ok(ITEMS[contract.requiredItemId]);
    assert.ok((contract.requiredItemQty ?? 0) >= 2);
    assert.ok((contract.requiredItemQty ?? 0) <= 4);
    assert.equal(hasVillageContractMaterials(contract, []), false);
    assert.equal(hasVillageContractMaterials(contract, [
      { id: contract.requiredItemId, qty: contract.requiredItemQty! },
    ]), true);
  }
});

test('partial supplies cannot complete the contract', () => {
  const quest = makeVillageContract('settlement:9:2', 'Oakenrest', 'verdant');
  assert.equal(hasVillageContractMaterials(quest, [
    { id: quest.requiredItemId!, qty: quest.requiredItemQty! - 1 },
  ]), false);
});
