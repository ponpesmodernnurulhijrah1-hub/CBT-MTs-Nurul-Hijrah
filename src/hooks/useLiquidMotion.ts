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
  computeCardTiltAndSheen,
  computeMagneticPull,
  computeMorphIndicatorRect,
  computeMorphStretchMetrics,
  computeRippleMetrics,
  computeSharedElementFlipTransform,
  resolveActiveMotionLayerState,
  resolveMorphActiveDurationMs,
  resolveMotionProfileForTier,
  resolveQuestionSlideDirection,
  resolveTabSlideDirection,
  type BoxRectLike,
  type SlideDirection,
} from '../utils/liquidMotion';
import type { DevicePerfTier } from '../utils/deviceViewport';

function readActivePerfTier(): DevicePerfTier {
  if (typeof document === 'undefined') return 'high';
  const raw = document.documentElement.dataset.perfTier;
  if (raw === 'lite' || raw === 'balanced' || raw === 'high') return raw;
  return 'high';
}

const SPECULAR_SELECTOR =
  '.btn-press, .surface-card-interactive, .liquid-option-card, .liquid-specular, .liquid-question-btn';
const MAGNETIC_SELECTOR = '.btn-press, .surface-card-interactive, .liquid-question-btn';
const RIPPLE_SELECTOR =
  '.btn-press, .surface-card-interactive, .liquid-option-card, .liquid-question-btn';
const TILT_SELECTOR =
  '.surface-card:not(.exam-reading-surface), .surface-card-interactive, .glass-modal:not([data-no-tilt="true"])';
const SHARED_MORPH_TRIGGER_SELECTOR = '.btn-press, button, [role="button"], .surface-card-interactive';
const SHARED_MORPH_TARGET_SELECTOR = '.glass-modal';

function clearTiltVars(el: HTMLElement | null): void {
  if (!el || !el.isConnected) return;
  delete el.dataset.tiltActive;
  el.style.removeProperty('--tilt-rx');
  el.style.removeProperty('--tilt-ry');
  el.style.removeProperty('--sheen-x');
  el.style.removeProperty('--sheen-y');
  el.style.removeProperty('--sheen-angle');
}

function clearMagneticVars(el: HTMLElement | null): void {
  if (!el || !el.isConnected) return;
  el.style.removeProperty('--mx');
  el.style.removeProperty('--my');
}

/**
 * Global zero-rerender delegated pointer listener driving:
 * 1) Real-time `--lx` / `--ly` cursor & touch spotlight across glass cards & buttons
 * 2) Subtle magnetic micro-attraction (`--mx` / `--my`) including question grid pills
 * 3) 3D Optical Prism Tilt & Holographic Sheen (`--tilt-rx`, `--tilt-ry`, `--sheen-x/y/angle`) across desktop & mobile
 * 4) Shared-Element FLIP Morphing (WAAPI, fill: 'none') for modals & portal/exam transitions on every device tier
 * 5) Gentle cursor & touch reactivity (`--aurora-dx` / `--aurora-dy`) on Aurora blobs
 * 6) Expanding GPU-composited liquid water ripples on click/tap
 */
