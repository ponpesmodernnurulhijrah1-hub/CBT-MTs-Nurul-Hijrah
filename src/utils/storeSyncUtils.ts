export const PENDING_DELETE_TTL_MS = 15_000;
export const FIRESTORE_BATCH_LIMIT = 400;

/**
 * Recursively strips `undefined` properties and array holes without JSON double-serialization,
 * preventing main-thread lag on large base64-embedded Word question banks.
 */
export function removeUndefinedFields<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    const cleaned = value
      .filter((item) => item !== undefined)
      .map((item) => removeUndefinedFields(item));
    return cleaned as unknown as T;
  }

  if (value instanceof Date) {
    return value.toISOString() as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) {
      out[k] = removeUndefinedFields(v);
    }
  }
  return out as T;
}

/**
 * Splits large Firestore batch mutations into safe chunks (<= 400 ops)
 * so deleting or importing >500 questions never throws Firestore batch limit errors.
 */
export function chunkArray<T>(items: T[], chunkSize: number = FIRESTORE_BATCH_LIMIT): T[][] {
  if (items.length === 0) return [];
  const safeSize = Math.max(1, Math.floor(chunkSize));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) {
    chunks.push(items.slice(i, i + safeSize));
  }
  return chunks;
}

/**
 * Filters incoming Firestore snapshot documents against recently deleted IDs
 * so slow/in-flight listeners never flicker deleted records back into UI state.
 */
export function filterOutPendingDeletes<T>(
  docs: T[],
  pendingDeletes: Map<string, number>,
  getId: (doc: T) => string,
  nowMs: number = Date.now(),
  ttlMs: number = PENDING_DELETE_TTL_MS
): T[] {
  for (const [id, deletedAt] of pendingDeletes.entries()) {
    if (nowMs - deletedAt > ttlMs) {
      pendingDeletes.delete(id);
    }
  }
  if (pendingDeletes.size === 0) return docs;
  return docs.filter((item) => !pendingDeletes.has(getId(item)));
}

/**
 * Determines whether the database should seed default demo questions/exams.
 * Once seeded, deleting all exams/questions intentionally must never resurrect seed data on reload.
 */
import type { ExamResult, ExamSchedule, Question, SyncStatus, TeacherAccount } from '../types/cbt';

export function shouldSeedInitialDatabase(params: {
  hasLocalSnapshot: boolean;
  existingExamsCount: number;
  alreadySeededMarker: boolean;
}): boolean {
  if (params.alreadySeededMarker) return false;
  if (!params.hasLocalSnapshot) return true;
  return params.existingExamsCount === 0;
}

export interface PendingSyncMutation {
  opId: string;
  type: 'set' | 'delete' | 'set_batch' | 'delete_batch';
  colName: string;
  docId?: string;
  docIds?: string[];
  data?: Record<string, unknown>;
  entries?: Array<{ id: string; data: Record<string, unknown> }>;
  label: string;
  createdAt: number;
}

export function deriveSyncStatus(params: {
  isOnline: boolean;
  activeWritesCount: number;
  queuedCount: number;
  hasSnapshotPendingWrites: boolean;
  lastError: string | null;
}): SyncStatus {
  if (!params.isOnline) return 'offline';
  if (params.activeWritesCount > 0 || params.hasSnapshotPendingWrites) return 'syncing';
  if (params.lastError) return 'error';
  if (params.queuedCount > 0) return 'syncing';
  return 'synced';
}

export function enqueuePendingMutation(
  queue: PendingSyncMutation[],
  mutation: PendingSyncMutation,
  maxItems: number = 120
): PendingSyncMutation[] {
  const deduped = queue.filter((item) => {
    if (mutation.type === 'set' || mutation.type === 'delete') {
      return !(
        (item.type === 'set' || item.type === 'delete') &&
        item.colName === mutation.colName &&
        item.docId === mutation.docId
      );
    }
    return item.opId !== mutation.opId;
  });
  const next = [...deduped, mutation];
  return next.length > maxItems ? next.slice(next.length - maxItems) : next;
}

export function getTeacherSubjects(teacher: Pick<TeacherAccount, 'mataPelajaran' | 'mataPelajaranList'>): string[] {
  const list = Array.isArray(teacher.mataPelajaranList) ? teacher.mataPelajaranList : [];
  const merged = [teacher.mataPelajaran, ...list]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  return Array.from(new Set(merged));
}

