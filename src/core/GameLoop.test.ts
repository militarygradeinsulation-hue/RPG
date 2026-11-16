import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { FixedStepLoop } from './GameLoop';

test('advances simulation at fixed timestep', () => {
  const loop = new FixedStepLoop(60);
  loop.reset(1000);
  let ticks = 0;
  loop.step(1034, () => ticks++, () => {});
  assert.equal(ticks, 2);
});

test('suspended browser frame does not catch up a backlog', () => {
  const loop = new FixedStepLoop(60);
  loop.reset(1000);
  let ticks = 0;
  let renderDt = -1;
  loop.step(4000, () => ticks++, dt => { renderDt = dt; });
  assert.equal(ticks, 0);
  assert.equal(renderDt, 0);
  loop.step(4017, () => ticks++, () => {});
  assert.equal(ticks, 1);
});

test('large simulation work never forces unlimited catch-up steps', () => {
  const loop = new FixedStepLoop(60);
  loop.reset(1000);
  let ticks = 0;
  loop.step(1090, () => ticks++, () => {});
  assert.ok(ticks <= 4);
  assert.ok(ticks > 0);
});
