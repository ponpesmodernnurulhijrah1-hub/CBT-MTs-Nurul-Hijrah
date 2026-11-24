import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEvent,
  type CSSProperties,
  type RefObject,
} from 'react';
import {
  clampRelativeSpecularCoords,
  computeMagneticPull,
  computeMorphStretchMetrics,
  computeRippleMetrics,
  resolveActiveMotionLayerState,
  resolveMorphActiveDurationMs,
  resolveQuestionSlideDirection,
  resolveTabSlideDirection,
  type SlideDirection,
} from '../utils/liquidMotion';

const SPECULAR_SELECTOR =
  '.btn-press, .surface-card-interactive, .liquid-option-card, .liquid-specular';
const MAGNETIC_SELECTOR = '.btn-press, .surface-card-interactive';
const RIPPLE_SELECTOR = '.btn-press, .surface-card-interactive, .liquid-option-card';

/**
 * Global zero-rerender delegated pointer listener driving:
 * 1) Real-time `--lx` / `--ly` cursor spotlight across glass cards & buttons
 * 2) Subtle magnetic micro-attraction (`--mx` / `--my`) on desktop fine pointers
 * 3) Gentle cursor reactivity (`--aurora-dx` / `--aurora-dy`) on Aurora blobs
 * 4) Expanding GPU-composited liquid water ripples on click/tap
 */
export function useLiquidSpecularGlobal(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const isFinePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

    let rafId: number | null = null;
    let pendingTarget: HTMLElement | null = null;
    let pendingX = 0;
    let pendingY = 0;
    let activeMagneticEl: HTMLElement | null = null;
    const gleamTimers = new Map<HTMLElement, number>();
    const rippleCleanups = new Set<() => void>();

    const applySpecularAndMagnet = (el: HTMLElement, clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const { xPercent, yPercent } = clampRelativeSpecularCoords(clientX, clientY, rect);
      el.style.setProperty('--lx', `${xPercent}%`);
      el.style.setProperty('--ly', `${yPercent}%`);

      if (isFinePointer && el.matches(MAGNETIC_SELECTOR) && !(el as HTMLButtonElement).disabled) {
        if (activeMagneticEl && activeMagneticEl !== el && activeMagneticEl.isConnected) {
          activeMagneticEl.style.removeProperty('--mx');
          activeMagneticEl.style.removeProperty('--my');
        }
        activeMagneticEl = el;
        const { tx, ty } = computeMagneticPull(clientX, clientY, rect, 2.8);
        el.style.setProperty('--mx', `${tx}px`);
        el.style.setProperty('--my', `${ty}px`);
      }
    };

    const spawnLiquidRipple = (el: HTMLElement, clientX: number, clientY: number) => {
      if ((el as HTMLButtonElement).disabled) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const { localX, localY, diameter } = computeRippleMetrics(clientX, clientY, rect);
      let layer = el.querySelector<HTMLElement>(':scope > .liquid-ripple-layer');
      if (!layer) {
        layer = document.createElement('span');
        layer.className = 'liquid-ripple-layer';
        layer.setAttribute('aria-hidden', 'true');
        el.appendChild(layer);
      }

      // Cap concurrent ripples per element for entry-level phone stability
      while (layer.childElementCount >= 2) {
        layer.firstElementChild?.remove();
      }

      const wave = document.createElement('span');
      wave.className = 'liquid-ripple-wave';
      wave.style.width = `${diameter}px`;
      wave.style.height = `${diameter}px`;
      wave.style.left = `${localX - diameter / 2}px`;
      wave.style.top = `${localY - diameter / 2}px`;

      let removed = false;
      const cleanup = () => {
        if (removed) return;
        removed = true;
        window.clearTimeout(timerId);
        rippleCleanups.delete(cleanup);
        wave.remove();
        if (layer && layer.isConnected && layer.childElementCount === 0) {
          layer.remove();
        }
      };

      const timerId = window.setTimeout(cleanup, 620);
      rippleCleanups.add(cleanup);
      wave.addEventListener('animationend', cleanup, { once: true });
      layer.appendChild(wave);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const rawTarget = e.target as HTMLElement | null;
      const el = rawTarget?.closest<HTMLElement>(SPECULAR_SELECTOR) ?? null;

      pendingTarget = el;
      pendingX = e.clientX;
      pendingY = e.clientY;

      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        if (isFinePointer && window.innerWidth > 0 && window.innerHeight > 0) {
          const nx = Math.min(1, Math.max(-1, (pendingX / window.innerWidth - 0.5) * 2));
          const ny = Math.min(1, Math.max(-1, (pendingY / window.innerHeight - 0.5) * 2));
          document.documentElement.style.setProperty('--aurora-dx', `${(nx * 36).toFixed(1)}px`);
          document.documentElement.style.setProperty('--aurora-dy', `${(ny * 28).toFixed(1)}px`);
        }
        if (pendingTarget && pendingTarget.isConnected) {
          applySpecularAndMagnet(pendingTarget, pendingX, pendingY);
        } else if (activeMagneticEl && activeMagneticEl.isConnected) {
          activeMagneticEl.style.removeProperty('--mx');
          activeMagneticEl.style.removeProperty('--my');
          activeMagneticEl = null;
        }
        pendingTarget = null;
      });
    };

    const handlePointerOut = (e: PointerEvent) => {
      if (!activeMagneticEl) return;
      const next = e.relatedTarget as Node | null;
      if (!next || !activeMagneticEl.contains(next)) {
        activeMagneticEl.style.removeProperty('--mx');
        activeMagneticEl.style.removeProperty('--my');
        activeMagneticEl = null;
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      const rawTarget = e.target as HTMLElement | null;
      const el = rawTarget?.closest<HTMLElement>(SPECULAR_SELECTOR) ?? null;
      if (!el) return;
      applySpecularAndMagnet(el, e.clientX, e.clientY);

      if (el.matches(RIPPLE_SELECTOR)) {
        spawnLiquidRipple(el, e.clientX, e.clientY);
      }

      const existing = gleamTimers.get(el);
      if (existing !== undefined) window.clearTimeout(existing);
      el.dataset.liquidGleam = '1';
      const timerId = window.setTimeout(() => {
        gleamTimers.delete(el);
        if (el.isConnected) {
          delete el.dataset.liquidGleam;
        }
      }, 320);
      gleamTimers.set(el, timerId);
    };

    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('pointerout', handlePointerOut, { passive: true });
    document.addEventListener('pointerdown', handlePointerDown, { passive: true });

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      gleamTimers.forEach((id, el) => {
        window.clearTimeout(id);
        if (el.isConnected) delete el.dataset.liquidGleam;
      });
      gleamTimers.clear();
      Array.from(rippleCleanups).forEach((fn) => fn());
      rippleCleanups.clear();
      if (activeMagneticEl && activeMagneticEl.isConnected) {
        activeMagneticEl.style.removeProperty('--mx');
        activeMagneticEl.style.removeProperty('--my');
      }
      document.documentElement.style.removeProperty('--aurora-dx');
      document.documentElement.style.removeProperty('--aurora-dy');
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerout', handlePointerOut);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, []);
}

