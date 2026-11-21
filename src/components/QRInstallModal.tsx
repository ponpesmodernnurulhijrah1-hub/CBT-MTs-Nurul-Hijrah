import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Download, Smartphone, X, CheckCircle2, RefreshCw } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { APP_VERSION } from '../config/version';

interface QRInstallModalProps {
  open: boolean;
  onClose: () => void;
  onForceUpdateApp?: () => Promise<'updated' | 'up-to-date' | 'deferred'>;
  isCheckingUpdate?: boolean;
}

export const QRInstallModal: React.FC<QRInstallModalProps> = ({
  open,
  onClose,
  onForceUpdateApp,
  isCheckingUpdate = false,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [checkNote, setCheckNote] = useState<string | null>(null);

  if (!open) return null;

  const currentUrl = typeof window !== 'undefined' ? window.location.origin : '';

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
      <div className="glass-modal w-full max-w-md p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="qr-install-title" className="font-display text-lg font-bold text-slate-900">
              Install Aplikasi CBT di HP
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Scan kode QR atau install langsung agar terhubung ke satu server sinkron real-time.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal QR Install"
            className="btn-press rounded-xl p-1.5 text-slate-500 hover:bg-white/60 hover:text-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="glass-subtle mt-5 flex flex-col items-center rounded-2xl p-5">
          <div className="rounded-2xl bg-white/95 p-3 border border-white/80 shadow-sm">
            <QRCodeSVG
              value={currentUrl || 'https://cbt-mas-nurul-hijrah.web.app'}
              size={176}
              bgColor="#ffffff"
              fgColor="#065f46"
              level="M"
            />
          </div>
          <p className="mt-3 text-center font-mono-tabular text-xs text-slate-700 break-all">
            {currentUrl}
          </p>
          <p className="mt-1 text-center font-mono-tabular text-[11px] font-semibold text-emerald-800">
            Versi Aktif: {APP_VERSION}
          </p>
        </div>

        <div className="mt-5 space-y-3">
          {isInstalled ? (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-300/60 bg-emerald-500/15 px-3.5 py-2.5 text-xs font-medium text-emerald-900">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
              <span>Aplikasi sudah terpasang di perangkat ini dalam mode standalone.</span>
            </div>
          ) : isInstallable ? (
            <button
              type="button"
              onClick={install}
              className="btn-press flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              <Download className="h-4 w-4" />
              <span>Install Aplikasi Sekarang</span>
            </button>
          ) : (
            <div className="glass-subtle rounded-2xl p-3.5 text-xs text-slate-700 space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <Smartphone className="h-4 w-4 text-emerald-700" />
                <span>
                  {isIOS ? 'Panduan Install di iPhone / iPad (Safari):' : 'Panduan Install di Android (Chrome):'}
                </span>
              </div>
              {isIOS ? (
                <ol className="list-decimal pl-5 space-y-1 text-slate-600">
                  <li>Buka link di Safari setelah scan QR di atas.</li>
                  <li>Ketuk tombol <strong>Bagikan (Share)</strong> di bilah bawah.</li>
                  <li>Pilih <strong>Tambahkan ke Layar Utama (Add to Home Screen)</strong>.</li>
                </ol>
              ) : (
                <ol className="list-decimal pl-5 space-y-1 text-slate-600">
                  <li>Scan kode QR menggunakan kamera HP / Google Lens.</li>
                  <li>Ketuk ikon titik tiga (⋮) di pojok kanan atas Chrome.</li>
                  <li>Pilih <strong>Tambahkan ke Layar Utama / Install Aplikasi</strong>.</li>
                </ol>
              )}
            </div>
          )}

          {onForceUpdateApp && (
            <div className="pt-1 space-y-2">
              <button
                type="button"
                onClick={handleHardRefreshApp}
                disabled={isCheckingUpdate}
                className="btn-press flex w-full items-center justify-center gap-2 rounded-xl border border-white/75 bg-white/65 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-white/90 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-emerald-700 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                <span>
                  {isCheckingUpdate
                    ? 'Memeriksa & menyegarkan cache PWA...'
                    : 'Segarkan Cache & Sinkronkan Versi Terbaru'}
                </span>
              </button>
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
