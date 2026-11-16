import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ElementType, FactionId } from '../types/game';
import { createCrystalMaterial, PBRTextureSet } from '../render/MaterialLibrary';

export type OnBeforeCompileFn = (
  shader: THREE.WebGLProgramParametersWithUniforms,
  renderer: THREE.WebGLRenderer
) => void;

/**
 * Safely appends an `onBeforeCompile` hook to a material without overwriting
 * existing shader injections (such as CSM cascaded shadows or snow accumulation).
 */
export function chainOnBeforeCompile(
  material: THREE.Material,
  keySuffix: string,
  hook: OnBeforeCompileFn
) {
  const prevCompile = material.onBeforeCompile;
  const prevCacheKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => {
    const base = prevCacheKey ? prevCacheKey() : '';
    return `${base}|${keySuffix}`;
  };
  material.onBeforeCompile = (shader, renderer) => {
    if (prevCompile) prevCompile.call(material, shader, renderer);
    hook(shader, renderer);
  };
  material.needsUpdate = true;
}

export interface SnowShaderUniforms {
  uSnowAmount: { value: number };
}

/**
 * Injects world-space macro stone breakup + world-normal-Y snow accumulation
 * onto stone, ruins, rocks, and outposts (works on both Mesh and InstancedMesh).
 */
export function applySnowAndMacroBreakup(
  material: THREE.MeshStandardMaterial,
  uniforms: SnowShaderUniforms,
  options: { snowThreshold?: number; macroStrength?: number; cacheId?: string } = {}
) {
  const threshold = options.snowThreshold ?? 0.56;
  const macroStrength = options.macroStrength ?? 0.28;
  const cacheId = options.cacheId ?? `snow_macro_${threshold.toFixed(2)}`;

  chainOnBeforeCompile(material, cacheId, (shader) => {
    shader.uniforms.uSnowAmount = uniforms.uSnowAmount;
    shader.vertexShader =
      `varying vec3 vCustomWorldPos;\nvarying vec3 vCustomWorldNormal;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vec4 wpCustom = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpCustom = instanceMatrix * wpCustom;
        #endif
        wpCustom = modelMatrix * wpCustom;
        vCustomWorldPos = wpCustom.xyz;

        vec3 wnCustom = objectNormal;
        #ifdef USE_INSTANCING
          wnCustom = mat3(instanceMatrix) * wnCustom;
        #endif
        vCustomWorldNormal = normalize(mat3(modelMatrix) * wnCustom);
        `
      );

    shader.fragmentShader =
      `uniform float uSnowAmount;\nvarying vec3 vCustomWorldPos;\nvarying vec3 vCustomWorldNormal;\n` +
      `float customHash21(vec2 p){ p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 45.32); return fract(p.x * p.y); }\n` +
      `float customNoise2(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(customHash21(i), customHash21(i+vec2(1.0,0.0)), f.x), mix(customHash21(i+vec2(0.0,1.0)), customHash21(i+vec2(1.0,1.0)), f.x), f.y); }\n` +
      shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `
        float macroLow = customNoise2(vCustomWorldPos.xz * 0.16 + vCustomWorldPos.y * 0.09);
        float macroHigh = customNoise2(vCustomWorldPos.xz * 0.68 + 11.3);
        float macroBlend = macroLow * 0.65 + macroHigh * 0.35;
        diffuseColor.rgb *= mix(1.0 - ${macroStrength.toFixed(2)}, 1.0 + ${(macroStrength * 0.6).toFixed(2)}, macroBlend);

        float snowDot = vCustomWorldNormal.y + (macroBlend - 0.5) * 0.24;
        float snowMask = smoothstep(${(threshold - 0.16).toFixed(2)}, ${(threshold + 0.18).toFixed(2)}, snowDot) * uSnowAmount;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.56, 0.66, 0.78), snowMask * 0.88);
        #include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.86, snowMask * 0.75);
        `
      );
  });
}

let sharedContactShadowTex: THREE.CanvasTexture | null = null;

function getContactShadowTexture(): THREE.CanvasTexture {
  if (sharedContactShadowTex) return sharedContactShadowTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(4, 8, 16, 0.65)');
  grad.addColorStop(0.55, 'rgba(4, 8, 16, 0.28)');
  grad.addColorStop(1, 'rgba(4, 8, 16, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  sharedContactShadowTex = new THREE.CanvasTexture(canvas);
  return sharedContactShadowTex;
}

export function createContactShadow(radius: number, opacity = 0.8): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: getContactShadowTexture(),
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.03;
  return mesh;
}

export interface ArticulatedPlayer {
  group: THREE.Group;
  bodyPivot: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  shield: THREE.Group;
  cape: THREE.Mesh;
  halo: THREE.Mesh;
  bladeGlow: THREE.Mesh;
}

