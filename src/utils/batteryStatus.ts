export type BatterySeverity = 'charging' | 'healthy' | 'medium' | 'low' | 'unknown';

export interface RawBatterySnapshot {
  supported: boolean;
  level: number | null; // 0.0 to 1.0
  charging: boolean | null;
  chargingTime?: number | null; // seconds or Infinity
  dischargingTime?: number | null; // seconds or Infinity
}

export interface BatteryIndicatorState {
  supported: boolean;
  percentage: number | null;
  charging: boolean;
  severity: BatterySeverity;
  shortLabel: string;
  tooltip: string;
}

/**
 * Formats finite remaining seconds into compact Indonesian hours/minutes text.
 */
export function formatBatteryDurationSeconds(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 1) return '< 1 mnt';
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours <= 0) return `${mins} mnt`;
  if (mins === 0) return `${hours} jam`;
  return `${hours}j ${mins}m`;
}

/**
 * Normalizes raw navigator.getBattery() readings into crisp UI state for TopBar.
 */
export function deriveBatteryIndicatorState(raw: RawBatterySnapshot): BatteryIndicatorState {
  if (!raw.supported || raw.level === null || !Number.isFinite(raw.level)) {
    return {
      supported: false,
      percentage: null,
      charging: false,
      severity: 'unknown',
      shortLabel: 'N/A',
      tooltip: 'Status daya baterai perangkat tidak diekspos oleh browser ini.',
    };
  }

  const clamped = Math.min(1, Math.max(0, raw.level));
  const percentage = Math.round(clamped * 100);
  const charging = Boolean(raw.charging);

  let severity: BatterySeverity;
  if (charging) {
    severity = 'charging';
  } else if (percentage <= 20) {
    severity = 'low';
  } else if (percentage <= 39) {
    severity = 'medium';
  } else {
    severity = 'healthy';
  }

  const timeEstimate = charging
    ? formatBatteryDurationSeconds(raw.chargingTime)
    : formatBatteryDurationSeconds(raw.dischargingTime);

  const statusText = charging
    ? percentage >= 100
      ? 'Penuh (Terhubung daya)'
      : 'Mengisi daya'
    : severity === 'low'
      ? 'Daya rendah — segera hubungkan pengisi daya'
      : severity === 'medium'
        ? 'Daya sedang'
        : 'Daya aman';

  const durationSuffix = timeEstimate
    ? charging
      ? ` · Penuh ± ${timeEstimate}`
      : ` · Sisa ± ${timeEstimate}`
    : '';

  return {
    supported: true,
    percentage,
    charging,
    severity,
    shortLabel: `${percentage}%`,
    tooltip: `Baterai ${percentage}% (${statusText})${durationSuffix}`,
  };
}
