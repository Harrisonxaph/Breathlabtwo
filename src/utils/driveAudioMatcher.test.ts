import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DriveAudioFile,
  extractBreathCountNumber,
  formatFileSize,
  matchClipsToPhases,
} from './driveAudioMatcher';

function makeFile(id: string, name: string): DriveAudioFile {
  return { id, name, mimeType: 'audio/mpeg' };
}

test('matchClipsToPhases maps standard BREATHFLOW TTS filenames accurately', () => {
  const files: DriveAudioFile[] = [
    makeFile('1', '01_inhale.mp3'),
    makeFile('2', '02_exhale.mp3'),
    makeFile('3', '03_breath_hold.mp3'),
    makeFile('4', '04_recovery_inhale.mp3'),
    makeFile('5', '05_recovery_hold.mp3'),
    makeFile('6', '06_recovery_release.mp3'),
    makeFile('7', '07_session_complete.mp3'),
    makeFile('8', 'ambient_intro.mp3'),
  ];

  const result = matchClipsToPhases(files);
  assert.equal(result.phaseMap.inhale?.id, '1');
  assert.equal(result.phaseMap.exhale?.id, '2');
  assert.equal(result.phaseMap.hold?.id, '3');
  assert.equal(result.phaseMap.recovery_inhale?.id, '4');
  assert.equal(result.phaseMap.recovery_hold?.id, '5');
  assert.equal(result.phaseMap.recovery_exhale?.id, '6');
  assert.equal(result.phaseMap.completed?.id, '7');
  assert.deepEqual(
    result.unmatchedFiles.map((f) => f.id),
    ['8']
  );
});

test('recovery_inhale is prioritized before inhale so recovery clips are never misassigned', () => {
  const files: DriveAudioFile[] = [
    makeFile('a', 'recovery_inhale.mp3'),
    makeFile('b', 'breathe_in.mp3'),
    makeFile('c', 'breathe_out.mp3'),
    makeFile('d', 'retention.mp3'),
  ];

  const result = matchClipsToPhases(files);
  assert.equal(result.phaseMap.recovery_inhale?.id, 'a');
  assert.equal(result.phaseMap.inhale?.id, 'b');
  assert.equal(result.phaseMap.exhale?.id, 'c');
  assert.equal(result.phaseMap.hold?.id, 'd');
});

test('extractBreathCountNumber detects 1-40 numbered breath cue files', () => {
  assert.equal(extractBreathCountNumber('1.mp3'), 1);
  assert.equal(extractBreathCountNumber('breath_30.mp3'), 30);
  assert.equal(extractBreathCountNumber('count-40.mp3'), 40);
  assert.equal(extractBreathCountNumber('41.mp3'), null);
  assert.equal(extractBreathCountNumber('inhale.mp3'), null);

  const result = matchClipsToPhases([
    makeFile('c1', 'breath_10.mp3'),
    makeFile('c2', '30.mp3'),
  ]);
  assert.equal(result.countClips[10]?.id, 'c1');
  assert.equal(result.countClips[30]?.id, 'c2');
});

test('formatFileSize formats KB and MB cleanly', () => {
  assert.equal(formatFileSize('512'), '512 B');
  assert.equal(formatFileSize('45056'), '44 KB');
  assert.equal(formatFileSize('2097152'), '2.0 MB');
  assert.equal(formatFileSize(undefined), '');
});
