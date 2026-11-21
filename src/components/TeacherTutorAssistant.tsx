import React, { useState } from 'react';
import {
  GraduationCap,
  X,
  Send,
  Compass,
  ArrowRight,
  Sparkles,
} from 'lucide-react';

export type TeacherTab = 'analitik' | 'bank-soal' | 'import' | 'jadwal' | 'monitoring' | 'hasil';

interface TeacherTutorAssistantProps {
  onNavigateTab: (tab: TeacherTab) => void;
  walkthroughStep: number | null;
  onStartWalkthrough: () => void;
  onNextWalkthrough: () => void;
  onCloseWalkthrough: () => void;
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}

const QUICK_PROMPTS: Array<{ q: string; fallbackAnswer: string }> = [
  {
    q: 'Bagaimana cara membuat soal Pilihan Ganda?',
    fallbackAnswer:
      '1. Buka menu "Data Modul / Bank Soal".\n2. Pilih Mata Pelajaran Anda lalu klik tombol "Tambah Soal Baru".\n3. Pilih tipe "Pilihan Ganda Biasa (A-E)", ketik pertanyaan (bisa tempel tabel/gambar dari Word).\n4. Isi pilihan A–D/E, klik radio button kunci jawaban yang benar, lalu klik "Simpan ke Bank Soal".',
  },
  {
    q: 'Bedanya Pilihan Ganda Kompleks & Esai apa?',
    fallbackAnswer:
      '• Pilihan Ganda Kompleks: Siswa dapat mencentang LEBIH DARI 1 jawaban benar (misal A dan C). Sistem mengoreksi otomatis!\n• Esai / Uraian: Siswa mengetik jawaban uraian bebas. Guru dapat memeriksa & memberi nilai Esai (0–100) di menu "Hasil Tes & Koreksi Esai".',
  },
  {
    q: 'Cara upload soal dari file Word (.docx) tanpa ketik ulang',
    fallbackAnswer:
      '1. Buka menu "Import Soal AI".\n2. Tarik/unggah file .docx atau .pdf langsung ke kotak Upload, atau copy-paste dari Word.\n3. Klik "Ekstrak dengan Smart AI Parser" (atau "Parser Lokal") — tabel, kotak bacaan, dan gambar otomatis dipertahankan!\n4. Periksa pratinjau soal lalu klik "Simpan Semua ke Bank Soal".',
  },
  {
    q: 'Cara mengaktifkan ujian dan membagikan Token ke siswa',
    fallbackAnswer:
      '1. Buka menu "Data Tes / Jadwal Ujian".\n2. Isi Judul Ujian, pilih Kelas target, atur Durasi, dan pilih soal dari Bank Soal.\n3. Klik "Terbitkan Jadwal Ujian".\n4. Salin kode Token 6 huruf/angka di kartu jadwal tersebut dan bagikan ke siswa agar dapat masuk ruang ujian.',
  },
];

const WALKTHROUGH_STEPS: Array<{
  title: string;
  desc: string;
  tab: TeacherTab;
}> = [
  {
    title: 'Langkah 1: Pilih Data Modul / Bank Soal',
    desc: 'Di sini Anda melihat seluruh butir soal per mata pelajaran, mengedit soal, atau mengosongkan bank soal lama dengan aman.',
    tab: 'bank-soal',
  },
  {
    title: 'Langkah 2: Tambah atau Import Soal dari Word/PDF',
    desc: 'Gunakan menu "Import Soal AI" untuk mengunggah dokumen .docx/.pdf atau tempel dari Word tanpa menghilangkan tabel dan gambar.',
    tab: 'import',
  },
  {
    title: 'Langkah 3: Buat Jadwal Tes (Snapshot Aman)',
    desc: 'Di menu "Data Tes / Jadwal Ujian", pilih soal yang ingin diujikan, atur durasi dan target kelas, lalu terbitkan jadwal.',
    tab: 'jadwal',
  },
  {
    title: 'Langkah 4: Salin & Bagikan Token Ujian ke Siswa',
    desc: 'Setelah jadwal aktif, klik tombol Salin Token di samping jadwal ujian lalu bagikan ke siswa. Anda siap memantau di Live Monitoring!',
    tab: 'jadwal',
  },
];

