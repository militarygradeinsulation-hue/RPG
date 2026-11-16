import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldEngine } from '../src/engine/WorldEngine';
import { FixedStepLoop } from '../src/core/GameLoop';
import { createSanctumInlays } from '../src/world/SanctumDetails';
import { soundEngine } from '../src/audio/soundEngine';

function movementFixture(): any {
  const engine = Object.create(WorldEngine.prototype);
  Object.assign(engine, {
    playerState: { x: 0, y: 0.05, z: 0, stamina: 100, maxStamina: 100, hp: 100, maxHp: 100, isClimbing: false },
    activeDungeon: {}, climbTowers: [], cameraYaw: 0, unlockedSkills: [],
    dodgeTimer: 0, isSwimming: false, isCrouching: false, isGrounded: true,
    movementVelocity: new THREE.Vector2(), velocityY: 0, colliders: [], iceBridges: [], ships: [],
    oxygen: 100, maxOxygen: 100, oxygenWarnCooldown: 0,
    playerModel: {group: new THREE.Group()}, walkPhase: 0, lastFootstepPhase: 0,
  });
  return engine;
}

test('movement accelerates, brakes, and stays inside dungeon bounds', () => {
  const e = movementFixture();
  e.stepPlayerOnFootOrSwim(1 / 60, 0, {KeyW:true});
  assert.ok(e.playerState.z < 0 && e.playerState.z > -7.8 / 60);
  for (let i=0;i<120;i++) e.stepPlayerOnFootOrSwim(1 / 60, i / 60, {KeyW:true});
  assert.ok(Math.abs(e.movementVelocity.y + 7.8) < 0.01);
  const before = e.playerState.z;
  for (let i=0;i<120;i++) e.stepPlayerOnFootOrSwim(1 / 60, i / 60, {});
  assert.ok(before - e.playerState.z < 0.6);
  assert.ok(Math.abs(e.movementVelocity.y) < 0.001);
  for (let i=0;i<600;i++) e.stepPlayerOnFootOrSwim(1 / 60, i / 60, {KeyW:true});
  assert.ok(e.playerState.z >= -44.5);
});

test('fixed simulation gives the same travel at 30 Hz and 144 Hz render rates', () => {
  function run(hz:number) {
    const e = movementFixture();
    const loop = new FixedStepLoop();
    loop.reset(1000);
    for(let i=1;i<=hz*2;i++) loop.step(1000+i*1000/hz,
      dt => e.stepPlayerOnFootOrSwim(dt, i/hz, {KeyW:true}), () => {});
    return e.playerState.z;
  }
  assert.ok(Math.abs(run(30)-run(144)) < 0.14); // at most one fixed step of boundary rounding
});

test('pause clears residual movement', () => {
  const e = movementFixture();
  e.input = {setEnabled:()=>{}};
  e.movementVelocity.set(5, 5);
  e.setGameMode('paused');
  assert.equal(e.movementVelocity.length(), 0);
  assert.equal(e.motionReady, false);
});

test('guardians lock treasure; clearing them grants rewards only once', () => {
  const e:any = Object.create(WorldEngine.prototype);
  const chest = {id:'test', opened:false, mesh:new THREE.Group(), x:0,z:0,rewardItem:'crown_amulet',rewardGold:85};
  let rewards=0;
  e.dungeonChests=[chest]; e.dungeonEnemies=[{alive:true}];
  e.activeDungeon={biomeId:'suncrest'};
  e.callbacks={onCombatLog:()=>{},onHarvestItem:()=>rewards++,onGainXpAndGold:()=>{}};
  e.particlePool={spawnBurst:()=>{}};
  const original=soundEngine.triggerCue;
  soundEngine.triggerCue=()=>{};
  try {
    e.lootDungeonChest('test'); assert.equal(rewards,0); assert.equal(chest.opened,false);
    e.dungeonEnemies[0].alive=false;
    e.lootDungeonChest('test'); e.lootDungeonChest('test');
    assert.equal(rewards,1); assert.equal(chest.opened,true);
  } finally {soundEngine.triggerCue=original;}
});

test('every biome builds finite, bounded inlay geometry', () => {
  for(const biome of ['suncrest','verdant','ember','aether'] as const) {
    const group=createSanctumInlays(biome,8);
    group.traverse(obj=>{
      if(obj instanceof THREE.Mesh) {
        for(const n of obj.geometry.attributes.position.array) assert.ok(Number.isFinite(n));
        obj.geometry.computeBoundingSphere();
        assert.ok(obj.geometry.boundingSphere!.radius < 9);
      }
    });
    assert.ok(group.children.some(child=>child instanceof THREE.InstancedMesh));
  }
});
