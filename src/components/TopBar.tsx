import React from 'react';
import { QrCode, ShieldCheck, GraduationCap, BookOpenCheck, Shield } from 'lucide-react';
import type { SyncStatusInfo, UserRole } from '../types/cbt';
import { SyncStatusIndicator } from './SyncStatusIndicator';

interface TopBarProps {
  activeRole: UserRole;
  onSelectRole: (role: UserRole) => void;
  onOpenQRInstall: () => void;
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
  isExamLocked = false,
  syncInfo,
  onForceSync,
}) => {
  return (
    <header className="sticky top-0 z-40 border-b border-white/50 bg-white/40 backdrop-blur-xl shadow-[0_8px_24px_-14px_rgba(15,23,42,0.12)] no-print">
      <div className="mx-auto flex max-w-7xl flex-wrap md:flex-nowrap items-center justify-between gap-2.5 md:gap-8 px-4 sm:px-6 py-2.5 sm:py-3">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => !isExamLocked && onSelectRole('siswa')}
          className="btn-press flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900/90 border border-white/20 text-emerald-400 shadow-xs">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <span className="font-display text-sm sm:text-lg font-bold tracking-tight text-slate-900">
            CBT MTs Nurul Hijrah
          </span>
        </button>

        {/* Zone 3 (mobile right, desktop far-right via order) */}
        <div className="flex items-center gap-2 shrink-0 md:order-3">
          {syncInfo && (
            <SyncStatusIndicator
              syncInfo={syncInfo}
              onForceSync={onForceSync}
              variant="compact"
            />
          )}
          <button
            type="button"
            onClick={onOpenQRInstall}
            className="btn-press inline-flex items-center gap-1.5 sm:gap-2 rounded-xl bg-emerald-700/95 border border-emerald-500/40 px-3 sm:px-3.5 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
          >
            <QrCode className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Install HP / QR</span>
            <span className="sm:hidden">Install QR</span>
          </button>
        </div>

        {/* Zone 2: Frosted Segmented Portal Switcher */}
        <nav
          aria-label="Navigasi Portal"
          className="w-full md:w-auto md:order-2 grid grid-cols-3 md:flex items-center gap-1 rounded-2xl border border-white/60 bg-white/35 backdrop-blur-md p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] shrink-0"
        >
          {PORTAL_NAV.map((item) => {
            const isActive = activeRole === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={isExamLocked}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSelectRole(item.id)}
                className={`btn-press relative inline-flex items-center justify-center gap-1.5 sm:gap-2 rounded-xl px-2.5 sm:px-3.5 py-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-all ${
                  isActive
                    ? 'bg-white/85 text-slate-900 shadow-sm border border-white/80'
                    : 'text-slate-700 hover:text-slate-900 hover:bg-white/45 border border-transparent'
                } ${isExamLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span className={isActive ? 'text-emerald-700' : 'text-slate-500'}>
                  {item.icon}
                </span>
                <span className="hidden sm:inline">{item.label}</span>
                <span className="sm:hidden">{item.shortLabel}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
