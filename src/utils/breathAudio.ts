import { BreathPhase } from './breathEngine';
import { VoicePhaseSlot } from './driveAudioMatcher';
import {
  AudioMode,
  AudioVolumeSettings,
  DEFAULT_AUDIO_VOLUMES,
  NarrationLevel,
  SoundscapeId,
  clampAudioVolumes,
  getAmbientPhaseTarget,
  resolveCueSchedule,
  shouldPlayVoiceForPhase,
} from './breathAudioPolicy';

export type { AudioMode, AudioVolumeSettings, NarrationLevel, SoundscapeId };

export interface AudioReadinessReport {
  contextState: AudioContextState | 'uninitialized' | 'unavailable';
  bundledClipsCount: number;
  decodedClipsCount: number;
  speechSynthesisAvailable: boolean;
  offlineServiceWorkerReady: boolean;
}

function getSpeechCueText(phase: BreathPhase): string {
  switch (phase) {
    case 'preparing':
      return 'Find a comfortable position';
    case 'inhale':
      return 'Inhale';
    case 'exhale':
      return 'Exhale';
    case 'hold':
      return 'Rest comfortably after the exhale';
    case 'recovery_inhale':
      return 'Deep recovery breath in';
    case 'recovery_hold':
      return 'Rest gently';
    case 'recovery_exhale':
      return 'Release slowly';
    case 'completed':
      return 'Session complete';
    case 'idle':
    default:
      return '';
  }
}

interface ActiveAmbientGraph {
  soundscape: SoundscapeId;
  masterGain: GainNode;
  filter: BiquadFilterNode;
  stopNodes: () => void;
}

class BreathAudioEngine {
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private voiceBus: GainNode | null = null;
  private chimeBus: GainNode | null = null;
  private ambientGraph: ActiveAmbientGraph | null = null;

  private enabled = true;
  private mode: AudioMode = 'voice_and_chimes';
  private narrationLevel: NarrationLevel = 'balanced';
  private soundscape: SoundscapeId = 'off';
  private volumes: AudioVolumeSettings = { ...DEFAULT_AUDIO_VOLUMES };
  private speechFallbackEnabled = true;
  private progressUpdatesEnabled = true;
  private onPlaybackError: ((message: string) => void) | null = null;
  private onAudioInterruption: (() => void) | null = null;
  private expectSessionRunning = false;
  private hasContextBeenRunning = false;

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
  private scheduledVoiceTimer: number | null = null;
  private pendingCheckResolve: (() => void) | null = null;
  private sequenceCancelled = false;

  public setOnPlaybackError(cb: ((message: string) => void) | null): void {
    this.onPlaybackError = cb;
  }

  public setOnAudioInterruption(cb: (() => void) | null): void {
    this.onAudioInterruption = cb;
  }

