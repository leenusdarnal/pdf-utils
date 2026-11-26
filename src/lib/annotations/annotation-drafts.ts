import {
  assertValidAnnotation,
  MAX_FREEHAND_POINTS,
  type PdfAnnotation
} from '$lib/annotations/annotations';

const DATABASE_NAME = 'pdf-utils-local-drafts';
const DATABASE_VERSION = 1;
const STORE_NAME = 'annotation-drafts';
const MAX_STORED_DRAFTS = 8;
export const MAX_ANNOTATION_DRAFT_BYTES = 2 * 1024 * 1024;
export const MAX_DRAFT_ANNOTATIONS = 5_000;
export const MAX_DRAFT_FREEHAND_POINTS = 100_000;
export const ANNOTATION_DRAFT_SCHEMA_VERSION = 1;

export interface AnnotationDraft {
  fingerprint: string;
  schemaVersion: number;
  updatedAt: number;
  annotations: PdfAnnotation[];
}

interface StoredAnnotationDraft extends AnnotationDraft {
  byteLength: number;
}

let databasePromise: Promise<IDBDatabase> | null = null;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The local draft request failed.'));
  });
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('The local draft transaction failed.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('The local draft transaction was cancelled.'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Local draft storage is not available in this browser.'));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'fingerprint' });
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };

    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error('Local draft storage could not be opened.'));
    };

    request.onblocked = () => {
      databasePromise = null;
      reject(new Error('Local draft storage is busy in another tab. Close the other PDF Utils tab and retry.'));
    };
  });

  databasePromise.catch(() => {
    databasePromise = null;
  });
  return databasePromise;
}

/**
 * Build a stable, chunked content fingerprint without loading the whole PDF
 * into memory. The two rolling 32-bit hashes are identifiers for matching a
 * local draft, not cryptographic security checks.
 */
export async function fingerprintPdf(source: Blob): Promise<string> {
  let firstHash = 0x811c9dc5;
  let secondHash = 0x9747b28c;
  const chunkSize = 1024 * 1024;

  for (let offset = 0; offset < source.size; offset += chunkSize) {
    const chunk = new Uint8Array(
      await source.slice(offset, Math.min(source.size, offset + chunkSize)).arrayBuffer()
    );
    for (const byte of chunk) {
      firstHash = Math.imul(firstHash ^ byte, 0x01000193) >>> 0;
      secondHash = Math.imul(secondHash ^ byte, 0x5bd1e995) >>> 0;
    }
  }

  return [
    'v1',
    source.size.toString(36),
    firstHash.toString(16).padStart(8, '0'),
    secondHash.toString(16).padStart(8, '0')
  ].join('-');
}

export function validateDraftAnnotations(value: unknown): PdfAnnotation[] {
  if (!Array.isArray(value)) throw new Error('The saved annotation draft is not a valid list.');
  if (value.length > MAX_DRAFT_ANNOTATIONS) {
    throw new Error('This annotation draft contains too many items to restore safely.');
  }

  const annotations: PdfAnnotation[] = [];
  const ids = new Set<string>();
  const encoder = new TextEncoder();
  let freehandPoints = 0;
  let estimatedBytes = 2;

  for (const candidate of value) {
    assertValidAnnotation(candidate);
    const annotation = candidate as PdfAnnotation;
    if (ids.has(annotation.id)) {
      throw new Error('The saved annotation draft contains duplicate IDs.');
    }
    ids.add(annotation.id);

    if (annotation.type === 'text-note' && annotation.text.length > 10_000) {
      throw new Error('The saved annotation draft contains a note that is too long.');
    }
    if (annotation.type === 'freehand') {
      freehandPoints += annotation.points.length;
      if (annotation.points.length > MAX_FREEHAND_POINTS ||
        freehandPoints > MAX_DRAFT_FREEHAND_POINTS) {
        throw new Error('The saved annotation draft contains too much drawing data.');
      }
    }
    estimatedBytes += encoder.encode(JSON.stringify(annotation)).byteLength + 1;
    if (estimatedBytes > MAX_ANNOTATION_DRAFT_BYTES) {
      throw new Error('This annotation draft is too large for local browser storage.');
    }
    annotations.push(annotation);
  }

  const serialized = JSON.stringify(annotations);
  const byteLength = encoder.encode(serialized).byteLength;
  if (byteLength > MAX_ANNOTATION_DRAFT_BYTES) {
    throw new Error('This annotation draft is too large for local browser storage.');
  }

  // Return a detached JSON-safe snapshot so callers cannot mutate stored state.
  return JSON.parse(serialized) as PdfAnnotation[];
}

