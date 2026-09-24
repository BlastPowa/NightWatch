const DATABASE_NAME = 'nightwatch-local-media';
const DATABASE_VERSION = 1;
const STORE_NAME = 'personal-backgrounds';
const BACKGROUND_VIDEO_KEY = 'app-background-video';

export const MAX_BACKGROUND_VIDEO_BYTES = 250 * 1024 * 1024;
export const SUPPORTED_BACKGROUND_VIDEO_TYPES = ['video/mp4', 'video/webm'] as const;

interface BackgroundVideoRecord {
  blob: Blob;
  name: string;
  type: string;
  size: number;
  updatedAt: number;
}

export interface StoredBackgroundVideo {
  blob: Blob;
  name: string;
  type: string;
  size: number;
}

export function isSupportedBackgroundVideo(file: Pick<File, 'type' | 'size'>): boolean {
  return SUPPORTED_BACKGROUND_VIDEO_TYPES.includes(
    file.type as (typeof SUPPORTED_BACKGROUND_VIDEO_TYPES)[number],
  ) && file.size > 0 && file.size <= MAX_BACKGROUND_VIDEO_BYTES;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('background-video-storage-unavailable'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error('background-video-storage-open-failed'));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function completeTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('background-video-storage-failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('background-video-storage-aborted'));
  });
}

export async function saveBackgroundVideo(file: File): Promise<StoredBackgroundVideo> {
  if (!isSupportedBackgroundVideo(file)) {
    throw new Error('unsupported-background-video');
  }

  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const record: BackgroundVideoRecord = {
      blob: file,
      name: file.name.slice(0, 180),
      type: file.type,
      size: file.size,
      updatedAt: Date.now(),
    };
    transaction.objectStore(STORE_NAME).put(record, BACKGROUND_VIDEO_KEY);
    await completeTransaction(transaction);
    return { blob: record.blob, name: record.name, type: record.type, size: record.size };
  } finally {
    database.close();
  }
}

export async function loadBackgroundVideo(): Promise<StoredBackgroundVideo | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(BACKGROUND_VIDEO_KEY);
      request.onerror = () => reject(request.error ?? new Error('background-video-read-failed'));
      request.onsuccess = () => {
        const record = request.result as BackgroundVideoRecord | undefined;
        if (
          record === undefined ||
          !(record.blob instanceof Blob) ||
          typeof record.name !== 'string' ||
          typeof record.type !== 'string' ||
          typeof record.size !== 'number'
        ) {
          resolve(null);
          return;
        }
        resolve({ blob: record.blob, name: record.name, type: record.type, size: record.size });
      };
    });
  } finally {
    database.close();
  }
}

export async function removeBackgroundVideo(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(BACKGROUND_VIDEO_KEY);
    await completeTransaction(transaction);
  } finally {
    database.close();
  }
}