/**
 * Promotes compositor `will-change` strictly during an active entrance/slide keyframe
 * (`data-motion-active="true"`) and immediately releases back to `auto` on
 * `animationend` or bounded fallback timeout so idle views retain zero GPU layer bloat.
 */
export function useActiveMotionFlag(
  triggerKey: string | number,
  fallbackDurationMs = 430
): {
  motionActive: boolean;
  onAnimationEnd: (e: AnimationEvent<HTMLElement>) => void;
} {
  const prefersReduced =
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  const [motionActive, setMotionActive] = useState<boolean>(() => !prefersReduced);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReduced) {
      setMotionActive(false);
      return;
    }

    setMotionActive(true);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setMotionActive(false);
    }, fallbackDurationMs);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [triggerKey, fallbackDurationMs, prefersReduced]);

  const onAnimationEnd = useCallback((e: AnimationEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setMotionActive(false);
  }, []);

  return { motionActive, onAnimationEnd };
}

/**
 * Tracks directional slide-in state when switching between ordered tabs.
 */
export function useTabSlideDirection<T extends string>(
  orderedTabs: readonly T[],
  activeTab: T
): SlideDirection {
  const [prevTab, setPrevTab] = useState<T>(activeTab);
  const [direction, setDirection] = useState<SlideDirection>('none');

  if (activeTab !== prevTab) {
    const nextDir = resolveTabSlideDirection(orderedTabs, prevTab, activeTab);
    setPrevTab(activeTab);
    setDirection(nextDir);
  }

  return direction;
}

/**
 * Tracks directional slide-in state when moving between exam question indices.
 */
export function useQuestionSlideDirection(currentIdx: number): SlideDirection {
  const [prevIdx, setPrevIdx] = useState<number>(currentIdx);
  const [direction, setDirection] = useState<SlideDirection>('none');

  if (currentIdx !== prevIdx) {
    const nextDir = resolveQuestionSlideDirection(prevIdx, currentIdx);
    setPrevIdx(currentIdx);
    setDirection(nextDir);
  }

  return direction;
}

/**
 * Measures `[data-morph-active="true"]` inside a `position: relative` container
 * and drives an iOS 27-style fluid Liquid Glass droplet pill with elastic spring
 * trajectory, transient droplet stretch axis, active-only GPU layer promotion,
 * and smooth horizontal mobile scroll centering.
 */