export function createPlayerModel(): ArticulatedPlayer {
  const group = new THREE.Group();
  const bodyPivot = new THREE.Group();
  group.add(bodyPivot);

  group.add(createContactShadow(0.95, 0.85));

  const armorMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.82,
    roughness: 0.24,
  });
  const darkIronMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.72,
    roughness: 0.35,
  });
  const clothMat = new THREE.MeshStandardMaterial({
    color: 0x172554,
    metalness: 0.05,
    roughness: 0.88,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    metalness: 0.88,
    roughness: 0.2,
  });
  const leatherMat = new THREE.MeshStandardMaterial({
    color: 0x451a03,
    roughness: 0.75,
    metalness: 0.12,
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x38bdf8,
    emissiveIntensity: 1.8,
    roughness: 0.15,
  });

  // Sculpted Legs with Boots + Knee Guards
  const makeLeg = (side: number) => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.2, 0.82, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.28, 6, 10), darkIronMat);
    thigh.position.y = -0.22;
    thigh.castShadow = true;
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), goldMat);
    knee.position.set(0, -0.4, 0.05);
    knee.scale.set(0.9, 0.9, 0.65);
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.42, 10), leatherMat);
    boot.position.y = -0.61;
    boot.castShadow = true;
    leg.add(thigh, knee, boot);
    return leg;
  };
  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);
  bodyPivot.add(leftLeg, rightLeg);

  // Sculpted Lathe Cuirass & Tassets
  const cuirassProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.32, 0.05),
    new THREE.Vector2(0.25, 0.3),
    new THREE.Vector2(0.34, 0.68),
    new THREE.Vector2(0.24, 0.88),
    new THREE.Vector2(0.0, 0.92),
  ];
  const torso = new THREE.Mesh(new THREE.LatheGeometry(cuirassProfile, 14), armorMat);
  torso.position.y = 0.78;
  torso.scale.set(1.05, 1, 0.84);
  torso.castShadow = true;
  bodyPivot.add(torso);

  // Chest Crest & Belt
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.11, 12), leatherMat);
  belt.position.y = 0.88;
  belt.scale.set(1.05, 1, 0.88);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.13, 0.08), goldMat);
  buckle.position.set(0, 0.88, 0.25);
  const chestEmblem = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), visorMat);
  chestEmblem.position.set(0, 1.32, 0.26);
  chestEmblem.scale.set(0.8, 1.2, 0.45);
  bodyPivot.add(belt, buckle, chestEmblem);

  // Layered Engraved Pauldrons
  const pauldronGeo = new THREE.SphereGeometry(0.23, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6);
  [-1, 1].forEach((side) => {
    const pauldron = new THREE.Mesh(pauldronGeo, armorMat);
    pauldron.position.set(side * 0.42, 1.49, 0);
    pauldron.rotation.z = -side * 0.42;
    pauldron.castShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 8, 16), goldMat);
    rim.position.set(side * 0.43, 1.42, 0);
    rim.rotation.x = Math.PI / 2;
    rim.rotation.y = side * 0.42;
    bodyPivot.add(pauldron, rim);
  });

  // Flowing Tapered Extruded Cape
  const capeShape = new THREE.Shape();
  capeShape.moveTo(-0.34, 0);
  capeShape.lineTo(0.34, 0);
  capeShape.lineTo(0.46, -1.08);
  capeShape.quadraticCurveTo(0, -1.2, -0.46, -1.08);
  capeShape.closePath();
  const capeGeo = new THREE.ExtrudeGeometry(capeShape, {
    depth: 0.035,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 2,
  });
  const cape = new THREE.Mesh(capeGeo, clothMat);
  cape.position.set(0, 1.56, -0.26);
  cape.rotation.x = 0.16;
  cape.castShadow = true;
  bodyPivot.add(cape);

  // Sculpted Hooded Helm & Visor
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 12), darkIronMat);
  head.position.set(0, 1.82, 0);
  head.castShadow = true;
  const hoodProfile = [
    new THREE.Vector2(0.28, 0.0),
    new THREE.Vector2(0.31, 0.18),
    new THREE.Vector2(0.24, 0.42),
    new THREE.Vector2(0.05, 0.56),
  ];
  const hood = new THREE.Mesh(new THREE.LatheGeometry(hoodProfile, 12), clothMat);
  hood.position.set(0, 1.68, -0.04);
  hood.rotation.x = -0.22;
  hood.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.15), visorMat);
  visor.position.set(0, 1.82, 0.16);
  bodyPivot.add(head, hood, visor);

  // Right Arm + Beveled Extruded Runeblade
  const rightArm = new THREE.Group();
  rightArm.position.set(0.47, 1.42, 0.08);
  const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.42, 6, 10), armorMat);
  forearm.rotation.x = Math.PI / 3;
  forearm.position.set(0, -0.15, 0.18);
  forearm.castShadow = true;
  rightArm.add(forearm);

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.34, 8), leatherMat);
  grip.rotation.x = Math.PI / 2;
  grip.position.set(0, -0.26, 0.36);
  const crossguard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.06), goldMat);
  crossguard.position.set(0, -0.26, 0.52);
  const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), goldMat);
  pommel.position.set(0, -0.26, 0.18);
  rightArm.add(grip, crossguard, pommel);

  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0, -0.05);
  bladeShape.lineTo(1.08, -0.035);
  bladeShape.lineTo(1.26, 0);
  bladeShape.lineTo(1.08, 0.035);
  bladeShape.lineTo(0, 0.05);
  bladeShape.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.025,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.01,
    bevelSegments: 2,
  });
  bladeGeo.rotateY(-Math.PI / 2);
  const bladeGlow = new THREE.Mesh(
    bladeGeo,
    new THREE.MeshStandardMaterial({
      color: 0xfef3c7,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.85,
      metalness: 0.92,
      roughness: 0.14,
    })
  );
  bladeGlow.position.set(0.012, -0.26, 0.53);
  bladeGlow.castShadow = true;
  rightArm.add(bladeGlow);
  bodyPivot.add(rightArm);

  // Left Arm + Heraldic Warden Shield
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.47, 1.42, 0.08);
  const leftForearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.4, 6, 10), armorMat);
  leftForearm.rotation.x = Math.PI / 3.4;
  leftForearm.position.set(0, -0.14, 0.14);
  leftForearm.castShadow = true;
  leftArm.add(leftForearm);

  const shield = new THREE.Group();
  shield.position.set(-0.14, -0.18, 0.24);
  const shieldPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.26, 0.06, 6), armorMat);
  shieldPlate.rotation.x = Math.PI / 2;
  const shieldBoss = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), goldMat);
  shieldBoss.position.z = 0.04;
  shield.add(shieldPlate, shieldBoss);
  leftArm.add(shield);
  bodyPivot.add(leftArm);

  // Arcane Seal Halo
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.024, 10, 28),
    new THREE.MeshStandardMaterial({
      color: 0xfde68a,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.35,
      metalness: 0.8,
      roughness: 0.2,
    })
  );
  halo.position.set(0, 1.48, -0.4);
  bodyPivot.add(halo);

  return { group, bodyPivot, leftLeg, rightLeg, leftArm, rightArm, shield, cape, halo, bladeGlow };
}

