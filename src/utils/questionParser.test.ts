import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRichHtmlQuestions } from './questionParser';

test('parseRichHtmlQuestions preserves Word tables and images while detecting question types', () => {
  const wordHtml = `
    <p>1. Perhatikan tabel hasil panen berikut!</p>
    <table><tr><th>Tahun</th><th>Ton</th></tr><tr><td>2025</td><td>120</td></tr></table>
    <p>A. 100 ton</p>
    <p>B. 120 ton</p>
    <p>C. 150 ton</p>
    <p>D. 200 ton</p>
    <p>Kunci: B</p>

    <p>2. Manakah yang termasuk rukun wudhu? (PG Kompleks)</p>
    <p>A. Membasuh wajah</p>
    <p>B. Berkumur-kumur</p>
    <p>C. Membasuh kedua tangan sampai siku</p>
    <p>D. Membaca doa setelah wudhu</p>
    <p>Kunci: A, C</p>

    <p>3. Shalat Subuh berjumlah 2 rakaat. (Benar/Salah)</p>
    <p>Kunci: Benar</p>

    <p>4. Jelaskan hikmah berpuasa di bulan Ramadhan! (Esai)</p>
  `;

  const parsed = parseRichHtmlQuestions(wordHtml);
  assert.equal(parsed.length, 4);

  assert.equal(parsed[0].tipe, 'PG');
  assert.ok(parsed[0].pertanyaanHtml.includes('<table>'));
  assert.equal(parsed[0].opsi.length, 4);
  assert.deepEqual(parsed[0].kunciJawaban, ['B']);

  assert.equal(parsed[1].tipe, 'PG_KOMPLEKS');
  assert.deepEqual(parsed[1].kunciJawaban, ['A', 'C']);

  assert.equal(parsed[2].tipe, 'BENAR_SALAH');
  assert.deepEqual(parsed[2].opsi, ['Benar', 'Salah']);
  assert.deepEqual(parsed[2].kunciJawaban, ['Benar']);

  assert.equal(parsed[3].tipe, 'ESAI');
});

test('parseRichHtmlQuestions preserves question body when options sit inside nested div containers', () => {
  const nestedHtml = `
    <div>
      <p>1. Berapakah hasil dari 6 x 7?</p>
      <div class="options-wrapper">
        <div>A. 36</div>
        <div>B. 42</div>
        <div>C. 48</div>
        <div>D. 54</div>
      </div>
      <p>Kunci: B</p>
    </div>
  `;

  const parsed = parseRichHtmlQuestions(nestedHtml);
  assert.equal(parsed.length, 1);
  assert.ok(parsed[0].pertanyaanHtml.includes('Berapakah hasil dari 6 x 7'));
  assert.deepEqual(parsed[0].opsi, ['36', '42', '48', '54']);
  assert.deepEqual(parsed[0].kunciJawaban, ['B']);
});
