import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSyncLogsCsv,
  cascadeClassRename,
  cascadeSubjectRename,
  chunkArray,
  createSyncLogEntry,
  deriveSyncStatus,
  enqueuePendingMutation,
  filterOutPendingDeletes,
  filterSyncLogs,
  getTeacherSubjects,
  inferSyncMetadataFromLabel,
  mergeAndSortSyncLogs,
  removeUndefinedFields,
  shouldSeedInitialDatabase,
} from './storeSyncUtils';
import type { ExamResult, ExamSchedule, Question, SyncLogEntry, TeacherAccount } from '../types/cbt';

test('removeUndefinedFields removes nested undefined values while keeping primitives and arrays intact', () => {
  const input = {
    id: 'q1',
    pertanyaanHtml: '<p>Test</p><img src="data:image/png;base64,AAA" />',
    pembahasan: undefined,
    opsi: ['A', 'B', undefined],
    nested: {
      a: 1,
      b: undefined,
      c: false,
      d: '',
    },
  };

  const cleaned = removeUndefinedFields(input);
  assert.equal('pembahasan' in cleaned, false);
  assert.equal('b' in cleaned.nested, false);
  assert.equal(cleaned.nested.c, false);
  assert.equal(cleaned.nested.d, '');
  assert.deepEqual(cleaned.opsi, ['A', 'B']);
});

test('chunkArray divides >500 items safely into <=400 item Firestore batches', () => {
  assert.deepEqual(chunkArray([], 400), []);
  const items = Array.from({ length: 950 }, (_, i) => `q_${i}`);
  const chunks = chunkArray(items, 400);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 400);
  assert.equal(chunks[1].length, 400);
  assert.equal(chunks[2].length, 150);
});

test('filterOutPendingDeletes blocks deleted items within TTL and releases expired tombstones', () => {
  const now = 1_700_000_020_000;
  const tombstones = new Map<string, number>([
    ['q_just_deleted', now - 2_000],
    ['q_expired', now - 20_000],
  ]);

  const incoming = [
    { id: 'q_just_deleted', text: 'ghost' },
    { id: 'q_expired', text: 'old re-added' },
    { id: 'q_active', text: 'keep' },
  ];

  const filtered = filterOutPendingDeletes(incoming, tombstones, (d) => d.id, now, 15_000);
  assert.deepEqual(
    filtered.map((d) => d.id),
    ['q_expired', 'q_active']
  );
  assert.equal(tombstones.has('q_expired'), false);
  assert.equal(tombstones.has('q_just_deleted'), true);
});

test('shouldSeedInitialDatabase never resurrects deleted items once already seeded', () => {
  assert.equal(
    shouldSeedInitialDatabase({
      hasLocalSnapshot: false,
      existingExamsCount: 0,
      alreadySeededMarker: false,
    }),
    true
  );

  assert.equal(
    shouldSeedInitialDatabase({
      hasLocalSnapshot: true,
      existingExamsCount: 0,
      alreadySeededMarker: true,
    }),
    false
  );
});

test('deriveSyncStatus prioritizes offline, error, syncing, and synced properly', () => {
  assert.equal(
    deriveSyncStatus({
      isOnline: false,
      activeWritesCount: 2,
      queuedCount: 1,
      hasSnapshotPendingWrites: true,
      lastError: 'timeout',
    }),
    'offline'
  );
  assert.equal(
    deriveSyncStatus({
      isOnline: true,
      activeWritesCount: 0,
      queuedCount: 1,
      hasSnapshotPendingWrites: false,
      lastError: 'permission-denied',
    }),
    'error'
  );
  assert.equal(
    deriveSyncStatus({
      isOnline: true,
      activeWritesCount: 1,
      queuedCount: 0,
      hasSnapshotPendingWrites: false,
      lastError: null,
    }),
    'syncing'
  );
  assert.equal(
    deriveSyncStatus({
      isOnline: true,
      activeWritesCount: 0,
      queuedCount: 0,
      hasSnapshotPendingWrites: false,
      lastError: null,
    }),
    'synced'
  );
});

