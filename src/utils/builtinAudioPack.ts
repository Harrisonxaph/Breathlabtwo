import { DriveAudioFile, PhaseAudioMap } from './driveAudioMatcher';

export type BuiltinClipCategory =
  | 'welcome'
  | 'safety'
  | 'start'
  | 'inhale'
  | 'exhale'
  | 'round_last'
  | 'retention'
  | 'recovery_inhale'
  | 'recovery_hold'
  | 'recovery_exhale'
  | 'next_round'
  | 'encourage'
  | 'stop'
  | 'complete';

export interface BuiltinClipMeta {
  id: string;
  filename: string;
  displayName: string;
  category: BuiltinClipCategory;
  localUrl: string;
}

function makeClip(
  filename: string,
  displayName: string,
  category: BuiltinClipCategory
): BuiltinClipMeta {
  return {
    id: `builtin:${filename}`,
    filename,
    displayName,
    category,
    localUrl: `/assets/aistudio/${filename}`,
  };
}

export const BUILTIN_CLIP_CATALOG: BuiltinClipMeta[] = [
  // Welcome & Intro
  makeClip('welcome_01_b1ba5537.mp3', 'welcome_01 — Welcome to Breathflow', 'welcome'),
  makeClip('welcome_02_9692bf3c.mp3', 'welcome_02 — Find a comfortable position', 'welcome'),
  makeClip('welcome_03_499939fd.mp3', 'welcome_03 — Follow the circle and my voice', 'welcome'),
  makeClip('start_01_d2fe51c9.mp3', 'start_01 — Take a full breath in', 'start'),

  // Safety
  makeClip('safety_01_140088da.mp3', 'safety_01 — Sit or lie down somewhere safe', 'safety'),
  makeClip('safety_02_b65c15b0.mp3', 'safety_02 — Light-headed safety reminder', 'safety'),

  // Rhythmic Inhales (8 organic variations)
  makeClip('inhale_01_de98259c.mp3', 'inhale_01 — Breathe in', 'inhale'),
  makeClip('inhale_02_8b6106b9.mp3', 'inhale_02 — In again', 'inhale'),
  makeClip('inhale_03_5adf11f3.mp3', 'inhale_03 — Breathe in with the circle', 'inhale'),
  makeClip('inhale_04_83fc21df.mp3', 'inhale_04 — Keep your shoulders relaxed', 'inhale'),
  makeClip('inhale_05_10e9b9dc.mp3', 'inhale_05 — Another full breath in', 'inhale'),
  makeClip('inhale_06_7124c48e.mp3', 'inhale_06 — Deep breath in', 'inhale'),
  makeClip('inhale_07_d91ffa45.mp3', 'inhale_07 — Fill your lungs comfortably', 'inhale'),
  makeClip('inhale_08_01d010b0.mp3', 'inhale_08 — Breathe in at your own pace', 'inhale'),

  // Rhythmic Exhales (8 organic variations)
  makeClip('exhale_01_90be5b7b.mp3', 'exhale_01 — Let it go', 'exhale'),
  makeClip('exhale_02_e0c16e27.mp3', 'exhale_02 — And release', 'exhale'),
  makeClip('exhale_03_346b352a.mp3', 'exhale_03 — Release that breath', 'exhale'),
  makeClip('exhale_04_b118ef1e.mp3', 'exhale_04 — Relax the breath out', 'exhale'),
  makeClip('exhale_05_5b581d30.mp3', 'exhale_05 — Out, without pushing', 'exhale'),
  makeClip('exhale_06_ac1a7b85.mp3', 'exhale_06 — Let the air fall away', 'exhale'),
  makeClip('exhale_07_0e6603b2.mp3', 'exhale_07 — Let it flow out', 'exhale'),
  makeClip('exhale_08_b23d95ce.mp3', 'exhale_08 — And gently out', 'exhale'),

  // Final breaths of a round
  makeClip('round_last_01_3bef2184.mp3', 'round_last_01 — Last few breaths of this round', 'round_last'),
  makeClip('round_last_02_eff97b27.mp3', 'round_last_02 — One final breath in', 'round_last'),
  makeClip('round_last_03_988cdd4e.mp3', 'round_last_03 — Let that last breath go', 'round_last'),

  // Breath Hold / Retention
  makeClip('retention_01_fcdb0559.mp3', 'retention_01 — Rest after that exhale', 'retention'),
  makeClip('retention_02_cbb5024b.mp3', 'retention_02 — Breathe again when your body needs to', 'retention'),
  makeClip('retention_03_05d4fe19.mp3', 'retention_03 — Let each exhale feel easy', 'retention'),
  makeClip('retention_04_ba7cdffd.mp3', 'retention_04 — Stay with the rhythm', 'retention'),

  // Recovery Breath
  makeClip('recovery_01_f9358b1b.mp3', 'recovery_01 — Deep comfortable recovery breath in', 'recovery_inhale'),
  makeClip('recovery_02_b5bd1561.mp3', 'recovery_02 — Rest gently with that breath', 'recovery_hold'),
  makeClip('recovery_03_030be4cb.mp3', 'recovery_03 — Release and return to natural breath', 'recovery_exhale'),

  // Next Round
  makeClip('next_round_01_52e6600c.mp3', 'next_round_01 — Take your time before next round', 'next_round'),
  makeClip('next_round_02_b52c3a46.mp3', 'next_round_02 — Ready to begin again', 'next_round'),

  // Encouraging words
  makeClip('encourage_01_f7434406.mp3', 'encourage_01 — Thank you for taking this moment', 'encourage'),
  makeClip('encourage_02_8e468460.mp3', 'encourage_02 — Just this breath, then the next', 'encourage'),
  makeClip('encourage_03_610f4699.mp3', 'encourage_03 — Keep your shoulders relaxed', 'encourage'),
  makeClip('encourage_04_c1299bb8.mp3', 'encourage_04 — There is no rush, you are right here', 'encourage'),
  makeClip('encourage_05_abe3403d.mp3', 'encourage_05 — You are doing well, no need to hurry', 'encourage'),
  makeClip('encourage_06_23706928.mp3', 'encourage_06 — Let your breathing return to normal', 'encourage'),

  // Pause / Stop safely
  makeClip('stop_01_0fcd4cd8.mp3', 'stop_01 — Nothing to reach, nothing to prove', 'stop'),
  makeClip('stop_02_55471cfa.mp3', 'stop_02 — If uncomfortable, breathe normally', 'stop'),

  // Completion
  makeClip('complete_01_0cb609e3.mp3', 'complete_01 — Your breathing session is complete', 'complete'),
  makeClip('complete_02_77ceb066.mp3', 'complete_02 — Allow breathing to settle before getting up', 'complete'),
  makeClip('complete_03_5dfe79df.mp3', 'complete_03 — Take a moment before standing', 'complete'),
];

