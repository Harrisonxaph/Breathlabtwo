/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import { BreathVisualizer } from './components/BreathVisualizer';
import { DriveVoicePanel } from './components/DriveVoicePanel';
import { ProtocolControls } from './components/ProtocolControls';
import { PWAInstallControl } from './components/PWAInstallBanner';
import { SafetyAndGuide } from './components/SafetyAndGuide';
import { SafetyReminderModal } from './components/SafetyReminderModal';
import {
  BREATH_PRESETS,
  BreathConfig,
  BreathPreset,
  BreathSessionState,
  DEFAULT_CONFIG,
  InterruptionReason,
  createInitialState,
  endSessionEarly,
  getPhaseProgress,
  pauseForInterruption,
  resumeFromPause,
  skipToNextPhase,
  startSession,
  stepSession,
} from './utils/breathEngine';
import {
  AudioMode,
  AudioReadinessReport,
  AudioVolumeSettings,
  NarrationLevel,
  SoundscapeId,
  breathAudio,
} from './utils/breathAudio';
import {
  evaluateProgressAudioUpdate,
  getTransitionSpeechText,
} from './utils/breathCoaching';
import {
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
} from './utils/sessionPreferences';
import { acquireWakeLock, releaseWakeLock } from './utils/wakeLock';
import {
  clearAudioCache,
  loadAllCachedClips,
  loadVoiceStateMeta,
  saveClipToCache,
  saveVoiceStateMeta,
  serializePhaseMapIds,
} from './utils/audioCacheDb';
import {
  DriveApiError,
  fetchDriveAudioBuffer,
  findBreathflowClips,
  searchDriveAudioFiles,
} from './utils/driveAudio';
import {
  DriveAudioFile,
  PhaseAudioMap,
  VoicePhaseSlot,
  findEncouragementClips,
  matchClipsToPhases,
} from './utils/driveAudioMatcher';
import {
  BUILTIN_AUDIO_FILES,
  getBuiltinPhaseMap,
  getBuiltinVoicePools,
} from './utils/builtinAudioPack';
import {
  clearAccessToken,
  getAccessToken,
  googleSignIn,
  initAuth,
  logout,
} from './utils/googleAuth';

function configsEqual(a: BreathConfig, b: BreathConfig): boolean {
  return (
    a.breathCount === b.breathCount &&
    a.inhaleSec === b.inhaleSec &&
    a.exhaleSec === b.exhaleSec &&
    a.holdSec === b.holdSec &&
    a.recoveryInhaleSec === b.recoveryInhaleSec &&
    a.recoveryHoldSec === b.recoveryHoldSec &&
    a.rounds === b.rounds &&
    a.prepCountdownSec === b.prepCountdownSec &&
    a.useRoundSpecificHolds === b.useRoundSpecificHolds &&
    a.roundRetentionCues === b.roundRetentionCues &&
    a.roundHoldOverrides.slice(0, a.rounds).join(',') ===
      b.roundHoldOverrides.slice(0, b.rounds).join(',')
  );
}

