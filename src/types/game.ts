import type { CharacterAppearance } from '../engine/characters.js';
export type BiomeId = 'suncrest' | 'verdant' | 'ember' | 'aether';
export type ElementType = 'fire' | 'lightning' | 'frost' | 'gale' | 'physical';
export type WeatherType = 'Clear' | 'Rain' | 'Thunderstorm' | 'Ashfall' | 'Mist';
export type SeasonType = 'Spring' | 'Summer' | 'Autumn' | 'Winter';
export type TimeOfDay = 'Dawn' | 'Day' | 'Dusk' | 'Night';
export type FactionId = 'suncrest_order' | 'verdant_circle' | 'ironbound_guild';
export type AccessibilityTheme = 'default' | 'high_contrast' | 'colorblind';
export type GraphicsPreset = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
export type ResolvedGraphicsTier = 'low' | 'medium' | 'high' | 'ultra';

export interface PerfTelemetry {
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  resolvedTier: ResolvedGraphicsTier;
}

export interface BiomeState {
  id: BiomeId;
  name: string;
  subtitle: string;
  health: number; // 0 to 100
  corruptionDescription: string;
  restoredDescription: string;
  center: { x: number; z: number };
  radius: number;
  factionId: FactionId;
}

export interface ItemDef {
  id: string;
  name: string;
  category: 'resource' | 'catalyst' | 'consumable' | 'relic' | 'material';
  description: string;
  value: number;
  element?: ElementType;
  rarity: 'Common' | 'Uncommon' | 'Rare' | 'Mythic';
  healHp?: number;
  healMana?: number;
  attackBonus?: number;
  spellBonus?: number;
}

export interface InventoryItem {
  id: string;
  qty: number;
}

export interface CraftingRecipe {
  id: string;
  resultId: string;
  resultQty: number;
  ingredients: [string, string, string]; // sorted or unordered 3-slot crucible combination
  discovered: boolean;
  hint: string;
}

export interface FactionState {
  id: FactionId;
  name: string;
  reputation: number; // -100 to 100
  leaderNpcId: string;
  corruptInfluence: number; // 0 to 100 (sabotage reduces this)
  description: string;
}

export interface NpcScheduleSlot {
  timeOfDay: TimeOfDay;
  locationName: string;
  x: number;
  z: number;
  activity: string;
}

export interface NpcDialogueOption {
  id: string;
  label: string;
  response: string;
  moralDelta?: number; // +Light, -Shadow
  repDelta?: { factionId: FactionId; delta: number };
  questAdvance?: { questId: string; step: number; choice?: string };
  recruitable?: boolean;
  openShop?: boolean;
  favorCostGold?: number;
  favorTargetNpcId?: string;
}

export interface NpcState {
  id: string;
  name: string;
  role: string;
  factionId: FactionId;
  x: number;
  z: number;
  homeBiome: BiomeId;
  mood: 'Hopeful' | 'Guarded' | 'Distressed' | 'Hostile' | 'Allied';
  relationshipScore: number; // -50 to 100
  isCompanionCapable: boolean;
  companionBuff?: string;
  inventory: InventoryItem[];
  schedules: NpcScheduleSlot[];
  greeting: string;
  dialogueOptions: NpcDialogueOption[];
  relationships: { targetId: string; type: 'Ally' | 'Rival' | 'Mentor' | 'Trade Partner'; strength: number }[];
}

export interface QuestChoice {
  id: string;
  label: string;
  moralDelta: number;
  biomeHealthDelta?: { biomeId: BiomeId; delta: number };
  repDelta?: { factionId: FactionId; delta: number };
  rewardGold: number;
  rewardXp: number;
  consequenceText: string;
}

export interface QuestState {
  id: string;
  title: string;
  isProphecyMain: boolean;
  giverNpcId: string;
  biomeId: BiomeId;
  status: 'available' | 'active' | 'completed';
  step: number;
  maxSteps: number;
  description: string;
  objectives: string[];
  chosenPath?: string;
  choices?: QuestChoice[];
}

export interface OutpostState {
  id: string;
  name: string;
  biomeId: BiomeId;
  x: number;
  z: number;
  level: number; // 0 = ruined, 1 = rebuilt watchpost, 2 = fortified hub
  requiredMaterials: { itemId: string; qty: number }[];
  defenseBonus: number;
  biomeBonus: number;
  unlockedStock: string[];
}

export interface TradeRouteState {
  id: string;
  name: string;
  fromName: string;
  toName: string;
  fromCoord: { x: number; z: number };
  toCoord: { x: number; z: number };
  factionId: FactionId;
  health: number; // 0 to 100
  sabotaged: boolean;
  progress: number; // 0 to 1 caravan position
  goodsValue: number;
}

export interface SealShrineState {
  id: string;
  name: string;
  biomeId: BiomeId;
  element: ElementType;
  x: number;
  z: number;
  status: 'corrupted' | 'purified' | 'drained';
}

export interface SkillNode {
  id: string;
  name: string;
  branch: 'fire' | 'lightning' | 'frost' | 'gale' | 'warden';
  tier: 1 | 2 | 3;
  description: string;
  affinityReq: number;
  unlocked: boolean;
  effect: string;
}

