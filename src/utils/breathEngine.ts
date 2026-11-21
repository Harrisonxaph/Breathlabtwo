export type BreathPhase =
  | 'idle'
  | 'preparing'
  | 'inhale'
  | 'exhale'
  | 'hold'
  | 'recovery_inhale'
  | 'recovery_hold'
  | 'recovery_exhale'
  | 'completed';

export type InterruptionReason = 'backgrounded' | 'audio_interrupted';

export interface BreathConfig {
  breathCount: number; // 1 - 40
  inhaleSec: number; // 1.0 - 6.0
  exhaleSec: number; // 1.0 - 6.0
  holdSec: number; // 5 - 240
  recoveryInhaleSec: number; // 2.0 - 5.0
  recoveryHoldSec: number; // 5 - 45
  rounds: number; // 1 - 5
  prepCountdownSec: number; // 0 - 15 (0 = off)
  useRoundSpecificHolds: boolean;
  roundHoldOverrides: number[]; // per-round hold seconds (length up to 5)
  roundRetentionCues: boolean;
}

export interface BreathPreset {
  id: string;
  name: string;
  subtitle: string;
  config: BreathConfig;
  isCustom?: boolean;
}

export interface BreathSessionState {
  config: BreathConfig;
  phase: BreathPhase;
  isPaused: boolean;
  interruptionReason: InterruptionReason | null;
  endedEarly: boolean;
  currentRound: number;
  currentBreath: number;
  phaseElapsedMs: number;
  phaseDurationMs: number;
  totalElapsedMs: number;
  totalBreathsCompleted: number;
}

export interface PhaseTransition {
  from: BreathPhase;
  to: BreathPhase;
  round: number;
  breath: number;
}

export const DEFAULT_CONFIG: BreathConfig = {
  breathCount: 30,
  inhaleSec: 2.0,
  exhaleSec: 2.0,
  holdSec: 60,
  recoveryInhaleSec: 2.5,
  recoveryHoldSec: 15,
  rounds: 3,
  prepCountdownSec: 5,
  useRoundSpecificHolds: false,
  roundHoldOverrides: [60, 75, 90, 90, 90],
  roundRetentionCues: false,
};

export const BREATH_PRESETS: BreathPreset[] = [
  {
    id: 'classic-30',
    name: 'Classic 30 × 3',
    subtitle: '30 rhythmic breaths across 3 rounds with 1-minute holds',
    config: {
      ...DEFAULT_CONFIG,
      breathCount: 30,
      inhaleSec: 2.0,
      exhaleSec: 2.0,
      holdSec: 60,
      recoveryInhaleSec: 2.5,
      recoveryHoldSec: 15,
      rounds: 3,
    },
  },
  {
    id: 'quick-reset',
    name: 'Quick Reset',
    subtitle: 'Crisp 15-breath single-round clarity cycle',
    config: {
      ...DEFAULT_CONFIG,
      breathCount: 15,
      inhaleSec: 1.8,
      exhaleSec: 1.8,
      holdSec: 30,
      recoveryInhaleSec: 2.5,
      recoveryHoldSec: 12,
      rounds: 1,
    },
  },
  {
    id: 'deep-40',
    name: 'Deep 40-Cycle',
    subtitle: 'Full 40-breath immersion across two steady rounds',
    config: {
      ...DEFAULT_CONFIG,
      breathCount: 40,
      inhaleSec: 2.2,
      exhaleSec: 2.2,
      holdSec: 75,
      recoveryInhaleSec: 3.0,
      recoveryHoldSec: 18,
      rounds: 2,
    },
  },
  {
    id: 'gentle-cadence',
    name: 'Gentle Cadence',
    subtitle: 'Slow nasal 20-breath rhythm with comfortable hold',
    config: {
      ...DEFAULT_CONFIG,
      breathCount: 20,
      inhaleSec: 3.5,
      exhaleSec: 3.5,
      holdSec: 40,
      recoveryInhaleSec: 3.0,
      recoveryHoldSec: 15,
      rounds: 2,
    },
  },
];

