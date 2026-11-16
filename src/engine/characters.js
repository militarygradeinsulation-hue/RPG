/**
 * AETHELGARD CHARACTER SYSTEM
 * Drop-in Three.js (r160+) module. No external assets needed.
 *
 * Builds rigged, animated characters from code: proportioned bodies, faces with eyes,
 * hair styles, clothing, armor, cloaks, and weapons, with procedural PBR textures.
 * Includes a gait system (idle -> walk -> jog -> sprint blended by real speed in m/s)
 * and actions (strike, cast, block, wave).
 *
 * USAGE
 *   import { createCharacter, PRESETS } from './aethelgard-characters.js';
 *   const hero = createCharacter('hero');            // or a custom options object
 *   scene.add(hero.root);
 *   // every frame:
 *   hero.update(dt, { speed: playerSpeedMetersPerSecond });
 *   // on input:
 *   hero.play('strike');   // 'strike' | 'cast' | 'block' | 'wave'
 *
 * The root's origin is at the feet. The character faces +Z.
 * Move and rotate hero.root from your controller / Rapier body. Do not scale the root
 * unless you also scale your collider capsule (default: 1.8 m tall, radius 0.3 m).
 */
import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Procedural textures                                                 */
/* ------------------------------------------------------------------ */

const TEX_CACHE = new Map();

function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s);
  const c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s = 0, oct = 4) {
  let t = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { t += vnoise(x * f, y * f, s + i * 17) * amp; f *= 2; amp *= 0.5; }
  return t;
}

/** Builds a grayscale canvas texture from fn(u,v)->0..1. Seamless enough at the repeat sizes used. */
function makeTex(key, size, fn, { srgb = false, repeat = [1, 1] } = {}) {
  const ck = key + repeat.join('x');
  if (TEX_CACHE.has(ck)) return TEX_CACHE.get(ck);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const g = Math.max(0, Math.min(1, fn(x / size, y / size))) * 255;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  TEX_CACHE.set(ck, t);
  return t;
}

const PATTERNS = {
  fabric: (u, v) => {
    const wx = Math.sin(u * Math.PI * 2 * 48) * 0.5 + 0.5;
    const wy = Math.sin(v * Math.PI * 2 * 48) * 0.5 + 0.5;
    const weave = (Math.floor(u * 48) + Math.floor(v * 48)) % 2 ? wx : wy;
    return 0.72 + weave * 0.14 + fbm(u * 8, v * 8, 3) * 0.14;
  },
  leather: (u, v) => {
    const grain = fbm(u * 40, v * 40, 7, 3);
    const wear = fbm(u * 3, v * 3, 9, 4);
    return 0.6 + grain * 0.22 + wear * 0.18;
  },
  metal: (u, v) => {
    const brushed = vnoise(u * 2, v * 260, 11) * 0.5 + vnoise(u * 4, v * 520, 12) * 0.5;
    const scratch = Math.pow(vnoise(u * 60, v * 6, 13), 12) * 0.6;
    const grime = fbm(u * 4, v * 4, 14) * 0.25;
    return 0.7 + brushed * 0.12 + scratch - grime;
  },
  metalRough: (u, v) => 0.25 + fbm(u * 6, v * 6, 21) * 0.35 + Math.pow(vnoise(u * 60, v * 6, 13), 12) * 0.3,
  chain: (u, v) => {
    const n = 40;
    const cx = (u * n) % 1, cy = ((v * n) + (Math.floor(u * n) % 2) * 0.5) % 1;
    const d = Math.hypot(cx - 0.5, cy - 0.5);
    const ring = Math.max(0, 1 - Math.abs(d - 0.32) * 9);
    return 0.15 + ring * 0.85;
  },
  skin: (u, v) => 0.86 + fbm(u * 6, v * 6, 31) * 0.1 + vnoise(u * 300, v * 300, 32) * 0.04,
  skinBump: (u, v) => vnoise(u * 400, v * 400, 33) * 0.6 + fbm(u * 30, v * 30, 34) * 0.4,
  hair: (u, v) => 0.55 + vnoise(u * 300, v * 3, 41) * 0.35 + vnoise(u * 900, v * 6, 42) * 0.1,
  fur: (u, v) => 0.5 + vnoise(u * 200, v * 30, 51) * 0.3 + fbm(u * 10, v * 10, 52) * 0.2,
  wood: (u, v) => 0.6 + Math.sin((u * 30 + fbm(u * 4, v * 30, 61) * 6)) * 0.12 + fbm(u * 2, v * 60, 62) * 0.2,
};

function tex(name, repeat = [1, 1], size = 256) {
  return makeTex(name, size, PATTERNS[name], { repeat });
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

function skinMat(color) {
  return new THREE.MeshPhysicalMaterial({
    color, roughness: 0.52, map: tex('skin', [2, 2]),
    bumpMap: tex('skinBump', [2, 2], 512), bumpScale: 0.6,
    sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xff9a80),
    specularIntensity: 0.45,
  });
}
function fabricMat(color, repeat = [3, 3]) {
  const t = tex('fabric', repeat, 256);
  return new THREE.MeshPhysicalMaterial({
    color, roughness: 0.88, map: t, bumpMap: t, bumpScale: 0.8,
    sheen: 0.5, sheenRoughness: 0.8, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.3),
    side: THREE.DoubleSide,
  });
}
function leatherMat(color, repeat = [2, 2]) {
  const t = tex('leather', repeat, 256);
  return new THREE.MeshStandardMaterial({ color, roughness: 0.62, map: t, bumpMap: t, bumpScale: 1.2, roughnessMap: t, side: THREE.DoubleSide });
}
function metalMat(color, repeat = [1, 2]) {
  return new THREE.MeshStandardMaterial({
    color, metalness: 1, roughness: 0.38, map: tex('metal', repeat, 512),
    roughnessMap: tex('metalRough', repeat), bumpMap: tex('metal', repeat, 512), bumpScale: 0.3,
    envMapIntensity: 1.2,
  });
}
function chainMat(color = 0x8a8f96) {
  const t = tex('chain', [6, 6], 256);
  return new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: 0.45, map: t, bumpMap: t, bumpScale: 2, alphaTest: 0 });
}
function hairMat(color) {
  const t = tex('hair', [3, 1], 256);
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, map: t, bumpMap: t, bumpScale: 1, sheen: 0.8, sheenColor: new THREE.Color(color).offsetHSL(0, 0, 0.25), sheenRoughness: 0.35 });
}
function furMat(color) {
  const t = tex('fur', [4, 4], 256);
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.95, map: t, bumpMap: t, bumpScale: 3, sheen: 1, sheenColor: new THREE.Color(color).offsetHSL(0, 0, 0.2), side: THREE.DoubleSide });
}
function woodMat(color = 0x5a3b22) {
  const t = tex('wood', [1, 3], 256);
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, map: t, bumpMap: t, bumpScale: 1 });
}
function glowMat(color, intensity = 3) {
  return new THREE.MeshPhysicalMaterial({
    color, emissive: color, emissiveIntensity: intensity, roughness: 0.1,
    transmission: 0.3, thickness: 0.05, ior: 1.8, clearcoat: 1,
  });
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

function mesh(geo, mat, parent, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos); m.rotation.set(...rot); m.scale.set(...scl);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}
function joint(parent, pos = [0, 0, 0], name = '') {
  const o = new THREE.Object3D(); o.name = name; o.position.set(...pos); parent.add(o); return o;
}
/** Lathe from [radius, y] pairs, smoothed with a Catmull-Rom spline. */
function lathe(points, segs = 32, depthScale = 1, steps = 40) {
  const curve = new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(r, y)));
  const g = new THREE.LatheGeometry(curve.getPoints(steps), segs);
  if (depthScale !== 1) g.scale(1, 1, depthScale);
  g.computeVertexNormals();
  return g;
}
/** Capsule limb hanging down from a joint (along -Y). */
function limb(parent, len, r0, r1, mat) {
  const g = lathe([[0.001, 0], [r1 * 0.85, len * 0.02], [r1, len * 0.12], [(r0 + r1) / 2 * 1.04, len * 0.5], [r0, len * 0.88], [r0 * 0.85, len * 0.98], [0.001, len]], 20, 1, 24);
  g.translate(0, -len, 0);
  return mesh(g, mat, parent);
}

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

export const SKIN_TONES = [0xf1c7a8, 0xe0ac8a, 0xc68863, 0x9c6544, 0x6e432a, 0x4a2c1c];