  public setSessionRunning(running: boolean): void {
    this.expectSessionRunning = running;
    if (!running) {
      this.stopAmbient();
    } else if (this.enabled && this.soundscape !== 'off') {
      this.startAmbient();
    }
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clearScheduledVoice();
      this.stopActiveVoice();
      this.stopPreview();
      this.stopSpeech();
      this.stopAmbient();
    } else if (this.expectSessionRunning && this.soundscape !== 'off') {
      this.startAmbient();
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setMode(mode: AudioMode): void {
    this.mode = mode;
    if (mode === 'chimes_only') {
      this.clearScheduledVoice();
      this.stopActiveVoice();
      this.stopSpeech();
    }
  }

  public getMode(): AudioMode {
    return this.mode;
  }

  public setNarrationLevel(level: NarrationLevel): void {
    this.narrationLevel = level;
  }

  public getNarrationLevel(): NarrationLevel {
    return this.narrationLevel;
  }

  public setSoundscape(soundscape: SoundscapeId): void {
    const changed = this.soundscape !== soundscape;
    this.soundscape = soundscape;
    if (!changed) return;

    if (soundscape === 'off' || !this.enabled) {
      this.stopAmbient();
    } else if (this.expectSessionRunning) {
      this.stopAmbient();
      this.startAmbient();
    }
  }

  public getSoundscape(): SoundscapeId {
    return this.soundscape;
  }

  public setVolumes(next: Partial<AudioVolumeSettings>): void {
    this.volumes = clampAudioVolumes({ ...this.volumes, ...next });
    const ctx = this.ctx;
    if (ctx) {
      const now = ctx.currentTime;
      if (this.voiceBus) {
        this.voiceBus.gain.setTargetAtTime(this.volumes.voiceVolume * 1.4, now, 0.04);
      }
      if (this.chimeBus) {
        this.chimeBus.gain.setTargetAtTime(this.volumes.chimeVolume, now, 0.04);
      }
      if (this.ambientGraph) {
        this.ambientGraph.masterGain.gain.setTargetAtTime(
          this.volumes.ambientVolume * 0.28,
          now,
          0.08
        );
      }
    }
    if (this.activeHtmlAudio) {
      this.activeHtmlAudio.volume = this.volumes.voiceVolume;
    }
    if (this.previewHtmlAudio) {
      this.previewHtmlAudio.volume = this.volumes.voiceVolume;
    }
  }

  public getVolumes(): AudioVolumeSettings {
    return { ...this.volumes };
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
    this.clearScheduledVoice();
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
        const ctx = new AudioCtx();
        this.hasContextBeenRunning = ctx.state === 'running';
        ctx.onstatechange = () => {
          const st = ctx.state as string;
          if (st === 'running') {
            this.hasContextBeenRunning = true;
            return;
          }
          if (
            this.expectSessionRunning &&
            (st === 'interrupted' || (st === 'suspended' && this.hasContextBeenRunning))
          ) {
            this.onAudioInterruption?.();
          }
        };
        this.ctx = ctx;
      } catch {
        return null;
      }
    }

    if (this.ctx.state === 'running') {
      this.hasContextBeenRunning = true;
    } else if (this.ctx.state === 'suspended') {
      void this.ctx.resume().then(() => {
        if (this.ctx?.state === 'running') {
          this.hasContextBeenRunning = true;
        }
      }).catch(() => {});
    }

