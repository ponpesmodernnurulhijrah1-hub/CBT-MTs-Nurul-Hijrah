import type { ExamResult, Question, QuestionType } from '../types/cbt';
import { getOptionLetter } from './examLogic';
import type { ParsedQuestionDraft } from './questionParser';

export type CognitiveLevel = 'LOTS (C1-C2)' | 'MOTS (C3)' | 'HOTS (C4-C6)';
export type QualityVerdict = 'Baik' | 'Perlu Revisi' | 'Kritis';
export type KeyValidityStatus = 'Valid' | 'Meragukan' | 'Perlu Cek';

export interface OptionChoiceStat {
  label: string;
  text: string;
  count: number;
  percentage: number;
  isKey: boolean;
}

export interface LocalQuestionAnalysisItem {
  questionId: string;
  nomor: number;
  tipe: QuestionType;
  plainText: string;
  bobot: number;
  kunciJawaban: string[];
  totalResponden: number;
  correctCount: number;
  wrongCount: number;
  blankCount: number;
  correctPercent: number | null;
  tingkatKesukaranP: number | null;
  kategoriKesukaran: 'Mudah' | 'Sedang' | 'Sulit' | 'Belum Diujikan';
  dayaPembedaD: number | null;
  kategoriDayaPembeda: 'Sangat Baik' | 'Baik' | 'Cukup' | 'Perlu Revisi' | 'Butuh >= 4 Peserta';
  distribusiOpsi: OptionChoiceStat[];
  pengecohTidakBerfungsi: string[];
  levelKognitif: CognitiveLevel;
  skorKualitasStruktur: number;
  kualitas: QualityVerdict;
  validitasKunci: KeyValidityStatus;
  temuanLokal: string[];
  saranPerbaikanLokal: string;
}

export interface QuestionBankAnalysisSummary {
  totalQuestions: number;
  analyzedWithResultsCount: number;
  baikCount: number;
  revisiCount: number;
  kritisCount: number;
  hotsCount: number;
  motsCount: number;
  lotsCount: number;
  averageQualityScore: number;
  items: LocalQuestionAnalysisItem[];
}

export interface AiDeepQuestionReview {
  id: string;
  kualitas: QualityVerdict;
  levelKognitif: CognitiveLevel;
  validitasKunci: KeyValidityStatus;
  catatanAnalisis: string;
  saranPerbaikan: string;
}