export const PRESETS = {
  hero: {
    name: 'Hero (Seal Warden)', height: 1.82, bulk: 1.05, skin: SKIN_TONES[1], sex: 'm',
    hair: { style: 'short', color: 0x3a2618 }, beard: { style: 'stubble', color: 0x3a2618 },
    shirt: 0x2f4a6b, pants: 0x3b3128, boots: 0x3a2a1c,
    chain: true, chestPlate: 0xa8adb3, pauldrons: 0xa8adb3, gauntlets: 0x4a3626, greaves: 0xa8adb3,
    belt: 0x4a2f1c, cloak: { color: 0x1f3550, length: 1.1 }, weapon: 'sword', offhand: 'shield', shieldColor: 0x1f3550,
  },
  seal_mage: {
    name: 'Seal Keeper (Mage)', height: 1.74, bulk: 0.92, skin: SKIN_TONES[0], sex: 'm',
    hair: { style: 'long', color: 0xd8d4cc }, beard: { style: 'long', color: 0xd8d4cc },
    robe: 0xc8861e, robeTrim: 0x6b3d0f, hood: 0x8e5a14, boots: 0x3a2a1c, belt: 0x5a3a1a,
    weapon: 'staff', staffGlow: 0xffd66b,
  },
  guard: {
    name: 'Town Guard', height: 1.85, bulk: 1.12, skin: SKIN_TONES[2], sex: 'm',
    hair: { style: 'short', color: 0x1e1610 }, beard: { style: 'full', color: 0x1e1610 },
    shirt: 0x5a1a1a, pants: 0x2b2420, boots: 0x2a1e14,
    chain: true, chestPlate: 0x9aa0a6, pauldrons: 0x9aa0a6, gauntlets: 0x9aa0a6, greaves: 0x9aa0a6,
    helmet: 'nasal', tabard: 0x7a1c1c, belt: 0x2a1a10, weapon: 'spear', offhand: 'shield', shieldColor: 0x7a1c1c,
  },
  villager: {
    name: 'Villager', height: 1.66, bulk: 0.9, skin: SKIN_TONES[3], sex: 'f',
    hair: { style: 'braid', color: 0x4a2a14 }, shirt: 0xd8cdb4, dress: 0x4f6b3a, apron: 0xcfc4a8, boots: 0x3a2a1c,
    belt: 0x5a3a1a,
  },
  blacksmith: {
    name: 'Blacksmith', height: 1.8, bulk: 1.3, skin: SKIN_TONES[4], sex: 'm',
    hair: { style: 'bald', color: 0x111111 }, beard: { style: 'full', color: 0x1a1410 },
    shirt: 0x6a5a48, pants: 0x3a3128, boots: 0x2a1e14, leatherApron: 0x5a3a22, gauntlets: 0x4a3626,
    weapon: 'hammer', sleeves: 'rolled',
  },
  merchant: {
    name: 'Merchant', height: 1.7, bulk: 1.22, skin: SKIN_TONES[1], sex: 'm',
    hair: { style: 'short', color: 0x6a4a2a }, beard: { style: 'goatee', color: 0x6a4a2a },
    shirt: 0x7a2a5a, vest: 0xb08a2a, pants: 0x2a2a3a, boots: 0x3a2a1c, belt: 0x3a2a1a,
    cloak: { color: 0x2a1a3a, length: 0.9 }, hat: 0x2a1a3a,
  },
  bandit: {
    name: 'Bandit', height: 1.78, bulk: 1.0, skin: SKIN_TONES[2], sex: 'm',
    hair: { style: 'short', color: 0x2a1a10 }, beard: { style: 'stubble', color: 0x2a1a10 },
    shirt: 0x3a3a30, pants: 0x2a2620, boots: 0x2a1e14, leatherArmor: 0x4a3020, gauntlets: 0x3a2618,
    hood: 0x26221c, mask: 0x1a1814, belt: 0x2a1a10, weapon: 'dagger', cloak: { color: 0x26221c, length: 0.8, tattered: true },
  },
  jarl: {
    name: 'Jarl of the Frost Hold', height: 1.88, bulk: 1.15, skin: SKIN_TONES[0], sex: 'm',
    hair: { style: 'long', color: 0xb07a3a }, beard: { style: 'braided', color: 0xb07a3a },
    shirt: 0x2a3a5a, pants: 0x2a2620, boots: 0x3a2a1c, chestPlate: 0x7a6a4a, gauntlets: 0x4a3626,
    furMantle: 0x8a7a6a, crown: 0xd4a640, belt: 0x3a2a1a, cloak: { color: 0x4a1c1c, length: 1.25 }, weapon: 'sword',
  },
  shieldmaiden: {
    name: 'Shieldmaiden', height: 1.74, bulk: 0.98, skin: SKIN_TONES[0], sex: 'f',
    hair: { style: 'ponytail', color: 0xc9a050 },
    shirt: 0x4a5a6a, pants: 0x3a3128, boots: 0x3a2a1c, leatherArmor: 0x5a3a22,
    pauldrons: 0x9aa0a6, gauntlets: 0x4a3626, greaves: 0x9aa0a6, belt: 0x4a2f1c,
    furMantle: 0xd8d0c4, weapon: 'axe', offhand: 'shield', shieldColor: 0x3a5a3a,
  },
  ranger: {
    name: 'Ranger', height: 1.76, bulk: 0.95, skin: SKIN_TONES[1], sex: 'f',
    hair: { style: 'braid', color: 0x5a2e14 }, eyes: 0x3a6a8a,
    shirt: 0x3e4a2e, pants: 0x3a3128, boots: 0x3a2a1c, leatherArmor: 0x5a3a22, gauntlets: 0x4a3626,
    hood: 0x2f3f24, belt: 0x4a2f1c, cloak: { color: 0x2f3f24, length: 1.0 }, offhand: 'bow', quiver: true,
  },
};

/** Named NPC looks for the current cast in src/data/worldData.ts */
export const NPC_LOOKS = {
  npc_rowan: { ...PRESETS.seal_mage, name: 'Elder Rowan' },
  npc_lyra: { ...PRESETS.ranger, name: 'Lyra of the Gale', hair: { style: 'ponytail', color: 0xc9a050 }, hood: null, cloak: { color: 0x5a7a9a, length: 1.0 }, shirt: 0x6a8aa8 },
  npc_thorin: {
    name: 'Thorin Ironheart', height: 1.45, bulk: 1.4, skin: SKIN_TONES[1], sex: 'm',
    hair: { style: 'long', color: 0x8a3a1a }, beard: { style: 'braided', color: 0x8a3a1a },
    shirt: 0x6a3a2a, pants: 0x3a3128, boots: 0x2a1e14, chain: true, chestPlate: 0x8a8070, pauldrons: 0x8a8070,
    gauntlets: 0x4a3626, belt: 0x3a2618, leatherApron: 0x4a2f1c, weapon: 'hammer', helmet: 'nasal',
  },
  npc_marcus: { ...PRESETS.merchant, name: 'Baron Marcus Vance', shirt: 0x5a1a1a, vest: 0x1a1a1a, cloak: { color: 0x3a0a0a, length: 1.15 }, hat: null, crown: 0xc0c0c0, beard: { style: 'goatee', color: 0x2a1a10 }, hair: { style: 'short', color: 0x2a1a10 } },
  npc_elara: { ...PRESETS.seal_mage, name: 'Artificer Elara', sex: 'f', height: 1.68, skin: SKIN_TONES[3], hair: { style: 'ponytail', color: 0x1a1210 }, beard: null, hood: null, robe: 0x2a6a6a, robeTrim: 0xc9a040, staffGlow: 0x6bff9a },
  npc_vespera: { ...PRESETS.seal_mage, name: 'Vespera', sex: 'f', height: 1.76, skin: SKIN_TONES[5], hair: { style: 'long', color: 0xe8e8f0 }, beard: null, hood: null, robe: 0x3a2a6a, robeTrim: 0x7fd4ff, staffGlow: 0x7fd4ff, cloak: { color: 0x1a1a3a, length: 1.2 } },
};

/* ------------------------------------------------------------------ */
/* Player customization                                                */
/* ------------------------------------------------------------------ */

export const HAIR_STYLES = ['short', 'long', 'braid', 'ponytail', 'bald'];
export const BEARD_STYLES = ['none', 'stubble', 'goatee', 'full', 'long', 'braided'];
export const HAIR_COLORS = [0x1a1210, 0x3a2618, 0x6a4a2a, 0x8a3a1a, 0xc9a050, 0xd8d4cc, 0x2a2a2a, 0x5a2e14];
export const EYE_COLORS = [0x4a6a3a, 0x3a6a8a, 0x5a3a1a, 0x2a2a2a, 0x7a8a9a, 0x8a6a2a];
export const ACCENT_COLORS = [0x1f3550, 0x7a1c1c, 0x2f3f24, 0x3a2a6a, 0xc8861e, 0x26221c, 0x2a6a6a, 0x5a5a5a];
export const HERO_CLASSES = {
  warden: { label: 'Seal Warden', blurb: 'Steel, shield and sword. Built to hold the line.' },
  mage: { label: 'Arcanist', blurb: 'Robes and a crystal staff. Strongest elemental casting.' },
  ranger: { label: 'Ranger', blurb: 'Leather, hood and longbow. Fast and quiet.' },
  rogue: { label: 'Shadowblade', blurb: 'Dark leathers and a dagger. Strikes from stealth.' },
};

export function defaultAppearance() {
  return { name: '', sex: 'm', skin: SKIN_TONES[1], eyes: EYE_COLORS[0], hairStyle: 'short', hairColor: HAIR_COLORS[1], beardStyle: 'stubble', height: 1.82, bulk: 1.05, heroClass: 'warden', accent: ACCENT_COLORS[0] };
}

