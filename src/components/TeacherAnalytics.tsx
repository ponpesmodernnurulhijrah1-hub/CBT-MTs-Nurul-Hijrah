import React, { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  Users,
  Award,
  CheckCircle2,
  ShieldAlert,
  ArrowUpRight,
  X,
} from 'lucide-react';
import type { ExamResult } from '../types/cbt';
import { computeClassAverages, computeScoreDistribution } from '../utils/examLogic';

interface TeacherAnalyticsProps {
  results: ExamResult[];
  title?: string;
  onNavigateResults?: (presetStatus?: 'ALL' | 'Selesai' | 'Pelanggaran') => void;
}

const BUCKET_COLORS = ['#dc2626', '#d97706', '#0284c7', '#059669'];

export const TeacherAnalytics: React.FC<TeacherAnalyticsProps> = ({
  results,
  title = 'Analisis Distribusi Nilai & Performa Kelas',
  onNavigateResults,
}) => {
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);

  const distribution = useMemo(() => computeScoreDistribution(results), [results]);
  const classAverages = useMemo(() => computeClassAverages(results), [results]);

  const totalSubmissions = results.length;
  const avgScore =
    totalSubmissions > 0
      ? Math.round((results.reduce((acc, r) => acc + r.nilaiAkhir, 0) / totalSubmissions) * 10) / 10
      : 0;
  const passCount = results.filter((r) => r.nilaiAkhir >= 75).length;
  const passRate = totalSubmissions > 0 ? Math.round((passCount / totalSubmissions) * 100) : 0;
  const violationCount = results.filter((r) => r.status === 'Pelanggaran').length;

  const drilldownResults = useMemo(() => {
    if (selectedClass) {
      return results.filter((r) => r.kelas === selectedClass);
    }
    if (selectedBucket) {
      return results.filter((r) => {
        if (selectedBucket === '0-49') return r.nilaiAkhir < 50;
        if (selectedBucket === '50-69') return r.nilaiAkhir >= 50 && r.nilaiAkhir < 70;
        if (selectedBucket === '70-84') return r.nilaiAkhir >= 70 && r.nilaiAkhir < 85;
        if (selectedBucket === '85-100') return r.nilaiAkhir >= 85;
        return false;
      });
    }
    return [];
  }, [results, selectedBucket, selectedClass]);

  return (
    <div className="space-y-6 panel-enter">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-lg font-bold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">
            Klik batang grafik atau kartu metrik untuk melihat rincian performa peserta secara instan.
          </p>
        </div>
        <span className="text-xs font-medium text-slate-500 font-mono-tabular">
          Total Data: <strong className="text-slate-900">{totalSubmissions}</strong> peserta
        </span>
      </div>

      {/* Summary KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => onNavigateResults?.('ALL')}
          className="surface-card-interactive p-4 text-left group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Total Hasil Masuk</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/65 bg-white/60 text-slate-700 group-hover:bg-slate-900 group-hover:text-white transition-colors">
              <Users className="h-3.5 w-3.5" />
            </span>
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-bold tracking-tight text-slate-900">
            {totalSubmissions}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 inline-flex items-center gap-1">
            <span>Lembar jawaban tersimpan</span>
            {onNavigateResults && <ArrowUpRight className="h-3 w-3 opacity-60" />}
          </p>
        </button>

        <div className="surface-card-interactive p-4 text-left">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Rata-Rata Nilai</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-300/60 bg-emerald-500/15 text-emerald-700">
              <Award className="h-3.5 w-3.5" />
            </span>
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-bold tracking-tight text-emerald-700">
            {avgScore}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Skala penilaian 0–100</p>
        </div>

        <button
          type="button"
          onClick={() => onNavigateResults?.('Selesai')}
          className="surface-card-interactive p-4 text-left group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Ketuntasan (&ge; 75)</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-300/60 bg-emerald-500/15 text-emerald-700 group-hover:bg-emerald-700 group-hover:text-white transition-colors">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </span>
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-bold tracking-tight text-slate-900">
            {passRate}%
          </p>
          <p className="mt-1 text-[11px] text-slate-500 font-mono-tabular">
            {passCount} dari {totalSubmissions} peserta tuntas
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigateResults?.('Pelanggaran')}
          className="surface-card-interactive p-4 text-left group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Status Pelanggaran</span>
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-xl border transition-colors ${
                violationCount > 0
                  ? 'border-red-300/60 bg-red-500/15 text-red-600 group-hover:bg-red-600 group-hover:text-white'
                  : 'border-white/65 bg-white/60 text-slate-500'
              }`}
            >
              <ShieldAlert className="h-3.5 w-3.5" />
            </span>
          </div>
          <p
            className={`mt-2 font-mono-tabular text-2xl font-bold tracking-tight ${
              violationCount > 0 ? 'text-red-600' : 'text-slate-900'
            }`}
          >
            {violationCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 inline-flex items-center gap-1">
            <span>{violationCount > 0 ? 'Perlu tinjauan pengawas' : 'Nihil pelanggaran'}</span>
            {onNavigateResults && <ArrowUpRight className="h-3 w-3 opacity-60" />}
          </p>
        </button>
      </div>

      {totalSubmissions === 0 ? (
        <div className="surface-card border-dashed p-10 text-center">
          <p className="text-sm font-semibold text-slate-700">
            Belum ada hasil ujian yang terekam
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Grafik distribusi nilai dan perbandingan kelas akan tampil otomatis setelah siswa mengirimkan jawaban.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart 1: Interactive Score Distribution */}
            <div className="surface-card p-5">
              <div className="flex items-start justify-between gap-2 mb-4">
                <div>
                  <h4 className="font-display text-sm font-bold text-slate-900">
                    Distribusi Rentang Nilai Siswa
                  </h4>
                  <p className="text-xs text-slate-500">
                    Klik batang rentang nilai (0–100) untuk menyaring peserta
                  </p>
                </div>
                {selectedBucket && (
                  <button
                    type="button"
                    onClick={() => setSelectedBucket(null)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:underline"
                  >
                    <X className="h-3 w-3" />
                    <span>Reset ({selectedBucket})</span>
                  </button>
                )}
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distribution} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.28)" />
                    <XAxis
                      dataKey="rentang"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: '#334155' }}
                    />
                    <YAxis
                      allowDecimals={false}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: '#334155' }}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(255, 255, 255, 0.45)' }}
                      formatter={(val) => [`${val} siswa`, 'Jumlah']}
                      contentStyle={{
                        backgroundColor: 'rgba(15, 23, 42, 0.88)',
                        backdropFilter: 'blur(12px)',
                        border: '1px solid rgba(255, 255, 255, 0.18)',
                        borderRadius: '14px',
                        color: '#ffffff',
                        fontSize: '12px',
                      }}
                      itemStyle={{ color: '#34d399', fontWeight: 600 }}
                      labelStyle={{ color: '#e2e8f0', marginBottom: '2px' }}
                    />
                    <Bar
                      dataKey="jumlah"
                      isAnimationActive={false}
                      maxBarSize={58}
                      radius={[6, 6, 0, 0]}
                      className="cursor-pointer"
                      onClick={(data) => {
                        const rentang = (data as { rentang?: string })?.rentang;
                        if (rentang) {
                          setSelectedClass(null);
                          setSelectedBucket((prev) => (prev === rentang ? null : rentang));
                        }
                      }}
                    >
                      {distribution.map((entry, idx) => {
                        const isDimmed = selectedBucket && selectedBucket !== entry.rentang;
                        return (
                          <Cell
                            key={entry.rentang}
                            fill={BUCKET_COLORS[idx % BUCKET_COLORS.length]}
                            fillOpacity={isDimmed ? 0.3 : 1}
                          />
                        );
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 2: Interactive Class Average Performance */}
            <div className="surface-card p-5">
              <div className="flex items-start justify-between gap-2 mb-4">
                <div>
                  <h4 className="font-display text-sm font-bold text-slate-900">
                    Rata-Rata Performa Per Kelas
                  </h4>
                  <p className="text-xs text-slate-500">
                    Klik batang kelas untuk melihat daftar nilai rombel tersebut
                  </p>
                </div>
                {selectedClass && (
                  <button
                    type="button"
                    onClick={() => setSelectedClass(null)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:underline"
                  >
                    <X className="h-3 w-3" />
                    <span>Reset ({selectedClass})</span>
                  </button>
                )}
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={classAverages} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.28)" />
                    <XAxis
                      dataKey="kelas"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: '#334155' }}
                    />
                    <YAxis
                      domain={[0, 100]}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: '#334155' }}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(255, 255, 255, 0.45)' }}
                      formatter={(val) => [`${val}`, 'Rata-rata']}
                      contentStyle={{
                        backgroundColor: 'rgba(15, 23, 42, 0.88)',
                        backdropFilter: 'blur(12px)',
                        border: '1px solid rgba(255, 255, 255, 0.18)',
                        borderRadius: '14px',
                        color: '#ffffff',
                        fontSize: '12px',
                      }}
                      itemStyle={{ color: '#34d399', fontWeight: 600 }}
                      labelStyle={{ color: '#e2e8f0', marginBottom: '2px' }}
                    />
                    <Bar
                      dataKey="rataRata"
                      isAnimationActive={false}
                      maxBarSize={58}
                      radius={[6, 6, 0, 0]}
                      className="cursor-pointer"
                      onClick={(data) => {
                        const kelasName = (data as { kelas?: string })?.kelas;
                        if (kelasName) {
                          setSelectedBucket(null);
                          setSelectedClass((prev) => (prev === kelasName ? null : kelasName));
                        }
                      }}
                    >
                      {classAverages.map((entry) => {
                        const isDimmed = selectedClass && selectedClass !== entry.kelas;
                        return (
                          <Cell
                            key={entry.kelas}
                            fill="#047857"
                            fillOpacity={isDimmed ? 0.3 : 1}
                          />
                        );
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Interactive Chart Drilldown Drawer */}
          {(selectedBucket || selectedClass) && (
            <div className="surface-card p-5 panel-enter">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/55">
                <div className="text-xs font-semibold text-slate-900">
                  {selectedClass
                    ? `Daftar Peserta Kelas ${selectedClass}`
                    : `Peserta dengan Rentang Nilai ${selectedBucket}`}
                  <span className="ml-2 font-mono-tabular text-slate-500">
                    ({drilldownResults.length} siswa)
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {onNavigateResults && (
                    <button
                      type="button"
                      onClick={() => onNavigateResults('ALL')}
                      className="text-xs font-semibold text-emerald-700 hover:underline"
                    >
                      Buka Rekap Lengkap
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedBucket(null);
                      setSelectedClass(null);
                    }}
                    className="btn-press rounded-xl p-1.5 text-slate-500 hover:bg-white/60 hover:text-slate-800"
                    aria-label="Tutup rincian grafik"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {drilldownResults.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-500">
                  Tidak ada peserta pada kategori grafik ini.
                </p>
              ) : (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {drilldownResults.slice(0, 9).map((r) => (
                    <div
                      key={r.id}
                      className="glass-subtle flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs"
                    >
                      <div className="min-w-0 pr-2">
                        <p className="truncate font-semibold text-slate-900">{r.namaSiswa}</p>
                        <p className="truncate text-[11px] text-slate-500">
                          {r.kelas} · {r.mataPelajaran}
                        </p>
                      </div>
                      <span
                        className={`font-mono-tabular text-sm font-bold shrink-0 ${
                          r.status === 'Pelanggaran'
                            ? 'text-red-600'
                            : r.nilaiAkhir >= 75
                              ? 'text-emerald-700'
                              : 'text-amber-700'
                        }`}
                      >
                        {r.nilaiAkhir}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
