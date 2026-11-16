import * as THREE from 'three';
import { PBRTextureSet } from '../../render/MaterialLibrary';
import { ShipType } from '../../types/game';

export interface ShipModelParts {
  group: THREE.Group;
  hullMesh: THREE.Mesh;
  deckLength: number;
  deckWidth: number;
  deckY: number;
  helmLocalPos: THREE.Vector3;
  sails: THREE.Mesh[];
  rudder: THREE.Mesh;
  wheel: THREE.Group;
  lanternLights: THREE.PointLight[];
  lengthHalf: number;
  beamHalf: number;
}

export const SHIP_SPECS: Record<
  ShipType,
  {
    label: string;
    cost: number;
    maxHull: number;
    length: number;
    width: number;
    maxSpeed: number;
    turnRate: number;
    cannonDmg: number;
  }
> = {
  sloop: {
    label: 'Suncrest Sloop',
    cost: 0,
    maxHull: 180,
    length: 12.5,
    width: 4.4,
    maxSpeed: 17.5,
    turnRate: 1.05,
    cannonDmg: 32,
  },
  brigantine: {
    label: 'Aether Brigantine',
    cost: 280,
    maxHull: 320,
    length: 17.5,
    width: 5.8,
    maxSpeed: 21.0,
    turnRate: 0.85,
    cannonDmg: 48,
  },
  galleon: {
    label: 'Sovereign Galleon',
    cost: 620,
    maxHull: 520,
    length: 23.0,
    width: 7.4,
    maxSpeed: 19.5,
    turnRate: 0.68,
    cannonDmg: 72,
  },
};

