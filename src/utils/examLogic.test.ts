import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_EXIT_GRACE_SECONDS,
  MAX_APP_EXIT_CHANCES,
  buildExamResultPayload,
  calculateExamScores,
  clearBankQuestionsForSubject,
  computeClassAverages,
  computeExitGraceSecondsLeft,
  computeScoreDistribution,
  createExamWithSnapshot,
  evaluateAppExitStrike,
  findDuplicateActiveToken,
  recalculateResultWithEssayScore,
  shouldDebounceAppExit,
} from './examLogic';
import { hashCredential } from './crypto';
import type { Question } from '../types/cbt';

const sampleQuestions: Question[] = [
  {
    id: 'q1',
    mataPelajaran: 'Matematika',
    tipe: 'PG',
    pertanyaanHtml: '<p>2 + 3 = ...</p>',
    opsi: ['4', '5', '6', '7'],
    kunciJawaban: ['B'],
    bobot: 25,
    createdBy: 'Guru A',
    createdAt: '2026-11-17T00:00:00Z',
  },
  {
    id: 'q2',
    mataPelajaran: 'Matematika',
    tipe: 'PG_KOMPLEKS',
    pertanyaanHtml: '<p>Pilih bilangan prima:</p>',
    opsi: ['2', '4', '5', '9'],
    kunciJawaban: ['A', 'C'],
    bobot: 25,
    createdBy: 'Guru A',
    createdAt: '2026-11-17T00:00:00Z',
  },
  {
    id: 'q3',
    mataPelajaran: 'Matematika',
    tipe: 'BENAR_SALAH',
    pertanyaanHtml: '<p>10 lebih besar dari 5.</p>',
    opsi: ['Benar', 'Salah'],
    kunciJawaban: ['Benar'],
    bobot: 25,
    createdBy: 'Guru A',
    createdAt: '2026-11-17T00:00:00Z',
  },
  {
    id: 'q4',
    mataPelajaran: 'Matematika',
    tipe: 'ESAI',
    pertanyaanHtml: '<p>Jelaskan teorema Pythagoras.</p>',
    opsi: [],
    kunciJawaban: ['a^2 + b^2 = c^2'],
    bobot: 25,
    createdBy: 'Guru A',
    createdAt: '2026-11-17T00:00:00Z',
  },
];

test('calculateExamScores evaluates PG, PG_KOMPLEKS, BENAR_SALAH, and manual ESAI accurately', () => {
  const answers = {
    q1: ['B'],
    q2: ['C', 'A'],
    q3: ['Benar'],
    q4: ['Kuadrat sisi miring sama dengan jumlah kuadrat sisi siku-siku'],
  };
  const noEssay = calculateExamScores(sampleQuestions, answers);
  assert.equal(noEssay.skorPG, 100);
  assert.equal(noEssay.skorEsai, 0);
  assert.equal(noEssay.nilaiAkhir, 75);

  const withEssay = calculateExamScores(sampleQuestions, answers, {}, { q4: 25 });
  assert.equal(withEssay.skorPG, 100);
  assert.equal(withEssay.skorEsai, 100);
  assert.equal(withEssay.nilaiAkhir, 100);
});

test('buildExamResultPayload produces identical schema for Selesai and Pelanggaran', () => {
  const exam = createExamWithSnapshot({
    judulUjian: 'PAS Matematika',
    mataPelajaran: 'Matematika',
    kelasTarget: ['VII A'],
    durasiMenit: 60,
    aktif: true,
    acakSoal: false,
    selectedQuestions: sampleQuestions.slice(0, 3),
    createdBy: 'Guru A',
  });

  const normalPayload = buildExamResultPayload({
    exam,
    namaSiswa: 'Ahmad Fauzi',
    kelas: 'VII A',
    answersMap: { q1: ['B'], q2: ['A', 'C'], q3: ['Benar'] },
    status: 'Selesai',
    pelanggaranTab: 0,
  });

  const violationPayload = buildExamResultPayload({
    exam,
    namaSiswa: 'Budi Santoso',
    kelas: 'VII A',
    answersMap: { q1: ['B'] },
    status: 'Pelanggaran',
    pelanggaranTab: 4,
  });

  assert.deepEqual(Object.keys(normalPayload).sort(), Object.keys(violationPayload).sort());
  assert.equal(normalPayload.status, 'Selesai');
  assert.equal(normalPayload.nilaiAkhir, 100);
  assert.equal(normalPayload.peringatanWajah, 0);
  assert.equal(violationPayload.status, 'Pelanggaran');
  assert.equal(violationPayload.pelanggaranTab, 4);
});

