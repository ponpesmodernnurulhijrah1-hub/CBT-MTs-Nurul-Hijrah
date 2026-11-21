import type { ExamResult, ViolationLogEntry } from '../types/cbt';

export const VIOLATION_HISTORY_ARCHIVE_KEY = 'cbt_violation_history_v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore restricted storage environments
  }
  return null;
}

function normalizeStudentToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'anon';
}

export function buildStudentSessionViolationKey(
  examId: string,
  namaSiswa: string,
  kelas: string
): string {
  return `cbt_violation_session_${normalizeStudentToken(examId)}_${normalizeStudentToken(namaSiswa)}_${normalizeStudentToken(kelas)}`;
}

export function loadStudentSessionViolations(
  examId: string,
  namaSiswa: string,
  kelas: string,
  storage: StorageLike | null = getDefaultStorage()
): ViolationLogEntry[] {
  if (!storage) return [];
  const key = buildStudentSessionViolationKey(examId, namaSiswa, kelas);
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ViolationLogEntry[]) : [];
  } catch {
    return [];
  }
}

function saveStudentSessionViolations(
  examId: string,
  namaSiswa: string,
  kelas: string,
  entries: ViolationLogEntry[],
  storage: StorageLike | null
): void {
  if (!storage) return;
  const key = buildStudentSessionViolationKey(examId, namaSiswa, kelas);
  try {
    storage.setItem(key, JSON.stringify(entries));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearStudentSessionViolations(
  examId: string,
  namaSiswa: string,
  kelas: string,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!storage) return;
  const key = buildStudentSessionViolationKey(examId, namaSiswa, kelas);
  try {
    storage.removeItem(key);
  } catch {
    // Ignore
  }
}

export function recordStudentViolation(
  params: {
    examId: string;
    namaSiswa: string;
    kelas: string;
    strikeNumber: number;
    reason: string;
    timestamp?: string;
  },
  storage: StorageLike | null = getDefaultStorage()
): ViolationLogEntry[] {
  const existing = loadStudentSessionViolations(
    params.examId,
    params.namaSiswa,
    params.kelas,
    storage
  );

  const entry: ViolationLogEntry = {
    id: `vio_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    strikeNumber: params.strikeNumber,
    timestamp: params.timestamp || new Date().toISOString(),
    reason: params.reason.trim() || 'Keluar dari layar ujian',
  };

  const next = [...existing, entry];
  saveStudentSessionViolations(
    params.examId,
    params.namaSiswa,
    params.kelas,
    next,
    storage
  );
  return next;
}

export function markLastViolationReturned(
  params: {
    examId: string;
    namaSiswa: string;
    kelas: string;
    returnedAt?: string;
  },
  storage: StorageLike | null = getDefaultStorage()
): ViolationLogEntry[] {
  const existing = loadStudentSessionViolations(
    params.examId,
    params.namaSiswa,
    params.kelas,
    storage
  );
  if (existing.length === 0) return existing;

  const returnedAt = params.returnedAt || new Date().toISOString();
  const returnedMs = new Date(returnedAt).getTime();

  let updated = false;
  const next = existing.map((entry, idx) => {
    if (idx === existing.length - 1 && !entry.returnedAt) {
      updated = true;
      const startMs = new Date(entry.timestamp).getTime();
      const durationAwaySeconds =
        Number.isFinite(startMs) && Number.isFinite(returnedMs)
          ? Math.max(0, Math.round((returnedMs - startMs) / 1000))
          : undefined;
      return {
        ...entry,
        returnedAt,
        durationAwaySeconds,
      };
    }
    return entry;
  });

  if (updated) {
    saveStudentSessionViolations(
      params.examId,
      params.namaSiswa,
      params.kelas,
      next,
      storage
    );
  }
  return next;
}

interface ArchivedViolationRecord {
  resultId: string;
  examId: string;
  namaSiswa: string;
  kelas: string;
  savedAt: string;
  entries: ViolationLogEntry[];
}

function loadArchiveMap(
  storage: StorageLike | null
): Record<string, ArchivedViolationRecord> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(VIOLATION_HISTORY_ARCHIVE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function archiveStudentViolationsForResult(
  params: {
    resultId: string;
    examId: string;
    namaSiswa: string;
    kelas: string;
    entries?: ViolationLogEntry[];
  },
  storage: StorageLike | null = getDefaultStorage()
): ViolationLogEntry[] {
  const sessionEntries =
    params.entries && params.entries.length > 0
      ? [...params.entries]
      : loadStudentSessionViolations(params.examId, params.namaSiswa, params.kelas, storage);

  if (storage && sessionEntries.length > 0) {
    try {
      const archive = loadArchiveMap(storage);
      archive[params.resultId] = {
        resultId: params.resultId,
        examId: params.examId,
        namaSiswa: params.namaSiswa.trim(),
        kelas: params.kelas.trim(),
        savedAt: new Date().toISOString(),
        entries: sessionEntries,
      };
      // Keep most recent 200 archived student violation logs to prevent quota bloat
      const keys = Object.keys(archive);
      if (keys.length > 200) {
        const sorted = keys.sort(
          (a, b) =>
            new Date(archive[a].savedAt).getTime() - new Date(archive[b].savedAt).getTime()
        );
        for (const oldKey of sorted.slice(0, keys.length - 200)) {
          delete archive[oldKey];
        }
      }
      storage.setItem(VIOLATION_HISTORY_ARCHIVE_KEY, JSON.stringify(archive));
    } catch {
      // Ignore quota errors
    }
  }

  clearStudentSessionViolations(params.examId, params.namaSiswa, params.kelas, storage);
  return sessionEntries;
}

export function getViolationHistoryForResult(
  result: Pick<ExamResult, 'id' | 'examId' | 'namaSiswa' | 'kelas' | 'violationHistory'>,
  storage: StorageLike | null = getDefaultStorage()
): ViolationLogEntry[] {
  if (Array.isArray(result.violationHistory) && result.violationHistory.length > 0) {
    return result.violationHistory;
  }
  const archive = loadArchiveMap(storage);
  if (archive[result.id]?.entries?.length) {
    return archive[result.id].entries;
  }
  return loadStudentSessionViolations(result.examId, result.namaSiswa, result.kelas, storage);
}
