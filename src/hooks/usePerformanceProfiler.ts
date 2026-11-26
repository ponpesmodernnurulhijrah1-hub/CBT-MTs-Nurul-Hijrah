import { useEffect } from 'react';
import type { DevicePerfTier } from '../utils/deviceViewport';
import {
  applyProfilerSettingsToRoot,
  evaluateFpsProfilerWindow,
  mapDeviceTierToProfilerLevel,
  type FpsProfilerState,
  type ProfilerQualityLevel,
} from '../utils/performanceProfiler';

function readInitialTier(): DevicePerfTier {
  if (typeof document === 'undefined') return 'high';
  const raw = document.documentElement.dataset.perfTier;
  if (raw === 'lite' || raw === 'balanced' || raw === 'high') return raw;
  return 'high';
}

/**
 * Automatic zero-rerender FPS Performance Profiler.
 * Continuously measures frame pacing while the document is visible and dynamically
 * lowers CSS filter intensity (`--glass-blur-radius`, `--glass-saturate`, `--aurora-opacity`)
 * and disables decorative particles (`data-particles="off"`) on low-FPS devices
 * without stripping core functionality.
 */
export function usePerformanceProfiler(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const root = document.documentElement;
    const initialTier = readInitialTier();
    const initialLevel = mapDeviceTierToProfilerLevel(initialTier);
    const ceilingLevel: ProfilerQualityLevel = initialLevel;

    let state: FpsProfilerState = {
      level: initialLevel,
      lowStreak: 0,
      highStreak: 0,
      lastMeasuredFps: initialLevel === 'ultra' ? 60 : initialLevel === 'balanced' ? 45 : 30,
    };

    applyProfilerSettingsToRoot(root, state.level, state.lastMeasuredFps);

    let rafId: number | null = null;
    let frameCount = 0;
    let windowStartMs = performance.now();
    let isDisposed = false;

    const sampleTick = (now: number) => {
      if (isDisposed || document.hidden) {
        rafId = null;
        return;
      }

      frameCount += 1;
      const elapsedMs = now - windowStartMs;

      if (elapsedMs >= 1000) {
        const measuredFps = (frameCount * 1000) / elapsedMs;
        const { nextState, changed } = evaluateFpsProfilerWindow(
          state,
          measuredFps,
          ceilingLevel
        );
        state = nextState;

        if (changed) {
          applyProfilerSettingsToRoot(root, state.level, measuredFps);
        } else {
          root.dataset.profilerFps = String(Math.round(measuredFps));
        }

        frameCount = 0;
        windowStartMs = now;
      }

      rafId = window.requestAnimationFrame(sampleTick);
    };

    const startLoop = () => {
      if (isDisposed || document.hidden || rafId !== null) return;
      frameCount = 0;
      windowStartMs = performance.now();
      rafId = window.requestAnimationFrame(sampleTick);
    };

    const onVisibilityChange = () => {
      if (document.hidden && rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      } else if (!document.hidden) {
        startLoop();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    startLoop();

    return () => {
      isDisposed = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}
