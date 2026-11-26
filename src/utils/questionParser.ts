import type { QuestionType } from '../types/cbt';
import { getOptionLetter } from './examLogic';
import { detectCognitiveLevel } from './questionAnalysis';

export interface ParsedQuestionDraft {
  tipe: QuestionType;
  pertanyaanHtml: string;
  opsi: string[];
  kunciJawaban: string[];
  bobot: number;
  pembahasan?: string;
  kesulitan?: 'Mudah' | 'Sedang' | 'Sulit';
}

interface ConsolidatedAnswerInfo {
  rawKey: string;
  pembahasan?: string;
}

/**
 * Mem-parse HTML dari Microsoft Word / Mammoth / Google Docs / PDF / Teks biasa menjadi
 * butir soal terstruktur 100% gratis tanpa batas kuota API, sambil mempertahankan
 * tag <table>, <img>, <b>, <i>, aksara Arab, bacaan stimulus lintas nomor, serta
 * daftar kunci jawaban terpisah di bagian akhir dokumen.
 */
export function parseRichHtmlQuestions(rawInput: string): ParsedQuestionDraft[] {
  const trimmed = rawInput.trim();
  if (!trimmed) return [];

  const hasHtmlTags = /<(table|p|div|br|img|ol|ul|tr|td|strong|b|li)\b/i.test(trimmed);
  let html = trimmed;
  if (!hasHtmlTags) {
    html = trimmed
      .split(/\r?\n/)
      .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : ''))
      .filter(Boolean)
      .join('\n');
  }

  // 1. Expand Word/Mammoth <ol>/<li> and nested <ol type="a"> option lists
  html = convertOrderedListsToNumberedBlocks(html);

  // 2. Extract and strip consolidated "Kunci Jawaban" section at the bottom of the document
  const { cleanedHtml, answerMap } = extractConsolidatedAnswerKeys(html);

  // 3. Extract shared reading passages ("untuk soal nomor X sampai Y")
  const { htmlWithoutStandaloneStimuli, stimulusMap } = buildStimulusMap(cleanedHtml);

  // 4. Split blocks by numbered question markers outside tables & merge inner numbered statements
  const rawSegments = splitOutsideTables(htmlWithoutStandaloneStimuli);
  const mergedSegments = mergeInnerStatementSegments(rawSegments);

  const drafts: ParsedQuestionDraft[] = [];

  for (let i = 0; i < mergedSegments.length; i++) {
    const seg = mergedSegments[i];
    const qNumMatch = seg.match(/^\s*(?:<(?:p|div|strong|b)[^>]*>\s*)*(?:\(?(\d{1,3})[\.\)]|Soal\s+(?:No\.?\s*)?(\d{1,3}))/i);
    const qNum = qNumMatch ? Number(qNumMatch[1] || qNumMatch[2]) : i + 1;

    const consolidated = answerMap.get(qNum);
    const sharedStimulus = stimulusMap.get(qNum);

    const parsed = parseSingleQuestionSegment(seg, consolidated, sharedStimulus);
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

function stripTagsToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Finds top-level <ol>...</ol> lists and expands them into explicit numbered `<p>1. ...</p>`
 * blocks, converting nested `<ol type="a|A">` or 2-5 item nested lists into `<p>A. ...</p>`.
 */
function convertOrderedListsToNumberedBlocks(html: string): string {
  if (!/<ol\b/i.test(html)) return html;

  let result = '';
  let cursor = 0;
  const openTagRegex = /<ol\b([^>]*)>/gi;

  while (cursor < html.length) {
    openTagRegex.lastIndex = cursor;
    const match = openTagRegex.exec(html);
    if (!match) {
      result += html.slice(cursor);
      break;
    }

    const startIdx = match.index;
    result += html.slice(cursor, startIdx);

    const endIdx = findMatchingCloseTag(html, startIdx, 'ol');
    if (endIdx === -1) {
      result += html.slice(startIdx);
      break;
    }

    const attrs = match[1] || '';
    const innerHtml = html.slice(startIdx + match[0].length, endIdx - '</ol>'.length);
    const isLettered = /type\s*=\s*["']?[aA]["']?/i.test(attrs) || /lower-alpha|upper-alpha/i.test(attrs);
    const items = extractDirectListItems(innerHtml);

    if (items.length === 0) {
      cursor = endIdx;
      continue;
    }

    if (isLettered && items.length <= 5) {
      result += items
        .map((itemHtml, idx) => prependLabelToBlock(`${getOptionLetter(idx)}. `, convertOrderedListsToNumberedBlocks(itemHtml)))
        .join('\n');
    } else {
      const startMatch = attrs.match(/start\s*=\s*["']?(\d+)["']?/i);
      let qNum = startMatch ? Number(startMatch[1]) : 1;
      const renderedItems: string[] = [];

      for (const itemHtml of items) {
        const expandedItem = expandNestedOptionListsInsideItem(itemHtml);
        const alreadyNumbered = /^\s*(?:<[^>]+>\s*)*\d{1,3}[\.\)]\s+/.test(expandedItem);
        renderedItems.push(alreadyNumbered ? expandedItem : prependLabelToBlock(`${qNum}. `, expandedItem));
        qNum++;
      }
      result += renderedItems.join('\n');
    }

    cursor = endIdx;
  }

  return result;
}

function expandNestedOptionListsInsideItem(itemHtml: string): string {
  // Replace nested <ol> or <ul> that look like options (2-5 items) with sibling <p>A. ...</p> blocks
  return itemHtml.replace(/<(ol|ul)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (full, _tag, attrs: string, inner: string) => {
    const subItems = extractDirectListItems(inner);
    const isLettered =
      /type\s*=\s*["']?[aA]["']?/i.test(attrs) || /alpha|latin/i.test(attrs);
    if (subItems.length >= 2 && subItems.length <= 5 && (isLettered || subItems.length >= 3)) {
      return (
        '\n' +
        subItems
          .map((sub, idx) => prependLabelToBlock(`${getOptionLetter(idx)}. `, sub))
          .join('\n')
      );
    }
    if (subItems.length > 0) {
      return (
        '\n' +
        subItems
          .map((sub, idx) => prependLabelToBlock(`${idx + 1}. `, sub))
          .join('\n')
      );
    }
    return full;
  });
}

function prependLabelToBlock(label: string, blockHtml: string): string {
  const trimmed = blockHtml.trim();
  const openBlockMatch = trimmed.match(/^<(p|div)\b([^>]*)>([\s\S]*)$/i);
  if (openBlockMatch) {
    const [, tag, attrs, rest] = openBlockMatch;
    return `<${tag}${attrs}>${label}${rest}`;
  }
  const firstBlockIdx = trimmed.search(/<(?:p|div|table)\b/i);
  if (firstBlockIdx > 0) {
    const prefix = trimmed.slice(0, firstBlockIdx).trim();
    const rest = trimmed.slice(firstBlockIdx).trim();
    return `<p>${label}${prefix}</p>\n${rest}`;
  }
  return `<p>${label}${trimmed}</p>`;
}

function findMatchingCloseTag(html: string, openIndex: number, tagName: string): number {
  const tagRegex = new RegExp(`<(\\/)?${tagName}\\b[^>]*>`, 'gi');
  tagRegex.lastIndex = openIndex;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(html)) !== null) {
    if (m[1]) {
      depth--;
      if (depth === 0) return m.index + m[0].length;
    } else {
      depth++;
    }
  }
  return -1;
}

function extractDirectListItems(listInnerHtml: string): string[] {
  const items: string[] = [];
  let cursor = 0;
  const liOpenRegex = /<li\b[^>]*>/gi;

  while (cursor < listInnerHtml.length) {
    liOpenRegex.lastIndex = cursor;
    const match = liOpenRegex.exec(listInnerHtml);
    if (!match) break;

    const liStart = match.index;
    const liEnd = findMatchingCloseTag(listInnerHtml, liStart, 'li');
    if (liEnd === -1) break;

    const content = listInnerHtml
      .slice(liStart + match[0].length, liEnd - '</li>'.length)
      .trim();
    if (content) items.push(content);
    cursor = liEnd;
  }

  return items;
}

/**
 * Extracts consolidated "Kunci Jawaban" sections (tables or lists) at the bottom of documents
 * and strips that trailing block so it isn't mistakenly parsed as an Esai question.
 */
function extractConsolidatedAnswerKeys(html: string): {
  cleanedHtml: string;
  answerMap: Map<number, ConsolidatedAnswerInfo>;
} {
  const answerMap = new Map<number, ConsolidatedAnswerInfo>();
  const headingRegex = /(?:<[^>]+>\s*)*(?:KUNCI\s+JAWABAN|PEMBAHASAN\s*(?:&amp;|&|DAN)\s*KUNCI|ANSWER\s+KEY)\b/gi;

  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = headingRegex.exec(html)) !== null) {
    // Only treat as consolidated section if it sits in the back half of document
    if (m.index >= Math.floor(html.length * 0.25)) {
      lastMatch = m;
    }
  }

  if (!lastMatch) {
    return { cleanedHtml: html, answerMap };
  }

  // Only treat as a consolidated key block if the line is a heading/short intro (not inline inside one question)
  const blockStart = findBlockBoundaryStart(html, lastMatch.index);
  const trailingSlice = html.slice(blockStart);
  const trailingPlain = stripTagsToText(trailingSlice);

  const keyEntries = parseConsolidatedKeyText(trailingPlain);
  if (keyEntries.size < 2) {
    return { cleanedHtml: html, answerMap };
  }

  for (const [num, info] of keyEntries.entries()) {
    answerMap.set(num, info);
  }

  return {
    cleanedHtml: html.slice(0, blockStart).trim(),
    answerMap,
  };
}

