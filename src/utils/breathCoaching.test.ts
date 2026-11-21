import test from 'node:test';
import assert from 'node:assert/strict';
import { clampConfig, endSessionEarly, pauseForInterruption, startSession, stepSession } from './breathEngine';
import {
  evaluateProgressAudioUpdate,
  getEncouragingInstruction,
  getTransitionSpeechText,
} from './breathCoaching';

test('getEncouragingInstruction adapts to preparing, milestones, holds, interruptions, and early end', () => {
  const config = clampConfig({
    breathCount: 20,
    inhaleSec: 2,
    exhaleSec: 2,
    holdSec: 60,
    rounds: 2,
    prepCountdownSec: 3,
    roundRetentionCues: true,
  });
  let state = startSession(config);
  assert.match(getEncouragingInstruction(state), /comfortable posture/i);

  // Move into breath 1
  state = stepSession(state, 3000).nextState;
  assert.match(getEncouragingInstruction(state), /steady rhythm/i);

  // Interrupt
  const interrupted = pauseForInterruption(state, 'audio_interrupted');
  assert.match(getEncouragingInstruction(interrupted), /natural breaths/i);

  // Jump to halfway (breath 10 -> 9 * 4s = 36s)
  state = stepSession(state, 36000).nextState;
  assert.equal(state.currentBreath, 10);
  assert.match(getEncouragingInstruction(state), /Halfway through round 1 \(10\/20\)/i);

  // Jump to final breath (breath 20 -> +10 * 4s = +40s)
  state = stepSession(state, 40000).nextState;
  assert.equal(state.currentBreath, 20);
  assert.match(getEncouragingInstruction(state), /Final breath of this round/i);

  // Move into hold (4s) and progress through hold brackets
  state = stepSession(state, 4000).nextState;
  assert.equal(state.phase, 'hold');
  assert.match(getEncouragingInstruction(state), /Round 1 retention/i);

  state = stepSession(state, 16000).nextState;
  assert.match(getEncouragingInstruction(state), /recovery breath anytime/i);

  state = stepSession(state, 15000).nextState;
  assert.match(getEncouragingInstruction(state), /Quiet stillness/i);

  state = stepSession(state, 20000).nextState; // 51s elapsed -> 9s left
  assert.match(getEncouragingInstruction(state), /10 seconds left/i);

  const ended = endSessionEarly(state);
  assert.match(getEncouragingInstruction(ended), /ended safely/i);
});

test('getTransitionSpeechText provides concise non-competitive cues', () => {
  const config = clampConfig({
    breathCount: 30,
    inhaleSec: 2,
    exhaleSec: 2,
    holdSec: 60,
    rounds: 2,
    prepCountdownSec: 0,
    roundRetentionCues: true,
  });
  let state = startSession(config);

  assert.equal(getTransitionSpeechText(state), 'Inhale');

  // Breath 10 (9 * 4s = 36s)
  state = stepSession(state, 36000).nextState;
  assert.equal(state.currentBreath, 10);
  assert.equal(getTransitionSpeechText(state), '10 breaths');

  // Breath 15 halfway (+5 * 4s = +20s)
  state = stepSession(state, 20000).nextState;
  assert.equal(state.currentBreath, 15);
  assert.equal(getTransitionSpeechText(state), 'Halfway. Inhale');

  // Breath 26 (+11 * 4s = +44s)
  state = stepSession(state, 44000).nextState;
  assert.equal(state.currentBreath, 26);
  assert.equal(getTransitionSpeechText(state), 'Five breaths left');

  // Breath 30 inhale -> exhale -> hold
  state = stepSession(state, 16000).nextState;
  assert.equal(state.currentBreath, 30);
  assert.equal(getTransitionSpeechText(state), 'Final breath in');

  state = stepSession(state, 2000).nextState;
  assert.equal(state.phase, 'exhale');
  assert.equal(getTransitionSpeechText(state), 'Last exhale');

  state = stepSession(state, 2000).nextState;
  assert.equal(state.phase, 'hold');
  const holdText = getTransitionSpeechText(state);
  assert.match(holdText, /Round 1 breath hold/i);
  assert.doesNotMatch(holdText, /peak|best|beat|record/i);
});

test('evaluateProgressAudioUpdate respects Minimal, Balanced, and Active narration levels', () => {
  const config = clampConfig({
    breathCount: 1,
    inhaleSec: 1,
    exhaleSec: 1,
    holdSec: 60,
    recoveryHoldSec: 15,
    prepCountdownSec: 0,
  });
  let state = startSession(config);
  state = stepSession(state, 2000).nextState; // enter hold at 0ms
  assert.equal(state.phase, 'hold');

  // Minimal suppresses mid-hold milestones (only 10s countdown remains)
  const minimalEmitted = new Set<string>();
  let prev = state;
  let next = stepSession(prev, 16000).nextState;
  assert.equal(evaluateProgressAudioUpdate(prev, next, minimalEmitted, 'minimal'), null);

  // Active emits 15s checkpoint while balanced skips activeOnly checkpoints
  const balancedEmitted = new Set<string>();
  assert.equal(evaluateProgressAudioUpdate(prev, next, balancedEmitted, 'balanced'), null);

  const activeEmitted = new Set<string>();
  const active15 = evaluateProgressAudioUpdate(prev, next, activeEmitted, 'active');
  assert.equal(active15?.key, 'r1-hold-15');

  // Balanced emits 30s milestone and 10s countdown once
  prev = next;
  next = stepSession(prev, 15000).nextState; // 31s elapsed
  const u30 = evaluateProgressAudioUpdate(prev, next, balancedEmitted, 'balanced');
  assert.equal(u30?.key, 'r1-hold-30');
  assert.equal(evaluateProgressAudioUpdate(prev, next, balancedEmitted, 'balanced'), null);

  prev = stepSession(next, 18500).nextState; // 49.5s elapsed
  next = stepSession(prev, 700).nextState; // 50.2s elapsed (9.8s remaining)
  const uCountdown = evaluateProgressAudioUpdate(prev, next, balancedEmitted, 'balanced');
  assert.equal(uCountdown?.key, 'r1-hold-rem-10');
  assert.equal(uCountdown?.tone, 'countdown');
});