export function randomAppearance(rng = Math.random) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const sex = rng() < 0.5 ? 'm' : 'f';
  return {
    name: '', sex, skin: pick(SKIN_TONES), eyes: pick(EYE_COLORS),
    hairStyle: pick(sex === 'f' ? ['long', 'braid', 'ponytail', 'short'] : HAIR_STYLES), hairColor: pick(HAIR_COLORS),
    beardStyle: sex === 'f' ? 'none' : pick(BEARD_STYLES),
    height: sex === 'f' ? 1.62 + rng() * 0.2 : 1.72 + rng() * 0.2, bulk: 0.9 + rng() * 0.35,
    heroClass: pick(Object.keys(HERO_CLASSES)), accent: pick(ACCENT_COLORS),
  };
}

/** Converts a saved appearance into createCharacter options. */
export function appearanceToOptions(a) {
  const ap = { ...defaultAppearance(), ...(a || {}) };
  const accent = ap.accent;
  const base = {
    name: ap.name || 'Hero', sex: ap.sex, skin: ap.skin, eyes: ap.eyes, height: ap.height, bulk: ap.bulk,
    hair: { style: ap.hairStyle, color: ap.hairColor },
    beard: ap.beardStyle && ap.beardStyle !== 'none' ? { style: ap.beardStyle, color: ap.hairColor } : null,
  };
  if (ap.heroClass === 'mage') return { ...PRESETS.seal_mage, ...base, robe: accent, robeTrim: 0xc9a040, hood: null, cloak: { color: new THREE.Color(accent).multiplyScalar(0.6).getHex(), length: 1.15 } };
  if (ap.heroClass === 'ranger') return { ...PRESETS.ranger, ...base, hood: accent, cloak: { color: accent, length: 1.0 } };
  if (ap.heroClass === 'rogue') return { ...PRESETS.bandit, ...base, mask: null, hood: accent, cloak: { color: accent, length: 0.85, tattered: true } };
  return { ...PRESETS.hero, ...base, cloak: { color: accent, length: 1.1 }, shirt: accent, shieldColor: accent };
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

/**
 * @param {string|object} presetOrOptions preset key from PRESETS, or a full options object
 * @param {object} overrides merged over the preset (e.g. { skin: SKIN_TONES[4], cloak: null })
 */
export function createCharacter(presetOrOptions = 'hero', overrides = {}) {
  const base = typeof presetOrOptions === 'string' ? PRESETS[presetOrOptions] : presetOrOptions;
  if (!base) throw new Error('Unknown character preset: ' + presetOrOptions);
  const o = { ...base, ...overrides };
  const H = o.height ?? 1.8;
  const S = H / 1.8;              // height scale
  const B = o.bulk ?? 1;          // width scale
  const fem = o.sex === 'f';

  const root = new THREE.Group();
  root.name = o.name || 'Character';
  const rig = new THREE.Group();          // scaled by height
  rig.scale.setScalar(S);
  root.add(rig);

  const M = {
    skin: skinMat(o.skin ?? SKIN_TONES[1]),
    shirt: fabricMat(o.shirt ?? 0x777777),
    pants: fabricMat(o.pants ?? 0x3a3128, [3, 5]),
    boots: leatherMat(o.boots ?? 0x3a2a1c),
  };

  /* ---- skeleton ---- */
  const hips = joint(rig, [0, 0.98, 0], 'hips');
  const spine = joint(hips, [0, 0.08, 0], 'spine');
  const chest = joint(spine, [0, 0.22, 0], 'chest');
  const neck = joint(chest, [0, 0.24, 0.0], 'neck');
  const head = joint(neck, [0, 0.1, 0.01], 'head');

  const sw = (fem ? 0.17 : 0.195) * B;   // shoulder half width
  const hw = (fem ? 0.115 : 0.1) * B;    // hip half width
  const sides = {};
  for (const side of [1, -1]) {
    const s = side === 1 ? 'L' : 'R';
    const shoulder = joint(chest, [side * sw, 0.19, -0.01], 'shoulder' + s);
    const upperArm = joint(shoulder, [0, 0, 0], 'upperArm' + s);
    const foreArm = joint(upperArm, [0, -0.29, 0], 'foreArm' + s);
    const hand = joint(foreArm, [0, -0.26, 0], 'hand' + s);
    const thigh = joint(hips, [side * hw, -0.04, 0], 'thigh' + s);
    const shin = joint(thigh, [0, -0.45, 0], 'shin' + s);
    const foot = joint(shin, [0, -0.43, 0], 'foot' + s);
    sides[s] = { side, shoulder, upperArm, foreArm, hand, thigh, shin, foot };
  }

  /* ---- body ---- */
  // Pelvis
  mesh(lathe([[0.001, -0.1], [hw + 0.04, -0.07], [hw + 0.065, 0.0], [hw + 0.055, 0.08], [0.001, 0.1]], 28, 0.72), M.pants, hips, [0, 0, 0]);
  // Torso (abdomen + ribcage + shoulders), elliptical cross-section
  const torsoProfile = fem
    ? [[0.001, -0.02], [hw + 0.03, 0.0], [0.105 * B, 0.12], [0.115 * B, 0.24], [0.13 * B, 0.34], [0.135 * B, 0.4], [0.12 * B, 0.47], [0.06, 0.52], [0.001, 0.53]]
    : [[0.001, -0.02], [hw + 0.04, 0.0], [0.13 * B, 0.12], [0.145 * B, 0.26], [0.16 * B, 0.38], [0.155 * B, 0.45], [0.12 * B, 0.5], [0.06, 0.535], [0.001, 0.54]];
  const torsoMat = M.shirt;
  const torso = mesh(lathe(torsoProfile, 32, 0.66), torsoMat, spine, [0, -0.02, 0]);
  if (fem) {
    for (const sx of [1, -1]) mesh(new THREE.SphereGeometry(0.048, 20, 14), torsoMat, chest, [sx * 0.05, 0.11, 0.058], [0, 0, 0], [1, 0.85, 0.62]);
  }
  // Trapezius / shoulder caps
  for (const s of Object.values(sides)) mesh(new THREE.SphereGeometry(0.062 * B, 20, 14), torsoMat, s.shoulder, [0, 0, 0], [0, 0, 0], [1.1, 0.9, 1]);
  // Neck
  mesh(lathe([[0.048, 0], [0.044, 0.06], [0.043, 0.12]], 20), M.skin, neck, [0, -0.02, 0]);

  // Arms
  const sleeveMat = o.sleeves === 'rolled' ? M.skin : M.shirt;
  for (const s of Object.values(sides)) {
    limb(s.upperArm, 0.3, 0.043 * B, 0.052 * B, sleeveMat);
    if (o.sleeves === 'rolled') mesh(new THREE.TorusGeometry(0.052 * B, 0.014, 8, 20), M.shirt, s.upperArm, [0, -0.03, 0], [Math.PI / 2, 0, 0]);
    limb(s.foreArm, 0.27, 0.033 * B, 0.045 * B, o.sleeves === 'rolled' ? M.skin : M.shirt);
    // cuff + hand
    if (o.sleeves !== 'rolled') mesh(new THREE.CylinderGeometry(0.038 * B, 0.036 * B, 0.03, 16), M.skin, s.foreArm, [0, -0.255, 0]);
    buildHand(s.hand, M.skin, s.side, B);
  }

  // Legs
  for (const s of Object.values(sides)) {
    const longSkirt = !!(o.robe || o.dress);
    if (longSkirt) { limb(s.thigh, 0.46, 0.05 * B, 0.07 * B, M.pants).visible = false; } else limb(s.thigh, 0.46, 0.05 * B, (fem ? 0.075 : 0.072) * B, M.pants);
    limb(s.shin, 0.44, 0.038 * B, 0.054 * B, M.pants);
    buildBoot(s.shin, s.foot, M.boots, B);
  }

  /* ---- head ---- */
  buildHead(head, o, M, fem);

  /* ---- clothing & armor layers ---- */
  const attach = { hips, spine, chest, neck, head, sides, B, fem };
  buildOutfit(attach, o, M);

  /* ---- weapons ---- */
  const props = {};
  if (o.weapon) props.weapon = buildWeapon(o.weapon, sides.R.hand, o);
  if (o.offhand === 'shield') props.shield = buildShield(sides.L.foreArm, o.shieldColor ?? 0x553322);
  if (o.offhand === 'bow') props.bow = buildBow(sides.L.hand);
  if (o.quiver || o.offhand === 'bow') buildQuiver(chest, B);

  /* ---- cloak (simulated cloth strip) ---- */
  let cloak = null;
  if (o.cloak) cloak = buildCloak(chest, o.cloak, B);

  root.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });

  /* ---- animation ---- */
  const anim = createAnimator({ hips, spine, chest, neck, head, sides, cloak, props, o });

  return {
    root,
    bones: { hips, spine, chest, neck, head, ...flattenSides(sides) },
    props,
    /** speed in m/s: 0 idle, 1.6 walk, 3.5 jog, 6.5 sprint. turnRate in rad/s (optional, for lean). */
    update: (dt, state = {}) => anim.update(dt, state),
    /** 'strike' | 'cast' | 'block' | 'wave'. Returns duration in seconds. */
    play: (name) => anim.play(name),
    isBusy: () => anim.busy(),
    dispose: () => root.traverse((n) => { if (n.isMesh) { n.geometry.dispose(); } }),
    capsule: { height: H, radius: 0.3 * B * S },
  };
}

