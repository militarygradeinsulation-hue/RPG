import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PBRTextureSet } from '../../render/MaterialLibrary';

/**
 * BuildingKit: procedural architecture for settlements.
 *
 * Geometry is accumulated into a GeoBatch keyed by a small set of shared materials.
 * Each piece carries its own vertex color (tint) and world-planar UVs, so thousands of
 * unique pieces collapse into ~12 draw calls per settlement while still looking varied.
 */

export type MatKey =
  | 'plaster'
  | 'stone'
  | 'brick'
  | 'wood'
  | 'darkwood'
  | 'thatch'
  | 'shingle'
  | 'slate'
  | 'glass'
  | 'metal'
  | 'cloth'
  | 'ember'
  | 'snow'
  | 'straw'
  | 'foliage';

const UV_SCALE: Record<MatKey, number> = {
  plaster: 2.2,
  stone: 2.4,
  brick: 1.6,
  wood: 1.4,
  darkwood: 1.2,
  thatch: 2.0,
  shingle: 1.8,
  slate: 1.8,
  glass: 1,
  metal: 1,
  cloth: 1.5,
  ember: 1,
  snow: 3,
  straw: 1.2,
  foliage: 1.5,
};

// ---------------------------------------------------------------------------
// Materials (created once, shared by every settlement)
// ---------------------------------------------------------------------------

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

function rnd(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function noiseFill(g: CanvasRenderingContext2D, s: number, base: number, spread: number, dots: number, seed: number, size = 2) {
  const r = rnd(seed);
  g.fillStyle = `rgb(${base},${base},${base})`;
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < dots; i++) {
    const v = Math.round(base + (r() - 0.5) * spread);
    g.fillStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.5})`;
    g.fillRect(r() * s, r() * s, size + r() * size * 2, size + r() * size * 2);
  }
}

let SHARED: Record<MatKey, THREE.Material> | null = null;
let glassMat: THREE.MeshStandardMaterial | null = null;
let emberMat: THREE.MeshStandardMaterial | null = null;

export function getBuildingMaterials(stone: PBRTextureSet, wood: PBRTextureSet): Record<MatKey, THREE.Material> {
  if (SHARED) return SHARED;

  const plasterTex = canvasTex(256, (g, s) => {
    noiseFill(g, s, 225, 40, 2600, 7, 2);
    const r = rnd(9);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(150,140,120,${0.05 + r() * 0.1})`;
      g.beginPath();
      g.ellipse(r() * s, r() * s, 10 + r() * 40, 6 + r() * 20, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
  const plasterBump = canvasTex(256, (g, s) => noiseFill(g, s, 128, 90, 4000, 11, 1), false);

  const brickTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#b8b0a4';
    g.fillRect(0, 0, s, s);
    const r = rnd(21);
    const rows = 16;
    const bh = s / rows;
    for (let y = 0; y < rows; y++) {
      const off = (y % 2) * bh;
      for (let x = -1; x < 8; x++) {
        const v = 190 + Math.round((r() - 0.5) * 60);
        g.fillStyle = `rgb(${v},${Math.round(v * 0.62)},${Math.round(v * 0.5)})`;
        g.fillRect(x * bh * 2 + off + 1.5, y * bh + 1.5, bh * 2 - 3, bh - 3);
      }
    }
  });

  const thatchTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#b3954f';
    g.fillRect(0, 0, s, s);
    const r = rnd(31);
    for (let i = 0; i < 3500; i++) {
      const x = r() * s;
      const y = r() * s;
      const v = 120 + r() * 110;
      g.strokeStyle = `rgba(${v},${v * 0.82},${v * 0.48},0.7)`;
      g.lineWidth = 0.6 + r() * 1.2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 3, y + 10 + r() * 22);
      g.stroke();
    }
    for (let y = 0; y < s; y += 32) {
      g.fillStyle = 'rgba(60,45,20,0.25)';
      g.fillRect(0, y, s, 3);
    }
  });

  const shingleTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#5a4634';
    g.fillRect(0, 0, s, s);
    const r = rnd(41);
    const rows = 12;
    const rh = s / rows;
    for (let y = 0; y < rows; y++) {
      let x = (y % 2) * 8 - 8;
      while (x < s) {
        const w = 14 + r() * 14;
        const v = 95 + r() * 70;
        g.fillStyle = `rgb(${v},${v * 0.78},${v * 0.6})`;
        g.fillRect(x + 1, y * rh + 1, w - 2, rh - 1);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x + 1, y * rh + rh - 3, w - 2, 3);
        x += w;
      }
    }
  });

  const slateTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#2e3236';
    g.fillRect(0, 0, s, s);
    const r = rnd(51);
    const rows = 14;
    const rh = s / rows;
    for (let y = 0; y < rows; y++) {
      let x = (y % 2) * 9 - 9;
      while (x < s) {
        const w = 16 + r() * 8;
        const v = 70 + r() * 50;
        g.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
        g.fillRect(x + 1, y * rh + 1, w - 2, rh - 1);
        g.fillStyle = 'rgba(0,0,0,0.4)';
        g.fillRect(x + 1, y * rh + rh - 2, w - 2, 2);
        x += w;
      }
    }
  });

  const clothTex = canvasTex(128, (g, s) => {
    noiseFill(g, s, 230, 30, 1200, 61, 1);
    g.strokeStyle = 'rgba(0,0,0,0.06)';
    for (let i = 0; i < s; i += 3) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, s);
      g.stroke();
    }
  });
  const strawTex = canvasTex(128, (g, s) => {
    g.fillStyle = '#c9a85a';
    g.fillRect(0, 0, s, s);
    const r = rnd(71);
    for (let i = 0; i < 1500; i++) {
      const v = 150 + r() * 90;
      g.strokeStyle = `rgba(${v},${v * 0.85},${v * 0.45},0.8)`;
      g.beginPath();
      const x = r() * s;
      const y = r() * s;
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 20, y + (r() - 0.5) * 6);
      g.stroke();
    }
  });

  for (const t of [stone.map, stone.normalMap, stone.roughnessMap, wood.map, wood.normalMap, wood.roughnessMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }

  glassMat = new THREE.MeshStandardMaterial({
    color: 0x1a2430,
    roughness: 0.12,
    metalness: 0.2,
    emissive: new THREE.Color(0xffa94d),
    emissiveIntensity: 0,
    vertexColors: true,
  });
  emberMat = new THREE.MeshStandardMaterial({ color: 0x2a0e04, emissive: 0xff5a14, emissiveIntensity: 2.4, roughness: 0.9, vertexColors: true });

  SHARED = {
    plaster: new THREE.MeshStandardMaterial({ map: plasterTex, bumpMap: plasterBump, bumpScale: 1.2, roughness: 0.92, vertexColors: true }),
    stone: new THREE.MeshStandardMaterial({ map: stone.map, normalMap: stone.normalMap, roughnessMap: stone.roughnessMap, roughness: 1, vertexColors: true }),
    brick: new THREE.MeshStandardMaterial({ map: brickTex, bumpMap: brickTex, bumpScale: 1.5, roughness: 0.88, vertexColors: true }),
    wood: new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, roughnessMap: wood.roughnessMap, roughness: 1, vertexColors: true }),
    darkwood: new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, roughness: 0.85, color: 0x6a5a4a, vertexColors: true }),
    thatch: new THREE.MeshStandardMaterial({ map: thatchTex, bumpMap: thatchTex, bumpScale: 3, roughness: 1, vertexColors: true }),
    shingle: new THREE.MeshStandardMaterial({ map: shingleTex, bumpMap: shingleTex, bumpScale: 2, roughness: 0.9, vertexColors: true }),
    slate: new THREE.MeshStandardMaterial({ map: slateTex, bumpMap: slateTex, bumpScale: 1.5, roughness: 0.62, vertexColors: true }),
    glass: glassMat,
    metal: new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.9, roughness: 0.45, vertexColors: true }),
    cloth: new THREE.MeshStandardMaterial({ map: clothTex, roughness: 0.95, side: THREE.DoubleSide, vertexColors: true }),
    ember: emberMat,
    snow: new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.75, vertexColors: true }),
    straw: new THREE.MeshStandardMaterial({ map: strawTex, roughness: 1, vertexColors: true }),
    foliage: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, vertexColors: true }),
  };
  return SHARED;
}

