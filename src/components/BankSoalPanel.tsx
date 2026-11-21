import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Edit3,
  PlayCircle,
  AlertTriangle,
  Table as TableIcon,
  Image as ImageIcon,
  X,
  Check,
  Loader2,
  CheckSquare,
  Square,
} from 'lucide-react';
import type { Question, QuestionType } from '../types/cbt';
import { getOptionLetter } from '../utils/examLogic';

interface BankSoalPanelProps {
  questions: Question[];
  subjects: string[];
  selectedSubject: string;
  onChangeSubject: (subj: string) => void;
  lockedSubject?: string;
  teacherName: string;
  onAddQuestion: (q: Omit<Question, 'id' | 'createdAt'>) => Promise<unknown>;
  onUpdateQuestion: (q: Question) => Promise<void>;
  onDeleteQuestion: (id: string) => Promise<void>;
  onDeleteQuestionsBatch?: (ids: string[]) => Promise<void>;
  onClearSubjectBank: (subj: string) => Promise<void>;
  onOpenVideoTutorial?: () => void;
  openCreateSignal?: number;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  PG: 'Pilihan Ganda',
  PG_KOMPLEKS: 'PG Kompleks',
  BENAR_SALAH: 'Benar / Salah',
  ESAI: 'Esai / Uraian',
};

const PAGE_SIZE = 25;

interface QuestionCardProps {
  q: Question;
  index: number;
  selected: boolean;
  isDeleting: boolean;
  onToggleSelect: (id: string) => void;
  onEdit: (q: Question) => void;
  onDelete: (id: string) => void;
}

const QuestionCard = memo<QuestionCardProps>(
  ({ q, index, selected, isDeleting, onToggleSelect, onEdit, onDelete }) => (
    <div
      className={`surface-card-interactive p-4 sm:p-5 ${
        selected ? 'border-emerald-500 ring-2 ring-emerald-500/25' : ''
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <button
            type="button"
            onClick={() => onToggleSelect(q.id)}
            aria-label={`Pilih soal ${index + 1}`}
            className="btn-press rounded-lg p-1 text-slate-500 hover:bg-white/60 hover:text-emerald-700"
          >
            {selected ? (
              <CheckSquare className="h-4 w-4 text-emerald-700" />
            ) : (
              <Square className="h-4 w-4" />
            )}
          </button>
          <span className="font-mono-tabular font-bold text-slate-900">
            Soal #{index + 1}
          </span>
          <span aria-hidden="true">&middot;</span>
          <span className="font-semibold text-emerald-700">{TYPE_LABELS[q.tipe]}</span>
          <span aria-hidden="true">&middot;</span>
          <span className="font-mono-tabular">Bobot {q.bobot}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onEdit(q)}
            disabled={isDeleting}
            className="btn-press inline-flex items-center gap-1 rounded-xl border border-white/65 bg-white/55 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white/85 disabled:opacity-50"
          >
            <Edit3 className="h-3.5 w-3.5" />
            <span>Edit</span>
          </button>
          <button
            type="button"
            disabled={isDeleting}
            onClick={() => onDelete(q.id)}
            aria-label={`Hapus soal ${index + 1}`}
            className="btn-press inline-flex items-center gap-1 rounded-xl border border-red-300/60 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-500/20 disabled:opacity-50"
          >
            {isDeleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            <span>{isDeleting ? 'Menghapus...' : 'Hapus'}</span>
          </button>
        </div>
      </div>

      <div
        className="rich-question-content mt-3 text-sm text-slate-800"
        dangerouslySetInnerHTML={{ __html: q.pertanyaanHtml }}
      />

      {q.opsi.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {q.opsi.map((opt, oIdx) => {
            const letter = q.tipe === 'BENAR_SALAH' ? opt : getOptionLetter(oIdx);
            const isKey = q.kunciJawaban.includes(letter);
            return (
              <div
                key={oIdx}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs backdrop-blur-sm ${
                  isKey
                    ? 'border-emerald-400/60 bg-emerald-500/15 font-semibold text-emerald-950'
                    : 'border-white/55 bg-white/40 text-slate-700'
                }`}
              >
                <span className="font-mono-tabular font-bold">
                  {q.tipe === 'BENAR_SALAH' ? '' : `${letter}.`}
                </span>
                <span className="flex-1">{opt}</span>
                {isKey && <Check className="h-3.5 w-3.5 text-emerald-700 shrink-0" />}
              </div>
            );
          })}
        </div>
      )}

      {q.tipe === 'ESAI' && q.kunciJawaban[0] && (
        <p className="glass-subtle mt-2.5 rounded-xl px-3 py-2 text-xs text-slate-700">
          <strong>Pedoman Kunci Esai:</strong> {q.kunciJawaban[0]}
        </p>
      )}
    </div>
  )
);

