import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { soundEngine } from '../audio/soundEngine';
import physicsConfig from '../data/physics.json';
import elementReactions from '../data/element_reactions.json';
import { FloatingOrigin } from '../core/FloatingOrigin';
import { FixedStepLoop } from '../core/GameLoop';
import { InputManager } from '../core/InputManager';
import { WorldClock } from '../core/WorldClock';
import { SeaLifeSystem } from '../entities/sealife/SeaLifeSystem';
import { createShipModel, SHIP_SPECS } from '../entities/ships/ShipBuilder';
import { CannonballRuntime, ShipRuntime, stepShipBuoyancyAndPhysics } from '../entities/ships/ShipPhysics';
import { CircleCollider, IceBridgePatch, resolveCameraCollision, stepPlayerPhysics } from '../entities/PhysicsWorld';
import {
  createPhotorealTerrainMaterial,
  createProceduralNightEquirectEnv,
  createSnowSparkleNormalMap,
  createStonePBRTextures,
  createTerrainDetailTextures,
  createWoodPBRTextures,
  PBRTextureSet,
  SnowShaderUniforms,
} from '../render/MaterialLibrary';
import { ParticlePool } from '../render/ParticlePool';
import { CombatFX, FxTarget } from './CombatFX';
import { RenderPipeline } from '../render/RenderPipeline';
import { SkyAndWeather } from '../render/SkyAndWeather';
import {
  BiomeId,
  BiomeState,
  CompassMarker,
  DiveHudState,
  DungeonZoneInfo,
  ElementType,
  FactionId,
  GraphicsPreset,
  MiniMapEntity,
  NearbyPrompt,
  NpcState,
  OutpostState,
  PerfTelemetry,
  PlayerState,
  ResolvedGraphicsTier,
  SceneMusicSignals,
  SealShrineState,
  SeasonType,
  ShipHudState,
  ShipType,
  TimeOfDay,
  TradeRouteState,
  WeatherType,
} from '../types/game';
import { ChunkStreamer } from '../world/ChunkStreamer';
import { buildWorldArchitectureAndHarbors, HarborDockAnchor } from '../world/POIGenerator';
import { getBiomeAt, groundHeightAt, isWaterAt, WATER_LEVEL } from '../world/TerrainHeightfield';
import { VegetationSystem } from '../world/VegetationSystem';
import { LivingSettlementSystem } from '../world/LivingSettlementSystem';
import { generateSeaWrecks, SalvageWreckDef, WORLD_POIS } from '../world/ocean/ArchipelagoGen';
import { OceanSurface } from '../world/ocean/OceanSurface';
import { OceanWaveSampler } from '../world/ocean/OceanWaveSampler';
import { detectInitialGpuTier, GRAPHICS_PRESETS, GraphicsTierConfig, resolveTierFromPreset } from './graphicsPresets';
import {
  AnimalModelParts,
  applySnowAndMacroBreakup,
  ArticulatedPlayer,
  createAnimalModel,
  createCaravanModel,
  createCentralSpireModel,
  createClimbableTowerModel,
  createDragonModel,
  createDungeonPortalModel,
  createEnemyModel,
  createMysticModel,
  createNpcModel,
  createOutpostModel,
  createPlayerModel,
  createResourceNodeModel,
  createSealShrineModel,
  createTreasureChestModel,
  DragonModelParts,
  EnemyModelParts,
} from './models';
import type { Character, CharacterAppearance } from './characters.js';

export type EngineGameMode = 'title' | 'playing' | 'paused';

interface ResourceNodeRuntime {
  id: string;
  itemId: string;
  biomeId: BiomeId;
  x: number;
  z: number;
  available: boolean;
  respawnTimer: number;
  mesh: THREE.Group;
}

interface EnemyRuntime {
  id: string;
  kind: 'wraith' | 'golem' | 'stalker' | 'ember_dragon' | 'frost_dragon';
  name: string;
  biomeId: BiomeId;
  x: number;
  z: number;
  homeX: number;
  homeZ: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnTimer: number;
  primedElement: ElementType | null;
  primeTimer: number;
  stunTimer: number;
  attackCooldown: number;
  windupTimer: number;
  hitFlashTimer: number;
  isDragon?: boolean;
  isDungeonMob?: boolean;
  parts?: EnemyModelParts;
  dragonParts?: DragonModelParts;
}

interface AnimalRuntime {
  id: string;
  kind: 'stag' | 'wolf' | 'eagle';
  x: number;
  y: number;
  z: number;
  homeX: number;
  homeZ: number;
  angle: number;
  speed: number;
  parts: AnimalModelParts;
}

interface MysticRuntime {
  id: string;
  kind: 'unicorn' | 'phoenix' | 'wisp';
  x: number;
  y: number;
  z: number;
  homeX: number;
  homeZ: number;
  angle: number;
  parts: { group: THREE.Group; wings: THREE.Group[]; ring?: THREE.Mesh };
}

interface DungeonPortalDef {
  id: string;
  name: string;
  biomeId: BiomeId;
  x: number;
  z: number;
  accentHex: number;
  cleared: boolean;
  mesh: THREE.Group;
}

interface DungeonChestRuntime {
  id: string;
  x: number;
  z: number;
  opened: boolean;
  rewardItem: string;
  rewardGold: number;
  mesh: THREE.Group;
}

interface BrushPatchRuntime {
  id: string;
  x: number;
  z: number;
  burningTimer: number;
  burnedOut: boolean;
  mesh: THREE.Mesh;
}

interface IceBridgeRuntime extends IceBridgePatch {
  timer: number;
  mesh: THREE.Mesh;
}

interface UpdraftRuntime {
  x: number;
  z: number;
  timer: number;
  mesh: THREE.Mesh;
}

interface MagicLightEntry {
  light: THREE.PointLight;
  baseIntensity: number;
  flicker?: boolean;
  worldX: number;
  worldY: number;
  worldZ: number;
}

export interface WorldCallbacks {
  onCombatLog: (text: string, tone: 'damage' | 'combo' | 'heal' | 'world' | 'quest' | 'warning') => void;
  onPlayerStatsUpdate: (patch: Partial<PlayerState>) => void;
  onGainXpAndGold: (xp: number, gold: number) => void;
  onHarvestItem: (itemId: string, qty: number, biomeId: BiomeId) => void;
  onEnemyDefeated: (kind: 'wraith' | 'golem' | 'stalker', biomeId: BiomeId, enemyId: string) => void;
  onBiomeDiscover: (biomeId: BiomeId) => void;
  onPoiDiscover: (poiId: string, name: string) => void;
  onInteractPrompt: (prompts: NearbyPrompt[]) => void;
  onTriggerInteract: (target: { kind: NearbyPrompt['kind']; id: string }) => void;
  onHudTick: (info: {
    currentBiome: BiomeId;
    timeOfDay: TimeOfDay;
    timeOfDayIndex: number;
    fps: number;
    cameraYaw: number;
    miniMapEntities: MiniMapEntity[];
    compassMarkers: CompassMarker[];
    activeDungeon: DungeonZoneInfo | null;
    telemetry: PerfTelemetry;
    shipHud: ShipHudState | null;
    diveHud: DiveHudState;
    sceneMusicSignals: SceneMusicSignals;
  }) => void;
}

const _proj = new THREE.Vector3();
const _lightDir = new THREE.Vector3(0.45, 0.56, 0.42).normalize();
const _shipQuat = new THREE.Quaternion();
const _shipEuler = new THREE.Euler(0, 0, 0, 'YXZ');

