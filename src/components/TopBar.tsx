import React, { useRef } from 'react';
import { Download, QrCode, ShieldCheck, GraduationCap, BookOpenCheck, Shield } from 'lucide-react';
import type { SyncStatusInfo, UserRole } from '../types/cbt';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { useLiquidMorphPill } from '../hooks/useLiquidMotion';

interface TopBarProps {
  activeRole: UserRole;
  onSelectRole: (role: UserRole) => void;
  onOpenQRInstall: () => void;
  canDirectInstall?: boolean;
  onDirectInstall?: () => void;
  isExamLocked?: boolean;
  syncInfo?: SyncStatusInfo;
  onForceSync?: () => Promise<void>;
}

const PORTAL_NAV: Array<{ id: UserRole; label: string; shortLabel: string; icon: React.ReactNode }> = [
  { id: 'siswa', label: 'Ujian Siswa', shortLabel: 'Siswa', icon: <GraduationCap className="h-4 w-4" /> },
  { id: 'guru', label: 'Portal Guru', shortLabel: 'Guru', icon: <BookOpenCheck className="h-4 w-4" /> },
  { id: 'admin', label: 'Super Admin', shortLabel: 'Admin', icon: <Shield className="h-4 w-4" /> },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeRole,
  onSelectRole,
  onOpenQRInstall,
  canDirectInstall = false,
  onDirectInstall,
  isExamLocked = false,
  syncInfo,
  onForceSync,
}) => {
  const navRef = useRef<HTMLElement | null>(null);
  const { pillStyle, visible: pillVisible } = useLiquidMorphPill(navRef, activeRole);

  return (
    <header className="sticky top-0 z-40 liquid-header no-print">
      <div className="mx-auto flex max-w-7xl flex-wrap md:flex-nowrap items-center justify-between gap-2 md:gap-2.5 lg:gap-6 px-3.5 sm:px-5 lg:px-6 py-2 sm:py-2.5">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => !isExamLocked && onSelectRole('siswa')}
          className="btn-press flex min-h-[38px] items-center gap-2 text-left whitespace-nowrap shrink-0 rounded-xl px-1.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900/90 border border-white/30 text-emerald-400 shadow-xs">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <span className="font-display text-sm sm:text-base lg:text-lg font-bold tracking-tight text-slate-900">
            CBT MTs Nurul Hijrah
          </span>
        </button>

        {/* Zone 3 (mobile top-right, tablet/desktop far-right via order) */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 md:order-3">
          {syncInfo && (
            <SyncStatusIndicator
              syncInfo={syncInfo}
              onForceSync={onForceSync}
              variant="compact"
            />
          )}
          {canDirectInstall && onDirectInstall && (
            <button
              type="button"
              onClick={onDirectInstall}
              data-testid="topbar-direct-install-btn"
              aria-label="Instal Aplikasi ke Perangkat"
              className="btn-press min-h-[40px] inline-flex items-center gap-1.5 lg:gap-2 rounded-xl bg-emerald-700/95 border border-emerald-400/50 px-3 lg:px-4 py-1.5 text-xs lg:text-sm font-bold text-white shadow-[0_8px_22px_-6px_rgba(4,120,87,0.62)] hover:bg-emerald-800 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
            >
              <Download className="h-4 w-4 shrink-0" />
              <span>Instal Aplikasi</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenQRInstall}
            data-testid="topbar-qr-install-btn"
            aria-label="Buka Panduan Instal & Kode QR"
            className={`btn-press min-h-[40px] inline-flex items-center gap-1.5 lg:gap-2 rounded-xl px-2.5 lg:px-3.5 py-1.5 text-xs lg:text-sm font-semibold whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 ${
              canDirectInstall
                ? 'glass-subtle border-white/80 text-slate-800 hover:bg-white/90'
                : 'bg-emerald-700/95 border border-emerald-400/45 text-white shadow-[0_8px_20px_-8px_rgba(4,120,87,0.55)] hover:bg-emerald-800'
            }`}
          >
            <QrCode className="h-4 w-4 shrink-0" />
            {canDirectInstall ? (
              <span className="hidden sm:inline">QR / Panduan</span>
            ) : (
              <>
                <span className="hidden lg:inline">Install HP / QR</span>
                <span className="lg:hidden">Install QR</span>
              </>
            )}
          </button>
        </div>

        {/* Zone 2: iOS Liquid Glass Morphing Pill Portal Switcher */}
        <nav
          ref={navRef}
          aria-label="Navigasi Portal"
          className="relative w-full md:w-auto md:order-2 grid grid-cols-3 md:flex items-center gap-1 rounded-2xl border border-white/55 border-t-white/85 border-l-white/75 bg-white/35 backdrop-blur-2xl backdrop-saturate-[180%] p-1 shadow-[inset_0_1px_1px_rgba(255,255,255,0.82),0_10px_24px_-14px_rgba(30,58,138,0.2)] shrink-0"
        >
          <span
            aria-hidden="true"
            style={pillStyle}
            className="liquid-morph-pill rounded-xl z-0"
          />
          {PORTAL_NAV.map((item) => {
            const isActive = activeRole === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={isExamLocked}
                data-morph-active={isActive ? 'true' : undefined}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSelectRole(item.id)}
                className={`btn-press relative z-10 min-h-[36px] sm:min-h-[38px] inline-flex items-center justify-center gap-1.5 lg:gap-2 rounded-xl px-2.5 lg:px-3.5 py-1.5 text-xs lg:text-sm font-semibold whitespace-nowrap shrink-0 transition-colors duration-200 ${
                  isActive
                    ? pillVisible
                      ? 'text-slate-950'
                      : 'bg-white/90 text-slate-950 shadow-sm border border-white/85'
                    : 'text-slate-700 hover:text-slate-950 hover:bg-white/35 border border-transparent'
                } ${isExamLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span className={isActive ? 'text-emerald-700' : 'text-slate-600'}>
                  {item.icon}
                </span>
                <span className="hidden lg:inline">{item.label}</span>
                <span className="lg:hidden">{item.shortLabel}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