export function createNpcModel(factionId: FactionId, isCompanion: boolean): THREE.Group {
  const group = new THREE.Group();
  group.add(createContactShadow(0.85, 0.72));

  const palette: Record<FactionId, number> = {
    suncrest_order: 0xd97706,
    verdant_circle: 0x059669,
    ironbound_guild: 0x991b1b,
  };
  const tunicColor = palette[factionId];

  const tunicMat = new THREE.MeshStandardMaterial({ color: tunicColor, roughness: 0.82, metalness: 0.08 });
  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.7, metalness: 0.15 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xdcb898, roughness: 0.62 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xfde68a, metalness: 0.78, roughness: 0.22 });

  // Sculpted Lathe Robe / Tunic Skirt
  const robeProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.4, 0.02),
    new THREE.Vector2(0.34, 0.45),
    new THREE.Vector2(0.25, 0.92),
    new THREE.Vector2(0.32, 1.42),
    new THREE.Vector2(0.18, 1.56),
    new THREE.Vector2(0.0, 1.58),
  ];
  const body = new THREE.Mesh(new THREE.LatheGeometry(robeProfile, 14), tunicMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Leather Sash & Shoulder Mantle
  const sash = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.29, 0.14, 12), leatherMat);
  sash.position.y = 0.94;
  const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.33, 0.2, 12), trimMat);
  mantle.position.y = 1.48;
  mantle.castShadow = true;
  group.add(sash, mantle);

  // Head + Facial Silhouette
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 12), skinMat);
  head.position.y = 1.78;
  head.castShadow = true;
  group.add(head);

  if (isCompanion) {
    // Hooded Ranger Crest + Curved Bow/Staff
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.4, 10), tunicMat);
    hat.position.set(0, 2.02, -0.02);
    hat.rotation.x = -0.15;
    group.add(hat);

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.38, 0.35, 0.1),
      new THREE.Vector3(0.42, 1.15, 0.22),
      new THREE.Vector3(0.36, 1.95, 0.08),
    ]);
    const staff = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.03, 6, false), leatherMat);
    const orb = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.1, 0),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 1.5 })
    );
    orb.position.set(0.36, 2.04, 0.08);
    group.add(staff, orb);
  } else {
    const circlet = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 16), trimMat);
    circlet.rotation.x = Math.PI / 2;
    circlet.position.y = 1.88;
    group.add(circlet);
  }

  // Subtle Ground Ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.58, 28),
    new THREE.MeshBasicMaterial({
      color: isCompanion ? 0x38bdf8 : 0xfbbf24,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.68,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  group.add(ring);

  return group;
}

export interface EnemyModelParts {
  group: THREE.Group;
  bodyGroup: THREE.Group;
  telegraphRing: THREE.Mesh;
  materialsToFlash: THREE.MeshStandardMaterial[];
}

export function createEnemyModel(kind: 'wraith' | 'golem' | 'stalker'): EnemyModelParts {
  const group = new THREE.Group();
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);
  group.add(createContactShadow(kind === 'golem' ? 1.35 : 0.95, 0.82));

  const materialsToFlash: THREE.MeshStandardMaterial[] = [];

  if (kind === 'wraith') {
    const shroudMat = new THREE.MeshStandardMaterial({ color: 0x2e1065, roughness: 0.85, metalness: 0.15 });
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xd8b4fe, roughness: 0.45, metalness: 0.1 });
    const coreMat = new THREE.MeshStandardMaterial({ color: 0xc084fc, emissive: 0xa855f7, emissiveIntensity: 1.9 });
    materialsToFlash.push(shroudMat, boneMat);

    const shroudProfile = [
      new THREE.Vector2(0.45, 0.15),
      new THREE.Vector2(0.32, 0.7),
      new THREE.Vector2(0.38, 1.25),
      new THREE.Vector2(0.18, 1.65),
      new THREE.Vector2(0.0, 1.72),
    ];
    const robe = new THREE.Mesh(new THREE.LatheGeometry(shroudProfile, 12), shroudMat);
    robe.castShadow = true;
    bodyGroup.add(robe);

    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), coreMat);
    core.position.y = 1.32;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), boneMat);
    skull.position.y = 1.84;
    const crownRing = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.025, 8, 20), coreMat);
    crownRing.rotation.x = Math.PI / 2.4;
    crownRing.position.y = 1.55;
    bodyGroup.add(core, skull, crownRing);

    [-1, 1].forEach((side) => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.14, 1.95, 0),
        new THREE.Vector3(side * 0.28, 2.2, -0.05),
        new THREE.Vector3(side * 0.22, 2.42, 0.08),
      ]);
      const horn = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.038, 6, false), boneMat);
      bodyGroup.add(horn);
    });
  } else if (kind === 'golem') {
    const basaltMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9, metalness: 0.18 });
    const magmaMat = new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0xea580c, emissiveIntensity: 2.2 });
    materialsToFlash.push(basaltMat);

    [-1, 1].forEach((side) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.85, 0.48), basaltMat);
      leg.position.set(side * 0.34, 0.42, 0);
      leg.castShadow = true;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.18, 0.44), basaltMat);
      arm.position.set(side * 0.95, 1.32, 0.12);
      arm.rotation.z = side * 0.12;
      arm.castShadow = true;
      const fist = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), magmaMat);
      fist.position.set(side * 0.98, 0.72, 0.16);
      bodyGroup.add(leg, arm, fist);
    });

    const torso = new THREE.Mesh(new THREE.DodecahedronGeometry(0.82, 0), basaltMat);
    torso.position.y = 1.52;
    torso.castShadow = true;
    const magmaCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0), magmaMat);
    magmaCore.position.set(0, 1.5, 0.56);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.42, 0.48), basaltMat);
    head.position.y = 2.34;
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.08), magmaMat);
    eyes.position.set(0, 2.36, 0.24);
    bodyGroup.add(torso, magmaCore, head, eyes);
  } else {
    const quartzMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.22, metalness: 0.85 });
    const sparkMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 2.1 });
    materialsToFlash.push(quartzMat);

    const body = new THREE.Mesh(new THREE.ConeGeometry(0.46, 1.45, 7), quartzMat);
    body.rotation.x = Math.PI;
    body.position.y = 1.15;
    body.castShadow = true;
    const crest = new THREE.Mesh(new THREE.OctahedronGeometry(0.36, 0), sparkMat);
    crest.position.y = 2.02;
    const haloArc = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.035, 8, 24), sparkMat);
    haloArc.position.y = 1.55;
    haloArc.rotation.x = Math.PI / 3;
    bodyGroup.add(body, crest, haloArc);

    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(0.75, 0.45);
    wingShape.lineTo(0.52, -0.55);
    wingShape.closePath();
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.01 });
    [-1, 1].forEach((side) => {
      const w = new THREE.Mesh(wingGeo, sparkMat);
      w.position.set(side * 0.35, 1.45, -0.08);
      w.scale.x = side;
      w.rotation.y = -side * 0.35;
      bodyGroup.add(w);
    });
  }

  // Attack Windup Telegraph Ring on ground
  const telegraphRing = new THREE.Mesh(
    new THREE.RingGeometry(1.1, 2.35, 32),
    new THREE.MeshBasicMaterial({
      color: 0xef4444,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.72,
    })
  );
  telegraphRing.rotation.x = -Math.PI / 2;
  telegraphRing.position.y = 0.06;
  telegraphRing.visible = false;
  group.add(telegraphRing);

  return { group, bodyGroup, telegraphRing, materialsToFlash };
}