export default function App() {
  const [config, setConfig] = useState<BreathConfig>(() => loadLastConfig() ?? DEFAULT_CONFIG);
  const [customPresets, setCustomPresets] = useState<BreathPreset[]>(() => loadCustomPresets());
  const [activePresetId, setActivePresetId] = useState<string | null>(() => {
    const initial = loadLastConfig() ?? DEFAULT_CONFIG;
    const all = [...BREATH_PRESETS, ...loadCustomPresets()];
    return all.find((p) => configsEqual(p.config, initial))?.id ?? null;
  });
  const [syncInhaleExhale, setSyncInhaleExhale] = useState<boolean>(
    () => config.inhaleSec === config.exhaleSec
  );

  // Audio & interface preferences (stored locally; no session history or hold records)
  const [audioPrefs, setAudioPrefs] = useState(() => loadAudioPreferences());
  const [interfacePrefs, setInterfacePrefs] = useState(() => loadInterfacePreferences());
  const [osReducedMotion, setOsReducedMotion] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );
  const [audioUpdateCaption, setAudioUpdateCaption] = useState<string | null>(null);
  const [session, setSession] = useState<BreathSessionState>(() => createInitialState(config));
  const [showSafetyModal, setShowSafetyModal] = useState<boolean>(false);
  const [isFocusMode, setIsFocusMode] = useState<boolean>(false);
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);

  // Google Drive Auth & TTS Audio state (initialized synchronously with 45 bundled BREATHFLOW clips)
  const [user, setUser] = useState<User | null>(null);
  const [needsAuth, setNeedsAuth] = useState<boolean>(true);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [isLoadingDrive, setIsLoadingDrive] = useState<boolean>(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string>('Built-in BREATHFLOW Voice Pack');
  const [folderFound, setFolderFound] = useState<boolean>(true);
  const [discoveredFiles, setDiscoveredFiles] = useState<DriveAudioFile[]>(
    () => BUILTIN_AUDIO_FILES
  );
  const [phaseMap, setPhaseMap] = useState<PhaseAudioMap>(() => getBuiltinPhaseMap());
  const [countClips, setCountClips] = useState<Record<number, DriveAudioFile>>({});
  const [loadedClipIds, setLoadedClipIds] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    BUILTIN_AUDIO_FILES.forEach((file) => {
      if (file.localUrl) {
        breathAudio.registerLocalUrl(file.id, file.localUrl);
        initial[file.id] = true;
      }
    });
    const builtinMap = getBuiltinPhaseMap();
    const phaseIds: Partial<Record<VoicePhaseSlot, string>> = {};
    (Object.entries(builtinMap) as [VoicePhaseSlot, DriveAudioFile | undefined][]).forEach(
      ([slot, file]) => {
        if (file) phaseIds[slot] = file.id;
      }
    );
    breathAudio.setPhaseFileIds(phaseIds);
    breathAudio.setVoicePools(getBuiltinVoicePools());
    return initial;
  });
  const [readinessReport, setReadinessReport] = useState<AudioReadinessReport>(() =>
    breathAudio.getReadinessReport()
  );
  const [loadingFileIds, setLoadingFileIds] = useState<Record<string, boolean>>({});
  const [previewingFileId, setPreviewingFileId] = useState<string | null>(null);

  const sessionRef = useRef<BreathSessionState>(session);
  const loadedClipIdsRef = useRef<Record<string, boolean>>(loadedClipIds);
  const emittedUpdatesRef = useRef<Set<string>>(new Set());
  const captionTimerRef = useRef<number | null>(null);
  const soundscapePreviewTimerRef = useRef<number | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    loadedClipIdsRef.current = loadedClipIds;
  }, [loadedClipIds]);

  // Privacy: purge any legacy session history or hold-duration keys on startup
  useEffect(() => {
    purgeLegacySessionHistory();
  }, []);

  // Persist user configuration & preferences locally
  useEffect(() => {
    saveLastConfig(config);
  }, [config]);

  useEffect(() => {
    saveCustomPresets(customPresets);
  }, [customPresets]);

  useEffect(() => {
    saveAudioPreferences(audioPrefs);
    breathAudio.setEnabled(audioPrefs.audioEnabled);
    breathAudio.setMode(audioPrefs.audioMode);
    breathAudio.setNarrationLevel(audioPrefs.narrationLevel);
    breathAudio.setSoundscape(audioPrefs.soundscape);
    breathAudio.setVolumes(audioPrefs.volumes);
    breathAudio.setSpeechFallbackEnabled(audioPrefs.speechFallbackEnabled);
    breathAudio.setProgressUpdatesEnabled(audioPrefs.narrationLevel !== 'minimal');
  }, [audioPrefs]);

  useEffect(() => {
    saveInterfacePreferences(interfacePrefs);
  }, [interfacePrefs]);

  // Listen to system prefers-reduced-motion media query
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setOsReducedMotion(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const refreshReadiness = useCallback(() => {
    setReadinessReport(breathAudio.getReadinessReport());
  }, []);

  const activateBuiltinAudioPack = useCallback(
    async (isCancelled?: () => boolean) => {
      const builtinMap = getBuiltinPhaseMap();
      const pools = getBuiltinVoicePools();

      const readyMap: Record<string, boolean> = {};
      BUILTIN_AUDIO_FILES.forEach((file) => {
        if (file.localUrl) {
          breathAudio.registerLocalUrl(file.id, file.localUrl);
          readyMap[file.id] = true;
        }
      });

      if (isCancelled?.()) return;

      breathAudio.setVoicePools(pools);
      setDiscoveredFiles(BUILTIN_AUDIO_FILES);
      setPhaseMap(builtinMap);
      setCountClips({});
      setSourceLabel('Built-in BREATHFLOW Voice Pack');
      setFolderFound(true);
      loadedClipIdsRef.current = readyMap;
      setLoadedClipIds(readyMap);

      const batchSize = 9;
      for (let i = 0; i < BUILTIN_AUDIO_FILES.length; i += batchSize) {
        if (isCancelled?.()) return;
        const batch = BUILTIN_AUDIO_FILES.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (file) => {
            if (!file.localUrl) return;
            try {
              const res = await fetch(file.localUrl);
              if (res.ok) {
                const buffer = await res.arrayBuffer();
                await breathAudio.registerAudioBuffer(file.id, buffer);
              }
            } catch {
              // Fallback HTMLAudioElement local URL stays available
            }
          })
        );
      }
      if (!isCancelled?.()) refreshReadiness();
    },
    [refreshReadiness]
  );

  // Wire playback error surface and unlock Web Audio on first user interaction
  useEffect(() => {
    breathAudio.setOnPlaybackError((msg) => setDriveError(msg));

    const unlockOnGesture = () => {
      void breathAudio.unlock().then(refreshReadiness);
    };
    window.addEventListener('pointerdown', unlockOnGesture, {
      capture: true,
      passive: true,
      once: true,
    });
    window.addEventListener('keydown', unlockOnGesture, {
      capture: true,
      passive: true,
      once: true,
    });

    return () => {
      breathAudio.setOnPlaybackError(null);
      window.removeEventListener('pointerdown', unlockOnGesture, { capture: true });
      window.removeEventListener('keydown', unlockOnGesture, { capture: true });
    };
  }, [refreshReadiness]);

  // Pre-fetch bundled BREATHFLOW MP3s concurrently while checking IndexedDB for custom Drive clips
  useEffect(() => {
    let cancelled = false;
    let usingCustomDrive = false;

    const prefetchBuiltinBuffers = async () => {
      const batchSize = 9;
      for (let i = 0; i < BUILTIN_AUDIO_FILES.length; i += batchSize) {
        if (cancelled || usingCustomDrive) return;
        const batch = BUILTIN_AUDIO_FILES.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (file) => {
            if (!file.localUrl || cancelled || usingCustomDrive) return;
            try {
              const res = await fetch(file.localUrl);
              if (res.ok && !cancelled && !usingCustomDrive) {
                const buffer = await res.arrayBuffer();
                await breathAudio.registerAudioBuffer(file.id, buffer);
              }
            } catch {
              // Fallback HTMLAudioElement local URL stays available
            }
          })
        );
      }
      if (!cancelled) refreshReadiness();
    };

    void prefetchBuiltinBuffers();

    (async () => {
      const [cachedClips, meta] = await Promise.all([
        loadAllCachedClips(),
        loadVoiceStateMeta(),
      ]);
      if (cancelled) return;

      const hasCustomDriveClips = cachedClips.some(
        (entry) => !entry.file.id.startsWith('builtin:')
      );
      if (!hasCustomDriveClips) {
        return;
      }

      usingCustomDrive = true;
      const loadedMap: Record<string, boolean> = {};
      for (const entry of cachedClips) {
        await breathAudio.registerAudioBuffer(entry.file.id, entry.buffer);
        loadedMap[entry.file.id] = true;
      }

      if (cancelled) return;

      const files =
        meta?.files && meta.files.length > 0
          ? meta.files
          : cachedClips.map((c) => c.file);
      const fileById = new Map(files.map((f) => [f.id, f]));

      const restoredPhaseMap: PhaseAudioMap = {};
      if (meta?.phaseMapIds) {
        (Object.entries(meta.phaseMapIds) as [VoicePhaseSlot, string | undefined][]).forEach(
          ([phase, fileId]) => {
            if (fileId && fileById.has(fileId)) {
              restoredPhaseMap[phase] = fileById.get(fileId);
            }
          }
        );
      }

      const restoredCountClips: Record<number, DriveAudioFile> = {};
      if (meta?.countClipIds) {
        Object.entries(meta.countClipIds).forEach(([numStr, fileId]) => {
          const num = Number.parseInt(numStr, 10);
          if (fileId && fileById.has(fileId)) {
            restoredCountClips[num] = fileById.get(fileId)!;
          }
        });
      }

      setDiscoveredFiles(files);
      setPhaseMap(restoredPhaseMap);
      setCountClips(restoredCountClips);
      setSourceLabel(meta?.sourceLabel || 'Saved Drive Clips');
      setFolderFound(true);
      loadedClipIdsRef.current = loadedMap;
      setLoadedClipIds(loadedMap);
      refreshReadiness();
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshReadiness]);

  // Initialize Firebase Auth listener
  useEffect(() => {
    const unsubscribe = initAuth(
      (authedUser) => {
        setUser(authedUser);
        setNeedsAuth(false);
      },
      (maybeUser) => {
        setUser(maybeUser);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  // Keep BreathAudioEngine synced whenever phaseMap, countClips, discoveredFiles, or loadedClipIds change
  useEffect(() => {
    const phaseIds: Partial<Record<VoicePhaseSlot, string>> = {};
    (Object.entries(phaseMap) as [VoicePhaseSlot, DriveAudioFile | undefined][]).forEach(
      ([slot, file]) => {
        if (file && loadedClipIds[file.id]) {
          phaseIds[slot] = file.id;
        }
      }
    );
    breathAudio.setPhaseFileIds(phaseIds);

    const countIds: Record<number, string> = {};
    Object.entries(countClips).forEach(([numStr, file]) => {
      const num = Number.parseInt(numStr, 10);
      if (file && loadedClipIds[file.id]) {
        countIds[num] = file.id;
      }
    });
    breathAudio.setCountFileIds(countIds);

    const hasBuiltin = discoveredFiles.some((f) => f.id.startsWith('builtin:'));
    if (hasBuiltin) {
      breathAudio.setVoicePools(getBuiltinVoicePools());
    } else {
      const encouragementIds = findEncouragementClips(discoveredFiles)
        .filter((f) => loadedClipIds[f.id])
        .map((f) => f.id);
      breathAudio.setVoicePools({ encouragementIds });
    }
  }, [phaseMap, countClips, discoveredFiles, loadedClipIds]);

  const persistVoiceSnapshot = useCallback(
    async (
      files: DriveAudioFile[],
      nextPhaseMap: PhaseAudioMap,
      nextCountClips: Record<number, DriveAudioFile>,
      nextSourceLabel: string
    ) => {
      const countClipIds: Record<number, string> = {};
      Object.entries(nextCountClips).forEach(([numStr, file]) => {
        countClipIds[Number.parseInt(numStr, 10)] = file.id;
      });
      await saveVoiceStateMeta({
        files,
        phaseMapIds: serializePhaseMapIds(nextPhaseMap),
        countClipIds,
        sourceLabel: nextSourceLabel,
      });
    },
    []
  );

  const handleDriveAuthFailure = useCallback((err: unknown) => {
    if (err instanceof DriveApiError && err.status === 401) {
      clearAccessToken();
      setNeedsAuth(true);
    }
    setDriveError(err instanceof Error ? err.message : 'Unable to load files from Google Drive.');
  }, []);

  const ensureFilesLoaded = useCallback(
    async (files: DriveAudioFile[], tokenOverride?: string): Promise<Record<string, boolean>> => {
      const localToLoad = files.filter((f) => f?.localUrl);
      const remoteToFetch = files.filter((f) => f && !f.localUrl && !breathAudio.hasClipData(f.id));

      const newlyLoaded: Record<string, boolean> = {};
      if (localToLoad.length > 0) {
        await Promise.all(
          localToLoad.map(async (file) => {
            if (!file.localUrl) return;
            breathAudio.registerLocalUrl(file.id, file.localUrl);
            try {
              const res = await fetch(file.localUrl);
              if (res.ok) {
                const buf = await res.arrayBuffer();
                await breathAudio.registerAudioBuffer(file.id, buf);
              }
            } catch {
              // Local URL HTMLAudio fallback stays registered
            }
            newlyLoaded[file.id] = true;
          })
        );
      }

      if (remoteToFetch.length === 0) {
        if (Object.keys(newlyLoaded).length > 0) {
          setLoadedClipIds((prev) => {
            const merged = { ...prev, ...newlyLoaded };
            loadedClipIdsRef.current = merged;
            return merged;
          });
        }
        return { ...loadedClipIdsRef.current, ...newlyLoaded };
      }

      const token = tokenOverride ?? (await getAccessToken());
      if (!token) {
        setNeedsAuth(true);
        return { ...loadedClipIdsRef.current, ...newlyLoaded };
      }

      setLoadingFileIds((prev) => {
        const next = { ...prev };
        remoteToFetch.forEach((f) => {
          next[f.id] = true;
        });
        return next;
      });

      let firstNonAuthError: string | null = null;

      try {
        await Promise.all(
          remoteToFetch.map(async (file) => {
            try {
              const buffer = await fetchDriveAudioBuffer(token, file.id);
              await breathAudio.registerAudioBuffer(file.id, buffer);
              await saveClipToCache(file, buffer);
              newlyLoaded[file.id] = true;
            } catch (err) {
              if (err instanceof DriveApiError && err.status === 401) {
                throw err;
              }
              if (!firstNonAuthError) {
                firstNonAuthError =
                  err instanceof Error ? err.message : `Failed to load ${file.name}`;
              }
            }
          })
        );

        if (Object.keys(newlyLoaded).length > 0) {
          setLoadedClipIds((prev) => {
            const merged = { ...prev, ...newlyLoaded };
            loadedClipIdsRef.current = merged;
            return merged;
          });
        }

        if (firstNonAuthError) {
          setDriveError(firstNonAuthError);
        }
      } catch (err) {
        handleDriveAuthFailure(err);
      } finally {
        setLoadingFileIds((prev) => {
          const next = { ...prev };
          remoteToFetch.forEach((f) => {
            delete next[f.id];
          });
          return next;
        });
      }

      return { ...loadedClipIdsRef.current, ...newlyLoaded };
    },
    [handleDriveAuthFailure]
  );

  const runBreathflowScan = useCallback(
    async (tokenOverride?: string) => {
      const token = tokenOverride ?? (await getAccessToken());
      if (!token) {
        setNeedsAuth(true);
        return;
      }

      setIsLoadingDrive(true);
      setDriveError(null);
      try {
        const discovery = await findBreathflowClips(token);
        setDiscoveredFiles(discovery.files);
        setSourceLabel(discovery.sourceLabel);
        setFolderFound(discovery.folderFound);

        const matched = matchClipsToPhases(discovery.files);
        setPhaseMap(matched.phaseMap);
        setCountClips(matched.countClips);

        await persistVoiceSnapshot(
          discovery.files,
          matched.phaseMap,
          matched.countClips,
          discovery.sourceLabel
        );

        const matchedFiles = [
          ...Object.values(matched.phaseMap).filter((f): f is DriveAudioFile => Boolean(f)),
          ...Object.values(matched.countClips),
        ];
        const preloadSet = new Map<string, DriveAudioFile>();
        matchedFiles.forEach((f) => preloadSet.set(f.id, f));
        discovery.files.slice(0, 20).forEach((f) => preloadSet.set(f.id, f));

        if (preloadSet.size > 0) {
          await ensureFilesLoaded(Array.from(preloadSet.values()), token);
        }
        refreshReadiness();
      } catch (err) {
        handleDriveAuthFailure(err);
      } finally {
        setIsLoadingDrive(false);
      }
    },
    [ensureFilesLoaded, handleDriveAuthFailure, persistVoiceSnapshot, refreshReadiness]
  );

  const handleSignIn = useCallback(async () => {
    await breathAudio.unlock();
    setIsLoggingIn(true);
    setDriveError(null);
    try {
      const { user: signedInUser, accessToken } = await googleSignIn();
      setUser(signedInUser);
      setNeedsAuth(false);
      await runBreathflowScan(accessToken);
    } catch (err) {
      setDriveError(
        err instanceof Error ? err.message : 'Google sign-in was canceled or failed.'
      );
    } finally {
      setIsLoggingIn(false);
    }
  }, [runBreathflowScan]);

  const handleSignOut = useCallback(async () => {
    breathAudio.stopActiveVoice();
    breathAudio.stopPreview();
    setPreviewingFileId(null);
    await logout();
    setUser(null);
    setNeedsAuth(true);
    setDriveError(null);
  }, []);

  const handleClearCachedClips = useCallback(async () => {
    breathAudio.clearAllClips();
    await clearAudioCache();
    setPreviewingFileId(null);
    await activateBuiltinAudioPack();
  }, [activateBuiltinAudioPack]);

  const handleSearchDrive = useCallback(
    async (query: string) => {
      const token = await getAccessToken();
      if (!token) {
        setNeedsAuth(true);
        return;
      }
      setIsLoadingDrive(true);
      setDriveError(null);
      try {
        const files = await searchDriveAudioFiles(token, query);
        setDiscoveredFiles(files);
        const label = query.trim() ? `Search: "${query.trim()}"` : 'All Google Drive MP3s';
        setSourceLabel(label);
        setFolderFound(true);
        await persistVoiceSnapshot(files, phaseMap, countClips, label);
      } catch (err) {
        handleDriveAuthFailure(err);
      } finally {
        setIsLoadingDrive(false);
      }
    },
    [countClips, handleDriveAuthFailure, persistVoiceSnapshot, phaseMap]
  );

  const handleAssignPhaseFile = useCallback(
    async (phase: VoicePhaseSlot, fileId: string) => {
      if (!fileId) {
        const nextMap = { ...phaseMap };
        delete nextMap[phase];
        setPhaseMap(nextMap);
        await persistVoiceSnapshot(discoveredFiles, nextMap, countClips, sourceLabel);
        return;
      }

      const chosen = discoveredFiles.find((f) => f.id === fileId);
      if (!chosen) return;

      const nextMap = { ...phaseMap, [phase]: chosen };
      setPhaseMap(nextMap);
      await persistVoiceSnapshot(discoveredFiles, nextMap, countClips, sourceLabel);
      await ensureFilesLoaded([chosen]);
    },
    [countClips, discoveredFiles, ensureFilesLoaded, persistVoiceSnapshot, phaseMap, sourceLabel]
  );

  const handleAutoMatchAll = useCallback(async () => {
    if (discoveredFiles.length === 0) return;
    const matched = matchClipsToPhases(discoveredFiles);
    setPhaseMap(matched.phaseMap);
    setCountClips(matched.countClips);
    await persistVoiceSnapshot(
      discoveredFiles,
      matched.phaseMap,
      matched.countClips,
      sourceLabel
    );
    const matchedFiles = [
      ...Object.values(matched.phaseMap).filter((f): f is DriveAudioFile => Boolean(f)),
      ...Object.values(matched.countClips),
    ];
    if (matchedFiles.length > 0) {
      await ensureFilesLoaded(matchedFiles);
    }
  }, [discoveredFiles, ensureFilesLoaded, persistVoiceSnapshot, sourceLabel]);

  const handlePreviewFile = useCallback(
    async (file: DriveAudioFile) => {
      setDriveError(null);
      if (file.localUrl) {
        breathAudio.registerLocalUrl(file.id, file.localUrl);
        setPreviewingFileId(file.id);
        try {
          await breathAudio.previewClip(file.id, () => {
            setPreviewingFileId((curr) => (curr === file.id ? null : curr));
          });
        } catch (err) {
          setPreviewingFileId(null);
          setDriveError(
            err instanceof Error
              ? err.message
              : `Audio playback failed for "${file.name}".`
          );
        }
        return;
      }

      await breathAudio.unlock();
      const loaded = await ensureFilesLoaded([file]);
      if (!loaded[file.id]) {
        setDriveError(`Could not download "${file.name}" from Google Drive.`);
        return;
      }
      setPreviewingFileId(file.id);
      try {
        await breathAudio.previewClip(file.id, () => {
          setPreviewingFileId((curr) => (curr === file.id ? null : curr));
        });
      } catch (err) {
        setPreviewingFileId(null);
        setDriveError(
          err instanceof Error
            ? err.message
            : `Audio playback failed for "${file.name}".`
        );
      }
    },
    [ensureFilesLoaded]
  );

  const handleStopPreview = useCallback(() => {
    breathAudio.stopPreview();
    setPreviewingFileId(null);
  }, []);

  const handleRunAudioCheck = useCallback(async () => {
    setDriveError(null);
    try {
      const report = await breathAudio.runAudioReadinessCheck();
      setReadinessReport(report);
    } catch (err) {
      setDriveError(
        err instanceof Error ? err.message : 'Browser audio output is muted or blocked.'
      );
      refreshReadiness();
    }
  }, [refreshReadiness]);

  const handlePlayBriefing = useCallback(async (kind: 'welcome' | 'safety') => {
    setDriveError(null);
    try {
      await breathAudio.playBriefing(kind);
    } catch (err) {
      setDriveError(
        err instanceof Error ? err.message : 'Unable to play briefing audio.'
      );
    }
  }, []);

  const handleChangeAudioMode = useCallback((mode: AudioMode) => {
    setAudioPrefs((prev) => ({ ...prev, audioMode: mode }));
  }, []);

  const handleChangeNarrationLevel = useCallback((narrationLevel: NarrationLevel) => {
    setAudioPrefs((prev) => ({ ...prev, narrationLevel }));
  }, []);

  const clearSoundscapePreviewTimer = useCallback(() => {
    if (soundscapePreviewTimerRef.current !== null) {
      window.clearTimeout(soundscapePreviewTimerRef.current);
      soundscapePreviewTimerRef.current = null;
    }
  }, []);

  const handleChangeSoundscape = useCallback(
    (soundscape: SoundscapeId) => {
      clearSoundscapePreviewTimer();
      setAudioPrefs((prev) => ({ ...prev, soundscape }));
      breathAudio.setSoundscape(soundscape);
    },
    [clearSoundscapePreviewTimer]
  );

  const handlePreviewSoundscape = useCallback(() => {
    clearSoundscapePreviewTimer();
    void breathAudio.previewSoundscapeBriefly();
    soundscapePreviewTimerRef.current = window.setTimeout(() => {
      soundscapePreviewTimerRef.current = null;
      if (
        sessionRef.current.phase === 'idle' ||
        sessionRef.current.phase === 'completed' ||
        sessionRef.current.isPaused
      ) {
        breathAudio.stopAmbient();
      }
    }, 3500);
  }, [clearSoundscapePreviewTimer]);

  const handleChangeVolumes = useCallback((next: Partial<AudioVolumeSettings>) => {
    setAudioPrefs((prev) => ({
      ...prev,
      volumes: {
        ...prev.volumes,
        ...next,
      },
    }));
  }, []);

  const handleToggleSpeechFallback = useCallback(() => {
    setAudioPrefs((prev) => ({ ...prev, speechFallbackEnabled: !prev.speechFallbackEnabled }));
  }, []);

  const handleToggleReducedMotion = useCallback(() => {
    setInterfacePrefs((prev) => ({
      ...prev,
      reducedMotionOverride: !prev.reducedMotionOverride,
    }));
  }, []);

  const handleToggleAutoFocusMode = useCallback(() => {
    setInterfacePrefs((prev) => ({ ...prev, autoFocusMode: !prev.autoFocusMode }));
  }, []);

  const showAudioCaption = useCallback((text: string) => {
    setAudioUpdateCaption(text);
    if (captionTimerRef.current !== null) {
      window.clearTimeout(captionTimerRef.current);
    }
    captionTimerRef.current = window.setTimeout(() => {
      setAudioUpdateCaption(null);
      captionTimerRef.current = null;
    }, 4500);
  }, []);

  useEffect(() => {
    return () => {
      if (captionTimerRef.current !== null) {
        window.clearTimeout(captionTimerRef.current);
      }
      if (soundscapePreviewTimerRef.current !== null) {
        window.clearTimeout(soundscapePreviewTimerRef.current);
      }
    };
  }, []);

  const isRunning = session.phase !== 'idle' && session.phase !== 'completed';

  // Screen Wake Lock & Ambient audio lifecycle synced with active, unpaused sessions
  useEffect(() => {
    const activeUnpaused = isRunning && !session.isPaused;
    breathAudio.setSessionRunning(activeUnpaused);

    if (activeUnpaused) {
      void acquireWakeLock().then((acquired) => {
        setWakeLockActive(acquired);
      });
    } else {
      void releaseWakeLock().then(() => {
        setWakeLockActive(false);
      });
    }
  }, [isRunning, session.isPaused]);

  useEffect(() => {
    return () => {
      void releaseWakeLock();
      breathAudio.setSessionRunning(false);
    };
  }, []);

  // Auto-pause on screen lock, app switching, or audio interruption
  const triggerInterruptionPause = useCallback((reason: InterruptionReason) => {
    const current = sessionRef.current;
    if (current.phase === 'idle' || current.phase === 'completed' || current.isPaused) {
      return;
    }
    breathAudio.stopActiveVoice();
    breathAudio.stopSpeech();
    breathAudio.setSessionRunning(false);
    void releaseWakeLock().then(() => setWakeLockActive(false));

    const paused = pauseForInterruption(current, reason);
    sessionRef.current = paused;
    setSession(paused);
  }, []);

  useEffect(() => {
    breathAudio.setOnAudioInterruption(() => {
      triggerInterruptionPause('audio_interrupted');
    });

    const handleVisibilityChange = () => {
      if (document.hidden) {
        triggerInterruptionPause('backgrounded');
      }
    };

    const handlePageHide = () => {
      triggerInterruptionPause('backgrounded');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      breathAudio.setOnAudioInterruption(null);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [triggerInterruptionPause]);

  // Drift-free wall-clock timing loop for active breathwork session
  useEffect(() => {
    if (!isRunning || session.isPaused) return;

    let rafId = 0;
    let lastWallMs = Date.now();
    let lastUiSyncMs = lastWallMs;

    const advanceStep = () => {
      const now = Date.now();
      const deltaMs = Math.max(0, now - lastWallMs);
      lastWallMs = now;
      if (deltaMs === 0) return;

      const prevState = sessionRef.current;
      const { nextState, transition } = stepSession(prevState, deltaMs);
      sessionRef.current = nextState;

      breathAudio.updateAmbientState(nextState.phase, getPhaseProgress(nextState));

      if (transition) {
        const speechText = getTransitionSpeechText(nextState);
        breathAudio.playPhaseCue(transition.to, transition.breath, speechText, {
          totalBreaths: nextState.config.breathCount,
          currentRound: nextState.currentRound,
          totalRounds: nextState.config.rounds,
          phaseDurationMs: nextState.phaseDurationMs,
        });
        if (
          audioPrefs.narrationLevel !== 'minimal' &&
          audioPrefs.audioEnabled &&
          speechText &&
          speechText !== 'Inhale' &&
          speechText !== 'Exhale'
        ) {
          showAudioCaption(speechText);
        }
        lastUiSyncMs = now;
        setSession(nextState);
      } else {
        const update = evaluateProgressAudioUpdate(
          prevState,
          nextState,
          emittedUpdatesRef.current,
          audioPrefs.narrationLevel
        );
        if (update && audioPrefs.narrationLevel !== 'minimal') {
          breathAudio.playProgressUpdate(update.text, update.tone);
          if (audioPrefs.audioEnabled) {
            showAudioCaption(update.text);
          }
        }
        if (now - lastUiSyncMs >= 100) {
          lastUiSyncMs = now;
          setSession(nextState);
        }
      }
    };

    const tickFrame = () => {
      advanceStep();
      const cur = sessionRef.current;
      if (cur.phase !== 'completed' && cur.phase !== 'idle' && !cur.isPaused) {
        rafId = window.requestAnimationFrame(tickFrame);
      }
    };

    rafId = window.requestAnimationFrame(tickFrame);
    const intervalId = window.setInterval(advanceStep, 250);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearInterval(intervalId);
    };
  }, [isRunning, session.isPaused, audioPrefs.narrationLevel, audioPrefs.audioEnabled, showAudioCaption]);

  const handleRequestStart = useCallback(() => {
    void breathAudio.unlock().then(refreshReadiness);
    setShowSafetyModal(true);
  }, [refreshReadiness]);

  const handleConfirmStart = useCallback(() => {
    setShowSafetyModal(false);
    clearSoundscapePreviewTimer();
    void breathAudio.unlock().then(refreshReadiness);
    breathAudio.stopPreview();
    setPreviewingFileId(null);
    emittedUpdatesRef.current.clear();
    setAudioUpdateCaption(null);

    if (interfacePrefs.autoFocusMode) {
      setIsFocusMode(true);
    }

    const started = startSession(config);
    sessionRef.current = started;
    setSession(started);
    breathAudio.setSessionRunning(true);
    void acquireWakeLock().then(setWakeLockActive);

    breathAudio.playPhaseCue(started.phase, started.currentBreath, getTransitionSpeechText(started), {
      totalBreaths: started.config.breathCount,
      currentRound: started.currentRound,
      totalRounds: started.config.rounds,
      phaseDurationMs: started.phaseDurationMs,
    });
  }, [clearSoundscapePreviewTimer, config, interfacePrefs.autoFocusMode, refreshReadiness]);

  const handleTogglePause = useCallback(() => {
    setSession((prev) => {
      if (prev.phase === 'idle' || prev.phase === 'completed') return prev;
      const nextPaused = !prev.isPaused;
      if (nextPaused) {
        breathAudio.stopActiveVoice();
        breathAudio.stopSpeech();
      }
      const next = nextPaused
        ? { ...prev, isPaused: true }
        : resumeFromPause(prev);
      sessionRef.current = next;
      return next;
    });
  }, []);

  const handleResumeAfterInterruption = useCallback(() => {
    void breathAudio.unlock().then(refreshReadiness);
    const current = sessionRef.current;
    if (current.phase === 'idle' || current.phase === 'completed') return;
    const resumed = resumeFromPause(current);
    sessionRef.current = resumed;
    setSession(resumed);
    breathAudio.setSessionRunning(true);
    void acquireWakeLock().then(setWakeLockActive);
  }, [refreshReadiness]);

  const handleSkipPhase = useCallback(() => {
    setSession((prev) => {
      const next = skipToNextPhase(prev);
      sessionRef.current = next;
      if (next.phase !== prev.phase) {
        const speechText = getTransitionSpeechText(next);
        breathAudio.playPhaseCue(next.phase, next.currentBreath, speechText, {
          totalBreaths: next.config.breathCount,
          currentRound: next.currentRound,
          totalRounds: next.config.rounds,
          phaseDurationMs: next.phaseDurationMs,
        });
        if (
          audioPrefs.narrationLevel !== 'minimal' &&
          audioPrefs.audioEnabled &&
          speechText &&
          speechText !== 'Inhale' &&
          speechText !== 'Exhale'
        ) {
          showAudioCaption(speechText);
        }
      }
      return next;
    });
  }, [audioPrefs.audioEnabled, audioPrefs.narrationLevel, showAudioCaption]);

  const handleTakeRecoveryBreath = useCallback(() => {
    setSession((prev) => {
      if (prev.phase !== 'hold') return prev;
      const next = skipToNextPhase(prev);
      sessionRef.current = next;
      const speechText = getTransitionSpeechText(next);
      breathAudio.playPhaseCue(next.phase, next.currentBreath, speechText, {
        totalBreaths: next.config.breathCount,
        currentRound: next.currentRound,
        totalRounds: next.config.rounds,
        phaseDurationMs: next.phaseDurationMs,
      });
      if (audioPrefs.audioEnabled && speechText) {
        showAudioCaption(speechText);
      }
      return next;
    });
  }, [audioPrefs.audioEnabled, showAudioCaption]);

  const handleEndSession = useCallback(() => {
    breathAudio.stopActiveVoice();
    breathAudio.stopSpeech();
    breathAudio.setSessionRunning(false);
    void releaseWakeLock().then(() => setWakeLockActive(false));
    emittedUpdatesRef.current.clear();
    setAudioUpdateCaption(null);
    void breathAudio.playSafetyStopCue();
    const ended = endSessionEarly(sessionRef.current);
    sessionRef.current = ended;
    setSession(ended);
  }, []);

  const handleBackToSetup = useCallback(() => {
    breathAudio.stopActiveVoice();
    breathAudio.stopSpeech();
    breathAudio.setSessionRunning(false);
    void releaseWakeLock().then(() => setWakeLockActive(false));
    setIsFocusMode(false);
    emittedUpdatesRef.current.clear();
    setAudioUpdateCaption(null);
    const reset = createInitialState(config);
    sessionRef.current = reset;
    setSession(reset);
  }, [config]);

  const handleChangeConfig = useCallback((nextConfig: BreathConfig) => {
    setConfig(nextConfig);
    setActivePresetId(null);
    setSession((prev) => {
      if (prev.phase !== 'idle' && prev.phase !== 'completed') return prev;
      const next = createInitialState(nextConfig);
      sessionRef.current = next;
      return next;
    });
  }, []);

  const handleSelectPreset = useCallback((preset: BreathPreset) => {
    setConfig(preset.config);
    setActivePresetId(preset.id);
    setSyncInhaleExhale(preset.config.inhaleSec === preset.config.exhaleSec);
    setSession((prev) => {
      if (prev.phase !== 'idle' && prev.phase !== 'completed') return prev;
      const next = createInitialState(preset.config);
      sessionRef.current = next;
      return next;
    });
  }, []);

  const handleSaveCustomPreset = useCallback(
    (name: string): boolean => {
      const created = createCustomPreset(name, config);
      if (!created) return false;
      setCustomPresets((prev) => [created, ...prev].slice(0, 12));
      setActivePresetId(created.id);
      return true;
    },
    [config]
  );

  const handleDeleteCustomPreset = useCallback((presetId: string) => {
    setCustomPresets((prev) => prev.filter((p) => p.id !== presetId));
    setActivePresetId((curr) => (curr === presetId ? null : curr));
  }, []);

  const handleToggleAudio = useCallback(() => {
    setAudioPrefs((prev) => {
      const nextEnabled = !prev.audioEnabled;
      if (nextEnabled) {
        void breathAudio.unlock().then(refreshReadiness);
      }
      return { ...prev, audioEnabled: nextEnabled };
    });
  }, [refreshReadiness]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (showSafetyModal) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return;
      }
      if (e.code === 'Escape') {
        if (isFocusMode) {
          e.preventDefault();
          setIsFocusMode(false);
        } else if (isRunning) {
          e.preventDefault();
          handleEndSession();
        }
        return;
      }
      if (tag === 'BUTTON') {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (sessionRef.current.phase === 'idle' || sessionRef.current.phase === 'completed') {
          handleRequestStart();
        } else if (sessionRef.current.isPaused && sessionRef.current.interruptionReason) {
          handleResumeAfterInterruption();
        } else {
          handleTogglePause();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    showSafetyModal,
    handleRequestStart,
    handleResumeAfterInterruption,
    handleTogglePause,
    handleEndSession,
    isFocusMode,
    isRunning,
  ]);

  const primaryHeaderAction = () => {
    if (!isRunning) {
      handleRequestStart();
    } else if (session.isPaused && session.interruptionReason) {
      handleResumeAfterInterruption();
    } else {
      handleTogglePause();
    }
  };

  const activeVoiceClipCount = Object.values(loadedClipIds).filter(Boolean).length;
  const effectiveReducedMotion = osReducedMotion || interfacePrefs.reducedMotionOverride;

  return (
    <div className="min-h-[100dvh] bg-[#0B1117] text-slate-100 flex flex-col">
      {/* Three-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#0B1117]/90 backdrop-blur-md pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8 py-3.5">
          <a
            href="#studio"
            className="font-display text-lg font-semibold tracking-tight text-slate-50 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-400 rounded-sm"
          >
            BREATHFLOW
          </a>

          <nav
            aria-label="Primary"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400"
          >
            <a
              href="#studio"
              className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              Studio
            </a>
            <a
              href="#voice"
              className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              Audio
            </a>
            <a
              href="#guide"
              className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              Guide
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={primaryHeaderAction}
              className="rounded-xl bg-sky-400 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-950 hover:bg-sky-300 transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            >
              {!isRunning ? 'Start Session' : session.isPaused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>
      </header>

      <main
        id="studio"
        className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-10"
      >
        {/* Compact Studio Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-50 text-balance">
              BREATHFLOW Guided Breathwork Studio
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              30 breaths × 3 rounds by default, customizable holds, offline voice guidance, and distraction-free focus mode.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <PWAInstallControl />
            <p className="hidden lg:block font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap">
              Space to {isRunning ? (session.isPaused ? 'resume' : 'pause') : 'start'}
            </p>
          </div>
        </div>

        {/* Two-Zone Interactive Stage + Control Deck */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-7 flex flex-col">
            <BreathVisualizer
              session={session}
              audioEnabled={audioPrefs.audioEnabled}
              voiceClipCount={activeVoiceClipCount}
              audioUpdateCaption={audioUpdateCaption}
              isFocusMode={isFocusMode}
              reducedMotion={effectiveReducedMotion}
              wakeLockActive={wakeLockActive}
              onToggleFocusMode={() => setIsFocusMode((prev) => !prev)}
              onToggleAudio={handleToggleAudio}
              onStart={handleRequestStart}
              onTogglePause={handleTogglePause}
              onResumeAfterInterruption={handleResumeAfterInterruption}
              onTakeRecoveryBreath={handleTakeRecoveryBreath}
              onSkipPhase={handleSkipPhase}
              onEndSession={handleEndSession}
              onBackToSetup={handleBackToSetup}
            />
          </div>

          <div className="lg:col-span-5 flex flex-col">
            <ProtocolControls
              config={config}
              customPresets={customPresets}
              activePresetId={activePresetId}
              locked={isRunning}
              syncInhaleExhale={syncInhaleExhale}
              onToggleSyncInhaleExhale={() => setSyncInhaleExhale((prev) => !prev)}
              onChangeConfig={handleChangeConfig}
              onSelectPreset={handleSelectPreset}
              onSaveCustomPreset={handleSaveCustomPreset}
              onDeleteCustomPreset={handleDeleteCustomPreset}
            />
          </div>
        </div>

        {/* Audio, Narration, Dynamic Soundscapes & Collapsible Advanced Settings */}
        <DriveVoicePanel
          user={user}
          needsAuth={needsAuth}
          isLoggingIn={isLoggingIn}
          isLoadingDrive={isLoadingDrive}
          driveError={driveError}
          sourceLabel={sourceLabel}
          folderFound={folderFound}
          discoveredFiles={discoveredFiles}
          phaseMap={phaseMap}
          countClips={countClips}
          loadedClipIds={loadedClipIds}
          loadingFileIds={loadingFileIds}
          audioMode={audioPrefs.audioMode}
          narrationLevel={audioPrefs.narrationLevel}
          soundscape={audioPrefs.soundscape}
          volumes={audioPrefs.volumes}
          readinessReport={readinessReport}
          speechFallbackEnabled={audioPrefs.speechFallbackEnabled}
          reducedMotionOverride={interfacePrefs.reducedMotionOverride}
          autoFocusMode={interfacePrefs.autoFocusMode}
          previewingFileId={previewingFileId}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
          onScanBreathflow={() => runBreathflowScan()}
          onSearchDrive={handleSearchDrive}
          onAssignPhaseFile={handleAssignPhaseFile}
          onAutoMatchAll={handleAutoMatchAll}
          onChangeAudioMode={handleChangeAudioMode}
          onChangeNarrationLevel={handleChangeNarrationLevel}
          onChangeSoundscape={handleChangeSoundscape}
          onPreviewSoundscape={handlePreviewSoundscape}
          onChangeVolumes={handleChangeVolumes}
          onToggleSpeechFallback={handleToggleSpeechFallback}
          onToggleReducedMotion={handleToggleReducedMotion}
          onToggleAutoFocusMode={handleToggleAutoFocusMode}
          onRunAudioCheck={handleRunAudioCheck}
          onPlayBriefing={handlePlayBriefing}
          onPreviewFile={handlePreviewFile}
          onStopPreview={handleStopPreview}
          onClearCachedClips={handleClearCachedClips}
        />

        <SafetyAndGuide />
      </main>

      <footer className="border-t border-slate-800/80 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>BREATHFLOW Studio</span>
          <span>Preferences stored locally · Zero session or hold history saved</span>
        </div>
      </footer>

      <SafetyReminderModal
        open={showSafetyModal}
        prepCountdownSec={config.prepCountdownSec}
        rounds={config.rounds}
        breathCount={config.breathCount}
        onConfirmStart={handleConfirmStart}
        onPlaySafetyAudio={() => void handlePlayBriefing('safety')}
        onCancel={() => setShowSafetyModal(false)}
      />
    </div>
  );
}
