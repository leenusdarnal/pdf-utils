import { isPdfAnnotation, type PdfAnnotation } from './annotations';

const DATABASE_NAME = 'pdf-utils-local-drafts';
const DATABASE_VERSION = 1;
const STORE_NAME = 'annotation-drafts';
const SAMPLE_BYTES = 32 * 1024;

export const ANNOTATION_DRAFT_LIMITS = {
  maxDrafts: 12,
  maxAgeMs: 30 * 24 * 60 * 60 * 1_000,
  maxAnnotations: 1_000,
  maxGeometryElements: 120_000,
  maxNoteCharacters: 20_000,
  maxSerializedBytes: 4 * 1024 * 1024
} as const;

export interface AnnotationDraft {
  key: string;
  fileName: string;
  fileSize: number;
  fileLastModified: number;
  updatedAt: number;
  annotations: PdfAnnotation[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Return a stable browser-local key for a document without storing or hashing
 * the entire PDF. The SHA-256 input includes file metadata plus 32 KiB samples
 * from the beginning, middle, and end of the file.
 */
export async function createAnnotationDraftKey(file: File): Promise<string> {
  if (!file || typeof file.name !== 'string' || !Number.isSafeInteger(file.size) || file.size < 0) {
    throw new Error('A valid local file is required to identify an annotation draft.');
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure local fingerprinting is unavailable in this browser.');
  }

  const middleStart = Math.max(0, Math.floor(file.size / 2) - Math.floor(SAMPLE_BYTES / 2));
  const endStart = Math.max(0, file.size - SAMPLE_BYTES);
  const sampleBuffers = await Promise.all([
    file.slice(0, Math.min(file.size, SAMPLE_BYTES)).arrayBuffer(),
    file.slice(middleStart, Math.min(file.size, middleStart + SAMPLE_BYTES)).arrayBuffer(),
    file.slice(endStart, file.size).arrayBuffer()
  ]);
  const metadata = new TextEncoder().encode(
    'pdf-utils-annotation-draft-v1\0' +
    file.name + '\0' + file.size + '\0' + file.lastModified + '\0'
  );
  const sampleLength = sampleBuffers.reduce((total, buffer) => total + buffer.byteLength, 0);
  const fingerprintInput = new Uint8Array(metadata.byteLength + sampleLength);
  fingerprintInput.set(metadata, 0);

  let offset = metadata.byteLength;
  for (const buffer of sampleBuffers) {
    const sample = new Uint8Array(buffer);
    fingerprintInput.set(sample, offset);
    offset += sample.byteLength;
  }

  const digestInput = fingerprintInput.buffer.slice(
    fingerprintInput.byteOffset,
    fingerprintInput.byteOffset + fingerprintInput.byteLength
  ) as ArrayBuffer;
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', digestInput));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return 'pdf-utils:annotation-draft:v1:' + hex;
}

/** Validate data coming from IndexedDB or other untrusted runtime sources. */
export function isValidAnnotationDraft(value: unknown): value is AnnotationDraft {
  if (!isRecord(value)) return false;
  if (
    typeof value.key !== 'string' ||
    value.key.length < 1 ||
    value.key.length > 128 ||
    typeof value.fileName !== 'string' ||
    value.fileName.length < 1 ||
    value.fileName.length > 255 ||
    typeof value.fileSize !== 'number' ||
    !Number.isSafeInteger(value.fileSize) ||
    value.fileSize < 0 ||
    typeof value.fileLastModified !== 'number' ||
    !Number.isFinite(value.fileLastModified) ||
    value.fileLastModified < 0 ||
    typeof value.updatedAt !== 'number' ||
    !Number.isFinite(value.updatedAt) ||
    value.updatedAt < 0 ||
    !Array.isArray(value.annotations) ||
    value.annotations.length > ANNOTATION_DRAFT_LIMITS.maxAnnotations
  ) {
    return false;
  }

  let geometryElements = 0;
  for (const annotation of value.annotations) {
    if (!isPdfAnnotation(annotation)) return false;
    if (annotation.type === 'text-note' && annotation.text.length > ANNOTATION_DRAFT_LIMITS.maxNoteCharacters) {
      return false;
    }
    if (annotation.type === 'freehand') geometryElements += annotation.points.length;
    else if (annotation.type === 'highlight') geometryElements += annotation.rects.length;
    else geometryElements += 1;
    if (geometryElements > ANNOTATION_DRAFT_LIMITS.maxGeometryElements) return false;
  }

  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      ANNOTATION_DRAFT_LIMITS.maxSerializedBytes;
  } catch {
    return false;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('Local draft storage is not available in this browser.'));
  }

  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error('Unable to open local draft storage.'));
    request.onblocked = () => reject(new Error('Local draft storage is busy in another tab. Close other PDF Utils tabs and try again.'));
  });
}

function writeTransaction(operation: (store: IDBObjectStore) => void): Promise<void> {
  return openDatabase().then((database) => new Promise<void>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STORE_NAME, 'readwrite');
    } catch (error) {
      database.close();
      reject(error);
      return;
    }

    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('Unable to update local draft storage.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error('The local draft update was cancelled.'));
    };

    try {
      operation(transaction.objectStore(STORE_NAME));
    } catch (error) {
      transaction.abort();
      database.close();
      reject(error);
    }
  }));
}

export async function saveAnnotationDraft(draft: AnnotationDraft): Promise<void> {
  if (!isValidAnnotationDraft(draft)) {
    throw new Error('The annotation draft is invalid or exceeds the local storage limits.');
  }

  await writeTransaction((store) => {
    store.put(draft);
    const request = store.getAll();
    request.onsuccess = () => {
      const records = request.result as unknown[];
      const cutoff = Date.now() - ANNOTATION_DRAFT_LIMITS.maxAgeMs;
      const eligible = records
        .filter(isValidAnnotationDraft)
        .filter((record) => record.updatedAt >= cutoff)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, ANNOTATION_DRAFT_LIMITS.maxDrafts);
      const keep = new Set(eligible.map((record) => record.key));

      for (const record of records) {
        if (isRecord(record) && typeof record.key === 'string' && !keep.has(record.key)) {
          store.delete(record.key);
        }
      }
    };
    request.onerror = () => {
      try {
        request.transaction?.abort();
      } catch {
        // The transaction may already be aborting; its handlers report the failure.
      }
    };
  });
}

export async function loadAnnotationDraft(key: string): Promise<AnnotationDraft | null> {
  if (typeof key !== 'string' || key.length < 1 || key.length > 128) return null;
  const database = await openDatabase();
  let storedValue: unknown = null;

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => {
        storedValue = request.result ?? null;
      };
      request.onerror = () => reject(request.error ?? new Error('Unable to read the saved annotation draft.'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to read local draft storage.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Reading the local draft was cancelled.'));
    });
  } finally {
    database.close();
  }

  if (!isValidAnnotationDraft(storedValue)) {
    if (storedValue !== null) await deleteAnnotationDraft(key);
    return null;
  }
  if (Date.now() - storedValue.updatedAt > ANNOTATION_DRAFT_LIMITS.maxAgeMs) {
    await deleteAnnotationDraft(key);
    return null;
  }
  return storedValue;
}

export async function deleteAnnotationDraft(key: string): Promise<void> {
  if (typeof key !== 'string' || key.length < 1 || key.length > 128) return;
  await writeTransaction((store) => {
    store.delete(key);
  });
}
