import { BreathPhase } from './breathEngine';
import { VoicePhaseSlot } from './driveAudioMatcher';

export type AudioMode = 'voice_and_chimes' | 'voice_only' | 'chimes_only';

function getSpeechCueText(phase: BreathPhase, breathNumber?: number): string {
  switch (phase) {
    case 'inhale':
      return breathNumber === 1 ? 'Inhale' : 'Inhale';
    case 'exhale':
      return 'Exhale';
    case 'hold':
      return 'Hold your breath';
    case 'recovery_inhale':
      return 'Deep recovery breath in';
    case 'recovery_hold':
      return 'Hold';
    case 'recovery_exhale':
      return 'Release slowly';
    case 'completed':
      return 'Session complete';
    case 'idle':
    default:
      return '';
  }
}

class BreathAudioEngine {
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private enabled = true;
  private mode: AudioMode = 'voice_and_chimes';
  private speechFallbackEnabled = true;
  private progressUpdatesEnabled = true;
  private onPlaybackError: ((message: string) => void) | null = null;

  // Raw ArrayBuffers, decoded AudioBuffers, typed Blob URLs, and bundled local URLs keyed by file ID
  private rawBuffers = new Map<string, ArrayBuffer>();
  private decodedBuffers = new Map<string, AudioBuffer>();
  private decodingInFlight = new Set<string>();
  private fallbackBlobUrls = new Map<string, string>();
  private localUrls = new Map<string, string>();

  private phaseFileIds: Partial<Record<VoicePhaseSlot, string>> = {};
  private countFileIds: Record<number, string> = {};
  private inhalePoolIds: string[] = [];
  private exhalePoolIds: string[] = [];
  private holdPoolIds: string[] = [];
  private roundLastIds: string[] = [];
  private nextRoundIds: string[] = [];
  private completedIds: string[] = [];
  private welcomeIds: string[] = [];
  private safetyIds: string[] = [];
  private encouragementFileIds: string[] = [];
  private encouragementCursor = 0;
  private completedCursor = 0;
  private holdCursor = 0;
  private protectedUntilMs = 0;

  private activeSource: AudioBufferSourceNode | null = null;
  private activeHtmlAudio: HTMLAudioElement | null = null;
  private previewSource: AudioBufferSourceNode | null = null;
  private previewHtmlAudio: HTMLAudioElement | null = null;
  private sequenceCancelled = false;

