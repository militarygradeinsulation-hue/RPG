import * as THREE from 'three';
import {
  CLOTH_COLORS,
  DOOR_COLORS,
  GeoBatch,
  MatKey,
  PLASTER_COLORS,
  Rand,
  RegionStyle,
  SHUTTER_COLORS,
  tint,
} from './BuildingKit';

/**
 * Procedural buildings. Every building is generated from its own parameters
 * (footprint, floors, wall build-up, openings, roof form, materials, colors, wear,
 * interior layout), so no two are alike.
 */

export type BuildingKind =
  | 'house'
  | 'cottage'
  | 'inn'
  | 'smithy'
  | 'chapel'
  | 'barn'
  | 'shop'
  | 'manor'
  | 'keep'
  | 'barracks'
  | 'stable';

export interface Collider2 {
  x: number;
  z: number;
  r: number;
}

export interface BuildingRecord {
  kind: BuildingKind;
  /** Settlement-local placement. */
  x: number;
  y: number;
  z: number;
  rot: number;
  w: number;
  d: number;
  floors: number;
  /** Roof + upper floors; hidden when the player is inside so the interior shows. */
  upper: GeoBatch;
  upperGroup?: THREE.Group;
  colliders: Collider2[];
  /** Point just outside the door (settlement-local). */
  doorOut: { x: number; z: number };
  /** Point inside near the hearth/counter, for NPC routines and interior light. */
  inside: { x: number; y: number; z: number };
  hearth?: { x: number; y: number; z: number };
  name?: string;
}

export interface HouseSpec {
  kind: BuildingKind;
  x: number;
  y: number;
  z: number;
  rot: number;
  w: number;
  d: number;
  floors: number;
  style: RegionStyle;
  roof: 'gable' | 'steep' | 'hip' | 'flat';
  roofMat: MatKey;
  wallColor: number;
  trim: number;
  shutter: number;
  door: number;
  snow: boolean;
  wealth: number; // 0..1
  age: number; // 0..1 (weathering)
  banner?: number;
}

const WALL_T = 0.26;

interface Opening {
  u: number;
  w: number;
  v0: number;
  v1: number;
  door?: boolean;
}

/** Builds a local transform frame for a building and returns a point mapper. */
function frameFor(spec: { x: number; y: number; z: number; rot: number }) {
  const m = new THREE.Matrix4().makeRotationY(spec.rot).setPosition(spec.x, spec.y, spec.z);
  const c = Math.cos(spec.rot);
  const s = Math.sin(spec.rot);
  const toSettle = (lx: number, lz: number) => ({ x: spec.x + lx * c + lz * s, z: spec.z - lx * s + lz * c });
  return { m, toSettle };
}

/**
 * Wall with rectangular openings. `place(u, v, du, dv)` maps wall-plane rectangles
 * (u along the wall, v up) to boxes.
 */
function wallWithOpenings(
  len: number,
  H: number,
  openings: Opening[],
  place: (u: number, v: number, du: number, dv: number) => void
) {
  const ops = [...openings].sort((a, b) => a.u - b.u);
  let cursor = -len / 2;
  for (const o of ops) {
    const a = o.u - o.w / 2;
    const b = o.u + o.w / 2;
    if (a > cursor + 0.01) place((cursor + a) / 2, H / 2, a - cursor, H);
    if (o.v0 > 0.01) place(o.u, o.v0 / 2, o.w, o.v0);
    if (o.v1 < H - 0.01) place(o.u, (o.v1 + H) / 2, o.w, H - o.v1);
    cursor = b;
  }
  if (cursor < len / 2 - 0.01) place((cursor + len / 2) / 2, H / 2, len / 2 - cursor, H);
}

/** Places openings along a wall at a rhythm, avoiding the door. */
function layoutWindows(len: number, v0: number, v1: number, ww: number, rand: Rand, avoid?: Opening, density = 0.8): Opening[] {
  const out: Opening[] = [];
  const slots = Math.max(1, Math.floor((len - 1.2) / 2.3));
  const step = (len - 1.2) / slots;
  for (let i = 0; i < slots; i++) {
    const u = -len / 2 + 0.6 + step * (i + 0.5) + (rand() - 0.5) * 0.25;
    if (avoid && Math.abs(u - avoid.u) < avoid.w / 2 + ww / 2 + 0.35) continue;
    if (rand() > density) continue;
    out.push({ u, w: ww, v0, v1 });
  }
  return out;
}

