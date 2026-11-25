export type DeviceViewportClass = 'mobile' | 'tablet' | 'desktop';
export type PwaDisplayMode = 'standalone' | 'browser';
export type DevicePerfTier = 'high' | 'balanced' | 'lite';

export interface DeviceHardwareSignals {
  deviceType: DeviceViewportClass;
  hardwareConcurrency?: number | null;
  deviceMemory?: number | null;
  saveData?: boolean;
  effectiveType?: string | null;
  isCoarsePointer?: boolean;
  prefersReducedMotion?: boolean;
}

/**
 * Classifies the active device into a GPU/CPU rendering tier so entry-level phones
 * receive zero-lag 60fps pure-2D composited transitions while higher-end devices
 * get full refractive Hyper-Liquid Glass effects.
 */
export function resolveDevicePerfTier(signals: DeviceHardwareSignals): DevicePerfTier {
  if (signals.prefersReducedMotion || signals.saveData) {
    return 'lite';
  }

  const net = typeof signals.effectiveType === 'string' ? signals.effectiveType.toLowerCase() : '';
  if (net === 'slow-2g' || net === '2g') {
    return 'lite';
  }

  const mem =
    typeof signals.deviceMemory === 'number' && Number.isFinite(signals.deviceMemory) && signals.deviceMemory > 0
      ? signals.deviceMemory
      : null;
  const cores =
    typeof signals.hardwareConcurrency === 'number' &&
    Number.isFinite(signals.hardwareConcurrency) &&
    signals.hardwareConcurrency > 0
      ? signals.hardwareConcurrency
      : null;

  // 1-3 GB RAM devices (classic entry-level smartphones)
  if (mem !== null && mem <= 3) {
    return 'lite';
  }

  // <= 4 CPU cores on mobile/touch phones
  if (cores !== null && cores <= 4 && (signals.deviceType === 'mobile' || signals.isCoarsePointer)) {
    return 'lite';
  }

  // Mid-range mobile/tablet/touch or 4 GB RAM or <= 4 cores desktop
  if (
    signals.deviceType === 'mobile' ||
    signals.isCoarsePointer ||
    (mem !== null && mem <= 4) ||
    (cores !== null && cores <= 4)
  ) {
    return 'balanced';
  }

  return 'high';
}

/**
 * Evaluates measured rolling FPS and steps performance tier down monotonically
 * when sustained frame pacing drops below target so limited GPUs stay zero-lag.
 */
export function evaluateAdaptiveFpsStepDown(
  currentTier: DevicePerfTier,
  measuredFps: number,
  lowWindowStreak: number
): DevicePerfTier {
  if (!Number.isFinite(measuredFps) || measuredFps <= 0 || lowWindowStreak < 2) {
    return currentTier;
  }
  if (currentTier === 'high' && measuredFps < 44) {
    return 'balanced';
  }
  if (currentTier === 'balanced' && measuredFps < 34) {
    return 'lite';
  }
  return currentTier;
}

export const IDEAL_VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1.0, viewport-fit=cover';

/**
 * Classifies the active viewport width into responsive device tiers matching Tailwind breakpoints.
 */
export function classifyDeviceType(width: number): DeviceViewportClass {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 390;
  if (safeWidth < 640) return 'mobile';
  if (safeWidth < 1024) return 'tablet';
  return 'desktop';
}

/**
 * Resolves the true CSS viewport width on standalone PWAs where visualViewport or innerWidth
 * may temporarily lag behind after orientation changes or window resizes.
 */
export function resolveEffectiveViewportWidth(params: {
  innerWidth?: number | null;
  clientWidth?: number | null;
  visualViewportWidth?: number | null;
}): number {
  const candidates = [params.visualViewportWidth, params.innerWidth, params.clientWidth].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
  );
  if (candidates.length === 0) return 390;
  return Math.round(Math.min(...candidates));
}

/**
 * Detects whether an installed mobile/touch PWA has fallen back into a 980px desktop layout viewport.
 */