function flattenSides(sides) {
  const out = {};
  for (const [s, v] of Object.entries(sides)) for (const k of ['shoulder', 'upperArm', 'foreArm', 'hand', 'thigh', 'shin', 'foot']) out[k + s] = v[k];
  return out;
}

function buildHand(hand, mat, side, B) {
  // palm
  mesh(roundBox(0.072 * B, 0.08, 0.03, 0.012), mat, hand, [0, -0.035, 0]);
  // fingers (curled slightly)
  for (let i = 0; i < 4; i++) {
    const f = joint(hand, [(-0.026 + i * 0.0175) * B, -0.075, 0.004]);
    f.rotation.x = -0.35;
    mesh(new THREE.CapsuleGeometry(0.0075, 0.045 - Math.abs(i - 1.5) * 0.006, 4, 8), mat, f, [0, -0.025, 0]);
  }
  // thumb
  const t = joint(hand, [side * -0.035 * B, -0.03, 0.015]);
  t.rotation.set(-0.5, 0, side * 0.6);
  mesh(new THREE.CapsuleGeometry(0.009, 0.035, 4, 8), mat, t, [0, -0.02, 0]);
}

function roundBox(w, h, d, r) {
  const shape = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  shape.moveTo(x + r, y); shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d - r, bevelEnabled: true, bevelThickness: r / 2, bevelSize: r / 2, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, -(d - r) / 2);
  g.computeVertexNormals();
  return g;
}

function buildBoot(shin, foot, mat, B) {
  // shaft
  mesh(lathe([[0.058 * B, -0.43], [0.052 * B, -0.3], [0.056 * B, -0.2], [0.06 * B, -0.17]], 20), mat, shin);
  mesh(new THREE.TorusGeometry(0.058 * B, 0.01, 8, 20), mat, shin, [0, -0.175, 0], [Math.PI / 2, 0, 0]);
  // foot body: elongated rounded shape
  const g = new THREE.SphereGeometry(1, 24, 16);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < -0.4) y = -0.4 - (y + 0.4) * 0.15;          // flat sole
    if (z > 0) { x *= 1 - z * 0.15; y *= 1 - z * 0.25; } // toe taper
    p.setXYZ(i, x * 0.052 * B, y * 0.06, z * 0.13);
  }
  g.computeVertexNormals();
  mesh(g, mat, foot, [0, -0.025, 0.055]);
  // sole
  mesh(roundBox(0.092 * B, 0.02, 0.26, 0.008), new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.9 }), foot, [0, -0.06, 0.055]);
}

function buildHead(head, o, M, fem) {
  // Cranium + face shaped from a deformed sphere
  const g = new THREE.SphereGeometry(1, 48, 36);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // jaw taper toward chin
    if (y < 0) { const t = -y; x *= 1 - t * (fem ? 0.38 : 0.3); z *= 1 - t * 0.12; if (z > 0) z += t * t * 0.12; }
    // flatten sides at temples, push face forward
    if (z > 0.2 && y > -0.6 && y < 0.3) z += 0.05;
    // eye sockets (subtle)
    for (const sx of [1, -1]) {
      const d = Math.hypot(x - sx * 0.36, y - 0.05, z - 0.92);
      if (d < 0.25) z -= (0.25 - d) * 0.35;
    }
    // brow ridge
    if (z > 0.6 && y > 0.12 && y < 0.3) z += (fem ? 0.02 : 0.05) * (1 - Math.abs(y - 0.21) / 0.09);
    // cheekbones
    for (const sx of [1, -1]) {
      const d = Math.hypot(x - sx * 0.55, y + 0.12, z - 0.7);
      if (d < 0.3) { x += sx * (0.3 - d) * 0.15; z += (0.3 - d) * 0.1; }
    }
    p.setXYZ(i, x * 0.078, y * 0.115, z * 0.1);
  }
  g.computeVertexNormals();
  mesh(g, M.skin, head, [0, 0.03, 0]);

  // Nose
  const ng = new THREE.ConeGeometry(0.017, 0.05, 12, 1);
  ng.rotateX(Math.PI * 0.42);
  mesh(ng, M.skin, head, [0, 0.025, 0.105]);
  mesh(new THREE.SphereGeometry(0.014, 14, 10), M.skin, head, [0, 0.003, 0.113], [0, 0, 0], [1.2, 0.85, 1]);
  // Lips
  const lipMat = M.skin.clone(); lipMat.color = new THREE.Color(o.skin ?? 0xe0ac8a).lerp(new THREE.Color(0xa04a4a), fem ? 0.35 : 0.2);
  mesh(new THREE.CapsuleGeometry(0.008, 0.026, 4, 10), lipMat, head, [0, -0.033, 0.097], [0, 0, Math.PI / 2], [1, 1, 0.7]);
  mesh(new THREE.CapsuleGeometry(0.0085, 0.022, 4, 10), lipMat, head, [0, -0.045, 0.094], [0, 0, Math.PI / 2], [1, 1, 0.7]);
  // Ears
  for (const sx of [1, -1]) mesh(new THREE.SphereGeometry(0.025, 14, 10), M.skin, head, [sx * 0.078, 0.02, 0.0], [0, sx * 0.4, 0], [0.35, 1, 0.7]);

  // Eyes
  const sclera = new THREE.MeshPhysicalMaterial({ color: 0xf2eee6, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
  const irisMat = new THREE.MeshPhysicalMaterial({ color: o.eyes ?? 0x4a6a3a, roughness: 0.3, clearcoat: 1 });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const eyes = [];
  for (const sx of [1, -1]) {
    const eye = joint(head, [sx * 0.031, 0.035, 0.077]);
    mesh(new THREE.SphereGeometry(0.0125, 20, 14), sclera, eye);
    mesh(new THREE.CircleGeometry(0.0065, 20), irisMat, eye, [0, 0, 0.0122]);
    mesh(new THREE.CircleGeometry(0.003, 16), pupilMat, eye, [0, 0, 0.0125]);
    // eyelid (upper) in skin
    mesh(new THREE.SphereGeometry(0.0135, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.38), M.skin, eye, [0, 0.0005, 0], [-0.15, 0, 0]);
    // eyebrow
    mesh(new THREE.CapsuleGeometry(0.0035, 0.028, 4, 8), hairMat(o.hair?.color ?? 0x2a1a10), head, [sx * 0.032, 0.058, 0.09], [0, 0, Math.PI / 2 + sx * 0.12], [1, 1, 0.6]);
    eyes.push(eye);
  }
  head.userData.eyes = eyes;

  // Hair
  const hc = o.hair?.color ?? 0x2a1a10;
  const hm = hairMat(hc);
  const style = o.hair?.style ?? 'short';
  if (style !== 'bald') {
    const cap = new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.58);
    // open the forehead: push front-bottom verts up
    const cp = cap.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      let x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
      if (z > 0.3 && y < 0.55) y = Math.max(y, 0.42 + (1 - z) * 0.1);
      cp.setXYZ(i, x * 0.084, y * 0.12, z * 0.106);
    }
    cap.computeVertexNormals();
    mesh(cap, hm, head, [0, 0.035, -0.004]);
  } else {
    // bald: slight stubble shadow
    const st = M.skin.clone(); st.color = new THREE.Color(o.skin).multiplyScalar(0.92);
  }
  if (style === 'long' || style === 'braid' || style === 'ponytail') {
    if (style === 'long') {
      const back = lathe([[0.075, 0.06], [0.082, 0.0], [0.08, -0.08], [0.075, -0.16], [0.062, -0.22]], 28, 0.85);
      // keep only the back half by scaling front verts in
      const bp = back.attributes.position;
      for (let i = 0; i < bp.count; i++) if (bp.getZ(i) > 0.01) bp.setZ(i, bp.getZ(i) * 0.15);
      back.computeVertexNormals();
      mesh(back, hm, head, [0, 0.0, -0.022]);
    }
    if (style === 'braid' || style === 'ponytail') {
      const tail = joint(head, [0, 0.03, -0.1], 'hairTail');
      tail.rotation.x = 0.25;
      const n = style === 'braid' ? 7 : 5;
      for (let i = 0; i < n; i++) {
        const r = style === 'braid' ? 0.022 - i * 0.0018 : 0.026 - i * 0.003;
        mesh(new THREE.SphereGeometry(r, 14, 10), hm, tail, [0, -0.03 - i * 0.04, 0], [0, 0, 0], [1, 1.4, 1]);
      }
      head.userData.tail = tail;
    }
  }
  // Beard
  const bs = o.beard?.style;
  if (bs) {
    const bm = hairMat(o.beard.color ?? hc);
    if (bs === 'stubble') {
      const sm = new THREE.MeshStandardMaterial({ color: o.beard.color, roughness: 1, transparent: true, opacity: 0.35, map: tex('hair', [6, 6]) });
      const sg = new THREE.SphereGeometry(0.081, 32, 16, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.52, Math.PI * 0.3);
      mesh(sg, sm, head, [0, 0.005, 0.012], [0, 0, 0], [0.98, 1.4, 1.2]);
    } else {
      const len = bs === 'long' ? 0.16 : bs === 'braided' ? 0.13 : bs === 'goatee' ? 0.04 : 0.06;
      const wide = bs === 'goatee' ? 0.35 : 1;
      const bg = lathe([[0.001, -len], [0.03 * wide, -len * 0.7], [0.055 * wide, -len * 0.3], [0.068 * wide, 0], [0.07 * wide, 0.04]], 24, 0.7);
      const bp = bg.attributes.position;
      for (let i = 0; i < bp.count; i++) if (bp.getZ(i) < 0) bp.setZ(i, bp.getZ(i) * 0.3);
      bg.computeVertexNormals();
      mesh(bg, bm, head, [0, -0.04, 0.045]);
      if (bs === 'braided') for (const sx of [1, -1]) for (let i = 0; i < 3; i++) mesh(new THREE.SphereGeometry(0.012, 10, 8), bm, head, [sx * 0.02, -0.18 - i * 0.025, 0.07], [0, 0, 0], [1, 1.4, 1]);
      // mustache
      mesh(new THREE.CapsuleGeometry(0.009, 0.05, 4, 10), bm, head, [0, -0.022, 0.1], [0, 0, Math.PI / 2], [1, 1, 0.8]);
    }
  }
}

