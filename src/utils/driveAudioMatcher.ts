import { BreathPhase } from './breathEngine';

export type VoicePhaseSlot = Exclude<BreathPhase, 'idle' | 'preparing'>;

export interface DriveAudioFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  parents?: string[];
  modifiedTime?: string;
  folderPath?: string;
  localUrl?: string;
}

export type PhaseAudioMap = Partial<Record<VoicePhaseSlot, DriveAudioFile>>;

export interface VoiceMatchResult {
  phaseMap: PhaseAudioMap;
  countClips: Record<number, DriveAudioFile>;
  unmatchedFiles: DriveAudioFile[];
}

export const VOICE_PHASE_SLOTS: {
  phase: VoicePhaseSlot;
  label: string;
  description: string;
}[] = [
  {
    phase: 'inhale',
    label: 'Inhale',
    description: 'Played at the start of each rhythmic inhale (1–40).',
  },
  {
    phase: 'exhale',
    label: 'Exhale',
    description: 'Played at the start of each rhythmic exhale.',
  },
  {
    phase: 'hold',
    label: 'Breath Hold',
    description: 'Cues entry into the empty-lung retention hold.',
  },
  {
    phase: 'recovery_inhale',
    label: 'Recovery Inhale',
    description: 'Cues the deep full breath at the end of retention.',
  },
  {
    phase: 'recovery_hold',
    label: 'Recovery Hold',
    description: 'Cues holding the recovery breath at the top.',
  },
  {
    phase: 'recovery_exhale',
    label: 'Release Exhale',
    description: 'Cues the slow release at the end of recovery.',
  },
  {
    phase: 'completed',
    label: 'Session Complete',
    description: 'Played when all configured rounds finish.',
  },
];

function normalizeName(filename: string): string {
  return filename
    .replace(/\.(mp3|wav|m4a|ogg|aac)$/i, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scores how well a Drive audio filename matches a breath phase slot.
 * Higher score wins; 0 means no match.
 */
export function scoreFilenameForPhase(filename: string, phase: VoicePhaseSlot): number {
  const norm = normalizeName(filename);

  switch (phase) {
    case 'recovery_inhale': {
      if (/\brecovery\b.*\b(inhale|in|breath)\b/.test(norm)) return 100;
      if (/\bdeep\b.*\binhale\b/.test(norm)) return 80;
      if (norm === 'recovery' || /\brecovery\s*breath\b/.test(norm)) return 70;
      return 0;
    }
    case 'recovery_hold': {
      if (/\brecovery\b.*\bhold\b/.test(norm)) return 100;
      if (/\bhold\b.*\brecovery\b/.test(norm)) return 95;
      return 0;
    }
    case 'recovery_exhale': {
      if (/\brecovery\b.*\b(exhale|out|release)\b/.test(norm)) return 100;
      if (/\b(release|let\s*go|relax)\b/.test(norm) && !/\bexhale\b/.test(norm)) return 75;
      if (/\bfinal\s*exhale\b/.test(norm)) return 80;
      return 0;
    }
    case 'inhale': {
      if (/\brecovery\b/.test(norm)) return 0;
      if (/^(?:\d+\s*)?(inhale|breathe\s*in|breath\s*in|in)$/.test(norm)) return 100;
      if (/\b(inhale|breathe\s*in|breath\s*in)\b/.test(norm)) return 85;
      return 0;
    }
    case 'exhale': {
      if (/\brecovery\b/.test(norm)) return 0;
      if (/^(?:\d+\s*)?(exhale|breathe\s*out|breath\s*out|out)$/.test(norm)) return 100;
      if (/\b(exhale|breathe\s*out|breath\s*out)\b/.test(norm)) return 85;
      return 0;
    }
    case 'hold': {
      if (/\brecovery\b/.test(norm)) return 0;
      if (/^(?:\d+\s*)?(breath\s*hold|hold|retention|hold\s*breath)$/.test(norm)) return 100;
      if (/\b(retention|breath\s*hold|hold\s*your\s*breath|hold\s*out|hold)\b/.test(norm)) return 85;
      return 0;
    }
    case 'completed': {
      if (/\b(complete|completed|finished|finish|done|outro|well\s*done|end)\b/.test(norm)) {
        return 95;
      }
      return 0;
    }
  }
}

/**
 * Extracts a breath count number (1-40) if the clip is explicitly a breath counter clip
 * e.g. "breath_10.mp3", "count_30.mp3", "15.mp3"
 */
export function extractBreathCountNumber(filename: string): number | null {
  const norm = normalizeName(filename);
  const directMatch = norm.match(/^(?:breath|count|round|cycle)?\s*(\d{1,2})$/);
  if (directMatch) {
    const num = Number.parseInt(directMatch[1], 10);
    if (num >= 1 && num <= 40) return num;
  }
  return null;
}

/**
 * Automatically matches Drive audio files to breath phases and optional 1-40 count cues.
 */
export function matchClipsToPhases(files: DriveAudioFile[]): VoiceMatchResult {
  const phaseMap: PhaseAudioMap = {};
  const countClips: Record<number, DriveAudioFile> = {};
  const usedFileIds = new Set<string>();

  // Match more specific recovery phases first so "recovery_inhale.mp3" doesn't match "inhale"
  const orderedPhases: VoicePhaseSlot[] = [
    'recovery_inhale',
    'recovery_hold',
    'recovery_exhale',
    'hold',
    'inhale',
    'exhale',
    'completed',
  ];

  for (const phase of orderedPhases) {
    let bestFile: DriveAudioFile | null = null;
    let bestScore = 0;

    for (const file of files) {
      if (usedFileIds.has(file.id)) continue;
      const score = scoreFilenameForPhase(file.name, phase);
      if (score > bestScore) {
        bestScore = score;
        bestFile = file;
      }
    }

    if (bestFile && bestScore > 0) {
      phaseMap[phase] = bestFile;
      usedFileIds.add(bestFile.id);
    }
  }

  // Check remaining files for numbered breath count clips (1..40)
  for (const file of files) {
    if (usedFileIds.has(file.id)) continue;
    const countNum = extractBreathCountNumber(file.name);
    if (countNum !== null && !countClips[countNum]) {
      countClips[countNum] = file;
      usedFileIds.add(file.id);
    }
  }

  const unmatchedFiles = files.filter((f) => !usedFileIds.has(f.id));
  return { phaseMap, countClips, unmatchedFiles };
}

export function findEncouragementClips(files: DriveAudioFile[]): DriveAudioFile[] {
  return files.filter((file) => {
    const norm = normalizeName(file.name);
    return /\b(encourage|encouragement|motivat|keep\s*going|doing\s*great|almost\s*there|halfway|you\s*got\s*this|stay\s*calm|relax)\b/.test(
      norm
    );
  });
}

export function formatFileSize(sizeBytes?: string): string {
  if (!sizeBytes) return '';
  const bytes = Number.parseInt(sizeBytes, 10);
  if (Number.isNaN(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
