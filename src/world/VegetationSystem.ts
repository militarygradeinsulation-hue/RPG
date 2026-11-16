import * as THREE from 'three';
import { CircleCollider } from '../entities/PhysicsWorld';
import {
  applySnowAndMacroBreakup,
  createPineBoughTexture,
  PBRTextureSet,
  SnowShaderUniforms,
} from '../render/MaterialLibrary';
import { SeasonType } from '../types/game';
import {
  computeTerrainSlope,
  getBiomeAt,
  getRoadMaskAt,
  isSettlementGround,
  groundHeightAt,
  hash2,
  WATER_LEVEL,
} from './TerrainHeightfield';

/**
 * Builds sculpted non-cone trees using tapered trunks, multi-angle pine-needle foliage cards
 * (alpha-tested needle textures), winter grass blades, and stratified faceted rock outcrops.
 */
export class VegetationSystem {
  public readonly group = new THREE.Group();
  private trunkMesh: THREE.InstancedMesh;
  private crownMesh: THREE.InstancedMesh;
  private rockMesh: THREE.InstancedMesh;
  private grassMesh: THREE.InstancedMesh;
  private boughTexture: THREE.CanvasTexture;
  private readonly trunkGeo: THREE.BufferGeometry;
  private readonly crownGeo: THREE.BufferGeometry;
  private readonly rockGeo: THREE.BufferGeometry;
  private readonly grassGeo: THREE.BufferGeometry;
  private lastCenterX = 99999;
  private lastCenterZ = 99999;
  public readonly colliders: CircleCollider[] = [];

  constructor(
    maxTreeCount: number,
    maxGrassCount: number,
    maxAnisotropy: number,
    stonePbr: PBRTextureSet,
    woodPbr: PBRTextureSet,
    snowUniforms: SnowShaderUniforms
  ) {
    this.boughTexture = createPineBoughTexture(maxAnisotropy);

    // 1. Gnarled tapering tree trunk geometry
    this.trunkGeo = new THREE.CylinderGeometry(0.14, 0.42, 4.4, 7);
    this.trunkGeo.translate(0, 2.2, 0);
    const trunkMat = new THREE.MeshStandardMaterial({
      map: woodPbr.map,
      normalMap: woodPbr.normalMap,
      roughnessMap: woodPbr.roughnessMap,
      color: 0x624634,
      roughness: 0.92,
    });
    this.trunkMesh = new THREE.InstancedMesh(this.trunkGeo, trunkMat, maxTreeCount);
    this.trunkMesh.castShadow = true;
    this.trunkMesh.receiveShadow = true;

    // 2. Sculpted Multi-Tier Intersecting Bough Foliage Cards (NOT cone primitives!)
    this.crownGeo = this.buildPineFoliageCrownGeometry();
    const crownMat = new THREE.MeshStandardMaterial({
      map: this.boughTexture,
      alphaTest: 0.32,
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0.02,
      color: 0xffffff,
    });
    applySnowAndMacroBreakup(crownMat, snowUniforms, { snowBias: 0.35, macroStrength: 0.14 });
    this.crownMesh = new THREE.InstancedMesh(this.crownGeo, crownMat, maxTreeCount);
    this.crownMesh.castShadow = true;
    this.crownMesh.receiveShadow = true;

    // 3. Stratified weathered rock outcrops (eroded dodecahedra with flat shelf shear)
    this.rockGeo = new THREE.DodecahedronGeometry(1.0, 1);
    const rPos = this.rockGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < rPos.count; i++) {
      const vx = rPos.getX(i);
      const vy = rPos.getY(i);
      const vz = rPos.getZ(i);
      const strata = 0.84 + Math.sin(vy * 5.2 + vx * 2.1) * 0.16;
      rPos.setXYZ(i, vx * 1.18 * strata, vy * 0.72, vz * 0.95 * strata);
    }
    this.rockGeo.computeVertexNormals();
    const rockMat = new THREE.MeshStandardMaterial({
      map: stonePbr.map,
      normalMap: stonePbr.normalMap,
      roughnessMap: stonePbr.roughnessMap,
      color: 0x6a788c,
      roughness: 0.9,
      metalness: 0.08,
    });
    applySnowAndMacroBreakup(rockMat, snowUniforms, { snowBias: 0.45, macroStrength: 0.12 });
    this.rockMesh = new THREE.InstancedMesh(this.rockGeo, rockMat, 140);
    this.rockMesh.castShadow = true;
    this.rockMesh.receiveShadow = true;

