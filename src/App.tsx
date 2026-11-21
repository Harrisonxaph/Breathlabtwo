/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import { BreathVisualizer } from './components/BreathVisualizer';
import { DriveVoicePanel } from './components/DriveVoicePanel';
import { ProtocolControls } from './components/ProtocolControls';
import { SessionHistoryAndGuide } from './components/SessionHistoryAndGuide';
import {
  BREATH_PRESETS,
  BreathConfig,
  BreathPreset,
  BreathSessionState,
  DEFAULT_CONFIG,
  SessionRecord,
  createInitialState,
  extendHold,
  skipToNextPhase,
  startSession,
  stepSession,
} from './utils/breathEngine';
import { AudioMode, breathAudio } from './utils/breathAudio';
import {
  evaluateProgressAudioUpdate,
  getTransitionSpeechText,
} from './utils/breathCoaching';
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

const HISTORY_STORAGE_KEY = 'cadence.breathwork.history.v1';

function loadHistory(): SessionRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function saveHistory(records: SessionRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(records.slice(0, 20)));
  } catch {
    // Ignore storage quota errors
  }
}

export default function App() {
  const [config, setConfig] = useState<BreathConfig>(DEFAULT_CONFIG);
  const [activePresetId, setActivePresetId] = useState<string | null>(BREATH_PRESETS[0].id);
  const [syncInhaleExhale, setSyncInhaleExhale] = useState<boolean>(true);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
  const [audioMode, setAudioMode] = useState<AudioMode>('voice_and_chimes');
  const [speechFallbackEnabled, setSpeechFallbackEnabled] = useState<boolean>(true);
  const [progressUpdatesEnabled, setProgressUpdatesEnabled] = useState<boolean>(true);
  const [audioUpdateCaption, setAudioUpdateCaption] = useState<string | null>(null);
  const [session, setSession] = useState<BreathSessionState>(() =>
    createInitialState(DEFAULT_CONFIG)
  );
  const [history, setHistory] = useState<SessionRecord[]>(() => loadHistory());

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
  const [loadingFileIds, setLoadingFileIds] = useState<Record<string, boolean>>({});
  const [previewingFileId, setPreviewingFileId] = useState<string | null>(null);

  const sessionRef = useRef<BreathSessionState>(session);
  const recordedCompletionRef = useRef<boolean>(false);
  const loadedClipIdsRef = useRef<Record<string, boolean>>(loadedClipIds);
  const emittedUpdatesRef = useRef<Set<string>>(new Set());
  const captionTimerRef = useRef<number | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    loadedClipIdsRef.current = loadedClipIds;
  }, [loadedClipIds]);

  const activateBuiltinAudioPack = useCallback(async (isCancelled?: () => boolean) => {
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

    // Pre-fetch & decode bundled MP3s in smooth batches so Web Audio playback is zero-latency
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
  }, []);

  // Wire playback error surface and unlock Web Audio on first user interaction
  useEffect(() => {
    breathAudio.setOnPlaybackError((msg) => setDriveError(msg));

    const unlockOnGesture = () => {
      void breathAudio.unlock();
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
  }, []);

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
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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

        // Pre-fetch matched clips (plus up to 20 discovered clips so all phase swaps play instantly)
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
      } catch (err) {
        handleDriveAuthFailure(err);
      } finally {
        setIsLoadingDrive(false);
      }
    },
    [ensureFilesLoaded, handleDriveAuthFailure, persistVoiceSnapshot]
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

  const handleTestAudio = useCallback(async () => {
    setDriveError(null);
    try {
      await breathAudio.testAudioOutput();
    } catch (err) {
      setDriveError(
        err instanceof Error ? err.message : 'Browser audio output is muted or blocked.'
      );
    }
  }, []);

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
    setAudioMode(mode);
    breathAudio.setMode(mode);
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
    };
  }, []);

  const handleToggleSpeechFallback = useCallback(() => {
    setSpeechFallbackEnabled((prev) => {
      const next = !prev;
      breathAudio.setSpeechFallbackEnabled(next);
      return next;
    });
  }, []);

  const handleToggleProgressUpdates = useCallback(() => {
    setProgressUpdatesEnabled((prev) => {
      const next = !prev;
      breathAudio.setProgressUpdatesEnabled(next);
      if (!next) setAudioUpdateCaption(null);
      return next;
    });
  }, []);

  const isRunning = session.phase !== 'idle' && session.phase !== 'completed';

  const recordCompletedSession = useCallback(
    (completed: BreathSessionState) => {
      if (recordedCompletionRef.current) return;
      recordedCompletionRef.current = true;

      const presetName =
        BREATH_PRESETS.find((p) => p.id === activePresetId)?.name ?? 'Custom Cadence';

      const newRecord: SessionRecord = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        presetName,
        breathsPerRound: completed.config.breathCount,
        roundsCompleted: completed.config.rounds,
        totalBreaths: completed.totalBreathsCompleted,
        holdLengthsSec: completed.holdDurationsAchievedSec,
        recoveryHoldSec: completed.config.recoveryHoldSec,
        totalDurationSec: Math.round(completed.totalElapsedMs / 1000),
      };

      setHistory((prev) => {
        const next = [newRecord, ...prev].slice(0, 20);
        saveHistory(next);
        return next;
      });
    },
    [activePresetId]
  );

  // Precision timing loop for active breathwork session
  useEffect(() => {
    if (!isRunning || session.isPaused) return;

    let rafId = 0;
    let lastTime = performance.now();
    let lastUiSyncTime = lastTime;

    const tick = (now: number) => {
      const rawDelta = now - lastTime;
      lastTime = now;
      const deltaMs = Math.min(100, Math.max(0, rawDelta));

      const prevState = sessionRef.current;
      const { nextState, transition } = stepSession(prevState, deltaMs);
      sessionRef.current = nextState;

      if (transition) {
        const speechText = getTransitionSpeechText(nextState);
        breathAudio.playPhaseCue(transition.to, transition.breath, speechText, {
          totalBreaths: nextState.config.breathCount,
          currentRound: nextState.currentRound,
          totalRounds: nextState.config.rounds,
        });
        if (
          progressUpdatesEnabled &&
          audioEnabled &&
          speechText &&
          speechText !== 'Inhale' &&
          speechText !== 'Exhale'
        ) {
          showAudioCaption(speechText);
        }
        if (transition.to === 'completed') {
          recordCompletedSession(nextState);
        }
        lastUiSyncTime = now;
        setSession(nextState);
      } else {
        const update = evaluateProgressAudioUpdate(
          prevState,
          nextState,
          emittedUpdatesRef.current
        );
        if (update) {
          breathAudio.playProgressUpdate(update.text, update.tone);
          if (progressUpdatesEnabled && audioEnabled) {
            showAudioCaption(update.text);
          }
        }
        if (now - lastUiSyncTime >= 100) {
          lastUiSyncTime = now;
          setSession(nextState);
        }
      }

      if (nextState.phase !== 'completed' && nextState.phase !== 'idle' && !nextState.isPaused) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [
    isRunning,
    session.isPaused,
    recordCompletedSession,
    progressUpdatesEnabled,
    audioEnabled,
    showAudioCaption,
  ]);

  const handleStart = useCallback(() => {
    breathAudio.unlock().catch(() => {});
    breathAudio.stopPreview();
    setPreviewingFileId(null);
    recordedCompletionRef.current = false;
    emittedUpdatesRef.current.clear();
    setAudioUpdateCaption(null);
    const started = startSession(config);
    sessionRef.current = started;
    setSession(started);
    breathAudio.playPhaseCue('inhale', 1, getTransitionSpeechText(started), {
      totalBreaths: started.config.breathCount,
      currentRound: started.currentRound,
      totalRounds: started.config.rounds,
    });
  }, [config]);

  const handleTogglePause = useCallback(() => {
    setSession((prev) => {
      if (prev.phase === 'idle' || prev.phase === 'completed') return prev;
      const nextPaused = !prev.isPaused;
      if (nextPaused) {
        breathAudio.stopActiveVoice();
        breathAudio.stopSpeech();
      }
      const next = { ...prev, isPaused: nextPaused };
      sessionRef.current = next;
      return next;
    });
  }, []);

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
        });
        if (
          progressUpdatesEnabled &&
          audioEnabled &&
          speechText &&
          speechText !== 'Inhale' &&
          speechText !== 'Exhale'
        ) {
          showAudioCaption(speechText);
        }
        if (next.phase === 'completed') {
          recordCompletedSession(next);
        }
      }
      return next;
    });
  }, [audioEnabled, progressUpdatesEnabled, recordCompletedSession, showAudioCaption]);

  const handleExtendHold = useCallback(() => {
    setSession((prev) => {
      const next = extendHold(prev, 15);
      sessionRef.current = next;
      // Allow the 10-seconds-remaining update to trigger again after extending hold
      emittedUpdatesRef.current.delete(`r${next.currentRound}-hold-rem-10`);
      if (progressUpdatesEnabled && audioEnabled) {
        const msg = 'Hold extended by 15 seconds.';
        breathAudio.playProgressUpdate(msg, 'milestone');
        showAudioCaption(msg);
      }
      return next;
    });
  }, [audioEnabled, progressUpdatesEnabled, showAudioCaption]);

  const handleReset = useCallback(() => {
    breathAudio.stopActiveVoice();
    breathAudio.stopSpeech();
    recordedCompletionRef.current = false;
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

  const handleToggleAudio = useCallback(() => {
    setAudioEnabled((prev) => {
      const next = !prev;
      breathAudio.setEnabled(next);
      if (next) breathAudio.unlock().catch(() => {});
      return next;
    });
  }, []);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (sessionRef.current.phase === 'idle' || sessionRef.current.phase === 'completed') {
          handleStart();
        } else {
          handleTogglePause();
        }
      } else if (e.code === 'Escape' && isRunning) {
        handleReset();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleStart, handleTogglePause, handleReset, isRunning]);

  const primaryHeaderAction = () => {
    if (!isRunning) {
      handleStart();
    } else {
      handleTogglePause();
    }
  };

  const activeVoiceClipCount = Object.values(loadedClipIds).filter(Boolean).length;

  return (
    <div className="min-h-screen bg-[#0B1117] text-slate-100 flex flex-col">
      {/* Three-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#0B1117]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 lg:px-8 py-3.5">
          <a
            href="#studio"
            className="font-display text-lg font-semibold tracking-tight text-slate-50 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-400 rounded-sm"
          >
            Cadence
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
              Voice
            </a>
            <a
              href="#history"
              className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              History
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
              className="rounded-lg bg-sky-400 px-4 py-2 text-xs sm:text-sm font-semibold text-slate-950 hover:bg-sky-300 transition-colors min-h-[40px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
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
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-50 text-balance">
              Guided Breathwork Studio
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              1–40 rhythmic inhale and exhale cycles followed by an adjustable breath hold and recovery breath.
            </p>
          </div>
          <p className="hidden sm:block font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap">
            Space to {isRunning ? (session.isPaused ? 'resume' : 'pause') : 'start'}
          </p>
        </div>

        {/* Two-Zone Interactive Stage + Control Deck */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-7 flex flex-col">
            <BreathVisualizer
              session={session}
              audioEnabled={audioEnabled}
              voiceClipCount={activeVoiceClipCount}
              audioUpdateCaption={audioUpdateCaption}
              onToggleAudio={handleToggleAudio}
              onStart={handleStart}
              onTogglePause={handleTogglePause}
              onSkipPhase={handleSkipPhase}
              onExtendHold={handleExtendHold}
              onReset={handleReset}
            />
          </div>

          <div className="lg:col-span-5 flex flex-col">
            <ProtocolControls
              config={config}
              activePresetId={activePresetId}
              locked={isRunning}
              syncInhaleExhale={syncInhaleExhale}
              onToggleSyncInhaleExhale={() => setSyncInhaleExhale((prev) => !prev)}
              onChangeConfig={handleChangeConfig}
              onSelectPreset={handleSelectPreset}
            />
          </div>
        </div>

        {/* Google Drive TTS Guided Audio Integration */}
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
          audioMode={audioMode}
          speechFallbackEnabled={speechFallbackEnabled}
          progressUpdatesEnabled={progressUpdatesEnabled}
          previewingFileId={previewingFileId}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
          onScanBreathflow={() => runBreathflowScan()}
          onSearchDrive={handleSearchDrive}
          onAssignPhaseFile={handleAssignPhaseFile}
          onAutoMatchAll={handleAutoMatchAll}
          onChangeAudioMode={handleChangeAudioMode}
          onToggleSpeechFallback={handleToggleSpeechFallback}
          onToggleProgressUpdates={handleToggleProgressUpdates}
          onTestAudio={handleTestAudio}
          onPlayBriefing={handlePlayBriefing}
          onPreviewFile={handlePreviewFile}
          onStopPreview={handleStopPreview}
          onClearCachedClips={handleClearCachedClips}
        />

        <SessionHistoryAndGuide history={history} onClearHistory={handleClearHistory} />
      </main>

      <footer className="border-t border-slate-800/80 py-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>Cadence Breathwork Studio</span>
          <span>Local-only session storage · Google Drive audio read-only</span>
        </div>
      </footer>
    </div>
  );
}