export interface JournalEntry {
  id: string;
  title: string;
  category: 'Creature' | 'Biome' | 'Prophecy' | 'Relic';
  biomeId: BiomeId;
  discovered: boolean;
  sketchType: 'wraith' | 'golem' | 'stalker' | 'citadel' | 'grove' | 'crag' | 'spire' | 'crown';
  summary: string;
  ecologicalNote: string;
}

export interface PhotoSnapshot {
  id: string;
  dataUrl: string;
  timestamp: string;
  coords: { x: number; y: number; z: number };
  biomeName: string;
  biomeHealth: number;
  kingdomHealth: number;
  season: SeasonType;
  weather: WeatherType;
  activeQuestTitle: string;
  moralPath: 'Light' | 'Balanced' | 'Shadow';
}

export interface CombatLogEntry {
  id: string;
  timestamp: string;
  text: string;
  tone: 'damage' | 'combo' | 'heal' | 'world' | 'quest' | 'warning';
}

export interface NearbyPrompt {
  id: string;
  kind:
    | 'npc'
    | 'resource'
    | 'outpost'
    | 'seal'
    | 'climb'
    | 'caravan'
    | 'dungeon_enter'
    | 'dungeon_exit'
    | 'chest'
    | 'ship_helm'
    | 'shipyard'
    | 'salvage';
  label: string;
  actionHint: string;
  color: string;
  screenX: number;
  screenY: number;
  distance: number;
}

export interface MiniMapEntity {
  id: string;
  kind: 'npc' | 'enemy' | 'dragon' | 'animal' | 'mystic' | 'seal' | 'outpost' | 'dungeon' | 'chest' | 'quest' | 'ship' | 'harbor' | 'sealife';
  x: number;
  z: number;
  color: string;
  label?: string;
}

export interface CompassMarker {
  id: string;
  kind: 'seal' | 'harbor' | 'town' | 'dungeon' | 'dragon' | 'ship' | 'quest' | 'wreck';
  label: string;
  x: number;
  z: number;
  distance: number;
  color: string;
}

export type ShipType = 'sloop' | 'brigantine' | 'galleon';

export interface ShipHudState {
  activeShipId: string;
  shipName: string;
  shipType: ShipType;
  atHelm: boolean;
  hull: number;
  maxHull: number;
  sailSetting: number; // 0 = anchored/furled, 0.35 = half, 0.7 = battle, 1 = full
  speedKnots: number;
  headingDeg: number;
  windAngleDeg: number;
  windKnots: number;
  cannonCooldown: number;
  anchored: boolean;
}

export interface DiveHudState {
  isSwimming: boolean;
  isUnderwater: boolean;
  oxygen: number;
  maxOxygen: number;
  depthMeters: number;
}

export interface DungeonZoneInfo {
  id: string;
  name: string;
  biomeId: BiomeId;
  cleared: boolean;
}

export interface SceneMusicSignals {
  inCombat: boolean;
  nearDragon: boolean;
  nearSeal: boolean;
  nearSettlementOrNpc: boolean;
}

export interface AccessibilitySettings {
  theme: AccessibilityTheme;
  textScale: '100' | '115' | '130';
  reducedMotion: boolean;
  hapticsEnabled: boolean;
  visualSoundCues: boolean;
  screenReaderAnnouncements: boolean;
  masterVolume: number;
  musicVolume: number;
  ambientVolume: number;
  sfxVolume: number;
  graphicsPreset: GraphicsPreset;
  showPerfHud: boolean;
}

export interface PlayerState {
  /** Hero look and name from the character creator. Missing on saves made before the creator existed. */
  appearance?: CharacterAppearance;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  stamina: number;
  maxStamina: number;
  level: number;
  xp: number;
  xpToNext: number;
  gold: number;
  moralAlignment: number; // -100 (Shadow/Dominion) to +100 (Light/Mercy)
  x: number;
  y: number;
  z: number;
  isClimbing: boolean;
  isCrouching?: boolean;
  isSwimming?: boolean;
  isSailing?: boolean;
  ownedShipType?: ShipType;
  companionId: string | null;
  equippedWeapon: string;
  equippedRelic: string | null;
  elementalUses: {
    fire: number;
    lightning: number;
    frost: number;
    gale: number;
  };
  cooldowns: {
    fire: number;
    lightning: number;
    frost: number;
    gale: number;
    melee: number;
  };
}

export interface GameStateSnapshot {
  slotId: string;
  slotName: string;
  elapsedSeconds: number;
  timeOfDayIndex: number; // 0..1 day cycle
  season: SeasonType;
  weather: WeatherType;
  player: PlayerState;
  biomes: Record<BiomeId, BiomeState>;
  factions: Record<FactionId, FactionState>;
  inventory: InventoryItem[];
  discoveredRecipes: string[];
  quests: QuestState[];
  outposts: OutpostState[];
  tradeRoutes: TradeRouteState[];
  seals: SealShrineState[];
  unlockedSkills: string[];
  discoveredJournal: string[];
  npcStates: Record<string, { relationshipScore: number; inventory: InventoryItem[] }>;
}

export interface LeaderboardRecord {
  id: string;
  ownerId: string;
  displayName: string;
  restorationScore: number;
  kingdomHealth: number;
  elapsedSeconds: number;
  moralPath: 'Light' | 'Balanced' | 'Shadow';
  playerLevel: number;
  sealsRestored: number;
  updatedAt?: string;
}
