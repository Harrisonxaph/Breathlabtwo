import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampConfig,
  createInitialState,
  startSession,
  stepSession,
  skipToNextPhase,
  extendHold,
  getBreathVisualScale,
  formatSeconds,
  estimateSessionDurationSec,
} from './breathEngine';

test('clampConfig enforces 1-40 breath bounds and safe durations', () => {
  const low = clampConfig({ breathCount: -5, inhaleSec: 0.2, holdSec: 1, recoveryHoldSec: 1, rounds: 0 });
  assert.equal(low.breathCount, 1);
  assert.equal(low.inhaleSec, 1.0);
  assert.equal(low.holdSec, 5);
  assert.equal(low.recoveryHoldSec, 5);
  assert.equal(low.rounds, 1);

  const high = clampConfig({ breathCount: 99, exhaleSec: 12, holdSec: 999, recoveryHoldSec: 120, rounds: 10 });
  assert.equal(high.breathCount, 40);
  assert.equal(high.exhaleSec, 6.0);
  assert.equal(high.holdSec, 240);
  assert.equal(high.recoveryHoldSec, 45);
  assert.equal(high.rounds, 5);
});

test('session progresses cleanly through N breaths, hold, recovery, and completion', () => {
  const config = clampConfig({
    breathCount: 2,
    inhaleSec: 2,
    exhaleSec: 2,
    holdSec: 10,
    recoveryInhaleSec: 2.5,
    recoveryHoldSec: 10,
    rounds: 1,
  });

  let state = startSession(config);
  assert.equal(state.phase, 'inhale');
  assert.equal(state.currentBreath, 1);

  // Breath 1 inhale (2000ms) -> exhale
  let res = stepSession(state, 2000);
  state = res.nextState;
  assert.equal(state.phase, 'exhale');
  assert.equal(state.currentBreath, 1);
  assert.equal(res.transition?.to, 'exhale');

  // Breath 1 exhale (2000ms) -> Breath 2 inhale
  res = stepSession(state, 2000);
  state = res.nextState;
  assert.equal(state.phase, 'inhale');
  assert.equal(state.currentBreath, 2);
  assert.equal(state.totalBreathsCompleted, 1);

  // Breath 2 inhale -> exhale -> hold
  res = stepSession(state, 4000);
  state = res.nextState;
  assert.equal(state.phase, 'hold');
  assert.equal(state.totalBreathsCompleted, 2);

  // Hold (10000ms) -> recovery_inhale
  res = stepSession(state, 10000);
  state = res.nextState;
  assert.equal(state.phase, 'recovery_inhale');
  assert.deepEqual(state.holdDurationsAchievedSec, [10]);

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
});

test('multi-round session cycles back to round 2 inhale before completing', () => {
  const config = clampConfig({
    breathCount: 1,
    inhaleSec: 1,
    exhaleSec: 1,
    holdSec: 5,
    recoveryInhaleSec: 2,
    recoveryHoldSec: 5,
    rounds: 2,
  });

  let state = startSession(config);
  // Complete full round 1: 1 + 1 + 5 + 2 + 5 + 2.5 = 16.5s
  state = stepSession(state, 16500).nextState;
  assert.equal(state.phase, 'inhale');
  assert.equal(state.currentRound, 2);
  assert.equal(state.currentBreath, 1);

  // Complete round 2
  state = stepSession(state, 16500).nextState;
  assert.equal(state.phase, 'completed');
  assert.equal(state.totalBreathsCompleted, 2);
  assert.deepEqual(state.holdDurationsAchievedSec, [5, 5]);
});

test('skipToNextPhase allows early transition to hold and early hold release', () => {
  const config = clampConfig({ breathCount: 30, inhaleSec: 2, exhaleSec: 2, holdSec: 60 });
  let state = startSession(config);
  state = stepSession(state, 5000).nextState; // midway through breath 2 inhale
  assert.equal(state.currentBreath, 2);
  assert.equal(state.phase, 'inhale');

  // Skip to hold
  state = skipToNextPhase(state);
  assert.equal(state.phase, 'hold');
  assert.equal(state.totalBreathsCompleted, 1);

  // Extend hold by 15s
  state = extendHold(state, 15);
  assert.equal(state.phaseDurationMs, 75000);

  // Hold for 12s then release early to recovery
  state = stepSession(state, 12000).nextState;
  state = skipToNextPhase(state);
  assert.equal(state.phase, 'recovery_inhale');
  assert.deepEqual(state.holdDurationsAchievedSec, [12]);
});

test('paused or idle session does not advance on stepSession', () => {
  const config = clampConfig({});
  const idle = createInitialState(config);
  assert.equal(stepSession(idle, 1000).nextState.phase, 'idle');

  const paused = { ...startSession(config), isPaused: true };
  const after = stepSession(paused, 5000).nextState;
  assert.equal(after.phaseElapsedMs, 0);
  assert.equal(after.phase, 'inhale');
});

test('visual scale curve and time formatting behave deterministically', () => {
  assert.ok(getBreathVisualScale('inhale', 0) < getBreathVisualScale('inhale', 0.5));
  assert.ok(getBreathVisualScale('inhale', 0.5) < getBreathVisualScale('inhale', 1));
  assert.ok(getBreathVisualScale('exhale', 0) > getBreathVisualScale('exhale', 1));
  assert.equal(getBreathVisualScale('recovery_hold', 0.5), 1.0);

  assert.equal(formatSeconds(65), '01:05');
  assert.equal(formatSeconds(0), '00:00');
  assert.ok(estimateSessionDurationSec(clampConfig({ breathCount: 10, inhaleSec: 2, exhaleSec: 2, holdSec: 30, recoveryInhaleSec: 2.5, recoveryHoldSec: 15, rounds: 1 })) === 90);
});
