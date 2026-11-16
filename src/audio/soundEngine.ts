import { WeatherType } from '../types/game';
import { MUSIC_TRACKS, MusicContextInput, MusicTrackInfo, selectMusicScene } from './musicCatalog';

export type SoundCueType =
  | 'melee'
  | 'fire'
  | 'lightning'
  | 'frost'
  | 'gale'
  | 'combo'
  | 'damage_taken'
  | 'harvest'
  | 'craft'
  | 'quest'
  | 'seal'
  | 'climb';

export interface VisualCueEvent {
  id: number;
  label: string;
  pattern: string;
  color: string;
}

export interface MusicPlaybackState {
  currentTrack: MusicTrackInfo;
  sceneLabel: string;
  isPlaying: boolean;
  isMuted: boolean;
  autoAdaptive: boolean;
  unlocked: boolean;
}

class ModularAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private ambientGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private droneOsc1: OscillatorNode | null = null;
  private droneOsc2: OscillatorNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private rainNode: AudioBufferSourceNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private isStarted = false;
  private hasPlayedUnlockChime = false;
  private chimeTimer: number | null = null;
  private currentBiomeHealth = 45;
  private currentWeather: WeatherType = 'Clear';
  private pendingSfx: SoundCueType[] = [];
  private unlockListenersBound = false;

  private masterVol = 0.65;
  private musicVol = 0.7;
  private ambientVol = 0.45;
  private sfxVol = 0.75;
  private hapticsEnabled = true;
  private visualCueCb: ((cue: VisualCueEvent) => void) | null = null;
  private cueSeq = 1;

  // Dual-deck MP3 music player state
  private activeDeck: HTMLAudioElement | null = null;
  private fadingDeck: HTMLAudioElement | null = null;
  private activeDeckGain = 1;
  private fadingDeckGain = 0;
  private fadeTimer: number | null = null;
  private currentTrackId: string = 'cinematic_adventure';
  private desiredAutoTrackId: string = 'cinematic_adventure';
  private currentSceneLabel: string = 'Title Overture';
  private lastAutoSwitchMs = 0;
  private autoAdaptive = true;
  private musicEnabled = true;
  private isMuted = false;
  private musicListeners = new Set<(state: MusicPlaybackState) => void>();
  private gestureUnlocked = false;
  private pausedDucked = false;
  private underwaterMuffled = false;

  constructor() {
    this.bindGlobalUnlockListeners();
  }

  private handleFirstGesture = () => {
    this.initOnGesture();
  };

  private bindGlobalUnlockListeners() {
    if (this.unlockListenersBound || typeof window === 'undefined') return;
    this.unlockListenersBound = true;
    window.addEventListener('pointerdown', this.handleFirstGesture, { capture: true, passive: true });
    window.addEventListener('keydown', this.handleFirstGesture, { capture: true, passive: true });
    window.addEventListener('touchstart', this.handleFirstGesture, { capture: true, passive: true });
  }

  private unbindGlobalUnlockListeners() {
    if (!this.unlockListenersBound || typeof window === 'undefined') return;
    this.unlockListenersBound = false;
    window.removeEventListener('pointerdown', this.handleFirstGesture, { capture: true });
    window.removeEventListener('keydown', this.handleFirstGesture, { capture: true });
    window.removeEventListener('touchstart', this.handleFirstGesture, { capture: true });
  }

  public setVisualCueListener(cb: ((cue: VisualCueEvent) => void) | null) {
    this.visualCueCb = cb;
  }

  public getMusicState(): MusicPlaybackState {
    const track = MUSIC_TRACKS.find((t) => t.id === this.currentTrackId) || MUSIC_TRACKS[0];
    return {
      currentTrack: track,
      sceneLabel: this.currentSceneLabel,
      isPlaying: Boolean(this.activeDeck && !this.activeDeck.paused && this.musicEnabled && !this.isMuted),
      isMuted: this.isMuted,
      autoAdaptive: this.autoAdaptive,
      unlocked: this.gestureUnlocked,
    };
  }

  public subscribeMusicState(cb: (state: MusicPlaybackState) => void): () => void {
    this.musicListeners.add(cb);
    cb(this.getMusicState());
    return () => {
      this.musicListeners.delete(cb);
    };
  }

  private emitMusicState() {
    const state = this.getMusicState();
    this.musicListeners.forEach((cb) => cb(state));
  }

  public configure(opts: {
    masterVolume: number;
    musicVolume?: number;
    ambientVolume: number;
    sfxVolume: number;
    hapticsEnabled: boolean;
  }) {
    this.masterVol = opts.masterVolume;
    if (typeof opts.musicVolume === 'number') {
      this.musicVol = opts.musicVolume;
    }
    this.ambientVol = opts.ambientVolume;
    this.sfxVol = opts.sfxVolume;
    this.hapticsEnabled = opts.hapticsEnabled;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.masterVol, this.ctx.currentTime, 0.06);
    }
    if (this.ambientGain && this.ctx) {
      this.ambientGain.gain.setTargetAtTime(this.ambientVol * 0.55, this.ctx.currentTime, 0.12);
    }
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setTargetAtTime(this.sfxVol * 1.15, this.ctx.currentTime, 0.05);
    }
    this.applyDeckVolumes();
  }

  private getEffectiveMusicVolume(trackId: string): number {
    if (!this.musicEnabled || this.isMuted) return 0;
    const track = MUSIC_TRACKS.find((t) => t.id === trackId);
    const trim = track?.defaultVolumeTrim ?? 0.88;
    const pauseFactor = this.pausedDucked ? 0.45 : 1.0;
    const waterFactor = this.underwaterMuffled ? 0.68 : 1.0;
    return Math.max(0, Math.min(1, this.masterVol * this.musicVol * trim * pauseFactor * waterFactor));
  }

  private applyDeckVolumes() {
    if (this.activeDeck) {
      this.activeDeck.volume = Math.max(
        0,
        Math.min(1, this.getEffectiveMusicVolume(this.currentTrackId) * this.activeDeckGain)
      );
    }
    if (this.fadingDeck) {
      const fadeTrackId = this.fadingDeck.dataset.trackId || this.currentTrackId;
      this.fadingDeck.volume = Math.max(
        0,
        Math.min(1, this.getEffectiveMusicVolume(fadeTrackId) * this.fadingDeckGain)
      );
    }
    if (this.droneGain && this.ctx) {
      const musicPlaying = Boolean(this.activeDeck && !this.activeDeck.paused && this.musicEnabled && !this.isMuted && this.musicVol > 0.05);
      this.droneGain.gain.setTargetAtTime(musicPlaying ? 0.04 : 0.42, this.ctx.currentTime, 0.35);
    }
  }

  private startOrCrossfadeTrack(trackId: string) {
    if (typeof window === 'undefined') return;
    const track = MUSIC_TRACKS.find((t) => t.id === trackId) || MUSIC_TRACKS[0];
    this.currentTrackId = track.id;

    if (!this.musicEnabled) {
      this.emitMusicState();
      return;
    }

    if (this.activeDeck && this.activeDeck.dataset.trackId === track.id) {
      if (this.activeDeck.paused && this.gestureUnlocked) {
        void this.activeDeck
          .play()
          .then(() => {
            this.applyDeckVolumes();
            this.emitMusicState();
          })
          .catch(() => {
            this.emitMusicState();
          });
      } else {
        this.applyDeckVolumes();
        this.emitMusicState();
      }
      return;
    }

    if (this.fadeTimer !== null) {
      window.clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
    if (this.fadingDeck) {
      try {
        this.fadingDeck.pause();
        this.fadingDeck.src = '';
      } catch {
        // Ignore cleanup errors
      }
      this.fadingDeck = null;
    }

    const prevDeck = this.activeDeck;
    const nextDeck = new Audio(track.url);
    nextDeck.loop = true;
    nextDeck.preload = 'auto';
    nextDeck.dataset.trackId = track.id;
    nextDeck.volume = 0;

    this.activeDeck = nextDeck;
    this.fadingDeck = prevDeck;
    this.activeDeckGain = prevDeck ? 0.02 : 1;
    this.fadingDeckGain = prevDeck ? 1 : 0;

    if (!this.gestureUnlocked) {
      this.emitMusicState();
      return;
    }

    void nextDeck
      .play()
      .then(() => {
        if (!prevDeck) {
          this.activeDeckGain = 1;
          this.applyDeckVolumes();
          this.emitMusicState();
          return;
        }
        const steps = 26;
        let step = 0;
        this.fadeTimer = window.setInterval(() => {
          step++;
          const t = Math.min(1, step / steps);
          this.activeDeckGain = t;
          this.fadingDeckGain = 1 - t;
          this.applyDeckVolumes();
          if (t >= 1) {
            if (this.fadeTimer !== null) {
              window.clearInterval(this.fadeTimer);
              this.fadeTimer = null;
            }
            if (this.fadingDeck) {
              try {
                this.fadingDeck.pause();
                this.fadingDeck.src = '';
              } catch {
                // Ignore
              }
              this.fadingDeck = null;
            }
          }
        }, 55);
        this.emitMusicState();
      })
      .catch(() => {
        this.emitMusicState();
      });
  }

  public setMusicContext(ctx: MusicContextInput) {
    this.pausedDucked = ctx.gameMode === 'paused';
    const decision = selectMusicScene(ctx);
    this.underwaterMuffled = decision.underwaterMuffled;
    this.desiredAutoTrackId = decision.trackId;
    const sceneChanged = this.currentSceneLabel !== decision.sceneLabel;
    this.currentSceneLabel = decision.sceneLabel;
    this.applyDeckVolumes();

    if (this.autoAdaptive && this.desiredAutoTrackId !== this.currentTrackId) {
      const now = Date.now();
      const cooldownMs = decision.urgent ? 400 : 2400;
      if (now - this.lastAutoSwitchMs >= cooldownMs) {
        this.lastAutoSwitchMs = now;
        this.startOrCrossfadeTrack(this.desiredAutoTrackId);
        return;
      }
    }
    if (sceneChanged) {
      this.emitMusicState();
    }
  }

  public selectTrack(trackId: string, lockManual = true) {
    if (lockManual) {
      this.autoAdaptive = false;
    }
    this.musicEnabled = true;
    this.isMuted = false;
    this.gestureUnlocked = true;
    this.startOrCrossfadeTrack(trackId);
    this.emitMusicState();
  }

  public setAutoAdaptive(enabled: boolean) {
    this.autoAdaptive = enabled;
    if (enabled && this.desiredAutoTrackId !== this.currentTrackId) {
      this.startOrCrossfadeTrack(this.desiredAutoTrackId);
    } else {
      this.emitMusicState();
    }
  }

  public toggleMusicPlay() {
    this.gestureUnlocked = true;
    if (!this.activeDeck) {
      this.musicEnabled = true;
      this.isMuted = false;
      this.startOrCrossfadeTrack(this.currentTrackId);
      return;
    }
    if (this.activeDeck.paused || !this.musicEnabled || this.isMuted) {
      this.musicEnabled = true;
      this.isMuted = false;
      void this.activeDeck
        .play()
        .then(() => {
          this.activeDeckGain = 1;
          this.applyDeckVolumes();
          this.emitMusicState();
        })
        .catch(() => {
          this.startOrCrossfadeTrack(this.currentTrackId);
        });
    } else {
      this.musicEnabled = false;
      this.activeDeck.pause();
      this.applyDeckVolumes();
      this.emitMusicState();
    }
  }

  public toggleMute() {
    this.isMuted = !this.isMuted;
    this.applyDeckVolumes();
    this.emitMusicState();
  }

  public nextTrack() {
    const idx = MUSIC_TRACKS.findIndex((t) => t.id === this.currentTrackId);
    const next = MUSIC_TRACKS[(idx + 1) % MUSIC_TRACKS.length];
    this.selectTrack(next.id, true);
  }

  public prevTrack() {
    const idx = MUSIC_TRACKS.findIndex((t) => t.id === this.currentTrackId);
    const prev = MUSIC_TRACKS[(idx - 1 + MUSIC_TRACKS.length) % MUSIC_TRACKS.length];
    this.selectTrack(prev.id, true);
  }

  private flushPendingSfx() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (!this.hasPlayedUnlockChime) {
      this.hasPlayedUnlockChime = true;
    }
    while (this.pendingSfx.length > 0) {
      const next = this.pendingSfx.shift();
      if (next) this.playSfx(next);
    }
  }

  public initOnGesture() {
    this.gestureUnlocked = true;

    // Ensure MP3 soundtrack starts cleanly on first user interaction
    if (this.musicEnabled && (!this.activeDeck || this.activeDeck.paused)) {
      this.startOrCrossfadeTrack(this.autoAdaptive ? this.desiredAutoTrackId : this.currentTrackId);
    }

    if (this.isStarted && this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().then(() => {
          this.flushPendingSfx();
        });
      } else if (this.ctx.state === 'running') {
        this.unbindGlobalUnlockListeners();
        this.flushPendingSfx();
      }
      return;
    }

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();
      this.ctx.onstatechange = () => {
        if (this.ctx?.state === 'running') {
          this.unbindGlobalUnlockListeners();
          this.flushPendingSfx();
        }
      };

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.22;
      this.compressor.connect(this.ctx.destination);

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.masterVol;
      this.masterGain.connect(this.compressor);

      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.value = this.ambientVol * 0.55;
      this.ambientGain.connect(this.masterGain);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxVol * 1.15;
      this.sfxGain.connect(this.masterGain);

      // Subtle sub-layer drone (ducked automatically when MP3 soundtrack is playing)
      this.droneGain = this.ctx.createGain();
      this.droneGain.gain.value = 0.04;
      this.droneGain.connect(this.ambientGain);

      this.droneFilter = this.ctx.createBiquadFilter();
      this.droneFilter.type = 'lowpass';
      this.droneFilter.frequency.value = 340;
      this.droneFilter.connect(this.droneGain);

      this.droneOsc1 = this.ctx.createOscillator();
      this.droneOsc1.type = 'sine';
      this.droneOsc1.frequency.value = 110;
      const g1 = this.ctx.createGain();
      g1.gain.value = 0.3;
      this.droneOsc1.connect(g1);
      g1.connect(this.droneFilter);
      this.droneOsc1.start();

      this.droneOsc2 = this.ctx.createOscillator();
      this.droneOsc2.type = 'triangle';
      this.droneOsc2.frequency.value = 164.81;
      const g2 = this.ctx.createGain();
      g2.gain.value = 0.16;
      this.droneOsc2.connect(g2);
      g2.connect(this.droneFilter);
      this.droneOsc2.start();

      // Weather & Wind noise bed (pink-ish filtered noise for natural winter breeze / rain)
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let lastOut = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        output[i] = (lastOut + 0.04 * white) / 1.04;
        lastOut = output[i];
        output[i] *= 2.8;
      }
      this.rainNode = this.ctx.createBufferSource();
      this.rainNode.buffer = noiseBuffer;
      this.rainNode.loop = true;

      this.rainFilter = this.ctx.createBiquadFilter();
      this.rainFilter.type = 'bandpass';
      this.rainFilter.frequency.value = 640;
      this.rainFilter.Q.value = 0.65;

      this.rainGain = this.ctx.createGain();
      this.rainGain.gain.value = 0.08;

      this.rainNode.connect(this.rainFilter);
      this.rainFilter.connect(this.rainGain);
      this.rainGain.connect(this.ambientGain);
      this.rainNode.start();

      // Only play procedural motif chime when music is muted/paused so it never clashes with real MP3 scores
      this.chimeTimer = window.setInterval(() => {
        if (!this.ctx || this.ctx.state !== 'running') return;
        const musicPlaying = Boolean(this.activeDeck && !this.activeDeck.paused && this.musicEnabled && !this.isMuted && this.musicVol > 0.05);
        if (!musicPlaying) {
          this.playAmbientMotif();
        }
      }, 4800);

      this.isStarted = true;
      this.updateEnvironment(this.currentBiomeHealth, this.currentWeather);
      this.applyDeckVolumes();

      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().then(() => {
          this.flushPendingSfx();
        });
      } else if (this.ctx.state === 'running') {
        this.unbindGlobalUnlockListeners();
        this.flushPendingSfx();
      }
    } catch {
      // Ignore audio failures on restricted browsers
    }
  }

  public testAudio(): boolean {
    this.initOnGesture();
    this.triggerCue('quest', 'Audio Verified');
    return Boolean(this.ctx || this.activeDeck);
  }

  public updateEnvironment(biomeHealth: number, weather: WeatherType) {
    this.currentBiomeHealth = biomeHealth;
    this.currentWeather = weather;
    if (!this.ctx || !this.droneOsc1 || !this.droneOsc2 || !this.droneFilter || !this.rainGain || !this.rainFilter) return;

    const now = this.ctx.currentTime;
    const h = Math.max(0, Math.min(1, biomeHealth / 100));
    const baseFreq = 98 + h * 32;
    const secondFreq = h < 0.4 ? baseFreq * 1.414 : baseFreq * 1.5;
    this.droneOsc1.frequency.setTargetAtTime(baseFreq, now, 0.8);
    this.droneOsc2.frequency.setTargetAtTime(secondFreq, now, 0.8);
    this.droneFilter.frequency.setTargetAtTime(240 + h * 520, now, 0.8);

    let weatherIntensity = 0.07;
    let filterFreq = 620;
    if (weather === 'Rain') {
      weatherIntensity = 0.24;
      filterFreq = 1050;
    } else if (weather === 'Thunderstorm') {
      weatherIntensity = 0.34;
      filterFreq = 1200;
    } else if (weather === 'Mist') {
      weatherIntensity = 0.11;
      filterFreq = 520;
    } else if (weather === 'Ashfall') {
      weatherIntensity = 0.14;
      filterFreq = 780;
    }
    this.rainGain.gain.setTargetAtTime(weatherIntensity, now, 0.6);
    this.rainFilter.frequency.setTargetAtTime(filterFreq, now, 0.6);
  }

  private playAmbientMotif() {
    if (!this.ctx || !this.ambientGain || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const oscHarm = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const healthyScale = [261.63, 329.63, 392.0, 493.88, 523.25];
    const corruptScale = [196.0, 207.65, 246.94, 277.18];
    const pool = this.currentBiomeHealth >= 50 ? healthyScale : corruptScale;
    const freq = pool[Math.floor(Math.random() * pool.length)];

    osc.type = this.currentBiomeHealth >= 50 ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    oscHarm.type = 'sine';
    oscHarm.frequency.setValueAtTime(freq * 2, now);

    const harmGain = this.ctx.createGain();
    harmGain.gain.value = 0.28;

    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(0.14, now + 0.22);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);

    osc.connect(g);
    oscHarm.connect(harmGain);
    harmGain.connect(g);
    g.connect(this.ambientGain);
    osc.start(now);
    oscHarm.start(now);
    osc.stop(now + 2.5);
    oscHarm.stop(now + 2.5);
  }

  public triggerCue(type: SoundCueType, detail?: string) {
    this.triggerHapticAndVisual(type, detail);
    this.initOnGesture();
    if (!this.ctx || !this.sfxGain || this.ctx.state !== 'running') {
      if (this.pendingSfx.length < 4) {
        this.pendingSfx.push(type);
      }
      return;
    }
    this.playSfx(type);
  }

  private triggerHapticAndVisual(type: SoundCueType, detail?: string) {
    const map: Record<SoundCueType, { vib: number[]; label: string; pattern: string; color: string }> = {
      melee: { vib: [25], label: detail || 'Blade Strike', pattern: 'Single Tap', color: '#e2e8f0' },
      fire: { vib: [40, 25, 60], label: detail || 'Ember Nova', pattern: 'Warm Surge', color: '#f97316' },
      lightning: { vib: [20, 20, 20, 20, 50], label: detail || 'Tempest Arc', pattern: 'Rapid Staccato', color: '#38bdf8' },
      frost: { vib: [70, 30, 30], label: detail || 'Glacial Surge', pattern: 'Crystalline Hold', color: '#67e8f9' },
      gale: { vib: [30, 15, 45], label: detail || 'Zephyr Leap', pattern: 'Rising Sweep', color: '#4ade80' },
      combo: { vib: [45, 25, 45, 25, 90], label: detail || 'Elemental Combo', pattern: 'Triple Resonance', color: '#fbbf24' },
      damage_taken: { vib: [95, 35, 95], label: detail || 'Incoming Hit', pattern: 'Heavy Alert', color: '#ef4444' },
      harvest: { vib: [18, 20, 24], label: detail || 'Resource Harvested', pattern: 'Double Pulse', color: '#10b981' },
      craft: { vib: [30, 30, 65], label: detail || 'Crucible Craft', pattern: 'Anvil Chime', color: '#f59e0b' },
      quest: { vib: [35, 30, 35, 30, 80], label: detail || 'Quest Progress', pattern: 'Prophecy Fanfare', color: '#fde047' },
      seal: { vib: [60, 40, 60, 40, 120], label: detail || 'Seal Awakened', pattern: 'Deep Resonance', color: '#c084fc' },
      climb: { vib: [15], label: detail || 'Ledge Grip', pattern: 'Light Grip', color: '#94a3b8' },
    };

    const info = map[type];
    if (this.hapticsEnabled && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(info.vib);
      } catch {
        // Ignore on unsupported desktop devices
      }
    }
    if (this.visualCueCb) {
      this.visualCueCb({
        id: this.cueSeq++,
        label: info.label,
        pattern: info.pattern,
        color: info.color,
      });
    }
  }

  private playSfx(type: SoundCueType) {
    if (!this.ctx || !this.sfxGain || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.connect(g);
    g.connect(this.sfxGain);

    switch (type) {
      case 'melee':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(340, now);
        osc.frequency.exponentialRampToValueAtTime(95, now + 0.14);
        g.gain.setValueAtTime(0.36, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.17);
        break;
      case 'fire':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(190, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.36);
        g.gain.setValueAtTime(0.32, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
        osc.start(now);
        osc.stop(now + 0.39);
        break;
      case 'lightning':
        osc.type = 'square';
        osc.frequency.setValueAtTime(1020, now);
        osc.frequency.exponentialRampToValueAtTime(210, now + 0.2);
        g.gain.setValueAtTime(0.26, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.24);
        break;
      case 'frost':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(760, now);
        osc.frequency.exponentialRampToValueAtTime(1380, now + 0.26);
        g.gain.setValueAtTime(0.32, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.32);
        break;
      case 'gale':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.exponentialRampToValueAtTime(680, now + 0.28);
        g.gain.setValueAtTime(0.32, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.32);
        break;
      case 'combo':
      case 'seal':
      case 'quest':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(392, now);
        osc.frequency.setValueAtTime(523.25, now + 0.09);
        osc.frequency.setValueAtTime(659.25, now + 0.18);
        g.gain.setValueAtTime(0.36, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
        osc.start(now);
        osc.stop(now + 0.5);
        break;
      case 'damage_taken':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(52, now + 0.24);
        g.gain.setValueAtTime(0.38, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.27);
        osc.start(now);
        osc.stop(now + 0.28);
        break;
      case 'harvest':
      case 'craft':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(780, now + 0.15);
        g.gain.setValueAtTime(0.3, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.2);
        break;
      case 'climb':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(190, now);
        g.gain.setValueAtTime(0.18, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.09);
        break;
    }
  }

  public dispose() {
    this.unbindGlobalUnlockListeners();
    if (this.chimeTimer !== null) clearInterval(this.chimeTimer);
    if (this.fadeTimer !== null) clearInterval(this.fadeTimer);
    try {
      this.activeDeck?.pause();
      this.fadingDeck?.pause();
      this.droneOsc1?.stop();
      this.droneOsc2?.stop();
      this.rainNode?.stop();
      void this.ctx?.close();
    } catch {
      // Ignore
    }
    this.activeDeck = null;
    this.fadingDeck = null;
    this.isStarted = false;
    this.hasPlayedUnlockChime = false;
    this.pendingSfx = [];
  }
}

export const soundEngine = new ModularAudioEngine();
