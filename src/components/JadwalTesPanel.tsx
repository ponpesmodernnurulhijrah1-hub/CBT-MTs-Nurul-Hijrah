import React, { useRef, useState } from 'react';
import {
  CalendarPlus,
  Copy,
  Check,
  Power,
  Trash2,
  RefreshCw,
  ShieldCheck,
  Edit3,
  X,
} from 'lucide-react';
import type { ExamSchedule, Question } from '../types/cbt';
import {
  createExamWithSnapshot,
  findDuplicateActiveToken,
  generateExamToken,
} from '../utils/examLogic';

interface JadwalTesPanelProps {
  exams: ExamSchedule[];
  questions: Question[];
  subjects: string[];
  classes: string[];
  lockedSubject?: string;
  teacherName: string;
  onSaveExam: (exam: ExamSchedule) => Promise<void>;
  onToggleExamActive: (id: string) => Promise<void>;
  onDeleteExam: (id: string) => Promise<void>;
}

export const JadwalTesPanel: React.FC<JadwalTesPanelProps> = ({
  exams,
  questions,
  subjects,
  classes,
  lockedSubject,
  teacherName,
  onSaveExam,
  onToggleExamActive,
  onDeleteExam,
}) => {
  const [editingExam, setEditingExam] = useState<ExamSchedule | null>(null);
  const [replaceQuestionsMode, setReplaceQuestionsMode] = useState(false);
  const [judulUjian, setJudulUjian] = useState('');
  const [mataPelajaran, setMataPelajaran] = useState(lockedSubject || subjects[0] || '');
  const [selectedClasses, setSelectedClasses] = useState<string[]>(['Semua Kelas']);
  const [durasiMenit, setDurasiMenit] = useState(45);
  const [token, setToken] = useState(generateExamToken());
  const [acakSoal, setAcakSoal] = useState(false);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [formMsg, setFormMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const validSubject = subjects.includes(mataPelajaran) ? mataPelajaran : subjects[0] || '';
  const effectiveSubject = lockedSubject || validSubject;
  const availableQuestions = questions.filter((q) => q.mataPelajaran === effectiveSubject);
  const availableIdSet = new Set(availableQuestions.map((q) => q.id));
  const validSelectedQuestionIds = selectedQuestionIds.filter((id) => availableIdSet.has(id));
  const visibleExams = lockedSubject
    ? exams.filter((e) => e.mataPelajaran === lockedSubject)
    : exams;

  const toggleClass = (clsName: string) => {
    if (clsName === 'Semua Kelas') {
      setSelectedClasses(['Semua Kelas']);
      return;
    }
    setSelectedClasses((prev) => {
      const cleaned = prev.filter((c) => c !== 'Semua Kelas');
      const next = cleaned.includes(clsName)
        ? cleaned.filter((c) => c !== clsName)
        : [...cleaned, clsName];
      return next.length === 0 ? ['Semua Kelas'] : next;
    });
  };

  const allQuestionsSelected =
    availableQuestions.length > 0 && validSelectedQuestionIds.length === availableQuestions.length;

  const toggleSelectAllQuestions = () => {
    if (allQuestionsSelected) {
      setSelectedQuestionIds([]);
    } else {
      setSelectedQuestionIds(availableQuestions.map((q) => q.id));
    }
  };

  const resetForm = () => {
    setEditingExam(null);
    setReplaceQuestionsMode(false);
    setJudulUjian('');
    setSelectedClasses(['Semua Kelas']);
    setDurasiMenit(45);
    setToken(generateExamToken());
    setAcakSoal(false);
    setSelectedQuestionIds([]);
  };

  const startEditingExam = (exam: ExamSchedule) => {
    setEditingExam(exam);
    setReplaceQuestionsMode(false);
    setJudulUjian(exam.judulUjian);
    setMataPelajaran(exam.mataPelajaran);
    setSelectedClasses(exam.kelasTarget.length > 0 ? exam.kelasTarget : ['Semua Kelas']);
    setDurasiMenit(exam.durasiMenit);
    setToken(exam.token);
    setAcakSoal(exam.acakSoal);
    setSelectedQuestionIds(exam.questionsSnapshot.map((q) => q.id));
    setFormMsg(null);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormMsg(null);
    if (!judulUjian.trim()) {
      setFormMsg({ type: 'error', text: 'Judul ujian wajib diisi.' });
      return;
    }
    const cleanToken = token.trim().toUpperCase();
    if (cleanToken.length < 4) {
      setFormMsg({ type: 'error', text: 'Token ujian minimal 4 karakter.' });
      return;
    }

    const willBeActive = editingExam ? editingExam.aktif : true;
    if (willBeActive) {
      const dup = findDuplicateActiveToken(exams, cleanToken, editingExam?.id);
      if (dup) {
        setFormMsg({
          type: 'error',
          text: `Token "${cleanToken}" sudah dipakai ujian aktif lain (${dup.mataPelajaran} — ${dup.judulUjian}). Gunakan token berbeda.`,
        });
        return;
      }
    }

    const safeDuration =
      Number.isFinite(durasiMenit) && durasiMenit >= 5 ? Math.min(240, Math.round(durasiMenit)) : 45;

    if (editingExam) {
      let nextSnapshot = editingExam.questionsSnapshot;
      if (replaceQuestionsMode || nextSnapshot.length === 0) {
        const chosenQuestions =
          validSelectedQuestionIds.length > 0
            ? availableQuestions.filter((q) => validSelectedQuestionIds.includes(q.id))
            : availableQuestions;
        if (chosenQuestions.length === 0) {
          setFormMsg({
            type: 'error',
            text: `Belum ada soal di Bank Soal ${effectiveSubject}. Pilih soal atau pertahankan soal tes saat ini.`,
          });
          return;
        }
        nextSnapshot = chosenQuestions.map((q) => ({
          ...q,
          opsi: [...q.opsi],
          kunciJawaban: [...q.kunciJawaban],
        }));
      }

      const updatedExam: ExamSchedule = {
        ...editingExam,
        judulUjian: judulUjian.trim(),
        mataPelajaran: effectiveSubject,
        kelasTarget: selectedClasses.length > 0 ? selectedClasses : ['Semua Kelas'],
        durasiMenit: safeDuration,
        token: cleanToken,
        acakSoal,
        questionsSnapshot: nextSnapshot,
        updatedAt: new Date().toISOString(),
      };

      await onSaveExam(updatedExam);
      resetForm();
      setFormMsg({
        type: 'success',
        text: `Jadwal "${updatedExam.judulUjian}" (${updatedExam.questionsSnapshot.length} soal) berhasil diperbarui dan disinkronkan secara real-time.`,
      });
      return;
    }

    const chosenQuestions =
      validSelectedQuestionIds.length > 0
        ? availableQuestions.filter((q) => validSelectedQuestionIds.includes(q.id))
        : availableQuestions;

    if (chosenQuestions.length === 0) {
      setFormMsg({
        type: 'error',
        text: `Belum ada soal di Bank Soal ${effectiveSubject}. Tambahkan soal terlebih dahulu.`,
      });
      return;
    }

    // Create deep snapshot of questions inside exam schedule
    const exam = createExamWithSnapshot({
      judulUjian,
      mataPelajaran: effectiveSubject,
      kelasTarget: selectedClasses,
      durasiMenit: safeDuration,
      token: cleanToken,
      aktif: true,
      acakSoal,
      selectedQuestions: chosenQuestions,
      createdBy: teacherName,
    });

    await onSaveExam(exam);
    resetForm();
    setFormMsg({
      type: 'success',
      text: `Jadwal "${exam.judulUjian}" berhasil diterbitkan dengan ${exam.questionsSnapshot.length} soal ter-snapshot dan tersinkron ke seluruh perangkat.`,
    });
  };

  const copyToken = (id: string, tok: string) => {
    navigator.clipboard?.writeText(tok).catch(() => {});
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6 panel-enter">
      {/* Create / Edit Schedule Form */}
      <form
        ref={formRef}
        onSubmit={handleSaveSchedule}
        className="surface-card p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">
              {editingExam ? `Edit Jadwal Tes: ${editingExam.judulUjian}` : 'Buat Jadwal Tes / Ujian Baru'}
            </h3>
            <p className="text-xs text-slate-500">
              Sistem menyimpan salinan (snapshot) soal ke jadwal sehingga soal tetap aman jika Bank Soal dikosongkan.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {editingExam && (
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setFormMsg(null);
                }}
                className="btn-press inline-flex items-center gap-1 rounded-xl border border-white/70 bg-white/60 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white/90"
              >
                <X className="h-3.5 w-3.5" />
                <span>Batal Edit</span>
              </button>
            )}
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <ShieldCheck className="h-4 w-4" />
              <span>Snapshot Soal Aktif</span>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Judul Ujian
            </label>
            <input
              type="text"
              value={judulUjian}
              onChange={(e) => setJudulUjian(e.target.value)}
              placeholder="Contoh: Penilaian Tengah Semester Ganjil"
              className="glass-input w-full rounded-xl px-3.5 py-2 text-sm text-slate-900"
            />
          </div>

          {!lockedSubject && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Mata Pelajaran
              </label>
              <select
                value={effectiveSubject}
                onChange={(e) => {
                  setMataPelajaran(e.target.value);
                  setSelectedQuestionIds([]);
                }}
                className="glass-input w-full rounded-xl px-3.5 py-2 text-sm text-slate-900"
              >
                {subjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Durasi (Menit)
            </label>
            <input
              type="number"
              min={5}
              max={240}
              value={Number.isFinite(durasiMenit) ? durasiMenit : ''}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  setDurasiMenit(NaN);
                  return;
                }
                const parsed = Number(raw);
                setDurasiMenit(Number.isFinite(parsed) ? parsed : 45);
              }}
              onBlur={() => {
                if (!Number.isFinite(durasiMenit) || durasiMenit < 5) {
                  setDurasiMenit(45);
                } else if (durasiMenit > 240) {
                  setDurasiMenit(240);
                }
              }}
              className="glass-input w-full rounded-xl px-3.5 py-2 text-sm font-mono-tabular text-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Token Ujian
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value.toUpperCase())}
                maxLength={8}
                className="glass-input w-full rounded-xl px-3.5 py-2 text-sm font-mono-tabular font-bold uppercase tracking-wider text-slate-900"
              />
              <button
                type="button"
                onClick={() => setToken(generateExamToken())}
                title="Generate Token Baru"
                className="btn-press rounded-xl border border-white/65 bg-white/55 px-3 text-slate-600 hover:bg-white/85"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Target Classes */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Target Kelas (Sinkron Otomatis dengan Daftar Kelas Admin)
          </label>
          <div className="flex flex-wrap gap-2">
            {['Semua Kelas', ...classes].map((cls) => {
              const active = selectedClasses.includes(cls);
              return (
                <button
                  key={cls}
                  type="button"
                  onClick={() => toggleClass(cls)}
                  className={`btn-press rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-emerald-700 text-white shadow-sm'
                      : 'glass-subtle text-slate-700 hover:bg-white/70'
                  }`}
                >
                  {cls}
                </button>
              );
            })}
          </div>
        </div>

        {/* Edit Mode Question Snapshot Choice */}
        {editingExam && (
          <div className="glass-subtle rounded-2xl p-3.5 space-y-2">
            <p className="text-xs font-semibold text-slate-800">
              Sumber Paket Soal Saat Edit Jadwal
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setReplaceQuestionsMode(false)}
                className={`btn-press rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                  !replaceQuestionsMode
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'border border-white/70 bg-white/55 text-slate-700 hover:bg-white/85'
                }`}
              >
                Pertahankan soal tes saat ini ({editingExam.questionsSnapshot.length} soal)
              </button>
              <button
                type="button"
                onClick={() => setReplaceQuestionsMode(true)}
                className={`btn-press rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                  replaceQuestionsMode
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'border border-white/70 bg-white/55 text-slate-700 hover:bg-white/85'
                }`}
              >
                Ganti / pilih ulang dari Bank Soal ({availableQuestions.length} tersedia)
              </button>
            </div>
          </div>
        )}

        {/* Questions Selector (Always visible when creating, or when replaceQuestionsMode active in edit) */}
        {(!editingExam || replaceQuestionsMode) && (
          <div className="glass-subtle rounded-2xl p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <span className="text-xs font-semibold text-slate-700">
                Pilih Soal dari Bank Soal {effectiveSubject} ({validSelectedQuestionIds.length || availableQuestions.length} dipilih dari {availableQuestions.length} tersedia)
              </span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acakSoal}
                    onChange={(e) => setAcakSoal(e.target.checked)}
                    className="accent-emerald-700"
                  />
                  <span>Acak Urutan Soal</span>
                </label>
                <button
                  type="button"
                  onClick={toggleSelectAllQuestions}
                  className="text-xs font-semibold text-emerald-700 hover:underline"
                >
                  {allQuestionsSelected
                    ? 'Batal Pilih Semua'
                    : `Pilih Semua (${availableQuestions.length})`}
                </button>
              </div>
            </div>
            {availableQuestions.length === 0 ? (
              <p className="text-xs text-slate-500">
                Belum ada soal di Bank Soal {effectiveSubject}.
              </p>
            ) : (
              <div className="max-h-36 overflow-y-auto space-y-1.5">
                {availableQuestions.map((q, i) => {
                  const checked = selectedQuestionIds.includes(q.id);
                  return (
                    <label
                      key={q.id}
                      className="flex items-center gap-2 rounded-xl border border-white/60 bg-white/50 px-3 py-1.5 text-xs cursor-pointer hover:bg-white/75"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedQuestionIds((prev) =>
                            prev.includes(q.id)
                              ? prev.filter((id) => id !== q.id)
                              : [...prev, q.id]
                          )
                        }
                        className="accent-emerald-700"
                      />
                      <span className="font-mono-tabular font-bold">#{i + 1}</span>
                      <span className="text-emerald-700 font-medium">[{q.tipe}]</span>
                      <span className="truncate text-slate-700">
                        {q.pertanyaanHtml.replace(/<[^>]+>/g, ' ').slice(0, 90)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {editingExam && !replaceQuestionsMode && (
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={acakSoal}
              onChange={(e) => setAcakSoal(e.target.checked)}
              className="accent-emerald-700"
            />
            <span>Acak Urutan Soal untuk Peserta</span>
          </label>
        )}

        {formMsg && (
          <div
            className={`rounded-xl border px-3.5 py-2 text-xs font-medium ${
              formMsg.type === 'error'
                ? 'border-red-300/70 bg-red-500/15 text-red-900'
                : 'border-emerald-300/60 bg-emerald-500/15 text-emerald-900'
            }`}
          >
            {formMsg.text}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="btn-press inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800 shadow-sm"
          >
            <CalendarPlus className="h-4 w-4" />
            <span>{editingExam ? 'Simpan Perubahan Jadwal' : 'Terbitkan Jadwal Ujian'}</span>
          </button>
        </div>
      </form>

      {/* Active & Scheduled Exams List */}
      <div className="space-y-3">
        <h4 className="font-display text-sm font-bold text-slate-900">
          Daftar Jadwal Ujian Tersimpan ({visibleExams.length})
        </h4>
        {visibleExams.map((exam) => (
          <div
            key={exam.id}
            className={`surface-card-interactive flex flex-wrap items-center justify-between gap-4 p-4 ${
              editingExam?.id === exam.id ? 'ring-2 ring-emerald-600/70' : ''
            }`}
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h5 className="font-display text-sm font-bold text-slate-900">{exam.judulUjian}</h5>
                <span aria-hidden="true" className="text-slate-300">&middot;</span>
                <span
                  className={`text-xs font-semibold ${
                    exam.aktif ? 'text-emerald-700' : 'text-slate-400'
                  }`}
                >
                  {exam.aktif ? 'Aktif (Dibuka)' : 'Nonaktif'}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {exam.mataPelajaran} · Kelas: {exam.kelasTarget.join(', ')} ·{' '}
                <span className="font-mono-tabular">{exam.questionsSnapshot.length} soal</span> ·{' '}
                <span className="font-mono-tabular">{exam.durasiMenit} menit</span>
                {exam.acakSoal ? ' · Acak Soal' : ''}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="glass-subtle flex items-center gap-1.5 rounded-xl px-3 py-1.5">
                <span className="text-[11px] text-slate-500">Token:</span>
                <span className="font-mono-tabular text-sm font-bold tracking-wider text-emerald-800">
                  {exam.token}
                </span>
                <button
                  type="button"
                  onClick={() => copyToken(exam.id, exam.token)}
                  aria-label={`Salin token ${exam.token}`}
                  className="btn-press ml-1 rounded-lg p-1 text-slate-500 hover:bg-white/70 hover:text-slate-900"
                >
                  {copiedId === exam.id ? (
                    <Check className="h-3.5 w-3.5 text-emerald-700" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              <button
                type="button"
                onClick={() => startEditingExam(exam)}
                aria-label={`Edit jadwal ${exam.judulUjian}`}
                className="btn-press inline-flex items-center gap-1 rounded-xl border border-white/65 bg-white/55 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white/85"
              >
                <Edit3 className="h-3.5 w-3.5" />
                <span>Edit</span>
              </button>

              <button
                type="button"
                onClick={() => onToggleExamActive(exam.id)}
                className={`btn-press inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold ${
                  exam.aktif
                    ? 'border border-amber-300/70 bg-amber-500/15 text-amber-800 hover:bg-amber-500/25'
                    : 'bg-emerald-700 text-white hover:bg-emerald-800'
                }`}
              >
                <Power className="h-3.5 w-3.5" />
                <span>{exam.aktif ? 'Hentikan Ujian' : 'Aktifkan'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (editingExam?.id === exam.id) resetForm();
                  void onDeleteExam(exam.id);
                }}
                aria-label={`Hapus jadwal ${exam.judulUjian}`}
                className="btn-press rounded-xl border border-red-300/60 bg-red-500/10 p-2 text-red-600 hover:bg-red-500/20"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