  public setOnPlaybackError(cb: ((message: string) => void) | null): void {
    this.onPlaybackError = cb;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stopActiveVoice();
      this.stopPreview();
      this.stopSpeech();
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setMode(mode: AudioMode): void {
    this.mode = mode;
    if (mode === 'chimes_only') {
      this.stopActiveVoice();
      this.stopSpeech();
    }
  }

  public getMode(): AudioMode {
    return this.mode;
  }

  public setSpeechFallbackEnabled(enabled: boolean): void {
    this.speechFallbackEnabled = enabled;
    if (!enabled) {
      this.stopSpeech();
    }
  }

  public setProgressUpdatesEnabled(enabled: boolean): void {
    this.progressUpdatesEnabled = enabled;
  }

  public setPhaseFileIds(map: Partial<Record<VoicePhaseSlot, string>>): void {
    this.phaseFileIds = { ...map };
  }

  public setCountFileIds(map: Record<number, string>): void {
    this.countFileIds = { ...map };
  }

  public setEncouragementFileIds(ids: string[]): void {
    this.encouragementFileIds = ids.slice();
    this.encouragementCursor = 0;
  }

  public setVoicePools(pools: {
    inhaleIds?: string[];
    exhaleIds?: string[];
    holdIds?: string[];
    roundLastIds?: string[];
    nextRoundIds?: string[];
    completedIds?: string[];
    welcomeIds?: string[];
    safetyIds?: string[];
    encouragementIds?: string[];
  }): void {
    this.inhalePoolIds = (pools.inhaleIds ?? []).slice();
    this.exhalePoolIds = (pools.exhaleIds ?? []).slice();
    this.holdPoolIds = (pools.holdIds ?? []).slice();
    this.roundLastIds = (pools.roundLastIds ?? []).slice();
    this.nextRoundIds = (pools.nextRoundIds ?? []).slice();
    this.completedIds = (pools.completedIds ?? []).slice();
    this.welcomeIds = (pools.welcomeIds ?? []).slice();
    this.safetyIds = (pools.safetyIds ?? []).slice();
    if (pools.encouragementIds) {
      this.encouragementFileIds = pools.encouragementIds.slice();
    }
    this.encouragementCursor = 0;
    this.completedCursor = 0;
    this.holdCursor = 0;
  }

  public registerLocalUrl(fileId: string, url: string): void {
    this.localUrls.set(fileId, url);
  }

  public hasClipData(fileId: string): boolean {
    return (
      this.decodedBuffers.has(fileId) ||
      this.rawBuffers.has(fileId) ||
      this.fallbackBlobUrls.has(fileId) ||
      this.localUrls.has(fileId)
    );
  }

  public async registerAudioBuffer(fileId: string, buffer: ArrayBuffer): Promise<void> {
    const copy = buffer.slice(0);
    this.rawBuffers.set(fileId, copy);

    if (!this.fallbackBlobUrls.has(fileId) && typeof URL !== 'undefined') {
      const blob = new Blob([copy], { type: 'audio/mpeg' });
      this.fallbackBlobUrls.set(fileId, URL.createObjectURL(blob));
    }

    // Only decode immediately if AudioContext was already unlocked by a user gesture.
    // Creating AudioContext before a user gesture forces Chrome/Safari into suspended mode.
    if (this.ctx) {
      await this.decodeIntoContext(fileId, copy, this.ctx);
    }
  }

  private async decodeIntoContext(
    fileId: string,
    raw: ArrayBuffer,
    ctx: AudioContext
  ): Promise<AudioBuffer | null> {
    const existing = this.decodedBuffers.get(fileId);
    if (existing) return existing;
    if (this.decodingInFlight.has(fileId)) return null;

    this.decodingInFlight.add(fileId);
    try {
      const decoded = await ctx.decodeAudioData(raw.slice(0));
      this.decodedBuffers.set(fileId, decoded);
      return decoded;
    } catch {
      return null;
    } finally {
      this.decodingInFlight.delete(fileId);
    }
  }

  private decodeAllPendingBuffers(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.rawBuffers.forEach((raw, fileId) => {
      if (!this.decodedBuffers.has(fileId) && !this.decodingInFlight.has(fileId)) {
        void this.decodeIntoContext(fileId, raw, ctx);
      }
    });
  }

  public clearAllClips(): void {
    this.stopActiveVoice();
    this.stopPreview();
    this.decodedBuffers.clear();
    this.decodingInFlight.clear();
    this.rawBuffers.clear();
    this.fallbackBlobUrls.forEach((url) => {
      if (typeof URL !== 'undefined') URL.revokeObjectURL(url);
    });
    this.fallbackBlobUrls.clear();
    this.localUrls.clear();
    this.phaseFileIds = {};
    this.countFileIds = {};
    this.inhalePoolIds = [];
    this.exhalePoolIds = [];
    this.holdPoolIds = [];
    this.roundLastIds = [];
    this.nextRoundIds = [];
    this.completedIds = [];
    this.welcomeIds = [];
    this.safetyIds = [];
    this.encouragementFileIds = [];
    this.encouragementCursor = 0;
    this.completedCursor = 0;
    this.holdCursor = 0;
    this.protectedUntilMs = 0;
  }

  private getOrCreateContextOnGesture(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
      } catch {
        return null;
      }
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }

