import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  Maximize2,
  BellRing,
  X,
  Video,
  Radio,
  AlertTriangle,
} from 'lucide-react';
import type { LiveStreamSession } from '../types/cbt';
import { useProctorWebRTCViewer } from '../hooks/useWebRTCProctor';

interface LiveMonitoringGridProps {
  sessions: LiveStreamSession[];
  onSendWarning: (sessionId: string, message: string) => Promise<void>;
  emptyTitle?: string;
}

interface StudentVideoTileProps {
  session: LiveStreamSession;
  isUnmuted: boolean;
  onToggleMute: () => void;
  onSpotlight: () => void;
  onSendWarning: (message: string) => void;
}

const StudentVideoTile: React.FC<StudentVideoTileProps> = ({
  session,
  isUnmuted,
  onToggleMute,
  onSpotlight,
  onSendWarning,
}) => {
  const { remoteStream } = useProctorWebRTCViewer(session);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const hasWarning = session.pelanggaranTab > 0;

  return (
    <div
      className={`surface-card-interactive flex flex-col overflow-hidden ${
        hasWarning ? 'border-red-500 ring-1 ring-red-400/50' : ''
      }`}
    >
      {/* Video / Feed Viewport */}
      <div className="relative aspect-video w-full bg-slate-900">
        {remoteStream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={!isUnmuted}
            className="h-full w-full object-cover"
          />
        ) : session.snapshotPreview ? (
          <img
            src={session.snapshotPreview}
            alt={`Siaran langsung ${session.namaSiswa}`}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center text-slate-400">
            <Video className="h-7 w-7 mb-1.5 opacity-60" />
            <span className="text-xs">Menghubungkan stream...</span>
          </div>
        )}

        {/* Measured Scrim & Top Live Indicator */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent px-3 py-2 text-xs text-white">
          <span className="inline-flex items-center gap-1.5 font-semibold tracking-wide text-emerald-300">
            <Radio className="h-3.5 w-3.5" />
            <span>LIVE</span>
          </span>
          <span className="font-mono-tabular text-[11px] text-slate-200">
            {session.kelas}
          </span>
        </div>

        {/* Bottom Scrim Name & Mapel */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 py-2 text-white">
          <p className="truncate text-sm font-semibold">
            {session.namaSiswa}
            {session.noPeserta ? (
              <span className="ml-1.5 font-mono-tabular text-[11px] font-normal text-emerald-200">
                ({session.noPeserta})
              </span>
            ) : null}
          </p>
          <p className="truncate text-[11px] text-slate-300">
            {session.mataPelajaran}
          </p>
        </div>
      </div>

      {/* Telemetry & Controls */}
      <div className="p-3.5 space-y-2.5">
        {/* Live Audio Meter */}
        <div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
            <span>Volume Mikrofon</span>
            <span className="font-mono-tabular">{Math.round(session.audioLevel)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/55">
            <div
              className={`h-full w-full origin-left transition-transform duration-150 ${
                session.audioLevel > 65 ? 'bg-amber-500' : 'bg-emerald-600'
              }`}
              style={{ transform: `scaleX(${Math.min(1, Math.max(0.04, session.audioLevel / 100))})` }}
            />
          </div>
        </div>

        {/* Counters */}
        <div className="flex items-center justify-between gap-2 text-xs text-slate-600 font-mono-tabular">
          <span>
            Keluar:{' '}
            <strong className={hasWarning ? 'text-red-600' : 'text-slate-900'}>
              {session.pelanggaranTab}/3
            </strong>
            {typeof session.peringatanWajah === 'number' && session.peringatanWajah > 0 ? (
              <span className="ml-2 text-amber-700 font-semibold">
                · Wajah: {session.peringatanWajah}x
              </span>
            ) : null}
          </span>
          <span
            className={`truncate ${
              hasWarning
                ? 'text-red-600 font-semibold'
                : session.lastFaceStatus && session.lastFaceStatus !== 'Wajah Terdeteksi'
                  ? 'text-amber-700 font-semibold'
                  : 'text-emerald-700 font-semibold'
            }`}
          >
            {hasWarning
              ? 'Terdeteksi Keluar'
              : session.lastFaceStatus || 'Fokus Ujian'}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-3 gap-1.5 pt-1">
          <button
            type="button"
            onClick={onToggleMute}
            className={`btn-press inline-flex items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              isUnmuted
                ? 'bg-emerald-700 text-white hover:bg-emerald-800 shadow-sm'
                : 'border border-white/65 bg-white/55 text-slate-700 hover:bg-white/85'
            }`}
            title={isUnmuted ? 'Bisukan Suara' : 'Dengarkan Suara (Unmute)'}
          >
            {isUnmuted ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            <span>{isUnmuted ? 'Aktif' : 'Unmute'}</span>
          </button>

          <button
            type="button"
            onClick={onSpotlight}
            className="btn-press inline-flex items-center justify-center gap-1 rounded-xl border border-white/65 bg-white/55 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white/85 whitespace-nowrap"
            title="Perbesar Layar (Spotlight)"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            <span>Spotlight</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onSendWarning('Peringatan Pengawas: Harap tetap fokus pada layar ujian dan jangan membuka aplikasi lain!')
            }
            className="btn-press inline-flex items-center justify-center gap-1 rounded-xl border border-red-300/60 bg-red-500/15 px-2 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-500/25 whitespace-nowrap"
            title="Kirim Peringatan & Alarm"
          >
            <BellRing className="h-3.5 w-3.5" />
            <span>Tegur</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export const LiveMonitoringGrid: React.FC<LiveMonitoringGridProps> = ({
  sessions,
  onSendWarning,
  emptyTitle = 'Belum ada peserta yang sedang mengerjakan ujian saat ini.',
}) => {
  // Default all tiles muted so voices do not collide
  const [unmutedSessionId, setUnmutedSessionId] = useState<string | null>(null);
  const [spotlightSessionId, setSpotlightSessionId] = useState<string | null>(null);
  const [viewFilter, setViewFilter] = useState<'ALL' | 'FLAGGED'>('ALL');
  const [customWarning, setCustomWarning] = useState(
    'Peringatan Pengawas: Dilarang keluar dari aplikasi atau membuka aplikasi lain!'
  );
  const [sentNotice, setSentNotice] = useState<string | null>(null);

  const activeSessions = useMemo(() => sessions.filter((s) => s.status === 'aktif'), [sessions]);
  const flaggedCount = useMemo(
    () => activeSessions.filter((s) => s.pelanggaranTab > 0).length,
    [activeSessions]
  );
  const visibleSessions = useMemo(
    () =>
      viewFilter === 'FLAGGED'
        ? activeSessions.filter((s) => s.pelanggaranTab > 0)
        : activeSessions,
    [activeSessions, viewFilter]
  );

  const spotlightSession = activeSessions.find((s) => s.sessionId === spotlightSessionId) || null;

  const handleWarning = async (sessionId: string, msg: string) => {
    await onSendWarning(sessionId, msg);
    setSentNotice('Peringatan suara & teks berhasil dikirim ke layar siswa.');
    window.setTimeout(() => setSentNotice(null), 3000);
  };

  const handleBroadcastAll = async () => {
    const cleanMsg = customWarning.trim();
    if (!cleanMsg || activeSessions.length === 0) return;
    await Promise.all(activeSessions.map((s) => onSendWarning(s.sessionId, cleanMsg)));
    setSentNotice(`Peringatan massal berhasil dikirim ke seluruh ${activeSessions.length} peserta aktif.`);
    window.setTimeout(() => setSentNotice(null), 3500);
  };

  if (activeSessions.length === 0) {
    return (
      <div className="surface-card border-dashed p-10 text-center panel-enter">
        <Video className="mx-auto h-10 w-10 text-slate-300" />
        <p className="mt-3 text-sm font-semibold text-slate-700">{emptyTitle}</p>
        <p className="mt-1 text-xs text-slate-500">
          Siaran video wajah dan audio mikrofon siswa otomatis muncul di sini secara real-time begitu siswa memulai ujian.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 panel-enter">
      <div className="surface-card flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-3">
          <div className="glass-subtle inline-flex max-w-full overflow-x-auto items-center gap-1 rounded-xl p-1">
            <button
              type="button"
              onClick={() => setViewFilter('ALL')}
              className={`btn-press rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                viewFilter === 'ALL'
                  ? 'bg-white/85 text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
              }`}
            >
              Semua Live ({activeSessions.length})
            </button>
            <button
              type="button"
              onClick={() => setViewFilter('FLAGGED')}
              className={`btn-press rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                viewFilter === 'FLAGGED'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
              }`}
            >
              Terdeteksi Keluar ({flaggedCount})
            </button>
          </div>
          <span>
            Audio otomatis di-<strong>Mute</strong> agar suara tidak bertabrakan; klik <strong>Unmute</strong> pada satu peserta.
          </span>
        </div>

        <span className="font-mono-tabular font-semibold text-emerald-700">
          {activeSessions.length} Peserta Aktif
        </span>
      </div>

      {/* Broadcast Warning Bar */}
      <div className="surface-card flex flex-col sm:flex-row items-stretch sm:items-center gap-2 px-4 py-3">
        <input
          type="text"
          value={customWarning}
          onChange={(e) => setCustomWarning(e.target.value)}
          placeholder="Ketik pesan pengumuman / teguran untuk seluruh peserta aktif..."
          className="glass-input flex-1 rounded-xl px-3.5 py-2 text-xs text-slate-900"
        />
        <button
          type="button"
          onClick={handleBroadcastAll}
          className="btn-press inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-300/70 bg-red-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap shrink-0"
        >
          <BellRing className="h-3.5 w-3.5" />
          <span>Tegur Semua ({activeSessions.length})</span>
        </button>
      </div>

      {sentNotice && (
        <div className="rounded-xl border border-emerald-300/60 bg-emerald-500/15 px-4 py-2.5 text-xs font-medium text-emerald-900 panel-enter">
          {sentNotice}
        </div>
      )}

      {visibleSessions.length === 0 ? (
        <div className="surface-card p-8 text-center text-xs text-slate-500">
          Tidak ada peserta yang terdeteksi keluar aplikasi saat ini.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {visibleSessions.map((session) => (
            <StudentVideoTile
              key={session.sessionId}
              session={session}
              isUnmuted={unmutedSessionId === session.sessionId}
              onToggleMute={() =>
                setUnmutedSessionId((prev) =>
                  prev === session.sessionId ? null : session.sessionId
                )
              }
              onSpotlight={() => {
                setSpotlightSessionId(session.sessionId);
                setUnmutedSessionId(session.sessionId);
              }}
              onSendWarning={(msg) => handleWarning(session.sessionId, msg)}
            />
          ))}
        </div>
      )}

      {/* Spotlight Fullscreen Modal */}
      {spotlightSession && (
        <SpotlightModal
          session={spotlightSession}
          customWarning={customWarning}
          onChangeCustomWarning={setCustomWarning}
          onSendWarning={() => handleWarning(spotlightSession.sessionId, customWarning)}
          onClose={() => setSpotlightSessionId(null)}
        />
      )}
    </div>
  );
};

const SpotlightModal: React.FC<{
  session: LiveStreamSession;
  customWarning: string;
  onChangeCustomWarning: (v: string) => void;
  onSendWarning: () => void;
  onClose: () => void;
}> = ({ session, customWarning, onChangeCustomWarning, onSendWarning, onClose }) => {
  const { remoteStream } = useProctorWebRTCViewer(session);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
    >
      <div className="glass-dark w-full max-w-3xl overflow-hidden rounded-3xl text-white shadow-2xl panel-enter">
        <div className="flex items-center justify-between border-b border-white/15 px-5 py-3.5">
          <div>
            <h3 className="font-display text-base font-bold">
              Spotlight Pengawasan: {session.namaSiswa} ({session.kelas})
            </h3>
            <p className="text-xs text-slate-300">
              {session.mataPelajaran} · {session.judulUjian}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup Spotlight"
            className="btn-press rounded-xl p-1.5 text-slate-300 hover:bg-white/15 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative aspect-video w-full bg-black">
          {remoteStream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={muted}
              className="h-full w-full object-contain"
            />
          ) : session.snapshotPreview ? (
            <img
              src={session.snapshotPreview}
              alt={session.namaSiswa}
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-400">
              Menunggu feed video...
            </div>
          )}

          <div className="absolute top-3 left-3 flex items-center gap-2 rounded-xl border border-white/20 bg-slate-900/75 px-3 py-1.5 text-xs backdrop-blur-md">
            <AlertTriangle
              className={`h-3.5 w-3.5 ${
                session.pelanggaranTab > 0 ? 'text-red-400' : 'text-emerald-400'
              }`}
            />
            <span>
              Status Pengawasan:{' '}
              {session.pelanggaranTab > 0
                ? `Terdeteksi Keluar Aplikasi (${session.pelanggaranTab}/3)`
                : 'Aktif di Layar Ujian'}
            </span>
          </div>
        </div>

        <div className="p-4 space-y-3 border-t border-white/15 bg-slate-950/35">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4 text-xs font-mono-tabular">
              <span>Audio: {Math.round(session.audioLevel)}%</span>
              <span>Keluar Aplikasi: {session.pelanggaranTab}/3</span>
            </div>
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4 text-emerald-400" />}
              <span>{muted ? 'Aktifkan Suara' : 'Suara Aktif'}</span>
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={customWarning}
              onChange={(e) => onChangeCustomWarning(e.target.value)}
              placeholder="Ketik pesan peringatan untuk layar siswa..."
              className="flex-1 rounded-xl border border-white/20 bg-white/10 px-3.5 py-2 text-xs text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={onSendWarning}
              className="btn-press inline-flex items-center justify-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap"
            >
              <BellRing className="h-4 w-4" />
              <span>Kirim Peringatan + Alarm</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