function findBlockBoundaryStart(html: string, idx: number): number {
  const before = html.slice(0, idx);
  const pIdx = before.lastIndexOf('<p');
  const divIdx = before.lastIndexOf('<div');
  const hIdx = Math.max(before.lastIndexOf('<h1'), before.lastIndexOf('<h2'), before.lastIndexOf('<h3'), before.lastIndexOf('<h4'));
  const brIdx = before.lastIndexOf('<br');
  const candidate = Math.max(pIdx, divIdx, hIdx, brIdx);
  return candidate !== -1 && idx - candidate < 60 ? candidate : idx;
}

function parseConsolidatedKeyText(plainText: string): Map<number, ConsolidatedAnswerInfo> {
  const map = new Map<number, ConsolidatedAnswerInfo>();
  // Support entries like "1. B", "1) A, C", "1. B (penjelasan...)", "2. Benar", "No 3: D"
  const normalized = plainText
    .replace(/\r?\n/g, ' | ')
    .replace(/\s+(?=(?:No\.?\s*)?\d{1,3}[\.\)\-:])/gi, ' | ');
  const parts = normalized.split('|').map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    const m = part.match(/^(?:No\.?\s*)?(\d{1,3})\s*[\.\)\-:]\s*(.+)$/i);
    if (!m) continue;
    const num = Number(m[1]);
    let rest = m[2].trim();
    let pembahasan: string | undefined;

    const parenMatch = rest.match(/^(.+?)\s*\(([^)]{4,})\)\s*$/);
    if (parenMatch) {
      rest = parenMatch[1].trim();
      pembahasan = parenMatch[2].trim();
    } else {
      const dashMatch = rest.match(/^([A-E](?:\s*[,/&]\s*[A-E])*|Benar|Salah)\s*[-–:]\s+(.{5,})$/i);
      if (dashMatch) {
        rest = dashMatch[1].trim();
        pembahasan = dashMatch[2].trim();
      }
    }

    if (num > 0 && rest) {
      map.set(num, { rawKey: rest, pembahasan });
    }
  }

  return map;
}

