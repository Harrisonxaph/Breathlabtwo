import { BreathConfig, BreathPreset, clampConfig } from './breathEngine';
import {
  AudioMode,
  AudioVolumeSettings,
  NarrationLevel,
  SoundscapeId,
  clampAudioVolumes,
} from './breathAudioPolicy';

export const LAST_CONFIG_STORAGE_KEY = 'breathflow.lastConfig.v1';
export const CUSTOM_PRESETS_STORAGE_KEY = 'breathflow.customPresets.v1';
export const AUDIO_PREFS_STORAGE_KEY = 'breathflow.audioPrefs.v1';
export const INTERFACE_PREFS_STORAGE_KEY = 'breathflow.interfacePrefs.v1';
export const LEGACY_HISTORY_STORAGE_KEYS = ['cadence.breathwork.history.v1', 'breathflow.history.v1'];

export interface StoredAudioPreferences {
  audioEnabled: boolean;
  audioMode: AudioMode;
  narrationLevel: NarrationLevel;
  soundscape: SoundscapeId;
  speechFallbackEnabled: boolean;
  volumes: AudioVolumeSettings;
}

export interface StoredInterfacePreferences {
  reducedMotionOverride: boolean;
  autoFocusMode: boolean;
}

export const DEFAULT_AUDIO_PREFERENCES: StoredAudioPreferences = {
  audioEnabled: true,
  audioMode: 'voice_and_chimes',
  narrationLevel: 'balanced',
  soundscape: 'off',
  speechFallbackEnabled: true,
  volumes: clampAudioVolumes({}),
};

export const DEFAULT_INTERFACE_PREFERENCES: StoredInterfacePreferences = {
  reducedMotionOverride: false,
  autoFocusMode: false,
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getSafeStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Privacy: proactively removes any legacy session history or hold-record storage keys.
 */
export function purgeLegacySessionHistory(storage?: StorageLike): void {
  const s = getSafeStorage(storage);
  if (!s) return;
  for (const key of LEGACY_HISTORY_STORAGE_KEYS) {
    try {
      s.removeItem(key);
    } catch {
      // Ignore storage errors
    }
  }
}

export function saveLastConfig(config: BreathConfig, storage?: StorageLike): void {
  const s = getSafeStorage(storage);
  if (!s) return;
  try {
    s.setItem(LAST_CONFIG_STORAGE_KEY, JSON.stringify(clampConfig(config)));
  } catch {
    // Ignore quota errors
  }
}

export function loadLastConfig(storage?: StorageLike): BreathConfig | null {
  const s = getSafeStorage(storage);
  if (!s) return null;
  try {
    const raw = s.getItem(LAST_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return clampConfig(parsed as Partial<BreathConfig>);
  } catch {
    return null;
  }
}

export function sanitizePresetName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 32);
}

export function createCustomPreset(name: string, config: BreathConfig): BreathPreset | null {
  const cleanName = sanitizePresetName(name);
  if (!cleanName) return null;
  const safe = clampConfig(config);
  return {
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    subtitle: `${safe.breathCount} breaths × ${safe.rounds} rounds · ${safe.holdSec}s hold`,
    config: safe,
    isCustom: true,
  };
}

export function saveCustomPresets(presets: BreathPreset[], storage?: StorageLike): void {
  const s = getSafeStorage(storage);
  if (!s) return;
  try {
    const clean = presets.slice(0, 12).map((p) => ({
      ...p,
      name: sanitizePresetName(p.name) || 'Custom Preset',
      config: clampConfig(p.config),
      isCustom: true,
    }));
    s.setItem(CUSTOM_PRESETS_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Ignore quota errors
  }
}

export function loadCustomPresets(storage?: StorageLike): BreathPreset[] {
  const s = getSafeStorage(storage);
  if (!s) return [];
  try {
    const raw = s.getItem(CUSTOM_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
      .slice(0, 12)
      .map((item) => {
        const safe = clampConfig((item as { config?: Partial<BreathConfig> }).config ?? {});
        const cleanName = sanitizePresetName(String((item as { name?: unknown }).name ?? '')) || 'Custom Preset';
        return {
          id: String((item as { id: string }).id),
          name: cleanName,
          subtitle: `${safe.breathCount} breaths × ${safe.rounds} rounds · ${safe.holdSec}s hold`,
          config: safe,
          isCustom: true,
        };
      });
  } catch {
    return [];
  }
}

export function saveAudioPreferences(prefs: StoredAudioPreferences, storage?: StorageLike): void {
  const s = getSafeStorage(storage);
  if (!s) return;
  try {
    s.setItem(
      AUDIO_PREFS_STORAGE_KEY,
      JSON.stringify({
        ...prefs,
        volumes: clampAudioVolumes(prefs.volumes),
      })
    );
  } catch {
    // Ignore quota errors
  }
}

export function loadAudioPreferences(storage?: StorageLike): StoredAudioPreferences {
  const s = getSafeStorage(storage);
  if (!s) return DEFAULT_AUDIO_PREFERENCES;
  try {
    const raw = s.getItem(AUDIO_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_AUDIO_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<StoredAudioPreferences>;
    const validModes: AudioMode[] = ['voice_and_chimes', 'voice_only', 'chimes_only'];
    const validLevels: NarrationLevel[] = ['minimal', 'balanced', 'active'];
    const validSoundscapes: SoundscapeId[] = ['off', 'ocean', 'drone', 'rain'];

    return {
      audioEnabled:
        typeof parsed.audioEnabled === 'boolean'
          ? parsed.audioEnabled
          : DEFAULT_AUDIO_PREFERENCES.audioEnabled,
      audioMode: validModes.includes(parsed.audioMode as AudioMode)
        ? (parsed.audioMode as AudioMode)
        : DEFAULT_AUDIO_PREFERENCES.audioMode,
      narrationLevel: validLevels.includes(parsed.narrationLevel as NarrationLevel)
        ? (parsed.narrationLevel as NarrationLevel)
        : DEFAULT_AUDIO_PREFERENCES.narrationLevel,
      soundscape: validSoundscapes.includes(parsed.soundscape as SoundscapeId)
        ? (parsed.soundscape as SoundscapeId)
        : DEFAULT_AUDIO_PREFERENCES.soundscape,
      speechFallbackEnabled:
        typeof parsed.speechFallbackEnabled === 'boolean'
          ? parsed.speechFallbackEnabled
          : DEFAULT_AUDIO_PREFERENCES.speechFallbackEnabled,
      volumes: clampAudioVolumes(parsed.volumes ?? {}),
    };
  } catch {
    return DEFAULT_AUDIO_PREFERENCES;
  }
}

export function saveInterfacePreferences(
  prefs: StoredInterfacePreferences,
  storage?: StorageLike
): void {
  const s = getSafeStorage(storage);
  if (!s) return;
  try {
    s.setItem(INTERFACE_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore quota errors
  }
}

export function loadInterfacePreferences(storage?: StorageLike): StoredInterfacePreferences {
  const s = getSafeStorage(storage);
  if (!s) return DEFAULT_INTERFACE_PREFERENCES;
  try {
    const raw = s.getItem(INTERFACE_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_INTERFACE_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<StoredInterfacePreferences>;
    return {
      reducedMotionOverride: Boolean(parsed.reducedMotionOverride),
      autoFocusMode: Boolean(parsed.autoFocusMode),
    };
  } catch {
    return DEFAULT_INTERFACE_PREFERENCES;
  }
}