export function useLiquidSpecularGlobal(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    let rafId: number | null = null;
    let flipRafId: number | null = null;
    let touchResetTimer: number | null = null;
    let pendingTarget: HTMLElement | null = null;
    let pendingTiltEl: HTMLElement | null = null;
    let pendingX = 0;
    let pendingY = 0;
    let lastMoveProcessMs = 0;
    let activeMagneticEl: HTMLElement | null = null;
    let activeTiltEl: HTMLElement | null = null;
    const gleamTimers = new Map<HTMLElement, number>();
    const rippleCleanups = new Set<() => void>();
    const activeFlipAnims = new Set<Animation>();
    const morphedElements = new WeakSet<HTMLElement>();

    let lastTriggerRect: BoxRectLike | null = null;
    let lastTriggerTs = 0;

    const recordSharedOrigin = (rawTarget: HTMLElement | null) => {
      const profile = resolveMotionProfileForTier(readActivePerfTier());
      if (!profile.enableSharedMorph) return;
      const triggerEl = rawTarget?.closest<HTMLElement>(SHARED_MORPH_TRIGGER_SELECTOR);
      if (!triggerEl) return;
      const rect = triggerEl.getBoundingClientRect();
      if (rect.width <= 4 || rect.height <= 4) return;
      lastTriggerRect = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
      lastTriggerTs = performance.now();
    };

    const applySpecularAndMagnet = (
      el: HTMLElement,
      clientX: number,
      clientY: number,
      allowMagnet: boolean
    ) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const { xPercent, yPercent } = clampRelativeSpecularCoords(clientX, clientY, rect);
      el.style.setProperty('--lx', `${xPercent}%`);
      el.style.setProperty('--ly', `${yPercent}%`);

      if (allowMagnet && el.matches(MAGNETIC_SELECTOR) && !(el as HTMLButtonElement).disabled) {
        if (activeMagneticEl && activeMagneticEl !== el) {
          clearMagneticVars(activeMagneticEl);
        }
        activeMagneticEl = el;
        const maxPull = el.classList.contains('liquid-question-btn') ? 3.0 : 2.6;
        const { tx, ty } = computeMagneticPull(clientX, clientY, rect, maxPull);
        el.style.setProperty('--mx', `${tx}px`);
        el.style.setProperty('--my', `${ty}px`);
      }
    };

    const applyCardTiltAndSheen = (
      el: HTMLElement,
      clientX: number,
      clientY: number,
      maxTiltCap: number
    ) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const maxTilt = el.classList.contains('glass-modal') ? Math.min(2.0, maxTiltCap) : maxTiltCap;
      const { rotateXDeg, rotateYDeg, sheenXPercent, sheenYPercent, sheenAngleDeg } =
        computeCardTiltAndSheen(clientX, clientY, rect, maxTilt);

      el.dataset.tiltActive = 'true';
      el.style.setProperty('--tilt-rx', `${rotateXDeg}deg`);
      el.style.setProperty('--tilt-ry', `${rotateYDeg}deg`);
      el.style.setProperty('--sheen-x', `${sheenXPercent}%`);
      el.style.setProperty('--sheen-y', `${sheenYPercent}%`);
      el.style.setProperty('--sheen-angle', `${sheenAngleDeg}deg`);
    };

    const spawnLiquidRipple = (
      el: HTMLElement,
      clientX: number,
      clientY: number,
      rippleLimit: number
    ) => {
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

      while (layer.childElementCount >= rippleLimit) {
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
      const tier = readActivePerfTier();
      const profile = resolveMotionProfileForTier(tier);
      const minStepMs = tier === 'lite' ? 32 : tier === 'balanced' ? 22 : 0;

      const rawTarget = e.target as HTMLElement | null;
      const el = profile.enableSpotlightMove
        ? rawTarget?.closest<HTMLElement>(SPECULAR_SELECTOR) ?? null
        : null;
      const tiltEl = profile.enable3DTilt
        ? rawTarget?.closest<HTMLElement>(TILT_SELECTOR) ?? null
        : null;

      pendingTarget = el;
      pendingTiltEl = tiltEl;
      pendingX = e.clientX;
      pendingY = e.clientY;

      if (rafId !== null) return;
      rafId = window.requestAnimationFrame((now) => {
        rafId = null;
        if (minStepMs > 0 && now - lastMoveProcessMs < minStepMs) {
          return;
        }
        lastMoveProcessMs = now;

        const activeTier = readActivePerfTier();
        const activeProfile = resolveMotionProfileForTier(activeTier);
        if (
          activeProfile.enableAuroraParallax &&
          window.innerWidth > 0 &&
          window.innerHeight > 0
        ) {
          const nx = Math.min(1, Math.max(-1, (pendingX / window.innerWidth - 0.5) * 2));
          const ny = Math.min(1, Math.max(-1, (pendingY / window.innerHeight - 0.5) * 2));
          document.documentElement.style.setProperty('--aurora-dx', `${(nx * 32).toFixed(1)}px`);
          document.documentElement.style.setProperty('--aurora-dy', `${(ny * 24).toFixed(1)}px`);
        }

        if (pendingTarget && pendingTarget.isConnected && activeProfile.enableSpotlightMove) {
          applySpecularAndMagnet(
            pendingTarget,
            pendingX,
            pendingY,
            activeProfile.enableMagneticPull
          );
        } else if (activeMagneticEl) {
          clearMagneticVars(activeMagneticEl);
          activeMagneticEl = null;
        }

        if (pendingTiltEl && pendingTiltEl.isConnected && activeProfile.enable3DTilt) {
          if (activeTiltEl && activeTiltEl !== pendingTiltEl) {
            clearTiltVars(activeTiltEl);
          }
          activeTiltEl = pendingTiltEl;
          applyCardTiltAndSheen(pendingTiltEl, pendingX, pendingY, activeProfile.maxTiltDeg);
        } else if (activeTiltEl) {
          clearTiltVars(activeTiltEl);
          activeTiltEl = null;
        }

        pendingTarget = null;
        pendingTiltEl = null;
      });
    };

    const handlePointerOut = (e: PointerEvent) => {
      const next = e.relatedTarget as Node | null;
      if (activeMagneticEl && (!next || !activeMagneticEl.contains(next))) {
        clearMagneticVars(activeMagneticEl);
        activeMagneticEl = null;
      }
      if (activeTiltEl && (!next || !activeTiltEl.contains(next))) {
        clearTiltVars(activeTiltEl);
        activeTiltEl = null;
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      const rawTarget = e.target as HTMLElement | null;
      recordSharedOrigin(rawTarget);

      if (touchResetTimer !== null) {
        window.clearTimeout(touchResetTimer);
        touchResetTimer = null;
      }

      const tier = readActivePerfTier();
      const profile = resolveMotionProfileForTier(tier);

      const tiltEl = profile.enable3DTilt
        ? rawTarget?.closest<HTMLElement>(TILT_SELECTOR) ?? null
        : null;
      if (tiltEl) {
        if (activeTiltEl && activeTiltEl !== tiltEl) {
          clearTiltVars(activeTiltEl);
        }
        activeTiltEl = tiltEl;
        applyCardTiltAndSheen(tiltEl, e.clientX, e.clientY, profile.maxTiltDeg);
      }

      const el = rawTarget?.closest<HTMLElement>(SPECULAR_SELECTOR) ?? null;
      if (!el) return;

      if (profile.enableSpotlightMove || profile.enableMagneticPull) {
        applySpecularAndMagnet(el, e.clientX, e.clientY, profile.enableMagneticPull);
      }

      if (
        profile.enableLiquidRipple &&
        document.documentElement.dataset.particles !== 'off' &&
        el.matches(RIPPLE_SELECTOR)
      ) {
        spawnLiquidRipple(el, e.clientX, e.clientY, profile.rippleLimit);
      }

      const existing = gleamTimers.get(el);
      if (existing !== undefined) window.clearTimeout(existing);
      el.dataset.liquidGleam = '1';
      const timerId = window.setTimeout(() => {
        gleamTimers.delete(el);
        if (el.isConnected) {
          delete el.dataset.liquidGleam;
        }
      }, 300);
      gleamTimers.set(el, timerId);
    };

    const handleTouchRelease = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (touchResetTimer !== null) window.clearTimeout(touchResetTimer);
      touchResetTimer = window.setTimeout(() => {
        touchResetTimer = null;
        clearMagneticVars(activeMagneticEl);
        activeMagneticEl = null;
        clearTiltVars(activeTiltEl);
        activeTiltEl = null;
      }, 280);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      recordSharedOrigin(e.target as HTMLElement | null);
    };

    const mutationObserver = new MutationObserver((mutations) => {
      const profile = resolveMotionProfileForTier(readActivePerfTier());
      if (!profile.enableSharedMorph) return;
      if (!lastTriggerRect || performance.now() - lastTriggerTs > 460) return;

      const candidates: HTMLElement[] = [];
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches(SHARED_MORPH_TARGET_SELECTOR) && !morphedElements.has(node)) {
            candidates.push(node);
            return;
          }
          const nested = node.querySelector<HTMLElement>(SHARED_MORPH_TARGET_SELECTOR);
          if (nested && !morphedElements.has(nested)) {
            candidates.push(nested);
          }
        });
      }

      if (candidates.length === 0) return;
      const originSnapshot = lastTriggerRect;
      lastTriggerRect = null;
      const targets = candidates.slice(0, 2);

      if (flipRafId !== null) window.cancelAnimationFrame(flipRafId);
      flipRafId = window.requestAnimationFrame(() => {
        flipRafId = null;
        for (const target of targets) {
          if (!target.isConnected || morphedElements.has(target)) continue;
          if (typeof target.animate !== 'function') continue;

          const targetRect = target.getBoundingClientRect();
          if (targetRect.width < 120 || targetRect.height < 60) continue;

          const flip = computeSharedElementFlipTransform(originSnapshot, {
            left: targetRect.left,
            top: targetRect.top,
            width: targetRect.width,
            height: targetRect.height,
          });
          if (!flip.valid) continue;

          morphedElements.add(target);
          try {
            const anim = target.animate(
              [
                {
                  transform: `translate3d(${flip.dx}px, ${flip.dy}px, 0) scale3d(${flip.scaleX}, ${flip.scaleY}, 1)`,
                  opacity: 0.72,
                },
                {
                  transform: 'none',
                  opacity: 1,
                },
              ],
              {
                duration: profile.sharedMorphDurationMs,
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                fill: 'none',
              }
            );
            activeFlipAnims.add(anim);
            const onDone = () => activeFlipAnims.delete(anim);
            anim.addEventListener('finish', onDone, { once: true });
            anim.addEventListener('cancel', onDone, { once: true });
          } catch {
            // Safely ignore WAAPI errors in constrained WebViews
          }
        }
      });
    });

    mutationObserver.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('pointerout', handlePointerOut, { passive: true });
    document.addEventListener('pointerdown', handlePointerDown, { passive: true });
    document.addEventListener('pointerup', handleTouchRelease, { passive: true });
    document.addEventListener('pointercancel', handleTouchRelease, { passive: true });
    document.addEventListener('keydown', handleKeyDown, { passive: true });

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (flipRafId !== null) window.cancelAnimationFrame(flipRafId);
      if (touchResetTimer !== null) window.clearTimeout(touchResetTimer);
      mutationObserver.disconnect();
      activeFlipAnims.forEach((anim) => anim.cancel());
      activeFlipAnims.clear();
      gleamTimers.forEach((id, el) => {
        window.clearTimeout(id);
        if (el.isConnected) delete el.dataset.liquidGleam;
      });
      gleamTimers.clear();
      Array.from(rippleCleanups).forEach((fn) => fn());
      rippleCleanups.clear();
      clearMagneticVars(activeMagneticEl);
      clearTiltVars(activeTiltEl);
      document.documentElement.style.removeProperty('--aurora-dx');
      document.documentElement.style.removeProperty('--aurora-dy');
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerout', handlePointerOut);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('pointerup', handleTouchRelease);
      document.removeEventListener('pointercancel', handleTouchRelease);
      document.removeEventListener('keydown', handleKeyDown);
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
        const tierProfile = resolveMotionProfileForTier(readActivePerfTier());
        const stretch = prev.ready
          ? computeMorphStretchMetrics(prev, { x: nextX, y: nextY })
          : { axis: 'none' as const };
        const shouldAnimate = prev.ready && allowAnimate && !prefersReduced;
        const shouldStretch =
          shouldAnimate && tierProfile.enableMorphStretch && stretch.axis !== 'none';
        const releaseMs = resolveMorphActiveDurationMs(
          shouldAnimate,
          tierProfile.morphDurationMs
        );

        if (shouldStretch) {
          if (morphResetTimerRef.current !== null) {
            window.clearTimeout(morphResetTimerRef.current);
          }
          morphResetTimerRef.current = window.setTimeout(() => {
            morphResetTimerRef.current = null;
            setGeom((curr) => (curr.morphing ? { ...curr, morphing: false } : curr));
          }, Math.min(340, tierProfile.morphDurationMs));
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

  const activeTierProfile = resolveMotionProfileForTier(readActivePerfTier());
  const pillStyle: CSSProperties = {
    transform: `translate3d(${geom.x}px, ${geom.y}px, 0)`,
    width: `${geom.width}px`,
    height: `${geom.height}px`,
    opacity: geom.ready ? 1 : 0,
    willChange: resolveActiveMotionLayerState({
      isMorphing: geom.moving,
      properties: 'transform',
    }),
    transition: geom.animate ? activeTierProfile.pillTransition : 'opacity 140ms ease',
  };

  return {
    pillStyle,
    visible: geom.ready,
    isMorphing: geom.morphing,
    isMoving: geom.moving,
    morphAxis: geom.axis,
  };
}
