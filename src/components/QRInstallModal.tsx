import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Download,
  Smartphone,
  X,
  CheckCircle2,
  RefreshCw,
  Cpu,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { APP_BUILD_HASH, APP_VERSION } from '../config/version';

interface QRInstallModalProps {
  open: boolean;
  onClose: () => void;
  onForceUpdateApp?: () => Promise<'updated' | 'up-to-date' | 'deferred'>;
  onOpenDiagnostics?: () => void;
  isCheckingUpdate?: boolean;
}

export const QRInstallModal: React.FC<QRInstallModalProps> = ({
  open,
  onClose,
  onForceUpdateApp,
  onOpenDiagnostics,
  isCheckingUpdate = false,
}) => {
  const {
    isInstallable,
    isInstalled,
    isIOS,
    isEmbeddedIframe,
    isInAppBrowser,
    isSecureContext,
    swActive,
    manifestReady,
    availabilityMode,
    install,
    refreshChecks,
  } = usePWAInstall();
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    if (open) {
      void refreshChecks();
    }
  }, [open, refreshChecks]);

  if (!open) return null;

  const currentUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const handleCopyUrl = async () => {
    if (!currentUrl) return;
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      setCheckNote(`Salin tautan berikut secara manual: ${currentUrl}`);
    }
  };

  const handleHardRefreshApp = async () => {
    if (!onForceUpdateApp) return;
    setCheckNote(null);
    const result = await onForceUpdateApp();
    if (result === 'up-to-date') {
      setCheckNote(`Aplikasi sudah menggunakan versi terbaru (${APP_VERSION}).`);
    } else if (result === 'deferred') {
      setCheckNote('Pembaruan ditunda karena ujian sedang berlangsung.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-install-title"
    >
      <div className="glass-modal w-full max-w-md max-h-[90vh] overflow-y-auto p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="qr-install-title" className="font-display text-lg font-bold text-slate-900">
              Install Aplikasi &amp; Buat Pintasan
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Pasang di HP, tablet, atau komputer agar terbuka layar penuh dan selalu sinkron real-time.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal QR Install"
            className="btn-press min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-white/60 hover:text-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="glass-subtle mt-4 flex flex-col items-center rounded-2xl p-4 sm:p-5">
          <div className="rounded-2xl bg-white/95 p-3 border border-white/80 shadow-sm">
            <QRCodeSVG
              value={currentUrl || 'https://cbt-mas-nurul-hijrah.web.app'}
              size={168}
              bgColor="#ffffff"
              fgColor="#065f46"
              level="M"
            />
          </div>
          <p className="mt-3 text-center font-mono-tabular text-xs text-slate-700 break-all">
            {currentUrl}
          </p>
          <p className="mt-1 text-center font-mono-tabular text-[11px] font-semibold text-emerald-800">
            Versi: v{APP_VERSION} &middot; Hash: {APP_BUILD_HASH}
          </p>

          {/* Compact PWA Readiness Telemetry Grid */}
          <div className="mt-3 grid w-full grid-cols-3 gap-1.5 text-[11px]">
            <div
              className={`rounded-lg border px-2 py-1 text-center font-medium ${
                isSecureContext
                  ? 'border-emerald-300/70 bg-emerald-500/10 text-emerald-900'
                  : 'border-amber-300/70 bg-amber-500/10 text-amber-900'
              }`}
            >
              {isSecureContext ? 'HTTPS Aman' : 'Perlu HTTPS'}
            </div>
            <div
              className={`rounded-lg border px-2 py-1 text-center font-medium ${
                manifestReady
                  ? 'border-emerald-300/70 bg-emerald-500/10 text-emerald-900'
                  : 'border-slate-300/70 bg-white/50 text-slate-700'
              }`}
            >
              {manifestReady ? 'Manifest OK' : 'Cek Manifest'}
            </div>
            <div
              className={`rounded-lg border px-2 py-1 text-center font-medium ${
                swActive
                  ? 'border-emerald-300/70 bg-emerald-500/10 text-emerald-900'
                  : 'border-slate-300/70 bg-white/50 text-slate-700'
              }`}
            >
              {swActive ? 'SW Aktif' : 'Menyiapkan SW'}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {isInstalled || availabilityMode === 'installed' ? (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-300/60 bg-emerald-500/15 px-3.5 py-2.5 text-xs font-medium text-emerald-900">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
              <span>Aplikasi sudah terpasang di perangkat ini dalam mode standalone.</span>
            </div>
          ) : isInstallable || availabilityMode === 'native_prompt' ? (
            <button
              type="button"
              onClick={install}
              data-testid="modal-direct-install-btn"
              className="btn-press min-h-[44px] flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              <Download className="h-4 w-4" />
              <span>Install Aplikasi Sekarang</span>
            </button>
          ) : availabilityMode === 'open_in_browser' ? (
            <div className="rounded-2xl border border-amber-300/70 bg-amber-50/90 p-3.5 text-xs text-slate-800 space-y-2.5">
              <div className="flex items-start gap-2 font-semibold text-amber-950">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
                <span>
                  {isEmbeddedIframe
                    ? 'Tampilan sedang dibuka di dalam frame pratinjau. Browser menonaktifkan pemasangan pintasan dari dalam iframe.'
                    : isInAppBrowser
                      ? 'Tautan dibuka lewat browser bawaan aplikasi (WhatsApp/IG). Buka di Chrome atau Safari agar bisa diinstall.'
                      : 'Buka tautan di jendela browser utama untuk memasang aplikasi.'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {currentUrl && (
                  <a
                    href={currentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-press min-h-[40px] flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Buka di Tab Browser</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="btn-press min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                >
                  {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedUrl ? 'Tersalin' : 'Salin Link'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="glass-subtle rounded-2xl p-3.5 text-xs text-slate-700 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <Smartphone className="h-4 w-4 text-emerald-700" />
                <span>
                  {isIOS
                    ? 'Panduan Install di iPhone / iPad (Safari):'
                    : 'Panduan Install / Buat Pintasan di Browser:'}
                </span>
              </div>
              {isIOS ? (
                <ol className="list-decimal pl-5 space-y-1 text-slate-600">
                  <li>Pastikan tautan dibuka di browser <strong>Safari</strong>.</li>
                  <li>Ketuk tombol <strong>Bagikan (Share)</strong> di bilah bawah.</li>
                  <li>Pilih <strong>Tambahkan ke Layar Utama (Add to Home Screen)</strong>.</li>
                </ol>
              ) : (
                <ol className="list-decimal pl-5 space-y-1 text-slate-600">
                  <li>Pastikan halaman dibuka di tab utama <strong>Chrome / Edge</strong> (bukan di dalam WhatsApp/pratinjau).</li>
                  <li>Ketuk ikon menu titik tiga (⋮) di pojok kanan atas browser.</li>
                  <li>Pilih <strong>Tambahkan ke Layar Utama</strong> lalu pilih <strong>Instal</strong> atau <strong>Buat Pintasan</strong>.</li>
                </ol>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                {currentUrl && (
                  <a
                    href={currentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-press min-h-[38px] flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-600/30 bg-emerald-600/10 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-600/20 whitespace-nowrap"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Buka di Tab Baru</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="btn-press min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/75 bg-white/75 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-white whitespace-nowrap"
                >
                  {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedUrl ? 'Tersalin' : 'Salin Link'}</span>
                </button>
              </div>
            </div>
          )}

          {onForceUpdateApp && (
            <div className="pt-1 space-y-2">
              <button
                type="button"
                onClick={handleHardRefreshApp}
                disabled={isCheckingUpdate}
                className="btn-press min-h-[44px] flex w-full items-center justify-center gap-2 rounded-xl border border-white/75 bg-white/65 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-white/90 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-emerald-700 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                <span>
                  {isCheckingUpdate
                    ? 'Memeriksa & menyegarkan cache PWA...'
                    : 'Segarkan Cache & Sinkronkan Versi Terbaru'}
                </span>
              </button>
              {onOpenDiagnostics && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenDiagnostics();
                  }}
                  className="btn-press min-h-[40px] flex w-full items-center justify-center gap-2 rounded-xl border border-white/65 bg-white/45 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-white/80"
                >
                  <Cpu className="h-3.5 w-3.5 text-emerald-700" />
                  <span>Buka Diagnostik Versi &amp; Build Hash</span>
                </button>
              )}
              {checkNote && (
                <p className="text-center text-[11px] font-medium text-emerald-800">
                  {checkNote}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
