import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VIOLATION_HISTORY_ARCHIVE_KEY,
  archiveStudentViolationsForResult,
  buildStudentSessionViolationKey,
  clearStudentSessionViolations,
  getViolationHistoryForResult,
  loadStudentSessionViolations,
  markLastViolationReturned,
  recordStudentViolation,
} from './violationTracker';

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    dump: () => store,
  };
}

test('recordStudentViolation & markLastViolationReturned persist timestamps, reasons, and away duration per student', () => {
  const storage = createMemoryStorage();

  const list1 = recordStudentViolation(
    {
      examId: 'exam_1',
      namaSiswa: 'Ahmad Fauzi',
      kelas: 'VII A',
      strikeNumber: 1,
      reason: 'Membuka Aplikasi Lain / Keluar Layar Ujian',
      timestamp: '2026-11-19T08:00:00.000Z',
    },
    storage
  );
  assert.equal(list1.length, 1);
  assert.equal(list1[0].strikeNumber, 1);
  assert.equal(list1[0].reason, 'Membuka Aplikasi Lain / Keluar Layar Ujian');

  const afterReturn = markLastViolationReturned(
    {
      examId: 'exam_1',
      namaSiswa: 'Ahmad Fauzi',
      kelas: 'VII A',
      returnedAt: '2026-11-19T08:00:07.000Z',
    },
    storage
  );
  assert.equal(afterReturn[0].durationAwaySeconds, 7);
  assert.equal(afterReturn[0].returnedAt, '2026-11-19T08:00:07.000Z');

  // Verify another student on same device has isolated session history
  recordStudentViolation(
    {
      examId: 'exam_1',
      namaSiswa: 'Siti Aminah',
      kelas: 'VII A',
      strikeNumber: 1,
      reason: 'Pindah Tab / Membuka Aplikasi Lain',
      timestamp: '2026-11-19T08:05:00.000Z',
    },
    storage
  );

  assert.equal(
    loadStudentSessionViolations('exam_1', 'Ahmad Fauzi', 'VII A', storage).length,
    1
  );
  assert.equal(
    loadStudentSessionViolations('exam_1', 'Siti Aminah', 'VII A', storage).length,
    1
  );
});

test('archiveStudentViolationsForResult moves active log into teacher archive and clears active session key', () => {
  const storage = createMemoryStorage();
  recordStudentViolation(
    {
      examId: 'exam_2',
      namaSiswa: 'Budi',
      kelas: 'VIII B',
      strikeNumber: 1,
      reason: 'Keluar dari Mode Layar Penuh',
      timestamp: '2026-11-19T09:00:00.000Z',
    },
    storage
  );

  const archived = archiveStudentViolationsForResult(
    {
      resultId: 'res_budi_1',
      examId: 'exam_2',
      namaSiswa: 'Budi',
      kelas: 'VIII B',
    },
    storage
  );
  assert.equal(archived.length, 1);

  const sessionKey = buildStudentSessionViolationKey('exam_2', 'Budi', 'VIII B');
  assert.equal(storage.getItem(sessionKey), null);
  assert.ok(storage.getItem(VIOLATION_HISTORY_ARCHIVE_KEY));

  // Teacher lookup falls back to localStorage archive even if result.violationHistory is omitted
  const recovered = getViolationHistoryForResult(
    {
      id: 'res_budi_1',
      examId: 'exam_2',
      namaSiswa: 'Budi',
      kelas: 'VIII B',
    },
    storage
  );
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].reason, 'Keluar dari Mode Layar Penuh');

  clearStudentSessionViolations('exam_2', 'Budi', 'VIII B', storage);
});