export function createOutpostModel(
  level: number,
  stonePbr: PBRTextureSet,
  woodPbr: PBRTextureSet,
  snowUniforms?: SnowShaderUniforms
): THREE.Group {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({
    map: stonePbr.map,
    normalMap: stonePbr.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: stonePbr.roughnessMap,
    aoMap: stonePbr.aoMap,
    aoMapIntensity: 0.72,
    roughness: 0.88,
    metalness: 0.08,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    map: woodPbr.map,
    normalMap: woodPbr.normalMap,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap: woodPbr.roughnessMap,
    aoMap: woodPbr.aoMap,
    aoMapIntensity: 0.65,
    roughness: 0.85,
    metalness: 0.06,
  });
  if (snowUniforms) {
    applySnowAndMacroBreakup(stoneMat, snowUniforms, { snowThreshold: 0.54, cacheId: 'outpost_stone' });
    applySnowAndMacroBreakup(woodMat, snowUniforms, { snowThreshold: 0.48, macroStrength: 0.14, cacheId: 'outpost_wood' });
  }
  const bannerMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.72 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5.0, 0.55, 10), stoneMat);
  base.position.y = 0.27;
  base.receiveShadow = true;
  group.add(base);

  if (level === 0) {
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.3, 1.15), stoneMat);
    p1.position.set(-2.2, 1.4, -1.6);
    p1.rotation.z = 0.14;
    p1.castShadow = true;
    const p2 = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.5, 1.15), stoneMat);
    p2.position.set(2.0, 1.0, 1.2);
    p2.rotation.x = -0.18;
    p2.castShadow = true;
    const rubble = new THREE.Mesh(new THREE.DodecahedronGeometry(0.92, 0), stoneMat);
    rubble.position.set(0.2, 0.88, -1.2);
    group.add(p1, p2, rubble);
  } else {
    const walls = new THREE.Mesh(new THREE.BoxGeometry(4.7, 3.3, 4.7), stoneMat);
    walls.position.y = 2.15;
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);

    // Timber Roof with Overhang
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.0, 2.35, 4), woodMat);
    roof.position.y = 4.95;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);

    // Warm Glowing Lantern
    const lantern = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.3, 0),
      new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xf59e0b, emissiveIntensity: 2.2 })
    );
    lantern.position.set(0, 2.75, 2.6);
    group.add(lantern);

    const flagpole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.5, 8), woodMat);
    flagpole.position.set(0, 6.5, 0);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.72, 0.06), bannerMat);
    flag.position.set(0.72, 7.2, 0);
    group.add(flagpole, flag);

    if (level >= 2) {
      const turret = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.45, 6.5, 10), stoneMat);
      turret.position.set(-2.55, 3.45, -2.55);
      turret.castShadow = true;
      const beacon = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.6, 0),
        new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 2.0 })
      );
      beacon.position.set(-2.55, 7.3, -2.55);
      group.add(turret, beacon);
    }
  }
  return group;
}

export function createCentralSpireModel(
  stonePbr: PBRTextureSet,
  snowUniforms: SnowShaderUniforms,
  transmissionEnabled: boolean
): { group: THREE.Group; crystal: THREE.Mesh; ring: THREE.Mesh; pointLight: THREE.PointLight } {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({
    map: stonePbr.map,
    normalMap: stonePbr.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: stonePbr.roughnessMap,
    aoMap: stonePbr.aoMap,
    aoMapIntensity: 0.75,
    roughness: 0.86,
    metalness: 0.08,
  });
  applySnowAndMacroBreakup(stoneMat, snowUniforms, { snowThreshold: 0.52, cacheId: 'spire_stone' });

  const step1 = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4.1, 0.45, 8), stoneMat);
  step1.position.y = 0.22;
  step1.castShadow = true;
  step1.receiveShadow = true;
  const step2 = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.75, 0.55, 8), stoneMat);
  step2.position.y = 0.68;
  step2.castShadow = true;
  step2.receiveShadow = true;
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.45, 1.35, 8), stoneMat);
  plinth.position.y = 1.6;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(step1, step2, plinth);

  void transmissionEnabled;
  const spireMat = createCrystalMaterial(0xe2e8f0, 0xbae6fd, 1.35);

  const spireGeo = new THREE.OctahedronGeometry(1.15, 0);
  spireGeo.scale(0.85, 2.4, 0.85);
  const crystal = new THREE.Mesh(spireGeo, spireMat);
  crystal.position.y = 4.65;
  crystal.castShadow = true;
  group.add(crystal);

  const innerCore = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.42, 0),
    new THREE.MeshBasicMaterial({ color: 0xf8fafc })
  );
  innerCore.scale.set(0.65, 2.2, 0.65);
  crystal.add(innerCore);

  const haloCone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 2.1, 5.4, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.09,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  haloCone.position.y = 4.4;
  group.add(haloCone);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.85, 0.032, 8, 40),
    new THREE.MeshBasicMaterial({
      color: 0xc4b5fd,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  ring.position.y = 4.55;
  ring.rotation.x = Math.PI / 3;
  group.add(ring);

  const pointLight = new THREE.PointLight(0xdbeafe, 8.5, 26, 2.0);
  pointLight.position.set(0, 4.6, 0);
  group.add(pointLight);

  return { group, crystal, ring, pointLight };
}

export function createSealShrineModel(
  element: ElementType,
  status: string,
  stonePbr: PBRTextureSet,
  snowUniforms?: SnowShaderUniforms,
  transmissionEnabled = false
): { group: THREE.Group; crystal: THREE.Mesh; ring: THREE.Mesh; pointLight: THREE.PointLight } {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({
    map: stonePbr.map,
    normalMap: stonePbr.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: stonePbr.roughnessMap,
    aoMap: stonePbr.aoMap,
    aoMapIntensity: 0.72,
    roughness: 0.84,
    metalness: 0.12,
  });
  if (snowUniforms) {
    applySnowAndMacroBreakup(stoneMat, snowUniforms, { snowThreshold: 0.54, cacheId: 'seal_stone' });
  }

  const dais = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.1, 0.7, 12), stoneMat);
  dais.position.y = 0.35;
  dais.castShadow = true;
  dais.receiveShadow = true;
  group.add(dais);

  const daisRim = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.95, 0.35, 12), stoneMat);
  daisRim.position.y = 0.85;
  daisRim.receiveShadow = true;
  group.add(daisRim);

  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const px = Math.cos(angle) * 2.55;
    const pz = Math.sin(angle) * 2.55;
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.62, 3.3, 0.62), stoneMat);
    pillar.position.set(px, 2.0, pz);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.28, 0.92), stoneMat);
    cap.position.set(px, 3.72, pz);
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(pillar, cap);
  }

  const elementColors: Record<ElementType, number> = {
    fire: 0xf97316,
    lightning: 0x38bdf8,
    frost: 0x67e8f9,
    gale: 0xfbbf24,
    physical: 0xfbbf24,
  };
  const col = status === 'corrupted' ? 0xa855f7 : status === 'drained' ? 0xef4444 : elementColors[element];

  void transmissionEnabled;
  const crystalMat = createCrystalMaterial(col, col, status === 'purified' ? 2.15 : 1.45);

  const crystalGeo = new THREE.OctahedronGeometry(0.88, 0);
  crystalGeo.scale(0.82, 1.35, 0.82);
  const crystal = new THREE.Mesh(crystalGeo, crystalMat);
  crystal.position.y = 2.7;
  crystal.castShadow = true;
  group.add(crystal);

  const innerShard = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.34, 0),
    new THREE.MeshBasicMaterial({ color: 0xfff7ed })
  );
  crystal.add(innerShard);

  // Soft additive halo ring + subtle glow cone
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.48, 0.036, 8, 36),
    new THREE.MeshBasicMaterial({
      color: col,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  ring.position.y = 2.7;
  ring.rotation.x = Math.PI / 3;
  group.add(ring);

  const glowCone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 1.85, 3.8, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: col,
      transparent: true,
      opacity: 0.11,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  glowCone.position.y = 2.55;
  group.add(glowCone);

  const pointLight = new THREE.PointLight(col, status === 'purified' ? 10.5 : 7.2, 22, 2.0);
  pointLight.position.set(0, 2.9, 0);
  group.add(pointLight);

  return { group, crystal, ring, pointLight };
}

export function createClimbableTowerModel(
  stonePbr: PBRTextureSet,
  snowUniforms?: SnowShaderUniforms
): { group: THREE.Group; pointLight: THREE.PointLight } {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({
    map: stonePbr.map,
    normalMap: stonePbr.normalMap,
    normalScale: new THREE.Vector2(0.95, 0.95),
    roughnessMap: stonePbr.roughnessMap,
    aoMap: stonePbr.aoMap,
    aoMapIntensity: 0.78,
    roughness: 0.88,
    metalness: 0.08,
  });
  if (snowUniforms) {
    applySnowAndMacroBreakup(stoneMat, snowUniforms, { snowThreshold: 0.52, cacheId: 'tower_stone' });
  }

  const handholdMat = new THREE.MeshStandardMaterial({
    color: 0x67e8f9,
    emissive: 0x06b6d4,
    emissiveIntensity: 2.1,
    roughness: 0.22,
  });

  const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.85, 0.9, 3.85), stoneMat);
  plinth.position.y = 0.45;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  const shaft = new THREE.Mesh(new THREE.BoxGeometry(3.2, 8.6, 3.2), stoneMat);
  shaft.position.y = 4.6;
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  group.add(shaft);

  const cap = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.58, 4.1), stoneMat);
  cap.position.y = 9.15;
  cap.castShadow = true;
  cap.receiveShadow = true;
  group.add(cap);

  // Ruined corner battlements
  const corners: [number, number, number][] = [
    [-1.65, -1.65, 1.1],
    [1.65, -1.65, 0.72],
    [-1.65, 1.65, 0.55],
    [1.65, 1.65, 0.95],
  ];
  corners.forEach(([cx, cz, ch]) => {
    const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.76, ch, 0.76), stoneMat);
    merlon.position.set(cx, 9.42 + ch * 0.5, cz);
    merlon.castShadow = true;
    merlon.receiveShadow = true;
    group.add(merlon);
  });

  for (let y = 1.5; y <= 8.1; y += 1.65) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(3.42, 0.2, 3.42), handholdMat);
    rung.position.y = y;
    group.add(rung);
  }

  const pointLight = new THREE.PointLight(0x22d3ee, 6.2, 18, 2.0);
  pointLight.position.set(0, 5.2, 0);
  group.add(pointLight);

  return { group, pointLight };
}

