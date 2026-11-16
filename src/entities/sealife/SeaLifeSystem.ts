import * as THREE from 'three';
import { groundHeightAt, WATER_LEVEL } from '../../world/TerrainHeightfield';
import { OceanWaveSampler } from '../../world/ocean/OceanWaveSampler';

export type MarineKind = 'fish' | 'dolphin' | 'shark' | 'gull' | 'serpent';

export interface MarineCreatureRuntime {
  id: string;
  kind: MarineKind;
  x: number;
  y: number;
  z: number;
  homeX: number;
  homeZ: number;
  angle: number;
  speed: number;
  phase: number;
  group: THREE.Group;
  tail?: THREE.Object3D;
  wings?: THREE.Object3D[];
}

function buildFishSchoolMesh(colorHex: number): { group: THREE.Group; tail: THREE.Object3D } {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.25, metalness: 0.55 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.62, 6), mat);
  body.rotation.x = Math.PI / 2;
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 4), mat);
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -0.34;
  group.add(body, tail);
  return { group, tail };
}

function buildDolphinOrShark(isShark: boolean): { group: THREE.Group; tail: THREE.Object3D } {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: isShark ? 0x475569 : 0x64748b,
    roughness: 0.35,
    metalness: 0.2,
  });
  const bellyMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.4 });
  const len = isShark ? 2.4 : 1.9;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(isShark ? 0.32 : 0.26, len * 0.55, 5, 10), mat);
  torso.rotation.x = Math.PI / 2;
  const belly = new THREE.Mesh(new THREE.CapsuleGeometry(isShark ? 0.24 : 0.2, len * 0.45, 4, 8), bellyMat);
  belly.rotation.x = Math.PI / 2;
  belly.position.y = -0.08;
  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 4), mat);
  dorsal.position.set(0, 0.34, -0.05);
  dorsal.rotation.x = -0.35;
  const tail = new THREE.Group();
  tail.position.z = -len * 0.45;
  const fluke = new THREE.Mesh(new THREE.BoxGeometry(isShark ? 0.14 : 0.68, isShark ? 0.72 : 0.1, 0.35), mat);
  fluke.position.z = -0.22;
  tail.add(fluke);
  group.add(torso, belly, dorsal, tail);
  return { group, tail };
}

function buildSeaGull(): { group: THREE.Group; wings: THREE.Object3D[] } {
  const group = new THREE.Group();
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.75 });
  const tipMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.38, 4, 6), whiteMat);
  body.rotation.x = Math.PI / 2;
  group.add(body);

  const wings: THREE.Object3D[] = [];
  [-1, 1].forEach((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.08, 0.04, 0.04);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.03, 0.2), whiteMat);
    wing.position.x = side * 0.32;
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.16), tipMat);
    tip.position.x = side * 0.7;
    pivot.add(wing, tip);
    group.add(pivot);
    wings.push(pivot);
  });
  return { group, wings };
}

function buildAbyssalSerpent(): { group: THREE.Group; tail: THREE.Object3D } {
  const group = new THREE.Group();
  const scaleMat = new THREE.MeshStandardMaterial({
    color: 0x0f766e,
    emissive: 0x0d9488,
    emissiveIntensity: 0.35,
    roughness: 0.35,
    metalness: 0.3,
  });
  for (let i = 0; i < 6; i++) {
    const r = 0.72 - i * 0.09;
    const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), scaleMat);
    seg.position.set(0, Math.sin(i * 0.9) * 0.35, -i * 1.35);
    group.add(seg);
  }
  const crest = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 1.1, 5),
    new THREE.MeshStandardMaterial({ color: 0x5eead4, emissive: 0x14b8a6, emissiveIntensity: 1.4 })
  );
  crest.position.set(0, 0.72, 0.25);
  crest.rotation.x = -0.6;
  const tail = new THREE.Group();
  tail.position.z = -7.5;
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 4), scaleMat);
  fin.rotation.x = -Math.PI / 2;
  tail.add(fin);
  group.add(crest, tail);
  return { group, tail };
}

export class SeaLifeSystem {
  public readonly group = new THREE.Group();
  public readonly creatures: MarineCreatureRuntime[] = [];