/**
 * Extracts shared reading stimulus blocks ("Bacaan untuk soal nomor 1 sampai 3") and maps them
 * to every referenced question number.
 */
function buildStimulusMap(html: string): {
  htmlWithoutStandaloneStimuli: string;
  stimulusMap: Map<number, string>;
} {
  const stimulusMap = new Map<number, string>();
  const rangeRegex =
    /(<(?:p|div|blockquote|h[1-6])[^>]*>[^]*?(?:bacaan|wacana|teks|stimul(?:us|i)|perhatikan\s+(?:teks|tabel|paragraf))[^]*?untuk\s+soal\s+(?:nomor|no\.?)\s*(\d{1,3})\s*(?:s\.?d\.?|sampai(?:\s+dengan)?|hingga|-|–)\s*(\d{1,3})[^]*?<\/(?:p|div|blockquote|h[1-6])>)/gi;

  const firstQuestionIdx = html.search(/(?:^|<p[^>]*>|<div[^>]*>|\n)\s*\(?\d{1,3}[\.\)]\s+/i);
  let working = html;
  let match: RegExpExecArray | null;

  // Match stimulus headings followed by non-question paragraphs/tables until the next question number
  const matches: Array<{ start: number; end: number; from: number; to: number; content: string }> = [];
  while ((match = rangeRegex.exec(html)) !== null) {
    const start = match.index;
    const from = Number(match[2]);
    const to = Number(match[3]);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 25) continue;

    // Grab everything from this header up to the next numbered question start
    const afterHeaderStart = match.index + match[0].length;
    const afterHeader = html.slice(afterHeaderStart);
    const nextQMatch = afterHeader.match(/(?:^|\n|<(?:p|div|strong|b)[^>]*>)\s*\(?\d{1,3}[\.\)]\s+/i);
    const bodyEndOffset =
      nextQMatch && nextQMatch.index !== undefined
        ? afterHeaderStart + nextQMatch.index
        : afterHeaderStart;

    const fullStimulus = html.slice(start, bodyEndOffset).trim();
    if (firstQuestionIdx === -1 || start <= firstQuestionIdx) {
      matches.push({ start, end: bodyEndOffset, from, to, content: fullStimulus });
    }
  }

  for (let i = matches.length - 1; i >= 0; i--) {
    const item = matches[i];
    for (let n = item.from; n <= item.to; n++) {
      const existing = stimulusMap.get(n);
      stimulusMap.set(n, existing ? `${existing}\n${item.content}` : item.content);
    }
    working = working.slice(0, item.start) + '\n' + working.slice(item.end);
  }

  return {
    htmlWithoutStandaloneStimuli: working.trim(),
    stimulusMap,
  };
}