test('enqueuePendingMutation deduplicates repeated set/delete mutations on the same document', () => {
  const q1 = enqueuePendingMutation([], {
    opId: 'm1',
    colName: 'subjects',
    docId: 'subj_1',
    type: 'set',
    data: { id: 'subj_1', nama: 'Matematika' },
    label: 'Simpan mapel Matematika',
    createdAt: 1000,
  });
  const q2 = enqueuePendingMutation(q1, {
    opId: 'm2',
    colName: 'subjects',
    docId: 'subj_1',
    type: 'set',
    data: { id: 'subj_1', nama: 'Matematika Lanjut' },
    label: 'Perbarui mapel Matematika Lanjut',
    createdAt: 2000,
  });
  assert.equal(q2.length, 1);
  assert.equal((q2[0].data as { nama: string }).nama, 'Matematika Lanjut');

  const q3 = enqueuePendingMutation(q2, {
    opId: 'm3',
    colName: 'subjects',
    docId: 'subj_1',
    type: 'delete',
    label: 'Hapus mapel',
    createdAt: 3000,
  });
  assert.equal(q3.length, 1);
  assert.equal(q3[0].type, 'delete');
});

test('getTeacherSubjects merges primary mataPelajaran and mataPelajaranList without duplicates', () => {
  const teacher: TeacherAccount = {
    id: 't1',
    nama: 'Ustadz Ahmad',
    mataPelajaran: 'Fikih',
    mataPelajaranList: ['Fikih', 'Akidah Akhlak', 'Fikih'],
    usernameHash: 'u',
    usernameMasked: '••••••••',
    passwordHash: 'p',
    aktif: true,
    createdAt: '2026-01-01T00:00:00Z',
  };
  assert.deepEqual(getTeacherSubjects(teacher), ['Fikih', 'Akidah Akhlak']);
});

