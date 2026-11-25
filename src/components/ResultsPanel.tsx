import React, { useMemo, useState } from 'react';
import {
  FileSpreadsheet,
  Printer,
  Search,
  Edit3,
  Trash2,
  X,
  CheckCircle2,
  AlertOctagon,
  Clock,
  ShieldAlert,
  Sparkles,
  Loader2,
  TableProperties,
  Download,
} from 'lucide-react';
import type { ExamResult, ExamSchedule } from '../types/cbt';
import {
  exportExamResultsToCSV,
  exportExamResultsToExcel,
  exportExamResultsToPDFPrint,
} from '../utils/exportHelpers';
import { recalculateResultWithEssayScore } from '../utils/examLogic';
import { getViolationHistoryForResult } from '../utils/violationTracker';
import { formatClientFetchError, safeParseResponseJson } from '../utils/aiQuestionUtils';

interface ResultsPanelProps {
  results: ExamResult[];
  exams: ExamSchedule[];
  subjects: string[];
  classes: string[];
  lockedSubject?: string;
  initialStatusFilter?: 'ALL' | 'Selesai' | 'Pelanggaran';
  onUpdateEssayScore: (resultId: string, newEssayPercent: number, newFinalScore: number) => Promise<void>;
  onDeleteResult?: (resultId: string) => Promise<void>;
  onOpenGoogleSheets?: (targetResults: ExamResult[], defaultTitle?: string) => void;
}

