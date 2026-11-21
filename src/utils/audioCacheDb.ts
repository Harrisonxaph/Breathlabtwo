import { DriveAudioFile, PhaseAudioMap, VoicePhaseSlot } from './driveAudioMatcher';

const DB_NAME = 'cadence_breath_audio_db';
const DB_VERSION = 1;
const STORE_CLIPS = 'clips';
const STORE_META = 'meta';

export interface CachedDriveClip {
  file: DriveAudioFile;
  buffer: ArrayBuffer;
}

export interface PersistedVoiceState {
  files: DriveAudioFile[];
  phaseMapIds: Partial<Record<VoicePhaseSlot, string>>;
  countClipIds: Record<number, string>;
  sourceLabel: string;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_CLIPS)) {
          db.createObjectStore(STORE_CLIPS, { keyPath: 'file.id' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveClipToCache(file: DriveAudioFile, buffer: ArrayBuffer): Promise<void> {
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_CLIPS, 'readwrite');
      const store = tx.objectStore(STORE_CLIPS);
      store.put({ file, buffer: buffer.slice(0) });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function loadAllCachedClips(): Promise<CachedDriveClip[]> {
  const db = await openDb();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_CLIPS, 'readonly');
      const store = tx.objectStore(STORE_CLIPS);
      const req = store.getAll();
      req.onsuccess = () => {
        db.close();
        resolve(Array.isArray(req.result) ? (req.result as CachedDriveClip[]) : []);
      };
      req.onerror = () => {
        db.close();
        resolve([]);
      };
    } catch {
      db.close();
      resolve([]);
    }
  });
}

export async function saveVoiceStateMeta(meta: PersistedVoiceState): Promise<void> {
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.objectStore(STORE_META).put(meta, 'voice_state');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function loadVoiceStateMeta(): Promise<PersistedVoiceState | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_META, 'readonly');
      const req = tx.objectStore(STORE_META).get('voice_state');
      req.onsuccess = () => {
        db.close();
        resolve((req.result as PersistedVoiceState | undefined) ?? null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function clearAudioCache(): Promise<void> {
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_CLIPS, STORE_META], 'readwrite');
      tx.objectStore(STORE_CLIPS).clear();
      tx.objectStore(STORE_META).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export function serializePhaseMapIds(phaseMap: PhaseAudioMap): Partial<Record<VoicePhaseSlot, string>> {
  const out: Partial<Record<VoicePhaseSlot, string>> = {};
  (Object.entries(phaseMap) as [VoicePhaseSlot, DriveAudioFile | undefined][]).forEach(
    ([phase, file]) => {
      if (file) out[phase] = file.id;
    }
  );
  return out;
}
