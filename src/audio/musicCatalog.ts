import { TimeOfDay, WeatherType } from '../types/game';

export interface MusicTrackInfo {
  id: string;
  title: string;
  composer: string;
  mood: string;
  contextLabel: string;
  url: string;
  defaultVolumeTrim: number;
}

export const MUSIC_TRACKS: MusicTrackInfo[] = [
  {
    id: 'medieval_fantasy',
    title: 'Whispers of the Moonlit Shrine',
    composer: 'Medieval Fantasy Score',
    mood: 'Serene harp & ethereal night pads',
    contextLabel: 'Suncrest Shrine & Moonlit Wilds',
    url: '/assets/aistudio/royaltyfreemusicstudio-medieval-fantasy-music-462199_d203bf29.mp3',
    defaultVolumeTrim: 0.92,
  },
  {
    id: 'cinematic_adventure',
    title: 'Prophecy of the Four Seals',
    composer: 'OpenMind Cinematic',
    mood: 'Piano, wooden flute & soaring choir',
    contextLabel: 'Title Overture & Sunlit Horizons',
    url: '/assets/aistudio/openmindaudio-fantasy-background-cinematic-adventure-atmosphere-464813_4c2a588e.mp3',
    defaultVolumeTrim: 0.9,
  },
  {
    id: 'fantasy_craft',
    title: 'Hearth & Timber of Verdant Vale',
    composer: 'Fantasy Craft Ensemble',
    mood: 'Lively folk fiddle, lute & flute',
    contextLabel: 'Towns, Harbors, Crafting & Verdant Vale',
    url: '/assets/aistudio/backgroundmusicmaster-fantasy-craft-loop-431346_5abb7e1c.mp3',
    defaultVolumeTrim: 0.85,
  },
  {
    id: 'adventure_quest',
    title: 'Horizons of Ember & Sail',
    composer: 'Alex Morgan',
    mood: 'Heroic brass, strings & war drums',
    contextLabel: 'Combat, Dragon Bosses, High Seas & Ember Crag',
    url: '/assets/aistudio/alex-morgan-fantasy-adventure-quest-537478_69dc269e.mp3',
    defaultVolumeTrim: 0.86,
  },
  {
    id: 'spellcraft',
    title: 'Starlight at Aether Spire',
    composer: 'Geoff Harvey',
    mood: 'Mystical chimes, pizzicato & celesta',
    contextLabel: 'Seal Shrines, Underwater Dives & Aether Spire',
    url: '/assets/aistudio/geoffharvey-spellcraft-142264_bea7c7cd.mp3',
    defaultVolumeTrim: 0.88,
  },
  {
    id: 'mystery_sneak',
    title: 'Shadows Beneath the Vault',
    composer: 'DesiFree Chamber',
    mood: 'Stealthy pizzicato & subterranean intrigue',
    contextLabel: 'Caves, Dungeons & Stealth Stalking',
    url: '/assets/aistudio/desifreemusic-mystery-sneak-background-music-for-detective-and-crime-scenes-495508_a027c47a.mp3',
    defaultVolumeTrim: 0.85,
  },
];

export interface MusicContextInput {
  gameMode: 'title' | 'playing' | 'paused' | 'victory';
  biome: 'suncrest' | 'verdant' | 'ember' | 'aether';
  timeOfDay?: TimeOfDay;
  weather?: WeatherType;
  inDungeon: boolean;
  isSailing: boolean;
  isUnderwater?: boolean;
  isSwimming?: boolean;
  isStealth: boolean;
  inCombat?: boolean;
  nearDragon?: boolean;
  nearSeal?: boolean;
  nearSettlementOrNpc?: boolean;
  isCraftingOrTown: boolean;
}

export interface MusicSceneDecision {
  trackId: string;
  sceneLabel: string;
  urgent: boolean;
  underwaterMuffled: boolean;
}

export function selectMusicScene(ctx: MusicContextInput): MusicSceneDecision {
  if (ctx.gameMode === 'title') {
    return {
      trackId: 'cinematic_adventure',
      sceneLabel: 'Title Overture',
      urgent: true,
      underwaterMuffled: false,
    };
  }
  if (ctx.gameMode === 'victory') {
    return {
      trackId: 'cinematic_adventure',
      sceneLabel: 'Prophecy Fulfilled',
      urgent: true,
      underwaterMuffled: false,
    };
  }
  if (ctx.nearDragon) {
    return {
      trackId: 'adventure_quest',
      sceneLabel: 'Dragon Encounter',
      urgent: true,
      underwaterMuffled: Boolean(ctx.isUnderwater),
    };
  }
  if (ctx.inCombat) {
    return {
      trackId: 'adventure_quest',
      sceneLabel: 'Active Combat',
      urgent: true,
      underwaterMuffled: Boolean(ctx.isUnderwater),
    };
  }
  if (ctx.inDungeon) {
    return {
      trackId: 'mystery_sneak',
      sceneLabel: 'Dungeon & Cavern',
      urgent: true,
      underwaterMuffled: false,
    };
  }
  if (ctx.isStealth) {
    return {
      trackId: 'mystery_sneak',
      sceneLabel: 'Stealth & Stalking',
      urgent: false,
      underwaterMuffled: Boolean(ctx.isUnderwater),
    };
  }
  if (ctx.isUnderwater) {
    return {
      trackId: 'spellcraft',
      sceneLabel: 'Deep Underwater',
      urgent: true,
      underwaterMuffled: true,
    };
  }
  if (ctx.isSailing) {
    return {
      trackId: 'adventure_quest',
      sceneLabel: ctx.weather === 'Thunderstorm' ? 'Stormy High Seas' : 'Sailing the High Seas',
      urgent: true,
      underwaterMuffled: false,
    };
  }
  if (ctx.nearSeal || ctx.biome === 'aether') {
    return {
      trackId: 'spellcraft',
      sceneLabel: ctx.nearSeal ? 'Seal Shrine Resonance' : 'Aether Spire',
      urgent: false,
      underwaterMuffled: false,
    };
  }
  if (ctx.isCraftingOrTown || ctx.nearSettlementOrNpc || ctx.biome === 'verdant') {
    return {
      trackId: 'fantasy_craft',
      sceneLabel: ctx.isCraftingOrTown ? 'Forge & Hearth' : ctx.nearSettlementOrNpc ? 'Town & Harbor' : 'Verdant Vale',
      urgent: false,
      underwaterMuffled: false,
    };
  }
  if (ctx.biome === 'ember') {
    return {
      trackId: 'adventure_quest',
      sceneLabel: 'Ember Crag Badlands',
      urgent: false,
      underwaterMuffled: false,
    };
  }
  if (ctx.isSwimming) {
    return {
      trackId: 'medieval_fantasy',
      sceneLabel: 'Open Waters',
      urgent: false,
      underwaterMuffled: false,
    };
  }
  if (ctx.timeOfDay === 'Night' || ctx.timeOfDay === 'Dusk' || ctx.biome === 'suncrest') {
    return {
      trackId: 'medieval_fantasy',
      sceneLabel: ctx.timeOfDay === 'Night' ? 'Moonlit Night Wilds' : 'Suncrest Highlands',
      urgent: false,
      underwaterMuffled: false,
    };
  }
  return {
    trackId: 'cinematic_adventure',
    sceneLabel: 'Sunlit Realm Horizon',
    urgent: false,
    underwaterMuffled: false,
  };
}

export function selectContextTrackId(ctx: MusicContextInput): string {
  return selectMusicScene(ctx).trackId;
}