test('cascadeSubjectRename and cascadeClassRename update all dependent entities consistently', () => {
  const teachers: TeacherAccount[] = [
    {
      id: 't1',
      nama: 'Guru 1',
      mataPelajaran: 'IPA',
      mataPelajaranList: ['IPA', 'Matematika'],
      usernameHash: 'u',
      usernameMasked: '••••••••',
      passwordHash: 'p',
      aktif: true,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];
  const questions: Question[] = [
    {
      id: 'q1',
      mataPelajaran: 'IPA',
      tipe: 'PG',
      pertanyaanHtml: '<p>Test</p>',
      opsi: ['A', 'B', 'C', 'D'],
      kunciJawaban: ['A'],
      bobot: 25,
      createdBy: 'Guru 1',
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];
  const exams: ExamSchedule[] = [
    {
      id: 'e1',
      judulUjian: 'UTS',
      mataPelajaran: 'IPA',
      kelasTarget: ['VII A', 'VIII A'],
      durasiMenit: 45,
      token: 'ABC123',
      aktif: true,
      acakSoal: false,
      questionsSnapshot: questions,
      createdBy: 'Guru 1',
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];
  const results: ExamResult[] = [
    {
      id: 'r1',
      examId: 'e1',
      judulUjian: 'UTS',
      mataPelajaran: 'IPA',
      namaSiswa: 'Siti',
      kelas: 'VII A',
      waktuSubmit: '2026-01-01T01:00:00Z',
      skorPG: 100,
      skorEsai: 0,
      nilaiAkhir: 100,
      status: 'Selesai',
      pelanggaranTab: 0,
      peringatanWajah: 0,
      jawabanDetail: [],
    },
  ];

  const subjCascade = cascadeSubjectRename({
    oldName: 'IPA',
    newName: 'IPA Terpadu',
    teachers,
    questions,
    exams,
    results,
  });
  assert.equal(subjCascade.affectedTeachers[0].mataPelajaran, 'IPA Terpadu');
  assert.deepEqual(subjCascade.affectedTeachers[0].mataPelajaranList, ['IPA Terpadu', 'Matematika']);
  assert.equal(subjCascade.affectedQuestions[0].mataPelajaran, 'IPA Terpadu');
  assert.equal(subjCascade.affectedExams[0].mataPelajaran, 'IPA Terpadu');
  assert.equal(subjCascade.affectedResults[0].mataPelajaran, 'IPA Terpadu');

  const clsCascade = cascadeClassRename({
    oldName: 'VII A',
    newName: 'VII Unggulan',
    exams: subjCascade.exams,
    results: subjCascade.results,
  });
  assert.deepEqual(clsCascade.affectedExams[0].kelasTarget, ['VII Unggulan', 'VIII A']);
  assert.equal(clsCascade.affectedResults[0].kelas, 'VII Unggulan');
});

test('inferSyncMetadataFromLabel maps collections and labels cleanly', () => {
  assert.deepEqual(inferSyncMetadataFromLabel('Mapel "Fikih" ditambahkan', 'subjects'), {
    entity: 'Mapel',
    action: 'Tambah',
  });
  assert.deepEqual(inferSyncMetadataFromLabel('Jadwal "UTS" diperbarui', 'exams'), {
    entity: 'Jadwal',
    action: 'Ubah',
  });
  assert.deepEqual(inferSyncMetadataFromLabel('1 butir soal dihapus dari Bank Soal', 'questions'), {
    entity: 'Soal',
    action: 'Hapus',
  });
  assert.deepEqual(inferSyncMetadataFromLabel('Sinkronisasi manual terverifikasi', 'settings'), {
    entity: 'Sistem',
    action: 'Paksa',
  });
});

test('mergeAndSortSyncLogs deduplicates by id, promotes resolved status, and sorts newest first', () => {
  const localPending: SyncLogEntry = createSyncLogEntry({
    id: 'log_1',
    timestampMs: 1000,
    status: 'Menunggu',
    entity: 'Mapel',
    action: 'Tambah',
    actorRole: 'admin',
    actorName: 'Administrator',
    summary: 'Mapel Fisika ditambahkan',
    details: 'Koleksi subjects · doc subj_9',
    collection: 'subjects',
    deviceId: 'PWA-1234',
  });
  const cloudResolved: SyncLogEntry = {
    ...localPending,
    status: 'Berhasil',
  };
  const newerFailed: SyncLogEntry = createSyncLogEntry({
    id: 'log_2',
    timestampMs: 2000,
    status: 'Gagal',
    entity: 'Jadwal',
    action: 'Ubah',
    actorRole: 'guru',
    actorName: 'Ustadz Ahmad',
    summary: 'Token UTS diubah',
    details: 'Koleksi exams · doc ex_1',
    collection: 'exams',
    deviceId: 'WEB-5678',
    errorMessage: 'Network timeout',
  });

  const merged = mergeAndSortSyncLogs([localPending], [cloudResolved, newerFailed], 50);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'log_2');
  assert.equal(merged[1].id, 'log_1');
  assert.equal(merged[1].status, 'Berhasil');
});

test('filterSyncLogs and buildSyncLogsCsv filter by status/entity/search and escape CSV fields', () => {
  const logs: SyncLogEntry[] = [
    createSyncLogEntry({
      id: 'l1',
      timestampMs: 1000,
      status: 'Berhasil',
      entity: 'Mapel',
      action: 'Tambah',
      actorRole: 'admin',
      actorName: 'Rizqi, S.Kom',
      summary: 'Mapel Matematika ditambahkan',
      details: 'ID subj_1',
      collection: 'subjects',
      deviceId: 'WEB-01',
    }),
    createSyncLogEntry({
      id: 'l2',
      timestampMs: 2000,
      status: 'Gagal',
      entity: 'Soal',
      action: 'Hapus',
      actorRole: 'guru',
      actorName: 'Ahmad',
      summary: 'Hapus soal esai',
      details: 'ID q_9',
      collection: 'questions',
      deviceId: 'PWA-02',
      errorMessage: 'Offline',
    }),
  ];

  assert.equal(filterSyncLogs(logs, { status: 'Berhasil' }).length, 1);
  assert.equal(filterSyncLogs(logs, { entity: 'Soal' }).length, 1);
  assert.equal(filterSyncLogs(logs, { search: 'pwa-02' }).length, 1);

  const csv = buildSyncLogsCsv(logs);
  assert.ok(csv.startsWith('Waktu,Status,Kategori,Aksi,Peran,Aktor,Perangkat,Koleksi,Ringkasan,Detail Perubahan,Catatan Error'));
  assert.ok(csv.includes('"Rizqi, S.Kom"'));
  assert.ok(csv.includes('Offline'));
});