export function cascadeSubjectRename(params: {
  oldName: string;
  newName: string;
  teachers: TeacherAccount[];
  questions: Question[];
  exams: ExamSchedule[];
  results: ExamResult[];
}) {
  const { oldName, newName } = params;
  if (!oldName || oldName === newName) {
    return {
      teachers: params.teachers,
      questions: params.questions,
      exams: params.exams,
      results: params.results,
      affectedTeachers: [] as TeacherAccount[],
      affectedQuestions: [] as Question[],
      affectedExams: [] as ExamSchedule[],
      affectedResults: [] as ExamResult[],
    };
  }

  const affectedTeachers: TeacherAccount[] = [];
  const teachers = params.teachers.map((t) => {
    const subjects = getTeacherSubjects(t);
    if (!subjects.includes(oldName) && t.mataPelajaran !== oldName) return t;
    const nextList = subjects.map((s) => (s === oldName ? newName : s));
    const updated: TeacherAccount = {
      ...t,
      mataPelajaran: t.mataPelajaran === oldName ? newName : t.mataPelajaran,
      mataPelajaranList: Array.from(new Set(nextList)),
    };
    affectedTeachers.push(updated);
    return updated;
  });

  const affectedQuestions: Question[] = [];
  const questions = params.questions.map((q) => {
    if (q.mataPelajaran !== oldName) return q;
    const updated = { ...q, mataPelajaran: newName };
    affectedQuestions.push(updated);
    return updated;
  });

  const affectedExams: ExamSchedule[] = [];
  const exams = params.exams.map((ex) => {
    if (ex.mataPelajaran !== oldName) return ex;
    const updated = { ...ex, mataPelajaran: newName };
    affectedExams.push(updated);
    return updated;
  });

  const affectedResults: ExamResult[] = [];
  const results = params.results.map((r) => {
    if (r.mataPelajaran !== oldName) return r;
    const updated = { ...r, mataPelajaran: newName };
    affectedResults.push(updated);
    return updated;
  });

  return {
    teachers,
    questions,
    exams,
    results,
    affectedTeachers,
    affectedQuestions,
    affectedExams,
    affectedResults,
  };
}

export function cascadeClassRename(params: {
  oldName: string;
  newName: string;
  exams: ExamSchedule[];
  results: ExamResult[];
}) {
  const { oldName, newName } = params;
  if (!oldName || oldName === newName) {
    return {
      exams: params.exams,
      results: params.results,
      affectedExams: [] as ExamSchedule[],
      affectedResults: [] as ExamResult[],
    };
  }

  const affectedExams: ExamSchedule[] = [];
  const exams = params.exams.map((ex) => {
    if (!ex.kelasTarget.includes(oldName)) return ex;
    const updated: ExamSchedule = {
      ...ex,
      kelasTarget: Array.from(new Set(ex.kelasTarget.map((c) => (c === oldName ? newName : c)))),
    };
    affectedExams.push(updated);
    return updated;
  });

  const affectedResults: ExamResult[] = [];
  const results = params.results.map((r) => {
    if (r.kelas !== oldName) return r;
    const updated = { ...r, kelas: newName };
    affectedResults.push(updated);
    return updated;
  });

  return {
    exams,
    results,
    affectedExams,
    affectedResults,
  };
}

import type {
  SyncLogAction,
  SyncLogEntity,
  SyncLogEntry,
  SyncLogStatus,
  UserRole,
} from '../types/cbt';

export const MAX_SYNC_LOGS = 120;

export function inferSyncMetadataFromLabel(
  label: string,
  colName: string
): { entity: SyncLogEntity; action: SyncLogAction } {
  const lowerLabel = (label || '').toLowerCase();
  const lowerCol = (colName || '').toLowerCase();

  let entity: SyncLogEntity = 'Sistem';
  if (lowerCol.includes('subject') || lowerLabel.includes('mapel')) entity = 'Mapel';
  else if (lowerCol.includes('class') || lowerLabel.includes('kelas')) entity = 'Kelas';
  else if (lowerCol.includes('teacher') || lowerLabel.includes('guru')) entity = 'Guru';
  else if (lowerCol.includes('question') || lowerLabel.includes('soal')) entity = 'Soal';
  else if (lowerCol.includes('exam') || lowerLabel.includes('jadwal') || lowerLabel.includes('ujian'))
    entity = 'Jadwal';
  else if (lowerCol.includes('result') || lowerLabel.includes('nilai') || lowerLabel.includes('jawaban'))
    entity = 'Hasil Ujian';
  else if (lowerCol.includes('live') || lowerLabel.includes('pengawas') || lowerLabel.includes('tegur'))
    entity = 'Pengawasan';

  let action: SyncLogAction = 'Sinkron';
  if (lowerLabel.includes('manual') || lowerLabel.includes('paksa')) action = 'Paksa';
  else if (lowerLabel.includes('hapus') || lowerLabel.includes('kosong')) action = 'Hapus';
  else if (lowerLabel.includes('tambah') || lowerLabel.includes('terbit') || lowerLabel.includes('simpan'))
    action = 'Tambah';
  else if (
    lowerLabel.includes('perbarui') ||
    lowerLabel.includes('ubah') ||
    lowerLabel.includes('edit') ||
    lowerLabel.includes('diaktifkan') ||
    lowerLabel.includes('dihentikan') ||
    lowerLabel.includes('koreksi')
  ) {
    action = 'Ubah';
  }

  return { entity, action };
}