export function buildHouse(main: GeoBatch, spec: HouseSpec, rand: Rand): BuildingRecord {
  const upper = new GeoBatch();
  const { m, toSettle } = frameFor(spec);
  main.frame.copy(m);
  upper.frame.copy(m);

  const { w, d, floors, style, kind } = spec;
  const H = kind === 'chapel' ? 5.4 : kind === 'keep' ? 4.2 : kind === 'barn' || kind === 'stable' ? 4.6 : rand.range(2.8, 3.25);
  const fh = style === 'stone' || kind === 'keep' ? rand.range(0.35, 0.7) : rand.range(0.25, 0.55);
  const grime = 1 - spec.age * 0.18;
  const wallC = tint(spec.wallColor, rand, 0.05).multiplyScalar(grime);
  const stoneC = tint(style === 'ember' ? 0x9a8a80 : 0xd4d0c6, rand, 0.1).multiplyScalar(grime);
  const timberC = tint(0x6a4c34, rand, 0.12).multiplyScalar(grime);
  const woodC = tint(0xc09a72, rand, 0.12);
  const colliders: Collider2[] = [];

  // --- foundation & floor ---
  main.box('stone', w + 0.35, fh + 0.9, d + 0.35, 0, fh / 2 - 0.45, 0, stoneC);
  main.box('wood', w - WALL_T * 2, 0.06, d - WALL_T * 2, 0, fh + 0.03, 0, tint(0xb08a62, rand, 0.1));
  // door step
  const doorU = kind === 'chapel' || kind === 'keep' || kind === 'barn' ? 0 : rand.range(-w / 2 + 1.3, w / 2 - 1.3);
  main.box('stone', 1.6, 0.22, 0.7, doorU, fh - 0.1, d / 2 + 0.3, stoneC);

  const openSided = kind === 'smithy' || kind === 'stable';
  const doorW = kind === 'barn' ? 2.8 : kind === 'keep' || kind === 'chapel' ? 1.8 : 1.15;
  const doorH = kind === 'barn' ? 3.4 : kind === 'keep' ? 3.0 : kind === 'chapel' ? 3.2 : 2.15;
  const door: Opening = { u: doorU, w: doorW, v0: 0, v1: doorH, door: true };

  const wallMatFor = (floor: number): MatKey => {
    if (kind === 'barn' || kind === 'stable') return 'wood';
    if (style === 'stone' || kind === 'keep' || kind === 'chapel') return 'stone';
    if (style === 'ember') return floor === 0 ? 'stone' : rand.chance(0.5) ? 'brick' : 'stone';
    if (style === 'log') return 'wood';
    // timber: masonry ground floor on wealthier houses
    if (floor === 0 && (spec.wealth > 0.55 || kind === 'inn' || kind === 'manor')) return rand.chance(0.6) ? 'stone' : 'brick';
    return 'plaster';
  };
  const colorFor = (mat: MatKey) => (mat === 'stone' ? stoneC : mat === 'brick' ? tint(0xd8b8a8, rand, 0.08) : mat === 'wood' ? (style === 'log' ? tint(0x7a5a3a, rand, 0.15) : woodC) : wallC);

  let topY = fh;
  let lastD = d;
  let lastMat: MatKey = 'plaster';
  for (let f = 0; f < floors; f++) {
    const batch = f === 0 ? main : upper;
    const y0 = fh + f * H;
    const jetty = style === 'timber' && f > 0 && kind !== 'chapel' ? 0.3 * f : 0;
    const dd = d + jetty * 2;
    const mat = wallMatFor(f);
    const col = colorFor(mat);
    lastMat = mat;
    lastD = dd;
    const winW = kind === 'chapel' ? 1.0 : kind === 'keep' ? 0.7 : rand.range(0.75, 1.0);
    const winV0 = kind === 'chapel' ? 1.6 : 0.95;
    const winV1 = kind === 'chapel' ? 4.4 : kind === 'keep' ? 2.3 : Math.min(H - 0.45, winV0 + rand.range(1.0, 1.25));
    const density = kind === 'barn' ? 0.15 : kind === 'keep' ? 0.5 : 0.55 + spec.wealth * 0.4;

    const frontOps = f === 0 ? [door, ...layoutWindows(w, winV0, winV1, winW, rand, door, density)] : layoutWindows(w, winV0, winV1, winW, rand, undefined, density);
    const backOps = layoutWindows(w, winV0, winV1, winW, rand, undefined, density * 0.7);
    const sideOpsL = layoutWindows(dd, winV0, winV1, winW, rand, undefined, density * 0.8);
    const sideOpsR = layoutWindows(dd, winV0, winV1, winW, rand, undefined, density * 0.8);

    // walls (front +z, back -z, left -x, right +x)
    if (!(openSided && f === 0)) {
      wallWithOpenings(w, H, frontOps, (u, v, du, dv) => batch.box(mat, du, dv, WALL_T, u, y0 + v, dd / 2 - WALL_T / 2, col));
    }
    wallWithOpenings(w, H, backOps, (u, v, du, dv) => batch.box(mat, du, dv, WALL_T, -u, y0 + v, -dd / 2 + WALL_T / 2, col));
    if (!(kind === 'stable' && f === 0)) {
      wallWithOpenings(dd, H, sideOpsL, (u, v, du, dv) => batch.box(mat, WALL_T, dv, du, -w / 2 + WALL_T / 2, y0 + v, u, col));
    }
    wallWithOpenings(dd, H, sideOpsR, (u, v, du, dv) => batch.box(mat, WALL_T, dv, du, w / 2 - WALL_T / 2, y0 + v, -u, col));

    if (openSided && f === 0) {
      // open front on posts
      for (const px of [-w / 2 + 0.2, -w / 6, w / 6, w / 2 - 0.2]) batch.box('wood', 0.26, H, 0.26, px, y0 + H / 2, dd / 2 - 0.15, timberC);
      batch.box('darkwood', w, 0.3, 0.3, 0, y0 + H - 0.15, dd / 2 - 0.15, timberC);
    }

    // window dressing and timber framing
    const dress = (ops: Opening[], face: 'f' | 'b' | 'l' | 'r', len: number) => {
      const P = (u: number, v: number, out: number) => {
        // returns local x, y, z on the outer face (+out pushes outward)
        if (face === 'f') return [u, y0 + v, dd / 2 + out] as const;
        if (face === 'b') return [-u, y0 + v, -dd / 2 - out] as const;
        if (face === 'l') return [-w / 2 - out, y0 + v, u] as const;
        return [w / 2 + out, y0 + v, -u] as const;
      };
      const ry = face === 'f' ? 0 : face === 'b' ? Math.PI : face === 'l' ? -Math.PI / 2 : Math.PI / 2;
      for (const o of ops) {
        if (o.door) {
          // door frame, open door leaf, hinges
          const [fx, fy, fz] = P(o.u, o.v1 + 0.1, 0.02);
          batch.box('darkwood', o.w + 0.3, 0.2, WALL_T + 0.08, fx, fy, fz - (face === 'f' ? WALL_T / 2 : 0), timberC, 0, ry);
          // door leaf hinged at the inner face, swung inward
          const swing = rand.range(1.0, 1.55);
          const hingeU = o.u - o.w / 2 + 0.05;
          const leafW = o.w - 0.1;
          const du = Math.cos(swing);
          const dout = -Math.sin(swing);
          const [lx, ly, lz] = P(hingeU + du * leafW / 2, (o.v1 - 0.05) / 2, -WALL_T + dout * leafW / 2);
          batch.box(kind === 'barn' ? 'wood' : 'darkwood', leafW, o.v1 - 0.05, 0.07, lx, ly, lz, tint(spec.door, rand, 0.08), 0, ry + Math.atan2(-dout, du));
          continue;
        }
        const [cx, cy, cz] = P(o.u, (o.v0 + o.v1) / 2, 0);
        const hgt = o.v1 - o.v0;
        // glass + mullions
        const [gx, gy, gz] = P(o.u, (o.v0 + o.v1) / 2, -WALL_T / 2);
        batch.box('glass', o.w, hgt, 0.04, gx, gy, gz, kind === 'chapel' ? tint(rand.pick([0x6a3aa0, 0x2a5ab0, 0xb03a2e, 0x3a8a4a]), rand, 0.1) : new THREE.Color(1, 1, 1), 0, ry);
        batch.box('darkwood', 0.05, hgt, 0.06, gx, gy, gz, timberC, 0, ry);
        batch.box('darkwood', o.w, 0.05, 0.06, gx, gy, gz, timberC, 0, ry);
        // frame
        const [tx, ty, tz] = P(o.u, o.v1 + 0.06, 0.04);
        batch.box('darkwood', o.w + 0.22, 0.12, 0.1, tx, ty, tz, timberC, 0, ry);
        const [sx, sy, sz] = P(o.u, o.v0 - 0.05, 0.08);
        batch.box(mat === 'plaster' ? 'darkwood' : 'stone', o.w + 0.3, 0.1, 0.22, sx, sy, sz, mat === 'plaster' ? timberC : stoneC, 0, ry);
        // shutters (open at varied angles, some closed, some missing on old houses)
        if (kind !== 'chapel' && kind !== 'keep' && rand.chance(0.8)) {
          const sc = tint(spec.shutter, rand, 0.1).multiplyScalar(1 - spec.age * 0.25);
          for (const side of [-1, 1]) {
            if (spec.age > 0.7 && rand.chance(0.3)) continue; // missing shutter on old houses
            // phi = 0 closed over the window, ~pi lies open flat against the wall
            const phi = rand.chance(0.15) ? 0.02 : rand.range(2.0, 3.0);
            const half = o.w / 2;
            const du = -side * Math.cos(phi);
            const dout = Math.sin(phi);
            const hu = o.u + side * (o.w / 2 + 0.02);
            const [ox, oy, oz] = P(hu + du * half / 2, (o.v0 + o.v1) / 2, 0.05 + dout * half / 2);
            batch.box('wood', half, hgt, 0.05, ox, oy, oz, sc, 0, ry + Math.atan2(-dout, du));
          }
        }
        // flower boxes on cottages and houses
        if ((kind === 'house' || kind === 'cottage' || kind === 'inn') && f === 0 && rand.chance(0.35)) {
          const [bx, by, bz] = P(o.u, o.v0 - 0.12, 0.2);
          batch.box('wood', o.w + 0.1, 0.18, 0.2, bx, by, bz, timberC, 0, ry);
          for (let k = 0; k < 4; k++) {
            const [qx, qy, qz] = P(o.u - o.w / 2 + 0.15 + k * (o.w - 0.3) / 3, o.v0 + 0.02, 0.22);
            batch.sphere('foliage', 0.1, qx, qy, qz, k % 2 ? tint(rand.pick([0xd04040, 0xe8c040, 0xb050c0, 0xf0f0f0]), rand) : tint(0x3a6a2a, rand), 0.8);
          }
        }
        void cx;
        void cy;
        void cz;
      }
      // timber framing on plaster walls
      if (mat === 'plaster') {
        const off = 0.025;
        const beams: [number, number][] = [[0.08, 0.16], [H - 0.08, 0.16]];
        for (const [v, t] of beams) {
          const [bx, by, bz] = P(0, v, off);
          batch.box('darkwood', face === 'f' || face === 'b' ? len + 0.1 : 0.14, t, face === 'f' || face === 'b' ? 0.14 : len + 0.1, bx, by, bz, timberC);
        }
        const posts: number[] = [-len / 2 + 0.07, len / 2 - 0.07];
        let u = -len / 2 + 1.5;
        while (u < len / 2 - 1.0) {
          if (!ops.some((o) => Math.abs(o.u - u) < o.w / 2 + 0.12)) posts.push(u);
          u += rand.range(1.2, 1.7);
        }
        posts.forEach((pu) => {
          const [px, py, pz] = P(pu, H / 2, off);
          batch.box('darkwood', face === 'f' || face === 'b' ? 0.15 : 0.14, H, face === 'f' || face === 'b' ? 0.14 : 0.15, px, py, pz, timberC);
        });
        // diagonal braces in some open panels
        posts.sort((a, b) => a - b);
        for (let i = 0; i < posts.length - 1; i++) {
          const a = posts[i];
          const b = posts[i + 1];
          if (b - a < 0.8 || ops.some((o) => o.u > a && o.u < b)) continue;
          if (!rand.chance(0.55)) continue;
          const mid = (a + b) / 2;
          const span = b - a;
          const ang = Math.atan2(H - 0.3, span) * (rand.chance(0.5) ? 1 : -1);
          const len2 = Math.hypot(span, H - 0.3);
          const [qx, qy, qz] = P(mid, H / 2, off);
          const ryy = ry;
          batch.box('darkwood', len2, 0.13, 0.12, qx, qy, qz, timberC, 0, ryy, ang);
        }
      }
    };
    if (!(openSided && f === 0)) dress(frontOps, 'f', w);
    dress(backOps, 'b', w);
    dress(sideOpsL, 'l', dd);
    dress(sideOpsR, 'r', dd);

    // floor/ceiling slab between storeys
    if (f > 0) upper.box('wood', w - 0.1, 0.18, dd - 0.1, 0, y0 + 0.02, 0, tint(0x6a4a2a, rand, 0.1));
    if (f > 0 && jetty > 0) {
      // joist ends under the overhang
      for (let jx = -w / 2 + 0.3; jx < w / 2; jx += 0.6) {
        upper.box('darkwood', 0.12, 0.14, jetty + 0.2, jx, y0 - 0.06, dd / 2 - jetty / 2, timberC);
        upper.box('darkwood', 0.12, 0.14, jetty + 0.2, jx, y0 - 0.06, -dd / 2 + jetty / 2, timberC);
      }
    }
    topY = y0 + H;
  }

  // --- roof ---
  buildRoof(upper, spec, rand, w, lastD, topY, lastMat, colorFor(lastMat), timberC);

  // --- chimney with fireplace inside ---
  let hearth: BuildingRecord['hearth'];
  if (kind !== 'barn' && kind !== 'stable' && kind !== 'chapel' && spec.roof !== 'flat') {
    const side = rand.chance(0.5) ? 1 : -1;
    const cz = rand.range(-d / 4, d / 6);
    const cx = side * (w / 2 - 0.55);
    const chH = topY + (lastD / 2) * Math.tan(spec.roof === 'steep' ? 0.95 : 0.62) + 0.9;
    main.box('stone', 1.1, H, 1.0, cx, fh + H / 2, cz, stoneC);
    upper.box('stone', 0.75, chH - fh - H, 0.75, cx, fh + H + (chH - fh - H) / 2, cz, stoneC);
    upper.box('stone', 0.95, 0.15, 0.95, cx, chH, cz, stoneC);
    // fireplace opening facing inward
    main.box('ember', 0.5, 0.25, 0.6, cx - side * 0.36, fh + 0.2, cz, new THREE.Color(1, 1, 1));
    main.box('darkwood', 0.12, 0.12, 0.7, cx - side * 0.3, fh + 0.32, cz, timberC, 0, 0, 0.3);
    main.box('stone', 0.25, 0.25, 1.2, cx - side * 0.62, fh + 1.2, cz, stoneC);
    hearth = { ...((): { x: number; z: number } => toSettle(cx - side * 1.0, cz))(), y: spec.y + fh + 0.6 };
  }

  // --- interior furnishing ---
  furnish(main, spec, rand, w, d, fh, H, timberC, colliders, toSettle);

  // --- outdoor details ---
  if (kind === 'inn' || kind === 'shop' || kind === 'smithy') {
    // hanging sign on a bracket
    const sx = doorU + (doorU > 0 ? -1.2 : 1.2);
    main.box('darkwood', 0.08, 0.08, 0.9, sx, fh + 2.7, d / 2 + 0.45, timberC);
    main.box('wood', 0.75, 0.55, 0.06, sx, fh + 2.3, d / 2 + 0.8, tint(spec.banner ?? rand.pick(CLOTH_COLORS), rand), 0, 0);
    main.box('metal', 0.04, 0.2, 0.04, sx - 0.3, fh + 2.62, d / 2 + 0.8, 0xffffff);
    main.box('metal', 0.04, 0.2, 0.04, sx + 0.3, fh + 2.62, d / 2 + 0.8, 0xffffff);
  }
  if (rand.chance(0.45) && kind !== 'keep') {
    // lantern by the door
    const lx = doorU + doorW / 2 + 0.35;
    main.box('metal', 0.18, 0.28, 0.18, lx, fh + 2.3, d / 2 + 0.2, 0xffffff);
    main.box('ember', 0.1, 0.16, 0.1, lx, fh + 2.3, d / 2 + 0.2, new THREE.Color(1, 0.9, 0.6));
  }
  if ((kind === 'house' || kind === 'cottage') && rand.chance(0.5)) {
    // woodpile against a side wall
    const side = rand.chance(0.5) ? 1 : -1;
    for (let i = 0; i < 9; i++) {
      main.cyl('wood', 0.09, 0.9, side * (w / 2 + 0.3), fh + 0.1 + Math.floor(i / 3) * 0.17, -d / 4 + (i % 3) * 0.19, tint(0x8a6a4a, rand, 0.2), false, Math.PI / 2, 0, 0);
    }
  }
  if (spec.banner !== undefined && (kind === 'keep' || kind === 'manor' || kind === 'barracks')) {
    for (const bx of [-w / 2 + 1, w / 2 - 1]) {
      main.box('cloth', 0.9, 2.2, 0.04, bx, fh + H * 0.6, d / 2 + 0.06, tint(spec.banner, rand, 0.05));
      main.box('darkwood', 1.0, 0.06, 0.06, bx, fh + H * 0.6 + 1.12, d / 2 + 0.08, timberC);
    }
  }

  // --- colliders: perimeter walls with a gap at the door ---
  const addWallColliders = (ax: number, az: number, bx: number, bz: number, gapU?: number, gapW = 0) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(len / 0.5);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const u = -len / 2 + t * len;
      if (gapU !== undefined && Math.abs(u - gapU) < gapW / 2 + 0.15) continue;
      const lx = ax + (bx - ax) * t;
      const lz = az + (bz - az) * t;
      const p = toSettle(lx, lz);
      colliders.push({ x: p.x, z: p.z, r: 0.32 });
    }
  };
  const hw = w / 2 - 0.12;
  const hd = d / 2 - 0.12;
  if (!openSided) addWallColliders(-hw, hd, hw, hd, doorU, doorW);
  else {
    for (const px of [-w / 2 + 0.2, -w / 6, w / 6, w / 2 - 0.2]) {
      const p = toSettle(px, hd);
      colliders.push({ x: p.x, z: p.z, r: 0.3 });
    }
  }
  addWallColliders(-hw, -hd, hw, -hd);
  if (kind !== 'stable') addWallColliders(-hw, -hd, -hw, hd);
  addWallColliders(hw, -hd, hw, hd);

  const dOut = toSettle(doorU, d / 2 + 1.4);
  const ins = toSettle(0, -d / 6);
  return {
    kind,
    x: spec.x,
    y: spec.y,
    z: spec.z,
    rot: spec.rot,
    w,
    d,
    floors,
    upper,
    colliders,
    doorOut: dOut,
    inside: { x: ins.x, y: spec.y + fh, z: ins.z },
    hearth,
  };
}