    return this.ctx;
  }

  private getDestinationNode(ctx: AudioContext): AudioNode {
    if (!this.compressor || this.compressor.context !== ctx) {
      try {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-12, ctx.currentTime);
        comp.knee.setValueAtTime(18, ctx.currentTime);
        comp.ratio.setValueAtTime(4, ctx.currentTime);
        comp.attack.setValueAtTime(0.004, ctx.currentTime);
        comp.release.setValueAtTime(0.15, ctx.currentTime);
        comp.connect(ctx.destination);
        this.compressor = comp;
      } catch {
        return ctx.destination;
      }
    }
    return this.compressor;
  }

  public async unlock(): Promise<void> {
    const ctx = this.getOrCreateContextOnGesture();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Ignore; HTMLAudioElement remains available
      }
    }

    this.decodeAllPendingBuffers();
  }

  private async ensureDecodedBuffer(fileId: string): Promise<AudioBuffer | null> {
    const existing = this.decodedBuffers.get(fileId);
    if (existing) return existing;

    let raw = this.rawBuffers.get(fileId);
    if (!raw) {
      const localUrl = this.localUrls.get(fileId);
      if (localUrl && typeof fetch !== 'undefined') {
        try {
          const res = await fetch(localUrl);
          if (res.ok) {
            raw = await res.arrayBuffer();
            this.rawBuffers.set(fileId, raw.slice(0));
            if (!this.fallbackBlobUrls.has(fileId) && typeof URL !== 'undefined') {
              this.fallbackBlobUrls.set(
                fileId,
                URL.createObjectURL(new Blob([raw], { type: 'audio/mpeg' }))
              );
            }
          }
        } catch {
          // Fall back to direct URL Audio element
        }
      }
    }

    const ctx = this.getOrCreateContextOnGesture();
    if (!raw || !ctx) return null;

    return this.decodeIntoContext(fileId, raw, ctx);
  }

  public stopActiveVoice(): void {
    if (this.activeSource) {
      try {
        this.activeSource.stop();
        this.activeSource.disconnect();
      } catch {
        // Ignore already-stopped nodes
      }
      this.activeSource = null;
    }
    if (this.activeHtmlAudio) {
      try {
        this.activeHtmlAudio.pause();
        this.activeHtmlAudio.currentTime = 0;
      } catch {
        // Ignore
      }
      this.activeHtmlAudio = null;
    }
  }

  public stopPreview(): void {
    this.sequenceCancelled = true;
    if (this.previewSource) {
      try {
        this.previewSource.stop();
        this.previewSource.disconnect();
      } catch {
        // Ignore
      }
      this.previewSource = null;
    }
    if (this.previewHtmlAudio) {
      try {
        this.previewHtmlAudio.pause();
        this.previewHtmlAudio.currentTime = 0;
      } catch {
        // Ignore
      }
      this.previewHtmlAudio = null;
    }
  }

  public stopSpeech(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
  }

  private getPlaybackUrl(fileId: string): string | undefined {
    // Prefer direct local static URL when present for instant streaming in HTMLAudioElement
    return this.localUrls.get(fileId) ?? this.fallbackBlobUrls.get(fileId);
  }

  public async previewClip(fileId: string, onEnded?: () => void): Promise<void> {
    this.stopPreview();
    this.stopActiveVoice();
    this.stopSpeech();

    const ctx = this.getOrCreateContextOnGesture();
    const decodedSync = this.decodedBuffers.get(fileId);

    // Fast synchronous Web Audio path when already decoded and running
    if (ctx && ctx.state === 'running' && decodedSync) {
      this.startPreviewWebAudio(ctx, decodedSync, onEnded);
      return;
    }

    // Synchronous HTMLAudioElement path right inside the click handler for instant gesture-safe playback
    const directUrl = this.getPlaybackUrl(fileId);
    if (directUrl && typeof Audio !== 'undefined') {
      void this.unlock();
      await this.playPreviewHtmlAudio(directUrl, onEnded);
      return;
    }

    await this.unlock();
    const decoded = await this.ensureDecodedBuffer(fileId);
    const activeCtx = this.getOrCreateContextOnGesture();
    if (activeCtx && decoded) {
      this.startPreviewWebAudio(activeCtx, decoded, onEnded);
      return;
    }

    throw new Error('Audio clip could not be decoded for playback in this browser.');
  }

  private startPreviewWebAudio(
    ctx: AudioContext,
    decoded: AudioBuffer,
    onEnded?: () => void
  ): void {
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1.4, ctx.currentTime);
    src.buffer = decoded;
    src.connect(gain);
    gain.connect(this.getDestinationNode(ctx));
    src.onended = () => {
      if (this.previewSource === src) {
        this.previewSource = null;
      }
      onEnded?.();
    };
    this.previewSource = src;
    src.start(0);
  }

  private async playPreviewHtmlAudio(url: string, onEnded?: () => void): Promise<void> {
    const audio = new Audio(url);
    audio.volume = 1.0;
    this.previewHtmlAudio = audio;
    audio.addEventListener('ended', () => {
      if (this.previewHtmlAudio === audio) this.previewHtmlAudio = null;
      onEnded?.();
    });
    audio.addEventListener('error', () => {
      if (this.previewHtmlAudio === audio) this.previewHtmlAudio = null;
      onEnded?.();
    });
    try {
      await audio.play();
    } catch (err) {
      if (this.previewHtmlAudio === audio) this.previewHtmlAudio = null;
      const msg =
        err instanceof Error
          ? err.message
          : 'Audio playback was blocked by your browser.';
      this.onPlaybackError?.(msg);
      throw err;
    }
  }

  public async playBriefing(kind: 'welcome' | 'safety', onEnded?: () => void): Promise<void> {
    const ids = kind === 'welcome' ? this.welcomeIds : this.safetyIds;
    if (ids.length === 0) {
      onEnded?.();
      return;
    }

    this.stopPreview();
    this.stopActiveVoice();
    this.stopSpeech();
    this.sequenceCancelled = false;

    const playAt = async (idx: number): Promise<void> => {
      if (this.sequenceCancelled || idx >= ids.length) {
        onEnded?.();
        return;
      }
      await this.previewClipSingle(ids[idx], () => {
        if (!this.sequenceCancelled) {
          void playAt(idx + 1);
        }
      });
    };

    await playAt(0);
  }

  private async previewClipSingle(fileId: string, onEnded?: () => void): Promise<void> {
    const ctx = this.getOrCreateContextOnGesture();
    const decodedSync = this.decodedBuffers.get(fileId);
    if (ctx && ctx.state === 'running' && decodedSync) {
      this.startPreviewWebAudio(ctx, decodedSync, onEnded);
      return;
    }

    const directUrl = this.getPlaybackUrl(fileId);
    if (directUrl && typeof Audio !== 'undefined') {
      void this.unlock();
      await this.playPreviewHtmlAudio(directUrl, onEnded);
      return;
    }

    await this.unlock();
    const decoded = await this.ensureDecodedBuffer(fileId);
    const activeCtx = this.getOrCreateContextOnGesture();
    if (activeCtx && decoded) {
      this.startPreviewWebAudio(activeCtx, decoded, onEnded);
      return;
    }
    onEnded?.();
  }

  public async testAudioOutput(): Promise<void> {
    await this.unlock();
    const ctx = this.getOrCreateContextOnGesture();
    if (!ctx) {
      throw new Error('Web Audio is unavailable in this browser.');
    }

    const now = ctx.currentTime;
    this.playBellChime(ctx, 440, 0.9, 0.24, now);
    this.playBellChime(ctx, 554.37, 1.1, 0.18, now + 0.14);

    if (this.mode !== 'chimes_only') {
      const welcomeClip = this.welcomeIds[0] ?? this.phaseFileIds.inhale;
      if (welcomeClip && this.hasClipData(welcomeClip)) {
        const decoded = await this.ensureDecodedBuffer(welcomeClip);
        if (decoded && ctx.state === 'running') {
          this.stopActiveVoice();
          const src = ctx.createBufferSource();
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(1.4, ctx.currentTime);
          src.buffer = decoded;
          src.connect(gain);
          gain.connect(this.getDestinationNode(ctx));
          src.onended = () => {
            if (this.activeSource === src) this.activeSource = null;
          };
          this.activeSource = src;
          src.start(ctx.currentTime + 0.22);
          return;
        }

        const directUrl = this.getPlaybackUrl(welcomeClip);
        if (directUrl && typeof Audio !== 'undefined') {
          await this.playPreviewHtmlAudio(directUrl);
          return;
        }
      }

      if (
        this.speechFallbackEnabled &&
        typeof window !== 'undefined' &&
        'speechSynthesis' in window
      ) {
        this.speakText("Audio ready. Let's breathe together.");
      }
    }
  }

  private playClipById(fileId: string): boolean {
    const ctx = this.getOrCreateContextOnGesture();
    const decoded = this.decodedBuffers.get(fileId);

    // Only use Web Audio BufferSource when AudioContext is actively 'running'.
    // Otherwise fall back to HTMLAudioElement so audio plays immediately in user gestures.
    if (ctx && ctx.state === 'running' && decoded) {
      try {
        this.stopActiveVoice();
        const src = ctx.createBufferSource();
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(1.4, ctx.currentTime);
        src.buffer = decoded;
        src.connect(gain);
        gain.connect(this.getDestinationNode(ctx));
        src.onended = () => {
          if (this.activeSource === src) {
            this.activeSource = null;
          }
        };
        this.activeSource = src;
        src.start(0);
        return true;
      } catch {
        // Fall through to HTMLAudioElement
      }
    }

    if (ctx && !decoded && this.rawBuffers.has(fileId)) {
      void this.ensureDecodedBuffer(fileId);
    }

    const playbackUrl = this.getPlaybackUrl(fileId);
    if (playbackUrl && typeof Audio !== 'undefined') {
      try {
        this.stopActiveVoice();
        const audio = new Audio(playbackUrl);
        audio.volume = 1.0;
        this.activeHtmlAudio = audio;
        audio.addEventListener('ended', () => {
          if (this.activeHtmlAudio === audio) this.activeHtmlAudio = null;
        });
        audio.play().catch((err) => {
          if (this.activeHtmlAudio === audio) this.activeHtmlAudio = null;
          if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
            this.onPlaybackError?.(
              'Browser blocked audio playback. Click Test Audio or unmute this preview tab.'
            );
          }
        });
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  private speakText(text: string): boolean {
    if (!this.speechFallbackEnabled || !text) return false;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.94;
      utterance.pitch = 0.96;
      utterance.volume = 0.95;
      window.speechSynthesis.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }

  private speakFallbackCue(
    phase: BreathPhase,
    breathNumber?: number,
    customSpeechText?: string
  ): boolean {
    const text = customSpeechText ?? getSpeechCueText(phase, breathNumber);
    return this.speakText(text);
  }

  private resolvePhaseClipId(
    phase: BreathPhase,
    breathNumber?: number,
    context?: { totalBreaths?: number; currentRound?: number; totalRounds?: number }
  ): { clipId?: string; protectMs?: number; skippedForProtection?: boolean } {
    const totalBreaths = context?.totalBreaths ?? 0;
    const currentRound = context?.currentRound ?? 1;
    const totalRounds = context?.totalRounds ?? 1;

    if (phase === 'inhale' && breathNumber !== undefined) {
      const countFileId = this.countFileIds[breathNumber];
      if (countFileId) return { clipId: countFileId };

      if (
        this.progressUpdatesEnabled &&
        totalBreaths >= 8 &&
        breathNumber === totalBreaths - 2 &&
        this.roundLastIds[0]
      ) {
        return { clipId: this.roundLastIds[0], protectMs: 2800 };
      }

      if (totalBreaths >= 4 && breathNumber === totalBreaths && this.roundLastIds[1]) {
        return { clipId: this.roundLastIds[1], protectMs: 2200 };
      }

      const isQuarter =
        totalBreaths >= 16 &&
        (breathNumber === Math.round(totalBreaths * 0.25) ||
          breathNumber === Math.round(totalBreaths * 0.75));
      const isHalf = totalBreaths >= 10 && breathNumber === Math.ceil(totalBreaths / 2);

      if (
        this.progressUpdatesEnabled &&
        (isQuarter || isHalf) &&
        this.encouragementFileIds.length > 0
      ) {
        const available = this.encouragementFileIds.filter((id) => this.hasClipData(id));
        if (available.length > 0) {
          const chosen = available[this.encouragementCursor % available.length];
          this.encouragementCursor += 1;
          return { clipId: chosen, protectMs: 2900 };
        }
      }

      if (
        this.inhalePoolIds.length > 1 &&
        (!this.phaseFileIds.inhale || this.phaseFileIds.inhale === this.inhalePoolIds[0])
      ) {
        const idx = Math.max(0, breathNumber - 1) % this.inhalePoolIds.length;
        return { clipId: this.inhalePoolIds[idx] };
      }
    }

    if (phase === 'exhale') {
      if (Date.now() < this.protectedUntilMs) {
        return { skippedForProtection: true };
      }

      if (
        breathNumber !== undefined &&
        totalBreaths >= 4 &&
        breathNumber === totalBreaths &&
        this.roundLastIds[2]
      ) {
        return { clipId: this.roundLastIds[2] };
      }

      if (
        breathNumber !== undefined &&
        this.exhalePoolIds.length > 1 &&
        (!this.phaseFileIds.exhale || this.phaseFileIds.exhale === this.exhalePoolIds[0])
      ) {
        const idx = Math.max(0, breathNumber - 1) % this.exhalePoolIds.length;
        return { clipId: this.exhalePoolIds[idx] };
      }
    }

    if (phase === 'hold') {
      if (
        this.holdPoolIds.length > 1 &&
        (!this.phaseFileIds.hold || this.phaseFileIds.hold === this.holdPoolIds[0])
      ) {
        const chosen = this.holdPoolIds[0];
        this.holdCursor = 1;
        return { clipId: chosen };
      }
    }

    if (phase === 'recovery_exhale') {
      if (currentRound < totalRounds && this.nextRoundIds[0]) {
        return { clipId: this.nextRoundIds[0] };
      }
    }

    if (phase === 'completed') {
      if (
        this.completedIds.length > 1 &&
        (!this.phaseFileIds.completed || this.phaseFileIds.completed === this.completedIds[0])
      ) {
        const chosen = this.completedIds[this.completedCursor % this.completedIds.length];
        this.completedCursor += 1;
        return { clipId: chosen };
      }
    }

    if (phase !== 'idle') {
      return { clipId: this.phaseFileIds[phase] };
    }

    return {};
  }

  public playPhaseCue(
    phase: BreathPhase,
    breathNumber?: number,
    customSpeechText?: string,
    context?: { totalBreaths?: number; currentRound?: number; totalRounds?: number }
  ): void {
    if (!this.enabled || phase === 'idle') return;

    const allowVoice = this.mode === 'voice_and_chimes' || this.mode === 'voice_only';
    const allowChime = this.mode === 'voice_and_chimes' || this.mode === 'chimes_only';

    let playedDriveClip = false;
    let skippedForProtection = false;

    if (allowVoice) {
      const resolved = this.resolvePhaseClipId(phase, breathNumber, context);
      skippedForProtection = Boolean(resolved.skippedForProtection);

      if (!skippedForProtection && resolved.clipId && this.hasClipData(resolved.clipId)) {
        playedDriveClip = this.playClipById(resolved.clipId);
        if (playedDriveClip && resolved.protectMs) {
          this.protectedUntilMs = Date.now() + resolved.protectMs;
        }
      }
    }

    if (!playedDriveClip && !skippedForProtection && allowVoice) {
      const speechText = this.progressUpdatesEnabled ? customSpeechText : undefined;
      this.speakFallbackCue(phase, breathNumber, speechText);
    }

    if (allowChime && (!playedDriveClip || this.mode === 'chimes_only')) {
      this.playSynthesizedCue(phase);
    }
  }

  public playProgressUpdate(text: string, tone: 'milestone' | 'countdown' = 'milestone'): void {
    if (!this.enabled || !this.progressUpdatesEnabled) return;

    const allowVoice = this.mode === 'voice_and_chimes' || this.mode === 'voice_only';
    const allowChime = this.mode === 'voice_and_chimes' || this.mode === 'chimes_only';

    let playedDriveClip = false;
    if (allowVoice && tone === 'milestone') {
      const pool = [...this.encouragementFileIds, ...this.holdPoolIds.slice(1)].filter((id) =>
        this.hasClipData(id)
      );

      if (pool.length > 0) {
        const chosenId = pool[(this.encouragementCursor + this.holdCursor) % pool.length];
        this.encouragementCursor += 1;
        this.holdCursor += 1;
        playedDriveClip = this.playClipById(chosenId);
      }
    }

    if (
      !playedDriveClip &&
      allowVoice &&
      (tone === 'countdown' || this.encouragementFileIds.length === 0)
    ) {
      this.speakText(text);
    }

    if (allowChime && (!playedDriveClip || this.mode === 'chimes_only')) {
      const ctx = this.getOrCreateContextOnGesture();
      if (ctx && ctx.state === 'running') {
        try {
          const now = ctx.currentTime;
          if (tone === 'countdown') {
            this.playSoftTone(ctx, 523.25, 587.33, 0.35, 0.14, now);
          } else {
            this.playBellChime(ctx, 528, 1.1, 0.14, now);
          }
        } catch {
          // Ignore audio failures in restricted environments
        }
      }
    }
  }

  private playSynthesizedCue(phase: BreathPhase): void {
    const ctx = this.getOrCreateContextOnGesture();
    if (!ctx) return;

    const trigger = () => {
      try {
        const now = ctx.currentTime;
        if (phase === 'inhale') {
          this.playSoftTone(ctx, 293.66, 392.0, 0.45, 0.2, now);
        } else if (phase === 'exhale') {
          this.playSoftTone(ctx, 349.23, 246.94, 0.5, 0.18, now);
        } else if (phase === 'hold') {
          this.playBellChime(ctx, 220, 2.0, 0.26, now);
        } else if (phase === 'recovery_inhale') {
          this.playBellChime(ctx, 440, 1.6, 0.26, now);
        } else if (phase === 'recovery_hold') {
          this.playSoftTone(ctx, 523.25, 523.25, 0.7, 0.16, now);
        } else if (phase === 'recovery_exhale') {
          this.playSoftTone(ctx, 392.0, 261.63, 0.9, 0.18, now);
        } else if (phase === 'completed') {
          this.playBellChime(ctx, 329.63, 2.2, 0.24, now);
          this.playBellChime(ctx, 440, 2.4, 0.22, now + 0.16);
        }
      } catch {
        // Ignore audio failures in restricted environments
      }
    };

    if (ctx.state === 'suspended') {
      ctx
        .resume()
        .then(trigger)
        .catch(() => {});
    } else {
      trigger();
    }
  }

  private playSoftTone(
    ctx: AudioContext,
    startFreq: number,
    endFreq: number,
    durationSec: number,
    peakGain: number,
    startTime: number
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), startTime + durationSec);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    osc.connect(gain);
    gain.connect(this.getDestinationNode(ctx));
    osc.start(startTime);
    osc.stop(startTime + durationSec + 0.02);
  }

  private playBellChime(
    ctx: AudioContext,
    freq: number,
    durationSec: number,
    peakGain: number,
    startTime: number
  ): void {
    const osc = ctx.createOscillator();
    const overtone = ctx.createOscillator();
    const gain = ctx.createGain();
    const overtoneGain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    overtone.type = 'triangle';
    overtone.frequency.setValueAtTime(freq * 2, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    overtoneGain.gain.setValueAtTime(0.0001, startTime);
    overtoneGain.gain.linearRampToValueAtTime(peakGain * 0.28, startTime + 0.02);
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec * 0.65);

    osc.connect(gain);
    overtone.connect(overtoneGain);
    const dest = this.getDestinationNode(ctx);
    gain.connect(dest);
    overtoneGain.connect(dest);

    osc.start(startTime);
    overtone.start(startTime);
    osc.stop(startTime + durationSec + 0.05);
    overtone.stop(startTime + durationSec + 0.05);
  }
}

export const breathAudio = new BreathAudioEngine();
