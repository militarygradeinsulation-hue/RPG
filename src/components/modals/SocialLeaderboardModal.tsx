import React, { useEffect, useState } from 'react';
import { Camera, Cloud, Download, Film, Loader2, LogIn, LogOut, Share2, Trophy, Upload, X } from 'lucide-react';
import { User } from 'firebase/auth';
import { fetchLeaderboard } from '../../services/firebase';
import { LeaderboardRecord, PhotoSnapshot } from '../../types/game';

interface SocialLeaderboardModalProps {
  open: boolean;
  initialTab?: 'leaderboard' | 'photos' | 'cloud';
  user: User | null;
  isOnline: boolean;
  photos: PhotoSnapshot[];
  kingdomHealth: number;
  playerLevel: number;
  sealsRestored: number;
  elapsedSeconds: number;
  onClose: () => void;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSaveCloud: () => Promise<void>;
  onLoadCloud: () => Promise<void>;
  onSubmitLeaderboard: () => Promise<void>;
  onCapturePhoto: () => void;
  onShareProgress: () => void;
}

export const SocialLeaderboardModal: React.FC<SocialLeaderboardModalProps> = ({
  open,
  initialTab = 'leaderboard',
  user,
  isOnline,
  photos,
  kingdomHealth,
  playerLevel,
  sealsRestored,
  elapsedSeconds,
  onClose,
  onSignIn,
  onSignOut,
  onSaveCloud,
  onLoadCloud,
  onSubmitLeaderboard,
  onCapturePhoto,
  onShareProgress,
}) => {
  const [tab, setTab] = useState<'leaderboard' | 'photos' | 'cloud'>(initialTab);
  const [entries, setEntries] = useState<LeaderboardRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  // Photo-to-Video Animation State
  const [sourceImageUrl, setSourceImageUrl] = useState('');
  const [videoPrompt, setVideoPrompt] = useState(
    'Hyperrealistic cinematic camera push-in with drifting atmospheric mist, swaying pine branches, and golden sunbeams breaking through clouds.'
  );
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [animating, setAnimating] = useState(false);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState('');
  const [videoError, setVideoError] = useState('');

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!sourceImageUrl && photos.length > 0) {
      setSourceImageUrl(photos[0].dataUrl);
    }
  }, [photos, sourceImageUrl]);

  useEffect(() => {
    if (!open || tab !== 'leaderboard' || !isOnline) return;
    setLoading(true);
    fetchLeaderboard()
      .then((res) => setEntries(res))
      .catch((err) => setStatusMsg(err instanceof Error ? err.message : 'Unable to fetch leaderboard.'))
      .finally(() => setLoading(false));
  }, [open, tab, isOnline]);

  if (!open) return null;

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  };

  const handleUploadImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setSourceImageUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAnimatePhoto = async () => {
    if (!sourceImageUrl || animating) return;
    setAnimating(true);
    setVideoError('');
    try {
      const res = await fetch('/api/animate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageDataUrl: sourceImageUrl,
          prompt: videoPrompt,
          aspectRatio,
          duration: '6s',
        }),
      });
      const data = (await res.json()) as { videoDataUrl?: string; error?: string };
      if (!res.ok || !data.videoDataUrl) {
        throw new Error(data.error || 'Unable to animate image into video.');
      }
      setGeneratedVideoUrl(data.videoDataUrl);
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : 'Video animation failed.');
    } finally {
      setAnimating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      role="dialog"
      aria-label="Global Leaderboard, Photo Gallery, and Cloud Sync"
    >
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-xl hud-modal shadow-2xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-white/10">
          <div className="flex flex-wrap items-center gap-4">
            <h2 className="font-display text-xl font-bold text-amber-300">Archive & Rankings</h2>
            <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() => setTab('leaderboard')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${
                  tab === 'leaderboard' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Trophy className="w-3.5 h-3.5" />
                Global Leaderboard
              </button>
              <button
                type="button"
                onClick={() => setTab('photos')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${
                  tab === 'photos' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                Photo & Video ({photos.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('cloud')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${
                  tab === 'cloud' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Cloud className="w-3.5 h-3.5" />
                Cloud Sync & Share
              </button>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close archive" className="p-2 rounded-lg hover:bg-white/10 text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {statusMsg && (
            <div className="p-3 rounded-lg bg-slate-900 border border-amber-400/30 text-xs text-amber-200">{statusMsg}</div>
          )}

          {tab === 'leaderboard' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-slate-900/90 border border-white/10">
                <div className="text-xs text-slate-300">
                  Your Run: Level {playerLevel} · Kingdom Health {kingdomHealth}% · Seals {sealsRestored}/4 · Time {formatTime(elapsedSeconds)}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await onSubmitLeaderboard();
                      setStatusMsg('Run submitted to Global Leaderboard!');
                      const fresh = await fetchLeaderboard();
                      setEntries(fresh);
                    } catch (e) {
                      setStatusMsg(e instanceof Error ? e.message : 'Submission queued offline.');
                    }
                  }}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold"
                >
                  Submit Current Run
                </button>
              </div>

              {loading ? (
                <div className="py-10 text-center text-sm text-slate-400">Loading global restoration rankings...</div>
              ) : entries.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-400">
                  {isOnline ? 'No leaderboard entries yet. Be the first Warden to post a restoration run!' : 'Offline mode — connect to view global rankings.'}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900 text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Rank</th>
                        <th className="px-4 py-3">Warden</th>
                        <th className="px-4 py-3">Score</th>
                        <th className="px-4 py-3">Kingdom Health</th>
                        <th className="px-4 py-3">Seals</th>
                        <th className="px-4 py-3">Path</th>
                        <th className="px-4 py-3">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 bg-slate-950/60">
                      {entries.map((row, idx) => (
                        <tr key={row.id}>
                          <td className="px-4 py-3 font-mono-tabular text-amber-300">#{idx + 1}</td>
                          <td className="px-4 py-3 font-semibold text-white">{row.displayName}</td>
                          <td className="px-4 py-3 font-mono-tabular text-emerald-400">{row.restorationScore}</td>
                          <td className="px-4 py-3 font-mono-tabular">{row.kingdomHealth}%</td>
                          <td className="px-4 py-3 font-mono-tabular">{row.sealsRestored}/4</td>
                          <td className="px-4 py-3">{row.moralPath}</td>
                          <td className="px-4 py-3 font-mono-tabular text-slate-400">{formatTime(row.elapsedSeconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'photos' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-300">
                  Capture 3D panoramas with live metadata or animate any snapshot/uploaded photo into a cinematic video loop.
                </p>
                <button
                  type="button"
                  onClick={onCapturePhoto}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Camera className="w-3.5 h-3.5" />
                  Take 3D Photo
                </button>
              </div>

              {/* Photo-to-Video Animation Studio */}
              <div className="p-4 rounded-xl bg-slate-900/95 border border-amber-400/25 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-bold text-amber-300 flex items-center gap-2">
                    <Film className="w-4 h-4" />
                    Animate Snapshot or Photo into Video
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="cursor-pointer px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5" />
                      Upload Image
                      <input type="file" accept="image/*" onChange={handleUploadImage} className="hidden" />
                    </label>
                    <div className="flex items-center gap-1 p-0.5 bg-slate-950 rounded-lg border border-white/10 text-xs">
                      <button
                        type="button"
                        onClick={() => setAspectRatio('16:9')}
                        className={`px-2.5 py-1 rounded ${aspectRatio === '16:9' ? 'bg-amber-500 text-slate-950 font-semibold' : 'text-slate-300'}`}
                      >
                        16:9
                      </button>
                      <button
                        type="button"
                        onClick={() => setAspectRatio('9:16')}
                        className={`px-2.5 py-1 rounded ${aspectRatio === '9:16' ? 'bg-amber-500 text-slate-950 font-semibold' : 'text-slate-300'}`}
                      >
                        9:16
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                  <div className="rounded-lg overflow-hidden bg-slate-950 border border-white/10 h-32 flex items-center justify-center">
                    {sourceImageUrl ? (
                      <img src={sourceImageUrl} alt="Selected animation frame" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs text-slate-500 px-3 text-center">Capture a 3D photo or upload an image</span>
                    )}
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <textarea
                      rows={2}
                      value={videoPrompt}
                      onChange={(e) => setVideoPrompt(e.target.value)}
                      placeholder="Describe camera motion, weather drift, lighting..."
                      aria-label="Video motion prompt"
                      className="w-full rounded-lg bg-slate-950 border border-white/15 p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-400">
                        Select any snapshot below or upload your own still image.
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleAnimatePhoto()}
                        disabled={!sourceImageUrl || animating}
                        className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
                      >
                        {animating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Film className="w-3.5 h-3.5" />}
                        {animating ? 'Rendering Video...' : 'Animate to Video'}
                      </button>
                    </div>
                  </div>
                </div>

                {videoError && (
                  <div className="p-2.5 rounded-lg bg-red-950/70 border border-red-400/30 text-xs text-red-200">{videoError}</div>
                )}

                {generatedVideoUrl && (
                  <div className="pt-2 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-emerald-300">Animated Chronicle Clip Ready</span>
                      <a
                        href={generatedVideoUrl}
                        download={`aethelgard_reel_${Date.now()}.mp4`}
                        className="inline-flex items-center gap-1 text-sky-300 hover:underline"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download MP4
                      </a>
                    </div>
                    <video controls autoPlay loop src={generatedVideoUrl} className="w-full max-h-72 rounded-lg bg-black" />
                  </div>
                )}
              </div>

              {photos.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400">
                  No snapshots captured yet. Click Take 3D Photo to capture a panorama with live world metadata.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {photos.map((ph) => (
                    <div key={ph.id} className="rounded-xl bg-slate-900 border border-white/10 overflow-hidden">
                      <img src={ph.dataUrl} alt={`Panorama at ${ph.biomeName}`} className="w-full h-44 object-cover" />
                      <div className="p-3 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <strong className="text-amber-300">{ph.biomeName} ({ph.biomeHealth}%)</strong>
                          <span className="font-mono-tabular text-slate-400">
                            X:{ph.coords.x} Y:{ph.coords.y} Z:{ph.coords.z}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-300">
                          {ph.season} · {ph.weather} · {ph.moralPath} Path · Quest: {ph.activeQuestTitle}
                        </div>
                        <div className="pt-1 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => setSourceImageUrl(ph.dataUrl)}
                            className="text-xs text-amber-300 hover:underline font-medium"
                          >
                            Use for Video Animation
                          </button>
                          <a
                            href={ph.dataUrl}
                            download={`aethelgard_${ph.id}.jpg`}
                            className="inline-flex items-center gap-1 text-xs text-sky-300 hover:underline"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'cloud' && (
            <div className="space-y-5">
              <div className="p-4 rounded-xl bg-slate-900/90 border border-white/10 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-white">
                    {user ? `Signed in as ${user.displayName || user.email}` : 'Offline Local Save Active'}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Progress always saves locally for offline play and syncs cross-platform when signed in.
                  </div>
                </div>
                {user ? (
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white flex items-center gap-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onSignIn}
                    className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    Sign In with Google
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await onSaveCloud();
                      setStatusMsg('Save slot synced to Firebase Cloud!');
                    } catch (e) {
                      setStatusMsg(e instanceof Error ? e.message : 'Saved locally; queued for cloud sync.');
                    }
                  }}
                  className="p-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/15 text-left space-y-1"
                >
                  <div className="text-sm font-semibold text-amber-300">Sync Cloud Save</div>
                  <div className="text-xs text-slate-400">Upload current world state, NPCs & biomes</div>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await onLoadCloud();
                      setStatusMsg('Cloud save restored!');
                    } catch (e) {
                      setStatusMsg(e instanceof Error ? e.message : 'Could not load cloud save.');
                    }
                  }}
                  className="p-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/15 text-left space-y-1"
                >
                  <div className="text-sm font-semibold text-sky-300">Load Cloud Save</div>
                  <div className="text-xs text-slate-400">Pull your latest cross-platform save slot</div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onShareProgress();
                    setStatusMsg('Achievement summary copied for sharing!');
                  }}
                  className="p-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/15 text-left space-y-1"
                >
                  <div className="text-sm font-semibold text-emerald-300 flex items-center gap-1.5">
                    <Share2 className="w-4 h-4" />
                    Share Achievements
                  </div>
                  <div className="text-xs text-slate-400">Compare restoration progress with friends</div>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