export const BUILTIN_AUDIO_FILES: DriveAudioFile[] = BUILTIN_CLIP_CATALOG.map((clip) => ({
  id: clip.id,
  name: clip.displayName,
  mimeType: 'audio/mpeg',
  folderPath: 'Project Audio / BREATHFLOW',
  localUrl: clip.localUrl,
}));

export function getBuiltinPhaseMap(): PhaseAudioMap {
  const byId = new Map(BUILTIN_AUDIO_FILES.map((f) => [f.id, f]));
  return {
    inhale: byId.get('builtin:inhale_01_de98259c.mp3'),
    exhale: byId.get('builtin:exhale_01_90be5b7b.mp3'),
    hold: byId.get('builtin:retention_01_fcdb0559.mp3'),
    recovery_inhale: byId.get('builtin:recovery_01_f9358b1b.mp3'),
    recovery_hold: byId.get('builtin:recovery_02_b5bd1561.mp3'),
    recovery_exhale: byId.get('builtin:recovery_03_030be4cb.mp3'),
    completed: byId.get('builtin:complete_01_0cb609e3.mp3'),
  };
}

export interface VoiceRotationPools {
  inhaleIds: string[];
  exhaleIds: string[];
  holdIds: string[];
  encouragementIds: string[];
  roundLastIds: string[];
  nextRoundIds: string[];
  completedIds: string[];
  welcomeIds: string[];
  safetyIds: string[];
}

export function getBuiltinVoicePools(): VoiceRotationPools {
  const idsOf = (cat: BuiltinClipCategory) =>
    BUILTIN_CLIP_CATALOG.filter((c) => c.category === cat).map((c) => c.id);

  return {
    inhaleIds: idsOf('inhale'),
    exhaleIds: idsOf('exhale'),
    holdIds: idsOf('retention'),
    encouragementIds: idsOf('encourage'),
    roundLastIds: idsOf('round_last'),
    nextRoundIds: idsOf('next_round'),
    completedIds: idsOf('complete'),
    welcomeIds: idsOf('welcome'),
    safetyIds: idsOf('safety'),
  };
}
