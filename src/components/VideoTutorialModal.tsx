import React, { useEffect, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  X,
  MousePointer2,
  Printer,
  Volume2,
} from 'lucide-react';
import { printHtmlViaIframe } from '../utils/exportHelpers';

interface VideoTutorialModalProps {
  open: boolean;
  onClose: () => void;
}

const TOTAL_SECONDS = 180; // 3 minutes

const CHAPTERS = [
  {
    id: 1,
    start: 0,
    end: 45,
    label: 'Babak 1 (00:00 - 00:45)',
    title: 'Cara Login Guru & Mengenal Menu Bank Soal',
    subtitle:
      'Masuk melalui tab Portal Guru menggunakan akun Anda, lalu pilih menu Data Modul / Bank Soal untuk melihat daftar soal mata pelajaran.',
    activeMenu: 'Bank Soal',
    cursorX: 22,
    cursorY: 34,
    demoHeading: 'Data Modul / Bank Soal — Matematika',
    demoAction: '+ Tambah Soal Baru',
  },
  {
    id: 2,
    start: 45,
    end: 90,
    label: 'Babak 2 (00:45 - 01:30)',
    title: 'Cara Mengetik Soal PG, PG Kompleks & Esai',
    subtitle:
      'Pilih tipe soal (PG Biasa, PG Kompleks dengan banyak kunci, Benar/Salah, atau Esai), isi opsi jawaban, lalu simpan ke Bank Soal.',
    activeMenu: 'Bank Soal',
    cursorX: 56,
    cursorY: 52,
    demoHeading: 'Editor Soal Interaktif (PG / Kompleks / Esai)',
    demoAction: 'Simpan ke Bank Soal',
  },
  {
    id: 3,
    start: 90,
    end: 135,
    label: 'Babak 3 (01:30 - 02:15)',
    title: 'Import Soal dari Microsoft Word (Tabel & Gambar Utuh)',
    subtitle:
      'Buka menu Import Soal AI, unggah file .docx atau tempel dari Word. Tabel, kotak bacaan, dan gambar dipertahankan otomatis sebelum disimpan.',
    activeMenu: 'Import Soal AI',
    cursorX: 62,
    cursorY: 64,
    demoHeading: 'Smart AI Question Parser (.docx / .pdf / Paste Word)',
    demoAction: 'Ekstrak dengan Smart AI Parser',
  },
  {
    id: 4,
    start: 135,
    end: 180,
    label: 'Babak 4 (02:15 - 03:00)',
    title: 'Menerbitkan Jadwal Ujian & Menyalin Token Siswa',
    subtitle:
      'Masuk ke Data Tes / Jadwal Ujian, tentukan kelas VII/VIII/IX dan durasi, klik Terbitkan, lalu salin Token 6 karakter untuk dibagikan ke siswa.',
    activeMenu: 'Jadwal Ujian',
    cursorX: 74,
    cursorY: 46,
    demoHeading: 'Data Tes / Jadwal Ujian — Snapshot Aman',
    demoAction: 'Salin Token: NH2026',
  },
];

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function printTeacherGuidebook() {
  printHtmlViaIframe(`
    <!doctype html>
    <html lang="id">
    <head>
      <meta charset="utf-8" />
      <title>Buku Panduan Guru - CBT MTs Nurul Hijrah</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 36px; line-height: 1.6; color: #0f172a; }
        h1 { color: #065f46; border-bottom: 2px solid #065f46; padding-bottom: 8px; }
        h2 { color: #047857; margin-top: 22px; font-size: 16px; }
        .box { background: #ecfdf5; border: 1px solid #a7f3d0; padding: 12px 16px; border-radius: 8px; margin-top: 12px; }
      </style>
    </head>
    <body>
      <h1>Buku Panduan Guru — CBT MTs Nurul Hijrah</h1>
      <p>Panduan ringkas penyusunan soal, import dokumen Word/PDF, penerbitan jadwal ujian, dan pemantauan live.</p>
      <h2>1. Mengenal Bank Soal</h2>
      <p>Pilih menu <strong>Data Modul / Bank Soal</strong>. Gunakan tombol <strong>Tambah Soal Baru</strong> untuk input manual atau tombol merah <strong>Kosongkan Bank Soal</strong> saat ingin menyusun ulang soal semester baru (jadwal ujian yang sudah terbit tetap aman karena menyimpan snapshot soal).</p>
      <h2>2. Jenis Soal yang Didukung</h2>
      <ul>
        <li><strong>Pilihan Ganda (A–E):</strong> Satu jawaban benar, koreksi otomatis.</li>
        <li><strong>Pilihan Ganda Kompleks:</strong> Lebih dari satu jawaban benar.</li>
        <li><strong>Benar / Salah:</strong> Pernyataan dikotomis.</li>
        <li><strong>Esai / Uraian:</strong> Dikoreksi guru pada menu Hasil Tes &amp; Koreksi Esai.</li>
      </ul>
      <h2>3. Import Soal Pintar dari Word (.docx) &amp; PDF</h2>
      <p>Buka menu <strong>Import Soal AI</strong>, tarik file <code>.docx</code> atau tempel langsung dari Microsoft Word. Struktur tabel dan gambar tetap utuh. Klik <strong>Ekstrak dengan Smart AI</strong> atau <strong>Parser Lokal</strong>, lalu simpan ke Bank Soal.</p>
      <h2>4. Menerbitkan Jadwal &amp; Token Ujian</h2>
      <p>Buka <strong>Data Tes / Jadwal Ujian</strong>, pilih kelas target, durasi, serta soal yang diujikan. Klik <strong>Terbitkan Jadwal Ujian</strong> dan bagikan <strong>Token Ujian</strong> kepada siswa.</p>
      <div class="box"><strong>Tips Live Monitoring:</strong> Semua suara siswa otomatis dalam mode Bisu (Mute). Klik <em>Unmute</em> pada salah satu kartu siswa untuk mendengar audio mikrofon siswa tersebut secara jernih.</div>
    </body>
    </html>
  `);
}

