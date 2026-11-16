import * as THREE from 'three';
import type { PBRTextureSet } from '../render/MaterialLibrary';
import { groundHeightAt } from './TerrainHeightfield';
import { resolveVillageMovement } from './BuildingCollision';
import { BuildingPlan, SettlementPlan, settlementCellAt, settlementsForCell, SETTLEMENT_CELL_SIZE } from './SettlementGenerator';

/** A spatially bounded, deterministic world layer. Only nearby villages exist as 3D objects. */
interface ActiveSettlement {
  plan: SettlementPlan;
  group: THREE.Group;
  roofs: { mesh: THREE.Object3D; x: number; z: number; radius: number }[];
  residents: THREE.InstancedMesh;
  residentHeads: THREE.InstancedMesh;
  originHeight: number;
}
export class LivingSettlementSystem {
  public readonly group = new THREE.Group();
  private readonly active = new Map<string, ActiveSettlement>();
  private readonly wallMaterials: THREE.MeshStandardMaterial[];
  private readonly roofMaterials: THREE.MeshStandardMaterial[];
  private readonly timber: THREE.MeshStandardMaterial;
  private readonly floorMat: THREE.MeshStandardMaterial;
  private readonly glassMat: THREE.MeshStandardMaterial;
  private readonly residentBodyGeo = new THREE.CapsuleGeometry(0.35, 0.95, 4, 7);
  private readonly residentHeadGeo = new THREE.IcosahedronGeometry(0.31, 1);
  private readonly residentBodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96 });
  private readonly residentHeadMat = new THREE.MeshStandardMaterial({ color: 0xd8b8a0, roughness: 0.94 });
  private lastResidentStep = 0;
  private lastSettlementBuild = 0;
  private readonly pendingSites = new Map<string, SettlementPlan>();
  private readonly residentDummy = new THREE.Object3D();
  private readonly localBuildings: BuildingPlan[] = [];
  private lastCollisionCellX = Number.NaN;
  private lastCollisionCellZ = Number.NaN;
  private lastCellX = Number.NaN;
  private lastCellZ = Number.NaN;
  public readonly visibleSettlements: SettlementPlan[] = [];

  constructor(stonePbr: PBRTextureSet, woodPbr: PBRTextureSet) {
    this.wallMaterials = [0x778495, 0xb8a58d, 0x82766e, 0x9e9383, 0x6b777f, 0xa5967f]
      .map(color => new THREE.MeshStandardMaterial({
        color, map: stonePbr.map, normalMap: stonePbr.normalMap,
        roughnessMap: stonePbr.roughnessMap, roughness: 0.85,
      }));
    this.roofMaterials = [0x424d63, 0x60483e, 0x464f47, 0x473c53, 0x555f65, 0x735543]
      .map(color => new THREE.MeshStandardMaterial({
        color, map: woodPbr.map, normalMap: woodPbr.normalMap,
        roughnessMap: woodPbr.roughnessMap, roughness: 0.91,
      }));
    this.timber = new THREE.MeshStandardMaterial({ color: 0x4e372c, map: woodPbr.map, normalMap: woodPbr.normalMap, roughness: 0.9 });
    this.floorMat = new THREE.MeshStandardMaterial({ color: 0x6c665c, map: stonePbr.map, normalMap: stonePbr.normalMap, roughness: 0.95 });
    this.glassMat = new THREE.MeshStandardMaterial({
      color: 0xf0c981, emissive: 0xf4a739, emissiveIntensity: 0.55, roughness: 0.3,
    });
  }

  /** Geometry is located in absolute world coordinates within each local group. */
  private buildBuilding(plan: BuildingPlan, style: number): { group: THREE.Group; roof: THREE.Object3D } {
    const group = new THREE.Group();
    const y = groundHeightAt(plan.x, plan.z);
    group.position.set(plan.x, y, plan.z);
    group.rotation.y = plan.yaw;
    const w = plan.width;
    const d = plan.depth;
    const levels = plan.floors;
    const height = levels * 3.3;
    const wall = this.wallMaterials[style % this.wallMaterials.length];
    const roofMat = this.roofMaterials[(style + Math.floor(plan.seed * 6)) % this.roofMaterials.length];

    const box = (width: number, tall: number, depth: number,
      x: number, yy: number, z: number, material: THREE.Material, parent: THREE.Group = group) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, tall, depth), material);
      mesh.position.set(x, yy, z);
      mesh.castShadow = tall > 1;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    // Walk-in ground floor: a real doorway replaces the front wall centre.
    // Interior floor, hearth, furniture, and windows are separate from the facade.
    box(w + 0.6, 0.36, d + 0.6, 0, 0.06, 0, this.floorMat);
    box(w, height, 0.34, 0, height * 0.5, -d * 0.5, wall);
    box(0.34, height, d, -w * 0.5, height * 0.5, 0, wall);
    box(0.34, height, d, w * 0.5, height * 0.5, 0, wall);
    const doorW = Math.min(2.1, w * 0.34);
    const sideW = (w - doorW) * 0.5;
    box(sideW, height, 0.34, -(doorW + sideW) * 0.5, height * 0.5, d * 0.5, wall);
    box(sideW, height, 0.34, (doorW + sideW) * 0.5, height * 0.5, d * 0.5, wall);
    box(doorW, Math.max(0.3, height - 2.65), 0.34, 0, (height + 2.65) * 0.5, d * 0.5, wall);

    for (let floor = 0; floor < levels; floor++) {
      if (floor > 0) box(w - 0.5, 0.18, d - 0.5, 0, floor * 3.3, 0, this.floorMat);
      // Front and rear windows. Each elevation has a distinct rhythm.
      for (let n = 0; n < (plan.kind === 'keep' ? 4 : 2); n++) {
        const u = ((n + 1) / ((plan.kind === 'keep' ? 4 : 2) + 1) - 0.5) * (w - 0.6);
        if (floor === 0 && Math.abs(u) < doorW * 0.7) continue;
        box(0.52, 0.8, 0.06, u, floor * 3.3 + 1.7, -d * 0.5 - 0.2, this.glassMat);
      }
    }
    // Furnished, lit interior. No extra real-time lights or texture downloads.
    const furnitureCount = plan.kind === 'inn' ? 4 : plan.kind === 'keep' ? 5 : 2;
    for (let i = 0; i < furnitureCount; i++) {
      const x = (i % 2 ? 1 : -1) * (w * 0.26);
      const z = -d * 0.3 + Math.floor(i / 2) * 1.6;
      box(1.0 + plan.seed, 0.15, 0.85, x, 0.95, z, this.timber);
      for (const ox of [-0.36, 0.36]) {
        box(0.13, 0.9, 0.13, x + ox, 0.48, z, this.timber);
      }
    }
    const roof = new THREE.Group();
    if (plan.kind === 'watchtower' || plan.kind === 'keep') {
      const parapet = box(w + 0.8, 0.28, d + 0.8, 0, height + 0.1, 0, this.floorMat, roof);
      parapet.castShadow = true;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        box(1.15, 1.45, 1.15, sx * (w - 1) * 0.5, height + 0.85, sz * (d - 1) * 0.5, wall, roof);
      }
      if (plan.kind === 'keep') {
        const crown = new THREE.Mesh(new THREE.ConeGeometry(2.4, 3.2, 8), roofMat);
        crown.position.set(0, height + 2, 0);
        crown.castShadow = true;
        roof.add(crown);
      }
    } else {
      const ridge = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.74, 2.4 + plan.seed, 4), roofMat);
      ridge.rotation.y = Math.PI / 4 + (plan.seed > 0.5 ? Math.PI / 2 : 0);
      ridge.position.y = height + 1;
      ridge.castShadow = true;
      roof.add(ridge);
      box(0.8, 2.8, 0.8, w * 0.28, height + 0.8, -d * 0.2, wall, roof);
    }
    group.add(roof);

    // Visual accents give each residence a different silhouette.
    if (plan.kind === 'inn') {
      box(1.3, 0.14, 0.75, w * 0.3, 2.8, d * 0.56, this.timber);
      box(0.7, 0.7, 0.08, w * 0.3, 2.25, d * 0.58, this.glassMat);
    }
    if (plan.kind === 'chapel') {
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.8, 0), this.glassMat);
      crystal.position.y = height + 3.3;
      group.add(crystal);
    }
    return { group, roof };
  }

  private makeSettlement(plan: SettlementPlan, originX: number, originZ: number): ActiveSettlement {
    const root = new THREE.Group();
    const roofs: ActiveSettlement['roofs'] = [];
    for (const building of plan.buildings) {
      const built = this.buildBuilding(building, plan.style);
      root.add(built.group);
      roofs.push({ mesh: built.roof, x: building.x, z: building.z, radius: Math.max(building.width, building.depth) * 0.8 });
    }
    // Compact wandering citizens: two instanced draw calls per settlement,
    // with unique tunic colors and no heavy skeletal animation per resident.
    const count = Math.min(12, plan.residents);
    const body = new THREE.InstancedMesh(this.residentBodyGeo, this.residentBodyMat, count);
    const heads = new THREE.InstancedMesh(this.residentHeadGeo, this.residentHeadMat, count);
    body.frustumCulled = false;
    heads.frustumCulled = false;
    root.position.set(plan.x - originX, groundHeightAt(plan.x, plan.z), plan.z - originZ);
    root.add(body, heads);
    // Buildings use absolute placement before being added to the settlement
    // root; convert them once into coordinates relative to that root.
    for (const child of root.children) {
      if (child !== body && child !== heads) {
        child.position.x -= plan.x;
        child.position.y -= groundHeightAt(plan.x, plan.z);
        child.position.z -= plan.z;
      }
    }
    this.group.add(root);
    return { plan, group: root, roofs, residents: body, residentHeads: heads, originHeight: groundHeightAt(plan.x, plan.z) };
  }

  public update(worldX: number, worldZ: number, originX: number, originZ: number): void {
    const { cx, cz } = settlementCellAt(worldX, worldZ);
    if (cx !== this.lastCellX || cz !== this.lastCellZ) {
      this.lastCellX = cx;
      this.lastCellZ = cz;
      const wanted = new Map<string, SettlementPlan>();
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        for (const site of settlementsForCell(cx + dx, cz + dz)) wanted.set(site.id, site);
      }
      for (const [key, site] of this.active) {
        if (!wanted.has(key)) {
          this.group.remove(site.group);
          site.group.traverse(obj => {
            if (obj instanceof THREE.Mesh && !(obj instanceof THREE.InstancedMesh)) obj.geometry.dispose();
          });
          this.active.delete(key);
        }
      }
      this.pendingSites.clear();
      for (const [key, plan] of wanted) {
        if (!this.active.has(key)) this.pendingSites.set(key, plan);
      }
      this.lastCollisionCellX = Number.NaN;
      this.visibleSettlements.length = 0;
      this.visibleSettlements.push(...Array.from(this.active.values(), site => site.plan));
    }

    // Generate only one settlement per ~90 ms, nearest first. Prevent a
    // sudden multi-village geometry spike when crossing a cell boundary.
    const buildTime = performance.now();
    if (this.pendingSites.size && buildTime - this.lastSettlementBuild >= 90) {
      let selected: SettlementPlan | null = null;
      let selectedKey = '';
      let closest = Infinity;
      for (const [key, plan] of this.pendingSites) {
        const dx = plan.x - worldX;
        const dz = plan.z - worldZ;
        const d = dx * dx + dz * dz;
        if (d < closest) {
          selected = plan;
          selectedKey = key;
          closest = d;
        }
      }
      if (selected) {
        this.active.set(selectedKey, this.makeSettlement(selected, originX, originZ));
        this.lastCollisionCellX = Number.NaN;
        this.pendingSites.delete(selectedKey);
        this.lastSettlementBuild = buildTime;
        this.visibleSettlements.push(selected);
      }
    }

    // Residents wander near their settlement square. Update at 8 Hz to
    // limit GPU buffer uploads while preserving visible motion and variation.
    const now = performance.now();
    if (now - this.lastResidentStep >= 125) {
      this.lastResidentStep = now;
      for (const site of this.active.values()) {
        for (let i = 0; i < site.residents.count; i++) {
          const phase = now * (0.00019 + (i % 4) * 0.000027) + i * 2.399963 + site.plan.style;
          const radius = 4.5 + i * 0.75;
          const wx = site.plan.x + Math.cos(phase) * radius;
          const wz = site.plan.z + Math.sin(phase) * radius;
          const y = groundHeightAt(wx, wz) - site.originHeight;
          this.residentDummy.position.set(wx - site.plan.x, y + 1.05, wz - site.plan.z);
          this.residentDummy.rotation.set(0, -phase, 0);
          this.residentDummy.scale.setScalar(0.82 + ((i + site.plan.style) % 4) * 0.07);
          this.residentDummy.updateMatrix();
          site.residents.setMatrixAt(i, this.residentDummy.matrix);
          site.residents.setColorAt(i, new THREE.Color().setHSL(
            (i * 0.15 + site.plan.style * 0.09) % 1, 0.34, 0.42
          ));
          this.residentDummy.position.y = y + 2.15;
          this.residentDummy.scale.setScalar(0.84);
          this.residentDummy.updateMatrix();
          site.residentHeads.setMatrixAt(i, this.residentDummy.matrix);
        }
        site.residents.instanceMatrix.needsUpdate = true;
        if (site.residents.instanceColor) site.residents.instanceColor.needsUpdate = true;
        site.residentHeads.instanceMatrix.needsUpdate = true;
      }
    }

    // Called after floating-origin rebasing; keep camera and villages in
    // the same local coordinate frame without per-frame allocations.
    for (const site of this.active.values()) {
      site.group.position.x = site.plan.x - originX;
      site.group.position.z = site.plan.z - originZ;
      for (const roof of site.roofs) {
        const dx = roof.x - worldX, dz = roof.z - worldZ;
        roof.mesh.visible = dx * dx + dz * dz > roof.radius * roof.radius;
      }
    }
  }

  /** Resolve nearby house and castle walls, allowing movement through doors. */
  public resolvePlayerMovement(fromX: number, fromZ: number, toX: number, toZ: number): { x: number; z: number } {
    const cx = Math.floor(toX / 16);
    const cz = Math.floor(toZ / 16);
    if (cx !== this.lastCollisionCellX || cz !== this.lastCollisionCellZ) {
      this.lastCollisionCellX = cx;
      this.lastCollisionCellZ = cz;
      this.localBuildings.length = 0;
      for (const settlement of this.active.values()) {
        for (const building of settlement.plan.buildings) {
          if (Math.abs(building.x - toX) < 36 && Math.abs(building.z - toZ) < 36) {
            this.localBuildings.push(building);
          }
        }
      }
    }
    return resolveVillageMovement(fromX, fromZ, toX, toZ, this.localBuildings);
  }

  public dispose(): void {
    for (const site of this.active.values()) {
      this.group.remove(site.group);
      site.group.traverse(obj => {
        if (obj instanceof THREE.Mesh && !(obj instanceof THREE.InstancedMesh)) obj.geometry.dispose();
      });
    }
    this.active.clear();
    this.pendingSites.clear();
    this.residentBodyGeo.dispose();
    this.residentHeadGeo.dispose();
    this.residentBodyMat.dispose();
    this.residentHeadMat.dispose();
    [...this.wallMaterials, ...this.roofMaterials, this.timber, this.floorMat, this.glassMat]
      .forEach(material => material.dispose());
  }
}
