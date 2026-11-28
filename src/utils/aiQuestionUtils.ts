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
 * Recovers complete JSON `{...}` objects from a truncated JSON array `[...` when AI output
 * stops mid-stream due to output token limits.
 */
function salvageObjectsFromTruncatedArray(raw: string): unknown[] {
  const arrStart = raw.indexOf('[');
  if (arrStart === -1) return [];

  const recovered: unknown[] = [];
  let inString = false;
  let escaped = false;
  let objDepth = 0;
  let objStart = -1;

  for (let i = arrStart + 1; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (objDepth === 0) objStart = i;
      objDepth++;
    } else if (ch === '}' && objDepth > 0) {
      objDepth--;
      if (objDepth === 0 && objStart !== -1) {
        const candidate = raw.slice(objStart, i + 1);
        try {
          const parsed = JSON.parse(candidate) as unknown;
          if (parsed && typeof parsed === 'object') {
            recovered.push(parsed);
          }
        } catch {
          // Skip malformed object slice
        }
        objStart = -1;
      }
    }
  }

  return recovered;
}

/**
 * Parses JSON text from Gemini even if wrapped in markdown fences, `{ questions: [...] }`,
 * or truncated mid-array.
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
    // Attempt bracket slice or truncated object salvage fallback
  }

  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      const sliced = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
      if (Array.isArray(sliced)) return sliced;
    } catch {
      // Fall through to object salvage
    }
  }

  return salvageObjectsFromTruncatedArray(cleaned);
}

/**
 * Safely parses a single JSON object from Gemini even if wrapped in markdown fences
 * or accompanied by leading/trailing prose.
 */
export function extractBalancedJsonObject(rawText: string): Record<string, unknown> | null {
  const cleaned = String(rawText || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!cleaned) return null;

  try {
    const direct = JSON.parse(cleaned) as unknown;
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }
  } catch {
    // Attempt brace slice fallback
  }

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const sliced = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
      if (sliced && typeof sliced === 'object' && !Array.isArray(sliced)) {
        return sliced as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Splits an array into fixed-size batches for resilient client/server AI processing.
 */
export function chunkArray<T>(items: T[], size: number): T[][] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const safeSize = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) {
    out.push(items.slice(i, i + safeSize));
  }
  return out;
}

/**
 * Safely reads a Fetch API Response without crashing with SyntaxError when upstream proxies
 * return HTML (e.g. 413 Payload Too Large, 502 Bad Gateway, 504 Timeout).
 */
export async function safeParseResponseJson<T>(
  res: Response
): Promise<{ data: T | null; rawText: string }> {
  const rawText = await res.text();
  if (!rawText.trim()) return { data: null, rawText };
  try {
    return { data: JSON.parse(rawText) as T, rawText };
  } catch {
    return { data: null, rawText };
  }
}

/**
 * Formats HTTP/network/timeout failures into clear Indonesian user guidance.
 */
export function formatClientFetchError(
  err: unknown,
  status?: number,
  serverMessage?: string
): string {
  if (serverMessage && serverMessage.trim()) return serverMessage.trim();
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'Proses AI melebihi batas waktu untuk bagian dokumen ini. Sistem akan otomatis membagi dokumen lebih kecil agar tetap berhasil.';
  }
  if (status === 413) {
    return 'Ukuran file/gambar dalam satu pengiriman terlalu besar. Perkecil resolusi atau kirim bertahap per halaman.';
  }
  if (status === 429) {
    return 'Permintaan AI gratis sedang padat sesaat. Tunggu beberapa detik lalu klik Ekstrak ulang.';
  }
  if (status === 502 || status === 503 || status === 504) {
    return 'Server AI sedang sibuk sementara. Silakan klik Ekstrak ulang beberapa detik lagi.';
  }
  return 'Koneksi jaringan ke endpoint AI terputus sementara. Pastikan aplikasi berjalan penuh melalui server dan coba kirim ulang.';
}

export interface RetryFetchOptions {
  url: string;
  init: RequestInit;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  onRetry?: (attempt: number, reason: string) => void;
}

export interface RetryFetchResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  rawText: string;
  errorMessage?: string;
  wasTimeoutOrNetwork: boolean;
  wasPayloadTooLarge: boolean;
}

/**
 * Executes a JSON fetch request with bounded timeout and automatic exponential-backoff retries
 * for transient network hiccups, timeouts, and 502/503/504/429 responses.
 */
