import { advanceFrontierGuardian, advanceFrontierDiscovery, mergeOutpostCatalog, mergeQuestCatalog, unlockFrontierFinale } from './data/frontierSaga';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Backpack,
  BookOpen,
  Camera,
  Cloud,
  Compass,
  Flame,
  Hammer,
  Mic,
  Settings,
  Shield,
  Snowflake,
  Sparkles,
  Swords,
  Sword,
  Crosshair,
  WandSparkles,
  Trophy,
  Wind,
  Zap,
  ChevronDown,
  ChevronUp,
  WifiOff,
  Volume2,
  Globe,
  Music,
  Pause,
  Play,
  Anchor,
  Ship,
  SkipBack,
  SkipForward,
  VolumeX,
  Waves,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { MusicPlaybackState, soundEngine, VisualCueEvent } from './audio/soundEngine';
import { HorizonCompassBar } from './components/hud/CompassBar';
import { GestureWheel } from './components/hud/GestureWheel';
import { MiniMap } from './components/hud/MiniMap';
import { VoiceOverlay } from './components/hud/VoiceOverlay';
import { DialogueModal } from './components/modals/DialogueModal';
import { InventoryCraftingModal } from './components/modals/InventoryCraftingModal';
import { KingdomDashboardModal } from './components/modals/KingdomDashboardModal';
import { QuestJournalModal } from './components/modals/QuestJournalModal';
import { RealmMapModal } from './components/modals/RealmMapModal';
import { SettingsAccessibilityModal } from './components/modals/SettingsAccessibilityModal';
import { ShipyardModal } from './components/modals/ShipyardModal';
import { SkillTreeModal } from './components/modals/SkillTreeModal';
import { SocialLeaderboardModal } from './components/modals/SocialLeaderboardModal';
import { SoundtrackModal } from './components/modals/SoundtrackModal';
import {
  INITIAL_BIOMES,
  INITIAL_FACTIONS,
  INITIAL_JOURNAL,
  INITIAL_NPCS,
  INITIAL_OUTPOSTS,
  INITIAL_QUESTS,
  INITIAL_RECIPES,
  INITIAL_SEALS,
  INITIAL_SKILLS,
  INITIAL_TRADE_ROUTES,
  ITEMS,
} from './data/worldData';
import { WorldEngine } from './engine/WorldEngine';
import CharacterCreatorModal from './components/modals/CharacterCreatorModal';
import type { CharacterAppearance } from './engine/characters.js';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import {
  loadCloudSaves,
  saveGameToCloud,
  signInWithGoogle,
  signOutAccount,
  submitLeaderboardScore,
  subscribeAuth,
  validateFirestoreConnection,
} from './services/firebase';
import {
  getActiveSlotId,
  loadAccessibilitySettings,
  loadLocalSaves,
  loadSavedPhotos,
  popPendingCloudSync,
  queuePendingCloudSync,
  saveAccessibilitySettings,
  saveLocalSlot,
  savePhotoSnapshot,
} from './services/storage';
import {
  AccessibilitySettings,
  BiomeId,
  BiomeState,
  CombatLogEntry,
  CompassMarker,
  DiveHudState,
  DungeonZoneInfo,
  FactionId,
  FactionState,
  GameStateSnapshot,
  InventoryItem,
  JournalEntry,
  MiniMapEntity,
  NearbyPrompt,
  NpcDialogueOption,
  NpcState,
  OutpostState,
  PerfTelemetry,
  PhotoSnapshot,
  PlayerState,
  QuestChoice,
  QuestState,
  SceneMusicSignals,
  SealShrineState,
  SeasonType,
  ShipHudState,
  ShipType,
  TimeOfDay,
  TradeRouteState,
  WeatherType,
} from './types/game';

const SEASONS: SeasonType[] = ['Spring', 'Summer', 'Autumn', 'Winter'];
const WEATHERS: WeatherType[] = ['Clear', 'Rain', 'Thunderstorm', 'Ashfall', 'Mist'];

function createDefaultPlayer(): PlayerState {
  return {
    hp: 120,
    maxHp: 120,
    mana: 100,
    maxMana: 100,
    stamina: 100,
    maxStamina: 100,
    level: 1,
    xp: 0,
    xpToNext: 100,
    gold: 85,
    moralAlignment: 0,
    x: 0,
    y: 1.4,
    z: 6,
    isClimbing: false,
    ownedShipType: 'sloop',
    companionId: null,
    equippedWeapon: 'suncrest_blade',
    equippedRelic: null,
    elementalUses: { fire: 0, lightning: 0, frost: 0, gale: 0 },
    cooldowns: { fire: 0, lightning: 0, frost: 0, gale: 0, melee: 0 },
  };
}

function createInitialInventory(): InventoryItem[] {
  return [
    { id: 'suncrest_blade', qty: 1 },
    { id: 'vitality_elixir', qty: 2 },
    { id: 'aether_draught', qty: 2 },
    { id: 'sunleaf_herb', qty: 3 },
    { id: 'ancient_timber', qty: 3 },
    { id: 'runed_stone', qty: 3 },
    { id: 'ember_ore', qty: 2 },
    { id: 'storm_crystal', qty: 1 },
    { id: 'frost_lotus', qty: 1 },
    { id: 'gale_feather', qty: 1 },
  ];
}

