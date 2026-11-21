import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  clampConfig,
  createInitialState,
  endSessionEarly,
  estimateSessionDurationSec,
  formatSeconds,
  getBreathVisualScale,
  getHoldDurationForRound,
  pauseForInterruption,
  resumeFromPause,
  skipToNextPhase,
  startSession,
  stepSession,
} from './breathEngine';

test('DEFAULT_CONFIG defaults to 30 breaths x 3 rounds', () => {
  assert.equal(DEFAULT_CONFIG.breathCount, 30);
  assert.equal(DEFAULT_CONFIG.rounds, 3);
  assert.equal(DEFAULT_CONFIG.prepCountdownSec, 5);
});

test('clampConfig enforces 1-40 breath bounds, prep countdown, and round overrides', () => {
  const low = clampConfig({
    breathCount: -5,
    inhaleSec: 0.2,
    holdSec: 1,
    recoveryHoldSec: 1,
    rounds: 0,
    prepCountdownSec: -3,
  });
  assert.equal(low.breathCount, 1);
  assert.equal(low.inhaleSec, 1.0);
  assert.equal(low.holdSec, 5);
  assert.equal(low.recoveryHoldSec, 5);
  assert.equal(low.rounds, 1);
  assert.equal(low.prepCountdownSec, 0);

  const high = clampConfig({
    breathCount: 99,
    exhaleSec: 12,
    holdSec: 999,
    recoveryHoldSec: 120,
    rounds: 10,
    prepCountdownSec: 60,
    useRoundSpecificHolds: true,
    roundHoldOverrides: [3, 45, 300, 90, 90],
  });
  assert.equal(high.breathCount, 40);
  assert.equal(high.exhaleSec, 6.0);
  assert.equal(high.holdSec, 240);
  assert.equal(high.recoveryHoldSec, 45);
  assert.equal(high.rounds, 5);
  assert.equal(high.prepCountdownSec, 15);
  assert.equal(getHoldDurationForRound(high, 1), 5);
  assert.equal(getHoldDurationForRound(high, 2), 45);
  assert.equal(getHoldDurationForRound(high, 3), 240);

  const singleRound = clampConfig({
    rounds: 1,
    holdSec: 55,
    useRoundSpecificHolds: true,
    roundHoldOverrides: [25, 45, 60, 75, 90],
  });
  assert.equal(getHoldDurationForRound(singleRound, 1), 55);
});

test('session progresses cleanly from preparing through breaths, hold, recovery, and completion', () => {
  const config = clampConfig({
    breathCount: 2,
    inhaleSec: 2,
    exhaleSec: 2,
    holdSec: 10,
    recoveryInhaleSec: 2.5,
    recoveryHoldSec: 10,
    rounds: 1,
    prepCountdownSec: 3,
  });

  let state = startSession(config);
  assert.equal(state.phase, 'preparing');

  // Preparing (3000ms) -> Breath 1 inhale
  let res = stepSession(state, 3000);
  state = res.nextState;
  assert.equal(state.phase, 'inhale');
  assert.equal(state.currentBreath, 1);
  assert.equal(res.transition?.to, 'inhale');

  // Breath 1 inhale (2000ms) -> exhale
  res = stepSession(state, 2000);
  state = res.nextState;
  assert.equal(state.phase, 'exhale');
  assert.equal(state.currentBreath, 1);

  // Breath 1 exhale (2000ms) -> Breath 2 inhale
  res = stepSession(state, 2000);
  state = res.nextState;
  assert.equal(state.phase, 'inhale');
  assert.equal(state.currentBreath, 2);
  assert.equal(state.totalBreathsCompleted, 1);

  // Breath 2 inhale + exhale -> hold
  res = stepSession(state, 4000);
  state = res.nextState;
  assert.equal(state.phase, 'hold');
  assert.equal(state.totalBreathsCompleted, 2);

  // Hold (10000ms) -> recovery_inhale
  res = stepSession(state, 10000);
  state = res.nextState;
  assert.equal(state.phase, 'recovery_inhale');

  // Recovery inhale (2500ms) -> recovery_hold
  res = stepSession(state, 2500);
  state = res.nextState;
  assert.equal(state.phase, 'recovery_hold');

  // Recovery hold (10000ms) -> recovery_exhale
  res = stepSession(state, 10000);
  state = res.nextState;
  assert.equal(state.phase, 'recovery_exhale');

  // Recovery exhale (2500ms) -> completed
  res = stepSession(state, 2500);
  state = res.nextState;
  assert.equal(state.phase, 'completed');
  assert.equal(state.endedEarly, false);
});