function splitOutsideTables(html: string): string[] {
  const tables: string[] = [];
  const withPlaceholders = html.replace(/<table[\s\S]*?<\/table>/gi, (match) => {
    const idx = tables.length;
    tables.push(match);
    return `__TABLE_PLACEHOLDER_${idx}__`;
  });

  const normalized = withPlaceholders
    .replace(
      /(<p[^>]*>|<div[^>]*>|<br\s*\/?>|\n)\s*((?:\(?\d{1,3}[\.\)]|Soal\s+(?:No\.?\s*)?\d{1,3}[\.\):]?)\s+)/gi,
      (_m, openTag: string, marker: string) =>
        openTag.startsWith('<p') || openTag.startsWith('<div')
          ? `\n<<<Q_SPLIT>>>${openTag}${marker}`
          : `\n<<<Q_SPLIT>>>${marker}`
    )
    .replace(/^(\s*(?:\(?\d{1,3}[\.\)]|Soal\s+(?:No\.?\s*)?\d{1,3}[\.\):]?)\s+)/i, '<<<Q_SPLIT>>>$1');

  const rawChunks = normalized
    .split('<<<Q_SPLIT>>>')
    .map((c) => c.trim())
    .filter(Boolean);

  const chunks = rawChunks.length > 0 ? rawChunks : [withPlaceholders];

  return chunks.map((chunk) =>
    chunk.replace(/__TABLE_PLACEHOLDER_(\d+)__/g, (_m, idx) => tables[Number(idx)] || '')
  );
}

/**
 * Merges inner numbered statement items (`1. ... 2. ... 3. ...` inside a question stem before
 * options appear) back into their parent question segment instead of splitting them into false Esai items.
 */
function mergeInnerStatementSegments(segments: string[]): string[] {
  if (segments.length <= 1) return segments;

  const result: string[] = [];
  let expectedSubNum: number | null = null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const numMatch = seg.match(/^\s*(?:<(?:p|div)[^>]*>\s*)*\(?(\d{1,3})[\.\)]/);
    const segNum = numMatch ? Number(numMatch[1]) : null;
    const plain = stripTagsToText(seg);
    const hasOptions = segmentContainsOptions(seg, plain);
    const introForSublist =
      /\b(?:pernyataan|ciri-ciri|langkah-langkah|faktor|komponen|peristiwa|urutan|hal-hal)\b[\s\S]{0,60}:\s*$/i.test(
        plain
      ) ||
      /(?:perhatikan|amati|simak)\s+(?:pernyataan|langkah|data|daftar)[\s\S]{0,80}(?:berikut|di\s+bawah)\s*[:!]?\s*$/i.test(
        plain
      );

    if (expectedSubNum !== null && segNum === expectedSubNum && result.length > 0) {
      result[result.length - 1] += '\n' + seg;
      if (hasOptions) {
        expectedSubNum = null;
      } else {
        expectedSubNum++;
      }
      continue;
    }

    expectedSubNum = null;
    result.push(seg);

    if (!hasOptions && introForSublist && i + 1 < segments.length) {
      const nextNumMatch = segments[i + 1].match(/^\s*(?:<(?:p|div)[^>]*>\s*)*\(?(\d{1,3})[\.\)]/);
      if (nextNumMatch && Number(nextNumMatch[1]) === 1) {
        expectedSubNum = 1;
      }
    }
  }

  return result;
}

