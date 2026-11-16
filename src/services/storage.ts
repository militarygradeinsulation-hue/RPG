import { AccessibilitySettings, GameStateSnapshot, PhotoSnapshot } from '../types/game';

const SAVES_KEY = 'aethelgard_saves_v1';
const ACTIVE_SLOT_KEY = 'aethelgard_active_slot_v1';
const PHOTOS_KEY = 'aethelgard_photos_v1';
const SETTINGS_KEY = 'aethelgard_accessibility_v1';
const PENDING_SYNC_KEY = 'aethelgard_pending_sync_v1';

export const DEFAULT_ACCESSIBILITY: AccessibilitySettings = {
  theme: 'default',
  textScale: '100',
  reducedMotion: false,
  hapticsEnabled: true,
  visualSoundCues: true,
  screenReaderAnnouncements: true,
  masterVolume: 0.65,
  musicVolume: 0.7,
  ambientVolume: 0.45,
  sfxVolume: 0.75,
  graphicsPreset: 'auto',
  showPerfHud: false,
};

export function loadLocalSaves(): Record<string, GameStateSnapshot> {
  try {
    const raw = localStorage.getItem(SAVES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, GameStateSnapshot>) : {};
  } catch {
    return {};
  }
}

export function saveLocalSlot(snapshot: GameStateSnapshot): void {
  try {
    const all = loadLocalSaves();
    all[snapshot.slotId] = snapshot;
    localStorage.setItem(SAVES_KEY, JSON.stringify(all));
    localStorage.setItem(ACTIVE_SLOT_KEY, snapshot.slotId);
  } catch {
    // Ignore quota issues
  }
}

export function getActiveSlotId(): string {
  return localStorage.getItem(ACTIVE_SLOT_KEY) || 'slot_1';
}

export function loadSavedPhotos(): PhotoSnapshot[] {
  try {
    const raw = localStorage.getItem(PHOTOS_KEY);
    return raw ? (JSON.parse(raw) as PhotoSnapshot[]) : [];
  } catch {
    return [];
  }
}

export function savePhotoSnapshot(photo: PhotoSnapshot): PhotoSnapshot[] {
  const existing = loadSavedPhotos();
  const updated = [photo, ...existing].slice(0, 12);
  try {
    localStorage.setItem(PHOTOS_KEY, JSON.stringify(updated));
  } catch {
    // Trim older photos if storage quota tight
    try {
      localStorage.setItem(PHOTOS_KEY, JSON.stringify(updated.slice(0, 4)));
    } catch {
      // Ignore
    }
  }
  return updated;
}

export function loadAccessibilitySettings(): AccessibilitySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_ACCESSIBILITY, ...(JSON.parse(raw) as Partial<AccessibilitySettings>) } : DEFAULT_ACCESSIBILITY;
  } catch {
    return DEFAULT_ACCESSIBILITY;
  }
}

export function saveAccessibilitySettings(settings: AccessibilitySettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore
  }
}

export function queuePendingCloudSync(snapshot: GameStateSnapshot): void {
  try {
    localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore
  }
}

export function popPendingCloudSync(): GameStateSnapshot | null {
  try {
    const raw = localStorage.getItem(PENDING_SYNC_KEY);
    if (!raw) return null;
    localStorage.removeItem(PENDING_SYNC_KEY);
    return JSON.parse(raw) as GameStateSnapshot;
  } catch {
    return null;
  }
}
