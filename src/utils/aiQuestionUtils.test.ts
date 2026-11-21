import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenizeDataImages,
  restoreDataImages,
  stripHtmlBoilerplateForAi,
  parseGeminiRetryDelayMs,
  chunkHtmlForAi,
  extractBalancedJsonArray,
  normalizeAiQuestions,
} from './aiQuestionUtils';

test('tokenizeDataImages & restoreDataImages preserve embedded Word base64 images cleanly', () => {
  const html =
    '<p>1. Perhatikan gambar berikut:</p><p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA" alt="diagram"></p><p>A. Satu</p>';

  const { cleanedHtml, assets } = tokenizeDataImages(html);
  assert.ok(cleanedHtml.includes('__CBT_IMG_0__'));
  assert.ok(!cleanedHtml.includes('iVBORw0KGgo'));
  assert.equal(Object.keys(assets).length, 1);

  const restored = restoreDataImages(cleanedHtml, assets);
  assert.equal(restored, html);
});

test('stripHtmlBoilerplateForAi removes Word bloat while keeping tables, formatting, and image placeholders', () => {
  const bloated =
    '<!--StartFragment--><p class="MsoNormal" style="margin-bottom:0cm;line-height:normal"><span lang="EN-US" style="font-size:12pt">1. Nilai dari <b>x<sup>2</sup></b> adalah...</span><o:p></o:p></p>' +
    '<table class="MsoTableGrid" border="1" style="border-collapse:collapse"><tr><td width="100" colspan="2">Data <img src="__CBT_IMG_0__" alt="grafik"></td></tr></table><!--EndFragment-->';

  const clean = stripHtmlBoilerplateForAi(bloated);
  assert.ok(!clean.includes('MsoNormal'));
  assert.ok(!clean.includes('style='));
  assert.ok(!clean.includes('<span'));
  assert.ok(!clean.includes('<o:p>'));
  assert.ok(clean.includes('<b>x<sup>2</sup></b>'));
  assert.ok(clean.includes('<table><tr><td colspan="2">Data <img src="__CBT_IMG_0__" alt="grafik"></td></tr></table>'));
});

test('parseGeminiRetryDelayMs extracts long daily quota backoff and transient backoff', () => {
  const quotaErr = new Error(
    '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"retryDelay":"61971s"}]}}'
  );
  const dailyDelay = parseGeminiRetryDelayMs(quotaErr);
  assert.equal(dailyDelay, 12 * 60 * 60 * 1000);

  const perDayTextErr = new Error('GenerateRequestsPerDayPerProjectPerModel-FreeTier exceeded');
  assert.equal(parseGeminiRetryDelayMs(perDayTextErr), 60 * 60 * 1000);

  const transientErr = new Error('503 UNAVAILABLE');
  assert.equal(parseGeminiRetryDelayMs(transientErr), 60_000);
});

test('chunkHtmlForAi splits large documents without breaking inside HTML tables', () => {
  const bigTable = `<table><tr><td>${'X'.repeat(500)}</td></tr></table>`;
  const doc = Array.from({ length: 12 }, (_, i) => `<p>${i + 1}. Soal nomor ${i + 1}</p>\n${bigTable}`).join('\n');

  const chunks = chunkHtmlForAi(doc, 1600);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    const openTables = (chunk.match(/<table/gi) || []).length;
    const closeTables = (chunk.match(/<\/table>/gi) || []).length;
    assert.equal(openTables, closeTables, 'Table tags must never be split across chunks');
  }
});

test('extractBalancedJsonArray handles fenced markdown and wrapped objects', () => {
  const fenced = '```json\n[{"tipe":"PG","pertanyaanHtml":"<p>Tes</p>"}]\n```';
  assert.equal(extractBalancedJsonArray(fenced).length, 1);

  const wrapped = '{"questions":[{"tipe":"ESAI","pertanyaanHtml":"<p>Jelaskan!</p>"}]}';
  assert.equal(extractBalancedJsonArray(wrapped).length, 1);
});

test('normalizeAiQuestions strips option prefixes, normalizes keys, and restores images', () => {
  const raw = [
    {
      tipe: 'Pilihan Ganda',
      pertanyaanHtml: '<p>Amati grafik <img src="__CBT_IMG_0__"></p>',
      opsi: ['A. 10', 'B. 20', 'C. 30', 'D. 40'],
      kunciJawaban: ['B. 20'],
      kesulitan: 'Sedang',
      pembahasan: 'Nilai pada sumbu Y menunjukkan 20.',
    },
    {
      tipe: 'PG Kompleks',
      pertanyaanHtml: '<p>Pilih bilangan genap</p>',
      opsi: ['A. 2', 'B. 3', 'C. 4', 'D. 5'],
      kunciJawaban: 'A, C',
    },
    {
      tipe: 'Benar/Salah',
      pertanyaanHtml: 'Air mendidih pada 100C.',
      opsi: [],
      kunciJawaban: ['Benar'],
    },
  ];

  const normalized = normalizeAiQuestions(raw, {
    __CBT_IMG_0__: 'data:image/png;base64,ABC123',
  });

  assert.equal(normalized.length, 3);
  assert.equal(normalized[0].tipe, 'PG');
  assert.ok(normalized[0].pertanyaanHtml.includes('data:image/png;base64,ABC123'));
  assert.deepEqual(normalized[0].opsi, ['10', '20', '30', '40']);
  assert.deepEqual(normalized[0].kunciJawaban, ['B']);
  assert.equal(normalized[0].kesulitan, 'Sedang');
  assert.equal(normalized[0].pembahasan, 'Nilai pada sumbu Y menunjukkan 20.');

  assert.equal(normalized[1].tipe, 'PG_KOMPLEKS');
  assert.deepEqual(normalized[1].kunciJawaban, ['A', 'C']);

  assert.equal(normalized[2].tipe, 'BENAR_SALAH');
  assert.deepEqual(normalized[2].opsi, ['Benar', 'Salah']);
  assert.deepEqual(normalized[2].kunciJawaban, ['Benar']);
});