export function createShipModel(
  type: ShipType,
  woodPbr: PBRTextureSet,
  opts: { isHostile?: boolean; sailHex?: number } = {}
): ShipModelParts {
  const spec = SHIP_SPECS[type];
  const group = new THREE.Group();
  const len = spec.length;
  const wid = spec.width;

  const hullMat = new THREE.MeshStandardMaterial({
    map: woodPbr.map,
    normalMap: woodPbr.normalMap,
    roughnessMap: woodPbr.roughnessMap,
    color: opts.isHostile ? 0x2f252b : 0x5c3c26,
    roughness: 0.84,
    metalness: 0.08,
  });

  const deckMat = new THREE.MeshStandardMaterial({
    map: woodPbr.map,
    normalMap: woodPbr.normalMap,
    color: 0x8b6747,
    roughness: 0.88,
  });

  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xd4a448,
    roughness: 0.35,
    metalness: 0.78,
  });

  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x242a34,
    roughness: 0.48,
    metalness: 0.82,
  });

  const sailMat = new THREE.MeshStandardMaterial({
    color: opts.sailHex ?? (opts.isHostile ? 0x7f1d1d : 0xe8e2d4),
    roughness: 0.76,
    side: THREE.DoubleSide,
  });

  // Sculpted tapered boat hull from extruded/warped box geometry
  const hullGeo = new THREE.BoxGeometry(wid, 2.3, len, 6, 3, 12);
  const pos = hullGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const zNorm = z / (len * 0.5); // +1 = bow (+Z), -1 = stern (-Z)
    const yNorm = (y + 1.15) / 2.3; // 0 = keel, 1 = gunwale

    // Taper smoothly toward sharp bow (+Z) and slightly narrow stern (-Z)
    const bowTaper = zNorm > 0 ? 1 - Math.pow(zNorm, 1.55) * 0.88 : 1 - Math.pow(-zNorm, 2.2) * 0.36;
    const keelTaper = 0.42 + yNorm * 0.58;
    x *= bowTaper * keelTaper;

    // Classic sheer curve (bow & stern sweep gracefully upward)
    y += Math.pow(Math.abs(zNorm), 1.8) * (zNorm > 0 ? 0.65 : 0.45);
    pos.setXYZ(i, x, y, z);
  }
  hullGeo.computeVertexNormals();
  const hullMesh = new THREE.Mesh(hullGeo, hullMat);
  hullMesh.position.y = 0.25;
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  group.add(hullMesh);

  // Main plank deck slightly above waterline
  const deckY = 1.48;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(wid * 0.86, 0.22, len * 0.78), deckMat);
  deck.position.set(0, deckY - 0.08, -len * 0.04);
  deck.receiveShadow = true;
  group.add(deck);

  // Raised aft quarterdeck + helm platform
  const quarterDeck = new THREE.Mesh(new THREE.BoxGeometry(wid * 0.82, 0.75, len * 0.24), deckMat);
  quarterDeck.position.set(0, deckY + 0.3, -len * 0.31);
  quarterDeck.castShadow = true;
  quarterDeck.receiveShadow = true;
  group.add(quarterDeck);

  // Side bulwark rails
  [-1, 1].forEach((side) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, len * 0.72), hullMat);
    rail.position.set(side * wid * 0.42, deckY + 0.32, -len * 0.04);
    rail.castShadow = true;
    group.add(rail);
  });

  // Bowsprit pointing forward (+Z)
  const bowsprit = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, len * 0.36, 7), deckMat);
  bowsprit.rotation.x = Math.PI * 0.42;
  bowsprit.position.set(0, deckY + 0.85, len * 0.54);
  group.add(bowsprit);

  // Rudder at stern
  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.8, 1.1), hullMat);
  rudder.position.set(0, -0.35, -len * 0.5);
  group.add(rudder);

  // Ship Helm Wheel on Quarterdeck
  const helmLocalPos = new THREE.Vector3(0, deckY + 0.7, -len * 0.26);
  const wheelStand = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.9, 0.36), hullMat);
  wheelStand.position.set(helmLocalPos.x, helmLocalPos.y + 0.45, helmLocalPos.z);
  const wheel = new THREE.Group();
  wheel.position.set(helmLocalPos.x, helmLocalPos.y + 0.9, helmLocalPos.z + 0.22);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.055, 6, 12), brassMat);
  wheel.add(rim);
  for (let s = 0; s < 4; s++) {
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.96, 5), deckMat);
    spoke.rotation.z = (s * Math.PI) / 4;
    wheel.add(spoke);
  }
  group.add(wheelStand, wheel);

  // Masts & Curved Square Sails
  const sails: THREE.Mesh[] = [];
  const mastConfigs =
    type === 'sloop'
      ? [{ z: 0.6, h: 9.2, w: 5.0 }]
      : type === 'brigantine'
        ? [
            { z: 2.2, h: 10.2, w: 5.8 },
            { z: -2.4, h: 9.2, w: 5.0 },
          ]
        : [
            { z: 4.8, h: 10.6, w: 6.0 },
            { z: 0.2, h: 12.8, w: 7.2 },
            { z: -4.8, h: 9.4, w: 5.2 },
          ];

  mastConfigs.forEach((mc) => {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.22, mc.h, 8), deckMat);
    mast.position.set(0, deckY + mc.h * 0.5, mc.z);
    mast.castShadow = true;
    group.add(mast);

    const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, mc.w * 1.06, 6), deckMat);
    yard.rotation.z = Math.PI / 2;
    yard.position.set(0, deckY + mc.h * 0.78, mc.z);
    group.add(yard);

    const sailH = mc.h * 0.54;
    const sailGeo = new THREE.PlaneGeometry(mc.w, sailH, 6, 6);
    const sPos = sailGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sPos.count; i++) {
      const sx = sPos.getX(i) / (mc.w * 0.5);
      const sy = sPos.getY(i) / (sailH * 0.5);
      const belly = (1 - sx * sx * 0.65) * (1 - sy * sy * 0.55) * 0.75;
      sPos.setZ(i, belly);
    }
    sailGeo.computeVertexNormals();
    const sail = new THREE.Mesh(sailGeo, sailMat);
    sail.position.set(0, deckY + mc.h * 0.5, mc.z + 0.14);
    sail.castShadow = true;
    group.add(sail);
    sails.push(sail);
  });

  // Broadside Iron Cannons
  const cannonCountSide = type === 'sloop' ? 2 : type === 'brigantine' ? 3 : 4;
  for (let c = 0; c < cannonCountSide; c++) {
    const cz = ((c + 0.5) / cannonCountSide - 0.5) * len * 0.44;
    [-1, 1].forEach((side) => {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 1.05, 8), ironMat);
      barrel.rotation.z = side * (Math.PI / 2);
      barrel.position.set(side * (wid * 0.44), deckY + 0.42, cz);
      group.add(barrel);
    });
  }

  // Stern Warm Ship Lantern (PointLight + Glow Orb)
  const lanternLights: THREE.PointLight[] = [];
  const lanternOrb = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 8, 8),
    new THREE.MeshBasicMaterial({ color: opts.isHostile ? 0xfb7185 : 0xfde68a })
  );
  lanternOrb.position.set(0, deckY + 1.55, -len * 0.42);
  group.add(lanternOrb);

  if (!opts.isHostile) {
    const pLight = new THREE.PointLight(0xfbbf24, 3.6, 18, 2);
    pLight.position.set(0, deckY + 1.55, -len * 0.42);
    group.add(pLight);
    lanternLights.push(pLight);
  }

  return {
    group,
    hullMesh,
    deckLength: len * 0.78,
    deckWidth: wid * 0.84,
    deckY,
    helmLocalPos,
    sails,
    rudder,
    wheel,
    lanternLights,
    lengthHalf: len * 0.44,
    beamHalf: wid * 0.42,
  };
}