export class WorldEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl = false;
  private frameId = 0;
  private disposed = false;
  private gameMode: EngineGameMode = 'title';

  // Core systems
  private readonly loop = new FixedStepLoop(60);
  private readonly clockState = new WorldClock();
  private readonly origin = new FloatingOrigin();
  private readonly input: InputManager;

  // Graphics & Rendering
  private requestedPreset: GraphicsPreset = 'auto';
  private detectedGpuTier: ResolvedGraphicsTier = 'high';
  private tierConfig: GraphicsTierConfig = GRAPHICS_PRESETS.high;
  private readonly pipeline = new RenderPipeline();
  private csm: CSM | null = null;
  private readonly csmMaterials = new Set<THREE.Material>();
  private keySunLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private skyWeather!: SkyAndWeather;
  private particlePool!: ParticlePool;
  private combatFx!: CombatFX;

  // World Subsystems
  private readonly overworldGroup = new THREE.Group();
  private readonly dungeonGroup = new THREE.Group();
  private readonly waveSampler = new OceanWaveSampler();
  private oceanSurface!: OceanSurface;
  private chunkStreamer!: ChunkStreamer;
  private vegetation!: VegetationSystem;
  private livingSettlements!: LivingSettlementSystem;
  private seaLife!: SeaLifeSystem;

  private readonly snowUniforms: SnowShaderUniforms = {
    uSnowAmount: { value: 1.0 },
    uTime: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0.45, 0.56, 0.42).normalize() },
  };
  private stonePbr!: PBRTextureSet;
  private woodPbr!: PBRTextureSet;
  private terrainPbr!: PBRTextureSet;
  private snowSparkleNormal!: THREE.DataTexture;

  // World State
  private playerState: PlayerState;
  private biomes: Record<BiomeId, BiomeState>;
  private lastBiomeHealthSnapshot: Record<BiomeId, number> = { suncrest: 48, verdant: 42, ember: 34, aether: 30 };
  private npcs: NpcState[];
  private outposts: OutpostState[];
  private seals: SealShrineState[];
  private tradeRoutes: TradeRouteState[];
  private season: SeasonType;
  private weather: WeatherType;
  private unlockedSkills: string[];
  private currentBiome: BiomeId = 'suncrest';
  private readonly discoveredBiomes = new Set<BiomeId>(['suncrest']);
  private readonly discoveredPois = new Set<string>(['poi_suncrest']);
  private lastPoiScan = -1;

  // Entities & Props
  private playerModel!: ArticulatedPlayer;
  private companionMesh: THREE.Group | null = null;
  private companionPos = new THREE.Vector3();
  private readonly npcMeshes = new Map<string, THREE.Group>();
  private readonly outpostMeshes = new Map<string, THREE.Group>();
  private readonly caravanMeshes = new Map<string, THREE.Group>();
  private readonly sealModels = new Map<string, { group: THREE.Group; crystal: THREE.Mesh; ring: THREE.Mesh; pointLight: THREE.PointLight }>();
  private centralSpire: { group: THREE.Group; crystal: THREE.Mesh; ring: THREE.Mesh; pointLight: THREE.PointLight } | null = null;
  private readonly climbTowers: { id: string; x: number; z: number; topY: number }[] = [];
  private readonly colliders: CircleCollider[] = [];
  private readonly resourceNodes: ResourceNodeRuntime[] = [];
  private readonly enemies: EnemyRuntime[] = [];
  private readonly animals: AnimalRuntime[] = [];
  private readonly mystics: MysticRuntime[] = [];
  private readonly dungeonPortals: DungeonPortalDef[] = [];
  private readonly seaWrecks: SalvageWreckDef[] = [];
  private readonly wreckMeshes = new Map<string, THREE.Group>();
  private harborAnchors: HarborDockAnchor[] = [];
  private lighthouseBeams: THREE.Group[] = [];
  private campfires: { x: number; y: number; z: number }[] = [];

  // Naval Ships & Sea Combat
  private readonly ships: ShipRuntime[] = [];
  private readonly cannonballs: CannonballRuntime[] = [];
  private activeShipId: string | null = 'ship_player';
  private atHelmShipId: string | null = null;
  private windAngleRad = 0.65;
  private windKnots = 14;

  // Dungeons & Effects
  private activeDungeon: DungeonPortalDef | null = null;
  private overworldReturnPos = { x: 0, z: 6 };
  private dungeonChests: DungeonChestRuntime[] = [];
  private dungeonEnemies: EnemyRuntime[] = [];
  private readonly brushPatches: BrushPatchRuntime[] = [];
  private readonly iceBridges: IceBridgeRuntime[] = [];
  private readonly updrafts: UpdraftRuntime[] = [];
  private readonly shockZones: { x: number; z: number; timer: number; ring: THREE.Mesh }[] = [];
  private magicPointLights: MagicLightEntry[] = [];

  // Locomotion, Combat & Camera
  private velocityY = 0;
  private smoothedMoveX = 0;
  private smoothedMoveZ = 0;
  private isGrounded = true;
  private isCrouching = false;
  private isSwimming = false;
  private isUnderwater = false;
  private oxygen = 100;
  private readonly maxOxygen = 100;
  private oxygenWarnCooldown = 0;
  private meleeComboStep = 0;
  private meleeComboResetTimer = 0;
  private attackSwingTimer = 0;
  private dodgeTimer = 0;
  private dodgeDirX = 0;
  private dodgeDirZ = 0;
  private parryWindowTimer = 0;
  private recentCombatTimer = 0;
  private hitstopTimer = 0;
  private screenShake = 0;
  private walkPhase = 0;
  private readonly lastAnimPos = new THREE.Vector3();
  private lastAnimYaw = 0;
  /** Player position at the start of the latest fixed step, for render interpolation. */
  private readonly prevSimPos = new THREE.Vector3(Number.NaN, 0, 0);
  private renderAlpha = 1;
  private readonly renderPos = new THREE.Vector3();
  private playerSquashY = 1;
  private lastFootstepPhase = 0;

  private cameraYaw = 0;
  private cameraPitch = 0.36;
  private cameraDist = 11.5;
  private readonly smoothCamTarget = new THREE.Vector3(0, 2.5, 6);
  private readonly smoothCamPos = new THREE.Vector3(0, 8, 18);
  private readonly tmpCamVec = new THREE.Vector3();

  // Throttling
  private nearestTarget: { kind: NearbyPrompt['kind']; id: string } | null = null;
  private lastHudEmit = 0;
  private lastPromptsEmit = 0;
  private slowFrameStreak = 0;
  private readonly resizeObserver: ResizeObserver | null = null;
  private readonly onResizeHandler: () => void;
  private readonly onVisibilityChange = () => {
    // Reset elapsed time after a tab switches back to the foreground.
    this.loop.reset();
    this.prevSimPos.set(Number.NaN, 0, 0);
    if (document.hidden) this.input.setEnabled(false);
    else this.input.setEnabled(this.gameMode === 'playing');
  };

  constructor(
    container: HTMLElement,
    initial: {
      player: PlayerState;
      biomes: Record<BiomeId, BiomeState>;
      npcs: NpcState[];
      outposts: OutpostState[];
      seals: SealShrineState[];
      tradeRoutes: TradeRouteState[];
      season: SeasonType;
      weather: WeatherType;
      timeOfDayIndex: number;
      unlockedSkills: string[];
      gameMode: EngineGameMode;
      graphicsPreset: GraphicsPreset;
    },
    private callbacks: WorldCallbacks
  ) {
    this.container = container;
    this.playerState = { ...initial.player };
    this.biomes = initial.biomes;
    this.lastBiomeHealthSnapshot = {
      suncrest: initial.biomes.suncrest.health,
      verdant: initial.biomes.verdant.health,
      ember: initial.biomes.ember.health,
      aether: initial.biomes.aether.health,
    };
    this.npcs = initial.npcs;
    this.outposts = initial.outposts;
    this.seals = initial.seals;
    this.tradeRoutes = initial.tradeRoutes;
    this.season = initial.season;
    this.weather = initial.weather;
    this.clockState.timeOfDayIndex = initial.timeOfDayIndex;
    this.unlockedSkills = initial.unlockedSkills;
    this.gameMode = initial.gameMode;
    this.requestedPreset = initial.graphicsPreset;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // WebGL context-loss resilience per 3D spatial guidelines
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      cancelAnimationFrame(this.frameId);
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.applyGraphicsTier(true);
      this.scheduleNextFrame();
    });

    try {
      const gl = this.renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const rStr = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
      this.isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software/i.test(rStr);
    } catch {
      this.isSoftwareGl = false;
    }
    this.detectedGpuTier = detectInitialGpuTier(this.renderer, this.isSoftwareGl);
    this.tierConfig = GRAPHICS_PRESETS[resolveTierFromPreset(this.requestedPreset, this.detectedGpuTier)];

    this.scene = new THREE.Scene();
    this.scene.environment = createProceduralNightEquirectEnv(this.renderer);
    this.scene.environmentIntensity = 0.85;
    this.scene.add(this.overworldGroup);
    this.dungeonGroup.visible = false;
    this.scene.add(this.dungeonGroup);

    this.camera = new THREE.PerspectiveCamera(56, w / h, 0.25, 1150);

    // Input Manager
    this.input = new InputManager(this.renderer.domElement, {
      isPlaying: () => this.gameMode === 'playing',
      onFirstGesture: () => soundEngine.initOnGesture(),
      onJump: () => this.handleJumpAction(),
      onInteract: () => this.handleInteractAction(),
      onMelee: () => {
        if (this.atHelmShipId) this.fireBroadsideCannons();
        else this.performMeleeAttack();
      },
      onCastSpell: (el) => this.castElementalSpell(el),
      onDodge: () => this.performDodgeRoll(),
      onToggleAnchor: () => this.toggleShipAnchor(),
      onToggleCrouch: () => {
        if (!this.isSwimming && !this.atHelmShipId) {
          this.isCrouching = !this.isCrouching;
        }
      },
    });
    this.input.setEnabled(this.gameMode === 'playing');

    this.initTexturesAndLighting();
    this.initWorldAndEntities();
    this.applyGraphicsTier(true);

    this.onResizeHandler = () => {
      const rw = this.container.clientWidth || window.innerWidth;
      const rh = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = rw / rh;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(rw, rh);
      this.pipeline.setSize(rw, rh);
      this.csm?.updateFrustums();
    };
    window.addEventListener('resize', this.onResizeHandler);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.onResizeHandler);
      this.resizeObserver.observe(this.container);
    }

    this.loop.reset();
    this.scheduleNextFrame();
  }

  private initTexturesAndLighting() {
    const aniso = Math.min(this.renderer.capabilities.getMaxAnisotropy(), this.tierConfig.anisotropyMax);
    this.stonePbr = createStonePBRTextures(aniso, this.tierConfig.textureResolution);
    this.woodPbr = createWoodPBRTextures(aniso, 512);
    this.terrainPbr = createTerrainDetailTextures(aniso, 512);
    this.snowSparkleNormal = createSnowSparkleNormalMap(aniso);
    this.snowUniforms.uSnowAmount.value = this.season === 'Winter' ? 1.0 : 0.0;

    this.hemiLight = new THREE.HemisphereLight(0x7ca6e8, 0x2a3b57, 0.92);
    this.scene.add(this.hemiLight);

    this.keySunLight = new THREE.DirectionalLight(0xc2dcff, 2.05);
    this.keySunLight.position.set(52, 68, 44);
    this.keySunLight.castShadow = true;
    this.keySunLight.shadow.mapSize.set(this.tierConfig.shadowMapSize, this.tierConfig.shadowMapSize);
    this.keySunLight.shadow.camera.near = 2;
    this.keySunLight.shadow.camera.far = 210;
    const d = 62;
    this.keySunLight.shadow.camera.left = -d;
    this.keySunLight.shadow.camera.right = d;
    this.keySunLight.shadow.camera.top = d;
    this.keySunLight.shadow.camera.bottom = -d;
    this.keySunLight.shadow.bias = -0.0005;
    this.keySunLight.shadow.normalBias = 0.03;
    this.scene.add(this.keySunLight);
    this.scene.add(this.keySunLight.target);

    this.skyWeather = new SkyAndWeather(this.scene, this.tierConfig.snowCount);
    this.overworldGroup.add(this.skyWeather.group);

    this.particlePool = new ParticlePool(512);
    this.scene.add(this.particlePool.mesh);
    this.combatFx = new CombatFX(this.scene, this.origin, (x, y, z, c, n) => this.particlePool.spawnBurst(x, y, z, c, n));
  }

  private initWorldAndEntities() {
    // 1. Web Worker Streamed Photoreal Terrain
    const terrainMat = createPhotorealTerrainMaterial(
      this.terrainPbr,
      this.stonePbr,
      this.snowSparkleNormal,
      this.snowUniforms
    );
    this.registerCsmMaterial(terrainMat);
    this.chunkStreamer = new ChunkStreamer(terrainMat, this.origin.originX, this.origin.originZ);
    this.chunkStreamer.initAround(
      this.playerState.x,
      this.playerState.z,
      this.origin.originX,
      this.origin.originZ,
      this.biomes,
      this.season
    );
    this.overworldGroup.add(this.chunkStreamer.group);

    // 2. Gerstner Ocean & Rivers Surface
    this.oceanSurface = new OceanSurface();
    this.oceanSurface.followPlayer(this.playerState.x, this.playerState.z, this.origin.originX, this.origin.originZ);
    this.overworldGroup.add(this.oceanSurface.mesh);

    // 3. Sculpted Non-Cone Pine Bough Foliage, Rocks & Grass
    this.vegetation = new VegetationSystem(
      this.tierConfig.treeCount,
      this.tierConfig.grassCount,
      Math.min(this.renderer.capabilities.getMaxAnisotropy(), this.tierConfig.anisotropyMax),
      this.stonePbr,
      this.woodPbr,
      this.snowUniforms
    );
    this.vegetation.populateAround(
      this.playerState.x,
      this.playerState.z,
      this.origin.originX,
      this.origin.originZ,
      this.season,
      true
    );
    this.overworldGroup.add(this.vegetation.group);

    // Deterministic inhabited settlements beyond the original fixed villages.
    // The streaming system creates and retires only the 3x3 nearby cell region.
    this.livingSettlements = new LivingSettlementSystem(this.stonePbr, this.woodPbr);
    this.livingSettlements.update(this.playerState.x, this.playerState.z, this.origin.originX, this.origin.originZ);
    this.overworldGroup.add(this.livingSettlements.group);

    // 4. Suncrest Citadel Plaza + Central Crystal Spire + Towns + Harbors + Lighthouses
    this.buildCitadelAndShrines();

    const arch = buildWorldArchitectureAndHarbors(this.stonePbr, this.woodPbr, this.snowUniforms);
    this.overworldGroup.add(arch.group);
    this.harborAnchors = arch.harborAnchors;
    this.lighthouseBeams = arch.lighthouseBeams;
    this.campfires = arch.campfires;
    this.colliders.push(...arch.staticColliders);

    // 5. Sea Wrecks & Marine Life
    this.seaWrecks.push(...generateSeaWrecks());
    this.seaWrecks.forEach((w) => {
      const mesh = createTreasureChestModel(this.woodPbr);
      mesh.position.set(w.x, w.depthY, w.z);
      mesh.rotation.y = w.x * 0.2;
      this.overworldGroup.add(mesh);
      this.wreckMeshes.set(w.id, mesh);
    });

    this.seaLife = new SeaLifeSystem();
    this.overworldGroup.add(this.seaLife.group);

    // 6. Sailing Ships (Starter Player Sloop moored at Suncrest Haven Port + AI Merchant + Pirate Brigs!)
    this.spawnInitialFleet();

    // 7. World Interactive Entities (NPCs, Outposts, Resources, Brush, Monsters, Fauna, Dragons, Dungeons)
    this.setupNpcsAndInteractiveProps();
    this.setupFaunaAndDragons();

    // 8. Player Character
    this.playerModel = createPlayerModel(this.playerState.appearance);
    const py = groundHeightAt(this.playerState.x, this.playerState.z);
    this.playerState.y = Math.max(py, this.playerState.y);
    this.playerModel.group.position.set(this.playerState.x, this.playerState.y, this.playerState.z);
    this.scene.add(this.playerModel.group);
    this.syncCompanionMesh(this.playerState.companionId);

    this.smoothCamTarget.set(this.playerState.x, this.playerState.y + 1.8, this.playerState.z);
    this.smoothCamPos.set(this.playerState.x, this.playerState.y + 6.5, this.playerState.z + 11.5);
  }

  private buildCitadelAndShrines() {
    const stoneMat = new THREE.MeshStandardMaterial({
      map: this.stonePbr.map,
      normalMap: this.stonePbr.normalMap,
      roughnessMap: this.stonePbr.roughnessMap,
      aoMap: this.stonePbr.aoMap,
      roughness: 0.86,
      metalness: 0.08,
      color: 0x7b899e,
    });
    applySnowAndMacroBreakup(stoneMat, this.snowUniforms, { snowThreshold: 0.5, cacheId: 'citadel_stone' });
    this.registerCsmMaterial(stoneMat);

    // Circular Shrine Plaza
    const plazaY = groundHeightAt(0, 0);
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(16, 16.8, 0.65, 32), stoneMat);
    plinthPos(plaza, 0, plazaY + 0.15, 0);
    plaza.receiveShadow = true;
    this.overworldGroup.add(plaza);

    // Four Outer Seal Pillars around the Sanctuary Plaza
    const pillarMat = stoneMat;
    const runeMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 1.8 });
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      const px = Math.cos(a) * 11.2;
      const pz = Math.sin(a) * 11.2;
      const col = new THREE.Mesh(new THREE.BoxGeometry(1.1, 4.2, 1.1), pillarMat);
      col.position.set(px, plazaY + 2.2, pz);
      col.castShadow = true;
      col.receiveShadow = true;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), runeMat);
      gem.position.set(px, plazaY + 4.8, pz);
      this.overworldGroup.add(col, gem);
      this.colliders.push({ x: px, z: pz, radius: 0.85 });
    }

    // Central White Crystal Spire
    this.centralSpire = createCentralSpireModel(this.stonePbr, this.snowUniforms, false);
    this.centralSpire.group.position.set(0, plazaY + 0.45, 0);
    this.overworldGroup.add(this.centralSpire.group);
    this.colliders.push({ x: 0, z: 0, radius: 2.3 });
    this.magicPointLights.push({
      light: this.centralSpire.pointLight,
      baseIntensity: 15.0,
      worldX: 0,
      worldY: plazaY + 5.0,
      worldZ: 0,
    });

    // Ruined Cyan Tower nearby + Climbable Watchtowers
    [
      { id: 'tower_north', x: 18, z: -18 },
      { id: 'tower_west', x: -38, z: 18 },
      { id: 'tower_ember', x: 42, z: 12 },
      { id: 'tower_aether', x: -16, z: -56 },
    ].forEach((tw) => {
      const tm = createClimbableTowerModel(this.stonePbr, this.snowUniforms);
      const ty = groundHeightAt(tw.x, tw.z);
      tm.group.position.set(tw.x, ty, tw.z);
      this.overworldGroup.add(tm.group);
      this.colliders.push({ x: tw.x, z: tw.z, radius: 1.9 });
      this.climbTowers.push({ id: tw.id, x: tw.x, z: tw.z, topY: ty + 9.4 });
      this.magicPointLights.push({
        light: tm.pointLight,
        baseIntensity: 4.5,
        worldX: tw.x,
        worldY: ty + 5.2,
        worldZ: tw.z,
      });
    });

    // Four Elemental Seal Shrines
    this.seals.forEach((seal) => {
      const m = createSealShrineModel(seal.element, seal.status, this.stonePbr, this.snowUniforms, false);
      const sy = groundHeightAt(seal.x, seal.z);
      m.group.position.set(seal.x, sy, seal.z);
      this.overworldGroup.add(m.group);
      this.sealModels.set(seal.id, m);
      this.magicPointLights.push({
        light: m.pointLight,
        baseIntensity: seal.status === 'purified' ? 11.0 : 7.8,
        worldX: seal.x,
        worldY: sy + 2.9,
        worldZ: seal.z,
      });
    });

    // Outposts
    this.outposts.forEach((op) => {
      const m = createOutpostModel(op.level, this.stonePbr, this.woodPbr, this.snowUniforms);
      m.position.set(op.x, groundHeightAt(op.x, op.z), op.z);
      this.overworldGroup.add(m);
      this.outpostMeshes.set(op.id, m);
    });

    // Dungeon Cave Portals
    const dSpecs = [
      { id: 'dungeon_suncrest', name: 'Vault of Dawnlight', biomeId: 'suncrest' as BiomeId, x: 32, z: -28, accentHex: 0x38bdf8 },
      { id: 'dungeon_verdant', name: 'Rootbound Hollow', biomeId: 'verdant' as BiomeId, x: -58, z: 62, accentHex: 0x10b981 },
      { id: 'dungeon_ember', name: 'Obsidian Caldera', biomeId: 'ember' as BiomeId, x: 72, z: 58, accentHex: 0xf97316 },
      { id: 'dungeon_aether', name: 'Rimefrost Sanctum', biomeId: 'aether' as BiomeId, x: -28, z: -88, accentHex: 0xa855f7 },
    ];
    dSpecs.forEach((ds) => {
      const pm = createDungeonPortalModel(ds.accentHex, this.stonePbr);
      pm.group.position.set(ds.x, groundHeightAt(ds.x, ds.z), ds.z);
      this.overworldGroup.add(pm.group);
      this.dungeonPortals.push({ ...ds, cleared: false, mesh: pm.group });
    });
  }

  private spawnInitialFleet() {
    const playerType: ShipType = this.playerState.ownedShipType || 'sloop';
    const playerParts = createShipModel(playerType, this.woodPbr, { isHostile: false, sailHex: 0xfef3c7 });
    playerParts.group.position.set(-22, WATER_LEVEL, 114);
    this.overworldGroup.add(playerParts.group);
    this.ships.push({
      id: 'ship_player',
      name: SHIP_SPECS[playerType].label,
      type: playerType,
      isPlayerOwned: true,
      isHostile: false,
      x: -22,
      y: WATER_LEVEL,
      z: 114,
      heading: 0.25,
      vx: 0,
      vz: 0,
      angularVel: 0,
      pitch: 0,
      roll: 0,
      hull: SHIP_SPECS[playerType].maxHull,
      maxHull: SHIP_SPECS[playerType].maxHull,
      sailSetting: 0,
      anchored: true,
      cannonCooldown: 0,
      respawnTimer: 0,
      parts: playerParts,
    });

    // AI Merchant Sloop + Hostile Corsair Brigantines patrolling the Sapphire Ocean
    const aiFleet: Array<{ id: string; name: string; type: ShipType; isHostile: boolean; x: number; z: number; heading: number }> = [
      { id: 'ship_merchant_1', name: 'Golden Tide Trader', type: 'sloop', isHostile: false, x: 24, z: 138, heading: 1.4 },
      { id: 'ship_pirate_1', name: 'Ashsail Raider', type: 'brigantine', isHostile: true, x: -64, z: 162, heading: 0.8 },
      { id: 'ship_pirate_2', name: 'Stormblood Brig', type: 'brigantine', isHostile: true, x: 74, z: 185, heading: -1.1 },
    ];
    aiFleet.forEach((af) => {
      const parts = createShipModel(af.type, this.woodPbr, { isHostile: af.isHostile });
      parts.group.position.set(af.x, WATER_LEVEL, af.z);
      this.overworldGroup.add(parts.group);
      this.ships.push({
        id: af.id,
        name: af.name,
        type: af.type,
        isPlayerOwned: false,
        isHostile: af.isHostile,
        x: af.x,
        y: WATER_LEVEL,
        z: af.z,
        heading: af.heading,
        vx: 0,
        vz: 0,
        angularVel: 0,
        pitch: 0,
        roll: 0,
        hull: SHIP_SPECS[af.type].maxHull * 0.75,
        maxHull: SHIP_SPECS[af.type].maxHull * 0.75,
        sailSetting: 0.55,
        anchored: false,
        cannonCooldown: 0,
        respawnTimer: 0,
        parts,
      });
    });
  }

  private setupNpcsAndInteractiveProps() {
    this.npcs.forEach((npc) => {
      const mesh = createNpcModel(npc.factionId, npc.isCompanionCapable, npc.id);
      mesh.position.set(npc.x, groundHeightAt(npc.x, npc.z), npc.z);
      this.overworldGroup.add(mesh);
      this.npcMeshes.set(npc.id, mesh);
    });

    this.tradeRoutes.forEach((route) => {
      const mesh = createCaravanModel(route.factionId, this.woodPbr);
      const cx = THREE.MathUtils.lerp(route.fromCoord.x, route.toCoord.x, route.progress);
      const cz = THREE.MathUtils.lerp(route.fromCoord.z, route.toCoord.z, route.progress);
      mesh.position.set(cx, groundHeightAt(cx, cz), cz);
      this.overworldGroup.add(mesh);
      this.caravanMeshes.set(route.id, mesh);
    });

    const nodeSpecs: { itemId: string; x: number; z: number }[] = [
      { itemId: 'sunleaf_herb', x: -38, z: 32 },
      { itemId: 'sunleaf_herb', x: -56, z: 42 },
      { itemId: 'sunleaf_herb', x: -96, z: 74 },
      { itemId: 'ancient_timber', x: -24, z: 22 },
      { itemId: 'ancient_timber', x: -62, z: 24 },
      { itemId: 'gale_feather', x: -50, z: 12 },
      { itemId: 'gale_feather', x: 16, z: -32 },
      { itemId: 'ember_ore', x: 38, z: 28 },
      { itemId: 'ember_ore', x: 52, z: 36 },
      { itemId: 'ember_ore', x: 98, z: 44 },
      { itemId: 'runed_stone', x: 22, z: 14 },
      { itemId: 'runed_stone', x: -14, z: 16 },
      { itemId: 'storm_crystal', x: -16, z: -48 },
      { itemId: 'storm_crystal', x: 16, z: -58 },
      { itemId: 'frost_lotus', x: -30, z: -44 },
      { itemId: 'frost_lotus', x: 22, z: -66 },
    ];
    nodeSpecs.forEach((spec, i) => {
      const y = groundHeightAt(spec.x, spec.z);
      const mesh = createResourceNodeModel(spec.itemId);
      mesh.position.set(spec.x, Math.max(WATER_LEVEL + 0.15, y), spec.z);
      this.overworldGroup.add(mesh);
      this.resourceNodes.push({
        id: `res_${i}`,
        itemId: spec.itemId,
        biomeId: getBiomeAt(spec.x, spec.z),
        x: spec.x,
        z: spec.z,
        available: true,
        respawnTimer: 0,
        mesh,
      });
    });

    // Blight Brush Patches in Verdant Vale & Outer Lands (flammable with Fire [1])
    [
      { x: -42, z: 30 },
      { x: -52, z: 48 },
      { x: -30, z: 44 },
    ].forEach((bp, i) => {
      const m = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1.75, 1),
        new THREE.MeshStandardMaterial({ color: 0x3b2448, roughness: 0.9 })
      );
      m.scale.set(1.2, 0.55, 1.2);
      m.position.set(bp.x, groundHeightAt(bp.x, bp.z) + 0.35, bp.z);
      this.overworldGroup.add(m);
      this.brushPatches.push({ id: `brush_${i}`, x: bp.x, z: bp.z, burningTimer: 0, burnedOut: false, mesh: m });
    });

    const enemySpecs: { kind: 'wraith' | 'golem' | 'stalker'; name: string; x: number; z: number; id?: string }[] = [
      { kind: 'wraith', name: 'Blight Wraith', x: -46, z: 38 },
      { kind: 'wraith', name: 'Grove Stalker Wraith', x: -60, z: 54 },
      { kind: 'golem', name: 'Obsidian Ash Golem', x: 48, z: 36 },
      { kind: 'golem', name: 'Crag Sentinel Golem', x: 62, z: 52 },
      { kind: 'stalker', name: 'Tempest Stalker', x: -12, z: -64 },
      { kind: 'stalker', name: 'Spire Arc Hunter', x: 14, z: -68 },
      // Frontier guardians are placed outside each island's central waystones.
      { kind: 'stalker', name: 'Moonveil Oathkeeper', id: 'guardian_moonveil', x: -254, z: 341 },
      { kind: 'wraith', name: 'Moonlit Remnant', x: -297, z: 321 },
      { kind: 'golem', name: 'Thornheart Sentinel', id: 'guardian_thornwild', x: -74, z: 427 },
      { kind: 'wraith', name: 'Rootbound Shade', x: -112, z: 385 },
      { kind: 'golem', name: 'Crownfire Guardian', id: 'guardian_ashen', x: 244, z: 383 },
      { kind: 'stalker', name: 'Ashen Watcher', x: 204, z: 340 },
      { kind: 'stalker', name: 'Stormglass Harbinger', id: 'guardian_stormglass', x: 54, z: 547 },
      { kind: 'wraith', name: 'Navigator Echo', x: 15, z: 511 },
    ];
    enemySpecs.forEach((es, i) => {
      const parts = createEnemyModel(es.kind);
      parts.group.position.set(es.x, groundHeightAt(es.x, es.z), es.z);
      this.overworldGroup.add(parts.group);
      const maxHp = es.kind === 'golem' ? 140 : es.kind === 'stalker' ? 110 : 90;
      this.enemies.push({
        id: es.id ?? `enemy_${i}`,
        kind: es.kind,
        name: es.name,
        biomeId: getBiomeAt(es.x, es.z),
        x: es.x,
        z: es.z,
        homeX: es.x,
        homeZ: es.z,
        hp: maxHp,
        maxHp,
        alive: true,
        respawnTimer: 0,
        primedElement: null,
        primeTimer: 0,
        stunTimer: 0,
        attackCooldown: 0,
        windupTimer: 0,
        hitFlashTimer: 0,
        parts,
      });
    });
  }

  private setupFaunaAndDragons() {
    const animalSpecs: { kind: 'stag' | 'wolf' | 'eagle'; x: number; z: number }[] = [
      { kind: 'stag', x: -24, z: 18 },
      { kind: 'stag', x: -52, z: 18 },
      { kind: 'stag', x: 24, z: -48 },
      { kind: 'wolf', x: -38, z: 52 },
      { kind: 'wolf', x: 36, z: -18 },
      { kind: 'eagle', x: -10, z: -10 },
      { kind: 'eagle', x: 55, z: 32 },
      { kind: 'eagle', x: 0, z: -70 },
    ];
    animalSpecs.forEach((sp, i) => {
      const parts = createAnimalModel(sp.kind);
      const y = sp.kind === 'eagle' ? 22 + (i % 3) * 4 : groundHeightAt(sp.x, sp.z);
      parts.group.position.set(sp.x, y, sp.z);
      this.overworldGroup.add(parts.group);
      this.animals.push({
        id: `animal_${i}`,
        kind: sp.kind,
        x: sp.x,
        y,
        z: sp.z,
        homeX: sp.x,
        homeZ: sp.z,
        angle: i * 1.4,
        speed: sp.kind === 'eagle' ? 6.5 : sp.kind === 'wolf' ? 3.2 : 2.1,
        parts,
      });
    });

    const mysticSpecs: { kind: 'unicorn' | 'phoenix' | 'wisp'; x: number; z: number }[] = [
      { kind: 'unicorn', x: -48, z: 46 },
      { kind: 'phoenix', x: 22, z: -14 },
      { kind: 'phoenix', x: 76, z: 34 },
      { kind: 'wisp', x: 12, z: 8 },
      { kind: 'wisp', x: -32, z: 30 },
      { kind: 'wisp', x: -26, z: -84 },
    ];
    mysticSpecs.forEach((sp, i) => {
      const parts = createMysticModel(sp.kind);
      const y = sp.kind === 'phoenix' ? 16 + i * 2 : groundHeightAt(sp.x, sp.z);
      parts.group.position.set(sp.x, y, sp.z);
      this.overworldGroup.add(parts.group);
      this.mystics.push({
        id: `mystic_${i}`,
        kind: sp.kind,
        x: sp.x,
        y,
        z: sp.z,
        homeX: sp.x,
        homeZ: sp.z,
        angle: i * 1.1,
        parts,
      });
    });

    const dragonSpecs: { variant: 'ember_dragon' | 'frost_dragon'; name: string; biomeId: BiomeId; x: number; z: number }[] = [
      { variant: 'ember_dragon', name: 'Ignathar, Crimson Wyvern', biomeId: 'ember', x: 82, z: 28 },
      { variant: 'frost_dragon', name: 'Glaciera, Frost Wyrm', biomeId: 'aether', x: -16, z: -102 },
    ];
    dragonSpecs.forEach((ds, i) => {
      const dragonParts = createDragonModel(ds.variant);
      dragonParts.group.position.set(ds.x, groundHeightAt(ds.x, ds.z), ds.z);
      this.overworldGroup.add(dragonParts.group);
      this.enemies.push({
        id: `dragon_${i}`,
        kind: ds.variant,
        name: ds.name,
        biomeId: ds.biomeId,
        x: ds.x,
        z: ds.z,
        homeX: ds.x,
        homeZ: ds.z,
        hp: 260,
        maxHp: 260,
        alive: true,
        respawnTimer: 0,
        primedElement: null,
        primeTimer: 0,
        stunTimer: 0,
        attackCooldown: 0,
        windupTimer: 0,
        hitFlashTimer: 0,
        isDragon: true,
        dragonParts,
      });
    });
  }

  private registerCsmMaterial(mat: THREE.Material) {
    this.csmMaterials.add(mat);
    this.csm?.setupMaterial(mat);
  }

  public setGraphicsPreset(preset: GraphicsPreset) {
    if (this.requestedPreset === preset) return;
    this.requestedPreset = preset;
    this.applyGraphicsTier(false);
  }

  private applyGraphicsTier(initial = false) {
    const resolved = resolveTierFromPreset(this.requestedPreset, this.detectedGpuTier);
    const prevTier = this.tierConfig.tier;
    this.tierConfig = GRAPHICS_PRESETS[resolved];
    if (!initial && prevTier === resolved) return;

    this.renderer.shadowMap.enabled = this.tierConfig.shadowsEnabled;
    this.keySunLight.castShadow = !this.tierConfig.useCsm && this.tierConfig.shadowsEnabled;

    this.csm?.remove();
    this.csm?.dispose();
    this.csm = null;
    if (this.tierConfig.useCsm && this.tierConfig.shadowsEnabled) {
      this.csm = new CSM({
        maxFar: 165,
        cascades: this.tierConfig.csmCascades,
        mode: 'practical',
        parent: this.scene,
        shadowMapSize: this.tierConfig.shadowMapSize,
        lightDirection: _lightDir.clone().negate(),
        camera: this.camera,
      });
      this.csm.fade = true;
      this.csmMaterials.forEach((m) => this.csm?.setupMaterial(m));
    }

    this.pipeline.rebuild(this.renderer, this.scene, this.camera, this.tierConfig, this.isSoftwareGl);
  }

  public setGameMode(mode: EngineGameMode) {
    this.gameMode = mode;
    if (mode !== 'playing') {
      this.smoothedMoveX = 0;
      this.smoothedMoveZ = 0;
    }
    this.input.setEnabled(mode === 'playing');
  }

  public setTimeOfDayIndex(index: number) {
    this.clockState.timeOfDayIndex = ((index % 1) + 1) % 1;
  }

  /**
   * CRITICAL PERFORMANCE FIX: Only rebuilds terrain chunks if biome health changed meaningfully (>= 2%)
   * or season changed. High-frequency React player/clock updates never touch terrain geometry.
   */
  public syncExternalState(patch: {
    player?: PlayerState;
    biomes?: Record<BiomeId, BiomeState>;
    outposts?: OutpostState[];
    seals?: SealShrineState[];
    tradeRoutes?: TradeRouteState[];
    season?: SeasonType;
    weather?: WeatherType;
    timeOfDayIndex?: number;
    unlockedSkills?: string[];
  }) {
    let rebuildTerrain = false;

    if (patch.player) {
      const prevComp = this.playerState.companionId;
      // Preserve engine-authoritative kinematics (x, y, z, stamina) unless teleported externally
      this.playerState.hp = patch.player.hp;
      this.playerState.maxHp = patch.player.maxHp;
      this.playerState.mana = patch.player.mana;
      this.playerState.maxMana = patch.player.maxMana;
      this.playerState.level = patch.player.level;
      this.playerState.gold = patch.player.gold;
      this.playerState.moralAlignment = patch.player.moralAlignment;
      this.playerState.companionId = patch.player.companionId;
      this.playerState.equippedWeapon = patch.player.equippedWeapon;
      this.playerState.equippedRelic = patch.player.equippedRelic;
      if (prevComp !== patch.player.companionId) {
        this.syncCompanionMesh(patch.player.companionId);
      }
    }

    if (patch.biomes) {
      this.biomes = patch.biomes;
      const keys: BiomeId[] = ['suncrest', 'verdant', 'ember', 'aether'];
      for (const k of keys) {
        if (Math.abs(patch.biomes[k].health - this.lastBiomeHealthSnapshot[k]) >= 2) {
          this.lastBiomeHealthSnapshot[k] = patch.biomes[k].health;
          rebuildTerrain = true;
        }
      }
    }

    if (patch.season && patch.season !== this.season) {
      this.season = patch.season;
      this.snowUniforms.uSnowAmount.value = this.season === 'Winter' ? 1.0 : 0.0;
      rebuildTerrain = true;
      this.vegetation.populateAround(
        this.playerState.x,
        this.playerState.z,
        this.origin.originX,
        this.origin.originZ,
        this.season,
        true
      );
    }

    if (patch.weather && patch.weather !== this.weather) {
      this.weather = patch.weather;
      this.waveSampler.setWeatherSwell(this.weather);
      this.oceanSurface.uniforms.uSwellScale.value = this.waveSampler.swellScale;
    }

    if (patch.unlockedSkills) this.unlockedSkills = patch.unlockedSkills;
    if (patch.tradeRoutes) this.tradeRoutes = patch.tradeRoutes;

    if (patch.outposts) {
      patch.outposts.forEach((op) => {
        const old = this.outposts.find((o) => o.id === op.id);
        if (!old || old.level !== op.level) {
          const prev = this.outpostMeshes.get(op.id);
          if (prev) this.overworldGroup.remove(prev);
          const rebuilt = createOutpostModel(op.level, this.stonePbr, this.woodPbr, this.snowUniforms);
          rebuilt.position.set(this.origin.toLocalX(op.x), groundHeightAt(op.x, op.z), this.origin.toLocalZ(op.z));
          this.overworldGroup.add(rebuilt);
          this.outpostMeshes.set(op.id, rebuilt);
        }
      });
      this.outposts = patch.outposts;
    }

    if (patch.seals) {
      patch.seals.forEach((s) => {
        const old = this.seals.find((o) => o.id === s.id);
        if (!old || old.status !== s.status) {
          const prev = this.sealModels.get(s.id);
          if (prev) {
            this.magicPointLights = this.magicPointLights.filter((m) => m.light !== prev.pointLight);
            this.overworldGroup.remove(prev.group);
          }
          const model = createSealShrineModel(s.element, s.status, this.stonePbr, this.snowUniforms, false);
          const sy = groundHeightAt(s.x, s.z);
          model.group.position.set(this.origin.toLocalX(s.x), sy, this.origin.toLocalZ(s.z));
          this.overworldGroup.add(model.group);
          this.sealModels.set(s.id, model);
          this.magicPointLights.push({
            light: model.pointLight,
            baseIntensity: s.status === 'purified' ? 11.0 : 7.8,
            worldX: s.x,
            worldY: sy + 2.9,
            worldZ: s.z,
          });
        }
      });
      this.seals = patch.seals;
    }

    if (rebuildTerrain) {
      this.chunkStreamer.refreshVisibleChunks(this.origin.originX, this.origin.originZ, this.biomes, this.season);
    }
  }

  /** Rebuilds the player model from a new appearance (called by the character creator). */
  public setPlayerAppearance(appearance: CharacterAppearance) {
    this.playerState.appearance = appearance;
    const old = this.playerModel;
    const next = createPlayerModel(appearance);
    next.group.position.copy(old.group.position);
    next.group.rotation.copy(old.group.rotation);
    this.scene.remove(old.group);
    old.character.dispose();
    this.scene.add(next.group);
    this.playerModel = next;
  }

  private syncCompanionMesh(companionId: string | null) {
    if (this.companionMesh) {
      this.overworldGroup.remove(this.companionMesh);
      this.companionMesh = null;
    }
    if (!companionId) return;
    const npc = this.npcs.find((n) => n.id === companionId);
    this.companionMesh = createNpcModel(npc ? npc.factionId : 'verdant_circle', true, companionId);
    this.companionPos.set(this.playerState.x - 2.2, this.playerState.y, this.playerState.z + 2.0);
    this.companionMesh.position.set(
      this.origin.toLocalX(this.companionPos.x),
      this.companionPos.y,
      this.origin.toLocalZ(this.companionPos.z)
    );
    this.overworldGroup.add(this.companionMesh);
  }

  // --- Player Actions ---

  private handleJumpAction() {
    if (this.atHelmShipId) {
      this.fireBroadsideCannons();
      return;
    }
    if (this.isGrounded && !this.playerState.isClimbing && !this.isSwimming) {
      this.velocityY = 9.0;
      this.isGrounded = false;
      this.isCrouching = false;
      this.playerSquashY = 1.22;
    }
  }

  private handleInteractAction() {
    if (this.atHelmShipId) {
      this.atHelmShipId = null;
      this.playerState.isSailing = false;
      this.callbacks.onCombatLog('Released the helm. You may walk the deck or leap ashore.', 'world');
      return;
    }
    if (!this.nearestTarget) return;
    const t = this.nearestTarget;
    if (t.kind === 'dungeon_enter') this.enterDungeon(t.id);
    else if (t.kind === 'dungeon_exit') this.exitDungeon();
    else if (t.kind === 'chest') this.lootDungeonChest(t.id);
    else if (t.kind === 'salvage') this.lootSeaWreck(t.id);
    else if (t.kind === 'ship_helm') {
      this.atHelmShipId = t.id;
      this.activeShipId = t.id;
      this.playerState.isSailing = true;
      soundEngine.triggerCue('climb', 'Took Ship Helm');
      this.callbacks.onCombatLog('Took the Helm! [W/S] Sail Trim · [A/D] Rudder · [F] Anchor · [Space/J] Cannons · [E] Leave Helm', 'quest');
    } else {
      this.callbacks.onTriggerInteract(t);
    }
  }

  public toggleShipAnchor() {
    if (!this.atHelmShipId) return;
    const ship = this.ships.find((s) => s.id === this.atHelmShipId);
    if (!ship) return;
    ship.anchored = !ship.anchored;
    if (ship.anchored) ship.sailSetting = 0;
    else if (ship.sailSetting < 0.25) ship.sailSetting = 0.5;
    soundEngine.triggerCue('climb', ship.anchored ? 'Anchor Dropped' : 'Anchor Weighed');
    this.callbacks.onCombatLog(ship.anchored ? `${ship.name} dropped anchor.` : `${ship.name} weighed anchor—unfurling sails!`, 'world');
  }

  public fireBroadsideCannons() {
    const ship = this.ships.find((s) => s.id === (this.atHelmShipId || this.activeShipId));
    if (!ship || ship.cannonCooldown > 0) return;
    ship.cannonCooldown = 2.1;
    soundEngine.triggerCue('fire', 'Broadside Volley!');
    this.screenShake = 0.32;

    const spec = SHIP_SPECS[ship.type];
    const cosH = Math.cos(ship.heading);
    const sinH = Math.sin(ship.heading);

    // Fire port & starboard cannon volleys cleanly
    [-1, 1].forEach((side) => {
      const dirX = side * cosH;
      const dirZ = -side * sinH;
      const spawnX = ship.x + dirX * 2.5;
      const spawnZ = ship.z + dirZ * 2.5;
      const spawnY = ship.y + ship.parts.deckY + 0.65;

      this.particlePool.spawnBurst(this.origin.toLocalX(spawnX), spawnY, this.origin.toLocalZ(spawnZ), 0xf97316, 12, {
        speed: 5,
        upBias: 1.5,
      });

      const ballMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9, roughness: 0.3 })
      );
      ballMesh.position.set(this.origin.toLocalX(spawnX), spawnY, this.origin.toLocalZ(spawnZ));
      this.overworldGroup.add(ballMesh);

      this.cannonballs.push({
        x: spawnX,
        y: spawnY,
        z: spawnZ,
        vx: dirX * 42 + ship.vx * 0.4,
        vy: 5.4,
        vz: dirZ * 42 + ship.vz * 0.4,
        fromPlayer: true,
        damage: spec.cannonDmg,
        life: 2.6,
        mesh: ballMesh,
      });
    });
  }

  public upgradeOrSwitchShip(type: ShipType) {
    const ship = this.ships.find((s) => s.id === 'ship_player');
    if (!ship) return;
    this.overworldGroup.remove(ship.parts.group);
    const nextParts = createShipModel(type, this.woodPbr, { isHostile: false, sailHex: 0xfef3c7 });
    nextParts.group.position.set(this.origin.toLocalX(ship.x), ship.y, this.origin.toLocalZ(ship.z));
    nextParts.group.rotation.y = ship.heading;
    this.overworldGroup.add(nextParts.group);

    ship.type = type;
    ship.name = SHIP_SPECS[type].label;
    ship.maxHull = SHIP_SPECS[type].maxHull;
    ship.hull = ship.maxHull;
    ship.parts = nextParts;
    this.playerState.ownedShipType = type;
    soundEngine.triggerCue('craft', `Commissioned ${ship.name}`);
    this.callbacks.onCombatLog(`Commissioned ${ship.name} at the Shipyard!`, 'quest');
  }

  public repairPlayerShip() {
    const ship = this.ships.find((s) => s.id === 'ship_player');
    if (!ship) return;
    ship.hull = ship.maxHull;
    soundEngine.triggerCue('harvest', 'Hull Repaired');
    this.callbacks.onCombatLog(`${ship.name} hull timbers fully repaired.`, 'heal');
  }

  public summonShipToNearestHarbor() {
    const ship = this.ships.find((s) => s.id === 'ship_player');
    if (!ship || this.harborAnchors.length === 0) return;
    let best = this.harborAnchors[0];
    let bestD = Infinity;
    for (const h of this.harborAnchors) {
      const d = Math.hypot(h.x - this.playerState.x, h.z - this.playerState.z);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    ship.x = best.x + 6;
    ship.z = best.z + 6;
    ship.vx = 0;
    ship.vz = 0;
    ship.anchored = true;
    ship.sailSetting = 0;
    this.atHelmShipId = null;
    this.playerState.isSailing = false;
    soundEngine.triggerCue('quest', `Ship Moored at ${best.name}`);
    this.callbacks.onCombatLog(`${ship.name} berthed at ${best.name}.`, 'world');
  }

  private performDodgeRoll() {
    if (this.gameMode !== 'playing' || this.dodgeTimer > 0 || this.playerState.stamina < 18 || this.atHelmShipId) return;
    this.playerState.stamina -= 18;
    this.dodgeTimer = 0.34;
    const yaw = this.playerModel.group.rotation.y;
    this.dodgeDirX = Math.sin(yaw);
    this.dodgeDirZ = Math.cos(yaw);
    this.playerSquashY = 0.72;
    soundEngine.triggerCue('gale', 'Dodge Roll');
  }

  public teleportPlayer(x: number, z: number) {
    if (this.activeDungeon) {
      this.activeDungeon = null;
      this.dungeonGroup.visible = false;
      this.overworldGroup.visible = true;
      this.csm?.lights.forEach((l) => (l.visible = true));
      this.clearDungeonInterior();
    }
    this.atHelmShipId = null;
    this.playerState.isSailing = false;
    const y = groundHeightAt(x, z);
    this.playerState.x = x;
    this.playerState.z = z;
    this.playerState.y = Math.max(y, WATER_LEVEL + 0.35);
    this.velocityY = 0;
    this.origin.update(x, z, [
      this.chunkStreamer.group,
      this.vegetation.group,
      this.seaLife.group,
      ...Array.from(this.npcMeshes.values()),
      ...Array.from(this.outpostMeshes.values()),
      ...Array.from(this.sealModels.values()).map((s) => s.group),
      ...Array.from(this.caravanMeshes.values()),
      ...Array.from(this.wreckMeshes.values()),
    ]);
    this.syncWorldPinnedTransforms(this.clockState.elapsedPlaySeconds);
    this.chunkStreamer.update(x, z, this.origin.originX, this.origin.originZ, this.biomes, this.season);
    this.vegetation.populateAround(x, z, this.origin.originX, this.origin.originZ, this.season, true);
    this.oceanSurface.followPlayer(x, z, this.origin.originX, this.origin.originZ);
    this.callbacks.onPlayerStatsUpdate({ x: this.playerState.x, y: this.playerState.y, z: this.playerState.z });
  }

  // --- Combat helpers -------------------------------------------------------

  private get heroClass() {
    return this.playerState.appearance?.heroClass ?? 'warden';
  }

  private get facingYaw() {
    return this.playerModel.group.rotation.y;
  }

  /** Nearest living enemy in front of the player within range and cone (radians, half-angle). */
  private findTarget(range: number, halfCone: number): EnemyRuntime | null {
    const px = this.playerState.x;
    const pz = this.playerState.z;
    const yaw = this.facingYaw;
    let best: EnemyRuntime | null = null;
    let bestScore = Infinity;
    const list = this.activeDungeon ? this.dungeonEnemies : this.enemies;
    for (const e of list) {
      if (!e.alive) continue;
      const dx = e.x - px;
      const dz = e.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > range + (e.isDragon ? 4 : 0)) continue;
      let diff = Math.atan2(dx, dz) - yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > halfCone && d > 2) continue;
      const score = d + Math.abs(diff) * 6;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  private enemiesInCone(range: number, halfCone: number, cx = this.playerState.x, cz = this.playerState.z): EnemyRuntime[] {
    const yaw = this.facingYaw;
    const list = this.activeDungeon ? this.dungeonEnemies : this.enemies;
    return list.filter((e) => {
      if (!e.alive) return false;
      const dx = e.x - cx;
      const dz = e.z - cz;
      const d = Math.hypot(dx, dz);
      if (d > range + (e.isDragon ? 3 : 0)) return false;
      if (halfCone >= Math.PI) return true;
      let diff = Math.atan2(dx, dz) - yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      return Math.abs(diff) <= halfCone || d < 1.6;
    });
  }

  private enemyAimPoint(e: EnemyRuntime): THREE.Vector3 {
    return new THREE.Vector3(e.x, groundHeightAt(e.x, e.z) + (e.isDragon ? 4 : 1.2), e.z);
  }

  /** Point straight ahead of the player at a given distance (world coords). */
  private aheadPoint(dist: number, height = 1.2): THREE.Vector3 {
    const x = this.playerState.x + Math.sin(this.facingYaw) * dist;
    const z = this.playerState.z + Math.cos(this.facingYaw) * dist;
    return new THREE.Vector3(x, Math.max(groundHeightAt(x, z), WATER_LEVEL) + height, z);
  }

  /** World position of the staff crystal or casting hand. */
  private castOrigin(side: 'L' | 'R' = 'R'): THREE.Vector3 {
    this.playerModel.group.updateMatrixWorld(true);
    return this.combatFx.toWorld(this.playerModel.character.getCastPoint(new THREE.Vector3(), side));
  }

  private igniteBrushAt(x: number, z: number, radius: number) {
    let lit = false;
    this.brushPatches.forEach((bp) => {
      if (!bp.burnedOut && bp.burningTimer <= 0 && Math.hypot(bp.x - x, bp.z - z) < radius) {
        bp.burningTimer = 8.0;
        (bp.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0xf97316);
        (bp.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.6;
        lit = true;
      }
    });
    if (lit) this.callbacks.onCombatLog('Fire ignited dense brush, creating a burning hazard!', 'world');
  }

  private onPlayerHit(manaGain = 6) {
    this.recentCombatTimer = 6.5;
    this.hitstopTimer = Math.max(this.hitstopTimer, 0.045);
    const gain = this.unlockedSkills.includes('gale_tempest') ? manaGain * 2.3 : manaGain;
    this.playerState.mana = Math.min(this.playerState.maxMana, this.playerState.mana + gain);
    this.callbacks.onPlayerStatsUpdate({ mana: this.playerState.mana });
  }

  // --- J: weapon attack, matched to what the hero carries ---------------------

  public performMeleeAttack() {
    if (this.gameMode !== 'playing' || this.playerState.cooldowns.melee > 0 || this.atHelmShipId) return;
    const style = this.playerModel.character.attackStyle;
    this.meleeComboStep = (this.meleeComboStep % 3) + 1;
    this.meleeComboResetTimer = 1.4;
    this.attackSwingTimer = 0.28;
    const comboMult = this.meleeComboStep === 3 ? 1.45 : this.meleeComboStep === 2 ? 1.15 : 1.0;
    const baseDmg =
      (24 + (this.playerState.level - 1) * 4 + (this.playerState.equippedWeapon === 'ember_greatsword' ? 18 : 8)) *
      comboMult;

    // Ranger: draw and loose an arrow with real drop
    if (style === 'bow') {
      this.playerState.cooldowns.melee = 0.62;
      this.playerModel.character.play('shoot');
      soundEngine.triggerCue('melee', 'Arrow Loosed');
      this.combatFx.after(0.34, () => {
        const target = this.findTarget(48, 0.5);
        const from = this.castOrigin('L');
        const aim = target ? this.enemyAimPoint(target) : this.aheadPoint(45, 1.6);
        this.combatFx.arrow(from, aim, (hit) => {
          if (!hit) return;
          const crit = this.isCrouching ? 2 : 1;
          this.damageEnemy(hit as EnemyRuntime, baseDmg * 1.15 * crit, 'physical');
          if (crit > 1) this.callbacks.onCombatLog('Sneak shot! Double damage.', 'combo');
          this.onPlayerHit(5);
        }, target);
      });
      return;
    }

    // Arcanist: staff fires a homing arcane bolt
    if (style === 'staff') {
      this.playerState.cooldowns.melee = 0.5;
      this.playerModel.character.play('castPush');
      soundEngine.triggerCue('melee', 'Arcane Bolt');
      this.combatFx.after(0.2, () => {
        const target = this.findTarget(32, 0.7);
        const from = this.castOrigin('R');
        const aim = target ? this.enemyAimPoint(target) : this.aheadPoint(30);
        this.combatFx.orb('arcane', from, aim, (hit, at) => {
          this.particlePool.spawnBurst(this.origin.toLocalX(at.x), at.y, this.origin.toLocalZ(at.z), 0xffd66b, 12);
          if (!hit) return;
          this.damageEnemy(hit as EnemyRuntime, baseDmg * 0.95, 'physical');
          this.onPlayerHit(9);
        }, target);
      });
      return;
    }

    // Close weapons: sword / axe / hammer / spear / dagger hit only what is in front
    const dagger = style === 'dagger';
    const reach = dagger ? 3.2 : style === 'spear' ? 5.6 : style === 'hammer' ? 4.4 : 4.7;
    const cone = dagger ? 0.9 : style === 'spear' ? 0.6 : 1.75;
    this.playerState.cooldowns.melee = dagger ? 0.24 : this.meleeComboStep === 3 ? 0.56 : 0.34;
    this.playerModel.character.play(dagger || style === 'spear' ? 'thrust' : 'strike');
    this.playerSquashY = 0.88;
    soundEngine.triggerCue('melee', dagger ? 'Quick Stab' : this.meleeComboStep === 3 ? 'Heavy Cleave!' : 'Blade Strike');

    const fxAt = new THREE.Vector3(this.playerState.x, this.playerState.y + 1.1, this.playerState.z);
    this.combatFx.after(dagger ? 0.08 : 0.16, () => {
      this.combatFx.slash(fxAt, this.facingYaw, {
        radius: reach * 0.75,
        arc: dagger ? 0.7 : style === 'spear' ? 0.4 : 2.4,
        thin: dagger || style === 'spear',
        tilt: this.meleeComboStep === 2 ? -0.5 : 0.3,
        color: this.playerState.equippedWeapon === 'ember_greatsword' ? 0xffa040 : 0xfff1c2,
      });
    });

    const hits = this.enemiesInCone(reach, cone);
    hits.forEach((enemy) => {
      const sneak = dagger && this.isCrouching ? 2.2 : 1;
      this.damageEnemy(enemy, baseDmg * (dagger ? 0.8 : 1) * sneak, 'physical');
      if (sneak > 1) this.callbacks.onCombatLog('Backstab! Sneak attack damage.', 'combo');
    });
    if (hits.length) this.onPlayerHit(6);
  }

  // --- 1-4: elemental powers, each a real effect in the world ----------------

  public castElementalSpell(element: Exclude<ElementType, 'physical'>) {
    if (this.gameMode !== 'playing' || this.playerState.cooldowns[element] > 0) return;
    const isMage = this.heroClass === 'mage';
    const manaCost = (element === 'gale' ? 14 : 18) * (isMage ? 0.85 : 1);
    if (this.playerState.mana < manaCost) {
      this.callbacks.onCombatLog('Insufficient Mana for elemental spell.', 'warning');
      return;
    }

    const stormCdMult =
      this.unlockedSkills.includes('lightning_avatar') && (this.weather === 'Rain' || this.weather === 'Thunderstorm')
        ? 0.7
        : 1.0;

    this.playerState.mana -= manaCost;
    this.playerState.cooldowns[element] = (element === 'gale' ? 2.2 : 2.6) * stormCdMult;
    this.playerState.elementalUses[element] += 1;
    this.attackSwingTimer = 0.32;
    this.recentCombatTimer = 6.5;
    soundEngine.triggerCue(element);

    const px = this.playerState.x;
    const py = this.playerState.y;
    const pz = this.playerState.z;
    const lx = this.origin.toLocalX(px);
    const lz = this.origin.toLocalZ(pz);

    let dmg = 34 + this.playerState.level * 5;
    const weatherModMap = elementReactions.weatherModifiers[this.weather] as Record<string, number> | undefined;
    if (weatherModMap && typeof weatherModMap[element] === 'number') {
      dmg *= weatherModMap[element];
    }
    if (element === 'fire' && this.unlockedSkills.includes('fire_kindle')) dmg *= 1.25;
    if (element === 'lightning' && this.unlockedSkills.includes('lightning_arc')) dmg *= 1.25;
    if (element === 'frost' && this.unlockedSkills.includes('frost_rime')) dmg *= 1.25;
    if (this.playerState.equippedRelic === 'crown_amulet') dmg *= 1.2;
    if (isMage) dmg *= 1.2;

    // [1] FIREBALL: thrown from the hand/staff, explodes where it lands
    if (element === 'fire') {
      this.playerModel.character.play('castPush');
      this.combatFx.after(0.2, () => {
        const target = this.findTarget(34, 0.6);
        const from = this.castOrigin('R');
        const aim = target ? this.enemyAimPoint(target) : this.aheadPoint(26, 0.4);
        this.combatFx.orb('fire', from, aim, (_hit, at) => {
          const radius = 4.6;
          this.combatFx.explosion(at, 0xff6a00, radius);
          this.screenShake = Math.max(this.screenShake, 0.35);
          this.enemiesInCone(radius, Math.PI, at.x, at.z).forEach((e) => {
            const falloff = 1 - Math.min(0.6, Math.hypot(e.x - at.x, e.z - at.z) / radius * 0.6);
            this.damageEnemy(e, dmg * 1.1 * falloff, 'fire');
          });
          if (!this.activeDungeon) this.igniteBrushAt(at.x, at.z, 6.5);
        }, target);
      });
      return;
    }

    // [2] LIGHTNING: instant bolt from the raised hand, chains to 2 more enemies
    if (element === 'lightning') {
      this.playerModel.character.play('castPoint');
      let wetBonus = 1;
      if (!this.activeDungeon && (this.isSwimming || isWaterAt(px, pz) || this.weather === 'Rain' || this.weather === 'Thunderstorm')) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(1.5, 8.5, 32),
          new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.65 })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(lx, Math.max(WATER_LEVEL + 0.08, py + 0.1), lz);
        this.overworldGroup.add(ring);
        this.shockZones.push({ x: px, z: pz, timer: 4.5, ring });
        wetBonus = 1.35;
        this.callbacks.onCombatLog('Tempest Arc electrified wet ground! (+35% Shock)', 'combo');
      }
      this.combatFx.after(0.24, () => {
        const from = this.castOrigin('R');
        const first = this.findTarget(24, 0.8);
        if (!first) {
          const ground = this.aheadPoint(12, 0);
          this.combatFx.lightning(from, [ground]);
          this.enemiesInCone(3, Math.PI, ground.x, ground.z).forEach((e) => this.damageEnemy(e, dmg * wetBonus, 'lightning'));
          this.screenShake = Math.max(this.screenShake, 0.25);
          return;
        }
        const chain: EnemyRuntime[] = [first];
        const list = this.activeDungeon ? this.dungeonEnemies : this.enemies;
        while (chain.length < 3) {
          const last = chain[chain.length - 1];
          const next = list
            .filter((e) => e.alive && !chain.includes(e) && Math.hypot(e.x - last.x, e.z - last.z) < 9)
            .sort((a, b) => Math.hypot(a.x - last.x, a.z - last.z) - Math.hypot(b.x - last.x, b.z - last.z))[0];
          if (!next) break;
          chain.push(next);
        }
        this.combatFx.lightning(from, chain.map((e) => this.enemyAimPoint(e)));
        chain.forEach((e, i) => this.damageEnemy(e, dmg * wetBonus * (i === 0 ? 1.15 : 0.6), 'lightning'));
        if (chain.length > 1) this.callbacks.onCombatLog(`Chain Lightning arced through ${chain.length} foes!`, 'combo');
        this.screenShake = Math.max(this.screenShake, 0.3);
      });
      return;
    }

    // [3] FROST CONE: ice shards spray forward, freezing what they hit
    if (element === 'frost') {
      this.playerModel.character.play('castCone');
      const range = 10;
      const half = 0.75;
      this.combatFx.after(0.18, () => {
        const from = this.castOrigin('R');
        this.combatFx.frostCone(from, this.facingYaw, range, half);
        this.enemiesInCone(range, half).forEach((e) => {
          this.damageEnemy(e, dmg * 0.95, 'frost');
          e.stunTimer = Math.max(e.stunTimer, 1.4);
        });
      });
      if (!this.activeDungeon) {
        // Law 4: Frost puts out burning fires nearby
        this.brushPatches.forEach((bp) => {
          if (bp.burningTimer > 0 && Math.hypot(bp.x - px, bp.z - pz) < 10.5) {
            bp.burningTimer = 0;
            (bp.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
            (bp.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
            this.callbacks.onCombatLog('Glacial Surge extinguished nearby flames!', 'world');
          }
        });
        const fx = px + Math.sin(this.facingYaw) * 4.5;
        const fz = pz + Math.cos(this.facingYaw) * 4.5;
        if (isWaterAt(fx, fz) || isWaterAt(px, pz)) {
          const bx = isWaterAt(fx, fz) ? fx : px;
          const bz = isWaterAt(fx, fz) ? fz : pz;
          const iceMesh = new THREE.Mesh(
            new THREE.CylinderGeometry(3.6, 3.8, 0.35, 14),
            new THREE.MeshPhysicalMaterial({ color: 0xa5f3fc, roughness: 0.14, clearcoat: 1.0 })
          );
          iceMesh.position.set(this.origin.toLocalX(bx), WATER_LEVEL + 0.14, this.origin.toLocalZ(bz));
          iceMesh.receiveShadow = true;
          this.overworldGroup.add(iceMesh);
          this.iceBridges.push({
            x: bx,
            z: bz,
            radius: 3.7,
            timer: this.unlockedSkills.includes('frost_rime') ? 28 : 16,
            mesh: iceMesh,
          });
          this.callbacks.onCombatLog('Glacial Surge froze a walkable ice floe over water!', 'world');
        }
      }
      return;
    }

    // [4] GALE: wind burst launches the hero up and blasts nearby enemies back
    this.playerModel.character.play('castSweep');
    this.combatFx.galeBurst(new THREE.Vector3(px, py, pz), 7);
    const radius = 7;
    this.enemiesInCone(radius, Math.PI).forEach((e) => {
      const dx = e.x - px;
      const dz = e.z - pz;
      const d = Math.max(0.5, Math.hypot(dx, dz));
      const push = e.isDragon ? 0.8 : 4.5 * (1 - d / (radius + 1));
      e.x += (dx / d) * push;
      e.z += (dz / d) * push;
      this.damageEnemy(e, dmg * 0.75, 'gale');
      e.stunTimer = Math.max(e.stunTimer, 0.6);
    });
    if (!this.activeDungeon) {
      const lift = this.unlockedSkills.includes('gale_updraft') ? 16.5 : 13.0;
      this.velocityY = lift;
      this.isGrounded = false;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.3, 0.09, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.72 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(lx, py + 0.5, lz);
      this.overworldGroup.add(ring);
      this.updrafts.push({ x: px, z: pz, timer: 4.5, mesh: ring });
    }
  }

  public commandCompanion(cmd: 'flank' | 'heal') {
    if (!this.playerState.companionId) {
      this.callbacks.onCombatLog('No active companion recruited yet.', 'warning');
      return;
    }
    if (cmd === 'heal') {
      const healAmt = 36;
      this.playerState.hp = Math.min(this.playerState.maxHp, this.playerState.hp + healAmt);
      this.particlePool.spawnBurst(
        this.origin.toLocalX(this.playerState.x),
        this.playerState.y + 1.2,
        this.origin.toLocalZ(this.playerState.z),
        0x10b981,
        16
      );
      soundEngine.triggerCue('harvest', 'Companion Field Heal');
      this.callbacks.onCombatLog(`Companion restored +${healAmt} HP!`, 'heal');
    } else {
      soundEngine.triggerCue('gale', 'Companion Flank Strike');
      const list = this.activeDungeon ? this.dungeonEnemies : this.enemies;
      const target = list.find((e) => e.alive && Math.hypot(e.x - this.playerState.x, e.z - this.playerState.z) < 22);
      if (target) {
        this.companionPos.set(target.x + 2, groundHeightAt(target.x + 2, target.z), target.z);
        this.damageEnemy(target, 32, 'gale');
        this.callbacks.onCombatLog(`Companion flanked ${target.name} for bonus damage!`, 'combo');
      }
    }
  }

  public harvestResourceNode(nodeId: string): boolean {
    const node = this.resourceNodes.find((n) => n.id === nodeId && n.available);
    if (!node) return false;
    node.available = false;
    node.respawnTimer = 22;
    node.mesh.visible = false;
    soundEngine.triggerCue('harvest', `Harvested ${node.itemId.replace('_', ' ')}`);
    this.particlePool.spawnBurst(
      this.origin.toLocalX(node.x),
      groundHeightAt(node.x, node.z) + 0.8,
      this.origin.toLocalZ(node.z),
      0x10b981,
      12
    );
    this.callbacks.onHarvestItem(node.itemId, 1, node.biomeId);
    return true;
  }

  public lootSeaWreck(wreckId: string) {
    const w = this.seaWrecks.find((r) => r.id === wreckId && !r.looted);
    if (!w) return;
    w.looted = true;
    const mesh = this.wreckMeshes.get(w.id);
    if (mesh) mesh.scale.setScalar(0.8);
    soundEngine.triggerCue('quest', `Salvaged ${w.name}`);
    this.particlePool.spawnBurst(this.origin.toLocalX(w.x), w.depthY + 1.0, this.origin.toLocalZ(w.z), 0xfbbf24, 18);
    this.callbacks.onHarvestItem(w.rewardItem, 1, 'aether');
    this.callbacks.onGainXpAndGold(110, w.rewardGold);
    this.callbacks.onCombatLog(`Salvaged ${w.name} (+${w.rewardGold}g, +1 ${w.rewardItem})!`, 'quest');
  }

  public lootDungeonChest(chestId: string) {
    const chest = this.dungeonChests.find((c) => c.id === chestId && !c.opened);
    if (!chest) return;
    chest.opened = true;
    chest.mesh.scale.setScalar(0.82);
    soundEngine.triggerCue('quest', 'Relic Chest Looted');
    this.particlePool.spawnBurst(chest.x, 1.0, chest.z, 0xfbbf24, 20);
    const biomeId = this.activeDungeon?.biomeId || this.currentBiome;
    this.callbacks.onHarvestItem(chest.rewardItem, 1, biomeId);
    this.callbacks.onGainXpAndGold(95, chest.rewardGold);
    this.callbacks.onCombatLog(`Looted Sanctum Chest (+${chest.rewardGold}g, +1 ${chest.rewardItem})!`, 'quest');
  }

  public enterDungeon(dungeonId: string) {
    const portal = this.dungeonPortals.find((d) => d.id === dungeonId);
    if (!portal) return;

    this.overworldReturnPos = { x: portal.x, z: portal.z + 5.5 };
    this.activeDungeon = portal;
    this.overworldGroup.visible = false;
    this.csm?.lights.forEach((l) => (l.visible = false));
    this.buildDungeonInterior(portal);
    this.dungeonGroup.visible = true;

    this.playerState.x = 0;
    this.playerState.z = 8;
    this.playerState.y = 0.2;
    this.velocityY = 0;
    this.playerModel.group.position.set(0, 0.2, 8);
    this.skyWeather.fog.color.setHex(0x070a12);
    this.skyWeather.fog.density = 0.024;
    (this.scene.background as THREE.Color).setHex(0x05070c);
    this.callbacks.onCombatLog(`Descended into ${portal.name}. Defeat guardians & loot relic chests!`, 'quest');
  }

  public exitDungeon() {
    if (!this.activeDungeon) return;
    const name = this.activeDungeon.name;
    this.activeDungeon = null;
    this.dungeonGroup.visible = false;
    this.overworldGroup.visible = true;
    this.csm?.lights.forEach((l) => (l.visible = true));
    this.clearDungeonInterior();
    this.teleportPlayer(this.overworldReturnPos.x, this.overworldReturnPos.z);
    this.callbacks.onCombatLog(`Emerged from ${name} back into Aethelgard.`, 'world');
  }

  private clearDungeonInterior() {
    while (this.dungeonGroup.children.length > 0) {
      this.dungeonGroup.remove(this.dungeonGroup.children[0]);
    }
    this.dungeonChests = [];
    this.dungeonEnemies = [];
  }

  private buildDungeonInterior(portal: DungeonPortalDef) {
    this.clearDungeonInterior();
    const stoneMat = new THREE.MeshStandardMaterial({
      map: this.stonePbr.map,
      normalMap: this.stonePbr.normalMap,
      roughnessMap: this.stonePbr.roughnessMap,
      roughness: 0.88,
      metalness: 0.12,
      color: 0x64748b,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: portal.accentHex,
      emissive: portal.accentHex,
      emissiveIntensity: 2.0,
    });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(42, 62), stoneMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -16);
    floor.receiveShadow = true;
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(42, 62), stoneMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 9.5, -16);
    this.dungeonGroup.add(floor, ceiling);

    [
      { w: 42, h: 10, d: 2, x: 0, z: 14 },
      { w: 42, h: 10, d: 2, x: 0, z: -46 },
      { w: 2, h: 10, d: 62, x: -20, z: -16 },
      { w: 2, h: 10, d: 62, x: 20, z: -16 },
    ].forEach((ws) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(ws.w, ws.h, ws.d), stoneMat);
      m.position.set(ws.x, 5, ws.z);
      this.dungeonGroup.add(m);
    });

    for (let z = 4; z >= -38; z -= 14) {
      [-9, 9].forEach((px, sideIdx) => {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, 9.5, 10), stoneMat);
        pillar.position.set(px, 4.75, z);
        const crystalVein = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), accentMat);
        crystalVein.position.set(px + (sideIdx === 0 ? 1.1 : -1.1), 3.4, z);
        this.dungeonGroup.add(pillar, crystalVein);
      });
      const torchLight = new THREE.PointLight(portal.accentHex, 3.4, 24, 1.4);
      torchLight.position.set(0, 6.2, z);
      this.dungeonGroup.add(torchLight);
    }

    const exitModel = createDungeonPortalModel(0x38bdf8, this.stonePbr);
    exitModel.group.position.set(0, 0, 12);
    this.dungeonGroup.add(exitModel.group);

    [
      { id: `${portal.id}_chest_1`, x: -12, z: -36, rewardItem: 'crown_amulet', rewardGold: 85 },
      { id: `${portal.id}_chest_2`, x: 12, z: -36, rewardItem: 'thermal_bomb', rewardGold: 65 },
    ].forEach((cs) => {
      const mesh = createTreasureChestModel(this.woodPbr);
      mesh.position.set(cs.x, 0, cs.z);
      this.dungeonGroup.add(mesh);
      this.dungeonChests.push({ ...cs, opened: false, mesh });
    });

    const mobKind: 'wraith' | 'golem' | 'stalker' =
      portal.biomeId === 'ember' ? 'golem' : portal.biomeId === 'aether' ? 'stalker' : 'wraith';
    [
      { id: `${portal.id}_mob_1`, name: `${portal.name} Sentinel`, x: -5, z: -12 },
      { id: `${portal.id}_mob_2`, name: `${portal.name} Warden`, x: 5, z: -24 },
    ].forEach((m) => {
      const parts = createEnemyModel(mobKind);
      parts.group.position.set(m.x, 0, m.z);
      this.dungeonGroup.add(parts.group);
      this.dungeonEnemies.push({
        id: m.id,
        kind: mobKind,
        name: m.name,
        biomeId: portal.biomeId,
        x: m.x,
        z: m.z,
        homeX: m.x,
        homeZ: m.z,
        hp: 115,
        maxHp: 115,
        alive: true,
        respawnTimer: 0,
        primedElement: null,
        primeTimer: 0,
        stunTimer: 0,
        attackCooldown: 0,
        windupTimer: 0,
        hitFlashTimer: 0,
        isDungeonMob: true,
        parts,
      });
    });

    const bossVariant = portal.biomeId === 'ember' || portal.biomeId === 'suncrest' ? 'ember_dragon' : 'frost_dragon';
    const dParts = createDragonModel(bossVariant);
    dParts.group.scale.setScalar(0.78);
    dParts.group.position.set(0, 0, -34);
    this.dungeonGroup.add(dParts.group);
    this.dungeonEnemies.push({
      id: `${portal.id}_boss`,
      kind: bossVariant,
      name: `${portal.name} Wyrm`,
      biomeId: portal.biomeId,
      x: 0,
      z: -34,
      homeX: 0,
      homeZ: -34,
      hp: 210,
      maxHp: 210,
      alive: true,
      respawnTimer: 0,
      primedElement: null,
      primeTimer: 0,
      stunTimer: 0,
      attackCooldown: 0,
      windupTimer: 0,
      hitFlashTimer: 0,
      isDragon: true,
      isDungeonMob: true,
      dragonParts: dParts,
    });
  }

  private damageEnemy(enemy: EnemyRuntime, rawDamage: number, element: ElementType) {
    if (!enemy.alive) return;
    let dmg = rawDamage;
    let comboName = '';

    if (element !== 'physical') {
      const p = enemy.primedElement;
      if (!this.activeDungeon && element === 'lightning' && isWaterAt(enemy.x, enemy.z)) {
        const arcFlood = elementReactions.reactions.find((r) => r.id === 'lightning_water');
        dmg *= arcFlood?.damageMultiplier ?? 2.0;
        enemy.stunTimer = Math.max(enemy.stunTimer, arcFlood?.stunSeconds ?? 1.2);
        comboName = arcFlood?.name ?? 'ARC FLOOD!';
      } else if (p && p !== element) {
        const match = elementReactions.reactions.find(
          (r) => r.elements.includes(p) && r.elements.includes(element)
        );
        if (match) {
          dmg *= match.damageMultiplier;
          if (match.stunSeconds > 0) {
            enemy.stunTimer = Math.max(enemy.stunTimer, match.stunSeconds);
          }
          comboName = match.name;
        }
      }
      if (comboName) {
        if (this.unlockedSkills.includes('fire_solar')) dmg *= 1.3;
        enemy.primedElement = null;
        enemy.primeTimer = 0;
        this.hitstopTimer = Math.max(this.hitstopTimer, 0.065);
        this.screenShake = 0.42;
        soundEngine.triggerCue('combo', comboName);
        this.particlePool.spawnBurst(
          this.activeDungeon ? enemy.x : this.origin.toLocalX(enemy.x),
          (this.activeDungeon ? 1.5 : groundHeightAt(enemy.x, enemy.z) + 1.5),
          this.activeDungeon ? enemy.z : this.origin.toLocalZ(enemy.z),
          0xfbbf24,
          24
        );
        this.callbacks.onCombatLog(`${comboName} Dealt ${Math.round(dmg)} elemental damage to ${enemy.name}!`, 'combo');
      } else {
        enemy.primedElement = element;
        enemy.primeTimer = 7.0;
      }
    }

    enemy.hp -= dmg;
    enemy.hitFlashTimer = 0.14;
    if (!comboName) {
      this.callbacks.onCombatLog(`Hit ${enemy.name} for ${Math.round(dmg)} damage.`, 'damage');
    }

    if (enemy.hp <= 0) {
      enemy.alive = false;
      enemy.respawnTimer = enemy.isDungeonMob ? 9999 : enemy.isDragon ? 95 : 42;
      const grp = enemy.dragonParts?.group || enemy.parts?.group;
      if (grp) grp.visible = false;
      this.particlePool.spawnBurst(
        this.activeDungeon ? enemy.x : this.origin.toLocalX(enemy.x),
        (this.activeDungeon ? 1.8 : groundHeightAt(enemy.x, enemy.z) + 1.8),
        this.activeDungeon ? enemy.z : this.origin.toLocalZ(enemy.z),
        0xc084fc,
        28
      );
      if (enemy.isDragon) {
        this.callbacks.onGainXpAndGold(180, 140);
        this.callbacks.onHarvestItem('crown_amulet', 1, enemy.biomeId);
        this.callbacks.onCombatLog(`Slayed ${enemy.name}! (+180 XP, +140g)`, 'quest');
      } else {
        this.callbacks.onGainXpAndGold(45, 24);
        this.callbacks.onEnemyDefeated(enemy.kind as 'wraith' | 'golem' | 'stalker', enemy.biomeId, enemy.id);
        this.callbacks.onCombatLog(`Vanquished ${enemy.name} (+45 XP, +24g, +1 Blight Ichor).`, 'quest');
      }
      if (this.activeDungeon && this.dungeonEnemies.every((d) => !d.alive)) {
        this.activeDungeon.cleared = true;
        this.callbacks.onCombatLog(`${this.activeDungeon.name} CLEARED! Claim Relic Chests!`, 'quest');
      }
    }
  }

  public captureSnapshot(): string {
    this.renderFrame();
    return this.renderer.domElement.toDataURL('image/jpeg', 0.86);
  }

  // --- Simulation & Render Loop ---

  private scheduleNextFrame() {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.tick);
  }

  private tick = (nowMs: number) => {
    if (this.disposed) return;

    this.loop.step(
      nowMs,
      (fixedDt) => {
        if (this.gameMode === 'playing') {
          if (this.hitstopTimer > 0) {
            this.hitstopTimer = Math.max(0, this.hitstopTimer - fixedDt);
            return;
          }
          this.prevSimPos.set(this.playerState.x, this.playerState.y, this.playerState.z);
          this.stepSimulation(fixedDt);
        }
      },
      (frameDt, alpha, smoothedMs) => {
        this.renderAlpha = this.gameMode === 'playing' ? alpha : 1;
        this.clockState.step(frameDt, this.gameMode === 'playing');
        this.updateAtmosphereAndVisuals(frameDt);
        this.updateAdaptivePerformance(smoothedMs);
        this.renderFrame();

        // Throttled HUD updates (~10 Hz) — zero React re-renders per frame!
        const elapsed = performance.now() / 1000;
        if (elapsed - this.lastPromptsEmit > 0.12) {
          this.lastPromptsEmit = elapsed;
          this.emitContextualPrompts();
        }
        if (elapsed - this.lastHudEmit > 0.15) {
          this.lastHudEmit = elapsed;
          this.emitHudSnapshot(smoothedMs);
        }
      }
    );

    this.scheduleNextFrame();
  };

  private stepSimulation(dt: number) {
    const elapsed = this.clockState.elapsedPlaySeconds;
    const keys = this.input.keys;

    // Cooldowns & Buff Timers
    this.playerState.cooldowns.fire = Math.max(0, this.playerState.cooldowns.fire - dt);
    this.playerState.cooldowns.lightning = Math.max(0, this.playerState.cooldowns.lightning - dt);
    this.playerState.cooldowns.frost = Math.max(0, this.playerState.cooldowns.frost - dt);
    this.playerState.cooldowns.gale = Math.max(0, this.playerState.cooldowns.gale - dt);
    this.playerState.cooldowns.melee = Math.max(0, this.playerState.cooldowns.melee - dt);
    if (this.meleeComboResetTimer > 0) {
      this.meleeComboResetTimer -= dt;
      if (this.meleeComboResetTimer <= 0) this.meleeComboStep = 0;
    }
    if (this.attackSwingTimer > 0) this.attackSwingTimer -= dt;
    this.combatFx.update(dt, (this.activeDungeon ? this.dungeonEnemies : this.enemies) as FxTarget[], groundHeightAt);
    if (this.dodgeTimer > 0) this.dodgeTimer -= dt;
    if (this.oxygenWarnCooldown > 0) this.oxygenWarnCooldown -= dt;
    if (this.recentCombatTimer > 0) this.recentCombatTimer -= dt;

    // Ambient Mana/Stamina regeneration
    this.playerState.mana = Math.min(this.playerState.maxMana, this.playerState.mana + dt * 4.2);

    // Subtle shifting coastal wind
    this.windAngleRad = 0.65 + Math.sin(elapsed * 0.04) * 0.45;
    this.windKnots = this.weather === 'Thunderstorm' ? 22 : this.weather === 'Rain' ? 17 : 13;

    // 1. Step Naval Ships (Player Ship + AI Merchant & Corsair Brigs)
    this.stepShipsAndCannons(dt, elapsed);

    // 2. Step Player Character (either at Helm OR walking/climbing/swimming/diving)
    if (this.atHelmShipId) {
      const ship = this.ships.find((s) => s.id === this.atHelmShipId);
      if (ship) {
        const sinH = Math.sin(ship.heading);
        const cosH = Math.cos(ship.heading);
        const hl = ship.parts.helmLocalPos;
        this.playerState.x = ship.x + cosH * hl.x + sinH * hl.z;
        this.playerState.z = ship.z - sinH * hl.x + cosH * hl.z;
        this.playerState.y = ship.y + hl.y;
        this.playerModel.group.rotation.y = ship.heading;
        this.isSwimming = false;
        this.isUnderwater = false;
        this.isGrounded = true;
      }
    } else {
      this.stepPlayerOnFootOrSwim(dt, elapsed, keys);
    }

    // 3. Origin Floating Check & Chunk Streaming (when on Overworld)
    if (!this.activeDungeon) {
      // Origin shifts are rare. Avoid allocating maps and rewriting world
      // transforms sixty times per second during ordinary exploration.
      if (Math.abs(this.playerState.x - this.origin.originX) >= 1024 ||
          Math.abs(this.playerState.z - this.origin.originZ) >= 1024) {
        const shifted = this.origin.update(this.playerState.x, this.playerState.z, [
          this.chunkStreamer.group,
          this.vegetation.group,
          this.livingSettlements.group,
          this.seaLife.group,
          ...this.npcMeshes.values(),
          ...this.outpostMeshes.values(),
          ...Array.from(this.sealModels.values(), (s) => s.group),
          ...this.caravanMeshes.values(),
          ...this.wreckMeshes.values(),
        ]);
        if (shifted) this.syncWorldPinnedTransforms(elapsed);
      }

      this.chunkStreamer.update(
        this.playerState.x,
        this.playerState.z,
        this.origin.originX,
        this.origin.originZ,
        this.biomes,
        this.season
      );
      this.oceanSurface.followPlayer(
        this.playerState.x,
        this.playerState.z,
        this.origin.originX,
        this.origin.originZ
      );
      this.vegetation.populateAround(
        this.playerState.x,
        this.playerState.z,
        this.origin.originX,
        this.origin.originZ,
        this.season
      );
      this.livingSettlements.update(this.playerState.x, this.playerState.z, this.origin.originX, this.origin.originZ);
      this.seaLife.update(dt, elapsed, this.origin.originX, this.origin.originZ, this.waveSampler);

      // Regional story discovery is proximity based and throttled to avoid
      // scanning landmarks every physics tick. The quest journal persists
      // the actual outcome so crossing a location twice never duplicates XP.
      if (elapsed - this.lastPoiScan >= 0.35) {
        this.lastPoiScan = elapsed;
        for (const poi of WORLD_POIS) {
          if (this.discoveredPois.has(poi.id)) continue;
          const dx = this.playerState.x - poi.x;
          const dz = this.playerState.z - poi.z;
          if (dx * dx + dz * dz <= 22 * 22) {
            this.discoveredPois.add(poi.id);
            this.callbacks.onPoiDiscover(poi.id, poi.name);
          }
        }
      }

      const nowBiome = getBiomeAt(this.playerState.x, this.playerState.z);
      if (nowBiome !== this.currentBiome) {
        this.currentBiome = nowBiome;
        if (!this.discoveredBiomes.has(nowBiome)) {
          this.discoveredBiomes.add(nowBiome);
          this.callbacks.onBiomeDiscover(nowBiome);
        }
      }
    }

    // 4. Step Enemies, Wildlife, Mystics, Ice Bridges, Updrafts & Companion
    this.stepAiAndWorldProps(dt, elapsed);
  }

  private stepShipsAndCannons(dt: number, elapsed: number) {
    const keys = this.input.keys;
    for (const ship of this.ships) {
      if (ship.hull <= 0) {
        ship.respawnTimer -= dt;
        if (ship.respawnTimer <= 0) {
          ship.hull = ship.maxHull;
          ship.parts.group.visible = true;
        }
        continue;
      }

      let steer = 0;
      if (ship.id === this.atHelmShipId) {
        if (keys['KeyW'] || keys['ArrowUp']) {
          ship.anchored = false;
          ship.sailSetting = Math.min(1, ship.sailSetting + dt * 0.65);
        }
        if (keys['KeyS'] || keys['ArrowDown']) {
          ship.sailSetting = Math.max(0, ship.sailSetting - dt * 0.75);
        }
        if (keys['KeyA'] || keys['ArrowLeft']) steer += 1;
        if (keys['KeyD'] || keys['ArrowRight']) steer -= 1;
      } else if (!ship.isPlayerOwned) {
        // AI Ship patrol & pirate broadsides!
        steer = Math.sin(elapsed * 0.3 + (ship.isHostile ? 1.5 : 0)) * 0.35;
        if (ship.isHostile && this.activeShipId) {
          const target = this.ships.find((s) => s.id === this.activeShipId);
          if (target && Math.hypot(target.x - ship.x, target.z - ship.z) < 54 && ship.cannonCooldown <= 0) {
            ship.cannonCooldown = 4.2;
            const ang = Math.atan2(target.x - ship.x, target.z - ship.z);
            const ballMesh = new THREE.Mesh(
              new THREE.SphereGeometry(0.28, 8, 8),
              new THREE.MeshStandardMaterial({ color: 0x1e293b })
            );
            const lx = this.origin.toLocalX(ship.x);
            const lz = this.origin.toLocalZ(ship.z);
            ballMesh.position.set(lx, ship.y + 1.8, lz);
            this.overworldGroup.add(ballMesh);
            this.cannonballs.push({
              x: ship.x,
              y: ship.y + 1.8,
              z: ship.z,
              vx: Math.sin(ang) * 32,
              vy: 4.8,
              vz: Math.cos(ang) * 32,
              fromPlayer: false,
              damage: 18,
              life: 2.6,
              mesh: ballMesh,
            });
          }
        }
      }

      const fwdSpeed = stepShipBuoyancyAndPhysics(
        ship,
        dt,
        elapsed,
        this.waveSampler,
        this.windAngleRad,
        this.windKnots,
        steer
      );

      // Wake foam particles behind stern while sailing
      if (fwdSpeed > 2.2 && Math.random() < dt * 10) {
        const sternX = ship.x - Math.sin(ship.heading) * ship.parts.lengthHalf;
        const sternZ = ship.z - Math.cos(ship.heading) * ship.parts.lengthHalf;
        this.particlePool.spawnBurst(this.origin.toLocalX(sternX), WATER_LEVEL + 0.15, this.origin.toLocalZ(sternZ), 0xe0f2fe, 2, {
          speed: 1.8,
          upBias: 0.4,
          scale: 0.65,
          life: 0.55,
          gravity: 1.2,
        });
      }

      _shipEuler.set(ship.pitch, ship.heading, ship.roll, 'YXZ');
      _shipQuat.setFromEuler(_shipEuler);
      ship.parts.group.quaternion.copy(_shipQuat);
      ship.parts.group.position.set(this.origin.toLocalX(ship.x), ship.y, this.origin.toLocalZ(ship.z));
    }

    // Step Flying Cannonballs
    for (let i = this.cannonballs.length - 1; i >= 0; i--) {
      const cb = this.cannonballs[i];
      cb.life -= dt;
      cb.vy -= 9.8 * dt;
      cb.x += cb.vx * dt;
      cb.y += cb.vy * dt;
      cb.z += cb.vz * dt;
      cb.mesh.position.set(this.origin.toLocalX(cb.x), cb.y, this.origin.toLocalZ(cb.z));

      let hit = false;
      for (const s of this.ships) {
        if (s.hull <= 0) continue;
        if (cb.fromPlayer && s.isPlayerOwned) continue;
        if (!cb.fromPlayer && !s.isPlayerOwned) continue;
        if (Math.hypot(cb.x - s.x, cb.z - s.z) < 4.5 && Math.abs(cb.y - (s.y + 1.5)) < 3.5) {
          s.hull = Math.max(0, s.hull - cb.damage);
          hit = true;
          this.particlePool.spawnBurst(cb.mesh.position.x, cb.y, cb.mesh.position.z, 0xf97316, 16);
          if (s.isHostile) {
            this.callbacks.onCombatLog(`Broadside struck ${s.name} for ${cb.damage} hull damage!`, 'damage');
            if (s.hull <= 0) {
              s.respawnTimer = 45;
              s.parts.group.visible = false;
              this.callbacks.onGainXpAndGold(140, 120);
              this.callbacks.onCombatLog(`Sank ${s.name}! Salvaged +120g & +140 XP!`, 'quest');
            }
          } else {
            this.callbacks.onCombatLog(`${s.name} took ${cb.damage} cannon damage!`, 'warning');
          }
          break;
        }
      }

      if (hit || cb.y <= WATER_LEVEL || cb.life <= 0) {
        if (!hit && cb.y <= WATER_LEVEL) {
          this.particlePool.spawnBurst(cb.mesh.position.x, WATER_LEVEL + 0.2, cb.mesh.position.z, 0xbae6fd, 10, {
            speed: 4.5,
            upBias: 4.2,
          });
        }
        this.overworldGroup.remove(cb.mesh);
        cb.mesh.geometry.dispose();
        (cb.mesh.material as THREE.Material).dispose();
        this.cannonballs.splice(i, 1);
      }
    }
  }

  private stepPlayerOnFootOrSwim(dt: number, elapsed: number, keys: Record<string, boolean>) {
    let moveForward = 0;
    let moveRight = 0;
    if (keys['KeyW'] || keys['ArrowUp']) moveForward += 1;
    if (keys['KeyS'] || keys['ArrowDown']) moveForward -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) moveRight += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) moveRight -= 1;

    const len = Math.hypot(moveForward, moveRight);
    let moveDirX = 0;
    let moveDirZ = 0;
    if (len > 0) {
      const nf = moveForward / len;
      const nr = moveRight / len;
      const fwdX = -Math.sin(this.cameraYaw);
      const fwdZ = -Math.cos(this.cameraYaw);
      const rightX = Math.cos(this.cameraYaw);
      const rightZ = -Math.sin(this.cameraYaw);
      moveDirX = fwdX * nf + rightX * nr;
      moveDirZ = fwdZ * nf + rightZ * nr;
    }

    // Climbable watchtower grab check
    const nearTower = !this.activeDungeon
      ? this.climbTowers.find((tw) => Math.hypot(tw.x - this.playerState.x, tw.z - this.playerState.z) < 3.4)
      : undefined;
    if (nearTower && keys['KeyC'] && this.playerState.stamina > 6) {
      this.playerState.isClimbing = true;
      this.isCrouching = false;
    } else if (!nearTower || !keys['KeyC']) {
      this.playerState.isClimbing = false;
    }

    const sprinting = Boolean((keys['ShiftLeft'] || keys['ShiftRight']) && len > 0 && this.playerState.stamina > 2 && !this.isCrouching);
    if (sprinting) {
      this.playerState.stamina = Math.max(0, this.playerState.stamina - dt * 15);
    } else if (this.playerState.isClimbing) {
      this.playerState.stamina = Math.max(0, this.playerState.stamina - dt * 11);
    } else {
      const regenMult = this.unlockedSkills.includes('warden_stride') ? 1.2 : 1.0;
      this.playerState.stamina = Math.min(this.playerState.maxStamina, this.playerState.stamina + dt * 20 * regenMult);
    }

    if (this.playerState.isClimbing && nearTower) {
      this.playerState.y = Math.min(nearTower.topY, this.playerState.y + dt * 4.5);
      this.velocityY = 0;
      return;
    }

    const compBonus = this.playerState.companionId === 'npc_lyra' ? 1.18 : 1.0;
    const speed =
      this.dodgeTimer > 0
        ? 16.5
        : this.isSwimming
          ? sprinting
            ? 7.8
            : 5.4
          : this.isCrouching
            ? 4.6
            : sprinting
              ? 12.6 * compBonus
              : 7.8 * compBonus;

    // Damped direction control keeps starts, stops and keyboard diagonals
    // responsive without instantaneous velocity changes. The fixed-step
    // coefficient gives the same feel at different monitor refresh rates.
    const moveBlend = 1 - Math.exp(-dt * (len > 0 ? 15 : 21));
    this.smoothedMoveX += (moveDirX - this.smoothedMoveX) * moveBlend;
    this.smoothedMoveZ += (moveDirZ - this.smoothedMoveZ) * moveBlend;
    if (len === 0 && Math.hypot(this.smoothedMoveX, this.smoothedMoveZ) < 0.002) {
      this.smoothedMoveX = 0;
      this.smoothedMoveZ = 0;
    }
    const dirX = this.dodgeTimer > 0 ? this.dodgeDirX : this.smoothedMoveX;
    const dirZ = this.dodgeTimer > 0 ? this.dodgeDirZ : this.smoothedMoveZ;

    const res = stepPlayerPhysics({
      dt,
      elapsed,
      x: this.playerState.x,
      y: this.playerState.y,
      z: this.playerState.z,
      vy: this.velocityY,
      moveDirX: dirX,
      moveDirZ: dirZ,
      speed,
      isGrounded: this.isGrounded,
      isCrouching: this.isCrouching,
      isClimbing: this.playerState.isClimbing,
      ascendHeld: Boolean(keys['Space']),
      diveHeld: Boolean(keys['KeyC']),
      activeDungeon: this.activeDungeon ? { minX: -18.5, maxX: 18.5, minZ: -44.5, maxZ: 13.0 } : null,
      colliders: this.colliders,
      extraColliders: this.activeDungeon ? undefined : this.vegetation.colliders,
      iceBridges: this.iceBridges,
      ships: this.ships,
      waveSampler: this.waveSampler,
    });

    // Architectural collision is calculated in world space after terrain,
    // foliage and ship physics, so front doors remain traversable.
    const buildingResolved = this.activeDungeon
      ? { x: res.x, z: res.z }
      : this.livingSettlements.resolvePlayerMovement(
          this.playerState.x, this.playerState.z, res.x, res.z
        );
    this.playerState.x = buildingResolved.x;
    this.playerState.y = res.y;
    this.playerState.z = buildingResolved.z;
    this.velocityY = res.vy;
    this.isGrounded = res.isGrounded;
    this.isSwimming = res.isSwimming;
    this.isUnderwater = res.isUnderwater;
    this.playerState.isSwimming = res.isSwimming;
    this.playerState.isCrouching = this.isCrouching;

    // Law 2: Fall damage scaled by impact drop height above physicsConfig.safeFallHeightM (4m)
    if (res.fallImpactHeight > physicsConfig.safeFallHeightM && !res.isSwimming) {
      const excess = res.fallImpactHeight - physicsConfig.safeFallHeightM;
      const span = Math.max(1, physicsConfig.lethalFallHeightM - physicsConfig.safeFallHeightM);
      const fallDmg = Math.max(6, Math.round((excess / span) * this.playerState.maxHp));
      this.playerState.hp = Math.max(1, this.playerState.hp - fallDmg);
      this.playerSquashY = 0.72;
      this.screenShake = Math.min(0.45, 0.14 + excess * 0.03);
      soundEngine.triggerCue('damage_taken', `Fall Impact (-${fallDmg} HP)`);
      this.callbacks.onCombatLog(`Hard landing from ${res.fallImpactHeight.toFixed(1)}m dealt ${fallDmg} fall damage!`, 'warning');
    }

    // Oxygen / Breath handling while diving underwater
    if (this.isUnderwater) {
      this.oxygen = Math.max(0, this.oxygen - dt * 5.5);
      if (this.oxygen <= 0) {
        this.playerState.hp = Math.max(1, this.playerState.hp - dt * 8);
        if (this.oxygenWarnCooldown <= 0) {
          this.oxygenWarnCooldown = 2.0;
          this.callbacks.onCombatLog('Out of breath! Press [Space] to swim up!', 'warning');
        }
      }
    } else {
      this.oxygen = Math.min(this.maxOxygen, this.oxygen + dt * 28);
    }

    // Smoothly turn player character toward travel direction
    if (Math.hypot(dirX, dirZ) > 0.08 && this.dodgeTimer <= 0) {
      const targetRot = Math.atan2(dirX, dirZ);
      let diff = targetRot - this.playerModel.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.playerModel.group.rotation.y += diff * Math.min(1, dt * 14);
      this.walkPhase += dt * (sprinting ? 14 : 9.5);
    }

    // Subtle footstep / swim splash audio cues
    if (len > 0 && (this.isGrounded || this.isSwimming)) {
      const cycle = Math.floor(this.walkPhase / Math.PI);
      if (cycle !== this.lastFootstepPhase) {
        this.lastFootstepPhase = cycle;
        if (this.isSwimming && Math.random() < 0.65) {
          this.particlePool.spawnBurst(
            this.origin.toLocalX(this.playerState.x),
            WATER_LEVEL + 0.1,
            this.origin.toLocalZ(this.playerState.z),
            0xbae6fd,
            3,
            { speed: 1.4, upBias: 1.0, life: 0.4 }
          );
        }
      }
    }
  }

  private stepAiAndWorldProps(dt: number, elapsed: number) {
    // Ice Bridges & Updrafts & Brush
    for (let i = this.iceBridges.length - 1; i >= 0; i--) {
      this.iceBridges[i].timer -= dt;
      if (this.iceBridges[i].timer <= 0) {
        this.overworldGroup.remove(this.iceBridges[i].mesh);
        this.iceBridges.splice(i, 1);
      }
    }
    for (let i = this.updrafts.length - 1; i >= 0; i--) {
      this.updrafts[i].timer -= dt;
      this.updrafts[i].mesh.rotation.z += dt * 4;
      if (this.updrafts[i].timer <= 0) {
        this.overworldGroup.remove(this.updrafts[i].mesh);
        this.updrafts.splice(i, 1);
      }
    }
    for (let i = this.shockZones.length - 1; i >= 0; i--) {
      this.shockZones[i].timer -= dt;
      this.shockZones[i].ring.rotation.z += dt * 3;
      if (this.shockZones[i].timer <= 0) {
        this.overworldGroup.remove(this.shockZones[i].ring);
        this.shockZones.splice(i, 1);
      }
    }

    // Lighthouses & Crystals rotation
    this.lighthouseBeams.forEach((b) => (b.rotation.y += dt * 0.55));
    if (this.centralSpire) {
      this.centralSpire.crystal.rotation.y += dt * 0.45;
      this.centralSpire.ring.rotation.z += dt * 0.35;
    }
    this.sealModels.forEach((m) => {
      m.crystal.rotation.y += dt * 0.9;
      m.ring.rotation.z += dt * 0.65;
      m.crystal.position.y = 2.7 + Math.sin(elapsed * 2) * 0.16;
    });

    // Resource respawn
    this.resourceNodes.forEach((n) => {
      if (!n.available) {
        n.respawnTimer -= dt;
        if (n.respawnTimer <= 0) {
          n.available = true;
          n.mesh.visible = true;
        }
      }
    });

    // Active Companion Follow
    if (this.companionMesh && !this.activeDungeon) {
      const tx = this.playerState.x - Math.sin(this.playerModel.group.rotation.y) * 2.3;
      const tz = this.playerState.z - Math.cos(this.playerModel.group.rotation.y) * 2.3;
      this.companionPos.x = THREE.MathUtils.lerp(this.companionPos.x, tx, Math.min(1, dt * 4));
      this.companionPos.z = THREE.MathUtils.lerp(this.companionPos.z, tz, Math.min(1, dt * 4));
      this.companionPos.y = Math.max(WATER_LEVEL + 0.1, groundHeightAt(this.companionPos.x, this.companionPos.z));
      this.companionMesh.position.set(
        this.origin.toLocalX(this.companionPos.x),
        this.companionPos.y,
        this.origin.toLocalZ(this.companionPos.z)
      );
      this.companionMesh.lookAt(
        this.origin.toLocalX(this.playerState.x),
        this.companionPos.y,
        this.origin.toLocalZ(this.playerState.z)
      );
      const cPrev = (this.companionMesh.userData.lastPos as THREE.Vector3 | undefined) ?? this.companionPos.clone();
      const cSpeed = dt > 0 ? Math.hypot(this.companionPos.x - cPrev.x, this.companionPos.z - cPrev.z) / dt : 0;
      this.companionMesh.userData.lastPos = this.companionPos.clone();
      (this.companionMesh.userData.character as Character | undefined)?.update(dt, {
        speed: Math.min(6.5, cSpeed * 0.52),
        swimming: this.companionPos.y <= WATER_LEVEL + 0.15,
      });
    }

    // NPC Schedules + Look Idle
    const tod = this.clockState.getTimeOfDayLabel();
    this.npcs.forEach((npc) => {
      const slot = npc.schedules.find((s) => s.timeOfDay === tod);
      if (slot) {
        npc.x = THREE.MathUtils.lerp(npc.x, slot.x, Math.min(1, dt * 0.5));
        npc.z = THREE.MathUtils.lerp(npc.z, slot.z, Math.min(1, dt * 0.5));
      }
      const mesh = this.npcMeshes.get(npc.id);
      if (mesh) {
        const nx = this.origin.toLocalX(npc.x);
        const nz = this.origin.toLocalZ(npc.z);
        const prevX = mesh.userData.lastX ?? npc.x;
        const prevZ = mesh.userData.lastZ ?? npc.z;
        const npcSpeed = dt > 0 ? Math.hypot(npc.x - prevX, npc.z - prevZ) / dt : 0;
        if (npcSpeed > 0.05) mesh.rotation.y = Math.atan2(npc.x - prevX, npc.z - prevZ);
        mesh.userData.lastX = npc.x;
        mesh.userData.lastZ = npc.z;
        mesh.position.set(nx, groundHeightAt(npc.x, npc.z), nz);
        // Distance LOD: full-rate animation up close, throttled mid-range, hidden far away.
        const dist = Math.hypot(npc.x - this.playerState.x, npc.z - this.playerState.z);
        mesh.visible = dist < 110 && !this.activeDungeon;
        const ch = mesh.userData.character as Character | undefined;
        if (ch && mesh.visible) {
          const acc = ((mesh.userData.animAcc as number | undefined) ?? 0) + dt;
          const interval = dist < 40 ? 0 : dist < 75 ? 1 / 20 : 1 / 8;
          if (acc >= interval) {
            ch.update(acc, { speed: Math.min(6.5, npcSpeed * 0.8) });
            mesh.userData.animAcc = 0;
          } else mesh.userData.animAcc = acc;
        }
      }
    });

    // Fauna & Mystical Creatures
    if (!this.activeDungeon) {
      this.animals.forEach((a) => {
        a.angle += (a.speed / 12) * dt;
        a.x = a.homeX + Math.cos(a.angle) * 10;
        a.z = a.homeZ + Math.sin(a.angle) * 10;
        a.y = a.kind === 'eagle' ? 22 + Math.sin(elapsed + a.angle) * 2.2 : groundHeightAt(a.x, a.z);
        a.parts.group.position.set(this.origin.toLocalX(a.x), a.y, this.origin.toLocalZ(a.z));
        a.parts.group.rotation.y = -a.angle;
        if (a.parts.wings) {
          const fl = Math.sin(elapsed * 7 + a.angle) * 0.45;
          a.parts.wings.forEach((w, idx) => (w.rotation.z = idx === 0 ? fl : -fl));
        }
      });

      this.mystics.forEach((m) => {
        m.angle += dt * 0.5;
        m.x = m.homeX + Math.cos(m.angle) * 8;
        m.z = m.homeZ + Math.sin(m.angle) * 8;
        m.y = m.kind === 'phoenix' ? 16 + Math.sin(elapsed * 2) * 2.0 : groundHeightAt(m.x, m.z) + (m.kind === 'wisp' ? 1.4 : 0);
        m.parts.group.position.set(this.origin.toLocalX(m.x), m.y, this.origin.toLocalZ(m.z));
        m.parts.group.rotation.y = -m.angle;
      });
    }

    // Enemy & Dragon AI + Blocking/Parry Mitigation
    const activeList = this.activeDungeon ? this.dungeonEnemies : this.enemies;
    const isBlocking = this.input.isBlocking();
    for (const e of activeList) {
      const grp = e.dragonParts?.group || e.parts?.group;
      if (!e.alive) {
        e.respawnTimer -= dt;
        if (e.respawnTimer <= 0 && !e.isDungeonMob) {
          e.alive = true;
          e.hp = e.maxHp;
          e.x = e.homeX;
          e.z = e.homeZ;
          if (grp) grp.visible = true;
        }
        continue;
      }

      if (e.primeTimer > 0) {
        e.primeTimer -= dt;
        if (e.primeTimer <= 0) e.primedElement = null;
      }
      if (e.stunTimer > 0) e.stunTimer -= dt;
      if (e.attackCooldown > 0) e.attackCooldown -= dt;

      const dist = Math.hypot(this.playerState.x - e.x, this.playerState.z - e.z);
      // Hide and sleep remote enemies. Keeps outer island encounters from
      // consuming draw calls and terrain sampling during mainland gameplay.
      if (!this.activeDungeon && dist > 155) {
        if (grp) grp.visible = false;
        e.windupTimer = 0;
        if (e.parts) e.parts.telegraphRing.visible = false;
        continue;
      }
      if (grp) grp.visible = true;
      const aggroRange = e.isDragon ? 28 : 19;
      const meleeRange = e.isDragon ? 5.2 : 2.9;

      if (e.stunTimer <= 0 && dist < aggroRange && !this.atHelmShipId && !this.isUnderwater) {
        if (dist > meleeRange) {
          const spd = e.isDragon ? 4.4 : 3.8;
          e.x += ((this.playerState.x - e.x) / dist) * spd * dt;
          e.z += ((this.playerState.z - e.z) / dist) * spd * dt;
        } else if (e.attackCooldown <= 0) {
          if (e.windupTimer <= 0) {
            e.windupTimer = 0.62;
            if (e.parts) e.parts.telegraphRing.visible = true;
          } else {
            e.windupTimer -= dt;
            if (e.windupTimer <= 0) {
              if (e.parts) e.parts.telegraphRing.visible = false;
              e.attackCooldown = 2.1;
              if (dist < meleeRange + 1.1 && this.dodgeTimer <= 0) {
                const rawHit = e.isDragon ? 18 : 11;
                const mitigated = isBlocking ? Math.round(rawHit * 0.25) : rawHit;
                this.playerState.hp = Math.max(1, this.playerState.hp - mitigated);
                this.recentCombatTimer = 6.5;
                soundEngine.triggerCue(isBlocking ? 'climb' : 'damage_taken', isBlocking ? 'Shield Blocked!' : 'Enemy Strike');
                this.callbacks.onCombatLog(
                  isBlocking ? `Shield blocked ${e.name}'s blow (${mitigated} dmg)!` : `${e.name} struck you for ${mitigated} dmg!`,
                  isBlocking ? 'world' : 'warning'
                );
              }
            }
          }
        }
      }

      if (grp) {
        const ey = this.activeDungeon ? 0 : groundHeightAt(e.x, e.z);
        const lx = this.activeDungeon ? e.x : this.origin.toLocalX(e.x);
        const lz = this.activeDungeon ? e.z : this.origin.toLocalZ(e.z);
        grp.position.set(lx, ey + (e.isDragon ? 1.2 + Math.sin(elapsed * 2.2) * 0.45 : 0), lz);
        grp.lookAt(
          this.activeDungeon ? this.playerState.x : this.origin.toLocalX(this.playerState.x),
          this.playerState.y,
          this.activeDungeon ? this.playerState.z : this.origin.toLocalZ(this.playerState.z)
        );
        if (e.dragonParts) {
          const flap = Math.sin(elapsed * 4.5 + e.homeX) * 0.45;
          e.dragonParts.leftWing.rotation.z = flap;
          e.dragonParts.rightWing.rotation.z = -flap;
        }
      }
    }
  }

  private syncWorldPinnedTransforms(elapsed: number) {
    if (this.centralSpire) {
      this.centralSpire.group.position.set(
        this.origin.toLocalX(0),
        groundHeightAt(0, 0) + 0.45,
        this.origin.toLocalZ(0)
      );
    }
    this.dungeonPortals.forEach((dp) => {
      dp.mesh.position.set(this.origin.toLocalX(dp.x), groundHeightAt(dp.x, dp.z), this.origin.toLocalZ(dp.z));
    });
    this.resourceNodes.forEach((rn) => {
      rn.mesh.position.set(this.origin.toLocalX(rn.x), Math.max(WATER_LEVEL + 0.15, groundHeightAt(rn.x, rn.z)), this.origin.toLocalZ(rn.z));
    });
    void elapsed;
  }

  private updateAtmosphereAndVisuals(dt: number) {
    const elapsed = this.clockState.elapsedPlaySeconds;
    // Interpolate between the last two fixed simulation steps so motion is smooth at any refresh rate.
    const cur = this.renderPos.set(this.playerState.x, this.playerState.y, this.playerState.z);
    if (Number.isFinite(this.prevSimPos.x) && this.prevSimPos.distanceToSquared(cur) < 25) {
      cur.lerpVectors(this.prevSimPos, cur, this.renderAlpha);
    }
    const rY = cur.y;
    const plx = this.activeDungeon ? cur.x : this.origin.toLocalX(cur.x);
    const plz = this.activeDungeon ? cur.z : this.origin.toLocalZ(cur.z);

    // 1. Update Camera & Smooth Spring Target
    const camDelta = this.input.consumeCameraDelta();
    this.cameraYaw += camDelta.yawDelta;
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + camDelta.pitchDelta, 0.14, 1.05);
    this.cameraDist = THREE.MathUtils.clamp(
      this.cameraDist + camDelta.zoomDelta,
      6.5,
      this.atHelmShipId ? 34 : 24
    );

    if (this.gameMode === 'title') {
      this.cameraYaw += dt * 0.14;
    }

    const activeShip = this.atHelmShipId ? this.ships.find((s) => s.id === this.atHelmShipId) : null;
    const lookAnchorX = activeShip ? this.origin.toLocalX(activeShip.x) : plx;
    const lookAnchorZ = activeShip ? this.origin.toLocalZ(activeShip.z) : plz;
    const lookAnchorY = activeShip ? activeShip.y + 3.2 : rY + (this.isCrouching ? 1.15 : 1.75);

    this.smoothCamTarget.lerp(this.tmpCamVec.set(lookAnchorX, lookAnchorY, lookAnchorZ), 1 - Math.exp(-dt * 12));

    const horizDist = Math.cos(this.cameraPitch) * this.cameraDist;
    const desiredCamX = this.smoothCamTarget.x + Math.sin(this.cameraYaw) * horizDist;
    const desiredCamZ = this.smoothCamTarget.z + Math.cos(this.cameraYaw) * horizDist;
    const desiredCamY = this.smoothCamTarget.y + Math.sin(this.cameraPitch) * this.cameraDist;

    const ox = this.activeDungeon ? 0 : this.origin.originX;
    const oz = this.activeDungeon ? 0 : this.origin.originZ;
    const resolvedCamWorld = resolveCameraCollision({
      targetWorldX: this.smoothCamTarget.x + ox,
      targetWorldY: this.smoothCamTarget.y,
      targetWorldZ: this.smoothCamTarget.z + oz,
      desiredWorldX: desiredCamX + ox,
      desiredWorldY: desiredCamY,
      desiredWorldZ: desiredCamZ + oz,
      activeDungeon: this.activeDungeon ? { minX: -18.5, maxX: 18.5, minZ: -44.5, maxZ: 13.0 } : null,
      colliders: this.colliders,
      extraColliders: this.activeDungeon ? undefined : this.vegetation.colliders,
    });
    this.smoothCamPos.lerp(
      this.tmpCamVec.set(resolvedCamWorld.x - ox, resolvedCamWorld.y, resolvedCamWorld.z - oz),
      1 - Math.exp(-dt * 14)
    );

    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake - dt * 1.8);
      this.camera.position.set(
        this.smoothCamPos.x + (Math.random() - 0.5) * this.screenShake,
        this.smoothCamPos.y + (Math.random() - 0.5) * this.screenShake,
        this.smoothCamPos.z + (Math.random() - 0.5) * this.screenShake
      );
    } else {
      this.camera.position.copy(this.smoothCamPos);
    }
    this.camera.lookAt(this.smoothCamTarget);

    // 2. Player Procedural Rig Animation (Walk / Swim / Crouch / Block / Attack)
    this.playerModel.group.position.set(plx, rY, plz);
    this.playerSquashY = THREE.MathUtils.lerp(this.playerSquashY, 1.0, Math.min(1, dt * 12));
    this.playerModel.bodyPivot.scale.set(1, this.playerSquashY, 1);

    // Real ground speed from position change (world units/s), mapped to the rig's gait scale.
    // Game run speed 7.8 -> jog, sprint 12.6 -> full sprint.
    const pdx = cur.x - this.lastAnimPos.x;
    const pdz = cur.z - this.lastAnimPos.z;
    this.lastAnimPos.copy(cur);
    const groundSpeed = dt > 0 ? Math.min(30, Math.hypot(pdx, pdz) / dt) : 0;
    const turnDelta = this.playerModel.group.rotation.y - this.lastAnimYaw;
    this.lastAnimYaw = this.playerModel.group.rotation.y;
    const atHelm = Boolean(this.atHelmShipId);
    this.playerModel.character.update(dt, {
      speed: atHelm ? 0 : groundSpeed * 0.52,
      turnRate: dt > 0 ? turnDelta / dt : 0,
      crouching: this.isCrouching && !this.isSwimming,
      swimming: this.isSwimming,
      blocking: this.input.isBlocking() && !atHelm,
      airborne: !this.isGrounded && !this.isSwimming && !this.playerState.isClimbing,
    });

    // 3. Sky, Weather, Ocean & Lights Update
    if (!this.activeDungeon) {
      const atm = this.skyWeather.update(
        dt,
        elapsed,
        plx,
        plz,
        this.playerState.x,
        this.playerState.z,
        this.camera.position.y,
        this.clockState.timeOfDayIndex,
        this.weather,
        this.season,
        this.currentBiome,
        this.biomes[this.currentBiome].health,
        _lightDir
      );
      this.snowUniforms.uTime.value = elapsed;
      this.snowUniforms.uLightDir.value.copy(_lightDir);

      this.oceanSurface.uniforms.uTime.value = elapsed;
      this.oceanSurface.uniforms.uLightDir.value.copy(_lightDir);
      this.oceanSurface.uniforms.uLightColor.value.setHex(atm.lightColorHex);
      this.oceanSurface.uniforms.uSkyHorizon.value.copy(this.skyWeather.skyUniforms.uHorizonColor.value);
      this.oceanSurface.uniforms.uSkyZenith.value.copy(this.skyWeather.skyUniforms.uTopColor.value);
      this.oceanSurface.uniforms.uFogColor.value.copy(this.skyWeather.fog.color);
      this.oceanSurface.uniforms.uFogDensity.value = this.skyWeather.fog.density;
      this.oceanSurface.uniforms.uIsNight.value = atm.isNight ? 1.0 : 0.0;
      this.oceanSurface.uniforms.uIsUnderwater.value = atm.isUnderwater ? 1.0 : 0.0;

      // Update key light / CSM / Hemisphere & IBL for clear AgX HDR dynamic range
      this.keySunLight.color.setHex(atm.lightColorHex);
      this.keySunLight.intensity = atm.isNight ? 2.05 : 3.1;
      this.keySunLight.position.set(plx + _lightDir.x * 75, _lightDir.y * 75, plz + _lightDir.z * 75);
      this.keySunLight.target.position.set(plx, 0, plz);
      if (this.csm) {
        this.csm.lightDirection.copy(_lightDir).negate();
        this.csm.lights.forEach((l) => {
          l.color.setHex(atm.lightColorHex);
          l.intensity = atm.isNight ? 0.92 : 1.42;
        });
        this.csm.update();
      }
      this.hemiLight.intensity = atm.isNight ? 0.88 : 1.28;
      this.scene.environmentIntensity = atm.isNight ? 0.82 : 1.08;

      // Budget magic PointLights by proximity so distant crystals stay sleek & fast
      this.magicPointLights.forEach((entry) => {
        const dist = Math.hypot(entry.worldX - this.playerState.x, entry.worldZ - this.playerState.z);
        entry.light.visible = dist < 95;
        if (entry.light.visible) {
          entry.light.intensity = entry.baseIntensity * (1 + Math.sin(elapsed * 3.1 + entry.worldX) * 0.08);
        }
      });

      // Subtle campfire ember sparks when near settlements/harbors
      for (const cf of this.campfires) {
        if (Math.hypot(cf.x - this.playerState.x, cf.z - this.playerState.z) < 40 && Math.random() < dt * 7) {
          this.particlePool.spawnBurst(this.origin.toLocalX(cf.x), cf.y, this.origin.toLocalZ(cf.z), 0xfb923c, 1, {
            speed: 0.8,
            upBias: 2.2,
            scale: 0.45,
            gravity: -0.6,
            life: 0.9,
          });
        }
      }
    }

    this.particlePool.update(dt);
  }

  private updateAdaptivePerformance(smoothedMs: number) {
    if (this.requestedPreset !== 'auto' || this.tierConfig.tier === 'low') return;
    if (smoothedMs > 36) {
      this.slowFrameStreak++;
      if (this.slowFrameStreak > 45) {
        this.slowFrameStreak = 0;
        const order: ResolvedGraphicsTier[] = ['ultra', 'high', 'medium', 'low'];
        const nextIdx = Math.min(order.length - 1, order.indexOf(this.tierConfig.tier) + 1);
        this.detectedGpuTier = order[nextIdx];
        this.applyGraphicsTier(false);
      }
    } else {
      this.slowFrameStreak = Math.max(0, this.slowFrameStreak - 1);
    }
  }

  private renderFrame() {
    this.pipeline.render(this.renderer, this.scene, this.camera);
  }

  private emitContextualPrompts() {
    const prompts: NearbyPrompt[] = [];
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const px = this.playerState.x;
    const pz = this.playerState.z;

    const project = (wx: number, wy: number, wz: number) => {
      const lx = this.activeDungeon ? wx : this.origin.toLocalX(wx);
      const lz = this.activeDungeon ? wz : this.origin.toLocalZ(wz);
      _proj.set(lx, wy, lz).project(this.camera);
      if (_proj.z > 1) return null;
      return { sx: ((_proj.x + 1) / 2) * w, sy: ((-_proj.y + 1) / 2) * h };
    };

    if (this.activeDungeon) {
      const dEx = Math.hypot(0 - px, 12 - pz);
      if (dEx < 7.5) {
        const sc = project(0, 2.8, 12);
        if (sc) prompts.push({ id: 'dungeon_exit', kind: 'dungeon_exit', label: 'Cavern Exit', actionHint: '[E] Overworld', color: '#38bdf8', screenX: sc.sx, screenY: sc.sy, distance: dEx });
      }
      this.dungeonChests.forEach((c) => {
        if (c.opened) return;
        const d = Math.hypot(c.x - px, c.z - pz);
        if (d < 6) {
          const sc = project(c.x, 1.3, c.z);
          if (sc) prompts.push({ id: c.id, kind: 'chest', label: 'Relic Chest', actionHint: '[E] Loot', color: '#fbbf24', screenX: sc.sx, screenY: sc.sy, distance: d });
        }
      });
    } else if (!this.atHelmShipId) {
      // Ship Helm boarding prompt
      for (const s of this.ships) {
        if (!s.isPlayerOwned) continue;
        const sinH = Math.sin(s.heading);
        const cosH = Math.cos(s.heading);
        const hx = s.x + cosH * s.parts.helmLocalPos.x + sinH * s.parts.helmLocalPos.z;
        const hz = s.z - sinH * s.parts.helmLocalPos.x + cosH * s.parts.helmLocalPos.z;
        const d = Math.hypot(hx - px, hz - pz);
        if (d < 6.8) {
          const sc = project(hx, s.y + s.parts.deckY + 1.8, hz);
          if (sc) prompts.push({ id: s.id, kind: 'ship_helm', label: s.name, actionHint: '[E] Take Helm', color: '#38bdf8', screenX: sc.sx, screenY: sc.sy, distance: d });
        }
      }

      // Harbor Shipyard prompt
      this.harborAnchors.forEach((ha) => {
        const d = Math.hypot(ha.shipyardX - px, ha.shipyardZ - pz);
        if (d < 9.0) {
          const sc = project(ha.shipyardX, groundHeightAt(ha.shipyardX, ha.shipyardZ) + 2.6, ha.shipyardZ);
          if (sc) prompts.push({ id: ha.id, kind: 'shipyard', label: `${ha.name} Shipyard`, actionHint: '[E] Drydock & Fleet', color: '#38bdf8', screenX: sc.sx, screenY: sc.sy, distance: d });
        }
      });

      // Sunken Sea Wrecks salvage prompt
      this.seaWrecks.forEach((sw) => {
        if (sw.looted) return;
        const d = Math.hypot(sw.x - px, sw.z - pz);
        if (d < 7.5 && Math.abs(this.playerState.y - sw.depthY) < 4.5) {
          const sc = project(sw.x, sw.depthY + 1.2, sw.z);
          if (sc) prompts.push({ id: sw.id, kind: 'salvage', label: sw.name, actionHint: '[E] Salvage Wreck', color: '#fbbf24', screenX: sc.sx, screenY: sc.sy, distance: d });
        }
      });

      this.dungeonPortals.forEach((dp) => {
        const d = Math.hypot(dp.x - px, dp.z - pz);
        if (d < 8) {
          const sc = project(dp.x, groundHeightAt(dp.x, dp.z) + 3.0, dp.z);
          if (sc) prompts.push({ id: dp.id, kind: 'dungeon_enter', label: dp.name, actionHint: '[E] Enter Cave', color: '#c084fc', screenX: sc.sx, screenY: sc.sy, distance: d });
        }
      });
      this.npcs.forEach((n) => {
        const d = Math.hypot(n.x - px, n.z - pz);
        if (d < 8.5) {
          const sc = project(n.x, groundHeightAt(n.x, n.z) + 2.2, n.z);
          if (sc) prompts.push({ id: n.id, kind: 'npc', label: n.name, actionHint: '[E] Speak', color: '#fbbf24', screenX: sc.sx, screenY: sc.sy, distance: d });
        }
      });
      this.resourceNodes.forEach((r) => {
        if (!r.available) return;
        const d = Math.hypot(r.x - px, r.z - pz);
        if (d < 6.5) {
          const sc = project(r.x, groundHeightAt(r.x, r.z) + 1.1, r.z);
          if (sc) prompts.push({ id: r.id, kind: 'resource', label: r.itemId.replace('_', ' '), actionHint: '[E] Harvest', color: '#10b981', screenX: sc.sx, screenY: sc.sy, distance: d });
        }
      });
      this.outposts.forEach((op) => {
        const d = Math.hypot(op.x - px, op.z - pz);
        if (d < 10) {
          const sc = project(op.x, groundHeightAt(op.x, op.z) + 3.0, op.z);
          if (sc) prompts.push({ id: op.id, kind: 'outpost', label: op.name, actionHint: op.level === 0 ? '[E] Rebuild' : '[E] Upgrade', color: '#f59e0b', screenX: sc.sx, screenY: sc.sy, distance: d });
        }
      });
      this.seals.forEach((s) => {
        const d = Math.hypot(s.x - px, s.z - pz);
        if (d < 9.5) {
          const sc = project(s.x, groundHeightAt(s.x, s.z) + 3.2, s.z);
          if (sc) prompts.push({ id: s.id, kind: 'seal', label: s.name, actionHint: s.status === 'corrupted' ? '[E] Commune' : 'Awakened', color: '#c084fc', screenX: sc.sx, screenY: sc.sy, distance: d });
        }
      });
    }

    prompts.sort((a, b) => a.distance - b.distance);
    const actionable = prompts.find((p) => p.kind !== 'climb');
    this.nearestTarget = actionable ? { kind: actionable.kind, id: actionable.id } : null;
    this.callbacks.onInteractPrompt(prompts.slice(0, 4));
  }

  private emitHudSnapshot(smoothedMs: number) {
    this.callbacks.onPlayerStatsUpdate({
      hp: Math.round(this.playerState.hp),
      mana: Math.round(this.playerState.mana),
      stamina: Math.round(this.playerState.stamina),
      x: Number(this.playerState.x.toFixed(1)),
      y: Number(this.playerState.y.toFixed(1)),
      z: Number(this.playerState.z.toFixed(1)),
      isClimbing: this.playerState.isClimbing,
      isCrouching: this.isCrouching,
      isSwimming: this.isSwimming,
      isSailing: Boolean(this.atHelmShipId),
      cooldowns: { ...this.playerState.cooldowns },
    });

    const miniMapEntities: MiniMapEntity[] = [];
    const compassMarkers: CompassMarker[] = [];

    if (this.activeDungeon) {
      miniMapEntities.push({ id: 'exit', kind: 'dungeon', x: 0, z: 12, color: '#38bdf8', label: 'Exit' });
      this.dungeonChests.forEach((c) => {
        if (!c.opened) miniMapEntities.push({ id: c.id, kind: 'chest', x: c.x, z: c.z, color: '#fbbf24' });
      });
      this.dungeonEnemies.forEach((e) => {
        if (e.alive) miniMapEntities.push({ id: e.id, kind: e.isDragon ? 'dragon' : 'enemy', x: e.x, z: e.z, color: e.isDragon ? '#f97316' : '#ef4444' });
      });
    } else {
      this.seals.forEach((s) => {
        const col = s.status === 'corrupted' ? '#c084fc' : '#34d399';
        miniMapEntities.push({ id: s.id, kind: 'seal', x: s.x, z: s.z, color: col, label: s.name });
        compassMarkers.push({
          id: s.id,
          kind: 'seal',
          label: s.name,
          x: s.x,
          z: s.z,
          distance: Math.round(Math.hypot(s.x - this.playerState.x, s.z - this.playerState.z)),
          color: col,
        });
      });

      this.ships.forEach((s) => {
        if (s.hull <= 0) return;
        miniMapEntities.push({
          id: s.id,
          kind: 'ship',
          x: s.x,
          z: s.z,
          color: s.isPlayerOwned ? '#38bdf8' : s.isHostile ? '#ef4444' : '#fde68a',
          label: s.name,
        });
        if (s.isPlayerOwned) {
          compassMarkers.push({
            id: s.id,
            kind: 'ship',
            label: s.name,
            x: s.x,
            z: s.z,
            distance: Math.round(Math.hypot(s.x - this.playerState.x, s.z - this.playerState.z)),
            color: '#38bdf8',
          });
        }
      });

      // Procedurally streamed towns appear on navigation just like hand-made
      // settlements. Only active nearby world cells are included.
      this.livingSettlements.visibleSettlements.forEach((site) => {
        miniMapEntities.push({
          id: site.id, kind: 'outpost', x: site.x, z: site.z,
          color: '#f3c57b', label: site.name,
        });
        compassMarkers.push({
          id: site.id, kind: 'town', label: site.name,
          x: site.x, z: site.z,
          distance: Math.round(Math.hypot(site.x - this.playerState.x, site.z - this.playerState.z)),
          color: '#f3c57b',
        });
      });

      WORLD_POIS.forEach((poi) => {
        if (poi.kind === 'harbor') {
          miniMapEntities.push({ id: poi.id, kind: 'harbor', x: poi.x, z: poi.z, color: '#60a5fa', label: poi.name });
          compassMarkers.push({
            id: poi.id,
            kind: 'harbor',
            label: poi.name,
            x: poi.x,
            z: poi.z,
            distance: Math.round(Math.hypot(poi.x - this.playerState.x, poi.z - this.playerState.z)),
            color: '#60a5fa',
          });
        } else if (poi.kind === 'lighthouse' || poi.kind === 'wreck') {
          compassMarkers.push({
            id: poi.id,
            kind: 'town',
            label: poi.name,
            x: poi.x,
            z: poi.z,
            distance: Math.round(Math.hypot(poi.x - this.playerState.x, poi.z - this.playerState.z)),
            color: poi.kind === 'lighthouse' ? '#a78bfa' : '#f59e0b',
          });
        } else if (poi.kind === 'capital' || poi.kind === 'town') {
          compassMarkers.push({
            id: poi.id,
            kind: 'town',
            label: poi.name,
            x: poi.x,
            z: poi.z,
            distance: Math.round(Math.hypot(poi.x - this.playerState.x, poi.z - this.playerState.z)),
            color: '#fbbf24',
          });
        }
      });

      this.dungeonPortals.forEach((dp) => {
        miniMapEntities.push({ id: dp.id, kind: 'dungeon', x: dp.x, z: dp.z, color: '#a855f7', label: dp.name });
      });
      this.npcs.forEach((n) => miniMapEntities.push({ id: n.id, kind: 'npc', x: n.x, z: n.z, color: '#fbbf24' }));
      this.enemies.forEach((e) => {
        if (e.alive) {
          miniMapEntities.push({ id: e.id, kind: e.isDragon ? 'dragon' : 'enemy', x: e.x, z: e.z, color: e.isDragon ? '#f97316' : '#ef4444' });
          if (e.isDragon) {
            compassMarkers.push({
              id: e.id,
              kind: 'dragon',
              label: e.name,
              x: e.x,
              z: e.z,
              distance: Math.round(Math.hypot(e.x - this.playerState.x, e.z - this.playerState.z)),
              color: '#f97316',
            });
          }
        }
      });
    }

    const playerShip = this.ships.find((s) => s.id === (this.atHelmShipId || this.activeShipId));
    const distToShip = playerShip ? Math.hypot(playerShip.x - this.playerState.x, playerShip.z - this.playerState.z) : 999;
    const shipHud: ShipHudState | null =
      playerShip && (this.atHelmShipId || distToShip < 20)
        ? {
            activeShipId: playerShip.id,
            shipName: playerShip.name,
            shipType: playerShip.type,
            atHelm: Boolean(this.atHelmShipId),
            hull: Math.round(playerShip.hull),
            maxHull: playerShip.maxHull,
            sailSetting: playerShip.sailSetting,
            speedKnots: Number((Math.hypot(playerShip.vx, playerShip.vz) * 1.35).toFixed(1)),
            headingDeg: Math.round((((playerShip.heading * 180) / Math.PI) % 360 + 360) % 360),
            windAngleDeg: Math.round((((this.windAngleRad * 180) / Math.PI) % 360 + 360) % 360),
            windKnots: Math.round(this.windKnots),
            cannonCooldown: Number(playerShip.cannonCooldown.toFixed(1)),
            anchored: playerShip.anchored,
          }
        : null;

    const activeEnemyList = this.activeDungeon ? this.dungeonEnemies : this.enemies;
    const nearDragon = activeEnemyList.some(
      (e) => e.alive && e.isDragon && Math.hypot(e.x - this.playerState.x, e.z - this.playerState.z) < 46
    );
    const enemyAggroNear = activeEnemyList.some(
      (e) => e.alive && Math.hypot(e.x - this.playerState.x, e.z - this.playerState.z) < (e.isDragon ? 32 : 21)
    );
    const inCombat = this.recentCombatTimer > 0 || enemyAggroNear;
    const nearSeal =
      !this.activeDungeon &&
      (Math.hypot(this.playerState.x, this.playerState.z) < 20 ||
        this.seals.some((s) => Math.hypot(s.x - this.playerState.x, s.z - this.playerState.z) < 24));
    const nearSettlementOrNpc =
      !this.activeDungeon &&
      (this.npcs.some((n) => Math.hypot(n.x - this.playerState.x, n.z - this.playerState.z) < 24) ||
        this.outposts.some((o) => Math.hypot(o.x - this.playerState.x, o.z - this.playerState.z) < 28) ||
        this.harborAnchors.some((h) => Math.hypot(h.x - this.playerState.x, h.z - this.playerState.z) < 32) ||
        this.livingSettlements.visibleSettlements.some((site) => Math.hypot(site.x - this.playerState.x, site.z - this.playerState.z) < 40));

    this.callbacks.onHudTick({
      currentBiome: this.currentBiome,
      timeOfDay: this.clockState.getTimeOfDayLabel(),
      timeOfDayIndex: this.clockState.timeOfDayIndex,
      fps: Math.max(1, Math.round(1000 / Math.max(1, smoothedMs))),
      cameraYaw: this.cameraYaw,
      miniMapEntities,
      compassMarkers,
      activeDungeon: this.activeDungeon
        ? {
            id: this.activeDungeon.id,
            name: this.activeDungeon.name,
            biomeId: this.activeDungeon.biomeId,
            cleared: this.activeDungeon.cleared,
          }
        : null,
      telemetry: {
        fps: Math.max(1, Math.round(1000 / Math.max(1, smoothedMs))),
        frameTimeMs: Number(smoothedMs.toFixed(1)),
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        textures: this.renderer.info.memory.textures,
        resolvedTier: this.tierConfig.tier,
      },
      shipHud,
      diveHud: {
        isSwimming: this.isSwimming,
        isUnderwater: this.isUnderwater,
        oxygen: Math.round(this.oxygen),
        maxOxygen: this.maxOxygen,
        depthMeters: Math.max(0, Number((WATER_LEVEL - this.playerState.y).toFixed(1))),
      },
      sceneMusicSignals: {
        inCombat,
        nearDragon,
        nearSeal,
        nearSettlementOrNpc,
      },
    });
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    window.removeEventListener('resize', this.onResizeHandler);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.resizeObserver?.disconnect();
    this.input.dispose();
    this.chunkStreamer.dispose();
    this.oceanSurface.dispose();
    this.vegetation.dispose();
    this.livingSettlements.dispose();
    this.skyWeather.dispose();
    this.particlePool.dispose();
    this.pipeline.dispose();
    this.csm?.remove();
    this.csm?.dispose();
    this.snowSparkleNormal?.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

function plinthPos(m: THREE.Object3D, x: number, y: number, z: number) {
  m.position.set(x, y, z);
}