function isStoredDraft(value: unknown): value is StoredAnnotationDraft {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.fingerprint === 'string' &&
    record.schemaVersion === ANNOTATION_DRAFT_SCHEMA_VERSION &&
    typeof record.updatedAt === 'number' &&
    Number.isFinite(record.updatedAt) &&
    typeof record.byteLength === 'number' &&
    Array.isArray(record.annotations)
  );
}

/** Load annotation data using a previously computed PDF content fingerprint. */
export async function loadAnnotationDraftByFingerprint(fingerprint: string): Promise<AnnotationDraft | null> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const completed = transactionResult(transaction);
  const stored = await requestResult(
    transaction.objectStore(STORE_NAME).get(fingerprint) as IDBRequest<unknown>
  );
  await completed;

  if (!stored) return null;
  if (!isStoredDraft(stored) || stored.fingerprint !== fingerprint) {
    await deleteAnnotationDraftByFingerprint(fingerprint);
    return null;
  }

  try {
    const annotations = validateDraftAnnotations(stored.annotations);
    if (stored.byteLength > MAX_ANNOTATION_DRAFT_BYTES) {
      throw new Error('The saved annotation draft exceeds the local storage limit.');
    }
    return {
      fingerprint,
      schemaVersion: ANNOTATION_DRAFT_SCHEMA_VERSION,
      updatedAt: stored.updatedAt,
      annotations
    };
  } catch {
    // Invalid or outdated records should not be restored into the viewer.
    await deleteAnnotationDraftByFingerprint(fingerprint);
    return null;
  }
}

export async function deleteAnnotationDraftByFingerprint(fingerprint: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const completed = transactionResult(transaction);
  transaction.objectStore(STORE_NAME).delete(fingerprint);
  await completed;
}

/**
 * Save only annotation JSON for this PDF. Empty annotation arrays clear the
 * corresponding draft. Recent drafts are retained up to a fixed count.
 */
export async function saveAnnotationDraftByFingerprint(
  fingerprint: string,
  annotationsValue: readonly PdfAnnotation[]
): Promise<void> {
  const annotations = validateDraftAnnotations(annotationsValue);

  if (annotations.length === 0) {
    await deleteAnnotationDraftByFingerprint(fingerprint);
    return;
  }

  const serialized = JSON.stringify(annotations);
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  const record: StoredAnnotationDraft = {
    fingerprint,
    schemaVersion: ANNOTATION_DRAFT_SCHEMA_VERSION,
    updatedAt: Date.now(),
    byteLength,
    annotations
  };

  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const completed = transactionResult(transaction);
  const store = transaction.objectStore(STORE_NAME);
  store.put(record);

  const allRequest = store.getAll() as IDBRequest<StoredAnnotationDraft[]>;
  allRequest.onsuccess = () => {
    const records = allRequest.result
      .filter(isStoredDraft)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const retained = new Set<string>([
      fingerprint,
      ...records
        .filter((item) => item.fingerprint !== fingerprint)
        .slice(0, MAX_STORED_DRAFTS - 1)
        .map((item) => item.fingerprint)
    ]);

    for (const item of records) {
      if (!retained.has(item.fingerprint)) store.delete(item.fingerprint);
    }
  };

  await completed;
}

/**
 * Convenience wrapper for callers that have not already fingerprinted the PDF.
 * Viewer sessions should compute the fingerprint once and use the by-fingerprint API.
 */
export async function loadAnnotationDraft(source: Blob): Promise<AnnotationDraft | null> {
  return loadAnnotationDraftByFingerprint(await fingerprintPdf(source));
}

export async function saveAnnotationDraft(
  source: Blob,
  annotations: readonly PdfAnnotation[]
): Promise<void> {
  await saveAnnotationDraftByFingerprint(await fingerprintPdf(source), annotations);
}

export async function deleteAnnotationDraft(source: Blob): Promise<void> {
  await deleteAnnotationDraftByFingerprint(await fingerprintPdf(source));
}