export async function fetchJsonWithRetry<T>(
  opts: RetryFetchOptions
): Promise<RetryFetchResult<T>> {
  const {
    url,
    init,
    timeoutMs = 30_000,
    maxRetries = 2,
    baseDelayMs = 650,
    fetchImpl = fetch,
    onRetry,
  } = opts;

  let lastStatus = 0;
  let lastData: T | null = null;
  let lastRawText = '';
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const res = await fetchImpl(url, {
        ...init,
        signal: controller ? controller.signal : init.signal,
      });
      if (timer !== null) clearTimeout(timer);

      lastStatus = res.status;
      const parsed = await safeParseResponseJson<T & { error?: string }>(res);
      lastData = parsed.data;
      lastRawText = parsed.rawText;

      if (res.ok) {
        return {
          ok: true,
          status: res.status,
          data: parsed.data,
          rawText: parsed.rawText,
          wasTimeoutOrNetwork: false,
          wasPayloadTooLarge: false,
        };
      }

      const serverMsg =
        parsed.data && typeof parsed.data === 'object' && typeof parsed.data.error === 'string'
          ? parsed.data.error
          : undefined;
      const retryableStatus = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;

      if (retryableStatus && attempt < maxRetries) {
        onRetry?.(attempt + 1, `HTTP ${res.status}`);
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
        continue;
      }

      return {
        ok: false,
        status: res.status,
        data: parsed.data,
        rawText: parsed.rawText,
        errorMessage: formatClientFetchError(null, res.status, serverMsg),
        wasTimeoutOrNetwork: res.status === 502 || res.status === 503 || res.status === 504,
        wasPayloadTooLarge: res.status === 413,
      };
    } catch (err) {
      if (timer !== null) clearTimeout(timer);
      lastErr = err;
      if (attempt < maxRetries) {
        const reason = err instanceof DOMException && err.name === 'AbortError' ? 'timeout' : 'jaringan';
        onRetry?.(attempt + 1, reason);
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
        continue;
      }
    }
  }

  return {
    ok: false,
    status: lastStatus,
    data: lastData,
    rawText: lastRawText,
    errorMessage: formatClientFetchError(lastErr, lastStatus || undefined),
    wasTimeoutOrNetwork: true,
    wasPayloadTooLarge: lastStatus === 413,
  };
}

/**
 * Checks whether an HTML editor string contains meaningful visible text or media tags
 * (ignoring empty `<br>`, `&nbsp;`, or empty `<p></p>` placeholders).
 */
export function hasMeaningfulHtmlContent(html: string): boolean {
  if (!html) return false;
  if (/<img\b|<table\b|<svg\b/i.test(html)) return true;
  const plain = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim();
  return plain.length > 0;
}

/**
 * Escapes plain text safely before wrapping inside HTML tags.
 */
export function escapePlainTextForHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Sanitizes imported `.html`/`.htm` files by removing head/script/style blocks while
 * preserving structural exam tags (`<table>`, `<img>`, lists, headings, formatting).
 */
export function sanitizeHtmlImport(rawHtml: string): string {
  if (!rawHtml) return '';
  const bodyMatch = rawHtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : rawHtml;
  return body
    .replace(/<(head|script|style|noscript|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
}

/**
 * Converts basic RTF documents (`.rtf` exported from MS Word / WordPad / LibreOffice)
 * into clean plain text while preserving line breaks and basic Unicode escapes.
 */
export function stripRtfToPlainText(rtf: string): string {
  if (!rtf) return '';
  let text = rtf;
  // Decode RTF unicode escapes \uN?
  text = text.replace(/\\u(-?\d+)\??/g, (_m, code) => {
    const n = Number(code);
    const charCode = n < 0 ? 65536 + n : n;
    return Number.isFinite(charCode) ? String.fromCharCode(charCode) : '';
  });
  // Decode hex escapes \'hh
  text = text.replace(/\\'([0-9a-fA-F]{2})/g, (_m, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  // Drop header/metadata destinations while leaving a space boundary
  text = text.replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict|object|header|footer|fldinst)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gi, ' ');
  // Convert paragraph/line/tab control words and strip remaining RTF control words
  text = text
    .replace(/\\(?:par|line)\b ?/g, '\n')
    .replace(/\\tab\b ?/g, '\t')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/^[ \t]+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

/**
 * Converts parsed spreadsheet rows (Excel / CSV / TSV / ODS) into structured readable lines
 * or HTML table blocks so AI accurately extracts any tabular or columnar question bank.
 */
export function formatSpreadsheetRowsToHtml(rows: unknown[][], sheetName?: string): string {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const nonEmptyRows = rows
    .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '').trim()) : []))
    .filter((row) => row.some(Boolean));
  if (nonEmptyRows.length === 0) return '';

  const maxCols = Math.max(...nonEmptyRows.map((r) => r.length));
  const titleHtml = sheetName ? `<p><strong>Sheet: ${escapePlainTextForHtml(sheetName)}</strong></p>\n` : '';

  if (maxCols <= 1) {
    return (
      titleHtml +
      nonEmptyRows
        .map((r) => `<p>${escapePlainTextForHtml(r[0] || '')}</p>`)
        .join('\n')
    );
  }

  const trs = nonEmptyRows
    .map((row) => {
      const tds = Array.from({ length: maxCols }, (_, i) => {
        const val = row[i] || '';
        return `<td>${escapePlainTextForHtml(val)}</td>`;
      }).join('');
      return `<tr>${tds}</tr>`;
    })
    .join('\n');

  return `${titleHtml}<table><tbody>\n${trs}\n</tbody></table>`;
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
    .replace(/^<(?:p|div|span)[^>]*>([\s\S]*?)<\/(?:p|div|span)>$/i, '$1')
    .trim()
    .replace(/^(?:\(?[A-E]\)|\[[A-E]\]|(?:[A-E]|[1-5])[\.\)\-:])\s+/i, '')
    .trim();
}