export function useLiquidMorphPill<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  activeKey: string | number | null | undefined,
  recheckSignature?: unknown
): {
  pillStyle: CSSProperties;
  visible: boolean;
  isMorphing: boolean;
  isMoving: boolean;
  morphAxis: 'horizontal' | 'vertical' | 'none';
} {
  const [geom, setGeom] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
    ready: boolean;
    animate: boolean;
    morphing: boolean;
    moving: boolean;
    axis: 'horizontal' | 'vertical' | 'none';
  }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    ready: false,
    animate: false,
    morphing: false,
    moving: false,
    axis: 'none',
  });

  const prevActiveKeyRef = useRef<string | number | null | undefined>(activeKey);
  const morphResetTimerRef = useRef<number | null>(null);
  const movingResetTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || activeKey === null || activeKey === undefined) {
      setGeom((prev) =>
        prev.ready ? { ...prev, ready: false, animate: false, morphing: false, moving: false } : prev
      );
      prevActiveKeyRef.current = activeKey;
      return;
    }

    const activeKeyChanged = prevActiveKeyRef.current !== activeKey;
    prevActiveKeyRef.current = activeKey;

    const prefersReduced =
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

    const measure = (allowAnimate: boolean, keyJustChanged: boolean) => {
      const target = container.querySelector<HTMLElement>('[data-morph-active="true"]');
      if (!target || target.offsetWidth === 0 || target.offsetHeight === 0) {
        setGeom((prev) =>
          prev.ready ? { ...prev, ready: false, morphing: false, moving: false } : prev
        );
        return;
      }

      const nextX = target.offsetLeft;
      const nextY = target.offsetTop;
      const nextW = target.offsetWidth;
      const nextH = target.offsetHeight;

      if (keyJustChanged && container.scrollWidth > container.clientWidth + 6) {
        try {
          target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        } catch {
          // Ignore scrollIntoView errors on older embedded WebViews
        }
      }

      setGeom((prev) => {
        if (
          prev.ready &&
          prev.x === nextX &&
          prev.y === nextY &&
          prev.width === nextW &&
          prev.height === nextH
        ) {
          return prev;
        }
        const stretch = prev.ready
          ? computeMorphStretchMetrics(prev, { x: nextX, y: nextY })
          : { axis: 'none' as const };
        const shouldAnimate = prev.ready && allowAnimate && !prefersReduced;
        const shouldStretch = shouldAnimate && stretch.axis !== 'none';
        const releaseMs = resolveMorphActiveDurationMs(shouldAnimate, 420);

        if (shouldStretch) {
          if (morphResetTimerRef.current !== null) {
            window.clearTimeout(morphResetTimerRef.current);
          }
          morphResetTimerRef.current = window.setTimeout(() => {
            morphResetTimerRef.current = null;
            setGeom((curr) => (curr.morphing ? { ...curr, morphing: false } : curr));
          }, 360);
        }

        if (releaseMs > 0) {
          if (movingResetTimerRef.current !== null) {
            window.clearTimeout(movingResetTimerRef.current);
          }
          movingResetTimerRef.current = window.setTimeout(() => {
            movingResetTimerRef.current = null;
            setGeom((curr) => (curr.moving ? { ...curr, moving: false } : curr));
          }, releaseMs);
        }

        return {
          x: nextX,
          y: nextY,
          width: nextW,
          height: nextH,
          ready: true,
          animate: prev.ready && allowAnimate,
          morphing: shouldStretch,
          moving: releaseMs > 0,
          axis: stretch.axis,
        };
      });
    };

    measure(true, activeKeyChanged);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure(false, false));
      ro.observe(container);
      const activeEl = container.querySelector<HTMLElement>('[data-morph-active="true"]');
      if (activeEl) ro.observe(activeEl);
    }

    const onResize = () => measure(false, false);
    window.addEventListener('resize', onResize, { passive: true });

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [containerRef, activeKey, recheckSignature]);

  useEffect(() => {
    return () => {
      if (morphResetTimerRef.current !== null) {
        window.clearTimeout(morphResetTimerRef.current);
      }
      if (movingResetTimerRef.current !== null) {
        window.clearTimeout(movingResetTimerRef.current);
      }
    };
  }, []);

  const pillStyle: CSSProperties = {
    transform: `translate3d(${geom.x}px, ${geom.y}px, 0)`,
    width: `${geom.width}px`,
    height: `${geom.height}px`,
    opacity: geom.ready ? 1 : 0,
    willChange: resolveActiveMotionLayerState({
      isMorphing: geom.moving,
      properties: 'transform',
    }),
    transition: geom.animate
      ? 'transform 400ms cubic-bezier(0.28, 1.32, 0.42, 1), width 380ms cubic-bezier(0.16, 1, 0.3, 1), height 380ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms ease'
      : 'opacity 160ms ease',
  };

  return {
    pillStyle,
    visible: geom.ready,
    isMorphing: geom.morphing,
    isMoving: geom.moving,
    morphAxis: geom.axis,
  };
}