    // 4. Tapered grass & reed tuft blades
    this.grassGeo = this.buildGrassTuftGeometry();
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x6b7b56,
      roughness: 0.86,
      side: THREE.DoubleSide,
    });
    this.grassMesh = new THREE.InstancedMesh(this.grassGeo, grassMat, maxGrassCount);
    this.grassMesh.receiveShadow = true;

    this.group.add(this.trunkMesh, this.crownMesh, this.rockMesh, this.grassMesh);
  }

  private buildPineFoliageCrownGeometry(): THREE.BufferGeometry {
    // Merge 12 angled outward-sloping foliage planes in 3 whorls around the upper trunk
    const parts: { pos: number[]; norm: number[]; uv: number[]; idx: number[] } = {
      pos: [],
      norm: [],
      uv: [],
      idx: [],
    };
    let vOffset = 0;

    const addBoughCard = (yBase: number, radius: number, height: number, yaw: number, tilt: number) => {
      const plane = new THREE.PlaneGeometry(radius * 2, height, 1, 2);
      plane.translate(0, height * 0.5, 0);
      plane.rotateX(tilt);
      plane.rotateY(yaw);
      plane.translate(Math.sin(yaw) * 0.25, yBase, Math.cos(yaw) * 0.25);

      const p = plane.attributes.position as THREE.BufferAttribute;
      const n = plane.attributes.normal as THREE.BufferAttribute;
      const u = plane.attributes.uv as THREE.BufferAttribute;
      const idx = plane.index!;

      for (let i = 0; i < p.count; i++) {
        parts.pos.push(p.getX(i), p.getY(i), p.getZ(i));
        parts.norm.push(n.getX(i), n.getY(i), n.getZ(i));
        parts.uv.push(u.getX(i), u.getY(i));
      }
      for (let i = 0; i < idx.count; i++) {
        parts.idx.push(idx.getX(i) + vOffset);
      }
      vOffset += p.count;
      plane.dispose();
    };

    // 3 vertical tiers x 4 crossed bough cards + top spire cross
    const tiers = [
      { y: 1.5, rad: 2.35, h: 2.5, tilt: 0.72, blades: 4 },
      { y: 2.9, rad: 1.85, h: 2.2, tilt: 0.62, blades: 4 },
      { y: 4.1, rad: 1.25, h: 1.9, tilt: 0.45, blades: 4 },
      { y: 5.1, rad: 0.65, h: 1.5, tilt: 0.15, blades: 2 },
    ];
    tiers.forEach((tier, tIdx) => {
      for (let b = 0; b < tier.blades; b++) {
        const yaw = (b / tier.blades) * Math.PI * 2 + tIdx * 0.52;
        addBoughCard(tier.y, tier.rad, tier.h, yaw, tier.tilt);
      }
    });

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(parts.pos, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(parts.norm, 3));
    merged.setAttribute('uv', new THREE.Float32BufferAttribute(parts.uv, 2));
    merged.setIndex(parts.idx);
    merged.computeVertexNormals();
    return merged;
  }

  private buildGrassTuftGeometry(): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const blades = 5;
    for (let b = 0; b < blades; b++) {
      const ang = (b / blades) * Math.PI * 2;
      const ox = Math.cos(ang) * 0.18;
      const oz = Math.sin(ang) * 0.18;
      const leanX = Math.cos(ang) * 0.34;
      const leanZ = Math.sin(ang) * 0.34;
      const h = 0.55 + (b % 3) * 0.16;
      const w = 0.065;
      const px = -Math.sin(ang) * w;
      const pz = Math.cos(ang) * w;

      const base = b * 3;
      positions.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, ox + leanX, h, oz + leanZ);
      for (let k = 0; k < 3; k++) normals.push(0, 1, 0);
      indices.push(base, base + 1, base + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);
    return geo;
  }

  public populateAround(
    worldX: number,
    worldZ: number,
    originX: number,
    originZ: number,
    season: SeasonType,
    force = false
  ): void {
    const snapX = Math.round(worldX / 36) * 36;
    const snapZ = Math.round(worldZ / 36) * 36;
    if (!force && snapX === this.lastCenterX && snapZ === this.lastCenterZ) return;
    this.lastCenterX = snapX;
    this.lastCenterZ = snapZ;

    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const maxTrees = this.trunkMesh.count;
    const maxGrass = this.grassMesh.count;

    // Seeded grid scatter so trees sit in consistent world coordinates even as player moves
    let tIdx = 0;
    let rIdx = 0;
    let gIdx = 0;
    this.colliders.length = 0;

    const cell = 11;
    const halfSpan = 132;
    const startGx = Math.floor((snapX - halfSpan) / cell);
    const endGx = Math.floor((snapX + halfSpan) / cell);
    const startGz = Math.floor((snapZ - halfSpan) / cell);
    const endGz = Math.floor((snapZ + halfSpan) / cell);

    for (let gz = startGz; gz <= endGz; gz++) {
      for (let gx = startGx; gx <= endGx; gx++) {
        const s = hash2(gx * 1.13, gz * 2.71);
        const wx = (gx + 0.15 + hash2(gx, gz * 4.1) * 0.7) * cell;
        const wz = (gz + 0.15 + hash2(gx * 3.7, gz) * 0.7) * cell;
        const distCenter = Math.hypot(wx, wz);
        if (distCenter < 20) continue; // Keep central shrine stone plaza clear
        if (getRoadMaskAt(wx, wz) > 0.25) continue; // Keep roads clear
        if (isSettlementGround(wx, wz)) continue; // Keep villages, towns and castle grounds clear

        const y = groundHeightAt(wx, wz);
        if (y < WATER_LEVEL + 0.55) continue; // Don't spawn forest trees underwater
        const slope = computeTerrainSlope(wx, wz);
        const biome = getBiomeAt(wx, wz);

        if (s > 0.56 && tIdx < maxTrees && slope < 0.52) {
          const sc = (0.78 + hash2(gx + 5, gz) * 0.65) * (biome === 'ember' ? 0.85 : 1.05);
          dummy.position.set(wx - originX, y - 0.15, wz - originZ);
          dummy.rotation.set(0, hash2(gx, gz + 9) * Math.PI * 2, 0);
          dummy.scale.setScalar(sc);
          dummy.updateMatrix();
          this.trunkMesh.setMatrixAt(tIdx, dummy.matrix);
          this.crownMesh.setMatrixAt(tIdx, dummy.matrix);
          this.colliders.push({ x: wx, z: wz, radius: 0.42 * sc, height: 4.4 * sc });

          if (biome === 'ember') col.setHex(0x523f38);
          else if (season === 'Autumn') col.setHex(hash2(gx, gz) > 0.7 ? 0xb45309 : 0x3b6e3c);
          else if (biome === 'aether') col.setHex(0x6e8fa6);
          else col.setHex(season === 'Winter' ? 0x5c7d6e : 0x3b7a4a);

          this.crownMesh.setColorAt(tIdx, col);
          tIdx++;
        } else if (s > 0.34 && s <= 0.44 && rIdx < this.rockMesh.count) {
          const rScale = 0.65 + hash2(gx * 2, gz * 3) * 1.45;
          dummy.position.set(wx - originX, y + rScale * 0.22, wz - originZ);
          dummy.rotation.set(hash2(gx, 1) * 0.5, hash2(gz, 2) * Math.PI * 2, hash2(gx, 3) * 0.5);
          dummy.scale.set(rScale * 1.15, rScale * 0.72, rScale);
          dummy.updateMatrix();
          this.rockMesh.setMatrixAt(rIdx, dummy.matrix);
          this.colliders.push({ x: wx, z: wz, radius: 0.92 * rScale, height: 1.4 * rScale });
          rIdx++;
        } else if (s > 0.1 && s <= 0.32 && gIdx < maxGrass && slope < 0.45) {
          const gScale = 0.75 + hash2(gx, gz) * 0.6;
          dummy.position.set(wx - originX, y - 0.03, wz - originZ);
          dummy.rotation.set(0, hash2(gx, gz) * Math.PI, 0);
          dummy.scale.setScalar(gScale);
          dummy.updateMatrix();
          this.grassMesh.setMatrixAt(gIdx, dummy.matrix);

          if (season === 'Winter') col.setHex(0x6b7c86);
          else if (biome === 'ember') col.setHex(0x5a4332);
          else col.setHex(0x3f7a44);
          this.grassMesh.setColorAt(gIdx, col);
          gIdx++;
        }
      }
    }

    this.trunkMesh.count = tIdx;
    this.crownMesh.count = tIdx;
    this.rockMesh.count = rIdx;
    this.grassMesh.count = gIdx;

    this.trunkMesh.instanceMatrix.needsUpdate = true;
    this.crownMesh.instanceMatrix.needsUpdate = true;
    if (this.crownMesh.instanceColor) this.crownMesh.instanceColor.needsUpdate = true;
    this.rockMesh.instanceMatrix.needsUpdate = true;
    this.grassMesh.instanceMatrix.needsUpdate = true;
    if (this.grassMesh.instanceColor) this.grassMesh.instanceColor.needsUpdate = true;
  }

  public dispose(): void {
    this.boughTexture.dispose();
    this.trunkGeo.dispose();
    this.crownGeo.dispose();
    this.rockGeo.dispose();
    this.grassGeo.dispose();
  }
}