function segmentContainsOptions(segmentHtml: string, plain: string): boolean {
  if (/^[A-E][\.\)\]:]\s+/im.test(plain)) return true;
  if (/<td[^>]*>\s*[A-E][\.\)\s]/i.test(segmentHtml)) return true;
  if (extractInlineOptionsFromLine(plain).length >= 2) return true;
  return false;
}

/**
 * Extracts options placed inside 2-column or grid layout `<table>`s (without harming real data tables).
 */
function extractOptionsFromLayoutTables(segmentHtml: string): {
  htmlWithoutOptionTables: string;
  tableOptions: string[];
} {
  const tableOptions: string[] = [];
  const tableRegex = /<table[\s\S]*?<\/table>/gi;

  const htmlWithoutOptionTables = segmentHtml.replace(tableRegex, (tableHtml) => {
    const cells = Array.from(tableHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((m) =>
      stripTagsToText(m[1]).replace(/\s+/g, ' ').trim()
    );
    if (cells.length < 2) return tableHtml;

    // Pattern 1: cells start with "A. ...", "B. ...", etc.
    const labeledCells: Array<{ letter: string; text: string }> = [];
    for (const cell of cells) {
      const m = cell.match(/^\(?([A-E])[\.\)\]]\s+(.+)$/i);
      if (m) {
        labeledCells.push({ letter: m[1].toUpperCase(), text: m[2].trim() });
      }
    }
    if (labeledCells.length >= 2 && labeledCells.some((c) => c.letter === 'A') && labeledCells.some((c) => c.letter === 'B')) {
      labeledCells.sort((a, b) => a.letter.charCodeAt(0) - b.letter.charCodeAt(0));
      tableOptions.push(...labeledCells.map((c) => c.text));
      return '';
    }

    // Pattern 2: row-based key/value option table `<tr><td>A</td><td>Teks</td></tr>`
    const rows = Array.from(tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi));
    const rowPairs: Array<{ letter: string; text: string }> = [];
    let isAllOptionRows = rows.length >= 2 && rows.length <= 5;
    for (const row of rows) {
      const rowCells = Array.from(row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((m) =>
        stripTagsToText(m[1]).replace(/\s+/g, ' ').trim()
      );
      if (rowCells.length !== 2) {
        isAllOptionRows = false;
        break;
      }
      const letterMatch = rowCells[0].match(/^\(?([A-E])[\.\)\]:]?$/i);
      if (!letterMatch || !rowCells[1]) {
        isAllOptionRows = false;
        break;
      }
      rowPairs.push({ letter: letterMatch[1].toUpperCase(), text: rowCells[1] });
    }
    if (isAllOptionRows && rowPairs.length >= 2) {
      rowPairs.sort((a, b) => a.letter.charCodeAt(0) - b.letter.charCodeAt(0));
      tableOptions.push(...rowPairs.map((c) => c.text));
      return '';
    }

    return tableHtml;
  });

  return { htmlWithoutOptionTables, tableOptions };
}

/**
 * Extracts multiple inline options placed on a single line like:
 * `A. 10   B. 20   C. 30   D. 40` or `a. satu b. dua c. tiga d. empat`.
 */
function extractInlineOptionsFromLine(line: string): string[] {
  const matches = Array.from(line.matchAll(/(?:^|\s)\(?([A-Ea-e])[\.\)]\s+/g));
  if (matches.length < 2) return [];

  // Require sequence starting cleanly with A and B (case-consistent)
  const firstLetter = matches[0][1].toUpperCase();
  const secondLetter = matches[1][1].toUpperCase();
  if (firstLetter !== 'A' || secondLetter !== 'B') return [];

  const extracted: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const startIdx = (matches[i].index ?? 0) + matches[i][0].length;
    const endIdx = i + 1 < matches.length ? (matches[i + 1].index ?? line.length) : line.length;
    const val = line.slice(startIdx, endIdx).trim();
    if (val) extracted.push(val);
  }
  return extracted.length >= 2 ? extracted : [];
}