QuestionCard.displayName = 'QuestionCard';

export const BankSoalPanel: React.FC<BankSoalPanelProps> = ({
  questions,
  subjects,
  selectedSubject,
  onChangeSubject,
  lockedSubject,
  teacherName,
  onAddQuestion,
  onUpdateQuestion,
  onDeleteQuestion,
  onDeleteQuestionsBatch,
  onClearSubjectBank,
  onOpenVideoTutorial,
  openCreateSignal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | QuestionType>('ALL');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());
  const [isClearing, setIsClearing] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);

  const validSelected = subjects.includes(selectedSubject)
    ? selectedSubject
    : subjects[0] || '';
  const activeSubject = lockedSubject || validSelected;

  const subjectQuestions = useMemo(
    () => questions.filter((q) => q.mataPelajaran === activeSubject),
    [questions, activeSubject]
  );

  const filteredQuestions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return subjectQuestions.filter((q) => {
      if (typeFilter !== 'ALL' && q.tipe !== typeFilter) return false;
      if (query) {
        const plain = q.pertanyaanHtml.replace(/<[^>]+>/g, ' ').toLowerCase();
        if (!plain.includes(query)) return false;
      }
      return true;
    });
  }, [subjectQuestions, typeFilter, searchQuery]);

  const displayedQuestions = useMemo(
    () => filteredQuestions.slice(0, visibleCount),
    [filteredQuestions, visibleCount]
  );

  // Reset pagination & stale selections when changing module or filters
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setSelectedIds(new Set());
  }, [activeSubject, typeFilter]);

  useEffect(() => {
    const existingIds = new Set(questions.map((q) => q.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (existingIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [questions]);

  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tipe, setTipe] = useState<QuestionType>('PG');
  const [pertanyaanHtml, setPertanyaanHtml] = useState('<p></p>');
  const [opsi, setOpsi] = useState<string[]>(['', '', '', '']);
  const [kunciJawaban, setKunciJawaban] = useState<string[]>(['A']);
  const [bobot, setBobot] = useState<number>(10);
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  const richRef = useRef<HTMLDivElement | null>(null);

  const openCreateModal = useCallback(() => {
    setEditingId(null);
    setTipe('PG');
    setPertanyaanHtml('');
    setOpsi(['', '', '', '']);
    setKunciJawaban(['A']);
    setBobot(10);
    setShowEditor(true);
    window.setTimeout(() => {
      if (richRef.current) richRef.current.innerHTML = '';
    }, 20);
  }, []);

  useEffect(() => {
    if (openCreateSignal && openCreateSignal > 0) {
      openCreateModal();
    }
  }, [openCreateSignal, openCreateModal]);

  const openEditModal = useCallback((q: Question) => {
    setEditingId(q.id);
    setTipe(q.tipe);
    setPertanyaanHtml(q.pertanyaanHtml);
    setOpsi(q.opsi.length > 0 ? [...q.opsi] : ['', '', '', '']);
    setKunciJawaban([...q.kunciJawaban]);
    setBobot(q.bobot || 10);
    setShowEditor(true);
    window.setTimeout(() => {
      if (richRef.current) richRef.current.innerHTML = q.pertanyaanHtml;
    }, 20);
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleDeleteSingle = useCallback(
    async (id: string) => {
      if (deletingIds.has(id)) return;
      setDeletingIds((prev) => new Set(prev).add(id));
      try {
        await onDeleteQuestion(id);
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [deletingIds, onDeleteQuestion]
  );

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0 || isBatchDeleting) return;
    const ids = Array.from(selectedIds);
    setIsBatchDeleting(true);
    try {
      if (onDeleteQuestionsBatch) {
        await onDeleteQuestionsBatch(ids);
      } else {
        for (const id of ids) {
          await onDeleteQuestion(id);
        }
      }
      setSelectedIds(new Set());
    } finally {
      setIsBatchDeleting(false);
    }
  };

  const handleConfirmClearBank = async () => {
    if (isClearing) return;
    setIsClearing(true);
    try {
      await onClearSubjectBank(activeSubject);
      setSelectedIds(new Set());
      setShowConfirmClear(false);
    } finally {
      setIsClearing(false);
    }
  };

  const handleTypeChange = (nextType: QuestionType) => {
    setTipe(nextType);
    if (nextType === 'BENAR_SALAH') {
      setOpsi(['Benar', 'Salah']);
      setKunciJawaban(['Benar']);
    } else if (nextType === 'ESAI') {
      setOpsi([]);
      setKunciJawaban(['']);
      setBobot(20);
    } else {
      if (opsi.length < 2 || (opsi.length === 2 && opsi[0] === 'Benar')) {
        setOpsi(['', '', '', '']);
      }
      setKunciJawaban(nextType === 'PG_KOMPLEKS' ? ['A', 'B'] : ['A']);
      setBobot(10);
    }
  };

  const insertSampleTable = () => {
    const tableHtml =
      '<table><thead><tr><th>Kolom 1</th><th>Kolom 2</th></tr></thead><tbody><tr><td>Data A</td><td>Data B</td></tr></tbody></table><p></p>';
    if (richRef.current) {
      richRef.current.innerHTML += tableHtml;
      setPertanyaanHtml(richRef.current.innerHTML);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string' && richRef.current) {
        richRef.current.innerHTML += `<p><img src="${reader.result}" alt="Gambar soal" /></p>`;
        setPertanyaanHtml(richRef.current.innerHTML);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    const htmlContent = (richRef.current?.innerHTML || pertanyaanHtml).trim();
    if (!htmlContent || htmlContent === '<br>') return;

    const cleanBobot = Number.isFinite(bobot) && bobot > 0 ? Math.min(100, Math.round(bobot)) : 10;

    const cleanOpsi =
      tipe === 'BENAR_SALAH'
        ? ['Benar', 'Salah']
        : tipe === 'ESAI'
          ? []
          : opsi.map((o) => o.trim()).filter(Boolean);

    if (editingId) {
      const existing = questions.find((q) => q.id === editingId);
      if (existing) {
        await onUpdateQuestion({
          ...existing,
          mataPelajaran: activeSubject,
          tipe,
          pertanyaanHtml: htmlContent,
          opsi: cleanOpsi,
          kunciJawaban,
          bobot: cleanBobot,
        });
      }
    } else {
      await onAddQuestion({
        mataPelajaran: activeSubject,
        tipe,
        pertanyaanHtml: htmlContent,
        opsi: cleanOpsi,
        kunciJawaban,
        bobot: cleanBobot,
        createdBy: teacherName,
      });
    }
    setShowEditor(false);
  };

  const toggleComplexKey = (letter: string) => {
    setKunciJawaban((prev) =>
      prev.includes(letter) ? prev.filter((k) => k !== letter) : [...prev, letter].sort()
    );
  };

  const allDisplayedSelected =
    displayedQuestions.length > 0 && displayedQuestions.every((q) => selectedIds.has(q.id));

  const toggleSelectAllDisplayed = () => {
    if (allDisplayedSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayedQuestions.map((q) => q.id)));
    }
  };

  return (
    <div className="space-y-4 panel-enter">
      {/* Top Tutorial Banner */}
      {onOpenVideoTutorial && (
        <div className="glass-subtle flex flex-wrap items-center justify-between gap-3 rounded-2xl border-emerald-300/50 bg-emerald-500/10 px-5 py-3.5">
          <div>
            <p className="text-sm font-semibold text-emerald-950">
              Baru pertama kali menyusun soal CBT?
            </p>
            <p className="text-xs text-emerald-900/80">
              Pelajari cara membuat soal PG, PG Kompleks, Esai, hingga Import Word dalam 3 menit.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenVideoTutorial}
            className="btn-press inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0 shadow-sm"
          >
            <PlayCircle className="h-4 w-4" />
            <span>Tonton Video Tutorial (3 Menit)</span>
          </button>
        </div>
      )}

      {/* Action & Interactive Filter Bar */}
      <div className="surface-card p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {!lockedSubject ? (
              <div className="flex items-center gap-2">
                <label htmlFor="bank-mapel-select" className="text-xs font-semibold text-slate-600">
                  Mata Pelajaran:
                </label>
                <select
                  id="bank-mapel-select"
                  value={activeSubject}
                  onChange={(e) => onChangeSubject(e.target.value)}
                  className="glass-input rounded-xl px-3 py-2 text-sm font-medium text-slate-900"
                >
                  {subjects.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="font-display text-sm font-bold text-slate-900">
                Bank Soal: {activeSubject}
              </div>
            )}
            <span className="text-xs text-slate-500 font-mono-tabular">
              {subjectQuestions.length} butir soal tersedia
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedIds.size > 0 && (
              <button
                type="button"
                disabled={isBatchDeleting}
                onClick={handleDeleteSelected}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-red-300/70 bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-500/25 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {isBatchDeleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                <span>Hapus Terpilih ({selectedIds.size})</span>
              </button>
            )}

            <button
              type="button"
              onClick={openCreateModal}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0 shadow-sm"
            >
              <Plus className="h-4 w-4" />
              <span>Tambah Soal Baru</span>
            </button>

            <button
              type="button"
              disabled={subjectQuestions.length === 0 || isClearing}
              onClick={() => setShowConfirmClear(true)}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <Trash2 className="h-4 w-4" />
              <span>Kosongkan Bank Soal</span>
            </button>
          </div>
        </div>

        {/* Interactive Question Search + Type Segmented Filter */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/50 pt-3">
          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari teks pertanyaan di bank soal..."
              className="glass-input w-full sm:w-64 rounded-xl px-3.5 py-2 text-xs text-slate-900"
            />
            {displayedQuestions.length > 0 && (
              <button
                type="button"
                onClick={toggleSelectAllDisplayed}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-white/65 bg-white/50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white/80 shrink-0"
              >
                {allDisplayedSelected ? (
                  <CheckSquare className="h-3.5 w-3.5 text-emerald-700" />
                ) : (
                  <Square className="h-3.5 w-3.5 text-slate-400" />
                )}
                <span>
                  {allDisplayedSelected ? 'Batal Pilih' : `Pilih (${displayedQuestions.length})`}
                </span>
              </button>
            )}
          </div>

          <div className="glass-subtle inline-flex max-w-full overflow-x-auto items-center gap-1 rounded-xl p-1">
            {(
              [
                { id: 'ALL', label: 'Semua' },
                { id: 'PG', label: 'PG' },
                { id: 'PG_KOMPLEKS', label: 'PG Kompleks' },
                { id: 'BENAR_SALAH', label: 'Benar/Salah' },
                { id: 'ESAI', label: 'Esai' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTypeFilter(t.id)}
                className={`btn-press rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  typeFilter === t.id
                    ? 'bg-white/85 text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Question Cards List */}
      {filteredQuestions.length === 0 ? (
        <div className="surface-card border-dashed p-10 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {subjectQuestions.length === 0
              ? `Bank Soal untuk ${activeSubject} masih kosong.`
              : 'Tidak ada butir soal yang cocok dengan filter pencarian.'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {subjectQuestions.length === 0
              ? 'Klik "Tambah Soal Baru" atau gunakan menu "Import Soal AI" untuk mengunggah dokumen Word/PDF.'
              : 'Ubah kata kunci pencarian atau pilih tipe "Semua".'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayedQuestions.map((q, idx) => (
            <QuestionCard
              key={q.id}
              q={q}
              index={idx}
              selected={selectedIds.has(q.id)}
              isDeleting={deletingIds.has(q.id) || isClearing}
              onToggleSelect={handleToggleSelect}
              onEdit={openEditModal}
              onDelete={handleDeleteSingle}
            />
          ))}

          {filteredQuestions.length > displayedQuestions.length && (
            <div className="pt-1 text-center">
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="btn-press inline-flex items-center gap-2 rounded-xl border border-white/65 bg-white/60 px-5 py-2.5 text-xs font-semibold text-slate-700 backdrop-blur-md hover:bg-white/85"
              >
                Muat {Math.min(PAGE_SIZE, filteredQuestions.length - displayedQuestions.length)} Soal Berikutnya ({filteredQuestions.length - displayedQuestions.length} tersisa)
              </button>
            </div>
          )}
        </div>
      )}

      {/* Confirm Bulk Clear Modal */}
      {showConfirmClear && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
        >
          <div className="glass-modal w-full max-w-md p-6">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-500/15 text-red-700 border border-red-300/60">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Kosongkan Bank Soal {activeSubject}?
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                  Seluruh <strong>{subjectQuestions.length}</strong> butir soal di modul{' '}
                  <strong>{activeSubject}</strong> akan dihapus permanen agar Anda siap menyusun paket soal baru.
                  {filteredQuestions.length !== subjectQuestions.length && (
                    <span className="block mt-1 text-amber-700">
                      (Termasuk soal di luar filter pencarian saat ini.)
                    </span>
                  )}
                </p>
                <p className="mt-2 rounded-xl border border-emerald-300/60 bg-emerald-500/10 p-2.5 text-xs text-emerald-900">
                  <strong>Keamanan Data Aktif:</strong> Soal yang sudah dimasukkan ke menu <em>Data Tes / Jadwal Ujian</em> tetap utuh dan tidak ikut terhapus.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={isClearing}
                onClick={() => setShowConfirmClear(false)}
                className="btn-press rounded-xl border border-white/65 bg-white/60 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-white/85 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isClearing}
                onClick={handleConfirmClearBank}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {isClearing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{isClearing ? 'Menghapus...' : 'Ya, Kosongkan Bank Soal'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Question Modal */}
      {showEditor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSaveQuestion}
            className="glass-modal flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-white/55 px-5 py-4">
              <h3 className="font-display text-base font-bold text-slate-900">
                {editingId ? 'Edit Butir Soal' : `Tambah Soal Baru (${activeSubject})`}
              </h3>
              <button
                type="button"
                onClick={() => setShowEditor(false)}
                className="btn-press rounded-xl p-1.5 text-slate-500 hover:bg-white/60"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tipe Soal
                  </label>
                  <select
                    value={tipe}
                    onChange={(e) => handleTypeChange(e.target.value as QuestionType)}
                    className="glass-input w-full rounded-xl px-3.5 py-2 text-sm text-slate-900"
                  >
                    <option value="PG">Pilihan Ganda Biasa (A-E)</option>
                    <option value="PG_KOMPLEKS">Pilihan Ganda Kompleks (&gt;1 Benar)</option>
                    <option value="BENAR_SALAH">Benar / Salah</option>
                    <option value="ESAI">Esai / Uraian</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Bobot Nilai
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={bobot}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setBobot(Number.isFinite(val) ? val : 10);
                    }}
                    className="glass-input w-full rounded-xl px-3.5 py-2 text-sm font-mono-tabular text-slate-900"
                  />
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Pertanyaan (Mendukung Paste Tabel &amp; Gambar dari Microsoft Word)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={insertSampleTable}
                      className="btn-press inline-flex items-center gap-1 rounded-xl border border-white/65 bg-white/60 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-white/85"
                    >
                      <TableIcon className="h-3.5 w-3.5" />
                      <span>Sisipkan Tabel</span>
                    </button>
                    <label className="btn-press inline-flex cursor-pointer items-center gap-1 rounded-xl border border-white/65 bg-white/60 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-white/85">
                      <ImageIcon className="h-3.5 w-3.5" />
                      <span>Sisipkan Gambar</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                    </label>
                  </div>
                </div>
                <div
                  ref={richRef}
                  contentEditable
                  onInput={(e) => setPertanyaanHtml(e.currentTarget.innerHTML)}
                  className="rich-question-content glass-input min-h-[130px] rounded-xl p-3 text-sm text-slate-900"
                />
              </div>

              {(tipe === 'PG' || tipe === 'PG_KOMPLEKS') && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-700">
                      Pilihan Jawaban &amp; Kunci ({tipe === 'PG_KOMPLEKS' ? 'Centang semua yang benar' : 'Pilih satu kunci'})
                    </label>
                    {opsi.length < 5 && (
                      <button
                        type="button"
                        onClick={() => setOpsi([...opsi, ''])}
                        className="text-xs font-semibold text-emerald-700 hover:underline"
                      >
                        + Tambah Opsi E
                      </button>
                    )}
                  </div>
                  {opsi.map((val, idx) => {
                    const letter = getOptionLetter(idx);
                    const checked = kunciJawaban.includes(letter);
                    return (
                      <div key={idx} className="flex items-center gap-2">
                        {tipe === 'PG' ? (
                          <input
                            type="radio"
                            name="kunci-pg"
                            checked={checked}
                            onChange={() => setKunciJawaban([letter])}
                            aria-label={`Kunci ${letter}`}
                            className="h-4 w-4 accent-emerald-700"
                          />
                        ) : (
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleComplexKey(letter)}
                            aria-label={`Kunci ${letter}`}
                            className="h-4 w-4 accent-emerald-700"
                          />
                        )}
                        <span className="w-6 font-mono-tabular text-xs font-bold text-slate-700">
                          {letter}.
                        </span>
                        <input
                          type="text"
                          required
                          value={val}
                          onChange={(e) => {
                            const next = [...opsi];
                            next[idx] = e.target.value;
                            setOpsi(next);
                          }}
                          placeholder={`Teks pilihan ${letter}`}
                          className="glass-input flex-1 rounded-xl px-3 py-1.5 text-sm text-slate-900"
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {tipe === 'BENAR_SALAH' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Kunci Pernyataan
                  </label>
                  <div className="flex gap-3">
                    {['Benar', 'Salah'].map((choice) => (
                      <label
                        key={choice}
                        className="glass-subtle flex items-center gap-2 rounded-xl px-4 py-2 text-sm cursor-pointer"
                      >
                        <input
                          type="radio"
                          name="kunci-bs"
                          checked={kunciJawaban[0] === choice}
                          onChange={() => setKunciJawaban([choice])}
                          className="accent-emerald-700"
                        />
                        <span>{choice}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {tipe === 'ESAI' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Pedoman Jawaban Esai (Opsional)
                  </label>
                  <textarea
                    rows={3}
                    value={kunciJawaban[0] || ''}
                    onChange={(e) => setKunciJawaban([e.target.value])}
                    placeholder="Tulis poin kunci jawaban sebagai panduan koreksi..."
                    className="glass-input w-full rounded-xl px-3.5 py-2 text-sm text-slate-900"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-white/50 bg-white/35 px-5 py-3.5">
              <button
                type="button"
                onClick={() => setShowEditor(false)}
                className="btn-press rounded-xl border border-white/65 bg-white/60 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-white/85"
              >
                Batal
              </button>
              <button
                type="submit"
                className="btn-press rounded-xl bg-emerald-700 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 shadow-sm"
              >
                Simpan ke Bank Soal
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
