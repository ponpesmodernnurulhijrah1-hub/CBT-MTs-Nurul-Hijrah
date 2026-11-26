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

test('parseRichHtmlQuestions handles Word <ol>/<li> lists, inner numbered statements, option tables, inline options, shared stimuli, and consolidated bottom answer keys', () => {
  const complexHtml = `
    <p><strong>Bacaan untuk soal nomor 1 sampai 2:</strong></p>
    <p>Air merupakan kebutuhan pokok seluruh makhluk hidup di bumi.</p>

    <ol>
      <li>
        Apa fungsi utama air bagi tumbuhan dalam teks di atas?
        <ol type="a">
          <li>Sumber energi listrik</li>
          <li>Bahan proses fotosintesis</li>
          <li>Pembentuk batu karang</li>
          <li>Penghenti pertumbuhan akar</li>
        </ol>
      </li>
    </ol>

    <p>(2) Perhatikan pernyataan berikut:</p>
    <p>1. Menghemat penggunaan air bersih.</p>
    <p>2. Membuang limbah plastik ke sungai.</p>
    <p>3. Menanam pohon di daerah resapan.</p>
    <p>Tindakan yang benar adalah...</p>
    <table>
      <tr><td>A. 1 dan 2</td><td>B. 2 dan 3</td></tr>
      <tr><td>C. 1 dan 3</td><td>D. Semua benar</td></tr>
    </table>

    <p>3. Hasil dari 8 x 7 adalah...</p>
    <p>a. 54   b. 56   c. 63   d. 64</p>

    <p><strong>KUNCI JAWABAN</strong></p>
    <p>1. B (Air digunakan dalam proses fotosintesis)</p>
    <p>2. C</p>
    <p>3. B</p>
  `;

  const parsed = parseRichHtmlQuestions(complexHtml);
  assert.equal(parsed.length, 3);

  // Q1: Shared stimulus + nested <ol type="a"> options + consolidated key + pembahasan
  assert.ok(parsed[0].pertanyaanHtml.includes('kebutuhan pokok'));
  assert.equal(parsed[0].opsi.length, 4);
  assert.equal(parsed[0].opsi[1], 'Bahan proses fotosintesis');
  assert.deepEqual(parsed[0].kunciJawaban, ['B']);
  assert.equal(parsed[0].pembahasan, 'Air digunakan dalam proses fotosintesis');

  // Q2: Shared stimulus + inner numbered statements merged + 2-column option layout table extracted
  assert.ok(parsed[1].pertanyaanHtml.includes('kebutuhan pokok'));
  assert.ok(parsed[1].pertanyaanHtml.includes('Menanam pohon di daerah resapan'));
  assert.ok(!parsed[1].pertanyaanHtml.includes('<table>'));
  assert.deepEqual(parsed[1].opsi, ['1 dan 2', '2 dan 3', '1 dan 3', 'Semua benar']);
  assert.deepEqual(parsed[1].kunciJawaban, ['C']);

  // Q3: Inline lowercase options + consolidated key
  assert.deepEqual(parsed[2].opsi, ['54', '56', '63', '64']);
  assert.deepEqual(parsed[2].kunciJawaban, ['B']);
});
