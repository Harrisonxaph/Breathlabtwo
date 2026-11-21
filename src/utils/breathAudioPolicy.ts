import { BreathPhase } from './breathEngine';

export type AudioMode = 'voice_and_chimes' | 'voice_only' | 'chimes_only';
export type NarrationLevel = 'minimal' | 'balanced' | 'active';
export type SoundscapeId = 'off' | 'ocean' | 'drone' | 'rain';

export interface AudioVolumeSettings {
  voiceVolume: number; // 0..1
  chimeVolume: number; // 0..1
  ambientVolume: number; // 0..1
}

export const DEFAULT_AUDIO_VOLUMES: AudioVolumeSettings = {
  voiceVolume: 0.9,
  chimeVolume: 0.7,
  ambientVolume: 0.4,
};

export function clampVolume(value: number, fallback = 0.8): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(1, Math.max(0, Number(value.toFixed(2))));
}

export function clampAudioVolumes(
  partial: Partial<AudioVolumeSettings>
): AudioVolumeSettings {
  return {
    voiceVolume: clampVolume(
      partial.voiceVolume ?? DEFAULT_AUDIO_VOLUMES.voiceVolume,
      DEFAULT_AUDIO_VOLUMES.voiceVolume
    ),
    chimeVolume: clampVolume(
      partial.chimeVolume ?? DEFAULT_AUDIO_VOLUMES.chimeVolume,
      DEFAULT_AUDIO_VOLUMES.chimeVolume
    ),
    ambientVolume: clampVolume(
      partial.ambientVolume ?? DEFAULT_AUDIO_VOLUMES.ambientVolume,
      DEFAULT_AUDIO_VOLUMES.ambientVolume
    ),
  };
}

/**
 * Determines whether a voice cue should fire for a given phase under the selected narration level.
 */
export function shouldPlayVoiceForPhase(
  level: NarrationLevel,
  phase: BreathPhase,
  breathNumber?: number,
  totalBreaths?: number
): boolean {
  if (phase === 'idle') return false;

  if (
    phase === 'preparing' ||
    phase === 'hold' ||
    phase === 'recovery_inhale' ||
    phase === 'recovery_exhale' ||
    phase === 'completed'
  ) {
    return true;
  }

  if (phase === 'recovery_hold') {
    return level !== 'minimal';
  }

  const breath = breathNumber ?? 1;
  const total = totalBreaths ?? 1;

  if (level === 'minimal') {
    // Only cue the opening inhale of each round
    return phase === 'inhale' && breath === 1;
  }

  if (level === 'balanced') {
    if (breath <= 2) return true;
    if (total >= 10 && breath === Math.ceil(total / 2) && phase === 'inhale') return true;
    if (total >= 8 && breath === total - 2 && phase === 'inhale') return true;
    if (breath === total) return true;
    return false;
  }

  // 'active' cues every rhythmic breath and milestone
  return true;
}

export interface CueScheduleDecision {
  playChime: boolean;
  playVoice: boolean;
  voiceDelayMs: number;
}

/**
 * Ensures voice and chimes never sound simultaneously at t=0.
 * In voice_and_chimes mode:
 * - Major transitions (hold, recovery_inhale, recovery_exhale, completed) play a short chime first
 *   and schedule voice cleanly afterward (+380ms) if phase duration permits.
 * - Rhythmic breath phases play voice when available, falling back to chime only when no voice plays.
 * - Spoken fallback never runs on top of a simultaneous chime.
 */
export function resolveCueSchedule(params: {
  mode: AudioMode;
  phase: BreathPhase;
  hasVoiceForPhase: boolean;
  hasVoiceAssetOrSpeech: boolean;
  phaseDurationMs: number;
}): CueScheduleDecision {
  const { mode, phase, hasVoiceForPhase, hasVoiceAssetOrSpeech, phaseDurationMs } = params;

  if (phase === 'idle') {
    return { playChime: false, playVoice: false, voiceDelayMs: 0 };
  }

  if (mode === 'chimes_only') {
    return { playChime: true, playVoice: false, voiceDelayMs: 0 };
  }

  const willPlayVoice = hasVoiceForPhase && hasVoiceAssetOrSpeech;

  if (mode === 'voice_only') {
    return { playChime: false, playVoice: willPlayVoice, voiceDelayMs: 0 };
  }

  // mode === 'voice_and_chimes'
  const isMajorTransition =
    phase === 'hold' ||
    phase === 'recovery_inhale' ||
    phase === 'recovery_exhale' ||
    phase === 'completed';

  if (isMajorTransition) {
    if (willPlayVoice && (phase === 'completed' || phaseDurationMs >= 2000)) {
      return { playChime: true, playVoice: true, voiceDelayMs: 380 };
    }
    if (willPlayVoice) {
      return { playChime: false, playVoice: true, voiceDelayMs: 0 };
    }
    return { playChime: true, playVoice: false, voiceDelayMs: 0 };
  }

  if (willPlayVoice) {
    return { playChime: false, playVoice: true, voiceDelayMs: 0 };
  }

  return { playChime: true, playVoice: false, voiceDelayMs: 0 };
}

export interface AmbientPhaseTarget {
  gainMultiplier: number;
  filterHz: number;
}

/**
 * Computes dynamic ambient soundscape brightness & swell synchronized to breath phase.
 */
export function getAmbientPhaseTarget(
  phase: BreathPhase,
  progress: number
): AmbientPhaseTarget {
  const t = Math.min(1, Math.max(0, Number.isNaN(progress) ? 0 : progress));
  const ease = -(Math.cos(Math.PI * t) - 1) / 2;

  switch (phase) {
    case 'inhale':
    case 'recovery_inhale':
      return {
        gainMultiplier: 0.65 + 0.5 * ease,
        filterHz: 380 + 520 * ease,
      };
    case 'exhale':
    case 'recovery_exhale':
      return {
        gainMultiplier: 1.15 - 0.57 * ease,
        filterHz: 900 - 540 * ease,
      };
    case 'hold':
      return {
        gainMultiplier: 0.45,
        filterHz: 260,
      };
    case 'recovery_hold':
      return {
        gainMultiplier: 0.85,
        filterHz: 540,
      };
    case 'preparing':
      return {
        gainMultiplier: 0.68,
        filterHz: 420,
      };
    case 'completed':
      return {
        gainMultiplier: 0.5,
        filterHz: 320,
      };
    case 'idle':
    default:
      return {
        gainMultiplier: 0.65,
        filterHz: 420,
      };
  }
}
