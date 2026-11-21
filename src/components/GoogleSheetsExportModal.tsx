import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  FolderSearch,
  Loader2,
  LogOut,
  PlusCircle,
  RefreshCw,
  TableProperties,
  X,
} from 'lucide-react';
import type { ExamResult } from '../types/cbt';
import {
  clearGoogleSheetsToken,
  getGoogleSheetsAccessToken,
  initGoogleSheetsAuth,
  signInWithGoogleSheets,
  signOutGoogleSheets,
} from '../config/googleSheetsAuth';
import {
  createSpreadsheetWithResults,
  extractSpreadsheetId,
  fetchSpreadsheetMetadata,
  writeResultsToExistingSpreadsheet,
  type SheetExportResult,
  type SpreadsheetMetadata,
} from '../utils/googleSheetsExport';

interface GoogleSheetsExportModalProps {
  open: boolean;
  results: ExamResult[];
  defaultTitle?: string;
  onClose: () => void;
  onExportSuccess?: (exported: SheetExportResult) => void;
}

export const GoogleSheetsExportModal: React.FC<GoogleSheetsExportModalProps> = ({
  open,
  results,
  defaultTitle,
  onClose,
  onExportSuccess,
}) => {
  const [needsAuth, setNeedsAuth] = useState(true);
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(() => getGoogleSheetsAccessToken());
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [mode, setMode] = useState<'create' | 'existing'>('create');
  const [newSheetTitle, setNewSheetTitle] = useState(
    defaultTitle || `Rekap Nilai CBT MTs Nurul Hijrah (${new Date().toISOString().slice(0, 10)})`
  );

  const [existingUrlOrId, setExistingUrlOrId] = useState('');
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [meta, setMeta] = useState<SpreadsheetMetadata | null>(null);
  const [selectedTab, setSelectedTab] = useState('');
  const [writeMode, setWriteMode] = useState<'append' | 'replace'>('append');

  // Mandatory explicit confirmation state before modifying existing spreadsheet data
  const [confirmOverwriteOpen, setConfirmOverwriteOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<SheetExportResult | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    const unsub = initGoogleSheetsAuth(
      (user, token) => {
        setGoogleUser(user);
        setAccessToken(token);
        setNeedsAuth(false);
      },
      () => {
        setAccessToken(null);
        setNeedsAuth(true);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (open) {
      setErrorMsg(null);
      setExportResult(null);
      setConfirmOverwriteOpen(false);
      const token = getGoogleSheetsAccessToken();
      if (token) {
        setAccessToken(token);
        setNeedsAuth(false);
      }
      if (defaultTitle) {
        setNewSheetTitle(`${defaultTitle} (${new Date().toISOString().slice(0, 10)})`);
      }
    }
  }, [open, defaultTitle]);

  if (!open) return null;

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setErrorMsg(null);
    try {
      const res = await signInWithGoogleSheets();
      setGoogleUser(res.user);
      setAccessToken(res.accessToken);
      setNeedsAuth(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal masuk dengan akun Google.';
      setErrorMsg(
        msg.includes('popup-closed')
          ? 'Jendela login Google ditutup sebelum selesai. Silakan coba lagi.'
          : msg
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleSignOut = async () => {
    await signOutGoogleSheets();
    setGoogleUser(null);
    setAccessToken(null);
    setNeedsAuth(true);
    setMeta(null);
    setConfirmOverwriteOpen(false);
  };

  const handleFetchMetadata = async () => {
    if (!accessToken) {
      setNeedsAuth(true);
      return;
    }
    const spreadsheetId = extractSpreadsheetId(existingUrlOrId);
    if (!spreadsheetId) {
      setErrorMsg('Format tautan atau ID Google Sheets tidak valid.');
      return;
    }

    setLoadingMeta(true);
    setErrorMsg(null);
    setMeta(null);
    setConfirmOverwriteOpen(false);
    try {
      const fetched = await fetchSpreadsheetMetadata(accessToken, spreadsheetId);
      setMeta(fetched);
      setSelectedTab(fetched.sheets[0]?.title || '');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membaca metadata spreadsheet.';
      if (msg.includes('ditolak') || msg.includes('kedaluwarsa')) {
        clearGoogleSheetsToken();
        setAccessToken(null);
        setNeedsAuth(true);
      }
      setErrorMsg(msg);
    } finally {
      setLoadingMeta(false);
    }
  };

  const handleCreateNewSpreadsheet = async () => {
    if (!accessToken) {
      setNeedsAuth(true);
      return;
    }
    if (results.length === 0) {
      setErrorMsg('Belum ada data hasil ujian yang dapat dikirim ke Google Sheets.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await createSpreadsheetWithResults(accessToken, newSheetTitle, results);
      setExportResult(res);
      onExportSuccess?.(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membuat Google Sheets baru.';
      if (msg.includes('ditolak') || msg.includes('kedaluwarsa')) {
        clearGoogleSheetsToken();
        setAccessToken(null);
        setNeedsAuth(true);
      }
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmedWriteExisting = async () => {
    if (!accessToken || !meta || !selectedTab) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await writeResultsToExistingSpreadsheet(accessToken, {
        spreadsheetId: meta.spreadsheetId,
        spreadsheetTitle: meta.title,
        sheetTitle: selectedTab,
        mode: writeMode,
        results,
      });
      setConfirmOverwriteOpen(false);
      setExportResult(res);
      onExportSuccess?.(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menulis data ke Google Sheets.';
      if (msg.includes('ditolak') || msg.includes('kedaluwarsa')) {
        clearGoogleSheetsToken();
        setAccessToken(null);
        setNeedsAuth(true);
      }
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!exportResult?.spreadsheetUrl) return;
    try {
      await navigator.clipboard.writeText(exportResult.spreadsheetUrl);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gsheets-modal-title"
    >
      <div className="glass-modal flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-white/55 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-700 text-white shadow-sm">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h2 id="gsheets-modal-title" className="font-display text-base font-bold text-slate-900">
                Impor Hasil ke Google Sheets
              </h2>
              <p className="text-xs text-slate-600">
                Sinkronkan {results.length} baris nilai CBT langsung ke spreadsheet Google Drive Anda.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal Google Sheets"
            className="btn-press rounded-xl p-1.5 text-slate-500 hover:bg-white/60 hover:text-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Google Account Auth Status Card */}
          {needsAuth || !accessToken ? (
            <div className="glass-subtle rounded-2xl p-5 text-center space-y-3">
              <p className="text-sm font-semibold text-slate-900">
                Hubungkan Akun Google Anda
              </p>
              <p className="text-xs text-slate-600 max-w-md mx-auto">
                Masuk dengan akun Google agar aplikasi dapat membuat spreadsheet baru atau mengirim nilai ke Google Sheets milik Anda dengan izin eksplisit Anda.
              </p>

              {/* Official Sign in with Google Button Pattern */}
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  disabled={isLoggingIn}
                  onClick={handleGoogleLogin}
                  className="gsi-material-button btn-press inline-flex items-center gap-3 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                >
                  <div className="gsi-material-button-icon h-5 w-5 shrink-0">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      style={{ display: 'block', width: '100%', height: '100%' }}
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                      <path fill="none" d="M0 0h48v48H0z" />
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">
                    {isLoggingIn ? 'Menghubungkan...' : 'Sign in with Google'}
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Connected User Banner */}
              <div className="glass-subtle flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
                  <span className="text-xs font-semibold text-slate-800 truncate">
                    Terhubung: {googleUser?.email || googleUser?.displayName || 'Akun Google'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleGoogleSignOut}
                  className="btn-press inline-flex items-center gap-1 rounded-xl border border-white/70 bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-white"
                >
                  <LogOut className="h-3 w-3" />
                  <span>Ganti Akun</span>
                </button>
              </div>

              {/* Destination Mode Switcher */}
              <div className="glass-subtle grid grid-cols-2 gap-1.5 rounded-2xl p-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setMode('create');
                    setErrorMsg(null);
                    setConfirmOverwriteOpen(false);
                  }}
                  className={`btn-press inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                    mode === 'create'
                      ? 'bg-emerald-700 text-white shadow-sm'
                      : 'text-slate-700 hover:bg-white/60'
                  }`}
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  <span>Buat Spreadsheet Baru</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('existing');
                    setErrorMsg(null);
                    setConfirmOverwriteOpen(false);
                  }}
                  className={`btn-press inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                    mode === 'existing'
                      ? 'bg-emerald-700 text-white shadow-sm'
                      : 'text-slate-700 hover:bg-white/60'
                  }`}
                >
                  <TableProperties className="h-3.5 w-3.5" />
                  <span>Kirim ke Sheet Ada</span>
                </button>
              </div>

              {mode === 'create' ? (
                <div className="glass-subtle rounded-2xl p-4 space-y-3">
                  <div>
                    <label
                      htmlFor="new-gsheet-title"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      Judul File Google Sheets Baru
                    </label>
                    <input
                      id="new-gsheet-title"
                      type="text"
                      value={newSheetTitle}
                      onChange={(e) => setNewSheetTitle(e.target.value)}
                      placeholder="Contoh: Rekap Nilai Matematika Kelas VII"
                      className="glass-input w-full rounded-xl px-3 py-2 text-sm text-slate-900"
                    />
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Akan membuat spreadsheet baru berisi tab <strong>Rekap Nilai CBT</strong> dengan {results.length} baris data hasil ujian lengkap beserta header otomatis.
                  </p>
                </div>
              ) : (
                <div className="glass-subtle rounded-2xl p-4 space-y-3">
                  <div>
                    <label
                      htmlFor="existing-gsheet-url"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      Tautan (URL) atau ID Spreadsheet Tujuan
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <input
                        id="existing-gsheet-url"
                        type="text"
                        value={existingUrlOrId}
                        onChange={(e) => {
                          setExistingUrlOrId(e.target.value);
                          setMeta(null);
                          setConfirmOverwriteOpen(false);
                        }}
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                        className="glass-input flex-1 min-w-[200px] rounded-xl px-3 py-2 text-xs text-slate-900"
                      />
                      <button
                        type="button"
                        disabled={loadingMeta || !existingUrlOrId.trim()}
                        onClick={handleFetchMetadata}
                        className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        {loadingMeta ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <FolderSearch className="h-3.5 w-3.5" />
                        )}
                        <span>Cek Tab Sheet</span>
                      </button>
                    </div>
                  </div>

                  {meta && (
                    <div className="rounded-xl border border-emerald-300/60 bg-white/75 p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                            Spreadsheet Ditemukan
                          </p>
                          <p className="text-sm font-bold text-slate-900">{meta.title}</p>
                        </div>
                        <button
                          type="button"
                          onClick={handleFetchMetadata}
                          aria-label="Muat ulang daftar tab sheet"
                          className="btn-press rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label
                            htmlFor="gsheet-tab-select"
                            className="block text-[11px] font-semibold text-slate-700 mb-1"
                          >
                            Pilih Tab Tujuan
                          </label>
                          <select
                            id="gsheet-tab-select"
                            value={selectedTab}
                            onChange={(e) => {
                              setSelectedTab(e.target.value);
                              setConfirmOverwriteOpen(false);
                            }}
                            className="glass-input w-full rounded-xl px-2.5 py-1.5 text-xs text-slate-900"
                          >
                            {meta.sheets.map((tab) => (
                              <option key={tab.sheetId} value={tab.title}>
                                {tab.title}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label
                            htmlFor="gsheet-write-mode"
                            className="block text-[11px] font-semibold text-slate-700 mb-1"
                          >
                            Mode Pengiriman
                          </label>
                          <select
                            id="gsheet-write-mode"
                            value={writeMode}
                            onChange={(e) => {
                              setWriteMode(e.target.value as 'append' | 'replace');
                              setConfirmOverwriteOpen(false);
                            }}
                            className="glass-input w-full rounded-xl px-2.5 py-1.5 text-xs text-slate-900"
                          >
                            <option value="append">Tambah di Baris Bawah (Append)</option>
                            <option value="replace">Timpa Seluruh Isi Tab (Replace)</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Explicit Confirmation Box before mutating existing spreadsheet */}
                  {confirmOverwriteOpen && meta && (
                    <div
                      role="alertdialog"
                      aria-label="Konfirmasi pembaruan Google Sheets"
                      className="rounded-2xl border border-amber-300 bg-amber-50/95 p-4 space-y-2.5"
                    >
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
                        <div className="text-xs text-amber-950 space-y-1">
                          <p className="font-bold">
                            Konfirmasi Pengiriman Data ke Spreadsheet Anda
                          </p>
                          <p>
                            Aplikasi akan{' '}
                            <strong>
                              {writeMode === 'replace'
                                ? 'menghapus isi lama dan menimpa'
                                : 'menambahkan baris baru ke'}
                            </strong>{' '}
                            tab <strong>&ldquo;{selectedTab}&rdquo;</strong> pada spreadsheet{' '}
                            <strong>&ldquo;{meta.title}&rdquo;</strong> sebanyak{' '}
                            <strong>{results.length} data hasil ujian</strong>.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => setConfirmOverwriteOpen(false)}
                          className="btn-press rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-amber-100/50"
                        >
                          Batal
                        </button>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={handleConfirmedWriteExisting}
                          className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-60"
                        >
                          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          <span>Konfirmasi &amp; Kirim Sekarang</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {errorMsg && (
            <div className="rounded-2xl border border-red-300 bg-red-50/90 px-4 py-3 text-xs font-medium text-red-800">
              {errorMsg}
            </div>
          )}

          {exportResult && (
            <div className="rounded-2xl border border-emerald-300 bg-emerald-50/95 p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-emerald-900 font-bold text-xs">
                <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
                <span>
                  Berhasil mengimpor {exportResult.rowCount} hasil ujian ke &ldquo;{exportResult.title}&rdquo; (Tab: {exportResult.sheetTitle})
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={exportResult.spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Buka di Google Sheets</span>
                </a>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100/50"
                >
                  {copiedUrl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedUrl ? 'Tersalin' : 'Salin Tautan'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-white/50 bg-white/40 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-xl border border-white/70 bg-white/65 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
          >
            Tutup
          </button>

          {!needsAuth && accessToken && mode === 'create' && (
            <button
              type="button"
              disabled={submitting || results.length === 0}
              onClick={handleCreateNewSpreadsheet}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50 shadow-sm"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              <span>{submitting ? 'Mengirim...' : `Buat & Kirim ${results.length} Data`}</span>
            </button>
          )}

          {!needsAuth && accessToken && mode === 'existing' && meta && !confirmOverwriteOpen && (
            <button
              type="button"
              disabled={submitting || results.length === 0 || !selectedTab}
              onClick={() => setConfirmOverwriteOpen(true)}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50 shadow-sm"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>Kirim {results.length} Data ke Tab Ini</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