export function createResourceNodeModel(itemId: string): THREE.Group {
  const group = new THREE.Group();
  group.add(createContactShadow(0.7, 0.6));

  if (itemId === 'sunleaf_herb' || itemId === 'frost_lotus') {
    const leafCol = itemId === 'frost_lotus' ? 0x67e8f9 : 0x22c55e;
    const bloomCol = itemId === 'frost_lotus' ? 0xe0f2fe : 0xfacc15;
    const stemMat = new THREE.MeshStandardMaterial({ color: leafCol, roughness: 0.55 });
    const bloomMat = new THREE.MeshStandardMaterial({
      color: bloomCol,
      emissive: bloomCol,
      emissiveIntensity: 0.7,
      roughness: 0.25,
    });
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5;
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.78, 6), stemMat);
      leaf.position.set(Math.cos(a) * 0.26, 0.36, Math.sin(a) * 0.26);
      leaf.rotation.z = -Math.cos(a) * 0.45;
      leaf.rotation.x = Math.sin(a) * 0.45;
      group.add(leaf);
    }
    const flower = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), bloomMat);
    flower.position.y = 0.72;
    group.add(flower);
  } else if (itemId === 'ember_ore' || itemId === 'storm_crystal') {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.58, 0),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 })
    );
    rock.position.y = 0.36;
    rock.castShadow = true;
    group.add(rock);
    const col = itemId === 'ember_ore' ? 0xf97316 : 0x38bdf8;
    const crystalMat = new THREE.MeshPhysicalMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: 1.25,
      roughness: 0.14,
      clearcoat: 1.0,
    });
    for (let i = 0; i < 4; i++) {
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 6), crystalMat);
      shard.position.set((i - 1.5) * 0.18, 0.68, (i % 2) * 0.18);
      shard.rotation.z = (i - 1.5) * 0.3;
      group.add(shard);
    }
  } else {
    const col = itemId === 'ancient_timber' ? 0x78350f : itemId === 'gale_feather' ? 0x86efac : 0x64748b;
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.78 });
    const main = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 1.15, 8), mat);
    main.rotation.z = Math.PI / 2;
    main.position.y = 0.28;
    const secondary = new THREE.Mesh(new THREE.DodecahedronGeometry(0.38, 0), mat);
    secondary.position.set(0.22, 0.48, 0.2);
    group.add(main, secondary);
  }

  return group;
}

export function createCaravanModel(factionId: FactionId, woodPbr: PBRTextureSet): THREE.Group {
  const group = new THREE.Group();
  group.add(createContactShadow(1.6, 0.72));

  const woodMat = new THREE.MeshStandardMaterial({
    map: woodPbr.map,
    bumpMap: woodPbr.bumpMap,
    bumpScale: 0.04,
    roughness: 0.82,
  });
  const canopyCol = factionId === 'ironbound_guild' ? 0x991b1b : factionId === 'verdant_circle' ? 0x047857 : 0xd97706;
  const canopyMat = new THREE.MeshStandardMaterial({ color: canopyCol, roughness: 0.85 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.55, roughness: 0.38 });

  const bed = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.35, 2.65), woodMat);
  bed.position.y = 0.65;
  bed.castShadow = true;
  group.add(bed);

  const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.86, 2.45, 12, 1, false, 0, Math.PI), canopyMat);
  canopy.rotation.z = Math.PI / 2;
  canopy.rotation.y = Math.PI / 2;
  canopy.position.y = 1.05;
  canopy.castShadow = true;
  group.add(canopy);

  const wheelGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.14, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  [
    [-0.86, 0.44, 0.92],
    [0.86, 0.44, 0.92],
    [-0.86, 0.44, -0.92],
    [0.86, 0.44, -0.92],
  ].forEach(([wx, wy, wz]) => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(wx, wy, wz);
    w.castShadow = true;
    group.add(w);
  });

  return group;
}

