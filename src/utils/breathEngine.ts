export type BreathPhase =
  | 'idle'
  | 'inhale'
  | 'exhale'
  | 'hold'
  | 'recovery_inhale'
  | 'recovery_hold'
  | 'recovery_exhale'
  | 'completed';

export interface BreathConfig {
  breathCount: number; // 1 - 40
  inhaleSec: number; // 1.0 - 6.0
  exhaleSec: number; // 1.0 - 6.0
  holdSec: number; // 5 - 240
  recoveryInhaleSec: number; // 2.0 - 5.0
  recoveryHoldSec: number; // 5 - 45
  rounds: number; // 1 - 5
}

export interface BreathPreset {
  id: string;
  name: string;
  subtitle: string;
  config: BreathConfig;
}

export interface BreathSessionState {
  config: BreathConfig;
  phase: BreathPhase;
  isPaused: boolean;
  currentRound: number;
  currentBreath: number;
  phaseElapsedMs: number;
  phaseDurationMs: number;
  totalElapsedMs: number;
  totalBreathsCompleted: number;
  holdDurationsAchievedSec: number[];
}

export interface SessionRecord {
  id: string;
  timestamp: number;
  presetName: string;
  breathsPerRound: number;
  roundsCompleted: number;
  totalBreaths: number;
  holdLengthsSec: number[];
  recoveryHoldSec: number;
  totalDurationSec: number;
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
  rounds: 1,
};

