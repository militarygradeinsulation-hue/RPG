import * as THREE from 'three';
import { getBiomeAt, groundHeightAt, SettlementSite, SettlementStreet } from '../TerrainHeightfield';
import { CLOTH_COLORS, DOOR_COLORS, GeoBatch, makeRand, MatKey, PLASTER_COLORS, Rand, RegionStyle, SHUTTER_COLORS, tint } from './BuildingKit';
import { BuildingKind, BuildingRecord, buildHouse, buildWallRing, Collider2 } from './Buildings';

/**
 * Lays out and builds one settlement from its deterministic site.
 * Building happens in small steps (a generator) so streaming never hitches a frame.
 */

export type NpcRole = 'villager' | 'smith' | 'innkeeper' | 'merchant' | 'priest' | 'guard' | 'lord' | 'farmer';

export interface NpcSlot {
  role: NpcRole;
  /** Settlement-local anchor where the NPC works or stands. */
  x: number;
  z: number;
  /** Facing when standing at the anchor. */
  face: number;
  home?: BuildingRecord;
}

export interface SettlementData {
  site: SettlementSite;
  style: RegionStyle;
  snow: boolean;
  banner: number;
  wealth: number;
  buildings: BuildingRecord[];
  colliders: Collider2[]; // settlement-local
  npcSlots: NpcSlot[];
  /** Points on streets that villagers walk between (settlement-local). */
  waypoints: { x: number; z: number }[];
  group: THREE.Group;
}

interface Footprint {
  x: number;
  z: number;
  r: number;
}