function buildOutfit(a, o, M) {
  const { hips, spine, chest, head, sides, B, fem } = a;

  // Belt
  if (o.belt) {
    const bm = leatherMat(o.belt, [8, 1]);
    mesh(new THREE.TorusGeometry(1, 0.08, 10, 40), bm, hips, [0, 0.06, 0], [Math.PI / 2, 0, 0], [(a.fem ? 0.135 : 0.15) * B, 0.105 * B, 0.18]);
    mesh(roundBox(0.045, 0.04, 0.012, 0.004), metalMat(0xc9a040), hips, [0, 0.06, 0.112 * B]);
    // pouch
    mesh(roundBox(0.06, 0.07, 0.04, 0.012), bm, hips, [0.12 * B, 0.0, 0.06 * B], [0, 0.7, 0]);
  }

  // Robe (long, mage)
  if (o.robe) {
    const rm = fabricMat(o.robe, [4, 6]);
    const robeG = lathe([[0.12 * B, 0.52], [0.16 * B, 0.36], [0.155 * B, 0.12], [0.16 * B, 0.0], [0.2 * B, -0.3], [0.26 * B, -0.6], [0.3 * B, -0.86], [0.305 * B, -0.9]], 36, 0.8);
    mesh(robeG, rm, spine, [0, -0.04, 0]);
    // trim at hem
    mesh(new THREE.TorusGeometry(1, 0.03, 8, 48), fabricMat(o.robeTrim ?? 0x553311), spine, [0, -0.93, 0], [Math.PI / 2, 0, 0], [0.305 * B, 0.244 * B, 0.6]);
    // wide sleeves
    for (const s of Object.values(sides)) {
      mesh(lathe([[0.06 * B, 0], [0.065 * B, -0.15], [0.08 * B, -0.3]], 20), rm, s.upperArm);
      mesh(lathe([[0.075 * B, 0], [0.1 * B, -0.14], [0.12 * B, -0.24]], 20), rm, s.foreArm);
    }
  }
  if (o.hood) {
    const hm = fabricMat(o.hood, [3, 3]);
    const hg = new THREE.SphereGeometry(1, 36, 24, Math.PI * 0.72, Math.PI * 1.56, 0, Math.PI * 0.72);
    mesh(hg, hm, head, [0, 0.035, -0.008], [0, 0, 0], [0.098, 0.135, 0.12]);
    // drape onto shoulders
    mesh(lathe([[0.1, 0.06], [0.14 * B, -0.02], [0.2 * B, -0.12], [0.22 * B, -0.16]], 32, 0.75), hm, chest, [0, 0.36, 0]);
  }
  if (o.mask) {
    const mm = fabricMat(o.mask, [4, 4]);
    mesh(new THREE.SphereGeometry(1, 28, 16, Math.PI * 0.05, Math.PI * 0.9, Math.PI * 0.5, Math.PI * 0.32), mm, head, [0, 0.02, 0.008], [0, 0, 0], [0.084, 0.13, 0.112]);
  }

  // Dress (villager) + apron
  if (o.dress) {
    const dm = fabricMat(o.dress, [4, 6]);
    mesh(lathe([[0.135 * B, 0.3], [0.125 * B, 0.12], [0.14 * B, 0.02], [0.19 * B, -0.25], [0.24 * B, -0.55], [0.27 * B, -0.78]], 36, 0.78), dm, spine, [0, -0.02, 0]);
    // bodice laces
    for (let i = 0; i < 4; i++) mesh(new THREE.BoxGeometry(0.05, 0.004, 0.004), leatherMat(0x2a1a10), chest, [0, -0.02 - i * 0.04, 0.105]);
  }
  if (o.apron) {
    const ag = new THREE.PlaneGeometry(0.24 * B, 0.55, 6, 10);
    const ap = ag.attributes.position;
    for (let i = 0; i < ap.count; i++) { const x = ap.getX(i), y = ap.getY(i); ap.setZ(i, -Math.pow(x / (0.12 * B), 2) * 0.03 + (0.27 - y) * 0.12); }
    ag.computeVertexNormals();
    mesh(ag, fabricMat(o.apron), hips, [0, -0.2, 0.135 * B]);
  }
  if (o.leatherApron) {
    const ag = new THREE.PlaneGeometry(0.3 * B, 0.85, 6, 12);
    const ap = ag.attributes.position;
    for (let i = 0; i < ap.count; i++) { const x = ap.getX(i), y = ap.getY(i); ap.setZ(i, -Math.pow(x / (0.15 * B), 2) * 0.05 + Math.max(0, y - 0.2) * -0.05 + Math.max(0, -y) * 0.12); }
    ag.computeVertexNormals();
    mesh(ag, leatherMat(o.leatherApron, [2, 3]), spine, [0, 0.06, 0.12 * B]);
  }
  if (o.vest) {
    const vm = fabricMat(o.vest, [4, 4]);
    vm.sheen = 1; vm.sheenColor = new THREE.Color(0xffe0a0);
    mesh(lathe([[0.135 * B, 0.0], [0.152 * B, 0.12], [0.165 * B, 0.27], [0.168 * B, 0.39], [0.13 * B, 0.48]], 32, 0.7), vm, spine, [0, -0.01, 0]);
    for (let i = 0; i < 4; i++) mesh(new THREE.SphereGeometry(0.008, 10, 8), metalMat(0xd4af37), spine, [0, 0.05 + i * 0.08, 0.118 * B]);
  }
  if (o.hat) {
    const hm = fabricMat(o.hat, [3, 3]);
    mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.012, 40), hm, head, [0, 0.12, -0.005]);
    mesh(lathe([[0.085, 0], [0.09, 0.06], [0.08, 0.1], [0.001, 0.115]], 32), hm, head, [0, 0.12, -0.005]);
    mesh(new THREE.TorusGeometry(0.089, 0.008, 6, 32), fabricMat(0xb08a2a), head, [0, 0.135, -0.005], [Math.PI / 2, 0, 0]);
  }

  // Chainmail layer
  if (o.chain) {
    const cm = chainMat();
    mesh(lathe([[0.15 * B, 0.44], [0.165 * B, 0.34], [0.155 * B, 0.18], [0.14 * B, 0.04], [0.17 * B, -0.12], [0.19 * B, -0.28]], 32, 0.7), cm, spine, [0, -0.02, 0]);
    for (const s of Object.values(sides)) mesh(lathe([[0.06 * B, 0], [0.058 * B, -0.12], [0.056 * B, -0.2]], 16), cm, s.upperArm);
  }
  // Leather armor
  if (o.leatherArmor) {
    const lm = leatherMat(o.leatherArmor, [2, 3]);
    mesh(lathe([[0.135 * B, -0.02], [0.152 * B, 0.12], [0.168 * B, 0.27], [0.172 * B, 0.39], [0.135 * B, 0.48], [0.07, 0.52]], 32, 0.7), lm, spine, [0, -0.01, 0]);
    // tassets
    for (const sx of [-1, 0, 1]) {
      const t = new THREE.PlaneGeometry(0.11, 0.2, 2, 4);
      const tp = t.attributes.position;
      for (let i = 0; i < tp.count; i++) tp.setZ(i, -Math.abs(tp.getX(i)) * 0.3);
      mesh(t, lm, hips, [sx * 0.1 * B, -0.12, 0.125 * B - Math.abs(sx) * 0.03], [0.12, sx * 0.5, 0]);
    }
    // studs
    for (let i = 0; i < 10; i++) mesh(new THREE.SphereGeometry(0.006, 8, 6), metalMat(0x8a8a80), spine, [((i % 5) - 2) * 0.05 * B, 0.12 + Math.floor(i / 5) * 0.14, 0.125 * B]);
  }
  // Steel plate cuirass
  if (o.chestPlate) {
    const pm = metalMat(o.chestPlate);
    const cg = lathe([[0.14 * B, 0.0], [0.158 * B, 0.12], [0.176 * B, 0.27], [0.178 * B, 0.38], [0.14 * B, 0.47], [0.075, 0.51]], 40, 0.72);
    mesh(cg, pm, spine, [0, 0.02, 0.006]);
    // center ridge + rolled neck edge
    mesh(new THREE.CapsuleGeometry(0.006, 0.3, 4, 8), pm, spine, [0, 0.27, 0.128 * B]);
    mesh(new THREE.TorusGeometry(0.075, 0.009, 8, 28, Math.PI), pm, spine, [0, 0.5, 0.01], [-Math.PI / 2 + 0.2, 0, 0]);
    // fauld bands
    for (let i = 0; i < 2; i++) mesh(new THREE.TorusGeometry(1, 0.06, 6, 40), pm, hips, [0, 0.0 - i * 0.055, 0], [Math.PI / 2, 0, 0], [(0.155 + i * 0.01) * B, 0.114 * B, 0.45]);
  }
  if (o.tabard) {
    const tm = fabricMat(o.tabard, [2, 4]);
    for (const z of [1, -1]) {
      const tg = new THREE.PlaneGeometry(0.22 * B, 0.8, 4, 10);
      const tp = tg.attributes.position;
      for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setZ(i, z * (y > 0.15 ? 0 : (0.15 - y) * 0.05)); }
      tg.computeVertexNormals();
      mesh(tg, tm, spine, [0, 0.0, z * 0.135 * B], [0, z > 0 ? 0 : Math.PI, 0]);
    }
    // emblem: a gold four-point seal
    const sh = new THREE.Shape(); const r = 0.045;
    for (let i = 0; i < 8; i++) { const ang = (i / 8) * Math.PI * 2 + Math.PI / 2; const rr = i % 2 ? r * 0.35 : r; i ? sh.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr) : sh.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr); }
    mesh(new THREE.ShapeGeometry(sh), metalMat(0xd4a640), spine, [0, 0.25, 0.137 * B + 0.002]);
  }
  if (o.pauldrons) {
    const pm = metalMat(o.pauldrons);
    for (const s of Object.values(sides)) {
      for (let i = 0; i < 3; i++) {
        mesh(new THREE.SphereGeometry(0.085 * B - i * 0.008, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), pm, s.upperArm, [s.side * 0.01, 0.03 - i * 0.045, 0], [0, 0, s.side * -0.35], [1, 0.75, 1.05]);
      }
    }
  }
  if (o.gauntlets) {
    const isMetal = o.gauntlets === o.chestPlate || o.gauntlets === o.pauldrons || o.gauntlets === 0x9aa0a6;
    const gm = isMetal ? metalMat(o.gauntlets) : leatherMat(o.gauntlets);
    for (const s of Object.values(sides)) {
      mesh(lathe([[0.05 * B, -0.06], [0.046 * B, -0.16], [0.042 * B, -0.24], [0.046 * B, -0.27]], 20), gm, s.foreArm);
      const glove = gm.clone(); glove.color = new THREE.Color(isMetal ? 0x3a2a1c : o.gauntlets);
      s.hand.traverse((n) => { if (n.isMesh) n.material = isMetal ? leatherMat(0x3a2a1c) : glove; });
    }
  }
  if (o.greaves) {
    const gm = metalMat(o.greaves);
    for (const s of Object.values(sides)) {
      mesh(lathe([[0.06 * B, -0.06], [0.064 * B, -0.18], [0.056 * B, -0.32]], 24, 1), gm, s.shin);
      mesh(new THREE.SphereGeometry(0.05 * B, 16, 12), gm, s.shin, [0, 0, 0.025], [0, 0, 0], [1, 1.1, 0.8]);
    }
  }
  if (o.furMantle) {
    const fm = furMat(o.furMantle);
    mesh(lathe([[0.075, 0.08], [0.13 * B, 0.03], [0.19 * B, -0.03], [0.2 * B, -0.09], [0.18 * B, -0.12]], 36, 0.74), fm, chest, [0, 0.29, -0.005]);
    mesh(new THREE.TorusGeometry(0.105 * B, 0.035, 10, 36), fm, chest, [0, 0.28, 0], [Math.PI / 2, 0, 0], [1, 0.8, 1]);
  }
  if (o.crown) {
    const cm = metalMat(o.crown);
    mesh(new THREE.TorusGeometry(0.087, 0.008, 8, 40), cm, head, [0, 0.1, -0.005], [Math.PI / 2 - 0.1, 0, 0], [1, 1.15, 1]);
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      mesh(new THREE.ConeGeometry(0.009, 0.035, 4), cm, head, [Math.sin(ang) * 0.087, 0.12, Math.cos(ang) * 0.1 - 0.005]);
    }
    mesh(new THREE.OctahedronGeometry(0.012), glowMat(0x6fd3ff, 1.5), head, [0, 0.105, 0.107]);
  }
  if (o.helmet) {
    const hm = metalMat(o.chestPlate ?? 0x9aa0a6);
    mesh(new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.55), hm, head, [0, 0.03, -0.003], [0, 0, 0], [0.092, 0.135, 0.115]);
    mesh(new THREE.TorusGeometry(1, 0.08, 8, 40), hm, head, [0, 0.03, -0.003], [Math.PI / 2, 0, 0], [0.092, 0.115, 0.14]);
    mesh(new THREE.BoxGeometry(0.012, 0.075, 0.01), hm, head, [0, 0.0, 0.115]);
    mesh(new THREE.CapsuleGeometry(0.005, 0.16, 4, 8), hm, head, [0, 0.13, 0.0], [Math.PI / 2, 0, 0]);
    // aventail (chain at neck)
    mesh(lathe([[0.09, 0.0], [0.1, -0.06], [0.13, -0.12]], 28, 0.85), chainMat(), head, [0, -0.0, -0.01]).scale.z = 0.85;
  }
}