function expandKeyTokens(rawInput: unknown): string[] {
  const rawList: string[] = Array.isArray(rawInput)
    ? rawInput.map((k) => String(k || '').trim()).filter(Boolean)
    : typeof rawInput === 'string' && rawInput.trim()
      ? rawInput
          .split(/(?:[,;/&|]|\bdan\b|\band\b)+/i)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const expanded: string[] = [];
  for (const token of rawList) {
    const compactLetters = token.replace(/[\s\-()[\].:]/g, '').toUpperCase();
    if (/^[A-E]{2,5}$/.test(compactLetters)) {
      expanded.push(...compactLetters.split(''));
    } else {
      expanded.push(token);
    }
  }
  return expanded;
}

function normalizeKeys(
  rawKeysInput: unknown,
  tipe: QuestionType,
  opsi: string[]
): string[] {
  const expanded = expandKeyTokens(rawKeysInput);
  const opsiCount = opsi.length;

  if (tipe === 'BENAR_SALAH') {
    const joined = expanded.join(' ').toLowerCase();
    return [joined.includes('salah') || joined === 'false' || joined === 'b' ? 'Salah' : 'Benar'];
  }

  if (tipe === 'ESAI') {
    return expanded;
  }

  const maxIdx = Math.max(0, Math.min(4, (opsiCount > 0 ? opsiCount : 5) - 1));
  const validRange = 'ABCDE'.slice(0, maxIdx + 1);

  const letters = expanded
    .map((entry) => {
      const m = entry.toUpperCase().match(/^\(?([A-E])(?:[\.\)\]:\s]|$)/);
      if (m) return m[1];
      const fallback = entry.toUpperCase().match(/\b([A-E])\b/);
      if (fallback) return fallback[1];
      // Match option text directly if AI returned full answer text instead of letter A-E
      const cleanEntry = entry.toLowerCase().replace(/\s+/g, ' ').trim();
      if (cleanEntry && opsi.length > 0) {
        const matchedIdx = opsi.findIndex((o) => {
          const cleanOpt = o.replace(/<[^>]+>/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
          return cleanOpt === cleanEntry || (cleanEntry.length >= 4 && cleanOpt.includes(cleanEntry));
        });
        if (matchedIdx >= 0 && matchedIdx < validRange.length) {
          return validRange[matchedIdx];
        }
      }
      return '';
    })
    .filter((l): l is string => l.length === 1 && validRange.includes(l));

  const uniqueLetters = Array.from(new Set(letters));
  if (tipe === 'PG_KOMPLEKS') {
    if (uniqueLetters.length >= 2) return uniqueLetters;
    if (uniqueLetters.length === 1 && maxIdx >= 1) {
      return [uniqueLetters[0], uniqueLetters[0] === 'A' ? 'B' : 'A'];
    }
    return maxIdx >= 1 ? ['A', 'B'] : ['A'];
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

    const rawOpsiList = Array.isArray(obj.opsi)
      ? obj.opsi.map((opt) => cleanOptionText(restoreDataImages(String(opt || ''), assets))).filter(Boolean)
      : [];
    const rawKeyStrings = expandKeyTokens(obj.kunciJawaban);

    const tipe = normalizeQuestionType(obj.tipe, rawOpsiList.length, rawKeyStrings);
    const opsi =
      tipe === 'BENAR_SALAH'
        ? ['Benar', 'Salah']
        : tipe === 'ESAI'
          ? []
          : rawOpsiList;
    const kunciJawaban = normalizeKeys(obj.kunciJawaban, tipe, opsi);
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