export function createTreeGeometries(): { trunkGeo: THREE.BufferGeometry; canopyGeo: THREE.BufferGeometry } {
  // Lathe trunk with root flare
  const trunkProfile = [
    new THREE.Vector2(0.54, 0.0),
    new THREE.Vector2(0.35, 0.65),
    new THREE.Vector2(0.25, 2.2),
    new THREE.Vector2(0.16, 4.0),
    new THREE.Vector2(0.0, 4.8),
  ];
  const trunkGeo = new THREE.LatheGeometry(trunkProfile, 8);

  // Multi-tiered layered fluted spruce/pine boughs merged cleanly
  const tiers = [
    { rBot: 2.35, rTop: 0.82, h: 2.0, y: 2.55, segs: 9 },
    { rBot: 2.05, rTop: 0.68, h: 1.9, y: 3.7, segs: 9 },
    { rBot: 1.7, rTop: 0.52, h: 1.75, y: 4.85, segs: 8 },
    { rBot: 1.3, rTop: 0.36, h: 1.6, y: 5.9, segs: 8 },
    { rBot: 0.88, rTop: 0.04, h: 1.55, y: 6.9, segs: 7 },
  ];

  const tierGeos: THREE.BufferGeometry[] = [];
  tiers.forEach((t, ti) => {
    const g = new THREE.CylinderGeometry(t.rTop, t.rBot, t.h, t.segs, 2);
    g.rotateY(ti * 0.42);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const angle = Math.atan2(z, x);
      const flute = 1 + 0.16 * Math.sin(angle * t.segs * 0.5 + ti);
      // Droop lower skirt tips slightly like snow-laden boughs
      const skirtDrop = y < 0 ? -0.18 * (Math.hypot(x, z) / t.rBot) : 0;
      pos.setXYZ(i, x * flute, y + t.y + skirtDrop, z * flute);
    }
    g.computeVertexNormals();
    tierGeos.push(g.toNonIndexed());
    g.dispose();
  });

  const merged = mergeGeometries(tierGeos, false);
  tierGeos.forEach((g) => g.dispose());
  const canopyGeo = merged || new THREE.ConeGeometry(2.15, 5.2, 9, 3);
  return { trunkGeo, canopyGeo };
}

/**
 * Multi-blade splayed winter sedge tussock cluster (replaces single neon spikes).
 */
export function createWinterGrassGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  const bladeCount = 5;
  for (let i = 0; i < bladeCount; i++) {
    const a = (i / bladeCount) * Math.PI * 2 + (i % 2) * 0.25;
    const h = 0.36 + (i % 3) * 0.11;
    const b = new THREE.ConeGeometry(0.048, h, 3);
    b.translate(0, h * 0.5, 0);
    b.rotateZ(0.28 + (i % 2) * 0.14);
    b.rotateY(a);
    b.translate(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08);
    blades.push(b.toNonIndexed());
    b.dispose();
  }
  const merged = mergeGeometries(blades, false);
  blades.forEach((b) => b.dispose());
  return merged || new THREE.ConeGeometry(0.06, 0.45, 3);
}

export interface AnimalModelParts {
  group: THREE.Group;
  legs: THREE.Group[];
  wings: THREE.Group[];
  tail?: THREE.Mesh;
}

export function createAnimalModel(kind: 'stag' | 'wolf' | 'eagle'): AnimalModelParts {
  const group = new THREE.Group();
  const legs: THREE.Group[] = [];
  const wings: THREE.Group[] = [];

  if (kind === 'eagle') {
    const featherMat = new THREE.MeshStandardMaterial({ color: 0x3f2a1d, roughness: 0.72 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.55 });
    const beakMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.3 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.55, 5, 8), featherMat);
    body.rotation.x = Math.PI / 2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), headMat);
    head.position.set(0, 0.06, 0.42);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 6), beakMat);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.04, 0.58);
    group.add(body, head, beak);

    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0.15);
    wingShape.lineTo(1.25, 0.35);
    wingShape.lineTo(1.4, -0.15);
    wingShape.lineTo(0.3, -0.25);
    wingShape.closePath();
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.03, bevelEnabled: false });
    wingGeo.rotateX(Math.PI / 2);

    [-1, 1].forEach((side) => {
      const wp = new THREE.Group();
      const mesh = new THREE.Mesh(wingGeo, featherMat);
      mesh.scale.x = side;
      wp.add(mesh);
      group.add(wp);
      wings.push(wp);
    });
    return { group, legs, wings };
  }

  group.add(createContactShadow(kind === 'stag' ? 0.95 : 0.75, 0.68));
  const coatMat = new THREE.MeshStandardMaterial({
    color: kind === 'stag' ? 0x7c4a26 : 0x475569,
    roughness: 0.85,
  });
  const bellyMat = new THREE.MeshStandardMaterial({
    color: kind === 'stag' ? 0xd6bfa3 : 0x94a3b8,
    roughness: 0.82,
  });
  const scale = kind === 'stag' ? 1.0 : 0.78;

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32 * scale, 0.95 * scale, 6, 10), coatMat);
  torso.rotation.x = Math.PI / 2;
  torso.position.y = 0.92 * scale;
  torso.castShadow = true;
  group.add(torso);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * scale, 0.22 * scale, 0.58 * scale, 8), coatMat);
  neck.position.set(0, 1.25 * scale, 0.52 * scale);
  neck.rotation.x = kind === 'stag' ? 0.35 : 0.75;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26 * scale, 0.24 * scale, 0.42 * scale), bellyMat);
  head.position.set(0, 1.52 * scale, 0.72 * scale);
  group.add(neck, head);

  if (kind === 'stag') {
    const antlerMat = new THREE.MeshStandardMaterial({ color: 0xe7d6bd, roughness: 0.65 });
    [-1, 1].forEach((side) => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.08, 1.62, 0.65),
        new THREE.Vector3(side * 0.28, 2.02, 0.58),
        new THREE.Vector3(side * 0.42, 2.34, 0.72),
      ]);
      const mainBeam = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.028, 6, false), antlerMat);
      const tine = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.28, 6), antlerMat);
      tine.position.set(side * 0.25, 2.08, 0.72);
      tine.rotation.x = 0.5;
      group.add(mainBeam, tine);
    });
  } else {
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xf59e0b, emissiveIntensity: 1.6 });
    [-1, 1].forEach((side) => {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 5), coatMat);
      ear.position.set(side * 0.09, 1.38, 0.58);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), eyeMat);
      eye.position.set(side * 0.06, 1.24, 0.75);
      group.add(ear, eye);
    });
  }

  [
    [-0.18, 0.42],
    [0.18, 0.42],
    [-0.18, -0.42],
    [0.18, -0.42],
  ].forEach(([lx, lz]) => {
    const pivot = new THREE.Group();
    pivot.position.set(lx * scale, 0.78 * scale, lz * scale);
    const legMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.065 * scale, 0.048 * scale, 0.78 * scale, 7), coatMat);
    legMesh.position.y = -0.39 * scale;
    legMesh.castShadow = true;
    pivot.add(legMesh);
    group.add(pivot);
    legs.push(pivot);
  });

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.09 * scale, 0.42 * scale, 6), coatMat);
  tail.position.set(0, 0.9 * scale, -0.68 * scale);
  tail.rotation.x = -0.9;
  group.add(tail);

  return { group, legs, wings, tail };
}