function buildRoof(b: GeoBatch, spec: HouseSpec, rand: Rand, w: number, d: number, topY: number, wallMat: MatKey, wallC: THREE.Color, timberC: THREE.Color) {
  const oh = spec.roofMat === 'thatch' ? 0.55 : rand.range(0.35, 0.55);
  const roofC = tint(
    spec.roofMat === 'thatch' ? 0xc8b07a : spec.roofMat === 'slate' ? 0x9aa0a8 : spec.roofMat === 'shingle' ? 0xb08a6a : 0xb8b0a8,
    rand,
    0.12
  ).multiplyScalar(1 - spec.age * 0.25);
  const thick = spec.roofMat === 'thatch' ? 0.38 : 0.12;

  if (spec.roof === 'flat') {
    b.box('stone', w + 0.2, 0.3, d + 0.2, 0, topY + 0.15, 0, wallC);
    // crenellated parapet
    const merlon = (x: number, z: number) => b.box('stone', 0.6, 0.75, 0.45, x, topY + 0.65, z, wallC);
    for (let x = -w / 2 + 0.3; x <= w / 2 - 0.3; x += 1.1) {
      merlon(x, d / 2 - 0.2);
      merlon(x, -d / 2 + 0.2);
    }
    for (let z = -d / 2 + 1.2; z <= d / 2 - 1.2; z += 1.1) {
      b.box('stone', 0.45, 0.75, 0.6, w / 2 - 0.2, topY + 0.65, z, wallC);
      b.box('stone', 0.45, 0.75, 0.6, -w / 2 + 0.2, topY + 0.65, z, wallC);
    }
    // corner turrets with conical caps
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const tx = cx * (w / 2 - 0.2);
      const tz = cz * (d / 2 - 0.2);
      b.cyl('stone', 0.9, 2.6, tx, topY + 1.0, tz, wallC, true);
      b.cone(spec.roofMat === 'slate' ? 'slate' : 'shingle', 1.15, 2.2, tx, topY + 3.4, tz, roofC, 16);
    }
    return;
  }

  if (spec.roof === 'hip') {
    const rise = Math.min(w, d) * rand.range(0.32, 0.45);
    b.put(spec.roofMat, new THREE.ConeGeometry(1, 1, 4), 0, topY + rise / 2, 0, (w + oh * 2) / Math.SQRT2, rise, (d + oh * 2) / Math.SQRT2, roofC, 0, Math.PI / 4, 0);
    if (spec.snow) b.put('snow', new THREE.ConeGeometry(1, 1, 4), 0, topY + rise / 2 + 0.1, 0, (w + oh * 2) / Math.SQRT2 * 0.92, rise * 0.95, (d + oh * 2) / Math.SQRT2 * 0.92, 0xffffff, 0, Math.PI / 4, 0);
    return;
  }

  const pitch = spec.roof === 'steep' ? rand.range(0.85, 1.0) : spec.roofMat === 'thatch' ? rand.range(0.72, 0.85) : rand.range(0.5, 0.7);
  const span = d / 2 + oh;
  const rise = (d / 2) * Math.tan(pitch);
  const L = span / Math.cos(pitch);
  const len = w + oh * 2;
  for (const side of [1, -1]) {
    const cz = side * (span / 2) - side * Math.sin(pitch) * 0;
    const cy = topY + rise - (span / 2) * Math.tan(pitch) + thick / 2;
    b.box(spec.roofMat, len, thick, L, 0, cy, cz, roofC, side * pitch);
    if (spec.snow) b.box('snow', len * 0.98, 0.1, L * 0.85, 0, cy + thick / 2 + 0.05, cz - side * L * 0.05, 0xffffff, side * pitch);
  }
  // ridge
  b.box(spec.roofMat === 'thatch' ? 'thatch' : 'darkwood', len, 0.22, 0.3, 0, topY + rise + thick * 0.6, 0, spec.roofMat === 'thatch' ? roofC : timberC);
  // gable ends in the top-floor wall material
  for (const sx of [1, -1]) {
    b.gable(wallMat, d, rise, WALL_T, sx * (w / 2 - WALL_T / 2), topY, 0, wallC, Math.PI / 2);
    if (wallMat === 'plaster') {
      b.box('darkwood', 0.14, rise * 0.95, 0.14, sx * (w / 2 + 0.02), topY + rise / 2, 0, timberC);
      b.box('darkwood', 0.14, 0.14, d * 0.7, sx * (w / 2 + 0.02), topY + rise * 0.35, 0, timberC);
    }
    // bargeboards
    for (const s2 of [1, -1]) b.box('darkwood', 0.08, 0.2, L, sx * (w / 2 + oh - 0.02), topY + rise / 2 + 0.05, s2 * span / 2, timberC, s2 * pitch);
  }
}