function buildWeapon(type, hand, o) {
  const grip = joint(hand, [0, -0.07, 0.01], 'weaponGrip');
  // weapons point forward/up from the fist: local +Y along blade, held in grip
  grip.rotation.x = (type === 'staff' || type === 'spear') ? Math.PI / 2 : 2.25;
  const steel = metalMat(0xc8ccd2, [1, 4]);
  const leather = leatherMat(0x2a1a10, [1, 4]);
  const gold = metalMat(0xc9a040);
  const g = new THREE.Group(); grip.add(g);
  if (type === 'sword') {
    mesh(new THREE.CylinderGeometry(0.014, 0.015, 0.16, 12), leather, g, [0, 0.0, 0]);
    mesh(new THREE.SphereGeometry(0.022, 14, 10), gold, g, [0, -0.095, 0]);
    mesh(roundBox(0.2, 0.026, 0.026, 0.008), gold, g, [0, 0.09, 0]);
    const blade = new THREE.Shape();
    blade.moveTo(-0.025, 0); blade.lineTo(0.025, 0); blade.lineTo(0.02, 0.7); blade.lineTo(0, 0.8); blade.lineTo(-0.02, 0.7); blade.closePath();
    const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2 });
    bg.translate(0, 0, -0.002);
    mesh(bg, steel, g, [0, 0.1, 0]);
  } else if (type === 'dagger') {
    mesh(new THREE.CylinderGeometry(0.013, 0.014, 0.1, 10), leather, g);
    mesh(roundBox(0.09, 0.018, 0.02, 0.006), metalMat(0x6a6a6a), g, [0, 0.055, 0]);
    const blade = new THREE.Shape();
    blade.moveTo(-0.018, 0); blade.lineTo(0.018, 0); blade.quadraticCurveTo(0.02, 0.18, 0, 0.27); blade.quadraticCurveTo(-0.01, 0.15, -0.018, 0);
    const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2 });
    mesh(bg, steel, g, [0, 0.062, -0.0015]);
  } else if (type === 'staff') {
    const wood = woodMat(0x4a2e18);
    const sg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0, -0.75, 0], [0.01, -0.3, 0.005], [-0.008, 0.2, 0], [0.012, 0.6, -0.005], [0.0, 0.9, 0]].map((v) => new THREE.Vector3(...v))), 40, 0.018, 10);
    mesh(sg, wood, g);
    // claw holding the crystal
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2;
      const c = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.88, 0), new THREE.Vector3(Math.cos(ang) * 0.07, 0.95, Math.sin(ang) * 0.07), new THREE.Vector3(Math.cos(ang) * 0.025, 1.06, Math.sin(ang) * 0.025)), 10, 0.007, 6);
      mesh(c, wood, g);
    }
    const crystal = mesh(new THREE.OctahedronGeometry(0.05, 0), glowMat(o.staffGlow ?? 0xffd66b, 2.5), g, [0, 0.98, 0], [0, 0, 0], [1, 1.6, 1]);
    const light = new THREE.PointLight(o.staffGlow ?? 0xffd66b, 1.2, 4, 2);
    light.position.set(0, 0.98, 0); g.add(light);
    g.userData.crystal = crystal; g.userData.light = light;
  } else if (type === 'hammer') {
    mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.5, 10), woodMat(), g, [0, 0.12, 0]);
    mesh(roundBox(0.16, 0.08, 0.08, 0.012), metalMat(0x3a3a3a), g, [0, 0.38, 0]);
  } else if (type === 'axe') {
    mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.62, 10), woodMat(), g, [0, 0.18, 0]);
    const head = new THREE.Shape();
    head.moveTo(0, -0.03); head.lineTo(0.06, -0.06); head.quadraticCurveTo(0.14, 0.0, 0.06, 0.08); head.lineTo(0, 0.04); head.closePath();
    const hg = new THREE.ExtrudeGeometry(head, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
    hg.translate(0, 0, -0.006); hg.rotateY(Math.PI / 2);
    mesh(hg, steel, g, [0, 0.43, 0]);
  } else if (type === 'spear') {
    mesh(new THREE.CylinderGeometry(0.014, 0.016, 2.0, 10), woodMat(), g, [0, 0.35, 0]);
    mesh(new THREE.ConeGeometry(0.03, 0.22, 4), steel, g, [0, 1.46, 0], [0, Math.PI / 4, 0], [1, 1, 0.35]);
  }
  return g;
}

