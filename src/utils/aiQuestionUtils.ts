import type { QuestionType } from '../types/cbt';
import type { ParsedQuestionDraft } from './questionParser';

export interface TokenizedImagesResult {
  cleanedHtml: string;
  assets: Record<string, string>;
}

/**
 * Extracts embedded data-URL images (`<img src="data:...">`) into compact `__CBT_IMG_N__`
 * placeholders before sending HTML to AI so huge base64 strings never consume token budget
 * or get cut off mid-payload, while keeping exact image placement intact.
 */
export function tokenizeDataImages(html: string): TokenizedImagesResult {
  const assets: Record<string, string> = {};
  let counter = 0;

  const cleanedHtml = html.replace(
    /<img([^>]*?)\ssrc=(["'])(data:image\/[^"']+)\2([^>]*)>/gi,
    (_full, before: string, quote: string, dataUri: string, after: string) => {
      const token = `__CBT_IMG_${counter++}__`;
      assets[token] = dataUri;
      return `<img${before} src=${quote}${token}${quote}${after}>`;
    }
  );

  return { cleanedHtml, assets };
}

/**
 * Restores `__CBT_IMG_N__` placeholders back into their original base64 data URIs.
 */
export function restoreDataImages(html: string, assets: Record<string, string>): string {
  if (!html) return html;
  let restored = html;
  for (const [token, dataUri] of Object.entries(assets)) {
    if (!token) continue;
    restored = restored.split(token).join(dataUri);
  }
  return restored;
}

/**
 * Strips heavy Microsoft Word / Google Docs inline boilerplate (style, class, lang, mso XML,
 * empty span wrappers, comments) while strictly preserving structural HTML (`<table>`, `<img>`,
 * `__CBT_IMG_N__`, `<b>`, `<strong>`, `<i>`, `<em>`, `<u>`, `<sub>`, `<sup>`, `<p>`, `<br>`, lists).
 */
export function stripHtmlBoilerplateForAi(html: string): string {
  if (!html) return '';
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(?:o:p|w:[^>\s]*|m:[^>\s]*|v:[^>\s]*|st1:[^>\s]*|xml)[^>]*>/gi, '')
    .replace(/\s+(?:style|class|lang|dir|align|valign|bgcolor|border|cellpadding|cellspacing|width|height)=(["'])[\s\S]*?\1/gi, '')
    .replace(/<\/?span[^>]*>/gi, '')
    .replace(/<\/?font[^>]*>/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parses upstream Gemini error messages (including RetryInfo `"retryDelay":"61971s"` or `PerDay`
 * quota markers) to determine a smart circuit-breaker backoff duration in milliseconds.
 */
export function parseGeminiRetryDelayMs(err: unknown): number {
  const raw = err instanceof Error ? err.message : String(err || '');
  const upper = raw.toUpperCase();

  // Check explicit JSON retryDelay e.g. "retryDelay":"61971s"
  const retryDelayMatch = raw.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i);
  if (retryDelayMatch) {
    const secs = Number(retryDelayMatch[1]);
    if (Number.isFinite(secs) && secs > 0) {
      return Math.min(secs * 1000, 12 * 60 * 60 * 1000);
    }
  }

  // Check human readable "Please retry in 17h12m51s"
  const humanHourMatch = raw.match(/retry\s+in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i);
  if (humanHourMatch && (humanHourMatch[1] || humanHourMatch[2] || humanHourMatch[3])) {
    const hours = Number(humanHourMatch[1] || 0);
    const mins = Number(humanHourMatch[2] || 0);
    const secs = Number(humanHourMatch[3] || 0);
    const totalMs = (hours * 3600 + mins * 60 + secs) * 1000;
    if (totalMs > 0) {
      return Math.min(totalMs, 12 * 60 * 60 * 1000);
    }
  }

  // Daily Free Tier quota exhausted without explicit seconds -> back off for 1 hour
  if (upper.includes('PERDAY') || upper.includes('GENERATEREQUESTSPERDAY') || upper.includes('PER DAY')) {
    return 60 * 60 * 1000;
  }

  // Transient rate limit / high demand / timeout -> 60s backoff
  return 60_000;
}

/**
 * Splits large HTML/text documents into safe chunks at block boundaries without ever
 * splitting inside a `<table>...</table>` element.
 */
export function chunkHtmlForAi(html: string, maxChunkChars = 4500): string[] {
  const trimmed = html.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChunkChars) return [trimmed];

  // Temporarily guard tables so we never split mid-table
  const tables: string[] = [];
  const guarded = trimmed.replace(/<table[\s\S]*?<\/table>/gi, (m) => {
    const idx = tables.length;
    tables.push(m);
    return `\n__AI_TBL_${idx}__\n`;
  });

  // Split by block boundaries or newlines
  const blocks = guarded
    .split(/(?<=<\/(?:p|div|li|blockquote|h[1-6])>)|\r?\n+/gi)
    .map((b) => b.trim())
    .filter(Boolean);

  const restoreTables = (text: string) =>
    text.replace(/__AI_TBL_(\d+)__/g, (_m, idx) => tables[Number(idx)] || '');

  const chunks: string[] = [];
  let current = '';

  for (const rawBlock of blocks) {
    const block = restoreTables(rawBlock);
    if (!current) {
      current = block;
      continue;
    }
    if (current.length + 1 + block.length <= maxChunkChars) {
      current += '\n' + block;
    } else {
      chunks.push(current);
      current = block;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [trimmed];
}

/**
 * Parses JSON text from Gemini even if wrapped in markdown fences or `{ questions: [...] }`.
 */
export function extractBalancedJsonArray(rawText: string): unknown[] {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!cleaned) return [];

  try {
    const direct = JSON.parse(cleaned) as unknown;
    if (Array.isArray(direct)) return direct;
    if (
      direct &&
      typeof direct === 'object' &&
      Array.isArray((direct as { questions?: unknown[] }).questions)
    ) {
      return (direct as { questions: unknown[] }).questions;
    }
  } catch {
    // Attempt bracket slice fallback
  }

  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      const sliced = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
      if (Array.isArray(sliced)) return sliced;
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeQuestionType(rawType: unknown, opsiCount: number, rawKeys: string[]): QuestionType {
  const upper = String(rawType || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

  if (upper.includes('KOMPLEKS') || upper === 'MULTIPLE_SELECT' || upper === 'CHECKBOX') {
    return 'PG_KOMPLEKS';
  }
  if (upper.includes('BENAR') || upper.includes('SALAH') || upper === 'TRUE_FALSE') {
    return 'BENAR_SALAH';
  }
  if (upper.includes('ESAI') || upper.includes('ESSAY') || upper.includes('URAIAN')) {
    return 'ESAI';
  }
  if (upper === 'PG' || upper.includes('PILIHAN_GANDA') || upper === 'MULTIPLE_CHOICE') {
    return rawKeys.length > 1 ? 'PG_KOMPLEKS' : 'PG';
  }

  if (opsiCount === 0) {
    const joined = rawKeys.join(' ').trim().toLowerCase();
    if (joined === 'benar' || joined === 'salah') return 'BENAR_SALAH';
    return 'ESAI';
  }
  if (rawKeys.length > 1) return 'PG_KOMPLEKS';
  return 'PG';
}

function cleanOptionText(rawOpt: unknown): string {
  return String(rawOpt || '')
    .trim()
    .replace(/^(?:[A-E]|[1-5])[\.\)\-:]\s+/i, '')
    .trim();
}

function normalizeKeys(rawKeysInput: unknown, tipe: QuestionType): string[] {
  const rawList: string[] = Array.isArray(rawKeysInput)
    ? rawKeysInput.map((k) => String(k || '').trim()).filter(Boolean)
    : typeof rawKeysInput === 'string' && rawKeysInput.trim()
      ? rawKeysInput
          .split(/[,;]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  if (tipe === 'BENAR_SALAH') {
    const joined = rawList.join(' ').toLowerCase();
    return [joined.includes('salah') || joined === 'false' ? 'Salah' : 'Benar'];
  }

  if (tipe === 'ESAI') {
    return rawList;
  }

  const letters = rawList
    .map((entry) => {
      const m = entry.toUpperCase().match(/^([A-E])(?:[\.\)\s:]|$)/);
      if (m) return m[1];
      const fallback = entry.toUpperCase().match(/\b([A-E])\b/);
      return fallback ? fallback[1] : '';
    })
    .filter((l): l is string => /^[A-E]$/.test(l));

  const uniqueLetters = Array.from(new Set(letters));
  if (tipe === 'PG_KOMPLEKS') {
    return uniqueLetters.length > 0 ? uniqueLetters : ['A', 'B'];
  }
  return uniqueLetters.length > 0 ? [uniqueLetters[0]] : ['A'];
}

function normalizeDifficulty(raw: unknown): 'Mudah' | 'Sedang' | 'Sulit' | undefined {
  const val = String(raw || '').trim().toLowerCase();
  if (val.includes('mudah') || val === 'easy') return 'Mudah';
  if (val.includes('sulit') || val.includes('hots') || val === 'hard') return 'Sulit';
  if (val.includes('sedang') || val === 'medium') return 'Sedang';
  return undefined;
}

/**
 * Normalizes AI-returned question objects into strict CBT `ParsedQuestionDraft` items,
 * restoring any tokenized data-URL images along the way.
 */
export function normalizeAiQuestions(
  rawItems: unknown[],
  assets: Record<string, string> = {}
): ParsedQuestionDraft[] {
  if (!Array.isArray(rawItems)) return [];

  const results: ParsedQuestionDraft[] = [];

  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;

    const rawBody = String(obj.pertanyaanHtml || obj.pertanyaan || '').trim();
    if (!rawBody) continue;

    const restoredBody = restoreDataImages(rawBody, assets);
    const pertanyaanHtml = /<[a-z][\s\S]*>/i.test(restoredBody)
      ? restoredBody
      : `<p>${restoredBody}</p>`;

    const rawOpsiList = Array.isArray(obj.opsi) ? obj.opsi.map(cleanOptionText).filter(Boolean) : [];
    const rawKeyStrings = Array.isArray(obj.kunciJawaban)
      ? obj.kunciJawaban.map((k) => String(k || '').trim()).filter(Boolean)
      : typeof obj.kunciJawaban === 'string'
        ? obj.kunciJawaban
            .split(/[,;]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

    const tipe = normalizeQuestionType(obj.tipe, rawOpsiList.length, rawKeyStrings);
    const opsi =
      tipe === 'BENAR_SALAH'
        ? ['Benar', 'Salah']
        : tipe === 'ESAI'
          ? []
          : rawOpsiList;
    const kunciJawaban = normalizeKeys(obj.kunciJawaban, tipe);
    const bobotNum = Number(obj.bobot);
    const bobot =
      Number.isFinite(bobotNum) && bobotNum > 0
        ? Math.round(bobotNum)
        : tipe === 'ESAI'
          ? 20
          : 10;

    const pembahasan =
      typeof obj.pembahasan === 'string' && obj.pembahasan.trim()
        ? obj.pembahasan.trim()
        : undefined;
    const kesulitan = normalizeDifficulty(obj.kesulitan);

    results.push({
      tipe,
      pertanyaanHtml,
      opsi,
      kunciJawaban,
      bobot,
      ...(pembahasan ? { pembahasan } : {}),
      ...(kesulitan ? { kesulitan } : {}),
    });
  }

  return results;
}