/** 0 = day, 1 = deep night. Lights up windows; hearths flicker. */
export function setSettlementNight(night: number, t: number) {
  if (glassMat) glassMat.emissiveIntensity = night * 1.8;
  if (emberMat) emberMat.emissiveIntensity = 2.0 + Math.sin(t * 7) * 0.25 + Math.sin(t * 13.3) * 0.15;
}

// ---------------------------------------------------------------------------
// Geometry batch
// ---------------------------------------------------------------------------

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8);
const CYL16 = new THREE.CylinderGeometry(1, 1, 1, 16);
const CONE4 = new THREE.ConeGeometry(1, 1, 4);
const CONE8 = new THREE.ConeGeometry(1, 1, 8);
const CONE16 = new THREE.ConeGeometry(1, 1, 16);
const SPHERE = new THREE.SphereGeometry(1, 10, 8);

/** Triangular prism (gable end), base along X from -0.5..0.5, apex at y=1, depth along Z. */
const GABLE = (() => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0, 1);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
})();

export class GeoBatch {
  readonly parts = new Map<MatKey, THREE.BufferGeometry[]>();
  /** Frame applied to every piece (building placement). */
  frame = new THREE.Matrix4();
  tris = 0;

  add(mat: MatKey, src: THREE.BufferGeometry, local: THREE.Matrix4, color: number | THREE.Color) {
    let g = src.index ? src.toNonIndexed() : src.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    g.clearGroups();
    _m.multiplyMatrices(this.frame, local);
    g.applyMatrix4(_m);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const count = pos.count;
    const uv = new Float32Array(count * 2);
    const col = new Float32Array(count * 3);
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    const sc = 1 / UV_SCALE[mat];
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const nx = Math.abs(nor.getX(i));
      const ny = Math.abs(nor.getY(i));
      const nz = Math.abs(nor.getZ(i));
      let u: number;
      let v: number;
      if (ny >= nx && ny >= nz) {
        u = x;
        v = z;
      } else if (nx >= nz) {
        u = z;
        v = y;
      } else {
        u = x;
        v = y;
      }
      uv[i * 2] = u * sc;
      uv[i * 2 + 1] = v * sc;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.tris += count / 3;
    let arr = this.parts.get(mat);
    if (!arr) this.parts.set(mat, (arr = []));
    arr.push(g);
  }

