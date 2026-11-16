import * as THREE from 'three';
import { FloatingOrigin } from '../../core/FloatingOrigin';
import { createCharacter, PRESETS, SKIN_TONES, HAIR_COLORS } from '../../engine/characters.js';
import type { Character } from '../../engine/characters.js';
import type { PBRTextureSet } from '../../render/MaterialLibrary';
import type { CircleCollider } from '../../entities/PhysicsWorld';
import { groundHeightAt, SettlementSite, settlementsNear } from '../TerrainHeightfield';
import { CLOTH_COLORS, getBuildingMaterials, makeRand, MatKey, Rand, setSettlementNight } from './BuildingKit';
import { BuildingRecord } from './Buildings';
import { buildSettlement, NpcRole, NpcSlot, SettlementData } from './Settlement';

/**
 * Streams procedural settlements around the player and runs their people.
 *  - Sites come from the deterministic grid in TerrainHeightfield (same world every time).
 *  - Geometry builds in small steps under a per-frame time budget.
 *  - Villagers spawn only near the player and follow simple daily routines.
 */

const LOAD_RADIUS = 620;
const UNLOAD_RADIUS = 760;
const PEOPLE_RADIUS = 150;
const PEOPLE_DESPAWN = 210;
const BUILD_BUDGET_MS = 4;

const FIRST_M = ['Aldric', 'Bran', 'Cedric', 'Doran', 'Edmund', 'Fenn', 'Gareth', 'Hugh', 'Ivo', 'Jory', 'Kael', 'Leof', 'Merek', 'Niall', 'Osric', 'Piers', 'Rowan', 'Sten', 'Tobin', 'Ulric', 'Wat', 'Alaric', 'Bertram', 'Corwin', 'Dunstan'];
const FIRST_F = ['Ada', 'Brynn', 'Cora', 'Della', 'Elsa', 'Freya', 'Gwen', 'Hilde', 'Isolde', 'Juna', 'Kara', 'Liesel', 'Maud', 'Nessa', 'Orla', 'Petra', 'Rhea', 'Sigrid', 'Tamsin', 'Una', 'Wren', 'Agnes', 'Beatrix', 'Clover', 'Edith'];

const BARKS: Record<NpcRole, string[]> = {
  villager: ['Fair day, traveler.', 'Mind the mud by the well.', 'They say the Seals are waking.', 'Wolves came close to the fences last night.', 'Haven\'t seen your face round here.'],
  farmer: ['Harvest\'s thin this year.', 'If you see a stray goat, it\'s mine.', 'Frost came early to the fields.', 'Back to the furrows for me.'],
  smith: ['Steel needs honest fire.', 'Bring me ore and I\'ll make it sing.', 'Careful, the anvil\'s hot.'],
  innkeeper: ['Warm beds and hot stew inside.', 'Ale\'s fresh from the cellar.', 'Travelers bring the best stories.'],
  merchant: ['Finest wares this side of the mountains!', 'Coin for goods, goods for coin.', 'Fresh from the harbor, all of it.'],
  priest: ['May the Seals guard your road.', 'Light a candle for the lost.', 'Peace be with you, wanderer.'],
  guard: ['Keep your weapon sheathed in town.', 'Move along.', 'Quiet night so far.', 'Report any trouble on the road.'],
  lord: ['You stand in my hall, stranger.', 'The realm needs capable hands.', 'Speak, if you have business.'],
};

interface Villager {
  name: string;
  role: NpcRole;
  char: Character;
  group: THREE.Group;
  /** Canonical world coordinates. */
  x: number;
  z: number;
  yaw: number;
  slot: NpcSlot;
  target: { x: number; z: number } | null;
  path: { x: number; z: number }[];
  wait: number;
  speed: number;
  barkCd: number;
  actionCd: number;
  lastX: number;
  lastZ: number;
  animAcc: number;
}

interface LoadedSettlement {
  site: SettlementSite;
  data: SettlementData | null;
  gen: Generator<void, SettlementData, void> | null;
  villagers: Villager[];
  discovered: boolean;
}

