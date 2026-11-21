import React, { useState } from 'react';
import { User } from 'firebase/auth';
import {
  ChevronDown,
  ChevronUp,
  FolderSearch,
  LogOut,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  Trash2,
  Volume2,
  Waves,
} from 'lucide-react';
import {
  AudioMode,
  AudioReadinessReport,
  AudioVolumeSettings,
  NarrationLevel,
  SoundscapeId,
} from '../utils/breathAudio';
import {
  DriveAudioFile,
  PhaseAudioMap,
  VOICE_PHASE_SLOTS,
  VoicePhaseSlot,
  formatFileSize,
} from '../utils/driveAudioMatcher';

interface DriveVoicePanelProps {
  user: User | null;
  needsAuth: boolean;
  isLoggingIn: boolean;
  isLoadingDrive: boolean;
  driveError: string | null;
  sourceLabel: string;
  folderFound: boolean;
  discoveredFiles: DriveAudioFile[];
  phaseMap: PhaseAudioMap;
  countClips: Record<number, DriveAudioFile>;
  loadedClipIds: Record<string, boolean>;
  loadingFileIds: Record<string, boolean>;
  audioMode: AudioMode;
  narrationLevel: NarrationLevel;
  soundscape: SoundscapeId;
  volumes: AudioVolumeSettings;
  readinessReport: AudioReadinessReport;
  speechFallbackEnabled: boolean;
  reducedMotionOverride: boolean;
  autoFocusMode: boolean;
  previewingFileId: string | null;
  onSignIn: () => void;
  onSignOut: () => void;
  onScanBreathflow: () => void;
  onSearchDrive: (query: string) => void;
  onAssignPhaseFile: (phase: VoicePhaseSlot, fileId: string) => void;
  onAutoMatchAll: () => void;
  onChangeAudioMode: (mode: AudioMode) => void;
  onChangeNarrationLevel: (level: NarrationLevel) => void;
  onChangeSoundscape: (soundscape: SoundscapeId) => void;
  onPreviewSoundscape: () => void;
  onChangeVolumes: (next: Partial<AudioVolumeSettings>) => void;
  onToggleSpeechFallback: () => void;
  onToggleReducedMotion: () => void;
  onToggleAutoFocusMode: () => void;
  onRunAudioCheck: () => void;
  onPlayBriefing: (kind: 'welcome' | 'safety') => void;
  onPreviewFile: (file: DriveAudioFile) => void;
  onStopPreview: () => void;
  onClearCachedClips: () => void;
}

const NARRATION_LEVELS: { id: NarrationLevel; label: string; desc: string }[] = [
  { id: 'minimal', label: 'Minimal', desc: 'Round start, hold entry, recovery & completion only' },
  { id: 'balanced', label: 'Balanced', desc: 'Rhythm opener, halfway, final breaths & gentle hold cues' },
  { id: 'active', label: 'Active', desc: 'Full 45-clip rotation across breaths, holds & encouragement' },
];

const SOUNDSCAPES: { id: SoundscapeId; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'ocean', label: 'Ocean Surf' },
  { id: 'drone', label: 'Harmonic Drone' },
  { id: 'rain', label: 'Night Rain' },
];