export interface DragonModelParts {
  group: THREE.Group;
  bodyGroup: THREE.Group;
  leftWing: THREE.Group;
  rightWing: THREE.Group;
  jaw: THREE.Mesh;
  telegraphRing: THREE.Mesh;
  materialsToFlash: THREE.MeshStandardMaterial[];
}

export function createDragonModel(variant: 'ember_dragon' | 'frost_dragon'): DragonModelParts {
  const group = new THREE.Group();
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);
  group.add(createContactShadow(2.4, 0.78));

  const isEmber = variant === 'ember_dragon';
  const scaleMat = new THREE.MeshStandardMaterial({
    color: isEmber ? 0x450a0a : 0x0c4a6e,
    roughness: 0.48,
    metalness: 0.35,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: isEmber ? 0xf97316 : 0x38bdf8,
    emissive: isEmber ? 0xea580c : 0x0284c7,
    emissiveIntensity: 2.0,
    roughness: 0.25,
  });
  const hornMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.45 });
  const materialsToFlash = [scaleMat];

  // Sculpted Dragon Torso
  const torsoProfile = [
    new THREE.Vector2(0.0, -1.6),
    new THREE.Vector2(0.45, -1.1),
    new THREE.Vector2(0.82, 0.0),
    new THREE.Vector2(0.66, 1.0),
    new THREE.Vector2(0.0, 1.45),
  ];
  const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoProfile, 12), scaleMat);
  torso.rotation.x = Math.PI / 2;
  torso.position.y = 2.1;
  torso.castShadow = true;
  bodyGroup.add(torso);

  const bellyCore = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 10), glowMat);
  bellyCore.scale.set(0.85, 0.72, 1.45);
  bellyCore.position.set(0, 1.82, 0.1);
  bodyGroup.add(bellyCore);

  // Serpentine Neck + Horned Skull
  const neckCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 2.2, 1.1),
    new THREE.Vector3(0, 2.85, 1.85),
    new THREE.Vector3(0, 3.25, 2.55),
  ]);
  const neck = new THREE.Mesh(new THREE.TubeGeometry(neckCurve, 12, 0.28, 8, false), scaleMat);
  neck.castShadow = true;
  bodyGroup.add(neck);

  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.46, 0.98), scaleMat);
  skull.position.set(0, 3.35, 2.95);
  skull.castShadow = true;
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.85), glowMat);
  jaw.position.set(0, 3.04, 2.92);
  bodyGroup.add(skull, jaw);

  [-1, 1].forEach((side) => {
    const hornCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.22, 3.55, 2.75),
      new THREE.Vector3(side * 0.42, 4.05, 2.3),
      new THREE.Vector3(side * 0.36, 4.35, 1.9),
    ]);
    const horn = new THREE.Mesh(new THREE.TubeGeometry(hornCurve, 8, 0.075, 6, false), hornMat);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), glowMat);
    eye.position.set(side * 0.28, 3.42, 3.22);
    bodyGroup.add(horn, eye);
  });

  // Sweeping Spiked Tail
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 2.0, -1.3),
    new THREE.Vector3(0.35, 1.85, -2.5),
    new THREE.Vector3(-0.2, 2.25, -3.7),
  ]);
  const tail = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 12, 0.22, 7, false), scaleMat);
  const tailTip = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.65, 5), glowMat);
  tailTip.rotation.x = -Math.PI / 2;
  tailTip.position.set(-0.2, 2.25, -3.95);
  bodyGroup.add(tail, tailTip);

  // Huge Ribbed Extruded Dragon Wings
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.lineTo(1.8, 1.45);
  wingShape.lineTo(3.6, 0.9);
  wingShape.lineTo(2.9, -0.65);
  wingShape.lineTo(1.9, -0.25);
  wingShape.lineTo(1.2, -0.8);
  wingShape.lineTo(0.2, -0.35);
  wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
  });
  wingGeo.rotateX(Math.PI / 2);

  const leftWing = new THREE.Group();
  leftWing.position.set(-0.55, 2.45, 0.35);
  const lwMesh = new THREE.Mesh(wingGeo, scaleMat);
  lwMesh.scale.x = -1;
  lwMesh.castShadow = true;
  leftWing.add(lwMesh);

  const rightWing = new THREE.Group();
  rightWing.position.set(0.55, 2.45, 0.35);
  const rwMesh = new THREE.Mesh(wingGeo, scaleMat);
  rwMesh.castShadow = true;
  rightWing.add(rwMesh);
  bodyGroup.add(leftWing, rightWing);

  const telegraphRing = new THREE.Mesh(
    new THREE.RingGeometry(1.8, 4.4, 36),
    new THREE.MeshBasicMaterial({
      color: isEmber ? 0xf97316 : 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.72,
    })
  );
  telegraphRing.rotation.x = -Math.PI / 2;
  telegraphRing.position.y = 0.08;
  telegraphRing.visible = false;
  group.add(telegraphRing);

  return { group, bodyGroup, leftWing, rightWing, jaw, telegraphRing, materialsToFlash };
}