function distToSeg(px: number, pz: number, s: SettlementStreet, ox: number, oz: number) {
  const ax = s.ax - ox;
  const az = s.az - oz;
  const bx = s.bx - ox;
  const bz = s.bz - oz;
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

const KIND_SIZE: Record<BuildingKind, [number, number, number, number, number, number]> = {
  // wMin, wMax, dMin, dMax, floorsMin, floorsMax
  cottage: [4.6, 6.2, 5.2, 6.8, 1, 1],
  house: [5.6, 8.0, 6.2, 8.6, 1, 2],
  inn: [9.0, 12.0, 9.0, 11.5, 2, 2],
  smithy: [6.5, 8.0, 6.0, 7.5, 1, 1],
  chapel: [6.5, 8.0, 11.0, 15.0, 1, 1],
  barn: [7.5, 10.0, 9.0, 12.0, 1, 1],
  shop: [6.0, 8.0, 6.5, 8.5, 2, 2],
  manor: [10.0, 13.0, 9.0, 11.0, 2, 3],
  keep: [14.0, 18.0, 12.0, 15.0, 2, 3],
  barracks: [10.0, 13.0, 6.5, 7.5, 1, 1],
  stable: [9.0, 11.0, 6.5, 7.5, 1, 1],
};

export function* buildSettlement(
  site: SettlementSite,
  materials: Record<MatKey, THREE.Material>
): Generator<void, SettlementData, void> {
  const rand = makeRand(site.seed);
  const ox = site.x;
  const oz = site.z;
  const biome = getBiomeAt(ox, oz);
  const cold = biome === 'aether' || site.padY > 17;
  const style: RegionStyle = biome === 'ember' ? 'ember' : cold ? (rand.chance(0.55) ? 'log' : 'stone') : biome === 'verdant' ? 'timber' : rand.chance(0.75) ? 'timber' : 'stone';
  const snow = cold;
  const wealth =
    site.type === 'town' ? rand.range(0.55, 0.95) : site.type === 'castle' ? rand.range(0.7, 1) : site.type === 'village' ? rand.range(0.3, 0.7) : rand.range(0.1, 0.4);
  const settlementAge = rand.range(0.1, 0.8);
  const banner = rand.pick(CLOTH_COLORS.slice(0, 6));

  // settlement palette: a subset of colors gives each place its own character
  const plasters = [rand.pick(PLASTER_COLORS), rand.pick(PLASTER_COLORS), rand.pick(PLASTER_COLORS)];
  const shutters = [rand.pick(SHUTTER_COLORS), rand.pick(SHUTTER_COLORS)];
  const roofPool: MatKey[] =
    style === 'ember' ? ['slate', 'slate', 'shingle'] : style === 'log' ? ['shingle', 'shingle', 'thatch'] : style === 'stone' ? ['slate', 'shingle', 'slate'] : wealth > 0.6 ? ['shingle', 'slate', 'thatch'] : ['thatch', 'thatch', 'shingle'];

  const groundY = (lx: number, lz: number) => groundHeightAt(ox + lx, oz + lz);
  const main = new GeoBatch();
  const group = new THREE.Group();
  group.name = `Settlement:${site.name}`;
  const buildings: BuildingRecord[] = [];
  const colliders: Collider2[] = [];
  const npcSlots: NpcSlot[] = [];
  const foot: Footprint[] = [];
  const streets = site.streets;

  const fits = (x: number, z: number, w: number, d: number, rot: number, maxR: number, minR = 0) => {
    const r = Math.hypot(w, d) / 2;
    const dc = Math.hypot(x, z);
    if (dc + r > maxR || dc - r < minR) return false;
    for (const f of foot) if (Math.hypot(f.x - x, f.z - z) < f.r + r * 0.82 + 0.6) return false;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [0, -1]]) {
      const lx = (a * w) / 2;
      const lz = (b * d) / 2;
      const px = x + lx * c + lz * s;
      const pz = z - lx * s + lz * c;
      for (const st of streets) if (distToSeg(px, pz, st, ox, oz) < st.width / 2 + 0.5) return false;
    }
    return true;
  };

  const makeSpec = (kind: BuildingKind, x: number, z: number, rot: number, w: number, d: number, floors: number) => {
    const bStyle: RegionStyle = kind === 'keep' || kind === 'barracks' ? 'stone' : kind === 'barn' || kind === 'stable' ? style : style === 'timber' && rand.chance(0.12) ? 'stone' : style;
    const roofMat: MatKey = kind === 'keep' ? 'slate' : kind === 'chapel' ? (style === 'timber' ? 'slate' : rand.pick(roofPool)) : rand.pick(roofPool);
    const roof = kind === 'keep' ? 'flat' : kind === 'chapel' ? 'steep' : rand.chance(snow ? 0.15 : 0.22) ? 'hip' : snow || rand.chance(0.2) ? 'steep' : 'gable';
    return {
      kind,
      x,
      y: groundY(x, z),
      z,
      rot,
      w,
      d,
      floors,
      style: bStyle,
      roof: roof as 'gable' | 'steep' | 'hip' | 'flat',
      roofMat,
      wallColor: rand.pick(plasters),
      trim: 0x4a3424,
      shutter: rand.chance(0.8) ? rand.pick(shutters) : rand.pick(SHUTTER_COLORS),
      door: rand.pick(DOOR_COLORS),
      snow,
      wealth: Math.min(1, wealth + rand.range(-0.2, 0.2)),
      age: Math.min(1, Math.max(0, settlementAge + rand.range(-0.3, 0.3))),
      banner,
    };
  };

  function* placeGen(kind: BuildingKind, x: number, z: number, rot: number, w: number, d: number, floors: number): Generator<void, BuildingRecord, void> {
    const rec = buildHouse(main, makeSpec(kind, x, z, rot, w, d, floors), rand);
    yield;
    rec.upperGroup = rec.upper.build(materials);
    rec.upperGroup.name = `${kind}-upper`;
    group.add(rec.upperGroup);
    const bIdx = buildings.length;
    buildings.push(rec);
    for (const c of rec.colliders) {
      c.bIdx = bIdx;
      colliders.push(c);
    }
    foot.push({ x, z, r: Math.hypot(w, d) / 2 });
    return rec;
  }

  /** Tries to line a building along streets; returns the record or null. */
  function* placeAlongStreetsGen(kind: BuildingKind, maxR: number, minR = 0, tries = 40): Generator<void, BuildingRecord | null, void> {
    const [w0, w1, d0, d1, f0, f1] = KIND_SIZE[kind];
    for (let t = 0; t < tries; t++) {
      const st = rand.pick(streets);
      const u = rand.range(0.05, 0.95);
      const sx = st.ax + (st.bx - st.ax) * u - ox;
      const sz = st.az + (st.bz - st.az) * u - oz;
      const len = Math.hypot(st.bx - st.ax, st.bz - st.az) || 1;
      const nx = -(st.bz - st.az) / len;
      const nz = (st.bx - st.ax) / len;
      const side = rand.chance(0.5) ? 1 : -1;
      const w = rand.range(w0, w1);
      const d = rand.range(d0, d1);
      const setback = st.width / 2 + rand.range(1.0, 2.6) + d / 2;
      const x = sx + nx * side * setback;
      const z = sz + nz * side * setback;
      // face the street (+z of the building toward the street), slightly irregular
      const rot = Math.atan2(-nx * side, -nz * side) + rand.range(-0.06, 0.06);
      if (!fits(x, z, w, d, rot, maxR, minR)) continue;
      return yield* placeGen(kind, x, z, rot, w, d, rand.int(f0, f1));
    }
    return null;
  }

  // ---------------------------------------------------------------- layout
  const R = site.radius;
  const roles: NpcSlot[] = [];
  const insideSlot = (rec: BuildingRecord | null, role: NpcRole) => {
    if (!rec) return;
    roles.push({ role, x: rec.inside.x, z: rec.inside.z, face: rec.rot + Math.PI, home: rec });
  };

  if (site.type === 'castle') {
    // curtain wall polygon
    const n = rand.int(6, 8);
    const cr = R * 0.66;
    const pts = Array.from({ length: n }, (_, i) => {
      const a = site.angle + (i / n) * Math.PI * 2 + rand.range(-0.12, 0.12);
      const rr = cr * rand.range(0.86, 1.08);
      return { x: Math.cos(a) * rr, z: Math.sin(a) * rr };
    });
    // gate on the edge facing the main street end
    let gate = 0;
    let best = Infinity;
    const mainEnd = { x: streets[0].ax - ox, z: streets[0].az - oz };
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dd = Math.hypot((a.x + b.x) / 2 - mainEnd.x, (a.z + b.z) / 2 - mainEnd.z);
      if (dd < best) {
        best = dd;
        gate = i;
      }
    }
    // keep at the back of the courtyard
    const ga = pts[gate];
    const gb = pts[(gate + 1) % n];
    const gx = (ga.x + gb.x) / 2;
    const gz = (ga.z + gb.z) / 2;
    const gl = Math.hypot(gx, gz) || 1;
    const kx = (-gx / gl) * cr * 0.32;
    const kz = (-gz / gl) * cr * 0.32;
    const [kw0, kw1, kd0, kd1, kf0, kf1] = KIND_SIZE.keep;
    const keep = yield* placeGen('keep', kx, kz, Math.atan2(gx, gz), rand.range(kw0, kw1), rand.range(kd0, kd1), rand.int(kf0, kf1));
    insideSlot(keep, 'lord');
    yield;
    for (const kind of ['barracks', 'stable', 'smithy', rand.chance(0.6) ? 'chapel' : 'house'] as BuildingKind[]) {
      const [w0, w1, d0, d1, f0, f1] = KIND_SIZE[kind];
      for (let t = 0; t < 30; t++) {
        const a = rand() * Math.PI * 2;
        const rr = cr * rand.range(0.45, 0.72);
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        const w = rand.range(w0, w1);
        const d = rand.range(d0, d1);
        const rot = Math.atan2(-x, -z);
        if (!fits(x, z, w, d, rot, cr - 2.5)) continue;
        const rec = yield* placeGen(kind, x, z, rot, w, d, rand.int(f0, f1));
        insideSlot(rec, kind === 'smithy' ? 'smith' : kind === 'chapel' ? 'priest' : 'guard');
        break;
      }
      yield;
    }
    main.frame.identity();
    buildWallRing(main, { points: pts, height: rand.range(7, 9.5), thickness: 2.2, palisade: false, gates: [gate], roofMat: 'slate', banner, snow, groundY }, rand, colliders);
    yield;
    // guards at the gate and on the courtyard
    roles.push({ role: 'guard', x: gx * 1.12 + (gb.x - ga.x) * 0.12, z: gz * 1.12 + (gb.z - ga.z) * 0.12, face: Math.atan2(gx, gz) });
    roles.push({ role: 'guard', x: gx * 1.12 - (gb.x - ga.x) * 0.12, z: gz * 1.12 - (gb.z - ga.z) * 0.12, face: Math.atan2(gx, gz) });
    roles.push({ role: 'guard', x: kx * 0.4, z: kz * 0.4, face: 0 });
    // training yard dummies + well
    for (let k = 0; k < 3; k++) {
      const a = rand() * Math.PI * 2;
      const x = Math.cos(a) * cr * 0.3;
      const z = Math.sin(a) * cr * 0.3;
      if (foot.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + 1)) continue;
      prop.dummy(main, x, groundY(x, z), z, rand);
    }
    prop.well(main, 0, groundY(0, 0), 0, rand, snow);
    colliders.push({ x: 0, z: 0, r: 1.3, h: 2.4, cam: false });
    // a few cottages outside the gate along the road
    for (let k = 0; k < rand.int(2, 4); k++) {
      const rec = yield* placeAlongStreetsGen('cottage', R * 1.0, cr + 4);
      if (rec) roles.push({ role: 'farmer', x: rec.doorOut.x, z: rec.doorOut.z, face: rec.rot, home: rec });
      yield;
    }
    yield;
  } else {
    const isTown = site.type === 'town';
    const walled = isTown && (wealth > 0.6 || rand.chance(0.5));
    const maxR = walled ? R * 0.86 : R * 0.97;
    const plan: BuildingKind[] = [];
    if (site.type === 'hamlet') {
      for (let k = 0; k < rand.int(3, 5); k++) plan.push(rand.chance(0.6) ? 'cottage' : 'house');
      plan.push('barn');
    } else if (site.type === 'village') {
      plan.push('inn', 'smithy');
      if (rand.chance(0.65)) plan.push('chapel');
      if (rand.chance(0.6)) plan.push('shop');
      for (let k = 0; k < rand.int(7, 11); k++) plan.push(rand.chance(0.35) ? 'cottage' : 'house');
      for (let k = 0; k < rand.int(1, 2); k++) plan.push('barn');
    } else {
      plan.push('inn', 'inn', 'smithy', 'chapel', 'shop', 'shop', 'manor');
      if (rand.chance(0.5)) plan.push('shop', 'stable');
      for (let k = 0; k < rand.int(16, 24); k++) plan.push('house');
    }
    const sq = site.type === 'town' ? 12 : site.type === 'village' ? 7 : 0;
    for (const kind of plan) {
      const rec = yield* placeAlongStreetsGen(kind, maxR, sq + 2);
      if (rec) {
        if (kind === 'smithy') insideSlot(rec, 'smith');
        else if (kind === 'inn') insideSlot(rec, 'innkeeper');
        else if (kind === 'chapel') insideSlot(rec, 'priest');
        else if (kind === 'shop') insideSlot(rec, 'merchant');
        else if (kind === 'manor') insideSlot(rec, 'lord');
        else if (kind === 'house' || kind === 'cottage') roles.push({ role: rand.chance(0.25) ? 'farmer' : 'villager', x: rec.doorOut.x, z: rec.doorOut.z, face: rec.rot, home: rec });
      }
      yield;
    }
    // village heart: well, market stalls, notice board, lamps
    if (site.type !== 'hamlet') {
      prop.well(main, 0, groundY(0, 0), 0, rand, snow);
      colliders.push({ x: 0, z: 0, r: 1.3, h: 2.4, cam: false });
      const stalls = site.type === 'town' ? rand.int(4, 7) : rand.int(1, 3);
      for (let k = 0; k < stalls; k++) {
        const a = (k / stalls) * Math.PI * 2 + rand.range(-0.2, 0.2) + site.angle;
        const rr = (sq || 6) * rand.range(0.55, 0.8);
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        const face = Math.atan2(-x, -z);
        prop.stall(main, x, groundY(x, z), z, face, rand);
        colliders.push({ x, z, r: 1.3, h: 2.4, cam: false });
        if (k < 3) roles.push({ role: 'merchant', x: x - Math.sin(face) * 1.2, z: z - Math.cos(face) * 1.2, face });
      }
    }
    // lamp posts along streets
    for (const st of streets) {
      const len = Math.hypot(st.bx - st.ax, st.bz - st.az);
      const n = Math.floor(len / 14);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const len2 = len || 1;
        const nx = -(st.bz - st.az) / len2;
        const nz = (st.bx - st.ax) / len2;
        const x = st.ax + (st.bx - st.ax) * t - ox + nx * (st.width / 2 + 0.6) * (k % 2 ? 1 : -1);
        const z = st.az + (st.bz - st.az) * t - oz + nz * (st.width / 2 + 0.6) * (k % 2 ? 1 : -1);
        if (foot.some((f) => Math.hypot(f.x - x, f.z - z) < f.r)) continue;
        prop.lamp(main, x, groundY(x, z), z, rand);
        colliders.push({ x, z, r: 0.25, h: 3.1, cam: false });
      }
    }
    yield;
    // farms at the edge: fenced plots with crops, haystacks, carts
    const farms = site.type === 'town' ? 0 : site.type === 'village' ? rand.int(2, 4) : rand.int(2, 3);
    for (let k = 0; k < farms; k++) {
      for (let t = 0; t < 20; t++) {
        const a = rand() * Math.PI * 2;
        const rr = R * rand.range(0.6, 1.05);
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        const pw = rand.range(8, 14);
        const pd = rand.range(6, 10);
        const rot = rand() * Math.PI;
        if (!fits(x, z, pw, pd, rot, R * 1.25)) continue;
        prop.farm(main, x, groundY(x, z), z, pw, pd, rot, rand, snow, colliders);
        foot.push({ x, z, r: Math.hypot(pw, pd) / 2 });
        break;
      }
      yield;
    }
    for (let k = 0; k < rand.int(1, 4); k++) {
      const x = rand.range(-R * 0.6, R * 0.6);
      const z = rand.range(-R * 0.6, R * 0.6);
      if (foot.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + 1.5)) continue;
      if (streets.some((st) => distToSeg(x, z, st, ox, oz) < st.width / 2 + 1)) continue;
      if (rand.chance(0.5)) prop.haystack(main, x, groundY(x, z), z, rand);
      else prop.cart(main, x, groundY(x, z), z, rand.range(0, Math.PI * 2), rand);
      colliders.push({ x, z, r: 1.2, h: 1.6, cam: false });
    }
    // town wall
    if (walled) {
      const n = rand.int(8, 11);
      const wr = R * 0.93;
      const pts = Array.from({ length: n }, (_, i) => {
        const a = site.angle + ((i + 0.5) / n) * Math.PI * 2 + rand.range(-0.08, 0.08);
        const rr = wr * rand.range(0.95, 1.04);
        return { x: Math.cos(a) * rr, z: Math.sin(a) * rr };
      });
      // gates where streets leave the wall
      const gates: number[] = [];
      for (const st of streets) {
        for (const end of [{ x: st.ax - ox, z: st.az - oz }, { x: st.bx - ox, z: st.bz - oz }]) {
          if (Math.hypot(end.x, end.z) < wr * 0.85) continue;
          let bi = 0;
          let bd = Infinity;
          for (let i = 0; i < n; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % n];
            const dd = Math.hypot((a.x + b.x) / 2 - end.x, (a.z + b.z) / 2 - end.z);
            if (dd < bd) {
              bd = dd;
              bi = i;
            }
          }
          if (!gates.includes(bi)) gates.push(bi);
        }
      }
      const palisade = wealth < 0.72;
      yield;
      buildWallRing(main, { points: pts, height: palisade ? 4.2 : 6.5, thickness: palisade ? 0.5 : 1.8, palisade, gates, roofMat: palisade ? 'shingle' : 'slate', banner, snow, groundY }, rand, colliders);
      for (const gi of gates.slice(0, 2)) {
        const a = pts[gi];
        const b = pts[(gi + 1) % n];
        const mx = (a.x + b.x) / 2;
        const mz = (a.z + b.z) / 2;
        roles.push({ role: 'guard', x: mx * 0.94 + (b.x - a.x) * 0.06, z: mz * 0.94 + (b.z - a.z) * 0.06, face: Math.atan2(mx, mz) });
      }
    }
    yield;
  }

  // ------------------------------------------------------------- finalize
  // merge the settlement's static geometry in bounded slices so no single frame stalls
  main.frame.identity();
  const mats = Array.from(main.parts.keys());
  const SLICE_LIMIT = 220;
  for (const mk of mats) {
    const geos = main.parts.get(mk)!;
    for (let offset = 0; offset < geos.length; offset += SLICE_LIMIT) {
      const sub = new GeoBatch();
      sub.parts.set(mk, geos.slice(offset, offset + SLICE_LIMIT));
      const g = sub.build(materials);
      g.children.forEach((c) => group.add(c));
      yield;
    }
  }
  main.parts.clear();

  // walking network: sampled street points + doors
  const waypoints: { x: number; z: number }[] = [];
  for (const st of streets) {
    const len = Math.hypot(st.bx - st.ax, st.bz - st.az);
    const n = Math.max(2, Math.floor(len / 6));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = st.ax + (st.bx - st.ax) * t - ox;
      const z = st.az + (st.bz - st.az) * t - oz;
      if (Math.hypot(x, z) < R * 0.98) waypoints.push({ x, z });
    }
  }

  npcSlots.push(...roles);
  return { site, style, snow, banner, wealth, buildings, colliders, npcSlots, waypoints, group };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const prop = {
  well(b: GeoBatch, x: number, y: number, z: number, rand: Rand, snow: boolean) {
    b.frame.identity();
    const stone = tint(0x9a958c, rand, 0.08);
    const wood = tint(0x5a4030, rand, 0.1);
    b.cyl('stone', 1.0, 0.9, x, y + 0.45, z, stone, true);
    b.cyl('ember', 0.82, 0.02, x, y + 0.88, z, new THREE.Color(0.05, 0.08, 0.12), true);
    for (const s of [-1, 1]) b.box('darkwood', 0.14, 2.2, 0.14, x + s * 0.9, y + 1.1, z, wood);
    b.box('darkwood', 2.0, 0.12, 0.12, x, y + 2.1, z, wood);
    b.box(snow ? 'snow' : 'shingle', 2.4, 0.08, 1.0, x, y + 2.45, z + 0.42, snow ? 0xffffff : tint(0xa08060, rand), 0.55);
    b.box(snow ? 'snow' : 'shingle', 2.4, 0.08, 1.0, x, y + 2.45, z - 0.42, snow ? 0xffffff : tint(0xa08060, rand), -0.55);
    b.cyl('wood', 0.16, 0.25, x + 0.3, y + 1.4, z, wood, true);
  },
  stall(b: GeoBatch, x: number, y: number, z: number, face: number, rand: Rand) {
    b.frame.makeRotationY(face).setPosition(x, y, z);
    const wood = tint(0x6a4a30, rand, 0.12);
    const cloth = tint(rand.pick(CLOTH_COLORS), rand, 0.1);
    for (const [px, pz] of [[-1.2, -0.7], [1.2, -0.7], [-1.2, 0.7], [1.2, 0.7]]) b.box('darkwood', 0.1, pz > 0 ? 2.2 : 2.6, 0.1, px, (pz > 0 ? 2.2 : 2.6) / 2, pz, wood);
    b.box('wood', 2.5, 0.9, 1.0, 0, 0.45, 0.25, wood);
    b.box('cloth', 2.8, 0.04, 1.8, 0, 2.45, 0, cloth, -0.25);
    for (let k = -1; k <= 1; k += 0.5) b.box('cloth', 0.24, 0.3, 0.02, k, 2.15, 0.92, k % 1 === 0 ? cloth : new THREE.Color(0.95, 0.92, 0.85));
    const goods = rand.pick([0xc84030, 0xe0a030, 0x6a9a3a, 0x8a5a3a, 0xd8d0b0]);
    for (let k = 0; k < 6; k++) b.sphere('foliage', rand.range(0.09, 0.14), rand.range(-1.0, 1.0), 0.95, rand.range(0.0, 0.6), tint(goods, rand, 0.15));
    b.box('wood', 0.5, 0.4, 0.4, rand.range(-0.8, 0.8), 0.2, -1.0, wood);
  },
  lamp(b: GeoBatch, x: number, y: number, z: number, rand: Rand) {
    b.frame.identity();
    const wood = tint(0x3a2a1c, rand, 0.1);
    b.box('darkwood', 0.14, 3.2, 0.14, x, y + 1.6, z, wood);
    b.box('darkwood', 0.6, 0.08, 0.08, x + 0.25, y + 3.1, z, wood);
    b.box('metal', 0.22, 0.32, 0.22, x + 0.5, y + 2.85, z, 0xffffff);
    b.box('ember', 0.12, 0.2, 0.12, x + 0.5, y + 2.85, z, new THREE.Color(1, 0.9, 0.6));
  },
  dummy(b: GeoBatch, x: number, y: number, z: number, rand: Rand) {
    b.frame.identity();
    b.box('darkwood', 0.12, 1.9, 0.12, x, y + 0.95, z, tint(0x4a3424, rand));
    b.box('darkwood', 1.0, 0.1, 0.1, x, y + 1.5, z, tint(0x4a3424, rand));
    b.cyl('straw', 0.28, 0.75, x, y + 1.2, z, tint(0xd8c080, rand), true);
    b.sphere('straw', 0.2, x, y + 1.75, z, tint(0xd8c080, rand));
  },
  haystack(b: GeoBatch, x: number, y: number, z: number, rand: Rand) {
    b.frame.identity();
    const r = rand.range(1.0, 1.5);
    b.cyl('straw', r, 1.0, x, y + 0.5, z, tint(0xd8b870, rand), true);
    b.cone('straw', r * 1.05, r * 1.4, x, y + 1.0 + r * 0.7, z, tint(0xd0b068, rand), 16);
  },
  cart(b: GeoBatch, x: number, y: number, z: number, rot: number, rand: Rand) {
    b.frame.makeRotationY(rot).setPosition(x, y, z);
    const wood = tint(0x7a5a3a, rand, 0.15);
    b.box('wood', 1.4, 0.5, 2.2, 0, 0.85, 0, wood);
    for (const s of [-1, 1]) {
      b.cyl('wood', 0.5, 0.1, s * 0.8, 0.5, 0, tint(0x5a4030, rand), true, 0, 0, Math.PI / 2);
      b.box('darkwood', 0.08, 0.08, 1.8, s * 0.45, 0.7, 1.9, wood, -0.15);
    }
    if (rand.chance(0.6)) for (let k = 0; k < 3; k++) b.box('straw', 1.1, 0.4, 0.6, 0, 1.25 + (k % 2) * 0.1, -0.7 + k * 0.7, tint(0xd8c080, rand));
    else for (let k = 0; k < 3; k++) b.cyl('wood', 0.25, 0.6, rand.range(-0.4, 0.4), 1.4, -0.6 + k * 0.6, wood, true);
  },
  farm(b: GeoBatch, x: number, y: number, z: number, w: number, d: number, rot: number, rand: Rand, snow: boolean, colliders: Collider2[]) {
    b.frame.makeRotationY(rot).setPosition(x, y, z);
    const wood = tint(0x6a5038, rand, 0.15);
    const crop = snow ? 0xe8eef4 : rand.pick([0x5a8a3a, 0xc8a840, 0x7a9a3a, 0x8a6a3a]);
    // fence
    const post = (px: number, pz: number) => b.box('darkwood', 0.12, 1.1, 0.12, px, 0.55, pz, wood);
    for (let px = -w / 2; px <= w / 2 + 0.01; px += w / Math.ceil(w / 2.2)) {
      post(px, -d / 2);
      post(px, d / 2);
    }
    for (let pz = -d / 2; pz <= d / 2 + 0.01; pz += d / Math.ceil(d / 2.2)) {
      post(-w / 2, pz);
      post(w / 2, pz);
    }
    for (const yy of [0.45, 0.85]) {
      b.box('wood', w, 0.08, 0.06, 0, yy, -d / 2, wood);
      b.box('wood', w * 0.4, 0.08, 0.06, -w * 0.3, yy, d / 2, wood);
      b.box('wood', w * 0.4, 0.08, 0.06, w * 0.3, yy, d / 2, wood);
      b.box('wood', 0.06, 0.08, d, -w / 2, yy, 0, wood);
      b.box('wood', 0.06, 0.08, d, w / 2, yy, 0, wood);
    }
    // crop rows
    const rows = Math.floor((d - 1) / 0.9);
    for (let r = 0; r < rows; r++) {
      const rz = -d / 2 + 0.8 + r * 0.9;
      b.box('wood', w - 0.8, 0.12, 0.4, 0, 0.06, rz, new THREE.Color(0.32, 0.24, 0.16));
      if (!snow) for (let k = 0; k < Math.floor(w / 0.6); k++) b.sphere('foliage', rand.range(0.14, 0.24), -w / 2 + 0.6 + k * 0.6, 0.25, rz, tint(crop, rand, 0.15), rand.range(0.8, 1.6));
    }
    const scarecrow = rand.chance(0.5);
    // fence colliders (rough, low so they never yank camera)
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const add = (lx: number, lz: number) => colliders.push({ x: x + lx * c + lz * s, z: z - lx * s + lz * c, r: 0.42, h: 1.1, cam: false });
    for (let px = -w / 2; px <= w / 2; px += 1.05) {
      add(px, -d / 2);
      if (Math.abs(px) > w * 0.14) add(px, d / 2);
    }
    for (let pz = -d / 2; pz <= d / 2; pz += 1.05) {
      add(-w / 2, pz);
      add(w / 2, pz);
    }
    if (scarecrow) prop.dummy(b, x, y, z, rand);
  },
};