function parseSingleQuestionSegment(
  segmentHtml: string,
  consolidated?: ConsolidatedAnswerInfo,
  sharedStimulusHtml?: string
): ParsedQuestionDraft | null {
  const plain = stripTagsToText(segmentHtml);
  if (!plain || plain.length < 3) return null;

  // Skip stray heading-only blocks (e.g. "PILIHAN GANDA", "SOAL URAIAN", "BAGIAN I")
  if (
    /^(?:bagian\s+[IVX\d]+|pilihan\s+ganda(?:\s+kompleks)?|soal\s+(?:essai|esai|uraian)|petunjuk\s+umum)\b/i.test(
      plain
    ) &&
    plain.length < 70 &&
    !segmentContainsOptions(segmentHtml, plain)
  ) {
    return null;
  }

  let explicitKeyRaw = consolidated?.rawKey || '';
  const keyMatch = plain.match(/(?:Kunci(?:\s+Jawaban)?|Jawaban)\s*[:=]\s*([^\n]+)/i);
  if (keyMatch) {
    explicitKeyRaw = keyMatch[1].trim();
  }

  let pembahasan = consolidated?.pembahasan;
  const pembMatch = plain.match(/(?:Pembahasan|Penjelasan)\s*[:=]\s*([^\n]+)/i);
  if (pembMatch) {
    pembahasan = pembMatch[1].trim();
  }

  let explicitType: QuestionType | null = null;
  if (/\b(?:PG\s*Kompleks|Pilihan\s*Ganda\s*Kompleks)\b/i.test(plain)) {
    explicitType = 'PG_KOMPLEKS';
  } else if (/\b(?:Benar\s*\/\s*Salah|Benar\s*-\s*Salah|True\s*\/\s*False)\b/i.test(plain)) {
    explicitType = 'BENAR_SALAH';
  } else if (/\b(?:Esai|Uraian)\b/i.test(plain)) {
    explicitType = 'ESAI';
  }

  // Strip leading question marker: "1. ", "(1) ", "1) ", "Soal 1: "
  let bodyHtml = segmentHtml.replace(
    /^(\s*(?:<(?:p|div|strong|b)[^>]*>\s*)*)(?:Soal\s+(?:No\.?\s*)?\d{1,3}[\.\):]?|\(?\d{1,3}[\.\)])\s+/i,
    '$1'
  );

  // Strip Kunci / Pembahasan / Tipe lines from body HTML
  bodyHtml = bodyHtml
    .replace(
      /<(?:p|div|li)[^>]*>\s*(?:Kunci(?:\s+Jawaban)?|Jawaban|Tipe|Pembahasan|Penjelasan)\s*[:=][^<]*<\/(?:p|div|li)>/gi,
      ''
    )
    .replace(/(?:Kunci(?:\s+Jawaban)?|Jawaban|Tipe|Pembahasan|Penjelasan)\s*[:=][^\n<]+/gi, '');

  // Extract options from layout tables first (if present)
  const { htmlWithoutOptionTables, tableOptions } = extractOptionsFromLayoutTables(bodyHtml);
  bodyHtml = htmlWithoutOptionTables;

  // Extract line-by-line options A-E (supporting lowercase a-e and inline multi-options)
  const plainForLines = stripTagsToText(bodyHtml);
  const lines = plainForLines
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const lineOptions: string[] = [];
  const lineOptionRegex = /^\(?([A-Ea-e])[\.\)\]]\s+(.+)$/;

  for (const line of lines) {
    const inlineOpts = extractInlineOptionsFromLine(line);
    if (inlineOpts.length >= 2) {
      lineOptions.push(...inlineOpts);
      continue;
    }
    const m = line.match(lineOptionRegex);
    if (m) {
      lineOptions.push(m[2].trim());
    }
  }

  const opsi = tableOptions.length >= 2 ? tableOptions : lineOptions;

  // Strip extracted line options cleanly from bodyHtml so options never duplicate in stem
  if (lineOptions.length >= 2 && tableOptions.length < 2) {
    bodyHtml = bodyHtml
      .replace(/<(p|div|li)[^>]*>\s*\(?[A-Ea-e][\.\)\]]\s+(?:(?!<\/?\1\b)[\s\S])*?<\/\1>/gi, '')
      .replace(/(?:^|\n|<br\s*\/?>)\s*\(?[A-Ea-e][\.\)\]]\s+[^\n<]+/gi, '');
  }

  // Classify QuestionType & keys
  const parsedKeyLetters = extractOptionLettersFromKey(explicitKeyRaw, opsi.length || 5);
  let tipe: QuestionType = explicitType || 'PG';
  if (!explicitType) {
    if (opsi.length === 0) {
      if (/^(?:benar|salah|true|false)$/i.test(explicitKeyRaw.trim())) {
        tipe = 'BENAR_SALAH';
      } else {
        tipe = 'ESAI';
      }
    } else if (parsedKeyLetters.length > 1) {
      tipe = 'PG_KOMPLEKS';
    } else {
      tipe = 'PG';
    }
  }

  let finalOpsi = opsi;
  let kunciJawaban: string[] = [];

  if (tipe === 'BENAR_SALAH') {
    finalOpsi = ['Benar', 'Salah'];
    kunciJawaban = /(?:salah|false)/i.test(explicitKeyRaw) ? ['Salah'] : ['Benar'];
  } else if (tipe === 'ESAI') {
    finalOpsi = [];
    kunciJawaban = explicitKeyRaw ? [explicitKeyRaw] : [];
  } else if (tipe === 'PG_KOMPLEKS') {
    kunciJawaban =
      parsedKeyLetters.length >= 2
        ? parsedKeyLetters
        : parsedKeyLetters.length === 1 && finalOpsi.length >= 2
          ? [parsedKeyLetters[0], parsedKeyLetters[0] === 'A' ? 'B' : 'A']
          : finalOpsi.length >= 2
            ? ['A', 'B']
            : ['A'];
  } else {
    kunciJawaban = parsedKeyLetters.length > 0 ? [parsedKeyLetters[0]] : ['A'];
  }

  const trimmedBody = bodyHtml
    .replace(/<(p|div)[^>]*>\s*(?:&nbsp;|\s|<br\s*\/?>)*<\/\1>/gi, '')
    .trim();
  const stemHtml = trimmedBody || `<p>${escapeHtml(plain)}</p>`;
  const combinedHtml = sharedStimulusHtml
    ? `${sharedStimulusHtml}\n${stemHtml}`
    : stemHtml;
  const finalPertanyaanHtml = /<[a-z][\s\S]*>/i.test(combinedHtml)
    ? combinedHtml
    : `<p>${escapeHtml(combinedHtml)}</p>`;

  const cognitive = detectCognitiveLevel(finalPertanyaanHtml, tipe);
  const kesulitan: 'Mudah' | 'Sedang' | 'Sulit' =
    cognitive === 'HOTS (C4-C6)' ? 'Sulit' : cognitive === 'MOTS (C3)' ? 'Sedang' : 'Mudah';

  return {
    tipe,
    pertanyaanHtml: finalPertanyaanHtml,
    opsi: finalOpsi,
    kunciJawaban,
    bobot: tipe === 'ESAI' ? 20 : tipe === 'PG_KOMPLEKS' ? 15 : 10,
    kesulitan,
    ...(pembahasan ? { pembahasan } : {}),
  };
}

