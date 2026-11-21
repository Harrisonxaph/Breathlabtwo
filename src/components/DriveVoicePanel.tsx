import React, { useState } from 'react';
import { User } from 'firebase/auth';
import {
  FolderSearch,
  LogOut,
  Play,
  RefreshCw,
  Search,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import { AudioMode } from '../utils/breathAudio';
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
  speechFallbackEnabled: boolean;
  progressUpdatesEnabled: boolean;
  previewingFileId: string | null;
  onSignIn: () => void;
  onSignOut: () => void;
  onScanBreathflow: () => void;
  onSearchDrive: (query: string) => void;
  onAssignPhaseFile: (phase: VoicePhaseSlot, fileId: string) => void;
  onAutoMatchAll: () => void;
  onChangeAudioMode: (mode: AudioMode) => void;
  onToggleSpeechFallback: () => void;
  onToggleProgressUpdates: () => void;
  onTestAudio: () => void;
  onPlayBriefing: (kind: 'welcome' | 'safety') => void;
  onPreviewFile: (file: DriveAudioFile) => void;
  onStopPreview: () => void;
  onClearCachedClips: () => void;
}

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
  speechFallbackEnabled,
  progressUpdatesEnabled,
  previewingFileId,
  onSignIn,
  onSignOut,
  onScanBreathflow,
  onSearchDrive,
  onAssignPhaseFile,
  onAutoMatchAll,
  onChangeAudioMode,
  onToggleSpeechFallback,
  onToggleProgressUpdates,
  onTestAudio,
  onPlayBriefing,
  onPreviewFile,
  onStopPreview,
  onClearCachedClips,
}) => {
  const [searchText, setSearchText] = useState('');

  const matchedPhaseCount = Object.values(phaseMap).filter(Boolean).length;
  const loadedCount = Object.values(loadedClipIds).filter(Boolean).length;
  const isBuiltinPackActive = discoveredFiles.some((f) => f.id.startsWith('builtin:'));
  const countClipNumbers = Object.keys(countClips)
    .map((n) => Number.parseInt(n, 10))
    .sort((a, b) => a - b);

  const hasSavedOrDiscoveredFiles = discoveredFiles.length > 0;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchDrive(searchText);
  };

  return (
    <section id="voice" aria-labelledby="voice-heading" className="scroll-mt-20 space-y-5 pt-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h2 id="voice-heading" className="font-display text-2xl font-semibold text-slate-100">
            Guided Voice Audio
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            45 bundled <span className="text-slate-200">BREATHFLOW</span> voice clips (inhale, exhale, retention, encouragement, recovery &amp; safety) with optional Google Drive import.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={onTestAudio}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-700 hover:text-white transition-colors min-h-[38px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            <Volume2 className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
            <span>Test Audio</span>
          </button>

          {isBuiltinPackActive && (
            <>
              <button
                type="button"
                onClick={() => onPlayBriefing('welcome')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-700 hover:text-white transition-colors min-h-[38px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                <Play className="w-3 h-3 text-sky-400 fill-current" aria-hidden="true" />
                <span>Play Welcome</span>
              </button>
              <button
                type="button"
                onClick={() => onPlayBriefing('safety')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-700 hover:text-white transition-colors min-h-[38px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                <Play className="w-3 h-3 text-amber-400 fill-current" aria-hidden="true" />
                <span>Safety Briefing</span>
              </button>
            </>
          )}

          <div className="inline-flex items-center gap-1 rounded-lg bg-slate-900/90 p-1 border border-slate-800">
            {(
              [
                { id: 'voice_and_chimes', label: 'Voice + Chimes' },
                { id: 'voice_only', label: 'Voice Only' },
                { id: 'chimes_only', label: 'Chimes Only' },
              ] as { id: AudioMode; label: string }[]
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeAudioMode(item.id)}
                aria-pressed={audioMode === item.id}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors min-h-[36px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 ${
                  audioMode === item.id
                    ? 'bg-sky-400 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800/80 bg-[#101822] p-5 sm:p-6 space-y-6">
        {/* Auth Banner when not yet connected OR when Drive token needs refresh */}
        {needsAuth && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5 pb-5 border-b border-slate-800/80">
            <div className="space-y-1.5 max-w-2xl">
              <h3 className="font-display text-base font-semibold text-slate-100">
                {isBuiltinPackActive
                  ? `Built-in BREATHFLOW Voice Pack ready (${discoveredFiles.length} .mp3 clips)`
                  : loadedCount > 0
                    ? `${loadedCount} Drive .mp3 clips saved in this browser`
                    : user
                      ? `Reconnect Google Drive (${user.email ?? 'Signed in'})`
                      : 'No Drive .mp3 files imported yet'}
              </h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                {isBuiltinPackActive
                  ? 'All 45 studio voice clips are bundled directly in the app with automatic rotation across inhales, exhales, holds, encouraging updates, and recovery. Optionally sign in with Google to import custom Drive clips.'
                  : loadedCount > 0
                    ? 'Your previously imported BREATHFLOW clips are cached locally and ready to play. Sign in with Google if you want to re-scan or add more .mp3 files from Drive.'
                    : 'Sign in with Google to import your .mp3 clips from ai docs / BREATHFLOW voice clips directly into the app.'}
              </p>
              {driveError && (
                <p role="alert" className="text-xs font-medium text-rose-400 pt-1">
                  {driveError}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={onSignIn}
              disabled={isLoggingIn}
              className="inline-flex items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100 active:bg-slate-200 disabled:opacity-60 transition-colors min-h-[44px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
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
        )}

        {/* Connected Toolbar (when signed in with active token) */}
        {!needsAuth && (
          <div className="space-y-4 pb-5 border-b border-slate-800/80">
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
                    {discoveredFiles.length} {discoveredFiles.length === 1 ? 'clip' : 'clips'} ·{' '}
                    {matchedPhaseCount}/{VOICE_PHASE_SLOTS.length} phases matched
                  </span>
                </div>
                {!folderFound && !isLoadingDrive && discoveredFiles.length > 0 && (
                  <p className="text-xs text-amber-300/90">
                    Exact &ldquo;BREATHFLOW voice clips&rdquo; folder wasn&rsquo;t found; showing .mp3 files from your Google Drive instead.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={onScanBreathflow}
                  disabled={isLoadingDrive}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/70 px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-slate-600 hover:bg-slate-800 disabled:opacity-50 transition-colors min-h-[40px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                >
                  <FolderSearch className="w-4 h-4 text-sky-300" aria-hidden="true" />
                  <span>{isLoadingDrive ? 'Scanning Drive...' : 'Scan BREATHFLOW Folder'}</span>
                </button>

                <button
                  type="button"
                  onClick={onAutoMatchAll}
                  disabled={isLoadingDrive || discoveredFiles.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/50 px-3.5 py-2 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-slate-100 disabled:opacity-45 transition-colors min-h-[40px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Auto-Match</span>
                </button>

                <button
                  type="button"
                  onClick={onSignOut}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-transparent px-3 py-2 text-xs font-medium text-slate-400 hover:border-slate-700 hover:text-slate-200 transition-colors min-h-[40px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>

            {/* Search bar across Drive MP3s */}
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
                  placeholder="Search all Drive .mp3 files by filename (e.g. inhale, hold, breathflow)..."
                  className="w-full rounded-lg border border-slate-800 bg-slate-950/70 pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400/70 focus:outline-none min-h-[42px]"
                />
              </div>
              <button
                type="submit"
                disabled={isLoadingDrive}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[42px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                <span>Search Drive MP3s</span>
              </button>
            </form>

            {driveError && (
              <p role="alert" className="text-xs font-medium text-rose-400">
                {driveError}
              </p>
            )}
          </div>
        )}

        {/* Always-accessible Voice & Encouragement Preferences */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 text-xs text-slate-300">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={speechFallbackEnabled}
              onChange={onToggleSpeechFallback}
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-400 focus:ring-sky-400"
            />
            <span>Spoken phase cues fallback when no .mp3 is assigned</span>
          </label>

          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={progressUpdatesEnabled}
              onChange={onToggleProgressUpdates}
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-400 focus:ring-sky-400"
            />
            <span>Encouraging voice &amp; milestone audio updates (hold intervals &amp; breath progress)</span>
          </label>
        </div>

        {/* Phase Mapping & Loaded Clips (visible whenever clips are cached or discovered) */}
        {hasSavedOrDiscoveredFiles ? (
          <div className="space-y-6">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
                <h3 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                  Phase Clip Mapping
                </h3>
                <div className="flex items-center gap-3">
                  {countClipNumbers.length > 0 && (
                    <span className="font-mono text-xs text-sky-300 tabular-nums">
                      +{countClipNumbers.length} numbered count clips ({countClipNumbers[0]}–{countClipNumbers[countClipNumbers.length - 1]})
                    </span>
                  )}
                  {!isBuiltinPackActive && (
                    <button
                      type="button"
                      onClick={onClearCachedClips}
                      className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-300 transition-colors"
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
                              {isFetching
                                ? '· Downloading...'
                                : isLoaded
                                  ? '· Ready'
                                  : '· Needs sync'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 truncate">
                          {slot.description}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 md:w-7/12">
                        <label htmlFor={`select-phase-${slot.phase}`} className="sr-only">
                          Select audio clip for {slot.label}
                        </label>
                        <select
                          id={`select-phase-${slot.phase}`}
                          value={assigned?.id ?? ''}
                          onChange={(e) => onAssignPhaseFile(slot.phase, e.target.value)}
                          className="w-full rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs sm:text-sm text-slate-200 focus:border-sky-400/70 focus:outline-none min-h-[40px]"
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
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-700 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed transition-colors min-h-[40px] min-w-[84px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
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
            </div>

            {/* Discovered Files Strip */}
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                Imported Drive Audio Files ({discoveredFiles.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
                {discoveredFiles.map((file) => {
                  const isPreviewing = previewingFileId === file.id;
                  const isFetching = Boolean(loadingFileIds[file.id]);
                  const isLoaded = Boolean(loadedClipIds[file.id]);
                  return (
                    <div
                      key={file.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-200 truncate">
                          {file.name}
                        </p>
                        <p className="font-mono text-[11px] text-slate-500 tabular-nums truncate">
                          {file.folderPath ?? 'Drive'}
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
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:text-white disabled:opacity-40 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
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
        ) : (
          !needsAuth &&
          !isLoadingDrive && (
            <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 px-5 py-7 text-center space-y-2">
              <p className="text-sm font-medium text-slate-200">
                No .mp3 audio files found in that search
              </p>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Check that your .mp3 clips are in <span className="text-slate-200">ai docs / BREATHFLOW voice clips</span> or try searching all Drive .mp3 files above.
              </p>
            </div>
          )
        )}
      </div>
    </section>
  );
};
