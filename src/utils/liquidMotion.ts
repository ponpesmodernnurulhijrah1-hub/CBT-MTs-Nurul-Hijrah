export type SlideDirection = 'forward' | 'backward' | 'none';

export interface BoxRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MorphPillGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpecularCoords {
  xPercent: number;
  yPercent: number;
}

/**
 * Resolves directional slide-in transition between ordered navigation tabs.
 */
export function resolveTabSlideDirection<T extends string>(
  tabs: readonly T[],
  prevTab: T | null | undefined,
  nextTab: T
): SlideDirection {
  if (!prevTab || prevTab === nextTab) return 'none';
  const prevIdx = tabs.indexOf(prevTab);
  const nextIdx = tabs.indexOf(nextTab);
  if (prevIdx === -1 || nextIdx === -1 || prevIdx === nextIdx) return 'none';
  return nextIdx > prevIdx ? 'forward' : 'backward';
}

/**
 * Resolves directional slide-in transition when navigating between exam questions.
 */
export function resolveQuestionSlideDirection(
  prevIndex: number,
  nextIndex: number
): SlideDirection {
  if (!Number.isFinite(prevIndex) || !Number.isFinite(nextIndex) || prevIndex === nextIndex) {
    return 'none';
  }
  return nextIndex > prevIndex ? 'forward' : 'backward';
}

/**
 * Clamps pointer coordinates relative to an element bounding box into 0..100 percentages
 * for GPU cursor-following specular highlights.
 */
export function clampRelativeSpecularCoords(
  clientX: number,
  clientY: number,
  rect: BoxRectLike
): SpecularCoords {
  if (!Number.isFinite(rect.width) || rect.width <= 0 || !Number.isFinite(rect.height) || rect.height <= 0) {
    return { xPercent: 50, yPercent: 50 };
  }
  const rawX = ((clientX - rect.left) / rect.width) * 100;
  const rawY = ((clientY - rect.top) / rect.height) * 100;
  const xPercent = Math.round(Math.min(100, Math.max(0, Number.isFinite(rawX) ? rawX : 50)) * 10) / 10;
  const yPercent = Math.round(Math.min(100, Math.max(0, Number.isFinite(rawY) ? rawY : 50)) * 10) / 10;
  return { xPercent, yPercent };
}

/**
 * Computes container-relative morphing pill geometry (supporting scroll offsets if DOM rects are used).
 */
export function computeMorphIndicatorRect(
  containerRect: { left: number; top: number; scrollLeft?: number; scrollTop?: number },
  itemRect: BoxRectLike
): MorphPillGeometry {
  const scrollLeft = Number.isFinite(containerRect.scrollLeft) ? Number(containerRect.scrollLeft) : 0;
  const scrollTop = Number.isFinite(containerRect.scrollTop) ? Number(containerRect.scrollTop) : 0;
  return {
    x: Math.round((itemRect.left - containerRect.left + scrollLeft) * 100) / 100,
    y: Math.round((itemRect.top - containerRect.top + scrollTop) * 100) / 100,
    width: Math.max(0, Math.round(itemRect.width * 100) / 100),
    height: Math.max(0, Math.round(itemRect.height * 100) / 100),
  };
}
