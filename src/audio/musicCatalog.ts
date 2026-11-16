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
    contextLabel: 'Suncrest Shrine & Night Exploration',
    url: '/assets/aistudio/royaltyfreemusicstudio-medieval-fantasy-music-462199_d203bf29.mp3',
    defaultVolumeTrim: 0.92,
  },
  {
    id: 'cinematic_adventure',
    title: 'Prophecy of the Four Seals',
    composer: 'OpenMind Cinematic',
    mood: 'Piano, wooden flute & soaring choir',
    contextLabel: 'Title Screen & Grand Landmarks',
    url: '/assets/aistudio/openmindaudio-fantasy-background-cinematic-adventure-atmosphere-464813_4c2a588e.mp3',
    defaultVolumeTrim: 0.9,
  },
  {
    id: 'fantasy_craft',
    title: 'Hearth & Timber of Verdant Vale',
    composer: 'Fantasy Craft Ensemble',
    mood: 'Lively folk fiddle, lute & flute',
    contextLabel: 'Verdant Vale, Villages & Crafting',
    url: '/assets/aistudio/backgroundmusicmaster-fantasy-craft-loop-431346_5abb7e1c.mp3',
    defaultVolumeTrim: 0.85,
  },
  {
    id: 'adventure_quest',
    title: 'Horizons of Ember & Sail',
    composer: 'Alex Morgan',
    mood: 'Heroic brass, strings & war drums',
    contextLabel: 'High Seas, Ember Crag & Combat',
    url: '/assets/aistudio/alex-morgan-fantasy-adventure-quest-537478_69dc269e.mp3',
    defaultVolumeTrim: 0.86,
  },
  {
    id: 'spellcraft',
    title: 'Starlight at Aether Spire',
    composer: 'Geoff Harvey',
    mood: 'Mystical chimes, pizzicato & celesta',
    contextLabel: 'Aether Spire & Arcane Ruins',
    url: '/assets/aistudio/geoffharvey-spellcraft-142264_bea7c7cd.mp3',
    defaultVolumeTrim: 0.88,
  },
  {
    id: 'mystery_sneak',
    title: 'Shadows Beneath the Vault',
    composer: 'DesiFree Chamber',
    mood: 'Stealthy pizzicato & subterranean intrigue',
    contextLabel: 'Caves, Dungeons & Stealth',
    url: '/assets/aistudio/desifreemusic-mystery-sneak-background-music-for-detective-and-crime-scenes-495508_a027c47a.mp3',
    defaultVolumeTrim: 0.85,
  },
];

export interface MusicContextInput {
  gameMode: 'title' | 'playing' | 'paused' | 'victory';
  biome: 'suncrest' | 'verdant' | 'ember' | 'aether';
  inDungeon: boolean;
  isSailing: boolean;
  isStealth: boolean;
  isCraftingOrTown: boolean;
}

export function selectContextTrackId(ctx: MusicContextInput): string {
  if (ctx.gameMode === 'title' || ctx.gameMode === 'victory') {
    return 'cinematic_adventure';
  }
  if (ctx.inDungeon || ctx.isStealth) {
    return 'mystery_sneak';
  }
  if (ctx.isSailing || ctx.biome === 'ember') {
    return 'adventure_quest';
  }
  if (ctx.isCraftingOrTown) {
    return 'fantasy_craft';
  }
  if (ctx.biome === 'aether') {
    return 'spellcraft';
  }
  if (ctx.biome === 'verdant') {
    return 'fantasy_craft';
  }
  return 'medieval_fantasy';
}
