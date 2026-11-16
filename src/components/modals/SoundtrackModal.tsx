import React, { useEffect, useState } from 'react';
import {
  Disc3,
  Download,
  Loader2,
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { MUSIC_TRACKS } from '../../audio/musicCatalog';
import { MusicPlaybackState, soundEngine } from '../../audio/soundEngine';
import { BiomeId, PhotoSnapshot, SeasonType, WeatherType } from '../../types/game';

interface SoundtrackModalProps {
  open: boolean;
  currentBiome: BiomeId;
  biomeName: string;
  biomeHealth: number;
  season: SeasonType;
  weather: WeatherType;
  photos: PhotoSnapshot[];
  onClose: () => void;
}

const PRESET_SCORES = [
  {
    id: 'suncrest_dawn',
    label: 'Suncrest Citadel Anthem',
    prompt:
      'Grand orchestral fantasy anthem at 96 BPM with noble French horns, hammered dulcimer, warm cello ostinato, and soaring choir harmonies evoking a sunlit marble citadel.',
  },
  {
    id: 'verdant_grove',
    label: 'Verdant Vale Mist',
    prompt:
      'Ethereal Celtic-fantasy acoustic exploration theme at 82 BPM with solo wooden flute, Celtic harp arpeggios, bodhrán pulse, and lush emerald strings.',
  },
  {
    id: 'ember_boss',
    label: 'Ember Crag Titan Clash',
    prompt:
      'Intense cinematic boss battle score at 138 BPM with thunderous taiko drums, low brass stabs, electric cello distortion, and dramatic choir.',
  },
  {
    id: 'aether_spire',
    label: 'Aether Spire Aurora',
    prompt:
      'Crystalline ambient fantasy synth-orchestral track at 76 BPM with glass marimba, shimmer pads, harp harmonics, and solemn solo violin.',
  },
];

export const SoundtrackModal: React.FC<SoundtrackModalProps> = ({
  open,
  biomeName,
  biomeHealth,
  season,
  weather,
  photos,
  onClose,
}) => {
  const [musicState, setMusicState] = useState<MusicPlaybackState>(() => soundEngine.getMusicState());
  const [mode, setMode] = useState<'clip' | 'pro'>('clip');
  const [prompt, setPrompt] = useState(
    `Cinematic open-world fantasy score for ${biomeName} during ${season} ${weather}, ${Math.round(biomeHealth)}% restored, orchestral strings, noble brass, harp, 94 BPM.`
  );
  const [selectedPhotoId, setSelectedPhotoId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [audioDataUrl, setAudioDataUrl] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [usedModel, setUsedModel] = useState('');

  useEffect(() => {
    return soundEngine.subscribeMusicState(setMusicState);
  }, []);

  if (!open) return null;

  const selectedPhoto = photos.find((p) => p.id === selectedPhotoId) || null;

  const handleCompose = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          mode,
          imageDataUrl: selectedPhoto ? selectedPhoto.dataUrl : undefined,
        }),
      });
      const data = (await res.json()) as {
        audioDataUrl?: string;
        lyrics?: string;
        model?: string;
        error?: string;
      };
      if (!res.ok || !data.audioDataUrl) {
        throw new Error(data.error || 'Unable to compose soundtrack.');
      }
      setAudioDataUrl(data.audioDataUrl);
      setLyrics(data.lyrics || '');
      setUsedModel(data.model || mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Music generation failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-label="Dynamic Soundtrack Composer"
    >
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-xl hud-modal shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Music className="w-5 h-5 text-amber-300" />
            <div>
              <h2 className="font-display text-xl font-bold text-amber-300">Bardic Soundtrack Studio</h2>
              <p className="text-xs text-slate-400">
                Real-time adaptive realm soundtrack & custom score composer
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close soundtrack studio"
            className="p-2 rounded-lg hover:bg-white/10 text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Aethelgard In-Game Soundtrack Player */}
          <div className="rounded-xl bg-slate-900/95 border border-amber-400/25 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/15 border border-amber-400/30 flex items-center justify-center">
                  <Disc3
                    className={`w-5 h-5 text-amber-300 ${musicState.isPlaying ? 'animate-spin' : ''}`}
                    style={{ animationDuration: '6s' }}
                  />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-amber-300/80 font-semibold">
                    {musicState.autoAdaptive ? `Adaptive Scene: ${musicState.sceneLabel}` : `Manual Track · Scene: ${musicState.sceneLabel}`}
                  </div>
                  <div className="text-sm font-bold text-white">{musicState.currentTrack.title}</div>
                  <div className="text-[11px] text-slate-400">
                    {musicState.currentTrack.mood} · {musicState.currentTrack.contextLabel}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => soundEngine.setAutoAdaptive(!musicState.autoAdaptive)}
                  className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${
                    musicState.autoAdaptive
                      ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300'
                      : 'bg-slate-800 border-white/10 text-slate-300 hover:bg-slate-700'
                  }`}
                  title="Automatically crossfade tracks by biome, dungeon, sea, or combat"
                >
                  Auto-DJ: {musicState.autoAdaptive ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  onClick={() => soundEngine.prevTrack()}
                  aria-label="Previous soundtrack track"
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10"
                >
                  <SkipBack className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => soundEngine.toggleMusicPlay()}
                  aria-label={musicState.isPlaying ? 'Pause music' : 'Play music'}
                  className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5"
                >
                  {musicState.isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  {musicState.isPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  type="button"
                  onClick={() => soundEngine.nextTrack()}
                  aria-label="Next soundtrack track"
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => soundEngine.toggleMute()}
                  aria-label={musicState.isMuted ? 'Unmute music' : 'Mute music'}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10"
                >
                  {musicState.isMuted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5 text-amber-300" />}
                </button>
              </div>
            </div>

            {/* All 6 Realm Tracks */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {MUSIC_TRACKS.map((track, idx) => {
                const active = musicState.currentTrack.id === track.id;
                return (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => soundEngine.selectTrack(track.id, true)}
                    className={`text-left p-2.5 rounded-lg border transition-colors flex items-center justify-between gap-2 ${
                      active
                        ? 'bg-amber-500/15 border-amber-400/50 text-white'
                        : 'bg-slate-950/70 border-white/10 text-slate-300 hover:bg-slate-800/80'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate flex items-center gap-1.5">
                        <span className="font-mono-tabular text-[10px] text-amber-300/80">0{idx + 1}</span>
                        <span className={active ? 'text-amber-200' : 'text-slate-100'}>{track.title}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">{track.contextLabel}</div>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-amber-300 shrink-0">
                      {active && musicState.isPlaying ? 'Playing' : 'Select'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Presets */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Custom Score Inspiration Presets</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PRESET_SCORES.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setPrompt(preset.prompt)}
                  className="text-left p-3 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-white/10 transition-colors"
                >
                  <div className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    {preset.label}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 line-clamp-2">{preset.prompt}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Prompt + Mode + Photo Inspiration */}
          <form onSubmit={handleCompose} className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-white/10">
                <button
                  type="button"
                  onClick={() => setMode('clip')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                    mode === 'clip' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Fast 30s Motif
                </button>
                <button
                  type="button"
                  onClick={() => setMode('pro')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                    mode === 'pro' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Full-Length Suite
                </button>
              </div>

              {photos.length > 0 && (
                <select
                  value={selectedPhotoId}
                  onChange={(e) => setSelectedPhotoId(e.target.value)}
                  aria-label="Optional Photo Mode snapshot mood reference"
                  className="rounded-lg bg-slate-900 border border-white/15 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-400"
                >
                  <option value="">No Photo Reference (Text Only)</option>
                  {photos.map((ph) => (
                    <option key={ph.id} value={ph.id}>
                      Inspire from Snapshot: {ph.biomeName} ({ph.weather})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedPhoto && (
              <div className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-900/90 border border-amber-400/20">
                <img
                  src={selectedPhoto.dataUrl}
                  alt={selectedPhoto.biomeName}
                  className="w-20 h-12 object-cover rounded border border-white/10"
                />
                <div className="text-xs text-slate-300">
                  Visual inspiration attached: <strong className="text-amber-300">{selectedPhoto.biomeName}</strong> ·{' '}
                  {selectedPhoto.season} {selectedPhoto.weather}
                </div>
              </div>
            )}

            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe instrumentation, tempo (BPM), biome mood, and dramatic arc..."
              aria-label="Soundtrack composition prompt"
              className="w-full rounded-xl bg-slate-900 border border-white/15 p-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
            />

            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-slate-400">
                Context: {biomeName} · {Math.round(biomeHealth)}% Healthy · {season} · {weather}
              </div>
              <button
                type="submit"
                disabled={loading || !prompt.trim()}
                className="px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold flex items-center gap-2 whitespace-nowrap"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {loading ? 'Composing Audio...' : 'Compose Soundtrack'}
              </button>
            </div>
          </form>

          {error && (
            <div className="p-3 rounded-lg bg-red-950/70 border border-red-400/30 text-xs text-red-200">{error}</div>
          )}

          {audioDataUrl && (
            <div className="p-4 rounded-xl bg-slate-900/95 border border-amber-400/30 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-amber-300">Generated Composition ({usedModel})</span>
                <a
                  href={audioDataUrl}
                  download={`aethelgard_score_${Date.now()}.mp3`}
                  className="inline-flex items-center gap-1.5 text-sky-300 hover:underline font-medium"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Track
                </a>
              </div>
              <audio controls autoPlay src={audioDataUrl} className="w-full" />
              {lyrics && (
                <div className="p-3 rounded-lg bg-slate-950/80 border border-white/10 text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {lyrics}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