export const VideoTutorialModal: React.FC<VideoTutorialModalProps> = ({ open, onClose }) => {
  const [playing, setPlaying] = useState(true);
  const [currentSec, setCurrentSec] = useState(0);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (!open || !playing) return;
    const id = window.setInterval(() => {
      setCurrentSec((prev) => {
        const next = prev + 0.5 * speed;
        if (next >= TOTAL_SECONDS) {
          setPlaying(false);
          return TOTAL_SECONDS;
        }
        return next;
      });
    }, 500);
    return () => window.clearInterval(id);
  }, [open, playing, speed]);

  if (!open) return null;

  const currentChapter =
    CHAPTERS.find((c) => currentSec >= c.start && currentSec < c.end) ||
    CHAPTERS[CHAPTERS.length - 1];

  // Smooth animated cursor oscillation around chapter target
  const phase = (currentSec % 6) / 6;
  const cursorLeft = currentChapter.cursorX + Math.sin(phase * Math.PI * 2) * 8;
  const cursorTop = currentChapter.cursorY + Math.cos(phase * Math.PI * 2) * 6;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="video-tutorial-title"
    >
      <div className="glass-dark w-full max-w-3xl overflow-hidden rounded-3xl text-white shadow-2xl panel-enter">
        <div className="flex items-center justify-between border-b border-white/15 px-5 py-3.5">
          <div>
            <h2 id="video-tutorial-title" className="font-display text-base font-bold">
              Video Tutorial Interaktif Guru (3 Menit)
            </h2>
            <p className="text-xs text-slate-300">{currentChapter.label} — {currentChapter.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup Video Tutorial"
            className="btn-press rounded-xl p-1.5 text-slate-300 hover:bg-white/15 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Simulated Interactive Screen Stage */}
        <div className="relative aspect-video w-full bg-slate-950 p-4 sm:p-6">
          <div className="flex h-full w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-100 text-slate-900 shadow-inner">
            {/* Simulated Sidebar */}
            <div className="hidden sm:flex w-44 flex-col bg-slate-900 p-3 text-white">
              <div className="text-xs font-bold text-emerald-400 mb-4">CBT MTs Nurul Hijrah</div>
              {['Dashboard', 'Bank Soal', 'Import Soal AI', 'Jadwal Ujian', 'Live Monitoring'].map(
                (item) => (
                  <div
                    key={item}
                    className={`rounded-md px-2.5 py-1.5 text-xs mb-1 ${
                      currentChapter.activeMenu === item
                        ? 'bg-emerald-700 font-semibold text-white'
                        : 'text-slate-400'
                    }`}
                  >
                    {item}
                  </div>
                )
              )}
            </div>

            {/* Simulated Main Viewport */}
            <div className="flex-1 p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="text-xs sm:text-sm font-bold text-slate-800">
                    {currentChapter.demoHeading}
                  </span>
                  <span className="rounded bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white">
                    {currentChapter.demoAction}
                  </span>
                </div>

                {/* Chapter-specific visual wireframe */}
                <div className="mt-3 space-y-2">
                  {currentChapter.id === 1 && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded border border-slate-300 bg-white p-2.5 text-[11px]">
                        <strong>Soal #1 · Pilihan Ganda</strong>
                        <p className="mt-1 text-slate-500">Status: Tersimpan di Bank Soal</p>
                      </div>
                      <div className="rounded border border-slate-300 bg-white p-2.5 text-[11px]">
                        <strong>Soal #2 · PG Kompleks</strong>
                        <p className="mt-1 text-slate-500">Status: Tersimpan di Bank Soal</p>
                      </div>
                    </div>
                  )}
                  {currentChapter.id === 2 && (
                    <div className="rounded border border-emerald-300 bg-white p-3 text-[11px] space-y-1.5">
                      <div className="font-bold text-emerald-800">Tipe: Pilihan Ganda Kompleks</div>
                      <div className="rounded bg-slate-100 p-2">Pertanyaan soal diketik di sini...</div>
                      <div className="flex gap-2">
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-900 font-semibold">[✓] Opsi A</span>
                        <span className="rounded bg-slate-100 px-2 py-0.5">[ ] Opsi B</span>
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-900 font-semibold">[✓] Opsi C</span>
                      </div>
                    </div>
                  )}
                  {currentChapter.id === 3 && (
                    <div className="rounded border border-slate-300 bg-white p-3 text-[11px] space-y-2">
                      <div className="font-bold text-slate-800">File Word (.docx) Terdeteksi: Soal_PAS.docx</div>
                      <table className="w-full border-collapse border border-slate-400 text-[10px]">
                        <thead>
                          <tr className="bg-slate-200">
                            <th className="border border-slate-400 px-2 py-1">Tabel Word</th>
                            <th className="border border-slate-400 px-2 py-1">Nilai</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="border border-slate-400 px-2 py-1">Data Utuh</td>
                            <td className="border border-slate-400 px-2 py-1">100%</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                  {currentChapter.id === 4 && (
                    <div className="rounded border border-emerald-400 bg-emerald-50 p-3 text-[11px] flex items-center justify-between">
                      <div>
                        <div className="font-bold text-emerald-950">PAS Matematika — Kelas VII & VIII</div>
                        <div className="text-emerald-800">Snapshot Soal Tersimpan · Siap Dibagikan</div>
                      </div>
                      <div className="rounded bg-white border border-emerald-300 px-3 py-1 font-mono-tabular font-bold text-emerald-800">
                        TOKEN: NH2026
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Animated Subtitle Bar */}
              <div className="rounded-lg bg-slate-900/90 px-3.5 py-2 text-center text-xs text-white">
                {currentChapter.subtitle}
              </div>
            </div>
          </div>

          {/* Moving Animated Cursor */}
          <div
            className="pointer-events-none absolute transition-all duration-300"
            style={{ left: `${cursorLeft}%`, top: `${cursorTop}%` }}
          >
            <MousePointer2 className="h-6 w-6 fill-emerald-500 text-white drop-shadow-lg" />
          </div>
        </div>

        {/* YouTube-style Controls */}
        <div className="space-y-3 border-t border-white/15 bg-slate-950/35 px-5 py-3.5">
          {/* Chapter Jump Pills */}
          <div className="flex flex-wrap gap-1.5">
            {CHAPTERS.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => setCurrentSec(ch.start)}
                className={`btn-press rounded-xl px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  currentChapter.id === ch.id
                    ? 'bg-emerald-700 text-white shadow-sm'
                    : 'bg-white/10 text-slate-200 hover:bg-white/20'
                }`}
              >
                {ch.label}
              </button>
            ))}
          </div>

          {/* Scrubber */}
          <input
            type="range"
            min={0}
            max={TOTAL_SECONDS}
            value={currentSec}
            onChange={(e) => setCurrentSec(Number(e.target.value))}
            aria-label="Durasi Video Tutorial"
            className="w-full accent-emerald-500 cursor-pointer"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-800"
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                <span>{playing ? 'Jeda' : 'Putar'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCurrentSec(0);
                  setPlaying(true);
                }}
                aria-label="Ulangi dari awal"
                className="btn-press rounded-xl bg-white/10 p-1.5 text-slate-200 hover:bg-white/20"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <span className="ml-1 font-mono-tabular text-xs text-slate-300">
                {formatTime(currentSec)} / {formatTime(TOTAL_SECONDS)}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Volume2 className="h-4 w-4 text-slate-400" />
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                aria-label="Kecepatan Pemutaran"
                className="rounded-xl bg-white/10 px-2.5 py-1 text-xs text-white border border-white/20"
              >
                <option value={1} className="text-slate-900">1x</option>
                <option value={1.25} className="text-slate-900">1.25x</option>
                <option value={1.5} className="text-slate-900">1.5x</option>
                <option value={2} className="text-slate-900">2x</option>
              </select>

              <button
                type="button"
                onClick={printTeacherGuidebook}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Unduh Buku Panduan Guru (PDF / Cetak)</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