export function isViewportStuckInDesktopFallback(params: {
  clientWidth: number;
  screenWidth: number;
  isTouchDevice: boolean;
}): boolean {
  if (!params.isTouchDevice) return false;
  if (!Number.isFinite(params.screenWidth) || params.screenWidth <= 0) return false;
  if (!Number.isFinite(params.clientWidth) || params.clientWidth <= 0) return false;
  return params.screenWidth <= 640 && params.clientWidth >= 800;
}

export function detectInstalledDisplayMode(
  isStandaloneMediaMatch: boolean,
  isNavigatorStandalone: boolean
): PwaDisplayMode {
  return isStandaloneMediaMatch || isNavigatorStandalone ? 'standalone' : 'browser';
}

/**
 * Enforces `width=device-width, initial-scale=1.0, viewport-fit=cover` on the document's viewport meta tag
 * and forces a viewport re-parse if a mobile browser/WebAPK loaded with a 980px desktop fallback.
 */
export function ensureResponsiveViewportMeta(): void {
  if (typeof document === 'undefined') return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.id = 'app-viewport';
    meta.content = IDEAL_VIEWPORT_CONTENT;
    document.head.prepend(meta);
    return;
  }

  if (meta.getAttribute('content') !== IDEAL_VIEWPORT_CONTENT) {
    meta.setAttribute('content', IDEAL_VIEWPORT_CONTENT);
  }

  const isTouch =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
  const screenW = typeof window !== 'undefined' ? window.screen?.availWidth || window.screen?.width || 0 : 0;
  const clientW = document.documentElement?.clientWidth || 0;

  if (
    isViewportStuckInDesktopFallback({
      clientWidth: clientW,
      screenWidth: screenW,
      isTouchDevice: Boolean(isTouch),
    })
  ) {
    meta.setAttribute('content', 'width=device-width, initial-scale=1.0001, viewport-fit=cover');
    meta.setAttribute('content', IDEAL_VIEWPORT_CONTENT);
  }
}

/**
 * Synchronizes `data-device-type`, `data-display-mode`, `data-perf-tier`, and `--app-dvh` on `<html>`
 * whenever window dimensions, visualViewport, orientation, hardware signals, or display-mode change.
 */
export function syncDocumentDeviceAttributes(): {
  deviceType: DeviceViewportClass;
  displayMode: PwaDisplayMode;
  perfTier: DevicePerfTier;
  width: number;
} {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { deviceType: 'desktop', displayMode: 'browser', perfTier: 'high', width: 1280 };
  }

  ensureResponsiveViewportMeta();

  const effectiveWidth = resolveEffectiveViewportWidth({
    innerWidth: window.innerWidth,
    clientWidth: document.documentElement.clientWidth,
    visualViewportWidth: window.visualViewport?.width ?? null,
  });
  const deviceType = classifyDeviceType(effectiveWidth);
  const isStandaloneMatch = Boolean(
    window.matchMedia?.('(display-mode: standalone)').matches ||
      window.matchMedia?.('(display-mode: minimal-ui)').matches
  );
  const isNavStandalone = Boolean(
    (window.navigator as unknown as { standalone?: boolean }).standalone
  );
  const displayMode = detectInstalledDisplayMode(isStandaloneMatch, isNavStandalone);

  const nav = window.navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  const isCoarsePointer = Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  const prefersReducedMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const perfTier = resolveDevicePerfTier({
    deviceType,
    hardwareConcurrency: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    saveData: Boolean(nav.connection?.saveData),
    effectiveType: typeof nav.connection?.effectiveType === 'string' ? nav.connection.effectiveType : null,
    isCoarsePointer,
    prefersReducedMotion,
  });

  const root = document.documentElement;
  root.dataset.deviceType = deviceType;
  root.dataset.displayMode = displayMode;
  const profilerLevel = root.dataset.profilerLevel;
  const profilerTierCap: DevicePerfTier =
    profilerLevel === 'low'
      ? 'lite'
      : profilerLevel === 'balanced' && perfTier === 'high'
        ? 'balanced'
        : perfTier;
  root.dataset.perfTier = profilerTierCap;
  const vh = window.visualViewport?.height || window.innerHeight || 0;
  if (vh > 0) {
    root.style.setProperty('--app-dvh', `${vh}px`);
  }

  return { deviceType, displayMode, perfTier, width: effectiveWidth };
}