  /** Shape helper: geometry scaled by (sx, sy, sz), rotated (rx, ry, rz) and placed at (x, y, z). */
  put(mat: MatKey, geo: THREE.BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number | THREE.Color, rx = 0, ry = 0, rz = 0) {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.add(mat, geo, _m.clone(), color);
  }

  box(mat: MatKey, w: number, h: number, d: number, x: number, y: number, z: number, color: number | THREE.Color, rx = 0, ry = 0, rz = 0) {
    this.put(mat, BOX, x, y, z, w, h, d, color, rx, ry, rz);
  }

  cyl(mat: MatKey, r: number, h: number, x: number, y: number, z: number, color: number | THREE.Color, smooth = false, rx = 0, ry = 0, rz = 0) {
    this.put(mat, smooth ? CYL16 : CYL8, x, y, z, r, h, r, color, rx, ry, rz);
  }

  cone(mat: MatKey, r: number, h: number, x: number, y: number, z: number, color: number | THREE.Color, sides: 4 | 8 | 16 = 8, ry = 0) {
    this.put(mat, sides === 4 ? CONE4 : sides === 8 ? CONE8 : CONE16, x, y, z, r, h, r, color, 0, ry, 0);
  }

  sphere(mat: MatKey, r: number, x: number, y: number, z: number, color: number | THREE.Color, sy = 1) {
    this.put(mat, SPHERE, x, y, z, r, r * sy, r, color);
  }

  /** Gable triangle (width w, height h, thickness t) standing on y. */
  gable(mat: MatKey, w: number, h: number, t: number, x: number, y: number, z: number, color: number | THREE.Color, ry = 0) {
    this.put(mat, GABLE, x, y, z, w, h, t, color, 0, ry, 0);
  }

  build(materials: Record<MatKey, THREE.Material>, castShadow = true): THREE.Group {
    const group = new THREE.Group();
    for (const [mat, geos] of this.parts) {
      if (!geos.length) continue;
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials[mat]);
      mesh.castShadow = castShadow && mat !== 'glass' && mat !== 'ember';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

// ---------------------------------------------------------------------------
// Palettes and styles
// ---------------------------------------------------------------------------

export type RegionStyle = 'timber' | 'stone' | 'log' | 'ember';

export const PLASTER_COLORS = [0xf1e9d8, 0xe9dcc0, 0xdcc8a0, 0xe8d2c4, 0xd4dce0, 0xe6e0d0, 0xc9b896, 0xf3ede4, 0xd8c0a8, 0xe0d4b8];
export const SHUTTER_COLORS = [0x2f4a3a, 0x3a2a1c, 0x5a1a1a, 0x1f3550, 0x6a5a2a, 0x4a3a5a, 0x2a3a2a, 0x7a3a1a];
export const DOOR_COLORS = [0x4a3020, 0x3a2416, 0x5a3a24, 0x2a3a4a, 0x5a2020, 0x2f4a3a, 0x4a4030];
export const CLOTH_COLORS = [0xb03a2e, 0x2e5ab0, 0xd4a640, 0x3a8a4a, 0x8a3ab0, 0xc86a2a, 0xe8e0d0, 0x2a7a7a];

export interface Rand {
  (): number;
  pick<T>(arr: readonly T[]): T;
  range(a: number, b: number): number;
  int(a: number, b: number): number;
  chance(p: number): boolean;
}

export function makeRand(seed: number): Rand {
  const base = rnd(Math.floor(seed * 9973) ^ 0x9e3779b9);
  const r = (() => base()) as Rand;
  r.pick = (arr) => arr[Math.floor(base() * arr.length) % arr.length];
  r.range = (a, b) => a + base() * (b - a);
  r.int = (a, b) => Math.floor(a + base() * (b - a + 1));
  r.chance = (p) => base() < p;
  return r;
}

export function tint(hex: number, rand: Rand, amount = 0.08): THREE.Color {
  const c = new THREE.Color(hex);
  const k = 1 + (rand() - 0.5) * amount * 2;
  c.r = Math.min(1, c.r * k);
  c.g = Math.min(1, c.g * k * (1 + (rand() - 0.5) * amount * 0.5));
  c.b = Math.min(1, c.b * k);
  return c;
}