export const RECOVERY_EXHALE_SEC = 2.5;

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function clampConfig(partial: Partial<BreathConfig>): BreathConfig {
  const merged = { ...DEFAULT_CONFIG, ...partial };
  const baseHold = Math.round(clamp(merged.holdSec, 5, 240));
  const rawOverrides = Array.isArray(merged.roundHoldOverrides)
    ? merged.roundHoldOverrides
    : DEFAULT_CONFIG.roundHoldOverrides;

  const roundHoldOverrides = [0, 1, 2, 3, 4].map((idx) => {
    const val = rawOverrides[idx];
    return typeof val === 'number' && !Number.isNaN(val)
      ? Math.round(clamp(val, 5, 240))
      : baseHold;
  });

  return {
    breathCount: Math.round(clamp(merged.breathCount, 1, 40)),
    inhaleSec: Number(roundToStep(clamp(merged.inhaleSec, 1.0, 6.0), 0.1).toFixed(1)),
    exhaleSec: Number(roundToStep(clamp(merged.exhaleSec, 1.0, 6.0), 0.1).toFixed(1)),
    holdSec: baseHold,
    recoveryInhaleSec: Number(
      roundToStep(clamp(merged.recoveryInhaleSec, 2.0, 5.0), 0.5).toFixed(1)
    ),
    recoveryHoldSec: Math.round(clamp(merged.recoveryHoldSec, 5, 45)),
    rounds: Math.round(clamp(merged.rounds, 1, 5)),
    prepCountdownSec: Math.round(clamp(merged.prepCountdownSec, 0, 15)),
    useRoundSpecificHolds: Boolean(merged.useRoundSpecificHolds),
    roundHoldOverrides,
    roundRetentionCues: Boolean(merged.roundRetentionCues),
  };
}

export function getHoldDurationForRound(config: BreathConfig, round: number): number {
  if (
    config.rounds > 1 &&
    config.useRoundSpecificHolds &&
    Array.isArray(config.roundHoldOverrides)
  ) {
    const override = config.roundHoldOverrides[round - 1];
    if (typeof override === 'number' && !Number.isNaN(override)) {
      return Math.round(clamp(override, 5, 240));
    }
  }
  return Math.round(clamp(config.holdSec, 5, 240));
}

export function getPhaseDurationMs(
  phase: BreathPhase,
  config: BreathConfig,
  round = 1
): number {
  switch (phase) {
    case 'preparing':
      return Math.round(clamp(config.prepCountdownSec, 0, 15) * 1000);
    case 'inhale':
      return Math.round(config.inhaleSec * 1000);
    case 'exhale':
      return Math.round(config.exhaleSec * 1000);
    case 'hold':
      return Math.round(getHoldDurationForRound(config, round) * 1000);
    case 'recovery_inhale':
      return Math.round(config.recoveryInhaleSec * 1000);
    case 'recovery_hold':
      return Math.round(config.recoveryHoldSec * 1000);
    case 'recovery_exhale':
      return Math.round(RECOVERY_EXHALE_SEC * 1000);
    case 'idle':
    case 'completed':
    default:
      return 0;
  }
}

export function createInitialState(config: BreathConfig): BreathSessionState {
  const safe = clampConfig(config);
  return {
    config: safe,
    phase: 'idle',
    isPaused: false,
    interruptionReason: null,
    endedEarly: false,
    currentRound: 1,
    currentBreath: 1,
    phaseElapsedMs: 0,
    phaseDurationMs: 0,
    totalElapsedMs: 0,
    totalBreathsCompleted: 0,
  };
}

export function startSession(config: BreathConfig): BreathSessionState {
  const safe = clampConfig(config);
  const startPhase: BreathPhase = safe.prepCountdownSec > 0 ? 'preparing' : 'inhale';
  return {
    config: safe,
    phase: startPhase,
    isPaused: false,
    interruptionReason: null,
    endedEarly: false,
    currentRound: 1,
    currentBreath: 1,
    phaseElapsedMs: 0,
    phaseDurationMs: getPhaseDurationMs(startPhase, safe, 1),
    totalElapsedMs: 0,
    totalBreathsCompleted: 0,
  };
}

export function pauseForInterruption(
  state: BreathSessionState,
  reason: InterruptionReason = 'backgrounded'
): BreathSessionState {
  if (state.phase === 'idle' || state.phase === 'completed') {
    return state;
  }
  return {
    ...state,
    isPaused: true,
    interruptionReason: state.interruptionReason ?? reason,
  };
}

export function resumeFromPause(state: BreathSessionState): BreathSessionState {
  if (state.phase === 'idle' || state.phase === 'completed') {
    return state;
  }
  return {
    ...state,
    isPaused: false,
    interruptionReason: null,
  };
}