test('evaluateAppExitStrike allows 3 chances and triggers immediate submit on 4th (>3x)', () => {
  assert.equal(MAX_APP_EXIT_CHANCES, 3);

  const s1 = evaluateAppExitStrike(0, 'Membuka Aplikasi Lain');
  assert.equal(s1.nextCount, 1);
  assert.equal(s1.exceededLimit, false);
  assert.equal(s1.remainingChances, 2);

  const s2 = evaluateAppExitStrike(1, 'Pindah Tab');
  assert.equal(s2.nextCount, 2);
  assert.equal(s2.exceededLimit, false);
  assert.equal(s2.remainingChances, 1);

  const s3 = evaluateAppExitStrike(2, 'Keluar Aplikasi');
  assert.equal(s3.nextCount, 3);
  assert.equal(s3.exceededLimit, false);
  assert.equal(s3.remainingChances, 0);

  const s4 = evaluateAppExitStrike(3, 'Membuka Aplikasi Lain');
  assert.equal(s4.nextCount, 4);
  assert.equal(s4.exceededLimit, true);
  assert.ok(s4.autoSubmitReason?.includes('Melebihi batas 3x'));
});

test('computeExitGraceSecondsLeft counts down 30 seconds accurately using wall-clock timestamps', () => {
  assert.equal(APP_EXIT_GRACE_SECONDS, 30);
  const t0 = 1_700_000_000_000;
  assert.equal(computeExitGraceSecondsLeft(t0, t0), 30);
  assert.equal(computeExitGraceSecondsLeft(t0, t0 + 10_500), 20);
  assert.equal(computeExitGraceSecondsLeft(t0, t0 + 29_900), 1);
  assert.equal(computeExitGraceSecondsLeft(t0, t0 + 30_000), 0);
  assert.equal(computeExitGraceSecondsLeft(t0, t0 + 45_000), 0);
});

test('shouldDebounceAppExit prevents blur + visibilitychange double counting', () => {
  const t0 = 1_700_000_000_000;
  assert.equal(shouldDebounceAppExit(0, t0), false);
  assert.equal(shouldDebounceAppExit(t0, t0 + 100), true);
  assert.equal(shouldDebounceAppExit(t0, t0 + 1199), true);
  assert.equal(shouldDebounceAppExit(t0, t0 + 1200), false);
});

test('clearBankQuestionsForSubject clears bank soal without affecting scheduled exam snapshots', () => {
  const exam = createExamWithSnapshot({
    judulUjian: 'UTS Matematika',
    mataPelajaran: 'Matematika',
    kelasTarget: ['VII A'],
    durasiMenit: 45,
    aktif: true,
    acakSoal: false,
    selectedQuestions: sampleQuestions,
    createdBy: 'Guru A',
  });

  const otherSubjectQ: Question = {
    ...sampleQuestions[0],
    id: 'q_ipa',
    mataPelajaran: 'IPA',
  };

  const remaining = clearBankQuestionsForSubject([...sampleQuestions, otherSubjectQ], 'Matematika');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'q_ipa');
  // Snapshot inside scheduled exam must remain 100% intact!
  assert.equal(exam.questionsSnapshot.length, 4);
  assert.equal(exam.questionsSnapshot[0].pertanyaanHtml, '<p>2 + 3 = ...</p>');
});

test('computeScoreDistribution and computeClassAverages bucket results properly', () => {
  const exam = createExamWithSnapshot({
    judulUjian: 'UH 1',
    mataPelajaran: 'Matematika',
    kelasTarget: ['VII A'],
    durasiMenit: 30,
    aktif: true,
    acakSoal: false,
    selectedQuestions: sampleQuestions.slice(0, 1),
    createdBy: 'Guru A',
  });

  const r1 = buildExamResultPayload({
    exam,
    namaSiswa: 'Siti',
    kelas: 'VII A',
    answersMap: { q1: ['B'] },
    status: 'Selesai',
    pelanggaranTab: 0,
  });
  const r2 = buildExamResultPayload({
    exam,
    namaSiswa: 'Zaki',
    kelas: 'VII A',
    answersMap: { q1: ['A'] },
    status: 'Pelanggaran',
    pelanggaranTab: 4,
  });

  const dist = computeScoreDistribution([r1, r2]);
  assert.equal(dist[0].jumlah, 1); // 0 - 49
  assert.equal(dist[3].jumlah, 1); // 85 - 100

  const avgs = computeClassAverages([r1, r2]);
  assert.equal(avgs.length, 1);
  assert.equal(avgs[0].rataRata, 50);
  assert.equal(avgs[0].selesaiNormal, 1);
  assert.equal(avgs[0].pelanggaran, 1);
});

test('hashCredential produces deterministic SHA-256 hex digest', async () => {
  const h1 = await hashCredential('nurulhijrah2026');
  const h2 = await hashCredential('  nurulhijrah2026  ');
  assert.equal(h1.length, 64);
  assert.equal(h1, h2);
  assert.notEqual(h1, 'nurulhijrah2026');
});