export interface SettlementCallbacks {
  onDiscover?: (site: SettlementSite) => void;
  onBark?: (speaker: string, line: string) => void;
}

export class SettlementSystem {
  readonly group = new THREE.Group();
  /** Canonical-world colliders for settlements near the player (walls, furniture, props). */
  colliders: CircleCollider[] = [];
  private readonly loaded = new Map<string, LoadedSettlement>();
  private readonly materials: Record<MatKey, THREE.Material>;
  private scanTimer = 0;
  private colliderKey = '';
  private readonly interiorLight = new THREE.PointLight(0xffb066, 0, 11, 2);
  private hiddenUpper: THREE.Object3D | null = null;
  private globalBarkCd = 0;
  private time = 0;
  /** Settlement the player is currently inside (if any). */
  current: SettlementSite | null = null;
  insideBuilding: BuildingRecord | null = null;

  constructor(
    parent: THREE.Object3D,
    private readonly origin: FloatingOrigin,
    stone: PBRTextureSet,
    wood: PBRTextureSet,
    private readonly cb: SettlementCallbacks = {}
  ) {
    this.group.name = 'Settlements';
    parent.add(this.group);
    this.materials = getBuildingMaterials(stone, wood);
    this.interiorLight.castShadow = false;
    this.group.add(this.interiorLight);
  }