export function createSyncLogEntry(params: {
  id?: string;
  timestampMs?: number;
  status: SyncLogStatus;
  entity: SyncLogEntity;
  action: SyncLogAction;
  actorRole: UserRole | 'sistem';
  actorName: string;
  summary: string;
  details: string;
  collection: string;
  deviceId: string;
  errorMessage?: string;
}): SyncLogEntry {
  const tsMs = typeof params.timestampMs === 'number' ? params.timestampMs : Date.now();
  const safeId =
    params.id || `slog_${tsMs}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    id: safeId,
    timestamp: new Date(tsMs).toISOString(),
    timestampMs: tsMs,
    status: params.status,
    entity: params.entity,
    action: params.action,
    actorRole: params.actorRole,
    actorName: (params.actorName || 'Sistem').slice(0, 80),
    summary: (params.summary || '').slice(0, 180),
    details: (params.details || '').slice(0, 420),
    collection: (params.collection || 'system').slice(0, 60),
    deviceId: (params.deviceId || 'WEB-LOCAL').slice(0, 40),
    ...(params.errorMessage ? { errorMessage: params.errorMessage.slice(0, 240) } : {}),
  };
}

const LOG_STATUS_PRIORITY: Record<SyncLogStatus, number> = {
  Menunggu: 1,
  Gagal: 2,
  Berhasil: 3,
};

export function mergeAndSortSyncLogs(
  localLogs: SyncLogEntry[],
  cloudLogs: SyncLogEntry[],
  maxLogs: number = MAX_SYNC_LOGS
): SyncLogEntry[] {
  const byId = new Map<string, SyncLogEntry>();

  const upsert = (entry: SyncLogEntry) => {
    if (!entry || !entry.id) return;
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
      return;
    }
    const existingPrio = LOG_STATUS_PRIORITY[existing.status] ?? 0;
    const nextPrio = LOG_STATUS_PRIORITY[entry.status] ?? 0;
    if (nextPrio > existingPrio || (nextPrio === existingPrio && entry.timestampMs >= existing.timestampMs)) {
      byId.set(entry.id, entry);
    }
  };

  for (const item of localLogs) upsert(item);
  for (const item of cloudLogs) upsert(item);

  return Array.from(byId.values())
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .slice(0, Math.max(1, maxLogs));
}

export function filterSyncLogs(
  logs: SyncLogEntry[],
  filters: {
    status?: 'ALL' | SyncLogStatus;
    entity?: 'ALL' | SyncLogEntity;
    search?: string;
  }
): SyncLogEntry[] {
  const statusFilter = filters.status || 'ALL';
  const entityFilter = filters.entity || 'ALL';
  const q = (filters.search || '').trim().toLowerCase();

  return logs.filter((item) => {
    if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
    if (entityFilter !== 'ALL' && item.entity !== entityFilter) return false;
    if (!q) return true;
    const haystack = [
      item.summary,
      item.details,
      item.actorName,
      item.actorRole,
      item.entity,
      item.action,
      item.collection,
      item.deviceId,
      item.errorMessage || '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

function escapeCsvCell(val: string): string {
  const raw = String(val ?? '');
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function buildSyncLogsCsv(logs: SyncLogEntry[]): string {
  const header = [
    'Waktu',
    'Status',
    'Kategori',
    'Aksi',
    'Peran',
    'Aktor',
    'Perangkat',
    'Koleksi',
    'Ringkasan',
    'Detail Perubahan',
    'Catatan Error',
  ];
  const rows = logs.map((l) => [
    l.timestamp,
    l.status,
    l.entity,
    l.action,
    l.actorRole,
    l.actorName,
    l.deviceId,
    l.collection,
    l.summary,
    l.details,
    l.errorMessage || '',
  ]);
  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}