export const TeacherTutorAssistant: React.FC<TeacherTutorAssistantProps> = ({
  onNavigateTab,
  walkthroughStep,
  onStartWalkthrough,
  onNextWalkthrough,
  onCloseWalkthrough,
  open: controlledOpen,
  onOpenChange,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (updater: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof updater === 'function' ? updater(open) : updater;
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'model'; text: string }>>([
    {
      role: 'model',
      text: 'Assalamu’alaikum Bapak/Ibu Guru! Saya Asisten Panduan CBT MTs Nurul Hijrah. Silakan pilih pertanyaan cepat di bawah atau ketik pertanyaan Anda.',
    },
  ]);

  const askTutor = async (questionText: string, localFallback?: string) => {
    if (!questionText.trim()) return;
    const nextHistory = [...messages, { role: 'user' as const, text: questionText }];
    setMessages(nextHistory);
    setInput('');

    if (localFallback) {
      setMessages((prev) => [...prev, { role: 'model', text: localFallback }]);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/gemini/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: questionText, history: nextHistory }),
      });
      const data = (await res.json()) as { reply?: string };
      if (res.ok && data.reply) {
        setMessages((prev) => [...prev, { role: 'model', text: data.reply! }]);
      } else if (localFallback) {
        setMessages((prev) => [...prev, { role: 'model', text: localFallback }]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: 'model',
            text: 'Gunakan menu di sebelah kiri secara berurutan: 1) Data Modul / Bank Soal, 2) Import Soal AI, 3) Data Tes / Jadwal Ujian, lalu 4) Live Monitoring Ujian.',
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'model',
          text:
            localFallback ||
            'Panduan singkat: Tambahkan soal di Bank Soal atau Import .docx, lalu buat Jadwal Tes dan bagikan Token Ujian ke siswa.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const currentWalkthrough =
    walkthroughStep !== null ? WALKTHROUGH_STEPS[walkthroughStep] : null;

  return (
    <>
      {/* Interactive Step-by-Step Walkthrough Coachmark Overlay */}
      {currentWalkthrough && walkthroughStep !== null && (
        <div className="glass-modal fixed bottom-24 left-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 border-2 border-emerald-500/70 p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 font-mono-tabular">
              Tur Panduan {walkthroughStep + 1} / {WALKTHROUGH_STEPS.length}
            </span>
            <button
              type="button"
              onClick={onCloseWalkthrough}
              aria-label="Tutup Tur Panduan"
              className="btn-press rounded-xl p-1 text-slate-500 hover:bg-white/60"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <h4 className="font-display mt-1 text-sm font-bold text-slate-900">{currentWalkthrough.title}</h4>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">{currentWalkthrough.desc}</p>
          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              onClick={onCloseWalkthrough}
              className="text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              Selesai Tur
            </button>
            <button
              type="button"
              onClick={() => {
                if (walkthroughStep + 1 < WALKTHROUGH_STEPS.length) {
                  const nextTab = WALKTHROUGH_STEPS[walkthroughStep + 1].tab;
                  onNavigateTab(nextTab);
                  onNextWalkthrough();
                } else {
                  onCloseWalkthrough();
                }
              }}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 shadow-sm"
            >
              <span>
                {walkthroughStep + 1 < WALKTHROUGH_STEPS.length ? 'Lanjut' : 'Tutup & Mulai'}
              </span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Floating Tutor Chat Window */}
      {open && (
        <div
          className="glass-modal fixed bottom-20 right-4 z-50 flex h-[480px] w-[92vw] max-w-sm flex-col overflow-hidden"
          role="dialog"
          aria-label="Asisten AI Panduan Buat Soal"
        >
          <div className="glass-dark flex items-center justify-between border-b border-white/15 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-emerald-300" />
              <div>
                <h3 className="font-display text-sm font-bold">Asisten AI: Panduan Buat Soal</h3>
                <p className="text-[11px] text-emerald-200/90">Mentor Guru Pemula CBT</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Tutup Asisten AI"
              className="btn-press rounded-xl p-1 text-slate-200 hover:bg-white/15"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="border-b border-white/50 bg-white/35 px-3 py-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onNavigateTab('bank-soal');
                onStartWalkthrough();
              }}
              className="btn-press flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-300/60 bg-white/70 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-500/15"
            >
              <Compass className="h-3.5 w-3.5" />
              <span>Mulai Tur Panduan Langkah-demi-Langkah</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`rounded-2xl px-3.5 py-2.5 text-xs whitespace-pre-line leading-relaxed ${
                  m.role === 'user'
                    ? 'ml-8 bg-emerald-700 text-white shadow-sm'
                    : 'glass-subtle mr-6 text-slate-800'
                }`}
              >
                {m.text}
              </div>
            ))}
            {loading && (
              <div className="glass-subtle mr-6 rounded-2xl px-3.5 py-2.5 text-xs text-slate-500">
                Sedang mengetik panduan...
              </div>
            )}

            {/* Quick Prompts */}
            <div className="pt-2 space-y-1.5">
              <p className="text-[11px] font-semibold text-slate-500">Pertanyaan Cepat:</p>
              {QUICK_PROMPTS.map((qp) => (
                <button
                  key={qp.q}
                  type="button"
                  onClick={() => askTutor(qp.q, qp.fallbackAnswer)}
                  className="btn-press block w-full rounded-xl border border-emerald-300/50 bg-emerald-500/10 px-3 py-1.5 text-left text-[11px] font-medium text-emerald-950 hover:bg-emerald-500/20"
                >
                  {qp.q}
                </button>
              ))}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              askTutor(input);
            }}
            className="flex items-center gap-2 border-t border-white/50 bg-white/35 p-2.5"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Tanya cara membuat soal..."
              className="glass-input flex-1 rounded-xl px-3 py-1.5 text-xs text-slate-900"
            />
            <button
              type="submit"
              aria-label="Kirim pertanyaan ke Asisten AI"
              className="btn-press rounded-xl bg-emerald-700 p-2 text-white hover:bg-emerald-800 shadow-sm"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      )}

      {/* Floating Bottom-Right Button (only shown when uncontrolled) */}
      {!isControlled && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="btn-press fixed bottom-5 right-4 z-40 inline-flex items-center gap-2 rounded-2xl border border-white/25 bg-emerald-700/90 backdrop-blur-md px-4 py-2.5 text-xs font-bold text-white shadow-lg hover:bg-emerald-800 no-print"
        >
          <Sparkles className="h-4 w-4 text-emerald-200" />
          <span>Panduan Buat Soal</span>
        </button>
      )}
    </>
  );
};