function furnish(
  b: GeoBatch,
  spec: HouseSpec,
  rand: Rand,
  w: number,
  d: number,
  fh: number,
  H: number,
  timberC: THREE.Color,
  colliders: Collider2[],
  toSettle: (x: number, z: number) => { x: number; z: number }
) {
  const y = fh;
  const ix = w / 2 - WALL_T - 0.1;
  const iz = d / 2 - WALL_T - 0.1;
  const wood = tint(0x8a6a4a, rand, 0.15);
  const dark = tint(0x5a4030, rand, 0.15);
  const col = (x: number, z: number, r: number) => {
    const p = toSettle(x, z);
    colliders.push({ x: p.x, z: p.z, r });
  };

  const table = (x: number, z: number, len: number, ry = 0) => {
    b.box('wood', len, 0.07, 0.85, x, y + 0.76, z, wood, 0, ry);
    for (const [a, c] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const lx = (a * (len / 2 - 0.08));
      const lz = (c * 0.34);
      b.box('wood', 0.08, 0.74, 0.08, x + lx * Math.cos(ry) + lz * Math.sin(ry), y + 0.37, z - lx * Math.sin(ry) + lz * Math.cos(ry), dark);
    }
    col(x, z, Math.max(0.5, len * 0.35));
  };
  const chair = (x: number, z: number, ry: number) => {
    b.box('wood', 0.45, 0.06, 0.45, x, y + 0.46, z, wood, 0, ry);
    b.box('wood', 0.45, 0.55, 0.06, x - Math.sin(ry) * 0.2, y + 0.75, z - Math.cos(ry) * 0.2, wood, 0, ry);
    for (const [a, c] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box('wood', 0.05, 0.46, 0.05, x + a * 0.18, y + 0.23, z + c * 0.18, dark);
  };
  const bench = (x: number, z: number, len: number, ry = 0) => {
    b.box('wood', len, 0.07, 0.35, x, y + 0.45, z, wood, 0, ry);
    b.box('wood', 0.07, 0.44, 0.3, x - Math.cos(ry) * (len / 2 - 0.15), y + 0.22, z + Math.sin(ry) * (len / 2 - 0.15), dark, 0, ry);
    b.box('wood', 0.07, 0.44, 0.3, x + Math.cos(ry) * (len / 2 - 0.15), y + 0.22, z - Math.sin(ry) * (len / 2 - 0.15), dark, 0, ry);
  };
  const bed = (x: number, z: number, ry: number) => {
    b.box('wood', 1.05, 0.35, 2.05, x, y + 0.18, z, wood, 0, ry);
    b.box('cloth', 0.95, 0.16, 1.9, x, y + 0.42, z, 0xe8e0d0, 0, ry);
    b.box('cloth', 0.98, 0.08, 1.3, x + Math.sin(ry) * 0.3, y + 0.52, z + Math.cos(ry) * 0.3, tint(rand.pick(CLOTH_COLORS), rand, 0.1), 0, ry);
    b.box('cloth', 0.6, 0.12, 0.35, x - Math.sin(ry) * 0.75, y + 0.56, z - Math.cos(ry) * 0.75, 0xf4f0e8, 0, ry);
    b.box('wood', 1.05, 0.8, 0.08, x - Math.sin(ry) * 1.0, y + 0.4, z - Math.cos(ry) * 1.0, dark, 0, ry);
    col(x, z, 0.75);
  };
  const barrel = (x: number, z: number, s = 1) => {
    b.cyl('wood', 0.32 * s, 0.85 * s, x, y + 0.43 * s, z, tint(0x7a5a3a, rand, 0.15), true);
    b.cyl('metal', 0.335 * s, 0.05, x, y + 0.2 * s, z, 0xffffff, true);
    b.cyl('metal', 0.335 * s, 0.05, x, y + 0.68 * s, z, 0xffffff, true);
    col(x, z, 0.35 * s);
  };
  const crate = (x: number, z: number, s = 0.6) => {
    b.box('wood', s, s, s, x, y + s / 2, z, tint(0x9a7a4a, rand, 0.2), 0, rand() * 0.5);
    col(x, z, s * 0.6);
  };
  const shelf = (x: number, z: number, ry: number) => {
    for (let k = 0; k < 4; k++) b.box('wood', 1.4, 0.05, 0.32, x, y + 0.4 + k * 0.45, z, wood, 0, ry);
    for (const s of [-1, 1]) b.box('wood', 0.05, 1.8, 0.32, x + Math.cos(ry) * s * 0.7, y + 0.9, z - Math.sin(ry) * s * 0.7, dark, 0, ry);
    for (let k = 0; k < 7; k++) {
      const u = rand.range(-0.6, 0.6);
      const lvl = rand.int(0, 3);
      b.cyl(rand.chance(0.5) ? 'metal' : 'cloth', 0.06, 0.18, x + Math.cos(ry) * u, y + 0.52 + lvl * 0.45, z - Math.sin(ry) * u, tint(rand.pick([0x8a6a3a, 0x3a5a6a, 0x6a3a3a, 0xe8e0d0]), rand), true);
    }
    col(x, z, 0.45);
  };
  const rug = (x: number, z: number, sw: number, sd: number) => b.box('cloth', sw, 0.02, sd, x, y + 0.075, z, tint(rand.pick(CLOTH_COLORS), rand, 0.15).multiplyScalar(0.8));
  const candle = (x: number, yy: number, z: number) => {
    b.cyl('cloth', 0.03, 0.14, x, yy + 0.07, z, 0xf4ecd8);
    b.sphere('ember', 0.025, x, yy + 0.17, z, new THREE.Color(1, 0.9, 0.6), 1.6);
  };

  switch (spec.kind) {
    case 'inn': {
      // bar counter along the back with kegs, tables with benches
      b.box('darkwood', w * 0.55, 1.05, 0.6, -w * 0.12, y + 0.53, -iz + 1.4, dark);
      b.box('wood', w * 0.55 + 0.1, 0.07, 0.7, -w * 0.12, y + 1.08, -iz + 1.4, wood);
      for (let k = 0; k < 3; k++) barrel(-w * 0.12 - w * 0.2 + k * w * 0.2, -iz + 0.4, 0.9);
      const nT = Math.max(2, Math.floor((w - 2) / 2.6));
      for (let k = 0; k < nT; k++) {
        const tx = -ix + 1.3 + k * ((ix * 2 - 2.6) / Math.max(1, nT - 1));
        table(tx, iz - 1.6, 1.6);
        bench(tx, iz - 1.0, 1.5);
        bench(tx, iz - 2.2, 1.5);
        candle(tx, y + 0.8, iz - 1.6);
      }
      rug(0, 0, w * 0.4, d * 0.25);
      break;
    }
    case 'smithy': {
      // forge with glowing coals, anvil, quench barrel, tools
      b.box('stone', 1.6, 0.9, 1.3, -ix + 1.0, y + 0.45, -iz + 0.9, tint(0x6a625a, rand));
      b.box('ember', 1.2, 0.08, 0.9, -ix + 1.0, y + 0.93, -iz + 0.9, new THREE.Color(1, 1, 1));
      b.cone('stone', 0.9, 1.4, -ix + 1.0, y + 2.4, -iz + 0.9, tint(0x5a524a, rand), 4, Math.PI / 4);
      col(-ix + 1.0, -iz + 0.9, 0.9);
      b.box('metal', 0.5, 0.25, 0.25, 0.4, y + 0.82, -0.3, 0xffffff);
      b.box('metal', 0.2, 0.55, 0.2, 0.4, y + 0.42, -0.3, 0xffffff);
      b.cone('metal', 0.14, 0.35, 0.75, y + 0.82, -0.3, 0xffffff, 8);
      b.cyl('wood', 0.3, 0.5, 0.4, y + 0.1, -0.3, dark, true);
      col(0.4, -0.3, 0.45);
      barrel(ix - 0.6, -iz + 0.6);
      // weapon rack
      b.box('darkwood', 1.6, 0.08, 0.1, ix - 1.2, y + 1.5, -iz + 0.12, dark);
      for (let k = 0; k < 4; k++) b.box('metal', 0.06, 1.0, 0.02, ix - 1.8 + k * 0.4, y + 1.0, -iz + 0.18, 0xffffff);
      break;
    }
    case 'chapel': {
      // pews, altar with cloth and candles
      const rows = Math.floor((d - 4) / 1.3);
      for (let r2 = 0; r2 < rows; r2++) {
        const pz = iz - 1.5 - r2 * 1.3;
        bench(-w / 4, pz, w / 2 - 0.9);
        bench(w / 4, pz, w / 2 - 0.9);
        col(-w / 4, pz, 0.4);
        col(w / 4, pz, 0.4);
      }
      b.box('stone', 1.8, 1.0, 0.9, 0, y + 0.5, -iz + 0.9, tint(0xd8d0c0, rand));
      b.box('cloth', 1.9, 0.02, 0.95, 0, y + 1.01, -iz + 0.9, tint(spec.banner ?? 0x6a3aa0, rand));
      for (const cx2 of [-0.6, -0.2, 0.2, 0.6]) candle(cx2, y + 1.02, -iz + 0.9);
      b.box('cloth', 1.0, 2.6, 0.04, 0, y + 2.6, -iz + 0.05, tint(spec.banner ?? 0x6a3aa0, rand));
      col(0, -iz + 0.9, 0.9);
      break;
    }
    case 'barn':
    case 'stable': {
      for (let k = 0; k < 6; k++) {
        const hx = rand.range(-ix + 0.8, ix - 0.8);
        const hz = rand.range(-iz + 0.8, -iz / 3);
        b.box('straw', 1.1, 0.55, 0.6, hx, y + 0.28 + (k % 2) * 0.55, hz, tint(0xd8c080, rand), 0, rand() * 0.4);
        col(hx, hz, 0.55);
      }
      if (spec.kind === 'stable') {
        for (let k = 0; k < 3; k++) b.box('wood', 0.12, 1.3, d * 0.5, -ix + (k + 1) * (w / 4), y + 0.65, -iz / 3, wood);
        b.box('wood', w - 1, 0.4, 0.4, 0, y + 0.3, -iz + 0.4, wood);
      }
      break;
    }
    case 'keep':
    case 'manor': {
      // great hall: long table, throne on a dais, braziers, banners
      const tl = Math.min(d - 4, 7);
      b.box('darkwood', 1.3, 0.08, tl, 0, y + 0.8, 0.6, dark);
      for (let z2 = -tl / 2 + 0.4; z2 <= tl / 2 - 0.4; z2 += tl - 0.8) for (const s of [-1, 1]) b.box('darkwood', 0.12, 0.78, 0.12, s * 0.5, y + 0.4, 0.6 + z2, dark);
      for (let z2 = -tl / 2 + 0.6; z2 < tl / 2; z2 += 1.0) {
        chair(-1.0, 0.6 + z2, Math.PI / 2);
        chair(1.0, 0.6 + z2, -Math.PI / 2);
        if (rand.chance(0.4)) candle(rand.range(-0.4, 0.4), y + 0.85, 0.6 + z2);
      }
      col(0, 0.6, Math.max(0.8, tl * 0.35));
      b.box('stone', 3.2, 0.4, 2.0, 0, y + 0.2, -iz + 1.0, tint(0x9a9288, rand));
      b.box('darkwood', 1.0, 0.6, 0.8, 0, y + 0.7, -iz + 0.9, dark);
      b.box('darkwood', 1.0, 1.6, 0.15, 0, y + 1.6, -iz + 0.5, dark);
      b.box('cloth', 0.85, 0.08, 0.7, 0, y + 1.02, -iz + 0.95, tint(spec.banner ?? 0x7a1c1c, rand));
      for (const s of [-1, 1]) {
        b.cyl('metal', 0.3, 0.12, s * 2.2, y + 1.15, -iz + 1.2, 0xffffff, true);
        b.cyl('metal', 0.05, 1.1, s * 2.2, y + 0.55, -iz + 1.2, 0xffffff);
        b.box('ember', 0.4, 0.1, 0.4, s * 2.2, y + 1.22, -iz + 1.2, new THREE.Color(1, 1, 1));
        b.box('cloth', 1.0, 3.0, 0.04, s * (ix - 0.05), y + H * 0.55, 0, tint(spec.banner ?? 0x7a1c1c, rand), 0, Math.PI / 2);
      }
      rug(0, 0.6, 2.2, tl + 1);
      col(0, -iz + 1.0, 1.2);
      break;
    }
    case 'barracks': {
      const n = Math.floor((w - 1.5) / 1.4);
      for (let k = 0; k < n; k++) {
        bed(-ix + 0.8 + k * 1.4, -iz + 1.2, 0);
        crate(-ix + 0.8 + k * 1.4, iz - 0.6, 0.5);
      }
      table(0, 0.4, 2.0);
      break;
    }
    case 'shop': {
      b.box('darkwood', w * 0.6, 1.0, 0.6, 0, y + 0.5, 0.2, dark);
      b.box('wood', w * 0.6 + 0.1, 0.07, 0.7, 0, y + 1.03, 0.2, wood);
      col(0, 0.2, w * 0.3);
      shelf(-ix + 1.0, -iz + 0.2, 0);
      shelf(ix - 1.0, -iz + 0.2, 0);
      for (let k = 0; k < 4; k++) crate(rand.range(-ix + 0.5, ix - 0.5), rand.range(iz - 1.4, iz - 0.6), rand.range(0.45, 0.65));
      break;
    }
    default: {
      // home: table + chairs, bed, shelf, storage, rug
      const tx = rand.range(-ix / 3, ix / 3);
      const tz = rand.range(-0.2, iz / 2);
      table(tx, tz, rand.range(1.1, 1.5), rand.chance(0.5) ? 0 : Math.PI / 2);
      const nCh = rand.int(2, 4);
      for (let k = 0; k < nCh; k++) {
        const a = (k / nCh) * Math.PI * 2 + rand() * 0.4;
        chair(tx + Math.sin(a) * 0.95, tz + Math.cos(a) * 0.8, a + Math.PI);
      }
      if (rand.chance(0.7)) candle(tx, y + 0.8, tz);
      const bedSide = rand.chance(0.5) ? 1 : -1;
      bed(bedSide * (ix - 0.65), -iz + 1.2, 0);
      if (spec.floors === 1 && w > 6.5 && rand.chance(0.5)) bed(bedSide * (ix - 1.9), -iz + 1.2, 0);
      shelf(-bedSide * (ix - 0.9), -iz + 0.2, 0);
      if (rand.chance(0.6)) barrel(-bedSide * (ix - 0.5), iz - 0.6);
      if (rand.chance(0.5)) crate(bedSide * (ix - 0.5), iz - 0.6);
      if (rand.chance(0.6)) {
        b.box('wood', 0.9, 0.5, 0.5, bedSide * (ix - 0.65), y + 0.25, -iz + 2.6, tint(0x7a5a3a, rand));
        b.box('metal', 0.92, 0.06, 0.52, bedSide * (ix - 0.65), y + 0.4, -iz + 2.6, 0xffffff);
      }
      rug(tx, tz, rand.range(1.6, 2.4), rand.range(1.2, 1.8));
      break;
    }
  }
  void timberC;
}

// ---------------------------------------------------------------------------
// Fortifications
// ---------------------------------------------------------------------------

export interface WallRingSpec {
  points: { x: number; z: number }[]; // settlement-local polygon
  height: number;
  thickness: number;
  palisade: boolean;
  gates: number[]; // indices of edges that hold a gate
  roofMat: MatKey;
  banner: number;
  snow: boolean;
  groundY: (x: number, z: number) => number;
}

/** Curtain wall (stone) or palisade with towers at vertices and gatehouses on chosen edges. */
export function buildWallRing(b: GeoBatch, spec: WallRingSpec, rand: Rand, colliders: Collider2[]) {
  b.frame.identity();
  const stoneC = tint(0xcac4b8, rand, 0.06);
  const woodC = tint(0x6a4a2a, rand, 0.12);
  const n = spec.points.length;
  for (let i = 0; i < n; i++) {
    const a = spec.points[i];
    const c = spec.points[(i + 1) % n];
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    const ang = Math.atan2(c.x - a.x, c.z - a.z);
    const isGate = spec.gates.includes(i);
    const gateW = 4.2;
    const segs: [number, number][] = isGate ? [[0, len / 2 - gateW / 2], [len / 2 + gateW / 2, len]] : [[0, len]];
    for (const [s0, s1] of segs) {
      const sl = s1 - s0;
      if (sl < 0.5) continue;
      const mid = (s0 + s1) / 2 / len;
      const mx = a.x + (c.x - a.x) * mid;
      const mz = a.z + (c.z - a.z) * mid;
      const gy = spec.groundY(mx, mz);
      if (spec.palisade) {
        const stakes = Math.ceil(sl / 0.34);
        for (let k = 0; k < stakes; k++) {
          const t = (s0 + (k + 0.5) * (sl / stakes)) / len;
          const sx = a.x + (c.x - a.x) * t;
          const sz = a.z + (c.z - a.z) * t;
          const hh = spec.height * rand.range(0.88, 1.06);
          const yy = spec.groundY(sx, sz);
          b.cyl('wood', 0.17, hh, sx, yy + hh / 2 - 0.3, sz, tint(0x7a5a3a, rand, 0.15));
          b.cone('wood', 0.17, 0.4, sx, yy + hh - 0.1, sz, woodC);
        }
        b.box('darkwood', 0.14, 0.2, sl, mx, gy + spec.height * 0.6, mz, woodC, 0, ang);
      } else {
        b.box('stone', spec.thickness, spec.height + 1, sl, mx, gy + (spec.height + 1) / 2 - 1, mz, stoneC, 0, ang);
        // wall walk + crenellations on the outer edge
        const nx = Math.cos(ang);
        const nz = -Math.sin(ang);
        const merl = Math.floor(sl / 1.2);
        for (let k = 0; k < merl; k++) {
          const t = (s0 + (k + 0.5) * (sl / merl)) / len;
          const px = a.x + (c.x - a.x) * t + nx * (spec.thickness / 2 - 0.2);
          const pz = a.z + (c.z - a.z) * t + nz * (spec.thickness / 2 - 0.2);
          b.box('stone', 0.4, 0.8, 0.65, px, gy + spec.height + 0.4, pz, stoneC, 0, ang);
          const px2 = a.x + (c.x - a.x) * t - nx * (spec.thickness / 2 - 0.2);
          const pz2 = a.z + (c.z - a.z) * t - nz * (spec.thickness / 2 - 0.2);
          if (k % 2 === 0) b.box('stone', 0.3, 0.5, 0.6, px2, gy + spec.height + 0.25, pz2, stoneC, 0, ang);
        }
      }
      // colliders
      const cs = Math.ceil(sl / (spec.palisade ? 0.6 : 1.2));
      for (let k = 0; k <= cs; k++) {
        const t = (s0 + (k / cs) * sl) / len;
        colliders.push({ x: a.x + (c.x - a.x) * t, z: a.z + (c.z - a.z) * t, r: spec.palisade ? 0.35 : spec.thickness * 0.55 });
      }
    }
    if (isGate) {
      // gatehouse: two flanking towers, arch lintel, portcullis teeth, banners
      const mx = (a.x + c.x) / 2;
      const mz = (a.z + c.z) / 2;
      const gy = spec.groundY(mx, mz);
      const dirx = (c.x - a.x) / len;
      const dirz = (c.z - a.z) / len;
      const th = spec.height + (spec.palisade ? 2.5 : 4);
      for (const s of [-1, 1]) {
        const tx = mx + dirx * s * (gateW / 2 + 1.3);
        const tz = mz + dirz * s * (gateW / 2 + 1.3);
        if (spec.palisade) {
          for (const [ox, oz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) b.cyl('wood', 0.2, th, tx + ox, gy + th / 2, tz + oz, woodC);
          b.box('wood', 2.4, 0.15, 2.4, tx, gy + th - 1.2, tz, woodC, 0, ang);
          b.box('wood', 2.4, 1.0, 0.1, tx + Math.cos(ang) * 1.2, gy + th - 0.7, tz - Math.sin(ang) * 1.2, woodC, 0, ang);
          b.cone(spec.roofMat, 1.9, 1.6, tx, gy + th + 0.6, tz, tint(0x9a7a5a, rand), 4, ang + Math.PI / 4);
        } else {
          b.box('stone', 2.8, th, 2.8, tx, gy + th / 2 - 0.5, tz, stoneC, 0, ang);
          for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box('stone', 0.6, 0.8, 0.6, tx + ox * 1.1, gy + th + 0.1, tz + oz * 1.1, stoneC, 0, ang);
          b.box('cloth', 1.0, 2.6, 0.05, tx + Math.cos(ang) * 1.45, gy + th - 2.2, tz - Math.sin(ang) * 1.45, tint(spec.banner, rand), 0, ang + Math.PI / 2);
        }
        colliders.push({ x: tx, z: tz, r: 1.5 });
      }
      if (!spec.palisade) {
        b.box('stone', gateW + 1, 1.6, spec.thickness + 0.4, mx, gy + 4.6, mz, stoneC, 0, ang);
        for (let k = 0; k < 7; k++) b.box('metal', 0.08, 1.0, 0.08, mx + dirx * (-gateW / 2 + 0.3 + k * (gateW - 0.6) / 6), gy + 3.4, mz + dirz * (-gateW / 2 + 0.3 + k * (gateW - 0.6) / 6), 0xffffff);
      } else {
        b.box('wood', gateW + 1, 0.4, 0.4, mx, gy + spec.height + 0.6, mz, woodC, 0, ang);
      }
    }
    // tower at vertex a
    const gy = spec.groundY(a.x, a.z);
    if (spec.palisade) {
      if (i % 2 === 0) {
        const th = spec.height + 2.2;
        for (const [ox, oz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) b.cyl('wood', 0.18, th, a.x + ox, gy + th / 2, a.z + oz, woodC);
        b.box('wood', 2.1, 0.15, 2.1, a.x, gy + th - 1.1, a.z, woodC);
        b.cone(spec.roofMat, 1.7, 1.4, a.x, gy + th + 0.5, a.z, tint(0x9a7a5a, rand), 4, Math.PI / 4);
        colliders.push({ x: a.x, z: a.z, r: 1.2 });
      }
    } else {
      const round = rand.chance(0.6);
      const th = spec.height + rand.range(3, 6);
      const tr = rand.range(2.2, 3.0);
      if (round) b.cyl('stone', tr, th + 1, a.x, gy + (th + 1) / 2 - 1, a.z, stoneC, true);
      else b.box('stone', tr * 1.8, th + 1, tr * 1.8, a.x, gy + (th + 1) / 2 - 1, a.z, stoneC, 0, ang);
      if (rand.chance(0.55)) {
        b.cone(spec.roofMat, tr * 1.15, tr * 1.6, a.x, gy + th + tr * 0.8, a.z, tint(0x8a8f98, rand), round ? 16 : 4, round ? 0 : ang + Math.PI / 4);
        if (spec.snow) b.cone('snow', tr * 1.05, tr * 0.7, a.x, gy + th + tr * 1.25, a.z, 0xffffff, round ? 16 : 4, round ? 0 : ang + Math.PI / 4);
        b.cyl('darkwood', 0.05, 2.2, a.x, gy + th + tr * 1.6 + 1, a.z, 0xffffff);
        b.box('cloth', 1.0, 0.6, 0.03, a.x + 0.5, gy + th + tr * 1.6 + 1.7, a.z, tint(spec.banner, rand));
      } else {
        const m = round ? 10 : 8;
        for (let k = 0; k < m; k++) {
          const t2 = (k / m) * Math.PI * 2;
          b.box('stone', 0.6, 0.85, 0.5, a.x + Math.cos(t2) * (tr - 0.25), gy + th + 0.4, a.z + Math.sin(t2) * (tr - 0.25), stoneC, 0, -t2);
        }
      }
      // arrow slits
      for (let k = 0; k < 3; k++) {
        const t2 = rand() * Math.PI * 2;
        b.box('glass', 0.15, 0.9, 0.1, a.x + Math.cos(t2) * (tr + 0.01), gy + 2 + k * (th / 3), a.z + Math.sin(t2) * (tr + 0.01), new THREE.Color(0.2, 0.2, 0.2), 0, -t2 + Math.PI / 2);
      }
      colliders.push({ x: a.x, z: a.z, r: tr + 0.2 });
    }
  }
}