function extractOptionLettersFromKey(rawKey: string, maxOptionCount: number): string[] {
  if (!rawKey) return [];
  const maxLetterIdx = Math.max(0, Math.min(4, maxOptionCount - 1));
  const allowedLetters = Array.from({ length: maxLetterIdx + 1 }, (_, i) => getOptionLetter(i));

  const cleaned = rawKey
    .replace(/^(?:opsi|pilihan|huruf)\s+/i, '')
    .trim();

  // Compact multi-key like "AC" or "ABD"
  const compact = cleaned.replace(/[\s,;/&|\-().]/g, '').toUpperCase();
  if (/^[A-E]{2,5}$/.test(compact) && !/\b(?:dan|and)\b/i.test(cleaned)) {
    const filtered = Array.from(new Set(compact.split('').filter((l) => allowedLetters.includes(l))));
    if (filtered.length > 0) return filtered;
  }

  const tokens = cleaned
    .split(/(?:[,;/&|]|\bdan\b|\band\b|\s+)+/i)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  const letters: string[] = [];
  for (const tok of tokens) {
    const m = tok.match(/^\(?([A-E])(?:[\.\)\]]|$)/);
    if (m && allowedLetters.includes(m[1])) {
      letters.push(m[1]);
    }
  }
  return Array.from(new Set(letters));
}
