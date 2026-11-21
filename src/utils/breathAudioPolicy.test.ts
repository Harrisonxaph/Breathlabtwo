import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampAudioVolumes,
  getAmbientPhaseTarget,
  resolveCueSchedule,
  shouldPlayVoiceForPhase,
} from './breathAudioPolicy';

test('shouldPlayVoiceForPhase differentiates minimal, balanced, and active narration levels', () => {
  // Minimal: only round opener inhale + major phases
  assert.equal(shouldPlayVoiceForPhase('minimal', 'inhale', 1, 30), true);
  assert.equal(shouldPlayVoiceForPhase('minimal', 'inhale', 5, 30), false);
  assert.equal(shouldPlayVoiceForPhase('minimal', 'exhale', 1, 30), false);
  assert.equal(shouldPlayVoiceForPhase('minimal', 'hold'), true);
  assert.equal(shouldPlayVoiceForPhase('minimal', 'recovery_hold'), false);

  // Balanced: breath 1-2, halfway, final breaths
  assert.equal(shouldPlayVoiceForPhase('balanced', 'inhale', 2, 30), true);
  assert.equal(shouldPlayVoiceForPhase('balanced', 'inhale', 7, 30), false);
  assert.equal(shouldPlayVoiceForPhase('balanced', 'inhale', 15, 30), true);
  assert.equal(shouldPlayVoiceForPhase('balanced', 'inhale', 30, 30), true);

  // Active: every rhythmic breath
  assert.equal(shouldPlayVoiceForPhase('active', 'inhale', 7, 30), true);
  assert.equal(shouldPlayVoiceForPhase('active', 'exhale', 7, 30), true);
});

test('resolveCueSchedule prevents simultaneous voice and chime playback', () => {
  // Rhythmic breath with voice does NOT play a simultaneous chime
  const rhythmic = resolveCueSchedule({
    mode: 'voice_and_chimes',
    phase: 'inhale',
    hasVoiceForPhase: true,
    hasVoiceAssetOrSpeech: true,
    phaseDurationMs: 2000,
  });
  assert.equal(rhythmic.playVoice, true);
  assert.equal(rhythmic.playChime, false);
  assert.equal(rhythmic.voiceDelayMs, 0);

  // Rhythmic breath when narration skips voice falls back cleanly to chime only
  const rhythmicSkippedVoice = resolveCueSchedule({
    mode: 'voice_and_chimes',
    phase: 'inhale',
    hasVoiceForPhase: false,
    hasVoiceAssetOrSpeech: true,
    phaseDurationMs: 2000,
  });
  assert.equal(rhythmicSkippedVoice.playVoice, false);
  assert.equal(rhythmicSkippedVoice.playChime, true);

  // Major transition (hold) plays chime first and delays voice so they never overlap
  const holdTransition = resolveCueSchedule({
    mode: 'voice_and_chimes',
    phase: 'hold',
    hasVoiceForPhase: true,
    hasVoiceAssetOrSpeech: true,
    phaseDurationMs: 60000,
  });
  assert.equal(holdTransition.playChime, true);
  assert.equal(holdTransition.playVoice, true);
  assert.ok(holdTransition.voiceDelayMs >= 380);

  // Chimes only never triggers voice
  const chimesOnly = resolveCueSchedule({
    mode: 'chimes_only',
    phase: 'hold',
    hasVoiceForPhase: true,
    hasVoiceAssetOrSpeech: true,
    phaseDurationMs: 60000,
  });
  assert.equal(chimesOnly.playChime, true);
  assert.equal(chimesOnly.playVoice, false);
});

test('clampAudioVolumes clamps values within [0, 1]', () => {
  const clamped = clampAudioVolumes({
    voiceVolume: 2.4,
    chimeVolume: -0.3,
    ambientVolume: 0.45,
  });
  assert.equal(clamped.voiceVolume, 1);
  assert.equal(clamped.chimeVolume, 0);
  assert.equal(clamped.ambientVolume, 0.45);
});

test('getAmbientPhaseTarget swells on inhale and settles quietly during holds', () => {
  const inhaleStart = getAmbientPhaseTarget('inhale', 0);
  const inhaleEnd = getAmbientPhaseTarget('inhale', 1);
  const hold = getAmbientPhaseTarget('hold', 0.5);

  assert.ok(inhaleEnd.gainMultiplier > inhaleStart.gainMultiplier);
  assert.ok(inhaleEnd.filterHz > inhaleStart.filterHz);
  assert.ok(hold.gainMultiplier < inhaleStart.gainMultiplier);
  assert.ok(hold.filterHz < inhaleStart.filterHz);
});
