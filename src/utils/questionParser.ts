import type { QuestionType } from '../types/cbt';

export interface ParsedQuestionDraft {
  tipe: QuestionType;
  pertanyaanHtml: string;
  opsi: string[];
  kunciJawaban: string[];
  bobot: number;
  pembahasan?: string;
  kesulitan?: 'Mudah' | 'Sedang' | 'Sulit';
}

/**
 * Mem-parse HTML dari Microsoft Word / Mammoth / Teks biasa menjadi butir soal terstruktur
 * sambil mempertahankan tag <table>, <img>, <b>, <i>, dan kotak bacaan secara utuh.
 */
export function parseRichHtmlQuestions(rawInput: string): ParsedQuestionDraft[] {
  const trimmed = rawInput.trim();
  if (!trimmed) return [];

  // Normalize line breaks for plain text vs HTML
  const hasHtmlTags = /<(table|p|div|br|img|ol|ul|tr|td|strong|b)\b/i.test(trimmed);
  let html = trimmed;
  if (!hasHtmlTags) {
    html = trimmed
      .split(/\r?\n/)
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('\n');
  }

  // Split blocks by numbered question markers like "1." / "2." / "Soal 1" at block boundaries
  // Keep inner tables intact by splitting only outside <table>...</table>
  const segments = splitOutsideTables(html);
  const drafts: ParsedQuestionDraft[] = [];

  for (const seg of segments) {
    const parsed = parseSingleQuestionSegment(seg);
    if (parsed) {
      drafts.push(parsed);
    }
  }

  return drafts;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function splitOutsideTables(html: string): string[] {
  // Replace tables temporarily with placeholders so regex splitting never splits inside a <table>
  const tables: string[] = [];
  const withPlaceholders = html.replace(/<table[\s\S]*?<\/table>/gi, (match) => {
    const idx = tables.length;
    tables.push(match);
    return `__TABLE_PLACEHOLDER_${idx}__`;
  });

  // Match question start patterns at start of line or right after <p>/<div>/<br>
  const normalized = withPlaceholders
    .replace(/(<p[^>]*>|<div[^>]*>|<br\s*\/?>|\n)\s*(\d{1,3}[\.\)]\s+)/gi, '\n<<<Q_SPLIT>>>$2')
    .replace(/^(\s*\d{1,3}[\.\)]\s+)/i, '<<<Q_SPLIT>>>$1');

  const rawChunks = normalized
    .split('<<<Q_SPLIT>>>')
    .map((c) => c.trim())
    .filter(Boolean);

  const chunks = rawChunks.length > 0 ? rawChunks : [withPlaceholders];

  return chunks.map((chunk) =>
    chunk.replace(/__TABLE_PLACEHOLDER_(\d+)__/g, (_m, idx) => tables[Number(idx)] || '')
  );
}

function stripTagsToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function parseSingleQuestionSegment(segmentHtml: string): ParsedQuestionDraft | null {
  const plain = stripTagsToText(segmentHtml);
  if (!plain || plain.length < 3) return null;

  // Extract explicit Kunci Jawaban line if present
  let explicitKeyRaw = '';
  const keyMatch = plain.match(/(?:Kunci(?:\s+Jawaban)?|Jawaban)\s*[:=]\s*([^\n]+)/i);
  if (keyMatch) {
    explicitKeyRaw = keyMatch[1].trim();
  }

  // Extract explicit Tipe line if present
  let explicitType: QuestionType | null = null;
  if (/\b(?:PG\s*Kompleks|Pilihan\s*Ganda\s*Kompleks)\b/i.test(plain)) {
    explicitType = 'PG_KOMPLEKS';
  } else if (/\b(?:Benar\s*\/\s*Salah|Benar\s*-\s*Salah|True\s*\/\s*False)\b/i.test(plain)) {
    explicitType = 'BENAR_SALAH';
  } else if (/\b(?:Esai|Uraian)\b/i.test(plain)) {
    explicitType = 'ESAI';
  }

  // Remove the leading question number (e.g., "1. " or "1) ")
  let bodyHtml = segmentHtml.replace(/^(\s*(?:<p[^>]*>|<div[^>]*>)?\s*)\d{1,3}[\.\)]\s+/i, '$1');

  // Remove Kunci / Tipe metadata lines from HTML body
  bodyHtml = bodyHtml
    .replace(/<(?:p|div)[^>]*>\s*(?:Kunci(?:\s+Jawaban)?|Jawaban|Tipe)\s*[:=][^<]*<\/(?:p|div)>/gi, '')
    .replace(/(?:Kunci(?:\s+Jawaban)?|Jawaban|Tipe)\s*[:=][^\n<]+/gi, '');

  // Extract options A-E from plain lines (and clean them from bodyHtml)
  const lines = plain.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const opsi: string[] = [];
  const optionRegex = /^([A-E])[\.\)]\s+(.+)$/i;

  for (const line of lines) {
    const m = line.match(optionRegex);
    if (m) {
      opsi.push(m[2].trim());
    }
  }

  // Remove option paragraphs/lines from bodyHtml so options don't duplicate inside question body
  if (opsi.length >= 2) {
    bodyHtml = bodyHtml
      .replace(/<(p|div|li)[^>]*>\s*[A-E][\.\)]\s+(?:(?!<\/?\1\b)[\s\S])*?<\/\1>/gi, '')
      .replace(/(?:^|\n|<br\s*\/?>)\s*[A-E][\.\)]\s+[^\n<]+/gi, '');
  }

  // Determine final QuestionType
  let tipe: QuestionType = explicitType || 'PG';
  if (!explicitType) {
    if (opsi.length === 0) {
      if (/\b(Benar|Salah)\b/i.test(explicitKeyRaw) && /^(benar|salah)$/i.test(explicitKeyRaw.trim())) {
        tipe = 'BENAR_SALAH';
      } else {
        tipe = 'ESAI';
      }
    } else if (explicitKeyRaw.includes(',') || explicitKeyRaw.split(/\s+/).filter((t) => /^[A-E]$/i.test(t)).length > 1) {
      tipe = 'PG_KOMPLEKS';
    } else {
      tipe = 'PG';
    }
  }

  let finalOpsi = opsi;
  let kunciJawaban: string[] = [];

  if (tipe === 'BENAR_SALAH') {
    finalOpsi = ['Benar', 'Salah'];
    if (/salah/i.test(explicitKeyRaw)) kunciJawaban = ['Salah'];
    else kunciJawaban = ['Benar'];
  } else if (tipe === 'ESAI') {
    finalOpsi = [];
    kunciJawaban = explicitKeyRaw ? [explicitKeyRaw] : [];
  } else if (tipe === 'PG_KOMPLEKS') {
    const keys = explicitKeyRaw
      .toUpperCase()
      .split(/[\s,;]+/)
      .filter((k) => /^[A-E]$/.test(k));
    kunciJawaban = keys.length > 0 ? Array.from(new Set(keys)) : ['A', 'B'];
  } else {
    const keyMatchLetter = explicitKeyRaw.toUpperCase().match(/[A-E]/);
    kunciJawaban = keyMatchLetter ? [keyMatchLetter[0]] : ['A'];
  }

  const cleanedBodyHtml = bodyHtml.trim() || `<p>${escapeHtml(plain)}</p>`;

  return {
    tipe,
    pertanyaanHtml: cleanedBodyHtml,
    opsi: finalOpsi,
    kunciJawaban,
    bobot: tipe === 'ESAI' ? 20 : 10,
  };
}
