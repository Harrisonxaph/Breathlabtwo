import { BreathSessionState } from './breathEngine';
import { NarrationLevel } from './breathAudioPolicy';

export interface AudioProgressUpdate {
  key: string;
  text: string;
  tone: 'milestone' | 'countdown';
}

/**
 * Returns calm, non-competitive guidance for the on-screen visualizer
 * based on phase, round, and body-listening safety cues.
 */
export function getEncouragingInstruction(state: BreathSessionState): string {
  const {
    phase,
    config,
    currentBreath,
    currentRound,
    phaseElapsedMs,
    phaseDurationMs,
    endedEarly,
    interruptionReason,
    isPaused,
  } = state;

  if (isPaused && interruptionReason) {
    return 'Session paused — take a few easy, natural breaths before resuming.';
  }

  switch (phase) {
    case 'idle':
      return 'Adjust your cadence, sit or lie somewhere safe, and press Start when ready.';

    case 'preparing':
      return 'Settle into a comfortable posture — relax your jaw and shoulders.';

    case 'inhale':
    case 'exhale': {
      const total = config.breathCount;

      if (currentBreath === 1 && currentRound > 1 && phase === 'inhale') {
        return `Round ${currentRound} of ${config.rounds} — move at a calm, unforced pace.`;
      }

      if (currentBreath === 1) {
        return phase === 'inhale'
          ? 'Find your steady rhythm — breathe smoothly into your belly, then chest.'
          : 'Soft, unforced release — let the chest drop naturally.';
      }

      if (currentBreath === total) {
        return phase === 'inhale'
          ? 'Final breath of this round — fill up smoothly and prepare to let go.'
          : 'Final exhale — empty gently and rest in stillness.';
      }

      if (total >= 8 && currentBreath >= total - 2) {
        return 'Almost into stillness — keep these last few breaths light and effortless.';
      }

      if (total >= 10 && currentBreath === Math.ceil(total / 2)) {
        return `Halfway through round ${currentRound} (${currentBreath}/${total}) — soften your jaw and shoulders.`;
      }

      if (total >= 16 && currentBreath === Math.round(total * 0.25)) {
        return 'Steady cadence — stay relaxed and let each exhale release tension.';
      }

      if (total >= 16 && currentBreath === Math.round(total * 0.75)) {
        return 'Three-quarters through this round — comfortable, unforced rhythm.';
      }

      return phase === 'inhale'
        ? 'Draw air smoothly into the belly, then expand the chest.'
        : 'Let go passively without forcing the breath out.';
    }

    case 'hold': {
      const elapsedSec = phaseElapsedMs / 1000;
      const durationSec = phaseDurationMs / 1000;
      const remainingSec = Math.max(0, durationSec - elapsedSec);

      if (durationSec >= 25 && remainingSec <= 10) {
        return '10 seconds left — stay relaxed until your recovery breath, or recover now if ready.';
      }

      if (config.roundRetentionCues && config.rounds > 1 && elapsedSec < 15) {
        return `Round ${currentRound} retention — soften your body and breathe whenever you feel ready.`;
      }

      if (elapsedSec >= 60) {
        return 'Resting comfortably in stillness — take your recovery breath anytime your body signals.';
      }
      if (elapsedSec >= 30) {
        return 'Quiet stillness — keep your shoulders loose and recover whenever you wish.';
      }
      if (elapsedSec >= 15) {
        return 'Doing well — no need to strain; take your recovery breath anytime.';
      }
      return 'Rest softly after the exhale. Take your recovery breath anytime you feel the urge.';
    }

    case 'recovery_inhale':
      return 'Take one full, comfortable recovery breath all the way in.';

    case 'recovery_hold': {
      const durationSec = phaseDurationMs / 1000;
      const remainingSec = Math.max(0, (phaseDurationMs - phaseElapsedMs) / 1000);
      if (durationSec >= 12 && remainingSec <= 5) {
        return 'Almost ready to release — let your neck and shoulders stay soft.';
      }
      return 'Rest gently with the recovery breath at the top.';
    }

    case 'recovery_exhale':
      return currentRound < config.rounds
        ? 'Exhale slowly and allow your breathing to settle before the next round.'
        : 'Exhale slowly and return to your natural breathing rhythm.';

    case 'completed': {
      if (endedEarly) {
        return 'Session ended safely — breathe normally and take a moment before standing.';
      }
      return `Session complete — ${state.totalBreathsCompleted} breaths across ${config.rounds} ${config.rounds === 1 ? 'round' : 'rounds'}. Allow breathing to settle before getting up.`;
    }
  }
}

/**
 * Generates concise spoken transition cues for phase changes without competitive hold phrasing.
 */