export function createMysticModel(kind: 'unicorn' | 'phoenix' | 'wisp'): {
  group: THREE.Group;
  wings: THREE.Group[];
  ring?: THREE.Mesh;
} {
  const group = new THREE.Group();
  const wings: THREE.Group[] = [];

  if (kind === 'wisp') {
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.32, 1),
      new THREE.MeshStandardMaterial({ color: 0xa7f3d0, emissive: 0x34d399, emissiveIntensity: 2.3 })
    );
    core.position.y = 1.65;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.03, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xfde68a, emissive: 0xfbbf24, emissiveIntensity: 1.8 })
    );
    ring.position.y = 1.65;
    group.add(core, ring);
    return { group, wings, ring };
  }

  if (kind === 'phoenix') {
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf97316, emissiveIntensity: 1.8, roughness: 0.25 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.75, 5, 8), goldMat);
    body.rotation.x = Math.PI / 2;
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.45, 6), goldMat);
    crest.position.set(0, 0.35, 0.42);
    crest.rotation.x = -0.5;
    group.add(body, crest);

    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0.15);
    wingShape.lineTo(1.5, 0.5);
    wingShape.lineTo(1.75, -0.3);
    wingShape.lineTo(0.4, -0.35);
    wingShape.closePath();
    const wGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.035, bevelEnabled: false });
    wGeo.rotateX(Math.PI / 2);
    [-1, 1].forEach((side) => {
      const wp = new THREE.Group();
      const wm = new THREE.Mesh(wGeo, goldMat);
      wm.scale.x = side;
      wp.add(wm);
      group.add(wp);
      wings.push(wp);
    });
    return { group, wings };
  }

  // Celestial Unicorn
  group.add(createContactShadow(1.05, 0.75));
  const coatMat = new THREE.MeshPhysicalMaterial({
    color: 0xf8fafc,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.22,
    roughness: 0.28,
    clearcoat: 0.75,
  });
  const maneMat = new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 1.4 });
  const hornMat = new THREE.MeshStandardMaterial({ color: 0xfde047, emissive: 0xf59e0b, emissiveIntensity: 1.8, metalness: 0.85, roughness: 0.15 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 1.05, 6, 10), coatMat);
  torso.rotation.x = Math.PI / 2;
  torso.position.y = 1.05;
  torso.castShadow = true;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.68, 8), coatMat);
  neck.position.set(0, 1.42, 0.56);
  neck.rotation.x = 0.35;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.26, 0.52), coatMat);
  head.position.set(0, 1.72, 0.78);
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.56, 8), hornMat);
  horn.position.set(0, 2.02, 0.94);
  horn.rotation.x = 0.45;
  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.65, 0.26), maneMat);
  mane.position.set(0, 1.54, 0.42);
  mane.rotation.x = 0.35;
  group.add(torso, neck, head, horn, mane);

  [
    [-0.2, 0.45],
    [0.2, 0.45],
    [-0.2, -0.45],
    [0.2, -0.45],
  ].forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.92, 7), coatMat);
    leg.position.set(lx, 0.46, lz);
    leg.castShadow = true;
    group.add(leg);
  });

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.75, 0.86, 28),
    new THREE.MeshBasicMaterial({ color: 0x67e8f9, side: THREE.DoubleSide, transparent: true, opacity: 0.65 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  group.add(ring);
  return { group, wings, ring };
}

export function createDungeonPortalModel(
  accentHex: number,
  stonePbr: PBRTextureSet,
  snowUniforms?: SnowShaderUniforms
): { group: THREE.Group; portalGlow: THREE.Mesh } {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({
    map: stonePbr.map,
    normalMap: stonePbr.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: stonePbr.roughnessMap,
    aoMap: stonePbr.aoMap,
    aoMapIntensity: 0.75,
    roughness: 0.88,
    metalness: 0.1,
  });
  if (snowUniforms) {
    applySnowAndMacroBreakup(stoneMat, snowUniforms, { snowThreshold: 0.54, cacheId: 'portal_stone' });
  }

  // Craggy Cavern Mound Backdrop
  for (let i = 0; i < 6; i++) {
    const angle = (i / 5) * Math.PI - Math.PI / 2;
    const boulder = new THREE.Mesh(new THREE.DodecahedronGeometry(2.2 + (i % 2) * 0.6, 1), stoneMat);
    boulder.position.set(Math.sin(angle) * 3.1, 1.4 + Math.cos(angle) * 1.4, -1.35);
    boulder.castShadow = true;
    boulder.receiveShadow = true;
    group.add(boulder);
  }

  // Carved Stone Archway Frame
  const arch = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.52, 8, 18, Math.PI), stoneMat);
  arch.position.set(0, 1.85, 0.1);
  arch.castShadow = true;
  group.add(arch);

  [-1, 1].forEach((side) => {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 1.3), stoneMat);
    pier.position.set(side * 2.15, 1.0, 0.1);
    pier.castShadow = true;
    group.add(pier);

    const torch = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.24, 0),
      new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: accentHex, emissiveIntensity: 2.3 })
    );
    torch.position.set(side * 2.65, 2.35, 0.72);
    group.add(torch);
  });

  // Recessed Dark Cavern Maw + Arcane Threshold Glow
  const voidBacking = new THREE.Mesh(
    new THREE.CylinderGeometry(1.85, 1.85, 1.6, 16, 1, false, 0, Math.PI),
    new THREE.MeshBasicMaterial({ color: 0x030508, side: THREE.DoubleSide })
  );
  voidBacking.rotation.z = Math.PI / 2;
  voidBacking.rotation.y = Math.PI / 2;
  voidBacking.position.set(0, 1.75, -0.55);
  group.add(voidBacking);

  const portalGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.1, 3.3),
    new THREE.MeshBasicMaterial({
      color: accentHex,
      transparent: true,
      opacity: 0.36,
      side: THREE.DoubleSide,
    })
  );
  portalGlow.position.set(0, 1.68, -0.15);
  group.add(portalGlow);

  return { group, portalGlow };
}

export function createTreasureChestModel(woodPbr: PBRTextureSet): THREE.Group {
  const group = new THREE.Group();
  group.add(createContactShadow(0.95, 0.7));
  const woodMat = new THREE.MeshStandardMaterial({
    map: woodPbr.map,
    bumpMap: woodPbr.bumpMap,
    bumpScale: 0.04,
    roughness: 0.75,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xd97706,
    emissiveIntensity: 0.45,
    metalness: 0.88,
    roughness: 0.2,
  });

  const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.65, 0.9), woodMat);
  base.position.y = 0.33;
  base.castShadow = true;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.32, 10, 1, false, 0, Math.PI), woodMat);
  lid.rotation.z = Math.PI / 2;
  lid.position.y = 0.65;
  const band1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.96), goldMat);
  band1.position.set(-0.42, 0.35, 0);
  const band2 = band1.clone();
  band2.position.x = 0.42;
  const lock = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), goldMat);
  lock.position.set(0, 0.62, 0.48);
  group.add(base, lid, band1, band2, lock);
  return group;
}