    return this.ctx;
  }

  private getVoiceBus(ctx: AudioContext): AudioNode {
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
        this.compressor = null;
      }
    }

    if (!this.voiceBus || this.voiceBus.context !== ctx) {
      const bus = ctx.createGain();
      bus.gain.setValueAtTime(this.volumes.voiceVolume * 1.4, ctx.currentTime);
      bus.connect(this.compressor ?? ctx.destination);
      this.voiceBus = bus;
    }

    return this.voiceBus;
  }

  private getChimeBus(ctx: AudioContext): AudioNode {
    if (!this.chimeBus || this.chimeBus.context !== ctx) {
      const bus = ctx.createGain();
      bus.gain.setValueAtTime(this.volumes.chimeVolume, ctx.currentTime);
      bus.connect(ctx.destination);
      this.chimeBus = bus;
    }
    return this.chimeBus;
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
    if (ctx.state === 'running') {
      this.hasContextBeenRunning = true;
    }

    this.decodeAllPendingBuffers();
  }

  public getReadinessReport(): AudioReadinessReport {
    const hasWindow = typeof window !== 'undefined';
    const hasAudioCtx =
      hasWindow &&
      Boolean(
        window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      );

    return {
      contextState: !hasAudioCtx
        ? 'unavailable'
        : this.ctx
          ? this.ctx.state
          : 'uninitialized',
      bundledClipsCount: this.localUrls.size || this.rawBuffers.size,
      decodedClipsCount: this.decodedBuffers.size,
      speechSynthesisAvailable: hasWindow && 'speechSynthesis' in window,
      offlineServiceWorkerReady:
        typeof navigator !== 'undefined' &&
        'serviceWorker' in navigator &&
        Boolean(navigator.serviceWorker.controller),
    };
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

  private clearScheduledVoice(): void {
    if (this.scheduledVoiceTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.scheduledVoiceTimer);
      this.scheduledVoiceTimer = null;
    }
    if (this.pendingCheckResolve) {
      const resolve = this.pendingCheckResolve;
      this.pendingCheckResolve = null;
      resolve();
    }
  }

  public stopActiveVoice(): void {
    this.clearScheduledVoice();
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

  private createNoiseBuffer(ctx: AudioContext, pink: boolean): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = Math.round(sampleRate * 3.0);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    if (pink) {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.09;
        b6 = white * 0.115926;
      }
    } else {
      let lastOut = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        lastOut = (lastOut + 0.02 * white) / 1.02;
        data[i] = lastOut * 2.8;
      }
    }
    return buffer;
  }

  public startAmbient(): void {
    if (!this.enabled || this.soundscape === 'off') return;
    if (this.ambientGraph && this.ambientGraph.soundscape === this.soundscape) return;

    this.stopAmbient();
    const ctx = this.getOrCreateContextOnGesture();
    if (!ctx) return;

    const now = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, now);
    filter.Q.setValueAtTime(0.7, now);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.setTargetAtTime(Math.max(0.0001, this.volumes.ambientVolume * 0.25), now, 0.4);

    filter.connect(masterGain);
    masterGain.connect(ctx.destination);

    const stopCallbacks: (() => void)[] = [];

    if (this.soundscape === 'ocean' || this.soundscape === 'rain') {
      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = this.createNoiseBuffer(ctx, this.soundscape === 'rain');
      noiseSrc.loop = true;

      if (this.soundscape === 'rain') {
        filter.frequency.setValueAtTime(950, now);
      }

      noiseSrc.connect(filter);
      noiseSrc.start(now);
      stopCallbacks.push(() => {
        try {
          noiseSrc.stop();
          noiseSrc.disconnect();
        } catch {
          // Ignore
        }
      });
    } else if (this.soundscape === 'drone') {
      const freqs = [136.1, 204.15, 272.2];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = idx === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        oscGain.gain.setValueAtTime(idx === 0 ? 0.35 : 0.14, now);
        osc.connect(oscGain);
        oscGain.connect(filter);
        osc.start(now);
        stopCallbacks.push(() => {
          try {
            osc.stop();
            osc.disconnect();
          } catch {
            // Ignore
          }
        });
      });
    }

    this.ambientGraph = {
      soundscape: this.soundscape,
      masterGain,
      filter,
      stopNodes: () => {
        stopCallbacks.forEach((fn) => fn());
        try {
          masterGain.disconnect();
          filter.disconnect();
        } catch {
          // Ignore
        }
      },
    };
  }

  public updateAmbientState(phase: BreathPhase, progress: number): void {
    const graph = this.ambientGraph;
    const ctx = this.ctx;
    if (!graph || !ctx || ctx.state !== 'running') return;

    const target = getAmbientPhaseTarget(phase, progress);
    const now = ctx.currentTime;
    const targetGain = Math.max(0.0001, this.volumes.ambientVolume * 0.26 * target.gainMultiplier);
    const targetFreq = graph.soundscape === 'rain' ? target.filterHz * 1.6 : target.filterHz;

    graph.masterGain.gain.setTargetAtTime(targetGain, now, 0.14);
    graph.filter.frequency.setTargetAtTime(targetFreq, now, 0.14);
  }

  public stopAmbient(): void {
    if (!this.ambientGraph) return;
    const graph = this.ambientGraph;
    this.ambientGraph = null;
    const ctx = this.ctx;
    if (ctx && ctx.state === 'running') {
      try {
        graph.masterGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
        window.setTimeout(() => graph.stopNodes(), 220);
        return;
      } catch {
        // Fall through to immediate cleanup
      }
    }
    graph.stopNodes();
  }

  public async previewSoundscapeBriefly(): Promise<void> {
    await this.unlock();
    if (this.soundscape === 'off') {
      this.stopAmbient();
      return;
    }
    this.startAmbient();
  }

  private getPlaybackUrl(fileId: string): string | undefined {
    return this.localUrls.get(fileId) ?? this.fallbackBlobUrls.get(fileId);
  }

  public async previewClip(fileId: string, onEnded?: () => void): Promise<void> {
    this.stopPreview();
    this.stopActiveVoice();
    this.stopSpeech();

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

    throw new Error('Audio clip could not be decoded for playback in this browser.');
  }

  private startPreviewWebAudio(
    ctx: AudioContext,
    decoded: AudioBuffer,
    onEnded?: () => void
  ): void {
    const src = ctx.createBufferSource();
    src.buffer = decoded;
    src.connect(this.getVoiceBus(ctx));
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
    audio.volume = this.volumes.voiceVolume;
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

  public async playSafetyStopCue(): Promise<void> {
    if (!this.enabled || this.mode === 'chimes_only') return;
    const stopClip = this.safetyIds[1] ?? this.encouragementFileIds[5];
    if (stopClip && this.hasClipData(stopClip)) {
      this.playClipById(stopClip);
    }
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

  /**
   * Audio readiness verification: plays verification chime first, waits cleanly until settled,
   * then plays the voice greeting with zero overlap.
   */
  public async runAudioReadinessCheck(): Promise<AudioReadinessReport> {
    await this.unlock();
    const ctx = this.getOrCreateContextOnGesture();
    if (!ctx) {
      throw new Error('Web Audio is unavailable in this browser.');
    }

    this.clearScheduledVoice();
    const now = ctx.currentTime;
    const chimeDuration = 0.55;
    const chimePlayed = this.volumes.chimeVolume > 0;
    if (chimePlayed) {
      this.playBellChime(ctx, 440, chimeDuration, 0.24, now);
    }
    const voiceDelayMs = chimePlayed ? 620 : 20;

    if (this.mode !== 'chimes_only' && this.volumes.voiceVolume > 0) {
      const welcomeClip = this.welcomeIds[0] ?? this.phaseFileIds.inhale;
      if (welcomeClip && this.hasClipData(welcomeClip)) {
        const decoded = await this.ensureDecodedBuffer(welcomeClip);
        if (decoded && ctx.state === 'running') {
          this.stopActiveVoice();
          const src = ctx.createBufferSource();
          src.buffer = decoded;
          src.connect(this.getVoiceBus(ctx));
          src.onended = () => {
            if (this.activeSource === src) this.activeSource = null;
          };
          this.activeSource = src;
          // Start strictly after chime settles so voice and chime never overlap
          const startAt = chimePlayed
            ? Math.max(ctx.currentTime + 0.05, now + chimeDuration + 0.08)
            : ctx.currentTime + 0.02;
          src.start(startAt);
          return this.getReadinessReport();
        }

        const directUrl = this.getPlaybackUrl(welcomeClip);
        if (directUrl && typeof Audio !== 'undefined') {
          await new Promise<void>((resolve) => {
            this.pendingCheckResolve = resolve;
            this.scheduledVoiceTimer = window.setTimeout(() => {
              this.scheduledVoiceTimer = null;
              this.pendingCheckResolve = null;
              void this.playPreviewHtmlAudio(directUrl).finally(resolve);
            }, voiceDelayMs);
          });
          return this.getReadinessReport();
        }
      }

      if (
        this.speechFallbackEnabled &&
        typeof window !== 'undefined' &&
        'speechSynthesis' in window
      ) {
        this.scheduledVoiceTimer = window.setTimeout(() => {
          this.scheduledVoiceTimer = null;
          this.speakText('Audio ready.');
        }, voiceDelayMs);
      }
    }

    return this.getReadinessReport();
  }

  public async testAudioOutput(): Promise<void> {
    await this.runAudioReadinessCheck();
  }

  private playClipById(fileId: string, delayMs = 0): boolean {
    if (this.volumes.voiceVolume <= 0) return false;

    const triggerNow = (): boolean => {
      const ctx = this.getOrCreateContextOnGesture();
      const decoded = this.decodedBuffers.get(fileId);

      if (ctx && ctx.state === 'running' && decoded) {
        try {
          this.stopActiveVoice();
          const src = ctx.createBufferSource();
          src.buffer = decoded;
          src.connect(this.getVoiceBus(ctx));
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
          audio.volume = this.volumes.voiceVolume;
          this.activeHtmlAudio = audio;
          audio.addEventListener('ended', () => {
            if (this.activeHtmlAudio === audio) this.activeHtmlAudio = null;
          });
          audio.play().catch((err) => {
            if (this.activeHtmlAudio === audio) this.activeHtmlAudio = null;
            if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
              this.onPlaybackError?.(
                'Browser blocked audio playback. Run Audio Check or unmute this tab.'
              );
            }
          });
          return true;
        } catch {
          return false;
        }
      }

      return false;
    };

    if (delayMs > 0 && typeof window !== 'undefined') {
      const ctx = this.ctx;
      const decoded = this.decodedBuffers.get(fileId);
      if (ctx && ctx.state === 'running' && decoded) {
        try {
          this.stopActiveVoice();
          const src = ctx.createBufferSource();
          src.buffer = decoded;
          src.connect(this.getVoiceBus(ctx));
          src.onended = () => {
            if (this.activeSource === src) this.activeSource = null;
          };
          this.activeSource = src;
          src.start(ctx.currentTime + delayMs / 1000);
          return true;
        } catch {
          // Fallback to timeout below
        }
      }
      this.clearScheduledVoice();
      this.scheduledVoiceTimer = window.setTimeout(() => {
        this.scheduledVoiceTimer = null;
        triggerNow();
      }, delayMs);
      return true;
    }

    return triggerNow();
  }

  private speakText(text: string): boolean {
    if (!this.speechFallbackEnabled || !text || this.volumes.voiceVolume <= 0) return false;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.94;
      utterance.pitch = 0.96;
      utterance.volume = this.volumes.voiceVolume;
      window.speechSynthesis.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }

  private speakFallbackCue(
    phase: BreathPhase,
    customSpeechText?: string
  ): boolean {
    const text = customSpeechText ?? getSpeechCueText(phase);
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

    if (phase === 'preparing') {
      const prepId = this.welcomeIds[1] ?? this.welcomeIds[0];
      return { clipId: prepId };
    }

    if (phase === 'inhale' && breathNumber !== undefined) {
      const countFileId = this.countFileIds[breathNumber];
      if (countFileId) return { clipId: countFileId };

      if (
        this.narrationLevel === 'active' &&
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
        this.narrationLevel === 'active' &&
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
    context?: {
      totalBreaths?: number;
      currentRound?: number;
      totalRounds?: number;
      phaseDurationMs?: number;
    }
  ): void {
    if (!this.enabled || phase === 'idle') return;

    const hasVoiceForPhase = shouldPlayVoiceForPhase(
      this.narrationLevel,
      phase,
      breathNumber,
      context?.totalBreaths
    );

    const resolved = this.resolvePhaseClipId(phase, breathNumber, context);
    const skippedForProtection = Boolean(resolved.skippedForProtection);
    const hasClip = Boolean(resolved.clipId && this.hasClipData(resolved.clipId));
    const canSpeechFallback =
      this.speechFallbackEnabled &&
      typeof window !== 'undefined' &&
      'speechSynthesis' in window;

    const schedule = resolveCueSchedule({
      mode: this.mode,
      phase,
      hasVoiceForPhase: hasVoiceForPhase && !skippedForProtection,
      hasVoiceAssetOrSpeech: hasClip || canSpeechFallback,
      phaseDurationMs: context?.phaseDurationMs ?? 3000,
    });

    if (schedule.playChime && this.volumes.chimeVolume > 0) {
      this.playSynthesizedCue(phase, schedule.playVoice);
    }

    if (schedule.playVoice && !skippedForProtection && this.volumes.voiceVolume > 0) {
      if (hasClip && resolved.clipId) {
        const played = this.playClipById(resolved.clipId, schedule.voiceDelayMs);
        if (played && resolved.protectMs) {
          this.protectedUntilMs = Date.now() + resolved.protectMs + schedule.voiceDelayMs;
        }
      } else if (canSpeechFallback) {
        const speechText = this.progressUpdatesEnabled ? customSpeechText : undefined;
        if (schedule.voiceDelayMs > 0 && typeof window !== 'undefined') {
          this.clearScheduledVoice();
          this.scheduledVoiceTimer = window.setTimeout(() => {
            this.scheduledVoiceTimer = null;
            this.speakFallbackCue(phase, speechText);
          }, schedule.voiceDelayMs);
        } else {
          this.speakFallbackCue(phase, speechText);
        }
      }
    }
  }

  public playProgressUpdate(text: string, tone: 'milestone' | 'countdown' = 'milestone'): void {
    if (!this.enabled || !this.progressUpdatesEnabled) return;

    const allowVoice =
      (this.mode === 'voice_and_chimes' || this.mode === 'voice_only') &&
      this.volumes.voiceVolume > 0;
    const allowChime =
      (this.mode === 'voice_and_chimes' || this.mode === 'chimes_only') &&
      this.volumes.chimeVolume > 0;

    let playedClip = false;
    if (allowVoice && tone === 'milestone' && this.narrationLevel === 'active') {
      const pool = [...this.encouragementFileIds, ...this.holdPoolIds.slice(1)].filter((id) =>
        this.hasClipData(id)
      );

      if (pool.length > 0) {
        const chosenId = pool[(this.encouragementCursor + this.holdCursor) % pool.length];
        this.encouragementCursor += 1;
        this.holdCursor += 1;
        playedClip = this.playClipById(chosenId);
      }
    }

    let spokeText = false;
    if (
      !playedClip &&
      allowVoice &&
      (tone === 'countdown' || this.encouragementFileIds.length === 0 || this.narrationLevel === 'balanced')
    ) {
      spokeText = this.speakText(text);
    }

    // Never play a simultaneous chime over voice or speechSynthesis
    if (allowChime && !playedClip && !spokeText) {
      const ctx = this.getOrCreateContextOnGesture();
      if (ctx && ctx.state === 'running') {
        try {
          const now = ctx.currentTime;
          if (tone === 'countdown') {
            this.playSoftTone(ctx, 523.25, 587.33, 0.35, 0.14, now);
          } else {
            this.playBellChime(ctx, 528, 0.9, 0.14, now);
          }
        } catch {
          // Ignore audio failures
        }
      }
    }
  }

  private playSynthesizedCue(phase: BreathPhase, compact = false): void {
    const ctx = this.getOrCreateContextOnGesture();
    if (!ctx || this.volumes.chimeVolume <= 0) return;

    const durScale = compact ? 0.42 : 1.0;

    const trigger = () => {
      try {
        const now = ctx.currentTime;
        if (phase === 'preparing') {
          this.playBellChime(ctx, 392.0, 0.8 * durScale, 0.16, now);
        } else if (phase === 'inhale') {
          this.playSoftTone(ctx, 293.66, 392.0, 0.45 * durScale, 0.2, now);
        } else if (phase === 'exhale') {
          this.playSoftTone(ctx, 349.23, 246.94, 0.5 * durScale, 0.18, now);
        } else if (phase === 'hold') {
          this.playBellChime(ctx, 220, compact ? 0.34 : 1.6, 0.24, now);
        } else if (phase === 'recovery_inhale') {
          this.playBellChime(ctx, 440, compact ? 0.34 : 1.4, 0.24, now);
        } else if (phase === 'recovery_hold') {
          this.playSoftTone(ctx, 523.25, 523.25, 0.55 * durScale, 0.16, now);
        } else if (phase === 'recovery_exhale') {
          this.playSoftTone(ctx, 392.0, 261.63, compact ? 0.34 : 0.8, 0.18, now);
        } else if (phase === 'completed') {
          this.playBellChime(ctx, 329.63, compact ? 0.34 : 1.8, 0.22, now);
          if (!compact) {
            this.playBellChime(ctx, 440, 2.0, 0.2, now + 0.16);
          }
        }
      } catch {
        // Ignore audio failures
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
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    osc.connect(gain);
    gain.connect(this.getChimeBus(ctx));
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
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    overtoneGain.gain.setValueAtTime(0.0001, startTime);
    overtoneGain.gain.linearRampToValueAtTime(peakGain * 0.26, startTime + 0.02);
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec * 0.65);

    osc.connect(gain);
    overtone.connect(overtoneGain);
    const dest = this.getChimeBus(ctx);
    gain.connect(dest);
    overtoneGain.connect(dest);

    osc.start(startTime);
    overtone.start(startTime);
    osc.stop(startTime + durationSec + 0.05);
    overtone.stop(startTime + durationSec + 0.05);
  }
}

export const breathAudio = new BreathAudioEngine();