export function getTransitionSpeechText(state: BreathSessionState): string {
  const { phase, config, currentBreath, currentRound } = state;
  const total = config.breathCount;

  switch (phase) {
    case 'preparing':
      return 'Find a comfortable position';

    case 'inhale': {
      if (currentBreath === 1 && currentRound > 1) {
        return `Round ${currentRound}. Inhale`;
      }
      if (total >= 6 && currentBreath === total) {
        return 'Final breath in';
      }
      if (total >= 10 && currentBreath === Math.ceil(total / 2)) {
        return 'Halfway. Inhale';
      }
      if (total >= 15 && currentBreath === total - 4) {
        return 'Five breaths left';
      }
      if (total >= 10 && currentBreath === total - 2) {
        return 'Last few breaths';
      }
      if (total >= 12 && currentBreath % 10 === 0 && currentBreath < total) {
        return `${currentBreath} breaths`;
      }
      return 'Inhale';
    }

    case 'exhale': {
      if (total >= 4 && currentBreath === total) {
        return 'Last exhale';
      }
      return 'Exhale';
    }

    case 'hold':
      if (config.roundRetentionCues && config.rounds > 1) {
        return `Round ${currentRound} breath hold. Breathe whenever your body needs to.`;
      }
      return 'Rest after the exhale. Breathe whenever your body needs to.';

    case 'recovery_inhale':
      return 'Deep comfortable recovery breath in';

    case 'recovery_hold':
      return 'Rest gently with that breath';

    case 'recovery_exhale':
      return currentRound < config.rounds
        ? 'Release and settle for the next round'
        : 'Release and return to natural breath.';

    case 'completed':
      return 'Your breathing session is complete. Take a moment before standing.';

    case 'idle':
    default:
      return '';
  }
}

const HOLD_CHECKPOINTS_SEC: { sec: number; minDuration: number; text: string; activeOnly?: boolean }[] = [
  { sec: 15, minDuration: 30, text: '15 seconds. Keep your shoulders relaxed.', activeOnly: true },
  { sec: 30, minDuration: 45, text: '30 seconds. No rush, breathe anytime.' },
  { sec: 45, minDuration: 65, text: '45 seconds. Stay soft and comfortable.', activeOnly: true },
  { sec: 60, minDuration: 75, text: 'One minute elapsed. Recover whenever ready.' },
  { sec: 90, minDuration: 105, text: '90 seconds elapsed. Breathe anytime you wish.' },
  { sec: 120, minDuration: 135, text: 'Two minutes elapsed. Stay comfortable.', activeOnly: true },
  { sec: 150, minDuration: 165, text: 'Two minutes thirty. Recover whenever ready.', activeOnly: true },
  { sec: 180, minDuration: 195, text: 'Three minutes elapsed. Breathe whenever ready.', activeOnly: true },
];

/**
 * Evaluates whether a mid-phase audio update should fire based on narration level.
 */
export function evaluateProgressAudioUpdate(
  prevState: BreathSessionState,
  nextState: BreathSessionState,
  emittedKeys: Set<string>,
  narrationLevel: NarrationLevel = 'balanced'
): AudioProgressUpdate | null {
  if (nextState.isPaused || prevState.phase !== nextState.phase) {
    return null;
  }

  if (nextState.phase === 'hold') {
    const prevElapsedSec = prevState.phaseElapsedMs / 1000;
    const nextElapsedSec = nextState.phaseElapsedMs / 1000;
    const durationSec = nextState.phaseDurationMs / 1000;
    const prevRemainingSec = Math.max(0, durationSec - prevElapsedSec);
    const nextRemainingSec = Math.max(0, durationSec - nextElapsedSec);
    const roundPrefix = `r${nextState.currentRound}`;

    if (narrationLevel !== 'minimal') {
      for (const cp of HOLD_CHECKPOINTS_SEC) {
        if (cp.activeOnly && narrationLevel !== 'active') continue;
        if (durationSec < cp.minDuration) continue;
        if (durationSec >= 25 && Math.abs(durationSec - 10 - cp.sec) <= 4) continue;

        const key = `${roundPrefix}-hold-${cp.sec}`;
        if (!emittedKeys.has(key) && prevElapsedSec < cp.sec && nextElapsedSec >= cp.sec) {
          emittedKeys.add(key);
          const roundTag =
            nextState.config.roundRetentionCues && nextState.config.rounds > 1
              ? `Round ${nextState.currentRound}: `
              : '';
          return {
            key,
            text: `${roundTag}${cp.text}`,
            tone: 'milestone',
          };
        }
      }
    }

    if (durationSec >= 25) {
      const countdownKey = `${roundPrefix}-hold-rem-10`;
      if (!emittedKeys.has(countdownKey) && prevRemainingSec > 10 && nextRemainingSec <= 10) {
        emittedKeys.add(countdownKey);
        return {
          key: countdownKey,
          text: '10 seconds remaining.',
          tone: 'countdown',
        };
      }
    }
  }

  if (nextState.phase === 'recovery_hold' && narrationLevel !== 'minimal') {
    const durationSec = nextState.phaseDurationMs / 1000;
    if (durationSec >= 15) {
      const prevRemainingSec = Math.max(
        0,
        (prevState.phaseDurationMs - prevState.phaseElapsedMs) / 1000
      );
      const nextRemainingSec = Math.max(
        0,
        (nextState.phaseDurationMs - nextState.phaseElapsedMs) / 1000
      );
      const key = `r${nextState.currentRound}-rec-rem-5`;
      if (!emittedKeys.has(key) && prevRemainingSec > 5 && nextRemainingSec <= 5) {
        emittedKeys.add(key);
        return {
          key,
          text: '5 seconds left.',
          tone: 'countdown',
        };
      }
    }
  }

  return null;
}
