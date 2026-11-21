import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  BUILTIN_AUDIO_FILES,
  BUILTIN_CLIP_CATALOG,
  getBuiltinPhaseMap,
  getBuiltinVoicePools,
} from './builtinAudioPack';

test('BUILTIN_CLIP_CATALOG covers all 45 audio files in public/assets/aistudio with zero duplicates', () => {
  const dir = path.resolve(process.cwd(), 'public/assets/aistudio');
  const diskFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort();
  const catalogFiles = BUILTIN_CLIP_CATALOG.map((c) => c.filename).sort();

  assert.equal(diskFiles.length, 45);
  assert.deepEqual(catalogFiles, diskFiles);
  assert.equal(BUILTIN_AUDIO_FILES.length, 45);
});

test('getBuiltinPhaseMap and getBuiltinVoicePools assign all 7 phase slots and organic pools', () => {
  const phaseMap = getBuiltinPhaseMap();
  assert.ok(phaseMap.inhale?.localUrl?.startsWith('/assets/aistudio/'));
  assert.ok(phaseMap.exhale?.localUrl?.startsWith('/assets/aistudio/'));
  assert.ok(phaseMap.hold?.localUrl?.startsWith('/assets/aistudio/'));
  assert.ok(phaseMap.recovery_inhale?.localUrl?.startsWith('/assets/aistudio/'));
  assert.ok(phaseMap.recovery_hold?.localUrl?.startsWith('/assets/aistudio/'));
  assert.ok(phaseMap.recovery_exhale?.localUrl?.startsWith('/assets/aistudio/'));
  assert.ok(phaseMap.completed?.localUrl?.startsWith('/assets/aistudio/'));

  const pools = getBuiltinVoicePools();
  assert.equal(pools.inhaleIds.length, 8);
  assert.equal(pools.exhaleIds.length, 8);
  assert.equal(pools.holdIds.length, 4);
  assert.equal(pools.encouragementIds.length, 6);
  assert.equal(pools.roundLastIds.length, 3);
  assert.equal(pools.nextRoundIds.length, 2);
  assert.equal(pools.completedIds.length, 3);
  assert.equal(pools.welcomeIds.length, 3);
  assert.equal(pools.safetyIds.length, 2);
});
