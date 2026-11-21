import type {
  ExamResult,
  ExamSchedule,
  ExamSubmissionStatus,
  Question,
  StudentAnswerDetail,
  ViolationLogEntry,
} from '../types/cbt';

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'];

export function getOptionLetter(index: number): string {
  return OPTION_LETTERS[index] || String(index + 1);
}

export function generateExamToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let token = '';
  for (let i = 0; i < 6; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

export interface ScoreCalculationResult {
  skorPG: number;
  skorEsai: number;
  nilaiAkhir: number;
  jawabanDetail: StudentAnswerDetail[];
  hasEssay: boolean;
}

/**
 * Menghitung skor soal objektif (PG, PG Kompleks, Benar/Salah) dan menggabungkan skor Esai.
 * Skala nilai akhir 0 - 100.
 */
export function calculateExamScores(
  questions: Question[],
  answersMap: Record<string, string[]>,
  doubtfulMap: Record<string, boolean> = {},
  manualEssayScores: Record<string, number> = {}
): ScoreCalculationResult {
  if (questions.length === 0) {
    return {
      skorPG: 0,
      skorEsai: 0,
      nilaiAkhir: 0,
      jawabanDetail: [],
      hasEssay: false,
    };
  }

  let totalObjWeight = 0;
  let earnedObjWeight = 0;
  let totalEssayWeight = 0;
  let earnedEssayWeight = 0;
  let hasEssay = false;

  const jawabanDetail: StudentAnswerDetail[] = questions.map((q) => {
    const rawAns = answersMap[q.id] || [];
    const raguRagu = Boolean(doubtfulMap[q.id]);
    const weight = q.bobot > 0 ? q.bobot : q.tipe === 'ESAI' ? 20 : 10;

    if (q.tipe === 'ESAI') {
      hasEssay = true;
      totalEssayWeight += weight;
      const essayScore = Math.max(0, Math.min(weight, manualEssayScores[q.id] ?? 0));
      earnedEssayWeight += essayScore;
      return {
        questionId: q.id,
        tipe: q.tipe,
        jawaban: rawAns,
        raguRagu,
        skorDiperoleh: essayScore,
      };
    }

    totalObjWeight += weight;
    const expected = q.kunciJawaban.map((k) => k.trim().toUpperCase()).sort();
    const given = rawAns.map((a) => a.trim().toUpperCase()).sort();

    let isCorrect = false;
    if (q.tipe === 'PG' || q.tipe === 'BENAR_SALAH') {
      isCorrect = expected.length > 0 && given.length === 1 && given[0] === expected[0];
    } else if (q.tipe === 'PG_KOMPLEKS') {
      isCorrect =
        expected.length > 0 &&
        expected.length === given.length &&
        expected.every((val, idx) => val === given[idx]);
    }

    const earned = isCorrect ? weight : 0;
    earnedObjWeight += earned;

    return {
      questionId: q.id,
      tipe: q.tipe,
      jawaban: rawAns,
      raguRagu,
      benar: isCorrect,
      skorDiperoleh: earned,
    };
  });

  const totalWeight = totalObjWeight + totalEssayWeight;
  const skorPG = totalObjWeight > 0 ? Math.round((earnedObjWeight / totalObjWeight) * 100) : 0;
  const skorEsai = totalEssayWeight > 0 ? Math.round((earnedEssayWeight / totalEssayWeight) * 100) : 0;
  const nilaiAkhir =
    totalWeight > 0
      ? Math.round(((earnedObjWeight + earnedEssayWeight) / totalWeight) * 100)
      : 0;

  return {
    skorPG,
    skorEsai,
    nilaiAkhir,
    jawabanDetail,
    hasEssay,
  };
}

/**
 * Menghitung ulang skorEsai dan nilaiAkhir setelah guru menginput nilai Esai (0-100),
 * menggunakan bobot asli soal dari snapshot jadwal bila tersedia dan menjaga input dari NaN.
 */
export function recalculateResultWithEssayScore(
  result: Pick<ExamResult, 'skorPG' | 'skorEsai' | 'nilaiAkhir' | 'jawabanDetail'>,
  examQuestions: Question[] | undefined,
  rawEssayPercent: number
): { skorEsai: number; nilaiAkhir: number } {
  const safeInput = Number.isFinite(rawEssayPercent) ? rawEssayPercent : 0;
  const boundedEssay = Math.max(0, Math.min(100, Math.round(safeInput)));
  const details = Array.isArray(result.jawabanDetail) ? result.jawabanDetail : [];
  const hasObj = details.some((d) => d.tipe !== 'ESAI');
  const hasEssay = details.some((d) => d.tipe === 'ESAI');

  if (!hasEssay) {
    return {
      skorEsai: 0,
      nilaiAkhir: hasObj ? result.skorPG : 0,
    };
  }

  if (!hasObj) {
    return {
      skorEsai: boundedEssay,
      nilaiAkhir: boundedEssay,
    };
  }

  const questionMap = new Map<string, Question>();
  if (Array.isArray(examQuestions)) {
    for (const q of examQuestions) {
      questionMap.set(q.id, q);
    }
  }

  let objWeight = 0;
  let essayWeight = 0;
  for (const d of details) {
    const q = questionMap.get(d.questionId);
    const w = q && q.bobot > 0 ? q.bobot : d.tipe === 'ESAI' ? 20 : 10;
    if (d.tipe === 'ESAI') essayWeight += w;
    else objWeight += w;
  }

  const totalWeight = objWeight + essayWeight;
  const nextFinal =
    totalWeight > 0
      ? Math.round((result.skorPG * objWeight + boundedEssay * essayWeight) / totalWeight)
      : result.skorPG;

  return {
    skorEsai: boundedEssay,
    nilaiAkhir: nextFinal,
  };
}

export const MAX_APP_EXIT_CHANCES = 3;
export const APP_EXIT_GRACE_SECONDS = 30;
export const APP_EXIT_DEBOUNCE_MS = 1200;

export interface AppExitEvaluation {
  nextCount: number;
  exceededLimit: boolean;
  remainingChances: number;
  autoSubmitReason?: string;
}

/**
 * Evaluasi pelanggaran keluar aplikasi / membuka aplikasi lain:
 * Maksimal 3x kesempatan (1/3, 2/3, 3/3). Pada pelanggaran ke-4 (>3x), langsung kirim jawaban.
 */
export function evaluateAppExitStrike(
  currentCount: number,
  sourceLabel: string
): AppExitEvaluation {
  const nextCount = currentCount + 1;
  const exceededLimit = nextCount > MAX_APP_EXIT_CHANCES;
  return {
    nextCount,
    exceededLimit,
    remainingChances: Math.max(0, MAX_APP_EXIT_CHANCES - nextCount),
    autoSubmitReason: exceededLimit
      ? `Melebihi batas ${MAX_APP_EXIT_CHANCES}x keluar/membuka aplikasi lain (${nextCount}x - ${sourceLabel})`
      : undefined,
  };
}

/**
 * Hitung sisa waktu kembali (detik) berbasis timestamp saat keluar aplikasi (tahan throttling browser).
 */
export function computeExitGraceSecondsLeft(
  exitStartedAtMs: number,
  nowMs: number = Date.now(),
  graceDurationSec: number = APP_EXIT_GRACE_SECONDS
): number {
  if (!Number.isFinite(exitStartedAtMs) || exitStartedAtMs <= 0) {
    return graceDurationSec;
  }
  const elapsedSec = Math.max(0, Math.floor((nowMs - exitStartedAtMs) / 1000));
  return Math.max(0, graceDurationSec - elapsedSec);
}

/**
 * Mencegah penghitungan ganda ketika browser menembakkan blur + visibilitychange secara bersamaan.
 */
export function shouldDebounceAppExit(
  lastTriggerMs: number,
  nowMs: number,
  debounceMs: number = APP_EXIT_DEBOUNCE_MS
): boolean {
  return lastTriggerMs > 0 && nowMs - lastTriggerMs < debounceMs;
}

export interface BuildExamResultParams {
  id?: string;
  exam: ExamSchedule;
  namaSiswa: string;
  noPeserta?: string;
  kelas: string;
  answersMap: Record<string, string[]>;
  doubtfulMap?: Record<string, boolean>;
  status: ExamSubmissionStatus;
  pelanggaranTab: number;
  peringatanWajah?: number;
  alasanSubmit?: string;
  waktuSubmit?: string;
  violationHistory?: ViolationLogEntry[];
}

/**
 * FUNGSI TUNGGAL terpadu untuk membangun objek ExamResult yang 100% identik
 * antara submit manual ("Selesai"), waktu habis ("Selesai"), maupun pelanggaran ("Pelanggaran").
 */
export function buildExamResultPayload(params: BuildExamResultParams): ExamResult {
  const {
    id,
    exam,
    namaSiswa,
    noPeserta,
    kelas,
    answersMap,
    doubtfulMap = {},
    status,
    pelanggaranTab,
    peringatanWajah = 0,
    alasanSubmit,
    waktuSubmit,
    violationHistory = [],
  } = params;

  const scores = calculateExamScores(exam.questionsSnapshot, answersMap, doubtfulMap);
  const cleanNoPeserta = noPeserta?.trim();

  return {
    id: id || `res_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    examId: exam.id,
    namaSiswa: namaSiswa.trim(),
    ...(cleanNoPeserta ? { noPeserta: cleanNoPeserta } : {}),
    kelas: kelas.trim(),
    mataPelajaran: exam.mataPelajaran,
    judulUjian: exam.judulUjian,
    skorPG: scores.skorPG,
    skorEsai: scores.skorEsai,
    nilaiAkhir: scores.nilaiAkhir,
    jawabanDetail: scores.jawabanDetail,
    waktuSubmit: waktuSubmit || new Date().toISOString(),
    status,
    pelanggaranTab,
    peringatanWajah,
    alasanSubmit:
      alasanSubmit ||
      (status === 'Pelanggaran'
        ? 'Melebihi batas toleransi keluar aplikasi (>3x)'
        : 'Selesai dikerjakan siswa'),
    violationHistory: violationHistory.map((v) => ({ ...v })),
  };
}

/**
 * Membuat objek ExamSchedule dengan deep snapshot salinan butir soal
 * sehingga menghapus Bank Soal tidak merusak jadwal ujian yang sudah dibuat.
 */
export function createExamWithSnapshot(params: {
  id?: string;
  judulUjian: string;
  mataPelajaran: string;
  kelasTarget: string[];
  durasiMenit: number;
  token?: string;
  aktif: boolean;
  acakSoal: boolean;
  selectedQuestions: Question[];
  createdBy: string;
  createdAt?: string;
}): ExamSchedule {
  const deepSnapshot: Question[] = params.selectedQuestions.map((q) => ({
    ...q,
    opsi: [...q.opsi],
    kunciJawaban: [...q.kunciJawaban],
  }));

  const now = new Date().toISOString();
  return {
    id: params.id || `exam_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    judulUjian: params.judulUjian.trim(),
    mataPelajaran: params.mataPelajaran,
    kelasTarget: params.kelasTarget.length > 0 ? [...params.kelasTarget] : ['Semua Kelas'],
    durasiMenit: Math.max(5, params.durasiMenit),
    token: (params.token || generateExamToken()).toUpperCase(),
    aktif: params.aktif,
    acakSoal: params.acakSoal,
    questionsSnapshot: deepSnapshot,
    createdBy: params.createdBy,
    createdAt: params.createdAt || now,
    updatedAt: now,
  };
}

export function findDuplicateActiveToken(
  exams: ExamSchedule[],
  token: string,
  excludeExamId?: string
): ExamSchedule | undefined {
  const clean = token.trim().toUpperCase();
  if (!clean) return undefined;
  return exams.find(
    (ex) => ex.aktif && ex.id !== excludeExamId && ex.token.trim().toUpperCase() === clean
  );
}

/**
 * Menghapus semua soal dari Bank Soal untuk mata pelajaran tertentu
 * TANPA menyentuh ExamSchedule.questionsSnapshot yang sudah tersimpan.
 */
export function clearBankQuestionsForSubject(
  allQuestions: Question[],
  mataPelajaran: string
): Question[] {
  return allQuestions.filter((q) => q.mataPelajaran !== mataPelajaran);
}

export function computeScoreDistribution(results: ExamResult[]) {
  const buckets = [
    { rentang: '0 - 49', label: 'Perlu Bimbingan', jumlah: 0 },
    { rentang: '50 - 69', label: 'Cukup', jumlah: 0 },
    { rentang: '70 - 84', label: 'Baik', jumlah: 0 },
    { rentang: '85 - 100', label: 'Sangat Baik', jumlah: 0 },
  ];

  for (const r of results) {
    const n = r.nilaiAkhir;
    if (n < 50) buckets[0].jumlah += 1;
    else if (n < 70) buckets[1].jumlah += 1;
    else if (n < 85) buckets[2].jumlah += 1;
    else buckets[3].jumlah += 1;
  }

  return buckets;
}

export function computeClassAverages(results: ExamResult[]) {
  const byClass: Record<string, { sum: number; count: number; normal: number; pelanggaran: number }> = {};

  for (const r of results) {
    const key = r.kelas || 'Tanpa Kelas';
    if (!byClass[key]) {
      byClass[key] = { sum: 0, count: 0, normal: 0, pelanggaran: 0 };
    }
    byClass[key].sum += r.nilaiAkhir;
    byClass[key].count += 1;
    if (r.status === 'Selesai') byClass[key].normal += 1;
    else byClass[key].pelanggaran += 1;
  }

  return Object.entries(byClass)
    .map(([kelas, stats]) => ({
      kelas,
      rataRata: Math.round((stats.sum / stats.count) * 10) / 10,
      jumlahPeserta: stats.count,
      selesaiNormal: stats.normal,
      pelanggaran: stats.pelanggaran,
    }))
    .sort((a, b) => a.kelas.localeCompare(b.kelas));
}