export default function App() {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<WorldEngine | null>(null);
  const [creatorMode, setCreatorMode] = useState<null | 'new' | 'edit'>(null);
  const isOnline = useOnlineStatus();

  // Load initial save if present
  const initialSave = useMemo(() => {
    const slotId = getActiveSlotId();
    const saves = loadLocalSaves();
    return saves[slotId] || null;
  }, []);

  const [slotId] = useState<string>(initialSave?.slotId || 'slot_1');
  const [slotName] = useState<string>(initialSave?.slotName || 'Chronicle 1');
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(initialSave?.elapsedSeconds || 0);
  const [timeOfDayIndex, setTimeOfDayIndex] = useState<number>(initialSave?.timeOfDayIndex ?? 0.85);
  const [timeOfDayLabel, setTimeOfDayLabel] = useState<TimeOfDay>(
    initialSave?.timeOfDayIndex !== undefined && initialSave.timeOfDayIndex < 0.72 && initialSave.timeOfDayIndex > 0.18
      ? 'Day'
      : 'Night'
  );
  const [season, setSeason] = useState<SeasonType>(initialSave?.season || 'Winter');
  const [weather, setWeather] = useState<WeatherType>(initialSave?.weather || 'Clear');
  const [currentBiome, setCurrentBiome] = useState<BiomeId>('suncrest');
  const [cameraYaw, setCameraYaw] = useState<number>(0);
  const [miniMapEntities, setMiniMapEntities] = useState<MiniMapEntity[]>([]);
  const [compassMarkers, setCompassMarkers] = useState<CompassMarker[]>([]);
  const [shipHud, setShipHud] = useState<ShipHudState | null>(null);
  const [diveHud, setDiveHud] = useState<DiveHudState>({
    isSwimming: false,
    isUnderwater: false,
    oxygen: 100,
    maxOxygen: 100,
    depthMeters: 0,
  });
  const [activeDungeon, setActiveDungeon] = useState<DungeonZoneInfo | null>(null);
  const [telemetry, setTelemetry] = useState<PerfTelemetry | null>(null);

  const [player, setPlayer] = useState<PlayerState>(initialSave?.player || createDefaultPlayer());
  const [biomes, setBiomes] = useState<Record<BiomeId, BiomeState>>(
    initialSave?.biomes || structuredClone(INITIAL_BIOMES)
  );
  const [factions, setFactions] = useState<Record<FactionId, FactionState>>(
    initialSave?.factions || structuredClone(INITIAL_FACTIONS)
  );
  const [inventory, setInventory] = useState<InventoryItem[]>(
    initialSave?.inventory || createInitialInventory()
  );
  const [discoveredRecipes, setDiscoveredRecipes] = useState<string[]>(
    initialSave?.discoveredRecipes || INITIAL_RECIPES.filter((r) => r.discovered).map((r) => r.id)
  );
  const [quests, setQuests] = useState<QuestState[]>(() => mergeQuestCatalog(initialSave?.quests, INITIAL_QUESTS));
  const [outposts, setOutposts] = useState<OutpostState[]>(() => mergeOutpostCatalog(initialSave?.outposts, INITIAL_OUTPOSTS));
  const [tradeRoutes, setTradeRoutes] = useState<TradeRouteState[]>(
    initialSave?.tradeRoutes || structuredClone(INITIAL_TRADE_ROUTES)
  );
  const [seals, setSeals] = useState<SealShrineState[]>(initialSave?.seals || structuredClone(INITIAL_SEALS));
  const [unlockedSkills, setUnlockedSkills] = useState<string[]>(
    initialSave?.unlockedSkills || ['warden_stride']
  );
  const [journal, setJournal] = useState<JournalEntry[]>(() => {
    const base = structuredClone(INITIAL_JOURNAL);
    if (initialSave?.discoveredJournal) {
      base.forEach((j) => {
        if (initialSave.discoveredJournal.includes(j.id)) j.discovered = true;
      });
    }
    return base;
  });
  const [npcs, setNpcs] = useState<NpcState[]>(() => {
    const base = structuredClone(INITIAL_NPCS);
    if (initialSave?.npcStates) {
      base.forEach((n) => {
        const st = initialSave.npcStates[n.id];
        if (st) {
          n.relationshipScore = st.relationshipScore;
          n.inventory = st.inventory;
        }
      });
    }
    return base;
  });

  // UI & Game Shell States
  const [gameMode, setGameMode] = useState<'title' | 'playing' | 'paused' | 'victory'>('title');
  const [victoryDismissed, setVictoryDismissed] = useState(false);
  const [hudCollapsed, setHudCollapsed] = useState(false);
  const [activeModal, setActiveModal] = useState<
    | null
    | 'inventory'
    | 'craft'
    | 'quests'
    | 'journal'
    | 'factions'
    | 'economy'
    | 'outposts'
    | 'relationships'
    | 'skills'
    | 'leaderboard'
    | 'photos'
    | 'cloud'
    | 'settings'
    | 'music'
    | 'atlas'
    | 'shipyard'
  >(null);
  const [activeNpcId, setActiveNpcId] = useState<string | null>(null);
  const [activeSealId, setActiveSealId] = useState<string | null>(null);
  const [gestureOpen, setGestureOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  const [prompts, setPrompts] = useState<NearbyPrompt[]>([]);
  const [combatLog, setCombatLog] = useState<CombatLogEntry[]>([
    {
      id: 'init_1',
      timestamp: '00:00',
      text: 'Welcome to Aethelgard. Speak with Elder Rowan or explore the four biomes to mend the Four Seals.',
      tone: 'quest',
    },
  ]);
  const [visualCue, setVisualCue] = useState<VisualCueEvent | null>(null);
  const [musicState, setMusicState] = useState<MusicPlaybackState>(() => soundEngine.getMusicState());
  const [sceneSignals, setSceneSignals] = useState<SceneMusicSignals>({
    inCombat: false,
    nearDragon: false,
    nearSeal: false,
    nearSettlementOrNpc: false,
  });
  const [srAnnouncement, setSrAnnouncement] = useState('');
  const [photos, setPhotos] = useState<PhotoSnapshot[]>(() => loadSavedPhotos());
  const [accessibility, setAccessibility] = useState<AccessibilitySettings>(() => loadAccessibilitySettings());
  const [user, setUser] = useState<User | null>(null);

  const logCounterRef = useRef(1);
  const playerRef = useRef(player);
  playerRef.current = player;

  const pushCombatLog = useCallback((text: string, tone: CombatLogEntry['tone'] = 'world') => {
    const id = `log_${++logCounterRef.current}`;
    const now = new Date();
    const ts = `${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    setCombatLog((prev) => [{ id, timestamp: ts, text, tone }, ...prev].slice(0, 6));
    setSrAnnouncement(text);
  }, []);

  const addInventoryItem = useCallback((itemId: string, qty: number) => {
    setInventory((prev) => {
      const idx = prev.findIndex((i) => i.id === itemId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: Math.max(0, next[idx].qty + qty) };
        return next.filter((i) => i.qty > 0);
      }
      if (qty <= 0) return prev;
      return [...prev, { id: itemId, qty }];
    });
  }, []);

  const gainXpAndGold = useCallback((xpGain: number, goldGain: number) => {
    setPlayer((prev) => {
      let xp = prev.xp + xpGain;
      let level = prev.level;
      let xpToNext = prev.xpToNext;
      let maxHp = prev.maxHp;
      let maxMana = prev.maxMana;
      while (xp >= xpToNext) {
        xp -= xpToNext;
        level += 1;
        xpToNext = Math.round(xpToNext * 1.45);
        maxHp += 15;
        maxMana += 10;
      }
      if (level > prev.level) {
        pushCombatLog(`Level Up! You reached Warden Level ${level} (Gesture Wheel expanded!).`, 'quest');
      }
      return {
        ...prev,
        xp,
        level,
        xpToNext,
        maxHp,
        maxMana,
        hp: level > prev.level ? maxHp : prev.hp,
        mana: level > prev.level ? maxMana : prev.mana,
        gold: prev.gold + goldGain,
      };
    });
  }, [pushCombatLog]);

  const adjustBiomeHealth = useCallback((biomeId: BiomeId, delta: number) => {
    setBiomes((prev) => ({
      ...prev,
      [biomeId]: {
        ...prev[biomeId],
        health: Math.max(0, Math.min(100, prev[biomeId].health + delta)),
      },
    }));
  }, []);

  const buildSnapshot = useCallback((): GameStateSnapshot => {
    const npcStates: Record<string, { relationshipScore: number; inventory: InventoryItem[] }> = {};
    npcs.forEach((n) => {
      npcStates[n.id] = { relationshipScore: n.relationshipScore, inventory: n.inventory };
    });
    return {
      slotId,
      slotName,
      elapsedSeconds,
      timeOfDayIndex,
      season,
      weather,
      player,
      biomes,
      factions,
      inventory,
      discoveredRecipes,
      quests,
      outposts,
      tradeRoutes,
      seals,
      unlockedSkills,
      discoveredJournal: journal.filter((j) => j.discovered).map((j) => j.id),
      npcStates,
    };
  }, [
    slotId, slotName, elapsedSeconds, timeOfDayIndex, season, weather,
    player, biomes, factions, inventory, discoveredRecipes, quests,
    outposts, tradeRoutes, seals, unlockedSkills, journal, npcs,
  ]);

  // Apply Accessibility CSS classes & audio volume
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-high-contrast', 'theme-colorblind', 'text-scale-115', 'text-scale-130', 'reduced-motion');
    if (accessibility.theme === 'high_contrast') root.classList.add('theme-high-contrast');
    if (accessibility.theme === 'colorblind') root.classList.add('theme-colorblind');
    if (accessibility.textScale === '115') root.classList.add('text-scale-115');
    if (accessibility.textScale === '130') root.classList.add('text-scale-130');
    if (accessibility.reducedMotion) root.classList.add('reduced-motion');
    soundEngine.configure({
      masterVolume: accessibility.masterVolume,
      musicVolume: accessibility.musicVolume ?? 0.7,
      ambientVolume: accessibility.ambientVolume,
      sfxVolume: accessibility.sfxVolume,
      hapticsEnabled: accessibility.hapticsEnabled,
    });
    engineRef.current?.setGraphicsPreset(accessibility.graphicsPreset);
    saveAccessibilitySettings(accessibility);
  }, [accessibility]);

  // Visual Sound-Cue & Music state listeners
  useEffect(() => {
    soundEngine.setVisualCueListener((cue) => {
      setVisualCue(cue);
    });
    const unsubMusic = soundEngine.subscribeMusicState(setMusicState);
    return () => {
      soundEngine.setVisualCueListener(null);
      unsubMusic();
    };
  }, []);

  // Adaptive Soundtrack Context (matches all 6 uploaded MP3 scores to live scene activity)
  useEffect(() => {
    soundEngine.setMusicContext({
      gameMode,
      biome: currentBiome,
      timeOfDay: timeOfDayLabel,
      weather,
      inDungeon: Boolean(activeDungeon),
      isSailing: Boolean(shipHud?.atHelm),
      isUnderwater: diveHud.isUnderwater,
      isSwimming: diveHud.isSwimming,
      isStealth: Boolean(player.isCrouching),
      inCombat: sceneSignals.inCombat,
      nearDragon: sceneSignals.nearDragon,
      nearSeal: sceneSignals.nearSeal,
      nearSettlementOrNpc: sceneSignals.nearSettlementOrNpc,
      isCraftingOrTown:
        Boolean(activeNpcId) || activeModal === 'craft' || activeModal === 'shipyard' || activeModal === 'outposts',
    });
  }, [
    gameMode,
    currentBiome,
    timeOfDayLabel,
    weather,
    activeDungeon,
    shipHud?.atHelm,
    diveHud.isUnderwater,
    diveHud.isSwimming,
    player.isCrouching,
    sceneSignals.inCombat,
    sceneSignals.nearDragon,
    sceneSignals.nearSeal,
    sceneSignals.nearSettlementOrNpc,
    activeNpcId,
    activeModal,
  ]);

  // Auth & Firestore connection check
  useEffect(() => {
    void validateFirestoreConnection();
    const unsub = subscribeAuth((u) => setUser(u));
    return () => unsub();
  }, []);

  // Flush pending offline cloud sync when back online
  useEffect(() => {
    if (isOnline && user) {
      const pending = popPendingCloudSync();
      if (pending) {
        void saveGameToCloud(pending).then(() => {
          pushCombatLog('Offline progress synced to Cloud.', 'world');
        });
      }
    }
  }, [isOnline, user, pushCombatLog]);

  // Mount Three.js WorldEngine ONCE
  useEffect(() => {
    if (!canvasHostRef.current) return;
    const engine = new WorldEngine(
      canvasHostRef.current,
      {
        player,
        biomes,
        npcs,
        outposts,
        seals,
        tradeRoutes,
        season,
        weather,
        timeOfDayIndex,
        unlockedSkills,
        gameMode: 'title',
        graphicsPreset: accessibility.graphicsPreset,
      },
      {
        onCombatLog: pushCombatLog,
        onPlayerStatsUpdate: (patch) => setPlayer((prev) => ({ ...prev, ...patch })),
        onGainXpAndGold: gainXpAndGold,
        onHarvestItem: (itemId, qty, biomeId) => {
          addInventoryItem(itemId, qty);
          pushCombatLog(`Harvested ${qty}x ${ITEMS[itemId]?.name || itemId} in ${biomeId}.`, 'heal');
        },
        onEnemyDefeated: (kind, biomeId, enemyId) => {
          setQuests((prev) => advanceFrontierGuardian(prev, enemyId));
          if (enemyId.startsWith('guardian_')) {
            pushCombatLog('Frontier guardian defeated. Your Quest Journal now holds a new decision.', 'quest');
          }
          addInventoryItem('blight_ichor', 1);
          adjustBiomeHealth(biomeId, 6);
          const journalId = kind === 'wraith' ? 'journal_wraith' : kind === 'golem' ? 'journal_golem' : 'journal_stalker';
          setJournal((prev) => prev.map((j) => (j.id === journalId ? { ...j, discovered: true } : j)));
        },
        onBiomeDiscover: (biomeId) => {
          const map: Record<BiomeId, string> = {
            suncrest: 'journal_citadel',
            verdant: 'journal_grove',
            ember: 'journal_crag',
            aether: 'journal_spire',
          };
          const jId = map[biomeId];
          setJournal((prev) => prev.map((j) => (j.id === jId ? { ...j, discovered: true } : j)));
          pushCombatLog(`Entered ${INITIAL_BIOMES[biomeId].name} — Journal sketch recorded.`, 'world');
        },
        onPoiDiscover: (poiId, name) => {
          setQuests((prev) => advanceFrontierDiscovery(prev, poiId));
          if (poiId.startsWith('poi_isle_')) {
            pushCombatLog(`Discovered ${name}. A frontier story may now be available in your Quest Journal.`, 'quest');
          }
        },
        onInteractPrompt: (list) => setPrompts(list),
        onTriggerInteract: (target) => {
          if (target.kind === 'npc') setActiveNpcId(target.id);
          else if (target.kind === 'resource') engineRef.current?.harvestResourceNode(target.id);
          else if (target.kind === 'outpost') setActiveModal('outposts');
          else if (target.kind === 'seal') setActiveSealId(target.id);
          else if (target.kind === 'shipyard') setActiveModal('shipyard');
        },
        onHudTick: (info) => {
          setCurrentBiome(info.currentBiome);
          setTimeOfDayLabel(info.timeOfDay);
          setTimeOfDayIndex(info.timeOfDayIndex);
          setCameraYaw(info.cameraYaw);
          setMiniMapEntities(info.miniMapEntities);
          setCompassMarkers(info.compassMarkers);
          setActiveDungeon(info.activeDungeon);
          setTelemetry(info.telemetry);
          setShipHud(info.shipHud);
          setDiveHud(info.diveHud);
          setSceneSignals((prev) =>
            prev.inCombat === info.sceneMusicSignals.inCombat &&
            prev.nearDragon === info.sceneMusicSignals.nearDragon &&
            prev.nearSeal === info.sceneMusicSignals.nearSeal &&
            prev.nearSettlementOrNpc === info.sceneMusicSignals.nearSettlementOrNpc
              ? prev
              : info.sceneMusicSignals
          );
        },
      }
    );
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync discrete React state into WorldEngine without creating 150ms kinematics feedback loops
  useEffect(() => {
    engineRef.current?.syncExternalState({
      biomes,
      outposts,
      seals,
      tradeRoutes,
      season,
      weather,
      unlockedSkills,
      player: playerRef.current,
    });
  }, [
    biomes,
    outposts,
    seals,
    tradeRoutes,
    season,
    weather,
    unlockedSkills,
    player.companionId,
    player.equippedWeapon,
    player.equippedRelic,
    player.level,
    player.gold,
    player.moralAlignment,
    player.maxHp,
    player.maxMana,
    player.ownedShipType,
  ]);

  // Sync Game Shell mode to Three.js engine
  useEffect(() => {
    const engineMode = gameMode === 'title' ? 'title' : gameMode === 'playing' ? 'playing' : 'paused';
    engineRef.current?.setGameMode(engineMode);
  }, [gameMode]);

  // Game Clock & Autosave (day/night clock is driven smoothly at 60Hz inside WorldEngine)
  useEffect(() => {
    if (gameMode !== 'playing') return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    const autoWeather = window.setInterval(() => {
      setWeather((prev) => {
        const idx = (WEATHERS.indexOf(prev) + 1) % WEATHERS.length;
        return WEATHERS[idx];
      });
    }, 65000);

    const autoSave = window.setInterval(() => {
      saveLocalSlot(buildSnapshot());
    }, 12000);

    return () => {
      clearInterval(timer);
      clearInterval(autoWeather);
      clearInterval(autoSave);
    };
  }, [buildSnapshot, gameMode]);

  // Global Hotkeys for Title, Pause, HUD, Gesture & Voice
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (gameMode === 'title') {
        if (creatorMode) return;
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          soundEngine.initOnGesture();
          if (!player.appearance) {
            setCreatorMode('new');
            return;
          }
          soundEngine.triggerCue('quest', 'Chronicle Begun');
          setGameMode('playing');
        }
        return;
      }
      if (e.code === 'KeyH') setHudCollapsed((v) => !v);
      if (e.code === 'KeyG') setGestureOpen((v) => !v);
      if (e.code === 'KeyT') setVoiceOpen((v) => !v);
      if (e.code === 'KeyI') setActiveModal((m) => (m === 'inventory' ? null : 'inventory'));
      if (e.code === 'Escape') {
        const hasOpenOverlay = Boolean(activeModal || activeNpcId || activeSealId || gestureOpen || voiceOpen);
        if (hasOpenOverlay) {
          setActiveModal(null);
          setActiveNpcId(null);
          setActiveSealId(null);
          setGestureOpen(false);
          setVoiceOpen(false);
        } else if (gameMode === 'playing') {
          setGameMode('paused');
        } else if (gameMode === 'paused') {
          setGameMode('playing');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gameMode, activeModal, activeNpcId, activeSealId, gestureOpen, voiceOpen, creatorMode, player.appearance]);

  const kingdomHealth = useMemo(
    () => Math.round(Object.values(biomes).reduce((sum, b) => sum + b.health, 0) / 4),
    [biomes]
  );
  const sealsRestored = useMemo(() => seals.filter((s) => s.status !== 'corrupted').length, [seals]);

  useEffect(() => {
    if (sealsRestored >= 4 && !victoryDismissed && gameMode === 'playing') {
      setGameMode('victory');
    }
  }, [sealsRestored, victoryDismissed, gameMode]);

  // Gameplay Handlers
  const handleUseOrEquip = (itemId: string) => {
    const def = ITEMS[itemId];
    if (!def) return;
    if (def.category === 'consumable') {
      addInventoryItem(itemId, -1);
      setPlayer((prev) => {
        const next = {
          ...prev,
          hp: Math.min(prev.maxHp, prev.hp + (def.healHp || 0)),
          mana: Math.min(prev.maxMana, prev.mana + (def.healMana || 0)),
        };
        engineRef.current?.syncExternalState({ player: next });
        return next;
      });
      soundEngine.triggerCue('harvest', `Used ${def.name}`);
      pushCombatLog(`Used ${def.name}.`, 'heal');
    } else if (def.category === 'relic') {
      if (itemId === 'crown_amulet') {
        setPlayer((prev) => ({ ...prev, equippedRelic: itemId }));
      } else {
        setPlayer((prev) => ({ ...prev, equippedWeapon: itemId }));
      }
      pushCombatLog(`Equipped ${def.name}.`, 'quest');
    }
  };

  const handleCraftResult = (
    consumed: [string, string, string],
    resultId: string,
    resultQty: number,
    recipeId: string
  ) => {
    consumed.forEach((id) => addInventoryItem(id, -1));
    addInventoryItem(resultId, resultQty);
    if (!discoveredRecipes.includes(recipeId)) {
      setDiscoveredRecipes((prev) => [...prev, recipeId]);
    }
    soundEngine.triggerCue('craft', `Crafted ${ITEMS[resultId].name}`);
    gainXpAndGold(35, 0);
    pushCombatLog(`Crucible synthesized ${resultQty}x ${ITEMS[resultId].name}!`, 'quest');
  };

  const handleResolveQuestChoice = (questId: string, choice: QuestChoice) => {
    // Ignore duplicate resolutions or decisions made before finding the
    // actual objective. Unlock the finale only after all four island arcs.
    const eligible = quests.some((q) =>
      q.id === questId && q.status === 'active' && q.step >= 1 &&
      q.choices?.some((option) => option.id === choice.id)
    );
    if (!eligible) return;
    setQuests((prev) => unlockFrontierFinale(
      prev.map((q) =>
        q.id === questId && q.status === 'active'
          ? { ...q, status: 'completed' as const, step: q.maxSteps, chosenPath: choice.label }
          : q
      )
    ));
    setPlayer((prev) => ({
      ...prev,
      moralAlignment: Math.max(-100, Math.min(100, prev.moralAlignment + choice.moralDelta)),
    }));
    if (choice.biomeHealthDelta) {
      adjustBiomeHealth(choice.biomeHealthDelta.biomeId, choice.biomeHealthDelta.delta);
    }
    if (choice.repDelta) {
      setFactions((prev) => ({
        ...prev,
        [choice.repDelta!.factionId]: {
          ...prev[choice.repDelta!.factionId],
          reputation: Math.max(-100, Math.min(100, prev[choice.repDelta!.factionId].reputation + choice.repDelta!.delta)),
        },
      }));
    }
    gainXpAndGold(choice.rewardXp, choice.rewardGold);
    if (choice.rewardItemId && ITEMS[choice.rewardItemId]) {
      addInventoryItem(choice.rewardItemId, 1);
      pushCombatLog(`Recovered ${ITEMS[choice.rewardItemId].name} from the Sapphire Covenant.`, 'quest');
    }
    soundEngine.triggerCue('quest', 'Moral Choice Enacted');
    pushCombatLog(`${choice.consequenceText} (+${choice.rewardGold}g, +${choice.rewardXp} XP)`, 'quest');
  };

  const handleBuildOutpost = (outpostId: string) => {
    const op = outposts.find((o) => o.id === outpostId);
    if (!op || op.level >= 2) return;
    const mult = op.level + 1;
    const canAfford = op.requiredMaterials.every(
      (req) => (inventory.find((i) => i.id === req.itemId)?.qty || 0) >= req.qty * mult
    );
    if (!canAfford) return;

    op.requiredMaterials.forEach((req) => addInventoryItem(req.itemId, -(req.qty * mult)));
    setOutposts((prev) => prev.map((o) => (o.id === outpostId ? { ...o, level: o.level + 1 } : o)));
    adjustBiomeHealth(op.biomeId, op.biomeBonus);
    gainXpAndGold(95, 30);
    soundEngine.triggerCue('craft', `Rebuilt ${op.name}`);
    pushCombatLog(`Reconstructed ${op.name} to Tier ${op.level + 1}! Biome health and merchant stock expanded.`, 'quest');
  };

  const handleSabotageRoute = (routeId: string) => {
    const rt = tradeRoutes.find((r) => r.id === routeId);
    if (!rt || rt.sabotaged) return;
    setTradeRoutes((prev) => prev.map((r) => (r.id === routeId ? { ...r, sabotaged: true, health: 28 } : r)));
    setFactions((prev) => ({
      ...prev,
      [rt.factionId]: {
        ...prev[rt.factionId],
        reputation: Math.max(-100, prev[rt.factionId].reputation - 18),
        corruptInfluence: Math.max(0, prev[rt.factionId].corruptInfluence - 28),
      },
    }));
    gainXpAndGold(60, 75);
    pushCombatLog(`Sabotaged ${rt.name}! Hostile influence fell (-28%) and you seized 75 Gold.`, 'world');
  };

  const handleRestoreRoute = (routeId: string) => {
    const rt = tradeRoutes.find((r) => r.id === routeId);
    if (!rt || !rt.sabotaged) return;
    setTradeRoutes((prev) => prev.map((r) => (r.id === routeId ? { ...r, sabotaged: false, health: 90 } : r)));
    setFactions((prev) => ({
      ...prev,
      [rt.factionId]: {
        ...prev[rt.factionId],
        reputation: Math.min(100, prev[rt.factionId].reputation + 15),
      },
    }));
    pushCombatLog(`Restored ${rt.name}! Caravan traffic resumed.`, 'heal');
  };

  const handleInfluenceNpc = (npcId: string) => {
    if (player.gold < 35) return;
    setPlayer((prev) => ({ ...prev, gold: prev.gold - 35 }));
    const target = npcs.find((n) => n.id === npcId);
    setNpcs((prev) =>
      prev.map((n) => (n.id === npcId ? { ...n, relationshipScore: Math.min(100, n.relationshipScore + 20), mood: 'Allied' } : n))
    );
    if (target) {
      adjustBiomeHealth(target.homeBiome, 5);
      pushCombatLog(`Granted favor to ${target.name}. Trust & ${target.homeBiome} stability rose!`, 'quest');
    }
  };

  const handleNpcOption = (npc: NpcState, opt: NpcDialogueOption): string => {
    if (opt.favorCostGold && player.gold < opt.favorCostGold) {
      return `You need ${opt.favorCostGold} Gold to fund this favor.`;
    }
    if (opt.favorCostGold) {
      setPlayer((prev) => ({ ...prev, gold: prev.gold - opt.favorCostGold! }));
    }
    if (opt.moralDelta) {
      setPlayer((prev) => ({
        ...prev,
        moralAlignment: Math.max(-100, Math.min(100, prev.moralAlignment + opt.moralDelta!)),
      }));
      if (opt.id === 'marcus_pact') {
        setPlayer((prev) => ({ ...prev, gold: prev.gold + 60 }));
      }
    }
    if (opt.repDelta) {
      setFactions((prev) => ({
        ...prev,
        [opt.repDelta!.factionId]: {
          ...prev[opt.repDelta!.factionId],
          reputation: Math.max(-100, Math.min(100, prev[opt.repDelta!.factionId].reputation + opt.repDelta!.delta)),
        },
      }));
    }
    if (opt.recruitable) {
      setPlayer((prev) => ({ ...prev, companionId: npc.id }));
      pushCombatLog(`${npc.name} joined as your active combat companion!`, 'quest');
    }
    if (opt.questAdvance) {
      setQuests((prev) =>
        prev.map((q) =>
          q.id === opt.questAdvance!.questId
            ? { ...q, status: 'active', step: Math.max(q.step, opt.questAdvance!.step) }
            : q
        )
      );
    }
    return opt.response;
  };

  const handleBuyItem = (npcId: string, itemId: string, price: number) => {
    if (player.gold < price) return;
    setPlayer((prev) => ({ ...prev, gold: prev.gold - price }));
    addInventoryItem(itemId, 1);
    setNpcs((prev) =>
      prev.map((n) =>
        n.id === npcId
          ? {
              ...n,
              inventory: n.inventory.map((it) => (it.id === itemId ? { ...it, qty: Math.max(0, it.qty - 1) } : it)),
            }
          : n
      )
    );
    soundEngine.triggerCue('harvest', `Purchased ${ITEMS[itemId]?.name}`);
    pushCombatLog(`Purchased ${ITEMS[itemId]?.name} for ${price} Gold.`, 'world');
  };

  const handleSealAction = (sealId: string, mode: 'purify' | 'drain') => {
    const seal = seals.find((s) => s.id === sealId);
    if (!seal || seal.status !== 'corrupted') return;
    const nextStatus = mode === 'purify' ? 'purified' : 'drained';
    setSeals((prev) => prev.map((s) => (s.id === sealId ? { ...s, status: nextStatus } : s)));

    if (mode === 'purify') {
      adjustBiomeHealth(seal.biomeId, 24);
      setPlayer((prev) => ({ ...prev, moralAlignment: Math.min(100, prev.moralAlignment + 25) }));
      gainXpAndGold(140, 60);
      pushCombatLog(`Purified ${seal.name}! ${biomes[seal.biomeId].name} blooms with Light (+24% Health).`, 'quest');
    } else {
      adjustBiomeHealth(seal.biomeId, -8);
      setPlayer((prev) => ({
        ...prev,
        moralAlignment: Math.max(-100, prev.moralAlignment - 25),
        maxMana: prev.maxMana + 15,
        mana: prev.maxMana + 15,
      }));
      gainXpAndGold(140, 120);
      pushCombatLog(`Drained ${seal.name} for Shadow Dominion! (+15 Max Mana, +120g, -8% Biome Health)`, 'warning');
    }

    // Advance main prophecy quest step
    const newAwakenedCount = seals.filter((s) => s.status !== 'corrupted' || s.id === sealId).length;
    setQuests((prev) =>
      prev.map((q) =>
        q.id === 'quest_prophecy'
          ? {
              ...q,
              step: newAwakenedCount,
              status: newAwakenedCount >= 4 ? 'completed' : 'active',
              chosenPath: newAwakenedCount >= 4 ? (player.moralAlignment >= 0 ? 'Crown of Light Restored' : 'Dominion of Ash Claimed') : q.chosenPath,
            }
          : q
      )
    );
    soundEngine.triggerCue('seal', `${seal.name} Awakened`);
    setActiveSealId(null);
  };

  const handleUnlockSkill = (skillId: string) => {
    if (unlockedSkills.includes(skillId)) return;
    setUnlockedSkills((prev) => [...prev, skillId]);
    if (skillId === 'warden_bastion') {
      setPlayer((prev) => ({ ...prev, maxHp: prev.maxHp + 30, hp: prev.hp + 30 }));
    }
    soundEngine.triggerCue('quest', 'Skill Mastery Unlocked');
    const sk = INITIAL_SKILLS.find((s) => s.id === skillId);
    pushCombatLog(`Unlocked skill: ${sk?.name} (${sk?.effect}).`, 'quest');
  };

  const handleCapturePhoto = () => {
    if (!engineRef.current) return;
    const dataUrl = engineRef.current.captureSnapshot();
    const activeQuest = quests.find((q) => q.status === 'active') || quests[0];
    const moralPath: PhotoSnapshot['moralPath'] =
      player.moralAlignment >= 18 ? 'Light' : player.moralAlignment <= -18 ? 'Shadow' : 'Balanced';
    const snap: PhotoSnapshot = {
      id: `photo_${Date.now()}`,
      dataUrl,
      timestamp: new Date().toLocaleTimeString(),
      coords: { x: Math.round(player.x), y: Math.round(player.y), z: Math.round(player.z) },
      biomeName: biomes[currentBiome].name,
      biomeHealth: Math.round(biomes[currentBiome].health),
      kingdomHealth,
      season,
      weather,
      activeQuestTitle: activeQuest.title,
      moralPath,
    };
    const next = savePhotoSnapshot(snap);
    setPhotos(next);
    pushCombatLog(`Panorama saved with coordinates (${snap.coords.x}, ${snap.coords.z}) & quest state!`, 'world');
    setActiveModal('photos');
  };

  const handleVoiceCommand = (raw: string): string => {
    const cmd = raw.toLowerCase();
    if (cmd.includes('flank')) {
      engineRef.current?.commandCompanion('flank');
      return 'Ordered companion to execute flanking maneuver!';
    }
    if (cmd.includes('heal')) {
      engineRef.current?.commandCompanion('heal');
      return 'Companion administered field healing!';
    }
    if (cmd.includes('fire') || cmd.includes('ember')) {
      engineRef.current?.castElementalSpell('fire');
      return 'Cast Ember Nova!';
    }
    if (cmd.includes('lightning') || cmd.includes('storm') || cmd.includes('tempest')) {
      engineRef.current?.castElementalSpell('lightning');
      return 'Cast Tempest Arc!';
    }
    if (cmd.includes('frost') || cmd.includes('ice')) {
      engineRef.current?.castElementalSpell('frost');
      return 'Cast Glacial Surge!';
    }
    if (cmd.includes('gale') || cmd.includes('wind') || cmd.includes('leap')) {
      engineRef.current?.castElementalSpell('gale');
      return 'Cast Zephyr Leap!';
    }
    if (cmd.includes('peace') || cmd.includes('negotiate')) {
      setFactions((prev) => ({
        ...prev,
        suncrest_order: { ...prev.suncrest_order, reputation: Math.min(100, prev.suncrest_order.reputation + 8) },
      }));
      setPlayer((prev) => ({ ...prev, moralAlignment: Math.min(100, prev.moralAlignment + 6) }));
      pushCombatLog('Spoken peace accord improved Suncrest Order standing (+8 Rep, +Light).', 'quest');
      return 'Negotiated diplomatic truce (+8 Suncrest Rep).';
    }
    if (cmd.includes('discount') || cmd.includes('trade')) {
      setFactions((prev) => ({
        ...prev,
        ironbound_guild: { ...prev.ironbound_guild, reputation: Math.min(100, prev.ironbound_guild.reputation + 6) },
      }));
      pushCombatLog('Barbered trade terms with nearby merchants (+6 Ironbound Rep).', 'world');
      return 'Secured favorable merchant terms (+6 Ironbound Rep).';
    }
    return `Heard "${raw}". Try "Flank", "Heal", "Cast Fire", "Negotiate Peace", or "Demand Discount".`;
  };

  const handleGestureCommand = (cmdId: string) => {
    if (cmdId === 'melee') engineRef.current?.performMeleeAttack();
    else if (cmdId === 'fire' || cmdId === 'lightning' || cmdId === 'frost' || cmdId === 'gale') {
      engineRef.current?.castElementalSpell(cmdId);
    } else if (cmdId === 'companion_flank') engineRef.current?.commandCompanion('flank');
    else if (cmdId === 'companion_heal') engineRef.current?.commandCompanion('heal');
    else if (cmdId === 'use_elixir') handleUseOrEquip('vitality_elixir');
  };

  const handleShareProgress = async () => {
    const moralPath = player.moralAlignment >= 18 ? 'Light' : player.moralAlignment <= -18 ? 'Shadow' : 'Balanced';
    const summary = `Aethelgard: Prophecy of the Four Seals — Level ${player.level} Warden · Kingdom Health ${kingdomHealth}% · Seals Awakened ${sealsRestored}/4 · ${moralPath} Path`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Aethelgard Restoration Chronicle', text: summary });
        return;
      } catch {
        // Fallback to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(summary);
    } catch {
      // Ignore
    }
  };

  const activeNpc = npcs.find((n) => n.id === activeNpcId) || null;
  const activeSeal = seals.find((s) => s.id === activeSealId) || null;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#090d16]">
      {/* Screen Reader Live Region */}
      {accessibility.screenReaderAnnouncements && (
        <div className="sr-only" aria-live="polite">
          {srAnnouncement}
        </div>
      )}

      {/* Isolated 3D WebGL Viewport */}
      <div ref={canvasHostRef} className="fixed inset-0 w-full h-full z-0" aria-label="3D Open World Fantasy Viewport" />

      {/* Cinematic Live-World Title Screen */}
      {gameMode === 'title' && (
        <div className="fixed inset-0 z-30 flex flex-col items-center justify-between py-12 px-6 bg-gradient-to-b from-slate-950/35 via-transparent to-slate-950/50 pointer-events-none">
          <div className="flex flex-col items-center text-center mt-6 pointer-events-auto">
            <svg viewBox="0 0 120 72" className="w-24 h-14 mb-3 drop-shadow-lg" aria-hidden="true">
              <circle cx="60" cy="36" r="24" fill="none" stroke="#fbbf24" strokeWidth="1.8" strokeOpacity="0.85" />
              <polygon points="60,6 70,26 94,36 70,46 60,66 50,46 26,36 50,26" fill="none" stroke="#fde68a" strokeWidth="1.6" />
              <circle cx="60" cy="14" r="3" fill="#f97316" />
              <circle cx="84" cy="36" r="3" fill="#38bdf8" />
              <circle cx="60" cy="58" r="3" fill="#10b981" />
              <circle cx="36" cy="36" r="3" fill="#fbbf24" />
            </svg>
            <h1 className="font-display text-4xl sm:text-5xl font-bold text-amber-200 tracking-wider drop-shadow-[0_4px_24px_rgba(0,0,0,0.85)]">
              AETHELGARD
            </h1>
            <p className="text-xs sm:text-sm uppercase tracking-[0.28em] text-amber-100/80 mt-2">
              Prophecy of the Four Seals
            </p>
          </div>

          <div className="flex flex-col items-center gap-4 mb-4 pointer-events-auto">
            <button
              type="button"
              onClick={() => {
                soundEngine.initOnGesture();
                if (!player.appearance) {
                  setCreatorMode('new');
                  return;
                }
                soundEngine.triggerCue('quest', 'Chronicle Begun');
                setGameMode('playing');
              }}
              className="px-8 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm tracking-wide shadow-[0_0_30px_rgba(245,158,11,0.45)] flex items-center gap-2.5 transition-transform hover:scale-105"
            >
              <Play className="w-4 h-4 fill-slate-950" />
              {!player.appearance ? 'Create Your Hero [Enter]' : initialSave ? `Continue as ${player.appearance.name} [Enter]` : 'Enter Aethelgard [Enter]'}
            </button>
            <div className="text-xs text-slate-200/90 bg-slate-950/75 border border-white/15 px-4 py-1.5 rounded-lg">
              WASD Move · Shift Sprint · C Crouch/Dive · Drag/DblClick Look · 1–4 Elements · J Strike · B Block · V Dodge · F Anchor · E Helm/Interact
            </div>
          </div>

          <div className="fixed bottom-4 right-4 pointer-events-auto flex items-center gap-2 hud-panel rounded-xl px-3 py-2 text-xs shadow-lg">
            <Music className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span className="text-slate-200 max-w-[165px] truncate">{musicState.currentTrack.title}</span>
            <button
              type="button"
              onClick={() => soundEngine.toggleMusicPlay()}
              aria-label={musicState.isPlaying ? 'Pause music' : 'Play music'}
              className="p-1 rounded hover:bg-white/10 text-amber-300"
            >
              {musicState.isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => soundEngine.nextTrack()}
              aria-label="Next track"
              className="p-1 rounded hover:bg-white/10 text-slate-300"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Top-Center Skyrim-style Horizon Compass Bar */}
      {gameMode === 'playing' && !hudCollapsed && (
        <HorizonCompassBar
          cameraYaw={cameraYaw}
          playerX={player.x}
          playerZ={player.z}
          markers={compassMarkers}
          currentLocationLabel={activeDungeon ? activeDungeon.name : biomes[currentBiome].name}
        />
      )}

      {/* Contextual World-Space Projected Interaction Prompts */}
      {gameMode === 'playing' &&
        !hudCollapsed &&
        prompts.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              if (p.kind === 'npc') setActiveNpcId(p.id);
              else if (p.kind === 'resource') engineRef.current?.harvestResourceNode(p.id);
              else if (p.kind === 'outpost') setActiveModal('outposts');
              else if (p.kind === 'seal') setActiveSealId(p.id);
              else if (p.kind === 'dungeon_enter') engineRef.current?.enterDungeon(p.id);
              else if (p.kind === 'dungeon_exit') engineRef.current?.exitDungeon();
              else if (p.kind === 'chest') engineRef.current?.lootDungeonChest(p.id);
              else if (p.kind === 'salvage') engineRef.current?.lootSeaWreck(p.id);
              else if (p.kind === 'shipyard') setActiveModal('shipyard');
            }}
            style={{
              left: `${Math.min(window.innerWidth - 150, Math.max(20, p.screenX))}px`,
              top: `${Math.min(window.innerHeight - 90, Math.max(60, p.screenY))}px`,
              borderColor: p.color,
            }}
            className="fixed z-10 -translate-x-1/2 -translate-y-full px-2.5 py-1 rounded-md hud-panel text-xs font-medium shadow-lg hover:scale-105 transition-transform whitespace-nowrap"
          >
            <span style={{ color: p.color }} className="font-semibold">
              {p.label}
            </span>{' '}
            <span className="text-slate-300">· {p.actionHint}</span>
          </button>
        ))}

      {/* Top-Left Player Vitals & Biome Header */}
      {gameMode !== 'title' && !hudCollapsed && (
        <aside className="fixed top-4 left-4 z-20 w-72 rounded-xl hud-panel p-3.5 shadow-xl space-y-2.5">
          <div className="flex items-center justify-between">
            <h1 className="font-display text-sm font-bold text-amber-300 tracking-wide">Aethelgard</h1>
            <span className="font-mono-tabular text-xs text-slate-300">
              Lv.{player.level} · {player.gold}g
            </span>
          </div>

          {/* HP / Mana / Stamina Bars */}
          <div className="space-y-1.5 text-[11px] font-mono-tabular">
            <div>
              <div className="flex justify-between text-slate-300">
                <span>Health</span>
                <span>
                  {Math.round(player.hp)}/{player.maxHp}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden mt-0.5">
                <div className="h-full bg-red-500" style={{ width: `${(player.hp / player.maxHp) * 100}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-slate-300">
                <span>Mana</span>
                <span>
                  {Math.round(player.mana)}/{player.maxMana}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden mt-0.5">
                <div className="h-full bg-sky-400" style={{ width: `${(player.mana / player.maxMana) * 100}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-slate-300">
                <span>{player.isClimbing ? 'Stamina (Climbing)' : 'Stamina'}</span>
                <span>
                  {Math.round(player.stamina)}/{player.maxStamina}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden mt-0.5">
                <div className="h-full bg-emerald-400" style={{ width: `${(player.stamina / player.maxStamina) * 100}%` }} />
              </div>
            </div>
          </div>

          <div className="pt-1.5 border-t border-white/10 text-xs text-slate-300 space-y-0.5">
            <div className="flex justify-between">
              <span className="font-semibold text-white">
                {activeDungeon ? activeDungeon.name : biomes[currentBiome].name}
              </span>
              <span className="font-mono-tabular text-emerald-400">
                {activeDungeon
                  ? activeDungeon.cleared
                    ? 'Cleared'
                    : 'Subterranean'
                  : `${Math.round(biomes[currentBiome].health)}% Healthy`}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center justify-between gap-2">
              <span>
                {season} · {timeOfDayLabel} · {weather}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const cycle = [0.26, 0.5, 0.72, 0.85];
                    const nextIdx = cycle.find((v) => v > timeOfDayIndex + 0.04) ?? cycle[0];
                    setTimeOfDayIndex(nextIdx);
                    engineRef.current?.setTimeOfDayIndex(nextIdx);
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300"
                  title="Cycle Dawn / Day / Dusk / Night"
                >
                  Time
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = WEATHERS[(WEATHERS.indexOf(weather) + 1) % WEATHERS.length];
                    setWeather(next);
                    pushCombatLog(`Weather shifted to ${next}.`, 'world');
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300"
                  title="Cycle Weather Shader"
                >
                  Sky
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Top-Right Compact Navigation & Quest Summary */}
      {gameMode !== 'title' && (
      <div className="fixed top-4 right-4 z-20 flex flex-col items-end gap-2">
        <div className="flex flex-wrap items-center justify-end gap-1.5 hud-panel rounded-xl p-1.5 shadow-xl">
          {!hudCollapsed && (
            <>
              <button
                type="button"
                onClick={() => setActiveModal('inventory')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-xs font-medium whitespace-nowrap"
              >
                <Backpack className="w-3.5 h-3.5 text-amber-300" />
                Inventory
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('craft')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-xs font-medium whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                Craft
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('quests')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-xs font-medium whitespace-nowrap"
              >
                <BookOpen className="w-3.5 h-3.5 text-amber-300" />
                Quests
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('factions')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-xs font-medium whitespace-nowrap"
              >
                <Shield className="w-3.5 h-3.5 text-amber-300" />
                Realm
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('atlas')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-xs font-medium whitespace-nowrap"
              >
                <Globe className="w-3.5 h-3.5 text-emerald-300" />
                Atlas
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('shipyard')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-xs font-medium whitespace-nowrap"
              >
                <Ship className="w-3.5 h-3.5 text-sky-300" />
                Fleet
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('skills')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-xs font-medium whitespace-nowrap"
              >
                <Compass className="w-3.5 h-3.5 text-amber-300" />
                Skills
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('leaderboard')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-xs font-medium whitespace-nowrap"
              >
                <Trophy className="w-3.5 h-3.5 text-amber-300" />
                Ranks
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('music')}
                aria-label="Bardic Soundtrack Studio"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-xs font-medium whitespace-nowrap"
              >
                <Music className="w-3.5 h-3.5 text-amber-300" />
                Score
              </button>
              <button
                type="button"
                onClick={handleCapturePhoto}
                aria-label="Take Photo"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-xs font-medium whitespace-nowrap"
              >
                <Camera className="w-3.5 h-3.5 text-amber-300" />
                Photo
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('cloud')}
                aria-label="Cloud Sync"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-xs font-medium whitespace-nowrap"
              >
                <Cloud className="w-3.5 h-3.5 text-sky-300" />
                Sync
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('settings')}
                aria-label="Accessibility and Settings"
                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300"
              >
                <Settings className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setHudCollapsed((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-amber-300 whitespace-nowrap"
          >
            {hudCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {hudCollapsed ? 'Show HUD [H]' : 'Zen [H]'}
          </button>
        </div>

        {/* Real-Time Top-Right Mini-Map */}
        {!hudCollapsed && (
          <MiniMap
            playerX={player.x}
            playerZ={player.z}
            cameraYaw={cameraYaw}
            entities={miniMapEntities}
            activeDungeon={activeDungeon}
            biomes={biomes}
            currentBiome={currentBiome}
            onOpenAtlas={() => setActiveModal('atlas')}
          />
        )}

        {/* Compact Now-Playing Soundtrack Bar */}
        {!hudCollapsed && (
          <div className="hud-panel rounded-lg px-2.5 py-1.5 text-[11px] flex items-center gap-1.5 shadow-lg w-[216px]">
            <button
              type="button"
              onClick={() => setActiveModal('music')}
              className="flex items-center gap-1.5 min-w-0 text-left hover:text-amber-200 transition-colors"
              title={`Scene: ${musicState.sceneLabel} — Click to open Soundtrack Studio`}
            >
              <Music className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <div className="min-w-0">
                <div className="truncate text-slate-200 font-medium leading-tight">{musicState.currentTrack.title}</div>
                <div className="truncate text-[9px] text-amber-300/80 leading-tight">{musicState.sceneLabel}</div>
              </div>
            </button>
            <div className="flex items-center gap-0.5 shrink-0 ml-auto">
              <button
                type="button"
                onClick={() => soundEngine.prevTrack()}
                aria-label="Previous soundtrack track"
                className="p-1 rounded hover:bg-white/10 text-slate-300"
              >
                <SkipBack className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => soundEngine.toggleMusicPlay()}
                aria-label={musicState.isPlaying ? 'Pause music' : 'Play music'}
                className="p-1 rounded hover:bg-white/10 text-amber-300"
              >
                {musicState.isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              </button>
              <button
                type="button"
                onClick={() => soundEngine.nextTrack()}
                aria-label="Next soundtrack track"
                className="p-1 rounded hover:bg-white/10 text-slate-300"
              >
                <SkipForward className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => soundEngine.toggleMute()}
                aria-label={musicState.isMuted ? 'Unmute music' : 'Mute music'}
                className="p-1 rounded hover:bg-white/10 text-slate-300"
              >
                {musicState.isMuted ? <VolumeX className="w-3 h-3 text-red-400" /> : <Volume2 className="w-3 h-3 text-slate-300" />}
              </button>
            </div>
          </div>
        )}

        {/* Optional Graphics Performance HUD */}
        {!hudCollapsed && accessibility.showPerfHud && telemetry && (
          <div className="hud-panel rounded-lg px-2.5 py-1.5 text-[11px] font-mono-tabular text-slate-200 flex items-center gap-2.5 shadow-lg">
            <span className={telemetry.frameTimeMs <= 18 ? 'text-emerald-400 font-semibold' : telemetry.frameTimeMs <= 26 ? 'text-amber-300 font-semibold' : 'text-red-400 font-semibold'}>
              {telemetry.fps} FPS ({telemetry.frameTimeMs}ms)
            </span>
            <span className="text-slate-400">· {telemetry.drawCalls} calls</span>
            <span className="text-slate-400">· {(telemetry.triangles / 1000).toFixed(0)}k tris</span>
            <span className="uppercase text-sky-300 font-semibold">{telemetry.resolvedTier}</span>
          </div>
        )}

        {/* Visual Sound-Cue Accessibility Indicator */}
        {!hudCollapsed && accessibility.visualSoundCues && visualCue && (
          <div className="hud-panel rounded-lg px-3 py-1.5 text-xs flex items-center gap-2 shadow-lg">
            <Volume2 className="w-3.5 h-3.5" style={{ color: visualCue.color }} />
            <span className="font-semibold" style={{ color: visualCue.color }}>
              {visualCue.label}
            </span>
            <span className="text-slate-400">· {visualCue.pattern}</span>
          </div>
        )}

        {!isOnline && (
          <div className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white flex items-center gap-1.5 shadow-lg">
            <WifiOff className="w-3.5 h-3.5" />
            Offline Mode — Progress Saved Locally
          </div>
        )}
      </div>
      )}

      {/* Bottom-Left Screen-Space Combat Log */}
      {gameMode !== 'title' && !hudCollapsed && (
        <div className="fixed bottom-24 md:bottom-5 left-4 z-20 w-80 max-w-[90vw] hud-panel rounded-xl p-3 shadow-xl space-y-1.5 pointer-events-none">
          <div className="text-[11px] font-semibold text-slate-400 flex items-center justify-between">
            <span>Combat & World Log</span>
            <span>Seals {sealsRestored}/4</span>
          </div>
          <div className="space-y-1 max-h-28 overflow-hidden">
            {combatLog.slice(0, 4).map((entry) => {
              const toneClass =
                entry.tone === 'combo'
                  ? 'text-amber-300 font-semibold'
                  : entry.tone === 'heal'
                    ? 'text-emerald-300'
                    : entry.tone === 'warning'
                      ? 'text-red-300'
                      : entry.tone === 'quest'
                        ? 'text-sky-300'
                        : 'text-slate-200';
              return (
                <div key={entry.id} className={`text-[11px] leading-snug ${toneClass}`}>
                  <span className="font-mono-tabular text-slate-500 mr-1.5">{entry.timestamp}</span>
                  {entry.text}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom-Right Naval Helm & Diving Oxygen Status Overlays */}
      {gameMode === 'playing' && !hudCollapsed && (shipHud || diveHud.isUnderwater || diveHud.oxygen < diveHud.maxOxygen) && (
        <div className="fixed bottom-24 md:bottom-5 right-4 z-20 w-72 space-y-2">
          {(diveHud.isUnderwater || diveHud.oxygen < diveHud.maxOxygen) && (
            <div className="hud-panel rounded-xl p-3 shadow-xl space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-cyan-300">
                  <Waves className="w-3.5 h-3.5" />
                  {diveHud.isUnderwater ? `Diving (${diveHud.depthMeters}m)` : 'Breath Recovering'}
                </span>
                <span className="font-mono-tabular text-slate-200">
                  {diveHud.oxygen}/{diveHud.maxOxygen}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className={`h-full transition-all ${diveHud.oxygen < 25 ? 'bg-red-500' : 'bg-cyan-400'}`}
                  style={{ width: `${(diveHud.oxygen / Math.max(1, diveHud.maxOxygen)) * 100}%` }}
                />
              </div>
            </div>
          )}

          {shipHud && (
            <div className="hud-panel rounded-xl p-3 shadow-xl space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-sky-300">
                  <Ship className="w-3.5 h-3.5" />
                  {shipHud.shipName}
                </span>
                <span className="font-mono-tabular text-slate-300">
                  {shipHud.speedKnots} kn · Wind {shipHud.windKnots} kn
                </span>
              </div>
              <div className="space-y-1 text-[11px] font-mono-tabular">
                <div className="flex justify-between text-slate-300">
                  <span>Hull Integrity</span>
                  <span>
                    {shipHud.hull}/{shipHud.maxHull}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-amber-400"
                    style={{ width: `${(shipHud.hull / Math.max(1, shipHud.maxHull)) * 100}%` }}
                  />
                </div>
              </div>
              {shipHud.atHelm && (
                <div className="flex items-center justify-between gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => engineRef.current?.toggleShipAnchor()}
                    className="flex-1 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-sky-200 flex items-center justify-center gap-1"
                  >
                    <Anchor className="w-3 h-3" />
                    {shipHud.anchored ? 'Weigh [F]' : 'Anchor [F]'}
                  </button>
                  <button
                    type="button"
                    disabled={shipHud.cannonCooldown > 0}
                    onClick={() => engineRef.current?.fireBroadsideCannons()}
                    className="flex-1 py-1.5 px-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-[11px] font-semibold text-slate-950"
                  >
                    {shipHud.cannonCooldown > 0 ? `Reload ${shipHud.cannonCooldown}s` : 'Broadside [Space]'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bottom-Center Unified Action Dock */}
      {gameMode !== 'title' && !hudCollapsed && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 hud-panel rounded-xl px-3 py-2 shadow-2xl flex items-center gap-1.5 max-w-[96vw] overflow-x-auto">
          <button
            type="button"
            onClick={() => engineRef.current?.performMeleeAttack()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold whitespace-nowrap shrink-0"
          >
            {(() => {
              const hc = player.appearance?.heroClass ?? 'warden';
              const Icon = hc === 'ranger' ? Crosshair : hc === 'mage' ? WandSparkles : hc === 'rogue' ? Sword : Swords;
              const label = hc === 'ranger' ? 'Shoot' : hc === 'mage' ? 'Arcane Bolt' : hc === 'rogue' ? 'Stab' : 'Slash';
              return (
                <>
                  <Icon className="w-3.5 h-3.5 text-slate-200" />
                  {label} [J]
                  {player.cooldowns.melee > 0.05 && <span className="font-mono-tabular text-slate-400">{player.cooldowns.melee.toFixed(1)}s</span>}
                </>
              );
            })()}
          </button>
          <button
            type="button"
            onClick={() => engineRef.current?.castElementalSpell('fire')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold whitespace-nowrap shrink-0"
          >
            <Flame className="w-3.5 h-3.5 text-orange-400" />
            Fireball [1]
            {player.cooldowns.fire > 0 && <span className="font-mono-tabular text-slate-400">{player.cooldowns.fire.toFixed(1)}s</span>}
          </button>
          <button
            type="button"
            onClick={() => engineRef.current?.castElementalSpell('lightning')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold whitespace-nowrap shrink-0"
          >
            <Zap className="w-3.5 h-3.5 text-sky-400" />
            Lightning [2]
            {player.cooldowns.lightning > 0 && <span className="font-mono-tabular text-slate-400">{player.cooldowns.lightning.toFixed(1)}s</span>}
          </button>
          <button
            type="button"
            onClick={() => engineRef.current?.castElementalSpell('frost')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold whitespace-nowrap shrink-0"
          >
            <Snowflake className="w-3.5 h-3.5 text-cyan-300" />
            Frost Cone [3]
            {player.cooldowns.frost > 0 && <span className="font-mono-tabular text-slate-400">{player.cooldowns.frost.toFixed(1)}s</span>}
          </button>
          <button
            type="button"
            onClick={() => engineRef.current?.castElementalSpell('gale')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold whitespace-nowrap shrink-0"
          >
            <Wind className="w-3.5 h-3.5 text-emerald-400" />
            Gale Burst [4]
            {player.cooldowns.gale > 0 && <span className="font-mono-tabular text-slate-400">{player.cooldowns.gale.toFixed(1)}s</span>}
          </button>
          <button
            type="button"
            onClick={() => setGestureOpen(true)}
            className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold whitespace-nowrap shrink-0"
          >
            Wheel [G]
          </button>
          <button
            type="button"
            onClick={() => setVoiceOpen(true)}
            aria-label="Open voice command overlay"
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-amber-300 whitespace-nowrap shrink-0"
          >
            <Mic className="w-3.5 h-3.5" />
            Voice [T]
          </button>
          <button
            type="button"
            onClick={() => setActiveModal('outposts')}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 whitespace-nowrap shrink-0"
          >
            <Hammer className="w-3.5 h-3.5 text-amber-300" />
            Build
          </button>
        </div>
      )}

      {/* Elemental Seal Shrine Modal */}
      {activeSeal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
          role="dialog"
          aria-label={activeSeal.name}
        >
          <div className="w-full max-w-md rounded-xl hud-modal p-6 space-y-4 shadow-2xl">
            <h2 className="font-display text-xl font-bold text-amber-300">{activeSeal.name}</h2>
            <p className="text-sm text-slate-200 leading-relaxed">
              {activeSeal.status === 'corrupted'
                ? `This ancient ${activeSeal.element} anchor pulses with unstable blight. Decide how you will fulfill the Grand Prophecy here:`
                : `This Seal has already been ${activeSeal.status}. Its resonance echoes across ${biomes[activeSeal.biomeId].name}.`}
            </p>
            {activeSeal.status === 'corrupted' && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => handleSealAction(activeSeal.id, 'purify')}
                  className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold"
                >
                  Purify Seal (+24% Biome Health, +Light Alignment)
                </button>
                <button
                  type="button"
                  onClick={() => handleSealAction(activeSeal.id, 'drain')}
                  className="w-full py-2.5 px-4 rounded-lg bg-red-800 hover:bg-red-700 text-white text-sm font-semibold"
                >
                  Drain Seal Power (+15 Max Mana, +120g, -8% Biome Health)
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setActiveSealId(null)}
              className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Modals & Overlays */}
      <InventoryCraftingModal
        open={activeModal === 'inventory' || activeModal === 'craft'}
        initialTab={activeModal === 'craft' ? 'craft' : 'inventory'}
        inventory={inventory}
        discoveredRecipes={discoveredRecipes}
        equippedWeapon={player.equippedWeapon}
        equippedRelic={player.equippedRelic}
        gold={player.gold}
        onClose={() => setActiveModal(null)}
        onUseOrEquip={handleUseOrEquip}
        onCraftResult={handleCraftResult}
      />

      <QuestJournalModal
        open={activeModal === 'quests' || activeModal === 'journal'}
        initialTab={activeModal === 'journal' ? 'journal' : 'quests'}
        quests={quests}
        journal={journal}
        moralAlignment={player.moralAlignment}
        sealsRestored={sealsRestored}
        biomeName={biomes[currentBiome].name}
        season={season}
        weather={weather}
        onClose={() => setActiveModal(null)}
        onResolveChoice={handleResolveQuestChoice}
      />

      <SoundtrackModal
        open={activeModal === 'music'}
        currentBiome={currentBiome}
        biomeName={biomes[currentBiome].name}
        biomeHealth={biomes[currentBiome].health}
        season={season}
        weather={weather}
        photos={photos}
        onClose={() => setActiveModal(null)}
      />

      <RealmMapModal
        open={activeModal === 'atlas'}
        biomes={biomes}
        playerX={player.x}
        playerZ={player.z}
        onClose={() => setActiveModal(null)}
        onFastTravel={(x, z, label) => {
          engineRef.current?.teleportPlayer(x, z);
          pushCombatLog(`Traveled via World Atlas to ${label}.`, 'world');
        }}
      />

      <ShipyardModal
        open={activeModal === 'shipyard'}
        gold={player.gold}
        ownedShipType={player.ownedShipType || 'sloop'}
        shipHud={shipHud}
        onClose={() => setActiveModal(null)}
        onRepairShip={() => {
          if (player.gold < 25) return;
          setPlayer((prev) => ({ ...prev, gold: prev.gold - 25 }));
          engineRef.current?.repairPlayerShip();
        }}
        onSummonShip={() => {
          engineRef.current?.summonShipToNearestHarbor();
        }}
        onCommissionShip={(type: ShipType, cost: number) => {
          if (player.gold < cost) return;
          setPlayer((prev) => ({ ...prev, gold: prev.gold - cost, ownedShipType: type }));
          engineRef.current?.upgradeOrSwitchShip(type);
        }}
      />

      <KingdomDashboardModal
        open={
          activeModal === 'factions' ||
          activeModal === 'economy' ||
          activeModal === 'outposts' ||
          activeModal === 'relationships'
        }
        initialTab={
          activeModal === 'economy' || activeModal === 'outposts' || activeModal === 'relationships'
            ? activeModal
            : 'factions'
        }
        biomes={biomes}
        factions={factions}
        tradeRoutes={tradeRoutes}
        outposts={outposts}
        npcs={npcs}
        inventory={inventory}
        gold={player.gold}
        onClose={() => setActiveModal(null)}
        onSabotageRoute={handleSabotageRoute}
        onRestoreRoute={handleRestoreRoute}
        onBuildOutpost={handleBuildOutpost}
        onInfluenceNpc={handleInfluenceNpc}
        onFastTravel={(x, z, label) => {
          engineRef.current?.teleportPlayer(x, z);
          pushCombatLog(`Traveled to ${label}.`, 'world');
        }}
      />

      <SkillTreeModal
        open={activeModal === 'skills'}
        player={player}
        unlockedSkills={unlockedSkills}
        onClose={() => setActiveModal(null)}
        onUnlockSkill={handleUnlockSkill}
      />

      <DialogueModal
        npc={activeNpc}
        timeOfDay={timeOfDayLabel}
        factions={factions}
        outposts={outposts}
        gold={player.gold}
        activeCompanionId={player.companionId}
        onClose={() => setActiveNpcId(null)}
        onSelectOption={handleNpcOption}
        onBuyItem={handleBuyItem}
        onOpenVoice={() => setVoiceOpen(true)}
      />

      <SocialLeaderboardModal
        open={activeModal === 'leaderboard' || activeModal === 'photos' || activeModal === 'cloud'}
        initialTab={activeModal === 'photos' || activeModal === 'cloud' ? activeModal : 'leaderboard'}
        user={user}
        isOnline={isOnline}
        photos={photos}
        kingdomHealth={kingdomHealth}
        playerLevel={player.level}
        sealsRestored={sealsRestored}
        elapsedSeconds={elapsedSeconds}
        onClose={() => setActiveModal(null)}
        onSignIn={async () => {
          await signInWithGoogle();
        }}
        onSignOut={signOutAccount}
        onSaveCloud={async () => {
          const snap = buildSnapshot();
          saveLocalSlot(snap);
          if (!isOnline || !user) {
            queuePendingCloudSync(snap);
            throw new Error('Saved locally. Sign in online to push to Cloud.');
          }
          await saveGameToCloud(snap);
        }}
        onLoadCloud={async () => {
          const cloudSaves = await loadCloudSaves();
          if (cloudSaves.length === 0) throw new Error('No cloud saves found for this account.');
          const latest = cloudSaves[0];
          setBiomes((prev) => {
            const next = { ...prev };
            Object.entries(latest.biomeHealth || {}).forEach(([k, val]) => {
              if (next[k as BiomeId]) next[k as BiomeId] = { ...next[k as BiomeId], health: Number(val) };
            });
            return next;
          });
          setInventory(latest.inventory || []);
          setUnlockedSkills(latest.skills || ['warden_stride']);
          setPlayer((prev) => ({
            ...prev,
            level: latest.playerLevel || prev.level,
            moralAlignment: latest.moralAlignment ?? prev.moralAlignment,
            gold: Number(latest.playerState?.gold ?? prev.gold),
            hp: Number(latest.playerState?.hp ?? prev.hp),
            mana: Number(latest.playerState?.mana ?? prev.mana),
          }));
          pushCombatLog('Restored progression from Firebase Cloud save!', 'quest');
        }}
        onSubmitLeaderboard={async () => {
          const snap = buildSnapshot();
          await submitLeaderboardScore(snap);
        }}
        onCapturePhoto={handleCapturePhoto}
        onShareProgress={handleShareProgress}
      />

      <SettingsAccessibilityModal
        open={activeModal === 'settings'}
        settings={accessibility}
        season={season}
        weather={weather}
        onClose={() => setActiveModal(null)}
        onUpdateSettings={setAccessibility}
        onCycleSeason={() => {
          const next = SEASONS[(SEASONS.indexOf(season) + 1) % SEASONS.length];
          setSeason(next);
          pushCombatLog(`Season shifted to ${next}. Flora and wildlife patterns adapt.`, 'world');
        }}
        onCycleWeather={() => {
          const next = WEATHERS[(WEATHERS.indexOf(weather) + 1) % WEATHERS.length];
          setWeather(next);
          pushCombatLog(`Weather shifted to ${next}.`, 'world');
        }}
      />

      <GestureWheel
        open={gestureOpen}
        playerLevel={player.level}
        onClose={() => setGestureOpen(false)}
        onCommand={handleGestureCommand}
      />

      <VoiceOverlay
        open={voiceOpen}
        worldContext={`${biomes[currentBiome].name} (${Math.round(biomes[currentBiome].health)}% healthy), Season: ${season}, Weather: ${weather}, Seals Restored: ${sealsRestored}/4, Kingdom Health: ${kingdomHealth}%`}
        onClose={() => setVoiceOpen(false)}
        onExecuteVoiceCommand={handleVoiceCommand}
      />

      {/* Pause Menu Overlay */}
      {gameMode === 'paused' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4" role="dialog" aria-label="Game Paused">
          <div className="w-full max-w-sm rounded-xl hud-modal p-6 shadow-2xl space-y-3 text-center">
            <h2 className="font-display text-2xl font-bold text-amber-300">Chronicle Paused</h2>
            <p className="text-xs text-slate-400">
              {biomes[currentBiome].name} · Kingdom Health {kingdomHealth}% · Seals {sealsRestored}/4
            </p>
            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={() => setGameMode('playing')}
                className="w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm"
              >
                Resume Journey [Esc]
              </button>
              <button
                type="button"
                onClick={() => {
                  setGameMode('playing');
                  setActiveModal('music');
                }}
                className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
              >
                Bardic Soundtrack Studio
              </button>
              <button
                type="button"
                onClick={() => {
                  setGameMode('playing');
                  setActiveModal('atlas');
                }}
                className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
              >
                World Atlas & Sea Chart
              </button>
              <button
                type="button"
                onClick={() => setCreatorMode('edit')}
                className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
              >
                Edit Hero Appearance
              </button>
              <button
                type="button"
                onClick={() => setGameMode('title')}
                className="w-full py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/10 text-slate-300 text-xs font-medium"
              >
                Return to Title Screen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Character Creator (new hero, or edit from the pause menu) */}
      {creatorMode && (
        <CharacterCreatorModal
          initial={player.appearance}
          confirmLabel={creatorMode === 'new' ? 'Begin Chronicle' : 'Save Appearance'}
          onCancel={() => setCreatorMode(null)}
          onConfirm={(appearance: CharacterAppearance) => {
            setPlayer((prev) => ({ ...prev, appearance }));
            engineRef.current?.setPlayerAppearance(appearance);
            const wasNew = creatorMode === 'new';
            setCreatorMode(null);
            if (wasNew) {
              soundEngine.triggerCue('quest', 'Chronicle Begun');
              pushCombatLog(`${appearance.name} steps into Aethelgard.`, 'world');
              setGameMode('playing');
            }
          }}
        />
      )}

      {/* Prophecy Fulfilled Victory Summary */}
      {gameMode === 'victory' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="dialog" aria-label="Prophecy Fulfilled">
          <div className="w-full max-w-md rounded-xl hud-modal p-6 shadow-2xl space-y-4 text-center">
            <div className="text-xs uppercase tracking-[0.25em] text-amber-300">Grand Prophecy Fulfilled</div>
            <h2 className="font-display text-2xl font-bold text-white">The Four Seals Are Awakened</h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Your choices across Suncrest Citadel, Verdant Vale, Ember Crag, and Aether Spire have reshaped the destiny of Aethelgard.
            </p>
            <div className="grid grid-cols-3 gap-2 text-xs p-3 rounded-lg bg-slate-900/90 border border-white/10">
              <div>
                <div className="text-slate-400">Kingdom</div>
                <div className="font-mono-tabular font-bold text-emerald-400">{kingdomHealth}%</div>
              </div>
              <div>
                <div className="text-slate-400">Path</div>
                <div className="font-semibold text-amber-300">
                  {player.moralAlignment >= 18 ? 'Light' : player.moralAlignment <= -18 ? 'Shadow' : 'Balanced'}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Level</div>
                <div className="font-mono-tabular font-bold text-white">{player.level}</div>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setVictoryDismissed(true);
                  setGameMode('playing');
                  setActiveModal('leaderboard');
                }}
                className="w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm"
              >
                Post Run to Global Leaderboard
              </button>
              <button
                type="button"
                onClick={() => {
                  setVictoryDismissed(true);
                  setGameMode('playing');
                }}
                className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
              >
                Continue Exploring Free Roam
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