test('multi-round session uses round-specific hold overrides and completes without drift', () => {
  const config = clampConfig({
    breathCount: 1,
    inhaleSec: 1,
    exhaleSec: 1,
    holdSec: 5,
    recoveryInhaleSec: 2,
    recoveryHoldSec: 5,
    rounds: 2,
    prepCountdownSec: 0,
    useRoundSpecificHolds: true,
    roundHoldOverrides: [5, 10, 15, 15, 15],
  });

  let state = startSession(config);
  assert.equal(state.phase, 'inhale');

  // Irregular wall-clock steps summing to 16500ms (1+1+5+2+5+2.5 = 16.5s)
  for (const dt of [420, 1850, 7230, 3500, 3500]) {
    state = stepSession(state, dt).nextState;
  }
  assert.equal(state.phase, 'inhale');
  assert.equal(state.currentRound, 2);
  assert.equal(state.currentBreath, 1);

  // Round 2 uses 10s hold (1+1+10+2+5+2.5 = 21.5s)
  state = stepSession(state, 2000).nextState;
  assert.equal(state.phase, 'hold');
  assert.equal(state.phaseDurationMs, 10000);

  state = stepSession(state, 19500).nextState;
  assert.equal(state.phase, 'completed');
  assert.equal(state.totalBreathsCompleted, 2);
});

test('interruption auto-pause, resumeFromPause, skipToNextPhase, and endSessionEarly', () => {
  const config = clampConfig({
    breathCount: 30,
    inhaleSec: 2,
    exhaleSec: 2,
    holdSec: 60,
    prepCountdownSec: 3,
  });
  let state = startSession(config);
  assert.equal(state.phase, 'preparing');

  // Skip preparation immediately
  state = skipToNextPhase(state);
  assert.equal(state.phase, 'inhale');

  // Step 5s -> breath 2 inhale
  state = stepSession(state, 5000).nextState;
  assert.equal(state.currentBreath, 2);

  // Simulate background interruption
  state = pauseForInterruption(state, 'backgrounded');
  assert.equal(state.isPaused, true);
  assert.equal(state.interruptionReason, 'backgrounded');

  // Paused session does not advance
  const pausedStep = stepSession(state, 4000).nextState;
  assert.equal(pausedStep.phaseElapsedMs, state.phaseElapsedMs);

  // Resume cleanly clears interruptionReason
  state = resumeFromPause(state);
  assert.equal(state.isPaused, false);
  assert.equal(state.interruptionReason, null);

  // Skip to hold, then Take Recovery Breath
  state = skipToNextPhase(state);
  assert.equal(state.phase, 'hold');
  state = skipToNextPhase(state);
  assert.equal(state.phase, 'recovery_inhale');

  // End session early marks endedEarly = true
  state = endSessionEarly(state);
  assert.equal(state.phase, 'completed');
  assert.equal(state.endedEarly, true);
});

test('idle session does not advance and duration/scale helpers behave deterministically', () => {
  const config = clampConfig({ prepCountdownSec: 0 });
  const idle = createInitialState(config);
  assert.equal(stepSession(idle, 1000).nextState.phase, 'idle');

  assert.ok(getBreathVisualScale('inhale', 0) < getBreathVisualScale('inhale', 0.5));
  assert.ok(getBreathVisualScale('inhale', 0.5) < getBreathVisualScale('inhale', 1));
  assert.ok(getBreathVisualScale('exhale', 0) > getBreathVisualScale('exhale', 1));
  assert.equal(getBreathVisualScale('recovery_hold', 0.5), 1.0);

  assert.equal(formatSeconds(65), '01:05');
  assert.equal(formatSeconds(0), '00:00');
  assert.equal(
    estimateSessionDurationSec(
      clampConfig({
        breathCount: 10,
        inhaleSec: 2,
        exhaleSec: 2,
        holdSec: 30,
        recoveryInhaleSec: 2.5,
        recoveryHoldSec: 15,
        rounds: 1,
        prepCountdownSec: 5,
      })
    ),
    95
  );
});