export const ResultsPanel: React.FC<ResultsPanelProps> = ({
  results,
  exams,
  subjects,
  classes,
  lockedSubject,
  initialStatusFilter = 'ALL',
  onUpdateEssayScore,
  onDeleteResult,
  onOpenGoogleSheets,
}) => {
  const [search, setSearch] = useState('');
  const [filterMapel, setFilterMapel] = useState(lockedSubject || 'ALL');
  const [filterKelas, setFilterKelas] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'Selesai' | 'Pelanggaran'>(
    initialStatusFilter
  );
  const [editingResult, setEditingResult] = useState<ExamResult | null>(null);
  const [essayScoreInput, setEssayScoreInput] = useState<number>(0);
  const [aiGradingLoading, setAiGradingLoading] = useState(false);
  const [aiGradingNote, setAiGradingNote] = useState<string | null>(null);

  const effectiveFilterMapel = lockedSubject
    ? lockedSubject
    : filterMapel === 'ALL' || subjects.includes(filterMapel)
      ? filterMapel
      : 'ALL';

  const scopeResults = useMemo(() => {
    return results.filter((r) => {
      if (lockedSubject && r.mataPelajaran !== lockedSubject) return false;
      if (!lockedSubject && effectiveFilterMapel !== 'ALL' && r.mataPelajaran !== effectiveFilterMapel)
        return false;
      if (filterKelas !== 'ALL' && r.kelas !== filterKelas) return false;
      return true;
    });
  }, [results, lockedSubject, effectiveFilterMapel, filterKelas]);

  const statusCounts = useMemo(
    () => ({
      ALL: scopeResults.length,
      Selesai: scopeResults.filter((r) => r.status === 'Selesai').length,
      Pelanggaran: scopeResults.filter((r) => r.status === 'Pelanggaran').length,
    }),
    [scopeResults]
  );

  // IMPORTANT: Show ALL results (both "Selesai" AND "Pelanggaran") without ever hiding normal completions!
  const filteredResults = useMemo(() => {
    return scopeResults
      .filter((r) => {
        if (filterStatus !== 'ALL' && r.status !== filterStatus) return false;
        if (
          search.trim() &&
          !r.namaSiswa.toLowerCase().includes(search.trim().toLowerCase()) &&
          !r.judulUjian.toLowerCase().includes(search.trim().toLowerCase())
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.waktuSubmit).getTime() - new Date(a.waktuSubmit).getTime());
  }, [scopeResults, filterStatus, search]);

  const openEssayGrading = (r: ExamResult) => {
    setEditingResult(r);
    setEssayScoreInput(r.skorEsai);
    setAiGradingNote(null);
  };

  const relatedExam = editingResult
    ? exams.find((e) => e.id === editingResult.examId)
    : undefined;
  const editingViolations = editingResult
    ? getViolationHistoryForResult(editingResult)
    : [];
  const editingHasEssay = Boolean(editingResult?.jawabanDetail.some((d) => d.tipe === 'ESAI'));

  const handleSuggestEssayScoreAI = async () => {
    if (!editingResult || aiGradingLoading) return;
    const essayDetails = editingResult.jawabanDetail.filter((d) => d.tipe === 'ESAI');
    if (essayDetails.length === 0) return;

    setAiGradingLoading(true);
    setAiGradingNote(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 45000);
    try {
      const items = essayDetails.map((ans) => {
        const snap = relatedExam?.questionsSnapshot.find((q) => q.id === ans.questionId);
        return {
          questionHtml: snap?.pertanyaanHtml || `Soal Esai (${editingResult.mataPelajaran})`,
          rubric: snap?.kunciJawaban?.join('; ') || '',
          studentAnswer: ans.jawaban.join(' ') || '',
          bobot: snap?.bobot || 20,
        };
      });
      const res = await fetch('/api/gemini/suggest-essay-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          mataPelajaran: editingResult.mataPelajaran,
          items,
        }),
      });
      const { data } = await safeParseResponseJson<{
        suggestedPercent?: number;
        reason?: string;
        error?: string;
      }>(res);
      if (res.ok && data && typeof data.suggestedPercent === 'number') {
        setEssayScoreInput(data.suggestedPercent);
        setAiGradingNote(data.reason || 'Saran skor AI diterapkan.');
      } else {
        setAiGradingNote(formatClientFetchError(null, res.status, data?.error));
      }
    } catch (err) {
      setAiGradingNote(formatClientFetchError(err));
    } finally {
      window.clearTimeout(timer);
      setAiGradingLoading(false);
    }
  };

  const saveEssayGrade = async () => {
    if (!editingResult) return;
    const { skorEsai, nilaiAkhir } = recalculateResultWithEssayScore(
      editingResult,
      relatedExam?.questionsSnapshot,
      essayScoreInput
    );
    await onUpdateEssayScore(editingResult.id, skorEsai, nilaiAkhir);
    setEditingResult(null);
    setAiGradingNote(null);
  };

  return (
    <div className="space-y-4 panel-enter">
      {/* Unified Filter & Export Toolbar */}
      <div className="surface-card p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama siswa atau ujian..."
                className="glass-input w-full rounded-xl pl-9 pr-3 py-2 text-sm text-slate-900"
              />
            </div>

            {!lockedSubject && (
              <select
                value={effectiveFilterMapel}
                onChange={(e) => setFilterMapel(e.target.value)}
                aria-label="Filter Mata Pelajaran"
                className="glass-input rounded-xl px-3 py-2 text-sm text-slate-900"
              >
                <option value="ALL">Semua Mapel</option>
                {subjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}

            <select
              value={filterKelas}
              onChange={(e) => setFilterKelas(e.target.value)}
              aria-label="Filter Kelas"
              className="glass-input rounded-xl px-3 py-2 text-sm text-slate-900"
            >
              <option value="ALL">Semua Kelas</option>
              {classes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenGoogleSheets && (
              <button
                type="button"
                onClick={() =>
                  onOpenGoogleSheets(
                    filteredResults,
                    lockedSubject
                      ? `Rekap Nilai ${lockedSubject} CBT MTs Nurul Hijrah`
                      : 'Rekap Nilai CBT MTs Nurul Hijrah'
                  )
                }
                className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/70 bg-white/80 px-3.5 py-2 text-xs font-bold text-emerald-800 hover:bg-white whitespace-nowrap shrink-0 shadow-sm"
              >
                <TableProperties className="h-4 w-4 text-emerald-700" />
                <span>Google Sheets</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => exportExamResultsToExcel(filteredResults)}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0 shadow-sm"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>Ekspor Excel</span>
            </button>
            <button
              type="button"
              onClick={() => exportExamResultsToCSV(filteredResults)}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-white/65 bg-white/60 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-white/85 whitespace-nowrap shrink-0"
            >
              <Download className="h-4 w-4" />
              <span>Unduh CSV</span>
            </button>
            <button
              type="button"
              onClick={() =>
                exportExamResultsToPDFPrint(
                  filteredResults,
                  lockedSubject ? `Rekap Nilai ${lockedSubject}` : 'Rekap Nilai Seluruh Mapel'
                )
              }
              className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-white/65 bg-white/60 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-white/85 whitespace-nowrap shrink-0"
            >
              <Printer className="h-4 w-4" />
              <span>Cetak / PDF</span>
            </button>
          </div>
        </div>

        {/* Interactive Segmented Status Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/50 pt-3">
          <div className="glass-subtle inline-flex max-w-full overflow-x-auto items-center gap-1 rounded-xl p-1">
            {(
              [
                { id: 'ALL', label: 'Semua' },
                { id: 'Selesai', label: 'Selesai Normal' },
                { id: 'Pelanggaran', label: 'Pelanggaran' },
              ] as const
            ).map((tab) => {
              const active = filterStatus === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterStatus(tab.id)}
                  className={`btn-press rounded-lg px-3 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? tab.id === 'Pelanggaran'
                        ? 'bg-red-600 text-white shadow-sm'
                        : 'bg-white/85 text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
                  }`}
                >
                  {tab.label} ({statusCounts[tab.id]})
                </button>
              );
            })}
          </div>

          <span className="text-xs text-slate-500 font-mono-tabular">
            Menampilkan {filteredResults.length} baris
          </span>
        </div>
      </div>

      {/* Mobile Card List (< md) + Tablet/Desktop Data Table (>= md) */}
      <div className="surface-card overflow-hidden">
        {/* Mobile Card View */}
        <div className="md:hidden divide-y divide-white/50">
          {filteredResults.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              Belum ada hasil ujian yang masuk untuk filter ini.
            </div>
          ) : (
            filteredResults.map((r) => {
              const vioCount = getViolationHistoryForResult(r).length;
              return (
                <div key={`mob-res-${r.id}`} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-900 truncate">{r.namaSiswa}</p>
                      <p className="text-xs text-slate-600 truncate">
                        {r.kelas} &middot; {r.mataPelajaran}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">{r.judulUjian}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-mono-tabular text-lg font-bold text-slate-900">
                        {r.nilaiAkhir}
                      </span>
                      <p className="font-mono-tabular text-[10px] text-slate-500">
                        PG {r.skorPG} · Esai {r.skorEsai}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    {r.status === 'Selesai' ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        <span>Selesai (Normal)</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                        <AlertOctagon className="h-3.5 w-3.5 shrink-0" />
                        <span>Pelanggaran ({r.pelanggaranTab}x)</span>
                      </span>
                    )}
                    <span className="font-mono-tabular text-[11px] text-slate-500">
                      {new Date(r.waktuSubmit).toLocaleString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => openEssayGrading(r)}
                      className="btn-press min-h-[42px] flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/70 bg-white/65 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-white"
                    >
                      <Edit3 className="h-3.5 w-3.5 text-emerald-700" />
                      <span>
                        {vioCount > 0 ? `Detail & Pelanggaran (${vioCount})` : 'Detail / Koreksi Esai'}
                      </span>
                    </button>
                    {onDeleteResult && (
                      <button
                        type="button"
                        onClick={() => onDeleteResult(r.id)}
                        aria-label={`Hapus hasil ${r.namaSiswa}`}
                        className="btn-press min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl border border-red-300/60 bg-red-500/10 text-red-600 hover:bg-red-500/20 shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Tablet/Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/55 bg-white/40 backdrop-blur-sm text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3">Waktu</th>
                <th className="px-4 py-3">Nama Siswa</th>
                <th className="px-4 py-3">Kelas</th>
                <th className="px-4 py-3">Mata Pelajaran</th>
                <th className="px-4 py-3 text-right">PG</th>
                <th className="px-4 py-3 text-right">Esai</th>
                <th className="px-4 py-3 text-right">Nilai Akhir</th>
                <th className="px-4 py-3">Status &amp; Pelanggaran</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/45">
              {filteredResults.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                    Belum ada hasil ujian yang masuk untuk filter ini.
                  </td>
                </tr>
              ) : (
                filteredResults.map((r) => {
                  const vioCount = getViolationHistoryForResult(r).length;
                  return (
                    <tr key={r.id} className="hover:bg-white/45 transition-colors">
                      <td className="px-4 py-3 text-xs text-slate-500 font-mono-tabular whitespace-nowrap">
                        {new Date(r.waktuSubmit).toLocaleString('id-ID', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        <div>{r.namaSiswa}</div>
                        <div className="text-xs text-slate-500">
                          {r.noPeserta ? (
                            <span className="font-mono-tabular font-semibold text-slate-600">
                              No. {r.noPeserta} &middot;{' '}
                            </span>
                          ) : null}
                          {r.judulUjian}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{r.kelas}</td>
                      <td className="px-4 py-3 text-slate-700">{r.mataPelajaran}</td>
                      <td className="px-4 py-3 text-right font-mono-tabular text-slate-700">
                        {r.skorPG}
                      </td>
                      <td className="px-4 py-3 text-right font-mono-tabular text-slate-700">
                        {r.skorEsai}
                      </td>
                      <td className="px-4 py-3 text-right font-mono-tabular font-bold text-slate-900">
                        {r.nilaiAkhir}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {r.status === 'Selesai' ? (
                          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            <span>Selesai (Normal)</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
                            <AlertOctagon className="h-3.5 w-3.5 shrink-0" />
                            <span>Pelanggaran</span>
                          </div>
                        )}
                        <div className="mt-0.5 text-[11px] text-slate-500 font-mono-tabular">
                          Keluar: {r.pelanggaranTab}x
                          {(r.peringatanWajah ?? 0) > 0 ? ` · Kamera/Wajah: ${r.peringatanWajah}x` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEssayGrading(r)}
                            className="btn-press inline-flex items-center gap-1 rounded-xl border border-white/65 bg-white/55 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-800"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>
                              {vioCount > 0
                                ? `Detail & Pelanggaran (${vioCount})`
                                : 'Detail / Esai'}
                            </span>
                          </button>
                          {onDeleteResult && (
                            <button
                              type="button"
                              onClick={() => onDeleteResult(r.id)}
                              aria-label={`Hapus hasil ${r.namaSiswa}`}
                              className="btn-press rounded-xl border border-red-300/60 bg-red-500/10 p-1.5 text-red-600 hover:bg-red-500/20"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Essay & Detail Modal */}
      {editingResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
        >
          <div className="glass-modal flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/55 px-5 py-4">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Detail Jawaban &amp; Koreksi Esai: {editingResult.namaSiswa}
                </h3>
                <p className="text-xs text-slate-500">
                  {editingResult.kelas} · {editingResult.mataPelajaran} · Status:{' '}
                  {editingResult.status === 'Selesai' ? 'Selesai (Normal)' : 'Pelanggaran'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingResult(null)}
                className="btn-press rounded-xl p-1.5 text-slate-500 hover:bg-white/60"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Teacher Post-Exam Violation History Review Section */}
              <div
                className={`rounded-2xl border p-4 backdrop-blur-sm ${
                  editingViolations.length > 0 || editingResult.pelanggaranTab > 0
                    ? 'border-red-300/60 bg-red-500/10'
                    : 'border-emerald-300/60 bg-emerald-500/10'
                }`}
                data-testid="violation-history-review"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <h4 className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900">
                    <ShieldAlert
                      className={`h-4 w-4 ${
                        editingViolations.length > 0 || editingResult.pelanggaranTab > 0
                          ? 'text-red-600'
                          : 'text-emerald-700'
                      }`}
                    />
                    <span>Riwayat Pelanggaran Selama Ujian</span>
                  </h4>
                  <span className="font-mono-tabular text-[11px] font-semibold text-slate-600">
                    Total Keluar: {editingResult.pelanggaranTab}x
                  </span>
                </div>

                {editingResult.alasanSubmit && (
                  <p className="text-xs text-slate-600 mb-2">
                    <strong>Catatan Pengumpulan:</strong> {editingResult.alasanSubmit}
                  </p>
                )}

                {editingViolations.length === 0 ? (
                  <p className="text-xs text-emerald-800">
                    {editingResult.pelanggaranTab > 0
                      ? 'Tercatat pelanggaran keluar aplikasi, rincian log lokal tidak tersedia.'
                      : 'Tidak ada pelanggaran keluar aplikasi selama sesi ujian ini.'}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {editingViolations.map((vio, vIdx) => (
                      <li
                        key={vio.id || vIdx}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-300/60 bg-white/65 px-3 py-2 text-xs"
                      >
                        <div className="flex items-start gap-2">
                          <span className="rounded-lg bg-red-100 px-1.5 py-0.5 font-mono-tabular text-[11px] font-bold text-red-800">
                            #{vio.strikeNumber}
                          </span>
                          <div>
                            <p className="font-semibold text-slate-900">{vio.reason}</p>
                            {vio.returnedAt && typeof vio.durationAwaySeconds === 'number' && (
                              <p className="text-[11px] text-slate-500">
                                Kembali ke ujian setelah {vio.durationAwaySeconds} detik
                              </p>
                            )}
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1 font-mono-tabular text-[11px] text-slate-600">
                          <Clock className="h-3 w-3 text-slate-400" />
                          {new Date(vio.timestamp).toLocaleString('id-ID', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {editingResult.jawabanDetail.map((ans, idx) => {
                const q = relatedExam?.questionsSnapshot.find((item) => item.id === ans.questionId);
                return (
                  <div key={ans.questionId + idx} className="glass-subtle rounded-2xl p-3.5">
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                      <span className="font-semibold text-slate-700">
                        Soal #{idx + 1} ({ans.tipe})
                      </span>
                      {ans.tipe !== 'ESAI' && (
                        <span className={ans.benar ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold'}>
                          {ans.benar ? 'Benar' : 'Salah'}
                        </span>
                      )}
                    </div>
                    {q && (
                      <div
                        className="rich-question-content text-sm text-slate-800 mb-2"
                        dangerouslySetInnerHTML={{ __html: q.pertanyaanHtml }}
                      />
                    )}
                    <div className="rounded-xl border border-white/60 bg-white/55 px-3 py-2 text-xs text-slate-700">
                      <strong>Jawaban Siswa:</strong>{' '}
                      {ans.jawaban.length > 0 ? ans.jawaban.join(', ') : '(Tidak dijawab)'}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/50 bg-white/35 px-5 py-3.5">
              {editingHasEssay ? (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor="essay-score-input" className="text-xs font-semibold text-slate-700">
                      Nilai Esai (0–100):
                    </label>
                    <input
                      id="essay-score-input"
                      type="number"
                      min={0}
                      max={100}
                      value={Number.isFinite(essayScoreInput) ? essayScoreInput : ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setEssayScoreInput(raw === '' ? 0 : Number(raw));
                      }}
                      className="glass-input w-24 rounded-xl px-2.5 py-1.5 text-sm font-mono-tabular text-slate-900"
                    />
                    <button
                      type="button"
                      disabled={aiGradingLoading}
                      onClick={handleSuggestEssayScoreAI}
                      className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-emerald-300/70 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-500/25 disabled:opacity-50"
                    >
                      {aiGradingLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      <span>{aiGradingLoading ? 'Menilai...' : 'Saran Nilai AI'}</span>
                    </button>
                  </div>
                  {aiGradingNote && (
                    <p className="text-[11px] text-emerald-800 max-w-md">{aiGradingNote}</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  Paket soal objektif penuh — nilai akhir dihitung otomatis.
                </p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingResult(null)}
                  className="btn-press rounded-xl border border-white/65 bg-white/60 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white/85"
                >
                  Tutup
                </button>
                {editingHasEssay && (
                  <button
                    type="button"
                    onClick={saveEssayGrade}
                    className="btn-press rounded-xl bg-emerald-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 shadow-sm"
                  >
                    Simpan Nilai Esai
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