export function endSessionEarly(state: BreathSessionState): BreathSessionState {
  if (state.phase === 'idle') {
    return state;
  }
  return {
    ...state,
    phase: 'completed',
    isPaused: false,
    interruptionReason: null,
    endedEarly: true,
    phaseElapsedMs: 0,
    phaseDurationMs: 0,
  };
}

function advanceSinglePhase(
  state: BreathSessionState,
  carryMs: number
): { nextState: BreathSessionState; transition: PhaseTransition } {
  const { config, phase, currentRound, currentBreath, totalBreathsCompleted } = state;

  let nextPhase: BreathPhase = phase;
  let nextRound = currentRound;
  let nextBreath = currentBreath;
  let nextBreathsCompleted = totalBreathsCompleted;

  if (phase === 'preparing') {
    nextPhase = 'inhale';
    nextRound = 1;
    nextBreath = 1;
  } else if (phase === 'inhale') {
    nextPhase = 'exhale';
  } else if (phase === 'exhale') {
    nextBreathsCompleted += 1;
    if (currentBreath < config.breathCount) {
      nextBreath = currentBreath + 1;
      nextPhase = 'inhale';
    } else {
      nextPhase = 'hold';
    }
  } else if (phase === 'hold') {
    nextPhase = 'recovery_inhale';
  } else if (phase === 'recovery_inhale') {
    nextPhase = 'recovery_hold';
  } else if (phase === 'recovery_hold') {
    nextPhase = 'recovery_exhale';
  } else if (phase === 'recovery_exhale') {
    if (currentRound < config.rounds) {
      nextRound = currentRound + 1;
      nextBreath = 1;
      nextPhase = 'inhale';
    } else {
      nextPhase = 'completed';
    }
  }

  const nextDurationMs = getPhaseDurationMs(nextPhase, config, nextRound);

  return {
    nextState: {
      ...state,
      phase: nextPhase,
      currentRound: nextRound,
      currentBreath: nextBreath,
      phaseElapsedMs: nextPhase === 'completed' ? 0 : carryMs,
      phaseDurationMs: nextDurationMs,
      totalBreathsCompleted: nextBreathsCompleted,
    },
    transition: {
      from: phase,
      to: nextPhase,
      round: nextRound,
      breath: nextBreath,
    },
  };
}

export function stepSession(
  state: BreathSessionState,
  deltaMs: number
): { nextState: BreathSessionState; transition: PhaseTransition | null } {
  if (
    state.isPaused ||
    state.phase === 'idle' ||
    state.phase === 'completed' ||
    deltaMs <= 0
  ) {
    return { nextState: state, transition: null };
  }

  let working: BreathSessionState = {
    ...state,
    phaseElapsedMs: state.phaseElapsedMs + deltaMs,
    totalElapsedMs: state.totalElapsedMs + deltaMs,
  };

  let lastTransition: PhaseTransition | null = null;

  let guard = 0;
  while (
    working.phase !== 'completed' &&
    working.phase !== 'idle' &&
    working.phaseDurationMs > 0 &&
    working.phaseElapsedMs >= working.phaseDurationMs &&
    guard < 500
  ) {
    const overflow = working.phaseElapsedMs - working.phaseDurationMs;
    const result = advanceSinglePhase(working, overflow);
    working = result.nextState;
    lastTransition = result.transition;
    guard += 1;
  }

  return { nextState: working, transition: lastTransition };
}