function buildBow(hand) {
  const g = joint(hand, [0, -0.06, 0.01], 'bow');
  const wood = woodMat(0x5a3418);
  const pts = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24 - 0.5; pts.push(new THREE.Vector3(0, t * 1.5, 0.12 * Math.cos(t * Math.PI) - 0.02 * Math.cos(t * Math.PI * 3))); }
  const curve = new THREE.CatmullRomCurve3(pts);
  const limbGeo = new THREE.TubeGeometry(curve, 48, 0.014, 8);
  limbGeo.computeVertexNormals();
  mesh(limbGeo, wood, g);
  mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 10), leatherMat(0x2a1a10), g, [0, 0, 0.12]);
  const str = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.74, 0.0), new THREE.Vector3(0, 0.74, 0.0)]);
  const line = new THREE.Line(str, new THREE.LineBasicMaterial({ color: 0xd8d0b8 }));
  g.add(line);
  g.rotation.set(0, Math.PI / 2, 0.15);
  g.userData.string = line;
  return g;
}

function buildQuiver(chest, B) {
  const q = joint(chest, [0.06, 0.12, -0.14 * B], 'quiver');
  q.rotation.set(0.1, 0, -0.45);
  const lm = leatherMat(0x4a2f1c, [1, 3]);
  mesh(new THREE.CylinderGeometry(0.05, 0.042, 0.5, 14, 1, true), lm, q);
  mesh(new THREE.CircleGeometry(0.042, 14), lm, q, [0, -0.25, 0], [Math.PI / 2, 0, 0]);
  const shaft = woodMat(0x8a6a3a);
  const fletch = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.8, side: THREE.DoubleSide });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, r = 0.022;
    const ax = Math.cos(a) * r, az = Math.sin(a) * r;
    mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.62, 5), shaft, q, [ax, 0.1, az]);
    for (let f = 0; f < 3; f++) mesh(new THREE.PlaneGeometry(0.012, 0.07), fletch, q, [ax, 0.38, az], [0, (f / 3) * Math.PI, 0]);
  }
}

function buildShield(foreArm, color) {
  const s = joint(foreArm, [0.06, -0.15, 0], 'shield');
  s.rotation.set(0, Math.PI / 2, 0);
  const wood = woodMat(0x6a4a2a);
  const face = new THREE.MeshStandardMaterial({ color, roughness: 0.75, map: tex('leather', [2, 2]), bumpMap: tex('wood', [2, 2]), bumpScale: 1 });
  const disk = new THREE.CylinderGeometry(0.33, 0.33, 0.03, 48);
  disk.rotateX(Math.PI / 2);
  mesh(disk, face, s, [0, 0, 0.03]);
  mesh(new THREE.TorusGeometry(0.33, 0.016, 10, 56), metalMat(0x7a7a7a), s, [0, 0, 0.03]);
  mesh(new THREE.SphereGeometry(0.08, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), metalMat(0xa0a4aa), s, [0, 0, 0.045], [Math.PI / 2, 0, 0], [1, 0.6, 1]);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; mesh(new THREE.SphereGeometry(0.01, 8, 6), metalMat(0xa0a4aa), s, [Math.cos(a) * 0.29, Math.sin(a) * 0.29, 0.046]); }
  return s;
}

function buildCloak(chest, opts, B) {
  const len = opts.length ?? 1.1;
  const W = 0.5 * B, cols = 10, rows = 16;
  const geo = new THREE.PlaneGeometry(W, len, cols, rows);
  geo.translate(0, -len / 2, 0);
  const rest = geo.attributes.position.array.slice();
  if (opts.tattered) {
    // ragged hem: pull bottom row verts up randomly
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < -len * 0.9) rest[i * 3 + 1] += hash(i, 3, 9) * 0.12;
  }
  const mat = fabricMat(opts.color, [3, 5]);
  const m = mesh(geo, mat, chest, [0, 0.4, -0.12 * B]);
  m.frustumCulled = false;
  return { mesh: m, rest, len, W, t: 0 };
}

/* ------------------------------------------------------------------ */
/* Animation                                                           */
/* ------------------------------------------------------------------ */

const ACTIONS = { strike: 0.55, cast: 0.8, block: 0.6, wave: 1.4 };

