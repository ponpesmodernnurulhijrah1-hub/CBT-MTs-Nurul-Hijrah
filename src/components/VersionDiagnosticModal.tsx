import React, { useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  Globe,
  HardDrive,
  RefreshCw,
  Server,
  ShieldAlert,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import type { VersionDiagnosticsBundle } from '../hooks/useAppUpdater';

interface VersionDiagnosticModalProps {
  open: boolean;
  onClose: () => void;
  diagnostics: VersionDiagnosticsBundle;
  deviceId?: string;
  isExamLocked?: boolean;
  isChecking?: boolean;
  onRefreshDiagnostics: () => Promise<void>;
  onForceHardReset: () => Promise<void>;
}

export const VersionDiagnosticModal: React.FC<VersionDiagnosticModalProps> = ({
  open,
  onClose,
  diagnostics,
  deviceId,
  isExamLocked = false,
  isChecking = false,
  onRefreshDiagnostics,
  onForceHardReset,
}) => {
  useEffect(() => {
    if (open) {
      void onRefreshDiagnostics();
    }
  }, [open, onRefreshDiagnostics]);

  if (!open) return null;

  const {
    clientVersion,
    clientBuildHash,
    clientSchemaVersion,
    runtimeMode,
    serverManifest,
    swInfo,
    diagnosis,
  } = diagnostics;

  const hashMatches = Boolean(
    serverManifest.buildHash && clientBuildHash && serverManifest.buildHash === clientBuildHash
  );
  const versionMatches = Boolean(
    serverManifest.version && clientVersion && serverManifest.version === clientVersion
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 sm:p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="version-diag-title"
    >
      <div className="glass-modal flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-white/55 px-4 sm:px-6 py-4">
          <div className="flex items-start gap-3 min-w-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-900/90 border border-white/20 text-emerald-400">
              <Cpu className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2
                id="version-diag-title"
                className="font-display text-base sm:text-lg font-bold text-slate-900"
              >
                Diagnostik Sinkronisasi Versi &amp; Build Hash
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Bandingkan hash bundel klien dengan manifest server pusat untuk mendeteksi cache PWA lama.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal diagnostik versi"
            className="btn-press min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-white/60 hover:text-slate-800 shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* Diagnosis Verdict Banner */}
          <div
            data-testid="version-diagnosis-banner"
            className={`rounded-2xl border p-4 backdrop-blur-sm ${
              diagnosis.isSynced
                ? 'border-emerald-400/55 bg-emerald-500/12 text-emerald-950'
                : 'border-amber-400/65 bg-amber-500/15 text-amber-950'
            }`}
          >
            <div className="flex items-start gap-3">
              {diagnosis.isSynced ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700 mt-0.5" />
              ) : (
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700 mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-bold">{diagnosis.headline}</p>
                <p className="mt-1 text-xs leading-relaxed opacity-90">{diagnosis.explanation}</p>
              </div>
            </div>
          </div>

          {/* Side-by-Side Comparison: Client Bundle vs Server Manifest */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {/* Client Bundle Card */}
            <div className="glass-subtle rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2 border-b border-white/50 pb-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900">
                  {runtimeMode === 'PWA Standalone' ? (
                    <Smartphone className="h-4 w-4 text-emerald-700" />
                  ) : (
                    <Globe className="h-4 w-4 text-sky-700" />
                  )}
                  <span>Bundle Klien Aktif</span>
                </span>
                <span className="text-[11px] font-semibold text-slate-600">{runtimeMode}</span>
              </div>

              <dl className="space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">Versi Klien</dt>
                  <dd
                    data-testid="diag-client-version"
                    className="font-mono-tabular font-bold text-slate-900"
                  >
                    v{clientVersion}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">Build Hash Klien</dt>
                  <dd
                    data-testid="diag-client-hash"
                    className="font-mono-tabular font-bold text-emerald-800 break-all text-right"
                  >
                    {clientBuildHash}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">Skema Storage</dt>
                  <dd className="font-mono-tabular font-semibold text-slate-800">
                    Schema v{clientSchemaVersion}
                  </dd>
                </div>
                {deviceId && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-600">ID Perangkat</dt>
                    <dd className="font-mono-tabular font-semibold text-slate-700">{deviceId}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Server Manifest Card */}
            <div className="glass-subtle rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2 border-b border-white/50 pb-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900">
                  <Server className="h-4 w-4 text-emerald-700" />
                  <span>Manifest Server Pusat</span>
                </span>
                <span className="font-mono-tabular text-[11px] font-semibold text-slate-600">
                  {serverManifest.source || 'Belum diperiksa'}
                </span>
              </div>

              <dl className="space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">Versi Server</dt>
                  <dd
                    data-testid="diag-server-version"
                    className={`font-mono-tabular font-bold ${
                      serverManifest.version
                        ? versionMatches
                          ? 'text-emerald-800'
                          : 'text-amber-800'
                        : 'text-slate-500'
                    }`}
                  >
                    {serverManifest.version ? `v${serverManifest.version}` : 'Tidak terjangkau'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">Build Hash Server</dt>
                  <dd
                    data-testid="diag-server-hash"
                    className={`font-mono-tabular font-bold break-all text-right ${
                      serverManifest.buildHash
                        ? hashMatches
                          ? 'text-emerald-800'
                          : 'text-red-700'
                        : 'text-slate-500'
                    }`}
                  >
                    {serverManifest.buildHash || '—'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">Kecocokan Hash</dt>
                  <dd
                    className={`font-semibold ${
                      serverManifest.buildHash
                        ? hashMatches
                          ? 'text-emerald-800'
                          : 'text-red-700'
                        : 'text-slate-500'
                    }`}
                  >
                    {serverManifest.buildHash
                      ? hashMatches
                        ? 'Cocok (100% Sinkron)'
                        : 'Tidak Cocok (Cache Lama)'
                      : 'Menunggu Manifest'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">Waktu Cek</dt>
                  <dd className="font-mono-tabular text-[11px] text-slate-700">
                    {serverManifest.checkedAt
                      ? new Date(serverManifest.checkedAt).toLocaleTimeString('id-ID')
                      : '—'}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          {/* Firestore Pulse & Service Worker / Cache Storage Inspector */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div className="glass-subtle rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 border-b border-white/50 pb-2">
                <Database className="h-4 w-4 text-emerald-700" />
                <span>Firestore Sync Pulse (Lintas Perangkat)</span>
              </div>
              <dl className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">Versi Pulse Cloud</dt>
                  <dd className="font-mono-tabular font-semibold text-slate-900">
                    {diagnosis.pulseVersion ? `v${diagnosis.pulseVersion}` : '—'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">Hash Pulse Cloud</dt>
                  <dd className="font-mono-tabular font-semibold text-slate-800 break-all text-right">
                    {diagnosis.pulseBuildHash || '—'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="glass-subtle rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 border-b border-white/50 pb-2">
                <HardDrive className="h-4 w-4 text-emerald-700" />
                <span>Service Worker &amp; Cache Storage</span>
              </div>
              <dl className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">Status Controller SW</dt>
                  <dd className="font-mono-tabular font-semibold text-slate-900">
                    {swInfo.controllerState || 'Belum ada (atau Mode Dev)'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">SW Menunggu / Kebijakan</dt>
                  <dd className="font-mono-tabular font-semibold text-slate-800">
                    {swInfo.waitingPresent ? 'Ada SW Baru Menunggu' : 'Bersih'} &middot;{' '}
                    {swInfo.updateViaCache || 'none'}
                  </dd>
                </div>
                <div className="pt-1">
                  <dt className="text-slate-600 mb-1">
                    Bucket Cache ({swInfo.cacheBuckets.length}):
                  </dt>
                  {swInfo.cacheBuckets.length === 0 ? (
                    <dd className="text-[11px] text-slate-500">
                      Tidak ada Cache Storage lokal aktif.
                    </dd>
                  ) : (
                    <dd className="max-h-20 overflow-y-auto space-y-1 rounded-xl bg-white/55 p-2 font-mono-tabular text-[11px] text-slate-700">
                      {swInfo.cacheBuckets.map((bucket) => (
                        <div key={bucket} className="truncate">
                          {bucket}
                        </div>
                      ))}
                    </dd>
                  )}
                </div>
              </dl>
            </div>
          </div>

          {isExamLocked && (
            <div className="flex items-center gap-2 rounded-2xl border border-amber-300/70 bg-amber-500/15 px-3.5 py-2.5 text-xs font-medium text-amber-950">
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700" />
              <span>
                Paksa muat ulang ditahan selama ujian sedang berlangsung agar sesi ujian Anda tidak terganggu.
              </span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 border-t border-white/55 bg-white/40 px-4 sm:px-6 py-3.5">
          <button
            type="button"
            onClick={() => void onRefreshDiagnostics()}
            disabled={isChecking}
            className="btn-press min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-white/75 bg-white/75 px-4 py-2 text-xs font-bold text-slate-800 hover:bg-white disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`h-4 w-4 text-emerald-700 ${isChecking ? 'animate-spin' : ''}`} />
            <span>{isChecking ? 'Memeriksa Manifest...' : 'Periksa Manifest Server'}</span>
          </button>

          <button
            type="button"
            onClick={() => void onForceHardReset()}
            disabled={isChecking || isExamLocked}
            className="btn-press min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap shadow-sm"
          >
            <Trash2 className="h-4 w-4" />
            <span>Paksa Update &amp; Hapus Semua Cache PWA</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export const VersionStatusTriggerIcon = Activity;
