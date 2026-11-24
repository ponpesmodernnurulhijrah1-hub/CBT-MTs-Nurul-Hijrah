import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import {
  clampRelativeSpecularCoords,
  resolveQuestionSlideDirection,
  resolveTabSlideDirection,
  type SlideDirection,
} from '../utils/liquidMotion';

const SPECULAR_SELECTOR =
  '.btn-press, .surface-card-interactive, .liquid-option-card, .liquid-specular';

/**
 * Global zero-rerender delegated pointer listener that updates `--lx` / `--ly`
 * CSS variables for GPU-composited iOS Liquid Glass specular cursor gleam.
 */
export function useLiquidSpecularGlobal(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    let rafId: number | null = null;
    let pendingTarget: HTMLElement | null = null;
    let pendingX = 0;
    let pendingY = 0;

    const applySpecular = (el: HTMLElement, clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const { xPercent, yPercent } = clampRelativeSpecularCoords(clientX, clientY, rect);
      el.style.setProperty('--lx', `${xPercent}%`);
      el.style.setProperty('--ly', `${yPercent}%`);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const rawTarget = e.target as HTMLElement | null;
      const el = rawTarget?.closest<HTMLElement>(SPECULAR_SELECTOR) ?? null;
      if (!el) return;

      pendingTarget = el;
      pendingX = e.clientX;
      pendingY = e.clientY;

      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        if (pendingTarget && pendingTarget.isConnected) {
          applySpecular(pendingTarget, pendingX, pendingY);
        }
        pendingTarget = null;
      });
    };

    const handlePointerDown = (e: PointerEvent) => {
      const rawTarget = e.target as HTMLElement | null;
      const el = rawTarget?.closest<HTMLElement>(SPECULAR_SELECTOR) ?? null;
      if (!el) return;
      applySpecular(el, e.clientX, e.clientY);
    };

    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('pointerdown', handlePointerDown, { passive: true });

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, []);
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
 * and drives a GPU-animated Liquid Glass morphing pill droplet.
 */
export function useLiquidMorphPill<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  activeKey: string | number | null | undefined,
  recheckSignature?: unknown
): { pillStyle: CSSProperties; visible: boolean } {
  const [geom, setGeom] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
    ready: boolean;
    animate: boolean;
  }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    ready: false,
    animate: false,
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || activeKey === null || activeKey === undefined) {
      setGeom((prev) => (prev.ready ? { ...prev, ready: false, animate: false } : prev));
      return;
    }

    const measure = (allowAnimate: boolean) => {
      const target = container.querySelector<HTMLElement>('[data-morph-active="true"]');
      if (!target || target.offsetWidth === 0 || target.offsetHeight === 0) {
        setGeom((prev) => (prev.ready ? { ...prev, ready: false } : prev));
        return;
      }

      const nextX = target.offsetLeft;
      const nextY = target.offsetTop;
      const nextW = target.offsetWidth;
      const nextH = target.offsetHeight;

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
        return {
          x: nextX,
          y: nextY,
          width: nextW,
          height: nextH,
          ready: true,
          animate: prev.ready && allowAnimate,
        };
      });
    };

    measure(true);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure(false));
      ro.observe(container);
      const activeEl = container.querySelector<HTMLElement>('[data-morph-active="true"]');
      if (activeEl) ro.observe(activeEl);
    }

    const onResize = () => measure(false);
    window.addEventListener('resize', onResize, { passive: true });

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [containerRef, activeKey, recheckSignature]);

  const pillStyle: CSSProperties = {
    transform: `translate3d(${geom.x}px, ${geom.y}px, 0)`,
    width: `${geom.width}px`,
    height: `${geom.height}px`,
    opacity: geom.ready ? 1 : 0,
    transition: geom.animate
      ? 'transform 340ms cubic-bezier(0.22, 1, 0.36, 1), width 340ms cubic-bezier(0.22, 1, 0.36, 1), height 340ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease'
      : 'opacity 160ms ease',
  };

  return { pillStyle, visible: geom.ready };
}