export const BREATH_PRESETS: BreathPreset[] = [
  {
    id: 'classic-30',
    name: 'Classic 30',
    subtitle: 'Balanced 30-breath energizer with 1-minute hold',
    config: {
      breathCount: 30,
      inhaleSec: 2.0,
      exhaleSec: 2.0,
      holdSec: 60,
      recoveryInhaleSec: 2.5,
      recoveryHoldSec: 15,
      rounds: 1,
    },
  },
  {
    id: 'quick-reset',
    name: 'Quick Reset',
    subtitle: 'Crisp 15-breath midday clarity cycle',
    config: {
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
    subtitle: 'Full 40-breath immersion across two rounds',
    config: {
      breathCount: 40,
      inhaleSec: 2.2,
      exhaleSec: 2.2,
      holdSec: 90,
      recoveryInhaleSec: 3.0,
      recoveryHoldSec: 20,
      rounds: 2,
    },
  },
  {
    id: 'gentle-cadence',
    name: 'Gentle Cadence',
    subtitle: 'Slow nasal 20-breath rhythm with moderate hold',
    config: {
      breathCount: 20,
      inhaleSec: 3.5,
      exhaleSec: 3.5,
      holdSec: 45,
      recoveryInhaleSec: 3.0,
      recoveryHoldSec: 15,
      rounds: 1,
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
  return {
    breathCount: Math.round(clamp(merged.breathCount, 1, 40)),
    inhaleSec: Number(roundToStep(clamp(merged.inhaleSec, 1.0, 6.0), 0.1).toFixed(1)),
    exhaleSec: Number(roundToStep(clamp(merged.exhaleSec, 1.0, 6.0), 0.1).toFixed(1)),
    holdSec: Math.round(clamp(merged.holdSec, 5, 240)),
    recoveryInhaleSec: Number(
      roundToStep(clamp(merged.recoveryInhaleSec, 2.0, 5.0), 0.5).toFixed(1)
    ),
    recoveryHoldSec: Math.round(clamp(merged.recoveryHoldSec, 5, 45)),
    rounds: Math.round(clamp(merged.rounds, 1, 5)),
  };
}

export function getPhaseDurationMs(phase: BreathPhase, config: BreathConfig): number {
  switch (phase) {
    case 'inhale':
      return Math.round(config.inhaleSec * 1000);
    case 'exhale':
      return Math.round(config.exhaleSec * 1000);
    case 'hold':
      return Math.round(config.holdSec * 1000);
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
    currentRound: 1,
    currentBreath: 1,
    phaseElapsedMs: 0,
    phaseDurationMs: 0,
    totalElapsedMs: 0,
    totalBreathsCompleted: 0,
    holdDurationsAchievedSec: [],
  };
}

export function startSession(config: BreathConfig): BreathSessionState {
  const safe = clampConfig(config);
  return {
    config: safe,
    phase: 'inhale',
    isPaused: false,
    currentRound: 1,
    currentBreath: 1,
    phaseElapsedMs: 0,
    phaseDurationMs: getPhaseDurationMs('inhale', safe),
    totalElapsedMs: 0,
    totalBreathsCompleted: 0,
    holdDurationsAchievedSec: [],
  };
}

function advanceSinglePhase(
  state: BreathSessionState,
  carryMs: number
): { nextState: BreathSessionState; transition: PhaseTransition } {
  const { config, phase, currentRound, currentBreath, totalBreathsCompleted, holdDurationsAchievedSec } =
    state;

  let nextPhase: BreathPhase = phase;
  let nextRound = currentRound;
  let nextBreath = currentBreath;
  let nextBreathsCompleted = totalBreathsCompleted;
  let nextHolds = holdDurationsAchievedSec;

  if (phase === 'inhale') {
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
    const achievedSec = Math.round(state.phaseDurationMs / 1000);
    nextHolds = [...holdDurationsAchievedSec, achievedSec];
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

  const nextDurationMs = getPhaseDurationMs(nextPhase, config);

  return {
    nextState: {
      ...state,
      phase: nextPhase,
      currentRound: nextRound,
      currentBreath: nextBreath,
      phaseElapsedMs: nextPhase === 'completed' ? 0 : carryMs,
      phaseDurationMs: nextDurationMs,
      totalBreathsCompleted: nextBreathsCompleted,
      holdDurationsAchievedSec: nextHolds,
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

  // Handle arbitrary deltaMs cleanly by walking through completed phases
  let guard = 0;
  while (
    working.phase !== 'completed' &&
    working.phase !== 'idle' &&
    working.phaseDurationMs > 0 &&
    working.phaseElapsedMs >= working.phaseDurationMs &&
    guard < 120
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

  if (state.phase === 'inhale' || state.phase === 'exhale') {
    const breathsDoneInRound =
      state.phase === 'exhale' ? state.currentBreath : Math.max(0, state.currentBreath - 1);
    const priorRoundsBreaths = (state.currentRound - 1) * state.config.breathCount;
    return {
      ...state,
      phase: 'hold',
      currentBreath: state.config.breathCount,
      phaseElapsedMs: 0,
      phaseDurationMs: getPhaseDurationMs('hold', state.config),
      totalBreathsCompleted: priorRoundsBreaths + breathsDoneInRound,
    };
  }

  if (state.phase === 'hold') {
    const actualHoldSec = Math.max(1, Math.round(state.phaseElapsedMs / 1000));
    return {
      ...state,
      phase: 'recovery_inhale',
      phaseElapsedMs: 0,
      phaseDurationMs: getPhaseDurationMs('recovery_inhale', state.config),
      holdDurationsAchievedSec: [...state.holdDurationsAchievedSec, actualHoldSec],
    };
  }

  if (state.phase === 'recovery_inhale' || state.phase === 'recovery_hold') {
    return {
      ...state,
      phase: 'recovery_exhale',
      phaseElapsedMs: 0,
      phaseDurationMs: getPhaseDurationMs('recovery_exhale', state.config),
    };
  }

  if (state.phase === 'recovery_exhale') {
    if (state.currentRound < state.config.rounds) {
      return {
        ...state,
        phase: 'inhale',
        currentRound: state.currentRound + 1,
        currentBreath: 1,
        phaseElapsedMs: 0,
        phaseDurationMs: getPhaseDurationMs('inhale', state.config),
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

export function extendHold(state: BreathSessionState, extraSec: number): BreathSessionState {
  if (state.phase !== 'hold' || extraSec <= 0) {
    return state;
  }
  const maxHoldMs = 600 * 1000;
  const nextDuration = Math.min(maxHoldMs, state.phaseDurationMs + Math.round(extraSec * 1000));
  return {
    ...state,
    phaseDurationMs: nextDuration,
  };
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
    case 'inhale':
      return 0.16 + 0.84 * easeInOutSine(t);
    case 'exhale':
      return 1.0 - 0.84 * easeInOutSine(t);
    case 'hold':
      // Gentle resting compression during empty-lung retention
      return 0.16;
    case 'recovery_inhale':
      return 0.16 + 0.84 * easeInOutSine(t);
    case 'recovery_hold':
      // Full, steady lung expansion during recovery hold
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
    case 'inhale':
      return 'Draw air smoothly into the belly, then expand the chest.';
    case 'exhale':
      return 'Let go passively without forcing the breath out.';
    case 'hold':
      return 'Rest in stillness after the exhale. Release early anytime.';
    case 'recovery_inhale':
      return 'Take one full, deep breath all the way in.';
    case 'recovery_hold':
      return 'Hold the recovery breath calmly at the top.';
    case 'recovery_exhale':
      return 'Exhale slowly and settle.';
    case 'completed':
      return 'Take a moment to notice the quiet shift in your body.';
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
  const perRoundSec =
    roundBreathSec +
    safe.holdSec +
    safe.recoveryInhaleSec +
    safe.recoveryHoldSec +
    RECOVERY_EXHALE_SEC;
  return Math.round(perRoundSec * safe.rounds);
}
