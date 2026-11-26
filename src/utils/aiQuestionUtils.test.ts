import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenizeDataImages,
  restoreDataImages,
  stripHtmlBoilerplateForAi,
  parseGeminiRetryDelayMs,
  chunkHtmlForAi,
  extractBalancedJsonArray,
  extractBalancedJsonObject,
  chunkArray,
  safeParseResponseJson,
  formatClientFetchError,
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

test('extractBalancedJsonObject safely parses fenced or noisy JSON object responses', () => {
  const noisy = 'Berikut hasil:\n```json\n{"suggestedPercent": 85, "reason": "Tepat sekali."}\n```\nSemoga membantu.';
  const obj = extractBalancedJsonObject(noisy);
  assert.deepEqual(obj, { suggestedPercent: 85, reason: 'Tepat sekali.' });
  assert.equal(extractBalancedJsonObject('invalid text'), null);
});

test('chunkArray & safeParseResponseJson handle batching and non-JSON proxy errors gracefully', async () => {
  assert.deepEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);

  const htmlErrorResponse = new Response('<html>504 Gateway Time-out</html>', {
    status: 504,
    headers: { 'Content-Type': 'text/html' },
  });
  const parsedHtml = await safeParseResponseJson<{ error?: string }>(htmlErrorResponse);
  assert.equal(parsedHtml.data, null);
  assert.ok(parsedHtml.rawText.includes('504'));

  const msg = formatClientFetchError(null, 413);
  assert.ok(msg.toLowerCase().includes('terlalu besar'));
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

test('extractBalancedJsonArray salvages complete objects from truncated JSON array responses', () => {
  const truncated = `[
    {"tipe":"PG","pertanyaanHtml":"<p>1 + 1 = ?</p>","opsi":["1","2","3","4"],"kunciJawaban":["B"]},
    {"tipe":"ESAI","pertanyaanHtml":"<p>Jelaskan mad thabi'i!</p>","opsi":[],"kunciJawaban":["Panjang 2 harakat"]},
    {"tipe":"PG","pertanyaanHtml":"<p>Potongan tidak selesai`;

  const salvaged = extractBalancedJsonArray(truncated);
  assert.equal(salvaged.length, 2);
  const normalized = normalizeAiQuestions(salvaged);
  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized[0].kunciJawaban, ['B']);
  assert.equal(normalized[1].tipe, 'ESAI');
});

test('normalizeAiQuestions restores images inside options, handles dan/compact keys, and clamps invalid key letters', () => {
  const raw = [
    {
      tipe: 'PG',
      pertanyaanHtml: '<p>Pilih grafik sinus:</p>',
      opsi: ['(A) <img src="__CBT_IMG_0__">', 'B. Salah 1', 'C. Salah 2', 'D. Salah 3'],
      kunciJawaban: ['E'], // out of range for 4 options -> should clamp safely to ['A']
    },
    {
      tipe: 'PG_KOMPLEKS',
      pertanyaanHtml: '<p>Pilih 2 bilangan prima:</p>',
      opsi: ['2', '4', '5', '9'],
      kunciJawaban: 'A dan C',
    },
  ];

  const normalized = normalizeAiQuestions(raw, {
    __CBT_IMG_0__: 'data:image/png;base64,GRAPH1',
  });
  assert.equal(normalized.length, 2);
  assert.ok(normalized[0].opsi[0].includes('data:image/png;base64,GRAPH1'));
  assert.ok(!normalized[0].opsi[0].startsWith('(A)'));
  assert.deepEqual(normalized[0].kunciJawaban, ['A']);
  assert.deepEqual(normalized[1].kunciJawaban, ['A', 'C']);
});
