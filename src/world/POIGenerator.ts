import * as THREE from 'three';
import {
  applySnowAndMacroBreakup,
  PBRTextureSet,
  SnowShaderUniforms,
} from '../render/MaterialLibrary';
import { groundHeightAt, WATER_LEVEL } from './TerrainHeightfield';
import { WORLD_POIS } from './ocean/ArchipelagoGen';

export interface HarborDockAnchor {
  id: string;
  name: string;
  x: number;
  z: number;
  shipyardX: number;
  shipyardZ: number;
}

/**
 * Generates hand-crafted landmarks, harbor wooden piers, town buildings (smithy, market, tavern),
 * lighthouses with sweeping beacons, and crossroads signposts seated cleanly on the heightfield.
 */
export function buildWorldArchitectureAndHarbors(
  stonePbr: PBRTextureSet,
  woodPbr: PBRTextureSet,
  snowUniforms: SnowShaderUniforms
): {
  group: THREE.Group;
  harborAnchors: HarborDockAnchor[];
  lighthouseBeams: THREE.Group[];
  campfires: { x: number; y: number; z: number }[];
} {
  const group = new THREE.Group();
  const harborAnchors: HarborDockAnchor[] = [];
  const lighthouseBeams: THREE.Group[] = [];
  const campfires: { x: number; y: number; z: number }[] = [];

  const stoneMat = new THREE.MeshStandardMaterial({
    map: stonePbr.map,
    normalMap: stonePbr.normalMap,
    roughnessMap: stonePbr.roughnessMap,
    aoMap: stonePbr.aoMap,
    roughness: 0.88,
    metalness: 0.08,
    color: 0x7b899e,
  });
  applySnowAndMacroBreakup(stoneMat, snowUniforms, { snowBias: 0.42 });

  const woodMat = new THREE.MeshStandardMaterial({
    map: woodPbr.map,
    normalMap: woodPbr.normalMap,
    roughnessMap: woodPbr.roughnessMap,
    roughness: 0.86,
    metalness: 0.06,
    color: 0x8f6646,
  });
  applySnowAndMacroBreakup(woodMat, snowUniforms, { snowBias: 0.55 });

  const roofMat = new THREE.MeshStandardMaterial({
    map: woodPbr.map,
    roughness: 0.78,
    color: 0x3b4963,
  });
  applySnowAndMacroBreakup(roofMat, snowUniforms, { snowBias: 0.25 });

  const lanternGlowMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    emissive: 0xf59e0b,
    emissiveIntensity: 2.8,
  });

  const addTimberHouse = (x: number, z: number, yaw: number, w = 5.5, d = 4.6, h = 3.2) => {
    const house = new THREE.Group();
    const y = groundHeightAt(x, z);
    house.position.set(x, y, z);
    house.rotation.y = yaw;

    const stonePlinth = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 1.3, d + 0.4), stoneMat);
    stonePlinth.position.y = 0.25;
    stonePlinth.castShadow = true;
    stonePlinth.receiveShadow = true;

    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), woodMat);
    walls.position.y = 0.9 + h * 0.5;
    walls.castShadow = true;
    walls.receiveShadow = true;

    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 2.5, 4), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 0.9 + h + 1.15;
    roof.castShadow = true;

    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.75, 2.2, 0.75), stoneMat);
    chimney.position.set(w * 0.28, 0.9 + h + 1.4, 0);

    const doorGlow = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.8, 0.14), lanternGlowMat);
    doorGlow.position.set(0, 1.75, d * 0.5 + 0.04);

    house.add(stonePlinth, walls, roof, chimney, doorGlow);
    group.add(house);
  };

  // Build Towns: Riverbend Market, Ironbound Forge, Skyreach Monastery gates, and Citadel Bastion Gate
  addTimberHouse(-54, 28, 0.4, 6.2, 5.0, 3.4);
  addTimberHouse(-46, 38, -0.9, 5.0, 4.4, 3.0);
  addTimberHouse(54, 34, -0.5, 6.4, 5.2, 3.6);
  addTimberHouse(62, 42, 0.8, 5.4, 4.4, 3.2);
  addTimberHouse(-8, 28, 0.15, 5.8, 4.8, 3.3); // Keep South Gatehouse Inn
  addTimberHouse(10, 26, -0.2, 5.2, 4.4, 3.0);

  // Campfires near settlements & harbors
  [
    { x: -12, z: 22 },
    { x: -49, z: 34 },
    { x: 56, z: 39 },
    { x: -22, z: 86 },
  ].forEach((cf) => {
    const cy = groundHeightAt(cf.x, cf.z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.16, 6, 10), stoneMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cf.x, cy + 0.12, cf.z);
    const logs = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.95, 6), woodMat);
    logs.rotation.z = Math.PI / 2;
    logs.position.set(cf.x, cy + 0.18, cf.z);
    const ember = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.28, 0),
      new THREE.MeshBasicMaterial({ color: 0xf97316 })
    );
    ember.position.set(cf.x, cy + 0.3, cf.z);
    group.add(ring, logs, ember);
    campfires.push({ x: cf.x, y: cy + 0.45, z: cf.z });
  });

  // Harbors & Wooden Piers extending into deep navigable water
  const buildHarborPier = (id: string, name: string, landX: number, landZ: number, dirZ = 1) => {
    const pier = new THREE.Group();
    const deckY = WATER_LEVEL + 1.05;
    const deckLength = 22;
    const centerZ = landZ + dirZ * (deckLength * 0.5);

    const deck = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.45, deckLength), woodMat);
    deck.position.set(landX, deckY, centerZ);
    deck.castShadow = true;
    deck.receiveShadow = true;
    pier.add(deck);

    // Mooring pilings every 4.5m
    for (let s = 0; s <= 4; s++) {
      const pz = landZ + dirZ * (s * 5.2);
      [-2.4, 2.4].forEach((ox) => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 5.2, 8), woodMat);
        post.position.set(landX + ox, deckY - 1.4, pz);
        post.castShadow = true;
        pier.add(post);
      });
    }

    // Pier Head Lantern + Harbor Warehouse/Shipyard Office
    const lanternPost = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 3.2, 6), woodMat);
    lanternPost.position.set(landX + 2.3, deckY + 1.6, landZ + dirZ * (deckLength - 1.5));
    const lanternOrb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 10), lanternGlowMat);
    lanternOrb.position.set(landX + 2.3, deckY + 3.2, landZ + dirZ * (deckLength - 1.5));
    pier.add(lanternPost, lanternOrb);

    addTimberHouse(landX - 7.5, landZ - dirZ * 4, dirZ > 0 ? 0.35 : -0.35, 5.8, 4.6, 3.2);

    group.add(pier);
    harborAnchors.push({
      id,
      name,
      x: landX,
      z: landZ + dirZ * deckLength,
      shipyardX: landX,
      shipyardZ: landZ + dirZ * 4,
    });
  };

  buildHarborPier('harbor_suncrest', 'Suncrest Haven Port', -22, 86, 1);
  buildHarborPier('harbor_ember', 'Cinderwash Docks', 94, 96, 1);

  // Island Lighthouses with rotating amber beacon beams
  WORLD_POIS.filter((p) => p.kind === 'lighthouse').forEach((lp) => {
    const lh = new THREE.Group();
    const ly = groundHeightAt(lp.x, lp.z);
    lh.position.set(lp.x, ly, lp.z);

    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.3, 14, 12), stoneMat);
    tower.position.y = 7;
    tower.castShadow = true;
    tower.receiveShadow = true;

    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 1.8, 0.7, 12), woodMat);
    gallery.position.y = 14.2;

    const beaconRoom = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 1.8, 10), lanternGlowMat);
    beaconRoom.position.y = 15.3;

    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.8, 1.8, 10), roofMat);
    cap.position.y = 16.9;

    const beamPivot = new THREE.Group();
    beamPivot.position.y = 15.3;
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xfde68a,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beamCone = new THREE.Mesh(new THREE.ConeGeometry(5.5, 42, 16, 1, true), beamMat);
    beamCone.rotation.x = Math.PI / 2;
    beamCone.position.z = 21;
    beamPivot.add(beamCone);

    lh.add(tower, gallery, beaconRoom, cap, beamPivot);
    group.add(lh);
    lighthouseBeams.push(beamPivot);
  });

  // Crossroads Wooden Signposts
  [
    { x: -16, z: 16, rot: 0.6 },
    { x: 16, z: 14, rot: -0.6 },
    { x: -10, z: 54, rot: 0.2 },
  ].forEach((sp) => {
    const sy = groundHeightAt(sp.x, sp.z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 2.6, 6), woodMat);
    post.position.set(sp.x, sy + 1.3, sp.z);
    const arm1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.26, 0.08), woodMat);
    arm1.position.set(sp.x + 0.35, sy + 2.25, sp.z);
    arm1.rotation.y = sp.rot;
    const arm2 = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.24, 0.08), woodMat);
    arm2.position.set(sp.x - 0.3, sy + 1.9, sp.z);
    arm2.rotation.y = -sp.rot;
    group.add(post, arm1, arm2);
  });

  return { group, harborAnchors, lighthouseBeams, campfires };
}