  constructor() {
    const specs: { kind: MarineKind; x: number; z: number }[] = [
      { kind: 'gull', x: -22, z: 105 },
      { kind: 'gull', x: -10, z: 122 },
      { kind: 'gull', x: 88, z: 112 },
      { kind: 'gull', x: -115, z: 168 },
      { kind: 'dolphin', x: -38, z: 142 },
      { kind: 'dolphin', x: -52, z: 158 },
      { kind: 'dolphin', x: 25, z: 175 },
      { kind: 'shark', x: 54, z: 154 },
      { kind: 'shark', x: -92, z: 195 },
      { kind: 'serpent', x: -18, z: 205 },
      // Underwater schooling fish around Coral Atoll & Haven Harbor reef
      { kind: 'fish', x: -34, z: 125 },
      { kind: 'fish', x: -36, z: 128 },
      { kind: 'fish', x: -39, z: 123 },
      { kind: 'fish', x: -105, z: 165 },
      { kind: 'fish', x: -108, z: 169 },
      { kind: 'fish', x: -102, z: 171 },
    ];

    specs.forEach((sp, i) => {
      let built: { group: THREE.Group; tail?: THREE.Object3D; wings?: THREE.Object3D[] };
      if (sp.kind === 'gull') built = buildSeaGull();
      else if (sp.kind === 'dolphin') built = buildDolphinOrShark(false);
      else if (sp.kind === 'shark') built = buildDolphinOrShark(true);
      else if (sp.kind === 'serpent') built = buildAbyssalSerpent();
      else built = buildFishSchoolMesh(i % 2 === 0 ? 0x38bdf8 : 0xfbbf24);

      const y = sp.kind === 'gull' ? 12 + (i % 3) * 3 : WATER_LEVEL - 1.2;
      built.group.position.set(sp.x, y, sp.z);
      this.group.add(built.group);

      this.creatures.push({
        id: `sealife_${i}`,
        kind: sp.kind,
        x: sp.x,
        y,
        z: sp.z,
        homeX: sp.x,
        homeZ: sp.z,
        angle: i * 1.15,
        speed: sp.kind === 'gull' ? 7.2 : sp.kind === 'dolphin' ? 6.4 : sp.kind === 'serpent' ? 5.2 : 3.6,
        phase: i * 0.9,
        group: built.group,
        tail: built.tail,
        wings: built.wings,
      });
    });
  }

  public update(dt: number, elapsed: number, originX: number, originZ: number, waveSampler: OceanWaveSampler): void {
    for (const c of this.creatures) {
      const orbitRadius = c.kind === 'fish' ? 7 : c.kind === 'gull' ? 22 : 18;
      c.angle += (c.speed / orbitRadius) * dt;
      c.x = c.homeX + Math.cos(c.angle) * orbitRadius;
      c.z = c.homeZ + Math.sin(c.angle) * orbitRadius;

      const waveY = WATER_LEVEL + waveSampler.sampleHeight(c.x, c.z, elapsed, 1.0);
      const bedY = groundHeightAt(c.x, c.z);

      if (c.kind === 'gull') {
        c.y = 11.5 + Math.sin(elapsed * 1.4 + c.phase) * 2.0;
        const flap = Math.sin(elapsed * 7.5 + c.phase) * 0.55;
        if (c.wings) {
          c.wings[0].rotation.z = flap;
          c.wings[1].rotation.z = -flap;
        }
      } else if (c.kind === 'dolphin') {
        // Periodic breaching arcs over waves!
        const arc = Math.sin(elapsed * 1.9 + c.phase);
        c.y = Math.max(bedY + 0.5, waveY - 0.35 + (arc > 0.25 ? (arc - 0.25) * 2.9 : -0.45));
        c.group.rotation.x = -Math.cos(elapsed * 1.9 + c.phase) * (arc > 0.2 ? 0.55 : 0.1);
      } else if (c.kind === 'serpent') {
        c.y = waveY - 0.2 + Math.sin(elapsed * 2.2 + c.phase) * 0.55;
      } else if (c.kind === 'fish') {
        c.y = Math.max(bedY + 0.45, Math.min(waveY - 0.7, WATER_LEVEL - 1.4 + Math.sin(elapsed * 2.4 + c.phase) * 0.4));
      } else {
        // Shark fin skimming just below wave surface
        c.y = Math.max(bedY + 0.5, waveY - 0.28);
      }

      if (c.tail) {
        c.tail.rotation.y = Math.sin(elapsed * 8.5 + c.phase) * 0.38;
      }

      c.group.position.set(c.x - originX, c.y, c.z - originZ);
      c.group.rotation.y = -c.angle;
    }
  }
}
