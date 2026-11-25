import type { DevicePerfTier } from './deviceViewport';

export type ProfilerQualityLevel = 'ultra' | 'balanced' | 'low';

export interface ProfilerFilterSettings {
  level: ProfilerQualityLevel;
  blurRadiusPx: number;
  modalBlurRadiusPx: number;
  saturatePercent: number;
  contrastPercent: number;
  auroraOpacity: number;
  particlesEnabled: boolean;
  svgRefractEnabled: boolean;
}

export interface FpsProfilerState {
  level: ProfilerQualityLevel;
  lowStreak: number;
  highStreak: number;
  lastMeasuredFps: number;
}

const LEVEL_RANK: Record<ProfilerQualityLevel, number> = {
  low: 0,
  balanced: 1,
  ultra: 2,
};

export function mapDeviceTierToProfilerLevel(tier: DevicePerfTier): ProfilerQualityLevel {
  if (tier === 'lite') return 'low';
  if (tier === 'balanced') return 'balanced';
  return 'ultra';
}

export function mapProfilerLevelToPerfTier(level: ProfilerQualityLevel): DevicePerfTier {
  if (level === 'low') return 'lite';
  if (level === 'balanced') return 'balanced';
  return 'high';
}

/**
 * Returns dynamic CSS filter & particle intensity settings matching the current
 * FPS profiler level without removing core application or transition features.
 */
export function resolveProfilerFilterSettings(
  level: ProfilerQualityLevel
): ProfilerFilterSettings {
  if (level === 'low') {
    return {
      level: 'low',
      blurRadiusPx: 6,
      modalBlurRadiusPx: 8,
      saturatePercent: 140,
      contrastPercent: 100,
      auroraOpacity: 0.36,
      particlesEnabled: false,
      svgRefractEnabled: false,
    };
  }
  if (level === 'balanced') {
    return {
      level: 'balanced',
      blurRadiusPx: 16,
      modalBlurRadiusPx: 18,
      saturatePercent: 195,
      contrastPercent: 104,
      auroraOpacity: 0.48,
      particlesEnabled: true,
      svgRefractEnabled: false,
    };
  }
  return {
    level: 'ultra',
    blurRadiusPx: 40,
    modalBlurRadiusPx: 40,
    saturatePercent: 240,
    contrastPercent: 106,
    auroraOpacity: 0.58,
    particlesEnabled: true,
    svgRefractEnabled: true,
  };
}

/**
 * Evaluates a rolling FPS sampling window (~1.2s) with asymmetric hysteresis:
 * - Rapidly steps down when sustained FPS drops (or immediately on severe stall < 22/30 FPS)
 * - Gradually steps back up when FPS recovers smoothly, bounded by `maxCeilingLevel`
 */
export function evaluateFpsProfilerWindow(
  currentState: FpsProfilerState,
  measuredFps: number,
  maxCeilingLevel: ProfilerQualityLevel = 'ultra'
): { nextState: FpsProfilerState; changed: boolean } {
  if (!Number.isFinite(measuredFps) || measuredFps <= 0) {
    return { nextState: currentState, changed: false };
  }

  const fps = Math.round(measuredFps * 10) / 10;
  let nextLevel: ProfilerQualityLevel = currentState.level;
  let lowStreak = currentState.lowStreak;
  let highStreak = currentState.highStreak;

  if (currentState.level === 'ultra') {
    if (fps < 30) {
      nextLevel = 'balanced';
      lowStreak = 0;
      highStreak = 0;
    } else if (fps < 46) {
      lowStreak += 1;
      highStreak = 0;
      if (lowStreak >= 2) {
        nextLevel = 'balanced';
        lowStreak = 0;
      }
    } else {
      lowStreak = 0;
    }
  } else if (currentState.level === 'balanced') {
    if (fps < 22) {
      nextLevel = 'low';
      lowStreak = 0;
      highStreak = 0;
    } else if (fps < 34) {
      lowStreak += 1;
      highStreak = 0;
      if (lowStreak >= 2) {
        nextLevel = 'low';
        lowStreak = 0;
      }
    } else if (fps >= 55 && LEVEL_RANK[maxCeilingLevel] >= LEVEL_RANK.ultra) {
      lowStreak = 0;
      highStreak += 1;
      if (highStreak >= 5) {
        nextLevel = 'ultra';
        highStreak = 0;
      }
    } else {
      lowStreak = 0;
      highStreak = 0;
    }
  } else {
    // Currently in 'low'
    if (fps >= 46 && LEVEL_RANK[maxCeilingLevel] >= LEVEL_RANK.balanced) {
      lowStreak = 0;
      highStreak += 1;
      if (highStreak >= 4) {
        nextLevel = 'balanced';
        highStreak = 0;
      }
    } else {
      highStreak = 0;
    }
  }

  const nextState: FpsProfilerState = {
    level: nextLevel,
    lowStreak,
    highStreak,
    lastMeasuredFps: fps,
  };

  return {
    nextState,
    changed: nextLevel !== currentState.level,
  };
}

/**
 * Applies dynamic CSS variables and profiler attributes onto `document.documentElement`
 * without triggering any React re-renders.
 */
export function applyProfilerSettingsToRoot(
  root: HTMLElement,
  level: ProfilerQualityLevel,
  measuredFps?: number
): ProfilerFilterSettings {
  const settings = resolveProfilerFilterSettings(level);
  root.style.setProperty('--glass-blur-radius', `${settings.blurRadiusPx}px`);
  root.style.setProperty('--glass-modal-blur', `${settings.modalBlurRadiusPx}px`);
  root.style.setProperty('--glass-saturate', `${settings.saturatePercent}%`);
  root.style.setProperty('--glass-contrast', `${settings.contrastPercent}%`);
  root.style.setProperty('--aurora-opacity', String(settings.auroraOpacity));

  root.dataset.profilerLevel = settings.level;
  root.dataset.particles = settings.particlesEnabled ? 'on' : 'off';
  root.dataset.svgRefract = settings.svgRefractEnabled ? 'on' : 'off';
  root.dataset.perfTier = mapProfilerLevelToPerfTier(settings.level);
  if (typeof measuredFps === 'number' && Number.isFinite(measuredFps) && measuredFps > 0) {
    root.dataset.profilerFps = String(Math.round(measuredFps));
  }

  return settings;
}