  /** Objects the floating origin must shift. */
  shiftables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const l of this.loaded.values()) {
      if (l.data) out.push(l.data.group);
      for (const v of l.villagers) out.push(v.group);
    }
    out.push(this.interiorLight);
    return out;
  }

  /** All settlements known within a radius (for the map). */
  sitesNear(x: number, z: number, r: number) {
    return settlementsNear(x, z, r);
  }

  update(dt: number, px: number, pz: number, timeOfDay: number, active: boolean) {
    this.time += dt;
    const night = timeOfDay > 0.75 || timeOfDay < 0.22 ? 1 : timeOfDay > 0.7 ? (timeOfDay - 0.7) / 0.05 : timeOfDay < 0.27 ? (0.27 - timeOfDay) / 0.05 : 0;
    setSettlementNight(Math.max(0, Math.min(1, night)), this.time);
    this.group.visible = active;
    if (!active) return;

    // 1. discover which sites should exist
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 0.75;
      const wanted = settlementsNear(px, pz, LOAD_RADIUS);
      for (const site of wanted) {
        if (!this.loaded.has(site.id)) {
          this.loaded.set(site.id, { site, data: null, gen: buildSettlement(site, this.materials), villagers: [], discovered: false });
        }
      }
      for (const [id, l] of this.loaded) {
        if (Math.hypot(l.site.x - px, l.site.z - pz) > UNLOAD_RADIUS) this.unload(id, l);
      }
    }

    // 2. advance builds within the time budget, nearest first
    const t0 = performance.now();
    const pending = Array.from(this.loaded.values())
      .filter((l) => l.gen)
      .sort((a, b) => Math.hypot(a.site.x - px, a.site.z - pz) - Math.hypot(b.site.x - px, b.site.z - pz));
    for (const l of pending) {
      while (l.gen && performance.now() - t0 < BUILD_BUDGET_MS) {
        const r = l.gen.next();
        if (r.done) {
          l.data = r.value;
          l.gen = null;
          this.group.add(l.data.group);
        }
      }
      if (performance.now() - t0 >= BUILD_BUDGET_MS) break;
    }

    // 3. place groups, people, discovery, interiors
    this.current = null;
    let inside: BuildingRecord | null = null;
    let insideSettlement: LoadedSettlement | null = null;
    for (const l of this.loaded.values()) {
      if (!l.data) continue;
      l.data.group.position.set(this.origin.toLocalX(l.site.x), 0, this.origin.toLocalZ(l.site.z));
      const d = Math.hypot(l.site.x - px, l.site.z - pz);
      if (d < l.site.radius) {
        this.current = l.site;
        if (!l.discovered) {
          l.discovered = true;
          this.cb.onDiscover?.(l.site);
        }
        const lx = px - l.site.x;
        const lz = pz - l.site.z;
        for (const b of l.data.buildings) {
          const c = Math.cos(b.rot);
          const s = Math.sin(b.rot);
          const dx = lx - b.x;
          const dz = lz - b.z;
          const ux = dx * c - dz * s;
          const uz = dx * s + dz * c;
          if (Math.abs(ux) < b.w / 2 - 0.15 && Math.abs(uz) < b.d / 2 - 0.15) {
            inside = b;
            insideSettlement = l;
            break;
          }
        }
      }
      // people
      if (d < PEOPLE_RADIUS && l.villagers.length === 0 && l.data.npcSlots.length) this.spawnVillagers(l);
      else if (d > PEOPLE_DESPAWN && l.villagers.length) this.despawnVillagers(l);
      for (const v of l.villagers) this.updateVillager(v, l, dt, px, pz, night);
    }

    // 4. interior cutaway: hide roof/upper floors of the building the player is in, light the room
    const upperObj = inside?.upperGroup ?? null;
    if (upperObj !== this.hiddenUpper) {
      if (this.hiddenUpper) this.hiddenUpper.visible = true;
      if (upperObj) upperObj.visible = false;
      this.hiddenUpper = upperObj;
    }
    this.insideBuilding = inside;
    if (inside && insideSettlement) {
      const src = inside.hearth ?? inside.inside;
      this.interiorLight.position.set(this.origin.toLocalX(insideSettlement.site.x + src.x), (inside.hearth?.y ?? inside.inside.y) + 1.6, this.origin.toLocalZ(insideSettlement.site.z + src.z));
      this.interiorLight.intensity = THREE.MathUtils.lerp(this.interiorLight.intensity, 14 + Math.sin(this.time * 9) * 1.5, Math.min(1, dt * 6));
    } else {
      this.interiorLight.intensity = THREE.MathUtils.lerp(this.interiorLight.intensity, 0, Math.min(1, dt * 6));
    }

    // 5. colliders for settlements close to the player
    const near = Array.from(this.loaded.values()).filter((l) => l.data && Math.hypot(l.site.x - px, l.site.z - pz) < l.site.radius + 70);
    const key = near.map((l) => l.site.id).join('|');
    if (key !== this.colliderKey) {
      this.colliderKey = key;
      this.colliders = [];
      for (const l of near) for (const c of l.data!.colliders) this.colliders.push({ x: l.site.x + c.x, z: l.site.z + c.z, radius: c.r });
    }
    this.globalBarkCd = Math.max(0, this.globalBarkCd - dt);
  }

  private unload(id: string, l: LoadedSettlement) {
    this.despawnVillagers(l);
    if (l.data) {
      if (this.hiddenUpper && l.data.buildings.some((b) => b.upperGroup === this.hiddenUpper)) this.hiddenUpper = null;
      this.group.remove(l.data.group);
      l.data.group.traverse((n) => {
        const m = n as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    }
    this.loaded.delete(id);
    this.colliderKey = '';
  }

  // ------------------------------------------------------------------ people

  private lookFor(role: NpcRole, rand: Rand, banner: number) {
    const female = role !== 'guard' && role !== 'smith' && rand.chance(role === 'villager' || role === 'farmer' || role === 'merchant' ? 0.5 : 0.3);
    const skin = rand.pick(SKIN_TONES);
    const hairColor = rand.pick(HAIR_COLORS);
    const base = {
      sex: female ? 'f' : 'm',
      skin,
      height: female ? rand.range(1.58, 1.76) : rand.range(1.68, 1.9),
      bulk: rand.range(0.88, 1.25),
      eyes: rand.pick([0x4a6a3a, 0x3a6a8a, 0x5a3a1a, 0x2a2a2a]),
      hair: { style: female ? rand.pick(['long', 'braid', 'ponytail']) : rand.pick(['short', 'short', 'long', 'bald']), color: hairColor },
      beard: female ? null : rand.chance(0.6) ? { style: rand.pick(['stubble', 'full', 'goatee', 'long']), color: hairColor } : null,
    };
    const cloth = () => rand.pick([0x6a5a48, 0x4a5a3a, 0x7a6a4a, 0x5a4a3a, 0x3a4a5a, 0x8a7a5a, 0x6a3a2a, 0x4a3a2a]);
    switch (role) {
      case 'guard':
        return { ...PRESETS.guard, ...base, sex: 'm', tabard: banner, shieldColor: banner, helmet: rand.chance(0.7) ? 'nasal' : null };
      case 'smith':
        return { ...PRESETS.blacksmith, ...base, sex: 'm', shirt: cloth(), weapon: 'hammer' };
      case 'merchant':
        return female
          ? { ...PRESETS.villager, ...base, dress: rand.pick(CLOTH_COLORS), apron: 0xd8d0b8, shirt: 0xe0d8c8 }
          : { ...PRESETS.merchant, ...base, shirt: rand.pick(CLOTH_COLORS), vest: cloth(), hat: rand.chance(0.5) ? cloth() : null, cloak: null };
      case 'priest':
        return { ...PRESETS.seal_mage, ...base, robe: rand.pick([0xe8e0d0, 0x8a8a8a, 0x5a3a6a]), hood: rand.chance(0.5) ? 0x6a6a6a : null, weapon: null };
      case 'lord':
        return { ...PRESETS.jarl, ...base, cloak: { color: banner, length: 1.25 } };
      case 'innkeeper':
        return { ...PRESETS.villager, ...base, sex: base.sex, dress: female ? cloth() : null, shirt: 0xe0d8c8, pants: cloth(), apron: 0xe8e0d0, belt: 0x4a2f1c };
      default:
        return female
          ? { ...PRESETS.villager, ...base, dress: rand.pick([0x4f6b3a, 0x6a4a3a, 0x3a4a6a, 0x7a5a3a, 0x5a2a3a]), apron: rand.chance(0.6) ? 0xd8d0b8 : null, shirt: 0xd8cdb4 }
          : { name: 'Villager', ...base, shirt: cloth(), pants: cloth(), boots: 0x3a2a1c, belt: 0x4a2f1c, vest: rand.chance(0.3) ? cloth() : null, hat: rand.chance(0.25) ? cloth() : null };
    }
  }

  private spawnVillagers(l: LoadedSettlement) {
    const data = l.data!;
    const rand = makeRand(l.site.seed + 77);
    // cap the crowd for performance; important roles first
    const order: NpcRole[] = ['lord', 'smith', 'innkeeper', 'priest', 'merchant', 'guard', 'villager', 'farmer'];
    const slots = [...data.npcSlots].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role)).slice(0, l.site.type === 'town' ? 14 : l.site.type === 'castle' ? 10 : l.site.type === 'village' ? 9 : 5);
    for (const slot of slots) {
      const look = this.lookFor(slot.role, rand, data.banner);
      const female = look.sex === 'f';
      const char = createCharacter(look as Record<string, unknown>);
      const g = new THREE.Group();
      g.add(char.root);
      this.group.add(g);
      const wx = l.site.x + slot.x;
      const wz = l.site.z + slot.z;
      l.villagers.push({
        name: `${rand.pick(female ? FIRST_F : FIRST_M)}${slot.role === 'villager' || slot.role === 'farmer' ? '' : ' the ' + (slot.role === 'innkeeper' ? 'Innkeeper' : slot.role[0].toUpperCase() + slot.role.slice(1))}`,
        role: slot.role,
        char,
        group: g,
        x: wx,
        z: wz,
        yaw: slot.face,
        slot,
        target: null,
        path: [],
        wait: rand.range(0, 4),
        speed: rand.range(1.15, 1.5),
        barkCd: rand.range(0, 6),
        actionCd: rand.range(1, 3),
        lastX: wx,
        lastZ: wz,
        animAcc: 0,
      });
    }
  }

  private despawnVillagers(l: LoadedSettlement) {
    for (const v of l.villagers) {
      this.group.remove(v.group);
      v.char.dispose();
    }
    l.villagers = [];
  }

  private planWalk(v: Villager, l: LoadedSettlement) {
    const data = l.data!;
    if (!data.waypoints.length) return;
    const pick = data.waypoints[Math.floor(Math.random() * data.waypoints.length)];
    const goHome = v.slot.home && Math.random() < 0.25;
    const target = goHome ? v.slot.home!.doorOut : pick;
    // route via the settlement heart so walkers stay on the streets
    const nearest = (x: number, z: number) => data.waypoints.reduce((b, p) => (Math.hypot(p.x - x, p.z - z) < Math.hypot(b.x - x, b.z - z) ? p : b), data.waypoints[0]);
    const lx = v.x - l.site.x;
    const lz = v.z - l.site.z;
    const a = nearest(lx, lz);
    const b = nearest(target.x, target.z);
    v.path = [a, { x: 0, z: 0 }, b, target].map((p) => ({ x: l.site.x + p.x, z: l.site.z + p.z }));
    if (Math.hypot(a.x - b.x, a.z - b.z) < 25) v.path.splice(1, 1);
  }

  private updateVillager(v: Villager, l: LoadedSettlement, dt: number, px: number, pz: number, night: number) {
    const dist = Math.hypot(v.x - px, v.z - pz);
    const stationary = v.role !== 'villager' && v.role !== 'farmer';
    const sleeping = night > 0.8 && (v.role === 'villager' || v.role === 'farmer' || v.role === 'merchant');
    v.group.visible = dist < 120 && !sleeping;
    if (!v.group.visible) return;

    // movement
    if (!stationary) {
      if (v.path.length === 0) {
        v.wait -= dt;
        if (v.wait <= 0) {
          this.planWalk(v, l);
          v.wait = 2 + Math.random() * 7;
        }
      } else {
        const t = v.path[0];
        const dx = t.x - v.x;
        const dz = t.z - v.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) v.path.shift();
        else {
          const step = Math.min(d, v.speed * dt);
          v.x += (dx / d) * step;
          v.z += (dz / d) * step;
          const want = Math.atan2(dx, dz);
          let diff = want - v.yaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          v.yaw += diff * Math.min(1, dt * 6);
        }
      }
    } else {
      // stand at the post; face the player when they come close
      const wx = l.site.x + v.slot.x;
      const wz = l.site.z + v.slot.z;
      v.x += (wx - v.x) * Math.min(1, dt * 2);
      v.z += (wz - v.z) * Math.min(1, dt * 2);
      const want = dist < 6 ? Math.atan2(px - v.x, pz - v.z) : v.slot.face;
      let diff = want - v.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      v.yaw += diff * Math.min(1, dt * 3);
      v.actionCd -= dt;
      if (v.actionCd <= 0) {
        if (v.role === 'smith') v.char.play('strike');
        else if (v.role === 'merchant' && dist < 10) v.char.play('wave');
        v.actionCd = v.role === 'smith' ? 1.4 + Math.random() * 0.6 : 6 + Math.random() * 6;
      }
    }

    // barks when the player is close
    v.barkCd -= dt;
    if (dist < 3.6 && v.barkCd <= 0 && this.globalBarkCd <= 0) {
      const lines = BARKS[v.role];
      this.cb.onBark?.(v.name, lines[Math.floor(Math.random() * lines.length)]);
      v.barkCd = 25;
      this.globalBarkCd = 6;
      if (v.role !== 'smith') v.char.play('wave');
    }

    // place + animate (throttled with distance)
    const y = groundHeightAt(v.x, v.z);
    v.group.position.set(this.origin.toLocalX(v.x), y, this.origin.toLocalZ(v.z));
    v.group.rotation.y = v.yaw;
    v.animAcc += dt;
    const interval = dist < 35 ? 0 : dist < 70 ? 1 / 20 : 1 / 8;
    if (v.animAcc >= interval) {
      const sp = Math.hypot(v.x - v.lastX, v.z - v.lastZ) / v.animAcc;
      v.char.update(v.animAcc, { speed: sp });
      v.lastX = v.x;
      v.lastZ = v.z;
      v.animAcc = 0;
    }
  }

  dispose() {
    for (const [id, l] of this.loaded) this.unload(id, l);
  }
}
