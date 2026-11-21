import test from 'node:test';
import assert from 'node:assert/strict';
import { clampConfig, startSession, stepSession } from './breathEngine';
import {
  evaluateProgressAudioUpdate,
  getEncouragingInstruction,
  getTransitionSpeechText,
} from './breathCoaching';

test('getEncouragingInstruction adapts to breath milestones, hold duration, and completion', () => {
  const config = clampConfig({ breathCount: 20, inhaleSec: 2, exhaleSec: 2, holdSec: 60, rounds: 2 });
  let state = startSession(config);

  // Breath 1
  assert.match(getEncouragingInstruction(state), /steady rhythm/i);

  // Jump to halfway (breath 10 -> 9 * 4s = 36s)
  state = stepSession(state, 36000).nextState;
  assert.equal(state.currentBreath, 10);
  assert.match(getEncouragingInstruction(state), /Halfway there \(10\/20\)/i);

  // Jump to final breath (breath 20 -> +10 * 4s = +40s)
  state = stepSession(state, 40000).nextState;
  assert.equal(state.currentBreath, 20);
  assert.match(getEncouragingInstruction(state), /Final deep breath/i);

  // Move into hold (4s) and progress through hold brackets
  state = stepSession(state, 4000).nextState;
  assert.equal(state.phase, 'hold');
  assert.match(getEncouragingInstruction(state), /stillness/i);

  state = stepSession(state, 16000).nextState;
  assert.match(getEncouragingInstruction(state), /15 seconds/i);

  state = stepSession(state, 15000).nextState;
  assert.match(getEncouragingInstruction(state), /30 seconds/i);

  state = stepSession(state, 20000).nextState; // 51s elapsed -> 9s left
  assert.match(getEncouragingInstruction(state), /10 seconds remaining/i);
});

test('getTransitionSpeechText provides concise milestone and phase guidance', () => {
  const config = clampConfig({ breathCount: 30, inhaleSec: 2, exhaleSec: 2, holdSec: 60, rounds: 2 });
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

  // Breath 26 (5 breaths left: +11 * 4s = +44s)
  state = stepSession(state, 44000).nextState;
  assert.equal(state.currentBreath, 26);
  assert.equal(getTransitionSpeechText(state), 'Five breaths left');

  // Breath 30 inhale -> exhale
  state = stepSession(state, 16000).nextState;
  assert.equal(state.currentBreath, 30);
  assert.equal(getTransitionSpeechText(state), 'Final breath in');

  state = stepSession(state, 2000).nextState;
  assert.equal(state.phase, 'exhale');
  assert.equal(getTransitionSpeechText(state), 'Last exhale');
});

test('evaluateProgressAudioUpdate fires mid-hold checkpoints and 10s warning once per round', () => {
  const config = clampConfig({ breathCount: 1, inhaleSec: 1, exhaleSec: 1, holdSec: 60, recoveryHoldSec: 15 });
  let state = startSession(config);
  state = stepSession(state, 2000).nextState; // enter hold at 0ms
  assert.equal(state.phase, 'hold');

  const emitted = new Set<string>();

  // Step to 14.5s -> no checkpoint yet
  let prev = state;
  state = stepSession(state, 14500).nextState;
  assert.equal(evaluateProgressAudioUpdate(prev, state, emitted), null);

  // Step across 15s
  prev = state;
  state = stepSession(state, 600).nextState;
  const u15 = evaluateProgressAudioUpdate(prev, state, emitted);
  assert.equal(u15?.key, 'r1-hold-15');
  assert.match(u15?.text ?? '', /15 seconds/i);

  // Duplicate check does not re-emit
  assert.equal(evaluateProgressAudioUpdate(prev, state, emitted), null);

  // Step across 30s
  prev = state;
  state = stepSession(state, 15000).nextState;
  const u30 = evaluateProgressAudioUpdate(prev, state, emitted);
  assert.equal(u30?.key, 'r1-hold-30');

  // Step across 50s (10s remaining); 45s was skipped or wait: 30->45.1s vs 45->50.1s
  prev = state;
  state = stepSession(state, 19500).nextState; // 49.6s elapsed (10.4s remaining)
  prev = state;
  state = stepSession(state, 600).nextState; // 50.2s elapsed (9.8s remaining)
  const uCountdown = evaluateProgressAudioUpdate(prev, state, emitted);
  assert.equal(uCountdown?.key, 'r1-hold-rem-10');
  assert.equal(uCountdown?.tone, 'countdown');

  // Enter recovery_hold (recovery_inhale 2.5s + remaining 9.8s hold)
  state = stepSession(state, 12300).nextState;
  assert.equal(state.phase, 'recovery_hold');
  prev = state;
  state = stepSession(state, 10200).nextState; // 10.2s elapsed of 15s -> 4.8s left
  const recUpdate = evaluateProgressAudioUpdate(prev, state, emitted);
  assert.equal(recUpdate?.key, 'r1-rec-rem-5');
  assert.match(recUpdate?.text ?? '', /5 seconds/i);
});
