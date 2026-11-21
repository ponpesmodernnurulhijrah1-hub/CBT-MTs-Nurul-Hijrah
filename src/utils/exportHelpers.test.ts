import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExamResultsCsv, buildStudentExamReceiptHtml } from './exportHelpers';
import type { ExamResult, ExamSchedule } from '../types/cbt';

const sampleResult: ExamResult = {
  id: 'res_test_1',
  examId: 'ex_test_1',
  judulUjian: 'Penilaian Akhir Semester',
  mataPelajaran: 'Matematika',
  namaSiswa: 'Fatimah Az-Zahra',
  noPeserta: '07-0018',
  kelas: 'VII A',
  waktuSubmit: '2026-11-20T09:30:00.000Z',
  skorPG: 90,
  skorEsai: 85,
  nilaiAkhir: 88,
  status: 'Selesai',
  pelanggaranTab: 0,
  peringatanWajah: 1,
  alasanSubmit: 'Dikirim manual oleh siswa',
  jawabanDetail: [
    {
      questionId: 'q_1',
      tipe: 'PG',
      jawaban: ['B'],
      benar: true,
    },
  ],
};

const sampleExam: ExamSchedule = {
  id: 'ex_test_1',
  judulUjian: 'Penilaian Akhir Semester',
  mataPelajaran: 'Matematika',
  kelasTarget: ['VII A'],
  durasiMenit: 60,
  token: 'MTK999',
  aktif: true,
  acakSoal: false,
  createdBy: 'Guru MTK',
  createdAt: '2026-11-20T08:00:00.000Z',
  questionsSnapshot: [
    {
      id: 'q_1',
      mataPelajaran: 'Matematika',
      tipe: 'PG',
      pertanyaanHtml: '<p>Hasil dari 6 &times; 7 adalah...</p>',
      opsi: ['36', '42', '48', '49'],
      kunciJawaban: ['B'],
      bobot: 100,
      createdBy: 'Guru MTK',
      createdAt: '2026-11-20T08:00:00.000Z',
    },
  ],
};

test('buildExamResultsCsv includes No. Peserta, scores, and escapes commas safely', () => {
  const csv = buildExamResultsCsv([
    {
      ...sampleResult,
      namaSiswa: 'Ahmad, S.Pd Putra',
    },
  ]);
  const lines = csv.split('\r\n');
  assert.ok(lines[0].includes('No Peserta'));
  assert.ok(lines[0].includes('Peringatan Wajah'));
  assert.ok(lines[1].includes('07-0018'));
  assert.ok(lines[1].includes('"Ahmad, S.Pd Putra"'));
  assert.ok(lines[1].includes('Selesai (Normal)'));
});

test('buildStudentExamReceiptHtml renders official CBT receipt with student metadata and answers', () => {
  const html = buildStudentExamReceiptHtml(sampleResult, sampleExam);
  assert.ok(html.includes('BUKTI JAWABAN UJIAN - CBT MTs NURUL HIJRAH'));
  assert.ok(html.includes('Fatimah Az-Zahra'));
  assert.ok(html.includes('07-0018'));
  assert.ok(html.includes('Penilaian Akhir Semester'));
  assert.ok(html.includes('Hasil dari 6'));
});
