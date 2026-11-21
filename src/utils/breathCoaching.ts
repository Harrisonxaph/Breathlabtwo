import { BreathSessionState, formatSeconds } from './breathEngine';

export interface AudioProgressUpdate {
  key: string;
  text: string;
  tone: 'milestone' | 'countdown';
}

/**
 * Returns calm, context-aware encouraging words for the on-screen visualizer
 * based on current breath cycle, elapsed hold time, round, and completion.
 */
export function getEncouragingInstruction(state: BreathSessionState): string {
  const { phase, config, currentBreath, currentRound, phaseElapsedMs, phaseDurationMs } = state;

  switch (phase) {
    case 'idle':
      return 'Adjust your cadence, settle your posture, and press Start when ready.';

    case 'inhale':
    case 'exhale': {
      const total = config.breathCount;

      if (currentBreath === 1 && currentRound > 1 && phase === 'inhale') {
        return `Round ${currentRound} of ${config.rounds} — carry that calm, open focus forward.`;
      }

      if (currentBreath === 1) {
        return phase === 'inhale'
          ? 'Find your steady rhythm — breathe smoothly into your belly, then chest.'
          : 'Soft, unforced release — let the chest drop naturally.';
      }

      if (currentBreath === total) {
        return phase === 'inhale'
          ? 'Final deep breath of this round — fill up smoothly and prepare to let go.'
          : 'Final exhale — empty gently and settle into stillness.';
      }

      if (total >= 8 && currentBreath >= total - 2) {
        return 'Almost into stillness — keep these last few breaths light and effortless.';
      }

      if (total >= 10 && currentBreath === Math.ceil(total / 2)) {
        return `Halfway there (${currentBreath}/${total}) — soften your jaw and drop your shoulders.`;
      }

      if (total >= 16 && currentBreath === Math.round(total * 0.25)) {
        return 'Great cadence — stay relaxed and let each exhale release tension.';
      }

      if (total >= 16 && currentBreath === Math.round(total * 0.75)) {
        return 'Three-quarters complete — steady rhythm, calm mind.';
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
        return '10 seconds remaining — stay soft until your deep recovery breath.';
      }
      if (elapsedSec >= 120) {
        return 'Over two minutes — deep, quiet stillness. Recover whenever you wish.';
      }
      if (elapsedSec >= 90) {
        return '90 seconds — effortless presence. Let every muscle stay loose.';
      }
      if (elapsedSec >= 60) {
        return 'Over one minute of stillness — remarkable calm and ease.';
      }
      if (elapsedSec >= 45) {
        return '45 seconds — steady and composed. Release early anytime.';
      }
      if (elapsedSec >= 30) {
        return '30 seconds in — trust the quiet and release any tension.';
      }
      if (elapsedSec >= 15) {
        return '15 seconds — doing great, soften your shoulders and jaw.';
      }
      return 'Rest in stillness after the exhale. Release early anytime.';
    }

    case 'recovery_inhale':
      return 'Take one full, nourishing breath all the way to the top.';

    case 'recovery_hold': {
      const durationSec = phaseDurationMs / 1000;
      const remainingSec = Math.max(0, (phaseDurationMs - phaseElapsedMs) / 1000);
      if (durationSec >= 12 && remainingSec <= 5) {
        return 'Almost ready to release — stay calm and steady.';
      }
      return 'Hold the recovery breath gently at the top — soak in the reset.';
    }

    case 'recovery_exhale':
      return currentRound < config.rounds
        ? 'Exhale slowly and reset — next round begins in a moment.'
        : 'Exhale slowly and settle. Well done on completing this cycle.';

    case 'completed': {
      const bestHold =
        state.holdDurationsAchievedSec.length > 0
          ? Math.max(...state.holdDurationsAchievedSec)
          : 0;
      if (bestHold > 0) {
        return `Well done — ${state.totalBreathsCompleted} breaths and a ${formatSeconds(bestHold)} peak hold completed.`;
      }
      return 'Well done — take a quiet moment to notice the calm in your body.';
    }
  }
}

/**
 * Generates concise spoken transition cues for phase changes, weaving in
 * milestone encouragement without overlapping short inhale/exhale intervals.
 */
export function getTransitionSpeechText(state: BreathSessionState): string {
  const { phase, config, currentBreath, currentRound } = state;
  const total = config.breathCount;

  switch (phase) {
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
        return 'Three left';
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
      return 'Breath hold. Relax and soften.';

    case 'recovery_inhale':
      return 'Deep recovery breath in';

    case 'recovery_hold':
      return 'Hold calmly';

    case 'recovery_exhale':
      return currentRound < config.rounds ? 'Release slowly' : 'Release slowly. Well done.';

    case 'completed':
      return 'Session complete. Great work.';

    case 'idle':
    default:
      return '';
  }
}

const HOLD_CHECKPOINTS_SEC: { sec: number; minDuration: number; text: string }[] = [
  { sec: 15, minDuration: 30, text: '15 seconds. Stay relaxed.' },
  { sec: 30, minDuration: 45, text: '30 seconds. Calm and steady.' },
  { sec: 45, minDuration: 65, text: '45 seconds. Doing great.' },
  { sec: 60, minDuration: 75, text: 'One minute. Effortless stillness.' },
  { sec: 90, minDuration: 105, text: '90 seconds. Deep calm.' },
  { sec: 120, minDuration: 135, text: 'Two minutes. Stay completely loose.' },
  { sec: 150, minDuration: 165, text: 'Two minutes thirty. Steady focus.' },
  { sec: 180, minDuration: 195, text: 'Three minutes. Remarkable presence.' },
];

/**
 * Evaluates whether a mid-phase audio update (such as hold time milestones
 * or final-seconds reminders) should fire between prevState and nextState.
 * Emitted keys are tracked in `emittedKeys` so updates fire at most once per round.
 */
export function evaluateProgressAudioUpdate(
  prevState: BreathSessionState,
  nextState: BreathSessionState,
  emittedKeys: Set<string>
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

    for (const cp of HOLD_CHECKPOINTS_SEC) {
      if (durationSec < cp.minDuration) continue;
      // Avoid firing an elapsed checkpoint right on top of the 10s-remaining cue
      if (durationSec >= 25 && Math.abs(durationSec - 10 - cp.sec) <= 4) continue;

      const key = `${roundPrefix}-hold-${cp.sec}`;
      if (!emittedKeys.has(key) && prevElapsedSec < cp.sec && nextElapsedSec >= cp.sec) {
        emittedKeys.add(key);
        return {
          key,
          text: cp.text,
          tone: 'milestone',
        };
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

  if (nextState.phase === 'recovery_hold') {
    const durationSec = nextState.phaseDurationMs / 1000;
    if (durationSec >= 15) {
      const prevRemainingSec = Math.max(0, (prevState.phaseDurationMs - prevState.phaseElapsedMs) / 1000);
      const nextRemainingSec = Math.max(0, (nextState.phaseDurationMs - nextState.phaseElapsedMs) / 1000);
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
