import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, clampConfig } from './breathEngine';
import {
  AUDIO_PREFS_STORAGE_KEY,
  CUSTOM_PRESETS_STORAGE_KEY,
  LAST_CONFIG_STORAGE_KEY,
  LEGACY_HISTORY_STORAGE_KEYS,
  StorageLike,
  createCustomPreset,
  loadAudioPreferences,
  loadCustomPresets,
  loadInterfacePreferences,
  loadLastConfig,
  purgeLegacySessionHistory,
  saveAudioPreferences,
  saveCustomPresets,
  saveInterfacePreferences,
  saveLastConfig,
} from './sessionPreferences';

function createMemoryStorage(): StorageLike & { keys: () => string[] } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, val) => {
      map.set(key, val);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    keys: () => Array.from(map.keys()),
  };
}

test('purgeLegacySessionHistory deletes legacy session history and hold keys', () => {
  const storage = createMemoryStorage();
  for (const key of LEGACY_HISTORY_STORAGE_KEYS) {
    storage.setItem(key, JSON.stringify([{ holdLengthsSec: [90] }]));
  }
  storage.setItem(LAST_CONFIG_STORAGE_KEY, JSON.stringify(DEFAULT_CONFIG));

  purgeLegacySessionHistory(storage);

  for (const key of LEGACY_HISTORY_STORAGE_KEYS) {
    assert.equal(storage.getItem(key), null);
  }
  assert.ok(storage.getItem(LAST_CONFIG_STORAGE_KEY) !== null);
});

test('saveLastConfig and loadLastConfig restore clamped user cadence', () => {
  const storage = createMemoryStorage();
  const custom = clampConfig({
    breathCount: 25,
    rounds: 4,
    holdSec: 75,
    prepCountdownSec: 10,
    useRoundSpecificHolds: true,
    roundHoldOverrides: [45, 60, 75, 90, 90],
  });

  saveLastConfig(custom, storage);
  const loaded = loadLastConfig(storage);
  assert.deepEqual(loaded, custom);
});

test('named custom presets save, sanitize, and load cleanly', () => {
  const storage = createMemoryStorage();
  assert.equal(createCustomPreset('   ', DEFAULT_CONFIG), null);

  const preset = createCustomPreset('  Morning   Calm  ', clampConfig({ breathCount: 20, rounds: 2 }));
  assert.ok(preset);
  assert.equal(preset.name, 'Morning Calm');
  assert.equal(preset.isCustom, true);

  saveCustomPresets([preset], storage);
  const loaded = loadCustomPresets(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, 'Morning Calm');
  assert.equal(loaded[0].config.breathCount, 20);
  assert.equal(storage.keys().includes(CUSTOM_PRESETS_STORAGE_KEY), true);
});

test('audio and interface preferences round-trip safely without storing history', () => {
  const storage = createMemoryStorage();

  saveAudioPreferences(
    {
      audioEnabled: true,
      audioMode: 'voice_and_chimes',
      narrationLevel: 'minimal',
      soundscape: 'ocean',
      speechFallbackEnabled: false,
      volumes: { voiceVolume: 0.8, chimeVolume: 0.5, ambientVolume: 0.3 },
    },
    storage
  );
  const audioLoaded = loadAudioPreferences(storage);
  assert.equal(audioLoaded.narrationLevel, 'minimal');
  assert.equal(audioLoaded.soundscape, 'ocean');
  assert.equal(audioLoaded.volumes.ambientVolume, 0.3);
  assert.ok(storage.getItem(AUDIO_PREFS_STORAGE_KEY));

  saveInterfacePreferences({ reducedMotionOverride: true, autoFocusMode: true }, storage);
  const ifaceLoaded = loadInterfacePreferences(storage);
  assert.equal(ifaceLoaded.reducedMotionOverride, true);
  assert.equal(ifaceLoaded.autoFocusMode, true);
});
