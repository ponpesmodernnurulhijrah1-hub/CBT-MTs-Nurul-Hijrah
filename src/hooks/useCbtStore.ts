import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  waitForPendingWrites,
  writeBatch,
} from 'firebase/firestore';
import { APP_VERSION, db } from '../config/firebase';
import type {
  AdminAccount,
  ClassItem,
  ExamResult,
  ExamSchedule,
  LiveStreamSession,
  Question,
  SubjectItem,
  SyncLogEntry,
  SyncLogStatus,
  SyncStatusInfo,
  TeacherAccount,
  UserRole,
} from '../types/cbt';
import { hashCredential } from '../utils/crypto';
import {
  clearBankQuestionsForSubject,
  createExamWithSnapshot,
} from '../utils/examLogic';
import {
  MAX_SYNC_LOGS,
  cascadeClassRename,
  cascadeSubjectRename,
  chunkArray,
  createSyncLogEntry,
  deriveSyncStatus,
  enqueuePendingMutation,
  filterOutPendingDeletes,
  getTeacherSubjects,
  inferSyncMetadataFromLabel,
  mergeAndSortSyncLogs,
  removeUndefinedFields,
  shouldSeedInitialDatabase,
  type PendingSyncMutation,
} from '../utils/storeSyncUtils';
import {
  isNewerAppVersion,
  resolveMonotonicPulseVersion,
} from '../utils/updaterLogic';

const LS_KEY = 'cbt_mts_nurul_hijrah_db_v2';
const SEEDED_LS_KEY = 'cbt_mts_nurul_hijrah_seeded_v2';
const SYNC_QUEUE_LS_KEY = 'cbt_mts_nurul_hijrah_sync_queue_v1';
const SYNC_LOGS_LS_KEY = 'cbt_mts_nurul_hijrah_sync_logs_v1';
const DEVICE_ID_LS_KEY = 'cbt_mts_nurul_hijrah_device_id_v1';
const BC_NAME = 'cbt_mts_nurul_hijrah_sync_channel';
const PRIMARY_ADMIN_ID = 'admin_primary_rizqi';
const PRIMARY_ADMIN_USER = 'rizqi';
const PRIMARY_ADMIN_PASS = 'rizqi123';
const LEGACY_ADMIN_IDS = ['admin_seed_1', 'admin_seed_2'];

export interface CbtDatabaseState {
  subjects: SubjectItem[];
  classes: ClassItem[];
  teachers: TeacherAccount[];
  admins: AdminAccount[];
  questions: Question[];
  exams: ExamSchedule[];
  results: ExamResult[];
  liveStreams: LiveStreamSession[];
}

const DEFAULT_SUBJECT_NAMES = [
  { nama: "Al-Qur'an Hadis", kode: 'QURDIS' },
  { nama: 'Akidah Akhlak', kode: 'AKIDAH' },
  { nama: 'Fikih', kode: 'FIKIH' },
  { nama: 'Sejarah Kebudayaan Islam', kode: 'SKI' },
  { nama: 'Bahasa Arab', kode: 'BARAB' },
  { nama: 'Pendidikan Pancasila', kode: 'PPKN' },
  { nama: 'Bahasa Indonesia', kode: 'BIND' },
  { nama: 'Matematika', kode: 'MTK' },
  { nama: 'IPA', kode: 'IPA' },
  { nama: 'IPS', kode: 'IPS' },
  { nama: 'Bahasa Inggris', kode: 'BING' },
  { nama: 'Informatika', kode: 'INF' },
];

const DEFAULT_CLASS_NAMES = [
  { nama: 'VII A', tingkat: 'VII' },
  { nama: 'VII B', tingkat: 'VII' },
  { nama: 'VIII A', tingkat: 'VIII' },
  { nama: 'VIII B', tingkat: 'VIII' },
  { nama: 'IX A', tingkat: 'IX' },
  { nama: 'IX B', tingkat: 'IX' },
];

function buildInitialSubjects(): SubjectItem[] {
  const now = new Date().toISOString();
  return DEFAULT_SUBJECT_NAMES.map((s, i) => ({
    id: `subj_${i + 1}`,
    nama: s.nama,
    kode: s.kode,
    createdAt: now,
  }));
}

function buildInitialClasses(): ClassItem[] {
  const now = new Date().toISOString();
  return DEFAULT_CLASS_NAMES.map((c, i) => ({
    id: `cls_${i + 1}`,
    nama: c.nama,
    tingkat: c.tingkat,
    createdAt: now,
  }));
}

function buildInitialQuestions(): Question[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'q_seed_1',
      mataPelajaran: 'Matematika',
      tipe: 'PG',
      pertanyaanHtml:
        '<p>Sebuah madrasah mengadakan pengadaan buku paket sesuai tabel berikut:</p><table><thead><tr><th>Kelas</th><th>Jumlah Siswa</th><th>Buku per Siswa</th></tr></thead><tbody><tr><td>VII A</td><td>32</td><td>4</td></tr><tr><td>VII B</td><td>30</td><td>4</td></tr></tbody></table><p>Berapakah total buku yang dibutuhkan untuk kelas VII A dan VII B?</p>',
      opsi: ['240 buku', '248 buku', '252 buku', '260 buku'],
      kunciJawaban: ['B'],
      bobot: 25,
      createdBy: 'Guru Matematika',
      createdAt: now,
    },
    {
      id: 'q_seed_2',
      mataPelajaran: 'Matematika',
      tipe: 'PG_KOMPLEKS',
      pertanyaanHtml:
        '<p>Pilihlah <strong>semua</strong> bilangan di bawah ini yang merupakan bilangan prima!</p>',
      opsi: ['11', '15', '17', '21'],
      kunciJawaban: ['A', 'C'],
      bobot: 25,
      createdBy: 'Guru Matematika',
      createdAt: now,
    },
    {
      id: 'q_seed_3',
      mataPelajaran: 'Matematika',
      tipe: 'BENAR_SALAH',
      pertanyaanHtml:
        '<p>Jumlah seluruh sudut dalam sebuah segitiga pada bidang datar adalah 180 derajat.</p>',
      opsi: ['Benar', 'Salah'],
      kunciJawaban: ['Benar'],
      bobot: 25,
      createdBy: 'Guru Matematika',
      createdAt: now,
    },
    {
      id: 'q_seed_4',
      mataPelajaran: 'Matematika',
      tipe: 'ESAI',
      pertanyaanHtml:
        '<p>Sebuah taman madrasah berbentuk persegi panjang memiliki panjang 18 m dan lebar 12 m. Hitunglah keliling dan luas taman tersebut!</p>',
      opsi: [],
      kunciJawaban: ['Keliling = 60 m, Luas = 216 m2'],
      bobot: 25,
      createdBy: 'Guru Matematika',
      createdAt: now,
    },
  ];
}

function buildInitialSeedExam(questions: Question[]): ExamSchedule {
  return createExamWithSnapshot({
    id: 'exam_seed_mtk_1',
    judulUjian: 'Penilaian Harian Terpadu Matematika',
    mataPelajaran: 'Matematika',
    kelasTarget: ['Semua Kelas'],
    durasiMenit: 45,
    token: 'NH2026',
    aktif: true,
    acakSoal: false,
    selectedQuestions: questions,
    createdBy: 'Guru Matematika',
  });
}

async function buildPrimaryAdminAccount(): Promise<AdminAccount> {
  const adminUserHash = await hashCredential(PRIMARY_ADMIN_USER);
  const adminPassHash = await hashCredential(PRIMARY_ADMIN_PASS);
  return {
    id: PRIMARY_ADMIN_ID,
    nama: 'Administrator Pusat MTs Nurul Hijrah',
    usernameHash: adminUserHash,
    passwordHash: adminPassHash,
    createdAt: new Date().toISOString(),
  };
}

async function buildInitialState(): Promise<CbtDatabaseState> {
  const now = new Date().toISOString();
  const questions = buildInitialQuestions();
  const seedExam = buildInitialSeedExam(questions);
  const primaryAdmin = await buildPrimaryAdminAccount();

  const teacherUserHash = await hashCredential('guru_mtk');
  const teacherPassHash = await hashCredential('guru123');

  return {
    subjects: buildInitialSubjects(),
    classes: buildInitialClasses(),
    teachers: [
      {
        id: 'teacher_seed_1',
        nama: 'Ustadz Ahmad Fauzan, S.Pd.',
        mataPelajaran: 'Matematika',
        mataPelajaranList: ['Matematika'],
        usernameHash: teacherUserHash,
        usernameMasked: '••••••••',
        passwordHash: teacherPassHash,
        aktif: true,
        createdAt: now,
      },
    ],
    admins: [primaryAdmin],
    questions,
    exams: [seedExam],
    results: [],
    liveStreams: [],
  };
}

function loadLocalState(): CbtDatabaseState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CbtDatabaseState;
    return {
      ...parsed,
      liveStreams: [],
    };
  } catch {
    return null;
  }
}

function saveLocalState(state: CbtDatabaseState) {
  try {
    const compact: CbtDatabaseState = {
      ...state,
      liveStreams: [],
    };
    localStorage.setItem(LS_KEY, JSON.stringify(compact));
  } catch {
    // Handle quota exceeded gracefully
  }
}