export const DriveVoicePanel: React.FC<DriveVoicePanelProps> = ({
  user,
  needsAuth,
  isLoggingIn,
  isLoadingDrive,
  driveError,
  sourceLabel,
  folderFound,
  discoveredFiles,
  phaseMap,
  countClips,
  loadedClipIds,
  loadingFileIds,
  audioMode,
  narrationLevel,
  soundscape,
  volumes,
  readinessReport,
  speechFallbackEnabled,
  reducedMotionOverride,
  autoFocusMode,
  previewingFileId,
  onSignIn,
  onSignOut,
  onScanBreathflow,
  onSearchDrive,
  onAssignPhaseFile,
  onAutoMatchAll,
  onChangeAudioMode,
  onChangeNarrationLevel,
  onChangeSoundscape,
  onPreviewSoundscape,
  onChangeVolumes,
  onToggleSpeechFallback,
  onToggleReducedMotion,
  onToggleAutoFocusMode,
  onRunAudioCheck,
  onPlayBriefing,
  onPreviewFile,
  onStopPreview,
  onClearCachedClips,
}) => {
  const [searchText, setSearchText] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const matchedPhaseCount = Object.values(phaseMap).filter(Boolean).length;
  const loadedCount = Object.values(loadedClipIds).filter(Boolean).length;
  const isBuiltinPackActive = discoveredFiles.some((f) => f.id.startsWith('builtin:'));
  const countClipNumbers = Object.keys(countClips)
    .map((n) => Number.parseInt(n, 10))
    .sort((a, b) => a - b);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchDrive(searchText);
  };

  const contextStatusLabel =
    readinessReport.contextState === 'running'
      ? 'Audio Engine Running'
      : readinessReport.contextState === 'unavailable'
        ? 'Web Audio Unavailable'
        : 'Ready (Tap Check or Start)';

  return (
    <section id="voice" aria-labelledby="voice-heading" className="scroll-mt-20 space-y-5 pt-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h2 id="voice-heading" className="font-display text-2xl font-semibold text-slate-100">
            Audio &amp; Soundscapes
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            45 bundled BREATHFLOW voice clips, synchronized ambient soundscapes, independent volumes, and narration depth.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={onRunAudioCheck}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-xs font-medium text-slate-100 hover:border-sky-400/60 hover:text-white transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            <Volume2 className="w-4 h-4 text-sky-400" aria-hidden="true" />
            <span>Run Audio Check</span>
          </button>

          {isBuiltinPackActive && (
            <>
              <button
                type="button"
                onClick={() => onPlayBriefing('welcome')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/70 px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-slate-700 hover:text-white transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                <Play className="w-3.5 h-3.5 text-sky-400 fill-current" aria-hidden="true" />
                <span>Play Welcome</span>
              </button>
              <button
                type="button"
                onClick={() => onPlayBriefing('safety')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/70 px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-slate-700 hover:text-white transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                <Play className="w-3.5 h-3.5 text-amber-400 fill-current" aria-hidden="true" />
                <span>Safety Briefing</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800/80 bg-[#101822] p-5 sm:p-6 space-y-6">
        {/* Top Controls Grid: Mode, Narration Level, Dynamic Soundscape */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Cue Output Mode
            </p>
            <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-900/90 p-1 border border-slate-800">
              {(
                [
                  { id: 'voice_and_chimes', label: 'Voice + Chime' },
                  { id: 'voice_only', label: 'Voice Only' },
                  { id: 'chimes_only', label: 'Chimes' },
                ] as { id: AudioMode; label: string }[]
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChangeAudioMode(item.id)}
                  aria-pressed={audioMode === item.id}
                  className={`rounded-lg px-2.5 py-2 text-xs font-medium transition-colors min-h-[42px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 ${
                    audioMode === item.id
                      ? 'bg-sky-400 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              Transition chimes resolve before voice speaks so cues never overlap.
            </p>
          </div>

          <div className="space-y-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Narration Level
            </p>
            <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-900/90 p-1 border border-slate-800">
              {NARRATION_LEVELS.map((lvl) => (
                <button
                  key={lvl.id}
                  type="button"
                  onClick={() => onChangeNarrationLevel(lvl.id)}
                  aria-pressed={narrationLevel === lvl.id}
                  className={`rounded-lg px-2.5 py-2 text-xs font-medium transition-colors min-h-[42px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 ${
                    narrationLevel === lvl.id
                      ? 'bg-sky-400 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {lvl.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              {NARRATION_LEVELS.find((l) => l.id === narrationLevel)?.desc}
            </p>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Dynamic Ambient Soundscape
              </p>
              {soundscape !== 'off' && (
                <button
                  type="button"
                  onClick={onPreviewSoundscape}
                  className="inline-flex items-center gap-1 text-xs font-medium text-sky-300 hover:text-sky-200 transition-colors"
                >
                  <Waves className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Preview</span>
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-1.5 rounded-xl bg-slate-900/90 p-1 border border-slate-800">
              {SOUNDSCAPES.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => onChangeSoundscape(sc.id)}
                  aria-pressed={soundscape === sc.id}
                  className={`rounded-lg px-2.5 py-2 text-xs font-medium transition-colors min-h-[42px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 ${
                    soundscape === sc.id
                      ? 'bg-sky-400 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {sc.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              Synthesized offline soundscape swells gently on inhale and settles during holds.
            </p>
          </div>
        </div>

        {/* Independent Volume Sliders */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 border-t border-slate-800/80 pt-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="vol-voice" className="font-medium text-slate-200">
                Voice Volume
              </label>
              <span className="font-mono text-sky-300 tabular-nums">
                {Math.round(volumes.voiceVolume * 100)}%
              </span>
            </div>
            <input
              id="vol-voice"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volumes.voiceVolume}
              onChange={(e) => onChangeVolumes({ voiceVolume: parseFloat(e.target.value) })}
              className="breath-slider w-full"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="vol-chime" className="font-medium text-slate-200">
                Chimes Volume
              </label>
              <span className="font-mono text-sky-300 tabular-nums">
                {Math.round(volumes.chimeVolume * 100)}%
              </span>
            </div>
            <input
              id="vol-chime"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volumes.chimeVolume}
              onChange={(e) => onChangeVolumes({ chimeVolume: parseFloat(e.target.value) })}
              className="breath-slider w-full"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="vol-ambient" className="font-medium text-slate-200">
                Ambient Volume
              </label>
              <span className="font-mono text-sky-300 tabular-nums">
                {Math.round(volumes.ambientVolume * 100)}%
              </span>
            </div>
            <input
              id="vol-ambient"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volumes.ambientVolume}
              onChange={(e) => onChangeVolumes({ ambientVolume: parseFloat(e.target.value) })}
              className="breath-slider w-full"
            />
          </div>
        </div>

        {/* Audio Readiness Check Summary Strip */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-800/80 pt-4 text-xs text-slate-300">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-100">
              <ShieldCheck className="w-4 h-4 text-sky-400" aria-hidden="true" />
              <span>Audio Check:</span>
            </span>
            <span className="text-slate-300">{contextStatusLabel}</span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="font-mono text-sky-300 tabular-nums">
              {readinessReport.bundledClipsCount} bundled clips ({readinessReport.decodedClipsCount} decoded)
            </span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="text-slate-400">
              {readinessReport.speechSynthesisAvailable ? 'Spoken fallback available' : 'Audio chimes fallback ready'}
            </span>
          </div>

          {driveError && (
            <p role="alert" className="text-xs font-medium text-rose-400">
              {driveError}
            </p>
          )}
        </div>

        {/* Collapsible Advanced Settings (Optional Google Drive Import, Accessibility & Clip Mapping) */}
        <div className="border-t border-slate-800/80 pt-4">
          <button
            type="button"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((prev) => !prev)}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-left text-sm font-medium text-slate-200 hover:border-slate-700 hover:text-white transition-colors min-h-[48px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            <div>
              <span>Advanced Settings</span>
              <span className="ml-2 text-xs font-normal text-slate-400">
                Accessibility, focus behavior, optional Google Drive import &amp; 45-clip mapping
              </span>
            </div>
            {advancedOpen ? (
              <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
            )}
          </button>

          {advancedOpen && (
            <div className="mt-5 space-y-6">
              {/* Interface & Fallback Preferences */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-slate-300">
                <label className="inline-flex items-center gap-2.5 cursor-pointer select-none min-h-[36px]">
                  <input
                    type="checkbox"
                    checked={autoFocusMode}
                    onChange={onToggleAutoFocusMode}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-400 focus:ring-sky-400"
                  />
                  <span>Automatically enter Focus Mode when a session starts</span>
                </label>

                <label className="inline-flex items-center gap-2.5 cursor-pointer select-none min-h-[36px]">
                  <input
                    type="checkbox"
                    checked={reducedMotionOverride}
                    onChange={onToggleReducedMotion}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-400 focus:ring-sky-400"
                  />
                  <span>Reduced Motion (calm static breathing ring)</span>
                </label>

                <label className="inline-flex items-center gap-2.5 cursor-pointer select-none min-h-[36px]">
                  <input
                    type="checkbox"
                    checked={speechFallbackEnabled}
                    onChange={onToggleSpeechFallback}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-400 focus:ring-sky-400"
                  />
                  <span>Spoken phase cues fallback when no .mp3 is assigned</span>
                </label>
              </div>

              {/* Optional Google Drive Import */}
              <div className="border-t border-slate-800/80 pt-5 space-y-4">
                {needsAuth ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1 max-w-2xl">
                      <h3 className="font-display text-base font-semibold text-slate-100">
                        {isBuiltinPackActive
                          ? `Optional Google Drive Import (${discoveredFiles.length} built-in clips active)`
                          : `${loadedCount} Drive .mp3 clips cached locally`}
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                        Sign in only if you want to import your own .mp3 recordings from <span className="text-slate-200">ai docs / BREATHFLOW voice clips</span>. Requests read-only Drive file access; tokens stay strictly in memory.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={onSignIn}
                      disabled={isLoggingIn}
                      className="inline-flex items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100 disabled:opacity-60 transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 48 48"
                        className="w-5 h-5 shrink-0"
                        aria-hidden="true"
                      >
                        <path
                          fill="#EA4335"
                          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                        />
                        <path
                          fill="#4285F4"
                          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                        />
                        <path
                          fill="#34A853"
                          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                        />
                      </svg>
                      <span>{isLoggingIn ? 'Signing in...' : 'Sign in with Google'}</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
                          <span className="font-medium text-slate-100">
                            {user?.email ?? user?.displayName ?? 'Google Drive Connected'}
                          </span>
                          <span aria-hidden="true" className="text-slate-600">
                            ·
                          </span>
                          <span className="text-slate-300">
                            {sourceLabel || 'ai docs / BREATHFLOW voice clips'}
                          </span>
                          <span aria-hidden="true" className="text-slate-600">
                            ·
                          </span>
                          <span className="font-mono text-xs text-sky-300 tabular-nums">
                            {discoveredFiles.length} clips · {matchedPhaseCount}/{VOICE_PHASE_SLOTS.length} phases
                          </span>
                        </div>
                        {!folderFound && !isLoadingDrive && discoveredFiles.length > 0 && (
                          <p className="text-xs text-amber-300/90">
                            Exact &ldquo;BREATHFLOW voice clips&rdquo; folder wasn&rsquo;t found; showing .mp3 files from Drive instead.
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={onScanBreathflow}
                          disabled={isLoadingDrive}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-slate-600 hover:bg-slate-800 disabled:opacity-50 transition-colors min-h-[44px]"
                        >
                          <FolderSearch className="w-4 h-4 text-sky-300" aria-hidden="true" />
                          <span>{isLoadingDrive ? 'Scanning Drive...' : 'Scan BREATHFLOW Folder'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={onAutoMatchAll}
                          disabled={isLoadingDrive || discoveredFiles.length === 0}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 px-3.5 py-2 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-slate-100 disabled:opacity-45 transition-colors min-h-[44px]"
                        >
                          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Auto-Match</span>
                        </button>

                        <button
                          type="button"
                          onClick={onSignOut}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-transparent px-3 py-2 text-xs font-medium text-slate-400 hover:border-slate-700 hover:text-slate-200 transition-colors min-h-[44px]"
                        >
                          <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Sign Out</span>
                        </button>
                      </div>
                    </div>

                    <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2.5">
                      <div className="relative flex-1">
                        <label htmlFor="drive-audio-search" className="sr-only">
                          Search Google Drive MP3 files
                        </label>
                        <Search
                          className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          id="drive-audio-search"
                          type="text"
                          value={searchText}
                          onChange={(e) => setSearchText(e.target.value)}
                          placeholder="Search Drive .mp3 files..."
                          className="w-full rounded-xl border border-slate-800 bg-slate-950/70 pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400/70 focus:outline-none min-h-[44px]"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={isLoadingDrive}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px] whitespace-nowrap shrink-0"
                      >
                        <span>Search Drive MP3s</span>
                      </button>
                    </form>
                  </div>
                )}
              </div>

              {/* Phase Clip Mapping */}
              {discoveredFiles.length > 0 && (
                <div className="space-y-5 border-t border-slate-800/80 pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <h3 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                      Phase Clip Mapping
                    </h3>
                    <div className="flex items-center gap-3">
                      {countClipNumbers.length > 0 && (
                        <span className="font-mono text-xs text-sky-300 tabular-nums">
                          +{countClipNumbers.length} numbered clips
                        </span>
                      )}
                      {!isBuiltinPackActive && (
                        <button
                          type="button"
                          onClick={onClearCachedClips}
                          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-300 transition-colors min-h-[36px]"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Restore Built-in Pack</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="divide-y divide-slate-800/70 border-t border-b border-slate-800/70">
                    {VOICE_PHASE_SLOTS.map((slot) => {
                      const assigned = phaseMap[slot.phase];
                      const isLoaded = assigned ? Boolean(loadedClipIds[assigned.id]) : false;
                      const isFetching = assigned ? Boolean(loadingFileIds[assigned.id]) : false;
                      const isPreviewing = assigned ? previewingFileId === assigned.id : false;

                      return (
                        <div
                          key={slot.phase}
                          className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3"
                        >
                          <div className="min-w-0 md:w-5/12">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-slate-100">
                                {slot.label}
                              </span>
                              {assigned && (
                                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                                  {isFetching ? '· Downloading' : isLoaded ? '· Ready' : '· Needs sync'}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-400 truncate">{slot.description}</p>
                          </div>

                          <div className="flex items-center gap-2 md:w-7/12">
                            <label htmlFor={`select-phase-${slot.phase}`} className="sr-only">
                              Select audio clip for {slot.label}
                            </label>
                            <select
                              id={`select-phase-${slot.phase}`}
                              value={assigned?.id ?? ''}
                              onChange={(e) => onAssignPhaseFile(slot.phase, e.target.value)}
                              className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs sm:text-sm text-slate-200 focus:border-sky-400/70 focus:outline-none min-h-[44px]"
                            >
                              <option value="">Default chime / spoken cue</option>
                              {discoveredFiles.map((file) => (
                                <option key={file.id} value={file.id}>
                                  {file.name}
                                  {file.size ? ` (${formatFileSize(file.size)})` : ''}
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              disabled={!assigned || isFetching}
                              onClick={() => {
                                if (!assigned) return;
                                if (isPreviewing) onStopPreview();
                                else onPreviewFile(assigned);
                              }}
                              aria-label={
                                isPreviewing
                                  ? `Stop preview for ${slot.label}`
                                  : `Preview audio clip for ${slot.label}`
                              }
                              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/70 px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-slate-700 hover:text-white disabled:opacity-35 transition-colors min-h-[44px] min-w-[88px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                            >
                              {isPreviewing ? (
                                <>
                                  <Square className="w-3.5 h-3.5 text-sky-400 fill-current" aria-hidden="true" />
                                  <span>Stop</span>
                                </>
                              ) : (
                                <>
                                  <Play className="w-3.5 h-3.5 text-sky-400 fill-current" aria-hidden="true" />
                                  <span>Play</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-2.5">
                    <h4 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                      Voice Clips Library ({discoveredFiles.length})
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
                      {discoveredFiles.map((file) => {
                        const isPreviewing = previewingFileId === file.id;
                        const isFetching = Boolean(loadingFileIds[file.id]);
                        const isLoaded = Boolean(loadedClipIds[file.id]);
                        return (
                          <div
                            key={file.id}
                            className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-950/40 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-slate-200 truncate">
                                {file.name}
                              </p>
                              <p className="font-mono text-[11px] text-slate-500 tabular-nums truncate">
                                {file.folderPath ?? 'Audio'}
                                {file.size ? ` · ${formatFileSize(file.size)}` : ''}
                                {isLoaded ? ' · Ready' : ''}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={isFetching || (!isLoaded && needsAuth)}
                              onClick={() =>
                                isPreviewing ? onStopPreview() : onPreviewFile(file)
                              }
                              aria-label={
                                isPreviewing ? `Stop ${file.name}` : `Play ${file.name}`
                              }
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:text-white disabled:opacity-40 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
                            >
                              {isPreviewing ? (
                                <Square className="w-3.5 h-3.5 text-sky-400 fill-current" aria-hidden="true" />
                              ) : (
                                <Volume2 className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
