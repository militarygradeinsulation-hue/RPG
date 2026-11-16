import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { settlementCellAt, settlementsForCell, SETTLEMENT_CELL_SIZE } from './SettlementGenerator';
import { NAMED_ISLANDS } from './TerrainHeightfield';

test('settlements are deterministic across repeated visits', () => {
  for (const [x, z] of [[0, 0], [3, -5], [-9, 11], [25, -22]]) {
    const first = settlementsForCell(x, z);
    assert.deepEqual(settlementsForCell(x, z), first);
    for (const site of first) {
      assert.ok(site.buildings.length >= 1);
      assert.equal(new Set(site.buildings.map(building => building.id)).size, site.buildings.length);
      for (const b of site.buildings) {
        assert.ok(Number.isFinite(b.x) && Number.isFinite(b.z));
        assert.ok(b.width > 0 && b.depth > 0 && b.floors > 0);
      }
    }
  }
});

test('the outer islands have villages with unique building layouts', () => {
  const seen = new Set<string>();
  for (const island of NAMED_ISLANDS) {
    const cell = settlementCellAt(island.x, island.z);
    const site = settlementsForCell(cell.cx, cell.cz)
      .find(result => result.id === `settlement:${island.id}`);
    assert.ok(site, `Missing village on ${island.name}`);
    assert.ok(site.buildings.length >= 2);
    assert.ok(!seen.has(site.id));
    seen.add(site.id);
  }
});

test('coordinate conversion is stable on negative and far distant world positions', () => {
  for (const x of [-3755, -181, 0, 180, 3155]) {
    const cell = settlementCellAt(x, 0);
    assert.equal(cell.cx, Math.floor(x / SETTLEMENT_CELL_SIZE));
  }
});
