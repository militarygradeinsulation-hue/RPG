import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { getBiomeAt, groundHeightAt, NAMED_ISLANDS } from './TerrainHeightfield';
import { generateSeaWrecks, WORLD_POIS } from './ocean/ArchipelagoGen';

const frontier = ['isle_moonveil', 'isle_thornwild', 'isle_ashen', 'isle_storm'];

test('new island biomes agree with their terrain and map marker metadata', () => {
  for (const id of frontier) {
    const island = NAMED_ISLANDS.find((item) => item.id === id);
    assert.ok(island, `Missing island ${id}`);
    assert.equal(getBiomeAt(island.x, island.z), island.biome);
    const poi = WORLD_POIS.find((item) => item.id === `poi_${id}`);
    assert.ok(poi, `Missing point of interest for ${id}`);
    assert.equal(poi.biomeId, island.biome);
    assert.ok(Number.isFinite(groundHeightAt(island.x, island.z)));
  }
});

test('new island salvage encounters have finite positions and usable rewards', () => {
  const wrecks = generateSeaWrecks();
  for (const id of ['wreck_moonveil', 'wreck_thornwild', 'wreck_ashen', 'wreck_stormglass']) {
    const wreck = wrecks.find((item) => item.id === id);
    assert.ok(wreck, `Missing salvage encounter ${id}`);
    assert.ok(wreck.rewardGold > 0);
    assert.ok(wreck.rewardItem.length > 0);
    assert.ok(Number.isFinite(wreck.depthY));
    assert.ok(wreck.depthY <= -2.2);
  }
});

test('outer islands have unique identifiers and valid radii', () => {
  assert.equal(new Set(NAMED_ISLANDS.map((island) => island.id)).size, NAMED_ISLANDS.length);
  for (const island of NAMED_ISLANDS) {
    assert.ok(island.radius > 0);
    assert.ok(island.height > 0);
  }
});