function createAnimator(r) {
  const { hips, spine, chest, neck, head, sides, cloak, props, o } = r;
  const L = sides.L, R = sides.R;
  let phase = 0, t = 0, sp = 0, lean = 0;
  let action = null, actT = 0;
  let wC = 0, wS = 0, wB = 0, wA = 0;
  const hipsY = hips.position.y;
  const seed = Math.random() * 100;

  const ease = (x) => x * x * (3 - 2 * x);
  const env = (x, a, b) => (x < a ? ease(x / a) : x > 1 - b ? ease((1 - x) / b) : 1);

  function update(dt, state) {
    dt = Math.min(dt, 0.05);
    t += dt;
    const target = Math.max(0, state.speed ?? 0);
    sp += (target - sp) * Math.min(1, dt * 6);                 // smooth speed
    const turn = state.turnRate ?? 0;
    lean += (turn * Math.min(sp, 6) * 0.02 - lean) * Math.min(1, dt * 5);

    // gait weights
    const walk = Math.min(1, sp / 1.6);
    const run = THREE.MathUtils.clamp((sp - 2.2) / 3.5, 0, 1);  // 0 at walk, 1 at sprint
    // cadence: steps per second ~ 1.8 walking, 2.9 sprinting (one cycle = 2 steps)
    const cadence = sp < 0.05 ? 0 : (0.9 + run * 0.55) * Math.max(0.6, walk);
    phase += dt * cadence * Math.PI * 2;
    const s = Math.sin(phase), c = Math.cos(phase);

    // Legs
    const legA = walk * (0.42 + run * 0.4) * (o.robe || o.dress ? 0.6 : 1);
    for (const [leg, dir] of [[L, 1], [R, -1]]) {
      const ls = s * dir, lc = c * dir;
      leg.thigh.rotation.x = -ls * legA - run * 0.15;
      // knee: bends during forward swing, more when running
      const swing = Math.max(0, lc);
      leg.shin.rotation.x = walk * (0.08 + swing * (0.55 + run * 1.1)) + (1 - walk) * 0.03;
      leg.foot.rotation.x = -leg.thigh.rotation.x * 0.35 - leg.shin.rotation.x * 0.55 + walk * ls * 0.15;
      leg.thigh.rotation.z = dir * -0.02;
    }

    // Hips & spine
    const bob = walk * (0.025 + run * 0.03);
    hips.position.y = hipsY - Math.abs(c) * bob + bob * 0.5 - run * 0.04 + (1 - walk) * Math.sin(t * 1.6 + seed) * 0.003;
    hips.rotation.y = s * walk * (0.12 + run * 0.06);
    hips.rotation.z = c * walk * 0.04 + lean;
    spine.rotation.x = run * 0.22 + walk * 0.04;
    spine.rotation.y = -s * walk * (0.1 + run * 0.12);
    // breathing
    const breath = Math.sin(t * (1.6 + run * 2.4) + seed);
    chest.scale.set(1 + breath * 0.008, 1 + breath * 0.006, 1 + breath * 0.012);
    chest.rotation.x = -breath * 0.015;
    // head stabilizes against body motion
    neck.rotation.x = -spine.rotation.x * 0.7;
    neck.rotation.y = -spine.rotation.y * 0.6 - hips.rotation.y * 0.8;
    head.rotation.y = Math.sin(t * 0.37 + seed) * 0.12 * (1 - walk);
    head.rotation.x = Math.sin(t * 0.23 + seed) * 0.04 * (1 - walk);

    // Arms
    const armA = walk * (0.32 + run * 0.55);
    for (const [arm, dir] of [[L, 1], [R, -1]]) {
      arm.upperArm.rotation.x = s * dir * armA + run * 0.12;
      arm.upperArm.rotation.z = dir * (0.1 + run * 0.08);
      arm.foreArm.rotation.x = -(0.15 + walk * 0.2 + run * 0.95) - Math.max(0, -s * dir) * run * 0.35;
      arm.hand.rotation.x = 0;
    }
    if (props.shield) { L.upperArm.rotation.x = -0.25 + s * armA * 0.4; L.foreArm.rotation.x = -1.2; L.upperArm.rotation.z = 0.25; }
    if (props.bow) { L.upperArm.rotation.x = -0.1 + s * armA * 0.35; L.foreArm.rotation.x = -0.55; L.upperArm.rotation.z = 0.12; }
    if (props.weapon && o.weapon === 'staff') { R.upperArm.rotation.x = -0.15 + s * armA * 0.3; R.foreArm.rotation.x = -0.9; R.upperArm.rotation.z = -0.15; }
    if (props.weapon && o.weapon === 'spear') { R.upperArm.rotation.x = -0.1 + s * armA * 0.3; R.foreArm.rotation.x = -1.0; }

    // Hair tail sway
    if (head.userData.tail) head.userData.tail.rotation.x = 0.25 + spine.rotation.x * 0.5 + c * walk * 0.1;
    // Blink
    const blink = ((t + seed) % 4.2) < 0.12 ? 0.1 : 1;
    for (const e of head.userData.eyes ?? []) e.scale.y = blink;

    // Staff crystal pulse
    if (props.weapon?.userData.crystal) {
      const pulse = 2.2 + Math.sin(t * 2.2) * 0.6;
      props.weapon.userData.crystal.material.emissiveIntensity = pulse;
      props.weapon.userData.crystal.rotation.y += dt * 0.8;
      props.weapon.userData.light.intensity = 0.9 + Math.sin(t * 2.2) * 0.25;
    }

    // Movement states (smoothed weights): crouch, swim, block, airborne
    const k = Math.min(1, dt * 8);
    wC += ((state.crouching ? 1 : 0) - wC) * k;
    wS += ((state.swimming ? 1 : 0) - wS) * Math.min(1, dt * 4);
    wB += ((state.blocking ? 1 : 0) - wB) * Math.min(1, dt * 14);
    wA += ((state.airborne ? 1 : 0) - wA) * k;
    if (wC > 0.001) {
      hips.position.y -= wC * 0.24;
      spine.rotation.x += wC * 0.35;
      neck.rotation.x -= wC * 0.25;
      for (const leg of [L, R]) { leg.thigh.rotation.x -= wC * 1.0; leg.shin.rotation.x += wC * 1.5; leg.foot.rotation.x -= wC * 0.5; }
    }
    if (wA > 0.001 && wS < 0.5) {
      L.thigh.rotation.x -= wA * 0.7; L.shin.rotation.x += wA * 1.1;
      R.thigh.rotation.x -= wA * 0.2; R.shin.rotation.x += wA * 0.5;
      for (const arm of [L, R]) arm.upperArm.rotation.z += (arm.side) * wA * 0.4;
    }
    if (wS > 0.001) {
      const st = t * (sp > 0.3 ? 4.5 : 2);
      hips.rotation.x = THREE.MathUtils.lerp(hips.rotation.x, sp > 0.3 ? 1.25 : 0.25, wS);
      hips.position.y = THREE.MathUtils.lerp(hips.position.y, hipsY - 0.15, wS);
      spine.rotation.x = THREE.MathUtils.lerp(spine.rotation.x, 0, wS);
      neck.rotation.x = THREE.MathUtils.lerp(neck.rotation.x, sp > 0.3 ? -1.0 : -0.2, wS);
      for (const [arm, dir] of [[L, 1], [R, -1]]) {
        const ph = st + (dir > 0 ? 0 : Math.PI);
        arm.upperArm.rotation.x = THREE.MathUtils.lerp(arm.upperArm.rotation.x, sp > 0.3 ? -Math.PI * 0.5 + Math.sin(ph) * 1.6 : Math.sin(ph) * 0.5 - 0.3, wS);
        arm.upperArm.rotation.z = THREE.MathUtils.lerp(arm.upperArm.rotation.z, dir * (0.3 + Math.cos(ph) * 0.3), wS);
        arm.foreArm.rotation.x = THREE.MathUtils.lerp(arm.foreArm.rotation.x, -0.3 - Math.max(0, Math.cos(ph)) * 0.6, wS);
      }
      for (const [leg, dir] of [[L, 1], [R, -1]]) {
        leg.thigh.rotation.x = THREE.MathUtils.lerp(leg.thigh.rotation.x, Math.sin(t * 9) * dir * 0.35, wS);
        leg.shin.rotation.x = THREE.MathUtils.lerp(leg.shin.rotation.x, 0.25 + Math.max(0, Math.sin(t * 9) * dir) * 0.35, wS);
        leg.foot.rotation.x = THREE.MathUtils.lerp(leg.foot.rotation.x, 0.9, wS);
      }
    }
    if (wB > 0.001) {
      L.upperArm.rotation.x = THREE.MathUtils.lerp(L.upperArm.rotation.x, -1.25, wB);
      L.upperArm.rotation.z = THREE.MathUtils.lerp(L.upperArm.rotation.z, -0.35, wB);
      L.foreArm.rotation.x = THREE.MathUtils.lerp(L.foreArm.rotation.x, -1.45, wB);
      spine.rotation.x += wB * 0.12;
      for (const leg of [L, R]) { leg.thigh.rotation.x -= wB * 0.15; leg.shin.rotation.x += wB * 0.3; }
      hips.position.y -= wB * 0.04;
    }

    // Actions (layered over the gait on the upper body)
    if (action) {
      actT += dt;
      const dur = ACTIONS[action];
      const k = Math.min(1, actT / dur);
      applyAction(action, k);
      if (actT >= dur) action = null;
    }

    if (cloak) updateCloak(cloak, dt, sp, run, s);
  }

  function applyAction(name, k) {
    if (name === 'strike') {
      // wind-up (0-0.35) then fast diagonal slash (0.35-0.6) then recover
      const up = k < 0.35 ? ease(k / 0.35) : 1;
      const sw = k < 0.35 ? 0 : k < 0.6 ? ease((k - 0.35) / 0.25) : 1;
      const rec = k > 0.6 ? ease((k - 0.6) / 0.4) : 0;
      const w = 1 - rec;
      R.upperArm.rotation.x = THREE.MathUtils.lerp(R.upperArm.rotation.x, -2.6 * up + 3.0 * sw, w);
      R.upperArm.rotation.z = THREE.MathUtils.lerp(R.upperArm.rotation.z, -0.6 * up + 0.9 * sw, w);
      R.foreArm.rotation.x = THREE.MathUtils.lerp(R.foreArm.rotation.x, -1.2 * up + 1.0 * sw, w);
      spine.rotation.y += w * (-0.5 * up + 1.0 * sw);
      spine.rotation.x += w * 0.15 * sw;
    } else if (name === 'cast') {
      const w = env(k, 0.3, 0.3);
      for (const [arm, dir] of [[L, 1], [R, -1]]) {
        arm.upperArm.rotation.x = THREE.MathUtils.lerp(arm.upperArm.rotation.x, -1.45, w);
        arm.upperArm.rotation.z = THREE.MathUtils.lerp(arm.upperArm.rotation.z, dir * -0.25, w);
        arm.foreArm.rotation.x = THREE.MathUtils.lerp(arm.foreArm.rotation.x, -0.15, w);
      }
      spine.rotation.x -= w * 0.1;
      if (props.weapon?.userData.crystal) {
        props.weapon.userData.crystal.material.emissiveIntensity += w * 6;
        props.weapon.userData.light.intensity += w * 4;
      }
    } else if (name === 'block') {
      const w = env(k, 0.2, 0.3);
      L.upperArm.rotation.x = THREE.MathUtils.lerp(L.upperArm.rotation.x, -1.3, w);
      L.upperArm.rotation.z = THREE.MathUtils.lerp(L.upperArm.rotation.z, -0.3, w);
      L.foreArm.rotation.x = THREE.MathUtils.lerp(L.foreArm.rotation.x, -1.5, w);
      spine.rotation.x += w * 0.1;
    } else if (name === 'wave') {
      const w = env(k, 0.2, 0.2);
      R.upperArm.rotation.x = THREE.MathUtils.lerp(R.upperArm.rotation.x, -0.4, w);
      R.upperArm.rotation.z = THREE.MathUtils.lerp(R.upperArm.rotation.z, -2.5, w);
      R.foreArm.rotation.z = w * Math.sin(k * Math.PI * 6) * 0.5;
      R.foreArm.rotation.x = THREE.MathUtils.lerp(R.foreArm.rotation.x, -0.3, w);
    }
  }

  return {
    update,
    play(name) { if (!ACTIONS[name]) return 0; action = name; actT = 0; return ACTIONS[name]; },
    busy: () => !!action,
  };
}

function updateCloak(cl, dt, speed, run, s) {
  cl.t += dt;
  const p = cl.mesh.geometry.attributes.position;
  const rest = cl.rest;
  const lift = Math.min(1, speed / 6.5);
  for (let i = 0; i < p.count; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1];
    const d = -y / cl.len;                       // 0 at shoulders, 1 at hem
    // wrap around the back
    const wrap = Math.pow(x / (cl.W * 0.5), 2) * 0.11 * (1 - d * 0.6);
    // drape outward over the butt/legs, then lift back with speed
    const drape = Math.sin(Math.min(d, 0.5) * Math.PI) * 0.07 + d * 0.05;
    const flow = d * d * (0.15 + lift * 0.85) * 0.75;
    const wave = Math.sin(cl.t * (3 + lift * 9) - d * 5 + x * 6) * d * (0.012 + lift * 0.05);
    const z = -(drape + flow) + wrap + wave;
    const yy = y + flow * flow * 0.6 * lift;
    p.setXYZ(i, x * (0.62 + d * 0.6), yy, z);
  }
  p.needsUpdate = true;
  cl.mesh.geometry.computeVertexNormals();
}

/** Convenience: build a crowd of NPCs from presets with random skin tones. */
export function createNPC(preset, rng = Math.random) {
  return createCharacter(preset, { skin: SKIN_TONES[Math.floor(rng() * SKIN_TONES.length)] });
}