test('recalculateResultWithEssayScore uses question weights, protects PG-only exams, and guards NaN', () => {
  const weightedQuestions: Question[] = [
    { ...sampleQuestions[0], id: 'w1', tipe: 'PG', bobot: 10 },
    { ...sampleQuestions[0], id: 'w2', tipe: 'PG', bobot: 10 },
    { ...sampleQuestions[3], id: 'w3', tipe: 'ESAI', bobot: 80 },
  ];
  const exam = createExamWithSnapshot({
    judulUjian: 'Ujian Bobot Esai Besar',
    mataPelajaran: 'Matematika',
    kelasTarget: ['VII A'],
    durasiMenit: 60,
    aktif: true,
    acakSoal: false,
    selectedQuestions: weightedQuestions,
    createdBy: 'Guru A',
  });
  const res = buildExamResultPayload({
    exam,
    namaSiswa: 'Nadia',
    kelas: 'VII A',
    answersMap: { w1: ['B'], w2: ['B'], w3: ['Pembuktian lengkap'] },
    status: 'Selesai',
    pelanggaranTab: 0,
  });

  // skorPG = 100 (weight 20), essay = 50 (weight 80) -> (100*20 + 50*80)/100 = 60
  const graded = recalculateResultWithEssayScore(res, exam.questionsSnapshot, 50);
  assert.equal(graded.skorEsai, 50);
  assert.equal(graded.nilaiAkhir, 60);

  // NaN input safely clamps to 0 without producing NaN nilaiAkhir
  const nanGraded = recalculateResultWithEssayScore(res, exam.questionsSnapshot, Number.NaN);
  assert.equal(nanGraded.skorEsai, 0);
  assert.equal(nanGraded.nilaiAkhir, 20);

  // PG-only exam never overwrites skorPG with arbitrary essay input
  const pgOnlyExam = createExamWithSnapshot({
    judulUjian: 'PG Saja',
    mataPelajaran: 'Matematika',
    kelasTarget: ['VII A'],
    durasiMenit: 30,
    aktif: true,
    acakSoal: false,
    selectedQuestions: sampleQuestions.slice(0, 2),
    createdBy: 'Guru A',
  });
  const pgOnlyRes = buildExamResultPayload({
    exam: pgOnlyExam,
    namaSiswa: 'Rafi',
    kelas: 'VII A',
    answersMap: { q1: ['B'], q2: ['A', 'C'] },
    status: 'Selesai',
    pelanggaranTab: 0,
  });
  const safePgOnly = recalculateResultWithEssayScore(pgOnlyRes, pgOnlyExam.questionsSnapshot, 40);
  assert.equal(safePgOnly.skorEsai, 0);
  assert.equal(safePgOnly.nilaiAkhir, 100);
});

test('findDuplicateActiveToken detects active token collisions case-insensitively while ignoring self or inactive schedules', () => {
  const activeExam = createExamWithSnapshot({
    id: 'ex_1',
    judulUjian: 'Matematika VII',
    mataPelajaran: 'Matematika',
    kelasTarget: ['VII A'],
    durasiMenit: 45,
    token: 'MTK123',
    aktif: true,
    acakSoal: false,
    selectedQuestions: sampleQuestions.slice(0, 1),
    createdBy: 'Guru A',
  });
  const inactiveExam = createExamWithSnapshot({
    id: 'ex_2',
    judulUjian: 'IPA VII',
    mataPelajaran: 'IPA',
    kelasTarget: ['VII A'],
    durasiMenit: 45,
    token: 'OFF999',
    aktif: false,
    acakSoal: false,
    selectedQuestions: sampleQuestions.slice(0, 1),
    createdBy: 'Guru B',
  });

  const list = [activeExam, inactiveExam];
  assert.equal(findDuplicateActiveToken(list, 'mtk123')?.id, 'ex_1');
  assert.equal(findDuplicateActiveToken(list, 'MTK123', 'ex_1'), undefined);
  assert.equal(findDuplicateActiveToken(list, 'OFF999'), undefined);
});

test('buildExamResultPayload preserves noPeserta and peringatanWajah accurately', () => {
  const exam = createExamWithSnapshot({
    judulUjian: 'Ujian Bahasa Arab',
    mataPelajaran: 'Bahasa Arab',
    kelasTarget: ['VII A'],
    durasiMenit: 45,
    aktif: true,
    acakSoal: false,
    selectedQuestions: sampleQuestions.slice(0, 1),
    createdBy: 'Guru Arab',
  });
  const res = buildExamResultPayload({
    exam,
    namaSiswa: 'Zaidan',
    noPeserta: '01-0042',
    kelas: 'VII A',
    answersMap: { q1: ['B'] },
    status: 'Selesai',
    pelanggaranTab: 0,
    peringatanWajah: 2,
  });
  assert.equal(res.noPeserta, '01-0042');
  assert.equal(res.peringatanWajah, 2);
});

