import { DriveAudioFile } from './driveAudioMatcher';

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

export class DriveApiError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'DriveApiError';
    this.status = status;
  }
}

export interface DriveDiscoveryResult {
  files: DriveAudioFile[];
  sourceLabel: string;
  folderFound: boolean;
}

interface DriveFolderNode {
  id: string;
  name: string;
  parents?: string[];
}

function normalizeFolderName(name: string): string {
  return name.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function driveJsonFetch<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new DriveApiError('Your Google Drive session expired. Please sign in again.', 401);
    }
    let detail = `Google Drive request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error?.message) detail = body.error.message;
    } catch {
      // Ignore parse failure
    }
    throw new DriveApiError(detail, res.status);
  }

  return res.json() as Promise<T>;
}

async function listAllFolders(accessToken: string): Promise<DriveFolderNode[]> {
  const q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,parents)',
    pageSize: '500',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const data = await driveJsonFetch<{ files?: DriveFolderNode[] }>(
    `${DRIVE_FILES_URL}?${params.toString()}`,
    accessToken
  );
  return data.files ?? [];
}

async function listAudioFilesInFolder(
  accessToken: string,
  folderId: string,
  folderPath: string
): Promise<DriveAudioFile[]> {
  const q = `'${folderId}' in parents and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,size,parents,modifiedTime)',
    orderBy: 'name',
    pageSize: '200',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const data = await driveJsonFetch<{ files?: DriveAudioFile[] }>(
    `${DRIVE_FILES_URL}?${params.toString()}`,
    accessToken
  );

  const audioOnly = (data.files ?? []).filter((f) => {
    const lower = f.name.toLowerCase();
    return (
      f.mimeType.startsWith('audio/') ||
      lower.endsWith('.mp3') ||
      lower.endsWith('.wav') ||
      lower.endsWith('.m4a') ||
      lower.endsWith('.ogg')
    );
  });

  return audioOnly.map((f) => ({ ...f, folderPath }));
}

/**
 * Searches Google Drive for "ai docs" -> "BREATHFLOW voice clips" MP3 files
 * using resilient client-side folder matching (immune to Drive underscore/case tokenization),
 * falling back cleanly to broader Drive audio discovery if needed.
 */
export async function findBreathflowClips(
  accessToken: string
): Promise<DriveDiscoveryResult> {
  const allFolders = await listAllFolders(accessToken);

  const aiDocsFolders = allFolders.filter((f) => {
    const norm = normalizeFolderName(f.name);
    return norm === 'ai docs' || norm.includes('ai docs') || norm === 'aidocs';
  });
  const aiDocsIds = new Set(aiDocsFolders.map((f) => f.id));

  const breathflowFolders = allFolders.filter((f) =>
    normalizeFolderName(f.name).includes('breathflow')
  );

  // Prefer BREATHFLOW voice clips nested directly under ai docs
  const preferredFolder =
    breathflowFolders.find(
      (f) =>
        normalizeFolderName(f.name).includes('voice') &&
        f.parents?.some((p) => aiDocsIds.has(p))
    ) ??
    breathflowFolders.find((f) => f.parents?.some((p) => aiDocsIds.has(p))) ??
    breathflowFolders.find((f) => normalizeFolderName(f.name).includes('voice')) ??
    breathflowFolders[0];

  if (preferredFolder) {
    const label = preferredFolder.parents?.some((p) => aiDocsIds.has(p))
      ? `ai docs / ${preferredFolder.name}`
      : preferredFolder.name;
    const insidePreferred = await listAudioFilesInFolder(
      accessToken,
      preferredFolder.id,
      label
    );

    if (insidePreferred.length > 0) {
      return {
        files: insidePreferred,
        sourceLabel: label,
        folderFound: true,
      };
    }

    // Check one level deeper in case clips are in a subfolder inside BREATHFLOW voice clips
    const subFolders = allFolders.filter((f) => f.parents?.includes(preferredFolder.id));
    for (const sub of subFolders) {
      const subFiles = await listAudioFilesInFolder(
        accessToken,
        sub.id,
        `${label} / ${sub.name}`
      );
      if (subFiles.length > 0) {
        return {
          files: subFiles,
          sourceLabel: `${label} / ${sub.name}`,
          folderFound: true,
        };
      }
    }
  }

  // Fallback: check inside "ai docs" directly or its subfolders
  for (const aiFolder of aiDocsFolders) {
    const directFiles = await listAudioFilesInFolder(
      accessToken,
      aiFolder.id,
      aiFolder.name
    );
    if (directFiles.length > 0) {
      return {
        files: directFiles,
        sourceLabel: aiFolder.name,
        folderFound: true,
      };
    }
  }

  // Broad fallback: search all MP3/audio files in Google Drive
  const allAudio = await searchDriveAudioFiles(accessToken, '');
  return {
    files: allAudio,
    sourceLabel: 'All Google Drive MP3s',
    folderFound: false,
  };
}

export async function searchDriveAudioFiles(
  accessToken: string,
  searchQuery: string
): Promise<DriveAudioFile[]> {
  const trimmed = searchQuery.trim().replace(/'/g, "\\'");
  const baseAudioFilter =
    "(mimeType = 'audio/mpeg' or mimeType contains 'audio/' or name contains '.mp3' or name contains '.MP3')";
  const q = trimmed
    ? `trashed = false and ${baseAudioFilter} and name contains '${trimmed}'`
    : `trashed = false and ${baseAudioFilter}`;

  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,size,parents,modifiedTime)',
    orderBy: 'name',
    pageSize: '200',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const data = await driveJsonFetch<{ files?: DriveAudioFile[] }>(
    `${DRIVE_FILES_URL}?${params.toString()}`,
    accessToken
  );
  return data.files ?? [];
}

export async function fetchDriveAudioBuffer(
  accessToken: string,
  fileId: string
): Promise<ArrayBuffer> {
  const res = await fetch(
    `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!res.ok) {
    if (res.status === 401) {
      throw new DriveApiError('Your Google Drive session expired. Please sign in again.', 401);
    }
    throw new DriveApiError(`Could not download audio file (${res.status})`, res.status);
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new DriveApiError('Downloaded audio file was empty.', 422);
  }
  return buffer;
}