export function stripHtmlToPlainText(html: string): string {
  return String(html || '')
    .replace(/<img[^>]*>/gi, ' [Gambar] ')
    .replace(/<table[\s\S]*?<\/table>/gi, ' [Tabel] ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

const HOTS_PATTERN =
  /\b(mengapa|analisis(?:lah)?|analisislah|bandingkan|evaluasi|simpulkan|kesimpulan|dampak|prediksi|berdasarkan (?:tabel|data|grafik|wacana|bacaan|ilustrasi|kasus)|manakah pernyataan yang (?:tepat|sesuai|benar)|rancang|buktikan|mengkritik|kelemahan|kelebihan)\b/i;

const MOTS_PATTERN =
  /\b(hitung(?:lah)?|tentukan|terapkan|ubah(?:lah)?|konversi|urutkan|klasifikasikan|kelompokkan|berdasarkan gambar|carilah|selesaikan|hubungan antara|penerapan)\b/i;

export function detectCognitiveLevel(pertanyaanHtml: string, tipe: QuestionType): CognitiveLevel {
  const plain = stripHtmlToPlainText(pertanyaanHtml);
  const hasStimulusTableOrLongPassage = /<table/i.test(pertanyaanHtml) || plain.length >= 220;

  if (HOTS_PATTERN.test(plain) || (hasStimulusTableOrLongPassage && tipe !== 'BENAR_SALAH')) {
    return 'HOTS (C4-C6)';
  }
  if (MOTS_PATTERN.test(plain) || /<img/i.test(pertanyaanHtml) || tipe === 'PG_KOMPLEKS') {
    return 'MOTS (C3)';
  }
  return 'LOTS (C1-C2)';
}

function classifyDifficulty(p: number | null): LocalQuestionAnalysisItem['kategoriKesukaran'] {
  if (p === null) return 'Belum Diujikan';
  if (p > 0.7) return 'Mudah';
  if (p >= 0.3) return 'Sedang';
  return 'Sulit';
}

function classifyDiscrimination(
  d: number | null
): LocalQuestionAnalysisItem['kategoriDayaPembeda'] {
  if (d === null) return 'Butuh >= 4 Peserta';
  if (d >= 0.4) return 'Sangat Baik';
  if (d >= 0.3) return 'Baik';
  if (d >= 0.2) return 'Cukup';
  return 'Perlu Revisi';
}

function evaluateStructuralQuality(q: Pick<Question, 'tipe' | 'pertanyaanHtml' | 'opsi' | 'kunciJawaban'>): {
  temuan: string[];
  score: number;
  validitasKunci: KeyValidityStatus;
  saran: string;
} {
  const temuan: string[] = [];
  let score = 100;
  let validitasKunci: KeyValidityStatus = 'Valid';

  const plain = stripHtmlToPlainText(q.pertanyaanHtml);
  const hasMedia = /<(?:img|table)/i.test(q.pertanyaanHtml);

  if (!plain && !hasMedia) {
    temuan.push('Teks pertanyaan kosong.');
    score -= 45;
  } else if (plain.length < 15 && !hasMedia) {
    temuan.push('Kalimat pertanyaan sangat singkat (< 15 karakter), berisiko kurang kontekstual.');
    score -= 15;
  }

  if (q.tipe === 'PG' || q.tipe === 'PG_KOMPLEKS') {
    if (q.opsi.length < 3) {
      temuan.push(`Jumlah opsi hanya ${q.opsi.length} (minimal 4 opsi disarankan untuk CBT MTs).`);
      score -= 25;
      validitasKunci = 'Perlu Cek';
    }

    const emptyOptIdx = q.opsi.findIndex((o) => !String(o || '').trim());
    if (emptyOptIdx !== -1) {
      temuan.push(`Opsi ${getOptionLetter(emptyOptIdx)} masih kosong.`);
      score -= 20;
      validitasKunci = 'Perlu Cek';
    }

    const normalizedOpts = q.opsi.map((o) => String(o || '').trim().toLowerCase()).filter(Boolean);
    if (new Set(normalizedOpts).size < normalizedOpts.length) {
      temuan.push('Terdapat teks opsi jawaban yang kembar/duplikat.');
      score -= 20;
    }

    const validLetters = q.opsi.map((_, idx) => getOptionLetter(idx));
    const keys = Array.isArray(q.kunciJawaban) ? q.kunciJawaban : [];
    if (keys.length === 0) {
      temuan.push('Kunci jawaban belum ditentukan.');
      score -= 35;
      validitasKunci = 'Perlu Cek';
    } else {
      const invalidKey = keys.find((k) => !validLetters.includes(k.toUpperCase()));
      if (invalidKey) {
        temuan.push(`Kunci "${invalidKey}" tidak cocok dengan jumlah opsi (${validLetters.join(', ')}).`);
        score -= 35;
        validitasKunci = 'Perlu Cek';
      }
      if (q.tipe === 'PG_KOMPLEKS' && keys.length < 2) {
        temuan.push('PG Kompleks sebaiknya memiliki minimal 2 kunci jawaban benar.');
        score -= 10;
        if (validitasKunci === 'Valid') validitasKunci = 'Meragukan';
      }
    }

    // Check distractor vs key length skew (> 2.2x longer key gives away answer)
    if (q.opsi.length >= 3 && keys.length > 0) {
      const keyLens: number[] = [];
      const distractorLens: number[] = [];
      q.opsi.forEach((optText, idx) => {
        const letter = getOptionLetter(idx);
        const len = String(optText || '').trim().length;
        if (keys.includes(letter)) keyLens.push(len);
        else distractorLens.push(len);
      });
      if (keyLens.length > 0 && distractorLens.length > 0) {
        const avgKey = keyLens.reduce((a, b) => a + b, 0) / keyLens.length;
        const avgDist = distractorLens.reduce((a, b) => a + b, 0) / distractorLens.length;
        if (avgDist >= 6 && avgKey > avgDist * 2.2) {
          temuan.push('Panjang kalimat kunci jawaban jauh lebih panjang (>2x) daripada pengecoh.');
          score -= 10;
        }
      }
    }

    if (q.opsi.some((o) => /^[A-E][\.\)\-:]\s+/i.test(String(o || '').trim()))) {
      temuan.push('Opsi masih mengandung awalan huruf ganda (misal "A. ").');
      score -= 8;
    }
  } else if (q.tipe === 'BENAR_SALAH') {
    const key = String(q.kunciJawaban?.[0] || '').trim();
    if (key !== 'Benar' && key !== 'Salah') {
      temuan.push('Kunci Benar/Salah harus bernilai "Benar" atau "Salah".');
      score -= 30;
      validitasKunci = 'Perlu Cek';
    }
  } else if (q.tipe === 'ESAI') {
    if (!q.kunciJawaban?.[0]?.trim()) {
      temuan.push('Pedoman rubrik/kunci esai belum diisi (disarankan agar koreksi AI & guru konsisten).');
      score -= 10;
    }
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const saran =
    temuan.length === 0
      ? 'Struktur butir soal sudah rapi, panjang opsi seimbang, dan kunci valid.'
      : temuan[0];

  return { temuan, score: clampedScore, validitasKunci, saran };
}

/**
 * Pure deterministic Classical Test Theory (CTT) & structural item analyzer.
 * Runs 100% locally in O(N*M), costs 0 API quota, and never throws network errors.
 */
export function analyzeQuestionBankAndResults(
  questions: Question[],
  results: ExamResult[]
): QuestionBankAnalysisSummary {
  const sortedByScoreDesc = [...results].sort((a, b) => b.nilaiAkhir - a.nilaiAkhir);

  const items: LocalQuestionAnalysisItem[] = questions.map((q, idx) => {
    const plainText = stripHtmlToPlainText(q.pertanyaanHtml);
    const levelKognitif = detectCognitiveLevel(q.pertanyaanHtml, q.tipe);
    const structure = evaluateStructuralQuality(q);

    // Gather all student responses targeting this questionId
    const respondentOutcomes: Array<{
      scoreRankIndex: number;
      jawaban: string[];
      isCorrect: boolean;
      isBlank: boolean;
    }> = [];

    sortedByScoreDesc.forEach((res, rankIdx) => {
      const detail = res.jawabanDetail.find((d) => d.questionId === q.id);
      if (!detail) return;
      const cleanAns = Array.isArray(detail.jawaban)
        ? detail.jawaban.map((v) => String(v || '').trim()).filter(Boolean)
        : [];
      const isBlank = cleanAns.length === 0;
      let isCorrect = Boolean(detail.benar);
      if (detail.benar === undefined && q.tipe !== 'ESAI') {
        const expected = [...q.kunciJawaban].map((k) => k.toUpperCase()).sort();
        const actual = [...cleanAns].map((k) => k.toUpperCase()).sort();
        isCorrect =
          expected.length > 0 &&
          expected.length === actual.length &&
          expected.every((val, kIdx) => val === actual[kIdx]);
      }
      respondentOutcomes.push({
        scoreRankIndex: rankIdx,
        jawaban: cleanAns,
        isCorrect,
        isBlank,
      });
    });

    const totalResponden = respondentOutcomes.length;
    const correctCount = respondentOutcomes.filter((o) => o.isCorrect).length;
    const blankCount = respondentOutcomes.filter((o) => o.isBlank).length;
    const wrongCount = totalResponden - correctCount;

    const tingkatKesukaranP =
      totalResponden > 0 ? Math.round((correctCount / totalResponden) * 100) / 100 : null;
    const correctPercent =
      totalResponden > 0 ? Math.round((correctCount / totalResponden) * 100) : null;

    // Kelley's 27% upper vs lower group discrimination index (D)
    let dayaPembedaD: number | null = null;
    if (totalResponden >= 4) {
      const groupSize = Math.max(1, Math.round(totalResponden * 0.27));
      const upper = respondentOutcomes.slice(0, groupSize);
      const lower = respondentOutcomes.slice(totalResponden - groupSize);
      const upperRate = upper.filter((u) => u.isCorrect).length / upper.length;
      const lowerRate = lower.filter((l) => l.isCorrect).length / lower.length;
      dayaPembedaD = Math.round((upperRate - lowerRate) * 100) / 100;
    }

    // Option choice distribution
    const optionKeys =
      q.tipe === 'BENAR_SALAH'
        ? ['Benar', 'Salah']
        : q.tipe === 'ESAI'
          ? []
          : q.opsi.map((_, oIdx) => getOptionLetter(oIdx));

    const distribusiOpsi: OptionChoiceStat[] = optionKeys.map((label, oIdx) => {
      const count = respondentOutcomes.filter((o) =>
        o.jawaban.some((ans) => ans.toUpperCase() === label.toUpperCase())
      ).length;
      const percentage = totalResponden > 0 ? Math.round((count / totalResponden) * 100) : 0;
      const isKey = q.kunciJawaban.some((k) => k.toUpperCase() === label.toUpperCase());
      return {
        label,
        text: q.tipe === 'BENAR_SALAH' ? label : q.opsi[oIdx] || '',
        count,
        percentage,
        isKey,
      };
    });

    const pengecohTidakBerfungsi =
      totalResponden >= 3
        ? distribusiOpsi.filter((opt) => !opt.isKey && opt.count === 0).map((opt) => opt.label)
        : [];

    const temuanLokal = [...structure.temuan];
    let adjustedScore = structure.score;
    let validitasKunci = structure.validitasKunci;

    if (dayaPembedaD !== null && dayaPembedaD < 0) {
      temuanLokal.push(
        `Daya pembeda negatif (D = ${dayaPembedaD}): siswa skor rendah lebih sering benar daripada siswa skor tinggi. Periksa ulang kunci jawaban!`
      );
      adjustedScore = Math.max(0, adjustedScore - 25);
      validitasKunci = 'Meragukan';
    } else if (dayaPembedaD !== null && dayaPembedaD < 0.2) {
      temuanLokal.push(`Daya pembeda rendah (D = ${dayaPembedaD}); butir soal kurang membedakan kemampuan siswa.`);
      adjustedScore = Math.max(0, adjustedScore - 10);
    }

    if (tingkatKesukaranP !== null && tingkatKesukaranP < 0.15) {
      temuanLokal.push(`Soal terlalu sulit (hanya ${correctPercent}% benar). Periksa kejelasan kalimat atau kunci.`);
    } else if (tingkatKesukaranP !== null && tingkatKesukaranP > 0.92) {
      temuanLokal.push(`Soal terlalu mudah (${correctPercent}% benar); pertimbangkan pengecoh yang lebih bermakna.`);
    }

    if (pengecohTidakBerfungsi.length > 0) {
      temuanLokal.push(`Pengecoh pasif (0 pemilih): Opsi ${pengecohTidakBerfungsi.join(', ')}.`);
      adjustedScore = Math.max(0, adjustedScore - 5);
    }

    const kualitas: QualityVerdict =
      adjustedScore >= 80 && validitasKunci === 'Valid'
        ? 'Baik'
        : adjustedScore < 55 || validitasKunci === 'Perlu Cek'
          ? 'Kritis'
          : 'Perlu Revisi';

    const saranPerbaikanLokal =
      temuanLokal.length === 0
        ? levelKognitif === 'LOTS (C1-C2)'
          ? 'Struktur baik. Pertimbangkan menambah studi kasus/stimulus untuk menaikkan ke MOTS/HOTS.'
          : 'Butir soal berkualitas baik dengan struktur rapi dan level penalaran memadai.'
        : temuanLokal[0];

    return {
      questionId: q.id,
      nomor: idx + 1,
      tipe: q.tipe,
      plainText: plainText || '(Soal berbasis gambar/tabel)',
      bobot: q.bobot || 10,
      kunciJawaban: q.kunciJawaban,
      totalResponden,
      correctCount,
      wrongCount,
      blankCount,
      correctPercent,
      tingkatKesukaranP,
      kategoriKesukaran: classifyDifficulty(tingkatKesukaranP),
      dayaPembedaD,
      kategoriDayaPembeda: classifyDiscrimination(dayaPembedaD),
      distribusiOpsi,
      pengecohTidakBerfungsi,
      levelKognitif,
      skorKualitasStruktur: adjustedScore,
      kualitas,
      validitasKunci,
      temuanLokal,
      saranPerbaikanLokal,
    };
  });

  const totalQuestions = items.length;
  const analyzedWithResultsCount = items.filter((i) => i.totalResponden > 0).length;
  const baikCount = items.filter((i) => i.kualitas === 'Baik').length;
  const revisiCount = items.filter((i) => i.kualitas === 'Perlu Revisi').length;
  const kritisCount = items.filter((i) => i.kualitas === 'Kritis').length;
  const hotsCount = items.filter((i) => i.levelKognitif === 'HOTS (C4-C6)').length;
  const motsCount = items.filter((i) => i.levelKognitif === 'MOTS (C3)').length;
  const lotsCount = items.filter((i) => i.levelKognitif === 'LOTS (C1-C2)').length;
  const averageQualityScore =
    totalQuestions > 0
      ? Math.round(items.reduce((sum, i) => sum + i.skorKualitasStruktur, 0) / totalQuestions)
      : 0;

  return {
    totalQuestions,
    analyzedWithResultsCount,
    baikCount,
    revisiCount,
    kritisCount,
    hotsCount,
    motsCount,
    lotsCount,
    averageQualityScore,
    items,
  };
}

/**
 * Instant, 100% free local structural check & formatting polish for SmartImportPanel drafts.
 * Strips double A./B./C. prefixes, repairs invalid key letters, normalizes HTML whitespace,
 * and annotates cognitive difficulty & diagnostic notes locally without using any API quota.
 */
export function localVerifyAndFixDrafts(drafts: ParsedQuestionDraft[]): {
  drafts: ParsedQuestionDraft[];
  fixedCount: number;
  summary: string;
} {
  let fixedCount = 0;

  const updated = drafts.map((d) => {
    let changed = false;
    let cleanedHtml = String(d.pertanyaanHtml || '')
      .replace(/<p>\s*(?:&nbsp;|\s|<br\s*\/?>)*<\/p>/gi, '')
      .trim();
    if (!cleanedHtml) {
      cleanedHtml = '<p>(Lengkapi teks pertanyaan)</p>';
      changed = true;
    } else if (cleanedHtml !== d.pertanyaanHtml) {
      changed = true;
    }

    let cleanOpsi = [...d.opsi];
    let cleanKeys = [...d.kunciJawaban];

    if (d.tipe === 'BENAR_SALAH') {
      if (cleanOpsi.length !== 2 || cleanOpsi[0] !== 'Benar' || cleanOpsi[1] !== 'Salah') {
        cleanOpsi = ['Benar', 'Salah'];
        changed = true;
      }
      const kLower = (cleanKeys[0] || '').toLowerCase();
      const normBS = kLower.includes('salah') ? 'Salah' : 'Benar';
      if (cleanKeys.length !== 1 || cleanKeys[0] !== normBS) {
        cleanKeys = [normBS];
        changed = true;
      }
    } else if (d.tipe === 'ESAI') {
      if (cleanOpsi.length > 0) {
        cleanOpsi = [];
        changed = true;
      }
    } else {
      const stripped = cleanOpsi.map((o) =>
        String(o || '')
          .trim()
          .replace(/^(?:[A-E]|[1-5])[\.\)\-:]\s+/i, '')
          .trim()
      );
      if (stripped.some((s, i) => s !== cleanOpsi[i])) {
        cleanOpsi = stripped;
        changed = true;
      }
      const validLetters = cleanOpsi.map((_, idx) => getOptionLetter(idx));
      const filteredKeys = Array.from(
        new Set(
          cleanKeys
            .map((k) => k.trim().toUpperCase())
            .filter((k) => validLetters.includes(k))
        )
      );
      if (filteredKeys.length === 0 && validLetters.length > 0) {
        cleanKeys = d.tipe === 'PG_KOMPLEKS' && validLetters.length >= 2 ? [validLetters[0], validLetters[1]] : [validLetters[0]];
        changed = true;
      } else if (filteredKeys.length !== cleanKeys.length) {
        cleanKeys = filteredKeys;
        changed = true;
      }
    }

    const level = detectCognitiveLevel(cleanedHtml, d.tipe);
    const derivedDifficulty: 'Mudah' | 'Sedang' | 'Sulit' =
      d.kesulitan || (level === 'HOTS (C4-C6)' ? 'Sulit' : level === 'MOTS (C3)' ? 'Sedang' : 'Mudah');

    const evalRes = evaluateStructuralQuality({
      tipe: d.tipe,
      pertanyaanHtml: cleanedHtml,
      opsi: cleanOpsi,
      kunciJawaban: cleanKeys,
    });

    const pembahasan =
      d.pembahasan ||
      (evalRes.temuan.length > 0
        ? `Catatan Analisis Lokal: ${evalRes.temuan.join(' ')}`
        : `Analisis Lokal (${level}): Struktur soal & kunci ${cleanKeys.join(', ')} terverifikasi rapi.`);

    if (changed) fixedCount += 1;

    return {
      ...d,
      pertanyaanHtml: cleanedHtml,
      opsi: cleanOpsi,
      kunciJawaban: cleanKeys,
      kesulitan: derivedDifficulty,
      pembahasan,
    };
  });

  const summary =
    fixedCount > 0
      ? `Analisis Lokal (Gratis) selesai: ${fixedCount} soal dirapikan & ${updated.length} soal diperiksa strukturnya.`
      : `Analisis Lokal (Gratis) selesai: Seluruh ${updated.length} soal terverifikasi rapi dan valid.`;

  return { drafts: updated, fixedCount, summary };
}
