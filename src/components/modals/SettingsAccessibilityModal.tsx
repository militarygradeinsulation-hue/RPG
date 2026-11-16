import React from 'react';
import { Accessibility, Volume2, X, Download } from 'lucide-react';
import { soundEngine } from '../../audio/soundEngine';
import { AccessibilitySettings, SeasonType, WeatherType } from '../../types/game';
import { usePWAInstall } from '../../hooks/usePWAInstall';

interface SettingsAccessibilityModalProps {
  open: boolean;
  settings: AccessibilitySettings;
  season: SeasonType;
  weather: WeatherType;
  onClose: () => void;
  onUpdateSettings: (next: AccessibilitySettings) => void;
  onCycleSeason: () => void;
  onCycleWeather: () => void;
}

export const SettingsAccessibilityModal: React.FC<SettingsAccessibilityModalProps> = ({
  open,
  settings,
  season,
  weather,
  onClose,
  onUpdateSettings,
  onCycleSeason,
  onCycleWeather,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      role="dialog"
      aria-label="Accessibility, Audio, and World Controls"
    >
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-xl hud-modal shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Accessibility className="w-5 h-5 text-amber-300" />
            <h2 className="font-display text-xl font-bold text-amber-300">Accessibility & Settings</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close settings" className="p-2 rounded-lg hover:bg-white/10 text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Color Theme & Text Scale */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 block">Color & Contrast Theme</label>
              <div className="flex flex-col gap-1.5">
                {([
                  { id: 'default', label: 'Dark Fantasy (Standard)' },
                  { id: 'high_contrast', label: 'High Contrast (WCAG AAA)' },
                  { id: 'colorblind', label: 'Colorblind Safe Palette' },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onUpdateSettings({ ...settings, theme: opt.id })}
                    className={`text-left px-3 py-2 rounded-lg border text-xs font-medium ${
                      settings.theme === opt.id
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-900 text-slate-200 border-white/10 hover:bg-slate-800'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-2">UI Text Scale</label>
                <div className="flex gap-2">
                  {(['100', '115', '130'] as const).map((sc) => (
                    <button
                      key={sc}
                      type="button"
                      onClick={() => onUpdateSettings({ ...settings, textScale: sc })}
                      className={`flex-1 py-2 rounded-lg border text-xs font-semibold ${
                        settings.textScale === sc
                          ? 'bg-amber-500 text-slate-950 border-amber-400'
                          : 'bg-slate-900 text-slate-200 border-white/10'
                      }`}
                    >
                      {sc}%
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                  <span>Reduced Motion</span>
                  <input
                    type="checkbox"
                    checked={settings.reducedMotion}
                    onChange={(e) => onUpdateSettings({ ...settings, reducedMotion: e.target.checked })}
                    className="accent-amber-500 w-4 h-4"
                  />
                </label>
                <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                  <span>Haptic Pattern Cues (Vibration)</span>
                  <input
                    type="checkbox"
                    checked={settings.hapticsEnabled}
                    onChange={(e) => onUpdateSettings({ ...settings, hapticsEnabled: e.target.checked })}
                    className="accent-amber-500 w-4 h-4"
                  />
                </label>
                <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                  <span>Visual Sound-Cue Bar</span>
                  <input
                    type="checkbox"
                    checked={settings.visualSoundCues}
                    onChange={(e) => onUpdateSettings({ ...settings, visualSoundCues: e.target.checked })}
                    className="accent-amber-500 w-4 h-4"
                  />
                </label>
                <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                  <span>Screen Reader Live Announcements</span>
                  <input
                    type="checkbox"
                    checked={settings.screenReaderAnnouncements}
                    onChange={(e) => onUpdateSettings({ ...settings, screenReaderAnnouncements: e.target.checked })}
                    className="accent-amber-500 w-4 h-4"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Graphics Quality & Performance Telemetry */}
          <div className="p-4 rounded-xl bg-slate-900/90 border border-white/10 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-amber-300">Rendering & Graphics Preset</div>
                <div className="text-[11px] text-slate-400">
                  Controls Cascaded Shadows, N8AO Ambient Occlusion, Selective HDR Bloom, SMAA, and crystal transmission.
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.showPerfHud}
                  onChange={(e) => onUpdateSettings({ ...settings, showPerfHud: e.target.checked })}
                  className="accent-amber-500 w-4 h-4"
                />
                <span>Show Perf Monitor (ms / Draw Calls)</span>
              </label>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {([
                { id: 'auto', label: 'Auto' },
                { id: 'low', label: 'Low' },
                { id: 'medium', label: 'Medium' },
                { id: 'high', label: 'High' },
                { id: 'ultra', label: 'Ultra' },
              ] as const).map((tier) => (
                <button
                  key={tier.id}
                  type="button"
                  onClick={() => onUpdateSettings({ ...settings, graphicsPreset: tier.id })}
                  className={`py-2 px-2 rounded-lg border text-xs font-semibold transition-colors ${
                    settings.graphicsPreset === tier.id
                      ? 'bg-amber-500 text-slate-950 border-amber-400'
                      : 'bg-slate-800 text-slate-200 border-white/10 hover:bg-slate-700'
                  }`}
                >
                  {tier.label}
                </button>
              ))}
            </div>
          </div>

          {/* Audio Mixer */}
          <div className="p-4 rounded-xl bg-slate-900/90 border border-white/10 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <Volume2 className="w-4 h-4" />
                Modular Audio Mixer
              </div>
              <button
                type="button"
                onClick={() => soundEngine.testAudio()}
                className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-white/10 text-[11px] font-semibold text-amber-200"
              >
                Test Sound
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {([
                { key: 'masterVolume', label: 'Master' },
                { key: 'musicVolume', label: 'Music Score' },
                { key: 'ambientVolume', label: 'Wind & Weather' },
                { key: 'sfxVolume', label: 'Combat SFX' },
              ] as const).map((slider) => (
                <div key={slider.key} className="space-y-1">
                  <div className="flex justify-between text-xs text-slate-300">
                    <span>{slider.label}</span>
                    <span className="font-mono-tabular">{Math.round(settings[slider.key] * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings[slider.key]}
                    onChange={(e) => onUpdateSettings({ ...settings, [slider.key]: Number(e.target.value) })}
                    className="w-full accent-amber-500"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Season / Weather & PWA Install */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-slate-900/90 border border-white/10">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCycleSeason}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white"
              >
                Season: {season} (Advance)
              </button>
              <button
                type="button"
                onClick={onCycleWeather}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white"
              >
                Weather: {weather} (Shift)
              </button>
            </div>
            {!isInstalled && isInstallable && (
              <button
                type="button"
                onClick={install}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold"
              >
                <Download className="w-3.5 h-3.5" />
                Install Offline App
              </button>
            )}
            {!isInstalled && !isInstallable && isIOS && (
              <span className="text-xs text-slate-400">iOS: Tap Share → Add to Home Screen for offline play</span>
            )}
          </div>

          {/* Controls Summary */}
          <div className="text-xs text-slate-300 leading-relaxed border-t border-white/10 pt-3">
            <strong>Controls:</strong> WASD / Arrows Move · Space Jump · Shift Sprint · C Climb Towers · Drag Mouse Camera · J / Click Blade Strike · 1 Fire · 2 Lightning · 3 Frost · 4 Gale · E Interact · G Gesture Wheel · V Voice Command · H Toggle HUD
          </div>
        </div>
      </div>
    </div>
  );
};
