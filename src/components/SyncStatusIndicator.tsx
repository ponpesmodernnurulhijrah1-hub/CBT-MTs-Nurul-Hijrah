import React, { useEffect, useRef, useState } from 'react';
import { CloudCheck, CloudOff, AlertTriangle, RefreshCw, CheckCircle2, Database, History } from 'lucide-react';
import type { SyncStatusInfo } from '../types/cbt';

interface SyncStatusIndicatorProps {
  syncInfo: SyncStatusInfo;
  onForceSync?: () => Promise<void> | void;
  onOpenSyncLogs?: () => void;
  variant?: 'banner' | 'sidebar' | 'compact';
  className?: string;
}

function formatSyncTime(iso: string | null): string {
  if (!iso) return 'Baru saja';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Baru saja';
  const diffSec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diffSec < 10) return 'Baru saja';
  if (diffSec < 60) return `${diffSec} dtk lalu`;
  return d.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const SyncStatusIndicator: React.FC<SyncStatusIndicatorProps> = ({
  syncInfo,
  onForceSync,
  onOpenSyncLogs,
  variant = 'banner',
  className = '',
}) => {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [manualSpinning, setManualSpinning] = useState(false);
  const [, setTick] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!popoverOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [popoverOpen]);

  const handleForceSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onForceSync || manualSpinning) return;
    setManualSpinning(true);
    try {
      await onForceSync();
    } finally {
      window.setTimeout(() => setManualSpinning(false), 350);
    }
  };

  const isSyncing = syncInfo.status === 'syncing' || manualSpinning;
  const isOffline = syncInfo.status === 'offline';
  const isError = syncInfo.status === 'error';

  const statusLabel = isSyncing
    ? 'Menyinkronkan ke Pusat...'
    : isOffline
      ? `Offline · ${syncInfo.queuedMutationsCount > 0 ? `${syncInfo.queuedMutationsCount} antrean lokal` : 'Tersimpan di perangkat'}`
      : isError
        ? 'Perlu Sinkron Ulang'
        : 'Tersinkron Otomatis ke Pusat';

  const shortStatusLabel = isSyncing
    ? 'Menyinkron...'
    : isOffline
      ? 'Mode Offline'
      : isError
        ? 'Gagal Sinkron'
        : 'Tersinkron Pusat';

  const toneClasses =
    variant === 'sidebar'
      ? isSyncing
        ? 'border-sky-400/40 bg-sky-500/15 text-sky-100'
        : isOffline
          ? 'border-amber-400/45 bg-amber-500/20 text-amber-100'
          : isError
            ? 'border-red-400/50 bg-red-500/20 text-red-100'
            : 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
      : isSyncing
        ? 'border-sky-300/75 bg-sky-500/12 text-sky-900'
        : isOffline
          ? 'border-amber-300/80 bg-amber-500/15 text-amber-950'
          : isError
            ? 'border-red-300/80 bg-red-500/15 text-red-900'
            : 'border-emerald-300/75 bg-emerald-500/12 text-emerald-950';

  const Icon = isSyncing
    ? RefreshCw
    : isOffline
      ? CloudOff
      : isError
        ? AlertTriangle
        : CloudCheck;

  const formattedTime = formatSyncTime(syncInfo.lastSyncedAt);

  if (variant === 'compact') {
    return (
      <div
        data-testid="sync-status-indicator"
        data-sync-status={syncInfo.status}
        title={syncInfo.lastSyncSummary || statusLabel}
        className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md transition-colors ${toneClasses} ${className}`}
      >
        <Icon className={`h-3.5 w-3.5 shrink-0 ${isSyncing ? 'animate-spin' : ''}`} />
        <span className="hidden lg:inline">{shortStatusLabel}</span>
      </div>
    );
  }

  if (variant === 'sidebar') {
    return (
      <div
        data-testid="sync-status-sidebar"
        data-sync-status={syncInfo.status}
        className={`mt-3 rounded-2xl border px-3 py-2.5 text-left transition-colors ${toneClasses} ${className}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex h-2 w-2 shrink-0">
              {syncInfo.status === 'synced' && !manualSpinning && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  isSyncing
                    ? 'bg-sky-400'
                    : isOffline
                      ? 'bg-amber-400'
                      : isError
                        ? 'bg-red-400'
                        : 'bg-emerald-400'
                }`}
              />
            </span>
            <span className="truncate text-[11px] font-bold">{shortStatusLabel}</span>
          </div>
          {onForceSync && (
            <button
              type="button"
              onClick={handleForceSync}
              aria-label="Sinkronkan ulang sekarang"
              title="Sinkronkan ulang sekarang"
              className="btn-press rounded-lg bg-white/10 p-1 hover:bg-white/20 shrink-0"
            >
              <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
        <p className="mt-1 truncate text-[10px] opacity-85">
          {syncInfo.lastSyncSummary || 'Database Pusat Aktif'} &middot; {formattedTime}
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setPopoverOpen((o) => !o)}
        data-testid="sync-status-indicator"
        data-sync-status={syncInfo.status}
        aria-expanded={popoverOpen}
        aria-label={`Status Sinkronisasi: ${statusLabel}`}
        className={`btn-press inline-flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-left backdrop-blur-md transition-all shadow-xs ${toneClasses}`}
      >
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-white/60">
          <Icon className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] font-bold leading-tight whitespace-nowrap">
            {statusLabel}
          </span>
          <span className="block max-w-[210px] truncate text-[10px] opacity-80 leading-tight">
            {syncInfo.lastSyncSummary || 'Database Pusat'} &middot; {formattedTime}
          </span>
        </span>
      </button>

      {popoverOpen && (
        <div
          role="region"
          aria-label="Detail Sinkronisasi Database Pusat"
          className="rounded-3xl [background:rgba(255,255,255,0.96)] backdrop-blur-2xl border border-slate-200/85 absolute left-0 sm:left-auto sm:right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2.5rem)] sm:w-80 p-4 text-xs text-slate-800 shadow-[0_24px_54px_-14px_rgba(15,23,42,0.28)] panel-enter"
        >
          <div className="flex items-start justify-between gap-2 border-b border-white/60 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700">
                <Database className="h-4 w-4" />
              </span>
              <div>
                <p className="font-display text-xs font-bold text-slate-900">
                  Sinkronisasi Real-Time Pusat
                </p>
                <p className="text-[11px] text-slate-500">Firebase Cloud Firestore</p>
              </div>
            </div>
            <span
              className={`rounded-lg px-2 py-0.5 text-[10px] font-bold ${
                isSyncing
                  ? 'bg-sky-100 text-sky-800'
                  : isOffline
                    ? 'bg-amber-100 text-amber-900'
                    : isError
                      ? 'bg-red-100 text-red-800'
                      : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              {shortStatusLabel}
            </span>
          </div>

          <div className="mt-3 space-y-2 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">Status Koneksi</span>
              <span className="font-semibold text-slate-900">
                {syncInfo.cloudConnected ? 'Terhubung Real-Time' : 'Offline (Cache Lokal)'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">Terakhir Tersinkron</span>
              <span className="font-mono-tabular font-semibold text-slate-900">
                {formattedTime}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">Antrean Perubahan</span>
              <span className="font-mono-tabular font-semibold text-slate-900">
                {syncInfo.pendingCount} tertunda
              </span>
            </div>
            {syncInfo.lastSyncSummary && (
              <div className="glass-subtle rounded-xl px-2.5 py-2 text-[11px] text-slate-700">
                <span className="font-semibold text-slate-900">Aktivitas Terakhir: </span>
                {syncInfo.lastSyncSummary}
              </div>
            )}
            {syncInfo.errorMessage && (
              <div className="rounded-xl border border-red-300/70 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-800">
                {syncInfo.errorMessage}
              </div>
            )}
          </div>

          {onForceSync && (
            <button
              type="button"
              onClick={handleForceSync}
              disabled={manualSpinning}
              className="btn-press mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {manualSpinning ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              <span>{manualSpinning ? 'Menyinkronkan...' : 'Verifikasi & Sinkronkan Sekarang'}</span>
            </button>
          )}

          {onOpenSyncLogs && (
            <button
              type="button"
              onClick={() => {
                setPopoverOpen(false);
                onOpenSyncLogs();
              }}
              className="btn-press mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100"
            >
              <History className="h-3.5 w-3.5 text-emerald-700" />
              <span>Buka Log Audit Sinkronisasi</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