function loadPendingQueue(): PendingSyncMutation[] {
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingSyncMutation[]) : [];
  } catch {
    return [];
  }
}

function savePendingQueue(queue: PendingSyncMutation[]) {
  try {
    if (queue.length === 0) {
      localStorage.removeItem(SYNC_QUEUE_LS_KEY);
    } else {
      localStorage.setItem(SYNC_QUEUE_LS_KEY, JSON.stringify(queue));
    }
  } catch {
    // Ignore storage quota errors
  }
}

function getOrCreateDeviceId(): string {
  try {
    const isStandalone =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true);
    const prefix = isStandalone ? 'PWA' : 'WEB';
    const existing = localStorage.getItem(DEVICE_ID_LS_KEY);
    if (existing) {
      const code = existing.replace(/^(PWA|WEB)-/, '');
      const formatted = `${prefix}-${code}`;
      if (formatted !== existing) localStorage.setItem(DEVICE_ID_LS_KEY, formatted);
      return formatted;
    }
    const fresh = `${prefix}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    localStorage.setItem(DEVICE_ID_LS_KEY, fresh);
    return fresh;
  } catch {
    return 'WEB-LOCAL';
  }
}

function loadLocalSyncLogs(): SyncLogEntry[] {
  try {
    const raw = localStorage.getItem(SYNC_LOGS_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SyncLogEntry[]).slice(0, MAX_SYNC_LOGS) : [];
  } catch {
    return [];
  }
}

function saveLocalSyncLogs(logs: SyncLogEntry[]) {
  try {
    localStorage.setItem(SYNC_LOGS_LS_KEY, JSON.stringify(logs.slice(0, MAX_SYNC_LOGS)));
  } catch {
    // Ignore storage quota errors
  }
}

function describeMutationDetails(ops: PendingSyncMutation[]): string {
  const parts = ops.map((op) => {
    if (op.type === 'set_batch') {
      return `${op.colName} (${op.entries?.length || 0} item)`;
    }
    if (op.type === 'delete_batch') {
      return `hapus ${op.docIds?.length || 0} item dari ${op.colName}`;
    }
    if (op.type === 'delete') {
      return `hapus ${op.colName}/${op.docId || '-'}`;
    }
    return `${op.colName}/${op.docId || '-'}`;
  });
  return `Firestore: ${parts.join(' · ')}`;
}

function hasSeededMarker(): boolean {
  try {
    return localStorage.getItem(SEEDED_LS_KEY) === '1';
  } catch {
    return false;
  }
}

function markDatabaseSeeded() {
  try {
    localStorage.setItem(SEEDED_LS_KEY, '1');
  } catch {
    // Ignore storage errors
  }
}

async function commitFirestoreDeleteChunks(colName: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const chunks = chunkArray(ids);
  for (const chunk of chunks) {
    try {
      const batch = writeBatch(db);
      for (const id of chunk) {
        batch.delete(doc(db, colName, id));
      }
      await batch.commit();
    } catch (batchErr) {
      for (const id of chunk) {
        await deleteDoc(doc(db, colName, id));
      }
      if (chunk.length === 0) throw batchErr;
    }
  }
}

async function commitFirestoreSetChunks<T extends Record<string, unknown>>(
  colName: string,
  entries: Array<{ id: string; data: T }>
): Promise<void> {
  if (entries.length === 0) return;
  const chunks = chunkArray(entries);
  for (const chunk of chunks) {
    try {
      const batch = writeBatch(db);
      for (const entry of chunk) {
        batch.set(doc(db, colName, entry.id), removeUndefinedFields(entry.data));
      }
      await batch.commit();
    } catch (batchErr) {
      for (const entry of chunk) {
        await setDoc(doc(db, colName, entry.id), removeUndefinedFields(entry.data));
      }
      if (chunk.length === 0) throw batchErr;
    }
  }
}

async function executeSingleMutation(op: PendingSyncMutation): Promise<void> {
  switch (op.type) {
    case 'set':
      if (!op.docId || !op.data) return;
      await setDoc(doc(db, op.colName, op.docId), removeUndefinedFields(op.data));
      return;
    case 'delete':
      if (!op.docId) return;
      await deleteDoc(doc(db, op.colName, op.docId));
      return;
    case 'set_batch':
      if (!op.entries || op.entries.length === 0) return;
      await commitFirestoreSetChunks(op.colName, op.entries);
      return;
    case 'delete_batch':
      if (!op.docIds || op.docIds.length === 0) return;
      await commitFirestoreDeleteChunks(op.colName, op.docIds);
      return;
  }
}

async function waitForCloudAck(timeoutMs: number = 3500): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  try {
    await Promise.race([
      waitForPendingWrites(db),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SYNC_ACK_TIMEOUT')), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}

export function useCbtStore(activeRole: UserRole = 'siswa', actorName?: string) {
  const [state, setState] = useState<CbtDatabaseState>(() => {
    const local = loadLocalState();
    if (local) return local;
    const seedQuestions = buildInitialQuestions();
    return {
      subjects: buildInitialSubjects(),
      classes: buildInitialClasses(),
      teachers: [],
      admins: [],
      questions: seedQuestions,
      exams: [buildInitialSeedExam(seedQuestions)],
      results: [],
      liveStreams: [],
    };
  });

  const [cloudConnected, setCloudConnected] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isReady, setIsReady] = useState(true);
  const [activeWritesCount, setActiveWritesCount] = useState(0);
  const [queuedMutationsCount, setQueuedMutationsCount] = useState<number>(
    () => loadPendingQueue().length
  );
  const [hasSnapshotPendingWrites, setHasSnapshotPendingWrites] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() => new Date().toISOString());
  const [lastSyncSummary, setLastSyncSummary] = useState<string | null>(
    'Terhubung real-time dengan database pusat'
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncLogs, setSyncLogs] = useState<SyncLogEntry[]>(() => loadLocalSyncLogs());
  const [pulseAppVersion, setPulseAppVersion] = useState<string | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;

  const actorContextRef = useRef<{ role: UserRole; name: string }>({
    role: activeRole,
    name: actorName || (activeRole === 'admin' ? 'Administrator' : activeRole === 'guru' ? 'Guru' : 'Peserta Ujian'),
  });
  actorContextRef.current = {
    role: activeRole,
    name: actorName || (activeRole === 'admin' ? 'Administrator' : activeRole === 'guru' ? 'Guru' : 'Peserta Ujian'),
  };

  const deviceIdRef = useRef<string>(getOrCreateDeviceId());
  const bcRef = useRef<BroadcastChannel | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const adminMigratedRef = useRef(false);
  const cloudBootstrapDoneRef = useRef(false);
  const cloudSeededConfirmRef = useRef(false);
  const hadCloudDocsRef = useRef<Record<string, boolean>>({});
  const pendingDeletedIdsRef = useRef<Map<string, number>>(new Map());
  const pendingQueueRef = useRef<PendingSyncMutation[]>(loadPendingQueue());
  const flushingQueueRef = useRef(false);
  const pendingColWritesRef = useRef<Record<string, boolean>>({});
  const remotePulseVersionRef = useRef<string | null>(null);
  const pulseBootSyncedRef = useRef(false);

  const refreshPendingSnapshotFlag = useCallback(() => {
    const anyPending = Object.values(pendingColWritesRef.current).some(Boolean);
    setHasSnapshotPendingWrites(anyPending);
  }, []);

  const broadcastSyncMeta = useCallback(
    (meta: { lastSyncedAt: string | null; lastSyncSummary: string | null; syncError: string | null }) => {
      try {
        bcRef.current?.postMessage({
          type: 'SYNC_META',
          payload: meta,
        });
      } catch {
        // Ignore broadcast errors
      }
    },
    []
  );

  const recordSyncLog = useCallback(
    (params: {
      id?: string;
      status: SyncLogStatus;
      summary: string;
      details: string;
      collection: string;
      errorMessage?: string;
      publishPulse?: boolean;
    }) => {
      const { entity, action } = inferSyncMetadataFromLabel(params.summary, params.collection);
      const actor = actorContextRef.current;
      const entry = createSyncLogEntry({
        id: params.id,
        status: params.status,
        entity,
        action,
        actorRole: actor.role,
        actorName: actor.name,
        summary: params.summary,
        details: params.details,
        collection: params.collection,
        deviceId: deviceIdRef.current,
        errorMessage: params.errorMessage,
      });

      setSyncLogs((prev) => {
        const merged = mergeAndSortSyncLogs([entry], prev, MAX_SYNC_LOGS);
        saveLocalSyncLogs(merged);
        try {
          bcRef.current?.postMessage({
            type: 'SYNC_LOGS',
            payload: merged,
          });
        } catch {
          // Ignore broadcast errors
        }
        return merged;
      });

      if (typeof navigator === 'undefined' || navigator.onLine) {
        void setDoc(
          doc(db, 'sync_logs', entry.id),
          removeUndefinedFields(entry as unknown as Record<string, unknown>)
        ).catch(() => {});

        if (params.publishPulse && params.status === 'Berhasil') {
          const monotonicVersion = resolveMonotonicPulseVersion(
            APP_VERSION,
            remotePulseVersionRef.current
          );
          void setDoc(doc(db, 'settings', 'cbt_sync_pulse'), {
            rev: entry.timestampMs,
            updatedAt: entry.timestamp,
            summary: entry.summary,
            actorName: entry.actorName,
            actorRole: entry.actorRole,
            collection: entry.collection,
            deviceId: entry.deviceId,
            appVersion: monotonicVersion,
          }).catch(() => {});
        }
      }
    },
    []
  );

  const markPendingDeletes = useCallback((colName: string, ids: string[]) => {
    const now = Date.now();
    hadCloudDocsRef.current[colName] = true;
    for (const id of ids) {
      pendingDeletedIdsRef.current.set(`${colName}:${id}`, now);
    }
  }, []);

  const scheduleSaveLocalState = useCallback((next: CbtDatabaseState) => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      saveLocalState(next);
    }, 350);
  }, []);

  const updateAndBroadcast = useCallback(
    (updater: (prev: CbtDatabaseState) => CbtDatabaseState) => {
      setState((prev) => {
        const next = updater(prev);
        scheduleSaveLocalState(next);
        try {
          bcRef.current?.postMessage({
            type: 'SYNC_STATE',
            payload: { ...next, liveStreams: [] },
          });
        } catch {
          // Ignore broadcast errors
        }
        return next;
      });
    },
    [scheduleSaveLocalState]
  );

  const enqueueAndSaveMutation = useCallback((mutation: PendingSyncMutation) => {
    const nextQueue = enqueuePendingMutation(pendingQueueRef.current, mutation);
    pendingQueueRef.current = nextQueue;
    savePendingQueue(nextQueue);
    setQueuedMutationsCount(nextQueue.length);
  }, []);

  const flushPendingQueue = useCallback(async () => {
    if (flushingQueueRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setCloudConnected(false);
      return;
    }
    if (pendingQueueRef.current.length === 0) {
      return;
    }

    flushingQueueRef.current = true;
    setActiveWritesCount((c) => c + 1);
    setSyncError(null);
    const flushedLabels: string[] = [];
    const flushedCols = new Set<string>();

    try {
      while (pendingQueueRef.current.length > 0) {
        const nextOp = pendingQueueRef.current[0];
        await executeSingleMutation(nextOp);
        flushedLabels.push(nextOp.label);
        flushedCols.add(nextOp.colName);
        pendingQueueRef.current = pendingQueueRef.current.slice(1);
        savePendingQueue(pendingQueueRef.current);
        setQueuedMutationsCount(pendingQueueRef.current.length);
      }

      const acked = await waitForCloudAck(4000);
      const nowIso = new Date().toISOString();
      if (acked) {
        const summary = 'Antrean perubahan berhasil disinkronkan ke pusat';
        setCloudConnected(true);
        setLastSyncedAt(nowIso);
        setLastSyncSummary(summary);
        setSyncError(null);
        broadcastSyncMeta({
          lastSyncedAt: nowIso,
          lastSyncSummary: summary,
          syncError: null,
        });
        recordSyncLog({
          status: 'Berhasil',
          summary,
          details: flushedLabels.length
            ? `Antrean terkirim (${flushedLabels.length} operasi): ${flushedLabels.slice(0, 4).join(', ')}`
            : 'Seluruh antrean offline berhasil dikirim',
          collection: Array.from(flushedCols).join(',') || 'system',
          publishPulse: true,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyinkronkan ke database pusat';
      setSyncError(msg);
      recordSyncLog({
        status: 'Gagal',
        summary: 'Gagal mengirim antrean sinkronisasi',
        details: flushedLabels.length
          ? `Sebagian terkirim (${flushedLabels.length}), sisa ${pendingQueueRef.current.length} antrean`
          : `${pendingQueueRef.current.length} operasi masih menunggu ulang`,
        collection: Array.from(flushedCols).join(',') || 'system',
        errorMessage: msg,
      });
    } finally {
      flushingQueueRef.current = false;
      setActiveWritesCount((c) => Math.max(0, c - 1));
    }
  }, [broadcastSyncMeta, recordSyncLog]);

  const runSyncedMutations = useCallback(
    async (label: string, ops: PendingSyncMutation[]) => {
      if (ops.length === 0) return;
      const logId = `slog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const cols = Array.from(new Set(ops.map((o) => o.colName))).join(',');
      const details = describeMutationDetails(ops);

      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        setCloudConnected(false);
        for (const op of ops) enqueueAndSaveMutation(op);
        setLastSyncSummary(`${label} (menunggu internet)`);
        recordSyncLog({
          id: logId,
          status: 'Menunggu',
          summary: label,
          details: `${details} · Masuk antrean offline lokal`,
          collection: cols,
        });
        return;
      }

      setActiveWritesCount((c) => c + 1);
      setSyncError(null);

      let completedIdx = 0;
      try {
        for (; completedIdx < ops.length; completedIdx++) {
          await executeSingleMutation(ops[completedIdx]);
        }

        const acked = await waitForCloudAck(3500);
        const nowIso = new Date().toISOString();
        setLastSyncedAt(nowIso);
        setLastSyncSummary(label);
        setSyncError(null);
        if (acked) {
          setCloudConnected(true);
        }
        broadcastSyncMeta({
          lastSyncedAt: nowIso,
          lastSyncSummary: label,
          syncError: null,
        });
        recordSyncLog({
          id: logId,
          status: acked ? 'Berhasil' : 'Menunggu',
          summary: label,
          details,
          collection: cols,
          publishPulse: acked,
        });
      } catch (err) {
        for (let i = completedIdx; i < ops.length; i++) {
          enqueueAndSaveMutation(ops[i]);
        }
        const rawMsg = err instanceof Error ? err.message : String(err || '');
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setCloudConnected(false);
          setLastSyncSummary(`${label} (tersimpan lokal)`);
          recordSyncLog({
            id: logId,
            status: 'Menunggu',
            summary: label,
            details: `${details} · Koneksi terputus, disimpan ke antrean`,
            collection: cols,
          });
        } else {
          const msg = rawMsg || 'Koneksi ke database pusat terganggu, mencoba ulang otomatis';
          setSyncError(msg);
          recordSyncLog({
            id: logId,
            status: 'Gagal',
            summary: label,
            details,
            collection: cols,
            errorMessage: msg,
          });
        }
      } finally {
        setActiveWritesCount((c) => Math.max(0, c - 1));
      }
    },
    [broadcastSyncMeta, enqueueAndSaveMutation, recordSyncLog]
  );

  const forceSyncNow = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const offlineMsg = 'Perangkat sedang offline. Perubahan tersimpan lokal dan akan dikirim saat online.';
      setCloudConnected(false);
      setSyncError(offlineMsg);
      recordSyncLog({
        status: 'Menunggu',
        summary: 'Sinkronisasi manual tertunda (Offline)',
        details: 'Perangkat tidak terhubung ke internet',
        collection: 'settings',
        errorMessage: offlineMsg,
      });
      return;
    }

    setActiveWritesCount((c) => c + 1);
    setSyncError(null);
    try {
      await flushPendingQueue();
      await getDocFromServer(doc(db, 'settings', 'cbt_bootstrap')).catch(() => {});
      await waitForCloudAck(4000);
      const nowIso = new Date().toISOString();
      const summary = 'Sinkronisasi manual terverifikasi dengan database pusat';
      setCloudConnected(true);
      setLastSyncedAt(nowIso);
      setLastSyncSummary(summary);
      broadcastSyncMeta({
        lastSyncedAt: nowIso,
        lastSyncSummary: summary,
        syncError: null,
      });
      recordSyncLog({
        status: 'Berhasil',
        summary,
        details: 'Verifikasi koneksi & penulisan tertunda ke Cloud Firestore selesai',
        collection: 'settings',
        publishPulse: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menghubungi server database pusat';
      setSyncError(msg);
      recordSyncLog({
        status: 'Gagal',
        summary: 'Verifikasi sinkronisasi manual gagal',
        details: 'Gagal memverifikasi sambungan ke Cloud Firestore',
        collection: 'settings',
        errorMessage: msg,
      });
    } finally {
      setActiveWritesCount((c) => Math.max(0, c - 1));
    }
  }, [broadcastSyncMeta, flushPendingQueue, recordSyncLog]);

  // Core lightweight listeners, cloud seed bootstrap, & credential initialization
  useEffect(() => {
    let active = true;

    const init = async () => {
      const primaryAdmin = await buildPrimaryAdminAccount();
      if (!active) return;

      const existing = loadLocalState();
      const needsSeed = shouldSeedInitialDatabase({
        hasLocalSnapshot: Boolean(existing),
        existingExamsCount: existing?.exams.length ?? 0,
        alreadySeededMarker: hasSeededMarker(),
      });

      if (needsSeed) {
        const seeded = await buildInitialState();
        if (!active) return;
        markDatabaseSeeded();
        setState((prev) => {
          const merged: CbtDatabaseState = {
            subjects: prev.subjects.length ? prev.subjects : seeded.subjects,
            classes: prev.classes.length ? prev.classes : seeded.classes,
            teachers: prev.teachers.length ? prev.teachers : seeded.teachers,
            admins: [primaryAdmin],
            questions: prev.questions.length ? prev.questions : seeded.questions,
            exams: prev.exams.length ? prev.exams : seeded.exams,
            results: prev.results,
            liveStreams: prev.liveStreams,
          };
          saveLocalState(merged);
          return merged;
        });
      } else {
        markDatabaseSeeded();
        setState((prev) => {
          const filtered = prev.admins.filter(
            (a) => !LEGACY_ADMIN_IDS.includes(a.id) && a.id !== PRIMARY_ADMIN_ID
          );
          const nextAdmins = [primaryAdmin, ...filtered];
          const next = { ...prev, admins: nextAdmins };
          saveLocalState(next);
          return next;
        });
      }
      if (active) setIsReady(true);

      // Ensure initial seed exists in Firestore if cloud database has never been bootstrapped,
      // so editing or deleting any default subject/class/teacher/exam syncs cleanly across all devices!
      if (!cloudBootstrapDoneRef.current && (typeof navigator === 'undefined' || navigator.onLine)) {
        cloudBootstrapDoneRef.current = true;
        try {
          const metaRef = doc(db, 'settings', 'cbt_bootstrap');
          const metaSnap = await getDocFromServer(metaRef).catch(() => null);
          if (!active) return;

          if (metaSnap && metaSnap.exists()) {
            cloudSeededConfirmRef.current = true;
            hadCloudDocsRef.current = {
              subjects: true,
              classes: true,
              teachers: true,
              exams: true,
              questions: true,
              results: true,
            };
          } else if (metaSnap && !metaSnap.exists()) {
            const seeded = await buildInitialState();
            const current = stateRef.current;
            const subjectsToSeed = current.subjects.length ? current.subjects : seeded.subjects;
            const classesToSeed = current.classes.length ? current.classes : seeded.classes;
            const teachersToSeed = current.teachers.length ? current.teachers : seeded.teachers;
            const questionsToSeed = current.questions.length ? current.questions : seeded.questions;
            const examsToSeed = current.exams.length ? current.exams : seeded.exams;

            await Promise.all([
              commitFirestoreSetChunks(
                'subjects',
                subjectsToSeed.map((s) => ({ id: s.id, data: s as unknown as Record<string, unknown> }))
              ),
              commitFirestoreSetChunks(
                'classes',
                classesToSeed.map((c) => ({ id: c.id, data: c as unknown as Record<string, unknown> }))
              ),
              commitFirestoreSetChunks(
                'teachers',
                teachersToSeed.map((t) => ({ id: t.id, data: t as unknown as Record<string, unknown> }))
              ),
              commitFirestoreSetChunks(
                'questions',
                questionsToSeed.map((q) => ({ id: q.id, data: q as unknown as Record<string, unknown> }))
              ),
              commitFirestoreSetChunks(
                'exams',
                examsToSeed.map((ex) => ({ id: ex.id, data: ex as unknown as Record<string, unknown> }))
              ),
            ]);
            await setDoc(metaRef, {
              seeded: true,
              seededAt: new Date().toISOString(),
            });
            cloudSeededConfirmRef.current = true;
          }
        } catch {
          // Offline / unreachable; snapshots & queue will recover automatically when online
        }
      }

      if (active && pendingQueueRef.current.length > 0) {
        void flushPendingQueue();
      }
    };

    init();

    // Multi-tab instant sync (never wipe in-memory liveStreams!)
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(BC_NAME);
      bcRef.current = bc;
      bc.onmessage = (ev) => {
        if (ev.data?.type === 'SYNC_STATE' && ev.data?.payload) {
          const incoming = ev.data.payload as CbtDatabaseState;
          setState((prev) => ({
            ...incoming,
            liveStreams: prev.liveStreams,
          }));
          saveLocalState(incoming);
        } else if (ev.data?.type === 'SYNC_META' && ev.data?.payload) {
          const meta = ev.data.payload as {
            lastSyncedAt: string | null;
            lastSyncSummary: string | null;
            syncError: string | null;
          };
          if (meta.lastSyncedAt) setLastSyncedAt(meta.lastSyncedAt);
          if (meta.lastSyncSummary) setLastSyncSummary(meta.lastSyncSummary);
          setSyncError(meta.syncError);
        } else if (ev.data?.type === 'SYNC_LOGS' && Array.isArray(ev.data?.payload)) {
          const incomingLogs = ev.data.payload as SyncLogEntry[];
          setSyncLogs((prev) => {
            const merged = mergeAndSortSyncLogs(incomingLogs, prev, MAX_SYNC_LOGS);
            saveLocalSyncLogs(merged);
            return merged;
          });
        }
      };
    }

    // Fallback storage-event listener for Safari/iOS installed PWAs across tabs/windows
    const onStorageSync = (ev: StorageEvent) => {
      if (ev.key === LS_KEY && ev.newValue) {
        try {
          const parsed = JSON.parse(ev.newValue) as CbtDatabaseState;
          setState((prev) => ({ ...parsed, liveStreams: prev.liveStreams }));
        } catch {
          // Ignore malformed JSON
        }
      } else if (ev.key === SYNC_LOGS_LS_KEY && ev.newValue) {
        try {
          const parsedLogs = JSON.parse(ev.newValue) as SyncLogEntry[];
          if (Array.isArray(parsedLogs)) {
            setSyncLogs((prev) => mergeAndSortSyncLogs(parsedLogs, prev, MAX_SYNC_LOGS));
          }
        } catch {
          // Ignore malformed JSON
        }
      }
    };

    // Online/offline & periodic retry listeners
    const onOnline = () => {
      setCloudConnected(true);
      setSyncError(null);
      void flushPendingQueue();
    };
    const onOffline = () => setCloudConnected(false);
    const onBeforeUnload = () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        saveLocalState(stateRef.current);
      }
    };
    window.addEventListener('storage', onStorageSync);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeunload', onBeforeUnload);

    const retryIntervalId = window.setInterval(() => {
      if (pendingQueueRef.current.length > 0 && (typeof navigator === 'undefined' || navigator.onLine)) {
        void flushPendingQueue();
      }
    }, 10_000);

    // Real-time Firestore onSnapshot subscriptions with metadata tracking
    const unsubs: Array<() => void> = [];

    const subscribeCoreCollection = <K extends keyof CbtDatabaseState>(
      colName: string,
      key: K,
      idField: string = 'id'
    ) => {
      try {
        const unsub = onSnapshot(
          collection(db, colName),
          { includeMetadataChanges: true },
          async (snap) => {
            if (!active) return;

            pendingColWritesRef.current[colName] = snap.metadata.hasPendingWrites;
            refreshPendingSnapshotFlag();

            if (!snap.metadata.fromCache) {
              setCloudConnected(true);
              if (!snap.metadata.hasPendingWrites && pendingQueueRef.current.length === 0) {
                setLastSyncedAt(new Date().toISOString());
              }
            }

            // Sync/migrate Firestore admins so rizqi / rizqi123 is always active and legacy defaults are removed
            if (colName === 'admins') {
              const primaryAdmin = await buildPrimaryAdminAccount();
              if (!active) return;
              const rawAdmins = snap.docs.map((d) => ({
                ...(d.data() as Record<string, unknown>),
                id: d.id,
              })) as unknown as AdminAccount[];

              const hasLegacy = rawAdmins.some((a) => LEGACY_ADMIN_IDS.includes(a.id));
              const hasUpdatedPrimary = rawAdmins.some(
                (a) =>
                  a.id === PRIMARY_ADMIN_ID &&
                  a.usernameHash === primaryAdmin.usernameHash &&
                  a.passwordHash === primaryAdmin.passwordHash
              );

              if ((!hasUpdatedPrimary || hasLegacy) && !adminMigratedRef.current) {
                adminMigratedRef.current = true;
                try {
                  const batch = writeBatch(db);
                  LEGACY_ADMIN_IDS.forEach((legacyId) => {
                    if (rawAdmins.some((a) => a.id === legacyId)) {
                      batch.delete(doc(db, 'admins', legacyId));
                    }
                  });
                  batch.set(
                    doc(db, 'admins', PRIMARY_ADMIN_ID),
                    removeUndefinedFields(primaryAdmin)
                  );
                  await batch.commit();
                } catch {
                  // Offline / fallback handled locally below
                }
              }

              const cleanAdmins = rawAdmins.filter(
                (a) => !LEGACY_ADMIN_IDS.includes(a.id) && a.id !== PRIMARY_ADMIN_ID
              );
              const mergedAdmins = [primaryAdmin, ...cleanAdmins];
              setState((prev) => {
                const next = { ...prev, admins: mergedAdmins };
                scheduleSaveLocalState(next);
                return next;
              });
              return;
            }

            // If Firestore is empty and has never been confirmed seeded from server, keep seed defaults
            if (
              snap.empty &&
              !hadCloudDocsRef.current[colName] &&
              !cloudSeededConfirmRef.current
            ) {
              return;
            }
            if (!snap.empty) {
              hadCloudDocsRef.current[colName] = true;
            }

            const rawDocs = filterOutPendingDeletes(
              snap.docs.map((d) => ({
                ...(d.data() as Record<string, unknown>),
                [idField]: d.id,
              })),
              pendingDeletedIdsRef.current,
              (d) => `${colName}:${String((d as Record<string, unknown>)[idField])}`
            );

            const normalizedDocs = rawDocs.map((d) => {
              if (colName === 'subjects') {
                const nama = String(d.nama || '');
                return {
                  ...d,
                  nama,
                  kode: String(d.kode || nama.slice(0, 5).toUpperCase()),
                  createdAt: String(d.createdAt || new Date().toISOString()),
                };
              }
              if (colName === 'classes') {
                const nama = String(d.nama || '');
                return {
                  ...d,
                  nama,
                  tingkat: String(d.tingkat || nama),
                  createdAt: String(d.createdAt || new Date().toISOString()),
                };
              }
              if (colName === 'teachers') {
                const primaryMapel = String(d.mataPelajaran || d.mapel || 'Matematika');
                const list = Array.isArray(d.mataPelajaranList)
                  ? d.mataPelajaranList.map((m) => String(m)).filter(Boolean)
                  : [primaryMapel];
                return {
                  ...d,
                  nama: String(d.nama || ''),
                  mataPelajaran: primaryMapel,
                  mataPelajaranList: Array.from(new Set([primaryMapel, ...list])),
                  usernameHash: String(d.usernameHash || ''),
                  usernameMasked: '••••••••',
                  passwordHash: String(d.passwordHash || d.passHash || ''),
                  aktif: d.aktif !== false,
                  createdAt: String(d.createdAt || new Date().toISOString()),
                };
              }
              if (colName === 'exams') {
                return {
                  ...d,
                  kelasTarget: Array.isArray(d.kelasTarget) ? d.kelasTarget : ['Semua Kelas'],
                  questionsSnapshot: Array.isArray(d.questionsSnapshot) ? d.questionsSnapshot : [],
                };
              }
              return d;
            }) as unknown as CbtDatabaseState[K];

            setState((prev) => {
              const next = { ...prev, [key]: normalizedDocs };
              scheduleSaveLocalState(next);
              return next;
            });
          },
          (err) => {
            if (!active) return;
            if (!navigator.onLine) setCloudConnected(false);
            else if (err?.message) {
              setSyncError(`Sinkronisasi ${colName} tertunda: ${err.message}`);
            }
          }
        );
        unsubs.push(unsub);
      } catch {
        // Ignore Firestore initialization edge cases
      }
    };

    subscribeCoreCollection('subjects', 'subjects');
    subscribeCoreCollection('classes', 'classes');
    subscribeCoreCollection('teachers', 'teachers');
    subscribeCoreCollection('admins', 'admins');
    subscribeCoreCollection('exams', 'exams');

    // Global cross-device real-time sync pulse listener (updates sync status & appVersion across ALL devices)
    try {
      const unsubPulse = onSnapshot(
        doc(db, 'settings', 'cbt_sync_pulse'),
        (snap) => {
          if (!active) return;
          if (!snap.exists()) {
            if (
              !pulseBootSyncedRef.current &&
              (typeof navigator === 'undefined' || navigator.onLine)
            ) {
              pulseBootSyncedRef.current = true;
              const nowIso = new Date().toISOString();
              void setDoc(
                doc(db, 'settings', 'cbt_sync_pulse'),
                {
                  rev: Date.now(),
                  updatedAt: nowIso,
                  summary: 'Sinkronisasi versi aplikasi aktif',
                  deviceId: deviceIdRef.current,
                  appVersion: APP_VERSION,
                },
                { merge: true }
              ).catch(() => {});
            }
            return;
          }
          const data = snap.data() as {
            updatedAt?: string;
            summary?: string;
            actorName?: string;
            deviceId?: string;
            appVersion?: string;
          };
          const remoteVer = data.appVersion ? String(data.appVersion).trim() : '';
          if (remoteVer) {
            remotePulseVersionRef.current = remoteVer;
            setPulseAppVersion(remoteVer);
          }
          // If this device runs a newer release than Firestore's recorded pulse, bump cloud pulse forward
          // so every other installed PWA immediately receives the new version notification!
          if (
            !pulseBootSyncedRef.current &&
            (!remoteVer || isNewerAppVersion(APP_VERSION, remoteVer)) &&
            (typeof navigator === 'undefined' || navigator.onLine)
          ) {
            pulseBootSyncedRef.current = true;
            const nowIso = new Date().toISOString();
            void setDoc(
              doc(db, 'settings', 'cbt_sync_pulse'),
              {
                rev: Date.now(),
                updatedAt: nowIso,
                summary: `Rilis versi aplikasi ${APP_VERSION}`,
                deviceId: deviceIdRef.current,
                appVersion: APP_VERSION,
              },
              { merge: true }
            ).catch(() => {});
          }
          if (data.updatedAt) {
            setLastSyncedAt(String(data.updatedAt));
          }
          if (data.summary) {
            const actorTag =
              data.actorName && data.deviceId !== deviceIdRef.current
                ? `${data.summary} (${data.actorName})`
                : data.summary;
            setLastSyncSummary(actorTag);
          }
        },
        () => {}
      );
      unsubs.push(unsubPulse);
    } catch {
      // Ignore listener init errors
    }

    return () => {
      active = false;
      window.clearInterval(retryIntervalId);
      unsubs.forEach((u) => u());
      bcRef.current?.close();
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        saveLocalState(stateRef.current);
      }
      window.removeEventListener('storage', onStorageSync);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [flushPendingQueue, refreshPendingSnapshotFlag, scheduleSaveLocalState]);

  // Heavy collections (questions bank, all results, all live webcam streams) ONLY subscribe for Guru & Admin
  useEffect(() => {
    if (activeRole === 'siswa') return;

    let active = true;
    const unsubs: Array<() => void> = [];

    const subscribeHeavyCollection = <K extends keyof CbtDatabaseState>(
      colName: string,
      key: K,
      idField: string = 'id'
    ) => {
      try {
        const unsub = onSnapshot(
          collection(db, colName),
          { includeMetadataChanges: true },
          (snap) => {
            if (!active) return;
            if (colName !== 'live_streams') {
              pendingColWritesRef.current[colName] = snap.metadata.hasPendingWrites;
              refreshPendingSnapshotFlag();
            }
            if (!snap.metadata.fromCache) {
              setCloudConnected(true);
              if (colName !== 'live_streams' && !snap.metadata.hasPendingWrites) {
                setLastSyncedAt(new Date().toISOString());
              }
            }
            if (
              snap.empty &&
              !hadCloudDocsRef.current[colName] &&
              !cloudSeededConfirmRef.current
            ) {
              return;
            }
            if (!snap.empty) {
              hadCloudDocsRef.current[colName] = true;
            }
            const rawDocs = filterOutPendingDeletes(
              snap.docs.map((d) => ({
                ...(d.data() as Record<string, unknown>),
                [idField]: d.id,
              })),
              pendingDeletedIdsRef.current,
              (d) => `${colName}:${String((d as Record<string, unknown>)[idField])}`
            );

            const normalizedDocs = rawDocs.map((d) => {
              if (colName === 'results') {
                return {
                  ...d,
                  jawabanDetail: Array.isArray(d.jawabanDetail) ? d.jawabanDetail : [],
                  status: d.status === 'Pelanggaran' ? 'Pelanggaran' : 'Selesai',
                };
              }
              return d;
            }) as unknown as CbtDatabaseState[K];

            setState((prev) => {
              const next = { ...prev, [key]: normalizedDocs };
              if (colName !== 'live_streams') {
                scheduleSaveLocalState(next);
              }
              return next;
            });
          },
          () => {
            if (active && !navigator.onLine) setCloudConnected(false);
          }
        );
        unsubs.push(unsub);
      } catch {
        // Ignore
      }
    };

    subscribeHeavyCollection('questions', 'questions');
    subscribeHeavyCollection('results', 'results');
    subscribeHeavyCollection('live_streams', 'liveStreams', 'sessionId');

    if (activeRole === 'admin') {
      try {
        const logsQuery = query(
          collection(db, 'sync_logs'),
          orderBy('timestampMs', 'desc'),
          limit(MAX_SYNC_LOGS)
        );
        const unsubLogs = onSnapshot(
          logsQuery,
          (snap) => {
            if (!active) return;
            const cloudLogs = snap.docs.map((d) => ({
              ...(d.data() as Record<string, unknown>),
              id: d.id,
            })) as unknown as SyncLogEntry[];
            setSyncLogs((prev) => {
              const merged = mergeAndSortSyncLogs(prev, cloudLogs, MAX_SYNC_LOGS);
              saveLocalSyncLogs(merged);
              return merged;
            });
          },
          () => {}
        );
        unsubs.push(unsubLogs);
      } catch {
        // Ignore query init edge cases
      }
    }

    return () => {
      active = false;
      unsubs.forEach((u) => u());
    };
  }, [activeRole, refreshPendingSnapshotFlag, scheduleSaveLocalState]);

  // --- SUBJECTS CRUD ---
  const addSubject = useCallback(
    async (nama: string, kode: string) => {
      const item: SubjectItem = {
        id: `subj_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        nama: nama.trim(),
        kode: kode.trim().toUpperCase() || nama.trim().slice(0, 5).toUpperCase(),
        createdAt: new Date().toISOString(),
      };
      updateAndBroadcast((prev) => ({ ...prev, subjects: [...prev.subjects, item] }));
      await runSyncedMutations(`Mapel "${item.nama}" ditambahkan`, [
        {
          opId: `op_${Date.now()}_subj_add`,
          type: 'set',
          colName: 'subjects',
          docId: item.id,
          data: item as unknown as Record<string, unknown>,
          label: `Mapel "${item.nama}" ditambahkan`,
          createdAt: Date.now(),
        },
      ]);
      return item;
    },
    [runSyncedMutations, updateAndBroadcast]
  );

  const updateSubject = useCallback(
    async (id: string, nama: string, kode: string) => {
      const oldSubj = stateRef.current.subjects.find((s) => s.id === id);
      const updatedName = nama.trim();
      const updatedCode = kode.trim().toUpperCase();
      const nextSubj: SubjectItem = oldSubj
        ? { ...oldSubj, nama: updatedName, kode: updatedCode }
        : {
            id,
            nama: updatedName,
            kode: updatedCode || updatedName.slice(0, 5).toUpperCase(),
            createdAt: new Date().toISOString(),
          };

      const cascaded = oldSubj
        ? cascadeSubjectRename({
            oldName: oldSubj.nama,
            newName: updatedName,
            teachers: stateRef.current.teachers,
            questions: stateRef.current.questions,
            exams: stateRef.current.exams,
            results: stateRef.current.results,
          })
        : null;

      updateAndBroadcast((prev) => {
        const nextCascade = oldSubj
          ? cascadeSubjectRename({
              oldName: oldSubj.nama,
              newName: updatedName,
              teachers: prev.teachers,
              questions: prev.questions,
              exams: prev.exams,
              results: prev.results,
            })
          : null;
        return {
          ...prev,
          subjects: prev.subjects.map((s) => (s.id === id ? nextSubj : s)),
          teachers: nextCascade ? nextCascade.teachers : prev.teachers,
          questions: nextCascade ? nextCascade.questions : prev.questions,
          exams: nextCascade ? nextCascade.exams : prev.exams,
          results: nextCascade ? nextCascade.results : prev.results,
        };
      });

      const ops: PendingSyncMutation[] = [
        {
          opId: `op_${Date.now()}_subj_upd`,
          type: 'set',
          colName: 'subjects',
          docId: id,
          data: nextSubj as unknown as Record<string, unknown>,
          label: `Mapel "${updatedName}" diperbarui`,
          createdAt: Date.now(),
        },
      ];

      if (cascaded) {
        if (cascaded.affectedTeachers.length > 0) {
          ops.push({
            opId: `op_${Date.now()}_subj_c_teach`,
            type: 'set_batch',
            colName: 'teachers',
            entries: cascaded.affectedTeachers.map((t) => ({
              id: t.id,
              data: t as unknown as Record<string, unknown>,
            })),
            label: `Sinkron mapel guru`,
            createdAt: Date.now(),
          });
        }
        if (cascaded.affectedQuestions.length > 0) {
          ops.push({
            opId: `op_${Date.now()}_subj_c_q`,
            type: 'set_batch',
            colName: 'questions',
            entries: cascaded.affectedQuestions.map((q) => ({
              id: q.id,
              data: q as unknown as Record<string, unknown>,
            })),
            label: `Sinkron mapel bank soal`,
            createdAt: Date.now(),
          });
        }
        if (cascaded.affectedExams.length > 0) {
          ops.push({
            opId: `op_${Date.now()}_subj_c_ex`,
            type: 'set_batch',
            colName: 'exams',
            entries: cascaded.affectedExams.map((ex) => ({
              id: ex.id,
              data: ex as unknown as Record<string, unknown>,
            })),
            label: `Sinkron mapel jadwal`,
            createdAt: Date.now(),
          });
        }
        if (cascaded.affectedResults.length > 0) {
          ops.push({
            opId: `op_${Date.now()}_subj_c_res`,
            type: 'set_batch',
            colName: 'results',
            entries: cascaded.affectedResults.map((r) => ({
              id: r.id,
              data: r as unknown as Record<string, unknown>,
            })),
            label: `Sinkron mapel hasil nilai`,
            createdAt: Date.now(),
          });
        }
      }

      await runSyncedMutations(`Mapel "${updatedName}" diperbarui & tersinkron`, ops);
    },
    [runSyncedMutations, updateAndBroadcast]
  );

  const deleteSubject = useCallback(
    async (id: string) => {
      const target = stateRef.current.subjects.find((s) => s.id === id);
      markPendingDeletes('subjects', [id]);
      updateAndBroadcast((prev) => ({
        ...prev,
        subjects: prev.subjects.filter((s) => s.id !== id),
      }));
      await runSyncedMutations(`Mapel "${target?.nama || id}" dihapus`, [
        {
          opId: `op_${Date.now()}_subj_del`,
          type: 'delete',
          colName: 'subjects',
          docId: id,
          label: `Hapus mapel`,
          createdAt: Date.now(),
        },
      ]);
    },
    [markPendingDeletes, runSyncedMutations, updateAndBroadcast]
  );

  // --- CLASSES CRUD (With Cascade Sync) ---
  const addClass = useCallback(
    async (nama: string, tingkat: string) => {
      const item: ClassItem = {
        id: `cls_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        nama: nama.trim(),
        tingkat: tingkat.trim() || 'VII',
        createdAt: new Date().toISOString(),
      };
      updateAndBroadcast((prev) => ({ ...prev, classes: [...prev.classes, item] }));
      await runSyncedMutations(`Kelas "${item.nama}" ditambahkan`, [
        {
          opId: `op_${Date.now()}_cls_add`,
          type: 'set',
          colName: 'classes',
          docId: item.id,
          data: item as unknown as Record<string, unknown>,
          label: `Kelas "${item.nama}" ditambahkan`,
          createdAt: Date.now(),
        },
      ]);
      return item;
    },
    [runSyncedMutations, updateAndBroadcast]
  );

  const updateClass = useCallback(
    async (id: string, nama: string, tingkat: string) => {
      const nextName = nama.trim();
      const nextTingkat = tingkat.trim();
      const existing = stateRef.current.classes.find((c) => c.id === id);
      if (!existing) return;

      const updatedClass: ClassItem = { ...existing, nama: nextName, tingkat: nextTingkat };
      const cascaded = cascadeClassRename({
        oldName: existing.nama,
        newName: nextName,
        exams: stateRef.current.exams,
        results: stateRef.current.results,
      });

      updateAndBroadcast((prev) => {
        const nextCascade = cascadeClassRename({
          oldName: existing.nama,
          newName: nextName,
          exams: prev.exams,
          results: prev.results,
        });
        return {
          ...prev,
          classes: prev.classes.map((c) => (c.id === id ? updatedClass : c)),
          exams: nextCascade.exams,
          results: nextCascade.results,
        };
      });

      const ops: PendingSyncMutation[] = [
        {
          opId: `op_${Date.now()}_cls_upd`,
          type: 'set',
          colName: 'classes',
          docId: id,
          data: updatedClass as unknown as Record<string, unknown>,
          label: `Kelas "${nextName}" diperbarui`,
          createdAt: Date.now(),
        },
      ];
      if (cascaded.affectedExams.length > 0) {
        ops.push({
          opId: `op_${Date.now()}_cls_c_ex`,
          type: 'set_batch',
          colName: 'exams',
          entries: cascaded.affectedExams.map((ex) => ({
            id: ex.id,
            data: ex as unknown as Record<string, unknown>,
          })),
          label: `Sinkron target kelas jadwal`,
          createdAt: Date.now(),
        });
      }
      if (cascaded.affectedResults.length > 0) {
        ops.push({
          opId: `op_${Date.now()}_cls_c_res`,
          type: 'set_batch',
          colName: 'results',
          entries: cascaded.affectedResults.map((r) => ({
            id: r.id,
            data: r as unknown as Record<string, unknown>,
          })),
          label: `Sinkron kelas hasil nilai`,
          createdAt: Date.now(),
        });
      }

      await runSyncedMutations(`Kelas "${nextName}" diperbarui & tersinkron`, ops);
    },
    [runSyncedMutations, updateAndBroadcast]
  );

  const deleteClass = useCallback(
    async (id: string) => {
      const target = stateRef.current.classes.find((c) => c.id === id);
      markPendingDeletes('classes', [id]);
      updateAndBroadcast((prev) => ({
        ...prev,
        classes: prev.classes.filter((c) => c.id !== id),
      }));
      await runSyncedMutations(`Kelas "${target?.nama || id}" dihapus`, [
        {
          opId: `op_${Date.now()}_cls_del`,
          type: 'delete',
          colName: 'classes',
          docId: id,
          label: `Hapus kelas`,
          createdAt: Date.now(),
        },
      ]);
    },
    [markPendingDeletes, runSyncedMutations, updateAndBroadcast]
  );

  // --- TEACHERS CRUD (Privacy-Hardened with SHA-256 + Multi-Subject) ---
  const addTeacher = useCallback(
    async (params: {
      nama: string;
      mataPelajaran: string;
      mataPelajaranList?: string[];
      username: string;
      password: string;
    }) => {
      const usernameHash = await hashCredential(params.username);
      const passwordHash = await hashCredential(params.password);
      const subjectList = Array.from(
        new Set([params.mataPelajaran, ...(params.mataPelajaranList || [])].filter(Boolean))
      );
      const teacher: TeacherAccount = {
        id: `teacher_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        nama: params.nama.trim(),
        mataPelajaran: subjectList[0] || params.mataPelajaran,
        mataPelajaranList: subjectList,
        usernameHash,
        usernameMasked: '••••••••',
        passwordHash,
        aktif: true,
        createdAt: new Date().toISOString(),
      };
      updateAndBroadcast((prev) => ({ ...prev, teachers: [...prev.teachers, teacher] }));
      await runSyncedMutations(`Akun guru "${teacher.nama}" disimpan`, [
        {
          opId: `op_${Date.now()}_teach_add`,
          type: 'set',
          colName: 'teachers',
          docId: teacher.id,
          data: teacher as unknown as Record<string, unknown>,
          label: `Tambah guru ${teacher.nama}`,
          createdAt: Date.now(),
        },
      ]);
      return teacher;
    },
    [runSyncedMutations, updateAndBroadcast]
  );

  const updateTeacher = useCallback(
    async (
      id: string,
      params: {
        nama: string;
        mataPelajaran: string;
        mataPelajaranList?: string[];
        newUsername?: string;
        newPassword?: string;
        aktif: boolean;
      }
    ) => {
      const existing = stateRef.current.teachers.find((t) => t.id === id);
      if (!existing) return;

      const usernameHash =
        params.newUsername && params.newUsername.trim()
          ? await hashCredential(params.newUsername)
          : existing.usernameHash;
      const passwordHash =
        params.newPassword && params.newPassword.trim()
          ? await hashCredential(params.newPassword)
          : existing.passwordHash;

      const subjectList = Array.from(
        new Set([params.mataPelajaran, ...(params.mataPelajaranList || [])].filter(Boolean))
      );

      const updated: TeacherAccount = {
        ...existing,
        nama: params.nama.trim(),
        mataPelajaran: subjectList[0] || params.mataPelajaran,
        mataPelajaranList: subjectList,
        usernameHash,
        usernameMasked: '••••••••',
        passwordHash,
        aktif: params.aktif,
      };

      updateAndBroadcast((prev) => ({
        ...prev,
        teachers: prev.teachers.map((t) => (t.id === id ? updated : t)),
      }));
      await runSyncedMutations(`Akun guru "${updated.nama}" diperbarui`, [
        {
          opId: `op_${Date.now()}_teach_upd`,
          type: 'set',
          colName: 'teachers',
          docId: id,
          data: updated as unknown as Record<string, unknown>,
          label: `Update guru ${updated.nama}`,
          createdAt: Date.now(),
        },
      ]);
    },
    [runSyncedMutations, updateAndBroadcast]
  );

  const deleteTeacher = useCallback(
    async (id: string) => {
      const target = stateRef.current.teachers.find((t) => t.id === id);
      markPendingDeletes('teachers', [id]);
      updateAndBroadcast((prev) => ({
        ...prev,
        teachers: prev.teachers.filter((t) => t.id !== id),
      }));
      await runSyncedMutations(`Akun guru "${target?.nama || id}" dihapus`, [
        {
          opId: `op_${Date.now()}_teach_del`,
          type: 'delete',
          colName: 'teachers',
          docId: id,
          label: `Hapus guru`,
          createdAt: Date.now(),
        },
      ]);
    },
    [markPendingDeletes, runSyncedMutations, updateAndBroadcast]
  );

  // --- QUESTIONS BANK CRUD ---
  const addQuestion = useCallback(
    async (q: Omit<Question, 'id' | 'createdAt'>) => {
      const item: Question = {
        ...q,
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        createdAt: new Date().toISOString(),
      };
      updateAndBroadcast((prev) => ({ ...prev, questions: [...prev.questions, item] }));
      await runSyncedMutations(`Soal ${item.mataPelajaran} ditambahkan`, [
        {
          opId: `op_${Date.now()}_q_add`,
          type: 'set',
          colName: 'questions',
          docId: item.id,
          data: item as unknown as Record<string, unknown>,
          label: `Tambah soal ${item.mataPelajaran}`,
          createdAt: Date.now(),
        },
      ]);
      return item;
    },
    [runSyncedMutations, updateAndBroadcast]
  );

  const addQuestionsBatch = useCallback(
    async (items: Array<Omit<Question, 'id' | 'createdAt'>>) => {
      if (items.length === 0) return [];
      const now = new Date().toISOString();
      const created: Question[] = items.map((q, idx) => ({
        ...q,
        id: `q_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 5)}`,
        createdAt: now,
      }));
      updateAndBroadcast((prev) => ({ ...prev, questions: [...prev.questions, ...created] }));
      await runSyncedMutations(`${created.length} soal ditambahkan ke Bank Soal`, [
        {
          opId: `op_${Date.now()}_q_batch_add`,
          type: 'set_batch',
          colName: 'questions',
          entries: created.map((item) => ({
            id: item.id,
            data: item as unknown as Record<string, unknown>,
          })),
          label: `Simpan ${created.length} soal`,
          createdAt: Date.now(),
        },
      ]);
      return created;
    },
    [runSyncedMutations, updateAndBroadcast]
  );

  const updateQuestion = useCallback(
    async (updated: Question) => {
      updateAndBroadcast((prev) => ({
        ...prev,
        questions: prev.questions.map((q) => (q.id === updated.id ? updated : q)),
      }));
      await runSyncedMutations(`Soal ${updated.mataPelajaran} diperbarui`, [
        {
          opId: `op_${Date.now()}_q_upd`,
          type: 'set',
          colName: 'questions',
          docId: updated.id,
          data: updated as unknown as Record<string, unknown>,
          label: `Edit soal ${updated.mataPelajaran}`,
          createdAt: Date.now(),
        },
      ]);
    },
    [runSyncedMutations, updateAndBroadcast]
  );

  const deleteQuestion = useCallback(
    async (id: string) => {
      markPendingDeletes('questions', [id]);
      updateAndBroadcast((prev) => ({
        ...prev,
        questions: prev.questions.filter((q) => q.id !== id),
      }));
      await runSyncedMutations('1 butir soal dihapus dari Bank Soal', [
        {
          opId: `op_${Date.now()}_q_del`,
          type: 'delete',
          colName: 'questions',
          docId: id,
          label: 'Hapus 1 soal',
          createdAt: Date.now(),
        },
      ]);
    },
    [markPendingDeletes, runSyncedMutations, updateAndBroadcast]
  );

  const deleteQuestionsBatch = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      markPendingDeletes('questions', ids);
      updateAndBroadcast((prev) => ({
        ...prev,
        questions: prev.questions.filter((q) => !idSet.has(q.id)),
      }));
      await runSyncedMutations(`${ids.length} soal dihapus dari Bank Soal`, [
        {
          opId: `op_${Date.now()}_q_del_batch`,
          type: 'delete_batch',
          colName: 'questions',
          docIds: ids,
          label: `Hapus ${ids.length} soal`,
          createdAt: Date.now(),
        },
      ]);
    },
    [markPendingDeletes, runSyncedMutations, updateAndBroadcast]
  );

  const clearBankBySubject = useCallback(
    async (mataPelajaran: string) => {
      const toDelete = stateRef.current.questions.filter(
        (q) => q.mataPelajaran === mataPelajaran
      );
      if (toDelete.length === 0) return;
      const ids = toDelete.map((q) => q.id);
      markPendingDeletes('questions', ids);
      updateAndBroadcast((prev) => ({
        ...prev,
        questions: clearBankQuestionsForSubject(prev.questions, mataPelajaran),
      }));
      await runSyncedMutations(`Bank Soal ${mataPelajaran} dikosongkan (${ids.length} soal)`, [
        {
          opId: `op_${Date.now()}_q_clear`,
          type: 'delete_batch',
          colName: 'questions',
          docIds: ids,
          label: `Kosongkan Bank Soal ${mataPelajaran}`,
          createdAt: Date.now(),
        },
      ]);
    },
    [markPendingDeletes, runSyncedMutations, updateAndBroadcast]
  );

  // --- EXAM SCHEDULES CRUD (Snapshot-Safe + Real-Time Sync) ---
  const saveExamSchedule = useCallback(
    async (exam: ExamSchedule) => {
      const exists = stateRef.current.exams.some((e) => e.id === exam.id);
      updateAndBroadcast((prev) => {
        const has = prev.exams.some((e) => e.id === exam.id);
        return {
          ...prev,
          exams: has
            ? prev.exams.map((e) => (e.id === exam.id ? exam : e))
            : [exam, ...prev.exams],
        };
      });
      const label = exists
        ? `Jadwal "${exam.judulUjian}" diperbarui`
        : `Jadwal "${exam.judulUjian}" diterbitkan`;
      await runSyncedMutations(label, [
        {
          opId: `op_${Date.now()}_exam_save`,
          type: 'set',
          colName: 'exams',
          docId: exam.id,
          data: exam as unknown as Record<string, unknown>,
          label,
          createdAt: Date.now(),
        },
      ]);
    },
    [runSyncedMutations, updateAndBroadcast]
  );

  const toggleExamActive = useCallback(
    async (id: string) => {
      const target = stateRef.current.exams.find((e) => e.id === id);
      if (!target) return;
      const updated: ExamSchedule = {
        ...target,
        aktif: !target.aktif,
        updatedAt: new Date().toISOString(),
      };
      updateAndBroadcast((prev) => ({
        ...prev,
        exams: prev.exams.map((e) => (e.id === id ? updated : e)),
      }));
      const label = updated.aktif
        ? `Ujian "${updated.judulUjian}" diaktifkan`
        : `Ujian "${updated.judulUjian}" dihentikan/ditutup`;
      await runSyncedMutations(label, [
        {
          opId: `op_${Date.now()}_exam_toggle`,
          type: 'set',
          colName: 'exams',
          docId: id,
          data: updated as unknown as Record<string, unknown>,
          label,
          createdAt: Date.now(),
        },
      ]);
    },
    [runSyncedMutations, updateAndBroadcast]
  );

  const deleteExamSchedule = useCallback(
    async (id: string) => {
      const target = stateRef.current.exams.find((e) => e.id === id);
      markPendingDeletes('exams', [id]);
      updateAndBroadcast((prev) => ({
        ...prev,
        exams: prev.exams.filter((e) => e.id !== id),
      }));
      await runSyncedMutations(`Jadwal "${target?.judulUjian || id}" dihapus`, [
        {
          opId: `op_${Date.now()}_exam_del`,
          type: 'delete',
          colName: 'exams',
          docId: id,
          label: 'Hapus jadwal ujian',
          createdAt: Date.now(),
        },
      ]);
    },
    [markPendingDeletes, runSyncedMutations, updateAndBroadcast]
  );

  // --- UNIFIED EXAM RESULT SUBMISSION ---
  const submitExamResult = useCallback(
    async (result: ExamResult): Promise<void> => {
      const clean = removeUndefinedFields(result);
      updateAndBroadcast((prev) => {
        const exists = prev.results.some((r) => r.id === clean.id);
        return {
          ...prev,
          results: exists
            ? prev.results.map((r) => (r.id === clean.id ? clean : r))
            : [clean, ...prev.results],
        };
      });
      await runSyncedMutations(`Jawaban ${clean.namaSiswa} tersimpan`, [
        {
          opId: `op_${Date.now()}_res_submit`,
          type: 'set',
          colName: 'results',
          docId: clean.id,
          data: clean as unknown as Record<string, unknown>,
          label: `Submit hasil ${clean.namaSiswa}`,
          createdAt: Date.now(),
        },
      ]);
    },
    [runSyncedMutations, updateAndBroadcast]
  );

  const updateResultEssayScore = useCallback(
    async (resultId: string, newEssayPercent: number, updatedNilaiAkhir: number) => {
      const target = stateRef.current.results.find((r) => r.id === resultId);
      if (!target) return;
      const updated: ExamResult = {
        ...target,
        skorEsai: newEssayPercent,
        nilaiAkhir: updatedNilaiAkhir,
      };
      updateAndBroadcast((prev) => ({
        ...prev,
        results: prev.results.map((r) => (r.id === resultId ? updated : r)),
      }));
      await runSyncedMutations(`Nilai esai ${updated.namaSiswa} (${updatedNilaiAkhir}) tersimpan`, [
        {
          opId: `op_${Date.now()}_res_essay`,
          type: 'set',
          colName: 'results',
          docId: resultId,
          data: updated as unknown as Record<string, unknown>,
          label: `Koreksi esai ${updated.namaSiswa}`,
          createdAt: Date.now(),
        },
      ]);
    },
    [runSyncedMutations, updateAndBroadcast]
  );

  const deleteExamResult = useCallback(
    async (resultId: string) => {
      const target = stateRef.current.results.find((r) => r.id === resultId);
      markPendingDeletes('results', [resultId]);
      updateAndBroadcast((prev) => ({
        ...prev,
        results: prev.results.filter((r) => r.id !== resultId),
      }));
      await runSyncedMutations(`Hasil ujian ${target?.namaSiswa || ''} dihapus`, [
        {
          opId: `op_${Date.now()}_res_del`,
          type: 'delete',
          colName: 'results',
          docId: resultId,
          label: 'Hapus hasil ujian',
          createdAt: Date.now(),
        },
      ]);
    },
    [markPendingDeletes, runSyncedMutations, updateAndBroadcast]
  );

  // --- LIVE PROCTORING STREAMS (Ephemeral: skip localStorage/BroadcastChannel serialization) ---
  const upsertLiveStream = useCallback(async (session: LiveStreamSession) => {
    const clean = removeUndefinedFields(session);
    setState((prev) => {
      const exists = prev.liveStreams.some((s) => s.sessionId === clean.sessionId);
      return {
        ...prev,
        liveStreams: exists
          ? prev.liveStreams.map((s) => (s.sessionId === clean.sessionId ? clean : s))
          : [clean, ...prev.liveStreams],
      };
    });
    await setDoc(doc(db, 'live_streams', clean.sessionId), clean, { merge: true }).catch(
      () => {}
    );
  }, []);

  const sendProctorWarning = useCallback(async (sessionId: string, message: string) => {
    const timestamp = Date.now();
    setState((prev) => ({
      ...prev,
      liveStreams: prev.liveStreams.map((s) =>
        s.sessionId === sessionId
          ? { ...s, proctorWarningMessage: message, proctorAlarmTriggerAt: timestamp }
          : s
      ),
    }));
    await setDoc(
      doc(db, 'live_streams', sessionId),
      { proctorWarningMessage: message, proctorAlarmTriggerAt: timestamp },
      { merge: true }
    ).catch(() => {});
  }, []);

  const deleteLiveStream = useCallback(
    async (sessionId: string) => {
      markPendingDeletes('live_streams', [sessionId]);
      setState((prev) => ({
        ...prev,
        liveStreams: prev.liveStreams.filter((s) => s.sessionId !== sessionId),
      }));
      await deleteDoc(doc(db, 'live_streams', sessionId)).catch(() => {});
    },
    [markPendingDeletes]
  );

  // --- AUTHENTICATION VERIFIERS ---
  const authenticateTeacher = useCallback(
    async (username: string, password: string): Promise<TeacherAccount | null> => {
      const trimmedUser = username.trim();
      const uHash = await hashCredential(trimmedUser);
      const pHash = await hashCredential(password);
      const found = stateRef.current.teachers.find((t) => {
        if (!t.aktif) return false;
        const raw = t as unknown as Record<string, unknown>;
        const legacyUser = typeof raw.username === 'string' ? raw.username.trim() : '';
        const userMatch =
          t.usernameHash === uHash ||
          (legacyUser !== '' && (legacyUser === trimmedUser || legacyUser === uHash));
        const storedPassHash = t.passwordHash || String(raw.passHash || '');
        const legacyPlainPass = typeof raw.password === 'string' ? raw.password : '';
        const passMatch = storedPassHash === pHash || (legacyPlainPass !== '' && legacyPlainPass === password);
        return userMatch && passMatch;
      });
      if (!found) return null;
      return {
        ...found,
        mataPelajaranList: getTeacherSubjects(found),
      };
    },
    []
  );

  const authenticateAdmin = useCallback(
    async (username: string, password: string): Promise<AdminAccount | null> => {
      const trimmedUser = username.trim();
      const uHash = await hashCredential(trimmedUser);
      const pHash = await hashCredential(password);

      const candidates =
        stateRef.current.admins.length > 0
          ? stateRef.current.admins
          : [await buildPrimaryAdminAccount()];

      const found = candidates.find((a) => {
        if (LEGACY_ADMIN_IDS.includes(a.id)) return false;
        const raw = a as unknown as Record<string, unknown>;
        const legacyUser = typeof raw.username === 'string' ? raw.username.trim() : '';
        const userMatch = a.usernameHash === uHash || (legacyUser !== '' && legacyUser === trimmedUser);
        const storedPassHash = a.passwordHash || String(raw.passHash || '');
        const legacyPlainPass = typeof raw.password === 'string' ? raw.password : '';
        const passMatch = storedPassHash === pHash || (legacyPlainPass !== '' && legacyPlainPass === password);
        return userMatch && passMatch;
      });
      return found || null;
    },
    []
  );

  const syncInfo = useMemo<SyncStatusInfo>(() => {
    const status = deriveSyncStatus({
      isOnline: cloudConnected,
      activeWritesCount,
      queuedCount: queuedMutationsCount,
      hasSnapshotPendingWrites,
      lastError: syncError,
    });
    return {
      status,
      pendingCount: activeWritesCount + queuedMutationsCount,
      queuedMutationsCount,
      lastSyncedAt,
      lastSyncSummary,
      errorMessage: syncError,
      cloudConnected,
    };
  }, [
    activeWritesCount,
    cloudConnected,
    hasSnapshotPendingWrites,
    lastSyncSummary,
    lastSyncedAt,
    queuedMutationsCount,
    syncError,
  ]);

  return {
    ...state,
    cloudConnected,
    syncInfo,
    syncLogs,
    pulseAppVersion,
    forceSyncNow,
    isReady,
    addSubject,
    updateSubject,
    deleteSubject,
    addClass,
    updateClass,
    deleteClass,
    addTeacher,
    updateTeacher,
    deleteTeacher,
    addQuestion,
    addQuestionsBatch,
    updateQuestion,
    deleteQuestion,
    deleteQuestionsBatch,
    clearBankBySubject,
    saveExamSchedule,
    toggleExamActive,
    deleteExamSchedule,
    submitExamResult,
    updateResultEssayScore,
    deleteExamResult,
    upsertLiveStream,
    sendProctorWarning,
    deleteLiveStream,
    authenticateTeacher,
    authenticateAdmin,
  };
}
