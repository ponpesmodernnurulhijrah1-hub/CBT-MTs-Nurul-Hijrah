import type { ExamResult, ExamSchedule, TeacherAccount } from '../types/cbt';
import { getViolationHistoryForResult } from './violationTracker';
import { getTeacherSubjects } from './storeSyncUtils';

export async function exportExamResultsToExcel(
  results: ExamResult[],
  filenamePrefix = 'Rekap_Nilai_CBT_MTs_Nurul_Hijrah'
) {
  const XLSX = await import('xlsx');
  const rows = results.map((r, idx) => {
    const history = getViolationHistoryForResult(r);
    const historyText =
      history.length > 0
        ? history
            .map(
              (v) =>
                `#${v.strikeNumber} [${new Date(v.timestamp).toLocaleTimeString('id-ID')}] ${v.reason}`
            )
            .join(' | ')
        : '-';
    return {
      No: idx + 1,
      'Waktu Submit': new Date(r.waktuSubmit).toLocaleString('id-ID'),
      'No. Peserta': r.noPeserta || '-',
      'Nama Siswa': r.namaSiswa,
      Kelas: r.kelas,
      'Mata Pelajaran': r.mataPelajaran,
      'Judul Ujian': r.judulUjian,
      'Skor PG': r.skorPG,
      'Skor Esai': r.skorEsai,
      'Nilai Akhir': r.nilaiAkhir,
      Status: r.status === 'Selesai' ? 'Selesai (Normal)' : 'Pelanggaran',
      'Keluar Aplikasi': r.pelanggaranTab,
      'Peringatan Wajah': r.peringatanWajah ?? 0,
      'Riwayat Pelanggaran (Waktu & Alasan)': historyText,
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Hasil Ujian');
  const dateTag = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `${filenamePrefix}_${dateTag}.xlsx`);
}

function escapeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildExamResultsCsv(results: ExamResult[]): string {
  const headers = [
    'No',
    'Waktu Submit',
    'No Peserta',
    'Nama Siswa',
    'Kelas',
    'Mata Pelajaran',
    'Judul Ujian',
    'Skor PG',
    'Skor Esai',
    'Nilai Akhir',
    'Status',
    'Keluar Aplikasi',
    'Peringatan Wajah',
  ];
  const lines = [headers.map(escapeCsvCell).join(',')];
  results.forEach((r, idx) => {
    lines.push(
      [
        idx + 1,
        new Date(r.waktuSubmit).toLocaleString('id-ID'),
        r.noPeserta || '-',
        r.namaSiswa,
        r.kelas,
        r.mataPelajaran,
        r.judulUjian,
        r.skorPG,
        r.skorEsai,
        r.nilaiAkhir,
        r.status === 'Selesai' ? 'Selesai (Normal)' : 'Pelanggaran',
        r.pelanggaranTab,
        r.peringatanWajah ?? 0,
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  });
  return '\uFEFF' + lines.join('\r\n');
}

export function exportExamResultsToCSV(
  results: ExamResult[],
  filenamePrefix = 'Rekap_Nilai_CBT_MTs_Nurul_Hijrah'
) {
  if (typeof document === 'undefined') return;
  const csv = buildExamResultsCsv(results);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function printHtmlViaIframe(htmlDocument: string): void {
  if (typeof document === 'undefined') return;
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const cleanup = () => {
    window.setTimeout(() => {
      try {
        iframe.remove();
      } catch {
        // Ignore cleanup errors
      }
    }, 1000);
  };

  const doc = iframe.contentWindow?.document;
  if (!doc || !iframe.contentWindow) {
    cleanup();
    window.print();
    return;
  }

  doc.open();
  doc.write(htmlDocument);
  doc.close();

  const triggerPrint = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      window.print();
    } finally {
      cleanup();
    }
  };

  if (doc.readyState === 'complete') {
    window.setTimeout(triggerPrint, 80);
  } else {
    iframe.onload = () => window.setTimeout(triggerPrint, 80);
  }
}

export function buildStudentExamReceiptHtml(result: ExamResult, exam?: ExamSchedule): string {
  const answersRows = result.jawabanDetail
    .map((ans, idx) => {
      const q = exam?.questionsSnapshot.find((item) => item.id === ans.questionId);
      const qText = q
        ? q.pertanyaanHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
        : `Soal #${idx + 1}`;
      const ansText = ans.jawaban.length > 0 ? ans.jawaban.join(', ') : '(Tidak dijawab)';
      return `
        <tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td>${escapeHtml(ans.tipe)}</td>
          <td>${escapeHtml(qText)}</td>
          <td style="font-weight:bold;">${escapeHtml(ansText)}</td>
        </tr>`;
    })
    .join('');

  return `
    <!doctype html>
    <html lang="id">
    <head>
      <meta charset="utf-8" />
      <title>Bukti Jawaban Ujian - ${escapeHtml(result.namaSiswa)}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 28px; color: #0f172a; }
        .kop { text-align: center; border-bottom: 3px double #065f46; padding-bottom: 12px; margin-bottom: 18px; }
        .kop h1 { margin: 0; font-size: 18px; color: #065f46; }
        .kop p { margin: 4px 0 0; font-size: 12px; color: #475569; }
        .meta { display: table; width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; margin-bottom: 16px; font-size: 12px; }
        .meta-row { display: table-row; }
        .meta-cell { display: table-cell; padding: 4px 8px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #cbd5e1; padding: 7px 8px; vertical-align: top; }
        th { background: #ecfdf5; color: #065f46; text-align: left; }
        .footer { margin-top: 20px; font-size: 11px; color: #64748b; text-align: right; }
      </style>
    </head>
    <body>
      <div class="kop">
        <h1>BUKTI JAWABAN UJIAN - CBT MTs NURUL HIJRAH</h1>
        <p>Dokumen Sah Pengumpulan Jawaban Ujian Digital</p>
      </div>
      <div class="meta">
        <div class="meta-row"><div class="meta-cell"><strong>Nama Lengkap:</strong> ${escapeHtml(result.namaSiswa)}</div><div class="meta-cell"><strong>No. Peserta:</strong> ${escapeHtml(result.noPeserta || '-')}</div></div>
        <div class="meta-row"><div class="meta-cell"><strong>Kelas:</strong> ${escapeHtml(result.kelas)}</div><div class="meta-cell"><strong>Mata Pelajaran:</strong> ${escapeHtml(result.mataPelajaran)}</div></div>
        <div class="meta-row"><div class="meta-cell"><strong>Ujian:</strong> ${escapeHtml(result.judulUjian)}</div><div class="meta-cell"><strong>Status:</strong> ${result.status === 'Selesai' ? 'Selesai (Normal)' : 'Pelanggaran'}</div></div>
        <div class="meta-row"><div class="meta-cell"><strong>Waktu Kirim:</strong> ${escapeHtml(new Date(result.waktuSubmit).toLocaleString('id-ID'))}</div><div class="meta-cell"><strong>Skor Objektif:</strong> ${result.skorPG}</div></div>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width:42px;text-align:center;">No</th>
            <th style="width:110px;">Tipe</th>
            <th>Ringkasan Soal</th>
            <th style="width:180px;">Jawaban Terkirim</th>
          </tr>
        </thead>
        <tbody>${answersRows}</tbody>
      </table>
      <div class="footer">ID Hasil: ${escapeHtml(result.id)} &middot; Dicetak pada ${escapeHtml(new Date().toLocaleString('id-ID'))}</div>
    </body>
    </html>
  `;
}

export function printStudentExamReceipt(result: ExamResult, exam?: ExamSchedule): void {
  printHtmlViaIframe(buildStudentExamReceiptHtml(result, exam));
}

export function exportExamResultsToPDFPrint(results: ExamResult[], title = 'Rekap Nilai Ujian CBT') {
  const rowsHtml = results
    .map(
      (r, idx) => `
      <tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td>${escapeHtml(r.noPeserta || '-')}</td>
        <td>${escapeHtml(r.namaSiswa)}</td>
        <td style="text-align:center;">${escapeHtml(r.kelas)}</td>
        <td>${escapeHtml(r.mataPelajaran)}</td>
        <td>${escapeHtml(r.judulUjian)}</td>
        <td style="text-align:center;">${r.skorPG}</td>
        <td style="text-align:center;">${r.skorEsai}</td>
        <td style="text-align:center;font-weight:bold;">${r.nilaiAkhir}</td>
        <td style="text-align:center;color:${r.status === 'Selesai' ? '#047857' : '#b91c1c'};font-weight:bold;">
          ${r.status === 'Selesai' ? 'Selesai (Normal)' : 'Pelanggaran'}
        </td>
      </tr>`
    )
    .join('');

  printHtmlViaIframe(`
    <!doctype html>
    <html lang="id">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(title)} - MTs Nurul Hijrah</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 28px; color: #0f172a; }
        .kop { text-align: center; border-bottom: 3px double #065f46; padding-bottom: 12px; margin-bottom: 18px; }
        .kop h1 { margin: 0; font-size: 20px; color: #065f46; }
        .kop p { margin: 4px 0 0; font-size: 12px; color: #475569; }
        h2 { font-size: 15px; margin: 0 0 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #cbd5e1; padding: 7px 8px; }
        th { background: #ecfdf5; color: #065f46; }
        .footer { margin-top: 24px; font-size: 11px; color: #64748b; text-align: right; }
      </style>
    </head>
    <body>
      <div class="kop">
        <h1>MTs NURUL HIJRAH</h1>
        <p>Sistem Evaluasi Belajar Berbasis Komputer (CBT MTs Nurul Hijrah)</p>
      </div>
      <h2>${escapeHtml(title)}</h2>
      <table>
        <thead>
          <tr>
            <th>No</th>
            <th>No. Peserta</th>
            <th>Nama Siswa</th>
            <th>Kelas</th>
            <th>Mata Pelajaran</th>
            <th>Ujian</th>
            <th>PG</th>
            <th>Esai</th>
            <th>Nilai Akhir</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="footer">Dicetak pada: ${new Date().toLocaleString('id-ID')}</div>
    </body>
    </html>
  `);
}

/**
 * Mencetak Data Guru dengan kebijakan privasi ketat:
 * HANYA memuat Nama Lengkap Guru dan Mata Pelajaran yang diampu (tanpa Username/Password).
 */
export function printPrivacySafeTeacherDirectory(teachers: TeacherAccount[]) {
  const rowsHtml = teachers
    .map(
      (t, i) => `
      <tr>
        <td style="text-align:center;">${i + 1}</td>
        <td>${escapeHtml(t.nama)}</td>
        <td>${escapeHtml(getTeacherSubjects(t).join(', '))}</td>
        <td style="text-align:center;">${t.aktif ? 'Aktif' : 'Nonaktif'}</td>
      </tr>`
    )
    .join('');

  printHtmlViaIframe(`
    <!doctype html>
    <html lang="id">
    <head>
      <meta charset="utf-8" />
      <title>Daftar Guru Pengampu - MTs Nurul Hijrah</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 32px; color: #0f172a; }
        .kop { text-align: center; border-bottom: 3px double #065f46; padding-bottom: 12px; margin-bottom: 20px; }
        .kop h1 { margin: 0; font-size: 20px; color: #065f46; letter-spacing: 0.5px; }
        .kop p { margin: 4px 0 0; font-size: 12px; color: #475569; }
        h2 { font-size: 15px; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { border: 1px solid #94a3b8; padding: 9px 10px; }
        th { background: #ecfdf5; color: #065f46; text-align: left; }
        .note { margin-top: 16px; font-size: 11px; color: #475569; }
      </style>
    </head>
    <body>
      <div class="kop">
        <h1>MTs NURUL HIJRAH</h1>
        <p>Daftar Resmi Guru Pengampu Mata Pelajaran · CBT MTs Nurul Hijrah</p>
      </div>
      <h2>Data Guru Mata Pelajaran</h2>
      <table>
        <thead>
          <tr>
            <th style="width:48px;text-align:center;">No</th>
            <th>Nama Lengkap Guru</th>
            <th>Mata Pelajaran yang Diampu</th>
            <th style="width:100px;text-align:center;">Status</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p class="note">Dokumen ini dicetak tanpa menyertakan kredensial rahasia (Username & Password) sesuai kebijakan keamanan privasi akun madrasah.</p>
    </body>
    </html>
  `);
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