export function skipToNextPhase(state: BreathSessionState): BreathSessionState {
  if (state.phase === 'idle' || state.phase === 'completed') {
    return state;
  }

  if (state.phase === 'preparing') {
    return {
      ...state,
      phase: 'inhale',
      currentRound: 1,
      currentBreath: 1,
      phaseElapsedMs: 0,
      phaseDurationMs: getPhaseDurationMs('inhale', state.config, 1),
    };
  }

  if (state.phase === 'inhale' || state.phase === 'exhale') {
    const breathsDoneInRound =
      state.phase === 'exhale' ? state.currentBreath : Math.max(0, state.currentBreath - 1);
    const priorRoundsBreaths = (state.currentRound - 1) * state.config.breathCount;
    return {
      ...state,
      phase: 'hold',
      currentBreath: state.config.breathCount,
      phaseElapsedMs: 0,
      phaseDurationMs: getPhaseDurationMs('hold', state.config, state.currentRound),
      totalBreathsCompleted: priorRoundsBreaths + breathsDoneInRound,
    };
  }

  if (state.phase === 'hold') {
    return {
      ...state,
      phase: 'recovery_inhale',
      phaseElapsedMs: 0,
      phaseDurationMs: getPhaseDurationMs('recovery_inhale', state.config, state.currentRound),
    };
  }

  if (state.phase === 'recovery_inhale' || state.phase === 'recovery_hold') {
    return {
      ...state,
      phase: 'recovery_exhale',
      phaseElapsedMs: 0,
      phaseDurationMs: getPhaseDurationMs('recovery_exhale', state.config, state.currentRound),
    };
  }

  if (state.phase === 'recovery_exhale') {
    if (state.currentRound < state.config.rounds) {
      const nextRound = state.currentRound + 1;
      return {
        ...state,
        phase: 'inhale',
        currentRound: nextRound,
        currentBreath: 1,
        phaseElapsedMs: 0,
        phaseDurationMs: getPhaseDurationMs('inhale', state.config, nextRound),
      };
    }
    return {
      ...state,
      phase: 'completed',
      phaseElapsedMs: 0,
      phaseDurationMs: 0,
    };
  }

  return state;
}

export function getPhaseProgress(state: BreathSessionState): number {
  if (state.phaseDurationMs <= 0) return 0;
  return clamp(state.phaseElapsedMs / state.phaseDurationMs, 0, 1);
}

/**
 * Smooth sinusoidal easing curve returning normalized lung fullness [0..1]
 */
export function getBreathVisualScale(phase: BreathPhase, progress: number): number {
  const t = clamp(progress, 0, 1);
  const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;

  switch (phase) {
    case 'idle':
      return 0.32;
    case 'preparing':
      return 0.36;
    case 'inhale':
      return 0.16 + 0.84 * easeInOutSine(t);
    case 'exhale':
      return 1.0 - 0.84 * easeInOutSine(t);
    case 'hold':
      return 0.16;
    case 'recovery_inhale':
      return 0.16 + 0.84 * easeInOutSine(t);
    case 'recovery_hold':
      return 1.0;
    case 'recovery_exhale':
      return 1.0 - 0.72 * easeInOutSine(t);
    case 'completed':
      return 0.42;
    default:
      return 0.32;
  }
}

export function getPhaseLabel(phase: BreathPhase): string {
  switch (phase) {
    case 'idle':
      return 'Ready';
    case 'preparing':
      return 'Settle In';
    case 'inhale':
      return 'Inhale';
    case 'exhale':
      return 'Exhale';
    case 'hold':
      return 'Breath Hold';
    case 'recovery_inhale':
      return 'Recovery Inhale';
    case 'recovery_hold':
      return 'Recovery Hold';
    case 'recovery_exhale':
      return 'Release Exhale';
    case 'completed':
      return 'Session Complete';
  }
}

export function getPhaseInstruction(phase: BreathPhase): string {
  switch (phase) {
    case 'idle':
      return 'Adjust your cadence and press Start when comfortable.';
    case 'preparing':
      return 'Find a comfortable seated or lying posture and soften your shoulders.';
    case 'inhale':
      return 'Draw air smoothly into the belly, then expand the chest.';
    case 'exhale':
      return 'Let go passively without forcing the breath out.';
    case 'hold':
      return 'Rest comfortably after the exhale. Take your recovery breath anytime.';
    case 'recovery_inhale':
      return 'Take one full, deep breath all the way in.';
    case 'recovery_hold':
      return 'Hold the recovery breath calmly at the top.';
    case 'recovery_exhale':
      return 'Exhale slowly and return to natural breathing.';
    case 'completed':
      return 'Take a moment to breathe naturally before getting up.';
  }
}

export function formatSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.ceil(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function estimateSessionDurationSec(config: BreathConfig): number {
  const safe = clampConfig(config);
  const roundBreathSec = safe.breathCount * (safe.inhaleSec + safe.exhaleSec);
  let totalSec = safe.prepCountdownSec;
  for (let r = 1; r <= safe.rounds; r++) {
    totalSec +=
      roundBreathSec +
      getHoldDurationForRound(safe, r) +
      safe.recoveryInhaleSec +
      safe.recoveryHoldSec +
      RECOVERY_EXHALE_SEC;
  }
  return Math.round(totalSec);
}
