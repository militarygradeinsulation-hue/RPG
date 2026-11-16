import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolveBuildingCollision, resolveVillageMovement } from './BuildingCollision';
import type { BuildingPlan } from './SettlementGenerator';

const house: BuildingPlan = {
  id: 'house', kind: 'cottage', x: 50, z: 70, yaw: 0,
  width: 8, depth: 8, floors: 1, seed: 0.5,
};

test('closed walls block entry from exterior', () => {
  const hit = resolveBuildingCollision(55.5, 70, 53.9, 70, house);
  assert.ok(hit.x >= 54.5, `expected outside wall, got ${hit.x}`);
});

test('front doorway remains open for walking into house', () => {
  const entered = resolveBuildingCollision(50, 75.5, 50, 73.6, house);
  assert.ok(Math.abs(entered.x - 50) < 0.01);
  assert.ok(entered.z < 74);
});

test('wall segments block entry beside front door', () => {
  const stopped = resolveBuildingCollision(52.8, 75.5, 52.8, 73.85, house);
  assert.ok(stopped.z >= 74.0, `expected to remain outside, got ${stopped.z}`);
});

test('rotated houses preserve collision and doorway alignment', () => {
  const rotated = { ...house, yaw: Math.PI / 2 };
  // Inward along the rotated doorway normal.
  const entered = resolveBuildingCollision(44.5, 70, 46.4, 70, rotated);
  assert.ok(entered.x > 46);
  const stopped = resolveBuildingCollision(44.5, 72.9, 46.1, 72.9, rotated);
  assert.ok(stopped.x <= 46);
});

test('village collision leaves distant movement untouched', () => {
  assert.deepEqual(resolveVillageMovement(0, 0, 1, 1, [house]), { x: 1, z: 1 });
});

test('fast movement cannot cross a solid wall in one frame', () => {
  const crossed = resolveBuildingCollision(50, 65, 50, 71, house);
  assert.ok(crossed.z <= 65.5, `tunneled through rear wall: ${crossed.z}`);
});

test('fast movement through a doorway remains possible', () => {
  const entered = resolveBuildingCollision(50, 76, 50, 70.5, house);
  assert.ok(entered.z < 72, `blocked open doorway: ${entered.z}`);
});
