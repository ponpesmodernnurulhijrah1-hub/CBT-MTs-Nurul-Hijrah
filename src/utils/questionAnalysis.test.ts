import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExamResult, Question } from '../types/cbt';
import {
  analyzeQuestionBankAndResults,
  detectCognitiveLevel,
  localVerifyAndFixDrafts,
} from './questionAnalysis';
import type { ParsedQuestionDraft } from './questionParser';

test('detectCognitiveLevel classifies LOTS, MOTS, and HOTS questions in Indonesian', () => {
  assert.equal(detectCognitiveLevel('<p>Sebutkan rukun iman yang keempat!</p>', 'PG'), 'LOTS (C1-C2)');
  assert.equal(detectCognitiveLevel('<p>Hitunglah keliling lingkaran berjari-jari 7 cm!</p>', 'PG'), 'MOTS (C3)');
  assert.equal(
    detectCognitiveLevel(
      '<p>Perhatikan tabel berikut, lalu analisis mengapa populasi menurun!</p><table><tr><td>2024</td></tr></table>',
      'PG'
    ),
    'HOTS (C4-C6)'
  );
});

test('analyzeQuestionBankAndResults computes Classical Test Theory difficulty (P), discrimination (D), and structural diagnostics', () => {
  const questions: Question[] = [
    {
      id: 'q1',
      mataPelajaran: 'Matematika',
      tipe: 'PG',
      pertanyaanHtml: '<p>Analisislah hasil penjualan pada tabel berikut untuk menentukan selisih tertinggi dan terendah.</p>',
      opsi: ['10', '20', '30', '40'],
      kunciJawaban: ['B'],
      bobot: 10,
      createdBy: 'Guru A',
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'q2',
      mataPelajaran: 'Matematika',
      tipe: 'PG',
      pertanyaanHtml: '<p>Apa itu?</p>',
      opsi: ['A. Satu', 'Satu'],
      kunciJawaban: ['E'], // Out of bounds & duplicate options & short stem
      bobot: 10,
      createdBy: 'Guru A',
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  const makeResult = (id: string, score: number, q1Ans: string, q1Ok: boolean): ExamResult => ({
    id,
    examId: 'ex1',
    namaSiswa: `Siswa ${id}`,
    kelas: 'VIII A',
    mataPelajaran: 'Matematika',
    judulUjian: 'PTS',
    skorPG: score,
    skorEsai: 0,
    nilaiAkhir: score,
    jawabanDetail: [
      { questionId: 'q1', tipe: 'PG', jawaban: [q1Ans], benar: q1Ok },
      { questionId: 'q2', tipe: 'PG', jawaban: ['A'], benar: false },
    ],
    waktuSubmit: '2026-01-02T00:00:00Z',
    status: 'Selesai',
    pelanggaranTab: 0,
  });

  const results: ExamResult[] = [
    makeResult('s1', 95, 'B', true),
    makeResult('s2', 90, 'B', true),
    makeResult('s3', 45, 'C', false),
    makeResult('s4', 30, 'C', false),
  ];

  const summary = analyzeQuestionBankAndResults(questions, results);
  assert.equal(summary.totalQuestions, 2);
  assert.equal(summary.analyzedWithResultsCount, 2);

  const item1 = summary.items[0];
  assert.equal(item1.tingkatKesukaranP, 0.5);
  assert.equal(item1.kategoriKesukaran, 'Sedang');
  assert.equal(item1.dayaPembedaD, 1);
  assert.equal(item1.kategoriDayaPembeda, 'Sangat Baik');
  assert.equal(item1.validitasKunci, 'Valid');
  assert.equal(item1.kualitas, 'Baik');
  assert.ok(item1.pengecohTidakBerfungsi.includes('A'));
  assert.ok(item1.pengecohTidakBerfungsi.includes('D'));

  const item2 = summary.items[1];
  assert.equal(item2.validitasKunci, 'Perlu Cek');
  assert.equal(item2.kualitas, 'Kritis');
  assert.ok(item2.temuanLokal.length >= 3);
});

test('localVerifyAndFixDrafts strips prefixes, repairs invalid keys, and adds local diagnostics cleanly', () => {
  const drafts: ParsedQuestionDraft[] = [
    {
      tipe: 'PG',
      pertanyaanHtml: '<p>Mengapa air laut terasa asin?</p><p>   </p>',
      opsi: ['A. Mengandung garam mineral', 'B. Terkena cahaya matahari', 'C. Mengalir dari sungai', 'D. Penguapan awan'],
      kunciJawaban: ['E'], // invalid for 4 options -> repaired to A
      bobot: 10,
    },
  ];

  const res = localVerifyAndFixDrafts(drafts);
  assert.equal(res.fixedCount, 1);
  assert.deepEqual(res.drafts[0].opsi, [
    'Mengandung garam mineral',
    'Terkena cahaya matahari',
    'Mengalir dari sungai',
    'Penguapan awan',
  ]);
  assert.deepEqual(res.drafts[0].kunciJawaban, ['A']);
  assert.equal(res.drafts[0].kesulitan, 'Sulit');
  assert.ok(res.drafts[0].pembahasan?.includes('Analisis Lokal'));
});
