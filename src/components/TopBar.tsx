import React, { useRef } from 'react';
import {
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BookOpenCheck,
  Download,
  GraduationCap,
  QrCode,
  Shield,
  ShieldCheck,
} from 'lucide-react';
import type { SyncStatusInfo, UserRole } from '../types/cbt';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { useLiquidMorphPill } from '../hooks/useLiquidMotion';
import { useBatteryStatus } from '../hooks/useBatteryStatus';

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
  const { pillStyle, visible: pillVisible, isMorphing, isMoving, morphAxis } = useLiquidMorphPill(
    navRef,
    activeRole
  );
  const battery = useBatteryStatus();

  const renderBatteryIcon = () => {
    if (!battery.supported) return <Battery className="h-3.5 w-3.5 text-slate-500 shrink-0" />;
    if (battery.charging) return <BatteryCharging className="h-3.5 w-3.5 text-emerald-700 shrink-0" />;
    if (battery.severity === 'low') return <BatteryLow className="h-3.5 w-3.5 text-rose-600 shrink-0" />;
    if (battery.severity === 'medium') return <BatteryMedium className="h-3.5 w-3.5 text-amber-600 shrink-0" />;
    return <BatteryFull className="h-3.5 w-3.5 text-emerald-700 shrink-0" />;
  };

  const batteryToneClass = !battery.supported
    ? 'border-white/65 bg-white/45 text-slate-600'
    : battery.charging
      ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-900'
      : battery.severity === 'low'
        ? 'border-rose-400/70 bg-rose-500/15 text-rose-900'
        : battery.severity === 'medium'
          ? 'border-amber-400/70 bg-amber-500/15 text-amber-900'
          : 'border-white/75 bg-white/60 text-slate-800';

  return (
    <header className="sticky top-0 z-40 liquid-header no-print">
      <div className="mx-auto flex max-w-7xl flex-wrap md:flex-nowrap items-center justify-between gap-1.5 sm:gap-2.5 lg:gap-5 px-2.5 sm:px-5 lg:px-6 py-2 sm:py-2.5">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => !isExamLocked && onSelectRole('siswa')}
          className="btn-press flex min-h-[36px] sm:min-h-[38px] items-center gap-1.5 sm:gap-2 text-left whitespace-nowrap shrink-0 rounded-xl px-1 sm:px-1.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
        >
          <span className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-xl bg-slate-900/90 border border-white/35 text-cyan-300 shadow-xs">
            <ShieldCheck className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </span>
          <span className="font-display text-[13px] sm:text-base lg:text-lg font-bold tracking-tight text-slate-900">
            CBT MTs Nurul Hijrah
          </span>
        </button>

        {/* Zone 3 (mobile top-right, tablet/desktop far-right via order) */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0 md:order-3">
          {/* Live Device Battery Health Chip */}
          <div
            data-testid="topbar-battery-indicator"
            role="status"
            title={battery.tooltip}
            aria-label={battery.tooltip}
            className={`min-h-[34px] sm:min-h-[40px] inline-flex items-center gap-1 sm:gap-1.5 rounded-xl border px-2 sm:px-2.5 py-1 sm:py-1.5 text-[11px] sm:text-xs font-semibold font-mono-tabular whitespace-nowrap shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] transition-colors ${batteryToneClass}`}
          >
            {renderBatteryIcon()}
            <span>{battery.shortLabel}</span>
            {battery.charging && (
              <span className="hidden xl:inline text-[10px] font-sans font-bold text-emerald-800">
                Mengisi
              </span>
            )}
          </div>

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
              className="btn-press min-h-[34px] sm:min-h-[40px] inline-flex items-center gap-1.5 lg:gap-2 rounded-xl bg-emerald-700/95 border border-emerald-400/50 px-2.5 sm:px-3 lg:px-4 py-1 sm:py-1.5 text-[11px] sm:text-xs lg:text-sm font-bold text-white shadow-[0_8px_22px_-6px_rgba(4,120,87,0.62)] hover:bg-emerald-800 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
            >
              <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
              <span className="hidden sm:inline">Instal Aplikasi</span>
              <span className="sm:hidden">Instal</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenQRInstall}
            data-testid="topbar-qr-install-btn"
            aria-label="Buka Panduan Instal & Kode QR"
            className={`btn-press min-h-[34px] sm:min-h-[40px] inline-flex items-center gap-1 sm:gap-1.5 lg:gap-2 rounded-xl px-2 sm:px-2.5 lg:px-3.5 py-1 sm:py-1.5 text-[11px] sm:text-xs lg:text-sm font-semibold whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 ${
              canDirectInstall
                ? 'glass-subtle border-white/80 text-slate-800 hover:bg-white/90'
                : 'bg-emerald-700/95 border border-emerald-400/45 text-white shadow-[0_8px_20px_-8px_rgba(4,120,87,0.55)] hover:bg-emerald-800'
            }`}
          >
            <QrCode className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
            {canDirectInstall ? (
              <span className="hidden sm:inline">QR / Panduan</span>
            ) : (
              <>
                <span className="hidden lg:inline">Install HP / QR</span>
                <span className="hidden sm:inline lg:hidden">Install QR</span>
                <span className="sm:hidden">QR</span>
              </>
            )}
          </button>
        </div>

        {/* Zone 2: Hyper-Liquid Glass Gooey Morphing Pill Portal Switcher */}
        <nav
          ref={navRef}
          aria-label="Navigasi Portal"
          className="relative w-full md:w-auto md:order-2 grid grid-cols-3 md:flex items-center gap-1 rounded-2xl border border-white/65 border-t-white/90 border-l-white/80 bg-white/40 p-1 shadow-[inset_0_1px_1px_rgba(255,255,255,0.85),inset_-1px_-1px_4px_rgba(30,58,138,0.08),0_10px_24px_-14px_rgba(30,58,138,0.2)] shrink-0"
        >
          <div aria-hidden="true" className="liquid-gooey-stage pointer-events-none absolute inset-0 z-0">
            <span
              style={pillStyle}
              data-morphing={isMorphing ? 'true' : undefined}
              data-morph-animating={isMoving ? 'true' : undefined}
              data-morph-axis={morphAxis}
              className="liquid-morph-pill rounded-xl"
            />
          </div>
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
                <span className={isActive ? 'text-cyan-700' : 'text-slate-600'}>
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
