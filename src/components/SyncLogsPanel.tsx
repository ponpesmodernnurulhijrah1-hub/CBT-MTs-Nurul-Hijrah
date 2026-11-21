import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  AlertTriangle,
  RefreshCw,
  Search,
  Download,
  CloudCheck,
  CloudOff,
  Smartphone,
  Globe,
  Database,
  History,
} from 'lucide-react';
import type {
  SyncLogEntity,
  SyncLogEntry,
  SyncLogStatus,
  SyncStatusInfo,
} from '../types/cbt';
import { buildSyncLogsCsv, filterSyncLogs } from '../utils/storeSyncUtils';

interface SyncLogsPanelProps {
  logs: SyncLogEntry[];
  syncInfo: SyncStatusInfo;
  onForceSync?: () => Promise<void>;
}

const ENTITY_OPTIONS: Array<'ALL' | SyncLogEntity> = [
  'ALL',
  'Mapel',
  'Kelas',
  'Guru',
  'Soal',
  'Jadwal',
  'Hasil Ujian',
  'Pengawasan',
  'Sistem',
];

const STATUS_OPTIONS: Array<{ value: 'ALL' | SyncLogStatus; label: string }> = [
  { value: 'ALL', label: 'Semua Status' },
  { value: 'Berhasil', label: 'Berhasil' },
  { value: 'Menunggu', label: 'Menunggu' },
  { value: 'Gagal', label: 'Gagal' },
];

function formatAuditTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatRelativeTime(tsMs: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
  if (diffSec < 10) return 'Baru saja';
  if (diffSec < 60) return `${diffSec} dtk lalu`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} mnt lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} jam lalu`;
  return `${Math.floor(diffHr / 24)} hr lalu`;
}

export const SyncLogsPanel: React.FC<SyncLogsPanelProps> = ({
  logs,
  syncInfo,
  onForceSync,
}) => {
  const [statusFilter, setStatusFilter] = useState<'ALL' | SyncLogStatus>('ALL');
  const [entityFilter, setEntityFilter] = useState<'ALL' | SyncLogEntity>('ALL');
  const [search, setSearch] = useState('');
  const [syncingNow, setSyncingNow] = useState(false);

  const counts = useMemo(() => {
    let success = 0;
    let pending = 0;
    let failed = 0;
    for (const item of logs) {
      if (item.status === 'Berhasil') success += 1;
      else if (item.status === 'Menunggu') pending += 1;
      else failed += 1;
    }
    return { total: logs.length, success, pending, failed };
  }, [logs]);

  const filteredLogs = useMemo(
    () =>
      filterSyncLogs(logs, {
        status: statusFilter,
        entity: entityFilter,
        search,
      }),
    [logs, statusFilter, entityFilter, search]
  );

  const handleManualSync = async () => {
    if (!onForceSync || syncingNow) return;
    setSyncingNow(true);
    try {
      await onForceSync();
    } finally {
      window.setTimeout(() => setSyncingNow(false), 350);
    }
  };

  const handleExportCsv = () => {
    const target = filteredLogs.length > 0 ? filteredLogs : logs;
    if (target.length === 0) return;
    const csv = buildSyncLogsCsv(target);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateTag = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `Log_Sinkronisasi_CBT_${dateTag}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 panel-enter">
      {/* Top Audit Summary KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="surface-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Total Riwayat Audit</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/75 border border-white/80 text-slate-700">
              <History className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-bold text-slate-900">
            {counts.total}
          </p>
          <p className="mt-1 text-[11px] text-slate-600">
            Log tersimpan otomatis lintas perangkat
          </p>
        </div>

        <div className="surface-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Berhasil Tersinkron</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-400/35 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-bold text-emerald-800">
            {counts.success}
          </p>
          <p className="mt-1 text-[11px] text-slate-600">
            Terkonfirmasi masuk Cloud Firestore
          </p>
        </div>

        <div className="surface-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Menunggu / Antrean</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-400/35 text-amber-700">
              <Clock3 className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-bold text-amber-800">
            {counts.pending + syncInfo.queuedMutationsCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-600">
            {syncInfo.queuedMutationsCount > 0
              ? `${syncInfo.queuedMutationsCount} antrean offline aktif`
              : 'Tidak ada antrean tertunda'}
          </p>
        </div>

        <div className="surface-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Status Sambungan Pusat</span>
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-xl border ${
                syncInfo.cloudConnected
                  ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-700'
                  : 'bg-amber-500/15 border-amber-400/35 text-amber-700'
              }`}
            >
              {syncInfo.cloudConnected ? (
                <CloudCheck className="h-4 w-4" />
              ) : (
                <CloudOff className="h-4 w-4" />
              )}
            </span>
          </div>
          <p className="mt-2 text-sm font-bold text-slate-900">
            {syncInfo.cloudConnected ? 'Terhubung Real-Time' : 'Mode Offline Lokal'}
          </p>
          <p className="mt-1 text-[11px] text-slate-600">
            {counts.failed > 0 ? `${counts.failed} catatan gagal tersimpan` : 'Nol kegagalan sinkron'}
          </p>
        </div>
      </div>

      {/* Controls: Filters, Search & Actions */}
      <div className="surface-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Audit Riwayat Sinkronisasi Database Pusat
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Pantau setiap perubahan yang disinkronkan secara otomatis dari portal Admin, Guru, maupun Siswa ke Firestore secara real-time.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={logs.length === 0}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-white/75 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-white/95 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5 text-emerald-700" />
              <span>Ekspor Log CSV</span>
            </button>
            {onForceSync && (
              <button
                type="button"
                onClick={handleManualSync}
                disabled={syncingNow}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncingNow ? 'animate-spin' : ''}`} />
                <span>{syncingNow ? 'Memverifikasi...' : 'Sinkronkan & Verifikasi'}</span>
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-6 relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari aktivitas, nama aktor, perangkat (PWA/WEB), atau koleksi..."
              aria-label="Cari riwayat sinkronisasi"
              className="glass-input w-full rounded-xl pl-10 pr-4 py-2 text-xs text-slate-900"
            />
          </div>

          <div className="md:col-span-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'ALL' | SyncLogStatus)}
              aria-label="Filter status sinkronisasi"
              className="glass-input w-full rounded-xl px-3 py-2 text-xs font-medium text-slate-800"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value as 'ALL' | SyncLogEntity)}
              aria-label="Filter kategori data"
              className="glass-input w-full rounded-xl px-3 py-2 text-xs font-medium text-slate-800"
            >
              {ENTITY_OPTIONS.map((ent) => (
                <option key={ent} value={ent}>
                  {ent === 'ALL' ? 'Semua Kategori Data' : ent}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Audit Feed */}
        {filteredLogs.length === 0 ? (
          <div className="glass-subtle rounded-2xl p-8 text-center">
            <Database className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-2 text-sm font-semibold text-slate-800">
              {logs.length === 0
                ? 'Belum ada riwayat perubahan yang tercatat pada sesi ini.'
                : 'Tidak ada log sinkronisasi yang cocok dengan filter pencarian.'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Setiap perubahan mapel, kelas, guru, soal, jadwal, maupun verifikasi sinkronisasi akan muncul otomatis di sini secara real-time.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredLogs.map((entry) => {
              const isSuccess = entry.status === 'Berhasil';
              const isPending = entry.status === 'Menunggu';
              const isPwa = entry.deviceId.startsWith('PWA-');

              return (
                <div
                  key={entry.id}
                  className="glass-subtle rounded-2xl p-3.5 sm:p-4 transition-colors hover:bg-white/50"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-start gap-3 min-w-0">
                      <span
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                          isSuccess
                            ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-700'
                            : isPending
                              ? 'bg-amber-500/15 border-amber-400/40 text-amber-700'
                              : 'bg-red-500/15 border-red-400/40 text-red-700'
                        }`}
                      >
                        {isSuccess ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : isPending ? (
                          <Clock3 className="h-4 w-4" />
                        ) : (
                          <AlertTriangle className="h-4 w-4" />
                        )}
                      </span>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-lg px-2 py-0.5 text-[10px] font-bold ${
                              isSuccess
                                ? 'bg-emerald-100 text-emerald-800'
                                : isPending
                                  ? 'bg-amber-100 text-amber-900'
                                  : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {entry.status}
                          </span>
                          <span className="rounded-lg bg-slate-900/10 px-2 py-0.5 text-[10px] font-semibold text-slate-800">
                            {entry.action} · {entry.entity}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-lg bg-white/75 border border-white/80 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                            {isPwa ? (
                              <Smartphone className="h-3 w-3 text-emerald-700" />
                            ) : (
                              <Globe className="h-3 w-3 text-sky-700" />
                            )}
                            <span>{entry.deviceId}</span>
                          </span>
                        </div>

                        <p className="mt-1.5 text-xs sm:text-sm font-bold text-slate-900">
                          {entry.summary}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-600 break-words">
                          <span className="font-semibold text-slate-700">
                            {entry.actorName} ({entry.actorRole})
                          </span>{' '}
                          &middot; {entry.details}
                        </p>

                        {entry.errorMessage && (
                          <p className="mt-1.5 rounded-xl border border-red-300/70 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-800">
                            Kendala: {entry.errorMessage}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="font-mono-tabular text-[11px] font-semibold text-slate-800">
                        {formatRelativeTime(entry.timestampMs)}
                      </p>
                      <p className="font-mono-tabular text-[10px] text-slate-500">
                        {formatAuditTime(entry.timestamp)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
